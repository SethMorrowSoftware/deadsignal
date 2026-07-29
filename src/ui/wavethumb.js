/* Dead Signal Studio — ui/wavethumb.js
 *
 * The little waveform on an audio block.
 *
 * As a cached data-URI painted into `background-image`, never as a canvas child
 * of the block. renderTrack() rewrites the lane's innerHTML on every commit,
 * and a trim drag commits on every pointermove — a canvas child would be
 * destroyed and repainted a hundred times a second, and it would have to be
 * re-rendered from the samples each time because the element it drew into is
 * gone. A string survives the rebuild for free, and `background-size:100% 100%`
 * makes it stretch with the zoom rather than needing a repaint per scale.
 *
 * Rendering is async (a decode, then an offline render), so the first paint of a
 * new sound has no thumbnail. It arrives a moment later and is written onto the
 * live block by selector — deliberately not by re-rendering the whole lane,
 * which would be a rebuild triggered by a repaint.
 */
import { renderSource } from '../audio/bed.js';
import { paintWave, peaksOf } from '../audio/peaks.js';
import { audioRev } from '../audio/ui.js';

const THUMB_W = 240;
const THUMB_H = 40;

/* key → dataURI. Keyed on everything that changes the picture, including the
   revision of the "last audio render", because that choice is a live reference
   that is rescaled in place with no event to listen for. */
const _thumbs = new Map();
/* Keys currently being rendered, so a lane that re-renders sixty times while
   one decode is in flight does not start sixty decodes. */
const _pending = new Set();

/** The cache key, also stamped on the block so an async paint finds its own. */
export const thumbKeyOf = (c) => (c && c.source
  ? `${c.source}|${c.in}|${c.out}|${c.loop ? 1 : 0}|${audioRev}` : '');

/** The cached thumbnail for this sound, or '' if it is not ready yet. */
export function waveThumb(c) {
  if (!c || !c.source) return '';
  const k = thumbKeyOf(c);
  const hit = _thumbs.get(k);
  if (hit) return hit;
  if (!_pending.has(k)) { _pending.add(k); void build(c, k); }
  return '';
}

async function build(c, k) {
  try {
    const seconds = Math.max(0.1, (c.out ?? 0) - (c.in ?? 0));
    const buf = await renderSource(c.source, Math.min(seconds, 60), {
      offset: Math.max(0, c.in ?? 0), loop: !!c.loop,
    });
    if (!buf) return;
    const chans = [];
    for (let i = 0; i < buf.numberOfChannels; i++) chans.push(buf.getChannelData(i));
    const cv = document.createElement('canvas');
    cv.width = THUMB_W;
    cv.height = THUMB_H;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    paintWave(ctx, THUMB_W, THUMB_H, peaksOf(chans, THUMB_W), {
      stroke: 'rgba(255,180,84,0.85)', fill: 'rgba(255,180,84,0.25)',
    });
    const uri = cv.toDataURL('image/png');
    _thumbs.set(k, uri);
    /* Painted straight onto whichever blocks are showing this sound. Calling
       renderTrack() here instead would mean a decode finishing mid-drag rebuilt
       the lane under the author's pointer. */
    for (const el of document.querySelectorAll(`.tl-aclip[data-thumb-key="${CSS.escape(k)}"]`)) {
      el.style.backgroundImage = `url("${uri}")`;
    }
  } catch { /* a thumbnail is a nicety; a failed decode is reported elsewhere */ }
  finally { _pending.delete(k); }
}

/** Forget everything (a project load, a library change). */
export function clearWaveThumbs() { _thumbs.clear(); }
