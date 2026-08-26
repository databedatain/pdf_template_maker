/* PDF Template Maker — editor shell. */
(function () {
  'use strict';

  var LS_KEY = 'ptm.doc.v1';
  var state = { doc: null, res: null, sel: null, scale: 1, showNames: false };

  /* ---------- tiny DOM helper ---------- */
  function h(tag, attrs, kids) {
    var parts = tag.split('.'), el = document.createElement(parts[0]);
    if (parts.length > 1) el.className = parts.slice(1).join(' ');
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'data') Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
      else el.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function $(id) { return document.getElementById(id); }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function css(c) { return 'rgb(' + c.map(function (v) { return Math.round(v * 255); }).join(',') + ')'; }

  function block(id) {
    return state.doc.blocks.filter(function (b) { return b.id === id; })[0];
  }

  /* ---------- document lifecycle ---------- */

  function loadCSV(text, filename) {
    var parsed = window.CSV.parse(text);
    if (parsed.header.indexOf('question_id') < 0) {
      alert('That file does not look like a Credible form export — no question_id column.');
      return;
    }
    var form = window.Model.buildForm(parsed.rows);
    var fresh = window.Model.buildDoc(form, Object.assign({}, window.Layout.DEFAULT_STYLE));
    fresh.source.file = filename;

    if (state.doc && state.doc.source.formId === fresh.source.formId) {
      var merged = window.Model.mergeDoc(state.doc, fresh);
      state.doc = merged.doc;
      reportMerge(merged.report);
    } else {
      state.doc = fresh;
      state.doc.header.intro = '';
    }
    state.sel = null;
    render();
    fit();
  }

  function reportMerge(r) {
    var lines = ['Re-imported over the existing layout.',
      r.kept + ' question(s) matched — names, wording and arrangement kept.'];
    if (r.addedQuestions.length) lines.push('\nNew questions (' + r.addedQuestions.length + '):\n· ' + r.addedQuestions.slice(0, 12).join('\n· '));
    if (r.removedQuestions.length) lines.push('\nGone from the export (' + r.removedQuestions.length + '):\n· ' + r.removedQuestions.slice(0, 12).join('\n· '));
    if (r.addedAnswers.length) lines.push('\nNew answers (' + r.addedAnswers.length + '):\n· ' +
      r.addedAnswers.slice(0, 12).map(function (a) { return a.text + '  → position ' + a.index; }).join('\n· '));
    if (r.removedAnswers.length) lines.push('\nAnswers no longer in the export (' + r.removedAnswers.length + '):\n· ' +
      r.removedAnswers.slice(0, 12).map(function (a) { return a.text + '  (was ' + a.index + ')'; }).join('\n· '));
    alert(lines.join('\n'));
  }

  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state.doc)); } catch (e) { /* private mode */ }
  }
  function restore() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) { state.doc = JSON.parse(raw); return true; }
    } catch (e) { /* ignore */ }
    return false;
  }

  function download(name, data, mime) {
    var blob = new Blob([data], { type: mime });
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function slug(s) {
    return String(s || 'form').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'form';
  }

  /* ---------- render ---------- */

  function render() {
    if (!state.doc) { renderEmpty(); return; }
    state.res = window.Layout.layout(state.doc);
    renderOutline();
    renderPages();
    renderInspector();
    renderWarnings();
    ['btnSaveLayout', 'btnNames', 'btnPdf'].forEach(function (id) { $(id).disabled = false; });
    $('formName').innerHTML = '<b>' + escapeHtml(state.doc.source.formName || '(untitled)') + '</b> · form ' +
      escapeHtml(state.doc.source.formId || '?') +
      (state.doc.source.formVerId ? ' · ver ' + escapeHtml(state.doc.source.formVerId) : '');
    save();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function renderEmpty() {
    clear($('pages'));
    $('pages').appendChild(h('div.empty', {}, [
      h('b', { text: 'Import a Credible form export to begin' }),
      document.createTextNode('Export Builder → CSV, one row per question and answer. '),
      h('br'),
      document.createTextNode('Drop the file anywhere on this window.')
    ]));
  }

  /* --- outline --- */
  function renderOutline() {
    var list = $('blockList');
    clear(list);
    state.doc.blocks.forEach(function (b) {
      var nameEl = null;
      if (b.kind === 'checks' || b.kind === 'text') {
        var bad = b.include && !window.Model.validName(b.name);
        nameEl = h('span.fname' + (bad ? '.bad' : ''), { text: b.name ? (b.kind === 'checks' ? b.name + '_n' : b.name) : '(unnamed)' });
      }
      var row = h('div.blk' + (state.sel === b.id ? '.sel' : '') + (b.include ? '' : '.off'), {
        draggable: 'true', data: { id: b.id },
        onclick: function (e) { if (e.target.type !== 'checkbox') select(b.id); }
      }, [
        h('span.grip', { text: '⠿' }),
        h('input', {
          type: 'checkbox', class: 'inc', checked: b.include,
          onchange: function (e) { b.include = e.target.checked; render(); }
        }),
        h('div', {}, [
          h('div.lbl', { text: b.label || b.origText || '(empty)' }),
          h('div.meta', {}, [
            h('span.kind.' + b.kind, { text: b.kind }),
            b.options ? h('span.count', { text: b.options.filter(function (o) { return o.include; }).length + '/' + b.options.length }) : null,
            nameEl,
            b.excludedReason ? h('span.flag', { text: b.excludedReason }) : null,
            (b.options || []).some(function (o) { return o.isNew; }) ? h('span.flag', { text: 'new answers' }) : null
          ])
        ])
      ]);
      wireDrag(row, list, function (fromId, toId, after) { moveBlock(fromId, toId, after); });
      list.appendChild(row);
    });
  }

  function wireDrag(row, container, onDrop) {
    row.addEventListener('dragstart', function (e) {
      e.dataTransfer.setData('text/plain', row.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', function (e) {
      e.preventDefault();
      row.classList.add('dragover');
    });
    row.addEventListener('dragleave', function () { row.classList.remove('dragover'); });
    row.addEventListener('drop', function (e) {
      e.preventDefault();
      row.classList.remove('dragover');
      var from = e.dataTransfer.getData('text/plain');
      if (from && from !== row.dataset.id) onDrop(from, row.dataset.id, e.offsetY > row.offsetHeight / 2);
    });
    void container;
  }

  function moveBlock(fromId, toId, after) {
    var bs = state.doc.blocks;
    var fi = bs.findIndex(function (b) { return b.id === fromId; });
    var item = bs.splice(fi, 1)[0];
    var ti = bs.findIndex(function (b) { return b.id === toId; });
    bs.splice(ti + (after ? 1 : 0), 0, item);
    render();
  }

  function select(id) {
    state.sel = id;
    renderOutline();
    renderInspector();
    markSelection();
    var box = (state.res.boxes || []).filter(function (b) { return b.blockId === id; })[0];
    if (box) {
      var sheet = $('pages').children[box.page];
      if (sheet && sheet.scrollIntoView) {
        var top = sheet.offsetTop + (state.res.style.pageH - box.top) * state.scale - 120;
        $('pages').scrollTo({ top: top, behavior: 'smooth' });
      }
    }
  }

  function markSelection() { renderPages(); }

  /* --- preview --- */
  function fontCss(f, size) {
    var stack = ' Helvetica, Arial, "Liberation Sans", sans-serif';
    if (f === 'HB') return '600 ' + size + 'px' + stack;
    if (f === 'HO') return 'italic ' + size + 'px' + stack;
    return size + 'px' + stack;
  }

  function renderPages() {
    var host = $('pages'), st = state.res.style, sc = state.scale;
    clear(host);
    state.res.pages.forEach(function (page, pi) {
      var sheet = h('div.sheet' + (state.showNames ? '.shownames' : ''), {
        style: 'width:' + st.pageW * sc + 'px;height:' + st.pageH * sc + 'px'
      });
      sheet.appendChild(h('div.pageno', { text: 'PAGE ' + (pi + 1) + ' / ' + state.res.pages.length }));

      var cv = h('canvas');
      sheet.appendChild(cv);
      drawPage(cv, page, st, sc);

      (state.res.boxes || []).filter(function (b) { return b.page === pi; }).forEach(function (b) {
        sheet.appendChild(h('div.hit' + (state.sel === b.blockId ? '.sel' : ''), {
          data: { id: b.blockId },
          style: 'left:' + st.marginLeft * sc + 'px;top:' + (st.pageH - b.top) * sc + 'px;width:' +
            (st.pageW - st.marginLeft - st.marginRight) * sc + 'px;height:' + Math.max(b.height, 6) * sc + 'px',
          onclick: function () { select(b.blockId); }
        }));
      });

      page.fields.forEach(function (f) {
        var isSel = state.sel && f.ref.blockId === state.sel;
        sheet.appendChild(h('div.fld' + (f.kind === 'check' ? '.check' : '.textf') + (isSel ? '.sel' : ''), {
          style: 'left:' + f.x * sc + 'px;top:' + (st.pageH - f.y - f.h) * sc + 'px;width:' +
            f.w * sc + 'px;height:' + f.h * sc + 'px'
        }, [h('span.tag', {
          text: f.name || '⚠ unnamed',
          style: f.tagDX ? 'left:' + f.tagDX * sc + 'px;bottom:auto;top:0;margin:0' : null
        })]));
      });

      host.appendChild(sheet);
    });
  }

  function drawPage(cv, page, st, sc) {
    var dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(st.pageW * sc * dpr);
    cv.height = Math.round(st.pageH * sc * dpr);
    cv.style.width = (st.pageW * sc) + 'px';
    cv.style.height = (st.pageH * sc) + 'px';
    var g = cv.getContext('2d');
    g.setTransform(sc * dpr, 0, 0, sc * dpr, 0, 0);
    g.fillStyle = '#fbfaf7';
    g.fillRect(0, 0, st.pageW, st.pageH);
    g.textBaseline = 'alphabetic';
    page.ops.forEach(function (op) {
      if (op.t === 'rect') {
        g.fillStyle = css(op.fill);
        g.fillRect(op.x, st.pageH - op.y - op.h, op.w, op.h);
      } else if (op.t === 'line') {
        g.strokeStyle = css(op.color); g.lineWidth = op.w;
        g.beginPath();
        g.moveTo(op.x1, st.pageH - op.y1); g.lineTo(op.x2, st.pageH - op.y2);
        g.stroke();
      } else if (op.t === 'text') {
        g.fillStyle = css(op.color || [0, 0, 0]);
        g.font = fontCss(op.font, op.size);
        g.fillText(op.str, op.x, st.pageH - op.y);
      }
    });
    // field wells, drawn under the HTML overlays so they read as part of the page
    page.fields.filter(function (f) { return f.kind === 'text'; }).forEach(function (f) {
      g.fillStyle = 'rgba(204,215,255,.55)';
      g.fillRect(f.x, st.pageH - f.y - f.h, f.w, f.h);
    });
  }

  /* --- warnings --- */
  function renderWarnings() {
    var list = $('warnList');
    clear(list);
    var ws = state.res.warnings;
    var errs = ws.filter(function (w) { return w.level === 'error'; }).length;
    $('warnCount').textContent = ws.length;
    $('warnCount').className = 'badge' + (errs ? ' err' : '');
    var nFields = state.res.pages.reduce(function (a, p) { return a + p.fields.length; }, 0);
    $('fieldCount').textContent = nFields + ' fields · ' + state.res.pages.length + ' pages';

    if (!ws.length) {
      list.appendChild(h('div.warn.info', {}, [h('span.lv', { text: 'ok' }),
        document.createTextNode('Every included field has a unique, valid name.')]));
      return;
    }
    ws.slice(0, 60).forEach(function (w) {
      list.appendChild(h('div.warn.' + w.level, {
        onclick: function () { if (w.ref && w.ref.blockId) select(w.ref.blockId); }
      }, [h('span.lv', { text: w.level }), document.createTextNode(w.msg)]));
    });
  }

  /* ---------- inspector ---------- */

  function field(labelText, input, hintText) {
    return h('div.row.stack', {}, [h('label', { text: labelText }), input,
      hintText ? h('div.hintline', { text: hintText }) : null]);
  }
  function inline(labelText, input) {
    return h('div.row', {}, [h('label', { text: labelText }), input]);
  }
  function textInput(value, onInput, cls) {
    return h('input', { type: 'text', class: cls || '', value: value == null ? '' : value,
      oninput: function (e) { onInput(e.target.value); } });
  }
  function numInput(value, onInput, step) {
    return h('input', { type: 'number', step: step || 1, value: value,
      oninput: function (e) { onInput(parseFloat(e.target.value)); } });
  }
  function check(labelText, value, onChange) {
    return h('label', { style: 'display:flex;gap:7px;align-items:center;font-size:11.5px;color:var(--text-dim);margin-bottom:7px' }, [
      h('input', { type: 'checkbox', checked: value, onchange: function (e) { onChange(e.target.checked); } }),
      document.createTextNode(labelText)
    ]);
  }
  function pills(options, current, onPick) {
    return h('div.pill-row', {}, options.map(function (o) {
      return h('div.pill' + (o.value === current ? '.on' : ''), {
        text: o.label, onclick: function () { onPick(o.value); }
      });
    }));
  }

  function renderInspector() {
    var body = $('inspBody');
    clear(body);
    var b = state.sel ? block(state.sel) : null;
    $('inspTitle').textContent = b ? (b.kind + ' — ' + (b.label || '').slice(0, 26)) : 'Document';
    if (!b) { renderDocSettings(body); return; }

    // shared
    var sec = h('div.sec', {}, [h('h3', { text: 'Item' })]);
    sec.appendChild(check('Include in the PDF', b.include, function (v) { b.include = v; render(); }));
    sec.appendChild(check('Start a new page here', b.pageBreakBefore, function (v) { b.pageBreakBefore = v; render(); }));
    sec.appendChild(inline('Space above', numInput(b.spaceBefore || 0, function (v) { b.spaceBefore = v || 0; render(); }, 1)));
    body.appendChild(sec);

    if (b.kind === 'checks' || b.kind === 'text') body.appendChild(nameSection(b));
    body.appendChild(labelSection(b));
    if (b.kind === 'checks') body.appendChild(optionSection(b));
    if (b.kind === 'text') body.appendChild(textFieldSection(b));
    if (b.kind === 'heading') body.appendChild(colorSection(b));
    if (b.kind === 'note') body.appendChild(noteSection(b));
    body.appendChild(originSection(b));
  }

  function nameSection(b) {
    var bad = !window.Model.validName(b.name);
    var inp = textInput(b.name, function (v) {
      b.name = v.trim();
      render();
      var el = document.querySelector('#inspBody input.mono');
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }, 'mono' + (bad ? ' bad' : ''));
    var preview = b.kind === 'checks'
      ? b.options.filter(function (o) { return o.include; })
          .slice(0, 3).map(function (o) { return b.name + '_' + o.index; }).join(', ') +
          (b.options.filter(function (o) { return o.include; }).length > 3 ? ', …' : '')
      : b.name;
    return h('div.sec', {}, [
      h('h3', { text: 'Field name' }),
      inp,
      h('div.hintline', { text: b.kind === 'checks'
        ? 'One field per answer: ' + (preview || '—')
        : 'Single text field: ' + (preview || '—') }),
      h('div.hintline', { text: 'Lowercase letters, digits and underscore. Type this same name into the Credible exporter as the rename.' })
    ]);
  }

  function labelSection(b) {
    var kids = [h('h3', { text: 'Wording on the page' }),
      field('Label', textInput(b.label, function (v) { b.label = v; render(); }))];
    if (b.kind === 'checks' || b.kind === 'text') {
      kids.push(field('Hint (small grey italic, after the label)',
        textInput(b.hint, function (v) { b.hint = v; render(); })));
    }
    if (window.Model.needsCommaRepair(b.label)) {
      kids.push(h('button.btn.sm', { text: 'Restore stripped commas', onclick: function () {
        b.label = window.Model.repairCommas(b.label); render();
      } }));
    }
    if (b.label !== b.origText) {
      kids.push(h('button.btn.sm.ghost', { style: 'margin-top:6px', text: 'Reset to Credible wording',
        onclick: function () { b.label = b.origText; render(); } }));
    }
    return h('div.sec', {}, kids);
  }

  function optionSection(b) {
    var wrap = h('div.sec', {}, [
      h('h3', { text: 'Answers · ' + b.options.length }),
      inline('Columns', pills([{ label: '1', value: 1 }, { label: '2', value: 2 }, { label: '3', value: 3 }],
        b.columns || 1, function (v) { b.columns = v; render(); })),
      check('Only one may be picked (Credible radio)', b.exclusive, function (v) { b.exclusive = v; render(); })
    ]);
    var list = h('div', { style: 'margin-top:8px' });
    b.options.forEach(function (o) {
      var row = h('div.opt' + (o.include ? '' : '.off') + (o.isNew ? '.isnew' : ''), {
        draggable: 'true', data: { id: String(o.aid) }
      }, [
        h('span.grip', { text: '⠿' }),
        h('span.idx', { text: String(o.index), title: 'Credible answer position — the number in ' + b.name + '_' + o.index }),
        h('input', { type: 'checkbox', checked: o.include,
          onchange: function (e) { o.include = e.target.checked; render(); } }),
        h('input', { type: 'text', value: o.text,
          oninput: function (e) { o.text = e.target.value; scheduleRender(); } })
      ]);
      wireOptionDrag(row, b);
      list.appendChild(row);
    });
    wrap.appendChild(list);
    wrap.appendChild(h('div.hintline', {
      text: 'The number is the answer\'s position in the Credible export and never changes when you drag rows or hide answers — so a name can never end up on the wrong answer.'
    }));
    if (b.options.some(function (o) { return window.Model.needsCommaRepair(o.text); })) {
      wrap.appendChild(h('button.btn.sm', { style: 'margin-top:8px', text: 'Restore stripped commas in answers',
        onclick: function () {
          b.options.forEach(function (o) { o.text = window.Model.repairCommas(o.text); });
          render();
        } }));
    }
    return wrap;
  }

  function wireOptionDrag(row, b) {
    row.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', row.dataset.id); });
    row.addEventListener('dragover', function (e) { e.preventDefault(); row.classList.add('dragover'); });
    row.addEventListener('dragleave', function () { row.classList.remove('dragover'); });
    row.addEventListener('drop', function (e) {
      e.preventDefault(); row.classList.remove('dragover');
      var from = e.dataTransfer.getData('text/plain');
      if (!from || from === row.dataset.id) return;
      var fi = b.options.findIndex(function (o) { return String(o.aid) === from; });
      var item = b.options.splice(fi, 1)[0];
      var ti = b.options.findIndex(function (o) { return String(o.aid) === row.dataset.id; });
      b.options.splice(ti + (e.offsetY > row.offsetHeight / 2 ? 1 : 0), 0, item);
      render();
    });
  }

  function textFieldSection(b) {
    return h('div.sec', {}, [
      h('h3', { text: 'Text field' }),
      check('Field sits on the same line as the label', b.labelInline, function (v) { b.labelInline = v; render(); }),
      check('Multi-line box', b.multiline, function (v) {
        b.multiline = v;
        if (v && !b.height) b.height = 22;
        render();
      }),
      b.multiline ? inline('Height (pt)', numInput(b.height || 22, function (v) { b.height = v || 22; render(); }, 1)) : null,
      !b.multiline ? inline('Max chars', numInput(b.maxLen || 0, function (v) { b.maxLen = v || 0; render(); }, 10)) : null
    ]);
  }

  function colorSection(b) {
    var pal = window.Model.BANNER_COLORS;
    return h('div.sec', {}, [
      h('h3', { text: 'Banner colour' }),
      h('div.swatches', {}, Object.keys(pal).map(function (k) {
        return h('div.sw' + (b.colorKey === k ? '.on' : ''), {
          title: k, style: 'background:' + css(pal[k]),
          onclick: function () { b.colorKey = k; b.color = pal[k]; render(); }
        });
      }))
    ]);
  }

  function noteSection(b) {
    return h('div.sec', {}, [
      h('h3', { text: 'Note style' }),
      inline('Size (pt)', numInput(b.size || state.res.style.noteSize, function (v) { b.size = v || 7; render(); }, 0.2)),
      check('Bold', b.bold, function (v) { b.bold = v; render(); }),
      check('Italic', b.italic, function (v) { b.italic = v; render(); })
    ]);
  }

  function originSection(b) {
    var kids = [h('h3', { text: 'In Credible' }),
      h('div.hintline', { text: 'Question: ' + (b.origText || '—') })];
    if (b.options) {
      kids.push(h('div.hintline', { text: b.options.length + ' answers, positions ' +
        b.options.map(function (o) { return o.index; }).sort(function (x, y) { return x - y; }).join(', ') }));
    }
    kids.push(h('div.hintline', { text: 'question_id ' + b.qid + ' · format ' + b.format }));
    return h('div.sec', {}, kids);
  }

  function renderDocSettings(body) {
    var d = state.doc, st = d.style;
    body.appendChild(h('div.sec', {}, [
      h('h3', { text: 'Masthead' }),
      field('Title', textInput(d.header.title, function (v) { d.header.title = v; render(); })),
      field('Top-right note', textInput(d.header.note, function (v) { d.header.note = v; render(); })),
      field('Intro line', textInput(d.header.intro, function (v) { d.header.intro = v; render(); }))
    ]));

    body.appendChild(h('div.sec', {}, [
      h('h3', { text: 'Page' }),
      inline('Width (pt)', numInput(st.pageW, function (v) { st.pageW = v; render(); }, 1)),
      inline('Height (pt)', numInput(st.pageH, function (v) { st.pageH = v; render(); }, 1)),
      inline('Margin top', numInput(st.marginTop, function (v) { st.marginTop = v; render(); }, 1)),
      inline('Margin left', numInput(st.marginLeft, function (v) { st.marginLeft = v; render(); }, 1)),
      inline('Margin right', numInput(st.marginRight, function (v) { st.marginRight = v; render(); }, 1)),
      inline('Margin bottom', numInput(st.marginBottom, function (v) { st.marginBottom = v; render(); }, 1)),
      h('div.hintline', { text: 'Letter is 612 × 792 pt. A4 is 595 × 842.' })
    ]));

    body.appendChild(h('div.sec', {}, [
      h('h3', { text: 'Type & spacing' }),
      inline('Question', numInput(st.qSize, function (v) { st.qSize = v; render(); }, 0.1)),
      inline('Answer', numInput(st.optSize, function (v) { st.optSize = v; render(); }, 0.1)),
      inline('Hint', numInput(st.hintSize, function (v) { st.hintSize = v; render(); }, 0.1)),
      inline('Banner', numInput(st.bannerSize, function (v) { st.bannerSize = v; render(); }, 0.1)),
      inline('Row pitch', numInput(st.pitch, function (v) { st.pitch = v; render(); }, 0.1)),
      inline('Gap between items', numInput(st.blockGap, function (v) { st.blockGap = v; render(); }, 0.5)),
      inline('Checkbox size', numInput(st.boxSize, function (v) { st.boxSize = v; render(); }, 0.5)),
      inline('Field height', numInput(st.fieldH, function (v) { st.fieldH = v; render(); }, 0.5)),
      inline('Default max chars', numInput(st.fieldMaxLen, function (v) { st.fieldMaxLen = v; render(); }, 10))
    ]));

    body.appendChild(h('div.sec', {}, [
      h('h3', { text: 'Source' }),
      h('div.hintline', { text: (d.source.file || 'imported export') + ' · form ' + d.source.formId +
        (d.source.formVerId ? ' · version ' + d.source.formVerId : '') }),
      h('div.hintline', { text: 'Imported ' + (d.source.importedAt || '').replace('T', ' ').slice(0, 16) }),
      h('button.btn.sm', { style: 'margin-top:8px', text: 'Suggest names for unnamed items', onclick: autoName })
    ]));
  }

  var renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(function () {
      state.res = window.Layout.layout(state.doc);
      renderPages(); renderWarnings(); renderOutline(); save();
    }, 260);
  }

  function autoName() {
    var taken = {};
    state.doc.blocks.forEach(function (b) { if (b.name) taken[b.name] = true; });
    state.doc.blocks.forEach(function (b) {
      if ((b.kind === 'checks' || b.kind === 'text') && !b.name) {
        b.name = window.Model.suggestName(b.label || b.origText, taken);
        taken[b.name] = true;
      }
    });
    render();
  }

  /* ---------- exports ---------- */

  function exportPDF() {
    var errs = state.res.warnings.filter(function (w) { return w.level === 'error'; });
    if (errs.length && !confirm(errs.length + ' naming problem(s) still open:\n\n· ' +
        errs.slice(0, 6).map(function (w) { return w.msg; }).join('\n· ') +
        '\n\nExport anyway?')) return;
    var bytes = window.PDFWriter.build(state.res.pages, {
      style: state.res.style, title: state.doc.header.title || state.doc.source.formName
    });
    download(slug(state.doc.header.title || state.doc.source.formName) + '.pdf', bytes, 'application/pdf');
  }

  /* One row per PDF field, carrying the untouched Credible wording so each
     name can be matched to the right item in the Export Builder. */
  function nameRows() {
    var rows = [];
    state.doc.blocks.forEach(function (b) {
      if (!b.include || (b.kind !== 'checks' && b.kind !== 'text')) return;
      var pageOf = {};
      state.res.pages.forEach(function (p, pi) {
        p.fields.forEach(function (f) { if (f.ref.blockId === b.id) pageOf[f.name] = pi + 1; });
      });
      if (b.kind === 'text') {
        rows.push({ name: b.name, question: b.origText, answer: '', index: '', type: 'text',
          page: pageOf[b.name] || '', qid: b.qid, aid: '' });
      } else {
        b.options.filter(function (o) { return o.include; }).forEach(function (o) {
          var nm = b.name + '_' + o.index;
          rows.push({ name: nm, question: b.origText, answer: o.origText, index: o.index,
            type: b.exclusive ? 'radio' : 'checkbox', page: pageOf[nm] || '', qid: b.qid, aid: o.aid });
        });
      }
    });
    return rows;
  }

  function exportNames() {
    var rows = nameRows();
    var header = ['pdf_field_name', 'credible_question_text', 'credible_answer_text',
      'answer_position', 'field_type', 'pdf_page', 'question_id', 'answer_id'];
    var csv = window.CSV.toCSV(header, rows.map(function (r) {
      return [r.name, r.question, r.answer, r.index, r.type, r.page, r.qid, r.aid];
    }));
    download(slug(state.doc.header.title || state.doc.source.formName) + '_field_names.csv', csv, 'text/csv');
  }

  function showNames() {
    var rows = nameRows();
    var lastQ = null;
    var tbody = h('tbody', {});
    rows.forEach(function (r) {
      if (r.question !== lastQ) {
        lastQ = r.question;
        tbody.appendChild(h('tr.grp', {}, [h('td', { colspan: 4, text: r.question })]));
      }
      tbody.appendChild(h('tr', {}, [
        h('td.n', { text: r.name }),
        h('td', { text: r.answer || '—' }),
        h('td', { text: String(r.index || '') }),
        h('td', { text: r.type + (r.page ? ' · p' + r.page : '') })
      ]));
    });
    var table = h('table.names', {}, [
      h('thead', {}, [h('tr', {}, [
        h('th', { text: 'Rename to (type this in Credible)' }),
        h('th', { text: 'Credible answer' }),
        h('th', { text: 'Pos' }),
        h('th', { text: 'Type' })
      ])]),
      tbody
    ]);

    var bg = h('div.modal-bg', { onclick: function (e) { if (e.target === bg) bg.remove(); } }, [
      h('div.modal', {}, [
        h('div.mh', {}, [
          h('h2', { text: 'Field names for the Credible exporter' }),
          h('span', { style: 'flex:1' }),
          h('span.badge', { text: rows.length + ' fields' })
        ]),
        h('div.mb', {}, [
          h('div.hintline', { style: 'margin-bottom:10px',
            text: 'Select each question below in the Export Builder and rename its output to the name in the first column. Grouped rows are one question; the position column is the answer\'s order in the export.' }),
          table
        ]),
        h('div.mf', {}, [
          h('button.btn', { text: 'Copy as TSV', onclick: function () {
            var tsv = rows.map(function (r) {
              return [r.name, r.question, r.answer, r.index, r.type].join('\t');
            }).join('\n');
            navigator.clipboard.writeText(tsv).then(function () { alert('Copied ' + rows.length + ' rows.'); },
              function () { alert('Clipboard blocked — use Download CSV instead.'); });
          } }),
          h('button.btn', { text: 'Download CSV', onclick: exportNames }),
          h('button.btn.primary', { text: 'Close', onclick: function () { bg.remove(); } })
        ])
      ])
    ]);
    document.body.appendChild(bg);
  }

  /* ---------- zoom ---------- */
  function setScale(s) {
    state.scale = Math.max(0.35, Math.min(2.4, s));
    $('zVal').textContent = Math.round(state.scale * 100) + '%';
    if (state.res) renderPages();
  }
  function fit() {
    if (!state.res) return;
    var avail = $('canvasPane').clientWidth - 60;
    setScale(avail / state.res.style.pageW);
  }

  /* ---------- wiring ---------- */
  function readFile(file, cb) {
    var fr = new FileReader();
    fr.onload = function () { cb(String(fr.result), file.name); };
    fr.readAsText(file);
  }

  function handleFile(file) {
    if (/\.json$/i.test(file.name)) {
      readFile(file, function (text) {
        try {
          var d = JSON.parse(text);
          if (!d.blocks) throw new Error('not a layout');
          state.doc = d;
          state.doc.style = Object.assign({}, window.Layout.DEFAULT_STYLE, d.style || {});
          state.sel = null;
          render(); fit();
        } catch (e) { alert('Could not read that layout file: ' + e.message); }
      });
    } else {
      readFile(file, loadCSV);
    }
  }

  function init() {
    $('btnImport').onclick = function () { $('fileCsv').click(); };
    $('btnLoadLayout').onclick = function () { $('fileJson').click(); };
    $('fileCsv').onchange = function (e) { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ''; };
    $('fileJson').onchange = function (e) { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ''; };
    $('btnPdf').onclick = exportPDF;
    $('btnNames').onclick = showNames;
    $('btnSaveLayout').onclick = function () {
      download(slug(state.doc.header.title || state.doc.source.formName) + '_layout.json',
        JSON.stringify(state.doc, null, 2), 'application/json');
    };
    $('btnAllOn').onclick = function () {
      state.doc.blocks.forEach(function (b) { if (!b.excludedReason) b.include = true; });
      render();
    };
    $('btnAllOff').onclick = function () {
      state.doc.blocks.forEach(function (b) { b.include = false; });
      render();
    };
    $('btnRepair').onclick = function () {
      var n = 0;
      state.doc.blocks.forEach(function (b) {
        if (window.Model.needsCommaRepair(b.label)) { b.label = window.Model.repairCommas(b.label); n++; }
        if (window.Model.needsCommaRepair(b.hint)) { b.hint = window.Model.repairCommas(b.hint); n++; }
        (b.options || []).forEach(function (o) {
          if (window.Model.needsCommaRepair(o.text)) { o.text = window.Model.repairCommas(o.text); n++; }
        });
      });
      render();
      alert(n ? 'Restored commas in ' + n + ' item(s). Check the wording — the export drops commas, so this is a best guess.'
              : 'Nothing looked like a stripped comma.');
    };
    $('zIn').onclick = function () { setScale(state.scale * 1.15); };
    $('zOut').onclick = function () { setScale(state.scale / 1.15); };
    $('zFit').onclick = fit;
    $('showNames').onchange = function (e) { state.showNames = e.target.checked; renderPages(); };

    var dz = null;
    window.addEventListener('dragover', function (e) {
      e.preventDefault();
      if (!dz) { dz = h('div.dropzone', { text: 'drop export or layout' }); document.body.appendChild(dz); }
    });
    window.addEventListener('dragleave', function (e) {
      if (e.relatedTarget === null && dz) { dz.remove(); dz = null; }
    });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      if (dz) { dz.remove(); dz = null; }
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });

    window.addEventListener('resize', function () { if (state.res) renderPages(); });

    // ?load=<path-to-export.csv> imports on open, handy for a bookmarked template
    var auto = /[?&]load=([^&]+)/.exec(location.search);
    if (auto) {
      fetch(decodeURIComponent(auto[1]))
        .then(function (r) { return r.text(); })
        .then(function (t) { loadCSV(t, decodeURIComponent(auto[1])); })
        .catch(function (e) { console.warn('auto-load failed', e); renderEmpty(); });
      return;
    }
    if (restore()) { render(); fit(); } else { renderEmpty(); }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
