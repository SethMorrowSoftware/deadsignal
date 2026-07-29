/* Dead Signal Studio — audio/peaks.js
 *
 * Turning samples into something you can look at. Pure: takes channel arrays and
 * a 2D context, knows nothing about which canvas or which clip.
 *
 * There was one waveform drawer in the tree and it was hard-bound to #acanvas —
 * it took no canvas, no range and no colours, and it recomputed min/max over the
 * whole Float32Array on every call. The audio lane needs the same picture at
 * thumbnail size, for a window of a source, dozens of times. So the maths is
 * split out from the painting, and both the AUDIO tab and the lane call it.
 */

/**
 * Min and max per horizontal bucket, over every channel at once.
 *
 * Interleaved [min0, max0, min1, max1, …] in one Float32Array rather than pairs
 * of objects: this runs per bucket per redraw, and the allocation is the cost
 * that matters.
 *
 * Over ALL channels together, because a thumbnail is one lane tall — a summed
 * trace would cancel a wide stereo image into a flat line, which is exactly the
 * material this tool makes.
 */
export function peaksOf(channels, buckets) {
  const chans = Array.isArray(channels) ? channels.filter((c) => c && c.length) : [];
  const n = Math.max(1, Math.floor(buckets) || 1);
  const out = new Float32Array(n * 2);
  if (!chans.length) return out;
  const len = chans[0].length;
  if (!len) return out;
  const step = len / n;
  for (let b = 0; b < n; b++) {
    const from = Math.floor(b * step);
    const to = Math.min(len, Math.max(from + 1, Math.floor((b + 1) * step)));
    let mn = 1, mx = -1;
    for (const d of chans) {
      for (let i = from; i < to; i++) {
        const v = d[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    // A bucket past the end of the data is silence, not ±1 left over from the
    // sentinels.
    out[b * 2] = mn > mx ? 0 : mn;
    out[b * 2 + 1] = mn > mx ? 0 : mx;
  }
  return out;
}

/**
 * Paint interleaved peaks as a filled envelope.
 *
 * `opts.stroke` draws it, `opts.fill` fills behind it, `opts.bg` clears first —
 * omit bg and it composites onto whatever is already there, which is what the
 * lane thumbnails want.
 */
export function paintWave(ctx, W, H, peaks, opts = {}) {
  const { stroke = '#39ff9e', fill = null, bg = null, amp = 0.45 } = opts;
  if (!ctx || !(W > 0) || !(H > 0)) return;
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
  const n = Math.floor(peaks.length / 2);
  if (!n) return;
  const mid = H / 2;
  const px = W / n;
  if (fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    for (let b = 0; b < n; b++) ctx.lineTo(b * px, mid - peaks[b * 2 + 1] * H * amp);
    for (let b = n - 1; b >= 0; b--) ctx.lineTo(b * px, mid - peaks[b * 2] * H * amp);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = stroke;
  ctx.beginPath();
  for (let b = 0; b < n; b++) {
    const x = b * px;
    // A column of one pixel with no height still has to show: silence reads as
    // a centre line, not as nothing at all.
    const top = mid - peaks[b * 2 + 1] * H * amp;
    const bot = mid - peaks[b * 2] * H * amp;
    ctx.moveTo(x, top);
    ctx.lineTo(x, Math.max(bot, top + 0.5));
  }
  ctx.stroke();
}

/* ================================================================ level ==
   The sequence mixdown is UNLIMITED: a bed, a per-clip bed, your footage's own
   sound and half a dozen lane clips are summed with no headroom management at
   all, and gain goes to 4. Nothing anywhere said so. Past 1.0 the encoder
   clamps, which is audible as distortion on the loudest moment of the export —
   the one place nobody re-checks, because it sounded fine while they were
   cutting the quiet part.
   ======================================================================== */

/** The loudest single sample across every channel. 1.0 is full scale. */
export function peakLevel(channels) {
  if (!Array.isArray(channels)) return 0;
  let peak = 0;
  for (const ch of channels) {
    if (!ch || typeof ch.length !== 'number') continue;
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i]);
      if (v > peak) peak = v;
    }
  }
  return Number.isFinite(peak) ? peak : 0;
}

/**
 * That level in dBFS, floored rather than −Infinity.
 *
 * Silence really is negative infinity, and printing it is useless: a readout
 * that says "-Infinity dB" reads as broken, and no meter in any tool shows it.
 * −120 is below anything a 32-bit float mix will do on purpose.
 */
export function dbfs(v) {
  const x = Math.abs(Number(v));
  if (!Number.isFinite(x) || x <= 0) return -120;
  return Math.max(-120, Math.round(20 * Math.log10(x) * 10) / 10);
}

/** True once the mix has reached full scale, where the encoder starts clamping. */
export const isClipping = (v) => Number(v) >= 1;

/** "−3.2 dB" — or a warning, once there is one to give. */
export function peakLabel(v) {
  const x = Math.abs(Number(v)) || 0;
  if (x <= 0) return 'silent';
  const d = dbfs(x);
  const shown = `${d <= -120 ? '−120' : String(d).replace('-', '−')} dB`;
  return isClipping(x) ? `${shown} · CLIPPING` : shown;
}
