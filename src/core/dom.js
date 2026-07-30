/* Dead Signal Studio — core/dom.js */
import { docValue } from '../doc/session.js';

export const $ = (id) => document.getElementById(id);
export const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));

/* val/num/chk are the accessor primitives every config reader is built on, so
   pointing them at the document is what makes readVideoCfg / readAudioCfg /
   readImageCfg document-driven without rewriting any of them. When no session
   is bound — the headless suites, or before boot finishes — they fall back to
   reading the DOM, which is also the old behaviour. */
export const val = (id)=>{ const d=docValue(id); if(d!==undefined) return d==null?"":String(d);
  const e=$(id); return e?e.value:""; };
export const num = (id,d)=>{ const v=parseFloat(val(id)); return isNaN(v)?(d||0):v; };
export const chk = (id)=>{ const d=docValue(id); if(d!==undefined) return !!d;
  const e=$(id); return e?e.checked:false; };
export const pct = (id)=>clamp(num(id,0)/100,0,1);
/* The write half of val/num/chk, and the ONLY way code should set a control.
 *
 * Since the document became authoritative, val()/num()/chk() read the document
 * and never look at the DOM. So `$("v-scene").value = "kenburns"` changed the
 * widget on screen and nothing else — importing an image flipped the Scene
 * select to Ken Burns while the renderer carried on drawing the old scene, and
 * the picture "never showed up". The same silent failure hit the seed roller,
 * the aspect-ratio helper, the aesthetic palettes, presets, per-section reset
 * and the validation banner's FIX buttons.
 *
 * Dispatching the events the binding already listens for is deliberate: it
 * takes the identical path a human edit takes, so the change reaches the
 * document, raises an undo entry, triggers autosave and re-renders — rather
 * than needing its own parallel wiring that could drift out of step again.
 *
 * The doc→DOM direction (renderDocToDom) must keep assigning directly; echoing
 * events back would loop.
 */
export function setVal(id,value){ const e=$(id); if(!e)return false;
  if(e.type==="checkbox") e.checked=!!value; else e.value=String(value);
  e.dispatchEvent(new Event("input",{bubbles:true}));
  e.dispatchEvent(new Event("change",{bubbles:true}));
  return true; }
/** setVal for a whole recipe. Returns how many controls existed and were set. */
export function setVals(map){ let n=0; for(const id in map) if(setVal(id,map[id])) n++; return n; }
/* ---------------------------------------------- switching a control off ----
 *
 * `disabled` takes an element OUT OF THE TAB ORDER. That is the correct answer
 * for a control nobody needs to know about, and the wrong one for a control
 * whose whole problem is that the author does not know what would switch it on.
 *
 * Measured on a stock build: on the AUDIO panel, Tab from ◆ RENDER walks
 * a-savepreset → the section strip → a-tidy → a-reset → the macros → a-preset →
 * a-gallery-btn → a-preset-manage → a-dur. It never lands on ▶ PLAY, ⤓ .wav or
 * NORMALIZE at all — so a keyboard or screen-reader author does not learn those
 * buttons exist, let alone that ◆ RENDER is what turns them on. The tooltips
 * added for exactly that question are unreachable by exactly the people who
 * most need them.
 *
 * `aria-disabled` is the reachable spelling: announced as unavailable, still
 * focusable, still able to explain itself. It carries no behaviour of its own,
 * which is the catch — the control still fires click — so it is paired with the
 * one guard in guardDisabled() below rather than a refusal written into every
 * handler.
 */
export function setEnabled(el,on){
  if(typeof el==="string") el=$(el);
  if(!el) return false;
  if(on){ el.removeAttribute("aria-disabled"); el.disabled=false; }
  else { el.disabled=false; el.setAttribute("aria-disabled","true"); }
  return true;
}
/** Is this control switched off, in either spelling? */
export const isEnabled = (el)=>{ if(typeof el==="string") el=$(el);
  return !!el && !el.disabled && el.getAttribute("aria-disabled")!=="true"; };
/**
 * Make an aria-disabled control actually refuse.
 *
 * One capture-phase listener on the document, so no panel has to add a guard of
 * its own and none can forget to. stopImmediatePropagation is what makes it a
 * real refusal rather than a decoration: the control's own click handler is
 * registered on the control and would otherwise still run.
 *
 * Pressing it is a question — "why can I not use this?" — so it answers, using
 * the title whyoff.js keeps current. Announced through toast rather than only
 * the console because someone driving by keyboard is not reading the console.
 */
export function guardDisabled(){
  const onClick=(e)=>{
    const el=e.target?.closest?.('[aria-disabled="true"]');
    if(!el) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const why=el.getAttribute("title")||el.getAttribute("aria-description")||"";
    const name=(el.textContent||el.id||"That").trim().slice(0,24);
    if(why){ log(name+": "+why,"info"); toast(why.length>60?name+" is not available yet":why,"warn"); }
    else toast(name+" is not available yet","warn");
  };
  document.addEventListener("click",onClick,true);
  return ()=>document.removeEventListener("click",onClick,true);
}
export const esc = (s)=>String(s==null?"":s);
export const escHtml = (s)=>esc(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
/* ---------- seeded PRNG (mulberry32) — addressed by (seed, frame, stream) ----
   Randomness is drawn from named streams keyed on the frame index, not from one
   shared stream reseeded to the same value every frame. Two consequences:

     1. Animated texture actually animates. Reseeding to `seed` at the top of
        every frame made every rnd()-only effect byte-identical frame to frame
        — TV static that never moved, film grain frozen in place, and a
        "flicker" whose rnd() < threshold test returned the same boolean
        forever, so it never flickered.
     2. Streams are independent. Adding, removing, or reordering an effect no
        longer shifts the values every later effect happens to draw.

   Scene layout that must NOT jitter between frames — digital-rain column
   speeds, radar blip positions, city building windows — uses seedStatic(),
   which is deliberately frame-invariant. Those call sites were reseeding for a
   real reason; seedStatic() says so out loud instead of relying on a global
   reset that also froze everything downstream of it.                        */
export function log(msg,cls){ const c=$("console"); if(!c)return; const t=new Date().toISOString().slice(11,19);
  const line=document.createElement("div"); if(cls)line.className=cls; line.textContent=`[${t}] ${msg}`;
  c.appendChild(line); c.scrollTop=c.scrollHeight; }
/* At most this many on screen at once. Adding three clips and a layer used to
   put five stacked toasts over the settings column, and because the container
   was click-through-able they also swallowed clicks on whatever was under
   them — a control that does nothing when pressed reads as a broken tool. */
const MAX_TOASTS = 3;
export function toast(msg,cls){ const box=$("toasts"); if(!box)return;
  // A repeat of the same message becomes a count, not another row.
  const last=box.lastElementChild;
  if(last && last.dataset.msg===msg && last.className==="toast"+(cls?" "+cls:"")){
    const n=(+last.dataset.n||1)+1; last.dataset.n=n; last.textContent=msg+" ×"+n;
    clearTimeout(+last.dataset.timer);
    last.dataset.timer=setTimeout(()=>fadeToast(last),2600);
    return;
  }
  const el=document.createElement("div");
  el.className="toast"+(cls?" "+cls:""); el.textContent=msg; el.dataset.msg=msg;
  box.appendChild(el);
  while(box.children.length>MAX_TOASTS) box.firstElementChild.remove();
  el.dataset.timer=setTimeout(()=>fadeToast(el),2600); }
function fadeToast(el){ el.style.opacity="0"; el.style.transition="opacity .4s";
  setTimeout(()=>el.remove(),400); }
/* ---------- object-URL registry ---------- */
