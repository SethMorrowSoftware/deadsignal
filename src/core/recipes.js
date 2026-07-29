/* Dead Signal Studio — core/recipes.js */
import { markAudioStale } from '../audio/ui.js';
import { $, log, setVal, toast, val } from './dom.js';
import { bootDefaults, viewControls, withBootDefaults } from '../doc/bind.js';
import { getStore, hasSession, pathFor } from '../doc/session.js';
import { safeClone } from '../doc/paths.js';
import { migrate } from '../doc/migrations.js';
import { normalize } from '../doc/schema.js';
import { renderImage } from '../image/render.js';
import { setLibraryFromDoc } from '../library/library.js';
import { rebuildPresetSelect } from '../presets/index.js';
import { startVideoPreview } from '../video/capture.js';
import { scene } from '../video/scenes.js';
import { setTimelineClips } from '../video/timeline.js';


/* A recipe is a snapshot of DOCUMENT-BOUND controls, and the bind index is the
   authority on which those are. Chain steps, layer rows and screen marks build
   their controls at runtime with positional ids (`v-filters-step-0-amount`,
   `lyr-font-2`) and write structured document paths straight through the store
   — panel-local, never in the index. Capturing them baked transient step
   values into presets, and loading such a preset replayed the stale value onto
   whatever occupies that slot NOW (filters share param keys: amount, mix,
   radius…), silently corrupting the current chain. The index is built at boot
   AFTER the generated audio-layer controls exist, so those stay in; headless
   (no session) has no index and no panels, so nothing is filtered there. */
const recipeControls=(viewId)=>{ const els=viewControls(viewId); return hasSession()?els.filter(e=>pathFor(e.id)):els; };
export function readRecipe(viewId){ const o={}; recipeControls(viewId).forEach(e=>{ o[e.id]= e.type==="checkbox"?e.checked:e.value; }); return o; }
/* Loading a preset used to assign .value straight onto each control, which the
   document never saw — so the widgets moved and the render did not. One
   transaction so a preset is a single undo step, not thirty. */
export function applyRecipe(viewId,rec){ if(!rec)return;
  const write=()=>recipeControls(viewId).forEach(e=>{ if(e.id in rec) setVal(e.id,rec[e.id]); });
  const st=getStore(); if(st) st.transaction(write,"load preset"); else write(); }
export const VIEWS={video:"view-video",audio:"view-audio",image:"view-image"};
/* Project I/O is document I/O. The store is authoritative, so a save is a
   snapshot of it and a load replaces it — the DOM re-renders from the change
   notification rather than being written control by control. */
export function readProject(){
  const st=getStore();
  if(!st) return { seed:val("seed"), tabs:{} };          // unbound (headless)
  /* Straight snapshot. This used to re-serialise the live clip list over the
     document's copy, in the old `{rec,label,dur,scene}` shape — which was
     harmless while that WAS the shape, and became data loss the moment a clip
     grew a trim: `dur` no longer exists, and kind/in/out/transition/xdur were
     dropped on the floor. Saving a project quietly threw away every trim, every
     per-clip transition and every still.

     There is nothing to re-serialise: commitClips() writes `timeline.clips`
     into the document before it touches the live list, so the store is already
     the authority here, exactly as the comment above says. */
  return safeClone(st.doc);
}
/**
 * Is this actually one of ours?
 *
 * Every version of a project document has the `tabs` map — v0 had it before
 * `schemaVersion` existed — so its absence is the one reliable "this is not a
 * project" signal, and it is the check doc/serialize.js has always made.
 *
 * Nothing on the load path made it. `migrate()` treats a document with no
 * schemaVersion as v0 and builds a fresh one from it, so handing LOAD any other
 * JSON file — a package.json, a manifest, a config — produced a valid, EMPTY
 * project, replaced the author's work with it, and said "Project loaded". The
 * check lives here rather than in the file picker because the same function
 * takes documents from the share link, the server and the version restore.
 */
export function assertProject(p){
  if(!p || typeof p!=="object" || Array.isArray(p)) throw new Error("not a project file");
  if(!p.tabs || typeof p.tabs!=="object" || Array.isArray(p.tabs)) throw new Error("not a project file (no tabs)");
  return p;
}
export function applyProject(p){
  if(!p) return;
  assertProject(p);
  const st=getStore();
  // No session bound (headless): the DOM *is* the document here.
  if(!st){ if(p.seed!=null) $("seed").value=p.seed;   /* dom-only: unbound fallback */
    for(const k in VIEWS){ if(p.tabs&&p.tabs[k]) applyRecipe(VIEWS[k],p.tabs[k]); }
    startVideoPreview(); renderImage(); markAudioStale(); return; }
  // Accepts any schema version, including the legacy pre-document format.
  /* Backfill anything this build has a control for and the file does not —
     every release that adds a control makes every project on disk older than
     it, and a control the document cannot speak for would otherwise keep
     whatever the PREVIOUS project left it at. See withBootDefaults. */
  const doc=withBootDefaults(normalize(migrate(safeClone(p))));
  stashPreviousProject(st);              // after validation: a refused load must not touch the stash
  st.replace(doc);                       // notifies -> DOM re-renders -> previews refresh
  setTimelineClips(doc.timeline?.clips);
  setLibraryFromDoc(doc.library);
}
/* Loading over real work is the one irreversible click in the tool: replace()
   clears the undo stacks, and within a second the autosave writes the incoming
   document over the only local slot. Two nets, both cheap and both silent (a
   confirm() here would break every programmatic load). docIsDefault says
   whether there is anything to lose — no history, no clips, no library, no
   chains / layers / keyframes / regions / marks / vars, and every control
   still at its boot default. stashPreviousProject keeps the outgoing document
   in localStorage so a misclick is recoverable even after the autosave has
   moved on; the log line says how to get it back. */
export const PREVIOUS_PROJECT_KEY="deadsignal.studio.previous-project";
export function docIsDefault(st){
  if(!st) return true;
  if(st.canUndo || st.canRedo) return false;
  const d=st.doc||{};
  if(d.timeline?.clips?.length || d.library?.length) return false;
  if(d.layers?.video?.length || d.filters?.video?.length || d.filters?.audio?.length) return false;
  if(d.audio?.regions?.length || d.audio?.solo?.length || d.image?.annotations?.length) return false;
  if(Object.keys(d.automation?.video||{}).length || Object.keys(d.vars||{}).length) return false;
  // History is cleared by every load, so a restored session with only control
  // edits has no undo depth — the boot snapshot is the tiebreaker.
  const boot=bootDefaults();
  if(boot) for(const tab in boot.tabs){ const cur=d.tabs?.[tab]; if(!cur) continue;
    for(const id in boot.tabs[tab]) if(cur[id]!==undefined && cur[id]!==boot.tabs[tab][id]) return false; }
  return true;
}
export function stashPreviousProject(st){
  if(!st || docIsDefault(st)) return false;   // never clobber a real stash with an empty doc
  if(!lsSet(PREVIOUS_PROJECT_KEY, st.doc)) return false;
  log('Previous project kept — restore it with DeadSignalStudio.applyProject(JSON.parse(localStorage.getItem("'+PREVIOUS_PROJECT_KEY+'")))',"info");
  return true;
}
/* user presets in localStorage */
export function lsGet(k,d){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):d; }catch(e){ return d; } }
export function lsSet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); return true; }catch(e){ log("localStorage write failed: "+e.message,"err"); return false; } }
export const PKEY=(tab)=>"erebus.studio.presets."+tab;
export function userPresets(tab){ return lsGet(PKEY(tab),{}); }
export function saveUserPreset(tab,viewId){ const name=prompt("Preset name:"); if(!name)return; const all=userPresets(tab); all[name]=readRecipe(viewId); lsSet(PKEY(tab),all); rebuildPresetSelect(tab); toast("Saved preset: "+name); log("Saved user preset ["+tab+"] "+name,"ok"); }
export function deleteUserPreset(tab,name){ const all=userPresets(tab); delete all[name]; lsSet(PKEY(tab),all); rebuildPresetSelect(tab); }
/* ============================================================================
   SHARED CRT / VHS FX  (operate on a 2D context of size W×H)
   ========================================================================== */
