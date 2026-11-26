// P5 · Données gérées — couche de STOCKAGE, moteur « sqlite » (le moteur en service, SQLite intégré à Node).
// Une base, un fichier (`<base>.sqlite`). Les tables sont rangées à l'image des cinq sections du site, par préfixe :
//   MQ_ Mon quotidien · MP_ Mes projets · MB_ Mon budget · PT_ Patrimoine · CL_ Cycles · SY_ système (socle).
// Chaque collection est une table (`id` clé de l'objet, `user_id`, `revision` de la dernière écriture, `data` JSON
// complet de l'objet) ; l'ordre d'insertion est celui de l'état logique. Le journal est une table où l'on ne fait
// qu'ajouter (SY_journal) : il garde toute l'histoire, l'état logique n'en lit que la fin qu'il porte.
// Une écriture est une transaction : seuls les objets créés, modifiés ou supprimés sont écrits ; tout ou rien.
//
// Garantie d'écriture (C11) : un seul écrivain (verrou `<base>.sqlite.lock`) ; avant chaque écriture, la révision
// enregistrée est comparée à la dernière connue : modifiée ailleurs → PERSISTENCE_CONFLICT, rien n'est écrasé.
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

/** Sections du site et collections qu'elles portent ; une collection hors de ces sections va dans le système (SY_). */
export const SECTIONS = {
  MQ: { label: 'Mon quotidien', collections: ['operations', 'imports', 'calendarPreferences'] },
  MP: { label: 'Mes projets', collections: ['coreProjects', 'tasks', 'projectOverruns', 'taskBudgetRequests'] },
  MB: { label: 'Mon budget', collections: ['budgets', 'recurrences', 'costCenters', 'chargeCategories'] },
  PT: { label: 'Patrimoine', collections: ['patrimoines', 'capitalizations', 'lifeGoals'] },
  CL: { label: 'Cycles', collections: ['cycleLinks', 'closures', 'bpmCompositions'] },
  SY: { label: 'Système', collections: ['users', 'parameters', 'creationRequests'] },
};
const SECTION_OF = new Map(Object.entries(SECTIONS).flatMap(([prefix, s]) => s.collections.map((c) => [c, prefix])));
const snake = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
/** Table d'une collection : préfixe de sa section, puis son nom (« taskBudgetRequests » → « MP_task_budget_requests »). */
export const tableOf = (collection) => `${SECTION_OF.get(collection) ?? 'SY'}_${snake(collection)}`;
const q = (name) => `"${String(name).replace(/"/g, '""')}"`;

/** La base d'un stockage : `store.json` (nom historique) ou `store.sqlite` désignent `store.sqlite`. */
export const sqlitePathOf = (path) => (path.endsWith('.json') ? path.slice(0, -5) + '.sqlite' : path);
const jsonPathOf = (dbPath) => dbPath.replace(/\.sqlite$/, '') + '.json';

const BASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS SY_store (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS SY_tables (collection TEXT PRIMARY KEY, table_name TEXT NOT NULL UNIQUE, section TEXT NOT NULL, space TEXT);
  CREATE TABLE IF NOT EXISTS SY_journal (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, command TEXT, user_id TEXT, outcome TEXT,
    data TEXT NOT NULL CHECK (json_valid(data))
  );
  CREATE INDEX IF NOT EXISTS SY_journal_at ON SY_journal (at);
  CREATE INDEX IF NOT EXISTS SY_journal_user ON SY_journal (user_id);
`;

function connect(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
  db.exec(BASE_SCHEMA);
  return db;
}

/** Méta-informations du moteur, rangées à part de l'état logique dans SY_store. */
const META_JOURNAL = '@journalShown';
/** Ordre des clés de l'état logique, rendu tel quel à la lecture. */
const META_ORDER = '@order';

function emptyKnown() {
  return { revision: null, order: null, scalars: new Map(), journal: { ref: undefined, last: null, shown: 0 }, collections: new Map() };
}

/** Lit l'état logique et ce que le moteur en sait (contenu écrit de chaque objet) ; `null` pour une base vide. */
function readState(db) {
  const rows = db.prepare('SELECT key, value FROM SY_store').all();
  if (!rows.some((r) => r.key === 'revision')) return null;
  const state = {};
  const known = emptyKnown();
  let shown = 0;
  let order = [];
  for (const r of rows) {
    if (r.key === META_JOURNAL) { shown = Number(JSON.parse(r.value)) || 0; continue; }
    if (r.key === META_ORDER) { order = JSON.parse(r.value); known.order = r.value; continue; }
    state[r.key] = JSON.parse(r.value);
    known.scalars.set(r.key, r.value);
  }
  const tail = db.prepare('SELECT data FROM (SELECT seq, data FROM SY_journal ORDER BY seq DESC LIMIT ?) ORDER BY seq').all(shown);
  state.journal = tail.map((r) => JSON.parse(r.data));
  known.journal = { ref: state.journal, last: tail.length ? tail.at(-1).data : null, shown };
  for (const t of db.prepare('SELECT collection, table_name FROM SY_tables ORDER BY rowid').all()) {
    const objects = {};
    const contents = new Map();
    for (const r of db.prepare(`SELECT id, data FROM ${q(t.table_name)} ORDER BY rowid`).all()) {
      objects[r.id] = JSON.parse(r.data);
      contents.set(r.id, r.data);
    }
    state[t.collection] = objects;
    known.collections.set(t.collection, { table: t.table_name, ref: objects, rows: contents });
  }
  known.revision = state.revision ?? null;
  const ordered = {};
  for (const key of [...order, ...Object.keys(state)]) if (key in state && !(key in ordered)) ordered[key] = state[key];
  // Un état enregistré sans journal (très anciens stockages) se relit sans journal.
  if (order.length && !order.includes('journal')) delete ordered.journal;
  return { state: ordered, known };
}

/** Écrit l'état en une transaction : seuls les objets qui diffèrent de ce qui est connu sont écrits. Rend le nouveau connu. */
function writeState(db, state, known, catalog) {
  const statements = new Map();
  const prepared = (sql) => statements.get(sql) ?? statements.set(sql, db.prepare(sql)).get(sql);
  const next = emptyKnown();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [key, value] of Object.entries(state)) {
      if (key === 'journal') continue;
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        const json = JSON.stringify(value);
        if (known.scalars.get(key) !== json) prepared('INSERT INTO SY_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, json);
        next.scalars.set(key, json);
        continue;
      }
      let current = known.collections.get(key);
      if (current?.ref === value) { next.collections.set(key, current); continue; }
      if (!current) {
        const table = tableOf(key);
        db.exec(`CREATE TABLE IF NOT EXISTS ${q(table)} (
          id TEXT PRIMARY KEY, user_id TEXT, revision INTEGER NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
          CREATE INDEX IF NOT EXISTS ${q(table + '_user')} ON ${q(table)} (user_id);`);
        prepared('INSERT INTO SY_tables (collection, table_name, section, space) VALUES (?, ?, ?, ?) ON CONFLICT(collection) DO NOTHING')
          .run(key, table, table.slice(0, 2), catalog?.spaceOf?.(key) ?? null);
        current = { table, ref: undefined, rows: new Map() };
      }
      const upsert = prepared(`INSERT INTO ${q(current.table)} (id, user_id, revision, data) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, revision = excluded.revision, data = excluded.data`);
      const remove = prepared(`DELETE FROM ${q(current.table)} WHERE id = ?`);
      const rows = new Map();
      for (const [id, object] of Object.entries(value)) {
        const json = JSON.stringify(object);
        rows.set(id, json);
        if (current.rows.get(id) !== json) upsert.run(id, typeof object?.userId === 'string' ? object.userId : null, state.revision ?? 0, json);
      }
      for (const id of current.rows.keys()) if (!rows.has(id)) remove.run(id);
      next.collections.set(key, { table: current.table, ref: value, rows });
    }
    for (const key of known.scalars.keys()) if (!next.scalars.has(key)) prepared('DELETE FROM SY_store WHERE key = ?').run(key);
    for (const [key, c] of known.collections) if (!next.collections.has(key)) next.collections.set(key, c);

    // Journal : seules les entrées nouvelles sont ajoutées ; rien n'est jamais effacé de la table.
    const list = Array.isArray(state.journal) ? state.journal : [];
    if (list === known.journal.ref) {
      next.journal = known.journal;
    } else {
      let start = 0;
      if (known.journal.last !== null) {
        let i = list.length - 1;
        while (i >= 0 && JSON.stringify(list[i]) !== known.journal.last) i--;
        start = i + 1;
      }
      const insert = prepared('INSERT INTO SY_journal (at, command, user_id, outcome, data) VALUES (?, ?, ?, ?, ?)');
      for (const entry of list.slice(start)) {
        insert.run(entry?.at ?? null, entry?.command ?? null, entry?.userId ?? null, entry?.outcome ?? null, JSON.stringify(entry));
      }
      if (known.journal.shown !== list.length) prepared('INSERT INTO SY_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(META_JOURNAL, String(list.length));
      next.journal = { ref: list, last: list.length ? JSON.stringify(list.at(-1)) : known.journal.last, shown: list.length };
    }
    const order = JSON.stringify(Object.keys(state));
    if (known.order !== order) prepared('INSERT INTO SY_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(META_ORDER, order);
    next.order = order;
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* transaction déjà close */ }
    throw err;
  }
  next.revision = state.revision ?? null;
  return next;
}

export class SqliteEngine {
  static id = 'sqlite';
  static label = 'SQLite (une base, une table par collection, préfixée par section du site)';
  static coded = true;

  constructor({ path }) {
    this.dbPath = sqlitePathOf(path);
    this.lockPath = `${this.dbPath}.lock`;
    this.token = randomUUID();
    this.db = null;
    this.known = emptyKnown();
    this.imported = null;
  }

  async open() {
    await mkdir(dirname(this.dbPath), { recursive: true });
    await acquireLock(this.lockPath, this.token, this.dbPath);
    try {
      if (!existsSync(this.dbPath)) this.imported = await importJson(this.dbPath);
      this.db = connect(this.dbPath);
    } catch (err) {
      await releaseLock(this.lockPath, this.token);
      throw err;
    }
  }

  async read() {
    const read = readState(this.db);
    if (!read) return null;
    this.known = read.known;
    return read.state;
  }

  /** Refuse d'écrire si la révision enregistrée a changé depuis la dernière lecture ou écriture de cette instance. */
  async assertUnchanged() {
    const row = this.db.prepare("SELECT value FROM SY_store WHERE key = 'revision'").get();
    const onDisk = row ? JSON.parse(row.value) : null;
    if (onDisk !== this.known.revision) {
      throw new DomainError('PERSISTENCE_CONFLICT', "La base a été modifiée par un autre écrivain : écriture refusée, rien n'est écrasé.", { path: this.dbPath });
    }
  }

  async write(state, catalog) {
    this.known = writeState(this.db, state, this.known, catalog);
  }

  async close() {
    if (this.db) {
      try { this.db.close(); } catch { /* déjà fermée */ }
      this.db = null;
    }
    await releaseLock(this.lockPath, this.token);
  }

  describe() {
    const tables = Object.fromEntries([...this.known.collections].map(([collection, c]) => [collection, c.table]));
    return {
      id: SqliteEngine.id, label: SqliteEngine.label, coded: true,
      file: basename(this.dbPath),
      sections: Object.fromEntries(Object.entries(SECTIONS).map(([prefix, s]) => [prefix, s.label])),
      files: { base: basename(this.dbPath), journal: 'SY_journal', ...tables },
      ...(this.imported ? { importedFromJson: this.imported } : {}),
    };
  }
}

/** Lecture seule d'une base existante (outils d'administration) ; `null` si elle n'existe pas. */
export function readSqliteState(path) {
  const dbPath = sqlitePathOf(path);
  if (!existsSync(dbPath)) return null;
  const db = connect(dbPath);
  try {
    return readState(db)?.state ?? null;
  } finally {
    db.close();
  }
}

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
      writeState(db, state, emptyKnown(), null);
      const back = readState(db)?.state;
      for (const key of new Set([...Object.keys(state), ...Object.keys(back ?? {})])) {
        if (JSON.stringify(state[key]) !== JSON.stringify(back?.[key])) {
          throw new DomainError('PERSISTENCE_UNAVAILABLE', `Reprise des fichiers JSON : « ${key} » relu différemment dans la base. Rien n'a été remplacé.`, { key });
        }
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
    // Disposition ancienne « un fichier par espace » : ses fichiers d'espace partent avec le reste.
    for (const file of source.legacy?.files ?? []) await rename(join(dirname(jsonPath), file), join(target, basename(file))).catch(() => {});
    const count = (v) => (Array.isArray(v) ? v.length : Object.keys(v ?? {}).length);
    return { at: new Date().toISOString(), revision: state.revision, archive: target, objects: Object.values(state).filter((v) => v && typeof v === 'object').reduce((n, v) => n + count(v), 0) };
  } finally {
    for (const suffix of ['', '-wal', '-shm']) await unlink(tmp + suffix).catch(() => {});
    await releaseLock(jsonLock, token);
  }
}
