'use strict';
// Calcul des prix : toujours côté serveur. L'application mobile n'envoie que
// (article, conditionnement, quantité) ; elle ne peut pas imposer un prix.
//
// Remise appliquée = la plus précise définie pour le client :
//   remise article  >  remise catégorie  >  remise générale du client
// Une promo en cours remplace cette remise si elle est plus avantageuse
// (les remises ne se cumulent pas).
const { UNIT_LABELS } = require('./db');

module.exports = function createPricing(store) {
  const { q } = store;

  const today = () => new Date().toISOString().slice(0, 10);

  function activePromos(productId) {
    const d = today();
    return q(
      `SELECT * FROM promos WHERE product_id = ? AND active = 1
       AND (starts_on = '' OR starts_on <= ?) AND (ends_on = '' OR ends_on >= ?)
       ORDER BY min_qty`
    ).all(productId, d, d);
  }

  function clientDiscount(client, product) {
    if (!client) return 0;
    const byProduct = q(
      `SELECT pct FROM client_discounts WHERE client_id = ? AND kind = 'product' AND target_id = ?`
    ).get(client.id, product.id);
    if (byProduct) return byProduct.pct;
    if (product.category_id != null) {
      const byCat = q(
        `SELECT pct FROM client_discounts WHERE client_id = ? AND kind = 'category' AND target_id = ?`
      ).get(client.id, product.category_id);
      if (byCat) return byCat.pct;
    }
    return client.discount_pct || 0;
  }

  // pieces = nombre total de pièces de cet article dans le panier (pour les promos)
  function priceUnit(product, unit, client, pieces) {
    const base = clientDiscount(client, product);
    let pct = base;
    let promo = false;
    for (const p of activePromos(product.id)) {
      if (pieces >= p.min_qty && p.discount_pct > pct) {
        pct = p.discount_pct;
        promo = true;
      }
    }
    const netCents = Math.round(unit.price_cents * (1 - pct / 100));
    return { baseCents: unit.price_cents, discountPct: pct, promo, netCents };
  }

  function productDetail(productId, client) {
    const p = q(
      `SELECT p.*, c.name AS category FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id = ? AND p.active = 1`
    ).get(productId);
    if (!p) return null;
    const order = "CASE unit WHEN 'piece' THEN 0 WHEN 'boite' THEN 1 WHEN 'carton' THEN 2 ELSE 3 END";
    const units = q(`SELECT * FROM product_units WHERE product_id = ? ORDER BY ${order}`).all(p.id);
    let specs = [];
    try {
      specs = JSON.parse(p.specs);
    } catch {}
    return {
      id: p.id,
      ref: p.ref,
      name: p.name,
      categoryId: p.category_id,
      category: p.category || '',
      description: p.description,
      specs,
      imageUrl: p.image_url,
      clientDiscountPct: client ? clientDiscount(client, p) : 0,
      units: units.map((u) => ({
        unit: u.unit,
        label: UNIT_LABELS[u.unit] || u.unit,
        qty: u.qty,
        ean: u.ean,
        ...priceUnit(p, u, client, u.qty),
      })),
      promos: activePromos(p.id).map(publicPromo),
    };
  }

  function publicPromo(p) {
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      productId: p.product_id,
      minQty: p.min_qty,
      discountPct: p.discount_pct,
      startsOn: p.starts_on,
      endsOn: p.ends_on,
      active: !!p.active,
    };
  }

  function francoFor(client) {
    const s = store.settings();
    const cents = client && client.franco_cents != null ? client.franco_cents : Number(s.franco_cents) || 0;
    return { francoCents: cents, blocking: s.franco_blocking === '1' };
  }

  // lines: [{productId, unit, qty}]
  function quote(client, lines) {
    const clean = [];
    const pieces = new Map();
    for (const l of Array.isArray(lines) ? lines : []) {
      const qty = Math.floor(Number(l.qty));
      if (!(qty > 0) || qty > 100000) continue;
      const product = q('SELECT * FROM products WHERE id = ? AND active = 1').get(Number(l.productId));
      if (!product) continue;
      const unit = q('SELECT * FROM product_units WHERE product_id = ? AND unit = ?').get(
        product.id,
        String(l.unit)
      );
      if (!unit) continue;
      clean.push({ product, unit, qty });
      pieces.set(product.id, (pieces.get(product.id) || 0) + qty * unit.qty);
    }
    let totalCents = 0;
    const out = clean.map(({ product, unit, qty }) => {
      const pr = priceUnit(product, unit, client, pieces.get(product.id));
      const lineTotal = pr.netCents * qty;
      totalCents += lineTotal;
      return {
        productId: product.id,
        ref: product.ref,
        name: product.name,
        unit: unit.unit,
        unitLabel: UNIT_LABELS[unit.unit] || unit.unit,
        unitQty: unit.qty,
        qty,
        ...pr,
        totalCents: lineTotal,
      };
    });
    const { francoCents, blocking } = francoFor(client);
    const missingCents = Math.max(0, francoCents - totalCents);
    return {
      lines: out,
      totalCents,
      francoCents,
      missingCents,
      francoBlocking: blocking,
      canOrder: out.length > 0 && (!blocking || missingCents === 0),
    };
  }

  return { quote, productDetail, activePromos, publicPromo, clientDiscount };
};
