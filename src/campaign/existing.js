/* Dead Signal Studio — campaign/existing.js
 *
 * The campaign's CURRENT media files, imported by the author.
 *
 * A standalone browser tool cannot read the repository it is producing for, so
 * the author brings the files to it: drop in the campaign's
 * media-manifest.json, its index.json files and its autoexec.retro, and the
 * bundle emits the complete merged result instead of a fragment that has to be
 * hand-merged.
 *
 * Only the parts needed for merging are kept. autoexec.retro in particular is
 * NOT stored — the flagship script is over a thousand lines, and all the studio
 * needs from it is the set of filenames that already have a release line.
 */
import { getStore } from '../doc/session.js';
import { set } from '../doc/store.js';
import { hasExisting, installedFiles, normalizeExisting, releasedFiles } from '../library/merge.js';

export const EXISTING_PATH = 'campaign.existing';

/** What has been imported, or null. Empty when unbound (headless suites). */
export function existingCampaign() {
  const st = getStore();
  if (!st) return null;
  return normalizeExisting(st.get(EXISTING_PATH));
}

function write(next) {
  const st = getStore();
  if (!st) return false;
  st.apply(set(EXISTING_PATH, normalizeExisting(next)));
  return true;
}

/** Merge one imported piece into whatever is already held. */
export function setExistingPart(key, value) {
  const cur = existingCampaign() || { manifest: null, videosIndex: null, musicIndex: null, released: [] };
  return write({ ...cur, [key]: value });
}

/** Record the filenames an imported autoexec.retro already releases. */
export function setReleasedFrom(retroText) {
  return setExistingPart('released', [...releasedFiles(retroText)]);
}

export function clearExisting() {
  const st = getStore();
  if (!st) return false;
  st.apply(set(EXISTING_PATH, null));
  return true;
}

/** A one-line summary of what is loaded, for the panel. */
export function existingSummary() {
  const e = existingCampaign();
  if (!hasExisting(e)) return null;
  return {
    manifest: e.manifest ? (e.manifest.music.length + e.manifest.videos.length) : 0,
    videosIndex: e.videosIndex ? e.videosIndex.length : 0,
    musicIndex: e.musicIndex ? e.musicIndex.length : 0,
    released: e.released.length,
    files: installedFiles(e).size,
  };
}
