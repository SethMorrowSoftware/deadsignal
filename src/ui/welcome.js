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
import { setBackgroundInert } from './modaltrap.js';
import { docIsDefault, lsGet, lsSet, stashPreviousProject } from '../core/recipes.js';
import { getStore } from '../doc/session.js';
import { SAMPLE_NAME, sampleProject } from '../onboarding/sample.js';

const SEEN_KEY = 'deadsignal.studio.welcomed';

/* Dismissal has to stick even where localStorage does not.
 *
 * The flag was write-only-to-storage and lsSet's failure was discarded, so in a
 * private window, under an enterprise policy, or on a full quota the card came
 * back on every load, START EMPTY never took, and nothing said why. The session
 * flag is the fallback: the card at least stays closed for as long as the tab
 * is open, which is the difference between a limitation and a card you cannot
 * get rid of. */
let _welcomedThisSession = false;
export const hasBeenWelcomed = () => _welcomedThisSession || !!lsGet(SEEN_KEY, false);
export const markWelcomed = () => { _welcomedThisSession = true; lsSet(SEEN_KEY, true); };

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
  /* Rendered, rather than "not display:none". The card is opened by clearing an
     inline style and could be hidden by any number of things above it; the
     question every caller means is whether the author can see it. */
  const el = $('welcome');
  return !!el && el.getClientRects().length > 0;
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

/* Hide the rest of the page from assistive tech while the card is up.
   The shared implementation, not a second copy: this file kept its own list of
   ids — with a `|| document.querySelector('header.top')` fallback that could
   never fire, since all three ids exist — and it drifted from modaltrap's the
   moment the editor chrome arrived. One list, one place to add the next pane. */

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

/**
 * The author closed the card.
 *
 * Every dismissal route lands here — the button, Escape, the backdrop — so the
 * "you can reopen this" hint is attached to CLOSING rather than to one of the
 * three ways of doing it. It used to fire only for the button, so an author who
 * pressed Escape (the way every other overlay here closes) permanently
 * dismissed the only onboarding surface and was told nothing at all.
 *
 * The copy names a control that exists: HELP is a workspace in the tab strip,
 * and the Help MENU now carries the card too, so "the HELP tab" is no longer
 * ambiguous between the two.
 */
function dismiss() {
  closeWelcome();
  toast('You can reopen this from the HELP tab, or Help ▸ Show the welcome card');
}

export function initWelcome(onLoaded) {
  const el = $('welcome');
  if (!el) return;
  _onLoaded = onLoaded;

  $('welcome-sample')?.addEventListener('click', loadSample);
  $('welcome-close')?.addEventListener('click', dismiss);
  $('help-welcome')?.addEventListener('click', openWelcome);

  // Escape closes it, like every other overlay here.
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); dismiss(); } });
  /* …and so does a click on the surround, which is the gesture the command
     palette and the preset manager both answer to. The first modal a new author
     meets was the only one in the tool that ignored it. */
  el.addEventListener('mousedown', (e) => { if (e.target === el) dismiss(); });

  // Shown only on a genuinely cold start. A returning author with a restored
  // session is mid-project, and interrupting that would be worse than useless.
  //
  // `el.style.display` rather than closeWelcome(): this branch is not a
  // dismissal, and routing it through the dismissal path is what forced the
  // "you can reopen this" hint onto one button instead of onto closing.
  if (hasBeenWelcomed()) { el.style.display = 'none'; markWelcomed(); }
  else openWelcome();
}
