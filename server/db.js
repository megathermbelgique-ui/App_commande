'use strict';
// Base de données SQLite (module intégré à Node, aucun binaire à compiler).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const UNITS = ['piece', 'boite', 'carton', 'palette'];
const UNIT_LABELS = { piece: 'Pièce', boite: 'Boîte', carton: 'Carton', palette: 'Palette' };
const STATUSES = ['recue', 'preparation', 'expediee', 'livree', 'annulee'];
const STATUS_LABELS = {
  recue: 'Reçue',
  preparation: 'En préparation',
  expediee: 'Expédiée',
  livree: 'Livrée',
  annulee: 'Annulée',
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'delegue',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  specs TEXT NOT NULL DEFAULT '[]',
  image_url TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  search TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS product_units (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  price_cents INTEGER NOT NULL DEFAULT 0,
  ean TEXT NOT NULL DEFAULT '',
  UNIQUE(product_id, unit)
);
CREATE INDEX IF NOT EXISTS idx_units_ean ON product_units(ean);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  vat TEXT NOT NULL DEFAULT '',
  hq_address TEXT NOT NULL DEFAULT '',
  hq_zip TEXT NOT NULL DEFAULT '',
  hq_city TEXT NOT NULL DEFAULT '',
  del_address TEXT NOT NULL DEFAULT '',
  del_zip TEXT NOT NULL DEFAULT '',
  del_city TEXT NOT NULL DEFAULT '',
  hours TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  manager_name TEXT NOT NULL DEFAULT '',
  manager_phone TEXT NOT NULL DEFAULT '',
  accounting_name TEXT NOT NULL DEFAULT '',
  accounting_phone TEXT NOT NULL DEFAULT '',
  accounting_email TEXT NOT NULL DEFAULT '',
  iban TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  discount_pct REAL NOT NULL DEFAULT 0,
  franco_cents INTEGER,
  delegate_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  search TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS client_discounts (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- 'product' ou 'category'
  target_id INTEGER NOT NULL,
  pct REAL NOT NULL,
  UNIQUE(client_id, kind, target_id)
);
CREATE TABLE IF NOT EXISTS promos (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  min_qty INTEGER NOT NULL DEFAULT 1,   -- quantité minimum, en pièces
  discount_pct REAL NOT NULL,
  starts_on TEXT NOT NULL DEFAULT '',   -- AAAA-MM-JJ, vide = pas de limite
  ends_on TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL DEFAULT '',
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'recue',
  note TEXT NOT NULL DEFAULT '',
  total_cents INTEGER NOT NULL DEFAULT 0,
  vat_pct REAL NOT NULL DEFAULT 21,
  client_snapshot TEXT NOT NULL DEFAULT '{}',
  user_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  ref TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_qty INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  base_cents INTEGER NOT NULL,
  discount_pct REAL NOT NULL,
  promo INTEGER NOT NULL DEFAULT 0,
  net_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL
);
`;

const DEFAULT_SETTINGS = {
  franco_cents: '50000',
  franco_blocking: '1',
  vat_pct: '21',
  company_name: 'Ma société',
  company_address: '',
  company_vat: '',
  company_phone: '',
  company_email: '',
};

function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  const cache = new Map();
  const q = (sql) => {
    let st = cache.get(sql);
    if (!st) cache.set(sql, (st = db.prepare(sql)));
    return st;
  };
  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };

  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    q('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)').run(k, v);
  }

  const api = { db, q, tx };

  api.settings = () => {
    const out = {};
    for (const r of q('SELECT key, value FROM settings').all()) out[r.key] = r.value;
    return out;
  };

  api.refreshProductSearch = (id) => {
    const p = q(
      `SELECT p.*, c.name AS category FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`
    ).get(id);
    if (!p) return;
    const eans = q('SELECT ean FROM product_units WHERE product_id = ?').all(id).map((u) => u.ean);
    let specs = [];
    try {
      specs = JSON.parse(p.specs).flat();
    } catch {}
    const text = normalize([p.ref, p.name, p.category, p.description, ...specs, ...eans].join(' '));
    q('UPDATE products SET search = ? WHERE id = ?').run(text, id);
  };

  api.refreshClientSearch = (id) => {
    const c = q('SELECT * FROM clients WHERE id = ?').get(id);
    if (!c) return;
    const vatDigits = c.vat.replace(/[^0-9a-z]/gi, '');
    const text = normalize(
      [c.number, c.name, c.vat, vatDigits, c.hq_city, c.hq_zip, c.del_city, c.manager_name, c.email].join(' ')
    );
    q('UPDATE clients SET search = ? WHERE id = ?').run(text, id);
  };

  return api;
}

module.exports = { open, normalize, UNITS, UNIT_LABELS, STATUSES, STATUS_LABELS };
