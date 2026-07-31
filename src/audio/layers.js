/* Dead Signal Studio — audio/layers.js
 *
 * The extra sound layers, as a registry.
 *
 * The ten original layers are hand-wired: each one has a block of markup in
 * index.html, a line in readAudioCfg(), a pan entry, and a block in
 * renderAudio(). That is four places to edit and four places to forget, and it
 * is why the tab had ten layers rather than thirty — the cost of adding one was
 * mostly clerical.
 *
 * A layer here is ONE entry: what it is called, what it can be adjusted by, and
 * how it builds its nodes. The controls, the config reader and the render pass
 * are all derived from that, so a new layer is a new object in this file and
 * nothing else.
 *
 * The originals are deliberately NOT migrated. They carry saved projects,
 * presets and campaign recipes that name their exact control ids, and moving
 * them would be a schema change for no gain — the registry exists to make the
 * NEXT layer cheap, not to relitigate the last ten.
 *
 * Contract for `build`:
 *   build({ ctx, dest, p, dur, rnd, helpers })
 *     ctx     the OfflineAudioContext being rendered
 *     dest    the layer's own panned bus — connect to this, never to the sum
 *     p       resolved parameters: every declared key present, plus `pan`
 *     dur     the render length in seconds, including any loop tail
 *     rnd     the seeded PRNG. Never Math.random: the same seed must render
 *             the same audio, which is what makes a project reproducible.
 *     helpers { noiseBuffer, tone, click } from engine.js
 *
 * Every oscillator must be stopped by `dur`. An unstopped node keeps the render
 * graph alive and OfflineAudioContext will happily render silence forever.
 *
 * A layer that places content at a time the AUTHOR chose also declares
 * `needs(p)`: the seconds it requires. The engine already extends the render
 * for the hand-wired layers that do this (dial-up, pulse train, morse, DTMF),
 * and without it "beep at 20s" on an 8s render is silence with no explanation.
 */

/** Every layer's parameters get an `id`-prefixed control: a-<id>-<key>. */
export const CTRL = (id, key) => `a-${id}-${key}`;
/** The enable checkbox for a layer. */
export const TOGGLE = (id) => `a-${id}`;

/* Parameter kinds:
     pct    0..100 slider, delivered to build() as 0..1
     num    a number input, delivered as typed
     range  a slider, delivered as typed
     text   a text input, delivered as a string
   Everything is clamped to its declared range before build() sees it, so no
   layer needs to defend against a hand-edited project. */

/* `section` is which group of the AUDIO settings column a layer's controls
   appear under. It belongs here rather than in the panel that draws them: the
   registry is what a layer IS, and a layer added without a section would
   otherwise render into whichever group happened to be showing. */
export const AUDIO_LAYERS = [

  /* ------------------------------------------------------------ texture -- */

  {
    id: 'vinyl', section: 'Ambience', name: 'VINYL CRACKLE', hint:
      'Surface noise from a record: a continuous bed of fine hiss with sharper pops scattered through it. Two components, because crackle alone sounds like static and pops alone sound like a fault.',
    params: [
      { key: 'g', kind: 'pct', label: 'Gain', def: 40 },
      { key: 'rate', kind: 'range', label: 'Pops/s', min: 0, max: 40, def: 12,
        hint: 'Average pops per second, randomly spaced. Under about 4 it reads as a worn record; over 20 it reads as a damaged one.' },
    ],
    build({ ctx, dest, p, dur, rnd, helpers }) {
      // The bed: noise through a high-pass, so it is surface hiss rather than rumble.
      const src = ctx.createBufferSource();
      src.buffer = helpers.noiseBuffer(ctx, dur);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 2000;
      const g = ctx.createGain(); g.gain.value = p.g * 0.06;
      src.connect(hp).connect(g).connect(dest);
      src.start(0); src.stop(dur);
      // The pops: Poisson-spaced, like the geiger layer, because evenly spaced
      // clicks read as a machine.
      if (p.rate <= 0) return;
      let t = 0.05;
      while (t < dur) {
        t += -Math.log(1 - rnd()) / p.rate;
        if (t >= dur) break;
        const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.008), ctx.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / d.length, 6);
        const s = ctx.createBufferSource(); s.buffer = b;
        const pg = ctx.createGain(); pg.gain.value = p.g * (0.25 + rnd() * 0.75);
        s.connect(pg).connect(dest);
        s.start(t);
      }
    },
  },

  {
    id: 'roomtone', section: 'Ambience', name: 'ROOM TONE', hint:
      'The sound of a space with nothing happening in it. Filtered noise with a slow wander, which is what separates a room from silence — a cut to true digital silence is the most unnatural thing in a mix.',
    params: [
      { key: 'g', kind: 'pct', label: 'Gain', def: 35 },
      { key: 'lp', kind: 'num', label: 'Tone Hz', min: 80, max: 8000, def: 700,
        hint: 'Low-pass corner. Low is a basement; high is an office with air conditioning.' },
      { key: 'move', kind: 'pct', label: 'Wander', def: 30,
        hint: 'How much the filter drifts. A completely static bed reads as a loop the moment it repeats.' },
    ],
    build({ ctx, dest, p, dur, helpers }) {
      const src = ctx.createBufferSource();
      src.buffer = helpers.noiseBuffer(ctx, dur);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = p.lp;
      if (p.move > 0) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.07;
        const la = ctx.createGain(); la.gain.value = p.lp * p.move * 0.5;
        lfo.connect(la).connect(lp.frequency);
        lfo.start(0); lfo.stop(dur);
      }
      const g = ctx.createGain(); g.gain.value = p.g * 0.3;
      src.connect(lp).connect(g).connect(dest);
      src.start(0); src.stop(dur);
    },
  },

  {
    id: 'rain', section: 'Ambience', name: 'RAIN', hint:
      'Rain on a window: a wide hiss with irregular heavier drops over it. The drops are what make it rain rather than noise.',
    params: [
      { key: 'g', kind: 'pct', label: 'Gain', def: 45 },
      { key: 'heavy', kind: 'pct', label: 'Heaviness', def: 40,
        hint: 'Shifts the bed downward and the drops upward — light drizzle to a downpour on glass.' },
      { key: 'drops', kind: 'range', label: 'Drops/s', min: 0, max: 30, def: 8 },
    ],
    build({ ctx, dest, p, dur, rnd, helpers }) {
      const src = ctx.createBufferSource();
      src.buffer = helpers.noiseBuffer(ctx, dur);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400 - p.heavy * 700;
      bp.Q.value = 0.4;
      const g = ctx.createGain(); g.gain.value = p.g * 0.34;
      src.connect(bp).connect(g).connect(dest);
      src.start(0); src.stop(dur);
      if (p.drops <= 0) return;
      let t = 0.05;
      while (t < dur) {
        t += -Math.log(1 - rnd()) / p.drops;
        if (t >= dur) break;
        const len = Math.ceil(ctx.sampleRate * 0.05);
        const b = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, 3);
        const s = ctx.createBufferSource(); s.buffer = b;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = 900 + rnd() * 2200; f.Q.value = 2;
        const dg = ctx.createGain(); dg.gain.value = p.g * (0.2 + p.heavy) * (0.3 + rnd() * 0.7);
        s.connect(f).connect(dg).connect(dest);
        s.start(t);
      }
    },
  },

  {
    id: 'wind', section: 'Ambience', name: 'WIND', hint:
      'Noise through a resonant filter that sweeps — the resonance is what turns hiss into wind, and the sweep is what stops it sounding like a fan.',
    params: [
      { key: 'g', kind: 'pct', label: 'Gain', def: 40 },
      { key: 'gust', kind: 'pct', label: 'Gusting', def: 50 },
      { key: 'pitch', kind: 'num', label: 'Centre Hz', min: 120, max: 2400, def: 500 },
    ],
    build({ ctx, dest, p, dur, helpers }) {
      const src = ctx.createBufferSource();
      src.buffer = helpers.noiseBuffer(ctx, dur);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = p.pitch; bp.Q.value = 3.5;
      // Two LFOs at unrelated rates: one gives a pulse, two give weather.
      const l1 = ctx.createOscillator(); l1.frequency.value = 0.11;
      const a1 = ctx.createGain(); a1.gain.value = p.pitch * 0.55 * p.gust;
      l1.connect(a1).connect(bp.frequency);
      const l2 = ctx.createOscillator(); l2.frequency.value = 0.037;
      const a2 = ctx.createGain(); a2.gain.value = p.pitch * 0.3 * p.gust;
      l2.connect(a2).connect(bp.frequency);
      l1.start(0); l1.stop(dur); l2.start(0); l2.stop(dur);
      const g = ctx.createGain(); g.gain.value = p.g * 0.5;
      const amp = ctx.createOscillator(); amp.frequency.value = 0.09;
      const ag = ctx.createGain(); ag.gain.value = p.g * 0.25 * p.gust;
      amp.connect(ag).connect(g.gain);
      amp.start(0); amp.stop(dur);
      src.connect(bp).connect(g).connect(dest);
      src.start(0); src.stop(dur);
    },
  },

  {
    id: 'hum', section: 'Ambience', name: 'MAINS HUM', hint:
      'The 50 or 60 Hz buzz of unbalanced mains, with its odd harmonics. Distinct from Drone: a drone is a note you chose, hum is the note the building chose, and it belongs at a level you notice only when it stops.',
    params: [
      { key: 'g', kind: 'pct', label: 'Gain', def: 30 },
      { key: 'f', kind: 'num', label: 'Hz', min: 40, max: 70, def: 60,
        hint: '60 in North America, 50 almost everywhere else. It is one of the few sounds that dates and places a recording.' },
      { key: 'buzz', kind: 'pct', label: 'Buzz', def: 45,
        hint: 'How much of the harmonic series above the fundamental. At zero it is a clean sine; high it is a failing transformer.' },
    ],
    build({ ctx, dest, p, dur }) {
      // Odd harmonics only — that is what makes mains buzz rather than drone.
      const harmonics = [1, 3, 5, 7, 9];
      harmonics.forEach((h, i) => {
        if (i > 0 && p.buzz <= 0) return;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = p.f * h;
        const g = ctx.createGain();
        g.gain.value = p.g * 0.3 * (i === 0 ? 1 : (p.buzz / h) * 0.8);
        o.connect(g).connect(dest);
        o.start(0); o.stop(dur);
      });
    },
  },

  /* ------------------------------------------------------------ machines -- */

  {
    id: 'clock', section: 'Events', name: 'CLOCK TICK', hint:
      'A mechanical tick, and optionally a tock — a real escapement is not symmetrical, and the uneven pair is most of what makes it read as a clock rather than a metronome.',
    params: [
      { key: 'g', kind: 'pct', label: 'Gain', def: 55 },
      { key: 'bpm', kind: 'num', label: 'Ticks/min', min: 20, max: 240, def: 60 },
      { key: 'tock', kind: 'pct', label: 'Tock', def: 60,
        hint: 'Level of the off-beat. At zero every tick is identical, which is a metronome.' },
    ],
    build({ ctx, dest, p, dur }) {
      const spb = 60 / p.bpm;
      const hit = (t, amp, freq) => {
        if (t >= dur) return;
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.setValueAtTime(freq, t);
        o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + 0.02);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(p.g * amp, t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        o.connect(g).connect(dest);
        o.start(t); o.stop(Math.min(dur, t + 0.08));
      };
      for (let t = 0.15; t < dur; t += spb) {
        hit(t, 0.5, 2600);
        if (p.tock > 0) hit(t + spb / 2, 0.5 * p.tock, 1900);
      }
    },
  },

  {
    id: 'drip', section: 'Events', name: 'WATER DRIP', hint:
      'A drip into standing water: a short pitched blip that rises. The rise is the whole effect — a falling pitch is a drop hitting stone, a rising one is a drop hitting water.',
    params: [
      { key: 'g', kind: 'pct', label: 'Gain', def: 50 },
      { key: 'rate', kind: 'range', label: 'Drips/s', min: 0.1, max: 8, def: 0.7 },
      { key: 'vary', kind: 'pct', label: 'Variation', def: 45,
        hint: 'Spread of pitch and timing. At zero every drip is identical, which no cave has ever done.' },
    ],
    build({ ctx, dest, p, dur, rnd }) {
      let t = 0.3;
      while (t < dur) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        const base = 700 + (rnd() - 0.5) * 900 * p.vary;
        o.frequency.setValueAtTime(base * 0.55, t);
        o.frequency.exponentialRampToValueAtTime(base * 1.9, t + 0.045);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(p.g * 0.6, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        o.connect(g).connect(dest);
        o.start(t); o.stop(Math.min(dur, t + 0.15));
        t += (1 / p.rate) * (1 + (rnd() - 0.5) * p.vary);
      }
    },
  },

  {
    id: 'siren', section: 'Events', name: 'SIREN', hint:
      'A two-tone or sweeping siren. The sweep shape is the difference between a European two-tone and an American wail, so it is a control rather than a choice baked in.',
    params: [
      { key: 'g', kind: 'pct', label: 'Gain', def: 40 },
      { key: 'lo', kind: 'num', label: 'Low Hz', min: 200, max: 1200, def: 500 },
      { key: 'hi', kind: 'num', label: 'High Hz', min: 300, max: 2400, def: 900 },
      { key: 'period', kind: 'range', label: 'Cycle s', min: 0.3, max: 8, def: 2 },
      { key: 'glide', kind: 'pct', label: 'Glide', def: 100,
        hint: 'At 100 the pitch sweeps between the two tones (a wail); at 0 it jumps (a two-tone).' },
    ],
    build({ ctx, dest, p, dur }) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const g = ctx.createGain();
      g.gain.value = p.g * 0.22;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 3000;
      o.connect(lp).connect(g).connect(dest);
      o.frequency.setValueAtTime(p.lo, 0);
      for (let t = 0; t < dur; t += p.period) {
        const half = p.period / 2;
        if (p.glide > 0.02) {
          o.frequency.exponentialRampToValueAtTime(p.hi, Math.min(dur, t + half * p.glide));
          o.frequency.exponentialRampToValueAtTime(p.lo, Math.min(dur, t + p.period));
        } else {
          o.frequency.setValueAtTime(p.hi, t);
          o.frequency.setValueAtTime(p.lo, t + half);
        }
      }
      o.start(0); o.stop(dur);
    },
  },

  {
    id: 'fax', section: 'Events', name: 'FAX / HANDSHAKE', hint:
      'The negotiation squeal of a fax or modem answering: a calling tone, an answer tone, then scrambled data. Related to the existing Dial-up layer but the receiving end — this is what the machine that picked up sounds like.',
    params: [
      { key: 'g', kind: 'pct', label: 'Gain', def: 45 },
      { key: 'start', kind: 'range', label: 'Starts at s', min: 0, max: 30, def: 0.3 },
      { key: 'chaos', kind: 'pct', label: 'Data', def: 60,
        hint: 'How long the scrambled section runs relative to the handshake tones.' },
    ],
    needs: (p) => p.start + 3.1 + 1 + p.chaos * 8 + 0.3,
    build({ ctx, dest, p, dur, rnd, helpers }) {
      const t0 = Math.min(p.start, Math.max(0, dur - 0.5));
      // CNG (calling) then CED (answer) — the two tones a fax exchanges first.
      helpers.tone(ctx, dest, 1100, p.g * 0.4, t0, Math.min(dur, t0 + 0.5));
      helpers.tone(ctx, dest, 2100, p.g * 0.4, Math.min(dur, t0 + 0.7), Math.min(dur, t0 + 3.0));
      const dataFrom = Math.min(dur, t0 + 3.1);
      const dataTo = Math.min(dur, dataFrom + 1 + p.chaos * 8);
      if (dataTo <= dataFrom) return;
      // The data: fast random tone steps, which is what a scrambled carrier is.
      let t = dataFrom;
      while (t < dataTo) {
        const step = 0.02 + rnd() * 0.05;
        helpers.tone(ctx, dest, 800 + rnd() * 2000, p.g * 0.28, t, Math.min(dataTo, t + step));
        t += step;
      }
    },
  },

  {
    id: 'answerphone', section: 'Events', name: 'ANSWERING MACHINE', hint:
      'The beep at the end of an outgoing message, and the click of the tape starting. The click is the part people remember and the part every fake one leaves out.',
    params: [
      { key: 'g', kind: 'pct', label: 'Gain', def: 55 },
      { key: 'at', kind: 'range', label: 'Beep at s', min: 0, max: 30, def: 1 },
      { key: 'f', kind: 'num', label: 'Beep Hz', min: 300, max: 2000, def: 1000 },
      { key: 'len', kind: 'range', label: 'Beep s', min: 0.1, max: 2, def: 0.55 },
    ],
    needs: (p) => p.at + p.len + 0.3,
    build({ ctx, dest, p, dur, helpers }) {
      const t = Math.min(p.at, Math.max(0, dur - 0.1));
      helpers.tone(ctx, dest, p.f, p.g * 0.5, t, Math.min(dur, t + p.len));
      // The mechanism: a click before the beep and another after it.
      helpers.click(ctx, dest, Math.max(0, t - 0.12));
      const after = Math.min(dur - 0.03, t + p.len + 0.08);
      if (after > 0) helpers.click(ctx, dest, after);
    },
  },

  {
    id: 'tuning', section: 'Events', name: 'RADIO TUNING', hint:
      'Sweeping the dial: bands of static with stations drifting past. Each station is a filtered tone that rises and falls as you pass through it, which is what makes it a sweep rather than a cut between sources.',
    params: [
      { key: 'g', kind: 'pct', label: 'Gain', def: 45 },
      { key: 'stations', kind: 'range', label: 'Stations', min: 0, max: 12, def: 4 },
      { key: 'speed', kind: 'range', label: 'Sweep s', min: 0.5, max: 20, def: 6,
        hint: 'How long one pass across the band takes.' },
    ],
    build({ ctx, dest, p, dur, rnd, helpers }) {
      const src = ctx.createBufferSource();
      src.buffer = helpers.noiseBuffer(ctx, dur);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 1.2;
      const g = ctx.createGain(); g.gain.value = p.g * 0.32;
      src.connect(bp).connect(g).connect(dest);
      src.start(0); src.stop(dur);
      const n = Math.round(p.stations);
      for (let i = 0; i < n; i++) {
        // Each station gets a slot in the sweep; passing "through" it is an
        // amplitude envelope, not a switch.
        const at = ((i + 0.5) / n) * p.speed;
        for (let k = 0; at + k * p.speed < dur; k++) {
          const t = at + k * p.speed;
          const w = p.speed / (n * 2.2);
          const o = ctx.createOscillator();
          o.type = rnd() < 0.5 ? 'sine' : 'triangle';
          o.frequency.value = 300 + rnd() * 900;
          const og = ctx.createGain();
          og.gain.setValueAtTime(0.0001, t);
          og.gain.linearRampToValueAtTime(p.g * 0.4, t + w * 0.5);
          og.gain.linearRampToValueAtTime(0.0001, Math.min(dur, t + w));
          o.connect(og).connect(dest);
          o.start(t); o.stop(Math.min(dur, t + w));
        }
      }
    },
  },

  /* -------------------------------------------------------------- tape --- */

  {
    id: 'tapestop', section: 'Events', name: 'TAPE STOP', hint:
      'The pitch and speed falling away as a transport loses power. Applied to its own tone rather than the mix, so it is a sound you place rather than an effect on everything — the bus already has wow/flutter for the latter.',
    params: [
      { key: 'g', kind: 'pct', label: 'Gain', def: 45 },
      { key: 'at', kind: 'range', label: 'Stops at s', min: 0, max: 40, def: 2 },
      { key: 'fall', kind: 'range', label: 'Fall s', min: 0.1, max: 4, def: 1.1 },
      { key: 'f', kind: 'num', label: 'Tone Hz', min: 60, max: 1200, def: 320 },
    ],
    needs: (p) => p.at + p.fall + 0.2,
    build({ ctx, dest, p, dur }) {
      const start = Math.min(p.at, Math.max(0, dur - 0.2));
      const end = Math.min(dur, start + p.fall);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(p.f, 0);
      o.frequency.setValueAtTime(p.f, start);
      // Exponential, not linear: a transport slowing loses pitch fastest at the
      // start, and a linear fall sounds like a synth sweep.
      o.frequency.exponentialRampToValueAtTime(Math.max(20, p.f * 0.04), end);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      // Anchor the tone from t=0, not only at `start`. Without the t=0 event the
      // filter sat at the BiquadFilter default (350 Hz) for the whole play before
      // the stop, muffling the saw to a near-sine, then jumped UP to 4000 at the
      // stop moment — the sound brightened exactly when the transport should have
      // been losing power. Now it plays bright, then dulls into the stop.
      lp.frequency.setValueAtTime(4000, 0);
      lp.frequency.setValueAtTime(4000, start);
      lp.frequency.exponentialRampToValueAtTime(300, end);
      const g = ctx.createGain();
      g.gain.value = p.g * 0.32;
      g.gain.setValueAtTime(p.g * 0.32, start);
      g.gain.linearRampToValueAtTime(0.0001, end);
      o.connect(lp).connect(g).connect(dest);
      o.start(0); o.stop(end);
    },
  },

  {
    id: 'rewind', section: 'Events', name: 'TAPE REWIND', hint:
      'The high whirring scrape of a tape spooling back. Noise through a rising band-pass with a mechanical flutter on top of it.',
    params: [
      { key: 'g', kind: 'pct', label: 'Gain', def: 40 },
      { key: 'at', kind: 'range', label: 'From s', min: 0, max: 40, def: 0.5 },
      { key: 'len', kind: 'range', label: 'Length s', min: 0.2, max: 10, def: 2 },
    ],
    needs: (p) => p.at + p.len + 0.2,
    build({ ctx, dest, p, dur, helpers }) {
      const start = Math.min(p.at, Math.max(0, dur - 0.1));
      const end = Math.min(dur, start + p.len);
      if (end <= start) return;
      const src = ctx.createBufferSource();
      src.buffer = helpers.noiseBuffer(ctx, end - start);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 6;
      bp.frequency.setValueAtTime(1800, start);
      bp.frequency.exponentialRampToValueAtTime(5200, end);
      // Spool flutter: a fast wobble on the amplitude, which is the mechanical
      // half of the sound.
      const g = ctx.createGain(); g.gain.value = p.g * 0.4;
      const fl = ctx.createOscillator(); fl.frequency.value = 22;
      const fa = ctx.createGain(); fa.gain.value = p.g * 0.18;
      fl.connect(fa).connect(g.gain);
      fl.start(start); fl.stop(end);
      src.connect(bp).connect(g).connect(dest);
      src.start(start); src.stop(end);
    },
  },

  /* -------------------------------------------------------------- voice -- */

  {
    id: 'breath', section: 'Events', name: 'BREATHING', hint:
      'Filtered noise shaped into an in-and-out cycle. Close-mic breathing is one of the few sounds that reads as a person in the room without a single word.',
    params: [
      { key: 'g', kind: 'pct', label: 'Gain', def: 45 },
      { key: 'bpm', kind: 'num', label: 'Breaths/min', min: 4, max: 60, def: 14 },
      { key: 'ragged', kind: 'pct', label: 'Ragged', def: 25,
        hint: 'Timing and level variation. At zero it is a machine; high it is someone who has been running.' },
    ],
    build({ ctx, dest, p, dur, rnd, helpers }) {
      const period = 60 / p.bpm;
      for (let t = 0.1; t < dur; t += period * (1 + (rnd() - 0.5) * p.ragged)) {
        // In and out are not the same sound: the inhale is brighter and shorter.
        for (const [off, len, freq, amp] of [
          [0, period * 0.34, 1100, 1],
          [period * 0.45, period * 0.42, 620, 0.8],
        ]) {
          const s = Math.min(dur, t + off), e = Math.min(dur, s + len);
          if (e <= s) continue;
          const src = ctx.createBufferSource();
          src.buffer = helpers.noiseBuffer(ctx, e - s);
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 0.9;
          const g = ctx.createGain();
          const peak = p.g * 0.55 * amp * (1 + (rnd() - 0.5) * p.ragged);
          g.gain.setValueAtTime(0.0001, s);
          g.gain.linearRampToValueAtTime(Math.max(0.0001, peak), s + len * 0.4);
          g.gain.linearRampToValueAtTime(0.0001, e);
          src.connect(bp).connect(g).connect(dest);
          src.start(s); src.stop(e);
        }
      }
    },
  },

  {
    id: 'bell', section: 'Events', name: 'BELL', hint:
      'A struck bell: inharmonic partials over a long decay. The partials are deliberately not a harmonic series — that is precisely what separates a bell from an organ.',
    params: [
      { key: 'g', kind: 'pct', label: 'Gain', def: 45 },
      { key: 'f', kind: 'num', label: 'Hz', min: 80, max: 1600, def: 420 },
      { key: 'decay', kind: 'range', label: 'Decay s', min: 0.3, max: 12, def: 4 },
      { key: 'every', kind: 'range', label: 'Every s', min: 0, max: 30, def: 0,
        hint: 'Zero strikes once at the start. Above zero it repeats — a tolling bell rather than a single note.' },
    ],
    // A single strike must be given room to ring out; a tolling one repeats
    // for as long as the render lasts and needs nothing.
    needs: (p) => (p.every <= 0.01 ? 0.05 + p.decay : 0),
    build({ ctx, dest, p, dur }) {
      // Ratios from a struck idiophone: hum, prime, minor third, fifth, nominal.
      const partials = [[0.5, 0.5], [1, 1], [1.2, 0.6], [1.5, 0.4], [2, 0.35], [2.7, 0.2]];
      const strike = (t) => {
        for (const [ratio, amp] of partials) {
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = p.f * ratio;
          const g = ctx.createGain();
          const d = Math.min(dur - t, p.decay * (1 / ratio));
          if (d <= 0.01) continue;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(p.g * 0.3 * amp, t + 0.004);
          g.gain.exponentialRampToValueAtTime(0.0001, t + d);
          o.connect(g).connect(dest);
          o.start(t); o.stop(t + d);
        }
      };
      if (p.every <= 0.01) { strike(0.05); return; }
      for (let t = 0.05; t < dur; t += p.every) strike(t);
    },
  },

  {
    id: 'whisper', section: 'Events', name: 'REVERSED WHISPER', hint:
      'Voiced noise in bursts, built so the envelope rises into each burst and cuts at the end — the shape of speech played backwards, which is the sound of a message you are not meant to understand yet.',
    params: [
      { key: 'g', kind: 'pct', label: 'Gain', def: 45 },
      { key: 'rate', kind: 'range', label: 'Bursts/s', min: 0.2, max: 12, def: 3 },
      { key: 'tone', kind: 'num', label: 'Centre Hz', min: 300, max: 4000, def: 1600 },
    ],
    build({ ctx, dest, p, dur, rnd, helpers }) {
      let t = 0.1;
      while (t < dur) {
        const len = 0.08 + rnd() * 0.22;
        const e = Math.min(dur, t + len);
        if (e <= t) break;
        const src = ctx.createBufferSource();
        src.buffer = helpers.noiseBuffer(ctx, e - t);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = p.tone * (0.6 + rnd() * 0.8);
        bp.Q.value = 4 + rnd() * 6;
        const g = ctx.createGain();
        // Slow rise, hard cut — reversed speech, not a fade in and out.
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0001, p.g * 0.7), e);
        g.gain.setValueAtTime(0.0001, e + 0.001);
        src.connect(bp).connect(g).connect(dest);
        src.start(t); src.stop(e);
        t += (1 / p.rate) * (0.6 + rnd() * 0.8);
      }
    },
  },
];

/** Every layer id, in registration order. */
export const LAYER_IDS = AUDIO_LAYERS.map((l) => l.id);

/** Clamp one declared parameter out of the raw control values. */
function resolveOne(spec, raw) {
  if (spec.kind === 'text') return typeof raw === 'string' ? raw.slice(0, 120) : String(spec.def ?? '');
  const n = Number(raw);
  const v = Number.isFinite(n) ? n : spec.def;
  if (spec.kind === 'pct') return Math.min(1, Math.max(0, v / 100));
  return Math.min(spec.max, Math.max(spec.min, v));
}

/**
 * Read every layer's state from a control reader.
 *
 * The reader is injected rather than imported so the headless suites can drive
 * this without a DOM — the same reason readVideoCfg takes an optional recipe.
 */
export function readLayerCfg({ chk, num, val }) {
  const out = {};
  for (const layer of AUDIO_LAYERS) {
    const p = { on: !!chk(TOGGLE(layer.id)), pan: Math.min(1, Math.max(-1, num(CTRL(layer.id, 'pan'), 0) / 100)) };
    for (const spec of layer.params) {
      const raw = spec.kind === 'text' ? val(CTRL(layer.id, spec.key)) : num(CTRL(layer.id, spec.key), spec.def);
      p[spec.key] = resolveOne(spec, raw);
    }
    out[layer.id] = p;
  }
  return out;
}

/**
 * Build every enabled layer into the graph.
 *
 * A layer that throws is skipped rather than taking the render down — the same
 * contract the filter chain has, and for the same reason: one bad layer must
 * not turn "render" into a dead button. It is logged, because a silent skip is
 * how a layer stays broken.
 */
export function buildLayers({ ctx, bus, cfg, dur, rnd, helpers, log }) {
  let built = 0;
  for (const layer of AUDIO_LAYERS) {
    const p = cfg[layer.id];
    if (!p || !p.on) continue;
    try {
      layer.build({ ctx, dest: bus(p.pan), p, dur, rnd, helpers });
      built++;
    } catch (e) {
      log?.(`Audio layer "${layer.name}" failed (${e.message}) — skipped.`, 'warn');
    }
  }
  return built;
}

/**
 * The longest render any enabled layer needs, or 0.
 *
 * Only layers that place content at a time the author chose declare `needs`;
 * a continuous layer fills whatever length it is given.
 */
export function layersNeedSeconds(cfg) {
  let n = 0;
  for (const layer of AUDIO_LAYERS) {
    const p = cfg?.[layer.id];
    if (!p || !p.on || !layer.needs) continue;
    const v = Number(layer.needs(p));
    if (Number.isFinite(v) && v > n) n = v;
  }
  return n;
}
