/* Dead Signal Studio — doc/audiomix.js
 *
 * What a sequence sounds like, described as data.
 *
 * WHY THIS EXISTS
 *
 * The mixdown was assembled inline at the two places that wanted one — the
 * offline exporter and the real-time recorder — and both spelled the mapping
 * out by hand. That was already one copy too many (video/timeline.js has the
 * note about how the second copy loses whatever the first one gains), and
 * preview audio makes it three: the preview needs the SAME mix as the export,
 * or the thing you cut against is not the thing you ship.
 *
 * It also needs something the export never did: a way to ask "is this the same
 * mix as last time?" without building it. A mixdown is a decode plus one
 * offline render per part, which is far too expensive to redo on every commit —
 * and a commit happens on every pointermove of a trim drag. So the description
 * is separated from the rendering: `mixParts` says what the sound IS,
 * `mixSignature` reduces that to a string you can compare, and `hasSound` says
 * whether there is any point building it at all.
 *
 * Pure — no DOM, no store, no audio context — so all three are pinned by the
 * headless suite rather than by something only a browser can run.
 */
import { clipLength, clipSpeed, footageSourceOf } from './timeline.js';
import { audioParts } from './audioclip.js';

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

/**
 * Every source a sequence plays, with when and how loud.
 *
 * Three kinds, and they compose rather than override:
 *
 *   seq    the sequence-wide bed, under the whole thing
 *   video  a picture clip's own bed, laid at the time that clip starts
 *   audio  the A1 lane, which carries its own in-point, loop, gain and pan
 *
 * Clips with no bed are dropped HERE rather than downstream. That is not tidying
 * — it is what makes the signature stable: a sequence whose fourth clip is
 * silent should not rebuild its mixdown because that clip was trimmed, and it
 * would if the silent clip's start time were still in the description.
 */
export function mixParts(sched, seqChoice = '') {
  const clips = Array.isArray(sched?.clips) ? sched.clips : [];
  const starts = Array.isArray(sched?.starts) ? sched.starts : [];
  const video = [];
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const seconds = clipLength(c);
    if (!(seconds > 0)) continue;
    const at = round2(num(starts[i], 0));
    /* A bed is a sound laid UNDER the clip: it starts when the clip starts and
       loops to fill it, and it knows nothing about what the picture is doing. */
    if (c?.bed) video.push({ choice: c.bed, at, seconds, offset: 0, loop: true });
    /* Footage audio is the opposite in every respect, which is why it is a
       second part rather than a different value of the first. It is the sound
       that came with THIS clip's own file, so it has to start where the picture
       starts INSIDE that file — offset by the trim, or the dialogue drifts from
       the mouth by exactly the in-point — and it must not loop, because a
       shot that runs out of sound is a shot that has ended, not one that
       repeats. The two compose: a room tone under your own footage is ordinary.
       Held to two decimals like every other trim, so the signature is stable. */
    const own = footageSourceOf(c);
    if (own && c.srcAudio) {
      /* The sound follows the picture, which means it is pitched by the speed —
         the same thing every editor does by default, and the only reading that
         keeps a voice attached to a mouth. `span` is how much of the FILE this
         clip uses, which the renderer needs on a reversed clip to work out
         where in the reversed source to begin. */
      video.push({ choice: own, at, seconds,
                   offset: Math.max(0, round2(num(c.in, 0))), loop: false,
                   rate: clipSpeed(c), reverse: !!c.reverse,
                   span: round2(Math.max(0, num(c.out, 0) - num(c.in, 0))) });
    }
  }
  return {
    seq: seqChoice || '',
    total: Math.max(0, round2(num(sched?.total, 0))),
    video,
    audio: audioParts(sched?.audio),
  };
}

/**
 * The same mix twice gives the same string, and any change gives a different one.
 *
 * Deliberately built from the fields the MIXER reads rather than from the clips
 * — a clip's label, scene, transition and keyframes have no bearing on what it
 * sounds like, and folding them in would rebuild the mixdown every time an
 * author renamed something.
 */
export function mixSignature(parts) {
  if (!parts) return '';
  return JSON.stringify([
    parts.seq || '',
    round2(num(parts.total, 0)),
    (parts.video || []).map((p) => [p.choice, p.at, p.seconds, p.offset || 0, p.loop ? 1 : 0,
                                    p.rate || 1, p.reverse ? 1 : 0]),
    (parts.audio || []).map((p) => [p.choice, p.at, p.seconds, p.offset, p.loop ? 1 : 0,
                                    p.gain, p.pan, p.fadeIn || 0, p.fadeOut || 0]),
  ]);
}

/**
 * Is there anything to hear?
 *
 * Silence is not a buffer of zeros: the exporter uses this distinction to decide
 * whether the file carries an audio track at all, and the preview uses it to
 * decide whether to spend a decode on a sequence that has no sound in it.
 */
export function hasSound(parts) {
  if (!parts) return false;
  return !!(parts.seq || (parts.video || []).length || (parts.audio || []).length);
}
