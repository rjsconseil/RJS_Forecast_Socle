# RJS Forecast — socle et application Budget/Patrimoine

Socle à trois niveaux (noyau, middlewares, application) plus des modules transverses, exposé par une API
Node sans dépendance et un site Angular. Le contrat détaillé entre modules est dans
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ; ce fichier en donne la vue d'ensemble et le mode d'emploi.

## Lancer

```bash
npm install --prefix web
npm start          # API (http://localhost:3410) et site (http://localhost:4300) ensemble ; Ctrl+C arrête les deux
npm run api        # API locale http://localhost:3410 (réinitialisation de recette activée)
npm run seed       # jeux d'essai via les contrats HTTP réels (API lancée, voir plus bas)
npm run import:rjs-forecast -- --remplacer   # données du site de référence voisin, ../RJS_Forecast (API arrêtée, voir plus bas)
npm run web        # site Angular http://localhost:4300 (proxy /api → 3410)
npm test           # tests node:test (api/test/*.test.mjs) sur persistance réelle
npm --prefix web test -- --watch=false   # tests unitaires du site (Vitest)
npm run build      # build de production du site
```

Variables d'environnement de l'API :

| Variable | Rôle |
|---|---|
| `J1_API_PORT` | Port de l'API (défaut `3410`). Lu aussi par `npm run seed`. |
| `J1_DATA_FILE` | Fichier JSON de persistance (défaut `api/data/store.json`). |
| `J1_ENABLE_RECETTE_RESET=1` | Active `POST /api/_recette/reset` (utilisé par le seed). `npm run api` l'active. |
| `J1_ENABLE_FAULT_INJECTION=1` | Accepte `_fault: "before-commit"` pour simuler une interruption avant écriture. |
| `SOCLE_TODAY=AAAA-MM-JJ` | Fixe la date du jour du socle (périodes, période courante, dates par défaut). Utile en recette ; les tests la fixent à `2026-11-03`. Le seed, lui, calcule ses dates à partir de la date réelle : ne pas lancer l'API avec `SOCLE_TODAY` avant `npm run seed`. |

Exemple d'API privée pour des essais : `SOCLE_TODAY=2026-11-03 J1_API_PORT=3501 J1_DATA_FILE=/tmp/essai.json J1_ENABLE_RECETTE_RESET=1 node api/src/server.mjs`.

## Architecture : trois niveaux et des modules transverses

| Niveau | Module (`api/src/modules/…`) | Rôle | Natures d'objets (préfixe d'ID) |
|---|---|---|---|
| 0 transverse | `users` | Gestion des utilisateurs ; le type (individuel, famille…) est un paramètre | `user` (usr) |
| 0 transverse | `administration` | Paramètres effectifs, formules des chiffres, journal, erreurs récentes | — |
| 0 transverse | `object-management` | Inventaire, inspection, relations, contrôles, export debug et CSV | — |
| 0 transverse | `calendar` | Calendrier : un seul moteur, piloté par sa configuration (paramètre `calendrier.<id>`), lit les données du user et produit des repères datés (semaine, mois, année) | — |
| 1 noyau | `core` | Projets et tâches, 7 états dérivés, complétude, temps | `coreProject` (prj), `task` (tsk) |
| 2 middleware | `budget` | Budgets (« Projet de vie », Budgets standards), centres de coût, opérations prévues / réalisées, définitions récurrentes et leurs occurrences, plafonds | `budget` (bud), `costCenter` (cc), `operation` (op), `recurrence` (rec) |
| 2 middleware | `patrimoine` | Patrimoine unique par user, stock d'ouverture, objectif, capitalisations | `patrimoine` (pat), `capitalization` (cap) |
| 3 application | `bpm` | Application Budget/Patrimoine : composition du user, cycle et périodes, clôtures, projets de la vie, lectures communes des pages, vision et objectifs de vie | `bpmComposition` (bpm), `cycleLink` (cyc), `closure` (clo), `lifeGoal` (obj) |

Règles structurantes :

- Un module ne dépend que de modules de niveau inférieur ou transverses (contrôlé par `Registry.register`).
  Les niveaux supérieurs **enrichissent** les inférieurs par extensions (`coreProjectContext`, `taskContext`,
  `operationGuard`, `metricContext`, `userSummary`) : le noyau ignore Budget et BPM.
- Le socle technique (`api/src/socle`) fournit le registre, la persistance JSON révisée (écriture atomique,
  mutations sérialisées), l'Object Management (`om.command` = seul chemin d'écriture : idempotence par
  `requestKey`, `expectedRevision`/`STALE_VERSION`, contrôle des références déclarées, journal), les paramètres
  et le moteur de calcul.
- La création d'un user (`POST /api/users`) exécute en **une seule écriture** la composition
  `initialUserBundle` : user → projet noyau principal → Budget « Projet de vie » → Patrimoine → composition BPM
  → liaison de cycle. Un échec à n'importe quelle étape ne publie rien.
- Les middlewares (Budget, Patrimoine) n'ont que des **interfaces de test** ; l'application présentée à
  l'utilisateur est BPM (espace « Mon budget »).
- Persistance à **écrivain unique** : un verrou de fichier refuse une seconde instance (`STORE_LOCKED`) et une
  écriture est refusée si le fichier a été modifié par un autre écrivain (`PERSISTENCE_CONFLICT`) ; les
  mutations d'une instance sont sérialisées. Les anciens schémas (`j1-store/0.2`, `socle-store/0.3`, `0.4`)
  sont migrés au démarrage par des migrations de module déclarées, enregistrées dans `state.migrations`.

## Calendrier : un service paramétrable pour tous les modules

Le module transverse `calendar` (API `api/src/modules/calendar/`, site `web/src/app/calendar/`) sert le même
calendrier à tous les modules. **Un seul code** : le moteur lit, en lecture seule, les objets du user du contexte
(par nature d'objet déclarée au registre) selon les **paramètres qu'on lui donne** ; aucun module n'est modifié
pour être affiché. Chaque calendrier est un paramètre administrable `calendrier.<id>` (type objet, révision et
historique comme tout paramètre) :

| Calendrier | Page | Éléments livrés |
|---|---|---|
| `calendrier.noyau` | `/calendrier` (Noyau transverse) | débuts et échéances des projets, dates prévues et échéances des tâches |
| `calendrier.budgetPatrimoine` | `/calendrier-budget` (Budget/Patrimoine) | revenus et dépenses (réglés à leur date réelle, attendus à leur date prévue), revenus et dépenses récurrents attendus, fins de période du cycle, versements au patrimoine |
| `calendrier.patrimoine` | `/patrimoine/calendrier` (Patrimoine) | ouverture du patrimoine, versements des résultats de période, objectifs de vie datés |

Une configuration règle : la vue d'ouverture (`semaine`, `mois`, `annee` — les trois restent proposées), le
nombre de repères par case et au survol, les **indicateurs du survol** (`elements`, `dates`, `suivi`, `flux`,
`solde`), et pour chaque élément : nature d'objet, champ date (ou liste : le premier renseigné), modèle de titre,
couleur, repère (début, échéance, ponctuel), affichage à l'ouverture, filtre, condition « terminé », montant et
sens, regroupement, lien, **entrées montrées au survol** (champ, format, référence vers un autre objet, valeur
d'un paramètre, objets reliés), répétition (cadence, ancrage, veille de l'occurrence suivante, remplacement par
un objet réel) et commande de l'API qui replanifie un repère (glisser-déposer ou « Replanifier »). Les trois vues
partagent un même cadre (nombre d'or au-dessus de 1 280 px, 4:3 jusqu'à 900 px).

## Projets de la vie dans Budget/Patrimoine : un projet, un budget attribué

Les projets et les tâches viennent du **noyau**, seule source : ils s'y créent et s'y modifient. Budget/Patrimoine
réimplémente leurs tableaux par statut (`/app/projets`, `/app/taches`, fiche `/app/projets/:id`), limités au
**projet de vie** du user et à ses **projets standards** (Budgets standards enfants du budget de vie). Le
rattachement d'une tâche (`attachTask`, `detachTask`) et son changement d'état (glisser-déposer ou « Déplacer
vers », `changeTaskStatus`) passent par les commandes du noyau, depuis le noyau comme depuis BPM ; l'état d'un
projet suit toujours ses tâches. Un projet du noyau devient projet standard par « Financer un projet du noyau ».

BPM porte le budget de chaque projet standard (`api/src/modules/bpm/projects.mjs`) :

- **Budget attribué** par le budget de vie : il figure dans le budget de vie comme une **charge non récurrente
  spéciale** (registre de Dépenses, groupe « Charges des projets de la vie »), jamais comptée à sa date. Seules
  les dépenses du projet **validées comme réglées** (depuis la date d'attribution) entrent dans le Dépensé du
  budget de vie, à leur date réelle (variable `projets.chargesReglees`, métrique `bpm.chargesProjets`) ;
- **ventilation sur les tâches** : chaque part réduit le budget à ventiler ;
- **dépassement** : une part ou un règlement qui dépasse le budget du projet est refusé
  (`OVERRUN_AUTHORIZATION_REQUIRED`) tant que le budget de vie ne l'a pas autorisé. Autorisé, le projet passe en
  dépassement (rouge) et la charge de dépassement est **facturée au budget de vie à la fin de la période en cours
  du cycle** : « Facturer au budget de vie » intègre alors le dépassement au budget attribué et rend les contrôles
  de fin de cycle (budget = somme des parts, charges des tâches planifiées avec montants et récurrences à jour) ;
- **retour** : une tâche peut retourner au budget de vie un revenu ponctuel ou récurrent, enregistré quand elle est
  terminée (une seule fois) ;
- **garde** : une tâche qui porte une part, une dépense ou un retour ne change pas de projet tant qu'ils existent.

## Chiffres configurables et explicables

Chaque chiffre affiché par l'application BPM est une **métrique** :

- sa formule est le paramètre administrable `metric.<clé>` (défaut dans le code, valeur administrée avec
  révision et historique, retour au défaut possible) ;
- le langage de formule est interprété sans évaluation de code : `+ - * /`, parenthèses, comparaisons, et
  `min`, `max`, `abs`, `arrondi`, `si`, `siInconnu`, `pourcentage` ; il référence des **variables** fournies par
  les middlewares (`budget.revenusRealises`, `patrimoine.stockOuverture`…) ou d'autres métriques ;
- une formule est validée à l'enregistrement (syntaxe, références connues, pas de dépendance circulaire →
  `FORMULA_INVALID`) et peut être **prévisualisée** sur les données d'un user sans être enregistrée ;
- l'évaluation renvoie la valeur **et** son explication : formule, révision du paramètre, formule avec valeurs
  substituées (« 3 000 − 1 250 = 1 750 »), entrées (variables avec leurs objets sources inspectables dans Object
  Management, métriques imbriquées) ;
- une valeur inconnue vaut `null` et se propage ; elle n'est jamais affichée comme 0 (« Inconnu » + raison,
  par exemple stock d'ouverture non renseigné ou cycle à configurer). Seul `siInconnu(x, 0)` explicite la
  remplace ;
- la composition du tableau de bord (sections et chiffres) est elle-même le paramètre `bpm.tableauDeBord`.

Une clôture de période enregistre la formule et la révision du paramètre utilisées, le résultat signé (nul ou
négatif accepté), **les chiffres de la période tels qu'ils étaient** et les opérations sources ; le résultat est
transféré une fois au Patrimoine (capitalisation). Une période close est toujours relue avec ses chiffres
enregistrés ; un recalcul avec les formules courantes n'apparaît que comme comparaison séparée. La confirmation
de clôture et la commande partagent le même aperçu (`expectedResultCents`) : si les données ont changé entre les
deux, la clôture est refusée (`CLOSING_PREVIEW_STALE`) avec le nouvel aperçu à relire.

Montants : centimes entiers dans le stockage et les contrats de lecture (champs `…Cents`) ; les saisies envoyées
à l'API restent en euros (nombre), convertis à la frontière. Une valeur inconnue est `null`.

## Routes principales

| Domaine | Routes |
|---|---|
| Users | `GET/POST /api/users`, `GET /api/users/types`, `PUT /api/users/:id` |
| Noyau | `GET/POST /api/projects`, `GET/PUT /api/projects/:id`, `GET/POST /api/tasks`, `GET/PUT /api/tasks/:id`, `POST /api/tasks/:id/{status,attach,detach,time}` |
| Budget (test) | `GET /api/budget/budgets[/:id]`, `GET/POST /api/budget/cost-centers`, `POST /api/budget/operations`, `PUT /api/budget/operations/:id`, `POST /api/budget/operations/:id/realize` |
| Patrimoine (test) | `GET /api/patrimoine`, `PUT /api/patrimoine/:id` |
| BPM — lectures communes | `GET /api/bpm/{summary,register,lines/:id,centers,centers/:ref,incomes,balance,history,impact,budget-type,due,events,directives,projection,goals,recurrences,periods,setup}` (`?period=AAAA-MM` et filtres), `POST /api/bpm/operations/preview` (aperçu sans écriture) |
| BPM — commandes | `POST /api/bpm/setup` (Partir de zéro, principal ou branche), `POST /api/bpm/operations` (ponctuelle ou récurrente), `PUT /api/bpm/operations/:id`, `POST /api/bpm/operations/:id/{realize,cancel-realization}`, `PUT /api/bpm/recurrences/:id`, `POST /api/bpm/recurrences/:id/settle`, `PUT /api/bpm/caps`, `PUT /api/bpm/vision`, `POST /api/bpm/goals`, `PUT /api/bpm/goals/:id`, `POST /api/bpm/goals/:id/remove`, `PUT /api/bpm/cycle`, `GET/POST /api/bpm/closures`, `GET /api/bpm/closures/preview`, `GET/POST /api/bpm/cost-centers` |
| BPM — historique | `GET /api/bpm/dashboard[?period=AAAA-MM]`, `GET /api/bpm/figures/:key`, `GET/POST /api/bpm/life-projects`, `PUT /api/bpm/patrimoine`, `GET /api/bpm/preparation`, `POST /api/bpm/prepare` |
| Administration | `GET /api/admin/modules`, `GET /api/admin/parameters[/:key]`, `PUT /api/admin/parameters/:key`, `POST /api/admin/parameters/:key/reset`, `GET /api/admin/metrics[/:key]`, `POST /api/admin/metrics/:key/preview`, `GET /api/admin/journal`, `GET /api/admin/errors` |
| Calendrier | `GET /api/calendar` (calendriers paramétrés), `GET /api/calendar/catalog` (vocabulaire des configurations), `GET /api/calendar/:id?from=AAAA-MM-JJ&to=AAAA-MM-JJ` (repères d'un calendrier nommé), `POST /api/calendar/preview` (configuration fournie à l'appel ; aucune écriture) |
| Object Management | `GET /api/om/objects[/:id]`, `GET /api/om/kinds`, `GET /api/om/checks`, `GET /api/om/debug`, `GET /api/om/csv[/:file]`, `GET /api/om/export.zip` (archive de preuve JSON + CSV d’un instantané figé), `POST /api/_recette/reset` |

Le user de contexte est passé par l'en-tête `x-user-id` (pas d'authentification à ce stade, C04).

Site Angular — espace « Mon budget » (BPM) en deux sections :

- **Démarrer un projet** : `/creer` (Partir de zéro, assistant en sept étapes) ;
- **Ma vision budgétaire** : `/tableau-de-bord`, `/depenses` (registre ; `?operation=…&occurrence=…` ouvre le
  détail d'une échéance), `/piloter` (graphiques et chiffres), `/piloter/agir` (ce qu'il faut faire),
  `/vision` (objectifs et avenir) ;
- détails atteints depuis les chiffres, graphes et listes : `/argent/entrees`, `/argent/postes/:poste`,
  `/argent/reste`.

La période, les filtres et la sélection sont dans l'URL. Anciens liens : `/app` → `/tableau-de-bord`,
`/app/operations` → `/depenses`, `/app/bienvenue` → `/utilisateurs` ; `/app/projets` et `/app/reglages`
restent accessibles hors menu. Espaces distincts : `/utilisateurs` (gestion des utilisateurs) et le socle :
`/projects`, `/tasks`, `/socle/budget`, `/socle/patrimoine`, `/object-management` (`?inspect=<id>` ouvre un
objet), `/admin`, `/admin/calculs`, `/admin/calculs/:key`. Calendriers (même page, configuration par route) : `/calendrier`,
`/calendrier-budget`, `/patrimoine/calendrier` (`?vue=semaine|mois|annee&jour=AAAA-MM-JJ`).

Présentation : styles en couches (`web/src/styles/` : tokens, base, contrôles, structure, composants, pages du
socle), polices locales Inter, IBM Plex Mono et Newsreader (`@fontsource`). Composants partagés des pages BPM
dans `web/src/app/bpm/ui/` : cadre de page, contexte d'URL et lectures protégées contre les réponses périmées,
cartes de chiffres, graphes SVG accessibles (tableau associé, clavier), éditeur d'opération et détail d'échéance.

## Jeux d'essai (`npm run seed`)

Après réinitialisation, le seed crée par HTTP, avec des dates relatives au jour réel :

- **Camille Martin** (individuel, stock d'ouverture 12 000 €, objectif 50 000 €, cycle mensuel au 1er depuis
  trois mois) : salaires, loyer, courses, transport, loisirs et autres revenus sur trois mois terminés ; mois
  courant en partie réalisé, en partie prévu ; les deux périodes les plus anciennes closes, la plus récente
  laissée à clôturer ; projets de la vie « Voyage au Japon » et « Rénovation de la cuisine » avec des tâches
  dans des états variés ; projets noyau de démonstration (exemple 15 h / 9 h / 50 %, homonymes, tâches autonomes,
  sept états).
- **Famille Durand** (famille, stock inconnu, objectif 80 000 €, cycle à configurer) : un centre de coût
  personnalisé et des opérations prévues ce mois-ci, pour montrer les valeurs inconnues.

## Données du site de référence (`npm run import:rjs-forecast`)

Importe les users du site de référence ([`rjsconseil/rjs-forecast`](https://github.com/rjsconseil/rjs-forecast))
avec leurs projets et tâches, Budgets, Patrimoines, opérations, récurrences, règlements, objectifs et périodes
closes, par les règles du socle : chaque objet reçoit un identifiant du socle et garde son ID d'origine dans
`importRef` ; les clôtures sont rejouées par `closePeriod` et comparées au résultat enregistré par la référence.
L'API doit être arrêtée (un seul écrivain) :

```bash
npm run import:rjs-forecast -- --remplacer
```

- source : le dossier `site/data` de la référence. Sans `--source <dossier>` (chemin relatif au dossier du
  socle), l'import lit les fichiers copiés dans `api/sources/rjs-forecast/`, sinon ceux du site de référence
  voisin, `../RJS_Forecast/site/data`. Ces données ne sont pas versionnées ici : ce dépôt est public, celui de la
  référence privé ;
- `--remplacer` : repart des seules données de la référence ; l'ancien stockage est d'abord sauvegardé
  (`api/data/store.before-rjs-forecast-<date>.json`). Sans cette option, les données sont ajoutées au stockage
  existant et un second import est refusé ;
- rapport et données sans équivalent dans le socle (idées non décidées, actifs et allocations du patrimoine,
  versements entre entités, factures…) : `api/data/imports/rjs-forecast/` (`rapport.json`, `hors-contrat.json`).

## Tests

`npm test` lance `api/test/*.test.mjs` :

- `core.test.mjs` — règles pures du noyau (états dérivés, complétude, temps) ;
- `socle.test.mjs` — politique d'identité, idempotence, versions, concurrence, interruption injectée,
  unicité du triplet, composition atomique, références, parcours, Object Management, persistance, registre ;
- `calc.test.mjs` — langage de formule et métriques administrées (révision, aperçu, validation, explication) ;
- `bpm.test.mjs` — composition initiale, périodes, chiffres par période, clôtures, garde des périodes closes,
  tableau de bord administrable, centres de coût ;
- `corrections.test.mjs` — corrections C01 à C11, exemples financiers, migration d'un stockage `j1-store/0.2` ;
- `contracts.test.mjs` — récurrences et occurrences, registre, centres, solde et rapprochement, projection et
  couverture des objectifs, aperçu et simulation sans écriture, directives, Partir de zéro (principal et branche) ;
- `projects.test.mjs` — projets de la vie dans BPM : isolement, budget attribué (charge spéciale), ventilation,
  dépassements (demande, refus, accord), règlement compté à sa validation, facturation de fin de cycle, retours,
  rattachement et garde ;
- `calendar.test.mjs` — module Calendrier : calendriers livrés, noyau, isolement et lecture sans écriture,
  paramétrage du survol, des couleurs et de la vue, configurations refusées, Budget/Patrimoine, configuration
  fournie à l'appel, fenêtre de lecture, répétitions.

`npm --prefix web test -- --watch=false` lance les tests unitaires du site (routes et redirections, lectures
protégées contre les réponses périmées, graphes, éditeur d'opération rejouable, dates et modèle du calendrier).

La matrice de recette « exigence → page/service → preuve → statut » est dans [`docs/RECETTE.md`](docs/RECETTE.md).

## Questions ouvertes

Les comportements provisoires sont marqués **[P]** dans le code et rendus administrables ou réversibles :
flux monétaires père/enfants (C05, non calculés, contrôle `not-run`), réalisation automatique (C06), cycle
mensuel et clôture explicite (C07), centres standards (C08), formule du stock (C09), objectif informatif (C10).
