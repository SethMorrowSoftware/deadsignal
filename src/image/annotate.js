/* Dead Signal Studio — image/annotate.js
 *
 * Draws the annotation layer, and hands back where everything landed.
 *
 * Two things it must do that are easy to get wrong:
 *
 * 1. It draws BEFORE applyStillFx, not after. An annotation is meant to be on
 *    the screen, not on the glass in front of it — a caption that misses the
 *    scanlines, the noise and the vignette reads as a screenshot someone wrote
 *    on afterwards, which is the opposite of the effect. The one exception is
 *    the selection outline, which is chrome and never renders into an export.
 *
 * 2. It returns the hit boxes it just drew, in canvas pixels. Text width is not
 *    knowable without a context and a font, so the panel cannot compute what to
 *    hit-test — the draw is the only place that knows, and handing the boxes
 *    back is cheaper and more honest than measuring twice with two copies of
 *    the layout maths that would drift apart.
 */
import { setFont, wrapLines } from '../core/text.js';
import { ANNOTATION_KINDS, annotationKind, rectOf } from '../doc/annotations.js';

/** The corner grip, in canvas pixels. Small, but it is the only resize handle. */
export const GRIP = 8;

/* The same relation the paper templates use between the author's font control
   and the canvas, so an annotation at 100% matches the screen's own body type
   rather than being an unrelated number of pixels. */
const baseType = (c, W, H) => Math.max(6, ((c?.font || 15) / 15) * Math.min(W, H) * 0.033);

/** Line thickness in pixels, scaled to the canvas so a 4× export is not hairline. */
const strokeOf = (a, W, H) => Math.max(1, a.weight * (Math.min(W, H) / 360));

function drawText(ctx, a, W, H, c, color) {
  const px = baseType(c, W, H) * (a.size / 100);
  setFont(ctx, px);
  ctx.fillStyle = color;
  ctx.textAlign = a.align;
  ctx.textBaseline = 'top';
  const x = a.x * W, y = a.y * H;
  // A width of zero means "one line" — the default, and the thing an author
  // placing a stamp or a label wants. Anything else wraps to that width.
  const maxW = Math.abs(a.w) * W;
  const lines = maxW > 4 ? wrapLines(ctx, a.text, maxW) : a.text.split('\n');
  const lh = px * 1.25;
  let widest = 0;
  lines.forEach((ln, i) => {
    ctx.fillText(ln, x, y + i * lh);
    widest = Math.max(widest, ctx.measureText(ln).width);
  });
  const boxW = maxW > 4 ? maxW : widest;
  const left = a.align === 'center' ? x - boxW / 2 : a.align === 'right' ? x - boxW : x;
  return { x: left, y, w: Math.max(6, boxW), h: Math.max(6, lines.length * lh) };
}

function drawShape(ctx, a, W, H, color) {
  const lw = strokeOf(a, W, H);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const spec = annotationKind(a.kind);

  if (spec.diagonal) {
    // From the anchor to the corner the author dragged to — which is why w/h
    // keep their sign, and why the head goes on the far end.
    const x0 = a.x * W, y0 = a.y * H, x1 = (a.x + a.w) * W, y1 = (a.y + a.h) * H;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    if (a.kind === 'arrow') {
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const head = Math.max(6, lw * 4);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - head * Math.cos(ang - 0.4), y1 - head * Math.sin(ang - 0.4));
      ctx.lineTo(x1 - head * Math.cos(ang + 0.4), y1 - head * Math.sin(ang + 0.4));
      ctx.closePath(); ctx.fill();
    }
    const r = rectOf(a);
    // A perfectly horizontal or vertical line has a zero-height/width box and
    // would be unclickable, so the hit area is padded to the stroke.
    const pad = Math.max(8, lw * 2);
    return { x: r.x * W - pad / 2, y: r.y * H - pad / 2,
      w: Math.max(pad, r.w * W + pad), h: Math.max(pad, r.h * H + pad) };
  }

  const r = rectOf(a);
  const x = r.x * W, y = r.y * H, w = Math.max(1, r.w * W), h = Math.max(1, r.h * H);
  if (a.kind === 'fill') ctx.fillRect(x, y, w, h);
  else if (a.kind === 'ellipse') {
    ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.stroke();
  } else ctx.strokeRect(x, y, w, h);
  return { x, y, w, h };
}

/**
 * Draw every annotation and return their hit boxes, in canvas pixels.
 *
 * The marks only — never the selection outline. That is drawn separately, by
 * drawSelection, and the split is the whole point: marks go under the CRT pass
 * so they belong to the screen, chrome goes over it so it stays legible and can
 * be left out of an export entirely.
 */
export function drawAnnotations(ctx, W, H, list, c) {
  const boxes = [];
  if (!Array.isArray(list) || !list.length) return boxes;
  const fg = c?.fg || '#39ff9e';
  /* One save/restore for the whole layer: font, fill, stroke, dash and the two
     text-alignment flags are all canvas state, so the template that drew before
     this and the FX that run after it are untouched by anything here. */
  ctx.save();
  for (const a of list) {
    ctx.save();
    const color = a.color || fg;
    const spec = annotationKind(a.kind) || ANNOTATION_KINDS[0];
    boxes.push(spec.text ? drawText(ctx, a, W, H, c, color) : drawShape(ctx, a, W, H, color));
    ctx.restore();
  }
  ctx.restore();
  return boxes;
}

/**
 * The dashed outline and corner grip around the selected mark.
 *
 * Drawn AFTER the CRT/paper pass, unlike the marks themselves. A selection
 * outline that has been scanlined, posterized and halftoned is unreadable at
 * exactly the moment it matters, and it is not part of the picture anyway —
 * it is the editor. Callers that produce a file (export, the stego decoder,
 * batch, a timeline still) simply never call this.
 */
export function drawSelection(ctx, box) {
  if (!box) return;
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 1;
  ctx.strokeRect(box.x - 2, box.y - 2, box.w + 4, box.h + 4);
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffb347';
  ctx.fillRect(box.x + box.w - 3, box.y + box.h - 3, GRIP, GRIP);
  ctx.restore();
}

/**
 * Which annotation is under this point, topmost first, or -1.
 *
 * Topmost first because later annotations draw over earlier ones, and clicking
 * what you can see is the only rule anyone expects.
 */
export function hitAnnotation(boxes, px, py) {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (px >= b.x - 3 && px <= b.x + b.w + 3 && py >= b.y - 3 && py <= b.y + b.h + 3) return i;
  }
  return -1;
}

/** Is this point on the selected annotation's resize grip? */
export function onGrip(box, px, py) {
  if (!box) return false;
  const gx = box.x + box.w - 3, gy = box.y + box.h - 3;
  return px >= gx - 4 && px <= gx + GRIP + 4 && py >= gy - 4 && py <= gy + GRIP + 4;
}
