/* Dead Signal Studio — video/scenes-extra.js
 *
 * A second shelf of scenes. Split from scenes.js purely so that file stays
 * readable — these register into the same SCENES registry and are identical in
 * every other respect.
 *
 * House rules for a scene, learned the hard way:
 *  - Fill your own background from cfg.bg. Most scenes do, and the layer
 *    compositor relies on it (it passes bg:'#000' so an additive blend drops
 *    the background).
 *  - Randomness goes through seedStream()/seedStatic(), never Math.random, or
 *    a scrubbed frame and an exported frame disagree.
 *  - Anything that should hold still between frames uses seedStatic (a fixed
 *    layout); anything that should churn uses seedStream (re-rolled per frame).
 *  - Draw something at every t. A scene that is blank at t=0 fails the smoke
 *    gate, and rightly: an author who picks it sees a dead tool.
 */
import { clamp } from '../core/dom.js';
import { rint, rnd, rrange, seedStatic, seedStream } from '../core/rng.js';
import { glowText, macros, setFont } from '../core/text.js';
import { scene } from './scenes.js';
import { registerExtraScenes2 } from './scenes-extra2.js';

/** Register every scene in this file. Called once, before the pickers fill. */
export function registerExtraScenes() {

  scene('starfield', 'Starfield / Warp', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    // Fixed star directions, animated depth: the layout must not re-roll each
    // frame or the field boils instead of flying.
    seedStatic('starfield');
    const n = 140, cx = W / 2, cy = H / 2;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const speed = 0.35 + rnd() * 1.1;
      const phase = rnd();
      const z = ((t * speed * 0.28 + phase) % 1);
      const r = z * z * Math.max(W, H) * 0.75;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (x < -8 || x > W + 8 || y < -8 || y > H + 8) continue;
      const len = z * 14;
      ctx.strokeStyle = cfg.fg;
      ctx.globalAlpha = clamp(z * 1.4, 0, 1);
      ctx.lineWidth = z * 1.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(cx + Math.cos(a) * (r - len), cy + Math.sin(a) * (r - len));
      ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
  });

  scene('plasma', 'Plasma Field', (ctx, W, H, cfg, t) => {
    // Classic summed sinusoids. Computed on a coarse grid and stretched, which
    // is ~40× cheaper than per-pixel and looks the same once it is blurred by
    // the CRT stack.
    const step = 4;
    const gw = Math.ceil(W / step), gh = Math.ceil(H / step);
    const img = ctx.createImageData(gw, gh), d = img.data;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const u = x / gw * 6, v = y / gh * 6;
      const s = Math.sin(u + t) + Math.sin(v * 1.3 - t * 0.7)
              + Math.sin((u + v) * 0.7 + t * 0.5) + Math.sin(Math.hypot(u - 3, v - 3) * 1.6 - t);
      const k = (s + 4) / 8;                        // 0..1
      const i = (y * gw + x) * 4;
      d[i] = 30 + k * 90; d[i + 1] = 40 + k * 200; d[i + 2] = 80 + (1 - k) * 160; d[i + 3] = 255;
    }
    // putImageData ignores scaling, so bounce through a bitmap to stretch it.
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    const tmp = plasmaScratch(gw, gh);
    tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.drawImage(tmp, 0, 0, gw, gh, 0, 0, W, H);
    ctx.restore();
  });

  scene('tunnel', 'Vector Tunnel', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;
    ctx.strokeStyle = cfg.fg;
    const rings = 16;
    for (let i = 0; i < rings; i++) {
      // Depth wraps, so rings appear at the centre and rush outward forever.
      const z = ((i / rings) + (t * 0.35)) % 1;
      const r = z * z * Math.max(W, H) * 0.9;
      if (r < 1) continue;
      ctx.globalAlpha = clamp(1 - z, 0, 1) * 0.9;
      ctx.lineWidth = 1 + z * 2.5;
      ctx.beginPath();
      // A rotating polygon rather than a circle: the vertices give the
      // corridor an edge to read against.
      const sides = 8, rot = t * 0.2 + z * 0.6;
      for (let s = 0; s <= sides; s++) {
        const a = rot + (s / sides) * Math.PI * 2;
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r * 0.78;
        s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
  });

  scene('life', 'Cellular Automaton', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    // A real Life sim would need state across frames, which breaks the
    // "any frame renders from t alone" contract that scrub/export rely on.
    // A 1-D rule-30 automaton grown from a fixed seed row gives the same
    // organic look and IS a pure function of t.
    const cell = Math.max(2, Math.round(W / 90));
    const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
    seedStatic('life');
    let row = new Uint8Array(cols);
    for (let i = 0; i < cols; i++) row[i] = rnd() < 0.14 ? 1 : 0;
    row[cols >> 1] = 1;
    const scroll = Math.floor(t * 12);
    ctx.fillStyle = cfg.fg;
    for (let y = -scroll; y < rows; y++) {
      const next = new Uint8Array(cols);
      for (let x = 0; x < cols; x++) {
        const l = row[(x - 1 + cols) % cols], c = row[x], r = row[(x + 1) % cols];
        next[x] = (l ^ (c | r)) & 1;                 // rule 30
      }
      if (y >= 0) for (let x = 0; x < cols; x++) if (row[x]) ctx.fillRect(x * cell, y * cell, cell - 1, cell - 1);
      row = next;
    }
  });

  scene('multiplex', 'CCTV Multiplex', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    const cols = 2, rows = 2, gap = 2;
    const cw = (W - gap * (cols + 1)) / cols, ch = (H - gap * (rows + 1)) / rows;
    const labels = (macros(cfg.text || 'CAM 01\nCAM 02\nCAM 03\nCAM 04')).split('\n');
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = gap + c * (cw + gap), y = gap + r * (ch + gap);
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, cw, ch); ctx.clip();
      // Each pane gets its own noise stream so they do not fizz in lockstep,
      // which is the tell that it is one feed drawn four times.
      seedStream('multiplex:' + i);
      ctx.fillStyle = '#05070a'; ctx.fillRect(x, y, cw, ch);
      const g = ctx.createLinearGradient(x, y, x, y + ch);
      g.addColorStop(0, 'rgba(40,90,70,.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x, y, cw, ch);
      for (let k = 0; k < 40; k++) {
        const v = (rnd() * 90) | 0;
        ctx.fillStyle = `rgba(${v},${v},${v},.5)`;
        ctx.fillRect(x + rnd() * cw, y + rnd() * ch, 2, 1);
      }
      // One pane at a time gets "live" attention, cycling.
      const hot = Math.floor(t * 0.6) % 4 === i;
      ctx.strokeStyle = hot ? cfg.fg : 'rgba(90,140,120,.5)';
      ctx.lineWidth = hot ? 2 : 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
      setFont(ctx, Math.max(8, ch * 0.11));
      ctx.textBaseline = 'top';
      glowText(ctx, labels[i] || 'CAM 0' + (i + 1), x + 5, y + 4, hot ? cfg.fg : '#7fae9c', hot ? 5 : 1);
      if (hot && Math.floor(t * 2) % 2 === 0) {
        ctx.fillStyle = '#ff3b6b';
        ctx.beginPath(); ctx.arc(x + cw - 9, y + 9, 3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  });

  scene('lissajous', 'Lissajous / XY', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(80,180,140,.18)';
    for (let x = 0; x < W; x += W / 8) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += H / 6) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    // Slowly drifting frequency ratio — a locked ratio is a static shape, and
    // the drift is what makes it feel like a live instrument.
    const a = 3 + Math.sin(t * 0.11) * 0.6, b = 2 + Math.cos(t * 0.07) * 0.4;
    const rx = W * 0.36, ry = H * 0.36, cx = W / 2, cy = H / 2;
    // Draw the trail in fading segments so the beam reads as a beam.
    const segs = 260;
    for (let i = segs; i > 0; i--) {
      const tt = t * 2 - i * 0.012;
      const x1 = cx + Math.sin(a * tt) * rx, y1 = cy + Math.sin(b * tt + 1.1) * ry;
      const tt2 = t * 2 - (i - 1) * 0.012;
      const x2 = cx + Math.sin(a * tt2) * rx, y2 = cy + Math.sin(b * tt2 + 1.1) * ry;
      ctx.globalAlpha = (1 - i / segs) * 0.9;
      ctx.strokeStyle = cfg.fg;
      ctx.lineWidth = 1 + (1 - i / segs) * 1.6;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
  });

  scene('alert', 'Emergency Alert', (ctx, W, H, cfg, t) => {
    // EAS: colour bars up top, crawling text below, and the whole thing
    // strobing gently. Deliberately loud — it is the one scene meant to look
    // like an interruption.
    const cols = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
    const bh = H * 0.42, bw = W / cols.length;
    for (let i = 0; i < cols.length; i++) { ctx.fillStyle = cols[i]; ctx.fillRect(i * bw, 0, bw + 1, bh); }
    ctx.fillStyle = '#000'; ctx.fillRect(0, bh, W, H - bh);
    const flash = Math.floor(t * 2) % 2 === 0;
    ctx.fillStyle = flash ? '#ff2b2b' : '#8b0f0f';
    ctx.fillRect(0, bh, W, Math.max(3, H * 0.02));
    /* A CRAWL IS A LOOP, so it has to be tiled rather than repeated.
       This drew one string of four copies starting at `W - (travelled % width)`,
       which put its LEFT edge at the right-hand edge of the frame at the top of
       every cycle: the band started completely empty and filled in from the
       right over the next three and a half seconds, then snapped back to empty.
       Measured at 400×300: coverage climbing 0 → 255 of 400 columns across 3.5 s,
       under half the width for 4.8 s in every 20 — on the one scene in the set
       whose whole point is that it is an urgent interruption.
       One copy, tiled from just off the left edge to past the right one, is
       seamless: at the moment the offset wraps the picture is identical, and
       there is no part of the cycle with nothing on screen. */
    const one = macros(cfg.text || 'THIS IS NOT A TEST') + '   ///   ';
    const size = Math.max(11, H * 0.09);
    setFont(ctx, size);
    ctx.textBaseline = 'middle';
    const unit = Math.max(1, ctx.measureText(one).width);
    const off = (t * W * 0.28) % unit;
    const cy = bh + (H - bh) * 0.45;
    for (let x = -off; x < W; x += unit) glowText(ctx, one, x, cy, flash ? '#fff' : cfg.fg, 6);
    setFont(ctx, size * 0.62);
    ctx.textAlign = 'center';
    glowText(ctx, 'EMERGENCY ALERT SYSTEM', W / 2, H - size * 0.6, '#ffb347', 4);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  });

  scene('rain', 'Rain on Glass', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    // A dim backlight so the drops have something to refract.
    const g = ctx.createRadialGradient(W * 0.5, H * 0.35, 4, W * 0.5, H * 0.35, Math.max(W, H) * 0.7);
    g.addColorStop(0, 'rgba(90,150,130,.30)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    seedStatic('rain-drops');
    const n = 90;
    for (let i = 0; i < n; i++) {
      const x = rnd() * W;
      const speed = 0.15 + rnd() * 0.5;
      const phase = rnd();
      const y = (((t * speed + phase) % 1)) * (H + 40) - 20;
      const len = 6 + rnd() * 18;
      ctx.strokeStyle = cfg.fg;
      ctx.globalAlpha = 0.10 + rnd() * 0.18;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 1.5, y + len); ctx.stroke();
    }
    // Static beads that sit on the glass rather than running down it.
    seedStatic('rain-beads');
    for (let i = 0; i < 40; i++) {
      const x = rnd() * W, y = rnd() * H, r = 1 + rnd() * 2.6;
      ctx.globalAlpha = 0.12 + rnd() * 0.2;
      ctx.fillStyle = cfg.fg;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const txt = macros(cfg.text || '').split('\n')[0];
    if (txt) {
      setFont(ctx, Math.max(12, cfg.font));
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      glowText(ctx, txt, W / 2, H * 0.72, cfg.fg, 8);
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    }
  });

  scene('fire', 'Fire / Furnace', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = '#050202'; ctx.fillRect(0, 0, W, H);
    // Column-wise flame heights driven by summed sines plus per-frame jitter:
    // cheap, and reads as fire because the columns are correlated.
    seedStream('fire');
    const cols = Math.min(W, 160), cw = W / cols;
    for (let i = 0; i < cols; i++) {
      const u = i / cols;
      const base = 0.34 + 0.20 * Math.sin(u * 9 + t * 3.1) + 0.14 * Math.sin(u * 23 - t * 4.7)
                 + 0.10 * Math.sin(u * 47 + t * 8.3);
      const h = clamp(base + rrange(-0.05, 0.05), 0.05, 0.95) * H;
      const x = i * cw;
      const grad = ctx.createLinearGradient(0, H, 0, H - h);
      grad.addColorStop(0, 'rgba(255,240,180,.95)');
      grad.addColorStop(0.35, 'rgba(255,150,40,.85)');
      grad.addColorStop(0.75, 'rgba(190,40,20,.55)');
      grad.addColorStop(1, 'rgba(60,10,10,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, H - h, cw + 1, h);
    }
    // Embers rising.
    for (let i = 0; i < 30; i++) {
      const x = rnd() * W, y = H - rnd() * H * 0.8;
      ctx.fillStyle = `rgba(255,${140 + (rnd() * 90) | 0},60,${0.25 + rnd() * 0.5})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
    const txt = macros(cfg.text || '').split('\n')[0];
    if (txt) {
      setFont(ctx, Math.max(12, cfg.font));
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      glowText(ctx, txt, W / 2, H * 0.26, cfg.fg, 10);
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    }
  });

  scene('datastream', 'Data Stream', (ctx, W, H, cfg, t) => {
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
    // Horizontal packet bands sliding at different rates — a bus, not rain.
    const rows = Math.max(6, Math.floor(H / 14));
    const rh = H / rows;
    setFont(ctx, Math.max(7, rh * 0.72));
    ctx.textBaseline = 'middle';
    for (let r = 0; r < rows; r++) {
      seedStatic('datastream:' + r);
      const speed = 20 + rnd() * 90;
      const dir = rnd() < 0.5 ? -1 : 1;
      let s = '';
      const cells = 26;
      for (let i = 0; i < cells; i++) {
        s += (rnd() < 0.15 ? '████' : ((rnd() * 65536) | 0).toString(16).padStart(4, '0').toUpperCase()) + ' ';
      }
      const wpx = ctx.measureText(s).width || W;
      const x = dir > 0 ? -((t * speed) % wpx) : ((t * speed) % wpx) - wpx;
      ctx.globalAlpha = 0.30 + (r % 3) * 0.22;
      glowText(ctx, s, x, r * rh + rh / 2, cfg.fg, 2);
      glowText(ctx, s, x + wpx, r * rh + rh / 2, cfg.fg, 2);
    }
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'top';
  });

  /* The third shelf registers from here rather than from boot, so there stays
     ONE call site for "register the scenes that are not in scenes.js" and a
     fourth file is a one-line change here instead of two in boot.js. */
  registerExtraScenes2();
}

/* Scratch bitmap for the plasma grid. Lazy for the same reason every other
   scratch canvas in the codebase is: module-scope DOM breaks headless import. */
let _pc = null;
function plasmaScratch(w, h) {
  if (!_pc) _pc = document.createElement('canvas');
  if (_pc.width !== w) _pc.width = w;
  if (_pc.height !== h) _pc.height = h;
  return _pc;
}
