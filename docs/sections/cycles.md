# Cycles : fiche de section

> Statut : squelette de l’application autonome posé le 28/11/2026 (vision et entrée ; sortie à définir). Gabarit : [`_gabarit.md`](_gabarit.md).

## 1. Pour qui, pour quoi
Analyser les comportements financiers du quotidien pour améliorer le taux d’épargne à chaque cycle. La sortie de l’application reste à définir selon les fonctions qui seront demandées.
## 2. Ce que la section prend au socle
**Entrée de l’application** (`web/src/app/sections/cycles/fonctionnalites/entree.ts`) : Les cycles (`Api.metricPeriods()`) et, pour chacun, les mouvements réglés du budget de vie (`Api.budget(id)`) : reçu, dépensé, épargne, taux d’épargne.
## 3. Fonctionnalités propres à la section
## 4. Liens avec les autres sections
## 5. Fondations pour le socle
**Repérée** : Lecture des bilans figés des cycles clos (aujourd’hui servis à BPM seulement) : l’analyse reposerait sur les chiffres tels que clôturés. Intéresse aussi Mon quotidien.
## 6. Écrans
Espace propre `/mes-cycles` : accueil (vision, entrée, sortie à définir). Pas encore de page dans BPM-Astra.
## 7. Recette et tests
## 8. Journal de développement et de débogage
