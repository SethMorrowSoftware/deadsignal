/* Dead Signal Studio — ui/lanedrop.js
 *
 * Dropping an asset from the media bin onto the sequence.
 *
 * The gesture that makes a bin a bin. Before this, getting your own footage
 * into a sequence was: click the asset, land on the VIDEO tab, notice the scene
 * changed, press ＋ SCENE. Four steps and two tabs to do the thing every editor
 * does with one drag.
 *
 * What a drop MEANS depends on the asset, and each answer is the only sensible
 * one for its kind:
 *
 *   footage  →  a clip on the spine that plays THAT file, appended in order.
 *               It carries the file's key in its own recipe (see
 *               video/sources.js), so a sequence can cut between two files.
 *   a still  →  a held screen, the same as ＋ STILL.
 *   sound    →  a clip on the audio lane, AT THE TIME YOU DROPPED IT, because
 *               that is what the audio lane is for and where you dropped it is
 *               the only information the gesture carries.
 *
 * Sound is positioned and picture is ordered, which is the same split the two
 * lanes have everywhere else — so the drop x matters for one and not the other,
 * and that is not an inconsistency, it is the model.
 */
import { $, log, setVal, toast, val } from '../core/dom.js';
import { library } from '../library/library.js';
import { pxToTime } from './timescale.js';
import { trackScale } from './track.js';
import { BIN_DRAG_TYPE } from './importui.js';
import { addAudioClip, addStillClip, addTimelineClip } from '../video/timeline.js';
import { ensureVideoSource } from '../video/sources.js';
import { loadImageFile } from '../media/import.js';

/** Where along the lane a drop landed, in seconds. */
export function dropTime(e) {
  const lane = $('tl-track')?.querySelector('.tl-row.spine .tl-lane')
    ?? $('tl-track')?.querySelector('.tl-lane');
  if (!lane) return 0;
  const r = lane.getBoundingClientRect();
  const { pxPerSec } = trackScale();
  // Content-relative, exactly as the lane's own pointer maths is: .tl-lane IS
  // the content box, so its rect has already slid with the scroller.
  return Math.max(0, Math.round(pxToTime(e.clientX - r.left - 1, pxPerSec) * 100) / 100);
}

/**
 * Put `it` into the sequence.
 *
 * Returns a promise so a caller can await the clip actually existing — footage
 * has to decode before a clip can know how long it is, and adding a clip of the
 * wrong length and fixing it afterwards would put two entries in the undo stack
 * for one gesture.
 */
export async function dropAsset(it, at) {
  if (!it) return false;
  if (!it.blob) {
    toast('This project was opened without its files, so there is nothing to add', 'err');
    return false;
  }

  if (it.kind === 'music') {
    return addAudioClip({ source: `lib:${it.key}`, at, seconds: it.seconds || 4, label: it.name });
  }

  if (it.kind === 'image') {
    /* A still draws the SCREEN recipe, and the recipe's image is the active
       slot — so the picture has to be loaded before the clip is captured or the
       clip holds whatever was there before. */
    const file = new File([it.blob], `${it.name}.${it.ext}`, { type: it.blob.type || '' });
    await new Promise((res) => loadImageFile(file, res));
    setVal('i-tpl', 'import');
    addStillClip(Number(val('tl-stilldur')) || 3);
    log(`Sequence + still: ${it.name}.${it.ext}`, 'ok');
    return true;
  }

  // Footage.
  const el = await ensureVideoSource(it.key);
  if (!el) { toast(`${it.name}.${it.ext} could not be decoded here`, 'err'); return false; }
  setVal('v-srckey', `lib:${it.key}`);
  setVal('v-scene', 'videoin');
  /* The clip is as long as the footage, capped at what a clip may be. Adding it
     at the tab's current duration would trim someone's shot without being asked
     to. */
  const dur = Number.isFinite(el.duration) && el.duration > 0 ? Math.min(60, Math.max(1, el.duration)) : 8;
  setVal('v-dur', Math.round(dur * 100) / 100);
  addTimelineClip();
  log(`Sequence + footage: ${it.name}.${it.ext} (${dur.toFixed(1)}s)`, 'ok');
  return true;
}

/** Wire the sequence lane as a drop target for bin assets. */
export function initLaneDrop() {
  const box = $('tl-track');
  if (!box || box.dataset.dropWired) return false;
  box.dataset.dropWired = '1';

  const wants = (e) => [...(e.dataTransfer?.types || [])].includes(BIN_DRAG_TYPE);

  box.addEventListener('dragover', (e) => {
    if (!wants(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    box.classList.add('drop-here');
  });
  box.addEventListener('dragleave', (e) => {
    if (!wants(e)) return;
    // Only when the pointer actually leaves the lane, not on every child cross.
    if (!box.contains(e.relatedTarget)) box.classList.remove('drop-here');
  });
  box.addEventListener('drop', (e) => {
    if (!wants(e)) return;
    e.preventDefault();
    box.classList.remove('drop-here');
    const key = e.dataTransfer.getData(BIN_DRAG_TYPE);
    const it = library.find((x) => x.key === key);
    if (!it) { toast('That asset is no longer in the library'); return; }
    void dropAsset(it, dropTime(e));
  });
  return true;
}
