/* Dead Signal Studio — ui/workspace.js
 *
 * The three-pane workspace: Browser | Viewer | Inspector.
 *
 * Deliberately built as a RE-LAYOUT of the existing DOM rather than new
 * markup. The settings panel already is an inspector and the stage panel
 * already is a viewer; what was missing was a browser and a layout that puts
 * them side by side instead of stacking a scrolling column of 137 controls
 * beside a small preview.
 *
 * Doing it this way means:
 *   - every control keeps its id, so the document binding, the palette, Explain
 *     mode and the complexity filter all work untouched in both layouts;
 *   - the toggle is real. Turning it off restores the tabbed layout exactly,
 *     because nothing was destroyed — only a class on <body> and one injected
 *     pane, which is removed again.
 *
 * The tab strip stays: in workspace mode it reads as a mode switch down the
 * side of the Browser rather than a row of tabs, but it is the same tablist
 * with the same keyboard model.
 */
import { $ } from '../core/dom.js';
import { activateTab } from './shell.js';
import { studioSources } from './palette.js';

const STORAGE_KEY = 'deadsignal.workspace';
let enabled = false;
let browserEl = null;
let sources = [];

function score(needle, hay) {
  if (!needle) return 1;
  const n = needle.toLowerCase(), h = hay.toLowerCase();
  const i = h.indexOf(n);
  return i === 0 ? 1000 : i > 0 ? 800 - i : -1;
}

const KINDS = ['Scene', 'Template', 'Preset', 'Action'];

function renderBrowser(query = '') {
  const list = $('ws-list');
  if (!list) return;
  list.replaceChildren();
  let shown = 0;
  for (const kind of KINDS) {
    const hits = sources
      .filter((s) => s.kind === kind)
      .map((s) => ({ s, n: Math.max(score(query, s.label), score(query, s.hint || '') - 100) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n);
    if (!hits.length) continue;

    const group = document.createElement('div');
    group.className = 'ws-group';
    const h = document.createElement('h3');
    h.className = 'ws-group-title';
    h.textContent = kind === 'Action' ? 'Actions' : `${kind}s`;
    group.appendChild(h);

    const ul = document.createElement('ul');
    ul.className = 'ws-items';
    ul.setAttribute('aria-label', h.textContent);
    for (const { s } of hits) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ws-item';
      b.textContent = s.label;
      if (s.hint) b.title = `${s.label} — ${s.hint}`;
      b.addEventListener('click', () => { try { s.run(); } catch (e) { console.error(e); } });
      li.appendChild(b);
      ul.appendChild(li);
      shown++;
    }
    group.appendChild(ul);
    list.appendChild(group);
  }
  const empty = $('ws-empty');
  if (empty) empty.hidden = shown > 0;
}

function buildBrowser() {
  const el = document.createElement('aside');
  el.id = 'ws-browser';
  el.className = 'ws-browser';
  el.setAttribute('aria-label', 'Browser');

  const lbl = document.createElement('label');
  lbl.setAttribute('for', 'ws-search');
  lbl.className = 'sr-only';
  lbl.textContent = 'Filter scenes, templates, presets and actions';

  const input = document.createElement('input');
  input.type = 'search';
  input.id = 'ws-search';
  input.className = 'ws-search';
  input.placeholder = 'Filter…';
  input.autocomplete = 'off';
  input.addEventListener('input', () => renderBrowser(input.value));

  const list = document.createElement('div');
  list.id = 'ws-list';
  list.className = 'ws-list';

  const empty = document.createElement('p');
  empty.id = 'ws-empty';
  empty.className = 'ws-empty';
  empty.textContent = 'Nothing matches.';
  empty.hidden = true;

  el.append(lbl, input, list, empty);
  return el;
}

export function isWorkspace() { return enabled; }

export function setWorkspace(on, { persist = true } = {}) {
  enabled = !!on;
  document.body.classList.toggle('workspace', enabled);
  if (persist) { try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch { /* private mode */ } }

  const main = document.querySelector('main');
  if (enabled) {
    if (!browserEl) browserEl = buildBrowser();
    if (browserEl.parentElement !== main) main.insertBefore(browserEl, main.firstChild);
    renderBrowser($('ws-search')?.value || '');
  } else if (browserEl && browserEl.parentElement) {
    // Nothing was destroyed on the way in, so leaving is just removing this.
    browserEl.remove();
  }

  const btn = $('workspace-toggle');
  if (btn) {
    btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    btn.classList.toggle('active', enabled);
    btn.textContent = enabled ? '▦ WORKSPACE' : '▤ TABS';
  }
  return enabled;
}

export function initWorkspace(deps) {
  sources = studioSources(deps);

  const btn = $('workspace-toggle');
  if (btn) btn.addEventListener('click', () => setWorkspace(!enabled));

  // ?workspace=1 / =0 wins over the stored preference, so a link can show
  // someone the new layout without changing their setting.
  const param = new URLSearchParams(location.search).get('workspace');
  let want = false;
  if (param === '1' || param === 'true') want = true;
  else if (param === '0' || param === 'false') want = false;
  else { try { want = localStorage.getItem(STORAGE_KEY) === '1'; } catch { want = false; } }

  setWorkspace(want, { persist: param === null });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === '\\')) {
      e.preventDefault();
      setWorkspace(!enabled);
    }
  });

  return { setWorkspace, isWorkspace };
}
