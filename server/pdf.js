'use strict';
const PDFDocument = require('pdfkit');
const { STATUS_LABELS } = require('./db');

const eur = (cents) =>
  // Espaces insécables remplacés : la police standard des PDF ne les connaît pas.
  (cents / 100).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/[\u202f\u00a0]/g, ' ') + ' €';

const frDate = (iso) => {
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' }) +
    ' ' + d.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
};

// Écrit le bon de commande dans `out` (flux inscriptible).
function orderPdf(order, lines, settings, out) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Commande ${order.number}` } });
  doc.pipe(out);
  const c = order.client;
  const L = 40;
  const R = 555;

  // En-tête
  doc.font('Helvetica-Bold').fontSize(16).text(settings.company_name || '', L, 40);
  doc.font('Helvetica').fontSize(9).fillColor('#444');
  const company = [settings.company_address, settings.company_vat && 'TVA : ' + settings.company_vat,
    settings.company_phone, settings.company_email].filter(Boolean).join('\n');
  if (company) doc.text(company, L, 62, { width: 250 });
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(18).text('BON DE COMMANDE', 300, 40, { width: 255, align: 'right' });
  doc.font('Helvetica').fontSize(10)
    .text(`N° ${order.number}`, 300, 64, { width: 255, align: 'right' })
    .text(`Date : ${frDate(order.created_at)}`, { width: 255, align: 'right' })
    .text(`Délégué : ${order.user_name || '-'}`, { width: 255, align: 'right' })
    .text(`Statut : ${STATUS_LABELS[order.status] || order.status}`, { width: 255, align: 'right' });

  // Blocs client / livraison
  const top = 135;
  const box = (x, title, rows) => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#666').text(title.toUpperCase(), x, top);
    doc.fillColor('#000').font('Helvetica').fontSize(10);
    doc.text(rows.filter(Boolean).join('\n'), x, top + 14, { width: 245 });
    return doc.y;
  };
  const hasDel = c.del_address || c.del_city;
  const y1 = box(L, 'Client — siège social', [
    c.name, c.hq_address, [c.hq_zip, c.hq_city].filter(Boolean).join(' '),
    c.vat && 'TVA : ' + c.vat, c.number && 'N° client : ' + c.number,
    c.phone && 'Tél. : ' + c.phone, c.email,
  ]);
  const y2 = box(310, 'Adresse de livraison', [
    c.name,
    hasDel ? c.del_address : c.hq_address,
    hasDel ? [c.del_zip, c.del_city].filter(Boolean).join(' ') : [c.hq_zip, c.hq_city].filter(Boolean).join(' '),
    c.hours && 'Horaires : ' + c.hours,
    c.manager_name && 'Contact : ' + c.manager_name + (c.manager_phone ? ' — ' + c.manager_phone : ''),
  ]);

  // Tableau des lignes
  const cols = [
    { t: 'Référence', x: L, w: 75 },
    { t: 'Désignation', x: 117, w: 180 },
    { t: 'Qté', x: 299, w: 30, a: 'right' },
    { t: 'Unité', x: 335, w: 70 },
    { t: 'PU HT', x: 405, w: 50, a: 'right' },
    { t: 'Rem.', x: 457, w: 35, a: 'right' },
    { t: 'Total HT', x: 494, w: 61, a: 'right' },
  ];
  let y = Math.max(y1, y2) + 20;
  const header = () => {
    doc.rect(L, y, R - L, 18).fill('#222');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8.5);
    for (const col of cols) doc.text(col.t, col.x + 3, y + 5, { width: col.w - 6, align: col.a || 'left' });
    doc.fillColor('#000').font('Helvetica').fontSize(9);
    y += 22;
  };
  header();
  lines.forEach((l, i) => {
    const unit = l.unit_qty > 1 ? `${l.unitLabel} (${l.unit_qty} pcs)` : l.unitLabel;
    const cells = [l.ref, l.name, String(l.qty), unit, eur(l.net_cents),
      l.discount_pct ? `${l.discount_pct} %${l.promo ? '*' : ''}` : '', eur(l.total_cents)];
    const h = Math.max(...cells.map((t, k) => doc.heightOfString(t, { width: cols[k].w - 6 }))) + 6;
    if (y + h > 760) {
      doc.addPage();
      y = 40;
      header();
    }
    if (i % 2) doc.rect(L, y - 2, R - L, h).fill('#f3f3f3').fillColor('#000');
    cells.forEach((t, k) => doc.text(t, cols[k].x + 3, y + 1, { width: cols[k].w - 6, align: cols[k].a || 'left' }));
    y += h;
  });
  doc.moveTo(L, y).lineTo(R, y).strokeColor('#222').stroke();

  // Totaux
  if (y > 690) {
    doc.addPage();
    y = 40;
  }
  y += 12;
  const vat = Math.round((order.total_cents * order.vat_pct) / 100);
  const row = (label, value, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 10);
    doc.text(label, 360, y, { width: 110, align: 'right' });
    doc.text(value, 474, y, { width: 81, align: 'right' });
    y += bold ? 18 : 15;
  };
  row('Total HT', eur(order.total_cents));
  row(`TVA ${order.vat_pct} %`, eur(vat));
  row('Total TTC', eur(order.total_cents + vat), true);
  if (lines.some((l) => l.promo)) {
    doc.font('Helvetica').fontSize(8).fillColor('#666').text('* remise promotionnelle', L, y);
    y += 14;
  }
  if (order.note) {
    doc.fillColor('#666').font('Helvetica-Bold').fontSize(9).text('REMARQUE', L, y + 6);
    doc.fillColor('#000').font('Helvetica').fontSize(10).text(order.note, L, y + 20, { width: R - L });
  }
  doc.end();
}

module.exports = { orderPdf };
