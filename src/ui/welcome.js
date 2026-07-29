/* Dead Signal Studio — ui/welcome.js
 *
 * What the studio says the first time you open it.
 *
 * The tool has 152 controls, seven tabs and no obvious entry point, which is a
 * poor first thirty seconds. This is not a tour or a slideshow — it is one
 * card that names the three-step loop and offers a working project to start
 * from, then gets out of the way and does not come back.
 *
 * It is re-openable from HELP and the command palette, so dismissing it is
 * never a decision an author has to think about.
 */
import { $, log, toast } from '../core/dom.js';
import { docIsDefault, lsGet, lsSet, stashPreviousProject } from '../core/recipes.js';
import { getStore } from '../doc/session.js';
import { SAMPLE_NAME, sampleProject } from '../onboarding/sample.js';

const SEEN_KEY = 'deadsignal.studio.welcomed';

export const hasBeenWelcomed = () => !!lsGet(SEEN_KEY, false);
export const markWelcomed = () => lsSet(SEEN_KEY, true);

let _onLoaded = null;

/** Replace the live document with the sample. */
export function loadSample() {
  const st = getStore();
  if (!st) { toast('Sample needs a project session', 'err'); return false; }
  // Re-reachable mid-project from the palette and HELP, and replace() clears
  // the undo history — so a document with real work in it gets one question
  // first (the CLOUD version restore already sets this precedent), and the
  // outgoing project is stashed either way. A pristine first run stays one
  // frictionless click.
  if (!docIsDefault(st) && typeof confirm === 'function'
      && !confirm('Load the sample project? It replaces the current document — a copy of the outgoing project is kept.')) {
    return false;
  }
  stashPreviousProject(st);
  st.replace(sampleProject(st.doc));
  markWelcomed();
  closeWelcome();
  _onLoaded?.();
  toast('Sample project loaded');
  log(`Loaded "${SAMPLE_NAME}" — keyframed decay, a digital-rain layer, a stereo bed. Press ● RECORD.`, 'ok');
  return true;
}

export function isWelcomeOpen() {
  const el = $('welcome');
  return !!el && el.style.display !== 'none';
}

/* The card is declared aria-modal="true", which tells a screen reader that
   everything behind it is inert. Nothing enforced that: Tab walked straight out
   of the card into 152 controls the reader had just been told were unavailable,
   with no way back. Either the claim goes or the behaviour does — and the
   behaviour is what an author actually wants from a modal, so this cycles focus
   inside the card and inerts the page behind it. */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function trapTab(e) {
  if (e.key !== 'Tab') return;
  const el = $('welcome');
  if (!el) return;
  const items = [...el.querySelectorAll(FOCUSABLE)].filter((n) => !n.disabled && n.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/** Hide the rest of the page from assistive tech while the card is up. */
function setBackgroundInert(on) {
  for (const id of ['main-content', 'tabs', 'toasts']) {
    const n = $(id) || document.querySelector('header.top');
    if (!n) continue;
    if (on) n.setAttribute('aria-hidden', 'true'); else n.removeAttribute('aria-hidden');
  }
  const head = document.querySelector('header.top');
  if (head) { if (on) head.setAttribute('aria-hidden', 'true'); else head.removeAttribute('aria-hidden'); }
}

/* Where focus was before the card went up. Hiding the card with display:none
   while one of its own buttons has focus leaves focus on <body>, so the next
   Tab starts from the top of the page instead of from whatever opened it —
   which, reopened from HELP mid-project, is a long way from where the author
   was working. */
let _lastFocus = null;

export function openWelcome() {
  const el = $('welcome');
  if (!el) return;
  const opener = document.activeElement;
  _lastFocus = opener && opener !== document.body && !el.contains(opener) ? opener : null;
  el.style.display = '';
  setBackgroundInert(true);
  document.addEventListener('keydown', trapTab, true);
  // Focus the primary action so the keyboard path is the same as the mouse one
  // — on a true first run, where the document is empty and the sample is the
  // right next step. Reopened from HELP or the palette the author is
  // mid-project, and Enter must not land on the one button that replaces the
  // document.
  if (hasBeenWelcomed()) $('welcome-close')?.focus();
  else $('welcome-sample')?.focus();
}

export function closeWelcome() {
  const el = $('welcome');
  if (!el) return;
  el.style.display = 'none';
  setBackgroundInert(false);
  document.removeEventListener('keydown', trapTab, true);
  markWelcomed();
  if (_lastFocus && document.contains(_lastFocus)) {
    try { _lastFocus.focus({ preventScroll: true }); } catch { _lastFocus.focus(); }
  }
  _lastFocus = null;
}

export function initWelcome(onLoaded) {
  const el = $('welcome');
  if (!el) return;
  _onLoaded = onLoaded;

  $('welcome-sample')?.addEventListener('click', loadSample);
  $('welcome-close')?.addEventListener('click', () => { closeWelcome(); toast('You can reopen this from HELP'); });
  $('help-welcome')?.addEventListener('click', openWelcome);

  // Escape closes it, like every other overlay here.
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeWelcome(); } });

  // Shown only on a genuinely cold start. A returning author with a restored
  // session is mid-project, and interrupting that would be worse than useless.
  if (hasBeenWelcomed()) closeWelcome();
  else openWelcome();
}
