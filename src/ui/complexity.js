/* Dead Signal Studio — ui/complexity.js
 *
 * Simple / Studio / Deep. A view filter over the same document — never a
 * capability lock. Nothing is disabled, nothing stops working, and the values
 * of hidden controls still apply; they are simply not shown.
 *
 * 137 controls presented at once is the reason a first-time user cannot tell
 * "Scene" (changes everything) from "Hum bar" (a subtle post effect). Simple
 * shows the dozen that matter first, including the macros.
 */
import { $ } from '../core/dom.js';
import { PARAMS } from './params.js';

export const LEVEL_NAMES = { 1: 'Simple', 2: 'Studio', 3: 'Deep' };
const STORAGE_KEY = 'deadsignal.complexity';

let current = 2;

/** Controls with no registry entry (file pickers, scrubbers) always show. */
function levelOf(id) { return PARAMS[id]?.level ?? 1; }

export function getLevel() { return current; }

export function applyLevel(level) {
  current = Math.max(1, Math.min(3, Number(level) || 2));
  try { localStorage.setItem(STORAGE_KEY, String(current)); } catch { /* private mode */ }

  for (const view of document.querySelectorAll('.view')) {
    for (const el of view.querySelectorAll('input, select, textarea')) {
      if (!el.id) continue;
      const row = el.closest('.row') || el.parentElement;
      if (!row) continue;
      // A row can hold several controls; show it if ANY of them belongs here.
      const controls = [...row.querySelectorAll('input, select, textarea')].filter((c) => c.id);
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
  let saved = 2;
  try { saved = parseInt(localStorage.getItem(STORAGE_KEY), 10) || 2; } catch { /* ignore */ }
  const sel = $('complexity');
  if (sel) {
    sel.addEventListener('change', () => { applyLevel(sel.value); onChange?.(current); });
  }
  applyLevel(saved);
  return { getLevel, applyLevel };
}
