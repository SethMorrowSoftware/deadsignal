/* Dead Signal Studio — ui/stagefit.js
 *
 * One number per monitor: the aspect ratio of the picture in it.
 *
 * WHY THIS EXISTS
 *
 * The program monitor used to show the picture at its own pixel size — a
 * 320×240 clip drew 320×240 in the middle of a 794px black frame, and stayed
 * 320×240 however large the window was. That is `width:auto; height:auto` on a
 * replaced element: `max-width`/`max-height` are upper bounds, so the canvas
 * could only ever shrink, never grow. It was the single loudest complaint
 * about this tool.
 *
 * Fitting a picture to a box is normally a one-line CSS job, and every
 * one-liner is wrong here:
 *
 *   object-fit:contain      Correct picture, wrong BOX. The element keeps the
 *                           frame's full size and letterboxes inside it, so
 *                           getBoundingClientRect() no longer describes the
 *                           picture. Three pointer readers map clientX/clientY
 *                           through that rect into buffer pixels — the monitor
 *                           transform/mask/eyedropper (ui/monitor.js), the
 *                           screen annotations (ui/annotations.js) and the
 *                           waveform selection (ui/regions.js) — and all three
 *                           would silently start mapping the black bars into
 *                           the picture.
 *
 *   width:100%;height:auto  Fits a tall frame, DISTORTS a wide one: the
 *                           browser clamps the height at max-height and leaves
 *                           the width where it was. Measured in Chromium: a
 *                           4:3 canvas in a 600×200 box came out 600×200.
 *
 *   height:100%;width:auto  The same failure the other way round: a 4:3 canvas
 *                           in a 600×500 box came out 600×500.
 *
 * (The last two are what CSS 2.1 §10.4's min/max table says should re-solve
 * the other axis. Chromium does not do that for a canvas, so it is not a
 * behaviour to build on.)
 *
 * What does work in every orientation is asking for the smaller of the two
 * fits explicitly, which needs both axes of the frame in one expression —
 * container query units:
 *
 *   width: min(100cqw, calc(100cqh * var(--stage-ar)));
 *
 * CSS can measure the frame; it cannot read a canvas's `width`/`height`
 * content attributes. So this module supplies the one thing missing: it writes
 * `--stage-ar` onto each monitor frame and keeps it true. The element's border
 * box stays exactly the picture, so all three pointer readers keep working
 * untouched — no letterbox, nothing to compensate for.
 */
import { $ } from '../core/dom.js';

/** Frames whose picture is a graph rather than a photograph — see fit(). */
const STRETCH = new Set(['a-wavewrap']);

const DEFAULT_AR = 4 / 3;

/**
 * Write the ratio of `canvas` onto the frame that holds it.
 *
 * Rounded to four places: the value lands in a `calc()` that is re-evaluated on
 * every layout, and an unrounded ratio changes in the last float digit as the
 * buffer is re-allocated, which is a style write and a repaint for no visible
 * difference.
 */
export function fit(canvas) {
  if (!canvas) return false;
  const frame = canvas.closest('.screen');
  if (!frame) return false;
  /* The waveform is a plot of amplitude against time, not a picture of
     anything: it has no true shape, and letterboxing it to a 4:1 box would
     throw away width that the eye actually uses. It fills its frame, and
     ui/regions.js maps the pointer through r.width alone, so the stretch
     costs nothing. */
  if (STRETCH.has(frame.id)) { frame.classList.add('stage-stretch'); return true; }
  const w = Number(canvas.width) || 0;
  const h = Number(canvas.height) || 0;
  const ar = w > 0 && h > 0 ? w / h : DEFAULT_AR;
  const next = String(Math.round(ar * 1e4) / 1e4);
  if (frame.style.getPropertyValue('--stage-ar') !== next) frame.style.setProperty('--stage-ar', next);
  return true;
}

/** Re-measure every monitor on the page. */
export function fitAll() {
  for (const c of document.querySelectorAll('canvas.stage')) fit(c);
}

let _observer = null;

/**
 * Start keeping every monitor's ratio true.
 *
 * A MutationObserver on the `width`/`height` content attributes rather than a
 * poll or a hook at each call site: those attributes are the ONLY thing that
 * changes a canvas's shape, and they are written from six different modules
 * (video/capture.js, video/timeline.js, image/render.js, audio/ui.js and the
 * two thumbnail renderers). One observer cannot be forgotten by the seventh.
 */
export function initStageFit() {
  fitAll();
  if (_observer || typeof MutationObserver !== 'function') return fitAll;
  _observer = new MutationObserver((records) => {
    for (const r of records) if (r.target instanceof HTMLCanvasElement) fit(r.target);
  });
  for (const c of document.querySelectorAll('canvas.stage')) {
    _observer.observe(c, { attributes: true, attributeFilter: ['width', 'height'] });
  }
  return fitAll;
}

/** Test seam: the ratio a frame is currently laid out with. */
export function stageRatio(frameId) {
  const f = $(frameId);
  return f ? f.style.getPropertyValue('--stage-ar') : '';
}
