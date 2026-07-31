/* Dead Signal Studio — library/bundle.js */
import { download } from '../core/blobs.js';
import { $, esc, escHtml, log, toast } from '../core/dom.js';
import { currentSeed } from '../core/rng.js';
import { activeProfile } from '../campaign/profile.js';
import { existingCampaign } from '../campaign/existing.js';
import { hasExisting, installedFiles, mergeEntries } from './merge.js';
import { library } from './library.js';
import { makeZip, strU8, u8of } from './zip.js';

export function disp(name){ return esc(name).replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase()); }
export function assetsFor(){ return library.filter(it=>it.kind==="videos"||it.kind==="music"); }
/* One entry per line, keys in a stable order, 4-space indent — the style the
   shipped campaign files already use, so a merged file diffs cleanly against
   what was there before. */
function entryJson(e){
  const parts=[];
  if(e.name!=null) parts.push('"name": '+JSON.stringify(e.name));
  if(e.src!=null) parts.push('"src": '+JSON.stringify(e.src));
  if(e.filename!=null) parts.push('"filename": '+JSON.stringify(e.filename));
  if(e.gated) parts.push('"gated": true');
  return "{ "+parts.join(", ")+" }";
}
const listJson=(arr,indent)=>arr.length
  ? "\n"+indent+arr.map(entryJson).join(",\n"+indent)+"\n"
  : "";

/* What the library alone would produce, as objects rather than text — merging
   needs entries, not strings. */
export function generatedEntries(){
  const music=[],videos=[],idxMusic=[],idxVideos=[],beats={};
  assetsFor().forEach(it=>{ const file=it.name+"."+it.ext; const src="assets/"+it.kind+"/"+file;
    const entry={name:disp(it.name), src}; if(it.gated) entry.gated=true;
    const idx={name:disp(it.name), filename:file}; if(it.gated) idx.gated=true;
    if(it.kind==="videos"){ videos.push(entry); idxVideos.push(idx); } else { music.push(entry); idxMusic.push(idx); }
    if(it.gated){ (beats[it.beat]=beats[it.beat]||[]).push(file); } });
  return {music, videos, idxMusic, idxVideos, beats};
}

/**
 * The files to install, merged with whatever the campaign already has.
 *
 * With nothing imported this is exactly the old behaviour — the library's own
 * assets and nothing else. With the campaign's files imported it is the
 * COMPLETE merged result, so installing is an overwrite rather than a
 * hand-merge, which was the last manual step in the pipeline.
 */
export function genWiring(){
  const gen=generatedEntries();
  const existing=existingCampaign();
  const released=new Set(existing?.released||[]);

  const mMusic=mergeEntries(existing?.manifest?.music, gen.music);
  const mVideos=mergeEntries(existing?.manifest?.videos, gen.videos);
  const mIdxV=mergeEntries(existing?.videosIndex, gen.idxVideos);
  const mIdxM=mergeEntries(existing?.musicIndex, gen.idxMusic);

  const manifest='{\n    "music": ['+listJson(mMusic.merged,"        ")
    +'    ],\n    "videos": ['+listJson(mVideos.merged,"        ")+'    ]\n}\n';

  /* Only the lines the campaign does not already have. Pasting a snippet twice
     would otherwise release the same clip twice — harmless but confusing to
     read back, and impossible to spot in a thousand-line script. */
  let release="", pending=0, skipped=0;
  for(const b in gen.beats){
    if(b==="boot"){ release+="# ungated clips mount at boot — no release line needed\n\n"; continue; }
    const files=gen.beats[b].filter(f=>{ if(released.has(f)){ skipped++; return false; } return true; });
    if(!files.length) continue;
    release+="# in "+b+":\n";
    files.forEach(f=>{ release+='call releaseMedia "'+f+'"\n'; pending++; });
    release+="\n";
  }
  if(!release.trim()) release = skipped ? "# every gated clip already has a release line\n" : "# no gated assets\n";

  return {
    manifest,
    idxMusic:"["+listJson(mIdxM.merged,"    ")+"]\n",
    idxVideos:"["+listJson(mIdxV.merged,"    ")+"]\n",
    release,
    merged: hasExisting(existing),
    stats:{
      added: mMusic.added.length+mVideos.added.length,
      replaced: mMusic.replaced.length+mVideos.replaced.length,
      kept: (mMusic.merged.length+mVideos.merged.length)
            -(mMusic.added.length+mVideos.added.length)
            -(mMusic.replaced.length+mVideos.replaced.length),
      pending, skipped,
    },
  };
}
export function validateBundle(){ const issues=[]; const seen={};
  assetsFor().forEach(it=>{ const file=it.name+"."+it.ext; const ext=it.ext.toLowerCase();
    // A WARNING, not a hard error: media import (classify.js) deliberately
    // accepts m4v/m4a/aac/flac/oga/weba as source material, and a single such
    // row used to block the entire .zip export with no way to drop it short of
    // deleting the import. The campaign engine may not decode these, so it is
    // worth saying — but it must not stop an author shipping everything else.
    if(it.kind==="videos" && !["webm","mp4","ogv"].includes(ext)) issues.push({e:0,m:file+": video ext ."+ext+" may not play in the campaign — ship webm/mp4/ogv to be safe"});
    if(it.kind==="music" && !["wav","mp3","ogg"].includes(ext)) issues.push({e:0,m:file+": audio ext ."+ext+" may not play in the campaign — ship wav/mp3/ogg to be safe"});
    if(seen[it.kind+"/"+file]) issues.push({e:1,m:"duplicate filename: "+file}); seen[it.kind+"/"+file]=1;
    // A row restored from a project without its bytes still describes an asset
    // correctly — it just has nothing to put in the .zip, and shipping the
    // wiring for a file that is not there is the quiet kind of broken.
    if(!it.blob) issues.push({e:1,m:file+": restored from a project, bytes not in this browser — re-render it"});
    if(it.gated && it.beat==="boot") issues.push({e:0,m:file+": gated but beat=boot (boot clips are usually ungated)"});
    if(!/^[a-z0-9_.-]+$/i.test(file)) issues.push({e:1,m:file+": unsafe filename characters"}); });
  // Names the target campaign already ships. When its files have been imported
  // this is the REAL installed set rather than the profile's static guess — and
  // a collision then means "this replaces that entry", which is usually intended,
  // so it stays a warning either way.
  const existing=existingCampaign();
  const imported=installedFiles(existing);
  const known=imported.size ? imported : new Set(activeProfile().shipped.map(n=>n.toLowerCase()));
  const source=imported.size ? "the campaign's installed media" : "a shipped asset name";
  assetsFor().forEach(it=>{ if(known.has((it.name+"."+it.ext).toLowerCase())) issues.push({e:0,m:(it.name+"."+it.ext)+": replaces "+source}); });
  // A beat that is not in the target's list produces a release line the
  // campaign never reaches, so the clip stays invisible forever. Silent before.
  const beats=activeProfile().beats; assetsFor().forEach(it=>{ if(it.gated && !beats.includes(it.beat)) issues.push({e:1,m:(it.name+"."+it.ext)+': beat "'+it.beat+'" is not a beat of '+activeProfile().name}); });
  return issues; }
export function showValidation(){ const issues=validateBundle(); const box=$("b-report"); box.replaceChildren();
  if(!assetsFor().length){ box.innerHTML='<div class="banner">No video/audio assets in the library yet.</div>'; return false; }
  if(!issues.length){ box.innerHTML='<div class="banner" style="border-color:var(--phos-dim);color:var(--phos)">✔ Bundle valid — '+assetsFor().length+' asset(s), no issues.</div>'; return true; }
  issues.forEach(is=>{ const d=document.createElement("div"); d.className="banner"+(is.e?" err":""); d.textContent=(is.e?"✗ ":"⚠ ")+is.m; box.appendChild(d); });
  return !issues.some(i=>i.e); }
export function renderCoverage(){ const box=$("b-coverage"); if(!box)return; const beats={}; assetsFor().forEach(it=>{ if(it.gated)(beats[it.beat]=beats[it.beat]||[]).push(escHtml(it.name+"."+it.ext)); });
  box.innerHTML=activeProfile().beats.map(b=>{ const a=beats[b]||[]; return '<div class="row" style="margin:4px 0"><span class="pill">'+escHtml(b)+'</span> <span class="'+(a.length?"":"hint")+'">'+(a.length?a.join(", "):"—")+'</span></div>'; }).join(""); }
export function doGenWiring(){ const w=genWiring(); const out=$("b-out"); out.replaceChildren(); const block=(label,code)=>{ const h=document.createElement("div"); h.className="hint"; h.textContent=label; const pre=document.createElement("pre"); pre.className="snip"; pre.textContent=code; const b=document.createElement("button"); b.className="btn small"; b.textContent="⧉ copy"; b.addEventListener("click", ()=>{ navigator.clipboard&&navigator.clipboard.writeText(code).then(()=>toast("Copied"),()=>toast("Clipboard blocked","err")); }); out.appendChild(h); out.appendChild(pre); out.appendChild(b); };
  block("assets/media-manifest.json", w.manifest); block("assets/videos/index.json", w.idxVideos); block("assets/music/index.json", w.idxMusic); block("autoexec.retro — release wiring", w.release);
  log(w.merged
    ? "Generated MERGED wiring: "+w.stats.added+" added, "+w.stats.replaced+" replaced, "+w.stats.kept+" untouched"
      +(w.stats.skipped?" · "+w.stats.skipped+" release line(s) already present":"")
    : "Generated bundle wiring for "+assetsFor().length+" assets (nothing imported — merge by hand).","ok"); }
/* ---- store-only ZIP writer (CRC32 + local headers + central dir + EOCD) ---- */
export async function exportCampaignBundle(){ if(!assetsFor().length){ toast("No assets to bundle","err"); return; } if(!showValidation()){ toast("Fix bundle errors first","err"); return; }
  const w=genWiring(); const files=[];
  for(const it of assetsFor()){ if(!it.blob) continue; files.push({name:"assets/"+it.kind+"/"+it.name+"."+it.ext, data:await u8of(it.blob)}); }
  files.push({name:"assets/media-manifest.json", data:strU8(w.manifest)});
  files.push({name:"assets/videos/index.json", data:strU8(w.idxVideos)});
  files.push({name:"assets/music/index.json", data:strU8(w.idxMusic)});
  files.push({name:"autoexec.snippet.retro", data:strU8(w.release)});
  const prof=activeProfile();
  const title=prof.name.toUpperCase()+" MEDIA BUNDLE";
  // The instructions have to match what is actually in the zip. When the
  // campaign's files were imported these ARE the complete files, and telling
  // someone to hand-merge a complete file is how you lose entries.
  const steps = w.merged
    ? "1. Copy assets/ into the repo root, overwriting when asked.\n"
      + "   The manifest and index files in this bundle are COMPLETE — they already\n"
      + "   contain your existing entries plus the new ones, so replacing them is\n"
      + "   correct and nothing is lost.\n"
      + "2. Add the release lines from autoexec.snippet.retro at their beats in the\n"
      + "   campaign script that owns them. Lines already present were left out.\n"
    : "1. Copy assets/ into the repo root (merge with existing assets/).\n"
      + "2. MERGE media-manifest.json + index.json entries into your existing ones.\n"
      + "   These files describe only this library. To get complete files instead,\n"
      + "   import your campaign's current ones on the BUNDLE tab and export again.\n"
      + "3. Add the release lines from autoexec.snippet.retro at their beats in the\n"
      + "   campaign script that owns them.\n";
  const summary = w.merged
    ? "Merge:    "+w.stats.added+" added, "+w.stats.replaced+" replaced, "+w.stats.kept+" untouched\n"
    : "";
  files.push({name:"INSTALL.txt", data:strU8(title+"\n"+"=".repeat(title.length)+"\nGenerated by Dead Signal Studio (seed "+currentSeed()+").\n\n"+steps+"\nCampaign: "+prof.name+" ("+prof.id+")\nBeats:    "+prof.beats.join(", ")+"\nAssets:   "+assetsFor().length+"\n"+summary)});
  const zip=await makeZip(files); download(zip,prof.id+"-media-bundle.zip"); toast("Bundle .zip downloaded"); log("Exported "+prof.name+" bundle: "+files.length+" files, "+(zip.size/1024).toFixed(0)+"KB","ok"); }
/* ============================================================================
   PRESETS (built-in) + selects
   ========================================================================== */
/* Presets grouped by aesthetic (shown as <optgroup>s). */
