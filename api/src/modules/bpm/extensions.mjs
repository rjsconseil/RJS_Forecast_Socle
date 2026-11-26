// BPM — ce que l'application apporte aux niveaux du dessous (P1 : le dessus enrichit le dessous par extension) :
// contexte des métriques, sources du calendrier, parcours sur les projets noyau, gardes du cycle sur les écritures du
// Budget, résumé d'un user ; et la composition initiale d'un user (user → projet noyau → Budget → Patrimoine → BPM).
import { cycleFields, assertOpenDates } from '../budget/api.mjs';
import { fail } from '../../socle/errors.mjs';
import { calendarSources } from './calendar-sources.mjs';
import { closuresOf, compositionOf, cycleOf } from './composition.mjs';
import { projectExtensions } from './projects.mjs';
import { closingModeMessage } from './closing.mjs';
import { today } from '../budget/api.mjs';
import { preparationOf, metricContext, nextCycleLock, lockRefusal } from './cycle-state.mjs';

export const bpmExtensions = {
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
};

export const bpmCompositions = {
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
};
