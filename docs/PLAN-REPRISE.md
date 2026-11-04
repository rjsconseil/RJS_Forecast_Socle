# Plan de reprise — 3 novembre 2026

État arrêté à la demande de l'utilisateur (« je relance ce soir »). Rien n'est commité (le dépôt n'a aucun commit).

## Demandes en cours

1. **Spec « corrections et interfaces BPM »** (`docs/reference/spec-corrections-interfaces-bpm.md`) : lots 1 à 5.
2. **Nouvelle demande** : reprendre le menu de gauche, l'en-tête du haut et toutes les pages pour que le site
   ressemble à 100 % au site de référence décrit par les feuilles de style du dossier Codex
   (`docs/reference/dossier-codex-v0.1/`, guide principal `RJS_Forecast_Guide_Codex_Demarrage_Vision_v0.1.md`,
   sections 16–17 pour les styles ; `annexes/correspondance-styles.json` pour la correspondance page → SCSS).
   Pas de vérification navigateur : l'utilisateur s'en charge.

## Fait

- **Lot 1** (C01–C11) : API corrigée, tests `api/test/corrections.test.mjs`. `npm test` : 114/114 au dernier passage.
- **Lot 2** : contrats de lecture (`api/src/modules/bpm/reads.mjs`, `projection.mjs`, `budget/recurrence.mjs`),
  client `web/src/app/core/bpm-api.service.ts`, modèles `bpm-models.ts`, composants partagés `web/src/app/bpm/ui/`
  (cadre de page, contexte d'URL + `bpmLoader` anti-réponse périmée, cartes, graphes SVG accessibles, éditeur
  d'opération, détail d'échéance), nouvelles routes et redirections (`app.routes.ts`), shell à deux sections
  (`app.ts`). Tests web Vitest : 15/15 (`npm --prefix web test -- --watch=false`).
- Données migrées en `socle-store/0.5` (sauvegardes `api/data/store.j1-0.2.backup.json`, `store.0.4.backup.json`).
- README et `docs/ARCHITECTURE.md` mis à jour ; `docs/RECETTE.md` : en-tête seulement (matrice à remplir).

## En cours au moment de l'arrêt

- **Workflow de pages (lots 3–4)** : **terminé** (4 agents sur 4, sans erreur). Comptes rendus détaillés (exigences, besoins d'API, limites) dans `docs/reference/resultats-agents-pages.json`, à reprendre pour la matrice de recette et les corrections d'API demandées (ex. : message après l'assistant via `history.state.bpmNotice`, champs `entries[i].*` dans les erreurs de `setupProject`). Ancienne note : 4 agents écrivent `web/src/app/bpm/pages/*.ts`
  (create, dashboard, balance, incomes, expenses, center, act, pilot, vision + sous-fichiers). Brief :
  `docs/reference/brief-agents-pages.md`. S'il a été interrompu, certaines pages peuvent être des stubs ou
  incomplètes : relire chaque fichier et relancer `cd web && npx ng build`.
- **Intégration des styles source** (commencée) :
  - feuilles globales source copiées dans `web/src/styles/` (`_fonts`, `_contrat`, `_tokens`, `_identities`,
    `_base`, `_shell`, `_components`, `_site-responsive`, `_forms`, `_interactions`, `_management`,
    `_overview-theme`, `_surface-language`, `_bpm-presentation`, `_functions`, `_contrat-ruptures`) ;
  - anciennes couches du projet renommées `_app-*.scss` (passerelle `--c-*` → jetons source dans `_app-tokens.scss`) ;
  - nouvelle entrée `web/src/styles.scss` (ordre source, sans Formation/calendriers) ;
  - `angular.json` : `styles: ["src/styles.scss"]`, `stylePreprocessorOptions.includePaths: ["src/styles"]` ;
    paquet `@fontsource/inter` installé (polices déclarées par `_fonts.scss` source) ;
  - SCSS partagés source copiés dans `web/src/app/shared/` (app-hero, metric-tiles, period-navigation) ;
  - SCSS des pages source copiés dans `web/src/app/bpm/ref-styles/` ;
  - `_app-shell.scss` : fichier vide à compléter.
  - **Le build n'a pas été relancé depuis ces changements** : premier geste à la reprise.

## Reste à faire (ordre proposé)

1. `cd web && npx ng build` ; corriger les erreurs Sass (chemins `@use`, polices) et de pages.
2. **Coquille source** dans `app.ts` : `<div class="app-shell" data-module="budget" data-space="…">` avec
   `<aside class="sidebar">` (`.brand` / `.brand-mark` / `.brand-name`, `<nav class="sidebar-navigation">`
   avec `.nav-label` par section — « Démarrer un projet » : Partir de zéro ; « Ma vision budgétaire » : les
   5 pages — puis Utilisateurs et Socle séparés, `.sidebar-bottom` avec le user actif), `.sidebar-mobile-head`
   + bouton `.mobile-nav-toggle` et menu en `popover` sous 820 px ; `<div class="main-shell">` avec
   `<header class="topbar">` (`.topbar-context` fil d'Ariane, `.topbar-current`, `.topbar-date`,
   `.topbar-actions` : sélecteur de user), `<main>`, `.main-footer`. Styles de liens du menu dans
   `_app-shell.scss` avec les jetons `--nav-item-height`, `--nav-item-padding-x`, `--nav-item-radius`,
   `--nav-font-size`, `--nav-active-ink`, `--nav-hover-surface` (absents des feuilles livrées).
3. **Composants partagés source** dans `web/src/app/shared/` : `AppHeroComponent` (`rjs-app-hero`),
   `MetricTilesComponent`, `PeriodNavigationComponent`, `ModalComponent` — code de
   `docs/reference/dossier-codex-v0.1/reference-code/site/apps/web/src/app/shared/`. Faire rendre
   `bpm-page` par `rjs-app-hero` + `rjs-period-navigation` (toutes les pages en profitent).
4. **Pages** (agents, un par groupe) : réécrire le markup avec les classes des templates de référence
   (`reference-code/.../bpm/*.ts`) et attacher les SCSS de `bpm/ref-styles/` via `styleUrl`
   (`.bpm-page.bpm-reading`, `data-ui-pattern="panel"`, `data-bpm-frame="metrics|chart"`), en gardant les
   contrats et règles déjà branchés. Correspondance : création → `bpm-create.page.scss`,
   `bpm-start-details` ; tableau de bord → `bpm-money.scss`, `metric-tiles`, `bpm-dashboard-wealth`,
   `bpm-dashboard-history` ; détails → `bpm-money-detail.page.scss` ; dépenses → `bpm-expenses.page.scss` ;
   piloter → `bpm-flow-pilot`, `bpm-pilot-charts`, `bpm-vision.page.scss` ; agir → `bpm-flow-editor`,
   `bpm-month-type` ; vision → `bpm-vision.page.scss`, `bpm-objectives`, `bpm-project-switch`.
5. Retirer les styles inutilisés de l'ancienne passerelle une fois les pages migrées ; garder les pages du
   socle lisibles (`_socle.scss`).
6. Lot 5 : `npm test`, tests web, `ng build`, matrice `docs/RECETTE.md`, compte rendu (livré / à vérifier /
   choix métier / restant). Points connus : consolidation père/enfants non définie ; répartition patrimoniale
   sans contrat (à signaler, pas de panneau vide présenté comme fini).

## Reprise du 3 novembre (soir)

- Build relancé : OK. Coquille source faite (`app.ts`, `_app-shell.scss`) : barre latérale, barre du haut, popover < 820 px.
- Composants source copiés dans `web/src/app/shared/` (app-hero, metric-tiles, period-navigation, modal, amount) ;
  `bpm-page` rend `rjs-app-hero` **figé** (`data-sticky-hero`) + `rjs-period-navigation`.
- En-tête mauve foncé : `--header-surface: var(--violet-950)` dans `_app-tokens.scss` (demande du propriétaire).
- Boutons de la passerelle réduits à des alias des boutons source (`_app-controls.scss`).
- API : erreurs `entries[i].*` dans `setupProject`, `cycleState` et `userTypeLabel` dans le profil, `objectiveCents`,
  `comparison.unit`, `history.rows[].index`, totaux du registre par sens et nets signés (test K « compléments de contrat »).
- Workflow « bpm-pages-reference-styles » (4 agents : creer, argent, piloter, vision) en cours : réécriture du markup
  sur les templates de référence (brief `docs/reference/brief-agents-styles.md`). À la fin : build, tests, matrice
  section 4 (pages) dans `docs/RECETTE.md`, compte rendu.

## État au 3 novembre, fin de soirée

Plan terminé : workflow des pages fini (4/4), coquille par zones et accueil portail repris du dépôt
`rjsconseil/rjs-forecast` (`shared/site-plan.ts`, `home/home.ts`), projets/tâches au gabarit `section-home` +
`_workspace.scss`. Tests : API 115/115, web 18/18, build OK. Matrice remplie (`RECETTE.md`), compte rendu
`COMPTE-RENDU.md`. Reste : recette navigateur par le propriétaire, points « Restant » du compte rendu.
