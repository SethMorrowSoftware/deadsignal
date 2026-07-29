#!/usr/bin/env node
/**
 * GIF89a LZW encoder correctness gate for the Media Studio (Dead Signal Studio).
 *
 * The studio ships an inline GIF encoder (src/video/gif.js) so it
 * can export animated .gif with no dependencies. LZW has one notorious failure
 * mode: the variable-width code size must grow at *exactly* the right moment or
 * the decoder desyncs partway through the image ("correct at the top, then
 * interference"). A naive "does it decode / are pixels lit" check does NOT catch
 * it — a corrupted GIF still decodes to *something*.
 *
 * This test imports the real encoder, encodes a rich frame
 * that crosses multiple code-size boundaries (216 colors, >512 dictionary
 * entries), then DECODES it with an independent LZW decoder and asserts the
 * round-trip is byte-exact. It runs in plain Node — no browser, no deps — so it
 * can sit in the CI gate next to the other harnesses.
 *
 * Usage:  node tools/media-studio/test-gif-encoder.mjs
 */
/* The encoder used to be scraped out of the classic-script studio.js by
   brace-matching its source and eval'ing it through `new Function`. Now that
   the engine is ES modules it is imported directly — the real binding, not a
   copy that could silently drift from what ships. */
import { _gifPalette, _gifIdx, encodeGif } from './src/video/gif.js';

let fails = 0;
const check = (cond, label, extra='') => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra?'  '+extra:''}`); if (!cond) fails++; };

// --- independent GIF89a parser + LZW decoder (does NOT share the encoder path) ---
function decodeGif(u8) {
  let p = 0;
  const str = (n) => { let s=''; for(let i=0;i<n;i++) s+=String.fromCharCode(u8[p++]); return s; };
  const u16 = () => { const v = u8[p] | (u8[p+1]<<8); p+=2; return v; };
  if (str(6) !== 'GIF89a' && u8.slice(0,3).join()!=='71,73,70') throw new Error('bad header');
  const W = u16(), H = u16(); const flags = u8[p++]; p++; p++; // bg, aspect
  const gctSize = (flags & 0x80) ? 2 << (flags & 7) : 0;
  const gct = [];
  for (let i=0;i<gctSize;i++){ gct.push([u8[p],u8[p+1],u8[p+2]]); p+=3; }
  const frames = [];
  while (p < u8.length) {
    const b = u8[p++];
    if (b === 0x3B) break;                    // trailer
    if (b === 0x21) { p++; while(u8[p]!==0) p+=u8[p]+1; p++; continue; } // extension: skip sub-blocks
    if (b === 0x2C) {                          // image descriptor
      const ix=u16(), iy=u16(), iw=u16(), ih=u16(); const lf=u8[p++];
      const lctSize = (lf & 0x80) ? 2 << (lf & 7) : 0;
      let ct = gct; if (lctSize){ ct=[]; for(let i=0;i<lctSize;i++){ ct.push([u8[p],u8[p+1],u8[p+2]]); p+=3; } }
      const minCode = u8[p++];
      // gather LZW sub-blocks
      const data = []; let n; while((n=u8[p++])!==0){ for(let i=0;i<n;i++) data.push(u8[p++]); }
      const indices = lzwDecode(data, minCode, iw*ih);
      const rgba = new Uint8Array(iw*ih*4);
      for (let i=0;i<indices.length;i++){ const c=ct[indices[i]]||[0,0,0]; rgba[i*4]=c[0]; rgba[i*4+1]=c[1]; rgba[i*4+2]=c[2]; rgba[i*4+3]=255; }
      frames.push({ ix, iy, iw, ih, rgba });
    } else break;
  }
  return { W, H, frames };
}
function lzwDecode(data, minCode, expected) {
  const CLEAR = 1<<minCode, EOI = CLEAR+1;
  let codeSize = minCode+1, dict, next;
  const reset = () => { dict = []; for(let i=0;i<CLEAR;i++) dict[i]=[i]; dict[CLEAR]=null; dict[EOI]=null; next=EOI+1; codeSize=minCode+1; };
  reset();
  let acc=0, nb=0, dp=0;
  const read = () => { while(nb<codeSize){ acc |= (data[dp++]||0) << nb; nb+=8; } const c = acc & ((1<<codeSize)-1); acc>>=codeSize; nb-=codeSize; return c; };
  const out = []; let prev = null;
  while (out.length < expected) {
    const code = read();
    if (code === CLEAR) { reset(); prev=null; continue; }
    if (code === EOI) break;
    let entry;
    if (code < next && dict[code]) entry = dict[code];
    else if (prev) entry = prev.concat(prev[0]);      // KwKwK case
    else break;
    for (const s of entry) out.push(s);
    if (prev) { dict[next++] = prev.concat(entry[0]); if (next === (1<<codeSize) && codeSize < 12) codeSize++; }
    prev = entry;
  }
  return out;
}

console.log('GIF encoder correctness');
console.log('-'.repeat(50));

// 1) Rich single frame crossing the 512-entry code-size boundary must round-trip exact
const W=128, H=128, pal=_gifPalette();
const frame = new Uint8ClampedArray(W*H*4);
for (let y=0,q=0;y<H;y++) for (let x=0;x<W;x++,q+=4){ frame[q]=(x*2)&255; frame[q+1]=(y*2)&255; frame[q+2]=((x*7+y*13)%256); frame[q+3]=255; }
const distinct = new Set(); for (let i=0,q=0;i<W*H;i++,q+=4) distinct.add(_gifIdx(frame[q],frame[q+1],frame[q+2]));
check(distinct.size > 60, `source is rich (${distinct.size} palette colors → forces >512 LZW entries, multiple code-size steps)`);

const blob = encodeGif([frame], W, H, 10);
const u8 = new Uint8Array(await blob.arrayBuffer());
check(String.fromCharCode(u8[0],u8[1],u8[2],u8[3],u8[4],u8[5]) === 'GIF89a', 'valid GIF89a header');

const dec = decodeGif(u8);
check(dec.frames.length === 1, `one image frame decoded (${dec.frames.length})`);
let match=0, firstBadRow=-1; const fr = dec.frames[0].rgba;
for (let y=0;y<H;y++) for (let x=0;x<W;x++){ const q=(y*W+x)*4; const c=pal[_gifIdx(frame[q],frame[q+1],frame[q+2])];
  if (fr[q]===c[0] && fr[q+1]===c[1] && fr[q+2]===c[2]) match++; else if (firstBadRow<0) firstBadRow=y; }
check(match === W*H, `every pixel round-trips exactly (${match}/${W*H})`, firstBadRow>=0?`first desync at row ${firstBadRow}`:'');

// 2) Multi-frame GIF: each frame must round-trip exact
const W2=100, H2=100;
const mk = (o) => { const a=new Uint8ClampedArray(W2*H2*4); for(let y=0,q=0;y<H2;y++)for(let x=0;x<W2;x++,q+=4){ a[q]=((x*3+o)&255); a[q+1]=((y*5+o)&255); a[q+2]=((x+y+o)&255); a[q+3]=255; } return a; };
const framesIn = [mk(0), mk(80), mk(160)];
const blob2 = encodeGif(framesIn, W2, H2, 20);
const dec2 = decodeGif(new Uint8Array(await blob2.arrayBuffer()));
check(dec2.frames.length === 3, `multi-frame: 3 frames decoded (${dec2.frames.length})`);
let allExact = dec2.frames.length === 3;
for (let f=0; f<dec2.frames.length; f++){ const rf=dec2.frames[f].rgba; const inF=framesIn[f]; let ok=true;
  for (let i=0,q=0;i<W2*H2 && ok;i++,q+=4){ const c=pal[_gifIdx(inF[q],inF[q+1],inF[q+2])]; if(rf[q]!==c[0]||rf[q+1]!==c[1]||rf[q+2]!==c[2]) ok=false; }
  if (!ok) allExact=false; }
check(allExact, 'every frame of the multi-frame GIF round-trips exactly');

console.log('-'.repeat(50));
console.log(fails === 0 ? 'GIF ENCODER: byte-correct' : `GIF ENCODER: ${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
