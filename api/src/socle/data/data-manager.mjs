// P5 · Données gérées — couche de GESTION. Le DataManager est le seul interlocuteur du socle pour les
// données : il tient le catalogue des schémas, l'état logique publié (gelé, P2), les transactions en série
// et la révision. Il ne sait pas comment les données sont stockées : il délègue à un moteur de stockage
// choisi par configuration (`sqlite` en service, `sgbd` PostgreSQL déclaré). Les fichiers JSON ne sont plus un moteur :
// le moteur SQLite les reprend une fois, au premier démarrage, puis les range dans les archives.
import { rm, unlink, writeFile } from 'node:fs/promises';
import { DomainError } from '../errors.mjs';
import { buildCatalog, SYSTEM_COLLECTIONS } from './schemas.mjs';
import { JsonFilesEngine } from './engines/json-files.mjs';
import { readSqliteState, sqlitePathOf, SqliteEngine } from './engines/sqlite.mjs';
import { SgbdEngine } from './engines/sgbd.mjs';

export const STORE_SCHEMA = 'socle-store/0.6';
/** Schémas antérieurs acceptés : ils sont migrés explicitement par les migrations déclarées des modules. */
export const LEGACY_SCHEMAS = ['j1-store/0.2', 'socle-store/0.3', 'socle-store/0.4', 'socle-store/0.5'];

/** Les moteurs de stockage connus ; `coded: false` = contrat posé, implémentation à venir. */
export const DATA_ENGINES = { [SqliteEngine.id]: SqliteEngine, [SgbdEngine.id]: SgbdEngine };
export const DEFAULT_DATA_ENGINE = SqliteEngine.id;

export function emptyState(collections) {
  const state = { schemaVersion: STORE_SCHEMA, revision: 0, updatedAt: null, journal: [], migrations: [] };
  for (const c of [...collections, ...SYSTEM_COLLECTIONS]) state[c] = {};
  return state;
}

/** Ajoute les collections manquantes : un module nouvellement intégré démarre vide. Ne change pas le schéma. */
function withCollections(state, collections) {
  for (const c of [...collections, ...SYSTEM_COLLECTIONS]) state[c] ??= {};
  state.journal ??= [];
  state.migrations ??= [];
  return state;
}

/** P2 : l'état publié est gelé en profondeur — aucune écriture hors transaction n'est possible. */
export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key in value) deepFreeze(value[key]);
  }
  return value;
}

/** Brouillons paresseux : la copie d'une collection n'est faite qu'au premier accès (copie à la demande). */
const TOUCHED = new WeakMap();

/** Une collection de ce brouillon a-t-elle pu changer ? Faux seulement si la transaction ne l'a jamais lue ni écrite. */
export const touchedIn = (draft, key) => !TOUCHED.has(draft) || TOUCHED.get(draft).has(key);

function lazyDraft(state) {
  const draft = {};
  const touched = new Set();
  TOUCHED.set(draft, touched);
  for (const key of Object.keys(state)) {
    const value = state[key];
    if (value === null || typeof value !== 'object') { draft[key] = value; continue; }
    let copy;
    Object.defineProperty(draft, key, {
      enumerable: true,
      configurable: true,
      get() { if (!touched.has(key)) { touched.add(key); copy = structuredClone(value); } return copy; },
      set(next) { touched.add(key); copy = next; },
    });
  }
  return draft;
}

/** Fige le brouillon en objet ordinaire : les collections non touchées reprennent l'objet publié (même référence). */
function settle(draft, state) {
  const touched = TOUCHED.get(draft);
  for (const key of Object.keys(draft)) {
    const desc = Object.getOwnPropertyDescriptor(draft, key);
    if (!desc.get) continue;
    const value = touched.has(key) ? draft[key] : state[key];
    Object.defineProperty(draft, key, { value, enumerable: true, configurable: true, writable: true });
  }
  return draft;
}

export class DataManager {
  constructor({ path, registry, engine = DEFAULT_DATA_ENGINE }) {
    const Engine = DATA_ENGINES[engine];
    if (!Engine) throw new DomainError('DATA_ENGINE_UNAVAILABLE', `Moteur de stockage inconnu : ${engine}.`, { principle: 'P5', engine, known: Object.keys(DATA_ENGINES) });
    this.path = path;
    this.catalog = buildCatalog(registry);
    this.collections = this.catalog.collections;
    this.engine = new Engine({ path });
    this.state = null;
    this.queue = Promise.resolve();
    this.closed = false;
  }

  async load() {
    await this.engine.open();
    try {
      const stored = await this.engine.read();
      if (stored && stored.schemaVersion !== STORE_SCHEMA && !LEGACY_SCHEMAS.includes(stored.schemaVersion)) {
        throw new Error(`Schéma de persistance inattendu : ${stored.schemaVersion}`);
      }
      this.state = deepFreeze(stored ? withCollections(stored, this.collections) : emptyState(this.collections));
    } catch (err) {
      await this.close();
      throw err;
    }
    return this;
  }

  get legacySchema() {
    return this.state?.schemaVersion !== STORE_SCHEMA ? this.state?.schemaVersion : null;
  }

  /** Libère le stockage ; l'instance n'écrit plus. */
  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.queue.catch(() => {});
    await this.engine.close();
  }

  /**
   * Transaction : exécute une mutation en série. `fn(draft)` modifie la copie et renvoie `{ value }` ou
   * `{ unchanged: true, value }`. `beforeCommit` permet l'injection d'interruption. L'état publié n'est
   * jamais modifié en place : il est remplacé par la copie validée, puis gelé.
   */
  mutate(fn, { beforeCommit } = {}) {
    const run = async () => {
      if (this.closed) throw new DomainError('PERSISTENCE_UNAVAILABLE', 'Stockage fermé.');
      // Copie à la demande : seules les collections lues ou écrites par la transaction sont copiées.
      const draft = lazyDraft(this.state);
      const result = fn(draft);
      if (result?.unchanged) return result.value;
      settle(draft, this.state);
      draft.revision += 1;
      draft.updatedAt = new Date().toISOString();
      if (beforeCommit) beforeCommit(draft);
      await this.engine.assertUnchanged();
      try {
        await this.engine.write(draft, this.catalog);
      } catch (err) {
        if (err instanceof DomainError) throw err;
        throw new DomainError('PERSISTENCE_UNAVAILABLE', "L'enregistrement n'a pas pu être confirmé.", { cause: String(err.message) });
      }
      this.state = deepFreeze(draft);
      return result?.value;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  /** Le système de gestion vu de l'administration : moteur en service, moteurs possibles, schémas et volumes. */
  describe() {
    const count = (name) => { const v = this.state?.[name]; return Array.isArray(v) ? v.length : Object.keys(v ?? {}).length; };
    return {
      principle: 'P5',
      schemaVersion: this.state?.schemaVersion ?? null,
      revision: this.state?.revision ?? 0,
      engine: this.engine.describe(),
      engines: Object.values(DATA_ENGINES).map((E) => ({ id: E.id, label: E.label, coded: E.coded, active: E.id === this.engine.constructor.id })),
      spaces: this.catalog.spaces,
      schemas: this.catalog.schemas.map((schema) => ({
        name: schema.name, category: schema.category, module: schema.module, label: schema.label, space: schema.space,
        collections: [...schema.collections, ...schema.lists].map((name) => ({ name, objects: count(name) })),
      })),
    };
  }
}

// ---------- Outils d'administration (scripts, jamais les modules) ----------
/** L'état logique enregistré : la base SQLite, sinon un stockage JSON pas encore repris ou une copie d'un bloc ; `null` s'il n'existe pas. */
export async function readStoredState(path) {
  return readSqliteState(path) ?? new JsonFilesEngine({ path: path.endsWith('.sqlite') ? path.replace(/\.sqlite$/, '.json') : path }).read();
}
/** Copie d'un seul bloc de l'état enregistré : relisible telle quelle comme fichier principal (reprise d'un bloc). */
export async function snapshotStore(path, target) {
  const state = await readStoredState(path);
  if (!state) return null;
  await writeFile(target, JSON.stringify(state));
  return target;
}
/** Efface un stockage : la base (et ses fichiers de journalisation), un éventuel stockage JSON pas encore repris (les archives sont conservées). */
export async function removeStore(path) {
  const db = sqlitePathOf(path);
  for (const file of [db, db + '-wal', db + '-shm']) await unlink(file).catch((err) => { if (err.code !== 'ENOENT') throw err; });
  if (path.endsWith('.sqlite')) path = path.replace(/\.sqlite$/, '.json');
  await unlink(path).catch((err) => { if (err.code !== 'ENOENT') throw err; });
  await rm(path.replace(/\.json$/, '') + '.donnees', { recursive: true, force: true });
}
