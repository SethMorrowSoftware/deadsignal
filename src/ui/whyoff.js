/* Dead Signal Studio — ui/whyoff.js
 *
 * A greyed-out button that says nothing is the tool refusing without giving a
 * reason. Measured on a stock build: eight buttons are disabled the moment the
 * page opens, and not one of them carries a title, an aria-description or
 * anything else naming the thing that would switch it on. The worst of them is
 * the Audio panel — ▶ PLAY, ⤓ .wav and NORMALIZE are all dead until ◆ RENDER
 * has been pressed once, and nothing on screen connects the four.
 *
 * This is not a state machine; the panels already own their own enable/disable
 * logic and that is where it belongs. All this does is keep the TOOLTIP honest:
 * while a button is off it explains what turns it on, and when it comes back on
 * it goes back to describing what it does. One observer on the `disabled`
 * attribute, which changes a handful of times per session.
 *
 * Note on reach: a `disabled` button is out of the tab order entirely, so a
 * keyboard-only reader never lands on it and never hears either title. Moving
 * these to aria-disabled would fix that and is a larger change — every handler
 * would have to refuse for itself. Recorded in docs/AUDIT.md rather than done
 * here.
 */

/* id → [what it does when it is on, what would turn it on]. The second string
   is the one this file exists for; the first is only here so switching back is
   not a silent loss of the tooltip the markup would otherwise have carried. */
const REASONS = {
  /* Video */
  'v-stop':        ['Stop the recording that is running',
                    'Nothing is being recorded — this stops a render once one is under way.'],
  /* Audio: the panel where this matters most. */
  'a-play':        ['Play the rendered sound',
                    'No sound has been rendered yet — press ◆ RENDER first.'],
  'a-dl':          ['Download the rendered sound as a .wav',
                    'No sound has been rendered yet — press ◆ RENDER first.'],
  'a-norm':        ['Raise the level so the loudest peak just reaches full scale',
                    'No sound has been rendered yet — press ◆ RENDER first.'],
  'a-region-add':  ['Apply these settings to the selected span',
                    'No span is selected — drag across the waveform to choose one.'],
  /* Sequence */
  'tl-stop':       ['Stop the sequence recording that is running',
                    'Nothing is being recorded — this stops a sequence render once one is under way.'],
  /* Batch */
  'bx-stop':       ['Stop the batch that is running',
                    'No batch is running — this stops one once it has started.'],
};

let observer = null;

/** Put the right tooltip on one button for its current state. */
function paint(el) {
  const pair = REASONS[el.id];
  if (!pair) return;
  const [doesWhat, whyOff] = pair;
  const off = el.disabled || el.getAttribute('aria-disabled') === 'true';
  const want = off ? whyOff : doesWhat;
  if (el.getAttribute('title') !== want) el.setAttribute('title', want);
}

/**
 * Start keeping the tooltips in sync. Idempotent: calling it twice replaces the
 * observer rather than stacking two. Returns a stop function.
 */
export function initWhyOff() {
  stopWhyOff();
  const ids = Object.keys(REASONS);
  const paintAll = () => { for (const id of ids) { const el = document.getElementById(id); if (el) paint(el); } };
  paintAll();
  if (typeof MutationObserver !== 'function') return stopWhyOff;
  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.target instanceof Element && REASONS[r.target.id]) paint(r.target);
    }
  });
  observer.observe(document.body, {
    subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled'],
  });
  return stopWhyOff;
}

export function stopWhyOff() {
  observer?.disconnect();
  observer = null;
}

/** The ids this file speaks for, so a test can ask without re-deriving them. */
export const explainedIds = Object.keys(REASONS);
