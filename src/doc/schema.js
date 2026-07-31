/* Dead Signal Studio — doc/schema.js
 *
 * The shape of a project document, and its version.
 *
 * Control defaults deliberately live in index.html, not here: the markup is
 * already the declaration of every control's initial value, and duplicating
 * ~120 of them in JS would guarantee the two drift. boot() seeds tabs.* from
 * the DOM once; from that moment the document is authoritative and the DOM
 * renders it.
 */
import { normalizeTracks } from './automation.js';
import { normalizeFilters } from './filters.js';
import { normalizeLayers } from './layers.js';
import { normalizeClips } from './timeline.js';
import { normalizeAudioClips } from './audioclip.js';
import { normalizeRegions } from './regions.js';
import { normalizeSolo } from '../audio/solo.js';
import { normalizeAnnotations } from './annotations.js';
import { normalizeVars } from '../core/text.js';
import { normalizeExisting } from '../library/merge.js';

export const SCHEMA_VERSION = 1;

export const TAB_IDS = ['video', 'audio', 'image', 'timeline'];

/**
 * @param {object}   [init]
 * @param {() => number} [init.now] injectable clock (tests want determinism)
 */
export function createDocument(init = {}) {
  const now = (init.now ?? (() => Date.now()))();
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: init.id ?? `proj-${now.toString(36)}`,
      name: init.name ?? 'Untitled',
      created: now,
      modified: now,
    },
    seed: init.seed ?? 1947,
    // Must be one of the ids in core/palettes.js AESTHETICS. It used to say
    // 'horror', which is not one of them — harmless only because boot seeds
    // this from the markup a moment later, and wrong the moment a document is
    // built without a DOM.
    aesthetic: init.aesthetic ?? 'analogue-horror',
    // controlId -> value, one map per tab
    tabs: { video: {}, audio: {}, image: {}, timeline: {} },
    // author-defined {{name}} substitutions, shared by every tab
    vars: {},
    // keyframe tracks: controlId -> [{t,v,e}], per editor
    automation: { video: {} },
    // extra scenes composited over the base scene, bottom-first
    layers: { video: [] },
    // All three chains, so a fresh document already has the shape normalize()
    // produces — otherwise save→load is not byte-identical, which the
    // serialisation contract in test-studio-document.mjs rightly insists on.
    // `image` runs the same filter registry over a still as `video` runs over a
    // frame; a project written before it existed simply reads back with none.
    filters: { video: [], audio: [], image: [] },
    // Region edits on the rendered wave (doc/regions.js) and the solo set
    // (audio/solo.js) — both are audio state that no control holds.
    audio: { regions: [], solo: [] },
    // Free marks placed over whatever template a screen is using. See
    // doc/annotations.js — the templates bake their own layout, this is the
    // one layer that does not.
    image: { annotations: [] },
    // the target campaign's CURRENT media files, imported for merging
    campaign: { existing: null },
    // multi-scene sequence: each clip is a captured video recipe
    timeline: { clips: [], audio: [] },
    // generated + imported assets. Blobs are runtime-only and are not
    // serialised into project.json; see doc/serialize.js.
    library: [],
  };
}

/** Cheap structural check — enough to reject a file that is not a project. */
export function isDocument(d) {
  return !!d && typeof d === 'object'
    && typeof d.schemaVersion === 'number'
    && !!d.tabs && typeof d.tabs === 'object'
    && Array.isArray(d.library);
}

/** Fill in anything a hand-edited or older document is missing. */
export function normalize(doc) {
  const base = createDocument();
  const out = { ...base, ...doc };
  out.meta = { ...base.meta, ...(doc.meta ?? {}) };
  out.tabs = { ...base.tabs, ...(doc.tabs ?? {}) };
  for (const t of TAB_IDS) if (!out.tabs[t] || typeof out.tabs[t] !== 'object') out.tabs[t] = {};
  out.automation = { video: {}, ...(doc.automation ?? {}) };
  out.automation.video = normalizeTracks(out.automation.video);
  // A project written before variables existed simply has none.
  out.vars = normalizeVars(doc.vars);
  out.campaign = { existing: null, ...(doc.campaign ?? {}) };
  out.campaign.existing = normalizeExisting(out.campaign.existing);
  out.layers = { video: [], ...(doc.layers ?? {}) };
  out.layers.video = normalizeLayers(out.layers.video);

  /* Both chains share one stored shape (doc/filters.js) because they are the
     same thing over different registries — an ordered list of {id, params,
     enabled}. A project written before the audio chain existed simply has
     none. */
  out.filters = { video: [], audio: [], image: [], ...(doc.filters ?? {}) };
  out.filters.video = normalizeFilters(out.filters.video);
  out.filters.audio = normalizeFilters(out.filters.audio);
  out.filters.image = normalizeFilters(out.filters.image);
  out.audio = { regions: [], solo: [], ...(doc.audio ?? {}) };
  out.audio.regions = normalizeRegions(out.audio.regions);
  out.audio.solo = normalizeSolo(out.audio.solo);
  out.image = { annotations: [], ...(doc.image ?? {}) };
  out.image.annotations = normalizeAnnotations(out.image.annotations);
  out.timeline = { clips: [], audio: [], ...(doc.timeline ?? {}) };
  /* Clips are normalised here, not only where the timeline projects them, so
     that every way a document arrives — LOAD, share link, autosave restore,
     server version, store.replace() — lands on the same clip shape. A clip from
     an older build reads back as "the whole source, cut, video"; see makeClip. */
  out.timeline.clips = normalizeClips(out.timeline.clips);
  /* A project written before the audio lane existed simply has none — the same
     shape `filters.audio` already takes. It reads back with an empty array and
     every clip, schedule, render and export path is byte-identical, because
     nothing consults the lane when it is empty. */
  out.timeline.audio = normalizeAudioClips(out.timeline.audio);
  if (!Array.isArray(out.library)) out.library = [];
  out.schemaVersion = SCHEMA_VERSION;
  return out;
}
