// BPM — état du cycle et préparation d'un user : périodes et clôtures, contexte des métriques, verrou du cycle
// suivant, contrat de clôture, chiffres d'une clôture enregistrée. Fonctions pures sur l'état lu.
import { assertClosable } from '../budget/api.mjs';
import { fail } from '../../socle/errors.mjs';
import { closuresOf, compositionOf, cycleOf } from './composition.mjs';
import { RESULT_METRIC } from './metrics.mjs';
import { awaitingClosure, LOCK_PARAMETER, lockMessage } from './closing.mjs';
import { cycleBounds, dayBefore, indexOfKey, periodByIndex, periodByKey, periodsPage, today } from '../budget/api.mjs';


/**
 * Liaison de cycle : mensuelle [P] ; active dès que le jour d'ancrage est connu.
 * `startField` : nom du champ tel que l'appelant l'a envoyé (erreur rendue par champ, C09).
 */

/**
 * État de préparation BPM d'un user (C06), en lecture seule : exactement un Budget « Projet de vie »,
 * un Patrimoine, une composition et une liaison de cycle. Rien n'est créé pendant un diagnostic.
 */
export function preparationOf(state, userId) {
  const lifes = Object.values(state.budgets).filter((b) => b.userId === userId && b.role === 'life');
  const pats = Object.values(state.patrimoines).filter((p) => p.userId === userId);
  const comps = Object.values(state.bpmCompositions).filter((c) => c.userId === userId);
  const cycles = comps.length === 1 ? Object.values(state.cycleLinks).filter((c) => c.bpmCompositionId === comps[0].id) : [];
  const parts = [
    ['lifeBudget', 'Budget « Projet de vie »', lifes],
    ['patrimoine', 'Patrimoine', pats],
    ['bpmComposition', 'Composition BPM', comps],
    ['cycleLink', 'Liaison de cycle', comps.length === 1 ? cycles : null],
  ];
  const missing = parts.filter(([, , l]) => l && !l.length).map(([code, label]) => ({ code, label }));
  const duplicates = parts.filter(([, , l]) => l && l.length > 1).map(([code, label, l]) => ({ code, label, ids: l.map((x) => x.id) }));
  const comp = comps[0];
  const life = lifes[0];
  const pat = pats[0];
  const linked = comps.length !== 1 || (comp.budgetId === life?.id && comp.patrimoineId === pat?.id && pat?.principalBudgetId === life?.id && life?.coreProjectId === comp.coreProjectId && pat?.coreProjectId === comp.coreProjectId);
  const status = duplicates.length || !linked ? 'inconsistent' : missing.length ? 'to-prepare' : 'ready';
  return { status, missing, duplicates, linked, ids: [...lifes, ...pats, ...comps, ...cycles].map((x) => x.id) };
}

export const periodStatus = (p, now, closure) => (closure ? 'closed' : p.end < now ? 'ended' : p.start > now ? 'future' : 'current');

/**
 * État du cycle sans énumération (C10) : bornes, clôtures par clé, première période ouverte
 * (les clôtures sont séquentielles : celle qui suit la dernière close).
 */
export function cycleState(state, cycle, now = today()) {
  const bounds = cycleBounds(cycle, now);
  if (!bounds) return null;
  const closures = closuresOf(state, cycle.id);
  const byKey = new Map(closures.map((c) => [c.periodKey, c]));
  const decorate = (p) => {
    const c = byKey.get(p.key);
    return { ...p, status: periodStatus(p, now, c), closureId: c?.id ?? null };
  };
  const last = closures.at(-1);
  const firstOpen = decorate(last ? periodByIndex(indexOfKey(last.periodKey) + 1, cycle.anchorDay) : bounds.first);
  return {
    ...bounds,
    current: decorate(bounds.current),
    firstOpen,
    decorate,
    /** Période du cycle par clé, entre la première et la courante ; null sinon. */
    find(key) {
      const p = periodByKey(key, cycle.anchorDay);
      return p && p.index >= bounds.first.index && p.index <= bounds.current.index ? decorate(p) : null;
    },
    page: (opts) => {
      const r = periodsPage(cycle, { ...opts, now });
      return { ...r, periods: r.periods.map(decorate) };
    },
  };
}

/** Contexte de calcul : Budget « Projet de vie », Patrimoine, période et date d'arrêté du Patrimoine. */
export function metricContext(state, userId, socle, { periodKey } = {}) {
  const comp = compositionOf(state, userId);
  if (!comp) return { state, userId, period: null, budgetId: null, patrimoineId: null };
  const cs = cycleState(state, cycleOf(state, comp.id));
  let period = null;
  if (periodKey) {
    period = cs?.find(periodKey) ?? null;
    if (!period) fail('NOT_FOUND', 'Période inconnue pour ce cycle.', { periodKey });
  } else if (cs) {
    period = cs.current;
  }
  return { state, userId, budgetId: comp.budgetId, patrimoineId: comp.patrimoineId, period, asOf: period ? dayBefore(period.start) : today() };
}

/**
 * Verrou du cycle suivant [P] (paramètre `bpm.verrouCycleSuivant`) : tant qu'un cycle terminé attend sa clôture,
 * le budget du projet de vie et ses projets ne reçoivent aucune entrée datée du cycle d'aujourd'hui ou après.
 */
export function nextCycleLock(state, socle, userId, budgetId) {
  if (socle.parameters.value(state, LOCK_PARAMETER) === false) return null;
  const comp = compositionOf(state, userId);
  const cycle = comp ? cycleOf(state, comp.id) : null;
  const b = state.budgets[budgetId];
  if (!cycle || !b || (b.id !== comp.budgetId && b.parentBudgetId !== comp.budgetId)) return null;
  return awaitingClosure(cycleState(state, cycle));
}

export const lockRefusal = (lock, date) => fail('CYCLE_AWAITING_CLOSURE', lockMessage(lock), { periodKey: lock.periodKey, from: lock.from, date });

/**
 * Contrat commun de la clôture (C02) : conditions et montant qui sera effectivement capitalisé.
 * La confirmation affichée et la commande utilisent exactement ce calcul.
 */
export function closingContract(state, userId, socle, periodKey) {
  const comp = compositionOf(state, userId);
  if (!comp) fail('NOT_FOUND', 'Ce user n’a pas de composition BPM.');
  const cycle = cycleOf(state, comp.id);
  const cs = cycleState(state, cycle);
  if (!cs) fail('FORBIDDEN_BY_RULE', 'Le cycle est à configurer : aucune période à clôturer.');
  const period = cs.find(periodKey);
  if (!period) fail('NOT_FOUND', 'Période inconnue pour ce cycle.', { periodKey });
  assertClosable(period, cs.firstOpen);
  const mctx = metricContext(state, userId, socle, { periodKey: period.key });
  const result = socle.metrics.evaluate(mctx, RESULT_METRIC);
  if (result.value === null) fail('FORBIDDEN_BY_RULE', `Résultat inconnu : ${result.unavailableReason}`, { metric: RESULT_METRIC });
  const resultCents = Math.round(result.value * 100);
  const stockBefore = socle.metrics.evaluate(mctx, 'bpm.patrimoineConstitue').value;
  return {
    comp,
    cycle,
    period,
    mctx,
    result,
    preview: {
      periodKey: period.key,
      periodLabel: period.label,
      capitalizationDate: period.end,
      resultCents,
      result: resultCents / 100,
      formula: result.formula,
      parameter: result.parameter,
      explanation: result.explanation,
      stockBefore,
      stockAfter: stockBefore === null ? null : Math.round(stockBefore * 100 + resultCents) / 100,
      conditions: ['Période terminée', 'Périodes précédentes closes', 'Résultat connu', 'Capitalisation unique, même si le résultat est nul ou négatif'],
    },
  };
}


/** Clôture antérieure à l'instantané des chiffres : seul le résultat capitalisé est enregistré. */
export function legacyResultFigure(closure, current) {
  const c = closure.calculation ?? {};
  return { key: RESULT_METRIC, label: current.label, unit: current.unit, status: 'ok', value: closure.resultCents / 100, formula: c.formula ?? null, parameter: c.parameter ?? null, explanation: c.explanation ?? null, inputs: c.inputs ?? [] };
}

/** Objets sources d'une explication, à toute profondeur (variables et métriques imbriquées). */
export function collectSources(inputs) {
  return inputs.flatMap((i) => [...(i.sources ?? []), ...collectSources(i.inputs ?? [])]);
}

