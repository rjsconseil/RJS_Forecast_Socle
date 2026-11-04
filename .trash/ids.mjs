// Politique centrale d'identité (J1-OM-01).
// Un ID est opaque : préfixe de nature + UUID aléatoire. Un libellé n'est jamais une clé.
import { randomUUID } from 'node:crypto';

export const KIND_PREFIX = {
  user: 'usr',
  coreProject: 'prj',
  task: 'tsk',
  budget: 'bud',
  patrimoine: 'pat',
  bpmComposition: 'bpm',
};

export function newId(kind) {
  const prefix = KIND_PREFIX[kind];
  if (!prefix) throw new Error(`Nature d'objet inconnue pour la politique d'identité : ${kind}`);
  return `${prefix}_${randomUUID()}`;
}

export function kindOfId(id) {
  if (typeof id !== 'string') return null;
  const prefix = id.split('_')[0];
  return Object.entries(KIND_PREFIX).find(([, p]) => p === prefix)?.[0] ?? null;
}
