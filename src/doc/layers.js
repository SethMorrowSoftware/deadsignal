/* Dead Signal Studio — doc/layers.js
 *
 * The stored shape of a layer stack. Pure: no scene registry, no DOM, no store.
 *
 * Validation deliberately does NOT check that a scene exists. The document has
 * to survive a project written by a build that had a scene this one does not —
 * dropping the layer would silently discard the author's work, and the renderer
 * already skips a scene it cannot find. Keeping the name means the layer comes
 * back the moment the project is opened somewhere that has it.
 *
 * A layer used to be four fields — scene, blend, opacity, enabled — and
 * inherited the base clip's ENTIRE recipe for everything else. So every layer
 * drew the same words in the same colour at the same size, which is why the
 * panel had to warn that stacking Snow or Surveillance Cam "draws its own
 * centred title from the shared text, which repeats the base's message". The
 * override fields below are what make a layer its own signal rather than a
 * second copy of the first one.
 *
 * Every override is OPTIONAL and empty means inherit — '' for text and colour,
 * 0 for size and seed. A project written before these existed therefore reads
 * back as "inherit everything", which is exactly what it did.
 */

/* The stored name IS the canvas operation, which is why 'source-over' is spelled
   the way a canvas spells it rather than 'normal' — there is no translation step
   between this list and globalCompositeOperation, and inventing one is how a
   name that is not an operation reaches the context and is silently ignored,
   leaving whatever the previous draw set.
   BLEND_LABEL is the presentation half, and only the presentation half. */
export const BLENDS = ['source-over', 'screen', 'lighter', 'overlay', 'hard-light', 'difference', 'multiply'];
/**
 * The one blend that composites by ALPHA rather than by lightness.
 *
 * It was missing, and its absence was load-bearing in the wrong direction: a
 * clip whose buffer carries alpha — a title, a shape, anything keyed — can only
 * be composited correctly by source-over, because every other mode in this list
 * decides what to keep by comparing brightness. `screen` in particular keys the
 * black out for free, which is exactly right for a bright mark on a near-black
 * scene and exactly wrong for a title with a black outline (the outline goes)
 * or a green-screened foreground (every shadow on the subject goes).
 */
export const ALPHA_BLEND = 'source-over';
/** Reader-facing names. The picker is unreadable without them. */
export const BLEND_LABEL = {
  'source-over': 'normal — by alpha',
  screen: 'screen — drops black',
  lighter: 'lighter — adds',
  overlay: 'overlay',
  'hard-light': 'hard light',
  difference: 'difference',
  multiply: 'multiply — drops white',
};
/* Still 'screen', and deliberately: it is what a LAYER of a near-black scene
   wants, and it is what every clip and every layer already saved on disk was
   written with. Only the kinds that carry alpha default to ALPHA_BLEND, and
   they choose it explicitly where they are created. */
export const DEFAULT_BLEND = 'screen';
/* Digital rain, not snow. Snow draws its own centred title plate from the
   shared text, so defaulting to it meant the FIRST layer anyone added repeated
   the base's message in a black box in the middle of the frame — the feature
   looked broken on first use. A texture scene is what the panel recommends,
   so it is what the button should give you. */
export const DEFAULT_SCENE = 'matrix';

/** Past this a frame costs more to draw than the extra layer is worth. */
export const MAX_LAYERS = 6;
/** Longest per-layer text. Generous — a layer can be a whole caption block. */
export const MAX_LAYER_TEXT = 2000;
/** Highest seed variant. Enough to make every layer in a stack unique twice over. */
export const MAX_LAYER_SEED = 999;

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const clampInt = (v, lo, hi) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
};

export function makeLayer(l) {
  const scene = typeof l?.scene === 'string' && l.scene ? l.scene : DEFAULT_SCENE;
  const blend = BLENDS.includes(l?.blend) ? l.blend : DEFAULT_BLEND;
  const o = Number(l?.opacity);
  return {
    scene,
    blend,
    opacity: Number.isFinite(o) ? Math.min(1, Math.max(0, o)) : 0.5,
    enabled: l?.enabled !== false,
    // '' = use the base clip's text. Not trimmed: leading spaces can be layout.
    text: typeof l?.text === 'string' ? l.text.slice(0, MAX_LAYER_TEXT) : '',
    // '' = use the base clip's phosphor colour.
    fg: typeof l?.fg === 'string' && HEX.test(l.fg) ? l.fg : '',
    // 0 = use the base clip's font size.
    font: l?.font == null || l.font === '' ? 0 : clampInt(l.font, 0, 72),
    /* 0 = draw with the base clip's randomness, which for two copies of the
       same scene means drawing the same picture twice. Anything else
       re-addresses this layer's random streams, so a second Digital Rain is a
       DIFFERENT rain rather than the first one composited over itself. */
    seed: l?.seed == null || l.seed === '' ? 0 : clampInt(l.seed, 0, MAX_LAYER_SEED),
  };
}

export function normalizeLayers(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_LAYERS).map(makeLayer);
}

/** True when at least one layer would actually draw. */
export function hasVisibleLayers(layers) {
  return Array.isArray(layers) && layers.some((l) => l && l.enabled && l.opacity > 0);
}

/** True when this layer overrides anything the base would otherwise supply. */
export function hasOverrides(l) {
  return !!(l && (l.text || l.fg || l.font > 0 || l.seed > 0));
}
