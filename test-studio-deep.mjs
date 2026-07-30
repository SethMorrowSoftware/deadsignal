/* Dead Signal Studio — the deep audit (Chromium).
 *
 * The other browser suites ask "does it render" and "is each control wired".
 * This one asks the questions those cannot, ONE SCENE, ONE TEMPLATE, ONE FILTER
 * AND ONE LAYER AT A TIME:
 *
 *   does it change over time?          A scene that draws a still picture where
 *                                      it promises motion looks fine in a
 *                                      screenshot and is dead on a timeline.
 *   is it the same twice?              Determinism is asserted globally by
 *                                      test-studio-rng.mjs; asserted per scene
 *                                      it says WHICH one reseeds wrongly.
 *   does it use the colours it is given? Every scene's own docblock says it must
 *                                      fill its background from cfg.bg. Nothing
 *                                      checked that, and a scene that ignores it
 *                                      cannot be themed, cannot be composited
 *                                      additively, and paints black over an
 *                                      overlay it was supposed to sit inside.
 *   does it survive the edges?         1x1, a huge frame, t far past the end,
 *                                      empty copy, and copy far longer than the
 *                                      frame.
 *
 * Deliberately built on the REGISTRIES rather than on the pickers: a scene that
 * failed to register is a scene the picker never lists, and a suite driven by
 * the picker would score that as a pass by never testing it. The counts are
 * asserted against the registry so a scene lost in a refactor is a failure here
 * rather than a silent absence.
 */
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(HERE, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(HERE) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PAGE = `http://127.0.0.1:${server.address().port}/index.html`;

let chromium;
try { ({ chromium } = await import('playwright')); }
catch {
  try { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
  catch { console.log('Dead Signal Studio deep audit: playwright not installed — SKIPPED'); process.exit(0); }
}
const EXEC = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));

let pass = 0; let fail = 0;
const failures = [];
const check = (name, ok, extra = '') => {
  if (!ok) { fail++; failures.push(name + (extra ? ' — ' + extra : '')); } else pass++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};
const section = (t) => console.log(`\n[${t}]`);

console.log('Dead Signal Studio deep audit');
console.log('-'.repeat(64));

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.DeadSignalStudio, null, { timeout: 30000 });

/* The probe. Installed once and reused by every section below: rendering a
   scene off-screen at a known (seed, t) and reducing the pixels to numbers that
   can be compared. Off-screen rather than through the preview because the
   preview quantises to a frame grid, throttles under load, and would make every
   "does it change" question a question about timing. */
await page.evaluate(async () => {
  const S = window.DeadSignalStudio;
  const scenes = await import('./src/video/scenes.js');
  const tpls = await import('./src/image/templates.js');
  const img = await import('./src/image/render.js');
  window.__deep = {
    sceneIds: Object.keys(scenes.SCENES).sort(),
    tplIds: Object.keys(tpls.TEMPLATES).sort(),
    /** One scene frame, reduced to a hash plus a colour census. */
    shot(over, t, W = 160, H = 120) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const cfg = { ...S.readVideoCfg(), W, H, persist: 0, ...over };
      S.renderVideoFrame(ctx, W, H, cfg, t);
      const d = ctx.getImageData(0, 0, W, H).data;
      let h = 5381; let lit = 0; let sum = 0;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4) {
        const l = d[i] + d[i + 1] + d[i + 2];
        h = (((h * 33) ^ l) >>> 0);
        sum += l;
        if (l > 24) lit++;
        if (seen.size < 64) seen.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
      }
      return { h, lit, colours: seen.size, mean: Math.round(sum / (d.length / 4)) };
    },
    /** One screen template, same treatment. */
    screen(over, W = 200, H = 150) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const cfg = { ...S.readImageCfg(), W, H, ...over };
      img.drawImageTo(ctx, W, H, cfg);
      const d = ctx.getImageData(0, 0, W, H).data;
      let h = 5381; let lit = 0;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4) {
        const l = d[i] + d[i + 1] + d[i + 2];
        h = (((h * 33) ^ l) >>> 0);
        if (l > 24) lit++;
        if (seen.size < 64) seen.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
      }
      return { h, lit, colours: seen.size };
    },
  };
});

/* ============================================================== scenes === */
/* Rendered straight through renderVideoFrame with an explicit cfg, so each
   claim is about the SCENE and not about the preview loop, the throttle or the
   tab that happens to be open. */
section('every scene, one at a time');
{
  const ids = await page.evaluate(() => window.__deep.sceneIds);
  check(`the registry holds every scene the tool ships`, ids.length === 48, `${ids.length}`);

  const results = await page.evaluate((ids) => {
    const D = window.__deep;
    const out = {};
    for (const scene of ids) {
      const base = { scene, text: 'DEEP AUDIT', seed: 4242 };
      const r = { };
      try {
        const a = D.shot(base, 0);
        const b = D.shot(base, 1.7);
        const again = D.shot(base, 0);
        // A different seed on the same frame: anything with randomness in it
        // must differ, and anything without legitimately need not.
        const other = D.shot({ ...base, seed: 999111 }, 0);
        // Colours it was NOT given. A scene that fills its own background from
        // cfg.bg — the house rule in every scenes file's docblock — cannot
        // render identically on two different grounds.
        const swapped = D.shot({ ...base, bg: '#204060', fg: '#ffcc00' }, 0);
        r.blank = a.lit === 0;
        r.animates = a.h !== b.h;
        r.stable = a.h === again.h;
        r.seedSensitive = a.h !== other.h;
        r.honoursColour = a.h !== swapped.h;
        r.colours = a.colours;
        r.mean = a.mean;
      } catch (e) { r.threw = String(e && e.message || e).slice(0, 90); }
      out[scene] = r;
    }
    return out;
  }, ids);

  const threw = ids.filter((s) => results[s].threw);
  check('no scene throws while rendering', threw.length === 0,
    threw.map((s) => `${s}: ${results[s].threw}`).join(' | '));

  const blank = ids.filter((s) => results[s].blank);
  check('no scene renders a blank frame', blank.length === 0, blank.join(', '));

  /* videoin and kenburns draw a "load something" placeholder until media is
     imported, and a placeholder is a still picture on purpose. Everything else
     is a moving image and has to move. */
  const STATIC_OK = new Set(['videoin', 'kenburns']);
  const frozen = ids.filter((s) => !results[s].animates && !STATIC_OK.has(s));
  check('every scene that is not a placeholder changes over time', frozen.length === 0, frozen.join(', '));

  /* …and it has to be the SCENE that moves, not the stack on top of it.
     shot() renders the whole pipeline, and the default CRT settings carry
     animated static and flicker — so a scene whose body never reads `t` scored
     a pass on the check above purely from the noise laid over it. Two of them
     were doing exactly that (SMPTE Color Bars and Surveillance Cam: `t` was a
     declared parameter neither one ever used), and an author who put either on
     a timeline got a freeze-frame with grain on it.
     So ask again with every post effect and every overlay silenced. What is
     left is the scene and nothing else. */
  const quietFrozen = await page.evaluate((args) => {
    const D = window.__deep;
    const [ids, staticOk] = args;
    const QUIET = {                       // everything the stack could animate
      scan: 0, noise: 0, vig: 0, flick: 0, glitch: 0, chroma: 0, bloom: 0,
      persist: 0, mask: 0, hum: 0, track: 0, shake: 0, roll: 0, dither: false,
      corrupt: 0, fade: 0,
      hud: '', tc: false, morse: '', blink: '', reveal: '', sub: '',
      layers: [], filters: [], __auto: null,
      text: 'DEEP AUDIT', seed: 4242, duration: 6,
    };
    const out = [];
    for (const scene of ids) {
      if (staticOk.includes(scene)) continue;
      try {
        // Three samples, not two: a one-second period would alias against a
        // single pair and read as frozen when it is merely slow.
        const h = [0, 1.7, 3.9].map((t) => D.shot({ ...QUIET, scene }, t).h);
        if (h[0] === h[1] && h[1] === h[2]) out.push(scene);
      } catch { /* the throw check above already owns this */ }
    }
    return out;
  }, [ids, [...STATIC_OK]]);
  check('…and it is the scene moving, not the CRT stack over it',
        quietFrozen.length === 0, quietFrozen.join(', ') || 'all 46 animate on their own');

  const unstable = ids.filter((s) => !results[s].stable);
  check('every scene renders the same frame twice from the same seed', unstable.length === 0,
    unstable.join(', '));

  /* The house rule every scenes file states in its own docblock: fill your own
     background from cfg.bg. A scene that ignores it cannot be themed, and — the
     part that actually breaks — paints opaque black over the clip it was
     composited into. */
  const ignoresColour = ids.filter((s) => !results[s].honoursColour);
  check('every scene draws with the colours it is handed', ignoresColour.length === 0,
    ignoresColour.join(', '));

  const flat = ids.filter((s) => results[s].colours < 3);
  check('no scene is a flat wash of one or two colours', flat.length === 0,
    flat.map((s) => `${s}(${results[s].colours})`).join(', '));

  /* The edges. A 1x1 frame and a 4000-wide one are both things a delivery
     format or a batch can ask for, and t far past the end is what a trimmed
     clip with a long recipe produces. */
  const edges = await page.evaluate((ids) => {
    const D = window.__deep;
    const bad = [];
    for (const scene of ids) {
      /* REACHABLE sizes only. MIN_W/MIN_H clamp the controls to 64x48, the
         gallery draws its cards at 128x96, and the widest and tallest deliveries
         the format list offers are 21:9 and 9:16 — so those are the shapes a
         scene actually has to survive. A 1x1 canvas is not one of them, and
         asserting it would be reporting a bug nobody can reach. */
      for (const [W, H, t, label] of [[64, 48, 0, 'minimum'], [128, 96, 0, 'gallery card'],
                                      [1080, 1920, 0, 'vertical'], [1920, 1080, 0, 'wide'],
                                      [1120, 480, 0, 'ultrawide'], [160, 120, 999, 't=999']]) {
        try { D.shot({ scene, text: 'X', seed: 7 }, t, W, H); }
        catch (e) { bad.push(`${scene}@${label}: ${String(e && e.message || e).slice(0, 60)}`); }
      }
      for (const text of ['', 'X'.repeat(4000), '\n\n\n', '<script>x</script>', '🙂🙂🙂']) {
        try { D.shot({ scene, text, seed: 7 }, 0.5); }
        catch (e) { bad.push(`${scene}@text: ${String(e && e.message || e).slice(0, 60)}`); }
      }
    }
    return bad;
  }, ids);
  check('every scene survives every frame shape the tool can actually be set to',
    edges.filter((b) => !/@text/.test(b)).length === 0,
    edges.filter((b) => !/@text/.test(b)).slice(0, 3).join(' | '));
  check('every scene survives empty, enormous, newline-only and emoji copy',
    edges.filter((b) => /@text/.test(b)).length === 0,
    edges.filter((b) => /@text/.test(b)).slice(0, 3).join(' | '));
}

/* =========================================================== templates === */
section('every screen template, one at a time');
{
  const ids = await page.evaluate(() => window.__deep.tplIds);
  check('the registry holds every template the tool ships', ids.length === 46, `${ids.length}`);

  const results = await page.evaluate((ids) => {
    const D = window.__deep;
    const out = {};
    for (const tpl of ids) {
      const base = { tpl, title: 'DEEP AUDIT', body: 'line one\nline two', seed: 4242 };
      const r = {};
      try {
        const a = D.screen(base);
        const again = D.screen(base);
        const worded = D.screen({ ...base, title: 'SOMETHING ELSE ENTIRELY', body: 'different\ncopy here' });
        /* Separately, too. Changing both at once means a template that reads
           only one of them still scores a pass — and nine of them were doing
           exactly that: an author typing in Title watched nothing happen, with
           no indication which box that template actually reads. */
        const titled = D.screen({ ...base, title: 'SOMETHING ELSE ENTIRELY' });
        const bodied = D.screen({ ...base, body: 'different\ncopy here\nand a third' });
        const swapped = D.screen({ ...base, bg: '#204060', fg: '#ffcc00' });
        /* And one at a time, for the same reason Title and Body are measured
           separately above: swapping both means a template that reads only one
           of them still scores a pass, and nine of them read exactly one. */
        const inked = D.screen({ ...base, fg: '#ffcc00' });
        const grounded = D.screen({ ...base, bg: '#204060' });
        r.blank = a.lit === 0;
        r.stable = a.h === again.h;
        r.honoursTitle = a.h !== titled.h;
        r.honoursBody = a.h !== bodied.h;
        r.honoursWords = a.h !== worded.h;
        r.honoursColour = a.h !== swapped.h;
        r.honoursInk = a.h !== inked.h;
        r.honoursGround = a.h !== grounded.h;
        r.colours = a.colours;
      } catch (e) { r.threw = String(e && e.message || e).slice(0, 90); }
      out[tpl] = r;
    }
    return out;
  }, ids);

  const threw = ids.filter((t) => results[t].threw);
  check('no template throws while rendering', threw.length === 0,
    threw.map((t) => `${t}: ${results[t].threw}`).join(' | '));
  const blank = ids.filter((t) => results[t].blank);
  check('no template renders a blank screen', blank.length === 0, blank.join(', '));
  const unstable = ids.filter((t) => !results[t].stable);
  check('every template renders the same screen twice', unstable.length === 0, unstable.join(', '));

  /* A template that ignores the words is a picture, not a screen — and the
     whole point of a screen is that it says something.
     `import` is the one exemption and it is a real one: the template IS the
     image you loaded, and its caption is drawn over that image, so with nothing
     imported there is nothing to caption. */
  const WORDLESS_OK = new Set(['import']);
  const ignoresTitle = ids.filter((t) => !results[t].honoursTitle && !WORDLESS_OK.has(t));
  const ignoresBody = ids.filter((t) => !results[t].honoursBody && !WORDLESS_OK.has(t));
  check('every template reads the Title box', ignoresTitle.length === 0, ignoresTitle.join(', '));
  check('every template reads the Body box', ignoresBody.length === 0, ignoresBody.join(', '));
  const ignoresWords = ids.filter((t) => !results[t].honoursWords && !WORDLESS_OK.has(t));
  check('every template puts the author’s words on screen', ignoresWords.length === 0,
    ignoresWords.join(', '));

  /* Colour is NOT a universal claim, and asserting it as one would be asserting
     that a Blue Screen should not be blue. Roughly two thirds of these are
     recreations of a specific screen — Windows chrome, a BSOD, a printed poster
     on white paper — and their palette is the thing being recreated. What is
     worth pinning is that the ones which DO take colour keep taking it, so a
     refactor cannot quietly turn a themeable screen into a fixed one. */
  const themeable = ids.filter((t) => results[t].honoursColour);
  check('the themeable templates still take their ink and ground',
    themeable.length >= 16, `${themeable.length} of ${ids.length}`);

  /* Named rather than counted, so that a template moving between the two
     groups is a decision somebody made rather than a number that drifted. */
  const FIXED_PALETTE = ['autopsy', 'bios', 'blueprint', 'bsod', 'bsod_nt', 'calendar', 'cassette',
    'certificate', 'chat', 'clipping', 'desktop', 'dialog', 'explorer', 'filecabinet', 'http404',
    'import', 'journal', 'mall', 'map', 'policereport', 'poster', 'prescription', 'redacted',
    'registry', 'shutdown', 'statement', 'taskmgr', 'vapordesktop', 'vhslabel', 'vitals'];
  const nowFixed = ids.filter((t) => !results[t].honoursColour).sort();
  check('the set of fixed-palette templates is exactly the documented one',
    nowFixed.join() === FIXED_PALETTE.slice().sort().join(),
    `unexpected: ${nowFixed.filter((t) => !FIXED_PALETTE.includes(t)).join(',') || 'none'} · `
    + `no longer fixed: ${FIXED_PALETTE.filter((t) => !nowFixed.includes(t)).join(',') || 'none'}`);

  /* INK AND GROUND ARE TWO CLAIMS. The list above is the templates that fix
     BOTH, and the panel used to enable and disable the two controls together on
     the strength of it — so on the nine templates that fix exactly one, a live
     control sat beside a dead one with nothing to tell them apart. Three paint
     their own black ground and take an ink colour; six are paper props printed
     in black on stock whose colour IS the ground. Named, so a template moving
     between the groups is a decision rather than a drift. */
  const INK_FIXED_ONLY = ['boardingpass', 'cdlabel', 'evidence', 'floppy', 'punchcard', 'receipt'];
  const GROUND_FIXED_ONLY = ['atm', 'boot', 'testpattern'];
  const inkDead = ids.filter((t) => !results[t].honoursInk && !FIXED_PALETTE.includes(t)).sort();
  const groundDead = ids.filter((t) => !results[t].honoursGround && !FIXED_PALETTE.includes(t)).sort();
  check('the templates that fix only their INK are exactly the documented ones',
    inkDead.join() === INK_FIXED_ONLY.join(), inkDead.join(',') || 'none');
  check('…and the ones that fix only their GROUND likewise',
    groundDead.join() === GROUND_FIXED_ONLY.join(), groundDead.join(',') || 'none');
  const decl = await page.evaluate(async () => {
    const T = await import('./src/image/templates.js');
    return { ink: [...T.FIXED_INK].sort(), ground: [...T.FIXED_GROUND].sort() };
  });
  check('…and the code declares the same two sets it measures',
    decl.ink.join() === [...FIXED_PALETTE, ...INK_FIXED_ONLY].sort().join()
    && decl.ground.join() === [...FIXED_PALETTE, ...GROUND_FIXED_ONLY].sort().join(),
    `ink ${decl.ink.length}, ground ${decl.ground.length}`);

  const edges = await page.evaluate((ids) => {
    const D = window.__deep;
    const bad = [];
    for (const tpl of ids) {
      for (const [W, H, label] of [[64, 48, 'minimum'], [128, 96, 'gallery card'],
                                   [1080, 1920, 'vertical'], [1920, 1080, 'wide'],
                                   [1120, 480, 'ultrawide']]) {
        try { D.screen({ tpl, title: 'X', body: 'y', seed: 7 }, W, H); }
        catch (e) { bad.push(`${tpl}@${label}: ${String(e && e.message || e).slice(0, 60)}`); }
      }
      for (const [title, body] of [['', ''], ['X'.repeat(2000), 'Y'.repeat(4000)], ['\n\n', '\n\n\n'],
                                   ['🙂', '🙂🙂🙂']]) {
        try { D.screen({ tpl, title, body, seed: 7 }); }
        catch (e) { bad.push(`${tpl}@text: ${String(e && e.message || e).slice(0, 60)}`); }
      }
    }
    return bad;
  }, ids);
  check('every template survives every frame shape the tool can actually be set to',
    edges.filter((b) => !/@text/.test(b)).length === 0,
    edges.filter((b) => !/@text/.test(b)).slice(0, 3).join(' | '));
  check('every template survives empty, enormous, newline-only and emoji copy',
    edges.filter((b) => /@text/.test(b)).length === 0,
    edges.filter((b) => /@text/.test(b)).slice(0, 3).join(' | '));

  /* A redaction that can be read is not a redaction.
     Redacted Document wrapped its body as plain text and then looked for
     [[…]] on each finished line. The line breaker splits on whitespace — and on
     character, for a token wider than the measure — so a marker could land as
     `[[Dr. Ellis` / `Webb of LAB-3]]`, neither half matching, both halves drawn
     as ordinary ink. The author's secret was printed in the clear, brackets
     included, on the one template in the set whose whole purpose is that it is
     not. Asserted on the run list rather than on pixels: what is redacted is a
     property of the span, and this is the only place that says so. */
  const redaction = await page.evaluate(async () => {
    const T = await import('./src/image/templates.js');
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.font = '13px monospace';
    const secrets = ['Dr. Ellis Webb of LAB-3', 'the second key', 'ARCHIVE-0347-SUBJECT-NAME-VERY-LONG-TOKEN'];
    const body = `Subject [[${secrets[0]}]] entered at 03:47 with [[${secrets[1]}]].\n`
               + `Cross-reference [[${secrets[2]}]] before release.`;
    const out = {};
    // Every measure from "comfortably wide" down to "narrower than one secret".
    for (const w of [400, 240, 180, 120, 60, 20]) {
      const runs = T.redactedLines(ctx, { body, wrap: true, font: 13 }, '', w);
      const visible = runs.map((l) => l.filter((r) => !r.redact).map((r) => r.text).join('')).join('\n');
      const hidden = runs.flat().filter((r) => r.redact).map((r) => r.text);
      out[w] = {
        leaks: secrets.filter((s) => s.split(/\s+/).some((word) => word.length > 3 && visible.includes(word))),
        brackets: /\[\[|\]\]/.test(visible),
        kept: secrets.every((s) => hidden.includes(s)),
      };
    }
    return out;
  });
  const widths = Object.keys(redaction);
  check('a redaction is never split across a wrapped line, at any measure',
    widths.every((w) => redaction[w].leaks.length === 0),
    widths.filter((w) => redaction[w].leaks.length).map((w) => `${w}px: ${redaction[w].leaks}`).join(' | ') || 'no leak at any width');
  check('…and no marker syntax reaches the page either',
    widths.every((w) => !redaction[w].brackets),
    widths.filter((w) => redaction[w].brackets).join(', ') || 'clean');
  check('…while every redacted span is still carried, whole, to the bar that covers it',
    widths.every((w) => redaction[w].kept),
    widths.filter((w) => !redaction[w].kept).join(', ') || 'all intact');
}

/* ============================================================= filters === */
/* The audit suite already checks that a filter chain reorders and that bypass
   works. What it does NOT do is ask the question one filter at a time: does
   THIS one, at ITS OWN parameter extremes, actually change the picture — and
   does it leave the context as it found it? A filter that forgets to restore
   globalAlpha or globalCompositeOperation tints every filter after it in the
   chain, and on the export path the next FRAME too. */
section('every filter, one at a time');
{
  const info = await page.evaluate(async () => {
    const F = await import('./src/fx/filters.js');
    return Object.values(F.FILTERS).map((f) => ({
      id: f.id, group: f.group,
      params: (f.params || []).map((p) => ({ key: p.key, kind: p.kind || 'num', min: p.min, max: p.max, def: p.def })),
    }));
  });
  check('the registry holds every filter the tool ships', info.length === 45, `${info.length}`);

  const res = await page.evaluate(async (info) => {
    const F = await import('./src/fx/filters.js');
    const out = {};
    const W = 96; const H = 72;
    /* A busy source: a flat field would let a filter that only touches edges,
       or only touches colour, score as "changed nothing". */
    const source = () => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d', { willReadFrequently: true });
      for (let i = 0; i < 40; i++) {
        x.fillStyle = `rgb(${(i * 37) % 256},${(i * 91) % 256},${(i * 53) % 256})`;
        x.fillRect((i * 13) % W, (i * 7) % H, 11 + (i % 9), 9 + (i % 7));
      }
      x.fillStyle = '#fff'; x.fillRect(0, H / 2 - 1, W, 2);
      return { c, x };
    };
    const hashOf = (x, w, h) => {
      const d = x.getImageData(0, 0, w || W, h || H).data;
      let h2 = 5381;
      for (let i = 0; i < d.length; i += 4) h2 = (((h2 * 33) ^ (d[i] + d[i + 1] + d[i + 2])) >>> 0);
      return h2;
    };
    /* An extreme is NOT the same as "turned up". For plenty of parameters the
       maximum is the NEUTRAL end — eight bits of bit-crush is no crush, a pixel
       sort threshold of 100 sorts nothing, a lower third that comes in at 30s
       has not arrived yet. So the extremes are where a filter must not CRASH,
       and the shipped defaults are where it must DO something: the defaults are
       what an author gets the moment they add it to the chain, and a filter
       that looks like nothing there reads as broken. */
    const atExtreme = (f, end) => {
      const raw = {};
      for (const p of f.params) {
        raw[p.key] = (p.kind === 'num' && Number.isFinite(p[end])) ? p[end] : p.def;
      }
      return raw;
    };
    for (const f of info) {
      const r = {};
      const step = { id: f.id, params: {} };
      try {
        /* Called RAW, not through applyFilterChain: the chain wraps every
           filter in try/catch precisely so one bad filter cannot kill the
           preview loop, which would turn this assertion into a tautology. */
        const p = F.resolveParams(f.id, {});
        const a = source();
        const before = hashOf(a.x);
        // t=1.0 rather than 0: a timed filter at exactly its in-point is
        // legitimately still at zero opacity.
        F.FILTERS[f.id].apply(a.x, W, H, p, 1);
        r.changes = hashOf(a.x) !== before;
        // State hygiene: whatever it did, the context must come back neutral.
        r.alpha = a.x.globalAlpha;
        r.composite = a.x.globalCompositeOperation;
        r.canvasFilter = a.x.filter;
      } catch (e) { r.threw = String(e && e.message || e).slice(0, 80); }
      try {
        // Both extremes, and a degenerate one-pixel-tall frame. The gallery
        // thumbnail and the scrub strip are the smallest real frames, but a
        // sliver must not be a crash either.
        r.changesAtEnd = false;
        for (const end of ['min', 'max']) {
          const p = F.resolveParams(f.id, atExtreme(f, end));
          const a = source();
          const before = hashOf(a.x);
          F.FILTERS[f.id].apply(a.x, W, H, p, 1);
          if (hashOf(a.x) !== before) r.changesAtEnd = true;
          for (const [w, h] of [[8, 1], [1, 8]]) {
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            F.FILTERS[f.id].apply(c.getContext('2d', { willReadFrequently: true }), w, h, p, 1);
          }
        }
      } catch (e) { r.extremeThrew = String(e && e.message || e).slice(0, 80); }
      // Bypassed, it must be exactly a no-op — through the chain, because
      // `enabled:false` is a chain-level contract.
      try {
        const b = source();
        const clean = hashOf(b.x);
        F.applyFilterChain(b.x, W, H, [{ ...step, enabled: false }], 1);
        r.bypassClean = hashOf(b.x) === clean;
      } catch (e) { r.bypassThrew = String(e && e.message || e).slice(0, 80); }
      out[f.id] = r;
    }
    return out;
  }, info);

  const ids = info.map((f) => f.id);
  const threw = ids.filter((i) => res[i].threw);
  check('no filter throws at its shipped defaults', threw.length === 0,
    threw.map((i) => `${i}: ${res[i].threw}`).join(' | '));
  const eThrew = ids.filter((i) => res[i].extremeThrew);
  check('no filter throws at either extreme, or on a one-pixel frame', eThrew.length === 0,
    eThrew.map((i) => `${i}: ${res[i].extremeThrew}`).join(' | '));
  /* A CORRECTION filter is neutral until the author moves a slider — a grade
     at 0/0/0/0/0 and a levels with an identity LUT are supposed to do nothing,
     and it would be a bug if they did. Every OTHER filter is a look: you add it
     to see it, and one that is invisible at the setting it ships with reads as
     broken. So the identity-at-default set is declared and checked rather than
     forbidden — a new filter that quietly lands in it fails, and a correction
     filter that loses its neutral default fails too. */
  const IDENTITY_AT_DEFAULT = ['grade', 'levels'];
  const inertAtDef = ids.filter((i) => !res[i].threw && !res[i].changes).sort();
  check('the filters that are neutral at their defaults are exactly the correction ones',
    JSON.stringify(inertAtDef) === JSON.stringify([...IDENTITY_AT_DEFAULT].sort()),
    `unexpected: ${inertAtDef.filter((i) => !IDENTITY_AT_DEFAULT.includes(i)).join(',') || 'none'} · `
    + `no longer neutral: ${IDENTITY_AT_DEFAULT.filter((i) => !inertAtDef.includes(i)).join(',') || 'none'}`);
  const dead = ids.filter((i) => !res[i].threw && !res[i].changes && !res[i].changesAtEnd);
  check('no filter is inert everywhere — every one changes the picture somewhere in its range',
    dead.length === 0, dead.join(', '));
  const dirtyA = ids.filter((i) => !res[i].threw && res[i].alpha !== 1);
  check('no filter leaves globalAlpha behind for the next one in the chain',
    dirtyA.length === 0, dirtyA.map((i) => `${i}=${res[i].alpha}`).join(', '));
  const dirtyC = ids.filter((i) => !res[i].threw && res[i].composite !== 'source-over');
  check('no filter leaves a blend mode behind — it would tint the whole chain, and the next frame',
    dirtyC.length === 0, dirtyC.map((i) => `${i}=${res[i].composite}`).join(', '));
  const dirtyF = ids.filter((i) => !res[i].threw && res[i].canvasFilter && res[i].canvasFilter !== 'none');
  check('no filter leaves a canvas filter string behind',
    dirtyF.length === 0, dirtyF.map((i) => `${i}=${res[i].canvasFilter}`).join(', '));
  const leaky = ids.filter((i) => res[i].bypassThrew || !res[i].bypassClean);
  check('every filter bypassed is exactly a no-op', leaky.length === 0,
    leaky.map((i) => `${i}${res[i].bypassThrew ? ': ' + res[i].bypassThrew : ''}`).join(', '));
}

/* ======================================================== audio layers === */
section('every audio layer, one at a time');
{
  const res = await page.evaluate(async () => {
    const L = await import('./src/audio/layers.js');
    const E = await import('./src/audio/engine.js');
    const R = await import('./src/core/rng.js');
    const ids = L.AUDIO_LAYERS.map((l) => l.id);
    const out = { ids, per: {} };

    /* Drive the real reader with the registry's own declared defaults, so the
       clamping the product does is the clamping this test sees. renderAudio()
       reads the DOM by design; buildLayers is the part that is a function of
       its arguments, and it is the part a layer bug lives in. */
    const defs = new Map();
    for (const l of L.AUDIO_LAYERS) for (const s of l.params) defs.set(L.CTRL(l.id, s.key), s.def);
    const cfgWith = (on) => L.readLayerCfg({
      chk: (id) => id === L.TOGGLE(on),
      num: (id, d) => (defs.has(id) ? Number(defs.get(id)) : d),
      val: (id) => String(defs.get(id) ?? ''),
    });

    const renderOne = async (on, sr) => {
      const cfg = cfgWith(on);
      /* A layer that places content at a time the author chose declares how
         long it needs. Honouring that here is the same contract renderAudio
         has — without it, "beep at 20s" scores as a silent layer. */
      const dur = Math.max(2, L.layersNeedSeconds(cfg) + 0.5);
      /* 22050 is the LOWEST rate the tool offers (the Rate select is
         22050/44100/48000), and the default. Rendering below it is not a
         harder test, it is a different product: a BiquadFilter whose cutoff is
         swept fast enough gets unstable as the rate falls, and at 8000 the tape
         stop layer overshoots to 2.5× full scale — an artifact of a rate no
         author can pick. Test what is reachable. */
      const ctx = new OfflineAudioContext(1, Math.ceil(sr * dur), sr);
      R.resetSeed();
      const warn = [];
      const built = L.buildLayers({
        ctx, bus: () => ctx.destination, cfg, dur, rnd: R.rnd,
        helpers: { noiseBuffer: E.noiseBuffer, tone: E.tone, click: E.click },
        log: (m) => warn.push(String(m)),
      });
      const buf = await ctx.startRendering();
      const d = buf.getChannelData(0);
      let e = 0; let peak = 0;
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); e += v; if (v > peak) peak = v; }
      return { built, warn, dur, energy: Math.round(e), peak: Math.round(peak * 1000) / 1000 };
    };

    out.rates = [22050, 44100, 48000];
    out.off = await renderOne(null, 22050);
    for (const id of ids) {
      const r = { peak: 0 };
      try {
        for (const sr of out.rates) {
          const on = await renderOne(id, sr);
          r.built = on.built; r.warn = on.warn; r.dur = on.dur;
          // The quietest rate is the honest energy reading; the loudest peak
          // across all three is the honest headroom reading.
          if (r.energy === undefined || on.energy < r.energy) r.energy = on.energy;
          if (on.peak > r.peak) { r.peak = on.peak; r.peakAt = sr; }
        }
      } catch (e) { r.threw = String(e && e.message || e).slice(0, 90); }
      out.per[id] = r;
    }
    return out;
  });

  check('the registry holds every audio layer the tool ships', res.ids.length === 16, `${res.ids.length}`);
  check('with every layer off the bus renders true silence',
    res.off && res.off.built === 0 && res.off.energy === 0, JSON.stringify(res.off));
  const threw = res.ids.filter((i) => res.per[i].threw);
  check('no audio layer throws while rendering', threw.length === 0,
    threw.map((i) => `${i}: ${res.per[i].threw}`).join(' | '));
  const skipped = res.ids.filter((i) => !res.per[i].threw && (res.per[i].built !== 1 || res.per[i].warn.length));
  check('every audio layer builds — none is skipped by the catch inside buildLayers',
    skipped.length === 0,
    skipped.map((i) => `${i}: built=${res.per[i].built} ${(res.per[i].warn || []).join('; ')}`).join(' | '));
  const silentOnes = res.ids.filter((i) => !res.per[i].threw && !(res.per[i].energy > 0));
  check('every audio layer puts sound into the mix when it is switched on, at its own defaults',
    silentOnes.length === 0,
    silentOnes.map((i) => `${i}(${res.per[i].energy})`).join(', '));
  /* The mixdown is unlimited by design (the peak meter exists to say so), but a
     SINGLE layer at its shipped defaults arriving already over 0 dBFS means the
     default is wrong, not that the author stacked too much. */
  const hot = res.ids.filter((i) => !res.per[i].threw && res.per[i].peak > 1);
  check('no single layer clips the bus on its own, at its defaults, at any offered rate',
    hot.length === 0, hot.map((i) => `${i}=${res.per[i].peak}@${res.per[i].peakAt}`).join(', '));
}

/* ========================================================== automation === */
/* A keyframe track is worth exactly as much as the parameter it drives. The
   table in video/automation.js claims sixteen; this asks each one twice — does
   the curve become that field, and does that field reach the picture. A param
   that maps correctly but is ignored by the renderer keyframes beautifully and
   changes nothing on screen. */
section('every automatable parameter, one at a time');
{
  const spec = await page.evaluate(async () => {
    const A = await import('./src/video/automation.js');
    return A.AUTOMATABLE.map((p) => ({ id: p.id, field: p.field, kind: p.kind }));
  });
  check('the table holds every automatable parameter the tool ships', spec.length === 16, `${spec.length}`);

  const mapped = await page.evaluate(async (spec) => {
    const A = await import('./src/video/automation.js');
    const out = { per: {} };
    // The documented zero-allocation contract: an unautomated cfg comes back
    // as the SAME object, so the ordinary clip allocates nothing per frame.
    const plain = { scan: 0.1 };
    out.identity = A.cfgAt(plain, 0.5) === plain;
    out.identityEmptyTracks = A.cfgAt({ ...plain, __auto: {} }, 0.5).scan === 0.1;
    for (const p of spec) {
      // Ramp 0 → 100 over two seconds; at one second it must read half way.
      const cfg = { __auto: { [p.id]: [{ t: 0, v: 0 }, { t: 2, v: 100 }] } };
      const at = A.cfgAt(cfg, 1);
      out.per[p.id] = {
        got: at[p.field],
        want: p.kind === 'pct' ? 0.5 : 50,
        // …and it must be clamped at both ends rather than running past them.
        endHigh: A.cfgAt({ __auto: { [p.id]: [{ t: 0, v: 400 }] } }, 0)[p.field],
        endLow: A.cfgAt({ __auto: { [p.id]: [{ t: 0, v: -400 }] } }, 0)[p.field],
      };
    }
    return out;
  }, spec);

  check('an unautomated cfg is returned unchanged, by identity — no per-frame allocation',
    mapped.identity === true);
  check('a cfg carrying an empty track set keeps its own values', mapped.identityEmptyTracks === true);
  const wrong = spec.filter((p) => Math.abs(mapped.per[p.id].got - mapped.per[p.id].want) > 1e-9);
  check('every track evaluates onto the field it declares, in that field’s units',
    wrong.length === 0,
    wrong.map((p) => `${p.id}→${p.field}: ${mapped.per[p.id].got} want ${mapped.per[p.id].want}`).join(' | '));
  const unclamped = spec.filter((p) => p.kind === 'pct'
    && (mapped.per[p.id].endHigh !== 1 || mapped.per[p.id].endLow !== 0));
  check('a key dragged past either end is clamped, not passed through',
    unclamped.length === 0,
    unclamped.map((p) => `${p.id}=[${mapped.per[p.id].endLow},${mapped.per[p.id].endHigh}]`).join(', '));

  /* And the other half: the field has to reach the picture. Sampled ACROSS
     TIME rather than at one instant, because several of these are gated —
     glitch and corrupt only fire on `floor(t*14)%9===0`, flicker is a 25%
     chance per frame — and a single frame that missed the gate says nothing.
     Two consecutive frames per sample, because phosphor persistence is a
     function of the frame before it and cannot show itself in one. */
  const reaches = await page.evaluate(async (spec) => {
    const S = window.DeadSignalStudio;
    /* Consecutive frames onto ONE canvas, reduced from the LAST of them. */
    const seq = (over, ts, W = 160, H = 120) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const cfg = { ...S.readVideoCfg(), W, H, ...over };
      for (const t of ts) S.renderVideoFrame(ctx, W, H, cfg, t);
      const d = ctx.getImageData(0, 0, W, H).data;
      let h = 5381;
      for (let i = 0; i < d.length; i += 4) h = (((h * 33) ^ (d[i] + d[i + 1] + d[i + 2])) >>> 0);
      return h;
    };
    /* Swept along the FRAME GRID, not at arbitrary instants: the renderer
       reseeds per frame via beginFrame(round(t*fps)), so two times inside one
       frame are the same draw, and a 26%-per-frame effect like the flicker
       needs distinct frames to have a chance of showing up at all. Two seconds
       of frames is ~24 chances; missing all of them would be a real fault. */
    const FPS = 12; const FRAMES = 24;
    const out = {};
    for (const p of spec) {
      const lo = p.kind === 'pct' ? 0 : (p.field === 'font' ? 8 : 1);
      const hi = p.kind === 'pct' ? 1 : (p.field === 'font' ? 40 : 60);
      const base = {
        scene: 'terminal', text: 'ACCESS DENIED\nRETRY 3 OF 3\nSECTOR 7 OFFLINE',
        textMode: 'typed', fps: FPS, persist: 0,
      };
      let moves = false; let at = -1;
      for (let f = 1; f <= FRAMES && !moves; f++) {
        // The previous frame too, so phosphor persistence has something to
        // trail from — it is a function of the frame before it.
        const ts = [(f - 1) / FPS, f / FPS];
        if (seq({ ...base, [p.field]: lo }, ts) !== seq({ ...base, [p.field]: hi }, ts)) {
          moves = true; at = f;
        }
      }
      out[p.id] = { moves, field: p.field, at };
    }
    return out;
  }, spec);
  const dead = spec.filter((p) => !reaches[p.id].moves);
  check('every automatable parameter actually reaches the picture',
    dead.length === 0, dead.map((p) => `${p.id}(${p.field})`).join(', '));
}

/* ============================================================ audio FX === */
/* The FX bus splits in two — nodes inserted into the graph before rendering,
   and passes run over the rendered samples afterwards — and the two halves fail
   differently. A graph step that returns nothing silently drops every effect
   after it; a post step that returns the wrong length is discarded, and the
   author is told only if someone is reading the log. */
section('every audio FX, one at a time');
{
  const res = await page.evaluate(async () => {
    const X = await import('./src/audio/fx.js');
    const R = await import('./src/core/rng.js');
    const ids = Object.keys(X.AUDIO_FX);
    const out = { ids, per: {} };
    /* Four seconds, not two: the rhythmic effects place their first event at
       `every` seconds (2s and 2.5s by default) and a two-second render ends
       before any of them has happened — which would score them as inert. */
    const SR = 22050; const DUR = 4;

    const energyOf = (chs) => {
      let e = 0;
      for (const ch of chs) for (let i = 0; i < ch.length; i++) e += Math.abs(ch[i]);
      return Math.round(e);
    };
    const sigOf = (chs) => {
      let h = 5381;
      for (const ch of chs) for (let i = 0; i < ch.length; i += 7) h = (((h * 33) ^ ((ch[i] * 4096) | 0)) >>> 0);
      return h;
    };
    /* A source with tone AND noise AND stereo difference: an effect that only
       touches the sides, or only the transients, must not read as inert. */
    const renderGraph = async (chain) => {
      const ctx = new OfflineAudioContext(2, SR * DUR, SR);
      R.resetSeed();
      const buf = ctx.createBuffer(2, SR * DUR, SR);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < d.length; i++) {
          d[i] = 0.4 * Math.sin(2 * Math.PI * (180 + c * 40) * i / SR) + 0.15 * (R.rnd() * 2 - 1);
        }
      }
      const src = ctx.createBufferSource(); src.buffer = buf;
      const warn = [];
      const tail = X.applyGraphFx(ctx, src, chain, DUR, (m) => warn.push(String(m)));
      tail.connect(ctx.destination);
      src.start(0); src.stop(DUR);
      const b = await ctx.startRendering();
      const chs = [b.getChannelData(0), b.getChannelData(1)];
      return { warn, energy: energyOf(chs), sig: sigOf(chs), len: chs[0].length };
    };
    const runPost = (chain) => {
      R.resetSeed();
      const chs = [new Float32Array(SR * DUR), new Float32Array(SR * DUR)];
      for (let c = 0; c < 2; c++) {
        for (let i = 0; i < chs[c].length; i++) {
          chs[c][i] = 0.4 * Math.sin(2 * Math.PI * (180 + c * 40) * i / SR) + 0.15 * (R.rnd() * 2 - 1);
        }
      }
      const warn = [];
      R.resetSeed();
      const got = X.applyPostFx(chs, SR, DUR, chain, R.rnd, (m) => warn.push(String(m)));
      return { warn, energy: energyOf(got), sig: sigOf(got), len: got[0].length };
    };

    const baseGraph = await renderGraph([]);
    const basePost = runPost([]);
    out.base = { graph: baseGraph.energy, post: basePost.energy };

    for (const id of ids) {
      const f = X.AUDIO_FX[id];
      const r = { kind: f.graph ? 'graph' : 'post' };
      const step = { id, params: {} };
      try {
        const on = f.graph ? await renderGraph([step]) : runPost([step]);
        const off = f.graph ? baseGraph : basePost;
        r.warn = on.warn;
        r.changes = on.sig !== off.sig;
        r.energy = on.energy;
        r.silences = !(on.energy > 0);
        r.keptLength = on.len === off.len;
        // Bypassed, it must be byte-for-byte the untouched signal.
        const by = f.graph ? await renderGraph([{ ...step, enabled: false }]) : runPost([{ ...step, enabled: false }]);
        r.bypassClean = by.sig === off.sig;
      } catch (e) { r.threw = String(e && e.message || e).slice(0, 90); }
      out.per[id] = r;
    }
    return out;
  });

  check('the registry holds every audio FX the tool ships', res.ids.length === 8, `${res.ids.length}`);
  const threw = res.ids.filter((i) => res.per[i].threw);
  check('no audio FX throws', threw.length === 0,
    threw.map((i) => `${i}: ${res.per[i].threw}`).join(' | '));
  const warned = res.ids.filter((i) => !res.per[i].threw && res.per[i].warn.length);
  check('no audio FX is skipped by the catch inside the applier', warned.length === 0,
    warned.map((i) => `${i}: ${res.per[i].warn.join('; ')}`).join(' | '));
  /* Same split as the video chain: an EQ sitting at 0 dB on all three bands is
     a correction tool at its neutral position and is SUPPOSED to be inaudible
     until the author moves a band. Everything else is an effect you add to
     hear. Declared and checked, so a new FX that quietly lands in this set
     fails, and the EQ losing its flat default fails too. */
  const NEUTRAL_AT_DEFAULT = ['eq3'];
  const inert = res.ids.filter((i) => !res.per[i].threw && !res.per[i].changes).sort();
  check('the audio FX that are neutral at their defaults are exactly the correction ones',
    JSON.stringify(inert) === JSON.stringify([...NEUTRAL_AT_DEFAULT].sort()),
    `unexpected: ${inert.filter((i) => !NEUTRAL_AT_DEFAULT.includes(i)).join(',') || 'none'} · `
    + `no longer neutral: ${NEUTRAL_AT_DEFAULT.filter((i) => !inert.includes(i)).join(',') || 'none'}`);
  const killed = res.ids.filter((i) => !res.per[i].threw && res.per[i].silences);
  check('no audio FX silences the bus outright', killed.length === 0, killed.join(', '));
  const stretched = res.ids.filter((i) => !res.per[i].threw && !res.per[i].keptLength);
  check('every post FX hands back the length it was given — the fades and the loop crossfade assume it',
    stretched.length === 0, stretched.join(', '));
  const leaky = res.ids.filter((i) => !res.per[i].threw && !res.per[i].bypassClean);
  check('every audio FX bypassed is exactly the untouched signal', leaky.length === 0, leaky.join(', '));
}

/* ================================================== titles === */
/* A title is the one renderer whose correctness is mostly about what it does
   NOT draw. Everything else in this tool fills its buffer; this one clears it,
   and if it ever stopped, a lower third would become an opaque card that hides
   the shot it is captioning — which is not a subtle regression but is a silent
   one, because the title itself would still look perfect. */
section('titles — words over the picture, not instead of it');
{
  const probe = await page.evaluate(async () => {
    const T = await import('./src/doc/title.js');
    const VT = await import('./src/video/title.js');
    const W = 320; const H = 240;
    /* Measured on the buffer the title draws into, BEFORE it is composited —
       which is the only place the transparency is observable. */
    const shot = (rec, t = 1.5, len = 3, w = W, h = H) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true });
      let threw = null;
      try { VT.drawTitleTo(x, w, h, T.makeTitle(rec), t, len); }
      catch (e) { threw = String(e && e.message || e).slice(0, 90); }
      const d = x.getImageData(0, 0, w, h).data;
      let clear = 0; let ink = 0; let hash = 5381; let top = h; let bottom = -1; let left = w; let right = -1;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        hash = (((hash * 33) ^ (d[i] + d[i + 1] + d[i + 2] + a)) >>> 0);
        if (a === 0) { clear++; continue; }
        ink++;
        const px = (i / 4) % w; const py = Math.floor((i / 4) / w);
        if (py < top) top = py; if (py > bottom) bottom = py;
        if (px < left) left = px; if (px > right) right = px;
      }
      return { threw, clear, ink, hash, total: w * h, top, bottom, left, right };
    };
    const out = {};
    const WORDS = { 't-text': 'EREBUS ARCHIVE', 't-sub': 'RECOVERED 1997' };

    out.blank = shot({});
    out.plain = shot({ ...WORDS, 't-treat': 'none' });
    out.perTreatment = {};
    for (const tr of T.TREATMENTS) out.perTreatment[tr] = shot({ ...WORDS, 't-treat': tr });
    out.perPlace = {};
    for (const p of T.TITLE_PLACES) out.perPlace[p.v] = shot({ ...WORDS, 't-place': p.v, 't-treat': 'none' });

    // Animation, sampled across the clip.
    out.fade = [0, 0.2, 1.5, 2.8, 3].map((t) => shot({ ...WORDS, 't-anim': 'fade', 't-animout': 'fade', 't-in': '0.5', 't-out': '0.5' }, t, 3));
    out.type = [0, 0.5, 1, 2].map((t) => shot({ 't-text': 'DECRYPTING PAYLOAD', 't-anim': 'type', 't-in': '2', 't-animout': 'none' }, t, 3));
    out.rise = [0, 2].map((t) => shot({ ...WORDS, 't-anim': 'rise', 't-in': '1', 't-animout': 'none' }, t, 3));
    out.cut = [0, 1.5, 3].map((t) => shot({ ...WORDS, 't-anim': 'none', 't-animout': 'none' }, t, 3));

    // Determinism, and the resolution-independence claim.
    out.twice = [shot(WORDS), shot(WORDS)];
    const small = shot({ ...WORDS, 't-treat': 'none' }, 1.5, 3, 320, 240);
    const big = shot({ ...WORDS, 't-treat': 'none' }, 1.5, 3, 1280, 960);
    out.scaled = {
      smallTop: small.top / 240, bigTop: big.top / 960,
      smallH: (small.bottom - small.top) / 240, bigH: (big.bottom - big.top) / 960,
    };

    // Every reachable frame shape, and every text edge.
    out.shapes = [];
    for (const [w, h] of [[64, 48], [128, 96], [320, 240], [1920, 1080], [240, 1080], [1920, 64]]) {
      const r = shot(WORDS, 1.5, 3, w, h);
      out.shapes.push({ wh: `${w}x${h}`, threw: r.threw, ink: r.ink, clear: r.clear, total: r.total });
    }
    out.edges = [];
    for (const [name, rec] of [
      ['empty', {}],
      ['newlines only', { 't-text': '\n\n\n' }],
      ['enormous', { 't-text': 'X'.repeat(5000) }],
      ['many lines', { 't-text': Array.from({ length: 60 }, (_, i) => 'L' + i).join('\n') }],
      ['emoji', { 't-text': '🛰️🜁🝕 SIGNAL 🜃' }],
      ['one long word', { 't-text': 'A'.repeat(200) }],
      ['trailing blanks', { 't-text': 'TOP\n\n\n\n' }],
      ['sub only', { 't-sub': 'JUST A SUBTITLE' }],
    ]) {
      const r = shot(rec, 1.5, 3);
      out.edges.push({ name, threw: r.threw, ink: r.ink });
    }
    /* A degenerate length. clipLength() floors at MIN_CLIP so the compositor
       never hands one over, but the renderer is a public function and the
       arithmetic divides by it. A fading title AT its own end is correctly
       invisible — so the honest question is whether a title told to CUT on is
       still drawn, and whether either one throws. */
    out.degenerate = {
      fading: shot({ ...WORDS, 't-anim': 'fade' }, 0, 0),
      cutting: shot({ ...WORDS, 't-anim': 'none', 't-animout': 'none' }, 0, 0),
      negative: shot({ ...WORDS, 't-anim': 'none', 't-animout': 'none' }, 0, -5),
    };
    return out;
  });

  check('an empty title draws nothing at all — every pixel of the buffer is untouched',
    !probe.blank.threw && probe.blank.ink === 0 && probe.blank.clear === probe.blank.total,
    JSON.stringify(probe.blank));

  /* THE claim. A title that filled its buffer would still look right on its own
     and would hide the shot underneath it in the sequence. */
  check('a title leaves the buffer transparent everywhere it did not put ink',
    probe.plain.clear > probe.plain.total * 0.8 && probe.plain.ink > 0,
    `${probe.plain.clear}/${probe.plain.total} clear, ${probe.plain.ink} inked`);

  const trs = Object.keys(probe.perTreatment);
  const trThrew = trs.filter((t) => probe.perTreatment[t].threw);
  check('no readability treatment throws', trThrew.length === 0,
    trThrew.map((t) => `${t}: ${probe.perTreatment[t].threw}`).join(' | '));
  const trBlank = trs.filter((t) => probe.perTreatment[t].ink === 0);
  check('every readability treatment draws something', trBlank.length === 0, trBlank.join(', '));
  /* Each has to be its own picture: two that render identically means one of
     them is not wired to anything. */
  const trHashes = new Set(trs.map((t) => probe.perTreatment[t].hash));
  check('…and each one is a DIFFERENT picture — a treatment that renders like another is not wired',
    trHashes.size === trs.length, `${trHashes.size} distinct of ${trs.length}`);
  /* A band spans the frame; a fitted box does not. That is the whole difference
     between them, so it is worth asserting rather than assuming. */
  const bar = probe.perTreatment.bar; const box = probe.perTreatment.box;
  check('a full-width band reaches both frame edges and a fitted box does not',
    bar.left === 0 && bar.right === 319 && box.left > 0 && box.right < 319,
    `bar ${bar.left}..${bar.right}, box ${box.left}..${box.right}`);

  const places = Object.keys(probe.perPlace);
  check('every place draws, and none throws',
    places.every((p) => !probe.perPlace[p].threw && probe.perPlace[p].ink > 0),
    places.filter((p) => probe.perPlace[p].threw || !probe.perPlace[p].ink).join(', '));
  const distinct = new Set(places.map((p) => probe.perPlace[p].hash));
  check('all nine places put the words somewhere different', distinct.size === 9, `${distinct.size} of 9`);
  check('the top places sit above the bottom ones, and the left of the right',
    probe.perPlace.tc.top < probe.perPlace.mc.top && probe.perPlace.mc.top < probe.perPlace.bc.top
      && probe.perPlace.ml.left < probe.perPlace.mr.left,
    JSON.stringify({ t: probe.perPlace.tc.top, m: probe.perPlace.mc.top, b: probe.perPlace.bc.top }));
  check('nothing is drawn outside the title-safe margin at any place',
    places.every((p) => probe.perPlace[p].left >= 0 && probe.perPlace[p].right <= 319
      && probe.perPlace[p].top >= 0 && probe.perPlace[p].bottom <= 239),
    places.filter((p) => probe.perPlace[p].left < 0 || probe.perPlace[p].right > 319).join(', '));

  check('a fading title is absent at both ends and present in the middle',
    probe.fade[0].ink === 0 && probe.fade[2].ink > 0 && probe.fade[4].ink === 0,
    probe.fade.map((f) => f.ink).join(' '));
  check('…and is dimmer on the way in than at full strength',
    probe.fade[1].ink > 0 && probe.fade[1].hash !== probe.fade[2].hash);
  check('a typewriter puts more on screen as it goes, and stops when it is done',
    probe.type[0].ink === 0 && probe.type[1].ink < probe.type[2].ink
      && probe.type[2].ink < probe.type[3].ink,
    probe.type.map((f) => f.ink).join(' '));
  check('a rising title starts lower than it finishes',
    probe.rise[0].top > probe.rise[1].top, `${probe.rise[0].top} → ${probe.rise[1].top}`);
  check('a title told to cut on is at full strength from its very first frame',
    probe.cut[0].ink > 0 && probe.cut[0].hash === probe.cut[1].hash
      && probe.cut[1].hash === probe.cut[2].hash,
    probe.cut.map((f) => f.ink).join(' '));

  check('the same title renders identically twice', probe.twice[0].hash === probe.twice[1].hash);

  /* The reason every measurement in the model is a fraction: a title authored
     on a small delivery has to be the same title on a large one. */
  check('a title is the same title at four times the size — proportionally placed and proportionally tall',
    Math.abs(probe.scaled.smallTop - probe.scaled.bigTop) < 0.03
      && Math.abs(probe.scaled.smallH - probe.scaled.bigH) < 0.03,
    JSON.stringify(probe.scaled));

  const shapeThrew = probe.shapes.filter((s) => s.threw);
  check('no frame shape the tool can be set to makes a title throw', shapeThrew.length === 0,
    shapeThrew.map((s) => `${s.wh}: ${s.threw}`).join(' | '));
  const shapeBlank = probe.shapes.filter((s) => !s.threw && s.ink === 0);
  check('…and a title is visible at every one of them, down to a gallery thumbnail',
    shapeBlank.length === 0, shapeBlank.map((s) => s.wh).join(', '));
  const shapeOpaque = probe.shapes.filter((s) => !s.threw && s.clear < s.total * 0.4);
  check('…and stays mostly transparent at every one of them',
    shapeOpaque.length === 0, shapeOpaque.map((s) => `${s.wh} ${s.clear}/${s.total}`).join(', '));

  const edgeThrew = probe.edges.filter((e) => e.threw);
  check('no text edge case makes a title throw — empty, newline-only, enormous, 60 lines, emoji',
    edgeThrew.length === 0, edgeThrew.map((e) => `${e.name}: ${e.threw}`).join(' | '));
  const shouldDraw = probe.edges.filter((e) => !['empty', 'newlines only'].includes(e.name));
  check('…and every edge case that HAS words still puts some on screen',
    shouldDraw.every((e) => e.ink > 0),
    shouldDraw.filter((e) => !e.ink).map((e) => e.name).join(', '));
  check('a title with nothing but newlines in it draws nothing',
    probe.edges.find((e) => e.name === 'newlines only').ink === 0);

  /* THE INTEGRATION CLAIM. Everything above measures the title's own buffer.
     This measures the finished frame: a spine clip on V1, a title on V2 over it,
     composited by renderTimelineFrame exactly as the exporter does it. If the
     title's buffer were opaque, the title would still look perfect here — and
     the shot it is captioning would be gone. */
  const composited = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const before = S.timeline.map((c) => ({ ...c }));
    const shot = (T) => {
      const sched = S.buildSchedule();
      const c = document.createElement('canvas'); c.width = sched.tl.W; c.height = sched.tl.H;
      const x = c.getContext('2d', { willReadFrequently: true });
      S.renderTimelineFrame(x, T, sched);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let lit = 0; let hash = 5381; let topHash = 5381;
      const cut = Math.floor(c.height * 0.5) * c.width * 4;
      for (let i = 0; i < d.length; i += 4) {
        const l = d[i] + d[i + 1] + d[i + 2];
        hash = (((hash * 33) ^ l) >>> 0);
        // The half of the frame the title is nowhere near. If the buffer were
        // opaque this would change; if it is transparent it cannot.
        if (i < cut) topHash = (((topHash * 33) ^ l) >>> 0);
        if (l > 24) lit++;
      }
      return { lit, hash, topHash, px: d.length / 4 };
    };
    /* A bright, busy spine clip so "did the picture survive" is answerable.
       The scene comes from the RECIPE, not from clip.scene — renderClipTo reads
       readVideoCfg(clip.rec) — so a clip built without one draws nothing, and
       every comparison against it would pass by comparing blank to blank. */
    const under = { kind: 'video', scene: 'bars', label: 'under', src: 8, in: 0, out: 8,
      rec: { 'v-scene': 'bars', 'v-dur': '8', 'v-w': '320', 'v-h': '240' } };
    S.setTimelineClips([under]);
    const bare = shot(2);
    S.setTimelineClips([
      under,
      { kind: 'title', scene: 'title', label: 'over', src: 3, in: 0, out: 3,
        track: 'V2', at: 1, transition: 'cut', xdur: 0, blend: 'normal', opacity: 1,
        rec: { 't-text': 'EREBUS ARCHIVE', 't-anim': 'none', 't-animout': 'none', 't-treat': 'none' } },
    ]);
    const withTitle = shot(2);
    // The title covers 1..4 on the sequence clock, so 6 is genuinely past it.
    const afterTitle = shot(6);
    // Read while the two-clip sequence is still the live one.
    const kinds = S.timeline.map((c) => c.kind);
    const labels = S.timeline.map((c) => c.label);
    S.setTimelineClips([under]);
    const bareAt6 = shot(6);
    S.setTimelineClips(before);
    return { bare, withTitle, afterTitle, bareAt6, kinds, labels };
  });
  check('a title clip survives the round trip through the document as a title',
    composited.kinds.join(',') === 'video,title', composited.kinds.join(','));
  /* Asserted, not assumed: every comparison below is against this frame, and a
     blank one would make all of them pass by comparing nothing to nothing. */
  check('the shot underneath actually rendered — the comparisons below are real',
    composited.bare.lit > composited.bare.px * 0.5,
    `${composited.bare.lit} lit of ${composited.bare.px}px`);
  check('a title over a shot changes the finished frame',
    composited.bare.hash !== composited.withTitle.hash);
  /* The one that would catch an opaque buffer. A full-frame card would leave
     almost nothing of the bars lit; a title leaves nearly all of them. */
  /* The decisive one. The title sits at the bottom, so the top half of the
     frame must come back BYTE-IDENTICAL. An opaque title buffer — a card rather
     than a caption — would change it, and the title itself would still look
     perfect while the shot it captions had gone. */
  check('…and the half of the frame away from the title is untouched, to the pixel',
    composited.withTitle.topHash === composited.bare.topHash,
    `${composited.withTitle.topHash} vs ${composited.bare.topHash}`);
  check('…and the shot is still lit everywhere it was before',
    composited.withTitle.lit > composited.bare.lit * 0.9,
    `${composited.withTitle.lit} lit of ${composited.bare.lit} before, ${composited.withTitle.px}px`);
  check('…and once the title is over, the frame is exactly the bare shot again',
    composited.afterTitle.hash === composited.bareAt6.hash);

  /* THE TEXT EFFECTS. Each has to be its own picture, and the continuous ones
     have to keep MOVING — an effect that renders once and then holds still is
     indistinguishable from a static title in a screenshot and dead on a
     timeline, which is the same failure the scene suite exists to catch. */
  const fx = await page.evaluate(async () => {
    const T = await import('./src/doc/title.js');
    const VT = await import('./src/video/title.js');
    const W = 320; const H = 240;
    const shot = (rec, t) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d', { willReadFrequently: true });
      let threw = null;
      try { VT.drawTitleTo(x, W, H, T.makeTitle(rec), t, 4); }
      catch (e) { threw = String(e && e.message || e).slice(0, 90); }
      const d = x.getImageData(0, 0, W, H).data;
      let ink = 0; let hash = 5381; let top = H; let bottom = -1; let left = W; let right = -1;
      for (let i = 0; i < d.length; i += 4) {
        hash = (((hash * 33) ^ (d[i] + d[i + 1] + d[i + 2] + d[i + 3])) >>> 0);
        if (d[i + 3] === 0) continue;
        ink++;
        const px = (i / 4) % W; const py = Math.floor((i / 4) / W);
        if (py < top) top = py; if (py > bottom) bottom = py;
        if (px < left) left = px; if (px > right) right = px;
      }
      return { threw, ink, hash, top, bottom, left, right };
    };
    const B = { 't-text': 'EREBUS ARCHIVE', 't-place': 'mc', 't-size': '12',
      't-treat': 'none', 't-anim': 'none', 't-animout': 'none' };
    const out = { fx: {}, ids: T.TEXT_FX };
    for (const f of T.TEXT_FX) {
      out.fx[f] = {
        a: shot({ ...B, 't-fx': f, 't-fxamt': '0.9' }, 1),
        b: shot({ ...B, 't-fx': f, 't-fxamt': '0.9' }, 1.6),
        again: shot({ ...B, 't-fx': f, 't-fxamt': '0.9' }, 1),
        off: shot({ ...B, 't-fx': f, 't-fxamt': '0' }, 1),
      };
    }
    out.word = [0, 0.5, 1, 3].map((t) =>
      shot({ ...B, 't-text': 'ONE TWO THREE FOUR', 't-size': '7', 't-anim': 'word', 't-in': '2' }, t));
    out.pop = [0.05, 1, 3].map((t) => shot({ ...B, 't-anim': 'pop', 't-in': '2' }, t));
    /* Sampled at the exact ends as well as through the middle: a roll is
       defined by being OFF the frame at both, and a tenth of a second in it has
       already begun to appear, which is the gesture working. */
    out.roll = [0, 1, 2, 3, 4].map((t) =>
      shot({ ...B, 't-text': 'A\nB\nC', 't-size': '8', 't-roll': 'up' }, t));
    out.ticker = [0, 2, 4].map((t) => shot({ ...B, 't-size': '7', 't-roll': 'left' }, t));
    return out;
  });

  const fxThrew = fx.ids.filter((f) => fx.fx[f].a.threw);
  check('no text effect throws', fxThrew.length === 0,
    fxThrew.map((f) => `${f}: ${fx.fx[f].a.threw}`).join(' | '));
  const fxDupes = [];
  for (const a of fx.ids) for (const b of fx.ids) {
    if (a < b && fx.fx[a].a.hash === fx.fx[b].a.hash) fxDupes.push(`${a}=${b}`);
  }
  check('every text effect is a DIFFERENT picture — none is silently unwired',
    fxDupes.length === 0, fxDupes.join(', '));
  const still = fx.ids.filter((f) => f !== 'none' && fx.fx[f].a.hash === fx.fx[f].b.hash);
  check('every text effect keeps MOVING across the hold — it is not a one-off decoration',
    still.length === 0, still.join(', '));
  const nondet = fx.ids.filter((f) => fx.fx[f].a.hash !== fx.fx[f].again.hash);
  check('…and renders the same at the same instant twice — an export must match the scrub',
    nondet.length === 0, nondet.join(', '));
  const notOff = fx.ids.filter((f) => f !== 'none' && f !== 'neon'
    && fx.fx[f].off.hash !== fx.fx.none.a.hash);
  check('an effect turned down to nothing is the plain title again',
    notOff.length === 0, notOff.join(', '));
  check('a neon glow is the one that lights the frame beyond the letters themselves',
    fx.fx.neon.a.ink > fx.fx.none.a.ink * 1.5,
    `${fx.fx.neon.a.ink} vs ${fx.fx.none.a.ink}`);

  check('a word-by-word entrance puts more on screen as it goes, and stops when it is done',
    fx.word[0].ink === 0 && fx.word[1].ink < fx.word[2].ink && fx.word[2].ink < fx.word[3].ink,
    fx.word.map((f) => f.ink).join(' '));
  check('a popping title is smaller at the start than at the end',
    (fx.pop[0].right - fx.pop[0].left) < (fx.pop[2].right - fx.pop[2].left),
    fx.pop.map((f) => `${f.right - f.left}`).join(' '));

  /* A roll has to LEAVE. One that stops in the middle is a slide, and a ticker
     that parks at the centre never goes away. */
  /* Only the frames that HAVE ink can say where the block is — `top` is a
     sentinel on an empty one, and comparing against it would call a working
     roll broken. */
  const inked = fx.roll.filter((f) => f.ink > 0);
  check('a credits roll travels upward across the whole clip',
    inked.length >= 2 && inked.every((f, i2) => i2 === 0 || f.top < inked[i2 - 1].top),
    fx.roll.map((f) => `${f.ink}@${f.top}`).join(' '));
  check('…and is off the frame at both ends, which is what makes it a roll rather than a slide',
    fx.roll[0].ink === 0 && fx.roll[fx.roll.length - 1].ink === 0,
    fx.roll.map((f) => f.ink).join(' '));
  check('a ticker travels leftward and leaves the frame entirely',
    fx.ticker[0].ink === 0 && fx.ticker[1].ink > 0 && fx.ticker[2].ink === 0,
    fx.ticker.map((f) => f.ink).join(' '));

  const deg = probe.degenerate;
  check('a clip with no length at all is not a crash, at any animation',
    !deg.fading.threw && !deg.cutting.threw && !deg.negative.threw,
    [deg.fading.threw, deg.cutting.threw, deg.negative.threw].filter(Boolean).join(' | '));
  check('…and one told to cut on is still drawn on it, where a fading one is correctly already gone',
    deg.cutting.ink > 0 && deg.negative.ink > 0 && deg.fading.ink === 0,
    `cut ${deg.cutting.ink}, negative ${deg.negative.ink}, fade ${deg.fading.ink}`);
}

/* ================================================== graphics === */
/* Same contract as a title, one shape at a time: the buffer must come back
   mostly transparent, every shape must be its own picture, and the three
   entrances must each do a visibly different thing. */
section('shapes — the second thing that draws on nothing');
{
  const probe = await page.evaluate(async () => {
    const G = await import('./src/doc/graphic.js');
    const VG = await import('./src/video/graphic.js');
    const W = 320; const H = 240;
    const shot = (rec, t = 1.5, len = 3, w = W, h = H) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true });
      let threw = null;
      try { VG.drawGraphicTo(x, w, h, G.makeGraphic(rec), t, len); }
      catch (e) { threw = String(e && e.message || e).slice(0, 90); }
      const d = x.getImageData(0, 0, w, h).data;
      let clear = 0; let ink = 0; let hash = 5381; let top = h; let bottom = -1; let left = w; let right = -1;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        hash = (((hash * 33) ^ (d[i] + d[i + 1] + d[i + 2] + a)) >>> 0);
        if (a === 0) { clear++; continue; }
        ink++;
        const px = (i / 4) % w; const py = Math.floor((i / 4) / w);
        if (py < top) top = py; if (py > bottom) bottom = py;
        if (px < left) left = px; if (px > right) right = px;
      }
      return { threw, clear, ink, hash, total: w * h, top, bottom, left, right };
    };
    const BASE = { 'g-x': '0.25', 'g-y': '0.25', 'g-w': '0.5', 'g-h': '0.4',
      'g-anim': 'none', 'g-animout': 'none', 'g-weight': '1' };
    const out = { shapes: {}, ids: G.SHAPES.map((s2) => s2.v) };
    for (const s2 of G.SHAPES) out.shapes[s2.v] = shot({ ...BASE, 'g-shape': s2.v });
    out.empty = shot({ ...BASE, 'g-w': '0', 'g-h': '0' });
    out.twice = [shot(BASE), shot(BASE)];
    // Each entrance, sampled across the ramp.
    out.draw = [0, 0.5, 1, 2].map((t) => shot({ ...BASE, 'g-shape': 'box', 'g-anim': 'draw', 'g-in': '2' }, t, 3));
    out.pop = [0.01, 1, 2].map((t) => shot({ ...BASE, 'g-shape': 'box', 'g-anim': 'pop', 'g-in': '2' }, t, 3));
    /* 0.01 is genuinely zero-height — the bar has not opened at all yet — so
       there is no ink to read a left edge from. That is the gesture working,
       and it is asserted on its own below; the width comparison samples from
       where the bar actually exists. */
    out.slam = [0.01, 0.5, 1, 2].map((t) => shot({ ...BASE, 'g-shape': 'fill', 'g-anim': 'slam', 'g-in': '2' }, t, 3));
    out.fade = [0, 1.5, 3].map((t) => shot({ ...BASE, 'g-anim': 'fade', 'g-animout': 'fade', 'g-in': '0.5', 'g-out': '0.5' }, t, 3));
    // Weight as a fraction: the same shape at 4x must not be a hairline.
    const small = shot({ ...BASE, 'g-shape': 'box' }, 1.5, 3, 160, 120);
    const big = shot({ ...BASE, 'g-shape': 'box' }, 1.5, 3, 640, 480);
    out.scaled = { smallInk: small.ink / (160 * 120), bigInk: big.ink / (640 * 480) };
    out.shapesAt = [];
    for (const [w, h] of [[64, 48], [128, 96], [1920, 1080], [240, 1080]]) {
      const r = shot(BASE, 1.5, 3, w, h);
      out.shapesAt.push({ wh: `${w}x${h}`, threw: r.threw, ink: r.ink, clear: r.clear, total: r.total });
    }
    return out;
  });

  check('the registry holds every shape the tool ships', probe.ids.length === 8, `${probe.ids.length}`);
  const threw = probe.ids.filter((i) => probe.shapes[i].threw);
  check('no shape throws', threw.length === 0, threw.map((i) => `${i}: ${probe.shapes[i].threw}`).join(' | '));
  const blank = probe.ids.filter((i) => probe.shapes[i].ink === 0);
  check('every shape draws something', blank.length === 0, blank.join(', '));
  const distinct = new Set(probe.ids.map((i) => probe.shapes[i].hash));
  check('…and each one is a DIFFERENT picture — two that render alike means one is not wired',
    distinct.size === 8, `${distinct.size} of 8`);
  const opaque = probe.ids.filter((i) => probe.shapes[i].clear < probe.shapes[i].total * 0.5);
  check('every shape leaves the buffer transparent everywhere it put no ink',
    opaque.length === 0, opaque.map((i) => `${i} ${probe.shapes[i].clear}/${probe.shapes[i].total}`).join(', '));
  /* An outline and its filled twin are the difference between pointing at
     something and covering it, so they must not be the same amount of ink. */
  check('an outline uses far less ink than the fill of the same size',
    probe.shapes.box.ink < probe.shapes.fill.ink * 0.5
      && probe.shapes.ellipse.ink < probe.shapes.disc.ink * 0.5,
    `box ${probe.shapes.box.ink} vs fill ${probe.shapes.fill.ink}, ellipse ${probe.shapes.ellipse.ink} vs disc ${probe.shapes.disc.ink}`);
  /* Corner brackets are a box with the sides left out — so strictly less ink
     than the box, and reaching the same corners. */
  check('corner brackets are a box with its sides left out',
    probe.shapes.bracket.ink < probe.shapes.box.ink
      && Math.abs(probe.shapes.bracket.left - probe.shapes.box.left) <= 2
      && Math.abs(probe.shapes.bracket.right - probe.shapes.box.right) <= 2,
    `bracket ${probe.shapes.bracket.ink} vs box ${probe.shapes.box.ink}`);
  check('a shape with no area draws nothing at all', probe.empty.ink === 0);
  check('the same shape renders identically twice', probe.twice[0].hash === probe.twice[1].hash);

  check('a drawn-on shape puts more on screen as it goes, and stops when it is done',
    probe.draw[0].ink === 0 && probe.draw[1].ink < probe.draw[2].ink && probe.draw[2].ink < probe.draw[3].ink,
    probe.draw.map((f) => f.ink).join(' '));
  check('a popping shape is smaller at the start than at the end, and never fades',
    (probe.pop[0].right - probe.pop[0].left) < (probe.pop[2].right - probe.pop[2].left)
      && probe.pop[0].ink > 0,
    probe.pop.map((f) => `${f.left}..${f.right}`).join(' '));
  check('a slamming bar has not opened at all on its first frame',
    probe.slam[0].ink === 0, String(probe.slam[0].ink));
  check('…then opens vertically, at full width the whole way',
    (probe.slam[1].bottom - probe.slam[1].top) < (probe.slam[2].bottom - probe.slam[2].top)
      && (probe.slam[2].bottom - probe.slam[2].top) < (probe.slam[3].bottom - probe.slam[3].top)
      && probe.slam[1].left === probe.slam[3].left && probe.slam[1].right === probe.slam[3].right,
    probe.slam.slice(1).map((f) => `${f.top}..${f.bottom} @${f.left}..${f.right}`).join(' | '));
  check('a fading shape is absent at both ends and present in the middle',
    probe.fade[0].ink === 0 && probe.fade[1].ink > 0 && probe.fade[2].ink === 0,
    probe.fade.map((f) => f.ink).join(' '));

  /* The reason weight is a percentage of the short side rather than pixels: a
     4x export must not turn every line into a hairline. */
  check('a stroke keeps its proportion at four times the size, rather than becoming a hairline',
    Math.abs(probe.scaled.smallInk - probe.scaled.bigInk) < 0.01, JSON.stringify(probe.scaled));

  const shapeThrew = probe.shapesAt.filter((s2) => s2.threw);
  check('no frame shape makes a graphic throw', shapeThrew.length === 0,
    shapeThrew.map((s2) => `${s2.wh}: ${s2.threw}`).join(' | '));
  const shapeBlank = probe.shapesAt.filter((s2) => !s2.threw && s2.ink === 0);
  check('…and a shape is visible at every one of them, down to a gallery thumbnail',
    shapeBlank.length === 0, shapeBlank.map((s2) => s2.wh).join(', '));
}

/* ================================================== transitions === */
/* Measured on the finished frame, one transition at a time. The bug this
   section exists to catch is a geometric one that no unit test can see: a wipe
   that reveals from the wrong edge, a push that does not move the outgoing
   picture, a direction control wired to nothing. */
/* ===================================================== the matte === */
/* The compositing story: a key decides by colour, a mask decides by geometry,
   and both work by writing alpha into a buffer a scene has just filled edge to
   edge. Measured twice over, because the two halves fail differently:

   on the BUFFER, where a key's arithmetic is observable — did it remove the
   screen and keep the subject, one mode at a time, from the vocabulary lists
   rather than from the pickers;

   and on the FINISHED FRAME, through renderTimelineFrame exactly as the
   exporter runs it, because the whole claim of this feature is that the
   compositor needed no changes. A key that works perfectly on its own buffer
   and is then thrown away by the blend is the failure this section exists to
   catch, and it is the one that shipped. */
section('the matte — a key by colour, a mask by geometry');
{
  const probe = await page.evaluate(async () => {
    const DM = await import('./src/doc/matte.js');
    const VM = await import('./src/video/matte.js');
    const W = 80; const H = 60;
    /* Green left, orange right: a key has something to drop and something to
       keep, and the count says which it did rather than merely that it did
       something. */
    const paint = (x) => {
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      x.clearRect(0, 0, W, H);
      x.fillStyle = '#00b140'; x.fillRect(0, 0, W / 2, H);
      x.fillStyle = '#e07a20'; x.fillRect(W / 2, 0, W / 2, H);
    };
    const shot = (clip, dark) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d', { willReadFrequently: true });
      if (dark) {
        x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, H);
        x.fillStyle = '#080808'; x.fillRect(0, 0, W, H);
        x.fillStyle = '#e8ffe8'; x.fillRect(W / 4, H / 4, W / 2, H / 2);
      } else paint(x);
      let threw = null;
      try { VM.applyMatteTo(x, W, H, clip); } catch (e) { threw = String(e && e.message || e).slice(0, 90); }
      const d = x.getImageData(0, 0, W, H).data;
      let clear = 0; let ink = 0; let leftClear = 0; let greenish = 0; let hash = 5381;
      const alphas = new Set();
      for (let i = 0; i < d.length; i += 4) {
        const px = (i / 4) % W;
        hash = (((hash * 33) ^ (d[i] + d[i + 1] + d[i + 2] + d[i + 3])) >>> 0);
        alphas.add(d[i + 3]);
        if (d[i + 3] === 0) { clear++; if (px < W / 2) leftClear++; } else ink++;
        if (d[i + 3] > 0 && d[i + 1] > d[i] + 30 && d[i + 1] > d[i + 2] + 30) greenish++;
      }
      return { threw, clear, ink, leftClear, greenish, hash, alphas: alphas.size, total: W * H };
    };
    const RECT = { maskShape: 'rect', maskX: 0.3, maskY: 0.3, maskW: 0.4, maskH: 0.4, maskFeather: 0 };
    const out = { keys: {}, masks: {}, keyIds: DM.KEY_MODES.map((k) => k.v),
      maskIds: DM.MASK_MODES.map((m) => m.v) };
    for (const k of out.keyIds) {
      out.keys[k] = shot({ keyMode: k, keyColour: '#00b140', keyTol: 0.28, keySoft: 0.12 });
    }
    for (const m of out.maskIds) out.masks[m] = shot({ ...RECT, maskMode: m, maskAmount: 1 });
    out.zeroAmount = {};
    for (const m of out.maskIds) out.zeroAmount[m] = shot({ ...RECT, maskMode: m, maskAmount: 0 });
    out.none = shot({});
    out.twice = [shot({ keyMode: 'chroma', ...RECT, maskMode: 'blur', maskAmount: 1 }),
      shot({ keyMode: 'chroma', ...RECT, maskMode: 'blur', maskAmount: 1 })];
    out.wide = shot({ keyMode: 'chroma', keyColour: '#00b140', keyTol: 1, keySoft: 0 });
    out.lumaOnDark = shot({ keyMode: 'luma', keyTol: 0.4, keySoft: 0.05 }, true);
    out.noneOnDark = shot({}, true);
    out.hard = shot({ ...RECT, maskShape: 'ellipse', maskMode: 'reveal', maskFeather: 0 });
    out.soft = shot({ ...RECT, maskShape: 'ellipse', maskMode: 'reveal', maskFeather: 0.12 });
    out.inverted = shot({ ...RECT, maskMode: 'reveal', maskInvert: true });
    out.upright = shot({ ...RECT, maskMode: 'reveal' });
    out.zeroArea = shot({ maskShape: 'rect', maskMode: 'reveal', maskW: 0, maskH: 0 });
    out.offFrame = shot({ maskShape: 'rect', maskMode: 'reveal', maskX: 5, maskY: 5, maskW: 0.2, maskH: 0.2 });
    out.shapes = [];
    for (const [w, h] of [[1, 1], [3, 240], [1920, 4], [640, 480]]) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true });
      let threw = null;
      try {
        VM.applyMatteTo(x, w, h, { keyMode: 'chroma', maskShape: 'ellipse',
          maskMode: 'blur', maskW: 0.5, maskH: 0.5, maskFeather: 0.2, maskAmount: 1 });
      } catch (e) { threw = String(e && e.message || e).slice(0, 90); }
      out.shapes.push({ wh: `${w}x${h}`, threw });
    }
    return out;
  });

  const keyThrew = probe.keyIds.filter((k) => probe.keys[k].threw);
  check('no key mode throws', keyThrew.length === 0,
    keyThrew.map((k) => `${k}: ${probe.keys[k].threw}`).join(' | '));
  check('a key that is off leaves every pixel exactly as it was',
    probe.keys.off.hash === probe.none.hash && probe.keys.off.clear === 0);
  /* THE claim about the key. Not "it changed the picture" — it removed the
     green half, all of it, and nothing else. */
  check('a colour key removes the keyed half of the picture and only that half',
    probe.keys.chroma.clear === probe.keys.chroma.leftClear
      && probe.keys.chroma.clear === probe.none.total / 2,
    `${probe.keys.chroma.clear} cleared, ${probe.keys.chroma.leftClear} of them on the keyed side`);
  check('…and no green survives it anywhere', probe.keys.chroma.greenish === 0,
    `${probe.keys.chroma.greenish} greenish px of ${probe.none.greenish} before`);
  check('a tolerance at the top removes the whole picture, which is what a maximum should do',
    probe.wide.ink === 0, `${probe.wide.ink} px left`);
  /* Measured on a DIFFERENT fixture on purpose: both halves of the colour
     fixture are mid-bright, so a brightness key correctly does nothing to it
     and asserting against that would prove only that it can be a no-op. */
  check('a brightness key drops the dark ground and keeps what is lit on it',
    probe.lumaOnDark.clear === probe.noneOnDark.total * 0.75
      && probe.lumaOnDark.ink === probe.noneOnDark.total * 0.25,
    `${probe.lumaOnDark.clear} cleared, ${probe.lumaOnDark.ink} kept`);

  const maskThrew = probe.maskIds.filter((m) => probe.masks[m].threw);
  check('no mask mode throws', maskThrew.length === 0,
    maskThrew.map((m) => `${m}: ${probe.masks[m].threw}`).join(' | '));
  const maskHashes = new Set(probe.maskIds.map((m) => probe.masks[m].hash));
  check('every mask mode is a DIFFERENT picture — none is silently unwired',
    maskHashes.size === probe.maskIds.length, `${maskHashes.size} distinct of ${probe.maskIds.length}`);
  const changed = probe.maskIds.filter((m) => probe.masks[m].hash === probe.none.hash);
  check('…and every one of them actually changes the clip', changed.length === 0, changed.join(', '));
  check('showing only the shape is the one mode that removes pixels',
    probe.masks.reveal.clear > 0
      && ['blur', 'pixelate', 'dim'].every((m) => probe.masks[m].clear === 0),
    probe.maskIds.map((m) => `${m}:${probe.masks[m].clear}`).join(' '));
  /* A control at zero that visibly does something reads as the tool ignoring
     you — and the blur's degrade path would happily soften the region at
     Amount 0 if nothing said otherwise. */
  const notNeutral = ['blur', 'pixelate', 'dim'].filter((m) => probe.zeroAmount[m].hash !== probe.none.hash);
  check('an effect turned down to nothing leaves the clip exactly as it was',
    notNeutral.length === 0, notNeutral.join(', '));
  check('…and a reveal ignores Amount entirely, which is what the panel says it does',
    probe.zeroAmount.reveal.hash === probe.masks.reveal.hash);
  check('inverting a reveal keeps exactly what it used to drop',
    probe.inverted.clear + probe.upright.clear === probe.none.total,
    `${probe.upright.clear} + ${probe.inverted.clear} of ${probe.none.total}`);
  /* Feather is the difference between a spotlight and a hole cut in the
     picture. A hard edge has two alpha values in it; a soft one has a gradient. */
  check('a feathered edge is a gradient and a hard one is not',
    probe.soft.alphas > probe.hard.alphas + 8,
    `${probe.hard.alphas} alpha levels hard, ${probe.soft.alphas} soft`);
  check('a mask with no area does nothing rather than blanking the clip',
    probe.zeroArea.hash === probe.none.hash && probe.zeroArea.ink === probe.none.total);
  check('a mask dragged entirely off the frame reveals nothing, and does not throw',
    !probe.offFrame.threw && probe.offFrame.ink === 0);
  check('the same matte renders identically twice — an export must match the scrub',
    probe.twice[0].hash === probe.twice[1].hash);
  const shapeThrew = probe.shapes.filter((s) => s.threw);
  check('no frame shape makes a key or a mask throw — 1×1 included',
    shapeThrew.length === 0, shapeThrew.map((s) => `${s.wh}: ${s.threw}`).join(' | '));

  /* ---- and now the same claims on the finished frame ------------------- */
  const comp = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const before = S.timeline.map((c) => ({ ...c }));
    /* Regions rather than whole-frame hashes. "The picture changed" is true of
       every one of these and says nothing; what has to be asserted is WHERE it
       changed and, more importantly, where it did NOT. */
    const frame = (T) => {
      const sched = S.buildSchedule();
      const c = document.createElement('canvas'); c.width = sched.tl.W; c.height = sched.tl.H;
      const x = c.getContext('2d', { willReadFrequently: true });
      S.renderTimelineFrame(x, T, sched);
      return { d: x.getImageData(0, 0, c.width, c.height).data, W: c.width, H: c.height };
    };
    /* A hash, a mean and a magenta census over whichever pixels `pred` picks. */
    const stats = (f, pred) => {
      let hash = 5381; let n = 0; let sum = 0; let magenta = 0;
      for (let i = 0; i < f.d.length; i += 4) {
        const p = i / 4; const px = p % f.W; const py = Math.floor(p / f.W);
        if (pred && !pred(px / f.W, py / f.H)) continue;
        const l = f.d[i] + f.d[i + 1] + f.d[i + 2];
        hash = (((hash * 33) ^ l) >>> 0); sum += l; n++;
        if (f.d[i] > 160 && f.d[i + 2] > 160 && f.d[i + 1] < 110) magenta++;
      }
      return { hash, n, magenta, mean: n ? Math.round(sum / n) : 0 };
    };
    const ALL = null;
    const MID = (x, y) => x > 0.12 && x < 0.88 && y > 0.12 && y < 0.88;
    const OUT = (x, y) => x < 0.26 || x > 0.74 || y < 0.26 || y > 0.74;
    const IN = (x, y) => x > 0.42 && x < 0.58 && y > 0.42 && y < 0.58;
    const LEFT = (x) => x < 0.48;
    const RIGHT = (x) => x > 0.52;

    const under = { kind: 'video', scene: 'bars', label: 'under', src: 8, in: 0, out: 8,
      rec: { 'v-scene': 'bars', 'v-dur': '8', 'v-w': '320', 'v-h': '240' } };
    /* A green field with a magenta border, on ONE clip: the green is the
       screen, the border is the subject. A key has to take the first and leave
       the second, which two flat clips could never show. */
    const screenClip = (over) => ({ kind: 'graphic', scene: 'graphic', label: 'fg', src: 6, in: 0, out: 6,
      track: 'V2', at: 0, transition: 'cut', xdur: 0, blend: 'source-over', opacity: 1,
      rec: { 'g-shape': 'box', 'g-x': '0.04', 'g-y': '0.04', 'g-w': '0.92', 'g-h': '0.92',
        'g-colour': '#ff00ff', 'g-weight': '3', 'g-fill': '#00b140', 'g-filla': '1',
        'g-anim': 'none', 'g-animout': 'none', 'g-opacity': '1' },
      ...over });
    const KEY = { keyMode: 'chroma', keyColour: '#00b140', keyTol: 0.28, keySoft: 0.06, keySpill: 0 };

    const out = {};
    S.setTimelineClips([under]);
    const bare = frame(2);
    out.bare = { all: stats(bare, ALL), mid: stats(bare, MID), out: stats(bare, OUT),
      in: stats(bare, IN), left: stats(bare, LEFT), right: stats(bare, RIGHT) };

    // 1. GREEN SCREEN.
    S.setTimelineClips([under, screenClip()]);
    const covered = frame(2);
    out.covered = { mid: stats(covered, MID) };
    S.setTimelineClips([under, screenClip(KEY)]);
    const keyed = frame(2);
    out.keyed = { mid: stats(keyed, MID), all: stats(keyed, ALL) };
    // …and the same clip composited the way an overlay used to default to.
    S.setTimelineClips([under, screenClip({ ...KEY, blend: 'screen' })]);
    const onScreen = frame(2);
    out.keyedOnScreen = { mid: stats(onScreen, MID), all: stats(onScreen, ALL) };

    // 2. BLUR A FACE — on the spine, where a face actually is.
    S.setTimelineClips([{ ...under, maskShape: 'ellipse', maskMode: 'blur',
      maskX: 0.3, maskY: 0.3, maskW: 0.4, maskH: 0.4, maskFeather: 0, maskAmount: 1 }]);
    const blurred = frame(2);
    out.blurred = { out: stats(blurred, OUT), in: stats(blurred, IN) };
    S.setTimelineClips([{ ...under, maskShape: 'ellipse', maskMode: 'pixelate',
      maskX: 0.3, maskY: 0.3, maskW: 0.4, maskH: 0.4, maskFeather: 0, maskAmount: 1 }]);
    const pixelated = frame(2);
    out.pixelated = { out: stats(pixelated, OUT), in: stats(pixelated, IN) };

    // 3. SPOTLIGHT — darken, inverted.
    S.setTimelineClips([{ ...under, maskShape: 'ellipse', maskMode: 'dim', maskInvert: true,
      maskX: 0.3, maskY: 0.3, maskW: 0.4, maskH: 0.4, maskFeather: 0, maskAmount: 0.9 }]);
    const spot = frame(2);
    out.spot = { out: stats(spot, OUT), in: stats(spot, IN) };

    // 4. SPLIT SCREEN — a second shot masked to one half.
    const other = { kind: 'video', scene: 'matrix', label: 'other', src: 6, in: 0, out: 6,
      track: 'V2', at: 0, transition: 'cut', xdur: 0, blend: 'source-over', opacity: 1,
      rec: { 'v-scene': 'matrix', 'v-dur': '6', 'v-w': '320', 'v-h': '240' } };
    S.setTimelineClips([under, other]);
    const whole = frame(2);
    out.whole = { left: stats(whole, LEFT), right: stats(whole, RIGHT) };
    S.setTimelineClips([under, { ...other, maskShape: 'rect', maskMode: 'reveal',
      maskX: 0.5, maskY: 0, maskW: 0.5, maskH: 1, maskFeather: 0 }]);
    const split = frame(2);
    out.split = { left: stats(split, LEFT), right: stats(split, RIGHT) };

    /* 5. THE BLEND. A title with a full-width band behind it, composited at
       screen — the default an overlay has always taken. Screen leaves black
       alone, so the band is not merely dimmed, it is ABSENT, and the frame is
       the one with no band at all. */
    const titled = (treat, blend) => ({ kind: 'title', scene: 'title', label: 't', src: 4, in: 0, out: 4,
      track: 'V2', at: 0, transition: 'cut', xdur: 0, blend, opacity: 1,
      rec: { 't-text': 'EREBUS', 't-anim': 'none', 't-animout': 'none', 't-treat': treat,
        't-fg': '#ffffff', 't-bg': '#000000', 't-bga': '0.85', 't-size': '14' } });
    S.setTimelineClips([under, titled('none', 'screen')]);
    out.noBand = stats(frame(2), ALL);
    S.setTimelineClips([under, titled('bar', 'screen')]);
    out.bandOnScreen = stats(frame(2), ALL);
    S.setTimelineClips([under, titled('bar', 'source-over')]);
    out.bandOnNormal = stats(frame(2), ALL);
    out.freshTitleBlend = (() => {
      S.setTimelineClips([under]);
      S.addTitleClip(0);
      const b = S.timeline[S.timeline.length - 1].blend;
      return b;
    })();

    S.setTimelineClips(before);
    return out;
  });

  /* Asserted first: every comparison below is against this frame, and a blank
     one would make all of them pass by comparing nothing to nothing. */
  check('the shot underneath rendered, so the comparisons below are real',
    comp.bare.all.mean > 90 && comp.bare.mid.n > 1000,
    `mean ${comp.bare.all.mean} over ${comp.bare.all.n}px`);

  check('an un-keyed foreground covers the shot completely — the fixture is opaque',
    comp.covered.mid.hash !== comp.bare.mid.hash && comp.covered.mid.magenta === 0,
    `${comp.covered.mid.magenta} magenta px`);
  /* THE integration claim, and the decisive one: not "the key changed the
     frame" but "the shot underneath came back BYTE-IDENTICAL". Every pixel of
     the green field is gone and every pixel of the picture behind it is exactly
     what it was before the foreground existed. */
  check('a keyed foreground gives the shot underneath back, to the pixel',
    comp.keyed.mid.hash === comp.bare.mid.hash,
    `${comp.keyed.mid.hash} vs ${comp.bare.mid.hash}`);
  check('…while the SUBJECT on that same clip survives the key',
    comp.keyed.all.magenta > 200,
    `${comp.keyed.all.magenta} magenta px kept`);
  /* The bug that shipped, asserted rather than assumed — and asserted where it
     is actually observable. Where the key removed everything, the blend has
     nothing to composite and both modes agree; the damage is done to the part
     the key KEPT, which the screen blend lightens against the shot behind it
     instead of placing over it. */
  check('a key alone is not enough — the same keyed clip is a different picture at the screen blend',
    comp.keyedOnScreen.all.hash !== comp.keyed.all.hash);
  /* Directional rather than thresholded, because the direction is the whole
     argument: screen can only ever LIGHTEN, so a subject composited with it is
     the shot behind it showing through rather than the colour the author
     chose — and the brighter the shot, the less of the subject is left. */
  check('…and it is the subject that pays: the frame only gets brighter and less of its own colour survives',
    comp.keyedOnScreen.all.mean > comp.keyed.all.mean
      && comp.keyedOnScreen.all.magenta < comp.keyed.all.magenta,
    `mean ${comp.keyedOnScreen.all.mean} vs ${comp.keyed.all.mean}, `
    + `magenta ${comp.keyedOnScreen.all.magenta} vs ${comp.keyed.all.magenta}`);

  check('a masked blur changes what is inside the shape',
    comp.blurred.in.hash !== comp.bare.in.hash);
  check('…and leaves everything outside it byte-identical — that is what makes it a face and not a filter',
    comp.blurred.out.hash === comp.bare.out.hash,
    `${comp.blurred.out.hash} vs ${comp.bare.out.hash}`);
  check('a mosaic does the same, and is not the same picture as the blur',
    comp.pixelated.out.hash === comp.bare.out.hash
      && comp.pixelated.in.hash !== comp.bare.in.hash
      && comp.pixelated.in.hash !== comp.blurred.in.hash);

  check('a spotlight leaves the lit shape exactly as it was',
    comp.spot.in.hash === comp.bare.in.hash,
    `${comp.spot.in.hash} vs ${comp.bare.in.hash}`);
  check('…and takes everything around it down',
    comp.spot.out.mean < comp.bare.out.mean * 0.4,
    `${comp.spot.out.mean} of ${comp.bare.out.mean}`);

  check('an unmasked second shot replaces the whole frame — the fixture is opaque too',
    comp.whole.left.hash !== comp.bare.left.hash && comp.whole.right.hash !== comp.bare.right.hash);
  check('masked to one half it is a split screen: the first shot is untouched on the other side',
    comp.split.left.hash === comp.bare.left.hash,
    `${comp.split.left.hash} vs ${comp.bare.left.hash}`);
  check('…and the second shot is genuinely there on its own side',
    comp.split.right.hash !== comp.bare.right.hash
      && comp.split.right.hash === comp.whole.right.hash);

  /* The blend, said as plainly as it can be said. */
  check('a black band behind a title is INVISIBLE at the screen blend — the frame is the one with no band',
    comp.bandOnScreen.hash === comp.noBand.hash,
    `${comp.bandOnScreen.hash} vs ${comp.noBand.hash}`);
  check('…and is there at the normal blend, which is what the band was for',
    comp.bandOnNormal.hash !== comp.noBand.hash
      && comp.bandOnNormal.mean < comp.noBand.mean,
    `mean ${comp.bandOnNormal.mean} banded vs ${comp.noBand.mean} bare`);
  check('so a title added today composites by alpha, as its own docblock always claimed',
    comp.freshTitleBlend === 'source-over', comp.freshTitleBlend);
}

/* ============================================ the matte, by hand ========= */
/* Ten number boxes and a colour well describe a matte; they are not a way to
   make one. These are the two gestures that replace them — click the picture to
   take the key colour off it, drag the mask where it goes — and both are
   measured through the same inverse transform the compositor's matrix defines,
   because that is the part that is silently wrong the moment a clip is scaled. */
section('the matte by hand — an eyedropper and a mask you can drag');
{
  const probe = await page.evaluate(async () => {
    const TL = await import('./src/video/timeline.js');
    const TR = await import('./src/ui/track.js');
    const MON = await import('./src/ui/monitor.js');
    const before = TL.timeline.map((c) => ({ ...c }));
    const beforeMode = MON.monitorMode();

    const GREEN = '#00b140';
    const INK = '#ff00ff';
    /* A green field with a magenta border: one clip with two flat colours in
       known places, so "what did it sample" has an exact answer. */
    const fixture = (over) => ({ kind: 'graphic', scene: 'graphic', label: 'fix', src: 6, in: 0, out: 6,
      rec: { 'g-shape': 'box', 'g-x': '0.1', 'g-y': '0.1', 'g-w': '0.8', 'g-h': '0.8',
        'g-colour': INK, 'g-weight': '4', 'g-fill': GREEN, 'g-filla': '1',
        'g-anim': 'none', 'g-animout': 'none', 'g-opacity': '1' },
      ...over });

    /* The playhead has to be OVER the clip or there is no frame to sample. The
       scrub input is the app's own way of putting it somewhere, and it pauses
       the preview at the same time so nothing moves underneath the probe. */
    const park = (t) => {
      const s = TL.buildSchedule();
      const el = document.getElementById('tl-scrub');
      el.value = String(Math.round((t / Math.max(0.001, s.total)) * 1000));
      el.dispatchEvent(new Event('input'));
    };

    const out = {};
    TL.setTimelineClips([fixture()]);
    TR.focusClipAfterRender(0);
    park(1);
    const sched = TL.buildSchedule();
    const W = sched.tl.W; const H = sched.tl.H;
    out.wh = [W, H];
    out.parked = TL.tlScrubT;

    out.centre = TL.sampleClipColour(0, W / 2, H / 2);
    out.twice = TL.sampleClipColour(0, W / 2, H / 2);
    /* THE claim that separates this from sampling the monitor: the clip is
       keyed to exactly the colour under the pointer, so on the finished frame
       that pixel is GONE. Off the clip's own picture it is still green. */
    TL.setTimelineClips([fixture({ keyMode: 'chroma', keyColour: GREEN, keyTol: 0.3 })]);
    TR.focusClipAfterRender(0);
    park(1);
    out.keyed = TL.sampleClipColour(0, W / 2, H / 2);

    // …and through the clip transform: half size, pushed into the corner.
    TL.setTimelineClips([fixture({ scale: 0.5, x: 0.25, y: 0.25 })]);
    TR.focusClipAfterRender(0);
    park(1);
    out.movedCentre = TL.sampleClipColour(0, W / 2 + 0.25 * W, H / 2 + 0.25 * H);
    out.movedElsewhere = TL.sampleClipColour(0, W * 0.1, H * 0.1);

    // The average is a real average: a wider box across the border is not the
    // flat colour a single pixel gives.
    TL.setTimelineClips([fixture()]);
    TR.focusClipAfterRender(0);
    park(1);
    const edgeY = Math.round(H * 0.1) + 2;
    out.tight = TL.sampleClipColour(0, W / 2, edgeY, 0);
    out.wide = TL.sampleClipColour(0, W / 2, edgeY, 8);
    out.offClip = TL.sampleClipColour(0, -50, -50);

    // ---- the monitor's modes -------------------------------------------
    const MASK = { maskShape: 'rect', maskMode: 'reveal',
      maskX: 0.3, maskY: 0.3, maskW: 0.4, maskH: 0.4 };
    TL.setTimelineClips([fixture(MASK)]);
    TR.focusClipAfterRender(0);
    park(1);
    const shotOverlay = () => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d', { willReadFrequently: true });
      const drew = MON.paintMonitorOverlay(x, TL.buildSchedule());
      const d = x.getImageData(0, 0, W, H).data;
      let hash = 5381; let ink = 0;
      for (let i = 0; i < d.length; i += 4) {
        hash = (((hash * 33) ^ (d[i] + d[i + 1] + d[i + 2] + d[i + 3])) >>> 0);
        if (d[i + 3] > 0) ink++;
      }
      return { drew, hash, ink };
    };
    MON.setMonitorMode('transform'); out.overTransform = shotOverlay();
    MON.setMonitorMode('mask'); out.overMask = shotOverlay();
    MON.setMonitorMode('eyedrop'); out.overEyedrop = shotOverlay();
    MON.setMonitorMode('transform');
    out.modeRoundTrip = [MON.setMonitorMode('mask'), MON.setMonitorMode('nonsense')];

    /* Hit testing against a FAKE canvas: bufferPoint only asks for the element's
       rect, so a stub makes this a question about the arithmetic rather than
       about whether the timeline tab happened to be laid out. */
    const fake = { width: W, height: H,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }) };
    const at = (x, y) => ({ clientX: x, clientY: y });
    MON.setMonitorMode('mask');
    out.hitCentre = MON.monitorHitAt(fake, at(W * 0.5, H * 0.5));
    out.hitCorner = MON.monitorHitAt(fake, at(W * 0.3, H * 0.3));
    out.hitOutside = MON.monitorHitAt(fake, at(W * 0.05, H * 0.95));
    // No mask, mask mode: nothing to grab, and the transform box must NOT
    // answer in its place.
    TL.setTimelineClips([fixture()]);
    TR.focusClipAfterRender(0);
    park(1);
    out.hitNoMask = MON.monitorHitAt(fake, at(W * 0.5, H * 0.5));

    /* The claim that the mask travels with the clip: the same mask on a clip
       shrunk by half sits at half the distance from the frame centre, because a
       mask is applied to the clip's own picture BEFORE the clip is placed. */
    TL.setTimelineClips([fixture(MASK)]);
    TR.focusClipAfterRender(0);
    park(1);
    MON.setMonitorMode('mask');
    out.hitFull = MON.monitorHitAt(fake, at(W * 0.3, H * 0.3));
    TL.setTimelineClips([fixture({ ...MASK, scale: 0.5 })]);
    TR.focusClipAfterRender(0);
    park(1);
    out.hitShrunkOld = MON.monitorHitAt(fake, at(W * 0.3, H * 0.3));
    out.hitShrunkNew = MON.monitorHitAt(fake, at(W * 0.4, H * 0.4));

    MON.setMonitorMode(beforeMode);
    TL.setTimelineClips(before);
    return out;
  });

  check('the eyedropper reads the flat colour it is pointed at',
    probe.centre === '#00b140', String(probe.centre));
  check('…and reads it the same the second time', probe.twice === probe.centre);
  /* The decisive one. On the finished frame this pixel has been keyed away; if
     the eyedropper sampled the monitor it would come back as whatever is
     behind the clip, and widening a key that was nearly right would be
     impossible. */
  check('…and still reads it on a clip that is ALREADY keyed to that very colour',
    probe.keyed === '#00b140', String(probe.keyed));
  check('a clip shrunk into the corner is sampled where it now IS',
    probe.movedCentre === '#00b140', String(probe.movedCentre));
  check('…and the frame it no longer covers reads as nothing at all',
    probe.movedElsewhere === null, String(probe.movedElsewhere));
  check('a point outside the frame is refused rather than clamped to an edge pixel',
    probe.offClip === null, String(probe.offClip));
  /* If the radius were ignored, these two would be identical — which is what a
     single-pixel sample of a compressed green screen gives you, and why keying
     to it leaves speckles. */
  check('the sample is an AVERAGE over a box, not one pixel',
    probe.tight !== probe.wide, `${probe.tight} vs ${probe.wide}`);

  check('the overlay draws the box while you are placing the clip', probe.overTransform.drew
    && probe.overTransform.ink > 0);
  check('…a DIFFERENT box while you are placing the mask',
    probe.overMask.drew && probe.overMask.hash !== probe.overTransform.hash,
    `${probe.overMask.hash} vs ${probe.overTransform.hash}`);
  /* Nothing at all under the eyedropper: the gesture is "look at the picture and
     click the colour", and furniture across it is the one thing that could make
     you click the wrong one. */
  check('…and NOTHING at all while the eyedropper is armed',
    probe.overEyedrop.drew === false && probe.overEyedrop.ink === 0,
    JSON.stringify(probe.overEyedrop));
  check('an unknown mode falls back to placing the clip rather than to nothing',
    probe.modeRoundTrip[0] === 'mask' && probe.modeRoundTrip[1] === 'transform',
    probe.modeRoundTrip.join(','));

  check('the middle of the mask grabs the whole mask', probe.hitCentre === 'move', probe.hitCentre);
  check('its corner grabs a corner', /^c[0-3]$/.test(probe.hitCorner), probe.hitCorner);
  check('and a point outside it grabs nothing — the clip box must not answer here',
    probe.hitOutside === '', probe.hitOutside);
  check('a clip with no mask has nothing to grab in mask mode',
    probe.hitNoMask === '', probe.hitNoMask);
  /* A mask is applied to the clip's OWN picture, so shrinking the clip shrinks
     where the mask lands. Grab the old corner on a half-size clip and you get
     nothing; grab where it went and you get the corner. */
  check('the mask travels with the clip — its corner moves when the clip is scaled',
    probe.hitFull !== '' && probe.hitShrunkOld === '' && /^c[0-3]$/.test(probe.hitShrunkNew),
    `full ${probe.hitFull || '—'}, shrunk at old ${probe.hitShrunkOld || '—'}, at new ${probe.hitShrunkNew || '—'}`);
}

section('every transition, one at a time');
{
  const probe = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const D = await import('./src/doc/timeline.js');
    const before = S.timeline.map((c) => ({ ...c }));

    /* TWO FIXTURES, because the claims need different things and one fixture
       cannot serve both.

       FLAT — two full-frame graphic fills, white then red. The blue channel is
       255 wherever the outgoing clip still shows and 0 where the incoming one
       has taken over, at every pixel, so "how much of this region has turned
       over" is an exact number. Everything geometric is measured here.

       TEXTURED — two real scenes. A flat frame cannot tell a wipe from a slide
       or a slide from a push: with uniform colour, "half the frame is red" is
       the same picture however it got that way. Distinctness, the push's
       displacement of the OUTGOING picture, and the flash colours are measured
       here, where the content itself moves. */
    const flat = (colour, over) => ({
      kind: 'graphic', scene: 'graphic', label: colour, src: 4, in: 0, out: 4,
      rec: { 'g-shape': 'fill', 'g-x': '0', 'g-y': '0', 'g-w': '1', 'g-h': '1',
        'g-colour': colour, 'g-anim': 'none', 'g-animout': 'none', 'g-radius': '0' },
      ...over,
    });
    const tex = (scene, over) => ({
      kind: 'video', scene, label: scene, src: 4, in: 0, out: 4,
      rec: { 'v-scene': scene, 'v-dur': '4', 'v-w': '160', 'v-h': '120' },
      ...over,
    });

    const measure = (t) => {
      const sched = S.buildSchedule();
      const c = document.createElement('canvas');
      c.width = sched.tl.W; c.height = sched.tl.H;
      const x = c.getContext('2d', { willReadFrequently: true });
      S.renderTimelineFrame(x, t, sched);
      const W = c.width; const H = c.height;
      const d = x.getImageData(0, 0, W, H).data;
      const band = (x0, y0, x1, y1, ch) => {
        let sum = 0; let n = 0;
        for (let py = Math.floor(y0 * H); py < Math.floor(y1 * H); py++) {
          for (let px = Math.floor(x0 * W); px < Math.floor(x1 * W); px++) {
            const i = (py * W + px) * 4;
            sum += ch === undefined ? (d[i] + d[i + 1] + d[i + 2]) / 3 : d[i + ch]; n++;
          }
        }
        return n ? Math.round(sum / n) : 0;
      };
      let hash = 5381;
      for (let i = 0; i < d.length; i += 4) hash = (((hash * 33) ^ (d[i] + d[i + 1] + d[i + 2])) >>> 0);
      /* `remain` uses the blue channel and is only meaningful on the FLAT
         fixture; `lum` is the plain brightness and is what the textured one
         reads. Both are returned so the caller picks, rather than two shapes. */
      return {
        hash,
        remain: { all: band(0, 0, 1, 1, 2), left: band(0, 0, 0.2, 1, 2), right: band(0.8, 0, 1, 1, 2),
          top: band(0, 0, 1, 0.2, 2), bottom: band(0, 0.8, 1, 1, 2), centre: band(0.4, 0.4, 0.6, 0.6, 2) },
        lum: { all: band(0, 0, 1, 1), left: band(0, 0, 0.2, 1), right: band(0.8, 0, 1, 1),
          centre: band(0.4, 0.4, 0.6, 0.6) },
        red: band(0, 0, 1, 1, 0), blue: band(0, 0, 1, 1, 2),
      };
    };
    const seq = (mk, t, dir, xdur = 2) => {
      S.setTimelineClips([mk.a, { ...mk.b, transition: t, xdur, xdir: dir }]);
      return S.buildSchedule().starts[1];
    };
    const FLAT = { a: flat('#ffffff'), b: flat('#ff0000', { label: 'B' }) };
    /* Both scenes must be FULL OF CONTENT from their first frame, or a
       comparison lands on two black frames and calls them identical. `hexdump`
       types itself on, so a quarter of a second in it is still an empty screen
       — which read as "a dip is the same picture as a cut". Snow is busy
       immediately, and it is seeded per frame index rather than per call, so
       the same instant is the same picture every time. */
    const TEX = { a: tex('bars'), b: tex('snow', { label: 'B' }) };

    const out = { ids: D.TRANSITIONS, overlapping: D.OVERLAPPING, flat: {}, tex: {}, dirs: {} };
    for (const t of D.TRANSITIONS) {
      const span = D.OVERLAPPING.includes(t) ? 2 : 1;
      const jf = seq(FLAT, t, 'l');
      out.flat[t] = { early: measure(jf + span * 0.2), mid: measure(jf + span * 0.5) };
      const jt = seq(TEX, t, 'l');
      out.tex[t] = {
        early: measure(jt + span * 0.25),
        mid: measure(jt + span * 0.5),
        late: measure(jt + span * 0.8),
        post: measure(jt + span + 0.5),
        // The same instant of the incoming clip, reached by a plain cut — the
        // only honest reference for "did it end clean", because the scene is
        // animated and two different times are two different pictures.
        ref: (() => { const j = seq(TEX, 'cut', 'l'); return measure(j + span + 0.5); })(),
      };
    }
    /* Sampled at 70% of the gesture: a whip pan holds the incoming picture back
       until halfway, so a sample at 30% would find every direction identical
       and call a working transition broken. */
    for (const t of ['wipe', 'slide', 'push', 'barn', 'blinds', 'whip']) {
      const g = {};
      for (const dir of ['l', 'r', 'u', 'd']) g[dir] = measure(seq(FLAT, t, dir) + 1.4);
      out.dirs[t] = g;
    }
    /* Push vs slide needs texture: with flat colour they are the same picture.
       All three are sampled at the SAME ABSOLUTE TIME, which is the only way
       the comparison means anything — the outgoing clip starts at zero in every
       one of the three sequences, so at t it is the same frame of the same clip
       unless the transition moved it. Sampling each at "its own join plus one"
       would compare three different moments and call the difference a bug. */
    const jSlide = seq(TEX, 'slide', 'l');
    const at = jSlide + 1;
    out.moves = { slide: measure(at) };
    seq(TEX, 'push', 'l'); out.moves.push = measure(at);
    seq(TEX, 'cut', 'l'); out.moves.still = measure(at);
    out.moves.at = at;
    S.setTimelineClips(before);
    return out;
  });

  const ids = probe.ids;
  check('the registry holds every transition the tool ships', ids.length === 14, `${ids.length}`);

  /* Each has to be its own picture at the same instant, measured on real
     content — two that render alike means one is not wired to anything. */
  const dupes = [];
  for (const a of ids) for (const b of ids) {
    if (a < b && probe.tex[a].mid.hash === probe.tex[b].mid.hash) dupes.push(`${a}=${b}`);
  }
  check('every transition is a DIFFERENT picture halfway through — none is silently unwired',
    dupes.length === 0, dupes.join(', '));
  const stuck = ids.filter((t) => t !== 'cut' && probe.tex[t].early.hash === probe.tex[t].late.hash);
  check('every transition changes across its own span', stuck.length === 0, stuck.join(', '));
  const dirty = ids.filter((t) => probe.tex[t].post.hash !== probe.tex[t].ref.hash);
  check('every transition ENDS on the clean incoming frame — no residue left behind',
    dirty.length === 0, dirty.join(', '));

  /* The three that show a colour rather than two pictures, each showing its
     own — measured against each other at the same instant. */
  check('a dip goes through black and a white dip through white',
    probe.tex.dip.early.lum.all < probe.tex.cut.early.lum.all
      && probe.tex.dipwhite.early.lum.all > probe.tex.cut.early.lum.all,
    JSON.stringify({ dip: probe.tex.dip.early.lum.all, cut: probe.tex.cut.early.lum.all,
      white: probe.tex.dipwhite.early.lum.all }));
  check('a burn is a warm flare, not a wash — brighter in the middle, and warmer than a white dip',
    probe.tex.burn.early.lum.centre > probe.tex.burn.early.lum.left
      && (probe.tex.burn.early.red - probe.tex.burn.early.blue)
        > (probe.tex.dipwhite.early.red - probe.tex.dipwhite.early.blue),
    JSON.stringify({ centre: probe.tex.burn.early.lum.centre, edge: probe.tex.burn.early.lum.left,
      burnWarmth: probe.tex.burn.early.red - probe.tex.burn.early.blue,
      whiteWarmth: probe.tex.dipwhite.early.red - probe.tex.dipwhite.early.blue }));

  /* On the flat fixture a band's blue mean IS "how much of this region is still
     the old clip", 255 down to 0 — so these are exact statements. */
  check('an iris opens from the centre — the middle turns over before the edges',
    probe.flat.iris.early.remain.centre < probe.flat.iris.early.remain.left - 40
      && probe.flat.iris.early.remain.centre < probe.flat.iris.early.remain.right - 40,
    JSON.stringify(probe.flat.iris.early.remain));
  check('a barn door opens from the centre line outward, not from an edge',
    probe.flat.barn.early.remain.centre < probe.flat.barn.early.remain.left - 40
      && probe.flat.barn.early.remain.centre < probe.flat.barn.early.remain.right - 40,
    JSON.stringify(probe.flat.barn.early.remain));
  check('a clock sweeps round from twelve — the top and the right go before the bottom',
    probe.flat.clock.early.remain.top < probe.flat.clock.early.remain.bottom - 40
      && probe.flat.clock.early.remain.right < probe.flat.clock.early.remain.left,
    JSON.stringify(probe.flat.clock.early.remain));
  check('a wipe covers rather than dissolves — a region is one clip or the other, not a blend of both',
    probe.flat.wipe.mid.remain.left < 8 && probe.flat.wipe.mid.remain.right > 247,
    JSON.stringify(probe.flat.wipe.mid.remain));
  check('…where a crossfade is a blend of both everywhere, which is the difference',
    probe.flat.crossfade.mid.remain.left > 40 && probe.flat.crossfade.mid.remain.left < 215
      && Math.abs(probe.flat.crossfade.mid.remain.left - probe.flat.crossfade.mid.remain.right) < 16,
    JSON.stringify(probe.flat.crossfade.mid.remain));

  /* THE DIRECTION CLAIM. Reversing it must reverse the GEOMETRY, not merely
     produce a different frame — a control passed to a no-op would still change
     the hash. */
  const d = probe.dirs;
  /* A barn door opens from the centre outward, so left and right ARE the same
     gesture and only the axis is a real choice. Declared and checked rather
     than quietly exempted: if barn ever starts distinguishing them, or another
     transition stops, this fails and names it. */
  const AXIS_ONLY = ['barn'];
  const flipped = [];
  for (const t of Object.keys(d)) {
    const same = d[t].l.hash === d[t].r.hash;
    if (AXIS_ONLY.includes(t)) {
      if (!same) flipped.push(`${t}: declared axis-only but left and right differ`);
    } else if (same) flipped.push(`${t}: left and right identical`);
    if (d[t].l.hash === d[t].u.hash) flipped.push(`${t}: horizontal and vertical identical`);
  }
  check('every directional transition distinguishes its axes, and its edges unless it is axis-only',
    flipped.length === 0, flipped.slice(0, 4).join(' | '));
  check('…and the axis-only ones are exactly the ones declared to be',
    Object.keys(d).filter((t) => d[t].l.hash === d[t].r.hash).sort().join() === AXIS_ONLY.join(),
    Object.keys(d).filter((t) => d[t].l.hash === d[t].r.hash).join());
  check('…and “from the left” really does reveal the left first, not merely differently',
    d.wipe.l.remain.left < d.wipe.l.remain.right && d.wipe.r.remain.right < d.wipe.r.remain.left,
    JSON.stringify({ fromLeft: [d.wipe.l.remain.left, d.wipe.l.remain.right],
      fromRight: [d.wipe.r.remain.left, d.wipe.r.remain.right] }));
  check('…and “from the top” reveals the top first, “from the bottom” the bottom',
    d.wipe.u.remain.top < d.wipe.u.remain.bottom && d.wipe.d.remain.bottom < d.wipe.d.remain.top,
    JSON.stringify({ fromTop: [d.wipe.u.remain.top, d.wipe.u.remain.bottom],
      fromBottom: [d.wipe.d.remain.top, d.wipe.d.remain.bottom] }));

  /* A push moves BOTH pictures; a slide moves only the incoming one. That is
     the whole difference between them, and it lives in a look-ahead in the
     compositor that is easy to leave out — and impossible to see on flat
     colour, because "half the frame is the new clip" looks the same either
     way. */
  check('a push and a slide are not the same transition',
    probe.moves.push.hash !== probe.moves.slide.hash);
  check('…because a slide leaves the outgoing picture where it was',
    probe.moves.slide.lum.right === probe.moves.still.lum.right,
    JSON.stringify({ slide: probe.moves.slide.lum.right, still: probe.moves.still.lum.right }));
  check('…and a push shoves it off, so what is under the incoming clip has MOVED',
    probe.moves.push.lum.right !== probe.moves.still.lum.right,
    JSON.stringify({ push: probe.moves.push.lum.right, still: probe.moves.still.lum.right }));
}

/* ================================================== canvas state hygiene === */
/* The bug class a render-and-compare suite cannot see. A draw routine that
   leaves a save() unmatched, a transform set, or a clip region installed does
   not look wrong — it looks wrong LATER, in whatever is drawn next, in a
   different module, and only sometimes. The compositor draws scenes, overlays,
   the CRT stack and the author's filter chain onto one context in sequence, so
   one leak contaminates everything downstream of it.

   Measured rather than grepped: save/restore balance is a property of the call
   graph at runtime, and the clip region cannot be read back at all — the only
   honest test is to fill the whole canvas afterwards and count what the fill
   was allowed to reach. */
/* ==================================================== every frame shape === */
/* The suite above asks each thing whether it works. This asks whether it works
   at the SIZE IT WILL BE DELIVERED AT — which is a different question, and one
   a tool whose preview defaults to 320x240 and whose Format picker offers
   1920x1080 has to be able to answer.
 *
 * Everything here is driven from the registries and swept across a ladder that
 * deliberately includes the shapes nobody authors at: one pixel, a favicon, a
 * 1:4 column and a 12:1 letterbox slot. Those are not hypothetical — a gallery
 * thumbnail is tiny, a social delivery is a column, and a banner is a slot, and
 * the Format picker will hand any of them to every one of these routines.
 *
 * Three claims, and they are deliberately the three that are true of EVERY kind
 * rather than a proportionality claim that is only true of some (see the note
 * on the px-denominated parameters at the end).
 */
section('every frame shape, from one pixel to a letterbox slot');
{
  const shapes = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const scenes = await import('./src/video/scenes.js');
    const tpls = await import('./src/image/templates.js');
    const img = await import('./src/image/render.js');
    const F = await import('./src/fx/filters.js');
    const T = await import('./src/doc/title.js');
    const VT = await import('./src/video/title.js');
    const G = await import('./src/doc/graphic.js');
    const VG = await import('./src/video/graphic.js');
    const DM = await import('./src/doc/matte.js');
    const VM = await import('./src/video/matte.js');
    const A = await import('./src/doc/annotations.js');

    /* One pixel and a favicon are in here to be SURVIVED, not to look good. The
       middle of the ladder is what has to look right; the ends are what has to
       not throw. */
    const TINY = [[1, 1], [16, 12]];
    const REAL = [[64, 48], [320, 240], [1920, 1080], [240, 960], [1920, 160], [321, 241]];
    const ALL = [...TINY, ...REAL];
    /* A same-aspect pair for the proportionality question: 4x the linear size,
       so "is this the same picture bigger" has an exact answer. */
    const PROPORTION = [[320, 240], [1280, 960]];

    const stat = (ctx, W, H) => {
      const d = ctx.getImageData(0, 0, W, H).data;
      const step = Math.max(1, Math.round(Math.sqrt((W * H) / 40000)));
      let lit = 0; let n = 0; let clear = 0;
      let top = H; let bottom = -1; let left = W; let right = -1;
      for (let y = 0; y < H; y += step) {
        for (let x = 0; x < W; x += step) {
          const i = (y * W + x) * 4;
          n++;
          if (d[i + 3] === 0) { clear++; continue; }
          if (d[i] + d[i + 1] + d[i + 2] > 24) {
            lit++;
            if (y < top) top = y; if (y > bottom) bottom = y;
            if (x < left) left = x; if (x > right) right = x;
          }
        }
      }
      /* "Did it draw anything" is asked on the FULL buffer, not the strided
         one, and it stops as soon as the answer is yes. An edge detector's
         output at 1920 wide is a line one pixel across, which is exactly what
         a stride steps over — the strided scan called it blank, and it was not. */
      let anyInk = false;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        anyInk = true;
        seen.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
        if (seen.size >= 3) break;
      }
      /* The outermost ring, asked separately: a routine that lays out from a
         fixed inset leaves the border of a big frame untouched, and an average
         over the whole picture cannot see that. */
      let edgeClear = 0; let edgeN = 0;
      const ring = (x, y) => { const i = (y * W + x) * 4; edgeN++; if (d[i + 3] === 0) edgeClear++; };
      for (let x = 0; x < W; x += step) { ring(x, 0); ring(x, H - 1); }
      for (let y = 0; y < H; y += step) { ring(0, y); ring(W - 1, y); }
      return {
        colours: seen.size,
        anyInk,
        clearFrac: +(clear / n).toFixed(4),
        edgeClearFrac: +(edgeClear / Math.max(1, edgeN)).toFixed(4),
        // Fractions, so two sizes are directly comparable.
        box: bottom < 0 ? null : { x: left / W, y: top / H, w: (right - left) / W, h: (bottom - top) / H },
        lit: lit / n,
      };
    };
    const run = (draw, W, H) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      try { draw(ctx, W, H); } catch (e) { return { threw: String(e && e.message || e).slice(0, 70) }; }
      return stat(ctx, W, H);
    };

    const vbase = { ...S.readVideoCfg(), text: 'EREBUS ARCHIVE\nNODE 47', persist: 0 };
    const ibase = { ...S.readImageCfg(), title: 'RECOVERED', body: 'Line one\nLine two' };
    const WORDS = { 't-text': 'EREBUS ARCHIVE', 't-sub': 'RECOVERED 1997' };
    /* Every drawn thing in the tool, as a draw function keyed by group. Opaque
       kinds are the ones that own the whole frame; overlay kinds draw on
       nothing and are allowed — required — to leave most of it clear. */
    const KINDS = {
      scene: { opaque: true, ids: Object.keys(scenes.SCENES),
        draw: (id) => (c, W, H) => S.renderVideoFrame(c, W, H, { ...vbase, scene: id, W, H }, 1.25) },
      template: { opaque: true, ids: Object.keys(tpls.TEMPLATES),
        draw: (id) => (c, W, H) => img.drawImageTo(c, W, H, { ...ibase, tpl: id, W, H }) },
      filter: { opaque: true, ids: Object.keys(F.FILTERS),
        draw: (id) => (c, W, H) => {
          c.fillStyle = '#204060'; c.fillRect(0, 0, W, H);
          c.fillStyle = '#e8f0a0'; c.fillRect(W * 0.2, H * 0.2, W * 0.6, H * 0.6);
          F.FILTERS[id].apply(c, W, H, F.resolveParams(id, {}), 1);
        } },
      mark: { opaque: true, ids: A.ANNOTATION_KINDS.map((k) => k.id),
        draw: (id) => (c, W, H) => img.drawImageTo(c, W, H, { ...ibase, W, H,
          __annotations: A.normalizeAnnotations([{ kind: id, x: 0.2, y: 0.2, w: 0.5, h: 0.4, text: 'MARK' }]) }) },
      title: { opaque: false, ids: T.TITLE_PLACES.map((p) => p.v),
        draw: (id) => (c, W, H) =>
          VT.drawTitleTo(c, W, H, T.makeTitle({ ...WORDS, 't-place': id, 't-treat': 'none' }), 1.5, 3) },
      treatment: { opaque: false, ids: [...T.TREATMENTS],
        draw: (id) => (c, W, H) => VT.drawTitleTo(c, W, H, T.makeTitle({ ...WORDS, 't-treat': id }), 1.5, 3) },
      texteffect: { opaque: false, ids: [...T.TEXT_FX],
        draw: (id) => (c, W, H) => VT.drawTitleTo(c, W, H,
          T.makeTitle({ ...WORDS, 't-fx': id, 't-fxamt': '0.8', 't-treat': 'none' }), 1.5, 3) },
      shape: { opaque: false, ids: G.SHAPES.map((s) => s.v),
        draw: (id) => (c, W, H) => VG.drawGraphicTo(c, W, H, G.makeGraphic({ 'g-shape': id,
          'g-x': '0.2', 'g-y': '0.2', 'g-w': '0.6', 'g-h': '0.5',
          'g-anim': 'none', 'g-animout': 'none' }), 1, 3) },
      mask: { opaque: true, ids: DM.MASK_MODES.map((m) => m.v),
        draw: (id) => (c, W, H) => {
          c.fillStyle = '#3a7fb0'; c.fillRect(0, 0, W, H);
          c.fillStyle = '#f0e0a0'; c.fillRect(W * 0.1, H * 0.1, W * 0.35, H * 0.35);
          VM.applyMatteTo(c, W, H, { maskShape: 'ellipse', maskMode: id, maskX: 0.25, maskY: 0.25,
            maskW: 0.5, maskH: 0.5, maskFeather: 0.05, maskAmount: 0.7 });
        } },
    };

    const out = { counts: {}, threw: [], holes: [], edges: [], nothing: [], drift: [], total: 0 };
    for (const [kind, spec] of Object.entries(KINDS)) {
      out.counts[kind] = spec.ids.length;
      for (const id of spec.ids) {
        out.total++;
        for (const [W, H] of ALL) {
          const r = run(spec.draw(id), W, H);
          const at = `${kind}/${id}@${W}x${H}`;
          if (r.threw) { out.threw.push(`${at}: ${r.threw}`); continue; }
          if (spec.opaque) {
            // A 'reveal' mask is the one opaque-fixture case that MAY clear.
            if (!(kind === 'mask' && id === 'reveal')) {
              if (r.clearFrac > 0.001) out.holes.push(`${at} clear=${r.clearFrac}`);
              if (r.edgeClearFrac > 0.001) out.edges.push(`${at} edge=${r.edgeClearFrac}`);
            }
          }
          /* "Drew something" is asked from 64x48 up: one pixel has no room.
             The bar differs by kind, and it has to. An opaque routine owns the
             frame, so a single flat colour across all of it means it drew a
             field and nothing else. An OVERLAY draws on nothing — a white title
             on a transparent buffer is one colour by definition, and asking it
             for two would fail every plain title in the tool. */
          if (W >= 64 && (spec.opaque ? r.colours <= 1 : !r.anyInk)) out.nothing.push(at);
        }
        /* PROPORTION: the fraction-authored kinds claim to be the same picture
           at any size. Four times the linear size, same aspect — the ink's
           bounding box, in fractions, must not move. */
        if (!spec.opaque) {
          const [a, b] = PROPORTION.map(([W, H]) => run(spec.draw(id), W, H));
          if (a.box && b.box) {
            const d = Math.max(Math.abs(a.box.x - b.box.x), Math.abs(a.box.y - b.box.y),
              Math.abs(a.box.w - b.box.w), Math.abs(a.box.h - b.box.h));
            if (d > 0.05) out.drift.push(`${kind}/${id} moved ${d.toFixed(3)} of the frame`);
          } else if (!!a.box !== !!b.box) {
            out.drift.push(`${kind}/${id} draws at one size and not the other`);
          }
        }
      }
    }
    return out;
  });

  check('the sweep covers every registered scene, template, filter, mark, title, shape and mask',
    shapes.total >= 170 && shapes.counts.scene === 48 && shapes.counts.template === 46,
    JSON.stringify(shapes.counts));
  /* One pixel is in the ladder for exactly this. Half the geometry in this tool
     divides by a dimension or takes a radius from one, and a negative radius is
     a THROW rather than a bad-looking frame — which is how a 12:1 banner used
     to take the Calendar and Autopsy templates down. */
  check('nothing throws at any frame shape — one pixel, a favicon, a column and a 12:1 slot included',
    shapes.threw.length === 0, shapes.threw.slice(0, 6).join(' | '));
  /* A routine that owns the frame must not leave holes in it. Clearing and then
     displacing leaves a transparent gash that is invisible on the video tab —
     the canvas sits on black — and is a real hole in a keyed overlay and in an
     alpha export. Three filters did it. */
  check('nothing that owns the frame leaves a transparent hole in it',
    shapes.holes.length === 0, shapes.holes.slice(0, 6).join(' | '));
  check('…and every one of them paints all the way to the frame edge',
    shapes.edges.length === 0, shapes.edges.slice(0, 6).join(' | '));
  /* Measured as more than one COLOUR, not as brightness: a terminal screen is
     legitimately dark, and asking for lit pixels would call it blank. */
  check('everything draws a picture at every size a person would deliver at',
    shapes.nothing.length === 0, shapes.nothing.slice(0, 8).join(', '));
  /* THE claim for everything authored in fractions. Four times the linear size
     and the ink has to land in the same place, or "a title made at 320x240 is
     the same title at 1920x1080" is just a comment. */
  check('every title, treatment, text effect and shape is the SAME picture at four times the size',
    shapes.drift.length === 0, shapes.drift.slice(0, 6).join(' | '));

  /* …and the other half of the answer. The things above are authored in
     fractions and hold their proportions by construction. Thirty-two filter
     parameters and the type size are authored in PIXELS, which is the right
     unit to type and the wrong one to keep when the delivery size changes
     underneath them — so the format picker carries them. */
  const carried = await page.evaluate(async () => {
    const V = await import('./src/video/filters.js');
    const st = window.DeadSignalStudio.store;
    const el = (id) => document.getElementById(id);
    const before = { w: el('v-w').value, h: el('v-h').value, font: el('v-font').value,
      fmt: el('v-format').value, chain: st?.get('filters.video') };
    // A chain with one pixel measurement in it and one that is not.
    st.apply((await import('./src/doc/store.js')).set('filters.video',
      [{ id: 'filmgrain', params: { size: 1, amount: 40 }, enabled: true }], { label: 'probe' }));
    const font0 = Number(el('v-font').value);
    const grain0 = V.videoFilters()[0].params.size;
    // Pick a bigger format the way a person would: through the picker.
    const opts = Array.from(el('v-format').options).map((o) => o.value);
    const big = opts.find((v) => /1080|720/.test(v)) || opts[opts.length - 1];
    el('v-format').value = big;
    el('v-format').dispatchEvent(new Event('change', { bubbles: true }));
    const out = { big, font0, font1: Number(el('v-font').value),
      grain0, grain1: V.videoFilters()[0].params.size,
      amount: V.videoFilters()[0].params.amount,
      h0: Number(before.h), h1: Number(el('v-h').value) };
    // Typing a size, by contrast, must NOT rewrite the rest of the controls.
    const fontBeforeTyping = Number(el('v-font').value);
    el('v-w').value = String(Number(el('v-w').value) * 2);
    el('v-w').dispatchEvent(new Event('change', { bubbles: true }));
    out.fontAfterTyping = Number(el('v-font').value);
    out.fontBeforeTyping = fontBeforeTyping;

    el('v-format').value = before.fmt;
    el('v-format').dispatchEvent(new Event('change', { bubbles: true }));
    el('v-w').value = before.w; el('v-w').dispatchEvent(new Event('change', { bubbles: true }));
    el('v-h').value = before.h; el('v-h').dispatchEvent(new Event('change', { bubbles: true }));
    el('v-font').value = before.font; el('v-font').dispatchEvent(new Event('change', { bubbles: true }));
    st.apply((await import('./src/doc/store.js')).set('filters.video', before.chain || [], { label: 'restore' }));
    return out;
  });
  check('choosing a bigger delivery format takes the type size up with it',
    carried.h1 > carried.h0 && carried.font1 > carried.font0,
    `${carried.h0}→${carried.h1} lines, font ${carried.font0}→${carried.font1}`);
  check('…and the chain’s pixel-denominated parameters too',
    carried.grain1 > carried.grain0, `grain ${carried.grain0}→${carried.grain1}`);
  check('…and leaves the parameters that are not pixel measurements alone',
    carried.amount === 40, String(carried.amount));
  /* The asymmetry is deliberate: typing into W is how you CORRECT a size, and a
     tool that rewrote five other controls under each keystroke would be
     unusable. Only the picker means "re-scale this". */
  check('…while typing a width by hand changes nothing but the width',
    carried.fontAfterTyping === carried.fontBeforeTyping,
    `${carried.fontBeforeTyping} → ${carried.fontAfterTyping}`);
}

section('canvas state hygiene, one draw routine at a time');
{
  await page.evaluate(() => {
    const P = CanvasRenderingContext2D.prototype;
    if (P.__depthPatched) return;
    P.__depthPatched = true;
    const save = P.save; const restore = P.restore;
    window.__depth = 0; window.__minDepth = 0;
    P.save = function () { window.__depth++; return save.call(this); };
    P.restore = function () {
      window.__depth--;
      if (window.__depth < window.__minDepth) window.__minDepth = window.__depth;
      return restore.call(this);
    };
  });

  const probe = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const img = await import('./src/image/render.js');
    const scenes = await import('./src/video/scenes.js');
    const tpls = await import('./src/image/templates.js');
    const F = await import('./src/fx/filters.js');
    const W = 128; const H = 96;

    /* Run one draw and report everything it left behind. */
    const audit = (draw) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      window.__depth = 0; window.__minDepth = 0;
      let threw = null;
      try { draw(ctx); } catch (e) { threw = String(e && e.message || e).slice(0, 70); }
      const depth = window.__depth; const under = window.__minDepth;
      const m = ctx.getTransform();
      const identity = m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
      const alpha = ctx.globalAlpha; const comp = ctx.globalCompositeOperation;
      const cfilter = ctx.filter;
      /* A clip region cannot be read back, so ask it a question instead: paint
         the whole buffer and count how much of it the paint was allowed to
         reach. Under a leaked clip, most of the canvas stays as it was. */
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(0, 0, W, H);
      const d = ctx.getImageData(0, 0, W, H).data;
      let covered = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] === 255 && d[i + 1] === 0 && d[i + 2] === 255) covered++;
      }
      return {
        threw, depth, under, identity, alpha, comp,
        cfilter: cfilter && cfilter !== 'none' ? cfilter : '',
        clipped: covered !== W * H, covered, total: W * H,
      };
    };

    const out = { scenes: {}, templates: {}, filters: {} };
    const base = { ...S.readVideoCfg(), W, H, text: 'STATE', persist: 0 };
    for (const id of Object.keys(scenes.SCENES)) {
      out.scenes[id] = audit((ctx) => S.renderVideoFrame(ctx, W, H, { ...base, scene: id }, 1.25));
    }
    const ibase = { ...S.readImageCfg(), W, H };
    for (const id of Object.keys(tpls.TEMPLATES)) {
      /* `tpl`, not `template`. readImageCfg's field is `tpl`, so the wrong key
         was silently ignored and this swept the DEFAULT template forty-six
         times over — forty-five passes that could not fail. Caught by the size
         audit, where every template returned byte-identical statistics. */
      out.templates[id] = audit((ctx) => img.drawImageTo(ctx, W, H, { ...ibase, tpl: id }));
    }
    for (const id of Object.keys(F.FILTERS)) {
      const p = F.resolveParams(id, {});
      out.filters[id] = audit((ctx) => F.FILTERS[id].apply(ctx, W, H, p, 1));
    }
    /* The matte is the one that draws onto the SHARED clip scratch, mid-
       sequence — so a blend or a filter string left set here would not tint the
       next control, it would tint the next frame of an export. */
    const VM = await import('./src/video/matte.js');
    const DM = await import('./src/doc/matte.js');
    out.mattes = {};
    for (const k of DM.KEY_MODES.map((e) => e.v)) {
      for (const m of DM.MASK_MODES.map((e) => e.v)) {
        out.mattes[`${k}+${m}`] = audit((ctx) => {
          ctx.fillStyle = '#00b140'; ctx.fillRect(0, 0, W, H);
          VM.applyMatteTo(ctx, W, H, { keyMode: k, maskShape: 'ellipse', maskMode: m,
            maskX: 0.2, maskY: 0.2, maskW: 0.6, maskH: 0.6, maskFeather: 0.1, maskAmount: 0.8 });
        });
      }
    }
    return out;
  });

  for (const [what, group] of [['scene', probe.scenes], ['template', probe.templates],
    ['filter', probe.filters], ['key and mask combination', probe.mattes]]) {
    const ids = Object.keys(group);
    const unbalanced = ids.filter((i) => group[i].depth !== 0);
    check(`every ${what} leaves the save/restore stack exactly as it found it`,
      unbalanced.length === 0, unbalanced.map((i) => `${i}=${group[i].depth}`).join(', '));
    const popped = ids.filter((i) => group[i].under < 0);
    check(`no ${what} pops a save it did not push — it would restore its CALLER’s state`,
      popped.length === 0, popped.map((i) => `${i}=${group[i].under}`).join(', '));
    const skewed = ids.filter((i) => !group[i].identity);
    check(`every ${what} leaves the transform at identity`,
      skewed.length === 0, skewed.join(', '));
    const clipped = ids.filter((i) => group[i].clipped);
    check(`no ${what} leaves a clip region installed — the next draw would be cropped by it`,
      clipped.length === 0,
      clipped.map((i) => `${i}: ${group[i].covered}/${group[i].total}px reachable`).join(', '));
    const dirty = ids.filter((i) => group[i].alpha !== 1 || group[i].comp !== 'source-over' || group[i].cfilter);
    check(`every ${what} leaves alpha, blend mode and filter string neutral`,
      dirty.length === 0,
      dirty.map((i) => `${i}(a=${group[i].alpha},c=${group[i].comp}${group[i].cfilter ? ',f=' + group[i].cfilter : ''})`).join(', '));
  }
}

/* ============================================ reachable at every size === */
/* The polish bug that hides best. A control that is present, correctly styled,
   correctly labelled and simply COVERED by something else reads as fine in
   every screenshot and in every suite that asks "is it wired" — the handler is
   attached, the test can dispatch to it directly, and only a human with a mouse
   ever finds out. That is exactly how the monitor frame came to lie over the
   transport on a short window, silently killing play, pause and the scrubber.

   So: at seven window sizes, walk every rendered control on every tab and ask
   the browser what is actually at its centre. Occlusion, zero size and a
   control pushed outside its own scroll container all fail the same way. */
section('every control is reachable at every window size, in every layout');
{
  const SIZES = [
    [1920, 1080], [1600, 900], [1440, 900], [1366, 768],
    [1280, 800], [1024, 768],
    // The two that break layouts: a short window and a narrow one.
    [1280, 620], [960, 700],
  ];
  /* All three layouts, because the bug this section exists to catch was in
     exactly one of them. The editor is the default and gets every size; the
     other two get the widest, a common laptop and the short window, which is
     where a layout gives out. */
  const LAYOUTS = [
    { name: 'editor', sizes: SIZES, set: () => { /* the default */ } },
    { name: 'workspace', sizes: [[1920, 1080], [1366, 768], [1280, 620]],
      set: () => { document.getElementById('editor-toggle')?.click();
                   document.getElementById('workspace-toggle')?.click(); } },
    { name: 'classic', sizes: [[1920, 1080], [1366, 768], [1280, 620]],
      set: () => { if (document.body.classList.contains('workspace')) document.getElementById('workspace-toggle')?.click();
                   if (document.body.classList.contains('nle')) document.getElementById('editor-toggle')?.click(); } },
  ];
  const TABS = ['video', 'audio', 'image', 'timeline', 'library', 'bundle', 'cloud', 'help'];
  const problems = [];
  const overflow = [];
  const stacked = [];

  /* The first-run welcome card is a modal, and a modal covering the page is
     what a modal is FOR. Dismiss it the way a first-time author does, so what
     follows measures the tool rather than the greeting. */
  await page.evaluate(() => {
    document.getElementById('welcome-close')?.click();
    const el = document.getElementById('welcome');
    if (el && el.getClientRects().length) el.hidden = true;
  });

  const modesSeen = [];
  for (const layout of LAYOUTS) {
   await page.evaluate((fn) => { (new Function('return ' + fn))()(); }, layout.set.toString());
   await page.waitForTimeout(150);
   const mode = await page.evaluate(() => document.body.className.trim() || '(classic)');
   modesSeen.push(`${layout.name}=${mode}`);
   for (const [w, h] of layout.sizes) {
    await page.setViewportSize({ width: w, height: h });
    for (const tab of TABS) {
      await page.evaluate((t) => document.getElementById('tab-' + t)?.click(), tab);
      await page.waitForTimeout(60);
      /* Panels laid one exactly on top of another. Reported separately from
         occlusion because the cause is different — grid placement, not z-order
         — and because a covered PANEL takes every control in it at once. */
      const overlaps = await page.evaluate((t) => {
        const v = document.getElementById('view-' + t);
        if (!v) return [];
        const boxes = [];
        for (const p of v.querySelectorAll('.panel')) {
          if (!p.getClientRects().length) continue;
          let a = p.parentElement; let nested = false;
          while (a && a !== v) { if (a.classList.contains('panel')) { nested = true; break; } a = a.parentElement; }
          if (nested) continue;
          const r = p.getBoundingClientRect();
          boxes.push({ h: (p.querySelector('h2,h3')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24) || '(untitled)', r });
        }
        const out = [];
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const A = boxes[i].r; const B = boxes[j].r;
          const ox = Math.min(A.right, B.right) - Math.max(A.left, B.left);
          const oy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
          if (ox > 4 && oy > 4) out.push(`${boxes[i].h} under/over ${boxes[j].h}`);
        }
        return out;
      }, tab);
      for (const o of overlaps) stacked.push(`${mode} ${w}x${h} ${tab}: ${o}`);
      const found = await page.evaluate(({ tab, w, h }) => {
        const out = { blocked: [], zero: [], overflowX: 0 };
        const doc = document.documentElement;
        out.overflowX = doc.scrollWidth - doc.clientWidth;
        const view = document.getElementById('view-' + tab);
        if (!view) return out;
        const sel = 'button, input, select, textarea, [role="tab"], [role="button"], a[href]';
        for (const el of view.querySelectorAll(sel)) {
          if (el.disabled) continue;
          if (!el.getClientRects().length) continue;      // collapsed section: not rendered at all
          const name = el.id || el.name || (el.textContent || '').trim().slice(0, 24) || el.tagName;
          /* Scrolled into view FIRST. The settings columns and the lane are
             scroll containers, so a control below the fold is not an occlusion
             bug — and testing only what happens to be visible would leave most
             of the tool unexamined. Bringing each one into view is also exactly
             what an author does before clicking it. */
          try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch { /* older engines */ }
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) { out.zero.push(`${name} ${Math.round(r.width)}x${Math.round(r.height)}`); continue; }
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          // Still off screen after being scrolled to: it cannot be reached at all.
          if (cx < 0 || cy < 0 || cx > w || cy > h) {
            out.blocked.push(`${name}: off screen even after scrolling to it`);
            continue;
          }
          const hit = document.elementFromPoint(cx, cy);
          if (!hit) { out.blocked.push(`${name}: nothing at its centre`); continue; }
          if (hit === el || el.contains(hit) || hit.contains(el)) continue;
          // A <label> wrapping its own control is not something in the way.
          if (hit.tagName === 'LABEL' && hit.control === el) continue;
          const by = hit.id || hit.className || hit.tagName;
          out.blocked.push(`${name} ← ${String(by).slice(0, 40)}`);
        }
        return out;
      }, { tab, w, h });
      for (const b of found.blocked) problems.push(`${mode} ${w}x${h} ${tab}: ${b}`);
      for (const z of found.zero) problems.push(`${mode} ${w}x${h} ${tab}: ${z} has no clickable area`);
      if (found.overflowX > 1) overflow.push(`${mode} ${w}x${h} ${tab}: +${found.overflowX}px`);
    }
   }
  }
  // Back to the layout everything else in this file assumes.
  await page.evaluate(() => {
    if (document.body.classList.contains('workspace')) document.getElementById('workspace-toggle')?.click();
    if (!document.body.classList.contains('nle')) document.getElementById('editor-toggle')?.click();
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  /* Asserted, not assumed. If the toggles had not fired, all three passes would
     have measured the same layout and every check below would have passed by
     testing one thing three times. */
  check('all three layouts were actually entered — the checks below are not one layout thrice',
    new Set(modesSeen.map((m) => m.split('=')[1])).size === 3, modesSeen.join(' · '));
  check('no two panels are laid one on top of another — a covered panel takes every control in it',
    stacked.length === 0, stacked.slice(0, 6).join(' | ') + (stacked.length > 6 ? ` … +${stacked.length - 6}` : ''));
  check('no control is covered by something else, at any window size or layout the tool offers',
    problems.length === 0, problems.slice(0, 6).join(' | ') + (problems.length > 6 ? ` … +${problems.length - 6}` : ''));
  check('the page never scrolls sideways — a horizontal scrollbar means something overflowed',
    overflow.length === 0, overflow.slice(0, 6).join(' | '));
}

/* ================================================== the empty states === */
/* What the tool says before you have done anything. Every list, lane and
   gallery starts empty exactly once per user, and that is the moment they
   decide whether it is broken. An empty container with no words in it is
   indistinguishable from one that failed to load. */
section('the empty states say something');
{
  const empties = await page.evaluate(async () => {
    const out = [];
    const TABS = ['video', 'audio', 'image', 'timeline', 'library', 'bundle', 'cloud', 'help'];
    for (const t of TABS) {
      document.getElementById('tab-' + t)?.click();
      const view = document.getElementById('view-' + t);
      if (!view) continue;
      /* Anything that holds a list of things the author has not made yet. */
      for (const el of view.querySelectorAll('[data-empty], .empty, .lane, .gallery, .list, [role="list"], [role="listbox"]')) {
        if (!el.getClientRects().length) continue;
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        const hasChildren = el.children.length > 0;
        if (!hasChildren && text.length === 0) {
          out.push(`${t}: ${el.id || el.className || el.tagName} is blank with nothing to explain it`);
        }
      }
    }
    return out;
  });
  check('no empty list or lane is a silent blank box', empties.length === 0, empties.slice(0, 5).join(' | '));
}

/* ======================================================= modal dialogs === */
/* Three things a modal owes the keyboard, and all three fail silently for a
   mouse user, which is why nothing catches them by accident: it must take focus
   when it opens (or the next Tab lands somewhere behind it), Escape must close
   it, and focus must go back where it came from — a dialog that dumps focus on
   <body> when it closes leaves the next Tab starting from the top of the page. */
section('every modal takes focus, closes on Escape, and hands focus back');
{
  /* Opened through their real buttons, on the tab those buttons live on — a
     modal opened by calling its function directly would not prove the button
     works, and the button is the only way an author ever opens one. */
  const MODALS = [
    { name: 'the welcome card', tab: 'help', open: 'help-welcome' },
    { name: 'the command palette', tab: 'video', open: 'palette-open' },
    { name: 'the preset manager', tab: 'video', open: 'v-preset-manage' },
  ];
  const seen = [];
  for (const m of MODALS) {
    const r = await page.evaluate(async (m) => {
      const sleep = (ms) => new Promise((r2) => setTimeout(r2, ms));
      const modalNow = () => [...document.querySelectorAll('[aria-modal="true"]')]
        .find((e) => e.getClientRects().length) || null;
      // Close anything already open, and start from a known focus.
      document.body.click();
      for (let i = 0; i < 3 && modalNow(); i++) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(60);
      }
      document.getElementById('tab-' + m.tab)?.click();
      await sleep(120);
      const opener = document.getElementById(m.open);
      if (!opener) return { missing: m.open };
      opener.scrollIntoView({ block: 'center' });
      opener.focus();
      const before = document.activeElement;
      opener.click();
      await sleep(250);
      const box = modalNow();
      if (!box) return { neverOpened: true };
      const inside = box.contains(document.activeElement);
      const label = box.id || box.className || box.tagName;
      // Escape, from wherever focus is.
      (document.activeElement || document).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(220);
      const stillOpen = !!modalNow();
      const back = document.activeElement;
      return {
        label, inside, stillOpen,
        restored: back === before,
        landedOnBody: back === document.body || back === document.documentElement,
      };
    }, m);
    seen.push({ name: m.name, ...r });
  }
  const live = seen.filter((r) => !r.missing && !r.neverOpened);
  check('all three modals open', live.length === 3,
    seen.filter((r) => r.missing || r.neverOpened).map((r) => `${r.name}: ${r.missing ? 'no opener #' + r.missing : 'did not open'}`).join(' | '));
  const noFocus = live.filter((r) => !r.inside);
  check('a modal takes focus when it opens — otherwise the next Tab lands behind it',
    noFocus.length === 0, noFocus.map((r) => r.name).join(', '));
  const noEsc = live.filter((r) => r.stillOpen);
  check('Escape closes every modal', noEsc.length === 0, noEsc.map((r) => r.name).join(', '));
  const lost = live.filter((r) => r.landedOnBody);
  check('closing a modal does not drop focus on the page body — the next Tab would start from the top',
    lost.length === 0, lost.map((r) => r.name).join(', '));
  const notBack = live.filter((r) => !r.restored);
  check('…and puts it back on the control that opened it, so the next Tab carries on from there',
    notBack.length === 0, notBack.map((r) => r.name).join(', '));
}

/* ===================================================== document wiring === */
/* The mis-wirings that produce no error and no visible symptom until the wrong
   thing moves. A duplicate id means getElementById returns the FIRST one for
   ever, so the second control is inert and its neighbour answers for it. A
   dangling idref means a label points at nothing, or a tab claims a panel that
   does not exist. An empty <select> is a control with no choices in it. */
section('the document is wired to itself correctly');
{
  const wiring = await page.evaluate(() => {
    const out = { dupes: [], danglingFor: [], danglingAria: [], emptySelects: [], unbounded: [] };
    const seen = new Map();
    for (const el of document.querySelectorAll('[id]')) {
      seen.set(el.id, (seen.get(el.id) || 0) + 1);
    }
    for (const [id, n] of seen) if (n > 1) out.dupes.push(`${id} x${n}`);

    for (const l of document.querySelectorAll('label[for]')) {
      if (!document.getElementById(l.htmlFor)) out.danglingFor.push(`label->${l.htmlFor}`);
    }
    for (const attr of ['aria-controls', 'aria-labelledby', 'aria-describedby', 'aria-owns']) {
      for (const el of document.querySelectorAll(`[${attr}]`)) {
        for (const ref of el.getAttribute(attr).split(/\s+/).filter(Boolean)) {
          if (!document.getElementById(ref)) out.danglingAria.push(`${el.id || el.tagName} ${attr}->${ref}`);
        }
      }
    }
    for (const sel of document.querySelectorAll('select')) {
      if (!sel.options.length) out.emptySelects.push(sel.id || sel.name || '(unnamed select)');
    }
    for (const inp of document.querySelectorAll('input[type="number"], input[type="range"]')) {
      /* A number box with no bounds accepts anything, and the code behind it
         then clamps silently — so the author types 400, sees 400 in the box,
         and gets 100. The bounds belong on the control. */
      if (inp.min === '' || inp.max === '') out.unbounded.push(`${inp.id || inp.name || inp.type} (min="${inp.min}" max="${inp.max}")`);
    }
    return out;
  });

  check('no element id appears twice — the second one would be permanently inert',
    wiring.dupes.length === 0, wiring.dupes.slice(0, 8).join(', '));
  check('every <label for> points at a control that exists',
    wiring.danglingFor.length === 0, wiring.danglingFor.slice(0, 8).join(', '));
  check('every aria idref resolves — a tab that claims a panel that is not there tells a reader a lie',
    wiring.danglingAria.length === 0, wiring.danglingAria.slice(0, 8).join(', '));
  check('no <select> is empty by the time boot has finished',
    wiring.emptySelects.length === 0, wiring.emptySelects.slice(0, 8).join(', '));

  /* …and no select is blanked by the document a moment later.
     "Empty at boot" was checked; "blanked on the first edit" was not, and that
     is what was happening. index.html declares seven selects with no <option>
     children — the lists come from the registries at init time, which runs long
     after startSession seeds the document from the markup — so the value
     recorded as their boot default was "". renderDocToDom writes the document
     back to the DOM on EVERY notification, including the author's own edits, so
     one move of any slider drove all seven to selectedIndex -1: an empty box,
     ＋ FILTER and ＋ FX answering "Pick one first", and ＋ KEY silently writing
     onto whatever the first automatable parameter happens to be.
     Asserted through a real edit rather than by reading the markup, because the
     markup was never the broken part — the ordering was. */
  const blanking = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const sels = [...document.querySelectorAll('.view select')].filter((s) => s.id && s.options.length);
    const before = sels.map((s) => [s.id, s.selectedIndex]);
    const scan = document.getElementById('v-scan');
    const was = scan.value;
    scan.value = String(Math.max(1, (Number(was) + 17) % 100));
    scan.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    const blanked = sels.filter((s) => s.selectedIndex === -1).map((s) => s.id);

    // The consequence, not just the symptom: the two chain pickers must still add.
    const vBefore = (S.store.get('filters.video') || []).length;
    document.getElementById('v-filters-add')?.click();
    const aBefore = (S.store.get('filters.audio') || []).length;
    document.getElementById('a-fx-add')?.click();
    await new Promise((r) => setTimeout(r, 200));
    const added = { video: (S.store.get('filters.video') || []).length - vBefore,
                    audio: (S.store.get('filters.audio') || []).length - aBefore };
    S.clearFilters(); S.clearChain?.('a-fx');
    scan.value = was; scan.dispatchEvent(new Event('input', { bubbles: true }));
    return { count: before.length, blanked, added };
  });
  check('no <select> is blanked by the document on the first ordinary edit',
    blanking.blanked.length === 0,
    blanking.blanked.join(', ') || `${blanking.count} selects held their selection`);
  check('…so ＋ FILTER and ＋ FX still add after an edit, rather than saying "Pick one first"',
    blanking.added.video === 1 && blanking.added.audio === 1, JSON.stringify(blanking.added));
  check('every number and range input declares its own bounds, so the box agrees with the clamp',
    wiring.unbounded.length === 0, wiring.unbounded.slice(0, 8).join(', '));

  /* DECLARING A BOUND IS NOT ENFORCING ONE.
     The check above proves each field advertises min/max. `<input type=number>`
     clamps only its own steppers, so a TYPED number was kept however far
     outside them it was — and every reader here goes through clamp(), so the
     picture was right while the control, the document AND THE SAVED PROJECT
     FILE all said something else. Measured on a stock build: 1299 into FPS
     (max 30) rendered at 30, stored "1299", and wrote "1299" into the project
     file — a number no build of this tool will ever honour, travelling with the
     project forever. Duration 9999 → 60, width −50 → 64. All 53 behaved so. */
  const held = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const nums = [...document.querySelectorAll('input[type=number][min][max]')]
      .filter((e) => e.id && !e.disabled);
    const commit = (el, v) => { el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true })); };
    const over = [], under = [];
    for (const el of nums) {
      const min = Number(el.min), max = Number(el.max), orig = el.value;
      commit(el, max * 10 + 999);
      if (Number(el.value) > max) over.push(`${el.id}>${max}:${el.value}`);
      commit(el, min - 999);
      if (Number(el.value) < min) under.push(`${el.id}<${min}:${el.value}`);
      commit(el, orig);
    }

    /* And the document must agree with the box, or the project file carries the
       number the tool refused. */
    document.querySelector('.tab[data-view=video]').click();
    const fps = document.getElementById('v-fps');
    commit(fps, 1299);
    const doc = S.store.get('tabs.video.v-fps');
    const saved = JSON.parse(JSON.stringify(S.readProject())).tabs?.video?.['v-fps'];
    const rendered = S.readVideoCfg().fps;
    commit(fps, 12);

    /* Typing is NOT corrected mid-keystroke: an `input` alone leaves the box, so
       typing "50" into a field whose minimum is 10 survives the "5". */
    fps.value = '3';
    fps.dispatchEvent(new Event('input', { bubbles: true }));
    const midTyping = fps.value;
    commit(fps, 12);

    /* A cleared box is a box being cleared, not a value of zero. */
    const dur = document.getElementById('v-dur');
    const durWas = dur.value;
    commit(dur, '');
    const cleared = dur.value;
    commit(dur, durWas);

    /* An in-range value passes through untouched and without a word. */
    const toastsBefore = document.getElementById('toasts').textContent;
    const w = document.getElementById('v-w');
    const wWas = w.value;
    commit(w, 480);
    const inRange = { kept: w.value, silent: document.getElementById('toasts').textContent === toastsBefore };
    commit(w, wWas);

    return { checked: nums.length, over, under, doc, saved, rendered, midTyping, cleared, inRange };
  });
  check('…and every one of them is HELD to those bounds when a value is typed',
    held.over.length === 0 && held.under.length === 0,
    `${held.checked} fields · over: ${held.over.join(',') || 'none'} · under: ${held.under.join(',') || 'none'}`);
  check('…so the document and the saved project carry what will actually render',
    held.doc === '30' && held.saved === '30' && held.rendered === 30,
    `doc ${held.doc}, saved ${held.saved}, rendered ${held.rendered}`);
  check('…while typing is left alone until it is committed',
    held.midTyping === '3', held.midTyping);
  check('…a cleared box stays cleared rather than snapping to a minimum',
    held.cleared === '', JSON.stringify(held.cleared));
  check('…and an in-range value passes through untouched and unremarked',
    held.inRange.kept === '480' && held.inRange.silent === true, JSON.stringify(held.inRange));
}

console.log('-'.repeat(64));
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  · ' + f);
}
check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
console.log(`\nDead Signal Studio deep audit: ${pass} passed, ${fail} failed`);

await browser.close();
server.close();
process.exit(fail === 0 ? 0 : 1);
