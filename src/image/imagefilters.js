/* Dead Signal Studio — image/imagefilters.js
 *
 * Bridges the stored image filter chain (filters.image) to the renderer, exactly
 * as video/filters.js bridges the video one: read from the document, capture
 * into a still's recipe, and expose one draw entry point. The registry is the
 * same as the video tab's (fx/filters.js), so a still gets the whole 55-filter
 * shelf — colour grades, warps, halftones, the lot — reorderable and undoable
 * like everything else.
 *
 * A still has no time in it, so the chain is always evaluated at t=0. That makes
 * the time-varying filters (a VHS head-switch, a light-leak flicker) render
 * their t=0 frame, which is the honest reading of "one still".
 */
import { normalizeFilters, scaleFilterPx } from '../doc/filters.js';
import { getStore } from '../doc/session.js';
import { FILTERS, applyFilterChain } from '../fx/filters.js';
import { set } from '../doc/store.js';

export const IMAGE_FILTERS_PATH = 'filters.image';

/** The chain from the document. Empty when unbound (the headless suites). */
export function imageFilters() {
  const st = getStore();
  if (!st) return [];
  return normalizeFilters(st.get(IMAGE_FILTERS_PATH));
}

/**
 * Run the author's chain over the finished still.
 *
 * Reads `cfg.__filters` rather than the document, so a still captured into a
 * sequence filters with the chain it was captured with instead of whatever the
 * SCREEN tab happens to show now — the same contract drawFilters keeps for video.
 */
export function drawImageFilters(ctx, W, H, cfg) {
  const chain = cfg.__filters;
  if (!Array.isArray(chain) || !chain.length) return;
  applyFilterChain(ctx, ctx.canvas.width, ctx.canvas.height, chain, 0);
}

/** The chain captured into a still's recipe. */
export function captureImageFilters() { return normalizeFilters(imageFilters()); }

/** Carry the chain's pixel-denominated parameters through a change of format. */
export function scaleImageFilterChainPx(factor) {
  const st = getStore();
  if (!st) return false;
  const next = scaleFilterPx(imageFilters(), factor, (id) => FILTERS[id]?.params);
  if (!next) return false;
  st.apply(set(IMAGE_FILTERS_PATH, next, { label: 'rescale image filters' }));
  return true;
}
