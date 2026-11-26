# Navigation system v2 · BPM

_15 novembre 2026. Formalisation de la navigation unifiée de BPM et site de simulation en HTML/CSS/JS
(`web/public/simulation/`, servi à `/simulation/`). Le code Angular n'est pas modifié._

## Les quatre niveaux

| Niveau | Terme | Zone d'affichage | Comportement |
| --- | --- | --- | --- |
| 1 | **Section** | Barre des sections (haut) | Référence unique : tout le reste lui est relié. |
| 2 | **Page** | Navigation latérale gauche | La première page est sélectionnée d'office : c'est l'accueil de la section. |
| 3 | **Sous-page** | Navigation horizontale du contenu | La première sous-page est l'accueil de la page, pointée par le libellé de son lien. |
| 4 | **Section de sous-page** | Liste verticale sous chaque onglet + titre de section | Ancre de contenu, jamais une commande. |

Exemple : **Ma vision budgétaire** (section) → **Tableau de bord** (première page, accueil de la section)
→ **Vue de la période** (première sous-page, accueil de la page, porte les actions) → **Registre de flux**,
**Rapprochement bancaire** (sous-pages suivantes, découpées en sections).

## Règles

- **N1 · Section.** La section est la référence unique du parcours.
- **N2 · Pages.** Les pages sont listées verticalement à gauche ; la première est sélectionnée à l'ouverture de la section.
- **N3 · Sous-page d'accueil.** La première sous-page est l'accueil de la page, toujours en tête des onglets ; la page et son accueil partagent la même adresse.
- **N4 · Actions.** Au clic sur l'onglet d'accueil, une liste verticale fait apparaître les formulaires de saisie.
- **N5 · Sections de sous-page.** Au survol d'un autre onglet, la liste verticale de ses sections apparaît ; elle disparaît quand la souris quitte la zone.
- **N6 · Ancre.** Cliquer une section ouvre la sous-page et amène le contenu au niveau de cette section.
- **N7 · Cadre compact.** Le cadre du haut réunit titre, onglets et outils au plus serré ; le titre de la section courante s'affiche dessous et le contenu défile sous lui.
- **N8 · Une seule mécanique.** `resolve({ section, page, sous-page, ancre })` complète chaque argument manquant par le premier élément visible. Le menu des actions et celui des sections sont le même composant : seuls le contenu et le déclencheur changent.
- **N9 · Une vue, une adresse.** `#/section/page/sous-page/section`. ← → suivent l'historique ; ↑ remonte d'un niveau.
- **N10 · Clavier et toucher.** Bouton d'ouverture par onglet, ↓ ouvre, Échap ferme, ↑↓ parcourent.
- **N11 · Réglages.** Libellés, ordre, visibilité, déclencheurs, délais et apparence sont réglables ; les rattachements restent structurels.

## Section VE refondue

VE suit désormais le modèle nominal : trois pages, chacune avec son accueil d'actions et ses sous-pages découpées.

- **Bienvenue** → Comprendre et commencer ⌂ · Le projet de vie · Vocabulaire
- **Chaîne de financement** → Des revenus aux tâches ⌂ · Origine des montants · Vers le patrimoine
- **Espaces de travail** → Choisir un espace ⌂ · Parcours conseillés

## Réécriture des sous-pages

Toutes les sous-pages des sections 01 à 04 ont été regroupées en sections nommées (39 sous-pages au total).
Le détail est dans `web/public/simulation/model.js`, seule source de la structure.

## Paramétrage (atelier « Navigation system »)

- **Règles** : niveaux, contrôles du plan en direct (accueil sans action, sous-page sans section, adresse en double), démonstration pas à pas.
- **Comportements** : entrée de section, déclencheur des actions et des sections (clic, survol, les deux), délais d'ouverture et de fermeture, largeur des listes, bouton d'ouverture, numérotation, compteurs, sous-pages et sections dans le menu latéral, mode des formulaires (panneau, fenêtre, en ligne), défilement, fil d'Ariane.
- **Cadre** : standard, compact ou ultra-compact, condensation au défilement, titre de section, progression, précédent/suivant, style des onglets.
- **Apparence** : thème clair/sombre/système, densité, arrondis, taille du texte, largeur ou rail du menu, couleur par section ou uniforme.
- **Structure** : renommer, réordonner, masquer, ajouter sous-pages, sections et actions ; export et import JSON.
- **Simulation** : largeurs 1440/1180/820/390, révélation des zones par niveau, profil connecté ou visiteur, saut direct vers une sous-page.

Les réglages et la structure modifiée sont conservés dans le navigateur (localStorage).

## Portage dans le site Angular (15 novembre 2026)

- **VE** : trois pages du plan (`plan/site-plan.ts`) : Bienvenue (`/zones/bpm`), Chaîne de financement (`/bpm/structure`), Espaces de travail (`/bpm/espaces`). Les deux dernières routes restent déclarées dans `PAGE_WORKSPACES` avec `page: true` : elles sont des pages, plus des sous-pages.
- **N3 · N4** : l'onglet d'accueil s'affiche dès que la page porte des actions, même sans autre sous-page. Une action peut viser une autre destination (`link` dans `TAB_LINKS`). Nouvelles actions : VE (trois pages), Plafonds, Cycle et réglages, Calendrier.
- **N5 · N8** : la liste des sections et celle des actions partagent la même surface opaque ; les sections sont numérotées et la section lue est marquée. L'accueil peut s'ouvrir au survol (`homeTrigger`).
- **N6 · N7** : `rjs-page-tabs` affiche sous les onglets le titre de la section lue (rang, points, précédente/suivante). Un saut place le titre à 12 px sous le bandeau collant, puis se réaligne quand le bandeau se compacte.
- **Réglages** : `contentMenu.homeTrigger`, `band`, `numbers`, éditables dans `/navigation` › Interaction et validés par l'API.

Ce qui reste à la simulation seulement : les sous-pages sans contenu réel (Vocabulaire, Origine des montants, Échéancier…) et les sections renommées des pages ; dans le site, les sections viennent des titres réellement rendus.

## Moteur commun et VE nominale (15 novembre 2026, suite)

- **Numérotation** : une zone `numbered` (module applicatif) numérote ses sections visibles dans leur ordre réglé (`sectionMark`). Pour un utilisateur connecté : 01 Vue d’ensemble, 02 Ma vision budgétaire, 03 Mes projets de la vie, 04 Calendrier. La couleur de chaque section ne change pas.
- **VE** : une page d’accueil « Bienvenue » (`/zones/bpm`) dont la navigation horizontale porte « Comprendre et commencer » (actions Saisir une entrée / une dépense, ouvertes en fenêtre sur place), « Chaîne de financement » et « Espaces de travail », chacune découpée en sections (rôle de BPM, situation, décisions, patrimoine, reprise ; étapes de la chaîne, origine des montants, arbre, vers le patrimoine ; espaces, comment naviguer, parcours conseillés).
- **Moteur** (`navigation/navigation-engine.ts`) : contrat générique `AppNavigation` (Section → Page → Sous-page → Section), `auditNavigation` (règles N2 à N9), `navigationLoop`, `navigationNumber`. Il ne dépend d’aucun module.
- **Adaptateur** (`plan/application-navigation.ts`) : projette toute zone `numbered` du plan vers ce contrat ; le catalogue de navigation l’expose (`applications`) et l’atelier `/navigation` affiche le contrôle de chaque module applicatif.
- **Nouveau module applicatif** : déclarer la zone avec `numbered: true`, ses pages, ses sous-pages (`PAGE_WORKSPACES`), les actions des accueils (`TAB_LINKS`) et les sections (`CONTENT_SECTION_CATALOG`) ; le cadre, la numérotation, les listes verticales, le titre de section et l’audit suivent sans code de navigation propre.
- **Exclusion** : un bloc marqué `data-nav-skip` (cartes, aperçus) ne fournit pas de sections de contenu.
