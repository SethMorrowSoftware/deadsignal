/* Dead Signal Studio — doc/transform.js
 *
 * Where a clip sits in the frame, and how big it is. Pure: no DOM, no canvas,
 * no store.
 *
 * WHY THIS EXISTS
 *
 * Every clip filled the frame edge to edge, always. That is one composition,
 * repeated, and it is the reason the V2 overlay track was less useful than it
 * looks: an overlay the same size as the picture underneath can only replace it
 * or tint it. Picture-in-picture, a corner inset, a punch-out with black around
 * it, a shot pushed off to one side to leave room for a title — none of them
 * were expressible, because a clip had no position to express.
 *
 * Five numbers fix that, and the units are chosen so they survive things the
 * author will do to the project afterwards:
 *
 *   x, y    offset from the centre, as a FRACTION OF THE FRAME rather than in
 *           pixels. A layout built at 360×270 is the same layout at 1080×1920,
 *           so changing the delivery format does not scatter every inset.
 *   scale   1 fills the frame, as it always did.
 *   rot     degrees, clockwise, about the clip's own centre.
 *   flip    mirrored horizontally, vertically, or both.
 *
 * IDENTITY IS THE POINT
 *
 * A clip written before any of this reads back as x0 y0 scale1 rot0 flip-none,
 * and `isIdentity` is true for it — which is what lets the renderer keep its old
 * one-line `drawImage(img, 0, 0, W, H)` for every existing clip. Not as an
 * optimisation: as a guarantee that a sequence made yesterday renders the same
 * pixels today. The transform path is only entered by a clip that asked for it.
 */

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;
/** Two frames out is far enough to fly something in from off screen. */
export const MAX_OFFSET = 2;
export const FLIPS = ['none', 'h', 'v', 'hv'];

const num = (v, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
/* Offsets and scale are held to 1/1000 of a frame — finer than a pixel at any
   size this tool renders, and coarse enough that two clips nudged to the same
   place compare equal. */
const round3 = (n) => Math.round(n * 1000) / 1000;
const round1 = (n) => Math.round(n * 10) / 10;

/** The transform fields of `c`, normalised and clamped. */
export function makeTransform(c) {
  return {
    x: clamp(round3(num(c?.x, 0)), -MAX_OFFSET, MAX_OFFSET),
    y: clamp(round3(num(c?.y, 0)), -MAX_OFFSET, MAX_OFFSET),
    scale: clamp(round3(num(c?.scale, 1)), MIN_SCALE, MAX_SCALE),
    /* Wrapped rather than clamped: 190° and −170° are the same picture, and an
       author dragging past the end of the dial means to keep going. */
    rot: round1(wrap180(num(c?.rot, 0))),
    flip: FLIPS.includes(c?.flip) ? c.flip : 'none',
  };
}

function wrap180(deg) {
  if (!Number.isFinite(deg)) return 0;
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** True when this clip fills the frame exactly as it always did. */
export function isIdentity(t) {
  const v = makeTransform(t);
  return v.x === 0 && v.y === 0 && v.scale === 1 && v.rot === 0 && v.flip === 'none';
}

/**
 * The canvas matrix, as the six numbers `ctx.transform()` takes.
 *
 * It maps the clip's own frame — drawn centred on the origin, from −W/2 to
 * +W/2 — onto the output frame. Centred rather than corner-anchored because
 * every operation here is one an author thinks of as happening about the middle
 * of the shot: scaling from a corner would send a shrinking clip sliding off to
 * the top left, and rotating about a corner would swing it out of frame.
 *
 * Flip is applied in the clip's own space (before the rotation), so mirroring a
 * rotated clip mirrors the picture rather than the angle.
 */
export function matrixFor(t, W, H) {
  const { x, y, scale, rot, flip } = makeTransform(t);
  const sx = scale * (flip === 'h' || flip === 'hv' ? -1 : 1);
  const sy = scale * (flip === 'v' || flip === 'hv' ? -1 : 1);
  const r = (rot * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [sx * cos, sx * sin, -sy * sin, sy * cos, W / 2 + x * W, H / 2 + y * H];
}

/**
 * The axis-aligned box the clip actually lands in, in output pixels.
 *
 * Used for the "this clip is not on screen" warning. A rotated clip's bounds are
 * the bounds of its four transformed corners, which is bigger than the clip —
 * that is correct here, because the question being asked is "could any of it be
 * visible", and the answer must never be a false "no".
 */
export function transformedBox(t, W, H) {
  const [a, b, c, d, e, f] = matrixFor(t, W, H);
  const hw = W / 2;
  const hh = H / 2;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [px, py] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
    const qx = a * px + c * py + e;
    const qy = b * px + d * py + f;
    if (qx < minX) minX = qx;
    if (qx > maxX) maxX = qx;
    if (qy < minY) minY = qy;
    if (qy > maxY) maxY = qy;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** True when none of the clip lands inside the frame. */
export function offFrame(t, W, H) {
  const r = transformedBox(t, W, H);
  return r.x >= W || r.y >= H || r.x + r.w <= 0 || r.y + r.h <= 0;
}

/**
 * "50% · x +0.25 · 12° · mirrored" — empty when the clip fills the frame.
 *
 * Empty rather than "100%" on purpose: the summary is shown as a note under the
 * controls, and a note that is always there stops being read.
 */
export function transformSummary(t) {
  const v = makeTransform(t);
  if (isIdentity(v)) return '';
  const parts = [];
  if (v.scale !== 1) parts.push(`${Math.round(v.scale * 100)}%`);
  if (v.x) parts.push(`x ${v.x > 0 ? '+' : '−'}${Math.abs(v.x)}`);
  if (v.y) parts.push(`y ${v.y > 0 ? '+' : '−'}${Math.abs(v.y)}`);
  if (v.rot) parts.push(`${v.rot > 0 ? '' : '−'}${Math.abs(v.rot)}°`);
  if (v.flip !== 'none') parts.push(v.flip === 'h' ? 'mirrored' : v.flip === 'v' ? 'flipped' : 'mirrored + flipped');
  return parts.join(' · ');
}

/* ---------------------------------------------------------------- places -- */

/**
 * The layouts worth having a button for.
 *
 * Typing 0.25 into two boxes to get a corner inset is arithmetic, not editing,
 * and it is exactly the arithmetic a novice will get wrong in the direction
 * that puts half the clip off screen. Each of these is a half-size clip whose
 * edges line up with the frame's — at scale 0.5 a half-width is a quarter of
 * the frame, so an offset of 0.25 puts the near edge flush against the border.
 */
export const PLACES = [
  { v: 'full', t: 'Full frame', x: 0, y: 0, scale: 1 },
  { v: 'centre', t: 'Centre, half size', x: 0, y: 0, scale: 0.5 },
  { v: 'tl', t: 'Top left', x: -0.25, y: -0.25, scale: 0.5 },
  { v: 'tr', t: 'Top right', x: 0.25, y: -0.25, scale: 0.5 },
  { v: 'bl', t: 'Bottom left', x: -0.25, y: 0.25, scale: 0.5 },
  { v: 'br', t: 'Bottom right', x: 0.25, y: 0.25, scale: 0.5 },
  { v: 'left', t: 'Left half', x: -0.25, y: 0, scale: 0.5 },
  { v: 'right', t: 'Right half', x: 0.25, y: 0, scale: 0.5 },
];

/**
 * Which preset this clip is sitting on, or 'custom'.
 *
 * Rotation and flip are deliberately not part of the match: a mirrored corner
 * inset is still in the corner, and losing the preset's name the moment someone
 * tilts the shot would make the control look broken.
 */
export function placeOf(t) {
  const v = makeTransform(t);
  const hit = PLACES.find((p) => p.x === v.x && p.y === v.y && p.scale === v.scale);
  return hit ? hit.v : 'custom';
}

/** The patch a preset makes. Null for 'custom', which means "leave it alone". */
export function patchForPlace(place) {
  const p = PLACES.find((q) => q.v === place);
  return p ? { x: p.x, y: p.y, scale: p.scale } : null;
}

/* ======================================================= direct handling ==
   Five number boxes describe a position; they are not a way to place one. An
   author aiming an inset at the bottom-right corner does not think "x plus
   nought point two five", they point at the corner — and the arithmetic that
   turns a pointer into those five numbers is the inverse of the matrix the
   compositor already draws with, which is exactly the sort of thing that should
   be pure and pinned rather than written inline in a pointer handler.
   ======================================================================== */

/** How far from a handle still counts as grabbing it, in output pixels. */
export const HANDLE_PX = 10;
/** How far the rotation grip sits outside the top edge, in output pixels. */
export const ROT_ARM_PX = 28;

/**
 * A point in OUTPUT pixels, expressed in the clip's own centred space.
 *
 * The inverse of matrixFor. Its determinant cannot be zero — scale is clamped
 * away from it — but it is guarded anyway, because the alternative to a guard
 * here is NaN coordinates reaching a pointer handler and a clip that jumps to
 * nowhere.
 */
export function invertPoint(t, W, H, qx, qy) {
  const [a, b, c, d, e, f] = matrixFor(t, W, H);
  const det = a * d - b * c;
  if (!det) return { x: 0, y: 0 };
  const x = qx - e;
  const y = qy - f;
  return { x: (d * x - c * y) / det, y: (a * y - b * x) / det };
}

/** True when an output-space point lands on the clip's own rectangle. */
export function insideClip(t, W, H, qx, qy) {
  const p = invertPoint(t, W, H, qx, qy);
  return Math.abs(p.x) <= W / 2 && Math.abs(p.y) <= H / 2;
}

/**
 * Where the clip's corners and its rotation grip are, in output pixels.
 *
 * The grip is pushed out along the box's own UP direction by a fixed number of
 * OUTPUT pixels rather than a fixed distance in clip space: at 0.1× scale a
 * clip-space arm would put the grip inside the box, and at 8× it would put it
 * off screen. It is a thing you grab with a pointer, so it is measured in the
 * space the pointer is in.
 */
export function handlesFor(t, W, H) {
  const m = matrixFor(t, W, H);
  const at = (px, py) => [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]];
  const centre = [m[4], m[5]];
  const corners = [at(-W / 2, -H / 2), at(W / 2, -H / 2), at(W / 2, H / 2), at(-W / 2, H / 2)];
  const topMid = at(0, -H / 2);
  const dx = topMid[0] - centre[0];
  const dy = topMid[1] - centre[1];
  const mag = Math.hypot(dx, dy) || 1;
  const rot = [topMid[0] + (dx / mag) * ROT_ARM_PX, topMid[1] + (dy / mag) * ROT_ARM_PX];
  return { centre, corners, rot };
}

/** Which grip an output-space point is on: a corner index, 'rot', 'move' or ''. */
export function hitHandle(t, W, H, qx, qy, tol = HANDLE_PX) {
  const h = handlesFor(t, W, H);
  const near = (p) => Math.hypot(qx - p[0], qy - p[1]) <= tol;
  // Rotation first: it sits outside the box, but a tiny clip's grip can overlap
  // a corner, and rotating is the more specific intent.
  if (near(h.rot)) return 'rot';
  for (let i = 0; i < 4; i++) if (near(h.corners[i])) return `c${i}`;
  return insideClip(t, W, H, qx, qy) ? 'move' : '';
}

/**
 * The uniform scale that puts a dragged corner under the pointer.
 *
 * Uniform, and about the centre, because that is what the transform IS — there
 * is no anchor to drag from, and offering a non-uniform one would need a second
 * scale field the renderer does not have.
 */
export function scaleAt(W, H, centre, qx, qy) {
  const half = Math.hypot(W / 2, H / 2) || 1;
  const d = Math.hypot(qx - centre[0], qy - centre[1]);
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((d / half) * 1000) / 1000));
}

/**
 * The rotation, in degrees, that points the clip's top edge at the pointer.
 *
 * `flip` is load-bearing: for a vertically mirrored clip ('v'/'hv') matrixFor's
 * sy is negative, so handlesFor draws the rotation grip along the mirrored top
 * edge — at rot+90 instead of rot−90. Without compensating, grabbing that grip
 * on a v-flipped clip would snap it 180° and then track opposite the pointer.
 */
export function rotAt(centre, qx, qy, flip = 'none') {
  let deg = (Math.atan2(qy - centre[1], qx - centre[0]) * 180) / Math.PI + 90;
  if (flip === 'v' || flip === 'hv') deg += 180;
  return makeTransform({ rot: deg }).rot;
}

/** Moving by this many OUTPUT pixels is moving by this much x and y. */
export function moveBy(t, W, H, dqx, dqy) {
  const v = makeTransform(t);
  return {
    x: makeTransform({ x: v.x + (W ? dqx / W : 0) }).x,
    y: makeTransform({ y: v.y + (H ? dqy / H : 0) }).y,
  };
}
