import { h, api, eur, frDate, frDay, pctText } from '/shared/ui.js';
import { ean13Svg } from '/shared/ean.js';

const root = document.getElementById('root');
let me = null;
let tab = 'commandes';

const UNITS = [['piece', 'Pièce'], ['boite', 'Boîte'], ['carton', 'Carton'], ['palette', 'Palette']];
const STATUSES = [['recue', 'Reçue'], ['preparation', 'En préparation'], ['expediee', 'Expédiée'], ['livree', 'Livrée'], ['annulee', 'Annulée']];

// Montants : saisie « 12,50 » <-> centimes
const euroIn = (cents) => (cents == null ? '' : (cents / 100).toFixed(2).replace('.', ','));
const euroOut = (text) => {
  const n = Number(String(text).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
const num = (text) => Number(String(text).replace(',', '.')) || 0;

const f = (label, input) => h('label', { class: 'f' }, label, input);
const text = (value, attrs = {}) => h('input', { type: 'text', value: value ?? '', ...attrs });
const area = (value, rows = 3) => h('textarea', { rows, value: value ?? '' });
const check = (label, checked) => {
  const input = h('input', { type: 'checkbox', checked: !!checked });
  return { input, el: h('label', { class: 'check' }, input, label) };
};
const select = (options, value, attrs = {}) =>
  h('select', attrs, options.map(([v, label]) => h('option', { value: v ?? '', selected: String(v ?? '') === String(value ?? '') }, label)));

function table(headers, rows, emptyText = 'Aucun élément.') {
  return h('div', { class: 'tablewrap' }, h('table', {},
    h('thead', {}, h('tr', {}, headers.map((x) => (typeof x === 'string' ? h('th', {}, x) : h('th', { class: 'num' }, x.num))))),
    h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { class: 'empty', colspan: headers.length }, emptyText)))));
}

// Fenêtre d'édition. onSave() peut lever une erreur (affichée en bas de la fenêtre).
function modal(title, body, { onSave, saveLabel = 'Enregistrer', extra = [] } = {}) {
  const error = h('span', { class: 'error' });
  const save = onSave ? h('button', { class: 'btn primary', type: 'submit' }, saveLabel) : null;
  const dlg = h('dialog', {},
    h('form', { method: 'dialog', onsubmit: async (e) => {
      e.preventDefault();
      if (!onSave) return dlg.close();
      save.disabled = true;
      error.textContent = '';
      try {
        await onSave();
        dlg.close();
      } catch (err) {
        error.textContent = err.message;
        save.disabled = false;
      }
    } },
      h('div', { class: 'head' }, h('h3', {}, title)),
      h('div', { class: 'body' }, body),
      h('div', { class: 'foot' }, error, extra,
        h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, onSave ? 'Annuler' : 'Fermer'), save)));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

const oops = (e) => {
  if (e.status === 401) return login();
  modal('Action impossible', h('p', {}, e.message));
};

// Confirmation intégrée à la page.
function ask(text, okLabel = 'Confirmer') {
  return new Promise((resolve) => {
    let ok = false;
    const dlg = modal('Confirmation', h('p', { style: { whiteSpace: 'pre-line' } }, text), { saveLabel: okLabel, onSave: async () => { ok = true; } });
    dlg.addEventListener('close', () => resolve(ok));
  });
}

// Lien de téléchargement (PDF, Excel). Dans la page de démonstration, le fichier est fabriqué sur place.
const DEMO = window.__DEMO__;
function fileLink(cls, url, label) {
  if (!DEMO) return h('a', { class: cls, href: url }, label);
  return h('button', { class: cls, type: 'button', onclick: () => DEMO.download(url).catch(oops) }, label);
}

// ---------- Connexion ----------
function login(message = '') {
  me = null;
  const user = text('', { autocomplete: 'username', required: true });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const error = h('p', { class: 'error' }, message);
  root.replaceChildren(h('div', { class: 'login' }, h('form', { onsubmit: async (e) => {
    e.preventDefault();
    try {
      const r = await api('/login', { method: 'POST', body: { username: user.value, password: pass.value } });
      if (r.user.role !== 'admin') {
        await api('/logout', { method: 'POST' });
        throw new Error("Cette interface est réservée aux administrateurs.");
      }
      me = r.user;
      shell();
    } catch (err) {
      error.textContent = err.message;
    }
  } },
    h('h1', {}, 'Administration des commandes'),
    f("Nom d'utilisateur", user), f('Mot de passe', pass), error,
    h('button', { class: 'btn primary', type: 'submit' }, 'Se connecter'),
    DEMO ? h('p', { class: 'muted' }, 'Démonstration : entrez n\'importe quel nom et mot de passe. Les modifications restent sur cet appareil.') : null)));
}

// ---------- Structure ----------
const TABS = {
  commandes: ['Commandes', ordersTab],
  articles: ['Articles et prix', productsTab],
  categories: ['Catégories', categoriesTab],
  clients: ['Clients et remises', clientsTab],
  promos: ['Promos', promosTab],
  utilisateurs: ['Identifiants', usersTab],
  parametres: ['Paramètres', settingsTab],
};
let main;
function shell() {
  main = h('main', {});
  const nav = h('nav', {}, Object.entries(TABS).map(([key, [label]]) =>
    h('button', { class: key === tab ? 'on' : '', onclick: () => { tab = key; shell(); } }, label)));
  root.replaceChildren(
    h('header', { class: 'bar' }, h('h1', {}, 'Commandes Bormann'), nav,
      h('div', { class: 'who' }, me.name || me.username,
        h('button', { onclick: async () => { await api('/logout', { method: 'POST' }).catch(() => {}); login(); } }, 'Déconnexion'))),
    main);
  TABS[tab][1]().catch(oops);
}
const reload = () => TABS[tab][1]().catch(oops);

// ---------- Commandes ----------
const orderFilter = { status: '', q: '' };
async function ordersTab() {
  const params = new URLSearchParams(orderFilter);
  const { orders } = await api('/orders?' + params);
  const search = h('input', { type: 'search', placeholder: 'N° de commande, client, délégué…', value: orderFilter.q,
    onchange: () => { orderFilter.q = search.value; reload(); } });
  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('h2', {}, 'Commandes reçues'),
      search,
      select([['', 'Tous les statuts'], ...STATUSES], orderFilter.status, { onchange: (e) => { orderFilter.status = e.target.value; reload(); } }),
      fileLink('btn', '/api/admin/orders/export?' + params, 'Exporter en Excel'),
      h('button', { class: 'btn', onclick: reload }, 'Actualiser')),
    table(['N°', 'Date', 'Client', 'Délégué', { num: 'Total HT' }, 'Statut', 'PDF'], orders.map((o) =>
      h('tr', { class: 'click', onclick: () => orderModal(o.id).catch(oops) },
        h('td', {}, h('b', {}, o.number)),
        h('td', {}, frDate(o.createdAt)),
        h('td', {}, o.client.name, h('div', { class: 'muted' }, [o.client.number, o.client.hq_city].filter(Boolean).join(' · '))),
        h('td', {}, o.userName),
        h('td', { class: 'num' }, eur(o.totalCents)),
        h('td', { onclick: (e) => e.stopPropagation() },
          select(STATUSES, o.status, { onchange: async (e) => {
            await api(`/admin/orders/${o.id}`, { method: 'PATCH', body: { status: e.target.value } }).catch(oops);
          } })),
        h('td', { onclick: (e) => e.stopPropagation() },
          fileLink('btn small', `/api/orders/${o.id}/pdf?dl=1`, 'Télécharger')))),
      'Aucune commande.'));
}

async function orderModal(id) {
  const { order: o, lines } = await api(`/orders/${id}`);
  const c = o.client;
  const hasDel = c.del_address || c.del_city;
  const vat = Math.round((o.totalCents * o.vatPct) / 100);
  modal(`Commande ${o.number}`, [
    h('p', { class: 'muted' }, `${frDate(o.createdAt)} · Délégué : ${o.userName} · `, h('span', { class: `chip st-${o.status}` }, o.statusLabel)),
    h('div', { class: 'cols' },
      h('fieldset', {}, h('legend', {}, 'Client — siège social'), h('div', { class: 'addr' },
        [c.name, c.hq_address, `${c.hq_zip} ${c.hq_city}`.trim(), c.vat && `TVA : ${c.vat}`, c.number && `N° client : ${c.number}`, c.phone, c.email].filter(Boolean).join('\n'))),
      h('fieldset', {}, h('legend', {}, 'Livraison'), h('div', { class: 'addr' },
        [c.name, hasDel ? c.del_address : c.hq_address, (hasDel ? `${c.del_zip} ${c.del_city}` : `${c.hq_zip} ${c.hq_city}`).trim(),
          c.hours && `Horaires : ${c.hours}`, c.manager_name && `Contact : ${c.manager_name} ${c.manager_phone}`].filter(Boolean).join('\n')))),
    table(['Réf.', 'Désignation', { num: 'Qté' }, 'Unité', { num: 'PU HT' }, { num: 'Remise' }, { num: 'Total HT' }], lines.map((l) => h('tr', {},
      h('td', {}, l.ref), h('td', {}, l.name), h('td', { class: 'num' }, l.qty),
      h('td', {}, l.unitQty > 1 ? `${l.unitLabel} (${l.unitQty} pcs)` : l.unitLabel),
      h('td', { class: 'num' }, eur(l.netCents)),
      h('td', { class: 'num' }, l.discountPct ? pctText(l.discountPct) + (l.promo ? ' promo' : '') : ''),
      h('td', { class: 'num' }, eur(l.totalCents))))),
    h('div', { class: 'totals' },
      h('div', {}, h('span', {}, 'Total HT'), h('span', {}, eur(o.totalCents))),
      h('div', {}, h('span', {}, `TVA ${pctText(o.vatPct)}`), h('span', {}, eur(vat))),
      h('div', { class: 'big' }, h('span', {}, 'Total TTC'), h('span', {}, eur(o.totalCents + vat)))),
    o.note ? h('div', { class: 'notice' }, h('b', {}, 'Remarque : '), o.note) : null,
  ], { extra: [
    DEMO ? null : h('a', { class: 'btn', href: `/api/orders/${o.id}/pdf`, target: '_blank', rel: 'noopener' }, 'Ouvrir le PDF'),
    fileLink('btn', `/api/admin/orders/export?id=${o.id}`, 'Excel'),
    fileLink('btn primary', `/api/orders/${o.id}/pdf?dl=1`, 'Télécharger le PDF'),
  ] });
}

// ---------- Articles ----------
const productFilter = { q: '', category: '' };
async function productsTab() {
  const [{ products }, { categories }] = await Promise.all([
    api('/admin/products?' + new URLSearchParams(productFilter)), api('/categories')]);
  const search = h('input', { type: 'search', placeholder: 'Référence, nom, code-barres…', value: productFilter.q,
    onchange: () => { productFilter.q = search.value; reload(); } });
  const file = importInput('/admin/products/import', (r) => [
    `${r.created} article(s) créé(s), ${r.updated} mis à jour.`,
    r.noPrice ? ` ${r.noPrice} ligne(s) sans prix : fiche conservée, pas de tarif.` : '']);
  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('h2', {}, 'Articles et prix'), search,
      select([['', 'Toutes les catégories'], ...categories.map((c) => [c.id, c.name])], productFilter.category,
        { onchange: (e) => { productFilter.category = e.target.value; reload(); } }),
      file,
      h('button', { class: 'btn', onclick: importHelp }, 'Format du fichier'),
      fileLink('btn', '/api/admin/products/export', 'Exporter en Excel'),
      h('button', { class: 'btn', onclick: () => file.click() }, 'Importer un fichier Excel'),
      h('button', { class: 'btn primary', onclick: () => productModal(null, categories) }, 'Nouvel article')),
    table(['Référence', 'Code', 'Nom', 'Catégorie', { num: 'Prix pièce HT' }, 'État'], products.map((p) =>
      h('tr', { class: 'click' + (p.active ? '' : ' off'), onclick: () => productModal(p.id, categories).catch(oops) },
        h('td', {}, h('b', {}, p.ref)), h('td', {}, p.code), h('td', {}, p.name), h('td', {}, p.category || '—'),
        h('td', { class: 'num' }, p.priceCents != null ? eur(p.priceCents) : h('span', { class: 'chip' }, 'Sans prix')),
        h('td', {}, p.active ? 'Actif' : 'Désactivé'))), 'Aucun article.'),
    products.length >= 300 ? h('p', { class: 'muted' }, 'Affichage limité à 300 articles : affinez la recherche.') : null);
}

// Bouton d'import : fichier Excel (.xlsx) ou CSV, envoyé au serveur puis compte rendu.
function importInput(url, summary) {
  const file = h('input', { type: 'file', accept: '.xlsx,.csv', hidden: true, onchange: async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    try {
      let body;
      if (/\.csv$/i.test(f.name)) body = { csv: await f.text() };
      else if (/\.xlsx$/i.test(f.name)) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        body = { xlsx: btoa(bin) };
      } else throw new Error('Format non reconnu : choisissez un fichier .xlsx ou .csv (un ancien .xls doit être réenregistré en .xlsx).');
      const r = await api(url, { method: 'POST', body });
      modal('Import terminé', [
        h('div', { class: 'notice ok' }, summary(r)),
        r.errors.length ? h('div', { class: 'notice' }, h('b', {}, `${r.errors.length} ligne(s) ignorée(s) :`), h('pre', {}, r.errors.join('\n'))) : null]);
      reload();
    } catch (e) {
      oops(e);
    }
  } });
  return file;
}

function importHelp() {
  const sample = 'ref;code;nom;categorie;description;unite;qte;prix;ean;caracteristiques\n' +
    'ABC123;012345;Tournevis plat 5,5 x 100;Tournevis;Lame Cr-V;piece;1;3,90;5200000000011;Empreinte: Plate | Longueur: 100 mm\n' +
    'ABC123;;;;;boite;10;37,00;5200000000028;\n' +
    'ABC123;;;;;carton;60;210,00;5200000000035;\n';
  modal('Format du fichier (Excel ou CSV)', [
    h('p', {}, 'Fichier Excel (.xlsx) ou CSV, première ligne = noms des colonnes. Une ligne par article et par conditionnement. ',
      'Un article déjà existant (même référence) est mis à jour ; ses prix sont remplacés par ceux du fichier. ',
      'Le plus simple : « Exporter en Excel », compléter les colonnes prix et ean, puis réimporter le fichier.'),
    h('ul', {},
      h('li', {}, h('b', {}, 'ref'), ' (obligatoire), ', h('b', {}, 'code'), ' (code article du fournisseur), ', h('b', {}, 'nom'), ' (obligatoire pour un nouvel article), ', h('b', {}, 'categorie'), ', ', h('b', {}, 'description')),
      h('li', {}, h('b', {}, 'unite'), ' : piece, boite, carton ou palette — ', h('b', {}, 'qte'), ' : nombre de pièces dans ce conditionnement'),
      h('li', {}, h('b', {}, 'prix'), ' : prix HT du conditionnement entier — ', h('b', {}, 'ean'), ' : code-barres de ce conditionnement'),
      h('li', {}, h('b', {}, 'caracteristiques'), ' : « Nom: valeur | Nom: valeur » — ', h('b', {}, 'image'), ' : adresse https d\'une photo')),
    h('pre', {}, sample),
    h('p', { class: 'muted' }, 'Exemple (les mêmes colonnes dans Excel) :'),
  ]);
}

async function productModal(id, categories) {
  const p = id ? (await api(`/admin/products/${id}`)).product : { specs: [], units: [{ unit: 'piece', qty: 1, priceCents: 0, ean: '' }], active: true };
  const ref = text(p.ref, { required: true });
  const name = text(p.name, { required: true });
  const code = text(p.code, { placeholder: 'Code fournisseur' });
  const cat = select([['', '— Aucune —'], ...categories.map((c) => [c.id, c.name])], p.categoryId);
  const desc = area(p.description, 3);
  const specs = area(p.specs.map(([k, v]) => (v ? `${k}: ${v}` : k)).join('\n'), 6);
  const image = text(p.imageUrl, { placeholder: 'https://…' });
  const active = check('Article actif (visible dans l\'application)', p.active);
  const rows = UNITS.map(([unit, label]) => {
    const u = p.units.find((x) => x.unit === unit);
    const on = h('input', { type: 'checkbox', checked: !!u });
    const qty = h('input', { type: 'number', min: 1, value: u ? u.qty : unit === 'piece' ? 1 : '', disabled: unit === 'piece' });
    const price = text(u ? euroIn(u.priceCents) : '', { inputmode: 'decimal', placeholder: '0,00' });
    const ean = text(u?.ean, { placeholder: 'Code-barres' });
    return { unit, label, on, qty, price, ean };
  });
  const barcodes = h('div', { class: 'barcodes' });
  const drawBarcodes = () => barcodes.replaceChildren(...rows.filter((r) => r.on.checked).map((r) => {
    const svg = ean13Svg(r.ean.value.trim());
    return svg ? h('figure', {}, svg, h('figcaption', {}, r.label)) : null;
  }).filter(Boolean));
  drawBarcodes();
  modal(id ? `Article ${p.ref}` : 'Nouvel article', [
    h('div', { class: 'grid4' }, f('Référence *', ref), f('Code article', code), f('Catégorie', cat), f('Photo (adresse https)', image)),
    f('Nom *', name),
    f('Description', desc),
    f('Fiche technique — une caractéristique par ligne, « Nom: valeur » (une ligne sans « : » devient un sous-titre)', specs),
    h('fieldset', {}, h('legend', {}, 'Conditionnements et prix HT'),
      h('table', { class: 'units' },
        h('thead', {}, h('tr', {}, ['', 'Conditionnement', 'Nombre de pièces', 'Prix HT du conditionnement (€)', 'Code-barres (EAN)'].map((x) => h('th', {}, x)))),
        h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, r.on), h('td', {}, r.label), h('td', {}, r.qty), h('td', {}, r.price),
          h('td', {}, r.ean))))),
      h('div', {}, h('button', { class: 'btn small', type: 'button', onclick: drawBarcodes }, 'Afficher les codes-barres')),
      barcodes,
      h('p', { class: 'muted' }, 'Les codes-barres EAN-13 valides s\'affichent ici : vous pouvez les scanner à l\'écran avec l\'application pour tester.')),
    active.el,
  ], { onSave: async () => {
    const units = rows.filter((r) => r.on.checked).map((r) => {
      const priceCents = euroOut(r.price.value);
      if (priceCents == null || r.price.value.trim() === '') throw new Error(`Prix invalide pour « ${r.label} ».`);
      return { unit: r.unit, qty: Number(r.qty.value) || 1, priceCents, ean: r.ean.value.trim() };
    });
    const body = { ref: ref.value, code: code.value, name: name.value, categoryId: cat.value || null, description: desc.value, imageUrl: image.value,
      active: active.input.checked, units,
      specs: specs.value.split('\n').map((l) => l.split(/:(.*)/s).slice(0, 2).map((x) => (x || '').trim())).filter((s) => s[0]).map((s) => [s[0], s[1] || '']) };
    await api(id ? `/admin/products/${id}` : '/admin/products', { method: id ? 'PUT' : 'POST', body });
    reload();
  } });
}

// ---------- Catégories ----------
async function categoriesTab() {
  const { categories } = await api('/categories');
  const name = text('', { placeholder: 'Nouvelle catégorie' });
  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('h2', {}, 'Catégories'), name,
      h('button', { class: 'btn primary', onclick: async () => {
        await api('/admin/categories', { method: 'POST', body: { name: name.value, sort: categories.length } }).then(reload, oops);
      } }, 'Ajouter')),
    table(['Nom', 'Ordre d\'affichage', { num: 'Articles' }, ''], categories.map((c) => {
      const n = text(c.name);
      const s = h('input', { type: 'number', value: c.sort, style: { width: '90px' } });
      return h('tr', {}, h('td', {}, n), h('td', {}, s), h('td', { class: 'num' }, c.count),
        h('td', { class: 'num' },
          h('button', { class: 'btn small', onclick: () => api(`/admin/categories/${c.id}`, { method: 'PUT', body: { name: n.value, sort: Number(s.value) } }).then(reload, oops) }, 'Enregistrer'), ' ',
          h('button', { class: 'btn small danger', disabled: c.count > 0, title: c.count ? 'Catégorie non vide' : '',
            onclick: async () => (await ask(`Supprimer la catégorie « ${c.name} » ?`, 'Supprimer')) && api(`/admin/categories/${c.id}`, { method: 'DELETE' }).then(reload, oops) }, 'Supprimer')));
    })));
}

// ---------- Clients ----------
let clientQuery = '';
async function clientsTab() {
  const [{ clients }, { users }] = await Promise.all([api('/clients?q=' + encodeURIComponent(clientQuery)), api('/admin/users')]);
  const search = h('input', { type: 'search', placeholder: 'Nom, TVA, n° client, ville…', value: clientQuery, onchange: () => { clientQuery = search.value; reload(); } });
  const clientFile = importInput('/admin/clients/import', (r) => `${r.created} client(s) créé(s), ${r.updated} mis à jour.`);
  const userName = (id) => users.find((u) => u.id === id)?.name || users.find((u) => u.id === id)?.username || 'Tous';
  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('h2', {}, 'Clients et remises'), search,
      clientFile,
      fileLink('btn', '/api/admin/clients/export', 'Exporter en Excel'),
      h('button', { class: 'btn', onclick: () => clientFile.click() }, 'Importer un fichier Excel'),
      h('button', { class: 'btn primary', onclick: () => clientModal(null, users).catch(oops) }, 'Nouveau client')),
    table(['N°', 'Nom', 'TVA', 'Localité', 'Délégué', { num: 'Remise générale' }, 'État'], clients.map((c) =>
      h('tr', { class: 'click' + (c.active ? '' : ' off'), onclick: () => clientModal(c.id, users).catch(oops) },
        h('td', {}, c.number), h('td', {}, h('b', {}, c.name)), h('td', {}, c.vat), h('td', {}, `${c.hq_zip} ${c.hq_city}`),
        h('td', {}, userName(c.delegateId)), h('td', { class: 'num' }, pctText(c.discountPct)), h('td', {}, c.active ? 'Actif' : 'Désactivé'))),
      'Aucun client.'));
}

async function clientModal(id, users) {
  const [data, { categories }] = await Promise.all([id ? api(`/clients/${id}`) : { client: { active: true, discountPct: 0 }, discounts: [] }, api('/categories')]);
  const c = data.client;
  const inp = {};
  const t = (key, label, attrs) => f(label, (inp[key] = text(c[key], attrs)));
  const ta = (key, label, rows) => f(label, (inp[key] = area(c[key], rows)));
  const discount = text(String(c.discountPct ?? 0).replace('.', ','), { inputmode: 'decimal' });
  const franco = text(euroIn(c.francoCents), { inputmode: 'decimal', placeholder: 'Franco général' });
  const delegate = select([['', 'Tous les délégués'], ...users.filter((u) => u.active).map((u) => [u.id, u.name || u.username])], c.delegateId);
  const active = check('Client actif', c.active);
  const list = h('tbody', {});
  const lines = [];
  const addLine = (d = { kind: 'category', pct: '' }) => {
    const line = {};
    line.kind = select([['category', 'Catégorie'], ['product', 'Article']], d.kind, { onchange: () => draw() });
    line.cat = select(categories.map((x) => [x.id, x.name]), d.kind === 'category' ? d.targetId : '');
    line.ref = text(d.kind === 'product' ? (d.label || '').split(' — ')[0] : '', { placeholder: 'Référence article' });
    line.pct = text(d.pct === '' ? '' : String(d.pct).replace('.', ','), { inputmode: 'decimal', placeholder: '%' });
    line.target = h('td', {});
    line.row = h('tr', {}, h('td', {}, line.kind), line.target, h('td', {}, line.pct),
      h('td', {}, h('button', { class: 'btn small danger', type: 'button', onclick: () => { lines.splice(lines.indexOf(line), 1); line.row.remove(); } }, 'Retirer')));
    const draw = () => line.target.replaceChildren(line.kind.value === 'category' ? line.cat : line.ref);
    draw();
    lines.push(line);
    list.append(line.row);
  };
  (data.discounts || []).forEach(addLine);
  modal(id ? c.name : 'Nouveau client', [
    h('div', { class: 'grid3' }, t('name', 'Nom de la société *', { required: true }), t('vat', 'Numéro de TVA'), t('number', 'Numéro client', { placeholder: 'Automatique si vide' })),
    h('div', { class: 'cols' },
      h('fieldset', {}, h('legend', {}, 'Siège social'), t('hq_address', 'Rue et numéro'), h('div', { class: 'grid2' }, t('hq_zip', 'Code postal'), t('hq_city', 'Localité'))),
      h('fieldset', {}, h('legend', {}, 'Livraison (vide = siège social)'), t('del_address', 'Rue et numéro'), h('div', { class: 'grid2' }, t('del_zip', 'Code postal'), t('del_city', 'Localité')))),
    h('div', { class: 'grid3' }, t('phone', 'Téléphone'), t('email', 'E-mail'), t('hours', 'Horaires du magasin')),
    h('div', { class: 'grid2' }, t('manager_name', 'Gérant / responsable'), t('manager_phone', 'Téléphone du responsable')),
    h('div', { class: 'grid4' }, t('accounting_name', 'Contact comptabilité'), t('accounting_phone', 'Tél. comptabilité'), t('accounting_email', 'E-mail comptabilité'), t('iban', 'Compte bancaire (IBAN)')),
    ta('notes', 'Informations complémentaires', 2),
    h('fieldset', {}, h('legend', {}, 'Conditions commerciales'),
      h('div', { class: 'grid3' }, f('Remise générale (%)', discount), f('Franco spécifique (€ HT)', franco), f('Délégué attitré', delegate)),
      h('p', { class: 'muted' }, 'Remises particulières : la remise sur un article prime sur celle de sa catégorie, qui prime sur la remise générale.'),
      h('table', { class: 'units' }, h('thead', {}, h('tr', {}, ['Type', 'Catégorie / article', 'Remise (%)', ''].map((x) => h('th', {}, x)))), list),
      h('div', {}, h('button', { class: 'btn small', type: 'button', onclick: () => addLine() }, 'Ajouter une remise particulière'))),
    active.el,
  ], { onSave: async () => {
    const body = Object.fromEntries(Object.entries(inp).map(([k, el]) => [k, el.value]));
    body.discountPct = num(discount.value);
    body.francoCents = franco.value.trim() === '' ? null : euroOut(franco.value);
    body.delegateId = delegate.value || null;
    body.active = active.input.checked;
    body.discounts = lines.map((l) => (l.kind.value === 'category'
      ? { kind: 'category', targetId: Number(l.cat.value), pct: num(l.pct.value) }
      : { kind: 'product', ref: l.ref.value.trim(), pct: num(l.pct.value) }));
    await api(id ? `/clients/${id}` : '/clients', { method: id ? 'PUT' : 'POST', body });
    reload();
  } });
}

// ---------- Promos ----------
async function promosTab() {
  const { promos } = await api('/admin/promos');
  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('h2', {}, 'Promos'), h('button', { class: 'btn primary', onclick: () => promoModal(null) }, 'Nouvelle promo')),
    table(['Titre', 'Article', { num: 'Qté min. (pièces)' }, { num: 'Remise' }, 'Validité', 'État'], promos.map((p) =>
      h('tr', { class: 'click' + (p.active ? '' : ' off'), onclick: () => promoModal(p) },
        h('td', {}, h('b', {}, p.title)), h('td', {}, `${p.ref} — ${p.productName}`), h('td', { class: 'num' }, p.minQty),
        h('td', { class: 'num' }, pctText(p.discountPct)),
        h('td', {}, [p.startsOn && `du ${frDay(p.startsOn)}`, p.endsOn && `au ${frDay(p.endsOn)}`].filter(Boolean).join(' ') || 'Sans limite'),
        h('td', {}, p.active ? 'Active' : 'Désactivée'))), 'Aucune promo.'));
}
function promoModal(p) {
  const d = p || { active: true, minQty: 1 };
  const title = text(d.title, { required: true });
  const ref = text(d.ref, { required: true, placeholder: 'Référence exacte' });
  const desc = area(d.description, 2);
  const min = h('input', { type: 'number', min: 1, value: d.minQty });
  const pct = text(d.discountPct != null ? String(d.discountPct).replace('.', ',') : '', { inputmode: 'decimal', required: true });
  const from = h('input', { type: 'date', value: d.startsOn || '' });
  const to = h('input', { type: 'date', value: d.endsOn || '' });
  const active = check('Promo active', d.active);
  modal(p ? 'Modifier la promo' : 'Nouvelle promo', [
    h('div', { class: 'grid2' }, f('Titre *', title), f('Référence de l\'article *', ref)),
    f('Description', desc),
    h('div', { class: 'grid4' }, f('Quantité minimum (pièces)', min), f('Remise (%)', pct), f('Début', from), f('Fin', to)),
    h('p', { class: 'muted' }, 'La promo remplace la remise du client quand elle est plus avantageuse ; les deux ne se cumulent pas.'),
    active.el,
  ], {
    onSave: async () => {
      const body = { title: title.value, ref: ref.value.trim(), description: desc.value, minQty: Number(min.value), discountPct: num(pct.value),
        startsOn: from.value, endsOn: to.value, active: active.input.checked };
      await api(p ? `/admin/promos/${p.id}` : '/admin/promos', { method: p ? 'PUT' : 'POST', body });
      reload();
    },
    extra: p ? [h('button', { class: 'btn danger', type: 'button', onclick: async (e) => {
      const dlg = e.target.closest('dialog');
      if (!(await ask('Supprimer cette promo ?', 'Supprimer'))) return;
      await api(`/admin/promos/${p.id}`, { method: 'DELETE' }).catch(oops);
      dlg.close();
      reload();
    } }, 'Supprimer')] : [],
  });
}

// ---------- Utilisateurs ----------
async function usersTab() {
  const { users } = await api('/admin/users');
  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('h2', {}, 'Identifiants'), h('button', { class: 'btn primary', onclick: () => userModal(null) }, 'Nouvel identifiant')),
    table(["Nom d'utilisateur", 'Nom', 'Rôle', 'État'], users.map((u) =>
      h('tr', { class: 'click' + (u.active ? '' : ' off'), onclick: () => userModal(u) },
        h('td', {}, h('b', {}, u.username)), h('td', {}, u.name), h('td', {}, u.role === 'admin' ? 'Administrateur' : 'Délégué'),
        h('td', {}, u.active ? 'Actif' : 'Désactivé')))),
    h('p', { class: 'muted', style: { marginTop: '12px' } },
      'Les délégués utilisent l\'application mobile. Seuls les administrateurs accèdent à cette interface et peuvent modifier les prix et les remises.'));
}
function userModal(u) {
  const username = text(u?.username, { required: true, disabled: !!u });
  const name = text(u?.name);
  const role = select([['delegue', 'Délégué (application mobile)'], ['admin', 'Administrateur (interface PC + application)']], u?.role || 'delegue');
  const pass = h('input', { type: 'password', autocomplete: 'new-password', required: !u, minlength: 8, placeholder: u ? 'Laisser vide pour ne pas changer' : '8 caractères minimum' });
  const active = check('Compte actif', u ? u.active : true);
  modal(u ? `Identifiant ${u.username}` : 'Nouvel identifiant', [
    h('div', { class: 'grid2' }, f("Nom d'utilisateur *", username), f('Nom complet', name)),
    h('div', { class: 'grid2' }, f('Rôle', role), f(u ? 'Nouveau mot de passe' : 'Mot de passe *', pass)),
    u ? active.el : null,
  ], { onSave: async () => {
    const body = { username: username.value, name: name.value, role: role.value, active: active.input.checked };
    if (pass.value) body.password = pass.value;
    await api(u ? `/admin/users/${u.id}` : '/admin/users', { method: u ? 'PUT' : 'POST', body });
    reload();
  }, extra: u && u.id !== me.id ? [h('button', { class: 'btn danger', type: 'button', onclick: async (e) => {
    const dlg = e.target.closest('dialog');
    if (!(await ask(`Supprimer définitivement l'identifiant « ${u.username} » ?\nSes commandes et ses clients sont conservés.`, 'Supprimer'))) return;
    try {
      await api(`/admin/users/${u.id}`, { method: 'DELETE' });
      dlg.close();
      reload();
    } catch (err) {
      oops(err);
    }
  } }, 'Supprimer cet identifiant')] : [] });
}

// ---------- Paramètres ----------
async function settingsTab() {
  const { settings: s } = await api('/admin/settings');
  const franco = text(euroIn(Number(s.franco_cents)), { inputmode: 'decimal' });
  const blocking = check('Empêcher l\'envoi d\'une commande tant que le franco n\'est pas atteint', s.franco_blocking === '1');
  const vat = text(String(s.vat_pct).replace('.', ','), { inputmode: 'decimal' });
  const company = { company_name: text(s.company_name), company_address: area(s.company_address, 3), company_vat: text(s.company_vat),
    company_phone: text(s.company_phone), company_email: text(s.company_email) };
  const status = h('span', { class: 'muted' });
  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('h2', {}, 'Paramètres')),
    h('form', { class: 'panel', onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api('/admin/settings', { method: 'PUT', body: { franco_cents: euroOut(franco.value) ?? 0, franco_blocking: blocking.input.checked,
          vat_pct: num(vat.value), ...Object.fromEntries(Object.entries(company).map(([k, el]) => [k, el.value])) } });
        status.textContent = 'Enregistré.';
      } catch (err) {
        oops(err);
      }
    } },
      h('fieldset', {}, h('legend', {}, 'Commandes'),
        h('div', { class: 'grid2' }, f('Franco général (€ HT)', franco), f('Taux de TVA (%)', vat)), blocking.el),
      h('fieldset', {}, h('legend', {}, 'Votre société (en-tête des bons de commande PDF)'),
        f('Nom', company.company_name), f('Adresse', company.company_address),
        h('div', { class: 'grid3' }, f('N° de TVA', company.company_vat), f('Téléphone', company.company_phone), f('E-mail', company.company_email))),
      h('div', { class: 'toolbar', style: { margin: 0 } }, h('button', { class: 'btn primary', type: 'submit' }, 'Enregistrer'), status)));
}

// ---------- Démarrage ----------
(async () => {
  try {
    const { user } = await api('/me');
    if (user?.role === 'admin') {
      me = user;
      return shell();
    }
    login(user ? 'Cette interface est réservée aux administrateurs.' : '');
  } catch (e) {
    login(e.message);
  }
})();
