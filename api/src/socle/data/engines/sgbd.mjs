// P5 · Données gérées — couche de STOCKAGE, moteur « sgbd » : PostgreSQL, données PARTITIONNÉES PAR USER.
// Le moteur d'un site en ligne : plusieurs serveurs sur une même base, une connexion partagée par requête (pool).
// Même contrat et mêmes garanties que le moteur SQLite (sqlite.mjs), en asynchrone :
// - une table par collection, rangée par section du site (tables.mjs) : `id`, `user_id` (sa partition), `revision`,
//   `data` (l'objet en JSON, tel qu'écrit), `ord` (ordre d'écriture) ;
// - SY_partitions : révision de chaque partition ; une écriture vérifie la révision attendue de chaque partition
//   qu'elle touche, dans une transaction (UPDATE … WHERE revision = attendue) : écrite ailleurs entre-temps →
//   PERSISTENCE_CONFLICT, la couche de gestion relit et rejoue ; rien n'est jamais écrasé ;
// - une partition se lit en un seul aller-retour (UNION ALL de ses tables).
// Connexion : `SOCLE_PG_URL` (ex. postgres://user@host:5432/base) ; pilote `pg`, chargé seulement si ce moteur est choisi.
import { DomainError } from '../../errors.mjs';
import { JOURNAL_WINDOW, q, SECTIONS, SYSTEM_PARTITION, tableOf } from './tables.mjs';

const PARTITION_SCALARS = new Set(['revision', 'updatedAt']);
const conflict = (message, details) => new DomainError('PERSISTENCE_CONFLICT', message, details);
const userParam = (key) => (key === SYSTEM_PARTITION ? null : key);

const BASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS "SY_store" (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS "SY_tables" (collection TEXT PRIMARY KEY, table_name TEXT NOT NULL UNIQUE, section TEXT NOT NULL, space TEXT, ord BIGSERIAL);
  CREATE TABLE IF NOT EXISTS "SY_journal" (seq BIGSERIAL PRIMARY KEY, at TEXT, command TEXT, user_id TEXT, outcome TEXT, data TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS "SY_journal_user" ON "SY_journal" (user_id, seq);
  CREATE TABLE IF NOT EXISTS "SY_throttle" (key TEXT NOT NULL, at BIGINT NOT NULL);
  CREATE INDEX IF NOT EXISTS "SY_throttle_key" ON "SY_throttle" (key, at);
  CREATE TABLE IF NOT EXISTS "SY_partitions" (user_id TEXT PRIMARY KEY, revision BIGINT NOT NULL, updated_at TEXT, journal_from BIGINT NOT NULL DEFAULT 0, ord BIGSERIAL);
`;

export class SgbdEngine {
  static id = 'sgbd';
  static label = 'PostgreSQL (serveur de base de données, plusieurs serveurs, partitions par user)';
  static coded = true;
  static sync = false;

  constructor({ url = process.env.SOCLE_PG_URL } = {}) {
    this.url = url;
    this.pool = null;
    this.tables = new Map();
    /** Tests seulement : appelé entre la lecture de la révision et celle des objets d'une partition. */
    this.afterRevisionRead = /** @type {null | ((key: string) => Promise<void>)} */ (null);
  }

  get sync() { return false; }

  /** Compteurs d'échecs de connexion partagés par tous les serveurs (voir createThrottle, socle/auth.mjs). */
  throttleStore() {
    return {
      count: async (key, since) => Number((await this.pool.query('SELECT COUNT(*) AS n FROM "SY_throttle" WHERE key = $1 AND at > $2', [key, since])).rows[0].n),
      add: async (keys, now, since) => {
        await this.pool.query('INSERT INTO "SY_throttle" (key, at) SELECT k, $2 FROM unnest($1::text[]) AS k', [keys, now]);
        await this.pool.query('DELETE FROM "SY_throttle" WHERE at <= $1', [since]);
      },
      clear: async (keys) => { await this.pool.query('DELETE FROM "SY_throttle" WHERE key = ANY($1::text[])', [keys]); },
    };
  }

  /** Base joignable ? (point de santé) */
  async ping() { await this.pool.query('SELECT 1'); }

  async open() {
    if (!this.url) throw new DomainError('DATA_ENGINE_UNAVAILABLE', 'Moteur PostgreSQL : SOCLE_PG_URL manquante (adresse de la base).', { principle: 'P5', engine: SgbdEngine.id });
    let pg;
    try {
      pg = (await import('pg')).default;
    } catch {
      throw new DomainError('DATA_ENGINE_UNAVAILABLE', 'Moteur PostgreSQL : le pilote « pg » n’est pas installé (npm install pg).', { principle: 'P5', engine: SgbdEngine.id });
    }
    this.pool = new pg.Pool({ connectionString: this.url, max: Number(process.env.SOCLE_PG_POOL) || 10 });
    try {
      await this.pool.query(BASE_SCHEMA);
      await this.#loadTables();
    } catch (err) {
      await this.close();
      throw new DomainError('DATA_ENGINE_UNAVAILABLE', `Moteur PostgreSQL injoignable : ${err.message}`, { principle: 'P5', engine: SgbdEngine.id });
    }
  }

  async #loadTables() {
    const { rows } = await this.pool.query('SELECT collection, table_name FROM "SY_tables" ORDER BY ord');
    this.tables = new Map(rows.map((r) => [r.collection, r.table_name]));
  }

  /** Crée la table d'une collection (hors transaction d'écriture : sans effet si elle existe). */
  async #ensureTable(collection, space) {
    if (this.tables.has(collection)) return this.tables.get(collection);
    const table = tableOf(collection);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ${q(table)} (id TEXT PRIMARY KEY, user_id TEXT, revision BIGINT NOT NULL, data TEXT NOT NULL, ord BIGSERIAL);
      CREATE INDEX IF NOT EXISTS ${q(table + '_user')} ON ${q(table)} (user_id, ord);`);
    await this.pool.query('INSERT INTO "SY_tables" (collection, table_name, section, space) VALUES ($1, $2, $3, $4) ON CONFLICT (collection) DO NOTHING',
      [collection, table, table.slice(0, 2), space ?? null]);
    await this.#loadTables();
    return this.tables.get(collection);
  }

  async ensureTables(collections, catalog) {
    for (const c of collections) await this.#ensureTable(c, catalog?.spaceOf?.(c));
  }

  async meta() {
    const [{ rows: version }, { rows: parts }] = await Promise.all([
      this.pool.query(`SELECT value FROM "SY_store" WHERE key = 'schemaVersion'`),
      this.pool.query('SELECT 1 FROM "SY_partitions" LIMIT 1'),
    ]);
    return { schemaVersion: version[0] ? JSON.parse(version[0].value) : null, empty: !parts.length };
  }

  async revisions(keys) {
    const { rows } = await this.pool.query('SELECT user_id, revision, updated_at FROM "SY_partitions" WHERE user_id = ANY($1)', [keys]);
    const found = new Map(rows.map((r) => [r.user_id, { revision: Number(r.revision), updatedAt: r.updated_at }]));
    return new Map(keys.map((k) => [k, found.get(k) ?? null]));
  }

  async allRevisions() {
    const { rows } = await this.pool.query('SELECT user_id, revision, updated_at FROM "SY_partitions" ORDER BY ord');
    return new Map(rows.map((r) => [r.user_id, { revision: Number(r.revision), updatedAt: r.updated_at }]));
  }

  /**
   * Une partition lue d'un seul instantané : objets, révision et fin du journal dans UNE transaction en lecture seule
   * (REPEATABLE READ) sur UNE connexion. Sans cela, une écriture d'un autre serveur entre deux requêtes donnerait des
   * objets anciens sous une révision nouvelle : une écriture calculée dessus passerait le contrôle de révision et
   * écraserait l'autre sans erreur (faiblesse n° 2 du rapport « architecture et faiblesses »).
   */
  async readPartition(key) {
    const user = userParam(key);
    const collections = Object.fromEntries([...this.tables.keys()].map((c) => [c, {}]));
    const where = user === null ? 'user_id IS NULL' : 'user_id = $1';
    const params = user === null ? [] : [user];
    const union = [...this.tables].map(([c, t]) => `SELECT ${pgText(c)} AS c, id, data, ord FROM ${q(t)} WHERE ${where}`).join(' UNION ALL ');
    const client = await this.pool.connect();
    let rev, objects, journal, scalars;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      // La révision d'abord : l'instantané est pris à la première requête, toutes les suivantes le voient.
      rev = await client.query('SELECT revision, updated_at, journal_from FROM "SY_partitions" WHERE user_id = $1', [key]);
      if (this.afterRevisionRead) await this.afterRevisionRead(key);
      objects = union ? await client.query(`SELECT c, id, data FROM (${union}) x ORDER BY c, ord`, params) : { rows: [] };
      journal = await client.query(`SELECT data FROM (SELECT seq, data FROM "SY_journal" WHERE ${user === null ? 'user_id IS NULL' : 'user_id = $1'}
        AND seq > (SELECT COALESCE((SELECT journal_from FROM "SY_partitions" WHERE user_id = ${user === null ? "''" : '$1'}), 0))
        ORDER BY seq DESC LIMIT ${JOURNAL_WINDOW}) j ORDER BY seq`, params);
      scalars = key === SYSTEM_PARTITION ? await client.query('SELECT key, value FROM "SY_store"') : { rows: [] };
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    for (const r of objects.rows) (collections[r.c] ??= {})[r.id] = r.data && typeof r.data === 'object' ? r.data : JSON.parse(r.data);
    const sc = {};
    for (const r of scalars.rows) if (!r.key.startsWith('@') && !PARTITION_SCALARS.has(r.key)) sc[r.key] = JSON.parse(r.value);
    const p = rev.rows[0];
    return { key, revision: p ? Number(p.revision) : null, updatedAt: p?.updated_at ?? null, scalars: sc, collections, journal: journal.rows.map((r) => JSON.parse(r.data)) };
  }

  async findObject(collection, id) {
    const table = this.tables.get(collection);
    if (!table) return null;
    const { rows } = await this.pool.query(`SELECT data FROM ${q(table)} WHERE id = $1`, [id]);
    return rows[0] ? JSON.parse(rows[0].data) : null;
  }

  async findBy(collection, field, value, { unique = false } = {}) {
    if (!/^[a-zA-Z]+$/.test(field)) throw new Error(`Champ de recherche invalide : ${field}`);
    const table = await this.#ensureTable(collection, null);
    await this.pool.query(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${q(`${table}_${field}`)} ON ${q(table)} (((data::jsonb) ->> '${field}'))`);
    const { rows } = await this.pool.query(`SELECT data FROM ${q(table)} WHERE (data::jsonb) ->> '${field}' = $1 ORDER BY ord`, [value]);
    return rows.map((r) => JSON.parse(r.data));
  }

  async directory() {
    const table = this.tables.get('users');
    if (!table) return [];
    const { rows } = await this.pool.query(`SELECT data FROM ${q(table)} ORDER BY ord`);
    return rows.map((r) => JSON.parse(r.data));
  }

  async counts() {
    const out = {};
    for (const [c, t] of this.tables) out[c] = Number((await this.pool.query(`SELECT COUNT(*) AS n FROM ${q(t)}`)).rows[0].n);
    return out;
  }

  /** Changements de partitions en une transaction, tout ou rien, révisions attendues vérifiées (voir sqlite.mjs). */
  async commit(changes, catalog) {
    for (const change of changes) for (const [collection] of change.upserts ?? []) await this.#ensureTable(collection, catalog?.spaceOf?.(collection));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const change of changes) {
        const user = userParam(change.key);
        if (change.expected === null) {
          const done = await client.query('INSERT INTO "SY_partitions" (user_id, revision, updated_at) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING', [change.key, change.revision, change.updatedAt]);
          if (done.rowCount !== 1) throw conflict('Une partition nouvelle existe déjà : écriture refusée.', { partition: change.key });
        } else {
          const done = await client.query('UPDATE "SY_partitions" SET revision = $1, updated_at = $2 WHERE user_id = $3 AND revision = $4', [change.revision, change.updatedAt, change.key, change.expected]);
          if (done.rowCount !== 1) throw conflict('La partition a été modifiée par un autre écrivain : écriture refusée, rien n’est écrasé.', { partition: change.key });
        }
        for (const [k, value] of change.scalars ?? []) {
          if (value === undefined) await client.query('DELETE FROM "SY_store" WHERE key = $1', [k]);
          else await client.query('INSERT INTO "SY_store" (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(value)]);
        }
        for (const [collection, id, object, isNew] of change.upserts ?? []) {
          const table = this.tables.get(collection);
          const json = JSON.stringify(object);
          if (isNew) {
            const done = await client.query(`INSERT INTO ${q(table)} (id, user_id, revision, data) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`, [id, user, change.revision, json]);
            if (done.rowCount !== 1) throw conflict(`L'identifiant ${id} existe déjà dans « ${collection} » : écriture refusée.`, { partition: change.key, collection, id });
          } else {
            const done = await client.query(`UPDATE ${q(table)} SET revision = $1, data = $2 WHERE id = $3 AND user_id IS NOT DISTINCT FROM $4`, [change.revision, json, id, user]);
            if (done.rowCount !== 1) throw conflict(`L'objet ${id} a disparu ou changé de partition : écriture refusée.`, { partition: change.key, collection, id });
          }
        }
        for (const [collection, id] of change.deletes ?? []) {
          const table = this.tables.get(collection);
          if (table) await client.query(`DELETE FROM ${q(table)} WHERE id = $1 AND user_id IS NOT DISTINCT FROM $2`, [id, user]);
        }
        if (change.journalReset) await client.query('UPDATE "SY_partitions" SET journal_from = (SELECT COALESCE(MAX(seq), 0) FROM "SY_journal") WHERE user_id = $1', [change.key]);
        for (const entry of change.journal ?? []) {
          await client.query('INSERT INTO "SY_journal" (at, command, user_id, outcome, data) VALUES ($1, $2, $3, $4, $5)', [entry?.at ?? null, entry?.command ?? null, user, entry?.outcome ?? null, JSON.stringify(entry)]);
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err instanceof DomainError) throw err;
      if (err.code === '23505' || err.code === '40001') throw conflict('Écriture refusée par la base (contrainte) : rien n’est écrasé.', { cause: String(err.message) });
      throw err;
    } finally {
      client.release();
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end().catch(() => {});
      this.pool = null;
    }
  }

  describe() {
    return {
      id: SgbdEngine.id, label: SgbdEngine.label, coded: true,
      url: this.url ? this.url.replace(/\/\/[^@/]*@/, '//***@') : null,
      sections: Object.fromEntries(Object.entries(SECTIONS).map(([prefix, s]) => [prefix, s.label])),
      files: Object.fromEntries(this.tables),
    };
  }
}

/** Littéral SQL d'un nom de collection (lettres seulement : les collections sont déclarées par les modules). */
function pgText(value) {
  if (!/^[a-zA-Z]+$/.test(value)) throw new Error(`Nom de collection inattendu : ${value}`);
  return `'${value}'`;
}
