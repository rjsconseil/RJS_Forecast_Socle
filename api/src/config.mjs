// Configuration du site : `api/data/site.env` (hors du dépôt, à côté des données), lignes `CLÉ=valeur`, lue au
// démarrage de l'API. Une variable d'environnement déjà posée l'emporte sur le fichier. Clés utiles :
//   SOCLE_DATA_ENGINE=sqlite|sgbd   SOCLE_PG_URL=postgres://…   SOCLE_AUTH=local|required   SOCLE_AUTH_SECRET=…
import { existsSync, readFileSync } from 'node:fs';

export const SITE_CONFIG = new URL('../data/site.env', import.meta.url).pathname;

export function loadSiteConfig(file = SITE_CONFIG) {
  if (!existsSync(file)) return {};
  const values = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    values[m[1]] = m[2];
    process.env[m[1]] ??= m[2];
  }
  return values;
}
