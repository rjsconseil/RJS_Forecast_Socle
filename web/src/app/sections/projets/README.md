# Section « Mes projets » — fonctions propres à la section

Le socle est volontairement réduit à des fonctionnalités transverses et simples, prêtes à l'emploi pour les cinq
sections. Tout ce qui va au-delà (gestion de projet avancée, semi-professionnelle ou professionnelle) vit **dans ce
dossier**, en s'appuyant sur le socle sans le modifier : lectures du noyau `/api/projects`, `/api/tasks` et ses
commandes, financement inchangé. Les données propres à la section iront dans des tables `MP_`.

Un ajout au socle ne se fait que pour un besoin vraiment transverse et simple ; il est alors disponible aux cinq
sections et documenté dans `docs/socle/`. La fiche de la section est `docs/sections/projets.md`.

## Rangement : une zone de fonctionnalités, une application

| Dossier | Couche | Contenu | Peut importer |
|---|---|---|---|
| `fonctions/` | **Zone de fonctionnalités Mes projets** | Calculs et règles propres à la section, sans écran | le socle (`core/`, `platform/`, `shared/`) et d'autres zones |
| `application/` | **Application autonome Mes projets** | Écrans (page Pilotage…) | sa zone, le socle, les gestes communs de `bpm/ui`, les adresses de `astra/astra-parts` |

Une application hybride (par exemple Mes projets et Mon budget réunis) appellera les fonctions de `fonctions/` sans
passer par `application/`. Un test de l'API (`application-isolation.test.mjs`) vérifie qu'une zone ne contient aucun
écran et n'importe aucune application. Aucune autre section n'importe ce dossier, hors zones de fonctionnalités.

| Fichier | Rôle |
|---|---|
| `fonctions/portfolio.ts` | Portefeuille des projets, santé, tableau des tâches, planning (calculs purs) |
| `application/pilotage.page.ts` | Page « Pilotage » : vues Portefeuille, Tableau, Planning |
