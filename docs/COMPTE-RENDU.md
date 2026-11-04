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

- Blocs de référence sans contrat : vue quotidienne, découpage récurrent/ponctuel du budget standard, verdict du
  budget type, entrées à venir dans les événements, guide « Que faire maintenant ? », visite guidée.
- Teinte exacte de l'en-tête : le réglage de design du site n'est pas livré ; `--violet-950` retenu
  (`web/src/styles/_app-tokens.scss`), à ajuster si besoin.
- Passerelle `_app-*.scss` : encore utilisée par les briques `bpm/ui` et les pages du socle ; à réduire une fois ces
  pages passées au gabarit source.

## Reprise du 4 novembre 2026 — accueil, projets et tâches

- **Accueil** (`/`) vérifié contre la référence : portail en bandes avec Budget/Patrimoine Management (module phare),
  Budget management, Patrimoine Management et Noyau transverse ; les 15 liens du portail ouvrent leur page.
- **Projets** : calendrier miniature de la référence à droite du bandeau (vues année / mois / semaine, flèches,
  « Aujourd’hui », créneau de lecture choisi depuis un jour). Le créneau est gardé dans l'URL (`du`, `au`) et suit la
  règle de la référence : seuls les projets dont la date de début est dans le créneau sont comptés et affichés ; un
  projet sans date de début est masqué tant qu'un créneau est actif. Aucune date source n'est réécrite.
- **Cartes projet** au format de la référence : titre, résumé, début prévu, temps prévu / consommé, puis priorité ·
  échéance · « N tâches à suivre » · pastille de racine, et statut calculé. L'explication du statut et l'avancement
  restent au survol et dans la fiche du projet, qui porte aussi « Modifier le projet » et « Ajouter une tâche ».
- **Tâches** : inchangées, déjà au gabarit de la référence (colonnes par statut, « Déplacer vers », poignée ⠿).
- Feuille source `_calendar.scss` ajoutée aux couches globales (sélecteur de vue et grille annuelle du calendrier).
- Écarts conservés volontairement : en-tête mauve foncé (demande du propriétaire, la référence livrée est bleu nuit),
  colonnes à défilement horizontal, poignée ⠿ pour le glisser-déposer.

## Module Calendrier — 4 novembre 2026

- **Service transverse paramétrable** (`api/src/modules/calendar/`) : un seul moteur lit les données du user selon
  la configuration qu'on lui donne ; aucun module (Noyau, Budget, Patrimoine, BPM) n'est modifié. Trois
  calendriers livrés comme paramètres administrables : `calendrier.noyau`, `calendrier.budgetPatrimoine`,
  `calendrier.patrimoine` ; une configuration peut aussi être fournie à l'appel (`POST /api/calendar/preview`).
- **Paramétrage** : éléments affichés (nature, date, titre, couleur, repère, affichage à l'ouverture, filtre,
  terminé, montant, regroupement, lien), **entrées montrées au survol** (champ, format, référence, paramètre,
  objets reliés), **indicateurs du survol** (éléments, dates, suivi, flux, solde), répétitions et commande de
  replanification, vue d'ouverture, repères par case et au survol, délai de fermeture de l'aperçu.
- **Site** (`web/src/app/calendar/`) : calendrier repris du Calendrier 360 de la référence (vues Semaine, Mois,
  Année ; aperçu d'une journée au survol ; agenda et mise en évidence ; glisser-déposer et « Replanifier » ;
  clavier), conteneur `rjs-calendar-space` réutilisable dans toute page, page unique paramétrée par sa route.
  Les trois vues occupent **le même cadre** (même largeur, même hauteur), aux proportions du nombre d'or.
- **Pages** : Noyau transverse › Calendrier (`/calendrier`), Budget/Patrimoine › Calendrier (`/calendrier-budget`),
  Patrimoine › Calendrier (`/patrimoine/calendrier`). Le calendrier miniature des Projets rejoint le module.
- Tests : API 124/124 (dont 9 du calendrier), site 31/31 ; build OK.
