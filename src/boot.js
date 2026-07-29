/* Dead Signal Studio — boot.js */
import { doRenderAudio, initAudioTab, markAudioStale } from './audio/ui.js';
import { fillContainerSelect } from './export/encoder.js';
import { download } from './core/blobs.js';
import { $, log, setVal, toast } from './core/dom.js';
import { applyAesthetic, applyPack, fillPaletteSelect } from './core/palettes.js';
import { applyProject, readProject } from './core/recipes.js';
import { startSession } from './doc/bind.js';
import { createDocument } from './doc/schema.js';
import { toJSON } from './doc/serialize.js';
import { autosave, openStorage } from './platform/storage.js';
import { currentSeed, seedRng } from './core/rng.js';
import { initImageTab, renderImage } from './image/render.js';
import { decodeStego } from './image/stego.js';
import { TEMPLATES, fillTemplateSelect, template } from './image/templates.js';
import { registerExtraTemplates } from './image/templates-extra.js';
import { doGenWiring, exportCampaignBundle, genWiring, renderCoverage, showValidation } from './library/bundle.js';
import { addToLibrary, attachAssetBlob, clearLibrary, library, referencedKeys, renderLibTable, setAssetPersister, setLibraryFromDoc } from './library/library.js';
import { loadImageFile, loadVideoFile } from './media/import.js';
import { PRESETS, rebuildPresetSelect } from './presets/index.js';
import { initPalette } from './ui/palette.js';
import { explainCoverage, initExplain, setArmed } from './ui/explain.js';
import { applyLevel, getLevel, initComplexity } from './ui/complexity.js';
import { getContrast, initContrast, setContrast } from './ui/contrast.js';
import { MACROS, applyMacro, initMacros } from './ui/macros.js';
import { currentRate, feedLuminance, paintFlash, resetFlashMeter } from './ui/flashmeter.js';
import { initWorkspace, isWorkspace, setWorkspace } from './ui/workspace.js';
import { initEditor } from './ui/nle.js';
import { activateTab, enhanceFieldsets, foldInactiveAudioLayers, initTablistKeys, randomize, resetView, setResetRefresh, snapshotDefaults, tidyAudioLayers, updateAudioLayerFlags, wireLive } from './ui/shell.js';
import { clearAllKeyframes, initKeyframes, refreshKeyframes } from './ui/keyframes.js';
import { addFilter, addToChain, clearChain, clearFilters, initChain, initFilters, renderChain, renderFilters } from './ui/filters.js';
import { AUDIO_FX, fxGroups, resolveFxParams } from './audio/fx.js';
import { addRegion, clearRegions, renderRegions } from './ui/regions.js';
import { clearSolo, renderSolo, toggleSolo } from './ui/solo.js';
import { addAnnotation, clearAnnotations, initAnnotations, renderAnnotations, selectAnnotation,
         updateAnnotation } from './ui/annotations.js';
import { initGallery, invalidateThumbs, renderGallery, toggleGallery } from './ui/gallery.js';
import { addLayer, clearLayers, initLayers, renderLayers } from './ui/layers.js';
import { initCampaignFiles, renderCampaignFiles } from './ui/campaignfiles.js';
import { initBatch, renderBatch } from './ui/batch.js';
import { hasShareFragment, initCloud, refreshCloud, renderCloud } from './ui/cloud.js';
import { initWelcome, loadSample, openWelcome } from './ui/welcome.js';
import { initVariables, renderVariables } from './ui/variables.js';
import { initPresetManager, openPresetManager } from './ui/presetman.js';
import { fillFontSelect } from './core/text.js';
import { initVideoTab, pickVideoCodecs, recordVideo, startVideoPreview, stopVideoPreview } from './video/capture.js';
import { readVideoCfg, renderVideoFrame } from './video/render.js';
import { readImageCfg } from './image/render.js';
import { readAudioCfg, renderAudio } from './audio/engine.js';
import { SCENES, fillSceneSelect } from './video/scenes.js';
import { registerExtraScenes } from './video/scenes-extra.js';
import { registerExtraFilters } from './fx/filters-extra.js';
import { buildAudioLayerControls } from './ui/audiolayers.js';
import { addAudioClip, addGraphicClip, addOverlayClip, addStillClip, addTimelineClip, addTitleClip, audioTimeline, buildSchedule, clearTimeline, clipSourceTime, commitAudioClips, editAudioClip, editClip, initTimelineTab, recordTimeline, renderTimelineFrame, renderTimelineTable, sequenceMix, setTimelineClips, startTimelinePreview, syncTimelineFromDoc, timeline } from './video/timeline.js';
import { trackScale } from './ui/track.js';
import { activeSection, initSections, sectionsOf, showSection } from './ui/sections.js';
import { importDroppedFiles, initDropTarget, useAsset } from './ui/importui.js';
import { dropAsset } from './ui/lanedrop.js';

let studioSession=null, studioBackend=null, studioAutosave=null;

/** Key for the audio FX chain in the shared chain panel. */
export const AUDIO_FX_CHAIN='a-fx';

export function boot(){
  // Read before anything can clear the fragment: initCloud() consumes it.
  const arrivedByShareLink=hasShareFragment();
  // selects
  // Extra scenes register into the same SCENES map, so this has to run
  // BEFORE the pickers are filled or they would be missing from every list.
  registerExtraScenes(); registerExtraTemplates(); registerExtraFilters();
  /* Registry audio layers generate their controls here, for the same reason as
     the pickers above: the document is seeded from the DOM a few lines down and
     the reset snapshot is taken from it, so a control that does not exist yet
     has no default and never reaches the project. */
  buildAudioLayerControls();
  fillSceneSelect(); fillTemplateSelect(); pickVideoCodecs();
  ["v-palette","i-palette"].forEach(id=>fillPaletteSelect($(id)));
  ["v-fontfam","i-fontfam"].forEach(id=>fillFontSelect($(id)));
  rebuildPresetSelect("video"); rebuildPresetSelect("audio"); rebuildPresetSelect("image");
  /* The container pickers, HERE rather than in initVideoTab/initTimelineTab.
     They are real project state — the export format an author chose — so unlike
     the transient "which one to add next" pickers they cannot simply be kept out
     of the document. That means they have to obey the invariant stated
     immediately below, and they were the two that did not: filled at init time,
     long after the document was seeded from the markup, so their recorded boot
     default was the empty string and every document→DOM write blanked them. */
  fillContainerSelect($("v-container")); fillContainerSelect($("tl-container"));
  // The document becomes authoritative here. Selects must already be filled,
  // or their .value would not yet be the real default the markup implies.
  /* Every panel that is a PROJECTION of the document rather than a control.
     Called after undo, redo, a project load — and after RESET, which moves the
     same state and used to leave every one of these showing the old thing.
     Assigned below, once the session exists. */
  let refreshPanels=()=>{};
  const session=startSession(createDocument(), {
    onExternalChange:()=>refreshPanels(),
  });
  refreshPanels=()=>{
      /* Undo, redo and project load all move state that several panels read,
         so each one has to re-read rather than show a stale list.

         Every step is isolated. They used to run as one statement, which meant
         a throw in any of them silently skipped every step after it — and
         because a project load runs inside initPersistence's try/catch, the
         throw never even reached the console. The visible symptom was a panel
         that simply did not come back after a reload, with nothing to explain
         why. One broken panel is a bug; nine panels dying behind it is a
         mystery. */
      const step=(label,fn)=>{ try{ fn(); }catch(e){ log("Refresh failed ("+label+"): "+e.message,"warn"); } };
      step("video preview", startVideoPreview);
      step("screen", renderImage);
      step("audio", ()=>{ markAudioStale(); updateAudioLayerFlags(); });
      // The clip list is a projection of the document, so it is rebuilt rather
      // than re-rendered; the timeline loop also snapshots its schedule when it
      // starts, so it has to be restarted or it keeps playing the pre-undo
      // sequence. Both start* calls no-op unless their own tab is showing, so
      // exactly one preview is ever running.
      step("timeline", ()=>{ syncTimelineFromDoc(); startTimelinePreview(); });
      // The library is a projection of the document too, so undo has to be able
      // to bring back a row it removed — and the bytes with it.
      step("library", ()=>setLibraryFromDoc(session.store.get("library")));
      step("keyframes", refreshKeyframes);
      step("layers", renderLayers);
      step("filters", renderFilters);
      step("audio fx", ()=>renderChain(AUDIO_FX_CHAIN));
      step("audio edits", renderRegions);
      step("solo", renderSolo);
      step("screen marks", renderAnnotations);
      /* An open gallery marks the CURRENT preset, so a pick made from the
         dropdown, an undo or a load left the highlight on the wrong card. */
      step("gallery", ()=>["video","audio","image"].forEach(renderGallery));
      // The batch counts are derived from the sequence and the saved presets.
      step("batch", renderBatch);
      step("variables", renderVariables);
      step("campaign files", renderCampaignFiles);
  };
  setResetRefresh(refreshPanels);
  studioSession=session;
  // tabs
  document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>activateTab(t.dataset.view)));
  initTablistKeys();
  initGallery();
  initComplexity();
  initContrast();
  initMacros((tab)=>{ if(tab==='video') startVideoPreview(); else markAudioStale(); });
  initExplain();
  // One action list, shared by the palette and the workspace Browser so the
  // two cannot drift apart.
  const studioActions=[
    { label:'Record video',            hint:'video',    run:()=>{ activateTab('video'); recordVideo(); } },
    { label:'Render audio',            hint:'audio',    run:()=>{ activateTab('audio'); doRenderAudio(); } },
    { label:'Render screen',           hint:'screen',   run:()=>{ activateTab('image'); renderImage(); } },
    { label:'Record timeline sequence',hint:'timeline', run:()=>{ activateTab('timeline'); recordTimeline(); } },
    { label:'Undo',                    hint:'Ctrl+Z',   run:()=>studioSession?.store.undo() },
    { label:'Redo',                    hint:'Ctrl+Shift+Z', run:()=>studioSession?.store.redo() },
    { label:'Save project',            hint:'Ctrl+S',   run:()=>$("proj-save").click() },
    { label:'Load project',            hint:'',         run:()=>$("proj-load").click() },
    { label:'Randomize',               hint:'G',        run:randomize },
    { label:'Generate bundle wiring',  hint:'bundle',   run:()=>{ activateTab('bundle'); doGenWiring(); } },
    { label:'Validate bundle',         hint:'bundle',   run:()=>{ activateTab('bundle'); showValidation(); } },
    { label:'Export campaign bundle .zip', hint:'bundle', run:()=>{ activateTab('bundle'); exportCampaignBundle(); } },
    { label:'Clear library',           hint:'library',  run:()=>{ activateTab('library'); clearLibrary(); } },
    { label:'Explain mode',            hint:'?',        run:()=>setArmed(true) },
    { label:'Toggle high contrast',    hint:'a11y',     run:()=>setContrast(getContrast()==='high'?'normal':'high') },
    { label:'Load the sample project', hint:'start here', run:loadSample },
    { label:'Show the welcome card',   hint:'help',     run:openWelcome },
    { label:'Toggle workspace layout', hint:'Ctrl+\\',  run:()=>setWorkspace(!isWorkspace()) },
    { label:'Manage video presets',    hint:'presets', run:()=>openPresetManager('video') },
    { label:'Manage audio presets',    hint:'presets', run:()=>openPresetManager('audio') },
    { label:'Manage screen presets',   hint:'presets', run:()=>openPresetManager('image') },
  ];
  const palette=initPalette({ SCENES, TEMPLATES, PRESETS, actions:studioActions });
  initWorkspace({ SCENES, TEMPLATES, PRESETS, actions:studioActions });
  /* The editor shell goes last: it re-layouts what everything above just
     wired, and docks the sequence lane, which has to exist first. */
  initEditor();
  if($("palette-open")) $("palette-open").addEventListener("click", ()=>palette.open());
  // header
  $("seed-roll").addEventListener("click", ()=>{ setVal("seed",Math.floor(Math.random()*1e6)); startVideoPreview(); renderImage();
    // A thumbnail drawn at the old seed is a picture of a look you can no
    // longer get. Drop them rather than showing a plausible lie.
    invalidateThumbs(); ["video","audio","image"].forEach(renderGallery); toast("New seed"); });
  $("crt-intensity").addEventListener("input", ()=>document.documentElement.style.setProperty("--crt",$("crt-intensity").value/100));
  // toJSON() rather than a raw stringify: it is key-sorted and drops the
  // runtime-only handles, so the same project always produces the same bytes
  // and a saved file diffs cleanly in git. The serializer existed and nothing
  // called it, so the byte-stability the HELP tab promises was not being
  // delivered by the button that writes the file.
  $("proj-save").addEventListener("click", ()=>{ download(new Blob([toJSON(readProject())],{type:"application/json"}),"erebus-studio-project.json"); toast("Project saved"); });
  $("proj-load").addEventListener("click", ()=>$("proj-file").click());
  // A refused load must SAY so. It used to log to a console nobody has open
  // while the toast still read "Project loaded".
  $("proj-file").addEventListener("change", (e)=>{ const f=e.target.files[0]; if(!f)return; $("proj-file").value="";   /* dom-only: file input, so re-picking the same file re-fires */
    const r=new FileReader(); r.onload=()=>{ try{ applyProject(JSON.parse(r.result)); toast("Project loaded"); log("Project loaded.","ok"); }catch(err){ log("Bad project file: "+err.message,"err"); toast("Not a project file — nothing changed","err"); } }; r.readAsText(f); });
  // aesthetic
  if($("aesthetic")) $("aesthetic").addEventListener("change", ()=>applyAesthetic($("aesthetic").value));
  // The pickers regroup, so any open gallery is showing the previous
  // arrangement's cards until it is repainted.
  if($("aesthetic")) $("aesthetic").addEventListener("change", ()=>["video","audio","image"].forEach(renderGallery));
  if($("pack-apply")) $("pack-apply").addEventListener("click", ()=>{ applyPack($("aesthetic").value); ["video","audio","image"].forEach(renderGallery); });
  initVideoTab();
  // Keying restarts the preview so the change is visible immediately — a key
  // you cannot see land is indistinguishable from one that did not.
  initKeyframes(()=>startVideoPreview());
  initLayers(()=>startVideoPreview());
  initBatch();
  initFilters(()=>startVideoPreview());
  /* The audio FX chain is the same panel over a different registry. Registered
     here rather than inside initAudioTab so both chains are wired in one place
     and the shared panel has exactly one call site per chain. */
  initChain(AUDIO_FX_CHAIN, {
    path:"filters.audio", registry:AUDIO_FX, groups:fxGroups, resolve:resolveFxParams,
    ids:{ list:"a-fx-list", pick:"a-fx-pick", add:"a-fx-add", clear:"a-fx-clear", count:"a-fx-count" },
    empty:"No effects — the sound is just the master bus below. Add one to shape, "
      + "smear or chop it, and the order decides what runs first.",
    onChange:()=>markAudioStale(),
  });
  initTimelineTab();
  initAudioTab();
  initImageTab();
  // A variable is used by both the video scenes and the screen templates, so a
  // change has to refresh both previews, not just the tab it was typed on.
  initVariables(()=>{ startVideoPreview(); renderImage(); });
  initPresetManager();
  // drag-drop media onto a preview: image → Ken Burns / import template; video (vcanvas only) → Video In
  [["vcanvas",()=>{ setVal("v-scene","kenburns"); startVideoPreview(); },true],["icanvas",()=>{ setVal("i-tpl","import"); renderImage(); },false]].forEach(([cid,after,vidOk])=>{ const el=$(cid); if(!el)return;
    el.addEventListener("dragover",e=>{ e.preventDefault(); }); el.addEventListener("drop",e=>{ e.preventDefault(); const f=e.dataTransfer.files[0]; if(!f)return;
      if(/^image\//.test(f.type)) loadImageFile(f,after);
      else if(vidOk&&/^video\//.test(f.type)) loadVideoFile(f,()=>{ setVal("v-scene","videoin"); startVideoPreview(); }); }); });
  wireLive("view-image",renderImage);
  // library / bundle
  $("lib-clear").addEventListener("click", clearLibrary); $("b-gen").addEventListener("click", doGenWiring); $("b-zip").addEventListener("click", exportCampaignBundle); $("b-validate").addEventListener("click", showValidation);
  // Changing the campaign target changes the beat list, so both the per-asset
  // beat dropdowns and the coverage panel have to be rebuilt — an asset left
  // pointing at a beat the new target does not have is what VALIDATE now flags.
  ["b-profile","b-cname","b-cid","b-beats"].forEach(id=>{ if($(id)) $(id).addEventListener("change", ()=>{ renderLibTable(); renderCoverage(); }); });
  // Importing the campaign's files changes what VALIDATE and the coverage
  // panel are comparing against, so both rebuild.
  initCampaignFiles(()=>{ renderLibTable(); renderCoverage(); showValidation(); });
  initCloud();
  if($("b-profile")) $("b-profile").addEventListener("change", ()=>{
    // Switching profile clears author overrides, otherwise the previous
    // campaign's name and beats silently follow you to the next one.
    ["b-cname","b-cid","b-beats"].forEach(id=>{ const el=$(id); if(el && el.value) setVal(id,""); });
    renderLibTable(); renderCoverage();
  });
  // reset-to-defaults: snapshot boot state, then wire per-tab reset + per-section ↺
  snapshotDefaults();
  const resetBtns={"v-reset":"view-video","a-reset":"view-audio","i-reset":"view-image","tl-reset":"view-timeline"};
  Object.entries(resetBtns).forEach(([id,view])=>{ if($(id))$(id).addEventListener("click", ()=>resetView(view)); });
  // Resetting the video tab has to drop its tracks too: leaving them behind
  // would restore default controls and then immediately animate away from them.
  if($("v-reset")) $("v-reset").addEventListener("click", ()=>{ clearAllKeyframes(); clearLayers(); });
  if($("a-tidy"))$("a-tidy").addEventListener("click", tidyAudioLayers);
  // keyboard
  document.addEventListener("keydown",(e)=>{
    // Ctrl/Cmd+S is the only modified chord we own.
    if((e.ctrlKey||e.metaKey) && !e.altKey && (e.key==="s"||e.key==="S")){ e.preventDefault(); $("proj-save").click(); return; }
    if((e.ctrlKey||e.metaKey) && !e.altKey && (e.key==="z"||e.key==="Z")){
      e.preventDefault();
      const st=studioSession?.store; if(!st) return;
      const did = e.shiftKey ? st.redo() : st.undo();
      if(did) toast(e.shiftKey?"Redo":"Undo"); else toast(e.shiftKey?"Nothing to redo":"Nothing to undo","info");
      return; }
    if((e.ctrlKey||e.metaKey) && !e.altKey && (e.key==="y"||e.key==="Y")){
      e.preventDefault(); if(studioSession?.store.redo()) toast("Redo"); return; }
    // Bare single-key shortcuts must never fire while a modifier is held —
    // otherwise `r` hijacks Ctrl+R and starts a recording as the page reloads.
    if(e.ctrlKey||e.metaKey||e.altKey) return;
    if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
    if(e.key>="1"&&e.key<="8"){ activateTab(["video","audio","image","timeline","library","bundle","cloud","help"][+e.key-1]); }
    else if(e.key==="r"||e.key==="R"){ const v=document.querySelector(".tab.active").dataset.view; if(v==="video")recordVideo(); else if(v==="audio")doRenderAudio(); else if(v==="image")renderImage(); else if(v==="timeline")recordTimeline(); }
    else if(e.key==="g"||e.key==="G"){ randomize(); } });
  // ux: collapsible sections + per-section reset + audio layer flags
  // Last, so loading the sample re-renders panels that are already wired.
  initWelcome(()=>{ startVideoPreview(); renderImage(); markAudioStale();
                    updateAudioLayerFlags(); refreshKeyframes(); renderLayers();
                    activateTab('video'); });
  enhanceFieldsets(); updateAudioLayerFlags();
  /* After the legends are enhanced, so the strip sits above finished sections
     rather than half-built ones. */
  initSections();
  /* A layer that is switched off is not what anyone is looking at. Folding them
     up front is what takes AUDIO from ten screens of scroll to something you
     can read. */
  foldInactiveAudioLayers();
  /* Dropping files on a video tool is the gesture everyone already knows, and
     it was the one thing this one did not accept. */
  initDropTarget();
  // enhanceFieldsets() gives every section a ↺. For KEYFRAMES the section IS
  // the tracks, so point its reset at them — otherwise it would reset the
  // parameter picker and appear to have done nothing.
  { const rst=$("v-auto-fieldset")?.querySelector("legend .rst");
    if(rst) rst.addEventListener("click",(e)=>{ e.stopPropagation(); clearAllKeyframes(); });
    const lrst=$("v-layers-fieldset")?.querySelector("legend .rst");
    if(lrst) lrst.addEventListener("click",(e)=>{ e.stopPropagation(); clearLayers(); }); }
  // init previews
  seedRng(currentSeed()); startVideoPreview(); renderImage(); renderLibTable(); renderCoverage(); renderTimelineTable();
  log("DEAD SIGNAL STUDIO ready — "+Object.keys(SCENES).length+" scenes, "+Object.keys(TEMPLATES).length+" screen templates.","ok");
  // Asked before initCloud() has had a chance to clear the fragment.
  initPersistence(session, { arrivedByShareLink });
}

/* Storage is best-effort and must never block or break boot: a private window
   with IndexedDB disabled falls back to memory and simply does not persist.

   Each stage carries its own guard. This used to be one try/catch, which meant
   a throw while APPLYING the restored document also silently skipped the asset
   rehydrate, the sweep and the autosave — the session ran un-persisted for its
   whole life behind a single "Persistence unavailable" line. Only a storage
   that cannot OPEN is persistence being unavailable. */
async function initPersistence(session, { arrivedByShareLink=false }={}){
  let backend;
  try{
    backend=await openStorage();
    studioBackend=backend;
  }catch(e){
    log("Persistence unavailable: "+e.message,"warn");
    return;
  }
  // Every generated blob goes to the asset store from here on. The store was
  // built for exactly this and nothing called it, so "generated assets are
  // lost on refresh" was still true however good the autosave was.
  setAssetPersister((key,blob)=>{
    backend.putAsset(key,blob,{}).catch((e)=>log("Could not store asset: "+e.message,"warn"));
  });
  let restoreFailed=false;
  try{
    const saved=await backend.getDoc("current");
    // A share link is an explicit request for someone else's project, and
    // restoring the autosave over it (or racing it) is never what the reader
    // asked for. The link loads; the autosave stays on disk, untouched.
    if(saved && saved.tabs && !arrivedByShareLink){
      applyProject(saved);
      log("Restored the autosaved session"+(backend.tier<2?" (memory only)":"")+".","ok");
      toast("Session restored");
    } else if(arrivedByShareLink){
      log("Opened from a share link — the autosaved session was left alone.","info");
    }
  }catch(e){
    /* The sweep below must not run after this. Its root set is the RUNTIME
       library, and a restore that threw leaves that library empty — so every
       stored byte looks like an orphan and the sweep deletes the lot. The
       message above promises the saved copy is untouched, and the document
       indeed is; every asset it points at was being destroyed one block later.
       Exactly the reasoning the share-link guard already carries, and the same
       answer: orphans can wait for a visit that knows what is live. */
    restoreFailed=true;
    log("Could not restore the autosaved session ("+e.message+") — starting fresh; the saved copy and its media are untouched.","warn");
  }
  try{
    await rehydrateAssets(backend, session, { arrivedByShareLink, restoreFailed });
  }catch(e){
    log("Could not restore library assets: "+e.message,"warn");
  }
  /* On a share-link visit the autosave writer must NOT run: it saves whatever
     document is live, and the live document is about to become someone else's
     shared project — writing that over the reader's own 'current' slot is the
     exact clobbering the restore guard above exists to prevent. Viewing is
     ephemeral; the reader keeps their work by saving a file or SAVE TO SERVER. */
  if(arrivedByShareLink){
    log("Autosave is paused for this visit so the shared project cannot overwrite your own session. Save a project file (Ctrl+S) or SAVE TO SERVER to keep changes.","info");
  }else{
    studioAutosave=autosave(session.store, backend, {
      onError:(e)=>log("Autosave failed: "+e.message,"warn"),
    });
  }
  if(backend.tier<2) log("No IndexedDB here — the session will not survive a reload.","warn");
}

/**
 * May the boot-time orphan sweep run?
 *
 * The sweep's root set is the RUNTIME library — whatever the document that just
 * loaded refers to. That is only a safe thing to delete against when the
 * document that loaded is the author's own and it loaded completely. Two states
 * fail that test and both used to be handled differently:
 *
 *   - a share-link visit deliberately does not apply the autosave, so the
 *     runtime library is empty or is somebody else's (already guarded);
 *   - a restore that THREW leaves the runtime library empty while the author's
 *     project sits intact on disk. The sweep then read every one of its assets
 *     as an orphan and deleted the lot — immediately after telling the author
 *     "the saved copy is untouched".
 *
 * Exported and named because the rule is the whole of the safety property, and
 * a rule spelled out as two `if`s in the middle of a 60-line function is one
 * that gets reordered by the next edit. Orphans are cheap; a project's media is
 * not, so the sweep waits for a boot that knows what is live.
 */
export function maySweepOrphans({ arrivedByShareLink = false, restoreFailed = false } = {}) {
  return !arrivedByShareLink && !restoreFailed;
}

/* Put the bytes back under the restored rows, then collect the orphans.
 *
 * Removing a row does NOT delete its bytes — undo has to be able to bring the
 * row back intact — so the store accumulates within a session and is swept
 * once here, against the library the restored document actually refers to.
 * Best-effort throughout: a failure to restore one clip must not cost the
 * project it belongs to. */
async function rehydrateAssets(backend, session, { arrivedByShareLink=false, restoreFailed=false }={}){
  let restored=0, missing=0;
  const rows=session.store.get("library")||[];
  for(const r of rows){
    if(!r || !r.key) { missing++; continue; }
    try{
      const rec=await backend.getAsset(r.key);
      if(rec && rec.blob){ attachAssetBlob(r.key, rec.blob); restored++; }
      else missing++;
    }catch(e){ missing++; }
  }
  if(rows.length){
    renderLibTable(); renderCoverage();
    log("Library restored: "+restored+"/"+rows.length+" asset"+(rows.length===1?"":"s")
        +(missing?" ("+missing+" without bytes — re-render to fill them in)":""),
        missing?"warn":"ok");
  }
  // Only against a library this boot can vouch for — see maySweepOrphans().
  if(!maySweepOrphans({ arrivedByShareLink, restoreFailed })){
    if(restoreFailed) log("Orphan sweep skipped: the session did not restore, so nothing here knows which assets are still in use.","info");
    return;
  }
  try{
    const live=referencedKeys();
    for(const k of await backend.listAssets()) if(!live.has(k)) await backend.deleteAsset(k);
  }catch(e){ /* a sweep that cannot run is not a failure worth reporting */ }
}

/* Public seam for the smoke suite and devtools poking. Deliberately explicit:
   with ES modules nothing lands on `window` by accident, so anything external
   that needs a handle gets it here, by name, on purpose. */
window.DeadSignalStudio = {
  SCENES, TEMPLATES,
  get store(){ return studioSession?.store ?? null; },
  get backend(){ return studioBackend; },
  flushAutosave: ()=>studioAutosave?.flush(),
  undo: ()=>studioSession?.store.undo(),
  explainCoverage,
  // Deterministic render entry points, so an audit can prove each effect
  // actually changes pixels rather than merely existing.
  readVideoCfg, renderVideoFrame, readImageCfg, readAudioCfg, renderAudio,
  isWorkspace, setWorkspace,
  feedLuminance, paintFlash, resetFlashMeter, currentFlashRate: currentRate,
  applyLevel, getLevel, applyMacro, MACROS,
  redo: ()=>studioSession?.store.redo(),
  readProject, applyProject,
  renderImage, decodeStego,
  library, addToLibrary, clearLibrary,
  showValidation, exportCampaignBundle,
  startVideoPreview, stopVideoPreview,
  addTimelineClip, addStillClip, addOverlayClip, addTitleClip, addGraphicClip, clearTimeline,
  setTimelineClips,
  editClip, buildSchedule, renderTimelineFrame, timeline,
  trackScale, addAudioClip, editAudioClip, commitAudioClips, audioTimeline, sequenceMix, clipSourceTime,
  activeSection, sectionsOf, showSection, importDroppedFiles, useAsset, dropAsset,
  refreshKeyframes, clearAllKeyframes,
  renderLayers, addLayer, clearLayers,
  renderFilters, addFilter, clearFilters,
  renderAudioFx:()=>renderChain(AUDIO_FX_CHAIN),
  renderRegions, addRegion, clearRegions,
  renderSolo, toggleSolo, clearSolo,
  renderAnnotations, addAnnotation, clearAnnotations, selectAnnotation, updateAnnotation,
  toggleGallery, renderGallery, invalidateThumbs,
  applyPack,
  addAudioFx:(id)=>addToChain(AUDIO_FX_CHAIN,id),
  clearAudioFx:()=>clearChain(AUDIO_FX_CHAIN),
  renderCampaignFiles, genWiring,
  getContrast, setContrast,
  renderCloud, refreshCloud,
};

document.addEventListener("DOMContentLoaded",boot);
