# Journal des changements

Les PR du socle, de la plus récente à la plus ancienne. La référence de l'architecture est dans
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Grand noyau (socle) : créer un utilisateur quand la connexion est exigée — 28 novembre 2026

Évolution en **mode socle**, BPM-Astra inchangé.
- Avec `SOCLE_AUTH=required`, l'API refuse la création directe d'un profil (`POST /api/users` : « La création d'un profil
  passe par l'inscription »), car un profil sans compte ne pourrait jamais se connecter. Le formulaire « Nouvel
  utilisateur » appelait pourtant cette route et affichait l'erreur.
- Dans ce mode, le formulaire demande maintenant l'adresse e-mail et le mot de passe du nouvel utilisateur et passe par
  l'inscription (`/api/auth/register`) avec les mêmes champs (stock d'ouverture, objectif, cycle) : profil, composition
  et compte naissent en une seule écriture, puis le nouvel utilisateur est connecté. En mode local, rien ne change.
- Test API : l'inscription porte toute la composition, la création directe reste refusée.

## Mes projets · présentation simple — 28 novembre 2026

Évolution en **mode application** (Mes projets seulement).
- On garde le **bandeau mauve** (titre, « Why? » et but du thème, New project / New task, onglets 00 à 07).
- **Overview** : plus aucune donnée de projet (chiffres clés, tableau, tableaux par état et rattachement retirés). La
  page liste la séquence des processus PRINCE2.
- **Pages de thème** : « Where the theme applies », puis la liste simple des processus du thème (ce que le thème demande
  à chacun). Registres, produits et pagination retirés de l'écran ; le composant de registre reste dans l'application.

## Grand noyau (socle) : les applications autonomes sans barre de parcours — 28 novembre 2026

Évolution en **mode socle**, BPM-Astra inchangé.
- La barre de parcours du site (Début, Retour, sélecteur de l'étape, Suivant, Reprendre) n'est plus affichée dans la zone
  « Applications autonomes » : chaque application garde sa propre interface. Les autres zones la gardent.
  `ZONE_APPLICATIONS_AUTONOMES` (`platform/applications-autonomes.ts`) et `showJourney` (`app.ts`).

## Grand noyau (socle) : zone « Applications autonomes » sur l'accueil des modules — 28 novembre 2026

Évolution en **mode socle**, BPM-Astra inchangé. Référence : `docs/ARCHITECTURE.md` §20.1.
- **Barre de parcours sans vide** : elle recevait la marge basse d'une page (80 px), d'où un vide inexpliqué sous la
  barre sur toutes les pages qui l'affichent (Calendrier, Object Management, applications autonomes). Corrigé dans
  `styles/coquille/_app-shell.scss`.
- Les applications autonomes ont **leur propre zone** (AA), au même niveau que les autres : une bande « Applications
  autonomes » sur l'accueil des modules (`/modules`), une entrée des zones principales du menu, une section par
  application qui ouvre directement son espace (`/mes-projets`).
- La section « Applications autonomes » de la zone Noyau transverse est retirée : la zone la remplace.

## Mes projets · style du socle, anglais et mise en page — 28 novembre 2026

Évolution en **mode application** (Mes projets seulement).
- **Style du socle** : bandeau mauve avec titre, gestes de création et onglets numérotés (Overview, puis les 7 thèmes),
  fiche blanche avec des blocs titrés, chiffres clés en ligne et colonnes par état comme les pages du noyau.
- **Tout en anglais**, langue d'origine de PRINCE2 : écrans, référentiel (`prince2.ts`), registres et catalogue de
  `donnees.json` (version `prince2-2017-en`). La page Pilotage de BPM-Astra reste en français.
- **Mise en page** : la colonne de navigation latérale qui créait des vides est remplacée par les onglets, la double
  marge en haut est retirée, les chiffres clés ne débordent plus, les tableaux par état passent à la ligne.

## Mes projets · registres PRINCE2 — 28 novembre 2026

Évolution en **mode application** (Mes projets seulement). Chaque page de thème a maintenant son registre pour un projet qui a son dossier :
produits de management, rôles, registre qualité, séquences, risques, incidences et journal. On y ajoute une ligne et
on change son état sur place. « Ouvrir la séquence » crée son plan, son rapport de situation et son rapport de fin de séquence.

## Mes projets · application autonome PRINCE2 — 27 novembre 2026

Évolution en **mode application** (Mes projets seulement). Référence : `docs/sections/projets.md`.
- **Application autonome Mes projets** à `/mes-projets`, dans l'interface habituelle du site, avec un lien dans
  Noyau transverse › Applications autonomes. BPM-Astra est inchangé. Elle comprend un accueil de gestion de projet
  (état des projets et tâches, séquence PRINCE2, vues par état, création et rattachement) et les 7 thèmes PRINCE2
  (but, processus associés, livrables).
- **Modèle de données** (`donnees.json`, tables `AA_MP_…`) : catalogue PRINCE2 standard, 9 tables d'instanciation et
  31 règles. Le bouton « Ouvrir le dossier » crée le dossier PRINCE2 d'un projet et ses premières lignes.

## Grand noyau (socle) : espace des applications autonomes et tables AA_ — 27 novembre 2026

Évolution en **mode socle**, BPM-Astra inchangé. Référence : `docs/ARCHITECTURE.md` §20.1.
- **Espace propre d'une application autonome** : l'inscription peut déclarer un `espace` (adresse, titre, description,
  écran). Le site sert l'application à cette adresse dans son interface habituelle (`platform/applications-autonomes.ts`).
- **Section « Applications autonomes »** (zone Noyau transverse, N0 · 05) : un lien par application qui repose sur le
  noyau, cachée tant qu'aucune n'est inscrite.
- **Base commune des données des applications autonomes** (§20.2) : modèle déclaré dans `donnees.json` du dossier de
  l'application, module transverse « applications », tables `AA_` + préfixe de la section (`AA_MP_…`, `AA_SY_…`),
  catalogue de référence commun en lecture seule, instanciation par règles, routes `/api/aa/…`.
- Site : accès générique `Api.aaList`, `aaCreate`, `aaUpdate`, `aaInstancier` et le type `LigneApplication` (grand-noyau.ts).
- Contrat mis à jour : 99 exports côté site (+ `EspaceInscrit`, `LigneApplication`, `InscriptionApplication` étendue), 160 routes (+ 6 `/api/aa`).

## Grand noyau (socle) : le socle à l'abri pour les applications autonomes — 27 novembre 2026

Évolution en **mode socle**, sans aucune fonctionnalité nouvelle ni écran modifié. Référence : `docs/ARCHITECTURE.md` §20.
- **Mode de chaque PR** (`scripts/mode-pr.mjs`, tâche « Mode de la PR » sur GitHub, `npm run mode`) : grand noyau ou
  application autonome, jamais les deux. Exception visible : l'étiquette `transition-socle` (utilisée par cette PR, qui
  déplace la déclaration de la page Pilotage du menu du socle vers Mes projets).
- **Point d'inscription des applications** : `sections/<clé>/application/inscription.ts` (pages, gestes, jeux d'essai),
  registre `sections/inscriptions.ts`, types dans `astra/cadre.ts`. Le menu, les onglets, la palette et les tests
  d'interface reprennent les pages inscrites. Mes projets y inscrit Pilotage (même place, mêmes gestes qu'avant).
- **Contrat figé du grand noyau** (`npm run contrat`, photo `api/test/contrat/`, test `contrat-socle.test.mjs`) :
  97 exports de l'interface côté site et 154 routes de l'API.
- **Poste de travail d'une application** : `npm run app -- <clé>`, `npm run test:app -- <clé>`, `npm run e2e:app -- <clé>`.

## Mes projets · mode section, étape 1 : page « Pilotage » — 27 novembre 2026

Première évolution de Mes projets en **mode section** (aucun impact sur le grand noyau : ni API, ni base, ni autre
section). Rangée dans les trois étages : calculs dans les **fonctionnalités Mes projets**
(`sections/projets/fonctionnalites/`), écran dans l'**application autonome Mes projets** (`sections/projets/application/`),
le grand noyau appelé par `platform/grand-noyau.ts` et BPM-Astra par `astra/cadre.ts`.
- **Pilotage** (`/bpm-astra/pilotage`, ajoutée après les pages existantes : l'entrée de Mes projets ne change pas) : l'accueil autonome de la section, bâti sur
  l'accueil de section commun (`<app-section-home>`) ; utilisable sans budget ni cycle. Indicateurs (projets en cours,
  en retard, tâches ouvertes et à échéance sous 7 jours, avancement moyen, temps passé / prévu).
- Trois vues sur les mêmes lectures du noyau (`/api/projects`, `/api/tasks`) : **Portefeuille** (santé de chaque
  projet expliquée : en retard, à surveiller, dans les temps, pas commencé, terminé), **Tableau des tâches** (colonnes
  par état, filtres projet / recherche / retard, changement d'état par la commande du noyau), **Planning** (projets et
  tâches dans le temps, repère du jour). Le projet de vie (racine du budget) n'est pas un projet à mener : il est écarté.
- Un projet financé le dit seulement ; son financement reste dans sa fiche (liens par `sourceLink`).
- Tests : `sections/projets/fonctionnalites/portfolio.spec.ts`, `sections/projets/application/pilotage.page.spec.ts` ; la page est vérifiée par `e2e/astra.e2e.mjs`.

## Grand noyau (socle) : trois étages pour les applications autonomes — 27 novembre 2026

Évolution en **mode socle** : aucune fonctionnalité propre à une section, aucun écran modifié.
- **Grand noyau (socle)** : interface unique du site `platform/grand-noyau.ts` (API, modèles, mise en forme, sections,
  ouverture à la source, accueil de section), que les fonctionnalités par section et les applications autonomes appellent.
- **Fonctionnalités par section** (`sections/<clé>/fonctionnalites/`) et **applications autonomes** (`sections/<clé>/application/`,
  `hybrides/<nom>/`) ; cadre d'accueil BPM-Astra `astra/cadre.ts`.
- **Gardes** (`api/test/application-isolation.test.mjs`) : les fonctionnalités d'une section n'ont pas d'écran et n'appellent que le grand noyau et
  d'autres fonctionnalités par section ; une application autonome n'appelle que le grand noyau, les fonctionnalités par section et le cadre ; tout fichier de
  `sections/` ou `hybrides/` appartient à l'une ou à l'autre.
- **Documentation** : `docs/ARCHITECTURE.md` §19 ; plan en place (`docs/socle/`, `docs/sections/` : gabarit, fiches des
  cinq sections, modes section et socle, fondations, applications hybrides).

## Sections du site, notion commune du socle (évolution 1) — 27 novembre 2026

Vision « cinq sections autonomes, un seul site » : le code reste un seul site ; la section devient une notion commune
à la base, à l'API et au site, pour que chaque section se développe ensuite seule en s'appuyant sur les autres.
- **Catalogue unique** `api/src/socle/sections.json` (+ `sections.mjs`) : les cinq sections et le système (clé,
  préfixe de table, nom, verbe, teinte, promesse, ce que la section est seule à décider, collections) et les neuf flux
  entre sections. Les tables en dérivent (`engines/tables.mjs`, noms inchangés) ; le site lit le même fichier
  (`web/src/app/platform/sections.ts`) et les parties d'Astra en tirent leur nom et leur teinte.
- **Un fait, une section propriétaire** : le registre donne à chaque nature la section de sa collection
  (`registry.sectionOf(kind)`) et refuse une nature déclarée dans une autre section. `GET /api/navigation/sections` :
  le catalogue, les natures de chaque section et les flux.
- **Horloge commune** : `GET /api/bpm/cycle/clock` (`bpm.cycleClock`) donne à toutes les sections la même lecture du
  cycle (phase `to_configure` / `running` / `to_close`, période, période courante, jours restants, verrou).
- **Ouvrir un fait à sa source** : une application déclare où se gère chaque nature (`sources`) ; une page le retrouve
  par `sourceLink(kind, ref)` / `sourceLinkOfId(id)` (`platform/source-link.ts`) au lieu d'écrire une adresse en dur.
- **Accueil de section générique** `platform/section-home.ts` (`<app-section-home>`) : promesse, indicateurs, état
  « section seule », contenu propre, ce que la section reçoit et donne, ce qu'elle est seule à décider.
- Aucun écran ni aucune réponse existante ne change. Tests : `api/test/sections.test.mjs`, `platform/sections.spec.ts`.

## Contexte explicite à la place de l'état ambiant — 27 novembre 2026

- **Lecture de l'état** : les modules ne lisent plus `socle.state`, dont la valeur dépendait de la requête en cours
  (contexte asynchrone). Ils lisent `socle.stateOf(ctx)` avec le contexte qu'ils reçoivent : les 89 lectures des
  modules, `ObjectManager.simulate` et le serveur HTTP. Les lecteurs qui n'avaient pas de contexte le reçoivent en
  premier argument : paramètres, métriques et journal de l'administration, liste des calendriers, réglages de la
  navigation, types de users, routes d'Object Management, vision de la composition (`visionOf(state, comp)`).
- **Garde-fous** : pendant une requête, `socle.state` est refusé et `stateOf` refuse le contexte d'un autre user que
  celui de la requête (`AMBIENT_STATE`, 500) : une lecture ne passe plus, sans le dire, à une partition non revalidée.
  Hors requête (scripts, tests), `socle.state` reste la vue complète.
- Tests de l'API : 317/317 avec SQLite et avec PostgreSQL.
## Habillage du calendrier hors de la feuille globale — 27 novembre 2026

- **Feuille globale allégée** : la parité avec le budget, les formats d'affichage, les commandes, la pleine largeur et
  le module branchable du calendrier (`calendar/styles/site/`) ne sont plus dans `styles.scss`. Ils se chargent avec
  `CalendarSpace`, sans encapsulation, en trois feuilles (`calendar-site*.scss`, chacune sous le budget de 24 ko par
  feuille de composant). Feuille globale : 549 → 505 ko (55,7 ko compressés). Seule la grille reste globale : le
  mini-calendrier du tableau des projets s'en sert.
- **Ordre de la cascade** : mêmes sélecteurs, donc même spécificité, mais une autre place. `e2e/styles-order-check.mjs`
  cherche, dans les pages ouvertes et en tenant tous les états pour vrais (survol, focus, case cochée, désactivé), les
  égalités de spécificité dont l'ordre s'est inversé. Une seule trouvée et corrigée : une option de format désactivée
  garde l'aspect commun des contrôles désactivés (`_formats.scss`). 234 sélecteurs vérifiés sur des éléments
  (vues, survol des jours, aperçu d'un jour, volet Sources, deux largeurs) ; les 57 autres relus un à un, sans égalité
  possible. Empreintes identiques (50 vues Astra, 18 pages du site, 12 vues du calendrier).

## Points restants du rapport v6 — 27 novembre 2026

- **Mise en ligne** : la CSP du site n'accepte plus de balise `<style>` en ligne sans le nonce de la page
  (`style-src-elem 'self' 'nonce-…'`, `style-src-attr 'unsafe-inline'`). `scripts/site-server.mjs` tire un nonce neuf à
  chaque envoi d'`index.html` (jamais mis en cache) et l'écrit sur `<app-root ngCspNonce>` ; l'aperçu de la navigation
  le recopie sur sa feuille. HSTS derrière un proxy HTTPS. `npm run deploy:check [https://hôte]` contrôle les réglages
  de l'API et le site ouvert (voir `docs/DEPLOIEMENT.md`). `e2e/style-fingerprint.mjs` relève les violations de la CSP.
- **Fiche projet** : la note de portée et « Ventilation et cycle actuel », jamais affichées, sont retirées. Le
  drapeau `BPM_PROJECT_DETAIL_PANELS`, qu'Astra mettait à faux, est retiré : Astra affiche de nouveau le parcours de
  financement de la page, la décision d'un dépassement demandé sans tâche, « Contrôles et fin de cycle » et
  « Dépenses sans tâche » (ouverts dans l'onglet Budget, repliés ailleurs). L'état de la fenêtre d'une tâche (tâche ouverte, demande,
  retour, règlement) et ses lectures passent dans `ProjectTaskWindow` (`project-task-window.ts`).
- **Feuilles tirées des hôtes** : `scripts/styles-extract.mjs` donne à la fenêtre d'une tâche et à la personnalisation
  du calendrier les seules règles de leur hôte qui peuvent viser leur gabarit (`*.host.scss`, générés ; la CI vérifie
  qu'ils sont à jour). Personnalisation du calendrier : 44 → 2 ko de CSS. Rendu identique (Astra, site, calendrier).
- **Avertissements Angular** : les 28 `?.`/`??` inutiles corrigés un à un (garde déjà restreinte par un `@if`, type
  trop large côté site corrigé, champ toujours rendu par l'API) ; ils sont désormais des erreurs de construction.
- **Couverture du site** : 68,7 → 70,8 % des lignes ; planchers relevés à 70/66/62/60.

## Retrait du centre de commande de la fiche projet — 27 novembre 2026 (ancien §22 d’ARCHITECTURE.md)

Le centre de commande de la fiche projet (« Du suivi à l'action » : tâche à piloter, prochains flux, cadrans de la part
d'enveloppe et des temps) ne s'affichait nulle part : les écrans BPM ne sont montés que dans Astra, qui fournit
`BPM_PROJECT_DETAIL_PANELS = false`. Il est retiré, sur décision du 27/11/2026, avec tout ce qui ne servait qu'à lui :

- le composant `project-command-center` (gabarit, feuille de 489 lignes) ;
- 24 membres de la page (`commandTask`, `commandCharges`, `commandStats`, `focusTasks`, `applyCommandShare`,
  `applyCommandTime`, etc.) et les brouillons des cadrans (`task-command-drafts.ts`) ;
- le cadran `bpm-dial` (`bpm/ui/dial.ts`), qui n'avait pas d'autre utilisateur.

Les deux règles encore utiles de l'ancienne feuille sont gardées telles quelles : les boutons de statut d'une tâche
(`project-task-status.scss`, pour le gabarit `#taskStatusButtons` de la page) et la barre de commande de la fenêtre
d'une tâche (`project-task-panel.scss`). Les 11 membres de la page rendus publics pour le seul centre de commande
redeviennent protégés. Les mêmes gestes restent testés depuis la fenêtre de la tâche (statut, dates et temps,
dépense, gain). Le drapeau `BPM_PROJECT_DETAIL_PANELS` cache encore, dans Astra, la note de portée et le détail
« Ventilation et cycle actuel » de la fiche. Rendu identique sur les 50 vues d'Astra, fenêtre d'une tâche comprise.

## Points du rapport v4 — 27 novembre 2026 (ancien §21 d’ARCHITECTURE.md)

- **Typage strict imposé** : `web/tsconfig.json` active `strict` et `strictTemplates` (0 erreur au build). Le site a un
  lint (`npm --prefix web run lint`, ESLint avec les règles recommandées de typescript-eslint et d'angular-eslint, code
  et gabarits), lancé en CI. `== null` reste permis (test voulu de « null ou undefined »), `any` reste admis dans les
  tests. Les 91 remarques du premier passage sont corrigées (importations et code morts, deux sorties nommées comme des
  événements du navigateur : `cancel` → `cancelled` sur `bpm-form-actions`, `select` → `pointSelected` sur le
  graphique). Restent 28 avertissements d'Angular (`?.` ou `??` jugés inutiles d'après les types) : gardés, car les
  données viennent de l'API et le repli ne coûte rien.
- **Mots de passe** : scrypt asynchrone (`hashPassword` et `verifyPassword` rendent une promesse) ; le calcul tourne dans
  le pool de libuv et ne bloque plus les autres requêtes (test). Le changement d'identifiants vérifie le mot de passe
  actuel avant l'écriture, puis l'écriture refuse (`STALE_VERSION`) si l'empreinte a changé entre-temps.
- **Gros écrans** : la fiche projet passe de 1 341 à 967 lignes de gabarit. La fenêtre de la tâche
  (`project-task-panel`) et le centre de commande (`project-command-center`, retiré depuis : voir « Retrait du centre de commande » plus haut) sont des
  composants à part qui lisent la page par `PROJECT_PAGE` (`project-page-host.ts`) : la page se fournit elle-même, et
  seuls ses membres publics leur sont accessibles (vérifié par `strictTemplates`). Les gabarits partagés avec les cartes
  (statut, argent, temps, parcours de financement) restent dans la page et arrivent par l'entrée `views` : rendus dans
  la page, ils gardent ses styles. Le calendrier passe de 1 002 à 828 lignes : l'encadré « Votre calendrier, vos
  repères » (`calendar-personalization`) lit le calendrier par `CALENDAR`. Les nouveaux composants reprennent les
  feuilles de leur hôte, sans boîte propre (`display: contents`). Empreintes identiques ; `style-fingerprint` mesure en
  plus la fenêtre d'une tâche, et `calendar-views-fingerprint` accepte `FP_IGNORE`.
- **Recouvrements retirés des autres feuilles** : même passe que pour les points restants du rapport v2 sur les 32 autres feuilles globales (554 lignes,
  790 lignes retirées avec les règles vidées). `styles-cascade.mjs retire` lit maintenant le SCSS avec `postcss-scss`
  (commentaires `//`, variables). Volume : 27 132 lignes ; feuille globale 549 ko (571 avant). Empreintes identiques
  (50 vues d'Astra, 12 du calendrier, 32 des pages du site).
- **Couverture du site** : tests des aperçus du calendrier (`calendar-peeks.spec.ts`) ; plancher de la CI remonté à
  68 % des lignes, 64 % des instructions, 61 % des fonctions et 58 % des branches.

## Points restants du rapport v2 — 27 novembre 2026 (ancien §20 d’ARCHITECTURE.md)

- **CSP sans script en ligne** : `script-src 'self' 'sha256-…'`, sans `'unsafe-inline'`. Le build n'intègre plus la
  feuille critique (`optimization.styles.inlineCritical: false`, plus de script de chargement dans `index.html`).
  L'aperçu de la navigation (cadre `srcdoc` isolé, qui hérite de la CSP du site) porte un script fixe
  (`navigation-preview-script.ts`) ; ses données sont dans un bloc `<script type="application/json">` non exécuté.
  L'empreinte est dans `navigation-preview-csp.json`, lue par `site-server.mjs` et par la CSP du cadre ; un test
  vérifie qu'elle correspond au script, et le e2e `navigation-system` lance la simulation sous la CSP du site.
  Les styles gardent `'unsafe-inline'` (styles des composants Angular) : le retirer demande un nonce par page,
  posé par le serveur d'hébergement.
- **Calendrier découpé** : `calendar.component.ts` passe de 1 025 à 829 lignes. Modules : `calendar-format-editor`
  (formats à soi et brouillon), `calendar-planner` (replanification, glisser-déposer, `calPlan`/`calDate` dans
  l'adresse), `calendar-highlights` (repères en évidence), `calendar-appearance` (design, effets, fondu entre
  périodes), `calendar-grid-keys` (règles pures : flèches, cible du focus, placement du détail). Le gabarit appelle
  ces objets directement (`planner.drag(…)`, `formatEditor.save()`, `highlights.toggle(…)`, `appearance.design()`).
- **Grosses feuilles** : dans `_grid.scss`, `_zones.scss` et Astra `_application.scss`, les règles de même sélecteur
  ou de même bloc sont regroupées quand aucune règle intercalée ne pose une propriété de la même famille (−29 lignes).
  Les 18 doublons de sélecteur restants sont séparés par des règles qui touchent aux mêmes propriétés : les regrouper
  changerait la cascade. Empreintes identiques (48 vues et 12 vues du calendrier).
- **Recouvrements retirés** (`e2e/styles-cascade.mjs`) : la cascade de la feuille globale est calculée dans la page sur
  176 vues (Astra, fiches, fenêtres de saisie, 16 pages du site, vues du calendrier ; 1440, 1024, 768 et 375 px).
  Les déclarations qui perdent sur chaque élément où elles s'appliquent sont retirées de `_zones.scss` (1 271 → 1 127),
  Astra `_application.scss` (1 235 → 1 036) et `_grid.scss` (1 740 → 1 366) : 466 déclarations et 111 règles vidées.
  Empreintes identiques (48 vues d'Astra, 12 du calendrier, 32 des pages du site). Limite : une déclaration écrasée
  partout dans les vues mesurées mais utile dans un écran ou un état jamais visité disparaîtrait ; les règles qui ne
  s'appliquent à rien (survol, menus ouverts) ne sont jamais touchées. Il reste 554 lignes perdantes dans les autres
  feuilles (`_workspace`, `_shell`, `_components`, Astra `_presentation` et `_budget-cycle` en tête). Volume total :
  27 884 lignes (28 818 dans le rapport v2).
- `calendar/styles/_responsive.scss` et `_personalization.scss`, chargées nulle part, sont supprimées (décision de Roosevelt, 27/11) : le rendu ne change pas.

## Correction des 14 faiblesses du rapport du 26 novembre 2026 (ancien §19 d’ARCHITECTURE.md)

### Sécurité

- Garde des requêtes (`createRequestGuard` dans `http.mjs`), dans tous les modes : `Host` limité au poste et à
  `SOCLE_ALLOWED_HOSTS` (contre le « DNS rebinding ») ; toute écriture d'une autre origine refusée (`Origin`,
  `Sec-Fetch-Site`, `SOCLE_ALLOWED_ORIGINS`) ; corps JSON exigé (`415` sinon).
- La remise à zéro de recette n'est plus dans `npm run api`, seulement dans `npm run api:recette`.
- Limitation des essais de connexion : adresse lue dans `X-Forwarded-For` derrière un proxy de confiance
  (`SOCLE_TRUST_PROXY=1`), compteurs dans la table `SY_throttle` avec PostgreSQL (communs à tous les serveurs),
  entrées expirées purgées.
- Jetons avec un identifiant de session (`sid`) : « se déconnecter » révoque le jeton de l'appareil.
- `SOCLE_AUTH_SECRET` (32 caractères au moins) exigé au démarrage en `required` + `sgbd`.
- Site : CSP et en-têtes de sécurité (`scripts/site-server.mjs`). Mise en ligne : `docs/DEPLOIEMENT.md`.

### Données et moteur PostgreSQL

- `readPartition` lit dans une seule transaction `REPEATABLE READ READ ONLY` : objets, révision et journal viennent du
  même instantané. Un test intercale une écriture entre deux lectures.
- Les services asynchrones appelés hors requête s'exécutent dans la partition demandée (`inPartition`), ce qui rend
  la mesure de charge et les scripts utilisables sur PostgreSQL.
- Écritures groupées par table (`unnest`) : une requête par table et par type d'écriture, au lieu d'une par objet.
  La colonne des objets reste en `TEXT`, pour que le JSON reste identique octet pour octet à SQLite.
- `GET /api/health` (base interrogée), arrêt propre sur `SIGTERM`, liste des users paginée (`?limit&offset`).

### Jeux d'essai, tests et dépôt

- Les quatre jeux d'essai passent, remettent le verrou du cycle suivant à la fin et tournent en CI
  (`npm run seeds:check`).
- CI : job `e2e` (site servi comme en production, CSP vérifiée, test Astra dans Chromium) ; couverture du site mesurée
  avec un plancher (`scripts/coverage-threshold.mjs`).
- Fiche projet et calendrier : cockpit du projet de vie, liste des dépenses et lecture d'une journée sortis en
  composants ou fonctions pures testées, rendu vérifié identique par `e2e/style-fingerprint.mjs`.
- Astra : la règle des liens qui doublent un onglet est une fonction pure testée (`astraLinkDoublesTab`), avec un
  opt-out déclaré (`data-astra-keep`).
- `.trash/` et `output/` ne sont plus suivis.

### Suite : points restés ouverts (27 novembre 2026)

- e2e réécrits pour Astra et lancés par `npm run e2e:ci` (job `e2e`) : `projets` (scénario de mai à novembre dans les
  écrans, 32/32), `bpm-navigation` (anciennes adresses, brouillons dans l'historique et au rechargement, contrôle du
  compte, agenda), `navigation-system` (arborescence, brouillon, enregistrement repris par le menu d'Astra ; réglages
  d'origine rétablis). `e2e-ci.mjs` enchaîne `seed` puis `seed:projets` (API arrêtée) sur la base temporaire.
- Bugs trouvés et corrigés : « Saisir une entrée d'argent » depuis Mouvements s'ouvrait en dépense (`entryDirection`
  ignoré) ; l'agenda était écrasé à la hauteur de son titre (`calendar/styles/_variants.scss` de nouveau chargé, sans
  la règle de la vue mois) ; les réponses de recette des écrans gardaient la date réelle et le test qui les compare à
  l'API échouait chaque lendemain (horodatages ramenés au jour de recette).
- Navigation : règles de la page de réglages en fonctions pures testées (`navigation-settings-rules.ts`) ; la page
  passe de 681 à 534 lignes.
- Styles : 42 déclarations toujours écrasées retirées des feuilles de composants, empreintes identiques (48 vues et
  12 vues du calendrier). `calendar/styles/_responsive.scss` et `_personalization.scss` ne sont chargées nulle part :
  les charger change le rendu du calendrier, elles sont gardées en attendant une décision.

## Intégration continue, durcissement, styles et écrans — 26 novembre 2026 (ancien §18 d’ARCHITECTURE.md)

### Intégration continue (`.github/workflows/ci.yml`)

À chaque PR et à chaque poussée sur `main`, deux tâches. Côté API, sur un service postgres:16 (`SOCLE_PG_URL`) :
`npm test` (les tests `sgbd` compris), `npm run api:check`, `npm run styles:audit`. Côté site : `ng test` et le build
de production.

### Durcissement du serveur (`api/src/http.mjs`, `server.mjs`)

- Corps de requête limité à `SOCLE_BODY_LIMIT` octets (1 Mo par défaut), refusé en `413 PAYLOAD_TOO_LARGE`, que la
  taille soit annoncée ou non.
- En-têtes sur chaque réponse : `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Cross-Origin-Resource-Policy: same-origin`, CSP `default-src 'none'; frame-ancestors 'none'`.
- Adresse d'écoute `SOCLE_HOST` : le poste seul (`localhost`) en mode local, toutes les interfaces en connexion exigée.
- Vérifié par `api/test/http-hardening.test.mjs`.

### Styles : règles mortes retirées, audit strict

Environ 4 400 lignes retirées : ce sont des sélecteurs, et des entrées de listes `:is()`, qui ne nommaient que des
classes jamais écrites dans le code. Les classes sous `:not()` sont gardées, parce qu'elles portent du poids. Une liste
`:is()` raccourcie garde la spécificité de la liste d'origine : sa spécificité est celle de sa plus lourde entrée.
Les styles calculés sont identiques, élément par élément, sur 48 vues en 1440 et 375 px
(`e2e/style-fingerprint.mjs save|compare`).

`scripts/styles-audit.mjs` est maintenant strict. Une classe n'y est vivante que si elle apparaît au mot près dans le
code, ou si elle commence par un préfixe construit (`'x-' +`, `${`, `{{`). L'audit échoue sur toute classe morte et
sur toute déclaration toujours écrasée.

### Écrans

- Clôture : les chiffres clés des sections passent dans `bpm/life/closing-boxes.ts`, des fonctions pures testées
  seules. `closing.page.ts` passe de 600 à 443 lignes.
- Projet et calendrier : `project-write-flow.ts`, `project-focus.ts`, `project-task-funding.ts` et `calendar-peeks.ts`
  sont sortis des écrans.
- Le parcours de clôture rejoint les réponses de recette (`npm run fixtures:web`). `closing.contract.spec.ts` teste
  l'écran sur la vraie réponse de l'API.
