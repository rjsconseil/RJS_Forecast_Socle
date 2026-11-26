// P5 · Données gérées — un seul écrivain (C11). L'ouverture d'un stockage prend un verrou (`<fichier>.lock`) ;
// une seconde instance, du même processus ou d'un autre processus actif, est refusée (STORE_LOCKED).
// Un verrou abandonné (processus mort) est repris. Les verrous tenus sont libérés à la sortie du processus.
import { open, readFile, unlink } from 'node:fs/promises';
import { readFileSync, unlinkSync } from 'node:fs';
import { DomainError } from '../../errors.mjs';

/** Verrous tenus par ce processus : chemin → jeton. */
const HELD = new Map();

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

export async function acquireLock(lockPath, token, path) {
  if (HELD.has(lockPath)) {
    throw new DomainError('STORE_LOCKED', 'Ce stockage est déjà ouvert en écriture par une autre instance de ce processus.', { path });
  }
  const content = JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await open(lockPath, 'wx');
      await fh.writeFile(content);
      await fh.close();
      HELD.set(lockPath, token);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let holder = null;
      try {
        holder = JSON.parse(await readFile(lockPath, 'utf8'));
      } catch {
        /* verrou illisible : considéré comme abandonné */
      }
      const sameProcessStale = holder?.pid === process.pid && !HELD.has(lockPath);
      if (holder && alive(holder.pid) && !sameProcessStale) {
        throw new DomainError('STORE_LOCKED', 'Ce stockage est déjà ouvert en écriture par un autre processus actif.', { path, pid: holder.pid, since: holder.at });
      }
      await unlink(lockPath).catch(() => {});
    }
  }
  throw new DomainError('STORE_LOCKED', 'Impossible de prendre le verrou du stockage.', { path });
}

export async function releaseLock(lockPath, token) {
  if (HELD.get(lockPath) !== token) return;
  HELD.delete(lockPath);
  await unlink(lockPath).catch(() => {});
}

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
