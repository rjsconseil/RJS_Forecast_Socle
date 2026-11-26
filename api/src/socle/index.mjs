// Assemblage du socle : registre des modules, persistance, Object Management, paramètres,
// moteur de calcul et services des modules. L'ordre d'intégration suit les niveaux :
// transverse → niveau 1 (noyau) → niveau 2 (middleware) → niveau 3 (application).
import { Registry } from './registry.mjs';
import { DataManager, STORE_SCHEMA, emptyState } from './data/data-manager.mjs';
import { ObjectManager } from './object-management/object-manager.mjs';
import { Inspector } from './object-management/inspect.mjs';
import { Parameters } from './parameters.mjs';
import { MetricEngine } from './calc/metrics.mjs';
import { moduleScope } from './scope.mjs';
import { PRINCIPLES } from './principles.mjs';

export async function createSocle({ dataFile, modules, faultInjection = false, dataEngine = process.env.SOCLE_DATA_ENGINE || undefined }) {
  const registry = new Registry();
  for (const m of modules) registry.register(m);

  const socle = { registry, modules: {} };
  socle.parameters = new Parameters(socle);
  socle.metrics = new MetricEngine(socle);
  for (const p of registry.collect('parameters')) socle.parameters.register(p);
  for (const v of registry.collect('variables')) socle.metrics.registerVariable(v);
  for (const m of registry.collect('metrics')) socle.metrics.registerMetric(m);

  // P5 · Données gérées : la couche de gestion, au-dessus du moteur de stockage choisi.
  socle.store = await new DataManager({ path: dataFile, registry, engine: dataEngine }).load();
  socle.data = socle.store;
  socle.om = new ObjectManager({ registry, store: socle.store, faultInjection });
  socle.inspector = new Inspector(socle);
  Object.defineProperty(socle, 'state', { get: () => socle.store.state });
  socle.close = () => socle.store.close();
  /** Remise à zéro de recette : primitive d'administration du socle, hors des commandes métier. */
  socle.resetData = () => socle.store.mutate((draft) => {
    for (const k of Object.keys(draft)) delete draft[k];
    Object.assign(draft, emptyState(registry.collections()));
    return { value: { reset: true } };
  });

  socle.principles = PRINCIPLES;
  // P1 · Sens unique : chaque module travaille dans sa portée, jamais avec le socle entier.
  socle.scopeOf = (id) => registry.scopes.get(id);
  for (const m of registry.modules.values()) registry.scopes.set(m.id, moduleScope(socle, m));
  for (const m of registry.modules.values()) socle.modules[m.id] = m.setup?.(registry.scopes.get(m.id)) ?? {};
  /** Les routes d'un module, construites dans sa portée. */
  socle.routesOf = (m) => m.routes?.(registry.scopes.get(m.id)) ?? [];
  try {
    await migrate(socle);
  } catch (err) {
    await socle.close();
    throw err;
  }
  return socle;
}

/**
 * Migration explicite d'un stockage antérieur. Chaque module déclare ses étapes
 * `migrations: [{ from, id, description, apply(draft, tx, socle) => changes[] }]` ; elles
 * s'exécutent dans l'ordre des niveaux, en une seule écriture, et sont tracées dans
 * `state.migrations` et le journal. Les IDs existants ne changent jamais.
 */
export async function migrate(socle) {
  const from = socle.store.legacySchema;
  if (!from) return null;
  const steps = socle.registry.collect('migrations').filter((s) => [].concat(s.from).includes(from));
  return socle.store.mutate((draft) => {
    const now = new Date().toISOString();
    const tx = { draft, command: `migration ${from} → ${STORE_SCHEMA}`, now, created: [], updated: [], unchanged: false, userId: null, requestKey: null };
    const applied = steps.map((s) => ({ module: s.module, id: s.id, description: s.description, changes: s.apply(draft, tx, socle) ?? [] }));
    draft.schemaVersion = STORE_SCHEMA;
    const record = { from, to: STORE_SCHEMA, at: now, steps: applied, created: tx.created.map((c) => c.id) };
    draft.migrations.push(record);
    draft.journal.push({ at: now, command: tx.command, userId: null, requestKey: null, created: tx.created.map((c) => c.id), updated: [...new Set(tx.updated.map((u) => u.id))], outcome: 'committed' });
    return { value: record };
  });
}
