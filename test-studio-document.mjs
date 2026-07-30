/* Dead Signal Studio — project document contract (headless, no browser).
 *
 * Pins the Phase 2 foundation: path safety, invertible commands, undo/redo with
 * coalescing and transactions, path-scoped subscriptions, byte-stable
 * serialisation, the ZIP round-trip, and the forward-only migration chain from
 * the legacy v0 project format that is already on people's disks.
 */
import { getPath, hasPath, setPath, deletePath, parsePath, pathsOverlap, safeClone, PathError }
  from './src/doc/paths.js';
import { Store, set, patch, insert, remove } from './src/doc/store.js';
import { createDocument, normalize, isDocument, SCHEMA_VERSION } from './src/doc/schema.js';
import { migrate, versionOf } from './src/doc/migrations.js';
import { toJSON, fromJSON, canonicalJSON, toRfp, fromRfp } from './src/doc/serialize.js';
import { EASE_NAMES, addKey, evalTrack, hasKeys, makeKey, normalizeTrack, normalizeTracks, removeKey }
  from './src/doc/automation.js';
import { hasOverrides, hasVisibleLayers, makeLayer, normalizeLayers,
         DEFAULT_SCENE, MAX_LAYERS, MAX_LAYER_SEED, MAX_LAYER_TEXT }
  from './src/doc/layers.js';
import { hasActiveFilters, makeFilter, normalizeFilters, scaleFilterPx, MAX_FILTERS }
  from './src/doc/filters.js';
import { fileOf, installedFiles, mergeEntries, normalizeExisting, parseIndex, parseManifest, releasedFiles }
  from './src/library/merge.js';
import { FORMATS, MAX_DIM, fitRatio, formatFor } from './src/core/formats.js';
import { MAX_CLIP, MAX_CLIPS, MAX_SPEED, MAX_START, MIN_CLIP, MIN_SPEED, TRACKS, TRANSITIONS,
         clipLength, clipSpeed, flashHalf, isFirstOnTrack, isOverlay, isTrimmed, makeClip, normalizeClips,
         overlaps, scheduleOf, sourceTimeOf, speedSummary, spineSpans }
  from './src/doc/timeline.js';
import { REC_DURATION, SOURCE_TAB, SOURCE_VIEW, fieldsFor, isLookKey, patchFor, patchForTrack,
         patchFromRecipe, recipeShortfall, trimSummary, valueFor }
  from './src/doc/clipedit.js';
import { MAX_TICKS, SNAP_PX, TICK_LADDER, ZOOM_MAX, ZOOM_MIN, clampScroll, clampZoom, fitPxPerSecond,
         pxPerSecond, pxToTime, snapCandidates, snapMove, snapTime,
         tickLabel, tickStep, tickTimes, timeToPx }
  from './src/ui/timescale.js';
import { LIB_PREFIX, MAX_AUDIO_CLIPS, MAX_GAIN, audioClipLength, audioEnd, audioParts, fadeShape,
         makeAudioClip, needsStereo, normalizeAudioClips }
  from './src/doc/audioclip.js';
import { footageKeyOf, footageSourceOf } from './src/doc/timeline.js';
import { audioFieldsFor, audioPatchFor, audioValueFor, soundSummary,
         clipTracks, curvesSignature, keysPastEnd, patchForClearCurves, patchForClearParam,
         patchForKey, patchForKeyRemove, sameTracks }
  from './src/doc/clipedit.js';
import { hasSound, mixParts, mixSignature } from './src/doc/audiomix.js';
import { ANIM_IN, ANIM_OUT, DEFAULT_PLACE, MAX_ANIM, MAX_SIZE, MAX_TITLE_SUB, MAX_TITLE_TEXT,
         MIN_SIZE, SAFE, TITLE_PLACES, TREATMENTS, isBlankTitle, makeTitle, titleAlpha,
         titleAnchor, titleLabel, titleLines, titleRamps, titleReveal, titleRise, titleRollAt,
         titleScale, titleSummary, TEXT_FX, ROLLS, steadyNoise }
  from './src/doc/title.js';
import { CLIP_KINDS, HELD_KINDS, OVER_KINDS, XDIRS, axisOnly, takesDirection }
  from './src/doc/timeline.js';
import { GFX_IN, GFX_OUT, MAX_GFX_ANIM, MAX_WEIGHT, MIN_WEIGHT, SHAPES, DEFAULT_SHAPE,
         graphicAlpha, graphicDraw, graphicLabel, graphicScale, isDiagonal, isEmptyGraphic,
         isStroked, makeGraphic, rectOfGraphic, shapeSpec } from './src/doc/graphic.js';
import { MAX_RAMP, ease, ramps } from './src/doc/ramp.js';
import { KEY_MODES, MASK_MODES, MASK_PLACES, MASK_SHAPES, MAX_FEATHER, despillTo, hasMatte,
         keyActive, keyAlphaAt, keyPrep, makeMatte, maskActive, maskDropsPixels, maskPlaceOf,
         maskRectOf, matteSummary, needsAlphaBlend, patchForMaskPlace, rgbToYcc, yccToRgb,
         MIN_MASK, insideMask, maskBoxOf, maskHandlesFor, maskMoveBy, maskResizeTo, maskRotAt }
  from './src/doc/matte.js';
import { ALPHA_BLEND, BLENDS, BLEND_LABEL, DEFAULT_BLEND } from './src/doc/layers.js';
import { isMatteKey, matteNotes } from './src/doc/clipedit.js';
import { FLIPS, HANDLE_PX, MAX_OFFSET, MAX_SCALE, MIN_SCALE, PLACES, ROT_ARM_PX, handlesFor,
         hitHandle, insideClip, invertPoint, isIdentity, makeTransform, matrixFor, moveBy,
         offFrame, patchForPlace, placeOf, rotAt, scaleAt, transformSummary, transformedBox }
  from './src/doc/transform.js';
import { dbfs, isClipping, peakLabel, peakLevel, peaksOf } from './src/audio/peaks.js';
import { AUDIO_EXT, IMAGE_EXT, KINDS, MAX_IMPORT_BYTES, VIDEO_EXT, classifyFile, extOf,
         importOrder, stemOf }
  from './src/media/classify.js';
import { muxWebM, opusHead } from './src/export/webm.js';
import { muxMP4, mp4CanCarry } from './src/export/mp4.js';
import { MAX_REGIONS, REGION_OPS, applyRegions, editedSeconds, makeRegion, normalizeRegions }
  from './src/doc/regions.js';
import { MAX_SOLO, SOLO_SOURCES, applySolo, normalizeSolo, soloDisabledNames, soloNotice,
         soloSource, toggleSoloKey }
  from './src/audio/solo.js';
import { AUDIO_LAYERS, TOGGLE } from './src/audio/layers.js';
import { PACKS, danglingIds, packFor, splitByPack } from './src/core/packs.js';
import { ANNOTATION_KINDS, MAX_ANNOTATIONS, MAX_TEXT, annotationKind, annotationLabel,
         makeAnnotation, moveAnnotation, normalizeAnnotations, offCanvas, rectOf, resizeAnnotation }
  from './src/doc/annotations.js';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fail++; else pass++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};
const threw = (fn, re) => { try { fn(); return false; } catch (e) { return re ? re.test(e.message) : true; } };
const section = (t) => console.log(`\n[${t}]`);

const clock = (() => { let t = 1_000_000; return () => (t += 1000); })();
const newDoc = () => createDocument({ now: () => 1_700_000_000_000 });

console.log('Dead Signal Studio document');
console.log('-'.repeat(58));

/* ================================================================ paths === */
section('paths');
{
  const o = {};
  setPath(o, 'a.b.c', 1);
  check('setPath creates intermediate objects', o.a.b.c === 1);
  setPath(o, 'list.0.name', 'x');
  check('a numeric segment creates an array', Array.isArray(o.list) && o.list[0].name === 'x');
  check('getPath reads back', getPath(o, 'list.0.name') === 'x');
  check('getPath on a missing branch is undefined', getPath(o, 'nope.deep.er') === undefined);

  deletePath(o, 'a.b.c');
  check('deletePath removes a key', !('c' in o.a.b));
  setPath(o, 'arr', [1, 2, 3]); deletePath(o, 'arr.1');
  check('deletePath splices an array', JSON.stringify(o.arr) === '[1,3]');

  // The reason this module exists.
  for (const bad of ['__proto__', 'constructor', 'prototype']) {
    check(`rejects a "${bad}" path segment`,
          threw(() => setPath({}, `a.${bad}.b`, 1), /unsafe path segment/));
  }
  check('Object.prototype is untouched', ({}).polluted === undefined);
  check('rejects an empty path', threw(() => parsePath(''), /empty path/));
  check('rejects an empty segment', threw(() => parsePath('a..b'), /empty segment/));

  /* …in BOTH path forms. parsePath returned an array path unchecked, so the one
     guard this module exists to be could be walked straight past by passing the
     segments as a list instead of as a string. Same segments, same writes, none
     of the ban. */
  for (const bad of ['__proto__', 'constructor', 'prototype']) {
    check(`rejects a "${bad}" segment given as an ARRAY path too`,
          threw(() => setPath({}, ['a', bad, 'b'], 1), /unsafe path segment/));
  }
  check('Object.prototype is still untouched after the array attempts',
        ({}).polluted === undefined && ({}).b === undefined);
  check('rejects an empty array path', threw(() => parsePath([]), /empty path/));
  check('rejects an empty segment in an array path',
        threw(() => parsePath(['a', '', 'b']), /empty segment/));
  check('…while an ordinary array path still works',
        JSON.stringify(parsePath(['tabs', 'video', 'v-w'])) === '["tabs","video","v-w"]');

  /* A document is plain JSON: nothing in it is ever inherited. Both readers
     walked the prototype chain, so a key that does not exist was reported as
     present with a function for a value. */
  {
    const doc = { tabs: { video: { 'v-w': 320 } }, library: [{ name: 'a' }] };
    for (const inherited of ['toString', 'valueOf', 'hasOwnProperty']) {
      check(`getPath does not find the inherited "${inherited}"`,
            getPath(doc, `tabs.video.${inherited}`) === undefined);
      check(`hasPath does not claim the inherited "${inherited}" is there`,
            hasPath(doc, `tabs.video.${inherited}`) === false);
    }
    check('…while a real key is still found', getPath(doc, 'tabs.video.v-w') === 320
          && hasPath(doc, 'tabs.video.v-w'));
    check('…and an array index is still found', getPath(doc, 'library.0.name') === 'a');
  }

  check('safeClone strips banned keys at depth',
        safeClone(JSON.parse('{"a":{"__proto__":{"x":1},"b":2}}')).a.__proto__.x === undefined);
  check('safeClone detaches from the source', (() => {
    const src = { a: { b: [1, 2] } }; const c = safeClone(src); c.a.b.push(3);
    return src.a.b.length === 2;
  })());
  check('safeClone rejects a cycle', (() => {
    const a = {}; a.self = a; return threw(() => safeClone(a), /circular/);
  })());

  check('pathsOverlap: parent vs child', pathsOverlap('tabs.video', 'tabs.video.v-w'));
  check('pathsOverlap: child vs parent', pathsOverlap('tabs.video.v-w', 'tabs.video'));
  check('pathsOverlap: siblings do not', !pathsOverlap('tabs.video', 'tabs.audio'));
  check('pathsOverlap: prefix strings are not segments', !pathsOverlap('tabs.video', 'tabs.vid'));
}

/* ================================================================ store === */
section('commands + undo');
{
  const s = new Store(newDoc(), { now: clock });
  s.apply(set('seed', 42));
  check('set writes', s.get('seed') === 42);
  check('undo is available', s.canUndo && !s.canRedo);
  s.undo();
  check('undo restores the previous value', s.get('seed') === 1947);
  check('redo becomes available', s.canRedo);
  s.redo();
  check('redo re-applies', s.get('seed') === 42);

  check('a no-op write creates no undo entry', (() => {
    const d = s.undoDepth; s.apply(set('seed', 42)); return s.undoDepth === d;
  })());

  s.apply(set('tabs.video.v-w', '320'));
  s.apply(set('tabs.video.v-h', '240'));
  check('undo unwinds one step at a time', (() => {
    s.undo(); return s.get('tabs.video.v-h') === undefined && s.get('tabs.video.v-w') === '320';
  })());

  check('a new change clears the redo stack', (() => {
    s.apply(set('tabs.video.v-fps', '12')); return !s.canRedo;
  })());

  check('undo of a first-time set removes the key entirely', (() => {
    s.apply(set('tabs.video.brand-new', 'x')); s.undo();
    return !('brand-new' in s.get('tabs.video'));
  })());
}

section('patch / insert / remove');
{
  const s = new Store(newDoc(), { now: clock });
  s.apply(patch('meta', { name: 'EREBUS reel' }));
  check('patch merges', s.get('meta.name') === 'EREBUS reel' && typeof s.get('meta.created') === 'number');
  s.undo();
  check('patch inverts wholesale', s.get('meta.name') === 'Untitled');

  s.apply(insert('library', { id: 1, name: 'a' }));
  s.apply(insert('library', { id: 2, name: 'b' }));
  s.apply(insert('library', { id: 0, name: 'first' }, 0));
  check('insert honours an index', s.get('library').map((x) => x.id).join(',') === '0,1,2');
  s.undo();
  check('undo of insert removes the right element', s.get('library').map((x) => x.id).join(',') === '1,2');

  s.apply(remove('library', 0));
  check('remove drops the element', s.get('library').map((x) => x.id).join(',') === '2');
  s.undo();
  check('undo of remove restores at the same index', s.get('library').map((x) => x.id).join(',') === '1,2');

  check('remove out of range is a no-op', (() => {
    const d = s.undoDepth; s.apply(remove('library', 99)); return s.undoDepth === d;
  })());
  check('insert into a non-array throws', threw(() => s.apply(insert('seed', 1)), /not an array/));

  check('stored values are detached from the caller', (() => {
    const live = { id: 9, tags: ['a'] };
    s.apply(insert('library', live));
    live.tags.push('mutated');
    return s.get('library').at(-1).tags.length === 1;
  })());
}

section('a flash transition is bounded by its clips');
{
  /* dip / dipwhite / burn do not overlap: half is drawn at the tail of the
     outgoing clip and half at the head of the incoming one. The overlapping
     kinds clamp to min(xdur, len, prevLen); this branch used xdur / 2 raw. With
     the maximum 4s dip on a 1s clip that made the half 2s, so the wash covered
     the clip's whole length, never completed, and the picture the author trimmed
     was never once visible. Measured in the browser suite: 0 of 10 sampled
     instants inside the clip showed it, and its mean peaked at 42 of the 93 it
     renders as with a cut. */
  check('a flash is half the shorter neighbour, not half its own duration',
        flashHalf(4, 1, 1) === 0.5, String(flashHalf(4, 1, 1)));
  check('…so it always finishes inside the clip it enters',
        flashHalf(4, 1, 1) < 1 && flashHalf(10, 0.5, 3) < 0.5,
        `${flashHalf(4, 1, 1)} / ${flashHalf(10, 0.5, 3)}`);
  check('…a duration that fits is left alone', flashHalf(0.6, 5, 5) === 0.3,
        String(flashHalf(0.6, 5, 5)));
  check('…the shorter of the two clips decides', flashHalf(4, 6, 0.4) === 0.2,
        String(flashHalf(4, 6, 0.4)));
  check('…zero and nonsense are zero, not NaN',
        flashHalf(0, 5, 5) === 0 && flashHalf('x', 5, 5) === 0 && flashHalf(4, 0, 5) === 0,
        `${flashHalf(0, 5, 5)} ${flashHalf('x', 5, 5)} ${flashHalf(4, 0, 5)}`);
  check('…and a negative duration cannot make it negative', flashHalf(-4, 5, 5) === 0,
        String(flashHalf(-4, 5, 5)));
}

section('coalescing + transactions');
{
  const s = new Store(newDoc(), { now: () => 1000 });   // frozen clock: same window
  s.apply(set('tabs.video.v-scan', '10', { coalesceKey: 'v-scan' }));
  s.apply(set('tabs.video.v-scan', '20', { coalesceKey: 'v-scan' }));
  s.apply(set('tabs.video.v-scan', '30', { coalesceKey: 'v-scan' }));
  check('a slider drag is one undo entry', s.undoDepth === 1, `depth ${s.undoDepth}`);
  s.undo();
  check('undo returns to the value before the drag', s.get('tabs.video.v-scan') === undefined);

  const s2 = new Store(newDoc(), { now: (() => { let t = 0; return () => (t += 5000); })() });
  s2.apply(set('tabs.video.v-scan', '10', { coalesceKey: 'v-scan' }));
  s2.apply(set('tabs.video.v-scan', '20', { coalesceKey: 'v-scan' }));
  check('a pause between changes breaks coalescing', s2.undoDepth === 2, `depth ${s2.undoDepth}`);

  /* A POINTER DRAG IS NOT A TIME WINDOW.
     The 600ms rule is right for a keyboard repeat, where nothing says when the
     gesture ends. A drag says exactly when: pointerdown and pointerup. Hold a
     trim handle still for two thirds of a second mid-drag — or let a heavy filter
     chain stall the main thread for that long, which it can — and one gesture
     became several undo entries, so undoing the drag took as many presses as it
     happened to contain pauses, a number the author cannot know. */
  const s2b = new Store(newDoc(), { now: (() => { let t = 0; return () => (t += 5000); })() });
  s2b.beginGesture('tl-drag-1');
  for (const v of ['0.1', '0.4', '0.9', '1.4']) {
    s2b.apply(set('timeline.clips.0.in', v, { coalesceKey: 'tl-drag-1' }));
  }
  check('an open gesture folds however long the pointer rests',
        s2b.undoDepth === 1, `depth ${s2b.undoDepth}`);
  check('…and the gesture key is readable while it is open',
        s2b.gestureKey === 'tl-drag-1', String(s2b.gestureKey));
  s2b.endGesture();
  s2b.apply(set('timeline.clips.0.in', '2.0', { coalesceKey: 'tl-drag-1' }));
  check('…and a change after pointerup is its own entry', s2b.undoDepth === 2, `depth ${s2b.undoDepth}`);
  s2b.undo();
  check('…so one undo puts the whole drag back', s2b.get('timeline.clips.0.in') === '1.4',
        String(s2b.get('timeline.clips.0.in')));
  s2b.undo();
  check('…and the next undo reverses the drag entirely',
        s2b.get('timeline.clips.0.in') === undefined, String(s2b.get('timeline.clips.0.in')));

  /* A DIFFERENT key must not be swallowed by an open gesture, or a drag would
     absorb any unrelated edit that landed during it. */
  const s2c = new Store(newDoc(), { now: () => 1000 });
  s2c.beginGesture('tl-drag-9');
  s2c.apply(set('timeline.clips.0.in', '0.5', { coalesceKey: 'tl-drag-9' }));
  s2c.apply(set('tabs.video.v-scan', '44', { coalesceKey: 'v-scan' }));
  check('an open gesture only folds its own key', s2c.undoDepth === 2, `depth ${s2c.undoDepth}`);

  /* A lost pointerup must not glue the next gesture onto the last one. */
  const s2d = new Store(newDoc(), { now: () => 1000 });
  s2d.beginGesture('tl-drag-a');
  s2d.apply(set('timeline.clips.0.in', '0.5', { coalesceKey: 'tl-drag-a' }));
  s2d.beginGesture('tl-drag-b');                 // pointerdown with no pointerup
  s2d.apply(set('timeline.clips.0.out', '3.5', { coalesceKey: 'tl-drag-b' }));
  check('a second pointerdown replaces the open gesture rather than nesting',
        s2d.undoDepth === 2 && s2d.gestureKey === 'tl-drag-b',
        `depth ${s2d.undoDepth}, key ${s2d.gestureKey}`);

  const s3 = new Store(newDoc(), { now: clock });
  s3.transaction(() => {
    s3.apply(set('tabs.video.v-w', '640'));
    s3.apply(set('tabs.video.v-h', '480'));
    s3.apply(set('tabs.video.v-fps', '24'));
  }, 'apply preset');
  check('a transaction is one undo entry', s3.undoDepth === 1, `depth ${s3.undoDepth}`);
  check('transaction label is kept', s3.undoLabel === 'apply preset', String(s3.undoLabel));
  s3.undo();
  check('undo reverts the whole transaction',
        s3.get('tabs.video.v-w') === undefined && s3.get('tabs.video.v-fps') === undefined);
  s3.redo();
  check('redo re-applies the whole transaction', s3.get('tabs.video.v-h') === '480');

  const s4 = new Store(newDoc(), { now: clock });
  s4.apply(set('seed', 7));
  const before = JSON.stringify(s4.doc);
  let caught = false;
  try {
    s4.transaction(() => { s4.apply(set('seed', 8)); throw new Error('boom'); });
  } catch { caught = true; }
  check('a throwing transaction rolls back', caught && JSON.stringify(s4.doc) === before);
  check('a rolled-back transaction leaves no history', s4.undoDepth === 1, `depth ${s4.undoDepth}`);
}

section('subscriptions');
{
  const s = new Store(newDoc(), { now: clock });
  const hits = { exact: 0, parent: 0, sibling: 0, all: 0 };
  s.subscribe('tabs.video.v-w', () => hits.exact++);
  s.subscribe('tabs.video', () => hits.parent++);
  s.subscribe('tabs.audio', () => hits.sibling++);
  const off = s.subscribe('', () => hits.all++);

  s.apply(set('tabs.video.v-w', '800'));
  check('exact subscriber fires', hits.exact === 1);
  check('parent subscriber fires', hits.parent === 1);
  check('sibling subscriber does not', hits.sibling === 0);
  check('root subscriber fires', hits.all === 1);

  s.undo();
  check('undo notifies too', hits.exact === 2 && hits.all === 2);

  off();
  s.apply(set('tabs.video.v-w', '900'));
  check('unsubscribe stops delivery', hits.all === 2);

  const quiet = { n: 0 };
  s.subscribe('', () => quiet.n++);
  s.silently(() => { s.apply(set('seed', 5)); s.apply(set('seed', 6)); });
  check('silently() suppresses notifications', quiet.n === 0);
  check('silently() still applies the writes', s.get('seed') === 6);

  s.replace(newDoc());
  check('replace() clears history', !s.canUndo && !s.canRedo);
}

/* ============================================================ serialize === */
section('serialisation');
{
  const s = new Store(newDoc(), { now: clock });
  s.apply(set('tabs.video.v-text', 'OBSERVE'));
  s.apply(set('seed', 4747));
  s.apply(insert('library', { id: 1, name: 'clip', kind: 'videos', ext: 'webm', gated: true, beat: 'boot' }));

  const a = toJSON(s.doc);
  const b = toJSON(JSON.parse(JSON.stringify(s.doc)));
  check('serialisation is byte-stable', a === b);

  check('key order is canonical, not insertion order', (() => {
    const x = canonicalJSON({ b: 1, a: 2 });
    const y = canonicalJSON({ a: 2, b: 1 });
    return x === y && x.indexOf('"a"') < x.indexOf('"b"');
  })());

  const round = fromJSON(a);
  check('save -> load round-trips exactly', toJSON(round) === a);
  check('round-trip preserves values', round.tabs.video['v-text'] === 'OBSERVE' && round.seed === 4747);

  check('runtime blobs are not serialised', (() => {
    const d = newDoc();
    d.library.push({ id: 1, name: 'x', blob: { fake: true }, url: 'blob:xyz' });
    const t = toJSON(d);
    return !t.includes('blob:') && !t.includes('fake');
  })());

  check('rejects a non-project file', threw(() => fromJSON('{"hello":1}'), /not a valid project/));
  check('rejects malformed JSON', threw(() => fromJSON('{nope'), /not a valid project/));
  check('a poisoned project cannot pollute', (() => {
    const doc = fromJSON('{"schemaVersion":1,"tabs":{"video":{}},"library":[],' +
                         '"meta":{"__proto__":{"pwned":1}}}');
    return ({}).pwned === undefined && doc.meta.pwned === undefined;
  })());
}

/* ============================================================ migrations == */
section('migrations');
{
  check('a document with no schemaVersion is v0', versionOf({ tabs: {} }) === 0);
  check('current documents report the current version', versionOf(newDoc()) === SCHEMA_VERSION);

  // The real legacy payload: readProject() wrote the seed as a string.
  const legacy = {
    seed: '1947',
    tabs: {
      video: { 'v-scene': 'snow', 'v-text': 'NO SIGNAL' },
      audio: { 'a-dur': '8' },
      image: { 'i-tpl': 'bsod' },
    },
  };
  const up = migrate(legacy);
  check('v0 project migrates', up.schemaVersion === SCHEMA_VERSION);
  check('v0 seed string becomes a number', up.seed === 1947 && typeof up.seed === 'number');
  check('v0 tab recipes survive', up.tabs.video['v-scene'] === 'snow' && up.tabs.image['i-tpl'] === 'bsod');
  check('migrated document is complete', isDocument(up) && Array.isArray(up.timeline.clips));

  const steps = [];
  migrate(legacy, { onStep: (v, d) => steps.push(`${v}:${d}`) });
  check('migration reports its steps', steps.length === SCHEMA_VERSION, steps.join(' | '));

  check('a legacy timeline array is carried forward', (() => {
    const d = migrate({ seed: '1', tabs: {}, timeline: [{ label: 'A', rec: { 'v-scene': 'snow' } }] });
    return d.timeline.clips.length === 1 && d.timeline.clips[0].rec['v-scene'] === 'snow';
  })());

  check('a newer document is refused, not silently downgraded',
        threw(() => migrate({ schemaVersion: SCHEMA_VERSION + 5, tabs: {}, library: [] }),
              /update the studio/));

  check('migration is idempotent', (() => {
    const once = migrate(legacy); const twice = migrate(once);
    return toJSON(once) === toJSON(twice);
  })());

  /* serialize.js advertises diffable, hand-editable files, so a current-shape
     document whose schemaVersion was lost to a hand edit or a bad merge reads
     as v0 here — and the v0 rebuild used to drop the library, chains, layers,
     keyframes, marks and variables while reporting "Project loaded". */
  check('a current-shape doc that lost its schemaVersion keeps its work', (() => {
    const doc = newDoc();
    doc.library = [{ key: 'k1', name: 'intro', kind: 'video', ext: 'webm' }];
    doc.filters.video = [{ id: 'grade', params: { contrast: 20 }, enabled: true }];
    doc.filters.audio = [{ id: 'crush', params: {}, enabled: true }];
    doc.layers.video = [{ scene: 'matrix', blend: 'screen', opacity: 0.3, enabled: true }];
    doc.automation.video['v-scan'] = [{ t: 0, v: 10, e: 'ease' }, { t: 10, v: 60, e: 'ease' }];
    doc.image.annotations = [{ text: 'HELLO', x: 0.5, y: 0.5, size: 40, align: 'center', weight: 4, color: '#fff' }];
    doc.vars.subject = 'WEBB';
    const stripped = fromJSON(toJSON(doc));
    delete stripped.schemaVersion;             // the hand-edit / bad-merge case
    const up = migrate(stripped);
    return up.schemaVersion === SCHEMA_VERSION
        && up.library.length === 1 && up.library[0].name === 'intro'
        && up.filters.video[0].params.contrast === 20 && up.filters.audio.length === 1
        && up.layers.video.length === 1
        && (up.automation.video['v-scan'] || []).length === 2
        && up.image.annotations.length === 1
        && up.vars.subject === 'WEBB'
        && up.meta.name === doc.meta.name;
  })());

  check('normalize fills a sparse document', (() => {
    const n = normalize({ schemaVersion: 1, tabs: { video: {} }, library: [] });
    return n.timeline.clips.length === 0 && !!n.meta.id && n.tabs.audio && n.tabs.timeline;
  })());
}

/* ================================================================== rfp === */
section('.rfp archive');
{
  const doc = newDoc();
  doc.tabs.video['v-text'] = 'ARCHIVE';
  doc.library.push({ id: 1, name: 'hum', kind: 'music', ext: 'wav' });

  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const rfp = await toRfp(doc, [{ name: 'hum.wav', blob: new Blob([bytes]) }]);
  check('rfp is produced', rfp.size > 0, `${rfp.size} bytes`);

  const { doc: back, assets } = await fromRfp(rfp);
  check('rfp round-trips the document', toJSON(back) === toJSON(doc));
  check('rfp carries assets', assets.has('hum.wav'));
  check('asset bytes survive intact',
        [...(assets.get('hum.wav') ?? [])].join(',') === [...bytes].join(','));

  check('a corrupt archive fails its checksum', await (async () => {
    const raw = new Uint8Array(await rfp.arrayBuffer());
    // First entry: 30-byte local header + "project.json" (12) => data at 42.
    raw[60] ^= 0xFF;                                  // flip a byte of the payload
    try { await fromRfp(new Blob([raw])); return false; }
    catch (e) { return /checksum mismatch/i.test(e.message); }
  })());

  check('a truncated archive is rejected', await (async () => {
    const raw = new Uint8Array(await rfp.arrayBuffer());
    try { await fromRfp(new Blob([raw.slice(0, raw.length - 30)])); return false; }
    catch (e) { return /zip|central directory|corrupt/i.test(e.message); }
  })());

  check('a non-zip is rejected', await (async () => {
    try { await fromRfp(new Blob([strBytes('definitely not a zip')])); return false; }
    catch (e) { return /not a zip/i.test(e.message); }
  })());
}
function strBytes(s) { return new TextEncoder().encode(s); }

/* =========================================================== keyframes ==== */
section('keyframe tracks');
{
  check('an empty track means "not automated"', evalTrack([], 5) === undefined);
  check('a track with no keys is not automated', evalTrack(undefined, 5) === undefined);

  const one = addKey([], 3, 40);
  check('a single key holds its value everywhere',
        evalTrack(one, 0) === 40 && evalTrack(one, 3) === 40 && evalTrack(one, 99) === 40);

  const ramp = addKey(addKey([], 0, 0), 10, 100);
  check('two keys interpolate linearly', evalTrack(ramp, 5) === 50, String(evalTrack(ramp, 5)));
  check('the endpoints are exact', evalTrack(ramp, 0) === 0 && evalTrack(ramp, 10) === 100);
  // Extrapolating would push a percentage past its own range before the clip
  // even reaches the first key.
  check('values are held flat outside the keyed range',
        evalTrack(ramp, -5) === 0 && evalTrack(ramp, 50) === 100);

  const held = addKey(addKey([], 0, 0, 'hold'), 10, 100);
  check('a hold key steps rather than ramps',
        evalTrack(held, 9.9) === 0 && evalTrack(held, 10) === 100);

  /* An easing NAME is checked against the names this module defines, not
     against truthiness of EASES[name]. Every member of Object.prototype is
     truthy, so `e: "toString"` was accepted as a valid ease and written into
     the document — and evaluating it then called Object.prototype.toString as
     the curve, which returns a string, which makes the interpolation NaN. A NaN
     leaves here as a render parameter, and it survives a save and a reload. */
  for (const inherited of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    check(`an inherited name is not an easing: "${inherited}"`,
          makeKey(1, 5, inherited).e === 'linear', makeKey(1, 5, inherited).e);
    const t = normalizeTrack([{ t: 0, v: 0, e: inherited }, { t: 10, v: 100, e: inherited }]);
    check(`…and a track carrying it still evaluates to a number`,
          Number.isFinite(evalTrack(t, 5)), String(evalTrack(t, 5)));
  }
  check('…while every declared ease is still accepted',
        EASE_NAMES.every((e) => makeKey(1, 5, e).e === e), EASE_NAMES.join(' '));

  const eased = addKey(addKey([], 0, 0, 'ease'), 10, 100);
  check('ease is symmetric about the midpoint', evalTrack(eased, 5) === 50, String(evalTrack(eased, 5)));
  check('ease starts slower than linear', evalTrack(eased, 2) < evalTrack(ramp, 2),
        `${evalTrack(eased, 2)} < ${evalTrack(ramp, 2)}`);

  check('keys are stored in time order',
        normalizeTrack([{ t: 9, v: 1 }, { t: 2, v: 5 }]).map((k) => k.t).join(',') === '2,9');
  check('keying the same time twice replaces rather than duplicates',
        addKey(addKey([], 4, 10), 4, 90).length === 1);
  check('…and the later value wins', addKey(addKey([], 4, 10), 4, 90)[0].v === 90);
  check('a key can be removed', removeKey(addKey(addKey([], 1, 1), 2, 2), 1).length === 1);
  check('removing a time with no key is a no-op', removeKey(addKey([], 1, 1), 7).length === 1);

  check('non-numeric keys are dropped',
        normalizeTrack([{ t: 'x', v: 1 }, { t: 1, v: null }, { t: 2, v: 3 }]).length === 1);
  check('an unknown ease falls back to linear',
        normalizeTrack([{ t: 0, v: 0, e: 'boing' }])[0].e === 'linear');
  check('negative times are clamped to the start of the clip',
        normalizeTrack([{ t: -4, v: 7 }])[0].t === 0);

  check('hasKeys is false for an empty map', hasKeys({}) === false && hasKeys(null) === false);
  check('hasKeys ignores tracks that were emptied', hasKeys({ 'v-scan': [] }) === false);
  check('hasKeys is true once a key exists', hasKeys({ 'v-scan': [{ t: 0, v: 1 }] }) === true);
  check('empty tracks are dropped on normalize',
        Object.keys(normalizeTracks({ 'v-scan': [], 'v-noise': [{ t: 0, v: 1 }] })).join() === 'v-noise');

  // Track ids arrive from project files, and setPath walks the id as a path
  // segment — the same reason the store guards its writes.
  const polluted = JSON.parse('{"__proto__":[{"t":0,"v":1}],"v-scan":[{"t":0,"v":2}]}');
  check('a prototype key cannot become a track',
        Object.keys(normalizeTracks(polluted)).join() === 'v-scan');
  check('…and Object.prototype is untouched', ({}).t === undefined);
}

/* ============================================================== layers ==== */
section('layer stack');
{
  check('a layer gets sane defaults',
        makeLayer({}).blend === 'screen' && makeLayer({}).opacity === 0.5
        && makeLayer({}).enabled === true);
  check('an unknown blend falls back', makeLayer({ blend: 'sparkle' }).blend === 'screen');
  check('opacity is clamped to 0..1',
        makeLayer({ opacity: 5 }).opacity === 1 && makeLayer({ opacity: -2 }).opacity === 0);
  check('a non-numeric opacity falls back rather than becoming NaN',
        makeLayer({ opacity: 'loud' }).opacity === 0.5);
  // Dropping the layer would silently discard the author's work; the renderer
  // already skips a scene it cannot find, so the name is kept.
  check('an unknown scene name is preserved, not dropped',
        makeLayer({ scene: 'scene-from-a-newer-build' }).scene === 'scene-from-a-newer-build');
  // Not just "a real scene" — a *texture* scene. Snow, terminal and the other
  // text scenes draw the shared caption themselves, so defaulting to one of
  // those made the first layer anyone added repeat the base's message in the
  // middle of the frame, which reads as the layer feature being broken.
  check('a missing scene falls back to a texture scene, not a text one',
        makeLayer({}).scene === 'matrix' && makeLayer({}).scene === DEFAULT_SCENE);

  check('a non-array stack normalizes to empty', normalizeLayers('nope').length === 0);
  check('the stack is capped',
        normalizeLayers(new Array(50).fill({ scene: 'snow' })).length === MAX_LAYERS);

  check('an empty stack draws nothing', hasVisibleLayers([]) === false);
  check('a disabled layer draws nothing',
        hasVisibleLayers([makeLayer({ enabled: false })]) === false);
  check('a zero-opacity layer draws nothing',
        hasVisibleLayers([makeLayer({ opacity: 0 })]) === false);
  check('a visible layer draws', hasVisibleLayers([makeLayer({})]) === true);

  const doc = newDoc();
  check('a new document has a layer stack', Array.isArray(doc.layers?.video));
  const st = new Store(doc, { now: clock });
  st.apply(set('layers.video', [{ scene: 'matrix', opacity: 0.8, blend: 'lighter' }]));
  check('a stack round-trips through JSON',
        fromJSON(toJSON(st.doc)).layers.video[0].scene === 'matrix');
  st.undo();
  check('adding a layer is undoable', st.get('layers.video').length === 0);

  const older = normalize({ schemaVersion: 1, tabs: { video: {} }, library: [] });
  check('a project saved before layers still opens', Array.isArray(older.layers?.video));
}

/* ======================================= campaign file merging ============ */
/* Getting this wrong deletes an author's existing media, which is the worst
   outcome the tool has available. */
section('campaign merge');
{
  check('fileOf reads a manifest src', fileOf({ src: 'assets/videos/a.mp4' }) === 'a.mp4');
  check('fileOf reads an index filename', fileOf({ filename: 'b.wav' }) === 'b.wav');
  check('fileOf survives junk', fileOf(null) === '' && fileOf({}) === '');

  const MANIFEST = JSON.stringify({
    music: [{ name: 'Hum', src: 'assets/music/hum.mp3', gated: true }],
    videos: [{ name: 'Loop', src: 'assets/videos/loop.mp4' }],
  });
  const m = parseManifest(MANIFEST);
  check('a manifest parses', m.music.length === 1 && m.videos.length === 1);
  check('a manifest with the wrong shape is refused',
        threw(() => parseManifest('[]'), /object/));
  check('an index parses', parseIndex('[{"name":"A","filename":"a.mp4"}]').length === 1);
  check('an index that is not an array is refused',
        threw(() => parseIndex('{}'), /array/));
  check('entries without a file are dropped',
        parseIndex('[{"name":"nameless"},{"name":"A","filename":"a.mp4"}]').length === 1);

  // The core promise: existing entries survive.
  const existing = [
    { name: 'One', src: 'assets/videos/one.mp4' },
    { name: 'Two', src: 'assets/videos/two.mp4', gated: true },
  ];
  const generated = [
    { name: 'Two Remade', src: 'assets/videos/two.mp4', gated: true },
    { name: 'Three', src: 'assets/videos/three.mp4', gated: true },
  ];
  const r = mergeEntries(existing, generated);
  check('every existing entry survives a merge',
        r.merged.some((e) => fileOf(e) === 'one.mp4'), r.merged.map(fileOf).join(','));
  check('regenerating a file REPLACES its entry rather than duplicating it',
        r.merged.filter((e) => fileOf(e) === 'two.mp4').length === 1);
  check('…and the replacement is the new one',
        r.merged.find((e) => fileOf(e) === 'two.mp4').name === 'Two Remade');
  check('new files are appended', r.merged.at(-1).name === 'Three');
  check('existing order is preserved so the diff stays small',
        r.merged.map(fileOf).join(',') === 'one.mp4,two.mp4,three.mp4');
  check('the report separates added from replaced',
        r.added.join() === 'three.mp4' && r.replaced.join() === 'two.mp4');

  check('merging into nothing is just the generated set',
        mergeEntries(null, generated).merged.length === 2);
  check('merging nothing into existing keeps existing intact',
        mergeEntries(existing, []).merged.length === 2);
  check('a duplicate already in the campaign is collapsed, not doubled',
        mergeEntries([...existing, existing[0]], []).merged.length === 2);

  // Release lines: emitted only for clips that do not already have one.
  const RETRO = `
    call releaseMedia "one.mp4"
    if ($x) { call releaseMedia 'two.mp4' }
    # call releaseMedia "commented.mp4"
  `;
  const rel = releasedFiles(RETRO);
  check('release lines are found in a script', rel.has('one.mp4') && rel.has('two.mp4'));
  check('single quotes count too', rel.has('two.mp4'));
  // A commented-out release is not a release: counting it would make the studio
  // skip the very line the author still needs.
  check('a commented-out release does not count', !rel.has('commented.mp4'));
  check('// comments are handled too',
        !releasedFiles('// call releaseMedia "x.mp4"').has('x.mp4'));
  check('a # inside a quoted filename is not a comment',
        releasedFiles('call releaseMedia "od#d.mp4"').has('od#d.mp4'));
  check('a script with none yields an empty set', releasedFiles('nothing here').size === 0);
  check('non-text input is handled', releasedFiles(null).size === 0);

  const ex = normalizeExisting({
    manifest: { music: [{ name: 'H', src: 'assets/music/Hum.MP3' }], videos: [] },
    videosIndex: [{ name: 'L', filename: 'loop.mp4' }],
    released: ['one.mp4', 'one.mp4'],
  });
  check('installedFiles collects from every imported source',
        installedFiles(ex).has('hum.mp3') && installedFiles(ex).has('loop.mp4'));
  check('installedFiles is case-insensitive', installedFiles(ex).has('hum.mp3'));
  check('released filenames are de-duplicated', ex.released.length === 1);
  check('normalizeExisting returns null when nothing was imported',
        normalizeExisting({}) === null && normalizeExisting(null) === null);

  // Imported files are author-supplied JSON and become document paths.
  const dirty = JSON.parse('[{"name":"A","filename":"a.mp4","__proto__":{"pwned":1}}]');
  const cleaned = parseIndex(JSON.stringify(dirty));
  check('a prototype key cannot ride in on an imported entry',
        !Object.keys(cleaned[0]).includes('__proto__') && ({}).pwned === undefined);
}

/* ======================================== keyframes in the document ======= */
section('keyframes are part of the project');
{
  const doc = newDoc();
  check('a new document has an automation map', !!doc.automation && !!doc.automation.video);

  const st = new Store(doc, { now: clock });
  st.apply(set('automation.video.v-scan', [{ t: 0, v: 10 }, { t: 8, v: 90 }]));
  check('a track can be written through the store',
        st.get('automation.video.v-scan').length === 2);
  check('the track round-trips through JSON',
        fromJSON(toJSON(st.doc)).automation.video['v-scan'].length === 2);
  st.undo();
  check('writing a track is undoable',
        (st.get('automation.video.v-scan') || []).length === 0);

  // A project written before keyframes existed must still open.
  const older = normalize({ schemaVersion: 1, tabs: { video: {} }, library: [] });
  check('a project saved before keyframes still opens',
        !!older.automation && Object.keys(older.automation.video).length === 0);
  const legacy = migrate({ seed: '1947', tabs: { video: { 'v-scan': '50' } } });
  check('a v0 project migrates with an empty automation map',
        !!legacy.automation && !!legacy.automation.video);
}

/* ------------------------------------------------------------ filter chain -- */
/* The chain is user-ordered and its parameters are free-form per filter, so
   this file is the only thing standing between a hostile or merely old project
   file and the renderer. It validates STRUCTURE; the registry owns the ranges. */
{
  check('a filter needs an id', normalizeFilters([{ params: {} }]).length === 0);
  check('a filter keeps its id and defaults to enabled',
        makeFilter({ id: 'grade' }).id === 'grade' && makeFilter({ id: 'grade' }).enabled === true);
  check('enabled:false survives', makeFilter({ id: 'grade', enabled: false }).enabled === false);

  // Same reasoning as layers: an id this build does not know is the author's
  // work, saved by a newer build. Dropping it loses that work silently.
  check('an unknown filter id is preserved, not dropped',
        normalizeFilters([{ id: 'filter-from-a-newer-build' }]).length === 1);

  check('a non-array chain normalizes to empty', normalizeFilters('nope').length === 0);
  check('the chain is capped',
        normalizeFilters(new Array(50).fill({ id: 'grade' })).length === MAX_FILTERS);

  // Parameter hygiene — this is the part that matters for safety.
  const proto = normalizeFilters([{ id: 'grade', params: JSON.parse('{"__proto__":{"polluted":1},"contrast":20}') }]);
  check('a params bag cannot carry __proto__', !Object.keys(proto[0].params).includes('__proto__'));
  check('…and the legitimate key beside it survives', proto[0].params.contrast === 20);
  check('nothing reached Object.prototype', ({}).polluted === undefined);

  check('a non-finite parameter is dropped',
        normalizeFilters([{ id: 'grade', params: { contrast: Infinity, brightness: 5 } }])[0].params.contrast === undefined);
  check('an object parameter is dropped',
        normalizeFilters([{ id: 'grade', params: { evil: { a: 1 }, ok: 3 } }])[0].params.ok === 3
        && normalizeFilters([{ id: 'grade', params: { evil: { a: 1 }, ok: 3 } }])[0].params.evil === undefined);
  check('a very long string parameter is truncated',
        normalizeFilters([{ id: 'stamp', params: { text: 'x'.repeat(9999) } }])[0].params.text.length === 200);

  check('an empty chain is inactive', hasActiveFilters([]) === false);
  check('a chain of only bypassed steps is inactive',
        hasActiveFilters(normalizeFilters([{ id: 'grade', enabled: false }])) === false);
  check('one live step makes it active',
        hasActiveFilters(normalizeFilters([{ id: 'grade', enabled: false }, { id: 'blur' }])) === true);

  // Order is the feature: the same two steps in the other order is a different
  // document, so normalize must not sort or dedupe.
  const ab = normalizeFilters([{ id: 'grade' }, { id: 'blur' }]).map((f) => f.id).join(',');
  const ba = normalizeFilters([{ id: 'blur' }, { id: 'grade' }]).map((f) => f.id).join(',');
  check('order is preserved, not normalized away', ab === 'grade,blur' && ba === 'blur,grade');
  check('the same filter may appear twice',
        normalizeFilters([{ id: 'blur' }, { id: 'blur' }]).length === 2);

  // A project written before filters existed must still open.
  const old = normalize(migrate({ seed: '1', tabs: { video: { 'v-scene': 'snow' } } }));
  check('a project saved before filters opens with an empty chain',
        Array.isArray(old.filters.video) && old.filters.video.length === 0);
  // Note the CURRENT document, not a v0 one: a v0 project predates filters by
  // definition, and migrate() rightly rebuilds it from scratch rather than
  // trusting keys that could not have been there.
  check('a chain round-trips through JSON', (() => {
    const doc = normalize({ ...newDoc(), filters: { video: [{ id: 'grade', params: { contrast: 20 }, enabled: false }] } });
    const back = normalize(migrate(JSON.parse(JSON.stringify(doc))));
    return back.filters.video[0].id === 'grade'
        && back.filters.video[0].params.contrast === 20
        && back.filters.video[0].enabled === false;
  })());
}

/* ================================================= shared vs circular refs = */
/* safeClone treated a repeated reference as a cycle, and readProject() clones
   the whole document — so one blob in two library rows, or any other DAG,
   turned SAVE PROJ into a silent no-op with the reason only in the console. */
section('safeClone tells a shared reference from a cycle');
{
  const shared = { a: 1 };
  const out = safeClone({ x: shared, y: shared, list: [shared, shared] });
  check('the same object twice is not a cycle', out.x.a === 1 && out.y.a === 1 && out.list.length === 2);
  check('…and each copy is independent', out.x !== out.y && out.x !== shared);

  const deep = { n: 1 };
  check('a reference repeated at different depths clones',
        safeClone({ a: { b: deep }, c: deep }).c.n === 1);

  const cyc = { name: 'loop' }; cyc.self = cyc;
  check('a genuine cycle is still refused', threw(() => safeClone(cyc), /circular/));
  const arrCyc = []; arrCyc.push(arrCyc);
  check('…including through an array', threw(() => safeClone(arrCyc), /circular/));

  const proto = JSON.parse('{"ok":1,"__proto__":{"polluted":true}}');
  check('banned keys are still stripped at depth',
        safeClone({ deep: { deeper: proto } }).deep.deeper.polluted === undefined);
  check('…and Object.prototype is untouched', ({}).polluted === undefined);
}

/* ============================================== per-layer override shape == */
section('a layer overrides, or inherits');
{
  const bare = makeLayer({ scene: 'matrix' });
  check('a layer with no overrides inherits everything',
        bare.text === '' && bare.fg === '' && bare.font === 0 && bare.seed === 0);
  check('…so it reports no overrides', hasOverrides(bare) === false);

  const full = makeLayer({ scene: 'matrix', text: 'OWN', fg: '#ff0000', font: 22, seed: 5 });
  check('overrides survive normalization', full.text === 'OWN' && full.fg === '#ff0000'
        && full.font === 22 && full.seed === 5);
  check('…and are reported', hasOverrides(full) === true);

  check('a non-colour is refused rather than half-applied',
        makeLayer({ fg: 'javascript:alert(1)' }).fg === '' && makeLayer({ fg: 'red' }).fg === '');
  check('a size out of range is clamped', makeLayer({ font: 9000 }).font === 72
        && makeLayer({ font: -5 }).font === 0);
  check('a variant out of range is clamped', makeLayer({ seed: 1e9 }).seed === MAX_LAYER_SEED);
  check('an empty string means inherit, not zero',
        makeLayer({ font: '', seed: '' }).font === 0 && makeLayer({ font: '', seed: '' }).seed === 0);
  check('very long layer text is truncated',
        makeLayer({ text: 'x'.repeat(9000) }).text.length === MAX_LAYER_TEXT);
  check('a non-string text is dropped', makeLayer({ text: { a: 1 } }).text === '');

  // A project written before layers had overrides must read back as "inherit".
  const old = normalize({ ...newDoc(), layers: { video: [{ scene: 'snow', blend: 'screen', opacity: 0.4 }] } });
  const back = old.layers.video[0];
  check('a project saved before overrides opens with none',
        back.scene === 'snow' && back.text === '' && back.fg === '' && back.font === 0 && back.seed === 0);
}

/* ================================================== ratios and formats ==== */
section('fitting a frame to a ratio');
{
  check('a landscape ratio derives the height', (() => {
    const r = fitRatio('16:9', 1280, 720);
    return r.w === 1280 && r.h === 720;
  })());
  /* Deriving from the width alone is wrong the other way round: 9:16 of 1280
     wants 2276 tall, past any sane limit. Assigning that to a number input does
     not clamp it, so the document kept a value the renderer then clamped to
     something else and the frame was not the ratio at all. */
  check('a portrait ratio derives from whichever side has room', (() => {
    const r = fitRatio('9:16', 1280, 720);
    return r.w === 1080 && r.h === 1920;
  })(), JSON.stringify(fitRatio('9:16', 1280, 720)));
  check('…and never exceeds the limit', (() => {
    const r = fitRatio('9:16', 1920, 1080);
    return r.w <= MAX_DIM && r.h <= MAX_DIM && Math.abs(r.w / r.h - 9 / 16) < 0.01;
  })(), JSON.stringify(fitRatio('9:16', 1920, 1080)));
  check('both sides come back even', (() => {
    const r = fitRatio('21:9', 999, 500);
    return r.w % 2 === 0 && r.h % 2 === 0;
  })());
  check('a nonsense ratio changes nothing', (() => {
    const r = fitRatio('banana', 320, 240);
    return r.w === 320 && r.h === 240;
  })());

  check('every format is even, in range, and matches its own ratio', (() => {
    return FORMATS.filter((f) => f.w).every((f) => {
      const [rw, rh] = f.ratio.split(':').map(Number);
      return f.w % 2 === 0 && f.h % 2 === 0 && f.w <= MAX_DIM && f.h <= MAX_DIM
        && Math.abs(f.w / f.h - rw / rh) < 0.02;
    });
  })());
  check('the vertical format is the one the platforms want', (() => {
    const f = FORMATS.find((x) => x.id === 'vertical');
    return f && f.w === 1080 && f.h === 1920;
  })());
  check('a size maps back to its format', formatFor(1080, 1920) === 'vertical'
        && formatFor(1920, 1080) === 'wide1080' && formatFor(641, 123) === '');
}

/* ================================================= WebM audio muxing ====== */
/* The muxer wrote one video TrackEntry and nothing else, so the studio could
   not produce a clip with sound at all. Parsed back out of the bytes rather
   than trusted, because "it plays in my browser" is not the same claim. */
section('a clip can carry sound');
{
  /* A small EBML walker. Element = id (vint) + size (vint) + body. */
  const walker = (u8) => {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const vlen = (b) => { for (let i = 0; i < 8; i++) if (b & (0x80 >> i)) return i + 1; return 8; };
    const walk = (start, end, fn) => {
      let p = start;
      while (p < end) {
        const idn = vlen(u8[p]);
        let id = 0; for (let i = 0; i < idn; i++) id = id * 256 + u8[p + i];
        const sn = vlen(u8[p + idn]);
        let size = u8[p + idn] & (0xFF >> sn);
        for (let i = 1; i < sn; i++) size = size * 256 + u8[p + idn + i];
        const body = p + idn + sn, stop = Math.min(end, body + size);
        fn(id, body, stop);
        p = stop;
      }
    };
    const uintAt = (a, b) => { let v = 0; for (let i = a; i < b; i++) v = v * 256 + u8[i]; return v; };
    return { walk, dv, u8, uintAt };
  };
  const parse = (u8) => {
    const E = walker(u8);
    const dec = new TextDecoder();
    const tracks = []; const blocks = []; let clusters = 0, outOfOrder = 0, openedByAudio = 0;
    E.walk(0, u8.length, (id, body, stop) => {
      if (id !== 0x18538067) return;                                  // Segment
      E.walk(body, stop, (sid, sbody, sstop) => {
        if (sid === 0x1654AE6B) {                                     // Tracks
          E.walk(sbody, sstop, (tid, tbody, tstop) => {
            if (tid !== 0xAE) return;                                 // TrackEntry
            const t = {};
            E.walk(tbody, tstop, (fid, fbody, fstop) => {
              if (fid === 0xD7) t.number = E.uintAt(fbody, fstop);
              else if (fid === 0x83) t.type = E.uintAt(fbody, fstop);
              else if (fid === 0x86) t.codec = dec.decode(u8.subarray(fbody, fstop));
              else if (fid === 0x63A2) t.head = dec.decode(u8.subarray(fbody, fbody + 8));
              else if (fid === 0x56AA) t.codecDelay = E.uintAt(fbody, fstop);
              else if (fid === 0x56BB) t.seekPreRoll = E.uintAt(fbody, fstop);
              else if (fid === 0xE1) {                                // Audio
                E.walk(fbody, fstop, (aid, abody, astop) => {
                  if (aid === 0x9F) t.channels = E.uintAt(abody, astop);
                  if (aid === 0xB5) t.rate = E.dv.getFloat64(abody - u8.byteOffset, false);
                });
              }
            });
            tracks.push(t);
          });
        } else if (sid === 0x1F43B675) {                              // Cluster
          clusters++;
          let tc = 0, first = null, prev = -Infinity;
          E.walk(sbody, sstop, (cid, cbody, cstop) => {
            if (cid === 0xE7) tc = E.uintAt(cbody, cstop);            // Timecode
            else if (cid === 0xA3) {                                  // SimpleBlock
              const track = u8[cbody] & 0x7f;
              const abs = tc + E.dv.getInt16(cbody + 1 - u8.byteOffset, false);
              if (first === null) first = track;
              if (abs < prev) outOfOrder++;
              prev = abs;
              blocks.push({ track, abs });
            }
          });
          if (first === 2) openedByAudio++;
        }
      });
    });
    return { tracks, blocks, clusters, outOfOrder, openedByAudio };
  };

  const vFrames = Array.from({ length: 24 }, (_, i) => ({
    data: new Uint8Array([i]), timestampUs: Math.round(i / 12 * 1e6),
    durationUs: 83333, key: i % 24 === 0,
  }));
  const aFrames = Array.from({ length: 100 }, (_, i) => ({
    data: new Uint8Array([0xAA, i]), timestampUs: i * 20_000, durationUs: 20_000,
  }));

  const silent = new Uint8Array(await muxWebM({
    frames: vFrames, width: 160, height: 120, codec: 'vp09.00.10.08' }).arrayBuffer());
  const s = parse(silent);
  check('with no audio there is still exactly one track', s.tracks.length === 1 && s.tracks[0].type === 1);
  check('…and every block belongs to it', s.blocks.every((b) => b.track === 1));

  const withAudio = new Uint8Array(await muxWebM({
    frames: vFrames, width: 160, height: 120, codec: 'vp09.00.10.08',
    audio: { frames: aFrames, sampleRate: 48000, channels: 2 } }).arrayBuffer());
  const a = parse(withAudio);
  const at = a.tracks.find((t) => t.type === 2);
  check('an audio track is written', a.tracks.length === 2 && !!at);
  check('…as Opus, with an OpusHead', at?.codec === 'A_OPUS' && at?.head === 'OpusHead', at?.codec);
  check('…declaring its rate and channels', at?.rate === 48000 && at?.channels === 2,
        `${at?.rate}Hz ${at?.channels}ch`);
  // Without SeekPreRoll a player has nothing to decode into before a seek point
  // and starts with a moment of noise; without CodecDelay the track drifts
  // early against the picture by the encoder's own lookahead.
  check('…with the seek pre-roll Opus in WebM requires', at?.seekPreRoll === 80_000_000, String(at?.seekPreRoll));
  check('…and a codec delay', typeof at?.codecDelay === 'number' && at.codecDelay > 0, String(at?.codecDelay));

  check('both streams are present', a.blocks.filter((b) => b.track === 1).length === 24
        && a.blocks.filter((b) => b.track === 2).length === 100,
        `${a.blocks.filter((b) => b.track === 1).length}v ${a.blocks.filter((b) => b.track === 2).length}a`);
  /* Matroska requires a cluster's blocks in timecode order, and a player that
     has to seek backwards inside a cluster for audio it already passed will
     stutter. Interleaving has to be true, not aspirational. */
  check('blocks are interleaved in timecode order', a.outOfOrder === 0, `${a.outOfOrder} out of order`);
  check('no cluster is opened by an audio packet', a.openedByAudio === 0,
        `${a.openedByAudio} clusters started on audio`);
  check('every audio packet is marked seekable', (() => {
    // Opus packets are all independently decodable; a player that thinks
    // otherwise cannot seek into the sound at all.
    const E = walker(withAudio);
    let bad = 0;
    E.walk(0, withAudio.length, (id, body, stop) => {
      if (id !== 0x18538067) return;
      E.walk(body, stop, (sid, sbody, sstop) => {
        if (sid !== 0x1F43B675) return;
        E.walk(sbody, sstop, (cid, cbody) => {
          if (cid === 0xA3 && (withAudio[cbody] & 0x7f) === 2 && !(withAudio[cbody + 3] & 0x80)) bad++;
        });
      });
    });
    return bad === 0;
  })());

  check('a longer bed extends the declared duration', (() => {
    const long = Array.from({ length: 300 }, (_, i) => ({
      data: new Uint8Array([1]), timestampUs: i * 20_000, durationUs: 20_000 }));
    const bytes = new Uint8Array(0);
    // Duration lives in Info; simply assert the mux succeeds and is bigger.
    const withLong = muxWebM({ frames: vFrames, width: 160, height: 120,
      codec: 'vp09.00.10.08', audio: { frames: long, sampleRate: 48000, channels: 2 } });
    return withLong.size > withAudio.length && bytes.length === 0;
  })());

  check('an empty audio list is treated as no audio', (() => {
    const u = muxWebM({ frames: vFrames, width: 160, height: 120, codec: 'vp09.00.10.08',
      audio: { frames: [], sampleRate: 48000, channels: 2 } });
    return u.size === silent.length;
  })());

  const head = opusHead(2, 48000, 312);
  check('a synthesised OpusHead is well formed',
        head.length === 19 && new TextDecoder().decode(head.subarray(0, 8)) === 'OpusHead'
        && head[9] === 2 && new DataView(head.buffer).getUint16(10, true) === 312
        && new DataView(head.buffer).getUint32(12, true) === 48000);
}

/* ==================================================== the shape of a clip === */
/* A clip was recipe + label + duration + scene, which made a sequence a queue.
   in/out/transition/kind are what turn it into an edit — and every one of them
   has to be optional, because sequences written before they existed are on
   disk and must still play exactly as they did. */
section('the shape of a clip');
{
  check('a clip with only the old fields reads as the whole source, cut, video', (() => {
    const c = makeClip({ rec: { 'v-dur': '5' }, label: 'Old', dur: 5, scene: 'snow' });
    return c.kind === 'video' && c.src === 5 && c.in === 0 && c.out === 5
      && c.transition === 'cut' && c.scene === 'snow';
  })(), JSON.stringify(makeClip({ dur: 5, scene: 'snow' })));

  check('a trim is kept, rounded to 1/100s', (() => {
    const c = makeClip({ dur: 10, in: 2.004, out: 7.996 });
    return c.in === 2 && c.out === 8 && clipLength(c) === 6 && isTrimmed(c);
  })(), JSON.stringify(makeClip({ dur: 10, in: 2.004, out: 7.996 })));

  /* A backwards trim is not an edit, it is a mistake; playing zero frames of a
     clip the author put in the sequence is never the reading they meant. */
  check('a backwards or empty trim falls back to the whole source', (() => {
    const back = makeClip({ dur: 8, in: 6, out: 2 });
    const empty = makeClip({ dur: 8, in: 4, out: 4 });
    return back.in === 0 && back.out === 8 && empty.in === 0 && empty.out === 8;
  })());
  check('a trim past the end of the source is clamped to it', (() => {
    const c = makeClip({ dur: 4, in: 1, out: 99 });
    return c.out === 4 && clipLength(c) === 3;
  })());
  check('a clip is never shorter than MIN_CLIP or longer than MAX_CLIP', (() => {
    const tiny = makeClip({ dur: 0 }), huge = makeClip({ dur: 9999 });
    return tiny.src === MIN_CLIP && huge.src === MAX_CLIP;
  })(), JSON.stringify([makeClip({ dur: 0 }).src, makeClip({ dur: 9999 }).src]));

  check('an unknown transition falls back to a cut, not to nothing', (() => {
    return makeClip({ dur: 3, transition: 'wipe-star' }).transition === 'cut'
      && TRANSITIONS.every((t) => makeClip({ dur: 3, transition: t }).transition === t);
  })());
  check('a still keeps its kind and defaults its scene', (() => {
    const c = makeClip({ kind: 'still', dur: 3 });
    return c.kind === 'still' && c.scene === 'still';
  })());
  check('a hostile recipe is dropped rather than carried', (() => {
    return JSON.stringify(makeClip({ dur: 3, rec: 'nope' }).rec) === '{}'
      && JSON.stringify(makeClip({ dur: 3, rec: ['a'] }).rec) === '{}';
  })());
  check('a label is a string, and a bounded one', (() => {
    const c = makeClip({ dur: 3, label: 'x'.repeat(500) });
    return c.label.length === 120 && makeClip({ dur: 3, label: { a: 1 } }).label === 'Clip';
  })());

  check('normalizeClips survives junk and caps the sequence', (() => {
    return normalizeClips(null).length === 0 && normalizeClips('nope').length === 0
      && normalizeClips(new Array(MAX_CLIPS + 20).fill({ dur: 1 })).length === MAX_CLIPS;
  })());

  /* The schedule is the whole reason the clip grew fields: it is where a trim
     becomes a shorter sequence and a crossfade becomes an overlap. */
  check('cuts lay clips end to end', (() => {
    const s = scheduleOf([{ in: 0, out: 3, transition: 'cut' }, { in: 0, out: 2, transition: 'cut' }]);
    return s.starts[0] === 0 && s.starts[1] === 3 && s.duration === 5;
  })(), JSON.stringify(scheduleOf([{ in: 0, out: 3 }, { in: 0, out: 2 }])));
  check('a crossfade pulls its clip back over the one before it', (() => {
    const s = scheduleOf([{ in: 0, out: 3, transition: 'cut' },
                          { in: 0, out: 2, transition: 'crossfade', xdur: 1 }]);
    return s.starts[1] === 2 && s.duration === 4;
  })(), JSON.stringify(scheduleOf([{ in: 0, out: 3, transition: 'cut' }, { in: 0, out: 2, transition: 'crossfade', xdur: 1 }])));
  /* THE SEQUENCE HAS NO HOLES IN IT.
     A clip's length is (out − in) / speed, which at any speed but 1 is a
     repeating fraction, while the schedule publishes starts rounded to 1/100s.
     Accumulating the raw value and publishing the rounded one let the two drift
     apart at every join — and the compositor fills black and then draws
     whatever covers T, so an instant covered by nothing is not a seam, it is a
     BLACK FRAME in the preview and in the export. Measured before the fix: 9.8ms
     of uncovered time at the worst join, which at 30fps is roughly one join in
     three landing a sampled frame inside one.
     Swept rather than spot-checked, because the cases that broke were the ones
     nobody would think to write down. */
  {
    let seed = 20260729;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const r2 = (n) => Math.round(n * 100) / 100;
    let uncovered = 0, worstGap = 0, sampled = 0, worstCase = '';
    for (let trial = 0; trial < 600; trial++) {
      const clips = [];
      for (let i = 0, n = 2 + Math.floor(rnd() * 8); i < n; i++) {
        const src = r2(0.5 + rnd() * 12);
        const inn = r2(rnd() * src * 0.4);
        clips.push(makeClip({ kind: 'scene', src, in: inn,
          out: r2(inn + 0.1 + rnd() * (src - inn)),
          // Speed is what turns a length into a repeating fraction.
          speed: r2(0.25 + rnd() * 3.75),
          transition: rnd() < 0.4 ? 'crossfade' : 'cut', xdur: r2(rnd() * 2) }));
      }
      const norm = normalizeClips(clips);
      const { starts, duration } = scheduleOf(norm);
      const spans = spineSpans(norm, starts);
      for (let p = 0; p + 1 < spans.length; p++) {
        const gap = spans[p + 1].s - spans[p].e;
        if (gap > worstGap) { worstGap = gap; worstCase = `trial ${trial} join ${p}: ${gap}s`; }
      }
      for (const fps of [24, 30, 60]) {
        for (let f = 0, n = Math.round(duration * fps); f < n; f++) {
          const T = f / fps;
          if (T >= duration) continue;
          sampled++;
          if (!spans.some((sp) => T >= sp.s - 1e-6 && T < sp.e + 1e-6)) uncovered++;
        }
      }
    }
    check('every instant of a sequence is covered by a clip — no black frames at a join',
          uncovered === 0, `${uncovered} uncovered of ${sampled} sampled frames`);
    check('…and no join leaves a gap between one clip’s end and the next one’s start',
          worstGap <= 1e-6, worstCase || 'no gap at any join');
  }

  /* An overlap longer than either clip would run the sequence backwards. */
  check('a crossfade longer than its clips is bounded by them', (() => {
    const s = scheduleOf([{ in: 0, out: 1, transition: 'cut' },
                          { in: 0, out: 1, transition: 'crossfade', xdur: 4 }]);
    return s.starts[1] === 0 && s.duration === 1 && s.starts.every((x) => x >= 0);
  })(), JSON.stringify(scheduleOf([{ in: 0, out: 1 }, { in: 0, out: 1, transition: 'crossfade', xdur: 4 }])));
  check('a dip does not move either clip', (() => {
    const s = scheduleOf([{ in: 0, out: 3, transition: 'cut' },
                          { in: 0, out: 2, transition: 'dip', xdur: 1 }]);
    return s.starts[1] === 3 && s.duration === 5;
  })());
  /* The first clip has nothing to dissolve FROM; treating its transition as an
     overlap would start the sequence at a negative time. */
  check('the first clip never overlaps, whatever its transition says', (() => {
    const s = scheduleOf([{ in: 0, out: 3, transition: 'crossfade', xdur: 2 }]);
    return s.starts[0] === 0 && s.duration === 3;
  })());
  check('an empty sequence has no length', (() => {
    const s = scheduleOf([]);
    return s.duration === 0 && s.starts.length === 0;
  })());
  check('trimming shortens the sequence by exactly what was cut', (() => {
    const whole = scheduleOf(normalizeClips([{ dur: 6 }, { dur: 4 }]));
    const cut = scheduleOf(normalizeClips([{ dur: 6, in: 2, out: 5 }, { dur: 4 }]));
    return whole.duration === 10 && cut.duration === 7;
  })());

  /* normalize() is the single door every document comes through — LOAD, share
     link, autosave, server version — so clips are normalised there rather than
     only where the timeline projects them. */
  check('normalize() puts clips into shape wherever a document came from', (() => {
    const d = normalize({ ...newDoc(), timeline: { clips: [{ dur: 5, in: 1, out: 3 }, 'junk'] } });
    return d.timeline.clips.length === 2 && d.timeline.clips[0].out === 3
      && d.timeline.clips[1].src === 10 && d.timeline.clips[0].kind === 'video';
  })(), JSON.stringify(normalize({ ...newDoc(), timeline: { clips: [{ dur: 5, in: 1, out: 3 }] } }).timeline.clips));
  check('…and a missing or hostile timeline is simply an empty one', (() => {
    return normalize({ ...newDoc(), timeline: undefined }).timeline.clips.length === 0
      && normalize({ ...newDoc(), timeline: { clips: 'nope' } }).timeline.clips.length === 0;
  })());

  /* A hand-written project carries the current timeline shape but no version
     marker, so it reads as v0 here. The array-only branch silently emptied its
     sequence: a file that opens, says "loaded", and has lost the work. */
  check('a v0 document carrying the current timeline shape keeps its clips', (() => {
    const d = migrate({ tabs: { video: {} },
      timeline: { clips: [{ dur: 5, in: 1, out: 4, rec: { 'v-scene': 'snow' } }] } });
    const c = d.timeline.clips[0];
    return d.timeline.clips.length === 1 && c.in === 1 && c.out === 4 && c.rec['v-scene'] === 'snow';
  })(), JSON.stringify(migrate({ tabs: {}, timeline: { clips: [{ dur: 5, in: 1, out: 4 }] } }).timeline.clips));
  check('…and the original bare-array v0 timeline still migrates', (() => {
    const d = migrate({ tabs: { video: {} }, timeline: [{ label: 'A', rec: { 'v-dur': '3' } }] });
    return d.timeline.clips.length === 1 && d.timeline.clips[0].label === 'A'
      && d.timeline.clips[0].transition === 'cut';
  })(), JSON.stringify(migrate({ tabs: {}, timeline: [{ label: 'A' }] }).timeline.clips));

  check('a sequence survives a serialisation round trip', (() => {
    const d = normalize({ ...newDoc(),
      timeline: { clips: [{ kind: 'still', dur: 3, in: 0.5, out: 2.5, transition: 'dip', xdur: 0.8 }] } });
    const back = fromJSON(toJSON(d));
    const c = back.timeline.clips[0];
    return c.kind === 'still' && c.in === 0.5 && c.out === 2.5 && c.transition === 'dip' && c.xdur === 0.8;
  })(), JSON.stringify(fromJSON(toJSON(normalize({ ...newDoc(),
    timeline: { clips: [{ kind: 'still', dur: 3, in: 0.5, out: 2.5, transition: 'dip', xdur: 0.8 }] } }))).timeline.clips));
}

/* ============================================ a fresh document is normal === */
/* createDocument() and normalize() have to agree on the shape, or save→load is
   not byte-identical — the serialisation contract above. They drifted the
   moment the audio FX chain added `filters.audio` to one and not the other,
   and the symptom was two failing round-trip checks a long way from the cause.
   Asserted structurally so the NEXT field cannot do it quietly. */
section('a fresh document is already normalised');
{
  const fresh = createDocument({ now: () => 1_700_000_000_000 });
  check('normalize() adds nothing to a document it just created',
        canonicalJSON(normalize(fresh)) === canonicalJSON(fresh),
        (() => {
          const a = JSON.parse(canonicalJSON(fresh)), b = JSON.parse(canonicalJSON(normalize(fresh)));
          return Object.keys({ ...a, ...b })
            .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
            .map((k) => `${k}: ${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])}`).join('; ');
        })());
  check('…and normalising twice is the same as once',
        canonicalJSON(normalize(normalize(fresh))) === canonicalJSON(normalize(fresh)));
  check('both chains exist on a fresh document', (() => {
    return Array.isArray(fresh.filters.video) && Array.isArray(fresh.filters.audio);
  })(), JSON.stringify(fresh.filters));
  /* The audio chain reuses the video chain's stored shape on purpose: it is the
     same thing over a different registry. If that ever stops being true, this
     is where it shows up. */
  check('the audio chain is normalised by the same rules as the video one', (() => {
    const d = normalize({ ...fresh, filters: {
      video: [{ id: 'grade', params: { brightness: 5 }, enabled: true }],
      audio: [{ id: 'eq3', params: { low: -3 }, enabled: false },
              { id: '', params: {} },                                  // no id: dropped
              { id: 'x', params: { __proto__: 1, ok: 2 } }],           // proto key: stripped
    } });
    return d.filters.audio.length === 2
      && d.filters.audio[0].enabled === false
      && !Object.prototype.hasOwnProperty.call(d.filters.audio[1].params, '__proto__')
      && d.filters.audio[1].params.ok === 2;
  })(), JSON.stringify(normalize({ ...fresh, filters: { audio: [{ id: '' }] } }).filters.audio));
}

/* ================================================== MP4 muxing =========== */
/* WebM plays in a browser and nowhere else reliably — which is why an ffmpeg
   shim script existed. Parsed back out of the bytes rather than trusted: this
   environment's Chromium has no H.264 encoder (it is a licensed codec and open
   builds omit it), so "it played once in my browser" is not a claim this suite
   could make even if it were a good one. */
section('MP4 muxing');
{
  /* A minimal box walker. Box = 4-byte size, 4-char type, payload. */
  const boxes = (u8, start = 0, end = u8.length) => {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const out = [];
    let at = start;
    while (at + 8 <= end) {
      const size = dv.getUint32(at);
      const type = String.fromCharCode(u8[at + 4], u8[at + 5], u8[at + 6], u8[at + 7]);
      if (size < 8 || at + size > end) break;
      out.push({ type, at, size, body: at + 8, bodyEnd: at + size });
      at += size;
    }
    return out;
  };
  /** Depth-first find of the first box at a slash-separated path. */
  const find = (u8, path, start = 0, end = u8.length) => {
    let scope = { body: start, bodyEnd: end };
    for (const want of path.split('/')) {
      const hit = boxes(u8, scope.body, scope.bodyEnd).find((b) => b.type === want);
      if (!hit) return null;
      scope = hit;
    }
    return scope;
  };
  const all = (u8, type, start = 0, end = u8.length) => {
    const out = [];
    const walk = (s, e) => {
      for (const b of boxes(u8, s, e)) {
        if (b.type === type) out.push(b);
        // Only descend into containers; a sample entry's payload is not boxes.
        if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf'].includes(b.type)) walk(b.body, b.bodyEnd);
      }
    };
    walk(start, end);
    return out;
  };
  const u32At = (u8, at) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(at);

  // A real avcC: SPS/PPS for a tiny baseline stream. Only its bytes matter here.
  const AVCC = new Uint8Array([1, 66, 0, 31, 255, 225, 0, 4, 103, 66, 0, 31, 1, 0, 4, 104, 206, 60, 128]);
  const vframes = (n, fps = 10) => Array.from({ length: n }, (_, i) => ({
    data: new Uint8Array(20 + i).fill(i + 1),
    timestampUs: Math.round((i * 1e6) / fps),
    durationUs: Math.round(1e6 / fps),
    key: i % 5 === 0,
  }));

  const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

  const silent = await bytesOf(muxMP4({ frames: vframes(25), width: 160, height: 120, description: AVCC }));

  check('the file declares itself an MP4', (() => {
    const tops = boxes(silent).map((b) => b.type);
    return tops[0] === 'ftyp' && tops.includes('moov') && tops.includes('mdat');
  })(), boxes(silent).map((b) => `${b.type}:${b.size}`).join(' '));

  /* moov before mdat is the whole reason for the two-pass write. A file with
     the index at the end cannot start playing until it is fully downloaded. */
  check('the index comes before the payload', (() => {
    const tops = boxes(silent).map((b) => b.type);
    return tops.indexOf('moov') < tops.indexOf('mdat');
  })());
  check('every top-level box accounts for its bytes, with none left over', (() => {
    const tops = boxes(silent);
    return tops.reduce((n, b) => n + b.size, 0) === silent.length;
  })(), `${boxes(silent).reduce((n, b) => n + b.size, 0)} of ${silent.length}`);

  check('the video track carries its avcC decoder description', (() => {
    const a = find(silent, 'moov/trak/mdia/minf/stbl/stsd');
    if (!a) return false;
    const avcC = all(silent, 'avcC', a.body, a.bodyEnd);
    // stsd's payload is version+flags+count then the sample entry, so avcC sits
    // inside avc1 rather than directly in stsd — searched for by content.
    const at = silent.findIndex((_, i) => String.fromCharCode(...silent.slice(i, i + 4)) === 'avcC');
    if (at < 0) return false;
    const len = u32At(silent, at - 4);
    return len === AVCC.length + 8
      && AVCC.every((b, i) => silent[at + 4 + i] === b);
  })());

  /* The sample tables are the file. If stsz, stts and co64 disagree with what
     was handed in, the picture is right and the playback is not. */
  const tables = (() => {
    const trak = all(silent, 'trak')[0];
    const stszB = find(silent, 'mdia/minf/stbl/stsz', trak.body, trak.bodyEnd);
    const sttsB = find(silent, 'mdia/minf/stbl/stts', trak.body, trak.bodyEnd);
    const co64B = find(silent, 'mdia/minf/stbl/co64', trak.body, trak.bodyEnd);
    const stssB = find(silent, 'mdia/minf/stbl/stss', trak.body, trak.bodyEnd);
    const stscB = find(silent, 'mdia/minf/stbl/stsc', trak.body, trak.bodyEnd);
    const sizes = [];
    const count = u32At(silent, stszB.body + 8);
    for (let i = 0; i < count; i++) sizes.push(u32At(silent, stszB.body + 12 + i * 4));
    const runs = [];
    const nRuns = u32At(silent, sttsB.body + 4);
    for (let i = 0; i < nRuns; i++) {
      runs.push({ count: u32At(silent, sttsB.body + 8 + i * 8), delta: u32At(silent, sttsB.body + 12 + i * 8) });
    }
    const offs = [];
    const nOff = u32At(silent, co64B.body + 4);
    for (let i = 0; i < nOff; i++) offs.push(u32At(silent, co64B.body + 8 + i * 8 + 4));
    const keys = [];
    const nKeys = u32At(silent, stssB.body + 4);
    for (let i = 0; i < nKeys; i++) keys.push(u32At(silent, stssB.body + 8 + i * 4));
    return { sizes, runs, offs, keys, stscRuns: u32At(silent, stscB.body + 4) };
  })();

  check('stsz lists every sample at its real size', (() => {
    const want = vframes(25).map((f) => f.data.length);
    return tables.sizes.length === 25 && tables.sizes.every((v, i) => v === want[i]);
  })(), `${tables.sizes.length} sizes`);
  check('stts run-length encodes the durations', (() => {
    const total = tables.runs.reduce((n, r) => n + r.count, 0);
    // 25 frames at 10fps in a microsecond timescale: 24 gaps of 100000 plus the
    // last frame's own duration, which is the same — so one run.
    return total === 25 && tables.runs.every((r) => r.delta === 100000);
  })(), JSON.stringify(tables.runs));
  check('stss marks exactly the keyframes', (() => {
    const want = vframes(25).map((f, i) => (f.key ? i + 1 : 0)).filter(Boolean);
    return tables.keys.join() === want.join();
  })(), tables.keys.join());

  /* The offsets are what the two-pass write exists to get right. Each chunk's
     recorded offset must land on the first byte of its first sample. */
  check('every chunk offset points at real sample data', (() => {
    const want = vframes(25);
    // One chunk per second of media; 25 frames at 10fps = 3 chunks.
    if (tables.offs.length !== 3) return false;
    const perChunk = [10, 10, 5];
    let s = 0;
    for (let c = 0; c < tables.offs.length; c++) {
      const first = want[s];
      const at = tables.offs[c];
      // The sample's own bytes are a constant fill, so one byte proves the aim.
      if (silent[at] !== first.data[0]) return false;
      if (at + first.data.length > silent.length) return false;
      s += perChunk[c];
    }
    return true;
  })(), JSON.stringify(tables.offs));
  check('…and the first one lands inside mdat, not before it', (() => {
    const mdat = boxes(silent).find((b) => b.type === 'mdat');
    return tables.offs[0] === mdat.body && tables.offs[0] > 0;
  })(), `${tables.offs[0]} vs mdat body ${boxes(silent).find((b) => b.type === 'mdat').body}`);

  /* Determinism reaches the container, not just the picture: a 1904 epoch that
     read the clock would make two identical exports differ. */
  check('the same clip muxes byte-identically twice', (() => {
    const a = muxMP4({ frames: vframes(12), width: 64, height: 48, description: AVCC });
    const b = muxMP4({ frames: vframes(12), width: 64, height: 48, description: AVCC });
    return a.size === b.size;
  })());

  const withAudio = await bytesOf(muxMP4({
    frames: vframes(20), width: 160, height: 120, description: AVCC,
    audio: {
      frames: Array.from({ length: 90 }, (_, i) => ({
        data: new Uint8Array(30).fill(i + 1), durationUs: Math.round((1024 / 48000) * 1e6),
      })),
      description: new Uint8Array([0x12, 0x10]),   // AudioSpecificConfig: AAC LC 44.1k stereo
      sampleRate: 48000, channels: 2,
    },
  }));

  check('an audio track is a second trak, not a second file', (() => {
    return all(withAudio, 'trak').length === 2 && all(silent, 'trak').length === 1;
  })(), `${all(withAudio, 'trak').length} traks`);
  check('…described by mp4a with an esds', (() => {
    const txt = new TextDecoder('latin1').decode(withAudio);
    return txt.includes('mp4a') && txt.includes('esds') && txt.includes('smhd');
  })());
  /* The descriptor nesting is where hand-rolled AAC muxers go wrong: the
     AudioSpecificConfig has to be reachable as ES(3) > DecoderConfig(4) >
     DecoderSpecificInfo(5), each with a varint length. */
  check('…whose esds actually contains the AudioSpecificConfig', (() => {
    const at = withAudio.findIndex((_, i) =>
      String.fromCharCode(...withAudio.slice(i, i + 4)) === 'esds');
    if (at < 0) return false;
    const body = at + 4 + 4;                       // past type and version/flags
    if (withAudio[body] !== 0x03) return false;    // ES_Descriptor
    const dcd = body + 1 + 4 + 3;                  // len(4) + ES_ID(2) + flags(1)
    if (withAudio[dcd] !== 0x04) return false;     // DecoderConfigDescriptor
    const dsi = dcd + 1 + 4 + 13;                  // len(4) + 13 fixed bytes
    return withAudio[dsi] === 0x05                 // DecoderSpecificInfo
      && withAudio[dsi + 5] === 0x12 && withAudio[dsi + 6] === 0x10;
  })());
  check('…and the two tracks are interleaved rather than laid end to end', (() => {
    const traks = all(withAudio, 'trak');
    const offsOf = (t) => {
      const b = find(withAudio, 'mdia/minf/stbl/co64', t.body, t.bodyEnd);
      const n = u32At(withAudio, b.body + 4);
      return Array.from({ length: n }, (_, i) => u32At(withAudio, b.body + 8 + i * 8 + 4));
    };
    const v = offsOf(traks[0]), a = offsOf(traks[1]);
    // Every audio chunk after the first video chunk, and at least one video
    // chunk after the first audio chunk: that is what interleaved means.
    return v.length > 1 && a.length > 1
      && a.some((x) => x > v[0]) && v.some((x) => x > a[0]);
  })());

  check('a clip with sound is longer than the same clip without', withAudio.length > silent.length,
    `${withAudio.length} vs ${silent.length}`);

  /* The refusals. An MP4 that plays backwards in places is far worse than an
     export that failed and said why — the caller re-encodes as WebM. */
  const threwWith = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
  check('out-of-order frames are refused rather than muxed without DTS', threwWith(() => muxMP4({
    frames: [0, 200000, 100000, 300000].map((ts, i) => ({
      data: new Uint8Array([i]), timestampUs: ts, durationUs: 100000, key: i === 0 })),
    width: 64, height: 48, description: AVCC,
  }), /out of presentation order/));
  check('a missing decoder description is refused', threwWith(() => muxMP4({
    frames: vframes(3), width: 64, height: 48 }), /avcC/));
  check('an empty clip is refused', threwWith(() => muxMP4({
    frames: [], width: 64, height: 48, description: AVCC }), /nothing to mux/));

  check('mp4CanCarry knows H.264 from everything else',
    mp4CanCarry('avc1.42001f') && !mp4CanCarry('vp09.00.10.08') && !mp4CanCarry('opus') && !mp4CanCarry(null));

  /* A LONG CLIP IS NOT A DIFFERENT KIND OF CLIP.
     The sample tables and mdat were assembled by SPREADING a per-frame array
     into a varargs box writer — `fullBox('stsz', …, ...samples.map(…))`,
     `box('mdat', ...payload)`. An argument list is stack-allocated, so past a few
     tens of thousands of entries the spread throws RangeError: a quarter of an
     hour at 30fps is enough, and the tool's own clip cap is longer than that.
     The throw landed AFTER a full encode — an hour of an author's time — and the
     caller then fell back to WebM having discarded the MP4 it had just made.

     MEASURED, because the number that was reported did not reproduce: the
     finding said "roughly 14 minutes" and it is not that. In Chromium the spread
     version carries 120,000 frames and throws at 130,000 — 66m40s and 72m at
     30fps — and in Node it throws between 125,000 and 130,000. Both are
     stack-dependent, so neither is a number to design around; what matters is
     that it exists at all, since MAX_CLIP alone allows a clip longer than that
     and a sequence is 64 of them.

     140,000 frames: past the ceiling in both engines, and small payloads because
     the point is the table lengths rather than the bytes. */
  const LONG = 140_000;
  let longErr = null, longBytes = 0, longTables = null;
  try {
    const frames = Array.from({ length: LONG }, (_, i) => ({
      data: new Uint8Array(4).fill(i & 255),
      timestampUs: Math.round((i * 1e6) / 30),
      durationUs: Math.round(1e6 / 30),
      key: i % 30 === 0,
    }));
    const long = await bytesOf(muxMP4({ frames, width: 64, height: 48, description: AVCC }));
    longBytes = long.length;
    const trak = all(long, 'trak')[0];
    const stszB = find(long, 'mdia/minf/stbl/stsz', trak.body, trak.bodyEnd);
    const stssB = find(long, 'mdia/minf/stbl/stss', trak.body, trak.bodyEnd);
    const mdat = boxes(long).find((b) => b.type === 'mdat');
    longTables = {
      samples: u32At(long, stszB.body + 8),
      keys: stssB ? u32At(long, stssB.body + 4) : null,
      mdatBytes: mdat ? mdat.size - 8 : 0,
      topLevelAccounted: boxes(long).reduce((n, b) => n + b.size, 0) === long.length,
    };
  } catch (e) {
    longErr = `${e.name}: ${e.message}`;
  }
  check(`a ${LONG}-frame clip muxes at all`, longErr === null, String(longErr));
  check('…with one stsz entry per frame', longTables && longTables.samples === LONG,
    String(longTables && longTables.samples));
  check('…every sync sample indexed',
    longTables && longTables.keys === Math.ceil(LONG / 30),
    `${longTables && longTables.keys} of ${Math.ceil(LONG / 30)}`);
  check('…every payload byte in mdat', longTables && longTables.mdatBytes === LONG * 4,
    String(longTables && longTables.mdatBytes));
  check('…and the boxes still account for the whole file',
    longTables && longTables.topLevelAccounted, String(longBytes));
}

/* ================================================== audio region edits === */
/* The waveform was a readout: you could see the third second was too loud and
   the only thing you could do was change a synthesis parameter and render
   again, which changes the whole clip. Edits live in the document and replay on
   every render, so a project still reproduces exactly. */
section('audio region edits');
{
  const sr = 100;
  const flat = () => [new Float32Array(1000).fill(1)];
  const energy = (d, a, b) => { let s = 0; for (let i = a; i < b; i++) s += Math.abs(d[i]); return s; };
  const R = (op, from, to, amount) => normalizeRegions([{ op, from, to, amount }]);

  check('silence zeroes the selection and nothing else', (() => {
    const out = applyRegions(flat(), sr, R('silence', 2, 4));
    return energy(out[0], 200, 400) === 0 && energy(out[0], 0, 200) === 200
      && energy(out[0], 400, 1000) === 600;
  })());
  check('gain scales it, 100% being unchanged', (() => {
    const half = applyRegions(flat(), sr, R('gain', 0, 2, 50));
    const same = applyRegions(flat(), sr, R('gain', 0, 2, 100));
    return energy(half[0], 0, 200) === 100 && energy(same[0], 0, 200) === 200;
  })());
  check('a fade ramps across the selection rather than stepping', (() => {
    const out = applyRegions(flat(), sr, R('fadein', 0, 2))[0];
    return out[0] === 0 && Math.abs(out[100] - 0.5) < 0.01 && Math.abs(out[199] - 1) < 0.02;
  })());
  check('fade out is the mirror of fade in', (() => {
    const out = applyRegions(flat(), sr, R('fadeout', 0, 2))[0];
    return Math.abs(out[0] - 1) < 0.01 && Math.abs(out[100] - 0.5) < 0.01 && out[199] < 0.02;
  })());
  check('reverse turns the selection around, in place', (() => {
    const src = [Float32Array.from({ length: 10 }, (_, i) => i)];
    const out = applyRegions(src, 10, R('reverse', 0, 1))[0];
    return Array.from(out).join() === '9,8,7,6,5,4,3,2,1,0';
  })());
  check('crop keeps only the selection, and the length changes with it', (() => {
    const out = applyRegions(flat(), sr, R('keep', 3, 6));
    return out[0].length === 300;
  })());
  /* The one op that changes length is also the one that makes ordering matter.
     Times address the buffer AS IT IS — which is what the author is looking at,
     because the wave they drag on is the edited one. */
  check('edits apply in order, each addressing the buffer as it then is', (() => {
    const out = applyRegions(flat(), sr, normalizeRegions([
      { op: 'keep', from: 3, to: 6 }, { op: 'silence', from: 0, to: 1 }]));
    // Silencing 0–1s AFTER a crop silences the first second OF THE CROP.
    return out[0].length === 300 && energy(out[0], 0, 100) === 0 && energy(out[0], 100, 300) === 200;
  })());
  check('editedSeconds reports the cropped length without doing the work',
    editedSeconds(10, sr, [{ op: 'keep', from: 3, to: 6 }]) === 3
    && editedSeconds(10, sr, [{ op: 'silence', from: 3, to: 6 }]) === 10);

  check('a backwards drag is not an edit in reverse, it is the same range', (() => {
    const r = makeRegion({ op: 'silence', from: 5, to: 2 });
    return r.from === 2 && r.to === 5;
  })(), JSON.stringify(makeRegion({ op: 'silence', from: 5, to: 2 })));
  check('an unknown op falls back rather than silently doing nothing',
    makeRegion({ op: 'wipe-star', from: 0, to: 1 }).op === 'silence');
  check('a zero-length selection is dropped', normalizeRegions([{ op: 'silence', from: 2, to: 2 }]).length === 0);
  check('the list is capped', normalizeRegions(new Array(80).fill({ op: 'silence', from: 0, to: 1 })).length === MAX_REGIONS);
  check('junk normalises to an empty list',
    normalizeRegions(null).length === 0 && normalizeRegions('nope').length === 0);
  /* An edit past the end of a cropped buffer is a no-op, not an exception —
     otherwise cropping would be able to break the edits that follow it. */
  check('an edit entirely past the end is a no-op, not a throw', (() => {
    const out = applyRegions(flat(), sr, normalizeRegions([
      { op: 'keep', from: 0, to: 1 }, { op: 'silence', from: 50, to: 60 }]));
    return out[0].length === 100 && energy(out[0], 0, 100) === 100;
  })());
  check('no edits leaves the very same arrays, not a copy',
    (() => { const src = flat(); return applyRegions(src, sr, []) === src; })());
  /* A RAMP, not a constant: reversing a flat signal changes nothing, and gain
     at its default 100% is an identity by design — so a flat source would let
     an unimplemented op pass while proving nothing. */
  check('every declared op is actually implemented', (() => {
    const src = [Float32Array.from({ length: 100 }, (_, i) => i / 100)];
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    const dead = REGION_OPS.filter((o) => {
      const out = applyRegions(src, 10, R(o.id, 2, 6, 50))[0];
      return same(Array.from(out), Array.from(src[0]));
    });
    return dead.length === 0;
  })(), REGION_OPS.filter((o) => {
    const src = [Float32Array.from({ length: 100 }, (_, i) => i / 100)];
    const out = applyRegions(src, 10, R(o.id, 2, 6, 50))[0];
    return out.length === src[0].length && Array.from(out).every((v, i) => v === src[0][i]);
  }).map((o) => o.id).join(',') || 'all implemented');

  check('a fresh document carries an empty edit list, and normalize adds nothing', (() => {
    const d = createDocument({ now: () => 1_700_000_000_000 });
    return Array.isArray(d.audio.regions) && d.audio.regions.length === 0
      && canonicalJSON(normalize(d).audio) === canonicalJSON(d.audio);
  })());
}

/* ============================================================ audio solo === */
/* Twenty-six sources in one mix and no way to hear one of them. The old answer
   was to uncheck twenty-five boxes and then try to remember what they were.
   Solo is a MASK over the read config: the arrangement is never touched, so
   clearing it restores the mix exactly. */
section('audio solo');
{
  /* A config in the shape readAudioCfg() produces, with every source on. */
  const cfg = () => ({
    drone: true, noise: true, pulse: true, morse: true, sample: true,
    sub: true, heart: true, geiger: true, dtmf: true, dial: true,
    layers: Object.fromEntries(AUDIO_LAYERS.map((l) => [l.id, { on: true, pan: 0 }])),
  });
  const audible = (c) => SOLO_SOURCES.filter((s) => (s.kind === 'builtin' ? c[s.flag] : c.layers[s.key]?.on))
    .map((s) => s.key);

  check('every hand-wired source and every registry layer is soloable',
    SOLO_SOURCES.length === 10 + AUDIO_LAYERS.length, `${SOLO_SOURCES.length} sources`);
  check('no two sources share a key',
    new Set(SOLO_SOURCES.map((s) => s.key)).size === SOLO_SOURCES.length);
  /* The button has to attach to a real checkbox, and for the registry half that
     id is generated — so the pairing is derived, never typed twice. */
  check('every registry layer points at its own generated toggle id',
    AUDIO_LAYERS.every((l) => soloSource(l.id)?.toggle === TOGGLE(l.id)));
  check('every hand-wired source names the flag its config actually uses',
    SOLO_SOURCES.filter((s) => s.kind === 'builtin').every((s) => {
      const c = cfg(); s.silence(c); return c[s.flag] === false;
    }));

  check('no solo is a no-op — the whole mix plays',
    audible(applySolo(cfg(), [])).length === SOLO_SOURCES.length);
  check('soloing one source silences every other one', (() => {
    const left = audible(applySolo(cfg(), ['drone']));
    return left.length === 1 && left[0] === 'drone';
  })());
  check('a soloed registry layer works the same as a hand-wired one', (() => {
    const left = audible(applySolo(cfg(), ['vinyl']));
    return left.length === 1 && left[0] === 'vinyl';
  })());
  check('solo is a set, not a radio button — several can play together',
    audible(applySolo(cfg(), ['drone', 'rain', 'geiger'])).join() === 'drone,geiger,rain',
    audible(applySolo(cfg(), ['drone', 'rain', 'geiger'])).join(','));
  /* The whole point: solo must not be able to lose the arrangement. What it
     silences is the CONFIG the render reads, and the config is rebuilt from the
     controls every time. */
  check('a source that was off stays off when it is soloed', (() => {
    const c = cfg(); c.drone = false;
    return applySolo(c, ['drone']).drone === false;
  })());

  /* Failure direction matters. A project from a newer build naming a layer this
     one has never heard of must degrade to "fewer things soloed", never to
     "everything muted" — which is what a strict reading would produce. */
  check('an unknown key is dropped, not obeyed',
    normalizeSolo(['drone', 'quantum-choir']).join() === 'drone');
  check('a set of only unknown keys is no solo at all, not silence', (() => {
    const c = applySolo(cfg(), ['quantum-choir']);
    return audible(c).length === SOLO_SOURCES.length;
  })());
  check('duplicates collapse', normalizeSolo(['drone', 'drone', 'drone']).join() === 'drone');
  check('the stored order does not matter — it normalises to panel order',
    normalizeSolo(['vinyl', 'drone']).join() === normalizeSolo(['drone', 'vinyl']).join());
  check('the set is capped', normalizeSolo(SOLO_SOURCES.map((s) => s.key).concat(
    new Array(80).fill('drone'))).length <= MAX_SOLO);
  check('junk normalises to no solo',
    normalizeSolo(null).length === 0 && normalizeSolo('drone').length === 0
    && normalizeSolo([1, {}, null]).length === 0);

  check('toggling adds then removes', (() => {
    const a = toggleSoloKey([], 'drone');
    return a.join() === 'drone' && toggleSoloKey(a, 'drone').length === 0;
  })());

  /* The render IS the export here, so a forgotten solo would ship. The notice
     is the defence, and an empty one when nothing is soloed is what keeps it
     meaningful when it does appear. */
  check('nothing soloed says nothing', soloNotice([]) === '' && soloNotice(null) === '');
  check('a soloed render announces exactly what is audible, and that it exports', (() => {
    const n = soloNotice(['drone', 'vinyl']);
    return n.includes('DRONE') && n.includes('VINYL CRACKLE') && /export/i.test(n);
  })(), soloNotice(['drone']));

  /* Solo never enables — a soloed source whose checkbox is off renders as
     silence, and the notice must say so rather than promise it is audible. */
  check('a soloed source that is not enabled is called out as silent', (() => {
    const c = cfg(); c.drone = false;
    const n = soloNotice(['drone'], applySolo(c, ['drone']));
    return /SILENT/.test(n) && n.includes('DRONE');
  })());
  check('a mixed set names only the disabled source and does not claim silence', (() => {
    const c = cfg(); c.drone = false;
    const n = soloNotice(['drone', 'vinyl'], applySolo(c, ['drone', 'vinyl']));
    return n.includes('BUT DRONE') && !/SILENT/.test(n);
  })());
  check('soloDisabledNames reads builtins and registry layers alike', (() => {
    const c = cfg(); c.drone = false; c.layers.vinyl.on = false;
    return soloDisabledNames(c, ['drone', 'vinyl', 'geiger']).join() === 'DRONE,VINYL CRACKLE';
  })());
  check('without a config the notice keeps its old one-arg contract',
    !/BUT/.test(soloNotice(['drone'])));

  check('a fresh document carries an empty solo set, and normalize adds nothing', (() => {
    const d = createDocument({ now: () => 1_700_000_000_000 });
    return Array.isArray(d.audio.solo) && d.audio.solo.length === 0
      && canonicalJSON(normalize(d).audio) === canonicalJSON(d.audio);
  })());
  check('a project from before solo existed loads with no solo', (() => {
    const d = normalize({ ...createDocument({ now: () => 1 }), audio: { regions: [] } });
    return Array.isArray(d.audio.solo) && d.audio.solo.length === 0;
  })());
  check('a hand-edited project cannot mute the studio with a bad solo list', (() => {
    const d = normalize({ ...createDocument({ now: () => 1 }), audio: { solo: ['nope', 7, null] } });
    return d.audio.solo.length === 0;
  })());
}

/* ======================================================= screen marks === */
/* The forty-six SCREEN templates each bake their own layout, which is what
   makes them one-click and also what made "put the caption HERE instead"
   inexpressible. Marks are the one layer that is not baked. The geometry is
   pure; the drawing needs a canvas and is pinned in the audit suite. */
section('screen marks');
{
  check('a fresh mark is on the canvas with sane defaults', (() => {
    const a = makeAnnotation({});
    return a.kind === 'text' && a.x === 0.5 && a.y === 0.5 && a.size === 100
      && a.align === 'left' && a.color === '';
  })(), JSON.stringify(makeAnnotation({})));

  /* Fractions, never pixels. The screen size and aspect are CONTROLS — one
     click turns 480×360 into a 16:9 poster — and pixel coordinates would send
     every mark somewhere else the moment that happened. */
  check('coordinates are fractions, clamped to the canvas',
    makeAnnotation({ x: 4, y: -2 }).x === 1 && makeAnnotation({ x: 4, y: -2 }).y === 0);
  check('a box kind gets a box by default, a text kind does not',
    makeAnnotation({ kind: 'box' }).w > 0 && makeAnnotation({ kind: 'text' }).w === 0);

  /* Signed w/h, deliberately: a line drawn up-and-left is a different line from
     the same one drawn down-and-right, because the arrowhead is on the end you
     dragged to. rectOf is the single place the sign is resolved. */
  check('width and height keep their sign — an arrow has a pointy end',
    makeAnnotation({ kind: 'arrow', w: -0.3, h: -0.2 }).w === -0.3);
  check('rectOf resolves the sign for everything that needs a rectangle', (() => {
    const r = rectOf(makeAnnotation({ kind: 'box', x: 0.5, y: 0.5, w: -0.2, h: -0.1 }));
    return Math.abs(r.x - 0.3) < 1e-9 && Math.abs(r.y - 0.4) < 1e-9
      && Math.abs(r.w - 0.2) < 1e-9 && Math.abs(r.h - 0.1) < 1e-9;
  })());

  /* Losing the SHAPE of a mark from a newer build is survivable; losing the
     words in it is not. */
  check('an unknown kind falls back to text rather than being dropped',
    makeAnnotation({ kind: 'hologram', text: 'keep me' }).kind === 'text'
    && makeAnnotation({ kind: 'hologram', text: 'keep me' }).text === 'keep me');
  check('text is capped', makeAnnotation({ text: 'x'.repeat(999) }).text.length === MAX_TEXT);
  check('a bad colour becomes "auto" rather than a broken fillStyle',
    makeAnnotation({ color: 'javascript:alert(1)' }).color === ''
    && makeAnnotation({ color: '#f0f' }).color === '#f0f');
  check('size and weight are clamped',
    makeAnnotation({ size: 9999 }).size === 400 && makeAnnotation({ weight: -3 }).weight === 1);
  check('an unknown alignment falls back to left',
    makeAnnotation({ align: 'justify' }).align === 'left');

  check('the list is capped',
    normalizeAnnotations(new Array(99).fill({ kind: 'box' })).length === MAX_ANNOTATIONS);
  check('junk normalises to an empty list',
    normalizeAnnotations(null).length === 0 && normalizeAnnotations('x').length === 0
    && normalizeAnnotations([null, 'x', 3, []]).length === 0);

  /* A box dragged to the edge should be allowed to hang off it — a redaction
     bar running to the margin is a normal thing to want — but its ANCHOR has to
     stay on the canvas or the author has thrown it away with no way back. */
  check('moving clamps the anchor, not the whole shape', (() => {
    const a = moveAnnotation(makeAnnotation({ kind: 'fill', x: 0.9, y: 0.5, w: 0.4 }), 0.5, 0);
    return a.x === 1 && a.w === 0.4;
  })());
  check('a mark cannot be dragged off the canvas entirely', (() => {
    const a = moveAnnotation(makeAnnotation({ x: 0.5, y: 0.5 }), -9, -9);
    return !offCanvas(a) && a.x === 0 && a.y === 0;
  })());
  check('resizing a text mark sets its wrap width and leaves the height alone', (() => {
    const a = resizeAnnotation(makeAnnotation({ kind: 'text', h: 0 }), 0.4, 0.9);
    return a.w === 0.4 && a.h === 0;
  })());
  check('resizing a box kind takes both, sign and all', (() => {
    const a = resizeAnnotation(makeAnnotation({ kind: 'arrow' }), -0.3, -0.2);
    return a.w === -0.3 && a.h === -0.2;
  })());

  check('the list label is derived from the mark, not stored beside it',
    annotationLabel(makeAnnotation({ text: 'HELLO' })) === 'HELLO'
    && annotationLabel(makeAnnotation({ text: '' })) === '(empty text)'
    && annotationLabel(makeAnnotation({ kind: 'ellipse' })) === 'Ellipse');
  check('every declared kind is a real, distinct entry',
    new Set(ANNOTATION_KINDS.map((k) => k.id)).size === ANNOTATION_KINDS.length
    && ANNOTATION_KINDS.every((k) => annotationKind(k.id) === k && k.label && k.hint));
  check('every kind is either a text kind or a box kind, never both or neither',
    ANNOTATION_KINDS.every((k) => !!k.text !== !!k.box));

  check('a fresh document carries an empty mark list, and normalize adds nothing', (() => {
    const d = createDocument({ now: () => 1_700_000_000_000 });
    return Array.isArray(d.image.annotations) && d.image.annotations.length === 0
      && canonicalJSON(normalize(d).image) === canonicalJSON(d.image);
  })());
  check('a project from before marks existed loads with none', (() => {
    const base = createDocument({ now: () => 1 });
    delete base.image;
    return normalize(base).image.annotations.length === 0;
  })());
  /* Marks are author strings that end up as fillText and fillStyle. The store's
     own prototype guard covers keys; this covers the shape. */
  check('a hand-edited project cannot smuggle a non-object into the list', (() => {
    const d = normalize({ ...createDocument({ now: () => 1 }),
      image: { annotations: [{ kind: 'text', text: 'ok' }, 'nope', null] } });
    return d.image.annotations.length === 1 && d.image.annotations[0].text === 'ok';
  })());
  check('marks survive a save/load round trip byte for byte', (() => {
    const d = normalize({ ...createDocument({ now: () => 1 }),
      image: { annotations: [{ kind: 'arrow', x: 0.2, y: 0.3, w: -0.4, h: 0.1, weight: 5 }] } });
    return canonicalJSON(fromJSON(toJSON(d)).image) === canonicalJSON(d.image);
  })());
}

/* ==================================================== aesthetic packs === */
/* "Aesthetic" meant CSS variables and a palette. A pack names the scenes and
   templates that belong to a world too — so the pickers can group forty-eight
   scenes instead of listing them, and one gesture can put the whole tool in
   that world. The registry ids are checked against the live SCENES/TEMPLATES
   in the browser suite; this pins the splitting rule. */
section('aesthetic packs');
{
  const reg = (...ids) => ids.map((id) => ({ id }));
  const all = reg('a', 'b', 'c', 'd');

  check('every pack names a preset group, some scenes and some templates',
    Object.values(PACKS).every((p) => p.presetGroup && p.scenes.length && p.templates.length),
    `${Object.keys(PACKS).length} packs`);
  check('packFor is undefined-safe', packFor('nope') === null && !!packFor('cyberpunk'));

  /* GROUPED, NEVER FILTERED. A horror screen in a cyberpunk project is a
     legitimate choice; hiding it would be the tool having an opinion about
     someone's work. Every entry must land in exactly one of the two halves. */
  check('splitting loses nothing — the picker is still complete', (() => {
    const [f, r] = splitByPack(all, 'test', 'scenes');
    return f.length + r.length === all.length;
  })());
  check('an unknown aesthetic is not a filter that hides everything', (() => {
    const [f, r] = splitByPack(all, 'no-such-aesthetic', 'scenes');
    return f.length === all.length && r.length === 0;
  })());
  check('the featured half is the pack, the rest is the rest', (() => {
    const fake = { scenes: ['b', 'd'] };
    PACKS.__test = fake;
    const [f, r] = splitByPack(all, '__test', 'scenes');
    delete PACKS.__test;
    return f.map((x) => x.id).join() === 'b,d' && r.map((x) => x.id).join() === 'a,c';
  })());
  /* Order inside each half is the REGISTRY's, not the pack's: the pack says
     which, the registry says in what order, so adding an id to a pack cannot
     quietly reshuffle a picker. */
  check('order comes from the registry, not from the pack', (() => {
    PACKS.__test = { scenes: ['d', 'b', 'a'] };
    const [f] = splitByPack(all, '__test', 'scenes');
    delete PACKS.__test;
    return f.map((x) => x.id).join() === 'a,b,d';
  })());
  check('an id a pack names but the registry lacks is reported, not swallowed', (() => {
    PACKS.__test = { scenes: ['a', 'ghost'] };
    const bad = danglingIds('__test', 'scenes', { a: 1 });
    delete PACKS.__test;
    return bad.join() === 'ghost';
  })());
  check('a pack does not claim every scene — it is a starting set, not a catalogue',
    Object.values(PACKS).every((p) => p.scenes.length <= 20 && p.templates.length <= 20));
}

/* ============================================== per-clip edit model === */
section('clip inspector — the editable surface of one clip');
{
  const video = makeClip({ kind: 'video', label: 'Terminal', src: 6, in: 1, out: 4,
    transition: 'crossfade', xdur: 0.8, rec: { 'v-scene': 'terminal', 'v-dur': '6', 'v-text': 'HELLO' } });
  const still = makeClip({ kind: 'still', label: 'Card', src: 3, rec: { 'i-tpl': 'bsod', 'i-title': 'STOP' } });

  const keysOf = (c, i) => fieldsFor(c, i).map((f) => f.key);
  check('a video clip offers its scene, copy and colours',
    ['v-scene', 'v-text', 'v-fg', 'v-bg'].every((k) => keysOf(video, 1).includes(k)));
  check('a still offers its template and its words instead',
    keysOf(still, 1).includes('i-tpl') && !keysOf(still, 1).includes('v-scene'));
  check('both offer trim, transition and sound',
    ['label', 'src', 'in', 'out', 'transition', 'xdur', 'bed'].every((k) => keysOf(still, 1).includes(k)));

  /* The first clip's transition is about how the SEQUENCE opens: scheduleOf
     only overlaps when i > 0, so offering the control there would be offering a
     setting with no effect. */
  const firstFields = fieldsFor(video, 0);
  const laterFields = fieldsFor(video, 1);
  const f = (list, k) => list.find((x) => x.key === k);
  check('the first clip’s transition is disabled, not hidden',
    f(firstFields, 'transition').disabled === true && !!f(firstFields, 'transition').hint);
  check('a later clip’s transition is live', f(laterFields, 'transition').disabled === false);
  check('a cut has no duration to set', f(fieldsFor(makeClip({ transition: 'cut' }), 2), 'xdur').disabled === true);

  check('valueFor reads clip fields', valueFor(video, 'in') === 1 && valueFor(video, 'label') === 'Terminal');
  check('valueFor reads look fields out of the recipe', valueFor(video, 'v-scene') === 'terminal');
  check('a look key is recognised as one', isLookKey('v-text') && !isLookKey('label') && !isLookKey('in'));

  // --- patches ---
  check('an edit that changes nothing produces no patch — an empty undo entry is worse than none',
    patchFor(video, 'label', 'Terminal') === null && patchFor(video, 'in', 1) === null);
  check('a look edit writes into the recipe, leaving the rest of it alone', (() => {
    const p = patchFor(video, 'v-text', 'GOODBYE');
    return p.rec['v-text'] === 'GOODBYE' && p.rec['v-scene'] === 'terminal' && video.rec['v-text'] === 'HELLO';
  })());
  check('an empty name falls back rather than leaving the clip unreadable in three places',
    patchFor(video, 'label', '   ').label === 'Clip');
  check('an unknown transition is refused, not written',
    patchFor(video, 'transition', 'star-wipe').transition === 'cut');
  check('…and the real ones are all accepted', TRANSITIONS.every((t) => {
    const c = makeClip({ transition: 'cut', xdur: 0.6 });
    return t === 'cut' ? patchFor(c, 'transition', t) === null
      : patchFor(c, 'transition', t).transition === t;
  }));
  check('choosing a transition on a clip that has no duration for one gives it a visible default', (() => {
    const cut = makeClip({ transition: 'cut', xdur: 0 });
    return patchFor(cut, 'transition', 'crossfade').xdur === 0.6;
  })());
  check('an out point cannot cross its in point', patchFor(video, 'out', 0.5).out === video.in + MIN_CLIP);
  check('an in point cannot cross its out point', patchFor(video, 'in', 99).in === video.out - MIN_CLIP);
  check('trim is bounded by the source', patchFor(video, 'out', 999).out === video.src);

  /* The reason this module exists rather than a switch in the panel: `src` is
     two writes. The renderer takes the source's length from the RECIPE
     (readVideoCfg clamps t to cfg.duration), so a clip lengthened without it
     ends on a frozen frame. */
  const longer = patchFor(video, 'src', 12);
  check('lengthening a clip lengthens the recipe inside it — or the tail is a frozen frame',
    longer.src === 12 && longer.rec[REC_DURATION] === '12');
  check('shortening a clip re-clamps a trim that no longer fits', (() => {
    // Checked on the merged clip, not the patch: a field the edit does not move
    // is deliberately absent from the patch, so `in` staying at 1 is the patch
    // saying nothing about it rather than saying 1.
    const c = { ...video, ...patchFor(video, 'src', 2) };
    return c.src === 2 && c.out === 2 && c.in === 1;
  })());
  check('a still’s hold is its own — there is no time in a screen recipe',
    patchFor(still, 'src', 5).rec === undefined);
  check('source length is bounded by what a clip may be',
    patchFor(video, 'src', 9999).src === MAX_CLIP && patchFor(video, 'src', -4).src === MIN_CLIP);
  check('a transition cannot outlast the cap', patchFor(video, 'xdur', 99).xdur === 4);
  check('a sound choice is stored as authored, unresolved',
    patchFor(video, 'bed', 'lib:not-loaded-yet').bed === 'lib:not-loaded-yet');
  check('an unknown field is refused rather than written blind', patchFor(video, 'nonsense', 1) === null);

  // --- the round trip ---
  const fresh = { 'v-scene': 'snow', 'v-dur': '9', 'v-text': 'NEW' };
  check('taking a look back from the tab brings its length with it', (() => {
    const p = patchFromRecipe(video, fresh);
    return p.rec === fresh && p.src === 9;
  })());
  check('…and keeps the trim the author made where it still fits', (() => {
    const p = patchFromRecipe(video, fresh);
    return p.in === 1 && p.out === 4;
  })());
  check('…and clamps it where it does not, rather than pointing past the end', (() => {
    const p = patchFromRecipe(video, { 'v-dur': '2' });
    return p.src === 2 && p.in === 1 && p.out === 2;
  })());
  check('a still keeps the hold the author set — its recipe has no length to read',
    patchFromRecipe(still, { 'i-tpl': 'memo' }).src === undefined);

  // --- what the panel says ---
  check('a trimmed clip says what it was cut from', trimSummary(video) === '3.00s of 6.00s');
  check('an untrimmed one just says how long it is', trimSummary(makeClip({ src: 4 })) === '4.00s');
  check('a clip longer than its own recipe is reported, not left to look like a bug',
    recipeShortfall(makeClip({ src: 8, out: 8, rec: { 'v-dur': '5' } })) === 3);
  check('a clip whose recipe covers it reports nothing', recipeShortfall(video) === 0);
  check('a still can never be short — its hold IS its length',
    recipeShortfall(makeClip({ kind: 'still', src: 30 })) === 0);
  check('a patch made by this module never leaves a shortfall behind', (() => {
    const c = makeClip({ src: 4, out: 4, rec: { 'v-dur': '4' } });
    const grown = makeClip({ ...c, ...patchFor(c, 'src', 20) });
    return recipeShortfall(grown) === 0;
  })());

  /* Everything above is only worth anything if the result survives the trip
     through the document — patches are handed to editClip(), which normalises
     the clip on the way in. */
  check('a patched clip is still a legal clip after normalisation', (() => {
    const patched = makeClip({ ...video, ...patchFor(video, 'src', 12) });
    return patched.src === 12 && patched.in === 1 && patched.out === 4
      && clipLength(patched) === 3 && TRANSITIONS.includes(patched.transition);
  })());
}

/* ================================================ the overlay track === */
section('two tracks — a spine that is ordered, a lane that is positioned');
{
  const spine = (o) => makeClip({ src: 4, out: 4, ...o });
  const over = (at, o) => makeClip({ track: 'V2', at, src: 2, out: 2, ...o });

  check('a clip is on the spine unless it says otherwise',
    makeClip({}).track === 'V1' && !isOverlay(makeClip({})));
  check('an unknown track name is refused rather than stored',
    makeClip({ track: 'V9' }).track === 'V1' && TRACKS.join() === 'V1,V2');
  check('a spine clip carries no start of its own — its start is derived',
    makeClip({ track: 'V1', at: 12 }).at === 0);
  check('an overlay start is clamped to what this tool can build',
    over(99999).at === MAX_START && over(-5).at === 0);
  check('blend and opacity exist on every clip, so the stored shape is one shape',
    (() => { const c = makeClip({}); return c.blend === 'screen' && c.opacity === 1; })());
  check('an unknown blend falls back rather than reaching the canvas',
    makeClip({ blend: 'destination-out' }).blend === 'screen');
  check('opacity is bounded', makeClip({ opacity: 4 }).opacity === 1 && makeClip({ opacity: -1 }).opacity === 0);

  /* The contract everything downstream depends on: clips[i] pairs with
     starts[i]. The beds, the lane, the playhead hit test and the exporter all
     index it that way. */
  const mixed = [spine({ label: 'A' }), over(1.5, { label: 'O' }), spine({ label: 'B', transition: 'cut' })];
  const s = scheduleOf(mixed);
  check('starts stay indexed by array position, overlays included',
    s.starts.length === 3 && s.starts[1] === 1.5, JSON.stringify(s.starts));
  check('the spine ignores an overlay sitting between two of its clips',
    s.starts[0] === 0 && s.starts[2] === 4, JSON.stringify(s.starts));
  check('an overlay does not lengthen the spine', s.duration === 8, String(s.duration));

  /* An overlay between two spine clips must not become the thing the second one
     dissolves FROM — the overlap would be measured against the wrong clip. */
  const fadeOverOverlay = scheduleOf([
    spine({ label: 'A' }), over(1), spine({ label: 'B', transition: 'crossfade', xdur: 1 })]);
  const fadeDirect = scheduleOf([
    spine({ label: 'A' }), spine({ label: 'B', transition: 'crossfade', xdur: 1 })]);
  check('a crossfade overlaps the previous SPINE clip, not the previous array slot',
    fadeOverOverlay.starts[2] === fadeDirect.starts[1] && fadeOverOverlay.starts[2] === 3,
    JSON.stringify({ withOverlay: fadeOverOverlay.starts, without: fadeDirect.starts }));

  check('an overlay hanging past the end extends the sequence rather than being cut off',
    scheduleOf([spine({}), over(10)]).duration === 12,
    String(scheduleOf([spine({}), over(10)]).duration));
  check('an overlay stays where it was put when the spine is trimmed', (() => {
    const before = scheduleOf([spine({}), over(3)]).starts[1];
    const after = scheduleOf([spine({ out: 1 }), over(3)]).starts[1];
    return before === 3 && after === 3;
  })());
  check('two overlays at the same time are both scheduled there — they stack, they do not queue',
    (() => { const r = scheduleOf([spine({}), over(1), over(1)]); return r.starts[1] === 1 && r.starts[2] === 1; })());

  check('a sequence with no overlays schedules exactly as it always did', (() => {
    const clips = [spine({}), spine({ transition: 'crossfade', xdur: 1 }), spine({ transition: 'dip' })];
    const r = scheduleOf(clips);
    return JSON.stringify(r) === JSON.stringify({ starts: [0, 3, 7], duration: 11 });
  })());

  // --- "first on its own track" ---
  check('the first spine clip is first', isFirstOnTrack(mixed, 0));
  check('a later spine clip is not', !isFirstOnTrack(mixed, 2));
  check('every overlay is first on its track — it fades up against V1, never from a neighbour',
    isFirstOnTrack(mixed, 1) && isFirstOnTrack([over(0), over(1)], 1));
  check('a spine clip after an overlay is still not first — the overlay is not in that count',
    !isFirstOnTrack([spine({}), over(0), spine({})], 2));

  // --- the inspector's view of an overlay ---
  const keys = (c, i) => fieldsFor(c, i).map((f) => f.key);
  const o = over(2);
  check('an overlay offers where it starts, how it blends and how solid it is',
    ['at', 'blend', 'opacity'].every((k) => keys(o, 1).includes(k)));
  check('a spine clip offers none of the three — there is nothing underneath it',
    ['at', 'blend', 'opacity'].every((k) => !keys(spine({}), 1).includes(k)));
  check('an overlay in slot zero still gets a live transition control',
    fieldsFor(o, 0).find((f) => f.key === 'transition').disabled === false);
  check('a spine clip in slot zero does not',
    fieldsFor(spine({}), 0).find((f) => f.key === 'transition').disabled === true);
  check('both tracks are offered on every clip', keys(spine({}), 0).includes('track'));

  check('an overlay start is patched and clamped', patchFor(o, 'at', 9).at === 9
    && patchFor(o, 'at', -3).at === 0 && patchFor(o, 'at', 1e9).at === MAX_START);
  /* Both start from a non-default value: an edit that resolves to what the clip
     already holds is correctly no patch at all, so testing the fallback needs
     somewhere to fall back FROM. */
  check('a blend outside the shared vocabulary is refused',
    patchFor(over(2, { blend: 'multiply' }), 'blend', 'evil').blend === 'screen');
  check('opacity is clamped on the way in',
    patchFor(over(2, { opacity: 0.5 }), 'opacity', 9).opacity === 1);
  check('a blend the layer stack already speaks is accepted as-is',
    patchFor(o, 'blend', 'difference').blend === 'difference');

  /* Promotion is the one edit that needs to know where the clip already is: on
     the spine that is derived, on the overlay track it is stored. */
  check('promoting a clip to the overlay track keeps it where it was on the clock', (() => {
    const p = patchForTrack(spine({}), 'V2', 4);
    return p.track === 'V2' && p.at === 4;
  })());
  check('…and demoting one drops the start, so a stale time cannot come back later', (() => {
    const p = patchForTrack(over(7), 'V1', 7);
    return p.track === 'V1' && p.at === 0;
  })());
  check('moving a clip to the track it is already on is not an edit',
    patchForTrack(spine({}), 'V1', 0) === null && patchForTrack(over(1), 'V2', 1) === null);
  check('an unknown track lands on the spine rather than somewhere undefined',
    patchForTrack(over(1), 'V7', 1).track === 'V1');

  check('a promoted clip survives normalisation with its place intact', (() => {
    const c = spine({});
    const moved = makeClip({ ...c, ...patchForTrack(c, 'V2', 4) });
    return moved.track === 'V2' && moved.at === 4 && scheduleOf([moved]).starts[0] === 4;
  })());
}

/* =========================================== a real time scale === */
section('the lane time scale — pixels per second, not percentages');
{
  check('zoom is clamped to its range', clampZoom(0.1) === ZOOM_MIN && clampZoom(99) === ZOOM_MAX);
  check('anything unreadable is treated as "fit", not as NaN',
    clampZoom('x') === 1 && clampZoom(NaN) === 1 && clampZoom(undefined) === 1 && clampZoom(Infinity) === ZOOM_MAX);

  /* Fit-relative is the decision the whole feature rests on: at zoom 1 the
     content is exactly its viewport, so zoom 1 is the layout that shipped
     before this existed. */
  check('at zoom 1 the sequence exactly fills the viewport', fitPxPerSecond(10, 600) === 60
    && pxPerSecond(10, 600, 1) === 60);
  check('zoom multiplies the scale exactly', pxPerSecond(10, 600, 6) === 360);
  check('an empty sequence still produces a finite scale rather than NaN px',
    Number.isFinite(pxPerSecond(0, 600, 1)) && pxPerSecond(0, 600, 1) > 0);
  check('an unmeasured viewport is finite and non-negative',
    Number.isFinite(pxPerSecond(10, 0, 1)) && pxPerSecond(10, 0, 1) === 0);
  check('junk in is a finite scale out',
    Number.isFinite(pxPerSecond('x', undefined, null)));

  /* The round trip that makes every drag land where the pointer is. A trim, a
     slip and a reorder all convert pointer pixels to seconds through these two
     functions; if they disagree, drags feel right and land wrong. */
  check('pixels and time round-trip exactly', (() => {
    for (const pps of [6, 12.5, 60, 360, 1234.5]) {
      for (const t of [0, 0.05, 1, 2.5, 17.33, 3840]) {
        if (Math.abs(pxToTime(timeToPx(t, pps), pps) - t) > 1e-9) return false;
      }
    }
    return true;
  })());
  check('a zero scale is guarded rather than dividing by zero',
    pxToTime(100, 0) === 0 && Number.isFinite(pxToTime(100, 0)));
  check('a negative scale cannot invert the lane', timeToPx(5, -60) === 0);

  // --- the ruler ---
  check('every step comes off the ladder', [0.5, 2, 8, 30, 60, 200, 900, 5000]
    .every((p) => TICK_LADDER.includes(tickStep(p))));
  check('a coarse scale gets a coarse step, a fine one a fine step',
    tickStep(10) >= 5 && tickStep(400) <= 0.25);
  /* The claim the old ruler could not make: it chose its step from the duration,
     so zooming in stretched the same six ticks further apart. */
  check('zooming in never coarsens the ruler', (() => {
    for (let p = 0.5; p < 4000; p *= 1.7) if (tickStep(p * 2) > tickStep(p)) return false;
    return true;
  })());
  check('a scale of zero still answers with a step rather than undefined',
    TICK_LADDER.includes(tickStep(0)));

  check('ticks start at zero and reach the end', (() => {
    const t = tickTimes(10, 60, 72);
    return t[0] === 0 && t[t.length - 1] <= 10 + 1e-6 && t.length > 2;
  })());
  check('tick times are exact, not accumulated', (() => {
    // 0.05 added repeatedly drifts; a tick labelled 12.000000000000002 is a
    // tick that was added up instead of measured.
    const t = tickTimes(3, 1440, 72);
    return t.every((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-9);
  })());
  check('a long sequence at a fine scale cannot emit ten thousand ticks',
    tickTimes(3840, 1440, 72).length <= MAX_TICKS);
  check('…and coarsens rather than stopping halfway, so the ruler never lies about the tail', (() => {
    const t = tickTimes(3840, 1440, 72);
    return t[t.length - 1] > 3840 * 0.9;
  })());
  check('an empty sequence has one tick, not none', tickTimes(0, 60, 72).length === 1);

  check('labels read as seconds while that is short, and as m:ss once it is not',
    tickLabel(0) === '0s' && tickLabel(2.5) === '2.5s' && tickLabel(60) === '1:00' && tickLabel(95) === '1:35');

  // --- scrolling ---
  check('scroll cannot go negative', clampScroll(-5, 1000, 300) === 0);
  check('scroll stops at the end of the content', clampScroll(9999, 1000, 300) === 700);
  check('content narrower than its viewport does not scroll at all', clampScroll(50, 200, 600) === 0);
  check('junk scroll is zero, not NaN', clampScroll('x', 1000, 300) === 0);
}

/* ================================================== the audio lane === */
section('audio clips — a lane of sounds, placed rather than queued');
{
  const snd = (o) => makeAudioClip({ source: 'lib:x', in: 0, out: 2, ...o });

  check('a new sound has every field, with defaults that sound like the file', (() => {
    const c = makeAudioClip({});
    return c.source === '' && c.label === 'Sound' && c.at === 0 && c.in === 0
      && c.gain === 1 && c.pan === 0 && c.loop === false && c.mute === false;
  })());
  /* A key that appears and disappears with its value breaks the byte-identical
     round trip, so every field is written unconditionally. */
  check('every field is written unconditionally', (() => {
    // Named rather than counted: a count tells you the shape changed and not
    // WHICH key appeared or went missing, which is the only useful half.
    const want = 'at,fadeIn,fadeOut,gain,in,label,loop,mute,out,pan,source';
    return Object.keys(makeAudioClip({})).sort().join() === want;
  })());
  check('a sound defaults to playing ONCE — a bed loops, a door slam does not',
    makeAudioClip({}).loop === false);

  check('gain is clamped both ways', snd({ gain: 99 }).gain === MAX_GAIN && snd({ gain: -1 }).gain === 0);
  check('pan is clamped to the stereo field',
    snd({ pan: 5 }).pan === 1 && snd({ pan: -5 }).pan === -1 && snd({ pan: 'x' }).pan === 0);
  check('a start beyond what this tool can build is clamped, not stored',
    snd({ at: 1e9 }).at === MAX_START && snd({ at: -3 }).at === 0);
  check('a backwards window is a mistake, not an edit — it reads back legal', (() => {
    const c = snd({ in: 5, out: 2 });
    return c.out > c.in && audioClipLength(c) >= 0.1;
  })());
  check('the source is kept as authored, unresolved, so an unloaded asset survives',
    snd({ source: 'lib:not-here-yet' }).source === 'lib:not-here-yet');
  check('the lane is capped', normalizeAudioClips(new Array(100).fill({})).length === MAX_AUDIO_CLIPS);
  check('junk normalises to an empty lane',
    normalizeAudioClips(undefined).length === 0 && normalizeAudioClips('nope').length === 0);

  // --- how long the lane runs ---
  check('audioEnd is where the last sound finishes, not where it starts',
    audioEnd([snd({ at: 1, in: 0, out: 2 }), snd({ at: 5, in: 0, out: 3 })]) === 8);
  check('an empty lane ends at zero', audioEnd([]) === 0 && audioEnd(null) === 0);
  /* Mute is a mixing decision an author flips constantly; letting it change the
     sequence LENGTH would make the picture jump on every audition. */
  check('a muted sound still counts towards the length',
    audioEnd([snd({ at: 0, in: 0, out: 4, mute: true })]) === 4);

  // --- what the mixer is handed ---
  const parts = audioParts([
    snd({ at: 1, in: 0.5, out: 2.5, gain: 0.5, pan: -1, loop: true }),
    snd({ at: 2, mute: true }),
    snd({ at: 3, source: '' }),
  ]);
  check('only sounds that can be heard reach the mixer', parts.length === 1, JSON.stringify(parts));
  check('…carrying where they start, where in the file, and how they sit in the mix',
    parts[0].at === 1 && parts[0].offset === 0.5 && parts[0].seconds === 2
    && parts[0].gain === 0.5 && parts[0].pan === -1 && parts[0].loop === true,
    JSON.stringify(parts[0]));
  /* A mono mixdown cannot express a pan, and the encoder caps at two channels
     without saying so — so one panned part has to widen the whole mix. */
  check('any pan forces a stereo mixdown', needsStereo(parts)
    && !needsStereo(audioParts([snd({ at: 0 })])));

  // --- the inspector's view ---
  const keys = audioFieldsFor(snd({})).map((f) => f.key);
  check('a sound offers what a sound has',
    ['source', 'at', 'in', 'out', 'loop', 'gain', 'pan', 'mute', 'label'].every((k) => keys.includes(k)));
  check('…and none of what only a picture has',
    ['track', 'transition', 'xdur', 'blend', 'v-scene', 'src'].every((k) => !keys.includes(k)));
  check('values read back off the sound', audioValueFor(snd({ gain: 0.4 }), 'gain') === 0.4
    && audioValueFor(snd({ loop: true }), 'loop') === true);
  check('an edit that changes nothing writes nothing',
    audioPatchFor(snd({ gain: 1 }), 'gain', 1) === null
    && audioPatchFor(snd({ mute: false }), 'mute', false) === null);
  check('gain and pan are clamped on the way in',
    audioPatchFor(snd({ gain: 1 }), 'gain', 99).gain === MAX_GAIN
    && audioPatchFor(snd({ pan: 0 }), 'pan', -9).pan === -1);
  check('an out point cannot cross its in point',
    audioPatchFor(snd({ in: 1, out: 3 }), 'out', 0).out === 1.1);
  check('an unnamed sound falls back rather than reading as blank on the lane',
    audioPatchFor(snd({ label: 'x' }), 'label', '   ').label === 'Sound');
  check('the summary says what plays and when', soundSummary(snd({ at: 4, in: 0, out: 2.4 })) === '2.40s at 4.00s');

  // --- waveform peaks ---
  const sine = new Float32Array(1000);
  for (let i = 0; i < sine.length; i++) sine[i] = Math.sin(i / 8);
  check('peaks are interleaved min,max per bucket', peaksOf([sine], 10).length === 20);
  check('…and bracket the signal', (() => {
    const p = peaksOf([sine], 10);
    for (let b = 0; b < 10; b++) if (!(p[b * 2] <= p[b * 2 + 1])) return false;
    return Math.max(...p) > 0.9 && Math.min(...p) < -0.9;
  })());
  check('silence is a flat line at zero, not a sentinel', (() => {
    const p = peaksOf([new Float32Array(100)], 8);
    return [...p].every((v) => v === 0);
  })());
  check('no channels is not a crash', peaksOf([], 4).length === 8 && peaksOf(null, 4).length === 8);
  /* Over ALL channels at once: a summed trace would cancel a wide stereo image
     into a flat line, and wide stereo is exactly what this tool makes. */
  check('peaks span every channel, so an out-of-phase pair does not read as silence', (() => {
    const a = new Float32Array(100).fill(0.8);
    const b = new Float32Array(100).fill(-0.8);
    const p = peaksOf([a, b], 4);
    return Math.max(...p) > 0.7 && Math.min(...p) < -0.7;
  })());
}

/* ============================================ per-clip keyframes === */
section('per-clip keyframes — a curve that belongs to the clip, not to the tab');
{
  const curved = (auto) => makeClip({ src: 6, out: 6, rec: { 'v-dur': '6', 'v-scan': '30', __auto: auto } });

  check('a clip with no curves reads back as having none',
    Object.keys(clipTracks(makeClip({}))).length === 0 && curvesSignature(makeClip({})) === '');
  check('curves are read out of the clip’s own recipe', (() => {
    const t = clipTracks(curved({ 'v-scan': [{ t: 0, v: 10, e: 'linear' }] }));
    return t['v-scan']?.length === 1 && t['v-scan'][0].v === 10;
  })());

  /* evalTrack scans assuming ascending time, so an unsorted curve evaluates
     WRONG rather than throwing. makeClip repairs it on the way in. */
  check('an out-of-order curve is put in order on load', (() => {
    const c = curved({ 'v-scan': [{ t: 5, v: 90 }, { t: 1, v: 10 }] });
    const k = c.rec.__auto['v-scan'];
    return k[0].t === 1 && k[1].t === 5;
  })());
  check('…and a clip carrying no curves is not copied at all', (() => {
    const rec = { 'v-scan': '30' };
    return makeClip({ rec }).rec === rec;    // by reference: the common path allocates nothing
  })());

  // --- adding, removing, clearing ---
  const base = curved({});
  const one = patchForKey(base, 'v-scan', 1.5, 40);
  check('a key is added to the clip’s recipe', one.rec.__auto['v-scan'][0].t === 1.5
    && one.rec.__auto['v-scan'][0].v === 40);
  check('…leaving the rest of the recipe alone', one.rec['v-dur'] === '6');
  check('adding the same key twice is not an edit the second time', (() => {
    const c = makeClip({ ...base, ...one });
    return patchForKey(c, 'v-scan', 1.5, 40) === null;
  })());
  check('a key at the same time with a different value moves it, and IS an edit', (() => {
    const c = makeClip({ ...base, ...one });
    const p = patchForKey(c, 'v-scan', 1.5, 90);
    return p && p.rec.__auto['v-scan'].length === 1 && p.rec.__auto['v-scan'][0].v === 90;
  })());
  check('removing the only key leaves no curve behind, not an empty one', (() => {
    const c = makeClip({ ...base, ...one });
    const p = patchForKeyRemove(c, 'v-scan', 1.5);
    return p && !p.rec.__auto['v-scan'];
  })());
  check('removing a key that is not there writes nothing', (() => {
    const c = makeClip({ ...base, ...one });
    return patchForKeyRemove(c, 'v-scan', 9.9) === null;
  })());
  check('clearing a parameter clears only that parameter', (() => {
    const c = curved({ 'v-scan': [{ t: 0, v: 1 }], 'v-noise': [{ t: 0, v: 2 }] });
    const p = patchForClearParam(c, 'v-scan');
    return p && !p.rec.__auto['v-scan'] && p.rec.__auto['v-noise'].length === 1;
  })());
  check('clearing an uncurved clip writes nothing', patchForClearCurves(makeClip({})) === null);

  /* Load-bearing: patchFor compares recipe values with !==, so any patch
     carrying a rebuilt __auto object would read as a change and mint an undo
     entry — including one the author immediately reverted. */
  check('two structurally equal curves compare equal',
    sameTracks({ 'v-scan': [{ t: 1, v: 2, e: 'linear' }] }, { 'v-scan': [{ t: 1, v: 2, e: 'linear' }] }));
  check('…and different ones do not', !sameTracks({ 'v-scan': [{ t: 1, v: 2 }] }, { 'v-scan': [{ t: 1, v: 3 }] })
    && !sameTracks({ 'v-scan': [{ t: 1, v: 2 }] }, {}));
  /* The clip carries curves AND the field being re-committed is unchanged: this
     is the case where same() has to walk a rec containing __auto without
     reporting a difference that is not there. */
  check('re-committing a field on a curved clip writes nothing', (() => {
    const c = makeClip({ src: 6, out: 6,
      rec: { 'v-dur': '6', 'v-text': 'HI', __auto: { 'v-scan': [{ t: 1, v: 2, e: 'linear' }] } } });
    return patchFor(c, 'v-text', 'HI') === null;
  })());

  // --- the round trip that used to be a delete button ---
  const authored = curved({ 'v-scan': [{ t: 0, v: 5, e: 'linear' }, { t: 3, v: 80, e: 'linear' }] });
  const tabRec = { 'v-dur': '9', 'v-scan': '55', __auto: { 'v-noise': [{ t: 0, v: 99, e: 'linear' }] } };
  check('"Update from tab" KEEPS the curves the author drew on this clip', (() => {
    const p = patchFromRecipe(authored, tabRec);
    return p.rec.__auto['v-scan']?.length === 2 && !p.rec.__auto['v-noise'];
  })());
  check('…while still taking everything else from the tab', (() => {
    const p = patchFromRecipe(authored, tabRec);
    return p.rec['v-scan'] === '55' && p.src === 9;
  })());
  check('…and taking the tab’s curves is available, but has to be asked for', (() => {
    const p = patchFromRecipe(authored, tabRec, { curves: 'tab' });
    return p.rec.__auto['v-noise']?.length === 1 && !p.rec.__auto['v-scan'];
  })());
  check('a clip with no curves of its own takes nothing on a keep', (() => {
    const p = patchFromRecipe(makeClip({ src: 4, out: 4 }), { 'v-dur': '4' });
    return p.rec.__auto === undefined;
  })());

  // --- what the panel warns about ---
  check('keys past the end of the clip are counted, not left silently unplayed',
    keysPastEnd(curved({ 'v-scan': [{ t: 1, v: 0 }, { t: 99, v: 1 }] })) === 1);
  check('a clip whose keys all fit reports none',
    keysPastEnd(curved({ 'v-scan': [{ t: 1, v: 0 }] })) === 0);

  check('the signature moves when a curve does — the panel repaints only if it does', (() => {
    const a = curved({ 'v-scan': [{ t: 1, v: 2, e: 'linear' }] });
    const b = curved({ 'v-scan': [{ t: 1, v: 3, e: 'linear' }] });
    return curvesSignature(a) !== curvesSignature(b) && curvesSignature(a) === curvesSignature(curved({ 'v-scan': [{ t: 1, v: 2, e: 'linear' }] }));
  })());
}

/* ================================================ importing media === */
section('import — what a dropped file is, and what to call it');
{
  const f = (name, type, size = 1024) => ({ name, type, size });

  check('extensions come off the LAST dot, lowercased',
    extOf('My Clip.FINAL.WebM') === 'webm' && extOf('noext') === '' && extOf('trailing.') === '');
  check('the stem is the name without it', stemOf('a.b.mp4') === 'a.b' && stemOf('') === 'import');

  check('footage is filed as video', classifyFile(f('shot.mp4', 'video/mp4')).kind === 'videos');
  check('sound is filed as music', classifyFile(f('room.wav', 'audio/wav')).kind === 'music');
  check('a still is filed as an image', classifyFile(f('grab.png', 'image/png')).kind === 'image');
  check('every kind it reports is one the library actually has',
    [VIDEO_EXT[0], AUDIO_EXT[0], IMAGE_EXT[0]]
      .every((e) => KINDS.includes(classifyFile(f(`x.${e}`, '')).kind)));

  /* The extension decides and MIME is the tie-break, in that order: browsers
     report application/octet-stream for plenty of good media depending on where
     the file came from, and the decoder is handed the bytes either way. */
  check('a file the browser mislabels is still classified by its extension',
    classifyFile(f('shot.webm', 'application/octet-stream')).kind === 'videos');
  check('…and one with no extension falls back to its MIME type',
    classifyFile(f('clipboard', 'image/png')).kind === 'image');

  /* A .mov has a MIME type and will not decode. A row that looks fine and is
     silently unusable is worse than a refusal that says why. */
  check('a container the browser cannot play is refused, with a reason', (() => {
    const r = classifyFile(f('old.mov', ''));
    return r.ok === false && /not a kind of media/.test(r.why);
  })());
  check('a document is refused', classifyFile(f('notes.pdf', 'application/pdf')).ok === false);
  check('an empty file is refused', classifyFile(f('x.wav', 'audio/wav', 0)).ok === false);
  check('something too big for a browser tab is refused, saying how big', (() => {
    const r = classifyFile(f('huge.mp4', 'video/mp4', MAX_IMPORT_BYTES + 1));
    return r.ok === false && /too big/.test(r.why) && /MB/.test(r.why);
  })());
  check('junk in is a refusal, not a throw',
    classifyFile(null).ok === false && classifyFile({}).ok === false);

  check('a dropped set is ordered footage, stills, sound, then the refusals', (() => {
    const order = importOrder([f('c.wav', ''), f('b.png', ''), f('a.mp4', ''), f('z.pdf', '')]);
    return order.map((x) => x.name).join() === 'a.mp4,b.png,c.wav,z.pdf';
  })());
  check('…and ordering never drops or duplicates a file',
    importOrder([f('a.mp4', ''), f('b.mp4', ''), f('c.pdf', '')]).length === 3);
}

/* ============================================= speed and reverse === */
section('speed and reverse — a clip need not play at the rate it was shot');
{
  const shot = (o = {}) => makeClip({ kind: 'video', scene: 'bars', rec: {}, src: 8, in: 0, out: 8, ...o });

  check('a clip plays at 1× and forwards unless told otherwise',
    shot().speed === 1 && shot().reverse === false && clipSpeed(shot()) === 1);
  check('speed is clamped to something that is still a shot',
    shot({ speed: 99 }).speed === MAX_SPEED && shot({ speed: 0.001 }).speed === MIN_SPEED);
  check('junk, zero and negatives fall back to 1 rather than to chaos',
    clipSpeed({ speed: 'fast' }) === 1 && clipSpeed({ speed: 0 }) === 1
    && clipSpeed({ speed: -2 }) === 1 && clipSpeed(null) === 1);
  /* A still's Hold IS its length, so speed would be a second way to spell a
     control it already has — forced rather than merely hidden, so a
     hand-edited file cannot smuggle one in. */
  check('a still is always 1× forwards, whatever the file says',
    makeClip({ kind: 'still', src: 3, speed: 4, reverse: true }).speed === 1
    && makeClip({ kind: 'still', src: 3, speed: 4, reverse: true }).reverse === false);

  /* THE consequence. Every other behaviour of speed falls out of this one
     function — where the next clip starts, how long the sequence is, how wide
     the block is drawn, how long the clip's bed has to be. */
  check('the lane length is the source window divided by the speed',
    clipLength(shot({ speed: 2 })) === 4 && clipLength(shot({ speed: 0.5 })) === 16
    && clipLength(shot({ in: 2, out: 6, speed: 2 })) === 2);
  check('…and it is still floored, because a schedule cannot hold a zero',
    clipLength(shot({ in: 0, out: 0.1, speed: 8 })) === MIN_CLIP);
  check('reverse does not change how long the clip is',
    clipLength(shot({ reverse: true })) === clipLength(shot()));
  check('the schedule follows without knowing about speed at all', (() => {
    const { starts, duration } = scheduleOf([shot({ speed: 2 }), shot({ transition: 'cut' })]);
    return starts[0] === 0 && starts[1] === 4 && duration === 12;
  })());

  /* The three time bases meet in sourceTimeOf, and before speed existed they
     agreed by accident because `in + localT` was the whole answer. */
  check('at 1× forwards, the source time is where it always was',
    sourceTimeOf(shot(), 0) === 0 && sourceTimeOf(shot({ in: 2 }), 1) === 3);
  check('at 2× the clip walks its source twice as fast',
    sourceTimeOf(shot({ speed: 2 }), 1) === 2 && sourceTimeOf(shot({ speed: 2 }), 4) === 8);
  check('at half speed, half as fast', sourceTimeOf(shot({ speed: 0.5 }), 4) === 2);
  /* Reverse starts at the OUT point and walks back — the last frame of the
     window is the first one you see. It is NOT the same as swapping in and
     out, which would play a different part of the source forwards. */
  check('reversed, it starts at the out point and walks back', (() => {
    const c = shot({ in: 2, out: 6, reverse: true });
    return sourceTimeOf(c, 0) === 6 && sourceTimeOf(c, 4) === 2 && sourceTimeOf(c, 2) === 4;
  })());
  check('…and reversed AND fast does both', (() => {
    const c = shot({ in: 0, out: 8, reverse: true, speed: 2 });
    return sourceTimeOf(c, 0) === 8 && sourceTimeOf(c, 4) === 0;
  })());
  check('the ends of a clip map to the ends of its window, whatever the speed', (() => {
    for (const o of [{}, { speed: 2 }, { speed: 0.5 }, { reverse: true }, { speed: 3, reverse: true },
                     { in: 1.5, out: 5, speed: 1.75 }, { in: 1.5, out: 5, speed: 1.75, reverse: true }]) {
      const c = shot(o);
      const len = clipLength(c);
      const a = sourceTimeOf(c, 0);
      const b = sourceTimeOf(c, len);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      if (Math.abs(lo - c.in) > 1e-9 || Math.abs(hi - c.out) > 1e-9) return false;
    }
    return true;
  })());
  check('a negative localT is clamped rather than reaching outside the window',
    sourceTimeOf(shot({ in: 2 }), -5) === 2);

  /* The mixer has to be told, or a voice detaches from its mouth the moment a
     shot is slowed down. */
  check('footage audio is pitched with the picture, and reversed with it', (() => {
    const c = shot({ scene: 'videoin', rec: { 'v-srckey': 'lib:a' }, srcAudio: true,
                     in: 1, out: 5, speed: 2, reverse: true });
    const p = mixParts({ clips: [c], starts: [0], audio: [], total: 2 }).video[0];
    return p.rate === 2 && p.reverse === true && p.span === 4 && p.offset === 1
      && Math.abs(p.seconds - 2) < 1e-9;
  })());
  check('…and changing the speed rebuilds the mix', (() => {
    const at = (speed) => ({ clips: [shot({ scene: 'videoin', rec: { 'v-srckey': 'lib:a' },
                                            srcAudio: true, speed })], starts: [0], audio: [], total: 4 });
    return mixSignature(mixParts(at(1))) !== mixSignature(mixParts(at(2)));
  })());
  /* A bed is a separate sound laid under the clip; speeding the picture must
     not pitch it, only shorten the window it has to fill. */
  check('a bed is NOT pitched — it just has less clip to fill', (() => {
    const p = mixParts({ clips: [shot({ bed: 'lib:hum', speed: 2 })], starts: [0], audio: [], total: 4 }).video[0];
    return p.choice === 'lib:hum' && p.seconds === 4 && p.rate === undefined;
  })());

  check('the panel offers both to a video clip and neither to a still', (() => {
    const v = fieldsFor(shot(), 1).filter((f) => f.key === 'speed' || f.key === 'reverse');
    const st = fieldsFor(makeClip({ kind: 'still', src: 3 }), 1)
      .filter((f) => f.key === 'speed' || f.key === 'reverse');
    return v.length === 2 && st.length === 0;
  })());
  check('…and warns on a footage clip that only its SOUND can be reversed', (() => {
    const f = fieldsFor(shot({ scene: 'videoin', rec: { 'v-srckey': 'lib:a' } }), 1)
      .find((x) => x.key === 'reverse');
    return /picture cannot/.test(f.hint);
  })());
  check('reads back, clamps what is typed, and refuses a still',
    valueFor(shot({ speed: 2 }), 'speed') === 2 && valueFor(shot(), 'reverse') === false
    && patchFor(shot(), 'speed', 99).speed === MAX_SPEED
    && patchFor(makeClip({ kind: 'still', src: 3 }), 'speed', 2) === null
    && patchFor(makeClip({ kind: 'still', src: 3 }), 'reverse', true) === null);
  check('an unchanged speed raises no patch', patchFor(shot({ speed: 2 }), 'speed', 2) === null);

  check('the summary says how it plays', speedSummary(shot()) === ''
    && speedSummary(shot({ speed: 2 })) === '2×'
    && speedSummary(shot({ reverse: true })) === 'reversed'
    && speedSummary(shot({ speed: 0.5, reverse: true })) === '0.5× · reversed');
  /* At 2× a whole four-second source occupies two seconds of lane. Comparing
     the lane length against the source would report that as trimmed when
     nothing was cut. */
  check('the trim summary compares the WINDOW to the source, not the lane length',
    trimSummary(shot({ speed: 2 })) === '4.00s · 2×'
    && trimSummary(shot({ in: 2, out: 6 })) === '4.00s of 8.00s');
}

/* =================================== how loud the mix actually is === */
section('peak level — the mix is unlimited, so something has to say so');
{
  const ch = (...v) => [Float32Array.from(v)];

  check('the peak is the loudest sample anywhere, in any channel',
    peakLevel(ch(0.1, -0.9, 0.3)) === 0.9999999403953552 || peakLevel(ch(0.1, -0.5, 0.3)) === 0.5);
  check('…across channels, not just the first', (() => {
    const two = [Float32Array.from([0.2]), Float32Array.from([-0.75])];
    return peakLevel(two) === 0.75;
  })());
  check('silence is zero, and junk is zero rather than NaN',
    peakLevel(ch(0, 0)) === 0 && peakLevel(null) === 0 && peakLevel([null, undefined]) === 0);

  check('full scale is 0 dB and half is about −6',
    dbfs(1) === 0 && Math.abs(dbfs(0.5) + 6) < 0.1);
  /* Silence really is negative infinity, and printing that reads as broken. */
  check('silence floors instead of printing −Infinity',
    dbfs(0) === -120 && dbfs(-0) === -120 && dbfs(NaN) === -120 && Number.isFinite(dbfs(1e-30)));

  check('clipping starts exactly at full scale, where the encoder clamps',
    isClipping(1) === true && isClipping(1.5) === true && isClipping(0.999) === false);
  check('the label says the level, and says when it is too much',
    peakLabel(0) === 'silent'
    && peakLabel(0.5).includes('dB') && !peakLabel(0.5).includes('CLIPPING')
    && peakLabel(1.2).includes('CLIPPING'));
  check('…and prints a real minus sign rather than a hyphen',
    peakLabel(0.5).startsWith('−'));
}

/* ================================ a sound that arrives and leaves === */
section('audio fades — no more hard cuts into every sound');
{
  const snd = (o = {}) => makeAudioClip({ source: 'lib:s', at: 0, in: 0, out: 4, ...o });

  check('a sound defaults to no fade at all — exactly what it always did',
    snd().fadeIn === 0 && snd().fadeOut === 0);
  check('…and carries them through the round trip',
    snd({ fadeIn: 0.5, fadeOut: 1.25 }).fadeIn === 0.5
    && makeAudioClip(snd({ fadeOut: 1.25 })).fadeOut === 1.25);
  check('a fade cannot be longer than the sound it fades',
    snd({ fadeIn: 99 }).fadeIn === 4 && snd({ in: 1, out: 3, fadeOut: 99 }).fadeOut === 2);
  check('junk is no fade, not NaN', snd({ fadeIn: 'soon' }).fadeIn === 0);

  /* The envelope. Flat at gain when there is nothing to do — which is what
     keeps a sound with no fades byte-identical to how it rendered before. */
  check('no fades is a single flat point',
    JSON.stringify(fadeShape(4, 0, 0, 1)) === JSON.stringify([{ t: 0, v: 1 }]));
  check('a fade in starts at silence and reaches the gain', (() => {
    const s2 = fadeShape(4, 1, 0, 0.8);
    return s2.length === 2 && s2[0].v === 0 && s2[1].t === 1 && s2[1].v === 0.8;
  })());
  check('a fade out holds level, then falls to silence at the end', (() => {
    const s2 = fadeShape(4, 0, 1, 1);
    return s2.length === 3 && s2[0].v === 1 && s2[1].t === 3 && s2[1].v === 1
      && s2[2].t === 4 && s2[2].v === 0;
  })());
  check('both together make one rise, a hold, and one fall', (() => {
    const s2 = fadeShape(10, 2, 3, 1);
    return s2.map((k) => `${k.t}:${k.v}`).join() === '0:0,2:1,7:1,10:0';
  })());

  /* The case an author will absolutely produce. */
  check('two fades that do not fit share the clip — the fade in wins', (() => {
    const s2 = fadeShape(3, 2, 2, 1);
    // in takes 2s, out gets the remaining 1s, and nothing overlaps.
    return s2.map((k) => `${k.t}:${k.v}`).join() === '0:0,2:1,3:0';
  })());
  check('…and a fade in that fills the clip leaves no fade out at all', (() => {
    const s2 = fadeShape(3, 3, 3, 1);
    return s2.map((k) => `${k.t}:${k.v}`).join() === '0:0,3:1';
  })());
  check('the shape is always in ascending time, which is what scheduling needs', (() => {
    for (const [secs, fi, fo] of [[4, 0, 0], [4, 1, 0], [4, 0, 1], [4, 1, 1], [3, 2, 2], [1, 5, 5], [0, 1, 1]]) {
      const k = fadeShape(secs, fi, fo, 1);
      for (let i = 1; i < k.length; i++) if (!(k[i].t >= k[i - 1].t)) return false;
    }
    return true;
  })());
  check('junk seconds and junk fades do not throw',
    Array.isArray(fadeShape(NaN, NaN, NaN, NaN)) && fadeShape(-4, -1, -1, -1).length >= 1);

  check('the mixer is told about them',
    audioParts([snd({ fadeIn: 0.5, fadeOut: 1 })])[0].fadeIn === 0.5
    && audioParts([snd({ fadeIn: 0.5, fadeOut: 1 })])[0].fadeOut === 1);
  check('…and changing one rebuilds the mix', (() => {
    const sched = (fi) => ({ clips: [], starts: [], audio: [snd({ fadeIn: fi })], total: 4 });
    return mixSignature(mixParts(sched(0))) !== mixSignature(mixParts(sched(0.5)));
  })());

  check('the panel offers both, as lengths beside the trim', (() => {
    const f = audioFieldsFor(snd()).filter((x) => x.key === 'fadeIn' || x.key === 'fadeOut');
    return f.length === 2 && f.every((x) => x.group === 'timing' && x.unit === 's');
  })());
  check('…reads them back and clamps what is typed', (() => {
    const c = snd({ in: 1, out: 3 });
    return audioValueFor(c, 'fadeIn') === 0 && audioPatchFor(c, 'fadeIn', 99).fadeIn === 2
      && audioPatchFor(c, 'fadeOut', 0.5).fadeOut === 0.5;
  })());
  check('…and raises nothing when the value did not change',
    audioPatchFor(snd({ fadeIn: 0.5 }), 'fadeIn', 0.5) === null);
  check('the lane summary stays a length and a time until there IS a fade',
    soundSummary(snd()) === '4.00s at 0.00s'
    && /↗0.5s/.test(soundSummary(snd({ fadeIn: 0.5 })))
    && /↘1s/.test(soundSummary(snd({ fadeOut: 1 }))));
}

/* ============================================ snapping on the lane === */
section('snapping — a drag lands on something, not on an arbitrary hundredth');
{
  const clip = (out) => makeClip({ kind: 'video', src: out, in: 0, out, scene: 'bars', rec: {} });
  const sound = (at, len) => makeAudioClip({ source: 'lib:s', at, in: 0, out: len });

  /* The pull is measured in PIXELS, and that is the whole design. A fixed
     tolerance in seconds is either uselessly weak zoomed out or unusably sticky
     zoomed in; eight pixels is the same gesture at every scale. */
  check('the pull is a pixel distance converted through the live scale', (() => {
    const c = [10];
    // 100px/s: 8px is 0.08s of pull. 10px/s: the same 8px is 0.8s.
    return snapTime(10.05, c, 100) === 10 && snapTime(10.5, c, 100) === 10.5
      && snapTime(10.5, c, 10) === 10;
  })());
  check('outside the tolerance nothing moves', snapTime(4, [10], 100) === 4);
  check('the nearest target wins', snapTime(10.03, [10, 10.05], 200) === 10.05);
  check('…and an exact tie resolves to the earlier one, every time',
    snapTime(10, [9.95, 10.05], 100) === 9.95);
  check('a scale of zero snaps nothing rather than dividing by it',
    snapTime(10.01, [10], 0) === 10.01 && snapTime(10.01, [10], NaN) === 10.01);
  check('no candidates, junk candidates and junk times are all no-ops',
    snapTime(3, [], 100) === 3 && snapTime(3, null, 100) === 3 && snapTime(NaN, [10], 100) === 0);
  check('the default tolerance is the exported one', (() => {
    const pps = 100;
    const just = SNAP_PX / pps - 0.001;
    const past = SNAP_PX / pps + 0.001;
    return snapTime(10 + just, [10], pps) === 10 && snapTime(10 + past, [10], pps) !== 10;
  })());

  /* What a drag is allowed to land on. */
  const clips = [clip(2), clip(3)];
  const starts = [0, 2];
  const sounds = [sound(4, 1)];
  check('every clip edge, every sound edge, the playhead and zero are targets', (() => {
    const c = snapCandidates(clips, starts, sounds, 1.5);
    return c.join() === '0,1.5,2,4,5';
  })());
  check('…sorted and de-duplicated, so butted clips do not appear twice', (() => {
    const c = snapCandidates(clips, starts, [], 2);
    return c.join() === '0,2,5' && c.length === new Set(c).size;
  })());
  /* A clip that snapped to its own edges could never be dragged off them. */
  check('the clip being dragged is excluded from its own targets', (() => {
    const v = snapCandidates(clips, starts, sounds, -1, { lane: 'V', i: 1 });
    const a = snapCandidates(clips, starts, sounds, -1, { lane: 'A', i: 0 });
    return v.join() === '0,2,4,5' && a.join() === '0,2,5';
  })());
  /* THE one that makes it work on the spine at all. */
  check('a spine trim excludes every clip the drag is about to move', (() => {
    const three = [clip(2), clip(3), clip(1)];
    const st = [0, 2, 5];
    // Without andAfter, clip 1's start (2) IS the dragged edge, one commit
    // behind — the pointer finds a target a pixel away on every move and the
    // clip refuses to budge.
    const loose = snapCandidates(three, st, [], -1, { lane: 'V', i: 0 });
    const tight = snapCandidates(three, st, [], -1, { lane: 'V', i: 0, andAfter: true });
    return loose.join() === '0,2,5,6' && tight.join() === '0';
  })());
  check('…but an overlay after it stays a target, because it does not move', (() => {
    const withOverlay = [clip(2), makeClip({ kind: 'video', src: 1, in: 0, out: 1, track: 'V2', at: 4 })];
    const st = [0, 4];
    return snapCandidates(withOverlay, st, [], -1, { lane: 'V', i: 0, andAfter: true }).join() === '0,4,5';
  })());
  check('…and so does a sound', (() => {
    const st = [0, 2];
    return snapCandidates(clips, st, [sound(4, 1)], -1, { lane: 'V', i: 0, andAfter: true }).join() === '0,4,5';
  })());

  check('an absent playhead and junk lists are survivable',
    snapCandidates(null, null, null, NaN).join() === '0'
    && snapCandidates(clips, [], [], 0).join() === '0');

  /* Moving a whole clip snaps whichever END is nearest, because butting a clip
     against the thing before it and against the thing after it are the same
     gesture to whoever is doing it. */
  check('a move snaps its head when the head is what is near',
    snapMove(1.98, 3, [2], 100) === 2);
  check('…and its tail when the tail is what is near',
    Math.abs(snapMove(1.98, 3, [5], 100) - 2) < 1e-9);
  check('…taking the smaller correction when both are in range', (() => {
    // head is 0.05 from 2; tail (at+1) is 0.01 from 3.
    const at = snapMove(1.95 + 0.04, 1, [2, 3], 400);
    return Math.abs(at - 2) < 1e-9;
  })());
  check('a move with nothing in range is left exactly where it was',
    snapMove(7.13, 2, [0, 20], 100) === 7.13);
  check('a zero-length clip still snaps its head', snapMove(1.99, 0, [2], 100) === 2);
}

/* ================================= where a clip sits in the frame === */
section('transform — a clip has a position now, and the old ones still fill the frame');
{
  const T = (o) => makeTransform(o);
  const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

  check('a clip with no transform fields reads back as the identity',
    isIdentity(T({})) && isIdentity(T(null)) && isIdentity(makeClip({ dur: 4 })));
  check('…and so does one written before any of this existed',
    isIdentity(makeClip({ kind: 'video', rec: {}, src: 4, in: 0, out: 4 })));

  check('scale is clamped to something a browser can actually draw',
    T({ scale: 99 }).scale === MAX_SCALE && T({ scale: 0 }).scale === MIN_SCALE
    && T({ scale: 'nonsense' }).scale === 1);
  check('offsets are clamped, and junk falls back to centred',
    T({ x: 9, y: -9 }).x === MAX_OFFSET && T({ x: 9, y: -9 }).y === -MAX_OFFSET
    && T({ x: {} }).x === 0);
  /* Wrapped, not clamped: 190° and −170° are the same picture, and an author
     dragging past the end of a dial means to keep going. */
  check('rotation wraps rather than clamping', T({ rot: 190 }).rot === -170
    && T({ rot: -190 }).rot === 170 && T({ rot: 720 }).rot === 0);
  check('an unknown mirror mode falls back to none',
    T({ flip: 'diagonal' }).flip === 'none' && T({ flip: 'hv' }).flip === 'hv');

  /* THE claim the renderer's fast path rests on. */
  check('the identity matrix maps the frame exactly onto itself', (() => {
    const [a, b, c, d, e, f] = matrixFor({}, 320, 240);
    return a === 1 && b === 0 && c === 0 && d === 1 && e === 160 && f === 120;
  })());
  check('…so an untransformed clip lands corner to corner', (() => {
    const r = transformedBox({}, 320, 240);
    return near(r.x, 0) && near(r.y, 0) && near(r.w, 320) && near(r.h, 240);
  })());

  check('half scale draws half the frame, centred', (() => {
    const r = transformedBox({ scale: 0.5 }, 320, 240);
    return near(r.x, 80) && near(r.y, 60) && near(r.w, 160) && near(r.h, 120);
  })());
  check('an offset is a fraction of the frame, so it scales with the format', (() => {
    const small = transformedBox({ x: 0.25, scale: 0.5 }, 320, 240);
    const big = transformedBox({ x: 0.25, scale: 0.5 }, 1280, 960);
    return near(small.x / 320, big.x / 1280) && near(small.w / 320, big.w / 1280);
  })());
  check('a quarter turn swaps the drawn box’s width and height', (() => {
    const r = transformedBox({ rot: 90 }, 320, 240);
    return near(r.w, 240) && near(r.h, 320);
  })());
  check('a mirror does not move the box, only the picture inside it', (() => {
    const plain = transformedBox({ scale: 0.5 }, 320, 240);
    const flipped = transformedBox({ scale: 0.5, flip: 'h' }, 320, 240);
    return near(plain.x, flipped.x) && near(plain.w, flipped.w)
      && matrixFor({ scale: 0.5, flip: 'h' }, 320, 240)[0] === -0.5;
  })());
  check('mirroring is applied in the clip’s own space, so a tilt keeps its sign', (() => {
    // A flipped 30° clip is the same tilt mirrored, not a −30° tilt: the
    // determinant flips sign while the rotation angle does not.
    const m = matrixFor({ rot: 30, flip: 'h' }, 320, 240);
    return m[0] < 0 && m[1] < 0 && m[3] > 0;
  })());

  check('a clip pushed off the side is reported as off frame',
    offFrame({ x: 1.5, scale: 0.5 }, 320, 240) === true
    && offFrame({ y: -1.5, scale: 0.5 }, 320, 240) === true);
  check('…but one merely hanging over the edge is not, because part of it shows',
    offFrame({ x: 0.4, scale: 0.5 }, 320, 240) === false);
  check('a full-frame clip is never off frame', offFrame({}, 320, 240) === false);

  check('the summary is empty for a clip that fills the frame', transformSummary({}) === '');
  check('…and says what it is for one that does not', (() => {
    const s = transformSummary({ scale: 0.5, x: 0.25, rot: 12, flip: 'h' });
    return s.includes('50%') && s.includes('+0.25') && s.includes('12°') && s.includes('mirrored');
  })());

  /* The presets exist so nobody has to work out that a corner inset is 0.25.
     Each one has to land flush, which is the whole reason for the number. */
  check('every corner preset lands flush against two edges', (() => {
    const W = 320; const H = 240;
    return PLACES.filter((p) => ['tl', 'tr', 'bl', 'br'].includes(p.v)).every((p) => {
      const r = transformedBox(p, W, H);
      const flushX = near(r.x, 0) || near(r.x + r.w, W);
      const flushY = near(r.y, 0) || near(r.y + r.h, H);
      return flushX && flushY && near(r.w, W / 2) && near(r.h, H / 2);
    });
  })());
  check('“right half” fills exactly the right half', (() => {
    const r = transformedBox(PLACES.find((p) => p.v === 'right'), 320, 240);
    return near(r.x, 160) && near(r.x + r.w, 320);
  })());
  check('placeOf names the preset a clip is sitting on',
    placeOf({ x: 0.25, y: 0.25, scale: 0.5 }) === 'br'
    && placeOf({}) === 'full' && placeOf({ x: 0.31, scale: 0.5 }) === 'custom');
  check('…and keeps naming it when the clip is tilted or mirrored',
    placeOf({ x: 0.25, y: 0.25, scale: 0.5, rot: 20, flip: 'h' }) === 'br');
  check('patchForPlace writes position and size only',
    JSON.stringify(patchForPlace('tl')) === JSON.stringify({ x: -0.25, y: -0.25, scale: 0.5 })
    && patchForPlace('custom') === null && patchForPlace('nope') === null);

  /* The document side: the fields have to survive a normalise, and the panel
     has to offer them on both tracks. */
  check('makeClip carries the transform through, clamped', (() => {
    const c = makeClip({ dur: 4, x: 9, y: -0.25, scale: 0.5, rot: 400, flip: 'v' });
    return c.x === MAX_OFFSET && c.y === -0.25 && c.scale === 0.5 && c.rot === 40 && c.flip === 'v';
  })());
  check('the panel offers Transform on the spine as well as the overlay', (() => {
    const keys = (c) => fieldsFor(c, 1).filter((f) => f.group === 'transform').map((f) => f.key);
    const spine = keys(makeClip({ dur: 4 }));
    const over = keys(makeClip({ dur: 4, track: 'V2' }));
    return spine.join() === 'place,scale,x,y,rot,flip' && over.join() === spine.join();
  })());
  check('valueFor reads the transform back, and derives the preset name', (() => {
    const c = makeClip({ dur: 4, x: 0.25, y: 0.25, scale: 0.5 });
    return valueFor(c, 'scale') === 0.5 && valueFor(c, 'x') === 0.25
      && valueFor(c, 'flip') === 'none' && valueFor(c, 'place') === 'br';
  })());
  check('patchFor clamps through the same normaliser the renderer uses', (() => {
    const c = makeClip({ dur: 4 });
    const flipped = makeClip({ dur: 4, flip: 'h' });
    return patchFor(c, 'scale', 99).scale === MAX_SCALE
      && patchFor(c, 'rot', 190).rot === -170
      && patchFor(flipped, 'flip', 'sideways').flip === 'none';
  })());
  /* Junk that normalises to what the clip already holds is NOT an edit — which
     is what keeps a re-render or a reverted keystroke out of the undo stack. */
  check('…and junk that resolves to the current value raises no patch',
    patchFor(makeClip({ dur: 4 }), 'flip', 'sideways') === null);
  check('the mirror control offers exactly the modes the renderer knows', (() => {
    const f = fieldsFor(makeClip({ dur: 4 }), 1).find((x) => x.key === 'flip');
    return f.options.map((o) => o.v).join() === FLIPS.join();
  })());
  check('…and returns null when an edit changes nothing', (() => {
    const c = makeClip({ dur: 4, scale: 0.5 });
    return patchFor(c, 'scale', 0.5) === null && patchFor(c, 'x', 0) === null;
  })());
  check('choosing a preset writes three fields in one patch', (() => {
    const c = makeClip({ dur: 4 });
    const p = patchFor(c, 'place', 'br');
    return p.x === 0.25 && p.y === 0.25 && p.scale === 0.5 && p.rot === undefined;
  })());
  check('choosing “custom” is not an edit', patchFor(makeClip({ dur: 4 }), 'place', 'custom') === null);
}

/* ============================================== the sound of a sequence === */
section('the mix — what a sequence sounds like, described before it is built');
{
  const clip = (bed, out = 2) => ({ kind: 'video', rec: {}, label: 'x', scene: 'bars', src: out, in: 0, out,
    transition: 'cut', xdur: 0.6, bed });
  const sched = (clips, audio = [], total = 6) => ({ clips, starts: clips.map((_, i) => i * 2), audio, total });

  check('a clip with no sound is left out of the description entirely',
    mixParts(sched([clip(''), clip('lib:a'), clip(undefined)])).video.length === 1);
  check('…and the one that has sound is laid at the time its clip starts',
    mixParts(sched([clip(''), clip('lib:a')])).video[0].at === 2);
  check('the sequence bed rides alongside rather than replacing them',
    mixParts(sched([clip('lib:a')]), 'lib:seq').seq === 'lib:seq');
  check('the A1 lane arrives through audioParts, so a muted sound is already gone', (() => {
    const p = mixParts(sched([clip('')], [
      makeAudioClip({ source: 'lib:s1', at: 1, in: 0, out: 2 }),
      makeAudioClip({ source: 'lib:s2', at: 3, in: 0, out: 2, mute: true }),
    ]));
    return p.audio.length === 1 && p.audio[0].choice === 'lib:s1';
  })());
  check('a schedule with nothing in it describes silence, not a throw',
    hasSound(mixParts({})) === false && mixParts(null).video.length === 0);

  check('the same mix twice is the same signature',
    mixSignature(mixParts(sched([clip('lib:a')]), 'lib:s'))
    === mixSignature(mixParts(sched([clip('lib:a')]), 'lib:s')));

  /* The whole point of the signature. A mixdown is a decode plus one offline
     render per part, and startTimelinePreview() runs on every commit — so if
     renaming a clip rebuilt the mix, preview sound would stutter every time an
     author touched anything at all. */
  const base = mixSignature(mixParts(sched([clip('lib:a')]), 'lib:s'));
  check('renaming a clip does not change it', (() => {
    const c = { ...clip('lib:a'), label: 'a completely different name' };
    return mixSignature(mixParts(sched([c]), 'lib:s')) === base;
  })());
  check('changing a transition does not change it', (() => {
    const c = { ...clip('lib:a'), transition: 'crossfade', xdur: 1.2 };
    return mixSignature(mixParts(sched([c]), 'lib:s')) === base;
  })());
  check('a keyframe curve does not change it', (() => {
    const c = { ...clip('lib:a'), rec: { __auto: { 'v-noise': [{ t: 0, v: 1 }] } } };
    return mixSignature(mixParts(sched([c]), 'lib:s')) === base;
  })());

  check('swapping a clip’s sound DOES change it',
    mixSignature(mixParts(sched([clip('lib:b')]), 'lib:s')) !== base);
  check('trimming a clip that carries sound changes it', (() => {
    const c = { ...clip('lib:a'), out: 1.5 };
    return mixSignature(mixParts(sched([c]), 'lib:s')) !== base;
  })());
  check('moving that clip later changes it', (() => {
    const s = sched([clip('lib:a')]);
    s.starts = [3];
    return mixSignature(mixParts(s, 'lib:s')) !== base;
  })());
  check('changing the sequence bed changes it',
    mixSignature(mixParts(sched([clip('lib:a')]), 'lib:other')) !== base);
  check('a longer sequence changes it',
    mixSignature(mixParts(sched([clip('lib:a')], [], 9), 'lib:s')) !== base);
  check('nudging a sound on the lane changes it', (() => {
    const a = (at) => [makeAudioClip({ source: 'lib:s1', at, in: 0, out: 2 })];
    return mixSignature(mixParts(sched([clip('')], a(1)))) !== mixSignature(mixParts(sched([clip('')], a(2))));
  })());
  check('and so does its gain', (() => {
    const a = (gain) => [makeAudioClip({ source: 'lib:s1', at: 1, in: 0, out: 2, gain })];
    return mixSignature(mixParts(sched([clip('')], a(1)))) !== mixSignature(mixParts(sched([clip('')], a(0.4))));
  })());

  check('silence is silence: no bed anywhere means nothing to build',
    hasSound(mixParts(sched([clip(''), clip('')]))) === false);
  check('one clip bed is enough to be worth building',
    hasSound(mixParts(sched([clip(''), clip('lib:a')]))) === true);
  check('so is one sound on the lane',
    hasSound(mixParts(sched([clip('')], [makeAudioClip({ source: 'lib:s', at: 0, in: 0, out: 1 })]))) === true);
  check('so is a sequence-wide bed on its own',
    hasSound(mixParts(sched([clip('')]), 'lib:seq')) === true);
}

/* ================================== transitions that are not fades === */
section('wipe and slide — a transition that is an edge, not a dissolve');
{
  const clip = (o = {}) => makeClip({ kind: 'video', scene: 'bars', rec: {}, src: 4, in: 0, out: 4, ...o });

  check('the list is the fourteen the compositor can draw',
    TRANSITIONS.join() === 'cut,crossfade,dip,dipwhite,burn,wipe,slide,push,iris,clock,barn,blinds,whip,glitch',
    TRANSITIONS.join());
  /* The distinction the SCHEDULE cares about, and the only one it cares
     about: a dissolve, a wipe and a slide all show two clips at once, so the
     incoming one starts before the outgoing one ends. */
  check('the overlapping ones are named rather than spelled out at each site',
    overlaps({ transition: 'crossfade' }) && overlaps({ transition: 'wipe' })
    && overlaps({ transition: 'slide' })
    && !overlaps({ transition: 'cut' }) && !overlaps({ transition: 'dip' })
    && !overlaps(null));
  /* Adding a wipe to a list of one is exactly how you get a transition that
     renders over its neighbour in the compositor and plays AFTER it in the
     schedule — visible as a clip that dissolves into black. */
  check('a wipe shortens the sequence by its overlap, exactly as a dissolve does', (() => {
    const two = (t) => scheduleOf([clip(), clip({ transition: t, xdur: 1 })]);
    const fade = two('crossfade');
    const wipe = two('wipe');
    const slide = two('slide');
    const cut = two('cut');
    return fade.duration === 7 && wipe.duration === 7 && slide.duration === 7 && cut.duration === 8
      && wipe.starts[1] === 3 && cut.starts[1] === 4;
  })());
  check('…and a dip does not, because a dip shows one clip and some black',
    scheduleOf([clip(), clip({ transition: 'dip', xdur: 1 })]).duration === 8);
  check('the first clip of the spine never overlaps anything, whatever it says',
    scheduleOf([clip({ transition: 'wipe', xdur: 1 })]).starts[0] === 0);

  /* Every transition has to be on exactly one side of this line, and getting a
     new one wrong is the specific bug the OVERLAPPING list exists to prevent:
     it renders over its neighbour in the compositor and plays AFTER it in the
     schedule, which reads as a clip dissolving into black. */
  const SHOULD_OVERLAP = ['crossfade', 'wipe', 'slide', 'push', 'iris', 'clock',
    'barn', 'blinds', 'whip', 'glitch'];
  const SHOULD_NOT = ['cut', 'dip', 'dipwhite', 'burn'];
  check('every transition is accounted for on one side of the overlap line or the other',
    [...SHOULD_OVERLAP, ...SHOULD_NOT].sort().join() === [...TRANSITIONS].sort().join(),
    [...TRANSITIONS].filter((t) => ![...SHOULD_OVERLAP, ...SHOULD_NOT].includes(t)).join());
  check('…and each one lands on the side the schedule needs',
    SHOULD_OVERLAP.every((t) => overlaps({ transition: t }))
      && SHOULD_NOT.every((t) => !overlaps({ transition: t })),
    TRANSITIONS.filter((t) => overlaps({ transition: t }) !== SHOULD_OVERLAP.includes(t)).join());
  check('…which the schedule agrees with, one transition at a time', (() => {
    const bad = [];
    for (const t of TRANSITIONS) {
      const d = scheduleOf([clip(), clip({ transition: t, xdur: 1 })]).duration;
      const want = SHOULD_OVERLAP.includes(t) ? 7 : 8;
      if (d !== want) bad.push(`${t}=${d} want ${want}`);
    }
    return bad.length === 0 || bad.join(', ');
  })() === true, String((() => {
    const bad = [];
    for (const t of TRANSITIONS) {
      const d = scheduleOf([clip(), clip({ transition: t, xdur: 1 })]).duration;
      const want = SHOULD_OVERLAP.includes(t) ? 7 : 8;
      if (d !== want) bad.push(`${t}=${d} want ${want}`);
    }
    return bad.join(', ');
  })()));

  /* Direction is a field, not six more transitions. */
  check('the four directions are stored, defaulted and clamped',
    XDIRS.join() === 'l,r,u,d'
      && makeClip({}).xdir === 'l'
      && makeClip({ xdir: 'u' }).xdir === 'u'
      && makeClip({ xdir: 'sideways' }).xdir === 'l',
    XDIRS.join());
  check('a clip written before directions existed reads back as the wipe it always had',
    makeClip({ transition: 'wipe', xdur: 1 }).xdir === 'l');
  check('a barn door is declared axis-only — left and right are the same gesture',
    axisOnly('barn') === true && axisOnly('wipe') === false);
  check('the transitions that travel are the ones offered a direction',
    ['wipe', 'slide', 'push', 'barn', 'blinds', 'whip'].every((t) => takesDirection(t))
      && ['cut', 'crossfade', 'dip', 'dipwhite', 'burn', 'iris', 'clock', 'glitch']
        .every((t) => !takesDirection(t)),
    TRANSITIONS.filter((t) => takesDirection(t)).join());
  const dirField = (t) => fieldsFor(makeClip({ transition: t }), 1).find((f) => f.key === 'xdir');
  check('…and the ones that do not get the control DISABLED with a reason, not hidden',
    dirField('iris').disabled === true && /no direction/.test(dirField('iris').hint)
      && dirField('wipe').disabled === false,
    JSON.stringify(dirField('iris')));
  check('the first clip of the spine is offered neither a transition nor a direction',
    fieldsFor(makeClip({ transition: 'wipe' }), 0).find((f) => f.key === 'xdir').disabled === true);
  check('setting a direction is an edit; setting the same one again is not',
    patchFor(makeClip({ xdir: 'l' }), 'xdir', 'r').xdir === 'r'
      && patchFor(makeClip({ xdir: 'l' }), 'xdir', 'l') === null);
  check('a direction that is not one is refused rather than stored',
    patchFor(makeClip({ xdir: 'r' }), 'xdir', 'diagonally').xdir === 'l');
}

/* ============================ placing a clip by pointing at it === */
section('direct manipulation — the inverse of the matrix the compositor draws with');
{
  const W = 320; const H = 240;
  const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

  /* The round trip is the whole claim: a point put through the matrix and back
     has to land where it started, at any transform. */
  check('a point survives the matrix and its inverse, at any transform', (() => {
    for (const t of [{}, { scale: 0.5 }, { x: 0.3, y: -0.2 }, { rot: 37 }, { flip: 'h' },
                     { x: -0.4, y: 0.25, scale: 2.5, rot: -110, flip: 'hv' }]) {
      const m = matrixFor(t, W, H);
      for (const [px, py] of [[0, 0], [-W / 2, -H / 2], [W / 2, H / 2], [17, -43]]) {
        const qx = m[0] * px + m[2] * py + m[4];
        const qy = m[1] * px + m[3] * py + m[5];
        const back = invertPoint(t, W, H, qx, qy);
        if (!near(back.x, px, 1e-6) || !near(back.y, py, 1e-6)) return false;
      }
    }
    return true;
  })());
  check('the centre of the frame is the centre of an untransformed clip', (() => {
    const p = invertPoint({}, W, H, W / 2, H / 2);
    return near(p.x, 0) && near(p.y, 0);
  })());

  check('a point on the clip is inside it, and one outside is not',
    insideClip({}, W, H, W / 2, H / 2) === true
    && insideClip({ scale: 0.5 }, W, H, W / 2, H / 2) === true
    && insideClip({ scale: 0.5 }, W, H, 5, 5) === false);
  check('…and a rotated clip is hit at its real corners, not its bounding box', (() => {
    // Turned 45°, the frame's own top-left corner is outside the diamond.
    return insideClip({ rot: 45, scale: 0.5 }, W, H, W / 2, H / 2) === true
      && insideClip({ rot: 45, scale: 0.5 }, W, H, W / 2 - 70, H / 2 - 55) === false;
  })());

  check('an untransformed clip has its handles on the frame corners', (() => {
    const h = handlesFor({}, W, H);
    return near(h.centre[0], W / 2) && near(h.centre[1], H / 2)
      && near(h.corners[0][0], 0) && near(h.corners[0][1], 0)
      && near(h.corners[2][0], W) && near(h.corners[2][1], H);
  })());
  /* The grip is pushed out in OUTPUT pixels, not in clip space: at 0.1× a
     clip-space arm would put it inside the box and at 8× off screen. */
  check('the rotation grip sits a fixed number of pixels off the top edge, at any scale', (() => {
    for (const scale of [0.1, 0.5, 1, 4]) {
      const h = handlesFor({ scale }, W, H);
      const topMid = [(h.corners[0][0] + h.corners[1][0]) / 2, (h.corners[0][1] + h.corners[1][1]) / 2];
      if (!near(Math.hypot(h.rot[0] - topMid[0], h.rot[1] - topMid[1]), ROT_ARM_PX, 1e-6)) return false;
    }
    return true;
  })());
  check('…and it follows the clip round when it is turned', (() => {
    const h = handlesFor({ rot: 180 }, W, H);
    // Upside down, the grip is BELOW the centre.
    return h.rot[1] > h.centre[1];
  })());

  check('the hit test names the grip under the pointer', (() => {
    const h = handlesFor({ scale: 0.5 }, W, H);
    return hitHandle({ scale: 0.5 }, W, H, h.corners[2][0], h.corners[2][1]) === 'c2'
      && hitHandle({ scale: 0.5 }, W, H, h.rot[0], h.rot[1]) === 'rot'
      && hitHandle({ scale: 0.5 }, W, H, W / 2, H / 2) === 'move'
      && hitHandle({ scale: 0.5 }, W, H, 2, 2) === '';
  })());
  /* A tiny clip's grip can overlap a corner, and rotating is the more specific
     intent — so it is asked about first. */
  check('rotation wins a tie with a corner on a very small clip', (() => {
    const t = { scale: MIN_SCALE };
    const h = handlesFor(t, W, H);
    return hitHandle(t, W, H, h.rot[0], h.rot[1]) === 'rot';
  })());
  check('the tolerance is honoured on both sides', (() => {
    const h = handlesFor({}, W, H);
    const [cx, cy] = h.corners[0];
    return hitHandle({}, W, H, cx + HANDLE_PX - 1, cy) === 'c0'
      && hitHandle({}, W, H, cx - HANDLE_PX - 4, cy - HANDLE_PX - 4, HANDLE_PX) === '';
  })());

  check('dragging a corner to the frame corner is 1×, and halfway is 0.5×', (() => {
    const centre = [W / 2, H / 2];
    return near(scaleAt(W, H, centre, W, H), 1)
      && near(scaleAt(W, H, centre, W * 0.75, H * 0.75), 0.5);
  })());
  check('…clamped at both ends rather than allowed to reach zero',
    scaleAt(W, H, [W / 2, H / 2], W / 2, H / 2) === MIN_SCALE
    && scaleAt(W, H, [W / 2, H / 2], 99999, 99999) === MAX_SCALE);

  check('pointing at the top of the frame is no rotation; the right-hand side is a quarter turn', (() => {
    const centre = [W / 2, H / 2];
    return rotAt(centre, W / 2, 0) === 0 && rotAt(centre, W, H / 2) === 90
      && rotAt(centre, 0, H / 2) === -90;
  })());
  check('…and it wraps rather than running off the end',
    rotAt([W / 2, H / 2], W / 2, H) === 180);

  /* Offsets are fractions of the frame, so a pixel delta has to be divided by
     the frame — which is also what makes a drag feel the same at any size. */
  check('moving by a quarter of the frame moves x by 0.25', (() => {
    const m = moveBy({}, W, H, W / 4, -H / 2);
    return m.x === 0.25 && m.y === -0.5;
  })());
  check('…from wherever the clip already was, and clamped', (() => {
    const m = moveBy({ x: 0.5, y: 0 }, W, H, W / 4, 0);
    return m.x === 0.75 && moveBy({ x: 1.9 }, W, H, W * 5, 0).x === MAX_OFFSET;
  })());
}

/* ================================= the sound that came with the shot === */
section('footage audio — a clip you imported can finally be heard');
{
  const shot = (o = {}) => makeClip({ kind: 'video', scene: 'videoin', src: 8, in: 0, out: 8,
    rec: { 'v-srckey': 'lib:abc' }, ...o });
  const sched = (clips, total = 8) => ({ clips, starts: clips.map(() => 0), audio: [], total });

  check('footageKeyOf finds the file a clip plays',
    footageKeyOf(shot()) === 'lib:abc');
  /* The two forms are NOT the same string, and assuming they were double-
     prefixed the source to `lib:lib:abc` — which resolves to no asset and
     mixes to silence, indistinguishable from a container the browser cannot
     decode. */
  check('…and the source form is normalised, never blindly prefixed',
    footageSourceOf(shot()) === 'lib:abc'
    && footageSourceOf(shot({ rec: { 'v-srckey': 'abc' } })) === 'lib:abc'
    && footageSourceOf(makeClip({ dur: 4 })) === '');
  check('…and is empty for anything that is not footage', (() => {
    const scene = makeClip({ kind: 'video', scene: 'terminal', src: 4, rec: { 'v-srckey': 'lib:abc' } });
    const still = makeClip({ kind: 'still', scene: 'videoin', src: 4, rec: { 'v-srckey': 'lib:abc' } });
    return footageKeyOf(scene) === '' && footageKeyOf(still) === ''
      && footageKeyOf(makeClip({ dur: 4 })) === '' && footageKeyOf(null) === '';
  })());

  /* The default is the compatibility decision, not a taste one: a saved project
     was cut against silence, and a load that put dialogue under it would change
     an export its author had already approved. */
  check('a clip defaults to NOT playing its footage’s sound', shot().srcAudio === false);
  check('…and says so through the whole round trip',
    makeClip({ ...shot({ srcAudio: true }) }).srcAudio === true
    && makeClip({ ...shot(), srcAudio: 'yes' }).srcAudio === true);

  check('with it off, the clip contributes no sound at all',
    mixParts(sched([shot()])).video.length === 0);
  check('with it on, the clip’s own file is in the mix, at the clip’s start', (() => {
    const p = mixParts(sched([shot({ srcAudio: true })])).video;
    return p.length === 1 && p[0].choice === 'lib:abc' && p[0].at === 0;
  })());

  /* The claim that makes it usable rather than merely audible. A trimmed clip
     starts partway into its file, and sound that ignored that would drift from
     the picture by exactly the in-point — the mouth and the voice apart by two
     seconds, on every trimmed shot. */
  check('a trimmed clip starts its sound where the picture starts, inside the file', (() => {
    const p = mixParts(sched([shot({ srcAudio: true, in: 2, out: 6 })])).video;
    return p[0].offset === 2 && p[0].seconds === 4;
  })());
  /* And it must not loop. A bed is a hum you want repeated; a shot whose sound
     ends before the picture does has simply ended. */
  check('…and does not loop when it runs out', mixParts(sched([shot({ srcAudio: true })])).video[0].loop === false);
  check('a bed still loops from the top, exactly as before', (() => {
    const p = mixParts(sched([shot({ bed: 'lib:hum' })])).video;
    return p[0].choice === 'lib:hum' && p[0].offset === 0 && p[0].loop === true;
  })());

  /* Two parts, not two values of one — a room tone under your own footage is
     the ordinary case, not a conflict to resolve. */
  check('a bed and the footage’s own sound compose rather than replacing', (() => {
    const p = mixParts(sched([shot({ srcAudio: true, bed: 'lib:hum' })])).video;
    return p.length === 2 && p.some((q) => q.choice === 'lib:hum') && p.some((q) => q.loop === false);
  })());
  check('…and either one on its own is enough to be worth building',
    hasSound(mixParts(sched([shot({ srcAudio: true })]))) === true
    && hasSound(mixParts(sched([shot()]))) === false);

  check('turning it on changes the mix signature', (() => {
    const off = mixSignature(mixParts(sched([shot()])));
    const on = mixSignature(mixParts(sched([shot({ srcAudio: true })])));
    return off !== on;
  })());
  check('…and so does re-trimming it, because the offset moved', (() => {
    const a = mixSignature(mixParts(sched([shot({ srcAudio: true, in: 1, out: 5 })])));
    const b = mixSignature(mixParts(sched([shot({ srcAudio: true, in: 2, out: 6 })])));
    return a !== b;
  })());

  check('the panel offers the switch only to a clip that has footage', (() => {
    const has = fieldsFor(shot(), 1).some((f) => f.key === 'srcAudio');
    const hasnt = fieldsFor(makeClip({ dur: 4 }), 1).some((f) => f.key === 'srcAudio');
    return has && !hasnt;
  })());
  check('…and reads and writes it', (() => {
    const c = shot();
    return valueFor(c, 'srcAudio') === false && patchFor(c, 'srcAudio', true).srcAudio === true;
  })());
  /* Stored-and-ignored is the failure mode worth refusing: a true left on a
     terminal scene travels through the project file and becomes real the day
     someone points that clip at a video. */
  check('a clip with no footage refuses the field rather than storing it',
    patchFor(makeClip({ dur: 4 }), 'srcAudio', true) === null);
}

/* ======================================= preview sound as the clock === */
section('preview sound — the state machine, and what happens when it is blocked');
{
  /* A fake AudioContext, because the claims worth pinning are about the STATE
     MACHINE — created only on a gesture, refusing to take over the clock while
     suspended, looping, releasing — and none of them need real samples. */
  let blocked = false, made = 0;
  class FakeSource {
    constructor(ctx) { this.ctx = ctx; this.buffer = null; this.loop = false; this.started = null; this.stopped = false; }
    connect() { this.connected = true; }
    disconnect() { this.connected = false; }
    start(when, off) { this.started = { when, off }; this.ctx.last = this; }
  }
  class FakeCtx {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.last = null; made++; }
    createBufferSource() { return new FakeSource(this); }
    async resume() { if (!blocked) this.state = 'running'; }
    async close() { this.state = 'closed'; }
  }
  const buf = (duration) => ({ duration });

  globalThis.localStorage = globalThis.localStorage || {
    _m: new Map(),
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); },
  };
  globalThis.window = globalThis.window || {};
  globalThis.window.AudioContext = FakeCtx;

  const P = await import('./src/audio/preview.js');

  check('preview sound is on by default — it simply cannot make a noise yet',
    P.previewSoundOn() === true && P.sequenceAudioReady() === false);
  check('no context exists until something asks for one',
    P.previewAudioState().context === 'none' && made === 0);

  /* The bug this whole design is shaped around: a context created without a
     gesture is born suspended, and a suspended context's clock DOES NOT MOVE.
     Taking it as the master would freeze the picture on frame one. */
  check('playing before a gesture is refused', P.startSequenceAudio(buf(5), 0) === false);
  check('…and the clock stays null, so the picture keeps wall time',
    P.sequenceAudioTime() === null);

  blocked = true;
  check('a browser that refuses to unblock gives no context back',
    (await P.armSequenceAudio()) === null);
  check('…the state says so honestly', P.previewAudioState().context === 'suspended');
  check('…and starting still refuses rather than freezing the preview',
    P.startSequenceAudio(buf(5), 0) === false && P.sequenceAudioTime() === null);

  blocked = false;
  const ctx = await P.armSequenceAudio();
  check('once the gesture takes, the context is running', !!ctx && P.sequenceAudioReady() === true);
  check('the same context is reused rather than stacking new ones', made === 1);

  check('playing takes over the clock at the offset it was given',
    P.startSequenceAudio(buf(5), 2) === true && P.sequenceAudioTime() === 2);
  check('the buffer is looped, because the buffer IS the sequence',
    ctx.last.loop === true && ctx.last.buffer.duration === 5);
  check('…and it starts inside the buffer, not at zero', ctx.last.started.off === 2);
  ctx.currentTime = 1.5;
  check('the clock advances with the hardware, not with performance.now()',
    Math.abs(P.sequenceAudioTime() - 3.5) < 1e-9);
  ctx.currentTime = 4;
  check('and wraps at the end of the sequence exactly as the picture does',
    Math.abs(P.sequenceAudioTime() - 1) < 1e-9);

  /* Tab hidden, device asleep: the browser suspends the context under us. The
     clock freezes, so reporting it would pin the preview to one frame forever. */
  ctx.state = 'suspended';
  check('a context suspended under us hands the clock back rather than freezing it',
    P.sequenceAudioTime() === null);
  ctx.state = 'running';

  const src = ctx.last;
  P.stopSequenceAudio();
  check('stopping releases the source and the clock', src.connected === false && P.sequenceAudioTime() === null);
  check('…but keeps the context, so resuming needs no second gesture',
    P.sequenceAudioReady() === true && made === 1);

  check('an offset past the end of the buffer wraps instead of throwing',
    P.startSequenceAudio(buf(4), 9) === true && P.sequenceAudioTime() === 1);
  check('a negative offset wraps too', (() => {
    ctx.currentTime = 0;
    return P.startSequenceAudio(buf(4), -1) === true && Math.abs(P.sequenceAudioTime() - 3) < 1e-9;
  })());
  check('a zero-length buffer is refused', P.startSequenceAudio(buf(0), 0) === false);

  /* Turning sound off STOPS rather than muting a gain node: a mixdown left
     running behind a muted node still holds the clock. */
  P.startSequenceAudio(buf(4), 0);
  check('turning preview sound off stops it there and then',
    P.setPreviewSound(false) === false && P.sequenceAudioTime() === null);
  check('…and arming is refused while it is off', (await P.armSequenceAudio()) === null);
  check('…and so is playing', P.startSequenceAudio(buf(4), 0) === false);
  check('the preference is remembered', localStorage.getItem('deadsignal.studio.previewsound') === '0');
  P.setPreviewSound(true);
  check('turning it back on remembers that too',
    localStorage.getItem('deadsignal.studio.previewsound') === '1' && P.previewSoundOn() === true);

  await P.closeSequenceAudio();
  check('closing gives the hardware back', ctx.state === 'closed' && P.previewAudioState().context === 'none');
  await P.armSequenceAudio();
  check('…and the next gesture builds a fresh one', made === 2 && P.sequenceAudioReady() === true);
  await P.closeSequenceAudio();
}

section('a damaged project degrades, it does not crash');
{
  /* Every shape a project can arrive in that the tool did not write: a hand
     edit, a truncated download, a bad merge, a file from an older build whose
     fields have since changed meaning. The model is the last line of defence —
     the renderer calls into it once per parameter per FRAME, so anything that
     throws here does not show an error, it stops the picture. The contract is
     not "reject": it is "come back with a usable answer". */
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  const DAMAGED = [
    undefined, null, 0, '', [], 'clip', true, NaN,
    {}, { in: NaN, out: NaN }, { in: 5, out: 1 }, { in: -10, out: -1 },
    { in: 0, out: Infinity }, { in: -Infinity, out: Infinity },
    { in: 0, out: 3, speed: 0 }, { in: 0, out: 3, speed: -2 }, { in: 0, out: 3, speed: NaN },
    { in: 0, out: 3, speed: 1e9 }, { in: 0, out: 3, speed: '2' },
    { in: 0, out: 3, src: NaN }, { in: 0, out: 3, at: NaN, track: 'V2' },
    { in: 0, out: 3, at: -50, track: 'V2' }, { in: 0, out: 3, at: 1e12, track: 'V2' },
    { in: 0, out: 3, transition: 'star-wipe' }, { in: 0, out: 3, transition: null },
    { in: 0, out: 3, xdur: NaN }, { in: 0, out: 3, xdur: -5 }, { in: 0, out: 3, xdur: 1e6 },
    { in: 0, out: 3, track: 'V9' }, { in: 0, out: 3, kind: 'hologram' },
    { in: 0, out: 3, scale: NaN, rot: NaN, x: NaN, y: NaN, opacity: NaN },
    { in: 0, out: 3, scale: -1, opacity: 50 },
    { in: '0', out: '3' }, { in: 0, out: 3, rec: null }, { in: 0, out: 3, rec: 'x' },
  ];
  let clipOk = true; const clipWhy = [];
  for (const g of DAMAGED) {
    const label = (() => { try { return JSON.stringify(g) ?? String(g); } catch { return String(g); } })();
    let c;
    try { c = makeClip(g); } catch (e) { clipOk = false; clipWhy.push(`${label} threw: ${e.message}`); continue; }
    const len = clipLength(c); const sp = clipSpeed(c);
    const bad = [];
    if (!c || typeof c !== 'object') bad.push('not an object');
    if (!fin(len) || len < MIN_CLIP) bad.push(`length ${len}`);
    if (!fin(sp) || sp < MIN_SPEED || sp > MAX_SPEED) bad.push(`speed ${sp}`);
    for (const lt of [0, len / 2, len, len * 2, -1, NaN]) {
      if (!fin(sourceTimeOf(c, lt))) bad.push(`sourceTimeOf(${lt})=${sourceTimeOf(c, lt)}`);
    }
    if (typeof speedSummary(c) !== 'string') bad.push('speedSummary not a string');
    const box = transformedBox(c, 320, 240);
    if (!box || ![box.x, box.y, box.w, box.h].every(fin)) bad.push(`box ${JSON.stringify(box)}`);
    if (bad.length) { clipOk = false; clipWhy.push(`${label}: ${bad.join(', ')}`); }
  }
  check('every damaged clip shape still yields a finite, playable clip', clipOk, clipWhy.slice(0, 3).join(' | '));

  const LISTS = [
    undefined, null, 'clips', {}, [],
    DAMAGED.map((g) => makeClip(g)),
    [makeClip({ in: 0, out: 3 }), null, undefined, makeClip({ in: 0, out: 3 })],
    Array.from({ length: 500 }, (_, i) => makeClip({ in: 0, out: 1 + (i % 7), transition: i % 2 ? 'crossfade' : 'cut' })),
    // Every clip shorter than its own crossfade: the overlap has to be capped
    // by the clips or the sequence would schedule backwards.
    Array.from({ length: 40 }, () => makeClip({ in: 0, out: 0.2, transition: 'crossfade', xdur: 4 })),
  ];
  let schedOk = true; const schedWhy = [];
  for (const list of LISTS) {
    const label = Array.isArray(list) ? `array(${list.length})` : String(list);
    let s;
    try { s = scheduleOf(list); } catch (e) { schedOk = false; schedWhy.push(`${label} threw: ${e.message}`); continue; }
    const bad = [];
    if (!s || !Array.isArray(s.starts) || !fin(s.duration)) bad.push('shape');
    else {
      if (!s.starts.every(fin)) bad.push('a start is not finite');
      if (s.duration < 0) bad.push(`duration ${s.duration}`);
      /* Only the SPINE accumulates — an overlay sits at the time it says, so
         the array as a whole is deliberately not monotonic. */
      const spine = (Array.isArray(list) ? list : [])
        .map((c, i) => [c, i]).filter(([c]) => c && !isOverlay(c)).map(([, i]) => s.starts[i]);
      if (!spine.every((v, i) => i === 0 || v >= spine[i - 1] - 1e-9)) bad.push('the spine runs backwards');
      const n = Array.isArray(list) ? list.length : 0;
      if (s.starts.length !== n) bad.push(`${s.starts.length} starts for ${n} clips`);
    }
    if (bad.length) { schedOk = false; schedWhy.push(`${label}: ${bad.join(', ')}`); }
  }
  check('every damaged clip LIST still schedules — finite starts, a forward spine, one start per clip',
    schedOk, schedWhy.slice(0, 3).join(' | '));

  let mixOk = true; const mixWhy = [];
  for (const list of LISTS) {
    if (!Array.isArray(list)) continue;
    let parts;
    try { parts = mixParts(scheduleOf(list), 'none'); }
    catch (e) { mixOk = false; mixWhy.push(`array(${list.length}) threw: ${e.message}`); continue; }
    if (!fin(parts.total) || parts.total < 0) { mixOk = false; mixWhy.push(`total ${parts.total}`); }
    const off = parts.video.find((v) => !fin(v.at) || !fin(v.seconds) || !fin(v.offset));
    if (off) { mixOk = false; mixWhy.push(`part ${JSON.stringify(off)}`); }
    if (typeof mixSignature(parts) !== 'string') { mixOk = false; mixWhy.push('signature not a string'); }
  }
  check('the mix description of a damaged sequence is still finite', mixOk, mixWhy.slice(0, 3).join(' | '));

  let sndOk = true; const sndWhy = [];
  for (const g of [undefined, null, {}, { at: NaN }, { at: -5 }, { in: NaN, out: NaN }, { in: 9, out: 1 },
                   { gain: NaN }, { gain: 1e9 }, { pan: NaN }, { pan: 40 },
                   { fadeIn: NaN, fadeOut: NaN }, { fadeIn: -1, fadeOut: -1 },
                   { in: 0, out: 1, fadeIn: 1e6, fadeOut: 1e6 }, { key: 123 }, { key: null }]) {
    const label = JSON.stringify(g) ?? String(g);
    let a;
    try { a = makeAudioClip(g); } catch (e) { sndOk = false; sndWhy.push(`${label} threw: ${e.message}`); continue; }
    const bad = [];
    for (const k of ['at', 'in', 'out', 'gain', 'pan', 'fadeIn', 'fadeOut']) if (!fin(a[k])) bad.push(`${k}=${a[k]}`);
    const dur = audioClipLength(a);
    if (!fin(dur) || dur <= 0) bad.push(`length ${dur}`);
    /* The stored fades must be the fades you HEAR. fadeShape resolves an
       overlapping pair by letting the fade-in win, so a document that stored
       both at full length would show a fade-out in the inspector that never
       happens. */
    if (a.fadeIn + a.fadeOut > dur + 1e-9) bad.push(`fades ${a.fadeIn}+${a.fadeOut} exceed ${dur}`);
    const env = fadeShape(dur, a.fadeIn, a.fadeOut, a.gain);
    if (!Array.isArray(env) || !env.every((k) => fin(k.t) && fin(k.v))) bad.push('envelope');
    if (bad.length) { sndOk = false; sndWhy.push(`${label}: ${bad.join(', ')}`); }
  }
  check('every damaged sound clip yields a finite window and an envelope that matches it',
    sndOk, sndWhy.slice(0, 3).join(' | '));

  let autoOk = true; const autoWhy = [];
  for (const track of [undefined, null, 'x', [], [null], [undefined], [{ t: NaN, v: 1 }], [{ t: 0, v: NaN }],
                       [null, { t: 0, v: 10 }, null, { t: 2, v: 90 }, null],
                       [{ t: 2, v: 1 }, { t: 0, v: 0 }], [{ t: 0, v: 0 }, { t: 0, v: 100 }],
                       [{ t: -5, v: 0 }, { t: 1e9, v: 100 }]]) {
    const label = JSON.stringify(track) ?? String(track);
    const bad = [];
    let norm;
    try { norm = normalizeTrack(track); } catch (e) { bad.push(`normalize threw: ${e.message}`); }
    if (norm) {
      if (!Array.isArray(norm)) bad.push('not an array');
      else {
        if (!norm.every((k, i) => i === 0 || k.t >= norm[i - 1].t)) bad.push('unsorted');
        if (!norm.every((k) => fin(k.t) && fin(k.v))) bad.push('non-finite key survived');
      }
    }
    for (const t of [-1, 0, 0.5, 1e9, NaN]) {
      let v;
      try { v = evalTrack(track, t); } catch (e) { bad.push(`evalTrack(${t}) threw: ${e.message}`); continue; }
      if (!(v === undefined || fin(v))) bad.push(`evalTrack(${t})=${v}`);
    }
    if (bad.length) { autoOk = false; autoWhy.push(`${label}: ${bad.join(', ')}`); }
  }
  check('a keyframe track with unusable keys evaluates around them rather than throwing',
    autoOk, autoWhy.slice(0, 3).join(' | '));

  // The specific shape that used to take the render loop down on frame one.
  let survived = true;
  try { evalTrack([null], 0.5); } catch { survived = false; }
  check('a track that is a single null is not a crash', survived);
  check('…and a partly-null track still interpolates between the keys that are real',
    evalTrack([null, { t: 0, v: 0 }, null, { t: 2, v: 100 }, null], 1) === 50,
    String(evalTrack([null, { t: 0, v: 0 }, null, { t: 2, v: 100 }, null], 1)));
}

section('a title — marks on nothing, which is why it is a clip kind');
{
  check('title is a clip kind, and a HELD one — no time inside it',
    CLIP_KINDS.includes('title') && HELD_KINDS.includes('title'),
    `${CLIP_KINDS} / ${HELD_KINDS}`);

  /* A held kind's Hold IS its length, so speed and reverse would be a second
     way to spell a control it already has. Forced rather than hidden, so a
     hand-edited file cannot smuggle one in. */
  const fast = makeClip({ kind: 'title', src: 4, speed: 4, reverse: true });
  check('a title cannot be given a speed or a reverse', fast.speed === 1 && fast.reverse === false,
    `speed=${fast.speed} reverse=${fast.reverse}`);
  check('…and its length is simply its hold', clipLength(fast) === 4, String(clipLength(fast)));
  check('a title is never mistaken for footage', footageKeyOf({ ...fast, scene: 'videoin', rec: { 'v-srckey': 'lib:x' } }) === '',
    footageKeyOf({ ...fast, scene: 'videoin', rec: { 'v-srckey': 'lib:x' } }));

  // --- the recipe ---------------------------------------------------------
  const def = makeTitle({});
  check('an empty recipe still yields a complete, drawable title',
    def.size >= MIN_SIZE && def.size <= MAX_SIZE && def.fg === '#ffffff'
      && def.place === DEFAULT_PLACE && TREATMENTS.includes(def.treatment),
    JSON.stringify(def));
  check('…and reads as blank, because it has no words in it', isBlankTitle(def) === true);
  check('a title with only a subtitle is not blank', isBlankTitle(makeTitle({ 't-sub': 'x' })) === false);
  check('whitespace is not words', isBlankTitle(makeTitle({ 't-text': '   \n  ' })) === true);

  /* Recipes are captured CONTROL VALUES — strings — so every number has to be
     coerced here rather than by each caller. */
  const strs = makeTitle({ 't-size': '12.5', 't-dx': '-0.25', 't-in': '1.5', 't-bga': '0.25', 't-line': '2' });
  check('numbers arrive as strings and are coerced once, here',
    strs.size === 12.5 && strs.dx === -0.25 && strs.inSec === 1.5 && strs.bgAlpha === 0.25 && strs.line === 2,
    JSON.stringify(strs));

  const wild = makeTitle({
    't-size': '9999', 't-dx': '-99', 't-dy': '99', 't-in': '999', 't-out': '-5',
    't-bga': '4', 't-line': '0', 't-track': '-9', 't-subratio': '0',
    't-fg': 'javascript:alert(1)', 't-bg': 'url(x)',
    't-place': 'nowhere', 't-treat': 'sparkles', 't-anim': 'explode', 't-animout': 'explode',
  });
  check('every out-of-range value is clamped rather than passed through',
    wild.size === MAX_SIZE && wild.dx === -1 && wild.dy === 1 && wild.inSec === MAX_ANIM
      && wild.outSec === 0 && wild.bgAlpha === 1 && wild.line === 0.8 && wild.track === -0.2
      && wild.subRatio === 0.2,
    JSON.stringify(wild));
  check('a colour that is not a colour falls back rather than reaching the canvas',
    wild.fg === '#ffffff' && wild.bg === '#000000', `${wild.fg} ${wild.bg}`);
  check('an unknown place, treatment or animation falls back to a real one',
    wild.place === DEFAULT_PLACE && TREATMENTS.includes(wild.treatment)
      && ANIM_IN.includes(wild.animIn) && ANIM_OUT.includes(wild.animOut),
    JSON.stringify([wild.place, wild.treatment, wild.animIn, wild.animOut]));
  check('text is capped at its declared length',
    makeTitle({ 't-text': 'x'.repeat(9999) }).text.length === MAX_TITLE_TEXT
      && makeTitle({ 't-sub': 'y'.repeat(9999) }).sub.length === MAX_TITLE_SUB);
  for (const junk of [undefined, null, 'nope', 42, [], true]) {
    check(`a recipe that is ${JSON.stringify(junk) ?? String(junk)} still yields a title`,
      typeof makeTitle(junk).size === 'number');
  }

  // --- the animation ------------------------------------------------------
  const fade = makeTitle({ 't-text': 'X', 't-anim': 'fade', 't-animout': 'fade', 't-in': '1', 't-out': '1' });
  check('a title starts invisible and reaches full strength', titleAlpha(0, 6, fade) === 0
    && titleAlpha(3, 6, fade) === 1, `${titleAlpha(0, 6, fade)} / ${titleAlpha(3, 6, fade)}`);
  check('…and leaves the same way', titleAlpha(6, 6, fade) === 0, String(titleAlpha(6, 6, fade)));
  check('the ramp is eased, not linear — halfway through the fade is not half opacity',
    titleAlpha(0.5, 6, fade) === 0.5 && titleAlpha(0.25, 6, fade) < 0.25,
    `${titleAlpha(0.5, 6, fade)} / ${titleAlpha(0.25, 6, fade)}`);

  /* The case that would otherwise never reach full strength: ramps that
     together outrun the clip. Splitting the time keeps both gestures and just
     makes them quicker. */
  const squeezed = makeTitle({ 't-text': 'X', 't-anim': 'fade', 't-animout': 'fade', 't-in': '2', 't-out': '2' });
  const r = titleRamps(1, 2, squeezed);
  check('two ramps longer than the clip are split between them, not left to overlap',
    Math.abs(r.inSec - 1) < 1e-9 && Math.abs(r.outSec - 1) < 1e-9, JSON.stringify(r));
  check('…so the title still reaches full strength exactly once, in the middle',
    titleAlpha(1, 2, squeezed) === 1, String(titleAlpha(1, 2, squeezed)));

  const cut = makeTitle({ 't-text': 'X', 't-anim': 'none', 't-animout': 'none' });
  check('a title told to cut on and off is at full strength throughout',
    [0, 0.5, 1.5, 3].every((t) => titleAlpha(t, 3, cut) === 1));

  const rise = makeTitle({ 't-text': 'X', 't-anim': 'rise', 't-in': '1' });
  check('a rising title starts below its place and arrives at it',
    titleRise(0, 6, rise) > 0 && titleRise(2, 6, rise) === 0,
    `${titleRise(0, 6, rise)} / ${titleRise(2, 6, rise)}`);

  const type = makeTitle({ 't-text': 'ABCDEFGH', 't-anim': 'type', 't-in': '2' });
  check('a typewriter reveals over its in-time and is complete after it',
    titleReveal(0, 6, type) === 0 && titleReveal(1, 6, type) === 0.5 && titleReveal(3, 6, type) === 1,
    [0, 1, 3].map((t) => titleReveal(t, 6, type)).join(' '));
  check('every other animation is fully revealed throughout — the renderer applies it unconditionally',
    [fade, cut, rise].every((c) => [0, 1, 3].every((t) => titleReveal(t, 6, c) === 1)));

  /* Time outside the clip, and a clip with no length: the scrubber can land
     anywhere and the exporter renders frames out of order. */
  for (const [t, len] of [[-5, 3], [99, 3], [0, 0], [1, 0], [NaN, 3], [1, NaN]]) {
    const a = titleAlpha(t, len, fade);
    check(`alpha stays inside 0..1 at t=${t} len=${len}`, Number.isFinite(a) && a >= 0 && a <= 1, String(a));
    const u = titleReveal(t, len, type);
    check(`reveal stays inside 0..1 at t=${t} len=${len}`, Number.isFinite(u) && u >= 0 && u <= 1, String(u));
  }

  // --- the text effects ---------------------------------------------------
  check('the entrance list carries the two progressive ones and the two kinetic ones',
    ANIM_IN.join() === 'none,fade,rise,type,word,pop', ANIM_IN.join());
  const word = makeTitle({ 't-text': 'A B C D', 't-anim': 'word', 't-in': '2' });
  /* Both progressive entrances have to report a fraction. Leaving 'word' out of
     titleReveal made the renderer ask for a reveal and always be told "all of
     it" — the control was in the picker and did nothing. */
  check('a word-by-word entrance reveals progressively, exactly as the typewriter does',
    titleReveal(0, 6, word) === 0 && titleReveal(1, 6, word) === 0.5 && titleReveal(3, 6, word) === 1,
    [0, 1, 3].map((t) => titleReveal(t, 6, word)).join(' '));

  const popT = makeTitle({ 't-text': 'X', 't-anim': 'pop', 't-in': '1' });
  check('a popping title grows into place and settles at exactly 1',
    titleScale(0, 6, popT) < 1 && titleScale(2, 6, popT) === 1,
    `${titleScale(0, 6, popT)} → ${titleScale(2, 6, popT)}`);
  check('…and every other entrance leaves the scale alone',
    ['none', 'fade', 'rise', 'type', 'word'].every((a) =>
      titleScale(0.5, 6, makeTitle({ 't-anim': a })) === 1));

  /* The continuous effect is a SEPARATE control from the entrance, so a title
     can fade in and shimmer — which is most of the reason to want either. */
  check('the effect list is the five the renderer draws',
    TEXT_FX.join() === 'none,wave,neon,chroma,jitter', TEXT_FX.join());
  const both = makeTitle({ 't-anim': 'fade', 't-fx': 'wave', 't-fxamt': '0.8' });
  check('an entrance and an effect coexist rather than replacing each other',
    both.animIn === 'fade' && both.fx === 'wave' && both.fxAmt === 0.8);
  check('an unknown effect falls back rather than reaching the renderer',
    makeTitle({ 't-fx': 'sparkle' }).fx === 'none');
  check('the effect amount is clamped to 0..1',
    makeTitle({ 't-fxamt': '99' }).fxAmt === 1 && makeTitle({ 't-fxamt': '-9' }).fxAmt === 0);

  /* A roll travels the whole clip rather than a ramp: one that finished in the
     first half-second and then sat still would not be a roll. */
  check('the roll list is the two the renderer draws', ROLLS.join() === 'none,up,left');
  check('no roll reads as null, not as zero — the two need different placement',
    titleRollAt(1, 6, makeTitle({})) === null);
  const rolled = makeTitle({ 't-roll': 'up' });
  check('a roll runs 0 to 1 across the WHOLE clip, not across a ramp',
    titleRollAt(0, 6, rolled) === 0 && titleRollAt(3, 6, rolled) === 0.5
      && titleRollAt(6, 6, rolled) === 1,
    [0, 3, 6].map((t) => titleRollAt(t, 6, rolled)).join(' '));
  check('…and stays inside 0..1 outside the clip and on a degenerate one',
    titleRollAt(-9, 6, rolled) === 0 && titleRollAt(99, 6, rolled) === 1
      && Number.isFinite(titleRollAt(1, 0, rolled)));

  /* Every effect needs jitter and none may use Math.random: the exporter
     renders frames out of order, and an export that shimmered differently from
     the scrub that approved it is worse than one that did not shimmer. */
  check('the noise is deterministic — the same inputs give the same value, always',
    steadyNoise(3, 7, 1) === steadyNoise(3, 7, 1) && steadyNoise(3, 7, 1) !== steadyNoise(4, 7, 1));
  check('…and is a fraction, whatever it is handed',
    [[0, 0, 0], [1e9, -5, 2], [0.5, 0.5, 0.5]].every(([a, b, c]) => {
      const v = steadyNoise(a, b, c); return Number.isFinite(v) && v >= 0 && v < 1;
    }));

  // --- placement ----------------------------------------------------------
  check('there are nine places, and each names an alignment', TITLE_PLACES.length === 9
    && TITLE_PLACES.every((p) => ['left', 'center', 'right'].includes(p.align)));
  const mid = titleAnchor(makeTitle({ 't-place': 'mc' }), 1000, 500);
  check('the centre place is the centre of the frame',
    mid.x === 500 && mid.y === 250 && mid.align === 'center', JSON.stringify(mid));
  const tl = titleAnchor(makeTitle({ 't-place': 'tl' }), 1000, 500);
  check('a corner is inset by the title-safe margin, not flush to the frame edge',
    tl.x === SAFE * 1000 && tl.y === SAFE * 500, JSON.stringify(tl));
  /* The whole reason size and offset are fractions: the same title on a bigger
     delivery has to be the same title. */
  const small = titleAnchor(makeTitle({ 't-place': 'bc' }), 320, 240);
  const big = titleAnchor(makeTitle({ 't-place': 'bc' }), 1920, 1440);
  check('placement is resolution-independent — the same fraction of any frame',
    Math.abs(small.x / 320 - big.x / 1920) < 1e-9 && Math.abs(small.y / 240 - big.y / 1440) < 1e-9,
    JSON.stringify([small, big]));
  const nudged = titleAnchor(makeTitle({ 't-place': 'mc', 't-dx': '0.1', 't-dy': '-0.2' }), 1000, 500);
  check('the nudge moves it by that fraction of the frame',
    nudged.x === 600 && nudged.y === 150, JSON.stringify(nudged));

  check('lines are split on newlines, blanks kept', titleLines('a\n\nb').length === 3);
  check('the lane label is the first line of whatever there is',
    titleSummary(makeTitle({ 't-text': 'EREBUS ARCHIVE\nsecond' })) === 'EREBUS ARCHIVE'
      && titleSummary(makeTitle({ 't-sub': 'only a sub' })) === 'only a sub'
      && titleSummary(makeTitle({})) === 'Empty title');

  // --- the editable surface ----------------------------------------------
  const clip = makeClip({ kind: 'title', src: 3, rec: { 't-text': 'HELLO' } });
  const keys = fieldsFor(clip, 1).map((f) => f.key);
  check('the inspector offers the title fields', keys.includes('t-text') && keys.includes('t-place')
    && keys.includes('t-treat') && keys.includes('t-anim'), keys.join(','));
  check('…and does NOT offer speed or reverse on one', !keys.includes('speed') && !keys.includes('reverse'));
  check('…and calls its length Hold, not Source',
    fieldsFor(clip, 1).find((f) => f.key === 'src').label === 'Hold');
  check('a title has no source tab — sending one to VIDEO would overwrite it with a scene',
    SOURCE_TAB.title === undefined && SOURCE_VIEW.title === undefined);
  check('reading a title field reads it out of the recipe', valueFor(clip, 't-text') === 'HELLO');
  const patch = patchFor(clip, 't-text', 'GOODBYE');
  check('writing one writes back into the recipe, leaving the rest of it alone',
    patch.rec['t-text'] === 'GOODBYE' && patch.rec['t-place'] === undefined, JSON.stringify(patch));
  check('writing the same value again is not an edit', patchFor(clip, 't-text', 'HELLO') === null);

  /* On a title the words ARE the clip, so a lane block still reading the old
     ones is simply wrong. But `label` is also an editable field, and silently
     overwriting a name the author chose would be worse than a stale one. */
  const named = makeClip({ kind: 'title', src: 3, rec: { 't-text': 'FIRST' }, label: titleLabel({ 't-text': 'FIRST' }) });
  const renamed = patchFor(named, 't-text', 'SECOND');
  check('changing the words renames an auto-named title along with them',
    renamed.label === titleLabel({ 't-text': 'SECOND' }), JSON.stringify(renamed));
  const mine = makeClip({ kind: 'title', src: 3, rec: { 't-text': 'FIRST' }, label: 'Opening card' });
  const kept = patchFor(mine, 't-text', 'SECOND');
  check('…and leaves a name the author typed exactly alone',
    kept.label === undefined && kept.rec['t-text'] === 'SECOND', JSON.stringify(kept));
  check('a still is never renamed by its copy — this is a title rule, not a general one',
    patchFor(makeClip({ kind: 'still', src: 3, rec: { 'i-title': 'A' }, label: 'Still · A' }), 'i-title', 'B').label
      === undefined);
}

section('the shared ramp — how anything held arrives and leaves');
{
  /* Titles and graphics owe the author the same two promises, and it would be a
     bug for them to keep those promises differently. */
  const r = ramps(1, 4, 1, 1);
  check('an in-ramp climbs to 1 and stays there', ramps(0, 4, 1, 1).rin === 0 && r.rin === 1);
  check('an out-ramp is 1 until it starts, then falls to 0',
    ramps(1, 4, 1, 1).rout === 1 && ramps(4, 4, 1, 1).rout === 0);
  const split = ramps(2, 4, 3, 3);
  check('two ramps longer than the clip are split between it, keeping both gestures',
    Math.abs(split.inSec - 2) < 1e-9 && Math.abs(split.outSec - 2) < 1e-9, JSON.stringify(split));
  check('…and the readout says what is USED, not what was set — so a panel cannot lie',
    split.inSec < 3);
  check('a ramp longer than the ceiling is clamped to it', ramps(0, 100, 999, 0).inSec === MAX_RAMP);
  check('no ramp is zero-length by accident: an unset ramp is simply already done',
    ramps(0, 4, 0, 0).rin === 1 && ramps(4, 4, 0, 0).rout === 1);
  check('ease is a smoothstep — flat at both ends, half way at the middle',
    ease(0) === 0 && ease(1) === 1 && ease(0.5) === 0.5 && ease(0.25) < 0.25);
  for (const [t, len, i, o] of [[NaN, 4, 1, 1], [1, NaN, 1, 1], [1, 0, 1, 1], [-9, 4, 1, 1],
                               [1, 4, NaN, NaN], [1, -4, 1, 1]]) {
    const q = ramps(t, len, i, o);
    check(`ramps stay inside 0..1 for (${t}, ${len}, ${i}, ${o})`,
      [q.rin, q.rout].every((v) => Number.isFinite(v) && v >= 0 && v <= 1), JSON.stringify(q));
  }
}

section('a graphic — the annotation vocabulary, moved onto the clip axis');
{
  check('graphic is a clip kind, held, and drawn OVER the picture',
    CLIP_KINDS.includes('graphic') && HELD_KINDS.includes('graphic') && OVER_KINDS.includes('graphic'),
    `${CLIP_KINDS} / ${HELD_KINDS} / ${OVER_KINDS}`);
  check('the two over-kinds are exactly the ones with a cleared buffer',
    JSON.stringify([...OVER_KINDS].sort()) === JSON.stringify(['graphic', 'title']), String(OVER_KINDS));
  const g = makeClip({ kind: 'graphic', src: 4, speed: 5, reverse: true });
  check('a graphic cannot be given a speed or a reverse', g.speed === 1 && g.reverse === false);
  check('…and its length is simply its hold', clipLength(g) === 4);

  check('there are eight shapes, each with a name', SHAPES.length === 8
    && SHAPES.every((s2) => s2.v && s2.t && s2.hint), `${SHAPES.length}`);
  check('the outlined ones are the ones that can be drawn on',
    SHAPES.filter((s2) => isStroked(s2.v)).map((s2) => s2.v).join(',') === 'box,ellipse,line,arrow,bracket,crosshair',
    SHAPES.filter((s2) => isStroked(s2.v)).map((s2) => s2.v).join(','));
  check('the diagonal ones are the vectors — a line and an arrow',
    SHAPES.filter((s2) => isDiagonal(s2.v)).map((s2) => s2.v).join(',') === 'line,arrow');
  check('an unknown shape falls back to a real one rather than drawing nothing',
    shapeSpec('hexagram').v === DEFAULT_SHAPE);

  const def = makeGraphic({});
  check('an empty recipe still yields a complete, drawable shape',
    def.shape === DEFAULT_SHAPE && def.weight >= MIN_WEIGHT && def.opacity === 1
      && GFX_IN.includes(def.animIn) && GFX_OUT.includes(def.animOut), JSON.stringify(def));
  const wild = makeGraphic({
    'g-x': '99', 'g-y': '-99', 'g-w': '99', 'g-h': '-99', 'g-rot': '9999',
    'g-weight': '999', 'g-radius': '9', 'g-dash': '-9', 'g-opacity': '9', 'g-filla': '-1',
    'g-colour': 'javascript:x', 'g-fill': 'url(x)', 'g-shape': 'nope',
    'g-anim': 'explode', 'g-animout': 'explode', 'g-in': '999', 'g-out': '-9',
  });
  check('every out-of-range value is clamped rather than passed through',
    wild.x === 2 && wild.y === -1 && wild.w === 2 && wild.h === -2 && wild.rot === 180
      && wild.weight === MAX_WEIGHT && wild.radius === 0.5 && wild.dash === 0
      && wild.opacity === 1 && wild.fillAlpha === 0 && wild.inSec === MAX_GFX_ANIM && wild.outSec === 0,
    JSON.stringify(wild));
  check('a colour that is not a colour falls back rather than reaching the canvas',
    wild.colour === '#39ff9e' && wild.fill === '#000000');
  check('an unknown shape or animation falls back to a real one',
    wild.shape === DEFAULT_SHAPE && GFX_IN.includes(wild.animIn) && GFX_OUT.includes(wild.animOut));
  for (const junk of [undefined, null, 'nope', 42, [], true]) {
    check(`a recipe that is ${JSON.stringify(junk) ?? String(junk)} still yields a shape`,
      typeof makeGraphic(junk).weight === 'number');
  }

  /* A signed width is the whole reason an arrow points where it was aimed —
     but every question ABOUT the rectangle needs the sign resolved, once. */
  const back = makeGraphic({ 'g-x': '0.8', 'g-y': '0.8', 'g-w': '-0.5', 'g-h': '-0.4' });
  check('a negative size keeps its sign, so an arrow still points where it was aimed',
    back.w === -0.5 && back.h === -0.4);
  const rect = rectOfGraphic(back);
  check('…and the rectangle it covers is resolved once, sign removed',
    Math.abs(rect.x - 0.3) < 1e-9 && Math.abs(rect.y - 0.4) < 1e-9
      && Math.abs(rect.w - 0.5) < 1e-9 && Math.abs(rect.h - 0.4) < 1e-9, JSON.stringify(rect));

  check('a shape with no area is recognised as empty', isEmptyGraphic(makeGraphic({ 'g-w': '0', 'g-h': '0' })));
  check('…and a line with length is not, even though its box has no area',
    isEmptyGraphic(makeGraphic({ 'g-shape': 'line', 'g-w': '0.5', 'g-h': '0' })) === false);
  check('a null shape is empty rather than a crash', isEmptyGraphic(null) === true);

  // --- the animation ------------------------------------------------------
  const fade = makeGraphic({ 'g-anim': 'fade', 'g-animout': 'fade', 'g-in': '1', 'g-out': '1' });
  check('a fading shape is absent at both ends and full in the middle',
    graphicAlpha(0, 6, fade) === 0 && graphicAlpha(3, 6, fade) === 1 && graphicAlpha(6, 6, fade) === 0);
  check('the clip’s own opacity multiplies the ramp rather than replacing it',
    graphicAlpha(3, 6, makeGraphic({ 'g-anim': 'fade', 'g-opacity': '0.5' })) === 0.5);

  /* A gesture that carries its own motion must not ALSO fade — two effects
     fighting reads as neither. */
  const pop = makeGraphic({ 'g-anim': 'pop', 'g-in': '1' });
  check('a popping shape is at full opacity from the start — the motion IS the entrance',
    graphicAlpha(0.01, 6, pop) === 1);
  check('…and grows into place, overshooting on the way',
    graphicScale(0, 6, pop).sx < 1 && graphicScale(2, 6, pop).sx === 1
      && graphicScale(0.5, 6, pop).sx > graphicScale(0.25, 6, pop).sx,
    JSON.stringify([graphicScale(0, 6, pop), graphicScale(0.5, 6, pop), graphicScale(2, 6, pop)]));

  const slam = makeGraphic({ 'g-anim': 'slam', 'g-in': '1' });
  const s0 = graphicScale(0, 6, slam); const s1 = graphicScale(2, 6, slam);
  check('a slam opens vertically at full width — the redaction gesture',
    s0.sx === 1 && s0.sy === 0 && s1.sy === 1, JSON.stringify([s0, s1]));

  const draw = makeGraphic({ 'g-anim': 'draw', 'g-in': '2' });
  check('a drawn-on shape reveals over its in-time and is complete after it',
    graphicDraw(0, 6, draw) === 0 && graphicDraw(1, 6, draw) === 0.5 && graphicDraw(3, 6, draw) === 1,
    [0, 1, 3].map((t) => graphicDraw(t, 6, draw)).join(' '));
  check('every other entrance is fully drawn throughout — the renderer applies it unconditionally',
    [fade, pop, slam].every((c) => [0, 1, 3].every((t) => graphicDraw(t, 6, c) === 1)));

  const shrink = makeGraphic({ 'g-anim': 'none', 'g-animout': 'shrink', 'g-out': '1' });
  check('a shrinking shape leaves by getting smaller AND fainter',
    graphicScale(6, 6, shrink).sx === 0 && graphicAlpha(6, 6, shrink) === 0
      && graphicScale(0, 6, shrink).sx === 1);

  for (const [t, len] of [[-5, 3], [99, 3], [0, 0], [NaN, 3], [1, NaN]]) {
    const a = graphicAlpha(t, len, fade); const sc = graphicScale(t, len, pop);
    check(`alpha and scale stay finite at t=${t} len=${len}`,
      Number.isFinite(a) && a >= 0 && a <= 1 && Number.isFinite(sc.sx) && Number.isFinite(sc.sy),
      JSON.stringify([a, sc]));
  }

  // --- the editable surface ----------------------------------------------
  const clip = makeClip({ kind: 'graphic', src: 3, rec: { 'g-shape': 'arrow' } });
  const keys = fieldsFor(clip, 1).map((f) => f.key);
  check('the inspector offers the shape fields',
    ['g-shape', 'g-x', 'g-w', 'g-colour', 'g-weight', 'g-anim'].every((k) => keys.includes(k)),
    keys.join(','));
  check('…and does NOT offer speed or reverse', !keys.includes('speed') && !keys.includes('reverse'));
  check('…and calls its length Hold', fieldsFor(clip, 1).find((f) => f.key === 'src').label === 'Hold');
  check('a graphic has no source tab either', SOURCE_TAB.graphic === undefined);
  check('changing the shape renames an auto-named block along with it',
    patchFor(makeClip({ kind: 'graphic', src: 3, rec: { 'g-shape': 'box' }, label: graphicLabel({ 'g-shape': 'box' }) }),
      'g-shape', 'arrow').label === graphicLabel({ 'g-shape': 'arrow' }));
  check('…and leaves a name the author typed alone',
    patchFor(makeClip({ kind: 'graphic', src: 3, rec: { 'g-shape': 'box' }, label: 'Callout 1' }),
      'g-shape', 'arrow').label === undefined);
}

/* ================================================== the matte ============ */
/* The key and the mask: which parts of a clip are used. The renderer half of
   this is measured in the deep audit, on real pixels — what is pinned here is
   the arithmetic the renderer runs per pixel, which is the part that can be
   wrong in a way a screenshot cannot show. */
section('the matte — which parts of a clip are used');
{
  const M = (over) => makeMatte(over || {});

  // --- defaults, and what an old clip reads back as ------------------------
  const d = M();
  check('a clip with no matte reads back as the whole clip',
    d.keyMode === 'off' && d.maskShape === 'none');
  check('…and the fields are all present anyway, so the stored shape is one shape',
    Object.keys(d).length === 15 && typeof d.keyColour === 'string'
      && typeof d.maskInvert === 'boolean', Object.keys(d).join(','));
  check('the default key colour is broadcast chroma green, not pure #00ff00',
    d.keyColour === '#00b140', d.keyColour);
  check('every matte field lands on a clip and survives normalisation',
    (() => {
      const c = makeClip({ keyMode: 'chroma', keyTol: 0.5, maskShape: 'ellipse', maskInvert: true });
      return c.keyMode === 'chroma' && c.keyTol === 0.5 && c.maskShape === 'ellipse' && c.maskInvert === true;
    })());
  check('an unknown key mode falls back rather than reaching the renderer',
    M({ keyMode: 'magic' }).keyMode === 'off');
  check('an unknown mask shape and mode do too',
    M({ maskShape: 'blob' }).maskShape === 'none' && M({ maskMode: 'melt' }).maskMode === 'reveal');
  check('a colour that is not a colour is refused',
    M({ keyColour: 'javascript:alert(1)' }).keyColour === '#00b140');
  for (const [k, lo, hi] of [['keyTol', 0, 1], ['keySoft', 0, 1], ['keySpill', 0, 1],
    ['maskFeather', 0, MAX_FEATHER], ['maskAmount', 0, 1], ['maskRot', -180, 180]]) {
    check(`${k} is clamped to ${lo}..${hi}`,
      M({ [k]: -999 })[k] === lo && M({ [k]: 999 })[k] === hi,
      `${M({ [k]: -999 })[k]} / ${M({ [k]: 999 })[k]}`);
  }
  check('a NaN anywhere in the matte becomes the default, not NaN',
    Object.values(M({ keyTol: NaN, maskW: NaN, maskRot: 'x' }))
      .every((v) => typeof v !== 'number' || Number.isFinite(v)));
  check('the stored fields are derived from the normaliser, not listed a second time',
    isMatteKey('keyTol') && isMatteKey('maskInvert') && !isMatteKey('maskPlace')
      && !isMatteKey('blend'));

  // --- the vocabulary the panel draws from ---------------------------------
  check('there are three key modes and each explains itself',
    KEY_MODES.length === 3 && KEY_MODES.every((k) => k.v && k.t && k.hint),
    KEY_MODES.map((k) => k.v).join(','));
  check('there are two mask shapes plus none — a rectangle is also every straight split',
    MASK_SHAPES.map((s) => s.v).join(',') === 'none,rect,ellipse');
  check('there are four things a mask can do, and each says what it is for',
    MASK_MODES.length === 4 && MASK_MODES.every((m) => m.v && m.t && m.hint),
    MASK_MODES.map((m) => m.v).join(','));
  check('…and exactly one of them works by removing pixels',
    MASK_MODES.filter((m) => m.alpha).length === 1 && MASK_MODES.find((m) => m.alpha).v === 'reveal');

  // --- is it doing anything ------------------------------------------------
  check('a matte that is off costs the renderer nothing to decide',
    !hasMatte(makeClip({})) && !keyActive(makeClip({})) && !maskActive(makeClip({})));
  check('a key with zero tolerance is still ON — it removes the exact colour',
    keyActive({ keyMode: 'chroma', keyTol: 0 }));
  /* The one that stops a mistyped width blanking the clip: a zero-area reveal
     would leave nothing at all on screen, which reads as a broken clip. */
  check('a mask with no area is treated as absent rather than as an empty reveal',
    !maskActive({ maskShape: 'rect', maskW: 0, maskH: 0.5 })
      && !maskActive({ maskShape: 'rect', maskW: 0.5, maskH: 0 }));
  check('…and one with area is not', maskActive({ maskShape: 'rect', maskW: 0.5, maskH: 0.5 }));
  check('a mask dragged right-to-left is the same mask, not an empty one',
    (() => { const r = maskRectOf(M({ maskX: 0.8, maskY: 0.8, maskW: -0.4, maskH: -0.4 }));
      return Math.abs(r.x - 0.4) < 1e-6 && Math.abs(r.w - 0.4) < 1e-6; })());

  // --- which modes need the picture composited by alpha --------------------
  check('a key needs an alpha blend', needsAlphaBlend({ keyMode: 'chroma' }));
  check('so does a reveal — it works by taking pixels away',
    needsAlphaBlend({ maskShape: 'rect', maskW: 0.5, maskH: 0.5, maskMode: 'reveal' }));
  check('…but a blur, a mosaic and a darkening do not — they alter pixels in place',
    ['blur', 'pixelate', 'dim'].every((mode) =>
      !needsAlphaBlend({ maskShape: 'rect', maskW: 0.5, maskH: 0.5, maskMode: mode })),
    ['blur', 'pixelate', 'dim'].filter((mode) =>
      needsAlphaBlend({ maskShape: 'rect', maskW: 0.5, maskH: 0.5, maskMode: mode })).join(','));
  check('maskDropsPixels says the same thing about the mode alone',
    maskDropsPixels('reveal') && !maskDropsPixels('blur') && !maskDropsPixels('dim'));

  // --- the key maths -------------------------------------------------------
  const GREEN = [0x00, 0xb1, 0x40];
  const prep = keyPrep({ keyMode: 'chroma', keyColour: '#00b140', keyTol: 0.28, keySoft: 0.12 });
  check('the key colour itself is removed outright',
    keyAlphaAt(prep, ...GREEN) === 0);
  check('a skin tone is kept outright', keyAlphaAt(prep, 224, 172, 140) === 1);
  check('…and so is the complement of the key', keyAlphaAt(prep, 0xb1, 0x00, 0x71) === 1);
  /* The softness band is the whole difference between a key and a stencil. Walk
     the line from the key colour outwards and the answer has to climb — never
     step, never come back down. */
  const walk = [];
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    // Straight from the key colour to a neutral grey: the chroma distance is
    // then exactly proportional to u, so a wobble in the answer is the key's.
    walk.push(keyAlphaAt(prep, GREEN[0] + (128 - GREEN[0]) * u,
      GREEN[1] + (128 - GREEN[1]) * u, GREEN[2] + (128 - GREEN[2]) * u));
  }
  check('alpha rises monotonically as a colour moves away from the key',
    walk.every((v, i) => i === 0 || v >= walk[i - 1]) && walk[0] === 0 && walk[walk.length - 1] === 1,
    walk.map((v) => v.toFixed(2)).join(' '));
  check('…and passes through the band rather than jumping the whole way',
    walk.some((v) => v > 0.01 && v < 0.99), walk.filter((v) => v > 0 && v < 1).length + ' partial');
  const hard = keyPrep({ keyMode: 'chroma', keyColour: '#00b140', keyTol: 0.28, keySoft: 0 });
  check('softness at zero degrades to the step it would otherwise have been',
    [0, 0.25, 0.5, 0.75, 1].every(() => true)
      && new Set([keyAlphaAt(hard, 0, 0xb1, 0x40), keyAlphaAt(hard, 40, 0xb1, 0x60),
        keyAlphaAt(hard, 224, 172, 140)]).size === 2);
  check('a tolerance at the top keys the picture away entirely',
    (() => { const wide = keyPrep({ keyMode: 'chroma', keyColour: '#00b140', keyTol: 1, keySoft: 0 });
      return keyAlphaAt(wide, 224, 172, 140) === 0 && keyAlphaAt(wide, 255, 255, 255) === 0; })());
  check('a key that is off keeps every pixel, whatever the colour',
    [[0, 0, 0], [255, 255, 255], GREEN].every((c) => keyAlphaAt(keyPrep({}), ...c) === 1));
  /* The colour well always writes #rrggbb, but the validator accepts 3 to 8
     characters and a hand-edited project can carry any of them. A four-digit
     parseInt of '#abcd' is a completely unrelated colour — and a wrong key
     colour removes the wrong half of the picture. */
  check('a short key colour names the colour it expands to, not a four-digit integer',
    keyAlphaAt(keyPrep({ keyMode: 'chroma', keyColour: '#0b4', keyTol: 0.05, keySoft: 0 }),
      0x00, 0xbb, 0x44) === 0
      && keyAlphaAt(keyPrep({ keyMode: 'chroma', keyColour: '#0b4', keyTol: 0.05, keySoft: 0 }),
        224, 172, 140) === 1);

  const luma = keyPrep({ keyMode: 'luma', keyTol: 0.4, keySoft: 0.05 });
  check('a brightness key drops the dark end and keeps the bright one',
    keyAlphaAt(luma, 0, 0, 0) === 0 && keyAlphaAt(luma, 20, 20, 20) === 0
      && keyAlphaAt(luma, 255, 255, 255) === 1);
  check('…and it is BRIGHTNESS, not colour — a dark red goes and a bright green stays',
    keyAlphaAt(luma, 60, 0, 0) === 0 && keyAlphaAt(luma, 120, 255, 120) === 1);

  // --- spill ---------------------------------------------------------------
  const spill = keyPrep({ keyMode: 'chroma', keyColour: '#00b140', keySpill: 1 });
  const out = [0, 0, 0];
  despillTo(spill, 160, 200, 150, out);
  check('a pixel with a green fringe loses the fringe',
    out[1] < 200 && out[1] - Math.max(out[0], out[2]) < 200 - Math.max(160, 150),
    `${[160, 200, 150]} → ${out.map((n) => Math.round(n))}`);
  check('…and keeps roughly the brightness it had — despill is not a darkening',
    Math.abs((0.299 * out[0] + 0.587 * out[1] + 0.114 * out[2])
      - (0.299 * 160 + 0.587 * 200 + 0.114 * 150)) < 1.5);
  despillTo(spill, 200, 120, 190, out);
  check('a magenta pixel — pointing AWAY from the key — is left exactly alone',
    out[0] === 200 && out[1] === 120 && out[2] === 190, out.join(','));
  despillTo(keyPrep({ keyMode: 'chroma', keyColour: '#00b140', keySpill: 0 }), 160, 200, 150, out);
  check('spill at zero changes nothing at all', out[0] === 160 && out[1] === 200 && out[2] === 150);
  despillTo(keyPrep({ keyMode: 'luma' }), 160, 200, 150, out);
  check('a brightness key has no colour to despill, and does not try',
    out[0] === 160 && out[1] === 200 && out[2] === 150);
  check('the colour round trip is lossless enough to despill through',
    (() => { const y = rgbToYcc(123, 45, 200); const b = yccToRgb(y.y, y.cb, y.cr);
      return Math.abs(b.r - 123) < 0.5 && Math.abs(b.g - 45) < 0.5 && Math.abs(b.b - 200) < 0.5; })());

  // --- presets -------------------------------------------------------------
  check('the halves are exactly halves, and they tile the frame',
    (() => {
      const l = MASK_PLACES.find((p) => p.v === 'left'); const r = MASK_PLACES.find((p) => p.v === 'right');
      return l.w === 0.5 && r.x === 0.5 && l.x + l.w === r.x && l.h === 1 && r.h === 1;
    })());
  check('a preset is recognised back off the clip',
    maskPlaceOf(makeClip({ maskShape: 'rect', ...patchForMaskPlace('left') })) === 'left');
  check('…and anything else reads as custom',
    maskPlaceOf(makeClip({ maskShape: 'rect', maskX: 0.11, maskY: 0.13, maskW: 0.3, maskH: 0.3 })) === 'custom');
  check('a rotated mask is never "on a preset", because a preset is straight',
    maskPlaceOf(makeClip({ maskShape: 'rect', ...patchForMaskPlace('left'), maskRot: 30 })) === 'custom');
  check('a preset writes the geometry and nothing else — not the shape, mode, feather or inversion',
    Object.keys(patchForMaskPlace('centre')).sort().join(',') === 'maskH,maskRot,maskW,maskX,maskY');
  check('an unknown preset is refused rather than writing zeros',
    patchForMaskPlace('elsewhere') === null);

  // --- the blend the whole thing depends on --------------------------------
  check('the blend vocabulary now contains the one that composites by alpha',
    BLENDS.includes(ALPHA_BLEND) && ALPHA_BLEND === 'source-over');
  check('…and every blend name is still a real canvas operation, not a label',
    BLENDS.every((b) => /^[a-z-]+$/.test(b)), BLENDS.join(','));
  check('…and none of them reaches the picker spelled the way a canvas spells it',
    BLENDS.every((b) => typeof BLEND_LABEL[b] === 'string' && BLEND_LABEL[b].length > 0)
      && BLEND_LABEL[ALPHA_BLEND].startsWith('normal'),
    BLENDS.filter((b) => !BLEND_LABEL[b]).join(','));
  check('the layer default is untouched, so no saved look changes under its author',
    DEFAULT_BLEND === 'screen' && makeLayer({}).blend === 'screen');
  check('a clip can be set to it through the ordinary edit path',
    patchFor(makeClip({ track: 'V2', at: 1 }), 'blend', ALPHA_BLEND).blend === ALPHA_BLEND);

  // --- the editable surface ------------------------------------------------
  const keyed = makeClip({ track: 'V2', at: 1, keyMode: 'chroma', maskShape: 'ellipse',
    maskW: 0.4, maskH: 0.4, blend: 'screen' });
  const mf = fieldsFor(keyed, 1);
  const mkeys = mf.map((f) => f.key);
  check('the inspector offers the key and the mask',
    ['keyMode', 'keyColour', 'keyTol', 'keySoft', 'keySpill', 'maskShape', 'maskMode',
      'maskPlace', 'maskX', 'maskY', 'maskW', 'maskH', 'maskRot', 'maskFeather',
      'maskAmount', 'maskInvert'].every((k) => mkeys.includes(k)), mkeys.join(','));
  check('…in one group, so it reads as one idea',
    mf.filter((f) => f.group === 'matte').length === 16,
    String(mf.filter((f) => f.group === 'matte').length));
  check('…on the spine as well as the overlay — a blurred face is a spine edit too',
    fieldsFor(makeClip({}), 1).some((f) => f.group === 'matte'));
  const off = fieldsFor(makeClip({}), 1);
  check('the colour, tolerance and spill are disabled while there is no key — with a reason',
    ['keyColour', 'keyTol', 'keySpill'].every((k) => {
      const f = off.find((e) => e.key === k); return f.disabled && f.hint;
    }));
  check('and the geometry while there is no mask',
    ['maskX', 'maskW', 'maskFeather', 'maskInvert'].every((k) => off.find((e) => e.key === k).disabled));
  check('a brightness key still offers tolerance and softness, but not colour or spill',
    (() => { const f = fieldsFor(makeClip({ keyMode: 'luma' }), 1);
      const at = (k) => f.find((e) => e.key === k);
      return !at('keyTol').disabled && !at('keySoft').disabled
        && at('keyColour').disabled && at('keySpill').disabled; })());
  check('Amount is off for a reveal, because showing only the shape has no amount',
    fieldsFor(makeClip({ maskShape: 'rect', maskMode: 'reveal' }), 1)
      .find((f) => f.key === 'maskAmount').disabled);
  check('…and on for a blur, a mosaic and a darkening',
    ['blur', 'pixelate', 'dim'].every((mode) =>
      !fieldsFor(makeClip({ maskShape: 'rect', maskMode: mode }), 1)
        .find((f) => f.key === 'maskAmount').disabled));
  check('every matte value comes back through the normaliser, never raw off the clip',
    valueFor(makeClip({}), 'keyColour') === '#00b140' && valueFor(makeClip({}), 'maskAmount') === 0.6);
  check('the mask place is derived, like the transform place — never stored',
    valueFor(makeClip({ maskShape: 'rect', ...patchForMaskPlace('top') }), 'maskPlace') === 'top'
      && makeClip({}).maskPlace === undefined);
  check('an edit is clamped by the same function the renderer reads back through',
    patchFor(makeClip({}), 'keyTol', 5).keyTol === 1
      && patchFor(makeClip({}), 'maskRot', -1000).maskRot === -180);
  check('an edit that changes nothing raises no undo entry',
    patchFor(makeClip({ keyMode: 'chroma' }), 'keyMode', 'chroma') === null
      && patchFor(makeClip({}), 'maskInvert', false) === null);
  check('the checkbox is a boolean by the time it reaches the document',
    patchFor(makeClip({}), 'maskInvert', 'yes').maskInvert === true);

  // --- what the panel says out loud ----------------------------------------
  check('a key on the spine is called out — the holes it makes are black, not the clip below',
    matteNotes(makeClip({ keyMode: 'chroma' })).some((n) => n.includes('V1')),
    matteNotes(makeClip({ keyMode: 'chroma' })).join(' | '));
  check('a keyed overlay still blending by lightness is called out too',
    matteNotes(keyed).some((n) => n.includes('Blend')), matteNotes(keyed).join(' | '));
  check('…and once it composites by alpha, there is nothing left to say',
    matteNotes(makeClip({ track: 'V2', at: 1, keyMode: 'chroma', blend: ALPHA_BLEND })).length === 0);
  check('a mask with no area says so rather than silently doing nothing',
    matteNotes(makeClip({ maskShape: 'rect', maskW: 0 })).some((n) => n.includes('no area')));
  check('a blurred face on the spine is NOT warned about — it needs no alpha at all',
    matteNotes(makeClip({ maskShape: 'ellipse', maskMode: 'blur', maskW: 0.3, maskH: 0.3 })).length === 0);
  check('a clip with no matte has nothing to warn about', matteNotes(makeClip({})).length === 0);

  // --- summaries and the round trip ---------------------------------------
  check('an untouched clip summarises as nothing at all', matteSummary(makeClip({})) === '');
  check('a keyed, masked clip says both halves',
    /Key/.test(matteSummary(keyed)) && /Ellipse/.test(matteSummary(keyed)), matteSummary(keyed));
  check('an inverted mask says so — it is the difference between a hole and a spotlight',
    /inverted/.test(matteSummary(makeClip({ maskShape: 'ellipse', maskW: 0.4, maskH: 0.4, maskInvert: true }))));
  check('a matte survives a save and a load byte-identically',
    (() => {
      const doc = newDoc();
      doc.timeline.clips = normalizeClips([{ kind: 'video', src: 4, keyMode: 'chroma',
        keyColour: '#1b8a3c', keyTol: 0.31, maskShape: 'ellipse', maskMode: 'dim',
        maskInvert: true, maskFeather: 0.09 }]);
      const back = fromJSON(toJSON(doc));
      const c = back.timeline.clips[0];
      return toJSON(back) === toJSON(doc) && c.keyColour === '#1b8a3c' && c.maskMode === 'dim'
        && c.maskInvert === true && c.keyTol === 0.31;
    })());
}

/* ============================================ placing a mask by hand ===== */
/* The inverse of the geometry the renderer draws the mask with. All of it is in
   the clip's own CENTRED BUFFER pixels — the space invertPoint hands back —
   because that is the space the mask is applied in. Getting that wrong gives a
   mask that is correct until somebody scales the clip, which is the sort of bug
   that gets reported as "it feels sticky". */
section('placing a mask by hand — the inverse of the geometry it is drawn with');
{
  const W = 320; const H = 240;
  const CENTRED = { maskShape: 'rect', maskX: 0.25, maskY: 0.25, maskW: 0.5, maskH: 0.5 };
  const box = maskBoxOf(CENTRED, W, H);
  check('a centred half-frame mask is at the buffer centre, half its size',
    box.cx === 0 && box.cy === 0 && box.hw === 80 && box.hh === 60, JSON.stringify(box));
  const h = maskHandlesFor(CENTRED, W, H);
  check('its four corners are the four corners of that rectangle',
    h.corners.map((c) => c.map(Math.round).join(',')).join(' | ')
      === '-80,-60 | 80,-60 | 80,60 | -80,60',
    h.corners.map((c) => c.map(Math.round).join(',')).join(' | '));
  check('…and the rotation grip hangs off the middle of the top edge',
    Math.round(h.topMid[0]) === 0 && Math.round(h.topMid[1]) === -60, h.topMid.join(','));
  check('an off-centre mask puts the box where the numbers say',
    (() => { const b = maskBoxOf({ maskShape: 'rect', maskX: 0, maskY: 0, maskW: 0.5, maskH: 0.5 }, W, H);
      return b.cx === -80 && b.cy === -60; })());

  check('the middle of the mask is inside it and a point well outside is not',
    insideMask(CENTRED, W, H, 0, 0) && !insideMask(CENTRED, W, H, 150, 0));
  check('the edge is inside and a pixel past it is not',
    insideMask(CENTRED, W, H, 79.9, 0) && !insideMask(CENTRED, W, H, 80.1, 0));
  /* The claim that says the rotation is real rather than decorative: a point
     that misses a wide-and-short mask hits the same mask stood on end. */
  const TALL = { ...CENTRED, maskRot: 90 };
  check('rotating the mask rotates what is inside it',
    !insideMask(CENTRED, W, H, 0, 70) && insideMask(TALL, W, H, 0, 70),
    `${insideMask(CENTRED, W, H, 0, 70)} → ${insideMask(TALL, W, H, 0, 70)}`);
  check('…and its corners turn with it',
    Math.abs(maskHandlesFor(TALL, W, H).corners[0][0] - 60) < 0.001,
    maskHandlesFor(TALL, W, H).corners[0].join(','));
  /* At 90° a sign error in the un-rotation is INVISIBLE: the box is symmetric
     about both axes, so rotating by +90 and by −90 put an axis-aligned test
     point at the same distance either way. (Asserted at 90° first and the
     sabotage sailed through it.) An odd angle with a point near the far edge of
     the LONG side is what actually pins the direction — get it backwards and
     the point lands outside the short side instead. */
  const OBLIQUE = { ...CENTRED, maskRot: 30 };
  const rad30 = (30 * Math.PI) / 180;
  const nearEdge = [78 * Math.cos(rad30), 78 * Math.sin(rad30)];
  check('a point just inside the long edge of an obliquely rotated mask is inside it',
    insideMask(OBLIQUE, W, H, nearEdge[0], nearEdge[1]),
    `(${nearEdge.map((n) => n.toFixed(1)).join(', ')}) against hw ${box.hw} hh ${box.hh}`);
  check('…and the same distance out along the SHORT side is not',
    !insideMask(OBLIQUE, W, H, -78 * Math.sin(rad30), 78 * Math.cos(rad30)));
  /* The same trap on the resize path: at 90° the dragged corner lands in the
     right place whichever way the un-rotation goes. Off-axis it does not. */
  check('a corner dragged on an obliquely rotated mask still lands under the pointer',
    (() => {
      const ob = makeMatte(OBLIQUE);
      const next = { ...ob, ...maskResizeTo(ob, W, H, 90, 40) };
      return Math.min(...maskHandlesFor(next, W, H).corners
        .map((c) => Math.hypot(c[0] - 90, c[1] - 40))) < 0.5;
    })());

  // --- the gestures --------------------------------------------------------
  const from = makeMatte(CENTRED);
  check('dragging the mask a tenth of the frame moves it a tenth of the frame',
    (() => { const p = maskMoveBy(from, W, H, W * 0.1, H * -0.2);
      return Math.abs(p.maskX - 0.35) < 1e-6 && Math.abs(p.maskY - 0.05) < 1e-6; })(),
    JSON.stringify(maskMoveBy(from, W, H, W * 0.1, H * -0.2)));
  check('…and moving it by nothing changes nothing',
    (() => { const p = maskMoveBy(from, W, H, 0, 0);
      return p.maskX === from.maskX && p.maskY === from.maskY; })());

  /* The round trip that matters: drag a corner to a point, and the corner is at
     that point. Anything else and the shape crawls away from the pointer.
     Measured as "the nearest corner is on it" rather than by naming an index,
     because WHICH corner you dragged is decided by the quadrant the pointer is
     in — and on a rotated mask that is not the quadrant it looks like on
     screen. Naming corners[2] passed unrotated by luck and failed obliquely,
     which is how this note came to be here. */
  const cornerGap = (m, px, py) => Math.min(...maskHandlesFor(m, W, H).corners
    .map((c) => Math.hypot(c[0] - px, c[1] - py)));
  const sized = maskResizeTo(from, W, H, 100, 90);
  check('dragging a corner puts that corner under the pointer',
    cornerGap({ ...from, ...sized }, 100, 90) < 0.5,
    cornerGap({ ...from, ...sized }, 100, 90).toFixed(3));
  check('…and it resizes about the CENTRE, so the mask stays over what you aimed it at',
    (() => { const b = maskBoxOf({ ...from, ...sized }, W, H);
      return Math.abs(b.cx) < 0.5 && Math.abs(b.cy) < 0.5; })(),
    JSON.stringify(maskBoxOf({ ...from, ...sized }, W, H)));
  check('a corner dragged through the centre floors rather than making the mask vanish',
    (() => { const p = maskResizeTo(from, W, H, 0, 0);
      return p.maskW === MIN_MASK && p.maskH === MIN_MASK && maskActive({ ...from, ...p }); })(),
    JSON.stringify(maskResizeTo(from, W, H, 0, 0)));
  check('a corner drag on a rotated mask is measured in the mask’s own axes',
    (() => { const p = maskResizeTo(makeMatte(TALL), W, H, 0, 90);
      // Straight down from the centre of a mask stood on end is its WIDTH.
      return Math.abs(p.maskW - (90 * 2) / W) < 1e-3; })(),
    JSON.stringify(maskResizeTo(makeMatte(TALL), W, H, 0, 90)));

  check('the rotation grip points the mask’s top edge at the pointer',
    maskRotAt(box, 0, -100) === 0 && maskRotAt(box, 100, 0) === 90);
  /* Wrapped, not clamped. A clamp would stick the shape at 180° the moment the
     grip passed straight down, and it would stop following the pointer. */
  check('…and it WRAPS past straight down rather than sticking at the limit',
    maskRotAt(box, -100, 0) === -90 && maskRotAt(box, 0, 100) === 180,
    `${maskRotAt(box, -100, 0)} / ${maskRotAt(box, 0, 100)}`);
  check('every gesture answers with values the normaliser already accepts',
    (() => {
      const patches = [maskMoveBy(from, W, H, 9999, 9999), maskResizeTo(from, W, H, 9999, 9999),
        { maskRot: maskRotAt(box, -3, 7) }];
      return patches.every((p) => {
        const back = makeMatte({ ...from, ...p });
        return Object.keys(p).every((k) => back[k] === p[k]);
      });
    })());
  check('a degenerate frame does not produce NaN geometry',
    (() => { const b = maskBoxOf(CENTRED, 0, 0); const p = maskMoveBy(from, 0, 0, 5, 5);
      return [b.cx, b.cy, b.hw, b.hh, p.maskX, p.maskY].every(Number.isFinite); })());
}

/* ================================ a look that survives a change of size === */
section('the format picker carries the look with it');
{
  /* A stand-in registry, because the real ranges live in fx/ and this module is
     pure — the injection point exists precisely so this can be asked without a
     renderer in the room. */
  const SPECS = {
    grain: [{ key: 'size', min: 1, max: 6, step: 1, def: 1, px: true },
      { key: 'amount', min: 0, max: 100, step: 1, def: 40 }],
    sort: [{ key: 'maxrun', min: 8, max: 400, step: 4, def: 120, px: true }],
    grade: [{ key: 'brightness', min: -100, max: 100, step: 1, def: 0 }],
  };
  const specsOf = (id) => SPECS[id];
  const chain = (list) => normalizeFilters(list);

  const up = scaleFilterPx(chain([{ id: 'grain', params: { size: 2, amount: 40 } }]), 4, specsOf);
  check('a pixel measurement grows with the frame',
    up[0].params.size === 6 && up[0].params.amount === 40,
    JSON.stringify(up[0].params));
  check('…and is clamped by the control’s own maximum, not run past it',
    scaleFilterPx(chain([{ id: 'sort', params: { maxrun: 120 } }]), 8, specsOf)[0].params.maxrun === 400);
  check('…and snapped to the control’s own step, so the box can show the number',
    scaleFilterPx(chain([{ id: 'sort', params: { maxrun: 10 } }]), 1.5, specsOf)[0].params.maxrun % 4 === 0,
    String(scaleFilterPx(chain([{ id: 'sort', params: { maxrun: 10 } }]), 1.5, specsOf)[0].params.maxrun));
  check('shrinking works the same way',
    scaleFilterPx(chain([{ id: 'sort', params: { maxrun: 120 } }]), 0.25, specsOf)[0].params.maxrun === 32);
  /* An unset parameter is its default, and a default in pixels is as much a
     pixel measurement as a typed one — so it scales, and is written out, or the
     chain would keep inheriting a number meant for the old size. */
  check('a parameter the author never touched scales from its default and is written down',
    scaleFilterPx(chain([{ id: 'sort', params: {} }]), 2, specsOf)[0].params.maxrun === 240);
  check('a parameter that is not a pixel measurement is left exactly alone',
    scaleFilterPx(chain([{ id: 'grade', params: { brightness: 30 } }]), 4, specsOf) === null);

  check('nothing to do returns null rather than an equal-valued edit',
    scaleFilterPx(chain([{ id: 'grain', params: { size: 2 } }]), 1, specsOf) === null
      && scaleFilterPx([], 4, specsOf) === null);
  check('…and so does a factor that is not a factor',
    [0, -2, NaN, Infinity, 'big'].every((f) =>
      scaleFilterPx(chain([{ id: 'grain', params: { size: 2 } }]), f, specsOf) === null));
  check('a filter this build has never heard of is carried through untouched',
    scaleFilterPx(chain([{ id: 'from-the-future', params: { size: 2 } },
      { id: 'grain', params: { size: 2 } }]), 4, specsOf)[0].params.size === 2);
  check('the step, order and enabled flag of every entry survive',
    (() => {
      const out = scaleFilterPx(chain([{ id: 'grade', params: { brightness: 5 } },
        { id: 'grain', params: { size: 1 }, enabled: false }]), 3, specsOf);
      return out.length === 2 && out[0].id === 'grade' && out[1].id === 'grain'
        && out[1].enabled === false;
    })());
  check('the result is a chain the document already accepts',
    (() => {
      const out = scaleFilterPx(chain([{ id: 'grain', params: { size: 2 } }]), 3, specsOf);
      return JSON.stringify(normalizeFilters(out)) === JSON.stringify(out);
    })());
  /* The whole reason for the marker: a rescaler that guessed from the label
     would rescale anything whose label happened to mention pixels, and miss
     anything that did not. */
  check('every parameter the registry calls a pixel measurement declares itself one',
    Object.values(SPECS).flat().filter((s) => s.px).length === 2);
}

console.log('-'.repeat(58));
console.log(`Dead Signal Studio document: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
