/* Dead Signal Studio — image/stego.js */
import { $, log, toast } from '../core/dom.js';
import { hexToRgb } from '../core/text.js';
import { readImageCfg, renderImage } from './render.js';
import { template } from './templates.js';

/** Bytes of payload a W×H screen can carry: one bit per pixel, less the length header. */
export const stegoCapacity=(W,H)=>Math.max(0,Math.floor((Math.max(0,W*H)-32)/8));
/** Hard ceiling, whatever the frame: the length header is 32 bits and the decoder rejects more. */
export const STEGO_MAX=4096;

export function embedStego(ctx,W,H,msg,bg){ const bytes=new TextEncoder().encode(msg);
  /* BOTH LIMITS SAY THE SAME THING, OUT LOUD.
     The 4096-byte ceiling toasted; the per-frame capacity — which is the one an
     author actually hits, because a 120×90 screen holds 1346 bytes, not 4096 —
     only wrote a line to the log panel and returned. So a message that was too
     long for the picture exported a PNG with no payload in it, said nothing
     where anyone was looking, and the in-tool decoder reads the LIVE canvas, so
     even checking it in the tool could not tell you. Both now name the number
     they are measured against. */
  const room=Math.min(STEGO_MAX,stegoCapacity(W,H));
  if(bytes.length>room){
    const why=bytes.length+" bytes, and this "+W+"×"+H+" screen holds "+room;
    log("Stego message too large — not embedded ("+why+").","warn");
    toast("Stego too long for this size — holds "+room+" bytes","err");
    return false;
  }
  const img=ctx.getImageData(0,0,W,H),d=img.data; const bits=[];
  const len=bytes.length; for(let i=31;i>=0;i--) bits.push((len>>i)&1); bytes.forEach(b=>{ for(let i=7;i>=0;i--) bits.push((b>>i)&1); });
  // Write blue-LSB AND force the carrier pixel opaque — premultiplied canvas
  // stores would otherwise clobber the LSB of any pixel with alpha<255 (e.g. a
  // transparent-background template), silently destroying the payload. A fully
  // transparent carrier reads back as rgb(0,0,0), so forcing it opaque as-is
  // painted a black dash across a transparent export — give those pixels the
  // template background colour first.
  const bgRgb=bg?hexToRgb(bg):null;
  for(let i=0;i<bits.length;i++){ const p=i*4; if(bgRgb&&d[p+3]===0){ d[p]=bgRgb[0]; d[p+1]=bgRgb[1]; d[p+2]=bgRgb[2]; } d[p+2]=(d[p+2]&0xFE)|bits[i]; d[p+3]=255; } ctx.putImageData(img,0,0); return true; }
export function decodeStego(){ const c=readImageCfg(); renderImage({chrome:false}); const ctx=$("icanvas").getContext("2d"); const img=ctx.getImageData(0,0,c.W,c.H).data;
  let len=0; for(let i=0;i<32;i++) len=(len<<1)|(img[i*4+2]&1); if(len<=0||len>4096){ toast("No stego payload found","err"); return null; }
  const out=new Uint8Array(len); for(let b=0;b<len;b++){ let v=0; for(let i=0;i<8;i++){ const bit=img[(32+b*8+i)*4+2]&1; v=(v<<1)|bit; } out[b]=v; }
  const msg=new TextDecoder().decode(out); toast("STEGO: "+msg); log("Decoded stego: "+msg,"ok"); return msg; }
/* ============================================================================
   LIBRARY + BUNDLE + ZIP
   ========================================================================== */
