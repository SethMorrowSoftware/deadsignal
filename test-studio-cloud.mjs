/* Dead Signal Studio — CLOUD client against a LIVE backend (Chromium).
 *
 * The other browser suites run the studio standalone, with no API. This one
 * drives the CLOUD tab against a real server and a real database: sign in,
 * save, re-open, upload the library through the chunked path, and follow a
 * share link as someone with no account at all.
 *
 * Not in scripts/ci-gate.sh, for the same reason test-studio-api.php is not —
 * it needs a live server + MySQL. Run it like this:
 *
 *   php -S 127.0.0.1:8090 tools/media-studio/router.php   # from the repo root
 *   node tools/media-studio/test-studio-cloud.mjs [base-url] [studio-path]
 *
 * (router.php is what gives the built-in server the rewrite that api/.htaccess
 * gives Apache. Without it every API call 404s and this suite skips.)
 *
 * Both arguments matter for deployment testing: [base-url] may itself be a
 * subdirectory (http://host/sub), and [studio-path] locates the studio folder
 * within it — the studio is a folder people relocate, and this suite has to be
 * able to follow it there.
 *
 * It found a real bug the standalone suites could not: the read-only banner
 * for a share-link reader was rendered after the not-signed-in early return,
 * so the one person who needed it never saw it.
 */
let chromium;
try { ({ chromium } = await import('playwright')); }
catch {
  try { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
  catch { console.log('CLOUD client: playwright not installed — SKIPPED'); process.exit(0); }
}
const BASE = (process.argv[2] || 'http://127.0.0.1:8090').replace(/\/+$/, '');
const PAGE = BASE + (process.argv[3] || '/tools/media-studio/index.html');
/* The API ships inside the studio folder, so it is found relative to the page —
   not at the origin root. Deriving it here rather than hardcoding is the same
   rule the client follows, and it is what lets this suite run against a studio
   installed in a subdirectory. */
const STUDIO_URL = PAGE.replace(/\/[^/]*$/, '');
/* Both forms the client itself tries: the rewritten path, then the front
   controller's own filename for a host that will not honour api/.htaccess.
   Checking only the first skipped this suite on a host where the studio works
   perfectly well. */
const HEALTHS = [STUDIO_URL + '/api/system/health', STUDIO_URL + '/api/index.php/system/health'];

// A missing server is a skip, not a failure: this suite is opt-in.
let live = null;
for (const u of HEALTHS) {
  try {
    const h = await (await fetch(u)).json();
    if (h.database === 'connected') { live = u; break; }
  } catch { /* try the next form */ }
}
if (!live) {
  console.log('CLOUD client: no live backend at ' + HEALTHS[0] + ' — SKIPPED');
  console.log('  start one with:  php -S 127.0.0.1:8090 tools/media-studio/router.php');
  process.exit(0);
}

let pass=0, fail=0; const fails=[];
const ok=(n,c,e='')=>{ if(c)pass++; else {fail++; fails.push(n+(e?' — '+e:''));}
  console.log(`  ${c?'PASS':'FAIL'}  ${n}${e?' — '+e:''}`); };
import { existsSync } from 'node:fs';
const EXEC = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((x) => existsSync(x));
const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const p = await b.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
/* One persistent handler. Stacking p.once() per click means an unconsumed
   handler survives and the next one throws "already handled". */
p.on('dialog', d => d.accept().catch(()=>{}));
await p.addInitScript(()=>{ try{localStorage.setItem('deadsignal.studio.welcomed','true');}catch{} });
await p.goto(PAGE);
await p.waitForFunction(()=>window.DeadSignalStudio);
await p.click('.tab[data-view="cloud"]');
await p.waitForTimeout(1200);

console.log('\n[probe]');
ok('the API base is derived from where the studio is served',
   /\/api(\/index\.php)?$/.test(await p.inputValue('#cloud-apibase')), await p.inputValue('#cloud-apibase'));
ok('…and it is inside the studio folder, never the root domain',
   (await p.inputValue('#cloud-apibase')).startsWith(STUDIO_URL + '/'), await p.inputValue('#cloud-apibase'));
ok('a reachable backend is detected',
   /Sign in to sync/i.test(await p.textContent('#cloud-status')), (await p.textContent('#cloud-status')).slice(0,80));

console.log('\n[sign in]');
const NAME = 'cloud_'+Math.random().toString(36).slice(2,8);
/* Fixture calls go through the base the STUDIO resolved, not a root-absolute
   path — otherwise this suite silently only works at the docroot, which is
   exactly the assumption the client stopped making. */
const API_BASE = (await p.inputValue('#cloud-apibase')).replace(/\/+$/,'');
/* The account is made the only way accounts are made: from the server. There is
   no sign-up endpoint to call, deliberately — so this suite exercises the same
   path an operator uses, and a regression that breaks account creation breaks
   this test too. */
const { execFileSync } = await import('node:child_process');
const SERVER_DIR = new URL('./server/', import.meta.url).pathname;
let made = false;
try {
  execFileSync('php', [SERVER_DIR + 'account.php', 'add', NAME, 'CorrectHorse1'], { stdio: 'pipe' });
  made = true;
} catch (e) {
  console.log('CLOUD client: could not create a test account — SKIPPED');
  console.log('  ' + String(e.stderr || e.message).trim());
  await b.close();
  process.exit(0);
}
await p.fill('#cloud-user', NAME);
await p.fill('#cloud-pass', 'CorrectHorse1');
await p.click('#cloud-signin');
await p.waitForTimeout(1500);
ok('signing in through the panel works',
   /Signed in/.test(await p.textContent('#cloud-status')), (await p.textContent('#cloud-status')).slice(0,90));
ok('the sign-in form is replaced by sign-out',
   await p.isHidden('#cloud-auth') && await p.isVisible('#cloud-signout'));

console.log('\n[enter submits]');
/* The sign-in panel is a real <form> now, so Enter in either field must submit
   through the existing sign-in handler WITHOUT navigating — pre-fix Enter did
   nothing (or reloaded the page, losing the session). Sign out first, then
   sign back in with Enter alone. */
await p.click('#cloud-signout');
await p.waitForTimeout(800);
await p.fill('#cloud-user', NAME);
await p.fill('#cloud-pass', 'CorrectHorse1');
await p.press('#cloud-pass', 'Enter');
await p.waitForTimeout(1500);
ok('Enter in the password field signs in (form did not navigate)',
   /Signed in/.test(await p.textContent('#cloud-status')) && await p.isHidden('#cloud-auth'),
   (await p.textContent('#cloud-status')).slice(0,90));

console.log('\n[save + open]');
await p.evaluate(()=>{ const el=document.getElementById('v-text'); el.value='CLOUD ROUND TRIP';
  el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); });
await p.fill('#cloud-name','Round Trip');
await p.click('#cloud-save');
await p.waitForTimeout(1500);
const rows = await p.$$eval('#cloud-projects tbody tr', r=>r.map(x=>x.textContent));
ok('saving creates a server project', rows.length===1 && /Round Trip/.test(rows[0]), JSON.stringify(rows));
ok('…and it is marked as open', /open/.test(rows[0]||''));

// change locally, then re-open from the server: the server copy must come back
await p.evaluate(()=>{ const el=document.getElementById('v-text'); el.value='LOCAL EDIT';
  el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); });
await p.click('#cloud-projects button[data-open]');
await p.waitForTimeout(1500);
ok('opening from the server restores the saved document',
   await p.inputValue('#v-text')==='CLOUD ROUND TRIP', await p.inputValue('#v-text'));

console.log('\n[library upload]');
// Generate a real asset, then upload it through the chunked path.
await p.evaluate(async ()=>{
  const S=window.DeadSignalStudio;
  const c=document.createElement('canvas'); c.width=64; c.height=64;
  const x=c.getContext('2d'); x.fillStyle='#0f0'; x.fillRect(0,0,64,64);
  const blob=await new Promise(r=>c.toBlob(r,'image/png'));
  S.addToLibrary(blob,'webm','videos','uploadtest',1);
});
await p.click('#cloud-upload');
await p.waitForTimeout(3000);
const upl = await p.textContent('#cloud-upload-status');
ok('the library uploads through the chunked path', /Uploaded 1 asset/.test(upl||''), upl);
await p.click('#cloud-upload');
await p.waitForTimeout(2500);
const upl2 = await p.textContent('#cloud-upload-status');
ok('re-uploading is deduped, not re-sent', /already on the server/.test(upl2||''), upl2);

console.log('\n[share link]');
const token = await p.evaluate(async (api)=>{
  const r = await (await fetch(api+'/studio/projects',{headers:{
    'X-Requested-With':'XMLHttpRequest',
    Authorization:'Bearer '+JSON.parse(localStorage.getItem('deadsignal.studio.apiToken'))}})).json();
  const id = r.projects[0].id;
  const s = await (await fetch(api+'/studio/projects/'+id+'/shares',{method:'POST',headers:{
    'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest',
    Authorization:'Bearer '+JSON.parse(localStorage.getItem('deadsignal.studio.apiToken'))},
    body:JSON.stringify({role:'viewer'})})).json();
  return s.token;
}, API_BASE);
ok('a share token is minted', typeof token==='string' && token.length===64, String(token).slice(0,8));

// A brand-new context = no account at all. This is the case the link is FOR.
const anon = await b.newPage();
const anonErrs=[]; anon.on('pageerror',e=>anonErrs.push(String(e)));
await anon.addInitScript(()=>{ try{localStorage.setItem('deadsignal.studio.welcomed','true');}catch{} });
await anon.goto(PAGE+'#share='+token);
await anon.waitForFunction(()=>window.DeadSignalStudio);
await anon.waitForTimeout(2500);
ok('a #share= link opens the project for someone with NO account',
   await anon.inputValue('#v-text')==='CLOUD ROUND TRIP', await anon.inputValue('#v-text'));
await anon.click('.tab[data-view="cloud"]');
await anon.waitForTimeout(400);
ok('…and says it is read-only',
   /read-only/i.test(await anon.textContent('#cloud-status')), (await anon.textContent('#cloud-status')).slice(0,90));
ok('…and the token is scrubbed from the address bar',
   !(await anon.url()).includes('share='), await anon.url());
ok('no uncaught errors in the shared view', anonErrs.length===0, anonErrs.slice(0,2).join(' | '));

console.log('\n[share link vs the local session]');
/* The regression this pins: following a share link used to (1) sweep the asset
   store against the runtime library — which on a share-link boot is not the
   autosaved session's, so every locally stored byte was deleted as an
   "orphan" — and (2) leave the autosave writer running, so the SHARED document
   overwrote the reader's own 'current' slot ~800ms later. Merely clicking
   someone's link permanently destroyed the reader's own work. */
const local = await b.newPage();
const localErrs=[]; local.on('pageerror',e=>localErrs.push(String(e)));
await local.addInitScript(()=>{ try{localStorage.setItem('deadsignal.studio.welcomed','true');}catch{} });
// Visit once WITHOUT the link and plant a prior session: an autosaved doc that
// references one asset, plus that asset's bytes.
await local.goto(PAGE);
await local.waitForFunction(()=>window.DeadSignalStudio);
await local.evaluate(async ()=>{
  const be = window.DeadSignalStudio.backend;
  await be.putDoc('current', { schemaVersion: 999, marker: 'READER-OWN-WORK',
    tabs: { video: {} }, library: [{ key: 'reader-own-asset', name: 'mine', ext: 'wav', kind: 'music' }] });
  await be.putAsset('reader-own-asset', new Blob(['reader bytes']), {});
});
// Now arrive by the share link in the SAME browser profile. Via about:blank,
// because PAGE → PAGE#share=… is a fragment navigation — no reload, no boot,
// and the probe would be measuring the still-running first visit.
await local.goto('about:blank');
await local.goto(PAGE + '#share=' + token);
await local.waitForFunction(()=>window.DeadSignalStudio);
await local.waitForFunction(()=>document.getElementById('v-text') && document.getElementById('v-text').value==='CLOUD ROUND TRIP', null, { timeout: 8000 }).catch(()=>{});
ok('the share link actually opened in the probe context',
   await local.inputValue('#v-text')==='CLOUD ROUND TRIP', await local.inputValue('#v-text'));
// Long enough for boot, the share fetch, the (skipped) sweep and one full
// autosave debounce window to have done whatever they are going to do.
await local.waitForTimeout(3000);
const kept = await local.evaluate(async ()=>{
  const be = window.DeadSignalStudio.backend;
  const doc = await be.getDoc('current');
  const asset = await be.getAsset('reader-own-asset');
  return { marker: doc && doc.marker, hasAsset: !!(asset && asset.blob) };
});
ok('the reader\'s stored asset SURVIVES following a share link', kept.hasAsset === true);
ok('…and their autosaved document is untouched', kept.marker === 'READER-OWN-WORK', String(kept.marker));
// An edit made while viewing the shared project must not leak into the
// reader's autosave slot either — autosave is paused for the whole visit.
await local.evaluate(()=>{ const el=document.getElementById('v-text'); if(el){ el.value='EDIT WHILE VIEWING'; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); } });
await local.waitForTimeout(1500);
const after = await local.evaluate(async ()=>{
  const doc = await window.DeadSignalStudio.backend.getDoc('current');
  return doc && doc.marker;
});
ok('…even after editing in the shared view (autosave stays paused)', after === 'READER-OWN-WORK', String(after));
ok('no uncaught errors in the local-session probe', localErrs.length===0, localErrs.slice(0,2).join(' | '));
await local.close();

console.log('\n[version history]');
await p.click('#cloud-projects button[data-detail]');
await p.waitForTimeout(1200);
ok('the detail pane opens', await p.isVisible('#cloud-detail-panel'));
// Creating a project has nothing to snapshot — the empty state should say so
// rather than showing a bare table.
ok('a newly created project has no history yet, and says so',
   /No snapshots yet/.test(await p.textContent('#cloud-versions')),
   (await p.textContent('#cloud-versions')).slice(0,40));
await p.fill('#cloud-snap-label','before the change');
await p.click('#cloud-snapshot');
await p.waitForTimeout(1200);
ok('a named snapshot can be taken',
   (await p.$$eval('#cloud-versions tbody tr', r=>r.map(x=>x.textContent))).some(t=>/before the change/.test(t)));

// change the doc, then restore -> the saved text must come back
await p.evaluate(()=>{ const el=document.getElementById('v-text'); el.value='WRECKED IT';
  el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); });
await p.click('#cloud-save'); await p.waitForTimeout(1200);
await p.click('#cloud-versions button[data-restore]');
await p.waitForTimeout(1800);
ok('RESTORE brings the old document back into the editor',
   await p.inputValue('#v-text')!=='WRECKED IT', await p.inputValue('#v-text'));

console.log('\n[sharing UI]');
const shareRows = () => p.$$eval('#cloud-shares tbody tr', r=>r.length);
const before0 = await shareRows();
await p.selectOption('#cloud-share-role','editor');
await p.click('#cloud-share-add'); await p.waitForTimeout(800);
ok('the form refuses an editor LINK without a round trip',
   (await shareRows())===before0, before0 + ' -> ' + await shareRows());
await p.selectOption('#cloud-share-role','viewer');
await p.click('#cloud-share-add'); await p.waitForTimeout(1500);
const tokenBox = await p.$('#cloud-share-token input');
ok('the one-time link is shown in a copyable field', !!tokenBox);
const shownUrl = tokenBox ? await tokenBox.inputValue() : '';
ok('…and it is a real share URL', /#share=[a-f0-9]{64}$/.test(shownUrl), shownUrl.slice(-20));
const after0 = await shareRows();
ok('the new share is listed', after0===before0+1, before0 + ' -> ' + after0);
await p.click('#cloud-shares button[data-revoke]'); await p.waitForTimeout(1800);
ok('REVOKE removes one', (await shareRows())===after0-1, after0 + ' -> ' + await shareRows());
const dead = await p.evaluate(async ([u, api])=>{
  const t=u.split('#share=')[1];
  const r=await fetch(api+'/studio/shared/'+t); return r.status; }, [shownUrl, API_BASE]);
ok('…and the revoked link stops resolving', dead===404, dead);

console.log('\n[server assets]');
const arows = await p.$$eval('#cloud-assets tbody tr', r=>r.length);
ok('uploaded assets are listed', arows>=1, arows);
const before = await p.evaluate(()=>window.DeadSignalStudio.library.length);
await p.evaluate(()=>window.DeadSignalStudio.clearLibrary());
await p.click('#cloud-assets button[data-get]'); await p.waitForTimeout(2500);
ok('→ LIBRARY pulls the asset back down',
   (await p.evaluate(()=>window.DeadSignalStudio.library.length))===1,
   await p.evaluate(()=>window.DeadSignalStudio.library.length));
ok('…with its real bytes',
   (await p.evaluate(()=>window.DeadSignalStudio.library[0]?.blob?.size||0))>0);
await p.click('#cloud-assets button[data-rmasset]'); await p.waitForTimeout(1800);
ok('✕ deletes it from the server',
   (await p.$$eval('#cloud-assets tbody tr', r=>r.length))===0);

console.log('\n[sign out]');
await p.click('#cloud-signout');
await p.waitForTimeout(1200);
ok('signing out returns to the sign-in form',
   await p.isVisible('#cloud-auth'), await p.textContent('#cloud-status'));
ok('…and the token is gone',
   await p.evaluate(()=>!JSON.parse(localStorage.getItem('deadsignal.studio.apiToken')||'null')));

console.log('-'.repeat(58));
ok('no uncaught page errors', errs.length===0, errs.slice(0,3).join(' | '));
await b.close();
console.log(`\nCLOUD client: ${pass} passed, ${fail} failed`);
if(fails.length){ console.log('\nNeeds attention:'); fails.forEach(f=>console.log('  - '+f)); }
process.exit(fail?1:0);
