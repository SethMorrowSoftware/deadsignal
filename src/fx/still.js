/* Dead Signal Studio — fx/still.js */
import { rnd } from '../core/rng.js';
import { hexToRgb } from '../core/text.js';
import { _scratch, fxBloom, fxChroma, fxDeadPixels, fxNoise, fxScanlines, fxVignette } from './crt.js';

export function lum(d,i){ return d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114; }
export function lerp(a,b,x){ return a+(b-a)*x; }
export function fxDuotone(ctx,W,H,bg,fg){ const c0=hexToRgb(bg),c1=hexToRgb(fg); const img=ctx.getImageData(0,0,W,H),d=img.data;
  for(let i=0;i<d.length;i+=4){ const l=lum(d,i)/255; d[i]=lerp(c0[0],c1[0],l); d[i+1]=lerp(c0[1],c1[1],l); d[i+2]=lerp(c0[2],c1[2],l); } ctx.putImageData(img,0,0); }
export function fxPosterize(ctx,W,H,levels){ const L=Math.max(2,Math.round(levels)); const step=255/(L-1); const img=ctx.getImageData(0,0,W,H),d=img.data;
  for(let i=0;i<d.length;i+=4){ d[i]=Math.round(d[i]/step)*step; d[i+1]=Math.round(d[i+1]/step)*step; d[i+2]=Math.round(d[i+2]/step)*step; } ctx.putImageData(img,0,0); }
export function fxHalftone(ctx,W,H,cell,bg,fg){ const src=ctx.getImageData(0,0,W,H).data; const c0=hexToRgb(bg),c1=hexToRgb(fg); ctx.fillStyle=bg; ctx.fillRect(0,0,W,H); ctx.fillStyle=fg;
  const s=Math.max(3,cell); for(let y=0;y<H;y+=s){ for(let x=0;x<W;x+=s){ let sum=0,n=0; for(let yy=y;yy<Math.min(H,y+s);yy++)for(let xx=x;xx<Math.min(W,x+s);xx++){ sum+=lum(src,(yy*W+xx)*4); n++; } const l=sum/(n||1)/255; const r=(1-l)*s*0.62; if(r>0.4){ ctx.beginPath(); ctx.arc(x+s/2,y+s/2,r,0,7); ctx.fill(); } } } }
export function fxPixelSort(ctx,W,H,amt){ const img=ctx.getImageData(0,0,W,H),d=img.data; const lo=60+(1-amt)*120, hi=200; // sort bright spans per row
  // The span-START test must match the span-CONTINUE test. A pixel with
  // lum>=hi (any white template) would otherwise enter the branch, produce an
  // empty span, and never advance x — an infinite loop on the main thread.
  for(let y=0;y<H;y++){ let x=0; while(x<W){ const l=lum(d,(y*W+x)*4); if(l>lo&&l<hi){ let s=x; while(x<W && lum(d,(y*W+x)*4)>lo && lum(d,(y*W+x)*4)<hi) x++; const span=[]; for(let k=s;k<x;k++){ const i=(y*W+k)*4; span.push([d[i],d[i+1],d[i+2],d[i+3],lum(d,i)]); }
      span.sort((a,b)=>a[4]-b[4]); for(let k=0;k<span.length;k++){ const i=(y*W+s+k)*4; d[i]=span[k][0]; d[i+1]=span[k][1]; d[i+2]=span[k][2]; d[i+3]=span[k][3]; } } else x++; } }
  ctx.putImageData(img,0,0); }
export function applyStillFx(ctx,W,H,c){
  if(c.duotone) fxDuotone(ctx,W,H,c.bg,c.fg);
  if(c.posterize>0) fxPosterize(ctx,W,H,2+Math.round((1-c.posterize)*10));
  if(c.halftone>0) fxHalftone(ctx,W,H,3+Math.round(c.halftone*10),c.bg,c.fg);
  if(c.pixsort>0) fxPixelSort(ctx,W,H,c.pixsort);
  if(c.chroma>0||c.bloom>0){ _scratch().width=W; _scratch().height=H; _scratch().getContext("2d").drawImage(ctx.canvas,0,0); fxChroma(_scratch(),ctx,W,H,c.chroma); fxBloom(_scratch(),ctx,W,H,c.bloom); }
  if(c.copy>0){ const img=ctx.getImageData(0,0,W,H),d=img.data; const th=128+(1-c.copy)*80; for(let i=0;i<d.length;i+=4){ const l=(d[i]*0.3+d[i+1]*0.59+d[i+2]*0.11); if(rnd()>c.copy*0.4){ const v=l>th?245:20; d[i]=d[i+1]=d[i+2]=v; } } ctx.putImageData(img,0,0); }
  if(c.dead>0) fxDeadPixels(ctx,W,H,c.dead);
  fxNoise(ctx,W,H,c.noise); fxScanlines(ctx,W,H,c.scan); fxVignette(ctx,W,H,c.vig);
}
