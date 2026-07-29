/* Dead Signal Studio — core/packs.js
 *
 * Aesthetic packs: the aesthetic switch reaching the generators, not just the
 * chrome.
 *
 * "Aesthetic" used to mean CSS variables plus a palette. The presets were
 * already grouped by aesthetic in every picker, but nothing else was: forty-
 * eight scenes and forty-six templates sat in two flat alphabetical-ish lists,
 * and an author who had just switched the whole tool to Vaporwave still had to
 * know that `statue`, `mystify` and `splitflap` were the vaporwave ones and
 * `autopsy` was not.
 *
 * A pack names the scenes and templates that belong to a world. Two things come
 * out of that:
 *
 *   1. The pickers GROUP rather than filter. The pack's picks come first under
 *      a heading, everything else follows underneath. A pack is a lens, not a
 *      cage — a horror screen in a cyberpunk project is a legitimate choice and
 *      hiding it would be the tool having an opinion about someone's work.
 *      Grouping forty-eight scenes is also just a better list than not
 *      grouping them, whatever aesthetic you are in.
 *
 *   2. `applyPack()` puts the entire tool into that world in one gesture:
 *      palette, colours, and a matching starting preset on all three tabs, as
 *      ONE undo entry. That is the thing the aesthetic switch always looked
 *      like it did.
 *
 * A pack is a curated starting set, deliberately not a catalogue. Listing
 * everything under "Analogue Horror" would put the list back where it started
 * with an extra heading on top.
 *
 * Ids here are checked against the live registries by the test suite, so a
 * renamed scene fails a test rather than silently vanishing from its pack.
 */

/**
 * Featured content per aesthetic id (the keys of AESTHETICS in palettes.js).
 *
 * `presetGroup` is the group name the built-in presets already use, so the
 * aesthetic, its presets and its content are one fact rather than three that
 * can drift.
 */
export const PACKS = {
  'analogue-horror': {
    presetGroup: 'Analogue Horror',
    scenes: ['terminal', 'snow', 'bars', 'boot', 'camera', 'ekg', 'radar', 'hexdump',
      'alert', 'rain', 'vhsosd', 'teletext', 'dashcam', 'panic', 'signoff', 'vitals', 'sonar'],
    templates: ['terminal', 'bsod', 'camera', 'redacted', 'poster', 'testpattern', 'vitals',
      'policereport', 'autopsy', 'journal', 'clipping', 'evidence', 'vhslabel', 'filecabinet'],
  },
  erebus: {
    presetGroup: 'EREBUS',
    scenes: ['terminal', 'loading', 'matrix', 'hexdump', 'ekg', 'scope', 'datastream',
      'irc', 'signoff', 'panic', 'spectrum'],
    templates: ['terminal', 'hexedit', 'redacted', 'evidence', 'journal', 'clipping',
      'policereport', 'floppy', 'punchcard', 'filecabinet', 'taskmgr', 'boot'],
  },
  cyberpunk: {
    presetGroup: 'Cyberpunk',
    scenes: ['neongrid', 'hud', 'cityrain', 'hologram', 'breach', 'datastream', 'spectrum',
      'keypad', 'satellite', 'sonar', 'tunnel', 'plasma', 'elevator'],
    templates: ['cyberterm', 'corpo', 'implant', 'keycard', 'atm', 'hexedit', 'registry',
      'http404', 'blueprint', 'map', 'boardingpass', 'bios'],
  },
  vaporwave: {
    presetGroup: 'Vaporwave',
    scenes: ['statue', 'neongrid', 'mystify', 'pipes', 'bounce', 'scroller', 'splitflap',
      'lissajous', 'plasma', 'starfield', 'life'],
    templates: ['vapordesktop', 'mall', 'cassette', 'cdlabel', 'desktop', 'certificate',
      'calendar', 'chat', 'poster', 'receipt'],
  },
};

export const packFor = (id) => PACKS[id] || null;

/**
 * Split a registry's entries into [featured, rest] for one aesthetic.
 *
 * Order inside each half is the registry's own, not the pack's: the pack says
 * WHICH, the registry says in what order, so adding a scene to a pack cannot
 * quietly reshuffle the list. Every entry lands in exactly one half — the
 * pickers are still complete, which is the whole difference between grouping
 * and filtering.
 */
export function splitByPack(entries, aestheticId, field) {
  const pack = PACKS[aestheticId];
  if (!pack) return [entries, []];
  const want = new Set(pack[field] || []);
  const featured = [], rest = [];
  for (const e of entries) (want.has(e.id) ? featured : rest).push(e);
  return [featured, rest];
}

/** Ids a pack names that no longer exist in a registry. Empty is the contract. */
export function danglingIds(aestheticId, field, registry) {
  const pack = PACKS[aestheticId];
  if (!pack) return [];
  return (pack[field] || []).filter((id) => !registry[id]);
}
