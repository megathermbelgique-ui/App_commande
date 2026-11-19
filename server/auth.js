'use strict';
const crypto = require('node:crypto');

const SESSION_DAYS = 180; // « se souvenir de moi » : pas de reconnexion pendant 6 mois
const COOKIE = 'sid';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setCookie(req, res, value, maxAgeSec) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${value}; HttpOnly; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax${secure}`
  );
}

module.exports = function createAuth(store) {
  const { q } = store;
  const failures = new Map(); // anti force brute : 8 essais / 15 min par IP + identifiant

  function login(req, res) {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const key = `${req.ip}|${username.toLowerCase()}`;
    const now = Date.now();
    const f = failures.get(key);
    if (f && f.until > now && f.count >= 8) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
    }
    const user = q('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      const cur = f && f.until > now ? f : { count: 0, until: now + 15 * 60e3 };
      cur.count++;
      failures.set(key, cur);
      return res.status(401).json({ error: "Nom d'utilisateur ou mot de passe incorrect." });
    }
    failures.delete(key);
    const token = crypto.randomBytes(32).toString('hex');
    const maxAge = SESSION_DAYS * 86400;
    q('DELETE FROM sessions WHERE expires_at < ?').run(now);
    q('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
      sha(token),
      user.id,
      now + maxAge * 1000
    );
    setCookie(req, res, token, maxAge);
    res.json({ user: publicUser(user) });
  }

  function logout(req, res) {
    const token = readCookie(req, COOKIE);
    if (token) q('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
    setCookie(req, res, '', 0);
    res.json({ ok: true });
  }

  function currentUser(req) {
    const token = readCookie(req, COOKIE);
    if (!token) return null;
    const row = q(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`
    ).get(sha(token), Date.now());
    return row || null;
  }

  function requireUser(req, res, next) {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ error: 'Connexion requise.' });
    req.user = user;
    next();
  }

  function requireAdmin(req, res, next) {
    requireUser(req, res, () => {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
      next();
    });
  }

  return { login, logout, currentUser, requireUser, requireAdmin };
};

function publicUser(u) {
  return { id: u.id, username: u.username, name: u.name, role: u.role, active: !!u.active };
}

module.exports.hashPassword = hashPassword;
module.exports.publicUser = publicUser;
