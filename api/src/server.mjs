// API du socle : un serveur HTTP autour de la couche HTTP (http.mjs). Aucune règle métier ici.
//   SOCLE_AUTH=local|required    connexion exigée ou non (local par défaut, sur le poste de travail)
//   SOCLE_DATA_ENGINE=sqlite|sgbd moteur de stockage (sqlite par défaut)
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createSocle } from './socle/index.mjs';
import { SOCLE_MODULES } from './modules/index.mjs';
import { createHttpHandler } from './http.mjs';
import { loadSiteConfig, SITE_CONFIG } from './config.mjs';

// Configuration du site (api/data/site.env), lue avant tout le reste ; l'environnement l'emporte.
const siteConfig = loadSiteConfig();

const PORT = Number(process.env.J1_API_PORT ?? 3410);
const DATA_FILE = resolve(process.env.J1_DATA_FILE ?? new URL('../data/store.sqlite', import.meta.url).pathname);

const socle = await createSocle({
  dataFile: DATA_FILE,
  modules: SOCLE_MODULES,
  faultInjection: process.env.J1_ENABLE_FAULT_INJECTION === '1',
  dataEngine: process.env.SOCLE_DATA_ENGINE || undefined,
});
socle.config = { dataFile: DATA_FILE, recetteReset: process.env.J1_ENABLE_RECETTE_RESET === '1', startedAt: new Date().toISOString() };

const authMode = process.env.SOCLE_AUTH || 'local';
const server = createServer(createHttpHandler(socle, { dataFile: DATA_FILE, authMode }));
server.listen(PORT, () => {
  console.log(`RJS Forecast — socle sur http://localhost:${PORT} (données : ${DATA_FILE}, partitions par user, connexion : ${authMode}, moteur : ${socle.store.engine.constructor.id}${Object.keys(siteConfig).length ? `, configuration : ${SITE_CONFIG}` : ''})`);
  console.log(`Modules : ${socle.registry.describe().map((m) => `${m.id}(N${m.level})`).join(', ')}`);
});
