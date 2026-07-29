/* Dead Signal Studio — ui/solo.js
 *
 * The solo buttons, and the banner that stops you exporting a soloed mix.
 *
 * There are twenty-six soloable sources and only one of them would need its
 * markup written by hand — the other sixteen are generated at boot from the
 * layer registry. So none of them are written by hand. Every source declares
 * the id of its enable checkbox (audio/solo.js), and mounting walks that list
 * and slips a button in beside each one. A twenty-seventh layer gets a solo
 * button for free, in the same commit that adds the layer, without touching
 * this file or index.html.
 *
 * ORDER MATTERS: mount after buildAudioLayerControls(), because half the
 * checkboxes do not exist until it has run. boot.js does them adjacently and
 * says so.
 *
 * The button is a <button>, not a checkbox, and deliberately so. It is not part
 * of the arrangement — it does not save an intent, it does not belong in the
 * fieldset's own reset, and it must not be picked up by the document binding
 * that mirrors every input on the tab. Solo lives at `audio.solo` in the
 * document and is written only through here.
 */
import { $, escHtml, toast } from '../core/dom.js';
import { SOLO_PATH, SOLO_SOURCES, normalizeSolo, soloSource, toggleSoloKey } from '../audio/solo.js';
import { getStore } from '../doc/session.js';
import { set } from '../doc/store.js';

let _onChange = null;

export function soloSet() {
  const st = getStore();
  return normalizeSolo(st ? st.get(SOLO_PATH) : []);
}

function writeSolo(list, label) {
  const st = getStore();
  if (!st) return false;
  st.apply(set(SOLO_PATH, normalizeSolo(list), { label }));
  return true;
}

/* ---------------------------------------------------------------- mount --- */

/**
 * Put a solo button next to every source's enable checkbox.
 *
 * Idempotent: a source that already has one is skipped, so a second call after
 * the layer controls are regenerated tops up the new fieldsets instead of
 * doubling the old ones.
 */
export function mountSoloButtons() {
  let made = 0;
  for (const src of SOLO_SOURCES) {
    const box = $(src.toggle);
    const row = box?.closest?.('.row');
    if (!row || row.querySelector('button[data-solo]')) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'solo-btn';
    b.dataset.solo = src.key;
    b.textContent = 'S';
    b.setAttribute('aria-pressed', 'false');
    // The name, not just "S" — a screen reader reading twenty-six buttons all
    // called S is a list of nothing.
    b.setAttribute('aria-label', `Solo ${src.name}`);
    b.title = `Solo ${src.name} — mute everything else`;
    b.addEventListener('click', () => toggleSolo(src.key));
    row.appendChild(b);
    made++;
  }
  renderSolo();
  return made;
}

/* --------------------------------------------------------------- state --- */

/** Flip one source in or out of the solo set. */
export function toggleSolo(key) {
  if (!soloSource(key)) return false;
  const next = toggleSoloKey(soloSet(), key);
  if (!writeSolo(next, next.length ? 'solo' : 'clear solo')) return false;
  renderSolo();
  _onChange?.();
  return true;
}

/** Back to the full mix. The arrangement is untouched — it always was. */
export function clearSolo() {
  if (!soloSet().length) return false;
  if (!writeSolo([], 'clear solo')) return false;
  renderSolo();
  _onChange?.();
  toast('Solo cleared');
  return true;
}

/* -------------------------------------------------------------- render --- */

/** Repaint the buttons and the banner from the document. */
export function renderSolo() {
  const on = new Set(soloSet());
  document.querySelectorAll('button[data-solo]').forEach((b) => {
    const active = on.has(b.dataset.solo);
    b.classList.toggle('on', active);
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  /* The fieldset gets the class too, so a soloed layer is findable by scrolling
     rather than by hunting for one lit button among twenty-six. */
  for (const src of SOLO_SOURCES) {
    const fs = $(src.toggle)?.closest?.('fieldset');
    if (fs) fs.classList.toggle('soloed', on.has(src.key));
  }

  const banner = $('a-solo-banner');
  if (!banner) return;
  if (!on.size) { banner.style.display = 'none'; banner.replaceChildren(); return; }
  const names = [...on].map((k) => soloSource(k)?.name || k);
  banner.style.display = '';
  banner.innerHTML = `<span>SOLO — only ${escHtml(names.join(', '))} will render`
    + ` <em>or export</em>.</span> <button type="button" class="btn small" id="a-solo-clear">clear solo</button>`;
  banner.querySelector('#a-solo-clear')?.addEventListener('click', clearSolo);
}

export function initSolo(onChange) {
  _onChange = onChange;
  mountSoloButtons();
}

/** Panel hints, in the shape ui/params.js uses. */
export function soloParamHints() {
  return {
    'a-solo-banner': ['Solo', 2,
      'Shown whenever anything is soloed. Solo is a mask, not an edit: the enable '
      + 'checkboxes keep whatever you set them to, and clearing solo brings the whole '
      + 'mix back exactly as it was. It does apply to EXPORT, because here the render '
      + 'is the export — which is why this banner exists.'],
  };
}
