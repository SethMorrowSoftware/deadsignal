/* Dead Signal Studio — video/automation.js
 *
 * Which video parameters can be keyframed, and how a track reaches the render.
 *
 * Only continuous parameters are here. Automating the scene, the output size or
 * the frame rate is meaningless — a clip cannot change resolution halfway — and
 * automating text would be a different feature (a subtitle track), not a curve.
 *
 * `field` is the name the parameter has on a rendered cfg, and `kind` says how
 * the raw control value becomes that field. Declaring the pair here rather than
 * re-deriving it means readVideoCfg() stays the single description of the
 * recipe: this table only overrides the handful of fields a track owns.
 */
import { clamp } from '../core/dom.js';
import { getStore } from '../doc/session.js';
import { evalTrack, hasKeys, normalizeTracks } from '../doc/automation.js';

/** kind: 'pct' = a 0-100 control that becomes 0..1 · 'num' = used as written */
export const AUTOMATABLE = [
  { id: 'v-scan',    field: 'scan',    kind: 'pct' },
  { id: 'v-noise',   field: 'noise',   kind: 'pct' },
  { id: 'v-vig',     field: 'vig',     kind: 'pct' },
  { id: 'v-flick',   field: 'flick',   kind: 'pct' },
  { id: 'v-glitch',  field: 'glitch',  kind: 'pct' },
  { id: 'v-chroma',  field: 'chroma',  kind: 'pct' },
  { id: 'v-bloom',   field: 'bloom',   kind: 'pct' },
  { id: 'v-persist', field: 'persist', kind: 'pct' },
  { id: 'v-mask',    field: 'mask',    kind: 'pct' },
  { id: 'v-hum',     field: 'hum',     kind: 'pct' },
  { id: 'v-track',   field: 'track',   kind: 'pct' },
  { id: 'v-shake',   field: 'shake',   kind: 'pct' },
  { id: 'v-roll',    field: 'roll',    kind: 'pct' },
  { id: 'v-corrupt', field: 'corrupt', kind: 'pct' },
  { id: 'v-cps',     field: 'cps',     kind: 'num' },
  { id: 'v-font',    field: 'font',    kind: 'num' },
];

const BY_ID = new Map(AUTOMATABLE.map((p) => [p.id, p]));

export function isAutomatable(id) { return BY_ID.has(id); }

export const AUTOMATION_PATH = 'automation.video';

/** Tracks from the document. Empty when unbound (the headless suites). */
export function videoTracks() {
  const st = getStore();
  if (!st) return {};
  return st.get(AUTOMATION_PATH) || {};
}

export function trackFor(id) {
  const t = videoTracks()[id];
  return Array.isArray(t) ? t : [];
}

/** Ids that currently have at least one key, in table order. */
export function automatedIds(tracks) {
  const t = tracks || videoTracks();
  return AUTOMATABLE.filter((p) => Array.isArray(t[p.id]) && t[p.id].length).map((p) => p.id);
}

/**
 * The cfg as it stands at time t.
 *
 * Returns the SAME object when nothing is automated, so the unautomated path —
 * which is every existing clip — allocates nothing per frame. Tracks ride on
 * cfg.__auto so that a timeline clip can carry its own captured automation
 * rather than picking up whatever the live tab happens to hold.
 */
export function cfgAt(cfg, t) {
  const tracks = cfg && cfg.__auto;
  if (!tracks || !hasKeys(tracks)) return cfg;
  let out = null;
  for (const p of AUTOMATABLE) {
    const raw = evalTrack(tracks[p.id], t);
    if (raw === undefined) continue;
    if (!out) out = { ...cfg };
    out[p.field] = p.kind === 'pct' ? clamp(raw / 100, 0, 1) : raw;
  }
  return out || cfg;
}

/** Automation captured into a timeline clip's recipe. */
export function captureTracks() { return normalizeTracks(videoTracks()); }

/**
 * A clip's own value for an automatable parameter.
 *
 * From the clip's recipe, deliberately — not from the live control. The VIDEO
 * tab describes a different clip, and keying its slider value onto this one is
 * exactly the confusion the per-clip inspector exists to end.
 */
export function clipParamValue(clip, id) {
  const rec = clip?.rec && typeof clip.rec === 'object' ? clip.rec : null;
  if (!rec || rec[id] == null) return undefined;
  const n = Number(rec[id]);
  return Number.isFinite(n) ? n : undefined;
}
