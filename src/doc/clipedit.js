/* Dead Signal Studio — doc/clipedit.js
 *
 * What a single clip exposes for editing, and what an edit to one field does to
 * the clip. Pure: no DOM, no store, no renderer.
 *
 * WHY THIS EXISTS
 *
 * Every control in this studio was document-wide. The VIDEO tab's scene, copy
 * and colours are the look of the NEXT clip you add — so a sequence physically
 * could not contain two clips that differ, and the only way to change one you
 * had already added was to delete it and build it again. That is not an editing
 * model; it is a factory setting.
 *
 * A clip already carries everything needed to fix that. `rec` is a snapshot of
 * the tab's controls taken when the clip was added (see core/recipes.js), and
 * video/timeline.js renders each clip from ITS OWN recipe — readVideoCfg(rec) —
 * not from the live tab. The per-clip look was therefore always renderable;
 * there was simply nothing to edit it with.
 *
 * So this module is the description of that surface, kept apart from the panel
 * that draws it for two reasons:
 *
 *   - the interesting part is not the markup, it is which edits are legal and
 *     what each one has to change ALONGSIDE the field being typed in (see
 *     `src` below, which is two writes, not one). That belongs somewhere it can
 *     be tested without a browser;
 *   - the same descriptions drive the inspector and can drive anything else
 *     that edits a clip later — a properties dialog, a script, a keyboard
 *     command — without a second opinion about what a legal clip is.
 *
 * Option lists that depend on what is loaded (scenes, screen templates, sound
 * beds) are NOT resolved here. A field names the registry it draws from and the
 * caller supplies the entries, because a doc/ module that imported the scene
 * registry to fill a dropdown would no longer be pure and would drag the whole
 * renderer into the headless suite with it.
 */
import { CLIP_KINDS, HELD_KINDS, MAX_CLIP, MAX_SPEED, MAX_START, MAX_TRANSITION, MIN_CLIP, MIN_SPEED,
         TRACKS, TRANSITIONS, XDIRS, axisOnly, clipLength, clipSpeed, footageKeyOf, isOverlay,
         speedSummary, takesDirection }
  from './timeline.js';
import { ALPHA_BLEND, BLENDS, BLEND_LABEL, DEFAULT_BLEND } from './layers.js';
import { KEY_MODES, MASK_MODES, MASK_PLACES, MASK_SHAPES, MAX_FEATHER, makeMatte, maskActive,
         maskDropsPixels, maskPlaceOf, maskRectOf, needsAlphaBlend, patchForMaskPlace }
  from './matte.js';
import { FLIPS, MAX_OFFSET, MAX_SCALE, MIN_SCALE, PLACES, makeTransform, patchForPlace, placeOf }
  from './transform.js';
import { MAX_AUDIO_CLIP, MAX_GAIN, MIN_AUDIO_CLIP, audioClipLength } from './audioclip.js';
import { MAX_ANIM, MAX_SIZE, MAX_TITLE_SUB, MAX_TITLE_TEXT, MIN_SIZE, TITLE_PLACES, titleLabel }
  from './title.js';
import { MAX_GFX_ANIM, MAX_WEIGHT, MIN_WEIGHT, SHAPES, graphicLabel } from './graphic.js';
import { addKey, hasKeys, normalizeTracks, removeKey } from './automation.js';

/* The recipe key holding a video recipe's own length. A clip's `src` and this
   have to move together — see patchFor('src'). */
export const REC_DURATION = 'v-dur';
/** readVideoCfg clamps its duration to this range, so `src` alone cannot say. */
export const REC_DURATION_MIN = 1;
export const REC_DURATION_MAX = 60;

const num = (v, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round2 = (n) => Math.round(n * 100) / 100;
const str = (v, max) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);

/* --------------------------------------------------------------- fields -- */

/**
 * The look fields, per clip kind.
 *
 * A deliberately small set: the four or five things that make one clip read
 * differently from the next. The rest of the recipe — sixty-odd controls of
 * grain, scanlines, glitch and typography — stays where it is authored, on the
 * tab, and reaches a clip through "Update from tab". Copying all of it into a
 * second panel would be a second implementation of the VIDEO tab that drifts
 * from the first one, which is the mistake this file exists to avoid.
 */
const LOOK = {
  video: [
    { key: 'v-scene', kind: 'select', label: 'Scene', optionsFrom: 'scenes',
      hint: 'What this clip draws. The rest of its look travels with it.' },
    { key: 'v-text', kind: 'textarea', label: 'Copy', max: 2000,
      hint: 'The words on screen. {{variables}} expand at render time.' },
    { key: 'v-fg', kind: 'color', label: 'Ink' },
    { key: 'v-bg', kind: 'color', label: 'Ground' },
  ],
  still: [
    { key: 'i-tpl', kind: 'select', label: 'Template', optionsFrom: 'templates',
      hint: 'Which screen this still holds.' },
    { key: 'i-title', kind: 'text', label: 'Title', max: 200 },
    { key: 'i-body', kind: 'textarea', label: 'Body', max: 2000 },
    { key: 'i-fg', kind: 'color', label: 'Ink' },
    { key: 'i-bg', kind: 'color', label: 'Ground' },
  ],
  /* A title is edited HERE and nowhere else. A video clip and a still are
     captured from a tab and sent back to it for a big edit; a title has no tab
     to go back to, and does not want one — everything it is fits in this panel,
     and the picture behind it is on the monitor while you type. */
  title: [
    { key: 't-text', kind: 'textarea', label: 'Title', max: MAX_TITLE_TEXT,
      hint: 'The words. One line per line; {{variables}} expand at render time.' },
    { key: 't-sub', kind: 'text', label: 'Subtitle', max: MAX_TITLE_SUB,
      hint: 'A second, smaller line under it. Leave empty for none.' },
    { key: 't-place', kind: 'select', label: 'Place',
      options: TITLE_PLACES.map((p) => ({ v: p.v, t: p.t })),
      hint: 'Nine anchors, inset by the title-safe margin so nothing sits on the frame edge.' },
    { key: 't-dx', kind: 'number', label: 'Nudge X', min: -1, max: 1, step: 0.01,
      hint: 'From wherever Place put it, as a fraction of the frame — so it survives a change of delivery size.' },
    { key: 't-dy', kind: 'number', label: 'Nudge Y', min: -1, max: 1, step: 0.01,
      hint: 'Positive is down, matching the way the canvas counts.' },
    { key: 't-font', kind: 'select', label: 'Face', optionsFrom: 'fonts',
      hint: 'The family the title is set in.' },
    { key: 't-size', kind: 'number', label: 'Size', min: MIN_SIZE, max: MAX_SIZE, step: 0.5, unit: '%',
      hint: 'Per cent of frame HEIGHT, not pixels — a title made at 320×240 is the same title at 1920×1080.' },
    { key: 't-subratio', kind: 'number', label: 'Sub size', min: 0.2, max: 1, step: 0.05, unit: '×',
      hint: 'The subtitle as a fraction of the title, so resizing the title takes it along.' },
    { key: 't-line', kind: 'number', label: 'Leading', min: 0.8, max: 3, step: 0.05, unit: '×',
      hint: 'Line height, in multiples of the type size.' },
    { key: 't-track', kind: 'number', label: 'Tracking', min: -0.2, max: 1, step: 0.01, unit: 'em',
      hint: 'Letter spacing. In em, so it looks the same at any size.' },
    { key: 't-fg', kind: 'color', label: 'Ink' },
    { key: 't-treat', kind: 'select', label: 'Behind',
      options: [
        { v: 'none', t: '— nothing —' }, { v: 'shadow', t: 'Drop shadow' },
        { v: 'outline', t: 'Outline' }, { v: 'bar', t: 'Full-width band' },
        { v: 'box', t: 'Fitted box' },
      ],
      hint: 'White text over footage is legible until the shot cuts to snow. This is what keeps it readable.' },
    { key: 't-bg', kind: 'color', label: 'Behind ink' },
    { key: 't-bga', kind: 'number', label: 'Behind opacity', min: 0, max: 1, step: 0.05 },
    { key: 't-anim', kind: 'select', label: 'In',
      options: [
        { v: 'none', t: '— cut on —' }, { v: 'fade', t: 'Fade' },
        { v: 'rise', t: 'Rise + fade' }, { v: 'type', t: 'Typewriter' },
        { v: 'word', t: 'Word by word' }, { v: 'pop', t: 'Pop' },
      ],
      hint: 'How it arrives. Timed against this clip’s own length, so it stretches with the hold.' },
    { key: 't-in', kind: 'number', label: 'In over', min: 0, max: MAX_ANIM, step: 0.05, unit: 's' },
    { key: 't-animout', kind: 'select', label: 'Out',
      options: [
        { v: 'none', t: '— cut off —' }, { v: 'fade', t: 'Fade' },
        { v: 'sink', t: 'Sink + fade' },
      ] },
    { key: 't-out', kind: 'number', label: 'Out over', min: 0, max: MAX_ANIM, step: 0.05, unit: 's' },
    { key: 't-fx', kind: 'select', label: 'Effect',
      options: [
        { v: 'none', t: '— none —' }, { v: 'wave', t: 'Wave' }, { v: 'neon', t: 'Neon glow' },
        { v: 'chroma', t: 'Chromatic split' }, { v: 'jitter', t: 'Jitter' },
      ],
      hint: 'What it does while it is on screen, as opposed to how it arrives — so a title can fade in AND shimmer.' },
    { key: 't-fxamt', kind: 'number', label: 'Effect amount', min: 0, max: 1, step: 0.05 },
    { key: 't-roll', kind: 'select', label: 'Roll',
      options: [
        { v: 'none', t: '— none —' }, { v: 'up', t: 'Credits, upward' }, { v: 'left', t: 'Ticker, leftward' },
      ],
      hint: 'Travels the whole clip and REPLACES the placement — credits cross the frame, so where they sit stops being a question.' },
  ],
  /* A graphic is edited here too, and for the same reason a title is: there is
     no tab that authors one. The geometry fields are fractions of the frame
     rather than pixels, so a shape placed on the preview is the same shape on
     the delivery — see doc/graphic.js. */
  graphic: [
    { key: 'g-shape', kind: 'select', label: 'Shape',
      options: SHAPES.map((s) => ({ v: s.v, t: s.t })),
      hint: 'What to draw. Outlined shapes can be drawn on progressively; filled ones fade.' },
    { key: 'g-x', kind: 'number', label: 'X', min: -1, max: 2, step: 0.01,
      hint: 'The anchor, as a fraction of the frame. For a line or an arrow this is the tail.' },
    { key: 'g-y', kind: 'number', label: 'Y', min: -1, max: 2, step: 0.01 },
    { key: 'g-w', kind: 'number', label: 'Width', min: -2, max: 2, step: 0.01,
      hint: 'Signed. A negative width points a line back the other way — the head is on the end you aimed at.' },
    { key: 'g-h', kind: 'number', label: 'Height', min: -2, max: 2, step: 0.01 },
    { key: 'g-rot', kind: 'number', label: 'Rotate', min: -180, max: 180, step: 1, unit: '°' },
    { key: 'g-colour', kind: 'color', label: 'Ink' },
    { key: 'g-weight', kind: 'number', label: 'Weight', min: MIN_WEIGHT, max: MAX_WEIGHT, step: 0.1, unit: '%',
      hint: 'Line thickness, as a per cent of the frame’s short side — so it is not a hairline on a 4× export.' },
    { key: 'g-radius', kind: 'number', label: 'Corner', min: 0, max: 0.5, step: 0.01,
      hint: 'Rounded corners, as a fraction of the box’s short side.' },
    { key: 'g-dash', kind: 'number', label: 'Dash', min: 0, max: 20, step: 0.5,
      hint: 'Dash length in multiples of the line weight. 0 is solid.' },
    { key: 'g-fill', kind: 'color', label: 'Fill' },
    { key: 'g-filla', kind: 'number', label: 'Fill opacity', min: 0, max: 1, step: 0.05,
      hint: 'A fill behind the outline — what turns a box into a highlight panel. 0 leaves it an outline.' },
    { key: 'g-opacity', kind: 'number', label: 'Opacity', min: 0, max: 1, step: 0.05 },
    { key: 'g-anim', kind: 'select', label: 'In',
      options: [
        { v: 'none', t: '— cut on —' }, { v: 'fade', t: 'Fade' }, { v: 'pop', t: 'Pop' },
        { v: 'draw', t: 'Draw on' }, { v: 'slam', t: 'Slam open' },
      ],
      hint: 'Draw-on walks the pen along the outline. Slam is the redaction gesture: full width, snapping open.' },
    { key: 'g-in', kind: 'number', label: 'In over', min: 0, max: MAX_GFX_ANIM, step: 0.05, unit: 's' },
    { key: 'g-animout', kind: 'select', label: 'Out',
      options: [
        { v: 'none', t: '— cut off —' }, { v: 'fade', t: 'Fade' }, { v: 'shrink', t: 'Shrink away' },
      ] },
    { key: 'g-out', kind: 'number', label: 'Out over', min: 0, max: MAX_GFX_ANIM, step: 0.05, unit: 's' },
  ],
};

/** Reader-facing names for the four transition directions. */
const DIR_LABEL = { l: 'The left', r: 'The right', u: 'The top', d: 'The bottom' };

/** Reader-facing names for the mirror modes, derived from the one FLIPS list. */
const FLIP_LABEL = { none: '— none —', h: 'Horizontal', v: 'Vertical', hv: 'Both' };

/* Which tab a clip of this kind was captured from, and gets sent back to.
   A TITLE IS ABSENT ON PURPOSE, and callers must treat a missing entry as "no
   tab" rather than defaulting to video: a title is authored entirely in the
   inspector, and sending one to the VIDEO tab would overwrite it with a scene
   recipe on the next "Update from tab". */
export const SOURCE_VIEW = { video: 'view-video', still: 'view-image' };
export const SOURCE_TAB = { video: 'video', still: 'image' };

/** Every look key this module will write, for the guard in patchFor. */
const LOOK_KEYS = new Set(Object.values(LOOK).flat().map((f) => f.key));

export const isLookKey = (key) => LOOK_KEYS.has(key);

/* The matte's stored fields, derived from the normaliser rather than listed
   again — a second list is a second thing to update, and the one that gets
   forgotten is the one that silently stops being editable. `maskPlace` is NOT
   here: it is derived, like `place`, and has its own branch. */
const MATTE_KEYS = new Set(Object.keys(makeMatte({})));
export const isMatteKey = (key) => MATTE_KEYS.has(key);

/**
 * The editable surface of `clip` at spine position `index`.
 *
 * `index` is a SPINE POSITION, not a raw array index: 0 means "first on the
 * spine". That distinction matters because the first spine clip has nothing to
 * transition FROM — its transition is about how the SEQUENCE opens, and the
 * schedule ignores it entirely (scheduleOf only overlaps against a previous V1
 * clip). Offering the control there would be offering a setting with no effect,
 * so it is returned disabled with the reason rather than silently dropped — a
 * control that vanishes depending on where a clip sits is harder to trust than
 * one that explains itself.
 *
 * The caller must therefore pass the spine-order fact (via isFirstOnTrack), NOT
 * the raw array index: an overlay sitting at array slot 0 pushes the real first
 * spine clip to a non-zero array index, and passing that index would enable a
 * dead transition control on the clip that actually opens the sequence.
 *
 * An overlay is exempt: it is composited over whatever V1 is showing, so it
 * always has something to fade up from, wherever it sits in the array.
 */
export function fieldsFor(clip, index = 0) {
  if (!clip) return [];
  const kind = CLIP_KINDS.includes(clip.kind) ? clip.kind : 'video';
  /* A held kind has no time inside it — its Hold IS its length — so speed and
     reverse would be a second, confusing way to spell a control three rows up. */
  const held = HELD_KINDS.includes(kind);
  const over = isOverlay(clip);
  /* An overlay is never "first" in the sense that matters here: it fades up
     against whatever the spine is showing, so it always has something to come
     in from, wherever it sits in the array. */
  const first = !over && index <= 0;
  const cut = clip.transition === 'cut';
  /* Read once. Half the matte controls are disabled by the state of the other
     half — a spill slider on a brightness key is a control with nothing behind
     it — and asking the clip fifteen separate times would be fifteen chances
     for two of the answers to disagree. */
  const m = makeMatte(clip);
  const keyed = m.keyMode !== 'off';
  const masked = m.maskShape !== 'none';
  return [
    { key: 'label', kind: 'text', label: 'Name', group: 'clip', max: 120,
      hint: 'What this clip is called in the sequence and the status bar.' },
    { key: 'track', kind: 'select', label: 'Track', group: 'clip',
      options: [{ v: 'V1', t: 'V1 — spine' }, { v: 'V2', t: 'V2 — overlay' }],
      hint: 'V1 clips play in order. A V2 clip sits over them at a time you choose.' },

    ...(over ? [{ key: 'at', kind: 'number', label: 'Start', group: 'timing',
      min: 0, max: MAX_START, step: 0.1, unit: 's',
      hint: 'When this overlay begins, on the sequence clock.' }] : []),

    { key: 'src', kind: 'number', label: held ? 'Hold' : 'Source', group: 'timing',
      min: MIN_CLIP, max: MAX_CLIP, step: 0.1, unit: 's',
      hint: kind === 'still'
        ? 'How long the screen is held before trimming.'
        : kind === 'title'
          ? 'How long the title is held. Its in and out animations are timed against this, so they stretch with it.'
          : 'How long the clip’s own recipe runs. Trimming picks a part of it.' },
    { key: 'in', kind: 'number', label: 'In', group: 'timing',
      min: 0, max: clip.src, step: 0.05, unit: 's',
      hint: 'Where this clip starts playing from.' },
    { key: 'out', kind: 'number', label: 'Out', group: 'timing',
      min: 0, max: clip.src, step: 0.05, unit: 's',
      hint: 'Where it stops. Out minus In is what the sequence gets.' },

    /* Not offered on a still: a still has no time inside it — its Hold IS its
       length — so speed would be a second, confusing way to spell a control
       that is already three rows up. */
    ...(held ? [] : [
      { key: 'speed', kind: 'number', label: 'Speed', group: 'timing',
        min: MIN_SPEED, max: MAX_SPEED, step: 0.05, unit: '×',
        hint: 'How fast it plays. The clip gets shorter on the lane as it gets faster — the source it plays is unchanged.' },
      { key: 'reverse', kind: 'check', label: 'Reverse', group: 'timing',
        hint: footageKeyOf(clip)
          ? 'Plays the window backwards. Its SOUND reverses; the picture cannot — no browser will run a video element backwards.'
          : 'Plays the window backwards, starting from the out point.' },
    ]),

    { key: 'transition', kind: 'select', label: over ? 'Fade' : 'In on', group: 'transition',
      options: TRANSITIONS.map((t) => ({ v: t, t })),
      disabled: first,
      hint: first
        ? 'The first clip has nothing to transition from — it always cuts in.'
        : over
          ? 'How the overlay arrives and leaves. It fades out as well as in — footage keeps running underneath it.'
          : 'How this clip enters. A crossfade overlaps the clip before it.' },
    { key: 'xdur', kind: 'number', label: 'Over', group: 'transition',
      min: 0, max: MAX_TRANSITION, step: 0.1, unit: 's',
      disabled: first || cut,
      hint: cut ? 'A cut is instant — nothing to time.' : 'How long that transition takes.' },
    /* Disabled with a reason rather than hidden, for the same reason `xdur` is
       on a cut: a control that vanishes when you change a dropdown above it is
       harder to trust than one that says why it is off. */
    { key: 'xdir', kind: 'select', label: 'From', group: 'transition',
      options: XDIRS.map((v) => ({ v, t: DIR_LABEL[v] })),
      disabled: first || !takesDirection(clip.transition),
      hint: axisOnly(clip.transition)
        ? 'A barn door opens from the centre, so only the AXIS matters here — left and right are the same gesture.'
        : takesDirection(clip.transition)
          ? 'Which edge the incoming picture comes from.'
          : `A ${clip.transition} has no direction — it opens from the centre or in place.` },

    /* Only V2 composites: there is nothing underneath the spine to blend
       against, and offering the controls there would be offering two settings
       with no effect. */
    ...(over ? [
      { key: 'blend', kind: 'select', label: 'Blend', group: 'overlay',
        options: BLENDS.map((b) => ({ v: b, t: BLEND_LABEL[b] || b })),
        hint: 'Screen keys the black out, which is what a bright mark on a near-black scene wants. Anything carrying its own alpha — a title, a shape, a keyed shot — wants normal instead, or the blend will drop the dark parts you kept.' },
      { key: 'opacity', kind: 'number', label: 'Opacity', group: 'overlay',
        min: 0, max: 1, step: 0.05,
        hint: 'On top of the blend and the clip’s own fade.' },
    ] : []),

    /* On BOTH tracks. A punch-out on the spine — the shot shrunk with black
       around it — is as real an edit as an inset on the overlay, and gating it
       to V2 would be inventing a rule the compositor does not have. */
    { key: 'place', kind: 'select', label: 'Place', group: 'transform',
      options: [{ v: 'custom', t: '— custom —' }, ...PLACES.map((p) => ({ v: p.v, t: p.t }))],
      hint: over
        ? 'A layout, in one click. Corners are half size with their edges flush — the usual picture-in-picture.'
        : 'A layout, in one click. On the spine anything smaller than full frame leaves black around it.' },
    { key: 'scale', kind: 'number', label: 'Scale', group: 'transform',
      min: MIN_SCALE, max: MAX_SCALE, step: 0.05,
      hint: '1 fills the frame. Scaling happens about the clip’s own centre.' },
    { key: 'x', kind: 'number', label: 'X', group: 'transform',
      min: -MAX_OFFSET, max: MAX_OFFSET, step: 0.01,
      hint: 'Offset from centre, as a fraction of the frame — so a layout survives a change of delivery size.' },
    { key: 'y', kind: 'number', label: 'Y', group: 'transform',
      min: -MAX_OFFSET, max: MAX_OFFSET, step: 0.01,
      hint: 'Positive is down, matching the way the canvas counts.' },
    { key: 'rot', kind: 'number', label: 'Rotate', group: 'transform',
      min: -180, max: 180, step: 1, unit: '°',
      hint: 'Clockwise, about the clip’s centre.' },
    { key: 'flip', kind: 'select', label: 'Mirror', group: 'transform',
      options: FLIPS.map((f) => ({ v: f, t: FLIP_LABEL[f] || f })),
      hint: 'Applied to the picture, not to the angle — a mirrored tilt stays tilted the same way.' },

    /* On BOTH tracks, like the transform and for the same reason: blurring a
       face is as much a spine edit as a keyed foreground is an overlay one. The
       one thing that IS track-dependent — that a key needs an alpha blend, and
       only V2 has a blend — is said in matteNotes rather than by hiding a
       control that works perfectly well where it is. */
    { key: 'keyMode', kind: 'select', label: 'Key', group: 'matte',
      options: KEY_MODES.map((k) => ({ v: k.v, t: k.t })),
      hint: KEY_MODES.find((k) => k.v === m.keyMode)?.hint },
    { key: 'keyColour', kind: 'color', label: 'Key colour', group: 'matte',
      disabled: m.keyMode !== 'chroma',
      hint: m.keyMode === 'chroma'
        ? 'The colour to drop. Starts on broadcast chroma green rather than pure #00ff00, because that is what a real green screen is.'
        : 'Only a colour key has a colour.' },
    { key: 'keyTol', kind: 'number', label: 'Tolerance', group: 'matte',
      min: 0, max: 1, step: 0.01, disabled: !keyed,
      hint: m.keyMode === 'luma'
        ? 'Everything darker than this goes. Raise it until the ground is gone and stop.'
        : 'How far from the key colour still counts as background. Raise it until the screen goes, then stop — past that it starts eating the subject.' },
    { key: 'keySoft', kind: 'number', label: 'Softness', group: 'matte',
      min: 0, max: 1, step: 0.01, disabled: !keyed,
      hint: 'The band at the edge of the key, where a pixel is partly background. Zero is a hard cut-off, which on real footage means a jagged edge.' },
    { key: 'keySpill', kind: 'number', label: 'Spill', group: 'matte',
      min: 0, max: 1, step: 0.05, disabled: m.keyMode !== 'chroma',
      hint: m.keyMode === 'chroma'
        ? 'Takes the key’s colour back out of what survived. A lit green screen bounces onto every edge, and the green rim is what makes a key read as a cut-out.'
        : 'Only a colour key leaves a fringe to remove.' },

    { key: 'maskShape', kind: 'select', label: 'Mask', group: 'matte',
      options: MASK_SHAPES.map((s) => ({ v: s.v, t: s.t })),
      hint: 'A shape to confine the clip, or an effect on it, to.' },
    { key: 'maskMode', kind: 'select', label: 'Mask does', group: 'matte',
      options: MASK_MODES.map((s) => ({ v: s.v, t: s.t })), disabled: !masked,
      hint: masked
        ? MASK_MODES.find((s) => s.v === m.maskMode)?.hint
        : 'Pick a shape first.' },
    { key: 'maskPlace', kind: 'select', label: 'Mask place', group: 'matte',
      options: [{ v: 'custom', t: '— custom —' }, ...MASK_PLACES.map((p) => ({ v: p.v, t: p.t }))],
      disabled: !masked,
      hint: 'A layout in one click. Two clips masked to opposite halves is a split screen.' },
    { key: 'maskX', kind: 'number', label: 'Mask X', group: 'matte',
      min: -1, max: 2, step: 0.01, disabled: !masked,
      hint: 'The shape’s corner, as a fraction of the CLIP’s own picture — so it survives a change of delivery size, and travels with the clip when you move or scale it.' },
    { key: 'maskY', kind: 'number', label: 'Mask Y', group: 'matte',
      min: -1, max: 2, step: 0.01, disabled: !masked },
    { key: 'maskW', kind: 'number', label: 'Mask W', group: 'matte',
      min: -2, max: 2, step: 0.01, disabled: !masked },
    { key: 'maskH', kind: 'number', label: 'Mask H', group: 'matte',
      min: -2, max: 2, step: 0.01, disabled: !masked },
    { key: 'maskRot', kind: 'number', label: 'Mask rotate', group: 'matte',
      min: -180, max: 180, step: 1, unit: '°', disabled: !masked,
      hint: 'About the shape’s own centre, which is the only reading that keeps it over the thing it was covering.' },
    { key: 'maskFeather', kind: 'number', label: 'Feather', group: 'matte',
      min: 0, max: MAX_FEATHER, step: 0.01, disabled: !masked,
      hint: 'How soft the edge is, as a fraction of the clip picture’s short side. A hard-edged spotlight looks like a hole cut in the picture.' },
    { key: 'maskAmount', kind: 'number', label: 'Amount', group: 'matte',
      min: 0, max: 1, step: 0.05,
      disabled: !masked || maskDropsPixels(m.maskMode),
      hint: maskDropsPixels(m.maskMode)
        ? 'Showing only the shape is all or nothing — there is no amount of it.'
        : 'How strong: the blur radius, how coarse the mosaic is, how far down the darkening goes.' },
    { key: 'maskInvert', kind: 'check', label: 'Invert mask', group: 'matte',
      disabled: !masked,
      hint: 'Selects everything EXCEPT the shape. Darken + invert is a spotlight.' },

    ...LOOK[kind].map((f) => ({ ...f, group: 'look' })),

    /* Offered only to a clip that HAS footage: on anything else it is a switch
       for a sound that does not exist, and a control with nothing behind it is
       worse than a missing one. */
    ...(footageKeyOf(clip) ? [{ key: 'srcAudio', kind: 'check', label: 'Its own sound', group: 'sound',
      hint: 'Play the audio that came with this footage, in sync with the trim. Your beds lay over it.' }] : []),
    { key: 'bed', kind: 'select', label: 'Sound', group: 'sound', optionsFrom: 'beds',
      hint: 'Laid over the sequence’s own bed, at this clip’s start time.' },
  ];
}

/** The value a field currently holds, ready to put in a control. */
export function valueFor(clip, key) {
  if (!clip) return '';
  /* Through the normaliser, never off the clip: a clip from an older project
     carries none of these fields, and a panel showing empty boxes for a matte
     that is genuinely "off" would be a panel that cannot be used until every
     box is filled in by hand. */
  if (isMatteKey(key)) return makeMatte(clip)[key];
  if (key === 'maskPlace') return maskPlaceOf(clip);
  if (isLookKey(key)) {
    const rec = clip.rec && typeof clip.rec === 'object' ? clip.rec : {};
    return rec[key] == null ? '' : rec[key];
  }
  switch (key) {
    case 'label': return clip.label ?? '';
    case 'transition': return clip.transition ?? 'cut';
    case 'bed': return clip.bed ?? '';
    case 'src': return round2(num(clip.src, 0));
    case 'in': return round2(num(clip.in, 0));
    case 'out': return round2(num(clip.out, num(clip.src, 0)));
    case 'xdur': return round2(num(clip.xdur, 0));
    case 'track': return clip.track ?? 'V1';
    case 'at': return round2(num(clip.at, 0));
    case 'xdir': return clip.xdir ?? 'l';
    case 'blend': return clip.blend ?? DEFAULT_BLEND;
    case 'opacity': return round2(num(clip.opacity, 1));
    case 'x': case 'y': case 'scale': case 'rot': case 'flip':
      return makeTransform(clip)[key];
    /* Derived, not stored: 'custom' is what the clip is on when it matches no
       preset, and storing that would be storing the absence of a fact. */
    case 'place': return placeOf(clip);
    case 'srcAudio': return !!clip.srcAudio;
    case 'speed': return clipSpeed(clip);
    case 'reverse': return !!clip.reverse;
    default: return '';
  }
}

/* ------------------------------------------------------------- patching -- */

/**
 * The patch one field edit makes to one clip, or null when it changes nothing.
 *
 * Returning null rather than an equal-valued patch is what keeps a re-render, a
 * blur or a keystroke that reverted itself from landing in the undo stack. The
 * caller can hand the result straight to editClip() and trust that a patch
 * means a real change.
 *
 * Two of these are more than a field write:
 *
 * `src` is TWO writes for a video clip. The clip's `src` is how long the source
 * runs; the renderer gets the source's length from the recipe instead
 * (readVideoCfg clamps t to cfg.duration), so lengthening one without the other
 * gives a clip whose last seconds are a frozen frame — the picture ran out
 * before the clip did. It also re-clamps the trim, because a source cannot end
 * before its own out point.
 *
 * `transition` clears a stale overlap: switching to a cut leaves xdur behind,
 * and switching back to a crossfade should not silently restore a duration the
 * author set for something else. A cut keeps its number (harmless, and it means
 * flipping to a dissolve and back is not destructive), but a clip with no
 * transition duration at all gets the default rather than zero, which would be
 * a crossfade you cannot see.
 */
export function patchFor(clip, key, raw) {
  if (!clip) return null;
  const same = (patch) => {
    for (const k in patch) {
      if (k === 'rec') continue;
      if (patch[k] !== clip[k]) return false;
    }
    if (patch.rec) {
      const cur = clip.rec && typeof clip.rec === 'object' ? clip.rec : {};
      for (const k in patch.rec) {
        /* The curves are an OBJECT, so `!==` is true for every rebuilt copy of
           an identical set of keys — including one the author added and removed
           again. Without a structural compare, every keyframe edit mints an
           undo entry whether or not it changed anything. */
        if (k === '__auto') { if (!sameTracks(patch.rec[k], cur[k])) return false; continue; }
        if (patch.rec[k] !== cur[k]) return false;
      }
    }
    return true;
  };
  const done = (patch) => (patch && !same(patch) ? patch : null);

  /* One branch for fifteen fields, each normalised by the same function the
     renderer reads them back through — so the panel and the compositor cannot
     disagree about what a legal key or mask is. The same shape the transform's
     branch has, and for the same reason. */
  if (isMatteKey(key)) {
    const cur = makeMatte(clip);
    const next = makeMatte({ ...cur, [key]: raw });
    return done({ [key]: next[key] });
  }
  /* A preset writes the four geometry fields and straightens the shape, and
     touches nothing else: "put it on the left" says nothing about whether the
     mask was blurring or revealing, or how soft its edge was. */
  if (key === 'maskPlace') return done(patchForMaskPlace(raw));

  if (isLookKey(key)) {
    const rec = clip.rec && typeof clip.rec === 'object' ? clip.rec : {};
    const field = Object.values(LOOK).flat().find((f) => f.key === key);
    // `field.max` is a CHARACTER cap only for text fields; for a number field it
    // is the numeric bound, and using it to slice the string corrupted almost
    // every fractional value ("0.5"→"0", "0.75"→"0.", g-radius max 0.5 → ""). Cap
    // the length only for text/textarea; other kinds keep their full string and
    // are coerced (and clamped) by makeTitle/makeGraphic on read.
    const isText = field?.kind === 'text' || field?.kind === 'textarea';
    const v = str(raw, isText ? (field.max ?? 400) : 400);
    const next = { ...rec, [key]: v };
    /* On a title, the words ARE the clip, so a lane block still reading the old
       ones is simply wrong — you renamed the thing by typing in it. But `label`
       is also an editable field, and silently overwriting a name the author
       chose would be worse than a stale one.
       So: follow the text only while the name is still the one this function
       generated for the PREVIOUS text. The moment the author types their own
       name, it stops moving and stays theirs. */
    if (clip.kind === 'title' && (key === 't-text' || key === 't-sub')
        && clip.label === titleLabel(rec)) {
      return done({ rec: next, label: titleLabel(next) });
    }
    // Same rule for a graphic: its shape is what the block says it is.
    if (clip.kind === 'graphic' && key === 'g-shape' && clip.label === graphicLabel(rec)) {
      return done({ rec: next, label: graphicLabel(next) });
    }
    return done({ rec: next });
  }

  switch (key) {
    case 'label': {
      const v = str(raw, 120);
      // A clip with no name at all is unreadable in the lane, the table and the
      // status bar, all of which print it. Falling back is kinder than refusing
      // the edit and leaving the field looking accepted.
      return done({ label: v.trim() ? v : 'Clip' });
    }

    case 'xdir':
      return done({ xdir: XDIRS.includes(raw) ? raw : 'l' });

    case 'transition': {
      const v = TRANSITIONS.includes(raw) ? raw : 'cut';
      const patch = { transition: v };
      if (v !== 'cut' && !(num(clip.xdur, 0) > 0)) patch.xdur = 0.6;
      return done(patch);
    }

    case 'xdur':
      return done({ xdur: round2(clamp(num(raw, clip.xdur), 0, MAX_TRANSITION)) });

    case 'in': {
      const out = num(clip.out, num(clip.src, MIN_CLIP));
      return done({ in: round2(clamp(num(raw, clip.in), 0, Math.max(0, out - MIN_CLIP))) });
    }

    case 'out': {
      const inn = num(clip.in, 0);
      const src = num(clip.src, MIN_CLIP);
      return done({ out: round2(clamp(num(raw, clip.out), inn + MIN_CLIP, src)) });
    }

    case 'src': {
      const src = round2(clamp(num(raw, clip.src), MIN_CLIP, MAX_CLIP));
      const patch = { src };
      // The trim cannot outlive the source it points into.
      const inn = clamp(num(clip.in, 0), 0, Math.max(0, src - MIN_CLIP));
      const out = clamp(num(clip.out, src), inn + MIN_CLIP, src);
      if (inn !== clip.in) patch.in = round2(inn);
      if (out !== clip.out) patch.out = round2(out);
      if (clip.kind !== 'still') {
        const rec = clip.rec && typeof clip.rec === 'object' ? clip.rec : {};
        const recDur = clamp(src, REC_DURATION_MIN, REC_DURATION_MAX);
        // Written as a string: `rec` is a snapshot of control values, and every
        // other key in it came off an <input>.
        patch.rec = { ...rec, [REC_DURATION]: String(recDur) };
      }
      return done(patch);
    }

    case 'bed':
      return done({ bed: str(raw, 200) });

    /* Refused outright on a clip with no footage rather than stored and
       ignored: a true sitting on a terminal scene would travel through the
       project file and quietly become real the day that clip was pointed at a
       video. */
    case 'srcAudio':
      return footageKeyOf(clip) ? done({ srcAudio: !!raw }) : null;

    /* Refused on a still for the same reason it is not offered there — and
       refused rather than ignored, so a value cannot sit in the document
       waiting to take effect if that clip ever became a video. */
    case 'speed':
      return clip.kind === 'still' ? null : done({ speed: clipSpeed({ speed: num(raw, clip.speed) }) });
    case 'reverse':
      return clip.kind === 'still' ? null : done({ reverse: !!raw });

    case 'at':
      return done({ at: round2(clamp(num(raw, clip.at), 0, MAX_START)) });

    case 'blend':
      return done({ blend: BLENDS.includes(raw) ? raw : DEFAULT_BLEND });

    case 'opacity':
      return done({ opacity: round2(clamp(num(raw, clip.opacity), 0, 1)) });

    /* Each one goes through makeTransform rather than being clamped inline, so
       the panel and the renderer cannot disagree about what a legal position
       is — there is one normaliser and both sides call it. */
    case 'x': case 'y': case 'scale': case 'rot': case 'flip': {
      const cur = makeTransform(clip);
      const next = makeTransform({ ...cur, [key]: raw });
      return done({ [key]: next[key] });
    }

    /* A preset writes three fields at once and leaves rotation and mirroring
       alone: "put it bottom right" is a statement about where the clip is, not
       about how it is turned, and silently straightening a tilted inset would
       throw away work the author can see on screen. */
    case 'place':
      return done(patchForPlace(raw));

    /* Moving a clip between tracks is the one edit that needs to know where the
       clip currently IS. On the spine a clip's start is derived from the clips
       before it; on the overlay track it is stored. So promoting one without
       `context.start` would drop it at zero — the clip would appear to jump to
       the top of the sequence, which reads as data loss even though nothing was
       lost. patchForTrack is where that is handled; this only guards the field.
       A demotion is symmetric: `at` becomes meaningless and is zeroed, because a
       stale start left lying in the document would come back the next time the
       clip was promoted. */
    case 'track': {
      const track = TRACKS.includes(raw) ? raw : 'V1';
      return patchForTrack(clip, track, num(clip.at, 0));
    }

    default:
      return null;
  }
}

/**
 * Move a clip to `track`, keeping it where it is on the sequence clock.
 *
 * `currentStart` is the clip's start time as the schedule sees it right now —
 * the caller has it (it just drew the lane with it), and this module cannot
 * derive it from one clip.
 */
export function patchForTrack(clip, track, currentStart) {
  if (!clip) return null;
  const next = TRACKS.includes(track) ? track : 'V1';
  const cur = clip.track ?? 'V1';
  if (next === cur) return null;
  if (next === 'V2') {
    return { track: 'V2', at: round2(clamp(num(currentStart, 0), 0, MAX_START)) };
  }
  return { track: 'V1', at: 0 };
}

/**
 * Re-take this clip's look from a freshly captured recipe.
 *
 * The other half of the round trip: a clip's look is sent to the tab it came
 * from, edited there with the full set of controls, and taken back. What comes
 * back is the whole recipe, so the clip's source length has to follow it — the
 * author may well have gone to the tab precisely to make the shot longer, and a
 * clip left at its old `src` would either clip the new recipe short or run past
 * its end into a frozen frame.
 *
 * The trim is preserved where it still fits and clamped where it does not, in
 * that order: an author who trimmed a clip to its middle second means that
 * trim, and silently resetting it to the whole source on every re-capture would
 * make the round trip destructive.
 *
 * A still has no time in its recipe — its `src` IS the hold — so its length is
 * left exactly as the author set it.
 */
export function patchFromRecipe(clip, rec, opts = {}) {
  if (!clip || !rec || typeof rec !== 'object') return null;
  /* The incoming recipe's curves are the VIDEO TAB's curves, and the tab
     describes a different clip. Taking them wholesale would make "Update from
     VIDEO" a silent delete of whatever the author keyframed on THIS clip — so
     the clip's own curves are carried forward by default, and taking the tab's
     is an explicit choice with its own control. */
  const { curves = 'keep' } = opts;
  const mine = clip.rec && typeof clip.rec === 'object' ? clip.rec[CLIP_TRACKS_KEY] : null;
  const patch = { rec: curves === 'keep' && mine ? { ...rec, [CLIP_TRACKS_KEY]: mine } : rec };
  if (clip.kind === 'still') return patch;
  const recDur = rec[REC_DURATION] == null
    ? num(clip.src, MIN_CLIP)
    : clamp(num(rec[REC_DURATION], clip.src), REC_DURATION_MIN, REC_DURATION_MAX);
  const src = round2(clamp(recDur, MIN_CLIP, MAX_CLIP));
  patch.src = src;
  patch.in = round2(clamp(num(clip.in, 0), 0, Math.max(0, src - MIN_CLIP)));
  patch.out = round2(clamp(num(clip.out, src), patch.in + MIN_CLIP, src));
  return patch;
}

/* --------------------------------------------------------------- labels -- */

/** "2.40s of 6.00s" — what the sequence gets, and what it was cut from. */
export function trimSummary(clip) {
  if (!clip) return '';
  const len = clipLength(clip);
  const src = num(clip.src, len);
  const window = Math.max(0, num(clip.out, src) - num(clip.in, 0));
  /* Compared against the WINDOW, not the lane length: at 2× a whole four-second
     source occupies two seconds, and reading "2.00s of 4.00s" would say it had
     been trimmed when nothing was cut. */
  const base = window < src - 0.005 ? `${len.toFixed(2)}s of ${src.toFixed(2)}s` : `${len.toFixed(2)}s`;
  const how = speedSummary(clip);
  return how ? `${base} · ${how}` : base;
}

/**
 * Is this clip's recipe long enough to fill it?
 *
 * The one inconsistency a clip can hold that neither the lane nor the table can
 * show: `src` says six seconds, the recipe inside says four, and the last two
 * seconds render as a frozen frame. patchFor keeps the two together for every
 * edit made through this module, but a clip can also arrive from an older
 * project, a hand-edited file or a share link — so the inspector says so rather
 * than letting the author wonder why the picture stopped.
 */
export function recipeShortfall(clip) {
  if (!clip || clip.kind === 'still') return 0;
  const rec = clip.rec && typeof clip.rec === 'object' ? clip.rec : {};
  if (rec[REC_DURATION] == null) return 0;
  const recDur = clamp(num(rec[REC_DURATION], 0), REC_DURATION_MIN, REC_DURATION_MAX);
  const need = num(clip.out, num(clip.src, 0));
  return need > recDur + 0.005 ? round2(need - recDur) : 0;
}

/**
 * What the panel has to say out loud about this clip's matte.
 *
 * Three states the preview cannot explain on its own, all of which look like a
 * broken feature rather than a setting:
 *
 *   - a key on the spine. V1 is filled black before anything is drawn on it, so
 *     the holes a key makes are black holes. That is a legitimate thing to want
 *     — a matte on black — but it is not what someone keying a green screen
 *     means, and the fix is one dropdown away.
 *   - a key or a reveal on an overlay that is still blending by lightness. The
 *     clip is keyed correctly and composited wrongly, and the result is a
 *     ghostly double exposure that looks exactly like a key that did not work.
 *   - a mask with no area. maskActive treats it as absent — a zero-area reveal
 *     would blank the clip — so the control is set and nothing happens.
 *
 * Returned as text rather than acted on. Every one of them is a legal state
 * somebody might mean, and a panel that silently rewrote the author's settings
 * to what it assumed they meant would be worse than one that says what it sees.
 */
export function matteNotes(clip) {
  if (!clip) return [];
  const notes = [];
  const m = makeMatte(clip);
  if (m.maskShape !== 'none' && !maskActive(clip)) {
    const r = maskRectOf(m);
    notes.push(`This mask is ${r.w.toFixed(2)}×${r.h.toFixed(2)} of the frame — it has no area, so nothing is masked. `
      + 'Give it a width and a height, or set the shape back to none.');
  }
  if (!needsAlphaBlend(clip)) return notes;
  if (!isOverlay(clip)) {
    notes.push('This clip is on V1, and the spine is drawn on black — so what the key removes reads as black rather than as the clip underneath. '
      + 'Move it to V2 to composite it over the shot.');
  } else if ((clip.blend ?? DEFAULT_BLEND) !== ALPHA_BLEND) {
    const b = clip.blend ?? DEFAULT_BLEND;
    notes.push(`This clip carries its own alpha now, but it is compositing at “${BLEND_LABEL[b] || b}”, which decides what to keep by brightness rather than by alpha — `
      + 'so the dark parts you kept will drop out anyway. Set Blend to normal.');
  }
  return notes;
}


/* ==================================================== the audio lane === */

/**
 * The editable surface of a sound.
 *
 * A parallel description rather than a branch inside fieldsFor(), because a
 * sound is not a clip with the picture fields switched off: it has no scene, no
 * transition, no blend and no recipe, and it has four things a clip does not.
 * Sharing one function would mean every caller asking "which kind is this"
 * before it could read the answer.
 */
export function audioFieldsFor(clip) {
  if (!clip) return [];
  return [
    { key: 'label', kind: 'text', label: 'Name', group: 'clip', max: 120,
      hint: 'What this sound is called on the lane.' },
    { key: 'source', kind: 'select', label: 'Source', group: 'clip', optionsFrom: 'beds',
      hint: 'Which rendered sound plays. Kept as authored, so a library asset that has not loaded yet is still your choice.' },

    { key: 'at', kind: 'number', label: 'Start', group: 'timing',
      min: 0, max: MAX_START, step: 0.1, unit: 's',
      hint: 'When it plays, on the sequence clock. Sound is placed, never queued.' },
    { key: 'in', kind: 'number', label: 'In', group: 'timing',
      min: 0, max: MAX_AUDIO_CLIP, step: 0.05, unit: 's',
      hint: 'How far into the file playback starts.' },
    { key: 'out', kind: 'number', label: 'Out', group: 'timing',
      min: 0, max: MAX_AUDIO_CLIP, step: 0.05, unit: 's',
      hint: 'Where it stops. Out minus In is how long it occupies the lane.' },
    { key: 'loop', kind: 'check', label: 'Loop', group: 'timing',
      hint: 'What happens when the window runs past the end of the file: repeat it, or let it finish and stop.' },

    /* In the timing group rather than the mix group on purpose: a fade is a
       length, and the thing you compare it against is the clip it lives in. */
    { key: 'fadeIn', kind: 'number', label: 'Fade in', group: 'timing',
      min: 0, max: MAX_AUDIO_CLIP, step: 0.05, unit: 's',
      hint: 'How long it takes to arrive. Zero starts at full level, which clicks on anything with content at its edge.' },
    { key: 'fadeOut', kind: 'number', label: 'Fade out', group: 'timing',
      min: 0, max: MAX_AUDIO_CLIP, step: 0.05, unit: 's',
      hint: 'How long it takes to leave. Two fades that do not fit share the clip — the fade in wins and this takes what is left.' },

    { key: 'gain', kind: 'number', label: 'Gain', group: 'mix',
      min: 0, max: MAX_GAIN, step: 0.05,
      hint: '1 is as rendered. The mix is not limited, so watch the peak meter.' },
    { key: 'pan', kind: 'number', label: 'Pan', group: 'mix',
      min: -1, max: 1, step: 0.05,
      hint: '−1 hard left, 1 hard right. Any pan makes the whole mixdown stereo.' },
    { key: 'mute', kind: 'check', label: 'Mute', group: 'mix',
      hint: 'Silences it without removing it — and without changing how long the sequence is, so the picture does not jump while you audition.' },
  ];
}

export function audioValueFor(clip, key) {
  if (!clip) return '';
  switch (key) {
    case 'label': return clip.label ?? '';
    case 'source': return clip.source ?? '';
    case 'at': return round2(num(clip.at, 0));
    case 'in': return round2(num(clip.in, 0));
    case 'out': return round2(num(clip.out, 0));
    case 'fadeIn': return round2(num(clip.fadeIn, 0));
    case 'fadeOut': return round2(num(clip.fadeOut, 0));
    case 'gain': return round2(num(clip.gain, 1));
    case 'pan': return round2(num(clip.pan, 0));
    case 'loop': return !!clip.loop;
    case 'mute': return !!clip.mute;
    default: return '';
  }
}

/** The patch one field edit makes to one sound, or null when it changes nothing. */
export function audioPatchFor(clip, key, raw) {
  if (!clip) return null;
  const done = (patch) => {
    if (!patch) return null;
    for (const k in patch) if (patch[k] !== clip[k]) return patch;
    return null;
  };
  switch (key) {
    case 'label': {
      const v = str(raw, 120);
      return done({ label: v.trim() ? v : 'Sound' });
    }
    case 'source':
      return done({ source: str(raw, 200) });
    case 'at':
      return done({ at: round2(clamp(num(raw, clip.at), 0, MAX_START)) });
    case 'in': {
      const out = num(clip.out, MIN_AUDIO_CLIP);
      return done({ in: round2(clamp(num(raw, clip.in), 0, Math.max(0, out - MIN_AUDIO_CLIP))) });
    }
    case 'out': {
      const inn = num(clip.in, 0);
      return done({ out: round2(clamp(num(raw, clip.out), inn + MIN_AUDIO_CLIP, inn + MAX_AUDIO_CLIP)) });
    }
    /* Clamped to the clip's own length: a fade longer than the sound it fades
       is not a fade, and letting one be typed then silently shortened at render
       time would put a number on screen that the mix does not use. */
    case 'fadeIn': case 'fadeOut': {
      const len = audioClipLength(clip);
      return done({ [key]: round2(clamp(num(raw, clip[key]), 0, len)) });
    }
    case 'gain':
      return done({ gain: round2(clamp(num(raw, clip.gain), 0, MAX_GAIN)) });
    case 'pan':
      return done({ pan: round2(clamp(num(raw, clip.pan), -1, 1)) });
    case 'loop':
      return done({ loop: !!raw });
    case 'mute':
      return done({ mute: !!raw });
    default:
      return null;
  }
}

/** "2.40s at 4.00s" — what it plays and when. (`audioSummary` is taken by
    ui/gallery.js, and two modules may not claim one export name.) */
export function soundSummary(clip) {
  if (!clip) return '';
  const base = `${audioClipLength(clip).toFixed(2)}s at ${round2(num(clip.at, 0)).toFixed(2)}s`;
  // Mentioned only when there is one, so the readout stays a length and a time
  // in the ordinary case rather than growing a permanent "· 0s / 0s" tail.
  const fi = round2(num(clip.fadeIn, 0));
  const fo = round2(num(clip.fadeOut, 0));
  if (!fi && !fo) return base;
  return `${base} · ${fi ? `↗${fi}s` : ''}${fi && fo ? ' ' : ''}${fo ? `↘${fo}s` : ''}`;
}


/* ================================================ per-clip keyframes === */

/* A clip has carried its own curves since it learned to capture a recipe:
   captureClipRecipe writes rec.__auto, readVideoCfg lifts it onto the cfg, and
   cfgAt reads it on every frame. The render path needs NOTHING for this
   feature. What was missing was any way to edit those curves after the clip
   existed — the automation editor is document-wide and describes the VIDEO tab,
   which is a different clip.

   The time base is fixed by the renderer and must be respected: keys are in
   SOURCE seconds (renderClipTo evaluates at clip.in + localT), so a trimmed
   clip plays the window [in,out] of its own curve. */

export const CLIP_TRACKS_KEY = '__auto';

/** This clip's curves, normalised, never mutating the clip. */
export function clipTracks(clip) {
  const rec = clip?.rec && typeof clip.rec === 'object' ? clip.rec : {};
  return normalizeTracks(rec[CLIP_TRACKS_KEY]);
}

/** A stable string for a set of curves — '' when there are none. */
export function curvesSignature(clip) {
  const t = clipTracks(clip);
  const out = [];
  for (const id of Object.keys(t).sort()) {
    const keys = t[id];
    if (!keys?.length) continue;
    out.push(id + ':' + keys.map((k) => `${k.t}@${k.v}/${k.e}`).join(','));
  }
  return out.join('|');
}

/** Structural equality for two curve maps. */
export function sameTracks(a, b) {
  const A = normalizeTracks(a), B = normalizeTracks(b);
  const ka = Object.keys(A).filter((k) => A[k]?.length).sort();
  const kb = Object.keys(B).filter((k) => B[k]?.length).sort();
  if (ka.join() !== kb.join()) return false;
  for (const id of ka) {
    if (A[id].length !== B[id].length) return false;
    for (let i = 0; i < A[id].length; i++) {
      const x = A[id][i], y = B[id][i];
      if (x.t !== y.t || x.v !== y.v || x.e !== y.e) return false;
    }
  }
  return true;
}

const curvePatch = (clip, next) => {
  const rec = clip?.rec && typeof clip.rec === 'object' ? clip.rec : {};
  if (sameTracks(next, rec[CLIP_TRACKS_KEY])) return null;
  // hasKeys() false means every track is empty; store nothing rather than a map
  // of empty arrays, so an uncurved clip round-trips as one.
  const cleaned = {};
  for (const id of Object.keys(next)) if (next[id]?.length) cleaned[id] = next[id];
  return { rec: { ...rec, [CLIP_TRACKS_KEY]: hasKeys(cleaned) ? cleaned : {} } };
};

/** Add or move a key on this clip's own curve for `paramId`. */
export function patchForKey(clip, paramId, t, v, e) {
  if (!clip || !paramId) return null;
  const cur = clipTracks(clip);
  const next = { ...cur, [paramId]: addKey(cur[paramId], t, v, e) };
  return curvePatch(clip, next);
}

export function patchForKeyRemove(clip, paramId, t) {
  if (!clip || !paramId) return null;
  const cur = clipTracks(clip);
  const next = { ...cur, [paramId]: removeKey(cur[paramId], t) };
  return curvePatch(clip, next);
}

export function patchForClearParam(clip, paramId) {
  if (!clip || !paramId) return null;
  const cur = clipTracks(clip);
  const next = { ...cur };
  delete next[paramId];
  return curvePatch(clip, next);
}

export function patchForClearCurves(clip) {
  if (!clip) return null;
  return curvePatch(clip, {});
}

/**
 * Keys that sit past the end of what this clip plays.
 *
 * Changing a clip's source length rewrites the recipe's duration but never
 * rescales or prunes its keys, and the renderer clamps t to that duration — so
 * those keys are stored, invisible and silent. Said out loud rather than left
 * to be discovered.
 */
export function keysPastEnd(clip) {
  if (!clip) return 0;
  const end = num(clip.out, num(clip.src, 0));
  let n = 0;
  const t = clipTracks(clip);
  for (const id of Object.keys(t)) for (const k of t[id]) if (k.t > end + 0.005) n++;
  return n;
}
