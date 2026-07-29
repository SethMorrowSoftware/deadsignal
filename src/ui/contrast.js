/* Dead Signal Studio — ui/contrast.js
 *
 * High-contrast mode for the tool's own interface.
 *
 * The CRT overlay and the phosphor glow are the point of the normal look, and
 * they are also the two things that cost the most contrast. Rather than
 * softening them for everyone, this switches them off entirely for anyone who
 * needs it.
 *
 * It affects the CHROME only. Rendered media is untouched, which is what makes
 * this usable rather than a compromise on the output — an author who needs
 * high contrast to read the interface still ships the same degraded picture as
 * everyone else.
 *
 * Stored as a preference, not in the project: it describes the person at the
 * keyboard, not the work, and it would be wrong for it to travel to a
 * collaborator in a project file.
 */
import { $ } from '../core/dom.js';
import { lsGet, lsSet } from '../core/recipes.js';

const KEY = 'deadsignal.studio.contrast';

export function getContrast() {
  return lsGet(KEY, null) === 'high' ? 'high' : 'normal';
}

export function setContrast(mode) {
  const high = mode === 'high';
  document.documentElement.setAttribute('data-contrast', high ? 'high' : 'normal');
  lsSet(KEY, high ? 'high' : 'normal');
  const sel = $('contrast');
  if (sel && sel.value !== (high ? 'high' : 'normal')) sel.value = high ? 'high' : 'normal';   /* dom-only: header chrome, not a document control */
  return high ? 'high' : 'normal';
}

export function initContrast() {
  const sel = $('contrast');
  // Honour the OS setting on a first visit, then remember whatever is chosen.
  const stored = lsGet(KEY, null);
  const prefersMore = typeof matchMedia === 'function'
    && matchMedia('(prefers-contrast: more)').matches;
  setContrast(stored || (prefersMore ? 'high' : 'normal'));
  sel?.addEventListener('change', () => setContrast(sel.value));
}
