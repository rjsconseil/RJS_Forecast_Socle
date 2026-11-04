# Brief commun — pages BPM (lots 3 et 4)

Projet : /Users/rjsconseil/Documents/Claude/GitHub/RJS_Forcast_Socle (Angular 22 standalone, signals, zoneless ; API Node dans `api/`).
Spécification complète : /private/tmp/claude-501/-Users-rjsconseil-Documents-Claude-GitHub-RJS-Forcast-Socle/568d314f-f549-49fc-a43d-47b9d5e58107/scratchpad/spec.md
(lire au minimum §3, §4, §5, §12, §13, §14 et la section de ta page).

## Ce qui existe déjà (à utiliser, NE PAS modifier)
- Contrats TypeScript : `web/src/app/core/bpm-models.ts` ; client : `web/src/app/core/bpm-api.service.ts` (classe `BpmApi`).
  Ancien client `Api` (`web/src/app/core/api.service.ts`) : `dashboard(period)` (bloc `closing` avec `preview`), `closePeriod`, `lifeProjects()`, `tasks()`, `updateBpmPatrimoine`, `configureCycle`, `closures()`.
- Sémantique des lectures : `api/src/modules/bpm/reads.mjs` (summary, register, lineDetail, centers, centerDetail, incomes, balance, history, impact, budgetType, due, events, directives, projection, previewEntry, visionOf, goalsOf, surplusProgress), `api/src/modules/bpm/index.mjs` (routes, setupProject, setupProfile, updateVision, goals), `api/src/modules/bpm/projection.mjs`.
  Montants `…Cents` = centimes entiers ; `null` = inconnu (jamais zéro). Les saisies envoyées à l'API sont en euros (nombre).
- Formatage : `web/src/app/core/format.ts` (`cents()`, `signedCents()`, `tone()`, `percentText()`, `shortDate()`, `parseAmount()`, pipes `cents`, `signedCents`, `pct`, `shortDate`).
- Composants partagés `web/src/app/bpm/ui/` (import depuis `'../ui'`) :
  - `BpmPageContext` (à fournir : `providers: [BpmPageContext]`) : `period()`, `q(name)`, `setQuery(patch)`, `carry()`, `userId`. Toute sélection/filtre/période passe par l'URL (query params).
  - `bpmLoader(key, fetch)` : lecture réactive protégée contre les réponses périmées, rechargée après toute écriture (`BpmRefresh.bump()`, déjà appelé par l'éditeur et le détail de ligne). Expose `data()`, `error()`, `loading()`, `reload()`. À appeler dans un contexte d'injection (initialiseur de champ).
  - `newRequestKey(prefix)` : clé de commande rejouable, générée une fois par brouillon.
  - `<bpm-page title lead [context] [periodKey] [periodNav] [back] (periodChange)>` : cadre commun (titre, phrase, user, périmètre, période, date de calcul). Projeter l'action principale avec `<div actions>…</div>`.
  - `<bpm-state [loading] [error] [empty] emptyText (retry)>` : états chargement/erreur/vide.
  - `<bpm-metric label [valueCents] [signed] [colored] [subs] [link] [query] [badge] [hint] [unknownReason]>` : carte de chiffre (inconnu ≠ zéro).
  - Graphes `charts.ts` : `<bpm-series-chart>` (combiné/courbes/barres/aire, prévision différenciée, marqueurs, tableau associé, clavier), `<bpm-share-chart>` (barre 100 %, camembert, anneau, lecture sur 100 €), `<bpm-cap-chart>` (payé, restant, plafond, marge), `<bpm-progress>` (montant vers cible, ou temps écoulé). Couleurs de séries : tokens CSS `var(--s-income)`, `--s-charge`, `--s-net`, `--s-expected`, `--s-patrimoine`, `--s-nominal`, `--s-real`, `--s-cap`, `--s-remaining`, `--s-rest`. Une mesure garde la même couleur partout.
  - `<bpm-operation-editor [budgets] [line] [defaults] (closed) (saved)>` : éditeur d'opération partagé (création avec aperçu sans mutation, modification qui garde l'identité). À afficher dans un `@if`.
  - `<bpm-line-detail [lineId] [period] (closed) (edit)>` : panneau de détail d'une échéance (prévu/réel, règlements, actions Payé/Reçu, annulation).
- Styles globaux en couches (`web/src/styles/`) : classes `.frame` (cadre de bloc avec `> header h2`), `.grid.cols-2/3/4`, `.stack`, `.kpis`, `.data-table`, `.table-scroll`, `.chip` (+ `pos/warn/neg/accent/estimate/recorded` et statuts `settled/due/late/pending/unrealized`), `.btn` (`primary/ghost/danger/small`), `.field`, `.field-row`, `.segmented` (boutons `aria-pressed`), `.alert` (`error/warn/ok`), `.state`, `.dl-grid`, `.panel-drawer`, `.drawer-backdrop`, `.num` (chiffres en IBM Plex Mono), `.muted`, `.small`, `.hint`. Tokens `--c-*`, `--sp-*`, `--r-*`. Styles propres à la page dans `styles:` du composant, en utilisant les tokens.
- Routes (déjà déclarées dans `app.routes.ts`) : `/creer`, `/tableau-de-bord`, `/depenses`, `/piloter`, `/piloter/agir`, `/vision`, `/argent/entrees`, `/argent/postes/:poste`, `/argent/reste`. Détail d'échéance : `/depenses?operation=<id>&occurrence=<clé>` (ouvre le panneau). Le paramètre `:poste` est la référence de centre (`std:<clé>` ou ID de centre personnel), encodée dans l'URL.

## Règles
- Tu ne modifies QUE les fichiers de ta mission (et tu peux créer des fichiers `web/src/app/bpm/pages/<page>-*.ts` pour des sous-composants de ta page). Ne touche pas à `api/`, `core/`, `bpm/ui/`, `styles`, `app.routes.ts`, `app.ts` ni aux pages des autres. Si un contrat manque ou est faux, ne le contourne pas par un faux chiffre : note le besoin précis dans `apiNeeds` de ta réponse et affiche un état « Non calculable » avec la raison.
- Pas de vérification dans un navigateur (l'utilisateur s'en charge). Vérifie la compilation (types + templates) avec : `cd web && npx ngc -p tsconfig.app.json --noEmit` ; ignore les erreurs des fichiers des autres agents qui travaillent en parallèle. Ne lance pas `ng build` ni `ng serve`.
- Interface en français, vocabulaire de la spécification : « Budget du projet de vie » (principal), « projet de la vie » (branche), « tâche d'un projet budgétisé ». Zéro connu ≠ inconnu (« À renseigner », « Inconnu », « Non calculable : raison »). Signes lisibles sans couleur (signedCents). Aucun chiffre inventé ni donnée de démonstration.
- Navigation, aperçu, simulation, filtre : aucune écriture. Brouillons conservés en cas d'erreur ; afficher ce qui est réellement enregistré. Formulaires et explications longues repliés (`<details>`) ou en panneau.
- Chaque page : `<bpm-page>` avec titre court, phrase utile, contexte de la lecture principale et UNE action principale mise en avant. Éviter de répéter un même total dans plusieurs blocs. Les chiffres/graphes/listes mènent aux détails (liens avec `carry()` pour garder la période).
- Accessibilité : clavier, focus visible, `aria-label` utiles, tableaux associés aux graphes ; responsive 1440/1024/768/390 (grilles `auto-fit`, paires de champs qui se replient).
- Style du code : comme le code existant (commentaires en français, sobres ; signals ; `inject()` ; composants standalone ; templates inline avec `@if/@for`).
