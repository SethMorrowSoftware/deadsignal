/* Dead Signal Studio — library/library.js */
import { download, makeUrl, revokeUrl } from '../core/blobs.js';
import { $, esc, escHtml, log, toast } from '../core/dom.js';
import { currentSeed } from '../core/rng.js';
import { getStore } from '../doc/session.js';
import { set } from '../doc/store.js';
import { campaignBeats, defaultBeatFor } from '../campaign/profile.js';
import { renderCoverage } from './bundle.js';

export const library=[]; let libSeq=0;
/* Bytes, by asset key. The document holds only what a row IS — name, kind,
   gated, beat — and this holds what it contains. Two stores because they have
   different lifetimes: metadata is small, undoable and belongs in the project;
   a 4 MB WebM is none of those things.

   Never evicted during a session. Deleting a row takes it out of the document,
   which undo can put straight back, so throwing the bytes away on remove would
   make undo silently lossy. Unreferenced keys are collected at boot instead —
   see sweepAssets() in boot.js. */
const _blobs=new Map();
let _keySeq=0;
const newKey=()=>"a"+Date.now().toString(36)+"-"+(++_keySeq).toString(36)
  +"-"+Math.random().toString(36).slice(2,8);

export function slug(s){ return esc(s).toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,40)||"clip"; }
export function uniqueName(base,kind,ext,exceptId){ let name=base, n=2;
  const taken=(nm)=>library.some(it=>it.id!==exceptId&&it.name===nm&&it.kind===kind&&it.ext===ext);
  while(taken(name)){ name=base+"_"+n; n++; } return name; }

/* ---------------------------------------------------------------- document --
 * The library is project state. It was module-local only, so a name, a kind, a
 * gated flag and a release beat — the whole point of the LIBRARY tab, and the
 * only thing the BUNDLE tab consumes — were never written to the document,
 * never saved, never autosaved and never undoable. Twelve named and beat-tagged
 * assets did not survive a reload even though the autosave was running.
 */
export const LIBRARY_PATH='library';
/** A row as the document stores it: metadata only, no handles. */
const plainRow=(it)=>({ key:it.key, name:it.name, ext:it.ext, kind:it.kind,
  seconds:it.seconds, gated:it.gated, beat:it.beat, seed:it.seed, size:it.size });
export function libraryRows(){ return library.map(plainRow); }
/** Push the current library into the document as one undo entry. */
export function commitLibrary(label){
  const st=getStore(); if(!st) return false;
  st.apply(set(LIBRARY_PATH,libraryRows(),{ label:label||"library" }));
  notifyLibrary();
  return true;
}

/* Anything that presents the library as a list of choices — today the VIDEO
   tab's audio-bed picker — has to hear about a row arriving. A subscriber list
   rather than an import, so the library stays unaware of who is watching. */
const _watchers=new Set();
export function onLibraryChange(fn){ _watchers.add(fn); return ()=>_watchers.delete(fn); }
export function notifyLibrary(){ for(const f of [..._watchers]){ try{ f(); }catch(e){} } }
/** Bytes for a restored row, once the asset store has handed them back. */
export function attachAssetBlob(key,blob){
  if(!key||!blob) return false;
  _blobs.set(key,blob);
  const it=library.find(x=>x.key===key);
  if(it&&!it.blob){ it.blob=blob; it.url=makeUrl(blob); notifyLibrary(); }
  return true;
}
export function assetBlob(key){ return _blobs.get(key)||null; }
/** Every key the library still refers to — the roots for the boot-time sweep. */
export function referencedKeys(){ return new Set(library.map(it=>it.key).filter(Boolean)); }
/**
 * Rebuild the runtime library from document rows (load, undo, redo, restore).
 * Bytes come back from the in-session map when it has them; a row whose bytes
 * are genuinely gone is kept and marked rather than dropped — the author's
 * naming and beat assignment is the expensive part, and losing that silently
 * would be worse than showing a row that needs re-rendering.
 */
export function setLibraryFromDoc(rows){
  library.forEach(it=>{ if(it.url) revokeUrl(it.url); });
  library.length=0;
  for(const r of (Array.isArray(rows)?rows:[])){
    if(!r||typeof r!=="object") continue;
    const blob=r.key?(_blobs.get(r.key)||null):null;
    library.push({ id:++libSeq, key:r.key||newKey(), blob, url:blob?makeUrl(blob):null,
      ext:String(r.ext||"bin"), kind:String(r.kind||"image"), name:String(r.name||"clip"),
      seconds:+r.seconds||0, gated:!!r.gated, beat:String(r.beat||defaultBeat(r.kind)),
      seed:+r.seed||0, size:+r.size||(blob?blob.size:0) });
  }
  renderLibTable(); renderCoverage(); notifyLibrary();
}
/* Which beat a new asset lands on. Delegated to the active campaign profile:
   the old fixed answers were EREBUS beat names, so against any other campaign
   they named a beat that did not exist. */
export function defaultBeat(kind){ return defaultBeatFor(kind); }
/* Names are slugged HERE, not at each call site.
 *
 * Every generator already slugged before calling, so this changes nothing for
 * them — but the CLOUD tab's "→ LIBRARY" passed the server's original filename
 * straight through, so pulling "My Clip.webm" back down produced a row called
 * "My Clip". A space is not a legal asset filename: VALIDATE rejected the whole
 * bundle, and the release snippet emitted `call releaseMedia "My Clip.webm"`,
 * which is not a line that can work. A row's name becomes a filename and a
 * RetroScript argument, so it is not somewhere a caller gets to be careless. */
export function addToLibrary(blob,ext,kind,name,seconds){ const key=newKey();
  const it={id:++libSeq,key,blob,url:makeUrl(blob),ext,kind,name:uniqueName(slug(name),kind,ext),seconds:seconds||0,gated:kind!=="image",beat:defaultBeat(kind),seed:currentSeed(),size:blob.size};
  _blobs.set(key,blob);
  library.push(it); commitLibrary("add asset"); _persist?.(key,blob,it);
  renderLibTable(); renderCoverage(); log("Library + "+it.name+"."+ext+" ("+(blob.size/1024).toFixed(0)+"KB)","ok"); return it; }
export function removeItem(id){ const i=library.findIndex(x=>x.id===id); if(i<0)return; revokeUrl(library[i].url); library.splice(i,1); commitLibrary("remove asset"); renderLibTable(); renderCoverage(); }

/* How a generated blob reaches durable storage. Injected by boot() rather than
   imported, so this module stays free of the storage backend and the headless
   suites keep working with no IndexedDB at all. */
let _persist=null;
export function setAssetPersister(fn){ _persist=fn; }

/**
 * Swap new bytes into an existing row, keeping its identity.
 *
 * Normalising audio rewrites the WAV in place, and the row has to follow it or
 * the library, the ▶ preview and the campaign .zip all keep shipping the
 * un-normalised take. It reuses the key deliberately — this is the same asset
 * at a different level, not a new one.
 */
export function refreshItemBlob(id,blob){
  const it=library.find(x=>x.id===id);
  if(!it||!blob) return null;
  revokeUrl(it.url);
  it.blob=blob; it.url=makeUrl(blob); it.size=blob.size;
  _blobs.set(it.key,blob); _persist?.(it.key,blob,it);
  commitLibrary("update asset"); renderLibTable();
  return it;
}
/**
 * Swap new content into the row a previous generate created, keeping its id and
 * its row edits. Returns the item, or null when the row is no longer a safe
 * target — in which case the caller should add a new one instead.
 *
 * This exists because on the audio tab RENDER is both "produce the asset" and
 * "let me hear it": dialling in a hum meant eight near-identical WAVs in the
 * library, and the BUNDLE tab ships the library, so the package got all eight.
 * Replacing is only correct while the author has shown no interest in the old
 * take, so it is refused once the row has been renamed or anything has been
 * generated after it — then both are kept and pruning is the author's call.
 */
export function replaceItem(id,blob,expectName,seconds){
  const it=library.find(x=>x.id===id);
  if(!it) return null;
  if(library[library.length-1]!==it) return null;     // something newer exists
  if(expectName!=null && it.name!==expectName) return null;   // author renamed it
  revokeUrl(it.url);
  // Same key on purpose. This path only fires while the author has shown no
  // interest in the previous take — that is what the two guards above check —
  // so the superseded bytes are genuinely unwanted. Minting a new key instead
  // would retain every discarded take for the rest of the session, and
  // dialling in a hum means pressing RENDER thirty times.
  it.blob=blob; it.url=makeUrl(blob); it.seconds=seconds||0; it.seed=currentSeed(); it.size=blob.size;
  _blobs.set(it.key,blob);
  commitLibrary("replace asset"); _persist?.(it.key,blob,it);
  renderLibTable(); renderCoverage();
  return it;
}
export function clearLibrary(){ library.forEach(it=>revokeUrl(it.url)); library.length=0; commitLibrary("clear library"); renderLibTable(); renderCoverage(); toast("Library cleared"); }

export function renderLibTable(){ const b=$("lib-body"); if(!b)return; b.replaceChildren(); if(!library.length){ b.innerHTML='<tr><td colspan="7" class="hint">Nothing generated yet.</td></tr>'; return; }
  library.forEach(it=>{ const tr=document.createElement("tr");
    // A row restored from a project whose bytes were not in this browser's
    // asset store keeps its name, kind and beat — that is the work worth
    // saving — but says so, and cannot be downloaded, played or bundled.
    const bytes=it.blob?((it.blob.size/1024).toFixed(0)+"KB")
      :'<span class="hint" title="Restored from a project — re-render to fill it in">no bytes</span>';
    const dis=it.blob?"":" disabled";
    tr.innerHTML='<td>'+it.id+'</td>'+
      '<td><input type="text" value="'+escHtml(it.name)+'" data-id="'+it.id+'" data-k="name" style="width:150px"> .'+escHtml(it.ext)+'</td>'+
      '<td><select data-id="'+it.id+'" data-k="kind"><option'+(it.kind==="videos"?" selected":"")+'>videos</option><option'+(it.kind==="music"?" selected":"")+'>music</option><option'+(it.kind==="image"?" selected":"")+'>image</option></select></td>'+
      '<td style="text-align:center"><input type="checkbox" data-id="'+it.id+'" data-k="gated"'+(it.gated?" checked":"")+'></td>'+
      '<td><select data-id="'+it.id+'" data-k="beat">'+campaignBeats().map(x=>'<option'+(it.beat===x?" selected":"")+'>'+escHtml(x)+'</option>').join("")+'</select></td>'+
      '<td>'+bytes+'</td>'+
      '<td><button class="btn small" data-id="'+it.id+'" data-act="dl"'+dis+'>⤓</button> <button class="btn small" data-id="'+it.id+'" data-act="pv"'+dis+'>▶</button> <button class="btn small" data-id="'+it.id+'" data-act="rm">✕</button></td>';
    b.appendChild(tr); });
  b.querySelectorAll("input,select").forEach(el=>el.addEventListener("change",()=>{ const it=library.find(x=>x.id==el.dataset.id); if(!it)return; const k=el.dataset.k;
    // Renaming has to stay collision-free. uniqueName() ran on add but not on
    // rename, so two rows could carry one filename — and mergeEntries() keys the
    // generated manifest on the filename, so the second entry silently replaced
    // the first and one asset vanished from the wiring without a word.
    if(k==="name") it.name=uniqueName(slug(el.value),it.kind,it.ext,it.id);
    else if(el.type==="checkbox") it[k]=el.checked;
    else it[k]=el.value;
    if(k==="kind"){ it.beat=defaultBeat(el.value); it.name=uniqueName(it.name,it.kind,it.ext,it.id); }
    commitLibrary("library row");
    if(k==="kind"||k==="name") renderLibTable(); renderCoverage(); }));
  b.querySelectorAll("button").forEach(bt=>bt.addEventListener("click",()=>{ const it=library.find(x=>x.id==bt.dataset.id); if(!it)return; const a=bt.dataset.act;
    if(a==="dl"){ if(it.blob) download(it.blob,it.name+"."+it.ext); } else if(a==="pv")previewItem(it); else if(a==="rm")removeItem(it.id); })); }
/* Inline preview overlay — plays/shows a library blob IN THIS DOCUMENT. Opening
   a blob URL in a new tab fails when the tool is loaded from file:// (null
   origin → blob:null/… which browsers refuse to navigate to); an in-page media
   element loads its own blob URL fine regardless of origin. */
// cleanly stop + detach a media element's source so an in-flight blob load is
// cancelled before the node is removed (avoids "aborted load" console noise).
export function _killMedia(el){ try{ if(el.pause)el.pause(); el.removeAttribute("src"); if(el.load)el.load(); }catch(e){} }
// An overlay's document-level Escape listener is only known to the overlay
// itself, so replacement goes through its own teardown — removing just the DOM
// left one dead keydown listener behind per replaced preview.
export function closePreviews(){ document.querySelectorAll(".preview-overlay").forEach(o=>{ if(o._teardown){ o._teardown(); return; } o.querySelectorAll("video,audio,img").forEach(_killMedia); o.remove(); }); }
export function previewItem(it){ if(!it||!it.url)return; const ext=(it.ext||"").toLowerCase();
  closePreviews(); // one preview at a time — no stacked media
  const ov=document.createElement("div"); ov.className="preview-overlay";
  const box=document.createElement("div"); box.className="pv-box"; let el;
  if(it.kind==="music" || ["wav","mp3","ogg"].includes(ext)){ el=document.createElement("audio"); el.controls=true; el.autoplay=true; }
  else if(it.kind==="videos" || ["webm","mp4","ogv"].includes(ext)){ el=document.createElement("video"); el.controls=true; el.autoplay=true; el.loop=true; el.playsInline=true; }
  else { el=document.createElement("img"); el.alt=it.name; }
  el.addEventListener("error",()=>{ if(el.isConnected){ log("Preview failed to load "+it.name+"."+it.ext,"err"); toast("Preview could not load","err"); } });
  // set the source on the next frame, only if the overlay is still open — a
  // preview that's immediately replaced never starts a (blob:null) load, so no
  // aborted-load noise when the ▶ button is clicked twice in quick succession.
  requestAnimationFrame(()=>{ if(el.isConnected) el.src=it.url; });
  const bar=document.createElement("div"); bar.className="pv-bar";
  const nm=document.createElement("span"); nm.className="pv-name"; nm.textContent=it.name+"."+it.ext+"  ·  "+(it.blob.size/1024).toFixed(0)+"KB";
  const dlb=document.createElement("button"); dlb.className="btn small"; dlb.textContent="⤓ download"; dlb.addEventListener("click", ()=>download(it.blob,it.name+"."+it.ext));
  const clb=document.createElement("button"); clb.className="btn small"; clb.textContent="✕ close";
  const onKey=(e)=>{ if(e.key==="Escape")close(); };
  function close(){ try{ if(el.pause)el.pause(); el.removeAttribute("src"); }catch(e){} document.removeEventListener("keydown",onKey); ov.remove(); }
  ov._teardown=close;
  clb.addEventListener("click", close); document.addEventListener("keydown",onKey);
  ov.addEventListener("click",(e)=>{ if(e.target===ov)close(); });
  bar.appendChild(nm); bar.appendChild(dlb); bar.appendChild(clb);
  box.appendChild(el); box.appendChild(bar); ov.appendChild(box); document.body.appendChild(ov); }
