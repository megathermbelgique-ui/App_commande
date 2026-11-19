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

## Saisir les prix et les codes-barres

Interface PC → **Articles et prix** :

1. **Exporter en CSV** : le fichier contient tous les articles, une ligne par conditionnement.
2. Dans Excel, remplir les colonnes `prix` (HT, pour le conditionnement entier) et `ean` (code-barres).
   Pour ajouter une boîte, un carton ou une palette, dupliquer la ligne et changer `unite` (`piece`, `boite`, `carton`, `palette`) et `qte`.
3. **Importer un CSV** : les articles existants sont mis à jour ; une ligne sans prix est ignorée sans erreur.

```
ref;code;nom;categorie;unite;qte;prix;ean
BBP5123;070474;Clé à chocs 20V brushless solo;Outillage sans fil;piece;1;89,00;5200000000011
BBP5123;;;;carton;4;330,00;5200000000028
```

Un article se modifie aussi un par un en cliquant dessus. Le bouton « Format CSV » décrit toutes les colonnes
(description, caractéristiques, photo). Dans l'application, un article se retrouve par sa référence, son code article
ou son code-barres.

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
