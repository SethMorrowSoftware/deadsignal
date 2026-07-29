/* Dead Signal Studio — presets/index.js */
import { markAudioStale } from '../audio/ui.js';
import { $, log } from '../core/dom.js';
import { applyRecipe, userPresets } from '../core/recipes.js';
import { renderImage } from '../image/render.js';
import { _viewDefaults } from '../ui/shell.js';
import { startVideoPreview } from '../video/capture.js';

export const PRESETS={
 video:{
  "Analogue Horror":{
    "Signal Loss":{"v-scene":"snow","v-w":"320","v-h":"240","v-dur":"10","v-bg":"#02060a","v-fg":"#5fd9ff","v-text":"NO SIGNAL","v-hud":"SIGNAL // 03:47","v-tc":true,"v-scan":"52","v-noise":"70","v-vig":"60","v-chroma":"20"},
    "Surveillance Cam":{"v-scene":"camera","v-w":"384","v-h":"288","v-fps":"10","v-fg":"#9fead0","v-text":"NO OPERATOR PRESENT","v-hud":"CAM 47 // LAB-3   REC ●","v-tc":true,"v-vig":"70","v-noise":"22","v-track":"20"},
    "Flatline":{"v-scene":"ekg","v-w":"360","v-h":"240","v-dur":"12","v-fg":"#39ff9e","v-scan":"36"},
    "BIOS Boot":{"v-scene":"boot","v-w":"400","v-h":"300","v-dur":"7","v-fg":"#c8ffc8","v-scan":"30","v-noise":"6"},
  },
  "EREBUS":{
    "Webb — Last Session":{"v-scene":"terminal","v-w":"360","v-h":"240","v-dur":"12","v-fg":"#39ff9e","v-text":"M. WEBB — SESSION 47\n\ni am not being taken.\ni am answering a\nloneliness with my own.","v-textmode":"typed","v-font":"15","v-hud":"REC ●  WEBB_47","v-tc":true,"v-tcstart":"03:41:00","v-glitch":"12","v-reveal":"OBSERVE","v-revhold":"1.4"},
    "Merge Protocol":{"v-scene":"loading","v-w":"320","v-h":"240","v-dur":"9","v-fg":"#5fd9ff","v-text":"CONSCIOUSNESS MAP","v-glitch":"18","v-reveal":"hello.","v-revhold":"1.6"},
  },
  "Cyberpunk":{
    "Neon Grid":{"v-scene":"neongrid","v-w":"400","v-h":"300","v-dur":"12","v-fg":"#ff2bd6","v-text":"OUTRUN","v-bloom":"36","v-chroma":"24","v-scan":"28"},
    "HUD Lock":{"v-scene":"hud","v-w":"400","v-h":"300","v-dur":"10","v-bg":"#00060f","v-fg":"#00f0ff","v-text":"TARGET ACQUIRED","v-bloom":"30","v-chroma":"20","v-scan":"24"},
    "Neon City Rain":{"v-scene":"cityrain","v-w":"360","v-h":"280","v-dur":"12","v-bg":"#050010","v-fg":"#00f0ff","v-text":"NIGHT CITY","v-bloom":"40","v-vig":"55"},
    "System Breach":{"v-scene":"breach","v-w":"400","v-h":"300","v-dur":"10","v-bg":"#02000a","v-fg":"#39ff9e","v-bloom":"30","v-scan":"28","v-glitch":"20"},
    "Hologram":{"v-scene":"hologram","v-w":"360","v-h":"300","v-dur":"10","v-bg":"#00060f","v-fg":"#00f0ff","v-bloom":"36","v-text":"SYSTEM ONLINE\nID: 0047\nSTATUS: ACTIVE"},
  },
  "Vaporwave":{
    "Retrowave Sun":{"v-scene":"neongrid","v-w":"400","v-h":"300","v-dur":"14","v-fg":"#ff9ff3","v-text":"AESTHETIC","v-fullwidth":true,"v-bloom":"30","v-chroma":"14","v-persist":"20"},
    "Vapor Statue":{"v-scene":"statue","v-w":"400","v-h":"300","v-dur":"14","v-text":"PLAZA","v-bloom":"28","v-persist":"24","v-scan":"20"},
    "Mall Signal":{"v-scene":"terminal","v-w":"360","v-h":"280","v-dur":"12","v-bg":"#1a0b2e","v-fg":"#ff9ff3","v-text":"WELCOME\nto the plaza","v-fullwidth":true,"v-align":"center","v-font":"22","v-bloom":"26","v-persist":"20"},
  },
  "Utility":{
    "SMPTE Bars":{"v-scene":"bars","v-w":"400","v-h":"300","v-dur":"8","v-scan":"22"},
    "Digital Rain":{"v-scene":"matrix","v-w":"360","v-h":"280","v-dur":"12","v-fg":"#39ff9e","v-persist":"30","v-bloom":"30"},
    "Radar":{"v-scene":"radar","v-w":"320","v-h":"320","v-dur":"12","v-fg":"#39ff9e"},
  },
 },
 audio:{
  "Analogue Horror":{
    "Archive Hum 47":{"a-dur":"9","a-drone":true,"a-drone-f":"70","a-drone-g":"34","a-noise":true,"a-noise-g":"12","a-noise-lp":"900","a-pulse":true,"a-pulse-n":"47","a-pulse-f":"430","a-pulse-rate":"4"},
    "Dialup Ghost":{"a-dur":"8","a-drone":false,"a-dial":true},
    "Number Station":{"a-dur":"12","a-drone":true,"a-drone-f":"220","a-drone-w":"sine","a-drone-g":"20","a-dtmf":true,"a-dtmf-d":"0347047","fx-phone":true,"fx-reverb":true},
    "Panic Heartbeat":{"a-dur":"10","a-drone":false,"a-heart":true,"a-heart-bpm":"120","a-sub":true,"fx-reverb":true},
  },
  "EREBUS":{
    "Choir of Processes":{"a-dur":"10","a-drone":true,"a-drone-f":"110","a-drone-w":"sawtooth","a-drone-g":"28","a-drone-voices":"6","a-drone-det":"22","fx-reverb":true,"fx-reverb-d":"3.5"},
    "Webb Cipher (morse)":{"a-dur":"11","a-drone":true,"a-drone-f":"80","a-drone-g":"26","a-noise":true,"a-noise-g":"14","a-morse":true,"a-morse-w":"EREBUS","fx-phone":true},
    "Sable Relay B (11)":{"a-dur":"9","a-drone":true,"a-drone-f":"60","a-drone-g":"24","a-noise":true,"a-noise-g":"10","a-pulse":true,"a-pulse-n":"11","a-pulse-f":"360","a-pulse-rate":"2"},
  },
  "Cyberpunk":{
    "Neon Pulse":{"a-dur":"10","a-drone":true,"a-drone-f":"55","a-drone-w":"sawtooth","a-drone-g":"24","a-sub":true,"a-pulse":true,"a-pulse-n":"32","a-pulse-f":"110","a-pulse-rate":"8","fx-dist":true,"fx-dist-d":"30","fx-delay":true,"fx-reverb":true},
    "ICE Drone":{"a-dur":"12","a-drone":true,"a-drone-f":"70","a-drone-w":"sawtooth","a-drone-g":"28","a-drone-voices":"5","a-drone-det":"18","fx-dist":true,"fx-dist-d":"45","fx-reverb":true,"fx-reverb-d":"4"},
    "Data Burst":{"a-dur":"9","a-drone":false,"a-dtmf":true,"a-dtmf-d":"0047347","fx-crush":true,"fx-crush-b":"5","fx-delay":true,"fx-phone":true},
  },
  "Vaporwave":{
    "Mallsoft Pad":{"a-dur":"14","a-drone":true,"a-drone-f":"220","a-drone-w":"triangle","a-drone-g":"26","a-drone-voices":"4","a-drone-det":"10","fx-wow":true,"fx-wow-d":"55","fx-reverb":true,"fx-reverb-d":"5","a-fade":"1.2"},
    "Slow Signal":{"a-dur":"16","a-drone":true,"a-drone-f":"165","a-drone-w":"sine","a-drone-g":"24","a-drone-voices":"3","a-drone-det":"8","fx-trem":true,"fx-trem-f":"1.5","fx-reverb":true,"fx-reverb-d":"6","a-fade":"1.5"},
  },
 },
 image:{
  "Analogue Horror":{
    "Fatal Exception":{"i-tpl":"bsod","i-w":"520","i-h":"360"},
    "STOP 0x7B":{"i-tpl":"bsod_nt","i-w":"560","i-h":"400"},
    "Cam Still":{"i-tpl":"camera","i-w":"400","i-h":"300","i-fg":"#9fead0","i-vig":"60","i-noise":"18"},
    "Redacted Memo":{"i-tpl":"redacted","i-w":"440","i-h":"560","i-copy":"40","i-skew":"52"},
    "Missing Poster":{"i-tpl":"poster","i-w":"360","i-h":"480","i-copy":"30"},
  },
  "EREBUS":{
    "Webb's Desktop":{"i-tpl":"desktop","i-w":"560","i-h":"420"},
    "ARCHIVE Directory":{"i-tpl":"explorer","i-w":"520","i-h":"340","i-title":"Exploring - .archive"},
    "Access Card 0047":{"i-tpl":"keycard","i-w":"420","i-h":"260"},
    "EREBUS.EXE (Task)":{"i-tpl":"taskmgr","i-w":"420","i-h":"300"},
    "Watching (Registry)":{"i-tpl":"registry","i-w":"520","i-h":"320"},
  },
  "Cyberpunk":{
    "Cyber Terminal":{"i-tpl":"cyberterm","i-w":"520","i-h":"340","i-bg":"#00060f","i-fg":"#00f0ff","i-bloom":"30","i-chroma":"16"},
    "Corp Login":{"i-tpl":"corpo","i-w":"480","i-h":"420","i-fg":"#ff2bd6","i-bloom":"24"},
    "Implant ID":{"i-tpl":"implant","i-w":"460","i-h":"280","i-fg":"#00f0ff"},
  },
  "Vaporwave":{
    "Vapor Desktop":{"i-tpl":"vapordesktop","i-w":"560","i-h":"420"},
    "Mall Directory":{"i-tpl":"mall","i-w":"420","i-h":"520"},
    "Cassette":{"i-tpl":"cassette","i-w":"420","i-h":"300"},
  },
 },
};
export function flatPresets(tab){ const o={}; const g=PRESETS[tab]||{}; for(const grp in g) for(const n in g[grp]) o[n]=g[grp][n]; return o; }
export function rebuildPresetSelect(tab){ const sel=$({video:"v-preset",audio:"a-preset",image:"i-preset"}[tab]); if(!sel)return; const cur=sel.value; sel.replaceChildren();
  const custom=document.createElement("option"); custom.value="— custom —"; custom.textContent="— custom —"; sel.appendChild(custom);
  const groups=PRESETS[tab]||{}; for(const grp in groups){ const og=document.createElement("optgroup"); og.label=grp; for(const n in groups[grp]){ const o=document.createElement("option"); o.value=n; o.textContent=n; og.appendChild(o); } sel.appendChild(og); }
  const up=userPresets(tab); const names=Object.keys(up); if(names.length){ const og=document.createElement("optgroup"); og.label="My Presets"; names.forEach(n=>{ const o=document.createElement("option"); o.value="user:"+n; o.textContent=n; og.appendChild(o); }); sel.appendChild(og); }
  // Restoring the selection after rebuilding the options must NOT dispatch:
  // the change handler is loadPreset(), so echoing would re-apply the preset
  // (and stamp an undo entry) every time the list is rebuilt.
  if(cur)sel.value=cur;   /* dom-only: dispatching here would re-run loadPreset */ }
/* A preset is a LOOK, so loading one has to land on the same look every time.
 *
 * The built-in presets name only the dozen controls their look depends on, and
 * applying just those left everything else at whatever the previous preset had
 * set — so "Signal Loss" after "Webb — Last Session" kept Webb's reveal text,
 * timecode and glitch, and looked like neither. Two authors with the same seed
 * and the same preset got different frames depending on what they had clicked
 * before, which is exactly the reproducibility the tool claims.
 *
 * The tab's boot defaults go on first, then the preset over the top, in one
 * transaction — so a built-in behaves like a saved user preset (which is a
 * whole-tab snapshot already) and is a single undo entry either way.
 *
 * Two things are deliberately NOT reset: the preset picker itself (writing it
 * back to "— custom —" would re-enter this function and blank the name the
 * author just chose) and the randomize locks, which are the author's own
 * standing instruction rather than part of any look. */
const presetSelectId = (tab) => ({ video: 'v-preset', audio: 'a-preset', image: 'i-preset' }[tab]);

/**
 * Control ids inside a section whose `lock-*` checkbox is ticked.
 *
 * A lock already meant "Randomize leaves this alone". Extending it to presets
 * is the same promise about the same section, and it is the answer to the thing
 * that actually stops people using presets: wanting a look without losing the
 * wording a puzzle depends on. Lock TEXT, load any preset, keep your script.
 */
export function lockedControlIds(viewId){
  const out=new Set();
  const root=$(viewId);
  if(!root) return out;
  for(const lock of root.querySelectorAll('input[type=checkbox][id^="lock-"]')){
    if(!lock.checked) continue;
    const fs=lock.closest('fieldset');
    if(!fs) continue;
    for(const el of fs.querySelectorAll('input,select,textarea')){
      if(el.id && !el.id.startsWith('lock-')) out.add(el.id);
    }
  }
  return out;
}

/**
 * The recipe a preset actually applies: the tab's boot defaults, then the
 * preset over the top, minus anything the author has locked.
 *
 * `opts.ignoreLocks` skips the last part. The preset gallery wants it: a
 * thumbnail answers "what does this preset look like", and a grid that
 * rearranged itself every time a lock was ticked would be answering a
 * different question badly.
 */
export function presetRecipe(tab, viewId, rec, opts){
  const base=_viewDefaults[viewId];
  const locked=opts&&opts.ignoreLocks ? new Set() : lockedControlIds(viewId);
  // With no snapshot (headless) there is nothing to reset to, so a preset is
  // still applied as it always was — minus anything the author locked.
  const strip=(src)=>{ const o={}; for(const id in src){ if(locked.has(id)) continue; o[id]=src[id]; } return o; };
  if(!base) return strip(rec);
  const keep=presetSelectId(tab);
  const out={};
  for(const id in base){ if(id===keep || id.startsWith("lock-") || locked.has(id)) continue; out[id]=base[id]; }
  return { ...out, ...strip(rec) };
}

export function loadPreset(tab,viewId){ const sel=$(presetSelectId(tab)); const v=sel.value; if(v==="— custom —")return;
  const rec = v.startsWith("user:") ? userPresets(tab)[v.slice(5)] : flatPresets(tab)[v]; if(!rec)return;
  applyRecipe(viewId,presetRecipe(tab,viewId,rec)); log("Loaded preset ["+tab+"] "+v,"info");
  if(tab==="video"){ startVideoPreview(); } else if(tab==="image"){ renderImage(); } else markAudioStale(); }
/* ---- aesthetics: reskin the tool chrome + set default palette/colors ---- */
