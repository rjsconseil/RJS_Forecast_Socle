# Brief commun — passage des pages BPM au markup et aux styles du site de référence

Projet : `/Users/rjsconseil/Documents/Claude/GitHub/RJS_Forcast_Socle` (Angular 22 standalone, signals, zoneless).
Objectif du propriétaire : « le site doit ressembler à 100 % au site décrit avec les feuilles de style ».
Les pages BPM existent et sont branchées sur les vrais contrats ; il faut maintenant **réécrire leur markup avec la
structure et les classes des templates de référence** et **attacher les feuilles SCSS source**, sans perdre le
branchement des données.

## Sources de référence (lecture seule)

- Templates : `docs/reference/dossier-codex-v0.1/reference-code/site/apps/web/src/app/bpm/*.ts` (+ `bpm-expenses.page.html`).
  Les textes y passent par `pageText()` / `registerPageTexts` : **écrire les chaînes françaises en dur** (pas de système de textes).
- Styles des pages, déjà copiés et compilables : `web/src/app/bpm/ref-styles/*.scss`
  (`@use 'functions'` et `@use 'contrat-ruptures'` se résolvent via `includePaths: ["src/styles"]`).
  Chaque composant de référence déclare ses `styleUrls` (ex. `bpm-money.page.ts` : `bpm-pages.scss`, `bpm-money.scss`).
  Reprendre **les mêmes feuilles**, en chemin relatif : `styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-money.scss']`.
- Guide : `docs/reference/dossier-codex-v0.1/RJS_Forecast_Guide_Codex_Demarrage_Vision_v0.1.md` §16–17.
- Couches globales déjà chargées (ne pas modifier) : `web/src/styles/_bpm-presentation.scss`, `_surface-language.scss`,
  `_interactions.scss`, `_components.scss` (classes source `.btn`, `.btn-primary`, `.btn-secondary`, `.card`, `.field`,
  `.eyebrow`, `.section-heading`, `.status-pill`, `.empty-state`, `.text-link`, `.muted`, `.lead`…),
  attributs `data-ui-pattern="panel|section-heading|action|field"`, `data-bpm-frame="metrics|chart"`.

## Ce qui est déjà en place (ne pas modifier)

- Coquille source (`app.ts`) : barre latérale, barre du haut, `.main-shell main`.
- `<bpm-page>` (`web/src/app/bpm/ui/page-frame.ts`) rend désormais **`rjs-app-hero`** (bandeau source : titre, phrase,
  pastilles user/périmètre/période/date de calcul, action principale projetée `[actions]`) et **`rjs-period-navigation`**,
  dans un conteneur `.bpm-page.bpm-reading`. Entrée `kicker` (surtitre, défaut « Ma vision budgétaire » ; mettre
  « Démarrer un projet » pour `/creer`). Garder `<bpm-page>` comme cadre de chaque page ; dans `[actions]`, utiliser la
  classe source `app-hero-action` pour l'action principale (bouton ou lien).
- Composants partagés source : `web/src/app/shared/` — `MetricTilesComponent` (`rjs-metric-tiles`, interface `MetricTile`),
  `ModalComponent` (`rjs-modal`), `formatMoney` (`amount.ts`). Utiliser `rjs-metric-tiles` là où la référence l'utilise
  (rangées de chiffres clés) à la place de `bpm-metric`, en gardant inconnu ≠ zéro (valeur « À renseigner » / « Inconnu »,
  `note` avec la raison) et les liens vers les détails.
- Briques BPM `web/src/app/bpm/ui/` (graphes accessibles, éditeur d'opération, détail d'échéance, `bpmLoader`,
  `BpmPageContext`, états) : **les garder** telles quelles, les placer dans les cadres source
  (`<section data-ui-pattern="panel" data-bpm-frame="chart">`…).
- Contrats `web/src/app/core/bpm-models.ts`, client `bpm-api.service.ts`, formatage `core/format.ts`.

## Règles

1. Tu ne modifies QUE les fichiers de ta mission (`web/src/app/bpm/pages/...`) ; tu peux créer des sous-composants
   `web/src/app/bpm/pages/<page>-*.ts`. Ne touche pas à `api/`, `core/`, `bpm/ui/`, `shared/`, `styles/`,
   `ref-styles/`, `app.ts`, `app.routes.ts`, ni aux pages des autres agents.
2. **Garder tout le branchement existant** : lectures (`bpmLoader`), écritures (requestKey, BpmRefresh), état d'URL
   (`BpmPageContext.setQuery`/`carry`), règles métier, messages d'erreur, brouillons conservés, accessibilité. Ne
   supprimer aucune fonctionnalité existante. Conserver les noms de classe TS exportés et les sélecteurs (les routes
   et les tests les importent).
3. Reproduire la **hiérarchie et les classes** du template de référence (sections, en-têtes, grilles, cartes, listes,
   tableaux, onglets, pastilles), pour que les SCSS source s'appliquent. Les styles étant encapsulés (émulés), les
   classes doivent être dans le template du composant qui déclare la feuille. Retirer les `styles:` inline devenus
   inutiles ; ne garder qu'un complément minimal pour ce que la référence n'a pas (en jetons source : `--ecart-*`,
   `--ink`, `--muted`, `--line`, `--raised-surface`, `--app-accent`, `--status-*`, `--radius-*`, `scaled()` n'est pas
   disponible hors SCSS).
4. Boutons : classes source `btn btn-primary` / `btn btn-secondary` (au lieu de `btn primary` / `btn ghost`).
5. Si la référence montre un bloc que nos contrats ne fournissent pas, **ne pas l'inventer** : ne pas l'afficher, ou
   afficher un état « Non calculable : raison » si le bloc existait déjà ; le noter dans `gaps`.
6. Vérification sans navigateur (le propriétaire s'en charge) :
   - types et templates : `cd web && npx ngc -p tsconfig.app.json --noEmit` (ignorer les erreurs des fichiers des
     autres agents qui travaillent en parallèle) ;
   - SCSS : pas besoin si tu n'écris que `styleUrls` vers `ref-styles` ; ne lance ni `ng build` ni `ng serve`.
7. Style du code : comme l'existant (commentaires en français, sobres ; signals ; `inject()` ; standalone ; `@if/@for`).
