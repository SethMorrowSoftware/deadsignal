/* Dead Signal Studio — doc/audioclip.js
 *
 * The stored shape of a sound on the sequence's audio lane. Pure: no DOM, no
 * store, no Web Audio.
 *
 * WHY THIS IS A SEPARATE ARRAY
 *
 * An audio clip lives in `timeline.audio`, not in `timeline.clips`, and that is
 * a deliberate and load-bearing choice rather than an accident of history.
 *
 * The tempting alternative is to add 'A1' to TRACKS and let sounds ride the
 * clip array. It costs about twenty-eight guard sites — the schedule
 * accumulating a sound into the picture's running length, the renderer drawing
 * it as a terminal scene, the batch exporter filing it in the library as a
 * video, the inspector offering it a scene picker — and every single one of
 * those fails SILENTLY. makeClip coerces an unknown track back to 'V1', so
 * forgetting a guard does not throw: it produces a plausible-looking export
 * with a picture where a sound should be. A separate array costs one more
 * commit path and a selection model that knows which lane it is pointing at,
 * and neither of those can be silently wrong.
 *
 * The two arrays meet in exactly one place — the sequence's length, folded
 * together in buildSchedule() — and nowhere else.
 *
 * WHAT A SOUND IS HERE
 *
 *   source   the authored bed string ('' | 'last' | 'lib:<key>'), kept exactly
 *            as authored and never resolved. A library key whose asset has not
 *            come back yet is still the author's choice and has to survive the
 *            round trip — the same reasoning doc/timeline.js gives for a video
 *            clip's `bed`.
 *   at       where it starts on the sequence clock. Sound is positioned, never
 *            ordered: "after the one before it" is meaningless for a door slam.
 *   in/out   which part of the source plays, source-relative. There is no
 *            source-length field, because a source's true length is not
 *            knowable without decoding it — and a decode is async, while this
 *            module is pure.
 *   loop     what happens when out-in runs past the end of the source. A bed is
 *            a hum you want looped; a clip is usually a one-shot, so this
 *            defaults false. The old bed path had no play-once mode at all.
 *   gain/pan how it sits in the mix.
 *   mute     silences it without deleting it, which is what an author reaches
 *            for when deciding whether a sound is helping.
 *
 * Every field is written unconditionally with a default. A key that appears and
 * disappears depending on the value would break the byte-identical save/load
 * round trip that doc/serialize.js insists on.
 */
import { MAX_START } from './timeline.js';

export const MAX_AUDIO_CLIPS = 32;
/* How a library asset is named in a `source` string.
   Canonical here rather than in audio/bed.js, where it used to live: the pure
   mix description (doc/audiomix.js) has to build one of these strings, and
   importing the bed module for a five-character constant would drag the
   library, the DOM helpers and the audio engine into the headless suite. */
export const LIB_PREFIX = 'lib:';
export const MIN_AUDIO_CLIP = 0.1;
/** Sound can outrun the picture by a long way; ten minutes is the ceiling. */
export const MAX_AUDIO_CLIP = 600;
/** +12 dB. Past this, an author is fixing the wrong problem. */
export const MAX_GAIN = 4;

const num = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round2 = (n) => Math.round(n * 100) / 100;

export function makeAudioClip(c) {
  let inn = Math.max(0, round2(num(c?.in, 0)));
  let out = Math.max(0, round2(num(c?.out, inn + 1)));
  // A backwards or empty window is not an edit, it is a mistake; a legal
  // one-second window from the in point is the honest reading of it. Epsilon
  // for the same reason as makeClip: a legal 0.1s window (e.g. 4.9→5.0) rounds
  // to 0.09999999999999964, which a float-exact test wrongly rewrote to in+1s —
  // silently extending the sound past the point the author trimmed to.
  if (!(out - inn >= MIN_AUDIO_CLIP - 1e-6)) out = inn + 1;
  if (out - inn > MAX_AUDIO_CLIP) out = inn + MAX_AUDIO_CLIP;
  return {
    source: typeof c?.source === 'string' ? c.source.slice(0, 200) : '',
    label: typeof c?.label === 'string' ? c.label.slice(0, 120) : 'Sound',
    at: clamp(round2(num(c?.at, 0)), 0, MAX_START),
    in: inn,
    out,
    gain: clamp(round2(num(c?.gain, 1)), 0, MAX_GAIN),
    pan: clamp(round2(num(c?.pan, 0)), -1, 1),
    /* How long this sound takes to arrive and to leave. Zero by default, which
       is exactly what every sound did before: start at full level, stop dead.
       That is audible as a click on anything with content at its edges, which
       is most things. Clamped to the clip so a fade cannot be longer than the
       sound it is fading. */
    fadeIn: clamp(round2(num(c?.fadeIn, 0)), 0, out - inn),
    /* Against the room the fade-IN leaves, not against the whole clip. fadeShape
       already resolves the overlap this way — the fade-in wins and the fade-out
       is squeezed out — so clamping only there left the document saying one
       thing while the sound did another: a one-second clip could store a full
       second of fade-out, show "1.00" in the inspector, and fade out not at
       all. Clamping here as well means the stored number is the number you
       hear. No existing project changes audibly; only ones that already stored
       an impossible pair are rewritten, and only to what they already sounded
       like. */
    fadeOut: clamp(round2(num(c?.fadeOut, 0)),
      0, Math.max(0, (out - inn) - clamp(round2(num(c?.fadeIn, 0)), 0, out - inn))),
    loop: !!c?.loop,
    mute: !!c?.mute,
  };
}

/**
 * The gain envelope for one sound, as breakpoints in its own seconds.
 *
 * Pure and separate from the renderer because the interesting part is not the
 * Web Audio call, it is what happens when the two fades do not fit: a two-second
 * fade-in and a two-second fade-out on a three-second sound is a thing an author
 * will absolutely ask for. The in-point wins and the out-point takes what is
 * left, because a fade-in that was silently shortened is heard as the sound
 * arriving late, while a shortened fade-out is heard as... a shorter fade-out.
 *
 * Returned as `{ t, v }` in order, so a test can read the shape without an
 * AudioContext and the renderer can schedule it without knowing the rules.
 */
export function fadeShape(seconds, fadeIn = 0, fadeOut = 0, gain = 1) {
  const secs = Math.max(0, num(seconds, 0));
  const g = Math.max(0, num(gain, 1));
  const fi = clamp(Math.max(0, num(fadeIn, 0)), 0, secs);
  const fo = clamp(Math.max(0, num(fadeOut, 0)), 0, Math.max(0, secs - fi));
  const out = [];
  out.push({ t: 0, v: fi > 0 ? 0 : g });
  if (fi > 0) out.push({ t: round2(fi), v: g });
  if (fo > 0) {
    const from = round2(Math.max(fi, secs - fo));
    // Held flat until the fade-out begins, or the ramp would start at the top
    // of the clip and the whole thing would be one long decay.
    if (from > (out[out.length - 1]?.t ?? 0)) out.push({ t: from, v: g });
    out.push({ t: round2(secs), v: 0 });
  }
  return out;
}

export function normalizeAudioClips(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_AUDIO_CLIPS).map(makeAudioClip);
}

/** How long this sound occupies the lane. */
export const audioClipLength = (c) => Math.max(MIN_AUDIO_CLIP, (c?.out ?? 0) - (c?.in ?? 0));

/**
 * Where the last sound finishes, which is how far audio extends the sequence.
 *
 * A muted clip still counts. Mute is a mixing decision an author flips back and
 * forth; letting it change the sequence's LENGTH would make the picture jump
 * every time they auditioned something.
 */
export function audioEnd(list) {
  if (!Array.isArray(list)) return 0;
  let end = 0;
  for (const c of list) {
    if (!c) continue;
    end = Math.max(end, clamp(round2(num(c.at, 0)), 0, MAX_START) + audioClipLength(c));
  }
  return round2(end);
}

/**
 * The mixer's view of the lane.
 *
 * Muted and sourceless clips are dropped here rather than being carried down
 * and skipped later: a part with nothing to play is a decode that will fail and
 * be logged as "nothing to use", which reads like a broken asset rather than
 * like a clip the author deliberately silenced.
 */
export function audioParts(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((c) => c && !c.mute && c.source).map((c) => ({
    choice: c.source,
    at: clamp(round2(num(c.at, 0)), 0, MAX_START),
    seconds: audioClipLength(c),
    offset: Math.max(0, round2(num(c.in, 0))),
    fadeIn: Math.max(0, round2(num(c.fadeIn, 0))),
    fadeOut: Math.max(0, round2(num(c.fadeOut, 0))),
    loop: !!c.loop,
    gain: clamp(round2(num(c.gain, 1)), 0, MAX_GAIN),
    pan: clamp(round2(num(c.pan, 0)), -1, 1),
  }));
}

/** True when any part wants a pan, which forces a stereo mixdown. */
export const needsStereo = (parts) => Array.isArray(parts) && parts.some((p) => p && p.pan);
