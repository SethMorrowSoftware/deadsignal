/* Dead Signal Studio — doc/annotations.js
 *
 * Free placement on a screen: text, boxes, redactions, arrows.
 *
 * The forty-six SCREEN templates each bake their own layout. That is what makes
 * them one-click — a BSOD looks like a BSOD because nobody had to position it —
 * but it also means "put the caption HERE instead" was not expressible at all.
 * Re-authoring forty-six templates against a layout engine is the expensive
 * answer and it would make every one of them worse.
 *
 * The cheap answer is a layer on top: the template draws what it always drew,
 * and the author adds their own marks over it. One annotation model works for
 * all forty-six, including the fifteen paper templates, and a template added
 * tomorrow gets it for nothing.
 *
 * COORDINATES ARE FRACTIONS OF THE CANVAS, never pixels. The screen size and
 * aspect are controls — switching from 480×360 to a 16:9 poster is one click —
 * and pixel coordinates would send every annotation somewhere else the moment
 * that happened. Fractions mean a caption in the lower third stays in the lower
 * third. Sizes follow the same rule: `size` is a percentage of the screen's own
 * type scale, so text placed on a small preview is the same relative size in a
 * 4× export.
 *
 * This module is the stored shape and the geometry. The drawing lives in
 * image/annotate.js (it needs a canvas) and the panel in ui/annotations.js.
 */

/** A screen with more than this on it is a layout, not an annotation. */
export const MAX_ANNOTATIONS = 24;
/** Long enough for a caption or a stamp; not a place to paste a document. */
export const MAX_TEXT = 200;

/* `box: true` means the mark is defined by a rectangle (or, for line/arrow, by
   the diagonal of one) and gets a resize grip. `text: true` means it carries a
   string. Nothing else varies, which is why one draw function covers all six. */
export const ANNOTATION_KINDS = [
  { id: 'text', label: 'Text', text: true,
    hint: 'A line of type placed anywhere. Give it a width to wrap it; leave the width at zero and it stays on one line.' },
  { id: 'box', label: 'Box', box: true,
    hint: 'An outlined rectangle — for circling the thing you want looked at.' },
  { id: 'fill', label: 'Redaction', box: true,
    hint: 'A solid block. The classifed-document bar: cover something rather than point at it.' },
  { id: 'ellipse', label: 'Ellipse', box: true,
    hint: 'An outlined ellipse inscribed in the rectangle. Softer than a box, and it reads as handwritten.' },
  { id: 'line', label: 'Line', box: true, diagonal: true,
    hint: 'A straight line from one corner of the rectangle to the other. Drag the grip to aim it.' },
  { id: 'arrow', label: 'Arrow', box: true, diagonal: true,
    hint: 'A line with a head on the end you dragged to. For pointing at something off to the side.' },
];

const BY_ID = new Map(ANNOTATION_KINDS.map((k) => [k.id, k]));
export const annotationKind = (id) => BY_ID.get(id);

export const ALIGNS = ['left', 'center', 'right'];

const clamp = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
const numOr = (v, d) => (Number.isFinite(+v) ? +v : d);

/**
 * One annotation, cleaned up.
 *
 * An unknown kind becomes `text` rather than being dropped: a project written
 * by a newer build should lose the *shape* of a mark, not the words in it.
 */
export function makeAnnotation(a = {}) {
  const kind = BY_ID.has(a.kind) ? a.kind : 'text';
  const spec = BY_ID.get(kind);
  return {
    kind,
    x: clamp(numOr(a.x, 0.5), 0, 1),
    y: clamp(numOr(a.y, 0.5), 0, 1),
    /* Signed, and deliberately: a line drawn up-and-left is a different line
       from the same one drawn down-and-right, because the arrowhead is on the
       end you dragged to. Rect kinds normalise the sign at draw time. */
    w: clamp(numOr(a.w, spec.box ? 0.25 : 0), -1, 1),
    h: clamp(numOr(a.h, spec.box ? 0.12 : 0), -1, 1),
    text: String(a.text ?? '').slice(0, MAX_TEXT),
    /* '' means "whatever the screen's foreground is" — so a mark follows a
       palette change instead of becoming invisible against the new background. */
    color: /^#[0-9a-f]{3,8}$/i.test(String(a.color || '')) ? String(a.color) : '',
    size: clamp(numOr(a.size, 100), 20, 400),
    weight: clamp(numOr(a.weight, 2), 1, 12),
    align: ALIGNS.includes(a.align) ? a.align : 'left',
  };
}

/** A stored list, cleaned up and capped. Junk becomes an empty list. */
export function normalizeAnnotations(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((a) => a && typeof a === 'object' && !Array.isArray(a))
    .slice(0, MAX_ANNOTATIONS).map(makeAnnotation);
}

/**
 * The rectangle a box-kind annotation covers, in fractions, sign removed.
 *
 * Drawing a rect with a negative width works on a canvas but hit-testing it
 * does not, and neither does asking whether a point is inside it — so the sign
 * is resolved in exactly one place.
 */
export function rectOf(a) {
  const x = Math.min(a.x, a.x + a.w), y = Math.min(a.y, a.y + a.h);
  return { x, y, w: Math.abs(a.w), h: Math.abs(a.h) };
}

/** Is this annotation, as drawn, entirely off the canvas? */
export function offCanvas(a) {
  const spec = BY_ID.get(a.kind);
  if (!spec?.box) return a.x < 0 || a.x > 1 || a.y < 0 || a.y > 1;
  const r = rectOf(a);
  return r.x > 1 || r.y > 1 || r.x + r.w < 0 || r.y + r.h < 0;
}

/**
 * Move one annotation by a fractional delta, keeping it on the canvas.
 *
 * Clamping the ANCHOR rather than the whole rectangle is deliberate: a box
 * dragged to the edge should be able to hang off it (a redaction bar that runs
 * to the margin is a normal thing to want), but its handle must stay reachable
 * or the author has thrown it away.
 */
export function moveAnnotation(a, dx, dy) {
  return { ...a, x: clamp(a.x + dx, 0, 1), y: clamp(a.y + dy, 0, 1) };
}

/** Resize by dragging the far corner. Text uses `w` as its wrap width only. */
export function resizeAnnotation(a, w, h) {
  const spec = BY_ID.get(a.kind);
  if (!spec?.box) return { ...a, w: clamp(w, 0, 1), h: a.h };
  return { ...a, w: clamp(w, -1, 1), h: clamp(h, -1, 1) };
}

/** A short human label for the list, derived rather than stored. */
export function annotationLabel(a) {
  const spec = BY_ID.get(a.kind) || ANNOTATION_KINDS[0];
  if (spec.text) return a.text.trim().slice(0, 24) || '(empty text)';
  return spec.label;
}
