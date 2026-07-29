/* Dead Signal Studio — core/text.js */
import { esc } from './dom.js';
import { getStore } from '../doc/session.js';
import { currentSeed, hash32, rint, rnd } from './rng.js';

export const MORSE={A:".-",B:"-...",C:"-.-.",D:"-..",E:".",F:"..-.",G:"--.",H:"....",I:"..",J:".---",K:"-.-",L:".-..",M:"--",N:"-.",O:"---",P:".--.",Q:"--.-",R:".-.",S:"...",T:"-",U:"..-",V:"...-",W:".--",X:"-..-",Y:"-.--",Z:"--..","0":"-----","1":".----","2":"..---","3":"...--","4":"....-","5":".....","6":"-....","7":"--...","8":"---..","9":"----."};
export function morseOf(s){ return esc(s).toUpperCase().split("").map(c=> c===" "?"/":(MORSE[c]||"")).join(" "); }
export function morseSpan(word,unit){ const code=morseOf(word); let t=0;
  for(const ch of code){ if(ch===".") t+=unit*2; else if(ch==="-") t+=unit*4; else if(ch===" ") t+=unit*2; else if(ch==="/") t+=unit*6; } return t; }

/* ============================================================================
   TEXT VARIABLES + MACROS
   ==========================================================================
 * `{{case}}` used to expand to "7749" and `{{badge}}` to "0047" — the EREBUS
 * campaign's numbers, hardcoded in the studio itself. That was fine when the
 * tool wired up exactly one campaign; it stopped being fine the moment BUNDLE
 * grew campaign profiles, because every other campaign got EREBUS's case file
 * number with no way to change it.
 *
 * They are now DEFAULTS for variables the author owns. A campaign sets
 * {{subject}} once and every scene, template and preset that mentions it
 * follows — which is what turns a preset from a fixed artifact into a template.
 */
export const VARS_PATH='vars';
/** Overridable defaults. An author's own value for any of these wins. */
export const BUILTIN_VARS={ time:"03:47", case:"7749", badge:"0047" };
/** Names that resolve from somewhere other than the variable map. */
export const RESERVED_VARS=["date","seed","random","pick"];
export const MAX_VARS=32;
const VAR_NAME=/^[A-Za-z][A-Za-z0-9_]{0,31}$/;
export const isVarName=(k)=>VAR_NAME.test(String(k||""));

/** Author-supplied variables, cleaned. */
export function normalizeVars(raw){
  const out={};
  if(!raw||typeof raw!=="object"||Array.isArray(raw)) return out;
  let n=0;
  for(const k of Object.keys(raw)){
    if(n>=MAX_VARS) break;
    if(!VAR_NAME.test(k)) continue;
    const v=raw[k];
    if(typeof v!=="string" && typeof v!=="number") continue;
    /* Braces are stripped from VALUES on purpose. A value containing {{x}}
       would let one variable reference another, and a pair that reference each
       other would expand forever — the expansion is deliberately one pass. */
    out[k]=String(v).replace(/[{}]/g,"").slice(0,200);
    n++;
  }
  return out;
}

/** Every variable in scope: the built-in defaults, with the author's on top. */
export function currentVars(){
  const st=getStore();
  return { ...BUILTIN_VARS, ...(st?normalizeVars(st.get(VARS_PATH)):{}) };
}

/* Seeded, and NOT drawn from the frame RNG.
 *
 * {{random:###}} used to call rint(), which reads the per-frame stream — so a
 * "case number" re-rolled sixty times a second and read as a glitch rather
 * than a number. It is addressed by (seed, occurrence) instead: stable for a
 * given seed, different for each occurrence in the same text, and it does not
 * disturb the render's own randomness. */
function macroDigits(n,salt){
  let h=hash32(currentSeed(),0,"macro:"+salt+":"+n);
  let out="";
  for(let i=0;i<n;i++){ h=Math.imul(h^(h>>>13),0x5BD1E995)>>>0; out+=(h%10); }
  return out;
}
function macroPick(list,salt){
  if(!list.length) return "";
  return list[hash32(currentSeed(),0,"pick:"+salt)%list.length];
}

/**
 * Expand {{...}} in a string. One pass, so a value can never re-expand.
 * An unknown name is left exactly as written — that is how an author sees a
 * typo rather than losing the text to a silent empty string.
 */
export function macros(s,vars){
  const v=vars||currentVars();
  let seen=0;
  return esc(s).replace(/\{\{([A-Za-z][A-Za-z0-9_]*)(?::([^}]*))?\}\}/g,(m,name,arg)=>{
    const salt=seen++;
    switch(name){
      case "date":   return v.date!=null ? String(v.date) : new Date().toISOString().slice(0,10);
      case "seed":   return String(currentSeed());
      case "random": return macroDigits(Math.max(1,Math.min(12,(arg||"###").length)),salt);
      case "pick":   return macroPick(String(arg||"").split("|").filter((x)=>x!==""),salt);
      default:       return name in v ? String(v[name]) : m;
    }
  });
}

/* ---------- fonts -------------------------------------------------------- */
/* One hardcoded monospace stack drew every glyph in the tool, which is a hard
   ceiling on a studio whose output is mostly text on screens: a ransom note, a
   MISSING poster and a terminal are three different typefaces before they are
   anything else.
 *
 * Offline-only, so these are system faces and generic families rather than
   anything fetched. The stack is module state set once per frame by the render
   entry points, which keeps setFont()'s signature — and its ~40 call sites —
   exactly as they were. */
export const FONTS={
  mono:   { label:"Monospace",  stack:'"DejaVu Sans Mono","Consolas",monospace' },
  system: { label:"System UI",  stack:'system-ui,"Segoe UI",Roboto,sans-serif' },
  sans:   { label:"Sans",       stack:'"Helvetica Neue",Arial,sans-serif' },
  serif:  { label:"Serif",      stack:'Georgia,"Times New Roman",serif' },
  heavy:  { label:"Heavy",      stack:'Impact,"Arial Black",Haettenschweiler,sans-serif' },
  hand:   { label:"Handwritten",stack:'"Comic Sans MS","Segoe Print","Bradley Hand",cursive' },
};
export const DEFAULT_FONT="mono";
let _stack=FONTS[DEFAULT_FONT].stack;
/** Set the family every subsequent setFont() uses. Called once per frame. */
export function setFontStack(name){ _stack=(FONTS[name]||FONTS[DEFAULT_FONT]).stack; return _stack; }
export function fontStack(){ return _stack; }

/* Letter-spacing, in EM, set once per frame exactly like the family above and
   for the same reason: every text call site in every scene, template, overlay
   and filter already goes through setFont(), so putting it there is one edit
   instead of forty — and it cannot be forgotten by the forty-first.
 *
 * It is applied in em rather than px so it scales with the type: a 20% track
 * looks the same on a 12px caption and a 48px title, which is what a
 * typographic control is supposed to mean.
 *
 * ZERO IS A TOTAL NO-OP. Not "sets letterSpacing to 0px" — the property is not
 * touched at all when the track is zero, so every project written before this
 * existed renders byte-identically. */
let _track=0;
export function setTracking(em){ _track=Number.isFinite(+em)?+em:0; return _track; }
export function tracking(){ return _track; }
/** Whether this browser can do it. Chromium/Safari/Firefox can; older cannot. */
export const trackingSupported=()=> typeof CanvasRenderingContext2D!=="undefined"
  && "letterSpacing" in CanvasRenderingContext2D.prototype;
export function fillFontSelect(sel){ if(!sel)return; sel.replaceChildren();
  for(const [id,f] of Object.entries(FONTS)){ const o=document.createElement("option"); o.value=id; o.textContent=f.label; sel.appendChild(o); } }

export function hexToRgb(h){ h=h.replace("#",""); if(h.length===3)h=h.split("").map(c=>c+c).join(""); const n=parseInt(h,16); return [(n>>16)&255,(n>>8)&255,n&255]; }
export function setFont(ctx,px){ ctx.font=px+'px '+_stack;
  /* Only touched when there is a track to apply, and always cleared when there
     is one in effect — otherwise a context that had been given spacing would
     keep it after the control went back to zero, since ctx.font does not reset
     letterSpacing. measureText() accounts for it natively, so centring and
     right-alignment stay correct with no arithmetic here. */
  if(_track!==0){ try{ ctx.letterSpacing=(_track*px).toFixed(3)+'px'; }catch(e){} }
  else if(ctx.letterSpacing&&ctx.letterSpacing!=="0px"){ try{ ctx.letterSpacing="0px"; }catch(e){} } }
export function glowText(ctx,txt,x,y,color,blur){ ctx.save(); ctx.fillStyle=color; if(blur){ctx.shadowColor=color; ctx.shadowBlur=blur;} ctx.fillText(txt,x,y); ctx.restore(); }
export function corrupt(str,amt){ if(amt<=0)return str; const blk="█▓▒░"; let o=""; for(const ch of str){ o+= (ch!==" "&&rnd()<amt)? blk[rint(0,blk.length-1)] : ch; } return o; }

/**
 * Break `text` to fit `maxWidth`, measured in the context's CURRENT font.
 *
 * Nothing wrapped before, so a line longer than the canvas simply ran off the
 * edge and the rest of the sentence was gone. Explicit newlines are preserved —
 * an author who laid out four short lines gets four short lines back.
 */
export function wrapLines(ctx,text,maxWidth){
  const out=[];
  if(!(maxWidth>0)) return String(text==null?"":text).split("\n");
  for(const para of String(text==null?"":text).split("\n")){
    if(para===""){ out.push(""); continue; }
    let line="";
    for(const piece of para.split(/(\s+)/)){
      if(piece==="") continue;
      const next=line+piece;
      if(line && ctx.measureText(next).width>maxWidth){
        out.push(line.replace(/\s+$/,""));
        line=piece.replace(/^\s+/,"");
      } else line=next;
      // A single token wider than the line has no space to break at, so break
      // it by character rather than letting it overflow anyway.
      while(ctx.measureText(line).width>maxWidth && line.length>1){
        let cut=line.length-1;
        while(cut>1 && ctx.measureText(line.slice(0,cut)).width>maxWidth) cut--;
        out.push(line.slice(0,cut));
        line=line.slice(cut);
      }
    }
    out.push(line);
  }
  return out;
}
/* ============================================================================
   VIDEO — scene registry + overlays + recorder
   ========================================================================== */
export function fullwidth(s){ return esc(s).replace(/[!-~]/g,c=>String.fromCharCode(c.charCodeAt(0)+0xFEE0)).replace(/ /g,"　"); }
