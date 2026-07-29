/* Dead Signal Studio — ui/keyframes.js
 *
 * The KEYFRAMES panel on the video tab.
 *
 * The workflow is the one every editor and DAW uses, because authors already
 * know it: scrub to a time, set the control where you want it, press KEY. Two
 * keys make a ramp. It needs no new mental model, and it means the existing
 * controls stay the way you enter values — no separate curve editor to learn.
 *
 * Keys are written through the document store as ordinary commands, so they
 * undo, autosave and travel in the project with everything else.
 */
import { $, clamp, escHtml, num, toast } from '../core/dom.js';
import { addKey, evalTrack, EASE_NAMES, removeKey } from '../doc/automation.js';
import { getStore } from '../doc/session.js';
import { set } from '../doc/store.js';
import { AUTOMATABLE, AUTOMATION_PATH, automatedIds, trackFor, videoTracks } from '../video/automation.js';
import { PARAMS } from './params.js';

const labelOf = (id) => PARAMS[id]?.label || id;
const unitOf = (id) => PARAMS[id]?.unit || '';

/** The parameter the panel is currently editing. */
export function selectedParam() {
  return $('v-auto-param')?.value || AUTOMATABLE[0].id;
}

/** Write a track back to the document. */
function writeTrack(id, keys) {
  const st = getStore();
  if (!st) return false;
  st.apply(set(`${AUTOMATION_PATH}.${id}`, keys));
  return true;
}

/**
 * Current preview time. The panel keys against what is on screen, so an author
 * lands on the frame they are looking at rather than a number typed twice.
 */
function currentTime() {
  const cfg = { duration: clamp(num('v-dur', 10), 1, 60) };
  const scrub = $('v-scrub');
  const frac = scrub ? (Number(scrub.value) || 0) / 1000 : 0;
  return Math.round(frac * cfg.duration * 100) / 100;
}

/** Populate the parameter picker, marking the ones that already have keys. */
export function rebuildParamSelect() {
  const sel = $('v-auto-param');
  if (!sel) return;
  const keep = sel.value;
  const automated = new Set(automatedIds());
  sel.replaceChildren();
  for (const p of AUTOMATABLE) {
    const o = document.createElement('option');
    o.value = p.id;
    const n = trackFor(p.id).length;
    o.textContent = (automated.has(p.id) ? '◆ ' : '') + labelOf(p.id) + (n ? ` (${n})` : '');
    sel.appendChild(o);
  }
  // Restoring the selection after rebuilding the options: `keep` is the value
  // already showing, so there is nothing to tell the document, and dispatching
  // would re-enter this rebuild.
  if (keep) sel.value = keep;   /* dom-only: re-selecting the value already set */
  if (!sel.value) sel.value = AUTOMATABLE[0].id;   /* dom-only: same */
}

/** The key list for the selected parameter. */
export function renderKeyList() {
  const box = $('v-auto-list');
  if (!box) return;
  const id = selectedParam();
  const keys = trackFor(id);
  box.replaceChildren();

  if (!keys.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = `${labelOf(id)} is not keyframed — it holds its current value for the whole clip.`;
    box.appendChild(p);
    return;
  }

  const unit = unitOf(id);
  const table = document.createElement('table');
  table.className = 'keyframes';
  table.innerHTML = '<thead><tr><th scope="col">Time</th><th scope="col">Value</th>'
    + '<th scope="col">Ease to next</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead>';
  const body = document.createElement('tbody');
  keys.forEach((k, i) => {
    const tr = document.createElement('tr');
    const last = i === keys.length - 1;
    tr.innerHTML = '<td>' + k.t.toFixed(2) + 's</td>'
      + '<td>' + escHtml(String(k.v)) + (unit ? ' ' + escHtml(unit) : '') + '</td>'
      // The last key has nothing to ease towards, so it gets a dash rather
      // than a control that cannot do anything.
      + '<td>' + (last ? '<span class="hint">—</span>'
          : '<select data-t="' + k.t + '" aria-label="Easing after ' + escHtml(k.t.toFixed(2)) + ' seconds">'
            + EASE_NAMES.map((e) => '<option' + (k.e === e ? ' selected' : '') + '>' + e + '</option>').join('')
            + '</select>') + '</td>'
      + '<td><button class="btn small" data-rm="' + k.t + '" aria-label="Remove key at '
      + escHtml(k.t.toFixed(2)) + ' seconds">✕</button></td>';
    body.appendChild(tr);
  });
  table.appendChild(body);
  box.appendChild(table);

  body.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-rm]');
    if (!btn) return;
    writeTrack(id, removeKey(trackFor(id), Number(btn.dataset.rm)));
    refreshKeyframes();
  });
  body.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-t]');
    if (!sel) return;
    const t = Number(sel.dataset.t);
    const key = trackFor(id).find((k) => k.t === t);
    if (!key) return;
    writeTrack(id, addKey(trackFor(id), t, key.v, sel.value));
    refreshKeyframes();
  });
}

/**
 * Mark automated controls in the settings panel.
 *
 * Without this the control shows one number while the picture shows another,
 * which reads as a bug. The marker says the control is now the base value and
 * the track is in charge.
 */
export function markAutomatedControls() {
  const automated = new Set(automatedIds());
  for (const p of AUTOMATABLE) {
    const el = $(p.id);
    if (!el) continue;
    const on = automated.has(p.id);
    el.classList.toggle('automated', on);
    const row = el.closest('.row');
    if (row) row.classList.toggle('automated', on);
    if (on) el.setAttribute('data-automated', 'true');
    else el.removeAttribute('data-automated');
  }
}

/** Redraw everything the panel owns. */
export function refreshKeyframes() {
  rebuildParamSelect();
  renderKeyList();
  markAutomatedControls();
}

/** Drop every track. Used by the tab's RESET. */
export function clearAllKeyframes() {
  const st = getStore();
  if (!st) return;
  st.apply(set(AUTOMATION_PATH, {}));
  refreshKeyframes();
}

export function initKeyframes(onChange) {
  if (!$('v-auto-param')) return;
  refreshKeyframes();

  $('v-auto-param').addEventListener('change', renderKeyList);

  $('v-auto-key').addEventListener('click', () => {
    const id = selectedParam();
    const el = $(id);
    if (!el) return;
    const st = getStore();
    if (!st) { toast('Keyframes need a project session', 'err'); return; }
    const t = currentTime();
    // The value keyed is the control's own, not the automated one — otherwise
    // adding a second key to an existing ramp would key whatever the curve
    // already says at that time and never change anything.
    writeTrack(id, addKey(trackFor(id), t, Number(el.value)));
    refreshKeyframes();
    toast(`${labelOf(id)} keyed at ${t.toFixed(2)}s`);
    onChange?.();
  });

  $('v-auto-clear').addEventListener('click', () => {
    const id = selectedParam();
    if (!trackFor(id).length) { toast('Nothing to clear'); return; }
    writeTrack(id, []);
    refreshKeyframes();
    toast(`${labelOf(id)} keyframes cleared`);
    onChange?.();
  });
}

/** Value the selected track holds at time t, for the readout. */
export function selectedValueAt(t) {
  return evalTrack(videoTracks()[selectedParam()], t);
}
