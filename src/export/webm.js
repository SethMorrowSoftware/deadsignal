/* Dead Signal Studio — export/webm.js
 *
 * A minimal WebM (Matroska/EBML) muxer for the frames WebCodecs gives us.
 *
 * WebCodecs hands back encoded chunks with no container; something has to wrap
 * them, and pulling in a muxing library would be the first runtime dependency
 * this repo has ever had. The subset WebM actually needs for a single video
 * track is small and completely specified, so it is written out here.
 *
 * Everything is buffered and sized exactly rather than streamed with unknown
 * lengths — clips here are seconds long, and exact sizes produce a file that
 * seeks properly in every player.
 */

/* ---- EBML primitives ----------------------------------------------------- */

/** Variable-length integer: 1-8 bytes, leading marker bit gives the length. */
function vint(value, minBytes = 1) {
  let len = minBytes;
  while (len < 8 && value >= 2 ** (7 * len) - 1) len++;
  const out = new Uint8Array(len);
  let v = value;
  for (let i = len - 1; i >= 0; i--) { out[i] = v & 0xFF; v = Math.floor(v / 256); }
  out[0] |= 1 << (8 - len);                 // length marker
  return out;
}

/** Unsigned integer in as few bytes as possible (at least 1). */
function uint(value) {
  const bytes = [];
  let v = Math.max(0, Math.floor(value));
  do { bytes.unshift(v & 0xFF); v = Math.floor(v / 256); } while (v > 0);
  return new Uint8Array(bytes);
}

function f64(value) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, value, false);
  return b;
}

const idBytes = (id) => {
  const bytes = [];
  let v = id;
  do { bytes.unshift(v & 0xFF); v = Math.floor(v / 256); } while (v > 0);
  return new Uint8Array(bytes);
};

const concat = (parts) => {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/** One EBML element: id + size + payload. */
function el(id, payload) {
  const data = payload instanceof Uint8Array ? payload : concat(payload);
  return concat([idBytes(id), vint(data.length), data]);
}

/* ---- element ids --------------------------------------------------------- */
const ID = {
  EBML: 0x1A45DFA3, EBMLVersion: 0x4286, EBMLReadVersion: 0x42F7,
  EBMLMaxIDLength: 0x42F2, EBMLMaxSizeLength: 0x42F3,
  DocType: 0x4282, DocTypeVersion: 0x4287, DocTypeReadVersion: 0x4285,
  Segment: 0x18538067,
  Info: 0x1549A966, TimecodeScale: 0x2AD7B1, MuxingApp: 0x4D80,
  WritingApp: 0x5741, Duration: 0x4489,
  Tracks: 0x1654AE6B, TrackEntry: 0xAE, TrackNumber: 0xD7, TrackUID: 0x73C5,
  TrackType: 0x83, CodecID: 0x86, CodecPrivate: 0x63A2, FlagLacing: 0x9C,
  Video: 0xE0, PixelWidth: 0xB0, PixelHeight: 0xBA,
  Audio: 0xE1, SamplingFrequency: 0xB5, Channels: 0x9F,
  CodecDelay: 0x56AA, SeekPreRoll: 0x56BB,
  Cluster: 0x1F43B675, Timecode: 0xE7, SimpleBlock: 0xA3,
};

export const VIDEO_TRACK = 1;
export const AUDIO_TRACK = 2;
/* Opus asks players to decode this much before a seek point before trusting the
   output. 80ms is the value the WebM/Opus mapping specifies; getting it wrong
   makes a seek start with a moment of noise. */
const SEEK_PRE_ROLL_NS = 80_000_000;
/* libopus' own lookahead, in 48kHz samples. Only used when the encoder does not
   hand back a description of its own — a real one always does, and its pre-skip
   is authoritative because it is what that encoder actually delayed by. */
const DEFAULT_PRE_SKIP = 312;

/**
 * The OpusHead identification header, which is what CodecPrivate holds for an
 * Opus track. Synthesised only as a fallback; when WebCodecs supplies
 * `decoderConfig.description` that is used instead, since it describes the
 * encoder that actually produced these packets.
 */
export function opusHead(channels, sampleRate, preSkip = DEFAULT_PRE_SKIP) {
  const b = new Uint8Array(19);
  const dv = new DataView(b.buffer);
  b.set(str('OpusHead'), 0);
  b[8] = 1;                              // version
  b[9] = channels;
  dv.setUint16(10, preSkip, true);
  dv.setUint32(12, sampleRate, true);
  dv.setUint16(16, 0, true);             // output gain
  b[18] = 0;                             // channel mapping family
  return b;
}

/** Pre-skip out of an OpusHead, so CodecDelay matches the packets. */
function preSkipOf(head) {
  if (!head || head.length < 12) return DEFAULT_PRE_SKIP;
  return new DataView(head.buffer, head.byteOffset, head.byteLength).getUint16(10, true);
}

const str = (s) => new TextEncoder().encode(s);

/** WebCodecs codec string -> Matroska CodecID. */
export function codecIdFor(codec) {
  const c = String(codec || '').toLowerCase();
  if (c.startsWith('vp8')) return 'V_VP8';
  if (c.startsWith('vp09') || c.startsWith('vp9')) return 'V_VP9';
  if (c.startsWith('av01') || c.startsWith('av1')) return 'V_AV1';
  return null;                                     // caller must not mux this
}

/**
 * Mux encoded video chunks into a WebM blob.
 *
 * @param {object}  opts
 * @param {Array<{data:Uint8Array, timestampUs:number, key:boolean}>} opts.frames
 * @param {number}  opts.width
 * @param {number}  opts.height
 * @param {string}  opts.codec            WebCodecs codec string
 * @param {Uint8Array} [opts.description] CodecPrivate, when the encoder gives one
 * @returns {Blob}
 */
export function muxWebM({ frames, width, height, codec, description, audio }) {
  const codecId = codecIdFor(codec);
  if (!codecId) throw new Error(`cannot mux codec "${codec}" into WebM`);
  if (!frames.length) throw new Error('no frames to mux');
  const withAudio = !!(audio && audio.frames && audio.frames.length);

  const header = el(ID.EBML, [
    el(ID.EBMLVersion, uint(1)),
    el(ID.EBMLReadVersion, uint(1)),
    el(ID.EBMLMaxIDLength, uint(4)),
    el(ID.EBMLMaxSizeLength, uint(8)),
    el(ID.DocType, str('webm')),
    el(ID.DocTypeVersion, uint(2)),
    el(ID.DocTypeReadVersion, uint(2)),
  ]);

  // Timecodes are milliseconds (TimecodeScale 1e6 ns).
  const msOf = (us) => Math.max(0, Math.round(us / 1000));
  const endOf = (list) => msOf(list.at(-1).timestampUs)
    + Math.max(1, msOf(list.at(-1).durationUs ?? 0));
  const durationMs = withAudio ? Math.max(endOf(frames), endOf(audio.frames)) : endOf(frames);

  const info = el(ID.Info, [
    el(ID.TimecodeScale, uint(1_000_000)),
    el(ID.MuxingApp, str('Dead Signal Studio')),
    el(ID.WritingApp, str('Dead Signal Studio')),
    el(ID.Duration, f64(durationMs)),
  ]);

  const trackParts = [
    el(ID.TrackNumber, uint(VIDEO_TRACK)),
    el(ID.TrackUID, uint(VIDEO_TRACK)),
    el(ID.TrackType, uint(1)),          // 1 = video
    el(ID.FlagLacing, uint(0)),
    el(ID.CodecID, str(codecId)),
  ];
  if (description && description.length) trackParts.push(el(ID.CodecPrivate, description));
  trackParts.push(el(ID.Video, [
    el(ID.PixelWidth, uint(width)),
    el(ID.PixelHeight, uint(height)),
  ]));

  const trackEntries = [el(ID.TrackEntry, trackParts)];

  if (withAudio) {
    const channels = audio.channels || 2;
    const rate = audio.sampleRate || 48000;
    const head = audio.description && audio.description.length
      ? audio.description
      : opusHead(channels, rate);
    // CodecDelay is the encoder's own lookahead expressed in nanoseconds. A
    // player subtracts it, which is what stops the track starting a few
    // milliseconds late relative to the picture.
    const delayNs = Math.round(preSkipOf(head) / 48000 * 1e9);
    trackEntries.push(el(ID.TrackEntry, [
      el(ID.TrackNumber, uint(AUDIO_TRACK)),
      el(ID.TrackUID, uint(AUDIO_TRACK)),
      el(ID.TrackType, uint(2)),        // 2 = audio
      el(ID.FlagLacing, uint(0)),
      el(ID.CodecID, str('A_OPUS')),
      el(ID.CodecPrivate, head),
      el(ID.CodecDelay, uint(delayNs)),
      el(ID.SeekPreRoll, uint(SEEK_PRE_ROLL_NS)),
      el(ID.Audio, [
        el(ID.SamplingFrequency, f64(rate)),
        el(ID.Channels, uint(channels)),
      ]),
    ]));
  }
  const tracks = el(ID.Tracks, trackEntries);

  /* One ordered stream of blocks across both tracks.
   *
   * Matroska requires a cluster's blocks to be in timecode order, and a player
   * that has to seek backwards inside a cluster to find the audio for a frame
   * it already showed will stutter or drop it. Sorting once here is what makes
   * "interleaved" true rather than aspirational. Ties go to video, so a
   * keyframe always opens the cluster it belongs to.
   */
  const blocks = frames.map((f) => ({
    track: VIDEO_TRACK, ms: msOf(f.timestampUs), data: f.data, key: !!f.key,
  }));
  if (withAudio) {
    for (const a of audio.frames) {
      // Every Opus packet is independently decodable, so they are all keyframes.
      blocks.push({ track: AUDIO_TRACK, ms: msOf(a.timestampUs), data: a.data, key: true });
    }
    blocks.sort((x, y) => x.ms - y.ms || x.track - y.track);
  }

  /* Clusters. A SimpleBlock's timecode is a SIGNED 16-BIT offset from its
     cluster, so a new cluster is needed before that can overflow — and
     starting one at each VIDEO keyframe is what makes the result seekable.
     An audio packet never opens a cluster: a cluster that began on one would
     have no keyframe to seek to. */
  const clusters = [];
  let current = null;
  const flush = () => { if (current && current.blocks.length) clusters.push(current); };

  for (const b of blocks) {
    const opens = b.track === VIDEO_TRACK && b.key;
    if (!current || (opens && b.ms - current.timecode > 0) || b.ms - current.timecode > 30_000) {
      flush();
      current = { timecode: b.ms, blocks: [] };
    }
    const rel = b.ms - current.timecode;
    const head = new Uint8Array(4);
    head[0] = 0x80 | b.track;                        // track number, as a vint
    new DataView(head.buffer).setInt16(1, rel, false);
    head[3] = b.key ? 0x80 : 0x00;                   // keyframe flag
    current.blocks.push(el(ID.SimpleBlock, concat([head, b.data])));
  }
  flush();

  const clusterEls = clusters.map((c) =>
    el(ID.Cluster, [el(ID.Timecode, uint(c.timecode)), ...c.blocks]));

  const segment = el(ID.Segment, [info, tracks, ...clusterEls]);
  return new Blob([header, segment], { type: 'video/webm' });
}
