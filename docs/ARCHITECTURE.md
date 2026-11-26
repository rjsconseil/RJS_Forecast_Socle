# RJS Forecast — Architecture du socle et des trois niveaux

Référence de conception : *Socle, règles et écrans v0.4* et *J1 v0.2*. Ce document fixe les **contrats
entre modules** du code. Les questions ouvertes (A, contextes C01‑C18) ne sont pas tranchées ici : quand le
code a besoin d'un comportement provisoire, il est marqué **[P]** (proposition) et rendu administrable ou
réversible.

## 1. Niveaux et modules

| Module (dossier `api/src/modules/…`) | Niveau | Dépend de | Natures d'objets (préfixe ID) |
|---|---|---|---|
| `users` — Gestion des utilisateurs | 0 transverse | — | `user` (usr) |
| `administration` — Administration | 0 transverse | — | (paramètres, journal : collections système) |
| `object-management` — Object Management (routes de debug) | 0 transverse | — | — |
| `calendar` — Calendrier (service paramétrable) | 0 transverse | users | — (lit les natures déclarées au registre) |
| `core` — Noyau transverse | 1 | users | `coreProject` (prj), `task` (tsk) |
| `budget` — Budget Management (middleware) | 2 | core | `budget` (bud), `costCenter` (cc), `operation` (op), `recurrence`, `projectOverrun` (ovr), `taskBudgetRequest` (dmt) |
| `patrimoine` — Patrimoine Management (middleware) | 2 | core, budget | `patrimoine` (pat), `capitalization` (cap), `lifeGoal` (obj) |
| `bpm` — Budget/Patrimoine Management (application) | 3 | core, budget, patrimoine | `bpmComposition` (bpm), `cycleLink` (cyc), `closure` (clo) |

Règle : un module ne dépend que de modules de niveau inférieur ou égal (vérifié par `Registry.register`).
Un niveau supérieur **enrichit** un niveau inférieur par des **extensions** (inversion de dépendance) : le
noyau ne connaît ni Budget ni BPM.

**Répartition des responsabilités.** Le noyau est la colle des trois niveaux (projets, tâches, Object Management) et
reste minimal. Les deux middlewares portent **toutes** les règles métier et fonctionnelles de leur domaine (Budget :
opérations, récurrences, règlements, plafonds, financement des projets de la vie ; Patrimoine : stock, capitalisations, objectifs datés et projections). BPM est le module applicatif : il compose les objets, porte le cycle et les clôtures, et prend en
charge la complexité de l'interface — présentation, facilitation (raccourcis, parcours guidés), enchaînements de cause à
conséquence. Il ne réécrit pas une règle d'un middleware : il appelle ses commandes et affiche ses refus. Côté site,
les gestes de financement passent par un seul service (`web/src/app/bpm/ui/project-funding.ts` : `ProjectFunding`,
vocabulaire `FUNDING`, libellés d'actions `FUNDING_ACTIONS`), partagé par la fiche d'échéance, la page projet, la
gestion des projets et la page projet de vie.

## 2. Socle technique (`api/src/socle`)

- `registry.mjs` — `Registry` : modules, natures d'objets, préfixes, `collect(field)`, `extensions(name)`, `composition(name)`.
- `store.mjs` — `JsonStore` : fichier JSON révisé, mutations sérialisées, écriture atomique. **Écrivain unique** : verrou `<fichier>.lock` (PID) — une seconde instance, du même processus ou d'un autre, est refusée (`STORE_LOCKED`) ; avant chaque écriture, l'empreinte du fichier est comparée à la dernière lue/écrite et un fichier modifié par ailleurs est refusé (`PERSISTENCE_CONFLICT`), sans rien écraser. Garantie : pas de perte silencieuse entre instances sur un même disque local ; pas de multi-écrivain.
- Migrations : chaque module déclare `migrations: [{ from, id, description, apply(draft, tx, socle) }]` ; au chargement d'un schéma ancien (`j1-store/0.2`, `socle-store/0.3`, `socle-store/0.4`), elles s'exécutent dans une seule mutation, conservent les IDs et sont tracées dans `state.migrations`. Schéma courant : `socle-store/0.6` (migration depuis 0.5 incluse).
- `clock.mjs` — `today()` : date du jour du socle (`SOCLE_TODAY` en recette).
- `object-management/object-manager.mjs` — `ObjectManager` (`socle.om`) :
  - `om.command(action, ctx, input, fn, { creation?, anonymous? })` → **seul chemin d'écriture**. Une écriture atomique ; `creation: true` exige `input.requestKey` (idempotence) ; journal automatique.
  - dans `fn(tx)` : `om.create(tx, kind, fields)`, `om.update(tx, obj, patch)`, `om.checkRevision(obj, n)`, `om.owned(tx.draft, kind, id, tx.userId)`, `om.reference(tx.draft, {field, id, kinds, userId})`. `tx = { draft, userId, command, requestKey, now, created, updated, unchanged, input }`.
  - les références déclarées dans `kinds[k].references` sont contrôlées à chaque `create`/`update` (existence, nature, même user).
- `object-management/inspect.mjs` — `Inspector` (`socle.inspector`) : inventaire, inspection, relations, contrôles, `exportDebug`, CSV. Les modules contribuent `debug.views`, `debug.csv`, `debug.derivedRelations`, `debug.inspect`, `checks`.
- `parameters.mjs` — `Parameters` (`socle.parameters`) : paramètres déclarés par les modules, valeur effective (défaut du code / administration), révision, historique.
- `calc/formula.mjs` + `calc/metrics.mjs` — `MetricEngine` (`socle.metrics`) : **chaque chiffre présenté est une métrique** dont la formule est le paramètre administrable `metric.<clé>`. `metrics.evaluate(ctx, key)` renvoie valeur, formule, révision du paramètre, explication substituée, entrées (variables avec leurs objets sources, ou métriques imbriquées). Valeur inconnue = `null`, propagée, jamais remplacée par 0 sans `siInconnu(x, 0)` explicite.
- `validation.mjs` — `text`, `date`, `money` (euros → centimes entiers), `integer`, `oneOf`, `expectedRevisionOf`, `pick`.

## 3. Contrat d'un module

```js
export default {
  id, label, level, dependsOn: [],
  kinds: { kind: { collection, prefix, label, references: { field: { kind, required? } } } },
  parameters: [{ key, label, type: 'formula'|'number'|'integer'|'text'|'list'|'boolean', default, group, description, min?, max?, validate? }],
  variables:  [{ name, label, unit, description, resolve(ctx, socle) => ({ value: number|null, sources: [{ id, kind, label, amount, date }], note? }) }],
  metrics:    [{ key, label, unit: 'EUR'|'%', decimals, group, description, formula }],
  extensions: { /* voir §4 */ },
  compositions: { name: (tx, input, socle) => result },
  checks(state, socle) => [{ rule, category: 'integrity'|'pathway'|'not-implemented', description, expected, observed, result: 'passed'|'failed'|'warning'|'not-run', ids }],
  debug: { views(state, scope, socle) => ({ viewName: rows }), csv: { 'file.csv': { view, columns } }, derivedRelations(state) , inspect(state, obj, socle) },
  setup(socle) => service,          // exposé sous socle.modules[id]
  routes(socle) => [[method, path, async ({ ctx, params, body, query }) => result]],
};
```

Contexte de métrique : `ctx = { state, userId, period: { key, start, end } | null, budgetId, patrimoineId }`,
fourni par l'extension `metricContext` du niveau 3.

## 4. Extensions (niveaux supérieurs → inférieurs)

| Extension | Fournie par | Consommée par | Signature |
|---|---|---|---|
| `coreProjectContext` | budget, patrimoine, bpm | core | `(state, projectId, socle) => partial { enrichment?, pathways? }` fusionnés |
| `taskContext` | bpm | core | `(state, task, socle) => { qualification }` |
| `operationGuard` | bpm | budget | `(state, { userId, budgetId, date, previousDate }, socle) => void` (lève `PERIOD_CLOSED`) |
| `metricContext` | bpm | administration (aperçu de formule) | `(state, userId, socle, { periodKey? }) => ctx` |
| `taskMoveGuard` | budget (financement) | core | `(state, { task, fromProjectId, toProjectId }, socle) => void` : peut refuser un changement de projet (`FORBIDDEN_BY_RULE`, `details.links`) |
| `onTaskStatusChange` | budget (financement) | core | `(tx, { task, previousStatus }, socle) => effects[]` : dans la même écriture que le changement d'état ; effets rendus par la commande (`effects`) |
| `settlementGuard` | budget (financement) | budget | `(state, { userId, budgetId, direction, amountCents, realizedDate, taskId, operationId, recurrenceId, occurrenceDate }, socle) => void` : validation d'un règlement (lève `OVERRUN_AUTHORIZATION_REQUIRED`) |
| `fundingPeriod` | bpm | budget (financement) | `(state, userId, ymd, socle) => { key, start, end } \| null` : période du cycle qui contient la date (datation de la facturation des dépassements) |

Compositions enregistrées : `initialUserBundle` (bpm) déclenchée par `users.createUser` ; dans une seule
transaction : user → projet noyau principal → Budget « Projet de vie » → Patrimoine → composition BPM → liaison de cycle.

## 5. Services exposés (signatures fixées)

### users (`socle.modules.users`)
- `createUser(input{requestKey, label, userType, ...bundle})` — commande `createUser` (anonyme, création). Appelle la composition `initialUserBundle` si enregistrée. Renvoie `{ userId, ...résultat composition, replayed }`.
- `updateUser(ctx, id, {label?, userType?, expectedRevision})`, `listUsers()`, `buildUser(tx, {label, userType})`.

### core (`socle.modules.core`) — niveau 1
- Builders : `buildProject(tx, {title, description, priority, startDate, dueDate})`, `buildTask(tx, {..., projectId})`.
- Commandes J1 conservées : `createCoreProject`, `updateCoreProject`, `createTask`, `updateTask`, `attachTask`, `detachTask`, `changeTaskStatus`, `setTaskTime`.
- Lectures : `listProjects(ctx)`, `readProjectDetail(ctx, id)`, `listTasks(ctx)`, `readTask(ctx, id)`.

### budget (`socle.modules.budget`) — niveau 2
- Builders : `buildLifeBudget(tx, { coreProjectId })` (unicité VIE-01, nom « Projet de vie », `role: 'life'`), `buildStandardBudget(tx, { coreProjectId, parentBudgetId, name })`.
- Lectures : `lifeBudgetOf(state, userId)`, `costCentersOf(state, userId)` (standards du type de user + personnalisés), `operationsOf(state, budgetId, { from, to })`.
- Commandes : `createOperation(ctx, {requestKey, budgetId?, direction, label, amount, date, status, costCenterRef})`, `realizeOperation(ctx, id, {expectedRevision, amount?, date?})`, `updateOperation(ctx, id, {...})`, `addCustomCostCenter(ctx, {requestKey, label, direction})`.
- Opération : `direction: 'income'|'charge'`, `amountCents` (prévu), `status: 'planned'|'realized'`, `realizedAmountCents`, `realizedDate`, `costCenterRef: 'std:<clé>' | <id costCenter>`, `recurrenceId`/`occurrenceDate` (règlement d'une occurrence), `note`, `taskId`. Une réalisation datée du futur est refusée (`FUTURE_REALIZATION`).
- Récurrences (`recurrence.mjs`) : définition `recurrence` (cadence `weekly|monthly|yearly`, `firstDate`, `endDate?`, montant, centre, note, tâche) ; occurrences virtuelles de clé `rec_…@AAAA-MM-JJ` (mensuelle bornée à la fin de mois) ; `settleOccurrence` crée l'opération réglée (double règlement refusé : `ALREADY_SETTLED`) ; `updateRecurrence` s'applique aux occurrences encore attendues, les règlements restent intacts et la première date/cadence sont figées dès le premier règlement.
- Moteur unique de lignes : `budgetLines(state, budgetIds, { from, to, by: 'planned'|'realized' })` — le registre sélectionne par date prévue, les sommes du réalisé par date réelle ; les six variables `budget.*` en dérivent.
- `setCaps(ctx, { caps, expectedRevision })` : plafonds facultatifs par centre de charge (`capsCents`).
- Financement des projets de la vie (`funding.mjs`, `socle.modules.budget.funding`) : règles et commandes de
  l'enveloppe attribuée par le budget de vie à ses Budgets standards, des parts des tâches, des retours, des demandes
  de part et des dépassements. Chiffres purs `fundingFigures(state, budget)` et `taskFunding(state, figures, taskId)`
  (part, engagé, réglé, reste, `openCents`, `paidBeforeCents`, `unusedCents` d'une tâche terminée) ; commandes
  `allocate`, `setTaskShare` (`authorizeOverrun: true` : le manque au-delà de l'enveloppe est autorisé dans la même
  écriture), `releaseTaskShare` (part non consommée d'une tâche terminée rendue à l'enveloppe), `setTaskReturn`,
  `requestTaskBudget`, `decideTaskBudget`, `requestOverrun` (`approve: true` : demandé et autorisé d'une écriture),
  `decideOverrun` (rend `notice` quand la demande liée revient au projet), `billOverruns` ; règlement financé
  `fundSettlement` : un règlement (`createOperation`, `updateOperation`, `realizeOperation`, `settleOccurrence`) passé
  avec `fund: true` porte d'abord la part de la tâche au nécessaire et autorise le dépassement éventuel, puis subit la
  garde ; builder `startTaskFunding(tx, budget, cents|null)` (enveloppe de 0 € refusée) ; extensions `settlementGuard`
  (part de tâche et enveloppe ; ses refus disent `grantOverrunCents` et `pendingCovers`), `taskMoveGuard`,
  `onTaskStatusChange` (retour au budget de vie). Les commandes rendent l'essentiel ; la fiche du projet est relue par
  BPM. Un geste de l'interface = une commande : l'interface n'enchaîne plus demande, décision et écriture rejouée.

### patrimoine (`socle.modules.patrimoine`) — niveau 2
- Builders : `buildPatrimoine(tx, { coreProjectId, principalBudgetId, openingStock?, openingDate?, objective? })` (unicité PAT-01), `buildCapitalization(tx, { patrimoineId, amountCents, date, source })`.
- Lectures : `patrimoineOf(state, userId)`, `stockOf(state, patrimoineId)` (sources détaillées).
- Commandes : `setOpeningStock(ctx, {amount|null, date, expectedRevision})`, `setObjective(ctx, {amount|null, expectedRevision})`.

### bpm (`socle.modules.bpm`) — niveau 3
- Composition `initialUserBundle`, commande `createLifeSubproject` (branche : Budget standard + projet noyau propre + ≥ 1 tâche).
- Projets de la vie (`projects.mjs`, `s.projects`) — les projets et tâches restent ceux du noyau (création et
  édition dans le noyau ; rattachement et état par ses commandes) ; leur financement (champs `allocationCents`,
  `allocationDate`, `taskSharesCents`, `taskReturns` des Budgets standards, natures `projectOverrun` et
  `taskBudgetRequest`) est exécuté par le middleware Budget (`budget/funding.mjs`) ; BPM compose les créations, ajoute
  le réglé de la période du cycle (`projectBudget`), rend les fiches et les contrôles de fin de cycle, et expose : `overview(ctx)`, `tasksOverview(ctx)`, `projectDetail(ctx, coreProjectId)`,
  `adoptProject(ctx, {requestKey, coreProjectId, name?})`, `allocate(ctx, budgetId, {amount, expectedRevision})`,
  `setTaskShare(ctx, budgetId, taskId, {amount|null, expectedRevision})`, `setTaskReturn(ctx, budgetId, taskId,
  {label, amount|null, cadence, expectedRevision})`, `requestOverrun(ctx, budgetId, {requestKey, taskId?, reason,
  amount})`, `decideOverrun(ctx, id, {decision, expectedRevision})`, `billOverruns(ctx, {budgetId?})`. Règles [P] :
  le budget attribué est une charge non récurrente spéciale du budget de vie (présentée, jamais totalisée) ; les
  charges d'un projet comptent dans le Dépensé du budget de vie à la validation de leur règlement, depuis la date
  d'attribution (`projets.chargesReglees`) ; tout dépassement (part ou règlement) attend l'accord du budget de vie,
  puis il est facturé à la fin de la période en cours du cycle et intégré au budget attribué ; contrôles PRJ-01 à 03.
- `dashboard(ctx)`, `explainFigure(ctx, key, {periodKey?})`, `configureCycle(ctx, {anchorDay, startDate, expectedRevision})`, `closePeriod(ctx, {requestKey, periodKey, expectedResultCents})` (aperçu partagé `closingContract`, refus `CLOSING_PREVIEW_STALE`), `closures(ctx)`. Une clôture enregistre `figures` (chiffres de la période) et `stockBeforeCents` ; `figuresFor` relit une période close avec ses chiffres enregistrés et une comparaison séparée.
- Parcours de clôture (`bpm/closing.mjs`, page « Clôture du cycle ») : suivi des **points** du cycle, puis clôture. Un point est un évènement qui demande une revue : échéance prévue du budget de vie (récurrente, ou saisie comme prévision : `entryStatus: 'planned'`), flux prévu d'un projet financé par le cycle, décision de financement en attente (`projectOverrun`, `taskBudgetRequest`), vérification du compte (bloquante, après le dernier jour). Il s'ouvre quand l'évènement entre dans le cycle (`enteredOn`, ou premier jour du cycle) et se clôt là où il vit (`closedAt` / `closedOn` posés par Budget au règlement ou à l'écart ; `decidedAt` d'une décision). `closingJourney(ctx)` : phase `running` (suivi, sans action de clôture) / `to_close` (mode clôture), points ouverts / clos / reportés / hérités, complétude = (clos + reportés) / points, impacts sur le cycle suivant ; `closingBrief(ctx)` (`GET /api/bpm/closing/brief`) : résumé lu par le cadre Astra (bandeau du mode clôture, point clos signalé à l'instant). `closingDecision(ctx, {periodKey, defer?: {pointId, toPeriodKey}, account?})` (décisions gardées sur la liaison de cycle, `closingPlan`, valables seulement en clôture) : un point non bloquant non validé se revoit dans le cycle choisi (le suivant pour une décision, jusqu'à 24 cycles pour une échéance). `finalizeClosing(ctx, {requestKey, periodKey, expectedResultCents})` : refusée sous 100 % (`CLOSING_INCOMPLETE`) ; en une écriture, clôture (marques des points reportés dans `journey.deferred`) + reports inscrits au premier jour de leur cycle (`budget.carryOverLine`, `carriedFrom` / `carriedTo`). Paramètre `bpm.verrouCycleSuivant` (actif par défaut) : tant qu'un cycle terminé attend sa clôture, il est en clôture (aucune prévision n'y entre : `CYCLE_IN_CLOSING`, gardes `operationGuard` via `opens` et `recurrenceGuard` via `opens`) et le cycle suivant attend (toute entrée datée de lui ou après : `CYCLE_AWAITING_CLOSURE`). `closePeriod` reste la clôture comptable seule (reprises de données, scénarios).
  - **Actions du cycle** (`bpm/cycle-actions.mjs`) : tout ce qui a été enregistré sur Astra et touche le cycle, classé en catégories (argent du quotidien, projets de la vie, budget récurrent, plafonds et postes, cap et patrimoine, cycle et clôture, autres). Sources : le journal du socle (limité aux 2 000 dernières commandes, tous users) et, avant son début, la création (`provenance`) et la dernière modification (`lastChange`) de chaque objet. Une écriture datée touche le cycle par ses dates (même faite en clôture) ; un réglage, s'il a été fait pendant le cycle. **Catalogue** : une commande du site = une ligne (objet principal, catégorie, verbe) ; une commande inconnue paraît dans « Autres actions », les commandes sans effet sur un cycle sont écartées. Toute nouvelle action du site s'ajoute au catalogue.
  - **Contrôles de cohérence** (`bpm/closing-checks.mjs`) : bloquants (points traités, compte vérifié, données intègres via l'inspecteur du socle, résultat recalculé à l'identique), à voir (mouvements sans poste, plafonds dépassés), pour information (écarts au prévu, règlements après le dernier jour). `finalizeClosing` est refusée tant qu'un contrôle bloquant échoue (`CLOSING_INCOHERENT`) et fige dans la clôture `journey.actions` (actions compactes) et `journey.checks` (historisation du cycle).
  - Page : une synthèse (anneau de complétude et une tuile par section) puis quatre sections, du plus important au moins crucial : 1 à valider, 2 résultat et cycle suivant, 3 cohérence, 4 clôturer ; les actions du cycle, consultatives, tiennent sur une ligne dépliable (`closing-journal.ts`). La page s'ouvre repliée : chaque section garde ses encadrés de chiffres clés et son tableau sur deux lignes (`closing-kit.ts`), le détail se déplie. Code couleur d'alerte commun (`AlertTone`) : vert pour ce qui est bon, puis bleu, jaune, orange et rouge selon la gravité. Chaque contrôle porte sa résolution (`resolution` : ce qui ne va pas, pourquoi, étapes avec l'endroit où agir, progression ; éléments avec leur cible), présentée par `closing-resolution.ts` ; l'état au dernier passage (stockage de session) dit, au retour, ce que l'action a changé. Partout où un problème s'affiche (points à valider, compte, étapes et éléments de la cohérence, barre d'actions), « Régler le problème », à gauche du lien vers la page qui le corrige, ouvre le formulaire du site **en fenêtre sur la page de clôture même** (`closing-dialogs.ts`), pour continuer à vérifier et corriger ce qui reste : fiche de l'échéance (`bpm-line-detail`, échéances et flux des projets), carte de décision du projet (`bpm-overrun-request`, `bpm-task-requests`, gestes `ProjectFunding`), comparaison du Rapprochement bancaire (`bpm-bank-reconciliation`, confirmation du compte en clôture), plafond du poste (`bpm-cap-dialog`), saisie d'un mouvement manquant déjà réglé (`bpm-entry-flow`, `defaults.status: realized`). Une page de liste sans formulaire unique garde seulement son lien ; ses éléments ont chacun leur fenêtre.
- Préparation (C06) : `preparation(ctx)` (prêt / à préparer / incohérent, sans écriture) et `prepareComposition(ctx)` ; contrôle BPM-01 « exactement un » ensemble principal.
- Lectures communes (`reads.mjs`, `s.reads`) : `summary`, `register`, `lineDetail`, `centers`, `centerDetail`, `incomes`, `balance` (avec rapprochement), `history` (paginé), `impact`, `budgetType`, `due`, `events`, `directives`, `projection` (+ simulation `extra`, comparaison des apports), `previewEntry` (aucune mutation). Chaque lecture porte le contexte commun (user, périmètre, budgets, période début inclus/fin exclue, date de calcul, révision).
- Partir de zéro : `setupProfile(ctx)` et `setupProject(ctx, input)` — une commande rejouable ; mode `principal` (configure l'ensemble existant, met à jour les lignes du budget type sans les recréer) ou `branch` (Budget standard + projet noyau + ≥ 1 tâche, sans second Patrimoine).
- Vision et objectifs : `updateVision`, `goals`, `createGoal`, `updateGoal`, `removeGoal` (archivage `removed`) ; projection déléguée à `patrimoine/projection.mjs` (convention annuelle de la spec, objectifs consommant/réservant le capital).

### calendar (`socle.modules.calendar`) — transverse
- Moteur unique (`engine.mjs`) piloté par une configuration ; aucune extension à déclarer par les autres modules.
  `read(ctx, id, {from, to})` lit le calendrier nommé (paramètre `calendrier.<id>`), `preview(ctx, {configuration,
  from, to})` une configuration fournie à l'appel (contrôlée par `validateConfiguration`), `list()`, `catalog()`.
- Lecture seule des objets **du user du contexte**, par nature du registre (collection déclarée) ; fenêtre bornée
  (400 jours). Références (`reference`), paramètres (`parametre`), objets reliés (`relies`) et répétitions
  (`repetition`) sont résolus par le moteur, sans code propre à un module.
- Replanifier n'est jamais une écriture du calendrier : la configuration nomme la commande de l'API du module
  propriétaire (`replanifier: { methode, route, champ, si }`) ; le site l'appelle avec la révision lue, et les
  règles, refus et conflits restent ceux de ce module.
- Repère produit : `{ key, element, nature, objectId, revision, date, title, done, status, statusLabel, urgent,
  groupId, groupLabel, amountCents, direction, link, details[], reschedule }`.

## 6. Ce qui reste ouvert (non tranché par le code)

C03 (paramètres obligatoires à la création), C05 (flux père/enfants : tranché le 4 novembre 2026 pour les projets
auxquels le budget de vie attribue un montant — voir `projects.mjs` ; les projets sans montant attribué restent
présentés séparément, sans consolidation),
C06 (réalisation automatique : non implémentée, réalisation manuelle [P] ; une échéance d'une période close peut être réglée plus tard, à sa date réelle, sans modifier l'historique clos [P]), C07 (cycle mensuel seul et clôture
explicite d'une période terminée [P] ; source d'une période close refusée [P]), C08 (centres standards
administrables [P]), C09 (stock = ouverture + résultats capitalisés, formule administrable [P]), C10
(objectif = montant, information seule [P]), C04 (pas d'authentification : contexte user par en-tête).
Consolidation père/enfants : non définie — les lectures présentent chaque Budget séparément (`impact.consolidated.status = 'not-defined'`). Allocations patrimoniales, versements entre actifs et phases : aucun contrat — non exposés. Cycles hebdomadaire/annuel et rattrapage automatique : non activés.


## 7. Frontières renforcées — 7 novembre 2026

Le noyau reste propriétaire des projets et des tâches. Les middlewares enrichissent ces racines ;
BPM assemble les réponses pour les pages et compose leurs commandes dans une transaction unique.

| Responsabilité | Propriétaire | Consommation par BPM |
|---|---|---|
| Création et validation des projets/tâches | Noyau | Builders et commandes du noyau ; aucune écriture directe |
| Opérations, récurrences, centres, plafonds | Budget | Builders et fonctions transactionnelles communes avec les routes du middleware |
| Enveloppes, parts, contrôles financiers, charges consolidées | Budget (`funding`, `project-analysis`) | Présentation des chiffres, messages et actions retournés |
| Dates et politique du cycle | Budget (`periods`, `cycle-policy`) | Contexte fourni par BPM, sans réimplémentation des interdictions |
| Épargne visée et objectif d’excédent | Budget (`budget.objectives`) | Formulaire agrégé et présentation de progression |
| Stock, capitalisations, hypothèses et objectifs datés | Patrimoine (`projectionSettings`, `lifeGoal`) | Façade `/api/bpm/vision` et `/api/bpm/goals`, contrats HTTP conservés |
| Navigation, regroupements, libellés, graphes, filtres | BPM | Modèles de lecture et composants Angular |
| Composition, lien de cycle et reçu de clôture | BPM | Coordination des deux middlewares, pas une deuxième comptabilité |

Les objets `lifeGoal` ont deux références obligatoires : `patrimoineId` et `coreProjectId`.
Leur projet noyau est celui du patrimoine unique. Un projet de la vie possède sa propre racine et un
budget standard ; son budget père le rattache à la composition BPM du projet de vie et au patrimoine
unique. Aucun patrimoine supplémentaire n’est créé pour une branche. Les contrôles `PAT-OBJ-01` et
`BPM-02` vérifient ces liens, en plus des contrôles Object Management existants.

L’assistant BPM emploie `core.patchProject`, `budget.buildCostCenter`, `budget.patchRecurrence`,
`budget.patchCaps` et `patrimoine.patchPatrimoine`. Ces fonctions acceptent la transaction du socle :
il n’y a ni écritures imbriquées ni enregistrement partiel. Les routes autonomes appellent les mêmes
fonctions après contrôle de révision. Une récurrence d’un autre budget ne peut plus être modifiée par
le parcours courant ; une date de fin invalide ou un plafond sur un poste inconnu annule toute la commande.

La migration 0.6 déplace les réglages `bpmComposition.vision` vers les objets Budget et Patrimoine,
rattache les objectifs à leur racine et conserve leurs IDs, montants et dates. La révision de la
composition continue à protéger le formulaire agrégé. Une clôture BPM reste un reçu d’orchestration
avec les chiffres enregistrés et la référence de capitalisation exécutée par Patrimoine.

Les tests `api/test/bpm-boundaries.test.mjs` couvrent les écritures autorisées, l’absence d’import
ascendant, l’autonomie des middlewares sans BPM, la migration et sa reprise, les références et les
refus atomiques. Le contrôle des frontières doit être étendu à chaque nouvelle fonction transactionnelle.


## 8. Organisation du site Angular — 12 novembre 2026

| Dossier `web/src/app` | Rôle |
|---|---|
| `navigation/` | Moteur générique : configuration, surfaces, libellés (`navigationLabel`), réglages `/navigation`. Aucune connaissance des pages. |
| `plan/` | Plan du site (zones → sections → pages, `locate`) et ses projections : adaptateur vers le moteur, espaces et onglets de page, menu de section, libellés d'objet (`publishObjectLabel`), parcours unifié (`Journey`, barre Retour/Mon parcours/Suivant, bloc « Reprendre »). |
| `core/` | Clients HTTP : `ApiService` (transverse, noyau, middlewares) et `BpmApi` (seul client des routes `/api/bpm/*`). |
| `bpm/` | Pages et composants du niveau 3 : présentation et interaction, aucune règle métier. |

Le parcours couvre toute page appartenant à une zone du plan (noyau, middlewares, BPM, administration) ;
le portail et les adresses externes n'en font pas partie. Les fiches d'objet publient leur nom via
`publishObjectLabel` pour que le parcours, le fil et les onglets l'affichent. Une fiche BPM renvoie à sa
racine noyau (« Racine noyau ↗ ») et la fiche noyau à son enrichissement Budget/Patrimoine.

Parité des parcours (audit ARCH-01, 02, 03, 10) : l'aperçu d'une saisie exécute les constructeurs Budget sur
une copie de l'état (`om.simulate`) puis lit les mêmes métriques que la synthèse ; le règlement d'une
échéance passe par un seul contrôleur web (`bpm/ui/settlement.ts`) depuis la ligne rapide comme depuis la
fiche ; `setupProject` accepte `expectedRevisions` ; le seuil « proche du plafond » n'existe que dans Budget.
Il en va de même des niveaux de consommation d'un plafond (`CAP_LEVEL_PCT` : 50, 75 et 90 % ; « proche » à 90 %) : Budget
rend le niveau de chaque poste et les seuils, et le site colore ses jauges avec eux sans écrire aucun seuil.
Le relief et les effets visuels viennent des jetons d'ombre (`_tokens.scss`) et de `_elevation.scss`.

## 8. Principes d'architecture appliqués par le socle — 16 novembre 2026

Cinq principes nommés (`api/src/socle/principles.mjs`, exposés par `GET /api/om/architecture`). Ce ne sont pas des
conventions : le socle refuse leur contournement et `api/test/principles.test.mjs` les vérifie.

| | Principe | Règle | Mécanisme | Refus |
|---|---|---|---|---|
| P1 | **Sens unique** | La couche du dessous ne connaît pas celle du dessus. Un module ne voit que les modules qu'il déclare (`dependsOn`), de niveau inférieur ou égal ; le dessus enrichit le dessous par extension. | `socle/scope.mjs` : chaque module reçoit une **portée** dans `setup` et `routes` ; `socle.modules.<x>` non déclaré est refusé. Extensions, compositions, résolveurs et migrations s'exécutent dans la portée de leur fournisseur. | `LAYER_VIOLATION` |
| P2 | **Écriture unique** | Tout objet naît et change par une commande d'Object Management ; seul le module propriétaire d'une nature écrit ses objets. | État publié **gelé** en profondeur ; `om.create/update` réservés au propriétaire (`om.for(module)`) ; contrôle de sortie de transaction (objet apparu sans `om.create` ou disparu) ; pas d'écrivain du stockage dans la portée d'un module. | `WRITE_OUTSIDE_DOMAIN`, `UNTRACKED_WRITE` |
| P3 | **Façade publique** | Entre modules, on n'importe que `api.mjs`, et seulement d'une dépendance déclarée. | `modules/budget/api.mjs`, `modules/patrimoine/api.mjs` ; test d'architecture sur les imports. | test |
| P4 | **Lecture déclarée** | Un module ne lit que ses natures et celles qu'il déclare (`reads`), appartenant à ses dépendances. | Contrat `reads` contrôlé par `Registry.register` ; test d'architecture sur les accès `state.<collection>` et `om.get/list/owned`. | erreur d'enregistrement, test |
| P5 | **Données gérées** | Les données passent par un système de gestion à deux étages ; chaque module a son schéma ; l'applicatif est séparé du technique. | `socle/data/` (voir ci-dessous). | `DATA_ENGINE_UNAVAILABLE` |

Conséquences : Budget ne lit plus les données de Patrimoine (extension `rootHolders`, fournie par Patrimoine) ;
Patrimoine déclare `users` ; BPM n'importe plus les fichiers internes des middlewares et déclare ses douze lectures.
Les tests qui modifiaient l'état en place passent par la voie d'administration (`socle.store.mutate`, réservée à
l'assemblage du socle, aux scripts et aux tests ; absente de la portée des modules).

### Système de gestion des données (`api/src/socle/data/`)

- **Couche de gestion** — `data-manager.mjs`, `DataManager` (`socle.data`, alias `socle.store`) : catalogue des schémas,
  état logique publié (gelé), transactions en série, révision, schéma de version et migrations. Elle ignore la façon
  dont les données sont stockées.
- **Catalogue** — `schemas.mjs`, dérivé du registre : `technique.socle` (journal, paramètres, reçus, migrations),
  puis un schéma par module (`technique.users`, `noyau.core`, `middleware.budget`, `middleware.patrimoine`,
  `application.bpm`). Chaque schéma appartient à un **espace de stockage** : `socle` pour le technique, le noyau et
  les middlewares ; un espace propre par application (`application.bpm`).
- **Couche de stockage** — `engines/`, choisie par `SOCLE_DATA_ENGINE` ou `createSocle({ dataEngine })` :
  - `sqlite` (en service depuis le 24 novembre 2026, SQLite intégré à Node, `engines/sqlite.mjs`) : une base, un
    fichier (`api/data/store.sqlite`). Une table par collection, **préfixée par la section du site** qui la porte :
    `MQ_` Mon quotidien (operations, imports, calendarPreferences), `MP_` Mes projets (coreProjects, tasks,
    projectOverruns, taskBudgetRequests), `MB_` Mon budget (budgets, recurrences, costCenters, chargeCategories),
    `PT_` Patrimoine (patrimoines, capitalizations, lifeGoals), `CL_` Cycles (cycleLinks, closures, bpmCompositions),
    `SY_` système (users, parameters, creationRequests et toute collection hors de ces sections). Colonnes : `id`,
    `user_id`, `revision` de la dernière écriture, `data` (objet complet en JSON). `SY_tables` note la table, la
    section et l'espace de chaque collection ; `SY_store` les valeurs simples (version, révision, migrations…) ;
    `SY_journal` le journal, où l'on ne fait qu'ajouter (toute l'histoire est gardée, l'état n'en lit que la fin).
    Une écriture est une transaction qui n'écrit que les objets créés, modifiés ou supprimés. Verrou d'écrivain unique
    (`store.sqlite.lock`) et refus `PERSISTENCE_CONFLICT` si la révision enregistrée a changé ailleurs.
    **Reprise des fichiers JSON** : au premier démarrage sans base, un stockage JSON (`store.json`, toutes dispositions)
    est copié dans une base neuve, relu et comparé clé par clé, puis rangé dans `store.archives/json-avant-sqlite-<date>/`.
    Les fichiers JSON ne sont plus un moteur (`json-files.mjs` ne sert qu'à cette reprise et aux copies d'un bloc).
  - **Copie à la demande** (`DataManager.mutate`) : une transaction ne copie que les collections qu'elle lit ou
    écrit ; les autres gardent l'objet publié, et le moteur ne les resérialise pas. Le contrôle de sortie (P2)
    ignore les collections jamais touchées.
  - **Outils d'administration** (`socle/store.mjs`, réservés aux scripts) : `readStoredState` (lire l'état de la base, ou d'un
    stockage JSON pas encore repris), `snapshotStore` (copie d'un seul bloc, rouvrable telle quelle comme stockage),
    `removeStore` (effacer la base). Les scripts d'import et de jeux d'essai les utilisent.
  - `sgbd` (PostgreSQL, pour un site hébergé à plusieurs) : contrat posé (`open`, `read`, `assertUnchanged`, `write`, `close`, `describe`), **non codé** ; le choisir
    lève `DATA_ENGINE_UNAVAILABLE`.
- Non traités à ce stade : historique des objets, identité des utilisateurs. Une commande copie encore en mémoire
  chaque collection qu'elle lit (environ 80 ms par enregistrement sur les données de recette) : lire sans copier
  demande qu'Object Management cesse de modifier les objets en place.

### Limites connues

- `checks` et `debug` des modules reçoivent encore le socle entier (diagnostic en lecture seule).
- Un champ modifié en place dans une transaction sans `om.update` n'est pas détecté (seules l'apparition et la
  disparition d'objets le sont).
- Patrimoine dépend de Budget ; la notion de cycle vit dans Budget.
- Côté site, la structure de navigation reste déclarée dans des fichiers centraux.

## 9. Middlewares typés et indépendants (P6) — 16 novembre 2026

Le niveau 2 distingue trois rôles, portés par le champ `role` du contrat de module et contrôlés par le registre :

| Rôle | Sert | S'appuie sur | Modules |
|---|---|---|---|
| **Middleware métier** (`metier`, défaut) | les applications | noyau, transverses, middlewares techniques et transverses ; **jamais un autre middleware métier** | `budget`, `patrimoine`, `navigation` (Navigation system : l'organisation de l'information) |
| **Middleware technique** (`technique`) | les middlewares métier uniquement | le niveau du dessous uniquement | `cycle` (Cycle et temps : périodes, politique de clôture, cadences) |
| **Middleware transverse** (`transverse`) | les middlewares métier et les applications | le niveau du dessous uniquement | `calendar` |

- Le cycle, les périodes et les cadences sont sortis de Budget (`modules/cycle/`). Budget et Patrimoine en dépendent
  tous deux ; une application y accède par la façade du middleware métier qu'elle utilise.
- Patrimoine ne dépend plus de Budget et ne lit plus ses données. La règle « le Patrimoine partage la racine du
  Budget de vie » passe par l'extension `lifeAnchor`, fournie par Budget ; Budget connaît les autres tenants d'une
  racine par l'extension `rootHolders`, fournie par Patrimoine. Deux middlewares métier se parlent par extension.
- Limite : `patrimoine.principalBudgetId` reste une référence d'identité vers la nature `budget`, vérifiée par le
  noyau (existence, même utilisateur), sans dépendance de module.
- Les modules de niveau 0 (`users`, `administration`, `object-management`) restent le socle technique commun.

## 10. Applications déclarées — 16 novembre 2026

Une application de niveau 3 s'ajoute par deux déclarations (module serveur, déclaration d'application
du site) et deux lignes d'inscription (`SOCLE_MODULES`, `APPLICATIONS`). L'application BPM est déclarée
par BPM-Astra (`web/src/app/astra/astra.application.ts`) ; le plan, les sous-pages, les actions, les sections de
contenu, les fiches et les routes sont assemblés par la plateforme (`web/src/app/platform/`).
Mode d'emploi, contrôles et limites : `docs/APPLICATIONS.md`.

## 11. Feuille de styles globale — 24 novembre 2026

Une seule feuille globale, `web/src/styles.scss`, réunit dans l'ordre de la cascade toutes les couches de
`web/src/styles/` (socle visuel, calendrier, habillages, présentation BPM, passerelle des composants, module
Calendrier et projets, cadres et niveaux, cadre des applications et BPM-Astra). Elle remplace les huit feuilles du
découpage du 17 novembre (`styles`, `styles-calendar`, `styles-rest`, `-b`, `-c`, `styles-pages-a/b/c`) et
leurs chargeurs à la demande (`platform/page-styles.ts`, `loadCalendarStyles`) : BPM-Astra étant l'application
par défaut, toutes les pages s'en servaient. Le rendu a été comparé élément par élément sur 15 pages : identique.
Chargement initial : environ 1,17 Mo (200 Ko transférés) ; limite dans `angular.json` : avertissement à 1,3 Mo,
échec à 1,5 Mo. Les styles propres à un composant restent dans leur fichier, à côté du composant.

Sans utilisateur choisi, le site n'envoie plus les lectures qui en exigent un : il répond lui-même
`CONTEXT_REQUIRED` (`core/api.service.ts`, liste gardée par `api/test/anonymous-reads.test.mjs`).

## 12. Vue d'ensemble recentrée et présentation sobre — 17 novembre 2026

L'accueil de BPM (`/zones/bpm`, `bpm/pages/overview.ts`) est la synthèse des deux visions, toujours dans
cet ordre : 1 · Ma vision budgétaire (entrées, sorties, solde prévu, santé), 2 · Mes projets de la vie
(ce que le budget finance : enveloppes, projets, décisions), 3 · Calendrier (les prochains événements,
lus tels quels dans le calendrier de l'application), puis le patrimoine. Aucun calcul métier dans la page.
La présentation sobre des applications tient dans une seule feuille, dernière de la cascade
(`styles/_bpm-sober.scss`) : angles nets, étiquettes rectangulaires, chiffres alignés ; couleurs inchangées.

## 13. BPM en cockpit — 17 novembre 2026

Règle d'interface : toute information présentée s'accompagne du geste qui permet d'agir dessus, sur
place. Première page convertie : la Synthèse (`/zones/bpm`, page « Synthèse », onglet « Ma synthèse »).
Elle ouvre sur « À faire maintenant » (échéances, décisions, clôtures, santé), puis offre : régler une
échéance en ligne (`bpm-act-due-row`, même règlement que partout), saisir une entrée ou une dépense,
accorder ou refuser une demande (`ProjectFunding`), la prochaine action de chaque projet, traiter ou
reporter un événement du calendrier, régler le cap patrimonial. Aucune règle métier nouvelle : la page
appelle les commandes existantes. Pages modèles : Projets par statut et Tâches des projets.
Ordre prévu pour la suite : Tableau de bord, Gestion du projet de vie, Plafonds, Objectifs et avenir,
Projets et financement, Calendrier.

### Cockpit : pages converties (17 novembre 2026, suite)

Un geste commun, `bpm-quick-settle` (`bpm/ui/quick-settle.ts`) : régler une échéance là où elle est
affichée, à la date du jour et au montant prévu, par le service `Settlement` (mêmes vérifications de
plafonds, même confirmation, mêmes refus). Il accepte la ligne du registre ou sa forme allégée, dont il
relit la ligne complète avant d'écrire. La place des gestes sur les lignes est dans `styles/_bpm-cockpit.scss`.

| Page | Gestes ajoutés |
| --- | --- |
| Tableau de bord | Payé / Reçu sur chaque échéance ; « Budget et décisions » et « Tâches » par projet ; « Ajuster les plafonds » sur l'alerte |
| Registre de flux, détail d'un poste | Payé / Reçu sur chaque échéance ouverte |
| Gestion du projet de vie | Colonne « Action » (Payé / Reçu) dans tous ses tableaux d'échéances |
| Plafonds et catégories | « Ajuster ce plafond » et « Voir ses dépenses » sur chaque marge de compensation |
| Objectifs et avenir | Selon l'état : « Reporter d'un an », « Ajuster l'épargne », « Revoir le scénario », « En faire un projet » |
| Projets et financement | Accorder / Refuser une demande sur place ; attribuer une enveloppe dans le tableau ; prochaine action par projet |
| Calendrier | Inchangé : il reflète les événements ; ouvrir et replanifier un repère existaient déjà |

## 12. BPM-Astra devient l'application BPM — 21 novembre 2026

L'ancienne application BPM (zone « Budget/Patrimoine Management », sections MPV, tableau de bord, cockpit
« Mon projet de vie », page Financement, pages de création) est retirée du site. **BPM-Astra est la seule
application BPM** et l'application par défaut : la racine du site l'ouvre (`defaultApplicationHome()`),
le portail des zones est à `/modules`.

- `web/src/app/bpm/` ne déclare plus d'application : `bpm.screens.ts` est le **catalogue des écrans
  métier** (chargement, données de route, sous-pages, sections de contenu) qu'Astra présente, sous la clé
  de leur ancienne adresse. BPM ne nomme pas Astra ; la dépendance va d'Astra vers BPM (`builtOn: 'bpm'`).
- `web/src/app/astra/` déclare l'application : les trois parties, la navigation, le cadre, les actions
  (N4), les sections de contenu traduites à ses adresses et les actions rapides de la palette.
- Toutes les anciennes adresses BPM (`BPM_LEGACY_PATHS`) sont des redirections vers leur équivalent Astra,
  en gardant la lecture (période, filtres, fragment). Vérifié par `app.routes.spec.ts`.
- L'atelier `/navigation` et son aperçu travaillent sur l'application par défaut (plus de zone écrite en dur).
- Écrans BPM devenus inatteignables supprimés (tableau de bord, cockpit, financement, création, gestion de
  projet, et leurs composants) ; la compilation et l'atteignabilité sont vérifiées.
- L'API ne change pas : `/api/bpm/*` reste l'API de l'application BPM, servie à BPM-Astra.
