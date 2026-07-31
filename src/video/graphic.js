/* Dead Signal Studio — video/graphic.js
 *
 * Drawing a shape onto a cleared buffer. The second renderer in this tool that
 * clears rather than fills; see video/title.js for why that one line is the
 * whole architectural cost of compositing over the picture.
 *
 * Everything is measured from the frame — position and size are fractions, and
 * the stroke weight is a percentage of the SHORT side, so a two-pixel line on a
 * preview is still a two-pixel line proportionally on a 4x export instead of a
 * hairline that disappears. The only literal pixel in this file is the 1px
 * floor on the stroke, which stops a thin line rounding to nothing at thumbnail
 * sizes and vanishing.
 */
import { graphicAlpha, graphicDraw, graphicScale, isDiagonal, isEmptyGraphic, rectOfGraphic }
  from '../doc/graphic.js';

/** `#rrggbb` plus an alpha, as a canvas colour. */
function withAlpha(hex, a) {
  const h = String(hex || '#000000').replace('#', '');
  // Nibble-expand short values (keyPrep's reading), so a 4/5-digit colour the
  // validator accepts is not mis-parsed into an unrelated one by slice(0,6).
  const full = h.length < 6
    ? h.split('').map((c) => c + c).join('').slice(0, 6).padEnd(6, '0')
    : h.slice(0, 6);
  const n = parseInt(full, 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

/** A rounded rectangle as a path, falling back to a plain one at radius 0. */
function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  if (rad <= 0.5) { ctx.rect(x, y, w, h); return; }
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/**
 * Reveal a stroked path progressively.
 *
 * Done with the dash array rather than by re-tracing a partial path: one dash
 * as long as the whole outline, offset by however much is still to come, walks
 * the pen along ANY path — a rounded rectangle, an ellipse, four separate
 * bracket corners — without this file needing to know how to walk each of them
 * itself. `len` only has to be an over-estimate of the true perimeter.
 */
function withDrawOn(ctx, u, len, fn) {
  if (u >= 1) { fn(); return; }
  if (u <= 0) return;
  const prevDash = ctx.getLineDash();
  const prevOff = ctx.lineDashOffset;
  ctx.setLineDash([len * u, len]);
  ctx.lineDashOffset = 0;
  fn();
  ctx.setLineDash(prevDash);
  ctx.lineDashOffset = prevOff;
}

/**
 * Draw one graphic into `ctx` at time `t` of a clip `len` seconds long.
 *
 * The buffer is cleared first. `t` is measured from the clip's own start, so
 * the shape is a function of this instant alone and the exporter can render
 * frames in any order.
 */
export function drawGraphicTo(ctx, W, H, g, t, len) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (isEmptyGraphic(g)) return;

  const alpha = graphicAlpha(t, len, g);
  if (!(alpha > 0.001)) return;

  const short = Math.min(W, H);
  const lw = Math.max(1, (g.weight / 100) * short);
  const { sx, sy } = graphicScale(t, len, g);
  if (!(sx > 0.0001) || !(sy > 0.0001)) return;
  const u = graphicDraw(t, len, g);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = g.colour;
  ctx.fillStyle = g.colour;
  if (g.dash > 0) ctx.setLineDash([lw * g.dash, lw * g.dash]);

  if (isDiagonal(g.shape)) {
    /* A vector, so the scale and the rotation are about the TAIL rather than a
       centre: an arrow that pops should grow out of the end it is anchored to
       and point at the same thing throughout, not sweep across the frame. */
    const x0 = g.x * W; const y0 = g.y * H;
    ctx.translate(x0, y0);
    if (g.rot) ctx.rotate((g.rot * Math.PI) / 180);
    ctx.scale(sx, sy);
    const dx = g.w * W; const dy = g.h * H;
    const length = Math.hypot(dx, dy);
    withDrawOn(ctx, u, length + lw * 8, () => {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(dx, dy); ctx.stroke();
    });
    // The head is drawn only once the shaft has arrived — a floating arrowhead
    // ahead of its own line is the giveaway that this was faked.
    if (g.shape === 'arrow' && u > 0.92) {
      const ang = Math.atan2(dy, dx);
      const head = Math.max(4, lw * 4);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(dx, dy);
      ctx.lineTo(dx - head * Math.cos(ang - 0.4), dy - head * Math.sin(ang - 0.4));
      ctx.lineTo(dx - head * Math.cos(ang + 0.4), dy - head * Math.sin(ang + 0.4));
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  const r = rectOfGraphic(g);
  const w = r.w * W; const h = r.h * H;
  const cx = (r.x + r.w / 2) * W; const cy = (r.y + r.h / 2) * H;
  // Rectangle kinds scale and rotate about their own CENTRE, which is what
  // "pop" and "shrink" mean for a box: it grows in place.
  ctx.translate(cx, cy);
  if (g.rot) ctx.rotate((g.rot * Math.PI) / 180);
  ctx.scale(sx, sy);
  const x = -w / 2; const y = -h / 2;
  const rad = g.radius * Math.min(w, h);
  const perim = (w + h) * 2 + lw * 8;

  // Any fill goes down first, under the stroke, and is not walked on by the
  // draw-on gesture — a fill has no outline to follow.
  if (g.fillAlpha > 0 && g.shape !== 'fill' && g.shape !== 'disc') {
    ctx.fillStyle = withAlpha(g.fill, g.fillAlpha);
    if (g.shape === 'ellipse') {
      ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill();
    } else { roundRect(ctx, x, y, w, h, rad); ctx.fill(); }
    ctx.fillStyle = g.colour;
  }

  switch (g.shape) {
    case 'fill':
      roundRect(ctx, x, y, w, h, rad);
      ctx.fill();
      break;
    case 'disc':
      ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill();
      break;
    case 'ellipse':
      withDrawOn(ctx, u, Math.PI * (w + h) / 2 + lw * 8, () => {
        ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.stroke();
      });
      break;
    case 'bracket': {
      /* Four corners with the sides left out — the framing a camera draws
         around a face. The arm is a quarter of the shorter side, so it stays a
         corner rather than becoming a box as the rectangle gets thin. */
      const arm = Math.max(lw * 2, Math.min(w, h) * 0.25);
      withDrawOn(ctx, u, (arm * 8) + lw * 8, () => {
        ctx.beginPath();
        for (const [px, py, ax, ay] of [
          [x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1],
        ]) {
          ctx.moveTo(px + arm * ax, py); ctx.lineTo(px, py); ctx.lineTo(px, py + arm * ay);
        }
        ctx.stroke();
      });
      break;
    }
    case 'crosshair': {
      const rx = w / 2; const ry = h / 2;
      const gap = Math.min(rx, ry) * 0.35;
      withDrawOn(ctx, u, Math.PI * (rx + ry) + (rx + ry) * 2 + lw * 8, () => {
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        // Ticks that stop short of the centre, so the thing being aimed at is
        // not covered by the reticle aiming at it.
        ctx.moveTo(-rx, 0); ctx.lineTo(-gap, 0);
        ctx.moveTo(gap, 0); ctx.lineTo(rx, 0);
        ctx.moveTo(0, -ry); ctx.lineTo(0, -gap);
        ctx.moveTo(0, gap); ctx.lineTo(0, ry);
        ctx.stroke();
      });
      break;
    }
    default:
      withDrawOn(ctx, u, perim, () => { roundRect(ctx, x, y, w, h, rad); ctx.stroke(); });
  }

  ctx.restore();
}
