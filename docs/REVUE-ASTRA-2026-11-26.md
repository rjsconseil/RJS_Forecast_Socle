# Revue globale de BPM-Astra — 26 novembre 2026

Revue faite sur la copie de travail du poste (base SQLite, BPM-Astra), pas sur GitHub. Rien n'a été commité ni poussé.

## 1. Ce qui a été fait

### Cycles : un défaut réel corrigé
Un nouveau test de robustesse (`api/test/closing-journey.test.mjs`, dernier test) a révélé un blocage : quand **deux cycles terminés attendent leur clôture** (clôture faite en retard), un point reporté « au cycle suivant » visait un cycle lui-même terminé. La clôture échouait alors à coup sûr (`CYCLE_IN_CLOSING`, puis `CYCLE_AWAITING_CLOSURE`), sans issue pour l'utilisateur.

Correction (`api/src/modules/bpm/closing.mjs`, `budget/index.mjs`, `bpm/index.mjs`) :
- les cycles proposés pour un report ne sont plus que ceux **pas encore terminés** ;
- un report décidé vers un cycle qui s'est terminé depuis **tombe** : le point redevient ouvert, l'utilisateur choisit un cycle ouvert ;
- une décision de financement se revoit au **premier cycle à venir** (identique au « cycle suivant » quand il n'y a pas de retard ; la page utilisait déjà cette règle) ;
- seul un report inscrit **par la clôture elle-même** passe le verrou du cycle suivant (drapeau interne `carried`, non exposé par l'API).

Le test couvre aussi : décisions refusées tant que le cycle court, clôture dans l'ordre, aperçu périmé refusé (`CLOSING_PREVIEW_STALE`), clôture rejouée (double clic) sans second versement au patrimoine, cycle clos qui ne se rouvre pas.

### Navigation secondaire alignée sur les gestes et le menu
Dans `web/src/app/astra/astra-parts.ts` :
- **Onglets stables par section** : toutes les pages d'une section sont toujours en onglets, à la même place, sur chacune de ses pages (avant : l'Agenda n'offrait que 3 onglets, l'accueil n'offrait pas l'Agenda…). Puis, après le séparateur, les pages liées des autres sections.
- **Ordre = ordre du menu latéral**, chaque page suivie de ses sous-pages (ex. Mon quotidien : Mon projet de vie → Mouvements → Échéances → Calendrier → Agenda). L'ordre est **lu dans les déclarations** (`ASTRA_ORDER`) au lieu d'être tenu à la main.
- **Clôture = processus** : ses trois étapes (1 Vérifier le compte, 2 Clôture du cycle, 3 Bilans) sont numérotées en tête sur toutes les pages de Cycles (avant : seulement sur deux pages).
- **Un onglet porte le nom de sa page** : « Vue du cycle » → « Mon projet de vie », « Projets » → « Projets de la vie », « Relire et clôturer » → « Clôture du cycle » ; la page « Projets financés » s'appelle maintenant « Règlements par cycle », comme son onglet.
- `ASTRA_LINKS` ne déclare plus que les liens **entre sections** (20 au lieu de 46), chacun justifié par un geste. Lien Budget récurrent ↔ Mouvements retiré (barre trop longue à 1440 px).
- Sur écran étroit, l'onglet de la page ouverte reste visible dans la barre.

### Outils : une navigation à une seule place
- La boîte à outils ne répète plus un lien vers une page déjà en onglet (ex. Clôture affichait deux boutons vers la même page « Vérifier le compte » ; Patrimoine, Budget récurrent, Plafonds, Tâches, Bilans, l'accueil répétaient leurs onglets). Règle appliquée une fois par le cadre (`astra-part.ts`, `markTabLinks`), pas page par page : une création, une fenêtre ou un bouton restent.
- Accueil : quand rien n'est en retard, l'action principale est **« Saisir une dépense »** (le geste quotidien, en fenêtre) au lieu de « Ouvrir le calendrier » qui doublait l'onglet.
- Objectif et projection : l'action principale est **« ＋ Créer un objectif daté »** (fenêtre) au lieu d'un lien vers l'onglet Objectifs datés.
- Défaut corrigé : un lien « Saisir une entrée d'argent » intercepté par le cadre ouvrait une fenêtre de **dépense** (le cadre lisait `direction` alors que le site écrit `entryDirection`).

### Réutilisation
- `api/src/modules/bpm/format.mjs` : `frDate`, `cents`, `sum`, `plural`, `fmt` étaient copiés dans 8 fichiers du module BPM ; une seule définition maintenant.

## 2. Vérifications
| Vérification | Avant | Après |
|---|---|---|
| Tests API (`npm test`) | 279 ✓ | **280 ✓** (1 nouveau) |
| Tests web (`ng test`) | 348 ✓ | **351 ✓** (spec de navigation réécrit, 3 règles nouvelles) |
| Build de production | ✓ | ✓ sans avertissement |
| Interface, 20 pages à 1440 px | — | onglets, titres, outils mesurés ; aucun débordement ; aucune erreur console |
| Interface, 375 px | — | aucun débordement, onglet courant visible |
| Gestes réels | — | « Saisir une dépense » ouvre la fenêtre sur l'accueil (charge) ; « Créer un objectif daté » ouvre sa fenêtre ; rien enregistré |

Le PDF de documentation n'a pas pu être lu sur ce poste (polices sans texte extractible) : la revue s'appuie sur `docs/`, la mémoire du projet et le code.

## 3. Rapport sur l'architecture et le code

**Points forts**
- Socle net : principes P1–P6 vérifiés par des tests (`principles.test.mjs`), écriture unique par `om.command`, état gelé, rejeu idempotent par `requestKey` (vérifié sur la clôture).
- Astra est déclaratif : une seule déclaration (`astra-parts.ts`) donne menu, teintes, routes, onglets, redirections ; les écrans métier de BPM sont réutilisés tels quels.
- Mécanique de clôture riche et testée (points, reports, verrou, cohérence bloquante, historisation figée) ; la règle de clôture est commune à la page et à l'API.
- Couverture de tests solide côté API (280) et web (351), rapide (~1 s et ~3 s).

**Points faibles et risques**
1. **Styles en couches** : 48 fichiers SCSS (~20 000 lignes), 95 `!important`, plusieurs couches de « remise d'équerre » (`_bpm-sober`, `_bpm-section-polish`, `_surface-language`, `_calendar-budget-parity`…). C'est le principal frein à la cohérence visuelle : une règle de section se fait souvent battre par une couche plus spécifique. Recommandation : un passage dédié qui ramène les styles d'Astra aux variables de niveau et de partie, et retire les couches devenues inutiles.
2. **Cadre qui déplace le DOM** : le cadre d'Astra déplace les commandes des écrans dans sa barre et sa boîte à outils (et marque maintenant les doublons). Efficace, mais fragile : un écran qui change ses classes casse la répartition sans erreur. À terme, des emplacements déclarés (primaire, actions, filtres) dans `rjs-page-toolbar` seraient plus sûrs.
3. **Gros composants** : `project.page.ts` (1 277 lignes), `closing.page.ts` (657), `bpm/index.mjs` (914), `reads.mjs` (895). Lisibles mais lourds à faire évoluer ; à découper par responsabilité quand on y retouche.
4. **Libellés d'action inégaux** restés : « Actualiser les réglages » en action principale de trois pages de réglages, « Bilan en cours » sur Bilans, aucune action principale sur Échéances et Vérifier le compte. Ce sont les écrans de BPM ; à harmoniser page par page si vous le souhaitez.
5. **Tests d'interface** : les scripts `e2e/` visent encore les anciennes adresses BPM et Playwright n'est pas installé sur ce poste ; les vérifications d'interface ont été faites dans le navigateur intégré. Un script e2e Astra (les 20 pages, mesures, gestes) serait la suite logique.

**Appréciation** : architecture saine et bien testée côté métier ; la dette est surtout dans la couche de présentation (styles et cadre), pas dans le socle ni dans la mécanique des cycles.

---

## 4. Deuxième passe : les cinq points faibles traités (26 nov., nuit)

### Point 1 — Styles en couches
- **Règles mortes retirées** : 23 règles et 56 sélecteurs ou alternatives de `:is(…)` visaient des classes qui n'existent plus nulle part dans le code (anciennes pages BPM). Le tri est automatique et prudent : une classe est « morte » seulement si son nom (et son préfixe) n'apparaît dans aucun gabarit, composant ou réponse de l'API ; les classes de bibliothèque (`cdk-`…) et les sélecteurs complexes (`:has`, interpolations) ne sont pas touchés.
- **`!important` : 117 → 49** (95 → 38 lignes). Retirés par lots ; un lot n'était gardé que si le rendu restait identique. Ceux qui restent ont un vrai rôle : l'habillage du bouton principal dans la barre de titre d'Astra, les hauteurs de colonnes, les fenêtres de saisie (non mesurées, donc gardées par prudence), le calendrier.
- **Contrôle** : nouvel outil `e2e/style-fingerprint.mjs`, qui enregistre 30 propriétés calculées de chaque élément (≈ 28 000 éléments, 19 pages × 1440 px et 375 px) puis compare. Résultat : **rendu identique** ; la seule différence relevée est l'opacité d'une liste de période pendant son chargement, qui varie d'une mesure à l'autre.
- Ce qui reste : environ 140 noms de classes morts dans des sélecteurs composés, et les couches de « remise d'équerre ». L'outil d'empreinte permet maintenant de continuer ce nettoyage sans risque, fichier par fichier.

### Point 2 — Cadre qui déplace le DOM
`rjs-page-toolbar` déclare maintenant ses emplacements (`PageToolbarParts` : barre, action principale, autres actions, filtres) et les remet au cadre. Le cadre d'Astra ne cherche plus de classes dans les écrans : il range l'action principale dans sa barre de titre et observe seulement l'emplacement « autres actions » (au lieu de tout le panneau) pour masquer les liens qui doublent un onglet.

### Point 3 — Gros composants
Les brouillons du centre de commande de la fiche projet (cadrans des temps et de la part d'enveloppe : valeurs, bornes, péremption quand la tâche ou l'enveloppe change ailleurs) sont sortis dans `bpm/projects/task-command-drafts.ts`, une classe sans dépendance testée seule (5 tests). `project.page.ts` passe de 1 277 à 1 248 lignes ; le gabarit n'a pas changé. Les autres gros fichiers (`closing.page.ts`, `bpm/index.mjs`, `reads.mjs`) n'ont pas été découpés.

### Point 4 — Actions principales cohérentes
Chaque page a maintenant une action principale qui est un geste (vérifié par le test d'interface) :
| Page | Avant | Après |
|---|---|---|
| Échéances | aucune (défaut de projection Angular) | « Régler · *prochaine échéance* », sinon « ＋ Saisir une entrée ou une dépense » |
| Règlements par cycle | aucune | « ＋ Créer un projet de la vie » (fenêtre) |
| Vérifier le compte | aucune | « Saisir le solde de mon relevé » (va au formulaire, curseur placé) |
| Point de départ, Ancrage du cycle, Postes et revenus | « Actualiser les réglages » | « Enregistrer le patrimoine / le cycle », « Ajouter un poste » (inactif tant que rien n'a changé) ; « Actualiser » passe en action secondaire |
| Bilans | « Bilan en cours » | « Lire le bilan en cours » |

Le défaut d'Échéances venait d'un bloc `@if` imbriqué que la projection de contenu d'Angular ne range pas dans l'emplacement `[primary]` : corrigé avec `ngProjectAs`.

### Point 5 — Tests d'interface
- `npm run e2e:astra` (`e2e/astra.e2e.mjs`) : Chrome sans tête (Google Chrome est maintenant installé ; `playwright-core` ajouté en dépendance de développement, sans téléchargement de navigateur). Lecture seule. Il vérifie sur les 19 pages : un seul onglet courant, onglet = nom de la page, onglets de la section en tête et identiques sur toutes ses pages, aucun débordement, aucune navigation répétée dans la boîte à outils, aucune erreur ; à 375 px, aucun débordement et l'onglet courant visible ; puis les gestes : création en fenêtre sans quitter la page, touche « + », flèche « suivant ». **Résultat : conforme.**
- `node e2e/style-fingerprint.mjs save|compare` : l'outil de non-régression visuelle décrit au point 1.

### Vérifications finales
| | Résultat |
|---|---|
| Tests API | 280 ✓ |
| Tests web | **356 ✓** (+5) |
| Build de production | ✓ sans avertissement |
| Test d'interface Astra | ✓ 19 pages, 2 largeurs, 3 gestes |
| Empreinte des styles | identique avant / après nettoyage |

## 5. Nouveau rapport sur l'architecture et le code

**Ce qui s'est renforcé**
- **Contrats explicites à la place de conventions implicites** : la barre de commandes expose ses emplacements, la navigation se déduit des déclarations (`ASTRA_ORDER`), les helpers de format du module BPM sont définis une seule fois.
- **Filet de sécurité complet** : en plus des tests unitaires (API 280, web 356), un test d'interface de bout en bout et un contrôle de non-régression visuelle, tous deux relançables en une commande sur le site réel. C'était le maillon manquant pour faire évoluer la présentation sans crainte.
- **Cohérence fonctionnelle vérifiée par des tests**, pas seulement constatée : onglets par section, libellés, action principale, absence de doublons.
- **Mécanique des cycles** : solide, y compris en cas de clôture tardive (corrigé dans la première passe) ; rejeu, ordre de clôture et aperçu périmé sont couverts par les tests.

**Ce qui reste à surveiller**
1. **Styles** : la dette a diminué (règles mortes retirées, `!important` divisés par 2,4), mais 48 fichiers et leurs couches successives restent. C'est le prochain chantier. Il peut maintenant avancer sans risque, fichier par fichier, avec l'empreinte.
2. **Gros fichiers** : `closing.page.ts` (657 lignes), `bpm/index.mjs` (914), `reads.mjs` (895) et le reste de `project.page.ts` (1 248). Le modèle suivi pour les brouillons (logique pure sortie et testée seule) s'applique à chacun.
3. **Projection de contenu** : le défaut d'Échéances montre qu'un bloc `@if` imbriqué peut faire disparaître une action sans erreur. Le test d'interface le détecte maintenant ; une règle d'écriture (une seule racine par branche, sinon `ngProjectAs`) mériterait d'être ajoutée au guide du projet.
4. **Anciens scripts e2e** (`e2e/bpm-navigation`, `projets`) : ils visent les adresses d'avant Astra. À retirer ou à porter sur `e2e:astra`.

**Appréciation** : le socle et la mécanique métier étaient déjà solides. La couche de présentation, qui était la partie fragile, a maintenant des contrats explicites et des tests qui la protègent. La dette qui reste est connue, mesurée et outillée.

---

## 6. Troisième passe : la couche de présentation, partie à part entière d'Astra (26 nov., nuit)

### Une couche à elle, rangée comme l'application
Les cinq feuilles `_astra*.scss` perdues parmi les 48 feuilles globales deviennent le dossier **`web/src/app/astra/styles/`**, à côté du code d'Astra (comme `astra-parts.ts` pour la navigation). Seize fichiers, un par rôle, dans l'ordre de la cascade décrit par `_index.scss` :

| Fichier | Rôle |
|---|---|
| `_tokens.scss` | teintes des 5 parties (clair et sombre), liste des parties, fonction `part()`, portées `$app`, `$main`, `$frame` (rien n'est émis) |
| `_icons.scss` | pictogrammes |
| `_home.scss` | accueil et cartes des pages propres |
| `_shell.scss` | identité d'Astra dans la coquille du site |
| `_tones.scss` | teintes appliquées au menu et à la page |
| `_frame.scss`, `_toolbar.scss`, `_rail.scss` | le cadre : squelette, barre de titre et onglets, panneau à 5 modules |
| `_screens.scss` | écrans métier de BPM présentés par Astra |
| `_pages.scss`, `_movements.scss`, `_dialogs.scss` | pages propres, Mouvements, fenêtres de saisie |
| `_narrow.scss`, `_alignment.scss`, `_metrics.scss` | écrans étroits, bas de blocs alignés, chiffres |

`styles.scss` n'a plus qu'une ligne pour Astra : `@use './app/astra/styles'`. Le découpage a été vérifié à l'octet : **le CSS compilé était identique** avant et après.

### Rationalisée
- **Jetons en un seul endroit** : les sélecteurs de portée (`.app-shell[data-application='bpm-astra'] #main astra-part`…) étaient recopiés en tête de chaque bloc. Ce sont maintenant des jetons (`#{$frame}`…).
- Les fonctions Sass dépréciées (`nth`, `map-get`) sont remplacées par `sass:list` / `sass:map` : **plus aucun avertissement** à la compilation.
- **Couleurs par partie générées depuis les jetons** : les créations, les onglets et les ponts ne connaissaient que 3 parties (Mon quotidien, Mes projets, Patrimoine, en dur). Une boucle sur les 5 parties remplace ces règles.
- **Carte du cycle définie une fois** : l'accueil posait une palette violette que la page propre écrasait aussitôt par la palette verte. Les valeurs écrasées sont retirées (rendu identique).
- **Finitions BPM réunies** : `_bpm-section-polish`, `_bpm-cockpit` et `_bpm-sober` deviennent `_bpm-finitions.scss`, dans le même ordre. Le « rythme des pages de travail » (titres, champs, tableaux, petits écrans) était recopié 4 fois ; il est maintenant écrit une fois (`@mixin page-rhythm`). CSS identique.

### Mise en cohérence (changements visibles, voulus)
- Les onglets qui mènent vers **Mon budget** (violet) et **Cycles** (framboise) portent maintenant la couleur de leur partie, comme les autres. Le pictogramme de Patrimoine reprend la teinte du jeton (au lieu d'une valeur à part).
- Les créations du menu « Nouveau » et les ponts « Aller vers » ont la couleur de leur partie pour les 5 parties.
- La dernière trace de mise en avant de Patrimoine (un fond doré sur les bandeaux d'écran) est retirée, conformément à « toutes les sections ont le même format ».

### Code mort retiré
Environ 290 règles ou sélecteurs visaient des classes qui n'existent plus, dans les feuilles globales et dans celles des composants : **classes mortes 143 → 21**. Celles qui restent sont dans des constructions que l'outil ne retire pas seul. Le CSS global compilé passe de 823 à 794 ko, sans changement de rendu (empreinte de 38 vues : seules les couleurs d'onglets voulues ci-dessus diffèrent).

### Outils pour la suite
- `npm run styles:audit` liste les classes mortes et les `!important` par feuille (127 feuilles, 87 `!important` dont 49 dans les feuilles globales et Astra).
- `node e2e/style-fingerprint.mjs save|compare` vérifie que le rendu ne change pas.
- `npm run e2e:astra` vérifie la structure et les gestes.

### Vérifications
API 280 ✓ · web 356 ✓ · build ✓ (aucun avertissement Sass) · test d'interface Astra ✓ · empreinte identique hors changements voulus.

### Ce qui reste
- Les **couches BPM historiques** (`_bpm-application`, `_bpm-projects`, `_workspace`, `_zones`, `_calendar*`…) servent toujours les écrans métier que présente Astra. Les faire entrer dans la couche d'Astra demande de les réécrire écran par écran. C'est faisable maintenant sans risque avec l'empreinte, mais c'est un chantier en soi.
- 21 classes mortes dans des sélecteurs composés, 38 `!important` utiles (bouton principal, fenêtres, calendrier).

---

## 7. Quatrième passe : les couches BPM entrent dans la couche d'Astra (26 nov., nuit)

### Trois couches, chacune rangée avec ce qu'elle habille
Les 41 feuilles globales ont été classées : **6 habillent les écrans métier de BPM**, **6 le calendrier**, **29 le site et le socle** (polices, jetons, coquille, zones et portail, formulaires, pages d'administration…).

| Couche | Où | Contenu |
|---|---|---|
| Site et socle | `web/src/styles/` (29 feuilles) | ce qui sert tout le site, Astra compris |
| Calendrier | `web/src/app/calendar/styles/site/` (6 feuilles + `_index`) | grille et vues (globales) ; parité Budget, formats, commandes, pleine largeur, module branchable chargés avec `CalendarSpace` depuis le 27/11 (`calendar-site*.scss`) |
| BPM-Astra | `web/src/app/astra/styles/` | `bpm/` : les écrans métier que présente Astra (présentation commune, projets et tâches, système de l'application et cycle budgétaire, finitions, sens des couleurs), puis le cadre d'Astra (16 fichiers) |

`styles.scss` tient maintenant en 6 blocs commentés et une seule ligne par couche déplacée (`@use './app/calendar/styles/site'`, `@use './app/astra/styles'`).

### Sans changer le rendu, et en le prouvant
- Le déplacement à place égale a donné un **CSS compilé identique à l'octet**.
- Ensuite, les feuilles BPM qui étaient intercalées dans le site (présentation commune, projets) ont été regroupées en tête de la couche d'Astra, et les feuilles du calendrier en un seul bloc. Cela change l'ordre de la cascade ; l'empreinte des styles le contrôle :
  - **48 vues d'Astra** : 19 pages, à 1440 et 375 px, plus les fiches projet (fiche, budget, tâches) et les fenêtres de saisie (dépense, projet) ;
  - les **calendriers hors Astra** (`/calendrier`, `/patrimoine/calendrier`) et le **portail des modules**, mesurés dans les deux ordres.

  Résultat : rendu **identique** partout.
- L'outil d'empreinte mesure maintenant aussi les fiches et les fenêtres, et toute adresse du site (`FP_PATHS=/calendrier,/modules`). Le bruit connu (une liste grisée pendant son chargement) est ignoré.

### Écrans repris
- **151 déclarations toujours écrasées** retirées : le même sélecteur redéfinissait la propriété plus loin. Elles ont été retrouvées par la carte des sources Sass ; une ligne qui produit plusieurs sorties n'est retirée que si toutes sont écrasées. Elles étaient surtout dans la grille du calendrier (85) et la parité Budget (20). Il en reste 101, qui sont des replis volontaires ou viennent de mixins.
- **Contextes disparus** retirés : 9 identités d'espaces qui n'existent plus (`budget-create`, `budget-calendar`, `maintenance`…). Les écrans BPM ne visent plus l'ancien espace « calendrier budgétaire » : `:is([data-application], [data-space='budget-calendar'])` devient `[data-application]`, de même spécificité.
- Jetons : les écrans BPM lisent déjà les teintes de partie d'Astra (`--bpm-section-*` ← `--astra-*`, dans `_shell.scss`). Rien n'est dupliqué.

### Chiffres
| | Avant la 3ᵉ passe | Maintenant |
|---|---|---|
| Feuilles globales dans `src/styles` | 48 | **29** |
| Feuilles rangées avec leur couche (Astra, calendrier) | 0 | **28** |
| CSS global (build de production) | 677 ko* | **657 ko** |
| Classes mortes | 143 | **21** |
| `!important` (toutes feuilles) | 117 dans les globales | 49 dans les globales et Astra |
| Avertissements Sass (fonctions dépréciées) | plusieurs dizaines | **0** |

\* Taille du build mesurée au début de la 3ᵉ passe, après le premier nettoyage.

### Vérifications
API 280 ✓ · web 356 ✓ · build ✓ · test d'interface Astra ✓ · empreinte identique (48 vues d'Astra, calendriers hors Astra, portail).

### Ce qui reste
- Les 29 feuilles du site restent globales. Elles habillent aussi le portail, l'administration et la coquille, qui ne sont pas Astra.
- 101 déclarations écrasées et 21 classes mortes, dans des constructions où un retrait automatique ne serait pas sûr. `npm run styles:audit` les liste.

---

## 8. Cinquième passe : fin du nettoyage et rangement du site (26 nov., nuit)

### Zéro classe morte
Les 21 classes restantes ont été examinées **une par une** :
- **19 vraies classes mortes**, retirées : anciens tableaux de bord, onglets d'anciennes pages, liste de projets d'une version précédente des Mouvements, contexte d'anciennes routes Budget, ancien éditeur de ligne de projet…
- **2 fausses alertes**, corrigées dans l'audit :
  - `load-css` est une fonction Sass, pas une classe ;
  - `.ghost` n'était cité que dans des exclusions `:not(…)` d'un alias jamais utilisé. L'alias est retiré avec ses deux règles.

### Zéro déclaration toujours écrasée
- **101 → 0.** Les déclarations redéfinies plus loin pour le même sélecteur sont retirées, y compris les variables CSS (par exemple les teintes `nav-*` des écrans BPM, réglées deux fois).
- Les teintes « navy » de la vue d'ensemble n'étaient plus générées deux fois : la boucle des identités les laisse maintenant à `_overview-theme.scss`.
- Les **45 écrasements restants** ne visent qu'**une partie** des sélecteurs de leur règle : la déclaration sert encore aux autres. Ils sont donc utiles.
- **Deux fusions de sélecteurs** ont été repérées et corrigées pendant le nettoyage. En retirant une règle vidée, un sélecteur de la ligne précédente se serait rattaché à la règle suivante (dans le calendrier et dans les fenêtres). La comparaison des sélecteurs compilés avant/après les a détectées.

### Les 29 feuilles du site, rangées avec ce qu'elles habillent
| Dossier | Feuilles |
|---|---|
| `src/styles/fondations/` | polices, contrat, jetons, identités des espaces, base, passerelle des jetons (7) |
| `src/styles/coquille/` | coquille (barre du haut), zones (menu et portail), adaptations, cadre, barre de travail, niveaux (5 + `levels/`) |
| `src/styles/composants/` | composants, formulaires, interactions, langage des surfaces, contrôles, mises en page, relief, éclat, tableaux du noyau (10) |
| `src/styles/pages/` | accueil, utilisateurs, accompagnement, thème de la vue d'ensemble, pages du socle (5) |
| `src/styles/` | outils Sass sans sortie : `_functions`, `_contrat-ruptures` |

Le CSS compilé est **identique à l'octet**. Les polices ont été réancrées (chemin relatif plus profond) et sont vérifiées chargées sur le site.

### `npm run styles:audit`, garde-fou complet
Il compte les classes mortes, les déclarations toujours écrasées (CSS global compilé) et les `!important`. Il **échoue** si l'un des deux premiers compteurs dépasse zéro. Il signale aussi les **copies système non chargées** : des fichiers « nom 2.scss » créés par la synchronisation du dossier Documents.
- Les 5 copies apparues cette nuit sont déplacées dans `.trash/copies-systeme-2026-11-26/` (récupérables).
- 7 copies plus anciennes (12 au 22 nov.) restent en place : je ne les ai pas créées, à vous de décider.

### Vérifications
| | Résultat |
|---|---|
| `styles:audit` | 128 feuilles · **0 classe morte · 0 déclaration écrasée** · 87 `!important` |
| Empreinte | identique : 48 vues d'Astra (pages, fiches, fenêtres, 1440 et 375 px), calendriers hors Astra, portail |
| Tests | API 280 ✓ · web 356 ✓ |
| Build | ✓ (CSS 652 ko, contre 677 ko au début de la 3ᵉ passe) |
| Test d'interface Astra | ✓ |

### Ce qui n'est pas fait
- Les 87 `!important` restants n'ont pas été retirés : ils départagent encore de vraies règles concurrentes (fenêtres, calendrier, bouton principal). Les retirer demande de revoir ces conflits un par un.
- Les feuilles des composants (`*.page.scss`, `calendar-skin*.scss`…) restent avec leur composant, comme Angular le prévoit.

---

## 9. Sixième passe : les `!important` et les feuilles des composants (26 nov., nuit)

### `!important` : 69 lignes → 15, toutes justifiées
Chaque `!important` a été traité un par un :
- **Retrait direct** quand l'empreinte montrait qu'il ne départageait plus rien : utilisateurs, zones, Mouvements, sens des couleurs, Bilans, fenêtres de saisie, habillages du calendrier.
- **Retrait de règles mortes** : deux règles visaient des attributs qui n'existent plus (visite guidée, lecture intégrale).
- **Conflit réglé à la source**, quand il servait encore. La règle concurrente a été trouvée avec `e2e/css-why.mjs`, puis corrigée :
  - **Remise à zéro de l'accueil** (`:is(h1, h2, p, dl, ul…) { margin: 0 }`) : elle prenait la spécificité de ses éléments et battait les cartes. Elle passe en `:where`, de spécificité nulle, et les cartes la complètent naturellement. Deux règles contradictoires sur les listes (14 px contre 8 px) sont réduites à celle qui s'affichait.
  - **Bouton principal de la barre** : une ancienne règle le remplissait, la barre le voulait en contour. La règle de remplissage ne vise plus que les boutons dans la page.
  - **Bandeaux des fiches** : une règle mobile ajoutait une marge que le cadre retirait de force. Elle ne pose plus cette marge.
  - **Calendrier hébergé dans Astra** :
    - les réglages compacts de la pagination et de la case « terminés » vont dans le composant du calendrier, à leur vraie place ;
    - le cadre d'Astra règle la pagination qu'il héberge dans sa barre, et les choix de vue qu'il héberge dans son panneau ;
    - nouveau contrat `data-own-layout` : une commande qui garde sa propre disposition n'est pas remise en colonne par le panneau.
  - **Vue semaine du calendrier** : l'empreinte ne couvrait que la vue par défaut, et c'est le nouvel outil `e2e/calendar-views-fingerprint.mjs` qui a montré la régression. Sans `!important`, la semaine reprenait une largeur minimale de 860 px (défilement de côté sur téléphone) et la colonne d'agenda en présentation compacte. La largeur minimale est retirée, et la règle compacte à deux colonnes ne vise plus la semaine.
  - **Animations de sortie du calendrier** : les règles d'apparition ne visent plus un élément qui disparaît.
  - **Plafonds** : la marge sous l'en-tête des cadres BPM passe en spécificité nulle. Le tableau des plafonds, qui gère ses espacements par `gap`, l'emporte.

**Les 15 lignes restantes** relèvent de 4 exceptions admises, qui doivent primer par nature :
1. les préférences de mouvement : mouvement réduit du système et choix « sans animation » du calendrier ;
2. `[hidden]` ;
3. `.visually-hidden` ;
4. les réglages administrés de la navigation (Réglages de navigation).

`npm run styles:audit` **échoue** dès qu'un `!important` apparaît hors de ces exceptions.

### Un seul changement visible, voulu
Sur la **fiche projet**, les cartes de tâches avaient une marge intérieure forcée à 16 px. Elles prennent maintenant l'échelle d'Astra (12/14 px), comme sur la page Tâches.

### Feuilles des composants
Elles restent avec leur composant. Angular les isole à leur composant, et les sortir supprimerait cette isolation. Elles sont maintenant contrôlées comme les feuilles globales :
- classes mortes : 0 ;
- `!important` hors exceptions : 0 ;
- pas de copie système chargée ;
- couvertes par l'empreinte des pages qui les affichent, y compris les vues du calendrier.

### Outils ajoutés
- `e2e/css-why.mjs` : pour un élément, quelles règles posent une propriété, dans l'ordre du gagnant, avec leur spécificité.
- `e2e/calendar-views-fingerprint.mjs` : empreinte du calendrier dans ses vues (mois, semaine, année), dans Astra et hors Astra.

### Vérifications
| | Résultat |
|---|---|
| `styles:audit` | 128 feuilles · 0 classe morte · 0 déclaration écrasée · **0 `!important` hors exceptions** (15 admis) |
| Empreinte d'Astra (48 vues) | identique, hors cartes de la fiche projet (voulu) |
| Pages hors Astra (calendriers, portail, utilisateurs, administration) | identiques |
| Vues du calendrier (mois, semaine, année ; dans et hors Astra ; 1440 et 375 px) | identiques |
| Tests | API 280 ✓ · web 356 ✓ |
| Build | ✓ (CSS 651 ko) |
| Test d'interface Astra | ✓ |
