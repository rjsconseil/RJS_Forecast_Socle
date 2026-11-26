// P5 · Données gérées — couche de STOCKAGE, moteur « json-fichiers » (le moteur en service).
// Stockage par morceaux (disposition 2) : chaque collection est un fichier JSON compact, rangé dans le dossier de
// son espace de stockage (`<base>.donnees/<espace>/<collection>.r<révision>-<jeton>.json`). Le fichier principal
// ne porte que la version, la révision et le manifeste des morceaux. Une écriture ne réécrit que les collections
// qui ont changé, puis le manifeste ; le renommage du fichier principal reste le point de validation unique :
// un ensemble est enregistré en entier ou pas du tout. Les anciens morceaux ne sont supprimés qu'après validation.
// Les dispositions antérieures (un fichier par espace, ou un seul bloc) sont lues telles quelles ; au premier
// enregistrement, elles sont copiées une fois dans `<base>.archives/` puis remplacées par les morceaux.
//
// Garantie d'écriture (C11) : un seul écrivain. L'ouverture prend un verrou (`<fichier>.lock`) ; une seconde
// instance est refusée (STORE_LOCKED). Avant chaque écriture, l'empreinte du fichier principal est comparée
// à la dernière connue : modifié ailleurs → PERSISTENCE_CONFLICT, rien n'est écrasé.
import { copyFile, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { DomainError } from '../../errors.mjs';

const hashOf = (text) => createHash('sha1').update(text).digest('hex');

/** Verrous tenus par ce processus (une seconde instance du même processus est aussi refusée). */
const HELD = new Map();

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

export class JsonFilesEngine {
  static id = 'json-fichiers';
  static label = 'Fichiers JSON (un fichier par collection, rangé par espace de stockage)';
  static coded = true;

  constructor({ path }) {
    this.path = path;
    this.lockPath = `${path}.lock`;
    this.token = randomUUID();
    this.closed = false;
    this.diskStamp = null; // { mtimeMs, size } du fichier principal tel que cette instance le connaît
    this.chunks = new Map(); // collection → { space, file, revision, hash } (morceaux connus sur le disque)
    this.legacy = null; // disposition antérieure lue : { kind: 'bloc' | 'espaces', files: [...] }, archivée au premier enregistrement
  }

  async open() {
    await mkdir(dirname(this.path), { recursive: true });
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

  /** Lit tous les morceaux et rend l'état logique à plat ; `null` si le stockage n'existe pas encore. */
  async read() {
    let parsed;
    try {
      parsed = JSON.parse(await readFile(this.path, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    const storage = parsed.storage;
    delete parsed.storage;
    const dir = dirname(this.path);
    if (storage?.layout === 2) {
      for (const [space, ref] of Object.entries(storage.spaces ?? {})) {
        for (const [collection, file] of Object.entries(ref.collections ?? {})) {
          const text = await readFile(join(dir, file), 'utf8');
          parsed[collection] = JSON.parse(text).data;
          this.chunks.set(collection, { space, file, hash: hashOf(JSON.stringify(parsed[collection])), ref: parsed[collection] });
        }
      }
    } else if (storage?.spaces) {
      // Disposition 1 : un fichier par espace. Un fichier principal réécrit d'un bloc garde la main sur ses collections.
      const files = [];
      for (const ref of Object.values(storage.spaces)) {
        const stored = JSON.parse(await readFile(join(dir, ref.file), 'utf8'));
        for (const [collection, objects] of Object.entries(stored.collections ?? {})) parsed[collection] ??= objects;
        files.push(ref.file);
      }
      this.legacy = { kind: 'espaces', files };
    } else {
      this.legacy = { kind: 'bloc', files: [] };
    }
    this.diskStamp = await this.#stamp();
    return parsed;
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

  /** Refuse d'écrire si le fichier principal a changé depuis la dernière lecture ou écriture de cette instance. */
  async assertUnchanged() {
    const onDisk = await this.#stamp();
    const known = this.diskStamp;
    if ((onDisk === null) !== (known === null) || (onDisk && (onDisk.mtimeMs !== known.mtimeMs || onDisk.size !== known.size))) {
      throw new DomainError('PERSISTENCE_CONFLICT', "Le fichier de stockage a été modifié par un autre écrivain : écriture refusée, rien n'est écrasé.", { path: this.path });
    }
  }

  /** Écrit l'état : les morceaux modifiés d'abord, puis le manifeste (validation), puis le ménage. */
  async write(state, catalog) {
    const dir = dirname(this.path);
    const base = basename(this.path).replace(/\.json$/, '');
    if (this.legacy && this.diskStamp) await this.#archiveLegacy(dir, base);
    const main = {};
    const spaces = Object.fromEntries(catalog.spaces.map((space) => [space, { collections: {} }]));
    const next = new Map();
    const obsolete = [];
    for (const [key, value] of Object.entries(state)) {
      if (value === null || typeof value !== 'object') { main[key] = value; continue; }
      const space = catalog.spaceOf(key);
      const known = this.chunks.get(key);
      // Même objet que le dernier écrit (collection non touchée, copie à la demande) : rien à sérialiser.
      if (known && known.ref === value && known.space === space) {
        next.set(key, known);
        (spaces[space] ??= { collections: {} }).collections[key] = known.file;
        continue;
      }
      const json = JSON.stringify(value);
      const hash = hashOf(json);
      let chunk = known;
      if (!known || known.hash !== hash || known.space !== space) {
        const file = `${base}.donnees/${space}/${key}.r${state.revision}-${randomUUID().slice(0, 6)}.json`;
        await mkdir(join(dir, dirname(file)), { recursive: true });
        await this.#atomicWrite(join(dir, file), `{"space":${JSON.stringify(space)},"collection":${JSON.stringify(key)},"revision":${state.revision},"data":${json}}`);
        if (known) obsolete.push(known.file);
        chunk = { space, file, hash };
      }
      chunk = { ...chunk, ref: value };
      next.set(key, chunk);
      (spaces[space] ??= { collections: {} }).collections[key] = chunk.file;
    }
    for (const [key, known] of this.chunks) if (!next.has(key)) obsolete.push(known.file);
    main.storage = { engine: JsonFilesEngine.id, layout: 2, spaces };
    await this.#atomicWrite(this.path, JSON.stringify(main, null, 2));
    this.chunks = next;
    this.diskStamp = await this.#stamp();
    for (const file of obsolete) await unlink(join(dir, file)).catch(() => {});
    if (this.legacy) {
      for (const file of this.legacy.files) await unlink(join(dir, file)).catch(() => {});
      this.legacy = null;
    }
  }

  /** Copie une fois la disposition antérieure (fichier principal et fichiers d'espace) avant de la remplacer. */
  async #archiveLegacy(dir, base) {
    const stampName = new Date().toISOString().replace(/[:.]/g, '-');
    const target = join(dir, `${base}.archives`, `avant-morceaux-${stampName}`);
    await mkdir(target, { recursive: true });
    await copyFile(this.path, join(target, basename(this.path)));
    for (const file of this.legacy.files) await copyFile(join(dir, file), join(target, basename(file))).catch(() => {});
    // Compatibilité : l'ancien nom de la copie d'un fichier d'un seul bloc reste disponible.
    if (this.legacy.kind === 'bloc') await copyFile(this.path, join(dir, `${base}.avant-schemas.json`)).catch(() => {});
  }

  async #atomicWrite(target, content) {
    const tmp = `${target}.${process.pid}.${this.token.slice(0, 8)}.tmp`;
    const fh = await open(tmp, 'w');
    try {
      await fh.writeFile(content);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, target);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (HELD.get(this.lockPath) === this.token) {
      HELD.delete(this.lockPath);
      await unlink(this.lockPath).catch(() => {});
    }
  }

  describe() {
    return {
      id: JsonFilesEngine.id, label: JsonFilesEngine.label, coded: true,
      layout: 2,
      files: { manifeste: basename(this.path), ...Object.fromEntries([...this.chunks].map(([collection, ref]) => [collection, ref.file])) },
    };
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
// Un signal libère le verrou en quittant (événement « exit »), sauf si le programme gère lui-même l'arrêt (le serveur
// de l'API termine d'abord ses requêtes, voir server.mjs) : il quitte alors à son heure.
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { if (process.listenerCount(sig) === 0) process.exit(0); });
