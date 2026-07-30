/* Dead Signal Studio — ui/presetman.js
 *
 * Managing your own presets.
 *
 * ✚ PRESET saved one and that was the end of it: there was no way to rename a
 * preset, delete one, duplicate it as a starting point, or move it to another
 * machine. deleteUserPreset() had in fact been written and had no caller at
 * all, so a typo in a preset name was permanent.
 *
 * A management surface is not something to give permanent panel space to, so it
 * opens as an overlay from the ⚙ beside each picker — the same shape the
 * library preview already uses.
 */
import { $, escHtml, log, setVal, toast } from '../core/dom.js';
import { download } from '../core/blobs.js';
import { PKEY, lsSet, userPresets } from '../core/recipes.js';
import { rebuildPresetSelect } from '../presets/index.js';

const TAB_LABEL = { video: 'VIDEO', audio: 'AUDIO', image: 'SCREEN' };
const SELECT_ID = { video: 'v-preset', audio: 'a-preset', image: 'i-preset' };

let _open = null;

/** Replace the whole map for a tab. */
function write(tab, map) {
  if (!lsSet(PKEY(tab), map)) return false;
  rebuildPresetSelect(tab);
  return true;
}

export function renamePreset(tab, from, to) {
  const all = userPresets(tab);
  const name = String(to || '').trim();
  if (!(from in all)) return false;
  if (!name) { toast('Name it something', 'err'); return false; }
  if (name !== from && name in all) { toast(`"${name}" already exists`, 'err'); return false; }
  if (name === from) return true;
  const out = {};
  // Rebuilt in order so renaming does not send the entry to the end of the list.
  for (const k of Object.keys(all)) out[k === from ? name : k] = all[k];
  /* Carry the PICKER to the new name. rebuildPresetSelect now falls back to
     "— custom —" rather than blanking itself when the selected option has gone,
     which is right for a delete and wrong for a rename: the same look is still
     loaded, it just answers to something else now. */
  const sel = $(SELECT_ID[tab]);
  const wasSelected = sel && sel.value === `user:${from}`;
  const ok = write(tab, out);
  if (ok && wasSelected && sel) {
    sel.value = `user:${name}`;   /* dom-only: dispatching would re-run loadPreset on a look already loaded */
  }
  return ok;
}

export function duplicatePreset(tab, from) {
  const all = userPresets(tab);
  if (!(from in all)) return false;
  let name = `${from} copy`, n = 2;
  while (name in all) { name = `${from} copy ${n}`; n++; }
  return write(tab, { ...all, [name]: all[from] }) ? name : false;
}

export function removePreset(tab, name) {
  const all = userPresets(tab);
  if (!(name in all)) return false;
  delete all[name];
  return write(tab, all);
}

/** Every tab's user presets, as one portable file. */
export function exportPresets() {
  const payload = { kind: 'dead-signal-studio-presets', version: 1, presets: {} };
  for (const tab of Object.keys(TAB_LABEL)) payload.presets[tab] = userPresets(tab);
  const total = Object.values(payload.presets).reduce((n, m) => n + Object.keys(m).length, 0);
  if (!total) { toast('No saved presets to export'); return 0; }
  download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
           'dead-signal-presets.json');
  toast(`Exported ${total} preset${total === 1 ? '' : 's'}`);
  return total;
}

/**
 * Merge an exported file back in. Merging rather than replacing, and renaming
 * on collision rather than overwriting: an import that silently ate a preset
 * with the same name would be the one mistake this feature must not make.
 */
export function importPresets(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('not valid JSON'); }
  if (!data || typeof data !== 'object' || !data.presets || typeof data.presets !== 'object') {
    throw new Error('not a preset file');
  }
  let added = 0, renamed = 0;
  for (const tab of Object.keys(TAB_LABEL)) {
    const incoming = data.presets[tab];
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) continue;
    const all = userPresets(tab);
    for (const [rawName, rec] of Object.entries(incoming)) {
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
      let name = String(rawName).slice(0, 60).trim();
      if (!name) continue;
      if (name in all) {
        let n = 2;
        while (`${name} (${n})` in all) n++;
        name = `${name} (${n})`;
        renamed++;
      }
      all[name] = rec;
      added++;
    }
    write(tab, all);
  }
  if (!added) throw new Error('no presets in that file');
  return { added, renamed };
}

/* ------------------------------------------------------------- the overlay */

/* Where focus was when the dialog opened, so it can be put back. Removing the
   overlay while something inside it has focus leaves focus on <body>, and the
   author's next Tab starts again from the top of the page rather than from the
   ⚙ they just pressed. Same contract the command palette already keeps. */
let _lastFocus = null;

function close() {
  if (!_open) return;
  document.removeEventListener('keydown', onKey);
  _open.remove();
  _open = null;
  if (_lastFocus && document.contains(_lastFocus)) {
    try { _lastFocus.focus({ preventScroll: true }); } catch { _lastFocus.focus(); }
  }
  _lastFocus = null;
}
const onKey = (e) => { if (e.key === 'Escape') close(); };

function body(tab, box) {
  box.replaceChildren();
  const all = userPresets(tab);
  const names = Object.keys(all);

  if (!names.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = `No saved ${TAB_LABEL[tab]} presets yet. The ✚ button beside the preview `
      + 'saves the whole tab as one, and it will appear here.';
    box.appendChild(p);
  } else {
    const table = document.createElement('table');
    table.className = 'lib';
    table.innerHTML = '<thead><tr><th scope="col">Name</th><th scope="col">Settings</th>'
      + '<th scope="col"><span class="sr-only">Actions</span></th></tr></thead>';
    const tb = document.createElement('tbody');
    for (const name of names) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><input type="text" value="' + escHtml(name) + '" data-was="' + escHtml(name) + '"'
        + ' aria-label="Preset name" style="width:170px"></td>'
        + '<td>' + Object.keys(all[name] || {}).length + '</td>'
        + '<td><button class="btn small" data-load="' + escHtml(name) + '">LOAD</button> '
        + '<button class="btn small" data-dup="' + escHtml(name) + '">⧉</button> '
        + '<button class="btn small" data-del="' + escHtml(name) + '">✕</button></td>';
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    box.appendChild(table);
  }

  const foot = document.createElement('div');
  foot.className = 'btns';
  foot.innerHTML = '<button class="btn small" data-act="export">⤓ EXPORT ALL</button>'
    + '<button class="btn small" data-act="import">⇪ IMPORT</button>'
    + '<input type="file" data-act="importfile" accept=".json,application/json" style="display:none" aria-label="Import presets">';
  box.appendChild(foot);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'Export writes every tab\'s presets to one file. Import merges — a name that '
    + 'already exists is brought in beside the original rather than over it.';
  box.appendChild(hint);
}

export function openPresetManager(tab) {
  close();
  const opener = document.activeElement;
  const ov = document.createElement('div');
  ov.className = 'preview-overlay';
  const boxEl = document.createElement('div');
  boxEl.className = 'pv-box preset-manager';
  boxEl.setAttribute('role', 'dialog');
  boxEl.setAttribute('aria-modal', 'true');
  boxEl.setAttribute('aria-label', `Manage ${TAB_LABEL[tab]} presets`);

  const h = document.createElement('h2');
  h.textContent = `MY ${TAB_LABEL[tab]} PRESETS`;
  const list = document.createElement('div');
  const bar = document.createElement('div');
  bar.className = 'pv-bar';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn small';
  closeBtn.textContent = '✕ close';
  closeBtn.addEventListener('click', close);
  bar.appendChild(closeBtn);
  boxEl.append(h, list, bar);
  ov.appendChild(boxEl);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  document.body.appendChild(ov);
  document.addEventListener('keydown', onKey);
  _open = ov;
  _lastFocus = opener && opener !== document.body ? opener : null;

  const redraw = () => body(tab, list);
  redraw();

  /* Focus goes INTO the dialog. It declares aria-modal="true", and without this
     the author's next Tab walks the page behind it — the controls a screen
     reader has just been told are unavailable. Close is the safe landing:
     nothing here is destructive to press by accident, and the list below it is
     one Shift+Tab away. */
  try { closeBtn.focus({ preventScroll: true }); } catch { closeBtn.focus(); }

  list.addEventListener('change', (e) => {
    const nameField = e.target.closest('input[data-was]');
    if (nameField) {
      if (renamePreset(tab, nameField.dataset.was, nameField.value)) {
        log(`Renamed preset [${tab}] ${nameField.dataset.was} → ${nameField.value}`, 'ok');
        toast('Renamed');
      }
      redraw();
      return;
    }
    const file = e.target.closest('input[data-act="importfile"]');
    if (file) {
      const f = file.files && file.files[0];
      file.value = '';   /* dom-only: file input, so re-picking the same file re-fires */
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const { added, renamed } = importPresets(String(r.result || ''));
          toast(`Imported ${added} preset${added === 1 ? '' : 's'}`);
          log(`Imported ${added} preset(s)${renamed ? `, ${renamed} renamed to avoid a collision` : ''}.`, 'ok');
          redraw();
        } catch (err) {
          toast('Not a preset file', 'err');
          log('Preset import rejected: ' + err.message, 'err');
        }
      };
      r.readAsText(f);
    }
  });

  list.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.del) {
      if (!confirm(`Delete the preset "${b.dataset.del}"?`)) return;
      removePreset(tab, b.dataset.del);
      log(`Deleted preset [${tab}] ${b.dataset.del}`, 'info');
      toast('Deleted');
      redraw();
    } else if (b.dataset.dup) {
      const name = duplicatePreset(tab, b.dataset.dup);
      if (name) { toast(`Duplicated as "${name}"`); redraw(); }
    } else if (b.dataset.load) {
      // Loading goes through the picker so it takes the ordinary path —
      // scoped by locks, one undo entry, preview refreshed.
      setVal(SELECT_ID[tab], 'user:' + b.dataset.load);
      close();
    } else if (b.dataset.act === 'export') {
      exportPresets();
    } else if (b.dataset.act === 'import') {
      list.querySelector('input[data-act="importfile"]')?.click();
    }
  });
}

export function initPresetManager() {
  for (const [tab, id] of Object.entries({ video: 'v-preset-manage', audio: 'a-preset-manage', image: 'i-preset-manage' })) {
    $(id)?.addEventListener('click', () => openPresetManager(tab));
  }
}
