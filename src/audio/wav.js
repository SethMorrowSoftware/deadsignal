/* Dead Signal Studio — audio/wav.js */
import { clamp } from '../core/dom.js';

/** Accept a single channel or a list of them, so callers need not branch. */
const chans = (d) => (Array.isArray(d) ? d : [d]);

/**
 * Peak and RMS across every channel.
 *
 * One figure for the whole file, not per channel: the meter drives clip
 * warnings and normalisation, and normalising channels independently would
 * move the stereo image rather than just its level.
 */
export function bufferPeakRms(data){
  const cs=chans(data); let peak=0,sum=0,n=0;
  for(const c of cs){ for(let i=0;i<c.length;i++){ const a=Math.abs(c[i]); if(a>peak)peak=a; sum+=c[i]*c[i]; n++; } }
  return {peak, rms:n?Math.sqrt(sum/n):0};
}

/**
 * RIFF/WAVE, mono or interleaved stereo.
 *
 * @param {Float32Array|Float32Array[]} data one channel, or one per channel
 */
export function encodeWav(data,sr,bits){
  const cs=chans(data);
  const ch=cs.length;
  const n=cs[0].length;
  const bytesPer=bits/8;
  const blockAlign=bytesPer*ch;
  const dataSize=n*blockAlign;
  // RIFF chunks are word-aligned: an odd data chunk (mono 8/24-bit with an odd
  // sample count) needs one zero pad byte, counted in the RIFF size but NOT in
  // the data chunk size. The buffer is zero-initialised, so allocating it is
  // all the padding takes.
  const pad=dataSize&1;
  const ab=new ArrayBuffer(44+dataSize+pad); const v=new DataView(ab);
  const ws=(o,s)=>{ for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i)); };
  ws(0,"RIFF"); v.setUint32(4,36+dataSize+pad,true); ws(8,"WAVE"); ws(12,"fmt "); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,ch,true);
  v.setUint32(24,sr,true); v.setUint32(28,sr*blockAlign,true); v.setUint16(32,blockAlign,true); v.setUint16(34,bits,true); ws(36,"data"); v.setUint32(40,dataSize,true);
  let off=44;
  // Interleaved: one frame is every channel's sample for that instant, in order.
  for(let i=0;i<n;i++){ for(let c=0;c<ch;c++){ const s=clamp(cs[c][i]||0,-1,1);
    if(bits===8){ v.setUint8(off, (s*127+128)&255); off+=1; }
    else if(bits===16){ v.setInt16(off, s<0?s*0x8000:s*0x7FFF, true); off+=2; }
    else { const val24=Math.round(s<0?s*8388608:s*8388607); v.setUint8(off,val24&255); v.setUint8(off+1,(val24>>8)&255); v.setUint8(off+2,(val24>>16)&255); off+=3; } } }
  return new Blob([ab],{type:"audio/wav"});
}
