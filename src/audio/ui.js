/* Dead Signal Studio — audio/ui.js */
import { applyEdgeFades, readAudioCfg, renderAudio } from './engine.js';
import { bufferPeakRms, encodeWav } from './wav.js';
import { download, makeUrl, revokeUrl } from '../core/blobs.js';
import { $, chk, log, setVal, toast, val } from '../core/dom.js';
import { saveUserPreset } from '../core/recipes.js';
import { fxScanlines } from '../fx/crt.js';
import { paintWave, peaksOf } from './peaks.js';
import { addToLibrary, refreshItemBlob, replaceItem, slug } from '../library/library.js';
import { loadPreset } from '../presets/index.js';
import { clearBanner, setBanner, updateAudioLayerFlags, wireLive, cancelLive } from '../ui/shell.js';
import { applyRegions } from '../doc/regions.js';
import { initRegions, regions, setRegionDuration } from '../ui/regions.js';
import { initSolo } from '../ui/solo.js';
import { hasImportedAudio, importedAudio, importedAudioName, loadAudioFile } from '../media/audioimport.js';

/* Stereo draws one lane per channel, stacked. A single summed trace would hide
   exactly what the stereo controls are for: two channels that differ.

   The per-bucket maths and the painting live in audio/peaks.js now, because the
   sequence's audio lane wants the same picture at thumbnail size and a second
   implementation of a waveform is a second thing to keep in step. This function
   keeps its shape — the stacking, the per-channel colour, the divider and the
   scanlines are what make it THIS tool's waveform rather than a generic one. */
export function drawWaveform(data){ const c=$("acanvas"),ctx=c.getContext("2d"),W=c.width,H=c.height; ctx.fillStyle="#020806"; ctx.fillRect(0,0,W,H);
  const chans=Array.isArray(data)?data:[data]; const lane=H/chans.length;
  chans.forEach((d,ci)=>{ const top=ci*lane;
    ctx.save(); ctx.translate(0,top);
    paintWave(ctx,W,lane,peaksOf([d],W),{ stroke:ci?"#5fd9ff":"#39ff9e" });
    ctx.restore();
    if(ci){ ctx.strokeStyle="#0e2a24"; ctx.beginPath(); ctx.moveTo(0,top); ctx.lineTo(W,top); ctx.stroke(); } });
  fxScanlines(ctx,W,H,0.3); }

/* Bumped whenever the "last audio render" changes identity or its samples are
   rescaled in place. The lane's waveform thumbnails cache against it, because
   'last' is a live reference that changes underneath any cache with no event to
   listen for. */
export let audioRev=0;
export const bumpAudioRev=()=>{ audioRev++; };
export let lastAudio=null;
/* The library row the last render created, and the name it had then. Kept
   module-local so a re-render can reuse that row instead of stacking takes. */
let lastLibId=null, lastLibName=null;
/* Single shared preview player. Uses an <audio> element attached to the DOM, not
   a detached `new Audio()` — the latter is blocked as a "local resource" when the
   tool is opened from file:// (blob:null origin), so ▶ Play would silently fail.
   One element also means repeated Play clicks / a re-render mid-play can't stack. */
export let _audioPlayer=null, _audioPlayUrl=null;
export function _player(){ if(!_audioPlayer){ _audioPlayer=document.createElement("audio"); _audioPlayer.preload="auto"; _audioPlayer.style.display="none";
    document.body.appendChild(_audioPlayer); _audioPlayer.addEventListener("ended",stopAudioPlayback); _audioPlayer.addEventListener("error",stopAudioPlayback); } return _audioPlayer; }
export function isAudioPlaying(){ return !!(_audioPlayer && !_audioPlayer.paused && !_audioPlayer.ended); }
export function stopAudioPlayback(){ if(_audioPlayer){ try{ _audioPlayer.pause(); }catch(e){} } if(_audioPlayUrl){ revokeUrl(_audioPlayUrl); _audioPlayUrl=null; } const b=$("a-play"); if(b)b.textContent="▶ PLAY"; }
export function playAudio(){ if(!lastAudio||!lastAudio.blob)return; stopAudioPlayback(); const p=_player(); _audioPlayUrl=makeUrl(lastAudio.blob);
  p.src=_audioPlayUrl; try{ p.currentTime=0; }catch(e){} p.play().catch(()=>{}); const b=$("a-play"); if(b)b.textContent="■ STOP"; }
export function toggleAudioPlayback(){ if(isAudioPlaying())stopAudioPlayback(); else playAudio(); }
/* In-flight guard: renders run for seconds (auto-extend allows up to 120s), and
   two concurrent ones would race the library row — on a first render both see
   lastLibId=null and both add. Mirrors the vRecording guard on the video tab. */
let aRendering=false;
export async function doRenderAudio(){ if(aRendering)return; aRendering=true; const rb=$("a-render"); if(rb)rb.disabled=true;
  stopAudioPlayback(); cancelLive(); $("a-status").textContent="Rendering..."; try{ const r=await renderAudio(); if(!r)return;
    /* Region edits replay on EVERY render rather than being applied once to a
       buffer. That is what makes them part of the project rather than a
       destructive button: they undo, they save, and the same project always
       produces the same wave. */
    const beforeLen=r.channels[0].length;
    const edited=applyRegions(r.channels, r.sr, regions());
    if(edited!==r.channels){
      r.channels=edited; r.data=edited[0];
      // "Crop to" changes the length — the status line, the library row and the
      // bed picker all quote r.duration, so it must follow the edit.
      r.duration=edited[0].length/r.sr;
      /* …and it throws away the ends the edge fades were ramped onto, so what
         is left begins and ends mid-signal. Re-ramp the NEW edges: a cropped
         .wav used to click at both ends and the author's Fade setting was
         quietly not honoured. Only when the length actually changed — an edit
         that leaves the ends alone already carries its fade. */
      const cfg=readAudioCfg();
      if(edited[0].length!==beforeLen && !cfg.loop) applyEdgeFades(r.channels, r.sr, cfg.fade);
      log("Audio edits: "+regions().length+" applied — "+r.duration.toFixed(2)+"s.","info");
    }
    lastAudio=r; bumpAudioRev(); drawWaveform(r.channels); setRegionDuration(r.channels[0].length/r.sr);
    const pr=bufferPeakRms(r.channels); const db=(pr.peak>0?20*Math.log10(pr.peak):-99); $("a-peak").style.width=Math.min(100,pr.peak*100)+"%"; $("a-peakv").textContent=db.toFixed(1)+"dB";
    if(pr.peak>0.999){ setBanner("a-banners",[{msg:"Clipping (peak ≥ 0dBFS). Normalize or lower levels.",fix:()=>{$("a-norm").click();}}]); } else clearBanner("a-banners");
    $("a-play").disabled=false; $("a-dl").disabled=false; $("a-norm").disabled=false; $("a-stale").textContent="fresh"; $("a-stale").className="badge2";
    $("a-status").textContent="Rendered "+r.duration.toFixed(1)+"s · "+(r.channels.length>1?"stereo":"mono")+" · peak "+db.toFixed(1)+"dB.";
    const psel=val("a-preset"); const nm=(psel&&psel!=="— custom —")?psel:(val("a-morse-w")||"audio");
    lastAudio.blob=encodeWav(r.channels,r.sr,r.bits);
    // Re-rendering while dialling in a sound reuses the row the last render
    // made, rather than stacking another near-identical take into the library
    // the BUNDLE tab ships. replaceItem() refuses once the row has been renamed
    // or anything newer exists, so a take the author cared about is never lost.
    const dur=+r.duration.toFixed(1);
    const it=(lastLibId!=null && replaceItem(lastLibId,lastAudio.blob,lastLibName,dur))
             || addToLibrary(lastAudio.blob,"wav","music",slug(nm),dur);
    lastAudio.libId=it.id; lastLibId=it.id; lastLibName=it.name;
    /* Auto-level lifts a quiet render AND pulls a hot one down. The guard used
       to be `peak < 0.985`, which excluded every clipping render — the one case
       the control exists for. A render at 0dBFS got no auto-level, an amber
       "Clipping" banner, and a status line that never said why. normalizeAudio()
       scales to 0.97 in either direction, so the only thing worth skipping is a
       render that is already there. */
    const TARGET=0.97, SLACK=0.015;
    if(chk("a-autonorm") && pr.peak>0 && Math.abs(pr.peak-TARGET)>SLACK){
      normalizeAudio(); const p2=bufferPeakRms(lastAudio.channels); const db2=(p2.peak>0?20*Math.log10(p2.peak):-99);
      $("a-peak").style.width=Math.min(100,p2.peak*100)+"%"; $("a-peakv").textContent=db2.toFixed(1)+"dB";
      $("a-status").textContent="Rendered "+r.duration.toFixed(1)+"s · auto-leveled "
        +(pr.peak>TARGET?"down":"up")+" to "+db2.toFixed(1)+"dB.";
      // The banner was raised against the pre-normalise peak. It is gone now.
      clearBanner("a-banners"); }
  }catch(e){ log("Audio render failed: "+e.message,"err"); $("a-status").textContent="Render failed."; }
  finally{ aRendering=false; const b=$("a-render"); if(b)b.disabled=false; } }
export function normalizeAudio(){ if(!lastAudio)return; const pr=bufferPeakRms(lastAudio.channels); if(pr.peak<=0)return; const g=0.97/pr.peak;
  // Rescales lastAudio.channels IN PLACE, so anything holding those arrays —
  // the bed's 'last' choice, the lane's waveform thumbnails — is now stale.
  bumpAudioRev();
  // ONE gain for every channel. Normalising each to its own peak would move the
  // stereo image — a sound panned left would drift towards the middle.
  for(const d of lastAudio.channels) for(let i=0;i<d.length;i++) d[i]*=g;
  drawWaveform(lastAudio.channels); lastAudio.blob=encodeWav(lastAudio.channels,lastAudio.sr,lastAudio.bits);
  // Re-link the library item so the row download / preview / campaign-bundle .zip
  // all ship the NORMALIZED audio, not the original blob the render created —
  // and so the stored copy is the normalised one after a reload too.
  refreshItemBlob(lastAudio.libId, lastAudio.blob);
  $("a-peak").style.width="97%"; $("a-peakv").textContent="-0.3dB"; clearBanner("a-banners"); toast("Normalized to -0.3dBFS"); log("Audio normalized (library updated).","ok"); }
export function initAudioTab(){
  // audio
  initRegions(()=>markAudioStale());
  /* After buildAudioLayerControls() — which boot ran long before this — because
     sixteen of the twenty-six enable checkboxes the buttons attach to are
     generated. */
  initSolo(()=>markAudioStale());
  $("a-preset").addEventListener("change", ()=>loadPreset("audio","view-audio"));
  $("a-render").addEventListener("click", doRenderAudio); $("a-play").addEventListener("click", toggleAudioPlayback);
  $("a-dl").addEventListener("click", ()=>{ if(lastAudio&&lastAudio.blob) download(lastAudio.blob, slug(val("a-morse-w")||"audio")+".wav"); });
  $("a-norm").addEventListener("click", normalizeAudio); $("a-savepreset").addEventListener("click", ()=>saveUserPreset("audio","view-audio"));
  if($("a-loadaudio")){
    $("a-loadaudio").addEventListener("click", ()=>$("a-samplefile").click());
    $("a-samplefile").addEventListener("change", async (e)=>{
      const f=e.target.files&&e.target.files[0]; $("a-samplefile").value="";   /* dom-only: file input, not a document control */
      if(!f)return;
      try{
        const clip=await loadAudioFile(f);
        // Enable it on import: nobody imports a file in order to leave it off,
        // and a silent render after a successful import reads as a failure.
        setVal("a-sample",true);
        updateSampleName(); markAudioStale(); updateAudioLayerFlags();
        toast("Audio imported");
        log("Imported "+clip.name+" — "+clip.duration.toFixed(1)+"s, "
            +clip.channels.length+"ch @ "+clip.sampleRate+"Hz","ok");
      }catch(err){
        toast("Could not import that audio","err");
        log("Audio import failed: "+err.message,"err");
      }
    });
  }
  updateSampleName();
  wireLive("view-audio",()=>{ markAudioStale(); updateAudioLayerFlags(); });
}
export function updateSampleName(){ const t=$("a-sample-name"); if(!t)return;
  t.textContent = hasImportedAudio()
    ? importedAudioName()+" · "+importedAudio().duration.toFixed(1)+"s"
    : "none loaded"; }
export function markAudioStale(){ const b=$("a-stale"); if(b){ b.textContent="stale"; b.className="badge2 stale"; } if($("a-dl"))$("a-dl").disabled=true; }
/* ============================================================================
   SCREEN — Win95 chrome engine + templates + still FX + export
   ========================================================================== */
