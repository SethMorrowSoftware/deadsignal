/* Dead Signal Studio — export/encoder.js
 *
 * Offline video export: render frame-indexed, encode with WebCodecs, mux to
 * WebM. Faster than real time, frame-exact, cancellable, and unaffected by tab
 * focus.
 *
 * The old path drove canvas.captureStream() into a MediaRecorder, which is
 * wall-clock bound: a 60-second clip cost 60 seconds with the tab focused, and
 * frames were dropped whenever the compositor was busy, so the same recipe
 * produced a different frame count each run. Measured here, WebCodecs encodes
 * ten seconds of 320x240 in well under a second.
 *
 * Capability is DETECTED, never assumed — VideoEncoder needs a secure context
 * (https or localhost), so the same browser can support it on one origin and
 * not another. When it is unavailable this returns null and the caller falls
 * back to the real-time recorder, which still works everywhere.
 */
import { muxWebM, codecIdFor } from './webm.js';
import { muxMP4 } from './mp4.js';

/** Codecs to try, best first, per container. */
const CANDIDATES = {
  webm: [
    { codec: 'vp09.00.10.08', label: 'VP9' },
    { codec: 'vp8',           label: 'VP8' },
    { codec: 'av01.0.04M.08', label: 'AV1' },
  ],
  /* Baseline first. High profile is better per bit, but an MP4 is exported to
     LEAVE the browser — a phone, an editor, an upload — and baseline is the
     level everything decodes. avc1.4d = Main is the compromise if baseline is
     somehow missing. */
  mp4: [
    { codec: 'avc1.42001f', label: 'H.264 baseline' },
    { codec: 'avc1.4d001f', label: 'H.264 main' },
    { codec: 'avc1.640028', label: 'H.264 high' },
  ],
};

/** Containers, in the order the picker offers them. */
export const CONTAINERS = [
  { id: 'webm', label: 'WebM (VP9)', ext: 'webm',
    note: 'Plays in any browser. Not reliably accepted by editors, phones or uploads.' },
  { id: 'mp4', label: 'MP4 (H.264)', ext: 'mp4',
    note: 'Plays essentially everywhere — the one to hand to something that is not a browser.' },
];

/** Fill a container picker. Options come from CONTAINERS so there is one list. */
export function fillContainerSelect(el) {
  if (!el) return;
  el.replaceChildren();
  for (const c of CONTAINERS) {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.label;
    el.appendChild(o);
  }
}

/**
 * What this environment can actually do.
 * @returns {Promise<{available:boolean, reason?:string, codec?:string, label?:string}>}
 */
export async function encoderSupport(width = 320, height = 240, container = 'webm') {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return { available: false,
      reason: typeof isSecureContext !== 'undefined' && !isSecureContext
        ? 'WebCodecs needs a secure context — serve over https or localhost'
        : 'this browser has no WebCodecs VideoEncoder' };
  }
  // Encoders often require even dimensions.
  const w = width + (width % 2), h = height + (height % 2);
  const mp4 = container === 'mp4';
  for (const c of (CANDIDATES[container] || CANDIDATES.webm)) {
    // WebM needs a codec id the muxer knows; MP4 carries H.264 and nothing else.
    if (!mp4 && !codecIdFor(c.codec)) continue;
    try {
      const s = await VideoEncoder.isConfigSupported({
        codec: c.codec, width: w, height: h, bitrate: 2_000_000, framerate: 30,
        // Length-prefixed NALUs with the parameter sets in a decoder
        // description, which is what avcC is. Annex-B start codes are for a
        // transport stream and would give an MP4 no avcC at all.
        ...(mp4 ? { avc: { format: 'avc' } } : {}),
      });
      if (s?.supported) return { available: true, codec: c.codec, label: c.label, container };
    } catch { /* try the next one */ }
  }
  return { available: false,
    reason: mp4 ? 'no H.264 encoder in this browser' : 'no supported WebM codec in this browser' };
}

/** WebM carries Opus; MP4 carries AAC. Nothing else about the path differs. */
const AUDIO_CODEC = { webm: 'opus', mp4: 'mp4a.40.2' };

/** Whether this browser can encode the audio track for a container. */
export async function audioEncoderSupport(channels = 2, container = 'webm') {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') {
    return { available: false, reason: 'this browser has no WebCodecs AudioEncoder' };
  }
  const codec = AUDIO_CODEC[container] || AUDIO_CODEC.webm;
  try {
    const s = await AudioEncoder.isConfigSupported({
      codec, sampleRate: 48000, numberOfChannels: channels, bitrate: 128_000 });
    return s?.supported ? { available: true, codec }
      : { available: false, reason: `${codec} encoding unavailable here` };
  } catch (e) {
    return { available: false, reason: e.message };
  }
}

/* Opus works at 48kHz and encodes in 20ms frames. Feeding it exactly that keeps
   the packet timestamps a clean multiple of the frame and avoids a ragged last
   packet carrying a partial frame's worth of silence. */
const OPUS_RATE = 48000;
const OPUS_FRAME = 960;

/**
 * Encode an AudioBuffer (already at 48kHz) into Opus packets for the muxer.
 * Returns null when the browser cannot do it, so the caller ships a silent clip
 * rather than no clip.
 */
export async function encodeAudioTrack(buffer, { bitrate = 128_000, container = 'webm' } = {}) {
  if (!buffer || !buffer.length) return null;
  const channels = Math.min(2, buffer.numberOfChannels);
  const support = await audioEncoderSupport(channels, container);
  if (!support.available) return null;

  const out = [];
  let description = null, encodeError = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig?.description && !description) {
        description = new Uint8Array(meta.decoderConfig.description);
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      out.push({ data, timestampUs: chunk.timestamp, durationUs: chunk.duration ?? 20_000 });
    },
    error: (e) => { encodeError = e; },
  });
  enc.configure({ codec: support.codec, sampleRate: OPUS_RATE, numberOfChannels: channels, bitrate });

  const planes = [];
  for (let c = 0; c < channels; c++) planes.push(buffer.getChannelData(c));
  const len = buffer.length;
  for (let i = 0; i < len && !encodeError; i += OPUS_FRAME) {
    const n = Math.min(OPUS_FRAME, len - i);
    // f32-planar wants each channel laid end to end in one buffer.
    const data = new Float32Array(n * channels);
    for (let c = 0; c < channels; c++) data.set(planes[c].subarray(i, i + n), c * n);
    const ad = new AudioData({
      format: 'f32-planar', sampleRate: OPUS_RATE, numberOfFrames: n,
      numberOfChannels: channels, timestamp: Math.round(i / OPUS_RATE * 1e6), data,
    });
    enc.encode(ad);
    ad.close();
    // Wait for the queue to drain, not a single yield (see the video loop).
    while (enc.encodeQueueSize > 24 && !encodeError) await new Promise((r) => setTimeout(r, 0));
  }
  // Guard the flush so a fatal error is reported, not masked by a closed-codec
  // InvalidStateError from flush() itself.
  try { await enc.flush(); } catch (e) { if (!encodeError) throw e; }
  enc.close();
  if (encodeError) throw encodeError;
  if (!out.length) return null;
  return { frames: out, description, sampleRate: OPUS_RATE, channels, codec: support.codec };
}

/**
 * Encode a clip by calling drawFrame() for each frame index.
 *
 * @param {object}   opts
 * @param {number}   opts.width
 * @param {number}   opts.height
 * @param {number}   opts.fps
 * @param {number}   opts.frames             total frame count
 * @param {(ctx:CanvasRenderingContext2D, t:number, i:number)=>void|Promise<void>} opts.drawFrame
 *                   awaited per frame, so a frame that must seek an imported
 *                   <video> first can be async; sync callers are unaffected
 * @param {number}   [opts.bitrate]
 * @param {(p:number)=>void} [opts.onProgress]  0..1
 * @param {() => boolean}    [opts.cancelled]   return true to stop early
 * @returns {Promise<{blob:Blob, codec:string, label:string, ms:number, frames:number,
 *                    cancelled?:boolean}|null>}
 *          null when WebCodecs is unavailable — caller should fall back.
 *
 *          `cancelled: true` means the author stopped it: the blob holds only
 *          the frames encoded so far. It is reported rather than returned as a
 *          plain success because a truncated clip that claims to be finished is
 *          worse than no clip — the caller has to decide, and every caller here
 *          discards it.
 */
export async function encodeClip(opts) {
  const { width, height, fps, frames, drawFrame, bitrate, onProgress, cancelled, audioBuffer } = opts;
  let container = opts.container === 'mp4' ? 'mp4' : 'webm';
  let support = await encoderSupport(width, height, container);
  /* H.264 is a licensed codec and plenty of Chromium builds ship without it, so
     "MP4, please" has to degrade to a file rather than to nothing. Returning
     null here would drop the caller all the way to the real-time recorder —
     slower, wall-clock bound, and still not an MP4. Re-encoding as WebM is the
     honest answer, and the reason is logged rather than swallowed. */
  if (!support.available && container === 'mp4') {
    const webm = await encoderSupport(width, height, 'webm');
    if (webm.available) {
      opts.log?.(`No H.264 encoder here (${support.reason}) — exporting WebM instead.`, 'warn');
      container = 'webm';
      support = webm;
    }
  }
  if (!support.available) return null;

  const W = width + (width % 2), H = height + (height % 2);
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const out = [];
  let description = null;
  let encodeError = null;

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig?.description && !description) {
        description = new Uint8Array(meta.decoderConfig.description);
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      out.push({ data, timestampUs: chunk.timestamp,
                 durationUs: chunk.duration ?? Math.round(1e6 / fps),
                 key: chunk.type === 'key' });
    },
    error: (e) => { encodeError = e; },
  });

  encoder.configure({
    codec: support.codec, width: W, height: H, framerate: fps,
    bitrate: bitrate && bitrate > 0 ? Math.round(bitrate) : Math.round(W * H * fps * 0.12),
    latencyMode: 'quality',
    ...(container === 'mp4' ? { avc: { format: 'avc' } } : {}),
  });

  const KEY_EVERY = Math.max(1, Math.round(fps * 2));   // a keyframe every ~2s
  let stopped = false;
  /* A VideoEncoder is a hardware handle, and drawFrame is ARBITRARY CALLER CODE
     — a scene, a filter chain, an author's keyframe curve. If it throws, the
     exception used to propagate out of here with the encoder still open and
     configured, because close() sat after the loop. Chromium caps how many
     encoders a page may hold, so a few failed exports in a row stopped being
     able to export at all — and the symptom was "WebCodecs is unavailable",
     which is a different problem with a different fix.
     flush() stays inside, so a successful run is ordered exactly as before. */
  let encoderClosed = false;
  const closeEncoder = () => {
    if (encoderClosed) return;
    encoderClosed = true;
    try { encoder.close(); } catch { /* already gone */ }
  };
  try {
  for (let i = 0; i < frames; i++) {
    if (cancelled?.()) { stopped = true; break; }
    if (encodeError) break;

    await drawFrame(ctx, i / fps, i);
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round((i * 1e6) / fps),
      duration: Math.round(1e6 / fps),
    });
    encoder.encode(frame, { keyFrame: i % KEY_EVERY === 0 });
    frame.close();

    // WAIT for the encoder to drain, don't just yield once: a single macrotask
    // yield dequeues nothing when drawing is cheaper than encoding (a simple
    // scene at 1080p under software VP9), so the queue grew unbounded — each
    // in-flight VideoFrame pinning ~8MB — until the tab ran out of memory. The
    // loop holds the queue at its cap, which is what "let the encoder drain"
    // was meant to do.
    while (encoder.encodeQueueSize > 8 && !encodeError && !cancelled?.()) {
      await new Promise((r) => setTimeout(r, 0));
    }
    onProgress?.((i + 1) / frames);
  }

  // Guard the flush: a fatal encoder error has already closed the codec, so
  // flush() would reject with InvalidStateError and MASK the real error that the
  // `throw encodeError` below is meant to report.
  try { await encoder.flush(); } catch (e) { if (!encodeError) throw e; }
  } finally {
    closeEncoder();
  }
  if (encodeError) throw encodeError;
  // Stopped before a single frame landed: there is nothing to mux, but this is
  // still a cancellation and not "WebCodecs is unavailable". Saying so keeps
  // the caller from mistaking it for a failure and starting the real-time
  // recorder the author just asked to stop.
  if (!out.length) return stopped ? { cancelled: true, blob: null, frames: 0 } : null;

  /* Audio is encoded after the picture rather than alongside it. Two encoders
     competing for the same main thread makes both slower, and the audio is a
     rounding error next to the video — a ten-second stereo bed is a few dozen
     milliseconds of work. A failure here costs the sound, not the clip. */
  let audio = null;
  if (audioBuffer && !stopped) {
    try { audio = await encodeAudioTrack(audioBuffer, { container }); }
    catch (e) { audio = null; }
  }

  /* MP4 can refuse: it needs an avcC, and it will not write a file whose frames
     arrived out of presentation order because it has no DTS to express that
     with. Falling back to WebM is strictly better than either a corrupt MP4 or
     no clip at all — the author gets a file and a line in the console saying
     which one and why. */
  let blob, ext = 'webm', label = support.label;
  if (container === 'mp4') {
    try {
      blob = muxMP4({ frames: out, width: W, height: H, description, audio });
      ext = 'mp4';
    } catch (e) {
      opts.log?.(`MP4 muxing failed (${e.message}) — writing WebM instead.`, 'warn');
    }
  }
  if (!blob) {
    // The H.264 stream cannot go in a WebM, so a fallback has to re-encode.
    if (container === 'mp4') return encodeClip({ ...opts, container: 'webm' });
    blob = muxWebM({ frames: out, width: W, height: H, codec: support.codec, description, audio });
  }
  const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
  return { blob, codec: support.codec, label, ext, container: ext, ms, frames: out.length,
           audio: audio ? { packets: audio.frames.length, channels: audio.channels } : null,
           audioRequested: !!audioBuffer,
           ...(stopped ? { cancelled: true } : {}) };
}
