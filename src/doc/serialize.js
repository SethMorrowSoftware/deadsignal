/* Dead Signal Studio — doc/serialize.js
 *
 * Canonical JSON so a save is byte-stable: the same document always produces
 * the same bytes, which makes project files diffable in git and lets a render
 * be addressed by a hash of its document.
 *
 * `.rfp` is the same document plus its binary assets, in the store-only ZIP the
 * bundler already writes. project.json alone is a valid project — assets are
 * resolved from the local store when they are missing, so a document stays
 * reviewable on its own.
 */
import { makeZip, readZip, strU8 } from '../library/zip.js';
import { migrate } from './migrations.js';
import { isDocument, normalize } from './schema.js';
import { safeClone } from './paths.js';

/** Recursively key-sorted stringify. Arrays keep their order. */
export function canonicalJSON(value, indent = 2) {
  const sortValue = (v) => {
    if (Array.isArray(v)) return v.map(sortValue);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sortValue(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sortValue(value), null, indent);
}

/**
 * Document -> canonical JSON string.
 * Runtime-only fields (in-memory Blobs, object URLs) are dropped: they cannot
 * survive a reload, and writing them would make the bytes unstable.
 */
export function toJSON(doc) {
  const out = safeClone(doc);
  out.library = (out.library ?? []).map(stripRuntime);
  return canonicalJSON(out);
}

function stripRuntime(item) {
  const { blob, url, ...rest } = item ?? {};
  return rest;
}

/** JSON text (any schema version, including the legacy v0 format) -> document. */
export function fromJSON(text, opts = {}) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`not a valid project file: ${e.message}`);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('not a valid project file');
  // A v0 file has no schemaVersion but does have the tabs map; anything with
  // neither is not a project.
  if (!isDocument(parsed) && !(parsed.tabs && typeof parsed.tabs === 'object')) {
    throw new Error('not a valid project file: missing tabs');
  }
  return normalize(migrate(parsed, opts));
}

const PROJECT_ENTRY = 'project.json';

/**
 * Document (+ its asset blobs) -> a .rfp archive.
 * @param {object} doc
 * @param {Array<{name:string, blob:Blob}>} [assets]
 */
export async function toRfp(doc, assets = []) {
  const files = [{ name: PROJECT_ENTRY, data: strU8(toJSON(doc)) }];
  for (const a of assets) {
    if (!a?.blob) continue;
    files.push({ name: `assets/${a.name}`, data: new Uint8Array(await a.blob.arrayBuffer()) });
  }
  files.push({ name: 'README.txt', data: strU8(
    'Dead Signal Studio project (.rfp)\n' +
    '=================================\n' +
    'project.json is the document and is valid on its own.\n' +
    'assets/ holds the binaries it references.\n') });
  return makeZip(files);
}

/** .rfp archive -> { doc, assets: Map<name, Uint8Array> }. */
export async function fromRfp(blob) {
  const entries = await readZip(blob);
  const project = entries.find((e) => e.name === PROJECT_ENTRY);
  if (!project) throw new Error('.rfp contains no project.json');
  const doc = fromJSON(new TextDecoder().decode(project.data));
  const assets = new Map();
  for (const e of entries) {
    if (e.name.startsWith('assets/')) assets.set(e.name.slice('assets/'.length), e.data);
  }
  return { doc, assets };
}
