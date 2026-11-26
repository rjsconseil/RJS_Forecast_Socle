// Budget/Patrimoine Management (niveau 3, application). Compose les middlewares Budget et
// Patrimoine sur le noyau : création du user et de son triplet, projets de la vie, cycle et
// clôtures, parcours métier. Chaque chiffre présenté est une métrique dont la formule est
// administrée (`metric.<clé>`) et dont l'explication remonte jusqu'aux objets sources.
import { cycleFields, assertCycleChange, assertOpenDates, assertClosable } from '../budget/api.mjs';
import { fail } from '../../socle/errors.mjs';
import { check } from '../../socle/object-management/inspect.mjs';
import { date, expectedRevisionOf, integer, money, oneOf, text } from '../../socle/validation.mjs';
import { CADENCES } from '../budget/api.mjs';
import { createReads } from './reads.mjs';
import { createLife } from './life.mjs';
import { createBilans } from './bilans.mjs';
import { createMeteo } from './meteo.mjs';
import { calendarSources, createCalendarSources } from './calendar-sources.mjs';
import { closuresOf, compositionOf, cycleOf } from './composition.mjs';
import { DEFAULT_DASHBOARD, METRICS, RESULT_METRIC } from './metrics.mjs';
import { BPM_MIGRATIONS } from './migrations.mjs';
import { bpmRoutes } from './routes.mjs';
import { essentialsParameter } from './natures.mjs';
import { GOAL_TYPES } from '../patrimoine/api.mjs';
import { createProjects, projectExtensions } from './projects.mjs';
import { awaitingClosure, closingModeMessage, createClosing, LOCK_PARAMETER, lockMessage } from './closing.mjs';
import { cycleBounds, dayBefore, indexOfKey, periodByIndex, periodByKey, periodsPage, today } from '../budget/api.mjs';


/**
 * Liaison de cycle : mensuelle [P] ; active dès que le jour d'ancrage est connu.
 * `startField` : nom du champ tel que l'appelant l'a envoyé (erreur rendue par champ, C09).
 */

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
 * Verrou du cycle suivant [P] (paramètre `bpm.verrouCycleSuivant`) : tant qu'un cycle terminé attend sa clôture,
 * le budget du projet de vie et ses projets ne reçoivent aucune entrée datée du cycle d'aujourd'hui ou après.
 */
function nextCycleLock(state, socle, userId, budgetId) {
  if (socle.parameters.value(state, LOCK_PARAMETER) === false) return null;
  const comp = compositionOf(state, userId);
  const cycle = comp ? cycleOf(state, comp.id) : null;
  const b = state.budgets[budgetId];
  if (!cycle || !b || (b.id !== comp.budgetId && b.parentBudgetId !== comp.budgetId)) return null;
  return awaitingClosure(cycleState(state, cycle));
}

const lockRefusal = (lock, date) => fail('CYCLE_AWAITING_CLOSURE', lockMessage(lock), { periodKey: lock.periodKey, from: lock.from, date });

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

export default {
  id: 'bpm',
  label: 'Budget/Patrimoine Management',
  level: 3,
  dependsOn: ['users', 'core', 'budget', 'patrimoine', 'calendar'],
  // P4 · Lecture déclarée : l'application assemble ses pages en lisant ces natures des couches inférieures.
  reads: ['user', 'coreProject', 'task', 'budget', 'operation', 'recurrence', 'costCenter', 'projectOverrun', 'taskBudgetRequest', 'patrimoine', 'capitalization', 'lifeGoal'],
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
    // Nature des charges du projet de vie (indispensables / courantes / projets) : voir natures.mjs.
    essentialsParameter,
    {
      key: LOCK_PARAMETER,
      label: 'Verrou du cycle suivant',
      group: 'Application BPM',
      type: 'boolean',
      default: true,
      description: 'Quand un cycle terminé attend sa clôture, il est en clôture (ses points sont figés : aucune nouvelle prévision n’y entre) et le cycle suivant attend d’être lancé (aucune entrée datée de lui ou après avant la clôture). Désactivé, les saisies restent libres et la clôture reste à faire.',
    },
  ],


  metrics: METRICS,

  extensions: {
    metricContext,
    // Calendrier : règlements, tâches des projets et rendez-vous de décision, fournis comme natures lisibles.
    calendarSources,
    // Projets de la vie : période du cycle fournie au financement du middleware Budget.
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
        const budget = state.budgets[acc.enrichment.budgetId];
        const comp = Object.values(state.bpmCompositions).find(c => c.budgetId === budget?.parentBudgetId && c.userId === budget?.userId);
        return {
          enrichment: { bpmCompositionId: comp?.id ?? null, lifeProjectId: comp?.coreProjectId ?? null, patrimoineId: comp?.patrimoineId ?? null },
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

    /**
     * Une période close est figée [P] : aucune opération du Budget « Projet de vie » n'y entre ni n'en sort.
     * Un cycle terminé qui attend sa clôture tient le cycle suivant fermé (verrou du cycle suivant). Seul un report
     * décidé par la clôture (`carried`) passe le verrou : quand plusieurs cycles attendent, la clôture du premier
     * inscrit ses reports dans un cycle à venir, au-delà de celui qui attend encore.
     */
    operationGuard(state, { userId, budgetId, dates, independentIncome, opens = [], carried = false }, socle) {
      const comp = compositionOf(state, userId);
      const cycle = comp ? cycleOf(state, comp.id) : null;
      assertOpenDates({ budget: state.budgets[budgetId], principalBudgetId: comp?.budgetId, closures: closuresOf(state, cycle?.id), dates, independentIncome });
      const lock = nextCycleLock(state, socle, userId, budgetId);
      const locked = lock && dates.find((d) => d >= lock.from);
      if (locked && !carried) lockRefusal(lock, locked);
      // Mode clôture : les points du cycle terminé sont figés, aucune prévision n'y entre (ce qui a eu lieu, oui).
      const frozen = lock && opens.find((d) => d >= lock.start && d < lock.from);
      if (frozen) fail('CYCLE_IN_CLOSING', closingModeMessage(lock), { periodKey: lock.periodKey, date: frozen });
    },

    /**
     * Définition récurrente : refusée si elle touche une occurrence du cycle qui attend d'être lancé ou après, ou si
     * elle ouvre (création, modification) des échéances dans le cycle en clôture.
     */
    recurrenceGuard(state, { userId, budgetId, from, to, opens = false }, socle) {
      const lock = nextCycleLock(state, socle, userId, budgetId);
      if (lock && (to == null || to >= lock.from)) lockRefusal(lock, to == null || from >= lock.from ? from : lock.from);
      if (lock && opens && from < lock.from && (to == null || to >= lock.start)) fail('CYCLE_IN_CLOSING', closingModeMessage(lock), { periodKey: lock.periodKey, date: from > lock.start ? from : lock.start });
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
      const comp = socle.om.create(tx, 'bpmComposition', { label: `BPM de ${user.label}`, budgetId: life.id, patrimoineId: pat.id, coreProjectId: root.id });
      const cycle = socle.om.create(tx, 'cycleLink', { bpmCompositionId: comp.id, ...cycleFields({ anchorDay: input.anchorDay, startDate: input.cycleStartDate }) });
      return { userId: user.id, coreProjectId: root.id, budgetId: life.id, patrimoineId: pat.id, bpmCompositionId: comp.id, cycleLinkId: cycle.id };
    },
  },

  migrations: BPM_MIGRATIONS,

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
    const projects = createProjects(socle, { requireComposition, cycleState, figuresFor });

    // Gestion du projet de vie : lecture de pilotage du projet unique (voir life.mjs).
    const life = createLife(socle, { figuresFor, closuresOf, closingOf }, reads, projects);

    // Bilans des cycles : tous les faits de chaque période et ses faits marquants (voir bilans.mjs).
    const bilans = createBilans(socle, { requireComposition, cycleState, figuresFor, closuresOf }, reads);

    /**
     * Écriture de la clôture d'une période (dans une commande) : clôture avec l'instantané des chiffres et le bilan,
     * capitalisation unique du résultat. `extra` complète la clôture (ex. le parcours suivi par la page).
     */
    function recordClosure(tx, input, bilan, extra = {}) {
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
        // Bilan du cycle (faits et faits marquants), figé à la clôture.
        bilan: bilan && bilan.period.key === period.key && bilan.patrimoine.capitalizedCents === resultCents ? bilan : null,
        ...extra,
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
    }

    // Parcours de clôture : complétude du cycle, décisions, finalisation qui lance le cycle suivant (voir closing.mjs).
    const closing = createClosing(
      socle,
      {
        requireComposition, compositionOf, cycleOf, closuresOf, closingOf, figuresFor, recordClosure, closureView,
        cycleState: (state, cycle) => cycleState(state, cycle),
        closingContract: (state, userId, periodKey) => closingContract(state, userId, socle, periodKey),
      },
      reads,
      bilans,
    );

    // Météo BPM : l'état des deux sections, les prévisions et les tendances, lus dans les lectures ci-dessus (voir meteo.mjs).
    const calendarReads = createCalendarSources({ reads, projects });
    const meteo = createMeteo({ life, projects, bilans, reads, calendar: () => socle.modules.calendar });

    // Une écriture atomique compose les deux middlewares ; la révision de composition
    // protège le formulaire agrégé existant, sans stocker ses règles financières dans BPM.
    function applyVision(tx, comp, input) {
      socle.modules.budget.patchObjectives(tx, comp.budgetId, input);
      socle.modules.patrimoine.patchProjectionSettings(tx, comp.patrimoineId, input);
      om.update(tx, comp, {});
    }

    return {
      compositionOf,
      metricContext: (state, userId, options) => metricContext(state, userId, socle, options),
      reads,
      projects,
      life,
      bilans,
      meteo,
      calendarSources: calendarReads,

      async updateVision(ctx, input = {}) {
        await om.command('updateVision', ctx, input, (tx) => {
          const comp = compositionOf(tx.draft, tx.userId);
          if (!comp) fail('NOT_FOUND', 'Ce user n’a pas de composition BPM.');
          om.checkRevision(comp, expectedRevisionOf(input));
          applyVision(tx, comp, input);
          return { bpmCompositionId: comp.id };
        });
        const comp = compositionOf(socle.state, ctx.userId);
        return { revision: comp.revision, vision: reads.visionOf(comp) };
      },

      goals: (ctx) => socle.modules.patrimoine.goals(ctx),
      createGoal: (ctx, input) => socle.modules.patrimoine.createGoal(ctx, input),
      updateGoal: (ctx, id, input) => socle.modules.patrimoine.updateGoal(ctx, id, input),
      removeGoal: (ctx, id, input) => socle.modules.patrimoine.removeGoal(ctx, id, input),

      /**
       * Partir de zéro (assistant en 7 étapes), en UNE commande rejouable :
       * - `principal` configure l'ensemble existant (aucun deuxième projet de vie ni Patrimoine) ;
       * - `branch` crée un projet de la vie (Budget standard, racine noyau, ≥ 1 tâche), sans Patrimoine.
       * Les lignes du budget type portant un `recurrenceId` sont mises à jour, jamais recréées.
       * `expectedRevisions` ({ id: révision }) protège les objets modifiés contre une écriture concurrente.
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
            // Révisions des objets que le formulaire modifie (audit ARCH-03) : même contrôle que les éditeurs directs.
            for (const [id, revision] of Object.entries(input.expectedRevisions ?? {})) {
              om.checkRevision(om.owned(tx.draft, socle.registry.kindOfId(id), id, tx.userId), revision);
            }

            if (mode === 'principal') {
              const patch = {};
              if ('name' in project) patch.title = project.name;
              if ('description' in project) patch.description = project.description;
              if (Object.keys(patch).length) core.patchProject(tx, comp.coreProjectId, patch);
              if (input.patrimoine) {
                const fields = { ...input.patrimoine };
                const p = tx.draft.patrimoines[comp.patrimoineId];
                if (fields.openingStock != null && !fields.openingDate && !p.openingDate) fields.openingDate = today();
                socle.modules.patrimoine.patchPatrimoine(tx, comp.patrimoineId, fields);
              }
              if (input.cycle) {
                const cycle = cycleOf(tx.draft, comp.id);
                const next = cycleFields({ anchorDay: input.cycle.anchorDay, startDate: input.cycle.startDate ?? cycle.startDate }, 'cycle.startDate');
                assertCycleChange(cycle, next, closuresOf(tx.draft, cycle.id), 'cycle.anchorDay');
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
              const cc = budget.buildCostCenter(tx, c);
              tempRefs[`new:${c.tempRef ?? i}`] = cc.id;
              out.created.push(cc.id);
            }
            const refOf = (ref) => tempRefs[ref] ?? ref;

            for (const [i, e] of (input.entries ?? []).entries()) {
              const initialTask = mode === 'branch' && out.taskIds?.length ? (e.taskIndex === undefined && out.taskIds.length === 1 ? out.taskIds[0] : Number.isInteger(e.taskIndex) ? out.taskIds[e.taskIndex] : undefined) : undefined;
              const entry = { ...e, taskId: e.taskId ?? initialTask, budgetId, costCenterRef: refOf(e.costCenterRef) };
              if (e.recurrenceId) {
                // Même validation que l'édition directe, sans écrire hors du budget du parcours.
                const fields = Object.fromEntries(['label', 'amount', 'endDate'].filter(k => k in e).map(k => [k, e[k]]));
                const { recurrence: rec } = budget.patchRecurrence(tx, e.recurrenceId, fields, { budgetId });
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
              budget.patchCaps(tx, budgetId, { merge: true, caps: Object.fromEntries(Object.entries(input.caps).map(([ref, amount]) => [refOf(ref), amount])) });
            }
            if (input.vision) applyVision(tx, comp, input.vision);
            for (const [i, g] of (input.goals ?? []).entries()) {
              if (g.goalId) {
                const goal = om.owned(tx.draft, 'lifeGoal', g.goalId, tx.userId);
                socle.modules.patrimoine.patchGoal(tx, goal.id, g);
                out.updated.push(goal.id);
              } else {
                out.created.push(socle.modules.patrimoine.buildGoal(tx, g).id);
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
              comp = om.create(tx, 'bpmComposition', { label: `BPM de ${tx.draft.users[tx.userId].label}`, budgetId: life.id, patrimoineId: pat.id, coreProjectId: rootId });
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
          assertCycleChange(cycle, next, closuresOf(tx.draft, cycle.id));
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
        // Le bilan du cycle est établi avant l'écriture, avec les données qui produisent le résultat versé ;
        // une clôture refusée (période non terminée, aperçu périmé…) est signalée par la commande elle-même.
        let bilan = null;
        try {
          const contract = closingContract(socle.state, om.requireUser(socle.state, ctx), socle, input.periodKey);
          bilan = { ...bilans.forClosure(ctx, contract.period, contract.preview.resultCents), recordedAt: today() };
        } catch (err) {
          if (!err.code) throw err;
        }
        const r = await om.command('closePeriod', ctx, input, (tx) => recordClosure(tx, input, bilan), { creation: true });
        return { replayed: r.replayed, closure: closureView(socle.state.closures[r.closureId]) };
      },

      // Parcours de clôture de la page « Clôture du cycle » (voir closing.mjs).
      closingJourney: (ctx) => closing.journey(ctx),
      closingBrief: (ctx) => closing.brief(ctx),
      closingDecision: (ctx, input) => closing.decide(ctx, input),
      finalizeClosing: (ctx, input) => closing.finalize(ctx, input),

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
      const comp = compositionOf(state, b.userId);
      const parent = state.budgets[b.parentBudgetId];
      const linked = comp && parent?.id === comp.budgetId && parent.userId === b.userId && b.coreProjectId !== comp.coreProjectId;
      out.push(check('BPM-02', 'integrity', 'bpm', `Projet ${b.name} dans la composition du projet de vie`, 'racine propre, budget père de la composition, même user', linked ? 'relié' : 'liaison incohérente', linked ? 'passed' : 'failed', [b.id, b.coreProjectId, comp?.id].filter(Boolean)));

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

  routes: bpmRoutes,
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
