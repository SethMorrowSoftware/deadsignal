/* Dead Signal Studio — ui/videosrc.js
 *
 * The footage picker: which imported clip the Video In scene plays.
 *
 * It is a real, document-bound control (`#v-srckey`) rather than a hidden
 * field, for one reason: a recipe is a snapshot of the bound controls, so
 * being a control is what makes a clip carry its own footage. It also happens
 * to be the honest UI — "which file is this clip" is a thing an author wants to
 * see and change.
 *
 * Modelled on ui/audiobed.js: the same "a stored choice whose asset has not
 * come back yet is kept as an option" rule, because dropping it would silently
 * re-point a clip at whatever happened to be first in the list.
 */
import { $, val } from '../core/dom.js';
import { library, onLibraryChange } from '../library/library.js';

export const FOOTAGE_NONE = '';

/** Library rows that are footage with bytes to play. */
export function footageCandidates() {
  return library.filter((it) => it.kind === 'videos' && it.blob && it.key);
}

/** Refill the picker, keeping the current choice selected. */
export function fillFootageSelect() {
  const sel = $('v-srckey');
  if (!sel) return 0;
  const current = val('v-srckey');
  const opts = [{ v: FOOTAGE_NONE, t: '— the last file you loaded —' }];
  for (const it of footageCandidates()) opts.push({ v: `lib:${it.key}`, t: `${it.name}.${it.ext}` });
  if (current && !opts.some((o) => o.v === current)) opts.push({ v: current, t: 'saved (not loaded)' });

  sel.replaceChildren();
  for (const o of opts) {
    const el = document.createElement('option');
    el.value = o.v;   /* dom-only: an <option>'s value is markup, not a control the document binds */
    el.textContent = o.t;
    if (o.v === current) el.selected = true;
    sel.appendChild(el);
  }
  return opts.length;
}

export function initFootageSelect() {
  fillFootageSelect();
  onLibraryChange(fillFootageSelect);
}
