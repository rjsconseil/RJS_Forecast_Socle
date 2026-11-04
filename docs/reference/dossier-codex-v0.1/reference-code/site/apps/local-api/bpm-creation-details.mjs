import { incomePostName } from './parameter-proposals.mjs';
/** Préparation en mémoire des détails relus dans l'assistant, avant transaction. */
import { randomUUID } from 'node:crypto';
import { HttpError } from './api-http.mjs';
import { bpmFlowOf, flowOperation } from './bpm-flows.mjs';
import { budgetWorkspaceOf } from './budget-space.mjs';
import { patrimoineWorkspaceOf } from './patrimoine-space.mjs';
import { bpmVisionOf } from './bpm-vision.mjs';
const id = (prefix) => `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
const list = (value, name) => {
  if (
    !Array.isArray(value) ||
    value.length > 200 ||
    value.some((row) => !row || typeof row !== 'object' || Array.isArray(row))
  )
    throw new HttpError(400, `Liste ${name} invalide (200 lignes au plus)`);
  return value;
};
const nameOf = (value) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120)
    throw new HttpError(400, 'Libellé requis (120 caractères au plus)');
  return value.trim();
};
const amount = (value, optional = false) => {
  if (optional && value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new HttpError(400, 'Montant invalide');
  return value;
};
export function creationDetails({ input, ids, budget, patrimoine, now, today, reuseWealth = false }) {
  const seed = input.details;
  if (seed === undefined) return { budget, patrimoine, vision: input.vision };
  if (!seed || typeof seed !== 'object' || Array.isArray(seed))
    throw new HttpError(400, 'Détails invalides');
  const stamps = { createdAt: now, updatedAt: now };
  const centerMap = new Map();
  const centers = list(seed.centers, 'postes').map((row, index) => {
    const key = nameOf(row.key);
    if (centerMap.has(key)) throw new HttpError(400, 'Poste répété');
    const center = {
      ...stamps,
      id: index === 0 ? ids.center : id('CC'),
      budgetProjectId: ids.budget,
      name: nameOf(row.name),
      description: row.note ?? '',
      group: 'everyday',
      limitCents: amount(row.limitCents, true),
    };
    centerMap.set(key, center.id);
    return center;
  });
  if (!centers.length) throw new HttpError(400, 'Un poste est obligatoire');
  const allocationMap = new Map();
  const allocations = list(seed.allocations, 'allocations').map((row, index) => {
    const key = nameOf(row.key);
    if (allocationMap.has(key)) throw new HttpError(400, 'Allocation répétée');
    const allocation = {
      ...stamps,
      id: index === 0 ? ids.allocation : id('ALLOC'),
      projectId: ids.patrimoine,
      name: nameOf(row.name),
      note: row.note ?? '',
      targetCents: amount(row.targetCents, true),
    };
    allocationMap.set(key, allocation.id);
    return allocation;
  });
  if (!allocations.length) throw new HttpError(400, 'Une allocation est obligatoire');
  const resolve = (map, key) => {
    const found = map.get(key);
    if (!found) throw new HttpError(400, 'Rattachement inconnu dans les détails');
    return found;
  };
  const providerMap = new Map();
  const providers = list(seed.providers ?? [], 'prestataires').map(row => {
    const key = nameOf(row.key);
    if (providerMap.has(key)) throw new HttpError(400, 'Type de prestataire répété');
    const provider = { ...stamps, id: id('PREST'), budgetProjectId: ids.budget,
      name: nameOf(row.name), type: nameOf(row.type), contact: '', note: row.note ?? '',
      audience: 'both', strengths: '', weaknesses: '', appreciation: '', interventions: [] };
    providerMap.set(key, provider.id);
    return provider;
  });
  const incomeCenter = (row) => {
    const name = incomePostName(row);
    let center = centers.find((entry) => entry.kind === 'income' && entry.name === name);
    if (!center) {
      center = { ...stamps, id: id('CC'), budgetProjectId: ids.budget, name, kind:'income', description:'', group:'other', limitCents:null };
      centers.push(center);
    }
    return center.id;
  };
  const flows = list(seed.flows, 'flux').map(row => ({
    ...flowOperation(
      bpmFlowOf({ ...row, centerId: row.kind === 'income' ? incomeCenter(row) : resolve(centerMap, row.center) }, new Set(centers.map((center) => center.id)), today),
      { budgetProjectId: ids.budget, personId: ids.person, now },
    ),
    providerId: row.provider ? resolve(providerMap, row.provider) : null,
  }));
  const assets = list(seed.assets, 'actifs').map((row) => ({
    ...stamps,
    id: id('ACTIF'),
    projectId: ids.patrimoine,
    name: nameOf(row.name),
    note: row.note ?? '',
    allocationId: resolve(allocationMap, row.allocation),
    personId: null,
    liabilityCents: amount(row.liabilityCents),
    valuations:
      row.valueCents === null ? [] : [{ date: row.date, valueCents: amount(row.valueCents) }],
  }));
  const goals = list(seed.goals, 'objectifs').map((row, index) => ({
    ...row,
    id: `G${index + 1}`,
    allocationId: resolve(allocationMap, row.allocation),
  }));
  const vision = bpmVisionOf({ ...input.vision, goals });
  const nextBudget = {
    ...budget,
    ...budgetWorkspaceOf(
      {
        ...budget,
        centers: [...budget.centers.filter((c) => c.budgetProjectId !== ids.budget), ...centers],
        people: budget.people.map((p) =>
          p.id === ids.person ? { ...p, name: nameOf(seed.beneficiary) } : p,
        ),
        providers: [...budget.providers, ...providers],
        operations: [...budget.operations, ...flows],
      },
      now,
    ),
  };
  const nextPatrimoine = reuseWealth ? patrimoine : {
    ...patrimoine,
    ...patrimoineWorkspaceOf(
      {
        ...patrimoine,
        allocations: [
          ...patrimoine.allocations.filter((a) => a.projectId !== ids.patrimoine),
          ...allocations,
        ],
        assets: [...patrimoine.assets, ...assets],
      },
      now,
    ),
  };
  return { budget: nextBudget, patrimoine: nextPatrimoine, vision: reuseWealth ? input.vision : vision };
}
