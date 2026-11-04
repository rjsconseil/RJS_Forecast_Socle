# Données du site de référence RJS Forecast

Dossier d'accueil des fichiers `site/data/*.json` du site de référence
([`rjsconseil/rjs-forecast`](https://github.com/rjsconseil/rjs-forecast)), source par défaut de l'import :
`utilisateurs.json`, `workspace.json`, `budget-management.json`, `budget-patrimoine-management.json`,
`patrimoine-management.json`, `patrimoine-budget-ledger.json`, `entreprise-pilotage.json`, `configuration.json`.

**Ces fichiers ne sont pas versionnés** (`.gitignore`) : le dépôt du socle est public, celui de la référence est
privé, et ses données (utilisateurs, projets, opérations) restent sur le poste. Les sauvegardes et journaux de la
référence (`site/data/backups`, `site/data/logs`) ne sont pas utiles à l'import.

Import, l'API arrêtée (un seul écrivain) :

```bash
npm run import:rjs-forecast -- --remplacer
```

Sans `--source`, l'import lit ce dossier s'il contient les huit fichiers, sinon le site de référence voisin du
socle (`../RJS_Forecast/site/data`, données vivantes du poste). Ailleurs :

```bash
npm run import:rjs-forecast -- --remplacer --source <dossier du site de référence>/site/data
```

- `--remplacer` : repart d'un stockage ne contenant que les données de la référence (l'ancien stockage est
  sauvegardé à côté, `api/data/store.before-rjs-forecast-<date>.json`) ;
- sans `--remplacer` : les données sont ajoutées au stockage existant (refusé s'il contient déjà un import) ;
- `--source <dossier>` : le dossier `site/data` à importer (chemin relatif au dossier du socle) ;
- si aucune source n'est complète, ou si l'API est lancée sur le stockage, l'import est refusé sans rien écrire.

Ce qui n'a pas d'équivalent dans le socle (idées non décidées, actifs et allocations du patrimoine, versements
entre entités, factures…) est conservé tel quel dans `api/data/imports/rjs-forecast/hors-contrat.json` ; le rapport
complet est dans `rapport.json`.
