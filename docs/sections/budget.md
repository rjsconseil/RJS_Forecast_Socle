# Mon budget : fiche de section

> Statut : squelette de l’application autonome posé le 28/11/2026 (vision et entrée ; sortie à définir). Gabarit : [`_gabarit.md`](_gabarit.md).

## 1. Pour qui, pour quoi
Gestion (« management ») du patrimoine disponible : investissements en bourse ou sur des projets à but de rendement. La sortie de l’application reste à définir selon les fonctions qui seront demandées.
## 2. Ce que la section prend au socle
**Entrée de l’application** (`web/src/app/sections/budget/fonctionnalites/entree.ts`) : Le patrimoine disponible = patrimoine constitué (`Api.patrimoine()` : stock d’ouverture + capitalisations) − engagements futurs.
## 3. Fonctionnalités propres à la section
## 4. Liens avec les autres sections
## 5. Fondations pour le socle
**Repérée** : Engagements futurs sur le patrimoine (projets financés par le patrimoine, dépenses futures prévues) exposés par le grand noyau, ou directement le « patrimoine disponible » (métrique `bpm.patrimoineDisponible`). Sans elle, le disponible reste inconnu. Intéresse aussi Patrimoine.
## 6. Écrans
Espace propre `/mon-budget` : accueil (vision, entrée, sortie à définir). Pas encore de page dans BPM-Astra.
## 7. Recette et tests
## 8. Journal de développement et de débogage
