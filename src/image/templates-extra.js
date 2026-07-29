/* Dead Signal Studio — image/templates-extra.js
 *
 * A second shelf of screen templates, split from templates.js so that file
 * stays readable. Same registry, same contract.
 *
 * Each draw is (ctx, W, H, c) where `c` is the resolved image config: c.bg,
 * c.fg, c.font, c.title, c.body, c.extra. Templates are stills, so there is no
 * `t` — anything that needs to look randomised uses seedStatic so the same
 * seed always produces the same screen (which is what makes a project
 * reproducible).
 */
import { rnd, seedStatic } from '../core/rng.js';
import { glowText, macros, setFont } from '../core/text.js';
import { bevel, win95 } from './chrome95.js';
import { bodyLines, template } from './templates.js';
import { registerExtraTemplates2 } from './templates-extra2.js';

/** Register every template in this file. Called once, before the pickers fill. */
export function registerExtraTemplates() {

  template('http404', 'HTTP 404', (ctx, W, H, c) => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    setFont(ctx, Math.max(18, c.font * 2.1));
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(c.title || '404 Not Found', W * 0.08, H * 0.16);
    ctx.fillStyle = '#000';
    ctx.fillRect(W * 0.08, H * 0.16 + Math.max(18, c.font * 2.1) * 1.35, W * 0.84, 2);
    setFont(ctx, c.font);
    let y = H * 0.34;
    bodyLines(ctx, c, 'The requested URL /archive/0347 was not found on this server.\n\nAdditionally, a 404 Not Found error was encountered\nwhile trying to use an ErrorDocument to handle the request.', W * 0.84)
      .forEach((l) => { ctx.fillText(l, W * 0.08, y); y += c.font * 1.5; });
    setFont(ctx, c.font * 0.85);
    ctx.fillStyle = '#444';
    ctx.fillText(macros(c.extra || 'Apache/1.3.29 Server at erebus.archive Port 80'), W * 0.08, H - c.font * 2.4);
  });

  template('bios', 'BIOS Setup', (ctx, W, H, c) => {
    ctx.fillStyle = '#0000a8'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#a8a8a8'; ctx.fillRect(0, 0, W, c.font * 1.9);
    ctx.fillStyle = '#0000a8';
    setFont(ctx, c.font);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(c.title || 'CMOS Setup Utility — Erebus Systems', W / 2, c.font * 0.95);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    // Two columns of setting rows, the classic AMI/Award layout.
    const rows = macros(c.body || 'Date (mm:dd:yy)     : 03:47:88\nTime (hh:mm:ss)     : 03:47:00\nPrimary Master      : ARCHIVE-0347\nPrimary Slave       : None\nHalt On             : All Errors\nBase Memory         : 640K\nExtended Memory     : 15360K\nBoot Sequence       : C,A,TAPE').split('\n');
    ctx.fillStyle = '#a8a8a8';
    let y = c.font * 3.4;
    rows.forEach((l, i) => {
      if (i === Math.min(2, rows.length - 1)) { ctx.fillStyle = '#a8a800'; }
      ctx.fillText(l, W * 0.07, y);
      ctx.fillStyle = '#a8a8a8';
      y += c.font * 1.55;
    });
    ctx.fillStyle = '#a8a8a8';
    ctx.fillRect(W * 0.05, H - c.font * 3.2, W * 0.9, 1);
    setFont(ctx, c.font * 0.9);
    ctx.fillText(macros(c.extra || 'ESC: Quit   ↑↓: Select Item   F10: Save & Exit'), W * 0.07, H - c.font * 2.4);
  });

  template('chat', 'Chat Window', (ctx, W, H, c) => {
    ctx.fillStyle = '#0a5a6a'; ctx.fillRect(0, 0, W, H);
    const win = win95(ctx, 8, 8, W - 16, H - 16, c.title || 'PRIVATE — unknown', true);
    const pad = win.cx, top = win.cy;
    const boxW = win.cw, boxH = win.ch - 34;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(pad, top, boxW, boxH);
    bevel(ctx, pad, top, boxW, boxH, false);
    setFont(ctx, c.font);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    // "name: text" per line; lines starting with > are the other party.
    let y = top + 8;
    macros(c.body || '> are you still there\nyes\n> how long have you been watching\n> hello?\n\n[user has stopped typing]')
      .split('\n').forEach((l) => {
        const them = l.startsWith('>');
        const txt = them ? l.slice(1).trim() : l;
        ctx.fillStyle = them ? '#0a2a6a' : '#111';
        if (them && txt) {
          const w = ctx.measureText(txt).width + 12;
          ctx.fillStyle = '#dfe8ff';
          ctx.fillRect(pad + 6, y - 2, Math.min(w, boxW - 12), c.font * 1.4);
          ctx.fillStyle = '#0a2a6a';
        }
        ctx.fillText(txt, pad + 12, y);
        y += c.font * 1.5;
      });
    // Input box along the bottom of the client area.
    const iy = top + boxH + 6;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(pad, iy, boxW - 58, 24);
    bevel(ctx, pad, iy, boxW - 58, 24, false);
    ctx.fillStyle = '#111';
    ctx.fillText(macros(c.extra || '_'), pad + 6, iy + 6);
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(pad + boxW - 54, iy, 54, 24);
    bevel(ctx, pad + boxW - 54, iy, 54, 24, true);
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.fillText('Send', pad + boxW - 27, iy + 6);
    ctx.textAlign = 'left';
  });

  template('atm', 'ATM / Kiosk', (ctx, W, H, c) => {
    ctx.fillStyle = '#04121c'; ctx.fillRect(0, 0, W, H);
    // Screen bezel
    ctx.strokeStyle = '#2b4a5c'; ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, W - 16, H - 16);
    ctx.lineWidth = 1;
    setFont(ctx, Math.max(13, c.font * 1.3));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    glowText(ctx, c.title || 'PLEASE WAIT', W / 2, H * 0.16, c.fg, 8);
    setFont(ctx, c.font);
    let y = H * 0.36;
    bodyLines(ctx, c, 'Your transaction is being processed.\n\nDo not remove your card.', W * 0.7)
      .forEach((l) => { glowText(ctx, l, W / 2, y, c.fg, 3); y += c.font * 1.5; });
    // Soft-key stubs down both sides, the giveaway that it is a kiosk.
    ctx.fillStyle = '#16303e';
    for (let i = 0; i < 4; i++) {
      const ky = H * 0.28 + i * H * 0.14;
      ctx.fillRect(0, ky, 8, H * 0.07);
      ctx.fillRect(W - 8, ky, 8, H * 0.07);
    }
    setFont(ctx, c.font * 0.85);
    glowText(ctx, macros(c.extra || 'ERB-0347  ·  CONTACT YOUR BRANCH'), W / 2, H - c.font * 2.6, '#7fae9c', 2);
    ctx.textAlign = 'left';
  });

  template('vhslabel', 'VHS Label', (ctx, W, H, c) => {
    // The paper label on the spine/face of a tape. Off-white, hand-lettered
    // fields, a couple of printed guides.
    ctx.fillStyle = '#e8e4d4'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1b1b1b'; ctx.fillRect(0, 0, W, H * 0.16);
    setFont(ctx, Math.max(11, c.font * 1.05));
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = '#e8e4d4';
    ctx.fillText(macros(c.extra || 'VHS  ·  E-180  ·  SP/LP'), 12, H * 0.08);
    ctx.fillStyle = '#1b1b1b';
    setFont(ctx, Math.max(16, c.font * 1.9));
    ctx.fillText(macros(c.title || 'DO NOT ERASE'), 12, H * 0.32);
    // Ruled lines with the body written along them.
    setFont(ctx, c.font);
    const lines = macros(c.body || 'REC 03:47  ARCHIVE NODE\nCOPY OF A COPY\n— property of no one —').split('\n');
    let y = H * 0.52;
    for (let i = 0; i < Math.max(3, lines.length); i++) {
      ctx.strokeStyle = 'rgba(40,40,40,.28)';
      ctx.beginPath(); ctx.moveTo(12, y + c.font * 0.75); ctx.lineTo(W - 12, y + c.font * 0.75); ctx.stroke();
      if (lines[i]) { ctx.fillStyle = '#1b2f6b'; ctx.fillText(lines[i], 16, y); }
      y += c.font * 1.75;
    }
    // A little wear so it does not read as a clean vector shape.
    seedStatic('vhslabel');
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = `rgba(90,80,60,${0.03 + rnd() * 0.07})`;
      ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 2);
    }
    ctx.textBaseline = 'top';
  });

  template('vitals', 'Patient Monitor', (ctx, W, H, c) => {
    ctx.fillStyle = '#03070a'; ctx.fillRect(0, 0, W, H);
    // Three traces, each with its own colour and numeric readout — the layout
    // is what makes it legible as a monitor, not the waveform detail.
    /* The readouts beside each trace. Only the ECG one took an author value
       (the Title box); SpO2 and RESP were hard-coded '00' and the Body box was
       unread on this template entirely. One line of Body per trace now, so a
       monitor can say what it is actually reading. */
    const vals = macros(c.body || '').split('\n').map((v) => v.trim()).filter(Boolean);
    const rows = [
      { label: 'ECG', colour: '#39ff9e', value: vals[0] || '—' },
      { label: 'SpO2', colour: '#5fd9ff', value: vals[1] || '00' },
      { label: 'RESP', colour: '#ffb347', value: vals[2] || '00' },
    ];
    /* The patient banner every bedside monitor carries along its top edge.
       Title used to be the ECG number and nothing else, which meant it and the
       Body box were competing for one slot — so whichever you typed in, the
       other did nothing. Title names the bed, Body reads out the traces. */
    const banner = macros(c.title || 'BED 47 · UNIDENTIFIED');
    const bh = Math.max(12, c.font * 1.5);
    ctx.fillStyle = '#0a1218'; ctx.fillRect(0, 0, W, bh);
    setFont(ctx, Math.max(9, c.font * 0.9));
    ctx.fillStyle = '#9fd8c4'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(banner, 8, bh / 2);
    ctx.textBaseline = 'top';
    const rh = (H - bh) / rows.length;
    setFont(ctx, Math.max(9, c.font * 0.8));
    ctx.textBaseline = 'top';
    rows.forEach((r, i) => {
      const y0 = bh + i * rh;
      ctx.strokeStyle = 'rgba(60,110,95,.18)';
      ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(W, y0); ctx.stroke();
      // A flatline with a single blip, or nothing at all: this is a horror
      // asset, and a healthy trace is the least interesting version of it.
      ctx.strokeStyle = r.colour;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      const mid = y0 + rh * 0.6;
      for (let x = 0; x < W; x++) {
        let y = mid;
        if (i === 0) {
          const px = (x / W) * 6 % 1;
          if (px > 0.44 && px < 0.5) y = mid - rh * 0.34;
          else if (px >= 0.5 && px < 0.54) y = mid + rh * 0.2;
        }
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = r.colour;
      ctx.fillText(r.label, 8, y0 + 6);
      setFont(ctx, Math.max(16, c.font * 2));
      ctx.textAlign = 'right';
      ctx.fillText(r.value, W - 10, y0 + 6);
      ctx.textAlign = 'left';
      setFont(ctx, Math.max(9, c.font * 0.8));
    });
    ctx.fillStyle = '#ff3b6b';
    setFont(ctx, c.font);
    ctx.fillText(macros(c.extra || 'ALARM SILENCED'), 8, H - c.font * 1.8);
  });

  template('receipt', 'Receipt / Docket', (ctx, W, H, c) => {
    ctx.fillStyle = '#f2f0e6'; ctx.fillRect(0, 0, W, H);
    // Torn top and bottom edges — the thing that says "printed, then ripped".
    ctx.fillStyle = c.bg || '#0b0e12';
    seedStatic('receipt-tear');
    for (let x = 0; x < W; x += 6) {
      ctx.fillRect(x, 0, 6, 3 + rnd() * 6);
      ctx.fillRect(x, H - (3 + rnd() * 6), 6, 8);
    }
    ctx.fillStyle = '#15150f';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    setFont(ctx, Math.max(12, c.font * 1.25));
    ctx.fillText(macros(c.title || 'EREBUS ARCHIVE'), W / 2, H * 0.10);
    setFont(ctx, c.font * 0.95);
    let y = H * 0.10 + c.font * 2.2;
    ctx.textAlign = 'left';
    macros(c.body || 'NODE 0347            1  0.00\nOBSERVATION          1  0.00\nSILENCE              ∞  0.00\n------------------------------\nTOTAL                   0.00')
      .split('\n').forEach((l) => { ctx.fillText(l, W * 0.12, y); y += c.font * 1.45; });
    // A barcode block, which is most of what reads as "receipt".
    seedStatic('receipt-barcode');
    const by = H - c.font * 4.5, bh = c.font * 2.2;
    let bx = W * 0.18;
    while (bx < W * 0.82) {
      const w = 1 + Math.floor(rnd() * 3);
      if (rnd() > 0.35) { ctx.fillStyle = '#15150f'; ctx.fillRect(bx, by, w, bh); }
      bx += w + 1 + Math.floor(rnd() * 2);
    }
    ctx.textAlign = 'center';
    setFont(ctx, c.font * 0.8);
    ctx.fillStyle = '#15150f';
    ctx.fillText(macros(c.extra || '0347 0347 0347'), W / 2, by + bh + 4);
    ctx.textAlign = 'left';
  });

  template('filecabinet', 'Search Results', (ctx, W, H, c) => {
    ctx.fillStyle = '#0a5a6a'; ctx.fillRect(0, 0, W, H);
    const win = win95(ctx, 8, 8, W - 16, H - 16, c.title || 'Find: Files named ARCHIVE', true);
    const pad = win.cx, top = win.cy;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(pad, top, win.cw, win.ch);
    bevel(ctx, pad, top, win.cw, win.ch, false);
    // Column headers, then rows — a results list is a table, and the header
    // is what stops it reading as a text file.
    const cols = [['Name', 0.04], ['In Folder', 0.42], ['Size', 0.70], ['Modified', 0.82]];
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(pad + 1, top + 1, win.cw - 2, c.font * 1.6);
    setFont(ctx, c.font * 0.95);
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000';
    cols.forEach(([label, x]) => ctx.fillText(label, pad + W * x, top + 5));
    let y = top + c.font * 1.6 + 5;
    const rows = macros(c.body || 'ARCHIVE_0347.TAP|C:\\TAPES|14.2 MB|03/47/88\nARCHIVE_0348.TAP|C:\\TAPES|0 bytes|03/47/88\nOBSERVE.LOG|C:\\|847 KB|—\nDO_NOT_OPEN|C:\\TAPES|— |—').split('\n');
    rows.forEach((line, i) => {
      const cells = line.split('|');
      if (i === rows.length - 1) { ctx.fillStyle = '#000080'; ctx.fillRect(pad + 2, y - 2, win.cw - 4, c.font * 1.4); }
      ctx.fillStyle = i === rows.length - 1 ? '#fff' : '#000';
      cols.forEach(([, x], ci) => { if (cells[ci]) ctx.fillText(cells[ci].trim(), pad + W * x, y); });
      y += c.font * 1.5;
    });
    ctx.fillStyle = '#000';
    setFont(ctx, c.font * 0.9);
    ctx.fillText(macros(c.extra || rows.length + ' file(s) found'), pad + 6, top + win.ch - c.font * 1.6);
  });

  /* The third shelf registers from here rather than from boot, so there stays
     ONE call site for "register the templates that are not in templates.js"
     and a fourth file is a one-line change here instead of two in boot.js. */
  registerExtraTemplates2();
}
