/* Dead Signal Studio — ui/sections.js
 *
 * Sections for the settings column.
 *
 * WHY THIS EXISTS
 *
 * The column on the right is where every control lives, and it was one
 * uninterrupted scroll. Measured: VIDEO is 7.1 screens of it, SCREEN 4.2, and
 * AUDIO — twenty-five fieldsets and a hundred and eighty-eight controls —
 * thirteen and a half. Every fieldset could already be collapsed by clicking
 * its title, but they all start open, so the first thing the tool asks of
 * anyone is to scroll past two hundred controls looking for the four they want.
 * That is not a settings panel, it is an inventory.
 *
 * So the fieldsets are grouped, and one group shows at a time.
 *
 * HOW IT IS BUILT
 *
 *   - The grouping is declared in the MARKUP (`data-section` on each fieldset),
 *     not matched from legend text here. Matching on text means a section
 *     silently empties the day someone rewords a heading.
 *
 *   - The strip is a group of toggle BUTTONS with aria-pressed, deliberately
 *     not role="tab". The page already has one tablist — the workspace
 *     switcher — and a second one would mean two elements claiming to be "the
 *     selected tab", two roving tabindexes, and an aria contract that cannot
 *     hold. This is a segmented control, which is what it looks like and what
 *     it is.
 *
 *   - Hidden sections are `display:none`, so nothing inside them is focusable
 *     or announced while hidden. Which means anything that JUMPS to a control —
 *     the command palette, Explain mode — has to be able to bring its section
 *     back: revealSectionFor() is that, and ui/palette.js calls it.
 *
 *   - A view with only a handful of fieldsets gets no strip at all. Three
 *     buttons above two fieldsets is furniture, not navigation.
 *
 * Nothing here touches an id, a value, or the document. It shows and hides
 * existing markup, so the binding, the palette, the complexity filter and every
 * test that addresses a control by id are unaffected.
 */
import { $ } from '../core/dom.js';

const KEY = 'deadsignal.studio.section.';
/** Below this many groups a strip is noise rather than navigation. */
const MIN_SECTIONS = 2;

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/** Every panel that declares sections, with its groups in document order. */
function panels() {
  const out = [];
  for (const view of document.querySelectorAll('.view')) {
    /* Grouped by PANEL, not by view. A view can hold more than one panel — the
       stage carries controls of its own — and taking the first tagged
       fieldset's panel for the whole view would put the strip wherever that
       fieldset happened to be, and let one stray tag reorder every group. */
    const byPanel = new Map();
    for (const f of view.querySelectorAll('fieldset[data-section]')) {
      const panel = f.closest('.panel');
      if (!panel) continue;
      if (!byPanel.has(panel)) byPanel.set(panel, []);
      byPanel.get(panel).push(f);
    }
    for (const [panel, fs] of byPanel) {
      const names = [];
      for (const f of fs) if (!names.includes(f.dataset.section)) names.push(f.dataset.section);
      if (names.length < MIN_SECTIONS) continue;
      out.push({ view, panel, fieldsets: fs, names });
    }
  }
  return out;
}

function apply(entry, name) {
  const active = entry.names.includes(name) ? name : entry.names[0];
  for (const f of entry.fieldsets) {
    f.classList.toggle('section-hidden', f.dataset.section !== active);
  }
  for (const b of entry.panel.querySelectorAll(':scope > .sec-strip > button')) {
    b.setAttribute('aria-pressed', String(b.dataset.section === active));
  }
  lsSet(KEY + entry.view.id, active);
  return active;
}

function build(entry) {
  if (entry.panel.querySelector(':scope > .sec-strip')) return;
  const strip = document.createElement('div');
  strip.className = 'sec-strip';
  strip.id = `sec-${entry.view.id}`;
  strip.setAttribute('role', 'group');
  strip.setAttribute('aria-label', 'Settings sections');
  for (const name of entry.names) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.section = name;
    b.textContent = name;
    b.id = `sec-${entry.view.id}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const n = entry.fieldsets.filter((f) => f.dataset.section === name).length;
    b.title = `${name} — ${n} section${n === 1 ? '' : 's'} of settings`;
    b.addEventListener('click', () => apply(entry, name));
    strip.appendChild(b);
  }
  /* Above everything the panel holds, and sticky: scrolling a long section must
     not take the way back out of the panel with it. */
  entry.panel.insertBefore(strip, entry.panel.firstChild);
  /* The strip is sticky INSIDE the panel's scrollport, so everything that
     scrolls a control into view — keyboard focus, the palette's jump, a
     suite's scrollIntoView — must aim below it, or on a short pane the
     control lands exactly under the strip. scroll-padding is how a scroll
     container declares that, and it is set from measurement rather than a
     constant because the strip wraps to more rows as the pane narrows. */
  const declare = () => {
    entry.panel.style.scrollPaddingTop = strip.offsetHeight + 'px';   /* dom-only: measured chrome height */
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(declare).observe(strip);
  declare();
}

let _entries = [];

/** Build the strips and restore each panel's last section. */
export function initSections() {
  _entries = panels();
  for (const e of _entries) {
    build(e);
    apply(e, lsGet(KEY + e.view.id, e.names[0]));
  }
  return _entries.length;
}

/**
 * Make sure `el` is in a visible section, and say which one.
 *
 * The counterpart to hiding: a jump-to-control that lands on a hidden element
 * silently does nothing, which would make Ctrl+K lie about reaching every
 * setting.
 */
export function revealSectionFor(el) {
  const fs = el?.closest?.('fieldset[data-section]');
  if (!fs) return null;
  const entry = _entries.find((e) => e.fieldsets.includes(fs));
  if (!entry) return null;
  return apply(entry, fs.dataset.section);
}

/** Which section a panel is showing (for the suites and for Explain mode). */
export function activeSection(viewId) {
  const entry = _entries.find((e) => e.view.id === viewId);
  if (!entry) return null;
  const shown = entry.fieldsets.find((f) => !f.classList.contains('section-hidden'));
  return shown?.dataset.section ?? null;
}

/** Every section a view declares, in order. */
export function sectionsOf(viewId) {
  return _entries.find((e) => e.view.id === viewId)?.names.slice() ?? [];
}

/** Show a named section directly. Returns what is showing afterwards. */
export function showSection(viewId, name) {
  const entry = _entries.find((e) => e.view.id === viewId);
  return entry ? apply(entry, name) : null;
}
