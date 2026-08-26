/* Flow layout engine.

   Produces page-by-page draw operations and field definitions in PDF user
   space (origin bottom-left, points). The on-screen preview and the PDF
   writer both consume this output, so what the editor shows is what the PDF
   contains - there is no second layout pass to drift out of sync. */
(function (global) {
  'use strict';

  var M = global.Metrics;

  var DEFAULT_STYLE = {
    pageW: 612, pageH: 792,
    marginTop: 39, marginRight: 26, marginBottom: 26, marginLeft: 26,
    titleSize: 15, subSize: 7.5, introSize: 6.8,
    bannerSize: 9, bannerH: 13,
    qSize: 8.2, optSize: 7.6, hintSize: 7, noteSize: 7,
    pitch: 11.4, boxSize: 9, labelDX: 13, gap: 6,
    fieldH: 11, fieldMaxLen: 100, fieldPad: 3,
    blockGap: 5, colGutter: 10,
    fieldBg: [0.8, 0.843, 1], ruleColor: [0.667, 0.718, 0.722],
    hintColor: [0.439, 0.482, 0.486], introColor: [0.565, 0.58, 0.592],
    titleColor: [0.29, 0.137, 0.353], bannerText: [0.106, 0.149, 0.192],
    textColor: [0, 0, 0]
  };

  function lineH(size) { return size * 1.2; }

  /* Vertical geometry of a text-field block, as drops from the block's top
     edge. Measurement and drawing both read this, so the box a block reserves
     always contains the field it draws.

     An inline field is centred on the label the way the reference template
     does it. A field taller than one line grows downward from there — growing
     upward would push it into the item above. */
  function textGeom(block, st) {
    var fh = block.multiline ? (block.height || st.fieldH * 2) : st.fieldH;
    var labelH = lineH(st.qSize);
    var baseDrop = labelH - st.qSize * 0.25;
    if (!block.labelInline) {
      return { fh: fh, baseDrop: baseDrop, fieldTopDrop: labelH,
               fieldBotDrop: labelH + fh, height: labelH + fh };
    }
    var fieldTopDrop = Math.max(0, baseDrop - (st.fieldH - st.fieldPad));
    return { fh: fh, baseDrop: baseDrop, fieldTopDrop: fieldTopDrop,
             fieldBotDrop: fieldTopDrop + fh,
             height: Math.max(baseDrop + st.fieldPad, fieldTopDrop + fh) };
  }

  function fieldNameFor(block, opt) {
    if (!block.name) return '';
    if (block.kind === 'checks') return block.name + '_' + opt.index;
    return block.name;
  }

  function columnGeometry(st, cols) {
    var contentW = st.pageW - st.marginLeft - st.marginRight;
    var colW = (contentW - st.colGutter * (cols - 1)) / cols;
    var xs = [], i;
    for (i = 0; i < cols; i++) xs.push(st.marginLeft + i * (colW + st.colGutter));
    return { contentW: contentW, colW: colW, xs: xs };
  }

  /* --- per-block measurement + emission -------------------------------- */

  function measureBlock(block, st) {
    var contentW = st.pageW - st.marginLeft - st.marginRight, h = 0;

    if (block.kind === 'heading') return st.bannerH + st.blockGap;

    if (block.kind === 'spacer') return (block.height || 8);

    if (block.kind === 'note') {
      var size = block.size || st.noteSize;
      return M.wrap(block.label, block.italic ? 'HO' : (block.bold ? 'HB' : 'H'), size, contentW).length
        * lineH(size) + st.blockGap;
    }

    if (block.kind === 'text') return textGeom(block, st).height + st.blockGap;

    // checks
    var geo = columnGeometry(st, block.columns || 1);
    var opts = block.options.filter(function (o) { return o.include; });
    var rows = Math.ceil(opts.length / (block.columns || 1)) || 0;
    h = lineH(st.qSize);
    var rowGap = st.pitch - lineH(st.optSize);
    for (var r = 0; r < rows; r++) {
      var maxLines = 1;
      for (var c = 0; c < (block.columns || 1); c++) {
        var o = opts[c * rows + r];
        if (!o) continue;
        maxLines = Math.max(maxLines, M.wrap(o.text, 'H', st.optSize, geo.colW - st.labelDX).length);
      }
      h += maxLines * lineH(st.optSize) + rowGap;
    }
    return h + st.blockGap;
  }

  function emitBlock(block, st, top, page) {
    var ops = page.ops, fields = page.fields;
    var contentW = st.pageW - st.marginLeft - st.marginRight;
    var right = st.pageW - st.marginRight;
    var y = top;

    if (block.kind === 'heading') {
      ops.push({ t: 'rect', x: st.marginLeft, y: y - st.bannerH, w: contentW, h: st.bannerH,
                 fill: block.color || DEFAULT_STYLE.fieldBg });
      ops.push({ t: 'text', x: st.marginLeft + 4, y: y - st.bannerH + 3.6, size: st.bannerSize,
                 font: 'HB', color: st.bannerText, str: block.label });
      return;
    }

    if (block.kind === 'spacer') return;

    if (block.kind === 'note') {
      var size = block.size || st.noteSize;
      var font = block.italic ? 'HO' : (block.bold ? 'HB' : 'H');
      M.wrap(block.label, font, size, contentW).forEach(function (ln, i) {
        ops.push({ t: 'text', x: st.marginLeft, y: y - lineH(size) * (i + 1) + size * 0.25,
                   size: size, font: font, color: block.color || st.textColor, str: ln });
      });
      return;
    }

    if (block.kind === 'text') {
      var g = textGeom(block, st);
      var fh = g.fh;
      var labelBase = y - g.baseDrop, fx, fw;
      var fyBottom = y - g.fieldBotDrop;

      if (block.labelInline) {
        var lw = block.label ? M.widthOf(block.label, 'HB', st.qSize) : 0;
        if (block.label) {
          ops.push({ t: 'text', x: st.marginLeft, y: labelBase, size: st.qSize, font: 'HB',
                     color: st.textColor, str: block.label });
        }
        fx = st.marginLeft + (block.label ? lw + st.gap : 0);
        if (block.hint) {
          var hw = M.widthOf(block.hint, 'HO', st.hintSize);
          ops.push({ t: 'text', x: fx, y: labelBase, size: st.hintSize, font: 'HO',
                     color: st.hintColor, str: block.hint });
          fx += hw + st.gap;
        }
        fw = right - fx;
      } else {
        if (block.label) {
          ops.push({ t: 'text', x: st.marginLeft, y: labelBase, size: st.qSize, font: 'HB',
                     color: st.textColor, str: block.label });
        }
        if (block.hint) {
          ops.push({ t: 'text', x: st.marginLeft + M.widthOf(block.label, 'HB', st.qSize) + st.gap,
                     y: labelBase, size: st.hintSize, font: 'HO', color: st.hintColor, str: block.hint });
        }
        fx = st.marginLeft;
        fw = contentW;
      }

      ops.push({ t: 'line', x1: fx, y1: fyBottom - 0.5, x2: right, y2: fyBottom - 0.5,
                 w: 0.5, color: st.ruleColor });
      fields.push({
        kind: 'text', name: block.name, x: fx, y: fyBottom, w: Math.max(fw, 20), h: fh,
        maxLen: block.multiline ? 0 : (block.maxLen || st.fieldMaxLen),
        multiline: !!block.multiline, size: 8, bg: st.fieldBg,
        ref: { qid: block.qid, blockId: block.id }
      });
      return;
    }

    // checks
    var cols = block.columns || 1;
    var geo = columnGeometry(st, cols);
    var opts = block.options.filter(function (o) { return o.include; });
    var rows = Math.ceil(opts.length / cols) || 0;
    var qBase = y - lineH(st.qSize) + st.qSize * 0.25;
    if (block.label) {
      ops.push({ t: 'text', x: st.marginLeft, y: qBase, size: st.qSize, font: 'HB',
                 color: st.textColor, str: block.label });
    }
    if (block.hint) {
      ops.push({ t: 'text', x: st.marginLeft + M.widthOf(block.label, 'HB', st.qSize) + st.gap,
                 y: qBase, size: st.hintSize, font: 'HO', color: st.hintColor, str: block.hint });
    }

    var rowTop = y - lineH(st.qSize);
    var rowGap = st.pitch - lineH(st.optSize);
    for (var r = 0; r < rows; r++) {
      var maxLines = 1;
      for (var c = 0; c < cols; c++) {
        var o = opts[c * rows + r];
        if (!o) continue;
        var lines = M.wrap(o.text, 'H', st.optSize, geo.colW - st.labelDX);
        maxLines = Math.max(maxLines, lines.length);
        var base = rowTop - lineH(st.optSize) + st.optSize * 0.25;
        lines.forEach(function (ln, li) {
          ops.push({ t: 'text', x: geo.xs[c] + st.labelDX, y: base - li * lineH(st.optSize),
                     size: st.optSize, font: 'H', color: st.textColor, str: ln });
        });
        fields.push({
          kind: 'check', name: fieldNameFor(block, o), x: geo.xs[c], y: base - 1,
          w: st.boxSize, h: st.boxSize, exclusive: !!block.exclusive,
          // where the editor can park the name tag without covering the answer
          tagDX: st.labelDX + M.widthOf(lines[0], 'H', st.optSize) + 4,
          ref: { qid: block.qid, aid: o.aid, index: o.index, blockId: block.id }
        });
      }
      rowTop -= maxLines * lineH(st.optSize) + rowGap;
    }
  }

  /* --- document ---------------------------------------------------------- */

  function layout(doc) {
    var st = Object.assign({}, DEFAULT_STYLE, doc.style || {});
    var pages = [], warnings = [], seen = {};

    function newPage() {
      var p = { ops: [], fields: [] };
      pages.push(p);
      return p;
    }

    var page = newPage();
    var y = st.pageH - st.marginTop;
    var boxes = [];

    // page-1 masthead
    var h = doc.header || {};
    if (h.title) {
      y -= st.titleSize;
      page.ops.push({ t: 'text', x: st.marginLeft, y: y, size: st.titleSize, font: 'HB',
                      color: st.titleColor, str: h.title });
      if (h.note) {
        var nw = M.widthOf(h.note, 'HB', st.subSize);
        page.ops.push({ t: 'text', x: st.pageW - st.marginRight - nw, y: y + 2, size: st.subSize,
                        font: 'HB', color: st.hintColor, str: h.note });
      }
      y -= 4;
    }
    if (h.intro) {
      M.wrap(h.intro, 'HO', st.introSize, st.pageW - st.marginLeft - st.marginRight)
        .forEach(function (ln) {
          y -= lineH(st.introSize);
          page.ops.push({ t: 'text', x: st.marginLeft, y: y, size: st.introSize, font: 'HO',
                          color: st.introColor, str: ln });
        });
      y -= 3;
    }

    doc.blocks.forEach(function (block) {
      if (!block.include) return;
      if (block.kind === 'checks' && !block.options.some(function (o) { return o.include; })) return;

      var bh = measureBlock(block, st);
      y -= (block.spaceBefore || 0);

      if (block.pageBreakBefore && page.ops.length) { page = newPage(); y = st.pageH - st.marginTop; }
      if (y - bh < st.marginBottom) { page = newPage(); y = st.pageH - st.marginTop; }

      emitBlock(block, st, y, page);
      boxes.push({ blockId: block.id, page: pages.length - 1, top: y, height: bh - st.blockGap });
      y -= bh;
    });

    // field-name validation across the whole document
    pages.forEach(function (p, pi) {
      p.fields.forEach(function (f) {
        f.page = pi;
        if (!f.name) { warnings.push({ level: 'error', msg: 'Unnamed field', ref: f.ref }); return; }
        if (!global.Model.validName(f.name)) {
          warnings.push({ level: 'error', msg: 'Invalid field name "' + f.name + '" (use lowercase letters, digits, underscore)', ref: f.ref });
        }
        if (seen[f.name]) warnings.push({ level: 'error', msg: 'Duplicate field name "' + f.name + '"', ref: f.ref });
        seen[f.name] = true;
      });
    });

    doc.blocks.forEach(function (b) {
      if (!b.include) return;
      var texts = [b.label, b.hint].concat((b.options || []).map(function (o) { return o.text; }));
      if (texts.some(function (t) { return t && t.indexOf('\uFFFD') >= 0; })) {
        warnings.push({ level: 'warn', ref: { blockId: b.id },
          msg: '"' + (b.label || '').slice(0, 40) + '" contains characters the import could not read (shown as \uFFFD). Retype them.' });
      }
    });

    doc.blocks.forEach(function (b) {
      if (b.include && b.kind === 'checks') {
        var dropped = b.options.filter(function (o) { return !o.include; });
        if (dropped.length) {
          warnings.push({ level: 'info', ref: { blockId: b.id },
            msg: '"' + b.label + '" hides ' + dropped.length + ' answer(s); numbers ' +
                 dropped.map(function (o) { return b.name + '_' + o.index; }).join(', ') +
                 ' stay reserved so the rest keep their Credible positions.' });
        }
        var isNew = b.options.filter(function (o) { return o.isNew; });
        if (isNew.length) {
          warnings.push({ level: 'warn', ref: { blockId: b.id },
            msg: '"' + b.label + '" has ' + isNew.length + ' answer(s) added since the saved layout.' });
        }
      }
    });

    return { pages: pages, warnings: warnings, style: st, boxes: boxes };
  }

  global.Layout = { layout: layout, DEFAULT_STYLE: DEFAULT_STYLE, fieldNameFor: fieldNameFor, columnGeometry: columnGeometry };
})(window);
