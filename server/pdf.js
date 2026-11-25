'use strict';
const PDFDocument = require('pdfkit');
const { STATUS_LABELS } = require('./db');

const eur = (cents) =>
  // Espaces insécables remplacés : la police standard des PDF ne les connaît pas.
  (cents / 100).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/[  ]/g, ' ') + ' €';

const frDate = (iso) => {
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' }) +
    ' ' + d.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
};
const frDay = (ymd) => (ymd ? ymd.split('-').reverse().join('/') : '');
const pctText = (n) => String(n).replace('.', ',') + ' %';

// Image « data URL » -> tampon lisible par pdfkit (côté serveur comme dans le navigateur).
function imageBytes(dataUrl) {
  const b64 = String(dataUrl || '').split(',')[1];
  if (!b64) return null;
  if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}

// Écrit un document dans `out` (flux inscriptible).
//   opts.kind : 'commande' (défaut), 'facture' ou 'livraison' (sans prix, avec la preuve de réception)
//   opts.proof : preuve de livraison { received_by, signature, created_at, user_name }
// `Doc` : classe PDFDocument à utiliser (version navigateur dans la page de démonstration).
function orderPdf(order, lines, settings, out, Doc = PDFDocument, opts = {}) {
  const kind = opts.kind || 'commande';
  const title = { commande: 'BON DE COMMANDE', facture: 'FACTURE', livraison: 'BON DE LIVRAISON' }[kind];
  const number = kind === 'facture' ? order.invoice_number : order.number;
  const doc = new Doc({ size: 'A4', margin: 40, info: { Title: `${title} ${number}` } });
  if (out) doc.pipe(out);
  const c = order.client;
  const L = 40;
  const R = 555;

  // En-tête
  doc.font('Helvetica-Bold').fontSize(16).text(settings.company_name || '', L, 40);
  doc.font('Helvetica').fontSize(9).fillColor('#444');
  const company = [settings.company_address, settings.company_vat && 'TVA : ' + settings.company_vat,
    settings.company_phone, settings.company_email].filter(Boolean).join('\n');
  if (company) doc.text(company, L, 62, { width: 250 });
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(18).text(title, 300, 40, { width: 255, align: 'right' });
  doc.font('Helvetica').fontSize(10);
  const meta = kind === 'facture'
    ? [`N° ${number}`, `Date : ${frDay(order.invoiced_on)}`, `Échéance : ${frDay(order.due_on)}`, `Commande : ${order.number}`]
    : [`N° ${number}`, `Date : ${frDate(order.created_at)}`, `Délégué : ${order.user_name || '-'}`,
      kind === 'livraison' ? null : `Statut : ${STATUS_LABELS[order.status] || order.status}`].filter(Boolean);
  doc.text(meta[0], 300, 64, { width: 255, align: 'right' });
  for (const m of meta.slice(1)) doc.text(m, { width: 255, align: 'right' });

  // Blocs client / livraison
  const top = 135;
  const box = (x, label, rows) => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#666').text(label.toUpperCase(), x, top);
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

  // Tableau des lignes (le bon de livraison n'affiche pas les prix)
  const priced = kind !== 'livraison';
  const cols = priced ? [
    { t: 'Référence', x: L, w: 75 },
    { t: 'Désignation', x: 117, w: 180 },
    { t: 'Qté', x: 299, w: 30, a: 'right' },
    { t: 'Unité', x: 335, w: 70 },
    { t: 'PU HT', x: 405, w: 50, a: 'right' },
    { t: 'Rem.', x: 457, w: 35, a: 'right' },
    { t: 'Total HT', x: 494, w: 61, a: 'right' },
  ] : [
    { t: 'Référence', x: L, w: 95 },
    { t: 'Désignation', x: 137, w: 268 },
    { t: 'Qté', x: 407, w: 40, a: 'right' },
    { t: 'Unité', x: 455, w: 100 },
  ];
  let y = Math.max(y1, y2) + 20;
  const header = () => {
    doc.rect(L, y, R - L, 18).fill('#222');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8.5);
    for (const col of cols) doc.text(col.t, col.x + 3, y + 5, { width: col.w - 6, align: col.a || 'left' });
    doc.fillColor('#000').font('Helvetica').fontSize(9);
    y += 22;
  };
  const room = (h) => {
    if (y + h > 760) {
      doc.addPage();
      y = 40;
      header();
    }
  };
  header();

  // Les articles d'une implantation sont regroupés sous son nom.
  const groups = [];
  for (const l of lines) {
    const key = l.implantation_id || 0;
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, name: l.implantation_name, extra: l.extra_pct, lines: [] }));
    g.lines.push(l);
  }
  groups.sort((a, b) => (a.key === 0) - (b.key === 0));
  let star = false;
  let n = 0;
  for (const g of groups) {
    if (g.key) {
      room(34);
      const sub = g.lines.reduce((s, l) => s + l.total_cents, 0);
      doc.rect(L, y - 2, R - L, 16).fill('#e3e3e3').fillColor('#000').font('Helvetica-Bold');
      doc.text(`Implantation ${g.name}` + (g.extra && priced ? ` — remise implantation ${pctText(g.extra)}` : ''), L + 3, y + 2, { width: 400 });
      if (priced) doc.text(eur(sub), 474, y + 2, { width: 78, align: 'right' });
      doc.font('Helvetica');
      y += 18;
      n = 0;
    } else if (groups.length > 1) {
      room(34);
      doc.rect(L, y - 2, R - L, 16).fill('#e3e3e3').fillColor('#000').font('Helvetica-Bold');
      doc.text('Autres articles', L + 3, y + 2).font('Helvetica');
      y += 18;
      n = 0;
    }
    for (const l of g.lines) {
      const unit = l.unit_qty > 1 ? `${l.unitLabel} (${l.unit_qty} pcs)` : l.unitLabel;
      const rem = [l.discount_pct ? pctText(l.discount_pct) + (l.promo ? '*' : '') : '', l.extra_pct ? '+' + pctText(l.extra_pct) : '']
        .filter(Boolean).join('\n');
      if (l.promo) star = true;
      const cells = priced
        ? [l.ref, l.name, String(l.qty), unit, eur(l.net_cents), rem, eur(l.total_cents)]
        : [l.ref, l.name, String(l.qty), unit];
      const h = Math.max(...cells.map((t, k) => doc.heightOfString(t, { width: cols[k].w - 6 }))) + 6;
      room(h);
      if (n++ % 2) doc.rect(L, y - 2, R - L, h).fill('#f3f3f3').fillColor('#000');
      cells.forEach((t, k) => doc.text(t, cols[k].x + 3, y + 1, { width: cols[k].w - 6, align: cols[k].a || 'left' }));
      y += h;
    }
  }
  doc.moveTo(L, y).lineTo(R, y).strokeColor('#222').stroke();

  if (y > 640) {
    doc.addPage();
    y = 40;
  }
  y += 12;
  if (priced) {
    const vat = Math.round((order.total_cents * order.vat_pct) / 100);
    const row = (label, value, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 10);
      doc.text(label, 360, y, { width: 110, align: 'right' });
      doc.text(value, 474, y, { width: 81, align: 'right' });
      y += bold ? 18 : 15;
    };
    row('Total HT', eur(order.total_cents));
    row(`TVA ${pctText(order.vat_pct)}`, eur(vat));
    row(kind === 'facture' ? 'Total à payer' : 'Total TTC', eur(order.total_cents + vat), true);
    if (star) {
      doc.font('Helvetica').fontSize(8).fillColor('#666').text('* remise promotionnelle', L, y);
      y += 14;
    }
  }
  if (kind === 'facture') {
    doc.fillColor('#000').font('Helvetica').fontSize(10);
    const pay = [`À payer avant le ${frDay(order.due_on)}.`,
      settings.company_iban && `Compte : ${settings.company_iban}`, `Communication : ${number}`,
      order.paid_on && `Payée le ${frDay(order.paid_on)}.`].filter(Boolean).join('\n');
    doc.text(pay, L, y + 6, { width: R - L });
    y = doc.y + 6;
  }
  if (kind === 'livraison') {
    const p = opts.proof;
    doc.fillColor('#666').font('Helvetica-Bold').fontSize(9).text('RÉCEPTION DE LA MARCHANDISE', L, y);
    doc.fillColor('#000').font('Helvetica').fontSize(10);
    if (p) {
      doc.text(`Reçu par : ${p.received_by}\nLe ${frDate(p.created_at)}` + (p.user_name ? `\nLivreur : ${p.user_name}` : ''), L, y + 14, { width: 250 });
      const sig = imageBytes(p.signature);
      if (sig) {
        doc.rect(310, y + 10, 245, 90).strokeColor('#999').stroke();
        try {
          doc.image(sig, 314, y + 14, { fit: [237, 82], align: 'center', valign: 'center' });
        } catch {}
      }
    } else {
      doc.text('Nom :\n\nDate :', L, y + 14);
      doc.rect(310, y + 10, 245, 90).strokeColor('#999').stroke();
      doc.fontSize(8).fillColor('#666').text('Signature', 314, y + 14);
    }
    y += 110;
  }
  if (order.note) {
    doc.fillColor('#666').font('Helvetica-Bold').fontSize(9).text('REMARQUE', L, y + 6);
    doc.fillColor('#000').font('Helvetica').fontSize(10).text(order.note, L, y + 20, { width: R - L });
  }
  doc.end();
  return doc;
}

module.exports = { orderPdf };
