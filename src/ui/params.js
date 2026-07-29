/* Dead Signal Studio — ui/params.js
 *
 * One record per control: what it is called, what it actually does to the
 * picture or the sound, its unit, and how advanced it is.
 *
 * Three things read this and would otherwise each invent their own copy:
 *   - Explain mode (? then click any control)
 *   - the command palette's parameter search
 *   - the complexity filter (Simple / Studio / Deep)
 *
 * Levels: 1 Simple  — a first clip needs only these
 *         2 Studio  — everyday work (the default)
 *         3 Deep    — internals, formats, exact frame placement
 *
 * Entries are [label, level, explain, unit?]; expand() turns them into objects.
 */
import { layerParamHints } from './audiolayers.js';
import { batchParamHints } from './batch.js';
import { regionParamHints } from './regions.js';
import { soloParamHints } from './solo.js';
import { annotationParamHints } from './annotations.js';
import { galleryParamHints } from './gallery.js';
import { packParamHints } from './packs.js';

const PAN = 'Where this layer sits between the speakers. Left of centre for one signal and right for another is what turns a stack of sounds into a space rather than a wall.';

const P = {
  /* --------------------------------------------------------- macros ----- */
  'complexity': ['Detail level', 1, 'How many controls to show: Simple (the dozen that matter first), Studio (everyday work), or Deep (everything, including formats and exact frame placement). A view filter only — hidden settings still apply.'],
  'v-macro-grime': ['Grime', 1, 'One dial for the whole analogue-decay stack — scanlines, static, vignette, tracking, chroma and flicker together, along a curve that stays believable. The individual controls underneath stay live.', '%'],
  'v-macro-decay': ['Decay', 1, 'Generation loss: the look of a tape copied from a copy. Pushes the artefacts that compound with each dub rather than simply adding noise.', '%'],
  'a-macro-warmth': ['Warmth', 1, 'Tape character in one dial — wow and flutter, saturation, softer highs. Low is a well-kept machine; high is one left in a damp room for thirty years.', '%'],
  'a-macro-degrade': ['Degrade', 1, 'Damage rather than age: bit-crushing, band-limiting and a rising noise floor. Turns a clean render into something recovered from failing media.', '%'],

  'v-auto-param': ['Keyframe parameter', 2, 'Which setting the keyframe list below belongs to. A \u25c6 marks parameters that already have keys, with the count beside them.'],

  'a-sample':      ['Imported sample', 1, 'Plays a recording you import through the whole master FX bus, so real material can be degraded to match generated material. The other layers still stack on top of it.'],
  'a-samplefile':  ['Import audio', 1, 'Bring in a .wav, .mp3, .ogg or .flac. It is decoded once and resampled to the render rate, so changing the output rate does not change what you hear.'],
  'a-sample-g':    ['Sample level', 1, 'How loud the imported recording sits under everything else.', '%'],
  'a-sample-pan':  ['Sample pan', 2, 'Where the imported recording sits between the speakers.', 'L/R'],
  'a-sample-loop': ['Loop sample', 2, 'Repeat the recording to fill the render. With this off the render is extended to fit the whole clip instead, so importing something long does not silently truncate it.'],

  /* ---------------------------------------------------- audio stereo ---- */
  'a-channels':     ['Channels', 2, 'Stereo or mono. Stereo is the default — panning, drone spread and width all collapse to nothing in mono, so mono is the reduced case rather than the base. Mono halves the file, which matters for a long ambient loop.'],
  'a-drone-spread': ['Voice spread', 2, 'Fans the detuned drone voices across the stereo field, widest voices furthest out. This is what makes a pad sound like a room instead of a speaker. Needs more than one voice and some detune to do anything.', '%'],
  'a-drone-pan':    ['Drone pan', 2, PAN, 'L/R'],
  'a-noise-pan':    ['Noise pan', 2, PAN, 'L/R'],
  'a-pulse-pan':    ['Pulse pan', 2, PAN, 'L/R'],
  'a-morse-pan':    ['Morse pan', 2, PAN, 'L/R'],
  'a-sub-pan':      ['Sub-bass pan', 3, 'Where the sub sits. Usually leave this centred: very low frequencies carry almost no directional information, and panning them mostly just unbalances the level.', 'L/R'],
  'a-heart-pan':    ['Heartbeat pan', 2, PAN, 'L/R'],
  'a-geiger-pan':   ['Geiger pan', 2, PAN, 'L/R'],
  'a-dtmf-pan':     ['DTMF pan', 2, PAN, 'L/R'],
  'a-dial-pan':     ['Dial-up pan', 2, PAN, 'L/R'],
  'fx-width':       ['Stereo width', 2, 'Widens or narrows the finished mix by scaling only what the two channels disagree about, leaving anything centred exactly where it is.'],
  'fx-width-a':     ['Width amount', 2, '100 is untouched. Below that the image narrows, and 0 collapses to mono. Above it the sides are exaggerated — dramatic on headphones, and worth checking in mono afterwards, since pushing too far makes the sides cancel out on a single speaker.', '%'],

  /* ------------------------------------------------------- campaign ----- */
  'b-profile': ['Campaign profile', 2, 'Which campaign this bundle installs into. The profile supplies the release beats and the list of already-shipped asset names the validator warns about. Pick "Another campaign" when producing for anything other than this repo.'],
  'b-cname':   ['Campaign name', 2, 'Display name written into the bundle\u2019s INSTALL.txt. Leave empty to use the profile\u2019s own name.'],
  'b-cid':     ['Bundle id', 3, 'Slug used for the .zip filename. Leave empty to use the profile\u2019s id.'],
  'b-beats':   ['Release beats', 2, 'The beat identifiers this campaign can release media at, one per line. These are what your `call releaseMedia` lines get grouped under, so they must match the campaign script exactly. Leave empty to use the profile\u2019s beats.'],

  'contrast': ['Contrast', 1, "High contrast turns off the CRT scanline overlay and the phosphor glow in the tool's own interface, and raises text contrast. It does not touch what you render — your media looks exactly the same either way."],

  'ws-search': ['Browser filter', 1, 'Narrows the Browser list to matching scenes, templates, presets and actions. Workspace layout only.'],

  'v-flash': ['Flash rate', 1, 'Full-screen luminance changes per second in the live preview, measured the way WCAG 2.3.1 defines a flash. Above three per second the readout turns red: that clip may trigger seizures. It warns rather than blocks — the strobing is usually deliberate here.', '/s'],

  /* ---------------------------------------------------------- video ----- */
  'v-preset':   ['Preset', 1, 'A complete look in one pick. Fills every control below, so it is the fastest way to start — then change whatever you like.'],
  'v-srckey':   ['Footage', 1, 'Which imported clip the Video In scene plays. It travels with the clip you add, so one sequence can cut between different files — leave it on "the last file you loaded" to use whatever is in the tab.'],
  'v-scene':    ['Scene', 1, 'What the clip actually shows: a terminal, dead-air snow, a surveillance camera, digital rain. Everything else decorates this choice.'],
  'v-scrub':    ['Scrub', 1, 'Move through the clip without playing it. Use this to land exactly on a reveal or subliminal frame.'],
  'v-imgfile':  ['Import image', 2, 'Bring in your own still and run it through the whole CRT/VHS stack, or pan across it as a Ken Burns clip.'],
  'v-vidfile':  ['Import video', 2, 'Bring in your own footage. The Video In scene plays it through every effect here, so real material can be degraded to match generated material.'],

  'v-w':        ['Width', 2, 'Output width in pixels. Small frames read as older equipment — 320×240 is the classic degraded-broadcast size.', 'px'],
  'v-h':        ['Height', 2, 'Output height in pixels, up to 1920 — so a vertical clip can be a full 1080×1920. Pair with Aspect to keep a ratio while you change the other side.', 'px'],
  'v-fps':      ['Frame rate', 2, 'Frames per second. Low rates (8–12) feel like tape or a cheap security recorder; 24–30 feels modern.', 'fps'],
  'v-dur':      ['Duration', 1, 'How long the clip runs.', 's'],
  'v-audio':    ['Sound', 1, 'The audio track muxed into the exported clip. Pick the last AUDIO render, or any .wav in the library. A bed shorter than the clip loops; a longer one is trimmed. Leave it silent and the export behaves exactly as it always did.'],
  'v-apng': ['Export .apng', 2,
    'Lossless, 24-bit, with real alpha — every colour the picture actually has, and every level of transparency. Plays in every current browser, in iMessage and in Discord. Large; this is the archival one.'],
  'v-awebp': ['Export .webp', 2,
    'An animated WebP: 24-bit with real alpha, at a fraction of the size of either GIF or APNG. Plays in every current browser. This is the one to upload.'],
  'v-container': ['File', 1, 'The container the exported clip is written in. **WebM** plays in any browser and is the safe default. **MP4** is the one to hand to anything that is not a browser — a phone, an editor, an upload. A browser with no H.264 licence writes WebM and says so rather than failing.'],
  'tl-container': ['File', 1, 'The container the exported clip is written in. **WebM** plays in any browser and is the safe default. **MP4** is the one to hand to anything that is not a browser — a phone, an editor, an upload. A browser with no H.264 licence writes WebM and says so rather than failing.'],
  'v-format':   ['Format', 1, 'Sets the frame to a delivery size in one go. **Shorts / TikTok / Reels** is 1080×1920 — the vertical format those platforms expect. Picking one also sets Aspect to match; editing W or H afterwards puts this back to custom, because a label that has stopped describing the frame is worse than no label.'],
  'i-format':   ['Format', 1, 'Sets the frame to a delivery size in one go. **Shorts / TikTok / Reels** is 1080×1920 — the vertical format those platforms expect. Picking one also sets Aspect to match; editing W or H afterwards puts this back to custom, because a label that has stopped describing the frame is worse than no label.'],
  'tl-audio':    ['Sound', 1, 'The audio track muxed into the exported sequence — the last AUDIO render, or any .wav in the library. Shorter than the sequence loops; longer is trimmed.'],
  'tl-asrc':     ['Sound source', 1, 'Which sound ＋ SOUND puts on the audio lane. The lane is for sounds placed at a moment — a slam, a ring, a burst of static — over the sequence-wide bed above.'],
  'tl-stilldur': ['Still hold', 2, 'How long a screen is held when you add it with ＋ STILL. Editable per clip afterwards, like any other clip length.', 's'],
  'tl-format':  ['Format', 1, 'Sets the frame to a delivery size in one go. **Shorts / TikTok / Reels** is 1080×1920 — the vertical format those platforms expect. Picking one also sets Aspect to match; editing W or H afterwards puts this back to custom, because a label that has stopped describing the frame is worse than no label.'],
  'i-aspect':   ['Aspect', 2, 'Reshapes the frame you have, keeping the size you already chose and deriving the other side. 9:16 and 4:5 are the vertical shapes; use Format instead if you want the exact delivery resolution rather than just the shape.'],
  'tl-aspect':  ['Aspect', 2, 'Reshapes the frame you have, keeping the size you already chose and deriving the other side. 9:16 and 4:5 are the vertical shapes; use Format instead if you want the exact delivery resolution rather than just the shape.'],
  'v-aspect':   ['Aspect', 2, 'Reshapes the frame you have, keeping the size you already chose and deriving the other side. 4:3 for CRT-era, 16:9 for modern, 9:16 and 4:5 for vertical. Use Format instead when you want an exact delivery resolution rather than just the shape.'],
  'v-codec':    ['Codec', 3, 'Video encoder to record with. Auto picks the best your browser supports; only options your browser can actually produce are listed.'],
  'v-bitrate':  ['Bitrate', 3, 'Quality/size ceiling. Leave at 0 for automatic, or set a low value deliberately to bake in compression artefacts.', 'Mbps'],
  'v-ss':       ['Supersample', 3, 'Renders at double size then shrinks, smoothing jagged edges. Slower, and it slightly softens the deliberately harsh pixel look.'],
  'v-bg':       ['Background', 2, 'The colour behind everything — the unlit part of the screen.'],
  'v-fg':       ['Phosphor', 1, 'The glow colour: text, lines, most scene art. This single choice carries most of the era.'],
  'v-palette':  ['Palette', 1, 'Preset background/phosphor pairs from real hardware — P1 green, P3 amber, IBM 5151, C64.'],
  'v-filters-pick': ['Filter to add', 2, 'The filter the ＋ FILTER button appends to the chain. The chain runs after the CRT look above, top to bottom, so the ORDER is the setting that matters most: grading cold and then crushing the bit depth quantises the graded colours, while the other way round grades the already-crushed ones. Grouped by what they touch — Colour, Sharpness, Analogue, Pattern, Frame.'],
  'v-fade':     ['Fade', 2, 'Fades in from black at the start and out at the end.', 's'],
  'v-giffps':   ['Animation frame rate', 3, 'Frame rate for the .gif, .apng and .webp exports — not for the video ones. Lower means a smaller file and a choppier, more period-correct loop.', 'fps'],
  'v-frames':   ['Strip frames', 3, 'How many frames to lay out in the sprite-sheet export.'],
  'v-audioreact': ['Audio-reactive', 3, 'The scope scene traces the waveform of your last rendered audio clip instead of a synthetic one, so picture and sound genuinely match.'],

  'lock-v-text': ['Lock text', 2, 'Keeps this section untouched by Randomize AND by loading a preset — so you can try any look you like without losing wording a puzzle depends on.'],
  'lock-v-out': ['Lock output', 2, 'Keeps the frame size, rate, length and codec untouched by Randomize and by loading a preset. Lock it once you have settled on a delivery format.'],
  'v-fontfam': ['Typeface', 1, 'The family every glyph is drawn in. Monospace is the terminal look; Heavy is for posters and title cards; Handwritten is the note left on a door. System faces only — nothing is fetched.'],
  'v-wrap': ['Wrap lines', 2, 'Breaks a line too long for the frame instead of letting it run off the edge. Off by default so clips made before this existed render exactly as they did; your own line breaks are always kept.'],
  'v-text':     ['Text', 1, 'What appears on screen. Line breaks are kept. Macros like {{date}} and {{seed}} are substituted at render time.'],
  'v-textmode': ['Text mode', 1, 'How the text arrives: all at once, typed a character at a time, decoding out of noise, or scrolling upward.'],
  'v-font':     ['Font size', 2, 'Text size in pixels.', 'px'],
  'v-cps':      ['Text speed', 2, 'Characters per second for typewriter and decode modes; scroll speed for scrolling text.', 'cps'],
  'v-align':    ['Align', 2, 'Left-aligned reads as a terminal; centred reads as a title card or broadcast slate; right-aligned reads as a caption or a credit. The caret follows the text, so right-aligned type still ends in a cursor.'],
  'v-lspace':   ['Letterspace', 2, 'Letter-spacing, as a percentage of the type size — so it looks the same on a small caption and a large title. Wide tracking is the fastest way to make a title card look designed rather than typed; negative values tighten. Zero touches nothing at all, so an existing project is unchanged.'],
  'i-lspace':   ['Letterspace', 2, 'Letter-spacing, as a percentage of the type size. Applies to every string the template draws, the same way the typeface does. Zero touches nothing at all.'],
  'v-cursor':   ['Cursor', 2, 'Adds a blinking block cursor after the last line — the single cheapest cue that something is still running.'],
  'v-corrupt':  ['Corruption', 2, 'Replaces random glyphs with block characters during glitch moments, as if the character ROM is failing.', '%'],
  'v-fullwidth': ['Fullwidth', 2, 'Converts text to fullwidth forms (ＬＩＫＥ ＴＨＩＳ) — the signature vaporwave typographic move.'],

  'v-hud':      ['Status bar', 2, 'A strip across the top, like a camera or deck overlay. Try "CAM 47 // LAB-3   REC ●".'],
  'v-tc':       ['Timecode', 2, 'Burns a running clock into the corner, the way recording equipment does.'],
  'v-tcstart':  ['Timecode start', 2, 'What the clock reads at frame zero. An odd hour like 03:47 does a lot of narrative work for free.'],
  'v-morse':    ['Morse strip', 2, 'Draws a word as morse along the bottom edge — a hidden channel a viewer can decode.'],
  'v-blink':    ['Blink code', 2, 'Flashes the whole screen. A word flashes as morse; a number flashes that many times — for count-the-flashes puzzles.'],

  'v-scan':     ['Scanlines', 1, 'Dark horizontal lines, like a CRT. The most recognisable single "old screen" cue.', '%'],
  'v-noise':    ['Static', 1, 'Random speckle over the picture — analogue noise. Now animates properly frame to frame.', '%'],
  'v-vig':      ['Vignette', 2, 'Darkens the corners, as a curved tube and a cheap lens both do.', '%'],
  'v-flick':    ['Flicker', 2, 'Random brightness pulses, like an unstable supply or a failing tube.', '%'],
  'v-glitch':   ['Glitch', 2, 'Periodic tearing and coloured ghosting on the text — digital failure rather than analogue wear.', '%'],
  'v-chroma':   ['Chroma split', 2, 'Separates red and blue slightly, like a misconverged tube or bad cabling.', '%'],
  'v-bloom':    ['Bloom', 2, 'Bright areas smear light into their surroundings — phosphor glow.', '%'],
  'v-persist':  ['Persistence', 2, 'Each frame leaves a fading afterimage, like a slow phosphor. Turns motion into trails.', '%'],
  'v-mask':     ['Shadow mask', 3, 'The RGB stripe structure of a real tube, visible up close. Subtle at normal size, convincing when zoomed.', '%'],
  'v-hum':      ['Hum bar', 2, 'A soft brightness band rolling slowly up the picture — mains interference.', '%'],
  'v-track':    ['Tracking', 1, 'Horizontal tearing bands, like a misaligned tape head. The core VHS artefact.', '%'],
  'v-shake':    ['Shake', 2, 'Jitters and rotates the whole frame — handheld camera, or a deck that is struggling.', '%'],
  'v-roll':     ['Vertical hold', 2, 'The picture rolls upward and wraps, with a tear line — a mistuned CRT.', '%'],
  'v-dither':   ['Dither', 3, 'Reduces the image to two tones with an ordered pattern, the way early displays faked greys.'],

  'v-reveal':   ['Reveal', 2, 'Text held over the final frames, after everything else. The clip\'s punchline.'],
  'v-revhold':  ['Reveal hold', 2, 'How long the reveal stays up at the end.', 's'],
  'v-sub':      ['Subliminal', 2, 'Text flashed for one or two frames — invisible at speed, findable frame by frame.'],
  'v-subat':    ['Subliminal at', 3, 'When the flash happens. Leave at -1 to let the seed choose, so each seed hides it somewhere different.', 's'],
  'v-subframes': ['Subliminal frames', 3, 'How many frames the flash lasts. One is nearly impossible to catch; three is findable by scrubbing.'],

  /* ---------------------------------------------------------- audio ----- */
  'a-preset':   ['Preset', 1, 'A complete sound in one pick — drone, layers and effects all set.'],
  'a-dur':      ['Duration', 1, 'How long to render. Layers that need longer (morse, pulse counts) extend this automatically.', 's'],
  'a-sr':       ['Sample rate', 3, 'Samples per second. 22050 sounds period-correct and halves the file size; 44100 is CD quality.', 'Hz'],
  'a-bits':     ['Bit depth', 3, '8-bit adds audible quantisation grit; 16-bit is clean; 24-bit is archival.'],
  'a-fade':     ['Fade', 2, 'Fades the start and end so the clip does not click in or out.', 's'],
  'a-loop':     ['Seamless loop', 2, 'Crossfades the tail into the head so the clip can repeat forever with no seam. Use for room tone and drones.'],
  'a-autonorm': ['Auto-level', 1, 'Brings the render up to a consistent safe loudness automatically, so clips do not arrive wildly different.'],

  'a-drone':    ['Drone', 1, 'A sustained tone — the bed almost every uneasy soundscape sits on.'],
  'a-drone-f':  ['Drone pitch', 2, 'Low values (40–80) feel like machinery; higher values feel like tinnitus or a test tone.', 'Hz'],
  'a-drone-w':  ['Drone wave', 2, 'Sine is smooth and hollow; sawtooth is harsh and electrical; square is hollow and digital.'],
  'a-drone-g':  ['Drone level', 2, 'How loud the drone sits in the mix.', '%'],
  'a-drone-voices': ['Voices', 2, 'Stacks copies of the drone. More voices plus detune turns one tone into a choir.'],
  'a-drone-det': ['Detune', 2, 'Spreads the stacked voices apart in pitch. A little is warmth; a lot is seasickness.', 'cents'],

  'a-noise':    ['Noise', 1, 'Broadband hiss — tape, air, ventilation, dead radio.'],
  'a-noise-g':  ['Noise level', 2, 'How loud the hiss is.', '%'],
  'a-noise-lp': ['Noise tone', 2, 'Rolls off the highs. Low values sound like distant rumble through a wall; high values like open hiss.', 'Hz'],

  'a-pulse':    ['Pulse train', 2, 'Evenly spaced beeps. Made for count-the-pulses puzzles — the count is the message.'],
  'a-pulse-n':  ['Pulse count', 2, 'How many beeps. This is usually the number you want the player to write down.'],
  'a-pulse-f':  ['Pulse pitch', 2, 'Pitch of each beep.', 'Hz'],
  'a-pulse-rate': ['Pulse rate', 2, 'Beeps per second. Slower is easier to count and more ominous.', '/s'],

  'a-morse':    ['Morse', 2, 'Beeps a word in morse code — a hidden message a player can actually decode.'],
  'a-morse-w':  ['Morse word', 2, 'The word to encode. Short words are decodable by ear; long ones need a pencil.'],
  'a-morse-f':  ['Morse pitch', 3, 'Pitch of the morse tone.', 'Hz'],
  'a-morse-u':  ['Morse unit', 3, 'Length of one dot. Everything else scales from it, so this is the overall speed.', 's'],

  'a-sub':      ['Sub-bass', 2, 'A very low tone felt more than heard. Adds dread without occupying the mix.'],
  'a-sub-f':    ['Sub pitch', 3, 'How low. Below about 25 Hz most speakers reproduce nothing and only subwoofers deliver it.', 'Hz'],
  'a-heart':    ['Heartbeat', 2, 'A double thump. Instantly reads as a body, and as panic.'],
  'a-heart-bpm': ['Heart rate', 2, 'Beats per minute. 60 is calm, 120 is fear, 180 is a crisis.', 'bpm'],
  'a-geiger':   ['Geiger', 2, 'Random clicks at an average rate — radiation counter, or an unhealthy machine.'],
  'a-geiger-rate': ['Click rate', 2, 'Average clicks per second. Randomly spaced, so it never sounds mechanical.', '/s'],
  'a-dtmf':     ['DTMF dial', 2, 'Touch-tone dialling. The digits are audible to anyone who knows the tones.'],
  'a-dtmf-d':   ['Digits', 2, 'The number dialled. A phone number here is a genuine lead for a player.'],
  'a-dial':     ['Dial-up', 2, 'The full modem handshake — ring, tones, hiss, carrier. About six seconds of pure 1998.'],

  'fx-ring':    ['Ring modulation', 3, 'Multiplies the signal by a tone, producing metallic inharmonic sidebands. The classic possessed-voice effect.'],
  'fx-ring-f':  ['Ring frequency', 3, 'Low values wobble; high values turn everything to clangorous metal.', 'Hz'],
  'fx-trem':    ['Tremolo', 2, 'Regular volume pulsing.'],
  'fx-trem-f':  ['Tremolo rate', 2, 'How fast the volume pulses.', 'Hz'],
  'fx-wow':     ['Wow & flutter', 1, 'Slow and fast pitch drift, as if the tape transport is uneven. The single most convincing "this is a tape" cue.'],
  'fx-wow-d':   ['Wow depth', 2, 'How far the pitch wanders. A little is age; a lot is a dying machine.', '%'],
  'fx-dist':    ['Distortion', 2, 'Overdrives the signal — cheap amplification pushed too hard.'],
  'fx-dist-d':  ['Drive', 2, 'How hard it is pushed.', '%'],
  'fx-delay':   ['Delay', 2, 'Repeats the sound. Short delays sound like a room; long ones like a corridor.'],
  'fx-delay-t': ['Delay time', 2, 'Gap between repeats.', 's'],
  'fx-delay-fb': ['Feedback', 2, 'How much of each repeat feeds back in. High values trail off for a very long time.', '%'],
  'fx-reverb':  ['Reverb', 1, 'Puts the sound in a space. The fastest way to move a recording from "in your head" to "in a building".'],
  'fx-reverb-d': ['Decay', 2, 'How long the space rings on. Short is a room; long is a cathedral or a bunker.', 's'],
  'fx-phone':   ['Telephone', 2, 'Band-limits to a phone line — thin, mid-range, no bass or air.'],
  'fx-limit':   ['Limiter', 2, 'Catches peaks so the render does not clip. Sensible to leave on.'],
  'fx-crush':   ['Bitcrush', 2, 'Reduces resolution, adding digital grit. Early samplers and answering machines sounded like this.'],
  'fx-crush-b': ['Crush bits', 3, 'Fewer bits means more grit. Below about 6 it stops being a texture and becomes the sound.', 'bits'],

  /* ---------------------------------------------------------- image ----- */
  'i-preset':   ['Preset', 1, 'A finished screen in one pick.'],
  'i-tpl':      ['Template', 1, 'Which screen to draw: a blue-screen crash, a file explorer, a keycard, a redacted memo, a missing poster.'],
  'i-imgfile':  ['Import image', 2, 'Bring in your own picture and age it through the same effect stack.'],
  'i-w':        ['Width', 2, 'Output width in pixels.', 'px'],
  'i-h':        ['Height', 2, 'Output height in pixels.', 'px'],
  'i-scale':    ['Scale', 2, 'Exports at a multiple of the design size using hard pixel edges, so it stays crisp rather than blurry.'],
  'i-bg':       ['Background', 2, 'The colour behind everything.'],
  'i-fg':       ['Ink', 1, 'The colour of text and lines.'],
  'i-palette':  ['Palette', 1, 'Background/ink pairs from real hardware.'],
  'i-trans':    ['Transparent', 3, 'Skips the background so the export can be layered over something else.'],
  'i-title':    ['Title', 1, 'The heading, window title, or code on the screen.'],
  'i-body':     ['Body text', 1, 'The main content. Most templates read line by line; some use | to separate columns.'],
  'i-font':     ['Font size', 2, 'Text size in pixels.', 'px'],
  'i-extra':    ['Extra', 3, 'Template-specific: the icon on a dialog, the stamp on a document. Meaning depends on the template.'],
  'i-fontfam':  ['Typeface', 1, 'The family every glyph is drawn in. Serif for a memo, Handwritten for a note, Heavy for a poster. System faces only — nothing is fetched.'],
  'i-wrap':     ['Wrap lines', 2, 'Breaks a line too long for its box instead of letting it run off the edge. Applies to every template with a prose body — the BSODs, the dialog, the memo, the poster, the 404, the journal, the certificate and the rest. Templates that lay out a table, a hex dump or a column of menu items are deliberately left alone: breaking "ARCHIVE_0347.TAP|C:\\TAPES|14.2 MB" across two lines is not word wrap, it is damage. Off by default, so an existing project renders exactly as it did.'],
  'lock-i-text': ['Lock content', 2, 'Keeps the title, body and extra untouched by Randomize AND by loading a preset — try any template you like while your words stay put.'],
  'lock-i-out': ['Lock output', 2, 'Keeps the size, scale and colours untouched by Randomize and by loading a preset.'],
  'i-scan':     ['Scanlines', 1, 'CRT lines across the image.', '%'],
  'i-noise':    ['Static', 2, 'Speckled analogue noise.', '%'],
  'i-vig':      ['Vignette', 2, 'Darkened corners.', '%'],
  'i-chroma':   ['Chroma split', 2, 'Red/blue separation, like bad cabling.', '%'],
  'i-bloom':    ['Bloom', 2, 'Bright areas glow into their surroundings.', '%'],
  'i-dead':     ['Dead pixels', 3, 'Scatters stuck black and white pixels — a failing panel.', '%'],
  'i-copy':     ['Photocopy', 1, 'Crushes to harsh black and white with dropouts, like a document copied too many times.', '%'],
  'i-skew':     ['Skew', 2, 'Rotates slightly, as if scanned crookedly. A tiny amount is what sells a document as real.', '%'],
  'i-duotone':  ['Duotone', 2, 'Maps brightness onto a background-to-ink gradient — the two-colour poster look.'],
  'i-posterize': ['Posterize', 2, 'Reduces to a few brightness steps, flattening gradients into bands.', '%'],
  'i-halftone': ['Halftone', 2, 'Rebuilds the image from dots of varying size, like newsprint.', '%'],
  'i-pixsort':  ['Pixel sort', 2, 'Sorts runs of pixels by brightness, smearing the image into glitch streaks.', '%'],
  'i-stego':    ['Hidden message', 2, 'Buries text invisibly in the pixel values. Survives PNG export; JPEG destroys it.'],
  'i-invert':   ['Invert text', 2, 'Writes text at nearly the background colour — invisible until someone inverts the image.'],

  /* -------------------------------------------------------- timeline ---- */
  'tl-scrub':   ['Scrub', 1, 'Move through the whole sequence.'],
  'tl-w':       ['Width', 2, 'Output width for the joined sequence. Individual clips are resized to match.', 'px'],
  'tl-h':       ['Height', 2, 'Output height for the joined sequence.', 'px'],
  'tl-fps':     ['Frame rate', 2, 'Frame rate for the joined sequence.', 'fps'],
  'tl-xtype':   ['Transition', 1, 'How one clip becomes the next: a hard cut, a crossfade, or a dip through black.'],
  'tl-xdur':    ['Transition length', 2, 'How long the crossfade or dip takes. Zero is a hard cut.', 's'],
};

export const LEVELS = { 1: 'simple', 2: 'studio', 3: 'deep' };

function expand(table) {
  const out = {};
  for (const [id, v] of Object.entries(table)) {
    out[id] = { id, label: v[0], level: v[1], explain: v[2], unit: v[3] ?? null };
  }
  return out;
}

/* The registry audio layers document themselves: their hints live beside their
   definition in audio/layers.js rather than in a second table here that would
   drift the moment anyone added a layer. Merged in rather than written out, so
   a new layer needs no edit to this file at all. */
export const PARAMS = { ...expand(P), ...expand(layerParamHints()), ...expand(batchParamHints()), ...expand(regionParamHints()), ...expand(soloParamHints()), ...expand(annotationParamHints()), ...expand(galleryParamHints()), ...expand(packParamHints()) };

/** Every control the registry knows about. */
export const PARAM_IDS = Object.keys(PARAMS);

export function paramInfo(id) { return PARAMS[id] ?? null; }

/** Human-readable range from the live control, for Explain mode. */
export function rangeOf(el) {
  if (!el) return null;
  if (el.tagName === 'SELECT') return `${el.options.length} options`;
  if (el.type === 'checkbox') return 'on / off';
  if (el.min !== '' && el.max !== '') return `${el.min} to ${el.max}`;
  return null;
}
