/* Dead Signal Studio — video/filters.js
 *
 * Bridges the stored chain (doc/filters.js) to the renderer (fx/filters.js),
 * mirroring video/layers.js exactly: read from the document, capture into a
 * clip's recipe, and expose one draw entry point.
 */
import { normalizeFilters, scaleFilterPx } from '../doc/filters.js';
import { getStore } from '../doc/session.js';
import { FILTERS, applyFilterChain } from '../fx/filters.js';
import { set } from '../doc/store.js';

export const FILTERS_PATH = 'filters.video';

/** The chain from the document. Empty when unbound (the headless suites). */
export function videoFilters() {
  const st = getStore();
  if (!st) return [];
  return normalizeFilters(st.get(FILTERS_PATH));
}

/**
 * Run the author's chain over the finished frame.
 *
 * Called from renderVideoFrame AFTER applyCrtStack, and reading `cfg.__filters`
 * rather than the document, so a timeline clip filters with the chain it was
 * captured with instead of whatever the panel happens to show now.
 */
export function drawFilters(ctx, W, H, cfg, t) {
  const chain = cfg.__filters;
  if (!Array.isArray(chain) || !chain.length) return;
  applyFilterChain(ctx, ctx.canvas.width, ctx.canvas.height, chain, t);
}

/** The chain captured into a timeline clip's recipe. */
export function captureFilters() { return normalizeFilters(videoFilters()); }

/**
 * Carry the chain's pixel-denominated parameters through a change of format.
 *
 * The impure half of doc/filters.js's scaleFilterPx: it supplies the parameter
 * ranges out of the registry and commits the result as one ordinary undoable
 * edit. Nothing happens unless the chain actually holds a pixel measurement, so
 * an author with no filters — or with only colour ones — never sees an entry
 * appear in their undo stack for changing the delivery size.
 */
export function scaleFilterChainPx(factor) {
  const st = getStore();
  if (!st) return false;
  const next = scaleFilterPx(videoFilters(), factor, (id) => FILTERS[id]?.params);
  if (!next) return false;
  st.apply(set(FILTERS_PATH, next, { label: 'rescale filters' }));
  return true;
}
