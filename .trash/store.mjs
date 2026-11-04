// Persistance : un fichier JSON révisé, source de vérité unique.
// Chaque mutation travaille sur une copie puis l'écrit atomiquement (fichier temporaire,
// fsync, renommage) : un ensemble composé est enregistré en entier ou pas du tout.
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DomainError } from './errors.mjs';

export const STORE_SCHEMA = 'j1-store/0.2';

export function emptyState() {
  return {
    schemaVersion: STORE_SCHEMA,
    revision: 0,
    updatedAt: null,
    users: {},
    coreProjects: {},
    tasks: {},
    budgets: {},
    patrimoines: {},
    bpmCompositions: {},
    creationRequests: {},
  };
}

export class JsonStore {
  constructor(path) {
    this.path = path;
    this.state = null;
    this.queue = Promise.resolve();
  }

  async load() {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.schemaVersion !== STORE_SCHEMA) {
        throw new Error(`Schéma de persistance inattendu : ${parsed.schemaVersion}`);
      }
      this.state = parsed;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.state = emptyState();
    }
    return this;
  }

  /** Lecture : copie isolée de l'état enregistré (aucune mutation possible par la lecture). */
  snapshot() {
    return structuredClone(this.state);
  }

  /**
   * Exécute une mutation en série. `fn(draft)` modifie la copie et renvoie un résultat.
   * `beforeCommit` permet l'injection d'interruption pour les preuves de reprise.
   */
  mutate(fn, { beforeCommit } = {}) {
    const run = async () => {
      const draft = structuredClone(this.state);
      const result = fn(draft);
      if (result?.unchanged) return result.value;
      draft.revision += 1;
      draft.updatedAt = new Date().toISOString();
      if (beforeCommit) beforeCommit(draft);
      try {
        await this.#write(draft);
      } catch (err) {
        throw new DomainError('PERSISTENCE_UNAVAILABLE', "L'enregistrement n'a pas pu être confirmé.", {
          cause: String(err.message),
        });
      }
      this.state = draft;
      return result?.value;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  async #write(state) {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
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
