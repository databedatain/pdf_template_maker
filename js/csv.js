/* RFC4180 CSV reader. Credible's export is mostly unquoted, but quoted fields
   show up in other exports, so handle both. */
(function (global) {
  'use strict';

  function parse(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var rows = [], row = [], field = '', i = 0, inQuotes = false, c;

    while (i < text.length) {
      c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"' && field === '') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return { header: [], rows: [] };

    var header = rows[0].map(function (h) { return h.trim(); });
    var out = rows.slice(1).filter(function (r) {
      return r.some(function (v) { return v !== ''; });
    }).map(function (r) {
      var o = {};
      header.forEach(function (h, idx) { o[h] = r[idx] === undefined ? '' : r[idx]; });
      return o;
    });
    return { header: header, rows: out };
  }

  function toCSV(header, rows) {
    function esc(v) {
      v = v == null ? '' : String(v);
      return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }
    return [header.map(esc).join(',')]
      .concat(rows.map(function (r) { return r.map(esc).join(','); }))
      .join('\r\n');
  }

  global.CSV = { parse: parse, toCSV: toCSV };
})(window);
