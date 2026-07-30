/* Dead Signal Studio — ui/shell.js */
import { markAudioStale, stopAudioPlayback } from '../audio/ui.js';
import { $, clamp, esc, log, setVal, toast } from '../core/dom.js';
import { readRecipe } from '../core/recipes.js';
import { getStore } from '../doc/session.js';
import { set } from '../doc/store.js';
import { safeClone } from '../doc/paths.js';
import { currentSeed, resetSeed, rnd } from '../core/rng.js';
import { renderImage } from '../image/render.js';
import { renderCoverage } from '../library/bundle.js';
import { renderLibTable } from '../library/library.js';
import { startVideoPreview, stopVideoPreview } from '../video/capture.js';
import { readVideoCfg } from '../video/render.js';
import { renderTimelineTable, startTimelinePreview, stopTimelinePreview } from '../video/timeline.js';

// Built from DOM nodes rather than an innerHTML string: `esc()` is only
// String(), not an HTML escaper, so interpolating a message here was a live
// injection sink the moment any banner text included a filename or user input.
export function setBanner(boxId,items){ const box=$(boxId); if(!box)return; box.replaceChildren();
  items.forEach(it=>{ const d=document.createElement("div"); d.className="banner";
    const s=document.createElement("span"); s.textContent=esc(it.msg); d.appendChild(s);
    if(it.fix){ const b=document.createElement("button"); b.className="btn small amber"; b.textContent="auto-fix"; b.addEventListener("click", it.fix); d.appendChild(b);} box.appendChild(d); }); }
export function clearBanner(boxId){ const b=$(boxId); if(b)b.replaceChildren(); }
export function validateVideo(){ const cfg=readVideoCfg(); const items=[];
  if(cfg.reveal && cfg.revhold>=cfg.duration) items.push({msg:"Reveal hold ≥ duration — reveal shows the whole clip.",fix:()=>{setVal("v-revhold",(cfg.duration*0.15).toFixed(1)); startVideoPreview();}});
  /* "Large frame×fps may drop frames" is only true of the real-time recorder.
     The offline encoder renders every frame at full cost and drops none, so
     once delivery sizes exist this warning fired permanently on exactly the
     settings an author is supposed to use — 1080×1920 is not a mistake. */
  const offline = typeof VideoEncoder!=="undefined";
  if(!offline && cfg.W*cfg.H*cfg.fps>320*240*15*4) items.push({msg:"Large frame×fps and no offline encoder here — real-time recording may drop frames.",fix:()=>{setVal("v-fps",12); startVideoPreview();}});
  // 2× supersample renders four times the pixels into a scratch canvas. At a
  // delivery size that is 3840×3840 of buffer, which is worth saying out loud.
  if(cfg.ss && cfg.W*cfg.H>1280*720) items.push({msg:"2× supersample at this size renders "+(cfg.W*2)+"×"+(cfg.H*2)+" offscreen — turn it off if the preview stalls.",fix:()=>{setVal("v-ss",false); startVideoPreview();}});
  if(items.length) setBanner("v-banners",items); else clearBanner("v-banners"); }
export let _liveT=null;
export function wireLive(viewId,fn){ const c=$(viewId); if(!c)return; c.addEventListener("input",()=>{ clearTimeout(_liveT); _liveT=setTimeout(fn,70); }); }
/* Drop a pending live callback. A render reads the CURRENT document, so any
   edit still sitting in the 70ms debounce is already reflected in it — letting
   that callback land afterwards would mark fresh output stale and disable its
   download. */
export function cancelLive(){ clearTimeout(_liveT); }
/* Nudge every slider on the active tab, seeded so the same seed gives the same
   shove twice.
 *
 * This used to assign `r.value` straight onto each control. Since the document
 * became authoritative that moved the widgets and nothing else: the render kept
 * the values it already had, and the next document change — any other edit —
 * pushed the old numbers back into the sliders, so the shove visibly undid
 * itself. Randomize appeared to work and never once changed a frame.
 *
 * Written through setVal() inside one transaction: the values reach the
 * document by the same path a human edit takes, and the whole shove is a single
 * undo entry rather than thirty. */
export function randomize(){ const view=document.querySelector(".tab.active").dataset.view; const map={video:"view-video",audio:"view-audio",image:"view-image"}[view]; if(!map)return; resetSeed();
  const next=[];
  document.querySelectorAll("#"+map+' input[type=range]').forEach(r=>{
    if(!r.id) return;
    // The scrubber is a playhead and the macro dials are a convenience layer
    // that WRITES the sliders below — randomising either would either move the
    // preview position or immediately stomp everything just randomised.
    if(r.closest(".scrub")||r.closest(".macros")) return;
    const fs=r.closest("fieldset"); const lock=fs&&fs.querySelector('input[type=checkbox][id^="lock-"]'); if(lock&&lock.checked)return;
    const min=+r.min,max=+r.max,cur=+r.value;
    next.push([r.id, String(Math.round(clamp(cur+(rnd()-0.5)*(max-min)*0.5,min,max)))]);
  });
  const write=()=>next.forEach(([id,v])=>setVal(id,v));
  const st=getStore(); if(st) st.transaction(write,"randomize"); else write();
  if(view==="video")startVideoPreview(); else if(view==="image")renderImage(); else markAudioStale(); toast("Randomized (seed "+currentSeed()+")"); }
export function activateTab(name){
  // Roving tabindex: only the selected tab is in the tab order, and arrow keys
  // move between them — the expected keyboard model for a tablist.
  document.querySelectorAll(".tab").forEach(t=>{
    const on=t.dataset.view===name;
    t.classList.toggle("active",on);
    t.setAttribute("aria-selected",on?"true":"false");
    t.tabIndex=on?0:-1;
  });
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+name));
  if(name==="video")startVideoPreview(); else stopVideoPreview();
  if(name==="timeline"){ renderTimelineTable(); startTimelinePreview(); } else stopTimelinePreview();
  if(name==="audio")updateAudioLayerFlags(); else stopAudioPlayback();
  if(name==="library")renderLibTable(); if(name==="bundle"){renderCoverage();}
  // Every route into a workspace switch lands here — clicks, digits 1-8, the
  // tablist arrows, palette and menu actions — so this is where the editor
  // chrome learns the view changed rather than noticing on its next poll.
  document.dispatchEvent(new CustomEvent("studio:view",{detail:{view:name}})); }
/* Wrap each fieldset legend's title text in a clickable toggle so any section
   can be folded away. The existing reset (↺) / lock spans stay outside the
   toggle, so clicking those never collapses the section. */
/* ---- reset-to-defaults: snapshot the boot state of every view, then restore
   a single fieldset or a whole tab from it. Captured once at boot. ---- */
export let _viewDefaults={};
export function snapshotDefaults(){ ["view-video","view-audio","view-image","view-timeline"].forEach(v=>{ if($(v)) _viewDefaults[v]=readRecipe(v); }); }
/* Reset writes through the document too — assigning .value only moved the
   widgets while the render kept the values it already had, so RESET appeared
   to do nothing. One transaction: resetting a section is one undo step. */
export function applySnapshotTo(nodes,snap){ let n=0;
  const write=()=>nodes.forEach(e=>{ if(e.id&&(e.id in snap)){ setVal(e.id,snap[e.id]); n++; } });
  const st=getStore(); if(st) st.transaction(write,"reset"); else write();
  return n; }
export function afterReset(viewId){ if(viewId==="view-video")startVideoPreview(); else if(viewId==="view-image")renderImage();
  else if(viewId==="view-timeline")startTimelinePreview(); else if(viewId==="view-audio"){ markAudioStale(); updateAudioLayerFlags(); } }

/* State a tab owns that is NOT a control.
 *
 * RESET restores every input, select and textarea in the view from the boot
 * snapshot — which was the whole tab, back when a tab WAS its controls. It is
 * not any more: seven kinds of state now live in the document instead, and
 * "reset this whole tab to defaults" was quietly leaving all of them. You could
 * press RESET on the AUDIO tab and still be listening to a soloed mix through a
 * five-effect chain with a crop on it, with the solo banner still lit.
 *
 * Cleared in the SAME transaction as the controls, so the whole reset is one
 * undo entry and nothing here is lost for good by a misclick.
 */
const VIEW_DOC_STATE = {
  "view-video": { "filters.video": [], "layers.video": [], "automation.video": {} },
  "view-audio": { "filters.audio": [], "audio.regions": [], "audio.solo": [] },
  "view-image": { "image.annotations": [] },
};

/* Panels that are projections of the document have to be told, because a reset
   applies as a normal transaction and the document binding only refreshes them
   on undo/redo/load. boot.js hands its own refresh in. */
let _resetRefresh=()=>{};
export function setResetRefresh(fn){ _resetRefresh=typeof fn==="function"?fn:()=>{}; }
/* Sections whose contents are not controls at all.
 *
 * `data-doc-reset` on the fieldset names the document path that section owns.
 * Declared in the markup rather than listed here because the panel and the
 * thing it edits belong together, and a panel added without one is a panel
 * whose ↺ visibly does nothing — which is exactly what FILTERS, FX CHAIN,
 * MARKS, LAYERS, KEYFRAMES and audio EDITS were all doing: `resetFieldset`
 * restored inputs from the boot snapshot, those sections contain no inputs
 * worth restoring, and the toast said "Section reset" over an untouched
 * eight-step filter chain. The whole-tab RESET was fixed for this once
 * (VIEW_DOC_STATE); the per-section ↺ beside every legend was not. */
const DOC_RESET_EMPTY = { 'automation.video': {}, 'automation.image': {} };

/* Write-only dials: moving one writes a dozen controls in OTHER sections.
 *
 * That makes them the one control a section reset must NOT dispatch. Resetting
 * QUICK LOOK — two sliders — fired both macros at level 0 and overwrote all
 * twelve CRT/VHS controls in the fieldset below, measured, including on a tab
 * where the author had never touched a macro at all and had set every one of
 * those twelve by hand. Put the dial back; do not pull the trigger. */
const isMacro = (el) => /^[a-z]-macro-/.test(el.id || '');

export function resetFieldset(fs){ const view=fs.closest(".view"); if(!view)return; const snap=_viewDefaults[view.id]; if(!snap)return;
  const st=getStore();
  const paths=(fs.dataset.docReset||"").split(/\s+/).filter(Boolean);
  const controls=[...fs.querySelectorAll("input,select,textarea")];
  const write=()=>{
    controls.forEach(e=>{
      if(!e.id || !(e.id in snap)) return;
      if(isMacro(e)){ e.value=snap[e.id]; return; }   /* dom-only: a macro writes other sections; see isMacro */
      setVal(e.id,snap[e.id]);
    });
    if(st) for(const p of paths) st.apply(set(p,safeClone(DOC_RESET_EMPTY[p]??[]),{label:"reset"}));
  };
  if(st) st.transaction(write,"reset"); else write();
  if(paths.length) _resetRefresh();
  afterReset(view.id); toast("Section reset"); }
export function resetView(viewId){ const view=$(viewId); const snap=_viewDefaults[viewId]; if(!view||!snap)return;
  const docState=VIEW_DOC_STATE[viewId]||{};
  const st=getStore();
  const write=()=>{
    view.querySelectorAll("input,select,textarea").forEach(e=>{ if(e.id&&(e.id in snap)) setVal(e.id,snap[e.id]); });
    // The lists, chains and marks the controls cannot speak for.
    if(st) for(const path in docState) st.apply(set(path,safeClone(docState[path]),{label:"reset"}));
  };
  if(st) st.transaction(write,"reset"); else write();
  _resetRefresh();
  afterReset(viewId); toast("Reset to defaults"); log("Reset "+viewId+" to defaults","info"); }
/* ---- audio layer flags: reflect each layer's on/off in its legend so you can
   see what's active without expanding, and offer a one-click "tidy" that folds
   away every layer that has nothing enabled. ---- */
export function fieldsetActive(fs){ return Array.from(fs.querySelectorAll('input[type=checkbox]')).some(c=>c.checked); }
export function updateAudioLayerFlags(){ const v=$("view-audio"); if(!v)return; let on=0,total=0; const names=[];
  v.querySelectorAll("fieldset").forEach(fs=>{ if(!fs.querySelector('input[type=checkbox]'))return; total++; const active=fieldsetActive(fs);
    fs.classList.toggle("layer-on",active); const dot=fs.querySelector(".ttl .dot"); if(dot)dot.textContent=active?"●":"○";
    if(active){ on++; const t=fs.querySelector(".ttl>span:last-child"); if(t)names.push(t.textContent); } });
  const s=$("a-active"); if(s)s.textContent = on? (on+" active: "+names.join(", ")) : "no layers enabled"; }
/**
 * Fold every audio layer that is switched off.
 *
 * Split out from the TIDY button so boot can start in this state. AUDIO carries
 * twenty-three layer sections and they all opened expanded, which is ten
 * screens of scroll describing sounds that are not playing — the layers you
 * turned ON are the ones you are working with, and they stay open.
 */
export function foldInactiveAudioLayers(){ const v=$("view-audio"); if(!v)return 0; let folded=0;
  v.querySelectorAll("fieldset").forEach(fs=>{ if(!fs.querySelector('input[type=checkbox]'))return; const active=fieldsetActive(fs);
    fs.classList.toggle("collapsed",!active);
    const t=fs.querySelector("legend .ttl"); if(t)t.setAttribute("aria-expanded",String(active));
    if(!active)folded++; }); return folded; }
export function tidyAudioLayers(){ const folded=foldInactiveAudioLayers();
  toast(folded?("Folded "+folded+" unused layer"+(folded>1?"s":"")):"All layers in use"); }
/* Enhance every fieldset legend: a click-to-collapse title, a reset ↺ control,
   and (for audio layers) an on/off dot. Existing reset/lock spans are preserved. */
export function enhanceFieldsets(){
  document.querySelectorAll("fieldset > legend").forEach(lg=>{
    if(lg.querySelector(".ttl")) return; let label=""; const lead=[];
    for(const n of Array.from(lg.childNodes)){ if(n.nodeType===3){ label+=n.textContent; lead.push(n); } else break; }
    label=label.trim(); if(!label) return; lead.forEach(n=>n.remove());
    const ttl=document.createElement("span"); ttl.className="ttl";
    /* A span wired to click is mouse-only; folding a section away is not a
       mouse-only idea. role=button + tabindex puts it in the tab order, and
       aria-expanded says which way it will fold. */
    ttl.setAttribute("role","button"); ttl.tabIndex=0;
    ttl.setAttribute("aria-expanded", String(!lg.parentElement.classList.contains("collapsed")));
    const caret=document.createElement("span"); caret.className="caret"; caret.textContent="▼";
    const isAudio=!!lg.closest("#view-audio"), hasCk=!!lg.closest("fieldset").querySelector('input[type=checkbox]');
    if(isAudio&&hasCk){ const dot=document.createElement("span"); dot.className="dot"; dot.textContent="○"; ttl.appendChild(dot); }
    const txt=document.createElement("span"); txt.textContent=label;
    ttl.appendChild(caret); ttl.appendChild(txt); lg.insertBefore(ttl, lg.firstChild);
    const fold=()=>{ const fs=lg.parentElement; fs.classList.toggle("collapsed");
      ttl.setAttribute("aria-expanded", String(!fs.classList.contains("collapsed"))); };
    ttl.addEventListener("click",fold);
    ttl.addEventListener("keydown",(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); fold(); } });
    if(!lg.querySelector(".rst")){ const rst=document.createElement("span"); rst.className="rst"; rst.textContent="↺"; rst.title="reset this section to defaults";
      lg.appendChild(rst); } });
  // wire every reset ↺ (existing + injected) to reset its fieldset — by
  // keyboard too, since a reset is a control, not decoration
  document.querySelectorAll("fieldset legend .rst").forEach(r=>{
    r.setAttribute("role","button"); r.tabIndex=0;
    if(!r.getAttribute("aria-label")) r.setAttribute("aria-label","Reset this section to defaults");
    r.addEventListener("click", (e)=>{ e.stopPropagation(); const fs=r.closest("fieldset"); if(fs)resetFieldset(fs); });
    /* Through click(), so the sections whose ↺ carries an extra listener
       (KEYFRAMES, LAYERS — see boot.js) behave the same from the keyboard. */
    r.addEventListener("keydown", (e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); r.click(); } });
  });
}

/* Arrow / Home / End navigation across the tablist, per the WAI-ARIA tabs
   pattern. Selection follows focus, which is correct here because switching
   panels is cheap and has no side effects. */
export function initTablistKeys(){
  const list=document.getElementById("tabs");
  if(!list) return;
  list.addEventListener("keydown",(e)=>{
    const tabs=[...list.querySelectorAll('[role="tab"]')];
    const i=tabs.indexOf(document.activeElement);
    if(i<0) return;
    let j=null;
    if(e.key==="ArrowRight"||e.key==="ArrowDown") j=(i+1)%tabs.length;
    else if(e.key==="ArrowLeft"||e.key==="ArrowUp") j=(i-1+tabs.length)%tabs.length;
    else if(e.key==="Home") j=0;
    else if(e.key==="End") j=tabs.length-1;
    else if(e.key===" "||e.key==="Enter"){ e.preventDefault(); activateTab(tabs[i].dataset.view); return; }
    else return;
    e.preventDefault();
    activateTab(tabs[j].dataset.view);
    tabs[j].focus();
  });
}