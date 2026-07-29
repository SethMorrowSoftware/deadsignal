/* Dead Signal Studio — ui/importui.js
 *
 * The way files get in, and the way a library row becomes the thing you are
 * working on.
 *
 * Two halves:
 *
 *   IN   — a button, a multi-file picker, and drag-and-drop anywhere over the
 *          studio. Dropping files on a video tool is the gesture everybody
 *          already knows, and it was the one thing this tool did not accept.
 *
 *   OUT  — `useAsset(item)`. The renderer draws imported media from a single
 *          active slot per kind (`_importedVideo`, `_importedImg`), which is
 *          why the library did not previously hold any: there was nowhere for a
 *          second file to go. Loading a row INTO that slot keeps every existing
 *          render path exactly as it is and makes the library the place the
 *          slot is filled from.
 */
import { $, log, setVal, toast } from '../core/dom.js';
import { importFiles } from '../media/importfiles.js';
import { loadImageFile, loadVideoFile } from '../media/import.js';
import { activateTab } from './shell.js';

/* Assembled rather than written out, because the literal string would contain
   the character pair that opens a block comment — and a `/`+`*` inside a string
   is exactly the hazard this project has been bitten by before: any tool that
   strips comments before strings (ours included) starts a comment there and
   swallows the code after it. */
const ACCEPT = ['video', 'audio', 'image'].map((t) => `${t}/` + '*').join(',');

/* The drag payload for an asset moving from the bin to the sequence. A custom
   type so the window-level file-drop handler ignores it: that one only reacts
   to 'Files', and an internal drag carries this instead. */
export const BIN_DRAG_TYPE = 'application/x-deadsignal-asset';

let _input = null;
let _busy = false;

/** The hidden picker, made once. */
function picker() {
  if (_input) return _input;
  _input = document.createElement('input');
  _input.type = 'file';
  _input.id = 'import-files';
  _input.multiple = true;
  _input.accept = ACCEPT;
  _input.hidden = true;
  _input.addEventListener('change', async () => {
    await run(_input.files);
    // Cleared so choosing the same file twice in a row still fires a change.
    _input.value = '';   /* dom-only: resetting a file input, which has no document value */
  });
  document.body.appendChild(_input);
  return _input;
}

/** Open the file picker. */
export function chooseFiles() { picker().click(); }

async function run(files) {
  if (_busy) { toast('Still importing the last lot'); return null; }
  const list = [...(files || [])];
  if (!list.length) return null;
  _busy = true;
  setBusy(true);
  try {
    const report = await importFiles(list, {
      onProgress: ({ index, total, name }) => setBusy(true, `Importing ${index + 1}/${total} — ${name}`),
    });
    if (report.added.length && !report.failed.length) {
      toast(`Imported ${report.added.length} file${report.added.length === 1 ? '' : 's'}`);
    } else if (report.added.length) {
      toast(`Imported ${report.added.length}, refused ${report.failed.length} — see the log`, 'warn');
    } else {
      toast(report.failed[0]?.why || 'Nothing could be imported', 'err');
    }
    return report;
  } finally {
    _busy = false;
    setBusy(false);
  }
}

/** Import these files. Exported so the suites and the palette can drive it. */
export function importDroppedFiles(files) { return run(files); }

function setBusy(on, text) {
  const b = $('nle-import');
  if (b) {
    b.disabled = !!on;
    b.textContent = on ? '…' : '＋';
  }
  const note = $('nle-bin-note');
  if (note) {
    note.textContent = on ? (text || 'Importing…') : '';
    note.hidden = !on;
  }
}

/* --------------------------------------------------------- drag and drop -- */

let _depth = 0;

/**
 * Accept a drop anywhere over the studio.
 *
 * Counted rather than toggled: dragenter/dragleave fire for every child element
 * the pointer crosses, so a boolean flickers the overlay on and off as the file
 * moves across the page. The counter is the standard fix and the only reason
 * this is more than four lines.
 */
export function initDropTarget() {
  const overlay = document.createElement('div');
  overlay.className = 'drop-overlay';
  overlay.id = 'drop-overlay';
  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');
  const card = document.createElement('div');
  card.className = 'drop-card';
  card.textContent = 'Drop footage, stills or sound to add them to your media';
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const show = (on) => { overlay.hidden = !on; };

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    _depth++;
    show(true);
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    // Without this the browser navigates away to the dropped file.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    _depth = Math.max(0, _depth - 1);
    if (!_depth) show(false);
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    _depth = 0;
    show(false);
    void run(e.dataTransfer.files);
  });
}

/* ------------------------------------------------------------ using one -- */

/**
 * Make this library row the active source and take the author to it.
 *
 * A File is rebuilt from the row's blob because the loaders name the import
 * from `file.name` — a bare Blob would arrive called "clip" every time, and the
 * name is what tells you which of three takes you are looking at.
 */
export function useAsset(it) {
  if (!it) return false;
  if (!it.blob) {
    toast('This project was opened without its files, so there is nothing to load', 'err');
    return false;
  }
  const file = new File([it.blob], `${it.name}.${it.ext}`, { type: it.blob.type || '' });
  if (it.kind === 'videos') {
    /* Both: the picker is what a CLIP captures, so the next ＋ SCENE is bound
       to this file specifically; the slot is what the live tab draws before any
       clip exists, and what every clip captured before per-clip footage still
       draws from. */
    setVal('v-srckey', `lib:${it.key}`);
    loadVideoFile(file, () => {
      setVal('v-scene', 'videoin');
      activateTab('video');
      log(`Using ${it.name}.${it.ext} as the video source`, 'ok');
    });
    return true;
  }
  if (it.kind === 'image') {
    loadImageFile(file, () => {
      setVal('i-tpl', 'import');
      activateTab('image');
      log(`Using ${it.name}.${it.ext} as the screen image`, 'ok');
    });
    return true;
  }
  /* Sound is already addressable by every picker that offers a bed — the
     sequence bed, a clip's own, and the audio lane — so "use" means point the
     lane at it, which is the one that places a sound rather than laying it
     under everything. */
  setVal('tl-asrc', `lib:${it.key}`);
  activateTab('timeline');
  toast(`${it.name}.${it.ext} ready — press ＋ SOUND to place it`);
  return true;
}
