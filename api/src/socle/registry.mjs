// Registre des modules du socle et des natures d'objets qu'ils déclarent.
// Source unique pour la politique d'identité, les collections persistées, les références
// contrôlées par Object Management et les niveaux fonctionnels (1 noyau, 2 middleware, 3 application).

export const LEVELS = {
  0: 'Transverse',
  1: 'Niveau 1 · Noyau',
  2: 'Niveau 2 · Middleware',
  3: 'Niveau 3 · Application',
};

/**
 * Contrat d'un module :
 * {
 *   id, label, level (0 transverse, 1, 2, 3), dependsOn: [moduleId],
 *   kinds: { kindName: { collection, prefix, label, references: { field: { kind, required?, sameUser? } } } },
 *   parameters: [ParameterDefinition],   // administrés par le module Administration
 *   variables:  [VariableDefinition],    // données sources des calculs (calc/metrics)
 *   metrics:    [MetricDefinition],      // chiffres présentés, formule par défaut administrable
 *   checks(state, socle) => Check[],     // contrôles d'intégrité propres au domaine
 *   extensions: { coreProjectContext?(state, projectId), ... }, // points d'extension vers les niveaux inférieurs
 *   compositions: { name: (tx, input, socle) => result },     // créations composées orchestrées par Object Management
 *   setup(socle) => service,              // services exposés sous socle.modules[id]
 *   routes(socle) => [[method, path, handler]],
 * }
 */
export class Registry {
  constructor() {
    this.modules = new Map();
    this.kinds = new Map();
    this.prefixes = new Map();
  }

  register(mod) {
    if (this.modules.has(mod.id)) throw new Error(`Module déjà enregistré : ${mod.id}`);
    for (const dep of mod.dependsOn ?? []) {
      const d = this.modules.get(dep);
      if (!d) throw new Error(`Le module ${mod.id} dépend de ${dep}, absent ou enregistré après lui.`);
      if (d.level > mod.level && d.level !== 0) {
        throw new Error(`Dépendance interdite : ${mod.id} (niveau ${mod.level}) ne peut pas dépendre de ${dep} (niveau ${d.level}).`);
      }
    }
    for (const [kind, def] of Object.entries(mod.kinds ?? {})) {
      if (this.kinds.has(kind)) throw new Error(`Nature d'objet déjà déclarée : ${kind}`);
      if (this.prefixes.has(def.prefix)) throw new Error(`Préfixe d'ID déjà utilisé : ${def.prefix}`);
      this.kinds.set(kind, { kind, module: mod.id, level: mod.level, domain: mod.label, references: {}, ...def });
      this.prefixes.set(def.prefix, kind);
    }
    this.modules.set(mod.id, mod);
    return mod;
  }

  kind(kind) {
    const def = this.kinds.get(kind);
    if (!def) throw new Error(`Nature d'objet inconnue : ${kind}`);
    return def;
  }

  kindOfId(id) {
    if (typeof id !== 'string') return null;
    return this.prefixes.get(id.split('_')[0]) ?? null;
  }

  collections() {
    return [...this.kinds.values()].map((k) => k.collection);
  }

  /** Éléments déclarés par l'ensemble des modules (paramètres, variables, métriques…). */
  collect(field) {
    return [...this.modules.values()].flatMap((m) => (m[field] ?? []).map((x) => ({ module: m.id, ...x })));
  }

  extensions(name) {
    return [...this.modules.values()].map((m) => m.extensions?.[name]).filter(Boolean);
  }

  composition(name) {
    for (const m of this.modules.values()) if (m.compositions?.[name]) return m.compositions[name];
    return null;
  }

  describe() {
    return [...this.modules.values()].map((m) => ({
      id: m.id,
      label: m.label,
      level: m.level,
      levelLabel: LEVELS[m.level],
      dependsOn: m.dependsOn ?? [],
      kinds: Object.keys(m.kinds ?? {}),
      parameters: (m.parameters ?? []).length,
      variables: (m.variables ?? []).length,
      metrics: (m.metrics ?? []).length,
    }));
  }
}
