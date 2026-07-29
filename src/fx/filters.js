/* Dead Signal Studio — fx/filters.js
 *
 * The filter registry: a composable, reorderable effect chain.
 *
 * The built-in CRT stack (fx/crt.js) is a FIXED set in a FIXED order — one
 * control each, always applied the same way. That is the right default and it
 * stays exactly as it was, so every existing project and preset renders
 * identically. What it cannot do is let an author say "grade it cold, THEN
 * bloom, then crush it to four bits, then letterbox" — order is where most of
 * the look lives, and the built-in stack has no opinion you can change.
 *
 * A filter here is a small pure-ish function plus a declared parameter list.
 * Declaring the parameters is what lets the UI build itself, the document
 * store the values, and a preset travel — nothing has to be hand-wired per
 * filter, so adding one is a single entry in this file.
 *
 * Contract for `apply`:
 *   apply(ctx, W, H, p, t)  — ctx is in DEVICE space with an identity
 *   transform, W/H are its pixel dimensions, `p` is the resolved parameter
 *   object (every declared key present and clamped), `t` is clip time in
 *   seconds. Draw in place. Anything needing the previous pixels should use
 *   scratch() rather than allocating per frame.
 *
 * Determinism: use seedStream(name) before any randomness, never Math.random.
 * The frame seed is already set by renderVideoFrame, so the same t renders the
 * same pixels — which is what makes scrub, playback and export agree.
 */
import { rnd, rrange, seedStream } from '../core/rng.js';
import { hexToRgb } from '../core/text.js';

/* Scratch canvases, lazily created: module-scope DOM would make this file
   un-importable outside a browser, and the headless suites import it. */
let _sc = null, _sc2 = null;
const scratch = () => _sc || (_sc = document.createElement('canvas'));
const scratch2 = () => _sc2 || (_sc2 = document.createElement('canvas'));
/** Copy the current frame into a scratch canvas and hand back its context. */
function snapshot(ctx, W, H, which) {
  const c = which === 2 ? scratch2() : scratch();
  if (c.width !== W) c.width = W;
  if (c.height !== H) c.height = H;
  const s = c.getContext('2d');
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.clearRect(0, 0, W, H);
  s.drawImage(ctx.canvas, 0, 0);
  return c;
}

export const FILTERS = {};
/**
 * @param {string} id      stable key stored in the document
 * @param {string} name    label in the UI
 * @param {string} group   heading in the picker
 * @param {Array}  params  [{ key, label, min, max, step, def, kind? }]
 *   kind defaults to a numeric slider. 'color' and 'text' take a def only;
 *   'select' additionally takes `options: [{ value, label }]`.
 * @param {Function} apply (ctx,W,H,p,t)
 */
export function filter(id, name, group, params, apply) {
  FILTERS[id] = { id, name, group, params, apply };
}

/** Every declared key, clamped, with defaults filled in. */
export function resolveParams(id, given) {
  const f = FILTERS[id];
  if (!f) return {};
  const out = {};
  for (const spec of f.params) {
    if (spec.kind === 'color') {
      const v = given?.[spec.key];
      out[spec.key] = typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : spec.def;
      continue;
    }
    if (spec.kind === 'text') {
      const v = given?.[spec.key];
      out[spec.key] = typeof v === 'string' ? v.slice(0, 120) : spec.def;
      continue;
    }
    if (spec.kind === 'select') {
      // A value not in the list falls back to the default rather than through:
      // a mode is a switch statement somewhere, and an unknown case would draw
      // nothing at all. This is also how a project written against a newer
      // build degrades — to the default look, not to a blank frame.
      const v = given?.[spec.key];
      out[spec.key] = spec.options.some((o) => o.value === v) ? v : spec.def;
      continue;
    }
    const n = Number(given?.[spec.key]);
    out[spec.key] = Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, n)) : spec.def;
  }
  return out;
}

/* ------------------------------------------------------------- colour ---- */

/* One pass over the pixels doing brightness, contrast, saturation and a
   temperature/tint shift. Bundled deliberately: they are almost never wanted
   alone, and four separate filters would mean four full-frame passes. */
filter('grade', 'Colour Grade', 'Colour', [
  { key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1, def: 0 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, def: 0 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, def: 0 },
  { key: 'temperature', label: 'Temperature', min: -100, max: 100, step: 1, def: 0 },
  { key: 'tint', label: 'Tint (green↔magenta)', min: -100, max: 100, step: 1, def: 0 },
], (ctx, W, H, p) => {
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  const br = p.brightness * 2.55;
  const c = (p.contrast + 100) / 100, cc = c * c;          // squared: gentler at low settings
  const s = (p.saturation + 100) / 100;
  const tr = p.temperature * 0.6, tb = -p.temperature * 0.6;
  const tg = p.tint * 0.5, tm = -p.tint * 0.25;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    r += br + tr + tm; g += br + tg; b += br + tb + tm;
    r = (r - 128) * cc + 128; g = (g - 128) * cc + 128; b = (b - 128) * cc + 128;
    const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
    r = l + (r - l) * s; g = l + (g - l) * s; b = l + (b - l) * s;
    d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
  ctx.putImageData(img, 0, 0);
});

filter('duotone', 'Duotone', 'Colour', [
  { key: 'shadow', label: 'Shadows', kind: 'color', def: '#0a0f1e' },
  { key: 'highlight', label: 'Highlights', kind: 'color', def: '#39ff9e' },
  { key: 'mix', label: 'Mix', min: 0, max: 100, step: 1, def: 100 },
], (ctx, W, H, p) => {
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  const a = hexToRgb(p.shadow), b = hexToRgb(p.highlight), m = p.mix / 100;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 255;
    d[i] += ((a[0] + (b[0] - a[0]) * l) - d[i]) * m;
    d[i + 1] += ((a[1] + (b[1] - a[1]) * l) - d[i + 1]) * m;
    d[i + 2] += ((a[2] + (b[2] - a[2]) * l) - d[i + 2]) * m;
  }
  ctx.putImageData(img, 0, 0);
});

filter('invert', 'Invert', 'Colour', [
  { key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, def: 100 },
], (ctx, W, H, p) => {
  const img = ctx.getImageData(0, 0, W, H), d = img.data, m = p.amount / 100;
  for (let i = 0; i < d.length; i += 4) {
    d[i] += (255 - d[i] - d[i]) * m;
    d[i + 1] += (255 - d[i + 1] - d[i + 1]) * m;
    d[i + 2] += (255 - d[i + 2] - d[i + 2]) * m;
  }
  ctx.putImageData(img, 0, 0);
});

/* Inverts only above a threshold — the darkroom effect, not a full invert. */
filter('solarize', 'Solarize', 'Colour', [
  { key: 'threshold', label: 'Threshold', min: 0, max: 100, step: 1, def: 55 },
], (ctx, W, H, p) => {
  const img = ctx.getImageData(0, 0, W, H), d = img.data, th = p.threshold * 2.55;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > th) d[i] = 255 - d[i];
    if (d[i + 1] > th) d[i + 1] = 255 - d[i + 1];
    if (d[i + 2] > th) d[i + 2] = 255 - d[i + 2];
  }
  ctx.putImageData(img, 0, 0);
});

filter('posterize', 'Posterize', 'Colour', [
  { key: 'levels', label: 'Levels', min: 2, max: 32, step: 1, def: 6 },
], (ctx, W, H, p) => {
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  const n = Math.max(2, Math.round(p.levels)), step = 255 / (n - 1);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.round(d[i] / step) * step;
    d[i + 1] = Math.round(d[i + 1] / step) * step;
    d[i + 2] = Math.round(d[i + 2] / step) * step;
  }
  ctx.putImageData(img, 0, 0);
});

/* Per-channel bit depth. Distinct from Posterize: this is what a cheap capture
   card does, and dropping the channels unevenly is most of the look. */
filter('bitcrush', 'Bit Crush', 'Colour', [
  { key: 'red', label: 'Red bits', min: 1, max: 8, step: 1, def: 3 },
  { key: 'green', label: 'Green bits', min: 1, max: 8, step: 1, def: 3 },
  { key: 'blue', label: 'Blue bits', min: 1, max: 8, step: 1, def: 2 },
], (ctx, W, H, p) => {
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  const mk = (bits) => { const n = (1 << Math.round(bits)) - 1; return n > 0 ? 255 / n : 255; };
  const sr = mk(p.red), sg = mk(p.green), sb = mk(p.blue);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.round(d[i] / sr) * sr;
    d[i + 1] = Math.round(d[i + 1] / sg) * sg;
    d[i + 2] = Math.round(d[i + 2] / sb) * sb;
  }
  ctx.putImageData(img, 0, 0);
});

filter('threshold', 'Threshold (1-bit)', 'Colour', [
  { key: 'level', label: 'Level', min: 0, max: 100, step: 1, def: 50 },
  { key: 'dark', label: 'Dark', kind: 'color', def: '#000000' },
  { key: 'light', label: 'Light', kind: 'color', def: '#ffffff' },
], (ctx, W, H, p) => {
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  const th = p.level * 2.55, a = hexToRgb(p.dark), b = hexToRgb(p.light);
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
    const c = l > th ? b : a;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
  }
  ctx.putImageData(img, 0, 0);
});

/* --------------------------------------------------------- sharpness ---- */

filter('blur', 'Blur', 'Sharpness', [
  { key: 'radius', label: 'Radius px', min: 0, max: 20, step: 0.5, def: 2 , px: true },
], (ctx, W, H, p) => {
  if (p.radius <= 0) return;
  const src = snapshot(ctx, W, H);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  try { ctx.filter = `blur(${p.radius}px)`; } catch { /* no filter support */ }
  ctx.drawImage(src, 0, 0);
  ctx.filter = 'none';
  ctx.restore();
});

/* Unsharp mask: original minus a blurred copy, added back. Done with the
   canvas blur rather than a convolution kernel — an order of magnitude faster
   at preview sizes and visually the same thing. */
filter('sharpen', 'Sharpen', 'Sharpness', [
  { key: 'amount', label: 'Amount', min: 0, max: 200, step: 1, def: 80 },
  { key: 'radius', label: 'Radius px', min: 0.5, max: 8, step: 0.5, def: 1.5 , px: true },
], (ctx, W, H, p) => {
  if (p.amount <= 0) return;
  const src = snapshot(ctx, W, H);
  const b = scratch2();
  if (b.width !== W) b.width = W;
  if (b.height !== H) b.height = H;
  const bx = b.getContext('2d');
  bx.setTransform(1, 0, 0, 1, 0, 0);
  bx.clearRect(0, 0, W, H);
  try { bx.filter = `blur(${p.radius}px)`; } catch { /* ignore */ }
  bx.drawImage(src, 0, 0);
  bx.filter = 'none';
  const a = ctx.getImageData(0, 0, W, H), lo = bx.getImageData(0, 0, W, H);
  const da = a.data, dl = lo.data, k = p.amount / 100;
  for (let i = 0; i < da.length; i += 4) {
    da[i] = Math.max(0, Math.min(255, da[i] + (da[i] - dl[i]) * k));
    da[i + 1] = Math.max(0, Math.min(255, da[i + 1] + (da[i + 1] - dl[i + 1]) * k));
    da[i + 2] = Math.max(0, Math.min(255, da[i + 2] + (da[i + 2] - dl[i + 2]) * k));
  }
  ctx.putImageData(a, 0, 0);
});

/* Sobel magnitude, drawn in one colour. Wireframe/scanner look. */
filter('edges', 'Edge Detect', 'Sharpness', [
  { key: 'amount', label: 'Strength', min: 0, max: 100, step: 1, def: 100 },
  { key: 'mix', label: 'Blend with original', min: 0, max: 100, step: 1, def: 0 },
  { key: 'colour', label: 'Edge colour', kind: 'color', def: '#39ff9e' },
], (ctx, W, H, p) => {
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  const out = ctx.createImageData(W, H), o = out.data;
  const c = hexToRgb(p.colour), k = p.amount / 100, keep = p.mix / 100;
  const L = (x, y) => {
    const i = ((y < 0 ? 0 : y >= H ? H - 1 : y) * W + (x < 0 ? 0 : x >= W ? W - 1 : x)) * 4;
    return d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const gx = -L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1)
             + L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1);
    const gy = -L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1)
             + L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1);
    const m = Math.min(255, Math.hypot(gx, gy) * k) / 255;
    const i = (y * W + x) * 4;
    o[i] = c[0] * m + d[i] * keep;
    o[i + 1] = c[1] * m + d[i + 1] * keep;
    o[i + 2] = c[2] * m + d[i + 2] * keep;
    o[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
});

/* ------------------------------------------------------------ analogue -- */

/* CRT curvature. Samples the frame in horizontal strips warped toward the
   centre — cheap, and at these sizes indistinguishable from a real barrel
   warp. Negative pincushions instead. */
filter('curvature', 'CRT Curvature', 'Analogue', [
  { key: 'amount', label: 'Barrel', min: -50, max: 100, step: 1, def: 25 },
  { key: 'edge', label: 'Edge darkening', min: 0, max: 100, step: 1, def: 40 },
], (ctx, W, H, p) => {
  if (p.amount === 0 && p.edge === 0) return;
  const src = snapshot(ctx, W, H);
  const k = p.amount / 100;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const strips = Math.max(24, Math.min(H, 120));
  const sh = H / strips;
  for (let i = 0; i < strips; i++) {
    const sy = i * sh;
    const ny = (sy + sh / 2) / H * 2 - 1;                 // -1..1 from centre
    const squeeze = 1 - k * 0.18 * (ny * ny);
    const dw = W * squeeze;
    ctx.drawImage(src, 0, sy, W, sh, (W - dw) / 2, sy, dw, sh);
  }
  if (p.edge > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${p.edge / 100})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
});

/* Interlace: the two fields disagree, which is what makes 50i footage read as
   video rather than film. Offsetting one field is the whole effect. */
filter('interlace', 'Interlace', 'Analogue', [
  { key: 'offset', label: 'Field offset px', min: 0, max: 12, step: 1, def: 2 , px: true },
  { key: 'darken', label: 'Field darkening', min: 0, max: 100, step: 1, def: 25 },
], (ctx, W, H, p) => {
  const src = snapshot(ctx, W, H);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let y = 1; y < H; y += 2) ctx.drawImage(src, 0, y, W, 1, p.offset, y, W, 1);
  if (p.darken > 0) {
    ctx.fillStyle = `rgba(0,0,0,${p.darken / 100 * 0.5})`;
    for (let y = 1; y < H; y += 2) ctx.fillRect(0, y, W, 1);
  }
  ctx.restore();
});

/* Multipath echo — the same picture arriving late and weak, offset sideways.
   Aerial reception, not a blur. */
filter('ghost', 'Ghosting', 'Analogue', [
  { key: 'offset', label: 'Offset px', min: -60, max: 60, step: 1, def: 14 , px: true },
  { key: 'strength', label: 'Strength', min: 0, max: 100, step: 1, def: 35 },
  { key: 'count', label: 'Echoes', min: 1, max: 5, step: 1, def: 2 },
], (ctx, W, H, p) => {
  if (p.strength <= 0) return;
  const src = snapshot(ctx, W, H);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  const n = Math.round(p.count);
  for (let i = 1; i <= n; i++) {
    ctx.globalAlpha = (p.strength / 100) / i;
    ctx.drawImage(src, p.offset * i, 0);
  }
  ctx.restore();
});

/* The band of noise at the bottom of a VHS frame where the head leaves the
   tape. Instantly reads as "this is a tape". */
filter('headswitch', 'VHS Head Switch', 'Analogue', [
  { key: 'height', label: 'Band height px', min: 2, max: 60, step: 1, def: 14 , px: true },
  { key: 'jitter', label: 'Jitter px', min: 0, max: 40, step: 1, def: 12 , px: true },
  { key: 'noise', label: 'Noise', min: 0, max: 100, step: 1, def: 60 },
], (ctx, W, H, p) => {
  seedStream('headswitch');
  const src = snapshot(ctx, W, H);
  const bh = Math.min(H, Math.round(p.height));
  const top = H - bh;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, top, W, bh);
  for (let y = top; y < H; y++) {
    const frac = (y - top) / Math.max(1, bh);
    /* Wrapped, like Slit Scan and Rolling Shutter: clearing the band and then
       sliding each row left a transparent notch down one side of it. A real
       head switch tears the picture, it does not punch a hole in it — and the
       hole showed most on a small frame, where the band is a large share of
       what there is. */
    const off = (((rrange(-1, 1) * p.jitter * frac) % W) + W) % W;
    ctx.drawImage(src, 0, y, W, 1, off, y, W, 1);
    ctx.drawImage(src, 0, y, W, 1, off - W, y, W, 1);
  }
  if (p.noise > 0) {
    const a = p.noise / 100;
    for (let y = top; y < H; y++) for (let x = 0; x < W; x += 2) {
      if (rnd() > a * 0.5) continue;
      const v = (rnd() * 255) | 0;
      ctx.fillStyle = `rgba(${v},${v},${v},${a})`;
      ctx.fillRect(x, y, 2, 1);
    }
  }
  ctx.restore();
});

/* Whole horizontal slices displaced at random — a dropped frame in a codec,
   not an analogue artifact. Separate from Tracking, which is gentler and
   always moving. */
filter('scantear', 'Scan Tear', 'Analogue', [
  { key: 'slices', label: 'Slices', min: 1, max: 24, step: 1, def: 6 },
  { key: 'shift', label: 'Max shift px', min: 1, max: 120, step: 1, def: 30 , px: true },
  { key: 'height', label: 'Max slice height px', min: 2, max: 120, step: 1, def: 24 , px: true },
  { key: 'rate', label: 'Re-tear per second', min: 0, max: 30, step: 1, def: 6 },
], (ctx, W, H, p, t) => {
  // Quantising t to the tear rate holds each tear for a beat instead of
  // re-rolling every frame, which just reads as noise.
  const step = p.rate > 0 ? Math.floor(t * p.rate) : 0;
  seedStream('scantear:' + step);
  const src = snapshot(ctx, W, H);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let i = 0; i < Math.round(p.slices); i++) {
    const y = (rnd() * H) | 0;
    const h = Math.max(2, (rnd() * p.height) | 0);
    const dx = (rrange(-1, 1) * p.shift) | 0;
    ctx.drawImage(src, 0, y, W, h, dx, y, W, h);
  }
  ctx.restore();
});

/* Block displacement — the compression artifact you get when a keyframe is
   missing and motion vectors are applied to the wrong picture. */
filter('datamosh', 'Datamosh', 'Analogue', [
  { key: 'block', label: 'Block px', min: 4, max: 64, step: 2, def: 16 , px: true },
  { key: 'amount', label: 'Blocks moved %', min: 0, max: 100, step: 1, def: 18 },
  { key: 'shift', label: 'Max shift px', min: 1, max: 80, step: 1, def: 20 , px: true },
  { key: 'rate', label: 'Re-roll per second', min: 0, max: 30, step: 1, def: 4 },
], (ctx, W, H, p, t) => {
  if (p.amount <= 0) return;
  const step = p.rate > 0 ? Math.floor(t * p.rate) : 0;
  seedStream('datamosh:' + step);
  const src = snapshot(ctx, W, H);
  const b = Math.max(4, Math.round(p.block));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let y = 0; y < H; y += b) for (let x = 0; x < W; x += b) {
    if (rnd() > p.amount / 100) continue;
    const dx = (rrange(-1, 1) * p.shift) | 0;
    const dy = (rrange(-1, 1) * p.shift * 0.4) | 0;
    ctx.drawImage(src, x, y, b, b, x + dx, y + dy, b, b);
  }
  ctx.restore();
});

/* Radial chromatic aberration — channels separating more toward the corners,
   which is what a real lens does. The built-in Chroma is uniform and sideways.
 *
 * This drew two scaled copies of the WHOLE picture additively, which is a soft
 * double image: no channel ever separated from any other, so the one thing the
 * filter is named for was the one thing it did not do. Scaling each channel by
 * a different factor about the centre is the actual effect, and the further a
 * pixel is from the centre the further the channels land apart — which is why
 * it reads as a lens rather than as the uniform sideways smear of Chroma. */
filter('aberration', 'Lens Aberration', 'Analogue', [
  { key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, def: 30 },
], (ctx, W, H, p) => {
  if (p.amount <= 0) return;
  const src = snapshot(ctx, W, H);
  // Red magnified most, green half as much, blue not at all. Every factor is
  // >= 1 on purpose: shrinking a channel would leave the frame edge missing it
  // entirely, and a hard coloured border around the picture reads as a bug
  // rather than as a lens.
  const k = (p.amount / 100) * 0.03;
  const scaled = (c, f) => {
    const dw = W * f, dh = H * f;
    ctx.drawImage(c, (W - dw) / 2, (H - dh) / 2, dw, dh);
  };
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  // 'lighter' over a cleared frame sums the three channel passes back into one
  // picture; each pass is masked to a single channel by multiplying the source
  // with a pure primary first.
  ctx.globalCompositeOperation = 'lighter';
  for (const [f, mask] of [[1 + k, '#ff0000'], [1 + k / 2, '#00ff00'], [1, '#0000ff']]) {
    const c = scratch2();
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const cx = c.getContext('2d');
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.globalCompositeOperation = 'source-over';
    cx.clearRect(0, 0, W, H);
    cx.drawImage(src, 0, 0);
    cx.globalCompositeOperation = 'multiply';
    cx.fillStyle = mask;
    cx.fillRect(0, 0, W, H);
    cx.globalCompositeOperation = 'source-over';
    scaled(c, f);
  }
  ctx.restore();
});

/* Film grain: monochrome, per-pixel, and multiplied — unlike video noise,
   which is additive speckle. Grain lives in the midtones and vanishes in
   the blacks, so it is scaled by luminance. */
filter('filmgrain', 'Film Grain', 'Analogue', [
  { key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, def: 35 },
  { key: 'size', label: 'Grain size px', min: 1, max: 6, step: 1, def: 1 , px: true },
], (ctx, W, H, p) => {
  if (p.amount <= 0) return;
  seedStream('filmgrain');
  const s = Math.max(1, Math.round(p.size));
  const k = p.amount / 100;
  if (s === 1) {
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] + d[i + 1] + d[i + 2]) / 765;
      const g = (rnd() - 0.5) * 255 * k * (0.25 + l * 0.75);
      d[i] = Math.max(0, Math.min(255, d[i] + g));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + g));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + g));
    }
    ctx.putImageData(img, 0, 0);
    return;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) {
    const g = (rnd() - 0.5) * k;
    ctx.fillStyle = g > 0 ? `rgba(255,255,255,${g})` : `rgba(0,0,0,${-g})`;
    ctx.fillRect(x, y, s, s);
  }
  ctx.restore();
});

/* ------------------------------------------------------------- pattern -- */

filter('halftone', 'Halftone', 'Pattern', [
  { key: 'cell', label: 'Cell px', min: 2, max: 24, step: 1, def: 5 , px: true },
  { key: 'angle', label: 'Angle°', min: 0, max: 90, step: 1, def: 45 },
  { key: 'ink', label: 'Ink', kind: 'color', def: '#000000' },
  { key: 'paper', label: 'Paper', kind: 'color', def: '#c8d0c4' },
], (ctx, W, H, p) => {
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  const cell = Math.max(2, Math.round(p.cell));
  const ink = hexToRgb(p.ink), paper = hexToRgb(p.paper);
  const rad = p.angle * Math.PI / 180, ca = Math.cos(rad), sa = Math.sin(rad);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = `rgb(${paper[0]},${paper[1]},${paper[2]})`;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = `rgb(${ink[0]},${ink[1]},${ink[2]})`;
  const half = cell / 2;
  for (let y = 0; y < H; y += cell) for (let x = 0; x < W; x += cell) {
    // Average the cell rather than point-sampling: a single pixel misses thin
    // strokes entirely and the dots flicker as the picture moves.
    let sum = 0, n = 0;
    for (let yy = y; yy < Math.min(H, y + cell); yy += 1) for (let xx = x; xx < Math.min(W, x + cell); xx += 1) {
      const i = (yy * W + xx) * 4;
      sum += d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
      n++;
    }
    const l = n ? sum / n / 255 : 0;
    const r = (1 - l) * half * 1.34;
    if (r < 0.35) continue;
    const cx = x + half, cy = y + half;
    // Rotating the sample grid is what makes a halftone read as printed
    // rather than as a pixel grid.
    const rx = cx + (cx - W / 2) * (ca - 1) - (cy - H / 2) * sa;
    const ry = cy + (cx - W / 2) * sa + (cy - H / 2) * (ca - 1);
    ctx.beginPath();
    ctx.arc(rx, ry, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
});

filter('crosshatch', 'Crosshatch', 'Pattern', [
  { key: 'spacing', label: 'Spacing px', min: 2, max: 24, step: 1, def: 6 , px: true },
  { key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, def: 70 },
  { key: 'colour', label: 'Line colour', kind: 'color', def: '#000000' },
], (ctx, W, H, p) => {
  if (p.amount <= 0) return;
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  const s = Math.max(2, Math.round(p.spacing)), a = p.amount / 100;
  const c = hexToRgb(p.colour);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  ctx.lineWidth = 1;
  // Four passes at increasing darkness thresholds: each adds a direction, so
  // the darker the region the more directions cross it.
  const dirs = [[1, 1], [1, -1], [1, 0], [0, 1]];
  for (let k = 0; k < dirs.length; k++) {
    const th = (k + 1) / (dirs.length + 1);
    ctx.beginPath();
    for (let y = -H; y < H * 2; y += s) for (let x = 0; x < W; x += s) {
      const py = dirs[k][1] === 0 ? y : y + x * dirs[k][1];
      if (py < 0 || py >= H || x >= W) continue;
      const i = ((py | 0) * W + x) * 4;
      const l = (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 255;
      if (l > 1 - th) continue;
      ctx.moveTo(x, py);
      ctx.lineTo(x + s, py + s * dirs[k][1]);
    }
    ctx.stroke();
  }
  ctx.restore();
});

/* Sorts pixel runs by brightness. The classic glitch-art smear. */
filter('pixelsort', 'Pixel Sort', 'Pattern', [
  { key: 'threshold', label: 'Threshold', min: 0, max: 100, step: 1, def: 45 },
  { key: 'vertical', label: 'Vertical (0/1)', min: 0, max: 1, step: 1, def: 0 },
  { key: 'maxrun', label: 'Max run px', min: 8, max: 400, step: 4, def: 120 , px: true },
], (ctx, W, H, p) => {
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  const th = p.threshold * 2.55;
  const vert = p.vertical >= 0.5;
  const maxRun = Math.round(p.maxrun);
  const major = vert ? W : H, minor = vert ? H : W;
  const at = (a, b) => (vert ? (b * W + a) : (a * W + b)) * 4;
  const L = (i) => d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
  for (let a = 0; a < major; a++) {
    let b = 0;
    while (b < minor) {
      if (L(at(a, b)) < th) { b++; continue; }
      let e = b;
      while (e < minor && e - b < maxRun && L(at(a, e)) >= th) e++;
      if (e - b > 2) {
        const run = [];
        for (let i = b; i < e; i++) {
          const k = at(a, i);
          run.push([d[k], d[k + 1], d[k + 2], L(k)]);
        }
        run.sort((x, y) => x[3] - y[3]);
        for (let i = b; i < e; i++) {
          const k = at(a, i), v = run[i - b];
          d[k] = v[0]; d[k + 1] = v[1]; d[k + 2] = v[2];
        }
      }
      b = e + 1;
    }
  }
  ctx.putImageData(img, 0, 0);
});

filter('mosaic', 'Mosaic', 'Pattern', [
  { key: 'size', label: 'Block px', min: 2, max: 64, step: 1, def: 8 , px: true },
], (ctx, W, H, p) => {
  const s = Math.max(2, Math.round(p.size));
  const src = snapshot(ctx, W, H);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const sw = Math.max(1, Math.round(W / s)), sh = Math.max(1, Math.round(H / s));
  const tmp = scratch2();
  if (tmp.width !== sw) tmp.width = sw;
  if (tmp.height !== sh) tmp.height = sh;
  const tx = tmp.getContext('2d');
  tx.setTransform(1, 0, 0, 1, 0, 0);
  tx.imageSmoothingEnabled = true;                    // average down, then blow up hard
  tx.clearRect(0, 0, sw, sh);
  tx.drawImage(src, 0, 0, sw, sh);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(tmp, 0, 0, sw, sh, 0, 0, W, H);
  ctx.restore();
});

/* --------------------------------------------------------------- frame -- */

filter('letterbox', 'Letterbox', 'Frame', [
  { key: 'ratio', label: 'Target ratio (w/h ×100)', min: 100, max: 400, step: 1, def: 235 },
  { key: 'opacity', label: 'Matte opacity', min: 0, max: 100, step: 1, def: 100 },
], (ctx, W, H, p) => {
  const target = p.ratio / 100;
  const cur = W / H;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = `rgba(0,0,0,${p.opacity / 100})`;
  if (target > cur) {                       // wider than the frame: bars top and bottom
    const bar = (H - W / target) / 2;
    if (bar > 0) { ctx.fillRect(0, 0, W, bar); ctx.fillRect(0, H - bar, W, bar); }
  } else if (target < cur) {                // taller: bars left and right
    const bar = (W - H * target) / 2;
    if (bar > 0) { ctx.fillRect(0, 0, bar, H); ctx.fillRect(W - bar, 0, bar, H); }
  }
  ctx.restore();
});

filter('border', 'Border', 'Frame', [
  { key: 'width', label: 'Width px', min: 1, max: 40, step: 1, def: 3 , px: true },
  { key: 'inset', label: 'Inset px', min: 0, max: 60, step: 1, def: 8 , px: true },
  { key: 'colour', label: 'Colour', kind: 'color', def: '#39ff9e' },
  { key: 'opacity', label: 'Opacity', min: 0, max: 100, step: 1, def: 80 },
], (ctx, W, H, p) => {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = p.opacity / 100;
  ctx.strokeStyle = p.colour;
  ctx.lineWidth = p.width;
  ctx.strokeRect(p.inset + p.width / 2, p.inset + p.width / 2,
                 W - (p.inset + p.width / 2) * 2, H - (p.inset + p.width / 2) * 2);
  ctx.restore();
});

/* Burned-in caption. Deliberately a filter rather than a scene feature: it
   goes on top of everything, including the CRT stack, which is where a
   camera's own overlay sits. */
filter('stamp', 'Text Stamp', 'Frame', [
  { key: 'text', label: 'Text', kind: 'text', def: 'REC' },
  { key: 'size', label: 'Size px', min: 6, max: 96, step: 1, def: 14 , px: true },
  { key: 'x', label: 'X %', min: 0, max: 100, step: 1, def: 4 },
  { key: 'y', label: 'Y %', min: 0, max: 100, step: 1, def: 6 },
  { key: 'colour', label: 'Colour', kind: 'color', def: '#ff3b6b' },
  { key: 'opacity', label: 'Opacity', min: 0, max: 100, step: 1, def: 90 },
  { key: 'blink', label: 'Blinks per second', min: 0, max: 8, step: 0.5, def: 0 },
], (ctx, W, H, p, t) => {
  if (!p.text) return;
  if (p.blink > 0 && Math.floor(t * p.blink * 2) % 2 === 1) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = p.opacity / 100;
  ctx.fillStyle = p.colour;
  ctx.font = `${p.size}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textBaseline = 'top';
  ctx.fillText(p.text, W * p.x / 100, H * p.y / 100);
  ctx.restore();
});

/* --------------------------------------------------------------- apply -- */

/** Ids grouped for the picker, groups in registration order. */
export function filterGroups() {
  const out = new Map();
  for (const f of Object.values(FILTERS)) {
    if (!out.has(f.group)) out.set(f.group, []);
    out.get(f.group).push(f);
  }
  return out;
}

/**
 * Run a chain over the frame. Called in DEVICE space with an identity
 * transform, after the built-in CRT stack, so a chain composes ON TOP of the
 * fixed look rather than replacing it.
 */
export function applyFilterChain(ctx, W, H, chain, t) {
  if (!Array.isArray(chain) || !chain.length) return;
  for (const step of chain) {
    if (!step || step.enabled === false) continue;
    const f = FILTERS[step.id];
    if (!f) continue;                       // a filter from a newer build: skip, keep the entry
    const p = resolveParams(step.id, step.params);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    try {
      f.apply(ctx, W, H, p, t);
    } catch {
      // One bad filter must not take the whole frame down — the preview loop
      // would stop and the tool would look dead.
    }
    ctx.restore();
  }
}
