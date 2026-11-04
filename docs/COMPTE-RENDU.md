# Compte rendu de livraison — corrections et interfaces BPM, habillage du site de référence

3 novembre 2026. Référence visuelle : dépôt `rjsconseil/rjs-forecast` @ 54246fa (identique au dossier Codex v0.1).
Matrice détaillée : [`RECETTE.md`](RECETTE.md).

## Livré

- **Corrections C01–C11** et services (récurrences, prévu/réel, clôtures protégées, lectures communes, centimes,
  rejeu) : couverts par les tests API (115/115).
- **Coquille du site de référence** : barre latérale par zones (pastille du user, identité de zone, sections, pages
  de la section, sélecteur de user, « Espace local »), barre du haut (fil d'Ariane Accueil / zone / section / page,
  date), menu en popover sous 820 px. Feuilles source `_shell.scss` et `_zones.scss`.
- **Accueil** (`/`) : portail des zones en bandes — Budget/Patrimoine Management (module phare, réunit Budget et
  Patrimoine), Budget management, Patrimoine Management, Noyau transverse, Administration du site.
- **En-tête de page** : bandeau `rjs-app-hero` figé sous la barre du haut, de couleur mauve foncé, avec navigation de
  période ; pastilles user, périmètre, période (début inclus, fin exclue) et date de calcul.
- **Pages BPM** (`/creer`, `/tableau-de-bord`, `/depenses`, détails `/argent/*`, `/piloter`, `/piloter/agir`,
  `/vision`) : markup et classes des templates de référence, feuilles `bpm/ref-styles/*.scss` attachées, branchement
  des données conservé.
- **Projets et tâches** : tableaux par statut au gabarit source (bandeau, résumé par statut et progression, outils de
  recherche et filtre dans l'URL, colonnes `board-column`, cartes `task-card`), ventilation horizontale conservée,
  glisser-déposer et sélecteur de statut sur la même commande.
- **Compléments d'API** : erreurs de l'assistant sur `entries[i].*`, `cycleState` et `userTypeLabel` du profil,
  `objectiveCents`, unité des comparaisons, index des lignes d'historique, totaux signés par sens du registre.

## Données du site de référence importées

Script `npm run import:rjs-forecast` (`api/scripts/import-rjs-forecast.mjs`), API arrêtée ; source
`../RJS_Forecast/site/data`. Sauvegarde préalable `api/data/store.before-rjs-forecast-*.json`, rapport et données
sans contrat dans `api/data/imports/rjs-forecast/` (`rapport.json`, `hors-contrat.json`). Les 2 users fictifs
existants sont conservés ; un second passage est refusé (restaurer la sauvegarde pour recommencer).

- 26 users (types Célibataire, Entreprise personnelle, Association, Personne physique ajoutés au paramètre) ;
  88 projets et 68 tâches du noyau (projets « RJS » sans entité rattachés à Roosevelt).
- Par user : Budget « Projet de vie » (budget principal), Patrimoine (stock d'ouverture du grand livre ou des
  actifs valorisés, objectif du cycle de vie), composition, cycle mensuel au 1er ; les 30 autres budgets deviennent
  des Budgets standards (projets de la vie) avec plafonds par centre.
- 160 centres personnalisés, 173 opérations ponctuelles, 260 récurrences, 714 règlements (tous réglés).
- 21 clôtures du lien principal rejouées par `closePeriod` : résultat recalculé identique à la référence (0 écart).
- 7 objectifs de projection. Contrôles d'intégrité : tous passent.
- Hors contrat, conservés dans `hors-contrat.json` : 14 idées non décidées, actifs, allocations, personnes,
  fournisseurs, opérations de patrimoine, 47 clôtures des liens secondaires, versements entre entités, clients et
  factures, périmètres et droits, configuration. 31 liens opération → tâche retirés (tâche hors du projet du Budget).

## À vérifier (recette navigateur, non faite par l'agent)

Rendu à 1440 / 1024 / 768 / 390 px, clavier et focus, thème sombre, menu mobile, en-tête figé, teinte de l'en-tête.

## Choix métier ouverts

- Consolidation père/enfants des Budgets (aucun total consolidé présenté).
- Répartition patrimoniale (aucun contrat d'allocations) ; phases accumulation/allocation.
- Cycles de clôture hebdomadaire et annuel (mensuel seul).
- « Assembler l'existant » dans l'assistant (la règle interdit de réassembler des objets existants).

## Restant

- Accueils de zone `/zones/:zone` : chaque zone mène à sa première page.
- Blocs de référence sans contrat : vue quotidienne, découpage récurrent/ponctuel du budget standard, verdict du
  budget type, entrées à venir dans les événements, guide « Que faire maintenant ? », visite guidée, calendrier
  miniature des projets.
- Teinte exacte de l'en-tête : le réglage de design du site n'est pas livré ; `--violet-950` retenu
  (`web/src/styles/_app-tokens.scss`), à ajuster si besoin.
- Passerelle `_app-*.scss` : encore utilisée par les briques `bpm/ui` et les pages du socle ; à réduire une fois ces
  pages passées au gabarit source.
