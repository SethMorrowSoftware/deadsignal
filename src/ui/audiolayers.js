/* Dead Signal Studio — ui/audiolayers.js
 *
 * Builds the controls for every registry layer in audio/layers.js.
 *
 * These are generated rather than written into index.html because the whole
 * point of the registry is that a layer is ONE entry. Markup written by hand is
 * a second place to edit and a second place to forget, which is exactly how the
 * tab ended up with ten layers.
 *
 * Generation must happen BEFORE boot seeds the document from the DOM and before
 * the reset snapshot is taken — every control's `value` attribute is its
 * default, and both of those read the DOM once. The call site in boot.js is
 * placed accordingly and says so.
 *
 * The generated fieldsets are ordinary fieldsets with an ordinary checkbox, so
 * everything that already walks the audio tab — the active-layer summary, TIDY,
 * the collapse/reset legend, the document binding, preset recipes — picks them
 * up with no changes at all.
 */
import { escHtml } from '../core/dom.js';
import { AUDIO_LAYERS, CTRL, TOGGLE } from '../audio/layers.js';
import { AUDIO_FX } from '../audio/fx.js';

/** Where the generated layers are inserted. */
export const MOUNT_ID = 'a-extra-layers';

function controlFor(layer, spec) {
  const id = CTRL(layer.id, spec.key);
  const label = `<label for="${escHtml(id)}">${escHtml(spec.label)}</label>`;
  if (spec.kind === 'text') {
    return `<div class="row">${label}<input type="text" id="${escHtml(id)}" value="${escHtml(String(spec.def ?? ''))}"></div>`;
  }
  if (spec.kind === 'pct') {
    return `<div class="row">${label}<input type="range" id="${escHtml(id)}" min="0" max="100" value="${Number(spec.def)}" class="grow"></div>`;
  }
  if (spec.kind === 'range') {
    // A step fine enough to reach the values in between: an integer step on a
    // 0.1–8 range would give the author three usable positions.
    const step = (spec.max - spec.min) <= 20 ? 0.1 : 1;
    return `<div class="row">${label}<input type="range" id="${escHtml(id)}" min="${spec.min}" max="${spec.max}" step="${step}" value="${Number(spec.def)}" class="grow"></div>`;
  }
  return `<div class="row">${label}<input type="number" id="${escHtml(id)}" value="${Number(spec.def)}" min="${spec.min}" max="${spec.max}"></div>`;
}

function fieldsetFor(layer) {
  const toggle = TOGGLE(layer.id);
  // Two or three to a row, matching the hand-written layers above them; more
  // than three and the labels stop fitting at the panel's width.
  const cls = layer.params.length >= 3 ? 'split3' : 'split2';
  /* Generated fieldsets carry their section like the hand-written ones do, or
     they would be the only controls in the panel that no group ever hides —
     visible under every section, which is the scroll this was meant to end. */
  return `<fieldset data-section="${escHtml(layer.section || 'Events')}"><legend>${escHtml(layer.name)}</legend>`
    + `<div class="row"><input type="checkbox" id="${escHtml(toggle)}"> <label for="${escHtml(toggle)}">enable</label></div>`
    + `<div class="${cls}">${layer.params.map((s) => controlFor(layer, s)).join('')}</div>`
    + `<div class="row"><label for="${escHtml(CTRL(layer.id, 'pan'))}">Pan</label>`
    + `<input type="range" id="${escHtml(CTRL(layer.id, 'pan'))}" min="-100" max="100" value="0" class="grow"></div>`
    + `</fieldset>`;
}

/**
 * Generate the layer controls into their mount point.
 *
 * Idempotent: calling it twice replaces rather than duplicates, so a re-render
 * cannot leave two checkboxes fighting over one id.
 */
export function buildAudioLayerControls() {
  const mount = document.getElementById(MOUNT_ID);
  if (!mount) return 0;
  mount.innerHTML = AUDIO_LAYERS.map(fieldsetFor).join('');
  return AUDIO_LAYERS.length;
}

/**
 * Parameter-panel hints for every generated control, in the shape ui/params.js
 * uses. Derived from the registry so a layer's documentation lives beside the
 * layer rather than in a second table that drifts.
 */
export function layerParamHints() {
  const out = {};
  for (const layer of AUDIO_LAYERS) {
    out[TOGGLE(layer.id)] = [layer.name.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()), 2, layer.hint];
    for (const spec of layer.params) {
      out[CTRL(layer.id, spec.key)] = [spec.label, 2,
        spec.hint || `${spec.label} for ${layer.name.toLowerCase()}.`];
    }
    out[CTRL(layer.id, 'pan')] = [`${layer.name} pan`, 2,
      'Where this layer sits between the speakers. Centre is 0; the extremes are hard left and hard right.', 'L/R'];
  }
  /* The FX chain's own three controls. The per-step parameters inside the list
     are panel-local and live in a [data-generated] container, which the
     explain-coverage gate skips for the same reason it skips the video chain's:
     their ids are positional (`a-fx-step-2-mix`) and cannot be enumerated ahead
     of time, and each carries its label at the point of use. */
  out['a-fx-pick'] = ['FX to add', 2,
    'The effect ＋ FX appends to the end of the chain. '
    + Object.keys(AUDIO_FX).length + ' of them, grouped by what they do to the sound.'];
  out['a-fx-add'] = ['Add FX', 2,
    'Appends the chosen effect to the end of the chain, where it runs after everything above it.'];
  out['a-fx-clear'] = ['Clear FX', 2, 'Removes every effect from the chain. The master bus below is untouched.'];
  return out;
}
