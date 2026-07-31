/* Dead Signal Studio — production-readiness audit (Chromium).
 *
 * The other suites prove the studio LOADS. This one proves it WORKS: that
 * every button is wired to something, every effect actually changes the
 * output, every preset applies, and every export produces a real file.
 *
 * A slider that moves but changes nothing looks identical to a working one in
 * a screenshot, and identical to a working one in a smoke test that only asks
 * "did it render". The only honest check is to render with the parameter at
 * its minimum and again at its maximum and compare the pixels.
 */
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' };
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
  catch { console.log('Dead Signal Studio audit: playwright not installed — SKIPPED'); process.exit(0); }
}
const EXEC = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));

let pass = 0, fail = 0;
const failures = [];
const check = (name, ok, extra = '') => {
  if (!ok) { fail++; failures.push(name + (extra ? ' — ' + extra : '')); } else pass++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};
const section = (t) => console.log(`\n[${t}]`);

console.log('Dead Signal Studio production audit');
console.log('-'.repeat(64));

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {} );
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
/* The CLOUD tab looks for an optional backend at boot: it reads the optional
   deployment note (studio.config.json) and then tries each candidate API
   address (./api, then ./api/index.php for a host with no rewrite). On a static
   deploy every one of those 404s, and the browser logs each as a console error
   — that is the lookup working, not a fault. Filtered by URL so real errors
   still surface. */
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const from = m.location?.().url || '';
  if (/\/api(\/index\.php)?\/system\/health$/.test(from) || from.endsWith('/studio.config.json')) return;
  errors.push('console: ' + m.text());
});

/* Record which elements receive listeners, before any of the app's own code
   runs. This is the only reliable way to tell a wired button from a dead one
   without clicking it and hoping something visible happens. */
await page.addInitScript(() => {
  window.__wired = { byId: {}, count: 0 };
  const orig = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    try {
      const id = this && this.id;
      if (id) (window.__wired.byId[id] = window.__wired.byId[id] || new Set()).add(type);
      window.__wired.count++;
    } catch { /* ignore */ }
    return orig.call(this, type, fn, opts);
  };
});

await page.addInitScript(() => {
  // A cold browser profile has never seen the welcome card, and it is modal.
  // Suppress it the way a returning author's browser would, so the suites
  // exercise the studio rather than the first-run screen. The card itself is
  // covered by its own section below.
  try { localStorage.setItem('deadsignal.studio.welcomed', 'true'); } catch { /* ignore */ }
});

await page.goto(PAGE);
await page.waitForFunction(() => document.documentElement.dataset.studio === 'ready');

/* ==================================================== every control wired == */
section('wiring');
{
  const r = await page.evaluate(() => {
    const wired = (el) => {
      // Direct listener, a delegated listener on an ancestor view, or a label
      // that forwards the click.
      if (window.__wired.byId[el.id]) return true;
      for (let n = el.parentElement; n; n = n.parentElement) {
        if (n.id && window.__wired.byId[n.id]) return true;
      }
      return false;
    };
    const dead = { buttons: [], controls: [] };
    for (const b of document.querySelectorAll('button')) {
      if (!wired(b)) dead.buttons.push(b.id || b.textContent.trim().slice(0, 20));
    }
    for (const c of document.querySelectorAll('#view-video input, #view-video select, #view-video textarea, #view-audio input, #view-audio select, #view-audio textarea, #view-image input, #view-image select, #view-image textarea, #view-timeline input, #view-timeline select, #view-timeline textarea')) {
      if (!c.id) continue;
      if (!wired(c)) dead.controls.push(c.id);
    }
    return { dead, listeners: window.__wired.count };
  });
  check('listeners were registered', r.listeners > 20, `${r.listeners}`);
  check('every button is wired to something', r.dead.buttons.length === 0,
        r.dead.buttons.join(', '));
  check('every settings control is wired', r.dead.controls.length === 0,
        r.dead.controls.join(', '));
}

/* ================================================ video effects do something */
section('video effects change the picture');
{
  // Render deterministically off-screen at a fixed time, so the comparison is
  // of the effect and nothing else.
  const hashAt = (overrides, t = 1.5) => page.evaluate(({ overrides, t }) => {
    const S = window.DeadSignalStudio;
    const cfg = Object.assign(S.readVideoCfg(), { W: 160, H: 120 }, overrides);
    const c = document.createElement('canvas'); c.width = cfg.W; c.height = cfg.H;
    S.renderVideoFrame(c.getContext('2d'), cfg.W, cfg.H, cfg, t);
    const d = c.getContext('2d').getImageData(0, 0, cfg.W, cfg.H).data;
    let h = 2166136261 >>> 0;
    for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(16);
  }, { overrides, t });

  // Several effects are deliberately time-gated — glitch fires roughly one
  // frame in nine, corruption only during a glitch, flicker is probabilistic,
  // reveal only in the closing seconds, blink alternates. Sampling one frame
  // proves nothing about those, so compare across a span of frames and ask
  // whether ANY frame differs. Note v-tc is `checked` in the markup, so the
  // baseline must switch it off explicitly.
  const spanHash = (overrides, frames = 40) => page.evaluate(({ overrides, frames }) => {
    const S = window.DeadSignalStudio;
    const cfg = Object.assign(S.readVideoCfg(), { W: 120, H: 90 }, overrides);
    const out = [];
    for (let f = 0; f < frames; f++) {
      const t = (f / frames) * cfg.duration;
      const c = document.createElement('canvas'); c.width = cfg.W; c.height = cfg.H;
      S.renderVideoFrame(c.getContext('2d'), cfg.W, cfg.H, cfg, t);
      const d = c.getContext('2d').getImageData(0, 0, cfg.W, cfg.H).data;
      let h = 2166136261 >>> 0;
      for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
      out.push(h.toString(16));
    }
    return out;
  }, { overrides, frames });

  const BASE = { scene: 'terminal', duration: 10, scan: 0, noise: 0, vig: 0, flick: 0,
                 glitch: 0, chroma: 0, bloom: 0, persist: 0, mask: 0, hum: 0, track: 0,
                 shake: 0, roll: 0, dither: false, fade: 0, reveal: '', sub: '', blink: '',
                 corrupt: 0, hud: '', tc: false, morse: '' };

  const baseSpan = await spanHash(BASE);
  const differs = async (overrides) => {
    const span = await spanHash({ ...BASE, ...overrides });
    return span.some((h, i) => h !== baseSpan[i]);
  };

  const EFFECTS = [
    ['scan', { scan: 1 }], ['noise', { noise: 1 }], ['vignette', { vig: 1 }],
    ['flicker', { flick: 1 }], ['glitch', { glitch: 1 }], ['chroma', { chroma: 1 }],
    ['bloom', { bloom: 1 }], ['shadow mask', { mask: 1 }], ['hum bar', { hum: 1 }],
    ['tracking', { track: 1 }], ['shake', { shake: 1 }], ['roll', { roll: 1 }],
    ['dither', { dither: true }], ['corruption', { glitch: 1, corrupt: 1 }],
    ['fade', { fade: 3 }],
  ];
  const dead = [];
  for (const [name, ov] of EFFECTS) if (!(await differs(ov))) dead.push(name);
  check(`all ${EFFECTS.length} CRT/VHS effects alter the picture`, dead.length === 0, dead.join(', '));

  const OVERLAYS = [
    ['status bar', { hud: 'CAM 47 // LAB-3' }],
    ['timecode', { tc: true }],
    ['morse strip', { morse: 'SOS' }],
    ['blink code', { blink: '4' }],
    ['reveal', { reveal: 'OBSERVE', revhold: 2 }],
    ['subliminal', { sub: 'LOOK', subat: 5, subframes: 4 }],
  ];
  const deadOv = [];
  for (const [name, ov] of OVERLAYS) if (!(await differs(ov))) deadOv.push(name);
  check(`all ${OVERLAYS.length} overlays render`, deadOv.length === 0, deadOv.join(', '));

  // Persistence blends the PREVIOUS frame, so it can only show on a moving
  // scene rendered in sequence — comparing two isolated frames would blend an
  // image with itself and look like a no-op.
  const persistDiff = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const run = (persist) => {
      const cfg = Object.assign(S.readVideoCfg(), { W: 120, H: 90, scene: 'matrix',
        duration: 10, persist, scan: 0, noise: 0, vig: 0, flick: 0, glitch: 0, chroma: 0,
        bloom: 0, mask: 0, hum: 0, track: 0, shake: 0, roll: 0, dither: false, fade: 0,
        hud: '', tc: false, morse: '', blink: '', reveal: '', sub: '' });
      const c = document.createElement('canvas'); c.width = 120; c.height = 90;
      const ctx = c.getContext('2d');
      for (let f = 0; f < 8; f++) S.renderVideoFrame(ctx, 120, 90, cfg, f * 0.25);
      const d = ctx.getImageData(0, 0, 120, 90).data;
      let h = 2166136261 >>> 0;
      for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
      return h.toString(16);
    };
    return { off: run(0), on: run(0.9) };
  });
  check('phosphor persistence alters a moving scene',
        persistDiff.off !== persistDiff.on, `${persistDiff.off} / ${persistDiff.on}`);

  // The regression that motivated this check: persistence used to be drawn
  // BEFORE the scene, and 15 of 22 scenes fill their own background, so it did
  // nothing on any of them. Prove it works on a background-filling scene.
  const persistPerScene = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const run = (scene, persist) => {
      const cfg = Object.assign(S.readVideoCfg(), { W: 100, H: 80, scene, duration: 10,
        persist, scan: 0, noise: 0, vig: 0, flick: 0, glitch: 0, chroma: 0, bloom: 0,
        mask: 0, hum: 0, track: 0, shake: 0, roll: 0, dither: false, fade: 0,
        hud: '', tc: false, morse: '', blink: '', reveal: '', sub: '' });
      const c = document.createElement('canvas'); c.width = 100; c.height = 80;
      const ctx = c.getContext('2d');
      for (let f = 0; f < 6; f++) S.renderVideoFrame(ctx, 100, 80, cfg, f * 0.3);
      const d = ctx.getImageData(0, 0, 100, 80).data;
      let h = 2166136261 >>> 0;
      for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
      return h.toString(16);
    };
    const dead = [];
    for (const scene of ['matrix', 'scope', 'radar', 'spectrum', 'ekg', 'cityrain', 'terminal']) {
      if (run(scene, 0) === run(scene, 0.9)) dead.push(scene);
    }
    return dead;
  });
  check('persistence works on background-filling scenes too',
        persistPerScene.length === 0, persistPerScene.join(', '));

  // How often the time-gated effects actually fire, so a change in their
  // gating shows up here rather than silently.
  const duty = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const span = (ov) => {
      const cfg = Object.assign(S.readVideoCfg(), { W: 80, H: 60, scene: 'terminal',
        duration: 10, scan: 0, noise: 0, vig: 0, flick: 0, glitch: 0, chroma: 0, bloom: 0,
        persist: 0, mask: 0, hum: 0, track: 0, shake: 0, roll: 0, dither: false, fade: 0,
        hud: '', tc: false, morse: '', blink: '', reveal: '', sub: '', corrupt: 0 }, ov);
      const out = [];
      for (let f = 0; f < 60; f++) {
        const c = document.createElement('canvas'); c.width = 80; c.height = 60;
        S.renderVideoFrame(c.getContext('2d'), 80, 60, cfg, (f / 60) * 10);
        const d = c.getContext('2d').getImageData(0, 0, 80, 60).data;
        let h = 2166136261 >>> 0;
        for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
        out.push(h.toString(16));
      }
      return out;
    };
    const base = span({});
    const count = (ov) => span(ov).filter((h, i) => h !== base[i]).length;
    return { flicker: count({ flick: 1 }), glitch: count({ glitch: 1 }), blink: count({ blink: '4' }) };
  });
  check('flicker fires on a meaningful share of frames at maximum',
        duty.flicker >= 6, `${duty.flicker}/60 frames`);
  check('glitch fires periodically', duty.glitch >= 4, `${duty.glitch}/60 frames`);
  check('blink code alternates', duty.blink >= 10 && duty.blink <= 50, `${duty.blink}/60 frames`);

  // Every scene must be distinguishable from the others — a scene that draws
  // nothing of its own would otherwise pass the smoke test's "non-blank".
  const sceneHashes = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const out = {};
    for (const id of Object.keys(S.SCENES)) {
      const cfg = Object.assign(S.readVideoCfg(), { W: 160, H: 120, scene: id,
        scan: 0, noise: 0, vig: 0, flick: 0, glitch: 0, chroma: 0, bloom: 0, persist: 0,
        mask: 0, hum: 0, track: 0, shake: 0, roll: 0, dither: false, fade: 0 });
      const c = document.createElement('canvas'); c.width = 160; c.height = 120;
      S.renderVideoFrame(c.getContext('2d'), 160, 120, cfg, 1.5);
      const d = c.getContext('2d').getImageData(0, 0, 160, 120).data;
      let h = 2166136261 >>> 0;
      for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
      out[id] = h.toString(16);
    }
    return out;
  });
  const byHash = {};
  for (const [id, h] of Object.entries(sceneHashes)) (byHash[h] = byHash[h] || []).push(id);
  const dupes = Object.values(byHash).filter((g) => g.length > 1);
  // videoin + kenburns both draw the same "no media" placeholder, which is
  // correct behaviour rather than a bug.
  const realDupes = dupes.filter((g) => !(g.every((id) => ['videoin', 'kenburns'].includes(id))));
  check(`all ${Object.keys(sceneHashes).length} scenes draw distinct output`,
        realDupes.length === 0, realDupes.map((g) => g.join('=')).join(' | '));

  // Snow + 2×SS: putImageData ignores the current transform, so the static
  // used to land in the top-left device quarter of every supersampled frame
  // (measured quadrant variances {tl:2882, tr:154, bl:66, br:111}). It must be
  // noisy in ALL four quadrants now.
  const quadrants = await page.evaluate(async () => {
    const R = await import('./src/video/render.js');
    const S = window.DeadSignalStudio;
    const cfg = Object.assign(S.readVideoCfg(), { W: 160, H: 120, scene: 'snow', ss: true,
      scan: 0, noise: 0, vig: 0, flick: 0, glitch: 0, chroma: 0, bloom: 0, persist: 0,
      mask: 0, hum: 0, track: 0, shake: 0, roll: 0, dither: false, fade: 0,
      __auto: null, __layers: null, __filters: null });
    const c = document.createElement('canvas'); c.width = 160; c.height = 120;
    const ctx = c.getContext('2d');
    R.renderScaled(ctx, 160, 120, cfg, 0.5);
    const variance = (x0, y0) => { const d = ctx.getImageData(x0, y0, 80, 60).data;
      const n = d.length / 4; let m = 0, s = 0;
      for (let i = 0; i < d.length; i += 4) m += d[i]; m /= n;
      for (let i = 0; i < d.length; i += 4) s += (d[i] - m) * (d[i] - m);
      return s / n; };
    return { tl: Math.round(variance(0, 0)), tr: Math.round(variance(80, 0)),
             bl: Math.round(variance(0, 60)), br: Math.round(variance(80, 60)) };
  });
  check('snow renders static in every quadrant under 2× supersample',
        quadrants.tl > 500 && quadrants.tr > 500 && quadrants.bl > 500 && quadrants.br > 500,
        JSON.stringify(quadrants));
}

/* ================================================ image effects do something */
section('the screen filter chain');
{
  const chain = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const R = await import('./src/image/render.js');
    const set = (l) => S.store.apply({ op: 'set', path: 'filters.image', value: l });
    const hashLive = () => {
      const c = document.getElementById('icanvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let h = 2166136261 >>> 0;
      for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
      return h.toString(16);
    };
    document.getElementById('i-tpl').value = 'terminal';
    // Live SCREEN tab: a filter in the chain changes the preview; bypassed, it
    // is the bare still again.
    set([]); S.renderImage(); const bare = hashLive();
    set([{ id: 'invert', enabled: true, params: { amount: 100 } }]); S.renderImage();
    const filtered = hashLive();
    set([{ id: 'invert', enabled: false, params: { amount: 100 } }]); S.renderImage();
    const bypassed = hashLive();
    // readImageCfg surfaces the live chain as __filters.
    set([{ id: 'invert', enabled: true, params: { amount: 100 } }]);
    const liveLen = (R.readImageCfg().__filters || []).length;
    set([]);
    // A captured recipe carries its OWN __filters, and readImageCfg(rec) +
    // drawImageTo apply it — so a still-in-sequence filters with what it was
    // made with, not the tab's later state. Rendered offscreen, no side effects.
    const recHash = (recFilters) => {
      const rec = { 'i-tpl': 'terminal', __filters: recFilters };
      const cfg = Object.assign(R.readImageCfg(rec), { W: 200, H: 150 });
      const c = document.createElement('canvas'); c.width = 200; c.height = 150;
      R.drawImageTo(c.getContext('2d'), 200, 150, cfg);
      const d = c.getContext('2d').getImageData(0, 0, 200, 150).data;
      let h = 2166136261 >>> 0;
      for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
      return h.toString(16);
    };
    return { bare, filtered, bypassed, liveLen,
             recBare: recHash([]),
             recFiltered: recHash([{ id: 'invert', enabled: true, params: { amount: 100 } }]) };
  });
  check('a filter in the SCREEN chain changes the still', chain.filtered !== chain.bare,
        `${chain.bare} vs ${chain.filtered}`);
  check('…and bypassing it restores the bare still exactly', chain.bypassed === chain.bare,
        `${chain.bypassed} vs ${chain.bare}`);
  check('readImageCfg surfaces the live chain', chain.liveLen === 1, String(chain.liveLen));
  check('a captured still filters with its OWN recipe chain, not the live tab',
        chain.recFiltered !== chain.recBare, `${chain.recBare} vs ${chain.recFiltered}`);
}

section('screen effects change the image');
{
  const hashImg = (overrides) => page.evaluate((overrides) => {
    const S = window.DeadSignalStudio;
    for (const [k, v] of Object.entries(overrides)) {
      const el = document.getElementById(k);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    S.renderImage();
    const c = document.getElementById('icanvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 2166136261 >>> 0;
    for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(16);
  }, overrides);

  const ZERO = { 'i-tpl':'terminal', 'i-scan':0, 'i-noise':0, 'i-vig':0, 'i-chroma':0,
                 'i-bloom':0, 'i-dead':0, 'i-copy':0, 'i-skew':0, 'i-posterize':0,
                 'i-halftone':0, 'i-pixsort':0, 'i-duotone':false, 'i-stego':'', 'i-invert':'' };
  const base = await hashImg(ZERO);
  const deadImg = [];
  for (const [k, v] of [['i-scan',100],['i-noise',100],['i-vig',100],['i-chroma',100],
                        ['i-bloom',100],['i-dead',100],['i-copy',100],['i-skew',100],
                        ['i-posterize',100],['i-halftone',100],['i-pixsort',100],
                        ['i-duotone',true],['i-stego','HIDDEN'],['i-invert','SECRET']]) {
    const h = await hashImg({ ...ZERO, [k]: v });
    if (h === base) deadImg.push(k);
  }
  check('all 14 screen effects alter the image', deadImg.length === 0, deadImg.join(', '));
  await hashImg(ZERO);

  /* …AND THE INVERT MARK HAS TO LAND ON EVERY TEMPLATE, not just this one.
     The sweep above pins i-tpl:'terminal', which is dark, and the mark was
     always white at 4% alpha: +10 per channel there, and nothing at all on light
     stock. Measured over all 46 templates: Task Manager took NO pixels (white
     over white) and Prescription, Boarding Pass and Statement took a difference
     of ONE unit, which no invert reveals and no re-encode survives. */
  const mark = await page.evaluate(async () => {
    const T = await import('./src/image/templates.js');
    const R = await import('./src/image/render.js');
    const px = (id, over) => {
      const W = 320, H = 240;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      const cfg = R.readImageCfg();
      cfg.W = W; cfg.H = H; cfg.tpl = id; cfg.wrap = true;
      for (const k of ['scan', 'noise', 'vig', 'chroma', 'bloom', 'dead', 'copy',
        'skew', 'posterize', 'halftone', 'pixsort']) cfg[k] = 0;
      cfg.duotone = false; cfg.stego = ''; cfg.invert = '';
      Object.assign(cfg, over);
      R.drawImageTo(ctx, W, H, cfg);
      return ctx.getImageData(0, 0, W, H).data;
    };
    const faint = [];
    for (const id of Object.keys(T.TEMPLATES)) {
      const a = px(id, {}), b = px(id, { invert: 'OBSERVE' });
      let touched = 0, worst = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        if (d) { touched++; if (d > worst) worst = d; }
      }
      // Deliberately faint — it is meant to survive an invert, not be read — but
      // a single unit is rounding, not a message.
      if (touched < 50 || worst < 6) faint.push(`${id}: ${touched}px, worst Δ${worst}`);
    }
    return { total: Object.keys(T.TEMPLATES).length, faint };
  });
  check('the invert mark lands on every template, light stock included',
        mark.faint.length === 0, `${mark.total} templates; ${mark.faint.slice(0, 5).join(' | ')}`);

  /* A PAYLOAD THAT DID NOT FIT HAS TO SAY SO.
     The 4096-byte ceiling toasted; the per-frame capacity — the one an author
     actually hits, because a 120×90 screen holds 1346 bytes — only wrote to the
     log panel and returned. So the exported PNG carried no payload, nothing said
     so where anyone was looking, and the in-tool decoder reads the LIVE canvas,
     so checking it in the tool could not tell you either. */
  const stego = await page.evaluate(async () => {
    const St = await import('./src/image/stego.js');
    const said = () => document.getElementById('toasts')?.textContent || '';
    const attempt = (W, H, n) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#123'; ctx.fillRect(0, 0, W, H);
      const before = said();
      const ok = St.embedStego(ctx, W, H, 'x'.repeat(n), '#123');
      return { ok, toasted: said() !== before };
    };
    const cap = St.stegoCapacity(120, 90);
    return {
      cap, hardMax: St.STEGO_MAX,
      atCapacity: attempt(120, 90, cap),
      overCapacity: attempt(120, 90, cap + 1),
      atHardMax: attempt(1000, 1000, St.STEGO_MAX),
      overHardMax: attempt(1000, 1000, St.STEGO_MAX + 1),
    };
  });
  check('a stego payload that fits the frame is embedded',
        stego.atCapacity.ok === true && stego.atHardMax.ok === true,
        `capacity ${stego.cap} at 120×90, ceiling ${stego.hardMax}`);
  check('…one byte too big for the frame is refused, out loud',
        stego.overCapacity.ok === false && stego.overCapacity.toasted === true,
        JSON.stringify(stego.overCapacity));
  check('…and so is one past the hard ceiling',
        stego.overHardMax.ok === false && stego.overHardMax.toasted === true,
        JSON.stringify(stego.overHardMax));
  await hashImg(ZERO);

  // pixel-sort at 100 on a WHITE template (lum 255 >= the span ceiling) — the
  // sweep above pins i-tpl:'terminal' (lum ~185) and so never hit the hang.
  // Pre-fix this spun the main thread forever; any hash coming back at all is
  // the assertion.
  const whiteSort = await hashImg({ ...ZERO, 'i-tpl': 'http404', 'i-pixsort': 100 });
  check('pixel-sort completes on a white template',
        typeof whiteSort === 'string' && whiteSort.length > 0, String(whiteSort));
  await hashImg(ZERO);

  // The Fake Desktop used to pin every icon column to x=28 (a dead
  // expression), so a long list ran off-canvas under the taskbar. It must wrap
  // into a second column: an icon box (#c0c0c0) in column 2's x range
  // (gx=100 → 86..114), above the taskbar at H-28.
  const desktopWraps = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const c = document.createElement('canvas'); c.width = 480; c.height = 360;
    const ctx = c.getContext('2d');
    S.TEMPLATES.desktop.draw(ctx, 480, 360, Object.assign(S.readImageCfg(), {
      body: 'A\nB\nC\nD\nE\nF\nG\nH\nI\nJ\nK\nL' }));
    const d = ctx.getImageData(0, 0, 480, 332).data;
    for (let y = 0; y < 332; y++) for (let x = 86; x < 114; x++) {
      const i = (y * 480 + x) * 4;
      if (d[i] === 0xc0 && d[i + 1] === 0xc0 && d[i + 2] === 0xc0) return true;
    }
    return false;
  });
  check('fake desktop wraps overflow icons into a second column', desktopWraps);

  const tplHashes = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const out = {};
    const sel = document.getElementById('i-tpl');
    for (const id of Object.keys(S.TEMPLATES)) {
      sel.value = id;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      S.renderImage();
      const c = document.getElementById('icanvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let h = 2166136261 >>> 0;
      for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
      out[id] = h.toString(16);
    }
    return out;
  });
  const tplBy = {};
  for (const [id, h] of Object.entries(tplHashes)) (tplBy[h] = tplBy[h] || []).push(id);
  const tplDupes = Object.values(tplBy).filter((g) => g.length > 1);
  check(`all ${Object.keys(tplHashes).length} templates draw distinct output`,
        tplDupes.length === 0, tplDupes.map((g) => g.join('=')).join(' | '));
}

/* ================================================ audio layers do something */
section('audio layers and effects change the sound');
{
  const fingerprint = (overrides) => page.evaluate(async (overrides) => {
    for (const [k, v] of Object.entries(overrides)) {
      const el = document.getElementById(k);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const r = await window.DeadSignalStudio.renderAudio();
    if (!r) return 'null';
    let h = 2166136261 >>> 0;
    const step = Math.max(1, Math.floor(r.data.length / 4000));
    for (let i = 0; i < r.data.length; i += step) {
      const v = Math.round(r.data[i] * 32767) & 0xffff;
      h ^= v; h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16);
  }, overrides);

  const SILENT = { 'a-dur':2, 'a-drone':false, 'a-noise':false, 'a-pulse':false, 'a-morse':false,
                   'a-sub':false, 'a-heart':false, 'a-geiger':false, 'a-dtmf':false, 'a-dial':false,
                   'fx-ring':false, 'fx-trem':false, 'fx-wow':false, 'fx-dist':false,
                   'fx-delay':false, 'fx-reverb':false, 'fx-phone':false, 'fx-crush':false,
                   'fx-limit':false, 'a-loop':false, 'a-autonorm':false, 'a-fade':0 };
  const silence = await fingerprint(SILENT);

  const deadLayers = [];
  for (const k of ['a-drone','a-noise','a-pulse','a-morse','a-sub','a-heart','a-geiger','a-dtmf','a-dial']) {
    const h = await fingerprint({ ...SILENT, [k]: true });
    if (h === silence) deadLayers.push(k);
  }
  check('all 9 audio layers produce sound', deadLayers.length === 0, deadLayers.join(', '));

  // Effects need a source to act on.
  const WITH_DRONE = { ...SILENT, 'a-drone': true };
  const droneOnly = await fingerprint(WITH_DRONE);
  const deadFx = [];
  for (const k of ['fx-ring','fx-trem','fx-wow','fx-dist','fx-delay','fx-reverb','fx-phone','fx-crush','fx-limit']) {
    const h = await fingerprint({ ...WITH_DRONE, [k]: true });
    if (h === droneOnly) deadFx.push(k);
  }
  check('all 9 master FX alter the sound', deadFx.length === 0, deadFx.join(', '));

  const looped = await fingerprint({ ...WITH_DRONE, 'a-loop': true });
  check('loop crossfade alters the render', looped !== droneOnly);
  const faded = await fingerprint({ ...WITH_DRONE, 'a-fade': 0.5 });
  check('fade alters the render', faded !== droneOnly);

  // A looped render must NOT dip to silence at its edges — the crossfade owns
  // the seam, and the edge fade is skipped while Loop xf is on. Pre-fix the
  // default 0.4s fade ran AFTER the crossfade, so every repeat dipped through
  // ~0.8s of silence: the exact artifact loop mode exists to remove.
  const loopLevel = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const set = (id, v) => { const el = document.getElementById(id);
      if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('a-dur', 4); set('a-loop', true); set('a-fade', 0.4);
    const r = await S.renderAudio();
    const d = r.channels[0], n = Math.floor(r.sr * 0.1);
    const rms = (from) => { let s = 0;
      for (let i = 0; i < n; i++) s += d[from + i] * d[from + i];
      return Math.sqrt(s / n); };
    set('a-loop', false); set('a-fade', 0); set('a-dur', 2);
    return { head: +rms(0).toFixed(4), tail: +rms(d.length - n).toFixed(4),
             mid: +rms(Math.floor(d.length / 2)).toFixed(4) };
  });
  check('a looped render holds full level at both edges despite the fade control',
        loopLevel.head > loopLevel.mid * 0.5 && loopLevel.tail > loopLevel.mid * 0.5,
        JSON.stringify(loopLevel));
}

/* ========================================================= audio import ==== */
/* F-09's other half: a real recording had no way into the tool. Generate a WAV
   in the page, import it through the real code path, and prove it reaches the
   render and is shaped by the FX bus. */
section('imported audio');
{
  const r = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const { loadAudioFile, hasImportedAudio, importedAudio, toBuffer, clearImportedAudio } =
      await import('./src/media/audioimport.js');

    // A 1-second 440 Hz tone at 44100, as a real 16-bit WAV file.
    const sr = 44100, n = sr;
    const ab = new ArrayBuffer(44 + n * 2);
    const v = new DataView(ab);
    const ws = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true);
    v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 440 * i / sr) * 20000, true);
    const file = new File([ab], 'test-tone.wav', { type: 'audio/wav' });

    const clip = await loadAudioFile(file);

    // Resampling: the render context may be at a different rate entirely.
    const Ctx = window.OfflineAudioContext;
    const at22 = new Ctx(1, 22050, 22050);
    const buf = toBuffer(at22, 0, false);
    const looped = toBuffer(at22, 3, true);

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!val; else el.value = String(val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const silence = {
      'a-drone': false, 'a-noise': false, 'a-pulse': false, 'a-morse': false, 'a-sub': false,
      'a-heart': false, 'a-geiger': false, 'a-dtmf': false, 'a-dial': false,
      'fx-ring': false, 'fx-trem': false, 'fx-wow': false, 'fx-dist': false, 'fx-delay': false,
      'fx-reverb': false, 'fx-phone': false, 'fx-crush': false, 'fx-limit': false, 'fx-width': false,
      'a-loop': false, 'a-fade': 0, 'a-dur': 2, 'a-autonorm': false, 'a-channels': '2',
      'a-sample': false, 'a-sample-g': 70, 'a-sample-pan': 0, 'a-sample-loop': true,
    };
    for (const [k, val] of Object.entries(silence)) set(k, val);
    const quiet = await S.renderAudio();
    const rms = (d) => { let s2 = 0; for (let i = 0; i < d.length; i++) s2 += d[i] * d[i]; return Math.sqrt(s2 / d.length); };
    const quietRms = rms(quiet.channels[0]);

    set('a-sample', true);
    const withSample = await S.renderAudio();
    const sampleRms = rms(withSample.channels[0]);

    // Through the bus: a telephone filter must audibly change a 440 Hz tone.
    set('fx-phone', true);
    const filtered = await S.renderAudio();
    let diff = 0;
    const A = withSample.channels[0], B = filtered.channels[0];
    for (let i = 0; i < Math.min(A.length, B.length); i++) diff += Math.abs(A[i] - B[i]);
    set('fx-phone', false);

    // Panned hard left.
    set('a-sample-pan', -100);
    const panned = await S.renderAudio();
    const pl = rms(panned.channels[0]), pr = rms(panned.channels[1]);
    set('a-sample-pan', 0);

    // Not looping must extend the render to fit the whole clip.
    set('a-sample-loop', false);
    set('a-dur', 1);
    const natural = await S.renderAudio();

    const out = {
      imported: hasImportedAudio(), name: clip.name,
      srcRate: clip.sampleRate, srcDur: +clip.duration.toFixed(2),
      bufRate: buf.sampleRate, bufLen: buf.length,
      loopedLen: looped.length,
      quietRms, sampleRms, diff, pl, pr,
      naturalDur: +natural.duration.toFixed(2),
    };
    set('a-sample', false);
    clearImportedAudio();
    return out;
  });

  check('an audio file imports', r.imported && r.name === 'test-tone', r.name);
  check('its rate and length are read', r.srcRate === 44100 && Math.abs(r.srcDur - 1) < 0.02,
        `${r.srcRate}Hz ${r.srcDur}s`);
  // An AudioBuffer belongs to its own context; the render may be at any rate.
  check('it resamples into the render context', r.bufRate === 22050 && Math.abs(r.bufLen - 22050) < 50,
        `${r.bufRate}Hz ${r.bufLen} frames`);
  check('looping fills the requested length', r.loopedLen === 3 * 22050, String(r.loopedLen));
  check('the silent baseline really is silent', r.quietRms < 1e-6, r.quietRms.toExponential(1));
  check('enabling the sample produces sound', r.sampleRms > 0.01, r.sampleRms.toFixed(4));
  check('it runs through the master FX bus', r.diff > 1, `Σ|Δ| ${r.diff.toFixed(0)}`);
  check('it can be panned like any other layer', r.pl > r.pr * 3,
        `L ${r.pl.toFixed(3)} vs R ${r.pr.toFixed(3)}`);
  // Importing 1s into a 1s render is fine; the guard matters for long clips.
  check('an unlooped clip is not truncated', r.naturalDur >= 1, `${r.naturalDur}s`);
}

/* =============================================================== stereo ==== */
/* F-06: the OfflineAudioContext was built with one channel, so there was no
   panning, no width and no image at all. Measure the two channels against each
   other — a stereo file whose channels are identical is still mono. */
section('stereo field');
{
  const render = (overrides) => page.evaluate(async (overrides) => {
    const base = {
      'a-drone': false, 'a-noise': false, 'a-pulse': false, 'a-morse': false,
      'a-sub': false, 'a-heart': false, 'a-geiger': false, 'a-dtmf': false, 'a-dial': false,
      'fx-ring': false, 'fx-trem': false, 'fx-wow': false, 'fx-dist': false, 'fx-delay': false,
      'fx-reverb': false, 'fx-phone': false, 'fx-crush': false, 'fx-limit': false, 'fx-width': false,
      'a-loop': false, 'a-fade': 0, 'a-dur': 2, 'a-autonorm': false,
      'a-channels': '2', 'a-drone-spread': 0, 'a-drone-voices': 1,
      'a-drone-pan': 0, 'a-noise-pan': 0, 'a-pulse-pan': 0, 'a-morse-pan': 0,
      'a-sub-pan': 0, 'a-heart-pan': 0, 'a-geiger-pan': 0, 'a-dtmf-pan': 0, 'a-dial-pan': 0,
    };
    for (const [k, v] of Object.entries({ ...base, ...overrides })) {
      const el = document.getElementById(k);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const r = await window.DeadSignalStudio.renderAudio();
    if (!r) return null;
    const rms = (d) => { let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / d.length); };
    // How much the two channels disagree — the side signal, which IS the image.
    let side = 0;
    if (r.channels.length > 1) {
      const [L, R] = r.channels;
      let s = 0;
      for (let i = 0; i < L.length; i++) { const d = (L[i] - R[i]) / 2; s += d * d; }
      side = Math.sqrt(s / L.length);
    }
    return { n: r.channels.length, l: rms(r.channels[0]),
             r: r.channels.length > 1 ? rms(r.channels[1]) : 0, side };
  }, overrides);

  const DRONE = { 'a-drone': true, 'a-drone-g': 60 };

  const centred = await render(DRONE);
  check('audio renders in stereo', centred.n === 2, `${centred.n} channel(s)`);
  // A pan control that is not truly neutral at zero silently tilts every
  // existing project the moment stereo is switched on.
  check('a centred mix is identical in both channels', centred.side < 1e-6,
        `side ${centred.side.toExponential(1)}`);

  const left = await render({ ...DRONE, 'a-drone-pan': -100 });
  check('panning a layer left makes the left channel louder',
        left.l > left.r * 3, `L ${left.l.toFixed(3)} vs R ${left.r.toFixed(3)}`);
  const right = await render({ ...DRONE, 'a-drone-pan': 100 });
  check('…and panning right does the reverse',
        right.r > right.l * 3, `L ${right.l.toFixed(3)} vs R ${right.r.toFixed(3)}`);

  const spread = await render({ ...DRONE, 'a-drone-voices': 5, 'a-drone-det': 20, 'a-drone-spread': 100 });
  check('drone spread puts the voices in different places', spread.side > 1e-4,
        `side ${spread.side.toFixed(4)}`);

  // Width acts on the side signal only, so it needs one to act on.
  const wide = await render({ ...DRONE, 'a-drone-voices': 5, 'a-drone-det': 20,
                              'a-drone-spread': 100, 'fx-width': true, 'fx-width-a': 200 });
  check('width above 100 widens the image', wide.side > spread.side * 1.5,
        `${spread.side.toFixed(4)} → ${wide.side.toFixed(4)}`);
  const narrow = await render({ ...DRONE, 'a-drone-voices': 5, 'a-drone-det': 20,
                                'a-drone-spread': 100, 'fx-width': true, 'fx-width-a': 0 });
  check('width 0 collapses to mono', narrow.side < 1e-6, `side ${narrow.side.toExponential(1)}`);

  const mono = await render({ ...DRONE, 'a-drone-pan': -100, 'a-channels': '1' });
  check('mono renders one channel', mono.n === 1, `${mono.n} channel(s)`);
  check('a pan cannot leak into a mono render', mono.l > 0, `rms ${mono.l.toFixed(3)}`);

  // The file has to say what it is, or a player will read it as mono at double
  // speed — the classic symptom of an unchanged channel count in the header.
  const hdr = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const { encodeWav } = await import('./src/audio/wav.js');
    const read = async (blob) => {
      const v = new DataView(await blob.arrayBuffer());
      return { channels: v.getUint16(22, true), sr: v.getUint32(24, true),
               byteRate: v.getUint32(28, true), blockAlign: v.getUint16(32, true),
               bits: v.getUint16(34, true), size: blob.size };
    };
    const L = new Float32Array(1000).fill(0.5), R = new Float32Array(1000).fill(-0.5);
    const st = await read(encodeWav([L, R], 22050, 16));
    const mo = await read(encodeWav(L, 22050, 16));
    // Interleaving check: frame 0 must be L then R, not L then L.
    const raw = new DataView(await encodeWav([L, R], 22050, 16).arrayBuffer());
    return { st, mo, s0: raw.getInt16(44, true), s1: raw.getInt16(46, true) };
  });
  check('a stereo WAV declares two channels', hdr.st.channels === 2, String(hdr.st.channels));
  check('block align and byte rate match the channel count',
        hdr.st.blockAlign === 4 && hdr.st.byteRate === 22050 * 4,
        `${hdr.st.blockAlign} / ${hdr.st.byteRate}`);
  check('a mono WAV still declares one channel', hdr.mo.channels === 1, String(hdr.mo.channels));
  check('stereo is twice the size of mono', hdr.st.size === hdr.mo.size * 2 - 44,
        `${hdr.mo.size} → ${hdr.st.size}`);
  check('samples are interleaved L,R rather than blocked',
        hdr.s0 > 0 && hdr.s1 < 0, `${hdr.s0}, ${hdr.s1}`);

  // Normalising per channel would drag a panned sound back towards the middle.
  const norm = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    // The previous case rendered in mono, so put the tab back into stereo.
    for (const [id, v] of [['a-channels', '2'], ['a-drone-pan', '-60']]) {
      const el = document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const r = await S.renderAudio();
    const rms = (d) => { let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / d.length); };
    const before = rms(r.channels[0]) / Math.max(1e-9, rms(r.channels[1]));
    const g = 0.97 / Math.max(...r.channels.map((c) => Math.max(...Array.from(c.slice(0, 5000), Math.abs))));
    for (const d of r.channels) for (let i = 0; i < d.length; i++) d[i] *= g;
    const after = rms(r.channels[0]) / Math.max(1e-9, rms(r.channels[1]));
    return { before, after };
  });
  check('normalising keeps the stereo image where it was',
        Math.abs(norm.before - norm.after) < 1e-6,
        `${norm.before.toFixed(3)} → ${norm.after.toFixed(3)}`);
}

/* ============================================================== presets ==== */
section('presets');
{
  const r = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const out = { applied: 0, inert: [], total: 0 };
    for (const [tab, selId, view] of [['video','v-preset','tabs.video'],
                                      ['audio','a-preset','tabs.audio'],
                                      ['image','i-preset','tabs.image']]) {
      const sel = document.getElementById(selId);
      if (!sel) continue;
      for (const opt of [...sel.options]) {
        if (/custom/i.test(opt.value) || !opt.value) continue;
        out.total++;
        // Compare the tab's settings WITHOUT the preset select itself. Including
        // it made this pass for the wrong reason: choosing a preset always
        // changes v-preset, so the check stayed green for months while
        // applyRecipe wrote .value straight onto the controls and the document
        // — the thing actually rendered — never moved at all.
        const settings = () => { const o = { ...(S.store.get(view) || {}) }; delete o[selId]; return JSON.stringify(o); };
        const before = settings();
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 15));
        const after = settings();
        if (after === before) out.inert.push(`${tab}:${opt.value}`); else out.applied++;
      }
    }
    return out;
  });
  // The first preset applied in each tab may coincide with the current state;
  // what matters is that essentially all of them do something.
  check(`presets apply (${r.applied}/${r.total})`, r.inert.length <= 3,
        r.inert.join(', '));
}

/* ============================================================== exports ==== */
section('exports produce real files');
{
  // Capture every Blob handed to createObjectURL / download instead of writing
  // to disk, and inspect the bytes.
  await page.evaluate(() => {
    window.__blobs = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (b) { try { window.__blobs.push(b); } catch {} return orig.call(URL, b); };
    HTMLAnchorElement.prototype.click = function () { /* suppress the download */ };
  });

  const magic = (arr, sig) => sig.every((b, i) => arr[i] === b);

  // PNG
  const png = await page.evaluate(async () => {
    window.__blobs.length = 0;
    document.getElementById('i-dl').click();
    await new Promise((r) => setTimeout(r, 500));
    const b = window.__blobs.at(-1);
    if (!b) return null;
    return { size: b.size, head: [...new Uint8Array(await b.slice(0, 8).arrayBuffer())] };
  });
  check('PNG export produces a valid file',
        png && png.size > 500 && magic(png.head, [0x89, 0x50, 0x4E, 0x47]),
        png ? `${png.size} bytes` : '(none)');

  // JPEG
  const jpg = await page.evaluate(async () => {
    window.__blobs.length = 0;
    document.getElementById('i-jpg').click();
    await new Promise((r) => setTimeout(r, 500));
    const b = window.__blobs.at(-1);
    if (!b) return null;
    return { size: b.size, head: [...new Uint8Array(await b.slice(0, 3).arrayBuffer())] };
  });
  check('JPEG export produces a valid file',
        jpg && jpg.size > 500 && magic(jpg.head, [0xFF, 0xD8, 0xFF]),
        jpg ? `${jpg.size} bytes` : '(none)');

  // WAV via the audio tab
  const wav = await page.evaluate(async () => {
    document.querySelector('.tab[data-view="audio"]').click();
    const dur = document.getElementById('a-dur');
    dur.value = '1'; dur.dispatchEvent(new Event('input', { bubbles: true }));
    const drone = document.getElementById('a-drone');
    drone.checked = true; drone.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('a-render').click();
    for (let i = 0; i < 100 && !/Rendered/.test(document.getElementById('a-status').textContent); i++)
      await new Promise((r) => setTimeout(r, 100));
    window.__blobs.length = 0;
    document.getElementById('a-dl').click();
    await new Promise((r) => setTimeout(r, 400));
    const b = window.__blobs.at(-1);
    if (!b) return null;
    const head = [...new Uint8Array(await b.slice(0, 12).arrayBuffer())];
    return { size: b.size, riff: String.fromCharCode(...head.slice(0, 4)),
             wave: String.fromCharCode(...head.slice(8, 12)) };
  });
  check('WAV export produces a valid file',
        wav && wav.size > 1000 && wav.riff === 'RIFF' && wav.wave === 'WAVE',
        wav ? `${wav.size} bytes ${wav.riff}/${wav.wave}` : '(none)');

  // WebM recording — the headline export. Short, but real.
  const webm = await page.evaluate(async () => {
    document.querySelector('.tab[data-view="video"]').click();
    for (const [id, v] of [['v-dur', '1'], ['v-w', '160'], ['v-h', '120'], ['v-fps', '10']]) {
      const el = document.getElementById(id);
      el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 100));
    const before = window.DeadSignalStudio.library.length;
    document.getElementById('v-record').click();
    for (let i = 0; i < 120 && window.DeadSignalStudio.library.length === before; i++)
      await new Promise((r) => setTimeout(r, 100));
    const item = window.DeadSignalStudio.library.at(-1);
    if (!item || !item.blob) return null;
    const head = [...new Uint8Array(await item.blob.slice(0, 4).arrayBuffer())];
    return { size: item.blob.size, head, ext: item.ext, kind: item.kind };
  });
  check('video recording produces a valid WebM',
        webm && webm.size > 1000 && magic(webm.head, [0x1A, 0x45, 0xDF, 0xA3]),
        webm ? `${webm.size} bytes .${webm.ext}` : '(none)');
  check('the recording lands in the library as a video',
        webm && webm.kind === 'videos' && webm.ext === 'webm', webm ? `${webm.kind}/${webm.ext}` : '');

  // Animated GIF
  const gif = await page.evaluate(async () => {
    window.__blobs.length = 0;
    const btn = document.getElementById('v-gif');
    if (!btn) return { missing: true };
    btn.click();
    for (let i = 0; i < 150 && !window.__blobs.length; i++) await new Promise((r) => setTimeout(r, 100));
    const b = window.__blobs.at(-1);
    if (!b) return null;
    return { size: b.size, head: String.fromCharCode(...new Uint8Array(await b.slice(0, 6).arrayBuffer())) };
  });
  check('GIF export produces a valid file',
        gif && !gif.missing && gif.size > 200 && /^GIF8[79]a$/.test(gif.head),
        gif ? `${gif.size} bytes ${gif.head}` : '(none)');

  // Offline export: the whole point is that it beats real time and is
  // frame-exact. Measure it rather than trusting it.
  const fast = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const { encoderSupport } = await import('./src/export/encoder.js');
    const sup = await encoderSupport(240, 180);
    if (!sup.available) return { skipped: sup.reason };
    for (const [id, v] of [['v-dur', '4'], ['v-w', '240'], ['v-h', '180'], ['v-fps', '15'],
                           ['v-scene', 'terminal']]) {
      const el = document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 120));
    const before = S.library.length;
    const t0 = performance.now();
    document.getElementById('v-record').click();
    for (let i = 0; i < 300 && S.library.length === before; i++) await new Promise((r) => setTimeout(r, 50));
    const wall = performance.now() - t0;
    const item = S.library.at(-1);
    if (!item?.blob) return { failed: true };

    // Prove the container is real by playing it back.
    const url = URL.createObjectURL(item.blob);
    const v = document.createElement('video'); v.muted = true; v.src = url;
    const meta = await new Promise((ok) => {
      v.onloadedmetadata = () => ok({ w: v.videoWidth, h: v.videoHeight, dur: v.duration });
      v.onerror = () => ok({ error: 'load failed' });
      setTimeout(() => ok({ error: 'timeout' }), 8000);
    });
    URL.revokeObjectURL(url);
    return { wall: Math.round(wall), realtime: 4000, size: item.blob.size, meta, codec: sup.label };
  });
  if (fast.skipped) {
    check('offline export (skipped: ' + fast.skipped + ')', true);
  } else {
    check('offline export beats real time', fast.wall < 4000 * 0.6,
          `${fast.wall}ms vs ${fast.realtime}ms real time`);
    check('the exported WebM plays back',
          fast.meta && !fast.meta.error && fast.meta.w === 240 && fast.meta.h === 180,
          JSON.stringify(fast.meta));
    check('the exported duration is correct',
          fast.meta && Math.abs(fast.meta.dur - 4) < 0.35, `${fast.meta?.dur}s`);
  }

  // A sequence is the longest thing the studio exports, so the offline path
  // matters most here. Two clips also prove the composite (and its transition)
  // survives being driven frame-by-frame instead of by wall clock.
  const seq = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const { encoderSupport } = await import('./src/export/encoder.js');
    const sup = await encoderSupport(200, 150);
    if (!sup.available) return { skipped: sup.reason };

    const set = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.querySelector('.tab[data-view="video"]').click();
    set('v-dur', '3'); set('v-scene', 'terminal');
    await new Promise((r) => setTimeout(r, 120));
    S.addTimelineClip();
    set('v-scene', 'matrix');
    await new Promise((r) => setTimeout(r, 120));
    S.addTimelineClip();

    document.querySelector('.tab[data-view="timeline"]').click();
    set('tl-w', '200'); set('tl-h', '150'); set('tl-fps', '12');
    set('tl-xtype', 'crossfade'); set('tl-xdur', '0.6');
    await new Promise((r) => setTimeout(r, 120));
    const total = S.buildSchedule().total;

    const before = S.library.length;
    const t0 = performance.now();
    document.getElementById('tl-record').click();
    for (let i = 0; i < 400 && S.library.length === before; i++) await new Promise((r) => setTimeout(r, 50));
    const wall = performance.now() - t0;
    const item = S.library.at(-1);
    if (!item?.blob) return { failed: true, total };

    const url = URL.createObjectURL(item.blob);
    const v = document.createElement('video'); v.muted = true; v.src = url;
    const meta = await new Promise((ok) => {
      v.onloadedmetadata = () => ok({ w: v.videoWidth, h: v.videoHeight, dur: v.duration });
      v.onerror = () => ok({ error: 'load failed' });
      setTimeout(() => ok({ error: 'timeout' }), 8000);
    });
    URL.revokeObjectURL(url);
    return { wall: Math.round(wall), total, clips: 2, meta, size: item.blob.size };
  });
  if (seq.skipped) {
    check('offline sequence export (skipped: ' + seq.skipped + ')', true);
  } else {
    check('a 2-clip sequence exports faster than real time',
          !seq.failed && seq.wall < seq.total * 1000 * 0.6,
          `${seq.wall}ms vs ${Math.round(seq.total * 1000)}ms real time`);
    check('the exported sequence plays back at the timeline size',
          seq.meta && !seq.meta.error && seq.meta.w === 200 && seq.meta.h === 150,
          JSON.stringify(seq.meta));
    check('the sequence keeps the schedule duration (transition included)',
          seq.meta && Math.abs(seq.meta.dur - seq.total) < 0.35,
          `${seq.meta?.dur}s vs ${seq.total?.toFixed(1)}s scheduled`);
  }

  // Campaign bundle .zip
  const zip = await page.evaluate(async () => {
    window.__blobs.length = 0;
    document.querySelector('.tab[data-view="bundle"]').click();
    await window.DeadSignalStudio.exportCampaignBundle();
    const b = window.__blobs.at(-1);
    if (!b) return null;
    const head = [...new Uint8Array(await b.slice(0, 4).arrayBuffer())];
    return { size: b.size, head };
  });
  check('campaign bundle .zip is produced',
        zip && zip.size > 500 && magic(zip.head, [0x50, 0x4B, 0x03, 0x04]),
        zip ? `${zip.size} bytes` : '(none)');
}

/* ========================================================== keyframes ====== */
/* F-08: every parameter was a single constant for the whole clip. The point of
   a track is that the picture CHANGES over time and that scrub, preview and
   export agree about what each frame looks like — measure both. */
section('keyframes');
{
  const r = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const { cfgAt } = await import('./src/video/automation.js');
    const { set: setPathCmd } = await import('./src/doc/store.js');
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.querySelector('.tab[data-view="video"]').click();
    for (const [id, v] of [['v-scene', 'terminal'], ['v-dur', '10'], ['v-w', '160'],
                           ['v-h', '120'], ['v-fps', '10'], ['v-scan', '0'], ['v-noise', '0'],
                           // Phosphor persistence accumulates into a shared buffer, so
                           // frame N depends on frame N-1 *by design*. Any check that
                           // renders the same t twice has to switch it off, or it is
                           // measuring the ghost of the previous render. (It only used
                           // to pass because presets silently failed to apply, leaving
                           // persistence at the markup default of 0.)
                           ['v-persist', '0']]) set(id, v);
    await new Promise((r) => setTimeout(r, 120));

    // Key scanlines from nothing to full across the clip.
    S.store.apply(setPathCmd('automation.video.v-scan',
      [{ t: 0, v: 0, e: 'linear' }, { t: 10, v: 100, e: 'linear' }]));
    S.refreshKeyframes();
    await new Promise((r) => setTimeout(r, 60));

    const cfg = S.readVideoCfg();
    const at = (t) => cfgAt(cfg, t).scan;
    const curve = [at(0), at(2.5), at(5), at(7.5), at(10)];

    // The control itself must be untouched — it is the base value, and the
    // track overrides it only at render time.
    const controlStill = document.getElementById('v-scan').value;
    const marked = document.getElementById('v-scan').classList.contains('automated');

    // Pixels, not just numbers: render two frames and compare.
    const draw = (t) => {
      const c = document.createElement('canvas');
      c.width = 160; c.height = 120;
      S.renderVideoFrame(c.getContext('2d'), 160, 120, cfg, t);
      return c.getContext('2d').getImageData(0, 0, 160, 120).data;
    };
    const diff = (a, b) => {
      let d = 0;
      for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]);
      return d;
    };
    const early = draw(0.5), late = draw(9.5);
    const changed = diff(early, late);

    // Determinism: the same t must render identically however it is reached.
    const again = draw(9.5);
    const stable = diff(late, again);

    // A track has to survive a save/load round trip or a clip cannot be reopened.
    const proj = JSON.parse(JSON.stringify(S.readProject()));
    S.store.apply(setPathCmd('automation.video.v-scan', []));
    const wiped = S.readVideoCfg();
    const afterWipe = cfgAt(wiped, 10).scan;
    S.applyProject(proj);
    await new Promise((r) => setTimeout(r, 120));
    const reloaded = cfgAt(S.readVideoCfg(), 10).scan;

    // And a clip added to the timeline must carry its curve.
    S.addTimelineClip();
    const clip = S.timeline.at(-1);
    const clipCfg = S.readVideoCfg(clip.rec);
    const clipCurve = [cfgAt(clipCfg, 0).scan, cfgAt(clipCfg, 10).scan];

    return { curve, controlStill, marked, changed, stable, afterWipe, reloaded, clipCurve };
  });

  check('a keyframed parameter ramps across the clip',
        r.curve[0] === 0 && Math.abs(r.curve[2] - 0.5) < 0.01 && Math.abs(r.curve[4] - 1) < 0.01,
        r.curve.map((n) => n.toFixed(2)).join(' → '));
  check('the control keeps its own value — the track overrides at render time',
        r.controlStill === '0', r.controlStill);
  check('an automated control is marked as such', r.marked);
  check('the rendered picture actually changes over the clip', r.changed > 5000,
        `${r.changed} luminance delta`);
  check('the same frame renders identically twice (determinism holds)', r.stable === 0,
        `${r.stable} delta`);
  check('clearing the track returns the parameter to its control value',
        r.afterWipe === 0, String(r.afterWipe));
  check('a track survives save and reload', Math.abs(r.reloaded - 1) < 0.01, String(r.reloaded));
  check('a timeline clip carries the curve it was captured with',
        r.clipCurve[0] === 0 && Math.abs(r.clipCurve[1] - 1) < 0.01,
        r.clipCurve.map((n) => n.toFixed(2)).join(' → '));
}

/* ============================================================= layers ====== */
/* The trap this feature exists to avoid: 15 of the 22 scenes fill their own
   background, so a layer drawn naively erases the base instead of stacking on
   it. Prove the base is still THERE underneath, not just that pixels changed. */
section('layers');
{
  const r = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const { set: setPathCmd } = await import('./src/doc/store.js');
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.querySelector('.tab[data-view="video"]').click();
    for (const [id, v] of [['v-scene', 'terminal'], ['v-text', 'BASE LAYER MARKER'],
                           ['v-dur', '10'], ['v-w', '160'], ['v-h', '120'],
                           ['v-scan', '0'], ['v-noise', '0'], ['v-glitch', '0'],
                           // Off for the same reason as the keyframe section: these
                           // checks compare repeated renders of the same frame.
                           ['v-persist', '0'],
                           ['v-flick', '0'], ['v-cps', '120']]) set(id, v);
    S.store.apply(setPathCmd('automation.video.v-scan', []));
    S.store.apply(setPathCmd('layers.video', []));
    await new Promise((r) => setTimeout(r, 120));

    const shot = () => {
      const cfg = Object.assign(S.readVideoCfg(), { W: 160, H: 120 });
      const c = document.createElement('canvas'); c.width = 160; c.height = 120;
      S.renderVideoFrame(c.getContext('2d'), 160, 120, cfg, 5);
      return c.getContext('2d').getImageData(0, 0, 160, 120).data;
    };
    // How much light there is, and where. Two different scenes will not agree
    // on both.
    const lit = (d) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 40) n++; return n; };
    const same = (a, b) => { for (let i = 0; i < a.length; i += 4) if (a[i + 1] !== b[i + 1]) return false; return true; };
    // Does `a` keep every lit pixel `base` had? Additive compositing must not
    // take light away.
    const keepsBase = (base, a) => {
      let kept = 0, total = 0;
      for (let i = 0; i < base.length; i += 4) {
        if (base[i + 1] > 40) { total++; if (a[i + 1] > 40) kept++; }
      }
      return total ? kept / total : 1;
    };

    const base = shot();
    const baseLit = lit(base);

    S.store.apply(setPathCmd('layers.video',
      [{ scene: 'matrix', opacity: 1, blend: 'screen', enabled: true }]));
    S.renderLayers();
    const stacked = shot();

    S.store.apply(setPathCmd('layers.video',
      [{ scene: 'matrix', opacity: 1, blend: 'screen', enabled: false }]));
    const disabled = shot();

    S.store.apply(setPathCmd('layers.video',
      [{ scene: 'matrix', opacity: 0, blend: 'screen', enabled: true }]));
    const transparent = shot();

    // Order matters: difference is not commutative, so swapping the stack must
    // change the picture.
    S.store.apply(setPathCmd('layers.video', [
      { scene: 'matrix', opacity: 1, blend: 'difference', enabled: true },
      { scene: 'snow', opacity: 0.6, blend: 'difference', enabled: true },
    ]));
    const orderA = shot();
    S.store.apply(setPathCmd('layers.video', [
      { scene: 'snow', opacity: 0.6, blend: 'difference', enabled: true },
      { scene: 'matrix', opacity: 1, blend: 'difference', enabled: true },
    ]));
    const orderB = shot();

    // Captured into a timeline clip.
    S.store.apply(setPathCmd('layers.video',
      [{ scene: 'matrix', opacity: 1, blend: 'screen', enabled: true }]));
    S.addTimelineClip();
    const clip = S.timeline.at(-1);
    const clipLayers = S.readVideoCfg(clip.rec).__layers;

    // Save/reload.
    const proj = JSON.parse(JSON.stringify(S.readProject()));
    S.store.apply(setPathCmd('layers.video', []));
    S.applyProject(proj);
    await new Promise((r) => setTimeout(r, 120));
    const reloaded = (S.store.get('layers.video') || []).length;

    S.store.apply(setPathCmd('layers.video', []));
    S.renderLayers();

    return {
      baseLit, stackedLit: lit(stacked),
      changed: !same(base, stacked),
      baseKept: keepsBase(base, stacked),
      disabledMatchesBase: same(base, disabled),
      transparentMatchesBase: same(base, transparent),
      orderMatters: !same(orderA, orderB),
      clipLayers: clipLayers ? clipLayers.length : 0,
      clipScene: clipLayers?.[0]?.scene || null,
      reloaded,
    };
  });

  check('the base scene renders something to stack on', r.baseLit > 200, `${r.baseLit} lit px`);
  check('a layer changes the picture', r.changed);
  check('a layer adds light rather than replacing the frame',
        r.stackedLit > r.baseLit, `${r.baseLit} → ${r.stackedLit} lit px`);
  // This is the one that would have caught the naive implementation.
  check('the base scene survives underneath the layer',
        r.baseKept > 0.98, `${(r.baseKept * 100).toFixed(1)}% of base pixels kept`);
  check('a disabled layer draws nothing at all', r.disabledMatchesBase);
  check('a zero-opacity layer draws nothing at all', r.transparentMatchesBase);
  check('stack order changes the composite', r.orderMatters);
  check('a timeline clip captures its layer stack',
        r.clipLayers === 1 && r.clipScene === 'matrix', `${r.clipLayers} layer(s), ${r.clipScene}`);
  check('a layer stack survives save and reload', r.reloaded === 1, String(r.reloaded));
}

/* ================================================= campaign file merge ===== */
/* The whole point is that installing the bundle over a campaign that already
   has media does not delete any of it. Uses full-size campaign files in the
   campaign's own formats — a two-entry toy would not catch a format assumption.

   These used to be read from the EREBUS repository through '../../assets/…'.
   The studio is a folder you copy anywhere, so that path was wrong everywhere
   except one checkout, and readFileSync THREW rather than failing a check —
   taking every section below this one with it. The fixtures are pinned in
   tests/fixtures/campaign/ instead: a merge test whose input can change under
   it is a test that fails for reasons that have nothing to do with merging. */
section('campaign merge (campaign-format files)');
{
  const FIX = join(HERE, 'tests', 'fixtures', 'campaign');
  const real = {
    manifest: readFileSync(join(FIX, 'media-manifest.json'), 'utf8'),
    videos: readFileSync(join(FIX, 'videos/index.json'), 'utf8'),
    music: readFileSync(join(FIX, 'music/index.json'), 'utf8'),
    autoexec: readFileSync(join(FIX, 'autoexec.retro'), 'utf8'),
  };

  const r = await page.evaluate(async (real) => {
    const S = window.DeadSignalStudio;
    const { parseIndex, parseManifest, releasedFiles } = await import('./src/library/merge.js');
    const { setExistingPart, setReleasedFrom, clearExisting } = await import('./src/campaign/existing.js');

    const before = S.genWiring();

    const man = parseManifest(real.manifest);
    setExistingPart('manifest', man);
    setExistingPart('videosIndex', parseIndex(real.videos));
    setExistingPart('musicIndex', parseIndex(real.music));
    setReleasedFrom(real.autoexec);

    const after = S.genWiring();
    const merged = JSON.parse(after.manifest);
    const vIdx = JSON.parse(after.idxVideos);

    // Every filename the campaign shipped must still be present.
    const shipped = [...man.music, ...man.videos].map((e) => e.src.split('/').pop());
    const kept = shipped.filter((f) =>
      [...merged.music, ...merged.videos].some((e) => e.src.endsWith('/' + f)));

    const out = {
      wasMerged: after.merged,
      beforeCount: JSON.parse(before.manifest).music.length + JSON.parse(before.manifest).videos.length,
      shipped: shipped.length,
      kept: kept.length,
      afterCount: merged.music.length + merged.videos.length,
      vIdxCount: vIdx.length,
      stats: after.stats,
      releasedFound: releasedFiles(real.autoexec).size,
      // Emitted files must be valid JSON in the campaign's own shape.
      manifestShape: Array.isArray(merged.music) && Array.isArray(merged.videos),
      release: after.release,
    };
    clearExisting();
    return out;
  }, real);

  check('the campaign\'s files are recognised as a merge target', r.wasMerged);
  check('release lines are read out of a real autoexec.retro', r.releasedFound >= 5,
        `${r.releasedFound} found`);
  // The fixture deliberately comments two releases out, with both comment
  // syntaxes. Counting a commented release would make the studio skip the very
  // line the author still needs, and the clip would never reach the campaign.
  check('a commented-out release is not counted as released', r.releasedFound === 10,
        `${r.releasedFound} found, expected 10`);
  check('every shipped asset survives the merge', r.kept === r.shipped,
        `${r.kept}/${r.shipped} kept`);
  check('the merged manifest keeps the campaign\'s shape', r.manifestShape);
  check('the merged manifest is bigger than either input alone',
        r.afterCount >= r.shipped && r.afterCount > r.beforeCount,
        `${r.beforeCount} generated + ${r.shipped} shipped → ${r.afterCount}`);
  check('the merged videos index also grew', r.vIdxCount > 0, String(r.vIdxCount));
  check('the report accounts for every entry',
        r.stats.added + r.stats.replaced + r.stats.kept === r.afterCount,
        JSON.stringify(r.stats));
  // Clips the campaign already releases must not be emitted again.
  check('release lines already in the script are not re-emitted',
        !/erebus_signal_loop|webb_last_session/.test(r.release),
        r.release.slice(0, 60));
}

/* ==================================================== campaign target ====== */
/* F-11: the beats, the collision list and the bundle naming were EREBUS-only,
   so the tool wired exactly one campaign. Prove a second one works end to end
   rather than merely that the controls exist. */
section('campaign target');
{
  const r = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const beatOptions = () => [...document.querySelectorAll('#lib-body select[data-k="beat"]')]
      .map((s) => [...s.options].map((o) => o.value));

    document.querySelector('.tab[data-view="bundle"]').click();
    const erebusBeats = [...document.querySelectorAll('#b-coverage .pill')].map((p) => p.textContent);

    // Retarget at a campaign with entirely different beats.
    set('b-profile', 'blank');
    set('b-cname', 'Night Shift');
    set('b-beats', 'boot\nact1:arrival\nact2:the_call\n  \nact2:the_call\nbad beat!');
    await new Promise((r) => setTimeout(r, 60));

    const coverage = [...document.querySelectorAll('#b-coverage .pill')].map((p) => p.textContent);
    const dropdowns = beatOptions();

    // An asset still on an EREBUS beat is now unreachable — that must be an error.
    const assets = S.library.filter((it) => it.kind === 'videos' || it.kind === 'music');
    let flaggedStale = null, cleanAfterFix = null;
    if (assets.length) {
      assets.forEach((it) => { it.gated = true; it.beat = 'unlockPhase5'; });
      S.showValidation();
      flaggedStale = document.getElementById('b-report').textContent;
      // Every stale asset has to be moved: one unreachable clip is still a
      // broken bundle, so validation only clears when they all resolve.
      assets.forEach((it) => { it.beat = 'act1:arrival'; });
      S.showValidation();
      cleanAfterFix = document.getElementById('b-report').textContent;
    }

    // The bundle itself should be named for the new target. The suite already
    // suppresses anchor clicks, so record the filename off the anchor instead.
    window.__blobs.length = 0;
    let zipName = null;
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { zipName = this.download || zipName; };
    await S.exportCampaignBundle();
    HTMLAnchorElement.prototype.click = origClick;
    const zipBlob = window.__blobs.at(-1);

    // Retarget back and confirm the author overrides do not follow.
    set('b-profile', 'erebus');
    await new Promise((r) => setTimeout(r, 60));
    const backToErebus = [...document.querySelectorAll('#b-coverage .pill')].map((p) => p.textContent);

    return { erebusBeats, coverage, dropdowns, flaggedStale, cleanAfterFix, zipName, backToErebus,
             zipSize: zipBlob ? zipBlob.size : 0,
             projectHasTarget: S.store.get('tabs.bundle.b-beats') !== undefined };
  });

  check('the default target is the campaign in this repo',
        r.erebusBeats.includes('unlockPhase5') && r.erebusBeats.includes('erebus:sable:first'),
        r.erebusBeats.join(', '));
  check('a second campaign supplies its own beats',
        JSON.stringify(r.coverage) === JSON.stringify(['boot', 'act1:arrival', 'act2:the_call']),
        r.coverage.join(', '));
  check('duplicate and unsafe beat names are dropped',
        !r.coverage.includes('bad beat!') && r.coverage.length === 3);
  check('the per-asset beat dropdowns follow the target',
        r.dropdowns.length === 0 || r.dropdowns.every((o) => JSON.stringify(o) === JSON.stringify(r.coverage)),
        JSON.stringify(r.dropdowns[0] || []));
  check('an asset left on a beat the target lacks is an error',
        r.flaggedStale === null || /is not a beat of Night Shift/.test(r.flaggedStale),
        String(r.flaggedStale).slice(0, 80));
  check('…and clears once the beat is valid',
        r.cleanAfterFix === null || /Bundle valid/.test(r.cleanAfterFix),
        String(r.cleanAfterFix).slice(0, 60));
  check('the .zip is named for the target campaign',
        r.zipName === 'night-shift-media-bundle.zip', String(r.zipName));
  check('…and it is a real archive', r.zipSize > 500, `${r.zipSize} bytes`);
  check('the campaign target is part of the project', r.projectHasTarget);
  check('switching profile drops the previous campaign’s beats',
        r.backToErebus.includes('unlockPhase5') && !r.backToErebus.includes('act1:arrival'),
        r.backToErebus.join(', '));
}

/* ============================================================= project ===== */
section('project lifecycle');
{
  const r = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const proj = S.readProject();
    const json = JSON.stringify(proj);
    const reparsed = JSON.parse(json);
    S.applyProject(reparsed);
    return { size: json.length, ok: S.store.get('tabs.video.v-w') !== undefined,
             hasLibrary: Array.isArray(proj.library), version: proj.schemaVersion };
  });
  check('a project serialises and reloads', r.ok && r.size > 200, `${r.size} bytes`);
  check('the project carries a schema version', r.version >= 1, String(r.version));
}

/* ======================================== the document is the single truth == */
/* Every one of these was a control that MOVED and changed nothing, because it
   was written with `.value =` instead of setVal(). The widget agreeing with the
   document is the only thing that tells them apart, so each is asserted against
   the document and the rendered cfg rather than against the widget. */
section('controls reach the document');
{
  const r = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.applyProject(S.readProject());               // settle
    document.querySelector('.tab[data-view=video]').click();
    const before = { doc: String(S.store.get('tabs.video.v-scan')), cfg: S.readVideoCfg().scan };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
    const after = { doc: String(S.store.get('tabs.video.v-scan')), cfg: S.readVideoCfg().scan };
    // A later, unrelated edit re-renders the document into the DOM: if
    // randomize never reached the document, this is where the slider snapped
    // back to its old value.
    const el = document.getElementById('v-noise');
    el.value = '33'; el.dispatchEvent(new Event('input', { bubbles: true }));
    return { before, after, domAfter: document.getElementById('v-scan').value,
             playhead: S.store.get('tabs.video.v-scrub') };
  });
  check('randomize reaches the document, not just the widget',
        r.before.doc !== r.after.doc && r.before.cfg !== r.after.cfg,
        `${r.before.doc} -> ${r.after.doc}`);
  check('…and it survives the next unrelated edit', r.domAfter === r.after.doc,
        `${r.domAfter} vs ${r.after.doc}`);
  check('the playhead is not document state', r.playhead === undefined, String(r.playhead));

  const a = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const sel = document.getElementById('aesthetic');
    sel.value = 'vaporwave'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const shown = document.getElementById('v-palette').value;
    const doc = S.store.get('tabs.video.v-palette');
    const el = document.getElementById('v-vig');
    el.value = '41'; el.dispatchEvent(new Event('input', { bubbles: true }));
    const stuck = document.getElementById('v-palette').value;
    sel.value = 'cyberpunk'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { shown, doc, stuck, cyberPalette: document.getElementById('v-palette').value,
             cyberBg: S.store.get('tabs.video.v-bg'), cyberFg: S.store.get('tabs.video.v-fg') };
  });
  check('an aesthetic sets the palette picker for real', a.shown === 'Vapor Pink' && a.doc === 'Vapor Pink',
        `${a.shown} / ${a.doc}`);
  check('…and it does not revert on the next edit', a.stuck === 'Vapor Pink', a.stuck);
  check('the named palette is the one actually applied',
        a.cyberPalette === 'Neon Cyan' && a.cyberBg === '#00060f' && a.cyberFg === '#00f0ff',
        `${a.cyberPalette} -> ${a.cyberBg}/${a.cyberFg}`);
}

/* ================================================================ presets == */
section('presets are a whole look');
{
  const r = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
    set('v-preset', 'Webb — Last Session');
    const webb = { reveal: S.store.get('tabs.video.v-reveal'), tc: S.store.get('tabs.video.v-tcstart') };
    set('v-preset', 'Signal Loss');
    return { webb, afterSwitch: { reveal: S.store.get('tabs.video.v-reveal'), tc: S.store.get('tabs.video.v-tcstart') },
             scene: S.store.get('tabs.video.v-scene'), stillNamed: document.getElementById('v-preset').value };
  });
  check('a preset applies the settings it names', r.scene === 'snow', r.scene);
  check('…and clears the previous preset\'s leftovers',
        r.webb.reveal === 'OBSERVE' && r.afterSwitch.reveal === '',
        `reveal "${r.webb.reveal}" -> "${r.afterSwitch.reveal}"`);
  check('…without blanking the picker that named it', r.stillNamed === 'Signal Loss', r.stillNamed);
}

/* ============================== presets ignore panel-local controls ======= */
/* Chain steps build their inputs at runtime with positional ids
   (v-filters-step-0-amount…) and write structured document paths straight
   through the store — panel-local, never in the bind index. Capturing them
   baked transient step values into presets, and loading such a preset replayed
   the stale value onto whatever filter occupies that slot NOW (many filters
   share param keys: amount, mix, radius…), silently corrupting the chain. */
section('a preset never captures chain-step inputs');
{
  const r = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const R = await import('./src/core/recipes.js');
    document.querySelector('.tab[data-view=video]').click();
    S.clearFilters(); S.addFilter('invert');           // has an 'amount' param
    await new Promise((res) => setTimeout(res, 50));
    const rec = R.readRecipe('view-video');
    const junk = Object.keys(rec).filter((k) => /-step-\d+-/.test(k));
    const arec = R.readRecipe('view-audio');
    // The generated audio-layer controls are indexed at boot and MUST stay in.
    const layerKept = 'a-vinyl-g' in arec;
    // An old polluted preset: same slot, different filter, shared param key.
    S.clearFilters(); S.addFilter('sharpen');          // 'amount' again, def 80
    await new Promise((res) => setTimeout(res, 50));
    const before = {
      doc: (S.store.get('filters.video') || [])[0]?.params?.amount,
      dom: document.getElementById('v-filters-step-0-amount')?.value,
    };
    R.applyRecipe('view-video', { 'v-filters-step-0-amount': '7' });
    await new Promise((res) => setTimeout(res, 100));
    const after = {
      doc: (S.store.get('filters.video') || [])[0]?.params?.amount,
      dom: document.getElementById('v-filters-step-0-amount')?.value,
    };
    S.clearFilters();
    return { junk, layerKept, before, after };
  });
  check('readRecipe captures no positional step ids', r.junk.length === 0, r.junk.join(','));
  check('…while boot-generated audio-layer controls stay in the recipe', r.layerKept);
  check('a stale step id in a loaded preset does not touch the current chain',
        r.after.doc === r.before.doc && r.after.dom === r.before.dom && r.after.dom === '80',
        JSON.stringify({ before: r.before, after: r.after }));
}

/* ================================================================= layers == */
section('layer panel');
{
  const r = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    document.querySelector('.tab[data-view=video]').click();
    S.clearLayers(); S.addLayer();
    const depth0 = S.store.undoDepth;
    const slider = document.querySelector('#v-layers-list input[data-k=opacity]');
    if (!slider) return { error: true };
    let survived = true;
    for (let v = 30; v <= 45; v++) {
      slider.value = String(v);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      // A rebuilt row would replace this node and the browser would lose the drag.
      if (document.querySelector('#v-layers-list input[data-k=opacity]') !== slider) survived = false;
    }
    return { survived, entries: S.store.undoDepth - depth0,
             opacity: (S.store.get('layers.video') || [])[0]?.opacity };
  });
  check('the opacity slider survives a drag', r.survived === true);
  check('…as one undo entry, not one per pixel', r.entries === 1, String(r.entries));
  check('…and the drag lands in the document', Math.abs((r.opacity ?? 0) - 0.45) < 1e-6, String(r.opacity));
}

/* ================================================================ library == */
section('the library is project state');
{
  const before = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    S.clearLibrary();
    S.addToLibrary(new Blob([new Uint8Array(2048)], { type: 'video/webm' }), 'webm', 'videos', 'opening shot', 4);
    S.addToLibrary(new Blob([new Uint8Array(1024)], { type: 'audio/wav' }), 'wav', 'music', 'archive hum', 9);
    document.querySelector('.tab[data-view=library]').click();
    const beats = [...document.querySelectorAll('#lib-body select[data-k=beat]')];
    beats[0].value = 'announceFourKeys'; beats[0].dispatchEvent(new Event('change', { bubbles: true }));
    await S.flushAutosave();
    return { rows: S.library.map((x) => ({ name: x.name, beat: x.beat, size: x.blob?.size ?? null })),
             inDoc: (S.store.get('library') || []).length };
  });
  check('a generated asset is written to the document', before.inDoc === 2, String(before.inDoc));
  check('a name is slugged on the way in', before.rows[0].name === 'opening_shot', before.rows[0].name);

  await page.reload();
  await page.waitForFunction(() => window.DeadSignalStudio && window.DeadSignalStudio.backend);
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.DeadSignalStudio.library
    .map((x) => ({ name: x.name, beat: x.beat, size: x.blob?.size ?? null })));
  check('the library survives a reload — rows', after.length === 2, String(after.length));
  check('…keeping the names and release beats',
        after[0]?.name === 'opening_shot' && after[0]?.beat === 'announceFourKeys',
        JSON.stringify(after[0] || {}));
  check('…and the bytes, from the asset store',
        after[0]?.size === 2048 && after[1]?.size === 1024,
        after.map((x) => x.size).join(', '));

  const r = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    // A third row in the SAME folder with the SAME extension — that is what a
    // filename collision means, since assets/videos/x.webm and
    // assets/music/x.wav are different files in different folders.
    S.addToLibrary(new Blob([new Uint8Array(64)], { type: 'video/webm' }), 'webm', 'videos', 'b roll', 2);
    document.querySelector('.tab[data-view=library]').click();
    const names = [...document.querySelectorAll('#lib-body input[data-k=name]')];
    // Rename it onto the first row's name: the generated manifest is keyed on
    // filename, so a collision silently drops one asset from it.
    names[2].value = 'opening shot'; names[2].dispatchEvent(new Event('change', { bubbles: true }));
    const collided = S.library.filter((x) => x.kind === 'videos' && x.ext === 'webm').map((x) => x.name);
    const n0 = S.library.length;
    document.querySelector('#lib-body button[data-act=rm]').click();
    const removed = S.library.length;
    S.undo();
    return { collided, n0, removed, restored: S.library.length,
             bytesBack: S.library[0]?.blob?.size ?? null };
  });
  check('renaming cannot collide with another row in the same folder',
        new Set(r.collided).size === r.collided.length, r.collided.join(', '));
  check('undo brings a removed row back', r.removed === r.n0 - 1 && r.restored === r.n0);
  check('…with its bytes intact', r.bytesBack === 2048, String(r.bytesBack));

  // Dialling in a sound means pressing RENDER over and over. Each take replaces
  // the last in the same row, so the asset store must not keep a copy of every
  // discarded one for the rest of the session.
  const g = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    S.clearLibrary();
    // Measured as a DELTA. Rows removed earlier keep their bytes on purpose, so
    // undo can bring them back; they are collected by the sweep at the next
    // boot. The question here is whether five takes cost five stored copies.
    const before = (await S.backend.listAssets()).length;
    document.querySelector('.tab[data-view=audio]').click();
    const dur = document.getElementById('a-dur');
    dur.value = '1'; dur.dispatchEvent(new Event('input', { bubbles: true }));
    for (let i = 0; i < 5; i++) {
      document.getElementById('a-render').click();
      await new Promise((r2) => setTimeout(r2, 250));
    }
    await new Promise((r2) => setTimeout(r2, 300));
    return { rows: S.library.length, added: (await S.backend.listAssets()).length - before };
  });
  check('re-rendering reuses one row', g.rows === 1, String(g.rows));
  check('…and stores one asset, not one per take', g.added === 1, `+${g.added}`);
}

/* ============================================================ share links == */
section('share links');
{
  const r = await page.evaluate(async () => {
    const m = await import('./src/ui/cloud.js');
    const hex = 'a'.repeat(64);
    const was = location.hash;
    const probe = (h) => { location.hash = h; const v = m.hasShareFragment(); return v; };
    const out = { none: probe(''), real: probe('#share=' + hex), short: probe('#share=abc') };
    location.hash = was;
    return out;
  });
  // Detected synchronously at boot so the autosave restore does not race the
  // shared document — whichever finished last used to win.
  check('a share link is recognised before anything consumes it', r.real === true);
  check('…and an ordinary load is not', r.none === false && r.short === false,
        `none=${r.none} short=${r.short}`);
}

/* ============================================== loading is not destructive == */
section('project load refuses what is not a project');
{
  const r = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const el = document.getElementById('v-text');
    el.value = 'WORK IN PROGRESS'; el.dispatchEvent(new Event('input', { bubbles: true }));
    let threw = null;
    try { S.applyProject({ name: 'some-package', version: '1.0.0', dependencies: {} }); }
    catch (e) { threw = e.message; }
    return { threw, text: S.store.get('tabs.video.v-text'),
             controls: Object.keys(S.store.get('tabs.video') || {}).length };
  });
  check('a non-project JSON file is refused', !!r.threw, String(r.threw));
  check('…and the open project is untouched',
        r.text === 'WORK IN PROGRESS' && r.controls > 20, `${r.controls} controls`);

  const s = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const m = await import('./src/doc/serialize.js');
    const a = m.toJSON(S.readProject());
    const b = m.toJSON(S.readProject());
    return { stable: a === b, noHandles: !a.includes('"blob"') && !a.includes('"url"') };
  });
  check('a saved project is byte-stable', s.stable);
  check('…and carries no runtime handles', s.noHandles);
}

/* ========================================================= text variables == */
section('text variables');
{
  const r = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const V = await import('./src/ui/variables.js');
    V.setVar('subject', 'M. WEBB');
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('v-text', 'SUBJECT: {{subject}} / CASE {{case}}');
    // Macros used to be each scene's job and only about half of them did it.
    const literal = [];
    for (const scene of ['terminal', 'snow', 'hud', 'cityrain', 'breach', 'neongrid', 'statue', 'kenburns']) {
      set('v-scene', scene);
      if (S.readVideoCfg().text.includes('{{')) literal.push(scene);
    }
    set('v-scene', 'terminal');
    const img = document.getElementById('i-body');
    img.value = 'NAME: {{subject}} BADGE {{badge}}'; img.dispatchEvent(new Event('input', { bubbles: true }));
    return { text: S.readVideoCfg().text, literal, body: S.readImageCfg().body };
  });
  check('a variable reaches the render', r.text === 'SUBJECT: M. WEBB / CASE 7749', r.text);
  check('…in every scene, not a subset', r.literal.length === 0, r.literal.join(', '));
  check('…and on the screen tab too', r.body === 'NAME: M. WEBB BADGE 0047', r.body);

  const o = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const V = await import('./src/ui/variables.js');
    // The EREBUS constants are defaults now, not the tool's opinion.
    V.setVar('case', '1997');
    const e = document.getElementById('v-text');
    e.value = '{{case}} {{nope}} {{pick:alpha|beta|gamma}}';
    e.dispatchEvent(new Event('input', { bubbles: true }));
    const a = S.readVideoCfg().text, b = S.readVideoCfg().text;
    return { a, deterministic: a === b, vars: S.readProject().vars };
  });
  check('a built-in default can be redefined', o.a.startsWith('1997'), o.a);
  check('an unknown name stays literal rather than vanishing', o.a.includes('{{nope}}'), o.a);
  check('{{pick}} resolves and is deterministic', o.deterministic && /alpha|beta|gamma/.test(o.a), o.a);
  check('variables travel in the project', o.vars.subject === 'M. WEBB' && o.vars.case === '1997',
        JSON.stringify(o.vars));

  const rnd = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const e = document.getElementById('v-text');
    e.value = '{{random:####}} / {{random:####}}'; e.dispatchEvent(new Event('input', { bubbles: true }));
    const a = S.readVideoCfg().text, b = S.readVideoCfg().text;
    const seed = document.getElementById('seed');
    seed.value = '999'; seed.dispatchEvent(new Event('input', { bubbles: true }));
    const other = S.readVideoCfg().text;
    seed.value = '1947'; seed.dispatchEvent(new Event('input', { bubbles: true }));
    return { a, stable: a === b, seedChanges: a !== other, restores: S.readVideoCfg().text === a };
  });
  // It used to draw from the per-frame stream, so a "case number" re-rolled
  // sixty times a second and read as a glitch rather than a number.
  check('{{random}} is frozen, not re-rolled every frame', rnd.stable, rnd.a);
  check('…but still follows the seed', rnd.seedChanges && rnd.restores);
  check('…and two occurrences differ', rnd.a.split(' / ')[0] !== rnd.a.split(' / ')[1], rnd.a);
}

/* =============================================================== typeface == */
section('typography');
{
  const r = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('v-scene', 'terminal'); set('v-text', 'THE ARCHIVE IS LISTENING'); set('v-font', '20');
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const ctx = c.getContext('2d');
    const shot = () => { S.renderVideoFrame(ctx, 320, 240, S.readVideoCfg(), 0); return c.toDataURL(); };
    set('v-fontfam', 'mono'); const mono = shot();
    set('v-fontfam', 'heavy'); const heavy = shot();
    set('v-fontfam', 'serif'); const serif = shot();
    set('v-fontfam', 'mono');
    const t = await import('./src/core/text.js');
    const m = document.createElement('canvas').getContext('2d');
    m.font = '16px monospace';
    const wrapped = t.wrapLines(m, 'the archive is listening and it has listened for a very long time', 200);
    const kept = t.wrapLines(m, 'one\ntwo', 500);
    const solid = t.wrapLines(m, 'A'.repeat(120), 100);
    return { distinct: new Set([mono, heavy, serif]).size,
             wrapped: wrapped.length, allFit: wrapped.every((l) => m.measureText(l).width <= 200),
             keepsBreaks: kept.join('|') === 'one|two',
             breaksSolid: solid.length > 1 && solid.every((l) => m.measureText(l).width <= 100) };
  });
  check('each typeface renders different pixels', r.distinct === 3, `${r.distinct}/3 distinct`);
  check('word wrap fits the frame', r.wrapped > 1 && r.allFit, `${r.wrapped} lines`);
  check('…keeps the author\'s own line breaks', r.keepsBreaks);
  check('…and breaks a word with nowhere to break', r.breaksSolid);
}

/* ================================================================= locks === */
section('locks protect a section from presets');
{
  const r = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    const check2 = (id, on) => { const e = document.getElementById(id); e.checked = on; e.dispatchEvent(new Event('change', { bubbles: true })); };
    set('v-text', 'MY OWN SCRIPT'); set('v-w', '640');
    check2('lock-v-text', true); check2('lock-v-out', true);
    const sel = document.getElementById('v-preset');
    sel.value = 'Signal Loss'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const kept = { text: S.store.get('tabs.video.v-text'), w: S.store.get('tabs.video.v-w'),
                   scene: S.store.get('tabs.video.v-scene') };
    check2('lock-v-text', false); check2('lock-v-out', false);
    sel.value = 'Surveillance Cam'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { kept, freed: { text: S.store.get('tabs.video.v-text'), w: S.store.get('tabs.video.v-w') } };
  });
  check('a locked section survives a preset', r.kept.text === 'MY OWN SCRIPT' && r.kept.w === '640',
        `${r.kept.text} @ ${r.kept.w}`);
  check('…while the rest of the preset still applies', r.kept.scene === 'snow', r.kept.scene);
  check('…and unlocking lets it through again',
        r.freed.text !== 'MY OWN SCRIPT' && r.freed.w !== '640', `${r.freed.text} @ ${r.freed.w}`);
}

/* ======================================================== preset manager === */
section('preset manager');
{
  const r = await page.evaluate(async () => {
    const pm = await import('./src/ui/presetman.js');
    const rec = await import('./src/core/recipes.js');
    const p = await import('./src/presets/index.js');
    localStorage.setItem('erebus.studio.presets.video', JSON.stringify({ 'My Look': { 'v-scan': '70' } }));
    p.rebuildPresetSelect('video');
    const renamed = pm.renamePreset('video', 'My Look', 'Night Look');
    const dup = pm.duplicatePreset('video', 'Night Look');
    const collide = pm.renamePreset('video', 'Night Look', dup);
    pm.removePreset('video', dup);
    const imported = pm.importPresets(JSON.stringify({
      kind: 'dead-signal-studio-presets', version: 1,
      presets: { video: { 'Night Look': { 'v-noise': '9' }, Fresh: { 'v-vig': '1' } } },
    }));
    let rejected = null;
    try { pm.importPresets('{"hello":1}'); } catch (e) { rejected = e.message; }
    const names = Object.keys(rec.userPresets('video'));
    document.getElementById('v-preset-manage').click();
    const rows = document.querySelectorAll('.preset-manager tbody tr').length;
    document.querySelector('.preview-overlay .pv-bar .btn')?.click();
    return { renamed, dup, collide, imported, rejected, names,
             rows, closed: !document.querySelector('.preset-manager') };
  });
  check('a preset can be renamed', r.renamed === true && r.dup === 'Night Look copy', String(r.dup));
  check('…and a rename onto an existing name is refused', r.collide === false);
  check('import merges rather than overwriting',
        r.imported.added === 2 && r.imported.renamed === 1 && r.names.includes('Night Look (2)'),
        r.names.join(', '));
  check('…and a file that is not presets is rejected', /not a preset file/.test(r.rejected || ''), String(r.rejected));
  check('the manager overlay opens, lists and closes', r.rows === 3 && r.closed, `${r.rows} rows`);
}

/* SAVE used to destroy a preset of the same name without asking, on a name typed
   into a prompt() — while the MANAGER refused the same collision on rename. The
   two paths disagreed about the same rule. */
{
  const r = await page.evaluate(async () => {
    const rec = await import('./src/core/recipes.js');
    const p = await import('./src/presets/index.js');
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    const scanOf = (n) => (rec.userPresets('video')[n] || {})['v-scan'];
    const seed = () => { localStorage.setItem(rec.PKEY('video'), JSON.stringify({ Keeper: { 'v-scan': '11' } })); p.rebuildPresetSelect('video'); };
    const realPrompt = window.prompt, realConfirm = window.confirm;

    seed(); set('v-scan', '77');
    window.prompt = () => 'Keeper'; window.confirm = () => false;
    rec.saveUserPreset('video', 'view-video');
    const declined = scanOf('Keeper');                       // must still be the seeded look

    window.confirm = () => true;
    rec.saveUserPreset('video', 'view-video');
    const accepted = scanOf('Keeper');                       // now the controls on screen

    /* " Keeper " and "Keeper" are the same name to a person. */
    seed();
    window.prompt = () => '   Keeper   '; window.confirm = () => true;
    rec.saveUserPreset('video', 'view-video');
    const names = Object.keys(rec.userPresets('video'));

    /* An empty or all-whitespace name is not a preset name. */
    window.prompt = () => '   ';
    rec.saveUserPreset('video', 'view-video');
    const afterBlank = Object.keys(rec.userPresets('video')).length;

    window.prompt = realPrompt; window.confirm = realConfirm;
    return { declined, accepted, names, afterBlank };
  });
  check('saving over a preset asks before replacing it', r.declined === '11', String(r.declined));
  check('…and replaces it when that is confirmed', r.accepted === '77', String(r.accepted));
  check('…and a padded name is the same name', r.names.length === 1 && r.names[0] === 'Keeper',
        r.names.join(', '));
  check('…and a blank name saves nothing', r.afterBlank === 1, String(r.afterBlank));
}

/* Deleting or renaming the SELECTED preset rebuilds the picker without that
   option, which left selectedIndex at -1: a blank control whose whole job is to
   say which look is loaded. */
{
  const r = await page.evaluate(async () => {
    const rec = await import('./src/core/recipes.js');
    const p = await import('./src/presets/index.js');
    const pm = await import('./src/ui/presetman.js');
    const sel = () => document.getElementById('v-preset');
    const seat = (name) => {
      localStorage.setItem(rec.PKEY('video'), JSON.stringify({ [name]: { 'v-scan': '13' } }));
      p.rebuildPresetSelect('video');
      sel().value = `user:${name}`;
    };
    const read = () => ({ value: sel().value, index: sel().selectedIndex,
                          text: sel().selectedOptions[0]?.textContent ?? null });

    seat('Doomed');
    const seated = read();
    rec.deleteUserPreset('video', 'Doomed');
    const afterDelete = read();

    seat('Renamed');
    pm.renamePreset('video', 'Renamed', 'New Name');
    const afterRename = read();

    localStorage.removeItem(rec.PKEY('video'));
    p.rebuildPresetSelect('video');
    return { seated, afterDelete, afterRename };
  });
  check('a saved preset can be selected', r.seated.value === 'user:Doomed', JSON.stringify(r.seated));
  check('…deleting the selected preset leaves the picker naming something',
        r.afterDelete.index >= 0 && r.afterDelete.value === '— custom —', JSON.stringify(r.afterDelete));
  check('…and renaming it carries the selection to the new name',
        r.afterRename.value === 'user:New Name' && r.afterRename.text === 'New Name',
        JSON.stringify(r.afterRename));
}

/* ======================================================== layer overrides == */
/* A layer used to inherit the base clip's ENTIRE recipe, so every layer drew
   the same words in the same colour at the same size — which is why the panel
   had to warn that stacking Snow "repeats the base's message". */
section('a layer is its own signal');
{
  await page.evaluate(() => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('v-scene', 'terminal'); set('v-text', 'BASE MESSAGE'); set('v-fg', '#39ff9e');
    set('v-wrap', ''); document.getElementById('v-wrap').checked = false;
    window.__shot = (ls, over) => {
      const S = window.DeadSignalStudio;
      S.store.apply({ op: 'set', path: 'layers.video', value: ls });
      const c = document.createElement('canvas'); c.width = 320; c.height = 240;
      const ctx = c.getContext('2d');
      S.renderVideoFrame(ctx, 320, 240, { ...S.readVideoCfg(), ...(over || {}) }, 1.0);
      const d = ctx.getImageData(0, 0, 320, 240).data;
      let sum = 0, r = 0;
      for (let i = 0; i < d.length; i += 4) { sum += d[i] + d[i + 1] + d[i + 2]; r += d[i]; }
      const n = d.length / 4;
      return { url: c.toDataURL(), mean: Math.round(sum / n / 3), red: Math.round(r / n) };
    };
  });

  const v = await page.evaluate(() => {
    const L = (extra) => ({ scene: 'matrix', blend: 'screen', opacity: 1, enabled: true, ...extra });
    const twin = window.__shot([L(), L()]);
    const varied = window.__shot([L(), L({ seed: 7 })]);
    const again = window.__shot([L(), L({ seed: 7 })]);
    return { changes: twin.url !== varied.url, deterministic: varied.url === again.url };
  });
  check('a variant makes a second copy of a scene a different one', v.changes);
  check('…and the same variant renders the same picture twice', v.deterministic);

  /* …AND THE BUTTON HAS TO HAND ONE OUT.
     Variant 0 means "draw with the base clip's randomness", so two copies of a
     scene at 0 draw the identical picture and the second only brightens the
     first — measured at 45 of the 48 scenes. Every layer ADD made arrived at 0,
     which meant the variant mechanism above only ever worked for an author who
     found the number box. */
  const nv = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const UL = await import('./src/ui/layers.js');
    S.store.apply({ op: 'set', path: 'layers.video', value: [], label: 'probe' });
    UL.addLayer(); UL.addLayer(); UL.addLayer();
    const seeds = S.store.get('layers.video').map((l) => l.seed);
    /* And a hand-typed 0 still means what it says. */
    S.store.apply({ op: 'set', path: 'layers.video',
      value: [{ scene: 'matrix', blend: 'screen', opacity: 1, enabled: true, seed: 0 },
              { scene: 'matrix', blend: 'screen', opacity: 1, enabled: true, seed: 2 }],
      label: 'probe' });
    const mixed = S.store.get('layers.video').map((l) => l.seed);
    S.store.apply({ op: 'set', path: 'layers.video', value: [], label: 'probe' });
    return { seeds, mixed };
  });
  check('every layer ADD gives that layer its own variant',
        nv.seeds.length === 3 && new Set(nv.seeds).size === 3 && !nv.seeds.includes(0),
        nv.seeds.join(','));
  check('…and a variant of 0 is still allowed, because it still means something',
        nv.mixed[0] === 0, nv.mixed.join(','));

  const o = await page.evaluate(() => {
    const base = window.__shot([{ scene: 'matrix', blend: 'screen', opacity: 1, enabled: true }]);
    const red = window.__shot([{ scene: 'matrix', blend: 'screen', opacity: 1, enabled: true, fg: '#ff2b6b' }]);
    const big = window.__shot([{ scene: 'matrix', blend: 'screen', opacity: 1, enabled: true, font: 40 }]);
    const inherit = window.__shot([{ scene: 'snow', blend: 'screen', opacity: 1, enabled: true }]);
    const own = window.__shot([{ scene: 'snow', blend: 'screen', opacity: 1, enabled: true, text: 'PLEASE STAND BY' }]);
    return { colour: base.url !== red.url, redder: red.red > base.red,
             size: base.url !== big.url, text: inherit.url !== own.url };
  });
  check('a layer can carry its own colour', o.colour && o.redder);
  check('…its own size', o.size);
  check('…and its own text', o.text);

  const m = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const V = await import('./src/ui/variables.js');
    V.setVar('station', 'NODE 47');
    S.store.apply({ op: 'set', path: 'layers.video',
      value: [{ scene: 'snow', blend: 'screen', opacity: 1, enabled: true, text: '{{station}} / {{case}}' }] });
    return { resolved: S.readVideoCfg().__layers[0].text, stored: S.store.get('layers.video')[0].text,
             // An earlier section redefines {{case}}, so read what it is now.
             caseNow: S.readProject().vars.case ?? '7749' };
  });
  check('variables resolve in a layer\'s own text',
        m.resolved === `NODE 47 / ${m.caseNow}` && !m.resolved.includes('{{'), m.resolved);
  check('…and are stored unexpanded, so changing one updates the clip',
        m.stored === '{{station}} / {{case}}', m.stored);

  /* EVERY LAYER STARTS ON A CONTEXT THAT LOOKS NEW.
     The shared layer canvas was cleared (transform, alpha, composite op, and a
     black fill) but not RESET, so font, textBaseline, textAlign, fillStyle,
     strokeStyle and lineWidth carried over from the layer before. A scene that
     relies on a default rather than setting it then drew with the previous
     scene's value — measured across all 48 scenes: 37 leave `font` changed, 29
     `textBaseline`, 26 `textAlign`, 26 `fillStyle`, 21 `strokeStyle`, 1
     `lineWidth`.

     Checked two ways, because the state check is exact and the pixel check is
     what an author would actually notice. */
  const rs = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const { SCENES } = await import('./src/video/scenes.js');
    const { resetCtxState } = await import('./src/core/text.js');
    const { beginFrame } = await import('./src/core/rng.js');
    const W = 160, H = 120;
    const PROPS = ['globalAlpha', 'globalCompositeOperation', 'fillStyle', 'strokeStyle',
      'lineWidth', 'lineCap', 'lineJoin', 'miterLimit', 'lineDashOffset', 'shadowBlur',
      'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'filter', 'font', 'textAlign',
      'textBaseline', 'direction', 'letterSpacing', 'imageSmoothingEnabled', 'imageSmoothingQuality'];
    const snap = (x) => {
      const o = { __dash: x.getLineDash().join(','), __t: Object.values(x.getTransform()).join(',') };
      for (const p of PROPS) o[p] = String(x[p]);
      return o;
    };
    const virgin = snap(document.createElement('canvas').getContext('2d'));

    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const cfg = { ...S.readVideoCfg(), W, H, bg: '#000' };
    const notReset = [];
    for (const name of Object.keys(SCENES)) {
      beginFrame(51);
      SCENES[name].draw(x, W, H, cfg, 1.7);
      resetCtxState(x);
      const after = snap(x);
      const bad = Object.keys(virgin).filter((k) => virgin[k] !== after[k]);
      if (bad.length) notReset.push(name + ': ' + bad.join('/'));
    }
    return { scenes: Object.keys(SCENES).length, notReset };
  });
  check('resetCtxState puts the context back to a new canvas\'s state, after every scene',
        rs.notReset.length === 0, rs.notReset.slice(0, 4).join(' | '));

  /* And through the real render: with source-over at opacity 1 a layer's bitmap
     is fully opaque (it is filled black before the scene draws), so it covers
     the base and everything under it. frame([A, B]) must therefore equal
     frame([B]) exactly, for every A.

     Four of the 48 scenes are excluded from "must be exact" rather than the
     whole check being loosened, and the reason is not this code: Chromium
     rasterises a shadowBlur'd draw slightly differently after a gradient fill on
     the same canvas (max 18/765 per pixel). Neutralising shadowBlur takes the
     order-dependence to 0 across all 2304 pairs, with the context state and the
     bitmap both provably identical beforehand. Before the reset, 396 pairs
     differed for reasons that WERE this code. */
  const st = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const { SCENES } = await import('./src/video/scenes.js');
    const names = Object.keys(SCENES);
    /* Distinct NON-ZERO variants, so withSeedOffset re-addresses each layer's
       randomness from a fixed point and the only thing left that could differ is
       the canvas. Variant 0 means "share the base clip's randomness", which
       genuinely does make a layer depend on what drew before it — documented,
       deliberate, and a different question from this one. */
    const L = (scene, seed) => ({ scene, blend: 'source-over', opacity: 1, enabled: true,
                                  text: '', fg: '', font: 0, seed });
    const set = (v) => S.store.apply({ op: 'set', path: 'layers.video', value: v, label: 'probe' });
    const frame = () => {
      const cfg = { ...S.readVideoCfg(), W: 160, H: 120 };
      const c = document.createElement('canvas'); c.width = 160; c.height = 120;
      const ctx = c.getContext('2d');
      S.renderVideoFrame(ctx, 160, 120, { ...cfg, __layers: S.store.get('layers.video') }, 1.7);
      const d = ctx.getImageData(0, 0, 160, 120).data;
      let h = 2166136261;
      for (let i = 0; i < d.length; i += 3) { h ^= d[i]; h = Math.imul(h, 16777619); }
      return h >>> 0;
    };
    /* Four heavy state-setters as the preceding layer: terminal (font,
       baseline), snow (textAlign center), bars (fillStyle, gradient), hud
       (lineWidth). */
    const unstable = new Set();
    for (const b of names) {
      set([L(b, 5)]);
      const solo = frame();
      for (const a of ['terminal', 'snow', 'bars', 'hud']) {
        set([L(a, 9), L(b, 5)]);
        if (frame() !== solo) unstable.add(b);
      }
    }
    set([]);
    return { comparisons: names.length * 4, unstable: [...unstable] };
  });
  check('a layer renders the same whatever layer precedes it',
        st.unstable.length <= 4,
        `${st.comparisons} comparisons, ${st.unstable.length} scenes affected: ${st.unstable.join(', ') || 'none'}`);

  /* A layer draws on black so an additive blend drops its background. That
     made multiply against black BLACK: choosing Multiply crushed the whole
     frame (mean 9 → 1), and Overlay and Hard Light nearly as badly. Three of
     the six blends on offer were traps.

     Measured against a DELIBERATE base rather than whatever the tab is holding
     by the time this section runs. That base was a near-black terminal frame
     with a mean of 10 out of 255, and the assertion was `multiply >= base` — so
     the whole check was being decided by one unit of rounding in the browser's
     blend maths, and it duly disagreed between two Chromium builds on the same
     commit. It also asserted the wrong thing: multiply is SUPPOSED to darken
     where the layer draws. What it must not do is collapse the picture, which
     is what the 89% loss above was. So: a bright, flat, quiet base, and a
     threshold that a crush fails and ordinary darkening passes. */
  const b = await page.evaluate(() => {
    const BASE = { scene: 'terminal', bg: '#6a6a6a', fg: '#e8e8e8', text: 'BLEND BASE',
                   // Silence everything that would move the mean on its own.
                   scan: 0, noise: 0, vig: 0, flick: 0, chroma: 0, bloom: 0, persist: 0,
                   mask: 0, hum: 0, track: 0, shake: 0, roll: 0, dither: false, fade: 0,
                   hud: '', tc: false, morse: '', blink: '', reveal: '', sub: '', filters: [] };
    const base = window.__shot([], BASE);
    const out = { base: base.mean };
    for (const blend of ['overlay', 'hard-light', 'multiply', 'screen', 'lighter', 'difference']) {
      out[blend] = window.__shot([{ scene: 'matrix', blend, opacity: 1, enabled: true }], BASE).mean;
    }
    return out;
  });
  check('the blend base is bright enough to measure a crush against', b.base > 80, String(b.base));
  /* Two thirds: the bug this guards was a 90% collapse, and a keyed multiply
     over a matrix layer legitimately takes a few percent off. Anything between
     is a blend that is eating the picture. */
  const KEEP = 0.66;
  check('multiply no longer crushes the frame to black', b.multiply >= b.base * KEEP,
        `${b.base} → ${b.multiply}`);
  check('…nor overlay', b.overlay >= b.base * KEEP, `${b.base} → ${b.overlay}`);
  check('…nor hard-light', b['hard-light'] >= b.base * KEEP, `${b.base} → ${b['hard-light']}`);
  check('…and the additive blends still brighten', b.screen > b.base && b.lighter > b.base,
        `screen ${b.screen}, lighter ${b.lighter}`);

  const p = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.store.apply({ op: 'set', path: 'layers.video',
      value: [{ scene: 'matrix', blend: 'multiply', opacity: 0.4, enabled: true,
                text: 'OWN WORDS', fg: '#ff2b6b', font: 22, seed: 5 }] });
    const proj = JSON.parse(JSON.stringify(S.readProject()));
    S.addTimelineClip();
    // Earlier sections have already added clips, so take the one just made.
    const clip = S.timeline[S.timeline.length - 1].rec.__layers[0];
    S.applyProject(proj);
    return { clip, back: S.store.get('layers.video')[0] };
  });
  const full = (l) => l && l.text === 'OWN WORDS' && l.fg === '#ff2b6b' && l.font === 22 && l.seed === 5;
  check('overrides are captured into a timeline clip', full(p.clip), JSON.stringify(p.clip));
  check('…and survive a project round trip', full(p.back), JSON.stringify(p.back));

  const ui = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.clearLayers(); S.addLayer();
    const det = document.querySelector('#v-layers-list details.layer-more');
    det.open = true;
    const ta = document.querySelector('#v-layers-list textarea[data-k=text]');
    ta.value = 'LAYER CAPTION';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const survived = document.querySelector('#v-layers-list textarea[data-k=text]') === ta;
    const own = document.querySelector('#v-layers-list input[data-k=ownfg]');
    own.checked = true; own.dispatchEvent(new Event('change', { bubbles: true }));
    return { survived, stored: S.store.get('layers.video')[0].text,
             fg: S.store.get('layers.video')[0].fg,
             summary: document.querySelector('#v-layers-list summary')?.textContent,
             stillOpen: !!document.querySelector('#v-layers-list details.layer-more')?.open };
  });
  check('typing a layer caption does not rebuild the row', ui.survived && ui.stored === 'LAYER CAPTION', ui.stored);
  check('taking the colour over starts from the inherited one', /^#[0-9a-f]{6}$/i.test(ui.fg), ui.fg);
  check('the fold marks a layer that overrides something', /◆/.test(ui.summary || ''), ui.summary);
  check('…and stays open across the rebuild', ui.stillOpen);
}

/* ==================================================== delivery formats ===== */
/* Everything in the tool was small and landscape with a 1280×1024 ceiling,
   because it was built for assets that play inside a fake Win95 desktop. None
   of that reaches somewhere the work is actually watched. */
section('vertical delivery');
{
  const r = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const F = await import('./src/core/formats.js');
    // Only the visible tab previews, so the canvas is only resized while the
    // video tab is showing — an earlier section may have left another one up.
    document.querySelector('.tab[data-view=video]').click();
    const pick = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
    const bad = [];
    for (const f of F.FORMATS) {
      if (!f.w) continue;
      pick('v-format', f.id);
      const cfg = S.readVideoCfg();
      if (cfg.W !== f.w || cfg.H !== f.h) bad.push(`${f.id}: ${cfg.W}×${cfg.H} ≠ ${f.w}×${f.h}`);
      if (document.getElementById('v-aspect').value !== f.ratio) bad.push(`${f.id}: aspect drifted`);
    }
    pick('v-format', 'vertical');
    const cfg = S.readVideoCfg();
    return { bad, w: cfg.W, h: cfg.H, count: F.FORMATS.length - 1,
             canvas: [document.getElementById('vcanvas').width, document.getElementById('vcanvas').height] };
  });
  check('Shorts / TikTok / Reels is a real 1080×1920', r.w === 1080 && r.h === 1920, `${r.w}×${r.h}`);
  check(`every delivery format lands exactly (${r.count})`, r.bad.length === 0, r.bad.slice(0, 3).join(' | '));
  check('…and the canvas follows it', r.canvas[0] === 1080 && r.canvas[1] === 1920, r.canvas.join('×'));

  /* Deriving height from width alone overflowed in one direction and did it
     silently: assigning 2276 to a number input does NOT clamp to its max, so
     the document kept a value the render then clamped to something else and
     the frame was not the ratio the picker claimed. */
  const fit = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('v-w', '1280'); set('v-h', '720');
    const sel = document.getElementById('v-aspect');
    sel.value = '9:16'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const cfg = S.readVideoCfg();
    return { w: cfg.W, h: cfg.H, domH: document.getElementById('v-h').value };
  });
  check('a portrait ratio from a wide frame is exact', Math.abs(fit.w / fit.h - 9 / 16) < 0.01,
        `${fit.w}×${fit.h}`);
  check('…stays inside the size limit', fit.h <= 1920 && fit.w <= 1920, `${fit.w}×${fit.h}`);
  check('…and the control agrees with the render', fit.domH === String(fit.h), `${fit.domH} vs ${fit.h}`);

  const stale = await page.evaluate(async () => {
    const sel = document.getElementById('v-format');
    sel.value = 'vertical'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const before = sel.value;
    const w = document.getElementById('v-w'); w.value = '640'; w.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r2) => setTimeout(r2, 160));
    return { before, after: document.getElementById('v-format').value };
  });
  check('resizing by hand drops the format label', stale.before === 'vertical' && stale.after === '',
        `${stale.before} → "${stale.after}"`);

  const other = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const pick = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
    document.querySelector('.tab[data-view=image]').click();
    pick('i-format', 'vertical');
    const img = S.readImageCfg();
    document.querySelector('.tab[data-view=timeline]').click();
    pick('tl-format', 'vertical');
    const tl = S.buildSchedule().tl;
    document.querySelector('.tab[data-view=video]').click();
    return { screen: [img.W, img.H], timeline: [tl.W, tl.H] };
  });
  check('SCREEN can be vertical too', other.screen[0] === 1080 && other.screen[1] === 1920, other.screen.join('×'));
  check('…and so can a TIMELINE sequence', other.timeline[0] === 1080 && other.timeline[1] === 1920,
        other.timeline.join('×'));

  const render = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const pick = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    pick('v-format', 'vertical'); set('v-scene', 'terminal'); set('v-text', 'VERTICAL'); set('v-font', '48');
    const cfg = S.readVideoCfg();
    const c = document.createElement('canvas'); c.width = cfg.W; c.height = cfg.H;
    S.renderVideoFrame(c.getContext('2d'), cfg.W, cfg.H, cfg, 1);
    const d = c.getContext('2d').getImageData(0, 0, cfg.W, cfg.H).data;
    let lit = 0, low = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] + d[i + 1] + d[i + 2] > 60) { lit++; if (i > d.length * 0.75) low++; }
    }
    const box = document.getElementById('vcanvas').getBoundingClientRect();
    return { lit, low, cssRatio: box.width / box.height, fits: box.height <= window.innerHeight };
  });
  check('a vertical frame renders a real picture', render.lit > 1000, `${render.lit} lit px`);
  check('…all the way down the tall frame', render.low > 0, `${render.low} lit px in the bottom quarter`);
  check('the preview keeps its ratio and fits the window',
        Math.abs(render.cssRatio - 1080 / 1920) < 0.03 && render.fits, render.cssRatio.toFixed(3));

  const guard = await page.evaluate(async () => {
    const g = await import('./src/video/gif.js');
    const cap = await import('./src/video/capture.js');
    return { max: g.GIF_MAX_DIM, big: cap.fitWithin(1080, 1920, g.GIF_MAX_DIM),
             small: cap.fitWithin(320, 240, g.GIF_MAX_DIM) };
  });
  /* Frames are collected as full canvases held at once. At 1080×1920 a
     240-frame GIF would allocate two gigabytes before encoding anything. */
  check('GIF export is capped so it cannot eat the heap',
        guard.big.w === 360 && guard.big.h === 640, JSON.stringify(guard.big));
  check('…and a small clip is untouched by the cap',
        guard.small.w === 320 && guard.small.h === 240, JSON.stringify(guard.small));

  const banner = await page.evaluate(() => {
    const pick = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
    pick('v-format', 'vertical');
    const fps = document.getElementById('v-fps'); fps.value = '30'; fps.dispatchEvent(new Event('input', { bubbles: true }));
    return { texts: [...document.querySelectorAll('#v-banners .banner')].map((b) => b.textContent),
             est: document.getElementById('v-est').textContent };
  });
  // "may drop frames" is only true of the real-time recorder, and firing it on
  // the delivery size an author is meant to use is noise.
  check('no bogus "may drop frames" warning at a delivery size',
        !banner.texts.some((t) => /drop frames/.test(t)), banner.texts.join(' | '));
  check('the export estimate is a duration, not a boast',
        /faster than real time|to export/.test(banner.est), banner.est);
}

/* ======================================================= sound on video ==== */
/* The muxer wrote one video track and captureStream carries no audio, so the
   studio could not produce a clip with sound at all — AUDIO and VIDEO were two
   separate exports the campaign had to play separately. */
section('sound on video');
{
  const bed = await page.evaluate(async () => {
    const B = await import('./src/audio/bed.js');
    document.querySelector('.tab[data-view=audio]').click();
    const dur = document.getElementById('a-dur');
    dur.value = '1'; dur.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('a-render').click();
    await new Promise((r) => setTimeout(r, 1200));
    const short = await B.prepareBed('last', 3);      // 1s under a 3s clip
    const long = await B.prepareBed('last', 0.5);     // …and over a 0.5s one
    const none = await B.prepareBed('', 3);
    document.querySelector('.tab[data-view=video]').click();
    return {
      loops: short ? +(short.length / 48000).toFixed(2) : null,
      trims: long ? +(long.length / 48000).toFixed(2) : null,
      rate: short?.sampleRate, ch: short?.numberOfChannels,
      silent: none === null,
      options: [...document.getElementById('v-audio').options].map((o) => o.value),
    };
  });
  check('a bed shorter than the clip loops to fill it', bed.loops === 3, `${bed.loops}s`);
  check('…and a longer one is trimmed', bed.trims === 0.5, `${bed.trims}s`);
  check('…resampled to 48kHz for Opus', bed.rate === 48000 && bed.ch >= 1, `${bed.rate}Hz ${bed.ch}ch`);
  check('"silent" resolves to nothing at all', bed.silent);
  check('the picker offers the last render and the library',
        bed.options.includes('last') && bed.options.some((o) => o.startsWith('lib:')),
        bed.options.join(', '));

  const enc = await page.evaluate(async () => {
    const E = await import('./src/export/encoder.js');
    const B = await import('./src/audio/bed.js');
    const buf = await B.prepareBed('last', 1);
    const draw = (ctx, t) => { ctx.fillStyle = t > 0.5 ? '#0f0' : '#00f'; ctx.fillRect(0, 0, 160, 120); };
    const silent = await E.encodeClip({ width: 160, height: 120, fps: 12, frames: 12, drawFrame: draw });
    const sound = await E.encodeClip({ width: 160, height: 120, fps: 12, frames: 12,
                                       drawFrame: draw, audioBuffer: buf });
    if (!silent || !sound) return { unsupported: true };
    window.__soundClip = sound.blob;
    return { silentSize: silent.blob.size, soundSize: sound.blob.size,
             silentAudio: silent.audio, soundAudio: sound.audio };
  });
  if (enc.unsupported) {
    check('WebCodecs is available for the sound test', false, 'encodeClip returned null');
  } else {
    check('a silent export still carries no audio track', enc.silentAudio === null);
    check('a bed is encoded into Opus packets',
          !!enc.soundAudio && enc.soundAudio.packets > 10, JSON.stringify(enc.soundAudio));
    check('…and the file grew by the sound', enc.soundSize > enc.silentSize,
          `${enc.silentSize} → ${enc.soundSize} bytes`);

    // The claim that matters: a browser opens it and finds sound in it.
    const play = await page.evaluate(async () => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true;
      v.src = URL.createObjectURL(window.__soundClip);
      document.body.appendChild(v);
      await new Promise((res) => { v.onloadedmetadata = res; v.onerror = res; setTimeout(res, 4000); });
      let tracks = -1;
      try { tracks = v.captureStream().getAudioTracks().length; } catch (e) { tracks = -2; }
      await v.play().catch(() => {});
      await new Promise((r) => setTimeout(r, 800));
      const out = { tracks, audioBytes: v.webkitAudioDecodedByteCount ?? -1,
                    w: v.videoWidth, h: v.videoHeight, duration: +(v.duration || 0).toFixed(2) };
      v.pause(); v.remove();
      return out;
    });
    check('the browser finds an audio track in the exported clip', play.tracks === 1, String(play.tracks));
    check('…and actually decodes sound from it', play.audioBytes > 0, `${play.audioBytes} bytes`);
    check('…without disturbing the picture', play.w === 160 && play.h === 120, `${play.w}×${play.h}`);
  }

  const recipe = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const sel = document.getElementById('v-audio');
    const libOpt = [...sel.options].find((o) => o.value.startsWith('lib:'));
    sel.value = libOpt.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const cfg = S.readVideoCfg();
    S.addTimelineClip();
    const clip = S.timeline[S.timeline.length - 1].rec['v-audio'];
    const proj = JSON.parse(JSON.stringify(S.readProject()));
    S.applyProject(proj);
    return { cfg: cfg.audioBed, clip, doc: S.store.get('tabs.video.v-audio'), chosen: libOpt.value };
  });
  check('the chosen bed is part of the recipe', recipe.cfg === recipe.chosen, recipe.cfg);
  check('…captured into a timeline clip', recipe.clip === recipe.chosen, String(recipe.clip));
  check('…and restored with the project', recipe.doc === recipe.chosen, String(recipe.doc));
}

/* ============================================ a timeline that is a timeline ==== */
/* TIMELINE was a queue: whole scenes played back to back, one global transition
   rule, no way to use part of a clip and nowhere to put a still. A clip now has
   a trim and its own transition, a still holds a SCREEN render, and the track
   above the table is where you grab an edge. */
section('a timeline that is a timeline');
{
  const built = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    document.querySelector('.tab[data-view=timeline]').click();
    document.getElementById('tl-clear').click();
    document.querySelector('.tab[data-view=video]').click();
    set('v-scene', 'terminal'); set('v-text', 'ONE'); set('v-dur', '6');
    S.addTimelineClip();
    set('v-scene', 'matrix'); set('v-text', 'TWO'); set('v-dur', '4');
    S.addTimelineClip();
    document.querySelector('.tab[data-view=image]').click();
    set('i-title', 'CARD');
    document.querySelector('.tab[data-view=timeline]').click();
    document.getElementById('tl-still').click();
    return S.timeline.map((c) => ({ kind: c.kind, src: c.src, in: c.in, out: c.out }));
  });
  check('a scene enters the sequence as a whole-source clip',
    built[0]?.kind === 'video' && built[0]?.src === 6 && built[0]?.in === 0 && built[0]?.out === 6,
    JSON.stringify(built[0]));
  check('a SCREEN render can be held as a still',
    built[2]?.kind === 'still' && built[2]?.src === 3, JSON.stringify(built[2]));

  const trim = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const D = await import('./src/doc/timeline.js');
    const before = S.buildSchedule().duration;
    S.editClip(0, { in: 2, out: 5 }, 'trim');             // 6s source -> 3s used
    const after = S.buildSchedule();
    return { before: +before.toFixed(2), after: +after.duration.toFixed(2),
             starts: after.starts.map((x) => +x.toFixed(2)),
             lens: S.timeline.map((c) => +D.clipLength(c).toFixed(2)) };
  });
  check('trimming a clip shortens the sequence, not the source',
    trim.after === +(trim.before - 3).toFixed(2) && trim.lens[0] === 3, JSON.stringify(trim));

  const window_ = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const shot = () => {
      const sched = S.buildSchedule();
      const c = document.createElement('canvas'); c.width = sched.tl.W; c.height = sched.tl.H;
      S.renderTimelineFrame(c.getContext('2d'), 0, sched);
      return c.toDataURL();
    };
    const trimmed = shot();
    S.editClip(0, { in: 0, out: 6 }, 'untrim');
    const whole = shot();
    S.editClip(0, { in: 2, out: 5 }, 'retrim');
    return trimmed !== whole;
  });
  check('a trimmed clip plays its IN..OUT window, not the top of the source', window_);

  const trans = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.editClip(1, { transition: 'crossfade', xdur: 1 }, 'x');
    S.editClip(2, { transition: 'cut', xdur: 0 }, 'x');
    const fade = S.buildSchedule();
    S.editClip(1, { transition: 'cut' }, 'x');
    const cut = S.buildSchedule();
    return { fade: +fade.duration.toFixed(2), cut: +cut.duration.toFixed(2),
             fadeStarts: fade.starts.map((x) => +x.toFixed(2)) };
  });
  check('a crossfade overlaps its clip with the one before it',
    trans.fade === trans.cut - 1 && trans.fadeStarts[1] === 2, JSON.stringify(trans));
  check('…and each clip carries its own transition, not one global rule',
    trans.cut > trans.fade, JSON.stringify(trans));

  const still = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const sched = S.buildSchedule();
    const c = document.createElement('canvas'); c.width = sched.tl.W; c.height = sched.tl.H;
    const ctx = c.getContext('2d');
    S.renderTimelineFrame(ctx, sched.starts[2] + 0.5, sched);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
    return lit;
  });
  check('a still renders the screen recipe, not a black hole in the sequence', still > 500, String(still));

  const track = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('#tl-track .tl-clip')];
    const pct = (s) => parseFloat(s);
    return { count: blocks.length,
             widths: blocks.map((b) => pct(b.style.width)),
             ordered: blocks.map((b) => pct(b.style.left)).every((v, i, a) => i === 0 || v >= a[i - 1]),
             playhead: !!document.getElementById('tl-playhead'),
             ticks: document.querySelectorAll('#tl-track .tl-tick').length,
             /* The unit, asserted explicitly. Without this every ratio check
                below stays green against percentages too — parseFloat('42.3px')
                and parseFloat('42.3%') are the same number — which would make
                the whole geometry section quietly vacuous. */
             units: blocks.every((b) => b.style.width.endsWith('px') && b.style.left.endsWith('px')),
             labelled: blocks.every((b) => /Clip \d+, .+ seconds/.test(b.getAttribute('aria-label') || '')) };
  });
  check('the track draws one block per clip, laid out in order',
    track.count === 3 && track.ordered, JSON.stringify(track));
  check('…block width is proportional to clip length',
    Math.abs(track.widths[1] / track.widths[0] - 4 / 3) < 0.05, JSON.stringify(track.widths));
  check('…with a ruler and a playhead', track.playhead && track.ticks > 2, JSON.stringify(track.ticks));
  check('…and every block announces itself', track.labelled);
  check('the lane is laid out in pixels, not percentages', track.units);

  /* --------------------------------------------------- a real time scale -- */
  /* The old "zoom" set the lane's CSS width to a percentage, which made the same
     picture physically bigger and left the ruler saying the same six things. A
     scale means pixels per second: blocks measured in it, a ruler stepped from
     it, and a pointer that converts through it. */
  const scale = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const { clipLength } = await import('./src/doc/timeline.js');
    const box = document.getElementById('tl-track');
    const widths = () => [...box.querySelectorAll('.tl-clip')].map((b) => parseFloat(b.style.width));
    const tickInfo = () => {
      const t = [...box.querySelectorAll('.tl-tick')];
      const num = (el) => {
        const s = el.textContent.trim();
        return s.includes(':') ? (+s.split(':')[0]) * 60 + (+s.split(':')[1]) : parseFloat(s);
      };
      return { count: t.length, delta: t.length > 1 ? num(t[1]) - num(t[0]) : 0 };
    };
    const setZoom = (pct) => {
      const z = document.getElementById('nle-zoom');
      z.value = String(pct);
      z.dispatchEvent(new Event('input', { bubbles: true }));
    };

    setZoom(100);
    const at100 = { pps: S.trackScale().pxPerSec, widths: widths(), ticks: tickInfo() };
    // A block is exactly its own length in pixels — the claim a scale makes.
    const exact = Math.abs(at100.widths[0] - clipLength(S.timeline[0]) * at100.pps) < 1.5;

    setZoom(300);
    const sc = document.getElementById('tl-scroll');
    const at300 = { pps: S.trackScale().pxPerSec, widths: widths(), ticks: tickInfo(),
                    scrolls: sc.scrollWidth > sc.clientWidth + 1 };

    /* Scroll survives a rebuild. renderTrack runs twice per commit, so this also
       catches the case where it is restored once and then lost again.

       The preview is paused first: while it plays, the playhead deliberately
       drags the viewport along with it, which is the behaviour wanted and not
       the one under test here. */
    document.getElementById('tl-playpause').click();
    sc.scrollLeft = 200;
    S.editClip(0, { label: 'Scroll me' }, 'label');
    const keptScroll = Math.abs(document.getElementById('tl-scroll').scrollLeft - 200);

    // Focus must not yank the viewport to the focused block.
    document.getElementById('tl-scroll').scrollLeft = 0;
    box.querySelector('.tl-clip:last-of-type')?.focus({ preventScroll: true });
    const afterFocus = document.getElementById('tl-scroll').scrollLeft;

    // Pointer → time, at a zoom where a percentage-based conversion would be
    // wrong by exactly 3×. Twelve moves of −5px is −60px of trim.
    S.editClip(0, { in: 0, out: 5 }, 'reset');
    const pps300 = S.trackScale().pxPerSec;
    const before = S.timeline[0].out;
    const depth0 = S.store.undoDepth;
    const grip = box.querySelector('.tl-clip[data-i="0"] .tl-grip.r');
    const r = grip.getBoundingClientRect();
    const at = (x) => ({ bubbles: true, clientX: x, clientY: r.top + r.height / 2, pointerId: 51 });
    grip.dispatchEvent(new PointerEvent('pointerdown', at(r.left + 2)));
    for (let k = 1; k <= 12; k++) box.dispatchEvent(new PointerEvent('pointermove', at(r.left + 2 - k * 5)));
    box.dispatchEvent(new PointerEvent('pointerup', at(r.left + 2 - 60)));
    const trimmed = { delta: +(before - S.timeline[0].out).toFixed(2),
                      expected: +(60 / pps300).toFixed(2),
                      entries: S.store.undoDepth - depth0 };

    /* Page overflow measured as a DELTA. This page has panels that already
       overflow slightly at this viewport, so an absolute assertion would be
       testing those instead — the claim here is that zooming the LANE does not
       add to it. */
    setZoom(100);
    const pageAt100 = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    setZoom(600);
    const pageAt600 = document.documentElement.scrollWidth - document.documentElement.clientWidth;

    document.getElementById('nle-zoom-fit').click();
    const fitted = { zoom: S.trackScale().zoom, control: Number(document.getElementById('nle-zoom').value) };

    S.editClip(0, { in: 0, out: 6, label: 'Terminal / Text · ONE' }, 'restore');
    document.getElementById('tl-playpause').click();      // playing again, as it was
    return { at100, at300, exact, keptScroll, afterFocus, trimmed, pageAt100, pageAt600, fitted };
  });
  check('a block is exactly its own length in pixels', scale.exact,
    JSON.stringify({ w: scale.at100.widths[0], pps: scale.at100.pps }));
  check('zoom multiplies the scale rather than stretching the picture',
    Math.abs(scale.at300.pps / scale.at100.pps - 3) < 0.02,
    JSON.stringify({ at100: scale.at100.pps, at300: scale.at300.pps }));
  check('…every block widens with it', scale.at300.widths.every((w, i) =>
    Math.abs(w / scale.at100.widths[i] - 3) < 0.05), JSON.stringify(scale.at300.widths));
  check('…and the lane scrolls instead of the page', scale.at300.scrolls && scale.pageAt600 <= scale.pageAt100 + 1,
    JSON.stringify({ laneScrolls: scale.at300.scrolls, pageAt100: scale.pageAt100, pageAt600: scale.pageAt600 }));
  /* The assertion the old implementation could not pass at all: its ruler chose
     its step from the duration, so zooming stretched the same ticks apart. */
  check('the ruler follows the zoom — more ticks, closer together in time',
    scale.at300.ticks.count > scale.at100.ticks.count && scale.at300.ticks.delta < scale.at100.ticks.delta,
    JSON.stringify({ at100: scale.at100.ticks, at300: scale.at300.ticks }));
  check('scroll survives the rebuild an edit causes', scale.keptScroll <= 1, String(scale.keptScroll));
  check('focusing a block does not yank the viewport', scale.afterFocus === 0, String(scale.afterFocus));
  check('a drag converts pointer pixels to time through the scale, at any zoom',
    scale.trimmed.delta === scale.trimmed.expected, JSON.stringify(scale.trimmed));
  check('…and is still one undo entry', scale.trimmed.entries === 1, String(scale.trimmed.entries));
  check('Fit returns to showing the whole sequence',
    scale.fitted.zoom === 1 && scale.fitted.control === 100, JSON.stringify(scale.fitted));

  /* A clip label is the scene name plus the author's own copy, and it arrives
     from project files other people wrote. It goes into the block's text AND
     its aria-label, so the attribute needs the quotes escaped too. */
  const hostile = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.editClip(0, { label: '"><img src=x onerror=alert(1)>&' }, 'hostile label');
    const b = document.querySelector('#tl-track .tl-clip[data-i="0"]');
    return { injected: !!document.querySelector('#tl-track img'),
             aria: b?.getAttribute('aria-label') || '',
             text: b?.querySelector('.tl-name')?.textContent || '' };
  });
  check('a hostile clip label cannot break out of the track',
    !hostile.injected && hostile.aria.includes('<img src=x') && hostile.text.includes('&'),
    JSON.stringify(hostile));

  const drag = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.editClip(0, { label: 'Terminal / Text · ONE' }, 'restore label');
    S.editClip(0, { in: 0, out: 6 }, 'reset');
    const box = document.getElementById('tl-track');
    const grip = box.querySelector('.tl-clip[data-i="0"] .tl-grip.r');
    const r = grip.getBoundingClientRect();
    const before = S.timeline[0].out;
    const depth0 = S.store.undoDepth;
    const at = (x) => ({ bubbles: true, clientX: x, clientY: r.top + r.height / 2, pointerId: 11 });
    grip.dispatchEvent(new PointerEvent('pointerdown', at(r.left + 2)));
    for (let k = 1; k <= 12; k++) box.dispatchEvent(new PointerEvent('pointermove', at(r.left - k * 5)));
    box.dispatchEvent(new PointerEvent('pointerup', at(r.left - 60)));
    const dragged = S.timeline[0].out;
    const entries = S.store.undoDepth - depth0;
    S.undo();
    return { before, dragged, entries, afterUndo: S.timeline[0].out };
  });
  check('dragging an edge trims the clip', drag.dragged < drag.before, JSON.stringify(drag));
  check('…the whole drag is ONE undo entry', drag.entries === 1, String(drag.entries));
  check('…and undoing it restores the pre-drag trim', drag.afterUndo === drag.before, String(drag.afterUndo));

  /* …INCLUDING A DRAG THAT PAUSES.
     The check above runs twelve pointermoves in one tick, which no 600ms window
     could split. A real drag rests: the pointer stops on a snap, or a heavy
     filter chain stalls the main thread. Coalescing was purely time-based, so a
     pause longer than 600ms started a new undo entry — one gesture became
     several, and undoing it took as many presses as it happened to contain
     pauses. This drives the same gesture with a real wait in the middle, which
     is the only version of it that ever failed. */
  const paused = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    S.editClip(0, { in: 0, out: 6 }, 'reset');
    const box = document.getElementById('tl-track');
    const grip = box.querySelector('.tl-clip[data-i="0"] .tl-grip.r');
    const r = grip.getBoundingClientRect();
    const before = S.timeline[0].out;
    const depth0 = S.store.undoDepth;
    const at = (x) => ({ bubbles: true, clientX: x, clientY: r.top + r.height / 2, pointerId: 12 });
    grip.dispatchEvent(new PointerEvent('pointerdown', at(r.left + 2)));
    for (let k = 1; k <= 4; k++) box.dispatchEvent(new PointerEvent('pointermove', at(r.left - k * 5)));
    await new Promise((res) => setTimeout(res, 800));      // longer than the window
    for (let k = 5; k <= 8; k++) box.dispatchEvent(new PointerEvent('pointermove', at(r.left - k * 5)));
    await new Promise((res) => setTimeout(res, 800));
    for (let k = 9; k <= 12; k++) box.dispatchEvent(new PointerEvent('pointermove', at(r.left - k * 5)));
    box.dispatchEvent(new PointerEvent('pointerup', at(r.left - 60)));
    const dragged = S.timeline[0].out;
    const entries = S.store.undoDepth - depth0;
    S.undo();
    return { before, dragged, entries, afterUndo: S.timeline[0].out,
             gestureOpen: S.store.gestureKey };
  });
  check('a drag that rests twice is still ONE undo entry',
        paused.entries === 1, `${paused.entries} entries`);
  check('…and one undo still restores the pre-drag trim',
        paused.dragged < paused.before && paused.afterUndo === paused.before, JSON.stringify(paused));
  check('…and pointerup closed the gesture', paused.gestureOpen === null, String(paused.gestureOpen));

  const reorder = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const order = () => S.timeline.map((c) => c.label);
    const before = order();
    const box = document.getElementById('tl-track');
    // The spine's lane by name: '.tl-lane' takes the FIRST match, which is the
    // overlay row whenever a V2 clip exists.
    const lane = box.querySelector('.tl-row.spine .tl-lane');
    const block = box.querySelector('.tl-clip[data-i="0"]');
    const lr = lane.getBoundingClientRect(), br = block.getBoundingClientRect();
    const at = (x) => ({ bubbles: true, clientX: x, clientY: br.top + br.height / 2, pointerId: 12 });
    block.dispatchEvent(new PointerEvent('pointerdown', at(br.left + br.width / 2)));
    box.dispatchEvent(new PointerEvent('pointermove', at(lr.right - 10)));
    box.dispatchEvent(new PointerEvent('pointerup', at(lr.right - 10)));
    return { before, after: order() };
  });
  check('dragging a block reorders the sequence',
    reorder.after[reorder.after.length - 1] === reorder.before[0], JSON.stringify(reorder.after));

  const kbd = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.editClip(0, { in: 0, out: 5 }, 'reset');
    const box = document.getElementById('tl-track');
    box.querySelector('.tl-clip[data-i="0"]').focus();
    const start = S.timeline[0].out;
    const held = [];
    for (let k = 0; k < 3; k++) {
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      held.push(!!document.activeElement.closest?.('.tl-clip'));
    }
    return { start, out: S.timeline[0].out, held };
  });
  check('arrow keys trim the focused clip', kbd.out < kbd.start, JSON.stringify(kbd));
  check('…and focus survives the rebuild, so the second press lands too',
    kbd.held.every(Boolean) && +(kbd.start - kbd.out).toFixed(2) === 0.3, JSON.stringify(kbd));

  /* ------------------------------------------------ the clip inspector -- */
  /* The claim this pane exists to make: two clips in one sequence can look
     different from each other. Every look control in the studio is
     document-wide — the VIDEO tab describes the NEXT clip you add — so before
     this, changing a clip already in the sequence meant deleting it and
     building it again. */
  const insp = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const box = document.getElementById('tl-track');
    const pick = (i) => {
      const b = box.querySelector(`.tl-clip[data-i="${i}"]`);
      const r = b.getBoundingClientRect();
      const at = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 21 };
      b.dispatchEvent(new PointerEvent('pointerdown', at));
      box.dispatchEvent(new PointerEvent('pointerup', at));
    };
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return false;
      el.value = String(v);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };

    /* By kind, not by slot: the reorder and split tests above have moved these
       clips around, and only a video clip has copy to edit. */
    const vids = S.timeline.map((c, i) => (c.kind === 'still' ? -1 : i)).filter((i) => i >= 0);
    const [mineIdx, otherIdx] = vids;

    pick(mineIdx);
    const which = document.getElementById('nle-insp-which')?.textContent || '';
    const named = document.getElementById('insp-label')?.value || '';

    // What must NOT move when one clip's copy is edited.
    const tabBefore = document.getElementById('v-text').value;
    const mineBefore = S.timeline[mineIdx].rec['v-text'];
    const neighbourBefore = S.timeline[otherIdx].rec['v-text'];
    const depth0 = S.store.undoDepth;
    set('insp-v-text', 'ONLY THIS CLIP');
    const mine = S.timeline[mineIdx].rec['v-text'];
    const entries = S.store.undoDepth - depth0;
    S.undo();
    const afterUndo = S.timeline[mineIdx].rec['v-text'];

    // A field re-committed at its current value must not stack undo entries.
    const depth1 = S.store.undoDepth;
    set('insp-label', document.getElementById('insp-label').value);
    const noop = S.store.undoDepth - depth1;

    pick(0);
    const firstTransition = !!document.getElementById('insp-transition')?.disabled;
    pick(S.timeline.length - 1);
    const laterTransition = !!document.getElementById('insp-transition')?.disabled;

    /* Source length is two writes — the clip's own, and the recipe's, which is
       where the renderer reads the length from. One without the other gives a
       clip whose tail is a frozen frame. */
    pick(otherIdx);
    const was = { src: S.timeline[otherIdx].src, in: S.timeline[otherIdx].in, out: S.timeline[otherIdx].out,
                  dur: S.timeline[otherIdx].rec['v-dur'] };
    set('insp-src', 12);
    const grown = { src: S.timeline[otherIdx].src, dur: S.timeline[otherIdx].rec['v-dur'] };
    S.editClip(otherIdx, { ...was, rec: { ...S.timeline[otherIdx].rec, 'v-dur': was.dur } }, 'restore');

    /* The editor is the only layout now, so every one of its panes must be a
       live grid item. (Before the classic layout was removed, this asserted
       the reverse: that turning the editor off left none of them behind.) */
    const paneGone = ['nle-bin', 'nle-transport', 'nle-timeline', 'nle-inspector']
      .filter((id) => {
        const n = document.getElementById(id);
        return !n || getComputedStyle(n).display === 'none';
      });

    const pane = document.getElementById('nle-inspector');
    const stage = document.querySelector('.view.active .panel.stagewrap');
    const pr = pane?.getBoundingClientRect(), sr = stage?.getBoundingClientRect();
    return {
      which, named, expectWhich: `${mineIdx + 1} / ${S.timeline.length}`, label1: S.timeline[mineIdx].label,
      mine, tabAfter: document.getElementById('v-text').value, tabBefore,
      neighbourBefore, neighbourAfter: S.timeline[otherIdx].rec['v-text'],
      entries, mineBefore, afterUndo, noop, firstTransition, laterTransition, grown,
      paneGone, editor: document.body.classList.contains('nle'),
      visible: pane ? getComputedStyle(pane).display !== 'none' : false,
      rightOfStage: !!(pr && sr) && pr.left >= sr.right - 1,
    };
  });
  check('selecting a clip shows that clip in the inspector',
    insp.which === insp.expectWhich && insp.named === insp.label1,
    JSON.stringify({ w: insp.which, expected: insp.expectWhich, n: insp.named }));
  check('editing a clip’s copy changes THAT clip — the point of the whole pane',
    insp.mine === 'ONLY THIS CLIP', insp.mine);
  check('…and leaves its neighbour alone, so a sequence can hold two different looks',
    insp.neighbourAfter === insp.neighbourBefore, JSON.stringify({ before: insp.neighbourBefore, after: insp.neighbourAfter }));
  check('…and does not write back to the tab the clip was captured from',
    insp.tabAfter === insp.tabBefore, JSON.stringify({ before: insp.tabBefore, after: insp.tabAfter }));
  check('…as one undoable document command, like every other edit',
    insp.entries === 1 && insp.afterUndo === insp.mineBefore,
    JSON.stringify({ e: insp.entries, undone: insp.afterUndo, was: insp.mineBefore }));
  check('re-committing an unchanged field adds nothing to the undo stack', insp.noop === 0, String(insp.noop));
  check('the first clip’s transition is offered but disabled — it has nothing to come in from',
    insp.firstTransition && !insp.laterTransition,
    JSON.stringify({ first: insp.firstTransition, later: insp.laterTransition }));
  check('setting a clip’s source length lengthens the recipe inside it too',
    insp.grown.src === 12 && insp.grown.dur === '12', JSON.stringify(insp.grown));
  check('the editor layout is permanent and every editor pane is live',
    insp.editor && insp.paneGone.length === 0, insp.paneGone.join(', ') || 'all live');
  /* ------------------------------------------------- the overlay track -- */
  /* A second track is only worth having if what it draws is composited with
     what is underneath. These scenes are bright marks on a near-black ground
     and the pipeline has no alpha channel, so at normal blend an overlay would
     simply REPLACE the picture — a cut with extra steps. Screen is what makes
     it an overlay. */
  const v2 = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const lit = (ctx, W, H) => {
      const d = ctx.getImageData(0, 0, W, H).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) n++;
      return n;
    };
    const frameAt = (T, sched) => {
      const c = document.createElement('canvas');
      c.width = sched.tl.W; c.height = sched.tl.H;
      const ctx = c.getContext('2d');
      S.renderTimelineFrame(ctx, T, sched);
      return { ctx, W: c.width, H: c.height };
    };

    const spineOnly = S.buildSchedule();
    const baseT = spineOnly.starts[0] + 0.5;
    const before = (() => { const f = frameAt(baseT, spineOnly); return lit(f.ctx, f.W, f.H); })();

    // An overlay over the first clip, at the same moment, fully faded in.
    S.addOverlayClip(baseT - 0.5);
    const i = S.timeline.length - 1;
    S.editClip(i, { transition: 'cut', out: Math.min(S.timeline[i].src, 3) }, 'overlay setup');
    const withOverlay = S.buildSchedule();
    const screened = (() => { const f = frameAt(baseT, withOverlay); return lit(f.ctx, f.W, f.H); })();

    // The same overlay at zero opacity must leave the picture exactly as it was.
    S.editClip(i, { opacity: 0 }, 'invisible');
    const invisible = (() => { const f = frameAt(baseT, S.buildSchedule()); return lit(f.ctx, f.W, f.H); })();
    S.editClip(i, { opacity: 1 }, 'visible again');

    /* Away from the overlay's own window the spine is untouched. Compared at
       the SAME instant with the overlay visible and invisible — two different
       times are two different pictures even without an overlay, because a scene
       animates. */
    const sched = S.buildSchedule();
    const away = sched.starts[i] + (S.timeline[i].out - S.timeline[i].in) + 0.4;
    let afterIt = null;
    if (away < sched.duration) {
      const withIt = (() => { const f = frameAt(away, sched); return lit(f.ctx, f.W, f.H); })();
      S.editClip(i, { opacity: 0 }, 'hide');
      const withoutIt = (() => { const f = frameAt(away, S.buildSchedule()); return lit(f.ctx, f.W, f.H); })();
      S.editClip(i, { opacity: 1 }, 'show');
      afterIt = { withIt, withoutIt };
    }

    /* The lane: an overlay lives on its own row, and dragging its body moves it
       in TIME rather than reordering it. On the spine the same gesture reorders
       — the tracks mean different things, so the drag has to as well. */
    const box = document.getElementById('tl-track');
    const row = box.querySelector('.tl-row.overlay');
    const onOverlayRow = !!row?.querySelector(`.tl-clip[data-i="${i}"]`);
    const rows = box.querySelectorAll('.tl-row').length;
    const blk = box.querySelector(`.tl-clip[data-i="${i}"]`);
    const br = blk.getBoundingClientRect();
    const at0 = S.timeline[i].at;
    const orderBefore = S.timeline.map((c) => c.label).join('|');
    const pt = (x) => ({ bubbles: true, clientX: x, clientY: br.top + br.height / 2, pointerId: 41 });
    blk.dispatchEvent(new PointerEvent('pointerdown', pt(br.left + br.width / 2)));
    box.dispatchEvent(new PointerEvent('pointermove', pt(br.left + br.width / 2 + 60)));
    box.dispatchEvent(new PointerEvent('pointerup', pt(br.left + br.width / 2 + 60)));
    const slid = { at0, at1: S.timeline[i].at, track: S.timeline[i].track,
                   order: S.timeline.map((c) => c.label).join('|') === orderBefore };
    S.editClip(i, { at: at0 }, 'put it back');

    const spineDur = spineOnly.duration;
    const overlayStart = sched.starts[i];
    // A blend left set on the context would tint everything drawn after it,
    // including the next frame on the export path.
    const probe = document.createElement('canvas').getContext('2d');
    S.renderTimelineFrame(probe, baseT, sched);
    const composite = probe.globalCompositeOperation;

    S.editClip(i, { track: 'V1' }, 'demote');       // leave the sequence single-track
    const demoted = { track: S.timeline[i].track, at: S.timeline[i].at };
    return { before, screened, invisible, afterIt, spineDur, onOverlayRow, rows, slid,
             dur: sched.duration, overlayStart, composite, demoted };
  });
  check('an overlay composites over the spine rather than replacing it',
    v2.screened > v2.before, JSON.stringify({ spine: v2.before, withOverlay: v2.screened }));
  check('…at zero opacity it leaves the picture exactly as it was',
    v2.invisible === v2.before, JSON.stringify({ base: v2.before, invisible: v2.invisible }));
  check('…and outside its own window it changes nothing at all',
    v2.afterIt === null || v2.afterIt.withIt === v2.afterIt.withoutIt, JSON.stringify(v2.afterIt));
  check('an overlay gets a lane of its own above the spine',
    v2.onOverlayRow && v2.rows === 2, JSON.stringify({ rows: v2.rows, onRow: v2.onOverlayRow }));
  check('dragging an overlay slides it in time and does not reorder the sequence',
    v2.slid.at1 > v2.slid.at0 && v2.slid.track === 'V2' && v2.slid.order, JSON.stringify(v2.slid));
  check('an overlay does not lengthen the spine it sits over',
    v2.dur === v2.spineDur, JSON.stringify({ spine: v2.spineDur, withOverlay: v2.dur }));
  check('the overlay sits where it was put, not at the end of the queue',
    v2.overlayStart === 0, String(v2.overlayStart));
  check('the blend is not left set on the context for whatever draws next',
    v2.composite === 'source-over', v2.composite);
  check('demoting an overlay to the spine drops its stored start',
    v2.demoted.track === 'V1' && v2.demoted.at === 0, JSON.stringify(v2.demoted));

  /* ---------------------------------------------------- the audio lane -- */
  /* Sound as clips placed in time, in their own array and their own lane. The
     claims that matter are about the MIXDOWN — a lane that shows up on screen
     and not in the export is worse than no lane. */
  const lane = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const src = S.library.find((it) => it.kind === 'music' && it.blob && it.key);
    if (!src) return { skipped: 'no rendered sound in the library' };
    const choice = 'lib:' + src.key;

    const rms = (buf) => {
      if (!buf) return null;
      const out = [];
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        let s = 0;
        for (let i = 0; i < d.length; i++) s += d[i] * d[i];
        out.push(Math.sqrt(s / d.length));
      }
      return out;
    };
    /* Energy in a window, so "the sound is where it was placed" can be asserted
       rather than merely "there is sound somewhere". */
    const energyIn = (buf, from, to) => {
      const d = buf.getChannelData(0);
      const a = Math.floor(from * buf.sampleRate), b = Math.min(d.length, Math.floor(to * buf.sampleRate));
      let s = 0;
      for (let i = a; i < b; i++) s += d[i] * d[i];
      return s;
    };

    const pictureOnly = S.buildSchedule().duration;
    S.commitAudioClips([], 'reset');

    // Placed at 2s, two seconds long, on a sequence with picture of its own.
    S.addAudioClip({ source: choice, at: 2, seconds: 2 });
    const sched = S.buildSchedule();
    const mixed = await S.sequenceMix(sched);
    const placed = mixed ? {
      before: energyIn(mixed, 0, 1.8),
      during: energyIn(mixed, 2.1, 3.8),
      rate: mixed.sampleRate,
      channels: mixed.numberOfChannels,
    } : null;

    // Gain is real arithmetic on the samples, not a label.
    S.editAudioClip(0, { gain: 0.25 }, 'quieter');
    const quiet = rms(await S.sequenceMix(S.buildSchedule()));
    S.editAudioClip(0, { gain: 1 }, 'back');
    const loud = rms(await S.sequenceMix(S.buildSchedule()));

    // A pan makes the mixdown stereo and pushes the energy to one side.
    S.editAudioClip(0, { pan: -1 }, 'hard left');
    const panned = await S.sequenceMix(S.buildSchedule());
    const sides = panned && panned.numberOfChannels === 2 ? rms(panned) : null;
    S.editAudioClip(0, { pan: 0 }, 'centre');

    // Mute silences it without changing how long the sequence is.
    const durBefore = S.buildSchedule().duration;
    S.editAudioClip(0, { mute: true }, 'mute');
    const mutedMix = await S.sequenceMix(S.buildSchedule());
    const mutedDur = S.buildSchedule().duration;
    S.editAudioClip(0, { mute: false }, 'unmute');

    // Sound past the picture extends the sequence rather than being cut off.
    S.editAudioClip(0, { at: Math.max(4, pictureOnly + 2) }, 'past the end');
    const extended = S.buildSchedule();

    // The lane is on screen, in its own row, with its own class.
    const rows = document.querySelectorAll('#tl-track .tl-row').length;
    const aRow = !!document.querySelector('#tl-track .tl-row.audio .tl-aclip');
    const notAClip = document.querySelectorAll('#tl-track .tl-clip[data-lane="A"]').length;
    const labelled = [...document.querySelectorAll('.tl-aclip')]
      .every((b) => /Sound \d+, .+ seconds at [\d.]+ seconds/.test(b.getAttribute('aria-label') || ''));

    // A hostile label cannot break out of the lane.
    S.editAudioClip(0, { label: '"><img src=x onerror=alert(1)>&' }, 'hostile');
    const injected = !!document.querySelector('#tl-track img');
    const aria = document.querySelector('.tl-aclip')?.getAttribute('aria-label') || '';

    // The document round-trips it.
    S.editAudioClip(0, { label: 'Slam', at: 1.5, gain: 0.6, pan: 0.4, loop: true }, 'set');
    const before = JSON.stringify(S.store.get('timeline.audio'));
    S.applyProject(JSON.parse(JSON.stringify(S.readProject())));
    const after = JSON.stringify(S.store.get('timeline.audio'));

    const depth0 = S.store.undoDepth;
    S.editAudioClip(0, { gain: 0.9 }, 'one edit');
    const entries = S.store.undoDepth - depth0;
    S.undo();
    const undone = S.audioTimeline[0]?.gain;

    /* The waveform thumbnail is a cached data URI painted onto the block after
       an async decode — so it is checked after a wait, and by its prefix, which
       is the one thing that cannot be true unless the whole chain ran. */
    S.editAudioClip(0, { at: 0 }, 'home');
    await new Promise((r) => setTimeout(r, 2500));
    const blk = document.querySelector('.tl-aclip');
    const thumb = {
      keyed: !!blk?.dataset.thumbKey,
      painted: (blk?.style.backgroundImage || '').startsWith('url("data:image/png'),
    };

    S.commitAudioClips([], 'clean up');
    return { thumb, placed, quiet, loud, sides, mutedMix: mutedMix ? rms(mutedMix) : null,
             durBefore, mutedDur, pictureOnly, extended: extended.duration,
             rows, aRow, notAClip, labelled, injected, aria,
             roundTrip: before === after, before, entries, undone };
  });
  if (lane.skipped) {
    check('the audio lane mixes into the sequence', true, 'SKIPPED — ' + lane.skipped);
  } else {
    check('a sound plays where it was placed, not at zero',
      lane.placed && lane.placed.during > lane.placed.before * 4,
      JSON.stringify(lane.placed));
    check('…and the mixdown is 48kHz, which is the only rate the encoder can honestly carry',
      lane.placed && lane.placed.rate === 48000, String(lane.placed?.rate));
    check('gain is arithmetic on the samples, not a label',
      lane.quiet && lane.loud && lane.quiet[0] < lane.loud[0] * 0.6,
      JSON.stringify({ quiet: lane.quiet, loud: lane.loud }));
    check('a pan widens the mixdown to stereo and moves the energy off centre',
      lane.sides && Math.abs(lane.sides[0] - lane.sides[1]) > 1e-4, JSON.stringify(lane.sides));
    check('mute silences the sound', lane.mutedMix === null || lane.mutedMix[0] < 1e-6,
      JSON.stringify(lane.mutedMix));
    check('…without changing how long the sequence is, so the picture does not jump',
      lane.mutedDur === lane.durBefore, JSON.stringify({ before: lane.durBefore, muted: lane.mutedDur }));
    check('sound past the end of the picture extends the sequence rather than being cut off',
      lane.extended > lane.pictureOnly, JSON.stringify({ picture: lane.pictureOnly, withSound: lane.extended }));
    check('a sound gets its own lane and its own class, so nothing written for clips claims it',
      lane.rows >= 2 && lane.aRow && lane.notAClip === 0,
      JSON.stringify({ rows: lane.rows, inAudioRow: lane.aRow, mislabelled: lane.notAClip }));
    check('…and every sound announces itself, including when it plays', lane.labelled);
    check('a hostile sound label cannot break out of the lane',
      !lane.injected && lane.aria.includes('<img src=x'), lane.aria.slice(0, 60));
    check('the lane survives a project round trip', lane.roundTrip, lane.before);
    check('a sound edit is one undoable command', lane.entries === 1 && lane.undone === 0.6,
      JSON.stringify({ entries: lane.entries, undone: lane.undone }));
    check('a sound draws its own waveform on the lane',
      lane.thumb.keyed && lane.thumb.painted, JSON.stringify(lane.thumb));
  }

  /* Decoded audio is cached by library KEY, and replaceItem() deliberately
     reuses a key when it supersedes a take nobody has looked at. So a second
     RENDER writes new bytes under the old key — and a cache with no
     invalidation would go on exporting the PREVIOUS take, silently. */
  const staleCache = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const bed = await import('./src/audio/bed.js');
    const row = S.library.find((it) => it.kind === 'music' && it.blob && it.key);
    if (!row) return { skipped: true };
    const choice = 'lib:' + row.key;
    const energy = async () => {
      const b = await bed.renderSource(choice, 1, { loop: false });
      if (!b) return null;
      const d = b.getChannelData(0);
      let s = 0;
      for (let i = 0; i < d.length; i++) s += d[i] * d[i];
      return Math.round(s * 1000) / 1000;
    };
    const first = await energy();
    // Same key, different bytes: silence where there was sound.
    const silent = new Float32Array(row.seconds ? Math.ceil(row.seconds * 8000) : 8000);
    const { encodeWav } = await import('./src/audio/wav.js');
    const blob = encodeWav([silent], 8000, 16);
    S.library.find((it) => it.key === row.key).blob = blob;
    const { notifyLibrary } = await import('./src/library/library.js');
    const { assetBlob } = await import('./src/library/library.js');
    // Mirror what replaceItem does to the byte store, then announce it.
    void assetBlob;
    notifyLibrary();
    await new Promise((r) => setTimeout(r, 50));
    const second = await energy();
    return { first, second };
  });
  if (staleCache.skipped) {
    check('a replaced asset is re-decoded rather than served from cache', true, 'SKIPPED — no music row');
  } else {
    check('a replaced asset is re-decoded rather than served from cache',
      staleCache.first !== staleCache.second, JSON.stringify(staleCache));
  }

  /* ------------------------------------------------ per-clip keyframes -- */
  /* A clip has always carried its own curves; there was no way to edit them
     after the clip existed. The claim that matters is INDEPENDENCE: editing one
     clip's curve must not touch the document-wide automation, and must not be
     undone by taking a fresh recipe from the tab. */
  const curves = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const box = document.getElementById('tl-track');
    const pick = (i) => {
      const b = box.querySelector(`.tl-clip[data-i="${i}"]`);
      const r = b.getBoundingClientRect();
      const at = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 61 };
      b.dispatchEvent(new PointerEvent('pointerdown', at));
      box.dispatchEvent(new PointerEvent('pointerup', at));
    };
    const vids = S.timeline.map((c, i) => (c.kind === 'still' ? -1 : i)).filter((i) => i >= 0);
    const [mine, other] = vids;

    // Park the playhead inside the clip so the panel will key at all.
    const sched = S.buildSchedule();
    const scrub = document.getElementById('tl-scrub');
    scrub.value = String(Math.round(((sched.starts[mine] + 0.3) / sched.total) * 1000));
    scrub.dispatchEvent(new Event('input', { bubbles: true }));
    pick(mine);

    const panel = () => !!document.getElementById('insp-curve-param');
    const rows = () => document.querySelectorAll('#nle-insp-body table.keyframes tbody tr').length;
    const before = { panel: panel(), rows: rows() };

    /* Wait for the CONDITION, not for a number of milliseconds.
       Both checks below used a flat 60ms and both went red on a loaded CI
       runner while passing locally — with `entries: 1`, which says the document
       write landed and only the repaint had not happened yet. A fixed sleep
       turns "does the panel repaint" into "does the panel repaint faster than
       this machine's worst moment", which is a different question and not the
       one being asked. The assertion is unchanged in strength: if the signature
       guard were missing the row would never appear and this would time out. */
    const settle = async (pred, ms = 4000) => {
      const t0 = Date.now();
      while (!pred() && Date.now() - t0 < ms) await new Promise((r) => requestAnimationFrame(r));
      return pred();
    };

    const autoBefore = JSON.stringify(S.store.get('automation.video') || {});
    const depth0 = S.store.undoDepth;
    document.getElementById('insp-curve-value').value = '77';
    document.getElementById('insp-curve-key').click();
    const repainted = await settle(() => rows() > before.rows);

    const param = document.getElementById('insp-curve-param').value;
    const keyed = S.timeline[mine].rec?.__auto?.[param] || [];
    const neighbour = S.timeline[other]?.rec?.__auto?.[param] || [];
    const after = { rows: rows(), entries: S.store.undoDepth - depth0 };
    const autoAfter = JSON.stringify(S.store.get('automation.video') || {});

    // "Update from VIDEO" must not be a silent delete of what was just drawn.
    const send = document.getElementById('insp-recapture');
    if (send) send.click();
    // Recapture rewrites the clip's recipe; settle on the rewrite having been
    // applied rather than on a stopwatch, for the reason given above.
    await settle(() => S.timeline[mine].rec?.__auto?.[param] !== undefined, 2000);
    const survived = (S.timeline[mine].rec?.__auto?.[param] || []).length;

    // A still has no automation and must not be offered any.
    const stillIdx = S.timeline.findIndex((c) => c.kind === 'still');
    let stillPanel = null;
    if (stillIdx >= 0) { pick(stillIdx); stillPanel = panel(); }

    pick(mine);
    const cleared = (() => {
      document.getElementById('insp-curve-clear')?.click();
      return (S.timeline[mine].rec?.__auto?.[param] || []).length;
    })();
    return { before, keyed: keyed.length, keyedValue: keyed[0]?.v, neighbour: neighbour.length,
             after, autoUntouched: autoBefore === autoAfter, survived, stillPanel, cleared, param,
             repainted };
  });
  check('a video clip gets a keyframe panel of its own', curves.before.panel);
  check('keying writes a curve onto THAT clip', curves.keyed === 1 && curves.keyedValue === 77,
    JSON.stringify({ keys: curves.keyed, value: curves.keyedValue }));
  check('…and not onto its neighbour', curves.neighbour === 0, String(curves.neighbour));
  /* The independence claim: a per-clip curve is not the document-wide
     automation editor writing through a different control. */
  check('…and not onto the document-wide automation the VIDEO tab edits', curves.autoUntouched);
  check('…as one undoable command', curves.after.entries === 1, String(curves.after.entries));
  /* The signature guard: rec.__auto changed but no FIELD did, so without
     curvesSignature in the signature the panel would sit frozen. */
  check('the key list repaints on its own, rather than looking frozen',
    curves.repainted && curves.after.rows > curves.before.rows,
    JSON.stringify({ ...curves.after, repainted: curves.repainted }));
  check('"Update from VIDEO" keeps the curves the author drew here', curves.survived === 1,
    String(curves.survived));
  check('a still is offered no keyframes, having no automation to give',
    curves.stillPanel === null || curves.stillPanel === false, String(curves.stillPanel));
  check('clearing removes them again', curves.cleared === 0, String(curves.cleared));

  /* --------------------------------------- settings sections + export -- */
  /* Two usability defects, measured. The settings column was one scroll —
     7.1 screens on VIDEO, 13.4 on AUDIO — and getting a finished render OUT of
     the tool meant noticing a toast, finding the LIBRARY tab and finding the
     row. */
  const shell = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const panelOf = (v) => document.querySelector(`#${v} .grid > .panel:not(.stagewrap)`);
    /* Content height, in pixels, not "screens" — a ratio against the viewport
       measures the window as much as the panel, and this suite runs in a
       shorter one than a person uses. */
    const contentPx = (v) => panelOf(v)?.scrollHeight ?? 0;
    const allSectionsPx = (v) => {
      const p = panelOf(v);
      if (!p) return 0;
      const hidden = [...p.querySelectorAll('.section-hidden')];
      hidden.forEach((f) => f.classList.remove('section-hidden'));
      const px = p.scrollHeight;
      hidden.forEach((f) => f.classList.add('section-hidden'));
      return px;
    };
    const out = { sections: {}, depth: {} };
    for (const v of ['video', 'image', 'audio']) {
      document.querySelector(`.tab[data-view="${v}"]`).click();
      await new Promise((r) => setTimeout(r, 80));
      out.sections[v] = S.sectionsOf(`view-${v}`);
      /* The WORST section, not whichever one happens to be showing: the claim
         is that no part of the panel is a scrolling marathon, and measuring the
         one that is open would let the worst group hide behind a good one. */
      const whole = allSectionsPx(`view-${v}`);
      let worst = 0;
      for (const name of out.sections[v]) {
        S.showSection(`view-${v}`, name);
        await new Promise((r) => setTimeout(r, 30));
        worst = Math.max(worst, contentPx(`view-${v}`));
      }
      S.showSection(`view-${v}`, out.sections[v][0]);
      out.depth[v] = { worstPx: worst, wholePx: whole, share: +(worst / Math.max(1, whole)).toFixed(2) };
    }

    // One section at a time, and the strip says which.
    document.querySelector('.tab[data-view="video"]').click();
    S.showSection('view-video', 'Look');
    const lookShown = !document.querySelector('#v-scan')?.closest('fieldset').classList.contains('section-hidden');
    const fxHidden = !!document.querySelector('#v-scan')?.closest('fieldset').classList.contains('section-hidden');
    const pressed = [...document.querySelectorAll('#sec-view-video button')]
      .filter((b) => b.getAttribute('aria-pressed') === 'true').length;

    /* A jump must be able to reach a control in a section that is not showing,
       or Ctrl+K silently stops working for two thirds of the settings. */
    const pal = await import('./src/ui/palette.js');
    pal.revealControl('v-scan', 'video');
    const revealed = !document.querySelector('#v-scan').closest('fieldset').classList.contains('section-hidden');
    const nowShowing = S.activeSection('view-video');
    S.showSection('view-video', 'Look');

    /* The page has exactly ONE tablist. The section strip is a segmented button
       group on purpose — a second tablist would mean two "selected" tabs. */
    const tablists = document.querySelectorAll('[role="tablist"]').length;
    const roleTabs = document.querySelectorAll('[role="tab"]').length;

    // Export: one obvious control, and it follows the workspace.
    const btn = document.getElementById('nle-export');
    const labels = {};
    for (const v of ['video', 'image', 'audio', 'timeline']) {
      document.querySelector(`.tab[data-view="${v}"]`).click();
      await new Promise((r) => setTimeout(r, 60));
      labels[v] = btn.textContent.trim();
    }

    // And every finished render carries its own download.
    const dls = [...document.querySelectorAll('.nle-bin-dl')];
    const named = dls.every((d) => /^Download .+\..+$/.test(d.getAttribute('aria-label') || '')
      || /unavailable/.test(d.getAttribute('aria-label') || ''));
    return { ...out, lookShown, fxHidden, pressed, revealed, nowShowing, tablists, roleTabs,
             labels, bin: dls.length, named, exportVisible: !!btn && !btn.disabled };
  });
  check('the settings column is grouped into sections rather than one long scroll',
    shell.sections.video.length >= 3 && shell.sections.audio.length >= 4,
    JSON.stringify(shell.sections));
  /* The measurement that is the whole point. Every one of these panels used to
     present ALL of its content at once — 7.1 screens of scroll on VIDEO, 13.4
     on AUDIO at a normal window size. Now the biggest single section is a
     fraction of the panel's total content, whatever the window. */
  check('…so the biggest section is a fraction of the whole panel, not all of it',
    Object.values(shell.depth).every((d) => d.share < 0.6 && d.wholePx > 0),
    JSON.stringify(shell.depth));
  check('one section shows at a time, and exactly one button says so',
    shell.lookShown === false && shell.fxHidden === true && shell.pressed === 1,
    JSON.stringify({ fxHidden: shell.fxHidden, pressed: shell.pressed }));
  check('the palette can still reach a control in a section that is not showing',
    shell.revealed && shell.nowShowing === 'FX',
    JSON.stringify({ revealed: shell.revealed, section: shell.nowShowing }));
  check('the page still has exactly one tablist — the section strip is not a second one',
    shell.tablists === 1 && shell.roleTabs >= 7,
    JSON.stringify({ tablists: shell.tablists, tabs: shell.roleTabs }));
  check('there is one export button, and it says what it will export',
    shell.exportVisible && shell.labels.video.includes('CLIP') && shell.labels.timeline.includes('SEQUENCE')
    && shell.labels.audio.includes('SOUND') && shell.labels.image.includes('SCREEN'),
    JSON.stringify(shell.labels));
  check('every finished render carries its own download, named for the file',
    shell.bin > 0 && shell.named, JSON.stringify({ items: shell.bin, named: shell.named }));

  /* ------------------------------------------------------- importing -- */
  /* Import used to be one slot per kind: a second video replaced the first,
     nothing persisted, nothing appeared in the library. A file is a library row
     now, which is what makes footage usable more than once. */
  const imported = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const before = S.library.length;

    // A real PNG, built here so the test carries no fixture.
    const c = document.createElement('canvas');
    c.width = 40; c.height = 24;
    const cx = c.getContext('2d');
    cx.fillStyle = '#c0ffee'; cx.fillRect(0, 0, 40, 24);
    const png = await new Promise((r) => c.toBlob(r, 'image/png'));

    // A real WAV, through the studio's own encoder.
    const { encodeWav } = await import('./src/audio/wav.js');
    const tone = new Float32Array(8000);
    for (let i = 0; i < tone.length; i++) tone[i] = Math.sin(i / 12) * 0.5;
    const wav = encodeWav([tone], 8000, 16);

    const files = [
      new File([png], 'A Still.png', { type: 'image/png' }),
      new File([wav], 'Room Tone.wav', { type: 'audio/wav' }),
      new File([new Blob(['not media'])], 'notes.txt', { type: 'text/plain' }),
    ];
    const report = await S.importDroppedFiles(files);

    const rows = S.library.slice(before);
    const img = rows.find((r) => r.kind === 'image');
    const snd = rows.find((r) => r.kind === 'music');

    // It reaches the DOCUMENT, which is what makes it survive a reload.
    const inDoc = (S.store.get('library') || []).filter((r) => rows.some((x) => x.key === r.key)).length;

    // And the bin shows them, with a download each.
    const binNames = [...document.querySelectorAll('.nle-bin-name')].map((n) => n.textContent);
    const glyphs = [...document.querySelectorAll('.nle-bin-thumb')].map((n) => n.textContent).filter(Boolean);

    // Using a sound points the audio lane at it rather than opening a list.
    S.useAsset(snd);
    const lanePick = document.getElementById('tl-asrc')?.value;

    return {
      added: report.added.length, failed: report.failed,
      imgKind: img?.kind, imgThumb: !!img?.thumb, imgName: img?.name,
      sndKind: snd?.kind, sndSeconds: snd?.seconds ? +snd.seconds.toFixed(1) : 0,
      inDoc, binHasBoth: binNames.some((n) => /still/i.test(n)) && binNames.some((n) => /room/i.test(n)),
      musicGlyph: glyphs.includes('♪'), lanePick,
    };
  });
  check('dropped files become library rows', imported.added === 2,
    JSON.stringify({ added: imported.added, failed: imported.failed }));
  check('…classified by kind, named from the file',
    imported.imgKind === 'image' && imported.sndKind === 'music' && /still/i.test(imported.imgName || ''),
    JSON.stringify({ img: imported.imgKind, name: imported.imgName, snd: imported.sndKind }));
  check('…with a poster frame for the picture and a duration for the sound',
    imported.imgThumb && imported.sndSeconds > 0,
    JSON.stringify({ thumb: imported.imgThumb, seconds: imported.sndSeconds }));
  /* The whole point of a row rather than a slot: it is in the document, so it
     survives a reload and travels with the project. */
  check('…and they reach the document, so they survive a reload', imported.inDoc === 2, String(imported.inDoc));
  check('one file it cannot use costs that file, not the batch',
    imported.failed.length === 1 && /notes\.txt/.test(imported.failed[0].name),
    JSON.stringify(imported.failed));
  check('the media bin shows them both', imported.binHasBoth);
  /* The library's kinds are videos|music|image — the bin was checking for
     'audio', which is not one of them, so every sound wore the video glyph. */
  check('…and a sound looks like a sound', imported.musicGlyph);
  check('using an imported sound points the audio lane at it',
    /^lib:/.test(imported.lanePick || ''), imported.lanePick);

  /* --------------------------------------------- footage as real clips -- */
  /* The videoin scene drew from ONE module-level element, so a sequence with
     two footage clips played the same file twice — right while you built each
     clip, wrong the moment you had two. A clip carries its own source now. */
  const footage = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const { videoSourceCount, MAX_VIDEO_SOURCES, ensureVideoSource } = await import('./src/video/sources.js');

    /* Two distinct clips, encoded here so the test carries no fixture: one
       mostly red, one mostly blue, so "which file is this" is answerable from
       the pixels. */
    const make = async (rgb) => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 48;
      const cx = c.getContext('2d');
      const stream = c.captureStream(10);
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.start();
      for (let i = 0; i < 8; i++) {
        cx.fillStyle = rgb; cx.fillRect(0, 0, 64, 48);
        await new Promise((r) => setTimeout(r, 40));
      }
      await new Promise((r) => { rec.onstop = r; rec.stop(); });
      return new Blob(chunks, { type: 'video/webm' });
    };

    const red = await make('#ff0000');
    const blue = await make('#0000ff');
    const report = await S.importDroppedFiles([
      new File([red], 'Red Take.webm', { type: 'video/webm' }),
      new File([blue], 'Blue Take.webm', { type: 'video/webm' }),
    ]);
    if (report.added.length !== 2) return { skipped: `imported ${report.added.length}` };
    const [rRow, bRow] = report.added;

    /* Appended to whatever the sequence already holds, and measured from
       there. Clearing it via store.apply would write the document without
       re-projecting the live list, which is a test that measures the wrong
       clips — and the clips before these belong to other checks. */
    const before = S.timeline.length;
    await S.dropAsset(rRow, 0);
    await S.dropAsset(bRow, 0);

    const clips = S.timeline.slice(before);
    const keys = clips.map((c) => c.rec?.['v-srckey'] || '');
    // Each clip captured its OWN file.
    const distinct = new Set(keys).size;

    await ensureVideoSource(rRow.key);
    await ensureVideoSource(bRow.key);
    await new Promise((r) => setTimeout(r, 400));

    /* Both cut, so a frame sampled inside a clip is that clip alone. A default
       crossfade is 0.6s and these clips are about a second, so every sample
       point would otherwise be a blend of two clips and the comparison would be
       measuring the transition. */
    S.editClip(before, { transition: 'cut' }, 'cut');
    S.editClip(before + 1, { transition: 'cut' }, 'cut');

    // Render each clip and ask what colour it is.
    const sched = S.buildSchedule();
    const colourAt = (T) => {
      const c = document.createElement('canvas');
      c.width = sched.tl.W; c.height = sched.tl.H;
      const ctx = c.getContext('2d');
      S.renderTimelineFrame(ctx, T, sched);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
    };
    const first = colourAt(sched.starts[before] + 0.2);
    const second = colourAt(sched.starts[before + 1] + 0.2);

    /* Colour alone cannot prove this: the CRT/VHS stack tints everything it
       draws, so "is it red" is a question about the filters. The claim is that
       the KEY decides what is drawn — so point the second clip at the first
       one's file and the two frames must become the same picture. */
    S.editClip(before + 1, { rec: { ...S.timeline[before + 1].rec, 'v-srckey': keys[0] } }, 'same source');
    await new Promise((r) => setTimeout(r, 200));
    const sched2 = S.buildSchedule();
    const sameSource = (() => {
      const c = document.createElement('canvas');
      c.width = sched2.tl.W; c.height = sched2.tl.H;
      const ctx = c.getContext('2d');
      S.renderTimelineFrame(ctx, sched2.starts[before + 1] + 0.2, sched2);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
    })();

    const pool = { count: videoSourceCount(), cap: MAX_VIDEO_SOURCES };
    return { keys, distinct, first, second, sameSource, pool, added: report.added.length, before };
  });
  if (footage.skipped) {
    check('a sequence can cut between two different files', true, 'SKIPPED — ' + footage.skipped);
  } else {
    check('dropping footage on the lane makes a clip that carries THAT file',
      footage.distinct === 2 && footage.keys.every((k) => /^lib:/.test(k)),
      JSON.stringify(footage.keys));
    /* The assertion the old single-slot model could not pass. Stated as a
       difference rather than as a colour, because the filter stack decides the
       colour and the source decides the picture. */
    const near = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 12;
    check('…so a sequence cuts between two different files, not the same one twice',
      !near(footage.first, footage.second),
      JSON.stringify({ first: footage.first, second: footage.second }));
    check('…and pointing the second clip at the first one’s file makes them match',
      near(footage.sameSource, footage.first),
      JSON.stringify({ repointed: footage.sameSource, first: footage.first }));
    check('…and the decoder pool stays within its cap',
      footage.pool.count > 0 && footage.pool.count <= footage.pool.cap, JSON.stringify(footage.pool));
  }

  /* FOOTAGE THAT WILL NOT DECODE IS ASKED ONCE.
     `_loading` stopped a CONCURRENT second attempt and nothing stopped the next
     one, so a failure left no trace and the synchronous lookup in videoSource()
     asked again on the following preview frame: a new <video>, a new blob URL
     held through an 8-second timeout, and a log line, every frame — while the
     docblock promised the failure was "reported once". Measured over twenty
     frames of preview: 20 extra elements before, 0 after.

     Driven one frame at a time WITH THE GAP ELAPSING, which matters: asking
     sixty times inside one tick is suppressed by `_loading` and hides the whole
     defect. The first version of this check did exactly that and saw one extra
     element instead of twenty. */
  const undecodable = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const V = await import('./src/video/sources.js');
    const L = await import('./src/library/library.js');
    V.clearVideoSources();
    S.clearLibrary();

    const junk = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'video/mp4' });
    const keyOf = (name) => {
      L.addToLibrary(junk(), 'mp4', 'video', name, 2);
      return L.library.at(-1).key;
    };
    const key = keyOf('undecodable');

    let made = 0;
    const realCreate = document.createElement.bind(document);
    document.createElement = (tag, ...rest) => {
      if (String(tag).toLowerCase() === 'video') made++;
      return realCreate(tag, ...rest);
    };
    try {
      await V.ensureVideoSource(key);
      const first = made;
      for (let i = 0; i < 20; i++) {
        V.videoSource(key);
        await new Promise((r) => setTimeout(r, 30));
      }
      const afterFrames = made;
      // Different bytes are a different question, so they get asked.
      const key2 = keyOf('undecodable-2');
      await V.ensureVideoSource(key2);
      const afterSecondRow = made;
      // And an explicit retry asks again.
      V.retryVideoSource(key);
      await V.ensureVideoSource(key);
      const afterRetry = made;
      const remembered = V.failedVideoSources();
      V.clearVideoSources();
      return { first, extraOverTwentyFrames: afterFrames - first,
               secondRowTried: afterSecondRow - afterFrames,
               retryTried: afterRetry - afterSecondRow,
               remembered, forgottenOnClear: V.failedVideoSources() };
    } finally {
      document.createElement = realCreate;
      S.clearLibrary();
    }
  });
  check('undecodable footage is tried once, not once per frame',
    undecodable.first === 1 && undecodable.extraOverTwentyFrames === 0,
    JSON.stringify(undecodable));
  check('…a different file is still a different question',
    undecodable.secondRowTried === 1, String(undecodable.secondRowTried));
  check('…an explicit retry asks again', undecodable.retryTried === 1, String(undecodable.retryTried));
  check('…and clearing the sources forgets what failed',
    undecodable.remembered === 2 && undecodable.forgottenOnClear === 0,
    `${undecodable.remembered} → ${undecodable.forgottenOnClear}`);

  check('the pane sits in the properties column, right of the picture',
    insp.editor && insp.visible && insp.rightOfStage,
    JSON.stringify({ editor: insp.editor, visible: insp.visible, right: insp.rightOfStage }));

  const round = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.editClip(0, { in: 1, out: 4, transition: 'dip', xdur: 0.8 }, 'set');
    const shape = () => S.timeline.map((c) => ({ k: c.kind, i: c.in, o: c.out, t: c.transition, x: c.xdur }));
    const before = shape();
    S.applyProject(JSON.parse(JSON.stringify(S.readProject())));
    return { same: JSON.stringify(before) === JSON.stringify(shape()), before, after: shape() };
  });
  check('saving a project keeps every trim, transition and still',
    round.same, JSON.stringify(round.after));

  const legacy = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.applyProject({ tabs: { video: {} },
      timeline: { clips: [{ rec: { 'v-scene': 'snow', 'v-dur': '5' }, label: 'Old', dur: 5, scene: 'snow' }] } });
    const c = S.timeline[0];
    return c && { kind: c.kind, src: c.src, in: c.in, out: c.out, transition: c.transition,
                  duration: +S.buildSchedule().duration.toFixed(2) };
  });
  check('a pre-trim sequence still opens, and plays exactly as it did',
    legacy && legacy.kind === 'video' && legacy.src === 5 && legacy.in === 0
      && legacy.out === 5 && legacy.duration === 5, JSON.stringify(legacy));
}

/* ============================================== twenty more filters ==== */
/* The chain had 25 steps and no way to say "make it a Game Boy", "print it",
   "burn a timecode on it" or "put a name bar on it". Every one of these is a
   pure function of (frame, t) — see the header of fx/filters-extra.js for why
   that constraint shapes two of them. */
section('twenty more filters');
{
  const reg = await page.evaluate(async () => {
    const M = await import('./src/fx/filters-extra.js');
    const M2 = await import('./src/fx/filters-extra2.js');
    const F = await import('./src/fx/filters.js');
    const groups = {};
    for (const f of Object.values(F.FILTERS)) groups[f.group] = (groups[f.group] || 0) + 1;
    const ids = M.EXTRA_FILTER_IDS.concat(M2.EXTRA2_FILTER_IDS);
    return { total: Object.keys(F.FILTERS).length, added: ids.length,
             missing: ids.filter((id) => !F.FILTERS[id]), groups,
             picker: document.querySelectorAll('#v-filters-pick option').length };
  });
  check('every new filter registers into the one chain registry',
    reg.missing.length === 0 && reg.total === 55, JSON.stringify(reg.missing) + ' total ' + reg.total);
  check('…and reaches the picker', reg.picker === reg.total, `${reg.picker} of ${reg.total}`);
  check('…grouped, not dumped in one list', Object.keys(reg.groups).length >= 5, JSON.stringify(reg.groups));

  /* Called DIRECTLY, not through applyFilterChain: the chain swallows a throw
     so one filter cannot kill the preview, which also means a broken filter
     reads exactly like one that did nothing. Both are failures; only one of
     them is visible through the chain. */
  const live = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const M = await import('./src/fx/filters-extra.js');
    const M2 = await import('./src/fx/filters-extra2.js');
    const F = await import('./src/fx/filters.js');
    const W = 240, H = 180;
    const base = document.createElement('canvas'); base.width = W; base.height = H;
    const cfg = S.readVideoCfg(); cfg.W = W; cfg.H = H; cfg.scene = 'hud';
    S.renderVideoFrame(base.getContext('2d'), W, H, cfg, 1.0);
    const ref = base.getContext('2d').getImageData(0, 0, W, H).data;
    // Levels is deliberately an identity at its defaults; Streak needs a
    // highlight to find on a dark source. Hue and Bloom are likewise identities
    // at their defaults (rotate 0 / colourise 0; nothing over the threshold), so
    // the change-detector is given a setting that does something.
    const EX = { levels: { inLow: 40, inHigh: 200, gamma: 160 }, streak: { threshold: 40 },
                 hue: { rotate: 90 }, bloom: { threshold: 10, intensity: 150 } };
    const dead = [], threw = [];
    for (const id of M.EXTRA_FILTER_IDS.concat(M2.EXTRA2_FILTER_IDS)) {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      ctx.drawImage(base, 0, 0);
      try {
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
        F.FILTERS[id].apply(ctx, W, H, F.resolveParams(id, EX[id] || {}), 1.0);
        ctx.restore();
      } catch (e) { threw.push(id + ': ' + e.message); continue; }
      const d = ctx.getImageData(0, 0, W, H).data;
      let diff = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - ref[i]) + Math.abs(d[i + 1] - ref[i + 1]) + Math.abs(d[i + 2] - ref[i + 2]) > 8) diff++;
      }
      if (diff < 40) dead.push(id);
    }
    return { dead, threw };
  });
  check('not one of them throws on a real frame', live.threw.length === 0, live.threw.join(' | '));
  check('…and every one of them changes the picture', live.dead.length === 0, live.dead.join(', '));

  /* The bug this caught: hexToRgb returns a TUPLE, and reading .r/.g/.b off it
     gives undefined — which in a pixel loop lands in a Uint8ClampedArray, where
     NaN clamps to 0. Six filters rendered a plausible wrong picture rather than
     failing, and only the one that fed a gradient stop threw. */
  const colours = await page.evaluate(async () => {
    const F = await import('./src/fx/filters.js');
    const W = 40, H = 40;
    const paint = (id, params) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      F.FILTERS[id].apply(ctx, W, H, F.resolveParams(id, params), 1.0);
      ctx.restore();
      const d = ctx.getImageData(W / 2, H / 2, 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    // A mid grey mapped through a gradient map lands on the MIDTONE colour, and
    // quantised to a one-entry-per-corner palette lands on a palette member —
    // both exact, so an undefined channel reading as 0 cannot pass.
    return { grad: paint('gradmap', { shadow: '#000000', mid: '#ff0000', highlight: '#ffffff' }),
             quant: paint('quantize', { palette: 'mono' }),
             riso: paint('riso', { ink1: '#000000', ink2: '#000000', paper: '#00ff00', grain: 0, offset: 0 }) };
  });
  check('a colour parameter actually reaches the pixels',
    colours.grad[0] > 200 && colours.grad[1] < 60 && colours.grad[2] < 60, JSON.stringify(colours.grad));
  check('…for a palette', colours.quant[0] > 200 && colours.quant[2] < 60, JSON.stringify(colours.quant));
  check('…and for an ink on paper', colours.riso[1] > colours.riso[0], JSON.stringify(colours.riso));

  /* Directional Blur used to leave the frame ~35% transparent at default
     settings (n shifted copies at a flat 1/n alpha only reach 1-(1-1/n)^n
     coverage), so the page bled through the preview and exports composited
     toward black. The smear must ride OVER an opaque frame. */
  const dirblurMinAlpha = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const cfg = Object.assign(S.readVideoCfg(), { W: 160, H: 120, scene: 'terminal',
      scan: 0, noise: 0, vig: 0, flick: 0, glitch: 0, chroma: 0, bloom: 0, persist: 0,
      mask: 0, hum: 0, track: 0, shake: 0, roll: 0, dither: false, fade: 0,
      __auto: null, __layers: null });
    cfg.__filters = [{ id: 'dirblur', enabled: true, params: { length: 16, angle: 0, mix: 100 } }];
    const c = document.createElement('canvas'); c.width = 160; c.height = 120;
    S.renderVideoFrame(c.getContext('2d'), 160, 120, cfg, 1.5);
    const d = c.getContext('2d').getImageData(0, 0, 160, 120).data;
    let min = 255; for (let i = 3; i < d.length; i += 4) if (d[i] < min) min = d[i];
    return min;
  });
  check('directional blur leaves the frame fully opaque', dirblurMinAlpha === 255,
        `min alpha ${dirblurMinAlpha}`);

  const det = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const M = await import('./src/fx/filters-extra.js');
    const M2 = await import('./src/fx/filters-extra2.js');
    const F = await import('./src/fx/filters.js');
    const W = 160, H = 120;
    const shot = (id) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      const cfg = S.readVideoCfg(); cfg.W = W; cfg.H = H; cfg.scene = 'hud';
      S.renderVideoFrame(ctx, W, H, cfg, 2.5);
      F.applyFilterChain(ctx, W, H, [{ id, enabled: true, params: {} }], 2.5);
      return c.toDataURL();
    };
    return M.EXTRA_FILTER_IDS.concat(M2.EXTRA2_FILTER_IDS).filter((id) => shot(id) !== shot(id));
  });
  check('the same (frame, t) renders the same pixels twice — scrub, play and export agree',
    det.length === 0, det.join(', '));

  /* A mode is a list. The value is a string in the document, so an unknown one
     — an older build, a hand-edited project, a hostile one — must land on the
     default rather than on an unhandled switch case that draws nothing. */
  const sel = await page.evaluate(async () => {
    const F = await import('./src/fx/filters.js');
    return { def: F.resolveParams('quantize', {}).palette,
             valid: F.resolveParams('quantize', { palette: 'c64' }).palette,
             junk: F.resolveParams('quantize', { palette: 'nope' }).palette,
             proto: F.resolveParams('quantize', { palette: '__proto__' }).palette,
             num: F.resolveParams('quantize', { palette: 7 }).palette };
  });
  check('a select parameter keeps a value it knows', sel.valid === 'c64', sel.valid);
  check('…and falls back to the default for one it does not',
    sel.def === 'gameboy' && sel.junk === 'gameboy' && sel.proto === 'gameboy' && sel.num === 'gameboy',
    JSON.stringify(sel));

  const panel = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    document.querySelector('.tab[data-view=video]').click();
    S.clearFilters();
    const pick = document.getElementById('v-filters-pick');
    pick.value = 'quantize'; pick.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('v-filters-add').click();
    const el = document.querySelector('#v-filters-list select[data-key="palette"]');
    if (!el) return { built: false };
    el.value = 'c64'; el.dispatchEvent(new Event('change', { bubbles: true }));
    return { built: true, options: el.options.length, doc: S.store.get('filters.video')[0].params.palette };
  });
  check('the panel builds a real picker for a mode, not a slider over the options',
    panel.built && panel.options === 7, JSON.stringify(panel));
  check('…and choosing one reaches the document', panel.doc === 'c64', String(panel.doc));

  const round = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const before = JSON.stringify(S.store.get('filters.video'));
    S.applyProject(JSON.parse(JSON.stringify(S.readProject())));
    return { same: before === JSON.stringify(S.store.get('filters.video')), before };
  });
  check('a mode survives the project round trip', round.same, round.before);

  /* These have to be usable at the delivery sizes the tool now offers. The two
     plate-separation filters allocated canvases per frame, which put one of
     them at 1086ms a frame — a filter nobody could actually leave switched on. */
  const cost = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const M = await import('./src/fx/filters-extra.js');
    const M2 = await import('./src/fx/filters-extra2.js');
    const F = await import('./src/fx/filters.js');
    const W = 1080, H = 608;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const cfg = S.readVideoCfg(); cfg.W = W; cfg.H = H; cfg.scene = 'hud';
    S.renderVideoFrame(ctx, W, H, cfg, 1.0);
    const slow = [];
    for (const id of M.EXTRA_FILTER_IDS.concat(M2.EXTRA2_FILTER_IDS)) {
      const t0 = performance.now();
      F.applyFilterChain(ctx, W, H, [{ id, enabled: true, params: {} }], 1.0);
      const ms = performance.now() - t0;
      if (ms > 400) slow.push(`${id}:${Math.round(ms)}ms`);
    }
    return slow;
  });
  check('none of them costs more than 400ms a frame at 1080p', cost.length === 0, cost.join(', '));

  const chain = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const F = await import('./src/fx/filters.js');
    const W = 200, H = 150;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const cfg = S.readVideoCfg(); cfg.W = W; cfg.H = H; cfg.scene = 'neongrid';
    S.renderVideoFrame(ctx, W, H, cfg, 1.5);
    F.applyFilterChain(ctx, W, H, [
      { id: 'levels', enabled: true, params: { inLow: 20, inHigh: 220 } },
      { id: 'gradmap', enabled: true, params: {} },
      { id: 'ntsc', enabled: true, params: {} },
      { id: 'neonedge', enabled: true, params: {} },
      { id: 'lower3', enabled: true, params: {} },
      { id: 'timecode', enabled: true, params: {} },
    ], 1.5);
    const d = ctx.getImageData(0, 0, W, H).data;
    let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 40) lit++;
    return { lit, of: W * H };
  });
  check('six of them stacked still produce a picture rather than a black frame',
    chain.lit > chain.of * 0.05, JSON.stringify(chain));

  await page.evaluate(() => window.DeadSignalStudio.clearFilters());
}

/* ============================================== sixteen more scenes ==== */
/* A scene is the one thing in the tool an author cannot work around: if the
   look is not in the list, it is not makeable. These are the device screens,
   broadcast furniture and screensavers the list was missing. */
section('sixteen more scenes');
{
  const reg = await page.evaluate(async () => {
    const M = await import('./src/video/scenes-extra2.js');
    const S = window.DeadSignalStudio;
    return { total: Object.keys(S.SCENES).length, added: M.EXTRA2_SCENE_IDS.length,
             missing: M.EXTRA2_SCENE_IDS.filter((id) => !S.SCENES[id]),
             unnamed: M.EXTRA2_SCENE_IDS.filter((id) => !S.SCENES[id]?.name),
             picker: document.querySelectorAll('#v-scene option').length };
  });
  check('every new scene registers into the one scene registry',
    reg.missing.length === 0 && reg.total === 48, JSON.stringify(reg.missing) + ' total ' + reg.total);
  check('…each with a name, and reaching the picker',
    reg.unnamed.length === 0 && reg.picker === reg.total, `${reg.picker} of ${reg.total}`);

  /* The gate that matters most for a scene: it has to draw SOMETHING at every
     time an author might scrub to, including t=0. A scene blank at the start
     looks like a broken tool the moment it is picked. Sampled with the whole
     CRT stack off, so the ink measured is the scene's own. */
  const alive = await page.evaluate(async () => {
    const M = await import('./src/video/scenes-extra2.js');
    const S = window.DeadSignalStudio;
    const W = 320, H = 240;
    const bad = [], threw = [];
    for (const id of M.EXTRA2_SCENE_IDS) {
      for (const t of [0, 0.05, 1, 3.5, 9.5]) {
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        const cfg = S.readVideoCfg(); cfg.W = W; cfg.H = H; cfg.scene = id;
        /* Pinned, not inherited: an earlier section leaves its own v-dur behind,
           and sampling past the end of the clip is not a fair test — Station
           Sign-Off deliberately fades to black over its final second so it can
           be the last clip of a sequence without extra editing. Every t below
           is comfortably inside a 12s clip. */
        cfg.duration = 12;
        for (const k of ['scan', 'noise', 'vig', 'flick', 'glitch', 'chroma', 'bloom',
          'mask', 'hum', 'track', 'shake', 'roll', 'persist']) cfg[k] = 0;
        cfg.dither = false;
        for (const k of ['hud', 'morse', 'blink', 'reveal', 'sub']) cfg[k] = '';
        cfg.tc = false;
        try { S.renderVideoFrame(ctx, W, H, cfg, t); }
        catch (e) { threw.push(`${id}@${t}: ${e.message}`); continue; }
        const d = ctx.getImageData(0, 0, W, H).data;
        const bg = [d[0], d[1], d[2]];
        let ink = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 24) ink++;
        }
        if (ink < 60) bad.push(`${id}@${t}:${ink}`);
      }
    }
    return { bad, threw };
  });
  check('not one of them throws at any time an author can scrub to', alive.threw.length === 0, alive.threw.join(' | '));
  check('…and none is blank — including at t=0', alive.bad.length === 0, alive.bad.join(', '));

  const motion = await page.evaluate(async () => {
    const M = await import('./src/video/scenes-extra2.js');
    const S = window.DeadSignalStudio;
    const W = 200, H = 150;
    const shot = (id, t) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const cfg = S.readVideoCfg(); cfg.W = W; cfg.H = H; cfg.scene = id;
      for (const k of ['noise', 'flick', 'glitch', 'track', 'shake', 'hum']) cfg[k] = 0;
      S.renderVideoFrame(c.getContext('2d'), W, H, cfg, t);
      return c.toDataURL();
    };
    return { still: M.EXTRA2_SCENE_IDS.filter((id) => shot(id, 1.0) === shot(id, 4.0)),
             // Twice at the SAME t: scrub, playback and export have to agree.
             unstable: M.EXTRA2_SCENE_IDS.filter((id) => shot(id, 3.0) !== shot(id, 3.0)) };
  });
  check('every one of them is actually animated, not a still with a clock on it',
    motion.still.length === 0, motion.still.join(', '));
  check('…and the same t renders the same frame twice', motion.unstable.length === 0, motion.unstable.join(', '));

  /* The house rule from the file header: fill your own background from cfg.bg.
     The layer compositor passes bg:'#000' so an additive blend can drop it, so
     a scene that hardcodes its background cannot be layered. Teletext broke
     this — a black page is right, but it has to be cfg's black. */
  const authored = await page.evaluate(async () => {
    const M = await import('./src/video/scenes-extra2.js');
    const S = window.DeadSignalStudio;
    const W = 240, H = 180;
    const shot = (id, text, bg) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const cfg = S.readVideoCfg(); cfg.W = W; cfg.H = H; cfg.scene = id;
      cfg.text = text; cfg.bg = bg;
      for (const k of ['noise', 'flick', 'glitch']) cfg[k] = 0;
      S.renderVideoFrame(c.getContext('2d'), W, H, cfg, 2.0);
      return c.toDataURL();
    };
    // pipes and mystify are abstract screensavers with nothing to caption —
    // the same as the plasma / tunnel / life / starfield / fire already shipped.
    const ABSTRACT = new Set(['pipes', 'mystify']);
    return { ignoresText: M.EXTRA2_SCENE_IDS.filter((id) => !ABSTRACT.has(id)
               && shot(id, 'AAAA', '#000000') === shot(id, 'ZZZZ ZZZZ', '#000000')),
             ignoresBg: M.EXTRA2_SCENE_IDS.filter((id) =>
               shot(id, 'AAAA', '#000000') === shot(id, 'AAAA', '#204060')) };
  });
  check('the author\'s text reaches every scene that has words in it',
    authored.ignoresText.length === 0, authored.ignoresText.join(', '));
  check('…and every one of them fills its own background from cfg.bg, so it can be layered',
    authored.ignoresBg.length === 0, authored.ignoresBg.join(', '));

  const cost = await page.evaluate(async () => {
    const M = await import('./src/video/scenes-extra2.js');
    const S = window.DeadSignalStudio;
    const W = 1080, H = 1920;                       // the vertical delivery format
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const slow = [];
    for (const id of M.EXTRA2_SCENE_IDS) {
      const cfg = S.readVideoCfg(); cfg.W = W; cfg.H = H; cfg.scene = id;
      const t0 = performance.now();
      S.renderVideoFrame(ctx, W, H, cfg, 2.0);
      const ms = performance.now() - t0;
      if (ms > 500) slow.push(`${id}:${Math.round(ms)}ms`);
    }
    return slow;
  });
  check('none costs more than 500ms a frame at 1080×1920', cost.length === 0, cost.join(', '));

  /* A scene is only usable if it survives being chosen — which means reaching
     the document, coming back on reload, and being capturable into a clip. */
  const wired = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    document.querySelector('.tab[data-view=video]').click();
    const sel = document.getElementById('v-scene');
    sel.value = 'teletext'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const doc = S.store.get('tabs.video.v-scene');
    S.applyProject(JSON.parse(JSON.stringify(S.readProject())));
    return { doc, afterLoad: S.store.get('tabs.video.v-scene'), cfg: S.readVideoCfg().scene };
  });
  check('picking a new scene reaches the document and survives a reload',
    wired.doc === 'teletext' && wired.afterLoad === 'teletext' && wired.cfg === 'teletext',
    JSON.stringify(wired));

  /* A CRAWL IS A LOOP.
     Emergency Alert drew one string of four copies starting at
     `W - (travelled % width)`, which put its LEFT edge at the right-hand edge of
     the frame at the top of every cycle: the band started completely empty and
     filled in from the right over the next three and a half seconds, then
     snapped back to empty. Measured at 400×300 over 20 s: coverage climbing
     0 → 255 of 400 columns, under half the width for 4.8 s of every 20 — on the
     one scene in the set whose whole point is that it is an urgent
     interruption. Sampled every 100 ms across more than one full cycle. */
  const crawl = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const { beginFrame } = await import('./src/core/rng.js');
    const W = 400, H = 300;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const cfg = { ...S.readVideoCfg(), W, H, bg: '#000', text: 'THIS IS NOT A TEST' };
    // The crawl band: below the colour bars (H*0.42) and above the footer.
    const y0 = Math.round(H * 0.44), rows = Math.round(H * 0.72) - y0;
    let worst = W, empty = 0, thin = 0, n = 0;
    for (let t = 0; t < 20; t += 0.1) {
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
      beginFrame(Math.round(t * 12));
      S.SCENES.alert.draw(x, W, H, cfg, t);
      const d = x.getImageData(0, y0, W, rows).data;
      let cols = 0;
      for (let px = 0; px < W; px++) {
        for (let r = 0; r < rows; r++) {
          const i = (r * W + px) * 4;
          if (d[i] + d[i + 1] + d[i + 2] > 90) { cols++; break; }
        }
      }
      n++; if (cols === 0) empty++; if (cols < W * 0.5) thin++;
      if (cols < worst) worst = cols;
    }
    return { W, samples: n, empty, thin, worst };
  });
  check('the alert crawl is never off the screen', crawl.empty === 0, `${crawl.empty} of ${crawl.samples} frames`);
  check('…and always covers most of the band', crawl.thin === 0,
    `worst ${crawl.worst} of ${crawl.W} columns, ${crawl.thin} thin frames`);
}

/* ============================================ fifteen more screens ==== */
/* The template set was screens — terminals, dialogs, desktops. What a campaign
   actually needs to plant is PAPER: a clipping, a form, a label, a page from a
   book. Those are the props a player picks up. */
section('fifteen more screens');
{
  const reg = await page.evaluate(async () => {
    const M = await import('./src/image/templates-extra2.js');
    const T = await import('./src/image/templates.js');
    return { total: Object.keys(T.TEMPLATES).length, added: M.EXTRA2_TEMPLATE_IDS.length,
             missing: M.EXTRA2_TEMPLATE_IDS.filter((id) => !T.TEMPLATES[id]),
             unnamed: M.EXTRA2_TEMPLATE_IDS.filter((id) => !T.TEMPLATES[id]?.name),
             picker: document.querySelectorAll('#i-tpl option').length };
  });
  check('every new template registers into the one template registry',
    reg.missing.length === 0 && reg.total === 46, JSON.stringify(reg.missing) + ' total ' + reg.total);
  check('…each with a name, and reaching the picker',
    reg.unnamed.length === 0 && reg.picker === reg.total, `${reg.picker} of ${reg.total}`);

  /* At three shapes, because a template that only composes at the default size
     is a screenshot. 1080×1920 is the vertical delivery format; 240×180 is
     small enough that a hardcoded pixel offset falls off the sheet. */
  const alive = await page.evaluate(async () => {
    const M = await import('./src/image/templates-extra2.js');
    const R = await import('./src/image/render.js');
    const bad = [], threw = [];
    for (const id of M.EXTRA2_TEMPLATE_IDS) {
      for (const [W, H] of [[480, 360], [1080, 1920], [240, 180]]) {
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        const cfg = R.readImageCfg(); cfg.W = W; cfg.H = H; cfg.tpl = id;
        for (const k of ['scan', 'noise', 'vig', 'chroma', 'bloom', 'dead', 'copy',
          'skew', 'posterize', 'halftone', 'pixsort']) cfg[k] = 0;
        cfg.duotone = false; cfg.stego = ''; cfg.invert = '';
        try { R.drawImageTo(ctx, W, H, cfg); }
        catch (e) { threw.push(`${id}@${W}×${H}: ${e.message}`); continue; }
        const d = ctx.getImageData(0, 0, W, H).data;
        const bg = [d[0], d[1], d[2]];
        let ink = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 24) ink++;
        }
        // Proportional, not absolute: 60px of ink is a full page at 240×180 and
        // a speck at 1080×1920.
        if (ink < W * H * 0.004) bad.push(`${id}@${W}×${H}:${ink}`);
      }
    }
    return { bad, threw };
  });
  check('not one of them throws, at any of three shapes', alive.threw.length === 0, alive.threw.join(' | '));
  check('…and every one composes rather than falling off the sheet', alive.bad.length === 0, alive.bad.join(', '));

  /* A template is a still, so "the same seed gives the same screen" is what
     makes a project reproducible — every randomised element goes through
     seedStatic rather than a per-call stream. */
  const det = await page.evaluate(async () => {
    const M = await import('./src/image/templates-extra2.js');
    const R = await import('./src/image/render.js');
    const W = 320, H = 240;
    const shot = (id) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const cfg = R.readImageCfg(); cfg.W = W; cfg.H = H; cfg.tpl = id;
      R.drawImageTo(c.getContext('2d'), W, H, cfg);
      return c.toDataURL();
    };
    return M.EXTRA2_TEMPLATE_IDS.filter((id) => shot(id) !== shot(id));
  });
  check('the same seed draws the same screen twice', det.length === 0, det.join(', '));

  /* Every box on the panel has to do something on every template. Three of
     these ignored one: the journal and the floppy label had no use for a title,
     and the punch card had no use for a body — an author typing into a box and
     seeing nothing reasonably concludes the template is broken. */
  const authored = await page.evaluate(async () => {
    const M = await import('./src/image/templates-extra2.js');
    const R = await import('./src/image/render.js');
    const W = 400, H = 300;
    const shot = (id, t, b) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const cfg = R.readImageCfg(); cfg.W = W; cfg.H = H; cfg.tpl = id;
      cfg.title = t; cfg.body = b;
      for (const k of ['noise', 'dead', 'copy']) cfg[k] = 0;
      R.drawImageTo(c.getContext('2d'), W, H, cfg);
      return c.toDataURL();
    };
    return { title: M.EXTRA2_TEMPLATE_IDS.filter((id) => shot(id, 'AAAA', 'B') === shot(id, 'ZZZZ ZZZZ', 'B')),
             body: M.EXTRA2_TEMPLATE_IDS.filter((id) => shot(id, 'A', 'BBBB') === shot(id, 'A', 'YYYY|YY\nZZZZ|ZZ')) };
  });
  check('the title box changes every one of them', authored.title.length === 0, authored.title.join(', '));
  check('…and so does the body box', authored.body.length === 0, authored.body.join(', '));

  const cost = await page.evaluate(async () => {
    const M = await import('./src/image/templates-extra2.js');
    const R = await import('./src/image/render.js');
    const W = 1080, H = 1920;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const slow = [];
    for (const id of M.EXTRA2_TEMPLATE_IDS) {
      const cfg = R.readImageCfg(); cfg.W = W; cfg.H = H; cfg.tpl = id;
      const t0 = performance.now();
      R.drawImageTo(ctx, W, H, cfg);
      const ms = performance.now() - t0;
      if (ms > 500) slow.push(`${id}:${Math.round(ms)}ms`);
    }
    return slow;
  });
  check('none costs more than 500ms at 1080×1920', cost.length === 0, cost.join(', '));

  const wired = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    document.querySelector('.tab[data-view=image]').click();
    const sel = document.getElementById('i-tpl');
    sel.value = 'blueprint'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const doc = S.store.get('tabs.image.i-tpl');
    S.applyProject(JSON.parse(JSON.stringify(S.readProject())));
    return { doc, afterLoad: S.store.get('tabs.image.i-tpl') };
  });
  check('picking a new template reaches the document and survives a reload',
    wired.doc === 'blueprint' && wired.afterLoad === 'blueprint', JSON.stringify(wired));

  /* A WINDOW HAS TO FIT INSIDE THE PICTURE.
     Error Dialog hard-coded a 140px window height, and `y = (H - h) / 2` goes
     negative below that: at 520×120 — an ordinary banner shape, and the tab
     accepts any size from 120×90 up — the title bar sat above the top edge, the
     close buttons were gone and the OK button hung off the bottom. Every other
     window template sizes from the frame; this one was the exception, so the
     check covers all of them rather than just the one that was wrong. */
  const fit = await page.evaluate(async () => {
    const T = await import('./src/image/templates.js');
    await import('./src/image/templates-extra.js');
    const R = await import('./src/image/render.js');
    const WINDOWED = ['dialog', 'explorer', 'taskmgr', 'registry', 'vapordesktop', 'chat', 'filecabinet'];
    const bad = [];
    for (const id of WINDOWED) {
      for (const [W, H] of [[520, 420], [520, 120], [400, 100], [120, 90]]) {
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        const cfg = R.readImageCfg();
        cfg.W = W; cfg.H = H; cfg.tpl = id; cfg.wrap = true;
        for (const k of ['scan', 'noise', 'vig', 'chroma', 'bloom', 'dead', 'copy',
          'skew', 'posterize', 'halftone', 'pixsort']) cfg[k] = 0;
        cfg.duotone = false; cfg.stego = ''; cfg.invert = '';
        R.drawImageTo(ctx, W, H, cfg);
        /* The chrome is #c0c0c0. Find its topmost and bottommost row: a window
           that fits leaves at least one row of desktop above and below it. */
        const d = ctx.getImageData(0, 0, W, H).data;
        let top = -1, bot = -1;
        for (let row = 0; row < H; row++) {
          let grey = 0;
          for (let px = 0; px < W; px++) {
            const i = (row * W + px) * 4;
            if (Math.abs(d[i] - 192) < 10 && Math.abs(d[i + 1] - 192) < 10 && Math.abs(d[i + 2] - 192) < 10) grey++;
          }
          if (grey > 8) { if (top < 0) top = row; bot = row; }
        }
        if (top < 1 || bot > H - 2) bad.push(`${id}@${W}×${H}: rows ${top}–${bot}`);
      }
    }
    return bad;
  });
  check('every window template keeps its window inside the frame, down to 120×90',
    fit.length === 0, fit.slice(0, 5).join(' | '));

  /* A DEAD CONTROL HAS TO LOOK DEAD, ONE CONTROL AT A TIME.
     Ink and Ground were greyed out together, from one list of templates that fix
     BOTH — so on the nine that fix exactly one, a live control sat beside a dead
     one with nothing on screen to tell them apart: the very failure the list was
     added to fix, one level down. Measured behaviour is the authority here, not
     the list: each control's disabled state is compared against whether changing
     that colour actually changes the picture. */
  const palette = await page.evaluate(async () => {
    const T = await import('./src/image/templates.js');
    const R = await import('./src/image/render.js');
    const shot = (id, over) => {
      const W = 320, H = 240;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      const cfg = R.readImageCfg();
      cfg.W = W; cfg.H = H; cfg.tpl = id; cfg.wrap = true;
      for (const k of ['scan', 'noise', 'vig', 'chroma', 'bloom', 'dead', 'copy',
        'skew', 'posterize', 'halftone', 'pixsort']) cfg[k] = 0;
      cfg.duotone = false; cfg.stego = ''; cfg.invert = '';
      Object.assign(cfg, over);
      R.drawImageTo(ctx, W, H, cfg);
      const d = ctx.getImageData(0, 0, W, H).data;
      let h = 2166136261;
      for (let i = 0; i < d.length; i += 3) { h ^= d[i]; h = Math.imul(h, 16777619); }
      return h >>> 0;
    };
    const sel = document.getElementById('i-tpl');
    document.querySelector('.tab[data-view=image]').click();
    const wrong = [], unexplained = [];
    for (const id of Object.keys(T.TEMPLATES)) {
      const base = shot(id, { fg: '#39ff9e', bg: '#050a08' });
      const inkLive = shot(id, { fg: '#ff2bd6', bg: '#050a08' }) !== base;
      const groundLive = shot(id, { fg: '#39ff9e', bg: '#7a2b00' }) !== base;
      /* Dispatched, not just assigned: the template is document state, and
         readImageCfg reads the document — a bare `sel.value = id` would leave
         every render in this loop on whatever template the document still held.
         `input` as well as `change`, because a real <select> fires both and it is
         the input that wireLive listens for; then render directly rather than
         waiting out the 70 ms debounce. */
      sel.value = id;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      R.renderImage();
      const fg = document.getElementById('i-fg').disabled;
      const bg = document.getElementById('i-bg').disabled;
      const pal = document.getElementById('i-palette').disabled;
      const note = document.getElementById('i-palette-note').textContent.trim();
      if (fg !== !inkLive) wrong.push(`${id}: ink ${inkLive ? 'live' : 'dead'} / control ${fg ? 'off' : 'on'}`);
      if (bg !== !groundLive) wrong.push(`${id}: ground ${groundLive ? 'live' : 'dead'} / control ${bg ? 'off' : 'on'}`);
      if (pal !== !(inkLive || groundLive)) wrong.push(`${id}: picker ${pal ? 'off' : 'on'}`);
      // Anything greyed out has to say why.
      if ((fg || bg) && !note) unexplained.push(id);
    }
    return { total: Object.keys(T.TEMPLATES).length, wrong, unexplained };
  });
  check('Ink and Ground are enabled exactly where they do something',
    palette.wrong.length === 0, `${palette.total} templates; ${palette.wrong.slice(0, 5).join(' | ')}`);
  check('…and a greyed-out colour control always says why',
    palette.unexplained.length === 0, palette.unexplained.join(', '));
}

/* ============================================ sixteen more sounds ==== */
/* The ten original layers are hand-wired across four files, which is why there
   were ten. A layer is now one entry in audio/layers.js and everything else —
   controls, config, render pass, documentation — is derived from it. */
section('sixteen more sounds');
{
  const setA = (id, v) => page.evaluate(([i, val]) => {
    const e = document.getElementById(i);
    if (!e) return false;
    if (e.type === 'checkbox') e.checked = !!val; else e.value = String(val);
    // A real interaction fires both; wireLive listens for input, the document
    // binding for change.
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, [id, v]);

  const built = await page.evaluate(async () => {
    const L = await import('./src/audio/layers.js');
    const missing = [];
    for (const layer of L.AUDIO_LAYERS) {
      if (!document.getElementById(L.TOGGLE(layer.id))) missing.push(layer.id);
      if (!document.getElementById(L.CTRL(layer.id, 'pan'))) missing.push(layer.id + '.pan');
      for (const s of layer.params) {
        if (!document.getElementById(L.CTRL(layer.id, s.key))) missing.push(`${layer.id}.${s.key}`);
      }
    }
    return { layers: L.AUDIO_LAYERS.length, missing,
             fieldsets: document.querySelectorAll('#a-extra-layers fieldset').length };
  });
  check('every registry layer generates its own controls',
    built.layers === 16 && built.missing.length === 0 && built.fieldsets === 16,
    JSON.stringify(built.missing) + ` (${built.fieldsets} fieldsets)`);

  /* Generated controls have to be ordinary controls: present when boot takes
     the defaults snapshot, bound to the document, and restored with a project.
     Generated a line too late and none of that happens.
   *
     Tested through RESET rather than by reading the document directly, because
     the document at this point is whatever ~250 earlier checks left in it — one
     of them deliberately loads a legacy project with no audio tab at all.
     RESET replays the snapshot taken at boot, so it only restores a control
     that existed then: exactly the invariant, and independent of the state it
     is run from. */
  const reset = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const L = await import('./src/audio/layers.js');
    document.querySelector('.tab[data-view=audio]').click();
    document.getElementById('a-reset').click();
    const unrestored = L.AUDIO_LAYERS.filter((l) =>
      S.store.get('tabs.audio.' + L.TOGGLE(l.id)) === undefined
      || l.params.some((s) => S.store.get('tabs.audio.' + L.CTRL(l.id, s.key)) === undefined));
    return { unrestored: unrestored.map((l) => l.id),
             sample: S.store.get('tabs.audio.a-vinyl-g') };
  });
  check('…present when boot snapshots the defaults, so RESET restores them',
    reset.unrestored.length === 0, reset.unrestored.join(', '));
  check('…at the value their own declaration set', String(reset.sample) === '40', String(reset.sample));

  await setA('a-vinyl', true);
  await setA('a-vinyl-g', 80);
  const round = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const before = { on: S.store.get('tabs.audio.a-vinyl'), g: S.store.get('tabs.audio.a-vinyl-g') };
    S.applyProject(JSON.parse(JSON.stringify(S.readProject())));
    return { before, after: { on: S.store.get('tabs.audio.a-vinyl'), g: S.store.get('tabs.audio.a-vinyl-g') },
             dom: document.getElementById('a-vinyl').checked, cfg: S.readAudioCfg().layers.vinyl };
  });
  check('…reaching the document when changed', round.before.on === true && String(round.before.g) === '80',
    JSON.stringify(round.before));
  check('…and coming back with the project', JSON.stringify(round.before) === JSON.stringify(round.after) && round.dom,
    JSON.stringify(round.after));
  check('…and resolving into the audio config, clamped',
    round.cfg.on === true && round.cfg.g === 0.8, JSON.stringify(round.cfg));

  /* The gate that matters: a layer nobody can hear is a layer that does not
     exist. Rendered one at a time with everything else off, so the peak
     measured is that layer's own. */
  const audible = await page.evaluate(async () => {
    const L = await import('./src/audio/layers.js');
    const E = await import('./src/audio/engine.js');
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      if (e.type === 'checkbox') e.checked = !!v; else e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (const id of ['a-drone', 'a-noise', 'a-pulse', 'a-morse', 'a-sub', 'a-heart',
      'a-geiger', 'a-dtmf', 'a-dial', 'a-sample']) set(id, false);
    for (const l of L.AUDIO_LAYERS) set(L.TOGGLE(l.id), false);
    set('a-dur', 4);
    const silent = [], threw = [];
    for (const layer of L.AUDIO_LAYERS) {
      set(L.TOGGLE(layer.id), true);
      let peak = 0;
      try {
        const r = await E.renderAudio();
        const d = r?.data;
        if (d) for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
      } catch (e) { threw.push(`${layer.id}: ${e.message}`); }
      if (peak < 0.001) silent.push(`${layer.id}:${peak.toFixed(5)}`);
      set(L.TOGGLE(layer.id), false);
    }
    return { silent, threw };
  });
  check('not one of them throws while rendering', audible.threw.length === 0, audible.threw.join(' | '));
  check('…and every one of them is actually audible on its own', audible.silent.length === 0, audible.silent.join(', '));

  const det = await page.evaluate(async () => {
    const L = await import('./src/audio/layers.js');
    const E = await import('./src/audio/engine.js');
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      if (e.type === 'checkbox') e.checked = !!v; else e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('a-dur', 2);
    const bad = [];
    // The layers that draw from the PRNG — the ones where a stray Math.random
    // would go unnoticed until someone re-rendered a campaign asset.
    for (const id of ['vinyl', 'rain', 'drip', 'whisper', 'breath', 'tuning']) {
      set(`a-${id}`, true);
      const hash = async () => {
        const r = await E.renderAudio(); const d = r.data;
        let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + Math.round(d[i] * 1e6)) | 0;
        return h;
      };
      if (await hash() !== await hash()) bad.push(id);
      set(`a-${id}`, false);
    }
    return bad;
  });
  check('the same seed renders the same samples twice', det.length === 0, det.join(', '));

  /* A layer that places content at an author-chosen time has to extend the
     render, exactly as dial-up, pulse train, morse and DTMF already do —
     otherwise "beep at 20s" on a 3s render is silence with no explanation. */
  const needs = await page.evaluate(async () => {
    const L = await import('./src/audio/layers.js');
    const E = await import('./src/audio/engine.js');
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      if (e.type === 'checkbox') e.checked = !!v; else e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('a-dur', 3);
    set('a-answerphone', true);
    set('a-answerphone-at', 20);
    const S = window.DeadSignalStudio;
    const cfg = S.readAudioCfg();
    const r = await E.renderAudio();
    set('a-answerphone', false);
    return { asked: cfg.duration, need: +L.layersNeedSeconds(cfg.layers).toFixed(2),
             rendered: +(r.data.length / cfg.sr).toFixed(2) };
  });
  check('a layer placed past the end of the render extends it',
    needs.asked === 3 && needs.need > 20 && needs.rendered >= needs.need - 0.05, JSON.stringify(needs));

  /* Same contract as the filter chain: one bad layer must not turn "render"
     into a dead button. */
  const isolated = await page.evaluate(async () => {
    const L = await import('./src/audio/layers.js');
    const E = await import('./src/audio/engine.js');
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      e.checked = !!v;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const first = L.AUDIO_LAYERS[0];
    const orig = first.build;
    first.build = () => { throw new Error('boom'); };
    set(L.TOGGLE(first.id), true);
    set('a-hum', true);
    let ok = false;
    try { const r = await E.renderAudio(); ok = !!r?.data?.length; } catch { ok = false; }
    first.build = orig;
    set(L.TOGGLE(first.id), false);
    set('a-hum', false);
    return ok;
  });
  check('a layer that throws is skipped rather than killing the render', isolated);

  /* Generated fieldsets are ordinary fieldsets, so everything that already
     walks the audio tab picks them up with no special handling. */
  const summary = await page.evaluate(async () => {
    const L = await import('./src/audio/layers.js');
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      e.checked = !!v;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (const l of L.AUDIO_LAYERS) set(L.TOGGLE(l.id), false);
    set('a-bell', true);
    await new Promise((r) => setTimeout(r, 200));      // wireLive debounces 70ms
    const text = document.getElementById('a-active')?.textContent || '';
    const dot = document.getElementById('a-bell')?.closest('fieldset')?.querySelector('.ttl .dot')?.textContent;
    set('a-bell', false);
    return { text, dot };
  });
  check('the active-layer summary and legend dot see them, with no special casing',
    /BELL/i.test(summary.text) && summary.dot === '●', JSON.stringify(summary));

  /* Documentation lives beside the layer rather than in a second table that
     drifts — which also means the explain-coverage gate is satisfied for free. */
  const hints = await page.evaluate(async () => {
    const L = await import('./src/audio/layers.js');
    const P = await import('./src/ui/params.js');
    const missing = [];
    for (const layer of L.AUDIO_LAYERS) {
      if (!P.PARAMS[L.TOGGLE(layer.id)]?.explain) missing.push(L.TOGGLE(layer.id));
      if (!P.PARAMS[L.CTRL(layer.id, 'pan')]?.explain) missing.push(L.CTRL(layer.id, 'pan'));
      for (const s of layer.params) {
        if (!P.PARAMS[L.CTRL(layer.id, s.key)]?.explain) missing.push(L.CTRL(layer.id, s.key));
      }
    }
    return { missing, coverage: window.DeadSignalStudio.explainCoverage().missing.length };
  });
  check('every generated control explains itself', hints.missing.length === 0, hints.missing.join(', '));
  check('…so Explain mode still covers the whole tool', hints.coverage === 0, String(hints.coverage));
}

/* ================================================= an audio FX chain ==== */
/* The master bus is a FIXED set in a FIXED order. It could not express "gate
   it, THEN ping-pong the result", and order is where most of a sound lives.
   Same shape as the video filter chain — same stored document shape, same
   panel, same cap — because it is the same interaction over a different
   registry. */
section('an audio FX chain');
{
  const reg = await page.evaluate(async () => {
    const F = await import('./src/audio/fx.js');
    const groups = {};
    for (const f of Object.values(F.AUDIO_FX)) groups[f.group] = (groups[f.group] || 0) + 1;
    return { total: Object.keys(F.AUDIO_FX).length, groups,
             unimplemented: Object.values(F.AUDIO_FX).filter((f) => !f.graph && !f.post).map((f) => f.id),
             both: Object.values(F.AUDIO_FX).filter((f) => f.graph && f.post).map((f) => f.id),
             picker: document.querySelectorAll('#a-fx-pick option').length,
             optgroups: document.querySelectorAll('#a-fx-pick optgroup').length };
  });
  check('the chain registry is populated and grouped',
    reg.total === 15 && reg.optgroups >= 4, JSON.stringify(reg.groups));
  check('…every effect is exactly one of graph or post',
    reg.unimplemented.length === 0 && reg.both.length === 0,
    JSON.stringify(reg.unimplemented) + JSON.stringify(reg.both));
  check('…and all of them reach the picker', reg.picker === reg.total, `${reg.picker} of ${reg.total}`);

  const panel = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    document.querySelector('.tab[data-view=audio]').click();
    S.clearAudioFx();
    const pick = document.getElementById('a-fx-pick');
    pick.value = 'eq3'; pick.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('a-fx-add').click();
    const el = document.querySelector('#a-fx-list input[data-key="low"]');
    if (el) { el.value = '-12'; el.dispatchEvent(new Event('input', { bubbles: true })); }
    return { rows: document.querySelectorAll('#a-fx-list .filter-row').length,
             doc: S.store.get('filters.audio'),
             count: document.getElementById('a-fx-count')?.textContent };
  });
  check('adding through the panel builds a row and reaches the document',
    panel.rows === 1 && panel.doc?.[0]?.id === 'eq3' && panel.doc[0].params.low === -12,
    JSON.stringify(panel.doc));
  check('…and the count tag follows it', panel.count === '1', String(panel.count));

  /* A source with content across the band, so an EQ and a gate both have
     something to act on. Rendered, hashed, compared — an effect nobody can hear
     is an effect that does not exist. */
  const changes = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const F = await import('./src/audio/fx.js');
    const E = await import('./src/audio/engine.js');
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      if (e.type === 'checkbox') e.checked = !!v; else e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('a-noise', true); set('a-noise-g', 60); set('a-drone', true); set('a-dur', 3);
    set('fx-reverb', false); set('fx-delay', false); set('fx-crush', false); set('a-loop', false);
    const setChain = (l) => S.store.apply({ op: 'set', path: 'filters.audio', value: l });
    const hash = async () => {
      const r = await E.renderAudio(); const d = r.data;
      let h = 0; for (let i = 0; i < d.length; i += 31) h = (h * 31 + Math.round(d[i] * 1e5)) | 0;
      return h;
    };
    setChain([]);
    const base = await hash();
    // Parameters from each effect's own declaration, not a shared bag — the
    // lesson from the video chain's smoke test.
    const paramsFor = (f) => {
      const o = {};
      for (const s of f.params) {
        if (s.kind === 'select') { o[s.key] = s.def; continue; }
        const up = s.def + (s.max - s.def) * 0.6;
        o[s.key] = Math.abs(up - s.def) > 1e-6 ? up : s.def + (s.min - s.def) * 0.6;
      }
      return o;
    };
    const dead = [], threw = [];
    for (const f of Object.values(F.AUDIO_FX)) {
      try {
        // Defaults first — what an author gets on ＋ FX — then off them, because
        // an EQ at 0dB is deliberately an identity.
        setChain([{ id: f.id, enabled: true, params: {} }]);
        if (await hash() !== base) continue;
        setChain([{ id: f.id, enabled: true, params: paramsFor(f) }]);
        if (await hash() === base) dead.push(f.id);
      } catch (e) { threw.push(`${f.id}: ${e.message}`); }
    }
    setChain([]);
    return { dead, threw };
  });
  check('not one of them throws while rendering', changes.threw.length === 0, changes.threw.join(' | '));
  check('…and every one of them changes the sound', changes.dead.length === 0, changes.dead.join(', '));

  /* The contract for a post effect. The loop crossfade and both fades run after
     it and assume the length they were handed, so one that resampled the whole
     buffer would silently move the loop point. */
  const lengths = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const F = await import('./src/audio/fx.js');
    const E = await import('./src/audio/engine.js');
    const setChain = (l) => S.store.apply({ op: 'set', path: 'filters.audio', value: l });
    setChain([]);
    const base = (await E.renderAudio()).data.length;
    const bad = [];
    for (const f of Object.values(F.AUDIO_FX)) {
      if (!f.post) continue;
      setChain([{ id: f.id, enabled: true, params: {} }]);
      const n = (await E.renderAudio()).data.length;
      if (n !== base) bad.push(`${f.id}:${n} vs ${base}`);
    }
    setChain([]);
    return bad;
  });
  check('a post effect leaves the render exactly as long as it found it',
    lengths.length === 0, lengths.join(', '));

  const det = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const F = await import('./src/audio/fx.js');
    const E = await import('./src/audio/engine.js');
    const setChain = (l) => S.store.apply({ op: 'set', path: 'filters.audio', value: l });
    const hash = async () => {
      const r = await E.renderAudio(); const d = r.data;
      let h = 0; for (let i = 0; i < d.length; i += 31) h = (h * 31 + Math.round(d[i] * 1e5)) | 0;
      return h;
    };
    const bad = [];
    for (const f of Object.values(F.AUDIO_FX)) {
      setChain([{ id: f.id, enabled: true, params: {} }]);
      if (await hash() !== await hash()) bad.push(f.id);
    }
    setChain([]);
    return bad;
  });
  check('the same seed renders the same samples twice', det.length === 0, det.join(', '));

  const order = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const E = await import('./src/audio/engine.js');
    const setChain = (l) => S.store.apply({ op: 'set', path: 'filters.audio', value: l });
    const hash = async () => {
      const r = await E.renderAudio(); const d = r.data;
      let h = 0; for (let i = 0; i < d.length; i += 31) h = (h * 31 + Math.round(d[i] * 1e5)) | 0;
      return h;
    };
    const a = { id: 'eq3', enabled: true, params: { low: -20, high: 12 } };
    const b = { id: 'pump', enabled: true, params: { rate: 4, depth: 90 } };
    setChain([a, b]); const ab = await hash();
    setChain([b, a]); const ba = await hash();
    setChain([{ ...a, enabled: false }, b]); const bypassed = await hash();
    setChain([b]); const justB = await hash();
    setChain([]); const empty = await hash();
    setChain([{ id: 'eq3', enabled: false, params: {} }]); const allOff = await hash();
    setChain([]);
    return { differs: ab !== ba, bypassEqualsRemoved: bypassed === justB, noop: empty === allOff };
  });
  check('running the same two effects in the other order is a different sound', order.differs);
  check('…bypass keeps the step but changes nothing', order.bypassEqualsRemoved);
  check('…and an empty chain is a true no-op, so older projects are unchanged', order.noop);

  const round = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const E = await import('./src/audio/engine.js');
    S.store.apply({ op: 'set', path: 'filters.audio', value: [
      { id: 'eq3', enabled: true, params: { low: -9 } },
      { id: 'stutter', enabled: false, params: { slice: 120 } },
      // A step from a build this one is not: kept, not dropped, exactly as the
      // video chain does — dropping it would discard the author's work.
      { id: 'not-a-real-fx', enabled: true, params: {} },
    ] });
    const shape = (l) => (l || []).map((s) => `${s.id}|${s.enabled !== false}|${JSON.stringify(s.params)}`).join(' ');
    const before = shape(S.store.get('filters.audio'));
    S.applyProject(JSON.parse(JSON.stringify(S.readProject())));
    let rendered = false;
    try { rendered = !!(await E.renderAudio())?.data?.length; } catch { rendered = false; }
    const out = { same: before === shape(S.store.get('filters.audio')),
                  rows: document.querySelectorAll('#a-fx-list .filter-row').length, rendered };
    S.clearAudioFx();
    return out;
  });
  check('the chain survives the project round trip', round.same);
  check('…including a step this build does not have', round.rows === 3, String(round.rows));
  check('…which is skipped at render rather than breaking it', round.rendered);
}

/* ================================================ a file that travels ==== */
/* WebM plays in a browser and nowhere else reliably — which is the entire
   reason scripts/gen-campaign-media.py exists as an ffmpeg shim. The muxer
   itself is pinned byte by byte in test-studio-document.mjs; what is checked
   here is the part that needs a browser: the picker, and what happens when the
   H.264 encoder this build was compiled without is asked for anyway. */
section('a file that travels');
{
  const support = await page.evaluate(async () => {
    const E = await import('./src/export/encoder.js');
    return { containers: E.CONTAINERS.map((c) => c.id),
             webm: await E.encoderSupport(160, 120, 'webm'),
             mp4: await E.encoderSupport(160, 120, 'mp4'),
             options: [...document.querySelectorAll('#v-container option')].map((o) => o.value),
             tlOptions: [...document.querySelectorAll('#tl-container option')].map((o) => o.value) };
  });
  check('both containers are offered on VIDEO and on TIMELINE',
    support.options.join() === 'webm,mp4' && support.tlOptions.join() === 'webm,mp4',
    JSON.stringify([support.options, support.tlOptions]));
  check('…and each one reports its own support separately',
    typeof support.webm.available === 'boolean' && typeof support.mp4.available === 'boolean',
    JSON.stringify({ webm: support.webm.available, mp4: support.mp4.available, why: support.mp4.reason }));

  /* The branch that matters. Chromium ships without H.264 unless it was built
     with proprietary codecs, so BOTH outcomes are correct and the test asserts
     whichever one this build is entitled to — never a skip, because a silent
     skip is how a broken export path stays broken. */
  const exported = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const E = await import('./src/export/encoder.js');
    const logs = [];
    const r = await E.encodeClip({
      width: 160, height: 120, fps: 10, frames: 20, container: 'mp4',
      log: (m) => logs.push(m),
      drawFrame: (ctx, t) => {
        const cfg = S.readVideoCfg(); cfg.W = 160; cfg.H = 120; cfg.scene = 'bars';
        S.renderVideoFrame(ctx, 160, 120, cfg, t);
      },
    });
    if (!r) return { none: true, logs };
    const head = new Uint8Array(await r.blob.slice(0, 16).arrayBuffer());
    const tag = String.fromCharCode(head[4], head[5], head[6], head[7]);
    return { ext: r.ext, mime: r.blob.type, bytes: r.blob.size, frames: r.frames,
             codec: r.codec, ftyp: tag, logs,
             ebml: head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3 };
  });
  const hasH264 = support.mp4.available;
  check('asking for MP4 always produces a file', !exported.none, JSON.stringify(exported.logs));
  if (hasH264) {
    check('…and with an H.264 encoder it really is an MP4',
      exported.ext === 'mp4' && exported.ftyp === 'ftyp' && exported.mime === 'video/mp4',
      JSON.stringify(exported));
  } else {
    /* No licence for H.264. The wrong answers here are a corrupt .mp4, or null
       — which would drop the caller to the real-time recorder, slower and still
       not an MP4. A WebM plus a line saying why is the right one. */
    check('…and without one it falls back to a real WebM rather than to nothing',
      exported.ext === 'webm' && exported.ebml, JSON.stringify(exported));
    check('…saying so, rather than silently handing over the wrong format',
      exported.logs.some((m) => /H\.264/i.test(m) && /WebM/i.test(m)), JSON.stringify(exported.logs));
  }

  /* Whatever came back, the library has to be told what it actually IS. Naming
     a file after the request rather than the result is how a .mp4 that is not
     one gets into a campaign bundle. */
  const named = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const E = await import('./src/export/encoder.js');
    S.clearLibrary();
    const r = await E.encodeClip({
      width: 160, height: 120, fps: 10, frames: 12, container: 'mp4',
      drawFrame: (ctx, t) => {
        const cfg = S.readVideoCfg(); cfg.W = 160; cfg.H = 120; cfg.scene = 'bars';
        S.renderVideoFrame(ctx, 160, 120, cfg, t);
      },
    });
    S.addToLibrary(r.blob, r.ext || 'webm', 'videos', 'travel-test', 1.2);
    const row = S.library[S.library.length - 1];
    const out = { ext: row?.ext, blobType: r.blob.type, reported: r.ext };
    S.clearLibrary();
    return out;
  });
  check('the library records the extension the encoder actually wrote',
    named.ext === named.reported && (named.ext === 'mp4') === (named.blobType === 'video/mp4'),
    JSON.stringify(named));
}

/* ==================================================== batch export ======= */
/* The tool exported one thing at a time, which is right when you are shaping a
   look and wrong when you are dressing a campaign. The property that makes a
   batch safe to run is that it renders from RECIPES, never from the controls —
   a batch that quietly loaded its last preset over your work would be worse
   than no batch at all. */
section('batch export');
{
  const panel = await page.evaluate(async () => {
    const B = await import('./src/export/batch.js');
    const U = await import('./src/ui/batch.js');
    /* The empty-sequence state is SET UP rather than assumed: by this point in
       the suite an earlier section has left a clip in the timeline, and a test
       that reads whatever state it inherits is testing the section above it. */
    document.querySelector('.tab[data-view=timeline]').click();
    document.getElementById('tl-clear').click();
    document.querySelector('.tab[data-view=library]').click();
    U.renderBatch();
    return { sources: B.BATCH_SOURCES.map((s) => s.id),
             counts: B.BATCH_SOURCES.map((s) => s.count()),
             labels: [...document.querySelectorAll('#bx-source option')].map((o) => o.textContent),
             disabled: [...document.querySelectorAll('#bx-source option')].filter((o) => o.disabled).map((o) => o.value),
             containers: [...document.querySelectorAll('#bx-container option')].map((o) => o.value) };
  });
  check('the panel offers every batch source, with its count',
    panel.sources.length === 3 && panel.labels.every((l) => /\(\d+\)$/.test(l)), JSON.stringify(panel.labels));
  check('…a source with nothing in it is disabled rather than silently doing nothing',
    panel.disabled.includes('timeline-clips'), JSON.stringify(panel.disabled));
  check('…and video items can be written in either container',
    panel.containers.join() === 'webm,mp4', JSON.stringify(panel.containers));

  /* THE BATCH TAKES THE SAME TOKEN AS EVERY OTHER EXPORT.
     It was the one entry point of six that never asked. `running` only stopped a
     second BATCH, so a batch beside a clip RECORD or a .gif interleaved two
     encoders over the same module-level scratch canvases (_persistCanvas, _ss,
     _tlA) and the same shared imported <video> — exactly the corruption
     claimExport() exists to prevent. Driven through the real button, and the
     token is checked from the outside by asking whether another export can start
     while the batch holds it. */
  const locked = await page.evaluate(async () => {
    const C = await import('./src/video/capture.js');
    const B = await import('./src/export/batch.js');
    const S = window.DeadSignalStudio;
    document.querySelector('.tab[data-view=library]').click();
    S.clearLibrary();

    document.getElementById('bx-source').value = 'screen-presets';
    document.getElementById('bx-source').dispatchEvent(new Event('change', { bubbles: true }));
    /* The handler is async, but everything up to its first await runs during
       dispatch — and the claim is in that part. So the moment .click() returns,
       the token is either held or it never was. */
    document.getElementById('bx-run').click();
    /* Buttons read BEFORE the probe claim: a probe that succeeds would itself
       grey them, and the check would then be measuring the probe. */
    const stillBtnsDisabled = ['v-gif', 'v-apng', 'v-awebp', 'v-strip']
      .every((x) => document.getElementById(x).disabled);
    const probe = C.claimExport('probe');
    const heldDuringRun = probe === false;
    // And hand it straight back if it was free, or every later export refuses.
    if (probe) C.releaseExport();
    // Wait for the panel to report it finished.
    for (let i = 0; i < 300 && document.getElementById('bx-run').disabled; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const afterwards = C.claimExport('probe-after');
    if (afterwards) C.releaseExport();
    S.clearLibrary();
    void B;
    return { heldDuringRun, stillBtnsDisabled, releasedAfterwards: afterwards,
             ran: document.getElementById('bx-status')?.textContent || '' };
  });
  check('a running batch holds the one export token',
    locked.heldDuringRun === true, JSON.stringify(locked));
  check('…so the four still-export buttons are greyed while it runs',
    locked.stillBtnsDisabled === true);
  check('…and it gives the token back when it is done',
    locked.releasedAfterwards === true);

  /* The screens batch first: it is a single frame per item, so it exercises the
     whole path in a fraction of the time and can afford to check the output. */
  const screens = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const B = await import('./src/export/batch.js');
    S.clearLibrary();
    document.querySelector('.tab[data-view=image]').click();
    const set = (id, v) => { const e = document.getElementById(id); e.value = v;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true })); };
    set('i-title', 'MY OWN WORK');
    set('i-tpl', 'blueprint');
    const before = { title: S.store.get('tabs.image.i-title'), tpl: S.store.get('tabs.image.i-tpl') };
    const res = await B.runBatch('screen-presets', { seconds: 0 });
    const after = { title: S.store.get('tabs.image.i-title'), tpl: S.store.get('tabs.image.i-tpl') };
    const rows = S.library.map((r) => ({ ext: r.ext, kind: r.kind, size: r.size, name: r.name }));
    S.clearLibrary();
    return { made: res.made, failed: res.failed, before, after, rows };
  });
  check('every screen preset comes out as its own .png',
    screens.made >= 10 && screens.rows.every((r) => r.ext === 'png' && r.kind === 'image'),
    `${screens.made} made, ${screens.failed.length} failed`);
  check('…none of them empty', screens.rows.every((r) => r.size > 200),
    JSON.stringify(screens.rows.map((r) => r.size).slice(0, 5)));
  check('…and each one is a different picture, not the same screen sixteen times',
    new Set(screens.rows.map((r) => r.size)).size === screens.rows.length,
    `${new Set(screens.rows.map((r) => r.size)).size} distinct of ${screens.rows.length}`);
  /* The one that matters. */
  check('running a batch does not touch the author\'s own settings',
    screens.before.title === 'MY OWN WORK' && screens.after.title === 'MY OWN WORK'
    && screens.after.tpl === 'blueprint', JSON.stringify([screens.before, screens.after]));

  const video = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const B = await import('./src/export/batch.js');
    S.clearLibrary();
    document.querySelector('.tab[data-view=video]').click();
    const el = document.getElementById('v-text');
    el.value = 'DO NOT CLOBBER';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const before = S.store.get('tabs.video.v-text');
    const res = await B.runBatch('video-presets', { seconds: 1 });
    const rows = S.library.map((r) => ({ name: r.name, kind: r.kind, sec: r.seconds, size: r.size }));
    S.clearLibrary();
    return { made: res.made, failed: res.failed.slice(0, 3), rows,
             untouched: before === S.store.get('tabs.video.v-text') };
  });
  check('every video preset comes out as its own clip',
    video.made >= 10 && video.rows.every((r) => r.kind === 'videos' && r.size > 500),
    `${video.made} made, ${video.failed.length} failed: ${video.failed.join(' | ')}`);
  check('…named distinctly, so none overwrites another',
    new Set(video.rows.map((r) => r.name)).size === video.rows.length,
    `${new Set(video.rows.map((r) => r.name)).size} of ${video.rows.length}`);
  check('…capped to the length asked for', video.rows.every((r) => r.sec <= 1.01),
    JSON.stringify(video.rows.map((r) => r.sec).slice(0, 5)));
  check('…and the video tab is left exactly as it was', video.untouched);

  /* A sequence is the one thing you should never have to rebuild clip by clip
     to get the pieces out of — including the trims already made. */
  const clips = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const B = await import('./src/export/batch.js');
    S.clearLibrary();
    const set = (id, v) => { const e = document.getElementById(id); e.value = v;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true })); };
    document.querySelector('.tab[data-view=timeline]').click();
    document.getElementById('tl-clear').click();
    document.querySelector('.tab[data-view=video]').click();
    set('v-scene', 'terminal'); set('v-text', 'ONE'); set('v-dur', '4'); S.addTimelineClip();
    set('v-scene', 'matrix'); set('v-text', 'TWO'); set('v-dur', '3'); S.addTimelineClip();
    S.editClip(0, { in: 1, out: 3 }, 'trim');
    const res = await B.runBatch('timeline-clips', {});
    const rows = S.library.map((r) => ({ name: r.name, sec: +r.seconds.toFixed(2), size: r.size }));
    S.clearLibrary();
    return { made: res.made, failed: res.failed, rows };
  });
  check('each timeline clip comes out as its own file', clips.made === 2 && clips.rows.every((r) => r.size > 500),
    JSON.stringify(clips.rows));
  check('…trimmed exactly as it was cut, not at its full source length',
    Math.abs(clips.rows[0].sec - 2) < 0.05 && Math.abs(clips.rows[1].sec - 3) < 0.05,
    JSON.stringify(clips.rows.map((r) => r.sec)));
  check('…and numbered in sequence order', /^clip_01/.test(clips.rows[0].name) && /^clip_02/.test(clips.rows[1].name),
    clips.rows.map((r) => r.name).join(', '));

  const stopped = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const B = await import('./src/export/batch.js');
    S.clearLibrary();
    let seen = 0;
    const res = await B.runBatch('screen-presets', { seconds: 0,
      onProgress: () => { seen++; }, cancelled: () => seen > 3 });
    const kept = S.library.length;
    S.clearLibrary();
    return { made: res.made, cancelled: res.cancelled, kept };
  });
  check('stopping a batch keeps what it already exported',
    stopped.cancelled && stopped.made > 0 && stopped.kept === stopped.made, JSON.stringify(stopped));

  /* Losing forty-four exports because the forty-fifth hit an edge would be the
     worst possible trade — so one bad item costs one item. */
  const isolated = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const B = await import('./src/export/batch.js');
    const P = await import('./src/presets/index.js');
    const T = await import('./src/image/templates.js');
    S.clearLibrary();
    const presets = Object.values(P.flatPresets('image'));
    // A template a preset actually uses — breaking an unused one proves nothing.
    const id = presets.map((r) => r['i-tpl']).find(Boolean);
    const keep = T.TEMPLATES[id].draw;
    T.TEMPLATES[id].draw = () => { throw new Error('boom'); };
    const res = await B.runBatch('screen-presets', { seconds: 0 });
    T.TEMPLATES[id].draw = keep;
    const rows = S.library.length;
    S.clearLibrary();
    return { made: res.made, failed: res.failed.length, why: res.failed[0], rows, total: presets.length, broke: id };
  });
  check('one item failing costs one item, not the batch',
    isolated.failed === 1 && isolated.made === isolated.total - 1 && isolated.rows === isolated.made,
    JSON.stringify(isolated));
  check('…and says which one, and why', /boom/.test(isolated.why || ''), String(isolated.why));

  /* A videoin clip draws the imported <video>, and a <video> only advances in
     wall-clock time — so a frame-indexed batch encode must SEEK it to each
     frame's instant first, or it exports one picture N times. Footage is
     synthesized through the studio's own encoder so the file is seekable. */
  const videoin = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const B = await import('./src/export/batch.js');
    const E = await import('./src/export/encoder.js');
    const M = await import('./src/media/import.js');
    const set = (id, v) => { const e = document.getElementById(id); e.value = v;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true })); };
    // 2s of real footage: a moving box, muxed by the studio's own WebM writer.
    const probe = await E.encodeClip({ width: 160, height: 120, fps: 15, frames: 30,
      container: 'webm', drawFrame: (x, t) => {
        x.fillStyle = '#000'; x.fillRect(0, 0, 160, 120);
        x.fillStyle = '#0f0'; x.fillRect((t * 60) % 150, 40, 10, 10);
      } });
    if (!probe) return { unsupported: true };
    await new Promise((r) => M.loadVideoFile(new File([probe.blob], 'probe.webm', { type: 'video/webm' }), r));
    document.querySelector('.tab[data-view=timeline]').click();
    document.getElementById('tl-clear').click();
    document.querySelector('.tab[data-view=video]').click();
    set('v-scene', 'videoin'); set('v-dur', '2'); S.addTimelineClip();
    S.editClip(0, { in: 0.2, out: 1.2 }, 'trim');
    let seeked = 0; const bump = () => seeked++;
    M._importedVideo.addEventListener('seeked', bump);
    S.clearLibrary();
    const res = await B.runBatch('timeline-clips', {});
    M._importedVideo.removeEventListener('seeked', bump);
    const rows = S.library.map((r) => ({ size: r.size, sec: +r.seconds.toFixed(2) }));
    S.clearLibrary();
    set('v-scene', 'terminal');
    return { made: res.made, failed: res.failed, seeked, rows };
  });
  check('a videoin timeline clip batch-exports with the footage seeked per frame',
    videoin.made === 1 && videoin.seeked >= 6,
    `${videoin.seeked} seeks, failed: ${JSON.stringify(videoin.failed)}`);
  check('…at its trimmed length, with real bytes in it',
    Math.abs(videoin.rows[0].sec - 1) < 0.05 && videoin.rows[0].size > 500, JSON.stringify(videoin.rows));

  /* Revoking the old clip's URL before the new file decodes left the active
     import backed by a dead URL whenever the new file failed — every later
     seek (GIF/strip export, the batch above) then stalled on seekVideo's
     400ms timeout. The probe import is still active; break the next one. */
  const survives = await page.evaluate(async () => {
    const M = await import('./src/media/import.js');
    const goodSrc = M._importedVideo.src;
    // A file no browser can decode; wait for its error to land.
    M.loadVideoFile(new File([new Uint8Array([1, 2, 3, 4])], 'bad.mp4', { type: 'video/mp4' }));
    await new Promise((r) => setTimeout(r, 800));
    const stillGood = M.hasImportedVideo() && M._importedVideo.src === goodSrc;
    // The proof the URL was not revoked: its bytes are still fetchable.
    let fetchable = false;
    try { fetchable = (await fetch(goodSrc)).ok; } catch (e) { fetchable = false; }
    return { stillGood, fetchable };
  });
  check('a failed import leaves the previous clip active AND its URL alive',
    survives.stillGood && survives.fetchable, JSON.stringify(survives));

  /* Timeline clips carry their own sound bed; the batch must lay it, like the
     sequence export does — a silent per-clip file contradicts "trimmed exactly
     as you cut it". An Opus track in a WebM announces itself: the OpusHead
     CodecPrivate is in the TrackEntry. */
  const bedded = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const B = await import('./src/export/batch.js');
    const L = await import('./src/library/library.js');
    const W = await import('./src/audio/wav.js');
    const set = (id, v) => { const e = document.getElementById(id); e.value = v;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true })); };
    S.clearLibrary();
    // A real 1s mono wav in the library to use as the bed.
    const sr = 48000, ch = [new Float32Array(sr)];
    for (let i = 0; i < sr; i++) ch[0][i] = Math.sin(i / 30) * 0.4;
    const row = L.addToLibrary(W.encodeWav(ch, sr, 16), 'wav', 'music', 'probe-bed', 1);
    document.querySelector('.tab[data-view=timeline]').click();
    document.getElementById('tl-clear').click();
    document.querySelector('.tab[data-view=video]').click();
    set('v-scene', 'terminal'); set('v-dur', '2'); S.addTimelineClip();
    S.editClip(0, { bed: 'lib:' + row.key }, 'clip bed');
    const res = await B.runBatch('timeline-clips', {});
    const clip = S.library.find((r) => r.kind === 'videos');
    const bytes = clip ? new Uint8Array(await clip.blob.arrayBuffer()) : new Uint8Array(0);
    const sig = [...'OpusHead'].map((c) => c.charCodeAt(0));
    let hasOpus = false;
    outer: for (let i = 0; i < bytes.length - sig.length; i++) {
      for (let j = 0; j < sig.length; j++) if (bytes[i + j] !== sig[j]) continue outer;
      hasOpus = true; break;
    }
    document.getElementById('tl-clear').click();
    S.clearLibrary();
    return { made: res.made, failed: res.failed, hasOpus, size: clip ? clip.size : 0 };
  });
  check('a clip\'s own bed is muxed into its batch export',
    bedded.made === 1 && bedded.hasOpus,
    JSON.stringify({ made: bedded.made, hasOpus: bedded.hasOpus, size: bedded.size, failed: bedded.failed }));

  /* A batch has no real-time fallback, so when WebCodecs is missing it must
     say WHY once, up front — not fail forty-five items with the same blank
     "nothing rendered" message. */
  const noWC = await page.evaluate(async () => {
    const B = await import('./src/export/batch.js');
    const keep = window.VideoEncoder;
    window.VideoEncoder = undefined;
    let err = null;
    try { await B.runBatch('video-presets', { seconds: 1 }); } catch (e) { err = e.message; }
    window.VideoEncoder = keep;
    return { err };
  });
  check('a video batch without WebCodecs refuses up front, with the reason',
    /WebCodecs/.test(noWC.err || ''), String(noWC.err));
}

/* =========================================== animated stills beyond GIF ==== */
/* GIF is 256 colours and one bit of transparency, and it survives because it
   plays absolutely everywhere. APNG and animated WebP are what you want when
   the target can take them. Neither needed a new encoder — APNG is PNG chunks
   around zlib streams CompressionStream produces, animated WebP is a container
   around the VP8 payloads canvas.toBlob already makes — so what is checked here
   is the muxing, parsed back out of the bytes. */
section('animated stills beyond GIF');
{
  // Frames with a moving black bar, so "did the frames actually differ" is a
  // question the bytes can answer.
  const MK = `(n, w, h) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d');
      x.fillStyle = 'hsl(' + (i * 40) + ' 90% 55%)'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#000'; x.fillRect((i * 3) % w, 0, 8, h);
      out.push(c);
    }
    return out;
  }`;

  const apng = await page.evaluate(async (mk) => {
    const A = await import('./src/export/anim.js');
    const blob = await A.encodeAPNG(eval(mk)(6, 32, 24), { delayMs: 80 });
    const u = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(u.buffer);
    const tbl = (() => { const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
      return t; })();
    const crc = (b) => { let c = 0xffffffff;
      for (let i = 0; i < b.length; i++) c = tbl[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunks = [];
    let at = 8, badCrc = 0;
    while (at + 8 <= u.length) {
      const len = dv.getUint32(at);
      const type = String.fromCharCode(u[at + 4], u[at + 5], u[at + 6], u[at + 7]);
      if (dv.getUint32(at + 8 + len) !== crc(u.subarray(at + 4, at + 8 + len))) badCrc++;
      chunks.push({ type, body: u.subarray(at + 8, at + 8 + len) });
      at += 12 + len;
      if (type === 'IEND') break;
    }
    const types = chunks.map((c) => c.type);
    const fcTL = chunks.find((c) => c.type === 'fcTL');
    const fdATs = chunks.filter((c) => c.type === 'fdAT');
    const key = (b) => b.length + ':' + Array.from(b.subarray(0, 40)).join(',');
    return { bytes: u.length, badCrc, consumedAll: at === u.length,
             sig: [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => u[i] === b),
             types: types.join(','),
             nIDAT: types.filter((t) => t === 'IDAT').length,
             nfdAT: fdATs.length, nfcTL: types.filter((t) => t === 'fcTL').length,
             acBeforeIDAT: types.indexOf('acTL') >= 0 && types.indexOf('acTL') < types.indexOf('IDAT'),
             // fcTL delay is a RATIONAL: numerator/denominator, not milliseconds.
             delayNum: fcTL && ((fcTL.body[20] << 8) | fcTL.body[21]),
             delayDen: fcTL && ((fcTL.body[22] << 8) | fcTL.body[23]),
             distinctFrames: new Set(fdATs.map((c) => key(c.body))).size };
  }, MK);
  check('an APNG is a real PNG, chunk for chunk', apng.sig && apng.consumedAll && apng.badCrc === 0,
    `${apng.badCrc} bad CRCs, ${apng.bytes} bytes, ${apng.types}`);
  /* acTL after the first IDAT makes it a still PNG with junk appended, which is
     the single easiest way to get this wrong. */
  check('…with acTL before the first IDAT, so it is animated at all', apng.acBeforeIDAT);
  check('…first frame in IDAT and the rest in fdAT, one fcTL each',
    apng.nIDAT === 1 && apng.nfdAT === 5 && apng.nfcTL === 6,
    `IDAT ${apng.nIDAT}, fdAT ${apng.nfdAT}, fcTL ${apng.nfcTL}`);
  check('…the delay is a rational, so 80ms is exactly 80ms',
    apng.delayNum === 80 && apng.delayDen === 1000, `${apng.delayNum}/${apng.delayDen}`);
  /* Structure proves it CLAIMS six frames; distinct payloads prove there are
     six different pictures rather than one repeated. */
  check('…and the frames are genuinely different pictures',
    apng.distinctFrames === 5, `${apng.distinctFrames} distinct of 5`);

  const apngDecode = await page.evaluate(async (mk) => {
    const A = await import('./src/export/anim.js');
    const blob = await A.encodeAPNG(eval(mk)(5, 40, 30), { delayMs: 60 });
    const url = URL.createObjectURL(blob);
    const r = await new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let opaque = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) opaque++;
        res({ w: img.width, h: img.height, opaque, of: c.width * c.height });
      };
      img.onerror = () => res({ error: 'decode failed' });
      setTimeout(() => res({ error: 'timeout' }), 6000);
      img.src = url;
    });
    URL.revokeObjectURL(url);
    return r;
  }, MK);
  check('…and the browser actually decodes it',
    apngDecode.w === 40 && apngDecode.h === 30 && apngDecode.opaque === apngDecode.of,
    JSON.stringify(apngDecode));

  const webp = await page.evaluate(async (mk) => {
    const A = await import('./src/export/anim.js');
    const supported = await A.webpSupported();
    if (!supported) return { supported };
    const blob = await A.encodeAnimatedWebP(eval(mk)(6, 32, 24), { delayMs: 80 });
    if (!blob) return { supported, blob: null };
    const u = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(u.buffer);
    const tag = (at) => String.fromCharCode(u[at], u[at + 1], u[at + 2], u[at + 3]);
    const chunks = [];
    let at = 12;
    while (at + 8 <= u.length) {
      const size = dv.getUint32(at + 4, true);
      chunks.push({ type: tag(at), body: u.subarray(at + 8, at + 8 + size) });
      at += 8 + size + (size & 1);
    }
    const anmf = chunks.filter((c) => c.type === 'ANMF');
    const key = (b) => b.length + ':' + Array.from(b.subarray(16, 56)).join(',');
    return { supported, bytes: u.length, riff: tag(0), webp: tag(8),
             declared: dv.getUint32(4, true), actual: u.length - 8,
             types: chunks.map((c) => c.type).join(','), nANMF: anmf.length,
             consumedAll: at === u.length,
             animFlag: (u[20] & 0x02) === 0x02,
             // ANMF duration is 24-bit LE, at offset 12 of the frame header.
             duration: anmf[0] && (anmf[0].body[12] | (anmf[0].body[13] << 8) | (anmf[0].body[14] << 16)),
             distinctFrames: new Set(anmf.map((c) => key(c.body))).size };
  }, MK);
  check('the browser can encode WebP stills at all', webp.supported === true, JSON.stringify(webp));
  check('an animated WebP is a well-formed RIFF, with its declared size honest',
    webp.riff === 'RIFF' && webp.webp === 'WEBP' && webp.declared === webp.actual && webp.consumedAll,
    `${webp.declared} declared vs ${webp.actual}`);
  /* Without VP8X and its animation bit a decoder reads the first frame and
     stops — which looks like a working still and is the other easy mistake. */
  check('…announcing the animation in VP8X, then ANIM, then one ANMF per frame',
    webp.animFlag && /^VP8X,ANIM,ANMF/.test(webp.types) && webp.nANMF === 6, webp.types);
  check('…each ANMF carrying the frame duration', webp.duration === 80, String(webp.duration));
  check('…and six genuinely different pictures', webp.distinctFrames === 6,
    `${webp.distinctFrames} distinct of 6`);

  const webpDecode = await page.evaluate(async (mk) => {
    const A = await import('./src/export/anim.js');
    if (!await A.webpSupported()) return { skipped: true };
    const blob = await A.encodeAnimatedWebP(eval(mk)(5, 40, 30), { delayMs: 60 });
    const url = URL.createObjectURL(blob);
    const r = await new Promise((res) => {
      const img = new Image();
      img.onload = () => res({ w: img.width, h: img.height });
      img.onerror = () => res({ error: 'decode failed' });
      setTimeout(() => res({ error: 'timeout' }), 6000);
      img.src = url;
    });
    URL.revokeObjectURL(url);
    return r;
  }, MK);
  check('…and the browser actually decodes it', webpDecode.w === 40 && webpDecode.h === 30,
    JSON.stringify(webpDecode));

  /* The reason to offer three formats is that they are genuinely different
     trades. If WebP were not the smallest, the advice in the UI would be wrong. */
  const sizes = await page.evaluate(async (mk) => {
    const A = await import('./src/export/anim.js');
    const G = await import('./src/video/gif.js');
    const frames = eval(mk)(10, 120, 90);
    const apngBlob = await A.encodeAPNG(frames, { delayMs: 100 });
    const webpBlob = await A.encodeAnimatedWebP(frames, { delayMs: 100 });
    const rgba = frames.map((f) => f.getContext('2d').getImageData(0, 0, 120, 90).data);
    return { apng: apngBlob.size, webp: webpBlob ? webpBlob.size : null,
             gif: G.encodeGif(rgba, 120, 90, 10).size };
  }, MK);
  check('WebP is the smallest of the three, which is why it is the one to upload',
    sizes.webp < sizes.apng && sizes.webp < sizes.gif, JSON.stringify(sizes));

  const refused = await page.evaluate(async () => {
    const A = await import('./src/export/anim.js');
    const err = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
    const zero = document.createElement('canvas'); zero.width = 0; zero.height = 0;
    return { empty: await err(() => A.encodeAPNG([])),
             emptyWebp: await err(() => A.encodeAnimatedWebP([])),
             zero: await err(() => A.encodeAPNG([zero])) };
  });
  check('an empty or zero-sized encode is refused rather than written',
    /nothing to encode/.test(refused.empty) && /nothing to encode/.test(refused.emptyWebp)
    && /zero-sized/.test(refused.zero), JSON.stringify(refused));

  const wired = await page.evaluate(() => ({
    apng: !!document.getElementById('v-apng'),
    awebp: !!document.getElementById('v-awebp'),
    label: document.querySelector('label[for="v-giffps"]')?.textContent,
  }));
  check('both sit beside the .gif button, sharing its frame rate',
    wired.apng && wired.awebp && wired.label === 'Anim fps', JSON.stringify(wired));

  /* 2×SS IS A CHECKBOX ON THE SAME PANEL AS THESE BUTTONS.
     collectFrames — the frame source for all four still exporters (.gif, .apng,
     .webp, frame strip) — called renderVideoFrame directly instead of
     renderScaled, so the box did nothing here while the preview, both RECORD
     paths and the batch all honoured it. Measured on a scene with a diagonal:
     supersampling changes the anti-aliasing, so the frames differ. */
  const ss = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const C = await import('./src/video/capture.js');
    const set = (id, v) => { const e = document.getElementById(id); e.value = v;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true })); };
    const tick = (id, on) => { const e = document.getElementById(id); e.checked = on;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true })); };
    document.querySelector('.tab[data-view=video]').click();
    set('v-scene', 'radar'); set('v-w', '160'); set('v-h', '120'); set('v-dur', '2');
    const grab = async () => {
      const frames = await C.collectFrames(S.readVideoCfg(), 3, {});
      return frames.map((f) => {
        const d = f.getContext('2d').getImageData(0, 0, f.width, f.height).data;
        let h = 2166136261;
        for (let i = 0; i < d.length; i += 3) { h ^= d[i]; h = Math.imul(h, 16777619); }
        return h >>> 0;
      }).join(',');
    };
    tick('v-ss', false);
    const plain = await grab();
    const plainAgain = await grab();
    tick('v-ss', true);
    const supersampled = await grab();
    tick('v-ss', false);
    return { plain, plainAgain, supersampled };
  });
  check('the still exporters honour 2×SS',
    ss.supersampled !== ss.plain, `${ss.plain} vs ${ss.supersampled}`);
  check('…and are otherwise deterministic, so that difference is the SS and not noise',
    ss.plain === ss.plainAgain, `${ss.plain} vs ${ss.plainAgain}`);

  /* ■ STOP HAS TO REACH THE ENCODE, WHICH IS THE SLOW HALF.
     The frame collector honoured the cancel flag and these two encoders did not,
     so pressing STOP once collection had finished did nothing at all — and this
     path never showed a progress bar either, so there was no way to tell the
     difference between working and hung. Both now poll between frames and
     report, and a cancelled encode returns null (the caller tells that apart
     from "no encoder for this format" by asking the flag again). */
  const stoppable = await page.evaluate(async (mk) => {
    const A = await import('./src/export/anim.js');
    const frames = eval(mk)(12, 32, 24);
    const out = {};
    for (const [name, fn] of [['apng', A.encodeAPNG], ['webp', A.encodeAnimatedWebP]]) {
      if (name === 'webp' && !await A.webpSupported()) { out[name] = { skipped: true }; continue; }
      const seen = [];
      // Cancels after the third frame, the way ■ STOP does mid-encode.
      const blob = await fn(frames, { delayMs: 60,
        onProgress: (p) => seen.push(p),
        cancelled: () => seen.length >= 3 });
      // And a run with the same options but never cancelled still produces a file.
      const full = await fn(frames, { delayMs: 60, onProgress: () => {}, cancelled: () => false });
      out[name] = { cancelledToNull: blob === null, framesBeforeStop: seen.length,
                    progressRose: seen.length > 1 && seen[seen.length - 1] > seen[0],
                    lastProgress: seen[seen.length - 1],
                    completesWhenNotCancelled: !!(full && full.size > 0) };
    }
    return out;
  }, MK);
  for (const kind of ['apng', 'webp']) {
    const r = stoppable[kind];
    if (r.skipped) { check(`${kind}: skipped, no encoder here`, true); continue; }
    check(`a cancel lands inside the ${kind} encode, not after it`,
      r.cancelledToNull === true && r.framesBeforeStop < 12,
      `${r.framesBeforeStop} of 12 frames`);
    check(`…and the ${kind} encode reports where it is`,
      r.progressRose === true, `progress rose to ${r.lastProgress}`);
    check(`…while an uncancelled ${kind} encode still writes a file`,
      r.completesWhenNotCancelled === true);
  }

  /* And the panel wires both halves of the bar to it: rendering is the first
     half, encoding the second, exactly as the GIF exporter splits it. */
  const wiredStop = await page.evaluate(async () => {
    const src = await (await fetch('./src/video/gif.js')).text();
    const fn = src.slice(src.indexOf('async function exportAnimated'));
    const body = fn.slice(0, fn.indexOf('\nexport const exportAPNG'));
    return {
      showsBar: /v-progress-wrap"\)/.test(body) && /wrap\.style\.display="block"/.test(body),
      halves: /setP\(p\*0\.5/.test(body) && /setP\(0\.5\+0\.5\*p/.test(body),
      passesCancel: /cancelled:stillExportCancelled/.test(body),
    };
  });
  check('the animated-still exporter shows a progress bar and splits it in two',
    wiredStop.showsBar && wiredStop.halves, JSON.stringify(wiredStop));
  check('…and hands the cancel flag to the encoder', wiredStop.passesCancel);
}

/* ================================================ sound per clip ========= */
/* The sequence took ONE bed for its whole length — the last loose end from the
   sound work. A room tone running the whole way through with a phone ringing
   over clip three is the ordinary case, and it needed two controls that
   compose rather than one that replaces. */
section('sound per clip');
{
  const build = async () => page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      if (e.type === 'checkbox') e.checked = !!v; else e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.querySelector('.tab[data-view=timeline]').click();
    document.getElementById('tl-clear').click();
    document.querySelector('.tab[data-view=video]').click();
    set('v-scene', 'terminal'); set('v-text', 'ONE'); set('v-dur', '3'); S.addTimelineClip();
    set('v-scene', 'matrix'); set('v-text', 'TWO'); set('v-dur', '3'); S.addTimelineClip();
    document.querySelector('.tab[data-view=timeline]').click();
  });
  await build();

  const model = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const D = await import('./src/doc/timeline.js');
    return { defaults: S.timeline.map((c) => c.bed),
             kept: D.makeClip({ dur: 4, bed: 'lib:abc' }).bed,
             junk: D.makeClip({ dur: 4, bed: 42 }).bed,
             capped: D.makeClip({ dur: 4, bed: 'x'.repeat(500) }).bed.length,
             legacy: D.makeClip({ dur: 4 }).bed };
  });
  check('a clip carries a bed, defaulting to none',
    model.defaults.every((b) => b === '') && model.legacy === '', JSON.stringify(model.defaults));
  check('…kept as authored, so an unloaded library key survives the round trip',
    model.kept === 'lib:abc' && model.junk === '' && model.capped === 200, JSON.stringify(model));

  const table = await page.evaluate(() => ({
    pickers: document.querySelectorAll('#tl-body select[data-k="bed"]').length,
    headers: [...document.querySelectorAll('#tl-table thead th')].map((t) => t.textContent.trim()),
    cols: document.querySelectorAll('#tl-body tr:first-child td').length,
  }));
  check('every row gets its own sound picker, under a column that says so',
    table.pickers === 2 && table.headers.includes('sound') && table.cols === table.headers.length,
    JSON.stringify(table));

  /* Render something first, so there is a real bed to choose rather than an
     empty list that would make every assertion below vacuous. */
  const picked = await page.evaluate(async () => {
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      if (e.type === 'checkbox') e.checked = !!v; else e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.querySelector('.tab[data-view=audio]').click();
    set('a-dur', 1); set('a-drone', true);
    document.getElementById('a-render').click();
    await new Promise((r) => setTimeout(r, 1500));
    document.querySelector('.tab[data-view=timeline]').click();
    const S = window.DeadSignalStudio;
    const sel = document.querySelector('#tl-body select[data-k="bed"]');
    const opts = [...sel.options].map((o) => o.value);
    sel.value = 'last';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { opts, doc: S.store.get('timeline.clips').map((c) => c.bed) };
  });
  check('the picker offers silence, the last render and the library',
    picked.opts.includes('') && picked.opts.includes('last') && picked.opts.some((o) => o.startsWith('lib:')),
    JSON.stringify(picked.opts));
  check('…and choosing one reaches the document', picked.doc[0] === 'last' && picked.doc[1] === '',
    JSON.stringify(picked.doc));

  const round = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const before = S.timeline.map((c) => c.bed);
    S.applyProject(JSON.parse(JSON.stringify(S.readProject())));
    return { before, after: S.timeline.map((c) => c.bed) };
  });
  check('…surviving the project round trip', JSON.stringify(round.before) === JSON.stringify(round.after),
    JSON.stringify(round.after));

  /* The claim that matters: a clip's bed plays WHEN THAT CLIP DOES. With only
     the second clip carrying sound, the energy has to be in the second half. */
  const placed = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const B = await import('./src/audio/bed.js');
    const D = await import('./src/doc/timeline.js');
    const sched = S.buildSchedule();
    const mixed = await B.buildSequenceBed(sched.total, '',
      sched.clips.map((c, i) => ({ choice: i === 1 ? 'last' : '', at: sched.starts[i], seconds: D.clipLength(c) })));
    if (!mixed) return { none: true };
    const d = mixed.getChannelData(0);
    const half = Math.floor(d.length / 2);
    let a = 0, b = 0;
    for (let i = 0; i < half; i++) a += Math.abs(d[i]);
    for (let i = half; i < d.length; i++) b += Math.abs(d[i]);
    return { seconds: +(d.length / 48000).toFixed(2), total: +sched.total.toFixed(2),
             first: +a.toFixed(1), second: +b.toFixed(1) };
  });
  check('a clip\'s bed plays at the time that clip starts, not at zero',
    placed.second > placed.first * 4, JSON.stringify(placed));
  check('…and the mix is exactly as long as the sequence',
    Math.abs(placed.seconds - placed.total) < 0.02, `${placed.seconds} vs ${placed.total}`);

  /* Two controls that COMPOSE. If a per-clip bed replaced the sequence bed
     instead of laying over it, the mix would not get louder. */
  const composed = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const B = await import('./src/audio/bed.js');
    const D = await import('./src/doc/timeline.js');
    const sched = S.buildSchedule();
    const energy = (buf) => { const d = buf.getChannelData(0); let s = 0;
      for (let i = 0; i < d.length; i++) s += Math.abs(d[i]); return s; };
    const seqOnly = await B.buildSequenceBed(sched.total, 'last', []);
    const both = await B.buildSequenceBed(sched.total, 'last',
      sched.clips.map((c, i) => ({ choice: i === 1 ? 'last' : '', at: sched.starts[i], seconds: D.clipLength(c) })));
    return { seqOnly: Math.round(energy(seqOnly)), both: Math.round(energy(both)) };
  });
  check('a per-clip bed lays OVER the sequence bed rather than replacing it',
    composed.both > composed.seqOnly * 1.2, JSON.stringify(composed));

  const empty = await page.evaluate(async () => {
    const B = await import('./src/audio/bed.js');
    return { none: await B.buildSequenceBed(5, '', [{ choice: '', at: 0, seconds: 2 }]) === null,
             seqOnly: !!(await B.buildSequenceBed(5, 'last', [{ choice: '', at: 0, seconds: 2 }])) };
  });
  check('no sound anywhere is silence, not a buffer of zeros pretending to be audio',
    empty.none && empty.seqOnly, JSON.stringify(empty));
}

/* ============================ you can hear the sequence while you cut it === */
/* The state machine is pinned headless against a fake context
   (test-studio-document.mjs). What only a browser can settle is the part that
   depends on a REAL autoplay policy and a REAL render loop: that a trusted
   click unblocks audio, that the mixdown actually gets built and played, and
   that the picture then follows the audio clock rather than wall time.
   Deliberately placed after "sound per clip" so there is already a rendered
   bed to hear. */
section('preview sound — hearing the cut you are making');
{
  const ui = await page.evaluate(() => {
    document.querySelector('.tab[data-view=timeline]').click();
    const b = document.getElementById('tl-sound');
    return { there: !!b, name: (b?.textContent || '').trim(), pressed: b?.getAttribute('aria-pressed'),
             titled: !!b?.title, inScrub: !!b?.closest('.scrub') };
  });
  check('the sequence has a SOUND button, beside the transport where sound belongs',
    ui.there && ui.inScrub && /SOUND|MUTED/.test(ui.name), JSON.stringify(ui));
  check('…announced as a toggle rather than as a nameless glyph',
    ui.pressed === 'true' && /\w/.test(ui.name) && ui.titled, JSON.stringify(ui));

  const toggled = await page.evaluate(async () => {
    const P = await import('./src/audio/preview.js');
    const b = document.getElementById('tl-sound');
    b.click();
    const off = { pressed: b.getAttribute('aria-pressed'), on: P.previewSoundOn(),
                  stored: localStorage.getItem('deadsignal.studio.previewsound'), label: b.textContent.trim() };
    b.click();
    return { off, on: { pressed: b.getAttribute('aria-pressed'), on: P.previewSoundOn(),
                        stored: localStorage.getItem('deadsignal.studio.previewsound') } };
  });
  check('pressing it mutes the preview, says so, and remembers it',
    toggled.off.pressed === 'false' && toggled.off.on === false && toggled.off.stored === '0'
    && /MUTED/.test(toggled.off.label), JSON.stringify(toggled.off));
  check('…and pressing it again brings the sound back',
    toggled.on.pressed === 'true' && toggled.on.on === true && toggled.on.stored === '1',
    JSON.stringify(toggled.on));

  /* Everything below needs a trusted click: a context created without one is
     born suspended, which is exactly the condition the module refuses to run
     in. page.click() dispatches a real gesture; dispatchEvent would not. */
  const armed = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    // Give clip one a bed so there is something to build.
    S.editClip(0, { bed: 'last' }, 'test bed');
    return { beds: S.timeline.map((c) => c.bed) };
  });
  check('the sequence under test actually carries sound', armed.beds[0] === 'last', JSON.stringify(armed.beds));

  /* One click is the gesture. A second only if that click happened to be the
     one that PAUSED — earlier sections drive every control on the tab, and
     touching the scrubber stops the preview, so which way the toggle is facing
     when we get here is not something to assume. */
  const paused = () => page.evaluate(() => document.getElementById('tl-playpause').textContent.trim() === '▶');
  await page.click('#tl-playpause');
  if (await paused()) await page.click('#tl-playpause');
  await page.waitForTimeout(1200);
  check('the preview is running, which is what the rest of this section measures',
    (await paused()) === false);

  const playing = await page.evaluate(async () => {
    const P = await import('./src/audio/preview.js');
    const S = window.DeadSignalStudio;
    return { state: P.previewAudioState(), clock: P.sequenceAudioTime(),
             total: +S.buildSchedule().total.toFixed(2) };
  });
  check('a trusted click unblocks a real AudioContext',
    playing.state.context === 'running', JSON.stringify(playing.state));
  check('…and the sequence mixdown is built and playing under the preview',
    playing.state.playing === true && Math.abs(playing.state.total - playing.total) < 0.05,
    JSON.stringify(playing));

  /* THE claim. Two clocks that both say where the sequence is will drift, and
     the one the speakers use is the one the author can hear — so the readout
     has to be the audio clock, not performance.now(). Sampled twice: the
     numbers must agree AND must be moving. */
  const follows = await page.evaluate(async () => {
    const P = await import('./src/audio/preview.js');
    const read = () => ({ shown: parseFloat(document.getElementById('tl-time').textContent),
                          clock: P.sequenceAudioTime() });
    const a = read();
    await new Promise((r) => setTimeout(r, 500));
    const b = read();
    return { a, b, fps: +document.getElementById('tl-fps').value };
  });
  check('the picture runs on the audio clock, not on wall time', (() => {
    const tol = 1 / Math.max(4, follows.fps) + 0.12;   // one frame, plus a beat of scheduling slack
    return Math.abs(follows.a.shown - follows.a.clock) < tol
        && Math.abs(follows.b.shown - follows.b.clock) < tol;
  })(), JSON.stringify(follows));
  check('…and both of them are actually moving',
    follows.b.clock !== follows.a.clock && follows.b.shown !== follows.a.shown, JSON.stringify(follows));

  /* Muting must not take the picture with it: the fallback to wall time is
     what makes preview sound an addition rather than a dependency. */
  await page.click('#tl-sound');
  await page.waitForTimeout(400);
  const muted = await page.evaluate(async () => {
    const P = await import('./src/audio/preview.js');
    const t0 = parseFloat(document.getElementById('tl-time').textContent);
    await new Promise((r) => setTimeout(r, 500));
    return { clock: P.sequenceAudioTime(), playing: P.previewAudioState().playing,
             t0, t1: parseFloat(document.getElementById('tl-time').textContent) };
  });
  check('muting stops the sound rather than muting a node that still holds the clock',
    muted.playing === false && muted.clock === null, JSON.stringify(muted));
  check('…and the picture carries on regardless, back on wall time',
    muted.t1 !== muted.t0, JSON.stringify(muted));
  await page.click('#tl-sound');
  await page.waitForTimeout(600);

  /* Leaving the tab has to take the sound with it — the studio has one other
     preview loop and two exporters, and none of them wants a sequence playing
     underneath. stopTimelinePreview() is the single choke point. */
  const left = await page.evaluate(async () => {
    const P = await import('./src/audio/preview.js');
    const before = P.previewAudioState().playing;
    document.querySelector('.tab[data-view=video]').click();
    await new Promise((r) => setTimeout(r, 200));
    const after = P.previewAudioState();
    document.querySelector('.tab[data-view=timeline]').click();
    return { before, after };
  });
  check('leaving the SEQUENCE tab stops the sound with the picture',
    left.before === true && left.after.playing === false, JSON.stringify(left));
  check('…but keeps the context, so coming back needs no second gesture',
    left.after.context === 'running', JSON.stringify(left.after));

  /* A silent sequence must cost nothing. A decode plus an offline render per
     part on every commit is exactly what the signature cache exists to avoid,
     and a sequence with no sound in it should not even get that far. */
  const silent = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const T = await import('./src/video/timeline.js');
    const P = await import('./src/audio/preview.js');
    S.editClip(0, { bed: '' }, 'test silence');
    await new Promise((r) => setTimeout(r, 300));
    const armedAnyway = await T.armPreviewSound(S.buildSchedule());
    const t0 = parseFloat(document.getElementById('tl-time').textContent);
    await new Promise((r) => setTimeout(r, 400));
    return { armedAnyway, playing: P.previewAudioState().playing,
             moved: parseFloat(document.getElementById('tl-time').textContent) !== t0 };
  });
  check('a sequence with no sound in it builds no mixdown',
    silent.armedAnyway === false && silent.playing === false, JSON.stringify(silent));
  check('…and previews exactly as it did before any of this existed', silent.moved === true,
    JSON.stringify(silent));

  const same = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const M = await import('./src/doc/audiomix.js');
    S.editClip(0, { bed: 'last' }, 'test bed');
    const sched = S.buildSchedule();
    const parts = M.mixParts({ ...sched, audio: S.audioTimeline }, document.getElementById('tl-audio').value);
    const exported = await S.sequenceMix(sched);
    return { sig: M.mixSignature(parts), hasSound: M.hasSound(parts),
             exportedSeconds: exported ? +exported.duration.toFixed(2) : null,
             total: +sched.total.toFixed(2) };
  });
  check('the preview and the export describe the same mix, from the same place',
    same.hasSound === true && Math.abs(same.exportedSeconds - same.total) < 0.05, JSON.stringify(same));
  check('…and that description is a stable string, so it can be cached against',
    typeof same.sig === 'string' && same.sig.length > 0 && same.sig.includes('last'), same.sig);

  // Hand the tab back as it was found: silent sequence, no context, no source.
  await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const P = await import('./src/audio/preview.js');
    S.editClip(0, { bed: '' }, 'test cleanup');
    await P.closeSequenceAudio();
  });
}

/* ===================== a clip has a position in the frame now ============ */
/* The maths is pinned headless (test-studio-document.mjs). What only a browser
   can settle is whether the compositor USES it — a transform that normalises
   correctly and never reaches ctx.transform() looks identical in every unit
   test and does nothing on screen. So every claim here is counted in pixels. */
section('transform — the clip actually moves');
{
  /* One clip, one scene that fills the frame, so "where is the ink" is a
     question with an answer. Rendered off-screen at the sequence's own size and
     scanned rather than hashed: a hash says two frames differ, and what needs
     proving is WHERE they differ. */
  const shot = (t = 1) => page.evaluate((t) => {
    const S = window.DeadSignalStudio;
    const s = S.buildSchedule();
    const c = document.createElement('canvas');
    c.width = s.tl.W; c.height = s.tl.H;
    const ctx = c.getContext('2d');
    S.renderTimelineFrame(ctx, t, s);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const quad = [0, 0, 0, 0];
    let ink = 0; let hash = 5381; let border = 0;
    const edge = Math.max(2, Math.round(Math.min(c.width, c.height) * 0.02));
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const p = (y * c.width + x) * 4;
        const lum = d[p] + d[p + 1] + d[p + 2];
        hash = (((hash * 33) ^ lum) >>> 0);
        if (lum <= 24) continue;                       // near-black is "no picture"
        ink++;
        quad[(y < c.height / 2 ? 0 : 2) + (x < c.width / 2 ? 0 : 1)]++;
        if (x < edge || y < edge || x >= c.width - edge || y >= c.height - edge) border++;
      }
    }
    return { ink, quad, hash, border, W: c.width, H: c.height };
  }, t);
  const edit = (patch) => page.evaluate((patch) =>
    window.DeadSignalStudio.editClip(0, patch, 'test transform'), patch);

  await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      if (e.type === 'checkbox') e.checked = !!v; else e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.querySelector('.tab[data-view=timeline]').click();
    document.getElementById('tl-clear').click();
    document.querySelector('.tab[data-view=video]').click();
    set('v-scene', 'matrix'); set('v-text', 'TRANSFORM'); set('v-dur', '4');
    S.addTimelineClip();
    document.querySelector('.tab[data-view=timeline]').click();
  });

  const base = await shot();
  check('the clip fills the frame and reaches every corner',
    base.ink > base.W * base.H * 0.05 && base.quad.every((q) => q > 0) && base.border > 0,
    JSON.stringify(base));

  /* Writing the identity is not an edit, and must not be a different picture
     either — this is the guarantee that every sequence made before clips had a
     position renders exactly as it did. */
  await edit({ x: 0, y: 0, scale: 1, rot: 0, flip: 'none' });
  const same = await shot();
  check('writing the identity changes nothing, to the pixel', same.hash === base.hash,
    `${same.hash} vs ${base.hash}`);

  await edit({ scale: 0.5 });
  const half = await shot();
  check('half scale draws about a quarter as much picture',
    half.ink > base.ink * 0.15 && half.ink < base.ink * 0.35, `${half.ink} of ${base.ink}`);
  check('…and the frame’s edge goes black around it, which is what a punch-out is',
    half.border === 0, `${half.border} lit border pixels`);

  await edit({ x: 0.25, y: 0.25 });
  const corner = await shot();
  check('a corner preset puts the whole clip in that corner',
    corner.quad[3] > corner.ink * 0.9 && corner.quad[0] === 0, JSON.stringify(corner.quad));

  await edit({ x: 1.5 });
  const gone = await shot();
  check('pushed off the side, it renders as nothing at all — which is why the panel warns',
    gone.ink === 0, JSON.stringify(gone));

  /* Non-destructive: everything above is one field write away from being undone,
     and the picture has to come back byte for byte. */
  await edit({ x: 0, y: 0, scale: 1, rot: 0, flip: 'none' });
  const back = await shot();
  check('and all of it reverts to the original picture exactly', back.hash === base.hash,
    `${back.hash} vs ${base.hash}`);

  /* Mirroring needs a composition with a side to it: digital rain is
     statistically symmetric, so a terminal's left-aligned copy is the honest
     test. */
  await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.getElementById('tl-clear').click();
    document.querySelector('.tab[data-view=video]').click();
    set('v-scene', 'terminal'); set('v-text', 'LEFT EDGE\nTEXT'); set('v-dur', '4');
    S.addTimelineClip();
    document.querySelector('.tab[data-view=timeline]').click();
  });
  const plain = await shot(2);
  await edit({ flip: 'h' });
  const mirrored = await shot(2);
  const leftOf = (s) => s.quad[0] + s.quad[2];
  const rightOf = (s) => s.quad[1] + s.quad[3];
  check('a mirror moves the picture to the other side of the frame',
    leftOf(plain) > rightOf(plain) && rightOf(mirrored) > leftOf(mirrored),
    `${JSON.stringify(plain.quad)} → ${JSON.stringify(mirrored.quad)}`);
  check('…without losing any of it — the same ink, on the other side',
    Math.abs(mirrored.ink - plain.ink) < plain.ink * 0.05, `${mirrored.ink} vs ${plain.ink}`);

  await edit({ flip: 'none', rot: 90 });
  const turned = await shot(2);
  check('a quarter turn is a different picture, still on screen',
    turned.hash !== plain.hash && turned.ink > 0, JSON.stringify({ ink: turned.ink }));
  await edit({ rot: 0 });

  /* The reason the transform exists: an overlay that does not simply replace
     the picture underneath it. */
  const pip = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.querySelector('.tab[data-view=video]').click();
    set('v-scene', 'matrix'); set('v-dur', '4');
    S.addOverlayClip(0);
    document.querySelector('.tab[data-view=timeline]').click();
    const k = S.timeline.findIndex((c) => c.track === 'V2');
    S.editClip(k, { x: 0.25, y: 0.25, scale: 0.5, blend: 'source-over' }, 'test pip');
    const s = S.buildSchedule();
    const c = document.createElement('canvas');
    c.width = s.tl.W; c.height = s.tl.H;
    const ctx = c.getContext('2d');
    S.renderTimelineFrame(ctx, 2, s);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const quad = [0, 0, 0, 0];
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const p = (y * c.width + x) * 4;
        if (d[p] + d[p + 1] + d[p + 2] <= 24) continue;
        quad[(y < c.height / 2 ? 0 : 2) + (x < c.width / 2 ? 0 : 1)]++;
      }
    }
    return { quad, k };
  });
  check('an inset overlay leaves the spine visible around it — picture in picture',
    pip.quad[3] > 0 && pip.quad[0] > 0, JSON.stringify(pip));

  const panel = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const U = await import('./src/ui/track.js');
    U.focusClipAfterRender(0);
    const I = await import('./src/ui/inspector.js');
    I.render();
    const titles = [...document.querySelectorAll('.insp-group-title')].map((n) => n.textContent);
    const ids = [...document.querySelectorAll('#nle-insp-body [id^="insp-"]')].map((n) => n.id);
    S.editClip(0, { x: 1.5, y: 0, scale: 0.5 }, 'test off frame');
    I.render();
    const warned = [...document.querySelectorAll('.insp-warn')].some((n) => /outside the frame/.test(n.textContent));
    const reset = document.getElementById('insp-untransform');
    reset?.click();
    I.render();
    return { titles, ids, warned, backToFull: S.timeline[0].scale === 1 && S.timeline[0].x === 0,
             resetNowDisabled: document.getElementById('insp-untransform')?.disabled };
  });
  check('the inspector has a Transform group, with a preset picker and the four numbers',
    panel.titles.includes('Transform')
    && ['place', 'scale', 'x', 'y', 'rot', 'flip'].every((k) => panel.ids.includes(`insp-${k}`)),
    JSON.stringify(panel.ids));
  check('…it says when a clip has been pushed off screen, rather than rendering nothing silently',
    panel.warned === true);
  check('…and one button puts it back, then goes quiet',
    panel.backToFull === true && panel.resetNowDisabled === true, JSON.stringify(panel));

  const round = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.editClip(0, { x: 0.25, y: -0.1, scale: 0.5, rot: 12, flip: 'h' }, 'test round trip');
    const before = S.timeline.map((c) => [c.x, c.y, c.scale, c.rot, c.flip]);
    S.applyProject(JSON.parse(JSON.stringify(S.readProject())));
    return { before, after: S.timeline.map((c) => [c.x, c.y, c.scale, c.rot, c.flip]) };
  });
  check('a clip’s position survives save and load',
    JSON.stringify(round.before) === JSON.stringify(round.after), JSON.stringify(round.after));

  await page.evaluate(() => {
    document.getElementById('tl-clear').click();
  });
}

/* ================== the sound that came with your footage ================ */
/* The headless suite proves the DESCRIPTION is right — that a footage clip
   contributes a part, offset by its trim, that does not loop. What only a
   browser can settle is the capability underneath it: that decodeAudioData
   actually pulls an audio track out of a video container, and that our plumbing
   hands it the right string. Both were unreachable before this — the pooled
   decoders are muted and the picker only admitted `music` rows. */
section('footage audio — a clip you imported can finally be heard');
{
  /* A real video file WITH sound in it, made the only honest way: export one.
     Short and small, because what matters is that the container carries an
     audio track, not what is on the picture. */
  const made = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.querySelector('.tab[data-view=timeline]').click();
    document.getElementById('tl-clear').click();
    document.querySelector('.tab[data-view=video]').click();
    set('v-scene', 'bars'); set('v-dur', '2');
    S.addTimelineClip();
    document.querySelector('.tab[data-view=timeline]').click();
    set('tl-w', '160'); set('tl-h', '120'); set('tl-fps', '10');
    set('tl-audio', 'last');                       // the render from the section above
    const before = S.library.length;
    document.getElementById('tl-record').click();
    for (let i = 0; i < 400 && S.library.length === before; i++) await new Promise((r) => setTimeout(r, 50));
    const row = S.library.at(-1);
    return { kind: row?.kind, ext: row?.ext, size: row?.blob?.size || 0, key: row?.key || '' };
  });
  check('a video file with an audio track exists to test against',
    made.kind === 'videos' && made.size > 500 && !!made.key, JSON.stringify(made));

  const offered = await page.evaluate(async () => {
    const B = await import('./src/audio/bed.js');
    const rows = B.bedCandidates();
    return { kinds: [...new Set(rows.map((r) => r.kind))].sort(), n: rows.length };
  });
  check('video rows are offered as sound sources, not just music',
    offered.kinds.includes('videos') && offered.kinds.includes('music'), JSON.stringify(offered));

  /* THE claim. Everything above is wiring; this is whether a browser will give
     us the samples that were inside a video container. */
  const heard = await page.evaluate(async (key) => {
    const M = await import('./src/doc/audiomix.js');
    const B = await import('./src/audio/bed.js');
    const shot = (srcAudio, inn = 0) => ({
      kind: 'video', scene: 'videoin', label: 'shot', rec: { 'v-srckey': `lib:${key}`, 'v-dur': '2' },
      src: 2, in: inn, out: 2, transition: 'cut', xdur: 0.6, bed: '', srcAudio,
      track: 'V1', at: 0, blend: 'screen', opacity: 1, x: 0, y: 0, scale: 1, rot: 0, flip: 'none',
    });
    const mix = async (clip) => {
      const sched = { clips: [clip], starts: [0], audio: [], total: 2 };
      const p = M.mixParts(sched, '');
      const buf = await B.buildSequenceMix(p.total, p.seq, p.video, p.audio);
      if (!buf) return { buf: null, choice: p.video[0]?.choice ?? null };
      const d = buf.getChannelData(0);
      let e = 0; for (let i = 0; i < d.length; i++) e += Math.abs(d[i]);
      return { energy: Math.round(e), seconds: +(d.length / 48000).toFixed(2), choice: p.video[0]?.choice };
    };
    return { on: await mix(shot(true)), off: await mix(shot(false)) };
  }, made.key);
  check('the source string is the one the asset store is filed under, not a doubled prefix',
    heard.on.choice === `lib:${made.key}`, String(heard.on.choice));
  check('…and the audio inside that video file reaches the mix',
    heard.on.energy > 100 && heard.on.seconds > 1.9,
    JSON.stringify({ energy: heard.on.energy, seconds: heard.on.seconds }));
  /* The negative control: with the switch off there is nothing to build, and
     silence is null rather than a buffer of zeros — which is what tells the
     exporter not to carry an audio track at all. */
  check('with the switch off the same clip builds no mix at all',
    heard.off.buf === null && heard.off.choice === null, JSON.stringify(heard.off));

  const panel = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const U = await import('./src/ui/track.js');
    const I = await import('./src/ui/inspector.js');
    U.focusClipAfterRender(0);
    I.render();
    const onScene = !!document.getElementById('insp-srcAudio');
    // Point clip 0 at the footage and the switch has to appear.
    S.editClip(0, { scene: 'videoin', rec: { ...S.timeline[0].rec, 'v-srckey': 'lib:whatever' } }, 'test footage');
    I.render();
    const onFootage = !!document.getElementById('insp-srcAudio');
    return { onScene, onFootage };
  });
  check('the panel offers the switch to a footage clip and to nothing else',
    panel.onScene === false && panel.onFootage === true, JSON.stringify(panel));

  /* Hand the tab back as it was found. The export above set a sequence bed and
     built a sequence; a later section that inherited either would be measuring
     this one's leftovers. */
  await page.evaluate(() => {
    const e = document.getElementById('tl-audio');
    if (e) { e.value = ''; e.dispatchEvent(new Event('change', { bubbles: true })); }
    document.getElementById('tl-clear').click();
  });
}

/* ================================= snapping, on a real drag ============== */
/* The maths is pinned headless. What a browser settles is whether the LANE
   uses it — and, more importantly, whether the two exclusions hold up against
   a real gesture, because both of them are the difference between snapping and
   a clip that will not move. */
section('snapping — a drag lands on something');
{
  const build = () => page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.querySelector('.tab[data-view=timeline]').click();
    document.getElementById('tl-clear').click();
    document.querySelector('.tab[data-view=video]').click();
    set('v-scene', 'bars'); set('v-dur', '6');
    S.addTimelineClip();
    S.addOverlayClip(0);
    document.querySelector('.tab[data-view=timeline]').click();
    const key = S.library.find((r) => r.kind === 'music')?.key || 'x';
    S.addAudioClip({ source: `lib:${key}`, at: 2.5, seconds: 1, label: 'hit' });
    /* Paused, deliberately: the snap targets deliberately drop the playhead
       while the preview is running, so a test that left it running would be
       testing a different code path from the one an author uses when placing
       something. */
    const pp = document.getElementById('tl-playpause');
    if (pp.textContent.trim() !== '▶') pp.click();
    return { clips: S.timeline.length, sounds: S.audioTimeline.length,
             overlay: S.timeline.findIndex((c) => c.track === 'V2') };
  });
  const setup = await build();
  check('a spine clip, an overlay and a sound at 2.5s to aim at',
    setup.clips === 2 && setup.sounds === 1 && setup.overlay >= 0, JSON.stringify(setup));

  const dragOverlay = (shift) => page.evaluate(({ shift, k }) => {
    const S = window.DeadSignalStudio;
    S.editClip(k, { at: 0 }, 'reset overlay');
    const box = document.getElementById('tl-track');
    const block = box.querySelector('.tl-row.overlay .tl-clip[data-i="' + k + '"]');
    if (!block) return { missing: true };
    const pps = S.trackScale().pxPerSec;
    const r = block.getBoundingClientRect();
    /* Aim the overlay's head FOUR PIXELS short of the sound at 2.5. In pixels,
       not in seconds: the pull is half the eight-pixel radius at whatever scale
       the lane happens to be at, so this is inside it by construction. Aiming
       "0.04s short" is how this test first failed — at 204px/s the radius is
       0.039s, and 0.04 missed it by a thousandth of a second. */
    const want = 2.5 - 4 / pps;
    const dx = want * pps;   // the overlay starts at 0, so this is the whole move
    const at = (x) => ({ bubbles: true, clientX: x, clientY: r.top + r.height / 2,
                         pointerId: 71, shiftKey: shift });
    const x0 = r.left + 6;
    block.dispatchEvent(new PointerEvent('pointerdown', at(x0)));
    for (let i = 1; i <= 8; i++) box.dispatchEvent(new PointerEvent('pointermove', at(x0 + (dx * i) / 8)));
    box.dispatchEvent(new PointerEvent('pointerup', at(x0 + dx)));
    return { at: S.timeline[k].at, want: +want.toFixed(2), pps: Math.round(pps) };
  }, { shift, k: setup.overlay });

  const snapped = await dragOverlay(false);
  check('an overlay dropped near a sound lands exactly on it',
    snapped.at === 2.5, JSON.stringify(snapped));
  const free = await dragOverlay(true);
  check('…and Shift places it exactly where it was let go instead',
    free.at !== 2.5 && Math.abs(free.at - free.want) < 0.03, JSON.stringify(free));

  /* The exclusion that stops the lane fighting the pointer. Every spine clip
     after the one being trimmed is re-positioned BY the trim, so if those edges
     were targets the pointer would find one a pixel away on every move. The
     symptom is not a wrong number — it is a clip that will not move at all. */
  const trimmed = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.getElementById('tl-clear').click();
    document.querySelector('.tab[data-view=video]').click();
    set('v-scene', 'bars'); set('v-dur', '5');
    S.addTimelineClip(); S.addTimelineClip(); S.addTimelineClip();
    document.querySelector('.tab[data-view=timeline]').click();
    const box = document.getElementById('tl-track');
    const pps = S.trackScale().pxPerSec;
    const grip = box.querySelector('.tl-clip[data-i="0"] .tl-grip.r');
    const r = grip.getBoundingClientRect();
    const before = S.timeline[0].out;
    const at = (x) => ({ bubbles: true, clientX: x, clientY: r.top + r.height / 2, pointerId: 72 });
    grip.dispatchEvent(new PointerEvent('pointerdown', at(r.left + 2)));
    for (let i = 1; i <= 10; i++) box.dispatchEvent(new PointerEvent('pointermove', at(r.left + 2 - i * 6)));
    box.dispatchEvent(new PointerEvent('pointerup', at(r.left + 2 - 60)));
    return { before, after: S.timeline[0].out, moved: +(before - S.timeline[0].out).toFixed(2),
             expected: +(60 / pps).toFixed(2) };
  });
  check('trimming a spine clip still moves — its own neighbours are not targets',
    trimmed.moved > 0.05 && Math.abs(trimmed.moved - trimmed.expected) < 0.06, JSON.stringify(trimmed));

  await page.evaluate(() => document.getElementById('tl-clear').click());
}

/* ============================== fades, counted in samples ================ */
/* The envelope's SHAPE is pinned headless, including the awkward case where two
   fades do not fit. What a browser settles is whether that shape reaches the
   samples — a schedule built correctly and never handed to a GainNode looks
   identical in every unit test and is inaudible in exactly the wrong way. */
section('audio fades — measured on the samples, not on the schedule');
{
  const measured = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const B = await import('./src/audio/bed.js');
    const key = S.library.find((r) => r.kind === 'music')?.key;
    if (!key) return { noSource: true };
    const part = (fadeIn, fadeOut) => ({ choice: `lib:${key}`, at: 0, seconds: 2, offset: 0,
                                         loop: true, gain: 1, pan: 0, fadeIn, fadeOut });
    const band = (buf, from, to) => {
      const d = buf.getChannelData(0);
      let e = 0;
      for (let i = Math.floor(from * 48000); i < Math.min(d.length, Math.floor(to * 48000)); i++) e += Math.abs(d[i]);
      return e;
    };
    const flat = await B.buildSequenceMix(2, '', [], [part(0, 0)]);
    const fade = await B.buildSequenceMix(2, '', [], [part(0.5, 0.5)]);
    if (!flat || !fade) return { none: true };
    const at = (buf) => ({ head: band(buf, 0, 0.08), mid: band(buf, 0.9, 1.1), tail: band(buf, 1.92, 2) });
    return { flat: at(flat), fade: at(fade) };
  });
  check('a source with signal in it exists to fade', !measured.noSource && !measured.none,
    JSON.stringify(measured));
  check('a fade in really silences the head of the sound',
    measured.fade.head < measured.flat.head * 0.25,
    `${Math.round(measured.fade.head)} vs ${Math.round(measured.flat.head)}`);
  check('a fade out really silences its tail',
    measured.fade.tail < measured.flat.tail * 0.25,
    `${Math.round(measured.fade.tail)} vs ${Math.round(measured.flat.tail)}`);
  /* The part that makes it a fade rather than an attenuation: the middle is
     untouched, so the sound is the level it was authored at everywhere the
     ramps are not. */
  check('…and the middle is left exactly as loud as it was',
    Math.abs(measured.fade.mid - measured.flat.mid) < measured.flat.mid * 0.02,
    `${Math.round(measured.fade.mid)} vs ${Math.round(measured.flat.mid)}`);

  /* The mix has no limiter anywhere in it and gain goes to 4. Past full scale
     the encoder clamps, which is audible as distortion on the loudest moment of
     the export — the one place nobody re-checks. */
  const metered = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const B = await import('./src/audio/bed.js');
    const P = await import('./src/audio/peaks.js');
    const key = S.library.find((r) => r.kind === 'music')?.key;
    const part = (gain) => ({ choice: `lib:${key}`, at: 0, seconds: 1, offset: 0,
                              loop: true, gain, pan: 0, fadeIn: 0, fadeOut: 0 });
    const quiet = await B.buildSequenceMix(1, '', [], [part(0.25)]);
    const loud = await B.buildSequenceMix(1, '', [], [part(4), part(4), part(4)]);
    return {
      quiet: quiet?.__peak ?? null, loud: loud?.__peak ?? null,
      quietLabel: P.peakLabel(quiet?.__peak ?? 0), loudLabel: P.peakLabel(loud?.__peak ?? 0),
      readout: !!document.getElementById('tl-peak'),
    };
  });
  check('every mixdown comes back knowing how loud it is',
    typeof metered.quiet === 'number' && metered.quiet > 0 && metered.quiet < 1,
    JSON.stringify({ peak: metered.quiet, label: metered.quietLabel }));
  check('…and a stack of gains is reported as clipping rather than silently clamped',
    metered.loud >= 1 && /CLIPPING/.test(metered.loudLabel),
    JSON.stringify({ peak: metered.loud, label: metered.loudLabel }));
  check('the transport has somewhere to show it', metered.readout === true);
}

/* ============================== a clipboard for clips ==================== */
/* Split, razor, duplicate and ripple delete were all here and a clipboard was
   not — so a look built at 0:04 could be copied into the slot beside it and
   nowhere else. */
section('copy and paste — a clip can move somewhere else now');
{
  const state = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const N = await import('./src/ui/nle.js');
    const U = await import('./src/ui/track.js');
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.querySelector('.tab[data-view=timeline]').click();
    document.getElementById('tl-clear').click();
    document.querySelector('.tab[data-view=video]').click();
    set('v-scene', 'terminal'); set('v-text', 'COPY ME'); set('v-dur', '3');
    S.addTimelineClip();
    set('v-scene', 'matrix'); set('v-text', 'OTHER'); set('v-dur', '3');
    S.addTimelineClip();
    document.querySelector('.tab[data-view=timeline]').click();

    const nothing = N.pasteClip();               // nothing copied yet
    U.focusClipAfterRender(0);
    const copied = N.copyClip();
    // Playhead over the SECOND clip: a spine paste goes in after what it is over.
    const scrub = document.getElementById('tl-scrub');
    const total = S.buildSchedule().total;
    scrub.value = String(Math.round((4 / total) * 1000));
    scrub.dispatchEvent(new Event('input', { bubbles: true }));
    const pasted = N.pasteClip();
    return {
      nothing, copied, pasted,
      labels: S.timeline.map((c) => c.label),
      texts: S.timeline.map((c) => c.rec['v-text']),
      n: S.timeline.length,
    };
  });
  check('pasting before anything is copied is refused rather than silent',
    state.nothing === false && state.copied === true && state.pasted === true, JSON.stringify(state));
  check('a spine clip goes in AFTER whatever the playhead is over — an order, not a time',
    state.n === 3 && state.texts.join('|') === 'COPY ME|OTHER|COPY ME', JSON.stringify(state.texts));

  /* A snapshot, not a reference: the live projection is rebuilt on every commit
     and its id is re-minted, so a held reference would paste whatever that slot
     had become. */
  const independent = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const N = await import('./src/ui/nle.js');
    S.editClip(0, { label: 'renamed since' }, 'rename');
    N.pasteClip();
    return S.timeline.map((c) => c.label);
  });
  check('…and what was copied is a snapshot, not a live reference',
    independent[0] === 'renamed since' && independent.filter((l) => l === 'renamed since').length === 1,
    JSON.stringify(independent));

  const sound = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const N = await import('./src/ui/nle.js');
    const U = await import('./src/ui/track.js');
    const key = S.library.find((r) => r.kind === 'music')?.key || 'x';
    S.addAudioClip({ source: `lib:${key}`, at: 1, seconds: 1, label: 'blip' });
    // Selecting on the audio lane is what tells copy which array to read.
    U.focusClipAfterRender(-1);
    const box = document.getElementById('tl-track');
    const block = box.querySelector('.tl-aclip[data-i="0"]');
    const r = block.getBoundingClientRect();
    block.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 81,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    box.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 81,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    const copied = N.copyClip();
    const scrub = document.getElementById('tl-scrub');
    const total = S.buildSchedule().total;
    scrub.value = String(Math.round((5 / total) * 1000));
    scrub.dispatchEvent(new Event('input', { bubbles: true }));
    const pasted = N.pasteClip();
    return { copied, pasted, ats: S.audioTimeline.map((c) => c.at), n: S.audioTimeline.length,
             clips: S.timeline.length };
  });
  check('a sound is copied from its own lane and lands AT the playhead — a position, not a slot',
    sound.copied === true && sound.pasted === true && sound.n === 2
    && Math.abs(sound.ats[1] - 5) < 0.06, JSON.stringify(sound));
  check('…and pasting a sound does not put a picture on the spine',
    sound.clips === 4, String(sound.clips));

  /* Ctrl+C inside a text box is the browser's copy, and taking that away to
     duplicate a clip would be indefensible. */
  const guarded = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const before = S.timeline.length;
    const field = document.getElementById('v-text') || document.querySelector('input[type=text]');
    field.focus();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
    return { before, after: S.timeline.length };
  });
  check('Ctrl+V inside a field is the browser\'s paste, not the editor\'s',
    guarded.before === guarded.after, JSON.stringify(guarded));

  await page.evaluate(() => document.getElementById('tl-clear').click());
}

/* =========================== speed and reverse, on the frames =========== */
/* The maths is pinned headless. What a browser settles is whether the
   COMPOSITOR asks for the right source time — a time base that is correct in
   sourceTimeOf and ignored by renderClipTo looks right in every unit test and
   plays at the wrong speed on screen. Compared frame against frame: at 2× the
   picture at lane time 1 must be exactly the picture a 1× clip shows at 2. */
section('speed and reverse — the frames really change');
{
  const frameHash = (t) => page.evaluate((t) => {
    const S = window.DeadSignalStudio;
    const s = S.buildSchedule();
    const c = document.createElement('canvas');
    c.width = s.tl.W; c.height = s.tl.H;
    const ctx = c.getContext('2d');
    S.renderTimelineFrame(ctx, t, s);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let h = 5381;
    for (let i = 0; i < d.length; i += 4) h = (((h * 33) ^ (d[i] + d[i + 1] + d[i + 2])) >>> 0);
    return { h, total: +s.total.toFixed(2) };
  }, t);
  const edit = (patch) => page.evaluate((patch) =>
    window.DeadSignalStudio.editClip(0, patch, 'test speed'), patch);

  await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.querySelector('.tab[data-view=timeline]').click();
    document.getElementById('tl-clear').click();
    document.querySelector('.tab[data-view=video]').click();
    // A scene whose picture depends on time, or every frame hashes the same and
    // the whole section is vacuous.
    set('v-scene', 'matrix'); set('v-text', 'SPEED'); set('v-dur', '8');
    S.addTimelineClip();
    document.querySelector('.tab[data-view=timeline]').click();
  });

  const base = await frameHash(2);
  const moving = await frameHash(4);
  check('the test scene actually changes over time, or none of this means anything',
    base.h !== moving.h && base.total === 8, JSON.stringify({ base: base.h, moving: moving.h }));

  await edit({ speed: 2 });
  const fast = await frameHash(1);
  check('at 2× the clip occupies half the lane',
    fast.total === 4, `${fast.total}s`);
  check('…and shows at 1s exactly what it showed at 2s before',
    fast.h === base.h, `${fast.h} vs ${base.h}`);

  await edit({ speed: 0.5 });
  const slow = await frameHash(4);
  check('at half speed it occupies twice as much, and shows the same frame later',
    slow.total === 16 && slow.h === base.h, JSON.stringify({ total: slow.total, h: slow.h, want: base.h }));

  /* Reverse starts at the OUT point. So the first frame of a reversed clip is
     the LAST frame of the forward one — not a different part of the source
     played forwards, which is what swapping in and out would give. */
  await edit({ speed: 1, reverse: false });
  const lastForward = await frameHash(7.99);
  await edit({ reverse: true });
  const firstBack = await frameHash(0.01);
  check('reversed, the first frame you see is the last one of the window',
    firstBack.h === lastForward.h, `${firstBack.h} vs ${lastForward.h}`);
  check('…and reverse does not change how long the clip is', firstBack.total === 8);

  /* Keys are in source seconds, so the panel has to walk the same time base or
     a key lands where the frame is not. */
  const keyed = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const scrub = document.getElementById('tl-scrub');
    const put = (t) => {
      const total = S.buildSchedule().total;
      scrub.value = String(Math.round((t / total) * 1000));
      scrub.dispatchEvent(new Event('input', { bubbles: true }));
      return S.clipSourceTime(0);
    };
    S.editClip(0, { reverse: false, speed: 2 }, 'test keys');
    const atFast = put(1);
    S.editClip(0, { reverse: true, speed: 1 }, 'test keys');
    const atBack = put(1);
    S.editClip(0, { reverse: false, speed: 1 }, 'test keys');
    return { atFast, atBack };
  });
  check('the keyframe panel keys where the FRAME is, at any speed or direction',
    Math.abs(keyed.atFast - 2) < 0.06 && Math.abs(keyed.atBack - 7) < 0.06,
    JSON.stringify(keyed));

  const round = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.editClip(0, { speed: 1.75, reverse: true }, 'test round trip');
    const before = S.timeline.map((c) => [c.speed, c.reverse]);
    S.applyProject(JSON.parse(JSON.stringify(S.readProject())));
    return { before, after: S.timeline.map((c) => [c.speed, c.reverse]) };
  });
  check('speed and direction survive save and load',
    JSON.stringify(round.before) === JSON.stringify(round.after), JSON.stringify(round.after));

  await page.evaluate(() => document.getElementById('tl-clear').click());
}

/* ============ a batch file sounds like it did in the sequence =========== */
/* It carried each clip's own bed and NOTHING else — no sequence bed, no audio
   lane, no footage sound — and the panel note said so rather than fixing it.
   The claim now is that a clip exported on its own carries the slice of the
   finished mix that belongs to it, which is a claim about samples. */
section('batch export — each file carries its slice of the sequence mix');
{
  const sliced = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const B = await import('./src/audio/bed.js');
    const key = S.library.find((r) => r.kind === 'music')?.key;
    if (!key) return { noSource: true };
    /* A mix with sound ONLY in its second half: a slice that ignored the
       offset would come back loud for clip one, and a slice that ignored the
       clip's start would come back quiet for clip two. */
    const parts = [{ choice: `lib:${key}`, at: 2, seconds: 2, offset: 0, loop: true,
                     gain: 1, pan: 0, fadeIn: 0, fadeOut: 0 }];
    const full = await B.buildSequenceMix(4, '', [], parts);
    if (!full) return { none: true };
    const energy = (buf) => {
      if (!buf) return null;
      const d = buf.getChannelData(0);
      let e = 0;
      for (let i = 0; i < d.length; i++) e += Math.abs(d[i]);
      return Math.round(e);
    };
    const first = B.sliceBuffer(full, 0, 2);
    const second = B.sliceBuffer(full, 2, 2);
    const past = B.sliceBuffer(full, 9, 2);
    return {
      firstE: energy(first), secondE: energy(second), fullE: energy(full),
      firstLen: +(first.length / first.sampleRate).toFixed(2),
      channels: first.numberOfChannels === full.numberOfChannels,
      rate: first.sampleRate === full.sampleRate,
      past,
    };
  });
  check('a source with signal exists to slice', !sliced.noSource && !sliced.none, JSON.stringify(sliced));
  check('a slice is exactly as long as it was asked for, at the mix’s own rate and width',
    Math.abs(sliced.firstLen - 2) < 0.01 && sliced.channels && sliced.rate, JSON.stringify(sliced));
  check('…and it really is that part of the mix, not the whole thing',
    sliced.firstE < sliced.secondE * 0.05 && sliced.secondE > 100,
    JSON.stringify({ first: sliced.firstE, second: sliced.secondE }));
  check('a slice starting past the end of the mix is nothing, not a throw',
    sliced.past === null, JSON.stringify(sliced.past));

  /* End to end: the clip carries a bed it never had, from the sequence. */
  const exported = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const B = await import('./src/export/batch.js');
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.querySelector('.tab[data-view=timeline]').click();
    document.getElementById('tl-clear').click();
    document.querySelector('.tab[data-view=video]').click();
    set('v-scene', 'bars'); set('v-dur', '2');
    S.addTimelineClip();
    document.querySelector('.tab[data-view=timeline]').click();
    set('tl-w', '128'); set('tl-h', '96'); set('tl-fps', '10');
    // A SEQUENCE bed — the thing a batch file could never carry before. The clip
    // itself has no bed of its own at all.
    set('tl-audio', 'last');
    S.clearLibrary();
    const res = await B.runBatch('timeline-clips', {});
    const row = S.library.at(-1);
    const withBed = { made: res.made, size: row?.blob?.size || 0 };
    set('tl-audio', '');
    S.clearLibrary();
    const res2 = await B.runBatch('timeline-clips', {});
    const row2 = S.library.at(-1);
    S.clearLibrary();
    return { withBed, silent: { made: res2.made, size: row2?.blob?.size || 0 },
             clipHadNoBedOfItsOwn: S.timeline[0]?.bed === '' };
  });
  check('the clip under test carries no bed of its own, so the sound can only be the sequence’s',
    exported.clipHadNoBedOfItsOwn === true);
  check('a batch file exported WITH a sequence bed is bigger than the same clip without one',
    exported.withBed.made === 1 && exported.silent.made === 1
    && exported.withBed.size > exported.silent.size,
    JSON.stringify(exported));

  await page.evaluate(() => document.getElementById('tl-clear').click());
}

/* ================= placing a clip by dragging it in the monitor ========= */
/* The maths is pinned headless. A browser settles three things it cannot: that
   a real pointer drag reaches editClip, that the CSS-to-buffer conversion is
   actually applied (skip it and the handles are right on a 1:1 monitor and
   increasingly wrong as the window changes size — "sometimes it feels sticky",
   not an error), and that no handle can reach an export. */
section('the monitor is a place to drag, not just a picture');
{
  const setup = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const U = await import('./src/ui/track.js');
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.querySelector('.tab[data-view=timeline]').click();
    document.getElementById('tl-clear').click();
    document.querySelector('.tab[data-view=video]').click();
    set('v-scene', 'bars'); set('v-dur', '6');
    S.addTimelineClip();
    document.querySelector('.tab[data-view=timeline]').click();
    /* A frame far larger than the monitor row can show, so the canvas is
       displayed at a fraction of its buffer size. That ratio IS the thing
       under test — at 1:1 the CSS-to-buffer conversion could be missing
       entirely and every drag below would still land. */
    set('tl-w', '960'); set('tl-h', '720');
    // Parked over the clip, and paused: the overlay belongs to the clip the
    // playhead is on, and a moving playhead would leave it mid-test.
    const pp = document.getElementById('tl-playpause');
    if (pp.textContent.trim() !== '▶') pp.click();
    const scrub = document.getElementById('tl-scrub');
    scrub.value = '500';
    scrub.dispatchEvent(new Event('input', { bubbles: true }));
    U.focusClipAfterRender(0);
    const M = await import('./src/ui/monitor.js');
    return { target: !!M.monitorTarget(), clips: S.timeline.length };
  });
  check('a selected clip under the playhead is what the overlay belongs to',
    setup.target === true && setup.clips === 1, JSON.stringify(setup));

  /* Points are FRACTIONS of the frame, resolved against the canvas inside the
     page. Passing absolute buffer coordinates measured out here is how this
     test first failed: the canvas had not been resized to the new sequence
     size yet, so a drag computed against 128x96 was dispatched across a
     960x720 buffer and moved the clip by a thirtieth of what it asked for —
     which, being exactly 32/960, was the conversion working correctly and the
     test being wrong. */
  const drag = (fromF, toF, opts = {}) => page.evaluate(({ fromF, toF, opts }) => {
    const S = window.DeadSignalStudio;
    if (opts.reset) S.editClip(0, opts.reset, 'reset');
    const c = document.getElementById('tlcanvas');
    const r = c.getBoundingClientRect();
    const from = [fromF[0] * c.width, fromF[1] * c.height];
    const to = [toF[0] * c.width, toF[1] * c.height];
    // Buffer coords → CSS coords, which is the conversion under test.
    const css = (p) => ({ clientX: r.left + (p[0] / c.width) * r.width,
                          clientY: r.top + (p[1] / c.height) * r.height,
                          bubbles: true, pointerId: 91 });
    c.dispatchEvent(new PointerEvent('pointerdown', css(from)));
    for (let i = 1; i <= 6; i++) {
      c.dispatchEvent(new PointerEvent('pointermove', css([
        from[0] + ((to[0] - from[0]) * i) / 6, from[1] + ((to[1] - from[1]) * i) / 6])));
    }
    c.dispatchEvent(new PointerEvent('pointerup', css(to)));
    const t = S.timeline[0];
    return { x: t.x, y: t.y, scale: t.scale, rot: t.rot, W: c.width, H: c.height };
  }, { fromF, toF, opts });

  // The preview loop resizes the canvas to the new sequence size on its next
  // frame; measuring before that gets the previous section's dimensions.
  await page.waitForTimeout(400);
  const size = await page.evaluate(() => {
    const c = document.getElementById('tlcanvas');
    const r = c.getBoundingClientRect();
    return { W: c.width, H: c.height, cssW: Math.round(r.width),
             ratio: +(c.width / (r.width || 1)).toFixed(2) };
  });
  check('the monitor is displayed at a different size from its buffer, so the conversion matters',
    size.ratio > 1.2 || size.ratio < 0.8, JSON.stringify(size));

  /* Move: from the middle of the frame to a quarter across and down. */
  const moved = await drag([0.5, 0.5], [0.75, 0.75],
    { reset: { x: 0, y: 0, scale: 1, rot: 0, flip: 'none' } });
  check('dragging inside the clip moves it by exactly the fraction of the frame you dragged',
    Math.abs(moved.x - 0.25) < 0.02 && Math.abs(moved.y - 0.25) < 0.02, JSON.stringify(moved));

  /* Scale: grab the bottom-right corner of a full-frame clip and pull it to the
     middle of the lower-right quadrant, which is half scale. */
  const scaled = await drag([1, 1], [0.75, 0.75],
    { reset: { x: 0, y: 0, scale: 1, rot: 0, flip: 'none' } });
  check('dragging a corner scales about the centre',
    Math.abs(scaled.scale - 0.5) < 0.03 && Math.abs(scaled.x) < 0.01, JSON.stringify(scaled));

  /* Rotate: the grip starts above the top edge; drag it to the right-hand side. */
  const turned = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const T = await import('./src/doc/transform.js');
    S.editClip(0, { x: 0, y: 0, scale: 0.5, rot: 0, flip: 'none' }, 'reset');
    const c = document.getElementById('tlcanvas');
    const r = c.getBoundingClientRect();
    const h = T.handlesFor(S.timeline[0], c.width, c.height);
    const css = (p) => ({ clientX: r.left + (p[0] / c.width) * r.width,
                          clientY: r.top + (p[1] / c.height) * r.height,
                          bubbles: true, pointerId: 92 });
    c.dispatchEvent(new PointerEvent('pointerdown', css(h.rot)));
    c.dispatchEvent(new PointerEvent('pointermove', css([c.width, c.height / 2])));
    c.dispatchEvent(new PointerEvent('pointerup', css([c.width, c.height / 2])));
    return { rot: S.timeline[0].rot, scale: S.timeline[0].scale };
  });
  check('dragging the grip round to the right is a quarter turn, and does not resize it',
    Math.abs(turned.rot - 90) < 2 && Math.abs(turned.scale - 0.5) < 0.01, JSON.stringify(turned));

  const undone = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const before = S.store.undoDepth;
    S.editClip(0, { x: 0.3, y: 0.3, scale: 0.4, rot: 20 }, 'test');
    const c = document.getElementById('tlcanvas');
    c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    const t = S.timeline[0];
    return { identity: t.x === 0 && t.y === 0 && t.scale === 1 && t.rot === 0, before };
  });
  check('double-clicking puts a clip back — the one gesture you cannot undo by hand once it is off screen',
    undone.identity === true, JSON.stringify(undone));

  /* The arrangement that rules a handle out of an export: the overlay is drawn
     by the preview loop AFTER renderTimelineFrame, and both export paths call
     renderTimelineFrame themselves. */
  const clean = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    S.editClip(0, { x: 0, y: 0, scale: 0.5, rot: 0, flip: 'none' }, 'inset');
    const s = S.buildSchedule();
    const shot = () => {
      const c = document.createElement('canvas');
      c.width = s.tl.W; c.height = s.tl.H;
      const ctx = c.getContext('2d');
      S.renderTimelineFrame(ctx, 1, s);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let h = 5381;
      for (let i = 0; i < d.length; i += 4) h = (((h * 33) ^ (d[i] + d[i + 1] + d[i + 2])) >>> 0);
      return { h, ctx, c };
    };
    const plain = shot();
    // The same frame, then the overlay on top of it — proving the overlay is a
    // real, visible thing AND that the export path never asks for it.
    const M = await import('./src/ui/monitor.js');
    const withBox = shot();
    M.paintMonitorOverlay(withBox.ctx, s);
    const d = withBox.ctx.getImageData(0, 0, withBox.c.width, withBox.c.height).data;
    let h2 = 5381;
    for (let i = 0; i < d.length; i += 4) h2 = (((h2 * 33) ^ (d[i] + d[i + 1] + d[i + 2])) >>> 0);
    return { exportHash: plain.h, overlaid: h2, again: shot().h };
  });
  check('the overlay really draws something', clean.overlaid !== clean.exportHash);
  check('…and renderTimelineFrame — which is all either exporter calls — never includes it',
    clean.again === clean.exportHash, `${clean.again} vs ${clean.exportHash}`);

  await page.evaluate(() => document.getElementById('tl-clear').click());
}

/* ============ transitions that are edges, and marks on the blocks ======= */
section('wipe, slide, key marks and a draggable transition length');
{
  const build = () => page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.querySelector('.tab[data-view=timeline]').click();
    document.getElementById('tl-clear').click();
    document.querySelector('.tab[data-view=video]').click();
    set('v-scene', 'bars'); set('v-dur', '4');
    S.addTimelineClip();
    set('v-scene', 'matrix'); S.addTimelineClip();
    document.querySelector('.tab[data-view=timeline]').click();
    set('tl-w', '160'); set('tl-h', '120'); set('tl-fps', '12');
    return { n: S.timeline.length };
  });
  await build();

  /* A wipe is an EDGE: the incoming clip covers the outgoing one at full
     opacity rather than dimming it. Measured as a column profile — at the
     halfway point of the wipe the left half of the frame must be the new clip
     and the right half the old one, which a dissolve could never produce. */
  const profile = await page.evaluate((kind) => {
    const S = window.DeadSignalStudio;
    S.editClip(1, { transition: kind, xdur: 2 }, 'test transition');
    const s = S.buildSchedule();
    const c = document.createElement('canvas');
    c.width = s.tl.W; c.height = s.tl.H;
    const ctx = c.getContext('2d');
    // Halfway through clip 2's transition.
    S.renderTimelineFrame(ctx, s.starts[1] + 1, s);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const band = (from, to) => {
      let e = 0; let n = 0;
      for (let y = 0; y < c.height; y++) {
        for (let x = Math.floor(from * c.width); x < Math.floor(to * c.width); x++) {
          const p = (y * c.width + x) * 4;
          e += d[p] + d[p + 1] + d[p + 2]; n++;
        }
      }
      return n ? Math.round(e / n) : 0;
    };
    return { left: band(0, 0.3), right: band(0.7, 1), total: +s.total.toFixed(2) };
  }, 'wipe');
  check('a wipe overlaps like a dissolve — the sequence is shorter than the two clips',
    Math.abs(profile.total - 6) < 0.05, `${profile.total}s`);
  check('…and at the halfway point the two sides of the frame are different pictures',
    Math.abs(profile.left - profile.right) > 8, JSON.stringify(profile));

  const dissolve = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.editClip(1, { transition: 'crossfade', xdur: 2 }, 'test transition');
    const s = S.buildSchedule();
    const c = document.createElement('canvas');
    c.width = s.tl.W; c.height = s.tl.H;
    const ctx = c.getContext('2d');
    S.renderTimelineFrame(ctx, s.starts[1] + 1, s);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const band = (from, to) => {
      let e = 0; let n = 0;
      for (let y = 0; y < c.height; y++) {
        for (let x = Math.floor(from * c.width); x < Math.floor(to * c.width); x++) {
          const p = (y * c.width + x) * 4;
          e += d[p] + d[p + 1] + d[p + 2]; n++;
        }
      }
      return n ? Math.round(e / n) : 0;
    };
    return { left: band(0, 0.3), right: band(0.7, 1) };
  });
  check('…where a dissolve at the same instant is the same blend across the whole frame',
    Math.abs(dissolve.left - dissolve.right) < Math.abs(profile.left - profile.right),
    JSON.stringify({ wipe: profile, dissolve }));

  const slid = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.editClip(1, { transition: 'slide', xdur: 2 }, 'test transition');
    const s = S.buildSchedule();
    const c = document.createElement('canvas');
    c.width = s.tl.W; c.height = s.tl.H;
    const ctx = c.getContext('2d');
    S.renderTimelineFrame(ctx, s.starts[1] + 1, s);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let h = 5381;
    for (let i = 0; i < d.length; i += 4) h = (((h * 33) ^ (d[i] + d[i + 1] + d[i + 2])) >>> 0);
    return { h, total: +s.total.toFixed(2) };
  });
  check('a slide is its own picture, and overlaps too',
    Math.abs(slid.total - 6) < 0.05 && typeof slid.h === 'number', JSON.stringify(slid));

  /* The transition's length, drawn AS its length and dragged to change it. */
  const handle = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.editClip(1, { transition: 'crossfade', xdur: 1 }, 'reset');
    const box = document.getElementById('tl-track');
    const first = box.querySelector('.tl-clip[data-i="0"] .tl-xgrip');
    const grip = box.querySelector('.tl-clip[data-i="1"] .tl-xgrip');
    if (!grip) return { missing: true };
    const before = S.timeline[1].xdur;
    const r = grip.getBoundingClientRect();
    const pps = S.trackScale().pxPerSec;
    const at = (x) => ({ bubbles: true, pointerId: 95, clientX: x, clientY: r.top + r.height / 2 });
    const x0 = r.right - 2;
    grip.dispatchEvent(new PointerEvent('pointerdown', at(x0)));
    for (let i = 1; i <= 6; i++) box.dispatchEvent(new PointerEvent('pointermove', at(x0 + i * 5)));
    box.dispatchEvent(new PointerEvent('pointerup', at(x0 + 30)));
    return { before, after: S.timeline[1].xdur, expected: +(before + 30 / pps).toFixed(2),
             onFirst: !!first, width: Math.round(r.width) };
  });
  check('the first clip of the spine gets no transition handle — it has nothing to come in from',
    handle.onFirst === false, JSON.stringify(handle));
  check('dragging the handle sets the transition length by exactly what you dragged',
    Math.abs(handle.after - handle.expected) < 0.06 && handle.after > handle.before,
    JSON.stringify(handle));
  check('…and the handle is drawn AS the length, so it is its own readout',
    handle.width > 4, `${handle.width}px`);
  const cut = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.editClip(1, { transition: 'cut' }, 'cut');
    return !!document.querySelector('#tl-track .tl-clip[data-i="1"] .tl-xgrip');
  });
  check('a cut has no handle, because a cut is instant', cut === false);

  /* Keyframes were invisible from the lane: the only way to know a clip was
     animated was to select it and open the picker. */
  const marks = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const none = document.querySelectorAll('#tl-track .tl-clip[data-i="0"] .tl-key').length;
    const c = S.timeline[0];
    S.editClip(0, { rec: { ...c.rec, __auto: { 'v-noise': [{ t: 0, v: 0 }, { t: 2, v: 1 }, { t: 4, v: 0 }] } } },
      'test keys');
    const shown = [...document.querySelectorAll('#tl-track .tl-clip[data-i="0"] .tl-key')]
      .map((n) => parseInt(n.style.left, 10));
    const w = document.querySelector('#tl-track .tl-clip[data-i="0"]').getBoundingClientRect().width;
    // Trimmed to the second half: the key at t=0 is now outside the clip.
    S.editClip(0, { in: 2, out: 4 }, 'trim');
    const afterTrim = document.querySelectorAll('#tl-track .tl-clip[data-i="0"] .tl-key').length;
    return { none, shown, w: Math.round(w), afterTrim };
  });
  check('a clip with no curves draws no marks', marks.none === 0);
  check('…and one with three keys draws three, spread along the block',
    marks.shown.length === 3 && marks.shown[0] < marks.shown[1] && marks.shown[1] < marks.shown[2]
    && marks.shown[2] <= marks.w + 2, JSON.stringify(marks));
  /* Placed through the clip's own time mapping, so a trim moves them and drops
     the ones that are no longer inside the window. */
  check('…and trimming the clip drops the keys that fall outside it',
    marks.afterTrim === 2, `${marks.afterTrim} of 3`);

  /* A DIP HAS TO FINISH INSIDE THE CLIP IT ENTERS.
     The overlapping transitions clamp to min(xdur, len, prevLen); the flash
     branch (dip / dipwhite / burn) used xdur / 2 raw, and nothing stopped that
     being longer than either clip. With the maximum 4s dip on a 1s clip the half
     was 2s, so the wash covered the clip's entire length: it never completed,
     and the picture the author trimmed was never once seen. Measured against the
     same pair joined with a CUT, which is what the clip looks like undipped. */
  const dip = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const build = (transition, xdur) => {
      S.setTimelineClips([
        { kind: 'scene', label: 'A', rec: { 'v-scene': 'bars' }, in: 0, out: 1, transition: 'cut', xdur: 0 },
        { kind: 'scene', label: 'B', rec: { 'v-scene': 'bars' }, in: 0, out: 1, transition, xdur },
      ]);
      return S.buildSchedule();
    };
    const meansInB = (sched) => {
      const { W, H } = sched.tl;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      const out = [];
      for (let T = 1.0; T <= 1.951; T += 0.1) {
        S.renderTimelineFrame(ctx, T, sched);
        const d = ctx.getImageData(0, 0, W, H).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
        out.push(Math.round(sum / (d.length / 4) / 3));
      }
      return out;
    };
    const cut = meansInB(build('cut', 0));
    const long = meansInB(build('dip', 4));
    const ok = meansInB(build('dip', 0.4));
    const settled = (rows) => rows.filter((m, i) => Math.abs(m - cut[i]) <= 1).length;
    S.setTimelineClips([]);
    return { cut, long, ok, settledLong: settled(long), settledOk: settled(ok), of: cut.length };
  });
  check('a dip longer than its clip still finishes inside it',
    dip.settledLong >= 4, `${dip.settledLong} of ${dip.of} instants clear · ${JSON.stringify(dip.long)}`);
  check('…and it does start from the flash, so it is still a dip',
    dip.long[0] < dip.cut[0] / 4, `${dip.long[0]} vs ${dip.cut[0]}`);
  check('…while a dip that already fitted is unchanged',
    dip.settledOk >= 7, `${dip.settledOk} of ${dip.of} · ${JSON.stringify(dip.ok)}`);

  await page.evaluate(() => document.getElementById('tl-clear').click());
}

/* ================================== the waveform is an editor now ======== */
/* It was a readout: you could see the third second was too loud and the only
   thing you could do was change a synthesis parameter and render again, which
   changes the whole clip. The pure edit maths is pinned in
   test-studio-document.mjs; what needs a browser is the selection, and the
   claim that edits REPLAY rather than being a one-shot button. */
section('the waveform is an editor now');
{
  const panel = await page.evaluate(() => {
    document.querySelector('.tab[data-view=audio]').click();
    const sel = document.getElementById('a-region-op');
    return { ops: [...(sel?.options || [])].map((o) => o.value),
             /* Either spelling counts as off. ＋ APPLY carries aria-disabled
                rather than disabled so a keyboard author can still reach it and
                hear why — see core/dom.js setEnabled — and asserting on the
                `disabled` property alone would read that as "live". */
             addOff: (() => { const b = document.getElementById('a-region-add');
               return !!b && (b.disabled || b.getAttribute('aria-disabled') === 'true'); })(),
             addReachable: (() => { const b = document.getElementById('a-region-add');
               return !!b && !b.disabled && b.tabIndex >= 0; })(),
             overlay: !!document.getElementById('a-selection'),
             list: !!document.getElementById('a-regions-list') };
  });
  check('the edits panel offers every op, over a selectable wave',
    panel.ops.join() === 'silence,fadein,fadeout,gain,reverse,keep' && panel.overlay && panel.list,
    JSON.stringify(panel.ops));
  /* Applying needs something to apply TO. A live button with no selection can
     only produce a confusing no-op or an edit over a range nobody chose. */
  check('…with APPLY unavailable until something is selected', panel.addOff === true);
  check('…but still reachable, so it can say what a selection would be for',
    panel.addReachable === true);

  const dragged = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const U = await import('./src/ui/regions.js');
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      if (e.type === 'checkbox') e.checked = !!v; else e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    S.clearRegions();
    set('a-dur', 2); set('a-drone', true); set('a-noise', true);
    document.getElementById('a-render').click();
    await new Promise((r) => setTimeout(r, 1800));
    const canvas = document.getElementById('acanvas');
    const r = canvas.getBoundingClientRect();
    const at = (frac) => ({ bubbles: true, clientX: r.left + r.width * frac,
      clientY: r.top + r.height / 2, pointerId: 7 });
    canvas.dispatchEvent(new PointerEvent('pointerdown', at(0.5)));
    canvas.dispatchEvent(new PointerEvent('pointermove', at(0.9)));
    canvas.dispatchEvent(new PointerEvent('pointerup', at(0.9)));
    const sel = U.selection();
    const shown = document.getElementById('a-selection').style.display !== 'none';
    const enabled = !document.getElementById('a-region-add').disabled;
    document.getElementById('a-region-op').value = 'silence';
    document.getElementById('a-region-add').click();
    return { sel: sel && { from: +sel.from.toFixed(2), to: +sel.to.toFixed(2) }, shown, enabled,
             doc: S.store.get('audio.regions'),
             rows: document.querySelectorAll('#a-regions-list .filter-row').length };
  });
  check('dragging on the wave selects a range in seconds',
    dragged.sel && Math.abs(dragged.sel.from - 1) < 0.1 && Math.abs(dragged.sel.to - 1.8) < 0.1,
    JSON.stringify(dragged.sel));
  check('…the overlay shows it and APPLY comes alive', dragged.shown && dragged.enabled);
  check('…and applying reaches the document as one edit',
    dragged.doc?.length === 1 && dragged.doc[0].op === 'silence' && dragged.rows === 1,
    JSON.stringify(dragged.doc));

  /* The claim that separates an editor from a destructive button: render
     AGAIN, from scratch, and the edit is still there. */
  const replayed = await page.evaluate(async () => {
    document.getElementById('a-render').click();
    await new Promise((r) => setTimeout(r, 1800));
    const A = await import('./src/audio/ui.js');
    const d = A.lastAudio.channels[0], sr = A.lastAudio.sr, n = d.length;
    const sum = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += Math.abs(d[i]); return s; };
    return { seconds: +(n / sr).toFixed(2),
             before: +sum(0, Math.floor(n * 0.45)).toFixed(1),
             inside: +sum(Math.floor(n * 0.55), Math.floor(n * 0.85)).toFixed(4) };
  });
  check('a fresh render replays the edits — the silenced range really is silent',
    replayed.inside === 0 && replayed.before > 1, JSON.stringify(replayed));

  const round = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const before = JSON.stringify(S.store.get('audio.regions'));
    S.applyProject(JSON.parse(JSON.stringify(S.readProject())));
    return { before, after: JSON.stringify(S.store.get('audio.regions')),
             rows: document.querySelectorAll('#a-regions-list .filter-row').length };
  });
  check('edits travel in the project', round.before === round.after && round.rows === 1,
    round.after);

  const undone = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const n = S.store.get('audio.regions').length;
    S.clearRegions();
    const cleared = S.store.get('audio.regions').length;
    S.undo();
    return { n, cleared, back: S.store.get('audio.regions').length };
  });
  check('…and they undo, like every other edit in the tool',
    undone.n === 1 && undone.cleared === 0 && undone.back === 1, JSON.stringify(undone));

  const cropped = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const A = await import('./src/audio/ui.js');
    S.clearRegions();
    S.addRegion('keep', 0.25, 1.0);
    document.getElementById('a-render').click();
    await new Promise((r) => setTimeout(r, 1800));
    const out = { seconds: +(A.lastAudio.channels[0].length / A.lastAudio.sr).toFixed(2) };
    S.clearRegions();
    return out;
  });
  check('a crop actually shortens what comes out of the render',
    Math.abs(cropped.seconds - 0.75) < 0.05, `${cropped.seconds}s`);
}

/* ============================================= solo, in the browser ====== */
/* The mask maths is pinned headless in test-studio-document.mjs. What needs a
   browser is the wiring: that twenty-six buttons exist without twenty-six lumps
   of markup, that a soloed render is actually quieter, that the arrangement
   survives, and — the one that would ship a broken file — that a soloed EXPORT
   announces itself. */
section('solo');
{
  const mounted = await page.evaluate(() => {
    document.querySelector('.tab[data-view=audio]').click();
    const btns = [...document.querySelectorAll('button[data-solo]')];
    return {
      n: btns.length,
      inRows: btns.filter((b) => b.closest('.row')?.querySelector('input[type=checkbox]')).length,
      named: btns.every((b) => (b.getAttribute('aria-label') || '').startsWith('Solo ')),
      pressed: btns.every((b) => b.getAttribute('aria-pressed') === 'false'),
      // A <button>, never an <input> — the document binding mirrors every input
      // on the tab, and solo must not become part of the arrangement.
      allButtons: btns.every((b) => b.tagName === 'BUTTON'),
    };
  });
  check('every source has a solo button, generated layers included',
    mounted.n === 26 && mounted.inRows === 26, `${mounted.n} buttons`);
  check('each one is named for a screen reader, not just "S"', mounted.named);
  check('they are buttons, not inputs — solo is not part of the arrangement',
    mounted.allButtons && mounted.pressed);

  const flip = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.toggleSolo('drone');
    const b = document.querySelector('button[data-solo="drone"]');
    const banner = document.getElementById('a-solo-banner');
    return { doc: S.store.get('audio.solo'), pressed: b.getAttribute('aria-pressed'),
      lit: b.classList.contains('on'), fieldset: !!b.closest('fieldset')?.classList.contains('soloed'),
      bannerShown: banner.style.display !== 'none',
      // "or export" is the whole reason the banner exists.
      warnsAboutExport: /export/i.test(banner.textContent) };
  });
  check('clicking solo writes the document and lights the button',
    flip.doc.join() === 'drone' && flip.pressed === 'true' && flip.lit && flip.fieldset,
    JSON.stringify(flip.doc));
  check('a banner says what is soloed AND that it applies to export',
    flip.bannerShown && flip.warnsAboutExport);

  const masked = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const set = (id, v) => { const el = document.getElementById(id); el.checked = v;
      el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('a-noise', true); set('a-vinyl', true);
    const solo = S.readAudioCfg();
    S.clearSolo();
    const full = S.readAudioCfg();
    return { soloNoise: solo.noise, soloVinyl: solo.layers.vinyl.on, soloDrone: solo.drone,
      fullNoise: full.noise, fullVinyl: full.layers.vinyl.on,
      boxes: ['a-drone', 'a-noise', 'a-vinyl'].map((id) => document.getElementById(id).checked) };
  });
  check('the config the render reads is masked — hand-wired and registry alike',
    masked.soloDrone && !masked.soloNoise && !masked.soloVinyl,
    `noise ${masked.soloNoise}, vinyl ${masked.soloVinyl}`);
  check('clearing solo restores the whole mix, because nothing was ever changed',
    masked.fullNoise && masked.fullVinyl && masked.boxes.every(Boolean));

  /* Auto-extend reads the config, so it has to read the MASKED one — otherwise
     soloing the drone would still stretch the render to 6.5s to fit a dial-up
     sequence that is checked and inaudible. */
  const length = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const set = (id, v) => { const el = document.getElementById(id); el.checked = v;
      el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('a-dial', true);
    const before = S.readAudioCfg().dial;
    S.toggleSolo('drone');
    const after = S.readAudioCfg().dial;
    S.clearSolo(); set('a-dial', false);
    return { before, after };
  });
  check('a muted layer does not get a vote on the render length',
    length.before === true && length.after === false, JSON.stringify(length));

  const undone = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.toggleSolo('rain');
    const on = S.store.get('audio.solo').length;
    S.store.undo();
    const off = S.store.get('audio.solo').length;
    const btnOff = document.querySelector('button[data-solo="rain"]').getAttribute('aria-pressed');
    S.store.redo();
    const back = S.store.get('audio.solo').length;
    const btnOn = document.querySelector('button[data-solo="rain"]').getAttribute('aria-pressed');
    S.clearSolo();
    return { on, off, back, btnOff, btnOn };
  });
  check('solo undoes and redoes, and the button follows the document',
    undone.on === 1 && undone.off === 0 && undone.back === 1
    && undone.btnOff === 'false' && undone.btnOn === 'true', JSON.stringify(undone));

  /* The end of the chain: a real OfflineAudioContext render. Geiger alone is
     sparse clicks over silence, so soloing it against a continuous drone is a
     difference no rounding error can fake. */
  const rendered = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const set = (id, v) => { const el = document.getElementById(id); el.checked = v;
      el.dispatchEvent(new Event('change', { bubbles: true })); };
    const dur = document.getElementById('a-dur');
    dur.value = '2'; dur.dispatchEvent(new Event('change', { bubbles: true }));
    set('a-drone', true); set('a-geiger', true); set('a-noise', false); set('a-vinyl', false);
    const level = (r) => { const d = r.channels[0]; let s = 0;
      for (let i = 0; i < d.length; i++) s += Math.abs(d[i]); return s / d.length; };
    const full = level(await S.renderAudio());
    S.toggleSolo('geiger');
    const solo = level(await S.renderAudio());
    S.clearSolo();
    const restored = level(await S.renderAudio());
    set('a-geiger', false);
    return { full: +full.toFixed(4), solo: +solo.toFixed(4), restored: +restored.toFixed(4) };
  });
  check('a soloed render really is only the soloed source',
    rendered.solo < rendered.full * 0.25, JSON.stringify(rendered));
  check('and clearing solo renders the identical full mix again',
    Math.abs(rendered.restored - rendered.full) < 1e-9, JSON.stringify(rendered));

  const said = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    // Counted as a delta, not a total: the console still holds the notices the
    // render checks above produced, and a test that reads lines[0] is really
    // testing which section ran first.
    const lines = () => (document.body.innerText.match(/SOLO: only[^\n]*/g) || []);
    const before = lines().length;
    S.toggleSolo('drone');
    await S.renderAudio();
    await S.renderAudio();
    const during = lines();
    S.clearSolo();
    await S.renderAudio();
    return { added: during.length - before, sample: during[during.length - 1] || '',
      addedAfterClear: lines().length - during.length };
  });
  check('every soloed render says so in the log — not just the first one',
    said.added === 2 && said.addedAfterClear === 0, JSON.stringify(said.added));
  check('the log line names the source and warns about export',
    /DRONE/.test(said.sample) && /export/i.test(said.sample), said.sample.slice(0, 60));
}

/* ==================================== marks: free placement on a screen == */
/* Forty-six templates, each baking its own layout — one-click, and completely
   unmovable. Marks are the layer that is not baked. The geometry is pinned
   headless in test-studio-document.mjs; what needs a browser is that they
   DRAW, that dragging works, and that the editor's own chrome never reaches a
   file. */
section('screen marks');
{
  const sig = () => page.evaluate(() => {
    const cv = document.getElementById('icanvas');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let s = 0; for (let i = 0; i < d.length; i += 17) s += d[i]; return s;
  });

  const panel = await page.evaluate(() => {
    document.querySelector('.tab[data-view=image]').click();
    return { kinds: [...(document.getElementById('i-anno-kind')?.options || [])].map((o) => o.value),
      list: !!document.getElementById('i-anno-list'), add: !!document.getElementById('i-anno-add') };
  });
  check('the marks panel offers every kind', panel.kinds.length === 6 && panel.list && panel.add,
    panel.kinds.join(','));

  const drawn = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const D = await import('./src/doc/annotations.js');
    const cv = document.getElementById('icanvas');
    const sum = () => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 17) s += d[i]; return s; };
    const dead = [];
    for (const k of D.ANNOTATION_KINDS) {
      S.clearAnnotations(); S.selectAnnotation(null); S.renderImage();
      const base = sum();
      S.addAnnotation(k.id, { text: 'XXXXXX', x: 0.2, y: 0.2, w: 0.5, h: 0.4, size: 200, weight: 6 });
      S.selectAnnotation(null); S.renderImage();
      if (sum() === base) dead.push(k.id);
    }
    S.clearAnnotations(); S.renderImage();
    return { dead, n: D.ANNOTATION_KINDS.length };
  });
  check(`all ${drawn.n} mark kinds actually change the picture`, drawn.dead.length === 0,
    drawn.dead.join(',') || 'all draw');

  /* The reason coordinates are fractions rather than pixels: the size and
     aspect are one click away, and pixels would scatter every mark. */
  /* Measured as the centroid of the pixels the mark CHANGES, not of the
     brightest thing on screen — the template draws its own text and an
     absolute-brightness probe would report the template's layout, pass at both
     sizes, and prove nothing. */
  const resized = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const setv = (id, v) => { const el = document.getElementById(id); el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true })); };
    const cv = document.getElementById('icanvas');
    // The FX are seeded per frame but noise would still swamp a diff, so they
    // are turned off for the measurement and put back afterwards.
    const fx = ['i-scan', 'i-noise', 'i-vig'].map((id) => [id, document.getElementById(id).value]);
    for (const [id] of fx) setv(id, '0');
    const grab = () => cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const centroid = () => {
      S.clearAnnotations(); S.selectAnnotation(null); S.renderImage();
      const before = grab();
      S.addAnnotation('text', { text: 'LOWER THIRD', x: 0.1, y: 0.75, size: 200 });
      S.selectAnnotation(null); S.renderImage();
      const after = grab();
      let sy = 0, n = 0;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
        const i = (y * cv.width + x) * 4;
        if (Math.abs(after[i + 1] - before[i + 1]) > 40) { sy += y / cv.height; n++; }
      }
      return { y: n ? sy / n : -1, n };
    };
    setv('i-w', '480'); setv('i-h', '360');
    const small = centroid();
    setv('i-w', '960'); setv('i-h', '720');
    const big = centroid();
    setv('i-w', '480'); setv('i-h', '360');
    for (const [id, v] of fx) setv(id, v);
    S.clearAnnotations(); S.renderImage();
    return { small: +small.y.toFixed(3), big: +big.y.toFixed(3), px: [small.n, big.n] };
  });
  check('a mark lands where it was placed, in fractions of the canvas',
    resized.px[0] > 50 && Math.abs(resized.small - 0.78) < 0.05, JSON.stringify(resized));
  check('…and stays there when the screen is resized to a different aspect',
    resized.px[1] > 50 && Math.abs(resized.small - resized.big) < 0.02, JSON.stringify(resized));

  const dragged = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.clearAnnotations();
    S.addAnnotation('text', { text: 'DRAG ME', x: 0.1, y: 0.1, size: 200 });
    const cv = document.getElementById('icanvas');
    const r = cv.getBoundingClientRect();
    const pt = (fx, fy) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * fy,
      pointerId: 1, bubbles: true });
    const before = S.store.get('image.annotations')[0].x;
    cv.dispatchEvent(new PointerEvent('pointerdown', pt(0.13, 0.13)));
    cv.dispatchEvent(new PointerEvent('pointermove', pt(0.3, 0.4)));
    cv.dispatchEvent(new PointerEvent('pointermove', pt(0.4, 0.5)));
    cv.dispatchEvent(new PointerEvent('pointermove', pt(0.5, 0.6)));
    cv.dispatchEvent(new PointerEvent('pointerup', pt(0.5, 0.6)));
    const after = S.store.get('image.annotations')[0].x;
    S.store.undo();
    const undone = S.store.get('image.annotations')[0].x;
    S.store.redo();
    return { before, after: +after.toFixed(3), undone: +undone.toFixed(3),
      selected: S.store.get('image.annotations').length };
  });
  check('dragging on the preview moves the mark', dragged.after - dragged.before > 0.2,
    `${dragged.before} → ${dragged.after}`);
  /* Three pointermoves, one undo entry. Without coalescing, ctrl-Z after
     dragging a caption across the screen nudges it a pixel. */
  check('…and the whole drag is ONE undo entry, not one per pointermove',
    Math.abs(dragged.undone - dragged.before) < 0.001, JSON.stringify(dragged));

  /* The marks go UNDER the CRT pass — they are on the screen, not on the glass
     in front of it — while the selection outline goes over it and is left out
     of anything that becomes a file. */
  const chrome = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const cv = document.getElementById('icanvas');
    const amber = () => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let n = 0; for (let i = 0; i < d.length; i += 4)
        if (d[i] > 230 && d[i + 1] > 150 && d[i + 1] < 200 && d[i + 2] < 110) n++;
      return n; };
    S.selectAnnotation(0); S.renderImage();
    const preview = amber();
    S.renderImage({ chrome: false });
    const file = amber();
    S.selectAnnotation(null);
    return { preview, file };
  });
  check('the selected mark is outlined in the preview',
    chrome.preview > 0, `${chrome.preview} px`);
  check('…and that outline is not in what gets exported', chrome.file === 0, `${chrome.file} px`);

  const scanned = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const setv = (id, v) => { const el = document.getElementById(id); el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true })); };
    const cv = document.getElementById('icanvas');
    const sum = () => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 17) s += d[i]; return s; };
    S.clearAnnotations(); S.selectAnnotation(null);
    S.addAnnotation('fill', { x: 0.1, y: 0.1, w: 0.8, h: 0.8, color: '#ffffff' });
    setv('i-scan', '0'); S.renderImage();
    const flat = sum();
    setv('i-scan', '100'); S.renderImage();
    const lined = sum();
    setv('i-scan', '30'); S.clearAnnotations(); S.renderImage();
    return { flat, lined };
  });
  check('marks go under the CRT pass — they are on the screen, not on the glass',
    scanned.lined !== scanned.flat, JSON.stringify(scanned));

  /* A still is a captured recipe. Video clips already capture keyframes, layers
     and the filter chain for the same reason: a sequence must render what it
     was built from, not what the tab happens to show later. */
  const still = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.clearAnnotations();
    S.addAnnotation('text', { text: 'ON THE STILL', x: 0.2, y: 0.4 });
    document.querySelector('.tab[data-view=timeline]').click();
    document.getElementById('tl-still').click();
    const clips = S.store.get('timeline.clips');
    const cap = clips[clips.length - 1]?.rec?.__annotations;
    S.clearAnnotations();
    const after = clips[clips.length - 1]?.rec?.__annotations?.length;
    document.querySelector('.tab[data-view=image]').click();
    return { captured: Array.isArray(cap) ? cap.length : null, text: cap?.[0]?.text,
      keptAfterClearing: after, liveNow: S.store.get('image.annotations').length };
  });
  check('a timeline still captures the marks it was made with',
    still.captured === 1 && still.text === 'ON THE STILL', JSON.stringify(still));
  check('…and keeps them after the SCREEN tab is cleared',
    still.keptAfterClearing === 1 && still.liveNow === 0, JSON.stringify(still));

  const cleaned = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.clearAnnotations();
    return { n: S.store.get('image.annotations').length };
  });
  check('clearing removes them all', cleaned.n === 0);
}

/* ================================= the preset gallery: look, then pick === */
/* Forty-odd presets in a <select> of names. "Signal Loss", "ICE Drone",
   "Evidence Tag" — each one a guess until you load it, and loading it
   overwrites the tab. The library was effectively unbrowsable: you found your
   preset by trying presets. */
section('preset gallery');
{
  const shut = await page.evaluate(() => ({
    display: document.getElementById('v-gallery').style.display,
    cards: document.querySelectorAll('#v-gallery .gal-card').length,
    expanded: document.getElementById('v-gallery-btn').getAttribute('aria-expanded'),
  }));
  check('it starts closed — nothing renders until asked',
    shut.cards === 0 && shut.expanded === 'false', JSON.stringify(shut));

  const video = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    document.querySelector('.tab[data-view=video]').click();
    S.toggleGallery('video');
    await new Promise((r) => setTimeout(r, 2500));
    const cards = [...document.querySelectorAll('#v-gallery .gal-card')];
    const sig = (cv) => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 13) s = (s * 31 + d[i]) >>> 0; return s; };
    const flat = (cv) => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 4; i < d.length; i += 4)
        if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) return false;
      return true; };
    const canvases = cards.map((c) => c.querySelector('canvas')).filter(Boolean);
    /* Earlier sections leave synthetic one-key presets behind ("Night Look" is
       literally {v-noise:'9'}), which is exactly the case worth separating:
       shipped presets must all be distinct looks, while a one-key fragment is
       near-identical to the defaults by construction and proves nothing about
       the library. */
    const builtin = canvases.filter((cv) => {
      for (let n = cv.closest('.gal-card'); n; n = n.previousElementSibling)
        if (n.classList.contains('gal-group')) return n.textContent !== 'My Presets';
      return true;
    });
    return {
      cards: cards.length,
      options: [...document.querySelectorAll('#v-preset option')].filter((o) => o.value !== '— custom —').length,
      blank: canvases.filter(flat).map((cv) => cv.closest('.gal-card').textContent.trim()),
      builtins: builtin.length,
      distinct: new Set(builtin.map(sig)).size,
    };
  });
  check('every preset in the picker gets a card', video.cards === video.options && video.cards > 10,
    `${video.cards} cards, ${video.options} presets`);
  /* A thumbnail is a real render, and it must render what CLICKING the card
     produces: the tab defaults with the preset over the top. Rendering the
     stored fragment alone drew a picture of the fragment — a one-key preset
     came out a flat black rectangle, and every other card was subtly not the
     thing you would get. */
  check('no thumbnail is a flat empty rectangle', video.blank.length === 0,
    video.blank.slice(0, 3).join(' | ') || 'all drew something');
  check('…and no two shipped presets are the same picture',
    video.builtins > 10 && video.distinct === video.builtins,
    `${video.distinct} distinct of ${video.builtins}`);

  /* Clicking a card must be the same act as choosing from the list. A bare
     `sel.value = …` fires no event, so the capture-phase document binding never
     records the pick — and the moment the preset applies and the document is
     pushed back to the DOM, the picker snaps back to "— custom —". */
  const picked = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#v-gallery .gal-card')];
    const target = cards.find((c) => c.textContent.includes('Neon Grid'));
    target.click();
    const again = [...document.querySelectorAll('#v-gallery .gal-card')]
      .find((c) => c.textContent.includes('Neon Grid'));
    return { select: document.getElementById('v-preset').value,
      scene: document.getElementById('v-scene').value,
      marked: !!again?.classList.contains('sel') };
  });
  check('clicking a card loads that preset and the picker agrees',
    picked.select === 'Neon Grid' && picked.scene === 'neongrid', JSON.stringify(picked));
  check('…and the card is marked as the current one', picked.marked);

  /* The strongest form of the claim: the card is not merely non-blank, it is
     the frame you get. Load the preset for real, render the live config at the
     same size and instant, and compare pixel for pixel. */
  const honest = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const R = await import('./src/video/render.js');
    const { set } = await import('./src/doc/store.js');
    /* A thumbnail shows the PRESET, never the preset plus whatever chain the
       author happens to have built — so the comparison clears both, which is
       also the only state in which the two paths are meant to agree. Earlier
       sections leave a filter chain and extra layers behind. */
    S.store.apply(set('filters.video', []));
    S.store.apply(set('layers.video', []));
    S.toggleGallery('video'); S.toggleGallery('video');   // repaint in that state
    await new Promise((r) => setTimeout(r, 2500));
    const find = () => [...document.querySelectorAll('#v-gallery .gal-card')]
      .find((c) => c.textContent.includes('SMPTE Bars'));
    find().click();
    const cv = find().querySelector('canvas');
    const cfg = R.readVideoCfg();
    const mine = document.createElement('canvas');
    mine.width = cv.width; mine.height = cv.height;
    R.renderVideoFrame(mine.getContext('2d'), mine.width, mine.height, cfg, (cfg.duration || 8) * 0.34);
    const a = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const b = mine.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let diff = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 8) diff++;
    return { diff, px: a.length / 4 };
  });
  check('the thumbnail is the frame you actually get when you click it',
    honest.diff / honest.px < 0.02, `${honest.diff}/${honest.px} px differ`);

  const image = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    document.querySelector('.tab[data-view=image]').click();
    S.toggleGallery('image');
    await new Promise((r) => setTimeout(r, 2500));
    const canvases = [...document.querySelectorAll('#i-gallery .gal-card canvas')];
    const sig = (cv) => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 13) s = (s * 31 + d[i]) >>> 0; return s; };
    S.toggleGallery('image');
    return { n: canvases.length, distinct: new Set(canvases.map(sig)).size };
  });
  check('the screen gallery draws every screen, all different',
    image.n > 8 && image.distinct === image.n, `${image.distinct}/${image.n}`);

  /* Sound gets a contents list rather than a picture. Forty waveforms at
     thumbnail size are forty grey bricks; what an author wants to know is what
     is IN it, and that is read off the recipe rather than rendered. */
  const audio = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    document.querySelector('.tab[data-view=audio]').click();
    S.toggleGallery('audio');
    await new Promise((r) => setTimeout(r, 400));
    const cards = [...document.querySelectorAll('#a-gallery .gal-card')];
    const text = (n) => cards.find((c) => c.textContent.includes(n))?.textContent.replace(/\s+/g, ' ').trim() || '';
    const chips = [...document.querySelectorAll('#a-gallery .pill')].map((p) => p.textContent);
    S.toggleGallery('audio');
    return { n: cards.length, dialup: text('Dialup Ghost'), station: text('Number Station'),
      empty: cards.filter((c) => !c.querySelector('.pill')).length,
      // A parameter id must never be mistaken for a layer.
      params: chips.filter((c) => c.includes('-')) };
  });
  check('every audio preset says what it turns on', audio.n > 8 && audio.empty === 0,
    `${audio.n} cards, ${audio.empty} empty`);
  check('the contents are read from the recipe and are actually right',
    /dial/.test(audio.dialup) && /dtmf/.test(audio.station) && /phone/.test(audio.station),
    audio.station);
  check('…and a parameter is never mistaken for a layer',
    audio.params.length === 0, audio.params.slice(0, 3).join(','));

  /* A thumbnail drawn at the old seed is a picture of a look you can no longer
     get — the seed is a control, and a stale thumbnail is worse than none. */
  const reseeded = await page.evaluate(async () => {
    document.querySelector('.tab[data-view=video]').click();
    const sig = () => { const cv = document.querySelector('#v-gallery .gal-card canvas');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 13) s = (s * 31 + d[i]) >>> 0; return s; };
    const before = sig();
    document.getElementById('seed-roll').click();
    await new Promise((r) => setTimeout(r, 2000));
    return { before, after: sig() };
  });
  check('a new seed repaints the thumbnails rather than leaving a lie',
    reseeded.before !== reseeded.after, JSON.stringify(reseeded));

  const closed = await page.evaluate(() => {
    window.DeadSignalStudio.toggleGallery('video');
    return { display: document.getElementById('v-gallery').style.display,
      cards: document.querySelectorAll('#v-gallery .gal-card').length,
      expanded: document.getElementById('v-gallery-btn').getAttribute('aria-expanded') };
  });
  check('closing it puts the canvases away again',
    closed.cards === 0 && closed.display === 'none' && closed.expanded === 'false',
    JSON.stringify(closed));

  /* Thumbnails share the phosphor persistence buffer with every other
     renderVideoFrame() caller. Pre-fix, a card whose recipe had persist on
     composited whatever the running preview left there, then resized the
     buffer to card size — flashing the preset across the live preview's trail
     and vice versa. Sentinel dims are deliberately unlike any preview or
     thumbnail size, so ANY touch shows. */
  const persistBuf = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const { _persistCanvas } = await import('./src/video/render.js');
    document.querySelector('.tab[data-view=video]').click();
    // persist 0 on the live tab, so the preview loop itself leaves the buffer
    // alone for the duration of the probe (setting it restarts the preview,
    // which resizes the buffer once — hence the sentinel is planted after).
    const el = document.getElementById('v-persist');
    el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    // wireLive debounces 70ms before restarting the preview, and the restart
    // resizes the persist buffer once — let it land BEFORE the sentinel goes in.
    await new Promise((r) => setTimeout(r, 300));
    const pc = _persistCanvas(); pc.width = 333; pc.height = 77;
    S.toggleGallery('video');                        // queues every thumbnail job
    await new Promise((r) => setTimeout(r, 2000));   // let the queue drain beside the preview loop
    S.toggleGallery('video');
    return { w: pc.width, h: pc.height };
  });
  check('preset thumbnails leave the shared persist buffer alone',
        persistBuf.w === 333 && persistBuf.h === 77, `${persistBuf.w}x${persistBuf.h}`);
}

/* ============================================ aesthetic packs, in situ === */
/* The aesthetic switch reskinned the tool's chrome and set a palette, and the
   presets that belong to each aesthetic were already grouped under its name —
   but nothing connected the two, and forty-eight scenes sat in one flat list
   whatever world you were working in. */
section('aesthetic packs');
{
  const dangling = await page.evaluate(async () => {
    const P = await import('./src/core/packs.js');
    const S = await import('./src/video/scenes.js');
    const T = await import('./src/image/templates.js');
    const bad = [];
    for (const id in P.PACKS) {
      bad.push(...P.danglingIds(id, 'scenes', S.SCENES).map((x) => `${id}/scene/${x}`));
      bad.push(...P.danglingIds(id, 'templates', T.TEMPLATES).map((x) => `${id}/tpl/${x}`));
    }
    // The other direction of the same promise: every aesthetic in the picker
    // has a pack, or ◆ PACK does nothing for it.
    const { AESTHETICS } = await import('./src/core/palettes.js');
    const packless = Object.keys(AESTHETICS).filter((k) => !P.PACKS[k]);
    return { bad, packless, scenes: Object.keys(S.SCENES).length, templates: Object.keys(T.TEMPLATES).length };
  });
  check('every id a pack names is a real scene or template', dangling.bad.length === 0,
    dangling.bad.slice(0, 4).join(' | ') || `${dangling.scenes} scenes, ${dangling.templates} templates`);
  check('every aesthetic in the picker has a pack', dangling.packless.length === 0,
    dangling.packless.join(',') || 'all four');

  const grouped = await page.evaluate(() => {
    const info = (id) => ({
      options: document.querySelectorAll(`#${id} option`).length,
      groups: [...document.querySelectorAll(`#${id} optgroup`)].map((g) => g.label),
    });
    return { scene: info('v-scene'), tpl: info('i-tpl') };
  });
  /* GROUPED, NEVER FILTERED — a horror screen in a cyberpunk project is a
     legitimate choice, so the count must not move. */
  check('the scene picker groups the pack first and still lists all 48',
    grouped.scene.options === 48 && grouped.scene.groups.length === 2
    && grouped.scene.groups[1] === 'Everything else', JSON.stringify(grouped.scene.groups));
  check('the template picker does the same with all 46',
    grouped.tpl.options === 46 && grouped.tpl.groups.length === 2,
    `${grouped.tpl.options} options`);

  const switched = await page.evaluate(async () => {
    const { setVal } = await import('./src/core/dom.js');
    setVal('v-scene', 'statue');
    const before = document.getElementById('v-scene').value;
    setVal('aesthetic', 'cyberpunk');
    return { before, after: document.getElementById('v-scene').value,
      groups: [...document.querySelectorAll('#v-scene optgroup')].map((g) => g.label),
      options: document.querySelectorAll('#v-scene option').length };
  });
  check('switching aesthetic regroups the list', switched.groups[0] === 'Cyberpunk',
    switched.groups.join(' / '));
  check('…without changing what is selected, or losing an option',
    switched.after === switched.before && switched.options === 48, JSON.stringify(switched));

  /* One gesture, one undo: colours AND a matching starting point on all three
     tabs. This is the thing the aesthetic switch always looked like it did. */
  const packed = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const { setVal } = await import('./src/core/dom.js');
    setVal('aesthetic', 'vaporwave');
    /* Set all three pickers through setVal first, so each one's document path
       is populated. Earlier sections in this suite load whole projects, which
       replace the document — and a path that is ABSENT rather than set is a
       different starting state, whose undo has nothing to write back to the
       DOM. That is a real (pre-existing) wrinkle in the binding, but it is not
       what this check is about, so the check sets its own ground. */
    setVal('v-preset', '— custom —'); setVal('a-preset', '— custom —'); setVal('i-preset', '— custom —');
    const v = (id) => document.getElementById(id).value;
    const doc = () => ({ v: S.store.get('tabs.video.v-preset'), a: S.store.get('tabs.audio.a-preset'),
      i: S.store.get('tabs.image.i-preset') });
    // Captured AFTER the aesthetic switch (its own undo entry) so the
    // comparison is against the state ◆ PACK actually started from.
    const before = { ui: { vpreset: v('v-preset'), apreset: v('a-preset'), ipreset: v('i-preset') },
      doc: doc() };
    document.getElementById('pack-apply').click();
    const after = { vpreset: v('v-preset'), apreset: v('a-preset'), ipreset: v('i-preset'),
      vbg: v('v-bg'), ibg: v('i-bg'), palette: v('v-palette') };
    S.store.undo();
    const undone = { ui: { vpreset: v('v-preset'), apreset: v('a-preset'), ipreset: v('i-preset') },
      doc: doc() };
    return { before, after, undone };
  });
  check('◆ PACK loads that world on all three tabs at once',
    packed.after.vpreset === 'Retrowave Sun' && packed.after.apreset === 'Mallsoft Pad'
    && packed.after.ipreset === 'Vapor Desktop', JSON.stringify(packed.after));
  /* Loading a preset resets the tab to its boot defaults first — and the boot
     default background is P1 Green. Writing the palette before the presets
     meant every pack came out green. */
  check('…and the palette survives the presets rather than being reset by them',
    packed.after.vbg === '#1a0b2e' && packed.after.ibg === '#1a0b2e'
    && packed.after.palette === 'Vapor Pink', JSON.stringify(packed.after));
  check('…and one undo puts all three tabs back exactly as they were — document and controls',
    JSON.stringify(packed.undone) === JSON.stringify(packed.before),
    `${JSON.stringify(packed.before.ui)} → ${JSON.stringify(packed.undone.ui)}`);

  /* A lock is the author's standing instruction. A bigger gesture does not get
     to overrule it — that is the whole promise locks make. */
  const locked = await page.evaluate(async () => {
    const { setVal } = await import('./src/core/dom.js');
    setVal('v-text', 'KEEP THIS');
    setVal('lock-v-text', true);
    setVal('aesthetic', 'cyberpunk');
    document.getElementById('pack-apply').click();
    const kept = document.getElementById('v-text').value;
    setVal('lock-v-text', false);
    return { kept, preset: document.getElementById('v-preset').value };
  });
  check('a locked section survives ◆ PACK, exactly as it survives a preset',
    locked.kept === 'KEEP THIS' && locked.preset === 'Neon Grid', JSON.stringify(locked));
}

/* ============================= alignment and letter-spacing ============= */
/* Text could be left or centred, and that was it. Right alignment is what a
   caption or a credit wants; letter-spacing is the fastest way to make a title
   card look designed rather than typed. Both had to arrive without moving a
   single existing pixel. */
section('type: alignment and tracking');
{
  const setup = `
    const { setVal } = await import('./src/core/dom.js');
    const R = await import('./src/video/render.js');
    setVal('v-scene','terminal'); setVal('v-textmode','static'); setVal('v-font','16');
    setVal('v-scan','0'); setVal('v-noise','0'); setVal('v-vig','0'); setVal('v-glitch','0');
    setVal('v-bloom','0'); setVal('v-chroma','0'); setVal('v-persist','0'); setVal('v-corrupt','0');
    setVal('v-hud',''); setVal('v-tc',false); setVal('v-cursor',false); setVal('v-fullwidth',false);
    /* Explicit colours: earlier sections leave the tool in whichever aesthetic
       they were testing, and a probe that counts GREEN ink finds none at all in
       a magenta project — which fails while proving nothing. */
    setVal('v-bg','#020806'); setVal('v-fg','#39ff9e');`;

  const aligned = await page.evaluate(`(async () => {${setup}
    setVal('v-text','ALIGNMENT'); setVal('v-lspace',0);
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 200;
    const centroid = (align) => {
      setVal('v-align', align);
      const ctx = cv.getContext('2d'); ctx.clearRect(0,0,320,200);
      R.renderVideoFrame(ctx, 320, 200, R.readVideoCfg(), 1);
      const d = ctx.getImageData(0,0,320,200).data;
      let sx = 0, n = 0;
      for (let y=0;y<200;y++) for (let x=0;x<320;x++) { const i=(y*320+x)*4;
        if (d[i+1] > 120) { sx += x; n++; } }
      return n ? +(sx/n/320).toFixed(3) : -1;
    };
    return { left: centroid('left'), center: centroid('center'), right: centroid('right') };
  })()`);
  check('right alignment actually moves the type to the right',
    aligned.left < aligned.center && aligned.center < aligned.right && aligned.right > 0.7,
    JSON.stringify(aligned));

  /* The caret used to be placed by its own rule ("centre or 12px"), which is
     how right-alignment ships with the cursor still parked on the left. It is
     derived from the same lineX the text uses. */
  const caret = await page.evaluate(`(async () => {${setup}
    setVal('v-text','END'); setVal('v-align','right'); setVal('v-cursor',true); setVal('v-lspace',0);
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 200;
    const ctx = cv.getContext('2d'); ctx.clearRect(0,0,320,200);
    R.renderVideoFrame(ctx, 320, 200, R.readVideoCfg(), 0);
    const d = ctx.getImageData(0,0,320,200).data;
    let max = 0;
    for (let y=0;y<200;y++) for (let x=0;x<320;x++) { const i=(y*320+x)*4;
      if (d[i+1] > 120 && x > max) max = x; }
    setVal('v-cursor', false);
    return { rightmost: max };
  })()`);
  check('…and the caret follows the text instead of staying on the left',
    caret.rightmost > 260, `rightmost ink at x=${caret.rightmost} of 320`);

  const tracked = await page.evaluate(`(async () => {${setup}
    setVal('v-align','left'); setVal('v-text','ABCDE');
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 200;
    const span = (ls) => {
      setVal('v-lspace', ls);
      const ctx = cv.getContext('2d'); ctx.clearRect(0,0,320,200);
      R.renderVideoFrame(ctx, 320, 200, R.readVideoCfg(), 1);
      const d = ctx.getImageData(0,0,320,200).data;
      let lo = 320, hi = 0;
      for (let y=0;y<200;y++) for (let x=0;x<320;x++) { const i=(y*320+x)*4;
        if (d[i+1] > 120) { if (x < lo) lo = x; if (x > hi) hi = x; } }
      return hi - lo;
    };
    const wide = span(30), tight = span(-8), zero = span(0);
    return { zero, wide, tight };
  })()`);
  check('letter-spacing widens the line, and negative values tighten it',
    tracked.wide > tracked.zero && tracked.tight < tracked.zero,
    JSON.stringify(tracked));

  /* ZERO IS A TOTAL NO-OP, not "zero pixels of spacing": the property is never
     touched, so every project written before this existed renders byte for
     byte as it did. Going up and coming back must land on the same image. */
  const untouched = await page.evaluate(`(async () => {${setup}
    setVal('v-text','UNCHANGED'); setVal('v-align','left');
    const cv = document.createElement('canvas'); cv.width = 200; cv.height = 140;
    const shot = () => { const ctx = cv.getContext('2d'); ctx.clearRect(0,0,200,140);
      R.renderVideoFrame(ctx, 200, 140, R.readVideoCfg(), 1);
      return [...ctx.getImageData(0,0,200,140).data].join(); };
    setVal('v-lspace', 0); const before = shot();
    setVal('v-lspace', 25); const spaced = shot();
    setVal('v-lspace', 0); const after = shot();
    return { same: before === after, moved: before !== spaced };
  })()`);
  check('zero tracking renders byte-identically, before and after using it',
    untouched.same && untouched.moved, JSON.stringify(untouched));

  /* Set once per frame beside the typeface, so every string a template draws
     takes it — the same rule setFontStack already followed. */
  const screens = await page.evaluate(`(async () => {
    const S = window.DeadSignalStudio;
    const { setVal } = await import('./src/core/dom.js');
    setVal('i-tpl','terminal'); setVal('i-scan','0'); setVal('i-noise','0'); setVal('i-vig','0');
    setVal('i-bg','#020806'); setVal('i-fg','#39ff9e'); setVal('i-duotone', false);
    const cv = document.getElementById('icanvas');
    const ink = () => { S.renderImage({ chrome: false });
      const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
      let max = 0;
      for (let y=0;y<cv.height;y++) for (let x=0;x<cv.width;x++) { const i=(y*cv.width+x)*4;
        if (d[i+1] > 120 && x > max) max = x; }
      return max; };
    setVal('i-lspace', 0); const at0 = ink();
    setVal('i-lspace', 30); const at30 = ink();
    setVal('i-lspace', 0);
    return { at0, at30 };
  })()`);
  check('screens take the same control, through the same one call site',
    screens.at30 > screens.at0, JSON.stringify(screens));
}

/* ================================= wrap, on more than one template ====== */
/* `Wrap` was a checkbox that did nothing on 45 of the 46 screens: only the
   Terminal template honoured it, because every other one hand-rolls its own
   layout and there is no shared text box to wrap to. Each prose template now
   passes its own width; the ones that lay out a table or a hex dump pass none,
   deliberately. */
section('screen word wrap');
{
  const LONG = 'The requested archive volume could not be mounted because the operator '
    + 'on duty at the time has not been seen since the morning of the forty-seventh.';

  const swept = await page.evaluate(async (long) => {
    const S = window.DeadSignalStudio;
    const { setVal } = await import('./src/core/dom.js');
    setVal('i-w', '480'); setVal('i-h', '360');
    setVal('i-scan', '0'); setVal('i-noise', '0'); setVal('i-vig', '0'); setVal('i-skew', '0');
    setVal('i-body', long);
    const cv = document.getElementById('icanvas');
    const sig = () => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let h = 0; for (let i = 0; i < d.length; i += 7) h = (h * 31 + d[i]) >>> 0; return h; };
    const threw = [], changed = [];
    for (const id of Object.keys(S.TEMPLATES)) {
      setVal('i-tpl', id);
      let off, on;
      try { setVal('i-wrap', false); S.renderImage({ chrome: false }); off = sig();
            setVal('i-wrap', true); S.renderImage({ chrome: false }); on = sig(); }
      catch (e) { threw.push(`${id}: ${e.message}`); continue; }
      if (off !== on) changed.push(id);
    }
    setVal('i-wrap', false); setVal('i-body', 'C:\\> _');
    return { threw, changed, total: Object.keys(S.TEMPLATES).length };
  }, LONG);

  /* The bug this catches for real: a width expression that referenced a
     variable the template did not have in scope threw at render, and a
     template that throws takes the whole screen down. */
  check('every template still renders with wrap ON', swept.threw.length === 0,
    swept.threw.slice(0, 3).join(' | ') || `${swept.total} templates`);
  check('wrap now reaches far more than the one template it used to',
    swept.changed.length >= 8, `${swept.changed.length} of ${swept.total} respond: ${swept.changed.slice(0, 8).join(', ')}`);
  /* Not all of them, and that is the point — a table is not prose. */
  check('…but not all of them: tables and dumps are left alone on purpose',
    swept.changed.length < swept.total, `${swept.total - swept.changed.length} unaffected`);

  /* The STOP screen put the whole body in as ONE array element, so its own
     newlines were never split and a two-line message drew both lines on top of
     each other at the same y. Found while wiring wrap through it. */
  const stop = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const { setVal } = await import('./src/core/dom.js');
    setVal('i-tpl', 'bsod_nt'); setVal('i-wrap', false);
    const cv = document.getElementById('icanvas');
    const rows = () => { S.renderImage({ chrome: false });
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      const seen = new Set();
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
        const i = (y * cv.width + x) * 4;
        if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) { seen.add(y); break; } }
      return seen.size; };
    setVal('i-body', 'ONE');
    const one = rows();
    setVal('i-body', 'ONE\nTWO\nTHREE\nFOUR');
    const four = rows();
    setVal('i-body', 'C:\\> _');
    return { one, four };
  });
  check('a multi-line body on the STOP screen draws on separate lines',
    stop.four > stop.one, JSON.stringify(stop));
}

/* ================================= tabs from the keyboard =============== */
/* The number-key row must reach every tab the page renders — the README once
   claimed `1‑6` for an eight-tab tool, leaving CLOUD and HELP unreachable
   from the keyboard as far as any reader knew. Pin the live behaviour. */
section('tabs from the keyboard');
{
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('7');
  check('key 7 activates CLOUD',
        await page.evaluate(() => document.querySelector('.tab.active')?.dataset.view) === 'cloud',
        await page.evaluate(() => document.querySelector('.tab.active')?.dataset.view));
  await page.keyboard.press('8');
  check('key 8 activates HELP',
        await page.evaluate(() => document.querySelector('.tab.active')?.dataset.view) === 'help',
        await page.evaluate(() => document.querySelector('.tab.active')?.dataset.view));
  await page.keyboard.press('1');   // leave the tool where later sections expect it
}

/* ============================ the seams between the new features ======== */
/* Each phase arrived with its own tests. These are the places two of them
   MEET — which is where the defects were, because no single phase's suite was
   looking at them. */
section('feature seams');
{
  /* A project is a snapshot of every control by construction, so a missing key
     can only mean the loading build has a control the saving build did not —
     which is the ordinary case: every release that adds a control makes every
     project on disk older than it. `writeControl` declines to write `undefined`,
     so the control kept whatever the PREVIOUS project left it at, and the
     render used a value the loaded project never specified. That is the one
     promise the tool cannot afford to break. */
  const older = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const { setVal } = await import('./src/core/dom.js');
    const R = await import('./src/core/recipes.js');
    const V = await import('./src/video/render.js');
    // A project from before these controls existed.
    const old = JSON.parse(JSON.stringify(S.store.doc));
    for (const id of ['v-lspace', 'v-align', 'i-lspace', 'i-wrap'])
      for (const t of ['video', 'image']) delete old.tabs[t][id];
    // The author has since set them to something loud.
    setVal('v-lspace', 40); setVal('v-align', 'right');
    setVal('i-lspace', 35); setVal('i-wrap', true);
    const before = { ls: document.getElementById('v-lspace').value,
      align: document.getElementById('v-align').value };
    R.applyProject(old);
    const cfg = V.readVideoCfg();
    return { before,
      after: { ls: document.getElementById('v-lspace').value,
        align: document.getElementById('v-align').value,
        iwrap: document.getElementById('i-wrap').checked,
        doc: S.store.get('tabs.video.v-lspace') },
      renders: { lspace: cfg.lspace, align: cfg.align } };
  });
  check('a project older than a control resets that control to its default',
    older.after.ls === '0' && older.after.align === 'left' && older.after.iwrap === false,
    `${JSON.stringify(older.before)} → ${JSON.stringify(older.after)}`);
  check('…so the render cannot use a value the loaded project never specified',
    older.renders.lspace === 0 && older.renders.align === 'left', JSON.stringify(older.renders));
  check('…and the document says so too, rather than staying silent',
    older.after.doc === '0', String(older.after.doc));

  /* RESET says "reset this whole tab to defaults". It restored every control —
     which WAS the whole tab, back when a tab was its controls. Seven kinds of
     state now live in the document instead, and RESET was leaving all of them:
     you could press it on AUDIO and still be listening to a soloed mix through
     a five-effect chain with a crop on it, banner still lit. */
  const reset = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const { setVal } = await import('./src/core/dom.js');
    S.clearAnnotations(); S.clearSolo(); S.clearRegions();
    S.addAnnotation('text', { text: 'SHOULD GO' });
    S.toggleSolo('drone');
    S.addRegion('silence', 0.2, 0.6);
    const seeded = { marks: S.store.get('image.annotations').length,
      solo: S.store.get('audio.solo').length, regions: S.store.get('audio.regions').length };
    document.querySelector('.tab[data-view=image]').click();
    document.getElementById('i-reset').click();
    const afterImage = S.store.get('image.annotations').length;
    document.querySelector('.tab[data-view=audio]').click();
    document.getElementById('a-reset').click();
    const afterAudio = { solo: S.store.get('audio.solo').length,
      regions: S.store.get('audio.regions').length,
      banner: document.getElementById('a-solo-banner').style.display };
    // One undo entry, so a misclick is recoverable.
    S.store.undo();
    const undone = { solo: S.store.get('audio.solo').length,
      regions: S.store.get('audio.regions').length };
    S.clearAnnotations(); S.clearSolo(); S.clearRegions();
    return { seeded, afterImage, afterAudio, undone };
  });
  check('RESET on SCREEN clears the marks, not just the sliders',
    reset.seeded.marks === 1 && reset.afterImage === 0, JSON.stringify(reset));
  check('RESET on AUDIO clears solo and the region edits',
    reset.afterAudio.solo === 0 && reset.afterAudio.regions === 0, JSON.stringify(reset.afterAudio));
  check('…and takes the solo banner down with them',
    reset.afterAudio.banner === 'none', reset.afterAudio.banner);
  check('…and the whole reset is one undo, so a misclick is recoverable',
    reset.undone.solo === 1 && reset.undone.regions === 1, JSON.stringify(reset.undone));

  /* The ↺ beside each legend is a reset too, and it was a much emptier promise
     than the tab-wide one. It restored inputs from the boot snapshot — so on
     the six panels whose contents are NOT inputs (FILTERS, FX CHAIN, MARKS,
     LAYERS, KEYFRAMES, audio EDITS) it toasted "Section reset" over an
     untouched chain. And on QUICK LOOK it did the opposite: the two macro dials
     are write-only, so putting them back fired them, and twelve hand-set CRT
     controls in a DIFFERENT fieldset were overwritten with macro-level-0
     values by a reset of the section above them. */
  const section = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const shell = await import('./src/ui/shell.js');
    const $ = (id) => document.getElementById(id);
    const FX = ['v-scan', 'v-noise', 'v-vig', 'v-flick', 'v-chroma', 'v-track',
                'v-glitch', 'v-bloom', 'v-hum', 'v-shake', 'v-persist', 'v-roll'];
    const setR = (id, v) => { const e = $(id); e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true })); };
    const readFx = () => Object.fromEntries(FX.map((id) => [id, $(id).value]));
    const byLegend = (t) => [...document.querySelectorAll('.view fieldset')]
      .find((f) => (f.querySelector('legend')?.textContent || '').toUpperCase().includes(t));

    document.querySelector('.tab[data-view=video]').click();
    FX.forEach((id, i) => setR(id, 11 + i));
    const handSet = readFx();
    shell.resetFieldset(byLegend('QUICK LOOK'));
    const clobbered = FX.filter((id) => handSet[id] !== readFx()[id]);

    S.store.apply({ op: 'set', path: 'filters.video',
      value: [{ id: 'blur', params: { radius: 4 }, enabled: true }] });
    const chainBefore = (S.store.get('filters.video') || []).length;
    shell.resetFieldset(byLegend('FILTERS'));
    const chainAfter = (S.store.get('filters.video') || []).length;

    document.querySelector('.tab[data-view=image]').click();
    S.store.apply({ op: 'set', path: 'image.annotations',
      value: [{ kind: 'text', x: 0.4, y: 0.4, text: 'HELLO' }] });
    const marksBefore = (S.store.get('image.annotations') || []).length;
    shell.resetFieldset(byLegend('MARKS'));
    const marksAfter = (S.store.get('image.annotations') || []).length;

    // Every panel that owns document state must say so, or its ↺ lies.
    const owning = ['v-filters-fieldset', 'v-layers-fieldset', 'v-auto-fieldset', 'a-fx-fieldset']
      .filter((id) => !$(id)?.dataset.docReset);
    // Leave the tabs as this section found them for whatever runs next.
    S.clearAnnotations(); S.clearFilters();
    document.querySelector('.tab[data-view=video]').click();
    document.getElementById('v-reset').click();
    return { clobbered, chainBefore, chainAfter, marksBefore, marksAfter, owning };
  });
  check('↺ on FILTERS clears the chain that section owns',
    section.chainBefore === 1 && section.chainAfter === 0,
    `${section.chainBefore} → ${section.chainAfter}`);
  check('↺ on MARKS clears the marks that section owns',
    section.marksBefore === 1 && section.marksAfter === 0,
    `${section.marksBefore} → ${section.marksAfter}`);
  check('↺ on QUICK LOOK does not reach into the FX section below it',
    section.clobbered.length === 0, section.clobbered.join(', ') || 'nothing else touched');
  check('every panel that owns document state declares which',
    section.owning.length === 0, section.owning.join(', ') || 'all declared');

  /* Loading a preset applies as an ordinary transaction, so the document
     binding's undo/redo/load refresh never sees it — an open gallery went on
     marking whichever preset you had before. */
  const gallery = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const { setVal } = await import('./src/core/dom.js');
    document.querySelector('.tab[data-view=video]').click();
    setVal('v-preset', 'Signal Loss');
    S.toggleGallery('video');
    await new Promise((r) => setTimeout(r, 1500));
    const marked = () => [...document.querySelectorAll('#v-gallery .gal-card.sel')]
      .map((c) => c.textContent.trim());
    const start = marked();
    setVal('v-preset', 'Digital Rain');
    const afterPick = marked();
    S.store.undo();
    const afterUndo = marked();
    S.toggleGallery('video');
    return { start, afterPick, afterUndo, picker: document.getElementById('v-preset').value };
  });
  check('an open gallery follows the picker rather than marking a stale card',
    gallery.start[0] === 'Signal Loss' && gallery.afterPick[0] === 'Digital Rain',
    JSON.stringify(gallery));
  check('…and follows an undo too',
    gallery.afterUndo[0] === gallery.picker, `${gallery.afterUndo[0]} vs picker ${gallery.picker}`);

  const trip = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const R = await import('./src/core/recipes.js');
    S.addAnnotation('text', { text: 'ROUNDTRIP', x: 0.31, y: 0.42 });
    S.toggleSolo('geiger');
    S.addRegion('silence', 0.5, 1.5);
    const saved = JSON.parse(JSON.stringify(R.readProject()));
    S.clearAnnotations(); S.clearSolo(); S.clearRegions();
    const emptied = S.store.get('image.annotations').length + S.store.get('audio.solo').length
      + S.store.get('audio.regions').length;
    R.applyProject(saved);
    const back = { marks: S.store.get('image.annotations').length,
      text: S.store.get('image.annotations')[0]?.text,
      solo: S.store.get('audio.solo').join(), regions: S.store.get('audio.regions').length };
    S.clearAnnotations(); S.clearSolo(); S.clearRegions();
    return { emptied, back };
  });
  check('save and load carries marks, solo and region edits together',
    trip.emptied === 0 && trip.back.marks === 1 && trip.back.text === 'ROUNDTRIP'
    && trip.back.solo === 'geiger' && trip.back.regions === 1, JSON.stringify(trip.back));

  /* Batch's promise is that it renders from RECIPES, never the controls. Both
     document-held chains have to honour that or the promise is only half true:
     a screen batch must no more pick up your marks than a video batch picks up
     your filter chain. */
  const isolated = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const I = await import('./src/image/render.js');
    const V = await import('./src/video/render.js');
    const P = await import('./src/presets/index.js');
    S.clearAnnotations();
    S.addAnnotation('fill', { x: 0.05, y: 0.05, w: 0.9, h: 0.9, color: '#ffffff' });
    S.clearFilters();
    S.addFilter('invert');
    const irec = Object.values(P.flatPresets('image'))[0];
    const vrec = Object.values(P.flatPresets('video'))[0];
    const out = {
      recipeMarks: I.readImageCfg(P.presetRecipe('image', 'view-image', irec)).__annotations.length,
      liveMarks: I.readImageCfg().__annotations.length,
      recipeFilters: (V.readVideoCfg(P.presetRecipe('video', 'view-video', vrec)).__filters || []).length,
      // Asserted too: with no filter in the live chain the recipe half of this
      // check would read zero either way and prove nothing.
      liveFilters: (V.readVideoCfg().__filters || []).length,
    };
    S.clearAnnotations(); S.clearFilters();
    return out;
  });
  check('a batch stays recipe-only for BOTH document chains — marks and filters',
    isolated.liveMarks === 1 && isolated.liveFilters >= 1
    && isolated.recipeMarks === 0 && isolated.recipeFilters === 0,
    JSON.stringify(isolated));

  /* THE SEQUENCE CAP IS A REFUSAL, NOT A SILENT DROP.
     normalizeClips slices to MAX_CLIPS, but commitClips wrote the DOCUMENT from
     the unsliced array — so a 65th clip left the store holding 65 while the
     sequence played 64, a disagreement that survives a save and a reload. And
     all five add paths then toasted "Clip added (64)": a number that reads as
     success and is really the count of clips that survived the one just thrown
     away. Nothing said so. */
  const cap = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const { MAX_CLIPS } = await import('./src/doc/timeline.js');
    S.clearTimeline();
    // Fill to exactly the cap through the document, then try to add past it.
    const one = { kind: 'video', rec: {}, label: 'x', scene: 'terminal',
                  src: 1, in: 0, out: 1, transition: 'cut', xdur: 0 };
    S.setTimelineClips(new Array(MAX_CLIPS).fill(0).map(() => ({ ...one })));
    // Push that state THROUGH commitClips so the document holds it too — the
    // question below is whether an add past the cap can make the two disagree,
    // and that is only observable if they agree to begin with.
    S.editClip(0, { label: 'seed' }, 'seed');
    const atCap = S.timeline.length;
    const docAtCap = (S.store.get('timeline.clips') || []).length;
    S.addTimelineClip();          // the 65th: must be refused, not dropped
    const runtime = S.timeline.length;
    /* Read the document with NOTHING in between. commitClips is what writes it,
       and any further edit would rewrite it from the already-normalised runtime
       — erasing the very divergence this is looking for. (It did: the first
       version of this check nudged a clip first and passed with the fix removed.) */
    const doc = (S.store.get('timeline.clips') || []).length;
    S.clearTimeline();
    return { MAX_CLIPS, atCap, docAtCap, runtime, doc };
  });
  check('a sequence can be filled to its cap',
    cap.atCap === cap.MAX_CLIPS && cap.docAtCap === cap.MAX_CLIPS, JSON.stringify(cap));
  check('a sequence at its cap refuses another clip rather than dropping it',
    cap.runtime === cap.MAX_CLIPS && cap.doc === cap.MAX_CLIPS, JSON.stringify(cap));
  check('…so the document can never hold more clips than the sequence plays',
    cap.doc <= cap.MAX_CLIPS, `doc ${cap.doc} vs cap ${cap.MAX_CLIPS}`);
}

console.log('-'.repeat(64));
check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
server.close();

console.log(`\nDead Signal Studio audit: ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nNeeds attention:');
  for (const f of failures) console.log('  - ' + f);
}
process.exit(fail === 0 ? 0 : 1);
