/* Dead Signal Studio — doc/automation.js
 *
 * Keyframe tracks: a parameter's value over the length of a clip.
 *
 * Every control was a single constant for the whole clip, so nothing could
 * build, decay or arrive (F-08). A track turns one control into a curve — the
 * static rising over ten seconds, the tracking error that only appears at the
 * reveal — which is most of what separates a generated clip from a shot.
 *
 * This half is deliberately pure: no DOM, no store, no time source. It is the
 * part that has to be exactly right, because a track is evaluated once per
 * frame during export and any drift between preview and export shows up as a
 * clip that does not match what was scrubbed.
 *
 * A key is { t, v, e }: time in seconds, raw control value, and the easing
 * used to reach the NEXT key. Easing living on the left key is what lets a
 * single key mean "hold this value forever" without a second one to point at.
 */

/** Interpolators, by the name stored on a key. */
export const EASES = {
  // Step: hold the left value until the next key. The default for anything
  // that reads as a state change rather than a movement.
  hold:   () => 0,
  linear: (u) => u,
  // Smoothstep. Reads as "eased" to an author without needing bezier handles,
  // which would be a much larger UI for a small gain here.
  ease:   (u) => u * u * (3 - 2 * u),
  in:     (u) => u * u,
  out:    (u) => u * (2 - u),
};

export const EASE_NAMES = Object.keys(EASES);
export const DEFAULT_EASE = 'linear';

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
/** A name this module actually defines a curve for — inherited names are not. */
const isEase = (e) => typeof e === 'string' && Object.prototype.hasOwnProperty.call(EASES, e);

/** A key, cleaned. Returns null for anything unusable. */
export function makeKey(t, v, e = DEFAULT_EASE) {
  // Number(null) and Number('') are both 0, so a missing value in a
  // hand-edited or older project file would silently become a real key at
  // zero rather than being rejected. Check before coercing.
  if (t == null || t === '' || v == null || v === '') return null;
  const tt = Number(t), vv = Number(v);
  if (!isNum(tt) || !isNum(vv)) return null;
  /* hasOwnProperty, not a truthiness test on EASES[e]. Every member of
     Object.prototype is truthy, so `e: "toString"` was accepted as a valid
     easing name and written into the document — and evalTrack then called
     Object.prototype.toString as the curve, which returns a string, which makes
     the interpolation NaN. A NaN reaches the renderer as a parameter. */
  return { t: Math.max(0, tt), v: vv, e: isEase(e) ? e : DEFAULT_EASE };
}

/**
 * Sorted, de-duplicated keys. Two keys at the same time is ambiguous, so the
 * later write wins — that is what makes "add a key where one already is"
 * behave as replace, which is what an author means by it.
 */
export function normalizeTrack(track) {
  if (!Array.isArray(track)) return [];
  const byTime = new Map();
  for (const k of track) {
    const key = makeKey(k?.t, k?.v, k?.e);
    if (key) byTime.set(Math.round(key.t * 1000), key);   // ms resolution
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

/**
 * Value of a track at time t.
 * @returns {number|undefined} undefined when the track has no keys, meaning
 *          "not automated" — the caller keeps the control's own value.
 */
export function evalTrack(track, t) {
  const keys = Array.isArray(track) ? track : [];
  if (!keys.length) return undefined;

  /* Skip anything that is not a usable {t,v} pair rather than reading through
     it. normalizeTrack already drops these, and both places a track enters the
     program run it — schema.js for the document's own tracks, timeline.js for
     the copy captured into a clip recipe. But evalTrack is a public entry point
     called once per automated parameter per FRAME, so a track that reached it
     un-normalised (a hand-edited project, a truncated download, a bad merge)
     would take the render loop down on frame one instead of degrading to the
     control's own value. Validated in place: no allocation on the ordinary
     path, which is the reason this function is shaped the way it is. */
  const usable = (k) => k != null && isNum(k.t) && isNum(k.v);

  let lo = 0;
  while (lo < keys.length && !usable(keys[lo])) lo++;
  if (lo >= keys.length) return undefined;            // nothing usable: unautomated
  let hi = keys.length - 1;
  while (hi > lo && !usable(keys[hi])) hi--;
  if (hi === lo) return keys[lo].v;

  // An unusable time reads as the start of the track rather than propagating a
  // NaN into the cfg field, where clamp() would carry it straight through into
  // the picture.
  if (!isNum(t)) return keys[lo].v;

  // Held flat outside the keyed range rather than extrapolated: extrapolation
  // would send a percentage past 100 before the first key and surprise nobody
  // pleasantly.
  if (t <= keys[lo].t) return keys[lo].v;
  if (t >= keys[hi].t) return keys[hi].v;

  // The last usable key at or before t, and the first usable one after it.
  let i = lo; let j = -1;
  for (let k = lo + 1; k <= hi; k++) {
    if (!usable(keys[k])) continue;
    if (keys[k].t <= t) i = k; else { j = k; break; }
  }
  if (j < 0) return keys[i].v;
  const a = keys[i], b = keys[j];
  const span = b.t - a.t;
  if (span <= 0) return b.v;
  const u = (t - a.t) / span;
  const f = (isEase(a.e) ? EASES[a.e] : null) || EASES[DEFAULT_EASE];
  return a.v + (b.v - a.v) * f(u);
}

/** Add or replace a key, returning a new normalized track. */
export function addKey(track, t, v, e = DEFAULT_EASE) {
  const key = makeKey(t, v, e);
  if (!key) return normalizeTrack(track);
  return normalizeTrack([...(Array.isArray(track) ? track : []), key]);
}

/** Drop the key at (or nearest within 1ms of) time t. */
export function removeKey(track, t) {
  const ms = Math.round(Number(t) * 1000);
  return normalizeTrack(track).filter((k) => Math.round(k.t * 1000) !== ms);
}

/** True when any track in the map has at least one key. */
export function hasKeys(tracks) {
  if (!tracks) return false;
  for (const id of Object.keys(tracks)) {
    if (Array.isArray(tracks[id]) && tracks[id].length) return true;
  }
  return false;
}

/** Every track normalized, and empty tracks dropped. */
export function normalizeTracks(tracks) {
  const out = {};
  if (!tracks || typeof tracks !== 'object') return out;
  for (const id of Object.keys(tracks)) {
    // Object.keys skips the prototype, but an id arriving from a project file
    // still must not be one of these — setPath would walk into Object.prototype.
    if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue;
    const t = normalizeTrack(tracks[id]);
    if (t.length) out[id] = t;
  }
  return out;
}
