/* Dead Signal Studio — doc/title.js
 *
 * What a title says, where it sits, and how it arrives. Pure: no DOM, no
 * canvas, no store.
 *
 * WHY A TITLE IS A CLIP KIND AND NOT A SCREEN TEMPLATE
 *
 * The tool could already put words on screen two ways, and neither of them is
 * a title. A SCENE draws its own background before anything else — that is the
 * house rule every scene keeps, and it is what makes them composite predictably
 * — so a scene can never be text OVER a shot; it can only be text INSTEAD of
 * one. A screen template is a whole rendered document (a BSOD, an autopsy
 * report), opaque by construction and by intent.
 *
 * A title is the third thing: marks on nothing. It needs a buffer that is
 * CLEARED rather than filled, and once it has one, every other part of the
 * compositor already does the right thing — the clip transform positions it,
 * V2's blend and opacity composite it, and every transition treats it like any
 * other picture. That is the whole architectural cost, and it is why this is a
 * clip kind rather than a fourth rendering subsystem.
 *
 * WHY SIZE IS A PERCENTAGE OF FRAME HEIGHT
 *
 * A title authored at 320×240 and delivered at 1920×1080 must be the same
 * title. Stored in pixels it would be a sixth of the size on the delivery, and
 * the author would have no way to know until they watched the export. Every
 * measurement here — type size, line height, the nudge, the padding behind a
 * bar — is a fraction of the frame, so the layout is resolution-independent by
 * construction rather than by remembering to scale things.
 *
 * WHY THERE IS A READABILITY TREATMENT AT ALL
 *
 * White text over footage is legible until the shot cuts to snow, and then it
 * is gone. Every broadcast title has a treatment behind it for exactly this
 * reason, and a title tool that only offers a colour is one that produces
 * unreadable titles half the time. The four here are the four that exist:
 * a drop shadow, an outline, a full-width band, and a fitted box.
 *
 * WHY THE ANIMATION IS DESCRIBED HERE AND DRAWN ELSEWHERE
 *
 * `titleAlpha` / `titleRise` / `titleReveal` are functions of (t, length, cfg)
 * and nothing else. That makes the motion testable without a canvas, and it
 * makes the renderer a description of one instant rather than a state machine
 * — which is what lets the exporter render frames out of order, and lets the
 * scrubber land on any instant and be right.
 */
import { MAX_RAMP, ease, ramps } from './ramp.js';

export const MAX_TITLE_TEXT = 400;
export const MAX_TITLE_SUB = 200;

/* Nine anchor points, the vocabulary every editor uses. `ax`/`ay` are the
   fraction of the frame the anchor sits at; `align` is what the text does
   around it. Corners pull in by SAFE (below) rather than sitting on the frame
   edge — a title flush to the edge is one a television would have cropped, and
   the habit is worth keeping even on a file nobody will broadcast. */
export const TITLE_PLACES = [
  { v: 'tl', t: 'Top left', ax: 0, ay: 0, align: 'left' },
  { v: 'tc', t: 'Top centre', ax: 0.5, ay: 0, align: 'center' },
  { v: 'tr', t: 'Top right', ax: 1, ay: 0, align: 'right' },
  { v: 'ml', t: 'Middle left', ax: 0, ay: 0.5, align: 'left' },
  { v: 'mc', t: 'Centre', ax: 0.5, ay: 0.5, align: 'center' },
  { v: 'mr', t: 'Middle right', ax: 1, ay: 0.5, align: 'right' },
  { v: 'bl', t: 'Bottom left', ax: 0, ay: 1, align: 'left' },
  { v: 'bc', t: 'Lower third', ax: 0.5, ay: 1, align: 'center' },
  { v: 'br', t: 'Bottom right', ax: 1, ay: 1, align: 'right' },
];
export const DEFAULT_PLACE = 'bc';
const PLACE_BY = new Map(TITLE_PLACES.map((p) => [p.v, p]));

/** Title-safe margin, as a fraction of the frame. The broadcast habit: 5%. */
export const SAFE = 0.05;

export const TREATMENTS = ['none', 'shadow', 'outline', 'bar', 'box'];
export const DEFAULT_TREATMENT = 'shadow';

/* In and out are separate lists because they are not the same set. A title can
   TYPE on; nothing types off — it would read as a mistake being corrected. */
export const ANIM_IN = ['none', 'fade', 'rise', 'type', 'word', 'pop'];
export const ANIM_OUT = ['none', 'fade', 'sink'];

/* A CONTINUOUS effect, separate from the entrance and running the whole hold.
   Separate because they answer different questions — "how does it arrive" and
   "what is it doing while it is here" — and folding them into one list would
   mean a title could not both fade in AND shimmer, which is most of the reason
   to want either. */
export const TEXT_FX = ['none', 'wave', 'neon', 'chroma', 'jitter'];
export const DEFAULT_FX = 'none';

/* A roll replaces the vertical placement rather than adding to it: credits
   travel the whole height of the frame, so "where does it sit" stops being a
   question the moment you ask for one. */
export const ROLLS = ['none', 'up', 'left'];
/* Re-exported rather than redeclared: the ramp arithmetic lives in doc/ramp.js
   now that graphics keep the same two promises, and two copies of this number
   would be two things to change. */
export const MAX_ANIM = MAX_RAMP;

/** Type size, as a percentage of frame height. */
export const MIN_SIZE = 2;
export const MAX_SIZE = 40;

const num = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round2 = (n) => Math.round(n * 100) / 100;
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const colour = (v, fallback) =>
  (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fallback);
const pick = (list, v, fallback) => (list.includes(v) ? v : fallback);

/**
 * A title recipe, read out of a clip's `rec` and normalised.
 *
 * Reads the same `t-*` control-id keys the inspector writes, exactly as
 * readVideoCfg reads `v-*` and readImageCfg reads `i-*`. Values arrive as
 * strings — that is what a recipe is, captured control values — and every one
 * of them is coerced here so no caller has to think about it.
 */
export function makeTitle(rec) {
  const r = rec && typeof rec === 'object' && !Array.isArray(rec) ? rec : {};
  const size = clamp(round2(num(r['t-size'], 9)), MIN_SIZE, MAX_SIZE);
  return {
    text: text(r['t-text'], MAX_TITLE_TEXT),
    sub: text(r['t-sub'], MAX_TITLE_SUB),
    font: typeof r['t-font'] === 'string' && r['t-font'] ? r['t-font'] : 'sans',
    /* Percent of frame HEIGHT, not width: a title that kept its proportion to
       the width would grow when the delivery got wider at the same height,
       which is not what "the same size" means to anyone reading it. */
    size,
    /* The subtitle is a ratio of the main size rather than its own percentage,
       so changing the title size takes the subtitle with it — which is what an
       author means by "make it bigger". */
    subRatio: clamp(round2(num(r['t-subratio'], 0.55)), 0.2, 1),
    line: clamp(round2(num(r['t-line'], 1.25)), 0.8, 3),
    track: clamp(round2(num(r['t-track'], 0)), -0.2, 1),
    fg: colour(r['t-fg'], '#ffffff'),
    treatment: pick(TREATMENTS, r['t-treat'], DEFAULT_TREATMENT),
    bg: colour(r['t-bg'], '#000000'),
    bgAlpha: clamp(round2(num(r['t-bga'], 0.6)), 0, 1),
    place: PLACE_BY.has(r['t-place']) ? r['t-place'] : DEFAULT_PLACE,
    /* Nudge, in fractions of the frame, from wherever the place put it. Two
       controls rather than nine more places: the places are the layouts people
       ask for, and the nudge is for everything else. */
    dx: clamp(round2(num(r['t-dx'], 0)), -1, 1),
    dy: clamp(round2(num(r['t-dy'], 0)), -1, 1),
    animIn: pick(ANIM_IN, r['t-anim'], 'fade'),
    animOut: pick(ANIM_OUT, r['t-animout'], 'fade'),
    inSec: clamp(round2(num(r['t-in'], 0.4)), 0, MAX_ANIM),
    outSec: clamp(round2(num(r['t-out'], 0.4)), 0, MAX_ANIM),
    fx: pick(TEXT_FX, r['t-fx'], DEFAULT_FX),
    /* One amount for whichever effect is chosen, rather than an amount each.
       They are mutually exclusive — a title is doing one thing — and five
       sliders where four are always irrelevant is worse than one that means
       "how much". */
    fxAmt: clamp(round2(num(r['t-fxamt'], 0.5)), 0, 1),
    roll: pick(ROLLS, r['t-roll'], 'none'),
  };
}

/** The lines of the title, and of its subtitle, with blanks kept. */
export function titleLines(str) {
  return String(str == null ? '' : str).split('\n');
}

/** True when there is nothing to draw — used to keep an empty title honest. */
export const isBlankTitle = (cfg) =>
  !(cfg && ((cfg.text || '').trim() || (cfg.sub || '').trim()));

/** How far through the in- and out-ramps we are at `t`. See doc/ramp.js. */
export const titleRamps = (t, len, cfg) => ramps(t, len, cfg?.inSec, cfg?.outSec);

/** Opacity at `t`, 0..1. */
export function titleAlpha(t, len, cfg) {
  const { rin, rout } = titleRamps(t, len, cfg);
  const a = cfg?.animIn === 'fade' || cfg?.animIn === 'rise' ? ease(rin) : 1;
  const b = cfg?.animOut === 'fade' || cfg?.animOut === 'sink' ? ease(rout) : 1;
  return clamp(Math.min(a, b), 0, 1);
}

/**
 * Vertical offset at `t`, as a fraction of the type size.
 *
 * In type sizes rather than pixels or frame fractions because the motion should
 * read the same on a caption and on a main title: a line rising by its own
 * height is the gesture, and it is the same gesture at any size.
 */
export function titleRise(t, len, cfg) {
  const { rin, rout } = titleRamps(t, len, cfg);
  let dy = 0;
  if (cfg?.animIn === 'rise') dy += (1 - ease(rin)) * 0.6;
  if (cfg?.animOut === 'sink') dy += (1 - ease(rout)) * 0.6;
  return round2(dy);
}

/**
 * How much of the copy has been typed at `t`, 0..1.
 *
 * 1 for every animation that is not the typewriter, so the renderer can apply
 * it unconditionally instead of branching.
 */
export function titleReveal(t, len, cfg) {
  // Both progressive entrances, not just the typewriter: a word-by-word reveal
  // is the same fraction applied at a different granularity, and leaving it out
  // here made the renderer ask for a reveal and always be told "all of it".
  if (cfg?.animIn !== 'type' && cfg?.animIn !== 'word') return 1;
  const { rin } = titleRamps(t, len, cfg);
  return clamp(rin, 0, 1);
}

/**
 * Where the text block sits, in pixels, for a frame of W×H.
 *
 * Returns the anchor and the alignment, not a box: the renderer knows how many
 * lines it has and how tall they are, and it is the only thing that can — the
 * measurement depends on the font the canvas actually resolved.
 */
export function titleAnchor(cfg, W, H) {
  const p = PLACE_BY.get(cfg?.place) || PLACE_BY.get(DEFAULT_PLACE);
  const w = Math.max(1, num(W, 1));
  const h = Math.max(1, num(H, 1));
  const inset = SAFE;
  // The anchor runs between the safe margins, so 0 is the left safe line and 1
  // the right one — not the frame edges.
  const x = (inset + p.ax * (1 - inset * 2) + num(cfg?.dx, 0)) * w;
  const y = (inset + p.ay * (1 - inset * 2) + num(cfg?.dy, 0)) * h;
  return { x, y, align: p.align, vertical: p.ay, place: p.v };
}

/**
 * The name a title gets automatically: what it says, prefixed so the lane block
 * reads as a title rather than as a shot.
 *
 * One definition, used in two places that HAVE to agree: video/timeline.js
 * names a title when it creates one, and doc/clipedit.js compares against it to
 * tell an untouched name from one the author typed. If they drifted, editing
 * the words would either stop renaming the block or would overwrite a name
 * somebody chose.
 */
export const titleLabel = (rec) => 'Title · ' + titleSummary(makeTitle(rec));

/**
 * Scale at `t`, for the entrances that arrive by growing.
 *
 * About the block's own centre, so a title pops in place rather than sliding in
 * from the corner the anchor happens to be.
 */
export function titleScale(t, len, cfg) {
  if (cfg?.animIn !== 'pop') return 1;
  const { rin } = titleRamps(t, len, cfg);
  const e = ease(rin);
  // The same single overshoot hump the graphic pop uses: exactly 0 at both ends.
  return round2(0.7 + 0.3 * e + Math.sin(e * Math.PI) * 0.1);
}

/**
 * How far through a roll we are at `t`, 0..1, or null when there is no roll.
 *
 * Travels the whole clip rather than a ramp: a credits roll that finished in
 * the first half-second and then sat still would not be a roll. Null rather
 * than 0 so a caller can tell "not rolling" from "at the start of a roll" — the
 * two need different placement.
 */
export function titleRollAt(t, len, cfg) {
  if (!cfg || cfg.roll === 'none' || !ROLLS.includes(cfg.roll)) return null;
  const L = Math.max(0.0001, num(len, 0));
  return clamp(num(t, 0) / L, 0, 1);
}

/**
 * A deterministic value in 0..1 from whatever you hand it.
 *
 * Every continuous effect needs jitter, and none of them may use Math.random:
 * the exporter renders frames out of order, and an export that shimmered
 * differently from the scrub that approved it would be worse than one that did
 * not shimmer at all. STEADY is the property that matters and the reason for
 * the name — fx/crt.js has an `fxNoise` that DRAWS grain, which is a different
 * thing entirely.
 */
export function steadyNoise(a, b = 0, c = 0) {
  const n = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

/** One line for the lane block and the status bar. */
export function titleSummary(cfg) {
  if (isBlankTitle(cfg)) return 'Empty title';
  const first = titleLines(cfg.text)[0].trim() || titleLines(cfg.sub)[0].trim();
  return first.slice(0, 28) || 'Title';
}
