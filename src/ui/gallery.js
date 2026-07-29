/* Dead Signal Studio — ui/gallery.js
 *
 * Preset thumbnails: pick a look by looking at it.
 *
 * The preset picker is a <select> of forty-odd names. "Signal Loss", "ICE
 * Drone", "Evidence Tag" — every one of them is a guess until you load it, and
 * loading it overwrites the tab. The list is the tool's whole starting-point
 * library and it was effectively unbrowsable: you found your preset by trying
 * presets.
 *
 * A preset is a plain recipe and both visual renderers already accept one
 * (`readVideoCfg(rec)` / `readImageCfg(rec)`), so a thumbnail is a small
 * offscreen render of exactly what that preset produces — not an illustration
 * of it, and not a screenshot someone has to remember to update.
 *
 * AUDIO IS DELIBERATELY NOT A PICTURE. Rendering forty presets through
 * OfflineAudioContext to draw forty waveforms would take seconds and, at
 * thumbnail size, every dense one looks like the same grey brick. What an
 * author actually wants to know is what is IN it — so the audio card lists the
 * layers and effects the recipe turns on. That is read from the recipe rather
 * than rendered, it is instant, and it is honest about being a summary.
 *
 * Thumbnails render on demand (the gallery starts closed), a few per frame so
 * the interface never blocks, and are cached against the seed they were drawn
 * with — the seed is a control, and a stale thumbnail is worse than none.
 */
import { $, escHtml, log, setVal } from '../core/dom.js';
import { currentSeed } from '../core/rng.js';
import { userPresets } from '../core/recipes.js';
import { PRESETS, presetRecipe } from '../presets/index.js';
import { readVideoCfg, renderVideoFrame } from '../video/render.js';
import { drawImageTo, readImageCfg } from '../image/render.js';

/** Tab → the ids it owns. One table rather than three near-identical branches. */
const TABS = {
  video: { select: 'v-preset', mount: 'v-gallery', toggle: 'v-gallery-btn', view: 'view-video' },
  audio: { select: 'a-preset', mount: 'a-gallery', toggle: 'a-gallery-btn', view: 'view-audio' },
  image: { select: 'i-preset', mount: 'i-gallery', toggle: 'i-gallery-btn', view: 'view-image' },
};

/* Big enough to tell a terminal from a BSOD, small enough that forty of them
   fit in a panel and render in well under a second. */
const THUMB_W = 128, THUMB_H = 96;

const _open = new Set();
/** `${tab}|${name}|${seed}` → canvas. Cleared when the seed or the list moves. */
const _cache = new Map();
/** Pending render jobs, drained a few per animation frame. */
let _queue = [], _draining = false;

/** Every preset for a tab as [group, name, recipe], user presets last. */
function catalogue(tab) {
  const out = [];
  const groups = PRESETS[tab] || {};
  for (const g in groups) for (const n in groups[g]) out.push([g, n, groups[g][n], n]);
  const mine = userPresets(tab) || {};
  // The select's own value for a saved preset is "user:<name>" — the card has
  // to carry that, not the display name, or clicking it would load nothing.
  for (const n in mine) out.push(['My Presets', n, mine[n], 'user:' + n]);
  return out;
}

/** Thumbnails are only true for the seed they were drawn with. */
export function invalidateThumbs() { _cache.clear(); }

/* ------------------------------------------------------------ rendering --- */

function drawVideoThumb(cv, rec) {
  const cfg = readVideoCfg(rec);
  /* Phosphor persistence accumulates consecutive frames of ONE clip through a
     single module-global buffer shared by every renderVideoFrame() caller. A
     thumbnail is one frame of a foreign recipe: with persist on it would
     composite whatever the preview (or the previous card) left in that buffer,
     then overwrite the buffer at card size — flashing this preset across the
     running preview's trail, and vice versa. Rendered with persist off; the
     automation strip covers a recipe that keyframes v-persist back on. */
  cfg.persist = 0;
  if (cfg.__auto && cfg.__auto['v-persist']) {
    cfg.__auto = { ...cfg.__auto };
    delete cfg.__auto['v-persist'];
  }
  const ctx = cv.getContext('2d');
  /* A third of the way in: far enough past a typed-text intro or a fade that
     the card shows the look rather than an empty screen, early enough that a
     scene which ends on a reveal is not spoiled by its own thumbnail. */
  renderVideoFrame(ctx, cv.width, cv.height, cfg, (cfg.duration || 8) * 0.34);
}

function drawImageThumb(cv, rec) {
  const cfg = readImageCfg(rec);
  drawImageTo(cv.getContext('2d'), cv.width, cv.height, cfg);
}

/**
 * What an audio preset turns on, read off the recipe.
 *
 * Derived from the control ids rather than a hand-written table per preset: a
 * table would be a second place to edit and would quietly rot the first time
 * somebody changed a preset's layers.
 */
export function audioSummary(rec) {
  const on = [];
  for (const id in rec) {
    if (rec[id] !== true) continue;
    if (id.startsWith('fx-')) { on.push(id.slice(3).replace(/-.*$/, '')); continue; }
    if (!id.startsWith('a-')) continue;
    const rest = id.slice(2);
    // `a-drone` is a layer; `a-drone-g` is one of its parameters. Only the
    // bare toggles name a layer.
    if (rest.includes('-')) continue;
    if (rest === 'loop' || rest === 'autonorm' || rest === 'trans') continue;
    on.push(rest);
  }
  return [...new Set(on)];
}

function audioCard(rec) {
  const bits = audioSummary(rec);
  const secs = rec['a-dur'] ? `${rec['a-dur']}s` : '';
  const chips = bits.length
    ? bits.map((b) => `<span class="pill">${escHtml(b)}</span>`).join(' ')
    : '<span class="hint">silence — a base to build on</span>';
  return `<div class="gal-audio">${secs ? `<div class="gal-secs">${escHtml(secs)}</div>` : ''}${chips}</div>`;
}

/* Rendered a few per frame rather than all at once: forty video frames in one
   go is a visible freeze, and the gallery is something you open mid-thought. */
function drain() {
  if (_draining) return;
  _draining = true;
  const step = () => {
    const budget = 4;
    for (let i = 0; i < budget && _queue.length; i++) {
      const job = _queue.shift();
      try { job(); } catch (e) { log(`Preset thumbnail failed: ${e.message}`, 'warn'); }
    }
    if (_queue.length) requestAnimationFrame(step);
    else _draining = false;
  };
  requestAnimationFrame(step);
}

/* ---------------------------------------------------------------- panel --- */

export function renderGallery(tab) {
  const ids = TABS[tab];
  const mount = ids && $(ids.mount);
  if (!mount) return 0;
  if (!_open.has(tab)) { mount.replaceChildren(); mount.style.display = 'none'; return 0; }
  mount.style.display = '';

  const seed = currentSeed();
  const list = catalogue(tab);
  const sel = $(ids.select);
  mount.replaceChildren();
  // Only this tab's pending work is dropped — reopening one gallery must not
  // cancel another's thumbnails mid-flight.
  _queue = _queue.filter((j) => j.tab !== tab);

  let group = null;
  for (const [g, name, rec, value] of list) {
    if (g !== group) {
      group = g;
      const h = document.createElement('div');
      h.className = 'gal-group';
      h.textContent = g;
      mount.appendChild(h);
    }
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'gal-card' + (sel && sel.value === value ? ' sel' : '');
    card.title = `Load "${name}"`;
    const label = document.createElement('span');
    label.className = 'gal-name';
    label.textContent = name;

    if (tab === 'audio') {
      const box = document.createElement('div');
      box.innerHTML = audioCard(rec);
      card.appendChild(box);
    } else {
      /* Built-in recipes are frozen constants, so a thumbnail of one is only
         ever invalidated by the seed. A SAVED preset can be overwritten in
         place under the same name, so caching it by name would show the old
         look after "✚ PRESET" — they are few, and they redraw. */
      const cacheable = !String(value).startsWith('user:');
      const key = `${tab}|${value}|${seed}`;
      const hit = cacheable ? _cache.get(key) : null;
      if (hit) card.appendChild(hit);
      else {
        const cv = document.createElement('canvas');
        cv.width = THUMB_W; cv.height = THUMB_H;
        cv.className = 'gal-thumb';
        card.appendChild(cv);
        /* The SAME recipe loading it would apply — tab defaults first, preset
           over the top — not the stored fragment. Presets name only the dozen
           controls their look depends on, so rendering the fragment alone
           produced a picture of the fragment: a one-key preset drew a black
           rectangle, and every other card was subtly not the thing you would
           get by clicking it. Locks are ignored here on purpose: a thumbnail
           answers "what is this preset", and a grid that rearranged itself
           whenever a lock was ticked would answer a different question. */
        const full = presetRecipe(tab, ids.view, rec, { ignoreLocks: true });
        const job = () => {
          (tab === 'video' ? drawVideoThumb : drawImageThumb)(cv, full);
          if (cacheable) _cache.set(key, cv);
        };
        job.tab = tab;
        _queue.push(job);
      }
    }
    card.appendChild(label);
    card.addEventListener('click', () => {
      if (!sel) return;
      /* Through setVal, never a bare assignment to the select. An assignment
         fires no event, so the capture-phase document binding never records
         the choice — and
         the moment applying the preset pushes the document back to the DOM, the
         picker snaps back to whatever the document still says it was. setVal
         dispatches, which both records the pick and runs the picker's own
         change handler: clicking a card is exactly choosing from the list. */
      setVal(ids.select, value);
      renderGallery(tab);
    });
    mount.appendChild(card);
  }
  if (_queue.length) drain();
  return list.length;
}

export function toggleGallery(tab) {
  if (_open.has(tab)) _open.delete(tab); else _open.add(tab);
  const btn = $(TABS[tab]?.toggle);
  if (btn) btn.setAttribute('aria-expanded', _open.has(tab) ? 'true' : 'false');
  const n = renderGallery(tab);
  if (_open.has(tab)) log(`Preset gallery [${tab}]: ${n} looks`, 'info');
  return _open.has(tab);
}

export const galleryOpen = (tab) => _open.has(tab);

export function initGallery() {
  for (const tab of Object.keys(TABS)) {
    const btn = $(TABS[tab].toggle);
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', () => toggleGallery(tab));
    }
    /* Choosing from the dropdown has to move the highlight too. Loading a
       preset applies as an ordinary transaction, so the document binding's
       undo/redo/load refresh never sees it — an open gallery would go on
       marking the preset you had before. */
    $(TABS[tab].select)?.addEventListener('change', () => renderGallery(tab));
  }
  // A new seed is a different picture, so every cached thumbnail is a lie the
  // moment it changes. Repaint whatever is open rather than leaving it stale.
  $('seed')?.addEventListener('change', () => {
    invalidateThumbs();
    for (const tab of _open) renderGallery(tab);
  });
}

/** Panel hints, in the shape ui/params.js uses. */
export function galleryParamHints() {
  return {
    'v-gallery-btn': ['Preset gallery', 2,
      'Renders every preset in the list as a real frame, at your current seed, so you can '
      + 'pick a look by looking at it instead of loading forty of them in turn. Click a card '
      + 'to load it.'],
    'i-gallery-btn': ['Preset gallery', 2,
      'Every screen preset drawn as the screen it makes. Click a card to load it.'],
    'a-gallery-btn': ['Preset contents', 2,
      'Sound has no thumbnail worth drawing — forty waveforms at this size all look like the '
      + 'same grey brick — so each card lists the layers and effects the preset switches on. '
      + 'Read off the recipe, so it cannot drift from what the preset actually does.'],
  };
}
