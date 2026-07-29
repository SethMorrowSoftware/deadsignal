/* Dead Signal Studio — doc/migrations.js
 *
 * Forward-only migration chain. A project written by any earlier build MUST
 * open in every later one; that is the durability promise, and it is a hard
 * contract rather than best effort.
 *
 * Version 0 is the pre-document format that the old readProject() wrote:
 *
 *     { "seed": "1947", "tabs": { "video": {...}, "audio": {...}, "image": {...} } }
 *
 * Those files are already on people's disks, so v0 -> v1 is a real migration,
 * not a placeholder to prove the mechanism.
 */
import { SCHEMA_VERSION, createDocument, normalize } from './schema.js';

/** Each entry takes a document at `from` and returns one at `from + 1`. */
export const MIGRATIONS = [
  {
    from: 0,
    describe: 'legacy control-snapshot project -> document',
    up(old) {
      const doc = createDocument({ name: old.meta?.name ?? old.name ?? 'Imported project' });
      // v0 stored the seed as the raw input string.
      const seed = parseInt(old.seed, 10);
      if (Number.isFinite(seed)) doc.seed = seed >>> 0;
      if (typeof old.aesthetic === 'string') doc.aesthetic = old.aesthetic;
      // Every tab map, not a fixed three: v0 only ever had video/audio/image,
      // but see below — a current-shape file also lands here, and it carries
      // timeline and bundle tab maps too.
      for (const tab of Object.keys(old.tabs ?? {})) {
        if (old.tabs[tab] && typeof old.tabs[tab] === 'object' && !Array.isArray(old.tabs[tab])) {
          doc.tabs[tab] = { ...old.tabs[tab] };
        }
      }
      /* v0 was exactly seed + tabs (+ later a timeline). Everything else here
         covers the OTHER document that reads as v0: a current-shape file whose
         schemaVersion was lost to a hand edit or a bad merge — serialize.js
         advertises diffable, hand-editable files, so both happen. Rebuilding
         those from a fresh createDocument() was this file's own named failure
         mode: the project opened, said "Project loaded", and had dropped the
         library, chains, layers, keyframes, regions, marks and variables. A
         true v0 file has none of these keys, so carrying them through when
         present changes nothing for real legacy files; migrate()'s closing
         normalize() cleans each section either way. */
      if (old.meta && typeof old.meta === 'object') doc.meta = { ...doc.meta, ...old.meta };
      for (const key of ['vars', 'automation', 'layers', 'filters', 'audio', 'image', 'campaign', 'library']) {
        if (old[key] !== undefined) doc[key] = old[key];
      }
      // v0 had no timeline persistence in its first release; later builds added
      // a bare `timeline` array of recipes.
      //
      // The `{clips:[…]}` branch is not hypothetical: a document that carries
      // the current timeline shape but no `schemaVersion` reads as v0 here, and
      // dropping to the array-only check silently emptied its sequence. That is
      // any hand-written or hand-edited project, and it is the one failure mode
      // a migration must never have — a file that opens, reports success, and
      // has lost the work.
      if (Array.isArray(old.timeline)) {
        // A bare array's entries ARE the recipes, so an entry with no `rec` is
        // one — that fallback is specific to this shape and wrong for the other.
        doc.timeline.clips = old.timeline.map((c, i) => ({
          ...c,
          label: c.label ?? `Clip ${i + 1}`,
          rec: c.rec ?? c,
          transition: c.transition ?? 'cut',
        }));
      } else if (Array.isArray(old.timeline?.clips)) {
        // Already the current shape; normalize() below fills in the rest.
        doc.timeline.clips = old.timeline.clips;
      }
      return doc;
    },
  },
];

/** A document with no schemaVersion is v0 by definition. */
export function versionOf(doc) {
  const v = doc?.schemaVersion;
  return Number.isFinite(v) ? v : 0;
}

/**
 * Bring `doc` up to SCHEMA_VERSION. Throws if it is newer than this build
 * understands — silently downgrading would lose data.
 */
export function migrate(doc, { onStep } = {}) {
  let v = versionOf(doc);
  if (v > SCHEMA_VERSION) {
    throw new Error(
      `project is version ${v}, this build understands up to ${SCHEMA_VERSION} — update the studio`);
  }
  let out = doc;
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS.find((m) => m.from === v);
    if (!step) throw new Error(`no migration from version ${v}`);
    out = step.up(out);
    v += 1;
    out.schemaVersion = v;
    onStep?.(v, step.describe);
  }
  return normalize(out);
}
