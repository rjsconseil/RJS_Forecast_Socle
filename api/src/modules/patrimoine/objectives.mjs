// Objectifs et hypothèses patrimoniales : services du middleware, utilisables sans BPM.
import { fail } from '../../socle/errors.mjs';
import {
  date,
  expectedRevisionOf,
  integer,
  money,
  oneOf,
  text,
} from '../../socle/validation.mjs';
import { CADENCES } from '../budget/recurrence.mjs';
import { GOAL_TYPES, project } from './projection.mjs';
export const DEFAULT_PROJECTION = {
  horizonYears: 20,
  annualReturnPct: null,
  inflationPct: 2,
  inflationSource: 'Hypothèse par défaut modifiable',
  contributionCents: null,
  contributionCadence: 'monthly',
};
export function percent(
  field,
  value,
  { min = -100, max = 100, nullable = false } = {},
) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    fail('VALIDATION', `Le champ ${field} est obligatoire.`, { field });
  }
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max)
    fail(
      'VALIDATION',
      `Le champ ${field} doit être un pourcentage entre ${min} et ${max}.`,
      { field },
    );
  return n;
}

function projectionFields(current, input = {}) {
  const v = { ...DEFAULT_PROJECTION, ...(current ?? {}) };
  if ('horizonYears' in input)
    v.horizonYears = integer('horizonYears', input.horizonYears, {
      min: 1,
      max: 80,
    });
  if ('annualReturnPct' in input)
    v.annualReturnPct = percent('annualReturnPct', input.annualReturnPct, {
      min: -50,
      max: 50,
      nullable: true,
    });
  if ('inflationPct' in input)
    v.inflationPct = percent('inflationPct', input.inflationPct, {
      min: -20,
      max: 50,
    });
  if ('inflationSource' in input)
    v.inflationSource =
      text('inflationSource', input.inflationSource, { max: 200 }) ||
      DEFAULT_PROJECTION.inflationSource;
  if ('contribution' in input)
    v.contributionCents = money('contribution', input.contribution, {
      nullable: true,
      signed: true,
    });
  if ('contributionCadence' in input)
    v.contributionCadence = oneOf(
      'contributionCadence',
      input.contributionCadence,
      CADENCES,
    );
  return v;
}

function goalFields(input = {}, i = null) {
  const f = (name) => (i === null ? name : `goals[${i}].${name}`);
  return {
    label: text(f('label'), input.label, { required: true, max: 200 }),
    type: oneOf(f('type'), input.type, Object.keys(GOAL_TYPES)),
    date: date(f('date'), input.date, { required: true }),
    targetTodayCents: money(f('targetToday'), input.targetToday, {
      positive: true,
    }),
  };
}

const monthsUntil = (from, to) => {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
};

export function goalProvisions(goals, inflationPct, now) {
  return goals
    .filter((g) => g.date > now)
    .map((g) => {
      const years = Number(g.date.slice(0, 4)) - Number(now.slice(0, 4));
      const futureCents = Math.round(
        g.targetTodayCents * (1 + inflationPct / 100) ** Math.max(0, years),
      );
      const periods = monthsUntil(now, g.date);
      return {
        goalId: g.id,
        label: g.label,
        type: g.type,
        date: g.date,
        targetTodayCents: g.targetTodayCents,
        futureCostCents: futureCents,
        periodsAvailable: periods,
        provisionPerPeriodCents:
          periods > 0 ? Math.ceil(futureCents / periods) : null,
        reason: periods > 0 ? null : 'Échéance dans la période courante',
      };
    });
}

export function createObjectives(socle) {
  const { om } = socle;
  const goalsOf = (state, userId) =>
    om
      .list(state, 'lifeGoal', (g) => g.userId === userId && !g.removed)
      .sort((a, b) => a.date.localeCompare(b.date));
  const patrimoineFor = (state, userId) => {
    const p = om.list(state, 'patrimoine', (p) => p.userId === userId)[0];
    if (!p)
      fail(
        'NOT_FOUND',
        'Préparez votre patrimoine avant de définir un objectif.',
      );
    return p;
  };
  return {
    project,
    goalProvisions,
    goalsOf,
    projectionSettingsOf: (state, id) => ({
      ...DEFAULT_PROJECTION,
      ...(state.patrimoines[id]?.projectionSettings ?? {}),
    }),
    patchProjectionSettings(tx, id, input) {
      const p = om.owned(tx.draft, 'patrimoine', id, tx.userId);
      if (
        Object.keys(DEFAULT_PROJECTION).some((k) => k in input) ||
        'contribution' in input
      ) {
        om.update(tx, p, {
          projectionSettings: projectionFields(p.projectionSettings, input),
        });
      }
    },
    migrateObjectives(tx, id, legacy) {
      const p = om.owned(tx.draft, 'patrimoine', id, tx.userId);
      if (legacy) {
        const fields = Object.fromEntries(
          Object.keys(DEFAULT_PROJECTION)
            .filter((k) => k in legacy)
            .map((k) => [k, legacy[k]]),
        );
        if (Object.keys(fields).length)
          om.update(tx, p, {
            projectionSettings: { ...fields, ...(p.projectionSettings ?? {}) },
          });
      }
      for (const g of om.list(
        tx.draft,
        'lifeGoal',
        (g) => g.userId === tx.userId,
      )) {
        if (
          (g.patrimoineId && g.patrimoineId !== p.id) ||
          (g.coreProjectId && g.coreProjectId !== p.coreProjectId)
        ) {
          fail(
            'INCOMPATIBLE_REFERENCE',
            'Un objectif est relié à une autre racine patrimoniale.',
            { goalId: g.id },
          );
        }
        if (!g.patrimoineId || !g.coreProjectId)
          om.update(tx, g, {
            patrimoineId: p.id,
            coreProjectId: p.coreProjectId,
          });
      }
    },
    buildGoal(tx, input) {
      const p = patrimoineFor(tx.draft, tx.userId);
      return om.create(tx, 'lifeGoal', {
        ...goalFields(input),
        patrimoineId: p.id,
        coreProjectId: p.coreProjectId,
        removed: false,
      });
    },
    patchGoal(tx, id, input) {
      const g = om.owned(tx.draft, 'lifeGoal', id, tx.userId);
      return om.update(
        tx,
        g,
        goalFields({
          label: g.label,
          type: g.type,
          date: g.date,
          targetToday: g.targetTodayCents / 100,
          ...input,
        }),
      );
    },
    goals(ctx) {
      const state = socle.state;
      const userId = om.requireUser(state, ctx);
      return goalsOf(state, userId).map((g) => ({
        ...structuredClone(g),
        typeLabel: GOAL_TYPES[g.type].label,
      }));
    },

    /** Objectif de projection : ne crée ni Budget, ni tâche, ni paiement. */
    async createGoal(ctx, input = {}) {
      const r = await om.command(
        'createGoal',
        ctx,
        input,
        (tx) => ({ goalId: this.buildGoal(tx, input).id }),
        { creation: true },
      );
      return {
        replayed: r.replayed,
        goal: structuredClone(socle.state.lifeGoals[r.goalId]),
      };
    },

    async updateGoal(ctx, id, input = {}) {
      await om.command('updateGoal', ctx, input, (tx) => {
        const g = om.owned(tx.draft, 'lifeGoal', id, tx.userId);
        om.checkRevision(g, expectedRevisionOf(input));
        this.patchGoal(tx, id, input);
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
  };
}
