/* Dead Signal Studio — doc/ramp.js
 *
 * How a held overlay arrives and leaves. Pure arithmetic, no canvas.
 *
 * Shared by every clip kind that is DRAWN ON TOP of the picture for a fixed
 * hold — titles and graphics today — because they owe the author the same two
 * promises and it would be a bug for them to keep those promises differently:
 *
 *   - the gesture is timed against THE CLIP'S OWN LENGTH, so making a title
 *     longer makes its fade more leisurely rather than leaving a half-second
 *     ramp stranded at the front of a ten-second hold;
 *
 *   - two ramps that together outrun the clip are SPLIT between it rather than
 *     left to overlap. Without that, a two-second overlay carrying a
 *     two-second in and a two-second out would ramp up through its whole
 *     length while simultaneously ramping down — it would never reach full
 *     strength, and no control on screen would explain why. Splitting keeps
 *     both gestures and simply makes them quicker, which is what an author
 *     shortening a clip means.
 *
 * Everything here is a function of (t, length, in, out) and nothing else. That
 * is what lets the exporter render frames out of order and the scrubber land on
 * any instant and be right — neither has a previous frame to ask.
 */

const num = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** The longest either ramp may be, in seconds. */
export const MAX_RAMP = 5;

/**
 * Smoothstep.
 *
 * Linear motion reads as mechanical on anything this short — a half-second
 * linear fade looks like a light switch, the same fade eased looks intentional.
 */
export const ease = (u) => u * u * (3 - 2 * u);

/**
 * How far through the in- and out-ramps we are at `t`, each 0..1.
 *
 * @returns {{rin:number, rout:number, inSec:number, outSec:number}}
 *   `rin` climbs 0→1 across the in-ramp and stays 1; `rout` is 1 until the
 *   out-ramp then falls 1→0. `inSec`/`outSec` are the ramps as ACTUALLY used
 *   after any splitting, so a caller drawing a readout shows the truth rather
 *   than the setting.
 */
export function ramps(t, len, inSec, outSec) {
  const L = Math.max(0.0001, num(len, 0));
  const at = clamp(num(t, 0), 0, L);
  let i = clamp(num(inSec, 0), 0, MAX_RAMP);
  let o = clamp(num(outSec, 0), 0, MAX_RAMP);
  const total = i + o;
  if (total > L && total > 0) { const k = L / total; i *= k; o *= k; }
  return {
    rin: i > 0 ? clamp(at / i, 0, 1) : 1,
    rout: o > 0 ? clamp((L - at) / o, 0, 1) : 1,
    inSec: i,
    outSec: o,
  };
}
