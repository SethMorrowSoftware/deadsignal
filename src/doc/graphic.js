/* Dead Signal Studio — doc/graphic.js
 *
 * A shape on the timeline. Pure: no DOM, no canvas, no store.
 *
 * WHY THIS IS NOT THE ANNOTATION LAYER
 *
 * doc/annotations.js already describes six marks — box, redaction, ellipse,
 * line, arrow, text — and they are good ones. They are also welded to a STILL:
 * they live at `image.annotations`, they are drawn inside the screen render,
 * and there is exactly one set of them for the whole document. You cannot put
 * an arrow on a shot at 0:04 and take it away at 0:07, which is what pointing
 * at something in a video means.
 *
 * So this is the same idea moved onto the clip axis, and the difference is
 * entirely about TIME: a graphic has a hold, an entrance and an exit, and there
 * can be as many of them as the sequence needs, each on its own block. The
 * shape vocabulary is deliberately kept recognisable from the annotation layer
 * — an author who has used one should not have to learn the other — and
 * extended with the four that suit a surveillance picture: a filled disc, corner
 * brackets, a crosshair, and a rule.
 *
 * It shares its buffer contract with doc/title.js: the renderer CLEARS rather
 * than fills, which is the whole reason a shape can sit over a shot instead of
 * replacing it, and it shares its ramp arithmetic with titles via doc/ramp.js
 * so the two arrive and leave the same way.
 *
 * EVERY MEASUREMENT IS A FRACTION OF THE FRAME
 *
 * Position, size and stroke weight are all fractions, for the reason spelled
 * out at length in doc/title.js: a graphic drawn on a 320x240 preview has to be
 * the same graphic on a 1920x1080 delivery, and storing pixels would make it a
 * sixth of the size with nothing on screen to warn the author.
 */
import { MAX_RAMP, ease, ramps } from './ramp.js';

/* The eight shapes. `stroke` says the shape is drawn as an outline, which is
   what makes the draw-on entrance possible — you cannot progressively reveal a
   fill along its own perimeter. `diagonal` says the geometry is a vector from
   the anchor rather than a rectangle, so the sign of w/h is meaningful and must
   not be normalised away. */
export const SHAPES = [
  { v: 'box', t: 'Box', stroke: true,
    hint: 'An outlined rectangle — for framing the thing you want looked at.' },
  { v: 'fill', t: 'Redaction bar',
    hint: 'A solid block. Cover something rather than point at it.' },
  { v: 'ellipse', t: 'Ellipse', stroke: true,
    hint: 'An outlined ellipse. Softer than a box, and it reads as hand-drawn.' },
  { v: 'disc', t: 'Disc',
    hint: 'A filled ellipse. A dot, a blob, a lens flare to sit under something.' },
  { v: 'line', t: 'Line', stroke: true, diagonal: true,
    hint: 'A straight rule from the anchor to the far corner.' },
  { v: 'arrow', t: 'Arrow', stroke: true, diagonal: true,
    hint: 'A line with a head on the far end. For pointing in from off to the side.' },
  { v: 'bracket', t: 'Corner brackets', stroke: true,
    hint: 'Four corners of a rectangle with the sides left out — the framing a camera draws around a face.' },
  { v: 'crosshair', t: 'Crosshair', stroke: true,
    hint: 'A reticle: a ring with ticks through it, centred on the box.' },
];
export const DEFAULT_SHAPE = 'box';
const SHAPE_BY = new Map(SHAPES.map((s) => [s.v, s]));
export const shapeSpec = (v) => SHAPE_BY.get(v) || SHAPE_BY.get(DEFAULT_SHAPE);
/** Can this shape be drawn on progressively? Only outlines have a path to walk. */
export const isStroked = (v) => !!shapeSpec(v).stroke;
/** Is this shape's geometry a vector rather than a rectangle? */
export const isDiagonal = (v) => !!shapeSpec(v).diagonal;

/* 'draw' walks the outline on. It is offered for every shape and quietly reads
   as a fade on a filled one — refusing it would mean a control that disappears
   when you change the shape, which is harder to trust than one that degrades. */
export const GFX_IN = ['none', 'fade', 'pop', 'draw', 'slam'];
export const GFX_OUT = ['none', 'fade', 'shrink'];
export const MAX_GFX_ANIM = MAX_RAMP;

/** Stroke weight, as a percentage of the frame's short side. */
export const MIN_WEIGHT = 0.1;
export const MAX_WEIGHT = 5;

const num = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round3 = (n) => Math.round(n * 1000) / 1000;
const colour = (v, fallback) =>
  (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fallback);
const pick = (list, v, fallback) => (list.includes(v) ? v : fallback);

/**
 * A graphic recipe, read out of a clip's `rec` and normalised.
 *
 * Reads `g-*` control ids, the same way readVideoCfg reads `v-*` and
 * makeTitle reads `t-*`. Values arrive as strings — a recipe is captured
 * control values — and are coerced once, here.
 */
export function makeGraphic(rec) {
  const r = rec && typeof rec === 'object' && !Array.isArray(rec) ? rec : {};
  const shape = SHAPE_BY.has(r['g-shape']) ? r['g-shape'] : DEFAULT_SHAPE;
  return {
    shape,
    /* The anchor. For a rectangle kind this is the top-left corner; for a
       diagonal kind it is the tail, and the head is at (x+w, y+h). */
    x: clamp(round3(num(r['g-x'], 0.2)), -1, 2),
    y: clamp(round3(num(r['g-y'], 0.2)), -1, 2),
    /* SIGNED, and deliberately. A line drawn up-and-left is a different line
       from the same one drawn down-and-right, because the arrowhead is on the
       end you dragged to. Rectangle kinds resolve the sign at draw time — see
       rectOfGraphic — so only the shapes that care about it pay for it. */
    w: clamp(round3(num(r['g-w'], 0.3)), -2, 2),
    h: clamp(round3(num(r['g-h'], 0.2)), -2, 2),
    rot: clamp(round3(num(r['g-rot'], 0)), -180, 180),
    colour: colour(r['g-colour'], '#39ff9e'),
    /* Filled shapes use `colour`; outlined ones can carry a fill BEHIND the
       stroke, which is what turns a box into a highlight panel. Zero alpha —
       the default — means no fill at all, so an outline is an outline. */
    fill: colour(r['g-fill'], '#000000'),
    fillAlpha: clamp(round3(num(r['g-filla'], 0)), 0, 1),
    opacity: clamp(round3(num(r['g-opacity'], 1)), 0, 1),
    weight: clamp(round3(num(r['g-weight'], 0.6)), MIN_WEIGHT, MAX_WEIGHT),
    /* Rounded corners, as a fraction of the box's SHORT side, so a corner looks
       the same on a wide box as on a tall one. */
    radius: clamp(round3(num(r['g-radius'], 0)), 0, 0.5),
    dash: clamp(round3(num(r['g-dash'], 0)), 0, 20),
    animIn: pick(GFX_IN, r['g-anim'], 'fade'),
    animOut: pick(GFX_OUT, r['g-animout'], 'fade'),
    inSec: clamp(round3(num(r['g-in'], 0.3)), 0, MAX_GFX_ANIM),
    outSec: clamp(round3(num(r['g-out'], 0.3)), 0, MAX_GFX_ANIM),
  };
}

/**
 * The rectangle a box-kind graphic covers, in fractions, sign resolved.
 *
 * One place, for the same reason doc/annotations.js gives: a negative width
 * draws correctly on a canvas but breaks every question you might ask about the
 * rectangle afterwards.
 */
export function rectOfGraphic(g) {
  const x = Math.min(g.x, g.x + g.w);
  const y = Math.min(g.y, g.y + g.h);
  return { x, y, w: Math.abs(g.w), h: Math.abs(g.h) };
}

/** True when the shape has no area (or no length) to draw. */
export function isEmptyGraphic(g) {
  if (!g) return true;
  if (isDiagonal(g.shape)) return Math.abs(g.w) < 1e-4 && Math.abs(g.h) < 1e-4;
  const r = rectOfGraphic(g);
  return r.w < 1e-4 || r.h < 1e-4;
}

/** How far through the ramps we are. See doc/ramp.js. */
export const graphicRamps = (t, len, g) => ramps(t, len, g?.inSec, g?.outSec);

/** Opacity at `t`, 0..1, including the clip's own opacity setting. */
export function graphicAlpha(t, len, g) {
  const { rin, rout } = graphicRamps(t, len, g);
  // 'pop', 'draw' and 'slam' carry their own visible gesture, so they do not
  // ALSO fade — a shape that scales up while fading in reads as two effects
  // fighting. Only 'fade' touches opacity on the way in.
  const a = g?.animIn === 'fade' ? ease(rin) : 1;
  const b = g?.animOut === 'fade' || g?.animOut === 'shrink' ? ease(rout) : 1;
  return clamp(Math.min(a, b) * clamp(num(g?.opacity, 1), 0, 1), 0, 1);
}

/**
 * Scale at `t`, about the shape's own centre.
 *
 * 'pop' overshoots slightly on the way in — 1.0 reached from 0.6 through a
 * value above 1 — because a shape that arrives at exactly its final size looks
 * like it was always there. 'slam' is the redaction gesture: full width, no
 * height, snapping open vertically.
 */
export function graphicScale(t, len, g) {
  const { rin, rout } = graphicRamps(t, len, g);
  let sx = 1; let sy = 1;
  if (g?.animIn === 'pop') {
    const e = ease(rin);
    // A single overshoot hump that is exactly 0 at u=0 and exactly 0 at u=1.
    const s = 0.6 + 0.4 * e + Math.sin(e * Math.PI) * 0.12;
    sx *= s; sy *= s;
  }
  if (g?.animIn === 'slam') sy *= ease(rin);
  if (g?.animOut === 'shrink') { const e = ease(rout); sx *= e; sy *= e; }
  return { sx: round3(sx), sy: round3(sy) };
}

/**
 * How much of the outline has been drawn at `t`, 0..1.
 *
 * 1 for every entrance that is not 'draw', so the renderer applies it
 * unconditionally instead of branching — the same shape the title's reveal has.
 */
export function graphicDraw(t, len, g) {
  if (g?.animIn !== 'draw') return 1;
  const { rin } = graphicRamps(t, len, g);
  return round3(ease(rin));
}

/** One line for the lane block and the status bar. */
export function graphicSummary(g) {
  return shapeSpec(g?.shape).t;
}

/** The name a graphic clip gets automatically. */
export const graphicLabel = (rec) => graphicSummary(makeGraphic(rec));
