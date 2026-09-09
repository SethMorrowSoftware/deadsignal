/* Dead Signal Studio — ui/actionbar.js
 *
 * The stage action bar: the primary verbs on the bar, everything else one
 * click away.
 *
 * WHY THIS EXISTS
 *
 * The VIDEO stage carried ten buttons in a row under the picture — ● RECORD
 * .webm, ■ STOP, ⤓ .gif, ⤓ .apng, ⤓ .webp, ⤓ frames, ⌗ STILL, ⇪ IMG, ⇪ VID,
 * ✚ PRESET — which wrapped to two lines on a 794px column and, because every
 * one of those lines is a content-sized grid row paid before the picture's
 * `1fr`, took roughly 66px straight out of the monitor. Ten equally-weighted
 * buttons is also how a first-time user is told that no one of them is the
 * thing to press.
 *
 * So the bar keeps the verbs you reach for mid-preview and folds the rest
 * behind one ⋯ MORE. Nothing is removed and nothing moves house: the buttons
 * are the same nodes with the same ids, listeners and disabled-state wiring,
 * re-parented into a popover exactly the way enterEditor re-parents the header
 * settings. Every id keeps working — the palette, Explain mode, the whyoff
 * explainer and the suites all address these by id and cannot tell.
 *
 * The fold is declarative and lives at the one call site (boot.js), so what is
 * primary on each workspace is a single readable list rather than a decision
 * spread across markup.
 */
import { $ } from '../core/dom.js';

let _wiredDocument = false;

/** Close every open action-bar popover. */
export function closeActionMenus(except) {
  for (const pop of document.querySelectorAll('.btns-more[data-open]')) {
    if (pop === except) continue;
    pop.hidden = true;
    delete pop.dataset.open;
    const btn = pop.previousElementSibling;
    if (btn?.classList.contains('btns-more-btn')) btn.setAttribute('aria-expanded', 'false');
  }
}

/**
 * Fold `ids` out of the action bar that holds them, behind one ⋯ MORE button.
 *
 * @param {object} o
 * @param {string} o.bar   id of a control inside the `.btns` bar to fold — the
 *                         bar itself has no id in the markup, and asking for
 *                         one of its buttons is more robust than a positional
 *                         selector.
 * @param {string[]} o.ids controls to move into the popover, in the order they
 *                         should appear there.
 * @param {string} [o.label]
 * @param {string} [o.title]
 * @returns {boolean} whether anything was folded.
 */
export function foldActions({ bar, ids, label = '⋯ MORE', title }) {
  const anchor = $(bar);
  const strip = anchor?.closest('.btns');
  if (!strip) return false;
  /* Idempotent: boot may re-run this, and a second ⋯ MORE beside the first is
     precisely the kind of duplicate this module exists to remove. */
  if (strip.querySelector('.btns-more-btn')) return false;

  const found = ids.map((id) => $(id)).filter((el) => el && strip.contains(el));
  if (!found.length) return false;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn small btns-more-btn';
  btn.id = `${bar}-more`;
  btn.textContent = label;
  const name = title || `More exports and imports for this workspace: ${found.map((el) => el.textContent.trim()).filter(Boolean).join(', ')}`;
  btn.title = name;
  /* Name-from-content would make this button "⋯ MORE", which says nothing
     about what is inside it — and the popover is the only route to those
     controls once they are folded. */
  btn.setAttribute('aria-label', name);
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');

  const pop = document.createElement('div');
  pop.className = 'btns-more';
  pop.id = `${bar}-more-pop`;
  pop.hidden = true;
  pop.setAttribute('role', 'group');
  pop.setAttribute('aria-label', 'More actions');
  btn.setAttribute('aria-controls', pop.id);

  /* Inserted where the FIRST folded control was, so the primary buttons keep
     their order and ⋯ MORE lands where the overflow begins rather than at the
     end of a bar it is summarising. */
  strip.insertBefore(btn, found[0]);
  strip.insertBefore(pop, btn.nextSibling);
  for (const el of found) pop.appendChild(el);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !!pop.dataset.open;
    closeActionMenus();
    if (open) return;
    pop.hidden = false;
    pop.dataset.open = '1';
    btn.setAttribute('aria-expanded', 'true');
    /* Focus moves in, so the popover is operable from the keyboard the moment
       it opens rather than needing a Tab into a thing that just appeared. */
    pop.querySelector('button:not([disabled])')?.focus();
  });

  pop.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closeActionMenus();
    btn.focus();
  });

  if (!_wiredDocument) {
    _wiredDocument = true;
    /* One listener for every bar, matching the editor menus' own model: an
       outside click closes, and so does Escape from anywhere. */
    document.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('.btns-more')) return;
      closeActionMenus();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeActionMenus(); });
  }
  return true;
}
