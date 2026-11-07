// Persistance : un fichier JSON révisé, source de vérité unique.
// Chaque mutation travaille sur une copie puis l'écrit atomiquement (fichier temporaire,
// fsync, renommage) : un ensemble composé est enregistré en entier ou pas du tout.
//
// Garantie d'écriture (C11) : un seul écrivain par fichier. L'ouverture prend un verrou
// (`<fichier>.lock`, création exclusive) ; une seconde instance — même processus ou autre
// processus vivant — est refusée (STORE_LOCKED). Un verrou dont le processus est mort est
// repris. En défense supplémentaire, chaque écriture vérifie que le fichier n'a pas changé
// depuis la dernière lecture/écriture de cette instance ; sinon PERSISTENCE_CONFLICT et rien
// n'est écrasé. Ce n'est pas un stockage multi-écrivains : c'est un refus explicite.
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { readFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { DomainError } from './errors.mjs';

export const STORE_SCHEMA = 'socle-store/0.6';
/** Schémas antérieurs acceptés : ils sont migrés explicitement par les migrations déclarées des modules. */
export const LEGACY_SCHEMAS = ['j1-store/0.2', 'socle-store/0.3', 'socle-store/0.4', 'socle-store/0.5'];

// Collections techniques du socle, en plus des collections d'objets déclarées par les modules.
const SYSTEM_COLLECTIONS = ['creationRequests', 'parameters'];

/** Verrous tenus par ce processus (une seconde instance du même processus est aussi refusée). */
const HELD = new Map();

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

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

export class JsonStore {
  constructor(path, collections) {
    this.path = path;
    this.lockPath = `${path}.lock`;
    this.collections = collections;
    this.state = null;
    this.queue = Promise.resolve();
    this.token = randomUUID();
    this.closed = false;
    this.diskStamp = null; // { mtimeMs, size } du fichier tel que cette instance le connaît
  }

  async load() {
    await mkdir(dirname(this.path), { recursive: true });
    await this.#lock();
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'));
      if (parsed.schemaVersion !== STORE_SCHEMA && !LEGACY_SCHEMAS.includes(parsed.schemaVersion)) {
        throw new Error(`Schéma de persistance inattendu : ${parsed.schemaVersion}`);
      }
      this.state = withCollections(parsed, this.collections);
      this.diskStamp = await this.#stamp();
    } catch (err) {
      if (err.code !== 'ENOENT') {
        await this.close();
        throw err;
      }
      this.state = emptyState(this.collections);
    }
    return this;
  }

  get legacySchema() {
    return this.state?.schemaVersion !== STORE_SCHEMA ? this.state?.schemaVersion : null;
  }

  async #lock() {
    if (HELD.has(this.lockPath)) {
      throw new DomainError('STORE_LOCKED', 'Ce stockage est déjà ouvert en écriture par une autre instance de ce processus.', { path: this.path });
    }
    const content = JSON.stringify({ pid: process.pid, token: this.token, at: new Date().toISOString() });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fh = await open(this.lockPath, 'wx');
        await fh.writeFile(content);
        await fh.close();
        HELD.set(this.lockPath, this.token);
        return;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        let holder = null;
        try {
          holder = JSON.parse(await readFile(this.lockPath, 'utf8'));
        } catch {
          /* verrou illisible : considéré comme abandonné */
        }
        const sameProcessStale = holder?.pid === process.pid && !HELD.has(this.lockPath);
        if (holder && alive(holder.pid) && !sameProcessStale) {
          throw new DomainError('STORE_LOCKED', 'Ce stockage est déjà ouvert en écriture par un autre processus actif.', { path: this.path, pid: holder.pid, since: holder.at });
        }
        await unlink(this.lockPath).catch(() => {}); // verrou abandonné (processus mort) : repris
      }
    }
    throw new DomainError('STORE_LOCKED', 'Impossible de prendre le verrou du stockage.', { path: this.path });
  }

  /** Libère le verrou ; l'instance n'écrit plus. */
  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.queue.catch(() => {});
    if (HELD.get(this.lockPath) === this.token) {
      HELD.delete(this.lockPath);
      await unlink(this.lockPath).catch(() => {});
    }
  }

  async #stamp() {
    try {
      const s = await stat(this.path);
      return { mtimeMs: s.mtimeMs, size: s.size };
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * Exécute une mutation en série. `fn(draft)` modifie la copie et renvoie
   * `{ value }` ou `{ unchanged: true, value }`. `beforeCommit` permet l'injection d'interruption.
   * L'état publié (`this.state`) n'est jamais modifié en place : il est remplacé, ce qui permet
   * de lire un instantané figé en gardant une référence.
   */
  mutate(fn, { beforeCommit } = {}) {
    const run = async () => {
      if (this.closed) throw new DomainError('PERSISTENCE_UNAVAILABLE', 'Stockage fermé.');
      const draft = structuredClone(this.state);
      const result = fn(draft);
      if (result?.unchanged) return result.value;
      draft.revision += 1;
      draft.updatedAt = new Date().toISOString();
      if (beforeCommit) beforeCommit(draft);
      const onDisk = await this.#stamp();
      const known = this.diskStamp;
      if ((onDisk === null) !== (known === null) || (onDisk && (onDisk.mtimeMs !== known.mtimeMs || onDisk.size !== known.size))) {
        throw new DomainError('PERSISTENCE_CONFLICT', "Le fichier de stockage a été modifié par un autre écrivain : écriture refusée, rien n'est écrasé.", { path: this.path });
      }
      try {
        await this.#write(draft);
      } catch (err) {
        throw new DomainError('PERSISTENCE_UNAVAILABLE', "L'enregistrement n'a pas pu être confirmé.", { cause: String(err.message) });
      }
      this.diskStamp = await this.#stamp();
      this.state = draft;
      return result?.value;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  async #write(state) {
    const tmp = `${this.path}.${process.pid}.${this.token.slice(0, 8)}.tmp`;
    const fh = await open(tmp, 'w');
    try {
      await fh.writeFile(JSON.stringify(state, null, 2));
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, this.path);
  }
}

// Libération des verrous à la sortie du processus (arrêt normal ou signal).
process.once('exit', () => {
  for (const [lockPath, token] of HELD) {
    try {
      if (JSON.parse(readFileSync(lockPath, 'utf8')).token === token) unlinkSync(lockPath);
    } catch {
      /* déjà libéré */
    }
  }
});
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => process.exit(0));
