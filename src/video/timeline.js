/* Dead Signal Studio — video/timeline.js */
import { $, clamp, escHtml, log, num, toast, val } from '../core/dom.js';
import { readRecipe } from '../core/recipes.js';
import { MAX_DIM, MIN_H, MIN_W } from '../core/formats.js';
import { MAX_CLIP, MAX_CLIPS, MAX_START, MIN_CLIP, TRANSITIONS, clipLength, clipSpeed, flashHalf, footageKeyOf, isFirstOnTrack, isOverlay, isTrimmed, normalizeClips, overlaps, scheduleOf, sourceTimeOf, spineSpans } from '../doc/timeline.js';
import { audioEnd, makeAudioClip, normalizeAudioClips } from '../doc/audioclip.js';
import { hasSound, mixParts, mixSignature } from '../doc/audiomix.js';
import { isIdentity, invertPoint, matrixFor } from '../doc/transform.js';
import { armSequenceAudio, previewSoundOn, sequenceAudioReady, sequenceAudioTime, setPreviewSound, startSequenceAudio, stopSequenceAudio } from '../audio/preview.js';
import { ALPHA_BLEND, DEFAULT_BLEND } from '../doc/layers.js';
import { drawImageTo, readImageCfg } from '../image/render.js';
import { DEFAULT_PLACE, makeTitle, titleLabel } from '../doc/title.js';
import { drawTitleTo } from './title.js';
import { DEFAULT_SHAPE, graphicLabel, makeGraphic } from '../doc/graphic.js';
import { drawGraphicTo } from './graphic.js';
import { FLASH, drawIncoming, isFlash, pushOffset } from './transitions.js';
import { applyMatteTo } from './matte.js';
import { initTrack, paintPlayhead, renderTrack } from '../ui/track.js';
import { clearWaveThumbs, waveThumb } from '../ui/wavethumb.js';
import { BED_LAST, BED_NONE, LIB_PREFIX, bedCandidates, buildSequenceMix, invalidateBedCache } from '../audio/bed.js';
import { isClipping, peakLabel } from '../audio/peaks.js';
import { lastAudio } from '../audio/ui.js';
import { initBedSelect } from '../ui/audiobed.js';
import { initSizing, syncFormat } from '../ui/sizing.js';
import { getStore } from '../doc/session.js';
import { set as setCmd } from '../doc/store.js';
import { setFont } from '../core/text.js';
import { encodeClip, encoderSupport, fillContainerSelect } from '../export/encoder.js';
import { captureTracks } from './automation.js';
import { captureFilters } from './filters.js';
import { captureAnnotations } from '../ui/annotations.js';
import { captureLayers } from './layers.js';
import { addToLibrary, onLibraryChange } from '../library/library.js';
import { _importedVideo, hasImportedVideo } from '../media/import.js';
import { playVideoSources, primeVideoSources, videoSource } from './sources.js';
import { initFootageSelect } from '../ui/videosrc.js';
import { initLaneDrop } from '../ui/lanedrop.js';
import { initMonitor, paintMonitorOverlay } from '../ui/monitor.js';
import { wireLive } from '../ui/shell.js';
import { bestMime, claimExport, releaseExport } from './capture.js';
import { _persistCanvas, readVideoCfg, renderVideoFrame } from './render.js';
import { SCENES, scene } from './scenes.js';

/* The live clip list. This is a *projection* of `timeline.clips` in the
   document, not a store of its own — the render loop wants plain objects and
   rebuilding them on every frame would be silly.

   `id` is a render handle, NOT a name: it is re-minted on every commit, so two
   projections of the same clip do not share one. Nothing may key identity on
   it across an edit — see ui/track.js, which tracks focus by slot for exactly
   this reason.

   It used to be the only copy, which is where three bugs came from at once:
   adding a clip did not touch the store, so it raised no undo entry, triggered
   no autosave, and never reached the saved document — clips vanished on
   reload, and Ctrl+Z after adding one appeared to do nothing. Every mutation
   now goes through commitClips(). */
export const timeline=[]; let tlSeq=0;
/* Replacing the clip list is timeline's job, not the project loader's: tlSeq is
   module-local and an ES module cannot assign to an imported binding. */
export function setTimelineClips(clips){
  timeline.length=0;
  for(const c of normalizeClips(clips)) timeline.push({ id:++tlSeq, ...c });
  renderTimelineTable(); renderTrack();
}
/** The document's shape for a clip: no id (that is a runtime handle). */
const plainClip=(c)=>({ kind:c.kind, rec:c.rec, label:c.label, scene:c.scene,
  src:c.src, in:c.in, out:c.out, transition:c.transition, xdur:c.xdur, bed:c.bed,
  /* Every field the document holds has to be listed here — this is the one
     place a clip crosses from the live projection back into the document, and a
     field left out of it is a field silently dropped on the next edit. */
  track:c.track, at:c.at, blend:c.blend, opacity:c.opacity, srcAudio:c.srcAudio, xdir:c.xdir,
  x:c.x, y:c.y, scale:c.scale, rot:c.rot, flip:c.flip, speed:c.speed, reverse:c.reverse,
  keyMode:c.keyMode, keyColour:c.keyColour, keyTol:c.keyTol, keySoft:c.keySoft, keySpill:c.keySpill,
  maskShape:c.maskShape, maskMode:c.maskMode, maskX:c.maskX, maskY:c.maskY, maskW:c.maskW,
  maskH:c.maskH, maskRot:c.maskRot, maskFeather:c.maskFeather, maskAmount:c.maskAmount,
  maskInvert:c.maskInvert });
/**
 * Make `next` the clip list: one undo entry, one autosave, one re-render.
 * Falls back to a plain local swap when no document is bound (headless suites).
 *
 * `opts.coalesceKey` collapses a stream of commits into a single undo entry —
 * dragging a trim handle emits one per pointer move, and without it a two-inch
 * drag would take thirty Ctrl+Z presses to undo.
 *
 * `opts.preview:false` says "this is one frame of a drag": the track, the table
 * and the duration readout still follow the pointer, but the canvas preview is
 * left alone. Restarting it resets the sequence clock to zero, so doing that per
 * pointer move made the preview stutter at the start of clip one for the length
 * of the drag. The caller restarts it once when the pointer comes up.
 */
export function commitClips(next,label,opts={}){
  /* Capped HERE, at the one place every edit funnels through. setTimelineClips
     runs the list through normalizeClips, which slices to MAX_CLIPS — but the
     DOCUMENT was written from the unsliced array, so a 65th clip left the store
     holding 65 while the sequence played 64. A document that disagrees with what
     is on screen survives a save and a reload, and the extra clip reappears as
     soon as something else re-normalises. addTimelineClip and friends refuse
     before they get here (see roomForClip); this is the belt to that braces. */
  const clips=next.slice(0,MAX_CLIPS).map(plainClip);
  const st=getStore();
  if(st) st.apply(setCmd('timeline.clips',clips,{ label, coalesceKey:opts.coalesceKey }));
  setTimelineClips(clips);
  if(opts.preview===false) updateTimelineInfo(buildSchedule());
  else startTimelinePreview();
}
/** Re-project after undo / redo / project load. */
export function syncTimelineFromDoc(){
  const st=getStore(); if(!st)return;
  const clips=st.get('timeline.clips');
  if(Array.isArray(clips)) setTimelineClips(clips);
  syncAudioFromDoc();
}

/* ============================================================================
   THE AUDIO LANE

   A separate array, deliberately. Sound is positioned rather than ordered and
   draws no picture, so letting it ride `timeline.clips` would mean a guard in
   every place that assumes a clip has a scene, a transition and a frame — the
   schedule, the compositor, the batch exporter, the inspector — and every one
   of those guards fails silently when forgotten, because makeClip coerces an
   unknown track back to V1. A plausible export with a terminal scene where a
   sound should be is worse than any amount of duplicated plumbing.

   The two arrays meet in exactly one place: buildSchedule's duration.
   ========================================================================== */
export const audioTimeline=[]; let alSeq=0;
export function setAudioClips(list){
  audioTimeline.length=0;
  for(const c of normalizeAudioClips(list)) audioTimeline.push({ id:++alSeq, ...c });
  renderTrack();
}
/** The document's shape for a sound. Same warning as plainClip: a field left
    out of this list is a field silently dropped on the next edit. */
const plainAudioClip=(c)=>({ source:c.source, label:c.label, at:c.at, in:c.in, out:c.out,
  gain:c.gain, pan:c.pan, fadeIn:c.fadeIn, fadeOut:c.fadeOut, loop:c.loop, mute:c.mute });

export function commitAudioClips(next,label,opts={}){
  const clips=next.map(plainAudioClip);
  const st=getStore();
  if(st) st.apply(setCmd('timeline.audio',clips,{ label, coalesceKey:opts.coalesceKey }));
  setAudioClips(clips);
  if(opts.preview===false) updateTimelineInfo(buildSchedule());
  else startTimelinePreview();
}
export function editAudioClip(i,patch,label,opts){
  if(!audioTimeline[i]) return;
  const next=audioTimeline.slice();
  next[i]={ ...next[i], ...patch };
  commitAudioClips(next,label||'edit sound',opts);
}
/** Put a sound on the lane at `at`, from the timeline tab's source picker. */
export function addAudioClip(init={}){
  const source=init.source ?? (val('tl-asrc')||'');
  if(!source){ toast('Pick a sound first','err'); return false; }
  const at=clamp(Math.round((init.at??tlScrubT)*100)/100,0,MAX_START);
  const seconds=clamp(+init.seconds||4,0.1,600);
  const label=init.label || (bedCandidates().find(it=>LIB_PREFIX+it.key===source)?.name) || 'Sound';
  commitAudioClips([...audioTimeline, makeAudioClip({ source, label, at, in:0, out:seconds })],'add sound');
  toast('Sound at '+at.toFixed(1)+'s');
  log('Timeline + sound: '+label+' @ '+at.toFixed(2)+'s','ok');
  return true;
}
export function syncAudioFromDoc(){
  const st=getStore(); if(!st)return;
  const a=st.get('timeline.audio');
  if(Array.isArray(a)) setAudioClips(a);
}
// Lazy, like the other scratch canvases: no module-scope DOM access.
let _tlAC=null;
export const _tlA=()=>_tlAC||(_tlAC=document.createElement("canvas"));   // scratch for compositing one clip
export function readTimelineCfg(){ return { W:clamp(num("tl-w",360),MIN_W,MAX_DIM), H:clamp(num("tl-h",270),MIN_H,MAX_DIM),
  fps:clamp(num("tl-fps",12),4,30), xtype:val("tl-xtype")||"crossfade", xdur:clamp(num("tl-xdur",0.6),0,4) }; }
/** The default a newly added clip takes, from the sequence controls. */
const defaultTransition=()=>({ transition:val("tl-xtype")||"crossfade", xdur:clamp(num("tl-xdur",0.6),0,4) });
/** How many clips are on the spine — overlays do not count towards "first". */
const spineLength=()=>timeline.reduce((n,c)=>n+(isOverlay(c)?0:1),0);

/**
 * The current look of the tab a clip of this kind comes from.
 *
 * A recipe is the bound controls (core/recipes.js) plus the things that are NOT
 * controls: the keyframe curves, the layer stack, the filter chain, the screen
 * marks. A clip is a snapshot of the look, and half of a keyframed look is the
 * curve — capturing only the controls silently flattens every parameter the
 * author animated.
 *
 * One function because there are now two callers: adding a clip, and re-taking
 * an existing clip's look from the tab (ui/inspector.js). Two copies of this
 * list would mean the second one quietly dropping whatever the first one grew.
 */
export function captureClipRecipe(kind){
  if(kind==="still"){ const rec=readRecipe("view-image"); rec.__annotations=captureAnnotations(); return rec; }
  const rec=readRecipe("view-video");
  rec.__auto=captureTracks(); rec.__layers=captureLayers(); rec.__filters=captureFilters();
  return rec;
}

/**
 * Is there room for another clip?
 *
 * Five add paths built a clip, committed it and toasted "Clip added (64)" — a
 * number that looks like success and is in fact the count of clips that
 * SURVIVED, because normalizeClips had just dropped the new one. Nothing said
 * so. A refusal has to be visible or it is a bug report about a button that
 * does nothing.
 */
function roomForClip(){
  if(timeline.length < MAX_CLIPS) return true;
  toast("A sequence holds at most "+MAX_CLIPS+" clips","warn");
  log("Not added: this sequence already has the maximum of "+MAX_CLIPS+" clips.","warn");
  return false;
}
export function addTimelineClip(){ if(!roomForClip())return; const rec=captureClipRecipe("video");
  const cfg=readVideoCfg(rec);
  const sceneName=(SCENES[cfg.scene]||{}).name||cfg.scene; const first=(cfg.text||"").split("\n")[0].trim().slice(0,22);
  const label=sceneName+(first?" · "+first:"");
  /* A clip of your own footage plays its own sound, because that is what
     everyone means by adding a shot. The document DEFAULTS this off (see
     makeClip) so no saved project changes under its author; it is turned on
     here, at the one moment we know the clip is new. */
  const srcAudio=cfg.scene==="videoin" && !!rec["v-srckey"];
  // The first clip has nothing to transition FROM, so it always cuts in — the
  // first clip OF THE SPINE, that is. Overlays are not part of that count; they
  // fade up against whatever V1 is showing and never against a neighbour.
  const t=spineLength()?defaultTransition():{ transition:"cut", xdur:0.6 };
  commitClips([...timeline,{ kind:"video", rec, label, scene:cfg.scene, src:cfg.duration, in:0, out:cfg.duration, srcAudio, ...t }],"add clip");
  toast("Clip added ("+timeline.length+")"); log("Timeline + clip: "+label,"ok"); }

/**
 * Hold the current SCREEN render as a clip.
 *
 * A sequence could only chain video scenes, so a title card, a document or a
 * BSOD — the things a screen template is for — had no way into one. A still is
 * the same shape as any other clip; it just draws a screen recipe instead of a
 * scene, and its trim is simply how long it is held.
 */
export function addStillClip(seconds){ if(!roomForClip())return;
  // Marks are captured with the clip, like the video side's keyframes: a still
  // must draw what it was made with, not whatever the SCREEN tab shows by the
  // time the sequence is rendered. See captureClipRecipe.
  const rec=captureClipRecipe("still");
  const cfg=readImageCfg(rec);
  const hold=clamp(+seconds||3,MIN_CLIP,MAX_CLIP);
  const label="Still · "+((cfg.title||cfg.tpl||"screen").slice(0,22));
  const t=spineLength()?defaultTransition():{ transition:"cut", xdur:0.6 };
  commitClips([...timeline,{ kind:"still", rec, label, scene:"still", src:hold, in:0, out:hold, ...t }],"add still");
  toast("Still added ("+timeline.length+")"); log("Timeline + still: "+label,"ok"); }

/**
 * Put a title on the overlay track, at the playhead.
 *
 * V2 AND NOT THE SPINE, which is the one decision here that is not obvious. A
 * title is words over a shot; on V1 it would be words over BLACK, because the
 * spine is what the picture IS and a title clip's buffer is empty apart from
 * its own glyphs. Dropping one on V1 would look like the feature was broken.
 * The author can still move it to V1 from the inspector — a full-frame title
 * card on black is a real thing to want — but it is not what "add a title"
 * should mean.
 *
 * It comes in at normal blend, not the screen blend an overlay scene uses.
 * Screen keys the black out, which is right for a bright mark on a near-black
 * scene and wrong for type: it would make every dark letter transparent, and a
 * title with a black outline would lose the outline.
 *
 * The recipe is written here rather than captured from a tab, because there is
 * no tab to capture from — see doc/clipedit.js. These are the defaults, and the
 * inspector is where they are changed.
 */
export function addTitleClip(at){ if(!roomForClip())return;
  const start=clamp(Math.round((at??tlScrubT)*100)/100,0,MAX_START);
  const hold=3;
  const rec={
    "t-text":"TITLE", "t-sub":"", "t-font":"sans", "t-size":"9",
    "t-subratio":"0.55", "t-line":"1.25", "t-track":"0",
    "t-fg":"#ffffff", "t-treat":"shadow", "t-bg":"#000000", "t-bga":"0.6",
    "t-place":DEFAULT_PLACE, "t-dx":"0", "t-dy":"0",
    "t-anim":"fade", "t-animout":"fade", "t-in":"0.4", "t-out":"0.4",
  };
  const label=titleLabel(rec);
  commitClips([...timeline,{ kind:"title", rec, label, scene:"title",
    src:hold, in:0, out:hold,
    track:"V2", at:start, transition:"cut", xdur:0.6,
    blend:ALPHA_BLEND, opacity:1 }],"add title");
  toast("Title at "+start.toFixed(1)+"s"); log("Timeline + title @ "+start.toFixed(2)+"s","ok"); }

/**
 * Put a shape on the overlay track, at the playhead.
 *
 * V2 for the same reason a title goes there: a graphic's buffer is empty apart
 * from its own marks, so on the spine it would be a shape on black rather than
 * a shape on the shot. Normal blend rather than screen, because screen would
 * key the dark half out of every stroke.
 */
export function addGraphicClip(at){ if(!roomForClip())return;
  const start=clamp(Math.round((at??tlScrubT)*100)/100,0,MAX_START);
  const hold=3;
  const rec={
    "g-shape":DEFAULT_SHAPE, "g-x":"0.2", "g-y":"0.2", "g-w":"0.3", "g-h":"0.2",
    "g-rot":"0", "g-colour":"#39ff9e", "g-weight":"0.6", "g-radius":"0", "g-dash":"0",
    "g-fill":"#000000", "g-filla":"0", "g-opacity":"1",
    "g-anim":"draw", "g-animout":"fade", "g-in":"0.4", "g-out":"0.3",
  };
  const label=graphicLabel(rec);
  commitClips([...timeline,{ kind:"graphic", rec, label, scene:"graphic",
    src:hold, in:0, out:hold,
    track:"V2", at:start, transition:"cut", xdur:0.6,
    blend:ALPHA_BLEND, opacity:1 }],"add shape");
  toast("Shape at "+start.toFixed(1)+"s"); log("Timeline + shape @ "+start.toFixed(2)+"s","ok"); }

/**
 * Put the current VIDEO look on the overlay track, starting at the playhead.
 *
 * At the playhead rather than at the end, because that is what an overlay is
 * for: something happens at 0:04 and you want static over it. Appending it and
 * making the author drag it back would be the queue model again, on a second
 * lane.
 *
 * It comes in on a crossfade at screen blend — an overlay that cut in at normal
 * blend would simply replace the picture, which is a cut with extra steps. See
 * doc/timeline.js.
 */
export function addOverlayClip(at){ if(!roomForClip())return;
  const rec=captureClipRecipe("video");
  const cfg=readVideoCfg(rec);
  const sceneName=(SCENES[cfg.scene]||{}).name||cfg.scene;
  const first=(cfg.text||"").split("\n")[0].trim().slice(0,22);
  const label=sceneName+(first?" · "+first:"");
  const start=clamp(Math.round((at??tlScrubT)*100)/100,0,MAX_START);
  commitClips([...timeline,{ kind:"video", rec, label, scene:cfg.scene,
    src:cfg.duration, in:0, out:cfg.duration,
    track:"V2", at:start, transition:"crossfade", xdur:0.6, blend:DEFAULT_BLEND, opacity:1 }],"add overlay");
  toast("Overlay at "+start.toFixed(1)+"s"); log("Timeline + overlay: "+label+" @ "+start.toFixed(2)+"s","ok"); }

export function clearTimeline(){
  /* Both lanes, in one transaction: "Clear sequence" that left the sound behind
     would be a sequence that still plays, and two separate commands would take
     two undos to put back. */
  const st=getStore();
  const wipe=()=>{ commitClips([],"clear timeline"); if(audioTimeline.length) commitAudioClips([],"clear sound"); };
  if(st && audioTimeline.length) st.transaction(wipe,"clear sequence"); else wipe();
  toast("Timeline cleared"); }

/* Start times now come from doc/timeline.js, which is where the trim and the
   per-clip transition live. `total` is floored so the preview's `T % total` and
   the recorder's progress maths cannot divide by zero on an empty sequence;
   `duration` is the honest number the panel shows. */
/**
 * The sequence: picture, sound, and how long the whole thing runs.
 *
 * The ONE place the two arrays meet. `duration` is whichever lane runs longer,
 * because sound that outlasts the picture has to play — over black, and
 * visibly so, which is the precedent the V2 overlay already set. The
 * alternative is the mixer clamping every start to a picture-length total and
 * truncating the tail with nothing said.
 *
 * `pictureEnd` is kept separate for anything that genuinely means "how much
 * picture is there" rather than "how long is the sequence".
 */
export function buildSchedule(){ const tl=readTimelineCfg(); const clips=timeline;
  const { starts, duration }=scheduleOf(clips);
  const aEnd=audioEnd(audioTimeline);
  const seq=Math.round(Math.max(duration,aEnd)*100)/100;
  return { clips, starts, audio:audioTimeline, pictureEnd:duration, audioEnd:aEnd,
           total:Math.max(0.1,seq), duration:seq, tl }; }

/**
 * The sound of a whole sequence, built ONCE and used by both export paths.
 *
 * It was written out twice, verbatim, in the offline exporter and in the
 * real-time fallback. Two copies of a mapping is how the fallback silently
 * loses a feature the fast path gained — and it reports "with audio" either
 * way, because that flag is read off the stream rather than off the recording.
 */
export function sequenceMix(s){
  const p=sequenceMixParts(s);
  return buildSequenceMix(p.total,p.seq,p.video,p.audio);
}
/** The mixer's description of a sequence — see doc/audiomix.js. */
function sequenceMixParts(s){
  return mixParts({ ...s, audio:s.audio||audioTimeline }, val('tl-audio'));
}

/* ============================================================================
   PREVIEW SOUND

   The same mixdown the exporter builds, played under the preview — and, while
   it plays, the CLOCK the preview runs on. See audio/preview.js for why the
   picture follows the sound rather than the other way round.

   Cached against the mix signature, because a mixdown is a decode plus one
   offline render per part and `startTimelinePreview()` is called on every
   commit — which means on every pointermove of a trim drag. Renaming a clip,
   moving a keyframe or changing a transition all leave the signature alone, so
   the sound keeps playing through them without a rebuild.
   ========================================================================== */
const _mix={ sig:null, p:null };
/** Forget the cached mixdown (a library row's bytes were replaced). */
export function invalidatePreviewMix(){ _mix.sig=null; _mix.p=null; }
/** The sequence's sound as a buffer, built at most once per distinct mix. */
function previewMix(sched){
  const parts=sequenceMixParts(sched);
  const sig=mixSignature(parts);
  if(_mix.sig===sig && _mix.p) return _mix.p;
  _mix.sig=sig;
  _mix.p = hasSound(parts)
    ? buildSequenceMix(parts.total,parts.seq,parts.video,parts.audio)
        .then((buf)=>{ paintPeak(buf); return buf; })
        .catch((e)=>{ log('Preview sound failed ('+e.message+') — the picture keeps playing.','warn'); paintPeak(null); return null; })
    : Promise.resolve(null).then((buf)=>{ paintPeak(buf); return buf; });
  return _mix.p;
}
/**
 * How loud the sequence gets, on the transport beside the sound toggle.
 *
 * Driven off the mixdown rather than off a live analyser: the number that
 * matters is the peak of the WHOLE sequence, including the moment you are not
 * currently looking at, and a meter that only knows about the last frame it
 * played would read 0 dB on a silent passage over a mix that clips.
 */
function paintPeak(buf){
  const el=$('tl-peak'); if(!el)return;
  const peak=buf && typeof buf.__peak==='number' ? buf.__peak : (buf?null:0);
  if(peak===null){ el.textContent=''; el.classList.remove('warn'); return; }
  el.textContent=buf?peakLabel(peak):'';
  el.classList.toggle('warn',isClipping(peak));
}

/* Where the WALL clock says the preview is. Set by startTimelinePreview so the
   sound joins the picture where it already is rather than at zero — the
   mixdown resolves some milliseconds after the loop starts, and restarting the
   sequence to meet it would make every edit jump back to the top. */
let _tlClock=()=>tlScrubT;
/* One counter, so a mixdown that resolves after a newer preview has started is
   dropped instead of playing over it. */
let _soundGen=0;
/**
 * Silence, now and for anything still on its way.
 *
 * Stopping the source is not enough on its own: a mixdown takes a decode and an
 * offline render to build, so a request made a moment ago can still be in
 * flight, and it would start playing over a preview that has since been paused,
 * left, or handed to the exporter. Bumping the generation is what makes "stop"
 * mean stop.
 */
export function haltPreviewSound(){ _soundGen++; return stopSequenceAudio(); }
/**
 * Put the sequence's sound under the preview, if there is any and it is wanted.
 *
 * Silent by design in three cases, none of which is a failure: sound is off,
 * the preview is paused, or the author has not clicked anything yet so there is
 * no unblocked context. In all three the picture keeps playing on wall time.
 */
export async function armPreviewSound(sched){
  const gen=++_soundGen;
  stopSequenceAudio();
  if(!previewSoundOn() || !tlPlaying || tlRecording || !sequenceAudioReady()) return false;
  if(!sched || !sched.clips.length) return false;
  /* Nothing here may throw at its callers. Every one of them is a fire-and-
     forget `void armPreviewSound(...)` from a render loop or a click handler,
     so a rejection would surface as an uncaught page error — a broken-looking
     studio because a bed failed to decode. */
  try{
    const buf=await previewMix(sched);
    if(gen!==_soundGen || !buf || !tlPlaying || tlRecording) return false;
    return startSequenceAudio(buf,_tlClock());
  }catch(e){ log('Preview sound failed ('+e.message+') — the picture keeps playing.','warn'); return false; }
}
/** Reflect the preference on the SOUND button. */
function paintSoundButton(){
  const b=$('tl-sound'); if(!b)return;
  const on=previewSoundOn();
  b.setAttribute('aria-pressed',on?'true':'false');
  b.textContent=on?'🔈 SOUND':'🔇 MUTED';
  b.title=on
    ? 'Preview sound is on — the sequence bed, each clip’s bed and the A1 lane, mixed as they will export'
    : 'Preview plays silently';
}

/* Render one clip at localT into `sctx` (composited at timeline W/H).
   `localT` is measured from the clip's IN point, so a trimmed clip plays the
   part of its source the author kept rather than restarting it. */
export function renderClipTo(sctx,clip,localT,tl){
  if(sctx.canvas.width!==tl.W) sctx.canvas.width=tl.W; if(sctx.canvas.height!==tl.H) sctx.canvas.height=tl.H;
  drawClipSource(sctx,clip,localT,tl);
  /* …and then take out whatever the clip asked to have taken out of it. Here
     rather than in the compositor because a matte is a fact about the CLIP, not
     about the join: the single-clip path, the spine, the overlay lane and both
     exporters all come through this one function, so a keyed clip is keyed
     wherever it is drawn without four call sites having to remember. */
  applyMatteTo(sctx,tl.W,tl.H,clip); }
/** The clip's own picture, edge to edge, before anything is removed from it. */
function drawClipSource(sctx,clip,localT,tl){
  if(clip.kind==="graphic"){
    // Same cleared-buffer contract as a title, and the same free ride from the
    // compositor: transform, blend, opacity and every transition, unchanged.
    drawGraphicTo(sctx,tl.W,tl.H,makeGraphic(clip.rec),localT,clipLength(clip));
    return;
  }
  if(clip.kind==="title"){
    /* The one kind drawn onto a CLEARED buffer rather than a filled one, which
       is what makes it sit over the picture instead of replacing it. Everything
       downstream is unchanged: drawClipTo composites a canvas with alpha
       exactly as it composites an opaque one, so a title gets the clip
       transform, V2's blend and opacity, and every transition for free.
       `len` is passed because the animation is defined against the clip's own
       length — a title held for one second and one held for six run the same
       gesture at different speeds. */
    drawTitleTo(sctx,tl.W,tl.H,makeTitle(clip.rec),localT,clipLength(clip));
    return;
  }
  if(clip.kind==="still"){
    // A still has no time in it; the trim is only how long it is held.
    drawImageTo(sctx,tl.W,tl.H,{ ...readImageCfg(clip.rec), W:tl.W, H:tl.H });
    return;
  }
  const cfg=readVideoCfg(clip.rec); cfg.W=tl.W; cfg.H=tl.H; cfg.persist=0;
  /* Live footage plays in wall-clock time — drawVideoFit draws whatever frame
     the <video> is showing — so speed reaches it through the element's own rate
     rather than through the source time below. Set per draw because two clips
     cut from one file share a decoder and may run at different speeds; the one
     being drawn is the one that decides.
     Reverse cannot reach it at all: no browser supports a negative
     playbackRate. The panel says so on a footage clip rather than offering a
     control that does nothing. */
  if(cfg.scene==="videoin"){ const el=videoSource(clip.rec&&clip.rec["v-srckey"]);
    if(el){ try{ el.playbackRate=clipSpeed(clip); }catch(e){} } }
  // Phosphor persistence is forced off for a clip inside a sequence — the
  // buffer is shared, so a trail would bleed across a cut. A persist track
  // would put it straight back, so drop that one track for this render only.
  if(cfg.__auto && cfg.__auto["v-persist"]) cfg.__auto={...cfg.__auto, "v-persist":[]};
  _persistCanvas().width=tl.W; _persistCanvas().height=tl.H;
  renderVideoFrame(sctx,tl.W,tl.H,cfg,clamp(sourceTimeOf(clip,localT),0,cfg.duration)); }

/**
 * How visible an overlay clip is at `localT` seconds into itself.
 *
 * An overlay fades up AND down, which is where its transition differs from a
 * spine clip's. On V1 a transition is only about the way in, because the clip
 * before it is what you are coming FROM and it ends when this one starts. An
 * overlay is an insert over footage that keeps running underneath, so it has to
 * leave as deliberately as it arrived — otherwise every overlay ends on a hard
 * pop back to V1.
 *
 * The fade is capped at half the clip so a long dissolve on a short overlay
 * cannot start fading out before it has finished fading in.
 */
export function overlayAlpha(c,localT,len){
  let a=clamp(+c.opacity>=0?+c.opacity:1,0,1);
  if(c.transition==="cut") return a;
  const fade=Math.min(clamp(+c.xdur||0,0,MAX_CLIP),len/2);
  if(fade<=0) return a;
  if(localT<fade) a*=clamp(localT/fade,0,1);
  const left=len-localT;
  if(left<fade) a*=clamp(left/fade,0,1);
  return a;
}

/**
 * Put the composited clip on the frame, wherever the clip says it goes.
 *
 * The identity case is the SAME ONE LINE it has always been, and that is not an
 * optimisation — it is the guarantee that every sequence made before clips had
 * a position renders the same pixels. Only a clip that asked to be moved takes
 * the transform path.
 *
 * `ctx.transform()` rather than `setTransform()`: it multiplies with whatever is
 * already on the context, so this composes with any transform a caller has set
 * instead of silently discarding it.
 */
function drawClipTo(ctx,c,tl){
  const img=_tlA();
  if(isIdentity(c)){ ctx.drawImage(img,0,0,tl.W,tl.H); return; }
  ctx.save();
  /* Blowing a clip UP is the one case where the browser's default resampling is
     wrong for this tool: a bilinear 4× enlargement of a 240-line signal is a
     blurry photograph of a CRT, and the whole aesthetic is that the pixels are
     visible. Shrinking keeps the smoothing, because turning it off there trades
     a soft edge for a shimmering one as the clip moves. Part of the canvas state,
     so restore() puts it back. */
  if(c.scale>1) ctx.imageSmoothingEnabled=false;
  ctx.transform(...matrixFor(c,tl.W,tl.H));
  // Drawn centred on the origin, because that is the space matrixFor maps from.
  ctx.drawImage(img,-tl.W/2,-tl.H/2,tl.W,tl.H);
  ctx.restore();
}
export function renderTimelineFrame(ctx,T,sched){ const {clips,starts,tl}=sched; const sctx=_tlA().getContext("2d");
  ctx.fillStyle="#000"; ctx.fillRect(0,0,tl.W,tl.H);
  /* The spine's neighbours are its neighbours ON V1: a crossfade reads the clip
     it is dissolving from, and a dip is drawn from both sides of a join, so
     both have to skip over any overlay that happens to sit between them in the
     array. */
  const spine=[]; for(let i=0;i<clips.length;i++) if(!isOverlay(clips[i])) spine.push(i);
  /* Spans, not `s + len`: a clip holds the picture until the next one takes it.
     See spineSpans() — the schedule's rounding and a clip's speed-divided length
     disagree by up to 5ms, and the instant between them used to be covered by
     nothing at all, which is a black frame rather than a seam. */
  const spans=spineSpans(clips,starts);
  for(let p=0;p<spine.length;p++){ const i=spine[p]; const {len,s,e}=spans[p];
    if(!(T>=s-1e-6 && T<e+1e-6)) continue;
    const localT=clamp(T-s,0,len); renderClipTo(sctx,clips[i],localT,tl);
    /* A transition belongs to the clip coming IN, so it reads its own settings
       rather than one global rule for the whole sequence. `k` is how far
       through it we are, 0..1, and it is the same number for every overlapping
       kind — only what is DONE with it differs, which is video/transitions.js. */
    const c0=clips[i];
    let k=1;
    if(p>0 && overlaps(c0)){
      const ov=Math.min(c0.xdur,len,clipLength(clips[spine[p-1]]));
      if(ov>0 && T<s+ov) k=clamp((T-s)/ov,0,1); }
    /* A push shoves the OUTGOING picture off as the incoming one arrives, so
       this clip may have to draw itself displaced — by the next clip's push,
       seen from here. Exactly the look-ahead the dip below already does, and
       for the same reason: a join is a fact about two clips and only one of
       them is being drawn. */
    const nxt=clips[spine[p+1]];
    let off={dx:0,dy:0};
    if(nxt && nxt.transition==="push" && nxt.xdur>0){
      const ov=Math.min(nxt.xdur,len,clipLength(nxt));
      const left=len-localT;
      if(ov>0 && left<ov) off=pushOffset("push",nxt.xdir,clamp(1-left/ov,0,1),tl.W,tl.H);
    }
    const put=()=>{ if(off.dx||off.dy){ ctx.save(); ctx.translate(off.dx,off.dy); drawClipTo(ctx,c0,tl); ctx.restore(); }
                    else drawClipTo(ctx,c0,tl); };
    if(k>=1){ put(); }
    else if(!drawIncoming(ctx,tl.W,tl.H,c0.transition,c0.xdir,k,put,T)){
      // An unknown name — a project from a newer build — degrades to the
      // dissolve every transition can be, rather than to a blank frame.
      ctx.globalAlpha=k; put(); ctx.globalAlpha=1;
    }
    /* A flash transition does not overlap: it shows one clip, a colour, then
       the next. Drawn from BOTH sides of the join — this clip's own entry and
       the next clip's entry seen from here — which is what makes it
       symmetrical without either clip knowing about the other. */
    /* Bounded by the clips it sits between, like every other transition here —
       a 4s dip on a 1s clip used to wash the whole clip and never complete. See
       doc/timeline.js flashHalf. */
    let flash=0; let flashColour="#000000";
    if(p>0 && isFlash(clips[i].transition) && clips[i].xdur>0){
      const hd=flashHalf(clips[i].xdur,len,clipLength(clips[spine[p-1]]));
      if(hd>0 && localT<hd){ flash=Math.max(flash,1-localT/hd); flashColour=FLASH[clips[i].transition]; } }
    if(nxt && isFlash(nxt.transition) && nxt.xdur>0){
      const hd=flashHalf(nxt.xdur,len,clipLength(nxt)); const left=len-localT;
      if(hd>0 && left<hd && (1-left/hd)>=flash){ flash=1-left/hd; flashColour=FLASH[nxt.transition]; } }
    if(flash>0){
      const a=clamp(flash,0,1);
      const rgb=flashColour==="#000000"?"0,0,0":flashColour==="#ffffff"?"255,255,255":"255,217,160";
      ctx.fillStyle="rgba("+rgb+","+a+")"; ctx.fillRect(0,0,tl.W,tl.H);
      /* A film burn is a flare, not a wash: the paper catches, so the flash
         blooms brightest at the centre and the grain comes up with it. */
      if(flashColour!=="#000000" && flashColour!=="#ffffff"){
        const g=ctx.createRadialGradient(tl.W/2,tl.H/2,0,tl.W/2,tl.H/2,Math.hypot(tl.W,tl.H)/2);
        g.addColorStop(0,"rgba(255,255,240,"+(a*0.9)+")");
        g.addColorStop(1,"rgba(180,60,0,0)");
        ctx.fillStyle=g; ctx.fillRect(0,0,tl.W,tl.H);
      }
    } }

  /* Then the overlay track, over everything V1 just drew — its own dip
     included, because an overlay is above the whole of V1, not inside it.
     In array order, so two overlapping overlays stack predictably: the later
     one in the list is the higher one on screen. */
  for(let i=0;i<clips.length;i++){ const c=clips[i]; if(!isOverlay(c)) continue;
    const len=clipLength(c); const s=starts[i];
    if(!(T>=s-1e-6 && T<s+len+1e-6)) continue;
    const a=overlayAlpha(c,clamp(T-s,0,len),len);
    if(!(a>0.001)) continue;
    renderClipTo(sctx,c,clamp(T-s,0,len),tl);
    /* save/restore rather than resetting by hand: globalCompositeOperation is
       sticky, and a blend left set would tint every later draw on this context
       — including, on the export path, the next frame. */
    ctx.save();
    ctx.globalAlpha=a;
    /* The stored name IS the canvas operation — doc/layers.js has always kept
       its blend list that way, and this reuses it rather than translating. */
    ctx.globalCompositeOperation=c.blend||DEFAULT_BLEND;
    drawClipTo(ctx,c,tl);
    ctx.restore(); }
}
/** Every footage key this sequence needs, in clip order. */
export function footageKeys(sched){
  const out=[];
  for(const c of sched.clips){ const k=footageKeyOf(c); if(k) out.push(k); }
  return out;
}
/* A sequence uses footage when it has a videoin clip AND something to draw for
   it — either that clip's own source or the active slot for clips captured
   before per-clip footage existed. */
export function timelineUsesVideo(sched){
  const vids=sched.clips.filter(c=>c.kind!=="still"&&c.scene==="videoin");
  if(!vids.length) return false;
  return hasImportedVideo() || footageKeys(sched).length>0;
}
export function ensureTimelineVideo(sched,reset){ if(!timelineUsesVideo(sched))return;
  /* Every clip's own footage, not just the one slot: a sequence that cuts
     between two files has to have both playing, or the second clip draws
     whatever the first one left on screen. */
  const keys=footageKeys(sched);
  if(keys.length){ void primeVideoSources(keys); playVideoSources(keys,reset); }
  try{ if(_importedVideo){ if(reset)_importedVideo.currentTime=0; _importedVideo.play().catch(()=>{}); } }catch(e){} }
export let tlPreviewRAF=null, tlPlaying=true, tlScrubT=0, tlRecording=false;
/* Separate handle: the throttle schedules with setTimeout, which
   cancelAnimationFrame cannot clear. */
let tlPreviewTimer=null;
/* Roughly a frame at 60Hz — see the note in video/capture.js. */
const TL_FRAME_BUDGET_MS = 24;
export function initTimelineTab(){
  // timeline
  if($("tl-add")) $("tl-add").addEventListener("click", addTimelineClip);
  if($("tl-clear")) $("tl-clear").addEventListener("click", clearTimeline);
  if($("tl-record")) $("tl-record").addEventListener("click", recordTimeline);
  if($("tl-stop")) $("tl-stop").addEventListener("click", ()=>{ tlRecording=false; });
  /* The play button is also the GESTURE that unblocks audio. A browser will not
     start a context that nobody asked for, and this is the click that asks —
     see audio/preview.js on why a suspended context is worse than silence. */
  if($("tl-playpause")) $("tl-playpause").addEventListener("click", async ()=>{ tlPlaying=!tlPlaying; $("tl-playpause").textContent=tlPlaying?"▮▮":"▶";
    if(!tlPlaying){ haltPreviewSound(); return; }
    await armSequenceAudio(); void armPreviewSound(buildSchedule()); });
  /* Painted BEFORE the arming, not after. Unblocking a context is asynchronous,
     and a button that only says what it did once the hardware answers is a
     button that looks broken for as long as that takes. */
  if($("tl-sound")) $("tl-sound").addEventListener("click", async ()=>{
    const on=setPreviewSound(!previewSoundOn());
    paintSoundButton();
    if(!on) return;
    await armSequenceAudio();
    void armPreviewSound(buildSchedule()); });
  paintSoundButton();
  /* A hidden tab still has speakers. requestAnimationFrame stops, so the picture
     is already paused; without this the sound would carry on alone. */
  if(typeof document!=="undefined") document.addEventListener("visibilitychange",()=>{
    if(document.hidden) haltPreviewSound();
    else if(timelineVisible() && tlPlaying) void armPreviewSound(buildSchedule()); });
  if($("tl-scrub")) $("tl-scrub").addEventListener("input", ()=>{ tlPlaying=false; $("tl-playpause").textContent="▶"; haltPreviewSound(); const s=buildSchedule(); tlScrubT=($("tl-scrub").value/1000)*s.total; });
  if($("tl-still")) $("tl-still").addEventListener("click", ()=>addStillClip(num("tl-stilldur",3)));
  if($("tl-title")) $("tl-title").addEventListener("click", ()=>addTitleClip(tlScrubT));
  if($("tl-shape")) $("tl-shape").addEventListener("click", ()=>addGraphicClip(tlScrubT));
  fillContainerSelect($("tl-container"));
  initBedSelect("tl-audio");
  initTrack({
    clips:()=>timeline,
    audio:()=>audioTimeline,
    schedule:()=>{ const s=buildSchedule(); return { starts:s.starts, duration:s.duration }; },
    edit:(i,patch,label,opts)=>editClip(i,patch,label,opts),
    editAudio:(i,patch,label,opts)=>editAudioClip(i,patch,label,opts),
    thumb:(c)=>waveThumb(c),
    // Snapping asks this: a moving playhead is not a target (see ui/track.js).
    playing:()=>tlPlaying,
    move:(from,to,opts)=>{ const next=timeline.slice(); const [c]=next.splice(from,1); next.splice(to,0,c); commitClips(next,"reorder clips",opts); },
    // The pointer came up: one preview restart for the whole drag.
    settle:()=>startTimelinePreview(),
  });
  if($("tl-addaudio")) $("tl-addaudio").addEventListener("click", ()=>addAudioClip());
  initBedSelect("tl-asrc");
  initFootageSelect();
  /* After initTrack, so #tl-track exists to wire. */
  initLaneDrop();
  initMonitor();
  /* Decoded audio and its waveform thumbnails are cached by library KEY — and
     replaceItem() deliberately reuses a key when it supersedes a take nobody has
     shown interest in. So a second RENDER of a bed writes new bytes under the
     old key, and without this both caches would go on serving the previous
     take: the lane would draw the old waveform and, worse, the EXPORT would
     carry the old sound, with nothing to indicate it. */
  onLibraryChange(()=>{ invalidateBedCache(); invalidatePreviewMix(); clearWaveThumbs(); renderTrack(); });
  initSizing({ format:"tl-format", aspect:"tl-aspect", w:"tl-w", h:"tl-h", after:startTimelinePreview });
  wireLive("view-timeline",()=>{ syncFormat({ format:"tl-format", w:"tl-w", h:"tl-h" });
    if(document.querySelector(".tab.active").dataset.view==="timeline") startTimelinePreview(); });
}
/* Sound stops with the picture, from the ONE place that stops the picture.
   Every path that must go quiet already comes through here — leaving the tab
   (ui/shell.js), starting either export, and the restart at the top of
   startTimelinePreview — so there is no fourth place to forget. */
export function stopTimelinePreview(){ if(tlPreviewRAF){ cancelAnimationFrame(tlPreviewRAF); tlPreviewRAF=null; }
  if(tlPreviewTimer){ clearTimeout(tlPreviewTimer); tlPreviewTimer=null; }
  haltPreviewSound(); }
function timelineVisible(){ const v=$("view-timeline"); return !v || v.classList.contains("active"); }
export function startTimelinePreview(){ stopTimelinePreview(); if(!timelineVisible())return; const c=$("tlcanvas"); if(!c)return; const sched=buildSchedule(); const tl=sched.tl;
  c.width=tl.W; c.height=tl.H; const ctx=c.getContext("2d"); _tlA().width=tl.W; _tlA().height=tl.H; updateTimelineInfo(sched);
  if(!sched.clips.length){ ctx.fillStyle="#07090c"; ctx.fillRect(0,0,tl.W,tl.H); setFont(ctx,Math.max(11,tl.H*0.05)); ctx.fillStyle="#5f7d78";
    ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("Add scenes from the VIDEO tab",tl.W/2,tl.H/2); ctx.textAlign="left"; ctx.textBaseline="top"; return; }
  ensureTimelineVideo(sched,false); const start=performance.now();
  _tlClock=()=>((performance.now()-start)/1000)%sched.total;
  void armPreviewSound(sched);
  // Same frame-grid quantisation as the single-clip preview: redraw when the
  // sequence's frame index changes, not on every display refresh. A sequence
  // composites a whole clip per frame, so the saving is larger here.
  let lastFrame=-1, cooldown=0;
  /* The sound is the clock whenever there IS sound — see audio/preview.js. Wall
     time is the fallback, not the default: two clocks that both claim to say
     where the sequence is drift apart, and the one the speakers are using is
     the one the author can hear. */
  (function loop(){ let T; if(tlPlaying){ const aT=sequenceAudioTime(); T=aT!=null?aT:((performance.now()-start)/1000)%sched.total; tlScrubT=T; if($("tl-scrub"))$("tl-scrub").value=Math.round(T/sched.total*1000);   /* dom-only: playhead readout, written every frame */ } else T=tlScrubT;
    const fps=tl.fps||12, frame=Math.round(T*fps);
    if(frame!==lastFrame){
      lastFrame=frame;
      const qT=frame/fps;
      const t0=performance.now();
      renderTimelineFrame(ctx,qT,sched);
      /* AFTER the frame, and only here. The offline encoder and the real-time
         recorder both call renderTimelineFrame themselves and never come
         through this loop, so a handle cannot reach an export — ruled out by
         where the call sits rather than by remembering to clear a flag. */
      paintMonitorOverlay(ctx,sched);
      if($("tl-time"))$("tl-time").textContent=qT.toFixed(1)+"s";
      paintPlayhead(qT,sched.total);
      // Yield in proportion to the cost, exactly as the clip preview does: a
      // sequence frame renders a whole clip plus its filter chain, so this is
      // the loop most able to lock the interface up.
      const cost=performance.now()-t0;
      cooldown = cost > TL_FRAME_BUDGET_MS ? Math.min(500, Math.round(cost * 1.2)) : 0;
    }
    if(cooldown>0) tlPreviewTimer=setTimeout(()=>{ tlPreviewTimer=null; tlPreviewRAF=requestAnimationFrame(loop); }, cooldown);
    else tlPreviewRAF=requestAnimationFrame(loop); })(); }
export function updateTimelineInfo(sched){ if($("tl-info"))$("tl-info").textContent=sched.clips.length+" clip(s) · "+(sched.duration??sched.total).toFixed(1)+"s · "+sched.tl.W+"×"+sched.tl.H;
  renderTrack();
  if($("tl-count"))$("tl-count").textContent=sched.clips.length?sched.clips.length+"":""; }
/* The table is the precise, keyboard-reachable half of the editor; the track
   above it is the direct-manipulation half. Both write the same clips, so an
   author can drag an edge or type the number, whichever they trust more. */
/* The per-clip sound picker, built inline rather than through
   ui/audiobed.js's registry: that registry keys pickers by control id and
   refills them on every library change, and these ids are positional — a row
   removed would leave a dead id refilling forever. The options are the same
   list, from the same source. */
/** The sound choices for one clip, as data. Shared with ui/inspector.js. */
export function bedOptionList(current){
  const opts=[{ v:BED_NONE, t:'— none —' }];
  if(lastAudio && lastAudio.channels && lastAudio.channels.length){
    opts.push({ v:BED_LAST, t:'Last audio render' });
  }
  for(const it of bedCandidates()) opts.push({ v:LIB_PREFIX+it.key, t:it.name+'.'+it.ext });
  // A stored choice whose asset has not come back yet is kept as an option, or
  // a <select> would silently drop it and the next edit would save the loss.
  if(current && !opts.some(o=>o.v===current)) opts.push({ v:current, t:'saved (not loaded)' });
  return opts;
}
function bedOptions(i,current){
  const opts=bedOptionList(current);
  return '<select data-i="'+i+'" data-k="bed" aria-label="Clip '+(i+1)+' sound">'
    +opts.map(o=>'<option value="'+escHtml(o.v)+'"'+(o.v===current?' selected':'')+'>'+escHtml(o.t)+'</option>').join('')
    +'</select>';
}

export function renderTimelineTable(){ const b=$("tl-body"); if(!b)return; b.replaceChildren();
  if(!timeline.length){ b.innerHTML='<tr><td colspan="7" class="hint">No clips yet — build a look on VIDEO then “＋ SCENE”, or a screen on SCREEN then “＋ STILL”.</td></tr>'; if($("tl-count"))$("tl-count").textContent=""; return; }
  timeline.forEach((c,i)=>{ const tr=document.createElement("tr");
    const len=clipLength(c);
    tr.innerHTML='<td>'+(i+1)+'</td>'
      +'<td>'+(isOverlay(c)?'<span class="pill">V2</span> ':'')
             +(c.kind==="still"?'<span class="pill">still</span> ':'')+escHtml(c.label)+'</td>'
      /* An overlay always has a transition worth setting — it fades up against
         whatever V1 is showing — so the "nothing to come in from" dash belongs
         to the first clip of the SPINE, not to array slot zero. */
      +'<td>'+(!isOverlay(c)&&isFirstOnTrack(timeline,i)?'<span class="hint">—</span>'
          :'<select data-i="'+i+'" data-k="transition" aria-label="Clip '+(i+1)+' transition">'
           +TRANSITIONS.map(t=>'<option'+(t===c.transition?' selected':'')+'>'+t+'</option>').join('')
           +'</select>')+'</td>'
      +'<td><input type="number" data-i="'+i+'" data-k="in" value="'+c.in.toFixed(2)+'" min="0" max="'+c.src+'" step="0.05" style="width:5em" aria-label="Clip '+(i+1)+' in point"></td>'
      +'<td><input type="number" data-i="'+i+'" data-k="out" value="'+c.out.toFixed(2)+'" min="0" max="'+c.src+'" step="0.05" style="width:5em" aria-label="Clip '+(i+1)+' out point"></td>'
      +'<td>'+len.toFixed(2)+'s'+(isTrimmed(c)?' <span class="hint">of '+c.src.toFixed(1)+'</span>':'')+'</td>'
      +'<td>'+bedOptions(i,c.bed)+'</td>'
      +'<td><button class="btn small" data-i="'+i+'" data-act="up"'+(i===0?" disabled":"")+' aria-label="Move clip '+(i+1)+' earlier">↑</button> '
        +'<button class="btn small" data-i="'+i+'" data-act="dn"'+(i===timeline.length-1?" disabled":"")+' aria-label="Move clip '+(i+1)+' later">↓</button> '
        +'<button class="btn small" data-i="'+i+'" data-act="rm" aria-label="Remove clip '+(i+1)+'">✕</button></td>';
    b.appendChild(tr); });
  b.querySelectorAll("button").forEach(bt=>bt.addEventListener("click",()=>{ const i=+bt.dataset.i, a=bt.dataset.act;
    const next=timeline.slice();
    if(a==="up"&&i>0){ [next[i-1],next[i]]=[next[i],next[i-1]]; }
    else if(a==="dn"&&i<next.length-1){ [next[i+1],next[i]]=[next[i],next[i+1]]; }
    else if(a==="rm"){ next.splice(i,1); }
    else return;
    commitClips(next,a==="rm"?"remove clip":"reorder clips"); }));
  b.querySelectorAll("input,select").forEach(el=>el.addEventListener("change",()=>{
    const i=+el.dataset.i, k=el.dataset.k; const c=timeline[i]; if(!c)return;
    const v=(k==="transition"||k==="bed")?el.value:+el.value;
    /* A backwards trim is REFUSED, not absorbed. makeClip's fallback for one is
       "the whole source is the honest reading" — which is right for a
       hand-edited file and destructive here: typing 1 into Out on a clip
       trimmed to 2–8 threw the author's whole trim away and reset the clip to
       its full length, silently. Put the box back to what is stored and say
       why; the edit they meant is one keystroke away, the trim they had is not
       recoverable if we accept this one. */
    if((k==="in"||k==="out") && Number.isFinite(v)){
      const inn=k==="in"?v:c.in, out=k==="out"?v:c.out;
      if(!(out-inn>=MIN_CLIP)){
        el.value=(k==="in"?c.in:c.out).toFixed(2);   /* dom-only: this cell is redrawn from the document, not bound to it, and dispatching would re-enter this handler */
        toast("Out must be at least "+MIN_CLIP+"s after In","warn");
        log("Clip "+(i+1)+": in "+inn.toFixed(2)+" / out "+out.toFixed(2)
            +" would leave nothing to play — trim unchanged.","warn");
        return;
      }
    }
    editClip(i,{ [k]: v }, "clip "+k); })); }

/**
 * Where the playhead is INSIDE the selected clip's source, or null.
 *
 * A clip's curves are in source seconds — renderClipTo evaluates at
 * `clip.in + localT` — so keying at "seconds into the clip" or at the sequence
 * playhead puts the key in the wrong place on every trimmed clip. Returning
 * null when the playhead is not over the clip is what lets the panel refuse
 * rather than guess.
 */
export function clipSourceTime(i){
  const c=timeline[i]; if(!c) return null;
  const s=buildSchedule(); const start=s.starts[i]; const len=clipLength(c);
  if(!(tlScrubT>=start-1e-6 && tlScrubT<start+len+1e-6)) return null;
  const dur=clamp(Number(readVideoCfg(c.rec).duration)||0,1,60);
  /* Through the same function the renderer uses. A key placed at "seconds into
     the clip" would land at a different source time than the frame on screen
     the moment a clip is not playing at 1×, and on a reversed clip it would
     land at the wrong END. */
  return Math.round(clamp(sourceTimeOf(c,tlScrubT-start),0,dur)*100)/100;
}

/**
 * The colour of clip `i` at an OUTPUT-space point, or null.
 *
 * The eyedropper. Three decisions in here are the whole of it:
 *
 * It renders the clip with its MATTE FORCED OFF. Sampling the finished frame
 * would be sampling whatever is on the monitor — the shot underneath a keyed
 * hole, the blurred version of a face, the darkened half of a spotlight — and
 * the one thing an author does when a key is nearly right is click a bit of
 * screen that is still showing to widen it. Off a keyed picture that pixel is
 * already gone, so re-picking would read the clip beneath and set the key to
 * it. Off the source it is the green they meant.
 *
 * It samples the CLIP's own buffer, through the inverse of the clip transform,
 * because that is the space the key is applied in. Reading the frame directly
 * would be right only for a clip that fills it, and silently wrong — by exactly
 * the scale factor — for every inset.
 *
 * And it averages a small box rather than taking one pixel. A green screen in
 * a compressed delivery is not one green; a single pixel can be a chroma-
 * subsampled outlier, and keying to an outlier leaves speckles the author then
 * blames on the tolerance.
 */
export function sampleClipColour(i,qx,qy,radius=2){
  const c=timeline[i]; if(!c) return null;
  const s=buildSchedule(); const tl=s.tl;
  const start=Number(s.starts?.[i])||0; const len=clipLength(c);
  if(!(tlScrubT>=start-1e-6 && tlScrubT<start+len+1e-6)) return null;
  const b=invertPoint(c,tl.W,tl.H,qx,qy);
  // invertPoint answers in CENTRED buffer coordinates; the pixels are indexed
  // from the top left.
  const cx=Math.round(b.x+tl.W/2), cy=Math.round(b.y+tl.H/2);
  if(!(cx>=0 && cy>=0 && cx<tl.W && cy<tl.H)) return null;
  const sctx=_tlA().getContext("2d",{ willReadFrequently:true });
  renderClipTo(sctx,{ ...c, keyMode:"off", maskShape:"none" },clamp(tlScrubT-start,0,len),tl);
  const x0=Math.max(0,cx-radius), y0=Math.max(0,cy-radius);
  const x1=Math.min(tl.W-1,cx+radius), y1=Math.min(tl.H-1,cy+radius);
  const d=sctx.getImageData(x0,y0,x1-x0+1,y1-y0+1).data;
  let r=0,g=0,bl=0,n=0;
  for(let p=0;p<d.length;p+=4){
    // A transparent pixel has no colour to contribute — on a title or a shape
    // most of the buffer is transparent, and averaging its zeroes in would
    // drag every sample towards black.
    if(d[p+3]===0) continue;
    r+=d[p]; g+=d[p+1]; bl+=d[p+2]; n++;
  }
  if(!n) return null;
  const hex=(v)=>Math.round(v/n).toString(16).padStart(2,"0");
  return "#"+hex(r)+hex(g)+hex(bl);
}

/** Change one field of one clip. Normalisation keeps the trim sane. */
export function editClip(i,patch,label,opts){
  if(!timeline[i]) return;
  const next=timeline.slice();
  next[i]={ ...next[i], ...patch };
  commitClips(next,label||"edit clip",opts);
}
/* Offline sequence export — the same WebCodecs path the single-clip exporter
   uses. This is where it matters most: a sequence is the longest thing the
   studio produces, so real-time capture taxed it hardest.

   Returns false when it can't run, so the caller drops to the recorder. */
async function recordTimelineFast(sched){
  if(timelineUsesVideo(sched)) return false;      // a <video> only advances in wall-clock time
  /* Same gate as the single-clip exporter: check the container the author
     picked, accepting WebM as the degrade target encodeClip falls to itself. */
  const container=val("tl-container")||"webm";
  let support=await encoderSupport(sched.tl.W, sched.tl.H, container);
  if(!support.available && container==="mp4") support=await encoderSupport(sched.tl.W, sched.tl.H, "webm");
  if(!support.available){ log("Fast export unavailable: "+support.reason+" — using real-time capture.","warn"); return false; }

  // Encoders want even dimensions; render the composite at those so the frame
  // is filled edge to edge rather than leaving a black column.
  const tl={ ...sched.tl, W:sched.tl.W+(sched.tl.W%2), H:sched.tl.H+(sched.tl.H%2) };
  const s={ ...sched, tl };
  _tlA().width=tl.W; _tlA().height=tl.H;
  const frames=Math.max(1, Math.round(s.total*tl.fps));

  stopTimelinePreview(); tlRecording=true;
  $("tl-record").disabled=true; $("tl-stop").disabled=false; $("tl-progress-wrap").style.display="block";
  log("Exporting "+s.total.toFixed(1)+"s sequence @ "+tl.fps+"fps "+tl.W+"×"+tl.H+" via WebCodecs ("+support.label+")…","info");

  let bed=null;
  try{
    /* Per-clip beds sit at the time their clip starts, over the sequence's own.
       Start times come from the schedule, so a trim or a crossfade moves the
       sound with the picture rather than leaving it where it was. */
    bed=await sequenceMix(s);
  }
  catch(e){ log("Audio bed failed ("+e.message+") — exporting silent.","warn"); }

  let res=null, err=null;
  try{
    res=await encodeClip({
      width:tl.W, height:tl.H, fps:tl.fps, frames,
      audioBuffer: bed, container, log,
      drawFrame:(ctx,T)=>renderTimelineFrame(ctx,Math.min(T,s.total),s),
      onProgress:(p)=>{ $("tl-progress").style.width=(p*100)+"%";
        $("tl-status").textContent="Exporting… "+Math.round(p*100)+"%"; },
      cancelled:()=>!tlRecording,
    });
  }catch(e){ err=e; }

  $("tl-progress-wrap").style.display="none";
  tlRecording=false; $("tl-record").disabled=false; $("tl-stop").disabled=true;

  // Same contract as the single-clip exporter: a cancelled export is discarded
  // rather than saved as a short sequence, and counts as handled so the caller
  // does not start the real-time recorder the author just stopped.
  if(res && res.cancelled){
    $("tl-status").textContent="Export cancelled — nothing saved.";
    log("Sequence export cancelled at "+res.frames+" frame(s) — discarded.","warn");
    toast("Export cancelled","warn");
    startTimelinePreview();
    return true;
  }
  if(err || !res){
    if(err) log("Fast export failed ("+err.message+") — falling back to real-time capture.","warn");
    startTimelinePreview();
    return false;
  }
  const speed=(s.total*1000)/Math.max(1,res.ms);
  $("tl-status").textContent="Exported "+(res.blob.size/1024).toFixed(0)+" KB in "+(res.ms/1000).toFixed(1)+"s ("+speed.toFixed(1)+"× real time).";
  const sound = res.audio ? " · "+(res.audio.channels>1?"stereo":"mono")+" audio" : res.audioRequested ? " · NO AUDIO (encoder unavailable)" : "";
  log("Exported sequence: "+res.frames+" frames, "+(res.blob.size/1024).toFixed(0)+" KB "+res.label+sound+", "+s.clips.length+" clips in "+res.ms+"ms ("+speed.toFixed(1)+"× real time)",res.audioRequested&&!res.audio?"warn":"ok");
  toast("Sequence → library ("+speed.toFixed(1)+"× real time)","info");
  addToLibrary(res.blob,res.ext||"webm","videos","sequence",s.total);
  startTimelinePreview();
  return true;
}

export async function recordTimeline(){ if(tlRecording)return; if(!timeline.length){ toast("Add clips first","err"); return; }
  if(!claimExport("Sequence export"))return;
  // Claimed before the first await — see recordVideo(); two clicks in one tick
  // otherwise started two encoders over the same scratch canvas. Held across
  // the WHOLE function: the fallback awaits the sequence bed before its
  // recorder starts, and a click in that gap would start a second recorder.
  tlRecording=true;
  let armed=false;   // once the recorder is live, finish() owns the flag + token
  try{
  if(await recordTimelineFast(buildSchedule())) return;
  tlRecording=true;   // the fast path's failure exit cleared it
  const c=$("tlcanvas"); if(!(window.MediaRecorder && c && "captureStream" in c)){ log("Video capture unavailable here.","err"); toast("Capture not supported","err"); return; }
  const sched=buildSchedule(); const tl=sched.tl; c.width=tl.W; c.height=tl.H; const ctx=c.getContext("2d"); _tlA().width=tl.W; _tlA().height=tl.H;
  const stream=c.captureStream(tl.fps);
  /* Same wiring as the single-clip fallback in capture.js: a canvas stream
     carries no sound, so the sequence bed and the per-clip beds are played
     into a MediaStreamDestination and their track added to the stream. This
     path used to record the canvas only — every authored bed silently dropped
     and the export still announced success. */
  let bedCtx=null;
  try{
    const bed=await sequenceMix(sched);
    if(bed){ const AC=window.AudioContext||window.webkitAudioContext;
      if(AC){ bedCtx=new AC(); const dest=bedCtx.createMediaStreamDestination();
        const src=bedCtx.createBufferSource(); src.buffer=bed; src.connect(dest); src.start();
        const tr=dest.stream.getAudioTracks()[0]; if(tr) stream.addTrack(tr); } }
  }catch(e){ log("Audio bed failed ("+e.message+") — recording silent.","warn"); }
  const hasAudio=stream.getAudioTracks().length>0;
  const mime=bestMime(val("v-codec"),hasAudio); let opts={}; if(mime)opts.mimeType=mime;
  let rec; try{ rec=new MediaRecorder(stream,opts); }catch(e){ try{ rec=new MediaRecorder(stream); }catch(e2){ log("MediaRecorder init failed: "+e2.message,"err"); return; } }
  const chunks=[]; rec.ondataavailable=e=>{ if(e.data&&e.data.size)chunks.push(e.data); };
  stopTimelinePreview(); tlRecording=true; $("tl-record").disabled=true; $("tl-stop").disabled=false; $("tl-progress-wrap").style.display="block";
  /* STOP discards and an error is an error — same contract as the offline
     exporter; see recordVideo()'s finish(). */
  let endReason="done";
  let done=false; const finish=()=>{ if(done)return; done=true; try{ stream.getTracks().forEach(tr=>tr.stop()); }catch(e){}
    try{ bedCtx&&bedCtx.close(); }catch(e){}
    $("tl-progress-wrap").style.display="none";
    tlRecording=false; releaseExport(); $("tl-record").disabled=false; $("tl-stop").disabled=true;
    if(endReason!=="done"){
      const stopped=endReason==="stopped";
      $("tl-status").textContent=stopped?"Recording cancelled — nothing saved.":"Recorder failed — nothing saved.";
      log(stopped?"Sequence recording cancelled — partial clip discarded.":"Recorder failed ("+endReason+") — partial sequence discarded.",stopped?"warn":"err");
      toast(stopped?"Recording cancelled":"Recording failed",stopped?"warn":"err");
      startTimelinePreview(); return;
    }
    const actual=rec.mimeType||mime||"video/webm"; const isMp4=actual.indexOf("video/mp4")===0;
    const blob=new Blob(chunks,{type:isMp4?"video/mp4":"video/webm"}); const ext=isMp4?"mp4":"webm";
    $("tl-status").textContent="Recorded "+(blob.size/1024).toFixed(0)+" KB "+ext+".";
    log("Recorded sequence: "+(blob.size/1024).toFixed(0)+" KB ("+actual+")"+(hasAudio?" with audio":"")+", "+sched.clips.length+" clips","ok"); toast("Sequence → library","info");
    addToLibrary(blob,ext,"videos","sequence",sched.total);
    startTimelinePreview(); };
  rec.onstop=finish; rec.onerror=(e)=>{ endReason=(e&&e.error&&e.error.message)||"MediaRecorder error"; finish(); }; rec.start();
  armed=true;
  ensureTimelineVideo(sched,true);
  log("Recording "+sched.total.toFixed(1)+"s sequence @ "+tl.fps+"fps "+tl.W+"×"+tl.H+(hasAudio?" + audio bed":"")+"...","info"); const start=performance.now();
  // `done` bail: see recordVideo() — a finish() driven by onerror must not be
  // overwritten by the already-scheduled frame.
  const step=()=>{ if(done)return; const T=(performance.now()-start)/1000; renderTimelineFrame(ctx,Math.min(T,sched.total),sched);
    const p=clamp(T/sched.total,0,1); $("tl-progress").style.width=(p*100)+"%"; $("tl-status").textContent="Recording... "+T.toFixed(1)+"/"+sched.total.toFixed(1)+"s";
    if(T>=sched.total || !tlRecording){ if(T<sched.total && !tlRecording) endReason="stopped"; try{rec.stop();}catch(e){finish();} return; } requestAnimationFrame(step); };
  requestAnimationFrame(step);
  } finally { if(!armed){ tlRecording=false; releaseExport(); } } }
/* ============================================================================
   AUDIO — layers + master FX bus + metering + WAV
   ========================================================================== */
