'use strict';
// Province belge d'après le code postal (pour regrouper les livraisons par tournée).
const RANGES = [
  [1000, 1299, 'Bruxelles-Capitale'], [1300, 1499, 'Brabant wallon'], [1500, 1999, 'Brabant flamand'],
  [2000, 2999, 'Anvers'], [3000, 3499, 'Brabant flamand'], [3500, 3999, 'Limbourg'], [4000, 4999, 'Liège'],
  [5000, 5999, 'Namur'], [6000, 6599, 'Hainaut'], [6600, 6999, 'Luxembourg'], [7000, 7999, 'Hainaut'],
  [8000, 8999, 'Flandre-Occidentale'], [9000, 9999, 'Flandre-Orientale'],
];
function provinceOf(zip) {
  const n = Number(String(zip || '').replace(/\D/g, ''));
  const hit = String(zip || '').trim().length <= 5 && RANGES.find(([a, b]) => n >= a && n <= b);
  return hit ? hit[2] : 'Autre / hors Belgique';
}
// Province de livraison d'une fiche client (adresse de livraison, sinon siège).
const deliveryProvince = (c) => provinceOf(c.del_zip || c.del_city ? c.del_zip : c.hq_zip);
module.exports = { provinceOf, deliveryProvince };
