# BPM · Bilan de la version e66a823 et mise en cohérence de la navigation

_7 novembre 2026. Ce travail touche uniquement la couche BPM (N3, présentation et interaction) : il n'ajoute aucune règle métier et n'écrit aucune donnée._

## 1. Ce qu'a apporté la version e66a823

Quatre commits sur 188 fichiers. Ils couvrent trois chantiers.

### 1.1 Navigation et cadre des pages (BPM, `web/`)
- **Cadre du haut contextuel.** `page-toolbar`, `app-hero` et `bpm-page-banner` donnent à chaque page :
  - un titre ;
  - un « focus » qui dit quoi faire maintenant ;
  - une barre d'outils avec la commande principale, les raccourcis et le périmètre lu (période, filtres) ;
  - le résultat de la dernière action.
- **Sous-pages dans le menu de gauche.** `PAGE_WORKSPACES` déclare 40 sous-pages, chacune rattachée à sa page parente. `section-page-menu` les affiche sous la page de la section.
- **Parcours BPM.** La barre « ← Retour / Suivant → » mémorise l'historique de l'utilisateur. On y ajoute :
  - les brouillons par utilisateur (`drafts`) ;
  - le flux de saisie partagé (`entry-flow`) ;
  - des actions de formulaire homogènes (`form-actions`) ;
  - les priorités de ligne et le focus de page.
- **Pages nouvelles ou refondues :**
  - Objectifs et avenir (objectifs datés, projection, épargne et cap patrimonial) ;
  - espaces de gestion de projet (créer, attribuer les enveloppes, décider les financements) ;
  - présentation des périodes.

### 1.2 Middlewares (N2, `api/src/modules`)
- Budget :
  - `cycle-policy` porte les règles du cycle ;
  - `funding` porte les financements de tâches ;
  - `project-analysis` porte la lecture consolidée d'un projet.
- Patrimoine : `objectives` porte les objectifs datés et leur couverture.
- Les règles sur les opérations annulées et les périodes closes sont reprises côté middleware et testées : `cancel-operation`, `caps-closed-periods`, `bpm-boundaries`.

### 1.3 Recette
- Jeux de recette (recette-30 N01 à N10, parcours, objectifs) et scénarios fonctionnels BPM.
- Documents `AUDIT-BPM-2026-11-07.md` et `BPM-PRESENTATION-ET-PARCOURS.md`.

## 2. Les incohérences constatées

La version apportait deux nouveaux systèmes de repérage, le cadre du haut et les sous-pages. Ils ne parlaient pas encore d'une seule voix.

| # | Incohérence | Effet pour l'utilisateur |
|---|---|---|
| 1 | Deux systèmes d'onglets concurrents. Des onglets internes aux pages (`caps-workspaces`, `objectives-tabs`, ancres de Réglages) doublaient les sous-pages du menu, avec d'autres libellés. | Deux chemins vers le même écran, sous deux noms différents. |
| 2 | Une même vue avait plusieurs adresses. Les anciens liens `?view=` et `#ancre` coexistaient avec les sous-pages. | Le menu et le fil d'Ariane n'indiquaient pas l'écran réellement affiché. |
| 3 | Des pages en double : `/depenses` et `/depenses/registre`, `/argent/entrees` et `/tableau-de-bord/entrees`, `/argent/reste` et `/tableau-de-bord/rapprochement`, `/app/projets/:id` et `/app/gestion-projet/:id`. | Un même écran sous plusieurs noms dans l'historique et le fil d'Ariane. |
| 4 | Des surtitres codés en dur dans chaque page (« Budget/Patrimoine · … ») et des liens de retour propres à chaque page. | Le bandeau ne disait pas la même chose que le menu. |
| 5 | Historique et hiérarchie confondus. Des « ← Retour » de bandeau remontaient à la page parente, comme la barre de parcours qui, elle, revient à la page précédente. | On ne savait pas si « Retour » ramenait en arrière ou au niveau du dessus. |
| 6 | Fiche projet anonyme. Le fil d'Ariane affichait « Détail », les sous-pages Budget et Tâches n'étaient pas reliées à la fiche, et leur titre remplaçait le nom du projet. | On perdait de vue le projet sur lequel on travaillait. |
| 7 | Vocabulaire d'action hétérogène : « + Ajouter… », « Nouvelle opération », « Saisir une opération », ordre Dépense/Entrée variable. | Plusieurs noms pour une même action. |
| 8 | Outils de sous-page présentés comme ceux de la page. | Sur une sous-page, la barre d'outils ne disait pas ce qu'elle visait. |
| 9 | Détail d'un poste anonyme (« Détail d’un poste ») et retour vers des libellés qui ne correspondaient pas au menu. | Fil d'Ariane et titre en désaccord. |

## 3. La charte de navigation BPM

Une règle unique : **le plan du site décide de tout**. Il est défini dans `shared/site-plan.ts` (zones → sections → pages → sous-pages → détails). Le menu, le fil d'Ariane, le bandeau, les onglets, le titre de l'onglet du navigateur et l'historique en sont **dérivés**. Aucune page ne les code elle-même.

- **R1. Une vue, une adresse.** Chaque vue a son adresse canonique. Les anciennes adresses (`?view=`, `#ancre`, routes en double) y conduisent par redirection en gardant la période, les filtres et l'ancre (`app.routes.ts` `canonical()`, `bpm/ui/legacy-view.ts`).
- **R2. Le fil d'Ariane dit où l'on est :** Zone / Section / Page / Objet ouvert / Sous-page ou détail. Une page homonyme de sa section n'est pas répétée. Le dernier élément n'est pas un lien.
- **R3. Le surtitre du bandeau situe la page :** « Section » sur une page, « Section · Page » sur une sous-page ou un détail.
- **R4. Deux mouvements distincts.**
  - **« ↑ Parent »** dans le bandeau remonte d'un niveau dans le plan : la page parente, ou la fiche pour une sous-page de projet.
  - **« ← Retour / Suivant → »** dans la barre de parcours suit l'historique de l'utilisateur.
- **R5. Les onglets du bandeau reprennent le menu.**
  - Une page qui a des sous-pages montre sa vue principale (libellé `mainLabel`, par exemple « Suivi des plafonds ») et ses sous-pages, avec les libellés du menu.
  - Sur une fiche objet, les onglets sont « Vue d’ensemble » et les vues de l'objet (« Budget et décisions », « Tâches »).
  - Changer d'onglet garde la période et les filtres de lecture, jamais une saisie ouverte. Sur un écran étroit, l'onglet courant reste visible.
- **R6. Un objet ouvert est nommé partout.** La page publie son nom par `PageObjectLabels` (`shared/plan-context.ts`). Le fil d'Ariane, le menu, l'historique et le titre affichent alors ce nom, par exemple « Cuisine · parcours complet » ou « Poste Loisirs », à la place d'un libellé générique.
- **R7. Un seul vocabulaire d'action.**
  - Le glyphe est toujours ＋. On écrit « ＋ Saisir une entrée », « ＋ Saisir une dépense », « ＋ Saisir une entrée ou une dépense », toujours dans l'ordre Entrée puis Dépense.
  - Pour un objet, on écrit « ＋ Créer un projet de la vie », « ＋ Créer un objectif daté », « ＋ Créer une catégorie » ; pour une récurrence, « ＋ Dépense récurrente ».
  - Sur une sous-page, la barre d'outils s'intitule « Outils · {sous-page} ».

## 4. Ce qui a été fait

### 4.1 Socle partagé (un seul calcul pour tout le cadre)
- `shared/site-plan.ts` :
  - `planContext(url, nom)` calcule le fil d'Ariane, le surtitre, le parent, les onglets et le libellé de l'écran courant ;
  - `locate()` reconnaît une fiche projet ;
  - `pageChildren()` imbrique la fiche ouverte et ses vues dans le menu ;
  - ajout de `mainLabel`, des profondeurs de menu et de `projectLink()`.
- `shared/plan-context.ts` (nouveau) contient `PageObjectLabels`, `injectCurrentUrl()` et `injectPlanContext()`.
- `shared/page-tabs.component.ts` (nouveau) fournit les onglets du bandeau, partagés par les bandeaux BPM et `app-hero`.
- `shared/page-workspace.ts` dérive le lien « ↑ » du plan.

### 4.2 Cadre
- `app.ts` construit le fil d'Ariane à partir du plan et transmet le nom de l'objet ouvert au menu.
- `section-page-menu` affiche la fiche ouverte et ses vues en retrait (↳).
- `bpm/ui/page-banner.ts` :
  - surtitre, titre et chapeau viennent du plan ;
  - affiche les onglets et le lien « ↑ Parent » ;
  - la barre d'outils d'une sous-page s'intitule « Outils · {sous-page} ».
- `bpm/ui/heading.ts` et `app-hero` affichent le lien hiérarchique « ↑ … » ; le préfixe « Budget/Patrimoine · » disparaît.
- `bpm/ui/navigation*.ts` : l'historique nomme les fiches et les postes ouverts, et se renomme quand le nom arrive.

### 4.3 Pages
- **Plafonds et catégories** et **Objectifs et avenir** :
  - leurs onglets internes sont retirés au profit des onglets du bandeau ;
  - les anciens `?view=` et `#ancre` redirigent vers `/plafonds/reglages`, `/plafonds/categories`, `/vision/reperes` et `/vision/projection` ;
  - les actions qui changeaient de vue ouvrent désormais la sous-page.
- **Cycle et réglages** : les boutons-ancres qui doublaient les sous-pages sont retirés (le rappel des clôtures est gardé).
- **Fiche projet** :
  - le titre est le nom du projet ;
  - « Budget et décisions » et « Tâches » deviennent des onglets ;
  - « ↑ Gestion de projet » remonte depuis la fiche, « ↑ {projet} » remonte depuis ses vues.
- **Détail d'un poste** :
  - le poste est nommé dans le fil d'Ariane et le menu ;
  - « ↑ » renvoie à la page d'où l'on vient (Tableau de bord, Registre des flux, Entrées de la période, Projet de vie, Plafonds…).
- **Tous les liens internes** pointent vers les adresses canoniques (une quinzaine de pages et leurs tests).
- **Surtitres et retours codés en dur** retirés d'une quinzaine de pages.
- **Vocabulaire d'action** harmonisé sur toutes les pages BPM et dans l'éditeur d'opération.

### 4.4 Middleware
**Aucun middleware ajouté.** Tout ce travail est de la présentation et de l'interaction. La position dans le plan, les libellés et les onglets ne relèvent pas du métier. Les règles métier (cycle, financements, objectifs, plafonds) restent dans les modules Budget et Patrimoine, qui les portent déjà depuis e66a823.

## 5. Vérifications
- Tests web : **248/248**. Ils couvrent le contexte de plan, la fiche projet, les redirections canoniques, les onglets des plafonds et les brouillons entre sous-pages.
- Tests API : **192/192**.
- Build Angular : OK.
- Contrôle dans le navigateur sur un utilisateur de test, sans écriture :
  - Tableau de bord et ses sous-pages ;
  - Plafonds (dont l'ancienne adresse `?view=categories`) ;
  - Objectifs (ancienne adresse `?view=reperes`) ;
  - Réglages, Projet de vie, Gestion de projet ;
  - fiche projet et sa vue Tâches ;
  - détail d'un poste ;
  - Calendrier ;
  - largeur mobile.

Corrections apportées pendant ce contrôle :
- l'onglet courant était illisible sur les bandeaux sombres ;
- la fiche projet plantait son chargement quand le nom manquait ;
- l'onglet courant sortait du champ sur mobile.

## 6. Pistes suivantes (non faites)
- Appliquer R6 aux autres objets ouverts quand ils auront leur page (catégorie, objectif daté).
- Ranger les écrans du noyau (`/projects`, `/tasks`, `/socle/*`) sous la même charte. Ils utilisent déjà `app-hero` et les onglets, mais leur vocabulaire d'action n'a pas été revu.
