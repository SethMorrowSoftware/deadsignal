/* Dead Signal Studio — ui/modaltrap.js
 *
 * A focus trap shared by the modal overlays that declare aria-modal="true".
 *
 * welcome.js earned this the hard way: a dialog that TELLS a screen reader the
 * page behind it is inert, but lets Tab walk straight out into it, is worse than
 * one that never made the claim. The command palette and the preset manager make
 * the same aria-modal claim and had the same gap, so the enforcement lives here
 * once rather than three times. (welcome.js keeps its own copy — its behaviour is
 * pinned by the a11y suite and not worth disturbing.)
 */
import { $ } from '../core/dom.js';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Is any modal overlay on screen right now?
 *
 * Asked structurally — "is anything claiming aria-modal being rendered" —
 * rather than from a list of ids, so the fifth overlay is covered the day it is
 * written rather than the day someone remembers to add it here. Four claim it
 * today: the welcome card (index.html), the command palette, the preset
 * manager and the keyboard-shortcut sheet.
 *
 * `getClientRects().length` rather than a `hidden` or `style.display` test:
 * the four are closed in three different ways (`hidden`, `style.display`, a
 * class), and the question every caller is actually asking is whether the user
 * can see the thing.
 *
 * WHAT THIS IS FOR. Every bare-key shortcut in the studio has to be inert while
 * a modal is up, and the guard existed in exactly one of the two handlers that
 * need it. The other — the 1-8 / R / G handler in boot.js — had none, so on a
 * first run, with the welcome card still on screen and focus inside it,
 * pressing R rendered and exported a real file the user could not see, G
 * randomised the document behind the card, and 1-8 switched workspaces behind
 * it. Nothing on screen changed, which is what made it a bug rather than a
 * surprise.
 */
export function anyModalOpen() {
  for (const el of document.querySelectorAll('[aria-modal="true"]')) {
    if (el.getClientRects().length) return true;
  }
  return false;
}

/** Hide the rest of the page from assistive tech while a modal is up. */
export function setBackgroundInert(on) {
  const head = document.querySelector('header.top');
  for (const n of [head, $('main-content'), $('tabs'), $('toasts')]) {
    if (!n) continue;
    if (on) n.setAttribute('aria-hidden', 'true'); else n.removeAttribute('aria-hidden');
  }
}

/**
 * A trap for one modal. `getRoot` returns the element focus must stay inside.
 *
 * Returns { engage, release }: call engage() when the modal opens and release()
 * when it closes. Tab and Shift+Tab cycle within the root, focus that has
 * somehow escaped is pulled back to the first item, and the background is
 * inerted for the duration. Both calls are idempotent.
 */
export function modalTrap(getRoot) {
  let on = false;
  const onKey = (e) => {
    if (e.key !== 'Tab') return;
    const root = getRoot();
    if (!root) return;
    const items = [...root.querySelectorAll(FOCUSABLE)]
      .filter((n) => !n.disabled && n.offsetParent !== null);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    if (!root.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return {
    engage() { if (on) return; on = true; setBackgroundInert(true); document.addEventListener('keydown', onKey, true); },
    release() { if (!on) return; on = false; setBackgroundInert(false); document.removeEventListener('keydown', onKey, true); },
  };
}
