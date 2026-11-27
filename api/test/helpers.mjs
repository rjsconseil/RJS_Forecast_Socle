// Outils de test : un socle complet (tous les modules) sur un fichier JSON temporaire réel.
// La date du jour est fixée pour que les périodes du cycle soient déterministes
// (periods.mjs lit SOCLE_TODAY à chaque appel).
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSocle } from '../src/socle/index.mjs';
import { SOCLE_MODULES } from '../src/modules/index.mjs';
import { createApplicationsModule } from '../src/modules/applications/index.mjs';

export const TODAY = '2026-11-03';
process.env.SOCLE_TODAY = TODAY;

/**
 * Socle neuf sur un fichier temporaire ; `reload()` relit le même fichier (redémarrage) :
 * l'instance précédente est fermée d'abord, car le stockage n'admet qu'un écrivain (C11).
 * `closingLock` : les tests historiques saisissent des cycles passés sans les clôturer ; le verrou du cycle suivant
 * (paramètre `bpm.verrouCycleSuivant`, actif par défaut dans l'application) n'y est donc actif que sur demande.
 */
/** Les modules du socle sans aucune application autonome inscrite (réponses de recette indépendantes des applications). */
export const SOCLE_SANS_APPLICATIONS = SOCLE_MODULES.map((m) => (m.id === 'applications' ? createApplicationsModule([]) : m));

export async function makeSocle({ faultInjection = true, closingLock = false, modules = SOCLE_MODULES } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'socle-test-'));
  const dataFile = join(dir, 'store.json');
  let current = await createSocle({ dataFile, modules, faultInjection });
  if (!closingLock) await current.modules.administration.setParameter('bpm.verrouCycleSuivant', { value: false, expectedRevision: 0, note: 'Tests historiques' });
  const reload = async (opts = {}) => {
    await current.close();
    current = await createSocle({ dataFile, modules, faultInjection, ...opts });
    return current;
  };
  return { socle: current, dataFile, reload };
}

/** Exécute `fn` avec une autre date du jour (SOCLE_TODAY), puis rétablit la date de test. */
export async function at(day, fn) {
  process.env.SOCLE_TODAY = day;
  try {
    return await fn();
  } finally {
    process.env.SOCLE_TODAY = TODAY;
  }
}

export const key = (label = 'req') => `${label}-${randomUUID()}`;

/**
 * Crée un user et sa composition BPM complète (users.createUser → initialUserBundle).
 * Renvoie le contexte (`ctx`) et le résultat de composition (`bundle`).
 */
export async function makeUser(socle, input = {}) {
  const bundle = await socle.modules.users.createUser({ requestKey: key('user'), label: 'U1', userType: 'individuel', ...input });
  return { ctx: { userId: bundle.userId }, bundle };
}

/** User « Camille » de référence : cycle mensuel au 1er depuis août 2026, stock et objectif connus. */
export const camille = (socle, extra = {}) =>
  makeUser(socle, { label: 'Camille', userType: 'individuel', openingStock: 12000, objective: 50000, anchorDay: 1, cycleStartDate: '2026-08-01', ...extra });

/** Opération sur le Budget « Projet de vie » du user (budgetId par défaut). */
export const operation = (socle, ctx, input) =>
  socle.modules.budget.createOperation(ctx, { requestKey: key('op'), status: 'realized', costCenterRef: input.direction === 'income' ? 'std:salaires' : 'std:divers', label: 'Opération', ...input });

export const ctxOf = (userId) => ({ userId });

export async function rejects(promise, code) {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (err) {
    if (err.code !== code) throw new Error(`Code attendu ${code}, obtenu ${err.code ?? '(aucun)'} : ${err.message}`);
    return err;
  }
  throw new Error(`Erreur ${code} attendue, aucune erreur levée`);
}

/** Variante synchrone (lectures, analyse de formule). */
export function throwsCode(fn, code) {
  try {
    fn();
  } catch (err) {
    if (err.code !== code) throw new Error(`Code attendu ${code}, obtenu ${err.code ?? '(aucun)'} : ${err.message}`);
    return err;
  }
  throw new Error(`Erreur ${code} attendue, aucune erreur levée`);
}

/** Espaces insécables du format fr-FR ramenées à des espaces simples. */
export const plain = (s) => s.replace(/\s+/g, ' ');

/** Première tâche du projet d'un Budget de projet de la vie : une dépense de projet se saisit sur une tâche. */
export const firstTaskOf = (socle, budgetId) => {
  const b = socle.state.budgets[budgetId];
  return Object.values(socle.state.tasks).filter((t) => t.projectId === b.coreProjectId).sort((x, y) => x.createdAt.localeCompare(y.createdAt))[0]?.id ?? null;
};
