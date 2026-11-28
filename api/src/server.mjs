// API du socle : un serveur HTTP autour de la couche HTTP (http.mjs). Aucune règle métier ici.
//   SOCLE_AUTH=local|required    connexion exigée ou non (local par défaut, sur le poste de travail)
//   SOCLE_DATA_ENGINE=sqlite|sgbd moteur de stockage (sqlite par défaut)
//   SOCLE_HOST                    adresse d'écoute : le poste seul (localhost) par défaut en mode local, toutes les
//                                 interfaces (0.0.0.0) en connexion exigée ; à fixer derrière un proxy
//   SOCLE_BODY_LIMIT              taille maximale d'un corps de requête, en octets (1 Mo par défaut)
//   SOCLE_ALLOWED_HOSTS / SOCLE_ALLOWED_ORIGINS  domaine(s) du site en ligne (voir http.mjs, docs/DEPLOIEMENT.md)
//   SOCLE_TRUST_PROXY=1           derrière un proxy d'hébergement : l'adresse du client est lue dans X-Forwarded-For
// Arrêt propre (SIGTERM, SIGINT) : plus de nouvelle requête, celles en cours se terminent, puis la base est fermée.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createSocle } from './socle/index.mjs';
import { SOCLE_MODULES } from './modules/index.mjs';
import { createHttpHandler } from './http.mjs';
import { loadSiteConfig, SITE_CONFIG } from './config.mjs';

// Configuration du site (api/data/site.env), lue avant tout le reste ; l'environnement l'emporte.
const siteConfig = loadSiteConfig();

// Garde-fou : la réinitialisation de recette efface toutes les données. Elle est refusée quand la base vient de la
// configuration du site (api/data/site.env) : un test lancé dans le dossier du site réel ne doit jamais l'effacer.
// Un lanceur de tests pose lui-même son moteur et sa base temporaire (SOCLE_DATA_ENGINE=sqlite + J1_DATA_FILE).
if (process.env.J1_ENABLE_RECETTE_RESET === '1' && (siteConfig.SOCLE_DATA_ENGINE || siteConfig.SOCLE_PG_URL) && process.env.SOCLE_DATA_ENGINE === siteConfig.SOCLE_DATA_ENGINE) {
  console.error(`\n✖ Réinitialisation de recette refusée : la base vient de ${SITE_CONFIG} (base du site réel).\n  Lancez les tests et les jeux d'essai avec SOCLE_DATA_ENGINE=sqlite et un J1_DATA_FILE temporaire.\n`);
  process.exit(1);
}

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
const HOST = process.env.SOCLE_HOST || (authMode === 'required' ? '0.0.0.0' : 'localhost');
const server = createServer(createHttpHandler(socle, { dataFile: DATA_FILE, authMode }));
const engineId = socle.store.engine.constructor.id;
const where = engineId === 'sgbd' ? 'base PostgreSQL (SOCLE_PG_URL)' : DATA_FILE;
server.listen(PORT, HOST, () => {
  console.log(`RJS Forecast — socle sur http://${HOST}:${PORT} (données : ${where}, partitions par user, connexion : ${authMode}, moteur : ${engineId}${Object.keys(siteConfig).length ? `, configuration : ${SITE_CONFIG}` : ''})`);
  console.log(`Modules : ${socle.registry.describe().map((m) => `${m.id}(N${m.level})`).join(', ')}`);
});

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`Arrêt demandé (${signal}) : fin des requêtes en cours, puis fermeture de la base.`);
  const force = setTimeout(() => process.exit(1), 10000);
  force.unref();
  // Les flux de changements (SSE) ne se terminent jamais d'eux-mêmes : fermés au bout de 2 s.
  server.closeIdleConnections?.();
  server.close(async () => {
    await socle.close();
    process.exit(0);
  });
  setTimeout(() => server.closeAllConnections?.(), 2000).unref();
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
