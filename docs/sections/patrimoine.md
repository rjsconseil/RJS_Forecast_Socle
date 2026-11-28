# Patrimoine : fiche de section

> Statut : squelette de l’application autonome posé le 28/11/2026 (vision et entrée ; sortie à définir). Gabarit : [`_gabarit.md`](_gabarit.md).

## 1. Pour qui, pour quoi
Planifier son patrimoine sur des projets de vie à portée patrimoniale : apport pour un achat immobilier, budget d’une période de retraite… La sortie de l’application reste à définir selon les fonctions qui seront demandées.
## 2. Ce que la section prend au socle
**Entrée de l’application** (`web/src/app/sections/patrimoine/fonctionnalites/entree.ts`) : Le patrimoine constitué et son objectif (`Api.patrimoine()`), et les projets de la vie (`Api.projects()`, sans le projet racine).
## 3. Fonctionnalités propres à la section
## 4. Liens avec les autres sections
## 5. Fondations pour le socle
**Repérée** : Rattachement d’un objectif daté (montant, échéance) à un projet de la vie, lisible par le grand noyau (aujourd’hui les objectifs datés vivent dans BPM). Intéresse aussi Mon budget et Mes projets.
## 6. Écrans
Espace propre `/mon-patrimoine` : accueil (vision, entrée, sortie à définir). Pas encore de page dans BPM-Astra.
## 7. Recette et tests
## 8. Journal de développement et de débogage
