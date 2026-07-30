/* Dead Signal Studio — ui/batch.js
 *
 * The BATCH panel, on the LIBRARY tab because that is where the output lands.
 *
 * Deliberately blunt: pick what to export, see how many that is BEFORE
 * committing, press the button, watch a count. A batch is a minutes-long
 * operation and the two things an author needs from it are an honest estimate
 * up front and a way to stop.
 */
import { $, escHtml, log, toast } from '../core/dom.js';
import { BATCH_SOURCES, runBatch } from '../export/batch.js';
import { CONTAINERS } from '../export/encoder.js';
import { claimExport, releaseExport, startVideoPreview, stopVideoPreview } from '../video/capture.js';

let running = false;

/** Refresh the counts. They change as the author builds a sequence or saves presets. */
export function renderBatch() {
  const sel = $('bx-source');
  if (!sel) return;
  const keep = sel.value;
  sel.replaceChildren();
  for (const s of BATCH_SOURCES) {
    const n = s.count();
    const o = document.createElement('option');
    o.value = s.id;
    // The count is in the label rather than beside it: an author choosing
    // "every timeline clip" wants to know it is 3 and not 30 at the moment they
    // choose, not after.
    o.textContent = `${s.label} (${n})`;
    o.disabled = n === 0;
    sel.appendChild(o);
  }
  if (keep) sel.value = keep;                /* dom-only: panel-local */
  if (!sel.value) sel.selectedIndex = [...sel.options].findIndex((o) => !o.disabled);
  showHint();
}

function showHint() {
  const sel = $('bx-source'), out = $('bx-hint');
  if (!sel || !out) return;
  const s = BATCH_SOURCES.find((x) => x.id === sel.value);
  out.textContent = s ? s.hint : 'Nothing to batch yet — build a sequence, or save some presets.';
}

function setBusy(on, text) {
  running = on;
  const go = $('bx-run'), stop = $('bx-stop');
  if (go) go.disabled = on;
  if (stop) stop.disabled = !on;
  const wrap = $('bx-progress-wrap');
  if (wrap) wrap.style.display = on ? 'block' : 'none';
  if ($('bx-status')) $('bx-status').textContent = text || '';
}

export function initBatch() {
  const sel = $('bx-source');
  if (!sel) return;

  const fmt = $('bx-container');
  if (fmt) {
    fmt.replaceChildren();
    for (const c of CONTAINERS) {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.label;
      fmt.appendChild(o);
    }
  }
  sel.addEventListener('change', showHint);
  renderBatch();

  $('bx-stop')?.addEventListener('click', () => { running = false; });
  $('bx-run')?.addEventListener('click', async () => {
    if (running) return;
    const source = sel.value;
    const chosen = BATCH_SOURCES.find((s) => s.id === source);
    if (!chosen || chosen.count() === 0) { toast('Nothing to export', 'err'); return; }

    const seconds = Math.max(0, Number($('bx-seconds')?.value) || 0);
    const container = $('bx-container')?.value || 'webm';

    /* THE BATCH TAKES THE SAME TOKEN EVERY OTHER EXPORTER TAKES.
       `running` only stopped a second BATCH. The batch renders through the same
       module-level scratch canvases as every other export path
       (_persistCanvas, _ss, _tlA) and seeks the same shared imported <video>, so
       a batch running beside a clip RECORD or a .gif interleaved two encoders
       over one set of canvases — exactly the corruption claimExport() exists to
       prevent, and the one entry point of the six that never asked for it.
       Stopping the preview is the other half: it draws through _persistCanvas
       too, and a one-frame accumulator shared with a running export puts a ghost
       of the preview into the batch's frames. */
    if (!claimExport('Batch export')) return;
    stopVideoPreview();
    setBusy(true, `Exporting 0 / ${chosen.count()}…`);
    log(`Batch: ${chosen.label} — ${chosen.count()} item(s)`, 'info');

    let res;
    try {
      res = await runBatch(source, {
        seconds, container,
        onProgress: (done, total, label) => {
          const pct = total ? (done / total) * 100 : 0;
          if ($('bx-progress')) $('bx-progress').style.width = pct + '%';
          if ($('bx-status')) {
            $('bx-status').textContent = `Exporting ${done} / ${total}` + (label ? ` — ${label}` : '…');
          }
        },
        // `running` is flipped by the STOP button; the batch checks it between
        // items and the encoder checks it between frames.
        cancelled: () => !running,
      });
    } catch (e) {
      setBusy(false, 'Batch failed: ' + e.message);
      log('Batch failed: ' + e.message, 'err');
      toast('Batch failed', 'err');
      return;
    } finally {
      /* Released here rather than after the summary below: an exception above
         returns, and a token still held after a failed batch greys out the four
         still buttons and refuses every export for the rest of the session. */
      releaseExport();
      startVideoPreview();
    }

    const parts = [`${res.made} exported`];
    if (res.failed.length) parts.push(`${res.failed.length} failed`);
    if (res.cancelled) parts.push('stopped early');
    setBusy(false, parts.join(' · ') + '.');
    toast(`Batch: ${res.made} → library`, res.failed.length ? 'warn' : 'info');
    renderBatch();
  });
}

/** Panel hints, in the shape ui/params.js uses. */
export function batchParamHints() {
  return {
    'bx-source': ['Batch source', 2,
      'What to export in one go: every preset on a tab, or every clip in the sequence. '
      + 'The number beside each is how many files it would make.'],
    'bx-seconds': ['Seconds each', 2,
      'Caps how long each video item runs. A batch is a contact sheet — you are looking for '
      + 'which of these is the one, and three seconds each answers that far quicker than '
      + 'forty-five full-length renders. Set it to 0 to export each at its own full length.', 's'],
    'bx-container': ['File', 2,
      'The container for video items in the batch. Same choice as the VIDEO tab.'],
    'bx-run': ['Export batch', 2,
      'Renders every item and adds it to the library. Your own settings are not touched — '
      + 'a batch renders from recipes, never from the controls.'],
    'bx-stop': ['Stop batch', 2,
      'Stops after the item in progress. Everything already exported stays in the library.'],
  };
}
