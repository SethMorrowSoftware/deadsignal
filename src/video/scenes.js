/* Dead Signal Studio — video/scenes.js */
import { lastAudio } from '../audio/ui.js';
import { $, clamp } from '../core/dom.js';
import { rint, rnd, rrange, seedStatic } from '../core/rng.js';
import { corrupt, fullwidth, glowText, macros, setFont, wrapLines } from '../core/text.js';
import { drawImportFit, drawVideoFit, hasImportedVideo } from '../media/import.js';
import { splitByPack } from '../core/packs.js';

export const SCENES={};
export function scene(id,name,draw){ SCENES[id]={id,name,draw}; }
/* fullwidth transform for the ｖａｐｏｒｗａｖｅ aesthetic */
export function drawTextScene(ctx,W,H,cfg,t){
  let full=macros(cfg.text||""); if(cfg.fullwidth) full=fullwidth(full);
  // Wrapping is opt-in so every project written before it existed renders
  // byte-identically. Off, a long line still runs off the canvas — which is
  // what it always did, and why the toggle is there.
  setFont(ctx,cfg.font);
  if(cfg.wrap) full=wrapLines(ctx,full,W-24).join("\n");
  let shown=full;
  if(cfg.textMode==="typed"){ shown=full.slice(0, Math.min(full.length, Math.floor(t*(cfg.cps||14)))); }
  const lines=shown.split("\n"); ctx.textBaseline="top";
  const lh=cfg.font*1.32; let y = cfg.align==="center" ? Math.max(24,(H-lines.length*lh)/2) : 26;
  if(cfg.textMode==="scroll"){ const allLines=full.split("\n"); const total=allLines.length*lh;
    y = H - (t*(cfg.cps||14)) ; // scroll upward
    for(let i=0;i<allLines.length;i++){ const yy=y+i*lh; if(yy<-lh||yy>H)continue; let ln=allLines[i]||""; drawGlyphLine(ctx,ln,cfg,W,yy,t); }
    return; }
  const glitchOn=cfg.glitch>0 && (Math.floor(t*14)%9===0);
  for(let i=0;i<lines.length;i++){ let ln=lines[i]||"";
    if(cfg.textMode==="decode"){ ln=decodeLine(full.split("\n")[i]||"", t, cfg.cps||14); }
    if(cfg.corrupt>0 && glitchOn) ln=corrupt(ln,cfg.corrupt);
    drawGlyphLine(ctx,ln,cfg,W,y,t,glitchOn); y+=lh; }
  if(cfg.cursor && (Math.floor(t*2)%2===0)){ const last=lines[lines.length-1]||"";
    // Derived from the same lineX the text used, so the caret follows the type
    // instead of being placed by a second, separate rule.
    const cx=lineX(ctx,last,cfg,W)+ctx.measureText(last).width+3;
    ctx.fillStyle=cfg.fg; ctx.fillRect(clamp(cx,6,W-12), y-lh, cfg.font*0.55, cfg.font); }
}
export function decodeLine(finalLine,t,cps){ const chars="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/#@%"; const locked=Math.floor(t*cps);
  let o=""; for(let i=0;i<finalLine.length;i++){ if(i<locked||finalLine[i]===" ") o+=finalLine[i]; else o+=chars[rint(0,chars.length-1)]; } return o; }
/* One place decides where a line starts, so the body text, the caret and the
   glitch ghosts cannot disagree about it — which is exactly how "right" would
   otherwise ship with the cursor still parked on the left. Measured, not
   assumed: measureText() already accounts for the letter-spacing set for this
   frame. */
export function lineX(ctx,ln,cfg,W){
  const w=ctx.measureText(ln).width;
  if(cfg.align==="center") return Math.max(6,(W-w)/2);
  if(cfg.align==="right") return Math.max(6,W-12-w);
  return 12;
}
export function drawGlyphLine(ctx,ln,cfg,W,y,t,glitchOn){ setFont(ctx,cfg.font); let x=lineX(ctx,ln,cfg,W);
  if(glitchOn){ const j=cfg.glitch*3; ctx.save(); ctx.globalAlpha=.6; ctx.fillStyle="#ff3b6b"; ctx.fillText(ln,x-j,y); ctx.fillStyle="#3bd7ff"; ctx.fillText(ln,x+j,y); ctx.restore(); }
  glowText(ctx,ln,x,y,cfg.fg,6); }
scene("terminal","Terminal / Text", drawTextScene);
// Lazy scratch: putImageData ignores the current transform (the 2× supersample
// scale, camera shake), so the noise is bounced through a bitmap and drawn with
// drawImage — same fix as plasma in scenes-extra.js. Written straight to the
// target it landed in the top-left device quarter of every supersampled frame.
let _snowC=null;
scene("snow","Signal Loss / Snow",(ctx,W,H,cfg,t)=>{ const img=ctx.createImageData(W,H); const d=img.data;
  for(let i=0;i<d.length;i+=4){ const v=(rnd()*255)|0; d[i]=d[i+1]=d[i+2]=v; d[i+3]=255; }
  const tmp=_snowC||(_snowC=document.createElement("canvas"));
  if(tmp.width!==W)tmp.width=W; if(tmp.height!==H)tmp.height=H;
  tmp.getContext("2d").putImageData(img,0,0); ctx.drawImage(tmp,0,0,W,H);
  setFont(ctx,Math.max(14,cfg.font)); ctx.textAlign="center"; ctx.textBaseline="middle";
  const plate=cfg.text.split("\n")[0]||"NO SIGNAL"; ctx.fillStyle="#000"; ctx.fillRect(W/2-ctx.measureText(plate).width/2-10,H/2-cfg.font,ctx.measureText(plate).width+20,cfg.font*2);
  glowText(ctx,plate,W/2,H/2,cfg.fg,8); ctx.textAlign="left"; });
/* A colour-bar card is a still picture by nature, and this one was literally
   still: `t` was declared and never read, so the only thing moving in an
   exported clip was the CRT static on top of it. (Which is also why the deep
   audit's "every scene changes over time" check passed on it — it renders the
   whole stack, so the noise animated even when the scene did not.)
   What actually moves on a real card is the *monitor*: the sync bar creeping
   down a mistuned tube, and the blinking tone ident. Both are period-correct
   and both leave the bars themselves exactly where they were. */
scene("bars","SMPTE Color Bars",(ctx,W,H,cfg,t)=>{ const cols=["#c0c0c0","#c0c000","#00c0c0","#00c000","#c000c0","#c00000","#0000c0"]; const bw=W/7;
  const top=H*0.72;
  for(let i=0;i<7;i++){ ctx.fillStyle=cols[i]; ctx.fillRect(i*bw,0,bw+1,top); }
  // The real card's lower thirds: the castellations in reverse, then PLUGE.
  const rev=["#0000c0","#101820","#c000c0","#101820","#00c0c0","#101820","#c0c0c0"];
  const midH=H*0.10;
  for(let i=0;i<7;i++){ ctx.fillStyle=rev[i]; ctx.fillRect(i*bw,top,bw+1,midH); }
  ctx.fillStyle="#101820"; ctx.fillRect(0,top+midH,W,H-top-midH);
  // PLUGE: sub-black / black / super-black, the strip you set brightness with.
  const pw=W*0.05, py=top+midH;
  ["#050505","#101010","#1c1c1c"].forEach((c,i)=>{ ctx.fillStyle=c; ctx.fillRect(W-pw*(3-i),py,pw,H-py); });
  // A sync bar creeping down the tube — one pass every eight seconds.
  const sy=((t/8)%1)*H, sh=Math.max(2,H*0.02);
  const g=ctx.createLinearGradient(0,sy-sh,0,sy+sh);
  g.addColorStop(0,"rgba(255,255,255,0)"); g.addColorStop(0.5,"rgba(255,255,255,.16)"); g.addColorStop(1,"rgba(255,255,255,0)");
  ctx.fillStyle=g; ctx.fillRect(0,sy-sh,W,sh*2);
  setFont(ctx,cfg.font); ctx.textBaseline="middle"; glowText(ctx,macros(cfg.text.split("\n")[0]||"PLEASE STAND BY"),12,H*0.86,cfg.fg,4);
  // 1 kHz tone ident, blinking at 1 Hz the way a bars-and-tone feed does.
  if(Math.floor(t)%2===0){ ctx.save(); ctx.fillStyle="#ff5a5a"; ctx.beginPath();
    ctx.arc(W-pw*3-14,H*0.86,Math.max(2,cfg.font*0.22),0,7); ctx.fill(); ctx.restore(); } });
scene("boot","BIOS / Boot POST",(ctx,W,H,cfg,t)=>{ ctx.fillStyle=cfg.bg; ctx.fillRect(0,0,W,H); setFont(ctx,cfg.font); ctx.textBaseline="top";
  const lines=["EREBUS BIOS v0.47  (C) ARCHIVE SYSTEMS","","Main Processor : Pentium(R) 47MHz"]; const mem=Math.min(1,t/2.2);
  lines.push("Memory Test : "+(Math.floor(mem*16384))+"K OK"); if(t>2.4)lines.push("Detecting IDE drives ...");
  if(t>3.2)lines.push("  Primary Master  : WEBB_ARCHIVE 4747MB"); if(t>3.8)lines.push("  Primary Slave   : [ NONE ]");
  if(t>4.6)lines.push(""); if(t>4.8)lines.push("Starting EREBUS ..."); if(t>5.4)lines.push("_"+((Math.floor(t*2)%2)?"█":" "));
  let y=14; for(const l of lines){ glowText(ctx,l,12,y,cfg.fg,3); y+=cfg.font*1.4; } });
scene("loading","Loading / Progress",(ctx,W,H,cfg,t)=>{ ctx.fillStyle=cfg.bg; ctx.fillRect(0,0,W,H); setFont(ctx,cfg.font); ctx.textAlign="center";
  let p=clamp(t/(cfg.duration*0.9),0,1); if(p>0.9&&p<1&&Math.floor(t*8)%2)p=0.9; // stall glitch
  const label=macros(cfg.text.split("\n")[0]||"RECONSTRUCTING ARCHIVE"); glowText(ctx,label,W/2,H*0.36,cfg.fg,4);
  const bw=W*0.7,bx=W*0.15,by=H*0.5,bh=cfg.font; ctx.strokeStyle=cfg.fg; ctx.strokeRect(bx,by,bw,bh);
  ctx.fillStyle=cfg.fg; for(let x=0;x<bw*p-3;x+=cfg.font*0.5) ctx.fillRect(bx+2+x,by+2,cfg.font*0.4,bh-4);
  glowText(ctx,Math.floor(p*100)+"%",W/2,by+bh*2.2,cfg.fg,3); ctx.textAlign="left"; });
scene("matrix","Digital Rain",(ctx,W,H,cfg,t)=>{ ctx.fillStyle=cfg.bg; ctx.fillRect(0,0,W,H); const fs=Math.max(10,cfg.font*0.8); setFont(ctx,fs);
  const cols=Math.floor(W/fs); const gl="ｱｲｳｴｵｶｷｸ0123456789#@%".split(""); seedStatic("matrix");
  for(let c=0;c<cols;c++){ const speed=rrange(4,14); const head=((t*speed+rrange(0,H/fs))% (H/fs+6));
    for(let r=0;r<H/fs;r++){ const d=head-r; if(d<0||d>16)continue; const ch=gl[(Math.abs((c*7+r*13+Math.floor(t*speed)))%gl.length)];
      ctx.globalAlpha= d<1?1:clamp(1-d/16,0,1); ctx.fillStyle= d<1?"#e8ffe8":cfg.fg; ctx.fillText(ch,c*fs,r*fs); } }
  ctx.globalAlpha=1; });
scene("scope","Waveform Scope",(ctx,W,H,cfg,t)=>{ ctx.fillStyle=cfg.bg; ctx.fillRect(0,0,W,H); ctx.strokeStyle="rgba(80,180,140,.25)";
  for(let x=0;x<W;x+=W/10){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for(let y=0;y<H;y+=H/8){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  ctx.strokeStyle=cfg.fg; ctx.lineWidth=1.5; ctx.beginPath();
  const reactive = cfg.audioReact && lastAudio && lastAudio.data && lastAudio.data.length;
  for(let x=0;x<W;x++){ let y;
    if(reactive){ const idx=Math.floor(((x/W + (t*0.15)) % 1) * lastAudio.data.length); y=H/2 - (lastAudio.data[idx]||0)*H*0.42; }
    else { const ph=x/W*Math.PI*8 + t*4; y=H/2 + Math.sin(ph)*H*0.3*(0.6+0.4*Math.sin(t*1.3)) + (rnd()-0.5)*4; }
    x===0?ctx.moveTo(x,y):ctx.lineTo(x,y); } ctx.stroke(); ctx.lineWidth=1;
  if(reactive){ setFont(ctx,10); glowText(ctx,"● AUDIO-REACTIVE",8,12,cfg.fg,3); } });
/* Also had `t` unread: a surveillance frame that never changed, which is the
   one thing surveillance footage is never accused of. The camera itself is what
   moves — a fixed mount drifts, its AGC breathes, and the recorder blinks. */
scene("camera","Surveillance Cam",(ctx,W,H,cfg,t)=>{ ctx.fillStyle=cfg.bg; ctx.fillRect(0,0,W,H);
  const g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,"rgba(30,70,55,.10)"); g.addColorStop(1,"rgba(0,0,0,0)"); ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  // AGC breathing: the whole frame lifts and settles over about nine seconds.
  const agc=0.06+0.05*Math.sin(t*0.7);
  ctx.fillStyle="rgba(255,255,255,"+agc.toFixed(3)+")"; ctx.fillRect(0,0,W,H);
  // A slow horizontal wipe — the interlace seam a cheap capture card leaves.
  const wy=((t*0.18)%1)*H;
  ctx.fillStyle="rgba(255,255,255,.05)"; ctx.fillRect(0,wy,W,Math.max(1,H*0.03));
  setFont(ctx,cfg.font); ctx.textAlign="center"; ctx.globalAlpha=.5; const body=macros(cfg.text||"NO OPERATOR PRESENT").split("\n");
  // Mount drift: a couple of pixels of sway, so a still is a still and a clip is not.
  const dx=Math.sin(t*0.43)*Math.max(1,W*0.004), dy=Math.cos(t*0.31)*Math.max(1,H*0.004);
  body.forEach((l,i)=>glowText(ctx,l,W/2+dx,H/2+dy+i*cfg.font*1.4,cfg.fg,3)); ctx.globalAlpha=1; ctx.textAlign="left";
  // ● REC, blinking once a second, where every camera OSD puts it.
  if(Math.floor(t*2)%2===0){ ctx.save(); ctx.fillStyle="#ff4444"; ctx.beginPath();
    ctx.arc(W-14,26,Math.max(2,Math.min(W,H)*0.012),0,7); ctx.fill(); ctx.restore(); } });
scene("ekg","EKG / Flatline",(ctx,W,H,cfg,t)=>{ ctx.fillStyle=cfg.bg; ctx.fillRect(0,0,W,H); ctx.strokeStyle="rgba(80,180,140,.2)";
  for(let x=0;x<W;x+=16){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();} for(let y=0;y<H;y+=16){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  ctx.strokeStyle=cfg.fg; ctx.lineWidth=2; ctx.beginPath(); const bpm=70, mid=H*0.55; const flat=t>cfg.duration*0.75;
  /* JavaScript's % keeps the sign of the dividend, and this dividend is
     negative for every x left of the current time — so `beat` landed in
     (-1, 0], the two QRS windows below never matched, and the trace went
     progressively flat from the left as the clip ran. A patient monitor whose
     line dies on its own is not the effect anybody asked for. */
  const wrap1=(v)=>((v%1)+1)%1;
  for(let x=0;x<W;x++){ const beat=wrap1((x/W*cfg.duration - t)*bpm/60); let y=mid; if(!flat&&beat>0.45&&beat<0.5)y=mid-H*0.3; else if(!flat&&beat>0.5&&beat<0.53)y=mid+H*0.15;
    x===0?ctx.moveTo(x,y):ctx.lineTo(x,y); } ctx.stroke(); ctx.lineWidth=1;
  setFont(ctx,cfg.font); glowText(ctx,flat?"-- FLATLINE --":Math.round(bpm)+" BPM",12,16,flat?"#ff5a5a":cfg.fg,4); });
scene("radar","Radar Sweep",(ctx,W,H,cfg,t)=>{ ctx.fillStyle=cfg.bg; ctx.fillRect(0,0,W,H); const cx=W/2,cy=H/2,R=Math.min(W,H)*0.45;
  ctx.strokeStyle="rgba(80,200,150,.35)"; for(let r=R/4;r<=R;r+=R/4){ ctx.beginPath(); ctx.arc(cx,cy,r,0,7); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(cx-R,cy); ctx.lineTo(cx+R,cy); ctx.moveTo(cx,cy-R); ctx.lineTo(cx,cy+R); ctx.stroke();
  const ang=t*1.6; const g=ctx.createConicGradient?ctx.createConicGradient(ang,cx,cy):null;
  ctx.save(); ctx.strokeStyle=cfg.fg; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+Math.cos(ang)*R,cy+Math.sin(ang)*R); ctx.stroke(); ctx.restore();
  seedStatic("radar"); for(let i=0;i<5;i++){ const ba=rrange(0,7),br=rrange(R*0.2,R*0.9); const bl=((ang-ba)%(Math.PI*2)+Math.PI*2)%(Math.PI*2);
    ctx.globalAlpha=clamp(1-bl/2,0,1); ctx.fillStyle=cfg.fg; ctx.beginPath(); ctx.arc(cx+Math.cos(ba)*br,cy+Math.sin(ba)*br,3,0,7); ctx.fill(); }
  ctx.globalAlpha=1; ctx.lineWidth=1; });
scene("hexdump","Hex Dump Scroll",(ctx,W,H,cfg,t)=>{ ctx.fillStyle=cfg.bg; ctx.fillRect(0,0,W,H); const fs=Math.max(10,cfg.font*0.8); setFont(ctx,fs); ctx.textBaseline="top";
  const src=macros(cfg.text||"EREBUS"); const rows=Math.ceil(H/(fs*1.3))+2; const scroll=Math.floor(t*(cfg.cps||14)*0.4);
  for(let r=0;r<rows;r++){ const off=(r+scroll)*16; let hex="",asc=""; for(let b=0;b<16;b++){ let v=rint(0,255);
      const si=(off+b)%src.length; if(((off+b)%37)<src.length && src[(off+b)%src.length]) if(rnd()<0.14){ v=src.charCodeAt(si%src.length); }
      hex+=v.toString(16).padStart(2,"0")+" "; asc+= (v>=32&&v<127)?String.fromCharCode(v):"."; }
    const line=off.toString(16).padStart(8,"0")+"  "+hex+" "+asc; glowText(ctx,line,8,4+r*fs*1.3,cfg.fg,2); } });
scene("spectrum","Spectrum Bars",(ctx,W,H,cfg,t)=>{ ctx.fillStyle=cfg.bg; ctx.fillRect(0,0,W,H); const bars=24, bw=W/bars;
  for(let i=0;i<bars;i++){ const h=(0.2+0.8*Math.abs(Math.sin(i*0.7+t*3)*Math.cos(i*0.3-t*2)))*H*0.8;
    ctx.fillStyle=cfg.fg; ctx.globalAlpha=0.85; ctx.fillRect(i*bw+2,H-h,bw-3,h);
    ctx.globalAlpha=1; ctx.fillRect(i*bw+2,H-h-4,bw-3,2); } });
/* ---- CYBERPUNK + VAPORWAVE scenes ---- */
scene("neongrid","Neon Grid (retrowave)",(ctx,W,H,cfg,t)=>{
  const sky=ctx.createLinearGradient(0,0,0,H*0.58); sky.addColorStop(0,"#180a3a"); sky.addColorStop(1,"#ff2b6b"); ctx.fillStyle=sky; ctx.fillRect(0,0,W,H*0.58);
  const sr=Math.min(W,H)*0.26, cx=W/2, cy=H*0.5; ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,sr,0,7); ctx.clip();
  const sun=ctx.createLinearGradient(0,cy-sr,0,cy+sr); sun.addColorStop(0,"#ffe36b"); sun.addColorStop(0.5,"#ff6ac1"); sun.addColorStop(1,"#a02bff"); ctx.fillStyle=sun; ctx.fillRect(cx-sr,cy-sr,sr*2,sr*2);
  ctx.fillStyle="#180a3a"; for(let i=0;i<7;i++){ const yy=cy+i*(sr/5); ctx.fillRect(cx-sr,yy,sr*2,Math.max(1,i*1.1)); } ctx.restore();
  ctx.fillStyle="#08041c"; ctx.fillRect(0,H*0.58,W,H*0.42); ctx.strokeStyle=cfg.fg; ctx.lineWidth=1; const hz=H*0.58;
  for(let i=-12;i<=12;i++){ ctx.beginPath(); ctx.moveTo(cx+i*W*0.05,hz); ctx.lineTo(cx+i*W*0.55,H); ctx.stroke(); }
  for(let i=0;i<16;i++){ let yy=hz+(Math.pow((i+ (t*1.2)%1)/16,2))*(H-hz); if(yy>hz&&yy<H){ ctx.beginPath(); ctx.moveTo(0,yy); ctx.lineTo(W,yy); ctx.stroke(); } }
  if(cfg.text){ setFont(ctx,cfg.font); ctx.textAlign="center"; glowText(ctx,cfg.fullwidth?fullwidth(cfg.text.split("\n")[0]):cfg.text.split("\n")[0],cx,H*0.18,cfg.fg,12); ctx.textAlign="left"; } });
scene("hud","Cyberpunk HUD",(ctx,W,H,cfg,t)=>{ ctx.fillStyle=cfg.bg; ctx.fillRect(0,0,W,H); ctx.strokeStyle=cfg.fg; ctx.lineWidth=1.5; const cx=W/2,cy=H/2,R=Math.min(W,H)*0.22;
  ctx.beginPath(); ctx.arc(cx,cy,R,0,7); ctx.stroke(); ctx.beginPath(); ctx.arc(cx,cy,R*1.28,t%7,(t%7)+2.2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx-34,cy); ctx.lineTo(cx-10,cy); ctx.moveTo(cx+10,cy); ctx.lineTo(cx+34,cy); ctx.moveTo(cx,cy-34); ctx.lineTo(cx,cy-10); ctx.moveTo(cx,cy+10); ctx.lineTo(cx,cy+34); ctx.stroke();
  const b=18,m=10; [[m,m,1,1],[W-m,m,-1,1],[m,H-m,1,-1],[W-m,H-m,-1,-1]].forEach(a=>{ ctx.beginPath(); ctx.moveTo(a[0],a[1]+a[3]*b); ctx.lineTo(a[0],a[1]); ctx.lineTo(a[0]+a[2]*b,a[1]); ctx.stroke(); });
  setFont(ctx,Math.max(9,cfg.font*0.55)); seedStatic("hud"); const lbl=["SCAN","LOCK","TRACE","SYNC","LINK","AUTH"];
  for(let i=0;i<6;i++){ glowText(ctx,"0x"+(((rint(0,0xffffff))^(Math.floor(t*40)*(i+1)))&0xffffff).toString(16).padStart(6,"0")+" "+lbl[i],10,26+i*13,cfg.fg,2); }
  const tx=cx+Math.sin(t*0.9)*W*0.22, ty=cy+Math.cos(t*1.3)*H*0.2; ctx.strokeStyle="#ff2bd6"; ctx.strokeRect(tx-16,ty-16,32,32); setFont(ctx,10); glowText(ctx,"TGT",tx-15,ty-27,"#ff2bd6",3);
  if(cfg.text){ setFont(ctx,cfg.font); ctx.textAlign="center"; glowText(ctx,cfg.text.split("\n")[0],cx,H-20,cfg.fg,6); ctx.textAlign="left"; } });
scene("cityrain","Neon City Rain",(ctx,W,H,cfg,t)=>{ ctx.fillStyle=cfg.bg; ctx.fillRect(0,0,W,H); seedStatic("cityrain");
  for(let i=0;i<48;i++){ const x=rint(0,W),y=rint(0,H),w=rint(3,10),h=rint(3,16); if(Math.sin(i*2.7+t*2)>0.1){ ctx.fillStyle= i%2?"#ff2bd6":"#00f0ff"; ctx.globalAlpha=0.55; ctx.fillRect(x,y,w,h); ctx.globalAlpha=0.15; ctx.fillRect(x,y+h,w,h*2); } }
  ctx.globalAlpha=0.5; ctx.strokeStyle=cfg.fg; for(let i=0;i<130;i++){ const x=((i*53+t*420)%(W+40))-20, y=((i*97+t*640)%(H+40))-20; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x-4,y+15); ctx.stroke(); } ctx.globalAlpha=1;
  if(cfg.text){ setFont(ctx,cfg.font); glowText(ctx,cfg.text.split("\n")[0],12,H-20,cfg.fg,10); } });
scene("hologram","Hologram Panels",(ctx,W,H,cfg,t)=>{ ctx.fillStyle=cfg.bg; ctx.fillRect(0,0,W,H); setFont(ctx,cfg.font*0.85); ctx.textBaseline="middle";
  const panels=(macros(cfg.text)||"SYSTEM ONLINE\nID: 0047\nSTATUS: ACTIVE").split("\n"); ctx.save(); ctx.globalAlpha=0.45+0.25*Math.sin(t*8);
  panels.forEach((p,i)=>{ const y=24+i*(H*0.24); ctx.strokeStyle=cfg.fg; ctx.strokeRect(20,y,W-40,H*0.17); ctx.fillStyle="rgba(0,240,255,.08)"; ctx.fillRect(20,y,W-40,H*0.17); glowText(ctx,p,34,y+H*0.085,cfg.fg,8); });
  ctx.restore(); ctx.textBaseline="top"; for(let yy=0;yy<H;yy+=4){ ctx.fillStyle="rgba(0,240,255,.05)"; ctx.fillRect(0,yy,W,1); } });
scene("breach","System Breach",(ctx,W,H,cfg,t)=>{ ctx.fillStyle=cfg.bg; ctx.fillRect(0,0,W,H); const fs=Math.max(9,cfg.font*0.62); setFont(ctx,fs); ctx.textBaseline="top";
  const cols=Math.floor(W/(fs*0.62)); const cs="0123456789ABCDEF"; const prog=(t*0.5)%1;
  for(let r=0;r<H/fs;r++){ let line=""; for(let c=0;c<cols;c++) line+=cs[(Math.floor(t*22)+r*7+c*13)%16]; ctx.globalAlpha= (r/(H/fs))<prog?0.9:0.22; glowText(ctx,line,4,r*fs,cfg.fg,2); }
  ctx.globalAlpha=1; const done=(t%6)>3; setFont(ctx,cfg.font*1.4); ctx.textAlign="center"; const msg=cfg.text? (cfg.text.split("\n")[0]) : (done?"ACCESS GRANTED":"BREACHING...");
  ctx.fillStyle="#000"; ctx.fillRect(W/2-ctx.measureText(msg).width/2-12,H/2-cfg.font,ctx.measureText(msg).width+24,cfg.font*2.6); glowText(ctx,msg,W/2,H/2,done?"#39ff9e":"#ff2bd6",14); ctx.textAlign="left"; ctx.textBaseline="top"; });
scene("statue","Vapor Statue",(ctx,W,H,cfg,t)=>{ const sky=ctx.createLinearGradient(0,0,0,H); sky.addColorStop(0,"#2b0a5e"); sky.addColorStop(0.5,"#ff6ac1"); sky.addColorStop(1,"#7af0ff"); ctx.fillStyle=sky; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle="rgba(255,255,255,.4)"; const hz=H*0.62,cx=W/2; for(let i=-8;i<=8;i++){ ctx.beginPath(); ctx.moveTo(cx+i*W*0.06,hz); ctx.lineTo(cx+i*W*0.6,H); ctx.stroke(); }
  for(let i=0;i<10;i++){ const yy=hz+Math.pow(i/10,2)*(H-hz); ctx.beginPath(); ctx.moveTo(0,yy); ctx.lineTo(W,yy); ctx.stroke(); }
  const bob=Math.sin(t*1.2)*H*0.02; ctx.fillStyle="rgba(240,232,255,.9)"; ctx.beginPath(); ctx.ellipse(cx,hz-H*0.16+bob,W*0.09,H*0.13,0,0,7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx-W*0.15,hz+bob); ctx.quadraticCurveTo(cx,hz-H*0.11+bob,cx+W*0.15,hz+bob); ctx.lineTo(cx+W*0.15,hz+H*0.1); ctx.lineTo(cx-W*0.15,hz+H*0.1); ctx.closePath(); ctx.fill();
  if(cfg.text){ setFont(ctx,cfg.font); ctx.textAlign="center"; glowText(ctx,fullwidth(cfg.text.split("\n")[0]),cx,H*0.14,"#fff",12); ctx.textAlign="left"; } });
/* ---- IMPORT + UTILITY scenes ---- */
scene("videoin","Video In (filter a clip)",(ctx,W,H,cfg,t)=>{ ctx.fillStyle="#000"; ctx.fillRect(0,0,W,H); drawVideoFit(ctx,W,H,cfg.srcKey);
  if(cfg.text && hasImportedVideo()){ setFont(ctx,cfg.font); ctx.textAlign="center"; glowText(ctx,cfg.fullwidth?fullwidth(cfg.text.split("\n")[0]):cfg.text.split("\n")[0],W/2,H-24,cfg.fg,8); ctx.textAlign="left"; } });
scene("kenburns","Import (Ken Burns)",(ctx,W,H,cfg,t)=>{ ctx.fillStyle="#000"; ctx.fillRect(0,0,W,H); const p=t/Math.max(0.1,cfg.duration);
  drawImportFit(ctx,W,H,{z:p, x:Math.sin(p*Math.PI)*0.6, y:(p-0.5)*0.6});
  if(cfg.text){ setFont(ctx,cfg.font); ctx.textAlign="center"; glowText(ctx,cfg.text.split("\n")[0],W/2,H-24,cfg.fg,8); ctx.textAlign="left"; } });
scene("countdown","Film Countdown",(ctx,W,H,cfg,t)=>{ ctx.fillStyle=cfg.bg; ctx.fillRect(0,0,W,H); const cx=W/2,cy=H/2,R=Math.min(W,H)*0.44;
  ctx.strokeStyle=cfg.fg; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(0,cy); ctx.lineTo(W,cy); ctx.moveTo(cx,0); ctx.lineTo(cx,H); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,R,0,7); ctx.stroke();
  const sweep=(t%1); ctx.save(); ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,R,-Math.PI/2,-Math.PI/2+sweep*Math.PI*2); ctx.closePath(); ctx.clip(); ctx.fillStyle="rgba(255,255,255,.06)"; ctx.fillRect(0,0,W,H); ctx.restore();
  const n=Math.max(2,8-Math.floor(t)); setFont(ctx,R*1.4); ctx.textAlign="center"; ctx.textBaseline="middle"; glowText(ctx,String(n),cx,cy+R*0.05,cfg.fg,12); ctx.textAlign="left"; ctx.textBaseline="top";
  if(t%1<0.05){ ctx.fillStyle="rgba(255,255,255,.14)"; ctx.fillRect(0,0,W,H); } });
scene("credits","Credits Crawl",(ctx,W,H,cfg,t)=>{ ctx.fillStyle=cfg.bg; ctx.fillRect(0,0,W,H); const lines=(macros(cfg.text)||"DEAD SIGNAL\n\na film by\nYOU\n\n1985").split("\n"); setFont(ctx,cfg.font); ctx.textAlign="center"; ctx.textBaseline="top";
  const lh=cfg.font*1.8; const start=H+10; let y=start-(t*(cfg.cps||14)*1.2);
  lines.forEach((ln,i)=>{ const yy=y+i*lh; if(yy<-lh||yy>H)return; const a=clamp(Math.min(yy/(H*0.2),(H-yy)/(H*0.2)),0,1); ctx.globalAlpha=a; glowText(ctx,cfg.fullwidth?fullwidth(ln):ln,W/2,yy,cfg.fg,6); });
  ctx.globalAlpha=1; ctx.textAlign="left"; });
/**
 * Fill the scene picker, grouped by the active aesthetic's pack.
 *
 * Forty-eight scenes in one flat list is a list you scroll rather than read.
 * The pack's picks come first under a heading and everything else follows —
 * GROUPED, never filtered: a horror scene in a cyberpunk project is a
 * legitimate choice, and every scene is still one scroll away.
 *
 * Rebuilding must not dispatch. The picker's own change handler restarts the
 * preview and stamps the document, so echoing the restored value would fire it
 * on every aesthetic switch.
 */
export function fillSceneSelect(aestheticId){
  const s=$("v-scene"); if(!s)return 0; const cur=s.value;
  const id=aestheticId!==undefined?aestheticId:($("aesthetic")?$("aesthetic").value:null);
  const [featured,rest]=splitByPack(Object.values(SCENES),id,"scenes");
  s.replaceChildren();
  const opt=(sc)=>{ const o=document.createElement("option"); o.value=sc.id; o.textContent=sc.name; return o; };
  if(featured.length&&rest.length){
    const pack=$("aesthetic")?($("aesthetic").selectedOptions[0]||{}).textContent:null;
    const a=document.createElement("optgroup"); a.label=(pack||"This aesthetic").trim();
    featured.forEach(sc=>a.appendChild(opt(sc))); s.appendChild(a);
    const b=document.createElement("optgroup"); b.label="Everything else";
    rest.forEach(sc=>b.appendChild(opt(sc))); s.appendChild(b);
  } else [...featured,...rest].forEach(sc=>s.appendChild(opt(sc)));
  if(cur)s.value=cur;   /* dom-only: dispatching here would restart the preview */
  return featured.length+rest.length; }
/* overlays drawn on top of a scene */
