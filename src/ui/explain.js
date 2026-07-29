/* Dead Signal Studio — ui/explain.js
 *
 * Press ? (or the ? button) to arm Explain mode, then click or focus any
 * control to be told, in plain language, what it does to the picture or the
 * sound — plus its unit and range.
 *
 * 137 controls with names like "Persist" and "Roll" are not self-describing,
 * and a title= tooltip is invisible to keyboard and touch users. This is the
 * documented answer to "what does this actually do".
 */
import { $ } from '../core/dom.js';
import { PARAMS, rangeOf } from './params.js';

let armed = false, pop = null, btn = null;

function ensurePop() {
  if (pop) return pop;
  pop = document.createElement('div');
  pop.className = 'explain-pop';
  pop.id = 'explain-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-live', 'polite');
  pop.hidden = true;
  document.body.appendChild(pop);
  return pop;
}

function describe(el) {
  const info = PARAMS[el.id];
  if (!info) return null;
  const range = rangeOf(el);
  const value = el.type === 'checkbox' ? (el.checked ? 'on' : 'off') : el.value;
  return { ...info, range, value };
}

function show(el) {
  const d = describe(el);
  const p = ensurePop();
  p.replaceChildren();
  if (!d) {
    const t = document.createElement('p'); t.className = 'ex-body';
    t.textContent = 'No description for this control yet.';
    p.appendChild(t);
  } else {
    const h = document.createElement('h3'); h.className = 'ex-title'; h.textContent = d.label;
    const b = document.createElement('p'); b.className = 'ex-body'; b.textContent = d.explain;
    const m = document.createElement('p'); m.className = 'ex-meta';
    const bits = [];
    if (d.range) bits.push(`Range: ${d.range}`);
    if (d.unit) bits.push(`Unit: ${d.unit}`);
    bits.push(`Now: ${d.value === '' ? '(empty)' : d.value}`);
    bits.push(['', 'Simple', 'Studio', 'Deep'][d.level] || '');
    m.textContent = bits.filter(Boolean).join(' · ');
    p.append(h, b, m);
  }
  const r = el.getBoundingClientRect();
  p.hidden = false;
  const pr = p.getBoundingClientRect();
  let top = r.bottom + 8;
  if (top + pr.height > window.innerHeight - 8) top = Math.max(8, r.top - pr.height - 8);
  p.style.top = `${top}px`;
  p.style.left = `${Math.min(Math.max(8, r.left), window.innerWidth - pr.width - 8)}px`;
}

function hide() { if (pop) pop.hidden = true; }

export function setArmed(on) {
  armed = !!on;
  document.body.classList.toggle('explain-armed', armed);
  if (btn) {
    btn.setAttribute('aria-pressed', armed ? 'true' : 'false');
    btn.classList.toggle('active', armed);
  }
  if (!armed) hide();
}

export function isArmed() { return armed; }

export function initExplain() {
  ensurePop();
  btn = $('explain-toggle');
  if (btn) btn.addEventListener('click', () => setArmed(!armed));

  // Clicking a control while armed explains it instead of operating it.
  document.addEventListener('click', (e) => {
    if (!armed) return;
    const el = e.target.closest('input, select, textarea');
    if (!el || !el.id) { if (!e.target.closest('.explain-pop')) hide(); return; }
    e.preventDefault();
    e.stopPropagation();
    show(el);
  }, true);

  // Focusing a control while armed explains it too, so the whole feature is
  // reachable from the keyboard rather than being a mouse-only affordance.
  document.addEventListener('focusin', (e) => {
    if (!armed) return;
    const el = e.target;
    if (el && el.id && PARAMS[el.id]) show(el);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && armed) { setArmed(false); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (e.key === '?') { e.preventDefault(); setArmed(!armed); }
  });

  return { setArmed, isArmed, show, hide };
}

/**
 * Coverage of the registry against the controls actually on the page.
 *
 * Controls inside a [data-generated] container are excluded, and that is a
 * statement about what the registry is FOR rather than a hole in it. The
 * layers, filters, keyframes and variables panels build their controls at
 * runtime — one row per layer, one field per filter parameter — so their ids
 * are positional (`lyr-font-0`, `flt-2-radius`) and cannot be enumerated ahead
 * of time. They carry their own label and description at the point of use,
 * written from the same declaration that creates them, which is the only way
 * that copy can stay correct as rows come and go. The registry covers the
 * fixed controls declared in the markup, and this counts exactly those.
 */
export function explainCoverage() {
  const ids = [...document.querySelectorAll('#view-video, #view-audio, #view-image, #view-timeline')]
    .flatMap((v) => [...v.querySelectorAll('input,select,textarea')])
    .filter((e) => e.id && e.type !== 'file' && e.type !== 'hidden' && !e.closest('[data-generated]'))
    .map((e) => e.id);
  const missing = ids.filter((id) => !PARAMS[id]);
  return { total: ids.length, missing };
}
