/* Dead Signal Studio — fx/filters-extra.js
 *
 * A second shelf of filters. Split from fx/filters.js purely so that file stays
 * readable — these register into the same FILTERS registry through the same
 * `filter()` helper and are identical in every other respect.
 *
 * The one rule that shapes what can live here: **a filter is a pure function of
 * (frame, t)**. It gets the pixels the renderer just drew and the clip time,
 * and nothing else. No frame history, no accumulating buffer, no state that
 * survives a call.
 *
 * That is not a limitation to route around, it is the property that makes the
 * tool trustworthy: scrubbing to 4.0s, playing through 4.0s and exporting frame
 * 48 all produce the same pixels. A filter that remembered the previous frame
 * would render differently depending on how you arrived at a time, and the
 * preview would stop being a preview.
 *
 * Two effects in the roadmap genuinely want history, and are built differently
 * because of it — see Feedback Echo and Directional Blur below. Both say so at
 * their definition rather than quietly approximating.
 */
import { rnd, rrange, seedStatic, seedStream } from '../core/rng.js';
import { hexToRgb } from '../core/text.js';
import { FILTERS, filter } from './filters.js';

/* A small pool of scratch canvases, for the same reason filters.js has its own:
   module-scope DOM would make this file un-importable outside a browser, and
   the headless suites import it.
 *
 * A POOL rather than one or two named canvases because the plate-separation
 * filters need three or four surfaces at once, and allocating them per call is
 * not free — at 1080p, two `createElement('canvas')` per frame plus the garbage
 * they leave was most of the cost of the slowest filter here (1086ms → 120ms
 * measured). Every filter below states which slots it is using. */
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
/** A cleared scratch of the right size, for building a frame up rather than copying one. */
function blank(W, H, which = 1) {
  const c = slot(which, W, H);
  const s = c.getContext('2d');
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.clearRect(0, 0, W, H);
  return c;
}
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const lerp = (a, b, u) => a + (b - a) * u;
/* hexToRgb returns a TUPLE. Named fields read far better in the colour maths
   below, and getting this wrong is quiet rather than loud: `undefined.r` in a
   pixel loop lands in a Uint8ClampedArray, where NaN clamps to 0 — so the
   filter renders a plausible-looking wrong picture instead of throwing. */
const rgb = (hex) => { const [r, g, b] = hexToRgb(hex); return { r, g, b }; };

/** Register every filter in this file. Called once at boot, before the picker fills. */
export function registerExtraFilters() {

  /* =========================================================== Colour ==== */

  /* Levels: the photographer's control, and the one thing Colour Grade cannot
     express. Grade shifts brightness and contrast around the middle; levels
     says where black and white ARE, which is how you rescue a washed-out frame
     or crush one deliberately. Gamma is the non-linear middle between them. */
  filter('levels', 'Levels / Curves', 'Colour', [
    { key: 'inLow', label: 'Input black', min: 0, max: 254, step: 1, def: 0 },
    { key: 'inHigh', label: 'Input white', min: 1, max: 255, step: 1, def: 255 },
    { key: 'gamma', label: 'Gamma ×100', min: 10, max: 300, step: 1, def: 100 },
    { key: 'outLow', label: 'Output black', min: 0, max: 255, step: 1, def: 0 },
    { key: 'outHigh', label: 'Output white', min: 0, max: 255, step: 1, def: 255 },
  ], (ctx, W, H, p) => {
    // An inverted input range would divide by zero or negate the picture; the
    // author dragging one slider past the other means "as far as it goes".
    const lo = Math.min(p.inLow, p.inHigh - 1), hi = Math.max(p.inHigh, lo + 1);
    const g = 100 / Math.max(10, p.gamma);
    // 256-entry lookup rather than pow() per subpixel: the same answer, and it
    // is the difference between a filter you can stack and one you cannot.
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      const n = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
      lut[v] = clamp255(Math.round(lerp(p.outLow, p.outHigh, Math.pow(n, g))));
    }
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]];
    }
    ctx.putImageData(img, 0, 0);
  });

  /* Duotone maps luminance across two colours. Three is a different look and
     the one most graded stills actually use — the midtones are where a grade
     reads, and a two-stop ramp runs straight through them. */
  filter('gradmap', 'Gradient Map', 'Colour', [
    { key: 'shadow', label: 'Shadows', kind: 'color', def: '#120024' },
    { key: 'mid', label: 'Midtones', kind: 'color', def: '#b0306a' },
    { key: 'highlight', label: 'Highlights', kind: 'color', def: '#ffd27f' },
    { key: 'mix', label: 'Mix', min: 0, max: 100, step: 1, def: 100 },
  ], (ctx, W, H, p) => {
    if (p.mix <= 0) return;
    const a = rgb(p.shadow), b = rgb(p.mid), c = rgb(p.highlight);
    const m = p.mix / 100;
    const lutR = new Uint8ClampedArray(256), lutG = new Uint8ClampedArray(256), lutB = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      const n = v / 255;
      const u = n < 0.5 ? n * 2 : (n - 0.5) * 2;
      const from = n < 0.5 ? a : b, to = n < 0.5 ? b : c;
      lutR[v] = lerp(from.r, to.r, u); lutG[v] = lerp(from.g, to.g, u); lutB[v] = lerp(from.b, to.b, u);
    }
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) | 0;
      d[i] = lerp(d[i], lutR[l], m);
      d[i + 1] = lerp(d[i + 1], lutG[l], m);
      d[i + 2] = lerp(d[i + 2], lutB[l], m);
    }
    ctx.putImageData(img, 0, 0);
  });

  /* Hard palette quantise. Posterize reduces bits per channel, which is a
     different thing: it keeps the hue and coarsens it. Snapping to an actual
     machine's fixed palette is what makes a frame read as *that* machine —
     the Game Boy's four greens are not four grey levels tinted, they are those
     four colours and nothing between. */
  const PALETTES = {
    cga: ['#000000', '#55ffff', '#ff55ff', '#ffffff'],
    cga2: ['#000000', '#55ff55', '#ff5555', '#ffff55'],
    ega: ['#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
      '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff'],
    gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
    teletext: ['#000000', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'],
    c64: ['#000000', '#ffffff', '#883932', '#67b6bd', '#8b3f96', '#55a049', '#40318d', '#bfce72',
      '#8b5429', '#574200', '#b86962', '#505050', '#787878', '#94e089', '#7869c4', '#9f9f9f'],
    mono: ['#000000', '#ffb000'],
  };
  filter('quantize', 'Retro Palette', 'Colour', [
    {
      key: 'palette', label: 'Palette', kind: 'select', def: 'gameboy',
      options: [
        { value: 'cga', label: 'CGA 1 (cyan/magenta)' },
        { value: 'cga2', label: 'CGA 2 (green/red)' },
        { value: 'ega', label: 'EGA 16' },
        { value: 'gameboy', label: 'Game Boy' },
        { value: 'teletext', label: 'Teletext 8' },
        { value: 'c64', label: 'Commodore 64' },
        { value: 'mono', label: 'Amber monochrome' },
      ],
    },
    { key: 'mix', label: 'Mix', min: 0, max: 100, step: 1, def: 100 },
  ], (ctx, W, H, p) => {
    if (p.mix <= 0) return;
    const pal = (PALETTES[p.palette] || PALETTES.gameboy).map(rgb);
    const m = p.mix / 100;
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      let best = 0, bestD = Infinity;
      for (let k = 0; k < pal.length; k++) {
        const dr = d[i] - pal[k].r, dg = d[i + 1] - pal[k].g, db = d[i + 2] - pal[k].b;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestD) { bestD = dist; best = k; }
      }
      d[i] = lerp(d[i], pal[best].r, m);
      d[i + 1] = lerp(d[i + 1], pal[best].g, m);
      d[i + 2] = lerp(d[i + 2], pal[best].b, m);
    }
    ctx.putImageData(img, 0, 0);
  });

  /* ========================================================== Pattern ==== */

  /* Floyd–Steinberg. The built-in ordered 4×4 Bayer dither is a *pattern* laid
     over the picture; error diffusion carries each pixel's rounding error into
     its neighbours, so the texture follows the image instead of the grid. That
     is the difference between "dithered" and "looks like a 1-bit scan". */
  filter('dither', 'Error Diffusion', 'Pattern', [
    { key: 'levels', label: 'Levels per channel', min: 2, max: 8, step: 1, def: 2 },
    { key: 'strength', label: 'Diffusion', min: 0, max: 100, step: 1, def: 100 },
  ], (ctx, W, H, p) => {
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    const steps = Math.max(2, Math.round(p.levels)) - 1;
    const k = p.strength / 100;
    // Errors are carried in a float buffer, not back into the byte array: an
    // 8-bit round trip per pixel throws away the very quantity being diffused.
    const err = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, e = (y * W + x) * 3;
        for (let c = 0; c < 3; c++) {
          const old = d[i + c] + err[e + c];
          const q = Math.round((old / 255) * steps) / steps * 255;
          d[i + c] = clamp255(q);
          const diff = (old - q) * k;
          // Standard 7/16, 3/16, 5/16, 1/16 neighbourhood, bounds-checked.
          if (x + 1 < W) err[(y * W + x + 1) * 3 + c] += diff * 0.4375;
          if (y + 1 < H) {
            if (x > 0) err[((y + 1) * W + x - 1) * 3 + c] += diff * 0.1875;
            err[((y + 1) * W + x) * 3 + c] += diff * 0.3125;
            if (x + 1 < W) err[((y + 1) * W + x + 1) * 3 + c] += diff * 0.0625;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  });

  /* ASCII. Cell luminance picks a glyph from a ramp ordered by ink coverage,
     which is the whole trick — a ramp in the wrong order renders a negative. */
  const RAMPS = {
    classic: ' .:-=+*#%@',
    blocks: ' ░▒▓█',
    code: ' .,:;i1tfLCG08@',
    binary: ' 01',
  };
  filter('ascii', 'ASCII', 'Pattern', [
    { key: 'cell', label: 'Cell px', min: 4, max: 32, step: 1, def: 8 , px: true },
    {
      key: 'ramp', label: 'Glyphs', kind: 'select', def: 'classic',
      options: [
        { value: 'classic', label: 'Classic  .:-=+*#%@' },
        { value: 'blocks', label: 'Blocks  ░▒▓█' },
        { value: 'code', label: 'Dense code ramp' },
        { value: 'binary', label: 'Binary  0 1' },
      ],
    },
    { key: 'colour', label: 'Ink', kind: 'color', def: '#39ff9e' },
    { key: 'tint', label: 'Keep source colour %', min: 0, max: 100, step: 1, def: 0 },
  ], (ctx, W, H, p) => {
    const cell = Math.max(4, Math.round(p.cell));
    const ramp = RAMPS[p.ramp] || RAMPS.classic;
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.font = `${cell}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const keep = p.tint / 100;
    for (let y = 0; y < H; y += cell) {
      for (let x = 0; x < W; x += cell) {
        // Mean over the cell, not the top-left sample: point-sampling makes the
        // output jitter wildly on any textured source.
        let sr = 0, sg = 0, sb = 0, n = 0;
        const yl = Math.min(H, y + cell), xl = Math.min(W, x + cell);
        for (let yy = y; yy < yl; yy++) for (let xx = x; xx < xl; xx++) {
          const i = (yy * W + xx) * 4;
          sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++;
        }
        if (!n) continue;
        sr /= n; sg /= n; sb /= n;
        const l = (sr * 0.2126 + sg * 0.7152 + sb * 0.0722) / 255;
        const g = ramp[Math.min(ramp.length - 1, Math.floor(l * ramp.length))];
        if (g === ' ') continue;
        if (keep > 0) {
          const c = rgb(p.colour);
          ctx.fillStyle = `rgb(${lerp(c.r, sr, keep) | 0},${lerp(c.g, sg, keep) | 0},${lerp(c.b, sb, keep) | 0})`;
        } else ctx.fillStyle = p.colour;
        ctx.fillText(g, x, y);
      }
    }
  });

  /* Kaleidoscope: one wedge of the source mirrored around the centre. Drawn
     with clip+transform rather than per-pixel, so it costs one drawImage per
     segment and stays usable at 1080×1920. */
  filter('kaleido', 'Kaleidoscope', 'Pattern', [
    { key: 'segments', label: 'Segments', min: 2, max: 16, step: 1, def: 6 },
    { key: 'spin', label: 'Spin °/s', min: -180, max: 180, step: 1, def: 12 },
    { key: 'zoom', label: 'Zoom %', min: 50, max: 300, step: 1, def: 100 },
  ], (ctx, W, H, p, t) => {
    const n = Math.max(2, Math.round(p.segments));
    const src = snap(ctx, W, H);
    const cx = W / 2, cy = H / 2;
    const R = Math.hypot(W, H) / 2;
    const step = (Math.PI * 2) / n;
    const spin = (p.spin * Math.PI / 180) * t;
    const z = p.zoom / 100;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < n; i++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(spin + i * step);
      // Every other wedge is mirrored — that reflection is what makes the seams
      // continuous instead of a pinwheel of repeated copies.
      if (i % 2) ctx.scale(1, -1);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, -step / 2, step / 2);
      ctx.closePath();
      ctx.clip();
      ctx.scale(z, z);
      ctx.drawImage(src, -cx, -cy);
      ctx.restore();
    }
  });

  /* Slit-scan. A true slit-scan samples one column per moment in TIME, which a
     single-frame filter cannot do. This is the spatial half of the effect: each
     output column is taken from a source column displaced by a travelling wave,
     which is the smear people mean when they ask for it. Honest name, honest
     comment — see the file header. */
  filter('slitscan', 'Slit Scan', 'Pattern', [
    { key: 'amount', label: 'Displacement px', min: 0, max: 300, step: 1, def: 60 , px: true },
    { key: 'waves', label: 'Waves', min: 1, max: 12, step: 1, def: 2 },
    { key: 'speed', label: 'Speed', min: 0, max: 300, step: 1, def: 60 },
    { key: 'axis', label: 'Axis', kind: 'select', def: 'v', options: [{ value: 'v', label: 'Vertical slits' }, { value: 'h', label: 'Horizontal slits' }] },
  ], (ctx, W, H, p, t) => {
    if (p.amount <= 0) return;
    const src = snap(ctx, W, H);
    ctx.clearRect(0, 0, W, H);
    const phase = t * (p.speed / 100) * Math.PI * 2;
    /* Displacement WRAPS rather than leaving the strip it vacated empty.
       Clearing and then sliding each line used to punch a transparent gash down
       one side of the frame — invisible on the video tab, where the canvas sits
       on black, and a real hole everywhere it matters: a keyed overlay showed
       the clip underneath through it, and an alpha export shipped it. Reduced
       into the frame first, so it is hole-free at ANY displacement — the
       default 60px is larger than a 48-line thumbnail, where a single wrap
       would not have been enough. */
    const wrap = (v, span) => ((v % span) + span) % span;
    if (p.axis === 'h') {
      for (let y = 0; y < H; y++) {
        const d = wrap(Math.sin((y / H) * p.waves * Math.PI * 2 + phase) * p.amount, W);
        ctx.drawImage(src, 0, y, W, 1, d, y, W, 1);
        ctx.drawImage(src, 0, y, W, 1, d - W, y, W, 1);
      }
    } else {
      for (let x = 0; x < W; x++) {
        const d = wrap(Math.sin((x / W) * p.waves * Math.PI * 2 + phase) * p.amount, H);
        ctx.drawImage(src, x, 0, 1, H, x, d, 1, H);
        ctx.drawImage(src, x, 0, 1, H, x, d - H, 1, H);
      }
    }
  });

  /* Video feedback — a camera pointed at its own monitor.
   *
   * The real thing is recursive over TIME: frame N contains frame N-1 scaled
   * and rotated, which contains N-2, and so on. A filter here cannot see N-1
   * (see the file header), so this composites the CURRENT frame onto itself
   * `depth` times, each copy transformed a little further and dimmer.
   *
   * On a still frame the two are identical. On a moving one the real effect
   * trails what just happened while this one echoes what is happening — which
   * is the honest trade for scrub, playback and export agreeing. */
  filter('feedback', 'Feedback Echo', 'Pattern', [
    { key: 'depth', label: 'Echoes', min: 1, max: 12, step: 1, def: 6 },
    { key: 'zoom', label: 'Zoom per echo %', min: 80, max: 130, step: 1, def: 104 },
    { key: 'rotate', label: 'Rotate per echo °', min: -30, max: 30, step: 0.5, def: 3 },
    { key: 'decay', label: 'Decay %', min: 5, max: 95, step: 1, def: 62 },
  ], (ctx, W, H, p) => {
    const src = snap(ctx, W, H);
    const cx = W / 2, cy = H / 2;
    const z = p.zoom / 100, rot = p.rotate * Math.PI / 180, decay = p.decay / 100;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    let a = decay, sz = z, ang = rot;
    for (let i = 0; i < Math.round(p.depth); i++) {
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.scale(sz, sz);
      ctx.drawImage(src, -cx, -cy);
      ctx.restore();
      a *= decay; sz *= z; ang += rot;
      if (a < 0.01) break;                 // below this it costs a pass and adds nothing
    }
    ctx.restore();
  });

  /* ========================================================= Analogue ==== */

  /* NTSC composite. Luma and chroma shared one wire, and chroma was carried on
     a subcarrier the decoder could never fully separate — so fine luma detail
     leaks into colour (dot crawl along edges) and saturated colour leaks into
     brightness (rainbowing). The built-in Chroma control is a flat sideways
     RGB offset, which is a different artefact entirely. */
  filter('ntsc', 'NTSC Composite', 'Analogue', [
    { key: 'crawl', label: 'Dot crawl', min: 0, max: 100, step: 1, def: 45 },
    { key: 'rainbow', label: 'Rainbowing', min: 0, max: 100, step: 1, def: 35 },
    { key: 'bleed', label: 'Chroma bleed px', min: 0, max: 24, step: 1, def: 6 , px: true },
    { key: 'speed', label: 'Crawl speed', min: 0, max: 30, step: 1, def: 6 },
  ], (ctx, W, H, p, t) => {
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    const bleed = Math.round(p.bleed);
    const crawl = p.crawl / 100, rainbow = p.rainbow / 100;
    // Chroma bleeds sideways only: the subcarrier is a horizontal signal, so
    // smearing vertically would be a blur, not a composite artefact.
    if (bleed > 0) {
      const cb = new Float32Array(W * H * 2);
      for (let y = 0; y < H; y++) {
        let accU = 0, accV = 0;
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const Y = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
          const U = d[i + 2] - Y, V = d[i] - Y;
          const k = 1 / (bleed + 1);
          accU += (U - accU) * k; accV += (V - accV) * k;
          cb[(y * W + x) * 2] = accU; cb[(y * W + x) * 2 + 1] = accV;
        }
      }
      for (let i = 0, c = 0; i < d.length; i += 4, c += 2) {
        const Y = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        const U = cb[c], V = cb[c + 1];
        d[i] = clamp255(Y + V);
        d[i + 2] = clamp255(Y + U);
        d[i + 1] = clamp255((Y - 0.299 * (Y + V) - 0.114 * (Y + U)) / 0.587);
      }
    }
    if (crawl > 0 || rainbow > 0) {
      const shift = Math.floor(t * p.speed);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          // The subcarrier alternates phase every line and every other pixel;
          // that checkerboard is exactly what dot crawl looks like on an edge.
          const phase = ((x + y + shift) & 1) ? 1 : -1;
          if (crawl > 0) {
            const left = x > 0 ? d[i - 4] : d[i];
            const edge = Math.abs(d[i] - left) / 255;
            const k = edge * crawl * 46 * phase;
            d[i] = clamp255(d[i] + k); d[i + 2] = clamp255(d[i + 2] - k);
          }
          if (rainbow > 0) {
            const Y = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
            const sat = Math.max(Math.abs(d[i] - Y), Math.abs(d[i + 2] - Y)) / 128;
            const k = sat * rainbow * 30 * phase;
            d[i + 1] = clamp255(d[i + 1] + k);
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  });

  /* Per-row RGB shift. Aberration separates channels radially and Chroma
     separates them uniformly; this separates them by a *different amount on
     every scanline*, which is the tearing-tape look neither of those makes. */
  filter('rowshift', 'Row RGB Shift', 'Analogue', [
    { key: 'amount', label: 'Max shift px', min: 0, max: 60, step: 1, def: 8 , px: true },
    { key: 'rows', label: 'Row height', min: 1, max: 32, step: 1, def: 3 },
    { key: 'rate', label: 'Re-roll per second', min: 0, max: 30, step: 1, def: 8 },
    { key: 'density', label: 'Rows affected %', min: 0, max: 100, step: 1, def: 60 },
  ], (ctx, W, H, p, t) => {
    if (p.amount <= 0 || p.density <= 0) return;
    const src = snap(ctx, W, H);
    const band = Math.max(1, Math.round(p.rows));
    seedStream('rowshift:' + (p.rate > 0 ? Math.floor(t * p.rate) : 0));
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(src, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let y = 0; y < H; y += band) {
      if (rnd() * 100 > p.density) continue;
      const dx = rrange(-1, 1) * p.amount;
      const h = Math.min(band, H - y);
      // Red one way, blue the other, and the untouched original still under
      // both — separation rather than a coloured copy sliding over the frame.
      ctx.globalAlpha = 0.5;
      ctx.filter = 'url(#none)';
      ctx.drawImage(src, 0, y, W, h, dx, y, W, h);
      ctx.drawImage(src, 0, y, W, h, -dx, y, W, h);
    }
    ctx.restore();
  });

  /* Rolling shutter. A CMOS sensor reads top to bottom over the exposure, so a
     fast pan or a vibration skews the frame progressively down the picture —
     the "jello" every phone video of an engine has. Scan Tear displaces a few
     bands abruptly; this is the smooth continuous version. */
  filter('jello', 'Rolling Shutter', 'Analogue', [
    { key: 'amount', label: 'Skew px', min: 0, max: 120, step: 1, def: 24 , px: true },
    { key: 'freq', label: 'Wobble Hz', min: 0, max: 20, step: 0.5, def: 3 },
    { key: 'shear', label: 'Constant shear px', min: -80, max: 80, step: 1, def: 0 , px: true },
  ], (ctx, W, H, p, t) => {
    if (p.amount <= 0 && p.shear === 0) return;
    const src = snap(ctx, W, H);
    ctx.clearRect(0, 0, W, H);
    for (let y = 0; y < H; y++) {
      const u = y / H;
      const raw = Math.sin((t * p.freq + u) * Math.PI * 2) * p.amount * u + p.shear * u;
      // Wrapped, for the reason spelled out in Slit Scan: a skew that clears
      // and then slides leaves a transparent wedge down one side, which is a
      // hole in the picture rather than a look.
      const dx = ((raw % W) + W) % W;
      ctx.drawImage(src, 0, y, W, 1, dx, y, W, 1);
      ctx.drawImage(src, 0, y, W, 1, dx - W, y, W, 1);
    }
  });

  /* Light leak. Film in a camera whose back was not quite light-tight: a soft
     hot wedge from one edge, warm, over everything. Deliberately additive —
     leaked light adds exposure, it does not replace the picture. */
  filter('lightleak', 'Light Leak', 'Analogue', [
    { key: 'colour', label: 'Colour', kind: 'color', def: '#ff9a3c' },
    { key: 'strength', label: 'Strength', min: 0, max: 100, step: 1, def: 45 },
    { key: 'angle', label: 'From °', min: 0, max: 360, step: 1, def: 20 },
    { key: 'spread', label: 'Spread %', min: 5, max: 100, step: 1, def: 45 },
    { key: 'flicker', label: 'Flicker', min: 0, max: 100, step: 1, def: 20 },
  ], (ctx, W, H, p, t) => {
    if (p.strength <= 0) return;
    const a = p.angle * Math.PI / 180;
    const R = Math.hypot(W, H);
    const cx = W / 2 + Math.cos(a) * R * 0.5, cy = H / 2 + Math.sin(a) * R * 0.5;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * (p.spread / 100) * 1.2);
    const c = rgb(p.colour);
    // Seeded, not Math.random: an export must flicker the same way a scrub did.
    seedStream('leak:' + Math.floor(t * 24));
    const f = 1 - (p.flicker / 100) * rnd() * 0.6;
    const s = (p.strength / 100) * f;
    g.addColorStop(0, `rgba(${c.r},${c.g},${c.b},${s})`);
    g.addColorStop(0.5, `rgba(${c.r},${c.g},${c.b},${s * 0.35})`);
    g.addColorStop(1, `rgba(${c.r},${c.g},${c.b},0)`);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  });

  /* Anamorphic streak. An anamorphic lens flares horizontally from bright
     points — the blue bar across every practical light in a 70s film. Built by
     thresholding to the highlights, smearing them sideways, and adding back. */
  filter('streak', 'Anamorphic Streak', 'Analogue', [
    { key: 'threshold', label: 'Highlight cutoff', min: 0, max: 255, step: 1, def: 190 },
    { key: 'length', label: 'Length px', min: 4, max: 400, step: 2, def: 120 , px: true },
    { key: 'strength', label: 'Strength', min: 0, max: 100, step: 1, def: 55 },
    { key: 'colour', label: 'Tint', kind: 'color', def: '#6fb7ff' },
  ], (ctx, W, H, p) => {
    if (p.strength <= 0) return;
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    const hi = blank(W, H, 2), hc = hi.getContext('2d');
    const out = hc.createImageData(W, H), od = out.data;
    const c = rgb(p.colour);
    for (let i = 0; i < d.length; i += 4) {
      const l = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
      if (l < p.threshold) continue;
      const k = (l - p.threshold) / Math.max(1, 255 - p.threshold);
      od[i] = c.r * k; od[i + 1] = c.g * k; od[i + 2] = c.b * k; od[i + 3] = 255;
    }
    hc.putImageData(out, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Halving the alpha at each doubling of offset approximates a long soft
    // smear in log(length) draws instead of `length` of them.
    const steps = 7;
    for (let s = 1; s <= steps; s++) {
      const off = (p.length / steps) * s;
      ctx.globalAlpha = (p.strength / 100) * (1 - s / (steps + 1)) * 0.5;
      ctx.drawImage(hi, off, 0);
      ctx.drawImage(hi, -off, 0);
    }
    ctx.restore();
  });

  /* CMYK misregistration. Four plates printed one at a time; if the paper moved
     between them the colours land apart. Not the same as an RGB shift — the
     plates are subtractive, so the fringes are cyan/magenta/yellow, which is
     what makes it read as print rather than as a broken monitor. */
  filter('cmyk', 'CMYK Misregistration', 'Analogue', [
    { key: 'amount', label: 'Offset px', min: 0, max: 30, step: 1, def: 4 , px: true },
    { key: 'angle', label: 'Direction °', min: 0, max: 360, step: 1, def: 30 },
    { key: 'jitter', label: 'Per-plate jitter', min: 0, max: 100, step: 1, def: 40 },
  ], (ctx, W, H, p) => {
    if (p.amount <= 0) return;
    const src = snap(ctx, W, H, 0);
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    /* Split to CMY plates as ink coverage. One pass over the source filling all
       three at once — three passes read the same pixels three times, and this
       is the hot loop at a delivery size. Slots 1-3; 0 holds the source. */
    const plates = [1, 2, 3].map((n) => blank(W, H, n));
    const ctxs = plates.map((c) => c.getContext('2d'));
    const datas = ctxs.map((c) => c.createImageData(W, H));
    const q0 = datas[0].data, q1 = datas[1].data, q2 = datas[2].data;
    for (let i = 0; i < d.length; i += 4) {
      // Cyan blocks red, magenta blocks green, yellow blocks blue — subtractive,
      // which is what makes the fringes read as print rather than as a broken
      // monitor's RGB.
      q0[i] = 0; q0[i + 1] = 255; q0[i + 2] = 255; q0[i + 3] = 255 - d[i];
      q1[i] = 255; q1[i + 1] = 0; q1[i + 2] = 255; q1[i + 3] = 255 - d[i + 1];
      q2[i] = 255; q2[i + 1] = 255; q2[i + 2] = 0; q2[i + 3] = 255 - d[i + 2];
    }
    for (let k = 0; k < 3; k++) ctxs[k].putImageData(datas[k], 0, 0);
    seedStatic('cmyk');
    const a = p.angle * Math.PI / 180;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    for (let k = 0; k < 3; k++) {
      const j = (p.jitter / 100) * rrange(-1, 1);
      const r = p.amount * ((k - 1) + j);
      ctx.drawImage(plates[k], Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.restore();
    // The original back on top at low opacity keeps the picture legible; pure
    // plates alone wash out to pastel and stop reading as the same image.
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.drawImage(src, 0, 0);
    ctx.restore();
  });

  /* Risograph: two or three spot inks on absorbent paper, each screened, each
     slightly out of register, with the paper showing through. Not a grade —
     the point is that there is no black plate, so shadows are ink overlap. */
  filter('riso', 'Risograph', 'Analogue', [
    { key: 'ink1', label: 'Ink 1', kind: 'color', def: '#ff4879' },
    { key: 'ink2', label: 'Ink 2', kind: 'color', def: '#1a5cff' },
    { key: 'paper', label: 'Paper', kind: 'color', def: '#f2ead8' },
    { key: 'grain', label: 'Grain', min: 0, max: 100, step: 1, def: 35 },
    { key: 'offset', label: 'Misregister px', min: 0, max: 12, step: 1, def: 2 , px: true },
  ], (ctx, W, H, p) => {
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    const a = rgb(p.ink1), b = rgb(p.ink2), pa = rgb(p.paper);
    /* Both plates in ONE pass over the source, into pooled canvases (slots 1-2).
       This was two allocations and two full reads per frame, and the grain was
       a third pass with its own getImageData/putImageData round trip — together
       the slowest filter in the set by an order of magnitude. Grain now rides
       on the plate alpha, which is also more truthful: the speckle of a riso is
       uneven INK, not noise added over the finished print. */
    const c1 = blank(W, H, 1), c2 = blank(W, H, 2);
    const x1 = c1.getContext('2d'), x2 = c2.getContext('2d');
    const i1 = x1.createImageData(W, H), i2 = x2.createImageData(W, H);
    const q1 = i1.data, q2 = i2.data;
    const grain = p.grain / 100;
    if (grain > 0) seedStatic('riso');
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 255;
      // Ink 1 carries the warm half of the picture, ink 2 the cool half, so the
      // two plates are not the same separation printed twice.
      const warm = (d[i] - d[i + 2] + 255) / 510;
      const g = grain > 0 ? 1 + rrange(-1, 1) * grain * 0.55 : 1;
      q1[i] = a.r; q1[i + 1] = a.g; q1[i + 2] = a.b;
      q1[i + 3] = clamp255((1 - l) * warm * 1.6 * g * 255);
      q2[i] = b.r; q2[i + 1] = b.g; q2[i + 2] = b.b;
      q2[i + 3] = clamp255((1 - l) * (1 - warm) * 1.6 * g * 255);
    }
    x1.putImageData(i1, 0, 0);
    x2.putImageData(i2, 0, 0);
    ctx.fillStyle = `rgb(${pa.r},${pa.g},${pa.b})`;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(c1, -p.offset, 0);
    ctx.drawImage(c2, p.offset, p.offset * 0.5);
    ctx.restore();
  });

  /* ======================================================== Sharpness ==== */

  /* Directional blur.
   *
   * True temporal motion blur averages the frames either side of this one, and
   * a filter cannot re-render the scene at another t (see the file header). A
   * smear along a fixed angle is the spatial equivalent, and is what "motion
   * blur" means on a generated scene where nothing is actually moving in a
   * direction the filter could measure. */
  filter('dirblur', 'Directional Blur', 'Sharpness', [
    { key: 'length', label: 'Length px', min: 0, max: 120, step: 1, def: 16 , px: true },
    { key: 'angle', label: 'Angle °', min: 0, max: 360, step: 1, def: 0 },
    { key: 'mix', label: 'Mix', min: 0, max: 100, step: 1, def: 100 },
  ], (ctx, W, H, p) => {
    if (p.length <= 0 || p.mix <= 0) return;
    const src = snap(ctx, W, H);
    const a = p.angle * Math.PI / 180;
    const n = Math.min(24, Math.max(2, Math.round(p.length / 2)));
    /* Running average on a scratch (slot 2): copy k drawn at alpha 1/(k+1) is
       an exact n-way average at full opacity. n draws at a flat 1/n only reach
       1-(1-1/n)^n ≈ 65% coverage, which left the whole frame semi-transparent
       — the preview showed the page through it and exports composited it
       toward black. Built beside the frame instead of over a clearRect so Mix
       blends the smear WITH the original rather than fading the frame out. */
    const acc = blank(W, H, 2), ac = acc.getContext('2d');
    for (let i = 0; i < n; i++) {
      const u = (i / (n - 1) - 0.5) * p.length;
      ac.globalAlpha = 1 / (i + 1);
      ac.drawImage(src, Math.cos(a) * u, Math.sin(a) * u);
    }
    ac.globalAlpha = 1;
    ctx.save();
    ctx.globalAlpha = p.mix / 100;
    ctx.drawImage(acc, 0, 0);
    ctx.restore();
  });

  /* Tilt-shift: sharp band, blurred away from it. Fakes a shallow depth of
     field, which on an architectural or overhead shot reads as a miniature. */
  filter('tiltshift', 'Tilt Shift', 'Sharpness', [
    { key: 'centre', label: 'Focus centre %', min: 0, max: 100, step: 1, def: 50 },
    { key: 'band', label: 'Sharp band %', min: 2, max: 100, step: 1, def: 22 },
    { key: 'blur', label: 'Blur px', min: 0, max: 30, step: 1, def: 8 , px: true },
    { key: 'axis', label: 'Axis', kind: 'select', def: 'h', options: [{ value: 'h', label: 'Horizontal band' }, { value: 'v', label: 'Vertical band' }] },
  ], (ctx, W, H, p) => {
    if (p.blur <= 0) return;
    const src = snap(ctx, W, H);
    const bl = blank(W, H, 2), bc = bl.getContext('2d');
    bc.filter = `blur(${p.blur}px)`;
    bc.drawImage(src, 0, 0);
    bc.filter = 'none';
    // A gradient MASK rather than two draws with alpha: the transition has to
    // be a ramp, and drawing the blur at flat opacity would just haze the
    // sharp band too.
    const m = blank(W, H, 1), mc = m.getContext('2d');
    mc.drawImage(bl, 0, 0);
    const vert = p.axis === 'v';
    const g = mc.createLinearGradient(0, 0, vert ? W : 0, vert ? 0 : H);
    const c = p.centre / 100, half = (p.band / 100) / 2;
    const stop = (v, a) => g.addColorStop(Math.min(1, Math.max(0, v)), `rgba(0,0,0,${a})`);
    stop(0, 1); stop(c - half * 2, 1); stop(c - half, 0); stop(c + half, 0); stop(c + half * 2, 1); stop(1, 1);
    mc.globalCompositeOperation = 'destination-in';
    mc.fillStyle = g;
    mc.fillRect(0, 0, W, H);
    mc.globalCompositeOperation = 'source-over';
    ctx.drawImage(m, 0, 0);
  });

  /* Neon edge glow. Edge Detect gives you the edges; this lights them — the
     sign-tubing look, where the line has a colour and a halo rather than being
     a white derivative on black. */
  filter('neonedge', 'Neon Edge', 'Sharpness', [
    { key: 'threshold', label: 'Edge cutoff', min: 0, max: 200, step: 1, def: 28 },
    { key: 'colour', label: 'Colour', kind: 'color', def: '#39d7ff' },
    { key: 'glow', label: 'Glow px', min: 0, max: 40, step: 1, def: 10 , px: true },
    { key: 'keep', label: 'Keep picture %', min: 0, max: 100, step: 1, def: 25 },
  ], (ctx, W, H, p) => {
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    const cv = blank(W, H, 2), cc = cv.getContext('2d');
    const out = cc.createImageData(W, H), od = out.data;
    const c = rgb(p.colour);
    // Sobel magnitude on luminance. Interior pixels only — a 3×3 kernel has no
    // answer at the border, and wrapping would draw a bright frame edge.
    const lum = new Float32Array(W * H);
    for (let i = 0, k = 0; i < d.length; i += 4, k++) lum[k] = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const k = y * W + x;
      const gx = -lum[k - W - 1] - 2 * lum[k - 1] - lum[k + W - 1] + lum[k - W + 1] + 2 * lum[k + 1] + lum[k + W + 1];
      const gy = -lum[k - W - 1] - 2 * lum[k - W] - lum[k - W + 1] + lum[k + W - 1] + 2 * lum[k + W] + lum[k + W + 1];
      const mag = Math.hypot(gx, gy);
      if (mag < p.threshold) continue;
      const a = Math.min(1, (mag - p.threshold) / 128);
      const i = k * 4;
      od[i] = c.r; od[i + 1] = c.g; od[i + 2] = c.b; od[i + 3] = a * 255;
    }
    cc.putImageData(out, 0, 0);
    ctx.save();
    ctx.globalAlpha = p.keep / 100;
    ctx.fillStyle = '#000';
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1 - p.keep / 100;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (p.glow > 0) {
      ctx.filter = `blur(${p.glow}px)`;
      ctx.drawImage(cv, 0, 0);
      ctx.filter = 'none';
    }
    ctx.drawImage(cv, 0, 0);
    ctx.restore();
  });

  /* ============================================================ Frame ==== */

  /* Lower third. Text Stamp puts a string anywhere; this is the broadcast
     furniture — a bar with a name and a role, sliding in and back out — which
     is a layout with a schedule, not a label at a coordinate. */
  filter('lower3', 'Lower Third', 'Frame', [
    { key: 'title', label: 'Name', kind: 'text', def: 'M. WEBB' },
    { key: 'subtitle', label: 'Role', kind: 'text', def: 'LEAD ARCHITECT — MISSING 47d' },
    { key: 'bar', label: 'Bar', kind: 'color', def: '#0b1a2b' },
    { key: 'accent', label: 'Accent', kind: 'color', def: '#39ff9e' },
    { key: 'y', label: 'Y %', min: 0, max: 100, step: 1, def: 74 },
    { key: 'size', label: 'Size px', min: 8, max: 64, step: 1, def: 20 , px: true },
    { key: 'in', label: 'In at s', min: 0, max: 30, step: 0.1, def: 0.5 },
    { key: 'hold', label: 'Hold s', min: 0.5, max: 60, step: 0.5, def: 4 },
  ], (ctx, W, H, p, t) => {
    const local = t - p.in;
    if (local < 0 || local > p.hold) return;
    // Eased slide in and out, 0.4s each end, clamped so a short hold still
    // completes both — otherwise a 0.5s hold would pop rather than animate.
    const ramp = Math.min(0.4, p.hold / 2);
    const u = local < ramp ? local / ramp
      : local > p.hold - ramp ? (p.hold - local) / ramp : 1;
    const e = u * u * (3 - 2 * u);
    const size = p.size;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = e;
    ctx.font = `bold ${size}px ui-monospace, Menlo, Consolas, monospace`;
    const tw = ctx.measureText(p.title).width;
    ctx.font = `${size * 0.62}px ui-monospace, Menlo, Consolas, monospace`;
    const sw = ctx.measureText(p.subtitle).width;
    const pad = size * 0.7;
    const boxW = Math.min(W - pad * 2, Math.max(tw, sw) + pad * 2);
    const boxH = size * (p.subtitle ? 2.5 : 1.7);
    const x = pad - (1 - e) * boxW * 0.35, y = H * (p.y / 100);
    ctx.fillStyle = p.bar;
    ctx.fillRect(x, y, boxW, boxH);
    ctx.fillStyle = p.accent;
    ctx.fillRect(x, y, Math.max(2, size * 0.16), boxH);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${size}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillText(p.title, x + pad, y + size * 0.34);
    if (p.subtitle) {
      ctx.fillStyle = p.accent;
      ctx.font = `${size * 0.62}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillText(p.subtitle, x + pad, y + size * 1.5);
    }
    ctx.restore();
  });

  /* Burned-in timecode. The window dub every edit suite made, so an offline
     cut could be conformed later. HH:MM:SS:FF counted from a start offset at a
     declared rate — the frame counter is the point, so it wraps at `fps`
     rather than counting hundredths. */
  filter('timecode', 'Timecode Burn', 'Frame', [
    { key: 'start', label: 'Start s', min: 0, max: 86399, step: 1, def: 13620 },
    { key: 'fps', label: 'Frames/s', min: 1, max: 60, step: 1, def: 24 },
    { key: 'size', label: 'Size px', min: 8, max: 48, step: 1, def: 16 , px: true },
    { key: 'x', label: 'X %', min: 0, max: 100, step: 1, def: 50 },
    { key: 'y', label: 'Y %', min: 0, max: 100, step: 1, def: 92 },
    { key: 'colour', label: 'Colour', kind: 'color', def: '#ffffff' },
    { key: 'plate', label: 'Backing %', min: 0, max: 100, step: 1, def: 70 },
    { key: 'label', label: 'Prefix', kind: 'text', def: 'REC' },
  ], (ctx, W, H, p, t) => {
    const total = p.start + t;
    const fps = Math.max(1, Math.round(p.fps));
    const hh = Math.floor(total / 3600) % 24;
    const mm = Math.floor(total / 60) % 60;
    const ss = Math.floor(total) % 60;
    const ff = Math.floor((total % 1) * fps);
    const two = (n) => String(n).padStart(2, '0');
    const text = (p.label ? p.label + '  ' : '') + `${two(hh)}:${two(mm)}:${two(ss)}:${two(ff)}`;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${p.size}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const w = ctx.measureText(text).width, x = W * (p.x / 100), y = H * (p.y / 100);
    if (p.plate > 0) {
      ctx.fillStyle = `rgba(0,0,0,${p.plate / 100})`;
      ctx.fillRect(x - w / 2 - p.size * 0.4, y - p.size * 0.75, w + p.size * 0.8, p.size * 1.5);
    }
    ctx.fillStyle = p.colour;
    ctx.fillText(text, x, y);
    ctx.restore();
  });
}

/** Ids registered by this file — used by the tests to prove none went missing. */
export const EXTRA_FILTER_IDS = [
  'levels', 'gradmap', 'quantize',
  'dither', 'ascii', 'kaleido', 'slitscan', 'feedback',
  'ntsc', 'rowshift', 'jello', 'lightleak', 'streak', 'cmyk', 'riso',
  'dirblur', 'tiltshift', 'neonedge',
  'lower3', 'timecode',
];

/** True once registerExtraFilters() has run. */
export const extraFiltersRegistered = () => EXTRA_FILTER_IDS.every((id) => !!FILTERS[id]);
