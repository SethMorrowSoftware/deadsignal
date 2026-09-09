/* Dead Signal Studio — ui/complexity.js
 *
 * Simple / Studio / Deep. A view filter over the same document — never a
 * capability lock. Nothing is disabled, nothing stops working, and the values
 * of hidden controls still apply; they are simply not shown.
 *
 * 192 controls presented at once is the reason a first-time user cannot tell
 * "Scene" (changes everything) from "Hum bar" (a subtle post effect). Simple
 * shows the 49 that matter first, including the macros; Studio adds the
 * everyday 120; Deep adds the last 23 — formats, exact frame placement,
 * internals. Simple is what a browser with no stored preference gets.
 */
import { $ } from '../core/dom.js';
import { PARAMS } from './params.js';

export const LEVEL_NAMES = { 1: 'Simple', 2: 'Studio', 3: 'Deep' };
const STORAGE_KEY = 'deadsignal.complexity';

/* Simple, for a browser that has never said otherwise.
   The level that reduces has always existed and was never what anyone saw: the
   default showed 169 of 192 registered controls, which is not a simplification
   of anything. It could not be the default before, because Simple was broken —
   it deleted every export button on three workspaces (see levelRowOf). With
   that fixed, the first screen of this tool is a dozen controls that decide
   what the clip IS, and everything else is one pick of `detail` away.
   Nothing becomes unreachable: Ctrl+K raises the level automatically when it
   jumps to a control the level hides, and says in the log that it did. */
let current = 1;

/**
 * Workspaces this filter does not touch.
 *
 * "Detail" thins a SETTINGS PANEL: two hundred sliders describing one picture,
 * where the whole problem is telling Scene (changes everything) from Hum bar (a
 * subtle post effect) and where every one of them has a working default. None
 * of that describes a form.
 *
 * These three are forms. LIBRARY's batch panel is source + length + container;
 * BUNDLE's is which campaign, its name, its id and its beats; CLOUD's is a
 * username and a password. Every field is required to do the one thing the
 * workspace exists for, and none of them has a default that means anything —
 * so a level that hid them did not simplify the workspace, it disabled it.
 * At Simple, CLOUD lost both sign-in fields: the module's own promise that this
 * is "never a capability lock" was false for the workspace where it mattered
 * most, and it stayed false because Simple was never the default.
 */
const EXEMPT = new Set(['view-library', 'view-bundle', 'view-cloud']);

/** Controls with no registry entry (file pickers, scrubbers) always show. */
function levelOf(id) { return PARAMS[id]?.level ?? 1; }

/**
 * The element a control's detail level is applied to.
 *
 * A `.row` is the unit the panels are built from — label plus control — and a
 * `.lk` is the same idea inside a legend, so hiding either hides a whole
 * setting rather than half of one. Anything else hides ITSELF and nothing
 * around it.
 *
 * That last clause is the whole point, and it is load-bearing. This used to
 * fall back to `el.parentElement`, and two of the controls with no `.row` are
 * `<input type="file">` pickers sitting inside the stage panel's `.btns` bar —
 * so the fallback made the ENTIRE EXPORT BAR one control's level row. Both
 * pickers are level 2, so choosing Simple — the level this module's own header
 * describes as the one for a first clip — deleted ● RECORD, ■ STOP, ⤓ .gif,
 * ⤓ .apng, ⤓ .webp, ⤓ frames, ⌗ STILL, ⇪ IMG, ⇪ VID and ✚ PRESET from VIDEO,
 * and the equivalent bars from SCREEN and TIMELINE. The module promises "never
 * a capability lock"; Simple was one, which is why it could not be the default.
 *
 * Exported because ui/palette.js has to ask the same question to know whether
 * jumping to a control needs the level raised first. Two copies of this rule
 * drifting apart is how Ctrl+K starts landing on invisible controls.
 */
export function levelRowOf(el) {
  if (!el) return null;
  /* A file picker is `display:none` markup for a button that is already on
     screen. It has no visible row to hide, and hiding what it sits in is the
     bug above. */
  if (el.type === 'file') return null;
  return el.closest('.row, .lk') || el;
}

export function getLevel() { return current; }

export function applyLevel(level) {
  current = Math.max(1, Math.min(3, Number(level) || 1));
  try { localStorage.setItem(STORAGE_KEY, String(current)); } catch { /* private mode */ }

  for (const view of document.querySelectorAll('.view')) {
    if (EXEMPT.has(view.id)) continue;
    for (const el of view.querySelectorAll('input, select, textarea')) {
      if (!el.id) continue;
      const row = levelRowOf(el);
      if (!row) continue;
      // A row can hold several controls; show it if ANY of them belongs here.
      // `row` is the control itself when it has no row of its own, and then
      // the only opinion that counts is that control's.
      const controls = row === el ? [el] : [...row.querySelectorAll('input, select, textarea')].filter((c) => c.id);
      const show = controls.some((c) => levelOf(c.id) <= current);
      row.classList.toggle('level-hidden', !show);
    }
    // Hide a whole fieldset once everything inside it is hidden.
    for (const fs of view.querySelectorAll('fieldset')) {
      const rows = [...fs.querySelectorAll('.row')];
      const anyVisible = rows.length === 0 || rows.some((r) => !r.classList.contains('level-hidden'));
      fs.classList.toggle('level-hidden', !anyVisible);
    }
  }

  const sel = $('complexity');
  if (sel && sel.value !== String(current)) sel.value = String(current);   /* dom-only: header chrome, not a document control */
  document.body.dataset.complexity = LEVEL_NAMES[current].toLowerCase();
  return current;
}

/** How many controls each level exposes — used by the tests and the UI hint. */
export function levelCounts() {
  const out = { 1: 0, 2: 0, 3: 0 };
  for (const p of Object.values(PARAMS)) for (let l = p.level; l <= 3; l++) out[l]++;
  return out;
}

export function initComplexity(onChange) {
  // A stored preference always wins: this changes what a NEW browser sees,
  // never what someone who has already chosen a level sees.
  let saved = 1;
  try { saved = parseInt(localStorage.getItem(STORAGE_KEY), 10) || 1; } catch { /* ignore */ }
  const sel = $('complexity');
  if (sel) {
    sel.addEventListener('change', () => { applyLevel(sel.value); onChange?.(current); });
  }
  applyLevel(saved);
  return { getLevel, applyLevel };
}
