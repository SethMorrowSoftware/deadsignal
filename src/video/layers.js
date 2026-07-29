/* Dead Signal Studio — video/layers.js
 *
 * Stacking more than one scene into a single clip.
 *
 * A clip was one scene (F-08). Most of the looks people actually want are two
 * or three signals on top of each other — terminal text over digital rain,
 * dead-air snow laid over a camera feed, scan bars across everything — and
 * with one scene per clip the only way to get there was to fake it inside a
 * scene's own draw code.
 *
 * The base scene stays the base scene: `v-scene` is layer zero, so every
 * existing project and every preset keeps rendering exactly as it did. Layers
 * are what goes ON TOP.
 *
 * Compositing is additive by default because that is what stacked analogue
 * signals do — two feeds mixed on a bus add light, they do not replace it.
 * That also solves the practical problem: 15 of the 22 scenes open by filling
 * their own background, so a layer drawn straight over the base would simply
 * erase it. Each layer renders on black and is blended, which makes its
 * background contribute nothing.
 */
import { hasVisibleLayers, normalizeLayers } from '../doc/layers.js';
import { getStore } from '../doc/session.js';
import { withSeedOffset } from '../core/rng.js';
import { SCENES } from './scenes.js';

export const LAYERS_PATH = 'layers.video';

/** Layers from the document. Empty when unbound (the headless suites). */
export function videoLayers() {
  const st = getStore();
  if (!st) return [];
  return normalizeLayers(st.get(LAYERS_PATH));
}

let _lc = null;
const layerCanvas = () => _lc || (_lc = document.createElement('canvas'));

/* Blends whose neutral colour is NOT black.
 *
 * A layer is drawn on black so an additive blend drops its background. That
 * works for screen, lighter and difference — black adds nothing, and
 * |base - 0| is base. It is a disaster for the other three: multiply against
 * black is black, so choosing Multiply crushed the entire frame to nothing
 * (measured: mean brightness 9 → 1) and Overlay and Hard Light darkened it
 * almost as badly. Three of the six blend modes on offer were traps.
 *
 * Keying the background out to transparent first fixes all three at once, and
 * costs a pixel pass only on the blends that actually need it. */
const NEEDS_KEY = new Set(['multiply', 'overlay', 'hard-light']);
/** Below this relative luminance a layer pixel counts as "did not draw". */
const KEY_LEVEL = 24;

function keyOutBackground(lx, W, H) {
  const img = lx.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722 < KEY_LEVEL) d[i + 3] = 0;
  }
  lx.putImageData(img, 0, 0);
}

/**
 * Draw the stack over whatever is already on ctx.
 *
 * Called from inside renderVideoFrame's transform, so shake and rotation apply
 * to the whole composite rather than sliding the base out from under it.
 */
export function drawLayers(ctx, W, H, cfg, t) {
  const layers = cfg.__layers;
  if (!hasVisibleLayers(layers)) return;

  const lc = layerCanvas();
  if (lc.width !== W) lc.width = W;
  if (lc.height !== H) lc.height = H;
  const lx = lc.getContext('2d');

  for (const L of layers) {
    if (!L.enabled || L.opacity <= 0) continue;
    const s = SCENES[L.scene];
    if (!s) continue;
    lx.setTransform(1, 0, 0, 1, 0, 0);
    lx.globalAlpha = 1;
    lx.globalCompositeOperation = 'source-over';
    // Black, not the recipe's background: the blend has to drop it, and an
    // additive blend drops black exactly.
    lx.fillStyle = '#000';
    lx.fillRect(0, 0, W, H);
    // The layer's own recipe: the base clip's, with whatever this layer
    // overrides written over the top. An empty override means inherit, so a
    // layer that sets nothing renders exactly as it always did.
    const lcfg = { ...cfg, bg: '#000' };
    if (L.text) lcfg.text = L.text;
    if (L.fg) lcfg.fg = L.fg;
    if (L.font > 0) lcfg.font = L.font;
    withSeedOffset(L.seed, () => s.draw(lx, W, H, lcfg, t));
    if (NEEDS_KEY.has(L.blend)) keyOutBackground(lx, W, H);

    ctx.save();
    ctx.globalAlpha = L.opacity;
    ctx.globalCompositeOperation = L.blend;
    ctx.drawImage(lc, 0, 0, W, H);
    ctx.restore();
  }
}

/** Layers captured into a timeline clip's recipe. */
export function captureLayers() { return normalizeLayers(videoLayers()); }
