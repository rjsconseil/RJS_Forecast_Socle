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
 *   kinds: { kindName: { collection, prefix, label, section?, references: { field: { kind, required?, sameUser? } } } },
 *     // section : section propriétaire (catalogue `sections.json`), déduite de la collection si elle n'est pas donnée
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
import { inScope } from './scope.mjs';
import { SECTION_FLOWS, SECTION_LIST, sectionByKey, sectionOfCollection } from './sections.mjs';

/** Le rôle d'un module de niveau 2 : `metier` (défaut), `technique` (sert les middlewares métier) ou `transverse` (sert métier et applications). */
export const MIDDLEWARE_ROLES = { metier: 'Middleware métier', technique: 'Middleware technique', transverse: 'Middleware transverse' };
export const middlewareRole = (mod) => (mod.level === 2 ? mod.role ?? 'metier' : null);

export class Registry {
  constructor() {
    /** P1 : la portée de chaque module, posée par l'assemblage du socle. */
    this.scopes = new Map();
    this.modules = new Map();
    this.kinds = new Map();
    this.prefixes = new Map();
  }

  register(mod) {
    if (this.modules.has(mod.id)) throw new Error(`Module déjà enregistré : ${mod.id}`);
    if (mod.role && (mod.level !== 2 || !MIDDLEWARE_ROLES[mod.role])) throw new Error(`Rôle de middleware invalide pour ${mod.id} : ${mod.role}.`);
    for (const dep of mod.dependsOn ?? []) {
      const d = this.modules.get(dep);
      if (!d) throw new Error(`Le module ${mod.id} dépend de ${dep}, absent ou enregistré après lui.`);
      if (d.level > mod.level && d.level !== 0) {
        throw new Error(`Dépendance interdite : ${mod.id} (niveau ${mod.level}) ne peut pas dépendre de ${dep} (niveau ${d.level}).`);
      }
      // P6 · Middlewares typés : qui sert qui, au niveau 2.
      const role = middlewareRole(mod);
      const target = middlewareRole(d);
      if (role === 'metier' && target === 'metier') throw new Error(`Middlewares indépendants : ${mod.id} et ${dep} sont deux middlewares métier, aucun ne dépend de l'autre.`);
      if (role && role !== 'metier' && d.level === 2) throw new Error(`Un middleware ${role} (${mod.id}) ne s'appuie que sur le niveau du dessous, pas sur ${dep}.`);
      if (target === 'technique' && mod.level > 2) throw new Error(`Le middleware technique ${dep} sert les middlewares métier, pas l'application ${mod.id}.`);
    }
    for (const [kind, def] of Object.entries(mod.kinds ?? {})) {
      if (this.kinds.has(kind)) throw new Error(`Nature d'objet déjà déclarée : ${kind}`);
      if (this.prefixes.has(def.prefix)) throw new Error(`Préfixe d'ID déjà utilisé : ${def.prefix}`);
      // Un fait, une section propriétaire : la section d'une nature est celle de sa collection dans le catalogue.
      const section = sectionOfCollection(def.collection);
      if (def.section !== undefined && !sectionByKey(def.section)) throw new Error(`Section inconnue pour la nature ${kind} : ${def.section}`);
      if (def.section !== undefined && def.section !== section) {
        throw new Error(`La nature ${kind} se déclare dans la section ${def.section}, mais sa collection ${def.collection} est rangée dans ${section} (sections.json).`);
      }
      this.kinds.set(kind, { kind, module: mod.id, level: mod.level, domain: mod.label, references: {}, ...def, section });
      this.prefixes.set(def.prefix, kind);
    }
    // P4 · Lecture déclarée : on ne lit que ses natures et celles de ses dépendances.
    for (const kind of mod.reads ?? []) {
      const owner = this.kinds.get(kind)?.module;
      if (!owner) throw new Error(`Lecture déclarée par ${mod.id} sur une nature inconnue : ${kind}`);
      if (owner !== mod.id && !(mod.dependsOn ?? []).includes(owner)) {
        throw new Error(`Lecture interdite : ${mod.id} déclare lire « ${kind} », propriété de ${owner}, dont il ne dépend pas.`);
      }
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
    // P1 : les fonctions déclarées (résolveurs, migrations, validations) s'exécutent dans la portée de leur module.
    return [...this.modules.values()].flatMap((m) => (m[field] ?? []).map((x) => {
      const item = { module: m.id, ...x };
      for (const key of ['resolve', 'apply', 'validate']) if (typeof item[key] === 'function') item[key] = inScope(this, m.id, item[key]);
      return item;
    }));
  }

  extensions(name) {
    return [...this.modules.values()].filter((m) => m.extensions?.[name]).map((m) => inScope(this, m.id, m.extensions[name]));
  }

  composition(name) {
    for (const m of this.modules.values()) if (m.compositions?.[name]) return inScope(this, m.id, m.compositions[name]);
    return null;
  }

  /** Section propriétaire d'une nature d'objet (clé du catalogue). */
  sectionOf(kind) {
    return this.kind(kind).section;
  }

  /** Le catalogue des sections avec les natures que chacune possède, et les flux qui les relient. */
  sections() {
    const kinds = [...this.kinds.values()];
    return {
      sections: SECTION_LIST.map((s) => ({
        key: s.key, prefix: s.prefix, order: s.order, label: s.label, verb: s.verb, tone: s.tone, promise: s.promise, decides: s.decides,
        kinds: kinds.filter((k) => k.section === s.key).map((k) => ({ kind: k.kind, label: k.label, module: k.module, prefix: k.prefix })),
      })),
      flows: SECTION_FLOWS.map((f) => ({ ...f })),
    };
  }

  describe() {
    return [...this.modules.values()].map((m) => ({
      id: m.id,
      label: m.label,
      level: m.level,
      levelLabel: LEVELS[m.level],
      role: middlewareRole(m),
      roleLabel: MIDDLEWARE_ROLES[middlewareRole(m)] ?? null,
      dependsOn: m.dependsOn ?? [],
      reads: m.reads ?? [],
      kinds: Object.keys(m.kinds ?? {}),
      sections: [...new Set(Object.keys(m.kinds ?? {}).map((k) => this.kinds.get(k)?.section).filter(Boolean))],
      parameters: (m.parameters ?? []).length,
      variables: (m.variables ?? []).length,
      metrics: (m.metrics ?? []).length,
    }));
  }
}
