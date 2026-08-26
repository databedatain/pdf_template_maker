/* Minimal PDF writer with AcroForm support.

   Deliberately dependency-free: the whole tool has to run from a file:// URL
   with no install step, and the output only needs base-14 fonts, checkbox and
   text widgets. Object layout mirrors the reference template so Credible sees
   the same structure it already accepts. */
(function (global) {
  'use strict';

  var M = global.Metrics;

  function esc(s) {
    return M.toWinAnsi(String(s)).replace(/([\\()])/g, '\\$1')
      .replace(/[\x00-\x1f]/g, function (c) { return '\\' + ('00' + c.charCodeAt(0).toString(8)).slice(-3); });
  }
  function n(v) {
    var r = Math.round(v * 1000) / 1000;
    return String(r);
  }
  function rgb(c) { return n(c[0]) + ' ' + n(c[1]) + ' ' + n(c[2]); }

  function Writer() {
    this.objects = [null];  // 1-indexed
  }
  Writer.prototype.alloc = function () { this.objects.push(''); return this.objects.length - 1; };
  Writer.prototype.set = function (id, body) { this.objects[id] = body; return id; };
  Writer.prototype.add = function (body) { var id = this.alloc(); return this.set(id, body); };
  Writer.prototype.stream = function (dict, data) {
    return this.add(dict.replace(/>>\s*$/, '/Length ' + data.length + ' >>') +
      '\nstream\n' + data + '\nendstream');
  };
  Writer.prototype.build = function () {
    var out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', offsets = [0], i;
    for (i = 1; i < this.objects.length; i++) {
      offsets[i] = out.length;
      out += i + ' 0 obj\n' + this.objects[i] + '\nendobj\n';
    }
    var xref = out.length;
    out += 'xref\n0 ' + this.objects.length + '\n0000000000 65535 f \n';
    for (i = 1; i < this.objects.length; i++) {
      out += ('0000000000' + offsets[i]).slice(-10) + ' 00000 n \n';
    }
    out += 'trailer\n<< /Size ' + this.objects.length + ' /Root 1 0 R /Info ' +
      this.infoId + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';

    var bytes = new Uint8Array(out.length);
    for (i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  };

  function contentFor(ops) {
    var parts = [], font = null, size = null, color = null;
    ops.forEach(function (op) {
      if (op.t === 'rect') {
        parts.push('q ' + rgb(op.fill) + ' rg ' + n(op.x) + ' ' + n(op.y) + ' ' +
          n(op.w) + ' ' + n(op.h) + ' re f Q');
        color = null;
      } else if (op.t === 'line') {
        parts.push('q ' + rgb(op.color) + ' RG ' + n(op.w) + ' w ' + n(op.x1) + ' ' + n(op.y1) +
          ' m ' + n(op.x2) + ' ' + n(op.y2) + ' l S Q');
      } else if (op.t === 'text') {
        if (!op.str) return;
        var fk = { H: '/F1', HB: '/F2', HO: '/F3' }[op.font] || '/F1';
        var head = '';
        if (fk !== font || op.size !== size) { head += fk + ' ' + n(op.size) + ' Tf '; font = fk; size = op.size; }
        var col = rgb(op.color || [0, 0, 0]);
        if (col !== color) { head += col + ' rg '; color = col; }
        parts.push('BT ' + head + '1 0 0 1 ' + n(op.x) + ' ' + n(op.y) + ' Tm (' + esc(op.str) + ') Tj ET');
      }
    });
    return parts.join('\n');
  }

  /* pages: [{ops, fields}] from Layout.layout() */
  function build(pages, opts) {
    opts = opts || {};
    var st = opts.style || global.Layout.DEFAULT_STYLE;
    var w = new Writer();

    var catalogId = w.alloc();        // 1
    var pagesId = w.alloc();          // 2
    var f1 = w.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    var f2 = w.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    var f3 = w.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');
    var fz = w.add('<< /Type /Font /Subtype /Type1 /BaseFont /ZapfDingbats >>');

    var box = st.boxSize;
    var apRes = '/Resources << /ProcSet [ /PDF /Text ] /Font << /ZaDb ' + fz + ' 0 R >> >>';
    var apOff = w.stream('<< /Type /XObject /Subtype /Form /BBox [ 0 0 ' + n(box) + ' ' + n(box) + ' ] ' + apRes + ' >>',
      'q 1 1 1 rg 0 0 ' + n(box) + ' ' + n(box) + ' re f 0 0 0 RG .6 w .3 .3 ' + n(box - 0.6) + ' ' + n(box - 0.6) + ' re S Q');
    var apYes = w.stream('<< /Type /XObject /Subtype /Form /BBox [ 0 0 ' + n(box) + ' ' + n(box) + ' ] ' + apRes + ' >>',
      'q 1 1 1 rg 0 0 ' + n(box) + ' ' + n(box) + ' re f 0 0 0 RG .6 w .3 .3 ' + n(box - 0.6) + ' ' + n(box - 0.6) +
      ' re S Q\nq BT /ZaDb ' + n(box - 1.5) + ' Tf 0 g ' + n(box * 0.14) + ' ' + n(box * 0.18) + ' Td (4) Tj ET Q');

    var pageIds = pages.map(function () { return w.alloc(); });
    var fieldIds = [];

    pages.forEach(function (p, pi) {
      var content = w.stream('<< >>', contentFor(p.ops));
      var annots = [];

      p.fields.forEach(function (f) {
        var id = w.alloc();
        annots.push(id + ' 0 R');
        fieldIds.push(id);
        var rect = '[ ' + n(f.x) + ' ' + n(f.y) + ' ' + n(f.x + f.w) + ' ' + n(f.y + f.h) + ' ]';
        if (f.kind === 'check') {
          w.set(id, '<< /Type /Annot /Subtype /Widget /FT /Btn /T (' + esc(f.name) + ')' +
            ' /F 4 /Ff 0 /V /Off /AS /Off /H /N /P ' + pageIds[pi] + ' 0 R /Rect ' + rect +
            ' /BS << /S /S /W .6 >> /MK << /BC [ 0 0 0 ] /BG [ 1 1 1 ] /CA (4) >>' +
            ' /AP << /N << /Off ' + apOff + ' 0 R /Yes ' + apYes + ' 0 R >> >> >>');
        } else {
          var size = f.size || 8;
          var da = '/Helv ' + n(size) + ' Tf .1 .1 .1 rg';
          var body = '/Tx BMC q 1 1 ' + n(f.w - 2) + ' ' + n(f.h - 2) + ' re W n ' +
            (f.bg ? rgb(f.bg) + ' rg 0 0 ' + n(f.w) + ' ' + n(f.h) + ' re f ' : '') + 'Q EMC';
          var ap = w.stream('<< /Type /XObject /Subtype /Form /BBox [ 0 0 ' + n(f.w) + ' ' + n(f.h) +
            ' ] /Resources << /ProcSet [ /PDF /Text ] /Font << /Helv ' + f1 + ' 0 R >> >> >>', body);
          w.set(id, '<< /Type /Annot /Subtype /Widget /FT /Tx /T (' + esc(f.name) + ')' +
            ' /F 4 /Ff ' + (f.multiline ? 4096 : 0) + ' /V () /DV () /DA (' + da + ')' +
            (f.maxLen ? ' /MaxLen ' + f.maxLen : '') +
            (f.bg ? ' /MK << /BG [ ' + rgb(f.bg) + ' ] >>' : '') +
            ' /P ' + pageIds[pi] + ' 0 R /Rect ' + rect + ' /AP << /N ' + ap + ' 0 R >> >>');
        }
      });

      w.set(pageIds[pi], '<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [ 0 0 ' +
        n(st.pageW) + ' ' + n(st.pageH) + ' ] /Resources << /ProcSet [ /PDF /Text ] /Font << /F1 ' +
        f1 + ' 0 R /F2 ' + f2 + ' 0 R /F3 ' + f3 + ' 0 R >> >> /Contents ' + content + ' 0 R' +
        (annots.length ? ' /Annots [ ' + annots.join(' ') + ' ]' : '') + ' >>');
    });

    var acro = w.add('<< /Fields [ ' + fieldIds.map(function (i) { return i + ' 0 R'; }).join(' ') + ' ]' +
      ' /DR << /Font << /Helv ' + f1 + ' 0 R /HeBo ' + f2 + ' 0 R /ZaDb ' + fz + ' 0 R >> >>' +
      ' /DA (/Helv 0 Tf 0 g) /NeedAppearances true >>');

    w.set(pagesId, '<< /Type /Pages /Count ' + pageIds.length + ' /Kids [ ' +
      pageIds.map(function (i) { return i + ' 0 R'; }).join(' ') + ' ] >>');
    w.set(catalogId, '<< /Type /Catalog /Pages ' + pagesId + ' 0 R /AcroForm ' + acro +
      ' 0 R /PageMode /UseNone >>');

    w.infoId = w.add('<< /Title (' + esc(opts.title || '') + ') /Producer (PDF Template Maker) >>');
    return w.build();
  }

  global.PDFWriter = { build: build };
})(window);
