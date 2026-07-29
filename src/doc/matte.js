/* Dead Signal Studio — doc/matte.js
 *
 * Which parts of a clip are used. Pure: no DOM, no canvas, no store.
 *
 * A matte is the film word for the thing that says where an image applies, and
 * it is deliberately ONE idea here rather than two features that happen to ship
 * together. Both halves answer the same question in the same place — before the
 * clip is composited, on the clip's own buffer — and they answer it the same
 * way, by writing alpha:
 *
 *   the KEY   decides by COLOUR:   this pixel is the green screen, drop it.
 *   the MASK  decides by GEOMETRY: this pixel is outside the shape, drop it.
 *
 * WHY THIS WORKS AT ALL, GIVEN THE COMPOSITOR WAS NEVER WRITTEN FOR IT
 *
 * It is the same one-line observation titles were built on (doc/title.js): the
 * compositor composites a CANVAS, and a canvas carries alpha. drawClipTo does
 * not care whether the buffer it is handed is opaque — the clip transform, the
 * blend, the opacity and every transition treat a keyed clip exactly like any
 * other picture. So nothing downstream of renderClipTo needed changing. What was
 * missing was any way to PUT alpha into a buffer that a scene had just filled
 * edge to edge.
 *
 * The one thing that is genuinely not free is the blend. A keyed clip has to
 * composite at `source-over`, because that is the only mode that means "put this
 * where its alpha says and leave the rest alone" — and V2's historical default
 * is `screen`, which keys the black out for free and would therefore also make
 * every dark pixel of the foreground you just carefully kept disappear. That is
 * a fact about the clip, not about the key, so it is said in the panel rather
 * than quietly corrected here (see clipedit's `matteNotes`).
 *
 * WHY THE FIELDS ARE FLAT
 *
 * The stored shape of a clip is a flat record — the same reason `at`, `blend`
 * and the five transform fields are spread rather than nested (see
 * doc/timeline.js). Every field is written unconditionally, so a save/load round
 * trip is byte-identical, and a clip written before any of this reads back as
 * "no key, no mask", which is the edge-to-edge draw it has always had.
 *
 * WHY THE MATHS IS HERE AND NOT IN THE RENDERER
 *
 * `keyAlphaAt` is the entire chroma key: one number per pixel deciding whether
 * that pixel is background. Left in the renderer it could only ever be tested by
 * rendering something and looking at it, which is how you end up asserting that
 * a key "changed the picture" rather than that it kept the right half of it.
 * Here it is an ordinary function of five numbers, and the headless suite can
 * hand it a colour and check the answer.
 */

/* ------------------------------------------------------------ vocabulary -- */

/**
 * How a key decides what is background.
 *
 * 'luma' is not a lesser 'chroma'. It is the honest version of the trick V2 has
 * always played with the screen blend: these scenes are bright marks on a
 * near-black ground, and "drop the dark part" is what an author actually wants
 * from them. The difference is that a luma key drops the ground and leaves the
 * marks ALONE, where screen also lightens whatever is underneath them.
 */
export const KEY_MODES = [
  { v: 'off', t: '— none —',
    hint: 'The clip is used whole, as it always was.' },
  { v: 'chroma', t: 'Colour — green screen',
    hint: 'Drops every pixel near one colour. Tolerance widens the range; Softness is the band at its edge.' },
  { v: 'luma', t: 'Brightness — drop the dark',
    hint: 'Drops everything darker than the threshold. What a scene on a near-black ground wants, without the screen blend lightening the shot underneath.' },
];
export const DEFAULT_KEY = 'off';

/** The two mask geometries. A rectangle is also every straight split-screen. */
export const MASK_SHAPES = [
  { v: 'none', t: '— none —' },
  { v: 'rect', t: 'Rectangle' },
  { v: 'ellipse', t: 'Ellipse' },
];
export const DEFAULT_MASK = 'none';

/**
 * What happens to the region the mask selects.
 *
 * The mask always means the same thing — a shape, feathered, optionally
 * inverted — and the mode is the only thing that varies. That is why a
 * spotlight, a blurred face and a split screen are one control and not three
 * features: they are the same shape doing four different jobs.
 *
 * `invert` selects the complement, so "darken this" inverted IS the spotlight.
 * Consistency was chosen over convenience there: a mode that quietly meant
 * "outside" while its neighbours meant "inside" would be a rule you have to
 * remember rather than one you can read.
 */
export const MASK_MODES = [
  { v: 'reveal', t: 'Show only this', alpha: true,
    hint: 'Everything outside is dropped, so the clip beneath shows through. Two clips masked to opposite halves is a split screen.' },
  { v: 'blur', t: 'Blur this',
    hint: 'Softens what is inside and leaves the rest sharp — a face, a licence plate, a name on a screen.' },
  { v: 'pixelate', t: 'Pixelate this',
    hint: 'The other way to obscure a face: a mosaic rather than a smear. Coarser as Amount rises.' },
  { v: 'dim', t: 'Darken this',
    hint: 'Turn Invert on and this is a spotlight — the shape stays lit and everything around it falls away.' },
];
export const DEFAULT_MASK_MODE = 'reveal';
const MODE_BY = new Map(MASK_MODES.map((m) => [m.v, m]));
/** Does this mode work by removing alpha, rather than by altering pixels? */
export const maskDropsPixels = (v) => !!MODE_BY.get(v)?.alpha;

/**
 * Layouts, in one click — the same idea as the transform's PLACES.
 *
 * Halves are here because a split screen is the commonest reason to mask
 * anything at all, and "type 0, 0, 0.5, 1 into four boxes" is not a feature.
 */
export const MASK_PLACES = [
  { v: 'full', t: 'Whole frame', x: 0, y: 0, w: 1, h: 1 },
  { v: 'left', t: 'Left half', x: 0, y: 0, w: 0.5, h: 1 },
  { v: 'right', t: 'Right half', x: 0.5, y: 0, w: 0.5, h: 1 },
  { v: 'top', t: 'Top half', x: 0, y: 0, w: 1, h: 0.5 },
  { v: 'bottom', t: 'Bottom half', x: 0, y: 0.5, w: 1, h: 0.5 },
  { v: 'centre', t: 'Centred half', x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
];

/** Feather is a fraction of the frame's SHORT side, so it survives a resize. */
export const MAX_FEATHER = 0.5;
/* The widest useful distance in the Cb/Cr plane. Pure green to pure magenta is
   about 240 units apart and no two colours in an 8-bit picture are further, so
   a tolerance of 1 keys essentially everything — which is what a control at its
   maximum should do. */
export const CHROMA_RANGE = 160;

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const num = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round3 = (n) => Math.round(n * 1000) / 1000;
const pick = (list, v, fallback) => (list.some((e) => e.v === v) ? v : fallback);

/* ------------------------------------------------------------ the record -- */

/**
 * The matte fields of a clip, normalised. Spread into makeClip.
 *
 * Reads the clip itself rather than its recipe, and that is the decision worth
 * defending: a key is an EDIT, not a look. A clip's `rec` is replaced wholesale
 * by "Update from tab" (see patchFromRecipe), so a key stored there would be
 * silently thrown away the first time an author went back to the VIDEO tab to
 * change a colour — the shot would come back with its background restored and
 * nothing on screen to say why.
 */
export function makeMatte(c) {
  const keyMode = pick(KEY_MODES, c?.keyMode, DEFAULT_KEY);
  const maskShape = pick(MASK_SHAPES, c?.maskShape, DEFAULT_MASK);
  return {
    keyMode,
    /* Broadcast chroma green, not #00ff00. A real green screen is this colour,
       and starting from it means the first thing an author tries — point it at
       green-screen footage and raise the tolerance — works. */
    keyColour: typeof c?.keyColour === 'string' && HEX.test(c.keyColour) ? c.keyColour : '#00b140',
    keyTol: clamp(round3(num(c?.keyTol, 0.28)), 0, 1),
    keySoft: clamp(round3(num(c?.keySoft, 0.12)), 0, 1),
    keySpill: clamp(round3(num(c?.keySpill, 0.5)), 0, 1),

    maskShape,
    maskMode: pick(MASK_MODES, c?.maskMode, DEFAULT_MASK_MODE),
    /* Fractions of the frame, like every other geometry in this tool — a mask
       placed on a 320×240 preview has to be the same mask on a 1920×1080
       delivery. Signed width and height are resolved at read time (maskRectOf)
       rather than normalised away, so a shape dragged right-to-left is the same
       shape rather than an empty one. */
    maskX: clamp(round3(num(c?.maskX, 0.25)), -1, 2),
    maskY: clamp(round3(num(c?.maskY, 0.25)), -1, 2),
    maskW: clamp(round3(num(c?.maskW, 0.5)), -2, 2),
    maskH: clamp(round3(num(c?.maskH, 0.5)), -2, 2),
    maskRot: clamp(round3(num(c?.maskRot, 0)), -180, 180),
    maskFeather: clamp(round3(num(c?.maskFeather, 0.04)), 0, MAX_FEATHER),
    maskAmount: clamp(round3(num(c?.maskAmount, 0.6)), 0, 1),
    maskInvert: !!c?.maskInvert,
  };
}

/** The rectangle the mask covers, in fractions, sign resolved. */
export function maskRectOf(m) {
  const x = Math.min(num(m?.maskX, 0), num(m?.maskX, 0) + num(m?.maskW, 0));
  const y = Math.min(num(m?.maskY, 0), num(m?.maskY, 0) + num(m?.maskH, 0));
  return { x, y, w: Math.abs(num(m?.maskW, 0)), h: Math.abs(num(m?.maskH, 0)) };
}

/** True when the key would remove anything. */
export const keyActive = (c) => {
  const mode = pick(KEY_MODES, c?.keyMode, DEFAULT_KEY);
  if (mode === 'off') return false;
  /* A tolerance of zero is not "off" for a chroma key: it still removes the
     pixels that are EXACTLY the key colour, which on a flat-filled scene is
     most of the frame. Only the mode decides whether a key runs. */
  return true;
};

/** True when the mask would change anything. */
export const maskActive = (c) => {
  if (pick(MASK_SHAPES, c?.maskShape, DEFAULT_MASK) === 'none') return false;
  const r = maskRectOf(makeMatte(c));
  /* A zero-area shape is not a mask, it is an accident — and in 'reveal' it
     would blank the clip entirely, which reads as a broken clip rather than as
     an empty rectangle. Treated as absent, and the panel says so. */
  return r.w > 1e-4 && r.h > 1e-4;
};

/** True when this clip needs anything doing to it before it is composited. */
export const hasMatte = (c) => keyActive(c) || maskActive(c);

/**
 * True when this clip's picture now DEPENDS on its alpha being respected.
 *
 * The question the blend warning asks. A key and a 'reveal' mask both work by
 * making pixels transparent, and `screen` — V2's historical default — composites
 * by lightness rather than by alpha: it drops black whether or not you keyed it
 * and lightens whatever is underneath the part you kept. The other three mask
 * modes alter pixels in place and are indifferent to the blend.
 */
export const needsAlphaBlend = (c) =>
  keyActive(c) || (maskActive(c) && maskDropsPixels(makeMatte(c).maskMode));

/** Which preset the mask is on, or 'custom'. Derived, never stored. */
export function maskPlaceOf(c) {
  const m = makeMatte(c);
  const r = maskRectOf(m);
  if (m.maskRot) return 'custom';
  const hit = MASK_PLACES.find((p) => Math.abs(p.x - r.x) < 0.005 && Math.abs(p.y - r.y) < 0.005
    && Math.abs(p.w - r.w) < 0.005 && Math.abs(p.h - r.h) < 0.005);
  return hit ? hit.v : 'custom';
}

/**
 * The patch a mask preset makes.
 *
 * Four fields and no more: the shape, the feather, the mode and the inversion
 * are all decisions the author has already made, and "put it on the left" is not
 * a reason to undo any of them.
 */
export function patchForMaskPlace(v) {
  const p = MASK_PLACES.find((e) => e.v === v);
  if (!p) return null;
  return { maskX: p.x, maskY: p.y, maskW: p.w, maskH: p.h, maskRot: 0 };
}

/** "Green key · Ellipse, darkened outside" — empty when the clip is untouched. */
export function matteSummary(c) {
  if (!hasMatte(c)) return '';
  const m = makeMatte(c);
  const parts = [];
  if (keyActive(c)) parts.push(m.keyMode === 'luma' ? 'Brightness key' : `Key ${m.keyColour}`);
  if (maskActive(c)) {
    const shape = MASK_SHAPES.find((s) => s.v === m.maskShape)?.t || m.maskShape;
    const mode = MODE_BY.get(m.maskMode)?.t || m.maskMode;
    parts.push(`${shape} · ${mode.toLowerCase()}${m.maskInvert ? ', inverted' : ''}`);
  }
  return parts.join(' · ');
}

/* --------------------------------------------------------- the key maths -- */

/* ITU-R BT.601, which is the space every consumer codec this tool can import
   already stores its colour in — so the distance measured here is the distance
   the camera itself thought it was recording. */
export function rgbToYcc(r, g, b) {
  return {
    y: 0.299 * r + 0.587 * g + 0.114 * b,
    cb: -0.168736 * r - 0.331264 * g + 0.5 * b,
    cr: 0.5 * r - 0.418688 * g - 0.081312 * b,
  };
}

export function yccToRgb(y, cb, cr) {
  return {
    r: clamp(y + 1.402 * cr, 0, 255),
    g: clamp(y - 0.344136 * cb - 0.714136 * cr, 0, 255),
    b: clamp(y + 1.772 * cb, 0, 255),
  };
}

/**
 * Everything about a key that does not depend on the pixel, worked out once.
 *
 * Per frame rather than per pixel, which at 1920×1080 is the difference between
 * two million hex parses and one. The renderer holds the result for the whole
 * buffer.
 */
export function keyPrep(c) {
  const m = makeMatte(c);
  const h = m.keyColour.replace('#', '');
  /* The colour well always hands over `#rrggbb`, but a hand-edited project can
     carry any length the validator accepts (3 to 8). Expanding anything short
     nibble-by-nibble and then taking six is the only reading that does not turn
     `#abcd` into a completely unrelated colour via a four-digit parseInt — and a
     wrong key colour is a key that removes the wrong half of the picture. */
  const full = h.length < 6
    ? h.split('').map((ch) => ch + ch).join('').slice(0, 6).padEnd(6, '0')
    : h.slice(0, 6);
  const n = parseInt(full, 16) || 0;
  const kr = (n >> 16) & 255; const kg = (n >> 8) & 255; const kb = n & 255;
  const k = rgbToYcc(kr, kg, kb);
  const mag = Math.hypot(k.cb, k.cr) || 1;
  const span = m.keyMode === 'luma' ? 255 : CHROMA_RANGE;
  const inner = m.keyTol * span;
  return {
    mode: m.keyMode,
    kcb: k.cb,
    kcr: k.cr,
    /* The key's direction in the chroma plane, which is what spill is measured
       along. A unit vector, so the projection below is a distance rather than a
       distance times an arbitrary scale. */
    ucb: k.cb / mag,
    ucr: k.cr / mag,
    inner,
    outer: inner + m.keySoft * span,
    spill: m.keySpill,
  };
}

/**
 * How much of this pixel survives the key: 1 keeps it, 0 removes it.
 *
 * A band rather than a threshold, because a hard cut-off gives a jagged,
 * aliased edge on any real footage — the softness control is the width of the
 * band, and at zero this degrades to the step it would otherwise have been.
 */
export function keyAlphaAt(prep, r, g, b) {
  if (!prep || prep.mode === 'off') return 1;
  const c = rgbToYcc(r, g, b);
  const d = prep.mode === 'luma' ? c.y : Math.hypot(c.cb - prep.kcb, c.cr - prep.kcr);
  if (d <= prep.inner) return 0;
  if (d >= prep.outer) return 1;
  return (d - prep.inner) / (prep.outer - prep.inner);
}

/**
 * Take the key's colour back out of a pixel that survived it, into `out`.
 *
 * Green bounces. A subject standing in front of a lit green screen picks it up
 * along every edge and in every strand of hair, and a key alone leaves that
 * behind as a green rim that reads as a cut-out. This removes the part of the
 * pixel's colour that points AT the key — only the part that points at it, so a
 * genuinely green jacket loses its fringe rather than its colour.
 *
 * Writes into a caller-owned array rather than returning an object: this runs
 * once per surviving pixel, and two million short-lived objects per frame is a
 * garbage collector rather than an export.
 */
export function despillTo(prep, r, g, b, out) {
  out[0] = r; out[1] = g; out[2] = b;
  if (!prep || prep.mode !== 'chroma' || prep.spill <= 0) return out;
  const c = rgbToYcc(r, g, b);
  const proj = c.cb * prep.ucb + c.cr * prep.ucr;
  if (proj <= 0) return out;
  const cut = prep.spill * proj;
  const rgb = yccToRgb(c.y, c.cb - cut * prep.ucb, c.cr - cut * prep.ucr);
  out[0] = rgb.r; out[1] = rgb.g; out[2] = rgb.b;
  return out;
}

/* ================================================= placing it by hand ==== */
/*
 * Ten number boxes describe a mask; they are not a way to draw one. Nobody
 * covering a face thinks "nought point three eight, nought point two two" —
 * they point at the face. The boxes stay, because typing 0.5 is how you make
 * two split-screen halves meet exactly, but they should not be the only way in.
 *
 * THE SPACE THIS MATHS IS IN, WHICH IS THE WHOLE DIFFICULTY
 *
 * A mask is applied to the clip's OWN buffer, before the clip transform places
 * that buffer in the frame. So the mask rectangle is in buffer coordinates, and
 * a mask on a clip that has been shrunk into the corner appears on screen
 * shrunk into the corner and rotated with it — which is right, and is what an
 * author expects, and is also why none of the arithmetic below may touch the
 * clip transform. Everything here is in the clip's own CENTRED buffer pixels,
 * exactly the space doc/transform.js's invertPoint() hands back; the monitor
 * converts, in one place, using the inverse of the matrix the compositor draws
 * with. Mixing the two spaces gives a mask that is correct until the moment
 * somebody scales the clip, which is the sort of bug that gets called "sticky".
 */

/** A mask may not be dragged smaller than this fraction of the frame. */
export const MIN_MASK = 0.01;

/** The mask rectangle in the clip's centred buffer pixels, and its angle. */
export function maskBoxOf(clip, W, H) {
  const m = makeMatte(clip);
  const r = maskRectOf(m);
  return {
    cx: (r.x + r.w / 2) * W - W / 2,
    cy: (r.y + r.h / 2) * H - H / 2,
    hw: (r.w * W) / 2,
    hh: (r.h * H) / 2,
    rot: m.maskRot,
  };
}

/** A point in the mask's own axes -> the clip's buffer axes. */
function spin(box, lx, ly) {
  const rad = (box.rot * Math.PI) / 180;
  const cos = Math.cos(rad); const sin = Math.sin(rad);
  return [box.cx + lx * cos - ly * sin, box.cy + lx * sin + ly * cos];
}
/** …and back again. */
function unspin(box, bx, by) {
  const rad = (-box.rot * Math.PI) / 180;
  const cos = Math.cos(rad); const sin = Math.sin(rad);
  const dx = bx - box.cx; const dy = by - box.cy;
  return [dx * cos - dy * sin, dx * sin + dy * cos];
}

/**
 * The mask's corners and the point its rotation grip hangs off, in buffer
 * pixels. The grip's ARM is not here: how far outside the box it sits is
 * measured in output pixels, so that it is a fixed distance under the pointer
 * whatever the clip is scaled to — and output pixels are the monitor's business.
 */
export function maskHandlesFor(clip, W, H) {
  const box = maskBoxOf(clip, W, H);
  return {
    box,
    centre: [box.cx, box.cy],
    corners: [spin(box, -box.hw, -box.hh), spin(box, box.hw, -box.hh),
      spin(box, box.hw, box.hh), spin(box, -box.hw, box.hh)],
    topMid: spin(box, 0, -box.hh),
  };
}

/** True when a buffer-space point is inside the mask rectangle. */
export function insideMask(clip, W, H, bx, by) {
  const box = maskBoxOf(clip, W, H);
  const [lx, ly] = unspin(box, bx, by);
  return Math.abs(lx) <= box.hw && Math.abs(ly) <= box.hh;
}

/** Dragging the whole mask by this many buffer pixels. */
export function maskMoveBy(from, W, H, dbx, dby) {
  const next = makeMatte({
    ...from,
    maskX: num(from?.maskX, 0) + (W ? dbx / W : 0),
    maskY: num(from?.maskY, 0) + (H ? dby / H : 0),
  });
  return { maskX: next.maskX, maskY: next.maskY };
}

/**
 * Dragging a corner to a buffer-space point.
 *
 * About the CENTRE, and non-uniformly. Not because it was easier: a mask is
 * placed centre-first — you put it over the face, then size it until the face
 * is covered — and anchoring the opposite corner would walk the shape off the
 * thing you had just aimed it at every time you resized. Uniform scaling would
 * be worse still, since a face is not square.
 */
export function maskResizeTo(from, W, H, bx, by) {
  const box = maskBoxOf(from, W, H);
  const [lx, ly] = unspin(box, bx, by);
  /* Floored, because a mask with no area is treated as absent — so without this
     a corner dragged through the centre would make the mask vanish mid-gesture
     and leave nothing to drag back. */
  const w = Math.max(MIN_MASK, W ? (Math.abs(lx) * 2) / W : MIN_MASK);
  const h = Math.max(MIN_MASK, H ? (Math.abs(ly) * 2) / H : MIN_MASK);
  const next = makeMatte({
    ...from,
    maskX: (box.cx + W / 2) / W - w / 2,
    maskY: (box.cy + H / 2) / H - h / 2,
    maskW: w,
    maskH: h,
  });
  return { maskX: next.maskX, maskY: next.maskY, maskW: next.maskW, maskH: next.maskH };
}

/**
 * The angle that points the mask's top edge at a buffer-space point.
 *
 * Wrapped rather than clamped, because a rotation is cyclic: dragging the grip
 * past straight-down would otherwise stick at 180° and the shape would stop
 * following the pointer. (makeMatte still CLAMPS, which is the right reading of
 * an absurd number in a hand-edited file — it is only the gesture that has to
 * wrap, and it wraps before the normaliser ever sees it.)
 */
export function maskRotAt(box, bx, by) {
  let deg = (Math.atan2(by - box.cy, bx - box.cx) * 180) / Math.PI + 90;
  while (deg > 180) deg -= 360;
  while (deg < -180) deg += 360;
  return makeMatte({ maskRot: deg }).maskRot;
}
