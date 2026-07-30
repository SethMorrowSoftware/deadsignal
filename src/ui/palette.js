/* Dead Signal Studio — ui/palette.js
 *
 * ⌘K / Ctrl+K. One search box over everything the studio can do or contains:
 * actions, scenes, templates, presets, and — the part that matters most with
 * 137 controls — individual parameters, which it jumps to and focuses.
 *
 * This is the answer to "where is the setting for X". Without it the only way
 * to find a control is to know which of seven tabs and eleven fieldsets it
 * lives in.
 */
import { $, log, setVal } from '../core/dom.js';
import { userPresets } from '../core/recipes.js';
import { revealSectionFor } from './sections.js';
import { PARAMS } from './params.js';
import { LEVEL_NAMES, applyLevel, getLevel } from './complexity.js';
import { activateTab } from './shell.js';

let el = null, input = null, list = null, items = [], sel = 0, lastFocus = null;
/* Kept so the catalogue can be rebuilt. It was built once in initPalette() and
   never again, which made ⌘K a snapshot of the studio as it looked at boot: a
   preset saved this session, a variable just defined, a layer just added — none
   of it findable, and no indication that the list was stale rather than the
   feature broken. Rebuilding on open costs one walk of a few hundred records,
   which is nothing next to the keystroke that asked for it. */
let deps = null;

/* Subsequence match with a score, so "vscan" finds "Video · Scanlines" and
   an exact prefix still wins. */
function score(needle, hay) {
  if (!needle) return 1;
  const n = needle.toLowerCase(), h = hay.toLowerCase();
  const idx = h.indexOf(n);
  if (idx === 0) return 1000;
  if (idx > 0) return 800 - idx;
  let i = 0, s = 0, streak = 0;
  for (let j = 0; j < h.length && i < n.length; j++) {
    if (h[j] === n[i]) { i++; streak++; s += 10 + streak * 2; }
    else streak = 0;
  }
  return i === n.length ? s : -1;
}

/** Everything insertable or runnable, as flat records. */
export function studioSources(deps) {
  const out = [];
  const { SCENES, TEMPLATES, PRESETS, actions } = deps;

  for (const a of actions) out.push({ kind: 'Action', label: a.label, hint: a.hint || '', run: a.run });

  for (const s of Object.values(SCENES || {})) {
    out.push({ kind: 'Scene', label: s.name, hint: 'video', run: () => {
      activateTab('video');
      setVal('v-scene', s.id);
    } });
  }
  for (const t of Object.values(TEMPLATES || {})) {
    out.push({ kind: 'Template', label: t.name, hint: 'screen', run: () => {
      activateTab('image');
      setVal('i-tpl', t.id);
    } });
  }
  const pick = (tab, value) => {
    activateTab(tab);
    const s = $({ video: 'v-preset', audio: 'a-preset', image: 'i-preset' }[tab]);
    if (s) setVal(s.id, value);
  };
  for (const [tab, groups] of Object.entries(PRESETS || {})) {
    for (const [group, entries] of Object.entries(groups || {})) {
      for (const name of Object.keys(entries || {})) {
        out.push({ kind: 'Preset', label: name, hint: `${tab} · ${group}`,
          run: () => pick(tab, name) });
      }
    }
  }
  /* THE AUTHOR'S OWN PRESETS TOO.
     Only the shipped PRESETS were listed, so a look you saved yourself — the one
     you are most likely to be searching for by name — was the one thing ⌘K could
     not find. The picker addresses them as `user:<name>`, which is why the value
     and the label differ here. Read at call time from localStorage rather than
     from a snapshot; see the note on rebuilding in openPalette. */
  for (const tab of ['video', 'audio', 'image']) {
    for (const name of Object.keys(userPresets(tab))) {
      out.push({ kind: 'Preset', label: name, hint: `${tab} · my presets`,
        run: () => pick(tab, `user:${name}`) });
    }
  }
  for (const p of Object.values(PARAMS)) {
    const tab = p.id.startsWith('v-') || p.id.startsWith('lock-v') ? 'video'
      : p.id.startsWith('a-') || p.id.startsWith('fx-') ? 'audio'
      : p.id.startsWith('i-') ? 'image'
      : p.id.startsWith('tl-') ? 'timeline' : null;
    if (!tab) continue;
    out.push({ kind: 'Setting', label: p.label, hint: `${tab}${p.unit ? ' · ' + p.unit : ''}`,
      detail: p.explain, run: () => revealControl(p.id, tab) });
  }
  return out;
}

/** Switch to the right tab, expand its section, scroll to it, focus, flash.
    A target the detail level hides is revealed by raising the level first —
    Ctrl+K promises to jump to every setting, not just the visible ones. */
export function revealControl(id, tab) {
  if (tab) activateTab(tab);
  const c = $(id);
  if (!c) return false;
  // The same "row" applyLevel() stamps .level-hidden on. Checking the class
  // rather than the registry means a row a lower-level sibling already keeps
  // visible never bumps the user's detail level for nothing.
  const levelRow = c.closest('.row') || c.parentElement;
  if (levelRow && levelRow.classList.contains('level-hidden')) {
    const lvl = applyLevel(Math.max(getLevel(), PARAMS[id]?.level ?? 1));
    log(`Detail level raised to ${LEVEL_NAMES[lvl]} to show "${PARAMS[id]?.label || id}"`, 'info');
  }
  const fs = c.closest('fieldset');
  if (fs) fs.classList.remove('collapsed');
  /* And bring its SECTION back if the panel is showing a different one —
     otherwise the jump lands on a display:none element and quietly does
     nothing, which would make this promise to reach every setting and not. */
  revealSectionFor(c);
  c.scrollIntoView({ block: 'center', behavior: 'auto' });
  try { c.focus({ preventScroll: true }); } catch { c.focus(); }
  const row = c.closest('.row') || c;
  row.classList.add('flash-target');
  setTimeout(() => row.classList.remove('flash-target'), 1200);
  return true;
}

function render(q) {
  const scored = items
    .map((it) => ({ it, s: Math.max(score(q, it.label), score(q, `${it.kind} ${it.label} ${it.hint}`) - 200) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 40);
  list.replaceChildren();
  scored.forEach((x, i) => {
    const li = document.createElement('li');
    li.className = 'pal-item' + (i === sel ? ' sel' : '');
    li.id = `pal-opt-${i}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', i === sel ? 'true' : 'false');
    const k = document.createElement('span'); k.className = 'pal-kind'; k.textContent = x.it.kind;
    const l = document.createElement('span'); l.className = 'pal-label'; l.textContent = x.it.label;
    const h = document.createElement('span'); h.className = 'pal-hint'; h.textContent = x.it.hint || '';
    li.append(k, l, h);
    li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(x.it); });
    list.appendChild(li);
  });
  list._results = scored.map((x) => x.it);
  input.setAttribute('aria-activedescendant', scored.length ? `pal-opt-${sel}` : '');
  const empty = $('pal-empty');
  if (empty) empty.hidden = scored.length > 0;
}

function choose(it) { closePalette(); try { it.run(); } catch (e) { console.error(e); } }

export function openPalette() {
  if (!el) return;
  if (deps) items = studioSources(deps);      // fresh every time it is opened
  lastFocus = document.activeElement;
  el.hidden = false;
  input.value = '';   /* dom-only: the palette's own search box */
  sel = 0;
  render('');
  input.focus();
}

export function closePalette() {
  if (!el || el.hidden) return;
  el.hidden = true;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

export function isPaletteOpen() { return el && !el.hidden; }

export function initPalette(d) {
  deps = d;
  items = studioSources(deps);

  el = document.createElement('div');
  el.className = 'palette';
  el.id = 'palette';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Command palette');

  const box = document.createElement('div'); box.className = 'pal-box';
  const lbl = document.createElement('label');
  lbl.className = 'sr-only'; lbl.setAttribute('for', 'pal-input');
  lbl.textContent = 'Search commands, scenes, presets and settings';
  input = document.createElement('input');
  input.id = 'pal-input'; input.type = 'text'; input.className = 'pal-input';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'pal-list');
  input.setAttribute('aria-autocomplete', 'list');
  input.autocomplete = 'off';
  input.placeholder = 'Search actions, scenes, presets, settings…';
  list = document.createElement('ul');
  list.className = 'pal-list'; list.id = 'pal-list'; list.setAttribute('role', 'listbox');
  const empty = document.createElement('p');
  empty.className = 'pal-empty'; empty.id = 'pal-empty'; empty.textContent = 'Nothing matches.'; empty.hidden = true;
  const foot = document.createElement('p');
  foot.className = 'pal-foot';
  foot.textContent = '↑↓ move · ⏎ go · esc close';
  box.append(lbl, input, list, empty, foot);
  el.appendChild(box);
  document.body.appendChild(el);

  el.addEventListener('mousedown', (e) => { if (e.target === el) closePalette(); });
  input.addEventListener('input', () => { sel = 0; render(input.value); });
  input.addEventListener('keydown', (e) => {
    const n = (list._results || []).length;
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = n ? (sel + 1) % n : 0; render(input.value); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = n ? (sel - 1 + n) % n : 0; render(input.value); }
    else if (e.key === 'Home') { e.preventDefault(); sel = 0; render(input.value); }
    else if (e.key === 'End') { e.preventDefault(); sel = Math.max(0, n - 1); render(input.value); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = (list._results || [])[sel]; if (it) choose(it); }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      isPaletteOpen() ? closePalette() : openPalette();
    }
  });

  return { open: openPalette, close: closePalette, isOpen: isPaletteOpen, count: items.length };
}
