# Ajouter une application de niveau 3

_16 novembre 2026. Une application comme BPM, sur n'importe quel sujet, s'ajoute par **deux déclarations
et deux lignes d'inscription**. Le socle, le noyau, les middlewares et les fichiers centraux du site ne
changent pas._

## Ce qu'il faut écrire

| Où | Quoi | Modèle à suivre |
| --- | --- | --- |
| `api/src/modules/<app>/index.mjs` | Le module serveur : `level: 3`, `dependsOn`, `reads`, ses natures d'objets (`kinds`), ses commandes et ses routes `/api/<app>/…`. | `api/src/modules/bpm/index.mjs` |
| `api/src/modules/index.mjs` | **Une ligne** : ajouter le module à `SOCLE_MODULES`. | |
| `web/src/app/<app>/<app>.application.ts` | La déclaration d'application (contrat `platform/application.ts`). | `web/src/app/astra/astra.application.ts` |
| `web/src/app/platform/applications.ts` | **Une ligne** : ajouter la déclaration à `APPLICATIONS`. | |
| `web/src/app/<app>/…` | Les écrans de l'application. | |

## Ce que contient la déclaration côté site

| Champ | Niveau du Navigation system | Rôle |
| --- | --- | --- |
| `zone` (avec `numbered: true`) | 1 Section, 2 Page | Identité, sections numérotées 01, 02…, pages du menu latéral. `overviewSection(…)` donne la « Vue d'ensemble ». |
| `routes` | | Adresses des pages, des détails, redirections. |
| `workspaces` (`subpage(…)`) | 3 Sous-page | Chaque sous-page reçoit sa route et son onglet. |
| `actions` (`openAction(…)`) | Actions (N4) | Liste verticale sous l'onglet d'accueil. |
| `contentSections` (`contentSections(…)`) | 4 Section de sous-page | Ancres de contenu. |
| `objects` | | Fiches : un objet ouvert, ses onglets. |
| `details` | | Adresses de détail rattachées à une page. |
| `overview` | | Contenu propre de l'accueil de zone (sinon l'accueil générique). |
| `quickActions` | | Actions rapides dans la palette de commandes. |
| `band` | | Une bande d'accueil propre, si besoin. |
| `templates` | | Modèles d'adresse réglables dans l'atelier de navigation. |

## Ce que la plateforme fournit sans code

- **Serveur** : les six principes (P1 à P6) s'appliquent d'office : portée limitée aux dépendances
  déclarées, écriture réservée au propriétaire, lectures déclarées. Les données de l'application
  reçoivent leur propre schéma et leur propre espace de stockage (`application.<app>`), séparé de BPM.
- **Site** : accueil du portail, accueil de zone, menu latéral, cadre du haut (onglets, actions,
  sections, titre de section), numérotation, fil d'Ariane, palette de commandes, couleurs d'identité
  de section (`nav-navy`, `nav-teal`, `nav-iris`, `nav-petrol`, `nav-cyan`), contrôle des règles N2 à N9.
  Le cadre visuel d'application s'applique à toute zone numérotée (`data-application` sur la coquille).

## Contrôles

- `checkApplication(declaration)` (`platform/install-application.ts`) liste en clair ce qui manque ou
  entre en collision : page sans route, sous-page hors de l'application, adresse déjà prise, couleur inconnue…
- `auditApplication(id)` applique les règles du Navigation system.
- Preuves automatiques : `web/src/app/platform/application.spec.ts` (une application « Carnet de santé »
  branchée par sa seule déclaration, BPM inchangé) et `api/test/second-application.test.mjs` (son module
  serveur à côté de BPM ; les fichiers centraux du site ne nomment plus aucune application).

## Ce qui n'est pas encore générique

- L'écran « Utilisateurs » de l'administration est celui de BPM (`bpm/onboarding`) : il crée le projet de vie avec le user.
- Les composants d'interface de BPM (`bpm/ui`, environ 21 000 lignes avec ses pages) ne sont pas une
  bibliothèque partagée : une nouvelle application écrit ses écrans avec `shared/` et le cadre commun.
- L'atelier `/navigation` règle la première application inscrite ; il ne propose pas encore de choisir l'application.
- Le calendrier : une application qui veut le sien ajoute une instance dans les réglages du middleware Calendrier.
