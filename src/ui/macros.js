/* Dead Signal Studio — ui/macros.js
 *
 * One dial that moves many correlated parameters along an authored curve.
 *
 * Analogue degradation is not one setting, it is thirteen that only look right
 * together. Exposing all thirteen as peer sliders — which is what the tool did
 * — asks every new user to already know the answer. GRIME is the answer,
 * written down once by someone who does.
 *
 * Macros are a convenience over the real parameters, never a replacement: they
 * write the same document paths a human would, so the individual controls stay
 * live, the result is inspectable, and undo sees one entry rather than thirteen.
 */
import { $ } from '../core/dom.js';
import { set } from '../doc/store.js';
import { getStore, pathFor } from '../doc/session.js';

/** Sample a piecewise-linear curve of stops at t in 0..1. */
function sample(stops, t) {
  if (stops.length === 1) return stops[0];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  const f = x - i;
  return stops[i] + (stops[i + 1] - stops[i]) * f;
}

/* Curves are deliberately non-linear. Real wear does not arrive evenly: a
   little tracking error is invisible, then suddenly it is the whole picture. */
export const MACROS = {
  grime: {
    id: 'v-macro-grime', tab: 'video', label: 'GRIME',
    explain: 'One dial for the whole analogue-decay stack — scanlines, static, vignette, tracking, chroma and flicker together, along a curve that stays believable. Every individual control underneath stays live; this just sets them all at once.',
    targets: {
      'v-scan':    [22, 34, 44, 52, 60],
      'v-noise':   [0,  10, 26, 48, 74],
      'v-vig':     [30, 42, 54, 64, 74],
      'v-flick':   [0,  4,  10, 18, 30],
      'v-chroma':  [0,  6,  14, 26, 42],
      'v-track':   [0,  2,  10, 28, 58],
      'v-glitch':  [0,  3,  9,  18, 34],
      'v-bloom':   [8,  14, 20, 26, 34],
      'v-hum':     [0,  4,  10, 18, 28],
      'v-shake':   [0,  1,  4,  9,  17],
    },
  },
  decay: {
    id: 'v-macro-decay', tab: 'video', label: 'DECAY',
    explain: 'Generation loss — the look of a tape copied from a copy. Pushes the artefacts that compound with each dub (tracking, chroma bleed, persistence, roll) without simply making everything noisier.',
    targets: {
      'v-track':   [0,  6,  18, 38, 66],
      'v-chroma':  [0,  10, 22, 38, 58],
      'v-persist': [0,  8,  18, 30, 46],
      'v-roll':    [0,  0,  4,  14, 32],
      'v-noise':   [0,  6,  16, 30, 50],
      'v-mask':    [0,  4,  10, 16, 24],
    },
  },
  warmth: {
    id: 'a-macro-warmth', tab: 'audio', label: 'WARMTH',
    explain: 'Tape character in one dial: wow and flutter, saturation and a softer top end. Low values are a well-kept machine; high values are one that has been in a damp room for thirty years.',
    targets: {
      'fx-wow':    [0,  1,  1,  1,  1],          // booleans: >0.5 is on
      'fx-wow-d':  [0,  18, 34, 52, 76],
      'fx-dist':   [0,  0,  1,  1,  1],
      'fx-dist-d': [0,  8,  20, 34, 52],
      'a-noise':   [0,  0,  1,  1,  1],
      'a-noise-g': [0,  4,  10, 18, 28],
    },
  },
  degrade: {
    id: 'a-macro-degrade', tab: 'audio', label: 'DEGRADE',
    explain: 'Damage rather than age: bit-crushing, band-limiting and a rising noise floor. Turns a clean render into something recovered from failing media.',
    targets: {
      'fx-crush':   [0,  1,  1,  1,  1],
      'fx-crush-b': [16, 12, 10, 8,  5],
      'fx-phone':   [0,  0,  0,  1,  1],
      'a-noise':    [0,  1,  1,  1,  1],
      'a-noise-g':  [0,  8,  16, 26, 40],
      'fx-ring':    [0,  0,  0,  0,  1],
    },
  },
};

/* Which targets are switches rather than dials. Declared rather than read off
   the DOM: with no document bound (or the control missing) the type lookup
   returned undefined and the stop was written as the STRING "0" — and chk()
   reads "0" as truthy, so a macro at zero strength would have switched
   everything on. A macro's own table is the right place to say what a target
   is. */
const BOOLEAN_TARGETS = new Set([
  'fx-wow', 'fx-dist', 'fx-crush', 'fx-phone', 'fx-ring', 'a-noise',
]);

/** Commands a macro at strength 0..100 would write. Booleans threshold at 0.5. */
export function macroCommands(name, strength) {
  const m = MACROS[name];
  if (!m) return [];
  const t = Math.max(0, Math.min(100, Number(strength) || 0)) / 100;
  const cmds = [];
  for (const [id, stops] of Object.entries(m.targets)) {
    const path = pathFor(id);
    if (!path) continue;
    const el = $(id);
    const isBool = BOOLEAN_TARGETS.has(id) || (el && el.type === 'checkbox');
    const raw = sample(stops, t);
    const value = isBool ? raw > 0.5 : String(Math.round(raw));
    // Keyed on the macro CONTROL's id, which is what the document binding uses
    // for the dial itself. Two different keys meant the dial's own write and
    // the ten writes it triggers landed in two undo entries, so undoing a macro
    // took two presses and the first one left the dial disagreeing with the
    // sliders it had just moved.
    cmds.push(set(path, value, { coalesceKey: m.id, label: `${m.label} ${Math.round(t * 100)}` }));
  }
  return cmds;
}

/**
 * Apply a macro. One batched command, so it is a single undo entry and a drag
 * across the dial coalesces rather than filling the history.
 */
export function applyMacro(name, strength) {
  const store = getStore();
  if (!store) return 0;
  const cmds = macroCommands(name, strength);
  if (!cmds.length) return 0;
  const macroPath = pathFor(MACROS[name].id);
  if (macroPath) cmds.unshift(set(macroPath, String(strength), { coalesceKey: MACROS[name].id, label: `${MACROS[name].label}` }));
  store.apply(cmds);
  return cmds.length;
}

export function initMacros(onApplied) {
  for (const [name, m] of Object.entries(MACROS)) {
    const el = $(m.id);
    if (!el) continue;
    el.addEventListener('input', () => { applyMacro(name, el.value); onApplied?.(m.tab); });
  }
}
