/* Dead Signal Studio — doc/session.js
 *
 * The app-wide document, and the lookup that lets the existing config readers
 * (readVideoCfg / readAudioCfg / readImageCfg) become document-driven without
 * being rewritten: core/dom.js's val() / num() / chk() consult the document
 * first and fall back to the DOM only when no session is bound.
 *
 * That fallback is what keeps the headless suites working — they exercise the
 * renderers with no document at all — and it is why binding is a runtime
 * decision rather than a hard dependency.
 */

let _store = null;
/** control id -> tab name ("video" | "audio" | "image" | "timeline") */
let _index = null;

export function setSession(store, index) { _store = store; _index = index; }
export function clearSession() { _store = null; _index = null; }
export function getStore() { return _store; }
export function hasSession() { return _store !== null && _index !== null; }

/**
 * Value of a control id according to the document.
 * Returns undefined when unbound or unknown, which means "ask the DOM".
 */
export function docValue(id) {
  if (!_store || !_index) return undefined;
  if (id === 'seed') return _store.get('seed');
  if (id === 'aesthetic') return _store.get('aesthetic');
  const tab = _index.get(id);
  if (!tab) return undefined;
  const v = _store.get(`tabs.${tab}.${id}`);
  return v === undefined ? undefined : v;
}

/** Document path a control writes to. */
export function pathFor(id) {
  if (id === 'seed') return 'seed';
  if (id === 'aesthetic') return 'aesthetic';
  const tab = _index?.get(id);
  return tab ? `tabs.${tab}.${id}` : null;
}
