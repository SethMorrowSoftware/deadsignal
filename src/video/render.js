/* Dead Signal Studio — video/render.js */
import { $, chk, clamp, esc, num, val } from '../core/dom.js';
import { MAX_DIM, MIN_H, MIN_W } from '../core/formats.js';
import { beginFrame, currentSeed, rrange, seedStream } from '../core/rng.js';
import { DEFAULT_FONT, corrupt, fullwidth, glowText, macros, morseOf, setFont, setFontStack, setTracking } from '../core/text.js';
import { applyCrtStack } from '../fx/crt.js';
import { cfgAt, videoTracks } from './automation.js';
import { drawFilters, videoFilters } from './filters.js';
import { drawLayers, videoLayers } from './layers.js';
import { SCENES, scene } from './scenes.js';
import { timeline } from './timeline.js';

export function fmtTC(startStr,tSec){ const p=esc(startStr||"00:00:00").split(":").map(n=>+n||0); let s=(p[0]||0)*3600+(p[1]||0)*60+(p[2]||0)+Math.floor(tSec);
  return [Math.floor(s/3600)%100,Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,"0")).join(":"); }
/* The blink overlay's word branch, as an on/off unit timeline: dot = 1 on,
   dash = 3 on, 1 off between elements, 3 between letters, 7 between words and
   before the cycle repeats. The old form stripped morseOf's separators and lit
   one unit per remaining character — a dash was indistinguishable from a dot,
   no gap ever occurred, and the whole word merged into one sustained flash:
   undecodable by construction. Memoised because it is rebuilt per frame. */
let _blinkKey=null,_blinkPat=null;
function blinkPattern(word){
  if(word===_blinkKey) return _blinkPat;
  const pat=[]; const off=(n)=>{ for(let i=0;i<n;i++)pat.push(0); }; const lit=(n)=>{ for(let i=0;i<n;i++)pat.push(1); };
  const code=morseOf(word).trim().replace(/\s*\/\s*/g,"/");
  for(const ch of code){
    if(ch===".") { lit(1); off(1); }
    else if(ch==="-") { lit(3); off(1); }
    else if(ch===" ") off(2);       // 1 already after the element → 3, a letter gap
    else if(ch==="/") off(6);       // → 7, a word gap
  }
  if(pat.length) off(6);            // close the cycle with a word gap
  _blinkKey=word; _blinkPat=pat; return pat;
}
export function drawOverlays(ctx,W,H,cfg,t){
  if(cfg.hud){ ctx.save(); ctx.fillStyle="rgba(0,0,0,.55)"; ctx.fillRect(0,0,W,18); setFont(ctx,11); ctx.textBaseline="middle";
    glowText(ctx,macros(cfg.hud).slice(0,64),6,10,cfg.fg,0); ctx.restore(); }
  if(cfg.tc){ ctx.save(); setFont(ctx,12); ctx.textAlign="right"; ctx.textBaseline="bottom"; ctx.globalAlpha=.85;
    glowText(ctx,fmtTC(cfg.tcstart,t),W-6,H-5,cfg.fg,0); ctx.restore(); }
  if(cfg.morse){ const code=morseOf(cfg.morse).replace(/\s+/g,""); if(code){ const unit=0.12; const total=code.length*unit; const phase=(t%(total+0.6))/unit;
    ctx.save(); ctx.fillStyle=cfg.fg; ctx.globalAlpha=.9; let x=6; const y=H-22; for(let i=0;i<code.length;i++){ const w=code[i]==="-"?16:6; if(i<=phase)ctx.fillRect(x,y,w,6); x+=w+5; if(x>W-10)break; } ctx.restore(); } }
  // whole-screen blink code (word->morse flashes, number->N flashes over clip)
  if(cfg.blink){ let on=false; const b=cfg.blink.trim();
    if(/^\d+$/.test(b)){ const N=+b; const per=cfg.duration/(N*2); on=(Math.floor(t/per)%2)===0 && Math.floor(t/per)<N*2; }
    else { const pat=blinkPattern(b); const u=0.14; if(pat.length) on=pat[Math.floor(t/u)%pat.length]===1; }
    if(on){ ctx.fillStyle="rgba(255,255,255,.12)"; ctx.fillRect(0,0,W,H); } }
  if(cfg.reveal && t>=cfg.duration-cfg.revhold){ ctx.save(); ctx.fillStyle="rgba(0,0,0,.35)"; ctx.fillRect(0,0,W,H);
    ctx.textAlign="center"; ctx.textBaseline="middle"; const fs=Math.min(W/Math.max(4,cfg.reveal.length)*1.5,H*0.32); setFont(ctx,fs);
    glowText(ctx,cfg.reveal,W/2,H/2,cfg.fg,18); ctx.restore(); }
  // subliminal frame
  if(cfg.sub){ const fps=cfg.fps||12; const at = cfg.subat>=0 ? cfg.subat : (0.2+((currentSeed()%1000)/1000)*(cfg.duration-1));
    const f0=Math.floor(at*fps), fnow=Math.floor(t*fps); if(fnow>=f0 && fnow<f0+(cfg.subframes||2)){ ctx.fillStyle="#000"; ctx.fillRect(0,0,W,H);
      ctx.save(); ctx.textAlign="center"; ctx.textBaseline="middle"; setFont(ctx,Math.min(W*0.2,H*0.3)); glowText(ctx,cfg.sub,W/2,H/2,"#fff",12); ctx.restore(); } }
}
const expandLayerText=(list)=>Array.isArray(list)
  ? list.map(L=>(L&&L.text?{...L,text:macros(L.text)}:L))
  : list;
// Reads the VIDEO recipe from the DOM, or from a plain recipe object `rec`
// (used by the timeline to render captured clips without touching the live UI).
export function readVideoCfg(rec){
  const V = rec ? (id)=>(rec[id]!=null?String(rec[id]):"") : val;
  const N = rec ? (id,d)=>{ const x=parseFloat(rec[id]); return isNaN(x)?(d||0):x; } : num;
  const C = rec ? (id)=>!!rec[id] : chk;
  const P = (id)=>clamp(N(id,0)/100,0,1);
  /* Every author-typed string is expanded HERE, at the one point every render
     path goes through. It used to be each scene's job, and only about half of
     them did it — so {{seed}} rendered as literal braces on Snow, HUD, City
     Rain, Breach, Neon Grid, Statue and both import scenes, while working fine
     on Terminal. A macro that works depending on which scene you picked is
     worse than no macro at all. The scenes' own macros() calls stay: they still
     expand the hardcoded DEFAULT text a scene falls back to when the box is
     empty, and a second pass over already-expanded text is a no-op. */
  const M = (id)=>macros(V(id));
  return {
  W:clamp(N("v-w",320),MIN_W,MAX_DIM), H:clamp(N("v-h",240),MIN_H,MAX_DIM), fps:clamp(N("v-fps",12),4,30), duration:clamp(N("v-dur",10),1,60),
  bg:V("v-bg"), fg:V("v-fg"), scene:V("v-scene")||"terminal",
  /* Which imported file this clip's Video In plays. Part of the recipe, so it
     is captured with the clip — before this, every videoin clip drew from one
     module-level element and a sequence could not cut between two files. */
  srcKey:V("v-srckey"),
  text:M("v-text"), textMode:V("v-textmode"), fullwidth:C("v-fullwidth"), font:clamp(N("v-font",16),6,72), cps:clamp(N("v-cps",14),1,120), align:V("v-align"), lspace:clamp(N("v-lspace",0),-10,40)/100, cursor:C("v-cursor"), corrupt:P("v-corrupt"),
  fontFamily:V("v-fontfam")||DEFAULT_FONT, wrap:C("v-wrap"),
  hud:M("v-hud").trim(), tc:C("v-tc"), tcstart:V("v-tcstart").trim(), morse:M("v-morse").trim(), blink:V("v-blink").trim(),
  scan:P("v-scan"), noise:P("v-noise"), vig:P("v-vig"), flick:P("v-flick"), glitch:P("v-glitch"), chroma:P("v-chroma"), bloom:P("v-bloom"),
  persist:P("v-persist"), mask:P("v-mask"), hum:P("v-hum"), track:P("v-track"), shake:P("v-shake"), roll:P("v-roll"), dither:C("v-dither"),
  reveal:M("v-reveal").trim(), revhold:clamp(N("v-revhold",1.2),0,10), sub:M("v-sub").trim(), subat:N("v-subat",-1), subframes:clamp(N("v-subframes",2),1,10),
  fade:clamp(N("v-fade",0),0,6), ss:C("v-ss"), audioReact:C("v-audioreact"), bitrate:N("v-bitrate",0),
  // Which sound the clip carries. Part of the recipe, so it is captured into a
  // timeline clip and restored with the project like every other setting.
  audioBed:V("v-audio"),
  // Keyframe tracks ride ON the cfg rather than being looked up at render
  // time, so a timeline clip evaluates the automation it was captured with
  // instead of whatever the live video tab happens to hold right now.
  __auto: rec ? (rec.__auto||null) : videoTracks(),
  // A layer's own text gets the same macro expansion the base's does, and for
  // the same reason: {{subject}} has to mean the same thing wherever it is
  // written. Expanded here rather than stored expanded, so changing a variable
  // updates a captured timeline clip too.
  __layers: expandLayerText(rec ? (rec.__layers||null) : videoLayers()),
  __filters: rec ? (rec.__filters||null) : videoFilters(),
}; }
let _persistC=null;
export const _persistCanvas=()=>_persistC||(_persistC=document.createElement("canvas"));
export function renderVideoFrame(ctx,W,H,cfg,t){
  // Keyframed parameters resolve here, at the one point every caller goes
  // through — preview, scrub, record, GIF, frame strip and the timeline all
  // land on this function, so they cannot disagree about what frame t looks
  // like. Returns the same object untouched when nothing is automated.
  cfg=cfgAt(cfg,t);
  // Set once per frame, before anything draws. Every setFont() call in every
  // scene, overlay and filter reads it, which is what keeps ~40 call sites
  // untouched — and what makes a timeline clip render in the family it was
  // captured with rather than whatever the live tab is showing.
  setFontStack(cfg.fontFamily); setTracking(cfg.lspace);
  // Frame-addressed randomness. Quantising to the frame index (rather than
  // using the raw float t) keeps a scrubbed frame, a played frame, and an
  // exported frame identical — seek and playback must agree.
  beginFrame(Math.round(t*(cfg.fps||12)));
  ctx.save();
  seedStream("shake");
  if(cfg.shake>0){ const a=cfg.shake*6; ctx.translate(rrange(-a,a),rrange(-a,a)); ctx.rotate(rrange(-1,1)*cfg.shake*0.02); }
  ctx.fillStyle=cfg.bg; ctx.fillRect(-20,-20,W+40,H+40);
  (SCENES[cfg.scene]||SCENES.terminal).draw(ctx,W,H,cfg,t);
  // Extra scenes composite over the base, inside the same transform so shake
  // moves the whole stack rather than sliding the base out from under it.
  drawLayers(ctx,W,H,cfg,t);
  drawOverlays(ctx,W,H,cfg,t);
  ctx.restore();
  // Phosphor afterglow. This runs AFTER the scene, not before: 15 of the 22
  // scenes open by filling their own background, which erased the persistence
  // buffer before anything was drawn over it — so the effect did nothing on
  // any of them. Compositing with "lighter" is also what actually happens on
  // a slow phosphor: residual light from the previous frame ADDS to the new
  // one, leaving trails on bright content and nothing on black.
  if(cfg.persist>0){
    ctx.save(); ctx.setTransform(1,0,0,1,0,0);
    ctx.globalAlpha=cfg.persist*0.85; ctx.globalCompositeOperation="lighter";
    ctx.drawImage(_persistCanvas(),0,0,ctx.canvas.width,ctx.canvas.height);
    ctx.restore();
    // Store the picture BEFORE the CRT stack, or grain and scanlines would
    // accumulate into the trail on every frame and wash the image out.
    _persistCanvas().width=ctx.canvas.width; _persistCanvas().height=ctx.canvas.height;
    const pc=_persistCanvas().getContext("2d");
    pc.setTransform(1,0,0,1,0,0); pc.drawImage(ctx.canvas,0,0);
  }
  applyCrtStack(ctx,W,H,cfg,t);
  // The author's own chain runs LAST, over the finished CRT look. Composing on
  // top rather than replacing is what keeps every existing project and preset
  // rendering exactly as it did — an empty chain is a no-op.
  drawFilters(ctx,W,H,cfg,t);
  if(cfg.fade>0){ const fin=clamp(t/cfg.fade,0,1), fout=clamp((cfg.duration-t)/cfg.fade,0,1); const a=1-Math.min(fin,fout);
    if(a>0){ ctx.fillStyle="rgba(0,0,0,"+a+")"; ctx.fillRect(0,0,W,H); } }
}
/* render one frame respecting supersample: draw at 2x offscreen then downscale to ctx */
let _ssC=null;
export const _ss=()=>_ssC||(_ssC=document.createElement("canvas"));
export function renderScaled(ctx,W,H,cfg,t){
  if(cfg.ss){ _ss().width=W*2; _ss().height=H*2; const sc=_ss().getContext("2d"); sc.save(); sc.scale(2,2);
    renderVideoFrame(sc,W,H,cfg,t); sc.restore(); ctx.imageSmoothingEnabled=true; ctx.drawImage(_ss(),0,0,W,H); }
  else renderVideoFrame(ctx,W,H,cfg,t);
}
/* preview loop + scrubber */
