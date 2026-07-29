/* Dead Signal Studio — ui/flashmeter.js
 *
 * Photosensitivity measurement.
 *
 * This tool exists to make strobing, flickering, hard-cutting content. Blink
 * codes flash the whole screen by design; Flicker, dip-to-black transitions and
 * subliminal frames all do the same thing. That is the point — and it is also
 * exactly the pattern that triggers seizures.
 *
 * WCAG 2.3.1 sets the general flash threshold at three flashes per second,
 * where a flash is a pair of opposing changes in relative luminance of 0.1 or
 * more, over a large enough area. We measure the frames actually being
 * rendered rather than inferring from the recipe, because the recipe cannot
 * know that a blink code, a fade and a scene cut happen to land together.
 *
 * It warns; it never blocks. The content is intentional and the author is
 * entitled to make it. What they are not entitled to is not knowing.
 */

const WINDOW_MS = 2000;      // WCAG measures within any one-second period; two
                             // seconds of history keeps the readout stable.
const LUM_STEP = 0.1;        // relative-luminance change that counts
const THRESHOLD_HZ = 3;      // above this, warn

let sampler = null;          // tiny offscreen canvas
let history = [];            // { t, lum }
let lastExtreme = null;      // luminance at the last counted transition
let direction = 0;           // +1 rising, -1 falling
let flashTimes = [];         // timestamps of completed flashes
let lastPaint = -Infinity;   // last readout repaint, on the caller's clock

/** Mean relative luminance of a canvas, sampled cheaply at 16x16. */
export function meanLuminance(canvas) {
  if (!canvas || !canvas.width || !canvas.height) return 0;
  if (!sampler) {
    sampler = document.createElement('canvas');
    sampler.width = 16; sampler.height = 16;
  }
  const ctx = sampler.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, 16, 16);
  const d = ctx.getImageData(0, 0, 16, 16).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    // sRGB -> relative luminance, per WCAG
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    sum += 0.2126 * f(d[i]) + 0.7152 * f(d[i + 1]) + 0.0722 * f(d[i + 2]);
  }
  return sum / (d.length / 4);
}

export function resetFlashMeter() { history = []; flashTimes = []; lastExtreme = null; direction = 0;
  // lastPaint too: leaving it set meant the first paint after a reset could be
  // swallowed by the repaint throttle, so the readout kept showing the rate of
  // the clip before the one now playing.
  lastPaint = -Infinity; }

/**
 * Feed one rendered frame. Returns the current flash rate in Hz.
 * @param {HTMLCanvasElement} canvas
 * @param {number} now milliseconds
 */
export function sampleFlash(canvas, now) {
  return feedLuminance(meanLuminance(canvas), now);
}

/**
 * The detector proper, separated from measurement so the WCAG maths can be
 * tested against known luminance sequences without a canvas.
 * @param {number} lum relative luminance 0..1
 * @param {number} now milliseconds
 */
export function feedLuminance(lum, now) {
  history.push({ t: now, lum });
  while (history.length && now - history[0].t > WINDOW_MS) history.shift();

  if (lastExtreme === null) { lastExtreme = lum; return rate(now); }

  const delta = lum - lastExtreme;
  if (Math.abs(delta) >= LUM_STEP) {
    const dir = delta > 0 ? 1 : -1;
    // A flash is a PAIR of opposing changes — light→dark→light is one flash,
    // not two. Count only on reversal.
    if (direction !== 0 && dir !== direction) flashTimes.push(now);
    direction = dir;
    lastExtreme = lum;
  }
  while (flashTimes.length && now - flashTimes[0] > WINDOW_MS) flashTimes.shift();
  return rate(now);
}

function rate(now) {
  // Count only flashes still inside the window *as measured from `now`*.
  // Relying on feedLuminance() to have pruned them assumed the next question
  // would be asked at the same moment as the last sample — so a paused or
  // stopped preview kept reporting the rate of the frames before it stopped.
  const cut = now - WINDOW_MS;
  let n = 0;
  for (let i = flashTimes.length - 1; i >= 0 && flashTimes[i] >= cut; i--) n++;
  if (!n) return 0;
  const span = Math.min(WINDOW_MS, now - (history[0]?.t ?? now)) / 1000;
  return span > 0 ? n / span : 0;
}

/** @param {number} [now] defaults to the wall clock; pass one to measure at a chosen moment. */
export function currentRate(now) { return rate(now ?? performance.now()); }
export function isRisky(now) { return currentRate(now) > THRESHOLD_HZ; }
export { THRESHOLD_HZ };

/**
 * Update the readout. Kept separate from measurement so the sampler can run in
 * the render loop while the DOM is touched at most a few times a second.
 */
export function paintFlash(el, now) {
  if (!el || now - lastPaint < 250) return;
  lastPaint = now;
  // Measured at the caller's `now`, not the wall clock. Two clocks in one
  // function is how this ended up throttling against one timeline while
  // reporting a rate from another.
  const hz = currentRate(now);
  const risky = hz > THRESHOLD_HZ;
  el.textContent = hz > 0 ? `flash ${hz.toFixed(1)}/s` : 'flash 0/s';
  el.classList.toggle('risky', risky);
  el.title = risky
    ? `Above the WCAG 2.3.1 limit of ${THRESHOLD_HZ} flashes per second. This clip may trigger seizures.`
    : `Full-screen luminance changes per second. The WCAG limit is ${THRESHOLD_HZ}.`;
  // Announce only on the transition, not every 250ms.
  const wasRisky = el.dataset.risky === 'true';
  if (risky !== wasRisky) {
    el.dataset.risky = String(risky);
    el.setAttribute('aria-live', risky ? 'assertive' : 'polite');
    if (risky) el.setAttribute('role', 'alert'); else el.removeAttribute('role');
  }
}
