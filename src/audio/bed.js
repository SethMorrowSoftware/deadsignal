/* Dead Signal Studio — audio/bed.js
 *
 * The sound a clip carries.
 *
 * AUDIO and VIDEO were two separate exports: you rendered a .wav and a .webm
 * and the campaign played them separately. That is workable when the asset is
 * dressing inside a fake desktop and impossible when it is a Short — nobody
 * uploads a silent vertical video and a WAV.
 *
 * A bed is chosen on the VIDEO tab and travels in the recipe, so it survives a
 * reload, a project file and a timeline capture. Library rows are addressed by
 * their asset key rather than their row id, because the id is a counter that
 * restarts every session while the key is what the asset store is filed under.
 */
import { log, val } from '../core/dom.js';
import { assetBlob, library } from '../library/library.js';
import { lastAudio } from './ui.js';
import { LIB_PREFIX, fadeShape } from '../doc/audioclip.js';
import { isClipping, peakLabel, peakLevel } from './peaks.js';

/* Re-exported so every existing importer keeps its one-line import. The
   definition lives in doc/audioclip.js — see the note there. */
export { LIB_PREFIX };

export const BED_NONE = '';
export const BED_LAST = 'last';
/** Opus encodes at 48kHz; everything is resampled to it on the way in. */
export const BED_RATE = 48000;

/** What the VIDEO tab is currently set to use. */
export const bedChoice = () => val('v-audio') || BED_NONE;

/**
 * Every library row whose bytes might contain sound.
 *
 * Video rows are in the list, and that is the whole point of them being here: a
 * clip you imported with dialogue in it was previously unreachable — the pooled
 * decoders are muted (video/sources.js) and this filter only admitted `music`,
 * so the sound existed in the file and had no path to the mix. decodeAudioData
 * decodes the audio track of a webm or an mp4, so the mixer already knew how to
 * play it; nothing was ever offering it one.
 *
 * A container whose audio codec this browser cannot decode still fails — but it
 * fails at decode time with a message naming the row, which is a fixable
 * complaint rather than an option that was never there.
 */
export function bedCandidates() {
  return library.filter((it) => (it.kind === 'music' || it.kind === 'videos') && it.blob && it.key);
}

/* Decoded library assets, keyed by choice.

   A decode used to happen per call, each one constructing its own AudioContext.
   That was fine while a sequence had one bed and a handful of per-clip ones; it
   stops being fine the moment an audio lane lets ten clips point at the same
   asset, because that is ten decodes and eleven contexts — and browsers cap
   concurrent AudioContexts at around six, past which construction throws,
   rawFor returns null, and the export completes SILENTLY with a log line that
   reads like a broken asset.

   'last' is deliberately never cached: rawFor returns lastAudio.channels by
   REFERENCE, and normalizeAudio() rescales those arrays in place, so a cached
   entry would go stale with nothing to invalidate it. */
const _raw = new Map();

/** Drop a cached decode (one choice, or all of them). */
export function invalidateBedCache(choice) {
  if (choice) _raw.delete(choice); else _raw.clear();
}

/** Raw channel data for a choice, or null. */
async function rawFor(choice) {
  if (choice === BED_LAST) {
    if (!lastAudio || !lastAudio.channels || !lastAudio.channels.length) return null;
    return { channels: lastAudio.channels, sampleRate: lastAudio.sr, label: 'the last audio render' };
  }
  if (!choice.startsWith(LIB_PREFIX)) return null;
  if (_raw.has(choice)) return _raw.get(choice);
  const pending = decodeChoice(choice);
  _raw.set(choice, pending);
  // A failed decode must not be remembered as "this asset has no sound": the
  // blob may simply not have arrived yet.
  pending.then((v) => { if (!v) _raw.delete(choice); }, () => _raw.delete(choice));
  return pending;
}

async function decodeChoice(choice) {
  const key = choice.slice(LIB_PREFIX.length);
  const it = library.find((x) => x.key === key);
  const blob = it?.blob || assetBlob(key);
  if (!blob) return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channels = [];
    for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c).slice());
    return { channels, sampleRate: buf.sampleRate, label: (it?.name || 'asset') + '.' + (it?.ext || 'wav') };
  } catch (e) {
    return null;
  } finally {
    try { await ctx.close(); } catch { /* already closed */ }
  }
}

/**
 * The bed as a 48kHz AudioBuffer exactly `seconds` long.
 *
 * Shorter than the clip loops; longer is trimmed. Looping is the useful default
 * for the thing a bed usually is — a hum, a room tone, a drone — and the AUDIO
 * tab's "Loop xf" crossfade is what makes the seam disappear. Either way it
 * says which happened, because a clip that quietly went silent halfway through
 * is the sort of thing you find out about after uploading it.
 */
export async function prepareBed(choice, seconds) {
  /* The DOM fallback stays exactly as it was. It is pinned by the audit and
     export/batch.js already defends against it by passing an explicit choice —
     new callers use renderSource, which never reads a control. */
  const want = choice ?? bedChoice();
  return renderSource(want, seconds, { loop: true, announce: true });
}

/**
 * A source rendered to a 48kHz AudioBuffer exactly `seconds` long.
 *
 * The primitive underneath both the bed and the audio lane, and the only place
 * that knows how to turn a choice into samples.
 *
 * `offset` plays from that many seconds into the source, which is what makes an
 * audio clip's in-point mean anything. `loop` decides what happens when the
 * window runs past the end of the source: a bed is a hum you want looped, an
 * audio clip is usually a one-shot, and before this there was no way to say the
 * second one at all — a short effect under a long clip simply repeated.
 */
export async function renderSource(choice, seconds, opts = {}) {
  const { offset = 0, loop = true, gain = 1, fadeIn = 0, fadeOut = 0,
          rate = 1, reverse = false, span = 0, announce = false } = opts;
  if (!choice || choice === BED_NONE) return null;
  const raw = await rawFor(choice);
  if (!raw) { log('Audio: nothing to use for "' + choice + '" — exporting silent.', 'warn'); return null; }

  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) { log('Audio: no OfflineAudioContext here — exporting silent.', 'warn'); return null; }

  const srcLen = raw.channels[0]?.length || 0;
  if (!srcLen) return null;
  const srcSecs = srcLen / raw.sampleRate;
  const outLen = Math.max(1, Math.ceil(seconds * BED_RATE));
  const nch = Math.min(2, raw.channels.length);
  const speed = Number.isFinite(+rate) && +rate > 0 ? +rate : 1;
  /* Reversed, the window still describes the FORWARD source — an author picked
     it by watching the shot play normally — so the start point has to be
     measured from the far end: the last sample of [offset, offset+span] is the
     first one heard. Reversing the whole source and mapping the window into it
     is what makes that true, and it is why `span` is passed rather than
     inferred: the rendered window can be shorter than the clip when the clip
     runs past the end of the sequence. */
  const back = !!reverse;
  const from = back
    ? Math.max(0, Math.min(srcSecs - (Math.max(0, offset) + Math.max(0, span || seconds * speed)),
                           Math.max(0, srcSecs - 0.001)))
    : Math.max(0, Math.min(offset, Math.max(0, srcSecs - 0.001)));

  const ctx = new OAC(nch, outLen, BED_RATE);
  const buf = ctx.createBuffer(raw.channels.length, srcLen, raw.sampleRate);
  for (let c = 0; c < raw.channels.length; c++) {
    if (!back) { buf.copyToChannel(raw.channels[c], c); continue; }
    // Copied backwards rather than played backwards: Web Audio has no negative
    // playbackRate, so reverse has to exist in the samples.
    const src0 = raw.channels[c];
    const flipped = new Float32Array(src0.length);
    for (let i = 0, n = src0.length; i < n; i++) flipped[i] = src0[n - 1 - i];
    buf.copyToChannel(flipped, c);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  /* At 2× the source is consumed twice as fast, so the same material covers
     half as much output — which is the whole question "is there enough of it". */
  const covers = (srcSecs - from) / speed;
  const willLoop = loop && covers < seconds - 0.01;
  /* A source shorter than its window with looping OFF is not a fault — a shot
     whose sound ends before its picture does is an ordinary thing to cut. But
     silence in the back half of a clip is otherwise indistinguishable from a
     broken asset, so it is said once rather than left to be discovered. */
  const short = !loop ? seconds - covers : 0;
  if (short > 0.05) {
    log('Audio: ' + raw.label + ' runs out ' + short.toFixed(1)
        + 's before the clip does — the rest is silence.', 'info');
  }
  if (willLoop) {
    src.loop = true;
    /* Without these the loop restarts at sample 0 rather than at the in-point,
       so a clip trimmed to the second half of a sound plays that half once and
       the whole thing forever after. */
    src.loopStart = from;
    src.loopEnd = buf.duration;
  }
  if (speed !== 1) { try { src.playbackRate.value = speed; } catch { /* fixed rate */ } }
  let node = src;
  if (gain !== 1 || fadeIn > 0 || fadeOut > 0) {
    const g = ctx.createGain();
    /* Scheduled from the pure shape rather than computed here, so the rule for
       two fades that do not fit lives in one place and is testable without an
       audio context. AudioParam writes, not control writes — outside the .value
       ban, which is about DOM controls bypassing the document. */
    const shape = fadeShape(seconds, fadeIn, fadeOut, gain);
    g.gain.setValueAtTime(shape[0].v, 0);
    for (let i = 1; i < shape.length; i++) g.gain.linearRampToValueAtTime(shape[i].v, shape[i].t);
    node.connect(g); node = g;
  }
  node.connect(ctx.destination);
  src.start(0, from);
  const rendered = await ctx.startRendering();

  if (announce) {
    log('Audio bed: ' + raw.label + ' — ' + srcSecs.toFixed(1) + 's '
        + (willLoop ? 'looped to fill ' : srcSecs > seconds + 0.01 ? 'trimmed to ' : 'at ')
        + seconds.toFixed(1) + 's, ' + nch + 'ch.', 'info');
  }
  return rendered;
}

/**
 * One bed for a whole sequence: the sequence's own, plus each clip's, laid at
 * the time that clip starts.
 *
 * Per-clip beds are mixed OVER the sequence bed rather than replacing it, which
 * is what makes the two controls compose — a room tone that runs the whole way
 * through with a phone ringing over clip three is the ordinary case, and it
 * needs no special mode to express.
 *
 * @param {number} total    sequence length in seconds
 * @param {string} seqChoice the sequence-wide bed, or ''
 * @param {Array<{choice:string, at:number, seconds:number}>} parts per-clip beds
 * @returns {Promise<AudioBuffer|null>} null when there is nothing to play
 */
export async function buildSequenceBed(total, seqChoice, parts = []) {
  return buildSequenceMix(total, seqChoice, parts, []);
}

/**
 * The whole of a sequence's sound: the sequence bed, each video clip's bed, and
 * every clip on the audio lane, mixed to one 48kHz buffer.
 *
 * `videoParts` are `{choice, at, seconds}` — a bed belonging to a picture clip,
 * with no level of its own. `audioParts` are the lane's, and carry `offset`,
 * `loop`, `gain` and `pan`, because a sound placed deliberately is a sound you
 * expect to be able to place IN THE MIX as well as in time.
 *
 * Returns null when there is nothing to play: no sound anywhere is silence, not
 * a buffer of zeros, and the difference matters to the exporter — it is what
 * decides whether the file carries an audio track at all.
 */
export async function buildSequenceMix(total, seqChoice, videoParts = [], audioParts = []) {
  const wantedVideo = videoParts.filter((p) => p.choice && p.choice !== BED_NONE && p.seconds > 0);
  const wantedAudio = audioParts.filter((p) => p.choice && p.choice !== BED_NONE && p.seconds > 0);
  const base = await prepareBed(seqChoice, total);
  if (!wantedVideo.length && !wantedAudio.length) return base;

  /* Each part is rendered at its OWN length first — that is where a short
     source is looped and a long one trimmed, and a part should fill the clip it
     belongs to rather than the sequence. */
  const rendered = [];
  for (const p of wantedVideo) {
    /* `loop` and `offset` default to the bed's behaviour — fill the clip,
       from the top — so a part written before footage audio existed renders
       exactly as it did. A footage part asks for the opposite of both. */
    const buf = await renderSource(p.choice, Math.min(p.seconds, Math.max(0.01, total - p.at)),
      { offset: p.offset || 0, loop: p.loop !== false,
        rate: p.rate || 1, reverse: !!p.reverse, span: p.span || 0 });
    if (buf) rendered.push({ buf, at: p.at, gain: 1, pan: 0 });
  }
  for (const p of wantedAudio) {
    const buf = await renderSource(p.choice, Math.min(p.seconds, Math.max(0.01, total - p.at)),
      { offset: p.offset || 0, loop: !!p.loop, fadeIn: p.fadeIn || 0, fadeOut: p.fadeOut || 0 });
    if (buf) rendered.push({ buf, at: p.at, gain: p.gain ?? 1, pan: p.pan ?? 0 });
  }
  if (!rendered.length) return base;

  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) { log('Mixing needs an OfflineAudioContext — using the sequence bed only.', 'warn'); return base; }

  const outLen = Math.max(1, Math.ceil(total * BED_RATE));
  /* A mono mixdown cannot express a pan, so one panned part makes the whole mix
     stereo. Capped at 2 because encodeAudioTrack caps at 2 and would otherwise
     drop channels without saying so. */
  const panned = rendered.some((r) => r.pan);
  const widest = Math.max(base?.numberOfChannels || 1, ...rendered.map((r) => r.buf.numberOfChannels));
  const nch = panned ? 2 : Math.min(2, widest);
  const ctx = new OAC(nch, outLen, BED_RATE);
  const play = (buf, at, gain = 1, pan = 0) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    let node = src;
    // AudioParam writes, not control writes — outside the .value ban, which is
    // about DOM controls bypassing the document.
    if (gain !== 1) { const g = ctx.createGain(); g.gain.value = gain; node.connect(g); node = g; }
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node.connect(p); node = p; }
    node.connect(ctx.destination);
    // Clamped: a part starting past the end of the sequence would throw rather
    // than simply contributing nothing.
    src.start(Math.max(0, Math.min(at, total)));
  };
  if (base) play(base, 0);
  for (const r of rendered) play(r.buf, r.at, r.gain, r.pan);
  const mixed = await ctx.startRendering();

  /* The encoder never reads sampleRate — it configures at 48kHz and stamps its
     timestamps from 48000 — so a mixdown at any other rate is not rejected,
     it is silently mis-declared: a plausible file that plays at the wrong pitch
     and the wrong length. Refuse rather than hand it over. */
  if (mixed.sampleRate !== BED_RATE || mixed.numberOfChannels > 2) {
    log('Audio mix is not 48kHz stereo (' + mixed.sampleRate + 'Hz, ' + mixed.numberOfChannels
        + 'ch) — refusing to hand it to the encoder.', 'err');
    return null;
  }
  /* Measured HERE, which is the one place every path goes through — the
     preview, the offline exporter and the real-time recorder all take their
     sound from this function, so a mix that clips cannot reach any of them
     without having been counted first. */
  const chans = [];
  for (let c = 0; c < mixed.numberOfChannels; c++) chans.push(mixed.getChannelData(c));
  const peak = peakLevel(chans);
  log('Audio: ' + rendered.length + ' source(s) mixed over '
      + (base ? 'the sequence bed' : 'silence') + ', ' + nch + 'ch, peak ' + peakLabel(peak) + '.',
      isClipping(peak) ? 'warn' : 'info');
  if (isClipping(peak)) {
    log('Audio: the mix reaches full scale, so the encoder will clamp it — '
        + 'pull a gain down or fade something.', 'warn');
  }
  mixed.__peak = peak;
  return mixed;
}

/**
 * The part of `buf` that runs from `from` for `seconds`, as its own buffer.
 *
 * What the batch exporter needs to stop lying. It exports each clip as its own
 * file and could only give each one the clip's OWN bed — so the sequence bed,
 * the audio lane and a clip's footage sound were all absent, and the note in
 * the panel said so rather than fixing it. A slice of the finished sequence mix
 * is the honest answer: whatever that clip would have sounded like in the
 * sequence, it sounds like on its own.
 *
 * The output is always `seconds` long even when the mix runs out first — the
 * tail is silence rather than a short file, because a clip that ends before its
 * own picture does is a muxing problem nobody wants.
 */
export function sliceBuffer(buf, from, seconds) {
  if (!buf || !(seconds > 0)) return null;
  const rate = buf.sampleRate;
  const start = Math.max(0, Math.round(Math.max(0, from) * rate));
  const len = Math.max(1, Math.round(seconds * rate));
  if (start >= buf.length) return null;       // none of the sequence lands here
  const take = Math.min(len, buf.length - start);
  const nch = buf.numberOfChannels;
  let out = null;
  try {
    out = new (window.AudioBuffer)({ length: len, numberOfChannels: nch, sampleRate: rate });
  } catch {
    // Older engines have no AudioBuffer constructor; an offline context still
    // makes one, and this path costs nothing when the constructor exists.
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return null;
    try { out = new OAC(nch, len, rate).createBuffer(nch, len, rate); } catch { return null; }
  }
  for (let c = 0; c < nch; c++) {
    out.copyToChannel(buf.getChannelData(c).subarray(start, start + take), c, 0);
  }
  return out;
}
