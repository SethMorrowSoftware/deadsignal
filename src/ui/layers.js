/* Dead Signal Studio — ui/layers.js
 *
 * The LAYERS panel on the video tab.
 *
 * One row per layer, top of the list drawn last. Every field writes straight
 * through the document store, so a stack builds up as ordinary undoable edits
 * and travels in the project like everything else.
 */
import { $, escHtml, toast, val } from '../core/dom.js';
import { BLENDS, BLEND_LABEL, MAX_LAYERS, MAX_LAYER_SEED, hasOverrides, makeLayer, normalizeLayers } from '../doc/layers.js';
import { getStore } from '../doc/session.js';
import { set } from '../doc/store.js';
import { LAYERS_PATH, videoLayers } from '../video/layers.js';
import { SCENES } from '../video/scenes.js';

let _onChange = null;
/* Which layers have their overrides folded open. Rows are rebuilt on a
   structural change, and a <details> that shuts every time you toggle a layer
   would make the panel feel like it is fighting you. */
const _open = new Set();
/** The colour a layer inherits — shown as the starting point when you take it over. */
const baseFg = () => val('v-fg') || '#39ff9e';

function writeLayers(list, opts) {
  const st = getStore();
  if (!st) return false;
  st.apply(set(LAYERS_PATH, normalizeLayers(list), opts));
  return true;
}

const sceneName = (id) => SCENES[id]?.name || id;

/** Redraw the layer list. */
export function renderLayers() {
  const box = $('v-layers-list');
  if (!box) return;
  const layers = videoLayers();
  /* Read the folds straight off the DOM before tearing it down. The `toggle`
     event is queued rather than dispatched synchronously, so a rebuild in the
     same tick as a fold would otherwise rebuild from a stale set and shut it
     again in front of the author. */
  captureOpenState(box);
  box.replaceChildren();

  if (!layers.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'No layers — the clip is just the Scene above. Add one to stack a second scene over it.';
    box.appendChild(p);
    updateLayerCount(0);
    return;
  }

  const sceneOptions = Object.keys(SCENES)
    .map((id) => ({ id, name: sceneName(id) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Drawn bottom-first, so show the list top-down the way it stacks on screen.
  for (let i = 0; i < layers.length; i++) {
    const idx = layers.length - 1 - i;
    const l = layers[idx];
    const n = idx + 1;
    const row = document.createElement('div');
    row.className = 'layer-row' + (l.enabled ? '' : ' off');
    row.innerHTML =
      '<div class="row">'
      + '<input type="checkbox" data-i="' + idx + '" data-k="enabled"' + (l.enabled ? ' checked' : '')
      + ' aria-label="Layer ' + n + ' visible">'
      + '<select data-i="' + idx + '" data-k="scene" class="grow" aria-label="Layer ' + n + ' scene">'
      + sceneOptions.map((s) => '<option value="' + escHtml(s.id) + '"'
          + (s.id === l.scene ? ' selected' : '') + '>' + escHtml(s.name) + '</option>').join('')
      + '</select>'
      + '<button class="btn small" data-i="' + idx + '" data-act="up"' + (idx === layers.length - 1 ? ' disabled' : '')
      + ' aria-label="Move layer ' + n + ' up">↑</button>'
      + '<button class="btn small" data-i="' + idx + '" data-act="dn"' + (idx === 0 ? ' disabled' : '')
      + ' aria-label="Move layer ' + n + ' down">↓</button>'
      + '<button class="btn small" data-i="' + idx + '" data-act="rm" aria-label="Remove layer ' + n + '">✕</button>'
      + '</div>'
      + '<div class="row">'
      + '<select data-i="' + idx + '" data-k="blend" aria-label="Layer ' + n + ' blend mode">'
      /* An explicit value, because the label is no longer the name: the stored
         blend is the canvas operation and 'source-over' is not a word anybody
         wants to read in a picker. */
      + BLENDS.map((b) => '<option value="' + escHtml(b) + '"' + (b === l.blend ? ' selected' : '')
        + '>' + escHtml(BLEND_LABEL[b] || b) + '</option>').join('')
      + '</select>'
      + '<input type="range" data-i="' + idx + '" data-k="opacity" class="grow" min="0" max="100" step="1" value="'
      + Math.round(l.opacity * 100) + '" aria-label="Layer ' + n + ' opacity">'
      + '<span class="tag">' + Math.round(l.opacity * 100) + '%</span>'
      + '</div>'
      /* The overrides fold away. A layer that inherits everything is the common
         case and four extra controls per layer would bury the stack; a layer
         that overrides something says so in the summary, so nothing is hidden
         that is actually doing anything. */
      + '<details class="layer-more"' + (_open.has(idx) ? ' open' : '') + '>'
      + '<summary>' + (hasOverrides(l) ? '◆ own text / look' : 'own text / look') + '</summary>'
      + '<textarea data-i="' + idx + '" data-k="text" rows="2" placeholder="same text as the clip below"'
      + ' aria-label="Layer ' + n + ' text">' + escHtml(l.text) + '</textarea>'
      + '<div class="row">'
      + '<label><input type="checkbox" data-i="' + idx + '" data-k="ownfg"' + (l.fg ? ' checked' : '')
      + ' aria-label="Layer ' + n + ' uses its own colour"> colour</label>'
      + '<input type="color" data-i="' + idx + '" data-k="fg" value="' + escHtml(l.fg || baseFg())
      + '"' + (l.fg ? '' : ' disabled') + ' aria-label="Layer ' + n + ' colour">'
      + '<label for="lyr-font-' + idx + '">size</label>'
      + '<input type="number" id="lyr-font-' + idx + '" data-i="' + idx + '" data-k="font" min="0" max="72"'
      + ' style="width:4.5em" placeholder="same" value="' + (l.font > 0 ? l.font : '') + '">'
      + '<label for="lyr-seed-' + idx + '">variant</label>'
      + '<input type="number" id="lyr-seed-' + idx + '" data-i="' + idx + '" data-k="seed" min="0" max="'
      + MAX_LAYER_SEED + '" style="width:4.5em" placeholder="0" value="' + (l.seed > 0 ? l.seed : '') + '"'
      + ' title="Re-rolls this layer\'s randomness, so a second copy of the same scene is a different one">'
      + '</div>'
      + '</details>';
    box.appendChild(row);
  }

  updateLayerCount(layers.length);
}

function updateLayerCount(n) {
  const tag = $('v-layers-count');
  if (tag) tag.textContent = n ? String(n) : '';
}

function captureOpenState(box) {
  const rows = box.querySelectorAll('.layer-row');
  if (!rows.length) return;
  for (const row of rows) {
    const i = Number(row.querySelector('[data-i]')?.dataset.i);
    const d = row.querySelector('details.layer-more');
    if (!Number.isFinite(i) || !d) continue;
    if (d.open) _open.add(i); else _open.delete(i);
  }
}

/** Keep the fold's summary honest after an edit that did not rebuild the row. */
function markOverrides(el, i) {
  const s = el.closest('details.layer-more')?.querySelector('summary');
  if (!s) return;
  const l = videoLayers()[i];
  s.textContent = (l && hasOverrides(l) ? '◆ ' : '') + 'own text / look';
}

/**
 * Change one field of one layer.
 *
 * `redraw` is false for a live slider drag, and that is not a nicety. The rows
 * are rebuilt with replaceChildren(), so redrawing on every `input` event
 * destroyed the very element the pointer was dragging: the browser lost the
 * drag with it, and the opacity slider could only ever be nudged one step at a
 * time. The filter panel already worked this way; the layer panel did not.
 *
 * The coalesce key is the other half. Without it a drag wrote one undo entry
 * per pixel — a dozen entries for one gesture, and a full-width drag was enough
 * to push everything else off the 200-deep history.
 */
function edit(i, key, value, { redraw = true } = {}) {
  const layers = videoLayers();
  if (!layers[i]) return;
  layers[i] = makeLayer({ ...layers[i], [key]: value });
  writeLayers(layers, { coalesceKey: `layer:${i}:${key}`, label: `layer ${key}` });
  if (redraw) renderLayers();
  _onChange?.();
}

export function addLayer() {
  const layers = videoLayers();
  if (layers.length >= MAX_LAYERS) { toast(`${MAX_LAYERS} layers is the limit`, 'err'); return; }
  if (!writeLayers([...layers, makeLayer({})])) {
    toast('Layers need a project session', 'err');
    return;
  }
  renderLayers();
  _onChange?.();
  toast('Layer added');
}

export function clearLayers() {
  if (!videoLayers().length) return;
  writeLayers([]);
  renderLayers();
  _onChange?.();
}

export function initLayers(onChange) {
  const box = $('v-layers-list');
  if (!box) return;
  _onChange = onChange;
  renderLayers();

  $('v-layers-add')?.addEventListener('click', addLayer);

  // One delegated listener for the whole list: rows are rebuilt on every edit,
  // so per-row listeners would be registered and dropped constantly.
  const handle = (e, { live = false } = {}) => {
    const el = e.target.closest('[data-i]');
    if (!el) return;
    const i = Number(el.dataset.i);
    if (el.dataset.act) {
      const layers = videoLayers();
      if (el.dataset.act === 'rm') layers.splice(i, 1);
      else {
        const j = el.dataset.act === 'up' ? i + 1 : i - 1;
        if (j < 0 || j >= layers.length) return;
        [layers[i], layers[j]] = [layers[j], layers[i]];
      }
      // Indices move, so a remembered fold would reopen on whichever layer
      // happens to land in that slot. Forget them rather than guess.
      _open.clear();
      writeLayers(layers, { label: el.dataset.act === 'rm' ? 'remove layer' : 'reorder layers' });
      renderLayers();
      _onChange?.();
      return;
    }
    const k = el.dataset.k;
    if (k === 'enabled') edit(i, k, el.checked);
    else if (k === 'opacity') {
      // Keep the readout beside the slider honest without rebuilding the row.
      const out = el.nextElementSibling;
      if (out && out.classList.contains('tag')) out.textContent = `${Math.round(Number(el.value))}%`;
      edit(i, k, Number(el.value) / 100, { redraw: !live });
    } else if (k === 'ownfg') {
      /* One stored field, not two. Taking the colour over starts from the one
         the layer was already inheriting, so ticking the box changes nothing
         until you actually move the picker — and clearing it goes back to
         following the base, including when the base changes later. Redraws,
         because the picker's enabled state is what the tick means. */
      edit(i, 'fg', el.checked ? (el.closest('.row')?.querySelector('input[data-k=fg]')?.value || baseFg()) : '');
    } else {
      /* Nothing else changes the row's SHAPE, so nothing else may rebuild it —
         a textarea replaced mid-word takes the caret and the rest of the word
         with it. The summary marker is refreshed by hand instead. */
      edit(i, k, el.value, { redraw: false });
      markOverrides(el, i);
    }
  };
  box.addEventListener('click', (e) => { if (e.target.closest('button[data-act]')) handle(e); });
  // `change` on a range fires once the drag ends, which is the right moment to
  // redraw the row (and to relabel it if the list has moved on).
  box.addEventListener('change', (e) => handle(e));
  box.addEventListener('input', (e) => {
    // Live: the slider, and the override fields — typing a caption and watching
    // it appear is the whole point of putting it on a layer.
    if (e.target.matches('input[type=range]')) handle(e, { live: true });
    else if (e.target.matches('textarea[data-k], input[type=color][data-k], input[type=number][data-k]')) handle(e);
  });
  // Remember which stacks the author left open. `toggle` does not bubble, so
  // this listens in the capture phase.
  box.addEventListener('toggle', (e) => {
    const d = e.target.closest && e.target.closest('details.layer-more');
    if (!d) return;
    const i = Number(d.parentElement?.querySelector('[data-i]')?.dataset.i);
    if (!Number.isFinite(i)) return;
    if (d.open) _open.add(i); else _open.delete(i);
  }, true);
}
