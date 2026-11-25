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
  // extraPct : remise supplémentaire d'implantation, appliquée en plus de la remise retenue.
  function priceUnit(product, unit, client, pieces, extraPct = 0) {
    const base = clientDiscount(client, product);
    let pct = base;
    let promo = false;
    for (const p of activePromos(product.id)) {
      if (pieces >= p.min_qty && p.discount_pct > pct) {
        pct = p.discount_pct;
        promo = true;
      }
    }
    const netCents = Math.round(unit.price_cents * (1 - pct / 100) * (1 - extraPct / 100));
    return { baseCents: unit.price_cents, discountPct: pct, promo, extraPct, netCents };
  }

  const UNIT_ORDER = "CASE unit WHEN 'piece' THEN 0 WHEN 'boite' THEN 1 WHEN 'carton' THEN 2 ELSE 3 END";
  const unitsOf = (productId) => q(`SELECT * FROM product_units WHERE product_id = ? ORDER BY qty, ${UNIT_ORDER}`).all(productId);
  const euros = (cents) => (cents / 100).toFixed(2).replace('.', ',') + ' €';
  const plural = (label, n) => (n > 1 ? label.toLowerCase() + 's' : label.toLowerCase());

  // Avantage d'un conditionnement par rapport au plus petit : « -5 % » si le pourcentage tombe rond,
  // sinon l'écart en euros par pièce.
  function saving(unit, ref) {
    if (!ref || unit.qty <= ref.qty || !ref.price_cents) return null;
    const perPiece = unit.price_cents / unit.qty;
    const refPiece = ref.price_cents / ref.qty;
    const pct = (1 - perPiece / refPiece) * 100;
    const diffCents = Math.round(refPiece - perPiece);
    if (pct < 0.05) return null;
    const round = Math.round(pct);
    const whole = Math.abs(pct - round) < 0.05;
    if (!whole && diffCents < 1) return null;
    return { pct: Math.round(pct * 100) / 100, perPieceCents: diffCents,
      label: whole ? `-${round} %` : `-${euros(diffCents)} par pièce` };
  }

  // Conseil au délégué : la quantité approche (ou atteint) un conditionnement plus avantageux.
  function packHint(units, unit, qty) {
    const pieces = qty * unit.qty;
    const perPiece = unit.price_cents / unit.qty;
    const next = units.find((u) => u.qty > unit.qty && u.price_cents / u.qty < perPiece - 0.0001);
    if (!next) return null;
    const nextLabel = (UNIT_LABELS[next.unit] || next.unit).toLowerCase();
    const adv = saving(next, unit);
    const gain = adv ? ` (${adv.label})` : '';
    if (pieces % next.qty === 0) {
      const n = pieces / next.qty;
      return { text: `Même quantité en ${n} ${plural(nextLabel, n)} : prix par ${nextLabel}${gain}.`,
        action: { unit: next.unit, qty: n, label: `Passer à ${n} ${plural(nextLabel, n)}` } };
    }
    if (pieces < next.qty && pieces >= next.qty * 0.7) {
      const missing = next.qty - pieces;
      return { text: `Ajoutez ${missing} pièce${missing > 1 ? 's' : ''} pour avoir le prix par ${nextLabel}${gain}.`,
        action: { unit: next.unit, qty: 1, label: `Passer à 1 ${nextLabel}` } };
    }
    return null;
  }

  function productDetail(productId, client) {
    const p = q(
      `SELECT p.*, c.name AS category FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id = ? AND p.active = 1`
    ).get(productId);
    if (!p) return null;
    const units = unitsOf(p.id);
    let specs = [];
    try {
      specs = JSON.parse(p.specs);
    } catch {}
    return {
      id: p.id,
      ref: p.ref,
      code: p.code,
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
        saving: saving(u, units[0]),
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

  // Encours du client : commandes non annulées et non payées, TVA comprise.
  function credit(client, newTotalCents = 0) {
    if (!client) return null;
    const vat = Number(store.settings().vat_pct) || 0;
    const row = q(
      `SELECT COALESCE(SUM(ROUND(total_cents * (1 + vat_pct / 100.0))), 0) AS due FROM orders
       WHERE client_id = ? AND status != 'annulee' AND paid_on = ''`
    ).get(client.id);
    const outstandingCents = Number(row.due) || 0;
    const orderCents = Math.round(newTotalCents * (1 + vat / 100));
    const limitCents = client.credit_limit_cents;
    let reason = '';
    if (client.on_hold) reason = 'Client en attente : aucune commande ne peut être passée. Contactez le bureau.';
    else if (limitCents != null && outstandingCents + orderCents > limitCents) {
      reason = `Limite de crédit dépassée : encours ${euros(outstandingCents)} + cette commande ${euros(orderCents)} TTC, `
        + `pour une limite de ${euros(limitCents)}.`;
    }
    return { limitCents, outstandingCents, orderCents, onHold: !!client.on_hold, blocked: !!reason, reason };
  }

  // lines: [{productId, unit, qty, implantationId?}]
  function quote(client, lines) {
    const clean = [];
    const pieces = new Map();
    const plans = new Map();
    const plan = (id) => {
      if (!id) return null;
      if (!plans.has(id)) {
        const m = q('SELECT * FROM implantations WHERE id = ? AND active = 1').get(id);
        plans.set(id, m ? { ...m, products: new Set(
          q('SELECT product_id FROM implantation_items WHERE implantation_id = ?').all(id).map((r) => r.product_id)) } : null);
      }
      return plans.get(id);
    };
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
      clean.push({ product, unit, qty, plan: plan(Number(l.implantationId) || 0) });
      pieces.set(product.id, (pieces.get(product.id) || 0) + qty * unit.qty);
    }
    let totalCents = 0;
    const out = clean.map(({ product, unit, qty, plan: m }) => {
      // La remise d'implantation ne vaut que pour les articles prévus par le modèle.
      const extra = m && m.products.has(product.id) ? m.extra_pct : 0;
      const pr = priceUnit(product, unit, client, pieces.get(product.id), extra);
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
        implantationId: m ? m.id : null,
        implantationName: m ? `${m.name} — ${String(m.meters).replace('.', ',')} m` : '',
        hint: m ? null : packHint(unitsOf(product.id), unit, qty),
      };
    });
    const { francoCents, blocking } = francoFor(client);
    const missingCents = Math.max(0, francoCents - totalCents);
    const cr = credit(client, totalCents);
    return {
      lines: out,
      totalCents,
      francoCents,
      missingCents,
      francoBlocking: blocking,
      credit: cr,
      canOrder: out.length > 0 && (!blocking || missingCents === 0) && !(cr && cr.blocked),
    };
  }

  return { quote, productDetail, activePromos, publicPromo, clientDiscount, credit };
};
