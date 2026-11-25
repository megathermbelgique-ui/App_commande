// Faux serveur de la démonstration « interface PC » : mêmes réponses que l'API réelle,
// tout se passe dans le navigateur. L'état modifié est gardé dans le stockage local.
const dNorm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dErr = (status, message) => Object.assign(new Error(message), { status });
const D_UNITS = { piece: 'Pièce', boite: 'Boîte', carton: 'Carton', palette: 'Palette' };
const D_STATUS = { recue: 'Reçue', preparation: 'En préparation', expediee: 'Expédiée', livree: 'Livrée', annulee: 'Annulée' };
const D_KEY = 'demo-admin:v2';
let dState = null;
let dUser = null;
try { dUser = JSON.parse(sessionStorage.getItem(D_KEY + ':user')); } catch {}

async function dReady() {
  if (dState) return dState;
  try { dState = JSON.parse(localStorage.getItem(D_KEY)); } catch {}
  if (!dState) {
    const res = await fetch('data.json');
    if (!res.ok) throw dErr(500, 'Données de démonstration introuvables.');
    dState = await res.json();
  }
  return dState;
}
const dSave = () => { try { localStorage.setItem(D_KEY, JSON.stringify(dState)); } catch {} };
const dNext = (list) => Math.max(0, ...list.map((x) => x.id)) + 1;
const dTokens = (q) => dNorm(q).split(/\s+/).filter(Boolean);
const dCat = (id) => dState.categories.find((c) => c.id === id)?.name || '';
const dProductText = (p) => dNorm([p.ref, p.code, p.name, dCat(p.categoryId), p.description, ...p.units.map((u) => u.ean)].join(' '));
const dClientText = (c) => dNorm([c.number, c.name, c.vat, c.vat.replace(/[^0-9a-z]/gi, ''), c.hq_city, c.hq_zip, c.manager_name, c.email].join(' '));
const dFind = (list, id, what) => {
  const x = list.find((e) => e.id === Number(id));
  if (!x) throw dErr(404, `${what} introuvable.`);
  return x;
};
const dPromoOut = (x) => {
  const p = dState.products.find((e) => e.id === x.productId);
  return { ...x, ref: p?.ref || '', productName: p?.name || '' };
};
function dFilterOrders(query) {
  const t = dTokens(query.get('q'));
  const status = query.get('status');
  const id = Number(query.get('id')) || null;
  return dState.orders.filter((o) => (!status || o.status === status) && (!id || o.id === id)
    && t.every((x) => dNorm([o.number, o.userName, JSON.stringify(o.client)].join(' ')).includes(x)));
}
function dSaveUnits(p, units) {
  const out = [];
  for (const u of units || []) {
    if (!D_UNITS[u.unit]) continue;
    const ean = String(u.ean || '').trim();
    const clash = ean && dState.products.find((x) => x.id !== p.id && x.units.some((y) => y.ean === ean));
    if (clash) throw dErr(400, `Le code-barres ${ean} est déjà utilisé par l'article ${clash.ref}.`);
    out.push({ unit: u.unit, qty: u.unit === 'piece' ? 1 : Math.max(1, Math.floor(Number(u.qty)) || 1), priceCents: Math.max(0, Math.round(Number(u.priceCents)) || 0), ean });
  }
  p.units = out.sort((a, b) => a.qty - b.qty);
}

async function api(path, { method = 'GET', body } = {}) {
  await dReady();
  const [route, qs] = path.split('?');
  const query = new URLSearchParams(qs || '');
  const S = dState;
  let m;
  if (route === '/me') return { user: dUser };
  if (route === '/login') {
    const name = String(body.username || '').trim();
    if (!name || !body.password) throw dErr(401, "Entrez un nom d'utilisateur et un mot de passe.");
    dUser = { id: 1, username: name, name: S.users[0].name, role: 'admin', active: true };
    try { sessionStorage.setItem(D_KEY + ':user', JSON.stringify(dUser)); } catch {}
    return { user: dUser };
  }
  if (route === '/logout') { dUser = null; try { sessionStorage.removeItem(D_KEY + ':user'); } catch {} return { ok: true }; }
  const done = (value) => { dSave(); return value; };

  // Commandes
  if (route === '/orders') return { orders: dFilterOrders(query) };
  if ((m = route.match(/^\/orders\/(\d+)$/))) { const o = dFind(S.orders, m[1], 'Commande'); return { order: o, lines: o.lines }; }
  if ((m = route.match(/^\/admin\/orders\/(\d+)$/)) && method === 'PATCH') {
    const o = dFind(S.orders, m[1], 'Commande');
    if (!D_STATUS[body.status]) throw dErr(400, 'Statut invalide.');
    o.status = body.status; o.statusLabel = D_STATUS[o.status];
    return done({ ok: true });
  }

  // Catégories
  if (route === '/categories') {
    return { categories: [...S.categories].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'fr'))
      .map((c) => ({ ...c, count: S.products.filter((p) => p.categoryId === c.id && p.active !== false).length })) };
  }
  if (route === '/admin/categories' && method === 'POST') {
    const name = String(body.name || '').trim();
    if (!name) throw dErr(400, 'Nom obligatoire.');
    const c = { id: dNext(S.categories), name, sort: Number(body.sort) || 0 };
    S.categories.push(c);
    return done({ id: c.id });
  }
  if ((m = route.match(/^\/admin\/categories\/(\d+)$/))) {
    const c = dFind(S.categories, m[1], 'Catégorie');
    if (method === 'DELETE') {
      if (S.products.some((p) => p.categoryId === c.id)) throw dErr(400, 'Cette catégorie contient encore des articles.');
      S.categories.splice(S.categories.indexOf(c), 1);
    } else {
      if (!String(body.name || '').trim()) throw dErr(400, 'Nom obligatoire.');
      c.name = body.name.trim(); c.sort = Number(body.sort) || 0;
    }
    return done({ ok: true });
  }

  // Articles
  if (route === '/admin/products' && method === 'GET') {
    const t = dTokens(query.get('q'));
    const cat = Number(query.get('category')) || null;
    const list = S.products.filter((p) => (!cat || p.categoryId === cat) && (!t.length || t.every((x) => dProductText(p).includes(x))))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')).slice(0, 300);
    return { products: list.map((p) => ({ id: p.id, ref: p.ref, code: p.code, name: p.name, active: p.active !== false ? 1 : 0,
      categoryId: p.categoryId, category: dCat(p.categoryId), priceCents: p.units.length ? p.units[0].priceCents : null })) };
  }
  if (route === '/admin/products' && method === 'POST' || (m = route.match(/^\/admin\/products\/(\d+)$/))) {
    const p = m ? dFind(S.products, m[1], 'Article') : { id: dNext(S.products), units: [], specs: [] };
    if (method === 'GET') return { product: { ...p, active: p.active !== false } };
    const ref = String(body.ref || '').trim();
    const name = String(body.name || '').trim();
    if (!ref || !name) throw dErr(400, 'Référence et nom sont obligatoires.');
    if (S.products.some((x) => x.id !== p.id && x.ref.toLowerCase() === ref.toLowerCase())) throw dErr(400, `La référence ${ref} existe déjà.`);
    dSaveUnits(p, body.units);
    Object.assign(p, { ref, name, code: String(body.code || '').trim(), categoryId: body.categoryId ? Number(body.categoryId) : null,
      description: String(body.description || ''), specs: body.specs || [], imageUrl: String(body.imageUrl || ''), active: body.active !== false });
    if (!m) S.products.push(p);
    return done({ product: p });
  }

  // Clients
  if (route === '/clients' && method === 'GET') {
    const t = dTokens(query.get('q'));
    return { clients: S.clients.filter((c) => t.every((x) => dClientText(c).includes(x))).sort((a, b) => a.name.localeCompare(b.name, 'fr')) };
  }
  if (route === '/clients' && method === 'POST' || (m = route.match(/^\/clients\/(\d+)$/))) {
    const c = m ? dFind(S.clients, m[1], 'Client') : { id: dNext(S.clients), discounts: [] };
    const label = (d) => (d.kind === 'category' ? dCat(d.targetId) : (() => { const p = S.products.find((x) => x.id === d.targetId); return p ? `${p.ref} — ${p.name}` : ''; })());
    if (method === 'GET') return { client: c, discounts: (c.discounts || []).map((d) => ({ ...d, label: label(d) })) };
    if (!String(body.name || '').trim()) throw dErr(400, 'Le nom du client est obligatoire.');
    const discounts = [];
    for (const d of body.discounts || []) {
      let targetId = Number(d.targetId) || null;
      if (d.kind !== 'category') {
        const p = S.products.find((x) => x.ref.toLowerCase() === String(d.ref || '').toLowerCase());
        if (!p) throw dErr(400, `Référence article inconnue : ${d.ref}`);
        targetId = p.id;
      }
      if (targetId) discounts.push({ kind: d.kind === 'category' ? 'category' : 'product', targetId, pct: Number(d.pct) || 0 });
    }
    const blank = Object.fromEntries(Object.keys(S.clients[0]).filter((k) => typeof S.clients[0][k] === 'string').map((k) => [k, '']));
    Object.assign(c, m ? {} : blank, body, { id: c.id, discounts, discountPct: Number(body.discountPct) || 0,
      francoCents: body.francoCents ?? null, delegateId: body.delegateId ? Number(body.delegateId) : null, active: body.active !== false });
    c.number ||= 'C' + String(c.id).padStart(5, '0');
    if (!m) S.clients.push(c);
    return done({ client: c });
  }

  // Implantations
  if (route === '/admin/implantations' && method === 'GET') {
    return { implantations: [...S.implantations].sort((a, b) => a.meters - b.meters || a.name.localeCompare(b.name, 'fr'))
      .map((x) => ({ id: x.id, name: x.name, meters: x.meters, active: x.active !== false, count: x.items.length })) };
  }
  if (route === '/admin/implantations' && method === 'POST' || (m = route.match(/^\/admin\/implantations\/(\d+)$/))) {
    if (method === 'DELETE') { S.implantations = S.implantations.filter((x) => x.id !== Number(m[1])); return done({ ok: true }); }
    const x = m ? dFind(S.implantations, m[1], 'Implantation') : { id: dNext(S.implantations), items: [] };
    if (method === 'GET') {
      return { implantation: { id: x.id, name: x.name, meters: x.meters, active: x.active !== false, items: x.items.map((i) => {
        const p = S.products.find((e) => e.id === i.productId);
        return { ref: p?.ref || '', name: p?.name || '', unit: i.unit, qty: i.qty };
      }) } };
    }
    const len = Math.round(Number(body.meters) * 100) / 100;
    if (!String(body.name || '').trim()) throw dErr(400, 'Nom obligatoire.');
    if (!(len > 0)) throw dErr(400, 'Longueur en mètres invalide.');
    const items = [];
    const unknown = [];
    for (const it of body.items || []) {
      const key = String(it.ref).toLowerCase();
      const p = S.products.find((e) => e.ref.toLowerCase() === key) || S.products.find((e) => e.code && e.code === it.ref);
      if (!p) unknown.push(it.ref);
      else items.push({ productId: p.id, unit: D_UNITS[it.unit] ? it.unit : 'piece', qty: Math.max(1, Math.floor(Number(it.qty)) || 1) });
    }
    if (unknown.length) throw dErr(400, `Référence(s) inconnue(s) : ${unknown.slice(0, 10).join(', ')}`);
    Object.assign(x, { name: body.name.trim(), meters: len, active: body.active !== false, items });
    if (!m) S.implantations.push(x);
    return done({ id: x.id });
  }

  // Promos
  if (route === '/admin/promos' && method === 'GET') return { promos: [...S.promos].sort((a, b) => b.id - a.id).map(dPromoOut) };
  if (route === '/admin/promos' && method === 'POST' || (m = route.match(/^\/admin\/promos\/(\d+)$/))) {
    if (method === 'DELETE') { S.promos = S.promos.filter((x) => x.id !== Number(m[1])); return done({ ok: true }); }
    const x = m ? dFind(S.promos, m[1], 'Promo') : { id: dNext(S.promos) };
    const p = S.products.find((e) => e.ref.toLowerCase() === String(body.ref || '').toLowerCase());
    if (!String(body.title || '').trim()) throw dErr(400, 'Titre obligatoire.');
    if (!p) throw dErr(400, `Référence article inconnue : ${body.ref}`);
    Object.assign(x, { title: body.title.trim(), description: String(body.description || ''), productId: p.id,
      minQty: Math.max(1, Math.floor(Number(body.minQty)) || 1), discountPct: Number(body.discountPct) || 0,
      startsOn: body.startsOn || '', endsOn: body.endsOn || '', active: body.active !== false });
    if (!m) S.promos.push(x);
    return done({ id: x.id });
  }

  // Identifiants
  if (route === '/admin/users' && method === 'GET') return { users: [...S.users].sort((a, b) => a.username.localeCompare(b.username)) };
  if (route === '/admin/users' && method === 'POST') {
    const username = String(body.username || '').trim();
    if (!username) throw dErr(400, "Nom d'utilisateur obligatoire.");
    if (S.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw dErr(400, "Ce nom d'utilisateur existe déjà.");
    if (String(body.password || '').length < 8) throw dErr(400, 'Le mot de passe doit contenir au moins 8 caractères.');
    S.users.push({ id: dNext(S.users), username, name: String(body.name || ''), role: body.role === 'admin' ? 'admin' : 'delegue', active: true });
    return done({ ok: true });
  }
  if ((m = route.match(/^\/admin\/users\/(\d+)$/))) {
    const u = dFind(S.users, m[1], 'Utilisateur');
    if (method === 'DELETE') {
      if (u.id === 1) throw dErr(400, 'Vous ne pouvez pas supprimer votre propre compte.');
      S.users.splice(S.users.indexOf(u), 1);
      for (const c of S.clients) if (c.delegateId === u.id) c.delegateId = null;
      return done({ ok: true });
    }
    if (body.password && body.password.length < 8) throw dErr(400, 'Le mot de passe doit contenir au moins 8 caractères.');
    if (u.id === 1 && (body.role !== 'admin' || body.active === false)) throw dErr(400, 'Vous ne pouvez pas retirer vos propres droits administrateur.');
    Object.assign(u, { name: String(body.name ?? u.name), role: body.role === 'admin' ? 'admin' : 'delegue', active: body.active !== false });
    return done({ ok: true });
  }

  // Paramètres
  if (route === '/admin/settings') {
    if (method === 'PUT') {
      for (const [k, v] of Object.entries(body)) S.settings[k] = k === 'franco_blocking' ? (v ? '1' : '0') : String(v);
      dSave();
    }
    return { settings: S.settings };
  }

  // Imports Excel / CSV
  if (route === '/admin/products/import' || route === '/admin/clients/import') {
    const rows = await dRows(body);
    return done(route.includes('products') ? dImportProducts(rows) : dImportClients(rows));
  }
  throw dErr(404, 'Introuvable.');
}

// ---------- Fichiers : bibliothèques chargées à la demande ----------
const dScripts = {};
function dScript(src, global) {
  dScripts[src] ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(window[global]);
    s.onerror = () => reject(dErr(500, 'Bibliothèque indisponible dans cette vue.'));
    document.head.append(s);
  });
  return dScripts[src];
}
const dHeader = (h) => dNorm(h).trim().replace(/[\s-]+/g, '_');
const dCell = (v) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10)
  : typeof v === 'object' ? (v.richText ? v.richText.map((t) => t.text).join('') : v.result !== undefined ? dCell(v.result) : v.text !== undefined ? dCell(v.text) : '')
  : String(v));
async function dRows(body) {
  let table;
  if (body.xlsx) {
    const ExcelJS = await dScript('exceljs.min.js', 'ExcelJS');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(Uint8Array.from(atob(body.xlsx), (c) => c.charCodeAt(0)).buffer);
    } catch {
      throw dErr(400, 'Fichier Excel illisible. Enregistrez-le au format .xlsx.');
    }
    table = [];
    wb.worksheets[0]?.eachRow((row) => {
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => (cells[col - 1] = dCell(cell.value).trim()));
      table.push(cells);
    });
  } else {
    const text = String(body.csv || '').replace(/^﻿/, '');
    const sep = (text.split('\n')[0].match(/;/g) || []).length >= (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    table = text.split(/\r?\n/).map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '')));
  }
  table = table.filter((r) => r.some(Boolean));
  const head = (table.shift() || []).map(dHeader);
  if (!table.length) throw dErr(400, 'Fichier vide ou illisible.');
  return table.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] || ''])));
}
const dNum = (v) => Number(String(v).replace(/[^0-9,.-]/g, '').replace(',', '.'));
function dImportProducts(rows) {
  let created = 0, updated = 0, noPrice = 0;
  const errors = [];
  const touched = new Set();
  rows.forEach((r, i) => {
    const ref = (r.ref || r.reference || '').trim();
    if (!ref) return errors.push(`Ligne ${i + 2} : référence manquante.`);
    const unit = { '': 'piece', piece: 'piece', boite: 'boite', carton: 'carton', palette: 'palette' }[dNorm(r.unite).replace(/s$/, '')];
    if (!unit) return errors.push(`Ligne ${i + 2} : unité inconnue « ${r.unite} ».`);
    let p = dState.products.find((x) => x.ref.toLowerCase() === ref.toLowerCase());
    if (!p) {
      if (!r.nom) return errors.push(`Ligne ${i + 2} : nom manquant pour le nouvel article ${ref}.`);
      p = { id: dNext(dState.products), ref, code: r.code || '', name: r.nom, categoryId: null, description: r.description || '', specs: [], imageUrl: '', units: [], active: true };
      dState.products.push(p);
      created++;
    } else if (!touched.has(p.id)) {
      if (r.nom) p.name = r.nom;
      updated++;
    }
    touched.add(p.id);
    if (r.categorie) {
      let c = dState.categories.find((x) => x.name.toLowerCase() === r.categorie.toLowerCase());
      if (!c) dState.categories.push((c = { id: dNext(dState.categories), name: r.categorie, sort: 0 }));
      p.categoryId = c.id;
    }
    if (r.prix === '' || r.prix === undefined) return void noPrice++;
    const price = dNum(r.prix);
    if (!Number.isFinite(price) || price < 0) return errors.push(`Ligne ${i + 2} : prix invalide pour ${ref}.`);
    const ean = (r.ean || '').trim();
    if (ean && dState.products.some((x) => x.units.some((u) => u.ean === ean && !(x.id === p.id && u.unit === unit)))) {
      return errors.push(`Ligne ${i + 2} : code-barres ${ean} déjà utilisé.`);
    }
    const u = { unit, qty: unit === 'piece' ? 1 : Math.max(1, Math.floor(Number(r.qte)) || 1), priceCents: Math.round(price * 100), ean };
    p.units = [...p.units.filter((x) => x.unit !== unit), u].sort((a, b) => a.qty - b.qty);
  });
  return { created, updated, noPrice, errors };
}
const D_CLIENT_COLS = [['numero', 'number'], ['nom', 'name'], ['tva', 'vat'], ['adresse_siege', 'hq_address'], ['cp_siege', 'hq_zip'],
  ['localite_siege', 'hq_city'], ['adresse_livraison', 'del_address'], ['cp_livraison', 'del_zip'], ['localite_livraison', 'del_city'],
  ['horaires', 'hours'], ['telephone', 'phone'], ['email', 'email'], ['responsable', 'manager_name'], ['tel_responsable', 'manager_phone'],
  ['contact_compta', 'accounting_name'], ['tel_compta', 'accounting_phone'], ['email_compta', 'accounting_email'], ['iban', 'iban'], ['remarques', 'notes']];
function dImportClients(rows) {
  let created = 0, updated = 0;
  const errors = [];
  rows.forEach((r, i) => {
    const data = Object.fromEntries(D_CLIENT_COLS.map(([h, f]) => [f, (r[h] || '').trim()]));
    const vat = data.vat.replace(/[^0-9a-z]/gi, '').toLowerCase();
    let c = (data.number && dState.clients.find((x) => x.number === data.number))
      || (vat && dState.clients.find((x) => x.vat.replace(/[^0-9a-z]/gi, '').toLowerCase() === vat));
    if (!c && !data.name) return errors.push(`Ligne ${i + 2} : nom du client manquant.`);
    if (c) { for (const [f, v] of Object.entries(data)) if (v !== '') c[f] = v; updated++; }
    else {
      c = { ...data, id: dNext(dState.clients), active: true, discountPct: 0, francoCents: null, delegateId: null, discounts: [] };
      c.number ||= 'C' + String(c.id).padStart(5, '0');
      dState.clients.push(c);
      created++;
    }
    if (r.remise !== undefined && r.remise !== '') c.discountPct = Math.min(100, Math.max(0, dNum(r.remise) || 0));
  });
  return { created, updated, errors };
}

async function dWorkbook(sheets) {
  const ExcelJS = await dScript('exceljs.min.js', 'ExcelJS');
  const wb = new ExcelJS.Workbook();
  for (const [name, headers, rows] of sheets) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = headers.map(([header, width, fmt]) => ({ header, width, style: fmt ? { numFmt: fmt } : {} }));
    ws.getRow(1).font = { bold: true };
    ws.addRows(rows);
  }
  return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const M = '#,##0.00';
const T = '@';
async function dExport(url) {
  const [route, qs] = url.replace(/^\/api/, '').split('?');
  const query = new URLSearchParams(qs || '');
  const S = await dReady();
  let m;
  if ((m = route.match(/^\/orders\/(\d+)\/pdf$/))) {
    const o = dFind(S.orders, m[1], 'Commande');
    const PDFDocument = await dScript('pdfkit.standalone.js', 'PDFDocument');
    const lines = o.lines.map((l) => ({ ref: l.ref, name: l.name, qty: l.qty, unit_qty: l.unitQty, unitLabel: l.unitLabel,
      net_cents: l.netCents, discount_pct: l.discountPct, promo: l.promo, total_cents: l.totalCents }));
    const doc = orderPdf({ number: o.number, created_at: o.createdAt, user_name: o.userName, status: o.status, note: o.note,
      total_cents: o.totalCents, vat_pct: o.vatPct, client: o.client }, lines, S.settings, null, PDFDocument);
    const chunks = [];
    return { filename: `${o.number}.pdf`, data: await new Promise((resolve) => {
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(new Blob(chunks, { type: 'application/pdf' })));
    }) };
  }
  if (route === '/admin/products/export') {
    const rows = [];
    for (const p of S.products.filter((x) => x.active !== false)) {
      const base = [p.ref, p.code, p.name, dCat(p.categoryId)];
      if (!p.units.length) rows.push([...base, 'piece', 1, null, '']);
      for (const u of p.units) rows.push([...base, u.unit, u.qty, u.priceCents / 100, u.ean]);
    }
    return { filename: 'articles.xlsx', data: await dWorkbook([['Articles',
      [['ref', 20, T], ['code', 10, T], ['nom', 55], ['categorie', 30], ['unite', 10], ['qte', 8], ['prix', 12, M], ['ean', 18, T]], rows]]) };
  }
  if (route === '/admin/clients/export') {
    return { filename: 'clients.xlsx', data: await dWorkbook([['Clients',
      [...D_CLIENT_COLS.map(([h]) => [h, 20, T]), ['remise', 9]],
      S.clients.map((c) => [...D_CLIENT_COLS.map(([, f]) => c[f] || ''), c.discountPct])]]) };
  }
  if (route === '/admin/orders/export') {
    const orders = dFilterOrders(query);
    const head = [];
    const lines = [];
    for (const o of orders) {
      const c = o.client;
      const del = c.del_address || c.del_city;
      const date = o.createdAt.slice(0, 16);
      head.push([o.number, date, D_STATUS[o.status], o.userName, c.name, c.number, c.vat, c.hq_address, c.hq_zip, c.hq_city,
        del ? c.del_address : c.hq_address, del ? c.del_zip : c.hq_zip, del ? c.del_city : c.hq_city, c.hours,
        o.totalCents / 100, o.vatPct, Math.round(o.totalCents * (1 + o.vatPct / 100)) / 100, o.note]);
      for (const l of o.lines) {
        lines.push([o.number, date, c.name, c.number, l.ref, S.products.find((p) => p.id === l.productId)?.code || '', l.name, l.qty, l.unitLabel,
          l.unitQty, l.qty * l.unitQty, l.baseCents / 100, l.discountPct, l.promo ? 'oui' : '', l.netCents / 100, l.totalCents / 100]);
      }
    }
    return { filename: orders.length === 1 && query.get('id') ? `${orders[0].number}.xlsx` : 'commandes.xlsx', data: await dWorkbook([
      ['Commandes', [['N° commande', 18], ['Date', 17], ['Statut', 15], ['Délégué', 18], ['Client', 30], ['N° client', 12, T], ['TVA', 18],
        ['Adresse siège', 28], ['CP', 8, T], ['Localité', 18], ['Adresse livraison', 28], ['CP livraison', 11, T], ['Localité livraison', 18],
        ['Horaires', 24], ['Total HT', 12, M], ['TVA %', 8], ['Total TTC', 12, M], ['Remarque', 40]], head],
      ['Lignes', [['N° commande', 18], ['Date', 17], ['Client', 30], ['N° client', 12, T], ['Référence', 20, T], ['Code article', 12, T],
        ['Désignation', 50], ['Quantité', 10], ['Unité', 10], ['Pièces / unité', 13], ['Total pièces', 12], ['Prix de base HT', 15, M],
        ['Remise %', 10], ['Promo', 8], ['Prix net HT', 13, M], ['Total HT', 13, M]], lines]]) };
  }
  throw dErr(404, 'Introuvable.');
}

window.__DEMO__ = {
  // Fabrique le fichier puis le propose à l'enregistrement.
  async download(url) {
    const file = await dExport(url);
    const downloads = await window.claude?.use?.('downloads');
    if (!downloads) throw dErr(400, `Le fichier ${file.filename} est prêt, mais cette vue ne permet pas de l'enregistrer.`);
    try {
      await downloads.save(file);
    } catch (e) {
      if (e?.code !== 'declined') throw dErr(400, `Enregistrement de ${file.filename} impossible dans cette vue.`);
    }
  },
};
