/* Dead Signal Studio — doc/regions.js
 *
 * Region edits on a rendered audio buffer. Pure: no DOM, no store, no engine.
 *
 * The waveform was a readout. You could see that the third second was too loud
 * or that the tail ran on, and the only thing you could do about it was change
 * a synthesis parameter and render again — which changes the whole clip, not
 * the part you were looking at.
 *
 * An edit is `{ op, from, to, amount }` over a time range, and the list of them
 * lives in the DOCUMENT rather than being applied once to a buffer. That is the
 * difference between an editor and a destructive button: the edits travel in
 * the project, they undo, and every render replays them, so the same project
 * always produces the same wave.
 *
 * ------------------------------------------------------------------ order --
 *
 * Edits apply IN ORDER, and each one's times refer to the buffer as it is at
 * that moment — not to the original render. That matters only for `keep`, which
 * is the one op that changes the length: crop first and everything after it is
 * addressed in the cropped timeline.
 *
 * This is the behaviour an author actually sees, because the waveform they are
 * dragging on is the edited one. The alternative — every time referring to the
 * original — would mean the selection you dragged and the region that changed
 * were in different coordinate systems the moment a crop existed.
 */

/** Past this the list is not an edit any more, it is a program. */
export const MAX_REGIONS = 32;

export const REGION_OPS = [
  { id: 'silence', label: 'Silence', hint: 'Zero the selection.' },
  { id: 'fadein', label: 'Fade in', hint: 'Ramp from silence to full across the selection.' },
  { id: 'fadeout', label: 'Fade out', hint: 'Ramp from full to silence across the selection.' },
  { id: 'gain', label: 'Gain', hint: 'Scale the selection. 100% is unchanged; 0 is silence.', amount: true },
  { id: 'reverse', label: 'Reverse', hint: 'Play the selection backwards.' },
  { id: 'keep', label: 'Crop to', hint: 'Throw everything outside the selection away. Changes the length.' },
];
const OP_IDS = new Set(REGION_OPS.map((o) => o.id));

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const round3 = (n) => Math.round(n * 1000) / 1000;

export function makeRegion(r) {
  const from = Math.max(0, round3(num(r?.from, 0)));
  const to = Math.max(0, round3(num(r?.to, 0)));
  return {
    op: OP_IDS.has(r?.op) ? r.op : 'silence',
    // Backwards is not an edit, it is a drag that went the other way.
    from: Math.min(from, to),
    to: Math.max(from, to),
    // Percent, so 100 is unchanged. Only `gain` reads it; storing it on every
    // region keeps the shape uniform and costs one number.
    amount: Math.max(0, Math.min(400, num(r?.amount, 100))),
  };
}

export function normalizeRegions(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_REGIONS).map(makeRegion).filter((r) => r.to > r.from);
}

/** True when at least one edit would do something. */
export const hasRegions = (list) => Array.isArray(list) && list.length > 0;

/**
 * Apply the edit list to channel data.
 *
 * Returns NEW arrays rather than mutating: the caller keeps the un-edited
 * render so that removing an edit does not require re-synthesising. Length can
 * change — `keep` is a crop — so callers must read it back rather than assuming.
 *
 * @param {Float32Array[]} channels
 * @param {number} sr        sample rate
 * @param {Array}  regions   already normalised
 * @returns {Float32Array[]}
 */
export function applyRegions(channels, sr, regions) {
  if (!channels?.length || !hasRegions(regions)) return channels;
  let out = channels.map((d) => d.slice());

  for (const r of regions) {
    const len = out[0].length;
    // Clamped to what actually exists: an edit whose range is entirely past the
    // end of a cropped buffer is a no-op rather than an error.
    const a = Math.max(0, Math.min(len, Math.round(r.from * sr)));
    const b = Math.max(a, Math.min(len, Math.round(r.to * sr)));
    if (b <= a && r.op !== 'keep') continue;
    const n = b - a;

    switch (r.op) {
      case 'silence':
        for (const d of out) d.fill(0, a, b);
        break;
      case 'fadein':
        for (const d of out) for (let i = 0; i < n; i++) d[a + i] *= i / n;
        break;
      case 'fadeout':
        for (const d of out) for (let i = 0; i < n; i++) d[a + i] *= 1 - i / n;
        break;
      case 'gain': {
        const g = r.amount / 100;
        for (const d of out) for (let i = a; i < b; i++) d[i] *= g;
        break;
      }
      case 'reverse':
        for (const d of out) {
          for (let i = a, j = b - 1; i < j; i++, j--) { const t = d[i]; d[i] = d[j]; d[j] = t; }
        }
        break;
      case 'keep':
        // A crop to nothing would leave a zero-length buffer that every
        // downstream consumer would then have to defend against.
        if (n < 1) break;
        out = out.map((d) => d.slice(a, b));
        break;
      default:
        break;
    }
  }
  return out;
}

/** Seconds the edits leave behind, for the readout — without doing the work. */
export function editedSeconds(seconds, sr, regions) {
  let len = Math.round(seconds * sr);
  for (const r of normalizeRegions(regions)) {
    if (r.op !== 'keep') continue;
    const a = Math.max(0, Math.min(len, Math.round(r.from * sr)));
    const b = Math.max(a, Math.min(len, Math.round(r.to * sr)));
    if (b - a >= 1) len = b - a;
  }
  return len / sr;
}
