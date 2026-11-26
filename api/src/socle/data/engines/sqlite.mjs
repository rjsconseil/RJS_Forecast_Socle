// P5 · Données gérées — couche de STOCKAGE, moteur « sqlite » (SQLite intégré à Node), données PARTITIONNÉES PAR USER.
// Une base, un fichier (`<base>.sqlite`). Chaque collection est une table rangée par section du site (voir tables.mjs) :
// `id` clé de l'objet, `user_id` (sa partition), `revision` de la partition à sa dernière écriture, `data` (objet complet
// en JSON). Le journal (SY_journal) ne fait que s'allonger ; une partition n'en garde en mémoire que la fin.
//
// Partitions : chaque user est une partition (ses objets, son journal, sa révision dans SY_partitions) ; la partition
// système (clé '') porte les paramètres, les valeurs simples du socle et les objets sans user. Une écriture est une
// transaction qui ne touche que les partitions concernées et vérifie leur révision : si une autre instance a écrit
// entre-temps la même partition, l'écriture est refusée (PERSISTENCE_CONFLICT) et la couche de gestion la rejoue sur
// l'état relu. Plusieurs instances du serveur peuvent donc écrire la même base sans rien écraser (WAL).
//
// Reprise : au premier démarrage, si la base n'existe pas et qu'un stockage en fichiers JSON est là (`<base>.json`),
// il est copié dans une base neuve, relu et comparé objet par objet, puis rangé dans `<base>.archives/`.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { DomainError } from '../../errors.mjs';
import { acquireLock, releaseLock } from './lock.mjs';
import { JsonFilesEngine } from './json-files.mjs';
import { JOURNAL_WINDOW, partitionOf, q, SECTIONS, SYSTEM_PARTITION, tableOf } from './tables.mjs';

/** La base d'un stockage : `store.json` (nom historique) ou `store.sqlite` désignent `store.sqlite`. */
export const sqlitePathOf = (path) => (path.endsWith('.json') ? path.slice(0, -5) + '.sqlite' : path);
const jsonPathOf = (dbPath) => dbPath.replace(/\.sqlite$/, '') + '.json';
/** Valeurs simples gérées par partition, jamais rangées dans SY_store comme valeurs du socle. */
const PARTITION_SCALARS = new Set(['revision', 'updatedAt']);
const userParam = (key) => (key === SYSTEM_PARTITION ? null : key);

const BASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS SY_store (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS SY_tables (collection TEXT PRIMARY KEY, table_name TEXT NOT NULL UNIQUE, section TEXT NOT NULL, space TEXT);
  CREATE TABLE IF NOT EXISTS SY_journal (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, command TEXT, user_id TEXT, outcome TEXT,
    data TEXT NOT NULL CHECK (json_valid(data))
  );
  CREATE INDEX IF NOT EXISTS SY_journal_at ON SY_journal (at);
  CREATE INDEX IF NOT EXISTS SY_journal_user ON SY_journal (user_id, seq);
  CREATE TABLE IF NOT EXISTS SY_partitions (user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated_at TEXT, journal_from INTEGER NOT NULL DEFAULT 0);
`;

function connect(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
  db.exec(BASE_SCHEMA);
  return db;
}

const conflict = (message, details) => new DomainError('PERSISTENCE_CONFLICT', message, details);

/** Les tables connues de la base : collection → table. */
function tablesOf(db) {
  return new Map(db.prepare('SELECT collection, table_name FROM SY_tables ORDER BY rowid').all().map((t) => [t.collection, t.table_name]));
}

function ensureTable(db, tables, collection, space) {
  let table = tables.get(collection);
  if (table) return table;
  table = tableOf(collection);
  db.exec(`CREATE TABLE IF NOT EXISTS ${q(table)} (
    id TEXT PRIMARY KEY, user_id TEXT, revision INTEGER NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
    CREATE INDEX IF NOT EXISTS ${q(table + '_user')} ON ${q(table)} (user_id);`);
  db.prepare('INSERT INTO SY_tables (collection, table_name, section, space) VALUES (?, ?, ?, ?) ON CONFLICT(collection) DO NOTHING')
    .run(collection, table, table.slice(0, 2), space ?? null);
  tables.set(collection, table);
  return table;
}

/**
 * Passage d'une base « un seul écrivain » à une base partitionnée : la table des partitions est remplie une fois, chaque
 * partition partant de la dernière révision globale. Rien d'autre ne change : les objets portaient déjà leur user.
 */
function upgrade(db) {
  if (db.prepare('SELECT 1 FROM SY_partitions LIMIT 1').get()) return null;
  const row = db.prepare("SELECT value FROM SY_store WHERE key = 'revision'").get();
  if (!row) return null; // base neuve
  const revision = Number(JSON.parse(row.value)) || 0;
  const at = db.prepare("SELECT value FROM SY_store WHERE key = 'updatedAt'").get();
  const updatedAt = at ? JSON.parse(at.value) : null;
  const users = new Set();
  for (const table of tablesOf(db).values()) {
    for (const r of db.prepare(`SELECT DISTINCT user_id FROM ${q(table)} WHERE user_id IS NOT NULL`).all()) users.add(r.user_id);
  }
  // La révision globale passe à la partition système ; chaque partition de user repart de 0 (la vue complète garde la révision).
  const insert = db.prepare('INSERT INTO SY_partitions (user_id, revision, updated_at) VALUES (?, ?, ?)');
  db.exec('BEGIN IMMEDIATE');
  try {
    insert.run(SYSTEM_PARTITION, revision, updatedAt);
    for (const u of users) insert.run(u, 0, updatedAt);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* déjà close */ }
    throw err;
  }
  return { at: new Date().toISOString(), partitions: users.size + 1, fromRevision: revision };
}

/** Lecture d'une partition : ses objets, la fin de son journal, sa révision ; les valeurs du socle pour la partition système. */
function readPartition(db, key) {
  const rev = db.prepare('SELECT revision, updated_at, journal_from FROM SY_partitions WHERE user_id = ?').get(key);
  const user = userParam(key);
  const collections = {};
  for (const [collection, table] of tablesOf(db)) {
    const rows = db.prepare(`SELECT id, data FROM ${q(table)} WHERE user_id IS ? ORDER BY rowid`).all(user);
    const objects = {};
    for (const r of rows) objects[r.id] = JSON.parse(r.data);
    collections[collection] = objects;
  }
  const journal = db.prepare('SELECT data FROM (SELECT seq, data FROM SY_journal WHERE user_id IS ? AND seq > ? ORDER BY seq DESC LIMIT ?) ORDER BY seq')
    .all(user, rev?.journal_from ?? 0, JOURNAL_WINDOW).map((r) => JSON.parse(r.data));
  const scalars = {};
  if (key === SYSTEM_PARTITION) {
    for (const r of db.prepare('SELECT key, value FROM SY_store').all()) {
      if (r.key.startsWith('@') || PARTITION_SCALARS.has(r.key)) continue;
      scalars[r.key] = JSON.parse(r.value);
    }
  }
  return { key, revision: rev?.revision ?? null, updatedAt: rev?.updated_at ?? null, scalars, collections, journal };
}

/**
 * Écrit des changements de partitions en une transaction, tout ou rien. Chaque changement porte la révision attendue
 * (`expected`, `null` pour une partition nouvelle) : une partition écrite ailleurs entre-temps refuse l'ensemble.
 * Un objet nouveau ne remplace jamais un objet existant ; un objet modifié ne change jamais de partition.
 */
function commit(db, changes, catalog) {
  const tables = tablesOf(db);
  const statements = new Map();
  const prepared = (sql) => statements.get(sql) ?? statements.set(sql, db.prepare(sql)).get(sql);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const change of changes) {
      const user = userParam(change.key);
      if (change.expected === null) {
        const exists = prepared('SELECT revision FROM SY_partitions WHERE user_id = ?').get(change.key);
        if (exists) throw conflict('Une partition nouvelle existe déjà : écriture refusée.', { partition: change.key });
        prepared('INSERT INTO SY_partitions (user_id, revision, updated_at) VALUES (?, ?, ?)').run(change.key, change.revision, change.updatedAt);
      } else {
        const done = prepared('UPDATE SY_partitions SET revision = ?, updated_at = ? WHERE user_id = ? AND revision = ?')
          .run(change.revision, change.updatedAt, change.key, change.expected);
        if (Number(done.changes) !== 1) throw conflict('La partition a été modifiée par un autre écrivain : écriture refusée, rien n’est écrasé.', { partition: change.key });
      }
      for (const [k, value] of change.scalars ?? []) {
        if (value === undefined) prepared('DELETE FROM SY_store WHERE key = ?').run(k);
        else prepared('INSERT INTO SY_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, JSON.stringify(value));
      }
      for (const [collection, id, object, isNew] of change.upserts ?? []) {
        const table = ensureTable(db, tables, collection, catalog?.spaceOf?.(collection));
        const json = JSON.stringify(object);
        if (isNew) {
          const taken = prepared(`SELECT user_id FROM ${q(table)} WHERE id = ?`).get(id);
          if (taken) throw conflict(`L'identifiant ${id} existe déjà dans « ${collection} » : écriture refusée.`, { partition: change.key, collection, id });
          prepared(`INSERT INTO ${q(table)} (id, user_id, revision, data) VALUES (?, ?, ?, ?)`).run(id, user, change.revision, json);
        } else {
          const done = prepared(`UPDATE ${q(table)} SET revision = ?, data = ? WHERE id = ? AND user_id IS ?`).run(change.revision, json, id, user);
          if (Number(done.changes) !== 1) throw conflict(`L'objet ${id} a disparu ou changé de partition : écriture refusée.`, { partition: change.key, collection, id });
        }
      }
      for (const [collection, id] of change.deletes ?? []) {
        const table = tables.get(collection);
        if (table) prepared(`DELETE FROM ${q(table)} WHERE id = ? AND user_id IS ?`).run(id, user);
      }
      // Journal vidé (remise à zéro) : la vue de la partition repart de maintenant ; l'historique reste en base.
      if (change.journalReset) prepared('UPDATE SY_partitions SET journal_from = (SELECT COALESCE(MAX(seq), 0) FROM SY_journal) WHERE user_id = ?').run(change.key);
      const insert = prepared('INSERT INTO SY_journal (at, command, user_id, outcome, data) VALUES (?, ?, ?, ?, ?)');
      for (const entry of change.journal ?? []) insert.run(entry?.at ?? null, entry?.command ?? null, user, entry?.outcome ?? null, JSON.stringify(entry));
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* déjà close */ }
    if (err instanceof DomainError) throw err;
    if (/constraint/i.test(String(err.message))) throw conflict('Écriture refusée par la base (contrainte) : rien n’est écrasé.', { cause: String(err.message) });
    throw err;
  }
}

/** L'état complet (administration, reprise, vérifications) : valeurs du socle, tous les objets dans l'ordre d'écriture, fin du journal. */
function readAll(db) {
  const parts = db.prepare('SELECT user_id, revision, updated_at FROM SY_partitions').all();
  if (!parts.length) return null;
  const scalars = new Map(db.prepare('SELECT key, value FROM SY_store').all().map((r) => [r.key, JSON.parse(r.value)]));
  const state = { schemaVersion: scalars.get('schemaVersion') ?? null, revision: parts.reduce((n, p) => n + p.revision, 0), updatedAt: parts.map((p) => p.updated_at).filter(Boolean).sort().at(-1) ?? null };
  for (const [key, value] of scalars) {
    if (key.startsWith('@') || PARTITION_SCALARS.has(key) || key === 'schemaVersion') continue;
    state[key] = value;
  }
  state.journal = db.prepare(`SELECT data FROM (SELECT j.seq, j.data FROM SY_journal j JOIN SY_partitions p ON p.user_id = COALESCE(j.user_id, '')
    WHERE j.seq > p.journal_from ORDER BY j.seq DESC LIMIT ?) ORDER BY seq`).all(JOURNAL_WINDOW).map((r) => JSON.parse(r.data));
  for (const [collection, table] of tablesOf(db)) {
    const objects = {};
    for (const r of db.prepare(`SELECT id, data FROM ${q(table)} ORDER BY rowid`).all()) objects[r.id] = JSON.parse(r.data);
    state[collection] = objects;
  }
  return state;
}

/** Un état logique complet (reprise JSON) découpé en changements de partitions nouvelles. */
export function changesOfState(state) {
  const byKey = new Map();
  const at = state.updatedAt ?? new Date().toISOString();
  const partition = (key) => byKey.get(key) ?? byKey.set(key, { key, expected: null, revision: key === SYSTEM_PARTITION ? state.revision ?? 0 : 0, updatedAt: at, scalars: [], upserts: [], deletes: [], journal: [] }).get(key);
  partition(SYSTEM_PARTITION);
  for (const [key, value] of Object.entries(state)) {
    if (key === 'journal' || PARTITION_SCALARS.has(key)) continue;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) { partition(SYSTEM_PARTITION).scalars.push([key, value]); continue; }
    for (const [id, object] of Object.entries(value)) partition(partitionOf(object)).upserts.push([key, id, object, true]);
  }
  for (const entry of state.journal ?? []) partition(partitionOf(entry)).journal.push(entry);
  return [...byKey.values()];
}

export class SqliteEngine {
  static id = 'sqlite';
  static label = 'SQLite (une base, une table par collection préfixée par section, partitions par user)';
  static coded = true;
  /** Lectures synchrones : une partition absente du cache peut être lue à la demande. */
  static sync = true;

  constructor({ path }) {
    this.dbPath = sqlitePathOf(path);
    this.db = null;
    this.imported = null;
    this.upgraded = null;
  }

  get sync() { return true; }

  async open() {
    await mkdir(dirname(this.dbPath), { recursive: true });
    if (!existsSync(this.dbPath)) this.imported = await importJson(this.dbPath);
    this.db = connect(this.dbPath);
    this.upgraded = upgrade(this.db);
  }

  /** Version du schéma logique enregistrée ; `null` pour une base vide. */
  meta() {
    const row = this.db.prepare("SELECT value FROM SY_store WHERE key = 'schemaVersion'").get();
    const empty = !this.db.prepare('SELECT 1 FROM SY_partitions LIMIT 1').get();
    return { schemaVersion: row ? JSON.parse(row.value) : null, empty };
  }

  /** Révision de chaque partition demandée (absente = `null`). */
  revisions(keys) {
    const stmt = this.db.prepare('SELECT revision, updated_at FROM SY_partitions WHERE user_id = ?');
    return new Map(keys.map((key) => { const r = stmt.get(key); return [key, r ? { revision: r.revision, updatedAt: r.updated_at } : null]; }));
  }
  /** Toutes les partitions et leur révision (administration, vue complète). */
  allRevisions() {
    return new Map(this.db.prepare('SELECT user_id, revision, updated_at FROM SY_partitions ORDER BY rowid').all()
      .map((r) => [r.user_id, { revision: r.revision, updatedAt: r.updated_at }]));
  }
  readPartition(key) { return readPartition(this.db, key); }

  /** Un objet par sa clé, quelle que soit sa partition (reçus de création : unicité d'une clé de demande). */
  findObject(collection, id) {
    const table = tablesOf(this.db).get(collection);
    if (!table) return null;
    const row = this.db.prepare(`SELECT data FROM ${q(table)} WHERE id = ?`).get(id);
    return row ? JSON.parse(row.data) : null;
  }

  /** L'annuaire des users, sans charger leurs partitions. */
  directory() {
    const table = tablesOf(this.db).get('users');
    return table ? this.db.prepare(`SELECT data FROM ${q(table)} ORDER BY rowid`).all().map((r) => JSON.parse(r.data)) : [];
  }

  counts() {
    return Object.fromEntries([...tablesOf(this.db)].map(([collection, table]) => [collection, this.db.prepare(`SELECT COUNT(*) AS n FROM ${q(table)}`).get().n]));
  }

  commit(changes, catalog) { commit(this.db, changes, catalog); }

  /** Crée d'avance les tables des collections déclarées, dans l'ordre du catalogue. */
  ensureTables(collections, catalog) {
    const tables = tablesOf(this.db);
    for (const c of collections) ensureTable(this.db, tables, c, catalog?.spaceOf?.(c));
  }

  readAll() { return readAll(this.db); }

  async close() {
    if (this.db) {
      try { this.db.close(); } catch { /* déjà fermée */ }
      this.db = null;
    }
  }

  describe() {
    const tables = this.db ? Object.fromEntries(tablesOf(this.db)) : {};
    const partitions = this.db ? this.db.prepare("SELECT COUNT(*) AS n FROM SY_partitions WHERE user_id <> ''").get().n : 0;
    return {
      id: SqliteEngine.id, label: SqliteEngine.label, coded: true,
      file: basename(this.dbPath),
      partitions,
      sections: Object.fromEntries(Object.entries(SECTIONS).map(([prefix, s]) => [prefix, s.label])),
      files: { base: basename(this.dbPath), journal: 'SY_journal', partitions: 'SY_partitions', ...tables },
      ...(this.imported ? { importedFromJson: this.imported } : {}),
      ...(this.upgraded ? { partitionedAt: this.upgraded } : {}),
    };
  }
}

/** Lecture seule d'une base existante (outils d'administration) ; `null` si elle n'existe pas. */
export function readSqliteState(path) {
  const dbPath = sqlitePathOf(path);
  if (!existsSync(dbPath)) return null;
  const db = connect(dbPath);
  try {
    upgrade(db);
    return readAll(db);
  } finally {
    db.close();
  }
}

const sameObjects = (a = {}, b = {}) => {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((id) => JSON.stringify(a[id]) === JSON.stringify(b[id]));
};

/**
 * Reprise du stockage en fichiers JSON : copie dans une base neuve, relecture et comparaison de chaque clé de l'état,
 * puis la base prend sa place et les fichiers JSON sont rangés dans `<base>.archives/json-avant-sqlite-<date>/`.
 * Rien n'est effacé : en cas d'écart, la base neuve est abandonnée et les fichiers restent en place.
 */
async function importJson(dbPath) {
  const jsonPath = jsonPathOf(dbPath);
  if (!existsSync(jsonPath)) return null;
  const jsonLock = `${jsonPath}.lock`;
  const token = randomUUID();
  await acquireLock(jsonLock, token, jsonPath);
  const tmp = `${dbPath}.import-${token.slice(0, 8)}.tmp`;
  try {
    const source = new JsonFilesEngine({ path: jsonPath });
    const state = await source.read();
    if (!state) return null;
    const db = connect(tmp);
    try {
      commit(db, changesOfState(state), null);
      const back = readAll(db);
      for (const key of new Set([...Object.keys(state), ...Object.keys(back ?? {})])) {
        if (key === 'journal' || PARTITION_SCALARS.has(key)) continue;
        const a = state[key];
        const b = back?.[key];
        const same = a && typeof a === 'object' && !Array.isArray(a) ? sameObjects(a, b) : JSON.stringify(a) === JSON.stringify(b);
        if (!same) throw new DomainError('PERSISTENCE_UNAVAILABLE', `Reprise des fichiers JSON : « ${key} » relu différemment dans la base. Rien n'a été remplacé.`, { key });
      }
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      db.close();
    }
    await rename(tmp, dbPath);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = jsonPath.replace(/\.json$/, '');
    const target = join(`${base}.archives`, `json-avant-sqlite-${stamp}`);
    await mkdir(target, { recursive: true });
    await rename(jsonPath, join(target, basename(jsonPath)));
    if (existsSync(`${base}.donnees`)) await rename(`${base}.donnees`, join(target, basename(`${base}.donnees`)));
    for (const file of source.legacy?.files ?? []) await rename(join(dirname(jsonPath), file), join(target, basename(file))).catch(() => {});
    const count = (v) => (Array.isArray(v) ? v.length : Object.keys(v ?? {}).length);
    return { at: new Date().toISOString(), revision: state.revision, archive: target, objects: Object.values(state).filter((v) => v && typeof v === 'object').reduce((n, v) => n + count(v), 0) };
  } finally {
    for (const suffix of ['', '-wal', '-shm']) await unlink(tmp + suffix).catch(() => {});
    await releaseLock(jsonLock, token);
  }
}
