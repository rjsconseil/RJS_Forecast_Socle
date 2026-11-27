# Section « Mes projets » — fonctions propres à la section

Le socle est volontairement réduit à des fonctionnalités transverses et simples, prêtes à l'emploi pour les cinq
sections. Tout ce qui va au-delà (gestion de projet avancée, semi-professionnelle ou professionnelle) vit **dans ce
dossier**, en s'appuyant sur le socle sans le modifier : lectures du noyau `/api/projects`, `/api/tasks` et ses
commandes, financement inchangé. Les données propres à la section iront dans des tables `MP_`.

Un ajout au socle ne se fait que pour un besoin vraiment transverse et simple ; il est alors disponible aux cinq
sections et documenté dans `docs/socle/`. La fiche de la section est `docs/sections/projets.md`.

Règle de rangement : ce dossier n'importe que `core/` (clients et modèles), `platform/` (éléments communs des
sections), `shared/`, les gestes communs de `bpm/ui` et les adresses du cadre qui l'accueille (`astra/astra-parts`). Aucune autre section n'importe ce dossier.

| Fichier | Rôle |
|---|---|
| `portfolio.ts` | Calculs purs : portefeuille des projets, santé, tableau des tâches, planning |
| `pilotage.page.ts` | Page « Pilotage » : accueil autonome de la section, vues Portefeuille, Tableau, Planning |
