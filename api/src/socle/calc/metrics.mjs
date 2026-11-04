// Moteur des chiffres présentés : chaque chiffre est une métrique dont la formule est un
// paramètre administré (`metric.<clé>`). L'évaluation renvoie la valeur ET son explication :
// formule, révision du paramètre, valeurs substituées, entrées (variables sources ou autres
// métriques) et objets sources inspectables dans Object Management.
import { fail } from '../errors.mjs';
import { evaluate, parseFormula, referencesOf, substitute } from './formula.mjs';

export const METRIC_PARAM_PREFIX = 'metric.';

const fmtNumber = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export class MetricEngine {
  constructor(socle) {
    this.socle = socle;
    this.variables = new Map();
    this.metrics = new Map();
  }

  registerVariable(def) {
    if (this.variables.has(def.name)) throw new Error(`Variable déjà déclarée : ${def.name}`);
    this.variables.set(def.name, def);
  }

  /** Une métrique déclare sa formule par défaut ; elle devient un paramètre administrable. */
  registerMetric(def) {
    if (this.metrics.has(def.key)) throw new Error(`Métrique déjà déclarée : ${def.key}`);
    this.metrics.set(def.key, { decimals: 2, ...def });
    this.socle.parameters.register({
      key: METRIC_PARAM_PREFIX + def.key,
      module: def.module,
      group: `Calcul · ${def.group ?? 'Chiffres'}`,
      label: `Formule : ${def.label}`,
      description: def.description,
      type: 'formula',
      unit: def.unit,
      default: def.formula,
      validate: (value, state) => this.validateFormula(def.key, value, state),
    });
  }

  /** Références connues et absence de dépendance circulaire. */
  validateFormula(key, formula, state) {
    const refs = referencesOf(parseFormula(formula));
    for (const r of refs) {
      if (!this.variables.has(r) && !this.metrics.has(r)) {
        fail('FORMULA_INVALID', `Référence inconnue : ${r}.`, { reference: r, known: this.catalog().map((c) => c.name) });
      }
    }
    const visit = (k, path) => {
      if (path.includes(k)) fail('FORMULA_INVALID', `Dépendance circulaire : ${[...path, k].join(' → ')}.`);
      const f = k === key ? formula : this.formulaOf(state, k).formula;
      for (const r of referencesOf(parseFormula(f))) if (this.metrics.has(r)) visit(r, [...path, k]);
    };
    visit(key, []);
  }

  formulaOf(state, key) {
    const p = this.socle.parameters.effective(state, METRIC_PARAM_PREFIX + key);
    return { formula: p.value, parameter: { key: p.key, revision: p.revision, origin: p.origin, updatedAt: p.updatedAt, isDefault: p.origin !== 'administration' } };
  }

  /** Catalogue des références utilisables dans une formule (pour l'éditeur d'administration). */
  catalog() {
    return [
      ...[...this.variables.values()].map((v) => ({ name: v.name, type: 'variable', label: v.label, unit: v.unit, module: v.module, description: v.description })),
      ...[...this.metrics.values()].map((m) => ({ name: m.key, type: 'metric', label: m.label, unit: m.unit, module: m.module, description: m.description })),
    ];
  }

  /**
   * Évalue une métrique pour un user et une période.
   * ctx : { state, userId, period: { key, start, end } | null }
   */
  evaluate(ctx, key, { formulaOverride } = {}) {
    const memo = (ctx.memo ??= new Map());
    if (!formulaOverride && memo.has(key)) return memo.get(key);
    const def = this.metrics.get(key);
    if (!def) fail('NOT_FOUND', 'Métrique inconnue.', { key });
    const { formula, parameter } = formulaOverride ? { formula: formulaOverride, parameter: { key: METRIC_PARAM_PREFIX + key, revision: null, origin: 'aperçu non enregistré' } } : this.formulaOf(ctx.state, key);
    const ast = parseFormula(formula);
    const inputs = new Map();
    const resolve = (name) => {
      if (!inputs.has(name)) inputs.set(name, this.#input(ctx, name));
      return inputs.get(name).value;
    };
    const raw = evaluate(ast, resolve);
    const value = raw === null ? null : roundTo(raw, def.decimals);
    const fmt = (v) => (v === null ? 'inconnu' : fmtNumber.format(v));
    const result = {
      key,
      label: def.label,
      unit: def.unit,
      decimals: def.decimals,
      description: def.description ?? null,
      module: def.module,
      value,
      status: value === null ? 'unavailable' : 'ok',
      unavailableReason: value === null ? reasonOf([...inputs.values()]) : null,
      formula,
      parameter,
      explanation: `${stripOuter(substitute(ast, (n) => inputs.get(n)?.value ?? null, fmt))} = ${fmt(value)}`,
      inputs: [...inputs.values()],
      period: ctx.period ?? null,
    };
    if (!formulaOverride) memo.set(key, result);
    return result;
  }

  evaluateMany(ctx, keys) {
    return Object.fromEntries(keys.map((k) => [k, this.evaluate(ctx, k)]));
  }

  #input(ctx, name) {
    if (this.metrics.has(name)) {
      const m = this.evaluate(ctx, name);
      return { name, type: 'metric', label: m.label, unit: m.unit, module: m.module, value: m.value, status: m.status, formula: m.formula, explanation: m.explanation, parameter: m.parameter, inputs: m.inputs, sources: [] };
    }
    const v = this.variables.get(name);
    if (!v) return { name, type: 'unknown', label: name, value: null, status: 'unavailable', note: 'Référence inconnue', sources: [] };
    const r = v.resolve(ctx, this.socle) ?? {};
    const value = r.value === undefined ? null : r.value;
    return {
      name,
      type: 'variable',
      label: v.label,
      unit: v.unit,
      module: v.module,
      description: v.description ?? null,
      value,
      status: value === null ? 'unavailable' : 'ok',
      note: r.note ?? null,
      sources: r.sources ?? [],
    };
  }
}

function roundTo(x, decimals) {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}

function stripOuter(s) {
  return s.startsWith('(') && s.endsWith(')') && balanced(s.slice(1, -1)) ? s.slice(1, -1) : s;
}

function balanced(s) {
  let depth = 0;
  for (const c of s) {
    if (c === '(') depth++;
    if (c === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/**
 * Données réellement manquantes : à travers les métriques imbriquées, on remonte jusqu'aux
 * variables inconnues (ex. « Stock d'ouverture non renseigné ») plutôt que de nommer la seule
 * métrique intermédiaire. Une métrique inconnue sans entrée inconnue est un calcul impossible.
 */
function missingLeaves(inputs) {
  return inputs
    .filter((i) => i.status === 'unavailable')
    .flatMap((i) => {
      if (i.type === 'metric') {
        const nested = missingLeaves(i.inputs ?? []);
        return nested.length ? nested : [`${i.label} (calcul impossible)`];
      }
      return [i.note ? `${i.label} (${i.note})` : i.label];
    });
}

function reasonOf(inputs) {
  const missing = [...new Set(missingLeaves(inputs))];
  if (!missing.length) return 'Calcul impossible (division par zéro ou résultat non défini).';
  return `Donnée inconnue : ${missing.join(', ')}.`;
}
