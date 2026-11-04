# Recette — corrections et interfaces BPM

Matrice « exigence → page/service → preuve → statut ». Statuts :

- **Testé** : implémenté et couvert par un test automatisé exécuté (preuve citée) ;
- **À vérifier** : implémenté, compilé (types et templates), sans test automatisé de l'interface — à contrôler
  en recette navigateur (non faite par l'agent, à la demande du propriétaire) ;
- **Choix métier** : bloqué par une règle non définie ; le contexte et l'impact sont affichés dans l'application ;
- **Restant** : non réalisé.

Commandes : `npm test` (API, `node:test`), `npm --prefix web test -- --watch=false` (site, Vitest),
`npm run build` (build de production). Fichiers de test : `api/test/corrections.test.mjs` (C), `api/test/contracts.test.mjs` (K),
`api/test/bpm.test.mjs`, `api/test/socle.test.mjs`, et côté site `*.spec.ts` (W).

## 1. Corrections (C01–C11)

| Exigence | Page / service | Preuve | Statut |
| --- | --- | --- | --- |
| C01 lecture historique d'une période close | `bpm/reads.mjs` summary/history (chiffres enregistrés, `comparison` séparé) | C « C01 période close… » | Testé |
| C02 montant annoncé avant clôture | `bpm/index.mjs` closingOf, confirmation | C « C02 confirmation de clôture… » | Testé |
| C03 réalisation future refusée | `budget/index.mjs` create/realize/settle | C « C03… », K « récurrence… » (FUTURE_REALIZATION) | Testé |
| C04 budget initial ≠ solde attendu ; net = reçu − payé | indicateurs `bpm.*`, `balance` | C « C04… », C/K « §15 exemples / solde » | Testé |
| C05 diagnostic d'un objet et global | `socle/object-management/inspect.mjs` | C « C05 références invalides… » | Testé |
| C06 ensemble principal obligatoire | `bpm/index.mjs` requireComposition, préparation explicite | C « C06… » | Testé |
| C07 export de preuve d'un instantané commun | `GET /api/om/export.zip` | C « C07 export de preuve… » | Testé |
| C08 vocabulaire | libellés API et pages | C « C08 vocabulaire… » ; pages : relecture | Testé (API) / À vérifier (pages) |
| C09 dates civiles strictes | `socle/validation.mjs` | C « C09… », K « branche » (30 février) | Testé |
| C10 suivi après 600 périodes | `bpm/periods.mjs` (calcul par index) | C « C10… » | Testé |
| C11 un seul écrivain du stockage | `socle/store` (verrou, PERSISTENCE_CONFLICT) | C « C11 » ×3 | Testé |
| Migration des données existantes | `socle-store/0.5`, IDs conservés | C « migration j1-store/0.2 → 0.5… » | Testé |

## 2. Services (§3)

| Exigence | Service | Preuve | Statut |
| --- | --- | --- | --- |
| Opérations ponctuelles et récurrentes (cadences, première date, fin, occurrences) | `budget/recurrence.mjs`, `createRecurrence` | K « occurrences… », « une cadence saisie… » | Testé |
| Définition / occurrence / règlement ; pas de double règlement | `settleOccurrence`, `cancelRealization` | K « récurrence… » (ALREADY_SETTLED) | Testé |
| Prévu par date prévue, réalisé par date réelle | `budgetLines(by)` | K « prévu par date prévue… » | Testé |
| Clôtures protégées | règlement tardif à sa date réelle | K « clôture protégée… » | Testé |
| Lectures communes (synthèse, registre, centres, historique, projection) | `bpm/reads.mjs` | K « registre… », « centres… », « projection BPM… » | Testé |
| Centimes entiers, unités explicites | contrats `…Cents` ; `comparison.unit` | K « compléments de contrat… » | Testé |
| Révisions attendues, commandes rejouables | OM `requestKey`, `expectedRevision` | K « Partir de zéro (principal)… » (rejeu) ; W « rejoue la même clé… » | Testé |
| Aucune mutation par lecture, aperçu, simulation, export | lectures, `previewEntry`, simulation | K « lectures sans effet… », « aperçu d’une saisie… », « projection BPM… » | Testé |
| Centre personnalisé de U1 absent pour U2 | `costCentersOf` | K « centres… » | Testé |
| Assistant : erreurs rattachées à la ligne `entries[i].*` | `setupProject` | K « compléments de contrat… » | Testé |

## 3. Cadre commun des pages (§5) et coquille

| Exigence | Page / composant | Preuve | Statut |
| --- | --- | --- | --- |
| Coquille du dépôt de référence (rjsconseil/rjs-forecast @ 54246fa) : marque, pastille du user, identité de zone, sections, pages de la section, sélecteur de user, « Espace local » ; barre du haut (fil d'Ariane Accueil / zone / section / page, date) ; menu popover < 820 px | `app.ts`, `shared/site-plan.ts`, `shared/account-chip.component.ts`, `_shell.scss` + `_zones.scss` source | W « situe une page, un détail et l’accueil » ; build | À vérifier |
| Accueil : portail des zones en bandes — module phare BPM (réunit Budget et Patrimoine), Budget, Patrimoine, Noyau transverse, Administration — avec liens vers chaque section | `home/home.ts` (gabarit `overview.page`), `_zones.scss`, `_overview-theme.scss` | W « ouvre l’accueil des zones à la racine », « range les zones de l’accueil… » | À vérifier |
| Projets et tâches ventilés par statut (gabarit `section-home` / `item-summary` / `item-board-tools` / `item-board`), ventilation horizontale conservée, filtres dans l'URL | `projects/projects-board.ts`, `tasks/tasks-board.ts`, `_workspace.scss` | build ; écritures inchangées (`changeTaskStatus` avec révision) | À vérifier |
| Accueils de zone (`/zones/:zone`) et calendrier miniature des projets | — | — | Restant (les zones mènent à leur première page ; pas de données de planification affichées) |
| En-tête de page figé (bandeau `rjs-app-hero` sous la barre du haut) | `bpm/ui/page-frame.ts` (`data-sticky-hero`) | build | À vérifier |
| En-tête de page mauve foncé | `_app-tokens.scss` (`--header-surface: --violet-950`) | build | À vérifier — teinte exacte du site non livrée dans le dossier (réglage de design) |
| Contexte partagé : user, périmètre, période (début inclus, fin exclue), date de calcul | `bpm-page` (pastilles du bandeau) | build | À vérifier |
| Navigation de période sans changer le cycle, filtres conservés | `rjs-period-navigation` (liens d'URL fusionnant la requête) | W « conserve les paramètres d’un ancien lien… » | À vérifier |
| Réponse réseau périmée ignorée ; rechargement après écriture | `bpmLoader`, `BpmRefresh` | W « ignore une réponse devenue ancienne… », « recharge après une écriture… », « efface les données d’un autre user… » | Testé |
| Chargement / vide / inconnu / erreur / nouvelle tentative ; inconnu ≠ zéro | `bpm-state`, `rjs-metric-tiles` | W « expose l’erreur et recharge… », « séries : une valeur inconnue… » | Testé (briques) / À vérifier (pages) |
| Brouillon conservé en cas d'erreur | éditeur d'opération | W « rejoue la même clé… », « refuse un montant invalide… » | Testé |
| Graphes : séries de couleur stable, tableau associé, répartition sans secteur négatif | `bpm/ui/charts.ts` | W tests de `charts.spec.ts` | Testé |
| Styles en couches (source puis passerelle), polices Inter / IBM Plex Mono / Newsreader | `styles.scss`, `_fonts.scss` | build | À vérifier |
| Consolidation père/enfants | `impact` | K « branche » (`consolidated.status = not-defined`) | Choix métier |
| Répartition patrimoniale | middleware Patrimoine | — | Choix métier (aucun contrat d'allocations) |
| Cycles hebdomadaire / annuel de clôture | `bpm/periods.mjs` (mensuel) | — | Choix métier |

## 4. Pages BPM (§6–§12) — markup et feuilles du site de référence

Chaque page garde son branchement (lectures `bpmLoader`, écritures rejouables, état d'URL) et reprend la hiérarchie
et les classes du template de référence, avec ses feuilles `bpm/ref-styles/*.scss`. Comptes rendus détaillés des
agents : workflow `bpm-pages-reference-styles` (journal de session).

| Exigence | Page / fichiers | Preuve | Statut |
| --- | --- | --- | --- |
| §6 Partir de zéro : assistant en étapes, rail de progression, récapitulatif, commande unique rejouable, brouillon repris, erreurs rattachées à la ligne | `/creer` — `create.ts`, `create-model.ts`, `create-details.ts` ; `bpm-pages`, `bpm-create.page`, `bpm-start-details` | K « Partir de zéro (principal/branche) », « compléments de contrat » ; build | À vérifier |
| §6 Cycle figé après une clôture ; libellé du type de user | `create.ts` (`cycleState.frozen`, `userTypeLabel`) | K « compléments de contrat » | Testé (API) / À vérifier (page) |
| §6 « Assembler l'existant », profils types, cycles hebdomadaire/annuel | — | — | Choix métier (contrat setup sans assemblage ; cycle mensuel seul) |
| §7 Tableau de bord : chiffres clés `rjs-metric-tiles` (reçu, dépensé, reste réel, prévision), calcul repliable, patrimoine (base, contribution, total, cap), historique, clôture confirmée | `/tableau-de-bord` — `dashboard.ts`, `dashboard-parts.ts`, `dashboard-history.ts` ; `bpm-money`, `bpm-dashboard-wealth`, `bpm-dashboard-history` | C « C02 », « C04 », K « §15 solde » ; build | À vérifier |
| §7 Message après l'assistant | `dashboard.ts` (`history.state.bpmNotice`) | build | À vérifier |
| §7 Découpage récurrent/ponctuel du budget standard, vue quotidienne | — | — | Restant (aucun contrat « funding » ni vue quotidienne) |
| §8 Dépenses de la période : registre filtré (URL), regroupements, totaux, détail d'échéance partagé, éditeur, pointage | `/depenses` — `expenses.ts` ; `bpm-money`, `bpm-expenses.page` | K « registre… », « récurrence… » ; W éditeur | À vérifier |
| §12 Détails : entrées, solde et rapprochement, centre (payé, restant, plafond, marge) | `/argent/entrees`, `/argent/reste`, `/argent/postes/:poste` — `incomes.ts`, `balance.ts`, `center.ts` ; `bpm-money-detail.page` | K « §15 solde… », « centres… » | À vérifier |
| §9 Graphiques et chiffres : séries prévu/réel, répartition, impact des projets, avancement | `/piloter` — `pilot.ts`, `pilot-charts.ts` ; `bpm-vision.page`, `bpm-pilot-charts`, `bpm-flow-pilot` | W `charts.spec.ts` ; K « lectures sans effet » | À vérifier |
| §10 Ce qu'il faut faire : échéances, budget type, directives, simulation sans écriture, saisie avec aperçu | `/piloter/agir` — `act*.ts` ; `bpm-flow-editor`, `bpm-month-type` | K « directives… », « aperçu d’une saisie… », « projection BPM… » | À vérifier |
| §10 Verdict du budget type face à l'épargne nécessaire, entrées à venir dans les événements | — | — | Restant (contrats sans ces données) |
| §11 Objectifs et avenir : hypothèses, chiffres clés, projection nominal/réel, objectifs (ajout, modification, retrait), comparaison des apports | `/vision` — `vision.ts`, `vision-charts.ts`, `vision-goal-editor.ts`, `vision-objectives.ts` ; `bpm-vision.page`, `bpm-objectives` | K « §15 projection », « §15 couverture », « projection BPM… » | À vérifier |
| §11 Répartition patrimoniale, phases accumulation/allocation, inflation par année | — | — | Choix métier (aucun contrat d'allocations ; taux d'inflation unique) |
| §5 Bandeau propre à chaque page (pastilles métier, guide « Que faire maintenant ? », visite) | `bpm-page` | — | Restant (le bandeau porte le contexte commun ; pas de contrat d'état de lecture pour le guide) |



## 5. Exécution

| Commande | Résultat (3 novembre 2026) |
| --- | --- |
| `npm test` (API) | 115 / 115 |
| `npm --prefix web test -- --watch=false` | 18 / 18 |
| `cd web && npx ng build` | build de production réussi |

Recette navigateur (1440 / 1024 / 768 / 390 px, clavier, thème) : non faite par l'agent, à la demande du propriétaire.
