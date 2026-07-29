/* Dead Signal Studio — video/title.js
 *
 * Drawing a title. The one renderer in this tool that CLEARS its buffer instead
 * of filling it.
 *
 * That single line is the whole reason titles work. Every scene opens by
 * painting its own background — the house rule in scenes.js, and the right one
 * for something that IS the picture. A title is not the picture; it is marks on
 * top of one. Clearing leaves the buffer transparent, and from there the
 * existing compositor does everything else for free: drawClipTo() composites a
 * canvas with alpha exactly as it composites an opaque one, so a title inherits
 * the clip transform, V2's blend mode and opacity, and every transition without
 * one line of special-casing in renderTimelineFrame.
 *
 * Everything is measured from the frame, never in fixed pixels — see the
 * docblock in doc/title.js for why. The only pixel value in this file is the
 * one-pixel minimum on a stroke width, which exists so a hairline outline at a
 * thumbnail size does not round to nothing and vanish.
 */
/* setFontStack / setTracking are module state in core/text.js, established once
   per frame by whichever renderer is drawing — video/render.js and
   image/render.js both do it on their first line. This one does the same, which
   is why it does not have to put anything back: the next clip's renderer sets
   its own before it draws a glyph. */
import { macros, setFont, setFontStack, setTracking } from '../core/text.js';
import { steadyNoise, isBlankTitle, titleAlpha, titleAnchor, titleLines, titleReveal, titleRise,
  titleRollAt, titleScale } from '../doc/title.js';

/** `#rrggbb` plus an alpha, as a canvas colour. */
function withAlpha(hex, a) {
  const h = String(hex || '#000000').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

/**
 * How many characters of a block are visible at reveal `u`.
 *
 * Counted across the WHOLE block rather than per line, so a two-line title
 * types on continuously instead of both lines racing each other to the end.
 */
function typed(lines, u) {
  if (u >= 1) return lines;
  const total = lines.reduce((n, l) => n + l.length, 0);
  let left = Math.floor(total * u);
  return lines.map((l) => {
    if (left <= 0) return '';
    const take = Math.min(l.length, left);
    left -= take;
    return l.slice(0, take);
  });
}

/**
 * The same, a WORD at a time.
 *
 * A different gesture from the typewriter, not a coarser one: a typewriter is a
 * machine printing, and word-by-word is someone speaking. Whitespace is kept
 * with the word before it so the line does not shuffle sideways as it fills.
 */
function worded(lines, u) {
  if (u >= 1) return lines;
  const split = lines.map((l) => l.match(/\S+\s*/g) || []);
  const total = split.reduce((n, w) => n + w.length, 0);
  let left = Math.floor(total * u);
  return split.map((words) => {
    if (left <= 0) return '';
    const take = Math.min(words.length, left);
    left -= take;
    return words.slice(0, take).join('');
  });
}

/**
 * Draw one line, letter by letter, so a per-character effect can move each one.
 *
 * Only used when the effect needs it. The whole-string path is not merely
 * faster — the browser kerns and shapes a run of text, and taking it apart
 * changes the setting, so a title with no per-character effect must never go
 * down this road.
 */
function paintPerChar(ctx, line, x, y, px, offsetOf) {
  const chars = [...line];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0);
  // The caller's textAlign already decided where the line sits; per-character
  // drawing has to start from the left edge of that, so it is resolved here.
  let cx = ctx.textAlign === 'center' ? x - total / 2
    : ctx.textAlign === 'right' ? x - total : x;
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  chars.forEach((c, i) => {
    const o = offsetOf(i, chars.length);
    ctx.fillText(c, cx + (o.dx || 0), y + (o.dy || 0));
    cx += widths[i];
  });
  ctx.textAlign = prev;
}

/**
 * Draw one title into `ctx` at time `t` of a clip `len` seconds long.
 *
 * The buffer is cleared first — see the file docblock. `t` is measured from the
 * clip's own start, so the animation is a function of this instant alone and
 * the exporter can render frames in any order.
 */
export function drawTitleTo(ctx, W, H, cfg, t, len) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (isBlankTitle(cfg)) return;

  const alpha = titleAlpha(t, len, cfg);
  if (!(alpha > 0.001)) return;

  const size = Math.max(1, (cfg.size / 100) * H);
  const subSize = Math.max(1, size * cfg.subRatio);
  const lead = size * cfg.line;
  const subLead = subSize * cfg.line;

  const reveal = titleReveal(t, len, cfg);
  const revealer = cfg.animIn === 'word' ? worded : typed;
  const main = revealer(titleLines(macros(cfg.text)), reveal).filter((l, i, a) =>
    // A trailing run of lines the typewriter has not reached yet would reserve
    // its height and push the block off its anchor as it typed. Dropping them
    // keeps the block growing downward from a fixed top.
    l !== '' || a.slice(i).some((x) => x !== ''));
  /* The subtitle waits for the typewriter to finish. Typing both at once reads
     as two unrelated things arriving; holding it until the title is complete
     reads as the subtitle answering it. Nothing to wait for on the other
     animations, where reveal is 1 throughout. */
  const hasSub = !!(cfg.sub || '').trim() && reveal >= 1;
  const sub = hasSub ? titleLines(macros(cfg.sub)) : [];

  ctx.save();
  setFontStack(cfg.font);
  setTracking(cfg.track);

  // Measure before placing: the block's height decides where its top goes, and
  // the width decides how wide a fitted box has to be.
  setFont(ctx, size);
  let widest = 0;
  for (const l of main) widest = Math.max(widest, ctx.measureText(l).width);
  if (hasSub) {
    setFont(ctx, subSize);
    for (const l of sub) widest = Math.max(widest, ctx.measureText(l).width);
  }
  const blockH = main.length * lead + (hasSub ? sub.length * subLead : 0);

  const anchor = titleAnchor(cfg, W, H);
  // `vertical` is 0 at the top place, 0.5 in the middle, 1 at the bottom — which
  // is exactly the fraction of its own height the block should sit above its
  // anchor, so the three cases are one multiplication rather than a switch.
  let top = anchor.y - blockH * anchor.vertical + titleRise(t, len, cfg) * size;

  /* A ROLL REPLACES the vertical placement rather than adding to it: credits
     travel the whole height of the frame, so "where does it sit" stops being a
     question the moment one is asked for. Travelling from fully below the frame
     to fully above it means the first and last frames are empty, which is what
     makes it a roll rather than a jump. */
  const roll = titleRollAt(t, len, cfg);
  if (roll !== null) {
    // Off one side of the frame to off the other, so the first and last frames
    // are empty — a roll that ends in the middle is a slide, and a ticker that
    // stops at the centre never leaves.
    if (cfg.roll === 'up') top = H - roll * (H + blockH);
    else ctx.translate((1 - roll * 2) * (W + widest), 0);
  }

  /* A pop scales the whole block about its own centre. Done on the context so
     the treatment behind it scales too — a band that stayed full size while the
     words grew into it would read as two separate things. */
  const scale = titleScale(t, len, cfg);
  if (scale !== 1) {
    const cx = anchor.x; const cy = top + blockH / 2;
    ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy);
  }

  ctx.globalAlpha = alpha;

  /* The treatment goes down first, under everything, and is sized from the
     measured block rather than from the frame — a band that is not as tall as
     the words it is behind is worse than no band at all. */
  if (cfg.treatment === 'bar' || cfg.treatment === 'box') {
    const padY = size * 0.35;
    const padX = size * 0.6;
    ctx.fillStyle = withAlpha(cfg.bg, cfg.bgAlpha);
    if (cfg.treatment === 'bar') {
      ctx.fillRect(0, top - padY, W, blockH + padY * 2);
    } else {
      const bx = anchor.align === 'left' ? anchor.x
        : anchor.align === 'right' ? anchor.x - widest
          : anchor.x - widest / 2;
      ctx.fillRect(bx - padX, top - padY, widest + padX * 2, blockH + padY * 2);
    }
  }

  ctx.textAlign = anchor.align;
  ctx.textBaseline = 'top';

  /* The continuous effects. `wave` and `jitter` move each letter, so they take
     the per-character path; `neon` and `chroma` re-draw the whole run and leave
     the shaping alone. All of them are seeded from the frame rather than from
     Math.random — an export that shimmered differently from the scrub that
     approved it would be worse than one that did not shimmer at all. */
  const fx = cfg.fx || 'none';
  const amt = cfg.fxAmt ?? 0.5;
  const perChar = fx === 'wave' || fx === 'jitter';
  const frame = Math.round(t * 12);

  const offsetOf = (px) => (i, n) => {
    if (fx === 'wave') {
      // A travelling sine, so the letters bob in sequence rather than together.
      return { dy: Math.sin(t * 3 + (i / Math.max(1, n)) * Math.PI * 4) * px * 0.22 * amt };
    }
    // jitter: a fresh displacement each frame, the same one every time that
    // frame is rendered.
    return {
      dx: (steadyNoise(i, frame, 1) * 2 - 1) * px * 0.09 * amt,
      dy: (steadyNoise(i, frame, 2) * 2 - 1) * px * 0.09 * amt,
    };
  };

  const paint = (line, y, px) => {
    setFont(ctx, px);
    if (cfg.treatment === 'shadow') {
      /* Offset in type sizes, so the shadow stays in proportion. Drawn as a
         second fill rather than with ctx.shadow*, which is blurred per draw and
         is the single most expensive thing this renderer could do per frame. */
      ctx.fillStyle = withAlpha(cfg.bg, Math.max(0.35, cfg.bgAlpha));
      ctx.fillText(line, anchor.x + px * 0.06, y + px * 0.06);
    }
    if (cfg.treatment === 'outline') {
      ctx.lineWidth = Math.max(1, px * 0.09);
      ctx.strokeStyle = withAlpha(cfg.bg, Math.max(0.5, cfg.bgAlpha));
      // Round joins, or the corners of an M spike out past the letter at any
      // stroke wide enough to be doing its job.
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeText(line, anchor.x, y);
    }
    if (fx === 'neon' && amt > 0) {
      /* A glow is the light AROUND the letter, so it is drawn as the letter
         itself under a shadow with no offset — three passes, because one wide
         blur is a haze and three stacked is a tube. The flicker is a failing
         one, which is the only kind anybody draws.
         Skipped entirely at zero: an effect turned down to nothing has to be
         the plain title again, not a slightly smaller version of itself. */
      const flick = 1 - steadyNoise(frame, 7) * 0.35 * amt;
      ctx.save();
      ctx.shadowColor = cfg.fg;
      ctx.fillStyle = cfg.fg;
      for (const blur of [px * 0.6, px * 0.3, px * 0.12]) {
        ctx.shadowBlur = blur * (1 + amt) * flick;
        ctx.fillText(line, anchor.x, y);
      }
      ctx.restore();
    }
    if (fx === 'chroma' && amt > 0) {
      /* The red and blue records printed out of register. Added rather than
         drawn over, so the overlap returns to the ink colour instead of the
         last channel drawn — which is what makes it read as a split rather
         than as two coloured copies.
         The register DRIFTS rather than sitting still. A fixed offset is a
         decoration: it looks identical in every frame, so on a timeline it
         reads as part of the typeface rather than as something going wrong
         with the picture — which is the whole point of it here. A slow
         breathing offset is what a misaligned tube actually does.
         Skipped at zero, or the two channels would land on top of each other
         and add to a white halo the author did not ask for. */
      const drift = 0.55 + 0.45 * Math.sin(t * 1.7);
      const o = px * 0.06 * amt * drift;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#ff0000'; ctx.fillText(line, anchor.x - o, y);
      ctx.fillStyle = '#00ffff'; ctx.fillText(line, anchor.x + o, y);
      ctx.restore();
    }
    ctx.fillStyle = cfg.fg;
    if (perChar) paintPerChar(ctx, line, anchor.x, y, px, offsetOf(px));
    else ctx.fillText(line, anchor.x, y);
  };

  for (const line of main) { paint(line, top, size); top += lead; }
  if (hasSub) for (const line of sub) { paint(line, top, subSize); top += subLead; }

  ctx.restore();
}
