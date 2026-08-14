/* Dead Signal Studio — export/audiofile.js
 *
 * The AUDIO tab's file formats. It rendered `.wav` and nothing else — the
 * right master (lossless, byte-stable, what the timeline's beds and the
 * campaign bundle want) and the wrong delivery: ten seconds of 48kHz stereo
 * is 1.9 MB, and nothing that takes an upload wants it. The same WebCodecs
 * AudioEncoder that already puts Opus beside the picture in a WebM and AAC in
 * an MP4 can encode the sound alone; what was missing was a container that
 * means "just audio", so:
 *
 *   wav   audio/wav   the master — untouched, 8/16/24-bit, byte-stable
 *   m4a   audio/mp4   AAC in the MP4 next door — plays essentially everywhere
 *   ogg   audio/ogg   Opus — smallest, open, every current browser
 *
 * The compressed pair degrade the way MP4 video does: where the encoder is
 * missing (no WebCodecs — plain http on a non-localhost address) the export
 * writes a WAV and SAYS SO, and the caller names the file for what was
 * actually written. A working file in the wrong format beats a broken file in
 * the right one, and a silent format swap is worse than either.
 *
 * Bit depth belongs to WAV alone. AAC and Opus are perceptual codecs fed the
 * float render directly — there is no "24-bit AAC" to ask for — so the Bits
 * control keeps meaning what it always meant and simply does not apply here.
 */

import { encodeWav } from '../audio/wav.js';
import { encodeAudioTrack } from './encoder.js';
import { muxM4A } from './mp4.js';
import { muxOggOpus } from './ogg.js';

/** The formats the picker offers, in order. One list, like CONTAINERS. */
export const AUDIO_FILE_FORMATS = [
  { id: 'wav', ext: 'wav', label: 'WAV (lossless)',
    note: 'The master. Byte-stable, honours the Bits control, big.' },
  { id: 'm4a', ext: 'm4a', label: 'M4A (AAC)',
    note: 'Plays essentially everywhere — the one to hand to a phone or an upload.' },
  { id: 'ogg', ext: 'ogg', label: 'OGG (Opus)',
    note: 'Smallest and open. Every current browser, Discord, VLC.' },
];

export const audioFormatOf = (id) =>
  AUDIO_FILE_FORMATS.find((f) => f.id === id) || AUDIO_FILE_FORMATS[0];

/* The encoder wants a 48kHz AudioBuffer; the render is Float32Array channels
   at whatever rate the Rate control chose. One OfflineAudioContext render is
   both the conversion and the resample — the same idiom audio/bed.js uses to
   lift 'last' into the sequence mix, without that module's loop-fitting. */
async function to48k(channels, sr) {
  const RATE = 48000;
  const len = channels[0].length;
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Ctx(channels.length, Math.max(1, Math.round((len / sr) * RATE)), RATE);
  const buf = ctx.createBuffer(channels.length, len, sr);
  channels.forEach((d, i) => buf.copyToChannel(d, i));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

/**
 * Encode the rendered channels as the chosen format.
 *
 * Never throws for a missing encoder: the WAV fallback is the contract, and
 * `note` carries the reason so the caller can put it where the author looks.
 *
 * @param {Float32Array[]} channels  the render (1 or 2 channels)
 * @param {number} sr                its sample rate
 * @param {number} bits              WAV bit depth (ignored by m4a/ogg)
 * @param {string} format            'wav' | 'm4a' | 'ogg'
 * @returns {Promise<{blob:Blob, ext:string, note?:string}>}
 */
export async function encodeAudioFile(channels, sr, bits, format) {
  if (format !== 'm4a' && format !== 'ogg') {
    return { blob: encodeWav(channels, sr, bits), ext: 'wav' };
  }
  try {
    const buffer = await to48k(channels, sr);
    const track = await encodeAudioTrack(buffer, { container: format === 'm4a' ? 'mp4' : 'webm' });
    if (!track) throw new Error('no WebCodecs audio encoder here');
    const blob = format === 'm4a' ? muxM4A(track) : muxOggOpus(track);
    return { blob, ext: format };
  } catch (e) {
    return {
      blob: encodeWav(channels, sr, bits), ext: 'wav',
      note: `.${format} unavailable (${e?.message || e}) — wrote a .wav instead`,
    };
  }
}
