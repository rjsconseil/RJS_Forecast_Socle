// Budget/Patrimoine Management (niveau 3, application). Compose les middlewares Budget et
// Patrimoine sur le noyau : création du user et de son triplet, projets de la vie, cycle et
// clôtures, parcours métier. Chaque chiffre présenté est une métrique dont la formule est
// administrée (`metric.<clé>`) et dont l'explication remonte jusqu'aux objets sources.
import { fail } from '../../socle/errors.mjs';
import { createReads } from './reads.mjs';
import { createLife } from './life.mjs';
import { createBilans } from './bilans.mjs';
import { createMeteo } from './meteo.mjs';
import { createCalendarSources } from './calendar-sources.mjs';
import { closuresOf, compositionOf, cycleOf } from './composition.mjs';
import { DEFAULT_DASHBOARD, METRICS, RESULT_METRIC } from './metrics.mjs';
import { BPM_MIGRATIONS } from './migrations.mjs';
import { bpmRoutes } from './routes.mjs';
import { essentialsParameter } from './natures.mjs';
import { createProjects } from './projects.mjs';
import { createClosing, LOCK_PARAMETER } from './closing.mjs';
import { preparationOf, cycleState, metricContext, closingContract, legacyResultFigure, collectSources } from './cycle-state.mjs';
import { bpmCompositions, bpmExtensions } from './extensions.mjs';
import { principalCommands } from './principal.mjs';
import { bpmInspection } from './inspection.mjs';

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

  extensions: bpmExtensions,

  compositions: bpmCompositions,

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

    const kit = { om, metrics, parameters, requireComposition, lifeProjects, closureView, figuresFor, evaluateFigure, closingOf, reads, projects, life, bilans, recordClosure, closing, calendarReads, meteo, applyVision };
    return {
      compositionOf,
      metricContext: (state, userId, options) => metricContext(state, userId, socle, options),
      reads,
      projects,
      life,
      bilans,
      meteo,
      calendarSources: calendarReads,

      ...principalCommands(socle, kit),
    };
  },

  ...bpmInspection,

  routes: bpmRoutes,
};
