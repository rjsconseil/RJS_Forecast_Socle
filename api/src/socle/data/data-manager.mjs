// P5 · Données gérées — couche de GESTION, données PARTITIONNÉES PAR USER.
//
// Le parti pris du noyau pour la montée en charge : chaque user est une partition (ses objets, son journal, sa
// révision) ; la partition système porte les paramètres et les valeurs simples du socle. Une requête ne charge que la
// partition de son user (et la partition système), gardée en cache tant que sa révision n'a pas changé ; les
// partitions les moins utilisées quittent la mémoire. Les écritures de deux users différents se font en parallèle ;
// sur une même partition, elles sont en série, et une écriture concurrente venue d'une autre instance (même base) est
// détectée par la révision, relue puis rejouée, sans jamais rien écraser.
//
// Les modules ne changent pas : ils lisent « l'état » (`socle.state`, `scope.store.state`), qui est la vue de la
// partition du user de la requête en cours (contexte asynchrone posé par `within`). Hors requête (scripts, tests,
// administration), l'état est la vue complète, réunion de toutes les partitions.
import { AsyncLocalStorage } from 'node:async_hooks';
import { rm, unlink, writeFile } from 'node:fs/promises';
import { DomainError, fail } from '../errors.mjs';
import { buildCatalog, SYSTEM_COLLECTIONS } from './schemas.mjs';
import { JsonFilesEngine } from './engines/json-files.mjs';
import { readSqliteState, sqlitePathOf, SqliteEngine } from './engines/sqlite.mjs';
import { SgbdEngine } from './engines/sgbd.mjs';
import { JOURNAL_WINDOW, partitionOf, SYSTEM_PARTITION } from './engines/tables.mjs';

export const STORE_SCHEMA = 'socle-store/0.6';
/** Schémas antérieurs acceptés : ils sont migrés explicitement par les migrations déclarées des modules. */
export const LEGACY_SCHEMAS = ['j1-store/0.2', 'socle-store/0.3', 'socle-store/0.4', 'socle-store/0.5'];

/** Les moteurs de stockage connus ; `coded: false` = contrat posé, implémentation à venir. */
export const DATA_ENGINES = { [SqliteEngine.id]: SqliteEngine, [SgbdEngine.id]: SgbdEngine };
export const DEFAULT_DATA_ENGINE = SqliteEngine.id;
/** Partitions gardées en mémoire au plus (les moins récemment utilisées quittent le cache). */
export const DEFAULT_PARTITION_CACHE = Number(process.env.SOCLE_PARTITION_CACHE) || 2000;
/** Écritures rejouées au plus sur une partition modifiée entre-temps par une autre instance. */
const MAX_ATTEMPTS = 4;
/** Valeurs simples propres à chaque vue (calculées depuis les révisions des partitions). */
const VIEW_SCALARS = new Set(['revision', 'updatedAt', 'journal']);

/** Contexte de données de la requête en cours : `{ userId }` (vue de sa partition) ou `{ userId: null }` (vue complète). */
const DATA_CONTEXT = new AsyncLocalStorage();

export function emptyState(collections) {
  const state = { schemaVersion: STORE_SCHEMA, revision: 0, updatedAt: null, journal: [], migrations: [] };
  for (const c of [...collections, ...SYSTEM_COLLECTIONS]) state[c] = {};
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

/**
 * Brouillons paresseux, copie OBJET PAR OBJET (lecture sans copie).
 * Une collection du brouillon est une façade (Proxy) posée sur la collection publiée, gelée : rien n'est copié tant
 * qu'on ne lit pas un objet ; un objet lu est copié une seule fois (la même copie revient ensuite), un objet écrit ou
 * supprimé est noté. À la fin de la transaction, seuls les objets copiés, écrits ou supprimés sont comparés à la vue
 * publiée : le coût d'une commande suit ce qu'elle touche, plus la taille de la partition.
 * Pour les modules, la façade se comporte comme l'objet ordinaire d'avant (lecture, `in`, `Object.values`, écriture,
 * `delete`) ; les parcours d'Object Management (`list`, `by`) filtrent sur les originaux gelés sans les copier.
 */
const TOUCHED = new WeakMap();
const BASES = new WeakMap();
/** Façade de collection → { base, local: Map(id → copie ou objet écrit), deleted: Set(id) }. */
const LOGS = new WeakMap();
const own = (o, id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(o, id);

function draftCollection(base) {
  const local = new Map();
  const deleted = new Set();
  const read = (id) => {
    if (deleted.has(id)) return undefined;
    if (local.has(id)) return local.get(id);
    if (!own(base, id)) return undefined;
    const copy = structuredClone(base[id]);
    local.set(id, copy);
    return copy;
  };
  const present = (id) => typeof id === 'string' && !deleted.has(id) && (local.has(id) || own(base, id));
  const proxy = new Proxy({}, {
    get(target, id) { return present(id) ? read(id) : Reflect.get(target, id); },
    set(target, id, value) {
      if (typeof id !== 'string') return Reflect.set(target, id, value);
      deleted.delete(id);
      local.set(id, value);
      return true;
    },
    deleteProperty(target, id) {
      if (typeof id !== 'string') return Reflect.deleteProperty(target, id);
      local.delete(id);
      if (own(base, id)) deleted.add(id);
      return true;
    },
    has(target, id) { return present(id) || Reflect.has(target, id); },
    ownKeys() {
      const keys = deleted.size ? Object.keys(base).filter((id) => !deleted.has(id)) : Object.keys(base);
      for (const id of local.keys()) if (!own(base, id)) keys.push(id);
      return keys;
    },
    getOwnPropertyDescriptor(target, id) {
      if (!present(id)) return undefined;
      // Le descripteur ne copie pas (parcours `for…in`, `Object.hasOwn`) ; la lecture de la valeur, elle, copie.
      return { value: local.has(id) ? local.get(id) : base[id], writable: true, enumerable: true, configurable: true };
    },
    defineProperty(target, id, desc) {
      if (typeof id !== 'string' || !('value' in desc)) return false;
      deleted.delete(id);
      local.set(id, desc.value);
      return true;
    },
  });
  LOGS.set(proxy, { base, local, deleted });
  return proxy;
}

/** Une collection de ce brouillon a-t-elle pu changer ? Faux seulement si la transaction ne l'a jamais lue ni écrite. */
export const touchedIn = (draft, key) => !TOUCHED.has(draft) || TOUCHED.get(draft).has(key);
/** La vue publiée d'où part un brouillon (contrôle de sortie d'Object Management). */
export const baseOf = (draft) => BASES.get(draft) ?? null;

/**
 * Ce qui a bougé dans une collection de brouillon, sans la parcourir : ids apparus, ids disparus.
 * `null` si ce n'est pas une façade de brouillon (collection remplacée en bloc, objet ordinaire).
 */
export function draftDelta(collection) {
  const log = collection && LOGS.get(collection);
  if (!log) return null;
  const added = [];
  for (const id of log.local.keys()) if (!own(log.base, id)) added.push(id);
  return { added, removed: [...log.deleted] };
}

/**
 * Les objets d'une collection qui satisfont `predicate`, dans l'ordre de la collection. Sur une façade de brouillon,
 * le filtre lit les originaux gelés (ou la copie déjà faite) et seuls les objets retenus sont copiés ; ailleurs,
 * simple filtre.
 */
export function filterCollection(collection, predicate) {
  const log = collection && LOGS.get(collection);
  if (!log) return Object.values(collection ?? {}).filter(predicate);
  const { base, local, deleted } = log;
  const out = [];
  for (const id of Object.keys(base)) {
    if (deleted.has(id)) continue;
    if (predicate(local.has(id) ? local.get(id) : base[id])) out.push(collection[id]);
  }
  for (const [id, value] of local) if (!own(base, id) && predicate(value)) out.push(value);
  return out;
}

function lazyDraft(state) {
  const draft = {};
  const touched = new Set();
  TOUCHED.set(draft, touched);
  BASES.set(draft, state);
  for (const key of Object.keys(state)) {
    const value = state[key];
    if (key === 'journal') { draft.journal = [...(value ?? [])]; continue; } // entrées gelées, liste copiée
    if (value === null || typeof value !== 'object') { draft[key] = value; continue; }
    let copy;
    Object.defineProperty(draft, key, {
      enumerable: true,
      configurable: true,
      get() {
        if (!touched.has(key)) { touched.add(key); copy = isCollection(value) ? draftCollection(value) : structuredClone(value); }
        return copy;
      },
      set(next) { touched.add(key); copy = next; },
    });
  }
  return draft;
}

/** Brouillon de simulation : même copie à la demande qu'une transaction, sans écriture. */
export const draftOf = (state) => lazyDraft(state);

/**
 * Fige un brouillon de simulation pour le relire (métriques, index) : chaque collection touchée devient un objet gelé
 * qui reprend les originaux non copiés et les copies faites, sans rien recopier.
 */
export function readableDraft(draft) {
  const state = BASES.get(draft);
  if (!state) return draft;
  settle(draft, state);
  for (const key of Object.keys(draft)) {
    const log = LOGS.get(draft[key]);
    if (!log) continue;
    const out = {};
    for (const id of Object.keys(log.base)) if (!log.deleted.has(id)) out[id] = log.local.has(id) ? log.local.get(id) : log.base[id];
    for (const [id, value] of log.local) if (!own(log.base, id)) out[id] = value;
    draft[key] = Object.freeze(out);
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

const isCollection = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const EMPTY = Object.freeze({});
/** Une collection a-t-elle au moins un objet ? (sans construire la liste de ses clés) */
const hasObjects = (o) => { for (const _ in o) return true; return false; };
const sameJson = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

export class DataManager {
  constructor({ path, registry, engine = DEFAULT_DATA_ENGINE, cacheSize = DEFAULT_PARTITION_CACHE }) {
    const Engine = DATA_ENGINES[engine];
    if (!Engine) throw new DomainError('DATA_ENGINE_UNAVAILABLE', `Moteur de stockage inconnu : ${engine}.`, { principle: 'P5', engine, known: Object.keys(DATA_ENGINES) });
    this.path = path;
    this.catalog = buildCatalog(registry);
    this.collections = this.catalog.collections;
    this.engine = new Engine({ path });
    this.cacheSize = cacheSize;
    this.closed = false;
    /** Partitions en mémoire : clé → { key, revision, updatedAt, scalars, collections, journal, view, viewSys }. */
    this.parts = new Map();
    this.keys = null; // toutes les clés de partition, chargées à la première vue complète
    this.fullMode = false;
    this.full = null;
    this.queues = new Map();
    this.barrier = Promise.resolve();
    this.stats = { loads: 0, commits: 0, retries: 0, evictions: 0 };
  }

  // ---------- ouverture ----------

  async load() {
    await this.engine.open();
    try {
      const meta = await this.engine.meta();
      if (meta.empty) {
        // Base neuve : la partition système naît avec la version du schéma.
        await this.engine.commit([{ key: SYSTEM_PARTITION, expected: null, revision: 0, updatedAt: null, scalars: [['schemaVersion', STORE_SCHEMA], ['migrations', []]] }], this.catalog);
      } else if (meta.schemaVersion !== STORE_SCHEMA && !LEGACY_SCHEMAS.includes(meta.schemaVersion)) {
        throw new Error(`Schéma de persistance inattendu : ${meta.schemaVersion}`);
      }
      await this.engine.ensureTables?.([...SYSTEM_COLLECTIONS, ...this.collections], this.catalog);
      this.#store(await this.engine.readPartition(SYSTEM_PARTITION));
    } catch (err) {
      await this.close();
      throw err;
    }
    return this;
  }

  get legacySchema() {
    const version = this.parts.get(SYSTEM_PARTITION)?.scalars.schemaVersion ?? STORE_SCHEMA;
    return version !== STORE_SCHEMA ? version : null;
  }

  /** Libère le stockage ; l'instance n'écrit plus. */
  async close() {
    if (this.closed) return;
    this.closed = true;
    await Promise.all([this.barrier, ...this.queues.values()]).catch(() => {});
    await this.engine.close();
  }

  // ---------- partitions en mémoire ----------

  #store(data) {
    const collections = {};
    for (const c of [...SYSTEM_COLLECTIONS, ...this.collections, ...Object.keys(data.collections ?? {})]) {
      collections[c] ??= deepFreeze(data.collections?.[c] ?? {});
    }
    const part = {
      key: data.key, revision: data.revision ?? null, updatedAt: data.updatedAt ?? null,
      scalars: deepFreeze(data.scalars ?? {}), collections, journal: deepFreeze(data.journal ?? []), view: null, viewSys: null,
    };
    this.parts.delete(data.key);
    this.parts.set(data.key, part);
    this.stats.loads += 1;
    this.#evict();
    return part;
  }

  /** Les partitions les moins récemment utilisées quittent la mémoire (sauf la système, les partitions en écriture, la vue complète). */
  #evict() {
    if (this.fullMode) return;
    for (const key of this.parts.keys()) {
      if (this.parts.size <= this.cacheSize) return;
      if (key === SYSTEM_PARTITION || this.queues.has(key)) continue;
      this.parts.delete(key);
      this.stats.evictions += 1;
    }
  }

  /** La partition en mémoire, lue à la demande si le moteur lit sans attendre (SQLite). */
  #part(key) {
    let part = this.parts.get(key);
    if (part) {
      if (key !== SYSTEM_PARTITION) { this.parts.delete(key); this.parts.set(key, part); } // plus récemment utilisée
      return part;
    }
    if (!this.engine.sync) fail('PARTITION_NOT_LOADED', `Partition ${key || 'système'} non chargée : la lecture passe par une requête (within).`, { partition: key });
    return this.#store(this.engine.readPartition(key));
  }

  /** Relit les partitions dont la révision enregistrée a changé (écrites par une autre instance). */
  async #refresh(keys) {
    const revisions = await this.engine.revisions(keys);
    for (const key of keys) {
      const stored = revisions.get(key);
      const cached = this.parts.get(key);
      if (cached && (cached.revision ?? null) === (stored?.revision ?? null)) continue;
      if (!cached && !stored) continue;
      this.#store(await this.engine.readPartition(key));
    }
  }

  async #refreshAll() {
    const revisions = await this.engine.allRevisions();
    this.keys = new Set([...revisions.keys()].filter((k) => k !== SYSTEM_PARTITION));
    for (const [key, stored] of revisions) {
      const cached = this.parts.get(key);
      if (cached && cached.revision === stored.revision) continue;
      this.#store(await this.engine.readPartition(key));
    }
  }

  // ---------- vues ----------

  #compose(sys, parts, journal) {
    const view = { schemaVersion: sys.scalars.schemaVersion ?? STORE_SCHEMA };
    view.revision = parts.reduce((n, p) => n + (p.revision ?? 0), sys.revision ?? 0);
    view.updatedAt = [sys, ...parts].map((p) => p.updatedAt).filter(Boolean).sort().at(-1) ?? null;
    for (const [k, v] of Object.entries(sys.scalars)) if (k !== 'schemaVersion') view[k] = v;
    view.migrations ??= [];
    view.journal = journal;
    for (const c of Object.keys(sys.collections)) {
      const pieces = [sys.collections[c], ...parts.map((p) => p.collections[c] ?? EMPTY)].filter(hasObjects);
      view[c] = pieces.length === 0 ? EMPTY : pieces.length === 1 ? pieces[0] : Object.freeze(Object.assign({}, ...pieces));
    }
    for (const p of parts) for (const c of Object.keys(p.collections)) if (!(c in view)) view[c] = p.collections[c];
    return Object.freeze(view);
  }

  /** Vue d'une partition (son user et la partition système) ; `null` : la partition système seule. */
  viewOf(userId) {
    const sys = this.#part(SYSTEM_PARTITION);
    if (!userId) {
      if (sys.view && sys.viewSys === sys.revision) return sys.view;
      sys.view = this.#compose(sys, [], sys.journal);
      sys.viewSys = sys.revision;
      return sys.view;
    }
    const part = this.#part(userId);
    if (part.view && part.viewSys === sys.revision) return part.view;
    part.view = this.#compose(sys, [part], part.journal);
    part.viewSys = sys.revision;
    return part.view;
  }

  /** Vue complète : toutes les partitions réunies (scripts, tests, administration). Ne passe pas à l'échelle. */
  fullView() {
    this.fullMode = true;
    if (!this.keys) {
      if (!this.engine.sync) fail('PARTITION_NOT_LOADED', 'Vue complète non chargée : la lecture passe par une requête (within).');
      this.keys = new Set([...this.engine.allRevisions().keys()].filter((k) => k !== SYSTEM_PARTITION));
    }
    const sys = this.#part(SYSTEM_PARTITION);
    const parts = [...this.keys].map((k) => this.#part(k));
    const stamp = [sys, ...parts].map((p) => `${p.key}:${p.revision}`).join('|');
    if (this.full?.stamp === stamp) return this.full.view;
    const journal = [sys, ...parts].flatMap((p) => p.journal);
    journal.sort((a, b) => String(a?.at ?? '').localeCompare(String(b?.at ?? '')));
    const view = this.#compose(sys, parts, Object.freeze(journal.slice(-JOURNAL_WINDOW)));
    this.full = { stamp, view };
    return view;
  }

  /** L'état lu par les modules : la vue du user de la requête en cours, sinon la vue complète. */
  get state() {
    const ctx = DATA_CONTEXT.getStore();
    return ctx?.userId ? this.viewOf(ctx.userId) : this.fullView();
  }

  /** Révision de la vue d'un user (ou de la vue complète). */
  revisionOf(userId) {
    return userId ? this.viewOf(userId).revision : this.fullView().revision;
  }

  /**
   * Exécute `fn` dans le contexte de données d'une requête : la partition du user (et la partition système) est
   * revalidée contre la base, puis l'état lu par les modules est sa vue. Sans user : vue complète (administration).
   */
  async within(userId, fn) {
    if (userId) await this.#refresh([SYSTEM_PARTITION, userId]);
    else if (!this.engine.sync || this.fullMode) await this.#refreshAll();
    else await this.#refresh([SYSTEM_PARTITION]);
    return DATA_CONTEXT.run({ userId: userId || null }, fn);
  }

  /** L'annuaire des users, sans charger leurs partitions. */
  async directory() {
    return deepFreeze(await this.engine.directory());
  }

  /** Un reçu de création par sa clé de demande, quelle que soit sa partition (idempotence). */
  async receipt(requestKey) {
    return (await this.engine.findObject('creationRequests', requestKey)) ?? null;
  }

  // ---------- écritures ----------

  #enqueue(key, run) {
    const previous = Promise.all([this.barrier, this.queues.get(key)]);
    const next = previous.then(run, run);
    const tail = next.catch(() => {});
    this.queues.set(key, tail);
    tail.then(() => { if (this.queues.get(key) === tail) this.queues.delete(key); });
    return next;
  }

  #enqueueAll(run) {
    const previous = Promise.all([this.barrier, ...this.queues.values()]);
    const next = previous.then(run, run);
    this.barrier = next.catch(() => {});
    return next;
  }

  /**
   * Transaction : `fn(draft)` modifie une copie de la vue et renvoie `{ value }` ou `{ unchanged: true, value }`.
   * - `partition: <userId>` : la partition de ce user (écritures permises : la sienne, la partition système et des
   *   partitions nouvelles, pour la création d'un user) ; en série avec les autres écritures de ce user seulement.
   * - `partition: null` : la partition système seule (commandes sans user).
   * - sans `partition` : toute la base (administration, migrations, scripts) ; en série avec toutes les écritures.
   * L'état publié n'est jamais modifié en place : les partitions écrites sont remplacées puis gelées. Une partition
   * modifiée entre-temps par une autre instance est relue et la transaction rejouée.
   */
  mutate(fn, { partition, beforeCommit } = {}) {
    const all = partition === undefined;
    const key = all ? null : partition || SYSTEM_PARTITION;
    const run = async () => {
      if (this.closed) throw new DomainError('PERSISTENCE_UNAVAILABLE', 'Stockage fermé.');
      for (let attempt = 1; ; attempt += 1) {
        if (all) await this.#refreshAll();
        else await this.#refresh(key === SYSTEM_PARTITION ? [SYSTEM_PARTITION] : [SYSTEM_PARTITION, key]);
        const base = all ? this.fullView() : this.viewOf(key === SYSTEM_PARTITION ? null : key);
        const draft = lazyDraft(base);
        const result = fn(draft);
        if (result?.unchanged) return result.value;
        settle(draft, base);
        if (beforeCommit) beforeCommit(draft);
        const changes = this.#changes(base, draft, all);
        if (!changes.length) return result?.value;
        if (!all) await this.#guardForeign(changes, key);
        try {
          await this.engine.commit(changes, this.catalog);
        } catch (err) {
          if (err instanceof DomainError && err.code === 'PERSISTENCE_CONFLICT' && attempt < MAX_ATTEMPTS) { this.stats.retries += 1; continue; }
          if (err instanceof DomainError) throw err;
          throw new DomainError('PERSISTENCE_UNAVAILABLE', "L'enregistrement n'a pas pu être confirmé.", { cause: String(err.message) });
        }
        this.stats.commits += 1;
        this.#apply(changes);
        return result?.value;
      }
    };
    return all ? this.#enqueueAll(run) : this.#enqueue(key, run);
  }

  /** Les changements d'un brouillon, rangés par partition, avec la révision attendue de chacune. */
  #changes(base, draft, all) {
    const now = new Date().toISOString();
    const byKey = new Map();
    const change = (key) => {
      let c = byKey.get(key);
      if (!c) {
        const expected = this.parts.get(key)?.revision ?? null;
        c = { key, expected, revision: (expected ?? 0) + 1, updatedAt: now, scalars: [], upserts: [], deletes: [], journal: [] };
        byKey.set(key, c);
      }
      return c;
    };
    const upsert = (c, id, prev, next) => {
      if (prev !== undefined && sameJson(prev, next)) return;
      const key = partitionOf(next);
      if (prev !== undefined && partitionOf(prev) !== key) {
        fail('WRITE_OUTSIDE_PARTITION', `L'objet ${id} ne peut pas changer de user.`, { principle: 'P5', collection: c, id });
      }
      change(key).upserts.push([c, id, next, prev === undefined]);
    };
    // Valeurs simples du socle → partition système.
    for (const k of new Set([...Object.keys(base), ...Object.keys(draft)])) {
      if (VIEW_SCALARS.has(k)) continue;
      const a = base[k];
      const b = draft[k];
      if (isCollection(a) || isCollection(b)) continue;
      if (!sameJson(a, b)) change(SYSTEM_PARTITION).scalars.push([k, b]);
    }
    // Objets → partition de leur user.
    for (const c of new Set([...Object.keys(base), ...Object.keys(draft)])) {
      if (VIEW_SCALARS.has(c) || !(isCollection(base[c]) || isCollection(draft[c]))) continue;
      if (!touchedIn(draft, c) && draft[c] === base[c]) continue;
      const before = base[c] ?? EMPTY;
      const after = draft[c] ?? EMPTY;
      const log = LOGS.get(after);
      if (log && log.base === before) {
        // Façade de brouillon : seuls les objets copiés, écrits ou supprimés sont comparés.
        for (const [id, next] of log.local) upsert(c, id, own(before, id) ? before[id] : undefined, next);
        for (const id of log.deleted) change(partitionOf(before[id])).deletes.push([c, id]);
        continue;
      }
      for (const id of Object.keys(after)) upsert(c, id, before[id], after[id]);
      for (const id of Object.keys(before)) if (!(id in after)) change(partitionOf(before[id])).deletes.push([c, id]);
    }
    // Journal : seules les entrées nouvelles sont ajoutées ; un journal vidé repart de zéro dans la vue.
    const known = new Set(base.journal ?? []);
    for (const entry of draft.journal ?? []) if (!known.has(entry)) change(partitionOf(entry)).journal.push(entry);
    if ((base.journal ?? []).length && !(draft.journal ?? []).length) {
      const keys = all ? [SYSTEM_PARTITION, ...(this.keys ?? [])] : [...byKey.keys()];
      for (const key of keys) change(key).journalReset = true;
    }
    return [...byKey.values()];
  }

  /** Une écriture de user ne touche que sa partition, la partition système, et des partitions nouvelles (création d'un user). */
  async #guardForeign(changes, own) {
    const foreign = changes.filter((c) => c.key !== own && c.key !== SYSTEM_PARTITION);
    if (!foreign.length) return;
    const revisions = await this.engine.revisions(foreign.map((c) => c.key));
    for (const c of foreign) {
      if (this.parts.get(c.key)?.revision != null || revisions.get(c.key)) {
        fail('WRITE_OUTSIDE_PARTITION', `Écriture refusée : la partition d'un autre user (${c.key}) ne s'écrit que par ses propres commandes.`, { principle: 'P5', partition: c.key, own });
      }
      c.expected = null;
      c.revision = 1;
    }
  }

  /** Applique des changements validés aux partitions en mémoire (sans relire la base). */
  #apply(changes) {
    for (const change of changes) {
      if (change.key !== SYSTEM_PARTITION) this.keys?.add(change.key);
      const cached = this.parts.get(change.key);
      if (!cached && change.expected !== null) continue; // pas en mémoire : relue à la demande
      const part = cached ?? { key: change.key, scalars: {}, collections: {}, journal: [] };
      const collections = { ...part.collections };
      const edited = new Map();
      const edit = (c) => edited.get(c) ?? edited.set(c, { ...(collections[c] ?? {}) }).get(c);
      // Seuls les objets écrits sont gelés en profondeur ; les autres le sont déjà (même référence que la vue d'avant).
      for (const [c, id, object] of change.upserts) edit(c)[id] = deepFreeze(object);
      for (const [c, id] of change.deletes) delete edit(c)[id];
      for (const [c, objects] of edited) collections[c] = Object.freeze(objects);
      const scalars = { ...part.scalars };
      for (const [k, v] of change.scalars) { if (v === undefined) delete scalars[k]; else scalars[k] = v; }
      const journal = change.journalReset ? [...change.journal] : [...part.journal, ...change.journal].slice(-JOURNAL_WINDOW);
      this.#store({ key: change.key, revision: change.revision, updatedAt: change.updatedAt, scalars, collections, journal });
    }
  }

  // ---------- administration ----------

  /** Le système de gestion vu de l'administration : moteur en service, moteurs possibles, schémas et volumes. */
  async describe() {
    const counts = await this.engine.counts();
    const sys = this.parts.get(SYSTEM_PARTITION);
    return {
      principle: 'P5',
      schemaVersion: sys?.scalars.schemaVersion ?? null,
      engine: this.engine.describe(),
      engines: Object.values(DATA_ENGINES).map((E) => ({ id: E.id, label: E.label, coded: E.coded, active: E.id === this.engine.constructor.id })),
      partitions: { cached: this.parts.size, cacheSize: this.cacheSize, ...this.stats },
      spaces: this.catalog.spaces,
      schemas: this.catalog.schemas.map((schema) => ({
        name: schema.name, category: schema.category, module: schema.module, label: schema.label, space: schema.space,
        collections: [...schema.collections, ...schema.lists].map((name) => ({ name, objects: counts[name] ?? 0 })),
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
  for (const file of [db, db + '-wal', db + '-shm', db + '.lock']) await unlink(file).catch((err) => { if (err.code !== 'ENOENT') throw err; });
  if (path.endsWith('.sqlite')) path = path.replace(/\.sqlite$/, '.json');
  await unlink(path).catch((err) => { if (err.code !== 'ENOENT') throw err; });
  await rm(path.replace(/\.json$/, '') + '.donnees', { recursive: true, force: true });
}
