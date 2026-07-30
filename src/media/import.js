/* Dead Signal Studio — media/import.js */
import { makeUrl, revokeUrl } from '../core/blobs.js';
import { $, clamp, log, setVal, toast } from '../core/dom.js';
import { setFont } from '../core/text.js';
import { slug } from '../library/library.js';
import { hasVideoSource, videoSource } from '../video/sources.js';

export let _importedImg=null, _importedName="import";
/* A failed image import used to log one line — "Image decode failed" — to a
   console panel that is closed by default, and raise no toast at all. Its video
   sibling below has always toasted. So dropping a .txt on the SCREEN tab looked
   exactly like dropping nothing: the old image stayed on the canvas and the tool
   said nothing anyone would see. The FileReader's own error was not handled at
   all, which made a file the browser cannot read (removed drive, permissions)
   silent in both places. Both now say what failed, on what file, and what the
   tool can actually open. */
const IMAGE_KINDS="PNG, JPEG, GIF, WebP, BMP or SVG";
function importFailed(file,what){
  const name=file&&file.name?" “"+String(file.name).slice(0,48)+"”":"";
  log(what+name+". This tool opens "+IMAGE_KINDS+" — if that is what it is, the file may be damaged or incomplete.","err");
  toast("Could not open that image","err");
}
export function loadImageFile(file, cb){ if(!file)return; const r=new FileReader();
  r.onload=()=>{ const im=new Image(); im.onload=()=>{ _importedImg=im; _importedName=slug((file.name||"import").replace(/\.[^.]+$/,""))||"import"; log("Imported image "+im.width+"×"+im.height,"ok"); toast("Image imported"); cb&&cb(); };
    im.onerror=()=>importFailed(file,"Could not decode the image"); im.src=r.result; };
  r.onerror=()=>importFailed(file,"Could not read the file");
  try{ r.readAsDataURL(file); }catch(e){ importFailed(file,"Could not read the file"); } }
export function drawImportFit(ctx,W,H,pan){ if(!_importedImg){ ctx.fillStyle="#0d0d12"; ctx.fillRect(0,0,W,H); setFont(ctx,Math.max(11,H*0.055)); ctx.fillStyle="#7788aa"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("DROP or LOAD an image",W/2,H/2); ctx.textAlign="left"; ctx.textBaseline="top"; return; }
  const iw=_importedImg.width, ih=_importedImg.height, scale=Math.max(W/iw,H/ih); let dw=iw*scale, dh=ih*scale, dx=(W-dw)/2, dy=(H-dh)/2;
  if(pan){ const z=1+0.18*pan.z; dw*=z; dh*=z; dx=(W-dw)/2 + pan.x*(dw-W)*0.5; dy=(H-dh)/2 + pan.y*(dh-H)*0.5; }
  ctx.drawImage(_importedImg,dx,dy,dw,dh); }
/* ---------- imported source VIDEO (bring-your-own footage -> filter it) ------ */
export let _importedVideo=null, _importedVideoName="clip", _importedVideoUrl=null;
export function loadVideoFile(file, cb){ if(!file)return;
  const v=document.createElement("video"); v.muted=true; v.loop=true; v.playsInline=true; v.crossOrigin="anonymous"; v.preload="auto";
  /* The previous clip's URL is revoked only once the replacement has decoded.
     Media blob URLs are range-requested lazily — seekVideo depends on that —
     so revoking up front left the still-active old import backed by a dead URL
     whenever the new file failed to decode. */
  const url=makeUrl(file); v.src=url;
  v.onloadedmetadata=()=>{
    /* A file the browser can open but that has no picture in it — an .mp3, an
       audio-only .mp4, a container whose video track this build cannot decode —
       reaches HERE, not onerror. It used to be accepted: the log read "Imported
       video 0×0", the toast read "Video imported", v-dur was rewritten to the
       clip's length, and the canvas went on showing "DROP or LOAD a video clip"
       because hasImportedVideo() tests videoWidth. Refuse it where it arrives,
       and leave the previous clip and the duration alone. */
    if(!v.videoWidth || !v.videoHeight){ revokeUrl(url);
      log("That file has no picture in it"+(file.name?" (“"+String(file.name).slice(0,48)+"”)":"")+" — it may be audio only, or its video track is one this browser cannot decode.","err");
      toast("No video track in that file","err"); return; }
    if(_importedVideoUrl) revokeUrl(_importedVideoUrl);
    _importedVideoUrl=url; _importedVideo=v; _importedVideoName=slug((file.name||"clip").replace(/\.[^.]+$/,""))||"clip";
    const d=isFinite(v.duration)&&v.duration>0?v.duration:8;
    log("Imported video "+v.videoWidth+"×"+v.videoHeight+" · "+d.toFixed(1)+"s","ok"); toast("Video imported");
    setVal("v-dur",clamp(Math.round(d),1,60));
    v.play().catch(()=>{}); cb&&cb(); };
  v.onerror=()=>{ revokeUrl(url); log("Video decode failed (try .webm/.mp4 the browser can play)","err"); toast("Video decode failed","err"); }; }
/**
 * Draw footage to fill the frame.
 *
 * `srcKey` names a library row, and a clip carries its own — so a sequence can
 * cut between two different files. Without a key (the live VIDEO tab before you
 * have chosen one, and every clip captured before this existed) it falls back
 * to the active slot, which is exactly what it always drew.
 */
export function drawVideoFit(ctx,W,H,srcKey){
  const v=(srcKey?videoSource(srcKey):null) || _importedVideo;
  if(!v || !v.videoWidth){ ctx.fillStyle="#0d0d12"; ctx.fillRect(0,0,W,H);
    setFont(ctx,Math.max(11,H*0.05)); ctx.fillStyle="#7788aa"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("DROP or LOAD a video clip",W/2,H/2); ctx.textAlign="left"; ctx.textBaseline="top"; return; }
  const iw=v.videoWidth, ih=v.videoHeight, scale=Math.max(W/iw,H/ih); const dw=iw*scale, dh=ih*scale;
  try{ ctx.drawImage(v,(W-dw)/2,(H-dh)/2,dw,dh); }catch(e){} }
// seek an imported <video> to `time` and resolve when the frame is ready (for GIF/strip export)
export function seekVideo(v,time){ return new Promise((resolve)=>{ if(!v||!isFinite(v.duration)){ resolve(); return; }
  const target=clamp(time,0,Math.max(0,v.duration-0.02)); let done=false; const finish=()=>{ if(done)return; done=true; v.removeEventListener("seeked",finish); resolve(); };
  v.addEventListener("seeked",finish); try{ v.pause(); v.currentTime=target; }catch(e){ finish(); } setTimeout(finish,400); }); }
export function hasImportedVideo(){ return !!(_importedVideo && _importedVideo.videoWidth); }
/** True when this clip has footage to draw — its own, or the active slot. */
export function hasFootageFor(srcKey){ return hasVideoSource(srcKey) || hasImportedVideo(); }
/**
 * The element `drawVideoFit` will actually draw for this clip.
 *
 * Exported because the exporters have to do more than draw it: the offline
 * WebCodecs path has to REFUSE it (a <video> only advances in wall-clock time),
 * the real-time recorder has to start it, and the still exporters have to seek
 * it per frame. Each of those used to ask `hasImportedVideo()` — the active
 * slot and nothing else — so a clip playing footage chosen from the library
 * exported as a single frozen frame, with no warning, in every one of those
 * paths. Resolution has to match what the scene draws, so it lives here beside
 * `drawVideoFit` rather than being re-derived at each call site.
 */
export function footageFor(srcKey){ return (srcKey ? videoSource(srcKey) : null) || _importedVideo; }
/* ---------- palettes ---------- */
