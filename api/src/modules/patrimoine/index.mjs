// Patrimoine Management (niveau 2, middleware). Un Patrimoine unique par user (PAT-01), relié au
// Budget « Projet de vie » et à la même racine noyau. Son stock évolue par capitalisations : le
// résultat signé d'une période close y est transféré une seule fois. Le stock peut être négatif.
// Ses interfaces sont des interfaces de test.
import { fail } from '../../socle/errors.mjs';
import { check } from '../../socle/object-management/inspect.mjs';
import { date, expectedRevisionOf, money, text } from '../../socle/validation.mjs';

const toEuros = (cents) => (cents === null || cents === undefined ? null : cents / 100);

const patrimoineOfCtx = (ctx, socle) => (ctx.patrimoineId ? socle.om.get(ctx.state, 'patrimoine', ctx.patrimoineId) : null);

/** Capitalisations prises en compte : toutes celles datées au plus tard à la date d'arrêté du contexte. */
function capitalizationsOf(state, socle, patrimoineId, asOf) {
  return socle.om
    .list(state, 'capitalization', (c) => c.patrimoineId === patrimoineId && (!asOf || c.date <= asOf))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export default {
  id: 'patrimoine',
  label: 'Patrimoine Management',
  level: 2,
  dependsOn: ['core', 'budget'],
  kinds: {
    patrimoine: {
      collection: 'patrimoines',
      prefix: 'pat',
      label: 'Patrimoine',
      references: { principalBudgetId: { kind: 'budget', required: true }, coreProjectId: { kind: 'coreProject', required: true } },
    },
    capitalization: {
      collection: 'capitalizations',
      prefix: 'cap',
      label: 'Capitalisation',
      references: { patrimoineId: { kind: 'patrimoine', required: true } },
    },
  },

  variables: [
    {
      name: 'patrimoine.stockOuverture',
      label: "Stock d'ouverture",
      unit: 'EUR',
      description: "Stock du Patrimoine à la date d'ouverture, saisi à la création ou plus tard. Inconnu tant qu'il n'est pas renseigné.",
      resolve(ctx, socle) {
        const p = patrimoineOfCtx(ctx, socle);
        if (!p) return { value: null, note: 'Aucun Patrimoine dans le contexte' };
        return {
          value: toEuros(p.openingStockCents),
          sources: [{ id: p.id, kind: 'patrimoine', label: "Stock d'ouverture", amount: toEuros(p.openingStockCents), date: p.openingDate }],
          note: p.openingStockCents === null ? "Stock d'ouverture non renseigné" : null,
        };
      },
    },
    {
      name: 'patrimoine.resultatsCapitalises',
      label: 'Résultats capitalisés',
      unit: 'EUR',
      description: 'Somme des résultats de périodes closes transférés au Patrimoine (capitalisations), à la date du jour.',
      resolve(ctx, socle) {
        const p = patrimoineOfCtx(ctx, socle);
        if (!p) return { value: null, note: 'Aucun Patrimoine dans le contexte' };
        const caps = capitalizationsOf(ctx.state, socle, p.id, ctx.asOf);
        return {
          value: caps.reduce((s, c) => s + c.amountCents, 0) / 100,
          sources: caps.map((c) => ({ id: c.id, kind: 'capitalization', label: c.label, amount: toEuros(c.amountCents), date: c.date })),
          note: caps.length ? null : 'Aucune période close',
        };
      },
    },
    {
      name: 'patrimoine.objectif',
      label: 'Objectif de patrimoine',
      unit: 'EUR',
      description: '[P] Montant visé (C10 : information seule, aucune règle ne s’y attache).',
      resolve(ctx, socle) {
        const p = patrimoineOfCtx(ctx, socle);
        if (!p) return { value: null, note: 'Aucun Patrimoine dans le contexte' };
        return {
          value: toEuros(p.objectiveCents),
          sources: [{ id: p.id, kind: 'patrimoine', label: 'Objectif', amount: toEuros(p.objectiveCents), date: null }],
          note: p.objectiveCents === null ? 'Objectif non renseigné' : null,
        };
      },
    },
  ],

  extensions: {
    coreProjectContext(state, projectId, socle) {
      const p = socle.om.list(state, 'patrimoine', (x) => x.coreProjectId === projectId)[0];
      return p ? { enrichment: { patrimoineId: p.id } } : {};
    },
  },

  migrations: [
    {
      from: ['j1-store/0.2'],
      id: 'patrimoine-champs-stock',
      description: "Stock d'ouverture, date et objectif ajoutés comme inconnus (null) : aucune valeur n'est inventée.",
      apply(draft, tx) {
        return Object.values(draft.patrimoines)
          .filter((p) => !('openingStockCents' in p))
          .map((p) => {
            Object.assign(p, { label: p.label ?? 'Patrimoine', openingStockCents: null, openingDate: null, objectiveCents: null });
            tx.updated.push({ kind: 'patrimoine', id: p.id });
            return `${p.id} : stock d'ouverture et objectif à renseigner`;
          });
      },
    },
  ],

  setup(socle) {
    const { om } = socle;
    const patrimoineOf = (state, userId) => om.list(state, 'patrimoine', (p) => p.userId === userId)[0] ?? null;

    const view = (state, p) => {
      const caps = capitalizationsOf(state, socle, p.id);
      const capitalizedCents = caps.reduce((s, c) => s + c.amountCents, 0);
      return {
        patrimoine: { ...structuredClone(p), openingStock: toEuros(p.openingStockCents), objective: toEuros(p.objectiveCents) },
        capitalizations: caps.map((c) => ({ ...structuredClone(c), amount: toEuros(c.amountCents) })),
        // Lecture brute de test ; les chiffres présentés à l'utilisateur passent par les métriques BPM.
        raw: { openingStock: toEuros(p.openingStockCents), capitalized: capitalizedCents / 100 },
      };
    };

    return {
      patrimoineOf,

      /** Patrimoine unique du user (PAT-01) : même racine noyau que le Budget « Projet de vie ». */
      buildPatrimoine(tx, { coreProjectId, principalBudgetId, openingStock, openingDate, objective }) {
        if (patrimoineOf(tx.draft, tx.userId)) fail('UNIQUENESS_VIOLATION', 'Ce user possède déjà son Patrimoine.', { userId: tx.userId });
        const budget = om.owned(tx.draft, 'budget', principalBudgetId, tx.userId);
        if (budget.role !== 'life' || budget.coreProjectId !== coreProjectId) {
          fail('INCOMPATIBLE_REFERENCE', 'Le Patrimoine partage la racine noyau du Budget « Projet de vie ».', { principalBudgetId });
        }
        return om.create(tx, 'patrimoine', {
          label: 'Patrimoine',
          coreProjectId,
          principalBudgetId,
          openingStockCents: money('openingStock', openingStock, { nullable: true, signed: true }),
          openingDate: date('openingDate', openingDate),
          objectiveCents: money('objective', objective, { nullable: true }),
        });
      },

      /** Capitalisation d'un résultat signé (peut être nul ou négatif) ; `source` désigne l'objet d'origine. */
      buildCapitalization(tx, { patrimoineId, amountCents, date: on, label, source }) {
        om.owned(tx.draft, 'patrimoine', patrimoineId, tx.userId);
        if (!Number.isInteger(amountCents)) fail('VALIDATION', 'Montant de capitalisation invalide.');
        return om.create(tx, 'capitalization', { patrimoineId, amountCents, date: date('date', on, { required: true }), label: text('label', label, { required: true }), source });
      },

      async updatePatrimoine(ctx, id, input = {}) {
        await om.command('updatePatrimoine', ctx, input, (tx) => {
          const p = om.owned(tx.draft, 'patrimoine', id, tx.userId);
          om.checkRevision(p, expectedRevisionOf(input));
          const patch = {};
          if ('openingStock' in input) patch.openingStockCents = money('openingStock', input.openingStock, { nullable: true, signed: true });
          if ('openingDate' in input) patch.openingDate = date('openingDate', input.openingDate);
          if ('objective' in input) patch.objectiveCents = money('objective', input.objective, { nullable: true });
          om.update(tx, p, patch);
          return { patrimoineId: id };
        });
        return view(socle.state, socle.state.patrimoines[id]);
      },

      read(ctx) {
        const state = socle.state;
        const p = patrimoineOf(state, om.requireUser(state, ctx));
        if (!p) fail('NOT_FOUND', 'Aucun Patrimoine pour ce user.');
        return view(state, p);
      },
    };
  },

  checks(state) {
    const out = [];
    for (const u of Object.values(state.users)) {
      const pats = Object.values(state.patrimoines).filter((p) => p.userId === u.id);
      const p = pats[0];
      const b = p ? state.budgets[p.principalBudgetId] : null;
      const shared = !p || (b?.role === 'life' && b.coreProjectId === p.coreProjectId);
      out.push(check('PAT-01', 'integrity', 'patrimoine', `Patrimoine unique pour ${u.label}, racine partagée avec le Budget « Projet de vie »`, '≤ 1 Patrimoine ; racine commune', `${pats.length} Patrimoine ; racine ${p ? (shared ? 'commune' : 'différente') : 'sans objet'}`, pats.length <= 1 && shared ? 'passed' : 'failed', pats.map((x) => x.id)));
    }
    return out;
  },

  debug: {
    views(state, scope) {
      const inScope = (o) => scope === 'all' || o.userId === scope;
      return {
        capitalisations: Object.values(state.capitalizations)
          .filter(inScope)
          .map((c) => ({ capitalizationId: c.id, userId: c.userId, patrimoineId: c.patrimoineId, amount: c.amountCents / 100, date: c.date, label: c.label, sourceId: c.source?.id ?? null })),
      };
    },
    csv: {
      'capitalisations.csv': { view: 'capitalisations', columns: ['capitalizationId', 'userId', 'patrimoineId', 'amount', 'date', 'label', 'sourceId'] },
    },
  },

  routes(socle) {
    const s = socle.modules.patrimoine;
    return [
      ['GET', '/api/patrimoine', ({ ctx }) => s.read(ctx)],
      ['PUT', '/api/patrimoine/:id', ({ ctx, params, body }) => s.updatePatrimoine(ctx, params.id, body)],
    ];
  },
};
