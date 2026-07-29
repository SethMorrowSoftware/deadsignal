/* Dead Signal Studio — ui/track.js
 *
 * The sequence, drawn as a track.
 *
 * TIMELINE was a table: a numbered list with ↑ ↓ ✕ and nothing to show how long
 * anything was or where it sat. That is a queue, not an edit — you cannot see
 * that clip three is twice as long as clip two, and there is nowhere to grab an
 * edge and shorten it.
 *
 * Built from DOM rather than canvas on purpose. Clip blocks are buttons: they
 * take focus, they can be driven from the keyboard, and a screen reader can
 * read the sequence out. A canvas track would be a picture of an editor.
 *
 * The table underneath stays. It is where an author types 4.25 rather than
 * dragging at it, and the two write the same clips.
 */
import { $, escHtml } from '../core/dom.js';
import { MAX_CLIP, MAX_START, MAX_TRANSITION, clipLength, isFirstOnTrack, isOverlay, overlaps } from '../doc/timeline.js';
import { clampScroll, clampZoom, pxPerSecond, pxToTime, snapCandidates, snapMove, snapTime,
         tickLabel, tickStep, tickTimes, timeToPx } from './timescale.js';
import { thumbKeyOf } from './wavethumb.js';

/* Anything narrower than this is unclickable, so a very short clip is drawn
   wider than it truly is rather than as a hairline. The RULER stays honest;
   only the hit target is padded.

   In pixels now, not in percent. The old percentage floor GREW with the zoom —
   1.6% of a lane stretched to 600% was 57px — so zooming in, the one thing an
   author does to see a short clip honestly, widened the lie instead. A pixel
   floor stops applying the moment the true width passes it. */
const MIN_BLOCK_PX = 10;
/* .tl-lane draws a 1px border, and a block positioned inside it resolves
   against the padding box while getBoundingClientRect() reports the border box.
   One pixel did not matter while everything was a percentage of the same box;
   it does the moment that rect defines pixels-per-second. */
const LANE_INSET = 1;
const ZOOM_KEY = 'deadsignal.studio.tlzoom';

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/* The scale, and where the viewport is looking.

   VIEW state, deliberately not document state: how far you are zoomed in is not
   part of the project, must not dirty it, must not land in the undo stack, and
   must not travel to whoever opens the share link. It is remembered per browser
   like the editor mode and the skin. Feature-wise this means the time scale
   adds no document path at all, and therefore cannot break the byte-identical
   save/load round trip. */
let _zoom = clampZoom(lsGet(ZOOM_KEY, '1'));
let _pps = 0;          // pixels per second, the single source of scale
let _viewportPx = 0;
let _contentPx = 0;
let _scrollPx = 0;
let _dragging = false;
/* Where the playhead was painted last, so the follow can tell a moving playhead
   from a repainted one. */
let _lastPlayheadPx = -1;
/* …and where that was in seconds, which is what a snap target has to be. */
let _playheadT = -1;

/** The live scale. Read by the suites and by anything drawing against the lane. */
export function trackScale() {
  return { pxPerSec: _pps, zoom: _zoom, contentPx: _contentPx, viewportPx: _viewportPx, scrollPx: _scrollPx };
}

/** Set the zoom, remember it, redraw. 1 fits the sequence to the viewport. */
export function setTrackZoom(z) {
  _zoom = clampZoom(z);
  lsSet(ZOOM_KEY, String(_zoom));
  renderTrack();
  return _zoom;
}

/** Back to fitting the whole sequence on screen. */
export function zoomToFit() { return setTrackZoom(1); }

let _deps = null;      // { clips, audio, schedule, edit, move, select, settle, editAudio, thumb }
let _selected = -1;
/* Which lane the selection points into. 'V' is the picture arrays, 'A' the
   audio one — they are separate arrays, so an index alone is ambiguous. */
let _lane = 'V';
/* Which slot to put focus in after the next rebuild, when it is not simply
   "wherever focus already was" — a reorder is the case that needs telling,
   because the clip the author is moving ends up at a different index. */
let _refocus = null;
/* Who wants to know which clip is selected. Selection used to be module state
   nothing could observe, so a panel showing the selected clip's properties had
   no way to learn it had changed short of polling — and polling a panel with
   fields in it means rebuilding whatever the author is typing into. */
const _watchers = new Set();

/* Unchanged for every existing caller: "the selected CLIP" is still an index
   into timeline.clips, and is -1 whenever the author is on a sound instead. A
   caller that has not been taught about the audio lane therefore cannot be
   handed an audio index and mistake it for a clip. */
export const selectedClip = () => (_lane === 'V' ? _selected : -1);
export const selectedAudio = () => (_lane === 'A' ? _selected : -1);
export const selectedRef = () => ({ lane: _lane, i: _selected });

/** Subscribe to selection changes. Returns an unsubscribe. */
export function onClipSelect(fn) {
  _watchers.add(fn);
  return () => _watchers.delete(fn);
}

/** The one place the selection moves, so every move is announced exactly once. */
function setSelected(i, lane = 'V') {
  const next = Number.isInteger(i) && i >= 0 ? i : -1;
  if (next === _selected && lane === _lane) return;
  _selected = next;
  _lane = next < 0 ? 'V' : lane;
  // A throwing watcher is a bug in the watcher, not a reason to abandon a
  // selection the author has already made with the pointer.
  for (const fn of _watchers) { try { fn(next); } catch (e) { console.error(e); } }
}

/**
 * Focus slot `i` once the track next renders — and select it.
 *
 * Every caller means the same thing by this: split, duplicate, delete and
 * reorder all say "this is the clip you are on now". Focus and selection used
 * to be set separately, so a split left the highlight on the left-hand half
 * while focus sat on the right-hand one, and anything reading the selection got
 * the clip the author was no longer looking at.
 */
export function focusClipAfterRender(i) { _refocus = i; setSelected(i); }

/**
 * Repaint the playhead only. Called every preview frame, so it touches one node.
 *
 * `total` stays in the signature (video/timeline.js passes it) but is only an
 * "is there a sequence" guard now: the position comes from the live scale, so
 * the playhead and the blocks cannot disagree about how long a second is. They
 * could before — the preview loop closes over a schedule captured when it
 * started, while the blocks re-render against the current duration.
 */
export function paintPlayhead(t, total) {
  const el = $('tl-playhead');
  if (!el || !(total > 0)) return;
  const px = timeToPx(Math.max(0, t), _pps);
  _playheadT = Math.max(0, t);
  el.style.left = `${px}px`;

  /* Follow the playhead when it MOVES out of the visible span.

     "Moves" is the operative word: this is called every frame whether or not
     anything has changed, so following unconditionally means a paused playhead
     at 0:00 hauls the viewport back to the start every frame — the author
     scrolls to look at the end of the sequence and is dragged home sixty times
     a second. Following only on a change gives playback and scrubbing their
     follow, and leaves a parked playhead alone.

     Not while dragging either: an auto-scroll fighting a drag makes the clip run
     away from the pointer. And deliberately free of getBoundingClientRect() —
     at frame rate, a forced layout per frame is what turns a preview into a
     slideshow. */
  const moved = Math.abs(px - _lastPlayheadPx) > 0.5;
  _lastPlayheadPx = px;
  if (!moved || _dragging || !(_contentPx > _viewportPx)) return;
  const sc = $('tl-scroll');
  if (!sc) return;
  const left = sc.scrollLeft;
  if (px < left + _viewportPx * 0.1 || px > left + _viewportPx * 0.9) {
    sc.scrollLeft = _scrollPx = clampScroll(px - _viewportPx * 0.5, _contentPx, _viewportPx);
  }
}

/**
 * The ruler, stepped from the SCALE rather than from the duration.
 *
 * That swap is the whole point of the feature. The old ruler picked its step
 * from `duration / 10`, so zooming produced the same six ticks stretched
 * further apart — the one thing a zoom is supposed to fix.
 */
function ruler(total) {
  const step = tickStep(_pps);
  const out = [];
  for (const t of tickTimes(total, _pps)) {
    /* The last label would hang off the end of the content box, and inside a
       scroller that overhang becomes scrollable width — desynchronising the
       ruler from the lanes by however far it stuck out. Flip it to sit inside. */
    const last = t + step > total + 1e-6;
    out.push(`<span class="tl-tick${last ? ' end' : ''}" style="left:${timeToPx(t, _pps)}px">${tickLabel(t)}</span>`);
  }
  return out.join('');
}

/* No point drawing forty marks on a forty-pixel block: past this they are a
   smear that says "animated" less clearly than one mark would. */
const MAX_MARKS = 24;

/** A clip's keyframes as marks along its block, in lane pixels. */
function keyMarks(c, len, width) {
  const tracks = c?.rec && typeof c.rec === 'object' ? c.rec.__auto : null;
  if (!tracks || typeof tracks !== 'object') return '';
  /* Every parameter's keys together, de-duplicated: the question the lane
     answers is "is there a key here", not "which parameter" — that is the
     inspector's job, and drawing one row per parameter would need a lane four
     times as tall. */
  const at = new Set();
  for (const id in tracks) {
    const list = tracks[id];
    if (!Array.isArray(list)) continue;
    for (const k of list) {
      const t = Number(k?.t);
      if (Number.isFinite(t)) at.add(Math.round(t * 100) / 100);
    }
  }
  if (!at.size || at.size > MAX_MARKS) return '';
  /* A key is in SOURCE seconds; the block is in lane pixels. Inverting through
     the clip's own mapping is what puts a mark on a trimmed, sped-up or
     reversed clip where the frame it describes actually is — the alternative
     is marks that look right at 1× forwards and drift everywhere else. */
  const speed = Math.max(0.001, (Number(c.speed) || 1));
  const out = [];
  for (const t of at) {
    const local = c.reverse ? ((Number(c.out) || 0) - t) / speed : (t - (Number(c.in) || 0)) / speed;
    if (!(local >= -1e-6 && local <= len + 1e-6)) continue;   // outside the trim
    const px = Math.round((local / Math.max(0.001, len)) * width);
    out.push(`<span class="tl-key" style="left:${px}px" aria-hidden="true"></span>`);
  }
  return out.join('');
}

/**
 * The grip that sets how long this clip's transition takes.
 *
 * Only where there is one to set: the first clip of the spine has nothing to
 * come in from, and a cut is instant. Drawn at the transition's own length so
 * the handle IS the readout — dragging it is the only place in the tool where
 * the number and the picture of the number are the same object.
 */
function transHandle(clips, i, width) {
  const c = clips[i];
  if (!c) return '';
  /* The first clip OF THE SPINE has nothing to come in from. An overlay is
     never "first" in that sense — it fades up against whatever V1 is showing,
     wherever it sits in the array — so it keeps its handle. */
  if (!isOverlay(c) && isFirstOnTrack(clips, i)) return '';
  // A cut is instant: there is no length to drag.
  if (!(overlaps(c) || c.transition === 'dip')) return '';
  const len = clipLength(c);
  const dur = Math.max(0, Math.min(Number(c.xdur) || 0, len, MAX_TRANSITION));
  const px = Math.max(4, Math.round((dur / Math.max(0.001, len)) * width));
  return `<span class="tl-xgrip" data-i="${i}" style="width:${px}px"
    title="Drag to set how long the ${c.transition} takes (${dur.toFixed(2)}s)" aria-hidden="true"></span>`;
}

export function renderTrack() {
  const box = $('tl-track');
  if (!box || !_deps) return;
  /* Every edit rebuilds the lane, which destroys the button the author is
     standing on. Arrow-key trimming edits on each press, so without this the
     first press dropped focus to <body> and every press after it did nothing.

     By slot, not by clip identity: the runtime clip id is reassigned on each
     commit (setTimelineClips re-mints it), so it is a render handle, not a
     name. A reorder is the one case where the slot is not the answer, and it
     says where it moved the clip via focusClipAfterRender(). */
  const focused = document.activeElement?.closest?.('.tl-clip,.tl-aclip');
  const refocus = _refocus != null ? _refocus
    : (focused && box.contains(focused) ? Number(focused.dataset.i) : null);
  _refocus = null;
  const clips = _deps.clips();
  const { starts, duration } = _deps.schedule();
  const total = Math.max(0.1, duration);

  /* Scroll is read BEFORE the markup is replaced and restored after: the
     innerHTML swap destroys the scroller, and with it where the author was
     looking. renderTrack runs twice per pointermove during a drag, so losing it
     is not a cosmetic flicker — it is the lane snapping back to zero under the
     pointer thirty times a second. */
  _scrollPx = $('tl-scroll')?.scrollLeft ?? _scrollPx;
  _viewportPx = measureViewport();
  /* The scale is FROZEN for the length of a gesture.

     It is fit-relative, so it is a function of the sequence duration — and a
     trim drag changes that duration on every pointermove. Recomputed live, the
     ruler and every other block would rescale under the pointer as the author
     dragged, and the drag's own pixels-to-seconds conversion would use a
     different scale on each frame than the one the author aimed with: the
     handle lands near where it was let go rather than on it. Held fixed, the
     lane simply gets shorter at a constant scale, which is what trimming looks
     like in an editor. */
  if (!_dragging || !(_pps > 0)) _pps = pxPerSecond(total, _viewportPx, _zoom);
  _contentPx = Math.max(1, Math.round(timeToPx(total, _pps)));
  /* An undo, a project load or a Clear replaces the whole list under a
     selection that was made against the old one. Left alone, slot 4 of a
     two-clip sequence stays "selected" — the lane draws no highlight (there is
     no such block) but anything reading the selection is handed a clip that is
     not there. */
  const audio = _deps.audio ? _deps.audio() : [];
  if (_lane === 'V' && _selected >= clips.length) setSelected(-1);
  if (_lane === 'A' && _selected >= audio.length) setSelected(-1);

  if (!clips.length) {
    box.innerHTML = '<p class="hint">Nothing in the sequence yet. Build a look on VIDEO and press '
      + '<b>＋ SCENE</b>, or a screen on SCREEN and press <b>＋ STILL</b>.</p>';
    // No lane means no scroll to remember; leaving a stale offset would restore
    // it against the next sequence, which is a different length entirely.
    _scrollPx = 0;
    return;
  }

  const block = (c, i) => {
    const len = clipLength(c);
    const left = Math.round(timeToPx(starts[i], _pps));
    const width = Math.max(MIN_BLOCK_PX, Math.round(timeToPx(len, _pps)));
    const over = isOverlay(c);
    const cls = ['tl-clip', c.kind === 'still' ? 'still' : 'video', over ? 'overlay' : '', i === _selected ? 'sel' : '']
      .filter(Boolean).join(' ');
    /* A label is author text — a scene name plus the first line of the clip's
       copy — and it arrives from project files other people wrote, so it is
       escaped for BOTH the attribute and the body. escHtml covers quotes, which
       is what an aria-label needs; stripping angle brackets by hand did not. */
    const label = escHtml(c.label);
    /* An overlay's aria-label says where it sits, because on that track that is
       the thing an author is placing — and it is the one fact a screen-reader
       user cannot get from the block's position on screen. */
    const where = over
      ? `, overlay at ${starts[i].toFixed(2)} seconds, ${c.blend} blend`
      : (c.transition !== 'cut' && !isFirstOnTrack(clips, i) ? `, ${c.transition} in` : '');
    /* The clip's own keyframes, as marks along the block.
       A curve was previously invisible from the lane: the only way to know a
       clip was animated was to select it and open the picker. A row of marks
       makes "which of these did I animate, and where" a thing you can see —
       and they are placed by walking the SAME sourceTimeOf the renderer walks,
       so on a trimmed, sped-up or reversed clip they land where the frames
       they describe actually are. */
    const marks = keyMarks(c, len, width);
    const trans = transHandle(clips, i, width);
    return `<button type="button" class="${cls}" data-i="${i}" style="left:${left}px;width:${width}px"
      aria-label="Clip ${i + 1}, ${label}, ${len.toFixed(2)} seconds${where}">
      <span class="tl-grip l" data-i="${i}" data-edge="in" aria-hidden="true"></span>
      <span class="tl-name">${label}</span>
      <span class="tl-len">${len.toFixed(1)}s</span>
      ${marks}${trans}
      <span class="tl-grip r" data-i="${i}" data-edge="out" aria-hidden="true"></span>
    </button>`;
  };

  /* A distinct class, not '.tl-clip'. Every selector in the app and in three
     test suites keys on .tl-clip, and a sound answering to it would quietly
     join every count, every drag handler and every focus sweep written for
     pictures. */
  const aBlock = (c, k) => {
    const len = Math.max(0.1, (c.out ?? 0) - (c.in ?? 0));
    const left = Math.round(timeToPx(c.at ?? 0, _pps));
    const width = Math.max(MIN_BLOCK_PX, Math.round(timeToPx(len, _pps)));
    const cls = ['tl-aclip', c.mute ? 'muted' : '', _lane === 'A' && k === _selected ? 'sel' : '']
      .filter(Boolean).join(' ');
    const label = escHtml(c.label);
    const thumb = _deps.thumb ? _deps.thumb(c) : '';
    // Escaped for the attribute as well as the body: a sound's label arrives
    // from other people's project files exactly as a clip's does.
    return `<button type="button" class="${cls}" data-lane="A" data-i="${k}" data-thumb-key="${escHtml(thumbKeyOf(c))}"
      style="left:${left}px;width:${width}px${thumb ? `;background-image:url("${thumb}")` : ''}"
      aria-label="Sound ${k + 1}, ${label}, ${len.toFixed(2)} seconds at ${(c.at ?? 0).toFixed(2)} seconds${
        c.mute ? ', muted' : `, gain ${(c.gain ?? 1).toFixed(2)}`}${c.loop ? ', looped' : ''}">
      <span class="tl-grip l" data-lane="A" data-i="${k}" data-edge="in" aria-hidden="true"></span>
      <span class="tl-name">${label}</span>
      <span class="tl-len">${len.toFixed(1)}s</span>
      <span class="tl-grip r" data-lane="A" data-i="${k}" data-edge="out" aria-hidden="true"></span>
    </button>`;
  };

  const lane = (name) => clips.map((c, i) => (
    (name === 'V2') === isOverlay(c) ? block(c, i) : '')).join('');
  const overlays = clips.some(isOverlay);
  const sounds = audio.length > 0;

  /* V2 above V1, which is the way every editor stacks tracks and the way the
     picture is composited: higher lane, higher layer. The overlay lane is drawn
     only when something is on it — an empty second lane in every sequence would
     be a permanent reminder of a feature most sequences do not use. */
  /* The scroller is an ANCESTOR of the lanes, never a lane itself. This is the
     one structural fact the whole feature rests on: because .tl-lane IS the
     content box, its getBoundingClientRect().left already slides as the
     scroller scrolls, so pointer maths stays content-relative with no scrollLeft
     term anywhere. Make .tl-lane the scroller instead and its rect becomes the
     VISIBLE width while blocks are laid out against the content width — every
     drag then scales wrong by exactly the zoom factor, with no error, no visual
     glitch, and gestures that feel right and land in the wrong place.

     V2 above V1, which is how every editor stacks tracks and how the picture is
     composited: higher lane, higher layer. The overlay lane is drawn only when
     something is on it. */
  box.innerHTML = `<div class="tl-scroll" id="tl-scroll"><div class="tl-content" style="width:${_contentPx}px">`
    + `<div class="tl-ruler">${ruler(total)}</div>`
    + (overlays
      ? `<div class="tl-row overlay"><span class="tl-head">V2</span>`
        + `<div class="tl-lane">${lane('V2')}</div></div>`
      : '')
    + `<div class="tl-row spine"><span class="tl-head">V1</span>`
    + `<div class="tl-lane">${lane('V1')}<div class="tl-playhead" id="tl-playhead"></div></div></div>`
    // Sound under picture, as in every editor.
    + (sounds
      ? `<div class="tl-row audio"><span class="tl-head">A1</span>`
        + `<div class="tl-lane">${audio.map(aBlock).join('')}</div></div>`
      : '')
    + `</div></div>`
    + `<p class="hint tl-help">Drag a block to reorder · drag an edge to trim · click to select. `
    + `Arrow keys trim the selected clip (Shift for 1s, Alt to reorder). `
    + (overlays ? `An overlay is dragged along the lane to WHEN it happens, not into an order. ` : '')
    + (sounds ? `A sound is dragged to when it plays; its edges trim which part of the file you hear. ` : '')
    + `Trimming changes which part of the source plays, not how fast it plays. `
    + `Drags pull to the playhead and to other clips' edges — hold Shift to place freely.</p>`;

  const sc = $('tl-scroll');
  if (sc) sc.scrollLeft = _scrollPx = clampScroll(_scrollPx, _contentPx, _viewportPx);
  /* preventScroll is not optional. renderTrack runs twice per commit and a
     commit happens on every pointermove of a drag and every arrow-key press; a
     bare .focus() inside a horizontal scroller yanks the viewport to the focused
     block each time. */
  if (refocus != null) {
    const sel = _lane === 'A' ? `.tl-aclip[data-i="${refocus}"]` : `.tl-clip[data-i="${refocus}"]`;
    box.querySelector(sel)?.focus({ preventScroll: true });
  }
}

/**
 * How wide the visible lane is, in pixels.
 *
 * Measured from the scroller when there is one and from the container before
 * the first render, less the sticky track-header column and its gap — the head
 * is inside the content box but never scrolls, so it is not lane width.
 */
function measureViewport() {
  const box = $('tl-track');
  if (!box) return 0;
  const sc = $('tl-scroll');
  const outer = (sc || box).clientWidth || box.getBoundingClientRect().width || 0;
  const cs = getComputedStyle(document.documentElement);
  const head = parseFloat(cs.getPropertyValue('--tl-head')) || 30;
  const gap = parseFloat(cs.getPropertyValue('--tl-gap')) || 6;
  return Math.max(1, Math.round(outer - head - gap - LANE_INSET * 2));
}

/**
 * Pointer handling for the lane.
 *
 * One listener on the container: blocks are rebuilt on every edit, so per-block
 * listeners would be registered and dropped constantly — the same reasoning as
 * the layers panel.
 */
function wire(box) {
  let drag = null;
  /* One counter per gesture kind. The coalesce key has to be the same for every
     commit within a gesture and different between gestures, and it cannot be
     derived from the clip — its index moves as it is dragged, and its runtime
     id is re-minted on every commit. A counter bumped when the gesture ends is
     exactly the identity wanted. */
  let dragSeq = 0;
  let keySeq = 0;

  /* The spine's lane, addressed by its own class rather than by "not the overlay
     one": both lanes share a time base, but ':not(.overlay)' picks the FIRST
     match in document order, which stops being unique the moment a third lane
     exists. */
  const laneRect = () => $('tl-track')?.querySelector('.tl-row.spine .tl-lane')?.getBoundingClientRect();
  /* Exact, not measured. This used to divide the duration by the lane's measured
     width, which quietly meant "the scale, recomputed from a border box" — and
     getBoundingClientRect() reports the BORDER box while the blocks inside
     resolve against the padding box, so it was already off by the lane's 2px of
     border. Harmless while everything was a percentage of that same box; a real
     drift the moment that number defines what a second is worth. The scale is
     now one value, set in renderTrack, used by the blocks, the ruler, the
     playhead and the pointer alike. */
  const secsPerPx = () => (_pps > 0 ? 1 / _pps : 0);

  /* Where a drag is allowed to be pulled to.
     The playhead comes from the last painted position rather than from a new
     dependency: the track already knows where it drew it, and asking the
     preview loop for the number would be a second source of truth for the one
     thing on screen that must agree with itself. */
  const snapSet = (starts, skip) => snapCandidates(
    _deps.clips(), starts, _deps.audio ? _deps.audio() : [],
    /* Only while the preview is PAUSED. A playhead sweeping across the lane
       sixty times a second is not a place anyone is aiming at, and snapping to
       it would pull a drag toward a different time on every frame — which
       reads as the lane fighting the pointer, not as help. */
    _deps.playing && _deps.playing() ? -1 : _playheadT, skip);
  /* Snapping is on, and Shift turns it off for the length of a gesture. That
     way round because the pull is right almost every time — butting clips
     together and landing on the playhead is most of what dragging is for — and
     the rare deliberate near-miss is the thing worth a modifier. */
  const wantSnap = (e) => !e.shiftKey;
  /** Pointer x as content-relative pixels, inside the lane's border. */
  const laneX = (clientX) => {
    const r = laneRect();
    return r ? clientX - r.left - LANE_INSET : 0;
  };

  box.addEventListener('pointerdown', (e) => {
    /* Before the trim grips, because it sits inside the block and overlaps the
       left one: a transition is measured from the clip's start, so its handle
       begins exactly where the in-point handle is. */
    const xg = e.target.closest('.tl-xgrip');
    if (xg) {
      const k = Number(xg.dataset.i);
      const c = _deps.clips()[k];
      if (!c) return;
      setSelected(k, 'V');
      drag = { kind: 'xdur', i: k, x0: e.clientX, dur0: Number(c.xdur) || 0, key: `tl-x-${dragSeq++}` };
      try { box.setPointerCapture?.(e.pointerId); } catch { /* no active pointer */ }
      _dragging = true;
      e.preventDefault();
      return;
    }
    const grip = e.target.closest('.tl-grip');
    const sound = e.target.closest('.tl-aclip');
    if (sound) { startAudioDrag(e, sound, grip); return; }
    const block = e.target.closest('.tl-clip');
    if (!block) return;
    const i = Number(block.dataset.i);
    const clips = _deps.clips();
    if (!clips[i]) return;
    setSelected(i, 'V');
    // One key for the whole gesture, so a drag is one undo entry rather than one
    // per pointer move.
    const key = `tl-drag-${dragSeq++}`;
    drag = grip
      ? { kind: 'trim', i, edge: grip.dataset.edge, x0: e.clientX, in0: clips[i].in, out0: clips[i].out, key }
      /* Dragging the body of a clip means two different things, because the two
         tracks mean two different things. On the spine it reorders — the clips
         are back to back and the only question is which comes first. On the
         overlay track it SLIDES: an overlay is placed at a time, and dropping it
         "between" two others would be answering a question nobody asked. */
      : isOverlay(clips[i])
        ? { kind: 'slip', i, x0: e.clientX, at0: clips[i].at ?? 0, moved: false, key }
        : { kind: 'move', i, x0: e.clientX, moved: false, key };
    // Throws if the pointer is already gone by the time the handler runs; that
    // is a lost capture, not a lost drag, and the move/up listeners sit on the
    // container anyway.
    try { box.setPointerCapture?.(e.pointerId); } catch { /* no active pointer */ }
    block.classList.add('dragging');
    // Suspends the playhead's scroll-follow: an auto-scroll competing with a
    // drag makes the clip run away from the pointer.
    _dragging = true;
    e.preventDefault();
  });

  /* A sound is dragged to WHEN it plays, and trimmed to WHICH PART of the file
     you hear. Neither is what the same gesture does on the picture lane, where
     a body drag reorders — because a running order is a thing pictures have and
     sounds do not. */
  function startAudioDrag(e, node, grip) {
    const k = Number(node.dataset.i);
    const list = _deps.audio ? _deps.audio() : [];
    const c = list[k];
    if (!c) return;
    setSelected(k, 'A');
    const key = `tl-adrag-${dragSeq++}`;
    drag = grip
      ? { lane: 'A', kind: 'atrim', i: k, edge: grip.dataset.edge, x0: e.clientX, in0: c.in, out0: c.out, key }
      : { lane: 'A', kind: 'aslip', i: k, x0: e.clientX, at0: c.at ?? 0, moved: false, key };
    try { box.setPointerCapture?.(e.pointerId); } catch { /* no active pointer */ }
    node.classList.add('dragging');
    _dragging = true;
    e.preventDefault();
  }

  box.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (drag.lane === 'A') {
      const list = _deps.audio ? _deps.audio() : [];
      const c = list[drag.i];
      if (!c || !_deps.editAudio) return;
      const live = { coalesceKey: drag.key, preview: false };
      const d = dx * secsPerPx();
      const snaps = () => snapSet(_deps.schedule().starts, { lane: 'A', i: drag.i });
      if (drag.kind === 'aslip') {
        if (Math.abs(dx) > 2) drag.moved = true;
        let at = Math.max(0, Math.min(MAX_START, drag.at0 + d));
        if (wantSnap(e)) at = snapMove(at, Math.max(0.1, (c.out ?? 0) - (c.in ?? 0)), snaps(), _pps);
        at = Math.max(0, Math.min(MAX_START, at));
        _deps.editAudio(drag.i, { at: Math.round(at * 100) / 100 }, 'move sound', live);
      } else if (drag.edge === 'in') {
        /* Not snapped, and that is not an omission. Dragging a sound's in-point
           does not move its left edge — the sound stays where it was placed and
           you are choosing which part of the FILE plays. There is no lane time
           under the pointer to pull toward. */
        const v = Math.min(Math.max(0, drag.in0 + d), c.out - 0.1);
        _deps.editAudio(drag.i, { in: Math.round(v * 100) / 100 }, 'trim sound', live);
      } else {
        let v = Math.max(drag.out0 + d, c.in + 0.1);
        if (wantSnap(e)) {
          // The out handle DOES move a lane edge: snap that, then read the
          // out-point back off it.
          const edge = snapTime((c.at ?? 0) + (v - c.in), snaps(), _pps);
          v = Math.max(c.in + 0.1, c.in + (edge - (c.at ?? 0)));
        }
        _deps.editAudio(drag.i, { out: Math.round(v * 100) / 100 }, 'trim sound', live);
      }
      return;
    }
    if (drag.kind === 'xdur') {
      const clips = _deps.clips();
      const c = clips[drag.i];
      if (!c) return;
      /* Bounded by the clip AND by its neighbour: an overlap longer than
         either is not a transition, it is a clip that never fully arrives —
         the same bound scheduleOf already applies, applied here so the handle
         cannot be dragged somewhere the schedule will silently ignore. */
      const spine = clips.map((x, k) => (isOverlay(x) ? -1 : k)).filter((k) => k >= 0);
      const p = spine.indexOf(drag.i);
      const cap = Math.min(MAX_TRANSITION, clipLength(c),
        p > 0 ? clipLength(clips[spine[p - 1]]) : MAX_CLIP);
      const v = Math.max(0, Math.min(cap, drag.dur0 + dx * secsPerPx()));
      _deps.edit(drag.i, { xdur: Math.round(v * 100) / 100 }, 'transition length',
        { coalesceKey: drag.key, preview: false });
      return;
    }
    if (drag.kind === 'trim') {
      const clips = _deps.clips();
      const c = clips[drag.i];
      if (!c) return;
      const d = dx * secsPerPx();
      const live = { coalesceKey: drag.key, preview: false };
      // Each edge is bounded by the source AND by leaving a clip that still
      // exists: dragging past the other edge would produce a zero-length clip.
      if (drag.edge === 'in') {
        /* Same reasoning as the sound lane: on the spine a clip's left edge is
           where the clips before it put it, so dragging the in-point changes
           what plays rather than where the clip sits. Nothing to snap to. */
        const v = Math.min(Math.max(0, drag.in0 + d), c.out - 0.1);
        _deps.edit(drag.i, { in: Math.round(v * 100) / 100 }, 'trim in', live);
      } else {
        let v = Math.max(Math.min(c.src, drag.out0 + d), c.in + 0.1);
        if (wantSnap(e)) {
          /* The useful targets here are the ones on the OTHER lanes — ending a
             shot exactly where a sound starts, or on the playhead. Its own
             neighbours on the spine are always flush against it by
             construction, so they contribute nothing and cost nothing. */
          const { starts } = _deps.schedule();
          const s0 = Number(starts[drag.i]) || 0;
          const edge = snapTime(s0 + (v - c.in),
            snapSet(starts, { lane: 'V', i: drag.i, andAfter: true }), _pps);
          v = Math.min(c.src, Math.max(c.in + 0.1, c.in + (edge - s0)));
        }
        _deps.edit(drag.i, { out: Math.round(v * 100) / 100 }, 'trim out', live);
      }
    } else if (drag.kind === 'slip') {
      if (Math.abs(dx) > 2) drag.moved = true;
      let at = Math.max(0, Math.min(MAX_START, drag.at0 + dx * secsPerPx()));
      if (wantSnap(e)) {
        const clips = _deps.clips();
        at = snapMove(at, clipLength(clips[drag.i]),
          snapSet(_deps.schedule().starts, { lane: 'V', i: drag.i }), _pps);
        at = Math.max(0, Math.min(MAX_START, at));
      }
      _deps.edit(drag.i, { at: Math.round(at * 100) / 100 }, 'move overlay',
        { coalesceKey: drag.key, preview: false });
    } else if (Math.abs(dx) > 4) {
      drag.moved = true;
      // Reorder on crossing the midpoint of a neighbour, which is what makes
      // dragging feel like moving the block rather than aiming at a gap.
      if (!laneRect()) return;
      const { starts } = _deps.schedule();
      const clips = _deps.clips();
      const t = pxToTime(laneX(e.clientX), _pps);
      /* Only the spine takes part in a reorder: an overlay has no place in the
         running order, and letting one be a drop target would move the dragged
         clip to an array slot that means nothing on screen. */
      const spine = clips.map((c, k) => (isOverlay(c) ? -1 : k)).filter((k) => k >= 0);
      let target = spine[spine.length - 1] ?? drag.i;
      for (const k of spine) {
        if (t < starts[k] + clipLength(clips[k]) / 2) { target = k; break; }
      }
      if (target !== drag.i) {
        _deps.move(drag.i, target, { coalesceKey: drag.key, preview: false });
        drag.i = target; drag.x0 = e.clientX; setSelected(target);
      }
    }
  });

  const end = () => {
    _dragging = false;
    if (!drag) return;
    const wasClick = (drag.kind === 'move' || drag.kind === 'slip' || drag.kind === 'aslip') && !drag.moved;
    drag = null;
    box.querySelectorAll('.dragging').forEach((n) => n.classList.remove('dragging'));
    // A click that never became a drag is a selection.
    if (wasClick) _deps.select?.(_selected);
    // The preview was held still for the length of the gesture; catch it up now.
    else _deps.settle?.();
    renderTrack();
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);

  /* Keyboard parity. A block is a button, so arrows nudge the trim and
     Alt+arrows reorder — the same two things the pointer does. */
  box.addEventListener('keydown', (e) => {
    const sound = e.target.closest('.tl-aclip');
    if (sound) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const k = Number(sound.dataset.i);
      const c = (_deps.audio ? _deps.audio() : [])[k];
      if (!c || !_deps.editAudio) return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const step = e.shiftKey ? 1 : 0.1;
      const live = { coalesceKey: `tl-akey-${keySeq}`, preview: false };
      if (e.altKey) {
        const at = Math.max(0, Math.min(MAX_START, (c.at ?? 0) + dir * step));
        _deps.editAudio(k, { at: Math.round(at * 100) / 100 }, 'move sound', live);
      } else {
        const out = Math.max(c.in + 0.1, c.out + dir * step);
        _deps.editAudio(k, { out: Math.round(out * 100) / 100 }, 'trim sound', live);
      }
      return;
    }
    const block = e.target.closest('.tl-clip');
    if (!block) return;
    const i = Number(block.dataset.i);
    const clips = _deps.clips();
    const c = clips[i];
    if (!c) return;
    const step = e.shiftKey ? 1 : 0.1;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    // Held arrows repeat; one key per (clip, gesture kind) collapses a held
    // press into a single undo entry the same way a drag does, and the 600ms
    // coalesce window splits it once the author lets go and thinks.
    // preview:false for the same reason as a drag — a held arrow repeats about
    // thirty times a second, and each restart would throw the preview back to
    // the top of the sequence. keyup catches it up and ends the gesture.
    const live = { coalesceKey: `tl-key-${keySeq}`, preview: false };
    if (e.altKey && isOverlay(c)) {
      // Alt is "move this clip" on both tracks. On the overlay track moving it
      // means moving it in TIME, which is the same thing the pointer does there.
      const at = Math.max(0, Math.min(MAX_START, (c.at ?? 0) + dir * step));
      _deps.edit(i, { at: Math.round(at * 100) / 100 }, 'move overlay', live);
    } else if (e.altKey) {
      // To the next slot ON THE SPINE: stepping into an array slot held by an
      // overlay would look like the key did nothing.
      const spine = clips.map((x, k) => (isOverlay(x) ? -1 : k)).filter((k) => k >= 0);
      const p = spine.indexOf(i);
      const to = spine[Math.max(0, Math.min(spine.length - 1, p + dir))] ?? i;
      // Follow the clip to its new slot rather than staying on the index, which
      // now holds the neighbour that was shuffled past.
      if (to !== i) { focusClipAfterRender(to); _deps.move(i, to, live); }
    } else {
      _deps.edit(i, { out: Math.round(Math.min(c.src, Math.max(c.in + 0.1, c.out + dir * step)) * 100) / 100 },
        'trim out', live);
    }
    // No renderTrack() here: the commit re-renders, and doing it twice would
    // rebuild the button under the author's finger for no reason.
  });

  box.addEventListener('keyup', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    keySeq++;             // the gesture is over: the next press is a new entry
    _deps.settle?.();
  });
}

export function initTrack(deps) {
  _deps = deps;
  const box = $('tl-track');
  if (!box) return;
  wire(box);
  renderTrack();
}
