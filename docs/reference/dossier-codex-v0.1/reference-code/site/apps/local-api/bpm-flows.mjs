/**
 * Les flux du quotidien de Budget/Patrimoine Management : entrées (salaires,
 * dons, aides…) et sorties saisies depuis BPM deviennent des opérations du PBM
 * du projet, avec leurs règlements. BPM ne recode pas Budget : il construit
 * l'opération et la fait valider par les validateurs et le garde de Budget.
 */
import { randomUUID } from 'node:crypto';
import { HttpError, isRecord } from './api-http.mjs';

export const BPM_FLOW_CADENCES = new Set(['once', 'weekly', 'monthly', 'yearly']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value) => {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value;
};

function shift(first, cadence, index) {
  if (cadence === 'once') return index ? '' : first;
  if (cadence === 'weekly') {
    const date = new Date(`${first}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index * 7);
    return date.toISOString().slice(0, 10);
  }
  const months = Number(first.slice(0, 4)) * 12 + Number(first.slice(5, 7)) - 1 + (cadence === 'monthly' ? index : index * 12);
  const year = Math.floor(months / 12);
  const month = (months % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(Number(first.slice(8, 10)), last)).padStart(2, '0')}`;
}

/** Les occurrences d'une opération dans [from, to[ : même ancrage que l'interface Budget. */
export function occurrencesBetween(operation, from, to) {
  const out = [];
  if (!validDate(operation.firstDate) || !BPM_FLOW_CADENCES.has(operation.cadence)) return out;
  for (let index = 0; index < 10000; index++) {
    const day = shift(operation.firstDate, operation.cadence, index);
    if (!day || day >= to || (operation.endDate && day > operation.endDate)) break;
    if (day >= from) out.push(day);
  }
  return out;
}

/**
 * Ce qui reste prévu dans la période : les occurrences non encore réglées des
 * opérations retenues, et leurs totaux d'entrées et de sorties.
 */
export function pendingFlows(budget, budgetProjectId, start, end) {
  const pending = budget.operations
    .filter((operation) => operation.budgetProjectId === budgetProjectId && (operation.decision ?? 'approved') === 'approved')
    .flatMap((operation) => {
      const settled = new Set((operation.settlements ?? []).map((entry) => entry.occurrenceDate));
      return occurrencesBetween(operation, start, end)
        .filter((day) => !settled.has(day))
        .map((occurrenceDate) => ({
          operationId: operation.id,
          title: operation.title,
          kind: operation.kind === 'income' ? 'income' : 'expense',
          centerId: operation.centerId ?? null,
          occurrenceDate,
          amountCents: operation.amountCents,
        }));
    })
    .sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate) || a.title.localeCompare(b.title));
  const sum = (kind) => pending.filter((entry) => entry.kind === kind).reduce((total, entry) => total + entry.amountCents, 0);
  return { pending, plannedIncomeCents: sum('income'), plannedExpenseCents: sum('expense') };
}

/** Les sorties réglées de la période, poste par poste : où va l'argent. */
export function spendingByCenter(budget, budgetProjectId, start, end) {
  const byCenter = new Map();
  for (const operation of budget.operations) {
    if (operation.budgetProjectId !== budgetProjectId || operation.kind === 'income') continue;
    const spent = (operation.settlements ?? [])
      .filter((entry) => entry.actualDate >= start && entry.actualDate < end)
      .reduce((total, entry) => total + entry.amountCents, 0);
    if (!spent) continue;
    const key = operation.centerId ?? '';
    byCenter.set(key, (byCenter.get(key) ?? 0) + spent);
  }
  return (budget.centers ?? [])
    .filter((center) => center.budgetProjectId === budgetProjectId && center.kind !== 'income')
    .map((center) => ({ id: center.id, name: center.name, limitCents: center.limitCents ?? null, spentCents: byCenter.get(center.id) ?? 0 }))
    .concat(byCenter.has('') ? [{ id: '', name: '', limitCents: null, spentCents: byCenter.get('') }] : [])
    .sort((a, b) => b.spentCents - a.spentCents);
}

/** Un flux saisi depuis BPM, vérifié avant d'être confié à Budget. */
export function bpmFlowOf(body, centerIds, today) {
  if (!isRecord(body)) throw new HttpError(400, 'Le flux doit être un objet');
  if (body.kind !== 'income' && body.kind !== 'expense')
    throw new HttpError(400, 'Choisissez une entrée ou une sortie');
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 120) throw new HttpError(400, 'Le flux doit avoir un libellé de 120 caractères au plus');
  if (!Number.isSafeInteger(body.amountCents) || body.amountCents <= 0)
    throw new HttpError(400, 'Le montant doit être positif');
  if (!validDate(body.date)) throw new HttpError(400, 'La date du flux est invalide');
  const cadence = body.cadence ?? 'once';
  if (!BPM_FLOW_CADENCES.has(cadence)) throw new HttpError(400, 'La récurrence est invalide');
  const endDate = body.endDate ? String(body.endDate) : '';
  if (endDate && (!validDate(endDate) || endDate < body.date)) throw new HttpError(400, 'La fin de récurrence est invalide');
  const centerId = body.centerId ? String(body.centerId) : null;
  if (centerId && !centerIds.has(centerId)) throw new HttpError(400, 'Le poste de dépense est inconnu');
  if (!centerId)
    throw new HttpError(400, 'Choisissez le poste de l’entrée ou de la dépense');
  const incomeType = typeof body.incomeType === 'string' ? body.incomeType.trim() : '';
  if (incomeType.length > 100 || (body.kind === 'income' && cadence === 'once' && !incomeType))
    throw new HttpError(400, 'Précisez le type de l’entrée financière ponctuelle : don, gain ponctuel, prime exceptionnelle…');
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
  return { kind: body.kind, title, amountCents: body.amountCents, date: body.date, cadence, endDate, centerId, incomeType, settled: !!today && body.date <= today, note };
}

/** L'opération Budget qui porte le flux ; son premier règlement s'il est déjà payé ou reçu. */
export function flowOperation(flow, { budgetProjectId, personId, now }) {
  return {
    id: `BPMF-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
    title: flow.title,
    description: flow.note,
    centerId: flow.centerId,
    personId: personId ?? null,
    providerId: null,
    budgetProjectId,
    coreTaskId: null,
    resource: 'daily',
    kind: flow.kind,
    incomeType: flow.kind === 'income' ? flow.incomeType ?? '' : '',
    cadence: flow.cadence,
    firstDate: flow.date,
    endDate: flow.endDate,
    amountCents: flow.amountCents,
    decision: 'approved',
    priority: 'medium',
    supplier: '',
    quotes: [],
    selectedQuoteId: null,
    settlements: flow.settled ? [{ occurrenceDate: flow.date, actualDate: flow.date, amountCents: flow.amountCents }] : [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Préciser une opération déjà saisie : son poste de dépense (existant ou nommé)
 * et sa note. Ni le montant, ni les dates, ni les règlements ne changent : une
 * période clôturée reste intacte.
 */
export function bpmDetailOf(body, operation) {
  if (!isRecord(body)) throw new HttpError(400, 'La précision doit être un objet');
  if (!operation) throw new HttpError(404, 'Opération introuvable dans ce budget', 'not_found');
  const detail = {};
  if (body.note !== undefined) {
    if (typeof body.note !== 'string' || body.note.length > 500)
      throw new HttpError(400, 'La note compte 500 caractères au plus');
    detail.note = body.note.trim();
  }
  const naming = typeof body.centerName === 'string' && body.centerName.trim();
  if (body.centerId !== undefined || naming) {
    if (body.centerId !== undefined && body.centerId !== null && typeof body.centerId !== 'string')
      throw new HttpError(400, 'Poste de dépense invalide');
    if (!naming && !body.centerId) throw new HttpError(400, 'Le poste est obligatoire pour toute dépense.');
    detail.centerId = body.centerId ?? null;
    if (naming) detail.centerName = body.centerName.trim().slice(0, 120);
  }
  if (!Object.keys(detail).length) throw new HttpError(400, 'Indiquez un poste ou une note');
  return detail;
}

/** Pointer une occurrence prévue : reçue ou payée, au montant prévu ou réel. */
export function bpmSettlementOf(body, operation, today) {
  if (!isRecord(body)) throw new HttpError(400, 'Le règlement doit être un objet');
  if (!operation) throw new HttpError(404, 'Opération introuvable dans ce budget', 'not_found');
  if (!validDate(body.occurrenceDate)) throw new HttpError(400, 'L’échéance est invalide');
  const after = new Date(`${body.occurrenceDate}T12:00:00Z`);
  after.setUTCDate(after.getUTCDate() + 1);
  const occurrences = occurrencesBetween(operation, body.occurrenceDate, after.toISOString().slice(0, 10));
  if (!occurrences.includes(body.occurrenceDate)) throw new HttpError(400, 'Cette échéance ne correspond pas à l’opération');
  if ((operation.settlements ?? []).some((entry) => entry.occurrenceDate === body.occurrenceDate))
    throw new HttpError(409, 'Cette échéance est déjà pointée', 'already_settled');
  const actualDate = body.actualDate ?? today;
  if (!validDate(actualDate) || actualDate > today)
    throw new HttpError(400, 'Le règlement réel doit être daté d’aujourd’hui ou du passé');
  const amountCents = body.amountCents ?? operation.amountCents;
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new HttpError(400, 'Le montant réel est invalide');
  return { occurrenceDate: body.occurrenceDate, actualDate, amountCents };
}

/** D'où vient l'argent : les entrées de la période, reçues et attendues, par libellé. */
export function incomeSources(budget, budgetProjectId, start, end) {
  const sources = new Map();
  for (const operation of budget.operations) {
    if (operation.budgetProjectId !== budgetProjectId || operation.kind !== 'income' || (operation.decision ?? 'approved') !== 'approved') continue;
    const received = (operation.settlements ?? [])
      .filter((entry) => entry.actualDate >= start && entry.actualDate < end)
      .reduce((total, entry) => total + entry.amountCents, 0);
    const settled = new Set((operation.settlements ?? []).map((entry) => entry.occurrenceDate));
    const planned = occurrencesBetween(operation, start, end).filter((day) => !settled.has(day)).length * operation.amountCents;
    if (!received && !planned) continue;
    const current = sources.get(operation.title) ?? { title: operation.title, receivedCents: 0, plannedCents: 0 };
    current.receivedCents += received;
    current.plannedCents += planned;
    sources.set(operation.title, current);
  }
  return [...sources.values()].sort((a, b) => b.receivedCents + b.plannedCents - (a.receivedCents + a.plannedCents));
}

/**
 * Les événements à venir après la période : opérations ponctuelles ou annuelles
 * encore prévues (Noël, vacances, dons…), pour les provisionner à temps.
 */
export function upcomingEvents(budget, budgetProjectId, from, to) {
  return budget.operations
    .filter((operation) => operation.budgetProjectId === budgetProjectId && (operation.decision ?? 'approved') === 'approved' && (operation.cadence === 'once' || operation.cadence === 'yearly'))
    .flatMap((operation) => {
      const settled = new Set((operation.settlements ?? []).map((entry) => entry.occurrenceDate));
      return occurrencesBetween(operation, from, to)
        .filter((day) => !settled.has(day))
        .map((occurrenceDate) => ({
          operationId: operation.id,
          title: operation.title,
          kind: operation.kind === 'income' ? 'income' : 'expense',
          centerId: operation.centerId ?? null,
          occurrenceDate,
          amountCents: operation.amountCents,
        }));
    })
    .sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));
}

/** La valeur connue d'un actif : sa dernière valeur datée, ses mouvements réels ensuite, sa dette. */
export function assetValue(patrimoine, asset, today) {
  const valuation = [...asset.valuations].filter((entry) => entry.date <= today).sort((a, b) => b.date.localeCompare(a.date))[0];
  const moved = patrimoine.operations
    .filter((entry) => entry.assetId === asset.id && entry.status === 'realized' && entry.firstDate <= today && (!valuation || entry.firstDate > valuation.date))
    .reduce((total, entry) => total + (entry.kind === 'income' ? entry.amountCents : -entry.amountCents), 0);
  // La date de la dernière valeur connue : la routine du jour propose de la rafraîchir quand elle vieillit.
  return {
    known: !!valuation,
    valuedAt: valuation?.date ?? null,
    valueCents: (valuation?.valueCents ?? 0) + moved - (asset.liabilityCents ?? 0),
  };
}

/** Les allocations du patrimoine et leurs actifs, pour suivre ce qui est déjà constitué par objectif. */
export function allocationValues(patrimoine, patrimoineProjectId, today) {
  const assets = patrimoine.assets.filter((asset) => asset.projectId === patrimoineProjectId);
  return (patrimoine.allocations ?? [])
    .filter((allocation) => allocation.projectId === patrimoineProjectId)
    .map((allocation) => {
      const own = assets
        .filter((asset) => asset.allocationId === allocation.id)
        .map((asset) => ({ id: asset.id, name: asset.name, ...assetValue(patrimoine, asset, today) }));
      return {
        id: allocation.id,
        name: allocation.name,
        targetCents: allocation.targetCents ?? null,
        known: own.every((asset) => asset.known),
        valueCents: own.reduce((total, asset) => total + asset.valueCents, 0),
        assets: own,
      };
    });
}

/** Un versement entre deux actifs du patrimoine (par exemple de l'épargne vers l'assurance vie). */
export function bpmTransferOf(body, assets, today) {
  if (!isRecord(body)) throw new HttpError(400, 'Le versement doit être un objet');
  const from = assets.find((asset) => asset.id === body.fromAssetId);
  const to = assets.find((asset) => asset.id === body.toAssetId);
  if (!from || !to || from.id === to.id) throw new HttpError(400, 'Choisissez deux actifs différents du patrimoine');
  if (!Number.isSafeInteger(body.amountCents) || body.amountCents <= 0) throw new HttpError(400, 'Le montant doit être positif');
  const date = body.date ?? today;
  if (!validDate(date) || date > today) throw new HttpError(400, 'Un versement réel est daté d’aujourd’hui ou du passé');
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : `Versement vers ${to.name}`;
  return { from, to, amountCents: body.amountCents, date, title };
}

/** Les deux mouvements réels d'un versement : une sortie de l'actif source, une entrée dans la cible. */
export function transferOperations(transfer, patrimoineProjectId, now) {
  const id = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  const movement = (suffix, asset, kind) => ({
    id: `BPMV-${id}-${suffix}`,
    projectId: patrimoineProjectId,
    assetId: asset.id,
    personId: null,
    providerId: null,
    title: transfer.title,
    kind,
    status: 'realized',
    firstDate: transfer.date,
    amountCents: transfer.amountCents,
    createdAt: now,
    updatedAt: now,
  });
  return [movement('S', transfer.from, 'expense'), movement('E', transfer.to, 'income')];
}

/**
 * Le profil type d'une période : ce que rapportent et coûtent, ramenés à une
 * période du cycle, les flux récurrents en vigueur aujourd'hui. Il dit ce qu'une
 * période ordinaire dégage naturellement, avant les événements ponctuels.
 */
export function periodProfile(budget, budgetProjectId, cadence, today) {
  const periods = cadence === 'weekly' ? 52 : cadence === 'monthly' ? 12 : 1;
  const perYear = { weekly: 52, monthly: 12, yearly: 1 };
  const active = budget.operations.filter(
    (operation) =>
      operation.budgetProjectId === budgetProjectId &&
      (operation.decision ?? 'approved') === 'approved' &&
      operation.cadence !== 'once' &&
      operation.firstDate <= today &&
      (!operation.endDate || operation.endDate >= today),
  );
  const perPeriod = (operation) => Math.round((operation.amountCents * perYear[operation.cadence]) / periods);
  const incomes = active
    .filter((operation) => operation.kind === 'income')
    .map((operation) => ({ title: operation.title, cadence: operation.cadence, perPeriodCents: perPeriod(operation) }))
    .sort((a, b) => b.perPeriodCents - a.perPeriodCents);
  const names = new Map(budget.centers.map((center) => [center.id, center.name]));
  const groups = new Map();
  for (const operation of active.filter((entry) => entry.kind !== 'income')) {
    const key = operation.centerId ?? '';
    const group = groups.get(key) ?? { centerId: key, name: names.get(key) ?? '', totalCents: 0, items: [] };
    const cents = perPeriod(operation);
    group.items.push({ title: operation.title, cadence: operation.cadence, perPeriodCents: cents });
    group.totalCents += cents;
    groups.set(key, group);
  }
  const expenses = [...groups.values()].sort((a, b) => b.totalCents - a.totalCents);
  const incomeCents = incomes.reduce((sum, entry) => sum + entry.perPeriodCents, 0);
  const expenseCents = expenses.reduce((sum, entry) => sum + entry.totalCents, 0);
  return { incomes, expenses, incomeCents, expenseCents, naturalSavingCents: incomeCents - expenseCents };
}

/**
 * Un versement consolide les deux valeurs à sa date dans la même écriture que
 * ses mouvements. Les valorisations de Patrimoine incluent déjà les mouvements
 * du même jour : sans cette consolidation, un versement créé le jour d'une
 * valorisation resterait invisible. Les mouvements antérieurs ne sont jamais
 * requalifiés et le total du patrimoine reste inchangé.
 */
export function transferAssets(patrimoine, transfer, now) {
  const readings = [transfer.from, transfer.to].map((asset) => {
    if (asset.valuations.some((entry) => entry.date > transfer.date))
      throw new HttpError(400, 'Le versement ne peut pas précéder la dernière valorisation des actifs concernés');
    const reading = assetValue(patrimoine, asset, transfer.date);
    if (!reading.known) throw new HttpError(400, 'Valorisez les deux actifs avant de déplacer leur épargne');
    return reading;
  });
  if (readings[0].valueCents < transfer.amountCents)
    throw new HttpError(400, 'Le montant du versement dépasse la valeur disponible de l’actif source');
  return patrimoine.assets.map((asset) => {
    const index = asset.id === transfer.from.id ? 0 : asset.id === transfer.to.id ? 1 : -1;
    if (index < 0) return asset;
    const gross = readings[index].valueCents + (asset.liabilityCents ?? 0);
    const valueCents = gross + (index === 0 ? -transfer.amountCents : transfer.amountCents);
    return {
      ...asset,
      updatedAt: now,
      valuations: [...asset.valuations.filter((entry) => entry.date !== transfer.date), { date: transfer.date, valueCents }],
    };
  });
}
