/* Dead Signal Studio — core/formats.js
 *
 * Delivery sizes and aspect ratios, in one table three tabs read.
 *
 * The studio was built to make campaign assets that play inside a fake Windows
 * 95 desktop, so every size in it was small and landscape and the ceiling was
 * 1280×1024. None of that survives contact with somewhere the work actually
 * gets seen: Shorts, TikTok and Reels are 1080×1920, and there was no way to
 * express that — not the ratio, and not the resolution.
 *
 * Two controls rather than one, because they answer two different questions.
 * ASPECTS keeps the frame's shape and derives the other side from the side you
 * already chose; FORMATS sets both, because "make this a Short" means 1080×1920
 * and not "9:16 of whatever width happens to be in the box".
 */

/** Encoders want even dimensions, and so does every codec here. */
export const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/* 1920 on both axes, so 1080×1920 is reachable in portrait and 1920×1080 in
   landscape. Above this a 2× supersampled frame is 3840² × 4 bytes of scratch
   canvas per buffer, and there are seven of them. */
export const MAX_DIM = 1920;
export const MIN_W = 64;
export const MIN_H = 48;

/** Shape only. Picking one keeps the frame you have and reshapes it. */
export const ASPECTS = [
  { id: '', label: 'custom' },
  { id: '4:3', label: '4:3 · CRT' },
  { id: '16:9', label: '16:9 · widescreen' },
  { id: '1:1', label: '1:1 · square' },
  { id: '9:16', label: '9:16 · vertical' },
  { id: '4:5', label: '4:5 · feed portrait' },
  { id: '3:4', label: '3:4 · tall CRT' },
  { id: '21:9', label: '21:9 · ultrawide' },
];

/**
 * Size AND shape. `label` names the destination rather than the numbers,
 * because an author picking one is thinking "this is going on TikTok".
 */
export const FORMATS = [
  { id: '', label: '— custom —' },
  { id: 'vertical', label: 'Shorts / TikTok / Reels · 1080×1920', w: 1080, h: 1920, ratio: '9:16' },
  { id: 'vertical-sd', label: 'Vertical, lighter · 720×1280', w: 720, h: 1280, ratio: '9:16' },
  { id: 'portrait', label: 'Feed portrait · 1080×1350', w: 1080, h: 1350, ratio: '4:5' },
  { id: 'square', label: 'Square post · 1080×1080', w: 1080, h: 1080, ratio: '1:1' },
  { id: 'wide1080', label: 'YouTube 1080p · 1920×1080', w: 1920, h: 1080, ratio: '16:9' },
  { id: 'wide720', label: 'YouTube 720p · 1280×720', w: 1280, h: 720, ratio: '16:9' },
  { id: 'crt', label: 'CRT 4:3 · 640×480', w: 640, h: 480, ratio: '4:3' },
  { id: 'vhs', label: 'Small / VHS · 320×240', w: 320, h: 240, ratio: '4:3' },
];

const byId = new Map(FORMATS.map((f) => [f.id, f]));
export const formatById = (id) => byId.get(id) || null;

/** The format whose dimensions these are, or '' when they match none. */
export function formatFor(w, h) {
  const f = FORMATS.find((x) => x.w === w && x.h === h);
  return f ? f.id : '';
}

export function fillSelect(sel, list) {
  if (!sel) return;
  sel.replaceChildren();
  for (const item of list) {
    const o = document.createElement('option');
    o.value = item.id;
    o.textContent = item.label;
    sel.appendChild(o);
  }
}

/**
 * The frame `w`×`h` reshaped to `ratio`, staying inside the size limits.
 *
 * Deriving the other side from the width alone was wrong in one direction and
 * silently so: at 1280 wide, 9:16 wants 2276 tall, and assigning that to a
 * number input does NOT clamp it — `max` only governs validation and the
 * spinner. The document kept 2276, readVideoCfg clamped the render to the old
 * ceiling, and the result was a frame that was not the ratio the picker
 * claimed, with the control and the picture disagreeing about it. Deriving from
 * whichever side has room keeps the ratio exact.
 */
export function fitRatio(ratio, w, h, { maxW = MAX_DIM, maxH = MAX_DIM } = {}) {
  const [rw, rh] = String(ratio || '').split(':').map(Number);
  if (!(rw > 0 && rh > 0)) return { w, h };
  let W = Math.max(1, w), H = Math.round(W * rh / rw);
  if (H > maxH) { H = maxH; W = Math.round(H * rw / rh); }
  if (W > maxW) { W = maxW; H = Math.round(W * rh / rw); }
  return { w: even(W), h: even(H) };
}
