// Faux serveur pour la page de démonstration : mêmes réponses que l'API réelle,
// mais tout se passe dans le navigateur (données dans data.json + stockage local).
const demoNorm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const demoLoad = (k, d) => { try { return JSON.parse(localStorage.getItem('demo:' + k)) ?? d; } catch { return d; } };
const demoSave = (k, v) => { try { localStorage.setItem('demo:' + k, JSON.stringify(v)); } catch {} };
const demoErr = (status, message) => Object.assign(new Error(message), { status });
const DEMO_UNITS = { piece: 'Pièce', boite: 'Boîte', carton: 'Carton', palette: 'Palette' };
const DEMO_STATUS = { recue: 'Reçue', preparation: 'En préparation', expediee: 'Expédiée', livree: 'Livrée' };
const DEMO_FRANCO = 50000;
let demoData = null;
const demoMem = { user: demoLoad('user', null), clients: null, orders: demoLoad('orders', []) };

async function demoReady() {
  if (demoData) return demoData;
  const res = await fetch('data.json');
  if (!res.ok) throw demoErr(500, 'Données de démonstration introuvables.');
  const d = await res.json();
  d.byId = new Map(d.products.map((p) => [p.id, p]));
  for (const p of d.products) {
    p.search = demoNorm([p.ref, p.code, p.name, d.categories.find((c) => c.id === p.categoryId)?.name, p.description,
      ...p.specs.flat(), ...p.units.map((u) => u.ean)].join(' '));
  }
  demoMem.clients = demoLoad('clients', null) || d.clients;
  window.__DEMO__.scans = d.scans;
  return (demoData = d);
}

const demoPromos = (id) => demoData.promos.filter((p) => p.productId === id);
function demoPrice(p, u, client, pieces) {
  let pct = client ? client.discountPct || 0 : 0;
  let promo = false;
  for (const x of demoPromos(p.id)) if (pieces >= x.minQty && x.discountPct > pct) { pct = x.discountPct; promo = true; }
  return { baseCents: u.priceCents, discountPct: pct, promo, netCents: Math.round(u.priceCents * (1 - pct / 100)) };
}
function demoDetail(p, client) {
  return {
    id: p.id, ref: p.ref, code: p.code, name: p.name, categoryId: p.categoryId,
    category: demoData.categories.find((c) => c.id === p.categoryId)?.name || '', description: p.description,
    specs: p.specs, imageUrl: p.imageUrl, clientDiscountPct: client ? client.discountPct || 0 : 0,
    units: p.units.map((u) => ({ unit: u.unit, label: DEMO_UNITS[u.unit], qty: u.qty, ean: u.ean, ...demoPrice(p, u, client, u.qty) })),
    promos: demoPromos(p.id),
  };
}
function demoQuote(client, lines) {
  const clean = [];
  const pieces = new Map();
  for (const l of lines || []) {
    const p = demoData.byId.get(Number(l.productId));
    const u = p?.units.find((x) => x.unit === l.unit);
    const qty = Math.floor(Number(l.qty));
    if (!u || !(qty > 0)) continue;
    clean.push({ p, u, qty });
    pieces.set(p.id, (pieces.get(p.id) || 0) + qty * u.qty);
  }
  let totalCents = 0;
  const out = clean.map(({ p, u, qty }) => {
    const pr = demoPrice(p, u, client, pieces.get(p.id));
    totalCents += pr.netCents * qty;
    return { productId: p.id, ref: p.ref, name: p.name, unit: u.unit, unitLabel: DEMO_UNITS[u.unit], unitQty: u.qty, qty, ...pr, totalCents: pr.netCents * qty };
  });
  const missingCents = Math.max(0, DEMO_FRANCO - totalCents);
  return { lines: out, totalCents, francoCents: DEMO_FRANCO, missingCents, francoBlocking: true, canOrder: out.length > 0 && missingCents === 0 };
}
const demoTokens = (q) => demoNorm(q).split(/\s+/).filter(Boolean);
const demoClient = (id) => {
  const c = demoMem.clients.find((x) => x.id === Number(id));
  if (!c) throw demoErr(404, 'Client introuvable.');
  return c;
};

async function api(path, { method = 'GET', body } = {}) {
  await demoReady();
  const [route, qs] = path.split('?');
  const query = new URLSearchParams(qs || '');
  const client = query.get('client') ? demoClient(query.get('client')) : null;
  let m;
  if (route === '/me') return { user: demoMem.user };
  if (route === '/login') {
    const name = String(body.username || '').trim();
    if (!name || !body.password) throw demoErr(401, "Entrez un nom d'utilisateur et un mot de passe.");
    demoMem.user = { id: 1, username: name, name, role: 'delegue', active: true };
    demoSave('user', demoMem.user);
    return { user: demoMem.user };
  }
  if (route === '/logout') { demoMem.user = null; demoSave('user', null); return { ok: true }; }
  if (route === '/settings') return { francoCents: DEMO_FRANCO, francoBlocking: true, vatPct: 21 };
  if (route === '/categories') {
    return { categories: demoData.categories.map((c) => ({ ...c, count: demoData.products.filter((p) => p.categoryId === c.id).length })) };
  }
  if (route === '/products') {
    const t = demoTokens(query.get('q'));
    const cat = Number(query.get('category')) || null;
    const list = demoData.products.filter((p) => (!cat || p.categoryId === cat) && t.every((x) => p.search.includes(x)))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')).slice(0, 300);
    return { products: list.map((p) => ({ id: p.id, ref: p.ref, code: p.code, name: p.name, imageUrl: p.imageUrl, categoryId: p.categoryId,
      priceCents: p.units.length ? p.units[0].priceCents : null })) };
  }
  if ((m = route.match(/^\/products\/(\d+)$/))) {
    const p = demoData.byId.get(Number(m[1]));
    if (!p) throw demoErr(404, 'Article introuvable.');
    return { product: demoDetail(p, client) };
  }
  if ((m = route.match(/^\/scan\/(.+)$/))) {
    const code = decodeURIComponent(m[1]).trim();
    let unit = null;
    let p = demoData.products.find((x) => x.units.some((u) => u.ean && u.ean === code && (unit = u.unit)));
    p ||= demoData.products.find((x) => x.ref.toLowerCase() === code.toLowerCase() || (x.code && x.code === code));
    if (!p) throw demoErr(404, `Aucun article pour le code ${code}.`);
    return { product: demoDetail(p, client), unit };
  }
  if (route === '/promos') {
    return { promos: demoData.promos.map((x) => ({ ...x, ref: demoData.byId.get(x.productId).ref, productName: demoData.byId.get(x.productId).name })) };
  }
  if (route === '/clients' && method === 'GET') {
    const t = demoTokens(query.get('q'));
    const text = (c) => demoNorm([c.number, c.name, c.vat, c.vat.replace(/[^0-9a-z]/gi, ''), c.hq_city, c.hq_zip, c.manager_name, c.email].join(' '));
    return { clients: demoMem.clients.filter((c) => t.every((x) => text(c).includes(x))).sort((a, b) => a.name.localeCompare(b.name, 'fr')) };
  }
  if (route === '/clients' && method === 'POST') {
    if (!String(body.name || '').trim()) throw demoErr(400, 'Le nom du client est obligatoire.');
    const id = Math.max(0, ...demoMem.clients.map((c) => c.id)) + 1;
    const blank = Object.fromEntries(Object.keys(demoData.clients[0]).map((k) => [k, '']));
    const c = { ...blank, ...body, id, active: true, discountPct: 0, francoCents: null, delegateId: 1 };
    c.number ||= 'C' + String(id).padStart(5, '0');
    demoMem.clients.push(c);
    demoSave('clients', demoMem.clients);
    return { client: c };
  }
  if ((m = route.match(/^\/clients\/(\d+)$/))) {
    const c = demoClient(m[1]);
    if (method === 'PUT') {
      if (!String(body.name || '').trim()) throw demoErr(400, 'Le nom du client est obligatoire.');
      Object.assign(c, body, { id: c.id, discountPct: c.discountPct });
      demoSave('clients', demoMem.clients);
    }
    return { client: c };
  }
  if (route === '/quote') return demoQuote(demoClient(body.clientId), body.lines);
  if (route === '/orders' && method === 'POST') {
    const c = demoClient(body.clientId);
    const quote = demoQuote(c, body.lines);
    if (!quote.lines.length) throw demoErr(400, 'Le panier est vide.');
    if (!quote.canOrder) throw demoErr(400, 'Franco non atteint.');
    const id = demoMem.orders.length + 1;
    const order = { id, number: `CMD-${new Date().getFullYear()}-${String(id).padStart(5, '0')}`, status: 'recue', statusLabel: DEMO_STATUS.recue,
      note: String(body.note || ''), totalCents: quote.totalCents, vatPct: 21,
      createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '), clientId: c.id, userName: demoMem.user?.name || '', client: { ...c }, lines: quote.lines };
    demoMem.orders.unshift(order);
    demoSave('orders', demoMem.orders);
    return { order };
  }
  if (route === '/orders') return { orders: demoMem.orders };
  if ((m = route.match(/^\/orders\/(\d+)$/))) {
    const o = demoMem.orders.find((x) => x.id === Number(m[1]));
    if (!o) throw demoErr(404, 'Commande introuvable.');
    return { order: o, lines: o.lines };
  }
  throw demoErr(404, 'Introuvable.');
}

// Photos : chargées par paquets (img-N.json), à la demande.
const demoChunks = new Map();
window.__DEMO__ = { scans: [] };
window.__resolveImage = async (url) => {
  const file = String(url).split('/').pop();
  const n = (await demoReady()).imageChunk[file];
  if (n == null) return '';
  if (!demoChunks.has(n)) demoChunks.set(n, fetch(`img-${n}.json`).then((r) => r.json()).catch(() => ({})));
  const b64 = (await demoChunks.get(n))[file];
  return b64 ? 'data:image/jpeg;base64,' + b64 : '';
};
async function startScanner() {
  throw new Error('Caméra indisponible dans la démonstration.');
}
