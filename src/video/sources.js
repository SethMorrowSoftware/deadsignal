/* Dead Signal Studio — video/sources.js
 *
 * Footage, addressed by which footage it is.
 *
 * WHY THIS EXISTS
 *
 * The `videoin` scene drew from `_importedVideo` — one module-level element,
 * the last file loaded. So a sequence could contain two footage clips and they
 * would both play the same file: whichever was imported most recently. The
 * preview looked right while you built each clip and wrong the moment you had
 * two, which is the worst way for a thing to be broken.
 *
 * A clip now carries the library key of its footage (`v-srckey` in its recipe),
 * and this is the pool that turns a key into an element to draw.
 *
 * WHY A POOL RATHER THAN AN ELEMENT PER CLIP
 *
 * Two clips cut from the same file — the ordinary case, since that is what
 * trimming is for — share one decoder. A `<video>` per clip would decode the
 * same footage twice, and browsers cap how many media elements can be active
 * at once, so a six-clip sequence would start silently failing to draw.
 *
 * Loading is async and drawing is not, so `videoSource()` is a synchronous
 * lookup that returns null until the bytes are ready, and every caller already
 * handles "no footage yet" because that was the state before any import.
 */
import { library } from '../library/library.js';
import { log } from '../core/dom.js';

/** key → { el, url } once decoded. */
const _pool = new Map();
/** Keys being loaded, so a render loop asking sixty times a second loads once. */
const _loading = new Set();

/**
 * Browsers stop decoding somewhere around a dozen simultaneous media elements.
 * A sequence is capped at 64 clips, so the pool is capped too — and it drops
 * the least recently drawn rather than refusing, because a sequence that plays
 * its first eight clips and then shows black is not better than one that
 * re-decodes.
 */
const MAX_SOURCES = 8;
const _used = new Map();      // key → a counter, for least-recently-drawn

let _tick = 0;

/* Choices are stored in the same `lib:<key>` shape the sound pickers use, so
   one vocabulary covers every asset reference in the document. */
const bare = (k) => (typeof k === 'string' && k.startsWith('lib:') ? k.slice(4) : k);

/** The element for this key, or null if it is not ready (or not footage). */
export function videoSource(choice) {
  const key = bare(choice);
  if (!key) return null;
  const hit = _pool.get(key);
  if (!hit) { void ensureVideoSource(key); return null; }
  _used.set(key, ++_tick);
  return hit.el.videoWidth ? hit.el : null;
}

/** True once this key has a decoded element to draw. */
export const hasVideoSource = (choice) => {
  const key = bare(choice);
  return !!(key && _pool.get(key)?.el?.videoWidth);
};

/**
 * Decode a library row into the pool.
 *
 * Resolves to the element or null. Never throws: footage that will not decode
 * is reported once and then simply absent, exactly as it is when nothing has
 * been imported.
 */
export async function ensureVideoSource(choice) {
  const key = bare(choice);
  if (!key) return null;
  const hit = _pool.get(key);
  if (hit) return hit.el;
  if (_loading.has(key)) return null;

  const row = library.find((it) => it.key === key);
  if (!row?.blob) return null;

  _loading.add(key);
  const url = URL.createObjectURL(row.blob);
  const el = document.createElement('video');
  el.muted = true; el.loop = true; el.playsInline = true; el.preload = 'auto';
  el.src = url;
  try {
    await new Promise((res, rej) => {
      el.onloadedmetadata = res;
      el.onerror = () => rej(new Error('decode'));
      setTimeout(() => rej(new Error('timeout')), 8000);
    });
    evict();
    _pool.set(key, { el, url });
    _used.set(key, ++_tick);
    // Playing keeps the preview live, the same as the single slot always did.
    el.play().catch(() => {});
    return el;
  } catch {
    URL.revokeObjectURL(url);
    log(`Footage "${row.name}.${row.ext}" could not be decoded here`, 'warn');
    return null;
  } finally {
    _loading.delete(key);
  }
}

function evict() {
  while (_pool.size >= MAX_SOURCES) {
    let oldest = null, oldestAt = Infinity;
    for (const [k] of _pool) {
      const at = _used.get(k) ?? 0;
      if (at < oldestAt) { oldestAt = at; oldest = k; }
    }
    if (oldest == null) return;
    dropVideoSource(oldest);
  }
}

/** Release one source's decoder and its object URL. */
export function dropVideoSource(key) {
  const hit = _pool.get(key);
  if (!hit) return false;
  try { hit.el.pause(); hit.el.removeAttribute('src'); hit.el.load(); } catch { /* already gone */ }
  URL.revokeObjectURL(hit.url);
  _pool.delete(key);
  _used.delete(key);
  return true;
}

/** Release everything (a project load, a library clear). */
export function clearVideoSources() {
  for (const key of [...
    _pool.keys()]) dropVideoSource(key);
}

/** Load every key a sequence needs, so the first frame is not black. */
export async function primeVideoSources(keys) {
  const want = [...new Set((keys || []).map(bare).filter(Boolean))].slice(0, MAX_SOURCES);
  const out = [];
  for (const k of want) out.push(await ensureVideoSource(k));
  return out.filter(Boolean);
}

/** Play every loaded source, optionally from the top. Used by the recorder. */
export function playVideoSources(keys, reset) {
  for (const k of [...new Set((keys || []).map(bare).filter(Boolean))]) {
    const el = _pool.get(k)?.el;
    if (!el) continue;
    try { if (reset) el.currentTime = 0; el.play().catch(() => {}); } catch { /* not ready */ }
  }
}

/** How many decoders are open — the suites assert the cap holds. */
export const videoSourceCount = () => _pool.size;
export const MAX_VIDEO_SOURCES = MAX_SOURCES;
