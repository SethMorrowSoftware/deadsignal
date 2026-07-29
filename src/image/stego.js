/* Dead Signal Studio — image/stego.js */
import { $, log, toast } from '../core/dom.js';
import { hexToRgb } from '../core/text.js';
import { readImageCfg, renderImage } from './render.js';
import { template } from './templates.js';

export function embedStego(ctx,W,H,msg,bg){ const bytes=new TextEncoder().encode(msg);
  if(bytes.length>4096){ log("Stego message too large (>4096 bytes); not embedded.","warn"); toast("Stego message too long","err"); return; }
  const img=ctx.getImageData(0,0,W,H),d=img.data; const bits=[];
  const len=bytes.length; for(let i=31;i>=0;i--) bits.push((len>>i)&1); bytes.forEach(b=>{ for(let i=7;i>=0;i--) bits.push((b>>i)&1); });
  if(bits.length>W*H){ log("Stego message too large for image.","warn"); return; }
  // Write blue-LSB AND force the carrier pixel opaque — premultiplied canvas
  // stores would otherwise clobber the LSB of any pixel with alpha<255 (e.g. a
  // transparent-background template), silently destroying the payload. A fully
  // transparent carrier reads back as rgb(0,0,0), so forcing it opaque as-is
  // painted a black dash across a transparent export — give those pixels the
  // template background colour first.
  const bgRgb=bg?hexToRgb(bg):null;
  for(let i=0;i<bits.length;i++){ const p=i*4; if(bgRgb&&d[p+3]===0){ d[p]=bgRgb[0]; d[p+1]=bgRgb[1]; d[p+2]=bgRgb[2]; } d[p+2]=(d[p+2]&0xFE)|bits[i]; d[p+3]=255; } ctx.putImageData(img,0,0); }
export function decodeStego(){ const c=readImageCfg(); renderImage({chrome:false}); const ctx=$("icanvas").getContext("2d"); const img=ctx.getImageData(0,0,c.W,c.H).data;
  let len=0; for(let i=0;i<32;i++) len=(len<<1)|(img[i*4+2]&1); if(len<=0||len>4096){ toast("No stego payload found","err"); return null; }
  const out=new Uint8Array(len); for(let b=0;b<len;b++){ let v=0; for(let i=0;i<8;i++){ const bit=img[(32+b*8+i)*4+2]&1; v=(v<<1)|bit; } out[b]=v; }
  const msg=new TextDecoder().decode(out); toast("STEGO: "+msg); log("Decoded stego: "+msg,"ok"); return msg; }
/* ============================================================================
   LIBRARY + BUNDLE + ZIP
   ========================================================================== */
