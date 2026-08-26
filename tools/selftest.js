#!/usr/bin/env node
/* End-to-end checks over the sample export.

   The rules under test are the ones that silently corrupt data when they
   break: a field name must stay attached to the Credible answer it was
   assigned to, whatever happens to the page layout.

   Usage: node tools/selftest.js [export.csv] */
'use strict';
const fs = require('fs');
const path = require('path');

global.window = global;
['metrics', 'csv', 'model', 'layout', 'pdf'].forEach((m) =>
  require(path.join(__dirname, '..', 'js', m + '.js')));

const csvPath = process.argv[2] || path.join(__dirname, '..', 'export_663_08262026.csv');
const raw = fs.readFileSync(csvPath, 'utf8');

let failures = 0;
function ok(cond, label, detail) {
  if (cond) console.log(`  pass  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
}
function section(t) { console.log(`\n${t}`); }

function freshDoc(text) {
  const parsed = window.CSV.parse(text);
  return window.Model.buildDoc(window.Model.buildForm(parsed.rows),
    Object.assign({}, window.Layout.DEFAULT_STYLE));
}
function blockByQid(doc, qid) { return doc.blocks.find((b) => b.qid === qid); }
function fieldsOf(res) { return res.pages.reduce((a, p) => a.concat(p.fields), []); }

/* ---------------------------------------------------------------- */
section('Import');
const doc = freshDoc(raw);
ok(doc.blocks.length === 39, 'all 39 questions become blocks', `got ${doc.blocks.length}`);
ok(doc.blocks.filter((b) => b.kind === 'checks').length === 12, '12 checkbox/radio questions');
ok(doc.blocks.filter((b) => b.kind === 'text').length === 16, '16 text questions');
ok(doc.blocks.some((b) => b.excludedReason === 'style block'),
  'the CSS-only label is excluded, not rendered');
ok(blockByQid(doc, '615354').exclusive === true, 'RB question is marked exclusive');

/* ---------------------------------------------------------------- */
section('Field numbering follows the Credible answer order');
const plan = blockByQid(doc, '615322');
plan.name = 'plan_for';
plan.columns = 2;
let res = window.Layout.layout(doc);
let planFields = fieldsOf(res).filter((f) => f.ref.blockId === plan.id);

ok(planFields.length === 5, 'five checkboxes emitted');
const byName = {};
planFields.forEach((f) => { byName[f.name] = f; });
ok(Object.keys(byName).sort().join(',') === 'plan_for_1,plan_for_2,plan_for_3,plan_for_4,plan_for_5',
  'names are plan_for_1 … plan_for_5');
const a5 = plan.options.find((o) => o.index === 5);
ok(byName['plan_for_5'].ref.aid === a5.aid,
  'plan_for_5 is bound to the answer Credible sorts 5th',
  `expected answer id ${a5.aid}, got ${byName['plan_for_5'].ref.aid}`);

section('Layout changes cannot move a name to another answer');
const before = plan.options.map((o) => `${o.index}:${o.aid}`).join(' ');
plan.options.reverse();                       // rearrange the page order
res = window.Layout.layout(doc);
planFields = fieldsOf(res).filter((f) => f.ref.blockId === plan.id);
const after = plan.options.slice().sort((a, b) => a.index - b.index)
  .map((o) => `${o.index}:${o.aid}`).join(' ');
ok(before === after, 'reversing the display order leaves every index on its own answer');
ok(planFields.find((f) => f.name === 'plan_for_5').ref.aid === a5.aid,
  'plan_for_5 still points at the same answer after reordering');
plan.options.reverse();

section('Hiding an answer reserves its number');
plan.options.find((o) => o.index === 2).include = false;
res = window.Layout.layout(doc);
const names = fieldsOf(res).filter((f) => f.ref.blockId === plan.id).map((f) => f.name).sort();
ok(names.join(',') === 'plan_for_1,plan_for_3,plan_for_4,plan_for_5',
  'plan_for_2 disappears and the rest keep their numbers', names.join(','));
ok(res.warnings.some((w) => w.level === 'info' && /reserved/.test(w.msg)),
  'the reserved number is reported');
plan.options.find((o) => o.index === 2).include = true;

section('Two columns fill column-major, as the reference template does');
res = window.Layout.layout(doc);
planFields = fieldsOf(res).filter((f) => f.ref.blockId === plan.id);
const col1 = planFields.filter((f) => f.x < 200).map((f) => f.name);
const col2 = planFields.filter((f) => f.x >= 200).map((f) => f.name);
ok(col1.join(',') === 'plan_for_1,plan_for_2,plan_for_3', 'first column holds 1–3', col1.join(','));
ok(col2.join(',') === 'plan_for_4,plan_for_5', 'second column holds 4–5', col2.join(','));

/* ---------------------------------------------------------------- */
section('Re-importing a changed form keeps the names');
// Drop the answer Credible added most recently (TheHotline.org, a_ord 11)
const older = raw.split('\n').filter((l) => l.indexOf('1139010') < 0).join('\n');
const oldDoc = freshDoc(older);
const resources = blockByQid(oldDoc, '615332');
resources.name = 'crisis_prof_2';
resources.label = 'My Crisis Resources';
resources.options.forEach((o) => { o.text = o.text.toUpperCase(); });
ok(resources.options.length === 10, 'the older export has 10 crisis resources');

const merged = window.Model.mergeDoc(oldDoc, freshDoc(raw));
const after11 = blockByQid(merged.doc, '615332');
ok(after11.options.length === 11, 'the new export brings 11');
ok(after11.name === 'crisis_prof_2', 'the base name survives re-import');
ok(after11.label === 'My Crisis Resources', 'edited wording survives re-import');
ok(after11.options.filter((o) => o.isNew).length === 1, 'exactly one answer is flagged as new');
ok(after11.options.find((o) => o.isNew).index === 11, 'the new answer takes position 11');
ok(after11.options.filter((o) => !o.isNew).every((o) => o.text === o.text.toUpperCase()),
  'edits to the ten existing answers are preserved');
ok(merged.report.addedAnswers.length === 1 && merged.report.removedAnswers.length === 0,
  'the merge report names the single addition');

/* ---------------------------------------------------------------- */
section('Nothing overlaps anything else');
{
  const g = freshDoc(raw);
  // exercise every text-field shape, including a tall one on the label's line
  const texts = g.blocks.filter((b) => b.kind === 'text');
  texts[0].labelInline = true;  texts[0].multiline = false;
  texts[1].labelInline = true;  texts[1].multiline = true;  texts[1].height = 30;
  texts[2].labelInline = false; texts[2].multiline = true;  texts[2].height = 26;
  texts[3].labelInline = false; texts[3].multiline = false;

  const gres = window.Layout.layout(g);
  const box = {};
  gres.boxes.forEach((b) => { box[b.blockId] = b; });

  let escapes = 0, worst = null;
  fieldsOf(gres).forEach((f) => {
    const b = box[f.ref.blockId];
    if (!b) return;
    const above = (f.y + f.h) - b.top;          // field pokes out of the top
    const below = (b.top - b.height) - f.y;      // field hangs below the bottom
    const over = Math.max(above, 0) + Math.max(below, 0);
    if (over > 0.01) { escapes++; if (!worst || over > worst.over) worst = { name: f.name, over }; }
  });
  ok(escapes === 0, 'every field stays inside the space its item reserved',
    worst && `${worst.name} escapes by ${worst.over.toFixed(2)}pt (${escapes} fields)`);

  let collisions = 0, example = null;
  for (let p = 0; p < gres.pages.length; p++) {
    const onPage = gres.boxes.filter((b) => b.page === p)
      .slice().sort((a, b) => b.top - a.top);
    for (let i = 1; i < onPage.length; i++) {
      const prev = onPage[i - 1], cur = onPage[i];
      if (cur.top > prev.top - prev.height + 0.01) {
        collisions++;
        if (!example) example = `${prev.blockId} ends ${(prev.top - prev.height).toFixed(2)}, ${cur.blockId} starts ${cur.top.toFixed(2)}`;
      }
    }
  }
  ok(collisions === 0, 'no two items claim the same vertical space', example);

  const tall = fieldsOf(gres).find((f) => f.ref.blockId === texts[1].id);
  ok(tall && Math.abs(tall.h - 30) < 0.01, 'a multi-line field keeps the height it was given');
}

section('Unreadable characters are reported');
{
  const bad = freshDoc(raw);
  const t = bad.blocks.find((b) => b.kind === 'text');
  t.label = 'Discuss in advance (\uFFFDI believe in you\uFFFD)';
  ok(window.Layout.layout(bad).warnings.some((w) => /could not read/.test(w.msg)),
    'a label holding U+FFFD raises a warning');
}

/* ---------------------------------------------------------------- */
section('Hand-made headings and text');
const withCustom = freshDoc(raw);
const anchorIdx = withCustom.blocks.findIndex((b) => b.qid === '615330');
const heading = window.Model.newBlock('heading', withCustom.style);
heading.label = 'STAFF USE ONLY';
withCustom.blocks.splice(anchorIdx + 1, 0, heading);
const note = window.Model.newBlock('note', withCustom.style);
note.label = 'Reviewed with the client on:';
withCustom.blocks.push(note);

let cres = window.Layout.layout(withCustom);
ok(cres.boxes.some((x) => x.blockId === heading.id), 'a hand-made heading is laid out');
ok(cres.pages.some((p) => p.ops.some((o) => o.t === 'text' && o.str === 'STAFF USE ONLY')),
  'its wording reaches the page');
ok(cres.pages.some((p) => p.ops.some((o) => o.t === 'rect' && Math.abs(o.h - cres.style.bannerH) < 0.01)),
  'a heading draws a banner rectangle');
ok(cres.warnings.filter((w) => w.level === 'error').length === 0,
  'hand-made items need no field name');

heading.kind = 'note';
cres = window.Layout.layout(withCustom);
ok(cres.pages.some((p) => p.ops.some((o) => o.t === 'text' && o.str === 'STAFF USE ONLY')),
  'switching a heading to plain text keeps the wording');
heading.kind = 'heading';

const cMerged = window.Model.mergeDoc(withCustom, freshDoc(raw));
const kept = cMerged.doc.blocks.filter((b) => !b.qid);
ok(kept.length === 2, 're-import keeps both hand-made items', `got ${kept.length}`);
ok(cMerged.report.custom === 2, 'the merge report counts them');
const pos = cMerged.doc.blocks.findIndex((b) => b.id === heading.id);
ok(cMerged.doc.blocks[pos - 1].qid === '615330',
  'the heading comes back directly after the question it followed');
ok(cMerged.doc.blocks[cMerged.doc.blocks.length - 1].id === note.id,
  'a trailing item stays at the end');

/* ---------------------------------------------------------------- */
section('Naming validation');
const dup = freshDoc(raw);
dup.blocks.filter((b) => b.kind === 'text').slice(0, 2).forEach((b) => { b.name = 'same_name'; });
ok(window.Layout.layout(dup).warnings.some((w) => /Duplicate/.test(w.msg)), 'duplicates are caught');
const bad = freshDoc(raw);
bad.blocks.find((b) => b.kind === 'text').name = 'Not Valid';
ok(window.Layout.layout(bad).warnings.some((w) => /Invalid field name/.test(w.msg)),
  'illegal characters are caught');

/* ---------------------------------------------------------------- */
section('PDF output');
const out = window.Layout.layout(doc);
const bytes = window.PDFWriter.build(out.pages, { style: out.style, title: 'selftest' });
ok(bytes.length > 10000, `writes a ${(bytes.length / 1024).toFixed(0)} KB file`);
const text = Buffer.from(bytes).toString('latin1');
ok(text.startsWith('%PDF-1.4'), 'has a PDF header');
ok(text.indexOf('/T (plan_for_5)') > 0, 'field names reach the file');
ok((text.match(/\/Subtype \/Widget/g) || []).length === fieldsOf(out).length,
  'every laid-out field becomes a widget');
const outPath = process.env.SELFTEST_PDF || path.join(require('os').tmpdir(), 'selftest.pdf');
fs.writeFileSync(outPath, Buffer.from(bytes));
console.log(`  wrote ${outPath}`);

console.log(failures ? `\n${failures} check(s) failed\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
