'use strict';
process.removeAllListeners('warning'); // masque l'avertissement « SQLite experimental » de Node
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { open, normalize, UNITS, UNIT_LABELS, STATUSES, STATUS_LABELS } = require('./db');
const createAuth = require('./auth');
const { hashPassword, publicUser } = createAuth;
const createPricing = require('./pricing');
const { orderPdf } = require('./pdf');
const { parseCsv } = require('./csv');

const ROOT = path.join(__dirname, '..');

const CLIENT_FIELDS = [
  'number', 'name', 'vat', 'hq_address', 'hq_zip', 'hq_city', 'del_address', 'del_zip', 'del_city',
  'hours', 'phone', 'email', 'manager_name', 'manager_phone', 'accounting_name', 'accounting_phone',
  'accounting_email', 'iban', 'notes',
];

const str = (v, max = 2000) => String(v ?? '').trim().slice(0, max);
const pct = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n * 100) / 100)) : 0;
};
const cents = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const likeTokens = (query) => normalize(query).split(/\s+/).filter(Boolean).slice(0, 8);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function createApp(store) {
  const { q, tx } = store;
  const auth = createAuth(store);
  const pricing = createPricing(store);
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; frame-ancestors 'none'"
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self)');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.use(express.json({ limit: '10mb' }));

  // --- Fichiers statiques : app mobile sur /, interface PC sur /admin ---
  const noCache = { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') };
  app.get('/vendor/zxing.min.js', (req, res) =>
    res.sendFile(path.join(ROOT, 'node_modules/@zxing/library/umd/index.min.js'), { maxAge: '30d' })
  );
  app.use('/shared', express.static(path.join(ROOT, 'public/shared'), noCache));
  app.use('/admin', express.static(path.join(ROOT, 'public/admin'), noCache));
  app.use('/', express.static(path.join(ROOT, 'public/app'), noCache));

  // --- API ---
  const api = express.Router();
  app.use('/api', api);
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    // Anti-CSRF : toute écriture doit porter un en-tête qu'un autre site ne peut pas envoyer.
    if (req.method !== 'GET' && req.get('X-Requested-With') !== 'app') {
      return res.status(403).json({ error: 'Requête refusée.' });
    }
    next();
  });

  api.post('/login', auth.login);
  api.post('/logout', auth.logout);
  api.get('/me', (req, res) => {
    const u = auth.currentUser(req);
    res.json({ user: u ? publicUser(u) : null });
  });

  const user = auth.requireUser;
  const admin = auth.requireAdmin;

  // ---------- Clients ----------
  const canSee = (u, c) => u.role === 'admin' || c.delegate_id == null || c.delegate_id === u.id;
  const publicClient = (c, u) => {
    const out = { id: c.id, active: !!c.active, discountPct: c.discount_pct, delegateId: c.delegate_id,
      francoCents: c.franco_cents, createdAt: c.created_at };
    for (const f of CLIENT_FIELDS) out[f] = c[f];
    return out;
  };
  function loadClient(req, id) {
    const c = q('SELECT * FROM clients WHERE id = ?').get(Number(id));
    if (!c || !canSee(req.user, c) || (!c.active && req.user.role !== 'admin')) {
      throw new HttpError(404, 'Client introuvable.');
    }
    return c;
  }

  api.get('/clients', user, (req, res) => {
    const where = [];
    const args = [];
    if (req.user.role !== 'admin') {
      where.push('active = 1 AND (delegate_id IS NULL OR delegate_id = ?)');
      args.push(req.user.id);
    }
    for (const t of likeTokens(req.query.q)) {
      where.push('search LIKE ?');
      args.push(`%${t}%`);
    }
    const rows = q(
      `SELECT * FROM clients ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY name COLLATE NOCASE LIMIT 500`
    ).all(...args);
    res.json({ clients: rows.map((c) => publicClient(c, req.user)) });
  });

  api.get('/clients/:id', user, (req, res) => {
    const c = loadClient(req, req.params.id);
    const out = { client: publicClient(c, req.user) };
    if (req.user.role === 'admin') {
      out.discounts = q(
        `SELECT d.kind, d.target_id AS targetId, d.pct,
           CASE d.kind WHEN 'product' THEN (SELECT ref || ' — ' || name FROM products WHERE id = d.target_id)
                       ELSE (SELECT name FROM categories WHERE id = d.target_id) END AS label
         FROM client_discounts d WHERE d.client_id = ? ORDER BY d.kind, label`
      ).all(c.id);
    }
    res.json(out);
  });

  function saveClient(req, existing) {
    const b = req.body || {};
    const isAdmin = req.user.role === 'admin';
    const data = {};
    for (const f of CLIENT_FIELDS) data[f] = b[f] !== undefined ? str(b[f]) : existing ? existing[f] : '';
    if (!data.name) throw new HttpError(400, 'Le nom du client est obligatoire.');
    // Remises, franco et attribution : uniquement depuis l'interface PC (administrateur).
    data.discount_pct = isAdmin && b.discountPct !== undefined ? pct(b.discountPct) : existing?.discount_pct ?? 0;
    data.franco_cents = isAdmin && b.francoCents !== undefined
      ? (b.francoCents === null || b.francoCents === '' ? null : cents(b.francoCents))
      : existing?.franco_cents ?? null;
    data.delegate_id = isAdmin && b.delegateId !== undefined
      ? (b.delegateId ? Number(b.delegateId) : null)
      : existing ? existing.delegate_id : (isAdmin ? null : req.user.id);
    data.active = isAdmin && b.active !== undefined ? (b.active ? 1 : 0) : existing?.active ?? 1;
    const cols = Object.keys(data);
    return tx(() => {
      let id;
      if (existing) {
        id = existing.id;
        q(`UPDATE clients SET ${cols.map((c) => c + ' = ?').join(', ')} WHERE id = ?`).run(
          ...cols.map((c) => data[c]), id
        );
      } else {
        id = q(`INSERT INTO clients(${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(
          ...cols.map((c) => data[c])
        ).lastInsertRowid;
        if (!data.number) q('UPDATE clients SET number = ? WHERE id = ?').run('C' + String(id).padStart(5, '0'), id);
      }
      if (isAdmin && Array.isArray(b.discounts)) {
        q('DELETE FROM client_discounts WHERE client_id = ?').run(id);
        for (const d of b.discounts) {
          const kind = d.kind === 'category' ? 'category' : 'product';
          let target = Number(d.targetId) || null;
          if (!target && kind === 'product' && d.ref) {
            target = q('SELECT id FROM products WHERE ref = ?').get(str(d.ref))?.id;
            if (!target) throw new HttpError(400, `Référence article inconnue : ${str(d.ref)}`);
          }
          if (!target) continue;
          q('INSERT OR REPLACE INTO client_discounts(client_id, kind, target_id, pct) VALUES (?, ?, ?, ?)').run(
            id, kind, target, pct(d.pct)
          );
        }
      }
      store.refreshClientSearch(id);
      return q('SELECT * FROM clients WHERE id = ?').get(id);
    });
  }

  api.post('/clients', user, (req, res) => {
    res.status(201).json({ client: publicClient(saveClient(req, null), req.user) });
  });
  api.put('/clients/:id', user, (req, res) => {
    res.json({ client: publicClient(saveClient(req, loadClient(req, req.params.id)), req.user) });
  });

  const optionalClient = (req) => (req.query.client ? loadClient(req, req.query.client) : null);

  // ---------- Catalogue ----------
  api.get('/categories', user, (req, res) => {
    res.json({
      categories: q(
        `SELECT c.id, c.name, c.sort,
           (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS count
         FROM categories c ORDER BY c.sort, c.name COLLATE NOCASE`
      ).all(),
    });
  });

  function listProducts(req, includeInactive) {
    const where = includeInactive ? [] : ['p.active = 1'];
    const args = [];
    if (req.query.category) {
      where.push('p.category_id = ?');
      args.push(Number(req.query.category));
    }
    for (const t of likeTokens(req.query.q)) {
      where.push('p.search LIKE ?');
      args.push(`%${t}%`);
    }
    return q(
      `SELECT p.id, p.ref, p.name, p.image_url AS imageUrl, p.active, p.category_id AS categoryId,
         c.name AS category,
         (SELECT price_cents FROM product_units u WHERE u.product_id = p.id
            ORDER BY CASE unit WHEN 'piece' THEN 0 ELSE 1 END, qty LIMIT 1) AS priceCents
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY p.name COLLATE NOCASE LIMIT 300`
    ).all(...args);
  }

  api.get('/products', user, (req, res) => res.json({ products: listProducts(req, false) }));

  api.get('/products/:id', user, (req, res) => {
    const p = pricing.productDetail(Number(req.params.id), optionalClient(req));
    if (!p) throw new HttpError(404, 'Article introuvable.');
    res.json({ product: p });
  });

  // Scan : code-barres d'un conditionnement, ou à défaut référence exacte.
  api.get('/scan/:code', user, (req, res) => {
    const code = str(req.params.code, 80);
    let unit = null;
    let row = q(
      `SELECT u.product_id AS id, u.unit FROM product_units u JOIN products p ON p.id = u.product_id
       WHERE u.ean = ? AND u.ean != '' AND p.active = 1`
    ).get(code);
    if (row) unit = row.unit;
    else row = q('SELECT id FROM products WHERE ref = ? AND active = 1').get(code);
    if (!row) throw new HttpError(404, `Aucun article pour le code ${code}.`);
    res.json({ product: pricing.productDetail(row.id, optionalClient(req)), unit });
  });

  api.get('/promos', user, (req, res) => {
    const d = new Date().toISOString().slice(0, 10);
    const rows = q(
      `SELECT pr.*, p.ref, p.name FROM promos pr JOIN products p ON p.id = pr.product_id
       WHERE pr.active = 1 AND p.active = 1 AND (pr.starts_on = '' OR pr.starts_on <= ?)
         AND (pr.ends_on = '' OR pr.ends_on >= ?) ORDER BY pr.id DESC`
    ).all(d, d);
    res.json({ promos: rows.map((r) => ({ ...pricing.publicPromo(r), ref: r.ref, productName: r.name })) });
  });

  // ---------- Panier / commandes ----------
  api.post('/quote', user, (req, res) => {
    const client = loadClient(req, req.body?.clientId);
    res.json(pricing.quote(client, req.body?.lines));
  });

  const publicOrder = (o) => ({
    id: o.id, number: o.number, status: o.status, statusLabel: STATUS_LABELS[o.status] || o.status,
    note: o.note, totalCents: o.total_cents, vatPct: o.vat_pct, createdAt: o.created_at,
    clientId: o.client_id, userName: o.user_name, client: JSON.parse(o.client_snapshot),
  });
  function loadOrder(req, id) {
    const o = q('SELECT * FROM orders WHERE id = ?').get(Number(id));
    if (!o || (req.user.role !== 'admin' && o.user_id !== req.user.id)) {
      throw new HttpError(404, 'Commande introuvable.');
    }
    return o;
  }
  const orderLines = (id) =>
    q('SELECT * FROM order_lines WHERE order_id = ? ORDER BY id').all(id)
      .map((l) => ({ ...l, unitLabel: UNIT_LABELS[l.unit] || l.unit }));

  api.post('/orders', user, (req, res) => {
    const client = loadClient(req, req.body?.clientId);
    if (!client.active) throw new HttpError(400, 'Ce client est désactivé.');
    const order = tx(() => {
      const quote = pricing.quote(client, req.body?.lines);
      if (!quote.lines.length) throw new HttpError(400, 'Le panier est vide.');
      if (!quote.canOrder) {
        throw new HttpError(400, `Franco non atteint : il manque ${(quote.missingCents / 100).toFixed(2)} € HT.`);
      }
      const snapshot = {};
      for (const f of CLIENT_FIELDS) snapshot[f] = client[f];
      const id = q(
        `INSERT INTO orders(client_id, user_id, note, total_cents, vat_pct, client_snapshot, user_name)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(client.id, req.user.id, str(req.body?.note), quote.totalCents,
        Number(store.settings().vat_pct) || 0, JSON.stringify(snapshot),
        req.user.name || req.user.username).lastInsertRowid;
      const number = `CMD-${new Date().getFullYear()}-${String(id).padStart(5, '0')}`;
      q('UPDATE orders SET number = ? WHERE id = ?').run(number, id);
      for (const l of quote.lines) {
        q(
          `INSERT INTO order_lines(order_id, product_id, ref, name, unit, unit_qty, qty, base_cents,
             discount_pct, promo, net_cents, total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(id, l.productId, l.ref, l.name, l.unit, l.unitQty, l.qty, l.baseCents, l.discountPct,
          l.promo ? 1 : 0, l.netCents, l.totalCents);
      }
      return q('SELECT * FROM orders WHERE id = ?').get(id);
    });
    res.status(201).json({ order: publicOrder(order) });
  });

  api.get('/orders', user, (req, res) => {
    const where = [];
    const args = [];
    if (req.user.role !== 'admin') {
      where.push('user_id = ?');
      args.push(req.user.id);
    }
    if (STATUSES.includes(req.query.status)) {
      where.push('status = ?');
      args.push(req.query.status);
    }
    if (req.query.client) {
      where.push('client_id = ?');
      args.push(Number(req.query.client));
    }
    for (const t of likeTokens(req.query.q)) {
      where.push('(lower(number) LIKE ? OR lower(client_snapshot) LIKE ? OR lower(user_name) LIKE ?)');
      args.push(`%${t}%`, `%${t}%`, `%${t}%`);
    }
    const rows = q(
      `SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`
    ).all(...args);
    res.json({ orders: rows.map(publicOrder) });
  });

  api.get('/orders/:id', user, (req, res) => {
    const o = loadOrder(req, req.params.id);
    res.json({
      order: publicOrder(o),
      lines: orderLines(o.id).map((l) => ({
        ref: l.ref, name: l.name, unit: l.unit, unitLabel: l.unitLabel, unitQty: l.unit_qty, qty: l.qty,
        baseCents: l.base_cents, discountPct: l.discount_pct, promo: !!l.promo, netCents: l.net_cents,
        totalCents: l.total_cents,
      })),
    });
  });

  api.get('/orders/:id/pdf', user, (req, res) => {
    const o = loadOrder(req, req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.dl ? 'attachment' : 'inline'}; filename="${o.number}.pdf"`);
    orderPdf({ ...o, client: JSON.parse(o.client_snapshot) }, orderLines(o.id), store.settings(), res);
  });

  api.get('/settings', user, (req, res) => {
    const s = store.settings();
    res.json({ francoCents: Number(s.franco_cents), francoBlocking: s.franco_blocking === '1', vatPct: Number(s.vat_pct) });
  });

  // ================= Administration (interface PC uniquement) =================
  const adm = express.Router();
  api.use('/admin', admin, adm);

  adm.patch('/orders/:id', (req, res) => {
    if (!STATUSES.includes(req.body?.status)) throw new HttpError(400, 'Statut invalide.');
    const r = q('UPDATE orders SET status = ? WHERE id = ?').run(req.body.status, Number(req.params.id));
    if (!r.changes) throw new HttpError(404, 'Commande introuvable.');
    res.json({ ok: true });
  });

  adm.get('/settings', (req, res) => res.json({ settings: store.settings() }));
  adm.put('/settings', (req, res) => {
    const b = req.body || {};
    const next = {};
    if (b.franco_cents !== undefined) next.franco_cents = String(cents(b.franco_cents));
    if (b.franco_blocking !== undefined) next.franco_blocking = b.franco_blocking ? '1' : '0';
    if (b.vat_pct !== undefined) next.vat_pct = String(pct(b.vat_pct));
    for (const k of ['company_name', 'company_address', 'company_vat', 'company_phone', 'company_email']) {
      if (b[k] !== undefined) next[k] = str(b[k]);
    }
    for (const [k, v] of Object.entries(next)) q('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)').run(k, v);
    res.json({ settings: store.settings() });
  });

  // Catégories
  adm.post('/categories', (req, res) => {
    const name = str(req.body?.name, 100);
    if (!name) throw new HttpError(400, 'Nom obligatoire.');
    const id = q('INSERT INTO categories(name, sort) VALUES (?, ?)').run(name, Number(req.body?.sort) || 0).lastInsertRowid;
    res.status(201).json({ id });
  });
  adm.put('/categories/:id', (req, res) => {
    const name = str(req.body?.name, 100);
    if (!name) throw new HttpError(400, 'Nom obligatoire.');
    const id = Number(req.params.id);
    q('UPDATE categories SET name = ?, sort = ? WHERE id = ?').run(name, Number(req.body?.sort) || 0, id);
    for (const p of q('SELECT id FROM products WHERE category_id = ?').all(id)) store.refreshProductSearch(p.id);
    res.json({ ok: true });
  });
  adm.delete('/categories/:id', (req, res) => {
    const id = Number(req.params.id);
    if (q('SELECT 1 AS x FROM products WHERE category_id = ? LIMIT 1').get(id)) {
      throw new HttpError(400, 'Cette catégorie contient encore des articles.');
    }
    q('DELETE FROM categories WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // Articles
  const adminProduct = (id) => {
    const p = q('SELECT * FROM products WHERE id = ?').get(id);
    if (!p) throw new HttpError(404, 'Article introuvable.');
    let specs = [];
    try { specs = JSON.parse(p.specs); } catch {}
    return {
      id: p.id, ref: p.ref, name: p.name, categoryId: p.category_id, description: p.description, specs,
      imageUrl: p.image_url, active: !!p.active,
      units: q('SELECT unit, qty, price_cents AS priceCents, ean FROM product_units WHERE product_id = ?').all(id),
    };
  };
  adm.get('/products', (req, res) => res.json({ products: listProducts(req, true) }));
  adm.get('/products/:id', (req, res) => res.json({ product: adminProduct(Number(req.params.id)) }));

  function writeUnits(productId, units) {
    q('DELETE FROM product_units WHERE product_id = ?').run(productId);
    for (const u of Array.isArray(units) ? units : []) {
      if (!UNITS.includes(u.unit)) continue;
      const ean = str(u.ean, 40);
      if (ean) {
        const clash = q(
          `SELECT p.ref FROM product_units x JOIN products p ON p.id = x.product_id WHERE x.ean = ? AND x.product_id != ?`
        ).get(ean, productId);
        if (clash) throw new HttpError(400, `Le code-barres ${ean} est déjà utilisé par l'article ${clash.ref}.`);
      }
      q('INSERT INTO product_units(product_id, unit, qty, price_cents, ean) VALUES (?, ?, ?, ?, ?)').run(
        productId, u.unit, u.unit === 'piece' ? 1 : Math.max(1, Math.floor(Number(u.qty)) || 1), cents(u.priceCents), ean
      );
    }
  }
  function saveProduct(req, id) {
    const b = req.body || {};
    const ref = str(b.ref, 60);
    const name = str(b.name, 200);
    if (!ref || !name) throw new HttpError(400, 'Référence et nom sont obligatoires.');
    const dup = q('SELECT id FROM products WHERE ref = ?').get(ref);
    if (dup && dup.id !== id) throw new HttpError(400, `La référence ${ref} existe déjà.`);
    const specs = (Array.isArray(b.specs) ? b.specs : [])
      .map((s) => [str(s?.[0], 100), str(s?.[1], 300)]).filter((s) => s[0] && s[1]);
    const vals = [ref, name, b.categoryId ? Number(b.categoryId) : null, str(b.description, 5000),
      JSON.stringify(specs), /^https:\/\//.test(str(b.imageUrl)) ? str(b.imageUrl) : '', b.active === false ? 0 : 1];
    return tx(() => {
      if (id) {
        q(`UPDATE products SET ref = ?, name = ?, category_id = ?, description = ?, specs = ?, image_url = ?, active = ? WHERE id = ?`)
          .run(...vals, id);
      } else {
        id = q(`INSERT INTO products(ref, name, category_id, description, specs, image_url, active) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(...vals).lastInsertRowid;
      }
      writeUnits(id, b.units);
      store.refreshProductSearch(id);
      return adminProduct(id);
    });
  }
  adm.post('/products', (req, res) => res.status(201).json({ product: saveProduct(req, null) }));
  adm.put('/products/:id', (req, res) => {
    adminProduct(Number(req.params.id));
    res.json({ product: saveProduct(req, Number(req.params.id)) });
  });

  // Import CSV : une ligne par (article, conditionnement).
  adm.post('/products/import', (req, res) => {
    const rows = parseCsv(String(req.body?.csv || ''));
    if (!rows.length) throw new HttpError(400, 'Fichier vide ou illisible.');
    const col = (r, ...names) => {
      for (const n of names) if (r[n] !== undefined && r[n] !== '') return r[n];
      return '';
    };
    const unitOf = (v) => {
      const n = normalize(v).replace(/s$/, '');
      return { '': 'piece', piece: 'piece', pc: 'piece', pce: 'piece', boite: 'boite', carton: 'carton', palette: 'palette' }[n];
    };
    const result = tx(() => {
      let created = 0, updated = 0;
      const errors = [];
      const touched = new Set();
      rows.forEach((r, i) => {
        const line = i + 2;
        const ref = str(col(r, 'ref', 'reference', 'code'), 60);
        if (!ref) return errors.push(`Ligne ${line} : référence manquante.`);
        const unit = unitOf(col(r, 'unite', 'conditionnement'));
        if (!unit) return errors.push(`Ligne ${line} : unité inconnue « ${col(r, 'unite', 'conditionnement')} ».`);
        let p = q('SELECT * FROM products WHERE ref = ?').get(ref);
        const name = str(col(r, 'nom', 'designation', 'libelle'), 200);
        const catName = str(col(r, 'categorie', 'famille'), 100);
        let catId = null;
        if (catName) {
          catId = q('SELECT id FROM categories WHERE name = ?').get(catName)?.id
            ?? q('INSERT INTO categories(name) VALUES (?)').run(catName).lastInsertRowid;
        }
        const specsTxt = col(r, 'caracteristiques', 'specs');
        const specs = specsTxt
          ? specsTxt.split('|').map((s) => s.split(/:(.*)/s).slice(0, 2).map((x) => (x || '').trim())).filter((s) => s[0] && s[1])
          : null;
        const desc = col(r, 'description');
        const img = col(r, 'image', 'image_url');
        if (!p) {
          if (!name) return errors.push(`Ligne ${line} : nom manquant pour le nouvel article ${ref}.`);
          const id = q('INSERT INTO products(ref, name, category_id, description, specs, image_url) VALUES (?, ?, ?, ?, ?, ?)')
            .run(ref, name, catId, str(desc, 5000), JSON.stringify(specs || []), /^https:\/\//.test(img) ? img : '').lastInsertRowid;
          p = { id };
          created++;
        } else if (!touched.has(p.id)) {
          q('UPDATE products SET name = ?, category_id = ?, description = ?, specs = ?, image_url = ? WHERE id = ?').run(
            name || p.name, catId ?? p.category_id, desc ? str(desc, 5000) : p.description,
            specs ? JSON.stringify(specs) : p.specs, /^https:\/\//.test(img) ? img : p.image_url, p.id
          );
          updated++;
        }
        touched.add(p.id);
        const priceTxt = col(r, 'prix', 'prix_ht', 'prix ht');
        const price = Number(String(priceTxt).replace(/[^0-9,.-]/g, '').replace(',', '.'));
        if (priceTxt === '' || !Number.isFinite(price) || price < 0) {
          return errors.push(`Ligne ${line} : prix invalide pour ${ref}.`);
        }
        const ean = str(col(r, 'ean', 'code_barres', 'code-barres', 'codebarre'), 40);
        if (ean) {
          const clash = q(
            `SELECT p.ref FROM product_units x JOIN products p ON p.id = x.product_id
             WHERE x.ean = ? AND NOT (x.product_id = ? AND x.unit = ?)`
          ).get(ean, p.id, unit);
          if (clash) return errors.push(`Ligne ${line} : code-barres ${ean} déjà utilisé (${clash.ref}).`);
        }
        const qty = unit === 'piece' ? 1 : Math.max(1, Math.floor(Number(col(r, 'qte', 'quantite', 'qte_par_unite'))) || 1);
        q(`INSERT INTO product_units(product_id, unit, qty, price_cents, ean) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(product_id, unit) DO UPDATE SET qty = excluded.qty, price_cents = excluded.price_cents, ean = excluded.ean`)
          .run(p.id, unit, qty, Math.round(price * 100), ean);
      });
      for (const id of touched) store.refreshProductSearch(id);
      return { created, updated, errors };
    });
    res.json(result);
  });

  // Promos
  adm.get('/promos', (req, res) => {
    const rows = q(
      `SELECT pr.*, p.ref, p.name FROM promos pr JOIN products p ON p.id = pr.product_id ORDER BY pr.id DESC`
    ).all();
    res.json({ promos: rows.map((r) => ({ ...pricing.publicPromo(r), ref: r.ref, productName: r.name })) });
  });
  function savePromo(req, id) {
    const b = req.body || {};
    const title = str(b.title, 200);
    const product = q('SELECT id FROM products WHERE ref = ?').get(str(b.ref));
    if (!title) throw new HttpError(400, 'Titre obligatoire.');
    if (!product) throw new HttpError(400, `Référence article inconnue : ${str(b.ref)}`);
    const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : '');
    const vals = [title, str(b.description), product.id, Math.max(1, Math.floor(Number(b.minQty)) || 1),
      pct(b.discountPct), date(b.startsOn), date(b.endsOn), b.active === false ? 0 : 1];
    if (id) {
      const r = q(`UPDATE promos SET title = ?, description = ?, product_id = ?, min_qty = ?, discount_pct = ?,
        starts_on = ?, ends_on = ?, active = ? WHERE id = ?`).run(...vals, id);
      if (!r.changes) throw new HttpError(404, 'Promo introuvable.');
      return id;
    }
    return q(`INSERT INTO promos(title, description, product_id, min_qty, discount_pct, starts_on, ends_on, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(...vals).lastInsertRowid;
  }
  adm.post('/promos', (req, res) => res.status(201).json({ id: savePromo(req, null) }));
  adm.put('/promos/:id', (req, res) => res.json({ id: savePromo(req, Number(req.params.id)) }));
  adm.delete('/promos/:id', (req, res) => {
    q('DELETE FROM promos WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // Utilisateurs
  adm.get('/users', (req, res) => res.json({ users: q('SELECT * FROM users ORDER BY username').all().map(publicUser) }));
  const checkPassword = (p) => {
    if (String(p || '').length < 8) throw new HttpError(400, 'Le mot de passe doit contenir au moins 8 caractères.');
    return hashPassword(p);
  };
  adm.post('/users', (req, res) => {
    const b = req.body || {};
    const username = str(b.username, 60);
    if (!username) throw new HttpError(400, "Nom d'utilisateur obligatoire.");
    if (q('SELECT 1 AS x FROM users WHERE username = ?').get(username)) throw new HttpError(400, "Ce nom d'utilisateur existe déjà.");
    const id = q('INSERT INTO users(username, name, password_hash, role) VALUES (?, ?, ?, ?)').run(
      username, str(b.name, 100), checkPassword(b.password), b.role === 'admin' ? 'admin' : 'delegue'
    ).lastInsertRowid;
    res.status(201).json({ id });
  });
  adm.put('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    const u = q('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) throw new HttpError(404, 'Utilisateur introuvable.');
    const b = req.body || {};
    const role = b.role === undefined ? u.role : b.role === 'admin' ? 'admin' : 'delegue';
    const active = b.active === undefined ? u.active : b.active ? 1 : 0;
    if (id === req.user.id && (role !== 'admin' || !active)) {
      throw new HttpError(400, 'Vous ne pouvez pas retirer vos propres droits administrateur.');
    }
    q('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?').run(
      b.name === undefined ? u.name : str(b.name, 100), role, active, id
    );
    if (b.password) {
      q('UPDATE users SET password_hash = ? WHERE id = ?').run(checkPassword(b.password), id);
      q('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    if (!active) q('DELETE FROM sessions WHERE user_id = ?').run(id);
    res.json({ ok: true });
  });

  api.use((req, res) => res.status(404).json({ error: 'Introuvable.' }));
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Erreur du serveur.' : err.message });
  });

  return app;
}

// Premier démarrage : crée le compte administrateur.
function ensureAdmin(store) {
  const { q } = store;
  if (q("SELECT 1 AS x FROM users WHERE role = 'admin' LIMIT 1").get()) return null;
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  q("INSERT INTO users(username, name, password_hash, role) VALUES (?, 'Administrateur', ?, 'admin')").run(
    username, hashPassword(password)
  );
  return { username, password, generated: !process.env.ADMIN_PASSWORD };
}

if (require.main === module) {
  const dataDir = process.env.DATA_DIR || path.join(ROOT, 'data');
  const store = open(path.join(dataDir, 'commandes.db'));
  const created = ensureAdmin(store);
  if (process.env.SEED_DEMO !== '0' && !store.q('SELECT 1 AS x FROM products LIMIT 1').get()) {
    require('./seed')(store);
    console.log('Données de démonstration chargées (articles, clients et promos fictifs).');
  }
  const port = Number(process.env.PORT) || 3000;
  createApp(store).listen(port, () => {
    console.log(`Serveur démarré : http://localhost:${port}  (interface PC : /admin)`);
    if (created) {
      console.log('──────────────────────────────────────────────');
      console.log(` Compte administrateur créé : ${created.username}`);
      if (created.generated) console.log(` Mot de passe (à noter, affiché une seule fois) : ${created.password}`);
      console.log('──────────────────────────────────────────────');
    }
  });
}

module.exports = { createApp, ensureAdmin };
