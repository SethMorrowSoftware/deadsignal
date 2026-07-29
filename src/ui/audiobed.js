/* Dead Signal Studio — ui/audiobed.js
 *
 * The bed picker on the VIDEO tab.
 *
 * Rebuilt whenever the library changes, because the whole point is to pick the
 * .wav you rendered a minute ago on the AUDIO tab, and a list that only knows
 * what existed at boot would never contain it.
 */
import { $, setVal, val } from '../core/dom.js';
import { BED_LAST, BED_NONE, LIB_PREFIX, bedCandidates } from '../audio/bed.js';
import { lastAudio } from '../audio/ui.js';
import { onLibraryChange } from '../library/library.js';

export const BED_SELECT = 'v-audio';
/* Every picker that offers a bed, so one library change refills all of them.
   VIDEO picks the sound for a clip and TIMELINE for a whole sequence; they are
   the same list of choices and must not drift into two implementations. */
const _selects = new Set();

/**
 * Refill the picker, keeping the current choice if it still exists.
 *
 * The value is document state, so it is restored from the project before the
 * options are built; an option is added for a stored choice that is not in the
 * list yet — otherwise opening a project would silently reset its bed to silent
 * before the assets finished coming back from the store.
 */
export function refreshBedOptions() {
  for (const id of _selects) fillOne(id);
}

function fillOne(selId) {
  const sel = $(selId);
  if (!sel) return;
  /* The DOCUMENT's value, not the select's.
   *
   * Opening a project sets the select to a bed whose option does not exist yet
   * — the library rows are still coming back out of the asset store — and a
   * <select> silently drops a value it has no option for. Reading the DOM here
   * would therefore see "" and write the loss back permanently: the project
   * remembered its sound and the picker quietly forgot it during boot. */
  const keep = val(selId);
  sel.replaceChildren();

  const add = (value, label) => {
    const o = document.createElement('option');
    o.value = value; o.textContent = label;
    sel.appendChild(o);
    return o;
  };
  add(BED_NONE, '— silent —');
  if (lastAudio && lastAudio.channels && lastAudio.channels.length) {
    add(BED_LAST, 'Last audio render · ' + (lastAudio.duration || 0).toFixed(1) + 's');
  }
  for (const it of bedCandidates()) {
    add(LIB_PREFIX + it.key, it.name + '.' + it.ext + ' · ' + (it.seconds || 0).toFixed(1) + 's');
  }

  if (keep && ![...sel.options].some((o) => o.value === keep)) {
    add(keep, (keep === BED_LAST ? 'Last audio render' : 'saved bed') + ' (not loaded)');
  }
  // Restoring the value the picker already had must not dispatch: the document
  // is where it came from, and echoing would stamp an undo entry per rebuild.
  if (keep) sel.value = keep;   /* dom-only: re-selecting the value already set */
}

/** Register a bed picker by control id and fill it. */
export function initBedSelect(selId) {
  if (!$(selId)) return;
  _selects.add(selId);
  fillOne(selId);
}

export function initAudioBed() {
  initBedSelect(BED_SELECT);
  // A render or an import changes what there is to choose from.
  onLibraryChange(refreshBedOptions);
}

/** Point a picker at a specific library asset. */
export function useBed(value, selId) {
  refreshBedOptions();
  setVal(selId || BED_SELECT, value);
}
