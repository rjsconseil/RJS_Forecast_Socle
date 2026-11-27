# Mise en ligne de RJS Forecast

Ce guide décrit la mise en ligne du socle : l'API (`api/src/server.mjs`), le site construit (`scripts/site-server.mjs`)
et une base PostgreSQL, derrière un proxy d'hébergement qui porte le HTTPS. Sur le poste de travail, rien de cela n'est
nécessaire : `npm start` suffit (mode local, SQLite, écoute sur le poste seul).

## 1. Schéma

```
navigateur ──HTTPS──▶ proxy d'hébergement (TLS : Caddy, nginx, hébergeur)
                          │  HTTP, réseau privé
                          ▼
                     site-server.mjs (port 4300) ── /api/* ──▶ server.mjs (port 3410, un ou plusieurs)
                                                                 │
                                                                 ▼
                                                           PostgreSQL (SOCLE_PG_URL)
```

Le site et l'API sont servis sous **la même origine** : le cookie de session (`HttpOnly`, `SameSite=Lax`) et le
contrôle d'origine de l'API fonctionnent sans réglage CORS.

## 2. Variables de l'API

| Variable | Valeur en ligne | Pourquoi |
|---|---|---|
| `SOCLE_AUTH` | `required` | Seul un jeton signé donne un user ; l'en-tête `x-user-id` est ignoré. |
| `SOCLE_DATA_ENGINE` | `sgbd` | PostgreSQL : plusieurs serveurs sur une même base. |
| `SOCLE_PG_URL` | `postgres://…` | Adresse de la base (`SOCLE_PG_POOL` : connexions par serveur, 10 par défaut). |
| `SOCLE_AUTH_SECRET` | 32 caractères au moins, **le même pour tous les serveurs** (`openssl rand -base64 32`) | Signature des jetons. Exigé au démarrage en `required` + `sgbd`. |
| `SOCLE_COOKIE_SECURE` | `1` | Cookie de session envoyé en HTTPS seulement (déduit aussi de `X-Forwarded-Proto: https`). |
| `SOCLE_ALLOWED_HOSTS` | `forecast.exemple.fr` | Noms d'hôte acceptés (contre le « DNS rebinding »). |
| `SOCLE_ALLOWED_ORIGINS` | (vide) | Autres origines autorisées à écrire, s'il en faut ; la même origine passe toujours. |
| `SOCLE_TRUST_PROXY` | `1` si le proxy n'est pas sur la même machine | L'adresse du client est lue dans `X-Forwarded-For` (limitation des essais de connexion). |
| `SOCLE_HOST` | `127.0.0.1` ou l'adresse privée | Jamais exposé directement : le proxy est devant. |
| `J1_ENABLE_RECETTE_RESET` | **absent** | La remise à zéro de recette n'existe pas en ligne. |

Le site : `SOCLE_SITE_HOST` (adresse d'écoute, `127.0.0.1` par défaut), `SOCLE_SITE_PORT` (4300), `J1_API_PORT`.

## 3. Étapes

1. Créer la base PostgreSQL (16 ou plus) et un rôle dédié. Les tables se créent au premier démarrage.
2. Reprendre une base SQLite du poste, si besoin : `node api/scripts/sqlite-to-pg.mjs` (voir son en-tête).
3. Construire le site : `npm ci && npm ci --prefix web && npm run build`.
4. Lancer l'API (un ou plusieurs processus) et `node scripts/site-server.mjs` avec les variables ci-dessus, sous un
   superviseur (systemd, conteneur) qui redémarre en cas d'arrêt.
5. Créer le premier administrateur : `node api/scripts/make-admin.mjs <email>` (le compte doit exister).
6. Configurer le proxy : HTTPS, redirection HTTP → HTTPS, `X-Forwarded-For` et `X-Forwarded-Proto` transmis.
7. Contrôler les réglages avec `npm run deploy:check` (dans l'environnement de l'API), puis le site ouvert avec
   `npm run deploy:check -- https://forecast.exemple.fr` : variables, CSP et nonce, HSTS, santé, refus attendus.

## 4. Exploitation

- **Santé** : `GET /api/health` rend `200 {"status":"ok"}` si la base répond, `503` sinon. À donner à la sonde du proxy.
- **Arrêt** : `SIGTERM` termine les requêtes en cours (10 s au plus), ferme les flux de changements, puis la base.
- **Journaux** : sortie standard et erreur, à collecter par le superviseur.
- **Sécurité des pages** : le site envoie une CSP (scripts, styles, appels et cadres du site seul), `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`. L'API envoie ses propres en-têtes (voir `api/src/http.mjs`).
  Aucun script en ligne n'est accepté : le seul, celui de l'aperçu de la navigation, est autorisé par son empreinte
  SHA-256 (`web/src/app/navigation/navigation-preview-csp.json`, lu par `scripts/site-server.mjs`). Si le proxy
  d'hébergement pose sa propre CSP, il doit reprendre celle de `site-server.mjs` telle quelle (empreinte comprise),
  sans rajouter `'unsafe-inline'`. Les balises `<style>` n'y passent qu'avec le **nonce de la page** : `site-server.mjs`
  en tire un neuf à chaque envoi de `index.html` (jamais mis en cache), l'écrit dans la CSP (`style-src-elem`) et sur
  `<app-root ngCspNonce>`, où Angular le lit pour les feuilles de ses composants. Un proxy qui mettrait la page en
  cache ou réécrirait la CSP casserait l'affichage : il doit transmettre les deux telles quelles. Seuls les attributs
  `style` restent permis (`style-src-attr`). Derrière un proxy HTTPS (`X-Forwarded-Proto: https`), le site envoie
  aussi `Strict-Transport-Security` (un an).
- **Connexion** : 8 échecs par identifiant ou par adresse en 15 minutes bloquent les essais suivants ; avec PostgreSQL,
  les compteurs sont dans la base (`SY_throttle`), communs à tous les serveurs. « Se déconnecter » révoque le jeton de
  l'appareil ; « se déconnecter partout » révoque tous les jetons du compte.

## 5. Vérifications avant ouverture

- `npm run deploy:check -- https://forecast.exemple.fr` fait les contrôles ci-dessous d'un coup.
- `curl -I https://forecast.exemple.fr/` montre `content-security-policy` (avec `'nonce-…'`), `strict-transport-security`
  et `x-frame-options`.
- `curl https://forecast.exemple.fr/api/bpm/summary` rend `401`.
- `curl -X POST -H 'Origin: https://autre.exemple' https://forecast.exemple.fr/api/auth/logout` rend `403`.
- `curl https://forecast.exemple.fr/api/health` rend `200`.
