// Reprise d'une base SQLite dans PostgreSQL (passage du poste de travail à un site en ligne). La base PostgreSQL doit
// être vide ; la base SQLite n'est que lue. Chaque partition garde ses objets, son journal récent et sa révision.
//   SOCLE_PG_URL=postgres://… node api/scripts/sqlite-to-pg.mjs [api/data/store.sqlite]
import { resolve } from 'node:path';
import { changesOfState, readSqliteState } from '../src/socle/data/engines/sqlite.mjs';
import { SgbdEngine } from '../src/socle/data/engines/sgbd.mjs';
import { buildCatalog } from '../src/socle/data/schemas.mjs';
import { Registry } from '../src/socle/registry.mjs';
import { SOCLE_MODULES } from '../src/modules/index.mjs';
import { SYSTEM_COLLECTIONS } from '../src/socle/data/schemas.mjs';

const source = resolve(process.argv[2] ?? new URL('../data/store.sqlite', import.meta.url).pathname);
const state = readSqliteState(source);
if (!state) throw new Error(`Aucune base SQLite à ${source}.`);
const registry = new Registry();
for (const m of SOCLE_MODULES) registry.register(m);
const catalog = buildCatalog(registry);
const engine = new SgbdEngine();
await engine.open();
try {
  if (!(await engine.meta()).empty) throw new Error('La base PostgreSQL n’est pas vide : reprise refusée, rien n’est écrit.');
  await engine.ensureTables([...SYSTEM_COLLECTIONS, ...catalog.collections], catalog);
  const changes = changesOfState(state);
  await engine.commit(changes, catalog);
  const objects = changes.reduce((n, c) => n + c.upserts.length, 0);
  console.log(`Reprise faite : ${changes.length} partitions, ${objects} objets, depuis ${source}.`);
} finally {
  await engine.close();
}
