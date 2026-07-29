/* Dead Signal Studio — ui/cloud.js
 *
 * The CLOUD tab: the optional multi-user backend, if there is one.
 *
 * Everything here is behind a probe, and every state says what it is rather
 * than showing an empty panel: no backend, a backend with the studio switched
 * off, a backend you are not signed in to, and a backend you are using are four
 * different situations and an author should never have to guess which one they
 * are in.
 */
import { $, escHtml, log, toast } from '../core/dom.js';
import { applyProject, readProject } from '../core/recipes.js';
import { addToLibrary, library } from '../library/library.js';
import * as API from '../platform/api.js';

let _state = { checked: false, reachable: false, signedIn: false, enabled: false, reason: '' };
let _projects = [];
let _projectsTotal = 0;
let _openId = null;      // the server project this session is bound to
let _sharedName = null;  // set instead when opened read-only from a share link
let _detailId = null;    // the project whose versions and shares are shown
let _versions = [];
let _shares = [];
let _assets = [];

export const openProjectId = () => _openId;

/* ---- rendering --------------------------------------------------------- */

const fmtWhen = (t) => escHtml(String(t || '').slice(0, 16));
/* Bytes at a readable scale. A 1 KB asset shown as "0 MB" reads as a failed
   upload, which is the opposite of what happened. */
const fmtSize = (n) => {
  if (!n) return '0 KB';
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  return Math.max(1, Math.round(n / 1024)) + ' KB';
};

const banner = (text, kind = '') => {
  const d = document.createElement('div');
  d.className = 'banner' + (kind ? ' ' + kind : '');
  d.textContent = text;
  return d;
};

function renderStatus() {
  const box = $('cloud-status');
  if (!box) return;
  box.replaceChildren();

  // Before any early return: a reader who arrived through a share link is
  // usually NOT signed in, and that branch returns early — so placing this
  // later meant the one person who needs the notice never saw it.
  if (_sharedName) {
    box.appendChild(banner('Viewing "' + _sharedName + '" from a share link — read-only. '
      + 'Sign in and use "⇧ SAVE TO SERVER" to keep a copy of your own.'));
  }

  if (!_state.checked) { box.appendChild(banner('Checking for a backend…')); return; }
  if (!_state.reachable) {
    box.appendChild(banner('No backend here — the studio is running standalone. '
      + 'Everything works; projects and assets stay in this browser.'));
    box.appendChild(banner(_state.reason || '', 'hint'));
    box.appendChild(banner('If there is one, put its address in the API field above — '
      + 'or run this folder\'s setup.php, which records it.', 'hint'));
    return;
  }
  if (_state.degraded) {
    // Found, but not serving: naming the database keeps this out of the
    // "the studio is broken" bucket it does not belong in.
    box.appendChild(banner(_state.reason || 'The API is reachable but not healthy.', 'err'));
    return;
  }
  if (!_state.signedIn) { box.appendChild(banner('A backend is available. Sign in to sync projects.')); return; }
  if (!_state.enabled) {
    box.appendChild(banner('This server has a backend, but the studio part is switched off. '
      + 'An admin can enable it in setup.php or config/studio.php.', 'err'));
    return;
  }
  const q = _state.quota || {};
  const ok = banner('Signed in. Storage ' + fmtSize(q.used || 0) + ' of ' + fmtSize(q.quota || 0)
    + (q.percent != null ? ' (' + q.percent + '%)' : ''));
  // A working state should not be styled like a warning.
  ok.style.borderColor = 'var(--phos-dim)';
  ok.style.color = 'var(--phos)';
  box.appendChild(ok);
}

function renderAuth() {
  const form = $('cloud-auth');
  const out = $('cloud-signout');
  if (!form || !out) return;
  const showForm = _state.reachable && !_state.signedIn;
  form.style.display = showForm ? '' : 'none';
  out.style.display = _state.signedIn ? '' : 'none';
}

function renderProjects() {
  const box = $('cloud-projects');
  if (!box) return;
  box.replaceChildren();
  if (!_state.signedIn || !_state.enabled) return;

  if (!_projects.length) {
    box.appendChild(banner('No projects on the server yet. "⇧ SAVE TO SERVER" puts this one there.', 'hint'));
    return;
  }
  if (_projectsTotal > _projects.length) {
    box.appendChild(banner('Showing ' + _projects.length + ' of ' + _projectsTotal
      + ' projects — the server lists the most recently updated first.', 'hint'));
  }
  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th scope="col">Project</th><th scope="col">Access</th>'
    + '<th scope="col">Updated</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>';
  const body = document.createElement('tbody');
  for (const p of _projects) {
    const tr = document.createElement('tr');
    const open = String(p.id) === String(_openId);
    tr.innerHTML =
      '<td>' + (open ? '<b>' : '') + escHtml(p.name) + (open ? '</b> <span class="pill">open</span>' : '') + '</td>'
      + '<td>' + escHtml(p.access || '') + '</td>'
      + '<td>' + escHtml(String(p.updated_at || '').slice(0, 16)) + '</td>'
      + '<td><button class="btn small" data-open="' + escHtml(String(p.id)) + '">OPEN</button> '
      + '<button class="btn small" data-detail="' + escHtml(String(p.id)) + '">DETAILS</button> '
      + (p.access === 'owner'
          ? '<button class="btn small" data-del="' + escHtml(String(p.id)) + '">✕</button>'
          : '') + '</td>';
    body.appendChild(tr);
  }
  table.appendChild(body);
  box.appendChild(table);
}


/** Wrap a table so a wide one scrolls inside itself, never sideways. */
function tableIn(box, head, rowsHtml) {
  const wrap = document.createElement('div');
  wrap.className = 'srv-wrap';
  const t = document.createElement('table');
  t.className = 'srv';
  t.innerHTML = '<thead><tr>' + head + '</tr></thead><tbody>' + rowsHtml + '</tbody>';
  wrap.appendChild(t);
  box.appendChild(wrap);
  return t;
}

function renderDetail() {
  const panel = $('cloud-detail-panel');
  if (!panel) return;
  const project = _projects.find((p) => String(p.id) === String(_detailId));
  panel.style.display = project ? '' : 'none';
  if (!project) return;
  $('cloud-detail-name').textContent = project.name + ' · ' + (project.access || '');

  /* ---- versions ---- */
  const vbox = $('cloud-versions');
  vbox.replaceChildren();
  if (!_versions.length) {
    vbox.appendChild(banner('No snapshots yet. One is taken automatically each time you save.', 'hint'));
  } else {
    tableIn(vbox,
      '<th scope="col">When</th><th scope="col">Label</th><th scope="col">Size</th>'
      + '<th scope="col"><span class="sr-only">Restore</span></th>',
      _versions.map((v) =>
        '<tr><td>' + fmtWhen(v.created_at) + '</td>'
        + '<td>' + (v.label ? escHtml(v.label) : '<span class="hint">autosave</span>') + '</td>'
        + '<td>' + fmtSize(v.size_bytes || 0) + '</td>'
        + '<td>' + (project.access === 'viewer' || project.access === 'commenter' ? ''
            : '<button class="btn small" data-restore="' + escHtml(String(v.id)) + '">RESTORE</button>')
        + '</td></tr>').join(''));
  }
  // Snapshotting is an edit; a viewer has nothing to snapshot.
  const canEdit = project.access === 'owner' || project.access === 'editor';
  if ($('cloud-snapshot')) $('cloud-snapshot').disabled = !canEdit;
  if ($('cloud-snap-label')) $('cloud-snap-label').disabled = !canEdit;

  /* ---- shares ---- */
  const sbox = $('cloud-shares');
  sbox.replaceChildren();
  const owner = project.access === 'owner';
  ['cloud-share-user', 'cloud-share-role', 'cloud-share-days', 'cloud-share-add']
    .forEach((id) => { if ($(id)) $(id).disabled = !owner; });
  if (!owner) {
    sbox.appendChild(banner('Only the owner can change who this is shared with.', 'hint'));
    return;
  }
  if (!_shares.length) {
    sbox.appendChild(banner('Not shared with anyone.', 'hint'));
    return;
  }
  tableIn(sbox,
    '<th scope="col">Who</th><th scope="col">Access</th><th scope="col">Expires</th>'
    + '<th scope="col"><span class="sr-only">Revoke</span></th>',
    _shares.map((sh) =>
      '<tr><td>' + (sh.is_link ? '<span class="pill">link</span>' : escHtml(sh.grantee_name || '—')) + '</td>'
      + '<td>' + escHtml(sh.role || '') + '</td>'
      + '<td>' + (sh.link_expires_at ? fmtWhen(sh.link_expires_at) : '<span class="hint">never</span>') + '</td>'
      + '<td><button class="btn small" data-revoke="' + escHtml(String(sh.id)) + '">REVOKE</button></td></tr>').join(''));
}

function renderAssets() {
  const box = $('cloud-assets');
  if (!box) return;
  box.replaceChildren();
  const count = $('cloud-assets-count');
  if (count) count.textContent = _assets.length ? String(_assets.length) : '';
  if (!_state.signedIn || !_state.enabled) return;
  if (!_assets.length) {
    box.appendChild(banner('Nothing uploaded yet. "⇧ UPLOAD LIBRARY" sends this session\'s assets.', 'hint'));
    return;
  }
  tableIn(box,
    '<th scope="col">File</th><th scope="col">Kind</th><th scope="col">Size</th>'
    + '<th scope="col">Uploaded</th><th scope="col"><span class="sr-only">Actions</span></th>',
    _assets.map((a) =>
      '<tr><td>' + escHtml(a.original_name || '(unnamed)') + '</td>'
      + '<td>' + escHtml(a.kind || '') + '</td>'
      + '<td>' + fmtSize(a.size || 0) + '</td>'
      + '<td>' + fmtWhen(a.created_at) + '</td>'
      + '<td><button class="btn small" data-get="' + escHtml(String(a.id)) + '">→ LIBRARY</button> '
      + '<button class="btn small" data-rmasset="' + escHtml(String(a.id)) + '">✕</button></td></tr>').join(''));
}

export function renderCloud() { renderStatus(); renderAuth(); renderProjects(); renderDetail(); renderAssets(); }

/* ---- actions ----------------------------------------------------------- */

export async function refreshCloud({ force = false } = {}) {
  _state = { ...(await API.probe({ force })), checked: true };
  // The address can change under us — a wizard just ran, an override was
  // typed, the first probe found nothing. Keep the field showing what is
  // actually in use rather than what was in use at page load.
  const field = $('cloud-apibase');
  if (field && document.activeElement !== field) field.value = _state.base || API.apiBase();
  if (_state.signedIn && _state.enabled) {
    try {
      const r = await API.listProjects();
      _projects = r.projects || [];
      // The server clamps at 200; beyond that the listing is genuinely
      // partial and should say so rather than quietly shrink the world.
      _projectsTotal = Number.isFinite(r.total) ? r.total : _projects.length;
    }
    catch (e) { _projects = []; _projectsTotal = 0; log('Could not list projects: ' + e.message, 'err'); }
    try { _assets = (await API.listServerAssets()).assets || []; }
    catch (e) { _assets = []; log('Could not list assets: ' + e.message, 'err'); }
    // A project that no longer exists must not keep a stale detail pane open.
    if (_detailId && !_projects.some((p) => String(p.id) === String(_detailId))) {
      _detailId = null; _versions = []; _shares = [];
    } else if (_detailId) {
      await loadDetail(_detailId);
    }
  } else {
    _projects = []; _assets = []; _detailId = null; _versions = []; _shares = [];
  }
  renderCloud();
  return _state;
}

async function guard(fn, what) {
  try { await fn(); }
  catch (e) {
    // The server's reason is the useful part: "Storage quota exceeded" and
    // "the studio backend is not enabled" tell the user what to do, while a
    // bare "<action> failed" told them only to guess.
    toast(what + ' failed — ' + e.message, 'err');
    log(what + ' failed: ' + e.message, 'err');
    // A 401 means the token was dropped; re-probing puts the sign-in form back.
    if (e.status === 401) await refreshCloud();
  }
}

/** Push the current session to the server, creating or updating. */
let _saving = false;
export async function saveToServer() {
  // One save at a time: a double-click on CREATE used to race two creates and
  // land two identical projects on the server.
  if (_saving) { toast('Already saving…'); return; }
  _saving = true;
  try {
    const doc = readProject();
    const name = ($('cloud-name')?.value || '').trim() || doc?.meta?.name || 'Untitled';
    // Saving a link-opened project makes a copy of your own rather than trying
    // to write back to someone else's.
    if (_sharedName) _sharedName = null;
    if (_openId) {
      await API.saveProject(_openId, doc, { name });
      toast('Saved to server');
      log('Saved project ' + _openId + ' to the server.', 'ok');
    } else {
      const r = await API.createProject(name, doc);
      _openId = r.project?.id ?? null;
      toast('Created on server');
      log('Created server project ' + _openId + '.', 'ok');
    }
  } finally {
    _saving = false;
  }
  await refreshCloud();
}

/**
 * Open a project from a #share= link.
 *
 * Read-only: `_openId` is deliberately NOT set, so "save" cannot silently try
 * to write back to a project the reader has no permission to change. The
 * server would refuse anyway; not offering it is better than a refusal.
 */
export async function openSharedLink(token) {
  const r = await API.getShared(token);
  if (!r.project?.document) throw new API.ApiError('That link has no project on it', 404);
  applyProject(r.project.document);
  _openId = null;
  _sharedName = r.project.name || 'shared project';
  if ($('cloud-name')) $('cloud-name').value = _sharedName;   /* dom-only: CLOUD panel, not a document-bound control */
  toast('Opened shared project (read-only)');
  log('Opened "' + _sharedName + '" from a share link — read-only.', 'ok');
  renderCloud();
}

/**
 * Is this page load an arrival through a share link?
 *
 * Asked SYNCHRONOUSLY at boot, before anything clears the fragment, because two
 * async restores race for the same document: the autosaved session out of
 * IndexedDB, and the shared project off the network. Whichever finished last
 * won, so a share link opened in a browser that had used the studio before
 * showed either project depending on disk speed. A reader following a link
 * wants the link.
 */
export function hasShareFragment() {
  return /[#&]share=[a-f0-9]{64}\b/.test(location.hash || '');
}

/** Handle a #share=<token> fragment, if there is one. Returns true if it acted. */
export async function consumeShareFragment() {
  const m = /[#&]share=([a-f0-9]{64})\b/.exec(location.hash || '');
  if (!m) return false;
  // Clear the fragment so a reload does not silently re-open the link over
  // whatever the reader has since done, and so the token stops sitting in the
  // address bar where it gets copied and pasted by accident.
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
  try {
    await openSharedLink(m[1]);
  } catch (e) {
    /* A TRANSIENT failure (backend restarting, wifi blip) must not SPEND the
       link: put the fragment back so a plain reload retries it.
       A token the server has REFUSED is different, and treating the two the same
       was doing real harm. boot() decides whether to install the autosave writer
       from `hasShareFragment()`, so a restored fragment meant "a reader is
       viewing someone else's project" on every subsequent load — and a revoked
       token, which can never succeed, therefore disabled autosave and session
       restore for that URL permanently. There is nothing to retry on a 403/404:
       the fragment is spent and the visit is an ordinary one. */
    const permanent = e && (e.status === 403 || e.status === 404 || e.status === 410);
    if (!permanent) {
      try { history.replaceState(null, '', location.pathname + location.search + '#share=' + m[1]); } catch { /* ignore */ }
    }
    toast('Could not open the share link — ' + e.message, 'err');
    if (_onShareFailed) _onShareFailed({ permanent });
    throw e;
  }
  return true;
}

/* What boot() wants to know: the link did not open, so this is an ordinary
   visit after all and the reader's own work must start being saved. Registered
   rather than imported so cloud.js keeps knowing nothing about persistence. */
let _onShareFailed = null;
export function onShareFailed(fn) { _onShareFailed = typeof fn === 'function' ? fn : null; }

export async function openFromServer(id) {
  const r = await API.getProject(id);
  if (!r.project?.document) throw new API.ApiError('That project has no document', 500);
  applyProject(r.project.document);
  _openId = r.project.id;
  if ($('cloud-name')) $('cloud-name').value = r.project.name || '';   /* dom-only: CLOUD panel, not a document-bound control */
  toast('Opened ' + (r.project.name || 'project'));
  log('Opened server project "' + (r.project.name || '') + '" (' + r.project.access + ').', 'ok');
  renderCloud();
}

/**
 * Upload every library asset that is not already on the server.
 *
 * Dedupe is by content, so re-running this after generating one new clip
 * uploads exactly that clip.
 */
export async function uploadLibrary() {
  const items = library.filter((it) => it.blob
    && (it.kind === 'videos' || it.kind === 'music' || it.kind === 'image'));
  if (!items.length) { toast('No assets to upload'); return; }

  const status = $('cloud-upload-status');
  let done = 0, skipped = 0;
  const failed = [];
  for (const it of items) {
    // Library folders are plural; server kinds are singular.
    const kind = it.kind === 'videos' ? 'video' : it.kind === 'music' ? 'audio' : 'image';
    try {
      const r = await API.uploadAsset(it.blob, {
        name: it.name + '.' + it.ext,
        kind,
        projectId: _openId || undefined,
        onProgress: (p) => {
          if (status) {
            status.textContent = 'Uploading ' + it.name + '.' + it.ext
              + ' — ' + Math.round(p * 100) + '% (' + (done + failed.length + 1) + '/' + items.length + ')';
          }
        },
      });
      if (r.skipped) skipped++;
      done++;
    } catch (e) {
      // One item failing costs one item, same rule as batch export. Uploads are
      // resumable, so retrying later continues this item where it stopped —
      // unless the session itself died, which ends the whole run.
      failed.push(it.name + '.' + it.ext);
      log('Upload failed for ' + it.name + '.' + it.ext + ': ' + e.message, 'err');
      if (e.status === 401) throw e;
    }
  }
  if (status) {
    status.textContent = 'Uploaded ' + (done - skipped) + ' asset' + (done - skipped === 1 ? '' : 's')
      + (skipped ? ' · ' + skipped + ' already on the server' : '')
      + (failed.length ? ' · ' + failed.length + ' failed — see the log; UPLOAD again to retry' : '');
  }
  if (failed.length) {
    toast(failed.length + ' upload' + (failed.length === 1 ? '' : 's') + ' failed', 'err');
  } else {
    toast('Library uploaded');
  }
  log('Uploaded ' + (done - skipped) + ' new asset(s); ' + skipped + ' already present'
    + (failed.length ? '; failed: ' + failed.join(', ') : '') + '.', failed.length ? 'err' : 'ok');
  await refreshCloud();
}

/**
 * Load the versions and shares for one project.
 *
 * Shares are owner-only on the server, so a 403 here is the expected answer
 * for an editor rather than a failure worth reporting.
 */
export async function loadDetail(id) {
  _detailId = id;
  try { _versions = (await API.listVersions(id)).versions || []; }
  catch (e) { _versions = []; log('Could not list versions: ' + e.message, 'err'); }
  const project = _projects.find((p) => String(p.id) === String(id));
  if (project && project.access === 'owner') {
    try { _shares = (await API.listShares(id)).shares || []; }
    catch (e) { _shares = []; log('Could not list shares: ' + e.message, 'err'); }
  } else {
    _shares = [];
  }
  renderCloud();
}

/** Show the one-time share token where it can actually be copied. */
function showToken(url) {
  const box = $('cloud-share-token');
  if (!box) return;
  box.replaceChildren();
  const d = document.createElement('div');
  d.className = 'token-box';
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = 'Share link — copy it now. The server never shows it again.';
  const input = document.createElement('input');
  input.type = 'text';
  input.readOnly = true;
  input.value = url;   /* dom-only: CLOUD panel, not a document-bound control */
  input.setAttribute('aria-label', 'Share link');
  const btn = document.createElement('button');
  btn.className = 'btn small';
  btn.textContent = '⧉ COPY';
  btn.addEventListener('click', () => {
    input.select();
    // navigator.clipboard only exists in secure contexts — on a plain-http
    // install the optional chain yielded undefined and `.then` on it THREW,
    // so the button did nothing at all. execCommand is deprecated but it is
    // exactly the fallback this case still needs; the field is already
    // selected either way, so the worst case is "press Ctrl+C yourself".
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => toast('Link copied'), () => toast('Clipboard blocked — select and copy', 'err'));
    } else if (document.execCommand && document.execCommand('copy')) {
      toast('Link copied');
    } else {
      toast('Clipboard unavailable here — the link is selected, press Ctrl+C', 'err');
    }
  });
  d.append(p, input, btn);
  box.appendChild(d);
  // Selected on show, so keyboard users can copy without hunting for the field.
  input.focus(); input.select();
}

async function addShare() {
  const id = _detailId;
  if (!id) return;
  const who = ($('cloud-share-user')?.value || '').trim();
  const role = $('cloud-share-role')?.value || 'viewer';
  const days = parseInt($('cloud-share-days')?.value || '', 10);

  if (who) {
    await API.shareWithUser(id, who, role);
    toast('Shared with ' + who);
    log('Shared project ' + id + ' with ' + who + ' as ' + role + '.', 'ok');
    if ($('cloud-share-user')) $('cloud-share-user').value = '';   /* dom-only: CLOUD panel, not a document-bound control */
  } else {
    // The server refuses this too; saying so here avoids a round trip to be
    // told something the form already knew.
    if (role === 'editor') {
      toast('A link cannot grant editor — name a user for that', 'err');
      return;
    }
    const r = await API.createShareLink(id, role, Number.isFinite(days) ? days : undefined);
    const url = location.origin + location.pathname + '#share=' + r.token;
    showToken(url);
    log('Minted a ' + role + ' share link for project ' + id + '.', 'ok');
  }
  await refreshCloud();
}

/** Pull a server asset back into this session's library. */
async function pullAsset(id) {
  const a = _assets.find((x) => String(x.id) === String(id));
  if (!a) return;
  const blob = await API.fetchAsset(id);
  const name = String(a.original_name || 'asset');
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1) : 'bin';
  const base = dot > 0 ? name.slice(0, dot) : name;
  // Server kinds are singular; the library's folders are not.
  const kind = a.kind === 'video' ? 'videos' : a.kind === 'audio' ? 'music' : 'image';
  addToLibrary(blob, ext, kind, base, 0);
  toast(name + ' → library');
}

/* ---- wiring ------------------------------------------------------------ */

export function initCloud() {
  if (!$('cloud-status')) return;

  $('cloud-signin')?.addEventListener('click', () => guard(async () => {
    const user = ($('cloud-user')?.value || '').trim();
    const pass = $('cloud-pass')?.value || '';
    if (!user || !pass) { toast('Enter a display name and password', 'err'); return; }
    const u = await API.signIn(user, pass);
    if ($('cloud-pass')) $('cloud-pass').value = '';   /* dom-only: CLOUD panel, not a document-bound control */
    toast('Signed in as ' + (u?.display_name || user));
    await refreshCloud();
  }, 'Sign in'));

  $('cloud-signout')?.addEventListener('click', () => guard(async () => {
    await API.signOut();
    _openId = null;
    toast('Signed out');
    await refreshCloud();
  }, 'Sign out'));

  $('cloud-save')?.addEventListener('click', () => guard(saveToServer, 'Save'));
  $('cloud-new')?.addEventListener('click', () => { _openId = null; toast('Next save creates a new project'); renderCloud(); });
  $('cloud-upload')?.addEventListener('click', () => guard(uploadLibrary, 'Upload'));
  // REFRESH re-detects: an install that appeared after the first look (the
  // wizard was run in another tab) is found without reloading the studio.
  $('cloud-refresh')?.addEventListener('click', () => guard(() => refreshCloud({ force: true }), 'Refresh'));

  $('cloud-apibase')?.addEventListener('change', () => {
    // Blank means "work it out again" rather than "use the empty string".
    API.setApiBase($('cloud-apibase').value);
    guard(() => refreshCloud({ force: true }), 'Refresh');
  });

  $('cloud-projects')?.addEventListener('click', (e) => {
    const open = e.target.closest('button[data-open]');
    const detail = e.target.closest('button[data-detail]');
    const del = e.target.closest('button[data-del]');
    if (open) guard(() => openFromServer(open.dataset.open), 'Open');
    else if (detail) guard(() => loadDetail(detail.dataset.detail), 'Load details');
    else if (del) {
      if (!confirm('Delete this project from the server? This cannot be undone.')) return;
      guard(async () => {
        await API.deleteProject(del.dataset.del);
        if (String(_openId) === String(del.dataset.del)) _openId = null;
        if (String(_detailId) === String(del.dataset.del)) _detailId = null;
        toast('Deleted');
        await refreshCloud();
      }, 'Delete');
    }
  });

  $('cloud-versions')?.addEventListener('click', (e) => {
    const r = e.target.closest('button[data-restore]');
    if (!r) return;
    // The detail pane can be showing a DIFFERENT project than the one open in
    // the editor. A restore replaces the editor's document, so the session has
    // to re-bind to the restored project too — otherwise the next SAVE writes
    // project B's content into project A, which is the quiet kind of data loss
    // nobody traces back to a click a week earlier.
    const target = _projects.find((p) => String(p.id) === String(_detailId));
    const name = target ? target.name : 'this project';
    if (!confirm('Restore this version of "' + name + '"? It replaces what is in the editor and '
      + 'becomes the open project. The replaced server copy is snapshotted first.')) return;
    guard(async () => {
      const res = await API.restoreVersion(r.dataset.restore);
      if (res.project?.document) {
        applyProject(res.project.document);
        _openId = res.project.id ?? _detailId;
        _sharedName = null;
        if ($('cloud-name')) $('cloud-name').value = res.project.name || name;   /* dom-only: CLOUD panel, not a document-bound control */
      }
      toast('Version restored');
      log('Restored version ' + r.dataset.restore + ' — the editor is now on "' + name + '".', 'ok');
      await refreshCloud();
    }, 'Restore');
  });

  $('cloud-snapshot')?.addEventListener('click', () => guard(async () => {
    if (!_detailId) { toast('Pick a project first', 'err'); return; }
    const label = ($('cloud-snap-label')?.value || '').trim();
    await API.createVersion(_detailId, label || undefined);
    if ($('cloud-snap-label')) $('cloud-snap-label').value = '';   /* dom-only: CLOUD panel, not a document-bound control */
    toast('Snapshot saved');
    await loadDetail(_detailId);
  }, 'Snapshot'));

  $('cloud-share-add')?.addEventListener('click', () => guard(addShare, 'Share'));

  $('cloud-shares')?.addEventListener('click', (e) => {
    const r = e.target.closest('button[data-revoke]');
    if (!r) return;
    guard(async () => {
      await API.revokeShare(r.dataset.revoke);
      toast('Access revoked');
      log('Revoked share ' + r.dataset.revoke + '.', 'ok');
      await loadDetail(_detailId);
    }, 'Revoke');
  });

  $('cloud-assets')?.addEventListener('click', (e) => {
    const get = e.target.closest('button[data-get]');
    const rm = e.target.closest('button[data-rmasset]');
    if (get) guard(() => pullAsset(get.dataset.get), 'Download');
    else if (rm) {
      if (!confirm('Delete this asset from the server?')) return;
      guard(async () => {
        await API.deleteServerAsset(rm.dataset.rmasset);
        toast('Asset deleted');
        await refreshCloud();
      }, 'Delete asset');
    }
  });

  if ($('cloud-apibase')) $('cloud-apibase').value = API.apiBase();   /* dom-only: CLOUD panel, not a document-bound control */
  renderCloud();
  // Probe in the background: a missing backend must not delay boot.
  // A #share= link is the one thing that must act before anything else: it is
  // how a reader arrives, and it replaces the document.
  consumeShareFragment().catch((e) => log('Share link failed: ' + e.message, 'err'));
  refreshCloud().catch(() => { _state = { checked: true, reachable: false, reason: 'probe failed' }; renderCloud(); });
}
