// Noyau partitionné par user (montée en charge) : une requête ne voit et ne charge que la partition de son user,
// les écritures de users différents se font en parallèle, une écriture concurrente d'une autre instance est relue et
// rejouée, et rien n'écrit dans la partition d'un autre user.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocle } from '../src/socle/index.mjs';
import { SOCLE_MODULES } from '../src/modules/index.mjs';
import { camille, key, makeSocle, makeUser, operation, rejects } from './helpers.mjs';

const count = (state, collection) => Object.keys(state[collection]).length;

test('partitions · une requête ne voit que la partition de son user (et la partition système)', async () => {
  const { socle } = await makeSocle();
  const { ctx: a } = await camille(socle);
  const { ctx: b } = await camille(socle, { label: 'Bruno' });
  await operation(socle, a, { direction: 'charge', amount: 10, date: '2026-11-01' });
  await operation(socle, b, { direction: 'charge', amount: 20, date: '2026-11-01' });
  await operation(socle, b, { direction: 'charge', amount: 30, date: '2026-11-01' });
  const seen = await socle.store.within(a.userId, () => ({
    users: Object.keys(socle.stateOf(a).users),
    operations: count(socle.stateOf(a), 'operations'),
    parameters: Object.keys(socle.stateOf(a).parameters),
    journal: socle.stateOf(a).journal.every((e) => e.userId === a.userId),
  }));
  assert.deepEqual(seen.users, [a.userId]);
  assert.equal(seen.operations, 1);
  assert.deepEqual(seen.parameters, ['bpm.verrouCycleSuivant'], 'la partition système est visible de tous');
  assert.ok(seen.journal, 'le journal d’une partition ne porte que les commandes de son user');
  // Les lectures des modules suivent le contexte : la synthèse de Bruno ne connaît pas Camille.
  const register = await socle.store.within(b.userId, () => socle.modules.bpm.reads.register(b, {}));
  assert.equal(JSON.stringify(register).includes(a.userId), false);
  // Hors requête (scripts, tests, administration) : la vue complète réunit toutes les partitions.
  assert.equal(count(socle.state, 'operations'), 3);
  assert.equal(count(socle.state, 'users'), 2);
  await socle.close();
});

test('partitions · écritures en parallèle de plusieurs users, toutes gardées, révision par partition', async () => {
  const { socle, reload } = await makeSocle();
  const users = await Promise.all(Array.from({ length: 6 }, (_, i) => makeUser(socle, { label: `U${i}` })));
  await Promise.all(users.flatMap(({ ctx }) => Array.from({ length: 5 }, (_, i) => operation(socle, ctx, { direction: 'charge', amount: i + 1, date: '2026-11-01' }))));
  for (const { ctx } of users) {
    const view = await socle.store.within(ctx.userId, () => socle.stateOf(ctx));
    assert.equal(count(view, 'operations'), 5);
  }
  const again = await reload();
  assert.equal(count(again.state, 'operations'), 30);
  await again.close();
});

test('partitions · cache borné : les partitions les moins utilisées quittent la mémoire, rien n’est perdu', async () => {
  const { socle, dataFile } = await makeSocle();
  const users = [];
  for (let i = 0; i < 5; i += 1) users.push(await makeUser(socle, { label: `U${i}` }));
  for (const { ctx } of users) await operation(socle, ctx, { direction: 'income', amount: 100, date: '2026-11-01' });
  await socle.close();
  const small = await createSocle({ dataFile, modules: SOCLE_MODULES, partitionCache: 2 });
  for (const { ctx } of users) {
    await small.store.within(ctx.userId, async () => {
      await operation(small, ctx, { direction: 'charge', amount: 5, date: '2026-11-02' });
      assert.equal(count(small.stateOf(ctx), 'operations'), 2);
    });
    assert.ok(small.store.parts.size <= 3, `au plus 2 partitions de user en mémoire (+ la système) : ${small.store.parts.size}`);
  }
  assert.ok(small.store.stats.evictions >= 3);
  await small.close();
  const check = await createSocle({ dataFile, modules: SOCLE_MODULES });
  assert.equal(count(check.state, 'operations'), 10);
  await check.close();
});

test('partitions · deux instances : chaque requête revalide sa partition et voit les écritures de l’autre', async () => {
  const { socle, dataFile } = await makeSocle();
  const { ctx } = await camille(socle);
  const other = await createSocle({ dataFile, modules: SOCLE_MODULES });
  await other.store.within(ctx.userId, () => count(other.stateOf(ctx), 'operations')); // partition en cache dans l'autre instance
  await operation(socle, ctx, { direction: 'charge', amount: 7, date: '2026-11-01' });
  const seen = await other.store.within(ctx.userId, () => count(other.stateOf(ctx), 'operations'));
  assert.equal(seen, 1, 'l’autre instance relit la partition dont la révision a changé');
  await other.close();
  await socle.close();
});

test('partitions · rien n’écrit dans la partition d’un autre user ; une clé de demande reste unique pour tout le site', async () => {
  const { socle } = await makeSocle();
  const { ctx: a, bundle } = await camille(socle);
  const { ctx: b } = await makeUser(socle, { label: 'Bruno' });
  // Une commande de Bruno qui créerait un objet chez Camille est refusée, sans rien écrire.
  const before = count(socle.state, 'coreProjects');
  await rejects(socle.om.command('intrusion', b, {}, (tx) => {
    socle.om.create(tx, 'coreProject', { title: 'Chez Camille', description: '', priority: 'medium', startDate: null, dueDate: null }, { userId: a.userId });
    return {};
  }), 'WRITE_OUTSIDE_PARTITION');
  assert.equal(count(socle.state, 'coreProjects'), before);
  // La clé de demande d'une création de Camille ne peut pas servir à Bruno.
  const requestKey = key('op');
  await socle.modules.budget.createOperation(a, { requestKey, direction: 'charge', label: 'A', amount: 1, date: '2026-11-01', status: 'realized', costCenterRef: 'std:divers', budgetId: bundle.budgetId });
  await rejects(socle.modules.budget.createOperation(b, { requestKey, direction: 'charge', label: 'B', amount: 2, date: '2026-11-01', status: 'realized', costCenterRef: 'std:divers' }), 'IDEMPOTENCY_CONFLICT');
  await socle.close();
});

test('partitions · une base « un seul écrivain » existante est partitionnée au premier démarrage, sans changer ses données', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { socle, dataFile } = await makeSocle();
  const { ctx } = await camille(socle);
  await operation(socle, ctx, { direction: 'charge', amount: 3, date: '2026-11-01' });
  const before = JSON.stringify({ users: socle.state.users, operations: socle.state.operations });
  await socle.close();
  // Retour à l'ancienne disposition : plus de table des partitions, révision globale dans SY_store.
  const db = new DatabaseSync(dataFile.replace(/\.json$/, '.sqlite'));
  db.exec("INSERT INTO SY_store (key, value) VALUES ('revision', '42') ON CONFLICT(key) DO UPDATE SET value = '42'; DROP TABLE SY_partitions;");
  db.close();
  const reopened = await createSocle({ dataFile, modules: SOCLE_MODULES });
  assert.equal(JSON.stringify({ users: reopened.state.users, operations: reopened.state.operations }), before);
  assert.equal((await reopened.store.describe()).engine.partitionedAt.partitions, 2);
  await operation(reopened, ctx, { direction: 'charge', amount: 4, date: '2026-11-01' });
  assert.equal(count(reopened.state, 'operations'), 2);
  await reopened.close();
});
