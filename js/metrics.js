/* Adobe base-14 Helvetica width metrics (1/1000 em), WinAnsi code points.
   Needed so the editor preview and the PDF writer measure text identically. */
(function (global) {
  'use strict';

  function table(pairs) {
    var w = new Array(256), i;
    for (i = 0; i < 256; i++) w[i] = pairs.dflt;
    Object.keys(pairs.map).forEach(function (code) { w[+code] = pairs.map[code]; });
    return w;
  }

  // ASCII 32..126 in order.
  var HELV_ASCII = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
    1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
    667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
    333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
    556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];

  var BOLD_ASCII = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
    975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
    667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
    333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
    611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

  // WinAnsi high range that actually shows up in Credible form text.
  var HELV_HIGH = {128:556,130:222,131:556,132:333,133:1000,134:556,135:556,136:333,
    137:1000,138:667,139:333,140:1000,142:611,145:222,146:222,147:333,148:333,
    149:350,150:556,151:1000,152:333,153:1000,154:500,155:333,156:944,158:500,
    159:667,160:278,161:333,162:556,163:556,164:556,165:556,166:260,167:556,
    168:333,169:737,170:370,171:556,172:584,173:333,174:737,175:333,176:400,
    177:584,178:333,179:333,180:333,181:556,182:537,183:278,184:333,185:333,
    186:365,187:556,188:834,189:834,190:834,191:611};

  var BOLD_HIGH = {128:556,130:278,131:556,132:500,133:1000,134:556,135:556,136:333,
    137:1000,138:667,139:333,140:1000,142:611,145:278,146:278,147:500,148:500,
    149:350,150:556,151:1000,152:333,153:1000,154:556,155:333,156:944,158:556,
    159:667,160:278,161:333,162:556,163:556,164:556,165:556,166:280,167:556,
    168:333,169:737,170:370,171:556,172:584,173:333,174:737,175:333,176:400,
    177:584,178:333,179:333,180:333,181:611,182:556,183:278,184:333,185:333,
    186:365,187:556,188:834,189:834,190:834,191:611};

  function build(ascii, high, upperDefault) {
    var map = {}, i;
    for (i = 0; i < ascii.length; i++) map[32 + i] = ascii[i];
    Object.keys(high).forEach(function (c) { map[c] = high[c]; });
    // Latin-1 letters (192..255) track their unaccented counterparts closely enough.
    for (i = 192; i < 256; i++) if (map[i] === undefined) map[i] = upperDefault[i < 223 ? 0 : 1];
    return table({ dflt: 556, map: map });
  }

  var W = {
    H:  build(HELV_ASCII, HELV_HIGH, [722, 556]),
    HB: build(BOLD_ASCII, BOLD_HIGH, [722, 556]),
  };
  W.HO = W.H;   // oblique shares the roman widths
  W.HBO = W.HB;

  /* WinAnsi code for a JS character; returns -1 when unmappable. */
  var UNI2WIN = {
    0x20AC:128,0x201A:130,0x0192:131,0x201E:132,0x2026:133,0x2020:134,0x2021:135,
    0x02C6:136,0x2030:137,0x0160:138,0x2039:139,0x0152:140,0x017D:142,0x2018:145,
    0x2019:146,0x201C:147,0x201D:148,0x2022:149,0x2013:150,0x2014:151,0x02DC:152,
    0x2122:153,0x0161:154,0x203A:155,0x0153:156,0x017E:158,0x0178:159,0x00A0:32
  };

  function winByte(ch) {
    var c = ch.charCodeAt(0);
    if (c < 256) return c;
    if (UNI2WIN[c] !== undefined) return UNI2WIN[c];
    return -1;
  }

  /* Convert a JS string to a WinAnsi byte string, replacing anything unmappable. */
  function toWinAnsi(str) {
    var out = '', i, b;
    for (i = 0; i < str.length; i++) {
      b = winByte(str[i]);
      out += String.fromCharCode(b < 0 ? 63 /* ? */ : b);
    }
    return out;
  }

  /* Width of str at the given point size, in points. */
  function widthOf(str, font, size) {
    var w = W[font] || W.H, total = 0, i, b;
    for (i = 0; i < str.length; i++) {
      b = winByte(str[i]);
      total += w[b < 0 ? 63 : b];
    }
    return total * size / 1000;
  }

  /* Greedy word wrap to maxWidth. Always returns at least one line. */
  function wrap(str, font, size, maxWidth) {
    var words = String(str == null ? '' : str).split(/\s+/).filter(Boolean);
    if (!words.length) return [''];
    var lines = [], cur = words[0], i, test;
    for (i = 1; i < words.length; i++) {
      test = cur + ' ' + words[i];
      if (widthOf(test, font, size) <= maxWidth) cur = test;
      else { lines.push(cur); cur = words[i]; }
    }
    lines.push(cur);
    return lines;
  }

  global.Metrics = { widthOf: widthOf, wrap: wrap, toWinAnsi: toWinAnsi };
})(window);
