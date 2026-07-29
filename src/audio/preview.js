/* Dead Signal Studio — audio/preview.js
 *
 * Hearing the sequence while you cut it.
 *
 * WHY THIS EXISTS
 *
 * The sequence preview was silent. Every piece of the sound existed — the
 * sequence bed, each clip's bed, the whole A1 lane with its gains and pans, and
 * a mixer that folds all of it into one buffer — but only the EXPORT ever built
 * it. So the only way to hear whether a cut landed on the beat was to render the
 * file and play it back somewhere else, and if it was wrong you did that again.
 * Cutting to sound you cannot hear is not editing, it is guessing.
 *
 * THE ONE DECISION EVERYTHING ELSE FOLLOWS FROM
 *
 * The PICTURE FOLLOWS THE AUDIO CLOCK, not the other way round.
 *
 * Two clocks that both mean "where are we in the sequence" — performance.now()
 * for the frames and AudioContext.currentTime for the samples — do not agree,
 * and they do not disagree by a constant either: an AudioContext runs on the
 * sound card's clock, which drifts against the system clock by a few parts per
 * million, and the render loop drops frames under load while the audio hardware
 * never does. Drive the picture from wall time and a two-minute sequence ends
 * visibly out of lip-sync with itself, with no single frame you could point at
 * as the moment it went wrong.
 *
 * So `sequenceAudioTime()` is the master when sound is playing, and the render
 * loop falls back to wall time only when it is not. A dropped frame then costs a
 * dropped frame rather than accumulating into a sync error.
 *
 * WHY THE CONTEXT IS ONLY CREATED ON A GESTURE
 *
 * Browsers refuse to start audio that no one asked for: a context constructed
 * without a user gesture is born `suspended`, and — this is the part that bites
 * — a suspended context's `currentTime` DOES NOT ADVANCE. Because the picture
 * follows that clock, starting a source on a suspended context would not merely
 * be silent, it would freeze the preview on frame one. That failure mode is why
 * `armSequenceAudio()` is async and why nothing here takes over the clock until
 * the context reports `running`.
 *
 * WHY THE PREFERENCE IS NOT DOCUMENT STATE
 *
 * Whether YOUR speakers are on is not part of the project, exactly as the zoom
 * level is not (see ui/timescale.js). It must not dirty the document, must not
 * enter the undo stack, and must not travel to whoever opens the share link. It
 * is remembered per browser, like the skin and the editor mode.
 *
 * No imports on purpose: this is a state machine over one AudioContext, and
 * keeping it free of the DOM helpers means the headless suite can drive the
 * whole of it against a fake context.
 */

const KEY = 'deadsignal.studio.previewsound';
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/* On by default. It cannot make a sound before the author has clicked something
   in the editor — that is the autoplay policy, and it is exactly the guarantee
   that makes defaulting to on safe. */
let _on = lsGet(KEY, '1') !== '0';

let _ctx = null;      // the one context, created lazily on a gesture
let _src = null;      // the live BufferSource, or null
let _t0 = 0;          // ctx.currentTime when the source started
let _off = 0;         // sequence seconds playing at _t0
let _total = 0;       // the buffer's length, which IS the sequence length
let _playing = false;

/** Is preview sound wanted? (Not "is it audible" — see sequenceAudioReady.) */
export const previewSoundOn = () => _on;

/**
 * Turn preview sound on or off, and remember it.
 *
 * Turning it off stops immediately rather than muting a gain node: a mixdown
 * left running behind a muted node still holds the clock, so the picture would
 * keep following a track nobody can hear.
 */
export function setPreviewSound(on) {
  _on = !!on;
  lsSet(KEY, _on ? '1' : '0');
  if (!_on) stopSequenceAudio();
  return _on;
}

/**
 * Create (or wake) the context. MUST be called from a user gesture.
 *
 * Resolves to the context only once it is genuinely `running`; null otherwise,
 * which the caller reads as "stay on the wall clock". The `new` and the
 * `resume()` both happen before the first await so they are still inside the
 * gesture as far as the browser is concerned.
 */
export async function armSequenceAudio() {
  if (!_on) return null;
  let resuming = null;
  /* A context the browser closed on us can never be resumed — every later
     arm() would ask a dead object to wake up and hand back null forever, and
     preview sound would be silently gone for the rest of the session. Drop it
     and build a new one; this call is already inside a gesture. */
  if (_ctx && _ctx.state === 'closed') { _ctx = null; _total = 0; _playing = false; }
  if (!_ctx) {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    try { _ctx = new AC(); } catch { return null; }
  }
  /* Not a sample rate we chose: asking for 48k to match the mixdown throws on
     hardware that will not run at it, and Web Audio resamples a buffer to the
     context rate on playback anyway. A context that exists beats one that is
     exactly right. */
  if (_ctx.state !== 'running') { try { resuming = _ctx.resume(); } catch { /* closed */ } }
  if (resuming) { try { await resuming; } catch { /* still blocked */ } }
  return _ctx.state === 'running' ? _ctx : null;
}

/** True when a context exists and is actually running — i.e. its clock moves. */
export const sequenceAudioReady = () => !!_ctx && _ctx.state === 'running';

/**
 * Play `buffer` as the sequence, from `offset` seconds in.
 *
 * The buffer IS the whole sequence — one mixdown, exactly `total` seconds long —
 * so looping it is the preview's loop, sample-accurate and free. Building a
 * scheduler that restarted each part every lap would drift a little more on
 * every pass and would need re-scheduling on every edit.
 *
 * Returns false when it could not take over the clock, which is not a failure to
 * report: the caller simply stays on wall time and the picture keeps playing.
 */
export function startSequenceAudio(buffer, offset = 0) {
  stopSequenceAudio();
  if (!_on || !_ctx || !buffer || !(buffer.duration > 0)) return false;
  /* The whole reason arm() is async. A source started on a suspended context
     makes no sound AND freezes the clock the picture follows, so refusing here
     is what keeps a blocked context costing nothing but silence. */
  if (_ctx.state !== 'running') { try { _ctx.resume(); } catch { /* closed */ } return false; }
  const dur = buffer.duration;
  const from = ((Number.isFinite(+offset) ? +offset : 0) % dur + dur) % dur;
  let src;
  try {
    src = _ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(_ctx.destination);
    src.start(0, from);
  } catch {
    try { src?.disconnect(); } catch { /* never connected */ }
    return false;
  }
  _src = src; _total = dur; _off = from; _t0 = _ctx.currentTime; _playing = true;
  return true;
}

/** Stop, keeping the context alive so the next play needs no new gesture. */
export function stopSequenceAudio() {
  if (_src) {
    try { _src.stop(); } catch { /* never started */ }
    try { _src.disconnect(); } catch { /* already gone */ }
  }
  _src = null; _playing = false;
  return true;
}

/**
 * Where the sequence is, in seconds, according to the sound — or null when
 * sound is not the clock and the caller should use wall time.
 */
export function sequenceAudioTime() {
  if (!_playing || !_ctx || !(_total > 0)) return null;
  // A context the browser suspended under us (tab hidden, device asleep) has a
  // frozen clock; reporting it would pin the picture to one frame forever.
  if (_ctx.state !== 'running') return null;
  const t = (_ctx.currentTime - _t0) + _off;
  return ((t % _total) + _total) % _total;
}

/** Give the hardware back. The next arm() builds a fresh context. */
export async function closeSequenceAudio() {
  stopSequenceAudio();
  const ctx = _ctx;
  _ctx = null; _total = 0; _off = 0; _t0 = 0;
  if (ctx) { try { await ctx.close(); } catch { /* already closed */ } }
  return true;
}

/** A snapshot for diagnostics and for the suites. */
export function previewAudioState() {
  return {
    enabled: _on,
    context: _ctx ? _ctx.state : 'none',
    playing: _playing,
    offset: _off,
    total: _total,
  };
}
