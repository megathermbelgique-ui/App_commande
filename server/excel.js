'use strict';
// Lecture et écriture de fichiers Excel (.xlsx).
const ExcelJS = require('exceljs');
const { normalize } = require('./db');

function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.result !== undefined) return cellText(v.result); // formule : valeur calculée
    if (v.text !== undefined) return cellText(v.text);     // lien
    return '';
  }
  return String(v);
}

// Première feuille du classeur -> tableau d'objets indexés par nom de colonne normalisé
// (minuscules, sans accent, espaces remplacés par « _ »), comme pour un CSV.
async function readRows(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];
  const rows = [];
  let header = null;
  sheet.eachRow((row) => {
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => (cells[col - 1] = cellText(cell.value).trim()));
    if (!header) {
      if (cells.some(Boolean)) header = cells.map(headerKey);
      return;
    }
    if (cells.some(Boolean)) rows.push(Object.fromEntries(header.map((h, i) => [h, cells[i] || ''])));
  });
  return rows;
}

const headerKey = (h) => normalize(h).trim().replace(/[\s-]+/g, '_');

// sheets : [{ name, columns: [{ header, key, width, money }], rows: [objet] }]
async function sendWorkbook(res, filename, sheets) {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = s.columns.map((c) => ({
      header: c.header, key: c.key, width: c.width || 16,
      style: c.money ? { numFmt: '#,##0.00' } : c.text ? { numFmt: '@' } : {},
    }));
    ws.getRow(1).font = { bold: true };
    for (const r of s.rows) ws.addRow(r);
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}

module.exports = { readRows, sendWorkbook, headerKey };
