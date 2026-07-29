/* Dead Signal Studio — ui/campaignfiles.js
 *
 * The CAMPAIGN FILES panel on the BUNDLE tab: import what the campaign already
 * has, so the bundle can emit a complete merged result rather than a fragment.
 *
 * Every import is parsed and reported. A file that does not parse is refused
 * with the reason — silently ignoring it would produce a bundle that quietly
 * drops the campaign's existing media, which is the worst outcome available.
 */
import { $, escHtml, log, toast } from '../core/dom.js';
import { clearExisting, existingSummary, setExistingPart, setReleasedFrom } from '../campaign/existing.js';
import { parseIndex, parseManifest, releasedFiles } from '../library/merge.js';

let _onChange = null;

const readText = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ''));
  r.onerror = () => reject(new Error('could not read the file'));
  r.readAsText(file);
});

/** What each picker accepts, and what to do with it once parsed. */
const IMPORTS = {
  'cf-manifest': {
    label: 'media-manifest.json',
    apply: (text) => {
      const m = parseManifest(text);
      setExistingPart('manifest', m);
      return `${m.music.length} music + ${m.videos.length} video entries`;
    },
  },
  'cf-vindex': {
    label: 'assets/videos/index.json',
    apply: (text) => {
      const a = parseIndex(text);
      setExistingPart('videosIndex', a);
      return `${a.length} video entries`;
    },
  },
  'cf-mindex': {
    label: 'assets/music/index.json',
    apply: (text) => {
      const a = parseIndex(text);
      setExistingPart('musicIndex', a);
      return `${a.length} music entries`;
    },
  },
  'cf-autoexec': {
    label: 'autoexec.retro',
    apply: (text) => {
      const n = releasedFiles(text).size;
      setReleasedFrom(text);
      // The script itself is not stored — only the filenames it releases.
      return `${n} clip${n === 1 ? '' : 's'} already released`;
    },
  },
};

export function renderCampaignFiles() {
  const box = $('cf-summary');
  if (!box) return;
  const s = existingSummary();
  box.replaceChildren();

  const p = document.createElement('p');
  if (!s) {
    p.className = 'hint';
    p.textContent = 'Nothing imported — the bundle will describe only the assets in this library, '
      + 'and you would have to merge it into the campaign by hand.';
    box.appendChild(p);
    return;
  }
  p.className = 'banner';
  p.style.borderColor = 'var(--phos-dim)';
  p.style.color = 'var(--phos)';
  p.textContent = `✔ Merging into ${s.files} existing file${s.files === 1 ? '' : 's'}`
    + ` · manifest ${s.manifest} · videos/index ${s.videosIndex} · music/index ${s.musicIndex}`
    + ` · ${s.released} already released`;
  box.appendChild(p);

  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = 'The bundle now contains the complete merged files, so installing it is a '
    + 'straight overwrite rather than a hand-merge.';
  box.appendChild(note);
}

export function initCampaignFiles(onChange) {
  if (!$('cf-summary')) return;
  _onChange = onChange;
  renderCampaignFiles();

  for (const [id, spec] of Object.entries(IMPORTS)) {
    const input = $(id);
    const btn = $(id + '-btn');
    if (!input || !btn) continue;
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      input.value = '';   /* dom-only: file input, not a document control */  // re-importing the same file must re-fire
      if (!file) return;
      try {
        const text = await readText(file);
        const detail = spec.apply(text);
        renderCampaignFiles();
        _onChange?.();
        toast(`${spec.label} imported`);
        log(`Imported ${spec.label}: ${detail}`, 'ok');
      } catch (err) {
        // Say what was wrong with it. "Import failed" tells an author nothing.
        toast(`${spec.label} could not be read`, 'err');
        log(`${spec.label} rejected: ${err.message}`, 'err');
      }
    });
  }

  $('cf-clear')?.addEventListener('click', () => {
    if (!existingSummary()) { toast('Nothing imported'); return; }
    clearExisting();
    renderCampaignFiles();
    _onChange?.();
    toast('Campaign files cleared');
  });
}
