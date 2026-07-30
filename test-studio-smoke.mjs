/* Dead Signal Studio — end-to-end browser smoke test.
 *
 * Drives the real page through its own UI controls only: it never reaches for
 * an internal function or module binding. That is deliberate — it means this
 * suite is invariant under refactoring of studio.js, so it can act as the
 * regression net while the engine is restructured.
 *
 * Covers: every video scene renders non-blank, every screen template renders
 * non-blank, the audio engine renders + meters + encodes, stego round-trips
 * through an export, the library/bundle wiring generates, and the ZIP writer
 * produces a well-formed archive — all with zero uncaught page errors.
 *
 * Requires Playwright + Chromium. Skips cleanly (exit 0) when unavailable so a
 * checkout without browsers does not fail the gate.
 */
import { dirname, resolve, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';

/** zlib stream for a PNG IDAT — Node's deflate is exactly what the format wants. */
const zlibSync = (buf) => deflateSync(buf);

const HERE = dirname(fileURLToPath(import.meta.url));

/* The studio is ES modules now, and browsers refuse to load those over
   file:// (CORS, origin "null"). Serve the folder on an ephemeral port. */
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
               '.json':'application/json', '.svg':'image/svg+xml' };
const server = createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }   // harness noise, not a page fault
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(HERE, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(HERE) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PAGE = `http://127.0.0.1:${server.address().port}/index.html`;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
  catch {
    console.log('Dead Signal Studio smoke: playwright not installed — SKIPPED');
    process.exit(0);
  }
}

const EXEC = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome']
  .find(p => existsSync(p));

let pass = 0, fail = 0;
/* Failures are collected as well as printed, and listed again at the end.
 *
 * This suite was the only one of the ten that printed a count and nothing else.
 * That is fine locally, where the FAIL line is on screen; it is useless in CI,
 * where scripts/ci-gate.sh captures a suite's output and only echoes its tail —
 * so a check that failed early left "175 passed, 1 failed" and no name. It duly
 * happened, on a run whose sibling passed on the same commit, and the flake was
 * undiagnosable from the log. A gate that cannot say what broke is a gate people
 * stop reading. */
const failures = [];
const check = (name, ok, extra = '') => {
  const line = `${name}${extra ? ' — ' + extra : ''}`;
  if (!ok) { fail++; failures.push(line); } else pass++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${line}`);
};

console.log('Dead Signal Studio smoke');
console.log('-'.repeat(58));

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
/* The CLOUD tab probes for an optional backend at boot. With no API present
   the fetch fails and the browser logs a console error — that is the probe
   working, not a fault. Filtered by URL so real errors still surface. */
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const from = m.location?.().url || '';
  // Same optional-lookup 404s as the audit suite: the API probe (./api, then
  // ./api/index.php), and the deployment note the setup wizard writes (absent
  // on a static deploy).
  if (/\/api(\/index\.php)?\/system\/health$/.test(from) || from.endsWith('/studio.config.json')) return;
  errors.push('console: ' + m.text());
});

await page.addInitScript(() => {
  // A cold browser profile has never seen the welcome card, and it is modal.
  // Suppress it the way a returning author's browser would, so the suites
  // exercise the studio rather than the first-run screen. The card itself is
  // covered by its own section below.
  try { localStorage.setItem('deadsignal.studio.welcomed', 'true'); } catch { /* ignore */ }
});

await page.goto(PAGE);
// <option> elements are never "visible" to Playwright — wait on the DOM instead.
await page.waitForFunction(() => document.documentElement.dataset.studio === 'ready');

/* Is a canvas actually drawn on? Counts distinct pixels so a flat fill and an
   all-transparent canvas both read as "blank". */
const canvasStats = (id) => page.evaluate((id) => {
  const c = document.getElementById(id);
  if (!c || !c.width) return { ok: false, reason: 'missing canvas' };
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  let opaque = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 0) opaque++;
    if (seen.size < 64) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  }
  return { ok: true, colors: seen.size, opaque, px: d.length / 4 };
}, id);

/* Set a control the way a user would. Since Phase 2 the document is
   authoritative, so assigning .value without dispatching does NOT reach it —
   the page would keep rendering the old value, which is correct behaviour. */
/* Some controls now live in a settings SECTION the panel is not showing, so a
   click has to bring that section up first — the same thing a person does. The
   suite mirrors the UI here rather than reaching past it. */
const clickControl = async (sel) => {
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    const fs = el?.closest('fieldset[data-section]');
    const view = el?.closest('.view');
    if (fs && view) window.DeadSignalStudio.showSection(view.id, fs.dataset.section);
    fs?.classList.remove('collapsed');
  }, sel);
  await page.click(sel);
};

const setControl = (id, value) => page.evaluate(({ id, value }) => {
  const el = document.getElementById(id);
  if (el.type === 'checkbox') el.checked = !!value; else el.value = String(value);
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, { id, value });

/* ------------------------------------------------------------ stylesheets -- */
{
  // The CSS is external now; a bad path yields an unstyled page that would
  // still pass every canvas check below.
  const r = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      sheets: document.styleSheets.length,
      phos: cs.getPropertyValue('--phos').trim(),
      skin: document.documentElement.getAttribute('data-skin') || 'crt',
      bodyFont: getComputedStyle(document.body).fontFamily,
      monoToken: cs.getPropertyValue('--mono').trim(),
      /* Whether the selected view LOOKS selected. Asserting one specific
         property (a borderless tab) pinned one skin's styling; what has to be
         true in every skin is that the strip distinguishes the active tab at
         all — which is the thing component CSS is for. */
      tabActive: getComputedStyle(document.querySelector('.tab.active')).color,
      tabIdle: getComputedStyle(document.querySelector('.tab:not(.active)')).color,
    };
  });
  check('stylesheets load', r.sheets >= 4, `${r.sheets} sheets`);
  check('design tokens resolve', /^#/.test(r.phos), r.phos || '(unset)');
  /* The interface font is a property of the SKIN, and the studio skin is a UI
     stack on purpose: a whole editor set in a terminal face is a costume, and
     it is the media this tool makes that is supposed to look like a signal, not
     the tool. What must hold in either skin is that the monospace token still
     resolves — timecode, numeric fields and the log line up in a column, and
     those are the places digits have to. */
  check('the interface font suits the skin',
    r.skin === 'crt' ? /mono|Consolas|Courier/i.test(r.bodyFont) : /system-ui|Segoe|Roboto|sans-serif/i.test(r.bodyFont),
    `${r.skin}: ${r.bodyFont}`);
  check('the monospace token still resolves for numbers and timecode',
    /mono|Consolas|Courier/i.test(r.monoToken), r.monoToken);
  check('component rules apply — the active view is visibly the active one',
    !!r.tabActive && r.tabActive !== r.tabIdle, `${r.tabActive} vs ${r.tabIdle}`);
}

/* ---------------------------------------------------------------- scenes -- */
{
  const scenes = await page.$$eval('#v-scene option', os => os.map(o => ({ v: o.value, t: o.textContent })));
  console.log(`\n[scenes] ${scenes.length} registered`);
  let bad = [];
  for (const s of scenes) {
    await page.evaluate((v) => {
      const el = document.getElementById('v-scene');
      el.value = v;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, s.v);
    await page.waitForTimeout(90);          // let the preview loop paint
    const st = await canvasStats('vcanvas');
    // "videoin" and "kenburns" legitimately render a placeholder until media is
    // imported; they must still paint something rather than throw.
    if (!st.ok || st.colors < 2 || st.opaque === 0) bad.push(`${s.v}(${st.colors ?? '?'}c)`);
  }
  check(`all ${scenes.length} scenes render non-blank`, bad.length === 0, bad.join(', '));
}

/* ------------------------------------------------------------- templates -- */
{
  await page.click('.tab[data-view="image"]');
  const tpls = await page.$$eval('#i-tpl option', os => os.map(o => o.value));
  console.log(`\n[templates] ${tpls.length} registered`);
  let bad = [];
  for (const t of tpls) {
    await page.evaluate((v) => {
      const el = document.getElementById('i-tpl');
      el.value = v;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, t);
    await page.waitForTimeout(40);
    const st = await canvasStats('icanvas');
    if (!st.ok || st.colors < 2 || st.opaque === 0) bad.push(`${t}(${st.colors ?? '?'}c)`);
  }
  check(`all ${tpls.length} templates render non-blank`, bad.length === 0, bad.join(', '));
}

/* ----------------------------------------------------------------- stego -- */
{
  const r = await page.evaluate(async () => {
    for (const [id, v] of [['i-tpl','terminal'], ['i-stego','OBSERVE-0347']]) {
      const el = document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await new Promise(r => setTimeout(r, 160));
    const got = window.DeadSignalStudio.decodeStego();
    document.getElementById('i-stego').value = '';
    document.getElementById('i-stego').dispatchEvent(new Event('input', { bubbles: true }));
    return String(got);
  });
  check('stego payload round-trips', /OBSERVE-0347/.test(r), r);
}

/* ----------------------------------------------------------------- audio -- */
{
  await page.click('.tab[data-view="audio"]');
  await setControl('a-dur', '2');
  await setControl('a-drone', true);
  await setControl('a-morse', true);
  await page.click('#a-render');
  await page.waitForFunction(
    () => /Rendered/.test(document.getElementById('a-status').textContent),
    null, { timeout: 30000 }
  );
  const st = await page.evaluate(() => ({
    status: document.getElementById('a-status').textContent,
    peak:   document.getElementById('a-peakv').textContent,
    dlOn:   !document.getElementById('a-dl').disabled,
  }));
  check('audio renders', /Rendered/.test(st.status), st.status.trim());
  check('peak meter reports a level', /-?\d/.test(st.peak) && st.peak !== '—', st.peak);
  check('wav download is armed', st.dlOn);
  const wave = await canvasStats('acanvas');
  check('waveform is drawn', wave.ok && wave.colors >= 2, `${wave.colors} colors`);
}

/* -------------------------------------------------- library + bundle + zip -- */
{
  const r = await page.evaluate(async () => {
    // The audio render above already put one asset in the library.
    document.querySelector('.tab[data-view="bundle"]').click();
    document.getElementById('b-gen').click();
    const wiring = document.getElementById('b-out').textContent;
    document.getElementById('b-validate').click();
    const report = document.getElementById('b-report').textContent;

    // Exercise the ZIP writer without touching the download path.
    let zipBytes = null;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = (blob) => { zipBytes = blob; return origCreate.call(URL, blob); };
    await window.DeadSignalStudio.exportCampaignBundle();
    URL.createObjectURL = origCreate;
    const buf = zipBytes ? new Uint8Array(await zipBytes.arrayBuffer()) : null;
    return {
      wiring,
      report,
      zipSize: buf ? buf.length : 0,
      zipMagic: buf ? String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) : '',
      // End of central directory signature must be present.
      hasEOCD: buf ? Array.from(buf.slice(-22, -18)).join(',') === '80,75,5,6' : false,
    };
  });
  check('bundle wiring generates a manifest', /media-manifest\.json/.test(r.wiring));
  check('bundle wiring emits index.json', /index\.json/.test(r.wiring));
  check('bundle validates', /valid|✔/i.test(r.report), r.report.trim().slice(0, 70));
  check('zip writer produces bytes', r.zipSize > 0, `${r.zipSize} bytes`);
  check('zip has PK local-header magic', r.zipMagic === 'PK', JSON.stringify(r.zipMagic));
  check('zip has end-of-central-directory', r.hasEOCD);
}

/* ------------------------------------------------------ project round-trip -- */
{
  await setControl('v-text', 'ROUND TRIP MARKER');
  const r = await page.evaluate(() => {
    const proj = window.DeadSignalStudio.readProject();
    const el = document.getElementById('v-text');
    el.value = 'clobbered';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    window.DeadSignalStudio.applyProject(JSON.parse(JSON.stringify(proj)));
    return { dom: el.value, doc: window.DeadSignalStudio.store.get('tabs.video.v-text') };
  });
  check('project save/load round-trips', r.dom === 'ROUND TRIP MARKER', r.dom);
  check('the document is the source of truth', r.doc === r.dom, `${r.doc} / ${r.dom}`);
}

/* ------------------------------------------------------- document + undo -- */
{
  await page.click('.tab[data-view="video"]');
  await setControl('v-text', 'FIRST');
  // Two edits to the same control inside the coalesce window are ONE gesture
  // by design (typing a word must not become ten undo steps), so pause to make
  // these two distinct gestures.
  await page.waitForTimeout(700);
  await setControl('v-text', 'SECOND');
  const undoResult = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const before = S.store.get('tabs.video.v-text');
    S.undo();
    const afterUndo = { doc: S.store.get('tabs.video.v-text'),
                        dom: document.getElementById('v-text').value };
    S.redo();
    const afterRedo = { doc: S.store.get('tabs.video.v-text'),
                        dom: document.getElementById('v-text').value };
    return { before, afterUndo, afterRedo };
  });
  check('undo reverts the document', undoResult.afterUndo.doc === 'FIRST', undoResult.afterUndo.doc);
  check('undo writes back to the DOM', undoResult.afterUndo.dom === 'FIRST', undoResult.afterUndo.dom);
  check('redo restores', undoResult.afterRedo.doc === 'SECOND' && undoResult.afterRedo.dom === 'SECOND');

  // Ctrl+Z must reach the store through the real key handler.
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press('Control+z');
  check('Ctrl+Z undoes',
        await page.evaluate(() => window.DeadSignalStudio.store.get('tabs.video.v-text')) === 'FIRST');
  await page.keyboard.press('Control+Shift+Z');
  check('Ctrl+Shift+Z redoes',
        await page.evaluate(() => window.DeadSignalStudio.store.get('tabs.video.v-text')) === 'SECOND');

  const slider = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const depth0 = S.store.undoDepth;
    const el = document.getElementById('v-scan');
    for (const v of [20, 30, 40, 50]) {
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return { added: S.store.undoDepth - depth0, value: S.store.get('tabs.video.v-scan') };
  });
  check('a slider drag collapses to one undo entry', slider.added === 1, `${slider.added} entries`);
  check('the drag still recorded its final value', slider.value === '50', String(slider.value));
}

/* ------------------------------------------------------------ persistence -- */
{
  const tier = await page.evaluate(() => window.DeadSignalStudio.backend?.tier ?? 0);
  check('a storage backend is open', tier > 0, `tier ${tier}`);

  await setControl('v-hud', 'SURVIVES RELOAD');
  await page.evaluate(() => window.DeadSignalStudio.flushAutosave());
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.studio === 'ready');
  // Restore is async (it opens the database first).
  await page.waitForFunction(
    () => document.getElementById('v-hud').value === 'SURVIVES RELOAD',
    null, { timeout: 8000 }
  ).catch(() => {});
  const after = await page.evaluate(() => ({
    dom: document.getElementById('v-hud').value,
    doc: window.DeadSignalStudio.store?.get('tabs.video.v-hud'),
  }));
  check('the session survives a reload (F-05)', after.dom === 'SURVIVES RELOAD', after.dom);
  check('the restored document matches the DOM', after.doc === after.dom, `${after.doc} / ${after.dom}`);
}

/* ------------------------------------------------------ timeline clips --- */
/* The clip list used to be a module-scope array that only reached the document
   when the author pressed SAVE. Three bugs fell out of that one shortcut:
   adding a clip raised no undo entry, triggered no autosave, and never reached
   the stored project — so clips vanished on reload and Ctrl+Z right after
   adding one silently undid some earlier edit instead. Clips are document
   state now; this section is what keeps them there. */
{
  const clipLabels = () => page.evaluate(() =>
    (window.DeadSignalStudio.store.get('timeline.clips') || []).map(c => c.label));
  const tableRows = () => page.evaluate(() =>
    [...document.querySelectorAll('#tl-body tr')].map(r => r.children[1]?.textContent ?? null));

  const addClip = async (scene, text) => {
    await page.click('.tab[data-view="video"]');
    await setControl('v-scene', scene);
    await setControl('v-text', text);
    await page.click('.tab[data-view="timeline"]');
    await page.click('#tl-add');
  };

  await page.evaluate(() => window.DeadSignalStudio.store.apply(
    { op: 'set', path: 'timeline.clips', value: [], label: 'reset for test' }));
  await addClip('bars', 'CLIP ONE');
  await addClip('matrix', 'CLIP TWO');

  const added = await clipLabels();
  check('a clip lands in the document, not just a local array', added.length === 2, added.join(' | '));
  check('the table shows what the document holds',
        JSON.stringify(await tableRows()) === JSON.stringify(added));

  await page.evaluate(() => window.DeadSignalStudio.undo());
  const afterUndo = await clipLabels();
  check('undo removes the clip it added', afterUndo.length === 1, afterUndo.join(' | '));
  check('undo re-renders the clip table',
        JSON.stringify(await tableRows()) === JSON.stringify(afterUndo));
  await page.evaluate(() => window.DeadSignalStudio.redo());
  check('redo puts it back', (await clipLabels()).length === 2);

  // Reordering and removing go through the same path, so they are undoable too.
  await page.click('#tl-body tr:first-child button[data-act="dn"]');
  const moved = await clipLabels();
  check('move-down reorders the document', moved[0] === added[1] && moved[1] === added[0],
        moved.join(' | '));
  await page.click('#tl-body tr:first-child button[data-act="rm"]');
  check('remove drops one clip', (await clipLabels()).length === 1);
  await page.evaluate(() => window.DeadSignalStudio.undo());
  check('undo restores a removed clip',
        JSON.stringify(await clipLabels()) === JSON.stringify(moved));

  await page.evaluate(() => window.DeadSignalStudio.flushAutosave());
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.studio === 'ready');
  await page.waitForFunction(
    () => (window.DeadSignalStudio.store?.get('timeline.clips') || []).length === 2,
    null, { timeout: 8000 },
  ).catch(() => { /* asserted below with the real values */ });
  const reloaded = await clipLabels();
  check('clips survive a reload', JSON.stringify(reloaded) === JSON.stringify(moved),
        reloaded.join(' | '));
  await page.click('.tab[data-view="timeline"]');
  check('…and the restored table matches',
        JSON.stringify(await tableRows()) === JSON.stringify(reloaded));

  /* Both previews used to run at once — they share the persistence buffer and
     the clip scratch canvas, so each wiped the other's frame mid-draw and the
     picture flickered or went black. Exactly one loop may be alive. */
  const painting = () => page.evaluate(async () => {
    const grab = () => ['vcanvas', 'tlcanvas'].map((id) => {
      const c = document.getElementById(id);
      if (!c || !c.width) return 'none';
      const n = Math.min(32, c.width), m = Math.min(32, c.height);
      return c.getContext('2d').getImageData(0, 0, n, m).data.join(',');
    });
    const a = grab();
    await new Promise(r => setTimeout(r, 400));
    const b = grab();
    return { video: a[0] !== b[0], timeline: a[1] !== b[1] };
  });
  const onTimeline = await painting();
  check('on the TIMELINE tab only the timeline preview runs',
        onTimeline.timeline && !onTimeline.video, JSON.stringify(onTimeline));
  await page.click('.tab[data-view="video"]');
  const onVideo = await painting();
  check('on the VIDEO tab only the video preview runs',
        onVideo.video && !onVideo.timeline, JSON.stringify(onVideo));

  // An undo on the timeline tab must not wake the video loop back up.
  await page.click('.tab[data-view="timeline"]');
  await page.evaluate(() => window.DeadSignalStudio.undo());
  const afterUndoOnTimeline = await painting();
  check('undo on the timeline tab does not restart the video preview',
        !afterUndoOnTimeline.video, JSON.stringify(afterUndoOnTimeline));
}

/* ---------------------------------------------------------------- toasts -- */
{
  const t = await page.evaluate(() => {
    const box = document.getElementById('toasts');
    if (!box) return { err: 'no toast container' };
    box.replaceChildren();
    // Eight *different* messages: the cap is what stops them covering the page.
    for (let i = 0; i < 8; i++) window.DeadSignalStudio.addTimelineClip();
    const capped = box.children.length;
    // Four *identical* ones: a repeat should tick a counter, not add a row.
    box.replaceChildren();
    for (let i = 0; i < 4; i++) window.DeadSignalStudio.clearLibrary();
    return { capped, repeated: box.children.length,
             pointerEvents: getComputedStyle(box).pointerEvents,
             last: box.lastElementChild?.textContent ?? '' };
  });
  // Eight actions used to leave eight stacked toasts covering the settings
  // column, and the container took clicks, so the controls beneath it stopped
  // responding — which reads as the tool being broken, not as a busy corner.
  check('toasts are capped', !t.err && t.capped <= 3, `${t.capped} showing`);
  check('a repeat is counted, not stacked', t.repeated === 1 && /×4$/.test(t.last),
        `${t.repeated} showing, "${t.last}"`);
  check('toasts never take clicks', t.pointerEvents === 'none', t.pointerEvents);
  await page.evaluate(() => {
    document.getElementById('toasts').replaceChildren();
    window.DeadSignalStudio.store.apply(
      { op: 'set', path: 'timeline.clips', value: [], label: 'reset after toast test' });
  });
}

/* ------------------------------------------------------- export control -- */
/* RECORD and STOP have to mean what they say. Both of these were broken in a
   way that produces a bad file rather than an error, which is the worst kind:
   the studio looked like it worked and the clip was wrong. */
{
  const libCount = () => page.evaluate(() => window.DeadSignalStudio.library.length);
  const recState = () => page.evaluate(() => ({
    rec: document.getElementById('v-record').disabled,
    stop: document.getElementById('v-stop').disabled,
  }));
  const waitIdle = (ms = 90000) => page.waitForFunction(
    () => !document.getElementById('v-record').disabled, null, { timeout: ms },
  ).then(() => true).catch(() => false);

  await page.click('.tab[data-view="video"]');
  await setControl('v-scene', 'matrix');
  await setControl('v-dur', 6); await setControl('v-fps', 24);
  await setControl('v-w', 480); await setControl('v-h', 360);
  await page.evaluate(() => window.DeadSignalStudio.clearLibrary());

  // vRecording was only claimed after `await encoderSupport(…)`, so two clicks
  // in one tick both cleared the guard and ran two encoders over the same
  // scratch canvases — two exports, both drawing over each other.
  await page.evaluate(() => { const b = document.getElementById('v-record'); b.click(); b.click(); });
  const busy = await recState();
  check('RECORD disables itself while exporting', busy.rec === true);
  check('STOP is offered while exporting', busy.stop === false);
  await waitIdle();
  await page.waitForTimeout(1200);           // give any second encode time to land
  check('a double-click produces ONE export', await libCount() === 1, `${await libCount()} files`);

  // STOP used to keep whatever frames had been encoded and announce it as a
  // finished export, so cancelling handed back a silently truncated clip.
  await page.evaluate(() => window.DeadSignalStudio.clearLibrary());
  await page.click('#v-record');
  await page.waitForTimeout(500);
  const mid = await recState();
  check('STOP is reachable mid-export', mid.stop === false);
  await page.click('#v-stop');
  check('the studio recovers after a cancel', await waitIdle());
  await page.waitForTimeout(600);
  check('a cancelled export saves nothing', await libCount() === 0, `${await libCount()} files`);
  check('…and says so', /cancel/i.test(await page.evaluate(() => document.getElementById('v-status').textContent)));

  // A cancel must not fall through to the real-time recorder, and must leave
  // the tab able to export again.
  await setControl('v-dur', 2);
  await page.click('#v-record');
  await waitIdle();
  await page.waitForTimeout(800);
  check('exporting still works after a cancel', await libCount() === 1, `${await libCount()} files`);

  // One export at a time: the four still exporters share RECORD's scratch
  // canvases (resizing a canvas clears it), so a .gif click mid-export must
  // refuse rather than queue a second encode over the same buffers.
  await page.evaluate(() => window.DeadSignalStudio.clearLibrary());
  const guard = await page.evaluate(() => {
    document.getElementById('v-record').click();
    const gifGreyed = document.getElementById('v-gif').disabled;
    document.getElementById('v-gif').click();          // must be refused
    return { gifGreyed };
  });
  check('still-export buttons grey the instant RECORD starts', guard.gifGreyed === true);
  await waitIdle();
  await page.waitForTimeout(1500);                     // give any second encode time to land
  const exts = await page.evaluate(() => window.DeadSignalStudio.library.map((i) => i.ext));
  check('a .gif click mid-export is refused — one clip, no gif',
        exts.length === 1 && !exts.includes('gif'), exts.join(','));
  check('still buttons recover after the export',
        await page.evaluate(() => !document.getElementById('v-gif').disabled));
  await page.evaluate(() => window.DeadSignalStudio.clearLibrary());
}

/* --------------------------------------------------- record button label -- */
/* The RECORD button must name whichever container the File picker chose — it
   used to promise ".webm" while set to MP4, and the file that landed was
   whatever the encoder actually wrote. */
{
  const label = await page.evaluate(() => {
    const set = (v) => { const s = document.getElementById('v-container');
      s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); };
    const read = () => document.getElementById('v-record').textContent.trim();
    const prev = document.getElementById('v-container').value;
    set('mp4'); const mp4 = read(); set('webm'); const webm = read(); set(prev || 'webm');
    return { mp4, webm };
  });
  check('RECORD names the container the File picker chose',
        /\.mp4$/.test(label.mp4) && /\.webm$/.test(label.webm), JSON.stringify(label));
}

/* --------------------------------------------------------- audio takes -- */
{
  await page.click('.tab[data-view="audio"]');
  await page.evaluate(() => window.DeadSignalStudio.clearLibrary());
  const render = async () => { await page.click('#a-render');
    await page.waitForFunction(() => /Rendered|failed/.test(document.getElementById('a-status').textContent),
                               null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(300); };
  await render();
  const first = await page.evaluate(() => window.DeadSignalStudio.library.length);
  await render(); await render();
  // RENDER is also the audition button, so dialling in a sound used to leave a
  // near-identical WAV in the library per attempt — and the BUNDLE tab ships
  // the library, so the package got all of them.
  check('re-rendering reuses its library row', await page.evaluate(() => window.DeadSignalStudio.library.length) === first,
        `${await page.evaluate(() => window.DeadSignalStudio.library.length)} rows after 3 renders`);
  // …but only while the author has shown no interest in the old take.
  const kept = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    S.library[S.library.length - 1].name = 'keep_this_one';
    document.getElementById('a-render').click();
    await new Promise(r => setTimeout(r, 2500));
    return { n: S.library.length, names: S.library.map(i => i.name) };
  });
  check('a renamed take is kept, not overwritten', kept.n === first + 1 && kept.names.includes('keep_this_one'),
        kept.names.join(', '));
  await page.evaluate(() => window.DeadSignalStudio.clearLibrary());
}

/* ------------------------------------- timeline fallback carries its bed -- */
/* The timeline's real-time fallback (the path every sequence with a Video In
   clip takes) used to record the bare canvas stream — shipping silent
   sequences announced as successes. Force the fallback by hiding VideoEncoder
   and prove the recorded WebM declares an audio track. */
{
  // The audio-takes section above just rendered, so 'last' is a real bed.
  await page.click('.tab[data-view="video"]');
  await setControl('v-scene', 'matrix');
  await setControl('v-dur', 2);
  await page.click('.tab[data-view="timeline"]');
  await page.click('#tl-clear');
  await page.click('#tl-add');
  await setControl('tl-audio', 'last');
  await page.evaluate(() => { window.__VE = window.VideoEncoder; window.VideoEncoder = undefined; });
  /* Real-time capture is wall-clock and load-sensitive, and a recorder error
     now correctly DISCARDS instead of shipping a truncated clip — so under a
     loaded CI box one attempt can legitimately produce nothing. Two attempts:
     what is being pinned is the audio track in a successful recording, not the
     box's scheduling luck. */
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.evaluate(() => { window.DeadSignalStudio.clearLibrary(); });
    await page.click('#tl-record');
    await page.waitForFunction(() => !document.getElementById('tl-record').disabled,
                               null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(600);
    const got = await page.evaluate(() =>
      !!window.DeadSignalStudio.library.find((i) => i.kind === 'videos'));
    if (got) break;
  }
  const hasOpus = await page.evaluate(async () => {
    const it = window.DeadSignalStudio.library.find((i) => i.kind === 'videos');
    if (!it) return 'no clip';
    const u8 = new Uint8Array(await it.blob.arrayBuffer());
    const needle = 'A_OPUS';                    // the Matroska codec id of the audio TrackEntry
    outer: for (let i = 0; i < u8.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) if (u8[i + j] !== needle.charCodeAt(j)) continue outer;
      return true;
    }
    return false;
  });
  check('the timeline fallback recording carries an audio track', hasOpus === true, String(hasOpus));
  await page.evaluate(() => { window.VideoEncoder = window.__VE; delete window.__VE;
    window.DeadSignalStudio.clearLibrary(); });
  await page.click('#tl-clear');
  await setControl('tl-audio', '');
  await page.click('.tab[data-view="video"]');
}

/* --------------------------------------------------------- file import -- */
/* A real upload, because every earlier suite clicked buttons and never handed
   the page a file — which is exactly how this shipped broken. Importing an
   image set `$("v-scene").value` directly; val() reads the DOCUMENT and never
   looks at the DOM, so the Scene select flipped to Ken Burns while the renderer
   carried on drawing the old scene and the picture never appeared. */
{
  // A 64×64 checkerboard, built here so the suite carries no binary fixture.
  const png = (() => {
    const crcTable = [...Array(256)].map((_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc = (buf) => {
      let c = 0xffffffff;
      for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const u32 = (n) => Buffer.from([n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255]);
    const chunk = (type, data) => {
      const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
      return Buffer.concat([u32(data.length), td, u32(crc(td))]);
    };
    const W = 64, H = 64, rows = [];
    for (let y = 0; y < H; y++) {
      const row = Buffer.alloc(1 + W * 3);
      for (let x = 0; x < W; x++) {
        const v = ((x >> 3) + (y >> 3)) % 2 === 0 ? 255 : 20;
        row[1 + x * 3] = v; row[2 + x * 3] = v; row[3 + x * 3] = v;
      }
      rows.push(row);
    }
    const ihdr = Buffer.concat([u32(W), u32(H), Buffer.from([8, 2, 0, 0, 0])]);
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlibSync(Buffer.concat(rows))),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  })();

  const file = { name: 'audit-checkerboard.png', mimeType: 'image/png', buffer: png };

  await page.click('.tab[data-view="video"]');
  await setControl('v-scene', 'terminal');
  await page.waitForTimeout(200);
  await page.setInputFiles('#v-imgfile', file);
  await page.waitForFunction(
    () => window.DeadSignalStudio.store.get('tabs.video.v-scene') === 'kenburns',
    null, { timeout: 8000 },
  ).catch(() => { /* asserted below */ });

  const after = await page.evaluate(() => ({
    dom: document.getElementById('v-scene').value,
    doc: window.DeadSignalStudio.store.get('tabs.video.v-scene'),
    cfg: window.DeadSignalStudio.readVideoCfg().scene,
  }));
  check('importing an image switches the scene in the DOCUMENT, not just the widget',
        after.doc === 'kenburns' && after.cfg === 'kenburns', JSON.stringify(after));

  // The real proof: the imported picture is on the canvas.
  await page.waitForTimeout(600);
  const lit = await page.evaluate(() => {
    const c = document.getElementById('vcanvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let white = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) white++;
    return white;
  });
  check('…and the imported image actually renders', lit > 500, `${lit} bright px`);

  await page.click('.tab[data-view="image"]');
  await setControl('i-tpl', 'terminal');
  await page.waitForTimeout(200);
  await page.setInputFiles('#i-imgfile', file);
  await page.waitForFunction(
    () => window.DeadSignalStudio.store.get('tabs.image.i-tpl') === 'import',
    null, { timeout: 8000 },
  ).catch(() => {});
  check('importing on the SCREEN tab switches the template in the document',
        await page.evaluate(() => window.DeadSignalStudio.store.get('tabs.image.i-tpl')) === 'import');
  await page.click('.tab[data-view="video"]');
  await setControl('v-scene', 'terminal');

  /* A file input is not document state, and binding it was quietly fatal: the
     browser reports "C:\\fakepath\\…" and refuses to let anything write it back,
     so the next project load threw inside renderDocToDom. That throw aborted
     the WHOLE restore — it travelled up through store.replace() into
     initPersistence's catch — leaving every dynamic panel showing its empty
     state while the document behind it was fully populated. Silent, and only
     after an import, which is why it survived several audits. */
  await page.evaluate(() => window.DeadSignalStudio.store.apply(
    { op: 'set', path: 'layers.video', value: [{ scene: 'matrix', blend: 'screen', opacity: 0.5, enabled: true }] }));
  await setControl('v-hud', 'AFTER IMPORT');
  await page.evaluate(() => window.DeadSignalStudio.flushAutosave());
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.studio === 'ready');
  const restored = await page.waitForFunction(
    () => document.getElementById('v-hud').value === 'AFTER IMPORT',
    null, { timeout: 8000 },
  ).then(() => true).catch(() => false);
  check('a project still restores after a file has been imported', restored);
  check('…and the dynamic panels refresh with it',
        await page.waitForFunction(
          () => document.querySelectorAll('#v-layers-list .layer-row').length === 1,
          null, { timeout: 8000 },
        ).then(() => true).catch(() => false));
  check('no file input is bound to the document', await page.evaluate(() => {
    const doc = window.DeadSignalStudio.store.doc;
    const ids = Object.values(doc.tabs).flatMap((t) => Object.keys(t));
    return ids.every((id) => document.getElementById(id)?.type !== 'file');
  }));
  await page.evaluate(() => window.DeadSignalStudio.store.apply(
    { op: 'set', path: 'layers.video', value: [] }));
}

/* --------------------------------- everything else that writes a control -- */
/* Same root cause, eight more features. Each one moved its widget and changed
   nothing, with no error anywhere. */
{
  const docGet = (path) => page.evaluate((p) => window.DeadSignalStudio.store.get(p), path);

  await page.click('.tab[data-view="video"]');
  const seedBefore = await docGet('seed');
  await page.click('#seed-roll');
  await page.waitForTimeout(300);
  check('the seed roller reaches the document', await docGet('seed') !== seedBefore,
        `${seedBefore} -> ${await docGet('seed')}`);

  await setControl('v-w', 320); await setControl('v-h', 240);
  await page.waitForTimeout(200);
  await setControl('v-aspect', '16:9');
  await page.waitForTimeout(300);
  check('the aspect-ratio helper reaches the document',
        String(await docGet('tabs.video.v-h')) === '180', String(await docGet('tabs.video.v-h')));

  const fgBefore = await docGet('tabs.video.v-fg');
  await page.selectOption('#aesthetic', { index: 2 });
  await page.waitForTimeout(400);
  check('switching aesthetic reaches the document',
        await docGet('tabs.video.v-fg') !== fgBefore,
        `${fgBefore} -> ${await docGet('tabs.video.v-fg')}`);

  // Presets: the whole point is that they change the picture.
  const frame = () => page.evaluate(() => {
    const S = window.DeadSignalStudio, cfg = S.readVideoCfg();
    const c = document.createElement('canvas'); c.width = cfg.W; c.height = cfg.H;
    const ctx = c.getContext('2d');
    let h = 2166136261;
    for (let k = 0; k < 6; k++) {
      S.renderVideoFrame(ctx, cfg.W, cfg.H, cfg, (k / 6) * cfg.duration);
      const d = ctx.getImageData(0, 0, cfg.W, cfg.H).data;
      for (let i = 0; i < d.length; i += 29) { h ^= d[i]; h = Math.imul(h, 16777619); }
    }
    return h >>> 0;
  });
  const presets = await page.evaluate(() =>
    [...document.getElementById('v-preset').options].map(o => o.value)
      .filter(v => v && v !== '— custom —').slice(0, 3));
  let changed = 0;
  for (const name of presets) {
    const before = await frame();
    await setControl('v-preset', name);
    await page.waitForTimeout(250);
    if (await frame() !== before) changed++;
  }
  check('loading a preset changes the render', changed === presets.length,
        `${changed}/${presets.length}`);

  // Per-section RESET.
  await setControl('v-scan', 77);
  await page.waitForTimeout(250);
  const dirty = await docGet('tabs.video.v-scan');
  await page.click('#v-reset');
  await page.waitForTimeout(500);
  check('RESET reaches the document', String(await docGet('tabs.video.v-scan')) !== String(dirty),
        `${dirty} -> ${await docGet('tabs.video.v-scan')}`);

  // The FIX button on a validation banner.
  await setControl('v-dur', 4);
  await setControl('v-reveal', 'OBSERVE');
  await setControl('v-revhold', 9);
  await page.waitForTimeout(500);
  const fixed = await page.evaluate(async () => {
    const btn = document.querySelector('#v-banners button');
    if (!btn) return { raised: false };
    const before = window.DeadSignalStudio.store.get('tabs.video.v-revhold');
    btn.click();
    await new Promise(r => setTimeout(r, 400));
    return { raised: true, before, after: window.DeadSignalStudio.store.get('tabs.video.v-revhold') };
  });
  check('the banner FIX button reaches the document',
        fixed.raised && String(fixed.after) !== String(fixed.before), JSON.stringify(fixed));

  // The command palette.
  await page.click('#palette-open');
  await page.waitForTimeout(300);
  await page.keyboard.type('Digital Rain');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  check('picking a scene from the command palette reaches the document',
        await docGet('tabs.video.v-scene') === 'matrix',
        String(await docGet('tabs.video.v-scene')));

  await page.click('#v-reset');
  await page.waitForTimeout(300);
}

/* --------------------------------------------------- palette + explain --- */
{
  // Every control must be findable and explained — with 137 of them across
  // seven tabs, "scroll until you see it" is not a discovery mechanism.
  const cov = await page.evaluate(() => window.DeadSignalStudio.explainCoverage());
  check('every control has Explain copy', cov.missing.length === 0,
        `${cov.total - cov.missing.length}/${cov.total}` +
        (cov.missing.length ? ' missing: ' + cov.missing.slice(0, 8).join(', ') : ''));

  await page.keyboard.press('Control+k');
  check('Ctrl+K opens the palette', await page.evaluate(() => !document.getElementById('palette').hidden));

  await page.keyboard.type('scanlines');
  const hits = await page.evaluate(() =>
    [...document.querySelectorAll('.pal-item')].map((li) => li.textContent));
  check('a setting is findable by name', hits.some((h) => /Scanlines/i.test(h)), hits[0] || '(none)');

  await page.keyboard.press('Enter');
  const jumped = await page.evaluate(() => ({
    tab: document.querySelector('.tab.active')?.dataset.view,
    focused: document.activeElement?.id,
    closed: document.getElementById('palette').hidden,
  }));
  check('choosing a setting closes the palette', jumped.closed);
  check('…switches to the right tab and focuses the control',
        jumped.tab === 'video' && jumped.focused === 'v-scan', JSON.stringify(jumped));

  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  check('Escape closes the palette', await page.evaluate(() => document.getElementById('palette').hidden));

  /* THE CATALOGUE IS BUILT WHEN THE PALETTE IS OPENED, NOT AT BOOT.
     It was a snapshot taken in initPalette() and never refreshed, and it listed
     only the SHIPPED presets — so a look the author saved themselves, the thing
     they are most likely to search for by name, was the one thing ⌘K could not
     find, whichever way you came at it. Both faults show up in the same probe:
     save a preset after boot, then look for it. */
  const fresh = await page.evaluate(async () => {
    const R = await import('./src/core/recipes.js');
    const P = await import('./src/ui/palette.js');
    const PR = await import('./src/presets/index.js');
    const labels = () => [...document.querySelectorAll('#pal-list .pal-item .pal-label')]
      .map((n) => n.textContent);
    const find = (q) => {
      const i = document.getElementById('pal-input');
      i.value = q; i.dispatchEvent(new Event('input', { bubbles: true }));
      return labels();
    };
    for (const n of Object.keys(R.userPresets('video'))) R.deleteUserPreset('video', n);

    P.openPalette();
    const before = find('MIDNIGHT');
    P.closePalette();

    const all = R.userPresets('video');
    all['MIDNIGHT RUN'] = { 'v-scan': '61' };
    R.lsSet(R.PKEY('video'), all);
    PR.rebuildPresetSelect('video');

    P.openPalette();
    const after = find('MIDNIGHT');
    // Choosing it loads that preset, which is the point of finding it.
    document.querySelector('#pal-list .pal-item')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const picker = document.getElementById('v-preset').value;

    for (const n of Object.keys(R.userPresets('video'))) R.deleteUserPreset('video', n);
    P.openPalette();
    const gone = find('MIDNIGHT');
    P.closePalette();
    return { before, after, gone, picker };
  });
  check('a preset saved after boot is findable in the palette',
        fresh.before.length === 0 && fresh.after.includes('MIDNIGHT RUN'),
        JSON.stringify(fresh));
  check('…and choosing it loads that preset',
        fresh.picker === 'user:MIDNIGHT RUN', fresh.picker);
  check('…and a deleted one stops being listed', fresh.gone.length === 0, JSON.stringify(fresh.gone));

  // Explain mode must be reachable and usable from the keyboard, not just by
  // hovering for a title tooltip.
  // Focus is still in v-scan from the palette jump, and "?" typed into a field
  // must insert a character rather than toggle a mode — so step out first.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('?');
  check('? arms Explain mode', await page.evaluate(() => document.body.classList.contains('explain-armed')));
  const explained = await page.evaluate(() => {
    document.getElementById('v-scan').focus();
    const p = document.getElementById('explain-pop');
    return { shown: !p.hidden, title: p.querySelector('.ex-title')?.textContent,
             body: (p.querySelector('.ex-body')?.textContent || '').slice(0, 40),
             meta: p.querySelector('.ex-meta')?.textContent };
  });
  check('focusing a control explains it', explained.shown && explained.title === 'Scanlines', explained.title);
  check('the explanation says what it does', /CRT|lines/i.test(explained.body), explained.body);
  check('the explanation states range and unit', /Range: 0 to 100/.test(explained.meta), explained.meta);
  await page.keyboard.press('Escape');
  check('Escape disarms Explain mode',
        await page.evaluate(() => !document.body.classList.contains('explain-armed')));
}

/* ------------------------------------------------- macros + complexity --- */
{
  await page.click('.tab[data-view="video"]');
  const before = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    return { scan: S.store.get('tabs.video.v-scan'), track: S.store.get('tabs.video.v-track'),
             depth: S.store.undoDepth };
  });
  await setControl('v-macro-grime', 80);
  const after = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    return { scan: S.store.get('tabs.video.v-scan'), track: S.store.get('tabs.video.v-track'),
             noise: S.store.get('tabs.video.v-noise'), depth: S.store.undoDepth,
             domScan: document.getElementById('v-scan').value };
  });
  check('a macro moves many parameters at once',
        after.scan !== before.scan && after.track !== before.track && Number(after.noise) > 0,
        `scan ${before.scan}->${after.scan}, track ${before.track}->${after.track}, noise ${after.noise}`);
  check('the macro writes through to the real controls', after.domScan === after.scan,
        `${after.domScan} / ${after.scan}`);
  check('a macro is a single undo entry', after.depth - before.depth === 1,
        `${after.depth - before.depth} entries`);

  await page.evaluate(() => window.DeadSignalStudio.undo());
  const undone = await page.evaluate(() => ({
    scan: window.DeadSignalStudio.store.get('tabs.video.v-scan'),
    track: window.DeadSignalStudio.store.get('tabs.video.v-track'),
  }));
  check('undo reverts the whole macro', undone.scan === before.scan && undone.track === before.track,
        `${undone.scan} / ${undone.track}`);

  // Complexity is a view filter: hidden controls keep their values.
  const simple = await page.evaluate(() => {
    window.DeadSignalStudio.applyLevel(1);
    const vis = (id) => { const el = document.getElementById(id);
      const row = el.closest('.row'); return !!row && !row.classList.contains('level-hidden'); };
    return { level: window.DeadSignalStudio.getLevel(), scene: vis('v-scene'), mask: vis('v-mask'),
             grime: vis('v-macro-grime'), maskValue: window.DeadSignalStudio.store.get('tabs.video.v-mask') };
  });
  check('Simple hides advanced controls but keeps the essential ones',
        simple.scene && simple.grime && !simple.mask, JSON.stringify(simple));
  check('hidden controls keep their value', simple.maskValue !== undefined, String(simple.maskValue));

  const deep = await page.evaluate(() => {
    window.DeadSignalStudio.applyLevel(3);
    const el = document.getElementById('v-mask');
    return !el.closest('.row').classList.contains('level-hidden');
  });
  check('Deep shows everything again', deep);
  await page.evaluate(() => window.DeadSignalStudio.applyLevel(2));
}

/* --------------------------- palette reveals a detail-hidden setting ------ */
/* Ctrl+K promises to jump to every setting, not just the visible ones: at the
   default Studio level a jump to a Deep-only control used to silently do
   nothing. It must raise the detail level, unhide the row and focus it. */
{
  await page.evaluate(() => { window.DeadSignalStudio.applyLevel(2); document.activeElement?.blur(); });
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Shadow mask');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const row = document.getElementById('v-mask').closest('.row');
    return { level: window.DeadSignalStudio.getLevel(),
             hidden: row.classList.contains('level-hidden'),
             focused: document.activeElement && document.activeElement.id };
  });
  check('Ctrl+K to a Deep setting raises the detail level', r.level === 3, String(r.level));
  check('…and the row is visible and focused', !r.hidden && r.focused === 'v-mask', JSON.stringify(r));
  await page.evaluate(() => window.DeadSignalStudio.applyLevel(2));
}

/* ------------------------------------------------------------ flash meter -- */
{
  await page.click('.tab[data-view="video"]');
  await setControl('v-scene', 'terminal');
  await setControl('v-blink', '');
  await setControl('v-flick', 0);
  await page.waitForTimeout(900);
  const calm = await page.evaluate(() => ({
    text: document.getElementById('v-flash').textContent,
    risky: document.getElementById('v-flash').classList.contains('risky'),
  }));
  check('the meter is live and reads a calm clip as safe',
        /flash [\d.]+\/s/.test(calm.text) && !calm.risky, calm.text);

  // The studio's own blink overlay is rgba(255,255,255,.12) over near-black —
  // about a 0.015 luminance change, well under WCAG's 0.1. It should NOT be
  // flagged, and asserting that is the point: the built-in strobe is safe by
  // construction, and the meter must not cry wolf about it.
  await setControl('v-blink', '30');
  await setControl('v-dur', 3);
  await page.waitForTimeout(1800);
  const blink = await page.evaluate(() =>
    document.getElementById('v-flash').classList.contains('risky'));
  check('the built-in blink overlay is below the WCAG threshold', !blink);
  await setControl('v-blink', '');

  // Drive the readout with a genuine black/white strobe to prove the warning
  // path itself works — imported footage can absolutely do this.
  const warned = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    S.resetFlashMeter();
    const el = document.getElementById('v-flash');
    let t = 0;
    for (let i = 0; i < 24; i++) { S.feedLuminance(i % 2 ? 0.9 : 0.0, t); t += 50; }
    el.dataset.risky = 'false';                 // allow the transition to fire
    // Paint just after the last sample: resetFlashMeter() cleared the repaint
    // throttle, and the whole feed has to still be inside the measurement
    // window or there is nothing left to be alarmed about. (Jumping ten
    // seconds ahead to dodge the throttle also jumped past the window — it
    // only ever passed because paintFlash was reading a different clock.)
    /* The crossing is announced through the callback, ONCE — the readout itself
       must never become a live region. It carried aria-live="polite" while this
       function rewrote its text four times a second for as long as the preview
       ran, so a screen reader recited the number continuously over everything
       else; and the old code's answer to that was to switch it to ASSERTIVE
       while the rate was over the limit, which turned four rewrites a second
       into four interrupting alerts a second. */
    const crossings = [];
    S.paintFlash(el, t + 60, (risky, hz) => crossings.push({ risky, hz }));
    // A second paint while still over the limit must not announce again.
    S.paintFlash(el, t + 400, (risky, hz) => crossings.push({ risky, hz }));
    return { text: el.textContent, risky: el.classList.contains('risky'),
             role: el.getAttribute('role'), live: el.getAttribute('aria-live'),
             crossings, rate: S.currentFlashRate(t + 60) };
  });
  check('a real strobe is measured over the limit', warned.rate > 3, `${warned.rate.toFixed(1)}/s`);
  check('the readout turns red', warned.risky, warned.text);
  check('the readout is not a live region, so the number is not recited',
        warned.live === null && warned.role === null,
        `aria-live=${warned.live} role=${warned.role}`);
  check('…and crossing the limit is announced exactly once',
        warned.crossings.length === 1 && warned.crossings[0].risky === true,
        JSON.stringify(warned.crossings));
  await page.evaluate(() => window.DeadSignalStudio.resetFlashMeter());
}

/* ---------------------------------------------------------- editor-only -- */
/* The classic tabbed layout and the three-pane workspace are gone, with their
   toggles. The editor is the studio now, so what there is to prove is the
   removal itself: no leftover chrome, no escape hatch, and no way for a stale
   saved preference to resurrect a layout that no longer ships. */
{
  await page.click('.tab[data-view="video"]');
  const shape = await page.evaluate(() => ({
    nle: document.body.classList.contains('nle'),
    workspace: document.body.classList.contains('workspace'),
    browser: !!document.getElementById('ws-browser'),
    editorToggle: !!document.getElementById('editor-toggle'),
    workspaceToggle: !!document.getElementById('workspace-toggle'),
    seam: 'setWorkspace' in window.DeadSignalStudio,
    chrome: !!document.getElementById('nle-chrome'),
    status: !!document.getElementById('nle-status'),
  }));
  check('the editor is the only layout', shape.nle && !shape.workspace && !shape.browser,
        JSON.stringify(shape));
  check('the layout toggles are gone', !shape.editorToggle && !shape.workspaceToggle && !shape.seam,
        JSON.stringify(shape));
  check('the editor chrome is on screen', shape.chrome && shape.status);

  // Ctrl+\ used to switch layouts; now it must do nothing at all.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Control+\\');
  check('Ctrl+\\ no longer switches layouts',
        await page.evaluate(() => document.body.classList.contains('nle')
          && !document.body.classList.contains('workspace')));

  // A browser that remembers the old preferences must still get the editor:
  // the stored keys point at layouts that no longer exist.
  const fresh = await browser.newPage();
  await fresh.addInitScript(() => {
    try {
      localStorage.setItem('deadsignal.studio.welcomed', 'true');
      localStorage.setItem('deadsignal.editor.mode', '0');
      localStorage.setItem('deadsignal.workspace', '1');
    } catch { /* ignore */ }
  });
  await fresh.goto(PAGE);
  await fresh.waitForFunction(() => window.DeadSignalStudio && document.body.classList.contains('nle'));
  const legacy = await fresh.evaluate(() => ({
    nle: document.body.classList.contains('nle'),
    workspace: document.body.classList.contains('workspace'),
  }));
  await fresh.close();
  check('stale layout preferences cannot bring the old layouts back',
        legacy.nle && !legacy.workspace, JSON.stringify(legacy));
}

/* ========================================================== keyframes ====== */
/* The audit proves a track renders. This proves an author can MAKE one with
   the panel: scrub, set, press KEY — which is the only route that ships. */
console.log('\n[layers panel]');
{
  await page.evaluate(() => document.querySelector('.tab[data-view="video"]').click());
  await clickControl('#v-layers-add');
  await clickControl('#v-layers-add');
  const rows = await page.evaluate(() => document.querySelectorAll('#v-layers-list .layer-row').length);
  check('the ＋ LAYER button adds rows', rows === 2, String(rows));
  check('the stack is in the document',
        await page.evaluate(() => (window.DeadSignalStudio.store.get('layers.video') || []).length) === 2);
  check('the legend shows the layer count',
        await page.evaluate(() => document.getElementById('v-layers-count').textContent) === '2');

  // The list is top-down, so the FIRST row on screen is the LAST layer drawn.
  await page.evaluate(() => {
    const sel = document.querySelector('#v-layers-list select[data-k="scene"]');
    sel.value = 'matrix';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  check('changing a row\'s scene writes to the top layer',
        await page.evaluate(() => window.DeadSignalStudio.store.get('layers.video')[1].scene) === 'matrix');

  await page.evaluate(() => {
    const r = document.querySelector('#v-layers-list input[type=range][data-k="opacity"]');
    r.value = '25';
    r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  check('the opacity slider writes through',
        await page.evaluate(() => window.DeadSignalStudio.store.get('layers.video')[1].opacity) === 0.25);

  await page.evaluate(() => {
    const c = document.querySelector('#v-layers-list input[type=checkbox][data-k="enabled"]');
    c.checked = false;
    c.dispatchEvent(new Event('change', { bubbles: true }));
  });
  check('a layer can be switched off',
        await page.evaluate(() => window.DeadSignalStudio.store.get('layers.video')[1].enabled) === false);
  check('a disabled row is shown as disabled',
        await page.evaluate(() =>
          document.querySelector('#v-layers-list .layer-row').classList.contains('off')));

  // Reorder: ↓ on the top row moves it under the other one.
  await page.click('#v-layers-list button[data-act="dn"]:not([disabled])');
  check('the arrows reorder the stack',
        await page.evaluate(() => window.DeadSignalStudio.store.get('layers.video')[0].scene) === 'matrix');

  await page.evaluate(() => window.DeadSignalStudio.undo());
  check('reordering is undoable',
        await page.evaluate(() => window.DeadSignalStudio.store.get('layers.video')[1].scene) === 'matrix');

  await page.click('#v-layers-list button[data-act="rm"]');
  check('the ✕ button removes a layer',
        await page.evaluate(() => (window.DeadSignalStudio.store.get('layers.video') || []).length) === 1);

  await page.evaluate(() => window.DeadSignalStudio.clearLayers());
  check('clearing empties the stack',
        await page.evaluate(() => (window.DeadSignalStudio.store.get('layers.video') || []).length) === 0);
  check('the empty state explains itself',
        await page.evaluate(() =>
          /No layers/.test(document.getElementById('v-layers-list').textContent)));
}

console.log('\n[keyframe panel]');
{
  await page.evaluate(() => {
    document.querySelector('.tab[data-view="video"]').click();
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('v-dur', '10');
    set('v-auto-param', 'v-scan');
  });

  // Key at the start with the control low...
  await page.evaluate(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('v-scrub', '0');
    set('v-scan', '5');
  });
  await clickControl('#v-auto-key');
  // ...and again at the end with it high.
  await page.evaluate(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('v-scrub', '1000');
    set('v-scan', '95');
  });
  await clickControl('#v-auto-key');

  const made = await page.evaluate(() =>
    window.DeadSignalStudio.store.get('automation.video.v-scan'));
  check('the KEY button writes keys', Array.isArray(made) && made.length === 2,
        JSON.stringify(made));
  check('keys land at the scrubbed times',
        made && made[0].t === 0 && Math.abs(made[1].t - 10) < 0.05,
        made ? `${made[0].t}s, ${made[1].t}s` : '');
  check('keys carry the control values at the time they were set',
        made && made[0].v === 5 && made[1].v === 95,
        made ? `${made[0].v} → ${made[1].v}` : '');

  const listed = await page.evaluate(() =>
    document.querySelectorAll('#v-auto-list tbody tr').length);
  check('both keys are listed', listed === 2, String(listed));

  check('the automated control is marked in the settings panel',
        await page.evaluate(() => document.getElementById('v-scan').classList.contains('automated')));
  check('the picker flags which parameters have keys',
        await page.evaluate(() =>
          [...document.querySelectorAll('#v-auto-param option')]
            .some((o) => o.value === 'v-scan' && o.textContent.includes('◆'))));

  // Undo is the safety net that makes keying cheap to try.
  await page.evaluate(() => window.DeadSignalStudio.undo());
  check('undo removes the last key',
        await page.evaluate(() =>
          (window.DeadSignalStudio.store.get('automation.video.v-scan') || []).length) === 1);
  await page.evaluate(() => window.DeadSignalStudio.redo());

  // Removing a key from the list.
  await page.click('#v-auto-list button[data-rm]');
  check('the ✕ button removes a key',
        await page.evaluate(() =>
          (window.DeadSignalStudio.store.get('automation.video.v-scan') || []).length) === 1);

  await clickControl('#v-auto-clear');
  check('CLEAR empties the track',
        await page.evaluate(() =>
          (window.DeadSignalStudio.store.get('automation.video.v-scan') || []).length) === 0);
  check('…and the control stops being marked',
        await page.evaluate(() => !document.getElementById('v-scan').classList.contains('automated')));
}

/* ========================================================= onboarding ====== */
/* The first thirty seconds. Runs last because it reloads the page with a cold
   profile, which would otherwise throw away everything the suite set up. */
console.log('\n[first run]');
{
  // A FRESH page, not a reload: addInitScript runs on every navigation, so
  // reloading this one would re-suppress the card it is meant to test. A new
  // page gets its own context, and therefore its own empty localStorage.
  const first = await browser.newPage();
  first.on('pageerror', (e) => errors.push('first-run: ' + String(e)));
  await first.goto(PAGE);
  await first.waitForFunction(() => document.documentElement.dataset.studio === 'ready');

  const shown = await first.evaluate(() => {
    const el = document.getElementById('welcome');
    return { visible: el && el.style.display !== 'none',
             focused: document.activeElement?.id,
             modal: el?.getAttribute('aria-modal') };
  });
  check('the welcome card appears on a cold start', shown.visible);
  check('…with the primary action focused', shown.focused === 'welcome-sample', shown.focused);
  check('…and declares itself modal', shown.modal === 'true', shown.modal);

  /* AND IT DOES NOT FLASH AT SOMEONE WHO HAS ALREADY DISMISSED IT.
     The card is visible in the markup so a cold start shows it without waiting
     for the module graph; initWelcome(), which hides it again for a returning
     author, used to run two hundred lines into boot, after every panel was
     built. So a returning author got a flash of a modal dialog on every load —
     and every click during that flash landed on the dialog rather than the
     tool, which is how this was found: an intermittent CI failure where a tab
     click was intercepted by #welcome. Sampled from the first paint. */
  {
    const returning = await browser.newPage();
    returning.on('pageerror', (e) => errors.push('returning: ' + String(e)));
    await returning.addInitScript(() => {
      try { localStorage.setItem('deadsignal.studio.welcomed', 'true'); } catch { /* ignore */ }
      // Sample #welcome on every frame from the very first one, so a card that
      // is up for two frames is still caught.
      window.__welcomeFrames = { seen: 0, visible: 0, builtAtReady: null };
      const tick = () => {
        const el = document.getElementById('welcome');
        if (el) {
          window.__welcomeFrames.seen++;
          if (getComputedStyle(el).display !== 'none') window.__welcomeFrames.visible++;
        }
        if (document.documentElement.dataset.studio === 'ready') {
          // What was actually on the page the first frame the flag was up.
          window.__welcomeFrames.builtAtReady = {
            scenes: document.querySelectorAll('#v-scene option').length,
            templates: document.querySelectorAll('#i-tpl option').length,
            containers: document.querySelectorAll('#v-container option').length,
            sections: document.querySelectorAll('.sec-strip').length,
            said: /DEAD SIGNAL STUDIO ready/.test(document.getElementById('console')?.textContent || ''),
          };
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await returning.goto(PAGE);
    await returning.waitForFunction(() => document.documentElement.dataset.studio === 'ready');
    const flash = await returning.evaluate(() => ({
      ...window.__welcomeFrames,
      displayNow: getComputedStyle(document.getElementById('welcome')).display,
    }));
    check('…and never flashes at an author who has already dismissed it',
      flash.visible === 0, `${flash.visible} of ${flash.seen} frames during boot`);
    const built = flash.builtAtReady || {};
    check('…and by the time it is up, every picker boot fills is filled',
      built.scenes > 40 && built.templates > 40 && built.containers > 0 && built.sections > 0,
      JSON.stringify(built));
    await returning.close();
  }

  /* THE READY FLAG HAS TO BE WORTH WAITING ON.
     Every suite here waits on data-studio="ready" before it touches anything.
     What it replaced — "the global exists and #v-scene has options" — was true
     a dozen lines into a boot() that is two hundred and fifty long, so a boot
     that threw part way still satisfied it and the suite went on clicking at a
     half-wired page. That is not a hypothetical: it is how the intermittent
     failure above presented, as a tab click swallowed by a #welcome that
     initWelcome() never got to close.

     Proven by breaking boot on purpose. One module is served as a stub whose
     initSections() throws; everything before it still runs, so the old gate
     would still be satisfied. The flag must not be. */
  {
    const broken = await browser.newPage();
    const raised = [];
    broken.on('pageerror', (e) => raised.push(String(e.message).slice(0, 60)));
    await broken.route('**/src/ui/sections.js', (route) => route.fulfill({
      status: 200, contentType: 'text/javascript',
      body: `export function initSections(){ throw new Error('deliberate boot failure'); }
             export function activeSection(){ return null; }
             export function sectionsOf(){ return []; }
             export function showSection(){}
             export function revealSectionFor(){}`,
    }));
    await broken.goto(PAGE);
    // The gate the suites used to use, and the one they use now.
    const oldGate = await broken.waitForFunction(
      () => window.DeadSignalStudio && document.querySelectorAll('#v-scene option').length > 0,
      null, { timeout: 8000 }).then(() => true).catch(() => false);
    const newGate = await broken.waitForFunction(
      () => document.documentElement.dataset.studio === 'ready',
      null, { timeout: 4000 }).then(() => true).catch(() => false);
    check('a boot that throws part way still satisfies the OLD readiness test', oldGate);
    check('…but never raises the ready flag the suites wait on now', newGate === false,
      raised[0] || '(boot did not throw — the stub is no longer reached)');
    await broken.close();
  }

  await first.click('#welcome-sample');
  const after = await first.evaluate(() => {
    const S = window.DeadSignalStudio;
    return {
      hidden: document.getElementById('welcome').style.display === 'none',
      name: S.store.get('meta.name'),
      text: S.store.get('tabs.video.v-text'),
      domText: document.getElementById('v-text').value,
      keys: (S.store.get('automation.video.v-scan') || []).length,
      layers: (S.store.get('layers.video') || []).length,
      stereo: S.store.get('tabs.audio.a-channels'),
      tab: document.querySelector('.tab.active')?.dataset.view,
      flagged: document.getElementById('v-scan').classList.contains('automated'),
    };
  });
  check('the sample loads and closes the card', after.hidden);
  check('the sample names itself', /sample/i.test(after.name || ''), after.name);
  check('the sample reaches the document', /ARCHIVE NODE/.test(after.text || ''), after.text);
  // The whole point of the overlay approach: the DOM must follow the document.
  check('…and the DOM re-rendered from it', after.domText === after.text);
  check('the sample brings keyframes', after.keys === 2, String(after.keys));
  check('…and a layer', after.layers === 1, String(after.layers));
  check('…and a stereo audio bed', after.stereo === '2', String(after.stereo));
  check('the keyframed control is marked in the panel', after.flagged);
  check('it lands on the video tab', after.tab === 'video', after.tab);

  // The sample must actually render, not just populate fields.
  const drew = await first.evaluate(() => {
    const S = window.DeadSignalStudio;
    const cfg = Object.assign(S.readVideoCfg(), { W: 160, H: 120 });
    const shot = (t) => {
      const c = document.createElement('canvas'); c.width = 160; c.height = 120;
      S.renderVideoFrame(c.getContext('2d'), 160, 120, cfg, t);
      const d = c.getContext('2d').getImageData(0, 0, 160, 120).data;
      let lit = 0, h = 2166136261 >>> 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 40) lit++;
      for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
      return { lit, h: h.toString(16) };
    };
    const a = shot(1), b = shot(9);
    return { lit: a.lit, decays: a.h !== b.h };
  });
  check('the sample renders a real picture', drew.lit > 200, `${drew.lit} lit px`);
  check('…and visibly decays across the clip', drew.decays);

  // Dismissing must stick, or it stops being a first-run card.
  await first.reload();
  await first.waitForFunction(() => window.DeadSignalStudio);
  check('the card does not return on the next visit',
        await first.evaluate(() => document.getElementById('welcome').style.display === 'none'));
  check('…but HELP can reopen it', await first.evaluate(() => {
    document.getElementById('help-welcome').click();
    return document.getElementById('welcome').style.display !== 'none';
  }));

  /* Mid-project the reopened card must not default Enter onto the destructive
     action, a dismissed confirm must change nothing, and an accepted load must
     stash the outgoing project so a misclick is recoverable. */
  first.on('dialog', (d) => d.dismiss().catch(() => {}));
  await first.evaluate(() => {
    document.getElementById('welcome-close').click();
    const e = document.getElementById('v-text');
    e.value = 'MY OWN WORK'; e.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('help-welcome').click();
  });
  check('the reopened card does not focus the sample button',
        await first.evaluate(() => document.activeElement?.id) !== 'welcome-sample',
        await first.evaluate(() => document.activeElement?.id));
  await first.click('#welcome-sample');
  await first.waitForTimeout(300);
  check('a dismissed confirm leaves the project alone',
        await first.evaluate(() => window.DeadSignalStudio.store.get('tabs.video.v-text')) === 'MY OWN WORK');
  check('…and the outgoing project is stashed on a real load', await first.evaluate(async () => {
    window.confirm = () => true;                       // accept this one
    const W = await import('./src/ui/welcome.js');
    W.loadSample();
    const stash = JSON.parse(localStorage.getItem('deadsignal.studio.previous-project') || 'null');
    return stash?.tabs?.video?.['v-text'] === 'MY OWN WORK';
  }));
  await first.close();
}

/* ------------------------------------------------------------ filter chain -- */
/* The composable chain: order is the feature, so most of these are about the
   chain being a chain rather than a set of toggles. */
{
  await page.click('.tab[data-view="video"]');
  const chain = () => page.evaluate(() =>
    (window.DeadSignalStudio.store.get('filters.video') || []).map(f => f.id + (f.enabled ? '' : ':off')));
  const frame = () => page.evaluate(() => {
    const S = window.DeadSignalStudio, cfg = S.readVideoCfg();
    const c = document.createElement('canvas'); c.width = cfg.W; c.height = cfg.H;
    S.renderVideoFrame(c.getContext('2d'), cfg.W, cfg.H, cfg, 2.0);
    const d = c.getContext('2d').getImageData(0, 0, cfg.W, cfg.H).data;
    let h = 2166136261;
    for (let i = 0; i < d.length; i += 7) { h ^= d[i]; h = Math.imul(h, 16777619); }
    return h >>> 0;
  });

  await page.evaluate(() => window.DeadSignalStudio.store.apply(
    { op: 'set', path: 'filters.video', value: [], label: 'reset for test' }));
  await page.waitForTimeout(150);

  const picker = await page.evaluate(() => ({
    options: document.querySelectorAll('#v-filters-pick option').length,
    groups: [...document.querySelectorAll('#v-filters-pick optgroup')].map(o => o.label),
  }));
  check('the filter picker is populated and grouped',
        picker.options >= 20 && picker.groups.length >= 4,
        `${picker.options} filters in ${picker.groups.length} groups`);

  // An empty chain must be a true no-op, or adding the feature would have
  // changed every existing project's look.
  const bare = await frame();
  await page.evaluate(() => window.DeadSignalStudio.store.apply(
    { op: 'set', path: 'filters.video', value: [{ id: 'blur', params: {}, enabled: false }] }));
  await page.waitForTimeout(120);
  check('a bypassed filter renders identically to no filter', await frame() === bare);

  await page.selectOption('#v-filters-pick', 'duotone');
  await clickControl('#v-filters-add');
  await page.waitForTimeout(200);
  await page.selectOption('#v-filters-pick', 'mosaic');
  await clickControl('#v-filters-add');
  await page.waitForTimeout(300);
  const added = await chain();
  check('adding filters builds a chain in order',
        added.slice(-2).join(',') === 'duotone,mosaic', added.join(','));
  check('each step renders its own parameter controls',
        await page.evaluate(() => document.querySelectorAll('#v-filters-list input[data-key]').length) >= 4);

  const beforeSwap = await frame();
  await page.click('#v-filters-list .filter-row:last-child button[data-act="up"]');
  await page.waitForTimeout(300);
  const swapped = await chain();
  check('the arrows reorder the chain',
        swapped.slice(-2).join(',') === 'mosaic,duotone', swapped.join(','));
  // The entire justification for a chain instead of checkboxes.
  check('running the same filters in the other order is a different picture',
        await frame() !== beforeSwap);

  const beforeBypass = await frame();
  await page.click('#v-filters-list .filter-row:last-child button[data-act="toggle"]');
  await page.waitForTimeout(250);
  check('bypass keeps the step but changes the render',
        (await chain()).join(',').includes(':off') && await frame() !== beforeBypass);

  // A parameter drag has to reach the document and stay one undo entry.
  const depth0 = await page.evaluate(() => window.DeadSignalStudio.store.undoDepth);
  await page.evaluate(() => {
    const el = document.querySelector('#v-filters-list input[type=range][data-key]');
    for (const v of [10, 20, 30, 40]) { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await page.waitForTimeout(300);
  const dragged = await page.evaluate(() => ({
    depth: window.DeadSignalStudio.store.undoDepth,
    params: window.DeadSignalStudio.store.get('filters.video')[0].params,
  }));
  check('a parameter drag reaches the document', Object.keys(dragged.params).length > 0,
        JSON.stringify(dragged.params));
  check('…and collapses to one undo entry', dragged.depth - depth0 === 1,
        `${dragged.depth - depth0} entries`);

  await page.evaluate(() => window.DeadSignalStudio.flushAutosave());
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.studio === 'ready');
  await page.waitForFunction(() => (window.DeadSignalStudio.store?.get('filters.video') || []).length > 0,
                             null, { timeout: 8000 }).catch(() => {});
  check('the chain survives a reload', (await chain()).length >= 2, (await chain()).join(','));
  // Wait on the PANEL, not the document: the restore is async and the row
  // count is what actually proves the panel re-read it.
  const redrew = await page.waitForFunction(
    () => document.querySelectorAll('#v-filters-list .filter-row').length >= 2,
    null, { timeout: 8000 },
  ).then(() => true).catch(() => false);
  check('…and the panel redraws from it', redrew,
        JSON.stringify(await page.evaluate(() => ({
          rows: document.querySelectorAll('#v-filters-list .filter-row').length,
          listEl: !!document.getElementById('v-filters-list'),
          listHtml: (document.getElementById('v-filters-list')?.innerHTML || '').slice(0, 60),
          doc: (window.DeadSignalStudio.store.get('filters.video') || []).length,
          tab: document.querySelector('.tab.active')?.dataset.view,
        }))));

  // A clip has to carry the chain it was made with, like it carries layers.
  await page.click('.tab[data-view="timeline"]');
  await page.click('#tl-add');
  await page.waitForTimeout(400);
  check('a timeline clip captures its filter chain',
        await page.evaluate(() => (window.DeadSignalStudio.store.get('timeline.clips').at(-1)?.rec?.__filters || []).length) >= 2);

  await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    S.store.apply({ op: 'set', path: 'filters.video', value: [] });
    S.store.apply({ op: 'set', path: 'timeline.clips', value: [] });
  });
  await page.click('.tab[data-view="video"]');
  await page.waitForTimeout(200);
}

/* ---------------------------------------------------- every filter draws -- */
{
  await page.click('.tab[data-view="video"]');
  const ids = await page.evaluate(() => [...document.querySelectorAll('#v-filters-pick option')].map(o => o.value));
  const inert = await page.evaluate(async (ids) => {
    const S = window.DeadSignalStudio;
    const { FILTERS } = await import('./src/fx/filters.js');
    const shot = () => {
      const cfg = S.readVideoCfg();
      const c = document.createElement('canvas'); c.width = cfg.W; c.height = cfg.H;
      S.renderVideoFrame(c.getContext('2d'), cfg.W, cfg.H, cfg, 2.0);
      const d = c.getContext('2d').getImageData(0, 0, cfg.W, cfg.H).data;
      let h = 2166136261;
      for (let i = 0; i < d.length; i += 7) { h ^= d[i]; h = Math.imul(h, 16777619); }
      return h >>> 0;
    };
    S.store.apply({ op: 'set', path: 'filters.video', value: [] });
    const base = shot();

    /* Parameters come from each filter's OWN declaration rather than one shared
       bag of every key in the tool.
     *
       The bag was wrong twice over. `levels: 4` meant Posterize's level count
       AND, once a Levels filter existed, nothing it recognised — keys are not a
       shared namespace. And the bag had grown to 44 keys against a document
       guard that keeps 24 (MAX_PARAM_KEYS), so two thirds of it was being
       dropped before it ever reached a filter: the test looked thorough and was
       running most filters on their defaults.

       Deriving from the registry also means a filter added later is exercised
       without anyone remembering to extend a list. */
    const TUNE = {
      // Timing, not intensity: pushing these toward max moves the effect
      // outside the frame being sampled instead of strengthening it.
      lower3: { in: 0, hold: 30 },
      stamp: { blink: 0 },
      streak: { threshold: 40 },
    };
    const paramsFor = (f) => {
      const o = {};
      for (const s of f.params) {
        if (TUNE[f.id] && s.key in TUNE[f.id]) { o[s.key] = TUNE[f.id][s.key]; continue; }
        if (s.kind === 'color') o[s.key] = '#ff3b6b';
        else if (s.kind === 'text') o[s.key] = 'FILTER';
        else if (s.kind === 'select') o[s.key] = s.def;
        else {
          // Away from the default, toward whichever end has room.
          const up = s.def + (s.max - s.def) * 0.4;
          o[s.key] = Math.abs(up - s.def) > 1e-6 ? up : s.def + (s.min - s.def) * 0.4;
        }
      }
      return o;
    };

    const dead = [];
    for (const id of ids) {
      const f = FILTERS[id];
      if (!f) { dead.push(id + ' (not registered)'); continue; }
      // Defaults first — that is what an author gets when they add it — then
      // pushed off the defaults, because a few are deliberately an identity
      // there (a Colour Grade that changed the picture the moment you added it
      // would be wrong).
      S.store.apply({ op: 'set', path: 'filters.video', value: [{ id, enabled: true, params: {} }] });
      if (shot() !== base) continue;
      S.store.apply({ op: 'set', path: 'filters.video', value: [{ id, enabled: true, params: paramsFor(f) }] });
      if (shot() === base) dead.push(id);
    }
    S.store.apply({ op: 'set', path: 'filters.video', value: [] });
    return dead;
  }, ids);
  check(`all ${ids.length} filters change the picture`, inert.length === 0, inert.join(', '));
}

/* --------------------------------------------------- preview under load -- */
/* The preview is main-thread work. A filter chain at a large output size costs
   a quarter of a second per frame, and scheduled straight back onto rAF that
   leaves no gap between blocks — typing one word into the Browser took six
   seconds, which is indistinguishable from the tool freezing. */
{
  await page.click('.tab[data-view="video"]');
  await setControl('v-fps', 12);
  await setControl('v-dur', 8);
  await setControl('v-w', 320);
  await setControl('v-h', 240);
  await page.evaluate(() => window.DeadSignalStudio.store.apply(
    { op: 'set', path: 'filters.video', value: [] }));
  await page.waitForTimeout(400);

  // The loop redraws on the CLIP's frame grid, not the display's: at 12fps a
  // 60Hz screen was rendering each frame five times, and showing intermediate
  // motion the export could never produce.
  const rate = await page.evaluate(async () => {
    const c = document.getElementById('vcanvas');
    const g = () => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let h = 2166136261; for (let i = 0; i < d.length; i += 97) { h ^= d[i]; h = Math.imul(h, 16777619); } return h >>> 0; };
    let last = g(), n = 0;
    const t0 = performance.now();
    // Poll on rAF so a 60Hz redraw would be counted if it were happening.
    while (performance.now() - t0 < 2000) {
      await new Promise(r => requestAnimationFrame(r));
      const h = g(); if (h !== last) { n++; last = h; }
    }
    return n / ((performance.now() - t0) / 1000);
  });
  // A 12fps clip must redraw ~12 times a second, not once per display refresh.
  // The old loop rendered every rAF tick: five identical renders per frame, and
  // continuous scenes moved more smoothly than the export ever would.
  check('the preview redraws at the clip frame rate, not the display rate',
        rate > 6 && rate < 24, `${rate.toFixed(1)} redraws/s at 12fps`);

  // The property that matters: a heavy chain must slow the PICTURE, not the
  // interface. Measured as how long a trivial main-thread turn has to wait.
  await setControl('v-w', 960);
  await setControl('v-h', 720);
  await page.evaluate(() => window.DeadSignalStudio.store.apply(
    { op: 'set', path: 'filters.video', value: [
      { id: 'edges', params: {}, enabled: true },
      { id: 'halftone', params: {}, enabled: true },
      { id: 'pixelsort', params: {}, enabled: true },
      { id: 'crosshatch', params: {}, enabled: true }] }));
  await page.evaluate(() => window.DeadSignalStudio.startVideoPreview());
  await page.waitForTimeout(1200);
  const latency = await page.evaluate(async () => {
    // Ten queued turns: without a yield they land behind back-to-back renders.
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    return Math.round(performance.now() - t0);
  });
  // Generous: the point is seconds vs not-seconds, and CI machines vary.
  check('a heavy filter chain does not lock the interface', latency < 2500, `${latency}ms for 10 turns`);
  check('…and says the preview is running slow rather than looking broken',
        /slower than real time/.test(await page.evaluate(() => document.getElementById('v-est').textContent)),
        await page.evaluate(() => document.getElementById('v-est').textContent));

  /* AND IT GIVES WAY BY RUNNING SLOW, NOT BY DROPPING THE AUTHOR'S FRAMES.
     The playhead used to be read from the wall clock, so once a frame cost more
     than 1/fps to draw — a real output size with any chain on it, exactly the
     state set up above — the next read had already moved past one or more frame
     indices and those frames were never drawn. Measured on a stock build at
     1280×720/10fps with six filters: the export writes 30 frames, the preview
     drew 14, stepping 14→17→20→23→26. Sixteen frames the author never saw.

     Not cosmetic: the effects that live on PARTICULAR frames are the ones it
     eats — the subliminal insert (one or two frames by definition), a blink
     code, the reveal, a one-frame glitch, the fade at each end. Set one, watch
     the preview, see nothing, then find it in the exported file.

     Measured on the STEP between consecutive drawn frames rather than on a
     count, so it holds however slowly the preview happens to be running: #v-time
     is written once per drawn frame, so a MutationObserver on it sees the exact
     sequence. Every step must be +1, wrapping at the end. */
  /* At 10fps and no other rate: #v-time is written as toFixed(1), so the frame
     index is only recoverable from it when one frame is exactly one tenth of a
     second. At the 12fps this panel was left on, 0.1667 and 0.25 land in
     neighbouring tenths and the reconstruction invents a 2→4 that the loop
     never made — which is how this check first failed against a correct build. */
  await setControl('v-fps', 10);
  await page.waitForTimeout(700);
  const skipping = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const cfg = S.readVideoCfg();
    const total = Math.max(1, Math.round(cfg.duration * cfg.fps));
    const el = document.getElementById('v-time');
    const order = [];
    /* One push per RECORD, not per callback. MutationObserver batches, so a
       callback that reads el.textContent once collapses two fast frames into
       one and reports a skip the loop never made — which is exactly how this
       check first failed against a correct build. */
    const mo = new MutationObserver((recs) => {
      for (const r of recs) order.push(r.addedNodes[0]?.textContent ?? el.textContent);
    });
    mo.observe(el, { childList: true, characterData: true, subtree: true });
    const pp = document.getElementById('v-playpause');
    if (pp.textContent.trim() === '▶') pp.click();
    await new Promise((r) => setTimeout(r, 4000));
    mo.disconnect();
    const idx = order.map((v) => Math.round(parseFloat(v) * cfg.fps));
    const gaps = [];
    for (let i = 1; i < idx.length; i++) {
      const step = (idx[i] - idx[i - 1] + total) % total;
      if (step !== 1 && step !== 0) gaps.push(`${idx[i - 1]}→${idx[i]}`);
    }
    return { draws: idx.length, total, gaps: gaps.slice(0, 6), gapCount: gaps.length };
  });
  check('…and shows every frame the export will write, rather than skipping ahead',
        skipping.draws > 3 && skipping.gapCount === 0,
        skipping.gapCount ? `${skipping.gapCount} skipped: ${skipping.gaps.join(', ')}`
                          : `${skipping.draws} draws, every step +1 of ${skipping.total}`);

  // Leaving the tab must clear BOTH schedulers, or a throttled loop keeps
  // running after its tab is gone (cancelAnimationFrame cannot clear a timeout).
  await page.click('.tab[data-view="audio"]');
  await page.waitForTimeout(900);
  const stopped = await page.evaluate(async () => {
    const c = document.getElementById('vcanvas');
    const g = () => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let h = 2166136261; for (let i = 0; i < d.length; i += 97) { h ^= d[i]; h = Math.imul(h, 16777619); } return h >>> 0; };
    const a = g();
    await new Promise(r => setTimeout(r, 1200));
    return a === g();
  });
  check('leaving the tab stops the throttled preview too', stopped);

  await page.click('.tab[data-view="video"]');
  await page.evaluate(() => window.DeadSignalStudio.store.apply(
    { op: 'set', path: 'filters.video', value: [] }));
  await setControl('v-w', 320);
  await setControl('v-h', 240);
  await page.waitForTimeout(300);
}

/* ------------------------------------------------------------- autosave --- */
/* The tool's promise is that the session comes back. Nothing on screen said
   whether that was true, and a failing autosave wrote one CONSOLE line per edit
   — ten ordinary edits, ten identical lines — and was otherwise invisible. So
   the author's work could stop being kept without a word they would notice. */
{
  const state = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const el = () => document.getElementById('save-state');
    S.store.apply({ op: 'set', path: 'tabs.video.v-text', value: 'autosave probe', label: 'probe' });
    await new Promise((r) => setTimeout(r, 1500));
    const healthy = { text: el()?.textContent || '', cls: el()?.className || '',
                      role: el()?.getAttribute('role') };

    /* A backend that has stopped accepting writes: a full quota, a closed
       database, a private window that revoked it mid-session. */
    const St = await import('./src/platform/storage.js');
    let fail = true, writes = 0;
    const firsts = [], recovers = [];
    const flaky = { async putDoc() { writes++; if (fail) throw new Error('QuotaExceededError'); },
                    async getDoc() { return null; } };
    const a = St.autosave(S.store, flaky, { delay: 30,
      onError: (e, o) => firsts.push(!!(o && o.first)),
      onSave: (at, o) => recovers.push(!!(o && o.recovered)) });
    for (let i = 0; i < 10; i++) {
      S.store.apply({ op: 'set', path: 'tabs.video.v-text', value: 'e' + i, label: 'probe' });
      await new Promise((r) => setTimeout(r, 60));
    }
    await new Promise((r) => setTimeout(r, 150));
    const failing = { writes, errors: firsts.length, announced: firsts.filter(Boolean).length,
                      reportsFailing: a.failing === true };
    fail = false;
    S.store.apply({ op: 'set', path: 'tabs.video.v-text', value: 'back', label: 'probe' });
    await new Promise((r) => setTimeout(r, 200));
    const recovery = { saves: recovers.length, announced: recovers.filter(Boolean).length,
                       reportsFailing: a.failing };
    a.stop();
    return { healthy, failing, recovery };
  });
  check('the header says whether this session is being saved',
        /saved/i.test(state.healthy.text) && /\bok\b/.test(state.healthy.cls),
        `${state.healthy.text} · ${state.healthy.cls}`);
  check('…as a status, not a live region reciting every save',
        state.healthy.role === 'status', String(state.healthy.role));
  /* The point of the transition flags: a broken backend fails on EVERY edit, and
     what the author needs is not that the eighth one failed — it is that saving
     stopped working, once, loudly. */
  check('a failing autosave is announced once, not once per edit',
        state.failing.errors === 10 && state.failing.announced === 1,
        `${state.failing.errors} failures, ${state.failing.announced} announced`);
  check('…and it knows it is failing while it is', state.failing.reportsFailing === true);
  check('…and recovery is announced once too',
        state.recovery.announced === 1 && state.recovery.reportsFailing === false,
        JSON.stringify(state.recovery));
}

/* --------------------------------------------------------------- reflow --- */
/* WCAG 1.4.10: content must not need scrolling in TWO directions. The page
   scrolls vertically, so nothing may force a horizontal scroll down to 320 CSS
   px — the width the criterion names.
 *
 * It did. Measured at a 500px viewport, documentElement.scrollWidth was 603:
 * four bars laid their children out in unbreakable rows (the sequence head, the
 * menubar, the transport, and the view-buttons group), and the OUTPUT fieldset's
 * W / H / FPS columns could not go below 312px because `.row label` has a 98px
 * floor — three of those plus gaps, inside a panel narrower than that, turned
 * three number boxes into a sideways scroll.
 *
 * Every tab, in its own narrow page, so a fix on one does not hide a fault on
 * another. */
{
  const narrow = await browser.newPage();
  await narrow.setViewportSize({ width: 320, height: 900 });
  await narrow.goto(PAGE, { waitUntil: 'load' });
  await narrow.waitForFunction(() => !!window.DeadSignalStudio, null, { timeout: 20000 });
  await narrow.evaluate(() => document.getElementById('welcome-close')?.click());

  const TABS = ['video', 'audio', 'image', 'timeline', 'library', 'cloud', 'help'];
  const bad = [];
  for (const t of TABS) {
    const has = await narrow.evaluate((tab) => {
      const el = document.querySelector(`.tab[data-view="${tab}"]`);
      if (el) el.click();
      return !!el;
    }, t);
    if (!has) continue;
    await narrow.waitForTimeout(250);
    const r = await narrow.evaluate(() => {
      const de = document.documentElement;
      const over = [];
      /* A wide data table inside its own overflow:auto box is not a 1.4.10
         failure — the criterion exempts content that genuinely needs a second
         dimension, and the library table is exactly that. What fails is content
         past the edge with no way to reach it, so an element is only counted
         when nothing above it scrolls. */
      const reachable = (el) => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll') return true;
        }
        return false;
      };
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const b = el.getBoundingClientRect();
        if (!b.width && !b.height) continue;
        if (b.right > de.clientWidth + 1 && !reachable(el)) {
          over.push((el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
            + (typeof el.className === 'string' && el.className
               ? '.' + el.className.trim().split(/\s+/)[0] : ''))
            + '@' + Math.round(b.right));
        }
      }
      return { scroll: de.scrollWidth, client: de.clientWidth, over: over.slice(0, 4) };
    });
    if (r.scroll > r.client + 1 || r.over.length) {
      bad.push(`${t}: scroll ${r.scroll}/${r.client} ${r.over.join(' ')}`);
    }
  }
  check('no tab needs a sideways scroll at 320px (WCAG 1.4.10)',
        bad.length === 0, bad.slice(0, 3).join(' | '));

  /* And the width it actually broke at, so a partial fix cannot pass. */
  const widths = [];
  for (const w of [360, 420, 500, 560, 700]) {
    await narrow.setViewportSize({ width: w, height: 900 });
    await narrow.waitForTimeout(200);
    const r = await narrow.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    if (r.scroll > r.client + 1) widths.push(`${w}px → ${r.scroll}`);
  }
  check('…nor at any width from 360 to 700', widths.length === 0, widths.join(', '));
  await narrow.close();
}

console.log('-'.repeat(58));
check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
server.close();

console.log(`\nDead Signal Studio smoke: ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nNeeds attention:');
  for (const f of failures) console.log('  - ' + f);
}
process.exit(fail === 0 ? 0 : 1);
