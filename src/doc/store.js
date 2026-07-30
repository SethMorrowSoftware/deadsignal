/* Dead Signal Studio — doc/store.js
 *
 * The document is the truth; the DOM renders it. Every change is an invertible
 * command, which is what makes undo/redo, autosave, versioning and (later)
 * collaboration one mechanism rather than four features.
 *
 * Deliberately small: a command records the value at its path before and after,
 * so inverting is symmetric and does not need per-command logic.
 */
import { getPath, setPath, deletePath, parsePath, pathsOverlap, safeClone } from './paths.js';

/* ------------------------------------------------------------- commands -- */

/** Replace the value at `path`. */
export const set = (path, value, opts = {}) =>
  ({ op: 'set', path, value, ...opts });

/** Merge `patch`'s own keys into the object at `path`. */
export const patch = (path, obj, opts = {}) =>
  ({ op: 'patch', path, value: obj, ...opts });

/** Insert into the array at `path` (index defaults to the end). */
export const insert = (path, value, index = -1, opts = {}) =>
  ({ op: 'insert', path, value, index, ...opts });

/** Remove index `index` from the array at `path`. */
export const remove = (path, index, opts = {}) =>
  ({ op: 'remove', path, index, ...opts });

/* How long after the previous command a same-keyed one still folds into it.
 *
 * A time window is the right rule for a keyboard repeat or a slider nudged in
 * bursts, where there is no signal for when the gesture ends. It is the wrong
 * rule for a POINTER DRAG, which has an exact beginning and end: hold a trim
 * handle still for two thirds of a second in the middle of a drag — or let a
 * heavy filter chain stall the main thread for that long, which it can — and one
 * gesture became two, three, four undo entries. Undoing the drag then took as
 * many presses as there happened to be pauses in it, a number the author has no
 * way to know. Hence beginGesture(): while a gesture is open, its key folds
 * regardless of elapsed time. */
const COALESCE_WINDOW_MS = 600;

export class Store {
  /**
   * @param {object} doc          initial document (taken by reference)
   * @param {object} [opts]
   * @param {number} [opts.limit] undo depth (default 200)
   * @param {() => number} [opts.now] clock, injectable for tests
   */
  constructor(doc, opts = {}) {
    this._doc = doc;
    this._undo = [];
    this._redo = [];
    this._subs = new Set();
    this._txn = null;
    this._limit = opts.limit ?? 200;
    this._now = opts.now ?? (() => Date.now());
    this._muted = 0;
    this._gesture = null;
  }

  /* -------------------------------------------------------- gestures -- */

  /**
   * Open a gesture: every command carrying `key` folds into one undo entry
   * until endGesture(), however long the pointer rests mid-drag.
   *
   * Idempotent and last-one-wins — a pointerdown inside an unfinished gesture
   * (a lost pointerup, a cancelled drag) replaces it rather than nesting, so a
   * dropped end event cannot glue two unrelated gestures together forever.
   */
  beginGesture(key) { this._gesture = key || null; return this._gesture; }
  /** Close the gesture. Commands after this coalesce by the time window again. */
  endGesture() { this._gesture = null; }
  get gestureKey() { return this._gesture; }

  get doc() { return this._doc; }
  get canUndo() { return this._undo.length > 0; }
  get canRedo() { return this._redo.length > 0; }
  get undoDepth() { return this._undo.length; }
  /** Label of the change undo() would reverse — for menu text. */
  get undoLabel() { return this._undo.at(-1)?.label ?? null; }
  get redoLabel() { return this._redo.at(-1)?.label ?? null; }

  get(path) { return getPath(this._doc, path); }

  /* ------------------------------------------------------------ mutate -- */

  /**
   * Apply a command (or an array of commands, applied atomically).
   * Returns the entry pushed onto the undo stack, or null if nothing changed.
   */
  apply(cmd) {
    const cmds = Array.isArray(cmd) ? cmd : [cmd];
    const steps = [];
    for (const c of cmds) {
      const step = this._exec(c);
      if (step) steps.push(step);
    }
    if (!steps.length) return null;

    const entry = {
      steps,
      label: cmds[0].label ?? cmds[0].op,
      // Taken from the first command even for a batch, so dragging a control
      // that writes many paths at once (a macro) still collapses to one entry.
      coalesceKey: cmds[0].coalesceKey,
      at: this._now(),
    };

    if (this._txn) {
      this._txn.steps.push(...steps);
    } else {
      const top = this._undo.at(-1);
      // Dragging a slider emits a command per pixel; collapse them into one
      // undo entry while keeping the ORIGINAL before-value.
      const sameKey = top && entry.coalesceKey && top.coalesceKey === entry.coalesceKey;
      const inGesture = sameKey && this._gesture === entry.coalesceKey;
      if (sameKey && (inGesture || entry.at - top.at <= COALESCE_WINDOW_MS)) {
        top.steps.push(...steps);
        top.at = entry.at;
      } else {
        this._undo.push(entry);
        if (this._undo.length > this._limit) this._undo.shift();
      }
      this._redo.length = 0;
    }
    this._notify(steps.map((s) => s.path), 'apply');
    return entry;
  }

  /** Group every command applied inside `fn` into a single undo entry. */
  transaction(fn, label = 'change') {
    if (this._txn) return fn();               // already inside one; join it
    this._txn = { steps: [], label, at: this._now() };
    let out;
    try {
      out = fn();
    } catch (e) {
      // Roll back a failed transaction so a throw cannot leave the document
      // half-written.
      this._revert(this._txn.steps);
      this._txn = null;
      this._notify(['']);
      throw e;
    }
    const txn = this._txn;
    this._txn = null;
    if (txn.steps.length) {
      this._undo.push(txn);
      if (this._undo.length > this._limit) this._undo.shift();
      this._redo.length = 0;
    }
    return out;
  }

  undo() {
    const entry = this._undo.pop();
    if (!entry) return false;
    this._revert(entry.steps);
    this._redo.push(entry);
    this._notify(entry.steps.map((s) => s.path), 'undo');
    return true;
  }

  redo() {
    const entry = this._redo.pop();
    if (!entry) return false;
    for (const s of entry.steps) this._replay(s);
    this._undo.push(entry);
    this._notify(entry.steps.map((s) => s.path), 'redo');
    return true;
  }

  /** Drop history without touching the document (e.g. after a load). */
  clearHistory() { this._undo.length = 0; this._redo.length = 0; }

  /** Replace the whole document. Not undoable — used by load/import. */
  replace(doc) {
    this._doc = doc;
    this.clearHistory();
    this._notify([''], 'replace');
  }

  /* ------------------------------------------------------- subscriptions -- */

  /**
   * Called when anything at or under `path` changes. Subscribe to '' for the
   * whole document. Returns an unsubscribe function.
   */
  subscribe(path, fn) {
    const entry = { path: path === '' ? '' : parsePath(path).join('.'), fn };
    this._subs.add(entry);
    return () => this._subs.delete(entry);
  }

  /** Suppress notifications for the duration of `fn` (bulk loads). */
  silently(fn) {
    this._muted++;
    try { return fn(); } finally { this._muted--; }
  }

  _notify(paths, reason = 'apply') {
    if (this._muted) return;
    for (const sub of [...this._subs]) {
      const hit = sub.path === '' || paths.some((p) => p === '' || pathsOverlap(p, sub.path));
      if (hit) sub.fn(this._doc, { paths, reason });
    }
  }

  /* -------------------------------------------------------------- internals */

  _exec(c) {
    const path = c.path;
    switch (c.op) {
      case 'set': {
        const before = safeClone(getPath(this._doc, path));
        const after = safeClone(c.value);
        if (same(before, after)) return null;
        setPath(this._doc, path, after);
        return { op: 'set', path, before, after };
      }
      case 'patch': {
        const target = getPath(this._doc, path);
        const before = safeClone(target);
        const after = safeClone({ ...(target ?? {}), ...c.value });
        if (same(before, after)) return null;
        setPath(this._doc, path, after);
        return { op: 'set', path, before, after };
      }
      case 'insert': {
        const arr = getPath(this._doc, path);
        if (!Array.isArray(arr)) throw new TypeError(`insert target "${path}" is not an array`);
        const i = c.index < 0 || c.index > arr.length ? arr.length : c.index;
        arr.splice(i, 0, safeClone(c.value));
        return { op: 'insert', path, index: i, after: safeClone(c.value) };
      }
      case 'remove': {
        const arr = getPath(this._doc, path);
        if (!Array.isArray(arr)) throw new TypeError(`remove target "${path}" is not an array`);
        if (c.index < 0 || c.index >= arr.length) return null;
        const [before] = arr.splice(c.index, 1);
        return { op: 'remove', path, index: c.index, before };
      }
      default:
        throw new TypeError(`unknown op "${c.op}"`);
    }
  }

  _replay(s) {
    if (s.op === 'set') setPath(this._doc, s.path, safeClone(s.after));
    else if (s.op === 'insert') getPath(this._doc, s.path).splice(s.index, 0, safeClone(s.after));
    else if (s.op === 'remove') getPath(this._doc, s.path).splice(s.index, 1);
  }

  /** Invert steps in reverse order — order matters for array ops. */
  _revert(steps) {
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i];
      if (s.op === 'set') {
        if (s.before === undefined) deletePath(this._doc, s.path);
        else setPath(this._doc, s.path, safeClone(s.before));
      } else if (s.op === 'insert') {
        getPath(this._doc, s.path).splice(s.index, 1);
      } else if (s.op === 'remove') {
        getPath(this._doc, s.path).splice(s.index, 0, safeClone(s.before));
      }
    }
  }
}

/** Structural equality, so a no-op write does not create an undo entry. */
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return a === b;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => same(a[k], b[k]));
}
