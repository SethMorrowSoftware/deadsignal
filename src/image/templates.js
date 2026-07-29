/* Dead Signal Studio — image/templates.js */
import { $ } from '../core/dom.js';
import { rint, rnd, seedStatic } from '../core/rng.js';
import { fullwidth, glowText, macros, setFont, wrapLines } from '../core/text.js';
import { bevel, drawIcon, win95 } from './chrome95.js';
import { _importedImg, drawImportFit } from '../media/import.js';
import { splitByPack } from '../core/packs.js';

export const TEMPLATES={};


/* Templates whose palette IS the thing being recreated.
 *
 * A Blue Screen is blue; an Explorer window is Windows grey; a missing poster is
 * black ink on white paper. Those are not templates that forgot to read cfg.fg
 * and cfg.bg — they are recreations, and honouring an ink colour would destroy
 * the only thing they are for.
 *
 * The list exists because the SCREEN tab shows Ink and Ground unconditionally,
 * so for two thirds of the templates they were controls that did nothing, with
 * nothing on screen to say so. ui/sizing.js reads this to disable them and
 * explain why.
 *
 * It is a DECLARED list checked against MEASURED behaviour: the deep audit
 * renders every template on two different grounds and asserts that the set which
 * ignores them is exactly this one. So a template that stops taking colour in a
 * refactor is a failure rather than a quiet change, and so is one added here by
 * mistake.
 */
export const FIXED_PALETTE = new Set(['autopsy', 'bios', 'blueprint', 'bsod', 'bsod_nt', 'calendar',
  'cassette', 'certificate', 'chat', 'clipping', 'desktop', 'dialog', 'explorer', 'filecabinet',
  'http404', 'import', 'journal', 'mall', 'map', 'policereport', 'poster', 'prescription',
  'redacted', 'registry', 'shutdown', 'statement', 'taskmgr', 'vapordesktop', 'vhslabel', 'vitals']);

/** True when this template draws in its own fixed colours. */
export const hasFixedPalette = (id) => FIXED_PALETTE.has(String(id || ''));
export function template(id,name,draw){ TEMPLATES[id]={id,name,draw}; }
export function baseTerm(ctx,W,H,c){ ctx.fillStyle=c.trans?"rgba(0,0,0,0)":c.bg; if(!c.trans){ctx.fillStyle=c.bg;ctx.fillRect(0,0,W,H);}
  const g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,"rgba(20,60,45,.10)"); g.addColorStop(1,"rgba(0,0,0,0)"); ctx.fillStyle=g; ctx.fillRect(0,0,W,H); }
template("terminal","Terminal",(ctx,W,H,c)=>{ baseTerm(ctx,W,H,c); setFont(ctx,c.font); ctx.textBaseline="top"; ctx.textAlign="left";
  if(c.title) glowText(ctx,"┌─ "+c.title+" "+"─".repeat(Math.max(0,Math.floor((W-40)/(c.font*0.6))-c.title.length-4)),12,12,c.fg,3);
  let y=12+c.font*1.6;
  const body=macros(c.body);
  (c.wrap?wrapLines(ctx,body,W-24):body.split("\n")).forEach(l=>{ glowText(ctx,l,12,y,c.fg,4); y+=c.font*1.42; }); });
template("bsod","Blue Screen (9x)",(ctx,W,H,c)=>{ ctx.fillStyle="#0000aa"; ctx.fillRect(0,0,W,H); setFont(ctx,c.font); ctx.textAlign="center"; ctx.textBaseline="top";
  const tw=ctx.measureText(" "+(c.title||"EREBUS")+" ").width; ctx.fillStyle="#c0c0c0"; ctx.fillRect((W-tw)/2,H*0.14,tw,c.font+6); ctx.fillStyle="#0000aa"; ctx.fillText(" "+(c.title||"EREBUS")+" ",W/2,H*0.14+3);
  ctx.fillStyle="#fff"; ctx.textAlign="left"; const body=bodyLines(ctx,c,"A fatal exception 0E has occurred at 0347:OBSERVE.\nThe archive is still listening.\n\nPress any key to continue _",W*0.76); let y=H*0.3; body.forEach(l=>{ ctx.fillText(l,W*0.12,y); y+=c.font*1.5; }); });
template("bsod_nt","STOP Screen (NT)",(ctx,W,H,c)=>{ ctx.fillStyle="#0000aa"; ctx.fillRect(0,0,W,H); ctx.fillStyle="#fff"; setFont(ctx,c.font); ctx.textAlign="left"; ctx.textBaseline="top"; let y=H*0.14;
  /* SPREAD, not one element. The body went in as a single string, so its own
     newlines were never split and a two-line message drew both lines on top of
     each other at the same y. */
  const L=["*** STOP: 0x0000007B (0x0347,0x0047,0x0000,0x0000)","","UNMOUNTABLE_ARCHIVE_VOLUME","",
    ...bodyLines(ctx,c,"If this is the first time you've seen this stop error,\nthe archive has chosen to remember you.",W*0.84),
    "","Beginning dump of physical memory","Physical memory dump 47% complete."];
  L.forEach(l=>{ ctx.fillText(l,W*0.08,y); y+=c.font*1.5; }); });
template("import","Import Image (retro-ify)",(ctx,W,H,c)=>{ ctx.fillStyle="#000"; ctx.fillRect(0,0,W,H); drawImportFit(ctx,W,H,null);
  if(c.title && _importedImg){ ctx.save(); ctx.fillStyle="rgba(0,0,0,.5)"; ctx.fillRect(0,H-20,W,20); setFont(ctx,12); ctx.textBaseline="middle"; glowText(ctx,c.title,8,H-10,c.fg,0); ctx.restore(); } });
template("camera","Camera Still",(ctx,W,H,c)=>{ baseTerm(ctx,W,H,c); ctx.save(); ctx.fillStyle="rgba(0,0,0,.55)"; ctx.fillRect(0,0,W,18); setFont(ctx,11); ctx.textBaseline="middle";
  glowText(ctx,(c.title||"CAM 47 // LAB-3")+"   REC ●",6,10,c.fg,0); ctx.restore(); setFont(ctx,14); ctx.textAlign="right"; ctx.textBaseline="bottom"; glowText(ctx,"03:47:00",W-6,H-5,c.fg,0);
  setFont(ctx,c.font); ctx.textAlign="center"; ctx.globalAlpha=.5; bodyLines(ctx,c,"NO OPERATOR PRESENT",W*0.8).forEach((l,i)=>glowText(ctx,l,W/2,H/2+i*c.font*1.4,c.fg,3)); ctx.globalAlpha=1; });
template("keycard","ID / Keycard",(ctx,W,H,c)=>{ ctx.fillStyle=c.bg; ctx.fillRect(0,0,W,H); ctx.strokeStyle=c.fg; ctx.lineWidth=2; ctx.strokeRect(10,10,W-20,H-20);
  setFont(ctx,c.font+4); ctx.textAlign="left"; ctx.textBaseline="alphabetic"; glowText(ctx,"EREBUS LABS // ACCESS",24,42,c.fg,4); ctx.strokeRect(24,60,W*0.3,W*0.3); setFont(ctx,c.font); glowText(ctx,"[ NO PHOTO ]",30,60+W*0.16,c.fg,0);
  const bx=24+W*0.3+20; let y=78; bodyLines(ctx,c,"NAME:  M. WEBB\nBADGE: 0047\nCLEAR: LEAD ARCHITECT\nSTATUS: MISSING 47d\nLAST:  03:47",W-bx-24).forEach(l=>{ glowText(ctx,l,bx,y,c.fg,0); y+=c.font*1.6; }); });
template("dialog","Error Dialog",(ctx,W,H,c)=>{ ctx.fillStyle="#0a5a6a"; ctx.fillRect(0,0,W,H); const w=Math.min(W-40,360),h=140,x=(W-w)/2,y=(H-h)/2; const win=win95(ctx,x,y,w,h,c.title||"System Error",true);
  drawIcon(ctx,win.cx+6,win.cy+8,(c.extra||"stop")); ctx.fillStyle="#000"; setFont(ctx,12); ctx.textAlign="left"; ctx.textBaseline="top"; let ty=win.cy+8; bodyLines(ctx,c,"EREBUS.EXE has performed an illegal operation.\nIt will not be shut down.",win.cw-56).forEach(l=>{ ctx.fillText(l,win.cx+48,ty); ty+=16; });
  const bw=64,bx=x+w-bw-10,by=y+h-26; ctx.fillStyle="#c0c0c0"; ctx.fillRect(bx,by,bw,20); bevel(ctx,bx,by,bw,20,true); ctx.fillStyle="#000"; ctx.textAlign="center"; ctx.fillText("OK",bx+bw/2,by+4); });
template("explorer","File Explorer",(ctx,W,H,c)=>{ ctx.fillStyle="#0a5a6a"; ctx.fillRect(0,0,W,H); const win=win95(ctx,8,8,W-16,H-16,c.title||"Exploring - .archive",true);
  ctx.fillStyle="#fff"; ctx.fillRect(win.cx,win.cy,win.cw,win.ch); bevel(ctx,win.cx,win.cy,win.cw,win.ch,false); setFont(ctx,12); ctx.textBaseline="top"; ctx.textAlign="left";
  ctx.fillStyle="#000"; ctx.fillText("Name                    Size    Type        Modified",win.cx+8,win.cy+6);
  const rows=macros(c.body||"INDEX.txt|2KB|Text|03:47\nEREBUS_SPEC.txt|4KB|Text|03:47\nwebb_merge.log|4.7KB|Log|03:47\n[CORRUPTED]|??|??|??").split("\n"); let y=win.cy+24;
  rows.forEach((r,i)=>{ const cells=r.split("|"); if(/CORRUPT/i.test(r)){ ctx.fillStyle="#a00"; } else ctx.fillStyle= i%2?"#000":"#202020"; ctx.fillText((cells[0]||"").padEnd(24).slice(0,24)+(cells[1]||"").padEnd(8)+(cells[2]||"").padEnd(12)+(cells[3]||""),win.cx+8,y); y+=16; }); });
template("boot","Boot Splash",(ctx,W,H,c)=>{ ctx.fillStyle="#000"; ctx.fillRect(0,0,W,H); setFont(ctx,c.font+6); ctx.textAlign="center"; ctx.textBaseline="middle"; glowText(ctx,c.title||"EREBUS 95",W/2,H*0.4,c.fg,10);
  ctx.strokeStyle=c.fg; const bw=W*0.4,bx=W*0.3,by=H*0.62; ctx.strokeRect(bx,by,bw,12); ctx.fillStyle=c.fg; for(let x=0;x<bw*0.6;x+=6)ctx.fillRect(bx+2+x,by+2,4,8); setFont(ctx,11); glowText(ctx,macros(c.body||"Starting the archive..."),W/2,by+30,c.fg,0); });
template("shutdown","Shutdown Screen",(ctx,W,H,c)=>{ ctx.fillStyle="#000"; ctx.fillRect(0,0,W,H); setFont(ctx,Math.max(16,c.font+4)); ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillStyle="#ffb000"; ctx.shadowColor="#ffb000"; ctx.shadowBlur=8;
  const t=bodyLines(ctx,c,"It is now safe to turn off\nyour computer.",W*0.72); t.forEach((l,i)=>ctx.fillText(l,W/2,H/2-((t.length-1)/2-i)*c.font*1.6)); ctx.shadowBlur=0; });
template("desktop","Fake Desktop",(ctx,W,H,c)=>{ ctx.fillStyle="#3a6ea5"; ctx.fillRect(0,0,W,H); setFont(ctx,11); ctx.textAlign="center"; ctx.textBaseline="top";
  // Wrap into columns like a real desktop: a cell is icon (24) + label (~16),
  // so the last row's bottom (gy+40) must clear the taskbar top at H-28.
  const icons=macros(c.body||"My Computer\nEREBUS\nRecycle Bin\nARCHIVE").split("\n"); const rows=Math.max(1,Math.floor((H-88)/64)+1);
  icons.forEach((ic,i)=>{ const gx=28+Math.floor(i/rows)*72, gy=20+(i%rows)*64; ctx.fillStyle="#c0c0c0"; ctx.fillRect(gx-14,gy,28,24); bevel(ctx,gx-14,gy,28,24,true); ctx.fillStyle="#fff"; ctx.fillText(ic.slice(0,12),gx,gy+28); });
  ctx.fillStyle="#c0c0c0"; ctx.fillRect(0,H-28,W,28); bevel(ctx,0,H-28,W,28,true); ctx.fillStyle="#c0c0c0"; ctx.fillRect(4,H-24,54,20); bevel(ctx,4,H-24,54,20,true); ctx.fillStyle="#000"; ctx.textAlign="left"; setFont(ctx,12); ctx.fillText("Start",10,H-18);
  ctx.textAlign="right"; ctx.fillText("3:47 AM",W-10,H-18); });
template("redacted","Redacted Document",(ctx,W,H,c)=>{ ctx.fillStyle=c.trans?"#f4f0e4":"#f4f0e4"; ctx.fillRect(0,0,W,H); ctx.fillStyle="#900"; setFont(ctx,13); ctx.textAlign="center"; ctx.textBaseline="top";
  ctx.fillText("— "+(c.extra||"CLASSIFIED")+" —",W/2,10); ctx.fillText("— "+(c.extra||"CLASSIFIED")+" —",W/2,H-24); ctx.fillStyle="#111"; setFont(ctx,c.font); ctx.textAlign="left"; let y=40;
  bodyLines(ctx,c,"MEMO // CASE {{case}}\n\nSubject [[REDACTED]] entered LAB-3 at\n03:47 with [[REDACTED]]. Session record\nedited to read 03:12. See [[REDACTED]].",W-48).forEach(line=>{ let x=24; const parts=line.split(/(\[\[.*?\]\])/g);
    parts.forEach(p=>{ if(/^\[\[/.test(p)){ const t=p.replace(/\[\[|\]\]/g,""); const w=ctx.measureText(t).width; ctx.fillStyle="#000"; ctx.fillRect(x,y,w,c.font+2); ctx.fillStyle="#111"; x+=w; } else { ctx.fillText(p,x,y); x+=ctx.measureText(p).width; } }); y+=c.font*1.6; }); });
/* Every offset here is a FRACTION of the frame. It used to be a set of absolute
   pixels — title at y=14, photo box 100x100 at y=64, body at y=178 — which is
   right at the tab's default 480x360 and wrong everywhere else: below about
   240px tall the body was drawn past the bottom edge and vanished entirely, and
   the preset gallery draws its cards at 128x96, so the card for this template
   showed a poster with nothing written on it.
   The title is the author's, too. It was the one template in the set that
   printed a hard-coded word where the rest all read c.title — so typing a title
   here did nothing, with no indication why. */
template("poster","Missing Poster",(ctx,W,H,c)=>{ ctx.fillStyle="#eee"; ctx.fillRect(0,0,W,H); ctx.fillStyle="#000";
  setFont(ctx,Math.max(12,Math.min(H*0.11,c.font*2))); ctx.textAlign="center"; ctx.textBaseline="top";
  ctx.fillText(macros(c.title||"MISSING"),W/2,H*0.04);
  const box=Math.min(W*0.21,H*0.28), bx=W/2-box/2, by=H*0.18;
  ctx.strokeStyle="#000"; ctx.strokeRect(bx,by,box,box);
  setFont(ctx,Math.max(7,Math.min(12,box*0.12))); ctx.fillText("[ NO PHOTO ]",W/2,by+box*0.46);
  setFont(ctx,c.font); let y=by+box+H*0.04;
  bodyLines(ctx,c,"DR. MARCUS WEBB\nLast seen: LAB-3, 03:47\nHeight: 6'0\"  Age: 47\nIf seen, do not approach.\nCall COMMAND: 555-0347",W*0.84).forEach(l=>{ ctx.fillText(l,W/2,y); y+=c.font*1.5; }); });
template("taskmgr","Task Manager",(ctx,W,H,c)=>{ ctx.fillStyle="#0a5a6a"; ctx.fillRect(0,0,W,H); const win=win95(ctx,8,8,W-16,H-16,"Close Program",true); ctx.fillStyle="#fff"; ctx.fillRect(win.cx,win.cy,win.cw,win.ch); bevel(ctx,win.cx,win.cy,win.cw,win.ch,false);
  setFont(ctx,12); ctx.textBaseline="top"; ctx.textAlign="left"; const rows=macros(c.body||"Explorer\nInbox\nEREBUS.EXE [Not Responding]\nWEBB_47\nArchive Monitor").split("\n"); let y=win.cy+6;
  rows.forEach((r,i)=>{ if(/EREBUS|Not Responding/i.test(r)){ ctx.fillStyle="#000080"; ctx.fillRect(win.cx+2,y-2,win.cw-4,15); ctx.fillStyle="#fff"; } else ctx.fillStyle="#000"; ctx.fillText(r,win.cx+8,y); y+=16; }); });
template("hexedit","Hex Editor",(ctx,W,H,c)=>{ baseTerm(ctx,W,H,c); const fs=Math.max(10,c.font*0.85); setFont(ctx,fs); ctx.textBaseline="top"; ctx.textAlign="left"; const src=macros(c.body||"EREBUS OBSERVE 0347"); seedStatic("hexedit");
  const rows=Math.floor((H-20)/(fs*1.3)); for(let r=0;r<rows;r++){ let hex="",asc=""; for(let b=0;b<16;b++){ let v=rint(0,255); const gi=r*16+b; if(gi<src.length&&rnd()<0.5){ v=src.charCodeAt(gi); } hex+=v.toString(16).padStart(2,"0")+" "; asc+=(v>=32&&v<127)?String.fromCharCode(v):"."; }
    glowText(ctx,(r*16).toString(16).padStart(8,"0")+"  "+hex+" |"+asc+"|",8,8+r*fs*1.3,c.fg,2); } });
template("testpattern","CRT Test Pattern",(ctx,W,H,c)=>{ const cols=["#ffffff","#ffff00","#00ffff","#00ff00","#ff00ff","#ff0000","#0000ff","#000000"]; const bw=W/cols.length; cols.forEach((col,i)=>{ ctx.fillStyle=col; ctx.fillRect(i*bw,0,bw+1,H*0.66); });
  ctx.fillStyle="#000"; ctx.fillRect(0,H*0.66,W,H*0.34); ctx.strokeStyle="#fff"; ctx.beginPath(); ctx.arc(W/2,H/2,Math.min(W,H)*0.42,0,7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(W/2,0); ctx.lineTo(W/2,H); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke();
  setFont(ctx,c.font); ctx.fillStyle=c.fg; ctx.textAlign="center"; glowText(ctx,macros(c.title||"EREBUS-TV"),W/2,H*0.8,c.fg,4); });
template("registry","Registry Editor",(ctx,W,H,c)=>{ ctx.fillStyle="#0a5a6a"; ctx.fillRect(0,0,W,H); const win=win95(ctx,8,8,W-16,H-16,"Registry Editor",true); ctx.fillStyle="#fff"; ctx.fillRect(win.cx,win.cy,win.cw*0.4,win.ch); ctx.fillRect(win.cx+win.cw*0.42,win.cy,win.cw*0.58,win.ch); bevel(ctx,win.cx,win.cy,win.cw*0.4,win.ch,false); bevel(ctx,win.cx+win.cw*0.42,win.cy,win.cw*0.58,win.ch,false);
  setFont(ctx,11); ctx.fillStyle="#000"; ctx.textBaseline="top"; ctx.textAlign="left"; ["HKEY_LOCAL_MACHINE","  SOFTWARE","    EREBUS","      Watching"].forEach((k,i)=>ctx.fillText(k,win.cx+4,win.cy+6+i*15));
  const vals=macros(c.body||"Watching|REG_DWORD|0x00000001 (1)\nSince|REG_SZ|03:47\nSubject|REG_SZ|you").split("\n"); let y=win.cy+6; vals.forEach(v=>{ const p=v.split("|"); ctx.fillText((p[0]||"").padEnd(12).slice(0,12)+" "+(p[1]||"")+"  "+(p[2]||""),win.cx+win.cw*0.42+4,y); y+=15; }); });
/* ---- CYBERPUNK templates ---- */
template("cyberterm","Cyberpunk Terminal",(ctx,W,H,c)=>{ ctx.fillStyle=c.bg; ctx.fillRect(0,0,W,H); ctx.strokeStyle=c.fg; ctx.lineWidth=1; ctx.strokeRect(6,6,W-12,H-12);
  ctx.fillStyle="rgba(255,43,214,.14)"; ctx.fillRect(6,6,W-12,20); setFont(ctx,12); ctx.textBaseline="middle"; ctx.textAlign="left"; glowText(ctx,(c.title||"NETWATCH // NODE")+"   [SECURE]",12,17,c.fg,4);
  setFont(ctx,c.font); ctx.textBaseline="top"; let y=34; bodyLines(ctx,c,"> breach --node 0047\n> bypassing ICE .......\n> ACCESS GRANTED\n> pulling soul.dat  47%\n> _",W-28).forEach(l=>{ glowText(ctx,l,14,y,c.fg,4); y+=c.font*1.45; }); });
template("corpo","Corp Login",(ctx,W,H,c)=>{ const g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,"#05010a"); g.addColorStop(1,c.bg); ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  setFont(ctx,Math.max(22,c.font*1.8)); ctx.textAlign="center"; glowText(ctx,c.title||"ARASAKA",W/2,H*0.2,c.fg,12); setFont(ctx,c.font); glowText(ctx,"CORPORATE ACCESS TERMINAL",W/2,H*0.33,c.fg,4);
  const bw=W*0.56,bx=W*0.22; ["OPERATIVE ID","PASSPHRASE"].forEach((lbl,i)=>{ const y=H*0.48+i*H*0.16; ctx.strokeStyle=c.fg; ctx.strokeRect(bx,y,bw,c.font*1.9); ctx.textAlign="left"; glowText(ctx,lbl,bx,y-c.font*0.9,c.fg,2); glowText(ctx,i?"● ● ● ● ● ● ●":(macros(c.extra)||"V. ARTYOM"),bx+8,y+c.font*0.5,c.fg,4); ctx.textAlign="center"; });
  ctx.strokeStyle=c.fg; ctx.strokeRect(W/2-70,H*0.84,140,c.font*1.8); glowText(ctx,"AUTHENTICATE",W/2,H*0.84+c.font*0.6,c.fg,6); ctx.textAlign="left"; });
template("implant","Cyber Implant ID",(ctx,W,H,c)=>{ ctx.fillStyle=c.bg; ctx.fillRect(0,0,W,H); ctx.strokeStyle=c.fg; ctx.lineWidth=2; ctx.strokeRect(10,10,W-20,H-20);
  setFont(ctx,c.font+4); ctx.textAlign="left"; glowText(ctx,"CYBERWARE REGISTRY",24,42,c.fg,6); ctx.strokeRect(24,60,W*0.3,W*0.3); setFont(ctx,c.font); glowText(ctx,"[BIOSCAN]",30,60+W*0.16,c.fg,0);
  const bx=24+W*0.3+20; let y=78; bodyLines(ctx,c,"UNIT:   KIROSHI OPTICS\nSERIAL: 0047-NX\nHOST:   V. ARTYOM\nSTATUS: ONLINE\nHUMANITY: 47%",W-bx-24).forEach(l=>{ glowText(ctx,l,bx,y,c.fg,2); y+=c.font*1.6; }); });
/* ---- VAPORWAVE templates ---- */
template("vapordesktop","Vapor Desktop",(ctx,W,H,c)=>{ const g=ctx.createLinearGradient(0,0,W,H); g.addColorStop(0,"#ff9ff3"); g.addColorStop(1,"#7af0ff"); ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  const win=win95(ctx,W*0.15,H*0.18,W*0.7,H*0.52,c.title||"ａｅｓｔｈｅｔｉｃ.exe",true); ctx.fillStyle="#fff"; ctx.fillRect(win.cx,win.cy,win.cw,win.ch); bevel(ctx,win.cx,win.cy,win.cw,win.ch,false);
  setFont(ctx,Math.max(18,c.font*1.4)); ctx.textAlign="center"; ctx.textBaseline="middle"; glowText(ctx,fullwidth(macros(c.body||"WELCOME")),W/2,win.cy+win.ch/2,"#ff2bd6",6); ctx.textBaseline="top"; ctx.textAlign="left";
  ctx.fillStyle="#c0c0c0"; ctx.fillRect(0,H-26,W,26); bevel(ctx,0,H-26,W,26,true); ctx.fillStyle="#c0c0c0"; ctx.fillRect(4,H-22,52,18); bevel(ctx,4,H-22,52,18,true); setFont(ctx,12); ctx.fillStyle="#000"; ctx.fillText("Start",10,H-19); ctx.textAlign="right"; ctx.fillText("3:47",W-8,H-19); ctx.textAlign="left"; });
template("mall","Mall Directory",(ctx,W,H,c)=>{ ctx.fillStyle="#120a2e"; ctx.fillRect(0,0,W,H); setFont(ctx,Math.max(20,c.font*1.6)); ctx.textAlign="center"; ctx.textBaseline="top"; glowText(ctx,fullwidth(c.title||"PLAZA"),W/2,20,"#ff9ff3",12);
  setFont(ctx,c.font); ctx.textAlign="left"; let y=H*0.24; macros(c.body||"01  SUNSET RECORDS\n02  NEO-TOKYO ARCADE\n03  MARBLE FOUNTAIN\n04  FOOD COURT\n47  ??? (CLOSED)").split("\n").forEach(l=>{ glowText(ctx,l,W*0.2,y,"#7af0ff",4); y+=c.font*1.7; }); });
template("cassette","Cassette J-Card",(ctx,W,H,c)=>{ const g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,"#ff6ac1"); g.addColorStop(1,"#7af0ff"); ctx.fillStyle=g; ctx.fillRect(0,0,W,H); ctx.strokeStyle="#fff"; ctx.strokeRect(8,8,W-16,H-16);
  setFont(ctx,Math.max(20,c.font*1.6)); ctx.textAlign="center"; ctx.textBaseline="top"; glowText(ctx,fullwidth(c.title||"NIGHT DRIVE"),W/2,H*0.14,"#fff",8);
  setFont(ctx,c.font); ctx.textAlign="left"; let y=H*0.4; macros(c.body||"A1  Neon Rain\nA2  Lost Signal\nB1  After Hours\nB2  ０３４７").split("\n").forEach(l=>{ glowText(ctx,l,W*0.2,y,"#2b0a5e",0); y+=c.font*1.6; }); glowText(ctx,"CHROME · 47min",W*0.2,H-22,"#2b0a5e",0); });
/** Fill the template picker, grouped by the active aesthetic's pack. See
 *  fillSceneSelect — same rule, same reason: grouped, never filtered, and the
 *  restored value must not dispatch or every switch would re-render. */
/**
 * A template's body text as lines, wrapped to `maxWidth` when the author asked.
 *
 * Wrapping was VIDEO-only plus this file's Terminal, because every other
 * template hand-rolls its own layout — so `Wrap` was a checkbox that did
 * nothing on 45 of the 46 screens. There is no shared text box to wrap TO, so
 * each call site passes its own width; the ones that draw a TABLE, a hex dump
 * or a column of menu items pass nothing and are unaffected, because breaking
 * "ARCHIVE_0347.TAP|C:\TAPES|14.2 MB" across two lines is not word wrap, it is
 * damage.
 *
 * Measured in the context's CURRENT font, so call it after setFont — same
 * contract wrapLines has always had.
 */
export function bodyLines(ctx,c,fallback,maxWidth){
  const txt=macros(c.body||fallback||"");
  return (c.wrap&&maxWidth>0) ? wrapLines(ctx,txt,maxWidth) : txt.split("\n");
}
export function fillTemplateSelect(aestheticId){
  const s=$("i-tpl"); if(!s)return 0; const cur=s.value;
  const id=aestheticId!==undefined?aestheticId:($("aesthetic")?$("aesthetic").value:null);
  const [featured,rest]=splitByPack(Object.values(TEMPLATES),id,"templates");
  s.replaceChildren();
  const opt=(t)=>{ const o=document.createElement("option"); o.value=t.id; o.textContent=t.name; return o; };
  if(featured.length&&rest.length){
    const pack=$("aesthetic")?($("aesthetic").selectedOptions[0]||{}).textContent:null;
    const a=document.createElement("optgroup"); a.label=(pack||"This aesthetic").trim();
    featured.forEach(t=>a.appendChild(opt(t))); s.appendChild(a);
    const b=document.createElement("optgroup"); b.label="Everything else";
    rest.forEach(t=>b.appendChild(opt(t))); s.appendChild(b);
  } else [...featured,...rest].forEach(t=>s.appendChild(opt(t)));
  if(cur)s.value=cur;   /* dom-only: dispatching here would re-render the screen */
  return featured.length+rest.length; }
