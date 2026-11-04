# Styles de référence pour Codex

Les feuilles de `styles-source/` sont des copies exactes du commit documenté.
Leurs empreintes et leurs chemins GitHub sont dans `manifest-source.json`.
Les déclarations n’ont pas été réécrites. Tous les imports Sass locaux de ces
feuilles ont une source correspondante dans le dossier.

Lire les sections 16 et 17 du guide. Utiliser `correspondance-styles.json`.
Configurer le chemin Sass `src/styles` après adaptation de l’arborescence.
Les classes et attributs de portée doivent correspondre aux templates.
Conserver l’ordre de la cascade : valeurs, base, contrôles, pages, surcharges.

`reference-entree-globale.styles.scss.txt` montre l’ancienne entrée globale.
Elle importe Formation et d’autres domaines hors périmètre : ne pas l’importer
en bloc. Les feuilles originales restent des références ; retirer les sélecteurs
et variables inutiles après validation du rendu des écrans retenus.

Polices : Inter, IBM Plex Mono et Newsreader. Déclarations source dans `_fonts.scss`
et dépendances source dans `reference-code/site/apps/web/package.json`.
Fichiers binaires non inclus. Prévoir les paquets Fontsource et les chemins de build.
Les variables peuvent être surchargées par le mécanisme de design du socle.

Ce dossier n’est pas une application installable. Les styles n’ont pas été
compilés ici ; la recette visuelle et les tests navigateur se font sur le code reconstruit.
