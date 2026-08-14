/* Dead Signal Studio — ui/fontpick.js
 *
 * The two tab font pickers, made library-aware.
 *
 * At boot they are filled with the six built-in stacks (core/text.js's
 * fillFontSelect, before the document is seeded — the invariant every select
 * obeys). This module adds what boot cannot know yet: the library's imported
 * faces, which arrive later — from rehydration, an import, an undo — and can
 * go away again. Modelled on ui/videosrc.js, including its rule that a stored
 * choice whose row has not come back is KEPT as an option rather than silently
 * re-pointed at Monospace.
 *
 * One extra duty videosrc.js does not have: the document can already hold a
 * `lib:` font when the options arrive (a project load writes the document
 * first; renderDocToDom refuses to blank a select on a value with no option;
 * the library notification lands after). So after refilling, each select is
 * re-synced FROM THE DOCUMENT — the authoritative side — rather than trusting
 * whatever the refusal left on screen.
 */
import { $ } from '../core/dom.js';
import { FONTS } from '../core/text.js';
import { docValue } from '../doc/session.js';
import { library, onLibraryChange } from '../library/library.js';
import { fontIdFor } from '../media/fonts.js';

const SELECTS = ['v-fontfam', 'i-fontfam'];

/** Library rows that are typefaces. Bytes may still be on their way. */
export const fontCandidates = () => library.filter((it) => it.kind === 'fonts' && it.key);

function fillOne(id) {
  const sel = $(id);
  if (!sel) return;
  /* The document is the value that matters; the DOM is only its view — and on
     a project load the view can be one refusal behind. */
  const doc = docValue(id);
  const current = doc !== undefined && doc !== null && doc !== '' ? String(doc) : sel.value;

  sel.replaceChildren();
  for (const [v, f] of Object.entries(FONTS)) {
    const o = document.createElement('option');
    o.value = v;   /* dom-only: an <option>'s value is markup, not a control the document binds */
    o.textContent = f.label;
    sel.appendChild(o);
  }
  const rows = fontCandidates();
  if (rows.length) {
    const og = document.createElement('optgroup');
    og.label = 'Your fonts';
    for (const it of rows) {
      const o = document.createElement('option');
      o.value = fontIdFor(it.key);
      o.textContent = it.name;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  if (current && ![...sel.options].some((o) => o.value === current)) {
    const o = document.createElement('option');
    o.value = current;
    o.textContent = 'saved (not loaded)';
    sel.appendChild(o);
  }
  sel.value = current;   /* dom-only: re-syncing the view to the document it refused earlier */
}

export function fillFontSelects() { SELECTS.forEach(fillOne); }

/** Call once at boot, after the session exists. */
export function initFontPickers() {
  fillFontSelects();
  onLibraryChange(fillFontSelects);
}
