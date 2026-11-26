// Budget Management (niveau 2, middleware). Budgets (« Projet de vie » unique par user,
// Budgets standards des projets de la vie), centres de coût et opérations prévues / réalisées.
// Il fournit les variables sources des calculs ; il ne présente aucun chiffre lui-même.
// Ses interfaces sont des interfaces de test : la création métier passe par le niveau applicatif.
import { projectVariables, fundingChecks } from './project-analysis.mjs';
import { fail } from '../../socle/errors.mjs';
import { check } from '../../socle/object-management/inspect.mjs';
import { integer, money, text } from '../../socle/validation.mjs';
import { budgetLines, CAP_LEVEL_PCT, capLevelOf, capReport, isNearCap, NEAR_CAP_USED_PCT, periodSum, STD } from './lines.mjs';
export { budgetLines, CAP_LEVEL_PCT, capLevelOf, capReport, isNearCap, NEAR_CAP_USED_PCT };
import { createFunding } from './funding-commands.mjs';
import { fundingExtensions } from './funding-extensions.mjs';

import { createBudgetViews, DIRECTIONS } from './views.mjs';
import { createBudgetGuards } from './guards.mjs';
import { operationCommands } from './operations.mjs';
import { recurrenceCommands } from './recurrence-commands.mjs';
import { structureCommands } from './structure.mjs';
export { DIRECTIONS };
const LIFE_BUDGET_NAME = 'Projet de vie';

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
    // Le service est assemblé par sujet, derrière la même façade : vues et références (views.mjs), gardes (guards.mjs),
    // financement des projets (funding.mjs), opérations (operations.mjs), définitions récurrentes
    // (recurrence-commands.mjs), structure du budget (structure.mjs).
    const { om } = socle;
    const views = createBudgetViews(socle);
    const { lifeBudgetOf, costCentersOf, categoriesOf, categoryView, operationsOf, operationView, recurrenceView, lineView } = views;
    const funding = createFunding(socle, { lifeBudgetOf });
    const kit = { om, funding, ...views, ...createBudgetGuards(socle, funding) };

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

      // ---------- commandes (par sujet) ----------
      ...operationCommands(socle, kit),
      ...recurrenceCommands(socle, kit),
      ...structureCommands(socle, kit),
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
