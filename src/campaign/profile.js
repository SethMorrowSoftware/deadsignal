/* Dead Signal Studio — campaign/profile.js
 *
 * Which campaign the BUNDLE tab is producing for.
 *
 * The release beats, the shipped-asset names the validator warns about, the
 * .zip filename and the INSTALL.txt were all hardcoded to EREBUS, so the tool
 * could wire up exactly one campaign (F-11). None of that is a property of the
 * studio — it is a property of the target — so it lives in a profile the
 * author picks or writes, and travels in the project file with everything else.
 *
 * A profile is deliberately small. Beats are the only part that has to be
 * right: they are the identifiers a `call releaseMedia` line is grouped under
 * in autoexec.retro, so they must match the target campaign's script exactly.
 */
import { val } from '../core/dom.js';

/** Built-in targets. `beats` is ordered — coverage renders in this order. */
export const PROFILES = {
  erebus: {
    id: 'erebus',
    name: 'EREBUS',
    beats: ['boot', 'unlockPhase3', 'unlockPhase5', 'erebus:sable:first',
            'erebus:sable:call', 'announceFourKeys', 'custom'],
    // Names already in the repo. Reusing one silently overwrites a shipped
    // asset on install, so the validator warns — it is legal, just rarely meant.
    shipped: ['erebus_signal_loop.mp4', 'webb_last_session.mp4', 'archive_hum_47.mp3'],
  },
  blank: {
    id: 'campaign',
    name: 'Untitled Campaign',
    beats: ['boot', 'custom'],
    shipped: [],
  },
};

export const DEFAULT_PROFILE = 'erebus';

/** Beat identifiers are written into RetroScript, so keep them script-safe. */
const BEAT_OK = /^[A-Za-z0-9_:.-]+$/;

/**
 * Parse an author-typed beat list (newline or comma separated).
 * Order is preserved and duplicates dropped — coverage reads top to bottom.
 */
export function parseBeats(text) {
  const out = [];
  for (const raw of String(text || '').split(/[\n,]/)) {
    const b = raw.trim();
    if (b && BEAT_OK.test(b) && !out.includes(b)) out.push(b);
  }
  return out;
}

/** Slug for filenames and the manifest — same rules the library uses. */
export function campaignSlug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 40) || 'campaign';
}

/**
 * The profile the BUNDLE tab is currently targeting.
 *
 * Reads through the same accessors as every other tab, so it is document-backed
 * and saves/undoes with the project. Falls back to the built-in whenever a field
 * is blank — an author who never opens this section still gets EREBUS, which is
 * what the tool did before profiles existed.
 */
export function activeProfile() {
  const key = val('b-profile') || DEFAULT_PROFILE;
  const base = PROFILES[key] || PROFILES[DEFAULT_PROFILE];
  const typedName = (val('b-cname') || '').trim();
  const name = typedName || base.name;
  // An author who names the campaign should not also have to type its slug.
  // Only fall back to the profile's own id when they named nothing either,
  // otherwise "Night Shift" would ship as campaign-media-bundle.zip.
  const id = campaignSlug((val('b-cid') || '').trim() || (typedName ? typedName : base.id));
  const typed = parseBeats(val('b-beats'));
  return {
    key,
    id,
    name,
    beats: typed.length ? typed : base.beats.slice(),
    shipped: base.shipped.slice(),
  };
}

/** Beats offered in the library's per-asset dropdown. */
export function campaignBeats() { return activeProfile().beats; }

/**
 * Where a newly generated asset lands by default.
 *
 * The old fixed answers (unlockPhase5 / unlockPhase3) are EREBUS beat names, so
 * against another campaign they named a beat that does not exist and the
 * dropdown silently fell back to its first entry. Prefer the same beats when
 * the target still has them, otherwise take the first beat that is not "boot" —
 * gated assets are the normal case, and boot is the one beat that means
 * ungated.
 */
export function defaultBeatFor(kind) {
  const beats = campaignBeats();
  const preferred = kind === 'videos' ? 'unlockPhase5' : kind === 'music' ? 'unlockPhase3' : 'custom';
  if (beats.includes(preferred)) return preferred;
  return beats.find((b) => b !== 'boot') || beats[0] || 'custom';
}
