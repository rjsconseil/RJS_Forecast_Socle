// Budget Management — structure du budget : plafonds par poste, postes personnels, catégories de dépenses, et lectures
// d'interface de test (Budgets, postes, définitions).
import { fail } from '../../socle/errors.mjs';
import { expectedRevisionOf, money, oneOf, text } from '../../socle/validation.mjs';
import { DIRECTIONS } from './views.mjs';

/** Commandes du middleware Budget ; `kit` : sa portée, ses vues et ses gardes (assemblés dans index.mjs). */
export function structureCommands(socle, kit) {
  const { om, costCentersOf, categoriesOf, uniqueCategoryLabel, categoryView, operationsOf, budgetView, recurrenceView } = kit;
  return {
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
      return budgetView(socle.stateOf(ctx), socle.stateOf(ctx).budgets[budgetId]);
    },

    recurrences(ctx, { budgetId } = {}) {
      const state = socle.stateOf(ctx);
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
      return { replayed: r.replayed, costCenters: costCentersOf(socle.stateOf(ctx), ctx.userId), costCenterId: r.costCenterId };
    },

    // ---------- catégories de dépenses (plafond facultatif, jamais bloquant) ----------

    categories(ctx, { archived = false } = {}) {
      const state = socle.stateOf(ctx);
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
      return { replayed: r.replayed, category: categoryView(socle.stateOf(ctx), socle.stateOf(ctx).chargeCategories[r.categoryId]) };
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
      return { category: categoryView(socle.stateOf(ctx), socle.stateOf(ctx).chargeCategories[id]) };
    },

    // ---------- lectures (interfaces de test) ----------

    listBudgets(ctx) {
      const state = socle.stateOf(ctx);
      const userId = om.requireUser(state, ctx);
      return om
        .list(state, 'budget', (b) => b.userId === userId)
        .sort((a, b) => (a.role === b.role ? a.createdAt.localeCompare(b.createdAt) : a.role === 'life' ? -1 : 1))
        .map((b) => budgetView(state, b));
    },

    readBudget(ctx, id) {
      const state = socle.stateOf(ctx);
      const b = om.owned(state, 'budget', id, om.requireUser(state, ctx));
      return { budget: budgetView(state, b), operations: operationsOf(state, id) };
    },

    costCenters(ctx) {
      const state = socle.stateOf(ctx);
      return costCentersOf(state, om.requireUser(state, ctx));
    },
  };
}
