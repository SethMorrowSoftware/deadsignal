/* Dead Signal Studio — platform/storage.js
 *
 * One interface, two backends. Callers never branch on tier:
 *
 *   T1 (memory)     no persistence; a reload starts clean. The floor.
 *   T2 (IndexedDB)  documents and asset blobs survive a reload — this is what
 *                   retires "generated assets are lost on refresh".
 *
 * IndexedDB stores Blobs natively, which is the reason it is used rather than
 * localStorage: a 4 MB WebM is not going into a 5 MB string quota.
 */

const DB_NAME = 'dead-signal-studio';
const DB_VERSION = 1;
const DOCS = 'docs';
const ASSETS = 'assets';

/** In-memory fallback. Also what the headless suites run against. */
export class MemoryBackend {
  constructor() { this.tier = 1; this._docs = new Map(); this._assets = new Map(); }
  async putDoc(id, doc) { this._docs.set(id, doc); }
  async getDoc(id) { return this._docs.get(id) ?? null; }
  async listDocs() { return [...this._docs.keys()]; }
  async deleteDoc(id) { this._docs.delete(id); }
  async putAsset(key, blob, meta = {}) { this._assets.set(key, { blob, meta }); }
  async getAsset(key) { return this._assets.get(key) ?? null; }
  async listAssets() { return [...this._assets.keys()]; }
  async deleteAsset(key) { this._assets.delete(key); }
  async usage() {
    let bytes = 0;
    for (const { blob } of this._assets.values()) bytes += blob?.size ?? 0;
    return { assets: this._assets.size, bytes };
  }
  async close() {}
}

export class IndexedDBBackend {
  constructor(db) { this.tier = 2; this._db = db; }

  static available() {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  }

  static open(name = DB_NAME) {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(name, DB_VERSION); }
      catch (e) { return reject(e); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS);
        if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS);
      };
      req.onsuccess = () => resolve(new IndexedDBBackend(req.result));
      req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
      // Private-browsing modes can leave the request hanging rather than
      // erroring; do not let boot wait on it forever.
      req.onblocked = () => reject(new Error('indexedDB blocked'));
    });
  }

  _tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'));
      if (!req) { tx.oncomplete = () => resolve(); return; }
      // Writes resolve on COMMIT, not on the request callback: a quota abort
      // arrives between the two, and resolving early turned it into an
      // autosave that reported success for a document that never hit disk.
      if (mode === 'readwrite') {
        let result;
        req.onsuccess = () => { result = req.result; };
        tx.oncomplete = () => resolve(result);
      } else {
        req.onsuccess = () => resolve(req.result);
      }
    });
  }

  async putDoc(id, doc) { await this._tx(DOCS, 'readwrite', (s) => s.put(doc, id)); }
  async getDoc(id) { return (await this._tx(DOCS, 'readonly', (s) => s.get(id))) ?? null; }
  async listDocs() { return this._tx(DOCS, 'readonly', (s) => s.getAllKeys()); }
  async deleteDoc(id) { await this._tx(DOCS, 'readwrite', (s) => s.delete(id)); }

  async putAsset(key, blob, meta = {}) {
    await this._tx(ASSETS, 'readwrite', (s) => s.put({ blob, meta }, key));
  }
  async getAsset(key) { return (await this._tx(ASSETS, 'readonly', (s) => s.get(key))) ?? null; }
  async listAssets() { return this._tx(ASSETS, 'readonly', (s) => s.getAllKeys()); }
  async deleteAsset(key) { await this._tx(ASSETS, 'readwrite', (s) => s.delete(key)); }

  async usage() {
    const rows = await this._tx(ASSETS, 'readonly', (s) => s.getAll());
    return { assets: rows.length, bytes: rows.reduce((n, r) => n + (r?.blob?.size ?? 0), 0) };
  }
  async close() { this._db.close(); }
}

/**
 * Pick the best backend this environment supports. Never throws: a private
 * window with IndexedDB disabled degrades to memory rather than failing boot.
 */
export async function openStorage({ prefer = 'auto', name = DB_NAME } = {}) {
  if (prefer !== 'memory' && IndexedDBBackend.available()) {
    try { return await IndexedDBBackend.open(name); }
    catch { /* fall through to memory */ }
  }
  return new MemoryBackend();
}

/* --------------------------------------------------------------- autosave -- */

/**
 * Debounced document autosave. Returns { stop, flush, savedAt }.
 * A save is skipped while one is in flight and re-run afterwards, so a burst of
 * edits cannot queue a pile of overlapping writes.
 */
export function autosave(store, backend, { id = 'current', delay = 800, onSave, onError } = {}) {
  let timer = null, inFlight = false, dirty = false, stopped = false;
  /* Whether the LAST write failed, so the caller can report a transition rather
     than an event. A failing autosave fails on every edit — ten ordinary edits
     produced ten identical "Autosave failed" lines and nothing else — and the
     thing the author needs to know is not that the eighth one failed, it is that
     saving stopped working, once, loudly. `first` and `recovered` say which
     writes are the interesting ones; the policy stays with the caller. */
  let failing = false;
  const state = { savedAt: null, get failing() { return failing; } };

  const write = async () => {
    if (stopped) return;
    if (inFlight) { dirty = true; return; }
    inFlight = true;
    try {
      await backend.putDoc(id, JSON.parse(JSON.stringify(store.doc)));
      state.savedAt = Date.now();
      const recovered = failing;
      failing = false;
      onSave?.(state.savedAt, { recovered });
    } catch (e) {
      const first = !failing;
      failing = true;
      onError?.(e, { first });
    } finally {
      inFlight = false;
      if (dirty) { dirty = false; schedule(); }
    }
  };

  const schedule = () => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; write(); }, delay);
  };

  const unsubscribe = store.subscribe('', schedule);

  // The debounce window is a data-loss window at the end of the session: an
  // edit made in the final 800ms was never written. pagehide is the last
  // reliable moment (fires on tab close, navigation and mobile background);
  // the write is started synchronously so the transaction can commit even as
  // the page goes away. Best-effort by nature — but it turns "always loses the
  // last edit" into "loses it only if the browser kills a started commit".
  const flushNow = () => { if (!stopped && (timer !== null || dirty)) { clearTimeout(timer); timer = null; write(); } };
  if (typeof addEventListener === 'function') addEventListener('pagehide', flushNow);

  return {
    get savedAt() { return state.savedAt; },
    get failing() { return failing; },
    flush: () => { clearTimeout(timer); timer = null; return write(); },
    stop() {
      stopped = true; clearTimeout(timer); unsubscribe();
      if (typeof removeEventListener === 'function') removeEventListener('pagehide', flushNow);
    },
  };
}
