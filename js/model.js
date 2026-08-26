/* Credible export rows -> form model -> editable document.

   Two text values are kept for every question and answer:
     origText  - exactly what Credible shows, used to find the item in the
                 Export Builder and never edited here
     text      - the display text for the PDF, freely editable

   Field numbering is bound to the answer's Credible sort order (a_ord), never
   to its position on the page. Reordering options for layout can therefore
   never change which answer a field name refers to. */
(function (global) {
  'use strict';

  var BANNER_COLORS = {
    re: [0.961, 0.718, 0.694], or: [0.988, 0.831, 0.671], ye: [0.976, 0.906, 0.624],
    gr: [0.784, 0.902, 0.788], bl: [0.788, 0.855, 0.973], in: [0.804, 0.816, 0.937],
    vi: [0.882, 0.808, 0.918], bk: [0.85, 0.85, 0.85], gy: [0.898, 0.906, 0.910]
  };

  var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
    ndash: '–', mdash: '—', hellip: '…', bull: '•' };

  function decodeEntities(s) {
    return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, e) {
      if (e[0] === '#') {
        var n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isNaN(n) ? m : String.fromCharCode(n);
      }
      return ENTITIES[e.toLowerCase()] !== undefined ? ENTITIES[e.toLowerCase()] : m;
    });
  }

  /* Flatten Credible's inline HTML to plain text. <br> becomes a space. */
  function stripHtml(s) {
    if (!s) return '';
    return decodeEntities(
      String(s)
        .replace(/<\s*br\s*\/?\s*>/gi, ' ')
        .replace(/<[^>]*>/g, '')
    ).replace(/\s+/g, ' ').trim();
  }

  /* Credible's exporter drops commas from text and leaves the surrounding
     spaces behind. Restore a comma wherever a doubled space sits between two
     word characters. Reported as a suggestion, never applied silently. */
  function repairCommas(s) {
    return String(s || '').replace(/(\S)  +(\S)/g, '$1, $2');
  }

  function needsCommaRepair(s) { return /\S  +\S/.test(String(s || '')); }

  /* A label wrapped in <span class='xx fullw'> is a section banner. */
  function bannerOf(html) {
    var m = /<span[^>]*class=['"]([^'"]*)['"]/i.exec(html || '');
    if (!m) return null;
    var classes = m[1].split(/\s+/);
    var color = classes.filter(function (c) { return BANNER_COLORS[c]; })[0];
    // Only a full-width span is a section banner; a bare colour span is
    // inline emphasis inside an ordinary note.
    if (!color || classes.indexOf('fullw') < 0) return null;
    return { color: BANNER_COLORS[color], key: color };
  }

  function isStyleOnly(html) { return /<\s*style/i.test(html || ''); }

  function truthy(v) { return String(v).toUpperCase() === 'TRUE' || v === '1'; }
  function num(v, dflt) { var n = parseFloat(v); return isNaN(n) ? dflt : n; }

  /* Build a form tree from export rows. */
  function buildForm(rows) {
    var byId = {}, order = [], meta = null;

    rows.forEach(function (r) {
      if (!meta && r.form_id) meta = { formId: r.form_id, formName: r.form_name, formVerId: r.form_ver_id };
      if (!r.question_id) return;
      var q = byId[r.question_id];
      if (!q) {
        q = byId[r.question_id] = {
          qid: r.question_id,
          ord: num(r.q_ord, 0),
          format: (r.q_format || '').toUpperCase(),
          origText: stripHtml(r.question_text),
          rawHtml: r.question_text || '',
          required: truthy(r.is_required),
          labelX: num(r.label_x, 1),
          controlX: num(r.control_x, 15),
          fieldLen: num(r.field_len, 0),
          maxLen: num(r.max_len, 0),
          multiLine: num(r.multi_line, 0),
          lineBreak: truthy(r.is_line_break),
          bold: truthy(r.is_label_bold),
          externalId: r.q_external_id || '',
          clientField: r.client_field || '',
          catName: r.cat_description || r.cat_name || '',
          answers: [], answerIds: {}
        };
        order.push(q);
      }
      if (r.answer_id && !q.answerIds[r.answer_id]) {
        q.answerIds[r.answer_id] = true;
        q.answers.push({
          aid: r.answer_id,
          ord: num(r.a_ord, q.answers.length + 1),
          origText: stripHtml(r.answer),
          isNotes: truthy(r.is_notes),
          externalId: r.a_external_id || ''
        });
      }
    });

    order.sort(function (a, b) { return a.ord - b.ord; });
    order.forEach(function (q) {
      q.answers.sort(function (a, b) { return a.ord - b.ord; });
      delete q.answerIds;
    });
    return { meta: meta || { formId: '', formName: '' }, questions: order };
  }

  var STOP = { the: 1, a: 1, an: 1, of: 1, for: 1, to: 1, and: 1, or: 1, my: 1,
    i: 1, in: 1, on: 1, at: 1, this: 1, that: 1, with: 1, these: 1, those: 1,
    is: 1, are: 1, be: 1, it: 1, can: 1, will: 1, me: 1, ll: 1 };

  /* Suggest a snake_case base name from label text. */
  function suggestName(text, taken) {
    var words = stripHtml(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(function (w) { return w && !STOP[w]; })
      .slice(0, 3)
      .map(function (w) { return w.length > 9 ? w.slice(0, 9) : w; });
    var base = words.join('_') || 'field';
    if (!/^[a-z]/.test(base)) base = 'f_' + base;
    if (!taken) return base;
    var name = base, n = 2;
    while (taken[name]) { name = base + '_' + n; n++; }
    return name;
  }

  function validName(n) { return /^[a-z][a-z0-9_]{0,58}$/.test(n || ''); }

  /* Turn a form into an editable document seeded from Credible's own layout
     hints. Everything here is subsequently editable in the UI. */
  function buildDoc(form, style) {
    var taken = {}, blocks = [];

    form.questions.forEach(function (q) {
      var banner = bannerOf(q.rawHtml);
      var block = {
        id: 'b' + q.qid,
        qid: q.qid,
        format: q.format,
        include: true,
        origText: q.origText,
        label: q.origText,
        hint: '',
        spaceBefore: 0,
        pageBreakBefore: false
      };

      if (q.format === 'LBL') {
        if (isStyleOnly(q.rawHtml)) { block.include = false; block.kind = 'note'; block.excludedReason = 'style block'; }
        else if (banner) { block.kind = 'heading'; block.color = banner.color; block.colorKey = banner.key; }
        else { block.kind = 'note'; block.bold = q.bold; block.size = style.noteSize; }
        block.kind = block.kind || 'note';
      } else if (q.format === 'CB' || q.format === 'RB') {
        block.kind = 'checks';
        block.exclusive = q.format === 'RB';
        block.columns = 2;
        block.name = '';
        block.options = q.answers.map(function (a) {
          return { aid: a.aid, index: a.ord, origText: a.origText, text: a.origText, include: true, isNotes: a.isNotes };
        });
      } else if (q.format === 'TXT') {
        block.kind = 'text';
        block.name = '';
        block.multiline = q.multiLine >= 2;
        block.maxLen = q.maxLen && q.maxLen <= 500 ? Math.min(q.maxLen, 500) : style.fieldMaxLen;
        block.labelInline = !q.lineBreak;
        block.height = block.multiline ? style.fieldH * 2 : style.fieldH;
      } else {
        block.kind = 'note';
        block.include = false;
        block.excludedReason = 'unsupported format ' + (q.format || '(blank)');
      }

      if (block.kind === 'checks' || block.kind === 'text') {
        block.name = suggestName(q.origText, taken);
        taken[block.name] = true;
      }
      blocks.push(block);
    });

    return {
      version: 1,
      source: {
        formId: form.meta.formId,
        formName: form.meta.formName,
        formVerId: form.meta.formVerId,
        importedAt: new Date().toISOString()
      },
      header: { title: form.meta.formName.replace(/^[*\s]+/, ''), note: '', intro: '' },
      style: style,
      blocks: blocks
    };
  }

  /* Re-import: carry names, edited text and layout across to a new export.
     Matching is by question_id / answer_id. */
  function mergeDoc(oldDoc, newDoc) {
    var oldBlocks = {}, report = { kept: 0, addedQuestions: [], removedQuestions: [], addedAnswers: [], removedAnswers: [] };
    oldDoc.blocks.forEach(function (b) { if (b.qid) oldBlocks[b.qid] = b; });

    var merged = newDoc.blocks.map(function (nb) {
      var ob = oldBlocks[nb.qid];
      if (!ob) { report.addedQuestions.push(nb.origText); return nb; }
      delete oldBlocks[nb.qid];
      report.kept++;
      var out = JSON.parse(JSON.stringify(nb));
      ['include', 'label', 'hint', 'name', 'columns', 'spaceBefore', 'pageBreakBefore',
       'multiline', 'maxLen', 'labelInline', 'height', 'size', 'bold', 'color', 'colorKey'
      ].forEach(function (k) { if (ob[k] !== undefined) out[k] = ob[k]; });

      if (out.options && ob.options) {
        var oldOpts = {}, seq = [];
        ob.options.forEach(function (o) { oldOpts[o.aid] = o; });
        out.options.forEach(function (o) {
          var prev = oldOpts[o.aid];
          if (prev) { o.text = prev.text; o.include = prev.include; delete oldOpts[o.aid]; }
          else { o.isNew = true; report.addedAnswers.push({ block: out.label, text: o.origText, index: o.index }); }
        });
        Object.keys(oldOpts).forEach(function (aid) {
          report.removedAnswers.push({ block: out.label, text: oldOpts[aid].origText, index: oldOpts[aid].index });
        });
        // preserve the old display order for answers that still exist
        var pos = {};
        ob.options.forEach(function (o, i) { pos[o.aid] = i; });
        out.options.sort(function (a, b) {
          var pa = pos[a.aid], pb = pos[b.aid];
          if (pa === undefined && pb === undefined) return a.index - b.index;
          if (pa === undefined) return 1;
          if (pb === undefined) return -1;
          return pa - pb;
        });
        void seq;
      }
      return out;
    });

    // keep the old block order for questions that survived
    var newPos = {};
    oldDoc.blocks.forEach(function (b, i) { newPos[b.qid] = i; });
    merged.sort(function (a, b) {
      var pa = newPos[a.qid], pb = newPos[b.qid];
      if (pa === undefined && pb === undefined) return 0;
      if (pa === undefined) return 1;
      if (pb === undefined) return -1;
      return pa - pb;
    });

    Object.keys(oldBlocks).forEach(function (qid) {
      report.removedQuestions.push(oldBlocks[qid].label || oldBlocks[qid].origText);
    });

    newDoc.blocks = merged;
    newDoc.header = oldDoc.header;
    newDoc.style = oldDoc.style;
    return { doc: newDoc, report: report };
  }

  global.Model = {
    buildForm: buildForm, buildDoc: buildDoc, mergeDoc: mergeDoc,
    stripHtml: stripHtml, repairCommas: repairCommas, needsCommaRepair: needsCommaRepair,
    suggestName: suggestName, validName: validName, BANNER_COLORS: BANNER_COLORS
  };
})(window);
