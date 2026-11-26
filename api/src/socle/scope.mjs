// P1 · Sens unique — la portée d'un module : ce qu'il a le droit de voir du socle.
// Un module reçoit cette portée (et non le socle entier) dans `setup` et `routes`, et ses extensions,
// compositions et résolveurs s'exécutent dedans. Elle lui rend : ses dépendances déclarées, un Object
// Management limité à ses propres natures (P2) et un stockage en lecture seule.
import { DomainError } from './errors.mjs';

export function moduleScope(socle, mod) {
  const allowed = new Set([mod.id, ...(mod.dependsOn ?? [])]);
  const refuse = (target) => {
    throw new DomainError('LAYER_VIOLATION', `Sens unique : le module ${mod.id} n'a pas déclaré ${target} dans ses dépendances.`, {
      principle: 'P1', module: mod.id, target, dependsOn: [...allowed].filter((id) => id !== mod.id),
    });
  };
  const modules = new Proxy(socle.modules, {
    get(target, prop) {
      if (typeof prop !== 'string' || !socle.registry.modules.has(prop) || allowed.has(prop)) return target[prop];
      return refuse(prop);
    },
    set() {
      throw new DomainError('LAYER_VIOLATION', `Le module ${mod.id} ne peut pas modifier les services du socle.`, { principle: 'P1', module: mod.id });
    },
  });
  // P2 : pas d'écrivain. Le stockage se lit ; il ne s'écrit que par une commande d'Object Management.
  const store = Object.freeze({
    get state() { return socle.store.state; },
    get path() { return socle.store.path; },
    describe: () => socle.store.describe(),
  });
  return Object.create(socle, {
    moduleId: { value: mod.id, enumerable: true },
    modules: { value: modules, enumerable: true },
    om: { value: socle.om.for(mod.id), enumerable: true },
    store: { value: store, enumerable: true },
  });
}

/** Rend `fn` exécutée dans la portée de son fournisseur : tout socle reçu en argument est remplacé par cette portée. */
export function inScope(registry, moduleId, fn) {
  if (typeof fn !== 'function') return fn;
  return (...args) => fn(...args.map((arg) => (arg && typeof arg === 'object' && arg.registry === registry && arg.modules ? registry.scopes.get(moduleId) ?? arg : arg)));
}
