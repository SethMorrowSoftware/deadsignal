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
