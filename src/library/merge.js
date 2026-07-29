/* Dead Signal Studio — library/merge.js
 *
 * Merging generated assets into a campaign that already has some.
 *
 * The bundle used to emit manifest and index files describing ONLY the assets
 * in the studio's library, which meant installing it over a campaign that
 * already had media would delete every existing entry — so the instructions
 * said "merge these by hand". That hand-merge is the last manual step in the
 * whole pipeline, and it is exactly the sort of fiddly JSON editing that goes
 * wrong quietly.
 *
 * Import the campaign's current files and the bundle emits the COMPLETE merged
 * result instead, so installing is a plain overwrite.
 *
 * Pure on purpose: no DOM, no store, no fetch. Merging is the part that must be
 * exactly right, because getting it wrong loses an author's existing media.
 */

/** The filename an entry refers to, from either file shape. */
export function fileOf(entry) {
  if (!entry || typeof entry !== 'object') return '';
  if (typeof entry.filename === 'string' && entry.filename) return entry.filename;
  const src = typeof entry.src === 'string' ? entry.src : '';
  const cut = src.lastIndexOf('/');
  return cut >= 0 ? src.slice(cut + 1) : src;
}

const isEntry = (e) => !!e && typeof e === 'object' && !Array.isArray(e) && !!fileOf(e);

/** Keep only real entries, and drop keys that could reach Object.prototype. */
function cleanEntry(e) {
  const out = {};
  for (const k of Object.keys(e)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = e[k];
  }
  return out;
}

/**
 * Parse an `assets/media-manifest.json`.
 * @returns {{music: object[], videos: object[]}}
 */
export function parseManifest(text) {
  const raw = typeof text === 'string' ? JSON.parse(text) : text;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('media-manifest.json should be an object with "music" and "videos"');
  }
  const list = (v) => (Array.isArray(v) ? v.filter(isEntry).map(cleanEntry) : []);
  return { music: list(raw.music), videos: list(raw.videos) };
}

/** Parse an `assets/<kind>/index.json` (a bare array). */
export function parseIndex(text) {
  const raw = typeof text === 'string' ? JSON.parse(text) : text;
  if (!Array.isArray(raw)) throw new Error('index.json should be a JSON array');
  return raw.filter(isEntry).map(cleanEntry);
}

/**
 * Merge generated entries into existing ones, keyed on filename.
 *
 * Existing order is preserved and new entries are appended, so a diff of the
 * campaign's manifest shows only what actually changed. Regenerating an asset
 * REPLACES its entry rather than adding a second one with the same filename —
 * two entries for one file is what makes a manifest silently wrong.
 *
 * @returns {{merged: object[], added: string[], replaced: string[]}}
 */
export function mergeEntries(existing, generated) {
  const base = Array.isArray(existing) ? existing.filter(isEntry) : [];
  const incoming = Array.isArray(generated) ? generated.filter(isEntry) : [];

  const byFile = new Map();
  for (const e of incoming) byFile.set(fileOf(e), e);

  const added = [];
  const replaced = [];
  const merged = [];
  const seen = new Set();

  for (const e of base) {
    const f = fileOf(e);
    if (seen.has(f)) continue;                 // the campaign's own duplicate
    seen.add(f);
    if (byFile.has(f)) {
      merged.push(byFile.get(f));
      replaced.push(f);
      byFile.delete(f);
    } else {
      merged.push(e);
    }
  }
  for (const [f, e] of byFile) {
    merged.push(e);
    added.push(f);
  }
  return { merged, added, replaced };
}

/**
 * Filenames that already have a `call releaseMedia` line.
 *
 * Used to emit a snippet containing only the lines an author still needs, so
 * pasting it twice cannot produce a duplicate release. Deliberately a read: the
 * studio reports what is missing rather than rewriting a branching narrative
 * script, which it cannot do safely.
 */
export function releasedFiles(retroText) {
  const out = new Set();
  if (typeof retroText !== 'string') return out;
  for (const rawLine of retroText.split(/\r?\n/)) {
    // A commented-out release is NOT a release. Counting one would make the
    // studio skip the very line the author still needs, and the clip would
    // never appear in the campaign. RetroScript comments are # and //.
    const line = stripComment(rawLine);
    // call releaseMedia "name.ext"  — single or double quoted.
    const re = /\breleaseMedia\s+(["'])([^"']+)\1/g;
    let m;
    while ((m = re.exec(line)) !== null) out.add(m[2].trim());
  }
  return out;
}

/** Drop a trailing line comment, ignoring # and // that sit inside a string. */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '#') return line.slice(0, i);
    if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

/** Every filename a campaign already installs, from whatever was imported. */
export function installedFiles(existing) {
  const out = new Set();
  if (!existing) return out;
  for (const key of ['music', 'videos']) {
    for (const e of existing.manifest?.[key] || []) out.add(fileOf(e).toLowerCase());
  }
  for (const key of ['videosIndex', 'musicIndex']) {
    for (const e of existing[key] || []) out.add(fileOf(e).toLowerCase());
  }
  out.delete('');
  return out;
}

/** True when anything at all has been imported. */
export function hasExisting(existing) {
  if (!existing) return false;
  return !!(existing.manifest || existing.videosIndex || existing.musicIndex
            || (existing.released && existing.released.length));
}

/** Cleaned shape for storing in the document. */
export function normalizeExisting(e) {
  if (!e || typeof e !== 'object') return null;
  const arr = (v) => (Array.isArray(v) ? v.filter(isEntry).map(cleanEntry) : null);
  const out = {
    manifest: e.manifest && typeof e.manifest === 'object'
      ? { music: arr(e.manifest.music) || [], videos: arr(e.manifest.videos) || [] }
      : null,
    videosIndex: arr(e.videosIndex),
    musicIndex: arr(e.musicIndex),
    released: Array.isArray(e.released)
      ? [...new Set(e.released.filter((s) => typeof s === 'string' && s))]
      : [],
  };
  return hasExisting(out) ? out : null;
}
