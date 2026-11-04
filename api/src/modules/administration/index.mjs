// Administration (transverse) : paramètres effectifs, formules des chiffres présentés,
// journal des écritures et supervision des erreurs. Les invariants ne sont jamais des paramètres.
import { fail } from '../../socle/errors.mjs';
import { FORMULA_FUNCTIONS, parseFormula, referencesOf } from '../../socle/calc/formula.mjs';
import { METRIC_PARAM_PREFIX } from '../../socle/calc/metrics.mjs';

/** Une valeur jamais administrée est en révision 0 : 0 est donc une version attendue valide. */
function parameterRevisionOf(input) {
  const r = input?.expectedRevision;
  if (!Number.isInteger(r) || r < 0) fail('VALIDATION', 'La version attendue (expectedRevision) est requise.', { field: 'expectedRevision' });
  return r;
}

export default {
  id: 'administration',
  label: 'Administration',
  level: 0,
  dependsOn: [],

  setup(socle) {
    const { om, parameters, metrics } = socle;

    /** Contexte de calcul d'un user, fourni par le niveau applicatif (période, Budget, Patrimoine). */
    function metricContext(state, userId, options = {}) {
      const ext = socle.registry.extensions('metricContext')[0];
      if (!ext) return { state, userId, period: null };
      return ext(state, userId, socle, options);
    }

    function metricRow(state, key) {
      const def = metrics.metrics.get(key);
      const p = parameters.effective(state, METRIC_PARAM_PREFIX + key);
      return {
        key,
        label: def.label,
        unit: def.unit,
        decimals: def.decimals,
        group: def.group ?? null,
        module: def.module,
        description: def.description ?? null,
        formula: p.value,
        defaultFormula: p.defaultValue,
        references: [...referencesOf(parseFormula(p.value))],
        parameter: { key: p.key, revision: p.revision, origin: p.origin, updatedAt: p.updatedAt, history: p.history },
      };
    }

    return {
      metricContext,
      modules: () => socle.registry.describe(),
      parameters: () => parameters.effectiveList(socle.state).filter((p) => p.type !== 'formula'),
      parameter: (key) => parameters.effective(socle.state, key),

      async setParameter(key, input) {
        parameters.definition(key);
        return om.command(
          'setParameter',
          null,
          input,
          (tx) => ({ parameter: parameters.write(tx, key, input?.value, { expectedRevision: parameterRevisionOf(input), note: input?.note }) }),
          { anonymous: true },
        );
      },

      async resetParameter(key, input) {
        parameters.definition(key);
        return om.command('resetParameter', null, input, (tx) => ({ parameter: parameters.reset(tx, key, { expectedRevision: parameterRevisionOf(input) }) }), { anonymous: true });
      },

      metricCatalog() {
        const state = socle.state;
        return {
          metrics: [...metrics.metrics.keys()].map((k) => metricRow(state, k)),
          references: metrics.catalog(),
          functions: FORMULA_FUNCTIONS,
        };
      },

      metric: (key) => {
        if (!metrics.metrics.has(key)) fail('NOT_FOUND', 'Métrique inconnue.', { key });
        return metricRow(socle.state, key);
      },

      /** Aperçu sans enregistrement : la formule proposée est évaluée sur les données du user. */
      previewMetric(ctx, key, input) {
        const state = socle.state;
        const userId = om.requireUser(state, ctx);
        const formula = input?.formula;
        metrics.validateFormula(key, formula, state);
        const mctx = metricContext(state, userId, { periodKey: input?.periodKey });
        return {
          current: metrics.evaluate(mctx, key),
          preview: metrics.evaluate({ ...mctx, memo: new Map() }, key, { formulaOverride: formula }),
        };
      },

      journal(limit = 100) {
        return socle.state.journal.slice(-limit).reverse();
      },

      errors: () => om.recentErrors,
    };
  },

  routes(socle) {
    const s = socle.modules.administration;
    return [
      ['GET', '/api/admin/modules', () => s.modules()],
      ['GET', '/api/admin/parameters', () => s.parameters()],
      ['GET', '/api/admin/parameters/:key', ({ params }) => s.parameter(params.key)],
      ['PUT', '/api/admin/parameters/:key', ({ params, body }) => s.setParameter(params.key, body)],
      ['POST', '/api/admin/parameters/:key/reset', ({ params, body }) => s.resetParameter(params.key, body)],
      ['GET', '/api/admin/metrics', () => s.metricCatalog()],
      ['GET', '/api/admin/metrics/:key', ({ params }) => s.metric(params.key)],
      ['POST', '/api/admin/metrics/:key/preview', ({ ctx, params, body }) => s.previewMetric(ctx, params.key, body)],
      ['GET', '/api/admin/journal', ({ query }) => s.journal(Math.min(Number(query.get('limit')) || 100, 500))],
      ['GET', '/api/admin/errors', () => s.errors()],
    ];
  },
};
