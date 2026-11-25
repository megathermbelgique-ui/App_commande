'use strict';
// Données de DÉMONSTRATION, chargées uniquement quand la base est vide.
// Ce ne sont pas les vrais articles Bormann : références, prix et codes-barres
// sont fictifs (codes EAN en 200…, plage réservée à l'usage interne).
// Le vrai catalogue s'importe depuis l'interface PC (Articles > Importer CSV).

function ean13(n) {
  const body = '200' + String(n).padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 ? 3 : 1);
  return body + ((10 - (sum % 10)) % 10);
}

// Conditionnements : [unité, nombre de pièces, coefficient de prix par pièce]
const PACKS = {
  A: [['piece', 1, 1]],
  B: [['piece', 1, 1], ['boite', 6, 0.95]],
  C: [['piece', 1, 1], ['boite', 10, 0.95], ['carton', 60, 0.9], ['palette', 1200, 0.85]],
  D: [['piece', 1, 1], ['carton', 4, 0.93], ['palette', 48, 0.87]],
};

const CATALOGUE = {
  Tournevis: [
    ['Tournevis plat 5,5 x 100 mm', 3.9, 'C', 'Lame chrome-vanadium, manche bi-matière antidérapant.', [['Empreinte', 'Plate 5,5 mm'], ['Longueur de lame', '100 mm'], ['Matière', 'Cr-V']]],
    ['Tournevis cruciforme PH2 x 100 mm', 4.2, 'C', 'Pointe magnétique, manche bi-matière.', [['Empreinte', 'PH2'], ['Longueur de lame', '100 mm'], ['Matière', 'Cr-V']]],
    ['Tournevis Torx T20 x 100 mm', 4.6, 'C', 'Pointe magnétique phosphatée.', [['Empreinte', 'T20'], ['Longueur de lame', '100 mm']]],
    ['Jeu de 6 tournevis isolés 1000 V', 24.5, 'B', 'Jeu de tournevis isolés pour électricien.', [['Nombre de pièces', '6'], ['Isolation', '1000 V'], ['Norme', 'VDE']]],
  ],
  Pinces: [
    ['Pince universelle 180 mm', 9.8, 'C', 'Mâchoires trempées, poignées gainées.', [['Longueur', '180 mm'], ['Matière', 'Acier au carbone']]],
    ['Pince coupante diagonale 160 mm', 8.9, 'C', 'Tranchants trempés par induction.', [['Longueur', '160 mm'], ['Capacité de coupe', 'Fil dur 2 mm']]],
    ['Pince multiprise 250 mm', 11.5, 'B', 'Réglage rapide 7 positions.', [['Longueur', '250 mm'], ['Ouverture max.', '36 mm']]],
    ['Pince à dénuder automatique', 13.9, 'B', 'Dénudage automatique des câbles.', [['Section', '0,2 – 6 mm²'], ['Longueur', '210 mm']]],
  ],
  'Clés et douilles': [
    ['Clé mixte 13 mm', 3.4, 'C', 'Clé mixte fourche + œil, finition satinée.', [['Dimension', '13 mm'], ['Matière', 'Cr-V']]],
    ['Clé à molette 250 mm', 12.9, 'B', 'Mâchoire graduée, ouverture 30 mm.', [['Longueur', '250 mm'], ['Ouverture max.', '30 mm']]],
    ['Coffret douilles 1/2" 24 pièces', 39.9, 'D', 'Coffret cliquet 72 dents et douilles 10 à 32 mm.', [['Carré', '1/2"'], ['Nombre de pièces', '24'], ['Cliquet', '72 dents']]],
    ['Jeu de clés Allen 9 pièces', 6.5, 'C', 'Clés mâles longues à tête sphérique.', [['Dimensions', '1,5 – 10 mm'], ['Nombre de pièces', '9']]],
  ],
  Marteaux: [
    ['Marteau de menuisier 500 g', 9.5, 'B', 'Manche fibre de verre, tête forgée.', [['Poids', '500 g'], ['Manche', 'Fibre de verre']]],
    ['Massette 1000 g', 11.9, 'B', 'Tête carrée forgée, manche fibre.', [['Poids', '1000 g']]],
    ['Maillet caoutchouc 450 g', 6.9, 'B', 'Maillet noir, manche bois.', [['Poids', '450 g'], ['Diamètre', '55 mm']]],
  ],
  'Mesure et traçage': [
    ['Mètre ruban 5 m x 19 mm', 4.9, 'C', 'Boîtier antichoc, frein de ruban, crochet magnétique.', [['Longueur', '5 m'], ['Largeur de ruban', '19 mm'], ['Classe', 'II']]],
    ['Niveau à bulle aluminium 60 cm', 12.5, 'B', '3 fioles, profilé aluminium renforcé.', [['Longueur', '60 cm'], ['Précision', '0,5 mm/m']]],
    ['Équerre de menuisier 300 mm', 7.9, 'B', 'Lame inox graduée, talon aluminium.', [['Longueur', '300 mm']]],
    ['Cutter 18 mm', 2.9, 'C', 'Corps métal, blocage par molette.', [['Largeur de lame', '18 mm']]],
  ],
  'Outillage électroportatif': [
    ['Perceuse-visseuse sans fil 20 V', 89.0, 'D', 'Livrée avec 2 batteries, chargeur et coffret.', [['Tension', '20 V'], ['Batterie', '2 x 2,0 Ah Li-ion'], ['Couple max.', '45 Nm'], ['Mandrin', '13 mm']]],
    ['Meuleuse d\'angle 125 mm 900 W', 49.0, 'D', 'Poignée latérale 3 positions, carter réglable.', [['Puissance', '900 W'], ['Diamètre de disque', '125 mm'], ['Vitesse', '11 000 tr/min']]],
    ['Perforateur SDS-Plus 800 W', 99.0, 'D', '3 fonctions : perçage, percussion, burinage.', [['Puissance', '800 W'], ['Énergie de frappe', '2,6 J'], ['Emmanchement', 'SDS-Plus']]],
    ['Scie sauteuse 750 W', 59.0, 'D', 'Mouvement pendulaire 4 positions.', [['Puissance', '750 W'], ['Profondeur de coupe bois', '80 mm']]],
  ],
  'Forets et accessoires': [
    ['Coffret 19 forets métal HSS', 14.9, 'C', 'Forets HSS rectifiés de 1 à 10 mm.', [['Nombre de pièces', '19'], ['Diamètres', '1 – 10 mm'], ['Matière', 'HSS']]],
    ['Disque à tronçonner inox 125 x 1 mm', 0.95, 'C', 'Disque extra-fin pour acier et inox.', [['Diamètre', '125 mm'], ['Épaisseur', '1 mm'], ['Alésage', '22,23 mm']]],
    ['Coffret 32 embouts de vissage', 9.9, 'C', 'Embouts PH, PZ, Torx, plats + porte-embout magnétique.', [['Nombre de pièces', '32'], ['Entraînement', '1/4"']]],
    ['Foret béton SDS-Plus 8 x 160 mm', 2.6, 'C', 'Tête carbure 2 taillants.', [['Diamètre', '8 mm'], ['Longueur', '160 mm']]],
  ],
  'Protection (EPI)': [
    ['Gants de travail nitrile T9', 1.9, 'C', 'Enduction nitrile, dos aéré.', [['Taille', '9'], ['Norme', 'EN 388']]],
    ['Lunettes de protection', 2.5, 'C', 'Monture enveloppante, oculaire polycarbonate.', [['Norme', 'EN 166']]],
    ['Casque antibruit 27 dB', 8.9, 'B', 'Arceau réglable, coquilles rembourrées.', [['Atténuation', 'SNR 27 dB'], ['Norme', 'EN 352-1']]],
  ],
};

const CLIENTS = [
  { name: 'Quincaillerie Démo SPRL', vat: 'BE 0000.000.097', hq_address: 'Rue de l\'Exemple 12', hq_zip: '4000', hq_city: 'Liège', hours: 'Lu–Ve 8h–18h, Sa 9h–12h', phone: '04 000 00 01', email: 'info@quincaillerie-demo.example', manager_name: 'Camille Démo', manager_phone: '0470 00 00 01', accounting_name: 'Service comptabilité', accounting_phone: '04 000 00 02', accounting_email: 'compta@quincaillerie-demo.example', iban: 'BE00 0000 0000 0000', discount_pct: 10 },
  { name: 'Brico Test SA', vat: 'BE 0000.000.196', hq_address: 'Avenue Fictive 45', hq_zip: '1000', hq_city: 'Bruxelles', del_address: 'Zoning Industriel, quai 3', del_zip: '1070', del_city: 'Anderlecht', hours: 'Lu–Sa 7h30–19h', phone: '02 000 00 01', email: 'achats@bricotest.example', manager_name: 'Alex Essai', manager_phone: '0470 00 00 02', discount_pct: 15 },
  { name: 'Outillage Exemple & Fils', vat: 'BE 0000.000.295', hq_address: 'Chaussée du Modèle 8', hq_zip: '5000', hq_city: 'Namur', hours: 'Lu–Ve 8h–17h', phone: '081 00 00 01', email: 'contact@outillage-exemple.example', manager_name: 'Dominique Exemple', discount_pct: 5 },
  { name: 'Matériaux Échantillon', vat: 'BE 0000.000.394', hq_address: 'Rue du Prototype 3', hq_zip: '7000', hq_city: 'Mons', hours: 'Lu–Ve 7h–17h', phone: '065 00 00 01', email: 'info@materiaux-echantillon.example', discount_pct: 0 },
];

module.exports = function seedDemo(store) {
  const { q, tx } = store;
  tx(() => {
    let n = 1;
    const productIds = [];
    // Tous les articles fictifs dans une seule catégorie, pour ne pas les mêler au vrai catalogue.
    const catId = q('INSERT INTO categories(name, sort) VALUES (?, ?)').run('Démonstration (articles fictifs)', 999).lastInsertRowid;
    for (const items of Object.values(CATALOGUE)) {
      for (const [name, price, pack, description, specs] of items) {
        const ref = 'DEMO-' + String(n).padStart(3, '0');
        const id = q(
          'INSERT INTO products(ref, name, category_id, description, specs) VALUES (?, ?, ?, ?, ?)'
        ).run(ref, name, catId, description, JSON.stringify(specs)).lastInsertRowid;
        PACKS[pack].forEach(([unit, qty, coef], i) => {
          q('INSERT INTO product_units(product_id, unit, qty, price_cents, ean) VALUES (?, ?, ?, ?, ?)').run(
            id, unit, qty, Math.round(price * 100 * coef) * qty, ean13(n * 10 + i)
          );
        });
        store.refreshProductSearch(id);
        productIds.push(id);
        n++;
      }
    }
    CLIENTS.forEach((c, i) => {
      const cols = Object.keys(c);
      const id = q(
        `INSERT INTO clients(number, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`
      ).run('C' + String(i + 1).padStart(5, '0'), ...cols.map((k) => c[k])).lastInsertRowid;
      store.refreshClientSearch(id);
    });
    // Implantations d'exemple : plus le linéaire est long, plus l'assortiment est large.
    const plans = [
      ['Outillage à main', 1, [[0, 'boite', 1], [1, 'boite', 1], [4, 'boite', 1], [8, 'boite', 1], [15, 'boite', 1]]],
      ['Outillage à main', 2, [[0, 'boite', 2], [1, 'boite', 2], [2, 'boite', 1], [4, 'boite', 2], [5, 'boite', 1], [8, 'boite', 2],
        [11, 'boite', 1], [12, 'boite', 1], [15, 'boite', 2], [18, 'boite', 1]]],
      ['Outillage à main', 3, [[0, 'carton', 1], [1, 'carton', 1], [2, 'boite', 2], [3, 'boite', 1], [4, 'carton', 1], [5, 'boite', 2],
        [6, 'boite', 2], [7, 'boite', 1], [8, 'carton', 1], [9, 'boite', 1], [11, 'boite', 2], [12, 'boite', 2], [13, 'boite', 1],
        [14, 'boite', 1], [15, 'carton', 1], [16, 'boite', 2], [17, 'boite', 1], [18, 'boite', 2]]],
      ['Électroportatif', 2, [[19, 'carton', 1], [20, 'carton', 1], [21, 'carton', 1], [22, 'carton', 1], [23, 'boite', 2], [24, 'carton', 2]]],
    ];
    for (const [name, len, items] of plans) {
      const id = q('INSERT INTO implantations(name, meters) VALUES (?, ?)').run(name, len).lastInsertRowid;
      for (const [n, unit, qty] of items) {
        q('INSERT INTO implantation_items(implantation_id, product_id, unit, qty) VALUES (?, ?, ?, ?)').run(id, productIds[n], unit, qty);
      }
    }
    q("UPDATE implantations SET extra_pct = 5 WHERE name = 'Électroportatif'").run();
    const promo = q(
      'INSERT INTO promos(title, description, product_id, min_qty, discount_pct, ends_on) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const end = new Date(Date.now() + 60 * 86400e3).toISOString().slice(0, 10);
    promo.run('-20 % sur les mètres ruban', 'À partir de 10 pièces commandées.', productIds[15], 10, 20, end);
    promo.run('Perceuse-visseuse 20 V : -25 %', 'À partir d\'un carton de 4 pièces.', productIds[19], 4, 25, end);
    promo.run('Disques à tronçonner par 60', '-30 % dès 60 pièces (1 carton).', productIds[24], 60, 30, '');
  });
};
