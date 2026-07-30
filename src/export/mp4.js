/* Dead Signal Studio — export/mp4.js
 *
 * A hand-written ISO BMFF (MP4) muxer, the counterpart to export/webm.js.
 *
 * WebM plays everywhere a browser does, and nowhere else reliably: dropped into
 * a video editor, a phone's camera roll, a social upload or QuickTime it is a
 * coin toss. That is the entire reason `scripts/gen-campaign-media.py` exists as
 * an ffmpeg shim. WebCodecs already encodes H.264 and AAC — the only missing
 * piece was somewhere to put them.
 *
 * ---------------------------------------------------------------- the shape --
 *
 *   ftyp     what this file claims to be
 *   moov     the index: one trak per stream, each with a sample table
 *   mdat     the actual bytes
 *
 * moov is written BEFORE mdat. It has to be, for a file anyone might stream, and
 * it costs nothing here because the encode is finished before muxing starts — we
 * know every sample size up front. The catch is that the sample table stores
 * absolute file offsets, which depend on how big moov is, which depends on the
 * table. Resolved by building moov twice: once to measure, once for real. Every
 * field is fixed width, so the second pass is the same size as the first — this
 * is exact, not a fixed point we iterate toward.
 *
 * ------------------------------------------------------------ no B-frames ----
 *
 * An EncodedVideoChunk carries a presentation timestamp and no decode timestamp.
 * With B-frames the two differ and the file needs a `ctts` table to express it —
 * which cannot be built from data we do not have. Chrome's H.264 encoders emit
 * IPPP for the configurations used here, so `muxMP4` asserts it instead of
 * guessing: chunks arriving out of presentation order throw, and the caller
 * falls back to WebM rather than writing a file that plays backwards in places.
 */

/* ------------------------------------------------------------- writing --- */

const u8 = (...v) => new Uint8Array(v);
const str = (s) => new TextEncoder().encode(s);

function u16(n) { return u8((n >> 8) & 255, n & 255); }
function u32(n) {
  return u8((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}
function u64(n) {
  const hi = Math.floor(n / 2 ** 32), lo = n >>> 0;
  return concat(u32(hi), u32(lo));
}

/* ARRAY IN, NOT SPREAD, for anything with one entry PER SAMPLE.
 *
 * These were all varargs, and the sample tables spread a per-frame array into
 * them: `fullBox('stsz', 0, 0, u32(0), u32(n), ...samples.map(...))`, and
 * `box('mdat', ...payload)` with one entry per frame. An argument list is
 * stack-allocated, so past a few tens of thousands of entries the spread throws
 * `RangeError` — after a full encode, which is minutes of an author's time, and
 * the caller then fell back to WebM having thrown the MP4 away. It is not a
 * limit anybody chose: 30fps for a quarter of an hour is enough to reach it, and
 * the tool's own clip cap is longer than that.
 *
 * The list forms take an array and iterate it, so the only bound left is memory.
 * The varargs forms stay for the dozens of fixed-shape boxes that read better
 * that way — they are bounded by the code, not by the clip. */
function concatList(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
function concat(...parts) { return concatList(parts); }

/** A box: 4-byte size, 4-char type, payload. */
function boxList(type, payload) {
  const body = concatList(payload);
  return concat(u32(body.length + 8), str(type), body);
}
function box(type, ...payload) { return boxList(type, payload); }
/** A full box: version and flags before the payload. */
function fullBoxList(type, version, flags, payload) {
  const head = u8(version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255);
  return boxList(type, [head].concat(payload));
}
function fullBox(type, version, flags, ...payload) {
  return fullBoxList(type, version, flags, payload);
}

/* MP4 dates count from 1904, not 1970. Fixed rather than "now" so the same
   project produces byte-identical output twice — the determinism the whole tool
   rests on would otherwise stop at the container. */
const EPOCH_1904 = 0;

/* ------------------------------------------------------------- tables ---- */

/**
 * Group a track's samples into chunks of roughly one second.
 *
 * One chunk per sample would make stco enormous; one chunk per track would put
 * all the video before all the audio, so a player has to seek the whole file to
 * keep them together. A second is what every real muxer settles on.
 */
function chunkify(samples, timescale) {
  const chunks = [];
  let cur = null;
  for (const s of samples) {
    if (!cur || s.dts - cur.startDts >= timescale) {
      cur = { startDts: s.dts, samples: [] };
      chunks.push(cur);
    }
    cur.samples.push(s);
  }
  return chunks;
}

/** stts: run-length encoded sample durations. */
function stts(samples) {
  const runs = [];
  for (const s of samples) {
    const last = runs[runs.length - 1];
    if (last && last.delta === s.duration) last.count++;
    else runs.push({ count: 1, delta: s.duration });
  }
  return fullBoxList('stts', 0, 0,
    [u32(runs.length)].concat(runs.map((r) => concat(u32(r.count), u32(r.delta)))));
}

/** stsc: how many samples are in each chunk, run-length encoded. */
function stsc(chunks) {
  const runs = [];
  chunks.forEach((c, i) => {
    const n = c.samples.length;
    const last = runs[runs.length - 1];
    if (!last || last.n !== n) runs.push({ first: i + 1, n });
  });
  return fullBoxList('stsc', 0, 0,
    [u32(runs.length)].concat(runs.map((r) => concat(u32(r.first), u32(r.n), u32(1)))));
}

function stsz(samples) {
  return fullBoxList('stsz', 0, 0,
    [u32(0), u32(samples.length)].concat(samples.map((s) => u32(s.data.length))));
}

/* 64-bit offsets always. stco would be four bytes smaller per chunk and would
   need promoting to co64 the moment a file passed 4GB — and since moov is sized
   before the offsets are known, a table that changed width would break the
   two-pass write. Fixed width is the property that makes this exact. */
function co64(offsets) {
  return fullBoxList('co64', 0, 0, [u32(offsets.length)].concat(offsets.map(u64)));
}

/** stss: which samples are sync samples. Omitted when they all are. */
function stss(samples) {
  const keys = [];
  samples.forEach((s, i) => { if (s.key) keys.push(i + 1); });
  if (keys.length === samples.length) return new Uint8Array(0);
  return fullBoxList('stss', 0, 0, [u32(keys.length)].concat(keys.map(u32)));
}

/* --------------------------------------------------------- descriptions -- */

/** avc1 sample entry, carrying the avcC the decoder needs. */
function avc1(width, height, avcC) {
  const name = new Uint8Array(32);        // compressorname: length-prefixed, padded
  return box('avc1',
    new Uint8Array(6), u16(1),            // reserved, data_reference_index
    u16(0), u16(0), new Uint8Array(12),   // pre_defined, reserved
    u16(width), u16(height),
    u32(0x00480000), u32(0x00480000),     // 72dpi
    u32(0), u16(1),                       // reserved, frame_count
    name,
    u16(0x0018), u16(0xffff),             // depth, pre_defined = -1
    box('avcC', avcC));
}

/**
 * mp4a sample entry with its esds.
 *
 * The descriptor nesting is the fiddly part and is why so many hand-rolled
 * muxers get AAC wrong: ES_Descriptor wraps a DecoderConfigDescriptor which
 * wraps the DecoderSpecificInfo (the AudioSpecificConfig the encoder handed us),
 * and an SLConfigDescriptor has to be there even though it says nothing.
 */
function mp4a(channels, sampleRate, asc) {
  /* Descriptor lengths use a 7-bit-per-byte varint. Written in the 4-byte
     always-extended form so a length crossing 127 does not change the size of
     the box around it. */
  const len = (n) => u8(0x80 | ((n >> 21) & 0x7f), 0x80 | ((n >> 14) & 0x7f),
    0x80 | ((n >> 7) & 0x7f), n & 0x7f);
  const dsi = asc && asc.length ? concat(u8(0x05), len(asc.length), asc) : new Uint8Array(0);
  const dcd = concat(u8(0x04), len(13 + dsi.length),
    u8(0x40, 0x15),                       // AAC LC, audio stream
    u8(0, 0, 0),                          // buffer size
    u32(0), u32(0),                       // max/avg bitrate: 0 = unknown
    dsi);
  const sl = concat(u8(0x06), len(1), u8(0x02));
  const es = concat(u8(0x03), len(3 + dcd.length + sl.length),
    u16(1), u8(0), dcd, sl);
  return box('mp4a',
    new Uint8Array(6), u16(1),
    u32(0), u32(0),
    u16(channels), u16(16),
    u16(0), u16(0),
    u32(sampleRate << 16),                // 16.16 fixed point
    fullBox('esds', 0, 0, es));
}

/* -------------------------------------------------------------- tracks --- */

const UNITY_MATRIX = concat(
  u32(0x00010000), u32(0), u32(0),
  u32(0), u32(0x00010000), u32(0),
  u32(0), u32(0), u32(0x40000000));

function trak(t, offsets) {
  const dur = t.samples.reduce((n, s) => n + s.duration, 0);
  const tkhd = fullBox('tkhd', 0, 3,      // enabled | in movie
    u32(EPOCH_1904), u32(EPOCH_1904), u32(t.id), u32(0),
    u32(Math.round((dur / t.timescale) * 1000)),   // in MOVIE timescale (1000)
    new Uint8Array(8), u16(0), u16(0),
    u16(t.kind === 'audio' ? 0x0100 : 0), u16(0),  // volume
    UNITY_MATRIX,
    u32((t.width || 0) << 16), u32((t.height || 0) << 16));

  const mdhd = fullBox('mdhd', 0, 0,
    u32(EPOCH_1904), u32(EPOCH_1904), u32(t.timescale), u32(dur),
    u16(0x55c4), u16(0));                 // language 'und'

  const hdlr = fullBox('hdlr', 0, 0,
    u32(0), str(t.kind === 'audio' ? 'soun' : 'vide'), new Uint8Array(12),
    str(t.kind === 'audio' ? 'SoundHandler' : 'VideoHandler'), u8(0));

  const header = t.kind === 'audio'
    ? fullBox('smhd', 0, 0, u16(0), u16(0))
    : fullBox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0));

  const dinf = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)));

  const stsd = fullBox('stsd', 0, 0, u32(1),
    t.kind === 'audio' ? mp4a(t.channels, t.timescale, t.description)
      : avc1(t.width, t.height, t.description));

  const stbl = box('stbl', stsd, stts(t.samples), stss(t.samples),
    stsc(t.chunks), stsz(t.samples), co64(offsets));

  return box('trak', tkhd,
    box('mdia', mdhd, hdlr, box('minf', header, dinf, stbl)));
}

/* ---------------------------------------------------------------- mux ---- */

/**
 * Mux H.264 (and optionally AAC) into an MP4.
 *
 * @param {object}   opts
 * @param {Array}    opts.frames        [{ data, timestampUs, durationUs, key }]
 * @param {number}   opts.width
 * @param {number}   opts.height
 * @param {Uint8Array} opts.description avcC from the encoder's decoderConfig
 * @param {object}   [opts.audio]       { frames, description, sampleRate, channels }
 * @returns {Blob}
 * @throws when the video chunks are not in presentation order — see the header.
 */
export function muxMP4({ frames, width, height, description, audio }) {
  if (!frames || !frames.length) throw new Error('nothing to mux');
  if (!description || !description.length) {
    throw new Error('no avcC — the encoder gave no decoder description');
  }
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].timestampUs < frames[i - 1].timestampUs) {
      throw new Error('video chunks are out of presentation order (B-frames) — cannot mux without DTS');
    }
  }

  /* Microseconds as the video timescale, so a duration is stored exactly as the
     encoder reported it. A 90kHz timescale is more conventional and would round
     every frame at any fps that is not a factor of 90000. */
  const VIDEO_TS = 1_000_000;
  const video = {
    id: 1, kind: 'video', timescale: VIDEO_TS, width, height, description,
    samples: frames.map((f, i) => ({
      data: f.data, key: !!f.key,
      dts: f.timestampUs,
      // The last frame has no successor to measure against, so it keeps the
      // duration the encoder gave it.
      duration: i + 1 < frames.length
        ? Math.max(1, frames[i + 1].timestampUs - f.timestampUs)
        : Math.max(1, f.durationUs || Math.round(VIDEO_TS / 30)),
    })),
  };

  const tracks = [video];
  if (audio && audio.frames && audio.frames.length) {
    /* The audio timescale is the sample rate, so an AAC frame is exactly 1024
       ticks — no rounding at all, which is what keeps a long clip in sync. */
    const rate = audio.sampleRate || 48000;
    let dts = 0;
    tracks.push({
      id: 2, kind: 'audio', timescale: rate, channels: audio.channels || 2,
      description: audio.description,
      samples: audio.frames.map((f) => {
        const n = Math.max(1, Math.round(((f.durationUs || 0) / 1e6) * rate) || 1024);
        const s = { data: f.data, key: true, dts, duration: n };
        dts += n;
        return s;
      }),
    });
  }

  for (const t of tracks) t.chunks = chunkify(t.samples, t.timescale);

  /* Chunks from every track, in time order — so a player reading forward always
     has the audio for the picture it just decoded. */
  const interleaved = [];
  for (const t of tracks) {
    for (const c of t.chunks) interleaved.push({ t, c, at: c.startDts / t.timescale });
  }
  interleaved.sort((a, b) => a.at - b.at);

  const movieDur = Math.max(...tracks.map(
    (t) => t.samples.reduce((n, s) => n + s.duration, 0) / t.timescale));
  const mvhd = fullBox('mvhd', 0, 0,
    u32(EPOCH_1904), u32(EPOCH_1904), u32(1000), u32(Math.round(movieDur * 1000)),
    u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0),
    UNITY_MATRIX, new Uint8Array(24), u32(tracks.length + 1));

  const ftyp = box('ftyp', str('isom'), u32(0x200), str('isom'), str('iso2'), str('avc1'), str('mp41'));

  /* Two passes. The first learns how big moov is with placeholder offsets; the
     second writes the real ones. Every field is fixed width, so the second moov
     is byte-for-byte the same size as the first — this is exact rather than a
     fixed point to iterate toward. */
  const build = (offsetsByTrack) => box('moov', mvhd,
    ...tracks.map((t) => trak(t, offsetsByTrack.get(t))));
  const zeros = new Map(tracks.map((t) => [t, t.chunks.map(() => 0)]));
  const moovSize = build(zeros).length;

  const mdatStart = ftyp.length + moovSize + 8;   // + mdat's own header
  const offsets = new Map(tracks.map((t) => [t, []]));
  let at = mdatStart;
  const payload = [];
  for (const { t, c } of interleaved) {
    offsets.get(t).push(at);
    for (const s of c.samples) { payload.push(s.data); at += s.data.length; }
  }

  const moov = build(offsets);
  if (moov.length !== moovSize) {
    // Cannot happen with fixed-width fields; if it ever does, a silently
    // corrupt index is far worse than a failed export.
    throw new Error(`moov size changed between passes (${moovSize} -> ${moov.length})`);
  }
  const mdat = boxList('mdat', payload);
  return new Blob([ftyp, moov, mdat], { type: 'video/mp4' });
}

/** Whether a codec string is one this muxer can carry. */
export const mp4CanCarry = (codec) => typeof codec === 'string' && codec.startsWith('avc1');
