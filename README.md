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

Au premier démarrage, un **catalogue de démonstration** est chargé (30 articles, 4 clients et
3 promos fictifs, références `DEMO-…`). Pour démarrer avec une base vide : `SEED_DEMO=0`.

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

## Charger le vrai catalogue

Interface PC → **Articles et prix** → **Importer un CSV** (le bouton « Format CSV » donne un modèle).
Une ligne par article et par conditionnement :

```
ref;nom;categorie;description;unite;qte;prix;ean;caracteristiques
ABC123;Tournevis plat 5,5 x 100;Tournevis;Lame Cr-V;piece;1;3,90;5200000000011;Empreinte: Plate | Longueur: 100 mm
ABC123;;;;boite;10;37,00;5200000000028;
```

`unite` vaut `piece`, `boite`, `carton` ou `palette` ; `prix` est le prix HT du conditionnement entier ;
`ean` est le code-barres de ce conditionnement. Réimporter un fichier met à jour les articles existants.

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
```
