# Mes projets : fiche de section

> Statut : **développement en cours** (première section à évoluer). Squelette à remplir selon [`_gabarit.md`](_gabarit.md) ; les points ci-dessous sont des repères, pas la documentation livrée.

## 1. Pour qui, pour quoi
Repère : un vrai outil de gestion de projet, utilisable seul par une personne habituée aux outils semi-professionnels ou professionnels, sans changer la place de la section dans BPM-Astra.

## 2. Ce que la section prend au socle
Repère : projets et tâches (objets du noyau), changement d'état d'une tâche, enveloppes et parts (venues de Mon budget), décisions de financement (Cycles), accueil de section et ouverture d'un fait à sa source.

## 3. Fonctionnalités propres à la section
Repère : page Pilotage, application autonome Mes projets, avec ses calculs dans les fonctionnalités Mes projets (portefeuille, tableau des tâches, planning). À venir dans la section : jalons, dépendances entre tâches, responsable, étiquettes, modèles de projet, charge.

## 4. Liens avec les autres sections
## 5. Fondations pour le socle
Repère : les fonctionnalités avancées (Pilotage, puis jalons, dépendances, responsable, étiquettes, modèles, charge) restent dans Mes projets. Leurs fondations de gestion de projet de base sont appelées à entrer au socle, utiles aux autres sections (Mon budget pour les investissements). Repérée, à décider : imputer une charge à un projet autrement que par ses tâches (aujourd'hui le budget et les dépenses d'un projet ne passent que par ses tâches). Aucune intégrée à ce jour.
## 6. Écrans
- **Application autonome Mes projets** (`/mes-projets`, hors de BPM-Astra ; lien dans Noyau transverse › Applications
  autonomes). Gestion de projet selon PRINCE2 :
  - un accueil qui fait l'état des projets et de leurs tâches, avec la séquence PRINCE2 et le dossier PRINCE2 de chaque projet ;
  - une page pour chacun des 7 thèmes : son but, ses processus associés et leurs livrables.
  Écran : `application/gestion-projet.page.*`. Calculs : `fonctionnalites/gestion.ts`, `prince2.ts` et `dossiers.ts`.
- **Registres PRINCE2**, un par thème, sur la page du thème, pour un projet qui a son dossier :
  - Cas d'affaire : les produits de management du projet ;
  - Organisation : les rôles ; Qualité : le registre qualité ;
  - Plans : les séquences, avec le bouton « Ouvrir la séquence » qui instancie son plan et ses rapports ;
  - Risque : le registre des risques ; Changement : le registre des incidences ; Progression : le journal.
  On y ajoute une ligne et on change son état sur place. Écran : `application/registre-projet.*`. Les champs et les choix
  viennent du modèle de données (`fonctionnalites/registres.ts`).
- **Pilotage** (`/bpm-astra/pilotage`), inchangé.

### Modèle de données (`application/donnees.json`, tables AA_MP_…)
- **Catalogue PRINCE2 standard**, en lecture seule et commun à tous : `refThemes`, `refProcessus`, `refActivites`,
  `refLivrables`, `refRoles`, `refPrincipes`, `refThemeProcessus`, `refProcessusLivrables` et `refReglesInstanciation`
  (version `prince2-2017-fr`).
- **Tables d'instanciation d'un projet en cours**, liées au projet du noyau par `projectId` : `dossiers` (un par
  projet), `roles`, `etapes` (séquences), `produits`, `livrables`, `risques`, `problemes` (incidences), `qualite` et
  `journalProjet`. Le nom `journal` est réservé par le socle.
- **Instanciation par règles**, sans correspondance une pour une avec le catalogue :
  - à la création du dossier : 4 rôles, la séquence d'initialisation et les 17 produits de management de SU et IP ;
  - à chaque ouverture de séquence : plan de séquence, rapport de fin de séquence et rapport de situation ;
  - à la clôture : les produits de CP.

## 7. Recette et tests
`npm run test:app -- projets` couvre les fonctionnalités, l'écran et la vérification que le catalogue de la base reprend le référentiel de l'écran.
## 8. Journal de développement et de débogage
| Date | Version / PR | Changement ou correction | Effet pour l'utilisateur |
|---|---|---|---|
| 27/11/2026 | PR « Mes projets PRINCE2 » | Application autonome à `/mes-projets` ; modèle de données AA_MP_ (catalogue PRINCE2 standard, tables d'instanciation, règles) ; dossier PRINCE2 par projet | Un outil de gestion de projet PRINCE2 dans l'interface habituelle, ouvert depuis le noyau, BPM-Astra inchangé |
| 28/11/2026 | PR « Registres PRINCE2 » | Un registre par thème (saisie, état modifiable, ouverture de séquence) | Les registres du projet se tiennent dans l'application, thème par thème |
| 28/11/2026 | PR « Style du socle et anglais » | Bandeau et onglets au style du socle, écrans, référentiel et catalogue PRINCE2 en anglais, mise en page sans vides | L'application ressemble au reste du site et parle la langue de PRINCE2 |
| 28/11/2026 | PR « Design propre » | Bandeau sarcelle, onglets soulignés, cartes, frises de séquence et de processus | L'application a sa propre allure, cousine du socle |
