# Dead Signal Studio

> 📐 **Where this came from:** the tool grew inside the EREBUS campaign
> repository, driven by a specification set that turned it into a multi-user
> content creation studio (timeline editing, a project document with undo,
> aesthetic packs, cPanel multi-user hosting). That program is largely
> implemented and those specs stayed behind with the campaign. This README
> describes the tool **as it ships today**, and this repository is the whole of
> it — nothing here reads a file outside this folder.

An **offline** retro-media asset forge spanning **analogue horror · cyberpunk ·
vaporwave** — generate CRT/terminal **video**, synth **audio**, and Win95/CRT
**screen** stills, then (for the EREBUS campaign) export a **drop-in bundle**. No
build step, no dependencies — and no network unless you sign in on the optional
**CLOUD** tab (see below); everything else renders locally and downloads to your
machine.

**This folder is the whole tool.** Copy it anywhere — its own domain, a
subdirectory of an unrelated site, a USB stick — and it works. The optional
multi-user backend ships inside it too (`server/` + `api/`), so nothing here
requires the application it grew up in.

## Running it

```bash
python -m http.server 8000      # from the repo root, or any static server
# then open http://localhost:8000/
```

That is the whole tool, minus accounts and sync. To run the optional backend
locally as well, use PHP's built-in server with the shipped router (it supplies
the rewrite that `api/.htaccess` gives Apache):

```bash
php -S localhost:8000 router.php    # from the repo root
```

> ⚠️ **It must be served — opening `index.html` from the filesystem no longer
> works.** The engine is ES modules, and browsers refuse to load module
> `import`s over `file://` (CORS, origin `null`). Any static server will do;
> nothing is fetched from the network at runtime (the optional CLOUD tab being
> the deliberate, sign-in-gated exception).

### Layout

```
index.html        markup + stylesheet links only
setup.php         the installer (host check → database → schema → settings → account)
preflight.php     "what can this host do?", before committing to an install
router.php        rewrite shim for `php -S` (development only)
api/              the backend's front controller + its .htaccess
server/           the backend itself — classes, schema, config, storage
  migrations/     six tables: studio_projects/assets/versions/shares + users/sessions
  models/         User Session StudioProject StudioAsset StudioVersion StudioShare
  controllers/    Auth System Studio
  migrate.php     `php server/migrate.php` — schema from the command line
  account.php     `php server/account.php add <name> <password>`
styles/           tokens · layout · controls · panels
src/              the engine, 94 ES modules
  core/           dom blobs rng text palettes packs recipes formats
  doc/            the project document: schema store session undo migrations
                  timeline automation regions annotations
  fx/             crt still filters filters-extra
  media/          import audioimport
  video/          scenes render capture gif timeline layers automation
  audio/          engine layers fx bed solo wav ui
  image/          chrome95 templates render stego annotate
  library/        library bundle merge zip
  export/         encoder webm mp4 anim batch (offline WebCodecs + muxers)
  platform/       storage (IndexedDB) · api (the CLOUD backend client)
  campaign/       campaign targets + existing-file import
  onboarding/     the welcome card's sample project
  presets/  ui/   preset packs, shell behaviour
  boot.js         entry point + the window.DeadSignalStudio seam
```

> Originally built for the EREBUS campaign in this repo; now a standalone tool.
> The **BUNDLE** tab and the EREBUS preset pack keep the campaign workflow intact.

## Aesthetics, and the packs behind them

The **aesthetic** switch (top bar) reskins the whole tool and swaps in a matching
palette: **Analogue Horror** (green phosphor), **Cyberpunk** (neon
magenta/cyan), **Vaporwave** (pink/teal), and **EREBUS** (the campaign flavor).
Presets are grouped by aesthetic in every tab's dropdown, so you can mix freely.

Each aesthetic is also a **pack** — it names the scenes and screens that belong
to that world, which does two things:

- **The scene and template pickers group by it.** The pack's picks come first
  under the aesthetic's name, everything else follows underneath. Grouped,
  **never filtered**: a horror screen in a cyberpunk project is a legitimate
  choice, and all 48 scenes and 46 screens are still in the list. Grouping them
  is a better list than not grouping them regardless of which world you are in.
- **◆ PACK** (beside the switch) puts the whole tool in that world in one
  gesture: the palette *and* a matching starting preset on VIDEO, AUDIO and
  SCREEN — as a single undo. It takes each group's first preset rather than a
  random one, because a starting point that is different every time is not one.
  Locked sections are respected, exactly as when you pick a preset by hand.

## Generators

| Tab | Output | What it makes |
|---|---|---|
| **VIDEO** | `.webm` / `.mp4` | **48 scenes** (see below) — under a shared CRT/VHS stack (scanlines, static, vignette, flicker, chromatic aberration, bloom, phosphor **persistence**, shadow-mask, hum bar, tracking tear, camera shake, **vertical-hold roll**, ordered dither). Text modes: static / typewriter / **decode-in** / scroll, plus a **ｆｕｌｌｗｉｄｔｈ** vaporwave toggle, **Glitch** (coloured ghosting on the type) and **Corrupt**. HUD, timecode, Morse strip, **blink code**, **final-frame reveal**, **subliminal** injection. |
| **AUDIO** | `.wav` (8/16/24-bit) | **26 layers** (see below) — into a **master FX bus** (ring-mod, tremolo, wow/flutter, distortion, delay, convolution **reverb**, telephone band, bitcrush, limiter, stereo width) and then an ordered **FX chain** (see below). Live **layer summary** (see what's on at a glance) + one-click **TIDY** (fold unused layers). Peak meter, **normalize**, and **auto-level on render**; single-instance **Play/Stop** (no stacked playback); loop crossfade. Preset packs for darksynth/ICE/mallsoft as well as analogue-horror. |
| **SCREEN** | `.png` / `.jpg` | **46 templates** (see below) on a Win95 chrome engine — Terminal, BSOD (9x + NT STOP), Camera still, Keycard, Error dialog, File Explorer, Boot/Shutdown, Fake desktop, Redacted doc, Missing poster, Task Manager, Hex editor, CRT test pattern, Registry editor, Cyberpunk Terminal, Corp Login, Cyber Implant ID, Vapor Desktop, Mall Directory, Cassette J-card, HTTP 404, BIOS Setup, Chat Window, ATM / Kiosk, VHS Label, Patient Monitor, Receipt, Search Results — with a CRT + paper-aging post stack, **stego** (LSB) embed/decode, invert-to-reveal text, and 1–4× supersampled export. |
| **TIMELINE** | `.webm` / `.mp4` | Cut several scenes into **one clip**. Build a look on VIDEO and press **＋ SCENE**, or a screen on SCREEN and press **＋ STILL**; then edit on the **track** — drag a block to reorder, drag its edge to **trim**, click to select (arrows trim, Alt+arrows reorder). Each clip carries its **own transition** — cut / crossfade / dip-to-black — plus its own scene, text and FX; only W/H/FPS are unified. The table under the track is the same edit for when you would rather type `4.25` than drag at it. A **sound bed** covers the sequence, and each clip can carry its own over the top. `Video In` clips play your imported footage live. |

Every tab ships preset packs (grouped by aesthetic) that fill all controls; save
your own presets to the browser (**✚ PRESET** → localStorage). **SAVE PROJ**
downloads the whole session's recipes as JSON.

## Bring your own art + footage + more export formats

- **Import an image** (⇪ IMG button, or drag-drop onto either preview): retro-ify
  a logo / screenshot / photo through the full still-FX stack as a **`.png`**, or
  as a **Ken Burns** pan/zoom **video** clip.
- **Import a video clip** (⇪ VID on the VIDEO tab, or drop a video on the preview):
  the **Video In** scene runs your own footage through the entire CRT/VHS stack —
  scanlines, glitch, chroma, bloom, tracking tear, reveal/subliminal overlays —
  and re-exports it as **`.webm`**, an animated **`.gif`**, or a frame-strip
  (GIF/strip seek the clip frame-accurately). Any browser-playable source works
  (`.webm`/`.mp4`).
- **Image FX** (great on imported art): **duotone / gradient-map**, **halftone**
  dot-screen, **posterize**, and **pixel-sort** glitch.
- **Multi-scene TIMELINE**: cut any number of scenes — and SCREEN stills — into
  one clip, each trimmed to the part you want and entering on its own transition
  (see the table above).
- **Video export beyond WebM**: **`.mp4`** (H.264/AAC, see below), three
  animated stills — **`.gif`**, **`.apng`**, **`.webp`** (see below) — and a
  **frame-strip / sprite-sheet `.png`**.
- **Utility scenes**: **Film Countdown** leader, **Credits Crawl**, and an
  **Audio-reactive** scope that traces the waveform of a clip you rendered in the
  Audio tab.

## Picking a preset by looking at it

The preset picker is a `<select>` of forty-odd names. "Signal Loss", "ICE
Drone", "Evidence Tag" — each one is a guess until you load it, and loading it
overwrites the tab. The library was effectively unbrowsable: you found your
preset by trying presets.

**⊞** beside each picker opens a **gallery**. On VIDEO and SCREEN every preset
is a real render of the frame it produces, at your current seed — click a card
to load it. It is not an illustration and not a screenshot anybody has to
remember to update; it is the same render path the export uses, so what you see
is what you get. (Literally: a test loads a preset for real and compares the
result to its card pixel for pixel.)

The card renders what **clicking** it produces — the tab's defaults with the
preset over the top — not the stored fragment. Presets name only the dozen
controls their look depends on, so rendering the fragment alone would draw a
picture of the fragment rather than of the preset.

**AUDIO is deliberately not a picture.** Forty presets through
`OfflineAudioContext` would take seconds, and at thumbnail size every dense
waveform looks like the same grey brick. What you actually want to know is what
is *in* it, so the audio card lists the layers and effects the preset switches
on — read off the recipe, so it cannot drift from what the preset does.

The gallery starts closed and renders a few cards per frame, so opening it never
blocks the interface. Roll a new seed and the thumbnails redraw rather than
showing a look you can no longer get.

## What RESET, LOAD and BATCH actually cover

Three promises worth stating exactly, because each of them used to be slightly
untrue in a way you would only notice by the render coming out wrong:

- **LOAD backfills.** A project is a snapshot of every control, so a key it
  lacks can only mean this build has a control the saving build didn't — which
  is the ordinary case, since every release that adds a control makes every
  project on disk older than it. Those controls are reset to the values the
  markup declares. Without that they kept whatever the *previous* project left
  them at, and the look you got from a file depended on what was on screen
  before you opened it.
- **RESET means the whole tab.** Not just the sliders: the filter chain, the
  layers, the keyframes, the audio FX chain, the region edits, the solo set and
  the screen marks go with them. It is one undo entry, so a misclick costs
  nothing.
- **BATCH renders from recipes, never the controls** — for *both* document-held
  chains. A screen batch no more picks up your marks than a video batch picks up
  your filter chain, and your own settings are untouched when it finishes.

## Determinism & workflow

- **Seed** (top bar) drives *all* randomness — same seed + params reproduces the
  same look (PNG/WAV are byte-stable; WebM frame-patterns reproduce, bytes may
  vary by codec). `⟳` rolls a new seed.
- **Randomize** (`G`) perturbs the FX sliders around their current values within
  a fieldset.
- **Locks** pin a section against *both* Randomize and loading a preset. Tick
  **lock** on TEXT and every preset in the list becomes a look you can try
  without losing the wording a puzzle depends on; lock OUTPUT to keep the
  delivery size you settled on. A lock travels in the project.
- **Presets** apply the tab's defaults and then the preset, so the same preset
  always lands on the same look regardless of what you clicked before — minus
  anything you locked. The **⚙** beside each picker renames, duplicates,
  deletes, exports and imports your own saved presets; export writes every
  tab's presets to one file and import merges rather than overwriting.
- **Live preview** updates on any control change; the video preview has a
  **scrubber** + play/pause to place reveal/subliminal frames exactly.
- **Tidy panels**: every settings section is collapsible — click a section
  **title** to fold it away, or **↺** (per section) / **⟲ RESET** (whole tab) to
  restore boot defaults. On the AUDIO tab, active layers are flagged (● in the
  title + a live summary) and **⊟ TIDY** folds away every layer that's turned off.
- Keyboard: `1‑8` tabs · `R` record/render · `G` randomize · `Ctrl+S` save
  project · `Ctrl+Z` / `Ctrl+Shift+Z` (or `Ctrl+Y`) undo/redo · `Ctrl+K`
  command palette.

## Sound on a clip

AUDIO and VIDEO used to be two separate exports: a `.wav` and a silent `.webm`
the campaign played separately. Workable for dressing inside a fake desktop,
impossible for a Short — nobody uploads a silent vertical video and a WAV.

The **Sound** picker on VIDEO muxes an audio track into the exported clip:

- **— silent —** — exactly what the tool did before.
- **Last audio render** — whatever the AUDIO tab produced most recently.
- **Any `.wav` in the library**, addressed by its asset key so the choice
  survives a reload.

A bed shorter than the clip **loops** to fill it (the AUDIO tab's *Loop xf*
crossfade is what makes the seam disappear); a longer one is **trimmed**. The
console says which happened, and the status line says whether sound made it into
the file at all.

The offline path encodes **Opus** with WebCodecs' `AudioEncoder` and writes a
second `TrackEntry`; blocks from both tracks are sorted into timecode order and
no cluster is ever opened by an audio packet, so the result seeks properly. The
real-time `MediaRecorder` fallback plays the bed into a
`MediaStreamDestination` and adds its track to the canvas stream, so it produces
the same clip on browsers without WebCodecs.

The bed is part of the recipe, so it is captured into a timeline clip and
restored with the project.

**On TIMELINE there are two, and they compose.** The picker above the table
covers the whole sequence; the **sound** column gives each clip its own, laid
*over* the sequence bed at the time that clip starts. A room tone running the
whole way through with a phone ringing over clip three is the ordinary case, and
it needs no special mode to express. Each clip's bed is prepared at that clip's
length — so it loops or trims to fit the clip, not the sequence — and moves with
the picture when you trim or reorder, because the start times come from the same
schedule the render does.

## The 26 sound layers

| | |
|---|---|
| **Tone** | Drone (voices / detune / spread) · Sub-bass · **Mains Hum** (50/60 Hz with its odd harmonics — the note the *building* chose, not one you picked) · **Bell** (inharmonic partials, single strike or tolling) |
| **Texture** | Noise · **Vinyl Crackle** · **Room Tone** · **Rain** · **Wind** |
| **Machines** | Pulse train · Geiger · **Clock Tick** · **Water Drip** · **Siren** · **Radio Tuning** |
| **Signals** | Morse · DTMF · Dial-up · **Fax / Handshake** · **Answering Machine** |
| **Tape** | **Tape Stop** · **Tape Rewind** |
| **Human** | **Heartbeat** (BPM-controlled double thump) · **Breathing** · **Reversed Whisper** |
| **Yours** | Imported sample (looped or one-shot) |

Every layer has its own **pan**, so the mix is an arrangement rather than one
point source, and all of them run through the same master FX bus.

The sixteen new ones come from a **registry** (`src/audio/layers.js`): a layer is
one entry saying what it is called, what it can be adjusted by, and how it builds
its nodes — the controls, the config, the render pass and the documentation are
all derived from it. The ten originals stay hand-wired on purpose: saved
projects, presets and campaign recipes name their exact control ids, and moving
them would be a schema change for no gain.

A layer that places a sound at a time you chose — the answering-machine beep, the
tape stop, the fax handshake — **extends the render** to fit, the same courtesy
dial-up and Morse already got. A layer that fails is skipped with a note in the
console rather than killing the render.

## The 48 scenes

| | |
|---|---|
| **Text & signal** | Terminal / Text · Signal Loss / Snow · SMPTE Color Bars · BIOS / Boot POST · Loading / Progress · Digital Rain · Waveform Scope · Hex-dump · Spectrum · Data Stream |
| **Surveillance & instruments** | Surveillance Cam · **CCTV Multiplex** · EKG / Flatline · Radar · **Sonar** · **Satellite Tracking** · **Dashcam Overlay** · **Vitals Monitor** · Cyberpunk HUD |
| **Device screens** | **VHS On-Screen Display** · **Teletext Page** · **Split-Flap Board** · **Keypad / Access** · **Elevator Indicator** · **IRC / Chat Log** · **Kernel Panic** · **Emergency Alert** |
| **Broadcast** | **Station Sign-Off** · Film Countdown · Credits Crawl |
| **Aesthetic** | Neon Grid (retrowave) · Neon City Rain · Hologram Panels · System Breach · Vapor Statue · Rain on Glass · Fire · Plasma |
| **Screensavers & demo** | **Bouncing Logo** · **Pipes** · **Mystify** · Starfield / Warp · Vector Tunnel · Cellular Automaton · Lissajous · **Sine Scroller** |
| **Your own media** | Video In (filter an imported clip) · Ken Burns (pan/zoom a still) |

A scene is the one thing an author cannot work around — if the look is not in
the list, it is not makeable. Every one of them is animated, draws something at
*every* time you can scrub to (including t=0), takes the text and background
colour you set, and renders the same frame whether you scrubbed to it, played
to it or exported it.

The abstract screensavers — Pipes, Mystify, Plasma, Tunnel, Cellular Automaton,
Starfield, Fire — have nothing to caption and ignore the text box, which is the
existing convention rather than an oversight.

## Three animated stills

`.gif`, `.apng` and `.webp` sit together on the VIDEO tab and share one frame
rate. They are genuinely different trades, not three names for one thing:

| | |
|---|---|
| **GIF** | 256 colours, one bit of transparency, dithered. It survives because it plays *absolutely* everywhere. |
| **APNG** | Lossless, 24-bit, real alpha. Every current browser, iMessage, Discord. Large — the archival one. |
| **WebP** | 24-bit with real alpha at a fraction of the size of either. Every current browser. **The one to upload.** |

Measured on the same ten frames at 120×90: WebP 1.9 KB, APNG 3.0 KB, GIF 4.2 KB.

Neither new format needed a new encoder, which is what made them worth doing.
**APNG** is PNG chunks around zlib streams that `CompressionStream('deflate')`
produces natively — note *deflate*, not `deflate-raw`; PNG wants a zlib stream
and the bare deflate blocks would be rejected by every decoder. **Animated WebP**
is a container around the VP8 payloads `canvas.toBlob('image/webp')` already
makes: each still is a whole RIFF file, and what an animation frame wants is
only the image chunks from inside it.

All three are capped at 640px for the same reason: these are for a message, a
README or a social post, and a lossless 1080×1920 animation is a download nobody
wants.

## The waveform is an editor

It used to be a readout. You could see that the third second was too loud or
that the tail ran on, and the only thing you could do about it was change a
synthesis parameter and render again — which changes the whole clip, not the
part you were looking at.

**Drag a range on the wave, then apply an edit to it:**

| | |
|---|---|
| **Silence** | Zero the selection. |
| **Fade in / out** | Ramp across it. |
| **Gain** | Scale it — 100% unchanged, 0 silent, 200 doubled. |
| **Reverse** | Play it backwards. |
| **Crop to** | Throw everything outside it away. Changes the length. |

**Edits are part of the project, not a destructive button.** They live in the
document, so they undo, they save, and **every render replays them** — the same
project always produces the same wave. Clear the list and the next render is
exactly what the synth produced.

Edits apply **in order**, and each one's times refer to the buffer as it is at
that moment. That only matters for **Crop**, which is the one op that changes
the length: crop first and everything after it is addressed in the cropped
timeline. That's the behaviour you actually see, because the wave you're
dragging on *is* the edited one.

## Solo

Twenty-six sources stack into one mix. When something in it is wrong, finding
which layer is making the noise used to mean unchecking layers one at a time and
then trying to remember what they had been.

Every layer has an **S** button beside its enable box. Press it and you hear only
that — press a few and you hear only those. Nothing about the arrangement
changes: the enable checkboxes keep exactly what you set them to, and clearing
solo brings the whole mix back untouched. Solo undoes and redoes like everything
else, and a soloed layer that is *disabled* stays silent — solo picks from what
is playing, it doesn't switch things on.

Solo is applied before anything else reads the settings, so a soloed drone won't
stretch the render to six seconds just because a dial-up sequence is ticked but
inaudible.

> **It applies to export.** In a DAW, solo affects monitoring and never the
> bounce. Here the render *is* the export, so a solo left on will ship. Rather
> than pretend otherwise, the studio is loud about it: an amber banner sits at
> the top of the settings panel and every soloed render prints a warning naming
> exactly what was audible.

## Batch export

The tool exports one thing at a time, which is right when you are shaping a look
and wrong when you are dressing a campaign. **BATCH EXPORT**, on the LIBRARY tab,
does a whole set in one go:

| Source | What you get |
|---|---|
| Every VIDEO preset | one short clip each — a contact sheet of every look |
| Every SCREEN preset | one `.png` each |
| Every TIMELINE clip | each clip on its own, **trimmed exactly as you cut it** |

Each source shows its count *before* you commit, and a source with nothing in it
is disabled rather than quietly doing nothing.

**Each timeline clip carries its slice of the whole sequence mix** — the sequence
bed under it, whatever on the audio lane overlaps it, and its footage's own
sound. It used to carry the clip's own bed and nothing else, and the panel note
said so instead of fixing it, which meant a clip exported on its own was missing
most of what it sounds like in the sequence and you found out after uploading it.
The mix is built once for the whole batch and sliced per clip, because a mixdown
is a decode plus an offline render per part and doing that per clip would
multiply it by the length of the batch to arrive at the same samples.

**Your own settings are never touched.** A batch renders from *recipes*, not from
the controls — `presetRecipe()` composes a full recipe out of the tab defaults
plus the preset, and `readVideoCfg(rec)` builds a config from one without reading
the DOM at all. Exporting forty-five presets leaves your settings, your undo
history and your document exactly as they were.

Video items are capped to a few seconds each by default, because a batch is a
contact sheet: you are looking for which of these is the one, and three seconds
each answers that far quicker than forty-five full-length renders. Set **Sec
each** to 0 to export every item at its own full length.

**STOP** stops after the item in progress and keeps everything already exported.
One item failing costs one item — the console names it and the rest continue.

## MP4, and why it took a muxer

WebM plays in any browser and nowhere else reliably: dropped into a video
editor, a phone's camera roll, a social upload or QuickTime it is a coin toss.
That is the entire reason `scripts/gen-campaign-media.py` existed as an ffmpeg
shim.

The **File** picker on VIDEO and TIMELINE now offers **MP4 (H.264)** beside
WebM. WebCodecs already encoded H.264 and AAC; the missing piece was somewhere
to put them, so `src/export/mp4.js` is a hand-written ISO BMFF muxer —
`ftyp` + `moov` + `mdat`, one `trak` per stream, real sample tables.

Two things about it are worth knowing:

- **The index is written before the payload**, so a file can start playing
  before it has finished downloading. That is awkward, because the sample table
  stores absolute offsets that depend on how big the table is — resolved by
  building `moov` twice, once to measure and once for real. Every field is fixed
  width, so the second pass is exactly the same size as the first.
- **H.264 is a licensed codec** and plenty of Chromium builds ship without it.
  Asking for MP4 on one of those gets you a **WebM and a line in the console
  saying why**, not a failure and not a corrupt `.mp4`. The library records the
  extension that was actually written, never the one that was asked for.

The muxer also refuses rather than guessing. An `EncodedVideoChunk` carries a
presentation timestamp and no decode timestamp, so a stream with B-frames cannot
be muxed correctly without a `ctts` table this has no way to build. Chunks
arriving out of presentation order throw, and the export falls back to WebM.

## The audio FX chain

The master bus is a **fixed** set in a fixed order, one control each. That is the
right default and it has not changed. What it cannot do is let you say *gate it,
**then** ping-pong the result, **then** duck the whole thing* — and order is where
most of a sound lives.

**FX CHAIN** is that, and it is deliberately the same panel, the same stored
shape and the same cap as the video filter chain: pick one, **＋ FX**, reorder
with ↑ ↓, bypass with ◉, remove with ✕. It runs *after* the bus, so an empty
chain is a true no-op and every project made before it renders identically.

| Group | |
|---|---|
| **Tone** | **3-Band EQ** · **Pitch Shift** |
| **Modulation** | **Chorus / Flanger** · **Auto-Pan** |
| **Space** | **Ping-Pong Delay** |
| **Dynamics** | **Pump / Gate** |
| **Rhythm** | **Stutter** · **Reverse Sections** |

### Why some of these work differently

`renderAudio()` builds a node graph, renders it, and *then* post-processes the
samples. Effects fall into the same two halves, and pretending otherwise is where
this would have gone wrong:

- **Graph effects** (EQ, chorus, auto-pan, ping-pong, pump) insert nodes into the
  chain.
- **Post effects** (stutter, reverse, pitch shift) rewrite the rendered samples,
  because they need to *read* the signal — a stutter has to copy a slice it has
  already heard, and no arrangement of WebAudio nodes will do that.

A post effect must leave the render exactly as long as it found it. The loop
crossfade and both fades run afterwards and assume the length they were handed,
so a pitch shift that resampled the whole buffer would silently move the loop
point. It is done by overlap-add granular resampling instead, which keeps the
length.

## The 46 screens

| | |
|---|---|
| **Windows** | Terminal · Blue Screen (9x) · STOP Screen (NT) · Error Dialog · File Explorer · Boot Splash · Shutdown · Fake Desktop · Task Manager · Registry Editor · Hex Editor · Search Results · BIOS Setup |
| **Cards & IDs** | ID / Keycard · Cyber Implant ID · **Evidence Tag** · **Floppy Label** · **CD Label** · VHS Label · Cassette J-Card |
| **Paper & print** | **Newspaper Clipping** · **Police Report** · **Journal Page** · **Prescription** · **Boarding Pass** · **Bank Statement** · **Certificate** · **Calendar Page** · **Autopsy Form** · Receipt / Docket · Redacted Document · Missing Poster |
| **Technical** | **Blueprint** · **Punch Card** · **Map with Pins** · CRT Test Pattern · Patient Monitor · Camera Still |
| **Networked** | HTTP 404 · Chat Window · ATM / Kiosk · Corp Login · Cyberpunk Terminal |
| **Aesthetic** | Vapor Desktop · Mall Directory |
| **Your own art** | Import Image (retro-ify) |

The **paper** templates are the deliberate exception to the tool's usual rule
about colour: they fill with their own stock (newsprint, manila, cyanotype blue)
and ignore the background colour, because a newspaper on a green CRT background
is not a newspaper. Their type also **scales with the sheet** rather than being
an absolute pixel size — a clipping at 1080×1920 should be a readable page, not
a huge sheet with a stamp of text in the corner. The font control still drives
it; it scales the result instead of being the answer.

Every template composes at any shape, draws the same screen for the same seed,
and uses both the title and the body box.

**Wrap** used to be a checkbox that did nothing on 45 of the 46 screens — only
Terminal honoured it, because every other template hand-rolls its own layout and
there is no shared box to wrap to. Each prose template now passes its own width,
so wrap works on the BSODs, the STOP screen, the error dialog, the memo, the
missing poster, the 404, the ATM, the keycard, the implant ID, the cyberpunk
terminal, the prescription and the certificate. Templates that lay out a
**table**, a hex dump or a column of menu items are deliberately left alone:
breaking `ARCHIVE_0347.TAP|C:\TAPES|14.2 MB` across two lines is not word wrap,
it is damage. It stays off by default, so an existing project renders as it
always did.

## Marks: putting something where you want it

Every one of the forty-six templates bakes its own layout. That is what makes
them one-click — a BSOD looks like a BSOD because nobody had to position it —
and it is also why "put the caption *here* instead" used to be inexpressible.
Re-authoring forty-six templates against a layout engine is the expensive answer
and it would make every one of them worse.

**Marks** are the one layer that is not baked: text, boxes, redaction bars,
ellipses, lines and arrows placed anywhere over whatever template is selected.
Add one, then **drag it on the preview** to move it and **drag its corner grip**
to size it. A template added tomorrow gets marks for free.

- **Positions are fractions of the canvas, never pixels.** The screen size and
  aspect are one click away, and pixel coordinates would scatter every mark the
  moment you switched from 480×360 to a 16:9 poster. Text size follows the same
  rule, so a caption placed on the preview is the same relative size in a 4×
  export.
- **A text mark with a width wraps to it.** Leave the width at zero and it stays
  on one line — which is what you want for a stamp or a label.
- **Colour "auto" follows the screen's foreground**, so a mark survives a palette
  change instead of disappearing into the new background.
- **Marks draw *under* the CRT/paper pass.** They take the scanlines, the noise
  and the vignette with everything else, because a caption that missed them
  would read as a screenshot somebody wrote on afterwards. The dashed selection
  outline is the opposite — it draws over the top, and it is never in an export.
- **They can be placed without a pointer.** Click a mark's name in the list and
  the arrow keys nudge it 1% of the canvas, Shift+arrow 5%, Alt+arrow resizes
  the ones with a box. Dragging on the preview does the same thing with a mouse;
  neither is the only way in.
- A **timeline still captures the marks it was made with**, the same way a video
  clip captures its keyframes and filter chain. Clearing the SCREEN tab does not
  reach back into a sequence you already built.

## The filter chain

The CRT/VHS stack on the VIDEO tab is fixed: one control each, always applied in
the same order. That is the right default and it has not changed. What it cannot
do is let you say *grade it cold, **then** bloom, **then** crush it to four
colours, **then** letterbox* — and order is where most of a look lives.

**FILTERS** is that: pick one, **＋ FILTER**, and it runs after the built-in
stack. Reorder with ↑ ↓, bypass with ◉ (which keeps the step and its settings),
remove with ✕. Up to eight steps. An empty chain is a true no-op, so every
project made before the chain existed renders exactly as it did.

**45 filters in five groups:**

| Group | |
|---|---|
| **Colour** | Colour Grade · **Levels / Curves** · Duotone · **Gradient Map** · **Retro Palette** (CGA, EGA, Game Boy, Teletext, C64, amber mono) · Invert · Solarize · Posterize · Bit Crush · Threshold |
| **Sharpness** | Blur · **Directional Blur** · **Tilt Shift** · Sharpen · Edge Detect · **Neon Edge** |
| **Analogue** | CRT Curvature · Interlace · Ghosting · VHS Head Switch · Scan Tear · Datamosh · Lens Aberration · Film Grain · **NTSC Composite** · **Row RGB Shift** · **Rolling Shutter** · **Light Leak** · **Anamorphic Streak** · **CMYK Misregistration** · **Risograph** |
| **Pattern** | Halftone · Crosshatch · Pixel Sort · Mosaic · **Error Diffusion** · **ASCII** · **Kaleidoscope** · **Slit Scan** · **Feedback Echo** |
| **Frame** | Letterbox · Border · Text Stamp · **Lower Third** · **Timecode Burn** |

Some of them are the same idea as a built-in done properly rather than a
duplicate: **Retro Palette** snaps to a real machine's fixed colours, which
Posterize (fewer bits, same hues) cannot; **NTSC Composite** is the dot crawl and
rainbowing of luma and chroma sharing one wire, not the flat sideways offset the
built-in Chroma control makes; **Error Diffusion** carries each pixel's rounding
error into its neighbours, so the texture follows the picture instead of the 4×4
grid the built-in dither lays over it.

### One rule, and what it costs

**A filter is a pure function of (frame, time).** It gets the pixels the renderer
just drew and the clip time, and nothing else — no frame history, no
accumulating buffer. That is what makes scrubbing to 4.0s, playing through 4.0s
and exporting frame 48 produce the same pixels.

Two effects genuinely want history and are built differently because of it, which
their names say:

- **Feedback Echo** — real video feedback is recursive over *time* (this frame
  contains the last one, which contains the one before). This composites the
  current frame onto itself, each copy zoomed, rotated and dimmed. Identical on a
  still frame; on a moving one the real thing trails what just happened while
  this echoes what is happening.
- **Directional Blur** — true temporal motion blur averages the frames either
  side, which a filter cannot render. This smears along a fixed angle, which is
  what "motion blur" means on a generated scene anyway.

## Editing a sequence

A clip in a sequence is a **window onto a source**, not the whole of it: `in`
and `out` say which part plays, and trimming changes *which part*, never how
fast. The track above the table is where you do it —

- **Drag a block** to reorder it; **drag its edge** to trim. The block widths
  are proportional to what each clip contributes, so a sequence looks like its
  own shape rather than a numbered list.
- **Click to select**, then **←/→** to trim (Shift for 1s steps) or
  **Alt+←/→** to reorder. Blocks are buttons, so the whole track is reachable
  from the keyboard and reads out to a screen reader.
- Each clip has its **own transition in** — cut, crossfade or dip-to-black —
  rather than one rule for the sequence. A crossfade is the only one that
  overlaps, and its overlap is bounded by both clips, so a long dissolve between
  two short clips cannot run the sequence backwards.
- **＋ STILL** holds the current SCREEN render for N seconds, which is how a
  title card, a document or a BSOD gets into a sequence.

A whole drag is **one undo entry**, and the preview holds still until you let
go rather than restarting from the top of the sequence on every pointer move.
The table under the track writes exactly the same clips — use it when you would
rather type a number than aim at a handle.

### Bringing your own footage in

Import used to mean **one slot per kind**: one image, one video, one sound, held
in module variables. Loading a second video silently replaced the first, nothing
persisted, and nothing appeared in the library — so you could not cut two shots
you had filmed yourself.

Now a file becomes a **library row** like everything the tool makes:

- **Drop files anywhere** over the studio, or press **＋** on the media bin.
  Several at once is fine.
- Each one is classified (`videos` / `music` / `image`), named from the file,
  de-duplicated, given a **poster frame** (a tenth of the way into footage,
  because the first frame of a lot of material is black) and a duration, and
  **persisted** — so it survives a reload and travels with the project.
- **One file it cannot use costs that file, not the batch**, and the log says
  which and why. A `.mov` is refused with a reason rather than becoming a row
  that looks fine and silently will not decode.
- **Clicking an asset in the bin uses it**: footage becomes the VIDEO source
  (`videoin`), a still becomes the SCREEN image, a sound is aimed at the audio
  lane ready for ＋ SOUND.

The single active slots still exist and still drive the renderer — a library row
is loaded *into* one. That is what keeps every existing render path exactly as it
was.

### Footage is a clip, and a sequence can cut between files

The `Video In` scene drew from **one** module-level element — the last file
loaded — so a sequence with two footage clips played the same file twice. It
looked right while you built each clip and was wrong the moment you had two.

A clip now carries the library key of its footage (`Footage`, in the VIDEO
panel's Look section), captured into the clip like every other setting. So:

- **Drag an asset from the media bin onto the sequence.** Footage becomes a clip
  bound to *that* file, as long as the footage is; a still becomes a held
  screen; a sound lands on the audio lane **at the time you dropped it** —
  because sound is positioned and picture is ordered, which is the same split
  the two lanes have everywhere else.
- Decoders are **pooled and capped**. Two clips cut from one file share a
  decoder — which is the ordinary case, since that is what trimming is — and the
  pool evicts the least recently drawn rather than refusing, because a sequence
  that plays its first eight clips and then shows black is not better than one
  that re-decodes.
- Leave `Footage` on *"the last file you loaded"* and it behaves exactly as it
  always did, which is what every clip captured before this keeps doing.

### …and it brings its own sound with it

For a while a clip could be cut but not *heard*. The sound was in the file the
whole time and had no path to the mix: the pooled `<video>` decoders are muted
(they are drawn from, not played), and the sound-source list only admitted rows
filed as `music`. So you could import an interview and cut it against silence.

Video rows are now sound sources like any other, and a footage clip has **Its own
sound** in the inspector — its file's audio, in the preview and in both export
paths.

It behaves differently from a bed in the two ways that matter, which is why it is
a separate thing rather than another value of the same control:

- **it starts where the picture starts, inside the file.** A trimmed clip begins
  two seconds in; sound that ignored that would sit two seconds behind the
  picture on every trimmed shot — a mouth and a voice apart by exactly the
  in-point.
- **it does not loop.** A bed is a hum you want repeated to fill the clip. A shot
  whose sound ends before its picture does has simply ended.

The two **compose** — a room tone under your own footage is the ordinary case, so
a clip can carry both.

**Off by default, and on for new clips.** Those are not in conflict: the document
defaults it off so no project already on disk changes under its author — those
clips were cut against silence, and a load that put dialogue under them would
change an export somebody had already approved — while a footage clip added
*today* asks for it at the moment it is created. New work does the expected
thing; old work is left alone.

A container whose audio codec this browser cannot decode still fails, but it now
fails at decode time with a message naming the row. A fixable complaint beats an
option that was never offered.

### Finding things, and getting them out

Two measurements drove this. The settings column was one uninterrupted scroll —
**7.1 screens on VIDEO, 4.2 on SCREEN, 13.4 on AUDIO** — and getting a finished
render out of the tool meant noticing a toast, finding the LIBRARY tab, and
finding the row.

- **The settings column is grouped.** VIDEO reads *Look · Text · FX · Motion*,
  SCREEN *Look · Marks · FX*, AUDIO *Quick · Core · Ambience · Events · Mix*, and
  one group shows at a time. The grouping is declared on each fieldset in the
  markup (`data-section`), so it cannot drift from a reworded heading, and every
  layer the audio registry generates carries its own. Ctrl+K still reaches every
  setting: a jump brings its section back first.
- **Audio layers that are switched off start folded**, which is what takes that
  panel from ten screens to something readable. TIDY still folds them on demand.
- **⤓ EXPORT, top right, always.** It exports whatever workspace you are in —
  clip, screen, sound or sequence — by pressing the same control that tab
  already has, so the formats and the guards are unchanged. **Ctrl+E** does it
  too.
- **Every finished render carries its own download** in the media bin, named for
  the file. A row whose bytes are not in this browser says so rather than
  offering a button that does nothing.

A panel with only a couple of sections gets no strip — three buttons above two
fieldsets is furniture, not navigation.

### The lane has a real time scale

Zoom is pixels per second, not a CSS stretch. **100% fits the whole sequence to
the window** — which is exactly the layout that shipped before the scale existed
— and above that the lane scrolls, with the track headers pinned and the ruler
picking a finer step as you go in. That last part is the difference: the old
ruler chose its ticks from the duration, so zooming spread the same six labels
further apart. Now a block is *its own length in pixels*, and a 60px drag at 300%
moves a trim by exactly 60 ÷ pixels-per-second.

**Fit** returns to showing everything. Zoom and scroll live in `localStorage`,
not in the project: how far you are zoomed in is not something to save, undo, or
send to whoever opens your share link.

### Drags land on something

A drag used to end wherever you let go — some arbitrary hundredth of a second.
Butting an overlay against a cut, ending a shot on the beat you can *see* on the
audio lane, or starting something exactly at the playhead all meant zooming in
and nudging until the number looked right.

Drags now pull toward the things worth landing on: every clip edge on both video
tracks, every sound's edges, the playhead, and zero. **Hold Shift** to place
freely.

The pull is measured in **pixels, not seconds**, and that is the whole design. A
fixed tolerance in seconds is uselessly weak zoomed out and unusably sticky
zoomed in; eight pixels is the same forgiving gesture at every scale, with
nothing to configure.

Two exclusions do the real work, and each is the difference between snapping and
a lane that fights the pointer:

- **A clip is not a target for itself.** It could never be dragged off its own
  edges.
- **Nor is anything the drag is about to move.** Trimming a spine clip
  re-derives the start of every spine clip after it — so the next clip's start
  is not a fixed point at all, it is the dragged edge itself, one commit behind.
  Left in the list, the pointer finds a target a pixel away on every move and
  the clip sticks where it started. Overlays and sounds after it *are* fixed —
  they are positioned rather than derived — so they stay.

And the playhead is only a target while the preview is **paused**. One sweeping
across the lane sixty times a second is not a place anyone is aiming at, and
snapping to it would pull a drag toward a different time on every frame.

### The audio lane

Sound used to be one bed for the sequence plus an optional bed per picture clip.
It could accompany the picture and it could not be **placed**. Now sound is
clips on their own lane — **＋ SOUND** puts the chosen source at the playhead —
each with its own start, its own trim into the file (drag the edges), **gain**,
**pan**, **loop** and **mute**, drawn with a waveform and mixed into both export
paths.

Audio clips live in their own document array, `timeline.audio`, and never enter
`timeline.clips`. That is deliberate: letting sound ride the clip array would
need a guard in every place that assumes a clip has a scene, a transition and a
frame, and each of those guards fails *silently* when forgotten — an unknown
track reads back as V1, so the failure is a plausible export with a picture where
a sound should be. The two arrays meet in exactly one place: how long the
sequence is.

The transport carries a **peak readout** for the whole sequence mix, and it is
not decoration: nothing here is limited, gain goes to 4, and four sources sum
without headroom management of any kind. Past 0 dB the encoder clamps — audible
as distortion on the loudest moment of the export, which is the one place nobody
re-checks. It is measured on the mixdown rather than off a live analyser,
because the number that matters is the peak of the *whole* sequence including the
part you are not currently looking at.

**Fade in** and **fade out** are lengths on the clip, beside its trim. Every
sound used to start and stop dead, which is audible as a click on anything with
content at its edges — which is most things. Two fades that do not fit share the
clip: the fade in wins and the fade out takes what is left, because a shortened
fade-in is heard as *the sound arriving late* while a shortened fade-out is heard
as a shorter fade-out.

Sound past the end of the picture **extends** the sequence rather than being
truncated, and mute deliberately does *not* change the length — mute is a
decision you flip constantly while auditioning, and a picture that jumped every
time would be unusable.

### You can hear it while you cut it

Every piece of a sequence's sound existed long before you could hear any of it:
the sequence bed, each clip's bed, the whole A1 lane with its gains and pans, and
a mixer that folds all of it into one buffer. Only the **export** ever built it.
So the only way to find out whether a cut landed on the beat was to render the
file, play it somewhere else, and — if it was wrong — do that again. Cutting to
sound you cannot hear is guessing.

The preview now plays **the same mixdown the export will**, built from the same
description (`doc/audiomix.js`) by the same mixer. **🔈 SOUND** in the transport
turns it off and on and is remembered per browser, like the zoom and the skin —
it is not part of the project and never reaches whoever opens the share link.

Two details are worth knowing because they are the whole design:

**The picture follows the audio clock.** `performance.now()` and
`AudioContext.currentTime` are different clocks: one runs on the system timer and
drops frames under load, the other on the sound card and never does. Drive the
frames from wall time and a long sequence ends visibly out of sync with its own
soundtrack, with no single frame you could point at as the moment it went wrong.
So while sound is playing it *is* the clock, and wall time is only the fallback.
Mute, or a browser that will not let audio start, costs you exactly the sound —
the preview keeps running as it always did.

**Nothing happens until you click something.** A browser will not start audio
nobody asked for: a context built without a user gesture is born suspended, and a
suspended context's clock *does not advance*. Because the picture follows that
clock, starting playback on one would not merely be silent — it would freeze the
preview on frame one. So the context is created by your first press of ▶ or
🔈 SOUND, and nothing takes over the clock until it reports `running`.

The mixdown is cached against a signature of what the sequence actually *sounds*
like, so renaming a clip, moving a keyframe or changing a transition leaves the
sound playing; changing a bed, trimming a clip that carries one, or nudging a
sound on the lane rebuilds it. A sequence with no sound anywhere builds nothing
at all.

### Per-clip keyframes

A clip has always carried the curves it was captured with. Now you can edit them
after the fact: select a clip and the inspector's **Keyframes** group keys the
parameter you pick, at the playhead, in that clip's own source time — so a
trimmed clip keys where you are actually looking.

The value comes from *that clip's* recipe, not from the VIDEO tab's slider,
because the tab describes a different clip. For the same reason **Update from
VIDEO** keeps the curves you drew here; taking the tab's is a separate button
that says so.

### V2: an overlay track

V1 is the **spine** — clips in order, back to back, exactly as a sequence has
always worked. V2 is an **overlay lane**, and it is *positioned* rather than
ordered: a V2 clip sits at the time it says, so an overlay is about a moment (a
burst of static as a door opens) rather than about a place in a queue. Trimming
something earlier on the spine does not drag it around.

**＋ Overlay** puts the current VIDEO look on V2 starting at the playhead, or set
any clip's **Track** to V2 in the inspector — it keeps the time it already had,
so nothing jumps. Drag an overlay along its lane to move it in time; drag a
spine clip to reorder. Same gesture, two lanes, two meanings, because the lanes
mean two different things.

The default blend is **screen**, and that default is the point. Every scene here
draws bright marks on a near-black ground and the pipeline has no alpha channel,
so composited normally a V2 clip would simply *replace* the picture — an overlay
indistinguishable from a cut. Screen keys the black out for free. The blend list
is the one the layer stack inside a clip already uses, so there is one set of
blend names in the tool rather than two that drift apart, and **Opacity** rides
on top of it.

An overlay's transition is a **fade up and down**, not just a way in: footage
keeps running underneath it, so it has to leave as deliberately as it arrived. It
also means an overlay is never "first" the way the first spine clip is — it
always has V1 to fade up against.

Two smaller consequences, both deliberate:

- an overlay hanging past the end of the spine **extends** the sequence rather
  than being silently cut off — it plays over black, visibly, which is a thing
  you can see and fix;
- splitting an overlay sets **both** halves to a hard cut and tells the right
  half where it starts. A symmetric fade left on the left half would dip it to
  nothing in the middle of what used to be continuous material.

### Speed and reverse

A clip played at the rate it was shot, always. **Speed** and **Reverse** are on
every video clip, and both fall out of one line: `clipLength` is now the source
window *divided by the speed*, so a four-second window at 2× occupies two seconds
of lane — and where the next clip starts, how long the sequence is, how wide the
block is drawn and how long its bed has to be all follow without any of them
knowing that speed exists.

The other half is `sourceTimeOf`, which is where the three time bases now meet.
Before speed, they agreed by accident: `in + localT` was the whole answer for the
renderer, the keyframe panel and the mixer alike. Reversed, a clip starts at its
**out** point and walks back — the last frame of the window is the first one you
see. That is deliberately *not* the same as swapping in and out, which would play
a different part of the source forwards.

**The sound follows the picture.** Footage audio is pitched by the speed and
reversed with the clip, which is what every editor does by default and the only
reading that keeps a voice attached to a mouth. A *bed* is not pitched — it is a
separate sound laid under the clip, so speeding the picture only gives it less
clip to fill.

Two honest limits, stated rather than hidden:

- **A still cannot be sped up.** Its Hold *is* its length, so speed would be a
  second way to spell a control it already has. Forced to 1×, not merely hidden,
  so a hand-edited file cannot smuggle one in.
- **Live footage cannot be reversed.** Speed reaches an imported clip through the
  `<video>` element's own playback rate, set per draw because two clips cut from
  one file share a decoder. No browser supports a *negative* rate, so on a
  footage clip Reverse turns the sound around and says so in the panel rather
  than offering a control that does nothing to the picture.

### Where a clip sits in the frame

Every clip filled the frame edge to edge, always — one composition, repeated.
That is also what made the overlay track less useful than it looks: an overlay
the same size as the picture underneath can only replace it or tint it. Picture
in picture, a corner inset, a punch-out with black around it, a shot pushed to
one side to leave room for a title — none of them were expressible, because a
clip had no position to express.

The inspector's **Transform** group gives every clip five numbers: **Scale**,
**X**, **Y**, **Rotate** and **Mirror**, all about the clip's own centre. It is
on both tracks — a punch-out on the spine is as real an edit as an inset on the
overlay, and gating it to V2 would be inventing a rule the compositor does not
have.

**X and Y are fractions of the frame, not pixels.** A layout built at 360×270 is
the same layout at 1080×1920, so changing the delivery format does not scatter
every inset you placed. **Place** is the same thing with the arithmetic done for
you: full frame, centred, the four corners, left or right half. A corner is half
size at an offset of 0.25, which puts its near edges exactly flush — the number
you would otherwise have to work out, and get wrong in the direction that puts
half the clip off screen.

Two things the panel does that the picture cannot:

- it prints what the transform **is** ("50% · x +0.25 · 12° · mirrored"), because
  five boxes of decimals do not read as a position;
- it says when a clip has been pushed **entirely off screen**. That renders as
  nothing at all, which looks exactly like a broken clip, so it is worth a
  sentence and a **Fill frame** button rather than a mystery.

### …and you can just drag it there

Five number boxes describe a position; they are not a way to place one. Nobody
aiming an inset at the bottom-right corner thinks "x plus nought point two five"
— they point at the corner and then nudge. Select a clip, put the playhead over
it, and the monitor draws its box: **drag inside it to move**, **drag a corner to
scale** about the centre, **drag the grip above the top edge to rotate**, and
**double-click to put it back** — which is the one gesture you cannot do by hand
once a clip is off screen, because there is nothing left to grab.

The boxes stay. Typing 0.25 is how you make two insets match exactly.

Three details that are the whole of why it feels right:

- **Every event converts CSS pixels to buffer pixels first.** The canvas is
  displayed at whatever the monitor row allows and holds a buffer of the
  sequence's own size. Skip the conversion and the handles are exactly right on
  a 1:1 monitor and increasingly wrong as the window changes — a bug that reads
  as "sometimes it feels sticky" rather than as an error.
- **A drag is applied from the transform it started with, plus the whole delta**
  — never from the current one plus a step. Accumulating steps rounds on every
  pointermove, and a clip that ends up somewhere other than under the pointer is
  the exact complaint direct manipulation exists to answer.
- **The overlay is drawn by the preview loop, after the frame.** Both exporters
  call `renderTimelineFrame` themselves and never come through it, so a handle
  cannot end up baked into somebody's upload — ruled out by where the call sits
  rather than by remembering to clear a flag.

A clip written before any of this reads back as the identity, and the compositor
keeps its original one-line draw for it. That is not an optimisation, it is the
guarantee: the transform path is only entered by a clip that asked for it, and
the audit checks that writing the identity leaves the frame identical *to the
pixel*.

### A clipboard for clips

Split, razor, duplicate and ripple delete were all here; a clipboard was not. So
a look you had built at 0:04 could be copied into the slot beside it and nowhere
else — not to 1:20, and certainly not into another project.

**Ctrl+C** copies the selection and **Ctrl+V** pastes it at the playhead. What
"at the playhead" means depends on what you copied, and each answer is the same
split the two lanes have everywhere else:

- **a sound, or an overlay** starts *at* the playhead — those are positioned, and
  the playhead is a position;
- **a spine clip** goes in *after* whatever the playhead is over, because the
  spine is an order and a time is not a slot in one. Past the end, it appends.

What is held is a **snapshot**, not a reference: the live clip list is rebuilt on
every commit and its ids are re-minted each time, so keeping the object would
paste whatever that slot had become by the time you used it. And it is a
module-level clipboard rather than the system one — a clip is a recipe, a trim, a
transform and a *reference* to a library asset, and the asset does not travel
with it, so a paste into another project would land a clip pointing at footage
that is not there.

Ctrl+C and Ctrl+V stay out of the way while a field has focus. Taking the
browser's copy away from a text box to duplicate a clip would be indefensible.

### Transitions that are edges, and a lane that shows its work

Three transitions became fourteen — `cut · crossfade · dip · dipwhite · burn ·
wipe · slide · push · iris · clock · barn · blinds · whip · glitch` — and the
travelling ones take a **direction** rather than existing four times over in the
picker. **Wipe** reveals the incoming clip from an edge and **slide** pushes it
in from one — both at full opacity, which is what makes them read as an *edge*
rather than as a dissolve: the clip underneath is not dimmed, it is covered. The
audit measures exactly that, as a column profile: halfway through a wipe the two
sides of the frame are different pictures, where a dissolve at the same instant
is the same blend everywhere.

They overlap their neighbour the way a dissolve does, and that fact is now
**named** (`OVERLAPPING`) rather than spelled `=== 'crossfade'` at each site. It
was spelled that way in two places, and adding a wipe to a list of one is exactly
how you get a transition that renders over its neighbour in the compositor and
plays *after* it in the schedule — visible as a clip that dissolves into black.

**The transition's length is a handle on the block**, drawn *as* that length, so
dragging it is the one place in the tool where the number and the picture of the
number are the same object. It is tested for before the trim grips, because a
transition is measured from the clip's start and its handle therefore begins
exactly where the in-point grip is. A cut has none, because a cut is instant, and
neither does the first clip of the spine, because it has nothing to come in from.

**A clip's keyframes are marks along its block.** A curve used to be invisible
from the lane — the only way to know a clip was animated was to select it and
open the picker — so "which of these did I animate, and where" was a question you
could only ask one clip at a time. The marks are placed through the clip's own
time mapping, so on a trimmed, sped-up or reversed clip they land where the
frames they describe actually are, and trimming drops the ones that fall outside
the window.

### The clip inspector: two clips that look different

Every look control in this studio is document-wide. The VIDEO tab describes the
**next** clip you add — so for a long time a sequence could not hold two clips
that differed, and the only way to change one already in it was to delete it and
build it again.

Select a clip and the **properties column** (top right, in the editor layout)
shows that clip:

- its **name**, **source length**, **in/out** and a *Whole source* reset;
- its **transition in** and how long it takes — offered but disabled on the
  first clip, which has nothing to come in from;
- its **look**: scene, copy and the two colours for a video clip; template,
  title and body for a still. The pickers are the real ones cloned from the tab,
  so they show exactly the scenes and screens your packs installed;
- its **sound bed**, laid over the sequence's own at the clip's start time.

Only the handful of settings that make one clip read differently from the next
live here. Everything else stays on the tab and travels by the round trip:
**Send to VIDEO** loads this clip's look into the tab, where all sixty-odd
controls for it are, and **Update from VIDEO** takes it back — bringing the new
length with it and keeping your trim where it still fits. A second copy of the
VIDEO tab in a side panel would be a second implementation to keep in step, and
it would lose that argument within a release.

Every edit here is an ordinary undoable document command, and one that changes
nothing writes nothing — re-committing a field at the value it already had does
not stack empty entries in the undo stack.

Setting a clip's source length also lengthens **the recipe inside it**. The
renderer takes the source's length from the recipe, so moving one without the
other gives a clip whose last seconds are a frozen frame; if a project made
before this arrives with that already true, the inspector says so instead of
leaving you to wonder why the picture stopped.

### Key and mask: which parts of a clip are used

Everything above puts a whole clip somewhere. This decides how much of it is
there at all — and it is one idea, not two, because both halves answer the same
question in the same place and answer it the same way, by writing alpha:

- the **key** decides by *colour* — this pixel is the green screen, drop it;
- the **mask** decides by *geometry* — this pixel is outside the shape, drop it.

It works because of the same line titles were built on: the compositor
composites a *canvas*, and a canvas carries alpha. Nothing downstream of
`renderClipTo` needed changing — the clip transform, the blend, the opacity and
all fourteen transitions treat a keyed clip exactly like any other picture. What
was missing was any way to put alpha *into* a buffer a scene had just filled
edge to edge.

**The key** is `chroma` or `luma`. A colour key measures distance in the Cb/Cr
plane — the space the footage was recorded in — with **Tolerance** as the radius
and **Softness** as the band at its edge, because a hard cut-off gives a jagged
edge on anything real. **Spill** takes the key's own colour back out of what
survived: a lit green screen bounces onto every edge and every strand of hair,
and that green rim is what makes a key read as a cut-out. It is removed along
the key's direction only, so a genuinely green jacket loses its fringe rather
than its colour, and luminance is preserved so despilling is not a darkening.
A brightness key is the honest version of the trick the screen blend has always
played on these scenes: it drops the near-black ground and leaves the bright
marks *alone*, where screen also lightens whatever is underneath them.

**The mask** is a rectangle or an ellipse, in fractions of the *clip's own
picture* — so it travels with the clip when you move or scale it — with a
rotation and a feather, and one control saying what it *does*:

| Mask does | What it is for |
|---|---|
| **Show only this** | Everything outside is dropped. Two clips masked to opposite halves is a split screen; one small ellipse is a picture-in-picture. |
| **Blur this** | A face, a licence plate, a name on a screen. |
| **Pixelate this** | The other way to obscure a face — a mosaic rather than a smear. |
| **Darken this** | Turn **Invert** on and it is a spotlight. |

Invert selects the complement, and it means the same thing in all four rows.
That consistency was chosen over convenience: a mode that quietly meant
"outside" while its neighbours meant "inside" is a rule you have to remember
rather than one you can read.

The three that alter pixels rather than remove them build the altered picture on
a scratch, confine *that* to the mask, and lay it back over the clip — so
everything outside the shape is the untouched original rather than a second draw
of it. The deep audit asserts precisely that: outside a blurred face, the frame
comes back **byte-identical**, and inside a spotlight the lit shape does too.

**One thing is not free, and the panel says so.** A clip that carries alpha has
to composite at *normal* — the only blend that means "put this where its alpha
says and leave the rest alone". Every other mode decides what to keep by
brightness, and `screen`, which V2 defaults to, drops black for free: exactly
right for a bright mark on a near-black scene, and exactly wrong for a keyed
foreground, where every shadow on your subject goes with the screen behind it.
So `normal` is now in the blend list, a title and a shape take it when they are
added, and a clip whose key is being undone by its blend says so with the button
that fixes it. It also says when a key is on a **V1** clip, where the spine is
drawn on black and the holes read as black rather than as the shot beneath.

A mask with no area is treated as absent rather than as an empty reveal — a
mistyped width would otherwise blank the clip, which reads as a bug rather than
as a rectangle — and it says that too.

### …and both halves can be done by pointing

Ten number boxes and a colour well describe a matte. They are not a way to make
one, and the two gestures that replace them read the same way the transform's
did: point at the thing you mean.

**Pick key colour** arms an eyedropper; click the picture and that colour becomes
the key. Three things about it are deliberate:

- it samples the clip's **own buffer**, not the monitor. The finished frame has
  already had the key applied to it, so the pixel you want to click — a patch of
  screen the key is still missing — is *gone* from it, and sampling there would
  read whatever is behind the clip and set the key to that. Off the source it is
  the green you meant, which is why widening a key that is nearly right works at
  all;
- it goes through the **inverse of the clip transform**, so a clip shrunk into
  the corner is sampled where it now is rather than where it would once have
  been;
- it **averages a small box** rather than taking one pixel. A green screen in a
  compressed delivery is not one green, and keying to a chroma-subsampled
  outlier leaves speckles you then blame on the tolerance.

If the key was off, picking a colour turns it on — in the same undo entry,
because setting a key colour on a clip with no key would look like the tool
doing nothing.

**Place mask on monitor** puts the mask box on the picture in amber: drag it,
drag a corner to size it, drag the grip above it to turn it. Escape stops.

The monitor edits **one box at a time**, and which one is explicit. It has to be:
the clip's transform box and its mask box are both rectangles with corner grips,
they overlap through most of the useful range, and on a full-frame mask they are
the same four points — so a single hit test would have to guess, and it would
guess wrong exactly when you were being careful. The overlay says which one is
live by drawing only that one. Under the eyedropper it draws *nothing*, because
the gesture is "look at the picture and click a colour" and furniture across it
is the one thing that could make you click the wrong one.

**The mask box travels with the clip.** A mask is applied to the clip's own
picture *before* the clip is placed in the frame, so on a clip shrunk by half the
mask sits at half the distance from the centre, and tilts with a tilted clip.
Every pointer gesture is therefore answered in the clip's own buffer space and
converted in exactly one place, which is what keeps `doc/matte.js` free of the
transform and testable without a canvas.

Sizing is about the **centre**, not the opposite corner. A mask is placed
centre-first — you put it over the face, then size it until the face is covered —
and anchoring the far corner would walk the shape off the thing you had just
aimed it at every time you resized.

### Every size, and what carries across one

Two kinds of measurement live in this tool, and the difference decides what
happens when you change the delivery format.

**Fractions of the frame** — a title's size and placement, a shape's geometry
and stroke weight, a mask's box and feather. These are the same picture at any
size by construction: authored at 320×240, identical at 1920×1080. The audit
asserts exactly that, four times the linear size, on every title placement,
every readability treatment, every text effect and all eight shapes.

**Pixels** — the type size on VIDEO and SCREEN, and thirty-two filter
parameters: grain size, blur radius, slit-scan displacement, the length of a
pixel-sort run. Pixels are the right unit to *type* — an author who says
"two-pixel grain" means it — and the wrong unit to *keep* when the frame
changes underneath them. So **the format picker carries them**: choose a bigger
delivery format and the type size and the chain's pixel parameters scale with
it, snapped to each control's own step and clamped to its own range.

Only the picker does this. Typing into the W or H box does not, and the
asymmetry is deliberate: typing a number is how you *correct* a size, and a tool
that rewrote five other controls under each keystroke would be unusable. Nothing
rewrites a saved project either — this happens at the moment you change the
format, and never on load.

Every drawn thing is swept across a size ladder in CI — one pixel, a favicon, a
thumbnail, 4:3, 1080p, a 1:4 column, a 12:1 letterbox slot and an odd-numbered
frame — and asked three things: does it throw, does it leave a transparent hole
in a frame it owns, and does it draw a picture at all. That sweep found two
templates that crashed on a banner-shaped frame (a margin taken from the width
and spent against the height, so the remaining height went negative and a radius
with it) and three filters that cleared the frame and then displaced it, leaving
a transparent gash down one side — invisible on the video tab, where the canvas
sits on black, and a real hole in a keyed overlay and in an alpha export.

## Delivery formats

The studio was built for assets that play inside a fake Windows 95 desktop, so
every size in it was small and landscape with a 1280×1024 ceiling. **Format**
(VIDEO, SCREEN and TIMELINE) sets the frame to somewhere the work actually gets
watched:

| Format | Size |
|---|---|
| Shorts / TikTok / Reels | 1080×1920 |
| Vertical, lighter | 720×1280 |
| Feed portrait | 1080×1350 |
| Square post | 1080×1080 |
| YouTube 1080p / 720p | 1920×1080 · 1280×720 |
| CRT 4:3 · Small / VHS | 640×480 · 320×240 |

**Aspect** is the other half: it keeps the size you already chose and reshapes
the frame, with `9:16`, `4:5`, `3:4` and `21:9` alongside the originals. It
derives from whichever side has room, so a portrait ratio from a wide frame
comes out exact instead of overflowing the height limit.

Editing W or H by hand puts the Format picker back to `— custom —`, because a
label that has stopped describing the frame is worse than no label.

Both axes now go to **1920**. Two consequences worth knowing:

- The **export estimate** is measured from what a preview frame actually costs,
  so it reads `~17s to export` rather than promising "faster than real time" at
  a size where that is not true.
- **GIF export is capped at 640px** on the long edge. A GIF is a 256-colour
  format with no real interframe compression; at 1080×1920 a ten-second one is
  hundreds of megabytes, and collecting the frames would allocate two gigabytes
  of canvas first. The `.webm` export is what carries full-resolution work.

## Type: alignment and tracking

Text could be **left** or **centred**, and that was it.

- **Right alignment** is what a caption or a credit wants. The caret follows the
  type rather than being placed by its own separate rule, so right-aligned text
  still ends in a cursor.
- **Letterspace** is letter-spacing as a *percentage of the type size*, so a 20%
  track looks the same on a 12px caption and a 48px title. Wide tracking is the
  fastest way to make a title card look designed rather than typed; negative
  values tighten. It is set once per frame beside the typeface, so every string
  a scene or template draws takes it — and measurement accounts for it, so
  centred and right-aligned lines stay correctly placed.

**Zero is a total no-op** — not "zero pixels of spacing", the property is never
touched — so every project written before this existed renders byte for byte as
it did.

> **Per-line styling is not built, deliberately.** Making one line bigger or a
> different colour inside the body box would mean inventing a markup language
> and teaching 24 hand-rolled template layouts to parse it. **Marks** already do
> the job better: each one carries its own size, colour, alignment and position,
> so "this line, bigger, in red, over there" is a mark rather than a syntax.

## Text variables

A campaign fact, named once, used everywhere. Add `subject = M. WEBB` under
**TEXT VARIABLES** (the panel appears on both VIDEO and SCREEN and is one shared
list) and write `{{subject}}` in any text box on any tab — a scene's on-screen
text, a HUD strip, a reveal word, a screen's title or body. That is what turns a
preset from one finished artifact into a form you fill in.

| Macro | Notes |
|---|---|
| `{{time}}` `{{case}}` `{{badge}}` | Built-in **defaults** (`03:47` / `7749` / `0047`) — define a variable of the same name to override. These were EREBUS's numbers hardcoded in the tool; they are now just what you get if you say nothing. |
| `{{date}}` | Today, `YYYY-MM-DD`. Define `date` to pin it to a story date. |
| `{{seed}}` | The live seed. Not overridable — it *is* the seed. |
| `{{random:###}}` | Digits, one per `#`. Addressed by (seed, position): stable across frames, different for each occurrence, changes when the seed does. |
| `{{pick:a\|b\|c}}` | A seeded choice from the list. |

Expansion is a single pass and variable *values* cannot contain braces, so one
variable can never reference another. A name you have not defined is left on
screen exactly as written — a typo is visible rather than silently blank.

## Layers

Up to six extra scenes composited over the base clip, listed top-down the way
they sit on screen. Each layer is its own signal, not a second copy of the
first:

| Per layer | Empty means |
|---|---|
| **text** | use the clip's text — so a Snow layer can say `PLEASE STAND BY` while the terminal underneath says something else |
| **colour** | follow the clip's phosphor, including when you change it later |
| **size** | follow the clip's font size |
| **variant** | draw with the clip's randomness. Anything else re-rolls *this layer's* random streams, so a second Digital Rain is a **different** rain rather than the first one composited over itself |

Blending is additive by default because that is what stacked analogue signals
do. `multiply`, `overlay` and `hard-light` need a background to be absent rather
than black, so for those the layer's background is keyed out to transparent
before compositing — without it, multiply against a black-backed layer crushed
the whole frame.

Overrides are captured into a timeline clip with everything else, and a layer's
text goes through the same `{{variable}}` expansion the clip's does.

## Turnkey campaign bundle

Everything you generate lands in the **LIBRARY** table — set each asset's name,
kind, `gated` flag, and release beat. The **BUNDLE** tab then:

- **Generate wiring** — the merged `media-manifest.json`, both `index.json`
  files, and beat-grouped `call releaseMedia "…"` lines, ready to paste.
- **Validate** — lints the assembled bundle against the campaign contract
  (extension↔folder match, no duplicate/unsafe filenames, gated-at-boot warnings,
  collisions with shipped assets).
- **Campaign bundle .zip** — a drop-in archive (pure-JS store-only ZIP writer)
  mirroring the repo layout: `assets/videos/*.webm` + `assets/music/*.wav` in
  place, the manifest + index JSON, an `autoexec.snippet.retro`, and `INSTALL.txt`.
  Unzip into the repo root and the progressive-release chain picks it up.

The **BEAT COVERAGE** panel shows which assets are assigned to each known release
beat (`boot`, `unlockPhase3/5`, `erebus:sable:first/call`, `announceFourKeys`,
custom) — the `docs/required_media.md` clip→beat table as a live checklist.

## CLOUD: the optional backend

The **CLOUD** tab is the one place the studio touches a network, and it is
**off by default** — with no backend installed the tab just says so, and
everything else in this README works exactly the same. Install the backend that
ships in this folder (`setup.php`, below) and the tab syncs work between
machines:

- **⇧ SAVE TO SERVER** — creates or updates a server project. Every save
  snapshots what it replaced; **version history** keeps the most recent 50
  autosaves and named snapshots forever, and **RESTORE** snapshots the current
  state first so a restore is itself undoable.
- **⇧ UPLOAD LIBRARY** — uploads generated assets in chunks sized to the host,
  deduplicated by content so a re-run sends only what changed.
- **Sharing** — grant a named person viewer/commenter/editor access, or mint a
  read-only link that works for someone with no account (shown once; revocable).
- **ASSETS ON THE SERVER → LIBRARY** — pulls files back down on another
  machine: opening a project brings the recipe, this brings the media it
  refers to.

Nothing is uploaded until you sign in there and press one of those buttons.
The client half is `src/platform/api.js` + `src/ui/cloud.js`; the server half is
`server/` — a few hundred lines of PHP with no framework, no composer and no
application around it. Six tables, three endpoint families
(`/system/health`, `/auth/*`, `/studio/*`), one entry point at `api/index.php`.

**Installing it** takes one page: open `setup.php` in a browser and it walks
host check → database → schema → studio settings → first account, then checks
the API from your browser so a missing rewrite shows up as a red line here
rather than as a mystery a week later. It needs PHP 8 and MySQL 5.7.8+ (or
MariaDB 10.2.7+) and nothing else. Delete `setup.php` and `preflight.php`
afterwards.

**You do not have to make the database first.** Give the wizard a MySQL user and
the name you want, and if that database does not exist it is created for you
(utf8mb4 / utf8mb4_unicode_ci). That works wherever the user holds `CREATE` — a
VPS, a local machine, most Docker setups. On cPanel it usually does not, so make
the database there (MySQL Databases → Create New Database → Add User To Database
with All Privileges) and name it in the wizard; you get a message saying exactly
that rather than a raw SQL error. From a shell, `php server/migrate.php
--create-db` does the same thing.

An existing database is fine: the schema is `CREATE TABLE IF NOT EXISTS`
throughout and nothing is dropped or altered, so it installs beside another
application's tables — and if that application already has a `users` table, the
studio simply shares its accounts. (One caveat when sharing: if that other
application deletes an account, the studio's rows cascade away with it but the
files they pointed at do not. Remove `server/data/studio/assets/<user-id>/` by
hand.)

**Accounts** are made from the server, never from a sign-up page: `setup.php`
creates the first one, and after that either re-run the wizard with the
reconfirm key or use `php server/account.php add <name> <password>`. Every
account has identical rights; who may see a project is decided per project by
its owner.

**Where the folder lives is up to you.** The API ships inside it, so the client
looks for `./api` — relative to the studio, never the root domain, which on a
subdirectory install belongs to whatever else is on that hostname. If the host
will not honour `api/.htaccess` (AllowOverride None, or nginx without a
`try_files` rule) the client then tries `./api/index.php`, which is the same
backend reached without a rewrite, so the studio still works instead of
reporting no backend. The **API** field on the CLOUD tab shows what it settled
on: type an address to override it (an API on another host is a normal thing to
want), clear it to go back to detecting.

**Turning it off** does not mean uninstalling: set `'enabled' => false` in
`server/config/studio.php` and the backend goes quiet, the CLOUD tab says so,
and everything else is untouched.

The minimum upload set and the full walkthrough are in
[`docs/INSTALL.md`](docs/INSTALL.md).

## Constraints (browser reality)

- The tool must be **served**, not opened from disk (ES modules + CORS). Any
  static server works; Workers, `OffscreenCanvas` and the WebCodecs export
  pipeline have the same requirement.
- **Video export is offline by default** — WebCodecs renders frame-indexed,
  faster than real time at desktop sizes (a 10s clip takes about a second), and
  does not need the tab focused. It needs a **secure context** (localhost or
  https), and the estimate beside RECORD is measured from real frame cost, so a
  1080×1920 clip with a heavy filter chain says `~17s to export` rather than
  promising speed it doesn't have. Where WebCodecs is unavailable (plain
  `http://` on a non-localhost address) — or when the **Video In** scene is
  playing imported footage live — export falls back to **real-time**
  `MediaRecorder` capture: there a 10s clip takes ~10s and the tab should stay
  focused.
- The **File** picker offers **MP4 (H.264/AAC)** beside WebM. H.264 is a
  licensed codec some Chromium builds ship without; asking for MP4 there gets
  you a **WebM and a console line saying why**, and the library records the
  extension actually written. The campaign plays `.webm` natively.
- Audio export is **`.wav`/PCM** only (OfflineAudioContext renders faster than
  real-time); the WebCodecs Opus encoder is used only for the audio track muxed
  into video. No `.mp3`/`.ogg` encoder ships without a library.
- The library is **project state and it persists**. Row metadata (name, kind,
  gated, release beat) lives in the document and is autosaved; the bytes go to
  an IndexedDB asset store keyed per row and are re-attached on the next load,
  so a reload comes back with the assets *and* the naming intact. Where
  IndexedDB is unavailable (private windows) the studio falls back to memory
  and says so in the console. A row restored without its bytes keeps its
  metadata, is marked **no bytes**, and is refused by VALIDATE until it is
  re-rendered — the recipe is still the reproducible source of truth.
- Object URLs are tracked and revoked to avoid leaks.
- The library **▶ preview** plays/shows each asset **inline** (an in-page
  overlay) rather than opening a new tab — one preview at a time, Escape closes
  it, and no blob URL leaks into a tab the revoker can't reach.
- For exact `.mp3` parity (e.g. replacing a shipped `.mp3` in place), use
  `scripts/gen-campaign-media.py` (ffmpeg) — the one delivery format the studio
  still cannot write itself.

Verified in Chromium: page load, all 48 scenes + 46 templates render, image
import, **video-clip import** (record→re-import→Video-In→GIF round-trip), the
**multi-scene timeline** (add clips → preview → record one sequence `.webm`),
collapsible sections, **reset-to-defaults** (per section + per tab), **audio
layer flags + TIDY**, single-instance **audio Play/Stop** (an in-DOM element,
one at a time), the **Roll** effect, the audio FX bus, video WebM capture (works
headless), the frame-strip export, stego round-trip, the ZIP writer, and project
save/load (incl. timeline) — zero JS errors.

The inline **GIF encoder** is separately pinned by a dependency-free Node gate,
`node test-gif-encoder.mjs` (gate 1 of `scripts/ci-gate.sh`):
it encodes rich frames that cross the LZW code-size boundaries and decodes them
with an **independent** decoder, asserting a byte-exact round-trip — so the
"looks fine at the top, then corrupts" desync class can't regress.

## Tests

```bash
node test-gif-encoder.mjs      # GIF89a LZW byte-exactness (headless)
node test-studio-rng.mjs       # determinism contract (headless)
node test-studio-modules.mjs   # module graph imports (headless)
node test-studio-document.mjs  # project document: commands, undo, round-trip, migrations, muxers (headless)
node test-studio-a11y.mjs      # WCAG 2.1 AA sweep in Chromium (needs Playwright)
node test-studio-audit.mjs     # behaviour audit in Chromium — every control changes the output (needs Playwright)
node test-studio-smoke.mjs     # end-to-end in Chromium (needs Playwright)
node test-studio-deploy.mjs    # API discovery from any folder: subdirectory install, relocated studio folder, wizard note, explicit override (headless)
php  test-studio-units.php    # the backend: sharing rules, upload bounds, document guard, installer primitives (no database)
node test-studio-deep.mjs      # the deep audit in Chromium — every scene, template, filter, sound layer, automated parameter and audio FX ONE AT A TIME from the registries; canvas state hygiene; every control reachable at 8 window sizes in all 3 layouts; modal focus; document wiring (needs Playwright)
```

All ten run as `bash scripts/ci-gate.sh` (`--headless` skips the four Chromium
ones). The browser suites serve the folder on an ephemeral port, drive the UI
only, and skip cleanly when Playwright is unavailable — a machine with no
browser is not a failing build. `test-studio-modules.mjs` asserts in both
directions that the gate runs every suite the folder ships and that this list
names every gate, so a suite cannot be added and then quietly never run.

Two more suites need a live server + MySQL and are deliberately **not** in the
gate:

```bash
php -S 127.0.0.1:8090 router.php               # in another terminal

php  test-studio-api.php   http://127.0.0.1:8090
node test-studio-cloud.mjs http://127.0.0.1:8090
```

`test-studio-api.php` drives the API directly — real SQL, real auth, a real
multi-megabyte chunked upload — and creates then deletes its own accounts (pass
`name:password name2:password2` to run it against an install it cannot reach the
database of). `test-studio-cloud.mjs` drives the CLOUD tab in Chromium against
the same server; both skip cleanly when nothing is listening. The cloud suite
takes an optional second argument for the studio's path within the site, so it
runs against a subdirectory install with the folder moved:
`node test-studio-cloud.mjs http://host/sub /studio/index.html`.
