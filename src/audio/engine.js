/* Dead Signal Studio — audio/engine.js */
import { chk, clamp, log, num, pct, toast, val } from '../core/dom.js';
import { resetSeed, rnd } from '../core/rng.js';
import { morseOf, morseSpan } from '../core/text.js';
import { hasImportedAudio, importedAudio, toBuffer } from '../media/audioimport.js';
import { buildLayers, layersNeedSeconds, readLayerCfg } from './layers.js';
import { applyGraphFx, applyPostFx } from './fx.js';
import { SOLO_PATH, applySolo, normalizeSolo, soloNotice } from './solo.js';
import { getStore } from '../doc/session.js';

/** Pan control value (-100..100) as a StereoPanner position (-1..1). */
const panOf=(id)=>clamp(num(id,0)/100,-1,1);
export function readAudioCfg(){ const cfg={
  duration:clamp(num("a-dur",8),1,60), sr:+val("a-sr")||22050, bits:+val("a-bits")||16, fade:clamp(num("a-fade",0.4),0,5), loop:chk("a-loop"),
  // 1 = mono. Stereo is the default: pans, drone spread and the width control
  // all collapse to nothing in mono, so mono is the reduced case, not the base.
  channels:(val("a-channels")==="1"?1:2),
  pan:{ drone:panOf("a-drone-pan"), noise:panOf("a-noise-pan"), pulse:panOf("a-pulse-pan"),
        morse:panOf("a-morse-pan"), sub:panOf("a-sub-pan"), heart:panOf("a-heart-pan"),
        geiger:panOf("a-geiger-pan"), dtmf:panOf("a-dtmf-pan"), dial:panOf("a-dial-pan"),
        sample:panOf("a-sample-pan") },
  sample:chk("a-sample"), sampleG:pct("a-sample-g"), sampleLoop:chk("a-sample-loop"),
  width:chk("fx-width"), widthA:clamp(num("fx-width-a",100),0,200)/100,
  drone:chk("a-drone"), droneF:num("a-drone-f",70), droneW:val("a-drone-w"), droneG:pct("a-drone-g"), droneVoices:clamp(num("a-drone-voices",1),1,9), droneDet:num("a-drone-det",0),
  droneSpread:clamp(num("a-drone-spread",0),0,100)/100,
  noise:chk("a-noise"), noiseG:pct("a-noise-g"), noiseLP:num("a-noise-lp",1200),
  pulse:chk("a-pulse"), pulseN:clamp(num("a-pulse-n",47),1,200), pulseF:num("a-pulse-f",440), pulseRate:clamp(num("a-pulse-rate",4),1,12),
  morse:chk("a-morse"), morseW:val("a-morse-w").trim(), morseF:num("a-morse-f",620), morseU:clamp(num("a-morse-u",0.09),0.03,0.4),
  sub:chk("a-sub"), subF:num("a-sub-f",30), heart:chk("a-heart"), heartBpm:clamp(num("a-heart-bpm",60),30,180),
  geiger:chk("a-geiger"), geigerRate:clamp(num("a-geiger-rate",6),1,60), dtmf:chk("a-dtmf"), dtmfD:val("a-dtmf-d").replace(/[^0-9*#]/g,""), dial:chk("a-dial"),
  ring:chk("fx-ring"), ringF:num("fx-ring-f",30), trem:chk("fx-trem"), tremF:num("fx-trem-f",5),
  wow:chk("fx-wow"), wowD:pct("fx-wow-d"), dist:chk("fx-dist"), distD:pct("fx-dist-d"),
  delay:chk("fx-delay"), delayT:num("fx-delay-t",0.25), delayFb:pct("fx-delay-fb"),
  reverb:chk("fx-reverb"), reverbD:num("fx-reverb-d",2.2), phone:chk("fx-phone"), limit:chk("fx-limit"),
  crush:chk("fx-crush"), crushB:clamp(num("fx-crush-b",8),1,16),
  /* The registry layers, read as one nested object rather than flattened in
     beside the ten hand-wired ones — a flat namespace is exactly what made
     adding a layer a four-file edit. */
  layers: readLayerCfg({ chk, num, val }),
  /* The FX chain lives in the document rather than in controls, exactly like
     the video filter chain — it is an ordered list, and a list is not a set of
     checkboxes. Read straight from the store so a headless render sees it too. */
  fx: (getStore()?.get('filters.audio')) || [],
  /* The solo set, kept on the config so the render can say out loud which
     sources it silenced. */
  solo: normalizeSolo(getStore()?.get(SOLO_PATH)),
};
  /* Last, so everything downstream — the auto-extend below, layersNeedSeconds,
     buildLayers, the readouts — agrees about what is playing. A soloed drone
     must not stretch the render to fit a dial-up sequence that is checked but
     muted. */
  return applySolo(cfg, cfg.solo); }
export const DTMF={"1":[697,1209],"2":[697,1336],"3":[697,1477],"4":[770,1209],"5":[770,1336],"6":[770,1477],"7":[852,1209],"8":[852,1336],"9":[852,1477],"*":[941,1209],"0":[941,1336],"#":[941,1477]};
export function noiseBuffer(ctx,dur){ const b=ctx.createBuffer(1,Math.max(1,Math.ceil(ctx.sampleRate*dur)),ctx.sampleRate); const d=b.getChannelData(0);
  for(let i=0;i<d.length;i++) d[i]=rnd()*2-1; return b; }
export function genIR(ctx,decay){ const len=Math.max(1,Math.ceil(ctx.sampleRate*decay)); const b=ctx.createBuffer(1,len,ctx.sampleRate); const d=b.getChannelData(0);
  for(let i=0;i<len;i++){ d[i]=(rnd()*2-1)*Math.pow(1-i/len,2.5); } return b; }
export function curveDist(amt){ const k=amt*100+1, n=1024, c=new Float32Array(n); for(let i=0;i<n;i++){ const x=i/n*2-1; c[i]=(1+k)*x/(1+k*Math.abs(x)); } return c; }
export async function renderAudio(){
  resetSeed(); const cfg=readAudioCfg(); let dur=cfg.duration;
  // Said on every render, not once when solo is switched on: the render is the
  // export, so "I forgot solo was on" has to be impossible rather than unlikely.
  const notice=soloNotice(cfg.solo,cfg); if(notice) log(notice,"warn");
  if(cfg.dial) dur=Math.max(dur,6.5);
  if(cfg.pulse){ const st=1/cfg.pulseRate, on=Math.min(st*0.4,0.12); dur=Math.max(dur,0.3+(cfg.pulseN-1)*st+on+0.3); }
  if(cfg.morse&&cfg.morseW) dur=Math.max(dur,0.3+morseSpan(cfg.morseW,cfg.morseU)+0.3);
  if(cfg.dtmf&&cfg.dtmfD) dur=Math.max(dur,0.5+cfg.dtmfD.length*0.23+0.3);
  // Registry layers that place content at an author-chosen time get the same
  // courtesy the four above already had.
  dur=Math.max(dur, layersNeedSeconds(cfg.layers));
  // An imported clip sets the floor unless it is looping, so importing a
  // 30-second recording into an 8-second render does not silently truncate it.
  // Same gate as the scheduling below — a clip enabled at gain 0 must not
  // stretch the render to fit audio that will never be played.
  if(cfg.sample&&cfg.sampleG>0&&!cfg.sampleLoop&&hasImportedAudio()) dur=Math.max(dur,importedAudio().duration+0.2);
  const DUR_CAP=120; if(dur>DUR_CAP){ log("Content would need "+dur.toFixed(0)+"s; capped at "+DUR_CAP+"s (some pulses/morse will be trimmed).","warn"); toast("Render capped at "+DUR_CAP+"s","err"); dur=DUR_CAP; }
  if(dur>cfg.duration+0.05) log("Auto-extended render to "+dur.toFixed(1)+"s so all content fits.","info");
  const renderDur = cfg.loop ? dur+Math.min(1.5,dur*0.25) : dur;
  const OAC=window.OfflineAudioContext||window.webkitOfflineAudioContext; if(!OAC){ log("OfflineAudioContext unavailable.","err"); return null; }
  const ctx=new OAC(cfg.channels,Math.ceil(cfg.sr*renderDur),cfg.sr);
  const layers=ctx.createGain(); layers.gain.value=1;

  /* A layer's own place in the stereo field. Every layer routes through one of
     these instead of straight into the sum, which is what makes the field an
     arrangement rather than one point source. In mono, or with the pan centred,
     it returns the sum itself so no node is created at all. */
  const stereo = cfg.channels>1;
  const bus=(pan)=>{
    if(!stereo || !pan || typeof ctx.createStereoPanner!=="function") return layers;
    const p=ctx.createStereoPanner(); p.pan.value=pan; p.connect(layers); return p;
  };

  if(cfg.drone&&cfg.droneG>0){ const droneBus=bus(cfg.pan.drone);
    for(let v=0;v<cfg.droneVoices;v++){ const o=ctx.createOscillator(); o.type=cfg.droneW; o.frequency.value=cfg.droneF;
    const off=(cfg.droneVoices>1?(v-(cfg.droneVoices-1)/2):0);
    o.detune.value=off*cfg.droneDet; const g=ctx.createGain(); g.gain.value=(cfg.droneG*0.5)/cfg.droneVoices;
    // Detuned voices fanned across the field — the classic wide-pad trick, and
    // the reason a drone sounds like a room rather than a speaker.
    let tail=g;
    if(stereo && cfg.droneSpread>0 && cfg.droneVoices>1 && typeof ctx.createStereoPanner==="function"){
      const vp=ctx.createStereoPanner();
      vp.pan.value=clamp((off/((cfg.droneVoices-1)/2))*cfg.droneSpread,-1,1);
      g.connect(vp); tail=vp;
    }
    o.connect(g); tail.connect(droneBus); o.start(0); o.stop(renderDur); } }
  if(cfg.noise&&cfg.noiseG>0){ const src=ctx.createBufferSource(); src.buffer=noiseBuffer(ctx,renderDur);
    const lp=ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=cfg.noiseLP; const g=ctx.createGain(); g.gain.value=cfg.noiseG*0.5;
    src.connect(lp).connect(g).connect(bus(cfg.pan.noise)); src.start(0); src.stop(renderDur); }
  if(cfg.pulse){ const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=cfg.pulseF; const g=ctx.createGain(); g.gain.value=0.0001; o.connect(g).connect(bus(cfg.pan.pulse)); o.start(0);
    const step=1/cfg.pulseRate, on=Math.min(step*0.4,0.12); for(let i=0;i<cfg.pulseN;i++){ const t=0.3+i*step; if(t+on>=renderDur)break;
      g.gain.setValueAtTime(0.0001,t); g.gain.linearRampToValueAtTime(0.55,t+0.004); g.gain.setValueAtTime(0.55,t+on); g.gain.linearRampToValueAtTime(0.0001,t+on+0.01); } o.stop(renderDur); }
  if(cfg.morse&&cfg.morseW){ scheduleMorse(ctx,bus(cfg.pan.morse),cfg.morseW,cfg.morseF,cfg.morseU,0.3); }
  if(cfg.sub){ const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=cfg.subF; const g=ctx.createGain(); g.gain.value=0.0001; o.connect(g).connect(bus(cfg.pan.sub)); o.start(0);
    g.gain.setValueAtTime(0.0001,0); g.gain.linearRampToValueAtTime(0.5,1); const lfo=ctx.createOscillator(); lfo.frequency.value=0.2; const lg=ctx.createGain(); lg.gain.value=0.15; lfo.connect(lg).connect(g.gain); lfo.start(0); lfo.stop(renderDur); o.stop(renderDur); }
  if(cfg.heart){ const hb=bus(cfg.pan.heart); const spb=60/cfg.heartBpm; for(let t=0.2;t<renderDur;t+=spb){ heartThump(ctx,hb,t); heartThump(ctx,hb,t+spb*0.32,0.7); } }
  if(cfg.geiger){ const gb=bus(cfg.pan.geiger); let t=0.2; while(t<renderDur){ t+=-Math.log(1-rnd())/cfg.geigerRate; if(t>=renderDur)break; click(ctx,gb,t); } }
  if(cfg.dtmf&&cfg.dtmfD){ const db=bus(cfg.pan.dtmf); let t=0.3; for(const dg of cfg.dtmfD){ const f=DTMF[dg]; if(!f){t+=0.23;continue;} tone(ctx,db,f[0],0.2,t,t+0.14); tone(ctx,db,f[1],0.2,t,t+0.14); t+=0.23; } }
  if(cfg.dial){ scheduleDialup(ctx,bus(cfg.pan.dial),renderDur); }
  // Registry layers. Same `bus(pan)` as everything above, so they sit in the
  // same stereo field and go through the same master FX chain.
  buildLayers({ ctx, bus, cfg:cfg.layers, dur:renderDur, rnd,
    helpers:{ noiseBuffer, tone, click }, log });
  if(cfg.sample&&cfg.sampleG>0&&hasImportedAudio()){
    const buf=toBuffer(ctx, cfg.sampleLoop?renderDur:0, cfg.sampleLoop);
    if(buf){ const src=ctx.createBufferSource(); src.buffer=buf;
      const g=ctx.createGain(); g.gain.value=cfg.sampleG;
      src.connect(g).connect(bus(cfg.pan.sample)); src.start(0);
      try{ src.stop(renderDur); }catch(e){} } }

  // ---- master FX bus ----
  let node=layers;
  if(cfg.ring){ const rg=ctx.createGain(); rg.gain.value=0; const car=ctx.createOscillator(); car.frequency.value=cfg.ringF; car.connect(rg.gain); car.start(0); car.stop(renderDur); node.connect(rg); node=rg; }
  if(cfg.trem){ const tg=ctx.createGain(); tg.gain.value=0.6; const lfo=ctx.createOscillator(); lfo.frequency.value=cfg.tremF; const la=ctx.createGain(); la.gain.value=0.4; lfo.connect(la).connect(tg.gain); lfo.start(0); lfo.stop(renderDur); node.connect(tg); node=tg; }
  if(cfg.wow){ const dl=ctx.createDelay(0.05); dl.delayTime.value=0.01; const lfo=ctx.createOscillator(); lfo.frequency.value=1.2; const la=ctx.createGain(); la.gain.value=cfg.wowD*0.004; lfo.connect(la).connect(dl.delayTime); lfo.start(0); lfo.stop(renderDur);
    const lfo2=ctx.createOscillator(); lfo2.frequency.value=8; const la2=ctx.createGain(); la2.gain.value=cfg.wowD*0.0012; lfo2.connect(la2).connect(dl.delayTime); lfo2.start(0); lfo2.stop(renderDur); node.connect(dl); node=dl; }
  if(cfg.dist){ const ws=ctx.createWaveShaper(); ws.curve=curveDist(cfg.distD); ws.oversample="4x"; const og=ctx.createGain(); og.gain.value=0.7; node.connect(ws).connect(og); node=og; }
  if(cfg.delay){ const dl=ctx.createDelay(2.0); dl.delayTime.value=clamp(cfg.delayT,0.02,1.5); const fb=ctx.createGain(); fb.gain.value=cfg.delayFb*0.9; const lp=ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=2400;
    const wet=ctx.createGain(); wet.gain.value=0.5; const sum=ctx.createGain(); node.connect(sum); node.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(sum); node=sum; }
  if(cfg.reverb){ const cv=ctx.createConvolver(); cv.buffer=genIR(ctx,cfg.reverbD); const wet=ctx.createGain(); wet.gain.value=0.5; const dry=ctx.createGain(); dry.gain.value=0.8; const sum=ctx.createGain();
    node.connect(dry).connect(sum); node.connect(cv).connect(wet).connect(sum); node=sum; }
  if(cfg.phone){ const bp=ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=1400; bp.Q.value=0.7; const hp=ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=300; const lp=ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=3400; node.connect(hp).connect(lp).connect(bp); node=bp; }
  if(cfg.limit){ const comp=ctx.createDynamicsCompressor(); comp.threshold.value=-6; comp.ratio.value=12; comp.attack.value=0.003; comp.release.value=0.2; node.connect(comp); node=comp; }
  // Stereo width, last of the FIXED bus so it acts on the finished mix.
  if(stereo && cfg.width) node=midSideWidth(ctx,node,cfg.widthA);
  /* The chain runs after the fixed bus, so it composes ON TOP of it rather than
     replacing it — the same relationship the video filter chain has with the
     built-in CRT stack. An empty chain is a true no-op. */
  node=applyGraphFx(ctx,node,cfg.fx,renderDur,log);
  node.connect(ctx.destination);

  // fades are applied post-render on the rendered buffer (keeps the graph simple)
  const rendered=await ctx.startRendering();
  // Post-processing runs per channel with IDENTICAL parameters — the loop point,
  // the fade length and the crush step must be the same on both, or the stereo
  // image drifts across the fade and the loop seam stops lining up.
  let channels=[];
  for(let c=0;c<rendered.numberOfChannels;c++) channels.push(rendered.getChannelData(c));
  if(cfg.crush){ const q=Math.pow(2,cfg.crushB);
    for(const d of channels) for(let i=0;i<d.length;i++){ d[i]=Math.round(d[i]*q)/q; } }
  /* Post effects run here, BEFORE the loop crossfade and the fades: a stutter
     that fired after the crossfade would break the seam it just made, and one
     that fired after the fades would put full-level audio back over them. */
  channels=applyPostFx(channels,cfg.sr,dur,cfg.fx,rnd,log);
  if(cfg.loop) channels=channels.map(d=>loopCrossfade(d,cfg.sr,dur));
  const len=channels[0].length;
  /* A loop must sit at full level at both ends — the crossfade just made the
     seam continuous, and an edge fade on top would dip every repeat through
     ~2×fade seconds of silence, which is exactly the artifact loop mode exists
     to remove. So fades apply only to a non-looping render. */
  if(!cfg.loop){
    applyEdgeFades(channels,cfg.sr,cfg.fade);
  } else if(cfg.fade>0) log("Loop xf on: edge fades skipped so the loop stays seamless.","info");
  // `data` stays the first channel so the audio-reactive scene and the waveform
  // keep working unchanged; it is the same Float32Array, not a copy, so
  // normalising in place updates both.
  return {sr:cfg.sr, bits:cfg.bits, channels, data:channels[0],
          duration:len/cfg.sr};
}
/**
 * Ramp the first and last `fade` seconds of every channel, in place.
 *
 * Extracted so it can be applied AGAIN after a region edit changes the length.
 * "Crop to" throws away the buffer's original ends — including the fade that
 * was ramped onto them — and what is left starts and stops mid-signal, so every
 * cropped render came out with a click at both edges and the Fade control the
 * author had set was silently not honoured. Capped at half the buffer, so a
 * fade longer than the material ramps up to the middle and straight back down
 * rather than overlapping itself.
 */
export function applyEdgeFades(channels,sr,fadeSec){
  if(!(fadeSec>0) || !channels?.length) return channels;
  const len=channels[0].length;
  if(!len) return channels;
  const nf=Math.floor(Math.min(fadeSec,(len/sr)/2)*sr);
  if(nf<1) return channels;
  for(const d of channels) for(let i=0;i<nf;i++){ const g=i/nf; d[i]*=g; d[len-1-i]*=g; }
  return channels;
}
/**
 * Mid/side width.
 *
 * M is what both speakers agree on, S is what they disagree about. Scaling only
 * S widens or narrows the image without touching what is in the middle — which
 * is why this is the control mixers reach for rather than panning everything
 * further out, and why width 0 collapses to mono without changing the level of
 * anything centred.
 */
export function midSideWidth(ctx,node,width){
  const split=ctx.createChannelSplitter(2);
  const merge=ctx.createChannelMerger(2);
  const g=(v)=>{ const n=ctx.createGain(); n.gain.value=v; return n; };
  /* A ChannelSplitterNode is `explicit`/`discrete` by specification, so a MONO
     input arrives at it with channel 1 as SILENCE rather than as a copy of
     channel 0. The maths below then gets side = 0.5·L, and
     outR = mid − width·side = 0.5·L·(1 − width) — which at the shipped default
     of width 1 is exactly zero. A mix with nothing panned came out of the right
     speaker as nothing at all, and at width 0 (the "collapse to mono" setting)
     came out 6 dB quiet in both.
     So up-mix first, with `speakers` interpretation: mono arrives as L = R = the
     signal, side is zero, and width correctly does nothing to a centred source
     instead of deleting half of it. */
  const stereoIn=ctx.createGain();
  stereoIn.channelCount=2;
  stereoIn.channelCountMode="explicit";
  stereoIn.channelInterpretation="speakers";
  node.connect(stereoIn);
  node=stereoIn;
  node.connect(split);
  const mid=g(1), side=g(1);
  const lM=g(0.5), rM=g(0.5), lS=g(0.5), rS=g(-0.5);
  split.connect(lM,0); split.connect(rM,1); lM.connect(mid); rM.connect(mid);
  split.connect(lS,0); split.connect(rS,1); lS.connect(side); rS.connect(side);
  const outL=g(1), outR=g(1);
  const sL=g(width), sR=g(-width);
  mid.connect(outL); side.connect(sL).connect(outL);
  mid.connect(outR); side.connect(sR).connect(outR);
  outL.connect(merge,0,0); outR.connect(merge,0,1);
  return merge;
}
export function loopCrossfade(data,sr,loopDur){ const N=Math.floor(loopDur*sr); const xf=Math.min(Math.floor(0.4*sr), Math.floor(N*0.2));
  const out=new Float32Array(N); for(let i=0;i<N;i++) out[i]=data[i]||0;
  /* At the loop point (i=0) the output must BE the tail continuation data[N] —
     that is what makes out[N-1] -> out[0] continuous — and then fade over to
     head material by i=xf so out[xf-1] -> out[xf] is continuous too. So the
     head weight rises (sin) while the tail weight falls (cos); equal-power. */
  for(let i=0;i<xf;i++){ const a=Math.sin(i/xf*Math.PI/2), b=Math.cos(i/xf*Math.PI/2); out[i]=out[i]*a + (data[N+i]||0)*b; }
  return out; }
export function tone(ctx,dest,f,a,s,e){ const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=f; const g=ctx.createGain(); g.gain.value=0; o.connect(g).connect(dest); o.start(s);
  g.gain.setValueAtTime(0.0001,s); g.gain.linearRampToValueAtTime(a,s+0.01); g.gain.setValueAtTime(a,e-0.01); g.gain.linearRampToValueAtTime(0.0001,e); o.stop(e+0.05); }
export function click(ctx,dest,t){ const b=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*0.02),ctx.sampleRate); const d=b.getChannelData(0);
  for(let i=0;i<d.length;i++) d[i]=(rnd()*2-1)*Math.pow(1-i/d.length,8); const s=ctx.createBufferSource(); s.buffer=b; const g=ctx.createGain(); g.gain.value=0.5; s.connect(g).connect(dest); s.start(t); }
export function heartThump(ctx,dest,t,amp){ amp=amp||1; const o=ctx.createOscillator(); o.type="sine"; o.frequency.setValueAtTime(70,t); o.frequency.exponentialRampToValueAtTime(45,t+0.12);
  const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.linearRampToValueAtTime(0.6*amp,t+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t+0.14); o.connect(g).connect(dest); o.start(t); o.stop(t+0.16); }
export function scheduleMorse(ctx,dest,word,freq,unit,startAt){ const code=morseOf(word); let t=startAt; const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=freq; const g=ctx.createGain(); g.gain.value=0; o.connect(g).connect(dest); o.start(startAt); let end=startAt;
  for(const ch of code){ if(ch==="."){ g.gain.setValueAtTime(0.0001,t); g.gain.linearRampToValueAtTime(0.5,t+0.005); g.gain.setValueAtTime(0.5,t+unit); g.gain.linearRampToValueAtTime(0.0001,t+unit+0.005); t+=unit*2; }
    else if(ch==="-"){ g.gain.setValueAtTime(0.0001,t); g.gain.linearRampToValueAtTime(0.5,t+0.005); g.gain.setValueAtTime(0.5,t+unit*3); g.gain.linearRampToValueAtTime(0.0001,t+unit*3+0.005); t+=unit*4; }
    else if(ch===" ") t+=unit*2; else if(ch==="/") t+=unit*6; end=t; } o.stop(end+0.1); }
export function scheduleDialup(ctx,dest,dur){ tone(ctx,dest,350,0.18,0.1,1.2); tone(ctx,dest,440,0.18,0.1,1.2); const seq=[697,770,852,941,1209,1336]; let t=1.4;
  seq.forEach(f=>{ tone(ctx,dest,f,0.16,t,t+0.12); t+=0.18; }); tone(ctx,dest,1600,0.14,t+0.1,t+1.1); tone(ctx,dest,1800,0.10,t+0.1,t+1.1);
  const b=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*0.9),ctx.sampleRate); const d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=(rnd()*2-1)*0.35;
  const s=ctx.createBufferSource(); s.buffer=b; const sg=ctx.createGain(); sg.gain.value=0.25; s.connect(sg).connect(dest); s.start(t+0.2); s.stop(t+1.1); tone(ctx,dest,80,0.20,t+1.2,Math.min(dur,t+3)); }
