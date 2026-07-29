# Campaign fixtures

The BUNDLE tab merges the studio's generated wiring into a campaign that
**already has media**. Getting that merge wrong loses an author's existing
files, so `test-studio-audit.mjs` exercises it against real campaign files
rather than a two-entry toy.

The studio grew up inside the EREBUS campaign repository and those suites used
to read that repository's live files through `../../assets/…`. The studio is now
a standalone folder — "copy it anywhere and it works" is the whole premise — so
reaching two directories up was both a broken path and a violated promise: the
suite crashed partway through, taking 500+ later checks with it.

These files are a **captured copy** of the campaign's file *formats*, at the
size and shape the merge has to survive:

| File | What it is |
|---|---|
| `media-manifest.json` | the campaign's manifest — `{ music: [...], videos: [...] }`, entries keyed by `src` |
| `videos/index.json` | the videos index — a bare array, entries keyed by `filename` |
| `music/index.json` | the music index, same shape |
| `autoexec.retro` | RetroScript with `call releaseMedia` lines, including commented-out ones |

They are fixtures, not the campaign's live files, and they are pinned here on
purpose: a merge test whose input can change under it is a test that fails for
reasons that have nothing to do with the merge.

What they deliberately contain, because each one caught something:

- **entries in both files for the same clip** — the manifest and the index are
  separate lists that must both survive;
- **a `gated: true` entry**, since gating travels with an entry through a merge;
- **a duplicate filename inside the campaign's own videos index** — real files
  accumulate these, and `mergeEntries` has to collapse rather than double it
  (it sits in the index rather than the manifest so the "every shipped asset
  survives" count stays an honest one-to-one);
- **`releaseMedia` lines that are commented out** with both `#` and `//`, plus
  one containing a `#` inside its quoted filename — a commented release is *not*
  a release, and counting one would make the studio skip the very line the
  author still needs;
- **single and double quoted** release lines, and two on one line.
