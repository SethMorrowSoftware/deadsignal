/* Dead Signal Studio — media/importfiles.js
 *
 * Bringing your own footage, stills and sound INTO the library.
 *
 * WHY THIS EXISTS
 *
 * Import used to mean one slot per kind. `_importedImg`, `_importedVideo` and
 * one audio clip — module-level variables, one each. Loading a second video
 * silently replaced the first, nothing was persisted, nothing appeared in the
 * library, and nothing survived a reload. So you could film something, drop it
 * in, filter it, and then have no way to drop in the second shot without losing
 * the first. For a tool that cuts sequences, that is not an import feature; it
 * is a preview.
 *
 * Now a file becomes a LIBRARY ROW like everything else this tool makes: named,
 * de-duplicated, persisted to the asset store, listed in the media bin with a
 * thumbnail, saved with the project, and usable as many times as you like.
 *
 * The single slots stay exactly as they are. They are the ACTIVE source that
 * the `videoin` scene and the `import` screen template draw from, and half the
 * renderer reads them — so a library row is loaded INTO a slot when you choose
 * it. Additive, and nothing that worked before works differently.
 */
import { addToLibrary } from '../library/library.js';
import { log } from '../core/dom.js';
import { classifyFile, importOrder } from './classify.js';

/** Thumbnails are for a 96px bin tile; this is generous for a 2× screen. */
const THUMB_W = 192;
const THUMB_H = 120;

/**
 * Metadata a browser can only learn by decoding: how long it runs, and a frame
 * to show for it.
 *
 * Every failure here is soft. A clip whose poster frame will not draw is still
 * a clip worth having in the library, so the row is created either way and the
 * thumbnail is simply missing.
 */
async function probe(blob, kind) {
  if (kind === 'image') return probeImage(blob);
  if (kind === 'videos') return probeVideo(blob);
  return probeAudio(blob);
}

function fit(w, h) {
  const scale = Math.min(THUMB_W / Math.max(1, w), THUMB_H / Math.max(1, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

function canvasFor(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

async function probeImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const im = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('decode'));
      i.src = url;
    });
    const d = fit(im.naturalWidth || im.width, im.naturalHeight || im.height);
    const c = canvasFor(d.w, d.h);
    c.getContext('2d').drawImage(im, 0, 0, d.w, d.h);
    return { seconds: 0, thumb: c.toDataURL('image/png'), w: im.naturalWidth, h: im.naturalHeight };
  } catch {
    return { seconds: 0, thumb: '' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function probeVideo(blob) {
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  try {
    await new Promise((res, rej) => {
      v.onloadedmetadata = res;
      v.onerror = () => rej(new Error('decode'));
      // A file the browser accepts but never finishes opening must not hang the
      // whole import behind it.
      setTimeout(() => rej(new Error('timeout')), 8000);
    });
    const seconds = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    let thumb = '';
    try {
      // A tenth of the way in: the first frame of a lot of footage is black.
      await new Promise((res) => {
        const done = () => { v.removeEventListener('seeked', done); res(); };
        v.addEventListener('seeked', done);
        try { v.currentTime = Math.min(Math.max(0.1, seconds * 0.1), Math.max(0, seconds - 0.05)); }
        catch { res(); }
        setTimeout(res, 3000);
      });
      const d = fit(v.videoWidth || THUMB_W, v.videoHeight || THUMB_H);
      const c = canvasFor(d.w, d.h);
      c.getContext('2d').drawImage(v, 0, 0, d.w, d.h);
      thumb = c.toDataURL('image/png');
    } catch { /* no poster frame; the row is still good */ }
    return { seconds, thumb, w: v.videoWidth, h: v.videoHeight };
  } catch {
    return { seconds: 0, thumb: '' };
  } finally {
    v.removeAttribute('src');
    try { v.load(); } catch { /* already torn down */ }
    URL.revokeObjectURL(url);
  }
}

async function probeAudio(blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('audio');
  a.preload = 'metadata'; a.src = url;
  try {
    await new Promise((res, rej) => {
      a.onloadedmetadata = res;
      a.onerror = () => rej(new Error('decode'));
      setTimeout(() => rej(new Error('timeout')), 8000);
    });
    return { seconds: Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 0, thumb: '' };
  } catch {
    return { seconds: 0, thumb: '' };
  } finally {
    a.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}

/**
 * Import a set of files into the library.
 *
 * Every file is independent: one that cannot be read costs that file and not
 * the batch — the same contract the batch exporter keeps — and the caller is
 * handed a report rather than a boolean, so it can say WHICH file was refused
 * and why. Silently importing four of five files is how someone ships a
 * sequence with a shot missing.
 *
 * @returns {Promise<{added:Array, failed:Array<{name:string, why:string}>}>}
 */
export async function importFiles(files, opts = {}) {
  const { onProgress } = opts;
  const list = importOrder([...(files || [])]);
  const added = [];
  const failed = [];

  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    const c = classifyFile(file);
    if (!c.ok) { failed.push({ name: file?.name || 'file', why: c.why }); continue; }
    onProgress?.({ index: i, total: list.length, name: file.name });
    try {
      const meta = await probe(file, c.kind);
      const it = addToLibrary(file, c.ext, c.kind, c.stem, meta.seconds);
      /* The thumbnail is a runtime handle, like `blob` and `url` — plainRow()
         does not persist it, so a reloaded project shows the kind glyph until
         its bytes are opened again. That is the same deal every other library
         row has. */
      if (meta.thumb) it.thumb = meta.thumb;
      if (meta.w) { it.w = meta.w; it.h = meta.h; }
      added.push(it);
    } catch (e) {
      failed.push({ name: file?.name || 'file', why: e?.message || 'could not be read' });
    }
  }

  if (added.length) {
    log(`Imported ${added.length} file${added.length === 1 ? '' : 's'}: `
      + added.map((it) => `${it.name}.${it.ext}`).join(', '), 'ok');
  }
  for (const f of failed) log(`Import refused ${f.name}: ${f.why}`, 'warn');
  return { added, failed };
}
