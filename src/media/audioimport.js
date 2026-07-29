/* Dead Signal Studio — media/audioimport.js
 *
 * Bringing a recording into the studio.
 *
 * Video and stills could be imported and run through the whole degradation
 * stack; audio could not, so a real recording — a voice memo, a field
 * recording, a piece of music — had no way in. That was the last half of F-09,
 * and it is the difference between generating sound and *processing* sound.
 *
 * The decoded samples are kept as plain Float32Arrays plus their own rate
 * rather than as an AudioBuffer. An AudioBuffer belongs to the context that
 * made it, and the render runs in a fresh OfflineAudioContext at whatever rate
 * the author chose — so the data is resampled into the render's context at use
 * time instead of being smuggled between the two.
 */

let _clip = null;   // { channels: Float32Array[], sampleRate, duration, name }

export const hasImportedAudio = () => !!_clip;
export const importedAudio = () => _clip;
export const importedAudioName = () => (_clip ? _clip.name : '');
export function clearImportedAudio() { _clip = null; }

/** Decode a file into raw channel data. Rejects with a readable reason. */
export async function loadAudioFile(file) {
  if (!file) throw new Error('no file');
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error('this browser has no Web Audio support');

  const bytes = await file.arrayBuffer();
  const ctx = new Ctx();
  let buf;
  try {
    // decodeAudioData is callback-based in older Safari; the promise form is
    // fine everywhere this tool already requires (it needs WebCodecs-era APIs).
    buf = await ctx.decodeAudioData(bytes);
  } catch (e) {
    throw new Error('could not decode that file — try .wav, .mp3, .ogg or .flac');
  } finally {
    try { await ctx.close(); } catch { /* already closed */ }
  }

  const channels = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c).slice());
  _clip = {
    channels,
    sampleRate: buf.sampleRate,
    duration: buf.duration,
    name: (file.name || 'sample').replace(/\.[^.]+$/, ''),
  };
  return _clip;
}

/**
 * The clip as an AudioBuffer belonging to `ctx`.
 *
 * Linear interpolation is enough here: the material is heading through tape
 * wow, bitcrushing and a telephone filter, and a higher-order resampler would
 * be inaudible under any of them.
 *
 * @param {BaseAudioContext} ctx
 * @param {number} [seconds] pad or loop to fill this long; omit for natural length
 * @param {boolean} [loop] repeat rather than pad with silence
 */
export function toBuffer(ctx, seconds, loop = false) {
  if (!_clip) return null;
  const rate = ctx.sampleRate;
  const srcLen = _clip.channels[0].length;
  if (!srcLen) return null;

  const ratio = _clip.sampleRate / rate;
  const natural = Math.max(1, Math.round(srcLen / ratio));
  const outLen = seconds && seconds > 0 ? Math.max(1, Math.round(seconds * rate)) : natural;

  const out = ctx.createBuffer(_clip.channels.length, outLen, rate);
  for (let c = 0; c < _clip.channels.length; c++) {
    const src = _clip.channels[c];
    const dst = out.getChannelData(c);
    for (let i = 0; i < outLen; i++) {
      // Past the end: loop back to the start, or leave silence.
      const idx = loop ? (i % natural) : i;
      if (!loop && idx >= natural) break;
      const pos = idx * ratio;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const a = src[i0] ?? 0;
      const b = src[i0 + 1] ?? a;
      dst[i] = a + (b - a) * frac;
    }
  }
  return out;
}
