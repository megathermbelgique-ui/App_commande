'use strict';
process.removeAllListeners('warning');
const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { createApp, ensureAdmin } = require('../server/index');
const { hashPassword } = require('../server/auth');
const seed = require('../server/seed');

let base;
let server;
const jars = {};

async function call(who, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'app', ...(jars[who] ? { Cookie: jars[who] } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const cookie = res.headers.get('set-cookie');
  if (cookie) jars[who] = cookie.split(';')[0];
  const type = res.headers.get('content-type') || '';
  return { status: res.status, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}

test.before(async () => {
  process.env.ADMIN_PASSWORD = 'admin-password';
  const store = open(':memory:');
  ensureAdmin(store);
  seed(store);
  store.q("INSERT INTO users(username, name, password_hash, role) VALUES ('jean', 'Jean', ?, 'delegue')").run(hashPassword('jean-password'));
  store.q("INSERT INTO users(username, name, password_hash, role) VALUES ('lea', 'Léa', ?, 'delegue')").run(hashPassword('lea-password'));
  server = createApp(store).listen(0);
  base = `http://localhost:${server.address().port}/api`;
  assert.equal((await call('admin', 'POST', '/login', { username: 'admin', password: 'admin-password' })).status, 200);
  assert.equal((await call('jean', 'POST', '/login', { username: 'jean', password: 'jean-password' })).status, 200);
  assert.equal((await call('lea', 'POST', '/login', { username: 'lea', password: 'lea-password' })).status, 200);
});
test.after(() => server.close());

test('connexion refusée avec un mauvais mot de passe, API fermée sans session', async () => {
  assert.equal((await call('x', 'POST', '/login', { username: 'admin', password: 'nope' })).status, 401);
  assert.equal((await call('x', 'GET', '/products')).status, 401);
});

test('les écritures sans en-tête anti-CSRF sont refusées', async () => {
  const res = await fetch(base + '/logout', { method: 'POST', headers: { Cookie: jars.jean } });
  assert.equal(res.status, 403);
});

test('recherche catalogue par référence, nom et caractéristique (sans accents)', async () => {
  const names = async (q) => (await call('jean', 'GET', '/products?q=' + encodeURIComponent(q))).data.products.map((p) => p.ref);
  assert.deepEqual(await names('demo-003'), ['DEMO-003']);
  assert.deepEqual(await names('metre ruban'), ['DEMO-016']);
  assert.deepEqual(await names('sds-plus 2,6 j'), ['DEMO-022']);
});

test('scan : le code-barres donne l\'article et son conditionnement, au prix du client', async () => {
  const { data } = await call('jean', 'GET', '/scan/2000000001616?client=1');
  assert.equal(data.product.ref, 'DEMO-016');
  assert.equal(data.unit, 'boite');
  const piece = data.product.units.find((u) => u.unit === 'piece');
  assert.equal(piece.baseCents, 490);
  assert.equal(piece.netCents, 441); // remise client 10 %
  assert.equal((await call('jean', 'GET', '/scan/0000000000000?client=1')).status, 404);
});

test('devis : remise client, promo selon la quantité, franco', async () => {
  const { data } = await call('jean', 'POST', '/quote', {
    clientId: 1,
    lines: [{ productId: 16, unit: 'piece', qty: 9 }, { productId: 1, unit: 'piece', qty: 2 }],
  });
  assert.equal(data.lines[0].discountPct, 10);
  assert.equal(data.lines[0].promo, false);
  assert.equal(data.totalCents, 441 * 9 + 351 * 2);
  assert.equal(data.missingCents, 50000 - data.totalCents);
  assert.equal(data.canOrder, false);
  const promo = (await call('jean', 'POST', '/quote', { clientId: 1, lines: [{ productId: 16, unit: 'boite', qty: 1 }] })).data;
  assert.equal(promo.lines[0].promo, true); // 10 pièces → promo -20 %
  assert.equal(promo.lines[0].netCents, Math.round(4660 * 0.8));
});

test('commande : bloquée sous le franco, prix fixés par le serveur, PDF disponible', async () => {
  const low = await call('jean', 'POST', '/orders', { clientId: 1, lines: [{ productId: 1, unit: 'piece', qty: 1 }] });
  assert.equal(low.status, 400);
  const ok = await call('jean', 'POST', '/orders', {
    clientId: 1, note: 'Livrer le matin',
    lines: [{ productId: 22, unit: 'carton', qty: 2, netCents: 1, unitPrice: 1 }], // un prix envoyé par l'appareil est ignoré
  });
  assert.equal(ok.status, 201);
  assert.match(ok.data.order.number, /^CMD-\d{4}-\d{5}$/);
  assert.equal(ok.data.order.totalCents, Math.round(36828 * 0.9) * 2);
  const pdf = await call('jean', 'GET', `/orders/${ok.data.order.id}/pdf`);
  assert.equal(pdf.data.subarray(0, 5).toString(), '%PDF-');
  // un autre délégué ne voit pas cette commande
  assert.equal((await call('lea', 'GET', `/orders/${ok.data.order.id}`)).status, 404);
  assert.equal((await call('lea', 'GET', '/orders')).data.orders.length, 0);
  assert.equal((await call('admin', 'GET', '/orders')).data.orders.length, 1);
});

test('un délégué ne peut modifier ni prix, ni remises, ni statuts', async () => {
  assert.equal((await call('jean', 'PUT', '/admin/products/1', { ref: 'DEMO-001', name: 'x', units: [] })).status, 403);
  assert.equal((await call('jean', 'PATCH', '/admin/orders/1', { status: 'livree' })).status, 403);
  assert.equal((await call('jean', 'PUT', '/admin/settings', { franco_cents: 0 })).status, 403);
  const edited = await call('jean', 'PUT', '/clients/1', { name: 'Quincaillerie Démo SPRL', discountPct: 90, phone: '04 111 11 11' });
  assert.equal(edited.data.client.discountPct, 10); // remise inchangée
  assert.equal(edited.data.client.phone, '04 111 11 11');
});

test('administrateur : prix, remise par catégorie et statut de commande', async () => {
  const p = (await call('admin', 'GET', '/admin/products/1')).data.product;
  p.units.find((u) => u.unit === 'piece').priceCents = 500;
  assert.equal((await call('admin', 'PUT', '/admin/products/1', p)).status, 200);
  await call('admin', 'PUT', '/clients/1', { name: 'Quincaillerie Démo SPRL', discounts: [{ kind: 'category', targetId: p.categoryId, pct: 30 }] });
  const q = (await call('jean', 'POST', '/quote', { clientId: 1, lines: [{ productId: 1, unit: 'piece', qty: 1 }] })).data;
  assert.equal(q.lines[0].netCents, 350);
  assert.equal((await call('admin', 'PATCH', '/admin/orders/1', { status: 'expediee' })).status, 200);
  assert.equal((await call('jean', 'GET', '/orders/1')).data.order.statusLabel, 'Expédiée');
});

test('clients : création par un délégué, visible par lui seul et par l\'administrateur', async () => {
  const made = await call('jean', 'POST', '/clients', { name: 'Nouveau Magasin', vat: 'BE 0999.999.922', hq_city: 'Huy' });
  assert.equal(made.status, 201);
  assert.match(made.data.client.number, /^C\d{5}$/);
  const find = async (who) => (await call(who, 'GET', '/clients?q=0999999922')).data.clients.length;
  assert.equal(await find('jean'), 1);
  assert.equal(await find('lea'), 0);
  assert.equal(await find('admin'), 1);
});

test('import CSV : crée et met à jour articles et conditionnements', async () => {
  const csv = 'ref;nom;categorie;unite;qte;prix;ean;caracteristiques\n' +
    'NEW-1;Burin plat 250 mm;Burins;piece;1;"7,50";5200000000011;Longueur: 250 mm | Matière: Cr-V\n' +
    'NEW-1;;;carton;12;81;5200000000028;\n' +
    'DEMO-002;;;piece;1;4,80;;\n' +
    ';sans ref;;piece;1;1;;\n';
  const { data } = await call('admin', 'POST', '/admin/products/import', { csv });
  assert.equal(data.created, 1);
  assert.equal(data.updated, 1);
  assert.equal(data.errors.length, 1);
  const scan = (await call('jean', 'GET', '/scan/5200000000028')).data;
  assert.equal(scan.unit, 'carton');
  assert.equal(scan.product.units.find((u) => u.unit === 'carton').baseCents, 8100);
  assert.deepEqual(scan.product.specs[0], ['Longueur', '250 mm']);
  assert.equal((await call('jean', 'GET', '/products?q=demo-002')).data.products[0].priceCents, 480);
});

test('Excel : export des commandes, import des prix et des clients', async () => {
  const ExcelJS = require('exceljs');
  const load = async (path) => {
    const res = await call('admin', 'GET', path);
    assert.equal(res.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.data);
    return wb;
  };
  const orders = await load('/admin/orders/export');
  assert.equal(orders.getWorksheet('Commandes').getRow(2).getCell(1).value, 'CMD-' + new Date().getFullYear() + '-00001');
  assert.equal(orders.getWorksheet('Lignes').getRow(2).getCell(5).value, 'DEMO-022');
  assert.equal((await call('jean', 'GET', '/admin/orders/export')).status, 403);

  // Tarif : on reprend l'export, on change un prix, on ajoute un code-barres, on réimporte.
  const articles = await load('/admin/products/export');
  const ws = articles.getWorksheet('Articles');
  let row;
  ws.eachRow((r) => { if (r.getCell(1).value === 'DEMO-003' && r.getCell(5).value === 'piece') row = r; });
  row.getCell(7).value = 5.25;
  row.getCell(8).value = 5200000000998; // saisi comme un nombre dans Excel
  const xlsx = Buffer.from(await articles.xlsx.writeBuffer()).toString('base64');
  const imp = await call('admin', 'POST', '/admin/products/import', { xlsx });
  assert.equal(imp.status, 200);
  assert.deepEqual(imp.data.errors, []);
  const scan = (await call('jean', 'GET', '/scan/5200000000998')).data;
  assert.equal(scan.product.ref, 'DEMO-003');
  assert.equal(scan.product.units.find((u) => u.unit === 'piece').baseCents, 525);

  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Clients').addRows([
    ['Numéro', 'Nom', 'TVA', 'Localité siège', 'Remise'],
    ['', 'Import SA', 'BE 0888.888.888', 'Wavre', 12.5],
    ['C00002', '', '', 'Ixelles', ''],
  ]);
  const ci = await call('admin', 'POST', '/admin/clients/import', { xlsx: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64') });
  assert.deepEqual([ci.data.created, ci.data.updated, ci.data.errors.length], [1, 1, 0]);
  const found = (await call('admin', 'GET', '/clients?q=0888888888')).data.clients[0];
  assert.equal(found.discountPct, 12.5);
  assert.equal((await call('admin', 'GET', '/clients/2')).data.client.hq_city, 'Ixelles');
});

test('identifiants : suppression par un administrateur, commandes conservées', async () => {
  const users = (await call('admin', 'GET', '/admin/users')).data.users;
  const jean = users.find((u) => u.username === 'jean');
  const admin = users.find((u) => u.username === 'admin');
  assert.equal((await call('admin', 'DELETE', `/admin/users/${admin.id}`)).status, 400);
  assert.equal((await call('lea', 'DELETE', `/admin/users/${jean.id}`)).status, 403);
  assert.equal((await call('admin', 'DELETE', `/admin/users/${jean.id}`)).status, 200);
  assert.equal((await call('jean', 'GET', '/orders')).status, 401); // sa session est fermée
  assert.equal((await call('x', 'POST', '/login', { username: 'jean', password: 'jean-password' })).status, 401);
  const orders = (await call('admin', 'GET', '/orders')).data.orders;
  assert.equal(orders.length, 1);
  assert.equal(orders[0].userName, 'Jean');
});
