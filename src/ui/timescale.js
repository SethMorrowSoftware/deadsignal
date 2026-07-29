/* Dead Signal Studio — ui/timescale.js
 *
 * The sequence lane's time scale: how many pixels a second is worth, where a
 * tick goes, and how far the lane can be scrolled. Pure — no DOM, no store, no
 * canvas — so every claim below is pinned by the headless suite rather than
 * being something only a browser can check.
 *
 * WHY THIS EXISTS
 *
 * The lane had no scale of any kind. Blocks were positioned as a PERCENTAGE of
 * the sequence duration, and "zoom" set the lane element's CSS width to
 * somewhere between 100% and 600% — so zooming made the same picture
 * physically bigger and nothing else. The ruler chose its tick step from the
 * duration alone, against a comment that hard-coded "a ~600px track", so at
 * 600% zoom you got the same six ticks stretched six times further apart. That
 * is a magnifying glass, not a time scale: you cannot zoom in to place a cut on
 * a particular frame, because the thing you are zooming has no idea how big it
 * is.
 *
 * THE ONE DECISION EVERYTHING ELSE FOLLOWS FROM
 *
 * pixels-per-second is FIT-RELATIVE: at zoom 1 the content is exactly as wide
 * as its viewport. That means zoom 1 is byte-for-byte the layout that shipped
 * before this module existed — no scrollbar in the common case, no reflow, and
 * nothing to regress. Zoom above 1 makes the content wider than the viewport
 * and the lane scrolls. An absolute scale (say "40px per second, always") would
 * have been simpler to write and would have put a scrollbar under every short
 * sequence on day one.
 *
 * The ruler follows the zoom because tickStep() is a function of the SCALE, not
 * of the duration. That is the whole of what the old zoom could not do.
 */

import { clipLength, isOverlay } from '../doc/timeline.js';
import { audioClipLength } from '../doc/audioclip.js';

/** Zoom 1 fits the sequence to the viewport; 6 matches the old 600% control. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;

/* Steps an author counts in. A ruler that ticks every 0.37 seconds is arithmetic
   homework, not a ruler — so the step is snapped to this ladder rather than
   computed. Sub-second entries matter at high zoom: at 12fps a frame is 0.083s,
   and 0.05 is the first rung below it. */
export const TICK_LADDER = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/* A hard stop on how many tick elements may be built. A 3840-second sequence at
   the finest step is 76,800 spans — enough DOM to lock the tab up, from a
   control whose whole job is to make things easier to see. */
export const MAX_TICKS = 400;

const finite = (n, fallback = 0) => (Number.isFinite(n) ? n : fallback);
/* Snap targets are held to a millisecond. Finer than that and two edges that
   are visually identical — a clip butted against its neighbour — compare
   unequal because of float error, and the set stops de-duplicating them. */
const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Zoom, clamped, with anything unreadable treated as "fit".
 *
 * NaN and Infinity are different failures and are answered differently. NaN
 * (a control read before it had a value, junk out of localStorage) carries no
 * direction, so it means "fit". Infinity does carry one — it is an out-of-range
 * number, not a non-number — so it clamps to the end of the range like any
 * other, which is what makes Math.min/max's own contract hold here.
 */
export function clampZoom(z) {
  const n = Number(z);
  if (Number.isNaN(n)) return ZOOM_MIN;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
}

/**
 * The scale at which `duration` exactly fills `viewportPx`.
 *
 * The duration floor is the same 0.1 the schedule uses for `total`: an empty
 * sequence must produce a finite scale, or every geometry call downstream
 * returns NaN and the lane renders with `left:NaNpx`.
 */
export function fitPxPerSecond(duration, viewportPx) {
  const d = Math.max(0.1, finite(Number(duration), 0));
  const v = Math.max(0, finite(Number(viewportPx), 0));
  return v / d;
}

/** Pixels per second at this zoom. Fit-relative — see the docblock. */
export function pxPerSecond(duration, viewportPx, zoom) {
  return fitPxPerSecond(duration, viewportPx) * clampZoom(zoom);
}

export function timeToPx(t, pps) {
  return finite(Number(t), 0) * Math.max(0, finite(Number(pps), 0));
}

/** The inverse. Guarded, because a zero scale is a division by zero, not a bug. */
export function pxToTime(px, pps) {
  const s = Math.max(0, finite(Number(pps), 0));
  return s > 0 ? finite(Number(px), 0) / s : 0;
}

/**
 * The coarsest ladder step that still puts ticks at least `targetPx` apart.
 *
 * Monotone in the scale by construction: zooming in can only ever hold the step
 * or make it finer, never coarser. A ruler that got vaguer as you zoomed in
 * would be worse than no ruler.
 */
export function tickStep(pps, targetPx = 72) {
  const s = Math.max(0, finite(Number(pps), 0));
  const want = Math.max(1, finite(Number(targetPx), 72));
  if (!(s > 0)) return TICK_LADDER[TICK_LADDER.length - 1];
  const seconds = want / s;
  return TICK_LADDER.find((step) => step >= seconds) ?? TICK_LADDER[TICK_LADDER.length - 1];
}

/**
 * Every tick time across `duration`, inclusive of the end.
 *
 * Coarsens rather than truncating when the count would exceed MAX_TICKS: a
 * ruler that simply stopped halfway would be a ruler that lies about the second
 * half of the sequence.
 */
export function tickTimes(duration, pps, targetPx = 72) {
  const total = Math.max(0, finite(Number(duration), 0));
  let step = tickStep(pps, targetPx);
  let idx = TICK_LADDER.indexOf(step);
  while (total / step > MAX_TICKS && idx < TICK_LADDER.length - 1) step = TICK_LADDER[++idx];
  const out = [];
  // Counted rather than accumulated: repeated += of 0.05 drifts, and a tick
  // labelled 12.000000000000002 is a tick that was added up instead of measured.
  const n = Math.min(MAX_TICKS, Math.floor(total / step + 1e-6));
  for (let k = 0; k <= n; k++) out.push(Math.round(k * step * 1000) / 1000);
  return out;
}

/** Scroll offset, held inside what there is to scroll. */
export function clampScroll(px, contentPx, viewportPx) {
  const max = Math.max(0, finite(Number(contentPx), 0) - finite(Number(viewportPx), 0));
  return Math.min(max, Math.max(0, finite(Number(px), 0)));
}

/** A tick label: seconds while that is short, m:ss once it is not. */
export function tickLabel(t) {
  const v = finite(Number(t), 0);
  if (v >= 60) return `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}`;
  return `${+v.toFixed(2)}s`;
}

/* ============================================================== snapping ==
   Before this, a drag landed wherever the pointer let go — some arbitrary
   hundredth of a second. Butting one clip against another, ending a shot on the
   beat you can see on the audio lane, or starting an overlay exactly at the
   playhead were all a matter of zooming in and nudging until the number looked
   right. Every editor solves this the same way, and the reason it works is that
   the pull is measured in PIXELS rather than in seconds: eight pixels is the
   same forgiving gesture whether you are looking at a whole minute or at three
   frames, which a fixed 0.1s tolerance is emphatically not.
   ======================================================================== */

/** How close, in pixels, a drag has to get before it is pulled in. */
export const SNAP_PX = 8;

/**
 * The times a drag should be pulled toward.
 *
 * Every clip's start and end on both video tracks, every sound's start and end,
 * the playhead, and zero. `skip` excludes the clip being dragged: a clip that
 * snapped to its own edges could never be moved off them.
 *
 * Sorted and de-duplicated so a tie between two coincident targets — which is
 * the common case, since clips butt against each other — resolves the same way
 * every time rather than depending on array order.
 */
export function snapCandidates(clips, starts, audio, playhead, skip = null) {
  const out = new Set([0]);
  const t = Number(playhead);
  if (Number.isFinite(t) && t >= 0) out.add(round3(t));
  const list = Array.isArray(clips) ? clips : [];
  const at = Array.isArray(starts) ? starts : [];
  for (let i = 0; i < list.length; i++) {
    if (skip && skip.lane === 'V' && skip.i === i) continue;
    /* `andAfter` excludes everything the drag is going to MOVE, and it is the
       difference between snapping and a lane that will not budge. Trimming a
       spine clip re-derives the start of every spine clip after it — so the
       next clip's start is not a fixed target at all, it is the dragged edge
       itself, one commit behind. Left in, the pointer finds a candidate within
       a pixel of where it already is on every single move and the clip sticks
       where it started. Overlays and sounds after it are positioned rather
       than derived, so they stay: they really are where they say they are. */
    if (skip && skip.lane === 'V' && skip.andAfter && i > skip.i && !isOverlay(list[i])) continue;
    const s = Number(at[i]);
    if (!Number.isFinite(s)) continue;
    const len = clipLength(list[i]);
    out.add(round3(s));
    out.add(round3(s + len));
  }
  const sounds = Array.isArray(audio) ? audio : [];
  for (let k = 0; k < sounds.length; k++) {
    if (skip && skip.lane === 'A' && skip.i === k) continue;
    const c = sounds[k];
    const s = Number(c?.at);
    if (!Number.isFinite(s)) continue;
    out.add(round3(s));
    out.add(round3(s + audioClipLength(c)));
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * `t`, pulled to the nearest candidate within the tolerance — or `t` unchanged.
 *
 * The tolerance is converted through the live scale, which is the whole point:
 * zoomed out, eight pixels is a second and the pull is generous; zoomed in it is
 * a frame and the pull is precise. Nothing to configure, and it is right at
 * every zoom by construction.
 */
export function snapTime(t, candidates, pxPerSec, tolerancePx = SNAP_PX) {
  const v = finite(Number(t), 0);
  const pps = finite(Number(pxPerSec), 0);
  if (!(pps > 0) || !Array.isArray(candidates) || !candidates.length) return v;
  const tol = Math.abs(finite(Number(tolerancePx), SNAP_PX)) / pps;
  if (!(tol > 0)) return v;
  let best = v;
  let bestD = tol;
  for (const c of candidates) {
    const d = Math.abs(c - v);
    // Strictly closer, so the earliest of two equidistant targets wins and the
    // result does not depend on which order they were collected in.
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/**
 * A whole clip moved to `at`, snapping whichever of its two ENDS is nearest.
 *
 * Snapping only the head would make butting a clip up against the one before it
 * work and butting it against the one after it not — and those are the same
 * gesture to whoever is doing it. The smaller correction wins, so the edge you
 * were clearly aiming with is the one that grabs.
 */
export function snapMove(at, len, candidates, pxPerSec, tolerancePx = SNAP_PX) {
  const a = finite(Number(at), 0);
  const l = Math.max(0, finite(Number(len), 0));
  const head = snapTime(a, candidates, pxPerSec, tolerancePx);
  const tail = snapTime(a + l, candidates, pxPerSec, tolerancePx);
  /* Asked as a question about the TARGET, not inferred from a subtraction.
     `tail - l` reintroduces the float error that `a + l` introduced, so a tail
     that did not snap comes back as 1.9800000000000002 rather than 1.98 — a
     correction of 2e-16, which then beats a real 0.02 pull from the head and
     the clip refuses to move. snapTime returns its input by identity when
     nothing is in range, so comparing against that is exact. */
  const hitHead = head !== a;
  const hitTail = tail !== a + l;
  if (!hitHead && !hitTail) return a;
  if (!hitTail) return head;
  if (!hitHead) return tail - l;
  return Math.abs(tail - l - a) < Math.abs(head - a) ? tail - l : head;
}
