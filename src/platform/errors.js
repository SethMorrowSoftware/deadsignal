/* Dead Signal Studio — platform/errors.js
 *
 * The last silent failure.
 *
 * Every individual failure path in this tool now says what went wrong and where
 * the author can see it. What none of them cover is the one that was never
 * anticipated: an uncaught exception, or a promise nobody caught. There was no
 * `window.onerror` and no `unhandledrejection` listener anywhere, so a throw on
 * a path the suites do not walk left the interface half-wedged and completely
 * quiet — a button that stopped working, and nothing to report about it.
 *
 * The deep suite asserts "no uncaught page errors", which proves it for the
 * paths it walks. Finding the others is precisely what a beta is for, and a
 * tester can only report what the tool tells them.
 *
 * Three jobs, in order of how much they matter:
 *
 *   1. SAY SOMETHING. Once per distinct fault, not once per occurrence — a
 *      broken animation frame handler throws sixty times a second, and sixty
 *      toasts is the same as none.
 *   2. WRITE IT DOWN. Message and stack into the CONSOLE panel, where it can be
 *      read after the fact.
 *   3. MAKE IT REPORTABLE. `diagnostics()` returns one block of text naming the
 *      build, the browser, which of the platform features this tool depends on
 *      are actually present, and the faults seen this session. That is what
 *      turns "it broke" into something anyone can act on.
 *
 * Nothing here prevents the default handling: the error still reaches the
 * console and still reaches Playwright's `pageerror`, so the suites that assert
 * on uncaught errors go on working exactly as they did.
 */
import { log, toast } from '../core/dom.js';
import { BUILD } from '../core/version.js';

/** Faults seen this session, newest last. Capped: this is a report, not a log. */
const seen = [];
const announced = new Set();
const MAX_KEPT = 20;
const MAX_ANNOUNCED = 5;

let installed = null;

/** Everything after the last path separator, so stacks stay readable. */
const shortSource = (src, line, col) => {
  if (!src) return '';
  const file = String(src).split('/').pop().split('?')[0];
  return ` (${file}${line ? ':' + line : ''}${line && col ? ':' + col : ''})`;
};

function record(kind, message, stack, where) {
  const msg = String(message || 'unknown error').slice(0, 300);
  const now = new Date().toISOString().slice(11, 19);
  /* Collapsed by fault, not appended per occurrence. A handler that throws on
     every animation frame filled all twenty slots with one message inside a
     second, which pushed out the earlier and different fault that was the
     actually useful thing in the report. Count and last-seen carry the same
     information in one line. */
  const key = kind + '|' + msg + '|' + (where || '');
  let entry = seen.find((e) => e.key === key);
  if (entry) { entry.count++; entry.last = now; }
  else {
    entry = { key, kind, message: msg, where: where || '', at: now, last: now, count: 1 };
    seen.push(entry);
    if (seen.length > MAX_KEPT) seen.shift();
  }

  log(`${kind}: ${msg}${entry.where}`, 'err');
  if (stack) log(String(stack).split('\n').slice(0, 4).join(' ← ').slice(0, 400), 'err');

  /* One announcement per distinct fault. A handler that throws on every frame
     is one problem, not sixty; and after a handful of DIFFERENT faults the tool
     is clearly in trouble and more toasts add nothing. */
  if (announced.has(key) || announced.size >= MAX_ANNOUNCED) return entry;
  announced.add(key);
  toast('Something went wrong — see CONSOLE', 'err');
  if (announced.size === 1) {
    log('If you are reporting this, press ⎘ COPY DIAGNOSTICS on the HELP tab and paste the result.', 'info');
  }
  return entry;
}

/**
 * One block of text a bug report can be built from: build, browser, the
 * platform features this tool actually depends on, and the faults so far.
 */
export function diagnostics(extra = {}) {
  const yes = (v) => (v ? 'yes' : 'no');
  const feat = [];
  try { feat.push(`WebCodecs: ${yes(typeof VideoEncoder !== 'undefined')}`); } catch { feat.push('WebCodecs: no'); }
  try { feat.push(`OffscreenCanvas: ${yes(typeof OffscreenCanvas !== 'undefined')}`); } catch { feat.push('OffscreenCanvas: no'); }
  try { feat.push(`IndexedDB: ${yes(typeof indexedDB !== 'undefined' && indexedDB !== null)}`); } catch { feat.push('IndexedDB: no'); }
  try { feat.push(`MediaRecorder: ${yes(typeof MediaRecorder !== 'undefined')}`); } catch { feat.push('MediaRecorder: no'); }
  try { feat.push(`AudioContext: ${yes(typeof (window.AudioContext || window.webkitAudioContext) !== 'undefined')}`); } catch { feat.push('AudioContext: no'); }
  try {
    const c = document.createElement('canvas').getContext('2d');
    // Firefox has no canvas letterSpacing, which changes how type is set.
    feat.push(`canvas letterSpacing: ${yes(c && 'letterSpacing' in c)}`);
  } catch { feat.push('canvas letterSpacing: no'); }

  const lines = [
    BUILD,
    `when: ${new Date().toISOString()}`,
    `page: ${location.origin}${location.pathname}`,
    `secure context: ${yes(typeof isSecureContext !== 'undefined' && isSecureContext)}`,
    `browser: ${navigator.userAgent}`,
    `screen: ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio || 1}x`,
    `features: ${feat.join(' · ')}`,
  ];
  for (const k of Object.keys(extra)) lines.push(`${k}: ${extra[k]}`);
  const total = seen.reduce((n, e) => n + e.count, 0);
  lines.push(seen.length
    ? `faults this session (${seen.length} distinct, ${total} total):`
    : 'faults this session: none');
  for (const e of seen) {
    const rep = e.count > 1 ? ` ×${e.count}, last ${e.last}` : '';
    lines.push(`  [${e.at}] ${e.kind}: ${e.message}${e.where}${rep}`);
  }
  return lines.join('\n');
}

/** Faults recorded so far, for anything that wants to show them. */
export const faults = () => seen.slice();

/**
 * Start listening. Idempotent — calling it twice replaces the listeners rather
 * than stacking two, so every fault is still reported exactly once.
 */
export function installErrorReporter() {
  stopErrorReporter();

  const onError = (e) => {
    try {
      /* Resource load failures (a missing <img>, a 404 on a stylesheet) also
         fire 'error', but on the element and WITHOUT bubbling — measured: with
         this line removed a missing image still raises nothing here, because a
         non-capturing window listener never sees it. So this is not what keeps
         them out; it is the guard for the day someone adds `true` to the
         addEventListener below, which would start delivering every broken
         image as an unexplained "something went wrong". Cheap, and the reason
         it looks redundant is worth writing down. */
      if (e.target && e.target !== window && e.target.nodeType === 1) return;
      record('Unexpected error', e.message || e.error?.message, e.error?.stack,
        shortSource(e.filename, e.lineno, e.colno));
    } catch { /* the reporter must never be the thing that breaks */ }
  };
  const onRejection = (e) => {
    try {
      const r = e.reason;
      record('Unhandled promise rejection',
        r?.message || (typeof r === 'string' ? r : JSON.stringify(r)?.slice(0, 200)) || String(r),
        r?.stack, '');
    } catch { /* as above */ }
  };

  addEventListener('error', onError);
  addEventListener('unhandledrejection', onRejection);
  installed = () => {
    removeEventListener('error', onError);
    removeEventListener('unhandledrejection', onRejection);
    installed = null;
  };
  return stopErrorReporter;
}

export function stopErrorReporter() { installed?.(); }

/** Test seam: forget what has been seen, so a suite can measure a fresh run. */
export function _resetFaults() { seen.length = 0; announced.clear(); }
