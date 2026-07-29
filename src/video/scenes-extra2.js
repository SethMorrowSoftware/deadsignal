/* Dead Signal Studio — video/scenes-extra2.js
 *
 * A third shelf of scenes. Same registry, same contract as scenes.js and
 * scenes-extra.js; split only so no one file grows past reading.
 *
 * The house rules from scenes-extra.js apply unchanged, and are worth repeating
 * because every one of them was learned by shipping a scene that broke it:
 *
 *  - Fill your own background from cfg.bg. The layer compositor passes
 *    bg:'#000' so an additive blend can drop it; a scene that skips the fill
 *    inherits whatever the layer below drew.
 *  - Randomness goes through seedStream()/seedStatic(), never Math.random, or a
 *    scrubbed frame and an exported frame disagree.
 *  - seedStatic for anything that should hold still between frames (a layout);
 *    seedStream for anything that should churn (noise, flicker).
 *  - Draw something at every t, including t=0. A scene that is blank at the
 *    start fails the smoke gate, and rightly — an author who picks it sees a
 *    dead tool.
 *  - Author text arrives already macro-expanded (readVideoCfg does it once, for
 *    every scene). Calling macros() again on a hardcoded fallback string is
 *    correct and is a no-op on text that came from the box.
 */
import { clamp } from '../core/dom.js';
import { rint, rnd, rrange, seedStatic, seedStream } from '../core/rng.js';
import { glowText, macros, setFont } from '../core/text.js';
import { scene } from './scenes.js';

/** First line of the author's text, or a fallback. The label most scenes want. */
const line1 = (cfg, fallback) => (macros(cfg.text || '').split('\n')[0] || fallback).trim();
/** Every line, or the fallback's lines. For scenes that are a list of things. */
const lines = (cfg, fallback) => {
  const src = (macros(cfg.text || '').trim() || fallback);
  return src.split('\n');
};
const two = (n) => String(Math.floor(n)).padStart(2, '0');

export function registerExtraScenes2() {

  /* ------------------------------------------------- device furniture ---- */

  /* The on-screen display a VCR painted over the tape: transport state, a tape
     counter, and the blue "no tape" field when there is nothing to play. The
     counter is the detail that sells it — real ones counted tape, not time, so
     they ran at a rate that had nothing to do with seconds. */
  scene('vhsosd', 'VHS On-Screen Display', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    const s = Math.max(12, Math.min(W, H) * 0.075);
    setFont(ctx, s);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    // Blinking is what says "paused" rather than "stopped"; a steady glyph in
    // the corner reads as a watermark.
    const mode = line1(cfg, 'PLAY');
    const blink = mode.toUpperCase().startsWith('PAUSE') ? (Math.floor(t * 2) % 2 === 0) : true;
    const glyph = /REW/i.test(mode) ? '◀◀' : /FF|FWD/i.test(mode) ? '▶▶'
      : /PAUSE/i.test(mode) ? '❚❚' : /STOP/i.test(mode) ? '■' : /REC/i.test(mode) ? '●' : '▶';
    if (blink) glowText(ctx, glyph + '  ' + mode.toUpperCase(), s * 0.8, s * 0.8, cfg.fg, 6);
    // Tape counter: four digits at a rate that is not seconds, because it never was.
    const c = Math.floor(t * 37) % 10000;
    ctx.textAlign = 'right';
    glowText(ctx, String(c).padStart(4, '0'), W - s * 0.8, s * 0.8, cfg.fg, 6);
    setFont(ctx, s * 0.62);
    glowText(ctx, 'SP  ' + two((t / 60) % 60) + ':' + two(t % 60), W - s * 0.8, s * 2.3, cfg.fg, 4);
    ctx.textAlign = 'left';
    const rest = lines(cfg, 'PLAY').slice(1);
    let y = H - s * (rest.length + 1);
    for (const l of rest) { glowText(ctx, l, s * 0.8, y, cfg.fg, 4); y += s; }
  });

  /* Teletext: a 40×25 character grid, seven saturated colours, double-height
     headers, and a page number that cycles while it "searches". The grid is the
     whole identity — anti-aliased text at an arbitrary size is just text. */
  const TTX = ['#000000', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'];
  scene('teletext', 'Teletext Page', (ctx, W, H, cfg, t) => {
    // cfg.bg, not a hardcoded black. Real teletext is black and the default bg
    // is dark, so it looks the same — but the layer compositor passes its own
    // background in, and a scene that ignores it cannot be layered.
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    const cols = 40, rows = 25;
    const cw = W / cols, ch = H / rows;
    setFont(ctx, ch * 0.92);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const put = (text, col, row, colour, bg) => {
      if (bg) { ctx.fillStyle = bg; ctx.fillRect(col * cw, row * ch, text.length * cw, ch); }
      ctx.fillStyle = colour;
      for (let i = 0; i < text.length; i++) ctx.fillText(text[i], (col + i) * cw, row * ch);
    };
    // The header row is always there, always cyan on blue, page number churning.
    const page = 100 + (Math.floor(t * 6) % 800);
    put('P' + page + '  EREBUS', 0, 0, TTX[6], TTX[4]);
    put(two((t / 60) % 24) + ':' + two(t % 60), 33, 0, TTX[7], TTX[4]);
    const body = lines(cfg, 'ARCHIVE BULLETIN\n\nSTATION 47 OFF AIR\nSIGNAL LAST SEEN 03:47\n\nPRESS REVEAL FOR MORE');
    let row = 2;
    for (let i = 0; i < body.length && row < rows; i++, row++) {
      const l = body[i].slice(0, cols);
      // First line double-height in yellow, the way a real page titles itself.
      if (i === 0) {
        setFont(ctx, ch * 1.85);
        ctx.fillStyle = TTX[3];
        ctx.fillText(l, 0, row * ch);
        setFont(ctx, ch * 0.92);
        row++;
      } else {
        put(l, 0, row, TTX[(i % 6) + 1]);
      }
    }
    // Coloured fastext bar along the bottom — the four buttons on the remote.
    const labels = ['INDEX', 'NEWS', 'ARCHIVE', 'EXIT'];
    for (let i = 0; i < 4; i++) put(labels[i].padEnd(10).slice(0, 10), i * 10, rows - 1, TTX[[1, 2, 3, 6][i]]);
  });

  /* Split-flap board. The flaps have to land in sequence, left to right — every
     character resolving at once is a fade, not a board. */
  const FLAP = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:.-/';
  scene('splitflap', 'Split-Flap Board', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    const rowsText = lines(cfg, 'ARCHIVE  0347  ON TIME\nLAB 3    0412  DELAYED\nSITE B   0447  CANCELLED\nSTATION  ----  ---');
    const n = Math.min(8, rowsText.length);
    const rh = H / (n + 1.6);
    const cw = Math.max(6, rh * 0.62);
    const cols = Math.floor((W - rh * 0.6) / cw);
    setFont(ctx, rh * 0.72);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    glowText(ctx, line1({ text: '' }, 'DEPARTURES'), W / 2, rh * 0.55, cfg.fg, 6);
    seedStatic('splitflap');
    for (let r = 0; r < n; r++) {
      const target = rowsText[r].toUpperCase();
      const y = rh * (r + 1.5);
      for (let c = 0; c < cols; c++) {
        const want = target[c] || ' ';
        // Each cell settles at its own moment; the offset makes the wave.
        const settle = 0.35 + c * 0.045 + r * 0.12;
        const ch = t >= settle ? want
          : FLAP[Math.floor((t * 26 + c * 3 + r * 7)) % FLAP.length];
        ctx.fillStyle = '#0d0f12';
        ctx.fillRect(rh * 0.3 + c * cw, y - rh * 0.36, cw - 1, rh * 0.72);
        ctx.fillStyle = cfg.fg;
        ctx.fillText(ch, rh * 0.3 + c * cw + cw / 2, y);
        // The seam across the middle of every flap.
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fillRect(rh * 0.3 + c * cw, y - 1, cw - 1, 1.5);
      }
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  });

  /* Sonar. Radar already exists and sweeps a line over blips; sonar is the
     concentric-ping version — a ring expanding from the centre, contacts
     lighting as it passes them and fading behind it. */
  scene('sonar', 'Sonar', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.46;
    ctx.strokeStyle = cfg.fg;
    ctx.globalAlpha = 0.25;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath(); ctx.arc(cx, cy, R * i / 4, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    ctx.globalAlpha = 1;
    // One ping per 2.4s, expanding outward.
    const period = 2.4;
    const ping = (t % period) / period;
    ctx.globalAlpha = 1 - ping;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, R * ping, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1;
    seedStatic('sonar');
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2, d = 0.2 + rnd() * 0.78;
      // A contact is lit by the ring passing it and decays behind — so its
      // brightness is a function of how long ago the ring crossed it.
      const age = ping - d;
      if (age < 0) continue;
      const glow = Math.max(0, 1 - age * 3.2);
      if (glow <= 0.02) continue;
      ctx.globalAlpha = glow;
      ctx.fillStyle = cfg.fg;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * R * d, cy + Math.sin(a) * R * d, Math.max(2, R * 0.022), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    setFont(ctx, Math.max(10, H * 0.045));
    ctx.textBaseline = 'top';
    glowText(ctx, line1(cfg, 'PASSIVE // 47 fathoms'), 8, 8, cfg.fg, 4);
  });

  /* Keypad. The scene is the WRONG code being entered — a puzzle prop, so the
     digits fill, the pad rejects, and it resets. Held on ACCESS DENIED at the
     end rather than looping, because a clip that never resolves is unusable. */
  scene('keypad', 'Keypad / Access', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    const code = line1(cfg, '0347');
    const pad = Math.min(W, H) * 0.62;
    const px = (W - pad) / 2, py = (H - pad) / 2 + pad * 0.08;
    const cell = pad / 3;
    // 0.35s per keypress, then a beat, then the verdict.
    const typed = Math.min(code.length, Math.floor(t / 0.35));
    const done = t > code.length * 0.35 + 0.5;
    const denied = done && t > code.length * 0.35 + 0.8;
    setFont(ctx, Math.max(14, pad * 0.16));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // Display strip above the pad.
    ctx.strokeStyle = cfg.fg; ctx.globalAlpha = 0.6;
    ctx.strokeRect(px, py - pad * 0.30, pad, pad * 0.2);
    ctx.globalAlpha = 1;
    const shown = '*'.repeat(typed) + (typed < code.length && Math.floor(t * 3) % 2 ? '_' : '');
    glowText(ctx, shown || '_', W / 2, py - pad * 0.20, cfg.fg, 6);
    setFont(ctx, Math.max(11, cell * 0.34));
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
    for (let i = 0; i < 12; i++) {
      const r = Math.floor(i / 3), c = i % 3;
      const x = px + c * cell, y = py + r * (cell * 0.82);
      // The key that is being pressed right now lights up.
      const pressed = typed > 0 && !done && keys[i] === code[typed - 1] && (t % 0.35) < 0.18;
      ctx.globalAlpha = pressed ? 1 : 0.42;
      ctx.strokeStyle = cfg.fg;
      ctx.strokeRect(x + cell * 0.08, y + cell * 0.06, cell * 0.84, cell * 0.66);
      ctx.globalAlpha = 1;
      glowText(ctx, keys[i], x + cell * 0.5, y + cell * 0.39, cfg.fg, pressed ? 8 : 0);
    }
    if (denied) {
      setFont(ctx, Math.max(16, pad * 0.15));
      ctx.fillStyle = 'rgba(0,0,0,.72)';
      ctx.fillRect(0, H / 2 - pad * 0.12, W, pad * 0.24);
      glowText(ctx, 'ACCESS DENIED', W / 2, H / 2, '#ff3b4e', 12);
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  });

  /* Elevator indicator: a floor readout, a direction arrow and a chime flash.
     Counts DOWN by default — going up is a lobby, going down is a basement, and
     only one of those is a horror beat. */
  scene('elevator', 'Elevator Indicator', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    const floors = lines(cfg, '4\n3\n2\n1\nB\nSB').map((s) => s.trim()).filter(Boolean);
    const per = 1.6;
    const idx = Math.min(floors.length - 1, Math.floor(t / per));
    const moving = (t % per) < per * 0.72 && idx < floors.length - 1;
    const s = Math.min(W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    setFont(ctx, s * 0.38);
    glowText(ctx, floors[idx], W / 2, H * 0.5, cfg.fg, 14);
    setFont(ctx, s * 0.12);
    // The arrow blinks while moving and goes out on arrival, then the chime.
    if (moving && Math.floor(t * 4) % 2 === 0) glowText(ctx, '▼', W / 2, H * 0.2, cfg.fg, 10);
    if (!moving) {
      ctx.globalAlpha = Math.max(0, 1 - ((t % per) - per * 0.72) * 4);
      glowText(ctx, '● ' + macros('DING'), W / 2, H * 0.82, cfg.fg, 10);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  });

  /* Dashcam: a road-facing frame with a burned-in GPS/speed/heading strip. The
     strip is the point — the picture behind it is deliberately sparse, because
     this is furniture to composite over imported footage as a layer. */
  scene('dashcam', 'Dashcam Overlay', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    // A road that recedes, so the scene reads on its own as well as over video.
    ctx.strokeStyle = cfg.fg; ctx.globalAlpha = 0.22;
    const hz = H * 0.55;
    ctx.beginPath(); ctx.moveTo(0, hz); ctx.lineTo(W, hz); ctx.stroke();
    for (let i = -6; i <= 6; i++) {
      ctx.beginPath(); ctx.moveTo(W / 2 + i * W * 0.09, hz); ctx.lineTo(W / 2 + i * W * 0.55, H); ctx.stroke();
    }
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 8; i++) {
      const u = ((t * 0.55 + i / 8) % 1);
      const y = hz + (H - hz) * u * u;
      const w = 2 + u * W * 0.03;
      ctx.fillStyle = cfg.fg;
      ctx.fillRect(W / 2 - w / 2, y, w, Math.max(1, (H - hz) * u * 0.06));
    }
    ctx.globalAlpha = 1;
    const s = Math.max(10, H * 0.05);
    setFont(ctx, s);
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(0, 0, W, s * 1.5);
    ctx.fillRect(0, H - s * 1.5, W, s * 1.5);
    const label = line1(cfg, 'UNIT 47');
    glowText(ctx, label + '   ' + two((t / 60) % 24) + ':' + two(t % 60) + ':' + two((t * 100) % 100), 8, s * 0.25, cfg.fg, 3);
    // Coordinates drift rather than jump: a GPS that teleports reads as fake.
    const lat = 47.0347 + Math.sin(t * 0.13) * 0.004;
    const lon = -122.4712 + Math.cos(t * 0.11) * 0.004;
    ctx.textAlign = 'right';
    glowText(ctx, `${lat.toFixed(4)}N ${Math.abs(lon).toFixed(4)}W`, W - 8, s * 0.25, cfg.fg, 3);
    ctx.textAlign = 'left';
    const kph = 40 + Math.sin(t * 0.7) * 18;
    glowText(ctx, `${Math.round(kph)} km/h   HDG ${Math.round((t * 9) % 360).toString().padStart(3, '0')}°`, 8, H - s * 1.2, cfg.fg, 3);
  });

  /* Satellite tracking: a ground track crawling over a graticule. The pass is
     a sine over longitude, which is what a real inclined orbit's ground track
     looks like on a flat projection. */
  scene('satellite', 'Satellite Tracking', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = cfg.fg;
    ctx.globalAlpha = 0.18;
    for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(W * i / 8, 0); ctx.lineTo(W * i / 8, H); ctx.stroke(); }
    for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(0, H * i / 5); ctx.lineTo(W, H * i / 5); ctx.stroke(); }
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    const track = (u) => [u * W, H / 2 - Math.sin(u * Math.PI * 2) * H * 0.32];
    for (let i = 0; i <= 120; i++) {
      const [x, y] = track(i / 120);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    const u = (t * 0.13) % 1;
    const [x, y] = track(u);
    ctx.fillStyle = cfg.fg;
    ctx.beginPath(); ctx.arc(x, y, Math.max(3, H * 0.02), 0, Math.PI * 2); ctx.fill();
    // Footprint circle, pulsing — the area currently in view of the bird.
    ctx.globalAlpha = 0.35 + Math.sin(t * 3) * 0.12;
    ctx.beginPath(); ctx.arc(x, y, Math.max(10, H * 0.11), 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    setFont(ctx, Math.max(10, H * 0.05));
    ctx.textBaseline = 'top';
    glowText(ctx, line1(cfg, 'EREBUS-1  ACQ'), 8, 8, cfg.fg, 4);
    glowText(ctx, `AZ ${Math.round(u * 360).toString().padStart(3, '0')}  EL ${Math.round(Math.abs(Math.sin(u * Math.PI * 2)) * 84).toString().padStart(2, '0')}`,
      8, H - Math.max(10, H * 0.05) * 1.6, cfg.fg, 4);
  });

  /* IRC log. Lines arrive one at a time and scroll up; a nick colour is derived
     from the nick so the same person is the same colour every time — which is
     the thing that makes a chat log skimmable and a fake one convincing. */
  const NICK_COLOURS = ['#7fd4ff', '#ffd27f', '#a0ff9e', '#ff9ecb', '#c9a0ff', '#ffb37f'];
  scene('irc', 'IRC / Chat Log', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    const s = Math.max(9, cfg.font * 0.8);
    setFont(ctx, s);
    ctx.textBaseline = 'top';
    const log = lines(cfg, '@op|*** Now talking in #erebus\nwebb|is anyone still on this channel\nwebb|the archive answered me\nghost_47|we know\nghost_47|it has been answering for a while\nwebb|what do you mean a while\n@op|*** ghost_47 has quit (Ping timeout)');
    const per = 0.9;
    const shown = Math.min(log.length, Math.floor(t / per) + 1);
    const rows = Math.floor((H - s * 3) / (s * 1.45));
    const from = Math.max(0, shown - rows);
    // Header bar, because a chat window without one reads as a text file.
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.fillRect(0, 0, W, s * 1.7);
    glowText(ctx, '#erebus  ·  ' + shown + ' users', 8, s * 0.35, cfg.fg, 2);
    let y = s * 2.2;
    for (let i = from; i < shown; i++) {
      const [nick, ...rest] = log[i].split('|');
      const msg = rest.join('|') || nick;
      const isSys = nick.startsWith('@') || !rest.length;
      if (isSys) {
        ctx.globalAlpha = 0.55;
        glowText(ctx, msg, 8, y, cfg.fg, 0);
        ctx.globalAlpha = 1;
      } else {
        let h = 0;
        for (let k = 0; k < nick.length; k++) h = (h * 31 + nick.charCodeAt(k)) >>> 0;
        const c = NICK_COLOURS[h % NICK_COLOURS.length];
        const tag = '<' + nick + '> ';
        ctx.fillStyle = c;
        ctx.fillText(tag, 8, y);
        glowText(ctx, msg, 8 + ctx.measureText(tag).width, y, cfg.fg, 2);
      }
      y += s * 1.45;
    }
    // Input line with a caret, so the window looks live rather than captured.
    ctx.globalAlpha = 0.5;
    glowText(ctx, '[#erebus] ' + (Math.floor(t * 2) % 2 ? '_' : ''), 8, H - s * 1.5, cfg.fg, 0);
    ctx.globalAlpha = 1;
  });

  /* Kernel panic. A wall of text that stops — the machine is not coming back,
     so nothing after the dump animates except the cursor. */
  scene('panic', 'Kernel Panic', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    const s = Math.max(8, cfg.font * 0.72);
    setFont(ctx, s);
    ctx.textBaseline = 'top';
    const head = lines(cfg, 'Kernel panic - not syncing: Attempted to kill init!');
    const body = [
      '', 'CPU: 0 PID: 1 Comm: init Not tainted 0.47.0-erebus',
      'Hardware name: ARCHIVE SYSTEMS/WEBB, BIOS v0.47 03/47/97', '',
      'Call Trace:',
      ' [<c0347000>] panic+0x47/0x1a0',
      ' [<c0347b40>] do_exit+0x7f0/0x800',
      ' [<c03470a4>] archive_listen+0x0/0x47',
      ' [<c0347f47>] observe+0x47/0x47', '',
      '---[ end Kernel panic - not syncing ]---',
    ];
    const all = head.concat(body);
    // Typed out at 24 lines/second, then held. A panic that keeps scrolling
    // forever is a log; one that stops is a dead machine.
    const shown = Math.min(all.length, Math.floor(t * 24) + 1);
    let y = s;
    for (let i = 0; i < shown; i++) { glowText(ctx, all[i], 8, y, cfg.fg, 2); y += s * 1.35; }
    if (shown >= all.length && Math.floor(t * 2) % 2) {
      ctx.fillStyle = cfg.fg;
      ctx.fillRect(8, y, s * 0.55, s);
    }
  });

  /* Sign-off card: the test card and the closing announcement a station left up
     before the transmitter went off. Fades to black at the end of the clip, so
     it works as the LAST clip of a sequence without any extra editing. */
  scene('signoff', 'Station Sign-Off', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H * 0.42, R = Math.min(W, H) * 0.3;
    ctx.strokeStyle = cfg.fg;
    ctx.globalAlpha = 0.8;
    for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.arc(cx, cy, R * i / 3, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    // Greyscale step wedge under the circle — the other half of a test card.
    const steps = 8, wW = R * 1.6, wH = R * 0.22;
    for (let i = 0; i < steps; i++) {
      const v = Math.round((i / (steps - 1)) * 255);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(cx - wW / 2 + (wW / steps) * i, cy + R * 0.42, wW / steps + 1, wH);
    }
    ctx.globalAlpha = 1;
    setFont(ctx, Math.max(12, H * 0.07));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    glowText(ctx, line1(cfg, 'END OF TRANSMISSION'), cx, H * 0.86, cfg.fg, 8);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    // The last second of the clip fades out, so it ends rather than cuts.
    const fade = Math.max(0, (t - (cfg.duration - 1)) / 1);
    if (fade > 0) { ctx.fillStyle = `rgba(0,0,0,${Math.min(1, fade)})`; ctx.fillRect(0, 0, W, H); }
  });

  /* ------------------------------------------------------ screensavers --- */

  /* Bouncing logo. Everyone is waiting for the corner, so the corner has to be
     reachable — the velocity is chosen to actually hit one rather than to look
     plausible, and the box flashes when it does. */
  scene('bounce', 'Bouncing Logo', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    const label = line1(cfg, 'EREBUS');
    setFont(ctx, Math.max(14, cfg.font * 1.4));
    const tw = ctx.measureText(label).width + 18, th = Math.max(14, cfg.font * 1.4) * 1.5;
    const spanX = Math.max(1, W - tw), spanY = Math.max(1, H - th);
    // Triangle wave per axis: position folds back at each wall, which is what
    // a bounce IS — no per-frame velocity state, so it stays a pure function.
    const fold = (v, span) => { const m = v % (2 * span); return m < span ? m : 2 * span - m; };
    const x = fold(t * 92, spanX), y = fold(t * 71, spanY);
    const corner = (x < 2 || x > spanX - 2) && (y < 2 || y > spanY - 2);
    // Colour changes on each wall hit, addressed by how many hits have happened.
    const hits = Math.floor((t * 92) / spanX) + Math.floor((t * 71) / spanY);
    const hue = (hits * 47) % 360;
    ctx.fillStyle = corner ? '#fff' : `hsl(${hue} 90% 62%)`;
    ctx.fillRect(x, y, tw, th);
    ctx.fillStyle = corner ? '#000' : cfg.bg;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(label, x + tw / 2, y + th / 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  });

  /* Pipes. The 3D screensaver, flattened: segments grow along a grid, turning
     at random, with a joint at every turn. Seeded once so the path is the same
     every frame and only its LENGTH depends on t — otherwise the whole run
     re-rolls sixty times a second and reads as noise. */
  scene('pipes', 'Pipes', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    const grid = Math.max(10, Math.min(W, H) / 14);
    seedStatic('pipes');
    const cols = Math.floor(W / grid), rows = Math.floor(H / grid);
    let x = Math.floor(cols / 2), y = Math.floor(rows / 2);
    let dir = rint(0, 3);
    const total = Math.min(420, Math.floor(t * 26));
    ctx.lineCap = 'round';
    ctx.lineWidth = grid * 0.42;
    for (let i = 0; i < total; i++) {
      if (rnd() < 0.28) dir = (dir + (rnd() < 0.5 ? 1 : 3)) % 4;
      const nx = x + (dir === 0 ? 1 : dir === 2 ? -1 : 0);
      const ny = y + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) { dir = (dir + 2) % 4; continue; }
      ctx.strokeStyle = `hsl(${(i * 7) % 360} 72% 58%)`;
      ctx.beginPath();
      ctx.moveTo((x + 0.5) * grid, (y + 0.5) * grid);
      ctx.lineTo((nx + 0.5) * grid, (ny + 0.5) * grid);
      ctx.stroke();
      x = nx; y = ny;
    }
    // The head, so the eye knows where it is growing.
    ctx.fillStyle = cfg.fg;
    ctx.beginPath(); ctx.arc((x + 0.5) * grid, (y + 0.5) * grid, grid * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1; ctx.lineCap = 'butt';
  });

  /* Mystify: two polygons whose vertices drift and bounce, with a trail of
     previous positions behind them. The trail is drawn by evaluating the SAME
     function at earlier times — no history buffer, so it stays scrubbable. */
  scene('mystify', 'Mystify', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    seedStatic('mystify');
    const shapes = 2, verts = 4, TRAIL = 12;
    const seeds = [];
    for (let s = 0; s < shapes; s++) {
      for (let v = 0; v < verts; v++) {
        seeds.push({ px: rnd(), py: rnd(), sx: rrange(0.05, 0.16) * (rnd() < 0.5 ? -1 : 1),
                     sy: rrange(0.05, 0.16) * (rnd() < 0.5 ? -1 : 1), hue: 0 });
      }
    }
    const fold = (v) => { const m = Math.abs(v) % 2; return m < 1 ? m : 2 - m; };
    ctx.lineWidth = 1.5;
    for (let k = TRAIL - 1; k >= 0; k--) {
      const tt = t - k * 0.09;
      if (tt < 0) continue;
      for (let s = 0; s < shapes; s++) {
        ctx.globalAlpha = (1 - k / TRAIL) * 0.75;
        ctx.strokeStyle = `hsl(${(s * 140 + tt * 40) % 360} 85% 62%)`;
        ctx.beginPath();
        for (let v = 0; v < verts; v++) {
          const p = seeds[s * verts + v];
          const x = fold(p.px + p.sx * tt) * W, y = fold(p.py + p.sy * tt) * H;
          v ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
  });

  /* Demoscene sine scroller over copper bars. Both halves are the point: the
     bars are horizontal colour ramps sweeping vertically, the text rides a sine
     and is spaced per character so it undulates rather than sliding as a block. */
  scene('scroller', 'Sine Scroller', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y++) {
      const u = (y / H) * 6 + t * 0.9;
      const v = (Math.sin(u * Math.PI) + 1) / 2;
      if (v < 0.55) continue;
      const k = (v - 0.55) / 0.45;
      ctx.fillStyle = `hsl(${(y * 0.6 + t * 60) % 360} 88% ${28 + k * 34}%)`;
      ctx.fillRect(0, y, W, 1);
    }
    const msg = '   ' + line1(cfg, 'GREETINGS FROM THE ARCHIVE ... 47 ... STILL LISTENING ...').toUpperCase() + '   ';
    const s = Math.max(16, H * 0.16);
    setFont(ctx, s);
    ctx.textBaseline = 'middle';
    const speed = s * 7;
    let x = W - (t * speed) % (ctx.measureText(msg).width + W);
    for (const ch of msg) {
      const cw = ctx.measureText(ch).width;
      if (x > -cw && x < W) {
        const y = H / 2 + Math.sin(x / W * Math.PI * 3 + t * 3) * H * 0.22;
        ctx.fillStyle = '#000';
        ctx.fillText(ch, x + 2, y + 2);
        glowText(ctx, ch, x, y, cfg.fg, 8);
      }
      x += cw;
    }
    ctx.textBaseline = 'top';
  });

  /* Vitals. The Patient Monitor SCREEN template is a still; this is the moving
     one — a trace that sweeps and wraps, with the numbers drifting. */
  scene('vitals', 'Vitals Monitor', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    const rows = 3, rh = H / (rows + 0.9);
    const bpm = 78 + Math.sin(t * 0.4) * 6;
    const traces = [
      { name: 'ECG', colour: '#5dff9e', hz: bpm / 60, kind: 'ecg' },
      { name: 'SpO2', colour: '#5db9ff', hz: bpm / 60, kind: 'pleth' },
      { name: 'RESP', colour: '#ffd45d', hz: 0.28, kind: 'sine' },
    ];
    const sweep = (t * 0.42) % 1;
    setFont(ctx, Math.max(9, rh * 0.16));
    ctx.textBaseline = 'top';
    for (let r = 0; r < rows; r++) {
      const tr = traces[r], y0 = rh * (r + 0.4), mid = y0 + rh * 0.42;
      ctx.strokeStyle = tr.colour;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      for (let px = 0; px < W; px++) {
        const u = px / W;
        // Everything right of the sweep is the PREVIOUS pass; a monitor
        // overwrites rather than scrolls, and the gap at the head is the tell.
        const lap = u <= sweep ? 0 : -1;
        const tt = t + (u - sweep + lap) / 0.42;
        let v = 0;
        const ph = (tt * tr.hz) % 1;
        if (tr.kind === 'ecg') {
          v = ph < 0.06 ? -0.15 : ph < 0.10 ? 0.95 : ph < 0.14 ? -0.4
            : ph < 0.30 ? 0.12 * Math.sin((ph - 0.14) / 0.16 * Math.PI) : 0;
        } else if (tr.kind === 'pleth') {
          v = Math.max(0, Math.sin(ph * Math.PI * 2)) * 0.8 - Math.max(0, Math.sin((ph - 0.12) * Math.PI * 2)) * 0.25;
        } else v = Math.sin(ph * Math.PI * 2) * 0.7;
        if (Math.abs(u - sweep) < 0.012) { ctx.stroke(); ctx.beginPath(); continue; }
        const y = mid - v * rh * 0.36;
        px ? ctx.lineTo(px, y) : ctx.moveTo(px, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = tr.colour;
      ctx.fillText(tr.name, 6, y0 - rh * 0.06);
      ctx.textAlign = 'right';
      const num = r === 0 ? Math.round(bpm) : r === 1 ? Math.round(97 + Math.sin(t * 0.6) * 1.4) : Math.round(14 + Math.sin(t * 0.3) * 2);
      setFont(ctx, Math.max(13, rh * 0.34));
      ctx.fillText(String(num), W - 6, y0 + rh * 0.02);
      setFont(ctx, Math.max(9, rh * 0.16));
      ctx.textAlign = 'left';
    }
    glowText(ctx, line1(cfg, 'BED 47  ·  WEBB, M.'), 6, H - rh * 0.34, cfg.fg, 3);
  });
}

/** Ids registered by this file — used by the tests to prove none went missing. */
export const EXTRA2_SCENE_IDS = [
  'vhsosd', 'teletext', 'splitflap', 'sonar', 'keypad', 'elevator', 'dashcam',
  'satellite', 'irc', 'panic', 'signoff', 'bounce', 'pipes', 'mystify',
  'scroller', 'vitals',
];
