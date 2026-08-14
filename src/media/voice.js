/* Dead Signal Studio — media/voice.js
 *
 * Voiceover, straight into the library.
 *
 * WHY THIS EXISTS
 *
 * The material this studio makes is narration-driven — analogue horror is a
 * voice over a broken picture — and the tool could import a voice but not
 * RECORD one. The path ran through some other application: record there,
 * export, find the file, drop it back in. For a scratch VO against a cut
 * ("the door opens… here") that round trip costs more than the take.
 *
 * ⏺ VOICE asks for the microphone, records until pressed again, and lands the
 * take in the library like anything else the tool makes: a `music` row named
 * voiceover, persisted, undoable, ready for the audio lane, a clip bed or the
 * sequence bed.
 *
 * STORED AS WAV, DELIBERATELY. MediaRecorder hands back webm/opus; the take is
 * decoded once here and re-encoded as PCM, because everything downstream —
 * the bed pipeline's decodeAudioData, the campaign bundle's wav/mp3/ogg
 * contract, byte-stable saves — speaks WAV as the master. The decode also
 * yields the real duration, which the recorder's own metadata famously lies
 * about (a webm from MediaRecorder reports Infinity until fully seeked).
 *
 * FAILURE IS LOUD AND CHEAP. No microphone permission, no secure context, no
 * MediaRecorder — each refuses with a toast naming the reason, and no state is
 * left half-armed: the stream is stopped on every exit path, because a tab
 * that keeps the mic light on after a refusal reads as surveillance.
 */

import { log, toast } from '../core/dom.js';
import { encodeWav } from '../audio/wav.js';
import { addToLibrary } from '../library/library.js';

/* A hard ceiling, not a target. A forgotten recorder fills memory at about
   1 MB a minute compressed and far more once decoded; twenty minutes is far
   past any VO take and cheap insurance against "left it running overnight". */
const MAX_SECONDS = 20 * 60;

let _rec = null, _stream = null, _chunks = null, _startedAt = 0, _timer = 0;
let _onState = null;

export const isRecordingVoice = () => !!_rec;

function teardown() {
  if (_timer) { clearInterval(_timer); _timer = 0; }
  if (_stream) { for (const t of _stream.getTracks()) { try { t.stop(); } catch { /* gone */ } } }
  _rec = null; _stream = null; _chunks = null;
  _onState?.(false, 0);
}

/**
 * Start or stop, one entry point — the button's own semantics.
 * @param {function} [onState] (recording:boolean, seconds:number) for the UI.
 */
export async function toggleVoiceRecording(onState) {
  if (_rec) { stopVoiceRecording(); return; }
  _onState = onState || _onState;

  if (!navigator.mediaDevices?.getUserMedia) {
    toast(typeof isSecureContext !== 'undefined' && !isSecureContext
      ? 'The microphone needs a secure context — open the studio over https or localhost'
      : 'This browser has no microphone API', 'err');
    return;
  }
  if (typeof MediaRecorder === 'undefined') {
    toast('This browser has no MediaRecorder — voice recording is unavailable', 'err');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      /* Speech defaults: the processing a voice note wants and a music
         recording would not. This is a VO tool, not a field recorder. */
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    toast(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      ? 'Microphone permission was refused — allow it in the address bar and try again'
      : 'No microphone could be opened' + (e?.message ? ` (${e.message})` : ''), 'err');
    return;
  }
  let rec;
  try {
    rec = new MediaRecorder(stream);
  } catch (e) {
    for (const t of stream.getTracks()) { try { t.stop(); } catch { /* gone */ } }
    toast('Recording could not start' + (e?.message ? ` (${e.message})` : ''), 'err');
    return;
  }
  _stream = stream; _rec = rec; _chunks = [];
  _startedAt = performance.now();
  rec.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) _chunks.push(e.data); });
  rec.addEventListener('error', () => { toast('Recording failed', 'err'); teardown(); });
  rec.addEventListener('stop', () => { void finish(); });
  rec.start(250);
  _onState?.(true, 0);
  _timer = setInterval(() => {
    const s = (performance.now() - _startedAt) / 1000;
    if (s >= MAX_SECONDS) { toast(`Recording stopped at the ${MAX_SECONDS / 60}-minute ceiling`, 'warn'); stopVoiceRecording(); return; }
    _onState?.(true, s);
  }, 500);
  log('Recording from the microphone — press ⏺ again to stop.', 'ok');
}

export function stopVoiceRecording() {
  const rec = _rec;
  if (!rec) return;
  if (_timer) { clearInterval(_timer); _timer = 0; }
  try { rec.stop(); } catch { teardown(); }
}

async function finish() {
  const chunks = _chunks || [];
  const mime = _rec?.mimeType || 'audio/webm';
  teardown();
  if (!chunks.length) { toast('Nothing was recorded', 'warn'); return; }
  const raw = new Blob(chunks, { type: mime });
  try {
    /* Decode once, keep PCM. An OfflineAudioContext cannot decode, so a plain
       AudioContext does — closed immediately after, because each one holds a
       real audio device handle and browsers cap how many a page may have. */
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    let buf;
    try { buf = await ctx.decodeAudioData(await raw.arrayBuffer()); }
    finally { void ctx.close(); }
    const channels = [];
    for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) channels.push(buf.getChannelData(c));
    const blob = encodeWav(channels, buf.sampleRate, 16);
    const it = addToLibrary(blob, 'wav', 'music', 'voiceover', +buf.duration.toFixed(1));
    toast(`Voice take saved — ${buf.duration.toFixed(1)}s, ready on the audio pickers`);
    log(`Voiceover recorded: ${it.name}.wav — ${buf.duration.toFixed(1)}s at ${buf.sampleRate}Hz.`, 'ok');
  } catch (e) {
    toast('The recording could not be decoded — nothing was saved', 'err');
    log('Voiceover decode failed: ' + (e?.message || e), 'err');
  }
}
