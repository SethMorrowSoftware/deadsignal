/* Dead Signal Studio — core/rng.js */
import { val } from './dom.js';

export let _rngState = 1947>>>0;
export let _baseSeed = 1947>>>0, _frameIndex = 0;
export function seedRng(s){ _rngState=(s>>>0)||1; }
export function rnd(){ // mulberry32
  _rngState|=0; _rngState=(_rngState+0x6D2B79F5)|0;
  let t=Math.imul(_rngState^(_rngState>>>15), 1|_rngState);
  t=(t+Math.imul(t^(t>>>7), 61|t))^t;
  return ((t^(t>>>14))>>>0)/4294967296;
}
export const rrange=(a,b)=>a+(b-a)*rnd();
export const rint=(a,b)=>Math.floor(rrange(a,b+1));
export function currentSeed(){ return (parseInt(val("seed"),10)||0)>>>0; }
/* 32-bit mix of (seed, frame, stream name) -> that stream's start state. */
export function hash32(seed, frame, name){
  let h=(seed>>>0)^Math.imul(frame>>>0, 0x9E3779B1);
  for(let i=0;i<name.length;i++) h=Math.imul(h^name.charCodeAt(i), 0x85EBCA6B)>>>0;
  h^=h>>>15; h=Math.imul(h,0x2545F491)>>>0; h^=h>>>13;
  return (h>>>0)||1;
}
/* Establishes the random context for one rendered frame. Called by
   renderVideoFrame(), so every preview / record / timeline path gets it. */
export function beginFrame(frameIndex){ _baseSeed=currentSeed(); _frameIndex=frameIndex>>>0; seedRng(hash32(_baseSeed,_frameIndex,"frame")); }
/* A stream that VARIES with the frame — animated grain, static, tearing. */
export function seedStream(name){ seedRng(hash32(_baseSeed,_frameIndex,name)); }
/* A stream that is CONSTANT across frames — stable per-scene layout. */
export function seedStatic(name){ seedRng(hash32(_baseSeed,0,name)); }
/* Whole-render reset, for the one-shot paths (audio, randomize). */
export function resetSeed(){ _baseSeed=currentSeed(); _frameIndex=0; seedRng(_baseSeed); }
/* Run `fn` with this frame's randomness re-addressed.
 *
 * Streams are keyed on (seed, frame, name), and a scene always asks for the
 * same names — so stacking Digital Rain twice drew the SAME rain twice and the
 * second layer only brightened the first. Offsetting the seed for the duration
 * of one layer's draw makes it a genuinely different roll of the same scene,
 * which is what stacking is for. Restores both the base seed and the live
 * stream state, so nothing after it can observe that this happened. */
export function withSeedOffset(offset, fn){
  const n=offset|0;
  if(!n) return fn();
  const prevBase=_baseSeed, prevState=_rngState;
  _baseSeed=hash32(prevBase,0,"layer:"+n);
  seedRng(hash32(_baseSeed,_frameIndex,"frame"));
  try{ return fn(); } finally{ _baseSeed=prevBase; _rngState=prevState; }
}
/* ---------- console + toasts ---------- */
