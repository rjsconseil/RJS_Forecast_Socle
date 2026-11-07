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
