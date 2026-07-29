/* Dead Signal Studio — library/zip.js */
export const CRC_TABLE=(()=>{ const t=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?(0xEDB88320^(c>>>1)):(c>>>1); t[n]=c>>>0; } return t; })();
export function crc32(u8){ let c=0xFFFFFFFF; for(let i=0;i<u8.length;i++) c=CRC_TABLE[(c^u8[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
export function strU8(s){ return new TextEncoder().encode(s); }
export async function makeZip(files){ // files: [{name, data:Uint8Array}]
  const enc=[]; let offset=0; const central=[];
  for(const f of files){ const nameU8=strU8(f.name); const crc=crc32(f.data); const size=f.data.length;
    const lh=new Uint8Array(30+nameU8.length); const dv=new DataView(lh.buffer);
    dv.setUint32(0,0x04034b50,true); dv.setUint16(4,20,true); dv.setUint16(6,0,true); dv.setUint16(8,0,true); dv.setUint16(10,0,true); dv.setUint16(12,0x21,true);
    dv.setUint32(14,crc,true); dv.setUint32(18,size,true); dv.setUint32(22,size,true); dv.setUint16(26,nameU8.length,true); dv.setUint16(28,0,true); lh.set(nameU8,30);
    enc.push(lh); enc.push(f.data);
    const cd=new Uint8Array(46+nameU8.length); const cv=new DataView(cd.buffer);
    cv.setUint32(0,0x02014b50,true); cv.setUint16(4,20,true); cv.setUint16(6,20,true); cv.setUint16(8,0,true); cv.setUint16(10,0,true); cv.setUint16(12,0,true); cv.setUint16(14,0x21,true);
    cv.setUint32(16,crc,true); cv.setUint32(20,size,true); cv.setUint32(24,size,true); cv.setUint16(28,nameU8.length,true); cv.setUint32(42,offset,true); cd.set(nameU8,46);
    central.push(cd); offset+=lh.length+size; }
  let cdSize=0; central.forEach(c=>cdSize+=c.length); const cdOffset=offset;
  const eocd=new Uint8Array(22); const ev=new DataView(eocd.buffer); ev.setUint32(0,0x06054b50,true); ev.setUint16(8,files.length,true); ev.setUint16(10,files.length,true); ev.setUint32(12,cdSize,true); ev.setUint32(16,cdOffset,true);
  return new Blob([...enc,...central,eocd],{type:"application/zip"}); }
export async function u8of(blob){ return new Uint8Array(await blob.arrayBuffer()); }

/* Reader for the archives makeZip() writes. Everything we produce is stored
   (method 0), so no inflate is needed — a compressed entry is reported rather
   than silently mis-read. Walks the central directory rather than scanning for
   local headers, so a filename containing the PK signature cannot confuse it.
   Returns [{ name, data:Uint8Array }]. */
export async function readZip(blob){
  const u8 = blob instanceof Uint8Array ? blob : await u8of(blob);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // EOCD is at the end, after a comment of up to 64 KB.
  let eocd = -1;
  for(let i = u8.length - 22; i >= 0 && i >= u8.length - 22 - 0xFFFF; i--){
    if(dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  }
  if(eocd < 0) throw new Error("not a zip archive (no end-of-central-directory)");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for(let n = 0; n < count; n++){
    if(dv.getUint32(p, true) !== 0x02014b50) throw new Error("corrupt central directory");
    const method   = dv.getUint16(p + 10, true);
    const crcWant  = dv.getUint32(p + 16, true);
    const size     = dv.getUint32(p + 24, true);
    const nameLen  = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const cmtLen   = dv.getUint16(p + 32, true);
    const lho      = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    if(method !== 0) throw new Error(`entry "${name}" is compressed (method ${method}); only stored is supported`);
    // Local header repeats the name/extra lengths, and its extra field may
    // differ from the central one — read the data offset from the local header.
    if(dv.getUint32(lho, true) !== 0x04034b50) throw new Error(`corrupt local header for "${name}"`);
    const lNameLen  = dv.getUint16(lho + 26, true);
    const lExtraLen = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lNameLen + lExtraLen;
    const data = u8.slice(start, start + size);
    if(crc32(data) !== crcWant) throw new Error(`checksum mismatch in "${name}"`);
    out.push({ name, data });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}
