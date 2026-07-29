/* Dead Signal Studio — doc/paths.js
 *
 * Dotted-path access into the project document. Every write in the studio goes
 * through here, which makes it the single choke point for the repo's
 * prototype-pollution rule: a path segment of __proto__ / constructor /
 * prototype is rejected outright rather than walked. Project files are
 * user-supplied and importable, so this is a real attack surface, not a
 * theoretical one — the same reasoning as StateManager.setState in core/.
 */

const BANNED = new Set(['__proto__', 'constructor', 'prototype']);

export class PathError extends Error {}

/** "tabs.video.v-w" | "library.2.name" -> ["tabs","video","v-w"] */
export function parsePath(path) {
  if (Array.isArray(path)) return path.map(String);
  if (typeof path !== 'string' || path === '') throw new PathError('empty path');
  const segs = path.split('.');
  for (const s of segs) {
    if (s === '') throw new PathError(`empty segment in "${path}"`);
    if (BANNED.has(s)) throw new PathError(`unsafe path segment "${s}"`);
  }
  return segs;
}

const isIndex = (s) => /^\d+$/.test(s);

export function getPath(root, path) {
  const segs = parsePath(path);
  let node = root;
  for (const s of segs) {
    if (node == null) return undefined;
    node = node[s];
  }
  return node;
}

export function hasPath(root, path) {
  const segs = parsePath(path);
  let node = root;
  for (let i = 0; i < segs.length; i++) {
    if (node == null || typeof node !== 'object') return false;
    if (!(segs[i] in node)) return false;
    node = node[segs[i]];
  }
  return true;
}

/**
 * Set a value, creating intermediate containers. A numeric segment creates an
 * array, anything else an object — so "library.0.name" builds a list, not a
 * map with a "0" key.
 */
export function setPath(root, path, value) {
  const segs = parsePath(path);
  let node = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    const next = segs[i + 1];
    if (node[s] == null || typeof node[s] !== 'object') node[s] = isIndex(next) ? [] : {};
    node = node[s];
  }
  node[segs[segs.length - 1]] = value;
  return root;
}

export function deletePath(root, path) {
  const segs = parsePath(path);
  let node = root;
  for (let i = 0; i < segs.length - 1; i++) {
    node = node?.[segs[i]];
    if (node == null || typeof node !== 'object') return root;
  }
  const last = segs[segs.length - 1];
  if (Array.isArray(node) && isIndex(last)) node.splice(Number(last), 1);
  else if (node && typeof node === 'object') delete node[last];
  return root;
}

/** Is `path` the same as, or nested under, `prefix`? Used by subscriptions. */
export function pathStartsWith(path, prefix) {
  const a = parsePath(path), b = parsePath(prefix);
  if (b.length > a.length) return false;
  return b.every((s, i) => s === a[i]);
}

/** Do these two paths affect one another in either direction? */
export function pathsOverlap(a, b) {
  return pathStartsWith(a, b) || pathStartsWith(b, a);
}

/**
 * Structured clone that also strips banned keys at any depth. Used on every
 * value entering the document, so an imported project cannot smuggle a
 * __proto__ key in as a *value* rather than a path.
 *
 * `seen` is the current RECURSION PATH, not every object visited. That
 * distinction is the whole point: the same object appearing twice in a
 * document — one blob in two library rows, one recipe reachable from two
 * places — is a perfectly ordinary graph, and treating it as a cycle made
 * safeClone throw. Since readProject() clones the whole document, that throw
 * came out as SAVE PROJ doing nothing at all, with the reason ("circular
 * structure") visible only in the console. Only a reference that is its own
 * ancestor is a real cycle, which is what removing it on the way back out
 * measures.
 */
export function safeClone(value, seen = new Set()) {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime());
  // Blobs, canvases and the like are opaque handles — pass them through rather
  // than trying to clone them; the library holds these deliberately. Checked
  // before the cycle guard because a handle is a leaf: it can never be its own
  // ancestor, so it must not occupy a slot on the path.
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value;
  if (seen.has(value)) throw new PathError('circular structure in document value');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((v) => safeClone(v, seen));
    const out = {};
    for (const k of Object.keys(value)) {
      if (BANNED.has(k)) continue;
      out[k] = safeClone(value[k], seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

export { BANNED as BANNED_SEGMENTS };
