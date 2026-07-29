/* Dead Signal Studio — video/matte.js
 *
 * Putting alpha into a buffer that a scene has just filled edge to edge.
 *
 * The third renderer in this tool that ends up with a transparent buffer, and
 * the first that gets there by SUBTRACTION. A title and a graphic clear their
 * buffer and draw a little into it; a keyed clip fills its buffer with a whole
 * picture and then takes some of it away again. The compositor cannot tell the
 * difference and does not need to — see doc/matte.js for why one line about
 * alpha is the whole architectural cost of compositing over the picture.
 *
 * WHAT RUNS PER PIXEL AND WHAT DOES NOT
 *
 * The key is the only per-pixel pass in this file, and it is guarded twice: it
 * does not run at all unless the clip asked for it, and everything about the key
 * that does not depend on the pixel is worked out once per frame by keyPrep().
 * The mask is done entirely with composite operations, which is not a
 * micro-optimisation but the reason a feathered edge is possible at all — a
 * per-pixel distance-to-a-rotated-ellipse would be both slower and worse.
 *
 * EVERY FUNCTION HERE LEAVES THE CONTEXT AS IT FOUND IT
 *
 * Not a courtesy. This draws onto the shared clip scratch inside the compositor,
 * mid-sequence, and a globalCompositeOperation left set would tint every later
 * draw on that context — including, on the export path, the next frame. The deep
 * audit asserts it for all 139 draw routines and this is three more.
 */
import {
  despillTo, hasMatte, keyActive, keyAlphaAt, keyPrep, makeMatte, maskActive, maskRectOf,
} from '../doc/matte.js';

/* Lazily, like every other scratch surface in this tool: a module that touched
   `document` at import time could not be loaded by the headless suites. */
let _maskC = null; let _workC = null; let _tinyC = null;
const maskCanvas = () => _maskC || (_maskC = document.createElement('canvas'));
const workCanvas = () => _workC || (_workC = document.createElement('canvas'));
const tinyCanvas = () => _tinyC || (_tinyC = document.createElement('canvas'));

/** The strongest blur a mask can ask for, as a fraction of the frame's short side. */
const BLUR_MAX = 0.06;
/** The coarsest mosaic, likewise — a face at 10% of the short side is gone. */
const CELL_MIN = 0.01;
const CELL_MAX = 0.10;

/**
 * Turn on a canvas blur, and say whether it took.
 *
 * `ctx.filter` is the only blur a canvas offers that is not a convolution
 * written by hand, and it is what fx/filters.js already uses. It is also the one
 * piece of this feature that a browser can simply not have — assigning to a
 * property that does not exist is silent, so the value is read back rather than
 * assumed. Every caller has a degrade path for `false`.
 */
function setBlur(cx, px) {
  if (!(px >= 0.5)) return false;
  try { cx.filter = `blur(${px}px)`; } catch { return false; }
  return typeof cx.filter === 'string' && cx.filter !== 'none';
}
const clearBlur = (cx) => { try { cx.filter = 'none'; } catch { /* never set */ } };

/**
 * The mask's shape, as a filled path in frame pixels.
 *
 * Rotation is about the shape's own centre, which is the only reading of
 * "rotate a mask" that keeps it over the thing it was covering.
 */
function paintShape(mx, W, H, m) {
  const r = maskRectOf(m);
  const w = r.w * W; const h = r.h * H;
  const cx = (r.x + r.w / 2) * W; const cy = (r.y + r.h / 2) * H;
  mx.save();
  mx.translate(cx, cy);
  if (m.maskRot) mx.rotate((m.maskRot * Math.PI) / 180);
  mx.beginPath();
  if (m.maskShape === 'ellipse') mx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else mx.rect(-w / 2, -h / 2, w, h);
  mx.fill();
  mx.restore();
}

/**
 * A canvas that is opaque where the mask selects and clear where it does not.
 *
 * Feathering is the blur applied to THIS shape rather than to the picture, which
 * is what makes one implementation soften a rectangle, a rotated rectangle and
 * an ellipse without knowing which it has. Inverting is the same shape punched
 * out of a full frame — and because the filter applies to the source before it
 * is composited, the punched hole is feathered too rather than becoming the one
 * hard edge in a soft mask.
 */
function buildMask(W, H, m) {
  const c = maskCanvas();
  if (c.width !== W) c.width = W;
  if (c.height !== H) c.height = H;
  const mx = c.getContext('2d');
  mx.setTransform(1, 0, 0, 1, 0, 0);
  mx.globalCompositeOperation = 'source-over';
  mx.globalAlpha = 1;
  mx.clearRect(0, 0, W, H);
  mx.fillStyle = '#ffffff';
  if (m.maskInvert) {
    mx.fillRect(0, 0, W, H);
    mx.globalCompositeOperation = 'destination-out';
  }
  const blurred = setBlur(mx, m.maskFeather * Math.min(W, H));
  paintShape(mx, W, H, m);
  if (blurred) clearBlur(mx);
  mx.globalCompositeOperation = 'source-over';
  return c;
}

/** A blurred copy of `src` into `wx`, however this browser can manage one. */
function drawBlurred(wx, src, W, H, amount) {
  const px = amount * BLUR_MAX * Math.min(W, H);
  /* Amount at nothing means nothing, on every mode. Without this the degrade
     path below would still run its two draws and soften the region anyway — a
     control at zero that visibly does something is worse than one that does
     nothing, because it looks like the tool ignoring you. */
  if (px < 0.5) { wx.drawImage(src, 0, 0, W, H); return; }
  if (setBlur(wx, px)) {
    wx.drawImage(src, 0, 0, W, H);
    clearBlur(wx);
    return;
  }
  /* No canvas filter. Averaging down and smoothing back up is a real blur —
     a box filter with a very large box — and it is the same two draws the
     mosaic below makes, with the smoothing left ON. Coarser than a gaussian,
     and a face is still unrecognisable, which is the whole job. */
  const shrink = Math.max(2, Math.round(px));
  const sw = Math.max(1, Math.round(W / shrink)); const sh = Math.max(1, Math.round(H / shrink));
  const t = tinyCanvas();
  if (t.width !== sw) t.width = sw;
  if (t.height !== sh) t.height = sh;
  const tx = t.getContext('2d');
  tx.setTransform(1, 0, 0, 1, 0, 0);
  tx.clearRect(0, 0, sw, sh);
  tx.imageSmoothingEnabled = true;
  tx.drawImage(src, 0, 0, sw, sh);
  wx.imageSmoothingEnabled = true;
  wx.drawImage(t, 0, 0, sw, sh, 0, 0, W, H);
}

/** A mosaic copy of `src` into `wx`. */
function drawPixelated(wx, src, W, H, amount) {
  // …and the same at zero, so all four modes agree about what "none" means.
  if (!(amount > 0.001)) { wx.drawImage(src, 0, 0, W, H); return; }
  const short = Math.min(W, H);
  const cell = Math.max(2, Math.round(short * (CELL_MIN + amount * (CELL_MAX - CELL_MIN))));
  const sw = Math.max(1, Math.round(W / cell)); const sh = Math.max(1, Math.round(H / cell));
  const t = tinyCanvas();
  if (t.width !== sw) t.width = sw;
  if (t.height !== sh) t.height = sh;
  const tx = t.getContext('2d');
  tx.setTransform(1, 0, 0, 1, 0, 0);
  tx.clearRect(0, 0, sw, sh);
  /* Smoothing ON going down, so each block is the AVERAGE of what it covers
     rather than one sampled pixel from it — a nearest-neighbour shrink of a
     detailed face is noise, not a mosaic. */
  tx.imageSmoothingEnabled = true;
  tx.drawImage(src, 0, 0, sw, sh);
  // …and OFF coming back up, which is what makes the blocks blocks.
  wx.imageSmoothingEnabled = false;
  wx.drawImage(t, 0, 0, sw, sh, 0, 0, W, H);
  wx.imageSmoothingEnabled = true;
}

/**
 * Apply the clip's mask to its own buffer.
 *
 * 'reveal' is one composite — the buffer keeps only what the mask covers. The
 * other three build the altered picture on a scratch, confine THAT to the mask,
 * and lay it back over the original: the alteration is what is masked, not the
 * clip, so everything outside the shape is the untouched original rather than a
 * second draw of it.
 */
function applyMask(ctx, W, H, m) {
  const mask = buildMask(W, H, m);

  if (m.maskMode === 'reveal') {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0);
    ctx.restore();
    return;
  }

  const work = workCanvas();
  if (work.width !== W) work.width = W;
  if (work.height !== H) work.height = H;
  const wx = work.getContext('2d');
  wx.setTransform(1, 0, 0, 1, 0, 0);
  wx.globalCompositeOperation = 'source-over';
  wx.globalAlpha = 1;
  wx.clearRect(0, 0, W, H);

  if (m.maskMode === 'blur') drawBlurred(wx, ctx.canvas, W, H, m.maskAmount);
  else if (m.maskMode === 'pixelate') drawPixelated(wx, ctx.canvas, W, H, m.maskAmount);
  else { wx.fillStyle = `rgba(0,0,0,${Math.max(0, Math.min(1, m.maskAmount))})`; wx.fillRect(0, 0, W, H); }

  wx.globalCompositeOperation = 'destination-in';
  wx.drawImage(mask, 0, 0);
  wx.globalCompositeOperation = 'source-over';

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  /* A darkening is drawn `source-atop` so it lands on the clip's own picture and
     nowhere else — on a title, that means the letters dim and the transparent
     space around them stays transparent instead of acquiring a grey panel. A
     blur is drawn `source-over` because a blur that cannot spread past the
     silhouette it came from is not a blur. */
  ctx.globalCompositeOperation = m.maskMode === 'dim' ? 'source-atop' : 'source-over';
  ctx.drawImage(work, 0, 0);
  ctx.restore();
}

/**
 * Remove the keyed colour from the clip's buffer.
 *
 * One pass, in place. The alpha is MULTIPLIED into whatever was already there
 * rather than assigned, so keying a title (or anything else that arrived with an
 * alpha channel) narrows the picture instead of re-opening the parts of it that
 * were already transparent.
 */
function applyKey(ctx, W, H, clip) {
  const prep = keyPrep(clip);
  if (prep.mode === 'off') return;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const out = [0, 0, 0];
  const spilling = prep.mode === 'chroma' && prep.spill > 0;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 0) continue;
    const k = keyAlphaAt(prep, d[i], d[i + 1], d[i + 2]);
    if (k <= 0) { d[i + 3] = 0; continue; }
    if (k < 1) d[i + 3] = a * k;
    /* Only what survived is worth despilling, and only when a key ran: an
       untouched pixel has no fringe to remove and doing it anyway would drain
       the green out of a picture that never had a green screen in it. */
    if (spilling) {
      despillTo(prep, d[i], d[i + 1], d[i + 2], out);
      d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2];
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Everything this clip asked to have taken out of its own picture.
 *
 * Called at the end of renderClipTo, so it applies to every clip kind and on
 * every path that renders one — the preview, both exporters and the batch
 * runner all reach it through the same function rather than through four
 * copies of this call.
 *
 * The key runs first. It decides by colour, so it has to see the picture the
 * scene actually drew; running it after a blur would key the smeared colours of
 * a face rather than the screen behind it, and after a reveal it would be asked
 * about pixels that are already gone.
 *
 * The whole matte runs AFTER the clip's own look — its filters, its layers, its
 * grain — because renderClipTo has already finished by the time this is called.
 * That is the right way round and not merely the convenient one: half the filter
 * chain fills or blends across the entire frame (bloom, vignette, the CRT
 * stack), so a key applied before them would have its transparency painted
 * straight back in, and the author would be keying a picture they cannot see.
 * Here, what you key is what is on the monitor.
 */
export function applyMatteTo(ctx, W, H, clip) {
  if (!clip || !hasMatte(clip)) return;
  if (keyActive(clip)) applyKey(ctx, W, H, clip);
  if (maskActive(clip)) applyMask(ctx, W, H, makeMatte(clip));
}
