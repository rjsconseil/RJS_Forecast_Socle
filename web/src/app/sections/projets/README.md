# Mes projets : fonctionnalités et application autonome

Mes projets se développe en **mode section** sur le grand noyau (socle), sans le modifier : lectures du noyau
`/api/projects`, `/api/tasks` et ses commandes, financement inchangé. Tout ce qui va au-delà du grand noyau (gestion de
projet avancée, semi-professionnelle ou professionnelle) vit ici. Les données propres à la section iront dans des tables
`MP_`. Si une fondation manque au grand noyau, elle s'y ajoute d'abord en **mode socle** (PR à part, non-régression
complète). Plan et règles : `docs/sections/README.md` ; fiche de la section : `docs/sections/projets.md`.

| Dossier | Étage | Contenu | Appelle |
|---|---|---|---|
| `fonctionnalites/` | **Fonctionnalités Mes projets** | Calculs et règles propres à la section, sans écran | le grand noyau (`platform/grand-noyau.ts`) et les fonctionnalités d'autres sections |
| `application/` | **Application autonome Mes projets** | Écrans (page Pilotage…) | le grand noyau, les fonctionnalités par section, le cadre BPM-Astra (`astra/cadre.ts`) |

Une application autonome hybride (par exemple Mes projets et Mon budget réunis) appellera `fonctionnalites/` sans passer
par `application/`. Les gardes sont dans `api/test/application-isolation.test.mjs`.

| Fichier | Rôle |
|---|---|
| `fonctionnalites/portfolio.ts` | Portefeuille des projets, santé, tableau des tâches, planning (calculs purs) |
| `application/inscription.ts` | Inscription dans BPM-Astra : pages (Pilotage), gestes, jeu d'essai (`seed-projets`) |
| `application/pilotage.page.ts` | Page « Pilotage » : vues Portefeuille, Tableau, Planning |

Poste de travail : `npm run app -- projets` (site et jeux d'essai sur une base temporaire), `npm run test:app -- projets`,
`npm run e2e:app -- projets`.
