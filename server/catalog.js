'use strict';
// Charge le catalogue Bormann Pro fourni avec l'application (catalog/bormann-pro.json),
// extrait de la brochure du fournisseur : références, codes, noms, fiches techniques, photos.
// La brochure ne donne ni prix ni codes-barres : les articles sont créés sans tarif.
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'catalog', 'bormann-pro.json');

module.exports = function loadCatalog(store) {
  if (!fs.existsSync(FILE)) return 0;
  const { categories, products } = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const { q, tx } = store;
  return tx(() => {
    const catIds = new Map();
    categories.forEach((name, i) => {
      catIds.set(name, q('INSERT INTO categories(name, sort) VALUES (?, ?)').run(name, i).lastInsertRowid);
    });
    for (const p of products) {
      const id = q(
        'INSERT INTO products(ref, code, name, category_id, description, specs, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(p.ref, p.code, p.name, catIds.get(p.category) ?? null, p.description || '',
        JSON.stringify(p.specs || []), p.image ? `/catalog/${p.image}` : '').lastInsertRowid;
      store.refreshProductSearch(id);
    }
    return products.length;
  });
};
