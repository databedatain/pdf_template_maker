#!/usr/bin/env node
/* Structural validator for generated AcroForm PDFs.

   Chromium in CI has no PDF rasteriser, so correctness is checked against the
   file structure instead: cross-reference offsets, reference resolution,
   widget/annotation/field agreement, rectangles inside the page box, balanced
   content-stream operators and unique field names.

   Usage: node tools/verify-pdf.js file.pdf [more.pdf ...] */
'use strict';
const fs = require('fs');

function parse(buf) {
  const s = buf.toString('latin1');
  const objs = new Map();
  const re = /(\d+)\s+0\s+obj\b([\s\S]*?)\bendobj/g;
  let m;
  while ((m = re.exec(s))) objs.set(+m[1], m[2]);
  return { s, objs };
}

/* Value that follows `key` in a dictionary body, handling nested << >>. */
function valueAfter(body, key, from = 0) {
  const i = body.indexOf(key, from);
  if (i < 0) return null;
  let j = i + key.length;
  while (j < body.length && /\s/.test(body[j])) j++;
  if (body.startsWith('<<', j)) {
    let depth = 0, k = j;
    while (k < body.length) {
      if (body.startsWith('<<', k)) { depth++; k += 2; continue; }
      if (body.startsWith('>>', k)) { depth--; k += 2; if (!depth) return body.slice(j + 2, k - 2); continue; }
      k++;
    }
    return body.slice(j + 2);
  }
  const rest = body.slice(j);
  const ref = /^(\d+\s+0\s+R)/.exec(rest);
  return ref ? ref[1] : rest.split(/\s/)[0];
}

function check(file) {
  const buf = fs.readFileSync(file);
  const { s, objs } = parse(buf);
  const errs = [], notes = [];

  if (!s.startsWith('%PDF-')) errs.push('missing %PDF header');
  if (s.indexOf('%%EOF') < 0) errs.push('missing %%EOF');

  // --- cross-reference table ---
  const sx = /startxref\s+(\d+)/.exec(s);
  if (!sx) errs.push('no startxref');
  else {
    const lines = s.slice(+sx[1]).split('\n');
    if (lines[0].trim() !== 'xref') notes.push('xref is a stream, offsets not checked');
    else {
      const count = +lines[1].split(/\s+/)[1];
      let bad = 0;
      for (let i = 1; i < count; i++) {
        const off = parseInt(lines[2 + i].slice(0, 10), 10);
        if (!s.startsWith(`${i} 0 obj`, off)) bad++;
      }
      if (bad) errs.push(`${bad} bad xref offset(s)`);
    }
  }

  // --- every indirect reference resolves ---
  const missing = new Set();
  for (const [, body] of objs) {
    const r = /(\d+)\s+0\s+R\b/g;
    let mm;
    while ((mm = r.exec(body))) if (!objs.has(+mm[1])) missing.add(+mm[1]);
  }
  if (missing.size) errs.push(`dangling references: ${[...missing].slice(0, 8).join(', ')}`);

  // --- pages ---
  const pages = [...objs].filter(([, b]) => /\/Type\s*\/Page\b/.test(b) && !/\/Type\s*\/Pages\b/.test(b));
  if (!pages.length) errs.push('no page objects');
  const mediaBox = {};
  for (const [id, b] of pages) {
    const mb = /\/MediaBox\s*\[([^\]]*)\]/.exec(b);
    mediaBox[id] = mb ? mb[1].trim().split(/\s+/).map(Number) : null;
    if (!mediaBox[id]) errs.push(`page ${id} has no MediaBox`);
  }

  // --- widgets ---
  const widgets = [...objs].filter(([, b]) => /\/Subtype\s*\/Widget\b/.test(b));
  const names = new Map();
  for (const [id, b] of widgets) {
    const t = /\/T\s*\((?:[^()\\]|\\.)*\)/.exec(b);
    const name = t ? t[0].slice(t[0].indexOf('(') + 1, -1) : null;
    if (!name) { errs.push(`widget ${id} has no /T name`); continue; }
    names.set(name, (names.get(name) || 0) + 1);

    const p = /\/P\s+(\d+)\s+0\s+R/.exec(b);
    if (!p) errs.push(`widget ${id} (${name}) has no /P page reference`);
    else {
      const pageBody = objs.get(+p[1]) || '';
      if (!new RegExp(`\\b${id}\\s+0\\s+R`).test(pageBody)) {
        errs.push(`widget ${id} (${name}) is not in page ${p[1]} /Annots`);
      }
      const rect = /\/Rect\s*\[([^\]]*)\]/.exec(b);
      if (!rect) errs.push(`widget ${id} (${name}) has no /Rect`);
      else {
        const [x0, y0, x1, y1] = rect[1].trim().split(/\s+/).map(Number);
        const mb = mediaBox[+p[1]];
        if (x1 <= x0 || y1 <= y0) errs.push(`widget ${name} has an inverted /Rect`);
        if (mb && (x0 < mb[0] - 0.5 || y0 < mb[1] - 0.5 || x1 > mb[2] + 0.5 || y1 > mb[3] + 0.5)) {
          errs.push(`widget ${name} /Rect falls outside the page box`);
        }
      }
    }

    if (/\/FT\s*\/Btn\b/.test(b)) {
      const apDict = valueAfter(b, '/AP');
      const nDict = apDict === null ? null : valueAfter(apDict, '/N');
      if (nDict === null) errs.push(`checkbox ${name} has no /AP /N dictionary`);
      else {
        if (!/\/Off\s+\d+\s+0\s+R/.test(nDict)) errs.push(`checkbox ${name} has no /Off appearance`);
        const onState = /\/(\w+)\s+\d+\s+0\s+R/g;
        const states = [];
        let sm;
        while ((sm = onState.exec(nDict))) states.push(sm[1]);
        if (states.filter((x) => x !== 'Off').length === 0) errs.push(`checkbox ${name} has no on-state appearance`);
        const as = /\/AS\s*\/(\w+)/.exec(b);
        if (!as) errs.push(`checkbox ${name} has no /AS`);
        else if (states.indexOf(as[1]) < 0) errs.push(`checkbox ${name} /AS ${as[1]} has no appearance`);
      }
    }
    if (/\/FT\s*\/Tx\b/.test(b) && !/\/DA\s*\(/.test(b)) errs.push(`text field ${name} has no /DA`);
  }
  for (const [n, c] of names) if (c > 1) errs.push(`duplicate field name "${n}" (${c}x)`);

  // --- AcroForm ---
  const acro = [...objs].find(([, b]) => /\/Fields\s*\[/.test(b) && /\/DA\s*\(/.test(b));
  if (!acro) errs.push('no AcroForm dictionary');
  else {
    const ids = (/\/Fields\s*\[([^\]]*)\]/.exec(acro[1])[1].match(/\d+(?=\s+0\s+R)/g) || []).map(Number);
    const widgetIds = new Set(widgets.map(([id]) => id));
    const notField = ids.filter((i) => !widgetIds.has(i));
    const notListed = [...widgetIds].filter((i) => ids.indexOf(i) < 0);
    if (notField.length) errs.push(`/Fields lists ${notField.length} object(s) that are not widgets`);
    if (notListed.length) errs.push(`${notListed.length} widget(s) missing from /Fields`);
  }

  // --- content streams ---
  let checkedStreams = 0;
  for (const [id, b] of objs) {
    if (/\/Filter/.test(b)) continue;               // compressed, skip
    const st = b.indexOf('stream');
    if (st < 0) continue;
    const len = /\/Length\s+(\d+)/.exec(b);
    const data = b.slice(b.indexOf('\n', st) + 1, b.lastIndexOf('endstream') - 1);
    if (len && Math.abs(data.length - +len[1]) > 1) {
      errs.push(`object ${id}: /Length ${len[1]} but ${data.length} bytes of stream`);
    }
    const bt = (data.match(/\bBT\b/g) || []).length, et = (data.match(/\bET\b/g) || []).length;
    const q = (data.match(/(^|\s)q(\s|$)/g) || []).length, Q = (data.match(/(^|\s)Q(\s|$)/g) || []).length;
    if (bt !== et) errs.push(`object ${id}: ${bt} BT vs ${et} ET`);
    if (q !== Q) errs.push(`object ${id}: ${q} q vs ${Q} Q`);
    checkedStreams++;
  }

  const textFields = widgets.filter(([, b]) => /\/FT\s*\/Tx\b/.test(b)).length;
  console.log(`\n${file}`);
  console.log(`  ${objs.size} objects · ${pages.length} pages · ${widgets.length} widgets ` +
    `(${widgets.length - textFields} button, ${textFields} text) · ${checkedStreams} streams checked`);
  notes.forEach((n) => console.log(`  note:  ${n}`));
  if (errs.length) {
    errs.slice(0, 25).forEach((e) => console.log(`  FAIL:  ${e}`));
    if (errs.length > 25) console.log(`  ... and ${errs.length - 25} more`);
  } else {
    console.log('  PASS');
  }
  return errs.length;
}

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node tools/verify-pdf.js file.pdf'); process.exit(2); }
process.exit(files.reduce((a, f) => a + check(f), 0) ? 1 : 0);
