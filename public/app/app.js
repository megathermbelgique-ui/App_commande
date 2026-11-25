import { h, api, eur, frDate, frDay, pctText, icon, debounce } from '/shared/ui.js';
import { startScanner } from '/scanner.js';

const $top = document.getElementById('top');
const $view = document.getElementById('view');
const $layer = document.getElementById('layer');

// ---------- État local (conservé sur l'appareil) ----------
const store = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};
const state = { user: null, client: store.get('client', null) };
let cleanup = null; // fonction appelée en quittant l'écran courant (arrêt caméra…)

const setClient = (c) => {
  state.client = c ? { id: c.id, name: c.name, number: c.number, vat: c.vat } : null;
  store.set('client', state.client);
  updateBadge();
};
const cartKey = () => `cart:${state.client?.id}`;
const getCart = () => (state.client ? store.get(cartKey(), []) : []);
const setCart = (lines) => {
  store.set(cartKey(), lines);
  updateBadge();
};
function addToCart(product, unit, qty) {
  const lines = getCart();
  const found = lines.find((l) => l.productId === product.id && l.unit === unit && !l.implantationId);
  if (found) found.qty += qty;
  else lines.push({ productId: product.id, unit, qty });
  setCart(lines);
}

// ---------- Éléments d'interface ----------
function toast(text, kind = 'ok') {
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, kind === 'ok' ? icon('check', 20) : null, text);
  $layer.append(el);
  setTimeout(() => el.classList.add('out'), kind === 'ok' ? 1100 : 2600);
  setTimeout(() => el.remove(), kind === 'ok' ? 1400 : 2900);
}
const fail = (e) => {
  if (e.status === 401) return showLogin();
  toast(e.message || 'Erreur', 'err');
};

// Confirmation intégrée à l'application (les boîtes de dialogue du navigateur ne sont pas toujours disponibles).
function ask(text, okLabel = 'Confirmer') {
  return new Promise((resolve) => {
    const done = (v) => { wrap.remove(); resolve(v); };
    const wrap = h('div', { class: 'sheet-wrap' },
      h('div', { class: 'sheet', role: 'alertdialog', 'aria-label': text },
        h('p', { class: 'ask' }, text),
        h('div', { class: 'sheet-actions' },
          h('button', { class: 'btn', onclick: () => done(false) }, 'Annuler'),
          h('button', { class: 'btn primary', onclick: () => done(true) }, okLabel))));
    $layer.append(wrap);
  });
}

// Photo d'article (en démo, les photos sont chargées par paquets).
function photo(url, attrs) {
  const img = h('img', attrs);
  if (window.__resolveImage) window.__resolveImage(url).then((src) => { if (src) img.src = src; });
  else img.src = url;
  return img;
}

function updateBadge() {
  const badge = document.getElementById('badge');
  if (!badge) return;
  const n = getCart().length;
  badge.textContent = n;
  badge.hidden = n === 0;
}

// Animation « colis qui part dans le panier »
function flyToCart(fromEl) {
  const cart = document.getElementById('cartbtn');
  if (!cart || !fromEl) return;
  const a = fromEl.getBoundingClientRect();
  const b = cart.getBoundingClientRect();
  const box = h('div', { class: 'flybox' }, icon('box', 30));
  const x0 = a.left + a.width / 2 - 22;
  const y0 = a.top + a.height / 2 - 22;
  box.style.left = x0 + 'px';
  box.style.top = y0 + 'px';
  $layer.append(box);
  const dx = b.left + b.width / 2 - 22 - x0;
  const dy = b.top + b.height / 2 - 22 - y0;
  box.animate(
    [
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.75 - 60}px) scale(.8)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(.25)`, opacity: 0.6 },
    ],
    { duration: 650, easing: 'cubic-bezier(.4,.1,.6,1)' }
  ).onfinish = () => {
    box.remove();
    cart.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], 300);
  };
}

function header(title, { back } = {}) {
  $top.hidden = false;
  $top.replaceChildren(
    h('div', { class: 'left' },
      back ? h('button', { class: 'iconbtn', 'aria-label': 'Retour', onclick: () => (typeof back === 'string' ? go(back) : goBack()) }, icon('back')) : null,
      state.user?.role === 'livreur' ? null : h('button', { class: 'iconbtn', id: 'cartbtn', 'aria-label': 'Panier', onclick: () => go('/panier') },
        icon('cart', 26), h('span', { id: 'badge', class: 'badge', hidden: true }))
    ),
    h('h1', {}, title),
    h('div', { class: 'right' },
      h('button', { class: 'iconbtn', 'aria-label': 'Mon compte', onclick: () => go('/compte') }, icon('user', 26)))
  );
  updateBadge();
}

const loading = () => h('div', { class: 'loading' }, 'Chargement…');
const empty = (text) => h('div', { class: 'empty' }, text);
const field = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);
const statusChip = (o) => h('span', { class: `chip st-${o.status}` }, o.statusLabel);

function searchBar(placeholder, value, oninput) {
  return h('div', { class: 'search' }, icon('search', 20),
    h('input', { type: 'search', placeholder, value, autocomplete: 'off', autocapitalize: 'off',
      autocorrect: 'off', enterkeyhint: 'search', oninput: (e) => oninput(e.target.value) }));
}

// ---------- Navigation ----------
// En démo (page de démonstration sans serveur), la navigation reste en mémoire.
const DEMO = !!window.__DEMO__;
const trail = ['/'];
const currentPath = () => (DEMO ? trail[trail.length - 1] : location.hash.slice(1) || '/');
const goBack = () => {
  if (!DEMO) return history.back();
  if (trail.length > 1) trail.pop();
  route();
};
const replacePath = (path) => {
  if (!DEMO) return location.replace('#' + path);
  trail[trail.length - 1] = path;
  route();
};
const go = (path) => {
  if (DEMO) {
    if (currentPath() !== path) trail.push(path);
    return route();
  }
  if (location.hash === '#' + path) route();
  else location.hash = path;
};
const routes = [
  [/^\/$/, home],
  [/^\/scan$/, scanView],
  [/^\/panier$/, cartView],
  [/^\/catalogue$/, catalogueView],
  [/^\/catalogue\/(\d+)$/, catalogueView],
  [/^\/produit\/(\d+)$/, productView],
  [/^\/commandes$/, ordersView],
  [/^\/commande\/(\d+)$/, orderView],
  [/^\/clients$/, clientsView],
  [/^\/client\/nouveau$/, clientForm],
  [/^\/client\/(\d+)$/, clientView],
  [/^\/client\/(\d+)\/modifier$/, clientForm],
  [/^\/promos$/, promosView],
  [/^\/implantation$/, implantationView],
  [/^\/compte$/, accountView],
  [/^\/livraisons$/, deliveriesView],
  [/^\/livraison\/(\d+)$/, deliveryView],
];
function route() {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  $layer.querySelectorAll('.sheet-wrap').forEach((s) => s.remove());
  if (!state.user) return showLogin();
  let path = currentPath();
  // Un livreur n'a accès qu'à sa tournée et à son compte.
  if (state.user.role === 'livreur' && !/^\/(livraisons?|compte)/.test(path)) path = '/livraisons';
  $view.className = '';
  $view.scrollTop = 0;
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) return fn(...m.slice(1).map(Number));
  }
  go('/');
}
window.addEventListener('hashchange', route);

// ---------- Connexion ----------
function showLogin() {
  state.user = null;
  $top.hidden = true;
  $view.className = 'login';
  const error = h('p', { class: 'error', role: 'alert' });
  const username = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'off', autocorrect: 'off', required: true });
  const password = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'btn primary big', type: 'submit' }, 'Se connecter');
  $view.replaceChildren(
    h('form', {
      class: 'logincard',
      onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true;
        error.textContent = '';
        try {
          const r = await api('/login', { method: 'POST', body: { username: username.value, password: password.value } });
          state.user = r.user;
          route();
        } catch (err) {
          error.textContent = err.message;
          btn.disabled = false;
        }
      },
    },
      h('div', { class: 'logo' }, icon('box', 44)),
      h('h1', {}, 'Commandes Bormann'),
      field("Nom d'utilisateur", username),
      field('Mot de passe', password),
      error, btn,
      h('p', { class: 'hint' }, DEMO
        ? 'Démonstration : entrez n\'importe quel nom et mot de passe (le nom « livreur » ouvre l\'écran du livreur). Les données restent sur cet appareil.'
        : 'Vous resterez connecté sur cet appareil.'))
  );
}

// ---------- Accueil ----------
function home() {
  header('Commandes');
  const tile = (path, name, label, sub, cls = '') =>
    h('button', { class: `tile ${cls}`, onclick: () => go(path) }, icon(name, 40), h('b', {}, label), h('small', {}, sub));
  $view.replaceChildren(
    h('div', { class: 'pad' },
      state.client
        ? h('button', { class: 'clientbar', onclick: () => go(`/client/${state.client.id}`) },
            h('span', {}, 'Client en cours'), h('b', {}, state.client.name), icon('chevron', 18))
        : null,
      h('div', { class: 'tiles' },
        tile('/scan', 'scan', 'Scan', 'Scanner des codes-barres', 'wide accent'),
        tile('/catalogue', 'book', 'Catalogue', 'Commander par article'),
        tile('/implantation', 'ruler', 'Implantation', 'Assortiment au mètre'),
        tile('/commandes', 'list', 'Commandes passées', 'Suivi et statuts'),
        tile('/clients', 'people', 'Clients', 'Fiches et nouveaux clients'),
        tile('/promos', 'tag', 'Promos', 'Offres du moment', state.user.role === 'admin' ? '' : 'wide low'),
        state.user.role === 'admin' ? tile('/livraisons', 'truck', 'Livraisons', 'Tournée et signatures') : null))
  );
}

// ---------- Sélection d'un client ----------
function clientPicker(onPick, title = 'Sélectionnez un client') {
  const list = h('div', { class: 'rows' }, loading());
  const load = debounce(async (query) => {
    try {
      const { clients } = await api('/clients?q=' + encodeURIComponent(query));
      list.replaceChildren(
        ...(clients.length
          ? clients.map((c) =>
              h('button', { class: 'row', onclick: () => onPick(c) },
                h('div', { class: 'grow' }, h('b', {}, c.name),
                  h('small', {}, [c.number, c.vat, [c.hq_zip, c.hq_city].filter(Boolean).join(' ')].filter(Boolean).join(' · '))),
                icon('chevron', 18)))
          : [empty('Aucun client trouvé.')])
      );
    } catch (e) {
      fail(e);
    }
  }, 200);
  load('');
  return h('div', { class: 'pad' },
    h('h2', {}, title),
    searchBar('Nom, n° de TVA, n° client, ville…', '', load),
    list,
    h('button', { class: 'btn ghost', onclick: () => go('/client/nouveau') }, icon('plus', 18), 'Nouveau client'));
}

// ---------- Fenêtre « quantité × conditionnement » ----------
function openAddSheet(product, presetUnit, onClose = () => {}) {
  let qty = 1;
  const units = product.units;
  if (!units.length) {
    toast("Cet article n'a pas de prix défini.", 'err');
    return onClose();
  }
  const unitLabel = (u) => (u.qty > 1 ? `${u.label} ×${u.qty}` : u.label);
  const select = h('select', { 'aria-label': 'Conditionnement', onchange: refresh },
    units.map((u) => h('option', { value: u.unit, selected: u.unit === presetUnit }, `${unitLabel(u)} — ${eur(u.netCents)}${u.saving ? ` (${u.saving.label})` : ''}`)));
  const input = h('input', { type: 'number', inputmode: 'numeric', min: 1, value: 1, 'aria-label': 'Quantité',
    oninput: () => { qty = Math.max(0, Math.floor(Number(input.value)) || 0); refresh(false); },
    onblur: () => { if (qty < 1) { qty = 1; refresh(); } } });
  const price = h('div', { class: 'sheet-price' });
  const tip = h('div', { class: 'hint-line', hidden: true });
  const step = (d) => { qty = Math.max(1, qty + d); refresh(); };
  const wrap = h('div', { class: 'sheet-wrap' });
  const card = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Ajouter au panier' },
    h('div', { class: 'sheet-head' },
      h('b', {}, product.name),
      h('small', {}, `Réf. ${product.ref}` + (state.client ? ` · ${state.client.name}` : ''))),
    product.promos.map((p) => h('div', { class: 'promo-line' }, icon('tag', 16),
      `${p.title} : -${pctText(p.discountPct)} dès ${p.minQty} pièce${p.minQty > 1 ? 's' : ''}`)),
    h('div', { class: 'qtyrow' },
      h('div', { class: 'stepper' },
        h('button', { type: 'button', 'aria-label': 'Moins', onclick: () => step(-1) }, icon('minus', 20)),
        input,
        h('button', { type: 'button', 'aria-label': 'Plus', onclick: () => step(1) }, icon('plus', 20))),
      h('span', { class: 'times' }, '×'),
      h('div', { class: 'selectbox' }, select)),
    price,
    tip,
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn cancel', onclick: () => close() }, icon('close', 20), 'Annuler'),
      h('button', { class: 'btn primary', onclick: add }, icon('check', 20), 'Ajouter')));
  wrap.append(card);
  $layer.append(wrap);

  function refresh(writeInput = true) {
    if (writeInput) input.value = qty;
    const u = units.find((x) => x.unit === select.value);
    const pieces = qty * u.qty;
    // Une promo peut s'appliquer selon la quantité : même règle que le serveur.
    let pct = product.clientDiscountPct;
    let promo = false;
    for (const p of product.promos) if (pieces >= p.minQty && p.discountPct > pct) { pct = p.discountPct; promo = true; }
    const net = Math.round(u.baseCents * (1 - pct / 100));
    price.replaceChildren(
      h('span', {}, `${eur(net)} / ${u.label.toLowerCase()}`,
        pct ? h('em', { class: promo ? 'promo' : '' }, ` -${pctText(pct)}${promo ? ' promo' : ''}`) : null,
        u.qty > 1 ? h('small', {}, ` soit ${eur(Math.round(net / u.qty))} / pièce`) : null,
        u.saving ? h('em', {}, ` ${u.saving.label}`) : null),
      h('b', {}, eur(net * qty)));
    // Conseil : la quantité approche d'un conditionnement plus avantageux.
    const next = units.find((x) => x.qty > u.qty && x.baseCents / x.qty < u.baseCents / u.qty);
    const near = next && pieces < next.qty && pieces >= next.qty * 0.7;
    const exact = next && pieces % next.qty === 0;
    tip.hidden = !(near || exact);
    if (near || exact) {
      const n = exact ? pieces / next.qty : 1;
      const gain = next.saving ? ` (${next.saving.label})` : '';
      tip.replaceChildren(icon('tag', 16),
        h('span', {}, exact ? `Même quantité en ${n} ${next.label.toLowerCase()}${n > 1 ? 's' : ''} : prix par ${next.label.toLowerCase()}${gain}.`
          : `Ajoutez ${next.qty - pieces} pièce${next.qty - pieces > 1 ? 's' : ''} pour avoir le prix par ${next.label.toLowerCase()}${gain}.`),
        h('button', { class: 'btn small', type: 'button', onclick: () => { select.value = next.unit; qty = n; refresh(); } },
          `Passer à ${n} ${next.label.toLowerCase()}${n > 1 ? 's' : ''}`));
    }
  }
  function close() {
    wrap.remove();
    onClose();
  }
  function add() {
    if (qty < 1) return;
    addToCart(product, select.value, qty);
    flyToCart(card);
    toast('Article ajouté au panier');
    close();
  }
  refresh();
}

// Ouvre la fenêtre d'ajout ; demande d'abord le client si aucun n'est sélectionné.
// Bandeau « client en cours » des écrans de commande ; permet de le choisir ou d'en changer sur place.
function orderClientBar(onChange) {
  const pick = () => $view.replaceChildren(clientPicker((c) => { setClient(c); onChange(); }));
  return state.client
    ? h('button', { class: 'clientbar', onclick: pick }, h('span', {}, 'Commande pour'), h('b', {}, state.client.name), h('u', {}, 'Changer'))
    : h('button', { class: 'clientbar none', onclick: pick }, icon('people', 20), h('b', {}, 'Choisir le client pour commander'), icon('chevron', 18));
}

async function addProduct(productId) {
  if (!state.client) {
    toast("Choisissez d'abord le client.", 'err');
    $view.replaceChildren(clientPicker((c) => { setClient(c); route(); }));
    return;
  }
  try {
    const { product } = await api(`/products/${productId}?client=${state.client.id}`);
    openAddSheet(product, 'piece');
  } catch (e) {
    fail(e);
  }
}

// ---------- Scan ----------
function scanView() {
  header('Scan', { back: '/' });
  if (!state.client) {
    $view.replaceChildren(clientPicker((c) => { setClient(c); scanView(); }));
    return;
  }
  $view.className = 'scan';
  const video = h('video', { playsinline: true, muted: true, autoplay: true });
  const message = h('div', { class: 'scan-msg' }, 'Démarrage de la caméra…');
  let scanner = null;
  let busy = false;
  let gone = false;

  async function lookup(code) {
    if (busy) return;
    busy = true;
    scanner?.pause();
    try {
      const { product, unit } = await api(`/scan/${encodeURIComponent(code)}?client=${state.client.id}`);
      openAddSheet(product, unit || 'piece', () => { busy = false; scanner?.resume(); });
    } catch (e) {
      if (e.status === 401) return fail(e);
      toast(e.status === 404 ? `Code inconnu : ${code}` : e.message, 'err');
      busy = false;
      scanner?.resume();
    }
  }
  const manual = h('input', { type: 'text', placeholder: 'Code-barres ou référence', autocapitalize: 'off', autocorrect: 'off', enterkeyhint: 'go' });
  $view.replaceChildren(
    h('div', { class: 'camera' }, video, h('div', { class: 'frame' }), message),
    h('button', { class: 'scan-client', onclick: () => { setClient(null); scanView(); } },
      h('span', {}, 'Client'), h('b', {}, state.client.name), h('u', {}, 'Changer')),
    h('form', { class: 'scan-manual', onsubmit: (e) => { e.preventDefault(); const v = manual.value.trim(); if (v) { manual.value = ''; manual.blur(); lookup(v); } } },
      manual, h('button', { class: 'btn primary', type: 'submit' }, 'OK'))
  );
  startScanner(video, lookup).then(
    (s) => {
      if (gone) return s.stop();
      scanner = s;
      message.textContent = 'Placez le code-barres dans le cadre';
      if (busy) s.pause();
    },
    (e) => {
      if (DEMO) {
        // Pas de caméra dans la page de démonstration : on simule la lecture d'un code-barres.
        message.classList.add('demo');
        message.replaceChildren(h('b', {}, 'Démo : la caméra est remplacée par des scans simulés.'),
          h('div', { class: 'chips' }, (window.__DEMO__.scans || []).map((x) =>
            h('button', { class: 'chipbtn', onclick: () => lookup(x.code) }, icon('scan', 16), x.label))));
        return;
      }
      message.textContent = e.message + ' Vous pouvez saisir le code ci-dessous.';
      message.classList.add('err');
    }
  );
  cleanup = () => { gone = true; scanner?.stop(); };
}

// ---------- Panier ----------
function cartView() {
  header('Panier', { back: '/' });
  if (!state.client) {
    $view.replaceChildren(clientPicker((c) => { setClient(c); cartView(); }, 'Panier : sélectionnez un client'));
    return;
  }
  const body = h('div', { class: 'stack' }, loading());
  const note = h('textarea', { rows: 2, placeholder: 'Remarque pour la commande (facultatif)', value: store.get(cartKey() + ':note', ''),
    oninput: () => store.set(cartKey() + ':note', note.value) });
  $view.replaceChildren(h('div', { class: 'pad' },
    h('button', { class: 'clientbar', onclick: () => go(`/client/${state.client.id}`) },
      h('span', {}, 'Commande pour'), h('b', {}, state.client.name), icon('chevron', 18)),
    body));
  let seq = 0;

  async function refresh() {
    const lines = getCart();
    if (!lines.length) {
      body.replaceChildren(empty('Le panier est vide.'),
        h('button', { class: 'btn primary big', onclick: () => go('/scan') }, icon('scan', 22), 'Scanner des articles'));
      return;
    }
    const mine = ++seq;
    let quote;
    try {
      quote = await api('/quote', { method: 'POST', body: { clientId: state.client.id, lines } });
    } catch (e) {
      return fail(e);
    }
    if (mine !== seq) return;
    // Articles retirés du catalogue entre-temps : on nettoie le panier.
    if (quote.lines.length !== lines.length) {
      setCart(quote.lines.map((l) => ({ productId: l.productId, unit: l.unit, qty: l.qty, ...(l.implantationId ? { implantationId: l.implantationId } : {}) })));
    }
    const same = (x, l) => x.productId === l.productId && x.unit === l.unit && (x.implantationId || null) === (l.implantationId || null);
    const change = (l, qty) => {
      const cart = getCart();
      const item = cart.find((x) => same(x, l));
      if (!item) return;
      if (qty < 1) cart.splice(cart.indexOf(item), 1);
      else item.qty = qty;
      setCart(cart);
      refresh();
    };
    // Conseil de conditionnement accepté : la ligne passe dans l'unité proposée.
    const switchUnit = (l) => {
      const cart = getCart().filter((x) => !same(x, l));
      const target = cart.find((x) => x.productId === l.productId && x.unit === l.hint.action.unit && !x.implantationId);
      if (target) target.qty += l.hint.action.qty;
      else cart.push({ productId: l.productId, unit: l.hint.action.unit, qty: l.hint.action.qty });
      setCart(cart);
      refresh();
    };
    const row = (l) => {
      const input = h('input', { type: 'number', inputmode: 'numeric', min: 1, value: l.qty, 'aria-label': 'Quantité',
        onchange: () => change(l, Math.max(1, Math.floor(Number(input.value)) || 1)) });
      return h('div', { class: 'cartitem' },
        h('div', { class: 'cartline' },
          h('div', { class: 'grow', onclick: () => go(`/produit/${l.productId}`) }, lineText(l)),
          h('div', { class: 'cartline-right' },
            h('b', {}, eur(l.totalCents)),
            h('div', { class: 'stepper small' },
              h('button', { 'aria-label': l.qty > 1 ? 'Moins' : 'Supprimer', onclick: () => change(l, l.qty - 1) }, icon(l.qty > 1 ? 'minus' : 'trash', 18)),
              input,
              h('button', { 'aria-label': 'Plus', onclick: () => change(l, l.qty + 1) }, icon('plus', 18))))),
        l.hint ? h('div', { class: 'hint-line' }, icon('tag', 16), h('span', {}, l.hint.text),
          h('button', { class: 'btn small', onclick: () => switchUnit(l) }, l.hint.action.label)) : null);
    };
    const { loose, plans } = groupLines(quote.lines);
    const cr = quote.credit;
    const pctDone = quote.francoCents ? Math.min(100, (quote.totalCents / quote.francoCents) * 100) : 100;
    const send = h('button', { class: 'btn primary big', disabled: !quote.canOrder, onclick: submit }, icon('check', 22), 'Envoyer la commande');
    body.replaceChildren(...[
      cr?.blocked ? h('div', { class: 'card blocked', role: 'alert' }, h('h3', {}, 'Commande impossible pour ce client'), h('p', {}, cr.reason)) : null,
      loose.length ? h('div', { class: 'cartlines' }, loose.map(row)) : null,
      // Chaque implantation forme un bloc : on touche son titre pour voir ses articles.
      ...plans.map((g) => h('details', { class: 'plan', open: openPlans.has(g.id), ontoggle: (e) => (e.target.open ? openPlans.add(g.id) : openPlans.delete(g.id)) },
        h('summary', {}, icon('ruler', 22),
          h('div', { class: 'grow' }, h('b', {}, `Implantation ${g.name}`),
            h('small', {}, `${g.lines.length} référence${g.lines.length > 1 ? 's' : ''}`,
              g.extraPct ? h('em', {}, ` · remise implantation -${pctText(g.extraPct)}`) : null)),
          h('b', {}, eur(g.totalCents)), icon('chevron', 18)),
        h('div', { class: 'cartlines' }, g.lines.map(row)),
        h('button', { class: 'btn ghost danger', onclick: async () => {
          if (!(await ask(`Retirer l'implantation ${g.name} du panier ?`, 'Retirer'))) return;
          setCart(getCart().filter((x) => x.implantationId !== g.id));
          refresh();
        } }, icon('trash', 18), "Retirer toute l'implantation"))),
      h('div', { class: 'totals' },
        h('div', { class: 'total' }, h('span', {}, 'Total du panier (HT)'), h('b', {}, eur(quote.totalCents))),
        quote.francoCents
          ? h('div', { class: 'franco' + (quote.missingCents ? '' : ' ok') },
              h('div', { class: 'bar' }, h('i', { style: { width: pctDone + '%' } })),
              quote.missingCents
                ? h('p', {}, 'Il manque ', h('b', {}, eur(quote.missingCents)), ` pour atteindre le franco (${eur(quote.francoCents)}).`)
                : h('p', {}, icon('check', 16), `Franco atteint (${eur(quote.francoCents)}).`),
              quote.missingCents && quote.francoBlocking ? h('p', { class: 'muted' }, "La commande pourra être envoyée une fois le franco atteint.") : null)
          : null,
        cr && cr.limitCents != null && !cr.blocked
          ? h('p', { class: 'muted' }, `Crédit : encours ${eur(cr.outstandingCents)} + cette commande ${eur(cr.orderCents)} TTC, limite ${eur(cr.limitCents)}.`) : null),
      note,
      send,
      h('button', { class: 'btn ghost', onclick: () => go('/scan') }, icon('scan', 18), 'Continuer à scanner'),
      h('button', { class: 'btn ghost danger', onclick: () => { ask('Vider le panier ?', 'Vider').then((ok) => { if (ok) { setCart([]); refresh(); } }); } }, icon('trash', 18), 'Vider le panier'),
    ].filter(Boolean));

    async function submit() {
      if (!(await ask(`Envoyer la commande pour ${state.client.name} ?\nTotal : ${eur(quote.totalCents)} HT`, 'Envoyer'))) return;
      send.disabled = true;
      try {
        const { order } = await api('/orders', { method: 'POST', body: { clientId: state.client.id, lines: getCart(), note: note.value } });
        setCart([]);
        store.set(cartKey() + ':note', '');
        toast(`Commande ${order.number} envoyée`);
        replacePath('/commande/' + order.id);
      } catch (e) {
        send.disabled = false;
        fail(e);
        if (e.status !== 401) refresh();
      }
    }
  }
  refresh();
}
const openPlans = new Set();

// Lignes d'une commande passée : articles libres, puis une section repliable par implantation.
function orderBlocks(lines) {
  const { loose, plans } = groupLines(lines);
  const row = (l) => h('div', { class: 'cartline' }, h('div', { class: 'grow' }, lineText(l, true)), h('b', {}, eur(l.totalCents)));
  return [
    loose.length ? h('div', { class: 'cartlines' }, loose.map(row)) : null,
    ...plans.map((g) => h('details', { class: 'plan' },
      h('summary', {}, icon('ruler', 22),
        h('div', { class: 'grow' }, h('b', {}, `Implantation ${g.name}`),
          h('small', {}, `${g.lines.length} référence${g.lines.length > 1 ? 's' : ''}`, g.extraPct ? h('em', {}, ` · remise implantation -${pctText(g.extraPct)}`) : null)),
        h('b', {}, eur(g.totalCents)), icon('chevron', 18)),
      h('div', { class: 'cartlines' }, g.lines.map(row)))),
  ].filter(Boolean);
}

// Texte d'une ligne d'article : nom, conditionnement, prix net et remises appliquées.
function lineText(l, withQty = false) {
  return [
    h('b', {}, l.name),
    h('small', {}, `Réf. ${l.ref} · ${withQty ? `${l.qty} × ` : ''}${l.unitLabel}${l.unitQty > 1 ? ` de ${l.unitQty} pcs` : ''}`),
    h('small', {}, `${eur(l.netCents)} / ${l.unitLabel.toLowerCase()}`,
      l.discountPct ? h('em', { class: l.promo ? 'promo' : '' }, ` -${pctText(l.discountPct)}${l.promo ? ' promo' : ''}`) : null,
      l.extraPct ? h('em', {}, ` -${pctText(l.extraPct)} implantation`) : null),
  ];
}
// Sépare les articles libres des implantations (une implantation = un groupe).
function groupLines(lines) {
  const loose = [];
  const plans = [];
  for (const l of lines) {
    if (!l.implantationId) { loose.push(l); continue; }
    let g = plans.find((x) => x.id === l.implantationId);
    if (!g) plans.push((g = { id: l.implantationId, name: l.implantationName, extraPct: 0, totalCents: 0, lines: [] }));
    g.lines.push(l);
    g.totalCents += l.totalCents;
    g.extraPct = Math.max(g.extraPct, l.extraPct || 0);
  }
  return { loose, plans };
}

// ---------- Catalogue ----------
let catalogueQuery = '';
const UNIT_NAMES = { piece: 'pièce', boite: 'boîte', carton: 'carton', palette: 'palette' };

// Compteur − n + relié à une ligne du panier du client en cours.
function cartStepper(productId, unit, label) {
  const read = () => getCart().find((l) => l.productId === productId && l.unit === unit && !l.implantationId)?.qty || 0;
  const input = h('input', { type: 'number', inputmode: 'numeric', min: 0, value: read(), 'aria-label': `Quantité ${label}`,
    onchange: () => write(Math.max(0, Math.floor(Number(input.value)) || 0)) });
  const box = h('div', { class: 'stepper small' },
    h('button', { type: 'button', 'aria-label': 'Moins', onclick: () => write(read() - 1) }, icon('minus', 18)),
    input,
    h('button', { type: 'button', 'aria-label': 'Plus', onclick: () => write(read() + 1) }, icon('plus', 18)));
  function write(qty) {
    const cart = getCart();
    const i = cart.findIndex((l) => l.productId === productId && l.unit === unit && !l.implantationId);
    if (qty < 1) { if (i >= 0) cart.splice(i, 1); }
    else if (i >= 0) cart[i].qty = qty;
    else cart.push({ productId, unit, qty });
    setCart(cart);
    input.value = Math.max(0, qty);
    box.classList.toggle('on', qty > 0);
  }
  box.classList.toggle('on', read() > 0);
  return box;
}

function productRow(p) {
  const priced = p.priceCents != null;
  let side = null;
  if (priced && state.client) {
    // Client en cours : la quantité se règle directement dans la liste et part au panier.
    side = h('div', { class: 'rowqty' },
      cartStepper(p.id, p.unit, p.name),
      p.unitCount > 1
        ? h('button', { class: 'linkbtn', onclick: () => addProduct(p.id) }, `par ${UNIT_NAMES[p.unit] || p.unit} · autres`)
        : h('small', {}, `par ${UNIT_NAMES[p.unit] || p.unit}`));
  } else if (priced) {
    side = h('button', { class: 'rowadd', 'aria-label': `Ajouter ${p.name} au panier`, onclick: () => addProduct(p.id) }, icon('plus', 22));
  }
  return h('div', { class: 'row split' },
    h('button', { class: 'rowmain', onclick: () => go(`/produit/${p.id}`) },
      h('div', { class: 'thumb' }, p.imageUrl ? photo(p.imageUrl, { alt: '', loading: 'lazy' }) : icon('box', 26)),
      h('div', { class: 'grow' }, h('b', {}, p.name), h('small', {}, `Réf. ${p.ref}${p.code ? ' · ' + p.code : ''}`),
        priced ? h('small', { class: 'price' }, eur(p.priceCents)) : null)),
    side);
}
async function catalogueView(categoryId) {
  header('Catalogue', { back: categoryId ? '/catalogue' : '/' });
  const out = h('div', {}, loading());
  const show = debounce(render, 220);
  $view.replaceChildren(h('div', { class: 'pad' },
    orderClientBar(() => catalogueView(categoryId)),
    searchBar('Référence, nom, caractéristique…', categoryId ? '' : catalogueQuery, (v) => { if (!categoryId) catalogueQuery = v; show(v); }),
    out));
  let seq = 0;
  async function render(query) {
    const mine = ++seq;
    try {
      if (!query.trim() && !categoryId) {
        const { categories } = await api('/categories');
        if (mine !== seq) return;
        out.replaceChildren(
          h('button', { class: 'btn', onclick: () => go('/implantation') }, icon('ruler', 20), 'Implantation au mètre'),
          h('h2', {}, 'Catégories'),
          h('div', { class: 'rows' }, categories.length
            ? categories.map((c) => h('button', { class: 'row', onclick: () => go(`/catalogue/${c.id}`) },
                h('div', { class: 'grow' }, h('b', {}, c.name), h('small', {}, `${c.count} article${c.count > 1 ? 's' : ''}`)), icon('chevron', 18)))
            : empty('Le catalogue est vide.')));
        return;
      }
      const params = new URLSearchParams({ q: query });
      if (categoryId) params.set('category', categoryId);
      const [{ products }, cats] = await Promise.all([api('/products?' + params), categoryId ? api('/categories') : null]);
      if (mine !== seq) return;
      const cat = cats?.categories.find((c) => c.id === categoryId);
      out.replaceChildren(
        h('h2', {}, cat ? cat.name : `${products.length} résultat${products.length > 1 ? 's' : ''}`),
        h('div', { class: 'rows' }, products.length ? products.map(productRow) : empty('Aucun article trouvé.')));
    } catch (e) {
      fail(e);
    }
  }
  render(categoryId ? '' : catalogueQuery);
}

async function productView(id) {
  header('Article', { back: true });
  $view.replaceChildren(loading());
  let product;
  try {
    ({ product } = await api(`/products/${id}` + (state.client ? `?client=${state.client.id}` : '')));
  } catch (e) {
    $view.replaceChildren(empty(e.message));
    return fail(e);
  }
  const p = product;
  $view.replaceChildren(h('div', { class: 'pad product' },
    p.imageUrl ? photo(p.imageUrl, { class: 'hero', alt: p.name }) : h('div', { class: 'hero ph' }, icon('box', 64)),
    h('h2', {}, p.name),
    h('p', { class: 'muted' }, [`Réf. ${p.ref}`, p.code && `Code ${p.code}`, p.category].filter(Boolean).join(' · ')),
    p.promos.map((x) => h('div', { class: 'promo-line' }, icon('tag', 16),
      `${x.title} : -${pctText(x.discountPct)} dès ${x.minQty} pièce${x.minQty > 1 ? 's' : ''}` + (x.endsOn ? ` (jusqu'au ${frDay(x.endsOn)})` : ''))),
    h('h3', {}, 'Prix HT'),
    state.client
      ? h('p', { class: 'muted' }, `Prix pour ${state.client.name}`, p.clientDiscountPct ? ` — remise ${pctText(p.clientDiscountPct)}` : ' — pas de remise')
      : h('p', { class: 'muted' }, 'Prix de base. Sélectionnez un client pour voir sa remise.'),
    h('table', { class: 'prices' },
      h('tbody', {}, p.units.map((u) => h('tr', {},
        h('td', {}, h('b', {}, u.label), u.qty > 1 ? h('small', {}, ` ${u.qty} pièces`) : null,
          u.saving ? h('em', { class: 'save' }, u.saving.label) : null),
        h('td', { class: 'num' }, u.netCents !== u.baseCents ? h('s', {}, eur(u.baseCents)) : null),
        h('td', { class: 'num' }, h('b', {}, eur(u.netCents)), u.promo ? h('em', { class: 'promo' }, ' promo') : null))))),
    p.units.length ? null : h('p', { class: 'muted' }, "Prix pas encore défini : cet article ne peut pas être commandé pour l'instant."),
    p.units.length ? h('button', { class: 'btn primary big', onclick: () => addProduct(p.id) }, icon('cart', 22), 'Ajouter au panier') : null,
    p.description ? [h('h3', {}, 'Description'), h('p', { class: 'desc' }, p.description)] : null,
    p.specs.length ? [h('h3', {}, 'Fiche technique'),
      h('table', { class: 'specs' }, h('tbody', {}, p.specs.map(([k, v]) => (v
        ? h('tr', {}, h('th', {}, k), h('td', {}, v))
        : h('tr', { class: 'section' }, h('td', { colspan: 2 }, k))))))] : null,
    p.units.some((u) => u.ean) ? [h('h3', {}, 'Codes-barres'),
      h('table', { class: 'specs' }, h('tbody', {}, p.units.filter((u) => u.ean).map((u) => h('tr', {}, h('th', {}, u.label), h('td', {}, u.ean)))))] : null
  ));
}

// ---------- Commandes passées ----------
async function ordersView() {
  header('Commandes passées', { back: '/' });
  $view.replaceChildren(loading());
  try {
    const { orders } = await api('/orders');
    $view.replaceChildren(h('div', { class: 'pad' }, h('div', { class: 'rows' },
      orders.length ? orders.map((o) => h('button', { class: 'row', onclick: () => go(`/commande/${o.id}`) },
        h('div', { class: 'grow' }, h('b', {}, o.client.name), h('small', {}, `${o.number} · ${frDate(o.createdAt)}`)),
        h('div', { class: 'right-col' }, h('b', {}, eur(o.totalCents)), statusChip(o))))
      : empty('Aucune commande pour le moment.'))));
  } catch (e) {
    fail(e);
  }
}

async function orderView(id) {
  header('Commande', { back: '/commandes' });
  $view.replaceChildren(loading());
  try {
    const { order: o, lines } = await api(`/orders/${id}`);
    const c = o.client;
    const hasDel = c.del_address || c.del_city;
    $view.replaceChildren(h('div', { class: 'pad' },
      h('div', { class: 'card' },
        h('div', { class: 'spread' }, h('h2', {}, o.number), statusChip(o)),
        h('p', { class: 'muted' }, `${frDate(o.createdAt)} · ${o.userName}`),
        h('p', {}, h('b', {}, c.name), h('br'), 'Livraison : ',
          [hasDel ? c.del_address : c.hq_address, hasDel ? `${c.del_zip} ${c.del_city}` : `${c.hq_zip} ${c.hq_city}`].filter((x) => x.trim()).join(', ') || '—'),
        o.note ? h('p', { class: 'note' }, o.note) : null),
      ...orderBlocks(lines),
      h('div', { class: 'totals' }, h('div', { class: 'total' }, h('span', {}, 'Total HT'), h('b', {}, eur(o.totalCents))))));
  } catch (e) {
    $view.replaceChildren(empty(e.message));
    fail(e);
  }
}

// ---------- Clients ----------
function clientsView() {
  header('Clients', { back: '/' });
  $view.replaceChildren(clientPicker((c) => go(`/client/${c.id}`), 'Mes clients'));
}

async function clientView(id) {
  header('Client', { back: '/clients' });
  $view.replaceChildren(loading());
  let c;
  let cr;
  try {
    ({ client: c, credit: cr } = await api(`/clients/${id}`));
  } catch (e) {
    $view.replaceChildren(empty(e.message));
    return fail(e);
  }
  const line = (label, value, href) => value ? h('div', { class: 'kv' }, h('span', {}, label), href ? h('a', { href }, value) : h('b', {}, value)) : null;
  const tel = (v) => v && 'tel:' + v.replace(/[^+\d]/g, '');
  const section = (title, ...rows) => rows.some(Boolean) ? h('div', { class: 'card' }, h('h3', {}, title), rows) : null;
  const addr = (a, z, city) => [a, [z, city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const current = state.client?.id === c.id;
  $view.replaceChildren(h('div', { class: 'pad' },
    h('h2', {}, c.name),
    h('p', { class: 'muted' }, [c.number && `N° client ${c.number}`, c.vat && `TVA ${c.vat}`].filter(Boolean).join(' · ')),
    h('button', { class: 'btn primary big', onclick: () => { setClient(c); go('/scan'); } }, icon('scan', 22), 'Commander pour ce client'),
    current ? h('p', { class: 'muted center' }, 'Client en cours de commande') : null,
    cr?.onHold ? h('div', { class: 'card blocked', role: 'alert' }, h('h3', {}, 'Client en attente'),
      h('p', {}, 'Aucune commande ne peut être passée pour ce client. Contactez le bureau.')) : null,
    section('Crédit', line('Encours (TTC, non payé)', cr ? eur(cr.outstandingCents) : null),
      line('Limite de crédit', cr && cr.limitCents != null ? eur(cr.limitCents) : 'Aucune'),
      line('Disponible', cr && cr.limitCents != null ? eur(Math.max(0, cr.limitCents - cr.outstandingCents)) : null)),
    section('Conditions', line('Remise générale', pctText(c.discountPct)), line('Franco', c.francoCents != null ? eur(c.francoCents) : null)),
    section('Adresses', line('Siège social', addr(c.hq_address, c.hq_zip, c.hq_city)),
      line('Livraison', addr(c.del_address, c.del_zip, c.del_city) || 'Identique au siège social'), line('Horaires', c.hours)),
    section('Contacts', line('Téléphone', c.phone, tel(c.phone)), line('E-mail', c.email, c.email && 'mailto:' + c.email),
      line('Gérant / responsable', c.manager_name), line('Tél. responsable', c.manager_phone, tel(c.manager_phone))),
    section('Comptabilité', line('Contact', c.accounting_name), line('Téléphone', c.accounting_phone, tel(c.accounting_phone)),
      line('E-mail', c.accounting_email, c.accounting_email && 'mailto:' + c.accounting_email), line('Compte bancaire', c.iban)),
    section('Informations complémentaires', c.notes ? h('p', { class: 'desc' }, c.notes) : null),
    h('button', { class: 'btn ghost', onclick: () => go(`/client/${c.id}/modifier`) }, 'Modifier la fiche')));
}

async function clientForm(id) {
  header(id ? 'Modifier le client' : 'Nouveau client', { back: true });
  let c = {};
  if (id) {
    $view.replaceChildren(loading());
    try {
      ({ client: c } = await api(`/clients/${id}`));
    } catch (e) {
      return fail(e);
    }
  }
  const inputs = {};
  const input = (name, label, attrs = {}) => {
    inputs[name] = attrs.rows ? h('textarea', { ...attrs, value: c[name] || '' }) : h('input', { type: 'text', ...attrs, value: c[name] || '' });
    return field(label, inputs[name]);
  };
  const group = (title, ...children) => h('fieldset', {}, h('legend', {}, title), children);
  const error = h('p', { class: 'error', role: 'alert' });
  const save = h('button', { class: 'btn primary big', type: 'submit' }, 'Enregistrer');
  $view.replaceChildren(h('form', { class: 'pad form', onsubmit: async (e) => {
    e.preventDefault();
    save.disabled = true;
    error.textContent = '';
    const body = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
    try {
      const r = await api(id ? `/clients/${id}` : '/clients', { method: id ? 'PUT' : 'POST', body });
      if (state.client?.id === r.client.id) setClient(r.client);
      toast('Client enregistré');
      replacePath('/client/' + r.client.id);
    } catch (err) {
      error.textContent = err.message;
      save.disabled = false;
    }
  } },
    group('Identité',
      input('name', 'Nom de la société *', { required: true }),
      input('vat', 'Numéro de TVA', { placeholder: 'BE 0123.456.789', autocapitalize: 'characters' }),
      input('number', 'Numéro client', { placeholder: id ? '' : 'Attribué automatiquement si vide' })),
    group('Adresse du siège social',
      input('hq_address', 'Rue et numéro', { autocomplete: 'off' }),
      h('div', { class: 'two' }, input('hq_zip', 'Code postal', { inputmode: 'numeric' }), input('hq_city', 'Localité'))),
    group('Adresse de livraison',
      h('p', { class: 'muted' }, 'Laisser vide si identique au siège social.'),
      input('del_address', 'Rue et numéro', { autocomplete: 'off' }),
      h('div', { class: 'two' }, input('del_zip', 'Code postal', { inputmode: 'numeric' }), input('del_city', 'Localité')),
      input('hours', 'Horaires du magasin', { rows: 2, placeholder: 'Lu–Ve 8h–18h, Sa 9h–12h' })),
    group('Contacts',
      input('phone', 'Téléphone du magasin', { type: 'tel' }),
      input('email', 'Adresse e-mail', { type: 'email', autocapitalize: 'off' }),
      input('manager_name', 'Gérant / responsable'),
      input('manager_phone', 'Téléphone du responsable', { type: 'tel' })),
    group('Comptabilité',
      input('accounting_name', 'Contact comptabilité'),
      input('accounting_phone', 'Téléphone comptabilité', { type: 'tel' }),
      input('accounting_email', 'E-mail comptabilité (factures)', { type: 'email', autocapitalize: 'off' }),
      input('iban', 'Compte bancaire (IBAN)', { autocapitalize: 'characters' })),
    group('Informations complémentaires', input('notes', 'Remarques', { rows: 3 })),
    error, save));
}

// ---------- Implantation : assortiment type selon la longueur du linéaire ----------
async function implantationView() {
  header('Implantation', { back: '/' });
  if (!state.client) {
    $view.replaceChildren(clientPicker((c) => { setClient(c); implantationView(); }, 'Implantation : sélectionnez un client'));
    return;
  }
  $view.replaceChildren(loading());
  let all;
  try {
    ({ implantations: all } = await api('/implantations'));
  } catch (e) {
    return fail(e);
  }
  const fmt = (m) => String(m).replace('.', ',') + ' m';
  const sizes = [...new Set(all.map((x) => x.meters))];
  const input = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'ex. 2', 'aria-label': 'Nombre de mètres', enterkeyhint: 'go' });
  const out = h('div', { class: 'stack' });
  const show = () => {
    const m = Math.round(Number(input.value.replace(',', '.')) * 100) / 100;
    if (!(m > 0)) return out.replaceChildren(h('p', { class: 'muted' }, 'Entrez la longueur du linéaire en mètres.'));
    const found = all.filter((x) => x.meters === m);
    if (!found.length) {
      return out.replaceChildren(empty(sizes.length
        ? `Pas d'implantation prévue pour ${fmt(m)}. Longueurs disponibles : ${sizes.map(fmt).join(', ')}.`
        : "Aucune implantation n'est encore définie."));
    }
    if (found.length === 1) return detail(found[0]);
    out.replaceChildren(h('h2', {}, `Implantations de ${fmt(m)}`),
      h('div', { class: 'rows' }, found.map((x) => h('button', { class: 'row', onclick: () => detail(x) },
        h('div', { class: 'grow' }, h('b', {}, x.name), h('small', {}, `${x.count} référence${x.count > 1 ? 's' : ''}`)), icon('chevron', 18)))));
  };
  // Détail modifiable : la liste des admins sert de base, le délégué ajuste pour ce client
  // (quantités, retraits, ajouts) avant d'envoyer le tout au panier. Le modèle d'origine n'est pas modifié.
  async function detail(x) {
    const key = `impl:${state.client.id}:${x.id}`;
    out.replaceChildren(loading());
    let base;
    try {
      base = await api(`/implantations/${x.id}?client=${state.client.id}`);
    } catch (e) {
      out.replaceChildren();
      return fail(e);
    }
    const original = base.lines.map((l) => ({ productId: l.productId, unit: l.unit, qty: l.qty }));
    let draft = store.get(key, null) || original.map((d) => ({ ...d }));
    const same = () => JSON.stringify(draft) === JSON.stringify(original);
    const save = () => (same() ? localStorage.removeItem(key) : store.set(key, draft));
    let seq = 0;

    async function render() {
      const mine = ++seq;
      let quote;
      try {
        quote = await api('/quote', { method: 'POST', body: { clientId: state.client.id, lines: draft.map((d) => ({ ...d, implantationId: x.id })) } });
      } catch (e) {
        return fail(e);
      }
      if (mine !== seq) return;
      const change = (l, qty) => {
        const i = draft.findIndex((d) => d.productId === l.productId && d.unit === l.unit);
        if (i < 0) return;
        if (qty < 1) draft.splice(i, 1);
        else draft[i].qty = qty;
        save();
        render();
      };
      const n = quote.lines.length;
      const add = h('button', { class: 'btn primary big', disabled: !n, onclick: () => {
        const cart = getCart();
        for (const l of quote.lines) {
          const item = cart.find((c) => c.productId === l.productId && c.unit === l.unit && c.implantationId === x.id);
          if (item) item.qty += l.qty;
          else cart.push({ productId: l.productId, unit: l.unit, qty: l.qty, implantationId: x.id });
        }
        setCart(cart);
        openPlans.add(x.id);
        localStorage.removeItem(key);
        flyToCart(add);
        toast(`${n} référence${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} au panier`);
        setTimeout(() => go('/panier'), 900);
      } }, icon('cart', 22), 'Tout ajouter au panier');

      // Ajout d'un article à l'implantation
      const results = h('div', { class: 'rows' });
      const search = debounce(async (query) => {
        if (!query.trim()) return results.replaceChildren();
        try {
          const { products } = await api('/products?q=' + encodeURIComponent(query));
          const list = products.filter((p) => p.priceCents != null).slice(0, 8);
          results.replaceChildren(...(list.length ? list.map((p) => h('button', { class: 'row', onclick: () => {
            const d = draft.find((e) => e.productId === p.id && e.unit === p.unit);
            if (d) d.qty += 1;
            else draft.push({ productId: p.id, unit: p.unit, qty: 1 });
            save();
            toast(`${p.ref} ajouté à l'implantation`);
            render();
          } }, h('div', { class: 'grow' }, h('b', {}, p.name), h('small', {}, `Réf. ${p.ref} · ${eur(p.priceCents)} / ${UNIT_NAMES[p.unit] || p.unit}`)), icon('plus', 20)))
            : [empty('Aucun article avec prix pour cette recherche.')]));
        } catch (e) {
          fail(e);
        }
      }, 250);

      out.replaceChildren(...[
        h('h2', {}, `${x.name} — ${fmt(x.meters)}`),
        base.implantation.extraPct ? h('div', { class: 'promo-line' }, icon('tag', 16),
          `Remise implantation : -${pctText(base.implantation.extraPct)} en plus, sur les articles prévus par le modèle`) : null,
        h('p', { class: 'muted' }, `${n} référence${n > 1 ? 's' : ''} · prix pour ${state.client.name}`,
          same() ? '' : ' · liste modifiée pour ce client'),
        h('div', { class: 'cartlines' }, n ? quote.lines.map((l) => {
          const input = h('input', { type: 'number', inputmode: 'numeric', min: 1, value: l.qty, 'aria-label': 'Quantité',
            onchange: () => change(l, Math.max(1, Math.floor(Number(input.value)) || 1)) });
          return h('div', { class: 'cartline' },
            h('div', { class: 'grow' }, lineText(l)),
            h('div', { class: 'cartline-right' },
              h('b', {}, eur(l.totalCents)),
              h('div', { class: 'stepper small' },
                h('button', { 'aria-label': l.qty > 1 ? 'Moins' : `Retirer ${l.name}`, onclick: () => change(l, l.qty - 1) }, icon(l.qty > 1 ? 'minus' : 'trash', 18)),
                input,
                h('button', { 'aria-label': 'Plus', onclick: () => change(l, l.qty + 1) }, icon('plus', 18)))));
        }) : empty('Tous les articles ont été retirés.')),
        base.unavailable.length ? h('div', { class: 'card warn' },
          h('h3', {}, `${base.unavailable.length} référence${base.unavailable.length > 1 ? 's' : ''} sans prix, non ajoutée${base.unavailable.length > 1 ? 's' : ''}`),
          base.unavailable.map((u) => h('small', {}, `${u.ref} · ${u.name} (${u.qty} × ${u.unitLabel})`))) : null,
        h('div', { class: 'card' }, h('h3', {}, 'Ajouter un article à cette implantation'),
          searchBar('Référence ou nom…', '', search), results),
        h('div', { class: 'totals' }, h('div', { class: 'total' }, h('span', {}, "Total de l'implantation (HT)"), h('b', {}, eur(quote.totalCents)))),
        add,
        same() ? null : h('button', { class: 'btn ghost', onclick: () => { draft = original.map((d) => ({ ...d })); save(); render(); } },
          "Rétablir la liste d'origine"),
      ].filter(Boolean));
    }
    render();
  }
  $view.replaceChildren(h('div', { class: 'pad' },
    orderClientBar(implantationView),
    h('h2', {}, 'Combien de mètres de linéaire ?'),
    h('form', { class: 'metersrow', onsubmit: (e) => { e.preventDefault(); input.blur(); show(); } },
      input, h('span', {}, 'm'), h('button', { class: 'btn primary', type: 'submit' }, 'Voir')),
    sizes.length ? h('div', { class: 'sizechips' }, sizes.map((m) =>
      h('button', { class: 'chipbtn', onclick: () => { input.value = String(m).replace('.', ','); show(); } }, fmt(m)))) : null,
    out));
  show();
}

// ---------- Promos ----------
async function promosView() {
  header('Promos', { back: '/' });
  $view.replaceChildren(loading());
  try {
    const { promos } = await api('/promos');
    $view.replaceChildren(h('div', { class: 'pad' }, promos.length
      ? promos.map((p) => h('button', { class: 'promo-card', onclick: () => go(`/produit/${p.productId}`) },
          h('div', { class: 'pct' }, `-${pctText(p.discountPct)}`),
          h('div', { class: 'grow' },
            h('b', {}, p.title),
            h('small', {}, `${p.productName} · Réf. ${p.ref}`),
            p.description ? h('small', {}, p.description) : null,
            h('small', { class: 'cond' }, `Quantité minimum : ${p.minQty} pièce${p.minQty > 1 ? 's' : ''}`,
              p.endsOn ? ` · jusqu'au ${frDay(p.endsOn)}` : ''))))
      : empty('Aucune promo en ce moment.')));
  } catch (e) {
    fail(e);
  }
}

// ---------- Livraisons : tournée du livreur, signature et photo à la réception ----------
async function deliveriesView() {
  header('Livraisons', { back: state.user.role === 'livreur' ? undefined : '/' });
  $view.replaceChildren(loading());
  let list;
  try {
    ({ deliveries: list } = await api('/deliveries'));
  } catch (e) {
    return fail(e);
  }
  const provinces = [...new Set(list.map((d) => d.province))].sort((a, b) => a.localeCompare(b, 'fr'));
  const place = (c) => (c.del_address || c.del_city ? [c.del_address, `${c.del_zip} ${c.del_city}`] : [c.hq_address, `${c.hq_zip} ${c.hq_city}`]).filter((x) => x.trim()).join(', ');
  $view.replaceChildren(h('div', { class: 'pad' },
    list.length ? provinces.map((pr) => {
      const rows = list.filter((d) => d.province === pr).sort((a, b) => place(a.client).localeCompare(place(b.client)));
      return [h('h3', {}, `${pr} · ${rows.length} livraison${rows.length > 1 ? 's' : ''}`),
        h('div', { class: 'rows' }, rows.map((d) => h('button', { class: 'row', onclick: () => go(`/livraison/${d.id}`) },
          h('div', { class: 'grow' }, h('b', {}, d.client.name), h('small', {}, place(d.client)),
            h('small', {}, `${d.number} · ${d.lineCount} ligne${d.lineCount > 1 ? 's' : ''}`)),
          statusChip(d), icon('chevron', 18))))];
    }) : empty('Aucune livraison en attente.')));
}

async function deliveryView(id) {
  header('Livraison', { back: '/livraisons' });
  $view.replaceChildren(loading());
  let o;
  let lines;
  try {
    ({ order: o, lines } = await api(`/orders/${id}`));
  } catch (e) {
    $view.replaceChildren(empty(e.message));
    return fail(e);
  }
  const c = o.client;
  const del = c.del_address || c.del_city;
  const tel = (v) => v && 'tel:' + v.replace(/[^+\d]/g, '');

  // Zone de signature au doigt
  const canvas = h('canvas', { class: 'sigpad', width: 900, height: 330, 'aria-label': 'Zone de signature' });
  const ctx = canvas.getContext('2d');
  let signed = false;
  const clearPad = () => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    signed = false;
  };
  clearPad();
  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
  };
  let drawing = false;
  canvas.addEventListener('pointerdown', (e) => { drawing = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...at(e)); e.preventDefault(); });
  canvas.addEventListener('pointermove', (e) => { if (!drawing) return; ctx.lineTo(...at(e)); ctx.stroke(); signed = true; e.preventDefault(); });
  canvas.addEventListener('pointerup', () => { drawing = false; });
  canvas.addEventListener('pointercancel', () => { drawing = false; });

  // Photo prise avec le téléphone, réduite avant l'envoi
  let photo = '';
  const preview = h('img', { class: 'proofphoto', alt: 'Photo de la livraison', hidden: true });
  const file = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Photo illisible.'));
        const reader = new FileReader();
        reader.onload = () => (el.src = reader.result);
        reader.onerror = () => reject(new Error('Photo illisible.'));
        reader.readAsDataURL(f);
      });
      const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      photo = cv.toDataURL('image/jpeg', 0.7);
      preview.src = photo;
      preview.hidden = false;
      photoBtn.lastChild.textContent = 'Reprendre la photo';
    } catch (e) {
      toast(e.message, 'err');
    }
  } });
  const photoBtn = h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, icon('camera', 20), 'Prendre une photo');
  const name = h('input', { type: 'text', autocomplete: 'off', placeholder: 'Nom de la personne qui réceptionne' });
  const error = h('p', { class: 'error', role: 'alert' });
  const send = h('button', { class: 'btn primary big', onclick: async () => {
    error.textContent = '';
    if (!name.value.trim()) return (error.textContent = 'Indiquez le nom de la personne qui reçoit la marchandise.');
    if (!signed) return (error.textContent = 'Faites signer dans le cadre avant de valider.');
    send.disabled = true;
    try {
      await api(`/deliveries/${o.id}/proof`, { method: 'POST', body: { receivedBy: name.value, signature: canvas.toDataURL('image/png'), photo } });
      toast('Livraison enregistrée');
      replacePath('/livraisons');
    } catch (e) {
      send.disabled = false;
      if (e.status === 401) return fail(e);
      error.textContent = e.message;
    }
  } }, icon('check', 22), 'Valider la livraison');

  const pending = ['preparation', 'expediee'].includes(o.status);
  $view.replaceChildren(h('div', { class: 'pad' }, ...[
    h('div', { class: 'card' },
      h('div', { class: 'spread' }, h('h2', {}, c.name), statusChip(o)),
      h('p', {}, [del ? c.del_address : c.hq_address, del ? `${c.del_zip} ${c.del_city}` : `${c.hq_zip} ${c.hq_city}`].filter((x) => x.trim()).join(', ')),
      c.hours ? h('p', { class: 'muted' }, `Horaires : ${c.hours}`) : null,
      c.manager_name || c.phone ? h('p', { class: 'muted' }, 'Contact : ', [c.manager_name, c.manager_phone || c.phone].filter(Boolean).join(' · ')) : null,
      h('p', { class: 'muted' }, `${o.number} · ${o.province}`),
      o.note ? h('p', { class: 'note' }, o.note) : null),
    h('div', { class: 'cartlines' }, lines.map((l) => h('div', { class: 'cartline' },
      h('div', { class: 'grow' }, h('b', {}, l.name), h('small', {}, `Réf. ${l.ref}${l.implantationName ? ' · implantation ' + l.implantationName : ''}`)),
      h('b', {}, `${l.qty} × ${l.unitLabel.toLowerCase()}`)))),
    pending ? h('div', { class: 'card stack' },
      h('h3', {}, 'Réception de la marchandise'),
      field('Reçu par', name),
      h('div', { class: 'spread' }, h('span', { class: 'muted' }, 'Signature'), h('button', { class: 'linkbtn', type: 'button', onclick: clearPad }, 'Effacer')),
      canvas,
      file, photoBtn, preview,
      error, send) : h('div', { class: 'card' }, h('p', {}, 'Cette livraison est déjà enregistrée.')),
  ].filter(Boolean)));
}

// ---------- Compte ----------
function accountView() {
  header('Mon compte', { back: '/' });
  const u = state.user;
  $view.replaceChildren(h('div', { class: 'pad' },
    h('div', { class: 'card center' },
      h('div', { class: 'avatar' }, icon('user', 40)),
      h('h2', {}, u.name || u.username),
      h('p', { class: 'muted' }, `${u.username} · ${{ admin: 'Administrateur', livreur: 'Livreur' }[u.role] || 'Délégué'}`)),
    state.client ? h('div', { class: 'card' }, h('h3', {}, 'Client en cours'), h('p', {}, state.client.name),
      h('button', { class: 'btn ghost', onclick: () => { setClient(null); accountView(); } }, 'Changer de client')) : null,
    h('button', { class: 'btn ghost danger', onclick: async () => {
      if (!(await ask('Se déconnecter ?', 'Se déconnecter'))) return;
      await api('/logout', { method: 'POST' }).catch(() => {});
      // Retour à l'accueil pour la prochaine connexion
      if (DEMO) trail.splice(0, trail.length, '/');
      else history.replaceState(null, '', location.pathname);
      showLogin();
    } }, 'Se déconnecter')));
}

// ---------- Démarrage ----------
(async function start() {
  if (!DEMO && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try {
    state.user = (await api('/me')).user;
  } catch {
    $view.replaceChildren(empty('Connexion au serveur impossible.'),
      h('div', { class: 'pad' }, h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Réessayer')));
    return;
  }
  route();
})();
