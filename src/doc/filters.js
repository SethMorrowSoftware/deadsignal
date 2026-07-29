/* Dead Signal Studio — doc/filters.js
 *
 * The stored shape of a filter chain. Pure: no registry, no DOM, no store.
 *
 * Like doc/layers.js, validation deliberately does NOT check that a filter
 * exists. A project written by a build that had a filter this one does not
 * must survive the round trip — dropping the entry would silently discard the
 * author's work, and the renderer already skips an id it cannot find. Keeping
 * it means the step comes back the moment the project is opened somewhere
 * that has it.
 *
 * Parameters are likewise kept as authored rather than clamped here: the
 * registry owns the ranges (resolveParams), and clamping in two places means
 * two places to disagree. What this file does enforce is structural — the
 * things that would corrupt the document rather than merely look wrong.
 */

/** Past this a frame costs more to filter than the extra step is worth. */
export const MAX_FILTERS = 8;
/** Guard against a hostile or corrupt project stuffing the params bag. */
const MAX_PARAM_KEYS = 24;
const PROTO = new Set(['__proto__', 'constructor', 'prototype']);

/** Only own, non-proto keys with primitive values survive. */
function cleanParams(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  for (const k of Object.keys(raw)) {
    if (PROTO.has(k)) continue;                    // never let a params bag reach Object.prototype
    if (n >= MAX_PARAM_KEYS) break;
    const v = raw[k];
    const ty = typeof v;
    if (ty !== 'number' && ty !== 'string' && ty !== 'boolean') continue;
    if (ty === 'number' && !Number.isFinite(v)) continue;
    out[k] = ty === 'string' ? v.slice(0, 200) : v;
    n++;
  }
  return out;
}

export function makeFilter(f) {
  const id = typeof f?.id === 'string' && f.id ? f.id.slice(0, 64) : '';
  return { id, params: cleanParams(f?.params), enabled: f?.enabled !== false };
}

export function normalizeFilters(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_FILTERS).map(makeFilter).filter((f) => f.id);
}

/** True when at least one step would actually run. */
export function hasActiveFilters(list) {
  return Array.isArray(list) && list.some((f) => f && f.id && f.enabled !== false);
}

/**
 * Rescale a chain's pixel-denominated parameters by `factor`.
 *
 * WHY THIS EXISTS
 *
 * Thirty-two parameters in the registry are measured in absolute pixels — grain
 * size, blur radius, slit-scan displacement, the length of a pixel-sort run.
 * That is the right unit to TYPE (an author says "two-pixel grain" and means
 * it), and the wrong unit to KEEP when the delivery size changes underneath
 * them: a look tuned at 320x240 and switched to 1920x1080 renders at a sixth of
 * the relative strength. Nothing breaks; it simply stops being the same look,
 * and the author is left wondering where their grain went.
 *
 * So the size picker carries them. Changing the format is the one moment the
 * tool knows the frame is being deliberately re-scaled, and it is the only
 * moment this runs — no saved project is rewritten, no render already approved
 * changes, and an author who never touches the format never sees it happen.
 *
 * `specsOf` is injected rather than imported. This module is pure and the
 * parameter ranges live in the filter registry; importing that here would drag
 * the whole renderer into the headless suite, and duplicating the ranges would
 * mean two places to disagree about them.
 *
 * Returns null when nothing moved, which is the same contract patchFor has: a
 * caller can hand the result straight to the store and trust that a value means
 * a real change rather than an empty undo entry.
 */
export function scaleFilterPx(list, factor, specsOf) {
  if (!Array.isArray(list) || !list.length) return null;
  if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 1e-6) return null;
  let any = false;
  const out = list.map((f) => {
    const specs = (typeof specsOf === 'function' ? specsOf(f?.id) : null) || [];
    const params = { ...(f?.params || {}) };
    let touched = false;
    for (const s of specs) {
      if (!s || !s.px) continue;
      const cur = Number(params[s.key]);
      /* An unset parameter is the DEFAULT, not zero — and the default is as
         much a pixel measurement as a typed one, so it scales too. Writing it
         out explicitly is the point: after this the chain says what it means at
         the new size rather than inheriting a value meant for the old one. */
      const from = Number.isFinite(cur) ? cur : Number(s.def);
      if (!Number.isFinite(from)) continue;
      const step = Number(s.step) > 0 ? Number(s.step) : 1;
      const lo = Number.isFinite(Number(s.min)) ? Number(s.min) : -Infinity;
      const hi = Number.isFinite(Number(s.max)) ? Number(s.max) : Infinity;
      // Snapped to the control's own step, so the number that lands in the box
      // is one the box can actually show and the author can nudge from.
      const next = Math.min(hi, Math.max(lo, Math.round((from * factor) / step) * step));
      const rounded = Math.round(next * 1000) / 1000;
      if (rounded !== from) { params[s.key] = rounded; touched = true; }
    }
    if (!touched) return f;
    any = true;
    return { ...f, params };
  });
  return any ? out : null;
}
