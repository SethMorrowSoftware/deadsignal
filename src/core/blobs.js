/* Dead Signal Studio — core/blobs.js */
export const _urls=new Set();
export function makeUrl(blob){ const u=URL.createObjectURL(blob); _urls.add(u); return u; }
export function revokeUrl(u){ if(u&&_urls.has(u)){ URL.revokeObjectURL(u); _urls.delete(u); } }
// Guarded: a module that touches the environment at import time cannot be
// imported by a headless test. Behaviour in the browser is unchanged.
if(typeof window!=="undefined") window.addEventListener("beforeunload",()=>{ _urls.forEach(u=>URL.revokeObjectURL(u)); });
export function download(blob, filename){ const u=URL.createObjectURL(blob); const a=document.createElement("a");
  a.href=u; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),5000); }
/* ---------- imported source image (bring-your-own art -> retro-ify) ---------- */
