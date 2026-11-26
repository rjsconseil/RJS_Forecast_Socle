// Actions du cycle (page « Clôture du cycle ») : tout ce que l'utilisateur a enregistré sur Astra pendant la vie d'un
// cycle et qui touche ce cycle, classé par catégorie, avec le contexte qui permet de comprendre ce qui a été fait.
// La clôture fige cette liste dans la clôture du cycle (historisation).
//
// Sources :
// - le journal du socle : une entrée par commande validée (heure, commande, user, objets créés et modifiés). Il ne
//   garde que les dernières commandes de tous les users : son début peut ne pas couvrir tout le cycle ;
// - avant le début du journal, les marques des objets (création : `provenance`, dernière modification : `lastChange`)
//   reconstituent les actions manquantes (au plus deux par objet).
//
// Une action touche le cycle :
// - pour une écriture datée (mouvement, échéance récurrente), si ses dates tombent dans le cycle, même faite après
//   son dernier jour (règlement en clôture) ;
// - pour un réglage (plafonds, projets, objectifs, cycle), si elle a été faite pendant le cycle.
//
// Catalogue : chaque commande du site qui peut toucher un cycle y est déclarée (objet principal, catégorie, verbe).
// Une nouvelle action du site = une ligne du catalogue. Une commande absente du catalogue paraît dans « Autres
// actions » avec son nom, pour que rien d'enregistré ne manque ; les commandes sans effet sur un cycle (préférences,
// tâches sans argent, réglages techniques) sont écartées.
import { CADENCE_LABEL, occurrenceDates, OVERRUN_REASONS } from '../budget/api.mjs';
import { frDate, sum, fmt } from './format.mjs';

/** Catégories, de la plus proche de l'argent du cycle à la plus lointaine. */
export const ACTION_CATEGORIES = [
  { key: 'daily', label: 'Argent du quotidien', part: 'quotidien', text: 'Dépenses et entrées saisies, prévisions, règlements, échéances écartées et annulations du budget du projet de vie.' },
  { key: 'projects', label: 'Projets de la vie', part: 'projets', text: 'Flux des projets, enveloppes attribuées, parts et retours des tâches, demandes, dépassements et décisions.' },
  { key: 'recurring', label: 'Budget récurrent', part: 'quotidien', text: 'Échéances récurrentes définies, modifiées ou supprimées dont des occurrences tombent dans le cycle.' },
  { key: 'caps', label: 'Plafonds et postes', part: 'quotidien', text: 'Plafonds des postes, catégories et postes personnels en vigueur pendant le cycle.' },
  { key: 'wealth', label: 'Cap et patrimoine', part: 'patrimoine', text: 'Objectifs datés, vision et point de départ du patrimoine.' },
  { key: 'cycle', label: 'Cycle et clôture', part: 'patrimoine', text: 'Clôture du cycle précédent, ancrage du cycle, décisions de clôture.' },
  { key: 'other', label: 'Autres actions', part: null, text: 'Actions enregistrées que le suivi de clôture ne décrit pas encore.' },
];

/** Commandes sans effet sur un cycle : préférences d'affichage, tâches sans argent, réglages techniques. */
const IGNORED = new Set([
  'saveCalendarPreferences', 'configureNavigation', 'changeTaskStatus', 'createBpmTask', 'createTask', 'updateTask', 'updateCoreProject',
  'createCoreProject', 'updateUser', 'createUser', 'prepareComposition', 'setParameter', 'resetParameter',
]);

const COLLECTIONS = {
  operation: 'operations', recurrence: 'recurrences', budget: 'budgets', taskBudgetRequest: 'taskBudgetRequests', projectOverrun: 'projectOverruns',
  lifeGoal: 'lifeGoals', patrimoine: 'patrimoines', cycleLink: 'cycleLinks', closure: 'closures', chargeCategory: 'chargeCategories',
  costCenter: 'costCenters', coreProject: 'coreProjects', bpmComposition: 'bpmCompositions',
};
/** Jour local d'un horodatage. */
const dayOf = (iso) => (iso ? new Date(iso).toLocaleDateString('sv-SE') : null);
const humanize = (command) => command.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/^./, (c) => c.toUpperCase());

const isPlannedEntry = (o) => (o.entryStatus ? o.entryStatus === 'planned' : o.status !== 'realized' || !!o.closedAt || o.lastChange?.command === 'realizeOperation');
const DECIDED = {
  overrun: { approved: 'autorisé', refused: 'refusé', cancelled: 'annulé', billed: 'autorisé et consolidé', pending: 'en attente' },
  request: { approved: 'accordée', refused: 'refusée', cancelled: 'annulée', pending: 'en attente', 'awaiting-life': 'transmise au budget de vie' },
};

/**
 * Catalogue des commandes du site qui touchent un cycle : objet principal, catégorie, verbe (ce qui a été fait).
 * `dated` : l'effet suit les dates de l'objet (sinon, l'action compte dans le cycle où elle a été faite).
 */
const opCategory = (o, x) => (o.budgetId === x.lifeBudgetId ? 'daily' : 'projects');
const recCategory = (r, x) => (r.budgetId === x.lifeBudgetId ? 'recurring' : 'projects');
const budgetCategory = (b) => (b.role === 'life' ? 'caps' : 'projects');
const CATALOG = {
  createOperation: { kind: 'operation', dated: true, category: opCategory, verb: (o) => (isPlannedEntry(o) ? (o.direction === 'income' ? 'Entrée prévue saisie' : 'Dépense prévue saisie') : o.direction === 'income' ? 'Entrée reçue saisie' : 'Dépense payée saisie') },
  updateOperation: { kind: 'operation', dated: true, category: opCategory, verb: () => 'Saisie modifiée' },
  realizeOperation: { kind: 'operation', dated: true, category: opCategory, verb: (o) => (o.direction === 'income' ? 'Prévision reçue' : 'Prévision réglée') },
  cancelRealization: { kind: 'operation', dated: true, category: opCategory, verb: () => 'Règlement annulé' },
  cancelOperation: { kind: 'operation', dated: true, category: opCategory, verb: () => 'Saisie annulée' },
  settleOccurrence: { kind: 'operation', dated: true, category: opCategory, verb: (o) => (o.direction === 'income' ? 'Échéance reçue' : 'Échéance réglée') },
  skipOccurrence: { kind: 'operation', dated: true, category: opCategory, verb: () => 'Échéance écartée' },
  restoreOccurrence: { kind: 'operation', dated: true, category: opCategory, verb: () => 'Échéance rétablie' },
  createRecurrence: { kind: 'recurrence', dated: true, category: recCategory, verb: () => 'Échéance récurrente définie' },
  updateRecurrence: { kind: 'recurrence', dated: true, category: recCategory, verb: () => 'Définition récurrente modifiée' },
  cancelRecurrence: { kind: 'recurrence', dated: true, category: recCategory, verb: () => 'Définition récurrente supprimée' },
  setCaps: { kind: 'budget', category: budgetCategory, verb: (b) => (b.role === 'life' ? 'Plafonds des postes fixés' : 'Plafonds du projet fixés') },
  createChargeCategory: { kind: 'chargeCategory', category: 'caps', verb: () => 'Catégorie de charges créée' },
  updateChargeCategory: { kind: 'chargeCategory', category: 'caps', verb: () => 'Catégorie de charges modifiée' },
  addCustomCostCenter: { kind: 'costCenter', category: 'caps', verb: () => 'Poste personnel ajouté' },
  createBpmProject: { kind: 'budget', category: 'projects', verb: () => 'Projet de la vie créé' },
  createLifeProject: { kind: 'budget', category: 'projects', verb: () => 'Projet de la vie créé' },
  setupProject: { kind: 'budget', category: 'projects', verb: () => 'Projet de la vie préparé' },
  adoptProject: { kind: 'budget', category: 'projects', verb: () => 'Projet rattaché au budget de vie' },
  allocateProjectBudget: { kind: 'budget', category: 'projects', verb: () => 'Enveloppe attribuée' },
  setTaskShare: { kind: 'budget', category: 'projects', verb: () => 'Part de budget d’une tâche fixée' },
  releaseTaskShare: { kind: 'budget', category: 'projects', verb: () => 'Part de budget d’une tâche libérée' },
  setTaskReturn: { kind: 'budget', category: 'projects', verb: () => 'Retour attendu d’une tâche fixé' },
  abandonProject: { kind: 'budget', category: 'projects', verb: () => 'Projet abandonné' },
  resumeProject: { kind: 'budget', category: 'projects', verb: () => 'Projet repris' },
  requestTaskBudget: { kind: 'taskBudgetRequest', category: 'projects', verb: () => 'Part de budget demandée' },
  decideTaskBudget: { kind: 'taskBudgetRequest', category: 'projects', verb: (x) => `Demande ${DECIDED.request[x.status] ?? 'décidée'}` },
  requestProjectOverrun: { kind: 'projectOverrun', category: 'projects', verb: () => 'Dépassement demandé' },
  decideProjectOverrun: { kind: 'projectOverrun', category: 'projects', verb: (x) => `Dépassement ${DECIDED.overrun[x.status] ?? 'décidé'}` },
  billProjectOverruns: { kind: 'projectOverrun', category: 'projects', verb: () => 'Dépassements consolidés dans l’enveloppe' },
  createGoal: { kind: 'lifeGoal', category: 'wealth', verb: () => 'Objectif daté créé' },
  updateGoal: { kind: 'lifeGoal', category: 'wealth', verb: () => 'Objectif daté modifié' },
  removeGoal: { kind: 'lifeGoal', category: 'wealth', verb: () => 'Objectif daté retiré' },
  updateVision: { kind: 'bpmComposition', category: 'wealth', verb: () => 'Vision et cap modifiés' },
  updatePatrimoine: { kind: 'patrimoine', category: 'wealth', verb: () => 'Point de départ du patrimoine modifié' },
  configureCycle: { kind: 'cycleLink', category: 'cycle', verb: () => 'Ancrage du cycle fixé' },
  closingDecision: { kind: 'cycleLink', category: 'cycle', verb: () => 'Décision de clôture (report ou compte vérifié)' },
  closePeriod: { kind: 'closure', category: 'cycle', verb: () => 'Cycle précédent clôturé' },
  finalizeClosing: { kind: 'closure', category: 'cycle', verb: () => 'Cycle précédent clôturé' },
};
/** « de Novembre », « d’Octobre ». */
const de = (label = '') => (/^[aeiouyàâéèêîïôûAEIOUYÀÂÉÈÊÎÏÔÛ]/.test(label) ? `d’${label}` : `de ${label}`);

/**
 * Actions du cycle `period` pour `userId`, lues sur `state` (stockage ou brouillon d'écriture).
 * @param x { lifeBudgetId, projectBudgetIds, lineView, anchorDay, now }
 */
export function cycleActions(state, userId, period, x) {
  const owned = (o) => o && o.userId === userId;
  const scopeBudgets = new Set([x.lifeBudgetId, ...x.projectBudgetIds]);
  const find = (id) => {
    for (const [kind, col] of Object.entries(COLLECTIONS)) {
      const o = state[col]?.[id];
      if (o) return { kind, o };
    }
    return null;
  };
  const projectName = (budgetId) => {
    const b = state.budgets[budgetId];
    return b?.role === 'standard' ? state.coreProjects?.[b.coreProjectId]?.title ?? b.name : null;
  };
  const inPeriod = (d) => !!d && d >= period.start && d <= period.end;

  /** L'objet relève-t-il du budget de vie de l'utilisateur et de ses projets, et touche-t-il le cycle ? */
  function touches(spec, kind, o, actionDay) {
    if (kind === 'operation') return scopeBudgets.has(o.budgetId) && (inPeriod(o.date) || inPeriod(o.realizedDate) || inPeriod(o.accountingDate));
    if (kind === 'recurrence') return scopeBudgets.has(o.budgetId) && occurrenceDates(o, period.start, period.end).length > 0 && actionDay >= period.start;
    if (kind === 'budget' && !scopeBudgets.has(o.id)) return false;
    return actionDay >= period.start && actionDay <= period.end;
  }

  /** Contexte d'une action : ce sur quoi elle porte, son montant, où le retrouver. */
  function describe(kind, o) {
    switch (kind) {
      case 'operation': {
        const view = x.lineView(state, { id: o.id, budgetId: o.budgetId, recurrenceId: o.recurrenceId ?? null, costCenterId: o.costCenterId, standardCostCenter: o.standardCostCenter, categoryId: o.categoryId ?? null, taskId: o.taskId ?? null, settled: o.status === 'realized' });
        const project = o.budgetId === x.lifeBudgetId ? null : projectName(o.budgetId);
        const when = o.status === 'realized' ? `${o.direction === 'income' ? 'reçue' : 'payée'} le ${frDate(o.realizedDate)}` : o.status === 'cancelled' ? `prévue le ${frDate(o.date)}, ${o.recurrenceId ? 'écartée' : 'annulée'}` : `prévue le ${frDate(o.date)}`;
        const settled = o.status === 'realized';
        return {
          label: o.label,
          detail: [project, view.costCenterLabel, when, o.carriedFrom ? `reportée du ${frDate(o.carriedFrom.date)}` : null].filter(Boolean).join(' · '),
          amountCents: settled ? o.realizedAmountCents : o.amountCents,
          direction: o.direction,
          effect: o.status === 'cancelled' ? 'none' : settled ? 'realized' : 'planned',
          target: { kind: 'line', id: o.id, coreProjectId: project ? state.budgets[o.budgetId]?.coreProjectId ?? null : null },
        };
      }
      case 'recurrence': {
        const view = x.lineView(state, { id: o.id, budgetId: o.budgetId, recurrenceId: null, costCenterId: o.costCenterId, standardCostCenter: o.standardCostCenter, categoryId: o.categoryId ?? null, taskId: o.taskId ?? null, settled: false });
        const n = occurrenceDates(o, period.start, period.end).length;
        const project = o.budgetId === x.lifeBudgetId ? null : projectName(o.budgetId);
        return {
          label: o.label,
          detail: [project, CADENCE_LABEL[o.cadence] ?? o.cadence, view.costCenterLabel, `${n} échéance${n > 1 ? 's' : ''} dans le cycle`, o.cancelledAt ? 'supprimée' : o.endDate ? `jusqu’au ${frDate(o.endDate)}` : null].filter(Boolean).join(' · '),
          amountCents: o.amountCents,
          direction: o.direction,
          effect: o.cancelledAt ? 'none' : 'planned',
          target: { kind: 'recurring', id: o.id, coreProjectId: project ? state.budgets[o.budgetId]?.coreProjectId ?? null : null },
        };
      }
      case 'budget': {
        if (o.role === 'life') {
          const caps = Object.values(o.capsCents ?? {});
          return { label: 'Plafonds des postes', detail: `${caps.length} poste${caps.length > 1 ? 's' : ''} plafonné${caps.length > 1 ? 's' : ''}${caps.length ? ` · ${fmt(caps.reduce((t, c) => t + c, 0))} au total` : ''}`, amountCents: null, direction: null, effect: 'setting', target: { kind: 'caps' } };
        }
        const name = projectName(o.id) ?? o.name;
        const allocated = Number.isInteger(o.allocationCents) ? `enveloppe ${fmt(o.allocationCents)} attribuée le ${frDate(o.allocationDate)}` : 'sans enveloppe';
        return { label: name, detail: [allocated, o.fundingSource === 'patrimoine' ? 'financé par le patrimoine' : 'financé par le cycle', o.abandonedAt ? 'abandonné' : null].filter(Boolean).join(' · '), amountCents: o.allocationCents ?? null, direction: 'charge', effect: 'setting', target: { kind: 'project', coreProjectId: o.coreProjectId } };
      }
      case 'taskBudgetRequest':
      case 'projectOverrun': {
        const b = state.budgets[o.budgetId];
        const task = o.taskId ? state.tasks?.[o.taskId]?.title ?? null : null;
        const status = DECIDED[kind === 'projectOverrun' ? 'overrun' : 'request'][o.status] ?? o.status;
        return {
          label: task ?? (kind === 'projectOverrun' ? 'Dépassement du projet' : 'Part de budget'),
          detail: [projectName(o.budgetId), kind === 'projectOverrun' ? OVERRUN_REASONS[o.reason] : null, `demandé${kind === 'taskBudgetRequest' ? 'e' : ''} le ${frDate(o.requestedAt)}`, status].filter(Boolean).join(' · '),
          amountCents: o.amountCents,
          direction: 'charge',
          effect: 'decision',
          target: { kind: 'project', coreProjectId: b?.coreProjectId ?? null },
        };
      }
      case 'lifeGoal':
        return { label: o.label, detail: [`${fmt(o.targetTodayCents ?? 0)} visés au ${frDate(o.date)}`, o.removed ? 'retiré' : null].filter(Boolean).join(' · '), amountCents: o.targetTodayCents ?? null, direction: null, effect: 'setting', target: { kind: 'goals' } };
      case 'bpmComposition':
        return { label: 'Vision et cap', detail: 'Cap d’épargne et projection du patrimoine', amountCents: null, direction: null, effect: 'setting', target: { kind: 'goals' } };
      case 'patrimoine':
        return { label: 'Patrimoine', detail: 'Point de départ et stock d’ouverture', amountCents: null, direction: null, effect: 'setting', target: { kind: 'patrimoine' } };
      case 'cycleLink':
        return { label: 'Cycle budgétaire', detail: `Cycle mensuel ancré au ${x.anchorDay ?? 1}`, amountCents: null, direction: null, effect: 'setting', target: { kind: 'cycle' } };
      case 'chargeCategory':
        return { label: o.label ?? 'Catégorie de charges', detail: 'Catégorie d’un poste de charges', amountCents: null, direction: 'charge', effect: 'setting', target: { kind: 'caps' } };
      case 'costCenter':
        return { label: o.label ?? 'Poste personnel', detail: o.direction === 'income' ? 'Poste d’entrées' : 'Poste de charges', amountCents: null, direction: o.direction ?? null, effect: 'setting', target: { kind: 'caps' } };
      case 'closure':
        return { label: `Clôture ${de(o.periodLabel)}`, detail: `résultat capitalisé dans le patrimoine${o.journey?.deferred?.length ? ` · ${o.journey.deferred.length} point${o.journey.deferred.length > 1 ? 's' : ''} reporté${o.journey.deferred.length > 1 ? 's' : ''}` : ''}`, amountCents: o.resultCents ?? null, direction: (o.resultCents ?? 0) < 0 ? 'charge' : 'income', effect: 'closure', target: { kind: 'bilan', periodKey: o.periodKey } };
      default:
        return { label: kind, detail: null, amountCents: null, direction: null, effect: 'setting', target: null };
    }
  }

  /** Une action brute (commande, heure, objets) → une action décrite, ou null si elle ne touche pas le cycle. */
  function actionOf({ command, at, ids, source }) {
    if (IGNORED.has(command)) return null;
    const spec = CATALOG[command];
    const actionDay = dayOf(at);
    if (!spec) {
      if (actionDay < period.start || actionDay > period.end) return null;
      return { category: 'other', command, verb: humanize(command), at, source, label: humanize(command), detail: null, amountCents: null, direction: null, effect: 'setting', target: null, objectId: ids[0] ?? null };
    }
    const hit = ids.map(find).find((f) => f && f.kind === spec.kind && owned(f.o));
    if (!hit || !touches(spec, hit.kind, hit.o, actionDay)) return null;
    const category = typeof spec.category === 'function' ? spec.category(hit.o, x) : spec.category;
    return { category, command, verb: spec.verb(hit.o), at, source, objectId: hit.o.id, ...describe(hit.kind, hit.o) };
  }

  // 1. Le journal, pour ce user.
  const journal = state.journal ?? [];
  const journalFrom = journal[0]?.at ?? null;
  const raw = journal
    .filter((e) => e.userId === userId && e.outcome !== 'failed' && dayOf(e.at) >= period.start)
    .map((e) => ({ command: e.command, at: e.at, ids: [...(e.created ?? []), ...(e.updated ?? [])], source: 'journal' }));

  // 2. Avant le début du journal : création et dernière modification de chaque objet du user.
  const complete = !journalFrom || dayOf(journalFrom) <= period.start;
  if (!complete) {
    for (const col of Object.values(COLLECTIONS)) {
      for (const o of Object.values(state[col] ?? {})) {
        if (!owned(o)) continue;
        for (const mark of [o.provenance, o.lastChange]) {
          if (!mark?.command || !mark.at || mark.at >= journalFrom || dayOf(mark.at) < period.start) continue;
          raw.push({ command: mark.command, at: mark.at, ids: [o.id], source: 'objects' });
        }
      }
    }
  }

  // Une action par commande, objet et jour : les répétitions (plafonds réglés plusieurs fois) se comptent.
  const grouped = new Map();
  for (const r of raw) {
    const a = actionOf(r);
    if (!a) continue;
    const key = `${a.command}|${a.objectId}|${dayOf(a.at)}`;
    const g = grouped.get(key);
    if (g) {
      g.count += 1;
      if (a.at > g.at) Object.assign(g, { ...a, count: g.count, firstAt: g.firstAt });
      else g.firstAt = a.at < g.firstAt ? a.at : g.firstAt;
    } else grouped.set(key, { ...a, count: 1, firstAt: a.at });
  }
  const items = [...grouped.values()].sort((a, z) => z.at.localeCompare(a.at));
  const categories = ACTION_CATEGORIES.map((c) => {
    const its = items.filter((i) => i.category === c.key);
    return {
      ...c,
      count: sum(its, (i) => i.count),
      entries: its.length,
      realizedCents: sum(its.filter((i) => i.effect === 'realized'), (i) => (i.direction === 'income' ? i.amountCents : -(i.amountCents ?? 0))),
      lastAt: its[0]?.at ?? null,
      items: its,
    };
  }).filter((c) => c.key !== 'other' || c.count);
  return {
    total: sum(items, (i) => i.count),
    entries: items.length,
    lastAt: items[0]?.at ?? null,
    firstAt: items.at(-1)?.firstAt ?? null,
    source: { journalFrom, complete },
    categories,
  };
}


/** Forme compacte gardée dans la clôture (historisation des actions du cycle). */
export function actionsSnapshot(actions) {
  return {
    total: actions.total,
    entries: actions.entries,
    complete: actions.source.complete,
    categories: actions.categories.map((c) => ({ key: c.key, label: c.label, count: c.count })),
    items: actions.categories.flatMap((c) => c.items.map((i) => ({ category: i.category, verb: i.verb, label: i.label, detail: i.detail, at: i.at, count: i.count, amountCents: i.amountCents ?? null, direction: i.direction ?? null }))),
  };
}
