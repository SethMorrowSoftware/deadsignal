/* Dead Signal Studio — export/batch.js
 *
 * Export a whole set in one go: every preset as a file, every timeline clip as
 * its own file.
 *
 * The tool exports one thing at a time, which is right when you are shaping a
 * look and wrong when you are dressing a campaign. Forty-eight scenes and
 * forty-five presets is a lot of clicking to find out which four you want, and
 * a sequence you have already cut is the one thing you should never have to
 * rebuild clip by clip to get the pieces out of.
 *
 * ------------------------------------------------------- nothing is touched --
 *
 * A batch renders from RECIPES, never from the controls. `presetRecipe()`
 * composes a full recipe out of the tab defaults plus the preset, and
 * `readVideoCfg(rec)` / `readImageCfg(rec)` build a config from one without
 * reading the DOM at all — the same seam the timeline uses to render a clip
 * whose settings are not the ones currently on screen.
 *
 * That is the property that makes this safe to run: exporting forty-five presets
 * leaves the author's own settings, their undo history and their document
 * exactly as they were. A batch that quietly loaded its last preset over your
 * work would be worse than no batch at all.
 *
 * ------------------------------------------------------------------ length --
 *
 * Video presets are capped to a few seconds each by default. A batch is a
 * contact sheet — you are looking for which of these is the one — and forty-five
 * ten-second clips is several minutes of encoding to answer a question that
 * three seconds each answers. The cap is a parameter, not a rule.
 */
import { log } from '../core/dom.js';
import { flatPresets, presetRecipe } from '../presets/index.js';
import { userPresets } from '../core/recipes.js';
import { readVideoCfg, renderScaled } from '../video/render.js';
import { drawImageTo, readImageCfg } from '../image/render.js';
import { timeline } from '../video/timeline.js';
import { addToLibrary } from '../library/library.js';
import { encodeClip, encoderSupport } from './encoder.js';

/** What can be batched. `count()` is what the panel shows before you commit. */
export const BATCH_SOURCES = [
  {
    id: 'video-presets',
    label: 'Every VIDEO preset → a clip',
    hint: 'One short clip per preset, so you can see every look side by side in the library.',
    count: () => Object.keys(allPresets('video')).length,
  },
  {
    id: 'screen-presets',
    label: 'Every SCREEN preset → a .png',
    hint: 'One still per preset. Fast — these are single frames.',
    count: () => Object.keys(allPresets('image')).length,
  },
  {
    id: 'timeline-clips',
    label: 'Every TIMELINE clip → its own file',
    /* It used to carry each clip's own bed and nothing else, and this note said
       so — the sequence bed, the audio lane and a clip's footage sound were all
       absent by design, and an author found out after upload. It now carries a
       slice of the finished sequence mix instead, so what a clip sounds like on
       its own is what it sounds like in the sequence. */
    hint: 'Each clip in the sequence exported separately, trimmed exactly as you cut it. '
      + 'Each file carries its own slice of the whole sequence mix — the sequence bed, '
      + 'the audio lane and its footage’s sound included.',
    count: () => timeline.length,
  },
];

/** Built-in presets and the author's own, in one map. */
function allPresets(tab) {
  const out = { ...flatPresets(tab) };
  const mine = userPresets(tab);
  for (const name in mine) out[name] = mine[name];
  return out;
}

/** A filename stem that survives being one of forty-five. */
const stem = (s) => String(s || 'batch').replace(/[^a-zA-Z0-9]+/g, '-')
  .replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'batch';

/**
 * Run a batch.
 *
 * @param {string} sourceId       one of BATCH_SOURCES
 * @param {object} [opts]
 * @param {number} [opts.seconds]   cap per video item (0 = the recipe's own length)
 * @param {string} [opts.container] 'webm' | 'mp4'
 * @param {(done:number,total:number,label:string)=>void} [opts.onProgress]
 * @param {() => boolean} [opts.cancelled]
 * @returns {Promise<{made:number, failed:string[], cancelled:boolean, items:string[]}>}
 * @throws when the batch holds video items and no WebCodecs encoder exists —
 *         a batch has no real-time fallback, so it is refused up front with the
 *         reason rather than failing every item with the same blank message.
 *
 * One item failing never stops the batch. The whole point is to come back to a
 * full library, and losing forty-four exports because the forty-fifth hit a
 * codec edge would be the worst possible trade.
 */
export async function runBatch(sourceId, opts = {}) {
  const { seconds = 3, container = 'webm', onProgress, cancelled } = opts;
  const made = [];
  const failed = [];
  let stopped = false;

  const items = await gather(sourceId, seconds);
  /* The single-clip RECORD button drops to the real-time recorder when
     WebCodecs is missing (plain-http origins, browsers without VideoEncoder);
     a batch cannot — it renders faster than wall clock by definition. Probe
     once so the author gets the actionable reason instead of forty-five
     "nothing rendered" lines. encodeClip degrades mp4→webm itself, so the
     batch is only impossible when NEITHER container can be written. */
  if (items.some((it) => it.kind === 'videos')) {
    let support = await encoderSupport(320, 240, container);
    if (!support.available && container === 'mp4') support = await encoderSupport(320, 240, 'webm');
    if (!support.available) throw new Error(support.reason);
  }
  for (let i = 0; i < items.length; i++) {
    if (cancelled?.()) { stopped = true; break; }
    const item = items[i];
    onProgress?.(i, items.length, item.name);
    try {
      const out = await item.render({ container, cancelled });
      if (!out) { failed.push(`${item.name}: nothing rendered`); continue; }
      if (out.cancelled) { stopped = true; break; }
      addToLibrary(out.blob, out.ext, item.kind, `${item.prefix}-${stem(item.name)}`, out.seconds || 0);
      made.push(item.name);
      // Same accounting as the single-clip exporter: a clip that silently came
      // out silent is something you find out about after uploading it.
      if (out.audioRequested && !out.audio) {
        log(`  batch: ${item.name} — NO AUDIO (encoder unavailable)`, 'warn');
      }
    } catch (e) {
      failed.push(`${item.name}: ${e.message}`);
    }
  }
  onProgress?.(items.length, items.length, '');

  const note = `Batch ${sourceId}: ${made.length} exported`
    + (failed.length ? `, ${failed.length} failed` : '')
    + (stopped ? ' (stopped)' : '');
  log(note, failed.length ? 'warn' : 'ok');
  for (const f of failed) log('  batch: ' + f, 'warn');
  return { made: made.length, failed, cancelled: stopped, items: made };
}

/** Turn a source id into a list of things to render. */
async function gather(sourceId, seconds) {
  if (sourceId === 'video-presets') {
    const presets = allPresets('video');
    return Object.entries(presets).map(([name, rec]) => ({
      name, kind: 'videos', prefix: 'preset',
      render: async ({ container, cancelled }) => {
        const cfg = readVideoCfg(presetRecipe('video', 'view-video', rec));
        const dur = seconds > 0 ? Math.min(seconds, cfg.duration) : cfg.duration;
        const frames = Math.max(1, Math.round(dur * cfg.fps));
        const r = await encodeClip({
          width: cfg.W, height: cfg.H, fps: cfg.fps, frames, container, log,
          // Times are clamped to the RECIPE's duration, not the cap: a scene
          // that resolves over ten seconds should show its first three, not
          // three seconds of a ten-second scene squeezed into three.
          drawFrame: (ctx, t) => renderScaled(ctx, cfg.W, cfg.H, cfg, Math.min(t, cfg.duration)),
          cancelled,
        });
        return r && { ...r, ext: r.ext || 'webm', seconds: dur };
      },
    }));
  }

  if (sourceId === 'screen-presets') {
    const presets = allPresets('image');
    return Object.entries(presets).map(([name, rec]) => ({
      name, kind: 'image', prefix: 'screen',
      render: async () => {
        const cfg = readImageCfg(presetRecipe('image', 'view-image', rec));
        const c = document.createElement('canvas');
        c.width = cfg.W; c.height = cfg.H;
        drawImageTo(c.getContext('2d'), cfg.W, cfg.H, cfg);
        const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
        return blob && { blob, ext: 'png', seconds: 0 };
      },
    }));
  }

  if (sourceId === 'timeline-clips') {
    // Imported lazily: video/timeline.js already imports this module's siblings,
    // and pulling its renderer in at module scope would close the cycle.
    const { renderClipTo, readTimelineCfg } = await import('../video/timeline.js');
    const { clipLength } = await import('../doc/timeline.js');
    // Namespace import: _importedVideo is a reassignable binding, and a
    // destructure would freeze whatever it held at gather() time.
    const media = await import('../media/import.js');
    const { sliceBuffer } = await import('../audio/bed.js');
    const { buildSchedule, sequenceMix } = await import('../video/timeline.js');
    const tl = readTimelineCfg();
    const sched = buildSchedule();
    /* Built ONCE for the whole batch and sliced per clip, rather than one
       mixdown per clip. A mixdown is a decode plus an offline render per part;
       doing it per clip would multiply that by the length of the batch to
       produce, in the end, the same samples. Lazy and memoised because a batch
       of silent clips should not pay for it at all. */
    let full;
    const wholeMix = async () => {
      if (full === undefined) {
        try { full = await sequenceMix(sched); }
        catch (e) { log(`Sequence mix failed (${e.message}) — exporting silent.`, 'warn'); full = null; }
      }
      return full;
    };
    return timeline.map((clip, i) => ({
      name: `${String(i + 1).padStart(2, '0')}-${clip.label}`, kind: 'videos', prefix: 'clip',
      render: async ({ container, cancelled }) => {
        const len = clipLength(clip);
        const frames = Math.max(1, Math.round(len * tl.fps));
        const scratch = document.createElement('canvas');
        scratch.width = tl.W; scratch.height = tl.H;
        const sctx = scratch.getContext('2d');
        /* This clip's slice of the WHOLE sequence mix — its own bed, the
           sequence bed under it, anything on the audio lane that overlaps it,
           and its footage's own sound. Previously it was the clip's bed and
           nothing else, so a clip exported on its own was missing most of what
           it sounds like in the sequence, and the panel note said so instead of
           fixing it. Read from the schedule rather than accumulated here: the
           start of a clip is a fact the schedule owns, and speed and transitions
           both move it. */
        let bed = null;
        const mix = await wholeMix();
        if (mix) bed = sliceBuffer(mix, sched.starts[i] ?? 0, len);
        /* A videoin clip draws the imported <video> at whatever frame it is
           currently showing — a <video> only advances in wall-clock time, so
           frame-indexed encoding must seek it to each frame's instant first,
           exactly as collectFrames does for the GIF/strip export. Without the
           seek every encoded frame samples the same picture. */
        const seeks = clip.kind !== 'still' && clip.scene === 'videoin' && media.hasImportedVideo();
        try {
          const r = await encodeClip({
            width: tl.W, height: tl.H, fps: tl.fps, frames, container, log,
            audioBuffer: bed,
            drawFrame: async (ctx, t) => {
              const localT = Math.min(t, len);
              // The IN point offsets the seek, so a trimmed clip exports the
              // part of its footage the author kept.
              if (seeks) await media.seekVideo(media._importedVideo, (clip.in || 0) + localT);
              renderClipTo(sctx, clip, localT, tl);
              ctx.drawImage(scratch, 0, 0);
            },
            cancelled,
          });
          return r && { ...r, ext: r.ext || 'webm', seconds: len };
        } finally {
          // seekVideo pauses the element; put the preview's looping playback back.
          if (seeks) { try { media._importedVideo.play().catch(() => {}); } catch (e) { /* detached */ } }
        }
      },
    }));
  }

  return [];
}
