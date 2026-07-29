/* Dead Signal Studio — image/chrome95.js */
import { esc } from '../core/dom.js';
import { setFont } from '../core/text.js';

export function bevel(ctx,x,y,w,h,raised){ ctx.save(); ctx.lineWidth=1; const lt=raised?"#ffffff":"#404040", br=raised?"#404040":"#ffffff";
  ctx.strokeStyle=lt; ctx.beginPath(); ctx.moveTo(x,y+h); ctx.lineTo(x,y); ctx.lineTo(x+w,y); ctx.stroke();
  ctx.strokeStyle=br; ctx.beginPath(); ctx.moveTo(x+w,y); ctx.lineTo(x+w,y+h); ctx.lineTo(x,y+h); ctx.stroke(); ctx.restore(); }
export function win95(ctx,x,y,w,h,title,active){ ctx.fillStyle="#c0c0c0"; ctx.fillRect(x,y,w,h); bevel(ctx,x,y,w,h,true);
  const tb=y+3; ctx.fillStyle=active?"#000080":"#808080"; const g=ctx.createLinearGradient(x,0,x+w,0); g.addColorStop(0,active?"#000080":"#808080"); g.addColorStop(1,active?"#1084d0":"#a0a0a0"); ctx.fillStyle=g; ctx.fillRect(x+3,tb,w-6,18);
  ctx.fillStyle="#fff"; setFont(ctx,12); ctx.textBaseline="middle"; ctx.textAlign="left"; ctx.fillText(esc(title),x+8,tb+10);
  for(let i=0;i<3;i++){ const bx=x+w-18-(i*18); ctx.fillStyle="#c0c0c0"; ctx.fillRect(bx,tb+1,16,16); bevel(ctx,bx,tb+1,16,16,true); ctx.fillStyle="#000"; ctx.fillText(["_","□","×"][2-i],bx+4,tb+9); }
  return {cx:x+6,cy:tb+24,cw:w-12,ch:h-30}; }
export function drawIcon(ctx,x,y,type){ ctx.save(); if(type==="stop"){ ctx.fillStyle="#d00"; ctx.beginPath(); for(let i=0;i<8;i++){ const a=i/8*Math.PI*2+Math.PI/8; const r=16; (i?ctx.lineTo:ctx.moveTo).call(ctx,x+16+Math.cos(a)*r,y+16+Math.sin(a)*r);} ctx.closePath(); ctx.fill(); ctx.fillStyle="#fff"; setFont(ctx,18); ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("×",x+16,y+16); }
  else if(type==="warn"){ ctx.fillStyle="#fd0"; ctx.beginPath(); ctx.moveTo(x+16,y); ctx.lineTo(x+32,y+30); ctx.lineTo(x,y+30); ctx.closePath(); ctx.fill(); ctx.fillStyle="#000"; setFont(ctx,20); ctx.textAlign="center"; ctx.fillText("!",x+16,y+26); }
  else { ctx.fillStyle="#00d"; ctx.beginPath(); ctx.arc(x+16,y+16,16,0,7); ctx.fill(); ctx.fillStyle="#fff"; setFont(ctx,20); ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("i",x+16,y+16); } ctx.restore(); }
