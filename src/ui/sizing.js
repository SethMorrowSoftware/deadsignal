/* Dead Signal Studio — ui/sizing.js
 *
 * Wiring the Format and Aspect pickers to a tab's W/H pair.
 *
 * VIDEO, TIMELINE and SCREEN all have the same problem and used to solve it
 * three different ways (VIDEO had an aspect picker, the other two had nothing),
 * so this is one implementation the three of them share.
 */
import { $, num, setVal } from '../core/dom.js';
import { ASPECTS, FORMATS, MAX_DIM, fillSelect, fitRatio, formatById, formatFor } from '../core/formats.js';

/**
 * Wire one tab's sizing controls.
 *
 * @param {object} o
 * @param {string} [o.format] id of the Format select
 * @param {string} [o.aspect] id of the Aspect select
 * @param {string} o.w  id of the width input
 * @param {string} o.h  id of the height input
 * @param {number} [o.maxW]
 * @param {number} [o.maxH]
 * @param {() => void} [o.after] called once the size has changed
 * @param {(factor:number) => void} [o.onResize] the frame was deliberately
 *   re-scaled by this linear factor — see the note below.
 */
/**
 * Fill the Format and Aspect pickers and put them where the size already says,
 * BEFORE the document is seeded from the markup.
 *
 * These two are the last selects that broke the invariant `startSession` states:
 * *"Selects must already be filled, or their .value would not yet be the real
 * default the markup implies."* They are filled by initSizing(), which runs at
 * tab-init — long after the document snapshot — so the boot default recorded for
 * both was the **empty string**, and a project saved before the first edit
 * carried `""` for Format and Aspect.
 *
 * Worse, they did not stay empty: the first ordinary edit anywhere in the view
 * runs wireLive → syncFormat, which derives the format from W and H and writes
 * it; that write fires the picker's own change handler, which writes the aspect.
 * Measured on a stock build: **one nudge of the Scanlines slider cost three undo
 * entries**, and the first two undid a Format and an Aspect the author had never
 * set. Every comparable action — add a clip, add a layer, add a mark — is one.
 *
 * Priming here makes the seeded document hold what the size already implies, so
 * the first edit is one edit. The same three-part fix as the seven blanked
 * selects: filled before the seed, real state kept as real state, and nothing
 * left to be corrected later.
 */
export function primeSizing({ format, aspect, w, h }) {
  const fmt = format ? $(format) : null;
  const asp = aspect ? $(aspect) : null;
  if (fmt) fillSelect(fmt, FORMATS);
  if (asp) fillSelect(asp, ASPECTS);
  if (!fmt) return false;
  const want = formatFor(num(w, 0), num(h, 0));
  if ([...fmt.options].some((o) => o.value === want)) fmt.value = want;   /* dom-only: before any session exists, this IS the markup's default */
  const f = formatById(fmt.value);
  if (asp && f && f.ratio && [...asp.options].some((o) => o.value === f.ratio)) {
    asp.value = f.ratio;   /* dom-only: same — seeding the default, not editing it */
  }
  return true;
}

export function initSizing({ format, aspect, w, h, maxW = MAX_DIM, maxH = MAX_DIM, after, onResize }) {
  const fmt = format ? $(format) : null;
  const asp = aspect ? $(aspect) : null;
  if (fmt) fillSelect(fmt, FORMATS);
  if (asp) fillSelect(asp, ASPECTS);

  const sync = () => syncFormat({ format, w, h });

  /**
   * How much bigger the frame just got, as a single number.
   *
   * The SHORT side, which is the reference the rest of the tool already uses
   * for anything measured against the frame — a graphic's stroke weight, a
   * mask's feather, a paper template's type. Using the diagonal or the area
   * would make a letterbox slot count as "bigger" than the 4:3 frame it came
   * from while being shorter in every direction that matters to a grain size.
   *
   * Returns 1 — meaning "do nothing" — for any degenerate before/after, so a
   * control mid-edit cannot rescale a chain by NaN.
   */
  const factorBetween = (w0, h0, w1, h1) => {
    const a = Math.min(w0, h0); const b = Math.min(w1, h1);
    if (!(a > 0) || !(b > 0)) return 1;
    return b / a;
  };
  /* Only a DELIBERATE re-scale carries the pixel-denominated controls with it:
     picking a format or an aspect. Typing into the W and H boxes does not, and
     that asymmetry is the point — typing a number is how you correct a size,
     and having the tool rewrite five other controls underneath each keystroke
     would be unusable. */
  const resized = (before) => {
    if (!onResize) return;
    const f = factorBetween(before.w, before.h, num(w, before.w), num(h, before.h));
    if (Math.abs(f - 1) > 1e-6) onResize(f);
  };
  const sizeNow = () => ({ w: num(w, 0), h: num(h, 0) });

  if (fmt) {
    fmt.addEventListener('change', () => {
      const f = formatById(fmt.value);
      if (!f || !f.w) return;
      const before = sizeNow();
      setVal(w, f.w);
      setVal(h, f.h);
      // Keep the two pickers agreeing: a format implies a shape.
      if (asp && f.ratio) setVal(aspect, f.ratio);
      resized(before);
      after?.();
    });
  }

  if (asp) {
    asp.addEventListener('change', () => {
      if (!asp.value) return;
      const before = sizeNow();
      const fit = fitRatio(asp.value, num(w, 320), num(h, 240), { maxW, maxH });
      setVal(w, fit.w);
      setVal(h, fit.h);
      sync();
      resized(before);
      after?.();
    });
  }

  return { sync };
}

/**
 * Put the Format picker back to "custom" once the size no longer matches it.
 *
 * A picker that still says "Shorts · 1080×1920" over a 640×480 frame is worse
 * than no picker: it is a label that has stopped describing the thing under it.
 */
export function syncFormat({ format, w, h }) {
  const fmt = format ? $(format) : null;
  if (!fmt) return;
  const want = formatFor(num(w, 0), num(h, 0));
  if (fmt.value !== want) setVal(format, want);
}

/**
 * Multiply a numeric control by `factor`, inside its own bounds.
 *
 * Through setVal, so the control's own listeners fire and the document hears
 * about it exactly as if a person had typed the number — a direct `.value`
 * write would move the box and leave the project holding the old value.
 */
export function scaleNumControl(id, factor) {
  const el = $(id);
  if (!el || !Number.isFinite(factor) || factor <= 0) return false;
  const cur = Number(el.value);
  if (!Number.isFinite(cur)) return false;
  const step = Number(el.step) > 0 ? Number(el.step) : 1;
  const lo = Number.isFinite(Number(el.min)) ? Number(el.min) : -Infinity;
  const hi = Number.isFinite(Number(el.max)) ? Number(el.max) : Infinity;
  const next = Math.min(hi, Math.max(lo, Math.round((cur * factor) / step) * step));
  if (next === cur) return false;
  setVal(id, next);
  return true;
}
