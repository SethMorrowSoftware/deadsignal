/* Dead Signal Studio — video/transitions.js
 *
 * How one clip becomes the next. One function per transition, all of them
 * driven by the same number.
 *
 * WHY THIS IS A MODULE
 *
 * The compositor used to carry four transitions inline, as a chain of `else if`
 * inside the spine loop, and that was fine at four. It is not fine at fourteen:
 * the loop is also doing scheduling, dip arithmetic, overlay compositing and
 * the look-ahead that lets a clip know what the NEXT one is doing, and burying
 * a wipe's clip-path in the middle of that makes both harder to read and neither
 * testable on its own.
 *
 * THE CONTRACT
 *
 * Every transition is a function of `k` — how far through it we are, 0..1 — and
 * nothing else. No transition may keep state between frames, because the
 * exporter renders frames out of order and the scrubber lands wherever it likes.
 *
 * A transition is handed a `draw()` callback rather than the clip, so it can
 * decide WHERE and HOW MANY TIMES the incoming picture lands without knowing
 * anything about clips, recipes or the compositor. A wipe calls it once inside
 * a clip path; a whip pan calls it eight times at decreasing opacity.
 *
 * DIRECTION IS A SEPARATE FIELD, NOT A SEPARATE TRANSITION
 *
 * `wipe-left`, `wipe-right`, `wipe-up` and `wipe-down` as four entries would
 * turn a list of fourteen into a list of thirty and make the picker useless.
 * They are one transition and a direction, exactly as an author thinks of them.
 * Transitions that have no direction simply ignore it. WHICH ones take one is a
 * fact about the vocabulary rather than about drawing, so it lives in
 * doc/timeline.js beside TRANSITIONS — the inspector needs the same answer to
 * decide whether to offer the control, and one list cannot drift from itself.
 */

/** Directions, in the order a picker should show them. */
export const DIRS = [
  { v: 'l', t: 'From the left' },
  { v: 'r', t: 'From the right' },
  { v: 'u', t: 'From the top' },
  { v: 'd', t: 'From the bottom' },
];
export const DEFAULT_DIR = 'l';
const DIR_SET = new Set(DIRS.map((d) => d.v));
export const isDir = (v) => DIR_SET.has(v);
/** Horizontal directions move x; vertical ones move y. */
const horizontal = (dir) => dir === 'l' || dir === 'r';
/** +1 when the incoming picture travels in the positive axis direction. */
const sign = (dir) => (dir === 'l' || dir === 'u' ? 1 : -1);

/** Smoothstep, for the transitions that should not arrive at constant speed. */
const ease = (u) => u * u * (3 - 2 * u);
const clamp01 = (u) => (u < 0 ? 0 : u > 1 ? 1 : u);

/**
 * How far the OUTGOING clip is displaced at `k`, in pixels.
 *
 * Only a push moves it: a slide lays the incoming picture over a stationary
 * one, a push shoves it off the other side. Returned rather than drawn because
 * the outgoing clip is drawn in its own pass through the spine loop — one
 * iteration earlier — so the compositor asks this on the way past.
 */
export function pushOffset(transition, dir, k, W, H) {
  if (transition !== 'push') return { dx: 0, dy: 0 };
  const u = ease(clamp01(k));
  const s = sign(dir);
  return horizontal(dir) ? { dx: s * u * W, dy: 0 } : { dx: 0, dy: s * u * H };
}

/**
 * Draw the incoming clip according to `transition`.
 *
 * @param ctx  the frame, already carrying the outgoing picture
 * @param k    0..1 through the transition
 * @param draw () => void — puts the incoming picture on `ctx` at full frame
 * @returns    true if it handled the draw; false to fall back to a plain
 *             alpha blend, which is what an unknown name from a newer build
 *             should degrade to rather than drawing nothing.
 */
export function drawIncoming(ctx, W, H, transition, dir, k, draw, t = 0) {
  const u = clamp01(k);
  const d = isDir(dir) ? dir : DEFAULT_DIR;

  switch (transition) {
    case 'wipe': {
      /* An EDGE, not a dissolve: the clip underneath is not dimmed, it is
         covered. Clipped rather than drawn narrow, or the incoming picture
         would be squashed as it arrives. */
      ctx.save();
      ctx.beginPath();
      const w = W * u; const h = H * u;
      if (d === 'l') ctx.rect(0, 0, w, H);
      else if (d === 'r') ctx.rect(W - w, 0, w, H);
      else if (d === 'u') ctx.rect(0, 0, W, h);
      else ctx.rect(0, H - h, W, h);
      ctx.clip();
      draw();
      ctx.restore();
      return true;
    }

    case 'slide': {
      // The incoming picture travels; the outgoing one stays put.
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
      const e = ease(u);
      if (horizontal(d)) ctx.translate(-sign(d) * (1 - e) * W, 0);
      else ctx.translate(0, -sign(d) * (1 - e) * H);
      draw();
      ctx.restore();
      return true;
    }

    case 'push': {
      // Same travel as a slide — the difference is that the compositor also
      // displaced the outgoing clip, via pushOffset above.
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
      const e = ease(u);
      if (horizontal(d)) ctx.translate(-sign(d) * (1 - e) * W, 0);
      else ctx.translate(0, -sign(d) * (1 - e) * H);
      draw();
      ctx.restore();
      return true;
    }

    case 'iris': {
      /* A circle opening from the centre. The radius runs to the CORNER, not
         to the edge, or the last of the outgoing picture would survive in the
         four corners after the transition was over. */
      ctx.save();
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, Math.hypot(W, H) / 2 * ease(u), 0, Math.PI * 2);
      ctx.clip();
      draw();
      ctx.restore();
      return true;
    }

    case 'clock': {
      // A wedge sweeping clockwise from twelve.
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(W / 2, H / 2);
      ctx.arc(W / 2, H / 2, Math.hypot(W, H), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * u);
      ctx.closePath();
      ctx.clip();
      draw();
      ctx.restore();
      return true;
    }

    case 'barn': {
      /* Two panels opening from the centre line, like barn doors.
         AXIS-ONLY, and deliberately: opening from the centre is symmetric, so
         'from the left' and 'from the right' are the same gesture and only the
         axis is a real choice. Faking a difference — starting the split
         off-centre — would be inventing a transition nobody asked for to make a
         control look busier than it is. The panel says so in the hint, and the
         suite asserts the two are identical rather than letting it look like an
         oversight. */
      ctx.save();
      ctx.beginPath();
      const e = ease(u);
      if (horizontal(d)) {
        const half = (W / 2) * e;
        ctx.rect(W / 2 - half, 0, half * 2, H);
      } else {
        const half = (H / 2) * e;
        ctx.rect(0, H / 2 - half, W, half * 2);
      }
      ctx.clip();
      draw();
      ctx.restore();
      return true;
    }

    case 'blinds': {
      /* Eight bands growing together. Eight rather than a control: it reads as
         blinds from about six and as a comb past about twelve, and one more
         number on a transition nobody tunes is one more thing to get wrong. */
      const N = 8;
      ctx.save();
      ctx.beginPath();
      const e = ease(u);
      // Each band grows from the edge the direction names, not always from its
      // own leading edge — otherwise 'from the right' would be identical to
      // 'from the left' and the control would be half wired.
      const from = sign(d) > 0;
      if (horizontal(d)) {
        const band = W / N;
        for (let i = 0; i < N; i++) {
          const x0 = i * band;
          ctx.rect(from ? x0 : x0 + band * (1 - e), 0, band * e, H);
        }
      } else {
        const band = H / N;
        for (let i = 0; i < N; i++) {
          const y0 = i * band;
          ctx.rect(0, from ? y0 : y0 + band * (1 - e), W, band * e);
        }
      }
      ctx.clip();
      draw();
      ctx.restore();
      return true;
    }

    case 'whip': {
      /* A whip pan: the camera snaps across so fast the picture smears. The
         incoming clip is drawn as a stack of offset copies — which is what
         motion blur IS, the shutter open across a distance — sweeping in from
         off-frame and settling to rest. Cheaper and more controllable than
         ctx.filter blur, and it does not soften the picture when at rest.

         It runs across the WHOLE window, fading up (× e) over the outgoing clip
         that the compositor has already drawn underneath. It used to sit out the
         entire first half — `if (u < 0.5) return true` drew nothing — so half of
         every whip was a static hold of the outgoing frame with no motion at
         all, and the visible gesture was only the back half of its duration. */
      const e = ease(u);
      const SMEAR = 8;
      const travel = (1 - e) * (horizontal(d) ? W : H) * 0.6;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
      for (let i = 0; i < SMEAR; i++) {
        const f = i / (SMEAR - 1);
        ctx.save();
        // Fainter trailing copies, and the whole smear fades in with e so the
        // window opens on the outgoing picture rather than a hard pop.
        ctx.globalAlpha = (1 / SMEAR) * (1 + f) * e;
        const off = -sign(d) * travel * (1 - f * 0.35);
        if (horizontal(d)) ctx.translate(off, 0); else ctx.translate(0, off);
        draw();
        ctx.restore();
      }
      ctx.restore();
      return true;
    }

    case 'glitch': {
      /* A cut that tears. The incoming picture arrives whole but is sliced and
         displaced, with the displacement falling to nothing as k reaches 1 — so
         the transition ENDS on a clean frame rather than on a frame that is
         nearly clean. Deterministic from k and t, never Math.random, or an
         export would tear differently from the scrub that approved it. */
      const bands = 9;
      const amt = (1 - u) * W * 0.16;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
      for (let i = 0; i < bands; i++) {
        const y = (i / bands) * H;
        const h = H / bands + 1;
        // A cheap hash of (band, k-step, t) — stable for a given frame.
        const n = Math.sin(i * 12.9898 + Math.floor(u * 12) * 78.233 + t * 3.71) * 43758.5453;
        const off = ((n - Math.floor(n)) * 2 - 1) * amt;
        ctx.save();
        ctx.beginPath(); ctx.rect(0, y, W, h); ctx.clip();
        ctx.translate(off, 0);
        draw();
        ctx.restore();
      }
      ctx.restore();
      return true;
    }

    default:
      return false;                                  // plain alpha blend
  }
}

/**
 * The flash a non-overlapping transition puts over the join, 0..1.
 *
 * `dip` and `burn` do not overlap their neighbour — they show one clip, then a
 * colour, then the next — so they are drawn ON TOP of whatever the frame holds
 * rather than as a way of revealing the incoming picture. The compositor asks
 * for this from BOTH sides of a join: the outgoing clip's own tail and the
 * incoming clip's head, which is what makes the flash symmetrical without
 * either clip knowing about the other.
 */
export const FLASH = { dip: '#000000', dipwhite: '#ffffff', burn: '#ffd9a0' };
export const isFlash = (t) => Object.prototype.hasOwnProperty.call(FLASH, t);
