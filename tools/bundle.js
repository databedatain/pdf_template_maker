#!/usr/bin/env node
/* Inline the CSS and JS into one self-contained index file.

   A single .html is easier to hand round than a folder — it can be emailed,
   dropped on a network share, or opened straight from Downloads without
   anyone having to keep the css/ and js/ folders next to it.

   Usage: node tools/bundle.js [out.html] */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const artifact = args.indexOf('--artifact') >= 0;
const out = args.filter((a) => a[0] !== '-')[0] ||
  path.join(root, 'dist', artifact ? 'artifact.html' : 'pdf-template-maker.html');

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) =>
  '<style>\n' + fs.readFileSync(path.join(root, href), 'utf8') + '\n</style>');

html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) =>
  '<script>\n' + fs.readFileSync(path.join(root, src), 'utf8') + '\n</script>');

const left = html.match(/(src|href)="(?!https:\/\/fonts)[^"]*"/g) || [];
if (left.length) {
  console.error('unbundled local reference(s):', left.join(', '));
  process.exit(1);
}

if (artifact) {
  // Keep <title>, the font link, styles, markup and scripts; drop the shell.
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)[1];
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)[1];
  const keep = head
    .replace(/<meta[^>]*>/gi, '')
    .replace(/<link rel="preconnect"[^>]*>/gi, '')
    .trim();
  html = keep + '\n' + body.trim() + '\n';
  if (/<!doctype|<html|<head|<body/i.test(html)) {
    console.error('document-level tags survived the artifact strip');
    process.exit(1);
  }
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out}  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
