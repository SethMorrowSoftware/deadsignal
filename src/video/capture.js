/* Dead Signal Studio — video/capture.js */
import { CONTAINERS, encodeClip, encoderSupport, fillContainerSelect } from '../export/encoder.js';
import { sampleFlash, paintFlash, resetFlashMeter } from '../ui/flashmeter.js';
import { download } from '../core/blobs.js';
import { $, clamp, log, num, setVal, toast, val } from '../core/dom.js';
import { applyPalette } from '../core/palettes.js';
import { saveUserPreset } from '../core/recipes.js';
import { addToLibrary, slug } from '../library/library.js';
import { footageFor, hasFootageFor, loadImageFile, loadVideoFile, seekVideo } from '../media/import.js';
import { loadPreset } from '../presets/index.js';
import { prepareBed } from '../audio/bed.js';
import { initAudioBed } from '../ui/audiobed.js';
import { validateVideo, wireLive } from '../ui/shell.js';
import { initSizing, scaleNumControl, syncFormat } from '../ui/sizing.js';
import { scaleFilterChainPx } from './filters.js';
import { exportGif, exportAPNG, exportAnimWebP } from './gif.js';
import { _persistCanvas, readVideoCfg, renderScaled } from './render.js';
import { ensureVideoSource } from './sources.js';

export let vPreviewRAF=null, vPlaying=true, vScrubT=0, vRecording=false;
/* Held separately from vPreviewRAF because the throttle schedules with
   setTimeout, and cancelAnimationFrame will not clear a timeout id. */
let vPreviewTimer=null;
/* Tab wiring lives beside the state it mutates. vPlaying / vScrubT /
   vRecording (and the tl* equivalents) are module-local, and an ES module
   cannot assign to an imported binding — so these handlers must be defined in
   the module that owns the variables, not in boot(). */
export function initVideoTab(){
  fillContainerSelect($("v-container"));
  // video
  $("v-preset").addEventListener("change", ()=>loadPreset("video","view-video"));
  $("v-palette").addEventListener("change", ()=>{ applyPalette($("v-palette"),"v-bg","v-fg"); startVideoPreview(); });
  /* A change of delivery format carries the look with it. The type size and the
     chain's pixel-denominated parameters are measured in pixels, so switching
     320x240 to 1080p without them would render the same recipe at a sixth of
     the relative strength — the grain, the blur and the displacement all
     quietly shrinking to nothing. See doc/filters.js scaleFilterPx. */
  initSizing({ format:"v-format", aspect:"v-aspect", w:"v-w", h:"v-h", after:startVideoPreview,
    onResize:(f)=>{ scaleNumControl("v-font", f); scaleFilterChainPx(f); } });
  initAudioBed();
  $("v-record").addEventListener("click", recordVideo); $("v-stop").addEventListener("click", ()=>{ vRecording=false; cancelStillExport(); });
  $("v-playpause").addEventListener("click", ()=>{ vPlaying=!vPlaying; $("v-playpause").textContent=vPlaying?"▮▮":"▶"; });
  $("v-scrub").addEventListener("input", ()=>{ vPlaying=false; $("v-playpause").textContent="▶"; const cfg=readVideoCfg(); vScrubT=($("v-scrub").value/1000)*cfg.duration; });
  $("v-grab").addEventListener("click", ()=>{ const c=$("vcanvas"); c.toBlob(b=>{ if(b){ addToLibrary(b,"png","image",slug(val("v-hud")||val("v-scene")||"frame")); toast("Still → library"); } },"image/png"); });
  $("v-savepreset").addEventListener("click", ()=>saveUserPreset("video","view-video"));
  if($("v-gif")) $("v-gif").addEventListener("click", exportGif); if($("v-strip")) $("v-strip").addEventListener("click", exportFrameStrip);
  if($("v-apng")) $("v-apng").addEventListener("click", exportAPNG);
  if($("v-awebp")) $("v-awebp").addEventListener("click", exportAnimWebP);
  if($("v-loadimg")){ $("v-loadimg").addEventListener("click", ()=>$("v-imgfile").click()); $("v-imgfile").addEventListener("change", e=>loadImageFile(e.target.files[0],()=>{ setVal("v-scene","kenburns"); startVideoPreview(); })); }
  if($("v-loadvid")){ $("v-loadvid").addEventListener("click", ()=>$("v-vidfile").click()); $("v-vidfile").addEventListener("change", e=>loadVideoFile(e.target.files[0],()=>{ setVal("v-scene","videoin"); startVideoPreview(); })); }
  wireLive("view-video",()=>{ syncFormat({ format:"v-format", w:"v-w", h:"v-h" }); startVideoPreview(); validateVideo(); });
}
export function stopVideoPreview(){ if(vPreviewRAF){ cancelAnimationFrame(vPreviewRAF); vPreviewRAF=null; }
  if(vPreviewTimer){ clearTimeout(vPreviewTimer); vPreviewTimer=null; } }
/* Only the visible tab previews. This is not just about wasted frames: the
   video and timeline loops share scratch canvases (_persistCanvas, _ss), and
   resizing a canvas clears it — so two loops running at once wipe each other's
   buffers every frame. wireLive() and the document's onExternalChange (undo,
   redo, project load) both call this regardless of which tab is showing, which
   is how both loops ended up alive at the same time. */
function videoVisible(){ const v=$("view-video"); return !v || v.classList.contains("active"); }
export function startVideoPreview(){ stopVideoPreview(); if(!videoVisible())return; resetFlashMeter(); const c=$("vcanvas"); if(!c)return; const cfg=readVideoCfg(); c.width=cfg.W; c.height=cfg.H; const ctx=c.getContext("2d");
  _persistCanvas().width=cfg.W; _persistCanvas().height=cfg.H; const start=performance.now(); updateVideoEst(cfg);
  /* Render on the CLIP's frame grid, not on the display's.
   *
   * The loop used to redraw on every animation frame — about 60 times a second
   * for a clip that exports at 12fps. Four fifths of that work was thrown away,
   * and what it bought was worse than nothing: continuous scenes moved more
   * smoothly in the preview than they ever would in the file, so the preview
   * was showing something the export could not produce.
   *
   * Quantising to the frame index fixes both. It is also what makes a heavy
   * filter chain usable: at 12fps the main thread does a fifth of the work, so
   * the sliders keep responding while the picture is being ground out. */
  let lastFrame=-1, cooldown=0, throttled=false;
  (function loop(){ let t; if(vPlaying){ t=((performance.now()-start)/1000)%cfg.duration; vScrubT=t; if($("v-scrub"))$("v-scrub").value=Math.round(t/cfg.duration*1000);   /* dom-only: playhead readout, written every frame — this reports the preview position, it is not a setting */ }
    else t=vScrubT;
    const fps=cfg.fps||12, frame=Math.round(t*fps);
    if(frame!==lastFrame){
      lastFrame=frame;
      const qt=frame/fps;                       // the exact instant the export will encode
      const t0=performance.now();
      renderScaled(ctx,cfg.W,cfg.H,cfg,qt); if($("v-time"))$("v-time").textContent=qt.toFixed(1)+"s";
      // Photosensitivity measurement runs on the frames actually shown, so it
      // catches a blink code, a fade and a scene cut landing together — which no
      // amount of reading the recipe would reveal.
      const nowMs=performance.now();
      /* The readout repaints quietly; crossing the WCAG limit is announced once,
         through the log and one toast. See paintFlash. */
      sampleFlash(c, nowMs); paintFlash($("v-flash"), nowMs, (risky,hz)=>{
        if(risky){ log("Flash rate "+hz.toFixed(1)+"/s — above the WCAG 2.3.1 limit of 3/s. This clip may trigger seizures.","warn");
          toast("Flash rate above the WCAG limit","warn"); }
        else log("Flash rate back under the WCAG limit ("+hz.toFixed(1)+"/s).","info");
      });
      /* Yield in proportion to what the frame cost.
       *
       * A frame is synchronous main-thread work, and a filter chain at a large
       * output size can cost a quarter of a second of it. Scheduled straight
       * back onto rAF that leaves no gap at all between blocks, so the whole
       * tool locks up — typing one word into the Browser took six seconds, and
       * the honest description of that is "it froze".
       *
       * The preview is the thing that should give way, not the interface. Above
       * the budget the next frame is deferred by the overrun, which hands the
       * main thread real idle time: the picture updates less often, and the
       * sliders, sidebar and tabs keep responding. The EXPORT is untouched — it
       * renders every frame at full cost, which is what it is for. */
      const cost=performance.now()-t0;
      const first=_frameMs===0;
      _frameMs=cost;
      cooldown = cost > FRAME_BUDGET_MS ? Math.min(500, Math.round(cost * 1.2)) : 0;
      // Refresh the estimate once there is a real measurement to base it on,
      // and again whenever the throttle flips.
      if(!!cooldown !== throttled || first){ throttled=!!cooldown; updateVideoEst(cfg, throttled); }
    }
    if(cooldown>0) vPreviewTimer=setTimeout(()=>{ vPreviewTimer=null; vPreviewRAF=requestAnimationFrame(loop); }, cooldown);
    else vPreviewRAF=requestAnimationFrame(loop); })(); }
/* Roughly a frame at 60Hz. Under this there is nothing to fix; over it, the
   interface starts losing frames of its own. */
const FRAME_BUDGET_MS = 24;
/* What the last preview frame actually cost to draw. The export renders the
   same frames at the same cost, so this is a far better predictor than the
   frame size alone. */
let _frameMs=0;
/* The RECORD button names the file it will write.
 *
 * It was hard-coded "● RECORD .webm" in the markup and nothing ever re-synced
 * it, so choosing MP4 in the File picker left the button claiming .webm while
 * the export wrote .mp4 — and the label is the only place that answers "what am
 * I about to get" before you press it.
 *
 * Read from the SELECTED CONTAINER, not from the last export: this runs before
 * anything has been written. The offline path can still degrade MP4 to WebM on a
 * build without an H.264 licence, and it says so in the console and records the
 * extension it actually wrote — a promise the button cannot make and does not. */
export function syncRecordLabel(){
  const b=$("v-record"); if(!b) return;
  const id=val("v-container")||"webm";
  const c=CONTAINERS.find((x)=>x.id===id)||CONTAINERS[0];
  b.textContent="● RECORD ."+c.ext;
}
export function updateVideoEst(cfg, throttled){ syncRecordLabel(); const est=$("v-est"); if(!est)return; const mb=(cfg.bitrate>0?cfg.bitrate:(cfg.W*cfg.H*cfg.fps*0.00000009))*cfg.duration/8;
  // Whether export costs wall-clock time depends on the offline encoder being
  // usable here, so say which one the button will actually take. The cheap
  // synchronous check is enough for a label — the export itself re-checks
  // properly and falls back on its own.
  const offline = typeof VideoEncoder!=="undefined" && !(cfg.scene==="videoin" && hasFootageFor(cfg.srcKey));
  /* "faster than real time" was true of every size the tool could produce when
     the ceiling was 1280×1024. It is not true of 1080×1920, where a frame with
     a filter chain costs a quarter of a second — so the label promised a
     one-second export for something that takes a minute. Estimated from the
     measured cost once there is one, and stated as a duration rather than a
     boast. */
  let speed;
  if(!offline) speed="~"+cfg.duration+"s real-time";
  else if(_frameMs>0){
    const secs=Math.round(cfg.duration*cfg.fps*_frameMs/1000);
    speed = secs<cfg.duration ? "faster than real time"
          : "~"+(secs<90?secs+"s":Math.round(secs/60)+" min")+" to export";
  } else speed="faster than real time";
  est.textContent=cfg.W+"×"+cfg.H+" · "+speed+" · ~"+mb.toFixed(1)+"MB"
    // Say so rather than letting a stuttering preview read as a broken tool.
    +(throttled?" · preview eased off (export unaffected)":""); }
export function pickVideoCodecs(){ const s=$("v-codec"); s.replaceChildren(); const opts=[["auto",""],["VP9","video/webm;codecs=vp9"],["VP8","video/webm;codecs=vp8"],["AV1","video/webm;codecs=av01"],["H264","video/mp4;codecs=h264"]];
  opts.forEach(([label,m])=>{ if(m==="" || (window.MediaRecorder&&MediaRecorder.isTypeSupported(m))){ const o=document.createElement("option"); o.value=m; o.textContent=label+(m===""?"":" ✓"); s.appendChild(o); } }); }
/* `withAudio` asks for a mime that declares an audio codec too. Without it
   MediaRecorder is free to record the video track only, which is exactly the
   silent-clip failure this whole path exists to avoid. */
export function bestMime(sel, withAudio){ if(sel && window.MediaRecorder && MediaRecorder.isTypeSupported(sel)) return sel;
  const list = withAudio
    ? ["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"]
    : ["video/webm;codecs=vp9","video/webm;codecs=vp8","video/webm"];
  for(const m of list) if(MediaRecorder.isTypeSupported(m)) return m; return ""; }
export function recorderSupported(){ const c=$("vcanvas"); return !!(window.MediaRecorder && c && "captureStream" in c); }
/* One export at a time, across BOTH tabs and all six entry points (RECORD,
   sequence RECORD, .gif, .apng, .webp, frame strip). They all render through
   the same module-level scratch canvases (_persistCanvas, _ss, _tlA) — and
   resizing a canvas CLEARS it — and the videoin scene seeks the one shared
   imported <video>, so two exports interleaved on the event loop cross-
   contaminate each other's frames: the same corruption class the vRecording
   guard closed for double-RECORD. The four still buttons are greyed while the
   token is held; every other entry point refuses with a toast. */
let _exportBusy=null;
const STILL_BTNS=["v-gif","v-apng","v-awebp","v-strip"];
export function claimExport(label){
  if(_exportBusy){ log(_exportBusy+" already running — wait for it or press ■ STOP.","warn"); toast(_exportBusy+" in progress","warn"); return false; }
  _exportBusy=label;
  STILL_BTNS.forEach(id=>{ const b=$(id); if(b)b.disabled=true; });
  return true;
}
export function releaseExport(){ _exportBusy=null;
  STILL_BTNS.forEach(id=>{ const b=$(id); if(b)b.disabled=false; }); }
/* The still exporters have no MediaRecorder to stop, so ■ STOP raises this
   flag and their frame loops check it between frames. */
let _stillCancel=false;
export const stillExportCancelled=()=>_stillCancel;
export function armStillExportCancel(){ _stillCancel=false; }
export function cancelStillExport(){ _stillCancel=true; }
/* Offline export: render frame-indexed into WebCodecs and mux to WebM. Faster
   than real time, frame-exact, and unaffected by tab focus. Returns false when
   WebCodecs is unavailable so the caller drops to the real-time recorder.

   The imported-video scene is deliberately excluded: it plays a <video>
   element, which only advances in wall-clock time, so encoding it faster than
   real time would sample the same frame repeatedly.

   That exclusion asks about the clip's OWN footage, not just the active import
   slot. It used to ask `hasImportedVideo()`, so a clip whose Footage names a
   library row — the ordinary case after a reload, when the row is restored from
   IndexedDB and no file has been dropped this session — sailed past the guard
   and encoded the whole clip from one never-advanced frame. A frozen export
   that reports success is the worst failure this tool has. */
async function recordVideoFast(cfg){
  if(cfg.scene==="videoin" && hasFootageFor(cfg.srcKey)) return false;
  const frames=Math.max(1, Math.round(cfg.duration*cfg.fps));
  /* Gate on the container the author picked, not a hardcoded webm — an
     H.264-only WebCodecs build was bounced to the real-time recorder for an
     MP4 it could have encoded. encodeClip degrades MP4 to WebM itself when
     H.264 is missing, so the gate accepts either the selection or the degrade
     target. */
  const container=val("v-container")||"webm";
  let support=await encoderSupport(cfg.W, cfg.H, container);
  if(!support.available && container==="mp4") support=await encoderSupport(cfg.W, cfg.H, "webm");
  if(!support.available){ log("Fast export unavailable: "+support.reason+" — using real-time capture.","warn"); return false; }

  stopVideoPreview(); vRecording=true;
  /* Start the phosphor from black. `_persistCanvas()` is a one-frame
     accumulator, and stopping the preview leaves the last frame it drew sitting
     in it — so with Persist above zero the first frames of the export carried a
     ghost of wherever the scrubber happened to be, and exporting the same
     project twice produced different files. The real-time path and
     collectFrames() both reset it by resizing; this one never did. */
  _persistCanvas().width=cfg.W; _persistCanvas().height=cfg.H;
  $("v-record").disabled=true; $("v-stop").disabled=false; $("v-progress-wrap").style.display="block";
  log("Exporting "+cfg.duration+"s @ "+cfg.fps+"fps "+cfg.W+"×"+cfg.H+" via WebCodecs ("+support.label+")…","info");

  // Resolved before the picture starts so a missing bed is reported up front
  // rather than after a minute of encoding.
  let bed=null;
  try{ bed=await prepareBed(cfg.audioBed, cfg.duration); }
  catch(e){ log("Audio bed failed ("+e.message+") — exporting silent.","warn");
         toast("No sound in this export — the audio bed failed","warn"); }

  let res=null, err=null;
  try{
    res=await encodeClip({
      width:cfg.W, height:cfg.H, fps:cfg.fps, frames,
      bitrate: cfg.bitrate>0 ? cfg.bitrate*1_000_000 : 0,
      audioBuffer: bed, container, log,
      drawFrame:(ctx,t)=>renderScaled(ctx,cfg.W,cfg.H,cfg,Math.min(t,cfg.duration)),
      onProgress:(p)=>{ $("v-progress").style.width=(p*100)+"%";
        $("v-status").textContent="Exporting… "+Math.round(p*100)+"%"; },
      cancelled:()=>!vRecording,
    });
  }catch(e){ err=e; }

  $("v-progress-wrap").style.display="none";
  vRecording=false; $("v-record").disabled=false; $("v-stop").disabled=true;

  // STOP means stop. The encoder hands back the frames it managed, and saving
  // those would put a silently truncated clip in the library announced as a
  // finished export — so discard it, and return true so the caller does NOT
  // fall through to the real-time recorder the author just cancelled.
  if(res && res.cancelled){
    $("v-status").textContent="Export cancelled — nothing saved.";
    log("Export cancelled at "+res.frames+" frame(s) — discarded.","warn");
    toast("Export cancelled","warn");
    startVideoPreview();
    return true;
  }
  if(err || !res){
    if(err) log("Fast export failed ("+err.message+") — falling back to real-time capture.","warn");
    startVideoPreview();
    return false;
  }
  const speed=(cfg.duration*1000)/Math.max(1,res.ms);
  // Say whether the sound made it. A clip that silently came out silent is
  // something you find out about after uploading it.
  const sound = res.audio ? " · "+(res.audio.channels>1?"stereo":"mono")+" audio"
    : res.audioRequested ? " · NO AUDIO (encoder unavailable)" : "";
  $("v-status").textContent="Exported "+(res.blob.size/1024).toFixed(0)+" KB in "+(res.ms/1000).toFixed(1)+"s ("+speed.toFixed(1)+"× real time)"+sound+".";
  log("Exported "+res.frames+" frames, "+(res.blob.size/1024).toFixed(0)+" KB "+res.label+sound+" in "+res.ms+"ms ("+speed.toFixed(1)+"× real time)",
      res.audioRequested&&!res.audio?"warn":"ok");
  toast("Clip → library ("+speed.toFixed(1)+"× real time)","info");
  const nm=cfg.hud||cfg.text.split("\n")[0]||cfg.scene;
  /* res.ext, not "webm": the encoder decides what it actually wrote, and it can
     legitimately differ from what was asked for — a browser with no H.264
     licence gets a WebM. Naming the file after the request rather than the
     result is how you end up with a .mp4 that is not one. */
  addToLibrary(res.blob,res.ext||"webm","videos",slug(nm),cfg.duration);
  startVideoPreview();
  return true;
}

/* Make sure this clip's own footage is decoded and in the pool.
   `videoSource()` is a synchronous lookup that returns null and starts a load,
   which is right for a render loop and wrong for an exporter: the exporter asks
   once and then commits to an answer for the whole clip. */
async function primeFootage(cfg){
  if(cfg.scene!=="videoin" || !cfg.srcKey) return;
  try{ await ensureVideoSource(cfg.srcKey); }catch(e){ /* absent footage is an ordinary state */ }
}

export async function recordVideo(){
  if(vRecording)return;
  if(!claimExport("Recording"))return;
  // Claim the flag synchronously, before the first await. The fast path only
  // set it after awaiting encoderSupport(), so two clicks in the same tick both
  // got past the guard and ran two encoders over the same scratch canvases —
  // which is how a perfectly good clip came out corrupted, twice.
  //
  // And HOLD it across the whole function: it used to be released the moment
  // the fast path declined, but the fallback awaits prepareBed() before its
  // recorder starts, so a second click in that gap ran a second recorder over
  // the same canvas — the same race, one layer down.
  vRecording=true;
  let armed=false;   // once the recorder is live, finish() owns the flag + token
  try{
  let cfg=readVideoCfg();
  // Decode this clip's footage BEFORE the offline path decides. The pool loads
  // asynchronously, so a clip whose Footage names a library row that the
  // preview has not drawn yet would answer "no footage" to the guard below and
  // be encoded frozen.
  await primeFootage(cfg);
  if(await recordVideoFast(cfg)) return;
  vRecording=true;   // the fast path's failure exit cleared it
  if(!recorderSupported()){ log("Video capture unavailable (MediaRecorder/captureStream missing).","err"); toast("Video capture not supported here","err"); return; }
  cfg=readVideoCfg(); const c=$("vcanvas"); c.width=cfg.W; c.height=cfg.H; const ctx=c.getContext("2d"); _persistCanvas().width=cfg.W; _persistCanvas().height=cfg.H;
  const stream=c.captureStream(cfg.fps);
  /* The real-time path records whatever is in the stream, and a canvas stream
     carries no sound at all. Playing the bed into a MediaStreamDestination and
     adding its track is what lets the fallback produce the same clip the
     offline path does — silent otherwise, on the very browsers least likely to
     have WebCodecs. */
  let bedCtx=null;
  try{
    const bed=await prepareBed(cfg.audioBed, cfg.duration);
    if(bed){ const AC=window.AudioContext||window.webkitAudioContext;
      if(AC){ bedCtx=new AC(); const dest=bedCtx.createMediaStreamDestination();
        const src=bedCtx.createBufferSource(); src.buffer=bed; src.connect(dest); src.start();
        const tr=dest.stream.getAudioTracks()[0]; if(tr) stream.addTrack(tr); } }
  }catch(e){ log("Audio bed failed ("+e.message+") — recording silent.","warn");
             toast("No sound in this recording — the audio bed failed","warn"); }
  const hasAudio=stream.getAudioTracks().length>0;
  const mime=bestMime(val("v-codec"),hasAudio);
  let opts={}; if(mime)opts.mimeType=mime; if(cfg.bitrate>0)opts.videoBitsPerSecond=cfg.bitrate*1000000;
  let rec; try{ rec=new MediaRecorder(stream,opts); }catch(e){ try{ rec=new MediaRecorder(stream); }catch(e2){ log("MediaRecorder init failed: "+e2.message+" — this browser will not record this format.","err");
                                                   toast("Could not start recording","err"); return; } }
  const chunks=[]; rec.ondataavailable=e=>{ if(e.data&&e.data.size)chunks.push(e.data); };
  stopVideoPreview(); vRecording=true; $("v-record").disabled=true; $("v-stop").disabled=false; $("v-progress-wrap").style.display="block";
  /* Why the recording ended decides what finish() does with the chunks. The
     fast path's contract holds here too: STOP means stop, and a recorder error
     is an error — saving either as a normal clip put a silently truncated file
     in the library announced as a finished export. */
  let endReason="done";
  let done=false; const finish=()=>{ if(done)return; done=true; try{ stream.getTracks().forEach(tr=>tr.stop()); }catch(e){}
    try{ bedCtx&&bedCtx.close(); }catch(e){}
    $("v-progress-wrap").style.display="none";
    vRecording=false; releaseExport(); $("v-record").disabled=false; $("v-stop").disabled=true;
    if(endReason!=="done"){
      const stopped=endReason==="stopped";
      $("v-status").textContent=stopped?"Recording cancelled — nothing saved.":"Recorder failed — nothing saved.";
      log(stopped?"Recording cancelled — partial clip discarded.":"Recorder failed ("+endReason+") — partial clip discarded.",stopped?"warn":"err");
      toast(stopped?"Recording cancelled":"Recording failed",stopped?"warn":"err");
      startVideoPreview(); return;
    }
    /* Named after what the recorder actually wrote, not a hardcoded "webm" —
       the codec picker offers video/mp4 where MediaRecorder supports it, and
       an ISO-BMFF file called clip.webm is one every player misidentifies. */
    const actual=rec.mimeType||mime||"video/webm"; const isMp4=actual.indexOf("video/mp4")===0;
    const blob=new Blob(chunks,{type:isMp4?"video/mp4":"video/webm"}); const ext=isMp4?"mp4":"webm";
    $("v-status").textContent="Recorded "+(blob.size/1024).toFixed(0)+" KB "+ext+".";
    log("Recorded video: "+(blob.size/1024).toFixed(0)+" KB ("+actual+")"+(hasAudio?" with audio":"")+"","ok"); toast("Clip → library","info");
    const nm=cfg.hud||cfg.text.split("\n")[0]||cfg.scene; addToLibrary(blob,ext,"videos",slug(nm),cfg.duration);
    startVideoPreview(); };
  rec.onstop=finish; rec.onerror=(e)=>{ endReason=(e&&e.error&&e.error.message)||"MediaRecorder error"; finish(); }; rec.start();
  armed=true;
  // The clip's own footage, not just the active slot — otherwise a library-keyed
  // clip records whatever frame its pooled decoder happened to be paused on.
  if(cfg.scene==="videoin"){ const fv=footageFor(cfg.srcKey);
    if(fv){ try{ fv.currentTime=0; fv.play().catch(()=>{}); }catch(e){} } }
  log("Recording "+cfg.duration+"s @ "+cfg.fps+"fps "+cfg.W+"×"+cfg.H+(cfg.ss?" (2×SS)":"")+"...","info");
  const start=performance.now();
  // `done` bail: an onerror-driven finish() can land between two frames, and
  // the already-scheduled step would overwrite its status with "Recording...".
  const step=()=>{ if(done)return; const t=(performance.now()-start)/1000; renderScaled(ctx,cfg.W,cfg.H,cfg,Math.min(t,cfg.duration));
    const p=clamp(t/cfg.duration,0,1); $("v-progress").style.width=(p*100)+"%"; $("v-status").textContent="Recording... "+t.toFixed(1)+"/"+cfg.duration+"s";
    if(t>=cfg.duration || !vRecording){ if(t<cfg.duration && !vRecording) endReason="stopped"; try{rec.stop();}catch(e){finish();} return; } requestAnimationFrame(step); };
  requestAnimationFrame(step);
  } finally { if(!armed){ vRecording=false; releaseExport(); } }
}
/* collect `count` frames deterministically into offscreen canvases (for strip/GIF).
   Async so a `videoin` clip can be seeked frame-accurately (drawImage of a <video>
   only shows the frame at its current currentTime). Non-videoin scenes never await. */
/* Every collected frame is a full canvas held in memory at once, so the cost is
   count × W × H × 4 bytes. At the old 1280×1024 ceiling a 240-frame GIF was
   already 1.2 GB of canvas; at 1080×1920 it is two. `maxDim` renders at full
   size and stores each frame scaled down to fit, which is what the callers
   wanted anyway — a GIF and a contact strip are both small by definition. */
export function fitWithin(W,H,maxDim){
  if(!(maxDim>0)) return {w:W,h:H};
  const s=Math.min(1,maxDim/Math.max(W,H));
  return s>=1 ? {w:W,h:H} : {w:Math.max(2,Math.round(W*s)), h:Math.max(2,Math.round(H*s))};
}
export async function collectFrames(cfg,count,{maxDim=0,cancelled=null,onProgress=null}={}){ const c=document.createElement("canvas"); c.width=cfg.W; c.height=cfg.H; const ctx=c.getContext("2d");
  await primeFootage(cfg);
  _persistCanvas().width=cfg.W; _persistCanvas().height=cfg.H; const out=[];
  const {w:ow,h:oh}=fitWithin(cfg.W,cfg.H,maxDim);
  /* Seek the footage this clip actually draws. Asking `hasImportedVideo()` and
     seeking `_importedVideo` meant a clip playing a library row was never
     seeked at all: every frame of the .gif / .apng / .webp / strip came out of
     whatever the pooled decoder was showing, so the "animation" was one frame
     repeated. */
  const fvid = cfg.scene==="videoin" ? footageFor(cfg.srcKey) : null;
  const isVid = !!(fvid && fvid.videoWidth);
  const vdur = isVid ? (isFinite(fvid.duration)&&fvid.duration>0?fvid.duration:cfg.duration) : 0;
  for(let i=0;i<count;i++){ if(cancelled&&cancelled())break;
    const frac=(count<2?0:(i/(count-1))*0.999); const t=frac*cfg.duration;
    if(isVid) await seekVideo(fvid, frac*vdur);
    /* renderScaled, not renderVideoFrame: 2×SS is a checkbox on the same panel
       as the export buttons, and this path ignored it. The preview honoured it,
       RECORD honoured it on both paths, the batch honoured it — the four still
       exporters (.gif, .apng, .webp, frame strip) all came out aliased with the
       box ticked and said nothing. */
    renderScaled(ctx,cfg.W,cfg.H,cfg,t);
    const f=document.createElement("canvas"); f.width=ow; f.height=oh; f.getContext("2d").drawImage(c,0,0,ow,oh); out.push(f);
    if(onProgress)onProgress((i+1)/count);
    // Collection is synchronous canvas work — a 240-frame GIF at 640px is
    // seconds of it. Yield every few frames so the tab stays responsive and a
    // ■ STOP can land between them. Callers stop the preview first, so the
    // gap does not let the preview loop redraw over the shared scratches.
    if(i%3===2) await new Promise(r=>setTimeout(r,0)); }
  if(isVid){ try{ fvid.play().catch(()=>{}); }catch(e){} }
  return out; }
export async function exportFrameStrip(){ if(!claimExport("Frame strip"))return;
  armStillExportCancel(); stopVideoPreview();
  try{
  const cfg=readVideoCfg(); const N=clamp(num("v-frames",12),2,64);
  log("Rendering "+N+"-frame strip"+(cfg.scene==="videoin"?" (seeking clip)":"")+"...","info");
  // The strip draws every frame at 160px wide, so collecting them any larger
  // is memory spent on pixels that are thrown away a line later.
  const frames=await collectFrames(cfg,N,{maxDim:320, cancelled:stillExportCancelled});
  if(stillExportCancelled()||frames.length<N){ log("Frame strip cancelled — nothing saved.","warn"); toast("Export cancelled","warn"); return; }
  const tw=Math.min(cfg.W,160), th=Math.round(cfg.H*tw/cfg.W); const cols=Math.ceil(Math.sqrt(N)), rows=Math.ceil(N/cols);
  const out=document.createElement("canvas"); out.width=cols*tw; out.height=rows*th; const o=out.getContext("2d"); o.fillStyle="#000"; o.fillRect(0,0,out.width,out.height);
  frames.forEach((f,i)=>o.drawImage(f,(i%cols)*tw,Math.floor(i/cols)*th,tw,th));
  out.toBlob(b=>{ if(b){ const nm=slug(val("v-hud")||cfg.scene||"clip")+"_strip"; addToLibrary(b,"png","image",nm); download(b,nm+".png"); toast("Frame strip → library"); } },"image/png");
  } finally { releaseExport(); startVideoPreview(); } }
/* --- inline GIF89a encoder (216-color global palette + LZW) --- */
