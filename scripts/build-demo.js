'use strict';
// Construit la page de démonstration autonome (sans serveur) dans demo/dist :
//   node scripts/build-demo.js
process.removeAllListeners('warning');
const fs = require('node:fs');
const path = require('node:path');
const { open } = require('../server/db');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'demo', 'dist');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// Mêmes données que le serveur au premier démarrage.
const store = open(':memory:');
require('../server/catalog')(store);
require('../server/seed')(store);
const { q } = store;
const products = q('SELECT * FROM products WHERE active = 1 ORDER BY id').all().map((p) => ({
  id: p.id, ref: p.ref, code: p.code, name: p.name, categoryId: p.category_id, description: p.description,
  specs: JSON.parse(p.specs), imageUrl: p.image_url,
  units: q('SELECT unit, qty, price_cents AS priceCents, ean FROM product_units WHERE product_id = ? ORDER BY qty').all(p.id),
}));
const clients = q('SELECT * FROM clients ORDER BY id').all().map((c) => {
  const { search, created_at, discount_pct, franco_cents, delegate_id, active, ...rest } = c;
  return { ...rest, active: true, discountPct: discount_pct, francoCents: null, delegateId: null };
});
const promos = q('SELECT * FROM promos').all().map((p) => ({ id: p.id, title: p.title, description: p.description,
  productId: p.product_id, minQty: p.min_qty, discountPct: p.discount_pct, startsOn: p.starts_on, endsOn: p.ends_on, active: true }));
const implantations = q('SELECT * FROM implantations WHERE active = 1 ORDER BY meters, name').all().map((m) => ({
  id: m.id, name: m.name, meters: m.meters, active: true,
  items: q('SELECT product_id AS productId, unit, qty FROM implantation_items WHERE implantation_id = ? ORDER BY id').all(m.id),
}));
const priced = products.filter((p) => p.units.length);
const scans = [priced[15], priced[19], priced[0], priced[24], priced[4]].map((p) => {
  const u = p.units[Math.min(1, p.units.length - 1)];
  return { code: u.ean, label: `${p.name} (${{ piece: 'pièce', boite: 'boîte', carton: 'carton', palette: 'palette' }[u.unit]})` };
});

// Photos regroupées par paquets de 60.
const imageChunk = {};
const withImg = products.filter((p) => p.imageUrl).map((p) => p.imageUrl.split('/').pop());
const files = [...new Set(withImg)];
for (let i = 0, n = 0; i < files.length; i += 60, n++) {
  const pack = {};
  for (const f of files.slice(i, i + 60)) {
    pack[f] = fs.readFileSync(path.join(ROOT, 'catalog/img', f)).toString('base64');
    imageChunk[f] = n;
  }
  fs.writeFileSync(path.join(OUT, `img-${n}.json`), JSON.stringify(pack));
}
fs.writeFileSync(path.join(OUT, 'data.json'), JSON.stringify({
  categories: q('SELECT id, name, sort FROM categories ORDER BY sort, name').all(), products, clients, promos, scans, imageChunk, implantations,
}));

const strip = (src) => src.replace(/^import .*$/gm, '').replace(/^export /gm, '');
const js = [
  strip(read('public/shared/ui.js')).replace('async function api(', 'async function serverApi('),
  read('demo/demo-api.js'),
  strip(read('public/app/app.js')),
].join('\n');
const css = read('public/app/app.css') + `
/* Page de démonstration : les marges de sécurité sont gérées par la page hôte. */
:root { --safe-t: 0px; --safe-b: 0px; color-scheme: light; }
html { height: 100%; }
.pad { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
#top { padding-left: max(8px, env(safe-area-inset-left, 0px)); padding-right: max(8px, env(safe-area-inset-right, 0px)); }
`;
const html = `<title>Commandes Bormann Démo</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}</style>
<header id="top" hidden></header>
<main id="view"></main>
<div id="layer"></div>
<script>(() => {\n${js}\n})();</script>
`;
if (html.split('</script>').length !== 2) throw new Error('balise script fermante dans le code');
fs.writeFileSync(path.join(OUT, 'index.html'), html);

// ---------- Démonstration de l'interface PC (demo/dist-admin) ----------
const ADM = path.join(ROOT, 'demo', 'dist-admin');
fs.rmSync(ADM, { recursive: true, force: true });
fs.mkdirSync(ADM, { recursive: true });
const pricing = require('../server/pricing')(store);
const users = [
  { id: 1, username: 'admin', name: 'Administrateur', role: 'admin', active: true },
  { id: 2, username: 'jean', name: 'Jean Dupont', role: 'delegue', active: true },
  { id: 3, username: 'lea', name: 'Léa Martin', role: 'delegue', active: true },
];
const firstDemo = priced[0].id;
const sample = [
  [1, 2, 'recue', 0, [[19, 'carton', 2], [15, 'boite', 3], [0, 'carton', 1]], 'Livrer avant 10h.'],
  [2, 3, 'preparation', 1, [[21, 'carton', 1], [24, 'carton', 4], [4, 'boite', 5]], ''],
  [3, 2, 'expediee', 3, [[20, 'palette', 1]], 'Prévenir le magasin la veille.'],
  [1, 2, 'livree', 9, [[10, 'carton', 6], [18, 'carton', 2], [27, 'carton', 3]], ''],
  [4, 3, 'livree', 16, [[22, 'carton', 3], [16, 'boite', 10]], ''],
];
const orders = sample.map(([clientId, userId, status, daysAgo, items, note], i) => {
  const c = q('SELECT * FROM clients WHERE id = ?').get(clientId);
  const quote = pricing.quote(c, items.map(([n, unit, qty]) => ({ productId: firstDemo + n, unit, qty })));
  const id = sample.length - i;
  const when = new Date(Date.now() - daysAgo * 86400e3 - i * 3700e3);
  return {
    id, number: `CMD-${when.getFullYear()}-${String(id).padStart(5, '0')}`, status,
    statusLabel: { recue: 'Reçue', preparation: 'En préparation', expediee: 'Expédiée', livree: 'Livrée' }[status],
    note, totalCents: quote.totalCents, vatPct: 21, createdAt: when.toISOString().slice(0, 19).replace('T', ' '),
    clientId, userName: users.find((u) => u.id === userId).name, client: clients.find((x) => x.id === clientId), lines: quote.lines,
  };
});
fs.writeFileSync(path.join(ADM, 'data.json'), JSON.stringify({
  categories: q('SELECT id, name, sort FROM categories ORDER BY sort, name').all(),
  products: products.map((p) => ({ ...p, active: true })),
  clients: clients.map((c, i) => ({ ...c, delegateId: i < 2 ? 2 : null, discounts: [] })),
  promos, users, orders, implantations, settings: store.settings(),
}));
fs.copyFileSync(path.join(ROOT, 'node_modules/exceljs/dist/exceljs.min.js'), path.join(ADM, 'exceljs.min.js'));
fs.copyFileSync(path.join(ROOT, 'node_modules/pdfkit/js/pdfkit.standalone.js'), path.join(ADM, 'pdfkit.standalone.js'));
const pdfSrc = read('server/pdf.js').replace(/^'use strict';$/m, '').replace(/^const .*require\(.*$/gm, '').replace(/^module\.exports.*$/m, '');
const admJs = [
  strip(read('public/shared/ui.js')).replace('async function api(', 'async function serverApi('),
  strip(read('public/shared/ean.js')),
  read('demo/demo-admin-api.js'),
  `const orderPdf = (() => { const STATUS_LABELS = D_STATUS;\n${pdfSrc}\nreturn orderPdf; })();`,
  strip(read('public/admin/admin.js')),
].join('\n');
const admCss = read('public/admin/admin.css') + `
/* Page de démonstration */
:root { color-scheme: light; }
body { background: var(--bg); color: var(--ink); }
header.bar { top: env(safe-area-inset-top, 0px); flex-wrap: wrap; row-gap: 0;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
main { padding-inline: max(16px, env(safe-area-inset-left, 0px)) max(16px, env(safe-area-inset-right, 0px)); }
@media (max-width: 700px) { header.bar h1 { padding-top: 10px; } nav { flex-basis: 100%; order: 3; } .toolbar input, .toolbar select { min-width: 0; flex: 1 1 140px; } }
`;
const admHtml = `<title>Commandes Bormann PC Démo</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${admCss}</style>
<div id="root"></div>
<script>(() => {\n${admJs}\n})();</script>
`;
if (admHtml.split('</script>').length !== 2) throw new Error('balise script fermante dans le code (admin)');
fs.writeFileSync(path.join(ADM, 'index.html'), admHtml);
console.log('Interface PC : ' + fs.readdirSync(ADM).map((f) => `${f} ${(fs.statSync(path.join(ADM, f)).size / 1024).toFixed(0)} Ko`).join(', '));

const sizes = fs.readdirSync(OUT).map((f) => `${f} ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0)} Ko`);
console.log(`${products.length} articles, ${files.length} photos\n` + sizes.join('\n'));
