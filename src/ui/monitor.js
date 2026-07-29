/* Dead Signal Studio — ui/monitor.js
 *
 * Placing a clip by pointing at where it should go.
 *
 * WHY THIS EXISTS
 *
 * The transform arrived as five number boxes. Those describe a position; they
 * are not a way to place one. Nobody aiming an inset at the bottom-right corner
 * thinks "x plus nought point two five" — they point at the corner, and then
 * nudge. The boxes stay, because typing 0.25 is how you make two insets match
 * exactly, but they should not be the only way in.
 *
 * WHAT THIS IS NOT
 *
 * It is not a second renderer. The overlay is drawn by the PREVIEW LOOP after
 * `renderTimelineFrame` has finished, onto the same canvas — so it exists in
 * exactly one place, and neither export path can pick it up: the offline
 * encoder and the real-time recorder both call `renderTimelineFrame` themselves
 * and never come through here. A handle baked into somebody's upload is the
 * failure mode this arrangement rules out by construction rather than by
 * remembering to clear a flag.
 *
 * THE ONE THING THAT MAKES IT WORK
 *
 * The canvas is DISPLAYED at whatever size the monitor row allows and holds a
 * buffer of the sequence's own W×H. A pointer arrives in CSS pixels and every
 * piece of maths here is in buffer pixels, so every event converts through the
 * element's rect first. Skip that and the handles are exactly where they look
 * on a 1:1 monitor and increasingly wrong as the window changes size — a bug
 * that reads as "sometimes it feels sticky" rather than as an error.
 */
import { $, toast } from '../core/dom.js';
import { clipLength } from '../doc/timeline.js';
import { HANDLE_PX, ROT_ARM_PX, handlesFor, hitHandle, invertPoint, isIdentity, makeTransform,
         matrixFor, moveBy, rotAt, scaleAt } from '../doc/transform.js';
import { insideMask, makeMatte, maskActive, maskBoxOf, maskHandlesFor, maskMoveBy, maskResizeTo,
         maskRotAt } from '../doc/matte.js';
import { selectedClip } from './track.js';
import { buildSchedule, editClip, sampleClipColour, timeline, tlScrubT } from '../video/timeline.js';

/* Live gesture, or null. Held here rather than on the element because a drag
   survives the preview repainting the canvas thirty times underneath it. */
let _drag = null;
/* One key per gesture, so a drag is a single undo entry — the same contract the
   lane's drags have. */
let _seq = 0;
let _wired = false;

/* ============================================================== the mode ==
   The monitor edits ONE thing at a time, and which one is explicit.

   It has to be. A clip's transform box and its mask box are both rectangles
   with corner grips, they overlap for most of the useful range, and on a
   full-frame mask they are the same four points — so a single hit test would
   have to guess, and it would guess wrong exactly when the author was being
   careful. A mode is a control the author sets, in the same panel group as the
   fields it edits, and the overlay says which one is live by drawing only that
   box.

   'eyedrop' draws NOTHING, deliberately: it is a mode for looking at a colour,
   and an overlay across the picture is the one thing that could make you click
   the wrong one.
   ======================================================================== */
const MODES = ['transform', 'mask', 'eyedrop'];
let _mode = 'transform';
const _modeSubs = new Set();

export const monitorMode = () => _mode;
/** Subscribe to mode changes — the panel's buttons show which one is live. */
export function onMonitorMode(fn) {
  if (typeof fn === 'function') _modeSubs.add(fn);
  return () => _modeSubs.delete(fn);
}
export function setMonitorMode(m) {
  const next = MODES.includes(m) ? m : 'transform';
  if (next === _mode) return _mode;
  _mode = next;
  _drag = null;
  const canvas = $('tlcanvas');
  if (canvas) canvas.style.cursor = next === 'eyedrop' ? 'crosshair' : '';
  for (const fn of _modeSubs) { try { fn(_mode); } catch { /* a listener is not the monitor's problem */ } }
  return _mode;
}

/**
 * The clip the overlay belongs to: the selected one, IF the playhead is over it.
 *
 * Both halves matter. Without a selection there is nothing to place; without
 * the playhead being over it, the box would float over a picture that is not
 * the clip it describes, and dragging it would move something invisible.
 */
export function monitorTarget(sched) {
  const i = selectedClip();
  if (i < 0) return null;
  const c = timeline[i];
  if (!c) return null;
  const s = sched || buildSchedule();
  const start = Number(s.starts?.[i]) || 0;
  const len = clipLength(c);
  if (!(tlScrubT >= start - 1e-6 && tlScrubT < start + len + 1e-6)) return null;
  return { i, clip: c, W: s.tl.W, H: s.tl.H };
}

/**
 * Draw the box, its corners and its rotation grip.
 *
 * Deliberately drawn even when the clip is at the identity: "this is the clip
 * you are editing, and it is the whole frame" is information, and an overlay
 * that appeared only once you had already moved something would be a handle you
 * could not find until you no longer needed it.
 */
export function paintMonitorOverlay(ctx, sched) {
  const t = monitorTarget(sched);
  if (!t || !ctx) return false;
  /* Nothing at all while the eyedropper is armed. The whole gesture is "look at
     the picture and click the colour you mean", and a dashed box with five dots
     on it across the thing you are aiming at is precisely the wrong furniture. */
  if (_mode === 'eyedrop') return false;
  const { clip, W, H } = t;
  const mask = _mode === 'mask' && maskActive(clip);
  const h = mask ? maskGrips(clip, W, H) : handlesFor(clip, W, H);
  drawGrips(ctx, h, mask ? '#ffcc55' : '#39ff9e');
  return true;
}

/**
 * The box, its corners and its rotation grip.
 *
 * One routine for both boxes, because they are the same drawing in a different
 * colour — and a second copy would be the one that stops matching the first the
 * next time the dash pattern changes.
 */
function drawGrips(ctx, h, colour) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  // Drawn twice, dark then bright: the picture underneath is arbitrary, and a
  // single-colour outline disappears against whatever it happens to cross.
  for (const pass of [0, 1]) {
    if (pass) { ctx.strokeStyle = colour; ctx.setLineDash([4, 3]); }
    ctx.beginPath();
    ctx.moveTo(h.corners[0][0], h.corners[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(h.corners[i][0], h.corners[i][1]);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo((h.corners[0][0] + h.corners[1][0]) / 2, (h.corners[0][1] + h.corners[1][1]) / 2);
    ctx.lineTo(h.rot[0], h.rot[1]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const dot = (p, r) => {
    ctx.beginPath();
    ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.stroke();
  };
  for (const c of h.corners) dot(c, 3.5);
  dot(h.rot, 4);
  ctx.restore();
}

/**
 * The mask's grips, in OUTPUT pixels.
 *
 * doc/matte.js answers in the clip's own buffer space, because that is the
 * space the mask is applied in and it must not know about the transform. This
 * is the one place the two meet: every buffer point goes through the same
 * matrix the compositor draws the clip with, so the mask box on screen is the
 * mask as it will actually land — shrunk with a shrunken clip, tilted with a
 * tilted one.
 *
 * The rotation ARM is added afterwards and in output pixels, for the reason
 * handlesFor gives: it is a thing you grab with a pointer, so it is measured in
 * the space the pointer is in. At 0.2× scale a buffer-space arm would put the
 * grip inside the box.
 */
function maskGrips(clip, W, H) {
  const h = maskHandlesFor(clip, W, H);
  const m = matrixFor(clip, W, H);
  const at = (p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
  const centre = at(h.centre);
  const corners = h.corners.map(at);
  const topMid = at(h.topMid);
  const dx = topMid[0] - centre[0];
  const dy = topMid[1] - centre[1];
  const mag = Math.hypot(dx, dy) || 1;
  return { centre, corners, rot: [topMid[0] + (dx / mag) * ROT_ARM_PX, topMid[1] + (dy / mag) * ROT_ARM_PX] };
}

/** Pointer position in BUFFER pixels — see the note at the top of this file. */
function bufferPoint(canvas, e) {
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return { x: 0, y: 0 };
  return {
    x: ((e.clientX - r.left) / r.width) * canvas.width,
    y: ((e.clientY - r.top) / r.height) * canvas.height,
  };
}

/** What this pointer position would do, for the cursor and for the gesture. */
export function monitorHitAt(canvas, e, sched) {
  const t = monitorTarget(sched);
  if (!t || !canvas) return '';
  const p = bufferPoint(canvas, e);
  /* The tolerance is in BUFFER pixels, so it has to be the display tolerance
     scaled by however much the monitor is being shrunk or blown up. A fixed
     buffer tolerance is a generous grab on a 1080-wide sequence shown small and
     an impossible one on a 128-wide sequence shown large. */
  const r = canvas.getBoundingClientRect();
  const zoom = r.width ? canvas.width / r.width : 1;
  const tol = HANDLE_PX * zoom;
  if (_mode === 'mask') {
    if (!maskActive(t.clip)) return '';
    const g = maskGrips(t.clip, t.W, t.H);
    const near = (q) => Math.hypot(p.x - q[0], p.y - q[1]) <= tol;
    if (near(g.rot)) return 'rot';
    for (let i = 0; i < 4; i++) if (near(g.corners[i])) return `c${i}`;
    /* Inside-ness is asked in the clip's own space, not on screen: the mask
       rectangle lives in the buffer, and a transformed clip puts it somewhere
       else entirely. Same inverse the eyedropper uses. */
    const b = invertPoint(t.clip, t.W, t.H, p.x, p.y);
    return insideMask(t.clip, t.W, t.H, b.x, b.y) ? 'move' : '';
  }
  return hitHandle(t.clip, t.W, t.H, p.x, p.y, tol);
}

/** Wire the monitor canvas. Safe to call more than once. */
export function initMonitor() {
  const canvas = $('tlcanvas');
  if (!canvas || _wired) return false;
  _wired = true;

  const end = () => {
    if (!_drag) return;
    _drag = null;
    _seq++;
    canvas.style.cursor = '';
  };

  canvas.addEventListener('pointerdown', (e) => {
    const sched = buildSchedule();
    const t = monitorTarget(sched);
    if (!t) return;
    /* The eyedropper is a click, not a drag: one sample, then the mode ends. It
       is checked before the hit test because it has no handles to hit — the
       whole picture is the target. */
    if (_mode === 'eyedrop') {
      e.preventDefault();
      const p = bufferPoint(canvas, e);
      const hex = sampleClipColour(t.i, p.x, p.y);
      setMonitorMode('transform');
      if (!hex) { toast('That is outside the clip — aim at its picture', 'warn'); return; }
      /* Turning the key ON is the point of having picked a colour: setting one
         on a clip whose key is off would look like the tool doing nothing. One
         patch, so it is one undo. */
      const patch = t.clip.keyMode === 'off'
        ? { keyColour: hex, keyMode: 'chroma' }
        : { keyColour: hex };
      editClip(t.i, patch, 'pick key colour');
      toast(`Key colour ${hex}${t.clip.keyMode === 'off' ? ' — colour key on' : ''}`);
      return;
    }
    const kind = monitorHitAt(canvas, e, sched);
    if (!kind) return;
    const p = bufferPoint(canvas, e);
    /* The gesture works from a SNAPSHOT taken at pointerdown — of the transform
       or of the matte, depending which box is live — and applies the whole
       delta to it on every move. See the note in the move branch below. */
    const v = _mode === 'mask' ? makeMatte(t.clip) : makeTransform(t.clip);
    const b = _mode === 'mask' ? invertPoint(t.clip, t.W, t.H, p.x, p.y) : null;
    _drag = { kind, i: t.i, W: t.W, H: t.H, x0: p.x, y0: p.y,
      bx0: b ? b.x : 0, by0: b ? b.y : 0, mask: _mode === 'mask', from: v, key: `mon-${_seq}` };
    try { canvas.setPointerCapture?.(e.pointerId); } catch { /* no active pointer */ }
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!_drag) {
      if (_mode === 'eyedrop') { canvas.style.cursor = 'crosshair'; return; }
      // Cursor as an affordance: without it the handles are invisible until you
      // happen to press on one.
      const k = monitorHitAt(canvas, e);
      canvas.style.cursor = k === 'rot' ? 'grab' : k === 'move' ? 'move'
        : k ? 'nwse-resize' : '';
      return;
    }
    const p = bufferPoint(canvas, e);
    const live = { coalesceKey: _drag.key, preview: false };
    const { W, H } = _drag;
    if (_drag.mask) {
      /* Every mask gesture is answered in the clip's own buffer space, so the
         same drag means the same thing whatever the clip has been scaled,
         moved or rotated to. Converting the pointer once, here, is what keeps
         doc/matte.js free of the transform entirely. */
      const clip = timeline[_drag.i];
      if (!clip) return;
      const b = invertPoint(clip, W, H, p.x, p.y);
      if (_drag.kind === 'move') {
        editClip(_drag.i, maskMoveBy(_drag.from, W, H, b.x - _drag.bx0, b.y - _drag.by0), 'move mask', live);
      } else if (_drag.kind === 'rot') {
        editClip(_drag.i, { maskRot: maskRotAt(maskBoxOf(_drag.from, W, H), b.x, b.y) }, 'rotate mask', live);
      } else {
        editClip(_drag.i, maskResizeTo(_drag.from, W, H, b.x, b.y), 'size mask', live);
      }
      return;
    }
    if (_drag.kind === 'move') {
      /* From the ORIGINAL transform plus the whole delta, not from the current
         one plus a step. Accumulating steps drifts by the rounding on every
         move — a hundred pointermoves is a hundred roundings — and a clip that
         ends up somewhere other than under the pointer is the exact complaint
         direct manipulation exists to answer. */
      const next = moveBy(_drag.from, W, H, p.x - _drag.x0, p.y - _drag.y0);
      editClip(_drag.i, next, 'move clip', live);
    } else if (_drag.kind === 'rot') {
      const h = handlesFor({ ..._drag.from, rot: 0 }, W, H);
      editClip(_drag.i, { rot: rotAt(h.centre, p.x, p.y) }, 'rotate clip', live);
    } else {
      const h = handlesFor(_drag.from, W, H);
      editClip(_drag.i, { scale: scaleAt(W, H, h.centre, p.x, p.y) }, 'scale clip', live);
    }
  });

  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  /* Double-click puts it back. The one gesture that is hard to undo by hand is
     a clip you have dragged off screen, because there is nothing left to grab. */
  canvas.addEventListener('dblclick', (e) => {
    // Only the box that is live. A double-click that reset the TRANSFORM while
    // the author was placing a mask would undo work they were not looking at.
    if (_mode !== 'transform') return;
    const t = monitorTarget();
    if (!t || isIdentity(t.clip)) return;
    e.preventDefault();
    editClip(t.i, { x: 0, y: 0, scale: 1, rot: 0, flip: 'none' }, 'reset transform');
    toast('Transform reset');
  });
  /* Escape leaves whichever mode is on. Both of them change what a click on the
     picture does, and a mode you can only leave by finding the button that
     started it is a mode people get stuck in. */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || _mode === 'transform') return;
    setMonitorMode('transform');
    toast('Back to placing the clip');
  });
  return true;
}

/** For the suites: the grip geometry the pointer maths is built on. */
export { HANDLE_PX, ROT_ARM_PX };
