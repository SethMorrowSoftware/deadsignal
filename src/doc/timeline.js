/* Dead Signal Studio — doc/timeline.js
 *
 * The stored shape of a sequence. Pure: no DOM, no store, no renderer.
 *
 * A clip used to be four fields — recipe, label, duration, scene — which made
 * TIMELINE a list of whole scenes played back to back rather than an edit. You
 * could not use part of a clip, every cut in the sequence had to be the same
 * kind of cut, and a still had nowhere to go at all.
 *
 * The three additions are what turn it into one:
 *
 *   in / out    the portion of the source this clip plays. `src` is how long
 *               the source runs; `out - in` is what the sequence gets.
 *   transition  how this clip ENTERS, and how long that takes. Held on the
 *               incoming clip because that is the one being introduced — the
 *               first clip's transition is therefore about the sequence
 *               opening, not about a cut.
 *   kind        'video' plays a scene recipe, 'still' holds a screen render.
 *   bed         sound this clip carries, laid over the sequence's own bed.
 *
 * Every one of them is optional, and a clip written before they existed reads
 * back as "the whole source, cut, video" — exactly what it was.
 *
 * THE SECOND TRACK
 *
 * V1 is the spine and is unchanged: its clips play in order, back to back, and
 * a crossfade overlaps the one before it. That is the whole of what a sequence
 * used to be, and a document written before tracks existed still schedules
 * exactly as it did.
 *
 * V2 is an overlay lane, and it is positioned rather than ordered:
 *
 *   track       'V1' | 'V2'.
 *   at          where a V2 clip STARTS on the sequence clock. An overlay is
 *               about a moment — a burst of static as a door opens — so
 *               "after the clip before it" is the wrong idea entirely, and a
 *               lane whose clips could only be appended would be useless.
 *   blend       how it is composited over V1, from the SAME vocabulary the
 *               layer stack inside a clip already uses (doc/layers.js) — one
 *               set of blend names in the tool, not two that drift. Default
 *               'screen', and that default is the point: every scene here
 *               draws bright marks on a near-black ground, so composited
 *               normally a V2 clip would simply REPLACE the picture, an
 *               overlay indistinguishable from a cut. Screen keys the black
 *               out for free, without an alpha channel this pipeline does not
 *               have.
 *   opacity     0..1, applied on top of the blend and of the clip's own fade.
 *
 * blend and opacity are stored on every clip so the shape does not change with
 * the track, and applied only on V2 — there is nothing underneath V1 to
 * composite against.
 */

import { BLENDS, DEFAULT_BLEND } from './layers.js';
import { normalizeTracks } from './automation.js';
import { makeTransform } from './transform.js';
import { makeMatte } from './matte.js';
import { LIB_PREFIX } from './audioclip.js';

export const TRANSITIONS = ['cut', 'crossfade', 'dip', 'dipwhite', 'burn', 'wipe', 'slide',
  'push', 'iris', 'clock', 'barn', 'blinds', 'whip', 'glitch'];
/* Where the incoming picture comes FROM, for the transitions that travel.
   A separate field rather than `wipe-left`/`wipe-right`/... as separate
   transitions: four directions on six transitions would turn a list of
   fourteen into a list of thirty-eight and make the picker useless, when an
   author thinks of it as one transition and a direction. */
export const XDIRS = ['l', 'r', 'u', 'd'];
export const DEFAULT_XDIR = 'l';
/* Which transitions travel, and so take a direction at all. Here rather than
   beside the drawing code because it is a fact about the VOCABULARY, and both
   sides need it: the compositor to draw, and the inspector to decide whether to
   offer the control. Two copies would be two things to update, and the module
   graph rejects the same name exported twice for exactly that reason. */
export const DIRECTIONAL = ['wipe', 'slide', 'push', 'barn', 'blinds', 'whip'];
export const takesDirection = (t) => DIRECTIONAL.includes(t);
/* …and of those, the ones where only the AXIS is a real choice. A barn door
   opens from the centre outward, so left and right are the same gesture.
   Faking a difference would be inventing a transition to make a control look
   busier than it is; the panel says so instead. */
export const AXIS_ONLY = ['barn'];
export const axisOnly = (t) => AXIS_ONLY.includes(t);
/**
 * Which transitions OVERLAP their neighbour.
 *
 * The distinction the schedule cares about, and the only one it cares about. A
 * dissolve, a wipe and a slide all show two clips at once, so the incoming one
 * has to start before the outgoing one ends — which shortens the sequence by
 * the overlap. A cut shows one clip, and a dip shows one clip and some black.
 *
 * Named rather than spelled `=== 'crossfade'` at each site because it was
 * spelled that way at two of them, and adding a wipe to a list of one is how
 * you get a transition that renders over its neighbour in the compositor and
 * plays after it in the schedule.
 */
export const OVERLAPPING = ['crossfade', 'wipe', 'slide', 'push', 'iris', 'clock',
  'barn', 'blinds', 'whip', 'glitch'];
export const overlaps = (c) => OVERLAPPING.includes(c?.transition);
export const DEFAULT_TRANSITION = 'crossfade';
/* 'title' is marks on nothing — the one kind whose buffer is CLEARED rather
   than filled, which is what lets it sit over the picture instead of replacing
   it. Like a still it has no time inside it: its `src` IS how long it is held,
   so speed and reverse are forced off for the same reason they are on a still.
   See doc/title.js. */
export const CLIP_KINDS = ['video', 'still', 'title', 'graphic'];
/** Kinds that hold for a duration rather than playing a source through. */
export const HELD_KINDS = ['still', 'title', 'graphic'];
/* Kinds drawn onto a CLEARED buffer, so they sit over the picture rather than
   replacing it. The distinction the compositor cares about is this one, not the
   list of names — see video/timeline.js. */
export const OVER_KINDS = ['title', 'graphic'];
export const TRACKS = ['V1', 'V2'];
/** Past this the sequence is longer than anything this tool should render. */
export const MAX_CLIPS = 64;
export const MIN_CLIP = 0.1;
export const MAX_CLIP = 60;
export const MAX_TRANSITION = 4;
/* How fast a clip may play. 0.1 is a ten-times slow motion and 8 is a blur;
   past either the clip is a technical curiosity rather than a shot. */
export const MIN_SPEED = 0.1;
export const MAX_SPEED = 8;
/** A V2 clip cannot start beyond the longest sequence this tool can build. */
export const MAX_START = MAX_CLIPS * MAX_CLIP;

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
/** Trim points are held to 1/100s: finer than that is not a cut anyone makes. */
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * A clip's recipe, with its curves put in order.
 *
 * evalTrack scans keyframes assuming ascending time, so an unsorted `__auto` —
 * from a hand-edited file, an older build, a share link — evaluates WRONG
 * rather than throwing. Normalising here means it is repaired on load, once,
 * rather than mis-read on every frame.
 *
 * The fast path returns the same object by reference: the overwhelming majority
 * of clips carry no curves at all, and this runs for every clip on every commit.
 */
const normalizeRec = (r) => {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return {};
  if (!r.__auto) return r;
  return { ...r, __auto: normalizeTracks(r.__auto) };
};

/**
 * The library key of the footage this clip plays, or ''.
 *
 * Lives here rather than in the renderer because three callers now want it and
 * they are on both sides of the pure/impure line: the compositor primes a
 * decoder for it, the mixer needs it to find the audio, and the panel needs to
 * know whether to offer the control at all.
 */
export function footageKeyOf(c) {
  if (!c || HELD_KINDS.includes(c.kind) || c.scene !== 'videoin') return '';
  const k = c.rec && typeof c.rec === 'object' ? c.rec['v-srckey'] : '';
  return typeof k === 'string' ? k : '';
}

/**
 * That same footage, addressed the way a SOUND SOURCE is addressed.
 *
 * Separate from footageKeyOf because the two forms are not the same string and
 * assuming they were is a bug I wrote and the tests caught: `#v-srckey` stores
 * the key ALREADY prefixed (`lib:abc`), while the decoder pool strips the
 * prefix and the mixer requires it. Prefixing footageKeyOf's result blindly
 * gives `lib:lib:abc`, which resolves to no asset and mixes to silence — a
 * failure that looks exactly like a browser that cannot decode the container.
 * Normalising, rather than adding, means either stored form works.
 */
export function footageSourceOf(c) {
  const k = footageKeyOf(c);
  if (!k) return '';
  return k.startsWith(LIB_PREFIX) ? k : LIB_PREFIX + k;
}

export function makeClip(c) {
  const kind = CLIP_KINDS.includes(c?.kind) ? c.kind : 'video';
  const held = HELD_KINDS.includes(kind);
  const track = TRACKS.includes(c?.track) ? c.track : 'V1';
  // `dur` is what a pre-trim clip called its length; it becomes the source
  // length, so an old sequence plays exactly as it did.
  const src = clamp(round2(num(c?.src, num(c?.dur, 10))), MIN_CLIP, MAX_CLIP);
  let inn = clamp(round2(num(c?.in, 0)), 0, src);
  let out = clamp(round2(num(c?.out, src)), 0, src);
  // A backwards or empty trim is not an edit, it is a mistake — the whole
  // source is the honest reading of it.
  if (!(out - inn >= MIN_CLIP)) { inn = 0; out = src; }
  return {
    kind,
    rec: normalizeRec(c?.rec),
    label: typeof c?.label === 'string' ? c.label.slice(0, 120) : 'Clip',
    scene: typeof c?.scene === 'string' ? c.scene
      : (HELD_KINDS.includes(kind) && kind !== 'still' ? kind
        : kind === 'still' ? 'still' : 'terminal'),
    src, in: inn, out,
    transition: TRANSITIONS.includes(c?.transition) ? c.transition : 'cut',
    xdur: clamp(round2(num(c?.xdur, 0.6)), 0, MAX_TRANSITION),
    /* Written unconditionally, like `at` and `blend`, so the stored shape of a
       clip does not change with its transition — doc/serialize.js insists the
       save/load round trip is byte-identical, and a key that came and went
       would break it. A clip written before directions existed reads back as
       the default, which is the left-to-right wipe it always had. */
    xdir: XDIRS.includes(c?.xdir) ? c.xdir : DEFAULT_XDIR,
    /* The sound this clip carries, over the sequence's own bed. A string in the
       same shape the VIDEO tab's picker uses ('' | 'last' | 'lib:<key>'), kept
       as authored rather than resolved: a library key that is not loaded yet is
       still the author's choice and must survive the round trip. */
    bed: typeof c?.bed === 'string' ? c.bed.slice(0, 200) : '',
    /* Does this clip play the sound that came with its own footage?
       Default OFF, and deliberately so. Turning it on by default would be the
       nicer answer for a clip added today and the wrong one for every project
       already saved: those clips were cut against silence, and a load that
       suddenly put dialogue under them would change an export the author had
       already approved. New footage clips ask for it explicitly at the point
       they are added (see addTimelineClip), which gets the expected behaviour
       for new work without rewriting old work. */
    srcAudio: !!c?.srcAudio,
    /* A held kind — a still, a title — has no time inside it: its `src` IS the
       hold. Speeding one up would be a second, confusing way to spell the
       length it already has. Forced rather than merely hidden, so a hand-edited
       file cannot smuggle one in.
       A title DOES animate, but that animation is a function of the clip's own
       length (see doc/title.js), so it stretches with the hold rather than
       being a source that could be played faster. */
    speed: held ? 1 : clipSpeed(c),
    reverse: held ? false : !!c?.reverse,
    track,
    /* Only V2 is positioned. A V1 clip carries 0 rather than nothing so the
       stored shape is the same on both tracks — doc/serialize.js insists a
       save/load round trip is byte-identical, and a key that appears and
       disappears with the track would break that. */
    at: track === 'V2' ? clamp(round2(num(c?.at, 0)), 0, MAX_START) : 0,
    blend: BLENDS.includes(c?.blend) ? c.blend : DEFAULT_BLEND,
    opacity: clamp(round2(num(c?.opacity, 1)), 0, 1),
    /* Where the clip sits in the frame — see doc/transform.js. Spread flat
       rather than nested for the same reason `at` and `blend` are: the stored
       shape of a clip is a flat record, and doc/serialize.js insists the save /
       load round trip is byte-identical. A clip written before any of this
       reads back as the identity, which is the frame-filling draw it has always
       had. Present on BOTH tracks, because a punch-out on the spine is as real
       an edit as an inset on the overlay. */
    ...makeTransform(c),
    /* Which parts of the clip are used — the key and the mask. Flat and always
       written, for the same round-trip reason as the transform, and defaulting
       to "all of it", which is what every clip written before this did. Present
       on both tracks: blurring a face is as much a spine edit as a keyed
       foreground is an overlay one. See doc/matte.js. */
    ...makeMatte(c),
  };
}

export function normalizeClips(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_CLIPS).map(makeClip);
}

/** What the sequence actually gets from this clip. */
/** How fast this clip plays. Always positive — direction is `reverse`. */
export const clipSpeed = (c) => {
  const n = Number(c?.speed);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(n * 100) / 100));
};

/**
 * How much of the SEQUENCE this clip occupies.
 *
 * `out - in` is how much of the SOURCE it plays; dividing by the speed is what
 * makes those two different numbers for the first time. A four-second window at
 * 2× is two seconds of lane, and every consequence of that — where the next clip
 * starts, how long the sequence is, how wide the block is drawn, how long its
 * bed has to be — falls out of this one function, which is why speed could be
 * added without touching the schedule, the compositor's timing or the mixer.
 *
 * Still floored at MIN_CLIP: a schedule cannot contain a zero-length clip, and
 * `T % total` in the preview loop cannot divide by one.
 */
export const clipLength = (c) => Math.max(MIN_CLIP, ((c?.out ?? 0) - (c?.in ?? 0)) / clipSpeed(c));

/**
 * Where in the SOURCE a clip is, `localT` seconds into itself.
 *
 * The one place the three time bases meet, and the reason it is a function
 * rather than an expression at the call site: the renderer, the keyframe panel
 * and the mixer all have to agree, and before speed existed they agreed by
 * accident because `in + localT` was the whole answer everywhere.
 *
 * Reversed, the clip starts at its OUT point and walks back — so the last frame
 * of the window is the first one you see, which is what reverse means. It is not
 * the same as swapping in and out: that would play a different part of the
 * source forwards.
 */
export function sourceTimeOf(c, localT) {
  const t = Math.max(0, Number(localT) || 0);
  const speed = clipSpeed(c);
  const inn = Number(c?.in) || 0;
  const out = Number(c?.out) || 0;
  return c?.reverse ? out - t * speed : inn + t * speed;
}

/** "2× · reversed" — empty when the clip plays normally. */
export function speedSummary(c) {
  const speed = clipSpeed(c);
  const parts = [];
  if (speed !== 1) parts.push(`${+speed.toFixed(2)}×`);
  if (c?.reverse) parts.push('reversed');
  return parts.join(' · ');
}

/** True when the clip plays less than its whole source. */
export const isTrimmed = (c) => !!c && (c.in > 0.001 || c.out < c.src - 0.001);

/** True for the overlay track — the one that is positioned, not ordered. */
export const isOverlay = (c) => c?.track === 'V2';

/**
 * Start time of every clip, and the sequence length.
 *
 * A crossfade is the only transition that overlaps: the incoming clip starts
 * before the outgoing one ends, which is what makes it a dissolve rather than a
 * fade through something. Cut and dip are back to back — a dip fades down and
 * up across the join without either clip moving.
 *
 * `starts` is indexed by the clip's position in the ARRAY, not by its position
 * on a track. Everything downstream — the per-clip sound beds, the lane, the
 * playhead hit test, the exporter — pairs `clips[i]` with `starts[i]`, and
 * keeping that true is what let a second track arrive without touching any of
 * them.
 *
 * The two tracks schedule by different rules on purpose. V1 accumulates: each
 * clip follows the previous V1 clip, which is what makes it a spine you can
 * trim and reorder without doing arithmetic. V2 does not accumulate at all —
 * each clip sits at the time it says, so an overlay stays where it was put when
 * something earlier in the sequence is trimmed. The duration is whichever runs
 * longer, because an overlay hanging past the end is still something the
 * sequence has to play — over black, and visibly so, rather than being silently
 * cut off.
 */
export function scheduleOf(clips) {
  const starts = [];
  let acc = 0;
  let overlayEnd = 0;
  let prevSpine = -1;
  // Same guard normalizeClips has, for the same reason: this is a public export
  // of a pure module, and "no clips" is a real answer to "schedule this".
  if (!Array.isArray(clips)) return { starts, duration: 0 };
  clips.forEach((c, i) => {
    if (isOverlay(c)) {
      starts[i] = round2(clamp(num(c.at, 0), 0, MAX_START));
      overlayEnd = Math.max(overlayEnd, starts[i] + clipLength(c));
      return;
    }
    /* "The clip before it" means the one before it ON THIS TRACK. Reading
       clips[i-1] would let an overlay that happens to sit between two spine
       clips in the array decide how those two dissolve into each other. */
    if (prevSpine >= 0 && overlaps(c)) {
      const ov = Math.min(c.xdur, clipLength(c), clipLength(clips[prevSpine]));
      acc = Math.max(0, acc - ov);
    }
    starts[i] = round2(acc);
    acc += clipLength(c);
    prevSpine = i;
  });
  return { starts, duration: round2(Math.max(acc, overlayEnd)) };
}

/**
 * Is this clip the first one on its own track?
 *
 * The first spine clip has nothing to transition from, so its transition is
 * about the sequence opening rather than about a cut. Every overlay is "first"
 * in that same sense: it is introduced against whatever V1 is showing, so its
 * transition is a fade up, and there is never a neighbour to dissolve from.
 */
export function isFirstOnTrack(clips, i) {
  if (!clips?.[i]) return true;
  if (isOverlay(clips[i])) return true;
  for (let k = 0; k < i; k++) if (!isOverlay(clips[k])) return false;
  return true;
}
