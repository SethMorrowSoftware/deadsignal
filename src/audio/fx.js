/* Dead Signal Studio — audio/fx.js
 *
 * The audio FX chain: an ordered, reorderable list of effects applied after the
 * fixed master bus.
 *
 * The bus (ring-mod, tremolo, wow/flutter, distortion, delay, reverb, telephone,
 * bitcrush, limiter, width) is a FIXED set in a FIXED order, one control each.
 * That is the right default and it does not change — every existing project and
 * preset renders identically. What it cannot do is let an author say "gate it,
 * THEN ping-pong the result, then duck the whole thing", and order is where most
 * of a sound lives.
 *
 * This is the same shape as the video filter chain, deliberately: same stored
 * document shape (doc/filters.js), same panel (ui/filters.js), same cap. An
 * author who has used one already knows this one.
 *
 * ---------------------------------------------------------------- two kinds --
 *
 * `renderAudio()` builds a node graph, renders it, and THEN post-processes the
 * samples (bitcrush, loop crossfade, fades). Effects fall into the same two
 * halves, and pretending otherwise is where this would have gone wrong:
 *
 *   graph({ ctx, input, dur, p }) -> node
 *     Insert nodes and return the new tail. For anything expressible as a
 *     filter, a delay, a gain or an LFO.
 *
 *   post({ channels, sr, dur, p, rnd }) -> channels
 *     Rewrite the rendered samples. For anything that needs to READ the signal
 *     — a stutter has to copy a slice it has already heard, and no arrangement
 *     of WebAudio nodes will do that.
 *
 * A post effect MUST return channels of the same length. The loop crossfade and
 * the fades run afterwards and both assume the length they were given; a
 * length-changing effect would silently move the loop point.
 *
 * Determinism: use the injected `rnd`, never Math.random. The same seed must
 * render the same audio, which is what makes a project reproducible.
 */

export const AUDIO_FX = {};

/**
 * @param {string} id     stable key stored in the document
 * @param {string} name   label in the UI
 * @param {string} group  heading in the picker
 * @param {Array}  params [{ key, label, min, max, step, def, kind? }]
 * @param {object} spec   { graph } or { post }
 */
function fx(id, name, group, params, spec) {
  AUDIO_FX[id] = { id, name, group, params, ...spec };
}

/** Every declared key, clamped, with defaults filled in. */
export function resolveFxParams(id, given) {
  const f = AUDIO_FX[id];
  if (!f) return {};
  const out = {};
  for (const spec of f.params) {
    if (spec.kind === 'select') {
      const v = given?.[spec.key];
      out[spec.key] = spec.options.some((o) => o.value === v) ? v : spec.def;
      continue;
    }
    const n = Number(given?.[spec.key]);
    out[spec.key] = Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, n)) : spec.def;
  }
  return out;
}

/** Ids grouped for the picker, groups in registration order. */
export function fxGroups() {
  const out = new Map();
  for (const f of Object.values(AUDIO_FX)) {
    if (!out.has(f.group)) out.set(f.group, []);
    out.get(f.group).push(f);
  }
  return out;
}

/* ============================================================== graph ==== */

/* Three bands, which is the smallest EQ that can actually shape a sound: cut
   the mud, find the voice, open or close the top. The bus has a telephone
   band-pass and nothing else, so "less bass" was previously not expressible. */
fx('eq3', '3-Band EQ', 'Tone', [
  { key: 'low', label: 'Low dB', min: -24, max: 24, step: 0.5, def: 0 },
  { key: 'lowF', label: 'Low Hz', min: 40, max: 800, step: 10, def: 200 },
  { key: 'mid', label: 'Mid dB', min: -24, max: 24, step: 0.5, def: 0 },
  { key: 'midF', label: 'Mid Hz', min: 200, max: 6000, step: 50, def: 1200 },
  { key: 'midQ', label: 'Mid Q', min: 0.2, max: 8, step: 0.1, def: 1 },
  { key: 'high', label: 'High dB', min: -24, max: 24, step: 0.5, def: 0 },
  { key: 'highF', label: 'High Hz', min: 1000, max: 16000, step: 100, def: 4000 },
], {
  graph({ ctx, input, p }) {
    const ls = ctx.createBiquadFilter();
    ls.type = 'lowshelf'; ls.frequency.value = p.lowF; ls.gain.value = p.low;
    const pk = ctx.createBiquadFilter();
    pk.type = 'peaking'; pk.frequency.value = p.midF; pk.Q.value = p.midQ; pk.gain.value = p.mid;
    const hs = ctx.createBiquadFilter();
    hs.type = 'highshelf'; hs.frequency.value = p.highF; hs.gain.value = p.high;
    input.connect(ls).connect(pk).connect(hs);
    return hs;
  },
});

/* Chorus and flanger are the same circuit at different delay times: a modulated
   delay mixed back with the dry signal. Under about 10ms the comb filtering is
   audible as a flange; above it, as a doubling. One control, not two effects. */
fx('chorus', 'Chorus / Flanger', 'Modulation', [
  { key: 'delay', label: 'Delay ms', min: 0.5, max: 40, step: 0.5, def: 12 },
  { key: 'depth', label: 'Depth ms', min: 0, max: 15, step: 0.1, def: 3 },
  { key: 'rate', label: 'Rate Hz', min: 0.05, max: 8, step: 0.05, def: 0.6 },
  { key: 'feedback', label: 'Feedback %', min: 0, max: 90, step: 1, def: 20 },
  { key: 'mix', label: 'Mix %', min: 0, max: 100, step: 1, def: 45 },
], {
  graph({ ctx, input, dur, p }) {
    const sum = ctx.createGain();
    const dry = ctx.createGain(); dry.gain.value = 1 - p.mix / 200;
    const wet = ctx.createGain(); wet.gain.value = p.mix / 100;
    const dl = ctx.createDelay(0.2);
    dl.delayTime.value = p.delay / 1000;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = p.rate;
    const la = ctx.createGain(); la.gain.value = p.depth / 1000;
    lfo.connect(la).connect(dl.delayTime);
    lfo.start(0); lfo.stop(dur);
    if (p.feedback > 0) {
      const fb = ctx.createGain();
      fb.gain.value = p.feedback / 100 * 0.9;   // < 1 or it runs away
      dl.connect(fb); fb.connect(dl);
    }
    input.connect(dry).connect(sum);
    input.connect(dl).connect(wet).connect(sum);
    return sum;
  },
});

/* The signal moving across the field on its own. Mono renders have no field to
   move in, so it becomes a no-op there rather than silently doing nothing
   surprising — the engine's own pan buses behave the same way. */
fx('autopan', 'Auto-Pan', 'Modulation', [
  { key: 'rate', label: 'Rate Hz', min: 0.05, max: 12, step: 0.05, def: 0.4 },
  { key: 'depth', label: 'Depth %', min: 0, max: 100, step: 1, def: 80 },
  { key: 'shape', label: 'Shape', kind: 'select', def: 'sine',
    options: [{ value: 'sine', label: 'Smooth (sine)' }, { value: 'square', label: 'Hard (square)' }] },
], {
  graph({ ctx, input, dur, p }) {
    if (typeof ctx.createStereoPanner !== 'function' || ctx.destination.channelCount < 2) return input;
    const pan = ctx.createStereoPanner();
    const lfo = ctx.createOscillator();
    lfo.type = p.shape === 'square' ? 'square' : 'sine';
    lfo.frequency.value = p.rate;
    const la = ctx.createGain(); la.gain.value = p.depth / 100;
    lfo.connect(la).connect(pan.pan);
    lfo.start(0); lfo.stop(dur);
    input.connect(pan);
    return pan;
  },
});

/* Ping-pong: two delays, each feeding the other, hard left and hard right. The
   cross-feed is the whole effect — two independent delays panned apart is just
   a wide slap. */
fx('pingpong', 'Ping-Pong Delay', 'Space', [
  { key: 'time', label: 'Time s', min: 0.02, max: 1.5, step: 0.01, def: 0.28 },
  { key: 'feedback', label: 'Feedback %', min: 0, max: 95, step: 1, def: 45 },
  { key: 'tone', label: 'Tone Hz', min: 300, max: 12000, step: 100, def: 2600 },
  { key: 'mix', label: 'Mix %', min: 0, max: 100, step: 1, def: 40 },
], {
  graph({ ctx, input, p }) {
    const sum = ctx.createGain();
    input.connect(sum);
    if (typeof ctx.createStereoPanner !== 'function' || ctx.destination.channelCount < 2) {
      // Mono render (by API absence OR a mono destination): a plain delay is the
      // honest reduction. The old API-only test let a mono render take the stereo
      // branch, whose hard-panned echoes then down-mixed to −6 dB — the mono
      // fallback existed for exactly this case but was never reached. Matches the
      // channelCount test auto-pan already uses.
      const dl = ctx.createDelay(2);
      dl.delayTime.value = p.time;
      const fb = ctx.createGain(); fb.gain.value = p.feedback / 100 * 0.95;
      const wet = ctx.createGain(); wet.gain.value = p.mix / 100;
      input.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet).connect(sum);
      return sum;
    }
    const dL = ctx.createDelay(2), dR = ctx.createDelay(2);
    dL.delayTime.value = p.time; dR.delayTime.value = p.time;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = p.tone;
    const fb = ctx.createGain(); fb.gain.value = p.feedback / 100 * 0.95;
    const pL = ctx.createStereoPanner(); pL.pan.value = -1;
    const pR = ctx.createStereoPanner(); pR.pan.value = 1;
    const wet = ctx.createGain(); wet.gain.value = p.mix / 100;
    input.connect(dL);
    dL.connect(pL).connect(wet);
    dL.connect(dR);
    dR.connect(pR).connect(wet);
    dR.connect(lp).connect(fb).connect(dL);        // the cross-feed
    wet.connect(sum);
    return sum;
  },
});

/* Rhythmic gating: the level chopped in and out on a grid. A true sidechain
   needs a key signal the render does not have, so this is the pumping people
   actually mean when they ask for ducking, with a shape control that spans
   both — a soft shape pumps, a hard one gates. */
fx('pump', 'Pump / Gate', 'Dynamics', [
  { key: 'rate', label: 'Per second', min: 0.25, max: 16, step: 0.25, def: 2 },
  { key: 'depth', label: 'Depth %', min: 0, max: 100, step: 1, def: 70 },
  { key: 'shape', label: 'Shape', kind: 'select', def: 'pump',
    options: [{ value: 'pump', label: 'Pump (soft swell)' }, { value: 'gate', label: 'Gate (hard chop)' }] },
], {
  graph({ ctx, input, dur, p }) {
    const g = ctx.createGain();
    const depth = p.depth / 100;
    const step = 1 / p.rate;
    // Scheduled envelope rather than an LFO: an LFO on gain gives a sine, and
    // the sound of ducking is the RECOVERY curve, not a wobble.
    g.gain.setValueAtTime(1, 0);
    for (let t = 0; t < dur; t += step) {
      const floor = Math.max(0.0001, 1 - depth);
      if (p.shape === 'gate') {
        g.gain.setValueAtTime(floor, t);
        g.gain.setValueAtTime(1, Math.min(dur, t + step * 0.5));
      } else {
        g.gain.setValueAtTime(floor, t);
        g.gain.linearRampToValueAtTime(1, Math.min(dur, t + step * 0.85));
      }
    }
    input.connect(g);
    return g;
  },
});

/* A compressor in the ordinary studio sense. The one dynamics tool the chain had
   was rhythmic (Pump / Gate); this one reacts to the material itself, which is
   what "even this out" actually asks for. DynamicsCompressorNode is deterministic
   for a given input, so the render stays reproducible. */
fx('compressor', 'Compressor', 'Dynamics', [
  { key: 'threshold', label: 'Threshold dB', min: -60, max: 0, step: 1, def: -24 },
  { key: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.5, def: 4 },
  { key: 'knee', label: 'Knee dB', min: 0, max: 40, step: 1, def: 24 },
  { key: 'attack', label: 'Attack ms', min: 1, max: 300, step: 1, def: 10 },
  { key: 'release', label: 'Release ms', min: 20, max: 1000, step: 10, def: 200 },
  { key: 'makeup', label: 'Make-up dB', min: 0, max: 24, step: 0.5, def: 4 },
], {
  graph({ ctx, input, p }) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = p.threshold;
    comp.ratio.value = p.ratio;
    comp.knee.value = p.knee;
    comp.attack.value = p.attack / 1000;
    comp.release.value = p.release / 1000;
    const makeup = ctx.createGain();
    makeup.gain.value = Math.pow(10, p.makeup / 20);
    input.connect(comp).connect(makeup);
    return makeup;
  },
});

/* Convolution reverb over a SYNTHESISED impulse response: exponentially decaying
   noise from a local generator seeded off the decay, so the same settings always
   build the same room. A recorded IR would be an asset; this stays a parameter. */
fx('reverb', 'Reverb', 'Space', [
  { key: 'decay', label: 'Decay s', min: 0.1, max: 8, step: 0.1, def: 1.8 },
  { key: 'predelay', label: 'Pre-delay ms', min: 0, max: 200, step: 1, def: 20 },
  { key: 'damp', label: 'Damping Hz', min: 500, max: 16000, step: 100, def: 6000 },
  { key: 'mix', label: 'Mix %', min: 0, max: 100, step: 1, def: 30 },
], {
  graph({ ctx, input, p }) {
    const sr = ctx.sampleRate;
    const len = Math.max(1, Math.round(p.decay * sr));
    const ir = ctx.createBuffer(2, len, sr);
    // Deterministic on purpose: seeded from the decay, not Math.random, so a
    // project renders the same tail every time on the same engine.
    let seed = (0x2f6e2b1 ^ (Math.round(p.decay * 1000) * 2654435761)) >>> 0;
    const prng = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (prng() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    }
    const conv = ctx.createConvolver();
    conv.normalize = true; conv.buffer = ir;
    const pre = ctx.createDelay(1); pre.delayTime.value = p.predelay / 1000;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = p.damp;
    const wet = ctx.createGain(); wet.gain.value = p.mix / 100;
    const sum = ctx.createGain();
    input.connect(sum);                                  // dry
    input.connect(pre).connect(conv).connect(lp).connect(wet).connect(sum);
    return sum;
  },
});

/* Saturation: a smooth waveshaper with a tone filter after it, because drive
   without a lowpass is fizz. Same curve family engine.js's distortion uses. */
fx('drive', 'Drive / Saturate', 'Tone', [
  { key: 'amount', label: 'Drive', min: 0, max: 100, step: 1, def: 35 },
  { key: 'tone', label: 'Tone Hz', min: 500, max: 16000, step: 100, def: 5200 },
  { key: 'level', label: 'Level %', min: 10, max: 200, step: 1, def: 90 },
], {
  graph({ ctx, input, p }) {
    const ws = ctx.createWaveShaper();
    const k = (p.amount / 100) * 60 + 1, n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
    ws.curve = curve;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = p.tone;
    const out = ctx.createGain(); out.gain.value = p.level / 100;
    input.connect(ws).connect(lp).connect(out);
    return out;
  },
});

/* The band-limited squawk of a handset: aggressive high-pass and low-pass with a
   little grit between them. One effect rather than an EQ recipe because it is
   asked for as a thing — "make it sound like a phone call". */
fx('telephone', 'Telephone', 'Tone', [
  { key: 'lowcut', label: 'Low cut Hz', min: 100, max: 1000, step: 10, def: 300 },
  { key: 'highcut', label: 'High cut Hz', min: 1000, max: 8000, step: 50, def: 3400 },
  { key: 'grit', label: 'Grit', min: 0, max: 100, step: 1, def: 25 },
], {
  graph({ ctx, input, p }) {
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = p.lowcut; hp.Q.value = 0.9;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = p.highcut; lp.Q.value = 0.9;
    let tail = hp; input.connect(hp);
    if (p.grit > 0) {
      const ws = ctx.createWaveShaper();
      const k = (p.grit / 100) * 25 + 1, n = 512, curve = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
      ws.curve = curve; tail.connect(ws); tail = ws;
    }
    tail.connect(lp);
    return lp;
  },
});

/* Tremolo: an LFO on the level. The one classic modulation the chain lacked —
   chorus moves pitch, auto-pan moves position; this moves loudness. The
   oscillator starts at phase zero, so the wobble lands identically every render. */
fx('tremolo', 'Tremolo', 'Modulation', [
  { key: 'rate', label: 'Rate Hz', min: 0.1, max: 20, step: 0.1, def: 5 },
  { key: 'depth', label: 'Depth %', min: 0, max: 100, step: 1, def: 60 },
  { key: 'shape', label: 'Shape', kind: 'select', def: 'sine', options: [
    { value: 'sine', label: 'Sine (smooth)' },
    { value: 'triangle', label: 'Triangle' },
    { value: 'square', label: 'Square (chop)' },
  ] },
], {
  graph({ ctx, input, dur, p }) {
    const g = ctx.createGain();
    const depth = p.depth / 100;
    g.gain.value = 1 - depth / 2;
    const lfo = ctx.createOscillator();
    lfo.type = p.shape; lfo.frequency.value = p.rate;
    const amp = ctx.createGain(); amp.gain.value = depth / 2;
    lfo.connect(amp).connect(g.gain);
    lfo.start(0); lfo.stop(dur + 0.1);
    input.connect(g);
    return g;
  },
});

/* ============================================================== post ===== */

/* Stutter: a slice is captured and repeated over the region that follows.
 *
 * This cannot be a graph effect at any price — it has to READ samples that have
 * already been rendered and write them forward, and no arrangement of WebAudio
 * nodes copies a buffer it is in the middle of producing. */
fx('stutter', 'Stutter', 'Rhythm', [
  { key: 'slice', label: 'Slice ms', min: 10, max: 500, step: 5, def: 90 },
  { key: 'every', label: 'Every s', min: 0.25, max: 20, step: 0.25, def: 2 },
  { key: 'repeats', label: 'Repeats', min: 2, max: 16, step: 1, def: 4 },
  { key: 'chance', label: 'Chance %', min: 1, max: 100, step: 1, def: 100 },
], {
  post({ channels, sr, p, rnd }) {
    const slice = Math.max(1, Math.round((p.slice / 1000) * sr));
    const every = Math.max(1, Math.round(p.every * sr));
    const reps = Math.round(p.repeats);
    const len = channels[0].length;
    for (let at = every; at + slice * reps < len; at += every) {
      if (rnd() * 100 > p.chance) continue;
      for (const d of channels) {
        // Copy the slice FIRST: writing repeat 2 from the buffer would copy
        // repeat 1 back over itself and smear rather than stutter.
        const src = d.slice(at, at + slice);
        for (let r = 1; r < reps; r++) d.set(src, at + slice * r);
      }
    }
    return channels;
  },
});

/* Reversed sections. Cheap, entirely unlike anything the bus can do, and the
   single most recognisable "something is wrong with this tape" gesture. */
fx('reverse', 'Reverse Sections', 'Rhythm', [
  { key: 'len', label: 'Section s', min: 0.05, max: 4, step: 0.05, def: 0.5 },
  { key: 'every', label: 'Every s', min: 0.25, max: 20, step: 0.25, def: 2.5 },
  { key: 'chance', label: 'Chance %', min: 1, max: 100, step: 1, def: 100 },
], {
  post({ channels, sr, p, rnd }) {
    const n = Math.max(2, Math.round(p.len * sr));
    const every = Math.max(1, Math.round(p.every * sr));
    const len = channels[0].length;
    for (let at = 0; at + n < len; at += every) {
      if (rnd() * 100 > p.chance) continue;
      for (const d of channels) {
        for (let i = 0, j = n - 1; i < j; i++, j--) {
          const t = d[at + i]; d[at + i] = d[at + j]; d[at + j] = t;
        }
      }
    }
    return channels;
  },
});

/* Pitch shift by overlap-add granular resampling.
 *
 * Grains are read at a different rate and written back at the original one,
 * overlapping with a raised-cosine window so the joins do not click. The output
 * is exactly as long as the input, which is the contract for a post effect —
 * resampling the whole buffer would be simpler and would move the loop point
 * and both fades. */
fx('pitch', 'Pitch Shift', 'Tone', [
  { key: 'semitones', label: 'Semitones', min: -24, max: 24, step: 1, def: -5 },
  { key: 'grain', label: 'Grain ms', min: 20, max: 200, step: 5, def: 80 },
  { key: 'mix', label: 'Mix %', min: 0, max: 100, step: 1, def: 100 },
], {
  post({ channels, sr, p }) {
    if (p.semitones === 0 || p.mix <= 0) return channels;
    const ratio = Math.pow(2, p.semitones / 12);
    const g = Math.max(64, Math.round((p.grain / 1000) * sr));
    const hop = Math.floor(g / 2);                    // 50% overlap
    const win = new Float32Array(g);
    for (let i = 0; i < g; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (g - 1));
    const mix = p.mix / 100;
    return channels.map((d) => {
      const out = new Float32Array(d.length);
      const norm = new Float32Array(d.length);
      for (let at = 0; at + g < d.length; at += hop) {
        for (let i = 0; i < g; i++) {
          // Read position moves at `ratio`; write position at 1. Linear
          // interpolation, because nearest-neighbour on a pitch shift is audible
          // as a buzz on anything tonal.
          const rp = at + i * ratio;
          const i0 = rp | 0;
          if (i0 + 1 >= d.length) break;
          const fr = rp - i0;
          const s = d[i0] * (1 - fr) + d[i0 + 1] * fr;
          out[at + i] += s * win[i];
          norm[at + i] += win[i];
        }
      }
      for (let i = 0; i < d.length; i++) {
        const wet = norm[i] > 1e-6 ? out[i] / norm[i] : d[i];
        d[i] = d[i] * (1 - mix) + wet * mix;
      }
      return d;
    });
  },
});

/* Worn record: crackle, hiss and a dulled top end. A post effect because the
   crackle must be the SAME event in both channels — a tick that lands only on
   the left reads as a glitch, not a record. */
fx('vinyl', 'Vinyl / Crackle', 'Texture', [
  { key: 'crackle', label: 'Crackle', min: 0, max: 100, step: 1, def: 40 },
  { key: 'hiss', label: 'Hiss', min: 0, max: 100, step: 1, def: 18 },
  { key: 'age', label: 'Age (dull)', min: 0, max: 100, step: 1, def: 30 },
], {
  post({ channels, sr, dur, p, rnd }) {
    const len = channels[0].length;
    if (p.age > 0) {
      // One-pole lowpass; 100 dulls to ~2kHz.
      const fc = 16000 - (p.age / 100) * 14000;
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      for (const d of channels) { let y = 0; for (let i = 0; i < len; i++) { y += a * (d[i] - y); d[i] = y; } }
    }
    if (p.hiss > 0) {
      const amp = (p.hiss / 100) * 0.012;
      for (const d of channels) for (let i = 0; i < len; i++) d[i] += (rnd() * 2 - 1) * amp;
    }
    if (p.crackle > 0) {
      // Events chosen once and written to every channel, so each tick is a
      // single physical fact on the record rather than stereo confetti.
      const events = Math.round((p.crackle / 100) * 18 * Math.max(1, dur));
      for (let e = 0; e < events; e++) {
        const at = Math.floor(rnd() * Math.max(1, len - 64));
        const peak = 0.04 + rnd() * (p.crackle / 100) * 0.5;
        const sign = rnd() > 0.5 ? 1 : -1;
        const n = 6 + Math.floor(rnd() * 40);
        for (const d of channels) for (let i = 0; i < n && at + i < len; i++) d[at + i] += sign * peak * Math.pow(1 - i / n, 3);
      }
    }
    return channels;
  },
});

/* Bit crush: sample-hold downsampling and bit-depth quantise — the audio twin of
   the video Bit Crush. A post effect because a graph has no sample-and-hold node. */
fx('crush', 'Bit Crush', 'Texture', [
  { key: 'bits', label: 'Bits', min: 2, max: 16, step: 1, def: 8 },
  { key: 'downsample', label: 'Hold ×', min: 1, max: 40, step: 1, def: 6 },
  { key: 'mix', label: 'Mix %', min: 0, max: 100, step: 1, def: 100 },
], {
  post({ channels, p }) {
    if (p.mix <= 0) return channels;
    const steps = Math.pow(2, p.bits - 1);   // b-bit step over [-1,1]
    const hold = Math.max(1, Math.round(p.downsample));
    const mix = p.mix / 100;
    for (const d of channels) {
      let held = 0;
      for (let i = 0; i < d.length; i++) {
        if (i % hold === 0) held = Math.round(d[i] * steps) / steps;
        d[i] = d[i] * (1 - mix) + held * mix;
      }
    }
    return channels;
  },
});

/* -------------------------------------------------------------- apply --- */

/**
 * Insert every enabled GRAPH effect, in order, and return the new tail.
 *
 * A step that throws is skipped rather than breaking the graph — the same
 * contract the video chain and the layer registry have, and for the same
 * reason: one bad effect must not turn "render" into a dead button.
 */
export function applyGraphFx(ctx, input, chain, dur, log) {
  let node = input;
  if (!Array.isArray(chain)) return node;
  for (const step of chain) {
    if (!step || step.enabled === false) continue;
    const f = AUDIO_FX[step.id];
    if (!f || !f.graph) continue;             // a post step, or one from a newer build
    try {
      node = f.graph({ ctx, input: node, dur, p: resolveFxParams(step.id, step.params) }) || node;
    } catch (e) {
      log?.(`Audio FX "${f.name}" failed (${e.message}) — skipped.`, 'warn');
    }
  }
  return node;
}

/** Run every enabled POST effect, in order, over the rendered channels. */
export function applyPostFx(channels, sr, dur, chain, rnd, log) {
  let out = channels;
  if (!Array.isArray(chain)) return out;
  for (const step of chain) {
    if (!step || step.enabled === false) continue;
    const f = AUDIO_FX[step.id];
    if (!f || !f.post) continue;
    try {
      const next = f.post({ channels: out, sr, dur, p: resolveFxParams(step.id, step.params), rnd });
      // Length is the contract: the loop crossfade and both fades run after
      // this and assume the length they were handed.
      if (Array.isArray(next) && next.length && next[0].length === out[0].length) out = next;
      else log?.(`Audio FX "${f.name}" changed the render length — ignored.`, 'warn');
    } catch (e) {
      log?.(`Audio FX "${f.name}" failed (${e.message}) — skipped.`, 'warn');
    }
  }
  return out;
}

/** True when at least one step would actually run. */
export const hasAudioFx = (chain) =>
  Array.isArray(chain) && chain.some((s) => s && s.enabled !== false && AUDIO_FX[s.id]);
