/* Dead Signal Studio — module graph smoke (headless, no browser).
 *
 * Mirrors scripts/test-boot-smoke.mjs: imports the real module graph so that
 * load-time throws, missing or renamed exports, bad re-exports and circular-
 * import hazards fail here rather than in a browser tab. Several modules touch
 * the DOM at module scope (scratch canvases), so a minimal stub is installed
 * first — the same approach the FileSystemManager / SessionManager suites use.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC  = join(HERE, 'src');

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fail++; else pass++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};

/* ------------------------------------------------------------- DOM stub -- */
const stubCtx = new Proxy({}, {
  get: (t, k) => {
    if (k === 'canvas') return { width: 0, height: 0 };
    if (k === 'createImageData' || k === 'getImageData')
      return (w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
    if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient')
      return () => ({ addColorStop() {} });
    if (k === 'measureText') return () => ({ width: 0 });
    return () => {};
  },
  set: () => true,
});
const makeEl = (tag) => ({
  tagName: String(tag).toUpperCase(), style: {}, dataset: {}, children: [], width: 0, height: 0,
  getContext: () => stubCtx, appendChild() {}, removeChild() {}, remove() {},
  setAttribute() {}, removeAttribute() {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], click() {}, focus() {},
  toBlob(cb) { cb?.(null); }, pause() {}, play() { return Promise.resolve(); },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
});
globalThis.document = {
  createElement: makeEl,
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  documentElement: { style: { setProperty() {} } },
  body: makeEl('body'),
};
// Several modules register window-level listeners at module scope (blobs.js
// revokes object URLs on beforeunload), so globalThis needs these before it
// stands in for `window`.
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.window = globalThis;
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};
globalThis.URL.createObjectURL = () => 'blob:stub';
globalThis.URL.revokeObjectURL = () => {};
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.MediaRecorder = undefined;

/* --------------------------------------------------------------- files --- */
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.js') ? [p] : []);
});
const files = walk(SRC).sort();

console.log('Dead Signal Studio module graph');
console.log('-'.repeat(58));
check(`found modules under src/`, files.length > 0, `${files.length} files`);

/* Every module must import cleanly on its own — this is what catches a missing
   export, a typo'd path, or a cycle that deadlocks at evaluation time. */
const namespaces = new Map();
for (const f of files) {
  const rel = relative(SRC, f);
  try {
    namespaces.set(rel, await import(pathToFileURL(f).href));
  } catch (e) {
    check(`import ${rel}`, false, e.message.split('\n')[0]);
  }
}
check(`all ${files.length} modules import cleanly`, namespaces.size === files.length,
      `${namespaces.size}/${files.length}`);

/* Every module should export something; a module that exports nothing is
   either dead or accidentally shadowed. */
{
  const empty = [...namespaces].filter(([, ns]) => Object.keys(ns).length === 0).map(([r]) => r);
  check('every module exports at least one binding', empty.length === 0, empty.join(', '));
}

/* No export may be undefined at evaluation time — that is the signature of a
   circular import resolving in the wrong order. */
{
  const bad = [];
  for (const [rel, ns] of namespaces)
    for (const [k, v] of Object.entries(ns))
      if (v === undefined && k !== 'default') bad.push(`${rel}:${k}`);
  check('no export is undefined (circular-import hazard)', bad.length === 0, bad.join(', '));
}

/* The registries must actually be populated by their side-effecting modules. */
{
  const scenes = namespaces.get(join('video', 'scenes.js'))?.SCENES;
  const tpls   = namespaces.get(join('image', 'templates.js'))?.TEMPLATES;
  check('scene registry is populated', scenes && Object.keys(scenes).length >= 20,
        `${scenes ? Object.keys(scenes).length : 0} scenes`);
  check('template registry is populated', tpls && Object.keys(tpls).length >= 20,
        `${tpls ? Object.keys(tpls).length : 0} templates`);
  const noDraw = Object.values(scenes || {}).filter(s => typeof s.draw !== 'function').map(s => s.id);
  check('every scene has a draw function', noDraw.length === 0, noDraw.join(', '));
  const noDrawT = Object.values(tpls || {}).filter(t => typeof t.draw !== 'function').map(t => t.id);
  check('every template has a draw function', noDrawT.length === 0, noDrawT.join(', '));
}

/* Pure helpers should work with no DOM at all. */
{
  const { morseOf, morseSpan } = namespaces.get(join('core', 'text.js')) ?? {};
  check('morse encodes', morseOf?.('SOS') === '... --- ...', morseOf?.('SOS'));
  check('morse span is positive', morseSpan?.('SOS', 0.1) > 0);

  const { crc32, strU8 } = namespaces.get(join('library', 'zip.js')) ?? {};
  // CRC-32 of "123456789" is the standard check value 0xCBF43926.
  check('crc32 matches the standard check value',
        crc32?.(strU8('123456789')) === 0xCBF43926,
        '0x' + (crc32?.(strU8('123456789')) >>> 0).toString(16));

  const { encodeWav } = namespaces.get(join('audio', 'wav.js')) ?? {};
  const wav = encodeWav?.(new Float32Array(64), 8000, 16);
  check('wav encoder produces a blob of the right size',
        wav && wav.size === 44 + 64 * 2, `${wav?.size} bytes`);

  const { slug } = namespaces.get(join('library', 'library.js')) ?? {};
  check('slug sanitises a filename', slug?.('Webb — Last Session!') === 'webb_last_session',
        slug?.('Webb — Last Session!'));
}

/* Photosensitivity detector. Pure maths over a luminance sequence, so it can
   be checked against known input without a canvas — which is the only way to
   assert the WCAG rule rather than "the number moved". */
{
  const fm = namespaces.get(join('ui', 'flashmeter.js')) ?? {};
  const { feedLuminance, resetFlashMeter, currentRate, THRESHOLD_HZ } = fm;

  const run = (pairs) => {              // [[lum, tMs], ...] -> flashes counted
    resetFlashMeter();
    let last = 0;
    for (const [l, t] of pairs) { feedLuminance(l, t); last = t; }
    return { rate: feedLuminance(pairs.at(-1)[0], last) };
  };

  check('WCAG threshold is 3 flashes per second', THRESHOLD_HZ === 3, String(THRESHOLD_HZ));

  // Black <-> white at 10 Hz: unambiguously over the limit.
  const strobe = [];
  for (let i = 0; i < 20; i++) strobe.push([i % 2 ? 0.9 : 0.0, i * 50]);
  check('a 10Hz black/white strobe is over the limit', run(strobe).rate > 3,
        run(strobe).rate.toFixed(1) + '/s');

  // Same swing at 1 Hz: under.
  const slow = [];
  for (let i = 0; i < 4; i++) slow.push([i % 2 ? 0.9 : 0.0, i * 500]);
  check('the same swing at 1Hz is under the limit', run(slow).rate <= 3,
        run(slow).rate.toFixed(1) + '/s');

  // A swing below 0.1 relative luminance is not a flash at any rate — this is
  // why the studio's own blink overlay (12% white over near-black) reads zero.
  const subtle = [];
  for (let i = 0; i < 20; i++) subtle.push([i % 2 ? 0.06 : 0.0, i * 50]);
  check('a sub-threshold swing is never a flash', run(subtle).rate === 0,
        run(subtle).rate.toFixed(1) + '/s');

  // A monotonic ramp has no opposing pair, so it is not flashing.
  const ramp = [];
  for (let i = 0; i < 20; i++) ramp.push([i / 20, i * 50]);
  check('a monotonic ramp is not counted as flashing', run(ramp).rate === 0,
        run(ramp).rate.toFixed(1) + '/s');

  resetFlashMeter();
  check('reset clears the history', currentRate() === 0);
}

/* Blink overlay: the word branch must emit decodable morse — dot = 1 unit,
   dash = 3, with real gaps — not one sustained flash per cycle (the old form
   stripped morseOf's separators and lit one unit per remaining character). */
{
  const { drawOverlays } = namespaces.get(join('video', 'render.js')) ?? {};
  const u = 0.14, units = [];
  const rctx = { set fillStyle(v) {}, save() {}, restore() {}, fillText() {},
    fillRect(x, y, w, h) { if (w === 320 && h === 240) rctx._hit = true; } };
  const cfg = { hud: '', tc: false, morse: '', blink: 'SOS', reveal: '', sub: '',
                duration: 10, fg: '#fff', fps: 12 };
  for (let k = 0; k < 80; k++) { rctx._hit = false; drawOverlays?.(rctx, 320, 240, cfg, (k + 0.5) * u); units.push(rctx._hit ? 1 : 0); }
  const runs = []; let cur = units[0], n = 0;
  for (const v of units) { if (v === cur) n++; else { runs.push({ v: cur, n }); cur = v; n = 1; } } runs.push({ v: cur, n });
  const on = runs.filter(r => r.v === 1).map(r => r.n).slice(0, 9);
  check('blink code: SOS is dots, dashes and gaps, not one flash',
        JSON.stringify(on) === '[1,1,1,3,3,3,1,1,1]', JSON.stringify(on));
}

/* pixel-sort: a pixel with lum>=hi (any white template) must not hang the row
   scan — the span-START test used to accept what the span-CONTINUE test
   rejected, so x never advanced — and mid-luminance spans must still sort. */
{
  const { fxPixelSort } = namespaces.get(join('fx', 'still.js')) ?? {};
  const W = 8, H = 1;
  const mk = (greys) => { const d = new Uint8ClampedArray(W * H * 4);
    greys.forEach((g, x) => { d[x * 4] = d[x * 4 + 1] = d[x * 4 + 2] = g; d[x * 4 + 3] = 255; }); return d; };
  const ctxFor = (d) => ({ getImageData: () => ({ data: d, width: W, height: H }), putImageData() {} });
  const white = mk([255, 255, 255, 255, 255, 255, 255, 255]);   // the http404 fill — used to loop forever
  const t0 = Date.now();
  fxPixelSort?.(ctxFor(white), W, H, 0.5);
  check('pixel-sort terminates on an all-white row', Date.now() - t0 < 1000, `${Date.now() - t0}ms`);
  const spanned = mk([0, 180, 100, 140, 0, 0, 0, 0]);
  fxPixelSort?.(ctxFor(spanned), W, H, 1);   // lo=60 hi=200 — [180,100,140] is one sortable span
  check('pixel-sort still sorts a mid-luminance span',
        spanned[4] === 100 && spanned[8] === 140 && spanned[12] === 180,
        [spanned[4], spanned[8], spanned[12]].join(','));
}

/* Loop crossfade: nothing pinned the seam numerically before — the audit only
   asserts the hash changes, which the backwards weights also passed. */
{
  const { loopCrossfade } = namespaces.get(join('audio', 'engine.js')) ?? {};
  // Non-loop-aligned sine with tail material, as renderAudio provides it.
  const sr = 1000, total = Math.floor(sr * 2.5);
  const sig = new Float32Array(total);
  for (let i = 0; i < total; i++) sig[i] = Math.sin(2 * Math.PI * 7.3 * i / sr);
  const out = loopCrossfade?.(sig, sr, 2) ?? new Float32Array(2);
  let typ = 0;
  for (let i = 1; i < out.length; i++) typ += Math.abs(out[i] - out[i - 1]);
  typ /= out.length - 1;
  const seam = Math.abs(out[0] - out[out.length - 1]);
  const xf = Math.min(Math.floor(0.4 * sr), Math.floor(out.length * 0.2));
  const hand = Math.abs(out[xf] - out[xf - 1]);
  check('loop crossfade closes the seam (wrap step ≈ inter-sample step)',
        seam <= typ * 3, `seam ${seam.toFixed(4)} vs typical ${typ.toFixed(4)}`);
  check('no click where the crossfade hands back to head material',
        hand <= typ * 3, `step ${hand.toFixed(4)} vs typical ${typ.toFixed(4)}`);
  check('at the loop point the output is the tail continuation',
        Math.abs(out[0] - sig[out.length]) < 1e-6, `${out[0]} vs ${sig[out.length]}`);
}

/* RIFF word alignment: mono 24-bit with an odd sample count has an odd data
   chunk, which takes one zero pad byte — counted in the RIFF size, never in
   the data chunk size (decoders must see identical audio). */
{
  const { encodeWav } = namespaces.get(join('audio', 'wav.js')) ?? {};
  const odd = encodeWav?.(new Float32Array(101), 22050, 24);
  const ov = new DataView(await odd.arrayBuffer());
  check('odd data chunk gets its pad byte', odd.size === 44 + 303 + 1, `${odd?.size} bytes`);
  check('RIFF size counts the pad, data size does not',
        ov.getUint32(4, true) === 36 + 303 + 1 && ov.getUint32(40, true) === 303
        && ov.getUint8(44 + 303) === 0,
        `riff ${ov.getUint32(4, true)}, data ${ov.getUint32(40, true)}`);
}

/* Cross-module references that were never imported. Importing a module proves
   its top level runs; it does NOT prove that a name used inside a function body
   resolves. That gap is exactly how a mechanical split loses a reference — a
   second declaration sharing a line with an export stays module-private while
   its uses move away — and the failure only appears when a user reaches that
   code path. */
{
  /* Order matters. Regex literals are blanked BEFORE line comments, because
     `/^image\//` ends in the character pair `//` and a naive trailing-comment
     strip would cut the line in half there and drop real references.
     Comments were previously only stripped when they occupied a whole line,
     which meant prose in a trailing comment could be read as code — a false
     positive that pushes you to reword a comment to satisfy a checker, which
     is exactly the wrong incentive. */
  const strip = (t) => t
    .replace(/\/\*[\s\S]*?\*\//g, ' ')          // block comments
    // A `/` that follows an operator, bracket or line start begins a regex.
    .replace(/(^|[=(,:;!&|?{}[+\-*%<>~^]\s*)\/(?![*/])(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[gimsuy]*/g, '$1 RE ')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/\/\/[^\n]*/g, ' ')                 // line comments, trailing included
    .replace(/([A-Za-z_$][\w$]*)\s*:/g, ':')     // object-literal keys
    .replace(/^import[^\n]*$/gm, '');

  const owner = new Map(), meta = new Map(), text = new Map();
  for (const f of files) {
    const t = readFileSync(f, 'utf8'); text.set(f, t);
    const own = (n) => owner.set(n, f);
    for (const m of t.matchAll(/^export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/gm)) own(m[1]);
    for (const m of t.matchAll(/^export\s+(?:const|let|var)\s+([^=;]+)/gm))
      for (const p of m[1].split(',')) { const n = p.trim().match(/^([A-Za-z_$][\w$]*)/); if (n) own(n[1]); }

    const priv = new Set(), imp = new Set();
    // Leading whitespace matters: locals inside a function are indented, and
    // anchoring at column zero made every one of them look like a missing
    // cross-module import.
    for (const m of t.matchAll(/^\s*(?:const|let|var)\s+([^=;]+)/gm))
      // handles plain names, `const { a, b } = x` and `const [a, b] = x`
      for (const p of m[1].replace(/[{}[\]]/g, ' ').split(','))
        { const n = p.trim().match(/^([A-Za-z_$][\w$]*)/); if (n) priv.add(n[1]); }
    // destructuring anywhere, not just at the start of a line
    for (const m of t.matchAll(/(?:const|let|var)\s*[{[]([^}\]]*)[}\]]\s*(?:=|\bof\b|\bin\b)/g))
      for (const p of m[1].split(',')) { const n = p.trim().split(':').pop().trim().match(/^([A-Za-z_$][\w$]*)/); if (n) priv.add(n[1]); }
    for (const m of t.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) priv.add(m[1]);
    for (const m of t.matchAll(/;\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) priv.add(m[1]);
    // Function parameters are locals too. Without these, a parameter that
    // happens to share a name with another module's export (`lum`, `set`,
    // `index`) reads as a missing import.
    const addParams = (list) => {
      for (const p of list.replace(/[{}[\]]/g, ' ').split(',')) {
        const n = p.trim().split(/[:=]/)[0].trim().replace(/^\.\.\./, '').match(/^([A-Za-z_$][\w$]*)/);
        if (n) priv.add(n[1]);
      }
    };
    for (const m of t.matchAll(/(?:async\s+)?function\s*[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g)) addParams(m[1]);
    for (const m of t.matchAll(/(?:async\s+)?function\s*\(([^)]*)\)/g)) addParams(m[1]);
    for (const m of t.matchAll(/\(([^()]*)\)\s*=>/g)) addParams(m[1]);
    for (const m of t.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) priv.add(m[1]);
    for (const m of t.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/gm)) addParams(m[2]);  // object methods
    for (const m of t.matchAll(/^import\s*\{([^}]*)\}/gm))
      for (const n of m[1].split(',')) { const id = n.trim().split(/\s+as\s+/).pop().trim(); if (id) imp.add(id); }
    meta.set(f, { priv, imp });
  }

  const missing = [];
  const dupes = [];
  const seen = new Map();
  for (const f of files) {
    const { priv, imp } = meta.get(f);
    const code = strip(text.get(f));
    const used = [...code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)/g)]
      .filter((m) => m[1] !== '$' || code[m.index + 1] === '(');
    for (const m of new Set(used.map((x) => x[1]))) {
      const own = owner.get(m);
      if (own && own !== f && !imp.has(m) && !priv.has(m))
        missing.push(`${relative(SRC, f)} uses "${m}" (owned by ${relative(SRC, own)})`);
    }
    // a name exported by two modules is a trap even when it happens to work
    for (const m of text.get(f).matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (seen.has(m[1]) && seen.get(m[1]) !== f)
        dupes.push(`"${m[1]}" exported by both ${relative(SRC, seen.get(m[1]))} and ${relative(SRC, f)}`);
      seen.set(m[1], f);
    }
  }
  check('no cross-module reference is missing its import', missing.length === 0, missing.slice(0, 4).join(' | '));
  check('no export name is claimed by two modules', dupes.length === 0, dupes.slice(0, 4).join(' | '));
}

/* ------------------------------------------- the document is authoritative -- */
/* val()/num()/chk() read the DOCUMENT and never look at the DOM, so assigning
 * `.value` straight onto a control changes the widget on screen and nothing
 * else. That is not a hypothetical: it silently broke image import (the Scene
 * select flipped to Ken Burns while the renderer carried on drawing the old
 * scene, so the picture "never showed up"), video import, the seed roller, the
 * aspect-ratio helper, the aesthetic palettes, every preset, per-section RESET
 * and the validation banner's FIX buttons — nine features, one habit, no error
 * message anywhere.
 *
 * setVal() in core/dom.js is the one sanctioned writer. Two files are exempt:
 * core/dom.js defines it, and doc/bind.js renders the document BACK to the DOM,
 * which must assign directly or the events would loop.
 */
{
  const EXEMPT = new Set(['core/dom.js', 'doc/bind.js']);
  /* Receivers that are DOM controls: a `$("id")` lookup, or one of the names
     the codebase uses for an element it is iterating over. Deliberately NOT a
     bare identifier — Web Audio's gain/pan/frequency/detune are AudioParams
     with a .value that must be assigned directly, and flagging those would be
     noise that gets the whole gate switched off. `.checked` has no such
     collision, so any receiver counts for it. */
  const ASSIGN = new RegExp(
    '(?:' +
      '(?:\\$\\(\\s*["\'][^"\']+["\']\\s*\\)|\\b(?:e|el|els|elem|sel|node|input|ctrl|target)\\b)\\s*\\.value' +
      '|\\b[a-zA-Z_$][\\w$]*\\s*\\.checked' +
    ')\\s*=(?!=)', 'g');
  const offenders = [];
  for (const f of files) {
    const rel = relative(SRC, f).replace(/\\/g, '/');
    if (EXEMPT.has(rel)) continue;
    const src = readFileSync(f, 'utf8');
    for (const line of src.split('\n')) {
      /* An explicit, greppable opt-out for the handful of controls that are
         genuinely not document-bound (the CLOUD and BUNDLE panels), and for the
         two places where dispatching would be wrong rather than merely
         unnecessary. Each use carries its reason on the same line. */
      if (line.includes('dom-only')) continue;
      const m = line.match(ASSIGN);
      if (m) offenders.push(`${rel}: ${m[0].trim()}`);
    }
  }
  check('no module writes a control by assigning .value/.checked (use setVal)',
        offenders.length === 0, offenders.slice(0, 6).join(' | '));
}

/* ---------------------------------------------------- docs stay true ----- */
/* The README's load-bearing counts, pinned to the code so the docs cannot
   silently rot again (they once claimed ten layers, six tabs and a smaller
   gate range for a tool that had grown past all three). */
{
  const readme = readFileSync(join(HERE, 'README.md'), 'utf8');
  // The layer table under "The 26 sound layers" must actually enumerate 26.
  const table = readme.split('## The 26 sound layers')[1]?.split('##')[0] ?? '';
  const rows = [...table.matchAll(/^\|\s*\*\*[^|]+\*\*\s*\|([^|]+)\|/gm)];
  const layerCount = rows.reduce((n, m) => n + m[1].split('·').length, 0);
  check('README layer table enumerates 26 layers', layerCount === 26, `counted ${layerCount}`);
  check('README documents the heartbeat layer', /heartbeat/i.test(table));

  // The number-key tab mapping in boot.js must cover every tab index.html renders.
  const boot = readFileSync(join(SRC, 'boot.js'), 'utf8');
  const html = readFileSync(join(HERE, 'index.html'), 'utf8');
  const tabs = [...html.matchAll(/data-view="([a-z]+)" role="tab"/g)].map((m) => m[1]);
  const map = boot.match(/activateTab\(\[([^\]]+)\]/)?.[1].match(/"([a-z]+)"/g)?.map((s) => s.slice(1, -1)) ?? [];
  check('every rendered tab is reachable from the number keys',
        tabs.length === 8 && tabs.every((t) => map.includes(t)),
        `tabs=[${tabs}] keys=[${map}]`);
  check('README keyboard line matches the mapping', readme.includes('`1‑8` tabs') && map.length === 8,
        `${map.length} keys`);

  // The gate range the Tests section claims must match ci-gate.sh.
  const gate = readFileSync(join(HERE, '..', '..', 'scripts', 'ci-gate.sh'), 'utf8');
  const studioGates = [...gate.matchAll(/report "media studio /g)].length;
  check('ci-gate.sh runs ten media-studio gates', studioGates === 10, `found ${studioGates}`);
  check('README claims gates 29–38', readme.includes('gates 29–38'));
}

console.log('-'.repeat(58));
console.log(`Dead Signal Studio module graph: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
