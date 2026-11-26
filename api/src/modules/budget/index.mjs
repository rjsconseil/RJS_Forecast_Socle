// Budget Management (niveau 2, middleware). Budgets (« Projet de vie » unique par user,
// Budgets standards des projets de la vie), centres de coût et opérations prévues / réalisées.
// Il fournit les variables sources des calculs ; il ne présente aucun chiffre lui-même.
// Ses interfaces sont des interfaces de test : la création métier passe par le niveau applicatif.
import { projectVariables, fundingChecks } from './project-analysis.mjs';
import { fail } from '../../socle/errors.mjs';
import { check } from '../../socle/object-management/inspect.mjs';
import { today } from '../../socle/clock.mjs';
import { date, expectedRevisionOf, integer, money, oneOf, text } from '../../socle/validation.mjs';
import { CADENCE_LABEL, CADENCES, isOccurrence, occurrenceDates, occurrenceKey, parseOccurrenceKey } from './recurrence.mjs';
import { budgetLines, CAP_LEVEL_PCT, capLevelOf, capReport, isNearCap, NEAR_CAP_USED_PCT, periodSum, STD } from './lines.mjs';
export { budgetLines, CAP_LEVEL_PCT, capLevelOf, capReport, isNearCap, NEAR_CAP_USED_PCT };
import { abandonedRefusal, createFunding, fundingExtensions, isAbandoned } from './funding.mjs';

export const DIRECTIONS = ['income', 'charge'];
const DIRECTION_LABEL = { income: 'Revenu', charge: 'Charge' };
const LIFE_BUDGET_NAME = 'Projet de vie';

const toEuros = (cents) => (cents === null || cents === undefined ? null : cents / 100);

/** Centres standards par défaut [P] : administrables (C08), filtrés par type d'utilisateur. */
const DEFAULT_STANDARD_CENTERS = [
  { key: 'salaires', label: "Salaires et revenus d'activité", direction: 'income' },
  { key: 'autresRevenus', label: 'Autres revenus', direction: 'income' },
  { key: 'allocations', label: 'Allocations familiales', direction: 'income', userTypes: ['famille'] },
  { key: 'logement', label: 'Logement', direction: 'charge' },
  { key: 'alimentation', label: 'Alimentation', direction: 'charge' },
  { key: 'transport', label: 'Transport', direction: 'charge' },
  { key: 'sante', label: 'Santé', direction: 'charge' },
  { key: 'loisirs', label: 'Loisirs', direction: 'charge' },
  { key: 'enfants', label: 'Enfants et scolarité', direction: 'charge', userTypes: ['famille'] },
  { key: 'divers', label: 'Divers', direction: 'charge' },
];

/** Une réalisation ne peut pas être datée dans le futur (C03) : refus explicite, aucun changement de statut. */
function realizedDateOf(value) {
  const d = date('realizedDate', value, { required: true });
  if (d > today()) fail('FUTURE_REALIZATION', `Date de réalisation dans le futur (${d}) : une opération ne peut être réglée qu'à une date passée ou aujourd'hui.`, { field: 'realizedDate', value: d, today: today() });
  return d;
}

export default {
  id: 'budget',
  label: 'Budget Management',
  level: 2,
  role: 'metier',
  dependsOn: ['users', 'core', 'cycle'],
  // P4 · Lecture déclarée : les natures des dépendances que ce middleware lit.
  reads: ['user', 'coreProject', 'task'],
  kinds: {
    // Financement des projets de la vie (funding.mjs) : demandes de part des tâches et dépassements d'enveloppe.
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
    budget: {
      collection: 'budgets',
      prefix: 'bud',
      label: 'Budget',
      references: { coreProjectId: { kind: 'coreProject', required: true }, parentBudgetId: { kind: 'budget' } },
    },
    costCenter: { collection: 'costCenters', prefix: 'cc', label: 'Centre de coût personnalisé' },
    /** Catégorie personnalisée d'un centre de charges : regroupe des dépenses précises, avec un plafond facultatif. */
    chargeCategory: { collection: 'chargeCategories', prefix: 'cat', label: 'Catégorie de dépense' },
    operation: {
      collection: 'operations',
      prefix: 'op',
      label: 'Opération',
      references: { budgetId: { kind: 'budget', required: true }, costCenterId: { kind: 'costCenter' }, categoryId: { kind: 'chargeCategory' }, recurrenceId: { kind: 'recurrence' }, taskId: { kind: 'task' } },
    },
    recurrence: {
      collection: 'recurrences',
      prefix: 'rec',
      label: 'Opération récurrente (définition)',
      references: { budgetId: { kind: 'budget', required: true }, costCenterId: { kind: 'costCenter' }, categoryId: { kind: 'chargeCategory' }, taskId: { kind: 'task' } },
    },
  },

  migrations: [
    {
      from: ['j1-store/0.2', 'socle-store/0.3', 'socle-store/0.4'],
      id: 'budget-recurrences-et-plafonds',
      description: 'Opérations : champs récurrence, occurrence, note et tâche ajoutés vides ; Budgets : plafonds par centre vides. Aucun montant ni date modifié.',
      apply(draft, tx) {
        const changes = [];
        for (const o of Object.values(draft.operations)) {
          if (!('recurrenceId' in o)) {
            Object.assign(o, { recurrenceId: null, occurrenceDate: null, note: null, taskId: null });
            tx.updated.push({ kind: 'operation', id: o.id });
            changes.push(`${o.id} : ponctuelle (aucune récurrence)`);
          }
        }
        for (const b of Object.values(draft.budgets)) {
          if (!('capsCents' in b)) {
            b.capsCents = {};
            tx.updated.push({ kind: 'budget', id: b.id });
            changes.push(`${b.id} : aucun plafond`);
          }
        }
        return changes;
      },
    },
  ],

  parameters: [
    {
      key: 'budget.centresStandards',
      label: 'Centres de coût standards',
      group: 'Budget',
      type: 'list',
      description: "[P] Centres proposés à tous les users. `userTypes` restreint un centre à certains types d'utilisateur (C08).",
      default: DEFAULT_STANDARD_CENTERS,
      validate(value) {
        const keys = value.map((c) => c?.key);
        for (const c of value) {
          if (typeof c?.key !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(c.key) || typeof c.label !== 'string' || !DIRECTIONS.includes(c.direction)) {
            fail('VALIDATION', 'Chaque centre standard a une clé, un libellé et un sens (income ou charge).', { center: c });
          }
        }
        if (new Set(keys).size !== keys.length) fail('VALIDATION', 'Clés de centre en double.');
      },
    },
  ],

  variables: [
    ...projectVariables,
    { name: 'budget.revenusRealises', label: 'Revenus réalisés', unit: 'EUR', description: 'Somme des revenus réalisés datés dans la période, Budget « Projet de vie ».', resolve: (ctx, socle) => periodSum(ctx, socle, { direction: 'income', realized: true }) },
    { name: 'budget.chargesRealisees', label: 'Charges réalisées', unit: 'EUR', description: 'Somme des charges réalisées datées dans la période, Budget « Projet de vie ».', resolve: (ctx, socle) => periodSum(ctx, socle, { direction: 'charge', realized: true }) },
    { name: 'budget.revenusPrevus', label: 'Revenus prévus', unit: 'EUR', description: 'Somme des montants prévus des revenus (opérations et occurrences attendues) dont la date prévue est dans la période, réglés ou non.', resolve: (ctx, socle) => periodSum(ctx, socle, { direction: 'income', realized: false }) },
    { name: 'budget.chargesPrevues', label: 'Charges prévues', unit: 'EUR', description: 'Somme des montants prévus des charges (opérations et occurrences attendues) dont la date prévue est dans la période, réglées ou non.', resolve: (ctx, socle) => periodSum(ctx, socle, { direction: 'charge', realized: false }) },
    { name: 'budget.resteARecevoir', label: 'Revenus restant à recevoir', unit: 'EUR', description: 'Montants prévus des revenus non reçus (opérations et occurrences attendues) dont la date prévue est dans la période.', resolve: (ctx, socle) => periodSum(ctx, socle, { direction: 'income', realized: false, remaining: true }) },
    { name: 'budget.revenusAnticipes', label: 'Revenus reçus d’avance', unit: 'EUR', description: 'Revenus prévus dans la période mais reçus avant son début : ils comptent dans le réalisé de la période où ils ont été reçus.', resolve: (ctx, socle) => periodSum(ctx, socle, { direction: 'income', realized: false, advance: true }) },
    { name: 'budget.chargesAnticipees', label: 'Charges payées d’avance', unit: 'EUR', description: 'Charges prévues dans la période mais payées avant son début : elles comptent dans le réalisé de la période où elles ont été payées.', resolve: (ctx, socle) => periodSum(ctx, socle, { direction: 'charge', realized: false, advance: true }) },
    { name: 'budget.resteAPayer', label: 'Dépenses restant à payer', unit: 'EUR', description: 'Montants prévus des dépenses non payées (opérations et occurrences attendues) dont la date prévue est dans la période.', resolve: (ctx, socle) => periodSum(ctx, socle, { direction: 'charge', realized: false, remaining: true }) },
  ],

  extensions: {
    /** L'ancre de vie d'un user : le Budget « Projet de vie » et sa racine noyau (consommé par Patrimoine, sans dépendance). */
    lifeAnchor(state, userId, socle) {
      const life = socle.om.list(state, 'budget', (b) => b.userId === userId && b.role === 'life')[0];
      return life ? { id: life.id, coreProjectId: life.coreProjectId } : null;
    },
    // Financement des projets : garde de rattachement d'une tâche, retour à sa complétion, validation d'un règlement.
    ...fundingExtensions,
    /** Un projet renommé renomme le Budget dont il est la racine : listes, registre et alertes gardent le même nom. */
    onCoreProjectChange(tx, { project }, socle) {
      // Toute modification du projet réaligne le nom, ce qui rattrape aussi un renommage antérieur à cette règle.
      for (const b of socle.om.list(tx.draft, "budget", (x) => x.coreProjectId === project.id && x.role === "standard" && x.name !== project.title))
        socle.om.update(tx, b, { name: project.title });
    },
    /** Enrichit les projets noyau qui servent de racine à un Budget. */
    coreProjectContext(state, projectId, socle) {
      const budgets = socle.om.list(state, 'budget', (b) => b.coreProjectId === projectId);
      const life = budgets.find((b) => b.role === 'life');
      const standard = budgets.find((b) => b.role === 'standard');
      const financial = { status: 'not-implemented', note: 'Provision et consommation monétaires des projets : contexte C05 ouvert.' };
      if (life) {
        const branches = socle.om
          .list(state, 'budget', (b) => b.role === 'standard' && b.parentBudgetId === life.id)
          .map((b) => ({ budgetId: b.id, budgetName: b.name, coreProjectId: b.coreProjectId, projectTitle: state.coreProjects[b.coreProjectId]?.title ?? null }));
        return { enrichment: { kind: 'life', label: 'Racine principale (projet de vie)', budgetId: life.id, budgetName: life.name, parentBudgetId: null, branches, financial } };
      }
      if (standard) {
        const parent = state.budgets[standard.parentBudgetId] ?? null;
        return {
          enrichment: { kind: 'standard', label: 'Racine de branche (projet de la vie)', budgetId: standard.id, budgetName: standard.name, parentBudgetId: standard.parentBudgetId, parentBudgetName: parent?.name ?? null, financial },
        };
      }
      return {};
    },
  },

  setup(socle) {
    const { om, parameters } = socle;

    const lifeBudgetOf = (state, userId) => om.list(state, 'budget', (b) => b.userId === userId && b.role === 'life')[0] ?? null;

    function costCentersOf(state, userId) {
      const user = om.get(state, 'user', userId);
      const standard = parameters
        .value(state, 'budget.centresStandards')
        .filter((c) => !c.userTypes || c.userTypes.includes(user?.userType))
        .map((c) => ({ ref: STD + c.key, key: c.key, label: c.label, direction: c.direction, directionLabel: DIRECTION_LABEL[c.direction], standard: true }));
      const custom = om
        .list(state, 'costCenter', (c) => c.userId === userId)
        .map((c) => ({ ref: c.id, id: c.id, label: c.label, direction: c.direction, directionLabel: DIRECTION_LABEL[c.direction], standard: false }));
      return [...standard, ...custom];
    }

    /** Résout la référence de centre : standard (`std:<clé>`) ou centre personnalisé (ID). */
    function costCenterFields(state, userId, ref, direction) {
      const center = costCentersOf(state, userId).find((c) => c.ref === ref);
      if (!center) fail('REFERENCE_NOT_FOUND', 'Centre de coût inconnu pour ce user.', { field: 'costCenterRef', ref });
      if (center.direction !== direction) fail('INCOMPATIBLE_REFERENCE', `Ce centre de coût concerne les ${center.direction === 'income' ? 'revenus' : 'charges'}.`, { field: 'costCenterRef' });
      return center.standard ? { standardCostCenter: center.key, costCenterId: null } : { standardCostCenter: null, costCenterId: center.id };
    }

    const costCenterLabel = (state, o) =>
      o.costCenterId
        ? state.costCenters[o.costCenterId]?.label ?? null
        : parameters.value(state, 'budget.centresStandards').find((c) => c.key === o.standardCostCenter)?.label ?? `${o.standardCostCenter} (retiré)`;

    const categoryLabel = (state, o) => (o.categoryId ? state.chargeCategories?.[o.categoryId]?.label ?? null : null);

    function categoriesOf(state, userId, { archived = false } = {}) {
      return om
        .list(state, 'chargeCategory', (k) => k.userId === userId && (archived || !k.archived))
        .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
    }

    /** Libellé d'une catégorie active, unique dans son centre (sans tenir compte de la casse). */
    function uniqueCategoryLabel(state, userId, ref, label, exceptId = null) {
      const same = (k) => k.id !== exceptId && k.costCenterRef === ref && k.label.toLocaleLowerCase('fr') === label.toLocaleLowerCase('fr');
      if (categoriesOf(state, userId).some(same)) fail('UNIQUENESS_VIOLATION', `La catégorie « ${label} » existe déjà dans ce centre.`, { field: 'label' });
      return label;
    }

    function categoryView(state, k) {
      const center = costCentersOf(state, k.userId).find((c) => c.ref === k.costCenterRef);
      return { ...structuredClone(k), capCents: k.capCents ?? null, costCenterLabel: center?.label ?? `${k.costCenterRef} (retiré)` };
    }

    /**
     * Catégorie d'une dépense : facultative, du user, active, dans le centre de la dépense. Elle ne
     * concerne que les charges ; une catégorie choisie sans centre donne son centre à la dépense.
     */
    function categoryFor(state, userId, categoryId, { direction, costCenterRef }) {
      if (categoryId === undefined || categoryId === null || categoryId === '') return null;
      const k = om.owned(state, 'chargeCategory', categoryId, userId);
      if (k.archived) fail('FORBIDDEN_BY_RULE', `La catégorie « ${k.label} » est retirée : choisissez-en une autre.`, { field: 'categoryId' });
      if (direction !== 'charge') fail('INCOMPATIBLE_REFERENCE', 'Une catégorie de dépense ne concerne que les charges.', { field: 'categoryId' });
      if (costCenterRef && costCenterRef !== k.costCenterRef) fail('INCOMPATIBLE_REFERENCE', `La catégorie « ${k.label} » appartient à un autre centre de coût.`, { field: 'categoryId' });
      return k;
    }

    /**
     * Catégorie après modification d'une dépense : celle demandée, sinon l'actuelle tant qu'elle reste dans le
     * centre de la dépense ; un changement de centre ou de sens détache une catégorie devenue incohérente.
     */
    function categoryPatch(state, userId, current, input, next) {
      const ref = next.costCenterId ?? (next.standardCostCenter ? STD + next.standardCostCenter : null) ?? current.costCenterId ?? STD + current.standardCostCenter;
      // Catégorie inchangée : elle reste sur la dépense (même retirée) tant qu'elle reste cohérente avec son centre.
      const same = 'categoryId' in input && (input.categoryId || null) === (current.categoryId ?? null);
      if ('categoryId' in input && !same) return { categoryId: categoryFor(state, userId, input.categoryId, { direction: next.direction, costCenterRef: ref })?.id ?? null };
      const k = current.categoryId ? state.chargeCategories?.[current.categoryId] : null;
      return k && (next.direction !== 'charge' || k.costCenterRef !== ref) ? { categoryId: null } : {};
    }

    /**
     * Garde des niveaux supérieurs (ex. période close) sur les dates d'une opération. `opens` : dates prévues que
     * l'écriture ouvre (prévision créée ou déplacée), pour les niveaux qui figent la liste des échéances d'un cycle.
     * `carried` : report décidé par la clôture d'un cycle (les niveaux supérieurs savent qu'il en fait partie).
     */
    function guard(state, op, dates, opens = [], { carried = false } = {}) {
      for (const ext of socle.registry.extensions('operationGuard')) {
        ext(state, { userId: op.userId, budgetId: op.budgetId, dates, independentIncome: op.independentIncome, opens, carried }, socle);
      }
    }

    /**
     * Garde des niveaux supérieurs sur une définition récurrente : `from` → `to` (null = sans fin) couvre les
     * occurrences que la création, la modification ou la suppression touche (ex. cycle qui attend sa clôture).
     * `opens` : la création ou la modification ouvre des échéances (la suppression n'en ouvre aucune).
     */
    function definitionGuard(state, { userId, budgetId }, from, to, opens = false) {
      for (const ext of socle.registry.extensions('recurrenceGuard')) ext(state, { userId, budgetId, from, to, opens }, socle);
    }

    const funding = createFunding(socle, { lifeBudgetOf });
    const postsProjectIncome = (state, budgetId, direction) => state.budgets[budgetId]?.role === 'standard' && direction === 'income';
    const plannedFunding = (state, budgetId, input) => {
      if (state.budgets[budgetId]?.role !== 'standard' || !('fundingSource' in input)) return {};
      return { plannedFundingSource: input.fundingSource == null ? null : oneOf('fundingSource', input.fundingSource, ['cycle', 'patrimoine']) };
    };

    // Un règlement de tâche conserve son paiement et choisit séparément son imputation.
    function projectAccounting(state, budgetId, input, realizedDate, previous = {}) {
      const b = state.budgets[budgetId];
      if (b?.role !== 'standard') return {};
      const fundingSource = oneOf('fundingSource', input.fundingSource ?? previous.fundingSource ?? previous.plannedFundingSource ?? b.fundingSource ?? 'cycle', ['cycle', 'patrimoine']);
      const accountingDate = date('accountingDate', input.accountingDate ?? realizedDate, { required: true });
      if (accountingDate < realizedDate) fail('VALIDATION', 'La validation ne peut pas précéder le paiement ou la réception.', { field: 'accountingDate' });
      if (accountingDate > today()) fail('FUTURE_REALIZATION', 'La validation ne peut pas être imputée dans le futur.', { field: 'accountingDate' });
      return { fundingSource, accountingDate };
    }
    function settlementDates(state, budgetId, values) {
      return state.budgets[budgetId]?.role === 'standard' ? [values.accountingDate ?? values.realizedDate].filter(Boolean) : [values.realizedDate].filter(Boolean);
    }


    /**
     * Garde des niveaux supérieurs sur la validation d'un règlement (opération réglée, réalisation,
     * règlement d'une occurrence) : par exemple le dépassement du budget attribué à un projet.
     */
    function settlementGuard(tx, input, fund) {
      // Règlement financé : la part et le dépassement nécessaires sont accordés dans la même écriture.
      if (fund === true) funding.fundSettlement(tx, input);
      for (const ext of socle.registry.extensions('settlementGuard')) ext(tx.draft, { ...input, authorizeTaskOverrun: fund === true }, socle);
    }

    const operationView = (state, o) => ({
      ...structuredClone(o),
      amount: toEuros(o.amountCents),
      realizedAmount: toEuros(o.realizedAmountCents),
      directionLabel: DIRECTION_LABEL[o.direction],
      costCenterRef: o.costCenterId ?? STD + o.standardCostCenter,
      costCenterLabel: costCenterLabel(state, o),
      categoryId: o.categoryId ?? null,
      categoryLabel: categoryLabel(state, o),
      budgetName: state.budgets[o.budgetId]?.name ?? null,
    });

    function operationsOf(state, budgetId, { from, to } = {}) {
      return om
        .list(state, 'operation', (o) => o.budgetId === budgetId)
        .filter((o) => {
          const d = o.realizedDate ?? o.date;
          return (!from || d >= from) && (!to || d <= to);
        })
        .sort((a, b) => (b.realizedDate ?? b.date).localeCompare(a.realizedDate ?? a.date) || b.createdAt.localeCompare(a.createdAt))
        .map((o) => operationView(state, o));
    }

    function budgetView(state, b) {
      const ops = om.by(state, 'operation', 'budgetId', b.id);
      return {
        ...structuredClone(b),
        projectTitle: state.coreProjects[b.coreProjectId]?.title ?? null,
        parentBudgetName: b.parentBudgetId ? state.budgets[b.parentBudgetId]?.name ?? null : null,
        operationCount: ops.length,
        realizedCount: ops.filter((o) => o.status === 'realized').length,
        cancelledCount: ops.filter((o) => o.status === 'cancelled').length,
      };
    }

    /** Tâche éventuelle d'une opération : seulement une tâche du projet de la vie de ce Budget (branche). */
    function taskFor(state, userId, budget, taskId) {
      if (taskId === undefined || taskId === null || taskId === '') {
        // Un projet de la vie n'a de dépenses et de gains qu'au niveau de ses tâches (docs/COMPTABILITE-PROJET-DE-VIE.md).
        if (budget.role === 'standard') fail('VALIDATION', 'Une dépense ou un gain d’un projet de la vie se saisit sur l’une de ses tâches.', { field: 'taskId' });
        return null;
      }
      const t = om.owned(state, 'task', taskId, userId);
      if (budget.role !== 'standard' || t.projectId !== budget.coreProjectId) {
        fail('INCOMPATIBLE_REFERENCE', 'La tâche doit appartenir au projet de la vie de ce Budget.', { field: 'taskId' });
      }
      return t.id;
    }

    const note = (v) => text('note', v, { max: 1000 }) || null;

    const recurrenceView = (state, r) => ({
      ...structuredClone(r),
      amount: toEuros(r.amountCents),
      cadenceLabel: CADENCE_LABEL[r.cadence],
      directionLabel: DIRECTION_LABEL[r.direction],
      costCenterRef: r.costCenterId ?? STD + r.standardCostCenter,
      costCenterLabel: costCenterLabel(state, r),
      categoryId: r.categoryId ?? null,
      categoryLabel: categoryLabel(state, r),
      budgetName: state.budgets[r.budgetId]?.name ?? null,
      settlementIds: om.by(state, 'operation', 'recurrenceId', r.id).map((o) => o.id),
    });

    /** Ligne de `budgetLines` enrichie pour l'affichage (centre, Budget, cadence). */
    const lineView = (state, l) => {
      const rec = l.recurrenceId ? state.recurrences[l.recurrenceId] : null;
      return {
        ...l,
        costCenterRef: l.costCenterId ?? STD + l.standardCostCenter,
        costCenterLabel: costCenterLabel(state, l),
        categoryLabel: categoryLabel(state, l),
        budgetName: state.budgets[l.budgetId]?.name ?? null,
        budgetRole: state.budgets[l.budgetId]?.role ?? null,
        cadence: rec?.cadence ?? 'once',
        cadenceLabel: CADENCE_LABEL[rec?.cadence ?? 'once'],
        firstDate: rec?.firstDate ?? null,
        endDate: rec?.endDate ?? null,
        taskTitle: l.taskId ? state.tasks[l.taskId]?.title ?? null : null,
        differenceCents: l.settled ? l.realizedCents - l.plannedCents : null,
      };
    };

    return {
      DIRECTIONS,
      /** Financement des projets de la vie : règles et commandes (enveloppe, parts, retours, demandes, dépassements). */
      funding,
      budgetLines,
      lineView,
      recurrenceView,
      lifeBudgetOf,
      costCentersOf,
      categoriesOf,
      categoryView,
      capReport,
      operationsOf,
      operationView,

      migrateObjectives(tx, id, legacy) {
        if (!legacy) return;
        const b = om.owned(tx.draft, 'budget', id, tx.userId);
        const fields = Object.fromEntries(['savingsTargetCents', 'surplus'].filter(k => k in legacy).map(k => [k, legacy[k]]));
        if (Object.keys(fields).length) om.update(tx, b, { objectives: { ...fields, ...(b.objectives ?? {}) } });
      },
      surplusProgress(closures, target) {
        if (!target) return null;
        const selected = closures.filter(c => c.periodKey >= target.startKey);
        const cumulatedCents = selected.reduce((sum, c) => sum + c.resultCents, 0);
        return { ...target, perPeriodCents: Math.ceil(target.targetCents / target.periods), cumulatedCents,
          closedPeriods: selected.length, progressPct: target.targetCents > 0 ? Math.round(cumulatedCents / target.targetCents * 1000) / 10 : null };
      },
      objectivesOf: (state, id) => ({ savingsTargetCents: null, surplus: null, ...(state.budgets[id]?.objectives ?? {}) }),
      patchObjectives(tx, id, input) {
        if (!('savingsTarget' in input) && !('surplus' in input)) return;
        const b = om.owned(tx.draft, 'budget', id, tx.userId);
        const v = this.objectivesOf(tx.draft, id);
      if ('savingsTarget' in input) v.savingsTargetCents = money('savingsTarget', input.savingsTarget, { nullable: true });
      if ('surplus' in input) {
        const sp = input.surplus;
        v.surplus = sp === null ? null : { targetCents: money('surplus.target', sp?.target, { positive: true }), periods: integer('surplus.periods', sp?.periods, { min: 1, max: 600 }), startKey: /^\d{4}-(0[1-9]|1[0-2])$/.test(sp?.startKey ?? '') ? sp.startKey : fail('VALIDATION', 'Période de départ AAAA-MM attendue.', { field: 'surplus.startKey' }) };
      }
        om.update(tx, b, { objectives: v });
      },

      // ---------- builders ----------

      /** Budget « Projet de vie » : unique par user (VIE-01), nom imposé. */
      buildLifeBudget(tx, { coreProjectId }) {
        if (lifeBudgetOf(tx.draft, tx.userId)) fail('UNIQUENESS_VIOLATION', 'Ce user possède déjà son Budget « Projet de vie ».', { userId: tx.userId });
        if (om.list(tx.draft, 'budget', b => b.coreProjectId === coreProjectId).length) fail('UNIQUENESS_VIOLATION', 'Ce projet noyau sert déjà de racine à un Budget.', { coreProjectId });
        return om.create(tx, 'budget', { role: 'life', name: LIFE_BUDGET_NAME, coreProjectId, parentBudgetId: null, capsCents: {} });
      },

      /** Budget standard d'un projet de la vie : enfant du Budget « Projet de vie », racine noyau propre. */
      buildStandardBudget(tx, { coreProjectId, parentBudgetId, name }) {
        const parent = om.owned(tx.draft, 'budget', parentBudgetId, tx.userId);
        if (parent.role !== 'life') fail('INCOMPATIBLE_REFERENCE', 'Le père doit être le Budget « Projet de vie ».', { parentBudgetId });
        if (om.list(tx.draft, 'budget', (b) => b.coreProjectId === coreProjectId).length) {
          fail('UNIQUENESS_VIOLATION', 'Ce projet noyau sert déjà de racine à un Budget.', { coreProjectId });
        }
        return om.create(tx, 'budget', { role: 'standard', name: text('name', name, { required: true, max: 200 }), coreProjectId, parentBudgetId, capsCents: {} });
      },

      // ---------- commandes ----------

      /** Opération ponctuelle (prévue ou réalisée) ; utilisable dans une commande composée. */
      buildOperation(tx, input = {}) {
        const budgetId = input.budgetId ?? lifeBudgetOf(tx.draft, tx.userId)?.id;
        if (!budgetId) fail('REFERENCE_NOT_FOUND', 'Aucun Budget « Projet de vie » pour ce user.', { field: 'budgetId' });
        om.owned(tx.draft, 'budget', budgetId, tx.userId);
        const direction = oneOf('direction', input.direction, DIRECTIONS);
        const status = oneOf('status', input.status, ['planned', 'realized'], 'planned');
        const amountCents = money('amount', input.amount, { positive: true });
        const opDate = date('date', input.date, { required: true });
        const realizedAmountCents = status === 'realized' ? money('realizedAmount', input.realizedAmount ?? input.amount, { positive: true }) : null;
        const realizedDate = status === 'realized' ? realizedDateOf(input.realizedDate ?? input.date) : null;
        const budget = tx.draft.budgets[budgetId];
        const cat = categoryFor(tx.draft, tx.userId, input.categoryId, { direction, costCenterRef: input.costCenterRef });
        const fields = {
          recurrenceId: null,
          occurrenceDate: null,
          note: note(input.note),
          taskId: taskFor(tx.draft, tx.userId, budget, input.taskId),
          budgetId,
          direction,
          label: text('label', input.label, { required: true, max: 200 }),
          amountCents,
          date: opDate,
          status,
          realizedAmountCents,
          realizedDate,
          ...plannedFunding(tx.draft, budgetId, input),
          ...(status === 'realized' ? projectAccounting(tx.draft, budgetId, input, realizedDate) : {}),
          ...(status === 'realized' && postsProjectIncome(tx.draft, budgetId, direction) ? { independentIncome: true } : {}),
          ...costCenterFields(tx.draft, tx.userId, input.costCenterRef || cat?.costCenterRef, direction),
          categoryId: cat?.id ?? null,
          // Statut et jour de la saisie : une prévision ouvre un point à suivre du cycle, une saisie réglée n'en ouvre pas.
          entryStatus: status,
          enteredOn: today(),
        };
        guard(tx.draft, { ...fields, userId: tx.userId }, status === 'realized' && budget.role === 'standard' ? settlementDates(tx.draft, budgetId, fields) : [opDate, realizedDate].filter(Boolean), status === 'planned' ? [opDate] : []);
        if (status === 'realized') settlementGuard(tx, { userId: tx.userId, budgetId, direction, amountCents: realizedAmountCents, realizedDate, accountingDate: fields.accountingDate, fundingSource: fields.fundingSource, taskId: fields.taskId, operationId: null }, input.fund);
        return om.create(tx, 'operation', fields);
      },

      async createOperation(ctx, input = {}) {
        const r = await om.command('createOperation', ctx, input, (tx) => ({ operationId: this.buildOperation(tx, input).id }), { creation: true });
        return { replayed: r.replayed, operation: operationView(socle.state, socle.state.operations[r.operationId]) };
      },

      async updateOperation(ctx, id, input = {}) {
        await om.command('updateOperation', ctx, input, (tx) => {
          const o = om.owned(tx.draft, 'operation', id, tx.userId);
          om.checkRevision(o, expectedRevisionOf(input));
          if (o.status === 'cancelled') fail('FORBIDDEN_BY_RULE', 'Cette saisie est annulée : elle ne se modifie plus.', { operationId: id });
          const direction = 'direction' in input ? oneOf('direction', input.direction, DIRECTIONS) : o.direction;
          const patch = {
            direction,
            label: 'label' in input ? text('label', input.label, { required: true, max: 200 }) : o.label,
            amountCents: 'amount' in input ? money('amount', input.amount, { positive: true }) : o.amountCents,
            date: 'date' in input ? date('date', input.date, { required: true }) : o.date,
          };
          if ('costCenterRef' in input || direction !== o.direction) {
            Object.assign(patch, costCenterFields(tx.draft, tx.userId, input.costCenterRef ?? (o.costCenterId ?? STD + o.standardCostCenter), direction));
          }
          Object.assign(patch, categoryPatch(tx.draft, tx.userId, o, input, { direction, ...patch }));
          if ('note' in input) patch.note = note(input.note);
          if (o.status !== 'realized') Object.assign(patch, plannedFunding(tx.draft, o.budgetId, input));
          if ('taskId' in input) patch.taskId = taskFor(tx.draft, tx.userId, tx.draft.budgets[o.budgetId], input.taskId);
          // Une occurrence garde son identité : sa date prévue reste celle de la définition.
          if (o.recurrenceId && patch.date !== o.date) fail('FORBIDDEN_BY_RULE', "La date prévue d'une occurrence est fixée par sa définition récurrente.", { field: 'date' });
          const changesSense = o.status === 'realized' && patch.direction !== o.direction;
          if (changesSense) patch.independentIncome = postsProjectIncome(tx.draft, o.budgetId, patch.direction);
          const dates = o.independentIncome || patch.independentIncome
            ? settlementDates(tx.draft, o.budgetId, o) : [o.date, o.accountingDate ?? o.realizedDate, patch.date].filter(Boolean);
          guard(tx.draft, { ...o, independentIncome: o.independentIncome || patch.independentIncome }, dates, o.status === 'planned' && patch.date !== o.date ? [patch.date] : []);
          // Changer la tâche ou le sens d'une charge déjà réglée ne contourne pas le financement de la tâche.
          if (o.status === 'realized' && (patch.direction !== o.direction || patch.taskId !== undefined && patch.taskId !== o.taskId)) {
            settlementGuard(tx, { userId: o.userId, budgetId: o.budgetId, direction: patch.direction, amountCents: o.realizedAmountCents, realizedDate: o.realizedDate, accountingDate: o.accountingDate, fundingSource: o.fundingSource, taskId: patch.taskId !== undefined ? patch.taskId : o.taskId, operationId: o.id }, input.fund);
          }
          om.update(tx, o, patch);
          return { operationId: id };
        });
        return { operation: operationView(socle.state, socle.state.operations[id]) };
      },

      /** Réalisation manuelle [P] (C06 : la réalisation automatique reste ouverte). */
      async realizeOperation(ctx, id, input = {}) {
        await om.command('realizeOperation', ctx, input, (tx) => {
          const o = om.owned(tx.draft, 'operation', id, tx.userId);
          om.checkRevision(o, expectedRevisionOf(input));
          if (o.status === 'realized') fail('ALREADY_SETTLED', 'Cette opération est déjà réglée.', { operationId: id, realizedDate: o.realizedDate });
          if (o.status === 'cancelled') fail('FORBIDDEN_BY_RULE', 'Cette saisie est annulée : saisissez une nouvelle opération.', { operationId: id });
          const patch = {
            status: 'realized',
            realizedAmountCents: money('realizedAmount', input.realizedAmount ?? toEuros(o.amountCents), { positive: true }),
            realizedDate: realizedDateOf(input.realizedDate ?? o.date),
            // Moment du règlement : le point à suivre de cette prévision se clôt à cet instant.
            closedAt: tx.now, closedOn: today(),
          };
          Object.assign(patch, projectAccounting(tx.draft, o.budgetId, input, patch.realizedDate, o));
          if (postsProjectIncome(tx.draft, o.budgetId, o.direction)) patch.independentIncome = true;
          taskFor(tx.draft, tx.userId, tx.draft.budgets[o.budgetId], o.taskId);
          guard(tx.draft, { ...o, ...patch }, settlementDates(tx.draft, o.budgetId, patch));
          settlementGuard(tx, { userId: o.userId, budgetId: o.budgetId, direction: o.direction, amountCents: patch.realizedAmountCents, realizedDate: patch.realizedDate, accountingDate: patch.accountingDate, fundingSource: patch.fundingSource, taskId: o.taskId ?? null, operationId: o.id }, input.fund);
          om.update(tx, o, patch);
          return { operationId: id };
        });
        return { operation: operationView(socle.state, socle.state.operations[id]) };
      },

      /**
       * Annule un règlement (retour à « prévu ») tant que sa période de règlement n'est pas close.
       * L'opération garde son identité ; une occurrence redevient attendue avec la même clé.
       */
      async cancelRealization(ctx, id, input = {}) {
        await om.command('cancelRealization', ctx, input, (tx) => {
          const o = om.owned(tx.draft, 'operation', id, tx.userId);
          om.checkRevision(o, expectedRevisionOf(input));
          if (o.status !== 'realized') fail('FORBIDDEN_BY_RULE', "Cette opération n'est pas réglée.", { operationId: id });
          guard(tx.draft, o, settlementDates(tx.draft, o.budgetId, o));
          om.update(tx, o, { status: 'planned', realizedAmountCents: null, realizedDate: null, closedAt: null, closedOn: null, accountingDate: null, fundingSource: null, ...(o.independentIncome ? { independentIncome: false } : {}) });
          return { operationId: id };
        });
        return { operation: operationView(socle.state, socle.state.operations[id]) };
      },

      /**
       * Annule une saisie ponctuelle (doublon, erreur) : elle sort de toutes les sommes et de toutes les listes,
       * mais reste dans la base, avec son état d'avant. Refusé dans une période close (même garde que toute écriture),
       * et pour une occurrence récurrente, qui s'annule par son règlement (`cancelRealization`).
       */
      async cancelOperation(ctx, id, input = {}) {
        await om.command('cancelOperation', ctx, input, (tx) => {
          const o = om.owned(tx.draft, 'operation', id, tx.userId);
          om.checkRevision(o, expectedRevisionOf(input));
          if (o.status === 'cancelled') fail('FORBIDDEN_BY_RULE', 'Cette saisie est déjà annulée.', { operationId: id });
          if (o.recurrenceId) fail('FORBIDDEN_BY_RULE', "Une occurrence récurrente ne s'annule pas : annulez son règlement, ou modifiez sa définition.", { operationId: id, recurrenceId: o.recurrenceId });
          guard(tx.draft, o, (o.status === 'realized' && tx.draft.budgets[o.budgetId]?.role === 'standard' ? settlementDates(tx.draft, o.budgetId, o) : [o.date, o.realizedDate].filter(Boolean)));
          om.update(tx, o, { status: 'cancelled', cancelledFrom: o.status, cancelReason: 'reason' in input ? note(input.reason) : null, closedAt: tx.now, closedOn: today() });
          return { operationId: id };
        });
        return { operation: operationView(socle.state, socle.state.operations[id]) };
      },

      /** Saisie unique (éditeur partagé) : ponctuelle → opération ; cadence → définition récurrente, jamais ignorée. */
      async createEntry(ctx, input = {}) {
        const cadence = oneOf('cadence', input.cadence, ['once', ...CADENCES], 'once');
        return cadence === 'once' ? this.createOperation(ctx, input) : this.createRecurrence(ctx, input);
      },

      buildRecurrence(tx, input) {
        const budgetId = input.budgetId ?? lifeBudgetOf(tx.draft, tx.userId)?.id;
        if (!budgetId) fail('REFERENCE_NOT_FOUND', 'Aucun Budget « Projet de vie » pour ce user.', { field: 'budgetId' });
        const budget = om.owned(tx.draft, 'budget', budgetId, tx.userId);
        if (isAbandoned(budget)) abandonedRefusal(budget);
        const direction = oneOf('direction', input.direction, DIRECTIONS);
        const firstDate = date('firstDate', input.firstDate ?? input.date, { required: true });
        const endDate = date('endDate', input.endDate);
        if (endDate && endDate < firstDate) fail('VALIDATION', 'La fin ne peut pas précéder la première date.', { field: 'endDate' });
        const cat = categoryFor(tx.draft, tx.userId, input.categoryId, { direction, costCenterRef: input.costCenterRef });
        definitionGuard(tx.draft, { userId: tx.userId, budgetId }, firstDate, endDate, true);
        return om.create(tx, 'recurrence', {
          budgetId,
          direction,
          label: text('label', input.label, { required: true, max: 200 }),
          amountCents: money('amount', input.amount, { positive: true }),
          cadence: oneOf('cadence', input.cadence, CADENCES),
          firstDate,
          endDate,
          note: note(input.note),
          taskId: taskFor(tx.draft, tx.userId, budget, input.taskId),
          ...plannedFunding(tx.draft, budgetId, input),
          ...costCenterFields(tx.draft, tx.userId, input.costCenterRef || cat?.costCenterRef, direction),
          categoryId: cat?.id ?? null,
          enteredOn: today(),
        });
      },

      async createRecurrence(ctx, input = {}) {
        const r = await om.command('createRecurrence', ctx, input, (tx) => ({ recurrenceId: this.buildRecurrence(tx, input).id }), { creation: true });
        return { replayed: r.replayed, recurrence: recurrenceView(socle.state, socle.state.recurrences[r.recurrenceId]) };
      },

      patchRecurrence(tx, id, input = {}, { budgetId } = {}) {
          const r = om.owned(tx.draft, 'recurrence', id, tx.userId);
          if (budgetId && r.budgetId !== budgetId) fail('INCOMPATIBLE_REFERENCE', 'Cette récurrence appartient à un autre budget.', { field: 'recurrenceId', budgetId });
          const settlements = om.list(tx.draft, 'operation', (o) => o.recurrenceId === id);
          const patch = {};
          if ('label' in input) patch.label = text('label', input.label, { required: true, max: 200 });
          if ('amount' in input) patch.amountCents = money('amount', input.amount, { positive: true });
          if ('note' in input) patch.note = note(input.note);
          Object.assign(patch, plannedFunding(tx.draft, r.budgetId, input));
          if ('cadence' in input || 'firstDate' in input) {
            if (settlements.length) fail('FORBIDDEN_BY_RULE', 'Des occurrences sont déjà réglées : la cadence et la première date sont figées. Terminez cette définition et créez-en une nouvelle.', { field: 'firstDate' });
            if ('cadence' in input) patch.cadence = oneOf('cadence', input.cadence, CADENCES);
            if ('firstDate' in input) patch.firstDate = date('firstDate', input.firstDate, { required: true });
          }
          if ('endDate' in input) patch.endDate = date('endDate', input.endDate);
          const firstDate = patch.firstDate ?? r.firstDate;
          const endDate = 'endDate' in patch ? patch.endDate : r.endDate;
          if (endDate && endDate < firstDate) fail('VALIDATION', 'La fin ne peut pas précéder la première date.', { field: 'endDate' });
          // Une fin posée garde tout ce qui a eu lieu : aucune échéance réglée après la dernière échéance prévue.
          // Les échéances encore attendues au-delà (prévisions modifiées, matérialisées) tombent avec la définition.
          const beyond = patch.endDate ? settlements.filter((o) => o.occurrenceDate && o.occurrenceDate > patch.endDate) : [];
          const settledBeyond = beyond.filter((o) => o.status === 'realized').map((o) => o.occurrenceDate).sort();
          if (settledBeyond.length)
            fail('VALIDATION', `Une échéance du ${settledBeyond.at(-1)} est déjà réglée : la dernière échéance ne peut pas la précéder.`, { field: 'endDate', lastSettled: settledBeyond.at(-1) });
          if ('costCenterRef' in input) Object.assign(patch, costCenterFields(tx.draft, tx.userId, input.costCenterRef, r.direction));
          Object.assign(patch, categoryPatch(tx.draft, tx.userId, r, input, { direction: r.direction, ...patch }));
          if ('taskId' in input) patch.taskId = taskFor(tx.draft, tx.userId, tx.draft.budgets[r.budgetId], input.taskId);
          // Occurrences touchées : celles de la définition avant et après la modification.
          definitionGuard(tx.draft, r, firstDate < r.firstDate ? firstDate : r.firstDate, endDate == null || r.endDate == null ? null : endDate > r.endDate ? endDate : r.endDate, true);
          om.update(tx, r, patch);
          for (const o of beyond) if (o.status === 'planned') om.update(tx, o, { status: 'cancelled', cancelledFrom: 'planned', cancelReason: 'Après la dernière échéance de la définition', closedAt: tx.now, closedOn: today() });
          return { recurrence: r, scope: { appliesTo: 'occurrences encore attendues', settledUntouched: settlements.length } };
      },

      /**
       * Modifie une définition. Portée : les occurrences encore attendues ; les règlements déjà
       * enregistrés gardent leurs dates et montants. La première date est figée dès qu'un règlement existe.
       */
      async updateRecurrence(ctx, id, input = {}) {
        let scope;
        await om.command('updateRecurrence', ctx, input, (tx) => {
          om.checkRevision(om.owned(tx.draft, 'recurrence', id, tx.userId), expectedRevisionOf(input));
          scope = this.patchRecurrence(tx, id, input).scope;
          return { recurrenceId: id };
        });
        return { recurrence: recurrenceView(socle.state, socle.state.recurrences[id]), scope };
      },

      /**
       * Règlement d'une occurrence attendue : crée l'opération réglée (date et montant prévus de la
       * définition, date et montant réels saisis). Un second règlement de la même occurrence est refusé.
       * Règle retenue [P] : une échéance d'une période close peut être réglée plus tard ; le règlement
       * compte dans le réalisé de sa date réelle, l'historique clos n'est pas modifié.
       */
      async settleOccurrence(ctx, recurrenceId, input = {}) {
        const r = await om.command(
          'settleOccurrence',
          ctx,
          input,
          (tx) => {
            const rec = om.owned(tx.draft, 'recurrence', recurrenceId, tx.userId);
            const occurrenceDate = date('occurrenceDate', input.occurrenceDate, { required: true });
            if (!isOccurrence(rec, occurrenceDate)) fail('VALIDATION', "Cette date n'est pas une occurrence de la définition.", { field: 'occurrenceDate' });
            const existing = om.list(tx.draft, 'operation', (o) => o.recurrenceId === rec.id && o.occurrenceDate === occurrenceDate)[0];
            if (existing?.status === 'realized') fail('ALREADY_SETTLED', 'Cette occurrence est déjà réglée.', { operationId: existing.id, realizedDate: existing.realizedDate });
            // Une occurrence matérialisée conserve sa tâche et son sens, même après annulation.
            // La garde contrôle les valeurs effectivement portées par l'opération qui sera réglée.
            const taskId = existing ? existing.taskId ?? null : rec.taskId ?? null;
            const direction = existing ? existing.direction : rec.direction;
            const realizedDate = realizedDateOf(input.realizedDate ?? occurrenceDate);
            const realizedAmountCents = money('realizedAmount', input.realizedAmount ?? toEuros(rec.amountCents), { positive: true });
            const accounting = projectAccounting(tx.draft, rec.budgetId, input, realizedDate, {
              ...existing, plannedFundingSource: rec.plannedFundingSource,
            });
            if (postsProjectIncome(tx.draft, rec.budgetId, direction)) accounting.independentIncome = true;
            taskFor(tx.draft, tx.userId, tx.draft.budgets[rec.budgetId], taskId);
            guard(tx.draft, { ...rec, ...accounting }, settlementDates(tx.draft, rec.budgetId, { realizedDate, ...accounting }));
            settlementGuard(tx, { userId: rec.userId, budgetId: rec.budgetId, direction, amountCents: realizedAmountCents, realizedDate, ...accounting, taskId, operationId: existing?.id ?? null, recurrenceId: rec.id, occurrenceDate }, input.fund);
            if (existing) {
              om.update(tx, existing, { status: 'realized', realizedAmountCents, realizedDate, closedAt: tx.now, closedOn: today(), ...accounting });
              return { operationId: existing.id };
            }
            const op = om.create(tx, 'operation', {
              budgetId: rec.budgetId,
              direction,
              label: rec.label,
              amountCents: rec.amountCents,
              date: occurrenceDate,
              status: 'realized',
              realizedAmountCents,
              realizedDate,
              closedAt: tx.now, closedOn: today(),
              ...accounting,
              recurrenceId: rec.id,
              occurrenceDate,
              note: note(input.note) ?? rec.note ?? null,
              taskId,
              standardCostCenter: rec.standardCostCenter,
              costCenterId: rec.costCenterId,
              categoryId: rec.categoryId ?? null,
            });
            return { operationId: op.id };
          },
          { creation: true },
        );
        return { replayed: r.replayed, operation: operationView(socle.state, socle.state.operations[r.operationId]) };
      },

      /**
       * Écarte une échéance attendue qui n'aura pas lieu (abonnement suspendu, loyer offert, doublon) : elle
       * sort de toutes les sommes et la définition continue. Comme un règlement tardif, c'est permis pour une
       * échéance d'une période close : le résultat clos ne compte que le réalisé, il ne change pas.
       * Une échéance réglée s'écarte après l'annulation de son règlement. `restoreOccurrence` la rétablit.
       */
      async skipOccurrence(ctx, recurrenceId, input = {}) {
        const r = await om.command(
          'skipOccurrence',
          ctx,
          input,
          (tx) => {
            const rec = om.owned(tx.draft, 'recurrence', recurrenceId, tx.userId);
            if (rec.cancelledAt) fail('FORBIDDEN_BY_RULE', 'Cette définition est supprimée.', { recurrenceId });
            const occurrenceDate = date('occurrenceDate', input.occurrenceDate, { required: true });
            if (!isOccurrence(rec, occurrenceDate)) fail('VALIDATION', "Cette date n'est pas une occurrence de la définition.", { field: 'occurrenceDate' });
            const existing = om.list(tx.draft, 'operation', (o) => o.recurrenceId === rec.id && o.occurrenceDate === occurrenceDate)[0];
            if (existing?.status === 'realized') fail('ALREADY_SETTLED', 'Cette échéance est réglée : annulez d’abord son règlement.', { operationId: existing.id });
            if (existing?.status === 'cancelled') fail('FORBIDDEN_BY_RULE', 'Cette échéance est déjà écartée.', { operationId: existing.id });
            const cancelReason = 'reason' in input ? note(input.reason) : null;
            if (existing) {
              om.update(tx, existing, { status: 'cancelled', cancelledFrom: existing.status, cancelReason, closedAt: tx.now, closedOn: today() });
              return { operationId: existing.id };
            }
            const op = om.create(tx, 'operation', {
              budgetId: rec.budgetId,
              direction: rec.direction,
              label: rec.label,
              amountCents: rec.amountCents,
              date: occurrenceDate,
              status: 'cancelled',
              cancelledFrom: 'planned',
              cancelReason,
              closedAt: tx.now, closedOn: today(),
              realizedAmountCents: null,
              realizedDate: null,
              recurrenceId: rec.id,
              occurrenceDate,
              note: rec.note ?? null,
              taskId: rec.taskId ?? null,
              standardCostCenter: rec.standardCostCenter,
              costCenterId: rec.costCenterId,
              categoryId: rec.categoryId ?? null,
            });
            return { operationId: op.id };
          },
          { creation: true },
        );
        return { replayed: r.replayed, operation: operationView(socle.state, socle.state.operations[r.operationId]) };
      },

      /** Rétablit une échéance écartée : elle redevient attendue, à sa date et à son montant prévus. */
      async restoreOccurrence(ctx, recurrenceId, input = {}) {
        let id;
        await om.command('restoreOccurrence', ctx, input, (tx) => {
          const rec = om.owned(tx.draft, 'recurrence', recurrenceId, tx.userId);
          if (rec.cancelledAt) fail('FORBIDDEN_BY_RULE', 'Cette définition est supprimée.', { recurrenceId });
          const occurrenceDate = date('occurrenceDate', input.occurrenceDate, { required: true });
          const skipped = om.list(tx.draft, 'operation', (o) => o.recurrenceId === rec.id && o.occurrenceDate === occurrenceDate)[0];
          if (skipped?.status !== 'cancelled') fail('FORBIDDEN_BY_RULE', "Cette échéance n'est pas écartée.", { occurrenceDate });
          om.checkRevision(skipped, expectedRevisionOf(input));
          om.update(tx, skipped, { status: 'planned', cancelledFrom: null, cancelReason: null, closedAt: null, closedOn: null });
          id = skipped.id;
          return { operationId: id };
        });
        return { operation: operationView(socle.state, socle.state.operations[id]) };
      },

      /**
       * Supprime une définition saisie par erreur, tant qu'aucune de ses échéances n'est réglée : toutes ses
       * échéances sortent des sommes et des listes ; elle reste dans la base, datée de sa suppression.
       * Une définition déjà réglée ne se supprime pas : on la termine (dernière échéance), l'historique reste juste.
       */
      async cancelRecurrence(ctx, id, input = {}) {
        await om.command('cancelRecurrence', ctx, input, (tx) => {
          const rec = om.owned(tx.draft, 'recurrence', id, tx.userId);
          om.checkRevision(rec, expectedRevisionOf(input));
          if (rec.cancelledAt) fail('FORBIDDEN_BY_RULE', 'Cette définition est déjà supprimée.', { recurrenceId: id });
          const materialized = om.list(tx.draft, 'operation', (o) => o.recurrenceId === id);
          const settled = materialized.filter((o) => o.status === 'realized');
          if (settled.length)
            fail('FORBIDDEN_BY_RULE', 'Des échéances sont déjà réglées : annulez leurs règlements, ou terminez la définition par une dernière échéance.', { recurrenceId: id, settled: settled.length });
          definitionGuard(tx.draft, rec, rec.firstDate, rec.endDate);
          for (const o of materialized) if (o.status === 'planned') om.update(tx, o, { status: 'cancelled', cancelledFrom: 'planned', cancelReason: 'Définition supprimée', closedAt: tx.now, closedOn: today() });
          om.update(tx, rec, { cancelledAt: today(), cancelReason: 'reason' in input ? note(input.reason) : null });
          return { recurrenceId: id };
        });
        return { recurrence: recurrenceView(socle.state, socle.state.recurrences[id]) };
      },

      /**
       * Report d'une échéance non réglée vers un cycle à venir (dans une écriture composée, ex. la clôture du cycle) :
       * - une saisie ponctuelle prévue change de date et garde son identité ;
       * - une occurrence (récurrente) est écartée de son cycle et une saisie ponctuelle prévue la remplace à `toDate`.
       * `carriedFrom` garde l'origine (ligne, date prévue, période, cycle cible) ; l'occurrence écartée garde `carriedTo`.
       * Les gardes de dates s'appliquent comme à toute saisie.
       */
      carryOverLine(tx, lineId, { toDate, periodKey, periodLabel, toPeriodKey = null, toPeriodLabel = null }) {
        const target = date('toDate', toDate, { required: true });
        const occurrence = parseOccurrenceKey(lineId);
        const existing = occurrence
          ? om.list(tx.draft, 'operation', (o) => o.recurrenceId === occurrence.recurrenceId && o.occurrenceDate === occurrence.date)[0] ?? null
          : om.owned(tx.draft, 'operation', lineId, tx.userId);
        const rec = occurrence ? om.owned(tx.draft, 'recurrence', occurrence.recurrenceId, tx.userId) : existing?.recurrenceId ? tx.draft.recurrences[existing.recurrenceId] : null;
        if (existing?.status === 'realized') fail('ALREADY_SETTLED', 'Cette échéance est réglée : elle ne se reporte plus.', { lineId });
        if (existing?.status === 'cancelled') fail('FORBIDDEN_BY_RULE', 'Cette échéance est écartée : elle ne se reporte plus.', { lineId });
        const source = existing ?? rec;
        const plannedDate = existing?.date ?? occurrence.date;
        const carriedFrom = { lineId, date: plannedDate, periodKey: periodKey ?? null, ...(toPeriodKey ? { toPeriodKey } : {}) };
        // Saisie ponctuelle : même opération, nouvelle date prévue.
        if (existing && !existing.recurrenceId) {
          guard(tx.draft, existing, [target], [target], { carried: true });
          om.update(tx, existing, { date: target, carriedFrom });
          return { operationId: existing.id, moved: true };
        }
        // Occurrence : écartée de son cycle, remplacée par une saisie ponctuelle prévue dans le cycle cible.
        const reason = `${toPeriodLabel ? `Reportée en ${toPeriodLabel}` : 'Reportée au cycle suivant'}${periodLabel ? ` (${periodLabel})` : ''}`;
        const carriedTo = { periodKey: toPeriodKey, date: target };
        if (existing) om.update(tx, existing, { status: 'cancelled', cancelledFrom: existing.status, cancelReason: reason, closedAt: tx.now, closedOn: today(), carriedTo });
        else {
          om.create(tx, 'operation', {
            budgetId: rec.budgetId, direction: rec.direction, label: rec.label, amountCents: rec.amountCents, date: occurrence.date,
            status: 'cancelled', cancelledFrom: 'planned', cancelReason: reason, closedAt: tx.now, closedOn: today(), carriedTo, realizedAmountCents: null, realizedDate: null,
            recurrenceId: rec.id, occurrenceDate: occurrence.date, note: rec.note ?? null, taskId: rec.taskId ?? null,
            standardCostCenter: rec.standardCostCenter, costCenterId: rec.costCenterId, categoryId: rec.categoryId ?? null,
          });
        }
        const fields = {
          recurrenceId: null, occurrenceDate: null, budgetId: source.budgetId, direction: source.direction, label: source.label,
          amountCents: source.amountCents, date: target, status: 'planned', entryStatus: 'planned', enteredOn: today(), realizedAmountCents: null, realizedDate: null,
          note: source.note ?? null, taskId: source.taskId ?? null, standardCostCenter: source.standardCostCenter, costCenterId: source.costCenterId,
          categoryId: source.categoryId ?? null, ...(source.plannedFundingSource !== undefined ? { plannedFundingSource: source.plannedFundingSource } : {}), carriedFrom,
        };
        guard(tx.draft, { ...fields, userId: tx.userId }, [target], [target], { carried: true });
        return { operationId: om.create(tx, 'operation', fields).id, moved: false };
      },

      patchCaps(tx, budgetId, input = {}) {
          const b = om.owned(tx.draft, 'budget', budgetId, tx.userId);
          // `merge` : seuls les centres fournis changent (null retire leur plafond) ; sinon la liste remplace tout.
          const caps = input.merge === true ? { ...(b.capsCents ?? {}) } : {};
          for (const [ref, amount] of Object.entries(input.caps ?? {})) {
            if (amount === null || amount === '') {
              delete caps[ref];
              continue;
            }
            if (!costCentersOf(tx.draft, tx.userId).some((c) => c.ref === ref && c.direction === 'charge')) fail('REFERENCE_NOT_FOUND', 'Plafond sur un centre de charges inconnu.', { field: `caps.${ref}` });
            caps[ref] = money(`caps.${ref}`, amount, { positive: true });
          }
          om.update(tx, b, { capsCents: caps });
          return b;
      },

      /** Plafonds facultatifs par centre et par période (centimes), sur un Budget du user. */
      async setCaps(ctx, budgetId, input = {}) {
        await om.command('setCaps', ctx, input, (tx) => {
          om.checkRevision(om.owned(tx.draft, 'budget', budgetId, tx.userId), expectedRevisionOf(input));
          this.patchCaps(tx, budgetId, input);
          return { budgetId };
        });
        return budgetView(socle.state, socle.state.budgets[budgetId]);
      },

      recurrences(ctx, { budgetId } = {}) {
        const state = socle.state;
        const userId = om.requireUser(state, ctx);
        return om
          .list(state, 'recurrence', (r) => r.userId === userId && !r.cancelledAt && (!budgetId || r.budgetId === budgetId))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map((r) => recurrenceView(state, r));
      },

      buildCostCenter(tx, input) {
        return om.create(tx, 'costCenter', { label: text('label', input.label, { required: true, max: 120 }), direction: oneOf('direction', input.direction, DIRECTIONS) });
      },

      async addCustomCostCenter(ctx, input = {}) {
        const r = await om.command(
          'addCustomCostCenter',
          ctx,
          input,
          (tx) => ({ costCenterId: this.buildCostCenter(tx, input).id }),
          { creation: true },
        );
        return { replayed: r.replayed, costCenters: costCentersOf(socle.state, ctx.userId), costCenterId: r.costCenterId };
      },

      // ---------- catégories de dépenses (plafond facultatif, jamais bloquant) ----------

      categories(ctx, { archived = false } = {}) {
        const state = socle.state;
        const userId = om.requireUser(state, ctx);
        return categoriesOf(state, userId, { archived }).map((k) => categoryView(state, k));
      },

      async createCategory(ctx, input = {}) {
        const r = await om.command(
          'createChargeCategory',
          ctx,
          input,
          (tx) => {
            const ref = text('costCenterRef', input.costCenterRef, { required: true, max: 120 });
            const center = costCentersOf(tx.draft, tx.userId).find((c) => c.ref === ref);
            if (!center) fail('REFERENCE_NOT_FOUND', 'Centre de coût inconnu pour ce user.', { field: 'costCenterRef', ref });
            if (center.direction !== 'charge') fail('INCOMPATIBLE_REFERENCE', 'Une catégorie de dépense se range dans un centre de charges.', { field: 'costCenterRef' });
            const label = uniqueCategoryLabel(tx.draft, tx.userId, ref, text('label', input.label, { required: true, max: 120 }));
            const capCents = input.cap === undefined || input.cap === null || input.cap === '' ? null : money('cap', input.cap, { positive: true });
            return { categoryId: om.create(tx, 'chargeCategory', { label, costCenterRef: ref, capCents, archived: false }).id };
          },
          { creation: true },
        );
        return { replayed: r.replayed, category: categoryView(socle.state, socle.state.chargeCategories[r.categoryId]) };
      },

      /** Libellé, plafond (vide = sans plafond) ; `archived: true` retire la catégorie des choix sans toucher aux dépenses. */
      async updateCategory(ctx, id, input = {}) {
        await om.command('updateChargeCategory', ctx, input, (tx) => {
          const k = om.owned(tx.draft, 'chargeCategory', id, tx.userId);
          om.checkRevision(k, expectedRevisionOf(input));
          const patch = {};
          if ('label' in input) patch.label = text('label', input.label, { required: true, max: 120 });
          if ('cap' in input) patch.capCents = input.cap === null || input.cap === '' ? null : money('cap', input.cap, { positive: true });
          if ('archived' in input) patch.archived = !!input.archived;
          // Libellé unique parmi les catégories actives du centre : au renommage comme au rétablissement.
          if (!(patch.archived ?? k.archived)) uniqueCategoryLabel(tx.draft, tx.userId, k.costCenterRef, patch.label ?? k.label, k.id);
          om.update(tx, k, patch);
          return { categoryId: id };
        });
        return { category: categoryView(socle.state, socle.state.chargeCategories[id]) };
      },

      // ---------- lectures (interfaces de test) ----------

      listBudgets(ctx) {
        const state = socle.state;
        const userId = om.requireUser(state, ctx);
        return om
          .list(state, 'budget', (b) => b.userId === userId)
          .sort((a, b) => (a.role === b.role ? a.createdAt.localeCompare(b.createdAt) : a.role === 'life' ? -1 : 1))
          .map((b) => budgetView(state, b));
      },

      readBudget(ctx, id) {
        const state = socle.state;
        const b = om.owned(state, 'budget', id, om.requireUser(state, ctx));
        return { budget: budgetView(state, b), operations: operationsOf(state, id) };
      },

      costCenters(ctx) {
        const state = socle.state;
        return costCentersOf(state, om.requireUser(state, ctx));
      },
    };
  },

  checks(state, socle) {
    const out = [];
    const budgets = Object.values(state.budgets);
    for (const u of Object.values(state.users)) {
      const lives = budgets.filter((b) => b.userId === u.id && b.role === 'life');
      out.push(check('VIE-01', 'integrity', 'budget', `Budget « Projet de vie » unique pour ${u.label}`, '≤ 1', `${lives.length}`, lives.length <= 1 ? 'passed' : 'failed', lives.map((b) => b.id)));
    }
    for (const b of budgets.filter((x) => x.role === 'standard')) {
      const parent = state.budgets[b.parentBudgetId];
      const shared = budgets.some((o) => o.id !== b.id && o.coreProjectId === b.coreProjectId) || socle.registry.extensions('rootHolders').some((holders) => holders(state, b.coreProjectId, socle).length > 0); // P1 : Budget ignore qui d'autre tient une racine
      const ok = parent?.role === 'life' && parent.userId === b.userId && !shared;
      out.push(check('BUD-BR-01', 'integrity', 'budget', `Budget standard ${b.name} : père « Projet de vie », racine propre`, 'père = Budget « Projet de vie » du même user ; racine non partagée', `père ${parent ? parent.role : 'absent'} ; racine ${shared ? 'partagée' : 'propre'}`, ok ? 'passed' : 'failed', [b.id, b.coreProjectId, b.parentBudgetId]));
    }
    const stdKeys = new Set(socle.parameters.value(state, 'budget.centresStandards').map((c) => c.key));
    const orphans = Object.values(state.operations).filter((o) => o.standardCostCenter && !stdKeys.has(o.standardCostCenter));
    out.push(check('BUD-CC-01', 'pathway', 'budget', 'Les opérations désignent un centre standard encore paramétré', '0 centre retiré', `${orphans.length} opération(s)`, orphans.length ? 'warning' : 'passed', orphans.map((o) => o.id)));
    // Catégories de dépenses : rangées dans un centre de charges du user ; une dépense catégorisée est une charge
    // du même user, dans le centre de sa catégorie (le plafond n'est jamais bloquant, la cohérence l'est).
    const centerRefs = new Map(Object.values(state.users).map((u) => [u.id, new Set(socle.modules.budget.costCentersOf(state, u.id).filter((c) => c.direction === 'charge').map((c) => c.ref))]));
    const categories = Object.values(state.chargeCategories ?? {});
    const badCategories = categories.filter((k) => !centerRefs.get(k.userId)?.has(k.costCenterRef));
    out.push(check('BUD-CAT-01', 'integrity', 'budget', 'Chaque catégorie de dépense est rangée dans un centre de charges de son user', '0 catégorie hors centre', `${badCategories.length} catégorie(s)`, badCategories.length ? 'warning' : 'passed', badCategories.map((k) => k.id)));
    const refOf = (o) => o.costCenterId ?? STD + o.standardCostCenter;
    const entries = [...Object.values(state.operations), ...Object.values(state.recurrences ?? {})].filter((o) => o.categoryId);
    const badEntries = entries.filter((o) => {
      const k = state.chargeCategories?.[o.categoryId];
      return !k || k.userId !== o.userId || o.direction !== 'charge' || k.costCenterRef !== refOf(o);
    });
    out.push(check('BUD-CAT-02', 'integrity', 'budget', 'Une dépense catégorisée est une charge du même user, dans le centre de sa catégorie', '0 dépense incohérente', `${badEntries.length} sur ${entries.length}`, badEntries.length ? 'failed' : 'passed', badEntries.map((o) => o.id)));
    out.push(...fundingChecks(state, (userId, on) => {
      for (const provide of socle.registry.extensions('fundingPeriod')) {
        const period = provide(state, userId, on, socle);
        if (period) return period;
      }
      return null;
    }));
    return out;
  },

  debug: {
    views(state, scope, socle) {
      const inScope = (o) => scope === 'all' || o.userId === scope;
      const b = socle.modules.budget;
      return {
        budgets: Object.values(state.budgets)
          .filter(inScope)
          .map((x) => ({ budgetId: x.id, name: x.name, role: x.role, userId: x.userId, coreProjectId: x.coreProjectId, parentBudgetId: x.parentBudgetId })),
        categories: Object.values(state.chargeCategories ?? {})
          .filter(inScope)
          .map((k) => ({ categoryId: k.id, userId: k.userId, label: k.label, costCenterRef: k.costCenterRef, cap: k.capCents === null || k.capCents === undefined ? null : k.capCents / 100, archived: !!k.archived })),
        recurrences: Object.values(state.recurrences)
          .filter(inScope)
          .map((r) => ({ recurrenceId: r.id, userId: r.userId, budgetId: r.budgetId, direction: r.direction, label: r.label, amount: r.amountCents / 100, cadence: r.cadence, firstDate: r.firstDate, endDate: r.endDate, costCenterRef: r.costCenterId ?? STD + r.standardCostCenter, categoryId: r.categoryId ?? null, settlementCount: Object.values(state.operations).filter((o) => o.recurrenceId === r.id).length })),
        operations: Object.values(state.operations)
          .filter(inScope)
          .map((o) => {
            const v = b.operationView(state, o);
            return { operationId: o.id, userId: o.userId, budgetId: o.budgetId, direction: o.direction, label: o.label, amount: v.amount, date: o.date, status: o.status, realizedAmount: v.realizedAmount, realizedDate: o.realizedDate, costCenterRef: v.costCenterRef, costCenterLabel: v.costCenterLabel, categoryId: v.categoryId, categoryLabel: v.categoryLabel, recurrenceId: o.recurrenceId ?? null, occurrenceDate: o.occurrenceDate ?? null };
          }),
      };
    },
    csv: {
      'recurrences.csv': { view: 'recurrences', columns: ['recurrenceId', 'userId', 'budgetId', 'direction', 'label', 'amount', 'cadence', 'firstDate', 'endDate', 'costCenterRef', 'categoryId', 'settlementCount'] },
      'categories.csv': { view: 'categories', columns: ['categoryId', 'userId', 'label', 'costCenterRef', 'cap', 'archived'] },
      'budgets.csv': { view: 'budgets', columns: ['budgetId', 'name', 'role', 'userId', 'coreProjectId', 'parentBudgetId'] },
      'operations.csv': { view: 'operations', columns: ['operationId', 'userId', 'budgetId', 'direction', 'label', 'amount', 'date', 'status', 'realizedAmount', 'realizedDate', 'costCenterRef', 'costCenterLabel', 'categoryId', 'categoryLabel', 'recurrenceId', 'occurrenceDate'] },
    },
  },

  routes(socle) {
    const s = socle.modules.budget;
    return [
      ['GET', '/api/budget/budgets', ({ ctx }) => s.listBudgets(ctx)],
      ['GET', '/api/budget/budgets/:id', ({ ctx, params }) => s.readBudget(ctx, params.id)],
      ['GET', '/api/budget/cost-centers', ({ ctx }) => s.costCenters(ctx)],
      ['POST', '/api/budget/cost-centers', ({ ctx, body }) => s.addCustomCostCenter(ctx, body)],
      ['POST', '/api/budget/operations', ({ ctx, body }) => s.createOperation(ctx, body)],
      ['PUT', '/api/budget/operations/:id', ({ ctx, params, body }) => s.updateOperation(ctx, params.id, body)],
      ['POST', '/api/budget/operations/:id/realize', ({ ctx, params, body }) => s.realizeOperation(ctx, params.id, body)],
      ['POST', '/api/budget/operations/:id/cancel-realization', ({ ctx, params, body }) => s.cancelRealization(ctx, params.id, body)],
      ['POST', '/api/budget/operations/:id/cancel', ({ ctx, params, body }) => s.cancelOperation(ctx, params.id, body)],
      ['GET', '/api/budget/recurrences', ({ ctx, query }) => s.recurrences(ctx, { budgetId: query.get('budgetId') || undefined })],
      ['POST', '/api/budget/recurrences', ({ ctx, body }) => s.createRecurrence(ctx, body)],
      ['PUT', '/api/budget/recurrences/:id', ({ ctx, params, body }) => s.updateRecurrence(ctx, params.id, body)],
      ['POST', '/api/budget/recurrences/:id/settle', ({ ctx, params, body }) => s.settleOccurrence(ctx, params.id, body)],
      ['PUT', '/api/budget/budgets/:id/caps', ({ ctx, params, body }) => s.setCaps(ctx, params.id, body)],
      ['GET', '/api/budget/categories', ({ ctx, query }) => s.categories(ctx, { archived: query.get('archived') === 'true' })],
      ['POST', '/api/budget/categories', ({ ctx, body }) => s.createCategory(ctx, body)],
      ['PUT', '/api/budget/categories/:id', ({ ctx, params, body }) => s.updateCategory(ctx, params.id, body)],
    ];
  },
};
