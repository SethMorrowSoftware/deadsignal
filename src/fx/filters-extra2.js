/* Dead Signal Studio — fx/filters-extra2.js
 *
 * A third shelf of filters: the general-editor set. filters.js holds the core
 * looks, filters-extra.js the analogue-decay shelf; this file adds the tools a
 * general video editor is expected to have — hue work, vignette, bloom, lens
 * and wave warps, emboss, mirror symmetry, zoom blur, and a one-stop old-film
 * treatment. Same registry, same `filter()` helper, same rules.
 *
 * The rule that shapes this file is the same one filters-extra.js states: **a
 * filter is a pure function of (frame, t)**. No frame history, no accumulating
 * state; scrubbing to a time, playing through it and exporting it must all
 * produce identical pixels. Anything random goes through seedStatic (keyed on a
 * quantised beat, NOT the frame index) so the same t renders the same frame and
 * an effect genuinely holds for its beat instead of re-rolling every frame.
 */
import { rnd, rrange, seedStatic } from '../core/rng.js';
import { hexToRgb } from '../core/text.js';
import { filter, FILTERS } from './filters.js';

/* A private scratch pool, lazily created, for the same two reasons the other
   shelves have theirs: module-scope DOM would make this file un-importable
   outside a browser, and allocating canvases per frame is what made the slow
   filters slow. */
const _pool = [];
function slot(n, W, H) {
  const c = _pool[n] || (_pool[n] = document.createElement('canvas'));
  if (c.width !== W) c.width = W;
  if (c.height !== H) c.height = H;
  return c;
}
function snap(ctx, W, H, which = 1) {
  const c = slot(which, W, H);
  const s = c.getContext('2d');
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.clearRect(0, 0, W, H);
  s.drawImage(ctx.canvas, 0, 0);
  return c;
}
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Register every filter in this file. Called once at boot, before the picker fills. */
export function registerExtraFilters2() {

  /* Hue rotation as the standard luma-preserving matrix, plus a colourise mix
     that pushes every pixel toward one hue at its own brightness — the tint
     half of a duotone without touching the shadows' colour. */
  filter('hue', 'Hue / Colourise', 'Colour', [
    { key: 'rotate', label: 'Rotate °', min: -180, max: 180, step: 1, def: 0 },
    { key: 'colourise', label: 'Colourise', min: 0, max: 100, step: 1, def: 0 },
    { key: 'target', label: 'Colourise to', kind: 'color', def: '#39ff9e' },
  ], (ctx, W, H, p) => {
    if (p.rotate === 0 && p.colourise <= 0) return;
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    const A = (p.rotate * Math.PI) / 180, c = Math.cos(A), s = Math.sin(A);
    const m = [
      0.213 + 0.787 * c - 0.213 * s, 0.715 - 0.715 * c - 0.715 * s, 0.072 - 0.072 * c + 0.928 * s,
      0.213 - 0.213 * c + 0.143 * s, 0.715 + 0.285 * c + 0.140 * s, 0.072 - 0.072 * c - 0.283 * s,
      0.213 - 0.213 * c - 0.787 * s, 0.715 - 0.715 * c + 0.715 * s, 0.072 + 0.928 * c + 0.072 * s,
    ];
    const [tr, tg, tb] = hexToRgb(p.target);
    // The target's own luma, floored so a black target cannot divide by zero.
    const tl = Math.max(1, tr * 0.2126 + tg * 0.7152 + tb * 0.0722);
    const mix = p.colourise / 100;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      if (A !== 0) {
        const nr = m[0] * r + m[1] * g + m[2] * b;
        const ng = m[3] * r + m[4] * g + m[5] * b;
        const nb = m[6] * r + m[7] * g + m[8] * b;
        r = nr; g = ng; b = nb;
      }
      if (mix > 0) {
        const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
        const k = l / tl;
        r += (tr * k - r) * mix; g += (tg * k - g) * mix; b += (tb * k - b) * mix;
      }
      d[i] = clamp255(r); d[i + 1] = clamp255(g); d[i + 2] = clamp255(b);
    }
    ctx.putImageData(img, 0, 0);
  });

  /* A standalone, controllable vignette. The CRT stack has one baked in at a
     fixed shape; this one chooses its size, edge and colour, so it works as a
     grade tool rather than a tube artefact. */
  filter('vignette', 'Vignette', 'Frame', [
    { key: 'strength', label: 'Strength', min: 0, max: 100, step: 1, def: 45 },
    { key: 'size', label: 'Clear centre %', min: 10, max: 140, step: 1, def: 65 },
    { key: 'softness', label: 'Softness %', min: 1, max: 100, step: 1, def: 55 },
    { key: 'colour', label: 'Colour', kind: 'color', def: '#000000' },
  ], (ctx, W, H, p) => {
    if (p.strength <= 0) return;
    const R = Math.hypot(W, H) / 2;
    const r0 = R * (p.size / 100);
    const r1 = r0 + Math.max(R * 0.02, R * (p.softness / 100));
    const [r, g, b] = hexToRgb(p.colour);
    const grad = ctx.createRadialGradient(W / 2, H / 2, r0, W / 2, H / 2, r1);
    grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},${p.strength / 100})`);
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  });

  /* Bloom with its own threshold and radius, unlike the CRT stack's one-knob
     glow: only what is brighter than the threshold spills, so a face can stay
     put while the neon behind it halates. Slots 1 (snapshot) and 2 (the
     thresholded plate). */
  filter('bloom', 'Bloom / Glow', 'Analogue', [
    { key: 'threshold', label: 'Threshold', min: 0, max: 100, step: 1, def: 60 },
    { key: 'radius', label: 'Radius px', min: 1, max: 60, step: 0.5, def: 8, px: true },
    { key: 'intensity', label: 'Intensity', min: 0, max: 200, step: 1, def: 80 },
  ], (ctx, W, H, p) => {
    if (p.intensity <= 0) return;
    const src = snap(ctx, W, H, 1);
    const plate = slot(2, W, H), px = plate.getContext('2d');
    px.setTransform(1, 0, 0, 1, 0, 0);
    px.clearRect(0, 0, W, H);
    px.drawImage(src, 0, 0);
    const img = px.getImageData(0, 0, W, H), d = img.data;
    const th = (p.threshold / 100) * 255;
    // Keep only what clears the threshold, rescaled so the brightest pixel
    // keeps its energy — a hard keep-or-black gate reads as posterised bloom.
    for (let i = 0; i < d.length; i += 4) {
      const l = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
      const k = l <= th ? 0 : (l - th) / Math.max(1, 255 - th);
      d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    }
    px.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    try { ctx.filter = `blur(${p.radius}px)`; } catch { /* no filter support */ }
    const k = p.intensity / 100;
    ctx.globalAlpha = Math.min(1, k);
    ctx.drawImage(plate, 0, 0);
    if (k > 1) { ctx.globalAlpha = Math.min(1, k - 1); ctx.drawImage(plate, 0, 0); }
    ctx.filter = 'none';
    ctx.restore();
  });

  /* Spherical bulge/pinch — a true lens, unlike CRT Curvature's strip warp,
     and it can sit anywhere in the frame. Inverse-mapped per pixel with
     bilinear sampling; slot 1 holds the source plate. */
  filter('bulge', 'Bulge / Pinch', 'Pattern', [
    { key: 'amount', label: 'Amount', min: -100, max: 100, step: 1, def: 40 },
    { key: 'radius', label: 'Radius %', min: 10, max: 150, step: 1, def: 75 },
    { key: 'cx', label: 'Centre X %', min: 0, max: 100, step: 1, def: 50 },
    { key: 'cy', label: 'Centre Y %', min: 0, max: 100, step: 1, def: 50 },
  ], (ctx, W, H, p) => {
    if (p.amount === 0) return;
    const src = snap(ctx, W, H, 1).getContext('2d').getImageData(0, 0, W, H).data;
    const out = ctx.createImageData(W, H), o = out.data;
    const cx = W * (p.cx / 100), cy = H * (p.cy / 100);
    const R = Math.min(W, H) * (p.radius / 100);
    const a = p.amount / 100;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const vx = x - cx, vy = y - cy;
      const dist = Math.hypot(vx, vy);
      let sx = x, sy = y;
      if (dist < R && dist > 0) {
        const dNorm = dist / R;
        // Bulge samples toward the centre (magnifies), pinch away from it.
        // At the rim dNorm=1 makes the factor 1, so the warp meets the
        // untouched frame with no seam.
        const f = Math.pow(dNorm, 1 + a * (1 - dNorm));
        const k = f / dNorm;
        sx = cx + vx * k;
        sy = cy + vy * k;
      }
      const xi = Math.max(0, Math.min(W - 1.001, sx)), yi = Math.max(0, Math.min(H - 1.001, sy));
      const x0 = xi | 0, y0 = yi | 0, fx = xi - x0, fy = yi - y0;
      // Neighbours clamped to the frame: at the last column/row (or a 1×1 frame)
      // reading x0+1/y0+1 walks off the buffer, and the resulting NaN·0 term
      // poisons the sample into a transparent pixel. Clamping makes the neighbour
      // the pixel itself there — a hard edge, not a hole.
      const x1 = x0 + 1 < W ? x0 + 1 : x0, y1 = y0 + 1 < H ? y0 + 1 : y0;
      const i00 = (y0 * W + x0) * 4, i10 = (y0 * W + x1) * 4, i01 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4;
      const oi = (y * W + x) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const top = src[i00 + ch] + (src[i10 + ch] - src[i00 + ch]) * fx;
        const bot = src[i01 + ch] + (src[i11 + ch] - src[i01 + ch]) * fx;
        o[oi + ch] = top + (bot - top) * fy;
      }
    }
    ctx.putImageData(out, 0, 0);
  });

  /* Radial zoom blur: the frame drawn over itself a dozen times, each pass
     scaled a little further about the chosen centre at falling opacity. Cheap,
     GPU-composited, deterministic. Slot 1. */
  filter('zoomblur', 'Zoom Blur', 'Sharpness', [
    { key: 'strength', label: 'Strength', min: 0, max: 100, step: 1, def: 30 },
    { key: 'cx', label: 'Centre X %', min: 0, max: 100, step: 1, def: 50 },
    { key: 'cy', label: 'Centre Y %', min: 0, max: 100, step: 1, def: 50 },
  ], (ctx, W, H, p) => {
    if (p.strength <= 0) return;
    const src = snap(ctx, W, H, 1);
    const cx = W * (p.cx / 100), cy = H * (p.cy / 100);
    const passes = 11, spread = (p.strength / 100) * 0.25;
    ctx.save();
    for (let i = 1; i <= passes; i++) {
      const s = 1 + spread * (i / passes);
      ctx.globalAlpha = (1 - i / (passes + 1)) * 0.45;
      ctx.setTransform(s, 0, 0, s, cx - cx * s, cy - cy * s);
      ctx.drawImage(src, 0, 0);
    }
    ctx.restore();
  });

  /* Twirl: rotation that falls off with distance from the centre, so the
     middle of the frame wrings while the edges hold still. Inverse-mapped,
     bilinear, slot 1. */
  filter('twirl', 'Twirl', 'Pattern', [
    { key: 'angle', label: 'Angle °', min: -360, max: 360, step: 1, def: 120 },
    { key: 'radius', label: 'Radius %', min: 10, max: 150, step: 1, def: 60 },
    { key: 'cx', label: 'Centre X %', min: 0, max: 100, step: 1, def: 50 },
    { key: 'cy', label: 'Centre Y %', min: 0, max: 100, step: 1, def: 50 },
  ], (ctx, W, H, p) => {
    if (p.angle === 0) return;
    const src = snap(ctx, W, H, 1).getContext('2d').getImageData(0, 0, W, H).data;
    const out = ctx.createImageData(W, H), o = out.data;
    const cx = W * (p.cx / 100), cy = H * (p.cy / 100);
    const R = Math.min(W, H) * (p.radius / 100);
    const A = (p.angle * Math.PI) / 180;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const vx = x - cx, vy = y - cy;
      const dist = Math.hypot(vx, vy);
      let sx = x, sy = y;
      if (dist < R) {
        const k = 1 - dist / R;
        const ang = A * k * k;
        const c = Math.cos(ang), s = Math.sin(ang);
        sx = cx + vx * c - vy * s;
        sy = cy + vx * s + vy * c;
      }
      const xi = Math.max(0, Math.min(W - 1.001, sx)), yi = Math.max(0, Math.min(H - 1.001, sy));
      const x0 = xi | 0, y0 = yi | 0, fx = xi - x0, fy = yi - y0;
      // Neighbours clamped to the frame: at the last column/row (or a 1×1 frame)
      // reading x0+1/y0+1 walks off the buffer, and the resulting NaN·0 term
      // poisons the sample into a transparent pixel. Clamping makes the neighbour
      // the pixel itself there — a hard edge, not a hole.
      const x1 = x0 + 1 < W ? x0 + 1 : x0, y1 = y0 + 1 < H ? y0 + 1 : y0;
      const i00 = (y0 * W + x0) * 4, i10 = (y0 * W + x1) * 4, i01 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4;
      const oi = (y * W + x) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const top = src[i00 + ch] + (src[i10 + ch] - src[i00 + ch]) * fx;
        const bot = src[i01 + ch] + (src[i11 + ch] - src[i01 + ch]) * fx;
        o[oi + ch] = top + (bot - top) * fy;
      }
    }
    ctx.putImageData(out, 0, 0);
  });

  /* Sine displacement, one strip at a time, exactly the technique Rolling
     Shutter uses — wrapped so the slide never opens a transparent wedge.
     Horizontal waves rows, vertical waves columns. Slot 1. */
  filter('wave', 'Wave Warp', 'Pattern', [
    { key: 'axis', label: 'Axis', kind: 'select', def: 'h', options: [
      { value: 'h', label: 'Horizontal (rows slide)' },
      { value: 'v', label: 'Vertical (columns slide)' },
    ] },
    { key: 'amp', label: 'Amplitude px', min: 0, max: 80, step: 1, def: 12, px: true },
    { key: 'wavelength', label: 'Wavelength px', min: 8, max: 2000, step: 1, def: 90, px: true },
    { key: 'speed', label: 'Speed Hz', min: 0, max: 10, step: 0.1, def: 1 },
  ], (ctx, W, H, p, t) => {
    if (p.amp <= 0) return;
    const src = snap(ctx, W, H, 1);
    ctx.clearRect(0, 0, W, H);
    const twoPi = Math.PI * 2;
    if (p.axis === 'h') {
      for (let y = 0; y < H; y++) {
        const raw = Math.sin((y / p.wavelength + t * p.speed) * twoPi) * p.amp;
        const dx = ((raw % W) + W) % W;
        ctx.drawImage(src, 0, y, W, 1, dx, y, W, 1);
        ctx.drawImage(src, 0, y, W, 1, dx - W, y, W, 1);
      }
    } else {
      for (let x = 0; x < W; x++) {
        const raw = Math.sin((x / p.wavelength + t * p.speed) * twoPi) * p.amp;
        const dy = ((raw % H) + H) % H;
        ctx.drawImage(src, x, 0, 1, H, x, dy, 1, H);
        ctx.drawImage(src, x, 0, 1, H, x, dy - H, 1, H);
      }
    }
  });

  /* Emboss: each pixel against its neighbour along the light direction, on
     grey — the classic relief. Mix blends the relief back over the picture so
     it can also work as a cheap surface-texture pass. */
  filter('emboss', 'Emboss', 'Sharpness', [
    { key: 'strength', label: 'Strength', min: 0, max: 300, step: 1, def: 100 },
    { key: 'direction', label: 'Light from °', min: 0, max: 360, step: 45, def: 315 },
    { key: 'mix', label: 'Blend with original', min: 0, max: 100, step: 1, def: 0 },
  ], (ctx, W, H, p) => {
    if (p.strength <= 0) return;
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    const out = ctx.createImageData(W, H), o = out.data;
    const ang = (p.direction * Math.PI) / 180;
    const dx = Math.round(Math.cos(ang)), dy = Math.round(Math.sin(ang));
    const k = p.strength / 100, keep = p.mix / 100;
    const L = (x, y) => {
      const i = ((y < 0 ? 0 : y >= H ? H - 1 : y) * W + (x < 0 ? 0 : x >= W ? W - 1 : x)) * 4;
      return d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = clamp255(128 + (L(x + dx, y + dy) - L(x - dx, y - dy)) * k);
      const i = (y * W + x) * 4;
      o[i] = v + (d[i] - v) * keep;
      o[i + 1] = v + (d[i + 1] - v) * keep;
      o[i + 2] = v + (d[i + 2] - v) * keep;
      o[i + 3] = d[i + 3];
    }
    ctx.putImageData(out, 0, 0);
  });

  /* Mirror symmetry: one half of the frame reflected onto the other. Kaleido
     folds around a point; this is the plain editorial mirror. Slot 1. */
  filter('mirror', 'Mirror', 'Pattern', [
    { key: 'mode', label: 'Fold', kind: 'select', def: 'lr', options: [
      { value: 'lr', label: 'Left onto right' },
      { value: 'rl', label: 'Right onto left' },
      { value: 'tb', label: 'Top onto bottom' },
      { value: 'bt', label: 'Bottom onto top' },
      { value: 'quad', label: 'Quadrant (top-left everywhere)' },
    ] },
  ], (ctx, W, H, p) => {
    const src = snap(ctx, W, H, 1);
    const hw = Math.ceil(W / 2), hh = Math.ceil(H / 2);
    ctx.save();
    if (p.mode === 'lr' || p.mode === 'quad') {
      ctx.setTransform(-1, 0, 0, 1, W, 0);
      ctx.drawImage(src, 0, 0, hw, H, 0, 0, hw, H);
    } else if (p.mode === 'rl') {
      ctx.setTransform(-1, 0, 0, 1, W, 0);
      ctx.drawImage(src, W - hw, 0, hw, H, W - hw, 0, hw, H);
    }
    if (p.mode === 'tb' || p.mode === 'quad') {
      ctx.setTransform(1, 0, 0, -1, 0, H);
      ctx.drawImage(src, 0, 0, W, hh, 0, 0, W, hh);
    } else if (p.mode === 'bt') {
      ctx.setTransform(1, 0, 0, -1, 0, H);
      ctx.drawImage(src, 0, H - hh, W, hh, 0, H - hh, W, hh);
    }
    if (p.mode === 'quad') {
      ctx.setTransform(-1, 0, 0, -1, W, H);
      ctx.drawImage(src, 0, 0, hw, hh, 0, 0, hw, hh);
    }
    ctx.restore();
  });

  /* The whole projection-room treatment in one step: sepia, frame weave,
     brightness flicker, scratches and dust. Each part is available separately
     elsewhere in the registry; together they are the ten-second answer to
     "make it look found". Deterministic through seedStatic: keyed on the 24fps
     beat, so the flicker/weave/dust hold for the beat and re-roll on it rather
     than jittering every rendered frame (seedStream would fold in the frame
     index and defeat that — the same trap the analogue shelf's filters hit). */
  filter('oldfilm', 'Old Film', 'Analogue', [
    { key: 'sepia', label: 'Sepia', min: 0, max: 100, step: 1, def: 60 },
    { key: 'flicker', label: 'Flicker', min: 0, max: 100, step: 1, def: 25 },
    { key: 'weave', label: 'Gate weave px', min: 0, max: 30, step: 0.5, def: 3, px: true },
    { key: 'scratches', label: 'Scratches', min: 0, max: 100, step: 1, def: 35 },
    { key: 'dust', label: 'Dust', min: 0, max: 100, step: 1, def: 30 },
  ], (ctx, W, H, p, t) => {
    seedStatic(`oldfilm:${Math.floor(t * 24)}`);
    if (p.weave > 0) {
      const src = snap(ctx, W, H, 1);
      const wx = rrange(-p.weave, p.weave), wy = rrange(-p.weave, p.weave) * 0.6;
      // Fill first so the weave never exposes a transparent edge.
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(src, wx, wy);
    }
    if (p.sepia > 0 || p.flicker > 0) {
      const img = ctx.getImageData(0, 0, W, H), d = img.data;
      const mix = p.sepia / 100;
      const fk = 1 + (p.flicker > 0 ? rrange(-1, 1) * (p.flicker / 100) * 0.22 : 0);
      for (let i = 0; i < d.length; i += 4) {
        let r = d[i], g = d[i + 1], b = d[i + 2];
        if (mix > 0) {
          const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
          r += (Math.min(255, l * 1.07 + 24) - r) * mix;
          g += (Math.min(255, l * 0.89 + 8) - g) * mix;
          b += (l * 0.62 - b) * mix;
        }
        d[i] = clamp255(r * fk); d[i + 1] = clamp255(g * fk); d[i + 2] = clamp255(b * fk);
      }
      ctx.putImageData(img, 0, 0);
    }
    if (p.scratches > 0) {
      const n = Math.round((p.scratches / 100) * 4 + rnd() * 2);
      ctx.save();
      for (let i = 0; i < n; i++) {
        const x = rrange(0, W);
        ctx.globalAlpha = 0.08 + rnd() * 0.25;
        ctx.fillStyle = rnd() > 0.35 ? '#e8e2d0' : '#100c08';
        ctx.fillRect(x, 0, Math.max(1, W / 640), H);
      }
      ctx.restore();
    }
    if (p.dust > 0) {
      const n = Math.round((p.dust / 100) * 14);
      ctx.save();
      for (let i = 0; i < n; i++) {
        const x = rrange(0, W), y = rrange(0, H);
        const r = Math.max(0.5, rnd() * W * 0.004);
        ctx.globalAlpha = 0.12 + rnd() * 0.3;
        ctx.fillStyle = rnd() > 0.5 ? '#f2ecd9' : '#0a0806';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 7);
        ctx.fill();
      }
      ctx.restore();
    }
  });
}

/** Ids registered by this file — used by the tests to prove none went missing. */
export const EXTRA2_FILTER_IDS = [
  'hue', 'vignette', 'bloom', 'bulge', 'zoomblur', 'twirl', 'wave', 'emboss',
  'mirror', 'oldfilm',
];

/** True once registerExtraFilters2() has run. */
export const extraFilters2Registered = () => EXTRA2_FILTER_IDS.every((id) => !!FILTERS[id]);
