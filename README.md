# Commandes Bormann

Prise de commandes pour délégués commerciaux :

- **Application mobile** (iPhone / iPad) : connexion, scan de codes-barres, panier avec franco,
  catalogue, commandes passées, clients, promos.
- **Serveur** : reçoit les commandes, calcule tous les prix, stocke les données.
- **Interface PC** (`/admin`) : commandes et export PDF, articles et prix, remises par client,
  promos, utilisateurs, paramètres.

## Démarrer

Il faut [Node.js](https://nodejs.org) 22.13 ou plus récent.

```bash
npm install
ADMIN_PASSWORD="un-mot-de-passe-solide" npm start
```

- Application mobile : `http://localhost:3000/`
- Interface PC : `http://localhost:3000/admin`
- Compte créé au premier démarrage : `admin` + le mot de passe choisi. Sans `ADMIN_PASSWORD`,
  un mot de passe aléatoire est affiché une seule fois dans la console.

Au premier démarrage, la base est remplie avec :

- le **catalogue Bormann Pro** (`catalog/`) : 969 articles tirés de la brochure automne-hiver 2026, avec référence,
  code article, nom et fiche technique en français, et photo pour 807 d'entre eux. La brochure ne contient
  **ni prix ni codes-barres** : ces articles ne sont commandables qu'une fois leur prix saisi (voir plus bas) ;
- des **données de démonstration** : 30 articles fictifs avec prix (catégorie « Démonstration »), 4 clients et 3 promos,
  pour essayer le scan et la commande. `SEED_DEMO=0` pour ne pas les charger, `SEED_CATALOG=0` pour une base sans catalogue.

Les délégués se créent dans l'interface PC, onglet **Utilisateurs**.

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `PORT` | Port d'écoute | `3000` |
| `DATA_DIR` | Dossier de la base de données | `./data` |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Premier compte administrateur | `admin` / aléatoire |
| `SEED_DEMO` | `0` pour ne pas charger les données de démonstration | chargées |

## Installer sur iPhone / iPad

L'application est une « web app » installable : une fois ajoutée à l'écran d'accueil, elle s'ouvre
en plein écran avec sa propre icône, sans barre de navigateur.

1. Le serveur doit être joignable **en HTTPS** (obligatoire pour que l'iPhone autorise la caméra).
2. Ouvrir une seule fois l'adresse du serveur dans **Safari**.
3. Bouton Partager → **Sur l'écran d'accueil** → Ajouter.
4. Lancer l'application depuis son icône et se connecter. La session reste ouverte 6 mois.

## Mettre le serveur en ligne

N'importe quel hébergeur qui fait tourner Node.js ou Docker et fournit le HTTPS convient
(serveur dédié / VPS derrière un proxy Caddy ou nginx, ou une plateforme de type Render, Railway, Fly.io).

```bash
docker build -t commandes .
docker run -d -p 3000:3000 -v commandes-data:/data -e ADMIN_PASSWORD="…" commandes
```

Le dossier de données (`/data` dans Docker) doit être **persistant** : il contient toute la base
(`commandes.db`). Le sauvegarder régulièrement.

## Fichiers Excel (interface PC)

Tout passe par des fichiers Excel `.xlsx` (le CSV reste accepté à l'import). La première ligne contient les noms de colonnes.

**Prix et codes-barres** — onglet « Articles et prix » :

1. **Exporter en Excel** : tous les articles, une ligne par conditionnement.
2. Remplir les colonnes `prix` (HT, pour le conditionnement entier) et `ean` (code-barres).
   Pour ajouter une boîte, un carton ou une palette, dupliquer la ligne et changer `unite` (`piece`, `boite`, `carton`, `palette`) et `qte`.
3. **Importer un fichier Excel** : les articles existants (même `ref`) sont mis à jour ; une ligne sans prix est ignorée sans erreur.

Le bouton « Format du fichier » décrit les autres colonnes (description, caractéristiques, photo).

**Clients** — onglet « Clients et remises » : export et import avec les colonnes `numero`, `nom`, `tva`, `adresse_siege`,
`cp_siege`, `localite_siege`, `adresse_livraison`, `cp_livraison`, `localite_livraison`, `horaires`, `telephone`, `email`,
`responsable`, `tel_responsable`, `contact_compta`, `tel_compta`, `email_compta`, `iban`, `remarques`, `remise`.
Un client est reconnu par son numéro, sinon par son numéro de TVA ; une cellule vide ne vide pas la fiche existante.

**Commandes** — onglet « Commandes » : « Exporter en Excel » donne les commandes affichées (filtres compris) dans un classeur
à deux feuilles, « Commandes » (une ligne par commande, avec adresses) et « Lignes » (une ligne par article commandé).
Le bouton « Excel » d'une commande exporte cette commande seule ; le PDF reste disponible.

**Identifiants** — onglet « Identifiants » : créer, désactiver, changer le mot de passe ou supprimer un identifiant.
Supprimer un délégué conserve ses commandes et ses clients.

## Règles de prix

Les prix sont calculés par le serveur ; l'application n'envoie que l'article, le conditionnement et
la quantité. Ils ne se modifient que depuis l'interface PC, par un administrateur.

- Remise appliquée à un client : remise sur l'article, sinon remise sur sa catégorie, sinon remise générale.
- Une promo (quantité minimum en pièces) remplace la remise du client si elle est plus avantageuse ; pas de cumul.
- Franco : montant général dans **Paramètres**, ou montant propre à un client. L'envoi d'une commande
  sous le franco peut être bloqué ou autorisé (case à cocher dans **Paramètres**).

## Sécurité

- Mots de passe hachés (scrypt), session par cookie `HttpOnly` non lisible par le code de la page.
- Limitation des tentatives de connexion, protection CSRF, en-têtes CSP.
- Un délégué ne voit que ses propres commandes, et les clients qui lui sont attribués ou sans délégué attitré.
- À faire côté hébergement : HTTPS, mot de passe administrateur solide, sauvegardes de la base.

## Développement

```bash
npm test
```

```
server/   API (Express), base SQLite, prix, PDF
public/app/     application mobile
public/admin/   interface PC
public/shared/  utilitaires communs
catalog/        catalogue Bormann Pro (données + photos)
```

## Démonstration sans serveur

`node scripts/build-demo.js` construit dans `demo/dist/` une version autonome de l'application mobile : mêmes écrans,
catalogue et clients de démonstration, données gardées dans le navigateur. Le scan par caméra y est remplacé par des
scans simulés, et les commandes ne sont envoyées nulle part.
