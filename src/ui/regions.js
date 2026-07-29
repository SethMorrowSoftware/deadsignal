/* Dead Signal Studio — ui/regions.js
 *
 * Drag a selection on the waveform; apply an edit to it.
 *
 * The selection itself is deliberately NOT document state. It is a cursor — an
 * author's finger on the wave — and putting it in the document would fill the
 * undo history with the act of looking at things. The EDITS are the state; the
 * selection is how you aim one.
 *
 * The overlay is drawn on top of the waveform canvas rather than into it, so
 * `drawWaveform()` stays a function of the audio alone and a selection change
 * costs one repaint of one absolutely-positioned div rather than a redraw of
 * the wave.
 */
import { $, escHtml, log, toast } from '../core/dom.js';
import { MAX_REGIONS, REGION_OPS, editedSeconds, makeRegion, normalizeRegions } from '../doc/regions.js';
import { getStore } from '../doc/session.js';
import { set } from '../doc/store.js';

export const REGIONS_PATH = 'audio.regions';

let _onChange = null;
/* Selection in SECONDS, against the currently displayed (already edited) wave —
   the same timeline the edits address, so what you drag is what changes. */
let _sel = null;
/** How long the displayed wave is, so pixels can become seconds. */
let _seconds = 0;

export const selection = () => _sel;

export function regions() {
  const st = getStore();
  return normalizeRegions(st ? st.get(REGIONS_PATH) : []);
}

function writeRegions(list, label) {
  const st = getStore();
  if (!st) return false;
  st.apply(set(REGIONS_PATH, normalizeRegions(list), { label }));
  return true;
}

/** Tell the panel how long the wave it is showing is. */
export function setRegionDuration(seconds) {
  _seconds = Math.max(0, seconds || 0);
  if (_sel && _sel.to > _seconds) _sel = null;      // a crop can strand a selection
  paintSelection();
  renderRegions();
}

/* ------------------------------------------------------------- overlay --- */

function paintSelection() {
  const box = $('a-selection');
  if (!box) return;
  if (!_sel || !_seconds) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  box.style.left = `${(_sel.from / _seconds) * 100}%`;
  box.style.width = `${Math.max(0.4, ((_sel.to - _sel.from) / _seconds) * 100)}%`;
  const out = $('a-selinfo');
  if (out) out.textContent = `${_sel.from.toFixed(2)}s – ${_sel.to.toFixed(2)}s  (${(_sel.to - _sel.from).toFixed(2)}s)`;
}

function wireCanvas() {
  const wrap = $('a-wavewrap');
  const canvas = $('acanvas');
  if (!wrap || !canvas) return;
  let dragging = false, anchor = 0;

  const secondsAt = (e) => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !_seconds) return 0;
    return Math.max(0, Math.min(_seconds, ((e.clientX - r.left) / r.width) * _seconds));
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (!_seconds) return;
    dragging = true;
    anchor = secondsAt(e);
    _sel = { from: anchor, to: anchor };
    try { canvas.setPointerCapture?.(e.pointerId); } catch { /* pointer already gone */ }
    paintSelection();
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const t = secondsAt(e);
    _sel = { from: Math.min(anchor, t), to: Math.max(anchor, t) };
    paintSelection();
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    // A click, not a drag: that is a deselect, which is the only way to get
    // back to "the whole thing" without a second control for it.
    if (_sel && _sel.to - _sel.from < 0.01) _sel = null;
    paintSelection();
    renderRegions();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

/* ---------------------------------------------------------------- list --- */

export function renderRegions() {
  const box = $('a-regions-list');
  if (!box) return;
  const list = regions();
  const tag = $('a-regions-count');
  if (tag) tag.textContent = list.length ? String(list.length) : '';

  const sel = $('a-region-op');
  // Applying needs something to apply to; saying so beats a dead button.
  const ready = !!_sel;
  if ($('a-region-add')) $('a-region-add').disabled = !ready;
  const hint = $('a-selinfo');
  if (hint && !_sel) hint.textContent = _seconds ? 'Drag on the wave to select a range.' : 'Render something first.';
  const amt = $('a-region-amount');
  if (amt && sel) {
    const op = REGION_OPS.find((o) => o.id === sel.value);
    amt.parentElement.style.display = op?.amount ? '' : 'none';
  }

  box.replaceChildren();
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'No edits — the wave is exactly what the synth rendered. '
      + 'Edits are part of the project: they undo, they save, and every render replays them.';
    box.appendChild(p);
    return;
  }
  list.forEach((r, i) => {
    const op = REGION_OPS.find((o) => o.id === r.op);
    const row = document.createElement('div');
    row.className = 'filter-row';
    row.innerHTML = '<div class="filter-head"><span class="filter-name">'
      + escHtml(`${i + 1}. ${op?.label || r.op} ${r.from.toFixed(2)}–${r.to.toFixed(2)}s`)
      + (op?.amount ? escHtml(` @ ${r.amount}%`) : '')
      + '</span><span class="filter-actions">'
      + `<button class="btn small" data-i="${i}" data-act="up"${i === 0 ? ' disabled' : ''} title="apply earlier">↑</button> `
      + `<button class="btn small" data-i="${i}" data-act="dn"${i === list.length - 1 ? ' disabled' : ''} title="apply later">↓</button> `
      + `<button class="btn small" data-i="${i}" data-act="rm" title="remove">✕</button>`
      + '</span></div>';
    box.appendChild(row);
  });
  box.querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.i, act = b.dataset.act;
    const next = regions();
    if (act === 'up' && i > 0) [next[i - 1], next[i]] = [next[i], next[i - 1]];
    else if (act === 'dn' && i < next.length - 1) [next[i + 1], next[i]] = [next[i], next[i + 1]];
    else if (act === 'rm') next.splice(i, 1);
    else return;
    if (writeRegions(next, 'audio edit')) { renderRegions(); _onChange?.(); }
  }));
}

/** Add the chosen op over the current selection. */
export function addRegion(op, from, to, amount) {
  const sel = from != null && to != null ? { from, to } : _sel;
  if (!sel) { toast('Drag a selection first', 'err'); return false; }
  const list = regions();
  if (list.length >= MAX_REGIONS) { toast(`${MAX_REGIONS} edits is the limit`, 'err'); return false; }
  const chosen = op || $('a-region-op')?.value || 'silence';
  const amt = amount != null ? amount : Number($('a-region-amount')?.value) || 100;
  list.push(makeRegion({ op: chosen, from: sel.from, to: sel.to, amount: amt }));
  if (!writeRegions(list, 'audio edit')) return false;
  renderRegions();
  _onChange?.();
  log(`Audio edit: ${chosen} ${sel.from.toFixed(2)}–${sel.to.toFixed(2)}s`, 'info');
  return true;
}

export function clearRegions() {
  if (writeRegions([], 'clear audio edits')) { renderRegions(); _onChange?.(); toast('Edits cleared'); }
}

/** Seconds left after the edits, for the readout. */
export const editedLength = (seconds, sr) => editedSeconds(seconds, sr, regions());

export function initRegions(onChange) {
  _onChange = onChange;
  const sel = $('a-region-op');
  if (sel) {
    sel.replaceChildren();
    for (const o of REGION_OPS) {
      const opt = document.createElement('option');
      opt.value = o.id; opt.textContent = o.label;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', renderRegions);
  }
  $('a-region-add')?.addEventListener('click', () => addRegion());
  $('a-regions-clear')?.addEventListener('click', clearRegions);
  wireCanvas();
  renderRegions();
}

/** Panel hints, in the shape ui/params.js uses. */
export function regionParamHints() {
  return {
    'a-region-op': ['Edit', 2,
      'What to do to the selected range. '
      + REGION_OPS.map((o) => `**${o.label}** — ${o.hint}`).join(' ')],
    'a-region-amount': ['Amount', 2,
      'For **Gain**: 100% leaves the selection alone, 0 silences it, 200 doubles it. Ignored by the other edits.', '%'],
    'a-region-add': ['Apply to selection', 2,
      'Adds the edit to the list. Edits are part of the project — they undo, they save, and every render replays them, so the same project always produces the same wave.'],
    'a-regions-clear': ['Clear edits', 2,
      'Removes every edit. The next render is exactly what the synth produced.'],
  };
}
