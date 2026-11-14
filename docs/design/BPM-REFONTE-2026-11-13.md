# Refonte de l’interface BPM — 13 novembre 2026

## Résultat

Le module BPM utilise une présentation d’application homogène : navigation latérale discrète,
cartes claires, onglets soulignés, action principale visible et commandes complémentaires sous
« Actions et outils ». Le mode sombre utilise la même hiérarchie et les mêmes composants.

Le thème est limité aux espaces BPM et au calendrier budgétaire. Les règles de calcul,
les appels API, les données, les routes et les mécanismes de reprise des formulaires sont conservés.

## Organisation

- `web/src/styles/_bpm-application.scss` : identité de chaque section, navigation, en-têtes,
  périodes, commandes, cartes, tableaux, formulaires, fenêtres et calendrier. Cette feuille
  est chargée après les couches de présentation historiques dans `styles-rest.scss`.
- Les variables `--bpm-surface`, `--bpm-canvas`, `--bpm-text`, `--bpm-muted`, `--bpm-line`
  et `--bpm-link` portent les deux apparences. Les couleurs financières restent distinctes.
- Le tableau de bord montre les indicateurs avant les parcours d’aide lorsque des opérations
  existent. Les profils sans opération conservent les parcours ouverts au début.
- Les trois indicateurs du tableau de bord se répartissent en colonnes lorsque leur conteneur
  mesure au moins 740 px ; les dispositions plus étroites restent empilées.
- La vue d’ensemble commence par le budget et les projets, puis propose la reprise de l’activité.
- Sur mobile : onglets sur plusieurs lignes, commandes d’au moins 44 px, saisies de 16 px,
  en-têtes non collants et synthèse du calendrier sur deux colonnes.
- Les animations respectent la préférence de réduction des mouvements. Les contours de focus
  sont visibles sur les surfaces claires et sombres.

## Vérification

| Parcours | Vérification effectuée | Résultat |
| --- | --- | --- |
| Vue d’ensemble | En-tête, identité du profil, cartes budgétaires, accès aux espaces | Présentation lisible |
| Tableau de bord | Indicateurs, période, ouverture/fermeture des outils | Fonctionnel sur ordinateur et mobile |
| Registre | Recherche « navigo », URL filtrée, une ligne correspondante | Fonctionnel |
| Saisie d’opération | Ouverture du formulaire sur mobile et fermeture sans enregistrement | Fonctionnel |
| Plafonds | Synthèse, accès aux réglages, formulaires de poste et de catégorie | Présentation lisible |
| Projet de vie | Synthèse des volets, navigation de période et action prioritaire | Présentation lisible |
| Projets | Liste, accès à une fiche, navigation vers ses tâches | Fonctionnel |
| Calendrier | Mois suivant/précédent, synthèse des montants, accès à la grille | Fonctionnel ; chevauchement des montants corrigé |
| Objectifs | Liste des objectifs et accès à la projection | Fonctionnel |
| Apparence sombre | Projection patrimoniale, commandes et chiffres | Présentation lisible |

Les inspections ont été réalisées dans le navigateur intégré sur les données locales existantes,
sans enregistrer de modification financière. Le registre et les réglages de plafonds ont notamment
été contrôlés à une largeur CSS de 390 px, sans débordement horizontal du document.

Validation automatisée : compilation de production, 204 tests API et 287 tests frontend
(40 fichiers). Les scénarios Playwright du dépôt n’ont pas été exécutés dans cette passe ;
les interactions ci-dessus ont été vérifiées dans le navigateur intégré. Il ne s’agit pas
d’une certification d’accessibilité exhaustive ni d’une nouvelle validation des calculs financiers.
