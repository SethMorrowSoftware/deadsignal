/* Dead Signal Studio — media/fonts.js
 *
 * Your own typefaces, as library rows.
 *
 * WHY THIS EXISTS
 *
 * Six system stacks drew every glyph in the tool. For a studio whose output is
 * mostly TYPE — a terminal, a ransom note, a MISSING poster, a VHS label — that
 * is a hard ceiling, and it is exactly the ceiling authors of this material hit
 * first: the look of analogue horror is one Chicago/OCR-A/pixel-font drop away
 * from the look of a default. So a dropped .ttf/.otf/.woff/.woff2 becomes a
 * library row (kind `fonts`), persists like any other asset, travels with the
 * project, and shows up in every font picker as itself.
 *
 * HOW IT MEETS THE RENDERER
 *
 * core/text.js keeps its module-state design: setFontStack(name) resolves the
 * name once per frame, setFont(ctx,px) is unchanged at all ~40 call sites. A
 * custom font is one more resolvable name — `lib:<key>` — registered into
 * text.js's custom map with a synthetic, collision-proof family name and the
 * monospace stack as fallback. Old projects (whose ids are built-ins) resolve
 * exactly as before; a project whose font row is gone falls back to Monospace
 * VISIBLY rather than silently drawing nothing.
 *
 * ASYNC, AND WHAT IT COSTS
 *
 * FontFace loads asynchronously and every render path here is synchronous, so
 * a frame drawn before the load completes uses the fallback stack. The map is
 * registered immediately (the name resolves from the first frame) and the
 * caller's `onLoaded` nudge redraws when the real face lands — in practice one
 * preview frame later. Exports go through the same registration, so anything
 * you can see is what exports.
 */

import { log } from '../core/dom.js';
import { setCustomFont } from '../core/text.js';
import { library, onLibraryChange } from '../library/library.js';

/* One FontFace per library key, loaded once per session. The value is the
   load promise so concurrent callers share a single load. */
const _faces = new Map();

/** The synthetic CSS family for a library key — collision-proof by prefix. */
export const familyFor = (key) => 'ds-font-' + String(key).replace(/[^a-zA-Z0-9_-]/g, '_');

/** The picker/document id for a font row. */
export const fontIdFor = (key) => 'lib:' + key;

/**
 * Register a font row's face and its resolvable name. Returns the load
 * promise; safe to call repeatedly. The name is registered BEFORE the load
 * completes so a recipe referencing it resolves (to the fallback) from the
 * first frame rather than throwing the picker back to Monospace.
 */
export function ensureFontFace(it, onLoaded) {
  if (!it || it.kind !== 'fonts' || !it.key || !it.blob) return null;
  const id = fontIdFor(it.key);
  const family = familyFor(it.key);
  if (_faces.has(it.key)) return _faces.get(it.key);
  setCustomFont(id, {
    label: it.name,
    stack: `"${family}","DejaVu Sans Mono","Consolas",monospace`,
  });
  const p = (async () => {
    const buf = await it.blob.arrayBuffer();
    const face = new FontFace(family, buf);
    await face.load();
    document.fonts.add(face);
    onLoaded?.(it);
    return face;
  })().catch((e) => {
    /* The import probe already refused unloadable files, so this is rare —
       bytes that rotted in storage, or a hand-edited project. The name STAYS
       registered so the picker still shows the row; the draw falls back to
       monospace, which is visible, and the console says why. */
    log(`Font ${it.name}.${it.ext} failed to load — drawing Monospace instead (${e?.message || e})`, 'warn');
    return null;
  });
  _faces.set(it.key, p);
  return p;
}

/**
 * Keep the face registry in step with the library: every font row present
 * gets a face; a row deleted (or undone away) gets its name unregistered so
 * the pickers stop offering it. Called on every library change.
 */
export function syncLibraryFonts(onLoaded) {
  const present = new Set();
  for (const it of library) {
    if (it.kind !== 'fonts' || !it.key) continue;
    present.add(it.key);
    if (it.blob) ensureFontFace(it, onLoaded);
    else {
      /* Bytes not back yet (a reloaded project before rehydration, or a row
         restored without its asset): keep the NAME resolvable so the picker
         and the document stay coherent; the draw falls back to monospace. */
      setCustomFont(fontIdFor(it.key), {
        label: it.name,
        stack: '"DejaVu Sans Mono","Consolas",monospace',
      });
    }
  }
  for (const key of [..._faces.keys()]) {
    if (present.has(key)) continue;
    _faces.get(key)?.then((face) => { try { if (face) document.fonts.delete(face); } catch { /* gone */ } });
    _faces.delete(key);
    setCustomFont(fontIdFor(key), null);
  }
}

/** Wire the registry to the library. Call once at boot, after the session. */
export function initLibraryFonts(onLoaded) {
  syncLibraryFonts(onLoaded);
  onLibraryChange(() => syncLibraryFonts(onLoaded));
}
