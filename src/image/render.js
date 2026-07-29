/* Dead Signal Studio — image/render.js */
import { download } from '../core/blobs.js';
import { $, chk, clamp, log, num, pct, setVal, toast, val } from '../core/dom.js';
import { MAX_DIM } from '../core/formats.js';
import { applyPalette } from '../core/palettes.js';
import { initSizing, scaleNumControl } from '../ui/sizing.js';
import { saveUserPreset } from '../core/recipes.js';
import { beginFrame } from '../core/rng.js';
import { DEFAULT_FONT, macros, setFont, setFontStack, setTracking } from '../core/text.js';
import { applyStillFx } from '../fx/still.js';
import { drawAnnotations, drawSelection } from './annotate.js';
import { annotations, initAnnotations, setAnnotationBoxes, selectedAnnotation } from '../ui/annotations.js';
import { decodeStego, embedStego } from './stego.js';
import { TEMPLATES, hasFixedPalette } from './templates.js';
import { addToLibrary, slug } from '../library/library.js';
import { loadImageFile } from '../media/import.js';
import { loadPreset } from '../presets/index.js';

/* Author text is expanded here for the same reason as on the video tab: the
   templates each decide for themselves whether to call macros(), so {{case}}
   worked on some screens and printed as braces on others.
 *
 * `rec` reads a captured recipe instead of the live controls, exactly as
 * readVideoCfg(rec) does. That is what lets a screen be held as a still inside
 * a sequence without the timeline having to touch — or disturb — the SCREEN
 * tab it came from. */
export function readImageCfg(rec){
  const V = rec ? (id)=>(rec[id]!=null?String(rec[id]):"") : val;
  const N = rec ? (id,d)=>{ const x=parseFloat(rec[id]); return isNaN(x)?(d||0):x; } : num;
  const C = rec ? (id)=>!!rec[id] : chk;
  const P = (id)=>clamp(N(id,0)/100,0,1);
  return { tpl:V("i-tpl"), W:clamp(N("i-w",480),120,MAX_DIM), H:clamp(N("i-h",360),90,MAX_DIM), scale:+V("i-scale")||1,
  bg:V("i-bg"), fg:V("i-fg"), trans:C("i-trans"), title:macros(V("i-title")), body:macros(V("i-body")), font:clamp(N("i-font",15),6,48), extra:macros(V("i-extra")),
  fontFamily:V("i-fontfam")||DEFAULT_FONT, wrap:C("i-wrap"), lspace:clamp(N("i-lspace",0),-10,40)/100,
  scan:P("i-scan"), noise:P("i-noise"), vig:P("i-vig"), chroma:P("i-chroma"), bloom:P("i-bloom"), dead:P("i-dead"), copy:P("i-copy"), skew:P("i-skew"),
  duotone:C("i-duotone"), posterize:P("i-posterize"), halftone:P("i-halftone"), pixsort:P("i-pixsort"),
  stego:V("i-stego"), invert:V("i-invert"),
  /* Marks placed over the template. Held on the cfg the same way the video
     tab's chain is (`cfg.__filters`) and for the same reason: a still captured
     into a sequence must draw the annotations it was captured WITH, not
     whatever the SCREEN tab happens to show now. */
  __annotations: rec ? (Array.isArray(rec.__annotations)?rec.__annotations:[]) : annotations() }; }

/** Draw a screen recipe into any context at any size. The reusable half. */
export function drawImageTo(ctx,W,H,c,sel=null){
  beginFrame(0); setFontStack(c.fontFamily); setTracking(c.lspace);
  ctx.clearRect(0,0,W,H); ctx.save(); if(c.skew>0){ ctx.translate(W/2,H/2); ctx.rotate((c.skew-0.5)*0.06); ctx.translate(-W/2,-H/2); }
  (TEMPLATES[c.tpl]||TEMPLATES.terminal).draw(ctx,W,H,c); ctx.restore();
  if(c.invert){ ctx.save(); ctx.globalAlpha=0.04; ctx.fillStyle="#fff"; setFont(ctx,Math.max(20,c.font*1.5)); ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText(c.invert,W/2,H*0.5); ctx.restore(); }
  /* Before the FX, so a mark is ON the screen rather than on the glass in front
     of it: it takes the scanlines, the noise and the vignette with everything
     else. The selection outline goes AFTER, because it is the editor rather
     than the picture — and `sel` is only ever passed by the live preview, so an
     export cannot contain it. */
  drawImageTo.lastBoxes = drawAnnotations(ctx,W,H,c.__annotations,c);
  applyStillFx(ctx,W,H,c);
  if(sel!=null) drawSelection(ctx, drawImageTo.lastBoxes[sel]);
  return ctx;
}

/* `opts.chrome:false` renders the screen WITHOUT the editor's selection
   outline. Export and the stego decoder both pass it — the first because a PNG
   must not contain a dashed rectangle round whatever happened to be selected,
   the second because it reads the pixels back. */
/**
 * Say when Ink and Ground do nothing, rather than letting them do nothing.
 *
 * Two thirds of the screen templates draw in their own fixed colours — a Blue
 * Screen is blue, an Explorer window is Windows grey, a missing poster is black
 * on white paper — and that is the thing being recreated rather than a template
 * that forgot to read the controls. But the tab showed Ink and Ground for all of
 * them, so on those two thirds an author changed a colour, saw nothing happen,
 * and had no way to tell whether the control was broken or the template was.
 *
 * Disabled and explained is the honest state. Not HIDDEN: a control that
 * disappears when you change a picker is harder to trust than one that stays
 * put and says why it is greyed out — and the moment you pick a themeable
 * template it comes back live in the same place.
 */
function paintPaletteState(tpl){
  const fixed=hasFixedPalette(tpl);
  const why=fixed
    ? 'This screen draws in its own fixed colours — that palette is the thing it recreates.'
    : '';
  for(const id of ['i-fg','i-bg','i-palette']){
    const el=$(id); if(!el) continue;
    el.disabled=fixed;
    const row=el.closest('.row'); if(row) row.classList.toggle('is-fixed',fixed);
    el.title=why||el.dataset.title||'';
    if(!el.dataset.title && !fixed) el.removeAttribute('title');
  }
  const note=$('i-palette-note');
  if(note) note.textContent=why;
}

export function renderImage(opts){ const c=readImageCfg(); const cv=$("icanvas"); if(!cv)return; cv.width=c.W; cv.height=c.H; const ctx=cv.getContext("2d");
  drawImageTo(ctx,c.W,c.H,c,opts&&opts.chrome===false?null:selectedAnnotation());
  // Where they landed, for hit-testing. Only the draw knows how wide a string
  // is, so the panel is told rather than measuring it a second time.
  setAnnotationBoxes(drawImageTo.lastBoxes);
  if(c.stego) embedStego(ctx,c.W,c.H,c.stego,c.bg);
  if($("i-est")) $("i-est").textContent=c.W+"×"+c.H+(c.scale>1?" ·"+c.scale+"×":"");
  paintPaletteState(c.tpl);
  $("i-status").textContent="Rendered "+c.tpl+" "+c.W+"×"+c.H+"."; return ctx; }
export function exportImage(mimeType,ext,quality){ renderImage({chrome:false}); const c=readImageCfg(); const src=$("icanvas"); let out=src;
  // JPEG's lossy quantization destroys every blue-channel LSB — the shipped
  // file carries no payload, and the in-tool decoder reads the live canvas so
  // it would still "succeed". Say so instead of shipping a dead puzzle.
  if(c.stego&&mimeType==="image/jpeg"){ log("Stego payload does not survive JPEG compression — export PNG to keep it.","warn"); toast("Stego doesn't survive JPG — export PNG","err"); }
  if(c.scale>1){ out=document.createElement("canvas"); out.width=c.W*c.scale; out.height=c.H*c.scale; const octx=out.getContext("2d"); octx.imageSmoothingEnabled=false; octx.drawImage(src,0,0,out.width,out.height); if(c.stego) embedStego(octx,out.width,out.height,c.stego,c.bg); }
  out.toBlob(b=>{ if(!b){ log("Export failed.","err"); return; } const nm=slug(c.title||c.tpl); addToLibrary(b,ext,"image",nm); download(b,nm+"."+ext); toast("Saved "+nm+"."+ext); }, mimeType, quality);
  // toBlob copies the bitmap as it is called, so putting the selection outline
  // back straight away cannot leak into the file — and leaving the preview
  // deselected after an export would look like the export cleared it.
  renderImage(); }
/* stego LSB: header = 32-bit length then bytes, in blue channel LSB */
export function initImageTab(){
  // image
  initAnnotations(renderImage);
  // Same as the VIDEO tab: the type size is in pixels, so it travels with the
  // format. The screen effects are all percentages and need no help.
  initSizing({ format:"i-format", aspect:"i-aspect", w:"i-w", h:"i-h", after:renderImage,
    onResize:(f)=>scaleNumControl("i-font", f) });
  $("i-preset").addEventListener("change", ()=>loadPreset("image","view-image"));
  $("i-palette").addEventListener("change", ()=>{ applyPalette($("i-palette"),"i-bg","i-fg"); renderImage(); });
  $("i-render").addEventListener("click", renderImage); $("i-dl").addEventListener("click", ()=>exportImage("image/png","png")); $("i-jpg").addEventListener("click", ()=>exportImage("image/jpeg","jpg",0.5));
  $("i-decode").addEventListener("click", decodeStego); $("i-savepreset").addEventListener("click", ()=>saveUserPreset("image","view-image"));
  if($("i-loadimg")){ $("i-loadimg").addEventListener("click", ()=>$("i-imgfile").click()); $("i-imgfile").addEventListener("change", e=>loadImageFile(e.target.files[0],()=>{ setVal("i-tpl","import"); renderImage(); })); }
}
