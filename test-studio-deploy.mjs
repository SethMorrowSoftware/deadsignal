/* Dead Signal Studio — deployment / API-discovery contract (headless).
 *
 * The studio is a folder, and the backend ships inside it. People copy
 * folders: to a subdirectory of an unrelated site, to a staging directory three
 * levels down, onto a static host with the API left on another origin. Every
 * one of those used to produce the same symptom — "No backend here" on a
 * perfectly healthy install — because the client derived the API address from a
 * fixed guess that was correct for exactly one layout.
 *
 * This suite pins the resolution rules from src/platform/api.js:
 *
 *   - an address typed on the CLOUD tab always wins;
 *   - studio.config.json (written by the setup wizard) beats guessing;
 *   - otherwise the first candidate that ANSWERS AS THIS API wins — the
 *     folder's own ./api, then ./api/index.php for a host that will not honour
 *     the rewrite — and is remembered;
 *   - no candidate is ever outside the studio folder: the origin root belongs
 *     to whatever else is on that domain;
 *   - "answers as this API" means a health body, not a 200 — a site that
 *     serves index.html for every path must not be mistaken for a backend;
 *   - a reachable-but-degraded API is reported as degraded, not as absent.
 *
 * Each scenario imports a fresh copy of the module (cache-busting query) so the
 * once-per-session resolution cache cannot leak between cases.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_MODULE = join(HERE, 'src/platform/api.js');

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fail++; else pass++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};

/* ------------------------------------------------------------- DOM stub --
   api.js pulls in core/recipes.js, which reaches the whole editor graph and
   touches the DOM at module scope. Same minimal stub as the module-graph
   suite — enough to import, not enough to render. */
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
  createElement: makeEl, getElementById: () => null,
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  documentElement: { style: { setProperty() {} } },
  body: makeEl('body'),
};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.window = globalThis;
globalThis.URL.createObjectURL = () => 'blob:stub';
globalThis.URL.revokeObjectURL = () => {};
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.MediaRecorder = undefined;

/* -------------------------------------------------------------- harness -- */

const HEALTHY = { status: 'healthy', database: 'connected', timestamp: '2026-01-01T00:00:00+00:00', version: '2.0.0' };

/**
 * Install one scenario's world.
 *
 * @param {string} href          where the studio is served from
 * @param {object} routes        url → { status?, json?, text? }; anything else 404s
 * @param {object} storage       seed localStorage
 */
function world(href, routes = {}, storage = {}) {
  const requests = [];
  globalThis.location = new URL(href);
  globalThis.localStorage = {
    _m: new Map(Object.entries(storage).map(([k, v]) => [k, JSON.stringify(v)])),
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); },
  };
  globalThis.fetch = async (url) => {
    const u = String(url);
    requests.push(u);
    const hit = routes[u];
    if (!hit) return { ok: false, status: 404, json: async () => { throw new Error('not json'); }, text: async () => 'Not Found' };
    const status = hit.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => { if (hit.json === undefined) throw new Error('not json'); return hit.json; },
      text: async () => hit.text ?? JSON.stringify(hit.json ?? {}),
    };
  };
  return { requests, storage: globalThis.localStorage };
}

let caseNo = 0;
const freshApi = () => import(pathToFileURL(API_MODULE).href + '?case=' + (++caseNo));

/* ============================================================== candidates */

console.log('\n-- candidate addresses --');
{
  world('https://example.test/studio/index.html');
  const API = await freshApi();
  const c = API.candidateBases();
  check('the studio\'s own api/ is tried first (one request in the common case)',
    c[0] === 'https://example.test/studio/api', c[0]);
  check('the no-rewrite form of the same backend is the only other guess',
    c[1] === 'https://example.test/studio/api/index.php' && c.length === 2, c.join(' '));
}
{
  // The failure this rule exists for: a studio in a subdirectory reporting an
  // address on the root domain, which belongs to a different application.
  world('https://example.test/projects/site/tools/media-studio/');
  const API = await freshApi();
  const c = API.candidateBases();
  check('a whole-site subdirectory install resolves relative to the studio, not the origin',
    c[0] === 'https://example.test/projects/site/tools/media-studio/api', c[0]);
  check('NO candidate is outside the studio folder',
    c.every((u) => u.startsWith('https://example.test/projects/site/tools/media-studio/')), c.join(' '));
}

/* ================================================================ ordering */

console.log('\n-- resolution order --');
{
  // Typed on the CLOUD tab: nothing may override it, including a working
  // auto-detected address.
  const w = world('https://example.test/studio/index.html', {
    'https://other.test/api/system/health': { json: HEALTHY },
    'https://example.test/studio/api/system/health': { json: HEALTHY },
  }, { 'deadsignal.studio.apiBase': 'https://other.test/api' });
  const API = await freshApi();
  check('an explicitly set address wins over anything detectable',
    API.apiBase() === 'https://other.test/api');
  const r = await API.resolveApiBase();
  check('…and resolution reports it as explicit', r.source === 'explicit' && r.base === 'https://other.test/api');
  check('…without probing the layout candidates',
    !w.requests.some((u) => u.startsWith('https://example.test/')), w.requests.join(' '));
}
{
  // The wizard's note beside index.html. The client-side files were copied
  // somewhere the api/ folder did not follow, and the address it names is NOT
  // the one probing would land on first — so the note has to win.
  const w = world('https://example.test/site/studio/index.html', {
    'https://example.test/site/studio/studio.config.json': { json: { apiBase: '../api' } },
    'https://example.test/site/api/system/health': { json: HEALTHY },
    'https://example.test/site/studio/api/system/health': { json: HEALTHY },
  });
  const API = await freshApi();
  const r = await API.resolveApiBase();
  check('studio.config.json beats guessing',
    r.base === 'https://example.test/site/api' && r.source === 'studio.config.json', r.base + ' / ' + r.source);
  check('its relative address is resolved against the studio folder',
    w.requests.includes('https://example.test/site/api/system/health'));
}
{
  // No note, no override: walk the candidates. This host ignores .htaccess
  // (AllowOverride None — the single most common way this goes wrong on shared
  // hosting), so the rewritten path 404s and the front controller answers only
  // at its own filename.
  const w = world('https://example.test/site/studio/index.html', {
    'https://example.test/site/studio/api/index.php/system/health': { json: HEALTHY },
  });
  const API = await freshApi();
  const r = await API.resolveApiBase();
  check('a host that will not honour the rewrite is still found',
    r.base === 'https://example.test/site/studio/api/index.php' && r.source === 'detected', r.base);
  check('the rewritten path was tried first',
    w.requests[1] === 'https://example.test/site/studio/api/system/health', w.requests.join(' '));
  check('the working address is remembered for next time',
    JSON.parse(w.storage.getItem('deadsignal.studio.apiBaseAuto'))
      === 'https://example.test/site/studio/api/index.php');
  check('apiBase() then returns it synchronously',
    API.apiBase() === 'https://example.test/site/studio/api/index.php');
}
{
  // Remembered from a previous session: one request, straight to it.
  const w = world('https://example.test/site/studio/index.html', {
    'https://example.test/site/studio/api/system/health': { json: HEALTHY },
  }, { 'deadsignal.studio.apiBaseAuto': 'https://example.test/site/studio/api' });
  const API = await freshApi();
  const r = await API.resolveApiBase();
  check('a remembered address is used without re-walking the candidates',
    r.source === 'remembered' && w.requests.length === 1, w.requests.join(' '));
}
{
  // Remembered, but the install moved. The memory must not be sticky.
  const w = world('https://example.test/site/studio/index.html', {
    'https://example.test/site/studio/api/system/health': { json: HEALTHY },
  }, { 'deadsignal.studio.apiBaseAuto': 'https://example.test/gone/api' });
  const API = await freshApi();
  const r = await API.resolveApiBase();
  check('a remembered address that no longer answers is discarded, not kept',
    r.base === 'https://example.test/site/studio/api' && r.source === 'detected', r.base);
}

/* ========================================================== identification */

console.log('\n-- is that actually the API? --');
{
  // A single-page app that serves index.html for every path answers 200 to
  // <anything>/system/health. Treating that as a backend produces a studio that
  // says it is connected and then fails on every call.
  const w = world('https://example.test/site/studio/index.html', {
    'https://example.test/site/studio/api/system/health': { status: 200, text: '<!doctype html><title>Some site</title>' },
    'https://example.test/site/studio/api/index.php/system/health': { json: HEALTHY },
  });
  const API = await freshApi();
  const r = await API.resolveApiBase();
  check('a 200 that is not a health body is not mistaken for the API',
    r.base === 'https://example.test/site/studio/api/index.php', r.base);
}
{
  const w = world('https://example.test/studio/index.html', {
    'https://example.test/studio/api/system/health': { status: 503, json: { status: 'degraded', database: 'disconnected', version: '1.0.0' } },
  });
  const API = await freshApi();
  const r = await API.resolveApiBase();
  check('a degraded (503) API still identifies itself', r.base === 'https://example.test/studio/api' && !!r.health);
  const p = await API.probe();
  check('probe reports it as reachable and degraded, not as absent',
    p.reachable === true && p.degraded === true, JSON.stringify(p));
  check('…and names the database as the reason',
    /database/i.test(p.reason || ''), p.reason);
}
{
  const w = world('https://example.test/studio/index.html', {});
  const API = await freshApi();
  const p = await API.probe();
  check('with no backend anywhere, probe says so', p.reachable === false);
  check('…and names the address it looked at', (p.reason || '').includes('/studio/api'), p.reason);
  check('…and points at the cause rather than the database',
    /uploaded|PHP/i.test(p.reason || ''), p.reason);
  check('…having tried every candidate exactly once',
    w.requests.filter((u) => u.endsWith('/system/health')).length === API.candidateBases().length,
    w.requests.join(' '));
  check('…and remembered nothing', w.storage.getItem('deadsignal.studio.apiBaseAuto') === 'null');
}

/* ================================================================ override */

console.log('\n-- setting and clearing the address --');
{
  const w = world('https://example.test/studio/index.html', {
    'https://example.test/studio/api/system/health': { json: HEALTHY },
  }, { 'deadsignal.studio.apiBase': 'https://typed.test/api',
       'deadsignal.studio.apiBaseAuto': 'https://stale.test/api' });
  const API = await freshApi();
  API.setApiBase('');
  check('clearing the typed address also drops the remembered one',
    w.storage.getItem('deadsignal.studio.apiBase') === '""'
    && w.storage.getItem('deadsignal.studio.apiBaseAuto') === 'null');
  const r = await API.resolveApiBase({ force: true });
  check('…so the next look rediscovers rather than reusing either',
    r.base === 'https://example.test/studio/api' && r.source === 'detected', r.base + ' / ' + r.source);
}
{
  const w = world('https://example.test/studio/index.html', {
    'https://example.test/studio/api/system/health': { json: HEALTHY },
  });
  const API = await freshApi();
  check('a trailing slash is normalised away',
    API.setApiBase('https://typed.test/api///') === 'https://typed.test/api');
  await API.resolveApiBase();
  const before = w.requests.length;
  await API.resolveApiBase();
  check('resolution is cached within a session', w.requests.length === before);
  await API.resolveApiBase({ force: true });
  check('…and force re-checks (what the CLOUD tab REFRESH does)', w.requests.length > before);
}

/* =================================================================== paths */

console.log('\n-- request paths --');
{
  const w = world('https://example.test/projects/site/tools/media-studio/index.html', {
    'https://example.test/projects/site/tools/media-studio/api/system/health': { json: HEALTHY },
    'https://example.test/projects/site/tools/media-studio/api/studio/config': { json: { enabled: true, quota: { used: 0, quota: 10 } } },
  }, { 'deadsignal.studio.apiToken': 'tok' });
  const API = await freshApi();
  const p = await API.probe();
  check('a subdirectory install signs in against its own API',
    p.reachable === true && p.signedIn === true && p.enabled === true, JSON.stringify(p));
  check('…and every API call goes to the subdirectory path',
    w.requests.filter((u) => u.includes('/api/'))
      .every((u) => u.startsWith('https://example.test/projects/site/tools/media-studio/api/')), w.requests.join(' '));
  check('…while the deployment note is read from the studio folder itself',
    w.requests[0] === 'https://example.test/projects/site/tools/media-studio/studio.config.json', w.requests[0]);
}

{
  /* The share-link reader: an empty browser, and their FIRST request is the
     share fetch — issued beside the CLOUD panel's probe, not after it. Any
     call that used the synchronous guess instead of the resolved address sent
     that reader to the wrong origin and showed them an empty project. Found
     for real by the live browser suite against a relocated studio folder. */
  const w = world('https://example.test/site/studio/index.html', {
    'https://example.test/site/studio/api/index.php/system/health': { json: HEALTHY },
    'https://example.test/site/studio/api/index.php/studio/shared/abc': { json: { project: { name: 'Shared' } } },
  });
  const API = await freshApi();
  const r = await API.getShared('abc');
  check('the very first API call resolves the address instead of guessing',
    r?.project?.name === 'Shared', JSON.stringify(r));
  check('…so a share link works in a browser that has never probed',
    w.requests.includes('https://example.test/site/studio/api/index.php/studio/shared/abc'),
    w.requests.join(' '));
}

console.log(`\n${'='.repeat(60)}\nResults: ${pass}/${pass + fail} passed${fail ? ` (${fail} failed)` : ''}`);
process.exit(fail > 0 ? 1 : 0);
