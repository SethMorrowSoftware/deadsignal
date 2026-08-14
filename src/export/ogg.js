/* Dead Signal Studio — export/ogg.js
 *
 * A hand-written Ogg Opus muxer (RFC 3533 pages, RFC 7845 mapping) — the third
 * container beside export/webm.js and export/mp4.js, and by far the smallest.
 *
 * Why it exists: the AUDIO tab rendered `.wav` and nothing else. A WAV is the
 * right master and the wrong delivery — ten seconds of 48kHz stereo is 1.9 MB
 * nobody uploads. WebCodecs already encodes Opus (it is what the WebM export
 * muxes beside the picture); the only missing piece was a container that means
 * "just the sound". Ogg is that container: open, seekable, and played by every
 * current browser, Discord, VLC and ffmpeg.
 *
 * ------------------------------------------------------------- the shape ----
 *
 *   page 0   OpusHead    BOS flag — who this stream is
 *   page 1   OpusTags    the mandatory comment header
 *   pages…   audio       ~1s of packets per page; the last carries EOS
 *
 * A page is: "OggS", version, type flags, granule position (64-bit LE),
 * serial, sequence number, CRC, then a lacing table saying how the payload
 * splits back into packets. Everything is little-endian — the opposite of the
 * MP4 muxer next door, and the first thing to suspect if a hex dump looks odd.
 *
 * The granule position is the count of 48kHz PCM samples decoded up to and
 * including the last packet completed on the page. It INCLUDES the encoder's
 * pre-skip priming (players subtract the OpusHead pre-skip themselves), so it
 * is a plain running sum of each packet's samples — no trimming maths here.
 *
 * Determinism: no wall-clock anywhere — fixed vendor string, fixed serial. The
 * same render muxes to byte-identical files, which is the property the whole
 * tool rests on and the document suite asserts for all three containers.
 */

import { opusHead } from './webm.js';

const str = (s) => new TextEncoder().encode(s);

/* The Ogg page CRC: polynomial 0x04C11DB7, NOT reflected, zero initial value,
   zero final XOR — a different animal from the reflected PNG/zlib CRC in
   export/anim.js, which is why sharing a table with it would be wrong. */
let _crcTable = null;
function crcTable() {
  if (_crcTable) return _crcTable;
  _crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let r = n << 24;
    for (let k = 0; k < 8; k++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
    _crcTable[n] = r >>> 0;
  }
  return _crcTable;
}
function oggCrc(bytes) {
  const t = crcTable();
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    crc = (((crc << 8) >>> 0) ^ t[((crc >>> 24) ^ bytes[i]) & 255]) >>> 0;
  }
  return crc >>> 0;
}

/* Fixed, so two muxes of the same packets are the same bytes. Uniqueness only
   matters between concurrent streams in ONE physical file, and this writer
   never produces more than one. */
const SERIAL = 0x44534947;                     // 'DSIG'

/** Lacing values for one packet: 255s then the remainder (0 when it divides). */
function lacingOf(len) {
  const out = [];
  let n = len;
  while (n >= 255) { out.push(255); n -= 255; }
  out.push(n);                                 // 0 terminates an exact multiple
  return out;
}

/**
 * One finished page.
 * @param {number} type      1=continued, 2=BOS, 4=EOS (OR of flags)
 * @param {number} granule   48kHz sample count through this page (-1 = none)
 * @param {number} seq       page sequence number
 * @param {Array<Uint8Array>} packets  whole packets — this writer never spans
 */
function page(type, granule, seq, packets) {
  const lacing = [];
  let payloadLen = 0;
  for (const p of packets) { lacing.push(...lacingOf(p.length)); payloadLen += p.length; }
  if (lacing.length > 255) throw new Error('Ogg page overflow — flush before adding');
  const head = new Uint8Array(27 + lacing.length);
  const dv = new DataView(head.buffer);
  head.set(str('OggS'), 0);
  head[4] = 0;                                 // stream structure version
  head[5] = type;
  /* A 64-bit LE granule. Sample counts stay far inside 2^53, so Number is
     exact; -1 (a page with no completed packet) never occurs here because a
     packet never spans pages. */
  dv.setUint32(6, granule >>> 0, true);
  dv.setUint32(10, Math.floor(granule / 2 ** 32), true);
  dv.setUint32(14, SERIAL, true);
  dv.setUint32(18, seq, true);
  dv.setUint32(22, 0, true);                   // CRC — patched below
  head[26] = lacing.length;
  head.set(lacing, 27);

  const whole = new Uint8Array(head.length + payloadLen);
  whole.set(head, 0);
  let at = head.length;
  for (const p of packets) { whole.set(p, at); at += p.length; }
  const dv2 = new DataView(whole.buffer);
  dv2.setUint32(22, oggCrc(whole), true);      // CRC over the page with field 0
  return whole;
}

/** The mandatory comment header. Fixed vendor, no comments — deterministic. */
function opusTags() {
  const vendor = str('dead-signal-studio');
  const b = new Uint8Array(8 + 4 + vendor.length + 4);
  const dv = new DataView(b.buffer);
  b.set(str('OpusTags'), 0);
  dv.setUint32(8, vendor.length, true);
  b.set(vendor, 12);
  dv.setUint32(12 + vendor.length, 0, true);   // user comment count
  return b;
}

/* Flush a page once it holds about a second. Opus grants 65025 bytes per page
   (255 lacing values), so the real bound is the lacing table; one second of
   20ms packets is 50 packets ≈ 100 lacing values at speech-music bitrates,
   comfortably inside it. A single packet always fits alone: Opus caps a packet
   at 61440 bytes = 241 lacing values. */
const PAGE_SAMPLES = 48000;

/**
 * Mux encoded Opus packets into an Ogg Opus blob.
 *
 * @param {object} opts
 * @param {Array<{data:Uint8Array, durationUs:number}>} opts.frames
 *   encodeAudioTrack()'s output: packets in decode order.
 * @param {Uint8Array} [opts.description] OpusHead from the encoder, when given.
 * @param {number} [opts.channels]        used only for a synthesised head.
 * @param {number} [opts.sampleRate]      input rate for the head (48000 here).
 * @returns {Blob} 'audio/ogg'
 */
export function muxOggOpus({ frames, description, channels = 2, sampleRate = 48000 }) {
  if (!frames || !frames.length) throw new Error('nothing to mux');
  /* The encoder's own head is authoritative — its pre-skip is what that
     encoder actually delayed by. Synthesised only when absent. */
  const head = (description && description.length >= 19)
    ? (description instanceof Uint8Array ? description : new Uint8Array(description))
    : opusHead(channels, sampleRate);

  const pages = [
    page(0x02, 0, 0, [head]),                  // BOS
    page(0x00, 0, 1, [opusTags()]),
  ];

  let seq = 2;
  let granule = 0;                             // running 48kHz sample count
  let cur = [];                                // packets on the open page
  let curLacing = 0;
  let curStartGranule = 0;
  const flush = (eos) => {
    if (!cur.length) return;
    pages.push(page(eos ? 0x04 : 0x00, granule, seq++, cur));
    cur = []; curLacing = 0; curStartGranule = granule;
  };
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
    const lace = lacingOf(data.length).length;
    if (cur.length && (curLacing + lace > 255 || granule - curStartGranule >= PAGE_SAMPLES)) flush(false);
    cur.push(data);
    curLacing += lace;
    /* Samples per packet from the duration the encoder reported; 20ms is the
       WebCodecs Opus default and the same fallback encodeAudioTrack uses. */
    granule += Math.max(1, Math.round(((f.durationUs || 20000) / 1e6) * 48000));
  }
  /* The loop leaves at least the final packet on the open page — an overflow
     flush is always followed by a push — so this last flush is never empty and
     the EOS flag always lands on a real page. */
  flush(true);
  return new Blob(pages, { type: 'audio/ogg' });
}
