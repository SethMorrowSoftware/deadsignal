/* Dead Signal Studio — core/palettes.js */
import { $, log, setVal, toast } from './dom.js';
import { getStore } from '../doc/session.js';
import { renderImage } from '../image/render.js';
import { fillTemplateSelect } from '../image/templates.js';
import { fillSceneSelect } from '../video/scenes.js';
import { packFor } from './packs.js';
import { PRESETS, presetRecipe } from '../presets/index.js';
import { applyRecipe } from './recipes.js';
import { startVideoPreview } from '../video/capture.js';

export const PALETTES=[
  {name:"— custom —",bg:null,fg:null},
  {name:"P1 Green",bg:"#020806",fg:"#39ff9e"},
  {name:"P3 Amber",bg:"#0a0500",fg:"#ffb347"},
  {name:"IBM 5151",bg:"#000000",fg:"#33ff33"},
  {name:"DEC White",bg:"#04060a",fg:"#e8f0ff"},
  {name:"EREBUS Cyan",bg:"#02060a",fg:"#5fd9ff"},
  {name:"C64",bg:"#3e31a2",fg:"#7c70da"},
  {name:"Plasma Red",bg:"#0a0203",fg:"#ff5a5a"},
  {name:"Neon Magenta",bg:"#0a0014",fg:"#ff2bd6"},
  {name:"Neon Cyan",bg:"#00060f",fg:"#00f0ff"},
  {name:"Synthwave",bg:"#160730",fg:"#ff6ac1"},
  {name:"Blade Amber",bg:"#0a0806",fg:"#ffb000"},
  {name:"Vapor Pink",bg:"#1a0b2e",fg:"#ff9ff3"},
  {name:"Miami",bg:"#2b0a3d",fg:"#00e5ff"},
];
export function fillPaletteSelect(sel){ if(!sel)return; sel.replaceChildren(); PALETTES.forEach(p=>{ const o=document.createElement("option"); o.value=p.name; o.textContent=p.name; sel.appendChild(o); }); }
export function applyPalette(sel,bgId,fgId){ const p=PALETTES.find(x=>x.name===sel.value); if(p&&p.bg){ setVal(bgId,p.bg); setVal(fgId,p.fg); } }
/* ---------- morse ---------- */
/* An aesthetic is CSS variables plus one of the palettes above.
 *
 * It used to carry its own copy of the colours (vbg/vfg) alongside the palette
 * NAME, and the two had already drifted: "Cyberpunk" selected Neon Magenta and
 * then wrote Neon Cyan's colours, so the picker named a palette the picture was
 * not using. Naming the palette and looking its colours up is one fact instead
 * of three, and it cannot come apart again. */
export const AESTHETICS={
  "analogue-horror":{label:"Analogue Horror",vars:{"--phos":"#39ff9e","--phos-dim":"#1f7d55","--cyan":"#5fd9ff","--amber":"#ffb347","--text":"#bfeee0","--hot":"#ff3860"},palette:"P1 Green"},
  "erebus":{label:"EREBUS",vars:{"--phos":"#39ff9e","--phos-dim":"#1f7d55","--cyan":"#5fd9ff","--amber":"#ffb347","--text":"#bfeee0","--hot":"#ff3860"},palette:"EREBUS Cyan"},
  // Neon Cyan, not Neon Magenta: these are the colours this aesthetic has
  // always actually applied. The magenta lives in --phos, which reskins the
  // tool's own chrome.
  "cyberpunk":{label:"Cyberpunk",vars:{"--phos":"#ff2bd6","--phos-dim":"#8f1f78","--cyan":"#00f0ff","--amber":"#ffe600","--text":"#e6d8ff","--hot":"#ff2bd6"},palette:"Neon Cyan"},
  "vaporwave":{label:"Vaporwave",vars:{"--phos":"#ff9ff3","--phos-dim":"#a86ab0","--cyan":"#7af0ff","--amber":"#fff5b0","--text":"#ffd6ff","--hot":"#ff6ac1"},palette:"Vapor Pink"},
};
/* Writing the palette pickers with `.value =` put the name on screen and told
   the document nothing — and because the setVal() calls below then changed the
   document, renderDocToDom pushed the OLD name straight back over it inside the
   same function. The picker never once showed the aesthetic's palette. */
/** The tool's own chrome, plus regrouping the two packed pickers. No document. */
function applyChrome(id,a){
  const rs=document.documentElement.style; for(const k in a.vars) rs.setProperty(k,a.vars[k]);
  /* The scene and template pickers group by the aesthetic's pack, so switching
     aesthetic has to rebuild them. Both preserve the current selection and
     neither dispatches, so this cannot change what is selected — only how the
     list is arranged. */
  fillSceneSelect(id); fillTemplateSelect(id);
}
/** The six control writes that put the aesthetic's palette on both tabs. */
function paletteWrites(a){
  const p=PALETTES.find(x=>x.name===a.palette);
  if(!p||!p.bg) return null;
  return ()=>{
    ["v-palette","i-palette"].forEach(pid=>{ if($(pid)) setVal(pid,a.palette); });
    setVal("v-bg",p.bg); setVal("v-fg",p.fg); setVal("i-bg",p.bg); setVal("i-fg",p.fg);
  };
}
export function applyAesthetic(id){ const a=AESTHETICS[id]; if(!a)return;
  applyChrome(id,a);
  const write=paletteWrites(a); if(!write) return;
  // Six control writes, one gesture: one undo entry.
  const st=getStore(); if(st) st.transaction(write,"aesthetic"); else write();
  startVideoPreview(); renderImage(); log("Aesthetic: "+a.label,"info"); toast("Aesthetic → "+a.label); }

/**
 * Put the whole tool into one world: colours AND a matching starting point on
 * every tab, as a single undo entry.
 *
 * The aesthetic switch reskinned the chrome and set a palette; the presets that
 * belong to that aesthetic were already grouped under its name in every picker,
 * and nothing connected the two. An author who chose "Cyberpunk" got magenta
 * menus and then had to go and find the cyberpunk presets in three separate
 * dropdowns.
 *
 * This takes the FIRST preset of the aesthetic's group on each tab, which is
 * deliberate rather than a random pick: a pack is a starting point, and a
 * starting point that is different every time is not one. Locks are respected,
 * exactly as they are when the preset is chosen by hand — a locked section is
 * the author's standing instruction, not something a bigger gesture overrides.
 */
export function applyPack(id){
  const a=AESTHETICS[id], pack=packFor(id);
  if(!a||!pack) return null;
  applyChrome(id,a);
  const palette=paletteWrites(a);
  const loaded=[];
  /* PRESETS FIRST, PALETTE SECOND. Loading a preset resets the tab to its boot
     defaults before applying the preset over the top (so a preset always lands
     on the same look) — and the boot default for v-bg is P1 Green. Applying the
     palette first meant every pack came out in green, because the presets
     immediately reset the very controls the palette had just written. */
  const write=()=>{
    for(const [tab,viewId] of [["video","view-video"],["audio","view-audio"],["image","view-image"]]){
      const group=(PRESETS[tab]||{})[pack.presetGroup];
      const name=group&&Object.keys(group)[0];
      if(!name) continue;
      applyRecipe(viewId,presetRecipe(tab,viewId,group[name]));
      // Through setVal so the picker's own value reaches the document — a bare
      // assignment would be overwritten the moment the recipe re-rendered it.
      setVal({video:"v-preset",audio:"a-preset",image:"i-preset"}[tab],name);
      loaded.push(tab+": "+name);
    }
    /* …but a preset that names its own colours keeps them: a look with a
       deliberate palette is the preset's whole point, so the pack only fills in
       what the preset left at the tab default. */
    if(palette) palette();
    for(const [tab,viewId] of [["video","view-video"],["image","view-image"]]){
      const group=(PRESETS[tab]||{})[pack.presetGroup];
      const name=group&&Object.keys(group)[0];
      const rec=name&&group[name]; if(!rec) continue;
      const pre=tab==="video"?"v-":"i-";
      for(const k of ["bg","fg"]) if(rec[pre+k]!=null) setVal(pre+k,rec[pre+k]);
      if(rec[pre+"palette"]!=null) setVal(pre+"palette",rec[pre+"palette"]);
    }
  };
  const st=getStore(); if(st) st.transaction(write,"aesthetic pack"); else write();
  startVideoPreview(); renderImage();
  log("Pack ["+a.label+"] → "+(loaded.join("  ·  ")||"no presets in this group"),"ok");
  toast("Pack → "+a.label);
  return loaded; }
/* ============================================================================
   UX — banners, live preview, randomize, keyboard, boot
   ========================================================================== */
