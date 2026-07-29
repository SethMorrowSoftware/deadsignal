/* Dead Signal Studio — video/gif.js */
import { download } from '../core/blobs.js';
import { $, clamp, log, num, toast, val } from '../core/dom.js';
import { addToLibrary, slug } from '../library/library.js';
import { armStillExportCancel, claimExport, collectFrames, fitWithin, releaseExport, startVideoPreview, stillExportCancelled, stopVideoPreview } from './capture.js';
import { readVideoCfg } from './render.js';
import { encodeAPNG, encodeAnimatedWebP } from '../export/anim.js';

export function _gifPalette(){ const p=[]; for(let r=0;r<6;r++)for(let g=0;g<6;g++)for(let b=0;b<6;b++) p.push([r*51,g*51,b*51]); while(p.length<256)p.push([0,0,0]); return p; }
export function _gifIdx(r,g,b){ return Math.round(r/51)*36+Math.round(g/51)*6+Math.round(b/51); }
export function lzwGif(indices,out){ const MIN=8; out.push(MIN); const CLEAR=1<<MIN, EOI=CLEAR+1; let codeSize=MIN+1, dict, next;
  const reset=()=>{ dict=new Map(); for(let i=0;i<CLEAR;i++)dict.set(""+i,i); codeSize=MIN+1; next=EOI+1; };
  let acc=0,nb=0; const packed=[]; const emit=(code)=>{ acc|=code<<nb; nb+=codeSize; while(nb>=8){ packed.push(acc&255); acc>>=8; nb-=8; } };
  reset(); emit(CLEAR); let prefix=""+indices[0];
  for(let i=1;i<indices.length;i++){ const k=indices[i], key=prefix+","+k;
    if(dict.has(key)) prefix=key;
    // emit the prefix code, THEN grow the table. The code-width must increase
    // *before* assigning the code that would overflow the current width — but
    // AFTER emitting this iteration's prefix (which still fits the old width).
    // Doing next++ before the width check (the old order) bumped one code too
    // early and desynced the decoder at the first 512-entry boundary.
    else { emit(dict.get(prefix));
      if(next===4096){ emit(CLEAR); reset(); }
      else { if(next===(1<<codeSize)&&codeSize<12) codeSize++; dict.set(key,next++); }
      prefix=""+k; } }
  emit(dict.get(prefix)); emit(EOI); if(nb>0) packed.push(acc&255);
  for(let i=0;i<packed.length;i+=255){ const n=Math.min(255,packed.length-i); out.push(n); for(let j=0;j<n;j++) out.push(packed[i+j]); } out.push(0); }
/* Header and per-frame emitters, split out so exportGif can encode one frame
   per event-loop tick. encodeGif stays the synchronous whole-clip form the
   CI round-trip gate pins; both assemble byte-identical streams. */
function gifHeader(b,W,H){ const put=(...a)=>a.forEach(x=>b.push(x&255)); const str=s=>{ for(let i=0;i<s.length;i++) b.push(s.charCodeAt(i)); };
  str("GIF89a"); put(W,W>>8,H,H>>8,0xF7,0,0); _gifPalette().forEach(c=>put(c[0],c[1],c[2]));
  put(0x21,0xFF,0x0B); str("NETSCAPE2.0"); put(0x03,0x01,0,0,0x00); }
function gifFrame(b,fr,W,H,delayCs){ const put=(...a)=>a.forEach(x=>b.push(x&255));
  put(0x21,0xF9,0x04,0x00,delayCs,delayCs>>8,0x00,0x00); put(0x2C,0,0,0,0,W,W>>8,H,H>>8,0x00);
  const idx=new Uint8Array(W*H); for(let i=0,p=0;i<idx.length;i++,p+=4) idx[i]=_gifIdx(fr[p],fr[p+1],fr[p+2]); lzwGif(idx,b); }
export function encodeGif(frames,W,H,delayCs){ const b=[]; gifHeader(b,W,H);
  for(const fr of frames) gifFrame(b,fr,W,H,delayCs);
  b.push(0x3B); return new Blob([new Uint8Array(b)],{type:"image/gif"}); }
/* A GIF is a 256-colour format with no interframe compression worth the name.
   At 1080×1920 a ten-second one is hundreds of megabytes that no platform will
   accept, and collecting the frames to build it would spend two gigabytes of
   canvas first. Capping the long edge keeps the format honest about what it is
   for; the .webm export is what carries full-resolution work. */
export const GIF_MAX_DIM = 640;
/* The frame cap, and the one thing it must not silently change: the SPEED.
 *
 * N is capped at 240, but collectFrames spreads those N frames across the whole
 * clip — so the content is right. The per-frame delay was then computed from the
 * REQUESTED rate (100/fps), which is only the right answer when the cap did not
 * bite. A 30s clip asked for at 12fps wants 360 frames, got 240, and played them
 * at 12fps: twenty seconds of GIF for a thirty-second clip, running 1.5x fast,
 * with nothing said about it.
 *
 * "Capped at 240 frames" has to mean FEWER FRAMES, not a faster clip. Deriving
 * the delay from the duration those frames actually cover is exactly the same
 * number whenever the cap is not reached (100*d/(d*fps) === 100/fps), so an
 * uncapped export is byte-identical to before.
 */
export const ANIM_MAX_FRAMES = 240;
export function animFrameCount(duration, fps){
  return clamp(Math.round(duration * fps), 2, ANIM_MAX_FRAMES);
}
/** Per-frame delay in the unit given, for N frames spanning `duration`. */
export function animDelay(duration, frames, perSecond){
  const d = Math.max(0.001, Number(duration) || 0);
  const n = Math.max(1, Number(frames) || 1);
  return Math.max(1, Math.round((perSecond * d) / n));
}
/** True when the cap changed the frame count — worth telling the author. */
export const animCapped = (duration, fps) => Math.round(duration * fps) > ANIM_MAX_FRAMES;
export async function exportGif(){ if(!claimExport("GIF export"))return;
  const cfg=readVideoCfg(); const gfps=clamp(num("v-giffps",cfg.fps>15?12:cfg.fps),2,20); const N=animFrameCount(cfg.duration,gfps);
  const {w:gw,h:gh}=fitWithin(cfg.W,cfg.H,GIF_MAX_DIM);
  const wrap=$("v-progress-wrap"), bar=$("v-progress"), status=$("v-status"), stop=$("v-stop");
  const setP=(p,label)=>{ if(bar)bar.style.width=(p*100)+"%"; if(status)status.textContent=label+" "+Math.round(p*100)+"%"; };
  const bail=()=>{ if(status)status.textContent="GIF export cancelled — nothing saved."; log("GIF export cancelled — discarded.","warn"); toast("Export cancelled","warn"); };
  armStillExportCancel(); stopVideoPreview();
  if(wrap)wrap.style.display="block"; if(stop)stop.disabled=false;
  log("Encoding "+N+"-frame GIF at "+gw+"×"+gh
      +(gw!==cfg.W?" (scaled from "+cfg.W+"×"+cfg.H+" — GIF is capped at "+GIF_MAX_DIM+"px)":"")
      +(animCapped(cfg.duration,gfps)
        ? " — capped at "+ANIM_MAX_FRAMES+" frames, so it plays at "
          +(N/cfg.duration).toFixed(1)+"fps rather than "+gfps+" (same length, fewer frames)"
        : "")
      +(cfg.scene==="videoin"?" (seeking clip)":"")+"...","info");
  try{
    const frames=await collectFrames(cfg,N,{maxDim:GIF_MAX_DIM, cancelled:stillExportCancelled,
      onProgress:(p)=>setP(p*0.5,"Rendering frames…")});
    if(stillExportCancelled()||frames.length<N){ bail(); return; }
    /* One frame per event-loop tick, flushed into Uint8Array chunks. The
       whole-clip synchronous encode froze the tab for its full duration — no
       progress, no STOP — and one plain number array held every output byte
       as a boxed double, hundreds of MB of transient memory on a long clip. */
    // Centiseconds across the length these N frames actually cover.
    const delay=animDelay(cfg.duration,N,100); const chunks=[];
    { const b=[]; gifHeader(b,gw,gh); chunks.push(new Uint8Array(b)); }
    for(let i=0;i<frames.length;i++){
      if(stillExportCancelled()){ bail(); return; }
      const b=[]; gifFrame(b,frames[i].getContext("2d").getImageData(0,0,gw,gh).data,gw,gh,delay);
      chunks.push(new Uint8Array(b));
      setP(0.5+0.5*(i+1)/frames.length,"Encoding GIF…");
      await new Promise(r=>setTimeout(r,0));
    }
    chunks.push(new Uint8Array([0x3B]));
    const blob=new Blob(chunks,{type:"image/gif"}); const nm=slug(val("v-hud")||cfg.scene||"clip");
    addToLibrary(blob,"gif","image",nm); download(blob,nm+".gif");
    if(status)status.textContent="GIF encoded: "+(blob.size/1024).toFixed(0)+" KB.";
    toast("GIF → library ("+(blob.size/1024).toFixed(0)+"KB)"); log("GIF encoded: "+(blob.size/1024).toFixed(0)+"KB","ok");
  }catch(e){ log("GIF export failed: "+e.message,"err"); toast("GIF export failed","err"); }
  finally{ if(wrap)wrap.style.display="none"; if(bar)bar.style.width="0%"; if(stop)stop.disabled=true; releaseExport(); startVideoPreview(); } }
/* APNG and animated WebP, beside the GIF.
 *
 * GIF is 256 colours and one bit of transparency; it survives because it plays
 * absolutely everywhere. These are what you want when the target can take them
 * — and they share the GIF's frame rate control, its frame collection and its
 * "straight to the library and to disk" ending, because to an author they are
 * the same action with a different file on the end of it.
 *
 * Both are capped at the same size as the GIF: these are for a message, a
 * README or a social post, and a lossless 1080×1920 animation is a download
 * nobody wants. */
async function exportAnimated(kind){
  const label=kind==="apng"?"APNG":"animated WebP";
  if(!claimExport(label+" export"))return;
  const stop=$("v-stop");
  armStillExportCancel(); stopVideoPreview();
  if(stop)stop.disabled=false;
  try{
  const cfg=readVideoCfg();
  const fps=clamp(num("v-giffps",cfg.fps>15?12:cfg.fps),2,20);
  const N=animFrameCount(cfg.duration,fps);
  const {w:aw,h:ah}=fitWithin(cfg.W,cfg.H,GIF_MAX_DIM);
  log("Encoding "+N+"-frame "+label+" at "+aw+"×"+ah
      +(aw!==cfg.W?" (scaled from "+cfg.W+"×"+cfg.H+")":"")
      +(animCapped(cfg.duration,fps)
        ? " — capped at "+ANIM_MAX_FRAMES+" frames, so it plays at "
          +(N/cfg.duration).toFixed(1)+"fps rather than "+fps+" (same length, fewer frames)"
        : "")
      +(cfg.scene==="videoin"?" (seeking clip)":"")+"…","info");
  const frames=await collectFrames(cfg,N,{maxDim:GIF_MAX_DIM, cancelled:stillExportCancelled});
  if(stillExportCancelled()||frames.length<N){ log(label+" export cancelled — discarded.","warn"); toast("Export cancelled","warn"); return; }
  // Milliseconds across the length these N frames actually cover — see animDelay.
  const delayMs=animDelay(cfg.duration,N,1000);
  let blob;
  try{
    blob = kind==="apng" ? await encodeAPNG(frames,{ delayMs })
                         : await encodeAnimatedWebP(frames,{ delayMs });
  }catch(e){ log(label+" failed: "+e.message,"err"); toast(label+" failed","err"); return; }
  // encodeAnimatedWebP returns null rather than throwing when the browser has
  // no WebP encoder — that is a capability, not a fault, and it deserves a
  // sentence rather than a stack trace.
  if(!blob){ log("This browser cannot encode WebP — try .apng or .gif.","warn");
    toast("No WebP encoder here","err"); return; }
  const ext = kind==="apng" ? "apng" : "webp";
  const nm=slug(val("v-hud")||cfg.scene||"clip");
  addToLibrary(blob,ext,"image",nm); download(blob,nm+"."+ext);
  toast(label+" → library ("+(blob.size/1024).toFixed(0)+"KB)");
  log(label+" encoded: "+(blob.size/1024).toFixed(0)+"KB","ok");
  } finally { if(stop)stop.disabled=true; releaseExport(); startVideoPreview(); }
}
export const exportAPNG=()=>exportAnimated("apng");
export const exportAnimWebP=()=>exportAnimated("webp");

/* ============================================================================
   TIMELINE — chain captured VIDEO scenes into one clip (cut/crossfade/dip)
   Each clip stores a full VIDEO recipe; the sequence unifies only W/H/FPS and
   composites transitions. Preview + record are real-time (so `videoin` clips
   play live imported footage). Recipes persist in projects; blobs do not.
   ========================================================================== */
