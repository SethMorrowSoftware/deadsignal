/* Dead Signal Studio — ui/inspector.js
 *
 * The properties of the selected clip, in the right-hand column of the editor.
 *
 * WHY THIS EXISTS
 *
 * The editor shell gave the sequence a selection, a playhead and edit commands,
 * but every control that decides how a clip LOOKS was still document-wide: the
 * VIDEO tab's scene, copy and colours describe the next clip you add, not the
 * one you have selected. So a sequence could not hold two clips that differ,
 * and the only way to change one already in it was to delete it and build it
 * again. An editor whose only per-clip edit is "delete and redo" is a renderer
 * with a queue attached.
 *
 * The document was ready for this — a clip has carried its own recipe since the
 * timeline learned to trim, and video/timeline.js renders each clip from that
 * recipe rather than from the live tab. What was missing was somewhere to edit
 * it.
 *
 * HOW IT IS BUILT
 *
 *   - Which fields exist, and what each edit does to the clip, live in
 *     doc/clipedit.js — pure, and therefore pinned by the headless suite. This
 *     file is the panel: it draws those descriptions, and hands every change to
 *     editClip() so a clip edit is an ordinary undoable document command like
 *     any other.
 *
 *   - Option lists are CLONED from the real pickers (#v-scene, #i-tpl) rather
 *     than rebuilt from the registries. The tab's list already reflects the
 *     installed packs and the complexity filter; a second list built from the
 *     registry would show scenes the tab is hiding, and would drift the first
 *     time either gained an entry.
 *
 *   - The look surface here is small on purpose. The five things that make one
 *     clip read differently from the next are here; everything else is authored
 *     on the tab and travels to the clip through the round trip — "Send to tab"
 *     loads the clip's look into VIDEO or SCREEN, "Update from tab" takes it
 *     back. Copying sixty controls into this panel would be a second VIDEO tab
 *     that drifts from the first.
 *
 *   - Rebuilds are guarded by a signature of what is on screen, so the 4Hz
 *     status tick and every store notification are free unless something the
 *     panel shows actually changed. When it does change, focus and the caret
 *     are put back — this panel is full of fields, and a rebuild that drops the
 *     caret mid-word is worse than no live update at all.
 */
import { $, toast } from '../core/dom.js';
import {
  SOURCE_TAB, SOURCE_VIEW, audioFieldsFor, audioPatchFor, audioValueFor, clipTracks,
  curvesSignature, fieldsFor, keysPastEnd, matteNotes, patchFor, patchForClearParam, patchForKey,
  patchForKeyRemove, patchForTrack, patchFromRecipe, recipeShortfall, soundSummary,
  trimSummary, valueFor,
} from '../doc/clipedit.js';
import { hasMatte, maskActive, matteSummary, needsAlphaBlend } from '../doc/matte.js';
import { monitorMode, monitorTarget, onMonitorMode, setMonitorMode } from './monitor.js';
import { ALPHA_BLEND } from '../doc/layers.js';
import { isFirstOnTrack, isOverlay } from '../doc/timeline.js';
import { EASE_NAMES } from '../doc/automation.js';
import { FONTS } from '../core/text.js';
import { isIdentity, offFrame, transformSummary } from '../doc/transform.js';
import { AUTOMATABLE, clipParamValue } from '../video/automation.js';
import { getStore } from '../doc/session.js';
import { applyRecipe } from '../core/recipes.js';
import { onLibraryChange } from '../library/library.js';
import { onClipSelect, selectedAudio, selectedClip } from './track.js';
import { activateTab } from './shell.js';
import { audioTimeline, bedOptionList, buildSchedule, captureClipRecipe, clipSourceTime, editAudioClip, editClip, startTimelinePreview, timeline } from '../video/timeline.js';

const GROUPS = [
  ['clip', ''],
  ['timing', 'Timing'],
  ['transition', 'Transition'],
  ['overlay', 'Overlay'],
  ['transform', 'Transform'],
  ['matte', 'Key & mask'],
  ['mix', 'Mix'],
  ['look', 'Look'],
  ['curves', 'Keyframes'],
  ['sound', 'Sound'],
];

let _body = null;
let _which = null;
let _sig = null;
/* Set while a control is being dragged (a colour well, mostly). A rebuild in
   the middle of that closes the native picker under the author's pointer, so
   the panel holds still until the gesture ends and then catches up. */
let _hold = false;
/* Bumped when the library changes: the sound picker's options come from it, and
   they are not part of the clip, so the signature cannot see them move. */
let _epoch = 0;
/* Which lane the panel is showing. Read by commit() and buildControl(), which
   otherwise cannot tell an index into the clips from one into the sounds. */
let _lane = 'V';
/* Which parameter the Keyframes panel is showing. PANEL state, not clip state —
   it cannot go through valueFor/patchFor without pretending a clip has a
   "currently selected parameter", which it does not. */
let _curveParam = AUTOMATABLE[0]?.id || '';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* Every control in this studio is addressed by id. `v-scene` becomes
   `insp-v-scene`, which cannot collide with the real control it mirrors. */
const idFor = (key) => `insp-${key}`;

/* -------------------------------------------------------------- options -- */

/** The live options of a real picker, optgroups and all. */
function cloneOptions(sourceId, value) {
  const src = $(sourceId);
  const out = [];
  if (src) {
    for (const o of src.options) {
      out.push({ v: o.value, t: o.textContent, group: o.parentElement?.label || '' });
    }
  }
  /* A value this build has no entry for — an older project, a pack that is not
     installed — is kept as an option rather than silently re-pointed at
     whatever happens to be first in the list, which is how an edit to one field
     quietly changes another. */
  if (value && !out.some((o) => o.v === value)) out.push({ v: value, t: `${value} (not installed)`, group: '' });
  return out;
}

function optionsFor(field, value) {
  if (field.options) return field.options;
  if (field.optionsFrom === 'beds') return bedOptionList(value);
  if (field.optionsFrom === 'scenes') return cloneOptions('v-scene', value);
  if (field.optionsFrom === 'templates') return cloneOptions('i-tpl', value);
  /* From the FONTS registry rather than a cloned control: the title's face
     picker has no counterpart on any tab to clone from — a title is edited
     here and nowhere else. */
  if (field.optionsFrom === 'fonts') {
    return Object.entries(FONTS).map(([v, f]) => ({ v, t: f.label }));
  }
  return [];
}

/* --------------------------------------------------------------- fields -- */

function commit(i, key, raw, opts) {
  if (_lane === 'A') {
    const sound = audioTimeline[i];
    if (!sound) return false;
    const patch = audioPatchFor(sound, key, raw);
    if (!patch) return false;
    editAudioClip(i, patch, `sound ${key}`, opts);
    return true;
  }
  const clip = timeline[i];
  if (!clip) return false;
  /* Moving a clip to the overlay track has to keep it where it is on the
     clock, and only the schedule knows where that is: a spine clip's start is
     derived from everything before it. Without this the clip would land at
     zero and appear to jump to the top of the sequence. */
  const patch = key === 'track'
    ? patchForTrack(clip, raw, buildSchedule().starts[i] ?? 0)
    : patchFor(clip, key, raw);
  // patchFor returns null when the edit changes nothing — a re-render, a blur,
  // or a value the author typed and then undid by hand. Committing it anyway
  // would put an empty entry in the undo stack for each one.
  if (!patch) return false;
  editClip(i, patch, `clip ${key}`, opts);
  return true;
}

function buildControl(field, clip, i) {
  const value = _lane === 'A' ? audioValueFor(clip, field.key) : valueFor(clip, field.key);
  const id = idFor(field.key);
  let ctl;

  if (field.kind === 'select') {
    ctl = document.createElement('select');
    const groups = new Map();
    for (const o of optionsFor(field, value)) {
      const opt = document.createElement('option');
      opt.value = o.v;
      opt.textContent = o.t;
      if (String(o.v) === String(value)) opt.selected = true;
      if (o.group) {
        let g = groups.get(o.group);
        if (!g) { g = document.createElement('optgroup'); g.label = o.group; groups.set(o.group, g); ctl.appendChild(g); }
        g.appendChild(opt);
      } else ctl.appendChild(opt);
    }
  } else if (field.kind === 'check') {
    ctl = document.createElement('input');
    ctl.type = 'checkbox';
    ctl.checked = !!value;   /* dom-only: constructing a control from a document value, not writing behind the document's back — setVal addresses controls by id and this one is not in the page yet */
  } else if (field.kind === 'textarea') {
    ctl = document.createElement('textarea');
    ctl.rows = 3;
    ctl.value = String(value ?? '');
  } else {
    ctl = document.createElement('input');
    ctl.type = field.kind === 'number' ? 'number' : field.kind === 'color' ? 'color' : 'text';
    if (field.kind === 'number') {
      if (field.min != null) ctl.min = String(field.min);
      if (field.max != null) ctl.max = String(field.max);
      if (field.step != null) ctl.step = String(field.step);
    }
    /* A colour well with no value at all renders black and would write black
       into the recipe the moment it is touched. An empty recipe key means "the
       tab's default", so show something legible instead of inventing a colour. */
    ctl.value = field.kind === 'color' && !value ? (field.key.endsWith('-bg') ? '#000000' : '#ffffff') : String(value ?? '');
  }

  ctl.id = id;
  ctl.dataset.key = field.key;
  if (field.disabled) ctl.disabled = true;
  if (field.hint) ctl.title = field.hint;

  if (field.kind === 'check') {
    ctl.addEventListener('change', () => commit(i, field.key, ctl.checked));
  } else if (field.kind === 'color') {
    // Dragging a colour well fires input continuously. One undo entry for the
    // whole gesture, and the preview is left alone until it ends — the same
    // contract the trim handles use in ui/track.js.
    const key = `insp-${field.key}-${i}`;
    ctl.addEventListener('input', () => { _hold = true; commit(i, field.key, ctl.value, { coalesceKey: key, preview: false }); });
    ctl.addEventListener('change', () => { _hold = false; commit(i, field.key, ctl.value, { coalesceKey: key }); startTimelinePreview(); render(); });
  } else {
    // change, not input: an edit is what the author finished typing, so the
    // sequence does not re-render on every keystroke of a line of copy.
    ctl.addEventListener('change', () => { commit(i, field.key, ctl.value); });
  }
  return ctl;
}

function buildField(field, clip, i) {
  const row = el('div', `insp-row${field.kind === 'textarea' ? ' wide' : ''}`);
  const lab = el('label', null, field.label);
  lab.htmlFor = idFor(field.key);
  row.appendChild(lab);
  row.appendChild(buildControl(field, clip, i));
  if (field.unit) row.appendChild(el('span', 'insp-unit', field.unit));
  return row;
}

/* --------------------------------------------------------------- render -- */

function signature(i, clip, lane) {
  if (!clip) return `none:${_epoch}`;
  const fields = lane === 'A'
    ? audioFieldsFor(clip).map((f) => `${f.key}=${audioValueFor(clip, f.key)}`)
    : fieldsFor(clip, isFirstOnTrack(timeline, i) ? 0 : 1).map((f) => `${f.key}=${valueFor(clip, f.key)}:${f.disabled ? 'd' : ''}`);
  /* The curves are inside `rec`, which no field key reads — so without this a
     keyframe edit produces an identical signature, render() returns early, and
     the key list sits frozen while the picture changes. The picker is here too,
     so switching parameters repaints the list. */
  /* The monitor's mode is PANEL state, not clip state, and no field key reads
     it — so without it here the two buttons would never repaint and arming the
     eyedropper would leave a button that still says "Pick key colour". */
  /* Playhead-derived state, frame-rounded so scrubbing repaints these at most
     once per frame: whether the monitor tools have a clip under the playhead
     (the eyedropper/mask buttons disable on it) and where a key would land
     (the "Key at Xs" button prints it). Neither is a field, so without these
     terms both sat stale until something else moved. */
  const overClip = monitorTarget() ? 1 : 0;
  const keyAt = lane === 'A' ? '' : (Math.round((clipSourceTime(i) ?? -1) * 12) / 12).toFixed(2);
  return [lane, i, timeline.length, audioTimeline.length, clip.kind ?? 'sound', _epoch,
    _curveParam, monitorMode(), overClip, keyAt, curvesSignature(clip), ...fields].join('|');
}

/** Rebuild the panel if what it shows has changed. Cheap when it has not. */
export function render() {
  if (!_body) return;
  if (_hold) return;
  const ai = selectedAudio();
  const lane = ai >= 0 ? 'A' : 'V';
  const i = lane === 'A' ? ai : selectedClip();
  const clip = lane === 'A' ? audioTimeline[i] : timeline[i];
  const sig = signature(i, clip, lane);
  if (sig === _sig) return;
  _sig = sig;
  _lane = lane;

  /* Where the author was. Restored by id below — the panel is rebuilt whole
     (there are only ~12 controls in it) and a rebuild that silently drops focus
     mid-edit is the reason live-updating panels get a bad name. */
  const active = document.activeElement;
  const keepId = active && _body.contains(active) ? active.id : null;
  const caret = keepId && typeof active.selectionStart === 'number'
    ? [active.selectionStart, active.selectionEnd] : null;

  _body.replaceChildren();
  const total = lane === 'A' ? audioTimeline.length : timeline.length;
  if (_which) _which.textContent = clip ? `${i + 1} / ${total}` : '—';

  if (!clip) {
    // "Click one in the sequence below" is a lie when the sequence is empty.
    const p = el('p', 'nle-empty', timeline.length || audioTimeline.length
      ? 'No clip selected. Click one in the sequence below to edit its trim, its transition and its look.'
      : 'Nothing to select yet. Add a scene to the sequence — ＋ Scene in the timeline bar — and its properties appear here.');
    _body.appendChild(p);
    return;
  }

  const head = el('div', 'insp-head');
  head.appendChild(el('span', `insp-kind ${lane === 'A' ? 'sound' : clip.kind}`,
    lane === 'A' ? 'sound' : clip.kind === 'still' ? 'still' : 'video'));
  head.appendChild(el('span', 'insp-len', lane === 'A' ? soundSummary(clip) : trimSummary(clip)));
  _body.appendChild(head);

  // Spine position, not the raw array index i: an overlay at a lower array slot
  // must not make the opening spine clip look non-first (a dead transition ctl).
  const fields = lane === 'A' ? audioFieldsFor(clip) : fieldsFor(clip, isFirstOnTrack(timeline, i) ? 0 : 1);
  for (const [group, title] of GROUPS) {
    const inGroup = fields.filter((f) => f.group === group);
    if (!inGroup.length) continue;
    const sec = el('div', 'insp-group');
    if (title) sec.appendChild(el('div', 'insp-group-title', title));
    for (const f of inGroup) sec.appendChild(buildField(f, clip, i));
    if (group === 'timing' && lane === 'V') sec.appendChild(buildTimingExtras(clip, i));
    if (group === 'transform') sec.appendChild(buildTransformExtras(clip, i));
    if (group === 'matte') sec.appendChild(buildMatteExtras(clip, i));
    _body.appendChild(sec);
  }

  /* Stills have no automation and never will: a screen recipe carries marks,
     not curves, and the still branch of renderClipTo never calls
     renderVideoFrame. */
  if (lane === 'V' && clip.kind !== 'still') _body.appendChild(buildCurves(clip, i));

  /* The round trip is a picture idea: a sound has no recipe to send to a tab
     and nothing on a tab to take back. */
  if (lane === 'V') _body.appendChild(buildActions(clip, i));

  if (keepId) {
    const back = $(keepId);
    if (back) {
      back.focus();
      // setSelectionRange throws on inputs that do not carry a selection
      // (number, colour) — restoring the caret is a nicety, not a reason to
      // abandon the rebuild.
      if (caret) { try { back.setSelectionRange(caret[0], caret[1]); } catch { /* not a text field */ } }
    }
  }
}

/**
 * What the transform currently is, in words, and one way out of it.
 *
 * The summary earns its place because five numbers do not read as a position:
 * "50% · x +0.25 · y +0.25" is a thing you can check against the picture at a
 * glance, and four boxes of decimals is not. It is empty for a clip that fills
 * the frame, so the note only appears once there is something to say.
 *
 * The warning is the one state the preview cannot explain: a clip pushed
 * entirely off screen renders as nothing at all, which looks exactly like a
 * broken clip. Saying so — and offering the button that undoes it — is the
 * difference between a mistake and a bug report.
 */
function buildTransformExtras(clip, i) {
  const wrap = el('div', 'insp-note');
  const sum = transformSummary(clip);
  if (sum) wrap.appendChild(el('span', 'insp-len', sum));

  const btn = el('button', 'btn small', 'Fill frame');
  btn.type = 'button';
  btn.id = 'insp-untransform';
  btn.title = 'Put this clip back edge to edge, straight and unmirrored';
  btn.disabled = isIdentity(clip);
  btn.addEventListener('click', () => {
    editClip(i, { x: 0, y: 0, scale: 1, rot: 0, flip: 'none' }, 'reset transform');
    toast('Transform reset');
  });
  wrap.appendChild(btn);

  const { W, H } = buildSchedule().tl;
  if (offFrame(clip, W, H)) {
    wrap.appendChild(el('p', 'insp-warn',
      'This clip is entirely outside the frame, so it renders as nothing. '
      + 'Bring X and Y back towards 0, or press Fill frame.'));
  }
  return wrap;
}

/**
 * What the key and the mask currently amount to, and the two ways out.
 *
 * "Use whole clip" is the counterpart of "Fill frame": fifteen controls can put
 * a clip in a state whose way back is not obvious, and one button that means
 * "none of this" is worth more than knowing which two dropdowns to reset.
 *
 * "Composite normally" exists because the commonest mistake here is not in this
 * group at all — it is the Blend three groups up, still on the screen blend an
 * overlay defaults to, quietly undoing the key. matteNotes says so; this is the
 * button that acts on what it said, rather than making the author go and find
 * the control it is talking about.
 */
function buildMatteExtras(clip, i) {
  const wrap = el('div', 'insp-note');
  const sum = matteSummary(clip);
  if (sum) wrap.appendChild(el('span', 'insp-len', sum));

  const off = el('button', 'btn small', 'Use whole clip');
  off.type = 'button';
  off.id = 'insp-unmatte';
  off.title = 'Turn the key and the mask off — the clip is used edge to edge again';
  off.disabled = !hasMatte(clip);
  off.addEventListener('click', () => {
    editClip(i, { keyMode: 'off', maskShape: 'none' }, 'clear matte');
    toast('Key and mask off');
  });
  wrap.appendChild(off);

  /* Offered only when it would do something: on an overlay whose alpha is
     currently being thrown away by the blend. On the spine there is no blend to
     set, and the note says so instead. */
  if (needsAlphaBlend(clip) && isOverlay(clip) && (clip.blend ?? '') !== ALPHA_BLEND) {
    const fix = el('button', 'btn small', 'Composite normally');
    fix.type = 'button';
    fix.id = 'insp-alphablend';
    fix.title = 'Set this overlay’s blend to normal, so what the key kept is what you see';
    fix.addEventListener('click', () => {
      editClip(i, { blend: ALPHA_BLEND }, 'blend normally');
      toast('Blending by alpha');
    });
    wrap.appendChild(fix);
  }

  /* The two ways in that are not a number box. Both are MODES on the monitor,
     so both are toggles that say whether they are live — a button that arms
     something invisible and then looks exactly as it did is how people end up
     clicking the picture and wondering why nothing happens. */
  const armed = monitorMode();
  const overClip = !!monitorTarget();

  const pick = el('button', 'btn small', armed === 'eyedrop' ? 'Click the picture…' : 'Pick key colour');
  pick.type = 'button';
  pick.id = 'insp-eyedrop';
  pick.setAttribute('aria-pressed', armed === 'eyedrop' ? 'true' : 'false');
  pick.disabled = !overClip;
  pick.title = overClip
    ? 'Take the key colour off this clip’s own picture — sampled before the key, so you can widen a key that is nearly right'
    : 'Put the playhead over this clip first — there is no frame to sample otherwise';
  pick.addEventListener('click', () => {
    setMonitorMode(armed === 'eyedrop' ? 'transform' : 'eyedrop');
    if (armed !== 'eyedrop') toast('Click the colour to key');
  });
  wrap.appendChild(pick);

  const place = el('button', 'btn small', armed === 'mask' ? 'Placing mask…' : 'Place mask on monitor');
  place.type = 'button';
  place.id = 'insp-maskplace';
  place.setAttribute('aria-pressed', armed === 'mask' ? 'true' : 'false');
  place.disabled = !overClip || !maskActive(clip);
  place.title = !maskActive(clip)
    ? 'Give this clip a mask shape with some area first'
    : !overClip
      ? 'Put the playhead over this clip first'
      : 'Drag the mask on the monitor — the box, its corners, and the grip above it to turn it';
  place.addEventListener('click', () => setMonitorMode(armed === 'mask' ? 'transform' : 'mask'));
  wrap.appendChild(place);

  for (const note of matteNotes(clip)) wrap.appendChild(el('p', 'insp-warn', note));
  if (armed === 'mask') {
    wrap.appendChild(el('p', 'hint',
      'The mask box is on the monitor in amber. It travels with the clip, because a mask is applied to the clip’s own picture before the clip is placed. Escape to stop.'));
  }
  return wrap;
}

function buildTimingExtras(clip, i) {
  const wrap = el('div', 'insp-note');
  const btn = el('button', 'btn small', 'Whole source');
  btn.type = 'button';
  btn.id = 'insp-untrim';
  btn.title = 'Play this clip from end to end again';
  btn.disabled = clip.in <= 0.001 && clip.out >= clip.src - 0.001;
  btn.addEventListener('click', () => {
    editClip(i, { in: 0, out: clip.src }, 'reset trim');
    toast('Trim reset');
  });
  wrap.appendChild(btn);

  const short = recipeShortfall(clip);
  if (short > 0) {
    /* The one inconsistency neither the lane nor the table can show: the clip
       is longer than the recipe inside it, so its last seconds are a frozen
       frame. Edits made here keep the two together — this is for clips that
       arrived from an older project or a hand-edited file. */
    const warn = el('p', 'insp-warn',
      `The recipe inside this clip runs out ${short.toFixed(2)}s before the clip does — that tail is a frozen frame. `
      + 'Set the source length again, or update the look from the tab.');
    wrap.appendChild(warn);
  }
  return wrap;
}

/**
 * The selected clip's own keyframes.
 *
 * Built by hand rather than through fieldsFor, because the parameter picker is
 * panel state and the key list is a table, neither of which is a clip field.
 *
 * The value box is pre-filled from THIS CLIP's recipe, not from the VIDEO tab's
 * slider — the tab describes a different clip, and reading it here is how a
 * per-clip curve would quietly acquire the tab's value.
 */
function buildCurves(clip, i) {
  const wrap = el('div', 'insp-group');
  wrap.appendChild(el('div', 'insp-group-title', 'Keyframes'));

  const tracks = clipTracks(clip);
  const row = el('div', 'insp-row');
  const lab = el('label', null, 'Parameter');
  lab.htmlFor = 'insp-curve-param';
  const pick = document.createElement('select');
  pick.id = 'insp-curve-param';
  for (const p of AUTOMATABLE) {
    const o = document.createElement('option');
    o.value = p.id;
    const n = tracks[p.id]?.length || 0;
    // A diamond and a count, so the picker says which parameters are animated
    // without making the author click through sixteen of them to find out.
    o.textContent = (n ? `◆ ${p.id} (${n})` : p.id);
    if (p.id === _curveParam) o.selected = true;
    pick.appendChild(o);
  }
  pick.addEventListener('change', () => { _curveParam = pick.value; render(); });
  row.append(lab, pick);
  wrap.appendChild(row);

  const at = clipSourceTime(i);
  const vRow = el('div', 'insp-row');
  const vLab = el('label', null, 'Value');
  vLab.htmlFor = 'insp-curve-value';
  const vIn = document.createElement('input');
  vIn.type = 'number';
  vIn.id = 'insp-curve-value';
  vIn.step = '1';
  vIn.value = String(clipParamValue(clip, _curveParam) ?? 0);
  vRow.append(vLab, vIn);
  wrap.appendChild(vRow);

  const note = el('div', 'insp-note');
  const key = el('button', 'btn small', at == null ? 'Playhead off this clip' : `Key at ${at.toFixed(2)}s`);
  key.type = 'button';
  key.id = 'insp-curve-key';
  key.disabled = at == null;
  key.title = 'Add a keyframe for this parameter at the playhead, in this clip’s own source time';
  key.addEventListener('click', () => {
    const t = clipSourceTime(i);
    if (t == null) { toast('Put the playhead over this clip first'); return; }
    const patch = patchForKey(clip, _curveParam, t, Number(vIn.value) || 0);
    if (!patch) return;
    editClip(i, patch, 'keyframe');
    // The preview snapshots its schedule when it starts, so a curve edit has to
    // say so explicitly — the same reason the colour handler restarts it.
    startTimelinePreview();
  });
  note.appendChild(key);

  const clear = el('button', 'btn small', 'Clear');
  clear.type = 'button';
  clear.id = 'insp-curve-clear';
  clear.disabled = !(tracks[_curveParam]?.length);
  clear.title = 'Remove every keyframe on this parameter, for this clip';
  clear.addEventListener('click', () => {
    const patch = patchForClearParam(clip, _curveParam);
    if (!patch) return;
    editClip(i, patch, 'clear keyframes');
    startTimelinePreview();
  });
  note.appendChild(clear);

  const fromTab = el('button', 'btn small', 'Take VIDEO’s curves');
  fromTab.type = 'button';
  fromTab.id = 'insp-curves-fromtab';
  /* The destructive option, available but chosen rather than default: "Update
     from VIDEO" keeps this clip's curves precisely so it cannot silently
     replace them with a different clip's. */
  fromTab.title = 'Replace this clip’s curves with the ones the VIDEO tab is holding';
  fromTab.addEventListener('click', () => {
    const patch = patchFromRecipe(clip, captureClipRecipe('video'), { curves: 'tab' });
    if (!patch) return;
    editClip(i, patch, 'take tab curves');
    startTimelinePreview();
  });
  note.appendChild(fromTab);
  wrap.appendChild(note);

  const keys = tracks[_curveParam] || [];
  if (!keys.length) {
    wrap.appendChild(el('p', 'hint', `${_curveParam} is not keyframed on this clip — it holds one value throughout.`));
  } else {
    const table = document.createElement('table');
    table.className = 'keyframes';
    const body = document.createElement('tbody');
    keys.forEach((k) => {
      const tr = document.createElement('tr');
      const t = el('td', null, `${k.t.toFixed(2)}s`);
      const v = el('td', null, String(k.v));
      const e = el('td', null, k.e);
      const act = document.createElement('td');
      const rm = el('button', 'btn small', '✕');
      rm.type = 'button';
      rm.title = `Remove the key at ${k.t.toFixed(2)}s`;
      rm.setAttribute('aria-label', `Remove the ${_curveParam} key at ${k.t.toFixed(2)} seconds`);
      rm.addEventListener('click', () => {
        const patch = patchForKeyRemove(clip, _curveParam, k.t);
        if (!patch) return;
        editClip(i, patch, 'remove keyframe');
        startTimelinePreview();
      });
      act.appendChild(rm);
      tr.append(t, v, e, act);
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrap.appendChild(table);
  }

  const past = keysPastEnd(clip);
  if (past > 0) {
    wrap.appendChild(el('p', 'insp-warn',
      `${past} key${past === 1 ? '' : 's'} sit past the end of this clip and will not play. `
      + 'Lengthen the source, or remove them.'));
  }
  return wrap;
}

function buildActions(clip, i) {
  const wrap = el('div', 'insp-actions');
  /* A title has no tab to be sent to or updated from — every control it has is
     in this panel, which is the point of it. Offering the two buttons anyway
     would send it to VIDEO and quietly overwrite it with a scene recipe. */
  if (!SOURCE_TAB[clip.kind]) {
    wrap.appendChild(el('p', 'hint',
      'A title is edited here — there is no tab for it. The monitor shows it over the picture as you type.'));
    return wrap;
  }
  const view = SOURCE_VIEW[clip.kind] || SOURCE_VIEW.video;
  const tab = SOURCE_TAB[clip.kind] || SOURCE_TAB.video;
  const tabName = tab === 'image' ? 'SCREEN' : 'VIDEO';

  const send = el('button', 'btn small', `Send to ${tabName}`);
  send.type = 'button';
  send.id = 'insp-send';
  send.title = `Load this clip's look into the ${tabName} tab, where every control for it lives`;
  send.addEventListener('click', () => {
    applyRecipe(view, clip.rec);
    activateTab(tab);
    toast(`Clip ${i + 1} loaded into ${tabName}`);
  });

  const take = el('button', 'btn small', `Update from ${tabName}`);
  take.type = 'button';
  take.id = 'insp-recapture';
  take.title = `Replace this clip's look with what the ${tabName} tab shows now`;
  take.addEventListener('click', () => {
    const patch = patchFromRecipe(clip, captureClipRecipe(clip.kind));
    if (!patch) return;
    editClip(i, patch, 'update clip look');
    toast(`Clip ${i + 1} updated`);
  });

  wrap.append(send, take);
  return wrap;
}

/* ---------------------------------------------------------------- build -- */

/** The pane itself. Built by the editor shell and docked into its own column. */
export function buildInspectorPane() {
  const pane = el('aside', 'nle-pane nle-inspector');
  pane.id = 'nle-inspector';
  pane.setAttribute('aria-label', 'Clip properties');

  const head = el('div', 'nle-pane-head');
  head.appendChild(el('span', null, 'Clip'));
  _which = el('span', 'nle-count', '—');
  _which.id = 'nle-insp-which';
  head.appendChild(_which);
  pane.appendChild(head);

  _body = el('div', 'insp-body');
  _body.id = 'nle-insp-body';
  pane.appendChild(_body);
  return pane;
}

/** Wire it up. Called once, after the pane is in the page. */
export function initInspector() {
  onClipSelect(() => render());
  onLibraryChange(() => { _epoch++; render(); });
  // Arming a monitor mode has to show on the button that armed it — including
  // when Escape on the canvas is what disarmed it.
  onMonitorMode(() => render());
  // Every commit the store makes is a reason to re-read the clip — undo, a trim
  // dragged in the lane, an edit typed into the table underneath.
  getStore()?.subscribe?.('timeline.clips', () => render());
  render();
}
