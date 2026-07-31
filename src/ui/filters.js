/* Dead Signal Studio — ui/filters.js
 *
 * The chain panel: one row per step, applied top to bottom, reorderable.
 *
 * Written for the video FILTERS chain and then generalised, because the AUDIO
 * FX chain is the same interaction over a different registry — a picker, an
 * ordered list, bypass, reorder, remove, and per-step controls built from each
 * step's declared parameters. Two copies of this would be two places to fix
 * every bug in it.
 *
 * The controls for a step are built from the registry's declared parameter list
 * rather than hand-written markup — that is the whole point of declaring them,
 * and it means adding an effect needs no UI work at all.
 *
 * Every field writes straight through the document store, so a chain builds up
 * as ordinary undoable edits and travels in the project like everything else.
 */
import { $, escHtml, toast } from '../core/dom.js';
import { MAX_FILTERS, makeFilter, normalizeFilters } from '../doc/filters.js';
import { getStore } from '../doc/session.js';
import { set } from '../doc/store.js';
import { FILTERS, filterGroups, resolveParams } from '../fx/filters.js';
import { FILTERS_PATH } from '../video/filters.js';

/* Registered chains, by key. Each one names its document path, its registry
   and its five control ids; everything else below is shared. */
const _chains = new Map();

/**
 * Register a chain panel.
 *
 * @param {string} key      identifies the chain to render/add/clear
 * @param {object} cfg      { path, registry, groups, resolve, ids, empty, onChange }
 *   path      document path the chain is stored at
 *   registry  id -> { name, params }
 *   groups    () => Map(groupName -> entries[]) for the picker
 *   resolve   (id, params) -> resolved params
 *   ids       { list, pick, add, clear, count }
 *   empty     the hint shown when the chain has no steps
 */
export function registerChain(key, cfg) {
  _chains.set(key, cfg);
}

const chainOf = (key) => _chains.get(key);
/** The stored chain, normalised. */
function readChain(key) {
  const c = chainOf(key);
  const st = getStore();
  if (!c || !st) return [];
  return normalizeFilters(st.get(c.path) || []);
}
function writeChain(key, list, opts) {
  const c = chainOf(key);
  const st = getStore();
  if (!c || !st) return false;
  st.apply(set(c.path, normalizeFilters(list), opts));
  return true;
}
const stepName = (key, id) => chainOf(key)?.registry[id]?.name || id;

/** Redraw one chain's list. */
export function renderChain(key) {
  const c = chainOf(key);
  if (!c) return;
  const box = $(c.ids.list);
  if (!box) return;
  const chain = readChain(key);
  box.replaceChildren();

  if (!chain.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = c.empty;
    box.appendChild(p);
    updateChainCount(key, 0);
    return;
  }

  chain.forEach((step, i) => {
    const f = c.registry[step.id];
    const row = document.createElement('div');
    row.className = 'filter-row' + (step.enabled ? '' : ' off');

    const head = document.createElement('div');
    head.className = 'filter-head';
    // A filter this build does not have is shown, not silently dropped — the
    // document kept it so the author does not lose work by opening the project
    // in an older tab.
    head.innerHTML = '<span class="filter-name">' + escHtml(f ? f.name : step.id + ' (unavailable)') + '</span>'
      + '<span class="filter-actions">'
      + '<button class="btn small" data-i="' + i + '" data-act="up"' + (i === 0 ? ' disabled' : '') + ' title="run earlier">↑</button> '
      + '<button class="btn small" data-i="' + i + '" data-act="dn"' + (i === chain.length - 1 ? ' disabled' : '') + ' title="run later">↓</button> '
      + '<button class="btn small" data-i="' + i + '" data-act="toggle" title="bypass">' + (step.enabled ? '◉' : '○') + '</button> '
      + '<button class="btn small" data-i="' + i + '" data-act="rm" title="remove">✕</button>'
      + '</span>';
    row.appendChild(head);

    if (f) {
      const p = c.resolve(step.id, step.params);
      const body = document.createElement('div');
      body.className = 'filter-params';
      for (const spec of f.params) {
        const lab = document.createElement('label');
        lab.className = 'filter-param';
        const id = `${key}-step-${i}-${spec.key}`;
        lab.htmlFor = id;
        lab.textContent = spec.label;
        /* A mode is a list, not a slider: dragging a range across "CGA, EGA,
           Game Boy, Teletext" is asking the author to guess which number is
           which palette. */
        const input = document.createElement(spec.kind === 'select' ? 'select' : 'input');
        input.id = id;
        input.dataset.i = String(i);
        input.dataset.key = spec.key;
        /* These inputs are built here and write to the chain's document path
           through the store below — they are not document-BOUND controls, so
           setVal() (which dispatches for the binding to pick up) would be
           wrong: there is no binding, and the dispatch would re-enter this
           render. */
        if (spec.kind === 'select') {
          for (const o of spec.options) {
            const opt = document.createElement('option');
            opt.value = o.value; opt.textContent = o.label;
            input.appendChild(opt);
          }
          input.value = p[spec.key];   /* dom-only: panel-local, writes via the store */
        }
        else if (spec.kind === 'color') { input.type = 'color'; input.value = p[spec.key]; /* dom-only: panel-local, writes via the store */ }
        else if (spec.kind === 'text') { input.type = 'text'; input.value = p[spec.key]; /* dom-only: panel-local, writes via the store */ }
        else {
          input.type = 'range';
          input.min = String(spec.min); input.max = String(spec.max);
          input.step = String(spec.step); input.value = String(p[spec.key]);   /* dom-only: panel-local, writes via the store */
        }
        const out = document.createElement('span');
        out.className = 'filter-value';
        out.textContent = spec.kind ? '' : String(p[spec.key]);
        body.appendChild(lab);
        body.appendChild(input);
        body.appendChild(out);
      }
      row.appendChild(body);
    }
    box.appendChild(row);
  });

  box.querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.i, act = b.dataset.act;
    const next = readChain(key);
    if (act === 'up' && i > 0) { [next[i - 1], next[i]] = [next[i], next[i - 1]]; }
    else if (act === 'dn' && i < next.length - 1) { [next[i + 1], next[i]] = [next[i], next[i + 1]]; }
    else if (act === 'rm') { next.splice(i, 1); }
    else if (act === 'toggle') { next[i] = { ...next[i], enabled: !next[i].enabled }; }
    else return;
    if (writeChain(key, next)) { renderChain(key); c.onChange?.(); }
  }));

  box.querySelectorAll('input[data-key],select[data-key]').forEach((el) => {
    const commit = () => {
      const i = +el.dataset.i, pk = el.dataset.key;
      const next = readChain(key);
      if (!next[i]) return;
      const v = el.type === 'range' ? Number(el.value) : el.value;
      next[i] = { ...next[i], params: { ...next[i].params, [pk]: v } };
      // coalesceKey keeps a slider drag as ONE undo entry rather than forty.
      writeChain(key, next, { coalesceKey: `${key}:${i}:${pk}`, label: `${key} ${pk}` });
      const out = el.nextElementSibling;
      if (out && el.type === 'range') out.textContent = el.value;
      c.onChange?.();
    };
    el.addEventListener('input', commit);
    el.addEventListener('change', commit);
  });

  updateChainCount(key, chain.length);
}

function updateChainCount(key, n) {
  const tag = $(chainOf(key)?.ids.count);
  if (tag) tag.textContent = n ? String(n) : '';
}

/** Add the step currently chosen in a chain's picker. */
export function addToChain(key, id) {
  const c = chainOf(key);
  if (!c) return;
  const pick = id || $(c.ids.pick)?.value;
  if (!pick || !c.registry[pick]) { toast('Pick one first', 'err'); return; }
  const chain = readChain(key);
  if (chain.length >= MAX_FILTERS) {
    toast(`${MAX_FILTERS} is the limit`, 'err');
    return;
  }
  chain.push(makeFilter({ id: pick, params: {}, enabled: true }));
  if (writeChain(key, chain)) { renderChain(key); c.onChange?.(); toast('+ ' + stepName(key, pick)); }
}

export function clearChain(key) {
  const c = chainOf(key);
  if (writeChain(key, [])) { renderChain(key); c?.onChange?.(); toast('Cleared'); }
}

/** Fill a chain's picker, grouped, and wire its buttons. */
export function initChain(key, cfg) {
  registerChain(key, cfg);
  const pick = $(cfg.ids.pick);
  if (pick) {
    pick.replaceChildren();
    for (const [group, list] of cfg.groups()) {
      const og = document.createElement('optgroup');
      og.label = group;
      for (const f of list) {
        const o = document.createElement('option');
        o.value = f.id;
        o.textContent = f.name;
        og.appendChild(o);
      }
      pick.appendChild(og);
    }
  }
  $(cfg.ids.add)?.addEventListener('click', () => addToChain(key));
  $(cfg.ids.clear)?.addEventListener('click', () => clearChain(key));
  renderChain(key);
}

/* ------------------------------------------------------------- video ---- */
/* The original call site, unchanged from the outside. boot.js and the debug
   surface still say renderFilters()/addFilter()/clearFilters(). */

export const VIDEO_CHAIN = 'v-filters';

export function initFilters(onChange) {
  initChain(VIDEO_CHAIN, {
    path: FILTERS_PATH,
    registry: FILTERS,
    groups: filterGroups,
    resolve: resolveParams,
    ids: { list: 'v-filters-list', pick: 'v-filters-pick', add: 'v-filters-add',
           clear: 'v-filters-clear', count: 'v-filters-count' },
    // "drag the order" described a gesture this panel does not have — the
    // reorder is the ↑ ↓ buttons on each step. A hint that names a control that
    // is not there is worse than no hint: it reads as something being broken.
    empty: 'No filters — the clip is just the CRT look above. '
      + 'Add one to grade, distort or break it, then use ↑ ↓ on a step to change what runs first.',
    onChange,
  });
}
export const renderFilters = () => renderChain(VIDEO_CHAIN);
export const addFilter = (id) => addToChain(VIDEO_CHAIN, id);
export const clearFilters = () => clearChain(VIDEO_CHAIN);

/* The SCREEN tab's copy of the same chain, over the same registry — one still
   instead of a frame. Its own key and its own document path so the two chains
   never share state, but everything else is identical, which is the whole point
   of the generalised panel. */
export const IMAGE_CHAIN = 'i-filters';
export function initImageFilters(onChange) {
  initChain(IMAGE_CHAIN, {
    path: 'filters.image',
    registry: FILTERS,
    groups: filterGroups,
    resolve: resolveParams,
    ids: { list: 'i-filters-list', pick: 'i-filters-pick', add: 'i-filters-add',
           clear: 'i-filters-clear', count: 'i-filters-count' },
    empty: 'No filters — the still is just the template and the CRT/paper FX above. '
      + 'Add one to grade, warp or screen it, then use ↑ ↓ on a step to change what runs first.',
    onChange,
  });
}
export const renderImageFilters = () => renderChain(IMAGE_CHAIN);
export const addImageFilter = (id) => addToChain(IMAGE_CHAIN, id);
export const clearImageFilters = () => clearChain(IMAGE_CHAIN);
