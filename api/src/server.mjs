// API du socle : un serveur HTTP autour de la couche HTTP (http.mjs). Aucune règle métier ici.
//   SOCLE_AUTH=local|required    connexion exigée ou non (local par défaut, sur le poste de travail)
//   SOCLE_DATA_ENGINE=sqlite|sgbd moteur de stockage (sqlite par défaut)
//   SOCLE_HOST                    adresse d'écoute : le poste seul (localhost) par défaut en mode local, toutes les
//                                 interfaces (0.0.0.0) en connexion exigée ; à fixer derrière un proxy
//   SOCLE_BODY_LIMIT              taille maximale d'un corps de requête, en octets (1 Mo par défaut)
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createSocle } from './socle/index.mjs';
import { SOCLE_MODULES } from './modules/index.mjs';
import { createHttpHandler } from './http.mjs';

const PORT = Number(process.env.J1_API_PORT ?? 3410);
const DATA_FILE = resolve(process.env.J1_DATA_FILE ?? new URL('../data/store.sqlite', import.meta.url).pathname);

const socle = await createSocle({
  dataFile: DATA_FILE,
  modules: SOCLE_MODULES,
  faultInjection: process.env.J1_ENABLE_FAULT_INJECTION === '1',
});
socle.config = { dataFile: DATA_FILE, recetteReset: process.env.J1_ENABLE_RECETTE_RESET === '1', startedAt: new Date().toISOString() };

const authMode = process.env.SOCLE_AUTH || 'local';
const HOST = process.env.SOCLE_HOST || (authMode === 'required' ? '0.0.0.0' : 'localhost');
const server = createServer(createHttpHandler(socle, { dataFile: DATA_FILE, authMode }));
server.listen(PORT, HOST, () => {
  console.log(`RJS Forecast — socle sur http://${HOST}:${PORT} (données : ${DATA_FILE}, partitions par user, connexion : ${authMode})`);
  console.log(`Modules : ${socle.registry.describe().map((m) => `${m.id}(N${m.level})`).join(', ')}`);
});
