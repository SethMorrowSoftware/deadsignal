/* Dead Signal Studio — media/classify.js
 *
 * What kind of asset a dropped file is, and what to call it. Pure: no DOM, no
 * decoding, no library.
 *
 * WHY THIS IS SEPARATE
 *
 * Importing has to answer three questions before it touches anything: is this a
 * file we can use, which of the library's three kinds is it, and what is it
 * called. All three are decidable from the name and the MIME type alone, and
 * all three are exactly the sort of thing that is wrong at the edges — a .mov
 * the browser cannot decode, a file called `mix.wav.txt`, a name that is
 * nothing but punctuation. Deciding them here means they are pinned by the
 * headless suite instead of only being exercised by dragging a file onto a
 * browser.
 *
 * The library's vocabulary is three kinds — `videos`, `music`, `image` — and it
 * is enforced by the LIBRARY table's own picker. Import speaks that vocabulary
 * rather than inventing a fourth.
 */

/** The library's kinds. Anything else is not a thing this tool files. */
export const KINDS = ['videos', 'music', 'image'];

/* What a browser will actually play or draw. Deliberately a list of what works
   rather than "anything with a video/ MIME type": a .mov or a .avi has a MIME
   type too, and importing one that cannot decode produces a library row that
   looks fine and is silently unusable. */
export const VIDEO_EXT = ['webm', 'mp4', 'm4v', 'ogv'];
export const AUDIO_EXT = ['wav', 'mp3', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'weba'];
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'];

/** 64 MB. Past this a browser tab is the wrong place to be holding the file. */
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

/** The extension, lowercased, or '' — from the LAST dot only. */
export function extOf(name) {
  const s = String(name ?? '');
  const dot = s.lastIndexOf('.');
  if (dot < 0 || dot === s.length - 1) return '';
  return s.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The name without its extension, for the library row. */
export function stemOf(name) {
  const s = String(name ?? '').replace(/\.[^.]+$/, '');
  return s.trim() || 'import';
}

/**
 * Which kind this file is, or why it cannot be imported.
 *
 * The extension decides, and the MIME type is the tie-breaker for a file with
 * none — that order on purpose. A browser reports `application/octet-stream`
 * for plenty of perfectly good media depending on where the file came from, so
 * trusting MIME first would refuse files that work; the extension is what the
 * decoder is going to be handed either way.
 *
 * @returns {{ok:boolean, kind?:string, ext?:string, stem?:string, why?:string}}
 */
export function classifyFile(file) {
  const name = file?.name ?? '';
  const type = String(file?.type ?? '').toLowerCase();
  const size = Number(file?.size ?? 0);
  let ext = extOf(name);

  if (!ext) {
    // No extension: fall back to the MIME subtype, which is better than
    // refusing a file the browser has already told us it understands.
    const sub = type.split('/')[1] || '';
    ext = sub.split(';')[0].replace(/[^a-z0-9]/g, '');
  }

  const kind = VIDEO_EXT.includes(ext) ? 'videos'
    : AUDIO_EXT.includes(ext) ? 'music'
      : IMAGE_EXT.includes(ext) ? 'image'
        : type.startsWith('video/') ? 'videos'
          : type.startsWith('audio/') ? 'music'
            : type.startsWith('image/') ? 'image'
              : null;

  if (!kind) {
    return { ok: false, why: `${name || 'that file'} is not a kind of media this tool can open` };
  }
  if (size > MAX_IMPORT_BYTES) {
    return { ok: false, why: `${name} is ${(size / 1048576).toFixed(0)} MB — too big to hold in a browser tab (limit ${MAX_IMPORT_BYTES / 1048576} MB)` };
  }
  if (size === 0) {
    return { ok: false, why: `${name} is empty` };
  }
  return { ok: true, kind, ext, stem: stemOf(name) };
}

/**
 * Sort a dropped set so the report reads in a sensible order and the first
 * thing imported is the thing most likely to be wanted as a source.
 */
export function importOrder(list) {
  const rank = { videos: 0, image: 1, music: 2 };
  return [...list].sort((a, b) => {
    const ka = classifyFile(a), kb = classifyFile(b);
    const ra = ka.ok ? rank[ka.kind] : 9;
    const rb = kb.ok ? rank[kb.kind] : 9;
    if (ra !== rb) return ra - rb;
    return String(a?.name ?? '').localeCompare(String(b?.name ?? ''));
  });
}
