// Alenjo: builds a formatted Excel workbook (.xlsx) from your transactions.
// Loaded only when you tap Export. No libraries: writes the Office Open XML
// parts and zips them (stored, no compression).
//
// Sheets:
//   Transactions  a filterable table with category and status chips
//   Summary       category x month totals (live formulas) and two charts
//   Lists         hidden; the category list behind the Category dropdown
(function() {
  'use strict';

  // ---------- zip (stored) ----------
  var CRC = (function() {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    files.forEach(function(f) {
      var name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint16(8, 0, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var size = central.reduce(function(s, p) { return s + p.length; }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, size, true); e.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(e.buffer)]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // ---------- helpers ----------
  function x(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
  function col(n) { var s = ''; n++; while (n) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }
  function serial(ymd) { var p = ymd.split('-'); return (Date.UTC(+p[0], +p[1] - 1, +(p[2] || 1)) - Date.UTC(1899, 11, 30)) / 86400000; }
  function str(ref, v, s) { return '<c r="' + ref + '" t="inlineStr"' + (s ? ' s="' + s + '"' : '') + '><is><t xml:space="preserve">' + x(v) + '</t></is></c>'; }
  function num(ref, v, s) { return '<c r="' + ref + '"' + (s ? ' s="' + s + '"' : '') + '><v>' + (Math.round(v * 100) / 100) + '</v></c>'; }
  function fstr(ref, f, v, s) { return '<c r="' + ref + '" t="str"' + (s ? ' s="' + s + '"' : '') + '><f>' + x(f) + '</f><v>' + x(v) + '</v></c>'; }
  function fnum(ref, f, v, s) { return '<c r="' + ref + '"' + (s ? ' s="' + s + '"' : '') + '><f>' + x(f) + '</f><v>' + (Math.round(v * 100) / 100) + '</v></c>'; }
  function hex(c) { return c.replace('#', '').toUpperCase(); }
  function mix(c, w, t) { // blend colour c with white by weight t (0..1 of c)
    var n = parseInt(hex(c), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    var f = function(v) { return Math.round(v * t + w * (1 - t)).toString(16).padStart(2, '0'); };
    return (f(r) + f(g) + f(b)).toUpperCase();
  }
  function dark(c, t) { var n = parseInt(hex(c), 16), f = function(v) { return Math.round(v * t).toString(16).padStart(2, '0'); }; return (f(n >> 16) + f((n >> 8) & 255) + f(n & 255)).toUpperCase(); }
  var GREEN = '2F7D4F', INK = '1F2328', MUTED = '6B7076', LINE = 'E3E1DA';
  var TRANSFERS = ['Transfers in', 'Transfers out', 'Loan & card payments'];

  // ---------- build ----------
  // data: { rows:[{date,name,category,account,amount,full,status,note}], categories:[...],
  //         colors:{cat:'#hex'}, budgets:{'YYYY-MM':{cat:amount}}, exported:'Nov 21, 2026', title }
  function build(data) {
    var rows = data.rows.slice().sort(function(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var N = rows.length + 1;                       // last data row
    var R = function(c) { return 'Transactions!$' + c + '$2:$' + c + '$' + Math.max(N, 2); };
    var typeOf = function(r) { return TRANSFERS.indexOf(r.category) >= 0 ? 'Transfer' : r.amount < 0 ? 'Spending' : r.amount > 0 ? 'Money in' : 'Not counted'; };

    // Months (newest 12 with data, shown oldest -> newest) and category totals
    var monthSet = {};
    rows.forEach(function(r) { monthSet[r.date.slice(0, 7)] = 1; });
    var months = Object.keys(monthSet).sort().slice(-12);
    var spend = {}, inBy = {}, catTotal = {};
    rows.forEach(function(r) {
      var m = r.date.slice(0, 7), t = typeOf(r);
      if (months.indexOf(m) < 0) return;
      if (t === 'Spending') { spend[r.category] = spend[r.category] || {}; spend[r.category][m] = (spend[r.category][m] || 0) - r.amount; catTotal[r.category] = (catTotal[r.category] || 0) - r.amount; }
      else if (t === 'Money in') inBy[m] = (inBy[m] || 0) + r.amount;
    });
    var spendCats = Object.keys(catTotal).sort(function(a, b) { return catTotal[b] - catTotal[a]; });
    var lastM = months[months.length - 1];
    var bud = (data.budgets && lastM && data.budgets[lastM]) || {};
    var hasBud = Object.keys(bud).length > 0;

    // ---- styles ----
    // Category and status chips are conditional formats (dxf): a tinted fill with dark text.
    var dxfs = [], cf = [];
    var chip = function(color) { dxfs.push('<dxf><font><b/><color rgb="FF' + dark(color, 0.62) + '"/></font><fill><patternFill patternType="solid"><bgColor rgb="FF' + mix(color, 255, 0.2) + '"/></patternFill></fill></dxf>'); return dxfs.length - 1; };
    var catList = data.categories.slice();
    rows.forEach(function(r) { if (catList.indexOf(r.category) < 0) catList.push(r.category); });
    catList.forEach(function(c) {
      var color = c === 'Income' ? '#' + GREEN : TRANSFERS.indexOf(c) >= 0 ? '#8A8F96' : (data.colors[c] || '#5E7FA3');
      cf.push({ ref: 'C2:C' + Math.max(N, 2), dxf: chip(color), val: c });
    });
    [['Pending', '#D98A2B'], ['Split', '#4F6BD8'], ['Adjusted', '#A07FE0'], ['Reimbursed', '#8A8F96'], ['Manual', '#5E7FA3']].forEach(function(s) {
      cf.push({ ref: 'H2:H' + Math.max(N, 2), dxf: chip(s[1]), val: s[0], begins: true });
    });
    dxfs.push('<dxf><font><color rgb="FF' + GREEN + '"/></font></dxf>');
    var greenDxf = dxfs.length - 1;
    dxfs.push('<dxf><font><color rgb="FF' + MUTED + '"/></font></dxf>');
    var mutedDxf = dxfs.length - 1;

    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="4">' +
        '<numFmt numFmtId="164" formatCode="mmm d, yyyy"/>' +
        '<numFmt numFmtId="165" formatCode="&quot;+$&quot;#,##0.00;&quot;-$&quot;#,##0.00;&quot;$&quot;0.00"/>' +
        '<numFmt numFmtId="166" formatCode="&quot;$&quot;#,##0.00;&quot;-$&quot;#,##0.00;&quot;–&quot;"/>' +
        '<numFmt numFmtId="167" formatCode="mmm yyyy"/>' +
      '</numFmts>' +
      '<fonts count="7">' +
        '<font><sz val="11"/><color rgb="FF' + INK + '"/><name val="Calibri"/><family val="2"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FF' + INK + '"/><name val="Calibri"/><family val="2"/></font>' +
        '<font><b/><sz val="18"/><color rgb="FF' + INK + '"/><name val="Calibri"/><family val="2"/></font>' +
        '<font><sz val="10"/><color rgb="FF' + MUTED + '"/><name val="Calibri"/><family val="2"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FF' + GREEN + '"/><name val="Calibri"/><family val="2"/></font>' +
        '<font><sz val="11"/><color rgb="FF' + MUTED + '"/><name val="Calibri"/><family val="2"/></font>' +
        '<font><b/><sz val="10"/><color rgb="FF' + MUTED + '"/><name val="Calibri"/><family val="2"/></font>' +
      '</fonts>' +
      '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF2EC"/><bgColor indexed="64"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFF4F3EF"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>' +
        '<border><left/><right/><top style="thin"><color rgb="FF' + INK + '"/></top><bottom/><diagonal/></border>' +
        '<border><left/><right/><top/><bottom style="thin"><color rgb="FF' + LINE + '"/></bottom><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="17">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                                   // 0 text
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>' + // 1 date
        '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +                         // 2 signed money
        '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +                         // 3 money
        '<xf numFmtId="167" fontId="6" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right"/></xf>' + // 4 month header
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                    // 5 title
        '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                    // 6 subtitle
        '<xf numFmtId="0" fontId="6" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +                      // 7 header text
        '<xf numFmtId="166" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' + // 8 total money
        '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +      // 9 total text
        '<xf numFmtId="167" fontId="5" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyAlignment="1"><alignment horizontal="left"/></xf>' + // 10 month helper
        '<xf numFmtId="166" fontId="4" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' + // 11 money in row
        '<xf numFmtId="0" fontId="4" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>' +                    // 12 money in label
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="0"/></xf>' +   // 13 text
        '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                    // 14 muted text
        '<xf numFmtId="166" fontId="6" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right"/></xf>' + // 15 header right
        '<xf numFmtId="0" fontId="6" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right"/></xf>' + // 16 header text right
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '<dxfs count="' + dxfs.length + '">' + dxfs.join('') + '</dxfs>' +
      '<tableStyles count="0" defaultTableStyle="TableStyleMedium7" defaultPivotStyle="PivotStyleLight16"/>' +
      '</styleSheet>';

    // ---- sheet 1: Transactions ----
    var HEAD = ['Date', 'Name', 'Category', 'Account', 'Type', 'Amount', 'Full amount', 'Status', 'Note', 'Month'];
    var s1 = [];
    s1.push('<row r="1" ht="22" customHeight="1">' + HEAD.map(function(h, i) { return str(col(i) + '1', h, i === 5 || i === 6 ? 16 : 7); }).join('') + '</row>');
    rows.forEach(function(r, i) {
      var n = i + 2, d = serial(r.date);
      var typeF = 'IF(OR(C' + n + '="Transfers in",C' + n + '="Transfers out",C' + n + '="Loan & card payments"),"Transfer",IF(F' + n + '<0,"Spending",IF(F' + n + '>0,"Money in","Not counted")))';
      s1.push('<row r="' + n + '">' +
        num('A' + n, d, 1) + str('B' + n, r.name, 13) + str('C' + n, r.category) + str('D' + n, r.account, 14) +
        fstr('E' + n, typeF, typeOf(r), 14) + num('F' + n, r.amount, 2) +
        (Math.abs(r.full - r.amount) > 0.004 ? num('G' + n, r.full, 2) : '<c r="G' + n + '" s="2"/>') +
        (r.status ? str('H' + n, r.status) : '<c r="H' + n + '"/>') + (r.note ? str('I' + n, r.note, 14) : '<c r="I' + n + '"/>') +
        fnum('J' + n, 'DATE(YEAR(A' + n + '),MONTH(A' + n + '),1)', serial(r.date.slice(0, 7) + '-01'), 10) +
        '</row>');
    });
    var cfXml = '', pri = 1;
    cf.forEach(function(c) {
      var f = c.begins ? 'LEFT(' + c.ref.split(':')[0] + ',' + c.val.length + ')="' + x(c.val) + '"' : x('"' + c.val.replace(/"/g, '""') + '"');
      cfXml += c.begins
        ? '<conditionalFormatting sqref="' + c.ref + '"><cfRule type="beginsWith" dxfId="' + c.dxf + '" priority="' + (pri++) + '" operator="beginsWith" text="' + x(c.val) + '"><formula>' + f + '</formula></cfRule></conditionalFormatting>'
        : '<conditionalFormatting sqref="' + c.ref + '"><cfRule type="cellIs" dxfId="' + c.dxf + '" priority="' + (pri++) + '" operator="equal"><formula>' + f + '</formula></cfRule></conditionalFormatting>';
    });
    var lastRow = Math.max(N, 2);
    cfXml += '<conditionalFormatting sqref="F2:G' + lastRow + '"><cfRule type="cellIs" dxfId="' + greenDxf + '" priority="' + (pri++) + '" operator="greaterThan"><formula>0</formula></cfRule></conditionalFormatting>';
    cfXml += '<conditionalFormatting sqref="E2:E' + lastRow + '"><cfRule type="cellIs" dxfId="' + mutedDxf + '" priority="' + (pri++) + '" operator="equal"><formula>"Transfer"</formula></cfRule></conditionalFormatting>';
    var sheet1 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetPr><tabColor rgb="FF' + GREEN + '"/></sheetPr>' +
      '<dimension ref="A1:J' + lastRow + '"/>' +
      '<sheetViews><sheetView workbookViewId="0" tabSelected="1" zoomScale="110"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="20" customHeight="1"/>' +
      '<cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="32" customWidth="1"/><col min="3" max="3" width="22" customWidth="1"/>' +
      '<col min="4" max="4" width="20" customWidth="1"/><col min="5" max="5" width="12" customWidth="1"/><col min="6" max="7" width="13" customWidth="1"/>' +
      '<col min="8" max="8" width="13" customWidth="1"/><col min="9" max="9" width="34" customWidth="1"/><col min="10" max="10" width="11" customWidth="1"/></cols>' +
      '<sheetData>' + s1.join('') + '</sheetData>' +
      cfXml +
      '<dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="C2:C' + lastRow + '"><formula1>Lists!$A$1:$A$' + catList.length + '</formula1></dataValidation></dataValidations>' +
      '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      '<pageSetup orientation="landscape" fitToHeight="0"/>' +
      '<tableParts count="1"><tablePart r:id="rId1"/></tableParts>' +
      '</worksheet>';
    var table = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Transactions" displayName="Transactions" ref="A1:J' + lastRow + '" totalsRowShown="0">' +
      '<autoFilter ref="A1:J' + lastRow + '"/>' +
      '<tableColumns count="10">' + HEAD.map(function(h, i) { return '<tableColumn id="' + (i + 1) + '" name="' + h + '"/>'; }).join('') + '</tableColumns>' +
      '<tableStyleInfo name="TableStyleMedium7" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>' +
      '</table>';

    // ---- sheet 2: Summary ----
    var mc = months.length, totCol = col(1 + mc), budCol = col(2 + mc), leftCol = col(3 + mc);
    var s2 = [], r = 1;
    s2.push('<row r="1" ht="30" customHeight="1">' + str('A1', data.title || 'Spending summary', 5) + '</row>');
    s2.push('<row r="2">' + str('A2', 'Exported ' + data.exported + ' from Alenjo · edit a category on Transactions and these totals update', 6) + '</row>');
    var H = 4;
    var hdr = str('A' + H, 'Category', 7) + months.map(function(m, i) { return num(col(1 + i) + H, serial(m + '-01'), 4); }).join('') + str(totCol + H, 'Total', 16);
    if (hasBud) hdr += str(budCol + H, 'Budget · ' + new Date(serial(lastM + '-01') * 86400000 + Date.UTC(1899, 11, 30)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }), 16) + str(leftCol + H, 'Left', 16);
    s2.push('<row r="' + H + '" ht="22" customHeight="1">' + hdr + '</row>');
    // Money in
    var IN = H + 1;
    var line = str('A' + IN, 'Money in', 12);
    months.forEach(function(m, i) { var c = col(1 + i); line += fnum(c + IN, 'SUMIFS(' + R('F') + ',' + R('E') + ',"Money in",' + R('J') + ',' + c + '$' + H + ')', inBy[m] || 0, 11); });
    var inTot = months.reduce(function(s, m) { return s + (inBy[m] || 0); }, 0);
    line += fnum(totCol + IN, 'SUM(B' + IN + ':' + col(mc) + IN + ')', inTot, 11);
    if (hasBud) line += '<c r="' + budCol + IN + '" s="11"/><c r="' + leftCol + IN + '" s="11"/>';
    s2.push('<row r="' + IN + '" ht="22" customHeight="1">' + line + '</row>');
    // Spending by category
    var C0 = IN + 2;
    spendCats.forEach(function(cat, k) {
      var n = C0 + k, ln = str('A' + n, cat);
      months.forEach(function(m, i) { var c = col(1 + i); ln += fnum(c + n, '-SUMIFS(' + R('F') + ',' + R('C') + ',$A' + n + ',' + R('E') + ',"Spending",' + R('J') + ',' + c + '$' + H + ')', (spend[cat] && spend[cat][m]) || 0, 3); });
      ln += fnum(totCol + n, 'SUM(B' + n + ':' + col(mc) + n + ')', catTotal[cat], 3);
      if (hasBud) {
        var b = bud[cat];
        ln += b != null ? num(budCol + n, b, 3) + fnum(leftCol + n, budCol + n + '-' + col(mc) + n, b - ((spend[cat] && spend[cat][lastM]) || 0), 3) : '<c r="' + budCol + n + '"/><c r="' + leftCol + n + '"/>';
      }
      s2.push('<row r="' + n + '">' + ln + '</row>');
    });
    var C1 = C0 + Math.max(spendCats.length, 1) - 1, SP = C1 + 1, LO = SP + 1;
    var spentBy = function(m) { return spendCats.reduce(function(s, c) { return s + ((spend[c] && spend[c][m]) || 0); }, 0); };
    var sp = str('A' + SP, 'Spent', 9), lo = str('A' + LO, 'Left over', 9);
    months.concat(['__tot']).forEach(function(m, i) {
      var c = col(1 + i), sv = m === '__tot' ? spendCats.reduce(function(s, k) { return s + catTotal[k]; }, 0) : spentBy(m);
      var iv = m === '__tot' ? inTot : (inBy[m] || 0);
      sp += fnum(c + SP, 'SUM(' + c + C0 + ':' + c + C1 + ')', sv, 8);
      lo += fnum(c + LO, c + IN + '-' + c + SP, iv - sv, 8);
    });
    if (hasBud) { sp += '<c r="' + budCol + SP + '" s="8"/><c r="' + leftCol + SP + '" s="8"/>'; lo += '<c r="' + budCol + LO + '" s="8"/><c r="' + leftCol + LO + '" s="8"/>'; }
    s2.push('<row r="' + SP + '" ht="22" customHeight="1">' + sp + '</row>', '<row r="' + LO + '" ht="22" customHeight="1">' + lo + '</row>');
    var chartTop = LO + 2;
    var lastCol = hasBud ? 3 + mc : 1 + mc;
    var sheet2 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetPr><tabColor rgb="FF4F6BD8"/></sheetPr>' +
      '<dimension ref="A1:' + col(lastCol) + LO + '"/>' +
      '<sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="110"><pane xSplit="1" ySplit="' + H + '" topLeftCell="B' + (H + 1) + '" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="B' + (H + 1) + '" sqref="B' + (H + 1) + '"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="20" customHeight="1"/>' +
      '<cols><col min="1" max="1" width="26" customWidth="1"/><col min="2" max="' + (lastCol + 1) + '" width="13" customWidth="1"/></cols>' +
      '<sheetData>' + s2.join('') + '</sheetData>' +
      '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
      '<drawing r:id="rId1"/>' +
      '</worksheet>';

    // ---- charts ----
    var lastMName = lastM ? new Date(serial(lastM + '-01') * 86400000 + Date.UTC(1899, 11, 30)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
    var lastMCol = col(mc);
    var nCat = Math.max(spendCats.length, 1);
    var catRef = "Summary!$A$" + C0 + ":$A$" + C1, valRef = "Summary!$" + lastMCol + "$" + C0 + ":$" + lastMCol + "$" + C1;
    var monthRef = "Summary!$B$" + H + ":$" + col(mc) + "$" + H;
    function strCache(vals) { return '<c:strCache><c:ptCount val="' + vals.length + '"/>' + vals.map(function(v, i) { return '<c:pt idx="' + i + '"><c:v>' + x(v) + '</c:v></c:pt>'; }).join('') + '</c:strCache>'; }
    function numCache(vals, fmt) { return '<c:numCache><c:formatCode>' + x(fmt || '"$"#,##0') + '</c:formatCode><c:ptCount val="' + vals.length + '"/>' + vals.map(function(v, i) { return '<c:pt idx="' + i + '"><c:v>' + (Math.round(v * 100) / 100) + '</c:v></c:pt>'; }).join('') + '</c:numCache>'; }
    function sp_(color) { return '<c:spPr><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>'; }
    function txt(sz, bold, color) { return '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="' + sz + '" b="' + (bold ? 1 : 0) + '"><a:solidFill><a:srgbClr val="' + (color || MUTED) + '"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>'; }
    function title(t) { return '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1300" b="1"><a:solidFill><a:srgbClr val="' + INK + '"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:r><a:rPr lang="en-US" sz="1300" b="1"><a:solidFill><a:srgbClr val="' + INK + '"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>' + x(t) + '</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>'; }
    function axes(catPos, valPos, catDelete) {
      return '<c:catAx><c:axId val="1001"/><c:scaling><c:orientation val="' + (catPos === 'l' ? 'maxMin' : 'minMax') + '"/></c:scaling><c:delete val="' + (catDelete ? 1 : 0) + '"/><c:axPos val="' + catPos + '"/><c:numFmt formatCode="mmm yyyy" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:solidFill><a:srgbClr val="' + LINE + '"/></a:solidFill></a:ln></c:spPr>' + txt(900, false) + '<c:crossAx val="1002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>' +
        '<c:valAx><c:axId val="1002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="' + valPos + '"/><c:majorGridlines><c:spPr><a:ln><a:solidFill><a:srgbClr val="' + LINE + '"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="&quot;$&quot;#,##0" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>' + txt(900, false) + '<c:crossAx val="1001"/><c:crosses val="' + (catPos === 'l' ? 'max' : 'autoZero') + '"/><c:crossBetween val="between"/></c:valAx>';
    }
    function chartDoc(inner) {
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:roundedCorners val="0"/>' +
        inner + '<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="' + LINE + '"/></a:solidFill></a:ln></c:spPr><c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>';
    }
    var catColors = spendCats.map(function(c) { return hex(data.colors[c] || '#5E7FA3'); });
    var chart1 = chartDoc('<c:chart>' + title('Spending by category · ' + lastMName) +
      '<c:plotArea><c:layout/><c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/><c:varyColors val="0"/>' +
      '<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>' + x(lastMName) + '</c:v></c:tx>' + sp_(catColors[0] || '4F6BD8') + '<c:invertIfNegative val="0"/>' +
      catColors.map(function(c, i) { return '<c:dPt><c:idx val="' + i + '"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/>' + sp_(c) + '</c:dPt>'; }).join('') +
      '<c:dLbls><c:numFmt formatCode="&quot;$&quot;#,##0" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>' + txt(900, true, INK) + '<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>' +
      '<c:cat><c:strRef><c:f>' + catRef + '</c:f>' + strCache(spendCats) + '</c:strRef></c:cat>' +
      '<c:val><c:numRef><c:f>' + valRef + '</c:f>' + numCache(spendCats.map(function(c) { return (spend[c] && spend[c][lastM]) || 0; })) + '</c:numRef></c:val></c:ser>' +
      '<c:gapWidth val="45"/><c:axId val="1001"/><c:axId val="1002"/></c:barChart>' + axes('l', 'b', false) + '</c:plotArea>' +
      '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>');
    var monthLabels = months.map(function(m) { return serial(m + '-01'); });
    function monthSer(idx, name, row, vals, color) {
      return '<c:ser><c:idx val="' + idx + '"/><c:order val="' + idx + '"/><c:tx><c:strRef><c:f>Summary!$A$' + row + '</c:f>' + strCache([name]) + '</c:strRef></c:tx>' + sp_(color) + '<c:invertIfNegative val="0"/>' +
        '<c:cat><c:numRef><c:f>' + monthRef + '</c:f>' + numCache(monthLabels, 'mmm yyyy') + '</c:numRef></c:cat>' +
        '<c:val><c:numRef><c:f>Summary!$B$' + row + ':$' + col(mc) + '$' + row + '</c:f>' + numCache(vals) + '</c:numRef></c:val></c:ser>';
    }
    var chart2 = chartDoc('<c:chart>' + title('Money in vs spent') +
      '<c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>' +
      monthSer(0, 'Money in', IN, months.map(function(m) { return inBy[m] || 0; }), GREEN) +
      monthSer(1, 'Spent', SP, months.map(spentBy), '9AA0A6') +
      '<c:gapWidth val="60"/><c:overlap val="-10"/><c:axId val="1001"/><c:axId val="1002"/></c:barChart>' + axes('b', 'l', false) + '</c:plotArea>' +
      '<c:legend><c:legendPos val="t"/><c:overlay val="0"/>' + txt(1000, false, INK) + '</c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>');
    function anchor(id, rid, c0, r0, c1, r1, name) {
      return '<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>' + c0 + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + r0 + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>' + c1 + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + r1 + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
        '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="' + id + '" name="' + name + '"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="' + rid + '"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>';
    }
    var h1 = Math.max(14, Math.round(nCat * 1.4) + 5);
    var drawing = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      anchor(2, 'rId1', 0, chartTop, 6, chartTop + h1, 'Spending by category') +
      anchor(3, 'rId2', 0, chartTop + h1 + 1, 6, chartTop + h1 + 17, 'Money in vs spent') +
      '</xdr:wsDr>';

    // ---- sheet 3: Lists (hidden) ----
    var sheet3 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      catList.map(function(c, i) { return '<row r="' + (i + 1) + '">' + str('A' + (i + 1), c) + '</row>'; }).join('') + '</sheetData></worksheet>';

    var REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    var files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>' +
        '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' +
        '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' +
        '<Override PartName="/xl/charts/chart2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '</Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="xl/workbook.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
      { name: 'docProps/core.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Alenjo transactions</dc:title><dc:creator>Alenjo</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().replace(/\.\d+Z$/, 'Z') + '</dcterms:created></cp:coreProperties>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + REL + '">' +
        '<bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
        '<sheet name="Transactions" sheetId="1" r:id="rId1"/><sheet name="Summary" sheetId="2" r:id="rId2"/><sheet name="Lists" sheetId="3" state="hidden" r:id="rId3"/>' +
        '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="' + REL + '/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="' + REL + '/worksheet" Target="worksheets/sheet2.xml"/>' +
        '<Relationship Id="rId3" Type="' + REL + '/worksheet" Target="worksheets/sheet3.xml"/>' +
        '<Relationship Id="rId4" Type="' + REL + '/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: styles },
      { name: 'xl/worksheets/sheet1.xml', data: sheet1 },
      { name: 'xl/worksheets/_rels/sheet1.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + REL + '/table" Target="../tables/table1.xml"/></Relationships>' },
      { name: 'xl/tables/table1.xml', data: table },
      { name: 'xl/worksheets/sheet2.xml', data: sheet2 },
      { name: 'xl/worksheets/_rels/sheet2.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + REL + '/drawing" Target="../drawings/drawing1.xml"/></Relationships>' },
      { name: 'xl/drawings/drawing1.xml', data: drawing },
      { name: 'xl/drawings/_rels/drawing1.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="' + REL + '/chart" Target="../charts/chart1.xml"/><Relationship Id="rId2" Type="' + REL + '/chart" Target="../charts/chart2.xml"/></Relationships>' },
      { name: 'xl/charts/chart1.xml', data: chart1 },
      { name: 'xl/charts/chart2.xml', data: chart2 },
      { name: 'xl/worksheets/sheet3.xml', data: sheet3 }
    ];
    return zip(files);
  }

  window.AlenjoXlsx = { build: build };
})();
