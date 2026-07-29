/* Dead Signal Studio — onboarding/sample.js
 *
 * A finished-looking project, one click from a cold start.
 *
 * An empty studio with 152 controls is intimidating in a way that a working
 * example is not: the fastest way to learn what a tool does is to be handed
 * something that already works and start changing it. This one deliberately
 * exercises the parts that are least discoverable — a keyframed build, a
 * stacked layer, a panned audio bed — so they are visible rather than waiting
 * to be found.
 *
 * Built by OVERLAYING the live document rather than replacing it wholesale.
 * The document's defaults come from the markup, so a partial replacement would
 * leave every control this file does not mention showing whatever happened to
 * be there. Overlaying keeps it complete without duplicating ~150 defaults
 * that would then drift from index.html.
 */
import { safeClone } from '../doc/paths.js';

export const SAMPLE_NAME = 'Dead Air — sample';

/** Control values, per tab. Only what the sample actually sets. */
const VALUES = {
  video: {
    'v-scene': 'terminal',
    'v-text': 'ARCHIVE NODE 47\nSIGNAL DEGRADING\n> _',
    'v-w': '320', 'v-h': '240', 'v-fps': '12', 'v-dur': '10',
    'v-bg': '#02060a', 'v-fg': '#5fd9ff',
    'v-cps': '11', 'v-font': '16', 'v-cursor': true,
    'v-hud': 'CAM 47 // REC', 'v-tc': true, 'v-tcstart': '03:47:12',
    // Starts almost clean and decays — the keyframes below do the work.
    'v-scan': '18', 'v-noise': '10', 'v-vig': '35', 'v-flick': '6',
    'v-glitch': '0', 'v-chroma': '12', 'v-bloom': '20', 'v-persist': '25',
    'v-track': '0', 'v-shake': '0', 'v-roll': '0', 'v-corrupt': '0',
    'v-reveal': 'OBSERVE', 'v-revhold': '1.4',
    'v-fade': '0.6',
  },
  audio: {
    'a-dur': '10', 'a-fade': '0.8', 'a-channels': '2',
    'a-drone': true, 'a-drone-f': '62', 'a-drone-w': 'sawtooth',
    'a-drone-g': '30', 'a-drone-voices': '3', 'a-drone-det': '14',
    'a-drone-spread': '70', 'a-drone-pan': '0',
    'a-noise': true, 'a-noise-g': '14', 'a-noise-lp': '900', 'a-noise-pan': '-35',
    'a-pulse': true, 'a-pulse-n': '9', 'a-pulse-f': '520', 'a-pulse-rate': '1',
    'a-pulse-pan': '45',
    'fx-width': true, 'fx-width-a': '130',
    'fx-wow': true, 'fx-wow-d': '30',
    'fx-reverb': true, 'fx-reverb-d': '2.6',
    'fx-limit': true,
  },
  image: {
    'i-tpl': 'bsod',
    'i-title': 'EREBUS',
    'i-body': 'EREBUS.EXE has performed an illegal operation.\nIt will not be shut down.',
  },
};

/* The decay: barely-there at the start, failing by the end. Two keys each,
   because the point is to show what a ramp looks like, not to be clever. */
const AUTOMATION = {
  'v-scan':  [{ t: 0, v: 18, e: 'ease' },   { t: 10, v: 62 }],
  'v-noise': [{ t: 0, v: 10, e: 'ease' },   { t: 10, v: 55 }],
  'v-track': [{ t: 0, v: 0, e: 'hold' },    { t: 6, v: 0, e: 'ease' }, { t: 10, v: 48 }],
  'v-glitch':[{ t: 0, v: 0, e: 'hold' },    { t: 7, v: 0, e: 'linear' }, { t: 10, v: 40 }],
};

/* One extra scene over the base, so the stack is visible immediately.
   Digital rain rather than snow: several scenes (snow, camera, breach…) draw
   their own centred title plate from the shared text, so stacking one repeats
   the base's message in the middle of the frame. Rain is pure texture. */
const LAYERS = [
  { scene: 'matrix', blend: 'screen', opacity: 0.30, enabled: true },
];

/**
 * The sample, as a complete document.
 * @param {object} current the live document to overlay
 */
export function sampleProject(current) {
  const doc = safeClone(current);
  doc.meta = { ...doc.meta, name: SAMPLE_NAME };
  doc.seed = 1947;
  for (const [tab, values] of Object.entries(VALUES)) {
    doc.tabs[tab] = { ...(doc.tabs[tab] || {}), ...values };
  }
  doc.automation = { video: safeClone(AUTOMATION) };
  doc.layers = { video: safeClone(LAYERS) };
  // Deliberately no timeline clips and no library: the sample should leave the
  // author one Record away from their first file, not hand them someone else's.
  doc.timeline = { clips: [] };
  doc.library = [];
  return doc;
}
