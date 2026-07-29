/* Dead Signal Studio — ui/annotations.js
 *
 * Placing marks on a screen: the panel, and dragging on the canvas.
 *
 * The forty-six templates each bake their own layout, which is what makes them
 * one-click and also what made "put the caption here instead" impossible. This
 * is the one layer that is not baked.
 *
 * Two things worth knowing about how it is put together:
 *
 * SELECTION IS NOT DOCUMENT STATE. Which mark you have clicked is a cursor, the
 * same as the waveform selection on the AUDIO tab. Storing it would fill the
 * undo history with the act of looking at things, and a project loaded on
 * another machine would arrive with someone else's cursor in it.
 *
 * A DRAG IS ONE UNDO ENTRY, not one per pointermove. Every move commits — the
 * document stays authoritative the whole way through, so the preview follows
 * the pointer without a second copy of the position living in a local variable
 * — but they coalesce under one key, so ctrl-Z after dragging a caption across
 * the screen puts it back where it started rather than nudging it a pixel.
 */
import { $, escHtml, log, toast } from '../core/dom.js';
import { ANNOTATION_KINDS, MAX_ANNOTATIONS, MAX_TEXT, annotationKind, annotationLabel,
         makeAnnotation, moveAnnotation, normalizeAnnotations, resizeAnnotation }
  from '../doc/annotations.js';
import { hitAnnotation, onGrip } from '../image/annotate.js';
import { getStore } from '../doc/session.js';
import { set } from '../doc/store.js';

export const ANNOTATIONS_PATH = 'image.annotations';

let _onChange = null;
/** Index of the selected mark, or null. A cursor, not state. */
let _sel = null;
/** Where the last draw put everything, in canvas pixels. */
let _boxes = [];

export const selectedAnnotation = () => _sel;
/** Called by the renderer after every draw — it is the only thing that knows. */
export function setAnnotationBoxes(boxes) { _boxes = Array.isArray(boxes) ? boxes : []; }

export function annotations() {
  const st = getStore();
  return normalizeAnnotations(st ? st.get(ANNOTATIONS_PATH) : []);
}

/** The list captured into a timeline still's recipe. */
export const captureAnnotations = () => annotations();

function write(list, label, coalesceKey) {
  const st = getStore();
  if (!st) return false;
  st.apply(set(ANNOTATIONS_PATH, normalizeAnnotations(list), { label, coalesceKey }));
  return true;
}

/* ------------------------------------------------------------- editing --- */

export function addAnnotation(kind, init) {
  const list = annotations();
  if (list.length >= MAX_ANNOTATIONS) { toast(`${MAX_ANNOTATIONS} marks is the limit`, 'err'); return false; }
  const k = annotationKind(kind) ? kind : ($('i-anno-kind')?.value || 'text');
  const spec = annotationKind(k);
  /* Placed a little above centre rather than dead centre: most templates put
     something in the middle, and a new mark that lands invisibly on top of it
     reads as "the button did nothing". */
  const a = makeAnnotation({
    kind: k, x: spec.box ? 0.2 : 0.12, y: spec.box ? 0.3 : 0.34,
    text: spec.text ? (init?.text ?? ($('i-anno-text')?.value || 'NOTE')) : '',
    color: $('i-anno-color')?.value || '',
    ...init,
  });
  if (!write([...list, a], 'add mark')) return false;
  _sel = list.length;
  renderAnnotations(); _onChange?.();
  log(`Screen mark: ${spec.label.toLowerCase()}`, 'info');
  return true;
}

export function removeAnnotation(i) {
  const list = annotations();
  if (i < 0 || i >= list.length) return false;
  list.splice(i, 1);
  if (!write(list, 'remove mark')) return false;
  _sel = null;
  renderAnnotations(); _onChange?.();
  return true;
}

export function clearAnnotations() {
  if (!annotations().length) return false;
  if (!write([], 'clear marks')) return false;
  _sel = null;
  renderAnnotations(); _onChange?.();
  toast('Marks cleared');
  return true;
}

/** Patch one mark. `coalesceKey` merges a drag or a slider sweep into one undo. */
export function updateAnnotation(i, patch, label, coalesceKey) {
  const list = annotations();
  if (i < 0 || i >= list.length) return false;
  list[i] = makeAnnotation({ ...list[i], ...patch });
  if (!write(list, label || 'edit mark', coalesceKey)) return false;
  renderAnnotations(); _onChange?.();
  return true;
}

export function selectAnnotation(i) {
  _sel = (i == null || i < 0 || i >= annotations().length) ? null : i;
  renderAnnotations(); _onChange?.();
}

/* -------------------------------------------------------------- canvas --- */

function wireCanvas() {
  const cv = $('icanvas');
  if (!cv) return;
  let mode = null, startX = 0, startY = 0, base = null, index = -1;

  // Canvas pixels, not CSS pixels: the preview is scaled to fit the panel, and
  // the two only agree at 100%.
  const at = (e) => {
    const r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return { x: 0, y: 0, fx: 0, fy: 0 };
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    return { x: fx * cv.width, y: fy * cv.height, fx, fy };
  };

  cv.addEventListener('pointerdown', (e) => {
    const list = annotations();
    if (!list.length) return;
    const p = at(e);
    // The grip first: it sits on the corner of the box, so a hit test that
    // asked "inside?" first would never let you resize.
    if (_sel != null && onGrip(_boxes[_sel], p.x, p.y)) { mode = 'resize'; index = _sel; }
    else {
      const hit = hitAnnotation(_boxes, p.x, p.y);
      if (hit < 0) { if (_sel != null) selectAnnotation(null); return; }
      mode = 'move'; index = hit;
      if (_sel !== hit) selectAnnotation(hit);
    }
    base = annotations()[index];
    startX = p.fx; startY = p.fy;
    try { cv.setPointerCapture?.(e.pointerId); } catch { /* pointer already gone */ }
    e.preventDefault();
  });

  cv.addEventListener('pointermove', (e) => {
    if (!mode || !base) { updateCursor(e, cv, at); return; }
    const p = at(e);
    const dx = p.fx - startX, dy = p.fy - startY;
    // One coalesce key per gesture per mark, so two separate drags of the same
    // caption stay two undo steps.
    const key = `anno:${mode}:${index}`;
    if (mode === 'move') updateAnnotation(index, moveAnnotation(base, dx, dy), 'move mark', key);
    else updateAnnotation(index, resizeAnnotation(base, base.w + dx, base.h + dy), 'resize mark', key);
  });

  const end = () => { mode = null; base = null; index = -1; };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
}

/* A pointer that changes shape is the only hint that the canvas is draggable at
   all — nothing else on the screen says so. */
function updateCursor(e, cv, at) {
  if (!annotations().length) { cv.style.cursor = ''; return; }
  const p = at(e);
  if (_sel != null && onGrip(_boxes[_sel], p.x, p.y)) cv.style.cursor = 'nwse-resize';
  else cv.style.cursor = hitAnnotation(_boxes, p.x, p.y) >= 0 ? 'move' : '';
}

/* ---------------------------------------------------------------- list --- */

export function renderAnnotations() {
  const box = $('i-anno-list');
  if (!box) return;
  const list = annotations();
  const tag = $('i-anno-count');
  if (tag) tag.textContent = list.length ? String(list.length) : '';
  if (_sel != null && _sel >= list.length) _sel = null;

  // The text field is only meaningful for a kind that carries text.
  const kindSel = $('i-anno-kind');
  const textRow = $('i-anno-text')?.closest('.row');
  if (kindSel && textRow) textRow.style.display = annotationKind(kindSel.value)?.text ? '' : 'none';

  box.replaceChildren();
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Nothing placed. Templates bake their own layout — marks are the layer '
      + 'that does not, so a caption can go anywhere on any of them. Add one, then drag it '
      + 'on the preview.';
    box.appendChild(p);
    return;
  }

  list.forEach((a, i) => {
    const spec = annotationKind(a.kind) || ANNOTATION_KINDS[0];
    const row = document.createElement('div');
    row.className = 'filter-row' + (i === _sel ? ' sel' : '');
    row.innerHTML = '<div class="filter-head"><span class="filter-name">'
      + `<button class="btn small ghost" data-i="${i}" data-act="pick" aria-pressed="${i === _sel}"`
      + ` title="select it — then arrow keys nudge, Shift+arrow moves further, Alt+arrow resizes">`
      + `${escHtml(`${i + 1}. ${spec.label}`)}</button> `
      + escHtml(annotationLabel(a))
      + '</span><span class="filter-actions">'
      + `<button class="btn small" data-i="${i}" data-act="up"${i === 0 ? ' disabled' : ''} title="draw earlier (behind)">↑</button> `
      + `<button class="btn small" data-i="${i}" data-act="dn"${i === list.length - 1 ? ' disabled' : ''} title="draw later (in front)">↓</button> `
      + `<button class="btn small" data-i="${i}" data-act="rm" title="remove">✕</button>`
      + '</span></div>';
    if (i === _sel) {
      const body = document.createElement('div');
      body.className = 'filter-body';
      body.innerHTML = (spec.text
        ? `<div class="row"><label for="anno-t-${i}">Text</label>`
          + `<input type="text" id="anno-t-${i}" class="grow" maxlength="${MAX_TEXT}" value="${escHtml(a.text)}" data-i="${i}" data-f="text"></div>`
          + `<div class="split3"><div class="row"><label for="anno-s-${i}">Size</label>`
          + `<input type="range" id="anno-s-${i}" min="20" max="400" value="${a.size}" class="grow" data-i="${i}" data-f="size"></div>`
          + `<div class="row"><label for="anno-a-${i}">Align</label><select id="anno-a-${i}" class="grow" data-i="${i}" data-f="align">`
          + ['left', 'center', 'right'].map((v) => `<option value="${v}"${a.align === v ? ' selected' : ''}>${v}</option>`).join('')
          + '</select></div>'
        : `<div class="split3"><div class="row"><label for="anno-w-${i}">Weight</label>`
          + `<input type="range" id="anno-w-${i}" min="1" max="12" value="${a.weight}" class="grow" data-i="${i}" data-f="weight"></div>`
          + '<div class="row"><span class="hint">Drag the corner grip to size it.</span></div>')
        + `<div class="row"><label for="anno-c-${i}">Colour</label>`
        + `<input type="color" id="anno-c-${i}" value="${escHtml(a.color || '#39ff9e')}" data-i="${i}" data-f="color">`
        + `<button class="btn small" data-i="${i}" data-act="fg" title="follow the screen's foreground colour">auto</button></div></div>`;
      row.appendChild(body);
    }
    box.appendChild(row);
  });

  /* Arrow keys nudge the selected mark.
   *
   * Dragging on the preview was the ONLY way to position one, which makes the
   * entire point of the feature unreachable without a pointer — the list could
   * select, reorder and delete a mark but not put it anywhere. The keys are
   * bound to the row rather than the document so they cannot swallow arrow
   * presses meant for a slider or a select somewhere else on the tab.
   *
   * 1% a press, 5% with Shift, and Alt resizes the ones that have a box —
   * fine enough to line something up, coarse enough to cross the canvas. */
  box.querySelectorAll('.filter-row').forEach((row, i) => row.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    const list = annotations();
    const a = list[i];
    if (!a) return;
    e.preventDefault();
    if (e.altKey) updateAnnotation(i, resizeAnnotation(a, a.w + d[0] * step, a.h + d[1] * step),
      'resize mark', `anno:key:${i}`);
    else updateAnnotation(i, moveAnnotation(a, d[0] * step, d[1] * step), 'move mark', `anno:key:${i}`);
    // The row is rebuilt by the update, so focus has to be put back or the
    // second arrow press goes nowhere.
    $('i-anno-list')?.querySelectorAll('.filter-row')[i]
      ?.querySelector('button[data-act="pick"]')?.focus();
  }));

  box.querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.i, act = b.dataset.act;
    if (act === 'pick') { selectAnnotation(i === _sel ? null : i); return; }
    if (act === 'fg') { updateAnnotation(i, { color: '' }, 'mark colour'); return; }
    if (act === 'rm') { removeAnnotation(i); return; }
    const next = annotations();
    if (act === 'up' && i > 0) [next[i - 1], next[i]] = [next[i], next[i - 1]];
    else if (act === 'dn' && i < next.length - 1) [next[i + 1], next[i]] = [next[i], next[i + 1]];
    else return;
    // The selection follows the mark, not the slot — otherwise reordering
    // silently selects a different thing.
    _sel = act === 'up' ? i - 1 : i + 1;
    if (write(next, 'reorder marks')) { renderAnnotations(); _onChange?.(); }
  }));

  box.querySelectorAll('[data-f]').forEach((el) => {
    const i = +el.dataset.i, f = el.dataset.f;
    const apply = () => updateAnnotation(i, { [f]: el.type === 'range' ? +el.value : el.value },
      'mark ' + f, `anno:${f}:${i}`);
    el.addEventListener('input', apply);
    el.addEventListener('change', apply);
  });
}

export function initAnnotations(onChange) {
  _onChange = onChange;
  const sel = $('i-anno-kind');
  if (sel) {
    sel.replaceChildren();
    for (const k of ANNOTATION_KINDS) {
      const o = document.createElement('option');
      o.value = k.id; o.textContent = k.label;
      sel.appendChild(o);
    }
    sel.addEventListener('change', renderAnnotations);
  }
  $('i-anno-add')?.addEventListener('click', () => addAnnotation());
  $('i-anno-clear')?.addEventListener('click', clearAnnotations);
  wireCanvas();
  renderAnnotations();
}

/** Panel hints, in the shape ui/params.js uses. */
export function annotationParamHints() {
  return {
    'i-anno-list': ['Placed marks', 2,
      'Every mark on the screen, drawn bottom to top — ↑/↓ change which one is in front. '
      + 'Click a mark\u2019s name to select it, then the arrow keys nudge it 1% of the canvas, '
      + 'Shift+arrow 5%, and Alt+arrow resizes the ones that have a box. Dragging on the '
      + 'preview does the same thing with a pointer; neither is the only way in.'],
    'i-anno-kind': ['Mark', 2,
      'What to place: ' + ANNOTATION_KINDS.map((k) => k.label.toLowerCase()).join(', ')
      + '. Every one of them sits on top of whatever template is selected, so the same '
      + 'mark works on all forty-six.'],
    'i-anno-text': ['Mark text', 2,
      'The words for a text mark. Placed marks are positioned as a fraction of the canvas, '
      + 'so changing the screen size or aspect keeps them where you put them.'],
    'i-anno-color': ['Mark colour', 2,
      'Colour for the next mark. A mark set to "auto" follows the screen foreground instead, '
      + 'so it survives a palette change rather than vanishing into the new background.'],
    'i-anno-add': ['Add mark', 2,
      'Places it on the preview. Drag it to move; drag the corner grip to size it. Marks '
      + 'draw before the CRT pass, so they take the scanlines and the noise with everything '
      + 'else — they are on the screen, not on the glass.'],
    'i-anno-clear': ['Clear marks', 2, 'Removes every mark. Undoable, like any other edit.'],
  };
}
