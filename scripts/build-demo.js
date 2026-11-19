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
  categories: q('SELECT id, name, sort FROM categories ORDER BY sort, name').all(), products, clients, promos, scans, imageChunk,
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
const sizes = fs.readdirSync(OUT).map((f) => `${f} ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0)} Ko`);
console.log(`${products.length} articles, ${files.length} photos\n` + sizes.join('\n'));
