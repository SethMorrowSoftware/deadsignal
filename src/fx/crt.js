/* Dead Signal Studio — fx/crt.js */
import { tone } from '../audio/engine.js';
import { rnd, rrange, seedStatic, seedStream } from '../core/rng.js';
import { hexToRgb } from '../core/text.js';
import { lum } from './still.js';

export function fxScanlines(ctx,W,H,amt){ if(amt<=0)return; ctx.save(); ctx.fillStyle="#000"; ctx.globalAlpha=0.08+amt*0.34;
  for(let y=0;y<H;y+=3) ctx.fillRect(0,y,W,1); ctx.restore(); }
export function fxNoise(ctx,W,H,amt){ if(amt<=0)return; seedStream("noise"); const n=Math.floor(W*H*amt*0.10); ctx.save();
  for(let i=0;i<n;i++){ const x=(rnd()*W)|0,y=(rnd()*H)|0,v=(rnd()*255)|0;
    ctx.fillStyle="rgba("+v+","+v+","+v+","+(0.05+amt*0.13)+")"; ctx.fillRect(x,y,1,1);} ctx.restore(); }
export function fxVignette(ctx,W,H,amt){ if(amt<=0)return; const g=ctx.createRadialGradient(W/2,H/2,H*0.2,W/2,H/2,H*0.78);
  g.addColorStop(0,"rgba(0,0,0,0)"); g.addColorStop(1,"rgba(0,0,0,"+(0.3+amt*0.6)+")"); ctx.fillStyle=g; ctx.fillRect(0,0,W,H); }
export function fxMask(ctx,W,H,amt){ if(amt<=0)return; ctx.save(); ctx.globalCompositeOperation="multiply"; ctx.globalAlpha=amt*0.5;
  for(let x=0;x<W;x+=3){ ctx.fillStyle="rgba(255,80,80,1)"; ctx.fillRect(x,0,1,H);
    ctx.fillStyle="rgba(80,255,80,1)"; ctx.fillRect(x+1,0,1,H); ctx.fillStyle="rgba(80,80,255,1)"; ctx.fillRect(x+2,0,1,H); }
  ctx.restore(); }
export function fxHumBar(ctx,W,H,amt,t){ if(amt<=0)return; const y=((t*0.35)%1)*H; const bh=Math.max(8,H*0.14); ctx.save();
  const g=ctx.createLinearGradient(0,y,0,y+bh); g.addColorStop(0,"rgba(255,255,255,0)"); g.addColorStop(0.5,"rgba(255,255,255,"+(amt*0.10)+")"); g.addColorStop(1,"rgba(255,255,255,0)");
  ctx.fillStyle=g; ctx.fillRect(0,y,W,bh); ctx.restore(); }
export function fxChroma(srcCanvas,ctx,W,H,amt){ if(amt<=0)return; const d=Math.round(amt*4)+1; ctx.save();
  ctx.globalCompositeOperation="lighter"; ctx.globalAlpha=0.5;
  ctx.drawImage(srcCanvas,-d,0); ctx.drawImage(srcCanvas,d,0); ctx.restore(); }
export function fxBloom(srcCanvas,ctx,W,H,amt){ if(amt<=0)return; ctx.save(); ctx.globalCompositeOperation="lighter"; ctx.globalAlpha=amt*0.5;
  try{ ctx.filter="blur("+(1+amt*3)+"px)"; }catch(e){} ctx.drawImage(srcCanvas,0,0,W,H); ctx.filter="none"; ctx.restore(); }
export function fxTracking(ctx,srcCanvas,W,H,amt,t){ if(amt<=0)return; seedStream("tracking"); const bands=3+Math.floor(amt*4);
  for(let i=0;i<bands;i++){ const y=(rnd()*H)|0, h=Math.max(2,(rnd()*H*0.06)|0), off=(rrange(-1,1)*amt*20)|0;
    ctx.drawImage(srcCanvas,0,y,W,h,off,y,W,h); }
  const by=H-6-((t*4)%3|0); ctx.save(); ctx.globalAlpha=amt*0.8; for(let x=0;x<W;x+=2){ const v=(rnd()*255)|0; ctx.fillStyle="rgba("+v+","+v+","+v+",.9)"; ctx.fillRect(x,by,2,6);} ctx.restore(); }
export function fxDeadPixels(ctx,W,H,amt){ if(amt<=0)return; const n=Math.floor(amt*40); seedStatic("deadpixels");
  for(let i=0;i<n;i++){ const x=(rnd()*W)|0,y=(rnd()*H)|0; ctx.fillStyle= rnd()<0.5?"#000":"#fff"; ctx.fillRect(x,y,1,1);} }
export function fxDither(ctx,W,H,bg,fg){ // ordered 4x4 bayer -> two-tone palette
  const bay=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]]; const img=ctx.getImageData(0,0,W,H); const d=img.data;
  const c0=hexToRgb(bg), c1=hexToRgb(fg);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){ const i=(y*W+x)*4; const lum=(d[i]*0.3+d[i+1]*0.59+d[i+2]*0.11)/255;
    const th=(bay[y&3][x&3]+0.5)/16; const on=lum>th?1:0; const c=on?c1:c0; d[i]=c[0]; d[i+1]=c[1]; d[i+2]=c[2]; }
  ctx.putImageData(img,0,0); }
/* Full video CRT stack applied AFTER a scene draws into `work`. Uses a scratch copy for chroma/bloom. */
// Lazy: creating a canvas at module scope makes the module un-importable
// outside a browser. These are scratch caches, so defer until first use.
let _scratchC=null;
export const _scratch=()=>_scratchC||(_scratchC=document.createElement("canvas"));
// The CRT stack runs in DEVICE space (ctx.canvas pixels), with the transform
// reset to identity — otherwise a 2×-supersampled frame (drawn under scale(2,2))
// makes the W×H scratch capture only the top-left quarter of the source.
let _rollC=null;
export const _roll=()=>_rollC||(_rollC=document.createElement("canvas"));
export function applyCrtStack(ctx,_W,_H,cfg,t){
  ctx.save(); ctx.setTransform(1,0,0,1,0,0);
  const W=ctx.canvas.width, H=ctx.canvas.height;
  // vertical hold "roll": the picture scrolls up and wraps, with a tear line —
  // like a mistuned CRT. Applied first so CRT artifacts sit on the rolled image.
  if(cfg.roll>0){ _roll().width=W; _roll().height=H; _roll().getContext("2d").drawImage(ctx.canvas,0,0);
    const y=Math.floor(((t*(0.15+cfg.roll*0.9))%1)*H); ctx.clearRect(0,0,W,H);
    if(y>0) ctx.drawImage(_roll(),0,H-y,W,y,0,0,W,y); ctx.drawImage(_roll(),0,0,W,H-y,0,y,W,H-y);
    ctx.fillStyle="rgba(0,0,0,.55)"; ctx.fillRect(0,y,W,2); }
  if(cfg.chroma>0||cfg.bloom>0){ _scratch().width=W; _scratch().height=H; const sc=_scratch().getContext("2d");
    sc.setTransform(1,0,0,1,0,0); sc.clearRect(0,0,W,H); sc.drawImage(ctx.canvas,0,0);
    fxChroma(_scratch(),ctx,W,H,cfg.chroma); fxBloom(_scratch(),ctx,W,H,cfg.bloom); }
  if(cfg.track>0){ _scratch().width=W; _scratch().height=H; const sc=_scratch().getContext("2d"); sc.setTransform(1,0,0,1,0,0); sc.drawImage(ctx.canvas,0,0); fxTracking(ctx,_scratch(),W,H,cfg.track,t); }
  fxHumBar(ctx,W,H,cfg.hum,t);
  fxNoise(ctx,W,H,cfg.noise);
  fxMask(ctx,W,H,cfg.mask);
  fxScanlines(ctx,W,H,cfg.scan);
  fxVignette(ctx,W,H,cfg.vig);
  seedStream("flicker");
  if(cfg.flick>0 && rnd()<cfg.flick*0.25){ ctx.fillStyle="rgba(255,255,255,"+(cfg.flick*0.06)+")"; ctx.fillRect(0,0,W,H); }
  if(cfg.dither){ fxDither(ctx,W,H,cfg.bg,cfg.fg); }
  ctx.restore();
}
/* ---------- shared drawing helpers ---------- */
