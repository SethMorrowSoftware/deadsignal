/* Dead Signal Studio — platform/api.js
 *
 * Talking to the optional multi-user backend.
 *
 * The studio works with no backend at all, and that stays true: everything here
 * is behind a probe. If the API is not reachable, or is reachable but has the
 * studio backend switched off, the CLOUD panel says so and the rest of the tool
 * is unaffected.
 *
 * WHERE THE API IS
 *
 * Inside the studio folder, at ./api — the backend ships with the tool, so it
 * moves with it. That makes the common answer a single relative path that is
 * correct wherever the folder was copied to: a whole domain, a subdirectory of
 * an unrelated site, a staging folder three levels down.
 *
 * It is still resolved rather than assumed, because two deployments break the
 * rule: an API deliberately hosted on another origin, and a host that will not
 * honour the rewrite in api/.htaccess (AllowOverride None, or nginx without a
 * try_files rule), where the same backend answers at ./api/index.php instead.
 *
 *   1. an explicit address typed on the CLOUD tab (localStorage) — always wins;
 *   2. studio.config.json beside index.html, written by the setup wizard;
 *   3. the first candidate that answers as this API — ./api, then
 *      ./api/index.php.
 *
 * Both candidates are INSIDE the studio folder, and that is deliberate: the
 * origin root is a different application's business. Guessing there produced
 * the worst failure of the lot on a subdirectory install — a studio at
 * /projects/site/studio/ reporting that its backend was at https://example.com/api,
 * an address belonging to whatever else lives on that domain.
 *
 * "Answers as this API" means a /system/health body carrying status+version,
 * not merely a 200: a single-page app that returns index.html for every path
 * would otherwise be mistaken for a backend. A degraded (503) health response
 * still identifies the API — it is reachable and its database is down, which is
 * a different problem and deserves a different message.
 *
 * The session token is held in localStorage, never in a URL. Tokens in query
 * strings end up in proxy logs, browser history and referrer headers.
 */
import { lsGet, lsSet } from '../core/recipes.js';

const BASE_KEY = 'deadsignal.studio.apiBase';       // explicit, user-set
const AUTO_KEY = 'deadsignal.studio.apiBaseAuto';   // last address that answered
const TOKEN_KEY = 'deadsignal.studio.apiToken';
const DEPLOY_FILE = 'studio.config.json';

const clean = (u) => String(u || '').trim().replace(/\/+$/, '');
const abs = (u) => { try { return clean(new URL(u, location.href).href); } catch { return clean(u); } };

/** Every layout worth trying, nearest-first, deduplicated. */
export function candidateBases() {
  const out = [];
  const push = (u) => { const v = abs(u); if (v && !out.includes(v)) out.push(v); };
  // The shipped layout first, so the common case costs exactly one request.
  push('./api');
  // The same backend, reached without the rewrite. On a host that ignores
  // .htaccess this is the difference between "the studio works" and "the
  // studio says there is no backend" — and it is one extra request, once.
  push('./api/index.php');
  return out.length ? out : ['./api'];
}

/**
 * Where the API is, synchronously — the explicit setting, the remembered
 * answer, or the best guess. Every request goes through this; resolveApiBase()
 * is what turns a guess into a remembered answer.
 */
export function apiBase() {
  const stored = lsGet(BASE_KEY, null);
  if (typeof stored === 'string' && stored) return clean(stored);
  const auto = lsGet(AUTO_KEY, null);
  if (typeof auto === 'string' && auto) return clean(auto);
  return candidateBases()[0];
}

/**
 * Set (or, with an empty value, clear) the explicit address.
 *
 * Clearing drops the remembered answer too, so the next probe rediscovers
 * rather than silently keeping whatever the override replaced.
 */
export function setApiBase(url) {
  const v = clean(url);
  lsSet(BASE_KEY, v);
  if (!v) lsSet(AUTO_KEY, null);
  return v;
}

/** Is this address our API? Returns the parsed health body, or null. */
async function healthOf(base, signal) {
  try {
    const res = await fetch(base + '/system/health', { headers: { 'X-Requested-With': 'XMLHttpRequest' }, signal });
    const body = await res.json().catch(() => null);
    // 503 is still an identification: the API is there and its database is not.
    if (body && typeof body.status === 'string' && typeof body.version === 'string') return body;
    return null;
  } catch { return null; }
}

/** The address the setup wizard recorded beside index.html, if any. */
async function deployedBase() {
  try {
    const res = await fetch(abs(DEPLOY_FILE), { cache: 'no-store' });
    if (!res.ok) return null;
    const cfg = await res.json();
    const b = cfg && typeof cfg.apiBase === 'string' ? cfg.apiBase.trim() : '';
    return b ? abs(b) : null;
  } catch { return null; }
}

/* One resolution per session unless something asks for another: probing costs
   a handful of requests on a deployment that has no backend at all, and that
   is the deployment least interested in paying for it repeatedly. */
let _resolved = null;

/**
 * Find the API and remember it.
 *
 * @returns {Promise<{base:string, health:object|null, source:string}>}
 */
export async function resolveApiBase({ force = false } = {}) {
  if (_resolved && !force) return _resolved;

  const explicit = lsGet(BASE_KEY, null);
  if (typeof explicit === 'string' && explicit) {
    const base = clean(explicit);
    _resolved = { base, health: await healthOf(base), source: 'explicit' };
    return _resolved;
  }

  const remembered = force ? null : lsGet(AUTO_KEY, null);
  if (typeof remembered === 'string' && remembered) {
    const health = await healthOf(clean(remembered));
    if (health) {
      _resolved = { base: clean(remembered), health, source: 'remembered' };
      return _resolved;
    }
  }

  const deployed = await deployedBase();
  const list = deployed ? [deployed, ...candidateBases()] : candidateBases();
  for (const base of list) {
    const health = await healthOf(base);
    if (health) {
      lsSet(AUTO_KEY, base);
      _resolved = { base, health, source: base === deployed ? 'studio.config.json' : 'detected' };
      return _resolved;
    }
  }

  // Nothing answered. Forget any stale memory so a later install is found, and
  // report the guess so the failure message names a real address.
  lsSet(AUTO_KEY, null);
  _resolved = { base: list[0], health: null, source: 'guess' };
  return _resolved;
}

export function getToken() {
  const t = lsGet(TOKEN_KEY, null);
  return typeof t === 'string' && t ? t : null;
}
export function setToken(t) { lsSet(TOKEN_KEY, t || null); }
export const isSignedIn = () => !!getToken();

/**
 * One request.
 *
 * `X-Requested-With` is what the backend's CSRF middleware requires on every
 * mutating request — a cross-site form post cannot set it.
 */
export async function api(path, { method = 'GET', body, raw = false, signal } = {}) {
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;

  let payload;
  if (body instanceof FormData) payload = body;             // multipart sets its own type
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

  // Resolve before the first call rather than trusting the synchronous guess.
  // A share-link reader arrives with an empty browser and their FIRST request
  // is the share fetch — it runs beside the CLOUD panel's probe, not after it,
  // so relying on the probe to have resolved the address meant a relocated
  // studio folder served that reader a 404 and an empty project.
  const { base } = await resolveApiBase();
  const res = await fetch(base + path, { method, headers, body: payload, signal });

  if (res.status === 401 && token) {
    // The token is dead. Drop it rather than looping on it — the panel will
    // show the sign-in form again on its next render. Only when a token was
    // actually SENT: a 401 from the login endpoint itself means wrong
    // credentials, and telling that user their "session expired" points them
    // at a session they never had.
    setToken(null);
    throw new ApiError('Your session expired — sign in again', 401);
  }
  if (raw) {
    if (!res.ok) throw new ApiError(await errorText(res), res.status);
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || ('Request failed (' + res.status + ')'), res.status);
  return data;
}

async function errorText(res) {
  try { return (await res.json()).error || 'Request failed'; } catch { return 'Request failed (' + res.status + ')'; }
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.name = 'ApiError'; this.status = status; }
}

/**
 * Is there a backend, and is the studio part of it switched on?
 *
 * Deliberately tolerant: a static deployment has no API anywhere, and finding
 * none is a normal answer here rather than an error worth showing.
 *
 * @param {{force?: boolean}} opts force re-resolves the address — what the
 *        CLOUD tab's refresh does, so an install that appeared after the first
 *        look is found without a reload.
 */
export async function probe({ force = false } = {}) {
  const { base, health, source } = await resolveApiBase({ force });
  if (!health) {
    // Name the address that was tried and the two things that actually cause
    // this, in the order they are worth checking. "No backend here" on its own
    // sent people looking at their database.
    return { reachable: false, base, reason: source === 'explicit'
      ? 'No backend at ' + base + ' — the address set on this tab'
      : 'No backend found at ' + base + ' — check that api/ and server/ were uploaded '
        + 'with the studio, and that PHP runs there' };
  }
  if (health.status !== 'healthy') {
    // Reachable, and its database is not. Saying which is the difference
    // between "check your install" and "check your database".
    return { reachable: true, base, degraded: true, signedIn: false,
             reason: 'The API is up but reports ' + health.status + ' (database: ' + (health.database || 'unknown') + ')' };
  }
  if (!getToken()) return { reachable: true, base, signedIn: false };
  try {
    const cfg = await api('/studio/config');
    return { reachable: true, base, signedIn: true, ...cfg };
  } catch (e) {
    if (e.status === 401) return { reachable: true, base, signedIn: false };
    return { reachable: true, base, signedIn: true, enabled: false, reason: e.message };
  }
}

export async function signIn(displayName, password) {
  const r = await api('/auth/login', { method: 'POST', body: { displayName, password } });
  if (!r.token) throw new ApiError('The server did not return a session', 500);
  setToken(r.token);
  return r.user;
}

export async function signOut() {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* the token is going anyway */ }
  setToken(null);
}

/* ---- projects ---------------------------------------------------------- */

// The server's clamp is 200; asking for its maximum beats silently living
// with the default 50. The panel banners the difference when total exceeds it.
export const listProjects = () => api('/studio/projects?limit=200');
export const getProject = (id) => api('/studio/projects/' + encodeURIComponent(id));
export const createProject = (name, document) =>
  api('/studio/projects', { method: 'POST', body: { name, document } });
export const saveProject = (id, document, extra = {}) =>
  api('/studio/projects/' + encodeURIComponent(id), { method: 'PUT', body: { document, ...extra } });
export const deleteProject = (id) =>
  api('/studio/projects/' + encodeURIComponent(id), { method: 'DELETE' });
export const listVersions = (id) => api('/studio/projects/' + encodeURIComponent(id) + '/versions');
/** A named snapshot. Named versions are never pruned; autosaves are. */
export const createVersion = (id, label) =>
  api('/studio/projects/' + encodeURIComponent(id) + '/versions', { method: 'POST', body: { label } });
export const restoreVersion = (versionId) =>
  api('/studio/versions/' + encodeURIComponent(versionId) + '/restore', { method: 'POST' });
export const listShares = (id) => api('/studio/projects/' + encodeURIComponent(id) + '/shares');
export const shareWithUser = (id, user, role) =>
  api('/studio/projects/' + encodeURIComponent(id) + '/shares', { method: 'POST', body: { user, role } });
export const createShareLink = (id, role, expiresInDays) =>
  api('/studio/projects/' + encodeURIComponent(id) + '/shares',
      { method: 'POST', body: { role, expiresInDays } });
/** Public read through a share link — no token, no account needed. */
export const getShared = (token) => api('/studio/shared/' + encodeURIComponent(token));
export const revokeShare = (shareId) =>
  api('/studio/shares/' + encodeURIComponent(shareId), { method: 'DELETE' });

/* ---- assets ------------------------------------------------------------ */

export const listServerAssets = () => api('/studio/assets');

/** SHA-256 of a Blob, as the lowercase hex the API expects.
 *
 * crypto.subtle only exists in secure contexts. A studio served over plain
 * http (a cPanel install before the certificate is set up) is exactly the
 * deployment that needs uploads to work, so a JS implementation carries the
 * insecure case rather than crashing the whole upload with a TypeError. */
export async function sha256(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Fallback(bytes);
}

/* FIPS 180-4, unrolled nothing — clarity over speed. Only runs on insecure
   origins, where it hashes a few MB per second; correctness is what matters,
   and the API suite verifies these digests against PHP's hash() live. */
function sha256Fallback(bytes) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const len = bytes.length;
  const padded = new Uint8Array(((len + 8) >> 6 << 6) + 64);
  padded.set(bytes);
  padded[len] = 0x80;
  const bitLen = len * 8;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  const w = new Uint32Array(64);
  const rr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H.map((x) => x.toString(16).padStart(8, '0')).join('');
}

/**
 * Upload a blob in chunks, resuming anything already received.
 *
 * The server decides the chunk size from its own limits, so this never assumes
 * one. Chunks the server already has are skipped, which is what makes a dropped
 * connection cost the remainder rather than the whole file.
 *
 * Resume only works if the RETRY reuses the interrupted session: the server
 * reports which chunks it holds for a given uploadId, and a fresh init always
 * starts empty. So the session id is remembered per content hash and offered
 * back on the next attempt — and whatever id the server RETURNS is the one
 * that is used, because the server issues a brand-new id when the old session
 * has been swept.
 */
const UPLOAD_SESSION_KEY = 'deadsignal.studio.uploadSessions';

function rememberedUploadId(sha) {
  const all = lsGet(UPLOAD_SESSION_KEY, {});
  return (all && typeof all === 'object' && typeof all[sha] === 'string') ? all[sha] : undefined;
}
function rememberUploadId(sha, id) {
  const all = lsGet(UPLOAD_SESSION_KEY, {});
  const clean = (all && typeof all === 'object') ? all : {};
  if (id) clean[sha] = id; else delete clean[sha];
  // Bounded: an abandoned map entry costs a failed-resume round trip, not a leak.
  const keys = Object.keys(clean);
  if (keys.length > 32) keys.slice(0, keys.length - 32).forEach((k) => delete clean[k]);
  lsSet(UPLOAD_SESSION_KEY, clean);
}

export async function uploadAsset(blob, { name, kind = 'other', projectId, onProgress, signal } = {}) {
  const sha = await sha256(blob);
  const init = await api('/studio/assets/init', {
    method: 'POST', signal,
    body: { sha256: sha, size: blob.size, name, kind, uploadId: rememberedUploadId(sha) },
  });

  // Already on the server: re-exporting an unchanged clip is byte-identical by
  // design, so this is the common case rather than an edge one.
  if (init.alreadyUploaded && init.asset) {
    rememberUploadId(sha, null);
    onProgress?.(1);
    return { asset: init.asset, deduped: true, skipped: true };
  }

  rememberUploadId(sha, init.uploadId);

  const size = Math.max(65536, init.chunkSize || 2097152);
  const total = Math.max(1, Math.ceil(blob.size / size));
  const have = new Set(init.received || []);

  for (let i = 0; i < total; i++) {
    if (have.has(i)) { onProgress?.((i + 1) / total); continue; }
    const fd = new FormData();
    fd.append('uploadId', init.uploadId);
    fd.append('index', String(i));
    fd.append('chunk', blob.slice(i * size, (i + 1) * size), 'chunk');
    await api('/studio/assets/chunk', { method: 'POST', body: fd, signal });
    onProgress?.((i + 1) / total);
  }

  const done = await api('/studio/assets/complete', {
    method: 'POST', signal,
    body: { uploadId: init.uploadId, sha256: sha, size: blob.size, name, kind, projectId },
  });
  rememberUploadId(sha, null);
  return { asset: done.asset, deduped: !!done.deduped, skipped: false };
}

export const deleteServerAsset = (id) =>
  api('/studio/assets/' + encodeURIComponent(id), { method: 'DELETE' });

/** Download an asset's bytes as a Blob. */
export async function fetchAsset(id) {
  const res = await api('/studio/assets/' + encodeURIComponent(id) + '/raw', { raw: true });
  return res.blob();
}
