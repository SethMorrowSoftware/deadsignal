/* Dead Signal Studio — image/templates-extra2.js
 *
 * A third shelf of screen templates. Same registry, same contract as
 * templates.js and templates-extra.js; split only so no one file grows past
 * reading.
 *
 * Each draw is (ctx, W, H, c) where `c` is the resolved image config: c.bg,
 * c.fg, c.font, c.title, c.body, c.extra. Templates are STILLS, so there is no
 * `t` — anything that should look randomised uses seedStatic, so the same seed
 * always produces the same screen. That is what makes a project reproducible,
 * and it is the one rule here that is not negotiable.
 *
 * This shelf is mostly PAPER rather than screens: a clipping, a form, a label,
 * a page from a book. Two consequences worth stating once instead of in
 * fourteen places:
 *
 *  - Paper templates own their background. They ignore c.bg and fill with their
 *    own stock colour, because "a newspaper on a green CRT background" is not a
 *    newspaper. The screen templates on the other shelves take c.bg; these are
 *    the deliberate exception, and the ink colour is likewise the stock's, not
 *    c.fg. c.fg still drives anything that is genuinely an accent.
 *  - The paper-aging pass in fx/still.js runs after this, so nothing here draws
 *    its own stains or creases — that would be the effect applied twice.
 */
import { rint, rnd, seedStatic } from '../core/rng.js';
import { macros, setFont, wrapLines } from '../core/text.js';
import { template } from './templates.js';

/* Stock colours, named once. A template that invents its own off-white makes
   the set look like fourteen different tools. */
const PAPER = '#efe9dc';
const NEWSPRINT = '#e4ddc8';
const INK = '#161410';
const FAINT = 'rgba(22,20,16,.45)';

/**
 * Type size for a paper template.
 *
 * These size their LAYOUT to the sheet (`pad = W * 0.06`) but the templates
 * that shipped before them size their TYPE in absolute pixels — which at a
 * 1080×1920 delivery format gives a huge page with a stamp of text in one
 * corner. `c.font` stays the author's control; it scales this rather than
 * being the answer. 15 is the control's default, so a default-sized sheet
 * looks the way it did.
 */
const typeOf = (c, W, H) => Math.max(6, (c.font / 15) * Math.min(W, H) * 0.033);

/** Fill the sheet and set sensible text defaults. Returns the ink colour. */
function sheet(ctx, W, H, stock) {
  ctx.fillStyle = stock;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  return INK;
}

/**
 * Author lines, or the fallback's — wrapped to `maxWidth` when the author has
 * asked for wrapping and the caller knows what box the text sits in.
 *
 * Templates that lay out a TABLE ('CASE NO.|{{case}}') pass no width and are
 * untouched: breaking a field row across two lines is not word wrap, it is
 * damage. Measured in the current font, so call it after setFont.
 */
const body = (c, fallback, ctx, maxWidth) => {
  const txt = macros(c.body || fallback);
  if (!c.wrap || !ctx || !(maxWidth > 0)) return txt.split('\n');
  const out = [];
  for (const para of txt.split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    out.push(...wrapLines(ctx, para, maxWidth));
  }
  return out;
};
/** One line of author text, or the fallback. */
const title = (c, fallback) => macros(c.title || fallback);

/** Draw `text` wrapped into a column, returning the y it finished at. */
function column(ctx, text, x, y, w, lh) {
  for (const para of text.split('\n')) {
    if (!para.trim()) { y += lh * 0.6; continue; }
    for (const l of wrapLines(ctx, para, w)) { ctx.fillText(l, x, y); y += lh; }
  }
  return y;
}

/** A ruled line. Used by half the forms here, so it is worth a name. */
function rule(ctx, x, y, w, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillRect(x, y, w, 1);
  ctx.restore();
}

export function registerExtraTemplates2() {

  /* --------------------------------------------------------- print ------ */

  /* Newspaper clipping. The masthead, a rule, a headline, then columns — and
     the columns are the thing: a single block of text reads as a document, two
     narrow justified ones read as newsprint. */
  template('clipping', 'Newspaper Clipping', (ctx, W, H, c) => {
    const f = typeOf(c, W, H);
    sheet(ctx, W, H, NEWSPRINT);
    const pad = W * 0.06;
    setFont(ctx, f * 0.65);
    ctx.fillText(macros(c.extra || 'THE ARCHIVE HERALD · Vol. 47 · Price 5c'), pad, pad * 0.6);
    rule(ctx, pad, pad * 0.6 + f * 1.1, W - pad * 2);
    const hs = f * 1.9;
    setFont(ctx, hs);
    let y = pad * 0.6 + f * 1.1 + 8;
    for (const l of wrapLines(ctx, title(c, 'STATION 47 GOES SILENT'), W - pad * 2)) {
      ctx.fillText(l, pad, y); y += hs * 1.1;
    }
    rule(ctx, pad, y + 4, W - pad * 2, 0.5);
    y += 12;
    // Two columns, with the gutter and the rule between them.
    const colW = (W - pad * 2 - pad * 0.5) / 2;
    setFont(ctx, f * 0.62);
    const lh = f * 0.62 * 1.42;
    const text = body(c, 'The transmission ended at 03:47 and did not resume.\n\nOperators at the site reported nothing unusual in the hours before. A maintenance log recovered from the building shows a single entry for that morning, in a hand nobody has identified.\n\nThe entry reads: IT IS STILL LISTENING.\n\nThe station has not broadcast since. Requests for comment went unanswered.').join('\n');
    const half = Math.ceil(text.length / 2);
    const cut = text.indexOf(' ', half) < 0 ? half : text.indexOf(' ', half);
    column(ctx, text.slice(0, cut), pad, y, colW, lh);
    column(ctx, text.slice(cut + 1), pad + colW + pad * 0.5, y, colW, lh);
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillRect(pad + colW + pad * 0.25, y, 1, H - y - pad);
    ctx.restore();
  });

  /* Police report. A form: boxed fields with printed labels and filled values.
     The labels are what makes it a form — text on a page with a header is a
     memo, boxes with captions is a report. */
  template('policereport', 'Police Report', (ctx, W, H, c) => {
    const f = typeOf(c, W, H);
    sheet(ctx, W, H, PAPER);
    const pad = W * 0.06;
    setFont(ctx, f * 0.85);
    ctx.textAlign = 'center';
    ctx.fillText(macros(c.extra || 'METROPOLITAN POLICE — INCIDENT REPORT'), W / 2, pad * 0.5);
    ctx.textAlign = 'left';
    rule(ctx, pad, pad * 0.5 + f * 1.4, W - pad * 2);
    const fields = body(c, 'CASE NO.|{{case}}\nDATE|03/47/97\nLOCATION|STATION 47, LOWER SITE\nREPORTING|OFC. D. HALE, #0047\nCLASSIFICATION|MISSING PERSON\nSTATUS|OPEN — NO LEADS');
    const fs = f * 0.6;
    let y = pad * 0.5 + f * 2.4;
    const rowH = Math.max(fs * 2.4, (H * 0.52 - y) / Math.max(1, fields.length));
    for (const field of fields) {          // not `f` — that is the type size
      const [label, ...rest] = field.split('|');
      const value = rest.join('|');
      ctx.strokeStyle = FAINT;
      ctx.strokeRect(pad, y, W - pad * 2, rowH);
      setFont(ctx, fs * 0.85);
      ctx.save(); ctx.globalAlpha = 0.6;
      ctx.fillText(label.toUpperCase(), pad + 5, y + 3);
      ctx.restore();
      setFont(ctx, fs * 1.3);
      ctx.fillText(value, pad + 8, y + rowH * 0.42);
      y += rowH;
    }
    setFont(ctx, fs * 0.85);
    ctx.save(); ctx.globalAlpha = 0.6;
    ctx.fillText('NARRATIVE', pad + 2, y + 8);
    ctx.restore();
    setFont(ctx, fs);
    column(ctx, macros(c.title || 'Subject last seen entering the lower level at 03:47. No exit recorded. Site sweep negative.'),
      pad + 2, y + fs * 2.2, W - pad * 2 - 4, fs * 1.45);
    // Signature rule at the foot, which every form has and nothing else does.
    rule(ctx, pad, H - pad * 0.9, (W - pad * 2) * 0.5, 0.7);
    ctx.save(); ctx.globalAlpha = 0.6;
    setFont(ctx, fs * 0.8);
    ctx.fillText('SIGNATURE', pad, H - pad * 0.9 + 4);
    ctx.restore();
  });

  /* Evidence tag: a small card with a hole punch, a case number and a barcode.
     Rotated a couple of degrees, because a tag photographed on a table never
     sits square and a perfectly level one reads as a mockup. */
  template('evidence', 'Evidence Tag', (ctx, W, H, c) => {
    const f = typeOf(c, W, H);
    ctx.fillStyle = c.bg || '#12140f';
    ctx.fillRect(0, 0, W, H);
    const tw = W * 0.74, th = H * 0.62;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-0.035);
    ctx.translate(-tw / 2, -th / 2);
    ctx.fillStyle = '#d8cfa8';
    ctx.fillRect(0, 0, tw, th);
    ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.strokeRect(6, 6, tw - 12, th - 12);
    // The punch hole and its reinforcement ring.
    ctx.fillStyle = c.bg || '#12140f';
    ctx.beginPath(); ctx.arc(tw * 0.1, th * 0.16, Math.max(4, th * 0.05), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(tw * 0.1, th * 0.16, Math.max(7, th * 0.08), 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    setFont(ctx, f * 1.1);
    ctx.fillText(title(c, 'EVIDENCE'), tw / 2, th * 0.1);
    ctx.textAlign = 'left';
    setFont(ctx, f * 0.62);
    let y = th * 0.3;
    // No width: these are LABEL/value pairs on a luggage tag, and wrapping
    // "FOUND 03:47  LOWER SITE" onto a second line breaks the column they
    // depend on.
    for (const l of body(c, 'CASE  {{case}}\nITEM  0047-B\nDESC  CASSETTE, UNLABELLED\nFOUND 03:47  LOWER SITE\nBY    OFC. D. HALE')) {
      ctx.fillText(l, tw * 0.1, y); y += f * 0.62 * 1.6;
    }
    seedStatic('evidence-barcode');
    let bx = tw * 0.1;
    const by = th - th * 0.22, bh = th * 0.12;
    while (bx < tw * 0.9) {
      const w = 1 + Math.floor(rnd() * 3);
      if (rnd() > 0.34) ctx.fillRect(bx, by, w, bh);
      bx += w + 1 + Math.floor(rnd() * 2);
    }
    ctx.restore();
  });

  /* A page from a handwritten journal. Ruled lines and a margin, text riding
     slightly above each rule with a per-line jitter — a hand does not sit on
     the line and does not repeat its own baseline. */
  template('journal', 'Journal Page', (ctx, W, H, c) => {
    const f = typeOf(c, W, H);
    sheet(ctx, W, H, '#f4eeda');
    const pad = W * 0.09;
    const lh = f * 1.7;
    ctx.save();
    ctx.fillStyle = '#8fa8c8';
    ctx.globalAlpha = 0.5;
    for (let y = pad * 1.4; y < H - 6; y += lh) ctx.fillRect(pad * 0.5, y, W - pad, 1);
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#c88f8f';
    ctx.globalAlpha = 0.6;
    ctx.fillRect(pad, 0, 1, H);          // the margin rule
    ctx.restore();
    ctx.fillStyle = '#2a3550';           // biro blue-black, not printer black
    setFont(ctx, f * 1.05);
    seedStatic('journal');
    let y = pad * 1.4 - f * 1.05 * 0.95;
    // The title is the date line at the top, underlined the way a diary entry
    // is. Without this the title box did nothing on this template at all.
    const lines = [title(c, 'March 47th'), ''];
    for (const para of body(c, 'It answered again tonight. Not words. A pause where a word should be, then the tape counter moving on its own.\n\nI have stopped writing down what it says. I am writing down what it waits for.')) {
      if (!para.trim()) { lines.push(''); continue; }
      for (const l of wrapLines(ctx, para, W - pad * 1.6)) lines.push(l);
    }
    for (const l of lines) {
      y += lh;
      if (y > H - 8) break;
      if (!l) continue;
      // Per-line drift, not per-character: a hand wanders across a page, it
      // does not shake between letters.
      ctx.save();
      ctx.translate(pad + 8 + (rnd() - 0.5) * 3, y - (rnd() * 2 + 1));
      ctx.rotate((rnd() - 0.5) * 0.008);
      ctx.fillText(l, 0, 0);
      ctx.restore();
    }
    ctx.fillStyle = INK;
  });

  /* Prescription pad: a doctor's slip, small, with the Rx mark and a signature
     line that is the whole point of the form. */
  template('prescription', 'Prescription', (ctx, W, H, c) => {
    const f = typeOf(c, W, H);
    sheet(ctx, W, H, '#f6f2e4');
    const pad = W * 0.08;
    setFont(ctx, f * 0.9);
    ctx.fillText(macros(c.extra || 'EREBUS OCCUPATIONAL HEALTH'), pad, pad * 0.5);
    setFont(ctx, f * 0.6);
    ctx.save(); ctx.globalAlpha = 0.65;
    ctx.fillText('SITE CLINIC · LOWER LEVEL · EXT. 0047', pad, pad * 0.5 + f * 1.2);
    ctx.restore();
    rule(ctx, pad, pad * 1.35, W - pad * 2, 0.7);
    const fs = f * 0.66;
    setFont(ctx, fs);
    let y = pad * 1.65;
    ctx.fillText('NAME  ' + title(c, 'WEBB, M.'), pad, y);
    rule(ctx, pad + fs * 4.5, y + fs * 1.15, W * 0.5, 0.5);
    y += fs * 2.2;
    ctx.fillText('DATE  03 / 47 / 97', pad, y);
    y += fs * 2.6;
    // The Rx symbol, oversized — it is the mark that identifies the form.
    setFont(ctx, f * 2.4);
    ctx.fillText('℞', pad, y);
    setFont(ctx, fs * 1.1);
    let ry = y + fs * 0.4;
    for (const l of body(c, 'DO NOT LISTEN AFTER 03:00\n1 tablet nightly\nNo refills\n\nIf it answers, do not answer back.', ctx, W - pad * 2 - f * 2.6)) {
      ctx.fillText(l, pad + f * 2.6, ry);
      ry += fs * 1.7;
    }
    rule(ctx, pad, H - pad * 0.8, W * 0.55, 0.7);
    ctx.save(); ctx.globalAlpha = 0.6;
    setFont(ctx, fs * 0.85);
    ctx.fillText('PRESCRIBER SIGNATURE', pad, H - pad * 0.8 + 4);
    ctx.restore();
  });

  /* Boarding pass: two panels split by a perforation, the stub narrower than
     the main. The perforation is what says "tear here" and therefore "ticket". */
  template('boardingpass', 'Boarding Pass', (ctx, W, H, c) => {
    const f = typeOf(c, W, H);
    ctx.fillStyle = c.bg || '#0b0e12';
    ctx.fillRect(0, 0, W, H);
    const pw = W * 0.9, ph = H * 0.56;
    const px = (W - pw) / 2, py = (H - ph) / 2;
    ctx.fillStyle = '#f3eee0';
    ctx.fillRect(px, py, pw, ph);
    const split = px + pw * 0.7;
    ctx.save();
    ctx.strokeStyle = FAINT;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(split, py); ctx.lineTo(split, py + ph); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = INK;
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    const fs = f * 0.62;
    setFont(ctx, fs * 1.5);
    ctx.fillText(title(c, 'EREBUS AIR'), px + 10, py + 8);
    setFont(ctx, fs * 0.85);
    ctx.save(); ctx.globalAlpha = 0.6;
    ctx.fillText('BOARDING PASS', px + 10, py + 8 + fs * 1.9);
    ctx.restore();
    // Field grid on the main panel; the stub repeats a subset, as a real one does.
    const fields = body(c, 'PASSENGER|WEBB / M\nFROM|SITE 47\nTO|—\nFLIGHT|ER 0347\nGATE|B\nSEAT|47A\nBOARDS|03:47');
    setFont(ctx, fs);
    let fx = px + 10, fy = py + ph * 0.34;
    let col = 0;
    for (const field of fields) {          // not `f` — that is the type size
      const [label, ...rest] = field.split('|');
      ctx.save(); ctx.globalAlpha = 0.55;
      setFont(ctx, fs * 0.78);
      ctx.fillText(label.toUpperCase(), fx, fy);
      ctx.restore();
      setFont(ctx, fs * 1.25);
      ctx.fillText(rest.join('|'), fx, fy + fs * 1.05);
      col++;
      if (col % 4 === 0) { fx = px + 10; fy += fs * 2.9; } else fx += (split - px - 20) / 4;
    }
    setFont(ctx, fs * 0.9);
    const stub = fields.slice(0, 3).map((f) => f.split('|').slice(1).join('|'));
    let sy = py + ph * 0.34;
    for (const s of stub) { ctx.fillText(s, split + 8, sy); sy += fs * 1.8; }
    seedStatic('bp-barcode');
    let bx = split + 8;
    while (bx < px + pw - 10) {
      const w = 1 + Math.floor(rnd() * 2);
      if (rnd() > 0.35) ctx.fillRect(bx, py + ph - fs * 3.2, w, fs * 2.4);
      bx += w + 1;
    }
  });

  /* Bank statement: a ledger. Alternating row tint, right-aligned amounts, a
     running balance — the alignment is what makes it read as money. */
  template('statement', 'Bank Statement', (ctx, W, H, c) => {
    const f = typeOf(c, W, H);
    sheet(ctx, W, H, PAPER);
    const pad = W * 0.06;
    setFont(ctx, f * 1.05);
    ctx.fillText(title(c, 'FIRST ARCHIVE SAVINGS'), pad, pad * 0.5);
    setFont(ctx, f * 0.6);
    ctx.save(); ctx.globalAlpha = 0.65;
    ctx.fillText(macros(c.extra || 'ACCOUNT 0047-0347 · STATEMENT PERIOD 03/97'), pad, pad * 0.5 + f * 1.4);
    ctx.restore();
    const fs = f * 0.58;
    setFont(ctx, fs);
    let y = pad * 1.6;
    const cols = [pad, pad + (W - pad * 2) * 0.18, W - pad - (W - pad * 2) * 0.32, W - pad];
    const head = ['DATE', 'DESCRIPTION', 'AMOUNT', 'BALANCE'];
    ctx.save(); ctx.globalAlpha = 0.6;
    ctx.fillText(head[0], cols[0], y); ctx.fillText(head[1], cols[1], y);
    ctx.textAlign = 'right';
    ctx.fillText(head[2], cols[2], y); ctx.fillText(head[3], cols[3], y);
    ctx.textAlign = 'left';
    ctx.restore();
    y += fs * 1.6;
    rule(ctx, pad, y - 3, W - pad * 2, 0.7);
    const rows = body(c, '03/01|OPENING BALANCE||4,700.00\n03/12|TRANSFER — SITE 47|-470.00|4,230.00\n03/29|WITHDRAWAL ATM 0047|-347.00|3,883.00\n03/47|UNKNOWN|-3,883.00|0.00');
    const rowH = fs * 1.9;
    rows.forEach((r, i) => {
      const cells = r.split('|');
      if (i % 2) {
        ctx.save(); ctx.globalAlpha = 0.06;
        ctx.fillRect(pad, y - 2, W - pad * 2, rowH);
        ctx.restore();
      }
      ctx.fillText(cells[0] || '', cols[0], y);
      ctx.fillText(cells[1] || '', cols[1], y);
      ctx.textAlign = 'right';
      ctx.fillText(cells[2] || '', cols[2], y);
      ctx.fillText(cells[3] || '', cols[3], y);
      ctx.textAlign = 'left';
      y += rowH;
    });
    rule(ctx, pad, y, W - pad * 2, 0.7);
  });

  /* Certificate: centred, ruled border, a seal and two signature lines. Every
     one of those is load-bearing — drop the seal and it is a poster. */
  template('certificate', 'Certificate', (ctx, W, H, c) => {
    const f = typeOf(c, W, H);
    sheet(ctx, W, H, '#f7f1de');
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3; ctx.strokeRect(W * 0.05, H * 0.07, W * 0.9, H * 0.86);
    ctx.lineWidth = 1; ctx.strokeRect(W * 0.065, H * 0.09, W * 0.87, H * 0.82);
    ctx.textAlign = 'center';
    setFont(ctx, f * 1.7);
    ctx.fillText(title(c, 'CERTIFICATE OF CLEARANCE'), W / 2, H * 0.16);
    setFont(ctx, f * 0.68);
    ctx.save(); ctx.globalAlpha = 0.7;
    ctx.fillText(macros(c.extra || 'EREBUS ARCHIVE SYSTEMS · LEVEL 47'), W / 2, H * 0.16 + f * 2.4);
    ctx.restore();
    setFont(ctx, f * 0.85);
    let y = H * 0.36;
    for (const l of body(c, 'This is to certify that\n\nM. WEBB\n\nhas been granted unaccompanied access\nto the lower archive in perpetuity.', ctx, W * 0.72)) {
      ctx.fillText(l, W / 2, y);
      y += f * 0.85 * 1.7;
    }
    // Seal: concentric rings with radial ticks, which is what a stamp looks
    // like without pretending to draw an emblem.
    const sx = W / 2, sy = H * 0.755, r = Math.min(W, H) * 0.075;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(sx, sy, r * 0.76, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
      ctx.lineTo(sx + Math.cos(a) * r * 1.16, sy + Math.sin(a) * r * 1.16);
      ctx.stroke();
    }
    setFont(ctx, Math.max(7, r * 0.28));
    ctx.fillText('0047', sx, sy - r * 0.14);
    ctx.restore();
    ctx.textAlign = 'left';
    const ly = H * 0.885;
    rule(ctx, W * 0.12, ly, W * 0.26, 0.7);
    rule(ctx, W * 0.62, ly, W * 0.26, 0.7);
    ctx.save(); ctx.globalAlpha = 0.6;
    setFont(ctx, f * 0.55);
    ctx.fillText('DIRECTOR', W * 0.12, ly + 4);
    ctx.fillText('DATE', W * 0.62, ly + 4);
    ctx.restore();
  });

  /* --------------------------------------------------------- labels ----- */

  /* Floppy label: the sticker, not the disk. Ruled write-on lines and a
     printed brand strip, drawn slightly askew because nobody applied one
     straight. */
  template('floppy', 'Floppy Label', (ctx, W, H, c) => {
    const f = typeOf(c, W, H);
    ctx.fillStyle = c.bg || '#1a1d22';
    ctx.fillRect(0, 0, W, H);
    const lw = W * 0.78, lh = H * 0.5;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(0.022);
    ctx.translate(-lw / 2, -lh / 2);
    ctx.fillStyle = '#f0ecdd';
    ctx.fillRect(0, 0, lw, lh);
    ctx.fillStyle = '#b03a4a';
    ctx.fillRect(0, 0, lw, lh * 0.2);
    ctx.fillStyle = '#f8f5ec';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    setFont(ctx, Math.max(8, lh * 0.12));
    ctx.fillText(macros(c.extra || 'DS/HD  1.44 MB  3.5"'), 8, lh * 0.1);
    ctx.fillStyle = '#2a3550';
    ctx.textBaseline = 'alphabetic';
    setFont(ctx, Math.max(10, lh * 0.17));
    let y = lh * 0.42;
    // Title first, then the body lines: the hand-written part of the label is
    // "what is on this disk" over "what to do with it", and both are the
    // author's. The title box did nothing on this template before.
    for (const l of [title(c, 'ARCHIVE 0347'), ...body(c, 'DO NOT COPY')]) {
      ctx.fillText(l, 10, y);
      ctx.save();
      ctx.globalAlpha = 0.35; ctx.fillStyle = INK;
      ctx.fillRect(8, y + 4, lw - 16, 1);
      ctx.restore();
      y += lh * 0.26;
    }
    ctx.restore();
    ctx.fillStyle = INK; ctx.textBaseline = 'top';
  });

  /* CD label: the printed disc face. Circular, with the spindle hole and the
     clear inner ring — text follows straight lines because a CD's print does. */
  template('cdlabel', 'CD Label', (ctx, W, H, c) => {
    const f = typeOf(c, W, H);
    ctx.fillStyle = c.bg || '#0c0f14';
    ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.44;
    // The disc, as a ring gradient — a flat fill reads as a coaster.
    const g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
    g.addColorStop(0, '#d9d4c6');
    g.addColorStop(0.55, '#efeadd');
    g.addColorStop(1, '#c9c3b4');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8d94a0';
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.bg || '#0c0f14';
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    setFont(ctx, Math.max(11, R * 0.13));
    ctx.fillText(title(c, 'EREBUS'), cx, cy - R * 0.52);
    setFont(ctx, Math.max(7, R * 0.075));
    let y = cy + R * 0.42;
    for (const l of body(c, 'ARCHIVE BACKUP 03/47\nDO NOT DUPLICATE')) { ctx.fillText(l, cx, y); y += R * 0.13; }
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  });

  /* --------------------------------------------------------- system ---- */

  /* Punch card. 80 columns, 12 rows, the clipped corner, and rectangular
     punches — the clipped corner is how an operator knew which way up it went,
     and its absence is the first thing that reads as wrong. */
  template('punchcard', 'Punch Card', (ctx, W, H, c) => {
    const f = typeOf(c, W, H);
    ctx.fillStyle = c.bg || '#14171c';
    ctx.fillRect(0, 0, W, H);
    const cw = W * 0.92, ch = cw * 0.36;
    const x0 = (W - cw) / 2, y0 = (H - ch) / 2;
    ctx.save();
    ctx.beginPath();
    const clip = ch * 0.16;
    ctx.moveTo(x0 + clip, y0);
    ctx.lineTo(x0 + cw, y0);
    ctx.lineTo(x0 + cw, y0 + ch);
    ctx.lineTo(x0, y0 + ch);
    ctx.lineTo(x0, y0 + clip);
    ctx.closePath();
    ctx.fillStyle = '#e9dfc2';
    ctx.fill();
    ctx.clip();
    /* A card holds ONE 80-column line, so title and body are joined rather
       than one of them being silently ignored — an author typing into the body
       box and seeing nothing happen would reasonably think the card was
       broken. */
    const text = [macros(c.title || ''), macros(c.body || '').replace(/\n+/g, ' ')]
      .filter((s) => s.trim()).join(' ').toUpperCase().slice(0, 80)
      || 'ARCHIVE 0347 OBSERVE';
    setFont(ctx, Math.max(5, ch * 0.075));
    ctx.fillStyle = '#4a4230';
    ctx.textBaseline = 'top';
    const colW = cw / 80;
    for (let i = 0; i < text.length; i++) ctx.fillText(text[i], x0 + i * colW + colW * 0.15, y0 + ch * 0.035);
    // Row grid, then punches: a rectangle removed per (column, row) pair.
    const rows = 12, top = y0 + ch * 0.16, rowH = (ch * 0.78) / rows;
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#4a4230';
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < 80; i++) ctx.fillText('0', x0 + i * colW + colW * 0.2, top + r * rowH);
    }
    ctx.restore();
    ctx.fillStyle = c.bg || '#14171c';
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (text[i] === ' ') continue;
      // Two punches per column, derived from the character — deterministic, and
      // the pattern varies with the text the way a real card's does.
      for (const r of [code % rows, (code >> 3) % rows]) {
        ctx.fillRect(x0 + i * colW + colW * 0.18, top + r * rowH + rowH * 0.12, colW * 0.64, rowH * 0.72);
      }
    }
    ctx.restore();
    ctx.fillStyle = INK;
  });

  /* Calendar page: a month grid with one day ringed. The ring is the story —
     a calendar with nothing marked is furniture. */
  template('calendar', 'Calendar Page', (ctx, W, H, c) => {
    const f = typeOf(c, W, H);
    sheet(ctx, W, H, PAPER);
    /* Capped against the HEIGHT as well as taken from the width. The margin is
       spent both ways — `gy` and the bottom inset come out of H — so a frame
       wider than 2:1 used to spend more vertical margin than it had, `gh` went
       negative, and the ringed day threw on a negative ellipse radius. The cap
       is inert at every ordinary shape (W*0.06 <= H*0.12 for anything up to
       2:1, which covers 4:3, 16:9 and all portrait), so no existing render
       moves by a pixel; it engages only where this used to crash. */
    const pad = Math.min(W * 0.06, H * 0.12);
    ctx.textAlign = 'center';
    setFont(ctx, f * 1.6);
    ctx.fillText(title(c, 'MARCH 1997'), W / 2, pad * 0.4);
    ctx.textAlign = 'left';
    const gx = pad, gy = pad * 1.6, gw = W - pad * 2;
    const cols = 7, rows = 6;
    // …and floored, so the grid stays drawable on any frame shape at all rather
    // than only on the ones the cap happens to rescue.
    const gh = Math.max(rows, H - gy - pad * 0.8);
    const cw = gw / cols, chh = gh / rows;
    const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    setFont(ctx, f * 0.58);
    ctx.save(); ctx.globalAlpha = 0.6;
    ctx.textAlign = 'center';
    for (let i = 0; i < cols; i++) ctx.fillText(days[i], gx + cw * (i + 0.5), gy - f * 0.9);
    ctx.restore();
    ctx.strokeStyle = FAINT;
    for (let r = 0; r <= rows; r++) { ctx.beginPath(); ctx.moveTo(gx, gy + chh * r); ctx.lineTo(gx + gw, gy + chh * r); ctx.stroke(); }
    for (let i = 0; i <= cols; i++) { ctx.beginPath(); ctx.moveTo(gx + cw * i, gy); ctx.lineTo(gx + cw * i, gy + gh); ctx.stroke(); }
    setFont(ctx, f * 0.8);
    ctx.textAlign = 'left';
    // The ringed day comes from the author: "MARK 29" in the body, else 29.
    const markLine = body(c, 'MARK 29\nNOTE it stops here')[0] || '';
    const mark = parseInt((markLine.match(/\d+/) || [29])[0], 10);
    const note = body(c, 'MARK 29\nNOTE it stops here').slice(1).join(' ').replace(/^NOTE\s*/i, '');
    for (let d = 1; d <= 31; d++) {
      const i = d + 5;                                  // 1st falls on a Saturday
      const r = Math.floor(i / cols), col = i % cols;
      const x = gx + cw * col + 4, y = gy + chh * r + 3;
      ctx.fillText(String(d), x, y);
      if (d === mark) {
        ctx.save();
        ctx.strokeStyle = '#b03a4a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(gx + cw * (col + 0.5), gy + chh * (r + 0.4), cw * 0.34, chh * 0.3, 0.15, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        if (note) {
          ctx.save();
          ctx.fillStyle = '#b03a4a';
          setFont(ctx, f * 0.5);
          ctx.fillText(note.slice(0, 18), gx + cw * col + 4, gy + chh * (r + 0.62));
          ctx.restore();
        }
      }
    }
  });

  /* Blueprint: white line-work on cyanotype blue, with a title block in the
     corner. Inverted from every other paper template here, which is exactly
     what a blueprint is. */
  template('blueprint', 'Blueprint', (ctx, W, H, c) => {
    const f = typeOf(c, W, H);
    ctx.fillStyle = '#12386b';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    const grid = Math.max(12, Math.min(W, H) / 22);
    for (let x = 0; x <= W; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 2;
    // A plan: an outer wall, an inner room, a door gap and a dimension line.
    const px = W * 0.14, py = H * 0.16, pw = W * 0.52, ph = H * 0.52;
    ctx.strokeRect(px, py, pw, ph);
    ctx.strokeRect(px + pw * 0.12, py + ph * 0.16, pw * 0.42, ph * 0.46);
    ctx.save();
    ctx.strokeStyle = '#12386b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(px + pw * 0.62, py + ph); ctx.lineTo(px + pw * 0.82, py + ph);
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py - 12); ctx.lineTo(px + pw, py - 12);
    ctx.moveTo(px, py - 16); ctx.lineTo(px, py - 8);
    ctx.moveTo(px + pw, py - 16); ctx.lineTo(px + pw, py - 8);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    setFont(ctx, f * 0.55);
    ctx.fillText(macros(c.extra || '47\'-0"'), px + pw / 2, py - 15);
    // Title block, bottom right, which is where every drawing carries its name.
    const tw = W * 0.32, th = H * 0.2;
    const tx = W - tw - W * 0.05, ty = H - th - H * 0.06;
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.strokeRect(tx, ty, tw, th);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    setFont(ctx, f * 0.7);
    ctx.fillText(title(c, 'LOWER SITE — PLAN'), tx + 6, ty + 5);
    setFont(ctx, f * 0.5);
    let y = ty + th * 0.36;
    ctx.save(); ctx.globalAlpha = 0.85;
    for (const l of body(c, 'DWG  0347-B\nSCALE  1:47\nDATE  03/47/97\nREV  —')) { ctx.fillText(l, tx + 6, y); y += th * 0.15; }
    ctx.restore();
    ctx.fillStyle = INK;
  });

  /* Map with pins. A coastline-ish shape, roads, and numbered markers. The
     numbers matter: an unlabelled pin is decoration, a numbered one is a claim
     the author can write a legend against. */
  template('map', 'Map with Pins', (ctx, W, H, c) => {
    const f = typeOf(c, W, H);
    sheet(ctx, W, H, '#e8e2cd');
    seedStatic('map');
    // Landmass: a closed wobbling loop, so it reads as coast rather than blob.
    ctx.fillStyle = '#d6dcc4';
    ctx.beginPath();
    const cx = W * 0.5, cy = H * 0.48, rr = Math.min(W, H) * 0.42;
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const r = rr * (0.72 + rnd() * 0.42);
      const x = cx + Math.cos(a) * r * 1.15, y = cy + Math.sin(a) * r * 0.85;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    ctx.save();
    ctx.strokeStyle = 'rgba(120,110,88,.55)';
    ctx.stroke();
    // Roads.
    ctx.strokeStyle = 'rgba(160,120,80,.7)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      let x = rnd() * W, y = rnd() * H;
      ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (rnd() - 0.5) * W * 0.45; y += (rnd() - 0.5) * H * 0.45; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.restore();
    const pins = body(c, '1|STATION 47\n2|LOWER SITE\n3|LAST SIGNAL');
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    pins.forEach((p, i) => {
      const [num] = p.split('|');
      const a = (i / Math.max(1, pins.length)) * Math.PI * 2 + 0.6;
      const x = cx + Math.cos(a) * rr * 0.55, y = cy + Math.sin(a) * rr * 0.45;
      const r = Math.max(7, Math.min(W, H) * 0.035);
      ctx.fillStyle = '#b03a4a';
      ctx.beginPath();
      ctx.arc(x, y - r, r, Math.PI * 0.15, Math.PI * 0.85, true);
      ctx.lineTo(x, y + r * 0.9);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      setFont(ctx, r * 0.95);
      ctx.fillText(num.trim().slice(0, 2), x, y - r);
    });
    // Legend box, bottom left.
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const fs = f * 0.55;
    setFont(ctx, fs);
    const lh = fs * 1.5;
    const bw = W * 0.34, bh = lh * (pins.length + 1.4);
    ctx.fillStyle = 'rgba(255,253,245,.9)';
    ctx.fillRect(W * 0.04, H - bh - H * 0.05, bw, bh);
    ctx.strokeStyle = FAINT;
    ctx.strokeRect(W * 0.04, H - bh - H * 0.05, bw, bh);
    ctx.fillStyle = INK;
    setFont(ctx, fs * 1.1);
    ctx.fillText(title(c, 'SITE SURVEY'), W * 0.04 + 5, H - bh - H * 0.05 + 4);
    setFont(ctx, fs);
    let ly = H - bh - H * 0.05 + lh * 1.3;
    for (const p of pins) { ctx.fillText(p.replace('|', '.  '), W * 0.04 + 5, ly); ly += lh; }
  });

  /* Autopsy form: an anatomical outline with numbered findings beside it. The
     outline is deliberately schematic — this is a form, not an illustration. */
  template('autopsy', 'Autopsy Form', (ctx, W, H, c) => {
    const f = typeOf(c, W, H);
    sheet(ctx, W, H, PAPER);
    // Capped against the height for the reason the calendar's is — see there.
    // The figure's height comes out of H, so a 12:1 slot used to leave it
    // negative and the head threw on a negative arc radius.
    const pad = Math.min(W * 0.05, H * 0.10);
    setFont(ctx, f * 0.9);
    ctx.fillText(macros(c.extra || 'OFFICE OF THE MEDICAL EXAMINER — POST-MORTEM'), pad, pad * 0.5);
    rule(ctx, pad, pad * 0.5 + f * 1.4, W - pad * 2, 0.8);
    const fs = f * 0.58;
    setFont(ctx, fs);
    let y = pad * 1.5;
    ctx.fillText('CASE {{case}}'.replace('{{case}}', macros('{{case}}')) + '    ' + title(c, 'DECEASED: UNIDENTIFIED'), pad, y);
    y += fs * 2;
    // Figure: head, torso, limbs. Schematic on purpose.
    const fx = pad + (W - pad * 2) * 0.18, fy = y + 10;
    const fh = Math.max(8, H - fy - pad * 1.2);
    ctx.save();
    ctx.strokeStyle = FAINT;
    ctx.lineWidth = 1.5;
    const hr = fh * 0.075;
    ctx.beginPath(); ctx.arc(fx, fy + hr, hr, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(fx, fy + hr * 2);
    ctx.lineTo(fx, fy + fh * 0.55);
    ctx.moveTo(fx - fh * 0.11, fy + fh * 0.24); ctx.lineTo(fx + fh * 0.11, fy + fh * 0.24);
    ctx.moveTo(fx, fy + fh * 0.55); ctx.lineTo(fx - fh * 0.09, fy + fh * 0.9);
    ctx.moveTo(fx, fy + fh * 0.55); ctx.lineTo(fx + fh * 0.09, fy + fh * 0.9);
    ctx.stroke();
    ctx.restore();
    const findings = body(c, '1|NO EXTERNAL INJURY\n2|CORE TEMP 47°\n3|AUDITORY CANALS — OBSTRUCTED\n4|CAUSE OF DEATH: UNDETERMINED');
    ctx.textAlign = 'left';
    let ly = fy;
    const lx = pad + (W - pad * 2) * 0.42;
    findings.forEach((f, i) => {
      const [num, ...rest] = f.split('|');
      // The marker on the figure and the numbered line beside it are the same
      // number — that pairing is the whole grammar of the form.
      const my = fy + fh * (0.14 + i * 0.19);
      ctx.save();
      ctx.strokeStyle = '#b03a4a';
      ctx.beginPath(); ctx.arc(fx + (i % 2 ? fh * 0.06 : -fh * 0.06), my, fs * 0.8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(fx + (i % 2 ? fh * 0.06 : -fh * 0.06) + fs * 0.8, my);
      ctx.lineTo(lx - 6, ly + fs * 0.6);
      ctx.stroke();
      ctx.fillStyle = '#b03a4a';
      setFont(ctx, fs * 0.8);
      ctx.textAlign = 'center';
      ctx.fillText(num.trim(), fx + (i % 2 ? fh * 0.06 : -fh * 0.06), my - fs * 0.4);
      ctx.restore();
      ctx.fillStyle = INK;
      ctx.textAlign = 'left';
      setFont(ctx, fs);
      ctx.fillText(num.trim() + '.  ' + rest.join('|'), lx, ly);
      rule(ctx, lx, ly + fs * 1.35, W - lx - pad, 0.35);
      ly += fs * 2.4;
    });
  });
}

/** Ids registered by this file — used by the tests to prove none went missing. */
export const EXTRA2_TEMPLATE_IDS = [
  'clipping', 'policereport', 'evidence', 'journal', 'prescription',
  'boardingpass', 'statement', 'certificate', 'floppy', 'cdlabel',
  'punchcard', 'calendar', 'blueprint', 'map', 'autopsy',
];
