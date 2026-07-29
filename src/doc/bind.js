/* Dead Signal Studio — doc/bind.js
 *
 * Makes the document authoritative and the DOM a view of it.
 *
 * Direction of travel matters. A control edit writes a command; the document
 * changes; subscribers react. The DOM is only written back from the document
 * on undo / redo / load — never in response to the user's own keystroke, which
 * would fight the caret in a text field.
 */
import { $ } from '../core/dom.js';
import { Store, set } from './store.js';
import { setSession, pathFor } from './session.js';

/** view element id -> tab name in the document */
export const VIEW_TABS = {
  'view-video': 'video',
  'view-audio': 'audio',
  'view-image': 'image',
  'view-timeline': 'timeline',
  // The BUNDLE tab holds the campaign target (which campaign, which release
  // beats). That is part of a project, not a preference — it has to be saved,
  // undone and restored with everything else.
  'view-bundle': 'bundle',
};

const GLOBAL_IDS = ['seed', 'aesthetic'];

/** Every id-bearing control inside a view. */
/* A file input is NOT document state and must never be bound.
 *
 * The browser reports its value as "C:\\fakepath\\whatever.png" and refuses to let
 * anything set it back — for good reason, or a page could forge an upload. So
 * once an author imported an image, the next project load threw inside
 * renderDocToDom, which aborted the WHOLE restore: the throw travelled up
 * through store.replace() into initPersistence's catch, so onExternalChange
 * never ran and every dynamic panel (keyframes, layers, filters, campaign
 * files) silently stopped refreshing. One forbidden assignment, and the tool
 * looked like it had lost your work.
 *
 * The file itself is not project state anyway — the imported bitmap lives in
 * media/import.js, and the recipe records the SCENE that displays it. */
/* Transport, not settings.
 *
 * The scrubbers report where the playhead IS; they do not configure anything.
 * Binding them made three separate things go wrong. The preview loop writes the
 * playhead every frame, so the document's copy was always stale and
 * renderDocToDom kept shoving that stale number back into the widget. RESET
 * restored the boot value through setVal(), which dispatches `input` — and the
 * scrubber's own handler reads an `input` event as "the author is scrubbing"
 * and pauses playback, so pressing RESET froze the preview at 0.0s. And a
 * saved project carried a playhead position, which is not part of a look.
 *
 * A readout is not state. Keeping these out of the document is the fix at the
 * only place that decides what the document contains. */
/* …and neither is a PICKER. These five say "which one to add next" — they are
   read at the moment a button is pressed and mean nothing before or after it.
   Keeping them in the document was actively harmful, not merely untidy:
   index.html declares them with no <option> children (the lists come from the
   registries at init time, which runs long after startSession seeds the
   document from the markup), so the value recorded as their boot default was
   the empty string. renderDocToDom then wrote that "" back on EVERY document
   notification — including the author's own edits — driving selectedIndex to
   -1 on all of them. Measured: one move of the Scanlines slider blanked all
   seven of these selects, after which ＋ FILTER and ＋ FX were no-ops
   ("Pick one first") and ＋ KEY silently wrote onto whatever
   AUTOMATABLE[0] happens to be. The two headline chain features died on the
   author's first interaction with any control.
   A picker is a question, not an answer. It does not belong in a project file
   for the same reason a scrub position does not. */
const NOT_DOCUMENT = new Set([
  'v-scrub', 'tl-scrub',
  'v-filters-pick', 'a-fx-pick', 'v-auto-param', 'a-region-op', 'i-anno-kind',
]);

export function viewControls(viewId) {
  const root = $(viewId);
  if (!root) return [];
  return Array.from(root.querySelectorAll('input, select, textarea'))
    .filter((e) => e.id && e.type !== 'file' && !NOT_DOCUMENT.has(e.id));
}

export function controlValue(el) {
  return el.type === 'checkbox' ? el.checked : el.value;
}

export function writeControl(el, value) {
  if (value === undefined) return false;
  // Belt and braces: viewControls already excludes these, but a document
  // written by an older build can still carry a file-input key, and throwing
  // here would take the whole restore down with it.
  if (el.type === 'file') return false;
  /* Never blank a <select> by writing a value it has no option for.
     `el.value = "unknown"` sets selectedIndex to -1, which shows an empty box
     and makes every reader of that control fall through to a default it never
     announced. A document can hold such a value for three ordinary reasons: it
     was written by a build whose option list differed, it was seeded before the
     list was filled, or a hand-edited file simply has a typo. In all three the
     honest answer is to leave the control showing something real.
     This is the guard, not the fix — the fix is that pickers are no longer
     document state and the container selects are filled before the document is
     seeded. It is here so that the next ordering mistake is invisible instead
     of breaking two features. */
  if (el.tagName === 'SELECT' && el.options.length) {
    const want = value == null ? '' : String(value);
    if (!Array.from(el.options).some((o) => o.value === want)) return false;
  }
  if (el.type === 'checkbox') {
    const v = !!value;
    if (el.checked === v) return false;
    el.checked = v;
  } else {
    const v = value == null ? '' : String(value);
    if (el.value === v) return false;
    el.value = v;
  }
  return true;
}

/** control id -> tab, built from the live DOM so ids never need listing twice. */
export function buildIndex() {
  const index = new Map();
  for (const [viewId, tab] of Object.entries(VIEW_TABS)) {
    for (const el of viewControls(viewId)) index.set(el.id, tab);
  }
  return index;
}

/**
 * Seed the document from the markup. index.html is the declaration of every
 * control's default, so this reads them once rather than duplicating ~120
 * values in JS. Applied silently: boot state is not an undoable edit.
 */
/* What the markup declared, captured at boot. See withBootDefaults. */
let _boot = null;

export function snapshotDomToDoc(store, index) {
  const boot = { tabs: {}, globals: {} };
  store.silently(() => {
    store.transaction(() => {
      for (const [viewId, tab] of Object.entries(VIEW_TABS)) {
        boot.tabs[tab] = boot.tabs[tab] || {};
        for (const el of viewControls(viewId)) {
          const v = controlValue(el);
          boot.tabs[tab][el.id] = v;
          store.apply(set(`tabs.${tab}.${el.id}`, v));
        }
      }
      for (const id of GLOBAL_IDS) {
        const el = $(id);
        if (!el) continue;
        const raw = controlValue(el);
        const v = id === 'seed' ? (parseInt(raw, 10) || 0) >>> 0 : raw;
        boot.globals[id] = v;
        store.apply(set(id, v));
      }
    }, 'boot defaults');
  });
  _boot = boot;
  store.clearHistory();
}

/** The boot defaults, for tests and for anything that needs to ask. */
export const bootDefaults = () => _boot;

/**
 * Fill in every control the incoming document does not mention.
 *
 * A project is a snapshot of EVERY control by construction — snapshotDomToDoc
 * writes all of them — so a missing key can only mean the loading build has a
 * control the saving build did not. Which is the ordinary case: every release
 * that adds a control makes every project file on disk older than it.
 *
 * Without this, `writeControl` sees `undefined`, declines to write, and the
 * control keeps showing whatever the PREVIOUS project left it at. Load a
 * project from last week with Letterspace sitting at 40% and it renders at 40%
 * — a value that project never specified and cannot express. The look you get
 * then depends on what was on screen before you opened it, which is exactly the
 * reproducibility the tool claims and the one promise it cannot afford to
 * break.
 *
 * Applied to the plain object BEFORE store.replace, so there is one render and
 * one notification rather than a fill-in that arrives after the DOM has already
 * been drawn with the gaps in it.
 */
export function withBootDefaults(doc) {
  if (!_boot || !doc || typeof doc !== 'object') return doc;
  if (!doc.tabs || typeof doc.tabs !== 'object' || Array.isArray(doc.tabs)) doc.tabs = {};
  for (const [tab, vals] of Object.entries(_boot.tabs)) {
    const into = doc.tabs[tab];
    if (!into || typeof into !== 'object' || Array.isArray(into)) doc.tabs[tab] = {};
    for (const id in vals) if (doc.tabs[tab][id] === undefined) doc.tabs[tab][id] = vals[id];
  }
  for (const id in _boot.globals) if (doc[id] === undefined) doc[id] = _boot.globals[id];
  return doc;
}

/**
 * Document -> DOM. Returns how many controls actually changed.
 * @param {string|null} [skipId] control the user is mid-edit in, left alone.
 */
export function renderDocToDom(store, index, skipId = null) {
  let n = 0;
  for (const [viewId, tab] of Object.entries(VIEW_TABS)) {
    for (const el of viewControls(viewId)) {
      if (el.id === skipId) continue;
      const v = store.get(`tabs.${tab}.${el.id}`);
      if (writeControl(el, v)) n++;
    }
  }
  for (const id of GLOBAL_IDS) {
    if (id === skipId) continue;
    const el = $(id);
    if (el && writeControl(el, store.get(id))) n++;
  }
  return n;
}

/**
 * Wire the document to the DOM.
 *
 * @param {Store} store
 * @param {Map<string,string>} index
 * @param {object} [opts]
 * @param {(reason:string)=>void} [opts.onExternalChange] called after the DOM
 *        has been re-rendered from the document (undo / redo / load), so the
 *        app can refresh previews.
 * @returns {() => void} detach
 */
export function bindControls(store, index, opts = {}) {
  const offs = [];
  let editingId = null;

  const onEdit = (e) => {
    const el = e.target;
    if (!el || !el.id) return;
    editingId = el.id;
    const path = pathFor(el.id);
    if (!path) return;
    const raw = controlValue(el);
    const value = el.id === 'seed' ? (parseInt(raw, 10) || 0) >>> 0 : raw;
    // One undo entry per control per gesture: dragging a slider or typing a
    // word collapses, but moving to a different control starts a new entry.
    store.apply(set(path, value, { coalesceKey: el.id, label: `edit ${el.id}` }));
  };

  /* CAPTURE phase, and that is load-bearing.
   *
   * The binding is delegated to the view root, so in the bubble phase it ran
   * AFTER the control's own handler — and several of those handlers write other
   * controls. Choosing a preset was the visible case: the picker's own `change`
   * handler ran first and applied the preset, every setVal() inside it pushed
   * the document back into the DOM, and that re-render reset the picker to the
   * value it had *before* the click. Then the binding finally read the picker
   * and stored that stale value. The result was a picker that snapped back to
   * "— custom —" the instant you chose a preset, and a project that recorded no
   * preset at all — while the preset itself had applied perfectly.
   *
   * Capturing puts the document first: the edit is recorded before any app
   * handler can react to it, which is the order the rest of the app already
   * assumes when it reads val()/num()/chk(). */
  const CAPTURE = true;
  for (const viewId of Object.keys(VIEW_TABS)) {
    const root = $(viewId);
    if (!root) continue;
    root.addEventListener('input', onEdit, CAPTURE);
    root.addEventListener('change', onEdit, CAPTURE);
    offs.push(() => { root.removeEventListener('input', onEdit, CAPTURE); root.removeEventListener('change', onEdit, CAPTURE); });
  }
  for (const id of GLOBAL_IDS) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener('input', onEdit, CAPTURE);
    el.addEventListener('change', onEdit, CAPTURE);
    offs.push(() => { el.removeEventListener('input', onEdit, CAPTURE); el.removeEventListener('change', onEdit, CAPTURE); });
  }

  // Push the document back to the DOM on every change, skipping only the one
  // control the user is currently editing — echoing that would reset the caret
  // mid-word. Skipping the whole update instead (the earlier approach) meant a
  // change that writes OTHER controls — a macro dial moving ten sliders — left
  // those sliders showing stale values, so the settings they claim to drive
  // looked untouched.
  const unsub = store.subscribe('', (_doc, { reason }) => {
    if (reason !== 'apply') editingId = null;
    renderDocToDom(store, index, editingId);
    if (reason !== 'apply') opts.onExternalChange?.(reason);
  });
  offs.push(unsub);

  return () => offs.forEach((f) => f());
}

/** Create the session: document, index, DOM seeding and binding, in order. */
export function startSession(doc, opts = {}) {
  const store = new Store(doc, opts.storeOpts);
  const index = buildIndex();
  setSession(store, index);
  snapshotDomToDoc(store, index);
  const detach = bindControls(store, index, opts);
  return { store, index, detach };
}
