/* Dead Signal Studio — determinism contract (headless, no browser).
 *
 * Pins the property that F-01 broke: randomness must be REPRODUCIBLE for a
 * given (seed, frame, stream) and must VARY across frames. The old engine
 * reseeded to `seed` at the top of every frame, so anything not derived from
 * `t` produced byte-identical output forever — static that never moved, and a
 * flicker test whose boolean never changed.
 *
 * Imports the real module. No canvas, no DOM beyond a two-line stub for the
 * seed input that currentSeed() reads.
 */
import {
  seedRng, rnd, rrange, rint, hash32, beginFrame, seedStream, seedStatic, resetSeed,
} from './src/core/rng.js';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fail++; else pass++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};

/* currentSeed() reads the #seed input; the smallest stub that satisfies it. */
let SEED_VALUE = '1947';
globalThis.document = { getElementById: (id) => (id === 'seed' ? { value: SEED_VALUE } : null) };

const draw = (n = 8) => Array.from({ length: n }, () => rnd());
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

console.log('Dead Signal Studio determinism');
console.log('-'.repeat(58));

/* ------------------------------------------------------------- hash32 ---- */
{
  check('hash32 is deterministic', hash32(1947, 3, 'noise') === hash32(1947, 3, 'noise'));
  check('hash32 varies with frame',  hash32(1947, 3, 'noise') !== hash32(1947, 4, 'noise'));
  check('hash32 varies with stream', hash32(1947, 3, 'noise') !== hash32(1947, 3, 'flicker'));
  check('hash32 varies with seed',   hash32(1947, 3, 'noise') !== hash32(1948, 3, 'noise'));
  check('hash32 never returns 0', ![0, 1, 2, 7, 99, 1947, 0xffffffff]
    .some(s => [0, 1, 5, 1000].some(f => hash32(s, f, 'x') === 0)));
  // A zero state would lock mulberry32 into a degenerate sequence.
  const outs = new Set();
  for (let f = 0; f < 500; f++) outs.add(hash32(1947, f, 'noise'));
  check('hash32 spreads across 500 frames', outs.size === 500, `${outs.size}/500 distinct`);
}

/* -------------------------------------------------------- reproducible --- */
{
  seedRng(12345); const a = draw();
  seedRng(12345); const b = draw();
  check('same seed reproduces the same sequence', same(a, b));
  seedRng(12346); const c = draw();
  check('a different seed diverges', !same(a, c));
}

/* ------------------------------------------------------------ animation -- */
{
  beginFrame(0); const f0 = draw();
  beginFrame(1); const f1 = draw();
  beginFrame(2); const f2 = draw();
  check('consecutive frames differ (F-01 regression)',
        !same(f0, f1) && !same(f1, f2) && !same(f0, f2));

  beginFrame(7); const a = draw();
  beginFrame(99); draw();                 // wander off
  beginFrame(7); const b = draw();
  check('re-entering a frame reproduces it exactly (seek == playback)', same(a, b));
}

/* -------------------------------------------------------------- streams -- */
{
  beginFrame(5);
  seedStream('noise');   const noise5 = draw();
  seedStream('flicker'); const flick5 = draw();
  check('named streams are independent', !same(noise5, flick5));

  beginFrame(5); seedStream('noise');
  check('a stream is reproducible within a frame', same(draw(), noise5));

  beginFrame(6); seedStream('noise');
  check('a stream varies across frames', !same(draw(), noise5));

  // The real defect: a boolean threshold drawn once per frame must not latch.
  const flips = new Set();
  for (let f = 0; f < 64; f++) { beginFrame(f); seedStream('flicker'); flips.add(rnd() < 0.5); }
  check('a per-frame boolean actually toggles', flips.size === 2, `${flips.size} distinct values`);
}

/* --------------------------------------------------------------- static -- */
{
  beginFrame(1); seedStatic('matrix'); const m1 = draw();
  beginFrame(2); seedStatic('matrix'); const m2 = draw();
  beginFrame(900); seedStatic('matrix'); const m3 = draw();
  check('seedStatic is frame-invariant (stable scene layout)', same(m1, m2) && same(m2, m3));

  beginFrame(1); seedStatic('radar');
  check('static streams are still per-name', !same(draw(), m1));
}

/* ---------------------------------------------------------------- seed --- */
{
  SEED_VALUE = '1947'; beginFrame(3); const a = draw();
  SEED_VALUE = '999999'; beginFrame(3); const b = draw();
  SEED_VALUE = '1947'; beginFrame(3); const c = draw();
  check('changing the seed changes output, and reverting restores it',
        !same(a, b) && same(a, c));

  SEED_VALUE = 'not-a-number'; resetSeed();
  const d = draw();
  check('a non-numeric seed does not produce NaN', d.every(Number.isFinite));
}

/* --------------------------------------------------------------- ranges -- */
{
  seedRng(4242);
  let okR = true, okI = true;
  const ints = new Set();
  for (let i = 0; i < 20000; i++) {
    const r = rrange(-3, 7); if (r < -3 || r >= 7) okR = false;
    const n = rint(0, 5); if (n < 0 || n > 5 || !Number.isInteger(n)) okI = false;
    ints.add(n);
  }
  check('rrange stays within bounds', okR);
  check('rint stays within bounds and is integral', okI);
  check('rint covers its full inclusive range', ints.size === 6, `${ints.size}/6 values`);
  seedRng(1); const u = draw(5000);
  check('rnd stays in [0,1)', u.every(v => v >= 0 && v < 1));
}

console.log('-'.repeat(58));
console.log(`Dead Signal Studio determinism: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
