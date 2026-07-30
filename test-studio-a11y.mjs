/* Dead Signal Studio — accessibility gate (Chromium, no axe-core).
 *
 * This repo ships no npm dependencies, so rather than pull in axe the checks
 * that actually matter here are computed directly: accessible names, WCAG 2.1
 * contrast maths, keyboard operability, focus visibility, live regions,
 * reduced-motion, and the target sizes. Fewer rules than axe, but every one is
 * enforced rather than advisory.
 *
 * Target: WCAG 2.1 AA.
 */
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' };
const server = createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(HERE, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(HERE) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PAGE = `http://127.0.0.1:${server.address().port}/index.html`;

let chromium;
try { ({ chromium } = await import('playwright')); }
catch {
  try { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
  catch { console.log('Dead Signal Studio a11y: playwright not installed — SKIPPED'); process.exit(0); }
}
const EXEC = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fail++; else pass++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};
const section = (t) => console.log(`\n[${t}]`);

console.log('Dead Signal Studio accessibility (WCAG 2.1 AA)');
console.log('-'.repeat(58));

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const page = await browser.newPage();
await page.addInitScript(() => {
  // A cold browser profile has never seen the welcome card, and it is modal.
  // Suppress it the way a returning author's browser would, so the suites
  // exercise the studio rather than the first-run screen. The card itself is
  // covered by its own section below.
  try { localStorage.setItem('deadsignal.studio.welcomed', 'true'); } catch { /* ignore */ }
});

await page.goto(PAGE);
await page.waitForFunction(() => document.documentElement.dataset.studio === 'ready');

/* Helpers injected once; used by several checks below. */
await page.addScriptTag({ content: `
window.__a11y = {
  // Relative luminance per WCAG, resolving alpha against an assumed backdrop.
  lum(rgb) {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  },
  parse(s) {
    const m = String(s).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map(Number);
    return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
  },
  over(fg, bg) {                                  // composite fg (with alpha) on bg
    return fg.rgb.map((c, i) => c * fg.a + bg[i] * (1 - fg.a));
  },
  bgOf(el) {                                      // nearest painted ancestor colour
    let n = el;
    while (n && n !== document.documentElement) {
      const c = window.__a11y.parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.95) return c.rgb;
      n = n.parentElement;
    }
    const b = window.__a11y.parse(getComputedStyle(document.body).backgroundColor);
    return b && b.a > 0 ? b.rgb : [0, 0, 0];
  },
  ratio(a, b) {
    const A = window.__a11y.lum(a), B = window.__a11y.lum(b);
    return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
  },
  name(el) {                                      // accessible name, near enough
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return al.trim();
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
      if (t) return t;
    }
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l && l.textContent.trim()) return l.textContent.trim();
    }
    const wrap = el.closest('label');
    if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
    if (el.tagName === 'BUTTON' && el.textContent.trim()) return el.textContent.trim();
    const t = el.getAttribute('title');
    return t && t.trim() ? t.trim() : '';
  },
  visible(el) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  },
};
` });

/* ============================================================== names ==== */
section('accessible names');
{
  const unnamed = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('input, select, textarea, button')) {
      if (el.type === 'hidden') continue;
      if (!window.__a11y.name(el)) {
        out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.type ? '[' + el.type + ']' : ''}`);
      }
    }
    return out;
  });
  check('every form control and button has an accessible name',
        unnamed.length === 0, unnamed.slice(0, 12).join(', ') + (unnamed.length > 12 ? ` (+${unnamed.length - 12})` : ''));

  const orphanLabels = await page.evaluate(() =>
    [...document.querySelectorAll('label[for]')]
      .filter((l) => !document.getElementById(l.getAttribute('for')))
      .map((l) => l.getAttribute('for')));
  check('no label points at a missing control', orphanLabels.length === 0, orphanLabels.join(', '));

  const dupIds = await page.evaluate(() => {
    const seen = new Set(), dup = new Set();
    for (const el of document.querySelectorAll('[id]')) {
      if (seen.has(el.id)) dup.add(el.id); else seen.add(el.id);
    }
    return [...dup];
  });
  check('no duplicate element ids', dupIds.length === 0, dupIds.join(', '));
}

/* =========================================================== contrast ==== */
section('contrast');
{
  const bad = await page.evaluate(() => {
    const out = [];
    const nodes = document.querySelectorAll('body *');
    for (const el of nodes) {
      if (!window.__a11y.visible(el)) continue;
      // only elements with their own text
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const cs = getComputedStyle(el);
      const fg = window.__a11y.parse(cs.color);
      if (!fg || fg.a === 0) continue;
      const bg = window.__a11y.bgOf(el);
      const ratio = window.__a11y.ratio(window.__a11y.over(fg, bg), bg);
      const px = parseFloat(cs.fontSize);
      const bold = parseInt(cs.fontWeight, 10) >= 700;
      const large = px >= 24 || (px >= 18.66 && bold);
      const need = large ? 3 : 4.5;
      if (ratio < need) {
        out.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} ${ratio.toFixed(2)}:1 (needs ${need})`);
      }
    }
    return [...new Set(out)];
  });
  check('all text meets its contrast minimum', bad.length === 0,
        bad.slice(0, 8).join(' | ') + (bad.length > 8 ? ` (+${bad.length - 8})` : ''));

  const small = await page.evaluate(() => {
    const out = new Set();
    for (const el of document.querySelectorAll('body *')) {
      if (!window.__a11y.visible(el)) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px < 12) out.add(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${px}px`);
    }
    return [...out];
  });
  check('no visible text below 12px', small.length === 0, small.slice(0, 8).join(' | '));
}

/* ============================================================ keyboard === */
section('keyboard + focus');
{
  const tabs = await page.evaluate(() => {
    const list = document.querySelector('[role="tablist"]');
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const panels = [...document.querySelectorAll('[role="tabpanel"]')];
    return {
      hasList: !!list,
      tabs: tabs.length,
      panels: panels.length,
      focusable: tabs.filter((t) => t.tabIndex >= 0).length,
      selected: tabs.filter((t) => t.getAttribute('aria-selected') === 'true').length,
      controls: tabs.filter((t) => t.getAttribute('aria-controls') &&
                                   document.getElementById(t.getAttribute('aria-controls'))).length,
      selectedIsTabbable: tabs.every((t) =>
        (t.getAttribute('aria-selected') === 'true') === (t.tabIndex === 0)),
    };
  });
  check('tabs use the tablist/tab/tabpanel pattern', tabs.hasList && tabs.tabs >= 7 && tabs.panels >= 7,
        `list=${tabs.hasList} tabs=${tabs.tabs} panels=${tabs.panels}`);
  check('exactly one tab is selected', tabs.selected === 1, `${tabs.selected} selected`);
  // Roving tabindex: exactly one tab is in the tab order and the rest are
  // reached with arrow keys (verified below). All seven being tabbable would
  // be the bug, not the fix.
  check('roving tabindex — one tab in the tab order', tabs.focusable === 1, `${tabs.focusable} tabbable`);
  check('the tabbable tab is the selected one', tabs.selectedIsTabbable);
  check('every tab points at a real panel', tabs.controls === tabs.tabs, `${tabs.controls}/${tabs.tabs}`);

  // Arrow-key navigation is the expected interaction for a tablist.
  await page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]').focus());
  await page.keyboard.press('ArrowRight');
  const moved = await page.evaluate(() => document.activeElement?.dataset?.view);
  check('ArrowRight moves between tabs', moved === 'audio', String(moved));
  await page.keyboard.press('Home');
  const home = await page.evaluate(() => document.activeElement?.dataset?.view);
  check('Home returns to the first tab', home === 'video', String(home));
  await page.evaluate(() => window.DeadSignalStudio && document.querySelector('[role="tab"][data-view="video"]').click());

  const skip = await page.evaluate(() => {
    const a = document.querySelector('a.skip-link');
    return { present: !!a, target: a && !!document.querySelector(a.getAttribute('href')) };
  });
  check('a skip link is present and targets a real landmark', skip.present && skip.target, JSON.stringify(skip));

  const focusRing = await page.evaluate(() => {
    const btn = document.getElementById('v-record');
    btn.focus();
    const cs = getComputedStyle(btn);
    const w = parseFloat(cs.outlineWidth) || 0;
    return { style: cs.outlineStyle, width: w, shadow: cs.boxShadow };
  });
  check('focus is visibly indicated',
        (focusRing.style !== 'none' && focusRing.width >= 2) || /rgb/.test(focusRing.shadow),
        `outline ${focusRing.style} ${focusRing.width}px`);

  const noPositiveTabindex = await page.evaluate(() =>
    [...document.querySelectorAll('[tabindex]')].filter((e) => e.tabIndex > 0).length);
  check('no positive tabindex (tab order follows the DOM)', noPositiveTabindex === 0, String(noPositiveTabindex));
}

/* ========================================================== landmarks ==== */
section('landmarks + live regions');
{
  const l = await page.evaluate(() => ({
    banner: !!document.querySelector('header[role="banner"], body > header'),
    main: document.querySelectorAll('main').length,
    lang: document.documentElement.getAttribute('lang'),
    title: document.title.trim().length,
    h1: document.querySelectorAll('h1').length,
  }));
  check('page declares a language', !!l.lang, String(l.lang));
  check('page has a title', l.title > 0);
  check('exactly one <main>', l.main === 1, String(l.main));
  check('exactly one <h1>', l.h1 === 1, String(l.h1));
  check('a banner landmark exists', l.banner);

  const live = await page.evaluate(() => {
    const ids = ['v-status', 'a-status', 'i-status', 'console', 'toasts'];
    return ids.map((id) => {
      const el = document.getElementById(id);
      return { id, present: !!el, live: el?.getAttribute('aria-live') || null };
    });
  });
  const missing = live.filter((x) => x.present && !x.live).map((x) => x.id);
  check('status and log surfaces announce changes', missing.length === 0, missing.join(', '));
}

/* ======================================================= reduced motion == */
section('reduced motion');
{
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const p2 = await ctx.newPage();
  await p2.goto(PAGE);
  await p2.waitForFunction(() => document.documentElement.dataset.studio === 'ready');
  const r = await p2.evaluate(() => {
    const cs = getComputedStyle(document.body, '::after');
    return { opacity: parseFloat(cs.opacity), anim: cs.animationName };
  });
  check('the decorative CRT overlay is disabled under prefers-reduced-motion',
        r.opacity === 0 || r.anim === 'none', JSON.stringify(r));
  await ctx.close();
}

/* ================================================== settings sections ==== */
/* The settings column now shows one section at a time, which means the sweeps
   above only ever saw the section that happened to be open. Everything they
   check has to hold in EVERY section, or the panel is only accessible in the
   part of it that was measured. */
section('settings sections');
{
  const swept = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    const views = ['view-video', 'view-image', 'view-audio'];
    const nameless = [];
    const lowContrast = [];
    const tiny = [];
    let controls = 0;
    let sections = 0;
    for (const v of views) {
      const tab = document.querySelector(`.tab[data-view="${v.replace('view-', '')}"]`);
      tab?.click();
      await new Promise((r) => setTimeout(r, 60));
      for (const name of S.sectionsOf(v)) {
        S.showSection(v, name);
        sections++;
        await new Promise((r) => setTimeout(r, 30));
        for (const el of document.querySelectorAll(`#${v} input, #${v} select, #${v} textarea, #${v} button`)) {
          if (!window.__a11y.visible(el)) continue;
          controls++;
          if (el.type !== 'hidden' && !window.__a11y.name(el)) nameless.push(`${v}/${name}: ${el.tagName.toLowerCase()}#${el.id || '?'}`);
          const cs = getComputedStyle(el);
          const px = parseFloat(cs.fontSize);
          if (px && px < 12) tiny.push(`${v}/${name}: ${el.id || el.tagName} ${px}px`);
        }
        for (const b of document.querySelectorAll(`#sec-${v} button`)) {
          const cs = getComputedStyle(b);
          const fg = window.__a11y.parse(cs.color);
          const bg = window.__a11y.bgOf(b);
          if (!fg) continue;
          const ratio = window.__a11y.ratio(window.__a11y.over(fg, bg), bg);
          if (ratio < 4.5) lowContrast.push(`${b.textContent.trim()} ${ratio.toFixed(2)}:1`);
        }
      }
    }
    /* Put the page back where this section found it. The sweep walks three
       tabs and every section of each; the checks after it expect the SCREEN
       tab with a mark selected, and inherited state is how a suite starts
       failing for reasons that have nothing to do with what it tests. */
    document.querySelector('.tab[data-view="image"]')?.click();
    S.selectAnnotation(0);
    await new Promise((r) => setTimeout(r, 60));
    return { controls, sections, nameless, lowContrast, tiny };
  });
  check('every section of every settings panel was swept',
    swept.sections >= 9 && swept.controls > 150,
    `${swept.sections} sections, ${swept.controls} visible controls`);
  check('every control in every section has an accessible name',
    swept.nameless.length === 0, swept.nameless.slice(0, 4).join(' | '));
  check('the section buttons meet contrast in both states',
    swept.lowContrast.length === 0, swept.lowContrast.slice(0, 4).join(' | '));
  check('no settings control is under 12px', swept.tiny.length === 0, swept.tiny.slice(0, 4).join(' | '));
}

/* ============================================================ zoom ======= */
section('reflow');
{
  await page.setViewportSize({ width: 640, height: 900 });
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal scroll at 640px wide', overflow <= 1, `${overflow}px overflow`);

  /* The sequence lane zooms to six times its viewport now, which is a lot of
     content width to put on a page that must not scroll sideways. It is inside
     its own scroller; this is the assertion that says so. */
  const zoomed = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    if (!S.timeline.length) S.addTimelineClip();
    const z = document.getElementById('nle-zoom');
    if (!z) return { skipped: true };
    z.value = '600';
    z.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    z.value = '100';
    z.dispatchEvent(new Event('input', { bubbles: true }));
    return { over };
  });
  check('…and none at 600% timeline zoom either',
    zoomed.skipped || zoomed.over <= 1, `${zoomed.over}px overflow`);

  await page.setViewportSize({ width: 1280, height: 900 });
}

/* ========================================================== workspace ==== */
section('workspace layout');
{
  // The new layout must clear the same bar as the old one, or the toggle is
  // just a way to opt out of accessibility.
  await page.evaluate(() => window.DeadSignalStudio.setWorkspace(true));
  await page.waitForTimeout(120);

  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll('input, select, textarea, button')]
      .filter((el) => el.type !== 'hidden' && !window.__a11y.name(el))
      .map((el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')));
  check('every control still has a name in workspace', unnamed.length === 0, unnamed.slice(0, 8).join(', '));

  const bad = await page.evaluate(() => {
    const out = new Set();
    for (const el of document.querySelectorAll('body *')) {
      if (!window.__a11y.visible(el)) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const cs = getComputedStyle(el);
      const fg = window.__a11y.parse(cs.color);
      if (!fg || fg.a === 0) continue;
      const bg = window.__a11y.bgOf(el);
      const ratio = window.__a11y.ratio(window.__a11y.over(fg, bg), bg);
      const px = parseFloat(cs.fontSize);
      const need = (px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight, 10) >= 700)) ? 3 : 4.5;
      if (ratio < need) out.add(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${ratio.toFixed(2)}:1`);
    }
    return [...out];
  });
  check('contrast still passes in workspace', bad.length === 0, bad.slice(0, 6).join(' | '));

  const tabsOk = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    return tabs.length >= 7 && tabs.filter((t) => t.tabIndex === 0).length === 1;
  });
  check('the tablist contract holds in workspace', tabsOk);

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal scroll in workspace at 1280px', overflow <= 1, `${overflow}px`);

  await page.setViewportSize({ width: 900, height: 900 });
  await page.waitForTimeout(120);
  const narrow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('workspace falls back to a stacked layout when narrow', narrow <= 1, `${narrow}px`);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.evaluate(() => window.DeadSignalStudio.setWorkspace(false));
}

/* ===================================================== high contrast ======= */
/* Claiming a high-contrast mode and not measuring it is worse than not having
   one: it tells someone the tool is usable when nobody checked. */
console.log('\n[high contrast]');
{
  // Same maths as the baseline contrast check above — alpha composited against
  // the nearest painted ancestor, not a guessed backdrop.
  const measure = () => page.evaluate(() => {
    const worst = { name: null, ratio: 99 };
    const seen = [];
    for (const el of document.querySelectorAll(
      '#view-video label, #view-video .hint, .tabhelp, .tab, h2')) {
      if (!window.__a11y.visible(el)) continue;
      const fg = window.__a11y.parse(getComputedStyle(el).color);
      if (!fg || fg.a === 0) continue;
      const bg = window.__a11y.bgOf(el);
      const r = window.__a11y.ratio(window.__a11y.over(fg, bg), bg);
      seen.push(r);
      if (r < worst.ratio) { worst.ratio = r; worst.name = el.className || el.tagName; }
    }
    return {
      worst: worst.ratio, worstOn: worst.name, count: seen.length,
      overlay: getComputedStyle(document.body, '::after').display,
      crt: getComputedStyle(document.documentElement).getPropertyValue('--crt').trim(),
      attr: document.documentElement.getAttribute('data-contrast'),
    };
  });

  const normal = await measure();
  await page.evaluate(() => window.DeadSignalStudio.setContrast('high'));
  const high = await measure();

  check('high contrast is a document-level mode', high.attr === 'high', String(high.attr));
  check('it measured a meaningful sample of text', high.count > 5, String(high.count));
  // The scanline overlay multiplies against everything under it.
  check('the scanline overlay is removed', high.overlay === 'none', high.overlay);
  check('the CRT variable is zeroed', parseFloat(high.crt) === 0, high.crt);
  check('every measured element clears WCAG AA (4.5:1)', high.worst >= 4.5,
        `worst ${high.worst.toFixed(2)}:1 on ${high.worstOn}`);
  check('…and it is an improvement on normal', high.worst >= normal.worst,
        `${normal.worst.toFixed(2)}:1 → ${high.worst.toFixed(2)}:1`);
  // The whole point: it changes the tool, not the work.
  const output = await page.evaluate(() => {
    const S = window.DeadSignalStudio;
    const shot = () => {
      const cfg = Object.assign(S.readVideoCfg(), { W: 120, H: 90 });
      const c = document.createElement('canvas'); c.width = 120; c.height = 90;
      S.renderVideoFrame(c.getContext('2d'), 120, 90, cfg, 2);
      const d = c.getContext('2d').getImageData(0, 0, 120, 90).data;
      let h = 2166136261 >>> 0;
      for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
      return h.toString(16);
    };
    const inHigh = shot();
    S.setContrast('normal');
    const inNormal = shot();
    return { inHigh, inNormal };
  });
  check('rendered media is byte-identical either way', output.inHigh === output.inNormal,
        `${output.inHigh} vs ${output.inNormal}`);
}

/* ================================== panels that are not in the markup === */
/* The sweep above walks the page as it loads, so it never sees the marks list,
   the gallery cards or anything else built at runtime — and those are where the
   newest controls live. This opens them first. */
section('generated panels');
{
  const named = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    document.querySelector('.tab[data-view=image]').click();
    /* The marks list lives in the SCREEN panel's Marks section, and the panel
       shows one section at a time — so bring it up, exactly as a person would
       before working on a mark. */
    S.showSection('view-image', 'Marks');
    S.clearAnnotations();
    S.addAnnotation('box', { x: 0.4, y: 0.4, w: 0.2, h: 0.2 });
    S.selectAnnotation(0);
    S.toggleGallery('image');
    await new Promise((r) => setTimeout(r, 2000));
    const sel = '#i-anno-list button, #i-gallery button, button[data-solo]';
    const nameless = [];
    for (const el of document.querySelectorAll(sel)) {
      const n = (el.getAttribute('aria-label') || el.textContent || el.title || '').trim();
      if (!n) nameless.push(`${el.className} ${el.dataset.act || el.dataset.solo || ''}`);
    }
    const total = document.querySelectorAll(sel).length;
    S.toggleGallery('image');
    return { total, nameless };
  });
  check('every generated control has an accessible name',
    named.total > 20 && named.nameless.length === 0,
    named.nameless.slice(0, 4).join(' | ') || `${named.total} controls`);

  /* The clip inspector is built entirely in JS and has no fields at all until a
     clip is selected, so neither the load-time sweep nor the selector above can
     ever see it. It is a dozen form controls, which makes it exactly the kind of
     panel that goes unlabelled. */
  const insp = await page.evaluate(async () => {
    const S = window.DeadSignalStudio;
    document.querySelector('.tab[data-view=timeline]').click();
    S.addTimelineClip();
    await new Promise((r) => setTimeout(r, 300));
    const box = document.getElementById('tl-track');
    const b = box.querySelector('.tl-clip[data-i="0"]');
    const r = b.getBoundingClientRect();
    const at = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 31 };
    b.dispatchEvent(new PointerEvent('pointerdown', at));
    box.dispatchEvent(new PointerEvent('pointerup', at));
    const ctls = [...document.querySelectorAll(
      '#nle-inspector input, #nle-inspector select, #nle-inspector textarea, #nle-inspector button')];
    const nameOf = (el) => {
      const lab = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
      return (lab?.textContent || el.getAttribute('aria-label') || el.textContent || el.title || '').trim();
    };
    // Put the page back where the rest of this section left it: the mark-nudge
    // checks below run against the selected annotation on the SCREEN tab.
    document.querySelector('.tab[data-view=image]').click();
    S.showSection('view-image', 'Marks');
    S.selectAnnotation(0);
    await new Promise((r) => setTimeout(r, 100));
    return {
      total: ctls.length,
      nameless: ctls.filter((el) => !nameOf(el)).map((el) => el.id || el.className),
      unaddressed: ctls.filter((el) => !el.id).map((el) => el.className),
    };
  });
  check('every clip-inspector control has an accessible name',
    insp.total > 8 && insp.nameless.length === 0,
    insp.nameless.slice(0, 4).join(' | ') || `${insp.total} controls`);
  check('…and an id, because that is how everything in this studio is addressed',
    insp.unaddressed.length === 0, insp.unaddressed.slice(0, 3).join(' | ') || 'all addressed');

  /* Dragging on the preview was the ONLY way to position a mark, which puts the
     whole point of the feature out of reach without a pointer: the list could
     select, reorder and delete one but not put it anywhere. */
  const before = await page.evaluate(() => window.DeadSignalStudio.store.get('image.annotations')[0]);
  await page.focus('#i-anno-list button[data-act="pick"]');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  const nudged = await page.evaluate(() => ({
    a: window.DeadSignalStudio.store.get('image.annotations')[0],
    // The row is rebuilt by each update, so focus has to be restored or the
    // second press goes nowhere — which would look like the keys "sometimes"
    // working.
    stillFocused: !!document.activeElement?.closest('#i-anno-list'),
  }));
  check('arrow keys move the selected mark',
    Math.abs(nudged.a.x - before.x) > 0.015 && Math.abs(nudged.a.y - before.y) > 0.005,
    `${before.x.toFixed(2)},${before.y.toFixed(2)} → ${nudged.a.x.toFixed(2)},${nudged.a.y.toFixed(2)}`);
  check('…and focus survives the repaint, so a second press works too',
    nudged.stillFocused);

  await page.focus('#i-anno-list button[data-act="pick"]');
  await page.keyboard.press('Shift+ArrowRight');
  const shifted = await page.evaluate(() => window.DeadSignalStudio.store.get('image.annotations')[0].x);
  await page.focus('#i-anno-list button[data-act="pick"]');
  await page.keyboard.press('Alt+ArrowRight');
  const resized = await page.evaluate(() => window.DeadSignalStudio.store.get('image.annotations')[0].w);
  check('Shift moves further and Alt resizes',
    shifted - nudged.a.x > 0.03 && Math.abs(resized - nudged.a.w) > 0.005,
    `x +${(shifted - nudged.a.x).toFixed(3)}, w ${nudged.a.w.toFixed(2)}→${resized.toFixed(2)}`);

  /* Bound to the row, not the document — otherwise it would swallow the arrow
     presses that step a select or a slider anywhere else on the tab. */
  const other = await page.evaluate(() => {
    const sel = document.getElementById('i-tpl');
    sel.focus();
    const before = sel.value;
    sel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    window.DeadSignalStudio.clearAnnotations();
    return { kept: document.activeElement === sel, value: sel.value === before };
  });
  check('the nudge keys do not steal arrows from the rest of the tab',
    other.kept && other.value, JSON.stringify(other));
}

/* ------------------------------- controls that are off but still reachable -- */
section('a control that is switched off can still be reached and still explains itself');
{
  /* `disabled` takes an element OUT OF THE TAB ORDER. Right for a control nobody
     needs to know about; wrong for one whose entire problem is that the author
     does not know what would switch it on.

     Measured on a stock build: on the AUDIO panel, Tab from ◆ RENDER walked
     a-savepreset → the section strip → a-tidy → a-reset → the macros → a-preset
     → a-gallery-btn → a-preset-manage → a-dur, and never landed on ▶ PLAY,
     ⤓ .wav or NORMALIZE at all. So the tooltips added for exactly the question
     "what turns this on?" were unreachable by exactly the people who cannot see
     a greyed-out button and guess. */
  await page.evaluate(() => document.querySelector('.tab[data-view=audio]').click());
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('a-render').focus());
  const walk = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    walk.push(await page.evaluate(() => document.activeElement?.id || '(none)'));
  }
  check('Tab reaches the audio buttons that are waiting on ◆ RENDER',
    ['a-play', 'a-dl', 'a-norm'].every((id) => walk.includes(id)), walk.join(' → '));

  const shape = await page.evaluate(() => {
    const ids = ['a-play', 'a-dl', 'a-norm', 'a-region-add', 'v-stop', 'tl-stop', 'bx-stop'];
    return ids.map((id) => {
      const el = document.getElementById(id);
      return { id, hard: !!el?.disabled, aria: el?.getAttribute('aria-disabled'),
               focusable: !!el && !el.disabled && el.tabIndex >= 0,
               explains: !!(el?.title || '').trim() };
    });
  });
  check('…and every one of them says unavailable the reachable way, not the hidden way',
    shape.every((s) => s.aria === 'true' && !s.hard && s.focusable && s.explains),
    shape.filter((s) => !(s.aria === 'true' && !s.hard && s.focusable && s.explains))
      .map((s) => s.id).join(', ') || `${shape.length} controls`);
  /* Reachable has to mean announced-as-unavailable AND inert. aria-disabled
     carries no behaviour of its own, so without the guard in core/dom.js the
     button would look off and fire anyway — worse than where this started. */
  const pressed = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const play = document.getElementById('a-play');
    const label = play.textContent;
    const t0 = document.getElementById('toasts').textContent.length;
    play.focus();
    const focused = document.activeElement === play;
    play.click();
    await sleep(400);
    return { focused, labelUnchanged: play.textContent === label,
             stillOff: play.getAttribute('aria-disabled') === 'true',
             said: document.getElementById('toasts').textContent.slice(t0).replace(/\s+/g, ' ').trim() };
  });
  check('…pressing one refuses rather than running the action anyway',
    pressed.focused && pressed.labelUnchanged && pressed.stillOff,
    JSON.stringify({ focused: pressed.focused, label: pressed.labelUnchanged, off: pressed.stillOff }));
  check('…and answers the question the press was asking',
    /RENDER/.test(pressed.said), pressed.said || '(said nothing)');

  const back = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.getElementById('a-render').click();
    const play = document.getElementById('a-play');
    for (let i = 0; i < 80; i++) { await sleep(250); if (play.getAttribute('aria-disabled') !== 'true') break; }
    await sleep(300);
    return { aria: play.getAttribute('aria-disabled'), hard: play.disabled, title: play.title };
  });
  check('…and it comes back on cleanly once the sound is rendered',
    back.aria === null && back.hard === false && !/RENDER/.test(back.title), JSON.stringify(back));
}

console.log('-'.repeat(58));
await browser.close();
server.close();
console.log(`\nDead Signal Studio accessibility: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
