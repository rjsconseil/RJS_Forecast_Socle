// Budget/Patrimoine Management (niveau 3, application). Compose les middlewares Budget et
// Patrimoine sur le noyau : création du user et de son triplet, projets de la vie, cycle et
// clôtures, parcours métier. Chaque chiffre présenté est une métrique dont la formule est
// administrée (`metric.<clé>`) et dont l'explication remonte jusqu'aux objets sources.
import { fail } from '../../socle/errors.mjs';
import { check } from '../../socle/object-management/inspect.mjs';
import { date, expectedRevisionOf, integer, money, oneOf, text } from '../../socle/validation.mjs';
import { CADENCES } from '../budget/recurrence.mjs';
import { createReads, DEFAULT_VISION, percent } from './reads.mjs';
import { GOAL_TYPES } from './projection.mjs';
import { createProjects, cycleChecks, inRegime, projectBudget, projectExtensions, projectVariables } from './projects.mjs';
import { cycleBounds, dayBefore, indexOfKey, periodByIndex, periodByKey, periodsPage, today } from './periods.mjs';

const RESULT_METRIC = 'bpm.resultatPeriode';

const METRICS = [
  // Synthèse de la période : réalisé (date réelle de règlement) et restant (date prévue, non réglé)
  { key: 'bpm.revenus', label: 'Reçu', unit: 'EUR', group: 'Période', formula: 'budget.revenusRealises', description: 'Revenus effectivement reçus, datés dans la période (date réelle).' },
  { key: 'bpm.charges', label: 'Dépensé', unit: 'EUR', group: 'Période', formula: 'budget.chargesRealisees + projets.chargesReglees', description: 'Dépenses effectivement payées, datées dans la période (date réelle) : celles du budget de vie et les charges des projets de la vie validées comme réglées (charges spéciales, jamais comptées avant validation).' },
  { key: 'bpm.chargesProjets', label: 'Projets de la vie · réglé validé', unit: 'EUR', group: 'Période', formula: 'projets.chargesReglees', description: 'Charges des projets de la vie validées comme réglées pour leurs besoins, datées dans la période (date réelle). Elles font partie du Dépensé.' },
  { key: RESULT_METRIC, label: 'Reste réel', unit: 'EUR', group: 'Période', formula: 'bpm.revenus - bpm.charges', description: 'Net réalisé = reçu − payé. Résultat signé capitalisé dans le Patrimoine à la clôture.' },
  { key: 'bpm.resteARecevoir', label: 'À recevoir', unit: 'EUR', group: 'Période', formula: 'budget.resteARecevoir', description: 'Revenus prévus dans la période et pas encore reçus.' },
  { key: 'bpm.resteAPayer', label: 'À payer', unit: 'EUR', group: 'Période', formula: 'budget.resteAPayer', description: 'Dépenses prévues dans la période et pas encore payées.' },
  { key: 'bpm.soldeAttendu', label: 'Solde prévu à la clôture', unit: 'EUR', group: 'Période', formula: 'bpm.resultatPeriode + bpm.resteARecevoir - bpm.resteAPayer', description: 'Net réalisé + revenus restant à recevoir − dépenses restant à payer (C04). Une échéance déjà réglée ne compte pas une seconde fois.' },
  { key: 'bpm.tauxEpargne', label: "Taux d'épargne", unit: '%', decimals: 1, group: 'Période', formula: 'pourcentage(bpm.resultatPeriode, bpm.revenus)', description: 'Part des revenus reçus conservée sur la période.' },
  // Budget initial : référence distincte du solde attendu
  { key: 'bpm.revenusPrevus', label: 'Revenus prévus (initial)', unit: 'EUR', group: 'Budget initial', formula: 'budget.revenusPrevus', description: 'Montants prévus des revenus datés dans la période, réglés ou non.' },
  { key: 'bpm.chargesPrevues', label: 'Charges prévues (initial)', unit: 'EUR', group: 'Budget initial', formula: 'budget.chargesPrevues', description: 'Montants prévus des charges datées dans la période, réglées ou non.' },
  { key: 'bpm.resultatPrevu', label: 'Budget initial', unit: 'EUR', group: 'Budget initial', formula: 'bpm.revenusPrevus - bpm.chargesPrevues', description: 'Solde du budget prévisionnel initial (montants prévus). Référence, distincte du solde attendu.' },
  { key: 'bpm.ecartResultat', label: 'Écart au budget initial', unit: 'EUR', group: 'Budget initial', formula: 'bpm.soldeAttendu - bpm.resultatPrevu', description: 'Solde attendu moins budget initial.' },
  { key: 'bpm.consommationCharges', label: 'Charges consommées', unit: '%', decimals: 0, group: 'Budget initial', formula: 'pourcentage(budget.chargesRealisees, bpm.chargesPrevues)', description: 'Dépenses payées du budget de vie rapportées à ses charges prévues (les charges des projets, comptées à leur validation, n’ont pas de prévu dans le budget de vie).' },
  // Patrimoine
  { key: 'bpm.patrimoineConstitue', label: 'Stock enregistré', unit: 'EUR', group: 'Patrimoine', formula: 'patrimoine.stockOuverture + patrimoine.resultatsCapitalises', description: "Stock d'ouverture et résultats capitalisés avant le début de la période (C09 [P]). La période lue n'y est pas encore incluse." },
  { key: 'bpm.patrimoineFinPeriode', label: 'Estimation après la période', unit: 'EUR', group: 'Patrimoine', formula: 'bpm.patrimoineConstitue + bpm.resultatPeriode', description: "Stock enregistré + effet signé de la période (une seule fois)." },
  { key: 'bpm.progressionObjectif', label: "Atteinte de l'objectif", unit: '%', decimals: 0, group: 'Patrimoine', formula: 'pourcentage(bpm.patrimoineConstitue, patrimoine.objectif)', description: 'Stock enregistré rapporté à l’objectif de stock (C10 [P]).' },
  { key: 'bpm.resteObjectif', label: "Reste pour l'objectif", unit: 'EUR', group: 'Patrimoine', formula: 'max(patrimoine.objectif - bpm.patrimoineConstitue, 0)', description: "Montant restant à constituer pour atteindre l'objectif de stock." },
];

const DEFAULT_DASHBOARD = [
  { id: 'periode', title: 'Synthèse de la période', metrics: ['bpm.revenus', 'bpm.charges', RESULT_METRIC, 'bpm.soldeAttendu', 'bpm.resteARecevoir', 'bpm.resteAPayer'] },
  { id: 'initial', title: 'Budget initial', metrics: ['bpm.resultatPrevu', 'bpm.ecartResultat', 'bpm.revenusPrevus', 'bpm.chargesPrevues', 'bpm.consommationCharges', 'bpm.tauxEpargne'] },
  { id: 'patrimoine', title: 'Patrimoine', metrics: ['bpm.patrimoineConstitue', 'bpm.patrimoineFinPeriode', 'bpm.progressionObjectif', 'bpm.resteObjectif'] },
];

const compositionOf = (state, userId) => Object.values(state.bpmCompositions).find((c) => c.userId === userId) ?? null;
const cycleOf = (state, compositionId) => Object.values(state.cycleLinks).find((c) => c.bpmCompositionId === compositionId) ?? null;
const closuresOf = (state, cycleId) => Object.values(state.closures).filter((c) => c.cycleLinkId === cycleId).sort((a, b) => a.periodStart.localeCompare(b.periodStart));

/**
 * Liaison de cycle : mensuelle [P] ; active dès que le jour d'ancrage est connu.
 * `startField` : nom du champ tel que l'appelant l'a envoyé (erreur rendue par champ, C09).
 */
function cycleFields({ anchorDay, startDate }, startField = 'cycleStartDate') {
  const day = integer('anchorDay', anchorDay, { min: 1, max: 28, nullable: true });
  const start = date(startField, startDate);
  return { frequency: 'monthly', anchorDay: day, startDate: day === null ? start : start ?? today(), state: day === null ? 'to_configure' : 'active' };
}

/**
 * État de préparation BPM d'un user (C06), en lecture seule : exactement un Budget « Projet de vie »,
 * un Patrimoine, une composition et une liaison de cycle. Rien n'est créé pendant un diagnostic.
 */
function preparationOf(state, userId) {
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

const periodStatus = (p, now, closure) => (closure ? 'closed' : p.end < now ? 'ended' : p.start > now ? 'future' : 'current');

/**
 * État du cycle sans énumération (C10) : bornes, clôtures par clé, première période ouverte
 * (les clôtures sont séquentielles : celle qui suit la dernière close).
 */
function cycleState(state, cycle, now = today()) {
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
function metricContext(state, userId, socle, { periodKey } = {}) {
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
 * Contrat commun de la clôture (C02) : conditions et montant qui sera effectivement capitalisé.
 * La confirmation affichée et la commande utilisent exactement ce calcul.
 */
function closingContract(state, userId, socle, periodKey) {
  const comp = compositionOf(state, userId);
  if (!comp) fail('NOT_FOUND', 'Ce user n’a pas de composition BPM.');
  const cycle = cycleOf(state, comp.id);
  const cs = cycleState(state, cycle);
  if (!cs) fail('FORBIDDEN_BY_RULE', 'Le cycle est à configurer : aucune période à clôturer.');
  const period = cs.find(periodKey);
  if (!period) fail('NOT_FOUND', 'Période inconnue pour ce cycle.', { periodKey });
  if (period.status === 'closed') fail('UNIQUENESS_VIOLATION', 'Cette période est déjà close.', { periodKey: period.key, closureId: period.closureId });
  if (period.status !== 'ended') fail('FORBIDDEN_BY_RULE', 'Seule une période terminée peut être close.', { periodKey: period.key, end: period.end });
  if (cs.firstOpen.key !== period.key) fail('FORBIDDEN_BY_RULE', `Les périodes se clôturent dans l'ordre : clôturer d'abord ${cs.firstOpen.label} [P].`, { periodKey: cs.firstOpen.key });
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

export default {
  id: 'bpm',
  label: 'Budget/Patrimoine Management',
  level: 3,
  dependsOn: ['users', 'core', 'budget', 'patrimoine'],
  kinds: {
    bpmComposition: {
      collection: 'bpmCompositions',
      prefix: 'bpm',
      label: 'Composition BPM',
      references: { budgetId: { kind: 'budget', required: true }, patrimoineId: { kind: 'patrimoine', required: true }, coreProjectId: { kind: 'coreProject', required: true } },
    },
    cycleLink: { collection: 'cycleLinks', prefix: 'cyc', label: 'Liaison de cycle', references: { bpmCompositionId: { kind: 'bpmComposition', required: true } } },
    closure: {
      collection: 'closures',
      prefix: 'clo',
      label: 'Clôture de période',
      references: {
        cycleLinkId: { kind: 'cycleLink', required: true },
        budgetId: { kind: 'budget', required: true },
        patrimoineId: { kind: 'patrimoine', required: true },
        capitalizationId: { kind: 'capitalization' },
      },
    },
    lifeGoal: { collection: 'lifeGoals', prefix: 'obj', label: 'Objectif de projection' },
    projectOverrun: {
      collection: 'projectOverruns',
      prefix: 'ovr',
      label: 'Dépassement de projet',
      references: { budgetId: { kind: 'budget', required: true }, taskId: { kind: 'task' }, taskBudgetRequestId: { kind: 'taskBudgetRequest' } },
    },
    taskBudgetRequest: {
      collection: 'taskBudgetRequests',
      prefix: 'dmt',
      label: 'Demande de montant d’une tâche',
      references: { budgetId: { kind: 'budget', required: true }, taskId: { kind: 'task', required: true }, overrunId: { kind: 'projectOverrun' } },
    },
  },

  parameters: [
    {
      key: 'bpm.tableauDeBord',
      label: 'Sections du tableau de bord',
      group: 'Application BPM',
      type: 'list',
      description: 'Sections et chiffres présentés sur le tableau de bord, dans l’ordre. Chaque chiffre est une métrique administrable.',
      default: DEFAULT_DASHBOARD,
      validate(value, state, socle) {
        for (const s of value) {
          if (typeof s?.title !== 'string' || !Array.isArray(s.metrics) || !s.metrics.length) fail('VALIDATION', 'Chaque section a un titre et au moins un chiffre.');
          for (const k of s.metrics) if (!socle.metrics.metrics.has(k)) fail('VALIDATION', `Chiffre inconnu : ${k}.`, { metric: k });
        }
      },
    },
  ],

  variables: projectVariables,

  metrics: METRICS,

  extensions: {
    metricContext,
    // Projets de la vie : garde de rattachement, retour à la complétion, autorisation de dépassement.
    ...projectExtensions,

    /** Parcours métier BPM appliqués aux projets noyau (contrat J1 §8 : guident, n'interdisent pas le stockage). */
    coreProjectContext(state, projectId, socle, acc) {
      const kind = acc.enrichment?.kind;
      if (kind === 'life') {
        const comp = Object.values(state.bpmCompositions).find((c) => c.coreProjectId === projectId);
        return {
          enrichment: { bpmCompositionId: comp?.id ?? null },
          pathways: { canAddTask: false, isTaskDestination: false, tasksCanChangeProject: false, note: 'Racine principale consultable : le travail passe par un projet de la vie. Aucune création métier directe de tâche.' },
        };
      }
      if (kind === 'standard') {
        return {
          pathways: {
            canAddTask: true,
            isTaskDestination: true,
            tasksCanChangeProject: true,
            note: 'Projet de la vie budgétisé : une tâche qui porte une part de budget, une dépense ou un retour ne change de projet qu’une fois ces données retirées.',
          },
        };
      }
      return {};
    },

    taskContext(state, task, socle) {
      if (!task.projectId) return null;
      const e = socle.modules.core.contextOf(state, task.projectId).enrichment;
      if (e?.kind === 'standard') return { qualification: { code: 'budgetedProjectTask', label: "Tâche d'un projet budgétisé", budgetIdDerived: e.budgetId } };
      if (e?.kind === 'life') return { qualification: { code: 'principalRootTask', label: 'Reliée à la racine principale (hors parcours métier)', budgetIdDerived: e.budgetId } };
      return null;
    },

    /** Une période close est figée [P] : aucune opération du Budget « Projet de vie » n'y entre ni n'en sort. */
    operationGuard(state, { userId, budgetId, dates }) {
      const comp = compositionOf(state, userId);
      if (!comp || comp.budgetId !== budgetId) return;
      const cycle = cycleOf(state, comp.id);
      for (const c of closuresOf(state, cycle?.id)) {
        const d = dates.find((x) => x >= c.periodStart && x <= c.periodEnd);
        if (d) fail('PERIOD_CLOSED', `La période ${c.periodLabel} est close : opération refusée (${d}).`, { periodKey: c.periodKey, closureId: c.id, date: d });
      }
    },

    userSummary(state, user) {
      const comp = compositionOf(state, user.id);
      // Nombre d'entrées budgétaires (opérations et définitions récurrentes) : le site ouvre par défaut sur un user qui en a.
      const entryCount = [state.operations, state.recurrences ?? {}].reduce((n, c) => n + Object.values(c).filter((o) => o.userId === user.id).length, 0);
      return { bpmCompositionId: comp?.id ?? null, principalBudgetId: comp?.budgetId ?? null, cycleState: comp ? cycleOf(state, comp.id)?.state ?? null : null, bpmPreparation: preparationOf(state, user.id).status, entryCount };
    },
  },

  compositions: {
    /**
     * Création initiale d'un user, en une seule écriture : user → projet noyau principal →
     * Budget « Projet de vie » → Patrimoine → composition BPM → liaison de cycle.
     */
    initialUserBundle(tx, input, socle) {
      const { users, core, budget, patrimoine } = socle.modules;
      const user = users.buildUser(tx, input);
      tx.userId = user.id;
      const root = core.buildProject(tx, { title: 'Projet de vie', description: 'Racine noyau commune au Budget « Projet de vie » et au Patrimoine.' });
      const life = budget.buildLifeBudget(tx, { coreProjectId: root.id });
      const pat = patrimoine.buildPatrimoine(tx, {
        coreProjectId: root.id,
        principalBudgetId: life.id,
        openingStock: input.openingStock,
        openingDate: input.openingDate ?? (input.openingStock === null || input.openingStock === undefined ? null : today()),
        objective: input.objective,
      });
      const comp = socle.om.create(tx, 'bpmComposition', { label: `BPM de ${user.label}`, budgetId: life.id, patrimoineId: pat.id, coreProjectId: root.id, vision: null });
      const cycle = socle.om.create(tx, 'cycleLink', { bpmCompositionId: comp.id, ...cycleFields({ anchorDay: input.anchorDay, startDate: input.cycleStartDate }) });
      return { userId: user.id, coreProjectId: root.id, budgetId: life.id, patrimoineId: pat.id, bpmCompositionId: comp.id, cycleLinkId: cycle.id };
    },
  },

  migrations: [
    {
      from: ['j1-store/0.2', 'socle-store/0.3', 'socle-store/0.4'],
      id: 'bpm-vision',
      description: 'Hypothèses de projection ajoutées vides à chaque composition (rendement à renseigner) ; aucun objectif créé.',
      apply(draft, tx) {
        return Object.values(draft.bpmCompositions)
          .filter((c) => !('vision' in c))
          .map((c) => {
            c.vision = null;
            tx.updated.push({ kind: 'bpmComposition', id: c.id });
            return `${c.id} : hypothèses à renseigner`;
          });
      },
    },
    {
      from: ['j1-store/0.2', 'socle-store/0.3'],
      id: 'bpm-composition-et-cycle',
      description: 'Composition BPM reliée à sa racine noyau ; liaison de cycle « à configurer » créée si absente (aucune période inventée).',
      apply(draft, tx, socle) {
        const changes = [];
        for (const c of Object.values(draft.bpmCompositions)) {
          if (!c.coreProjectId) {
            c.coreProjectId = draft.budgets[c.budgetId]?.coreProjectId ?? null;
            c.label ??= `BPM de ${draft.users[c.userId]?.label ?? c.userId}`;
            tx.updated.push({ kind: 'bpmComposition', id: c.id });
            changes.push(`${c.id} : coreProjectId = ${c.coreProjectId}`);
          }
          if (!cycleOf(draft, c.id)) {
            const cycle = socle.om.create(tx, 'cycleLink', { bpmCompositionId: c.id, ...cycleFields({ anchorDay: null, startDate: null }) }, { userId: c.userId });
            changes.push(`${cycle.id} : liaison de cycle à configurer pour ${c.id}`);
          }
        }
        return changes;
      },
    },
  ],

  setup(socle) {
    const { om, metrics, parameters } = socle;

    function requireComposition(state, ctx) {
      const userId = om.requireUser(state, ctx);
      const prep = preparationOf(state, userId);
      if (prep.status !== 'ready') {
        fail('FORBIDDEN_BY_RULE', prep.status === 'to-prepare' ? `Espace BPM à préparer : manque ${prep.missing.map((m) => m.label).join(', ')}.` : 'Espace BPM incohérent : voir le diagnostic Object Management.', { userId, preparation: prep });
      }
      const comp = compositionOf(state, userId);
      return { userId, comp, cycle: cycleOf(state, comp.id) };
    }

    function lifeProjects(state, comp) {
      const core = socle.modules.core;
      return om
        .list(state, 'budget', (b) => b.role === 'standard' && b.parentBudgetId === comp.budgetId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((b) => {
          const s = core.projectSummary(state, b.coreProjectId);
          return { budgetId: b.id, name: b.name, coreProjectId: b.coreProjectId, project: s.project, view: s.view };
        });
    }

    function closureView(c) {
      return { ...structuredClone(c), result: c.resultCents / 100 };
    }

    /**
     * Chiffres d'une période (C01) : une période close présente les évaluations ENREGISTRÉES à sa
     * clôture (formule, révision, valeurs, sources), jamais une réévaluation avec la formule courante.
     * Un recalcul comparatif éventuel est rendu séparément (`comparison`).
     */
    function figuresFor(state, userId, keys, { periodKey } = {}) {
      const mctx = metricContext(state, userId, socle, { periodKey });
      const closure = mctx.period?.closureId ? state.closures[mctx.period.closureId] : null;
      if (!closure) return { figures: metrics.evaluateMany(mctx, keys), comparison: [], recorded: false };
      const figures = {};
      const comparison = [];
      for (const k of keys) {
        const current = metrics.evaluate(mctx, k);
        const stored = closure.figures?.[k] ?? (k === RESULT_METRIC ? legacyResultFigure(closure, current) : null);
        if (stored) {
          figures[k] = { ...stored, recorded: true, recordedAt: closure.createdAt, closureId: closure.id };
          if (stored.value !== current.value || stored.formula !== current.formula) {
            comparison.push({ key: k, label: stored.label, recorded: stored.value, recomputed: current.value, recordedFormula: stored.formula, currentFormula: current.formula, currentParameter: current.parameter });
          }
        } else {
          figures[k] = { ...current, recorded: false, note: 'Chiffre non enregistré à la clôture : calculé avec la formule courante.' };
        }
      }
      return { figures, comparison, recorded: true, closure };
    }

    function evaluateFigure(ctx, key, { periodKey } = {}) {
      const state = socle.state;
      const userId = om.requireUser(state, ctx);
      if (!metrics.metrics.has(key)) fail('NOT_FOUND', 'Chiffre inconnu.', { key });
      const { figures, comparison } = figuresFor(state, userId, [key], { periodKey });
      return { ...figures[key], comparison: comparison[0] ?? null };
    }

    function closingOf(state, userId, period, cs) {
      if (!period) return { possible: false, reason: 'Cycle à configurer', preview: null };
      if (period.status === 'closed') return { possible: false, reason: 'Période déjà close', preview: null };
      if (period.status !== 'ended') return { possible: false, reason: `La période n’est pas terminée (fin le ${period.end})`, preview: null };
      try {
        return { possible: true, reason: null, preview: closingContract(state, userId, socle, period.key).preview };
      } catch (err) {
        if (!err.code) throw err;
        return { possible: false, reason: err.message, preview: null, firstOpenKey: cs?.firstOpen.key ?? null };
      }
    }

    const reads = createReads(socle, {
      requireComposition,
      figuresFor,
      metricContext: (state, userId, options) => metricContext(state, userId, socle, options),
      cycleState,
      closuresOf,
    });

    // Projets de la vie : budget attribué, ventilation, dépassements, retours (voir projects.mjs).
    const projects = createProjects(socle, { requireComposition, cycleState });

    /** Hypothèses de vision validées (pourcentages, montants en centimes). */
    function visionFields(current, input = {}) {
      const v = { ...DEFAULT_VISION, ...(current ?? {}) };
      if ('horizonYears' in input) v.horizonYears = integer('horizonYears', input.horizonYears, { min: 1, max: 80 });
      if ('annualReturnPct' in input) v.annualReturnPct = percent('annualReturnPct', input.annualReturnPct, { min: -50, max: 50, nullable: true });
      if ('inflationPct' in input) v.inflationPct = percent('inflationPct', input.inflationPct, { min: -20, max: 50 });
      if ('inflationSource' in input) v.inflationSource = text('inflationSource', input.inflationSource, { max: 200 }) || DEFAULT_VISION.inflationSource;
      if ('contribution' in input) v.contributionCents = money('contribution', input.contribution, { nullable: true, signed: true });
      if ('contributionCadence' in input) v.contributionCadence = oneOf('contributionCadence', input.contributionCadence, CADENCES);
      if ('savingsTarget' in input) v.savingsTargetCents = money('savingsTarget', input.savingsTarget, { nullable: true });
      if ('surplus' in input) {
        const sp = input.surplus;
        v.surplus = sp === null ? null : { targetCents: money('surplus.target', sp?.target, { positive: true }), periods: integer('surplus.periods', sp?.periods, { min: 1, max: 600 }), startKey: /^\d{4}-(0[1-9]|1[0-2])$/.test(sp?.startKey ?? '') ? sp.startKey : fail('VALIDATION', 'Période de départ AAAA-MM attendue.', { field: 'surplus.startKey' }) };
      }
      return v;
    }

    function goalFields(input = {}, i = null) {
      const f = (name) => (i === null ? name : `goals[${i}].${name}`);
      return {
        label: text(f('label'), input.label, { required: true, max: 200 }),
        type: oneOf(f('type'), input.type, Object.keys(GOAL_TYPES)),
        date: date(f('date'), input.date, { required: true }),
        targetTodayCents: money(f('targetToday'), input.targetToday, { positive: true }),
      };
    }

    return {
      compositionOf,
      metricContext: (state, userId, options) => metricContext(state, userId, socle, options),
      reads,
      projects,

      async updateVision(ctx, input = {}) {
        await om.command('updateVision', ctx, input, (tx) => {
          const comp = compositionOf(tx.draft, tx.userId);
          if (!comp) fail('NOT_FOUND', 'Ce user n’a pas de composition BPM.');
          om.checkRevision(comp, expectedRevisionOf(input));
          om.update(tx, comp, { vision: visionFields(comp.vision, input) });
          return { bpmCompositionId: comp.id };
        });
        const comp = compositionOf(socle.state, ctx.userId);
        return { revision: comp.revision, vision: reads.visionOf(comp) };
      },

      goals(ctx) {
        const state = socle.state;
        const userId = om.requireUser(state, ctx);
        return reads.goalsOf(state, userId).map((g) => ({ ...structuredClone(g), typeLabel: GOAL_TYPES[g.type].label }));
      },

      /** Objectif de projection : ne crée ni Budget, ni tâche, ni paiement. */
      async createGoal(ctx, input = {}) {
        const r = await om.command('createGoal', ctx, input, (tx) => ({ goalId: om.create(tx, 'lifeGoal', { ...goalFields(input), removed: false }).id }), { creation: true });
        return { replayed: r.replayed, goal: structuredClone(socle.state.lifeGoals[r.goalId]) };
      },

      async updateGoal(ctx, id, input = {}) {
        await om.command('updateGoal', ctx, input, (tx) => {
          const g = om.owned(tx.draft, 'lifeGoal', id, tx.userId);
          om.checkRevision(g, expectedRevisionOf(input));
          om.update(tx, g, goalFields({ label: g.label, type: g.type, date: g.date, targetToday: g.targetTodayCents / 100, ...input }));
          return { goalId: id };
        });
        return { goal: structuredClone(socle.state.lifeGoals[id]) };
      },

      /** Retrait d'un objectif : conservé dans l'historique (traçabilité), exclu des projections. */
      async removeGoal(ctx, id, input = {}) {
        await om.command('removeGoal', ctx, input, (tx) => {
          const g = om.owned(tx.draft, 'lifeGoal', id, tx.userId);
          om.checkRevision(g, expectedRevisionOf(input));
          om.update(tx, g, { removed: true });
          return { goalId: id };
        });
        return { removed: true, goalId: id };
      },

      /**
       * Partir de zéro (assistant en 7 étapes), en UNE commande rejouable :
       * - `principal` configure l'ensemble existant (aucun deuxième projet de vie ni Patrimoine) ;
       * - `branch` crée un projet de la vie (Budget standard, racine noyau, ≥ 1 tâche), sans Patrimoine.
       * Les lignes du budget type portant un `recurrenceId` sont mises à jour, jamais recréées.
       */
      async setupProject(ctx, input = {}) {
        const r = await om.command(
          'setupProject',
          ctx,
          input,
          (tx) => {
            const comp = compositionOf(tx.draft, tx.userId);
            if (!comp) fail('NOT_FOUND', 'Espace BPM à préparer avant de démarrer un projet.');
            const { core, budget } = socle.modules;
            const mode = oneOf('mode', input.mode, ['principal', 'branch']);
            const project = input.project ?? {};
            let budgetId = comp.budgetId;
            const out = { mode, bpmCompositionId: comp.id, created: [], updated: [] };

            if (mode === 'principal') {
              const root = tx.draft.coreProjects[comp.coreProjectId];
              const patch = {};
              if ('name' in project) patch.title = text('project.name', project.name, { required: true, max: 200 });
              if ('description' in project) patch.description = text('project.description', project.description, { max: 5000 });
              if (Object.keys(patch).length) om.update(tx, root, patch);
              if (input.patrimoine) {
                const p = tx.draft.patrimoines[comp.patrimoineId];
                const pp = {};
                if ('openingStock' in input.patrimoine) pp.openingStockCents = money('patrimoine.openingStock', input.patrimoine.openingStock, { nullable: true, signed: true });
                if ('openingDate' in input.patrimoine) pp.openingDate = date('patrimoine.openingDate', input.patrimoine.openingDate);
                if ('objective' in input.patrimoine) pp.objectiveCents = money('patrimoine.objective', input.patrimoine.objective, { nullable: true });
                if (pp.openingStockCents !== undefined && pp.openingStockCents !== null && !pp.openingDate && !p.openingDate) pp.openingDate = today();
                if (Object.keys(pp).length) om.update(tx, p, pp);
              }
              if (input.cycle) {
                const cycle = cycleOf(tx.draft, comp.id);
                const next = cycleFields({ anchorDay: input.cycle.anchorDay, startDate: input.cycle.startDate ?? cycle.startDate }, 'cycle.startDate');
                if (closuresOf(tx.draft, cycle.id).length && (next.anchorDay !== cycle.anchorDay || next.startDate !== cycle.startDate)) {
                  fail('FORBIDDEN_BY_RULE', 'Des périodes sont déjà closes : le jour d’ancrage et la date de début sont figés [P].', { field: 'cycle.anchorDay' });
                }
                om.update(tx, cycle, next);
              }
            } else {
              const tasks = input.tasks;
              if (!Array.isArray(tasks) || !tasks.length) fail('VALIDATION', 'Un projet de la vie se crée avec au moins une tâche.', { field: 'tasks' });
              const root = core.buildProject(tx, { title: text('project.name', project.name, { required: true, max: 200 }), description: project.description });
              const b = budget.buildStandardBudget(tx, { coreProjectId: root.id, parentBudgetId: comp.budgetId, name: project.name });
              budgetId = b.id;
              out.budgetId = b.id;
              out.coreProjectId = root.id;
              out.taskIds = tasks.map((t, i) => {
                if (t?.projectId !== undefined) fail('VALIDATION', 'Les tâches initiales sont reliées à la racine du projet.', { field: `tasks[${i}].projectId` });
                return core.buildTask(tx, { ...t, projectId: root.id }).id;
              });
            }

            // Centres personnalisés propres au user (jamais ajoutés au catalogue global).
            const tempRefs = {};
            for (const [i, c] of (input.customCenters ?? []).entries()) {
              const cc = om.create(tx, 'costCenter', { label: text(`customCenters[${i}].label`, c.label, { required: true, max: 120 }), direction: oneOf(`customCenters[${i}].direction`, c.direction, ['income', 'charge']) });
              tempRefs[`new:${c.tempRef ?? i}`] = cc.id;
              out.created.push(cc.id);
            }
            const refOf = (ref) => tempRefs[ref] ?? ref;

            for (const [i, e] of (input.entries ?? []).entries()) {
              const entry = { ...e, budgetId, costCenterRef: refOf(e.costCenterRef) };
              if (e.recurrenceId) {
                const rec = om.owned(tx.draft, 'recurrence', e.recurrenceId, tx.userId);
                const patch = {};
                if ('label' in e) patch.label = text(`entries[${i}].label`, e.label, { required: true, max: 200 });
                if ('amount' in e) patch.amountCents = money(`entries[${i}].amount`, e.amount, { positive: true });
                if ('endDate' in e) patch.endDate = date(`entries[${i}].endDate`, e.endDate);
                om.update(tx, rec, patch);
                out.updated.push(rec.id);
                continue;
              }
              const cadence = oneOf(`entries[${i}].cadence`, e.cadence, ['once', ...CADENCES], 'once');
              let made;
              try {
                made = cadence === 'once' ? budget.buildOperation(tx, entry) : budget.buildRecurrence(tx, entry);
              } catch (err) {
                // Les champs d'erreur désignent la ligne de l'assistant : entries[i].amount, entries[i].date…
                if (err?.details?.field && !String(err.details.field).startsWith('entries[')) err.details = { ...err.details, field: `entries[${i}].${err.details.field}`, entryIndex: i };
                throw err;
              }
              out.created.push(made.id);
            }

            if (input.caps) {
              const b = tx.draft.budgets[budgetId];
              const caps = { ...(b.capsCents ?? {}) };
              for (const [ref, amount] of Object.entries(input.caps)) {
                const real = refOf(ref);
                if (amount === null || amount === '') delete caps[real];
                else caps[real] = money(`caps.${ref}`, amount, { positive: true });
              }
              om.update(tx, b, { capsCents: caps });
            }
            if (input.vision) om.update(tx, comp, { vision: visionFields(comp.vision, input.vision) });
            for (const [i, g] of (input.goals ?? []).entries()) {
              if (g.goalId) {
                const goal = om.owned(tx.draft, 'lifeGoal', g.goalId, tx.userId);
                om.update(tx, goal, goalFields({ label: goal.label, type: goal.type, date: goal.date, targetToday: goal.targetTodayCents / 100, ...g }, i));
                out.updated.push(goal.id);
              } else {
                out.created.push(om.create(tx, 'lifeGoal', { ...goalFields(g, i), removed: false }).id);
              }
            }
            return out;
          },
          { creation: true },
        );
        return r;
      },

      /** Profil de départ : lignes existantes et suggestions de libellés (sans montant inventé). */
      setupProfile(ctx) {
        const state = socle.state;
        const { userId, comp } = requireComposition(state, ctx);
        const user = state.users[userId];
        const centers = socle.modules.budget.costCentersOf(state, userId);
        const suggestions = centers.filter((c) => c.standard).map((c) => ({ direction: c.direction, label: c.label, costCenterRef: c.ref, amount: null, cadence: 'monthly' }));
        const cycle = cycleOf(state, comp.id);
        const closedPeriods = cycle ? closuresOf(state, cycle.id).length : 0;
        const userTypeLabel = socle.modules.users.listUsers().find((u) => u.id === userId)?.userTypeLabel ?? user.userType;
        return {
          user: { id: user.id, label: user.label, userType: user.userType, userTypeLabel },
          // Des périodes closes figent le jour d'ancrage et la date de début du cycle [P].
          cycleState: { closedPeriods, frozen: closedPeriods > 0 },
          principal: { budgetId: comp.budgetId, coreProjectId: comp.coreProjectId, project: structuredClone(state.coreProjects[comp.coreProjectId]), patrimoine: structuredClone(state.patrimoines[comp.patrimoineId]), cycle: structuredClone(cycleOf(state, comp.id)), vision: reads.visionOf(comp), revision: comp.revision },
          budgetType: reads.budgetType(ctx),
          suggestions,
          goals: reads.goalsOf(state, userId),
          goalTypes: Object.entries(GOAL_TYPES).map(([key, t]) => ({ key, label: t.label, consumes: t.consumes })),
          centers,
          note: 'Les suggestions sont des libellés à compléter ; aucun montant n’est proposé à votre place.',
        };
      },

      dashboard(ctx, { periodKey } = {}) {
        const state = socle.state;
        const { userId, comp, cycle } = requireComposition(state, ctx);
        const user = socle.modules.users.listUsers().find((u) => u.id === userId);
        const mctx = metricContext(state, userId, socle, { periodKey });
        const cs = cycleState(state, cycle);
        const sections = parameters.value(state, 'bpm.tableauDeBord');
        const keys = [...new Set(sections.flatMap((s) => s.metrics))];
        const period = mctx.period;
        const closure = period?.closureId ? state.closures[period.closureId] : null;
        const { figures, comparison } = figuresFor(state, userId, keys, { periodKey: period?.key });
        const page = cs ? cs.page({ limit: 24 }) : { periods: [], total: 0, nextBefore: null };
        if (period && !page.periods.some((p) => p.key === period.key)) page.periods.push(period);
        const pat = state.patrimoines[comp.patrimoineId];
        return {
          user: { id: user.id, label: user.label, userType: user.userType, userTypeLabel: user.userTypeLabel },
          composition: { id: comp.id, budgetId: comp.budgetId, patrimoineId: comp.patrimoineId, coreProjectId: comp.coreProjectId },
          cycle: cycle ? { ...structuredClone(cycle), periods: page.periods, periodsTotal: page.total, nextBefore: page.nextBefore, currentKey: cs?.current.key ?? null, firstOpenKey: cs?.firstOpen.key ?? null } : null,
          period,
          closure: closure ? closureView(closure) : null,
          closing: closingOf(state, userId, period, cs),
          sections,
          figures,
          comparison,
          operations: period ? socle.modules.budget.operationsOf(state, comp.budgetId, { from: period.start, to: period.end }) : [],
          lifeProjects: lifeProjects(state, comp),
          patrimoine: { id: pat.id, revision: pat.revision, openingStock: pat.openingStockCents === null ? null : pat.openingStockCents / 100, openingDate: pat.openingDate, objective: pat.objectiveCents === null ? null : pat.objectiveCents / 100 },
        };
      },

      /** Historique des périodes par pages (C10), du plus récent au plus ancien. */
      periods(ctx, { before, limit } = {}) {
        const state = socle.state;
        const { cycle } = requireComposition(state, ctx);
        const cs = cycleState(state, cycle);
        if (!cs) return { periods: [], total: 0, nextBefore: null };
        return cs.page({ before: before === undefined ? undefined : Number(before), limit: Math.min(Math.max(Number(limit) || 24, 1), 240) });
      },

      /** Aperçu de clôture (C02) : même contrat que la commande. */
      closingPreview(ctx, periodKey) {
        const state = socle.state;
        return closingContract(state, om.requireUser(state, ctx), socle, periodKey).preview;
      },

      figure: evaluateFigure,

      preparation(ctx) {
        const state = socle.state;
        return preparationOf(state, om.requireUser(state, ctx));
      },

      /**
       * Préparation explicite (C06) d'un user créé avant l'activation de BPM : complète uniquement ce
       * qui manque, réutilise l'existant, en une écriture rejouable (requestKey). Un doublon n'est jamais réparé ici.
       */
      async prepareComposition(ctx, input = {}) {
        const r = await om.command(
          'prepareComposition',
          ctx,
          input,
          (tx) => {
            const prep = preparationOf(tx.draft, tx.userId);
            if (prep.status === 'inconsistent') fail('FORBIDDEN_BY_RULE', 'Espace BPM incohérent : correction manuelle requise.', { preparation: prep });
            if (prep.status === 'ready') return { bpmCompositionId: compositionOf(tx.draft, tx.userId).id, created: [] };
            const { core, budget, patrimoine } = socle.modules;
            const created = [];
            let life = budget.lifeBudgetOf(tx.draft, tx.userId);
            let pat = patrimoine.patrimoineOf(tx.draft, tx.userId);
            const rootId =
              life?.coreProjectId ??
              pat?.coreProjectId ??
              (created.push('coreProject'), core.buildProject(tx, { title: 'Projet de vie', description: 'Racine noyau commune au Budget « Projet de vie » et au Patrimoine.' }).id);
            if (!life) {
              life = budget.buildLifeBudget(tx, { coreProjectId: rootId });
              created.push('lifeBudget');
            }
            if (!pat) {
              pat = patrimoine.buildPatrimoine(tx, { coreProjectId: rootId, principalBudgetId: life.id, openingStock: input.openingStock, openingDate: input.openingDate ?? (input.openingStock === null || input.openingStock === undefined ? null : today()), objective: input.objective });
              created.push('patrimoine');
            }
            let comp = compositionOf(tx.draft, tx.userId);
            if (!comp) {
              comp = om.create(tx, 'bpmComposition', { label: `BPM de ${tx.draft.users[tx.userId].label}`, budgetId: life.id, patrimoineId: pat.id, coreProjectId: rootId, vision: null });
              created.push('bpmComposition');
            }
            if (!cycleOf(tx.draft, comp.id)) {
              om.create(tx, 'cycleLink', { bpmCompositionId: comp.id, ...cycleFields({ anchorDay: input.anchorDay ?? null, startDate: input.cycleStartDate ?? null }) });
              created.push('cycleLink');
            }
            return { bpmCompositionId: comp.id, created };
          },
          { creation: true },
        );
        return { replayed: r.replayed, created: r.created, preparation: preparationOf(socle.state, socle.state.bpmCompositions[r.bpmCompositionId].userId) };
      },

      async configureCycle(ctx, input = {}) {
        await om.command('configureCycle', ctx, input, (tx) => {
          const comp = compositionOf(tx.draft, tx.userId);
          if (!comp) fail('NOT_FOUND', 'Ce user n’a pas de composition BPM.');
          const cycle = cycleOf(tx.draft, comp.id);
          om.checkRevision(cycle, expectedRevisionOf(input));
          const next = cycleFields({ anchorDay: input.anchorDay, startDate: input.startDate ?? cycle.startDate }, 'startDate');
          if (closuresOf(tx.draft, cycle.id).length && (next.anchorDay !== cycle.anchorDay || next.startDate !== cycle.startDate)) {
            fail('FORBIDDEN_BY_RULE', 'Des périodes sont déjà closes : le jour d’ancrage et la date de début sont figés [P].');
          }
          om.update(tx, cycle, next);
          return { cycleLinkId: cycle.id };
        });
        return this.dashboard(ctx);
      },

      /**
       * Clôture d'une période terminée [P] (C07) : le résultat signé, calculé par la métrique
       * administrée `bpm.resultatPeriode`, est transféré une seule fois au Patrimoine.
       * Un résultat nul clôt aussi la période ; le stock peut devenir négatif.
       * `expectedResultCents` (montant affiché à la confirmation) protège d'une donnée périmée.
       */
      async closePeriod(ctx, input = {}) {
        const r = await om.command(
          'closePeriod',
          ctx,
          input,
          (tx) => {
            const { comp, cycle, period, mctx, result, preview } = closingContract(tx.draft, tx.userId, socle, input.periodKey);
            const resultCents = preview.resultCents;
            // Le montant confirmé doit être celui qui sera capitalisé : sinon relecture demandée (C02).
            if (input.expectedResultCents !== undefined && input.expectedResultCents !== resultCents) {
              fail('CLOSING_PREVIEW_STALE', 'Les données ont changé depuis l’aperçu : relire le montant avant de confirmer.', { expectedResultCents: input.expectedResultCents, preview });
            }
            const sourceOperationIds = [...new Set(collectSources(result.inputs).filter((s) => s.kind === 'operation').map((s) => s.id))];

            const closure = om.create(tx, 'closure', {
              cycleLinkId: cycle.id,
              budgetId: comp.budgetId,
              patrimoineId: comp.patrimoineId,
              capitalizationId: null,
              periodKey: period.key,
              periodLabel: period.label,
              periodStart: period.start,
              periodEnd: period.end,
              resultCents,
              budgetBalanceAfterCents: 0,
              calculation: { metric: RESULT_METRIC, formula: result.formula, parameter: result.parameter, explanation: result.explanation, inputs: result.inputs.map((i) => ({ name: i.name, label: i.label, value: i.value })) },
              // Instantané de tous les chiffres de la période à la clôture (C01) : formules, révisions, valeurs, sources.
              figures: metrics.evaluateMany(mctx, [...metrics.metrics.keys()]),
              stockBeforeCents: preview.stockBefore === null ? null : Math.round(preview.stockBefore * 100),
              sourceOperationIds,
            });
            const cap = socle.modules.patrimoine.buildCapitalization(tx, {
              patrimoineId: comp.patrimoineId,
              amountCents: resultCents,
              date: period.end,
              label: `Résultat ${period.label}`,
              source: { kind: 'closure', id: closure.id },
            });
            closure.capitalizationId = cap.id;
            return { closureId: closure.id, capitalizationId: cap.id };
          },
          { creation: true },
        );
        return { replayed: r.replayed, closure: closureView(socle.state.closures[r.closureId]) };
      },

      closures(ctx) {
        const state = socle.state;
        const { cycle } = requireComposition(state, ctx);
        return closuresOf(state, cycle?.id).reverse().map(closureView);
      },

      /** Projet de la vie : Budget standard enfant du « Projet de vie », racine noyau propre, ≥ 1 tâche. */
      async createLifeProject(ctx, input = {}) {
        const r = await om.command(
          'createLifeProject',
          ctx,
          input,
          (tx) => {
            const comp = compositionOf(tx.draft, tx.userId);
            if (!comp) fail('NOT_FOUND', 'Ce user n’a pas de composition BPM.');
            const { core, budget } = socle.modules;
            const tasks = input.tasks;
            if (!Array.isArray(tasks) || !tasks.length) fail('VALIDATION', 'Un projet de la vie se crée avec au moins une tâche.', { field: 'tasks' });
            const project = input.project ?? {};
            const root = core.buildProject(tx, { ...project, title: project.title ?? input.name });
            const b = budget.buildStandardBudget(tx, { coreProjectId: root.id, parentBudgetId: comp.budgetId, name: input.name ?? root.title });
            const taskIds = tasks.map((t, i) => {
              if (t?.projectId !== undefined) fail('VALIDATION', 'Les tâches initiales sont reliées à la racine du projet.', { field: `tasks[${i}].projectId` });
              return core.buildTask(tx, { ...t, projectId: root.id }).id;
            });
            return { budgetId: b.id, coreProjectId: root.id, parentBudgetId: comp.budgetId, taskIds };
          },
          { creation: true },
        );
        return r;
      },

      lifeProjects(ctx) {
        const state = socle.state;
        return lifeProjects(state, requireComposition(state, ctx).comp);
      },
    };
  },

  checks(state) {
    const out = [];
    for (const u of Object.values(state.users)) {
      const prep = preparationOf(state, u.id);
      const missing = prep.missing.map((m) => ({ id: u.id, kind: 'user', field: m.code, targetId: null, problem: 'missing-required', message: `${m.label} manquant` }));
      const dups = prep.duplicates.map((d) => ({ id: u.id, kind: 'user', field: d.code, targetId: d.ids.join('|'), problem: 'duplicate', message: `${d.ids.length} × ${d.label} (attendu : exactement un)` }));
      const observed =
        prep.status === 'ready'
          ? 'exactement un de chaque, reliés'
          : [prep.missing.length ? `à préparer — manque : ${prep.missing.map((m) => m.label).join(', ')}` : null, ...dups.map((d) => d.message), prep.linked ? null : 'éléments non reliés entre eux'].filter(Boolean).join(' ; ');
      out.push({
        ...check('BPM-01', 'integrity', 'bpm', `Espace BPM de ${u.label} : exactement un de chaque élément`, 'exactement 1 Budget « Projet de vie », 1 Patrimoine, 1 composition, 1 liaison de cycle, reliés à la même racine', observed, prep.status === 'ready' ? 'passed' : 'failed', [u.id, ...prep.ids]),
        anomalies: [...missing, ...dups],
        preparation: prep.status,
      });
    }
    for (const b of Object.values(state.budgets).filter((x) => x.role === 'standard')) {
      const n = Object.values(state.tasks).filter((t) => t.projectId === b.coreProjectId).length;
      if (!n) out.push(check('A-PARC-01', 'pathway', 'bpm', `Projet de la vie ${b.name} sans tâche`, 'au moins une tâche dans le parcours métier', '0 tâche', 'warning', [b.id]));
    }
    const lifeRoots = new Set(Object.values(state.budgets).filter((b) => b.role === 'life').map((b) => b.coreProjectId));
    for (const t of Object.values(state.tasks)) {
      if (lifeRoots.has(t.projectId)) out.push(check('P-IHM-01', 'pathway', 'bpm', 'Tâche reliée directement à la racine principale', 'création métier via un projet de la vie', `tâche ${t.title}`, 'warning', [t.id, t.projectId]));
    }
    const keys = new Set();
    for (const c of Object.values(state.closures)) {
      const cap = state.capitalizations[c.capitalizationId];
      const unique = !keys.has(`${c.cycleLinkId}/${c.periodKey}`);
      keys.add(`${c.cycleLinkId}/${c.periodKey}`);
      const ok = unique && cap && cap.amountCents === c.resultCents && cap.source?.id === c.id;
      out.push(check('CLO-01', 'integrity', 'bpm', `Clôture ${c.periodLabel} : unique, résultat transféré une seule fois`, 'une capitalisation du même montant, une clôture par période', ok ? 'cohérent' : 'incohérent', ok ? 'passed' : 'failed', [c.id, c.capitalizationId].filter(Boolean)));
    }
    // Projets de la vie financés par le budget de vie (C05, règles du 4 novembre 2026 [P]).
    const now = today();
    for (const b of Object.values(state.budgets).filter(inRegime)) {
      const fig = projectBudget(state, b, now);
      out.push(check('PRJ-01', 'integrity', 'bpm', `Projet ${b.name} : parts des tâches dans le budget autorisé`, 'somme des parts ≤ budget attribué + dépassements autorisés', `${fig.sharesCents / 100} € sur ${fig.ceilingCents / 100} €`, fig.sharesCents <= fig.ceilingCents ? 'passed' : 'failed', [b.id]));
      const late = Object.values(state.projectOverruns ?? {}).filter((x) => x.budgetId === b.id && x.status === 'approved' && x.billingDate && x.billingDate < now);
      if (late.length) out.push(check('PRJ-02', 'pathway', 'bpm', `Projet ${b.name} : dépassement autorisé à facturer au budget de vie`, 'facturé à la fin du cycle', `${late.length} dépassement(s) dont la fin de cycle est passée`, 'warning', [b.id, ...late.map((x) => x.id)]));
      if (cycleChecks(state, b, fig).some((c) => c.level === 'warning')) out.push(check('PRJ-03', 'pathway', 'bpm', `Projet ${b.name} : contrôles de fin de cycle`, 'budget = somme des parts ; charges des tâches planifiées et à jour', 'au moins un point à revoir', 'warning', [b.id]));
    }
    // Reste ouvert : les projets de la vie sans montant attribué ne sont pas consolidés dans le budget de vie.
    out.push({ rule: 'C05', category: 'not-implemented', description: 'Consolidation des projets de la vie sans budget attribué par le budget de vie', expected: 'décision ouverte', observed: 'flux non consolidés (chaque Budget présenté séparément)', result: 'not-run', execution: 'not-run', ids: [] });
    return out;
  },

  debug: {
    views(state, scope) {
      const inScope = (o) => scope === 'all' || o.userId === scope;
      return {
        assemblages: Object.values(state.bpmCompositions)
          .filter(inScope)
          .map((a) => {
            const b = state.budgets[a.budgetId];
            const p = state.patrimoines[a.patrimoineId];
            const cycle = cycleOf(state, a.id);
            return {
              userId: a.userId,
              userLabel: state.users[a.userId]?.label ?? null,
              bpmCompositionId: a.id,
              principalBudgetId: b?.id ?? null,
              principalCoreProjectId: b?.coreProjectId ?? null,
              patrimoineId: p?.id ?? null,
              patrimoineCoreProjectId: p?.coreProjectId ?? null,
              coreProjectShared: !!b && !!p && b.coreProjectId === p.coreProjectId,
              cycleLinkId: cycle?.id ?? null,
              cycleState: cycle?.state ?? null,
              lifeProjectBudgetIds: Object.values(state.budgets).filter((x) => x.parentBudgetId === b?.id).map((x) => x.id),
            };
          }),
        clotures: Object.values(state.closures)
          .filter(inScope)
          .map((c) => ({ closureId: c.id, userId: c.userId, periodKey: c.periodKey, periodStart: c.periodStart, periodEnd: c.periodEnd, result: c.resultCents / 100, formula: c.calculation.formula, parameterRevision: c.calculation.parameter?.revision ?? null, capitalizationId: c.capitalizationId, sourceOperationIds: c.sourceOperationIds })),
      };
    },
    csv: {
      'assemblages.csv': { view: 'assemblages', columns: ['userId', 'userLabel', 'bpmCompositionId', 'principalBudgetId', 'principalCoreProjectId', 'patrimoineId', 'patrimoineCoreProjectId', 'coreProjectShared', 'cycleLinkId', 'cycleState', 'lifeProjectBudgetIds'] },
      'clotures.csv': { view: 'clotures', columns: ['closureId', 'userId', 'periodKey', 'periodStart', 'periodEnd', 'result', 'formula', 'parameterRevision', 'capitalizationId', 'sourceOperationIds'] },
    },
    derivedRelations(state, socle) {
      const rels = [];
      for (const t of Object.values(state.tasks)) {
        const q = socle.modules.core.qualificationOf(state, t);
        if (q.budgetIdDerived) rels.push({ sourceId: t.id, sourceKind: 'task', relation: 'budgetIdDerived (via racine)', targetId: q.budgetIdDerived, userId: t.userId });
      }
      for (const c of Object.values(state.capitalizations)) {
        if (c.source?.id) rels.push({ sourceId: c.id, sourceKind: 'capitalization', relation: `source (${c.source.kind})`, targetId: c.source.id, userId: c.userId });
      }
      for (const c of Object.values(state.closures)) {
        for (const id of c.sourceOperationIds) rels.push({ sourceId: c.id, sourceKind: 'closure', relation: 'opération source du résultat', targetId: id, userId: c.userId });
      }
      return rels;
    },
  },

  routes(socle) {
    const s = socle.modules.bpm;
    const { budget, patrimoine } = socle.modules;
    const lifeBudgetId = (ctx) => socle.modules.bpm.compositionOf(socle.state, socle.om.requireUser(socle.state, ctx))?.budgetId;
    return [
      ['GET', '/api/bpm/dashboard', ({ ctx, query }) => s.dashboard(ctx, { periodKey: query.get('period') || undefined })],
      ['GET', '/api/bpm/figures/:key', ({ ctx, params, query }) => s.figure(ctx, params.key, { periodKey: query.get('period') || undefined })],
      ['GET', '/api/bpm/summary', ({ ctx, query }) => s.reads.summary(ctx, { periodKey: query.get('period') || undefined })],
      ['GET', '/api/bpm/register', ({ ctx, query }) => s.reads.register(ctx, Object.fromEntries(query))],
      ['GET', '/api/bpm/lines/:id', ({ ctx, params, query }) => s.reads.lineDetail(ctx, params.id, { periodKey: query.get('period') || undefined })],
      ['GET', '/api/bpm/centers', ({ ctx, query }) => s.reads.centers(ctx, Object.fromEntries(query))],
      ['GET', '/api/bpm/centers/:ref', ({ ctx, params, query }) => s.reads.centerDetail(ctx, params.ref, Object.fromEntries(query))],
      ['GET', '/api/bpm/incomes', ({ ctx, query }) => s.reads.incomes(ctx, Object.fromEntries(query))],
      ['GET', '/api/bpm/balance', ({ ctx, query }) => s.reads.balance(ctx, Object.fromEntries(query))],
      ['GET', '/api/bpm/history', ({ ctx, query }) => s.reads.history(ctx, { before: query.get('before') ?? undefined, limit: query.get('limit') ?? undefined })],
      ['GET', '/api/bpm/impact', ({ ctx, query }) => s.reads.impact(ctx, { period: query.get('period') || undefined })],
      ['GET', '/api/bpm/budget-type', ({ ctx }) => s.reads.budgetType(ctx)],
      ['GET', '/api/bpm/due', ({ ctx }) => s.reads.due(ctx)],
      ['GET', '/api/bpm/events', ({ ctx }) => s.reads.events(ctx)],
      ['GET', '/api/bpm/directives', ({ ctx }) => s.reads.directives(ctx)],
      ['GET', '/api/bpm/projection', ({ ctx, query }) => s.reads.projection(ctx, Object.fromEntries(query))],
      ['POST', '/api/bpm/operations/preview', ({ ctx, body }) => s.reads.previewEntry(ctx, body)],
      ['PUT', '/api/bpm/vision', ({ ctx, body }) => s.updateVision(ctx, body)],
      ['GET', '/api/bpm/goals', ({ ctx }) => s.goals(ctx)],
      ['POST', '/api/bpm/goals', ({ ctx, body }) => s.createGoal(ctx, body)],
      ['PUT', '/api/bpm/goals/:id', ({ ctx, params, body }) => s.updateGoal(ctx, params.id, body)],
      ['POST', '/api/bpm/goals/:id/remove', ({ ctx, params, body }) => s.removeGoal(ctx, params.id, body)],
      ['GET', '/api/bpm/setup', ({ ctx }) => s.setupProfile(ctx)],
      ['POST', '/api/bpm/setup', ({ ctx, body }) => s.setupProject(ctx, body)],
      ['GET', '/api/bpm/recurrences', ({ ctx, query }) => budget.recurrences(ctx, { budgetId: query.get('budgetId') || undefined })],
      ['PUT', '/api/bpm/recurrences/:id', ({ ctx, params, body }) => budget.updateRecurrence(ctx, params.id, body)],
      ['POST', '/api/bpm/recurrences/:id/settle', ({ ctx, params, body }) => budget.settleOccurrence(ctx, params.id, body)],
      ['PUT', '/api/bpm/operations/:id', ({ ctx, params, body }) => budget.updateOperation(ctx, params.id, body)],
      ['POST', '/api/bpm/operations/:id/cancel-realization', ({ ctx, params, body }) => budget.cancelRealization(ctx, params.id, body)],
      ['PUT', '/api/bpm/caps', ({ ctx, body }) => budget.setCaps(ctx, lifeBudgetId(ctx), body)],
      ['GET', '/api/bpm/periods', ({ ctx, query }) => s.periods(ctx, { before: query.get('before') ?? undefined, limit: query.get('limit') ?? undefined })],
      ['GET', '/api/bpm/closures/preview', ({ ctx, query }) => s.closingPreview(ctx, query.get('period'))],
      ['GET', '/api/bpm/preparation', ({ ctx }) => s.preparation(ctx)],
      ['POST', '/api/bpm/prepare', ({ ctx, body }) => s.prepareComposition(ctx, body)],
      ['PUT', '/api/bpm/cycle', ({ ctx, body }) => s.configureCycle(ctx, body)],
      ['GET', '/api/bpm/closures', ({ ctx }) => s.closures(ctx)],
      ['POST', '/api/bpm/closures', ({ ctx, body }) => s.closePeriod(ctx, body)],
      ['GET', '/api/bpm/life-projects', ({ ctx }) => s.lifeProjects(ctx)],
      // Projets et tâches du budget de vie (les projets et tâches sont ceux du noyau ; BPM porte leurs budgets).
      ['GET', '/api/bpm/projects', ({ ctx }) => s.projects.overview(ctx)],
      ['POST', '/api/bpm/projects', ({ ctx, body }) => s.projects.createProject(ctx, body)],
      ['POST', '/api/bpm/projects/adopt', ({ ctx, body }) => s.projects.adoptProject(ctx, body)],
      ['GET', '/api/bpm/projects/:id', ({ ctx, params }) => s.projects.projectDetail(ctx, params.id)],
      ['GET', '/api/bpm/tasks', ({ ctx }) => s.projects.tasksOverview(ctx)],
      ['POST', '/api/bpm/tasks', ({ ctx, body }) => s.projects.createTask(ctx, body)],
      ['POST', '/api/bpm/project-budgets/:id/requests/:taskId', ({ ctx, params, body }) => s.projects.requestTaskBudget(ctx, params.id, params.taskId, body)],
      ['POST', '/api/bpm/task-budget-requests/:id/decision', ({ ctx, params, body }) => s.projects.decideTaskBudget(ctx, params.id, body)],
      ['PUT', '/api/bpm/project-budgets/:id/allocation', ({ ctx, params, body }) => s.projects.allocate(ctx, params.id, body)],
      ['PUT', '/api/bpm/project-budgets/:id/shares/:taskId', ({ ctx, params, body }) => s.projects.setTaskShare(ctx, params.id, params.taskId, body)],
      ['PUT', '/api/bpm/project-budgets/:id/returns/:taskId', ({ ctx, params, body }) => s.projects.setTaskReturn(ctx, params.id, params.taskId, body)],
      ['POST', '/api/bpm/project-budgets/:id/overruns', ({ ctx, params, body }) => s.projects.requestOverrun(ctx, params.id, body)],
      ['POST', '/api/bpm/overruns/bill', ({ ctx, body }) => s.projects.billOverruns(ctx, body)],
      ['POST', '/api/bpm/overruns/:id/decision', ({ ctx, params, body }) => s.projects.decideOverrun(ctx, params.id, body)],
      ['POST', '/api/bpm/life-projects', ({ ctx, body }) => s.createLifeProject(ctx, body)],
      ['GET', '/api/bpm/cost-centers', ({ ctx }) => budget.costCenters(ctx)],
      ['POST', '/api/bpm/cost-centers', ({ ctx, body }) => budget.addCustomCostCenter(ctx, body)],
      // Éditeur partagé : ponctuelle ou récurrente ; Budget du projet de vie par défaut, ou une branche du user.
      ['POST', '/api/bpm/operations', ({ ctx, body }) => budget.createEntry(ctx, { ...body, budgetId: body?.budgetId || lifeBudgetId(ctx) })],
      ['POST', '/api/bpm/operations/:id/realize', ({ ctx, params, body }) => budget.realizeOperation(ctx, params.id, body)],
      ['PUT', '/api/bpm/patrimoine', ({ ctx, body }) => patrimoine.updatePatrimoine(ctx, socle.modules.bpm.compositionOf(socle.state, socle.om.requireUser(socle.state, ctx))?.patrimoineId, body)],
    ];
  },
};

/** Clôture antérieure à l'instantané des chiffres : seul le résultat capitalisé est enregistré. */
function legacyResultFigure(closure, current) {
  const c = closure.calculation ?? {};
  return { key: RESULT_METRIC, label: current.label, unit: current.unit, status: 'ok', value: closure.resultCents / 100, formula: c.formula ?? null, parameter: c.parameter ?? null, explanation: c.explanation ?? null, inputs: c.inputs ?? [] };
}

/** Objets sources d'une explication, à toute profondeur (variables et métriques imbriquées). */
function collectSources(inputs) {
  return inputs.flatMap((i) => [...(i.sources ?? []), ...collectSources(i.inputs ?? [])]);
}
