// BPM — l'ensemble principal d'un user : vision et objectifs, préparation et profil de départ, tableau de bord, cycle
// (périodes, configuration, clôture comptable), projets de la vie de l'ensemble.
import { cycleFields, assertCycleChange } from '../budget/api.mjs';
import { fail } from '../../socle/errors.mjs';
import { expectedRevisionOf, oneOf, text } from '../../socle/validation.mjs';
import { CADENCES } from '../budget/api.mjs';
import { closuresOf, compositionOf, cycleOf } from './composition.mjs';
import { GOAL_TYPES } from '../patrimoine/api.mjs';
import { today } from '../budget/api.mjs';
import { preparationOf, cycleState, metricContext, closingContract } from './cycle-state.mjs';

/** Commandes et lectures de l'ensemble principal ; `kit` : la portée de BPM et ses services assemblés (index.mjs). */
export function principalCommands(socle, kit) {
  const { om, parameters, requireComposition, lifeProjects, closureView, figuresFor, evaluateFigure, closingOf, reads, bilans, recordClosure, closing, applyVision } = kit;
  return {
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
          for (const g of input.goals ?? []) {
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
      const userTypeLabel = socle.modules.users.userSummary(userId)?.userTypeLabel ?? user.userType;
      return {
        user: { id: user.id, label: user.label, userType: user.userType, userTypeLabel },
        // Des périodes closes figent le jour d'ancrage et la date de début du cycle [P].
        cycleState: { closedPeriods, frozen: closedPeriods > 0 },
        principal: { budgetId: comp.budgetId, coreProjectId: comp.coreProjectId, project: state.coreProjects[comp.coreProjectId], patrimoine: state.patrimoines[comp.patrimoineId], cycle: cycleOf(state, comp.id), vision: reads.visionOf(comp), revision: comp.revision },
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
      const user = socle.modules.users.userSummary(userId);
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
        cycle: cycle ? { ...cycle, periods: page.periods, periodsTotal: page.total, nextBefore: page.nextBefore, currentKey: cs?.current.key ?? null, firstOpenKey: cs?.firstOpen.key ?? null } : null,
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
}
