/* Dead Signal Studio — audio/solo.js
 *
 * Solo: hear one layer without turning twenty-five others off.
 *
 * The AUDIO tab stacks twenty-six sources into one mix. When something in that
 * mix is wrong, the only way to find it was to uncheck layers one at a time
 * until the noise stopped, then check them all back on and hope you remembered
 * the state you started from. That is not debugging, it is bookkeeping, and it
 * loses your arrangement every time you do it.
 *
 * Solo is the mixer answer: mark the layers you want to hear, render, and
 * everything else sits down. Nothing about the arrangement changes — the
 * enable checkboxes keep whatever they were set to, so clearing solo restores
 * the full mix exactly, with no memory of what you clicked.
 *
 * WHERE IT APPLIES. Solo is a mask over the config, applied at the end of
 * readAudioCfg(). That placement is deliberate: everything downstream of the
 * config — the auto-extend that lengthens a render to fit a morse message, the
 * layers' own `needs()`, buildLayers, the active-layer readouts — sees the
 * masked config and agrees with it. Soloing the drone therefore does not
 * stretch the render to six and a half seconds because dial-up is *checked*;
 * dial-up is not playing, so it does not get a vote.
 *
 * THE FOOTGUN, NAMED. In a DAW, solo affects monitoring and never the bounce.
 * Here there is no separate monitor path — the render IS the export — so a
 * solo left on WILL export a soloed mix. Rather than pretend otherwise, the
 * studio is loud about it: the button strip carries a live count, the audio
 * panel shows a SOLO banner, and every render logs exactly which sources were
 * audible. See `soloNotice()`, which is what the engine prints.
 *
 * This module is pure — a list and two functions over it. The DOM half lives
 * in ui/solo.js.
 */
import { AUDIO_LAYERS, TOGGLE } from './layers.js';

/** Where the solo set lives in the document. */
export const SOLO_PATH = 'audio.solo';

/* Twenty-six is already more than fits on a screen; a cap stops a hand-edited
   project from carrying an unbounded list, the same way regions and clips are
   capped. Anything past it is dropped, not an error. */
export const MAX_SOLO = 32;

/* The ten hand-wired sources. Their enable flag on the config happens to be the
   same word as their control's id suffix (`a-drone` ↔ cfg.drone) for all ten,
   but writing that as a rule would be a coincidence promoted to an invariant —
   so each one names its own flag and the tests check the pairing holds. */
const BUILTIN = [
  ['drone', 'DRONE', 'drone'],
  ['noise', 'NOISE BED', 'noise'],
  ['pulse', 'PULSE TRAIN', 'pulse'],
  ['morse', 'MORSE', 'morse'],
  ['sample', 'IMPORTED CLIP', 'sample'],
  ['sub', 'SUB-BASS', 'sub'],
  ['heart', 'HEARTBEAT', 'heart'],
  ['geiger', 'GEIGER', 'geiger'],
  ['dtmf', 'DTMF DIAL', 'dtmf'],
  ['dial', 'DIAL-UP', 'dial'],
];

/**
 * Every soloable source, hand-wired and registry alike, in panel order.
 *
 * `toggle` is the id of the source's enable checkbox — which is all ui/solo.js
 * needs to find where to put the button, for both the ten written into
 * index.html and the sixteen generated at boot. `silence(cfg)` is how the mask
 * turns one off, and it is per-source because the two families store their
 * enabled-ness in different shapes.
 */
export const SOLO_SOURCES = [
  ...BUILTIN.map(([key, name, flag]) => ({
    key, name, toggle: `a-${key}`, kind: 'builtin', flag,
    silence(cfg) { cfg[flag] = false; },
  })),
  ...AUDIO_LAYERS.map((layer) => ({
    key: layer.id, name: layer.name, toggle: TOGGLE(layer.id), kind: 'layer',
    silence(cfg) { if (cfg.layers && cfg.layers[layer.id]) cfg.layers[layer.id].on = false; },
  })),
];

const BY_KEY = new Map(SOLO_SOURCES.map((s) => [s.key, s]));

/** The source with this key, or undefined. */
export const soloSource = (key) => BY_KEY.get(key);

/**
 * A stored solo set, cleaned up: known keys only, no duplicates, capped, and in
 * the panel's own order so the readout does not depend on click order.
 *
 * Unknown keys are dropped rather than rejected, and that direction matters: a
 * project written by a newer build that solos a layer this one does not have
 * degrades to "fewer things soloed", never to "everything silent".
 */
export function normalizeSolo(list) {
  if (!Array.isArray(list)) return [];
  const want = new Set();
  for (const k of list) if (typeof k === 'string' && BY_KEY.has(k)) want.add(k);
  const out = [];
  for (const s of SOLO_SOURCES) if (want.has(s.key)) out.push(s.key);
  return out.slice(0, MAX_SOLO);
}

/** Is this key in the (normalized) set? */
export const isSoloed = (list, key) => normalizeSolo(list).includes(key);

/** The set with `key` flipped, ready to commit. */
export function toggleSoloKey(list, key) {
  const cur = normalizeSolo(list);
  return cur.includes(key) ? cur.filter((k) => k !== key) : normalizeSolo([...cur, key]);
}

/**
 * Silence everything the solo set does not name.
 *
 * Mutates and returns the config it is given — it is called on a freshly read
 * one inside readAudioCfg(), never on anything shared. An empty (or entirely
 * unknown) set is a no-op, which is what makes "no solo" and "solo nothing"
 * the same harmless state rather than a mix of silence.
 */
export function applySolo(cfg, list) {
  const keep = normalizeSolo(list);
  if (!cfg || !keep.length) return cfg;
  const set = new Set(keep);
  for (const s of SOLO_SOURCES) if (!set.has(s.key)) s.silence(cfg);
  return cfg;
}

/**
 * Soloed sources whose own enable state is off, by display name.
 *
 * Solo silences the OTHERS; it never turns a source on. A key in this list
 * therefore renders as silence, and without saying so the user is sent hunting
 * through twenty-six layers for a bug that is one unchecked box. Reads the
 * post-applySolo config: kept keys are exactly the ones the mask left alone,
 * so their flags still reflect the checkboxes.
 */
export function soloDisabledNames(cfg, list) {
  const keep = normalizeSolo(list);
  if (!cfg || !keep.length) return [];
  const out = [];
  for (const k of keep) {
    const s = BY_KEY.get(k);
    const on = s.kind === 'builtin'
      ? !!cfg[s.flag]
      : !!(cfg.layers && cfg.layers[s.key] && cfg.layers[s.key].on);
    if (!on) out.push(s.name);
  }
  return out;
}

/**
 * The line the engine logs on a soloed render, or '' when nothing is soloed.
 *
 * Named as a function rather than built at the call site because it is the
 * studio's one defence against exporting a soloed mix by accident, and a
 * defence that lives in a template string somewhere is a defence that gets
 * reworded until it stops warning anyone.
 *
 * Given the config it also names any soloed source that is not enabled —
 * "only DRONE is audible" is a lie when the drone's checkbox is off.
 */
export function soloNotice(list, cfg) {
  const keep = normalizeSolo(list);
  if (!keep.length) return '';
  const names = keep.map((k) => BY_KEY.get(k)?.name || k);
  let msg = `SOLO: only ${names.join(', ')} ${keep.length === 1 ? 'is' : 'are'} audible — `
    + 'everything else is muted for this render (and for anything exported from it).';
  const off = soloDisabledNames(cfg, keep);
  if (off.length) {
    msg += ` BUT ${off.join(', ')} ${off.length === 1 ? 'is' : 'are'} soloed without being`
      + ' enabled — solo never turns a source on, so '
      + (off.length === keep.length ? 'this render will be SILENT.'
                                    : 'only the enabled soloed sources will sound.');
  }
  return msg;
}
