/* Dead Signal Studio — ui/nle.js
 *
 * The editor shell: menu bar, toolbar, media bin, monitor transport, timeline
 * dock, status bar.
 *
 * WHY THIS EXISTS
 *
 * The studio could make broadcast-grade material and looked like a settings
 * dialog. Everything was a tab of sliders; the sequence was a strip at the
 * bottom of one of them; there was no timecode, no transport, no bin, no menu,
 * and nothing on screen told you what the tool would do next. People who edit
 * video for a living have a shape in their heads — source on the left, picture
 * in the middle, properties on the right, time along the bottom — and meeting
 * that shape is most of what "professional" means in an editor.
 *
 * HOW IT IS BUILT
 *
 * As a re-layout of the page's own markup. The chrome here is new, but every
 * control it drives is an existing one: the transport clicks the same play
 * button the VIDEO workspace has, the menus call the same functions the
 * buttons call. That is deliberate and it is what makes this safe to ship —
 *
 *   - every id survives, so document binding, the palette, Explain mode and the
 *     complexity filter keep working;
 *   - there is one implementation of every action. A menu item that duplicated
 *     the logic of its button would drift from it within a release.
 *
 * This shell used to be one of three layouts behind toggles (classic tabs, a
 * three-pane workspace, the editor). It is the only one now: enterEditor()
 * runs once at boot and the moves it makes are permanent. The old tab strip
 * survives as the workspace switcher — same tablist, same keyboard model.
 *
 * The one real DOM move is the sequence lane (#tl-track), which is docked into
 * the timeline pane so it is visible from every workspace rather than only on
 * the TIMELINE workspace.
 */
import { $, isEnabled, toast } from '../core/dom.js';
import { anyModalOpen, modalTrap } from './modaltrap.js';
import { download } from '../core/blobs.js';
import { syncChromeToSkin } from '../core/palettes.js';
import { BIN_DRAG_TYPE, chooseFiles, useAsset } from './importui.js';
import { getStore } from '../doc/session.js';
import { MAX_START, MIN_CLIP, clipLength, isOverlay, sourceTimeOf } from '../doc/timeline.js';
import { library, onLibraryChange } from '../library/library.js';
import { PREVIOUS_PROJECT_KEY, applyProject, lsGet as projGet } from '../core/recipes.js';
import { loadSample, openWelcome } from './welcome.js';
import { activateTab } from './shell.js';
import { onClipSelect, selectedClip, selectedRef, focusClipAfterRender, renderTrack, setTrackZoom, trackScale, zoomToFit } from './track.js';
import { buildInspectorPane, initInspector, render as renderInspector } from './inspector.js';
import {
  addAudioClip, addGraphicClip, addOverlayClip, addStillClip, addTimelineClip, addTitleClip,
  audioTimeline, buildSchedule,
  clearTimeline, commitAudioClips, commitClips, timeline, tlScrubT,
} from '../video/timeline.js';

const SKIN_KEY = 'deadsignal.editor.skin';

let built = false;

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/* ------------------------------------------------------------ timecode -- */

/**
 * Seconds as HH:MM:SS:FF.
 *
 * Frames, not decimals: an editor counts in frames, and "3.47s" cannot be typed
 * back in or matched against a cut. The frame rate is the sequence's own, so
 * the last field means what it says.
 */
export function timecode(seconds, fps = 12) {
  const f = Math.max(1, Math.round(fps));
  const total = Math.max(0, seconds);
  const whole = Math.floor(total);
  const frames = Math.min(f - 1, Math.floor((total - whole) * f));
  const hh = String(Math.floor(whole / 3600)).padStart(2, '0');
  const mm = String(Math.floor((whole % 3600) / 60)).padStart(2, '0');
  const ss = String(whole % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}:${String(frames).padStart(2, '0')}`;
}

/* ------------------------------------------------------- edit commands -- */

/**
 * Which clip is under time `t`, and how far into it that is.
 *
 * With two tracks the playhead can be over two clips at once, so "the clip
 * under the playhead" needs a tie-break. The selected one wins: an author who
 * has clicked an overlay and pressed S means that overlay, and razoring the
 * footage underneath it instead would be the tool guessing wrong about the one
 * thing it was told. Failing that it is the spine, which is what the playhead
 * is measured against.
 *
 * @returns {{i:number, local:number}|null}
 */
export function clipAt(t) {
  const { starts } = buildSchedule();
  const covers = (i) => {
    const c = timeline[i];
    return !!c && t >= starts[i] - 1e-6 && t < starts[i] + clipLength(c) - 1e-6;
  };
  const sel = selectedClip();
  if (sel >= 0 && covers(sel)) return { i: sel, local: t - starts[sel] };
  for (let i = 0; i < timeline.length; i++) {
    if (!isOverlay(timeline[i]) && covers(i)) return { i, local: t - starts[i] };
  }
  return null;
}

/**
 * Index of the SPINE clip covering `t`, or -1 — the same scan clipAt() falls
 * back to, but with no selection tie-break, so a selected overlay cannot decide
 * where a spine paste lands.
 */
function spineClipAt(t) {
  const { starts } = buildSchedule();
  for (let i = 0; i < timeline.length; i++) {
    const c = timeline[i];
    if (!isOverlay(c) && t >= starts[i] - 1e-6 && t < starts[i] + clipLength(c) - 1e-6) return i;
  }
  return -1;
}

/**
 * Razor: cut the clip under the playhead in two at that point.
 *
 * The two halves are the same source with adjacent trims — which is what a
 * split IS, and why it costs nothing to render. The right-hand half enters on a
 * cut: a dissolve inherited from the clip it was severed from would put a
 * transition in the middle of what used to be continuous footage.
 */
export function splitAtPlayhead() {
  const hit = clipAt(tlScrubT);
  if (!hit) { toast('Put the playhead over a clip to split it'); return false; }
  const c = timeline[hit.i];
  /* SOURCE time, through the one function that knows how to get there.
     `hit.local` is where the razor fell along the SEQUENCE; `in` and `out` are
     positions in the source file. Those are the same number only at speed 1
     playing forwards. `in + local` cut a 2× clip a quarter of the way in when
     the razor was at its midpoint, and on a reversed clip it measured from the
     wrong end entirely — so the two halves came out in the wrong order.
     sourceTimeOf() is where the renderer, the keyframe panel and the mixer all
     agree about this; the razor now agrees with them too. */
  const cut = sourceTimeOf(c, hit.local);
  /* Both halves have to survive normalizeClips' minimum length, or the split
     silently produces one clip and a discarded sliver. The RENDERED length is
     what MIN_CLIP bounds for the lane, but makeClip ALSO enforces MIN_CLIP on
     the SOURCE window — and for a slow clip (speed < 1) a legal rendered length
     maps to a source window shorter than MIN_CLIP, so makeClip's fallback reset
     the sliver half to the whole source and the split silently duplicated the
     clip. Guard both: the rendered halves and the source windows (round2'd like
     makeClip stores them, with the same epsilon). */
  const len = clipLength(c);
  const rcut = Math.round(cut * 100) / 100;
  if (hit.local < MIN_CLIP || len - hit.local < MIN_CLIP
      || rcut - c.in < MIN_CLIP - 1e-6 || c.out - rcut < MIN_CLIP - 1e-6) {
    toast('Too close to the edge to split');
    return false;
  }
  /* Reversed, the first half of what you SAW is the top of the source window,
     so it is the half whose `in` moves — the opposite of the forward case.
     Assigning `out` to the left half regardless played the second half of the
     material first. */
  const left = c.reverse ? { ...c, in: cut } : { ...c, out: cut };
  const right = c.reverse ? { ...c, out: cut, transition: 'cut' }
                          : { ...c, in: cut, transition: 'cut' };
  if (isOverlay(c)) {
    /* An overlay is positioned, so the right half has to be TOLD where it
       starts — otherwise both halves sit at the same time and play on top of
       each other. It starts where the razor fell, which is the playhead.

       Both halves cut. An overlay fades out as well as in, so leaving the fade
       on the left half would dip it to nothing in the middle of what used to be
       continuous material and then snap back — the same reason the spine's
       right-hand half does not inherit a dissolve. The author puts the fade
       back on whichever piece is now the one arriving or leaving. */
    left.transition = 'cut';
    right.at = Math.round(tlScrubT * 100) / 100;
  }
  const next = timeline.slice();
  next.splice(hit.i, 1, left, right);
  commitClips(next, 'split clip');
  focusClipAfterRender(hit.i + 1);
  toast('Split');
  return true;
}

/**
 * Remove whatever is selected and close the gap.
 *
 * Branching on the LANE, not on the index: the sounds are a separate array, so
 * an index alone cannot say which thing the author means.
 */
export function rippleDelete() {
  const { lane, i } = selectedRef();
  if (lane === 'A') {
    if (i < 0 || !audioTimeline[i]) { toast('Select a sound first'); return false; }
    const next = audioTimeline.slice();
    next.splice(i, 1);
    commitAudioClips(next, 'delete sound');
    return true;
  }
  if (i < 0 || !timeline[i]) { toast('Select a clip first'); return false; }
  const next = timeline.slice();
  next.splice(i, 1);
  commitClips(next, 'delete clip');
  focusClipAfterRender(Math.min(i, next.length - 1));
  return true;
}

/** Duplicate what is selected directly after itself. */
export function duplicateClip() {
  const { lane, i } = selectedRef();
  if (lane === 'A') {
    if (i < 0 || !audioTimeline[i]) { toast('Select a sound first'); return false; }
    const src = audioTimeline[i];
    const next = audioTimeline.slice();
    /* Offset by its own length rather than stacked on top of the original —
       two copies of a sound at the same instant is a doubling in the mix, not
       a duplicate an author can see. */
    next.splice(i + 1, 0, { ...src, at: (src.at ?? 0) + Math.max(0.1, (src.out ?? 0) - (src.in ?? 0)) });
    commitAudioClips(next, 'duplicate sound');
    return true;
  }
  if (i < 0 || !timeline[i]) { toast('Select a clip first'); return false; }
  const src = timeline[i];
  const next = timeline.slice();
  // An overlay is positioned by `at`, so a copy left at the same `at` stacks
  // exactly on the original — invisible in the lane, and doubling the picture
  // where it lands. Offset it by its own length, as the audio branch does; a
  // spine clip needs no offset because the splice slot places it adjacent.
  const copy = isOverlay(src)
    ? { ...src, at: Math.min(MAX_START, Math.round(((src.at ?? 0) + clipLength(src)) * 100) / 100) }
    : { ...src };
  next.splice(i + 1, 0, copy);
  commitClips(next, 'duplicate clip');
  focusClipAfterRender(i + 1);
  return true;
}

/* ============================================================ clipboard ==

   Split, razor, duplicate and ripple delete were all here; a clipboard was not.
   So a clip could be cut in half and copied to the slot next to it and moved
   nowhere else — you could not lift a look you had built at 0:04 and put it at
   1:20, and you certainly could not carry one between two projects.

   Held in a module variable rather than the system clipboard, deliberately. A
   clip is a recipe, a trim, a transform and a reference to a library asset; the
   asset does not travel with it, so a paste into a different project would land
   a clip pointing at footage that is not there. Same-session is the honest
   scope, and it is what makes the operation instant and undoable.
   ========================================================================= */

/* What was last copied, and which lane it came from — a bare object cannot say
   whether it is a picture or a sound, and the two go into different arrays. */
let _clip = null;

/** Copy the selection. Returns false when there is nothing selected. */
export function copyClip() {
  const { lane, i } = selectedRef();
  const src = lane === 'A' ? audioTimeline[i] : timeline[i];
  if (i < 0 || !src) { toast('Select something to copy first'); return false; }
  /* A snapshot, not a reference. The live projection is rebuilt on every commit
     and its `id` is re-minted each time, so holding the object would give a
     paste whatever that slot happens to contain by the time it is used. */
  const { id, ...plain } = src;
  _clip = { lane, data: JSON.parse(JSON.stringify(plain)) };
  toast(lane === 'A' ? 'Sound copied' : 'Clip copied');
  return true;
}

/**
 * Paste at the playhead.
 *
 * Where "at the playhead" means depends on what is being pasted, and each
 * answer is the only sensible one for its kind — the same split the two lanes
 * have everywhere else in this tool:
 *
 *   a sound, or an overlay  →  starts AT the playhead, because those are
 *                              positioned and the playhead is a position.
 *   a spine clip            →  goes in AFTER whatever the playhead is over,
 *                              because the spine is an order and a time is not
 *                              a slot in one. Appended when the playhead is
 *                              past the end.
 */
export function pasteClip() {
  if (!_clip) { toast('Nothing copied yet'); return false; }
  const at = Math.round(tlScrubT * 100) / 100;
  const data = JSON.parse(JSON.stringify(_clip.data));
  if (_clip.lane === 'A') {
    commitAudioClips([...audioTimeline, { ...data, at }], 'paste sound');
    toast('Sound at ' + at.toFixed(1) + 's');
    return true;
  }
  const next = timeline.slice();
  if (isOverlay(data)) {
    next.push({ ...data, at });
    commitClips(next, 'paste overlay');
    focusClipAfterRender(next.length - 1);
    toast('Overlay at ' + at.toFixed(1) + 's');
    return true;
  }
  // The covering SPINE clip, NOT clipAt() — clipAt's selection tie-break can
  // return a selected V2 overlay, whose array index says nothing about spine
  // order, so the pasted spine clip would land at the overlay's slot (usually
  // the array end) instead of after the clip the playhead is actually over.
  const si = spineClipAt(tlScrubT);
  const to = si >= 0 ? si + 1 : next.length;
  next.splice(to, 0, data);
  commitClips(next, 'paste clip');
  focusClipAfterRender(to);
  toast('Clip pasted');
  return true;
}

/** Whether there is anything to paste — for the menu's enabled state. */
export const hasCopiedClip = () => !!_clip;

/* ---------------------------------------------------------- transport -- */

/**
 * The play/pause + scrub controls of whichever view is on screen — or null on
 * a workspace with no transport at all.
 *
 * Null matters. This used to fall through to the VIDEO targets on SCREEN,
 * LIBRARY, BUNDLE, CLOUD and HELP, so Space and every transport button
 * silently paused or scrubbed the hidden VIDEO preview — worse than a no-op,
 * because coming back to VIDEO found it parked somewhere never asked for.
 */
function transportTargets() {
  const view = document.querySelector('.tab.active')?.dataset.view;
  if (view === 'timeline') return { view, play: $('tl-playpause'), scrub: $('tl-scrub'), fps: () => Number($('tl-fps')?.value) || 12, dur: () => buildSchedule().duration };
  if (view === 'audio') return { view, play: $('a-play'), scrub: null, fps: () => 12, dur: () => Number($('a-dur')?.value) || 0 };
  if (view === 'video') return { view, play: $('v-playpause'), scrub: $('v-scrub'), fps: () => Number($('v-fps')?.value) || 12, dur: () => Number($('v-dur')?.value) || 0 };
  return null;
}

function transport(action) {
  const t = transportTargets();
  if (!t) return;
  if (action === 'playpause') { t.play?.click(); return; }
  if (!t.scrub) return;
  const max = Number(t.scrub.max) || 1000;
  const cur = Number(t.scrub.value) || 0;
  const frame = t.dur() > 0 ? max / (t.dur() * t.fps()) : max / 100;
  /* `end` lands on the LAST FRAME, not one past it. `max` is the end of the
     range, which is the out-point of the last clip — past every clip's cover
     test, so the picture went black and every playhead command reported nothing
     there: S said "put the playhead over a clip to split it", and the three
     add-at-playhead commands placed beyond the sequence. One frame back is
     where End goes in every editor, and it is the last frame that exists. */
  const step = { start: -cur, end: Math.max(-cur, max - cur - frame), back: -frame, fwd: frame,
                 backs: -frame * 10, fwds: frame * 10 }[action] ?? 0;
  t.scrub.value = String(Math.max(0, Math.min(max, cur + step)));
  t.scrub.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Keep the transport buttons honest about the workspace: disabled where they
 * would do nothing (all of them on LIBRARY-like views, everything but play
 * on AUDIO, which has no scrubber), and the play button mirroring the glyph
 * of the real control it proxies, so playing state shows here too.
 */
function syncTransport() {
  const t = transportTargets();
  const scrubbable = !!t?.scrub;
  for (const a of ['start', 'backs', 'back', 'fwd', 'fwds', 'end']) {
    const b = $('nle-t-' + a);
    if (b) b.disabled = !scrubbable;
  }
  const play = $('nle-t-playpause');
  if (play) {
    play.disabled = !t;
    // ▮/❚ in the proxied button's label means "playing — click pauses".
    play.textContent = !t ? '▶ ❚❚' : /[▮❚]/.test(t.play?.textContent || '') ? '❚❚' : '▶';
    /* A proxy for a button that is standing right beside it is not a proxy, it
       is a second play button. VIDEO and TIMELINE carry their own scrub row and
       that row is docked into this bar (see dockScrub), so on those two the
       real control is already here and this one steps aside. AUDIO's play lives
       in its render bar and SCREEN has no transport at all, so there the proxy
       is the only play button in the transport and stays. */
    play.hidden = !!(t?.play && $('nle-scrub-dock')?.contains(t.play));
  }
}

/* ---------------------------------------------------------- scrub dock -- */

/** Where each scrub row came from, so it can always be put back. */
const _scrubHome = new WeakMap();

/**
 * Dock the open workspace's scrub row into the transport bar.
 *
 * VIDEO and TIMELINE each ship a `.scrub` row — play, position, elapsed —
 * directly under the picture, nine pixels above a transport bar offering play,
 * position and elapsed. Two play buttons and two clocks for one clip is the
 * kind of duplication that makes a tool feel bigger than it is, and it cost the
 * monitor a row of its height to say the same thing twice.
 *
 * The row is MOVED rather than rebuilt, which is the pattern enterEditor
 * already uses for the header settings, the activity log and the stage meters:
 * same nodes, same ids, same listeners, same document bindings, so nothing that
 * addresses `#v-scrub` or `#tl-playpause` — the palette, the tests, the
 * keyboard model — can tell the difference.
 *
 * Exactly one row is docked at a time, and the one leaving goes back to the
 * slot it came from (before its recorded next sibling, so it lands where it
 * was rather than at the end of the panel).
 */
function dockScrub() {
  const dock = $('nle-scrub-dock');
  if (!dock) return;
  /* Stamped once, while every row is still inside the view that owns it: a
     docked row is out of its view's subtree, so "which workspace does this
     belong to" cannot be asked structurally after the first move. */
  for (const row of document.querySelectorAll('.view .scrub:not([data-scrub-view])')) {
    const owner = row.closest('.view');
    if (owner) row.dataset.scrubView = owner.id;
  }
  const active = document.querySelector('.view.active')?.id || '';
  const wanted = active ? document.querySelector(`.scrub[data-scrub-view="${CSS.escape(active)}"]`) : null;
  for (const row of [...dock.children]) {
    if (row === wanted) continue;
    const home = _scrubHome.get(row);
    if (home?.parent) home.parent.insertBefore(row, home.next && home.next.parentElement === home.parent ? home.next : null);
    else row.remove();
  }
  if (wanted && wanted.parentElement !== dock) {
    if (!_scrubHome.has(wanted)) _scrubHome.set(wanted, { parent: wanted.parentElement, next: wanted.nextElementSibling });
    dock.appendChild(wanted);
  }
}

/* --------------------------------------------------------------- menus -- */

/** Nudge the timeline zoom and keep the slider in the timeline pane honest. */
function nudgeZoom(factor) {
  setTrackZoom(trackScale().zoom * factor);
  const z = $('nle-zoom');
  if (z) z.value = String(Math.round(trackScale().zoom * 100));   /* dom-only: reflecting view state */
}

const ACTIONS = {
  /* Labels may be functions, resolved when the menu opens: the store keeps
     each entry's own name, and "Undo trim out" is worth more than "Undo". */
  undo: { label: () => { const l = getStore()?.undoLabel; return l ? `Undo ${l}` : 'Undo'; },
          key: 'Ctrl+Z', run: () => getStore()?.undo(), can: () => !!getStore()?.canUndo },
  redo: { label: () => { const l = getStore()?.redoLabel; return l ? `Redo ${l}` : 'Redo'; },
          key: 'Ctrl+Shift+Z', run: () => getStore()?.redo(), can: () => !!getStore()?.canRedo },
  split: { label: 'Split at playhead', key: 'S', run: splitAtPlayhead, can: () => timeline.length > 0 },
  ripple: { label: 'Delete clip', key: 'Del', run: rippleDelete, can: () => selectedRef().i >= 0 },
  dup: { label: 'Duplicate clip', key: 'Ctrl+D', run: duplicateClip, can: () => selectedRef().i >= 0 },
  copy: { label: 'Copy', key: 'Ctrl+C', run: copyClip, can: () => selectedRef().i >= 0 },
  paste: { label: 'Paste at playhead', key: 'Ctrl+V', run: pasteClip, can: hasCopiedClip },
  addScene: { label: 'Add current scene', key: '', run: () => addTimelineClip() },
  addStill: { label: 'Add current screen', key: '', run: () => addStillClip(Number($('tl-stilldur')?.value) || 3) },
  addOverlay: { label: 'Add as overlay at playhead', key: '', run: () => addOverlayClip(tlScrubT) },
  addTitle: { label: 'Add a title at playhead', key: '', run: () => addTitleClip(tlScrubT) },
  addShape: { label: 'Add a shape at playhead', key: '', run: () => addGraphicClip(tlScrubT) },
  addSound: { label: 'Add sound at playhead', key: '', run: () => addAudioClip({ at: tlScrubT }) },
  clearSeq: { label: 'Clear sequence', key: '', run: () => clearTimeline(), can: () => timeline.length > 0 },
  saveProj: { label: 'Save project…', key: 'Ctrl+S', run: () => $('proj-save')?.click() },
  openProj: { label: 'Open project…', key: '', run: () => $('proj-load')?.click() },
  importMedia: { label: 'Import media…', key: '', run: () => chooseFiles() },
  record: { label: 'Export sequence…', key: '', run: () => { activateTab('timeline'); $('tl-record')?.click(); }, can: () => timeline.length > 0 },
  exportNow: { label: () => { const t = exportTarget(); return t ? `${t.label}…` : 'Export…'; },
               key: 'Ctrl+E', run: () => exportCurrent(), can: () => !!exportTarget() },
  media: { label: 'Open media list…', key: '', run: () => activateTab('library') },
  exportVideo: { label: 'Export video clip…', key: '', run: () => { activateTab('video'); $('v-record')?.click(); } },
  palette: { label: 'Search everything…', key: 'Ctrl+K', run: () => $('palette-open')?.click() },
  explain: { label: 'Explain mode', key: '?', run: () => $('explain-toggle')?.click() },
  zoomIn: { label: 'Zoom in on the timeline', key: '', run: () => nudgeZoom(1.25) },
  zoomOut: { label: 'Zoom out of the timeline', key: '', run: () => nudgeZoom(1 / 1.25) },
  zoomFit: { label: 'Fit the whole sequence', key: '', run: () => { zoomToFit(); const z = $('nle-zoom'); if (z) z.value = String(Math.round(trackScale().zoom * 100)); } },
  skin: { label: 'Toggle CRT skin', key: '', run: () => toggleSkin() },
  help: { label: 'Help', key: '', run: () => activateTab('help') },
  shortcuts: { label: 'Keyboard shortcuts', key: '', run: () => openShortcuts() },
  /* The sample project is the studio's only guided starting point, and once
     the welcome card had been dismissed — which the first Escape or the first
     START EMPTY does — it could be reached only by someone who already knew to
     press Ctrl+K. The three panes a new author is actually looking at (bin,
     CLIP, sequence) offered no route to it at all. */
  sample: { label: 'Load the sample project…', key: '', run: () => loadSample() },
  welcome: { label: 'Show the welcome card', key: '', run: () => openWelcome() },
  /* Loading a project, or the sample, keeps a copy of the outgoing one — and
     the only way to get it back was to paste an expression into the browser
     console, which the message saying so was itself displayed inside. A safety
     net you cannot reach without devtools is not one. */
  restorePrevious: {
    label: 'Restore previous project', key: '',
    run: () => {
      const prev = projGet(PREVIOUS_PROJECT_KEY, null);
      if (!prev) { toast('No previous project kept', 'info'); return; }
      if (typeof confirm === 'function'
          && !confirm('Restore the previous project? It replaces the current document.')) return;
      applyProject(prev);
    },
    can: () => !!projGet(PREVIOUS_PROJECT_KEY, null),
  },
};

/* Ten File items became six, and nothing became unreachable.
   Three of the ten were the same export stated three ways — "Export what I am
   looking at", "Export video clip…", "Export sequence…" — beside a ⤓ EXPORT
   button in the menubar that is already workspace-aware and says which of the
   three it will do; and "Open media list…" was a menu item whose whole job was
   to press a tab two rows below it. What replaces them is the one thing File
   was missing: a way back to the project a load replaced. */
const MENUS = [
  ['File', ['openProj', 'saveProj', '-', 'importMedia', '-', 'exportNow', '-', 'restorePrevious']],
  ['Edit', ['undo', 'redo', '-', 'copy', 'paste', '-', 'split', 'dup', 'ripple', '-', 'clearSeq']],
  ['Clip', ['addScene', 'addStill', '-', 'addTitle', 'addShape', 'addOverlay', 'addSound']],
  ['View', ['palette', 'explain', '-', 'zoomIn', 'zoomOut', 'zoomFit', '-', 'skin']],
  ['Help', ['sample', 'welcome', '-', 'help', 'shortcuts']],
];

function closeMenus() {
  /* The wrapper's `open` attribute is bookkeeping; what the eye sees is the
     popup's `hidden`. Clearing one without the other left every opened menu
     on screen forever — Escape and outside clicks changed state and hid
     nothing, and the stuck popup sat over the workspace tabs. */
  document.querySelectorAll('.nle-menu[open]').forEach((d) => {
    d.removeAttribute('open');
    const pop = d.querySelector('.nle-menu-pop');
    if (pop) pop.hidden = true;
    const btn = d.querySelector('button[aria-haspopup]');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
}

function buildMenu(name, items) {
  const wrap = document.createElement('div');
  wrap.className = 'nle-menu';
  const btn = document.createElement('button');
  btn.type = 'button';
  /* Every control in this studio is addressed by id — the document binding,
     the command palette, Explain mode and the test suites all work that way.
     Chrome built in JS is no exception, or it is the one part of the tool
     nothing else can reach. */
  btn.id = `nle-menu-${name.toLowerCase()}`;
  btn.textContent = name;
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  wrap.appendChild(btn);

  const pop = document.createElement('div');
  pop.className = 'nle-menu-pop';
  pop.hidden = true;
  pop.setAttribute('role', 'menu');
  wrap.appendChild(pop);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = wrap.hasAttribute('open');
    closeMenus();
    if (open) return;
    // Enabled state and labels are decided when the menu opens, not when it
    // was built: Undo is available or not — and named or not — depending on
    // what just happened.
    pop.replaceChildren();
    for (const key of items) {
      if (key === '-') { const s = document.createElement('div'); s.className = 'nle-menu-sep'; pop.appendChild(s); continue; }
      const a = ACTIONS[key];
      if (!a) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      const span = document.createElement('span');
      span.textContent = typeof a.label === 'function' ? a.label() : a.label;
      b.appendChild(span);
      if (a.key) { const k = document.createElement('kbd'); k.textContent = a.key; b.appendChild(k); }
      if (a.can && !a.can()) b.disabled = true;
      /* Focus goes back to the menu's own trigger before the action runs.
         Closing the popup destroys the item that had focus, so focus collapsed
         to <body> — pick Edit ▸ Split from the keyboard and the next Tab landed
         on the skip link rather than back on Edit. Restored BEFORE the action,
         so an action that moves focus itself (the palette, an import dialog)
         still wins. Escape two lines below already did this. */
      b.addEventListener('click', () => {
        closeMenus();
        try { btn.focus({ preventScroll: true }); } catch { /* detached */ }
        try { a.run(); } catch (err) { console.error(err); }
        refreshStatus();
      });
      pop.appendChild(b);
    }
    wrap.setAttribute('open', '');
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    // role="menu" promises the arrow-key model, so deliver it: focus moves in
    // when the menu opens and the arrows walk the items.
    pop.querySelector('button:not(:disabled)')?.focus();
  });

  // The APG menu keyboard model, minus submenus (there are none): arrows walk
  // the enabled items, Home/End jump, Escape closes and returns focus.
  pop.addEventListener('keydown', (e) => {
    const items2 = [...pop.querySelectorAll('button:not(:disabled)')];
    if (!items2.length) return;
    const i = items2.indexOf(document.activeElement);
    let j = null;
    if (e.key === 'ArrowDown') j = i < 0 ? 0 : (i + 1) % items2.length;
    else if (e.key === 'ArrowUp') j = i < 0 ? items2.length - 1 : (i - 1 + items2.length) % items2.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = items2.length - 1;
    else if (e.key === 'Escape') { closeMenus(); btn.focus(); e.preventDefault(); e.stopPropagation(); return; }
    else return;
    e.preventDefault();
    items2[j].focus();
  });

  return wrap;
}

/* ------------------------------------------------------ shortcut sheet -- */

/**
 * Every binding the editor answers to, in one dialog — generated from a
 * table here rather than typed into HELP prose, so it cannot drift from the
 * handlers without the drift being one screen away from the reader.
 */
const SHORTCUTS = [
  ['Transport', [
    ['Space / K', 'Play or pause the workspace you are in'],
    ['J / L', 'Back / forward ten frames'],
    ['← / →', 'Back / forward one frame'],
    ['Home / End', 'Go to the start / end'],
  ]],
  ['Editing', [
    ['S or C', 'Split the clip under the playhead'],
    ['Del / Backspace', 'Delete the selected clip'],
    ['Ctrl+C / Ctrl+V', 'Copy the selection / paste at the playhead'],
    ['Ctrl+D', 'Duplicate the selected clip'],
    ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
    ['← / → on a selected block', 'Trim it (Shift: by 1s · Alt: reorder)'],
  ]],
  ['Studio', [
    ['Ctrl+K', 'Search every setting, scene, preset and action'],
    ['Ctrl+E', 'Export what you are looking at'],
    ['Ctrl+S', 'Save the project file'],
    ['1–8', 'Switch workspace'],
    ['R', 'Record / render the current workspace'],
    ['G', 'Randomize the current workspace'],
    ['?', 'Explain mode — click any control to learn it'],
  ]],
];

/* The shortcut sheet's focus trap and the control that opened it.
 *
 * It declares aria-modal="true" and had neither: Tab walked straight out of a
 * dialog that had just told assistive tech the page behind it was inert, into
 * the menu bar and every control under it, with no way back — the exact defect
 * welcome.js's header records as having been fixed once already for the welcome
 * card. Closing it left focus on a now-hidden button, which collapses to <body>,
 * so a keyboard user was returned to the top of the document rather than to the
 * menu item they opened it from. */
const _keysTrap = modalTrap(() => $('nle-keys'));
let _keysOpener = null;

function closeShortcuts() {
  const overlay = $('nle-keys');
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  _keysTrap.release();
  if (_keysOpener && document.contains(_keysOpener)) {
    try { _keysOpener.focus({ preventScroll: true }); } catch { _keysOpener.focus(); }
  }
  _keysOpener = null;
}

function openShortcuts() {
  const opener = document.activeElement;
  _keysOpener = opener && opener !== document.body ? opener : null;
  let overlay = $('nle-keys');
  if (!overlay) {
    overlay = el('div', 'nle-keys');
    overlay.id = 'nle-keys';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Keyboard shortcuts');
    const card = el('div', 'nle-keys-card');
    const head = el('div', 'nle-keys-head');
    head.appendChild(el('h2', null, 'Keyboard shortcuts'));
    const close = el('button', 'btn small', '✕ CLOSE');
    close.type = 'button';
    close.id = 'nle-keys-close';
    close.addEventListener('click', closeShortcuts);
    head.appendChild(close);
    card.appendChild(head);
    for (const [group, rows] of SHORTCUTS) {
      card.appendChild(el('h3', 'nle-keys-group', group));
      const dl = el('dl', 'nle-keys-list');
      for (const [keys, what] of rows) {
        const dt = el('dt');
        for (const part of keys.split(' / ')) {
          if (dt.childNodes.length) dt.appendChild(document.createTextNode(' / '));
          const kbd = document.createElement('kbd');
          kbd.textContent = part;
          dt.appendChild(kbd);
        }
        dl.appendChild(dt);
        dl.appendChild(el('dd', null, what));
      }
      card.appendChild(dl);
    }
    overlay.appendChild(card);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeShortcuts(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) closeShortcuts(); });
    document.body.appendChild(overlay);
  }
  overlay.hidden = false;
  _keysTrap.engage();
  $('nle-keys-close')?.focus();
}

export const isShortcutsOpen = () => { const o = $('nle-keys'); return !!o && !o.hidden; };

/* ------------------------------------------------------------ the bin -- */

function renderBin() {
  const list = $('nle-bin-list');
  const count = $('nle-bin-count');
  if (!list) return;
  /* A full rebuild fires whenever an export lands or an undo moves the
     library — which is exactly when a keyboard user is mid-way through the
     bin. Note where they were and put them back, the same courtesy
     renderTrack already extends to the lane. */
  const pane = $('nle-bin');
  const hadFocus = document.activeElement?.closest?.('.nle-bin-item');
  const focusKey = hadFocus?.dataset.key;
  const scrollTop = pane ? pane.scrollTop : 0;
  list.replaceChildren();
  if (count) count.textContent = String(library.length);

  if (!library.length) {
    const p = document.createElement('p');
    p.className = 'nle-empty';
    p.textContent = 'Drop files anywhere, or press ＋. Everything you export lands here too.';
    list.appendChild(p);
    return;
  }

  for (const it of library) {
    /* A row, not a single button: the download has to be its own control.
       Getting a finished render OUT of the tool used to mean noticing the
       "→ library" toast, finding the LIBRARY tab, and finding the row — so the
       most common thing anyone wants to do with this studio was three
       discoveries deep. The bin is on screen in every workspace, so the button
       belongs here, on the thing itself. */
    const row = document.createElement('div');
    row.className = 'nle-bin-item';
    row.dataset.key = it.key;

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nle-bin-open';
    const th = document.createElement('span');
    th.className = 'nle-bin-thumb';
    // The library row already carries a thumbnail for stills; anything else
    // gets a glyph for its kind rather than a broken image.
    if (it.thumb) th.style.backgroundImage = `url("${String(it.thumb).replace(/"/g, '%22')}")`;
    else th.textContent = it.kind === 'music' ? '♪' : it.kind === 'image' ? '▣' : '▶';
    const nm = document.createElement('span');
    nm.className = 'nle-bin-name';
    nm.textContent = it.name || it.key || 'asset';
    const kd = document.createElement('span');
    kd.className = 'nle-bin-kind';
    kd.textContent = it.kind || 'clip';
    b.append(th, nm, kd);
    const what = it.kind === 'videos' ? 'use as the video source'
      : it.kind === 'image' ? 'use as the screen image'
        : 'pick for the audio lane';
    b.title = `${it.name || 'asset'}${it.seconds ? ` — ${(+it.seconds).toFixed(1)}s` : ''} — ${what}`;
    /* Clicking an asset USES it. It used to open the LIBRARY tab, which is a
       list of everything rather than an answer to "I want to work with this
       one" — and with nothing importable in the library, using one was not a
       thing you could do at all. The card marks itself selected first, so
       the workspace jump that follows is legible as "that one, doing that". */
    b.addEventListener('click', () => {
      list.querySelectorAll('.nle-bin-item[aria-selected]').forEach((x) => x.removeAttribute('aria-selected'));
      row.setAttribute('aria-selected', 'true');
      useAsset(it);
    });

    /* Draggable onto the sequence. HTML5 drag rather than pointer capture,
       because the lane's own pointer handlers own the pointer once a gesture
       starts on it — and because a native drag gives the cursor, the ghost and
       the escape-to-cancel for free. The payload is the library KEY: a data
       transfer crosses into other windows, so it carries a name, never an
       object. */
    b.draggable = true;
    b.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData(BIN_DRAG_TYPE, it.key);
      // A plain-text fallback so dropping on a text field does something sane
      // rather than pasting "[object Object]".
      e.dataTransfer.setData('text/plain', `${it.name}.${it.ext}`);
    });

    const dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'nle-bin-dl';
    dl.textContent = '⤓';
    const file = `${it.name || 'asset'}.${it.ext || 'bin'}`;
    if (it.blob) {
      dl.title = `Download ${file}`;
      dl.setAttribute('aria-label', `Download ${file}`);
      dl.addEventListener('click', () => { download(it.blob, file); toast(`Downloading ${file}`); });
    } else {
      /* A row restored from a project whose bytes are not in this browser keeps
         its name and its place — but there is nothing to download, and a button
         that silently does nothing is worse than one that says why. */
      dl.disabled = true;
      dl.title = `${file} — this project was opened without its files, so there is nothing to download`;
      dl.setAttribute('aria-label', `${file} is unavailable in this browser`);
    }

    row.append(b, dl);
    list.appendChild(row);
  }

  if (focusKey) {
    list.querySelector(`.nle-bin-item[data-key="${CSS.escape(focusKey)}"] .nle-bin-open`)
      ?.focus({ preventScroll: true });
  }
  if (pane) pane.scrollTop = scrollTop;
}

/**
 * Export whatever the workspace is showing, by clicking the control that
 * already does it.
 *
 * One obvious button rather than four scattered ones. Every tab has an export,
 * each in a different place with a different name (● RECORD .webm, ⤓ .png,
 * ⤓ .wav, ● RECORD sequence), and none of them is visible from the workspace
 * you are usually in. This does not reimplement any of them — it presses the
 * real one, so the format pickers, the guards and the progress reporting are
 * unchanged.
 */
const EXPORTS = {
  video: { id: 'v-record', label: 'Export clip' },
  image: { id: 'i-dl', label: 'Export screen' },
  audio: { id: 'a-dl', label: 'Export sound' },
  timeline: { id: 'tl-record', label: 'Export sequence' },
};

function exportTarget() {
  const view = document.querySelector('.tab.active')?.dataset.view;
  return EXPORTS[view] || null;
}

export function exportCurrent() {
  const t = exportTarget();
  if (!t) { toast('This workspace has nothing to export — open VIDEO, AUDIO, SCREEN or TIMELINE'); return false; }
  const btn = $(t.id);
  if (!btn) return false;
  /* isEnabled, not `.disabled`. This studio turns a control off with
     `aria-disabled` where the reason matters — so the WHY-OFF explainer can say
     what would turn it back on — and ⤓ .wav, the one export that is off most of
     the time, is exactly such a control. Testing `.disabled` alone made this
     branch unreachable for it: Ctrl+E on AUDIO before a render fell through to
     `btn.click()`, which guardDisabled swallowed, so the message written for
     this case was never the message anyone got. */
  if (!isEnabled(btn)) { toast('Nothing to export yet — render it first'); return false; }
  btn.click();
  return true;
}

/** Keep the toolbar's export button describing what it will actually do. */
function syncExportButton() {
  const btn = $('nle-export');
  if (!btn) return;
  const t = exportTarget();
  setText(btn, t ? `⤓ ${t.label.toUpperCase()}` : '⤓ EXPORT');
  /* Greys out with its target, by the same predicate exportCurrent uses: a
     primary button that looks live and then refuses is worse than one that
     shows it is waiting for something. */
  btn.disabled = !t || !isEnabled($(t.id));
  btn.title = t
    ? `${t.label} — the same as pressing ${t.id === 'v-record' ? '● RECORD' : 'its export button'} in that workspace. It lands in the media bin, with a download beside it.`
    : 'Open VIDEO, AUDIO, SCREEN or TIMELINE to export something';
}

/* ------------------------------------------------------------- status -- */

/* Which status-bar readout belongs to which workspace: a stale estimate from
   a workspace you are not in is a number that lies. */
const METER_HOME = { 'v-est': 'video', 'v-flash': 'video', 'a-stale': 'audio', 'i-est': 'image', 'tl-info': 'timeline' };

/**
 * Write text only when it has changed.
 *
 * `.textContent = x` replaces the text node even when x is identical, which
 * costs a repaint on every one of refreshStatus's four ticks a second and makes
 * any live-region setting on this bar catastrophic. The bar changes when the
 * document does; the tick is a backstop, not a reason to rewrite it.
 */
const setText = (n, v) => { if (n && n.textContent !== v) n.textContent = v; };

export function refreshStatus() {
  const seq = $('nle-st-seq');
  const sel = $('nle-st-sel');
  const undo = $('nle-st-undo');
  const tc = $('nle-tc');
  const tcEnd = $('nle-tc-end');

  let sched = null;
  try { sched = buildSchedule(); } catch { /* before the timeline tab is wired */ }

  if (seq && sched) {
    setText(seq, `${sched.clips.length} clip${sched.clips.length === 1 ? '' : 's'} · ${sched.duration.toFixed(2)}s · ${sched.tl.W}×${sched.tl.H}`);
  }
  if (sel) {
    const ref = selectedRef();
    if (ref.lane === 'A' && ref.i >= 0 && audioTimeline[ref.i]) {
      // A sound is a first-class selection; "No selection" over a selected
      // sound was the status bar not knowing about the second lane.
      setText(sel, `Sound ${ref.i + 1}: ${audioTimeline[ref.i].label || 'sound'}`);
    } else {
      const i = selectedClip();
      setText(sel, i >= 0 && timeline[i] ? `Clip ${i + 1}: ${timeline[i].label}` : 'No selection');
    }
  }
  if (undo) {
    const s = getStore();
    setText(undo, s ? `${s.undoDepth} undo` : '');
  }

  /* The timecode reads the same clock the transport buttons drive. It used to
     always show the sequence playhead while the buttons scrubbed the VIDEO
     preview — one transport cluster, two timebases. */
  const t = transportTargets();
  if (t?.view === 'video') {
    const fps = t.fps();
    const scrub = t.scrub;
    const dur = t.dur();
    const cur = scrub ? (Number(scrub.value) / (Number(scrub.max) || 1000)) * dur : 0;
    setText(tc, timecode(cur, fps));
    setText(tcEnd, timecode(dur, fps));
  } else {
    const fps = Number($('tl-fps')?.value) || 12;
    setText(tc, timecode(tlScrubT, fps));
    if (sched) setText(tcEnd, timecode(sched.duration, fps));
  }

  // The rehoused readouts (see enterEditor) show only for their own workspace.
  const view = document.querySelector('.tab.active')?.dataset.view;
  for (const [id, home] of Object.entries(METER_HOME)) {
    const m = $(id);
    if (m && m.parentElement?.id === 'nle-st-meters') m.hidden = view !== home;
  }

  syncExportButton();
  syncTransport();
  syncPanes();

  /* The clip inspector rides this tick as a backstop. It has its own change
     notifications — selection, the store, the library — and re-renders only
     when its signature moves, so this call costs a string compare and covers
     the case where no document is bound to notify at all. */
  renderInspector();
}

/**
 * An empty pane costs the picture its height, so an empty pane collapses.
 *
 * Two classes, both on <main> where the grid that reads them lives, both
 * following the pattern `no-stage` already set (see syncWorkspace):
 *
 *   seq-empty   nothing in either lane. The sequence band was a fixed
 *               `minmax(120px, 26vh)` — 234px at a 900px window, a quarter of
 *               the screen, full-bleed, holding one sentence — whether or not
 *               there was a sequence to show. Collapsed it is its own toolbar
 *               plus that sentence, and the ~170px goes to the monitor.
 *
 *   no-clip     nothing is selected, so the CLIP pane can only say so. It sat
 *               in an `auto` row above the settings pane and took ~140px of
 *               the right-hand column to do it — which is why the AUDIO tab's
 *               settings were clipped mid-control on a 720px window. The
 *               sentence is not lost: the status bar's own selection readout
 *               says "No selection" in one line, which is what a one-line
 *               status is for.
 *
 * Toggled from refreshStatus, so this tracks every route that can change
 * either — a commit, an undo, a selection, a project load, the 250ms backstop.
 * Both are pure view state: no document is read for anything but its length.
 */
function syncPanes() {
  const main = document.querySelector('main');
  if (!main) return;
  main.classList.toggle('seq-empty', timeline.length + audioTimeline.length === 0);
  main.classList.toggle('no-clip', selectedRef().i < 0);
}

/* -------------------------------------------------------------- build -- */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function buildChrome() {
  const chrome = el('div', 'nle-chrome');
  chrome.id = 'nle-chrome';

  /* menu bar */
  const bar = el('div', 'nle-menubar');
  bar.appendChild(el('span', 'nle-brand', 'Dead Signal'));
  for (const [name, items] of MENUS) bar.appendChild(buildMenu(name, items));
  bar.appendChild(el('span', 'nle-spacer'));
  /* The skin toggle rides the menubar's right edge rather than floating at
     the toolbar's ragged end, where it wrapped onto an orphan row of its own
     the moment the settings did. Only the toggle is built here — Search and
     Explain are real buttons in the page header, which moves into the
     toolbar below; second copies would be two controls for one action. */
  const skinBtn = el('button', 'nle-tbtn', '◐');
  skinBtn.type = 'button';
  skinBtn.id = 'nle-q-skin';
  skinBtn.title = 'Switch between the studio and CRT skins';
  skinBtn.setAttribute('aria-label', 'Switch between the studio and CRT skins');
  skinBtn.addEventListener('click', () => toggleSkin());
  bar.appendChild(skinBtn);
  /* The primary action of the whole tool, at the end of the top row where a
     primary action belongs. It was in the toolbar's right-hand group, which
     wraps when the settings do — so on a narrower window the one button
     everybody needs dropped onto a line of its own at the far left, which is
     nowhere. */
  const exp = el('button', 'nle-tbtn primary nle-export', '⤓ EXPORT');
  exp.type = 'button';
  exp.id = 'nle-export';
  exp.addEventListener('click', () => exportCurrent());
  bar.appendChild(exp);
  chrome.appendChild(bar);

  /* toolbar: the rehoused header settings */
  const tb = el('div', 'nle-toolbar');
  /* No tool palette is built here. The old select/razor island was a facade —
     nothing read the "current tool", and the razor button was just the Split
     command wearing a glyph. Split lives in the Edit menu, the timeline bar
     and the S key; a mode switch that is not a mode is chrome that lies. */
  /* No workspace switcher either. The page already has a tablist — the one
     the keyboard, the command palette and the test suites drive — and a
     second set of buttons onto the same views would mean two "selected" tabs,
     two tab stops per view and a roving-tabindex contract that cannot hold.
     The editor styles the real strip instead (see editor.css); this is the
     rare case where the right amount of new UI is none. */

  /* The page header carries real settings — aesthetic, seed, contrast, detail,
     save/load — and the editor hides that header. They are MOVED here rather
     than rebuilt: same nodes, same ids, same bindings, so the document, the
     palette, Explain mode and every test still reach them, and the editor is
     not missing controls the old layout had. */
  const settings = el('div', 'nle-settings');
  settings.id = 'nle-settings';
  tb.appendChild(settings);
  chrome.appendChild(tb);

  return chrome;
}

function buildBin() {
  const pane = el('aside', 'nle-pane nle-bin');
  pane.id = 'nle-bin';
  pane.setAttribute('aria-label', 'Media bin');
  const head = el('div', 'nle-pane-head');
  head.appendChild(el('span', null, 'Media'));
  const c = el('span', 'nle-count', '0');
  c.id = 'nle-bin-count';
  head.appendChild(c);
  /* Import lives on the bin, because the bin is what it fills. A file menu
     entry alone would be a feature you have to already know about. */
  const imp = el('button', 'nle-bin-import', '＋');
  imp.type = 'button';
  imp.id = 'nle-import';
  imp.title = 'Import footage, stills or sound — or just drop files anywhere';
  imp.setAttribute('aria-label', 'Import media files');
  imp.addEventListener('click', () => chooseFiles());
  head.appendChild(imp);
  pane.appendChild(head);
  const body = el('div', 'nle-bin-body');
  const note = el('p', 'nle-bin-note');
  note.id = 'nle-bin-note';
  note.hidden = true;
  note.setAttribute('role', 'status');
  body.appendChild(note);
  const list = el('div', 'nle-bin-list');
  list.id = 'nle-bin-list';
  body.appendChild(list);
  pane.appendChild(body);
  return pane;
}

function buildTransport() {
  const t = el('div', 'nle-transport');
  t.id = 'nle-transport';
  const tc = el('span', 'tc', '00:00:00:00');
  tc.id = 'nle-tc';
  tc.title = 'Playhead';
  t.appendChild(tc);
  for (const [glyph, title, action] of [
    ['|◀', 'Go to start (Home)', 'start'],
    ['◀◀', 'Back 10 frames (J)', 'backs'],
    ['◀', 'Back one frame (←)', 'back'],
    ['▶ ❚❚', 'Play / pause (Space)', 'playpause'],
    ['▶', 'Forward one frame (→)', 'fwd'],
    ['▶▶', 'Forward 10 frames (L)', 'fwds'],
    ['▶|', 'Go to end (End)', 'end'],
  ]) {
    const b = el('button', action === 'playpause' ? 'nle-tbtn primary' : 'nle-tbtn', glyph);
    b.type = 'button';
    b.id = `nle-t-${action}`;
    b.title = title;
    /* aria-label as well as title, and it is not belt-and-braces. In the
       accessible-name algorithm, name-from-content BEATS title — title is the
       last resort used only when nothing else names the element — so a button
       whose content is "◀◀" is named "◀◀" and the careful sentence in its
       title is never read. The whole transport announced as punctuation. */
    b.setAttribute('aria-label', title);
    b.addEventListener('click', () => { transport(action); refreshStatus(); });
    t.appendChild(b);
  }
  /* The open workspace's own scrub row lands here — see dockScrub. Empty on a
     workspace that has none, and it collapses to nothing when it is. */
  const dock = el('div', 'nle-scrub-dock');
  dock.id = 'nle-scrub-dock';
  t.appendChild(dock);
  const end = el('span', 'tc dim', '00:00:00:00');
  end.id = 'nle-tc-end';
  end.title = 'Sequence duration';
  t.appendChild(end);
  return t;
}

function buildTimelinePane() {
  const pane = el('section', 'nle-timeline');
  pane.id = 'nle-timeline';
  pane.setAttribute('aria-label', 'Timeline');
  const head = el('div', 'nle-tl-head');
  head.appendChild(el('strong', null, 'Sequence'));
  for (const [id, label, title, run] of [
    ['addscene', '＋ Scene', 'Append the current VIDEO look', () => ACTIONS.addScene.run()],
    ['addstill', '＋ Still', 'Append the current SCREEN render', () => ACTIONS.addStill.run()],
    ['addtitle', '＋ Title', 'Words over the picture, on V2 at the playhead — edited in the CLIP panel', () => ACTIONS.addTitle.run()],
    ['addshape', '＋ Shape', 'A box, arrow, bracket or crosshair over the picture at the playhead', () => ACTIONS.addShape.run()],
    ['addoverlay', '＋ Overlay', 'Put the current VIDEO look on V2, over the playhead', () => ACTIONS.addOverlay.run()],
    ['addaudio', '＋ Sound', 'Put the TIMELINE tab\'s chosen sound on the audio lane at the playhead', () => ACTIONS.addSound.run()],
    ['split', 'Split', 'Split at the playhead (S)', () => splitAtPlayhead()],
    ['delete', 'Delete', 'Delete the selected clip (Del)', () => rippleDelete()],
  ]) {
    const b = el('button', 'nle-tbtn', label);
    b.type = 'button'; b.id = `nle-tl-${id}`; b.title = title;
    // Named by its own sentence rather than by "＋ Scene" — see buildTransport.
    b.setAttribute('aria-label', title);
    b.addEventListener('click', () => { run(); refreshStatus(); });
    head.appendChild(b);
  }
  const zoom = el('div', 'nle-zoom');
  zoom.appendChild(el('span', null, 'Zoom'));
  const z = document.createElement('input');
  z.type = 'range'; z.min = '100'; z.max = '600'; z.step = '10';
  z.id = 'nle-zoom';
  /* The title IS this control's accessible name — there is no <label for> and
     no aria-label — so it has to describe what the control now does. It used to
     stretch the lane's CSS width, which made the same picture bigger and left
     the ruler saying the same six things. */
  z.title = 'Zoom the time scale — 100% fits the whole sequence, higher shows fewer seconds across more pixels';
  z.value = String(Math.round(trackScale().zoom * 100));   /* dom-only: reflecting persisted view state, not a document value */
  z.addEventListener('input', () => setTrackZoom(Number(z.value) / 100));
  zoom.appendChild(z);
  const fit = el('button', 'nle-tbtn', 'Fit');
  fit.type = 'button';
  fit.id = 'nle-zoom-fit';
  fit.title = 'Zoom out until the whole sequence is on screen';
  /* With a real scale the lane no longer fits itself to the window, so there has
     to be a way back — zooming out by dragging until it happens to fit is not
     one. */
  fit.addEventListener('click', () => {
    zoomToFit();
    z.value = String(Math.round(trackScale().zoom * 100));   /* dom-only: reflecting view state */
  });
  zoom.appendChild(fit);
  head.appendChild(zoom);
  pane.appendChild(head);

  const body = el('div', 'nle-tl-body');
  body.id = 'nle-tl-body';
  pane.appendChild(body);
  return pane;
}

function buildStatus() {
  const s = el('div', 'nle-status');
  s.id = 'nle-status';
  /* NOT role="status", and that is a correction rather than an omission.
     A status bar is a readout you glance at, not an announcement — and this one
     is rewritten four times a second by refreshStatus's backstop tick, forever,
     with no user action. Declared live, a screen reader recited the clip count,
     the duration, the frame size, the selection, the undo depth and both
     timecodes every 250ms, indefinitely.
     Worse, enterEditor moves the stage meters in here, and one of them is the
     WCAG flash rate — whose own module carries the note "THE READOUT IS NOT A
     LIVE REGION, and must not become one" (ui/flashmeter.js), describing this
     exact failure after aria-live was deliberately stripped from #v-flash in
     the markup. Re-parenting it into a live region put it straight back.
     What genuinely is an event is announced once, through the toast rail. */
  s.setAttribute('aria-live', 'off');
  for (const [id, text] of [['nle-st-seq', '—'], ['nle-st-sel', 'No selection'], ['nle-st-undo', '']]) {
    const n = el('span', null, text);
    n.id = id;
    s.appendChild(n);
    s.appendChild(el('span', 'sep'));
  }
  const hint = el('span', 'nle-st-hint', 'Space play · S split · Del remove · Ctrl+Z undo — full list under Help');
  s.appendChild(hint);
  /* The live readouts rehoused from the hidden stage headers (see
     enterEditor) dock at the right edge. */
  const meters = el('span', 'nle-st-meters');
  meters.id = 'nle-st-meters';
  s.appendChild(meters);
  return s;
}

/** The active view changed: the status bar and the export button track it. */
function syncWorkspace() {
  /* Stage-less views (LIBRARY, BUNDLE, CLOUD, HELP) drop the inspector and
     transport panes and take their space — flagged with a class because the
     selector that would express it in pure CSS needs :has() inside :has(),
     which is invalid. */
  const main = document.querySelector('main');
  if (main) main.classList.toggle('no-stage', !document.querySelector('.view.active .panel.stagewrap'));
  dockScrub();
  refreshStatus();
  syncExportButton();
}

/* --------------------------------------------------------------- skin -- */

export function toggleSkin() {
  const next = document.documentElement.getAttribute('data-skin') === 'studio' ? 'crt' : 'studio';
  setSkin(next);
}

export function setSkin(skin) {
  const s = skin === 'crt' ? 'crt' : 'studio';
  if (s === 'crt') document.documentElement.removeAttribute('data-skin');
  else document.documentElement.setAttribute('data-skin', 'studio');
  lsSet(SKIN_KEY, s);
  /* The aesthetic's chrome colours are inline vars: painted under the CRT
     skin, cleared under the studio skin, and only the writer can swap them. */
  syncChromeToSkin();
}

/* --------------------------------------------------------------- mode -- */

/**
 * Put the page into the editor layout — once, at boot, for good.
 *
 * The editor used to be one of three layouts (classic tabs, a three-pane
 * workspace, and this), each behind a toggle. The editor IS the studio now:
 * the moves below are permanent, so none of them keeps a way back.
 */
const CONSOLE_KEY = 'deadsignal.editor.console';

/**
 * Fold the activity log into a header you can open.
 *
 * The log is where this tool explains what it just did — which container it
 * fell back to, which clip was muxed, why an export refused — so hiding it is
 * wrong. But open, it held ~190px of the 260px media column on all eight
 * workspaces, mostly showing one boot line, in the column whose actual job
 * (the bin) starts empty. Its value is "tell me when something happened",
 * which a header with a count serves as well as a black box does.
 *
 * Closed by default, remembered per browser, and it OPENS ITSELF on the first
 * warning or error — a folded log over the sentence explaining a refused export
 * would be worse than the space it saves.
 */
function foldConsole(panel) {
  if (panel.dataset.folded) return;
  panel.dataset.folded = '1';
  const h2 = panel.querySelector('h2');
  const body = panel.querySelector('.console');
  if (!h2 || !body) return;
  if (!body.id) body.id = 'console';

  const btn = el('button', 'nle-fold');
  btn.type = 'button';
  btn.id = 'nle-console-fold';
  btn.setAttribute('aria-controls', body.id);
  const caret = el('span', 'nle-fold-caret', '▸');
  caret.setAttribute('aria-hidden', 'true');
  const count = el('span', 'nle-fold-count');
  count.id = 'nle-console-count';
  btn.append(caret, el('span', null, h2.textContent.trim() || 'Console'), count);
  h2.replaceChildren(btn);

  let unread = 0;
  const apply = (open) => {
    panel.classList.toggle('folded', !open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    caret.textContent = open ? '▾' : '▸';
    if (open) { unread = 0; body.scrollTop = body.scrollHeight; }
    count.textContent = open || !unread ? '' : String(unread);
    count.classList.toggle('warn', !open && unread > 0);
    btn.setAttribute('aria-label', `Activity log${open ? '' : unread ? `, ${unread} new` : ''}`);
  };
  apply(lsGet(CONSOLE_KEY, '0') === '1');
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    lsSet(CONSOLE_KEY, open ? '1' : '0');
    apply(open);
  });
  document.addEventListener('studio:log', (e) => {
    if (btn.getAttribute('aria-expanded') === 'true') { body.scrollTop = body.scrollHeight; return; }
    unread++;
    /* A warning or an error is the case this fold must not lose. Anything else
       is a count on the header, which is what a quiet log should cost. */
    if (e.detail?.cls === 'err' || e.detail?.cls === 'warn') { lsSet(CONSOLE_KEY, '1'); apply(true); return; }
    apply(false);
  });
}

function enterEditor() {
  if (!built) build();
  document.body.classList.add('nle');

  /* The header's settings groups, in the order they read in the header. The
     button group is deliberately not among them: the menus and the quick bar
     already reach those, and moving them would put the same control on screen
     twice. */
  const settings = $('nle-settings');
  if (settings) {
    for (const id of ['aesthetic', 'seed', 'crt-intensity', 'save-state', 'build-tag', 'contrast', 'complexity', 'palette-open', 'proj-save']) {
      const ctl = $(id)?.closest('.ctl');
      if (!ctl || ctl.parentElement === settings) continue;
      settings.appendChild(ctl);
    }
  }
  const lane = $('tl-track');
  const dock = $('nle-tl-body');
  if (lane && dock && lane.parentElement !== dock) dock.appendChild(lane);
  /* An older build wrote the zoom onto this element as an inline width (up to
     600%), and inline style is not something a stylesheet can take back. Left
     there it would stretch the new scroller's content box and put the ruler
     out of step with the lanes. */
  if (lane) lane.style.width = '';   /* dom-only: clearing a legacy inline layout value */
  /* The activity log is where this tool explains what it just did — which
     container it fell back to, which clip was muxed, why an export refused. It
     moves into the media column rather than being hidden: out of the way, still
     on screen, still readable by anything that reads it. */
  const log = $('console')?.closest('.panel');
  const logDock = $('nle-bin');
  if (log && logDock && log.parentElement !== logDock) logDock.appendChild(log);
  if (log) foldConsole(log);
  /* The stage panels' h2 headers are hidden in the editor — a monitor shows
     the picture, not a title — but the live readouts inside them are not
     decoration: the export-size estimates, the WCAG 2.3.1 flash meter, the
     audio stale badge and the sequence info. They move to the status bar,
     keeping their ids, and refreshStatus shows each only on its own
     workspace. Hiding the flash meter with its header would have silently
     dropped the one safety readout HELP promises. */
  const meters = $('nle-st-meters');
  if (meters) {
    for (const id of Object.keys(METER_HOME)) {
      const m = $(id);
      if (m && m.parentElement !== meters) meters.appendChild(m);
    }
  }
  syncWorkspace();
  /* The lane just changed host, and its viewport width came with the host. The
     scale is measured, so it has to be re-measured or every block is laid out
     against the width of the container it used to be in. */
  renderTrack();
}

function build() {
  if (built) return;
  built = true;

  const main = document.querySelector('main') || document.getElementById('main-content');
  /* Above the view tabs, not below them: menu bar, toolbar, then the strip that
     says which workspace you are in — the order every editor uses, and the
     order the page reads in without the editor too. */
  const tabs = document.querySelector('.tabs');
  /* The activity log and the sign-off are children of <main> and would become
     grid items in the editor layout — an empty band under the timeline. Tagged
     rather than selected structurally, so re-ordering the page cannot silently
     re-point these rules at something else. */
  $('console')?.closest('.panel')?.classList.add('nle-console');
  document.body.insertBefore(buildChrome(), tabs || main || document.body.firstChild);
  if (main) {
    main.appendChild(buildBin());
    main.appendChild(buildTransport());
    /* Properties on the right, above the tab's own panel: the selected clip is
       the thing being worked on, and it should not be below a column of
       controls that describe the next one. */
    main.appendChild(buildInspectorPane());
    main.appendChild(buildTimelinePane());
    main.insertAdjacentElement('afterend', buildStatus());
  }

  // One listener, on the document: menus close when anything else is clicked.
  document.addEventListener('click', closeMenus);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

  onLibraryChange(renderBin);
  renderBin();

  /* Editor keyboard model. Deliberately inert while a field has focus — an
     editor that plays the sequence because you typed "s" in a text box is not
     an editor anyone can use. */
  /* Ctrl+E exports, and unlike the single-key editor bindings below it works
     while a field has focus — it is a command, not a transport key, and an
     author who has just typed a filename should not have to click away first. */
  document.addEventListener('keydown', (e) => {
    if (!((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'e') { e.preventDefault(); exportCurrent(); return; }
    /* Copy, paste and duplicate are commands like Ctrl+E, but unlike it they
       must NOT fire while a field has focus: Ctrl+C in a text box is the
       browser's copy, and taking that away to duplicate a clip would be
       indefensible. */
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
    /* …and not while text is selected anywhere on the page. The activity log
       exists to be read and quoted, and HELP is prose; taking Ctrl+C from a
       live selection meant copying a line out of either put nothing on the
       clipboard and toasted about clips instead. A selection is an unambiguous
       statement that the copy is about text. */
    if (k === 'c') {
      const textSel = window.getSelection?.();
      if (textSel && !textSel.isCollapsed && String(textSel).trim()) return;
    }
    if (k === 'c') { e.preventDefault(); copyClip(); }
    else if (k === 'v') { e.preventDefault(); pasteClip(); }
    else if (k === 'd') { e.preventDefault(); duplicateClip(); }
  });

  document.addEventListener('keydown', (e) => {
    /* A deeper handler that already acted owns the key: the lane's arrows
       trim the selected block, the tablist's arrows move between workspaces,
       and both preventDefault. Without this guard every trim ALSO stepped
       the playhead — two meanings on one press. */
    if (e.defaultPrevented) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    /* A modal on screen means the keys belong to it, not the editor: Space
       with the welcome card up should not start the preview behind it. One
       predicate, shared with the studio's other bare-key handler in boot.js —
       three hand-written checks here and none there is how the same rule ended
       up enforced in one place and not the other. */
    if (anyModalOpen()) return;
    /* Space on a focused button is the button's activation — taking it away
       to toggle playback made Enter and Space behave differently on the same
       control. K stays as the play/pause key that always works. */
    if (e.key === ' ' && t && t.closest('button')) return;

    const map = {
      ' ': () => transport('playpause'),
      j: () => transport('backs'), k: () => transport('playpause'), l: () => transport('fwds'),
      ArrowLeft: () => transport('back'), ArrowRight: () => transport('fwd'),
      Home: () => transport('start'), End: () => transport('end'),
      s: splitAtPlayhead, c: splitAtPlayhead,
      Delete: rippleDelete, Backspace: rippleDelete,
    };
    const fn = map[e.key] || map[e.key.toLowerCase?.()];
    if (!fn) return;
    e.preventDefault();
    fn();
    refreshStatus();
  });

  // activateTab() announces every workspace switch, whatever route it came
  // by — clicking a tab, digits 1-8, arrow keys, the palette, a menu action.
  document.addEventListener('studio:view', () => syncWorkspace());

  /* The scale is pixels per second against a MEASURED viewport, so a window
     resize changes it. Debounced: a drag-resize fires this continuously and
     each one rebuilds the lane. */
  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { resizeT = null; renderTrack(); }, 100);
  });
}

/**
 * Wire the editor up.
 *
 * Called once at boot. The skin is remembered per browser; everyone gets the
 * editor, because that is the tool this is now.
 */
export function initEditor() {
  build();
  initInspector();
  setSkin(lsGet(SKIN_KEY, 'studio'));
  enterEditor();

  // Keep the status bar honest without polling the document: every commit the
  // store makes is a reason to re-read it, and so is a selection — waiting up
  // to 250ms for the poll made clicking a clip feel loose.
  getStore()?.subscribe?.('', () => refreshStatus());
  onClipSelect(() => refreshStatus());
  setInterval(() => refreshStatus(), 250);
  refreshStatus();
}
