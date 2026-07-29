/* Dead Signal Studio — export/anim.js
 *
 * Animated stills: APNG and animated WebP.
 *
 * The tool already writes an animated GIF, and GIF is the wrong format for
 * almost everything it is used for — 256 colours, one bit of transparency, and
 * a dithered mess out of anything with a gradient in it. It survives because it
 * plays absolutely everywhere. These two are what you actually want when the
 * target can take them:
 *
 *   APNG   lossless, 24-bit, real alpha. Plays in every current browser, in
 *          iMessage and in Discord. Large — this is the archival one.
 *   WebP   an order of magnitude smaller than either, 24-bit, real alpha.
 *          Plays in every current browser. The one to upload.
 *
 * Neither needs a new encoder: APNG is PNG chunks around zlib streams that
 * `CompressionStream` produces natively, and animated WebP is a container
 * around the VP8 payloads `canvas.toBlob('image/webp')` already makes. What was
 * missing in both cases was the muxing.
 */

/* ---------------------------------------------------------------- shared -- */

const u8 = (...v) => new Uint8Array(v);
const be32 = (n) => u8((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const be16 = (n) => u8((n >> 8) & 255, n & 255);
const le16 = (n) => u8(n & 255, (n >> 8) & 255);
const le24 = (n) => u8(n & 255, (n >> 8) & 255, (n >> 16) & 255);
const le32 = (n) => u8(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255);
const ascii = (s) => new TextEncoder().encode(s);

function concat(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/* --------------------------------------------------------------- APNG ---- */

/* CRC32, table-driven. Every PNG chunk carries one, and a wrong CRC is the
   difference between a file and a file every decoder refuses. */
let _crcTable = null;
function crcTable() {
  if (_crcTable) return _crcTable;
  _crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    _crcTable[n] = c >>> 0;
  }
  return _crcTable;
}
function crc32(bytes) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A PNG chunk: length, type, data, CRC over type+data. */
function chunk(type, data = new Uint8Array(0)) {
  const td = concat(ascii(type), data);
  return concat(be32(data.length), td, be32(crc32(td)));
}

/**
 * zlib-compress, using the platform rather than a bundled deflate.
 *
 * PNG wants a zlib stream (RFC 1950), which is what CompressionStream('deflate')
 * produces — 'deflate-raw' would be the bare deflate blocks and every decoder
 * would reject the file. Falls back to a stored (uncompressed) zlib stream when
 * CompressionStream is missing, because a large correct APNG beats no APNG.
 */
async function zlib(bytes) {
  if (typeof CompressionStream === 'function') {
    const cs = new CompressionStream('deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return storedZlib(bytes);
}

/** A valid zlib stream that compresses nothing. The fallback, never the path. */
function storedZlib(bytes) {
  const parts = [u8(0x78, 0x01)];                 // CMF/FLG for a stored stream
  const MAX = 65535;
  for (let at = 0; at < bytes.length || at === 0; at += MAX) {
    const n = Math.min(MAX, bytes.length - at);
    const last = at + n >= bytes.length ? 1 : 0;
    parts.push(u8(last), le16(n), le16(~n & 0xffff), bytes.subarray(at, at + n));
    if (n === 0) break;
  }
  // Adler-32 of the uncompressed data closes a zlib stream.
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
  parts.push(be32(((b << 16) | a) >>> 0));
  return concat(...parts);
}

/** RGBA rows, each prefixed with a filter byte. Filter 0 (None) throughout. */
function rawScanlines(rgba, w, h) {
  const out = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const src = y * w * 4, dst = y * (1 + w * 4);
    out[dst] = 0;
    out.set(rgba.subarray(src, src + w * 4), dst + 1);
  }
  return out;
}

/**
 * Encode canvases as an APNG.
 *
 * @param {HTMLCanvasElement[]} canvases  every frame, all the same size
 * @param {object} [opts]
 * @param {number} [opts.delayMs]  per frame
 * @param {number} [opts.loops]    0 = forever
 * @returns {Promise<Blob>}
 */
export async function encodeAPNG(canvases, { delayMs = 100, loops = 0 } = {}) {
  if (!canvases || !canvases.length) throw new Error('nothing to encode');
  const w = canvases[0].width, h = canvases[0].height;
  if (!w || !h) throw new Error('zero-sized frame');

  const parts = [u8(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)];
  // colour type 6 = RGBA, bit depth 8, no interlace.
  parts.push(chunk('IHDR', concat(be32(w), be32(h), u8(8, 6, 0, 0, 0))));
  // acTL must precede the first IDAT or the file is a still PNG with junk in it.
  parts.push(chunk('acTL', concat(be32(canvases.length), be32(loops))));

  /* Delays are a RATIONAL — numerator over denominator — not milliseconds. 1000
     as the denominator means the numerator is milliseconds exactly, with no
     rounding to the 1/100s GIF is stuck with. */
  const fcTL = (seq, ms) => chunk('fcTL', concat(
    be32(seq), be32(w), be32(h), be32(0), be32(0),
    be16(Math.max(1, Math.round(ms))), be16(1000),
    u8(0),      // dispose: none
    u8(0)));    // blend: source — every frame is whole, so nothing to blend over

  let seq = 0;
  for (let i = 0; i < canvases.length; i++) {
    const ctx = canvases[i].getContext('2d');
    const data = await zlib(rawScanlines(ctx.getImageData(0, 0, w, h).data, w, h));
    parts.push(fcTL(seq++, delayMs));
    // The first frame is an ordinary IDAT, which is what makes an APNG open as
    // a still PNG in anything that does not know the animation chunks.
    if (i === 0) parts.push(chunk('IDAT', data));
    else parts.push(chunk('fdAT', concat(be32(seq++), data)));
  }
  parts.push(chunk('IEND'));
  return new Blob([concat(...parts)], { type: 'image/png' });
}

/* ------------------------------------------------------ animated WebP ---- */

/** Walk a RIFF file's chunks. Sizes are LE and padded to even. */
function riffChunks(bytes) {
  const out = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;                                    // past 'RIFF' + size + 'WEBP'
  while (at + 8 <= bytes.length) {
    const type = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    const size = dv.getUint32(at + 4, true);
    if (at + 8 + size > bytes.length) break;
    out.push({ type, body: bytes.subarray(at + 8, at + 8 + size), size });
    at += 8 + size + (size & 1);                  // pad byte when odd
  }
  return out;
}

function riffChunk(type, body) {
  const pad = body.length & 1 ? u8(0) : new Uint8Array(0);
  return concat(ascii(type), le32(body.length), body, pad);
}

/**
 * The bitstream out of a still WebP, ready to be an animation frame.
 *
 * A still from `toBlob` is a whole RIFF file. What an ANMF wants is only the
 * image chunks from inside it — the alpha plane if there is one, then the VP8
 * or VP8L payload. Handing it the whole file, header and all, is the obvious
 * mistake and produces something that looks like a WebP and decodes as nothing.
 */
function frameBitstream(bytes) {
  const chunks = riffChunks(bytes);
  const keep = chunks.filter((c) => c.type === 'ALPH' || c.type === 'VP8 ' || c.type === 'VP8L');
  if (!keep.some((c) => c.type === 'VP8 ' || c.type === 'VP8L')) return null;
  return { data: concat(...keep.map((c) => riffChunk(c.type, c.body))),
           alpha: keep.some((c) => c.type === 'ALPH') };
}

/**
 * Encode canvases as an animated WebP.
 *
 * Each frame is compressed by the browser's own WebP encoder via
 * `canvas.toBlob`; this assembles the results into an animation container.
 * Returns null when the browser cannot encode WebP at all, so the caller can
 * say so rather than writing a file with no frames in it.
 *
 * @param {HTMLCanvasElement[]} canvases
 * @param {object} [opts]
 * @param {number} [opts.delayMs]
 * @param {number} [opts.loops]     0 = forever
 * @param {number} [opts.quality]   0..1, passed to the browser's encoder
 * @returns {Promise<Blob|null>}
 */
export async function encodeAnimatedWebP(canvases, { delayMs = 100, loops = 0, quality = 0.85 } = {}) {
  if (!canvases || !canvases.length) throw new Error('nothing to encode');
  const w = canvases[0].width, h = canvases[0].height;
  if (!w || !h) throw new Error('zero-sized frame');

  const frames = [];
  let anyAlpha = false;
  for (const c of canvases) {
    const blob = await new Promise((res) => c.toBlob(res, 'image/webp', quality));
    if (!blob || !blob.type.includes('webp')) return null;   // no WebP encoder here
    const bs = frameBitstream(new Uint8Array(await blob.arrayBuffer()));
    if (!bs) return null;
    anyAlpha = anyAlpha || bs.alpha;
    frames.push(bs.data);
  }

  const anmf = frames.map((data) => riffChunk('ANMF', concat(
    le24(0), le24(0),                   // x, y — in units of 2px, so 0 is 0
    le24(w - 1), le24(h - 1),           // dimensions are stored minus one
    le24(Math.max(1, Math.round(delayMs))),
    u8(0),                              // blend: none, dispose: none
    data)));

  // VP8X announces that this file has an animation in it; without it a decoder
  // reads the first frame and stops.
  const vp8x = riffChunk('VP8X', concat(
    u8(0x02 | (anyAlpha ? 0x10 : 0)), u8(0, 0, 0),
    le24(w - 1), le24(h - 1)));
  const anim = riffChunk('ANIM', concat(u8(0, 0, 0, 0), le16(loops)));

  const body = concat(ascii('WEBP'), vp8x, anim, ...anmf);
  return new Blob([concat(ascii('RIFF'), le32(body.length), body)], { type: 'image/webp' });
}

/** Whether this browser can encode WebP stills at all. */
export async function webpSupported() {
  try {
    const c = document.createElement('canvas');
    c.width = 2; c.height = 2;
    const blob = await new Promise((res) => c.toBlob(res, 'image/webp'));
    return !!blob && blob.type.includes('webp');
  } catch { return false; }
}
