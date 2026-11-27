// Moteur PostgreSQL (« sgbd ») : mêmes garanties que SQLite sur une vraie base. Lancé seulement si SOCLE_PG_URL
// désigne une base de test (elle est vidée) :
//   SOCLE_PG_URL=postgres://rjs@localhost:5544/socle_test node --test api/test/sgbd.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocle } from '../src/socle/index.mjs';
import { SOCLE_MODULES } from '../src/modules/index.mjs';
import { camille, key, operation, rejects } from './helpers.mjs';

const url = process.env.SOCLE_PG_URL;
const skip = url ? false : 'SOCLE_PG_URL absente : base PostgreSQL de test non fournie';

async function freshBase() {
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();
}
const open = (opts = {}) => createSocle({ dataFile: '/tmp/socle-sgbd-test.json', modules: SOCLE_MODULES, dataEngine: 'sgbd', ...opts });
const count = (state, c) => Object.keys(state[c]).length;
/** Comme le serveur : chaque appel travaille dans la partition de son user (moteur asynchrone). */
const inUser = (socle, ctx, fn) => socle.store.within(ctx.userId, fn);
const op = (socle, ctx, input) => inUser(socle, ctx, () => operation(socle, ctx, input));

test('sgbd · inscription, écritures et lectures par partition, relecture après redémarrage', { skip }, async () => {
  await freshBase();
  const socle = await open();
  await socle.modules.administration.setParameter('bpm.verrouCycleSuivant', { value: false, expectedRevision: 0, note: 'Tests' });
  const { ctx: a } = await camille(socle);
  const { ctx: b } = await camille(socle, { label: 'Bruno' });
  await Promise.all([
    ...Array.from({ length: 5 }, (_, i) => op(socle, a, { direction: 'charge', amount: 10 + i, date: '2026-11-01' })),
    ...Array.from({ length: 3 }, (_, i) => op(socle, b, { direction: 'charge', amount: 20 + i, date: '2026-11-01' })),
  ]);
  const seen = await socle.store.within(a.userId, () => ({ ops: count(socle.stateOf(a), 'operations'), register: socle.modules.bpm.reads.register(a, { period: '2026-11' }).lines.length }));
  assert.deepEqual(seen, { ops: 5, register: 5 });
  assert.deepEqual((await socle.modules.users.listUsers()).map((u) => u.label), ['Camille', 'Bruno']);
  await socle.close();
  const again = await open();
  assert.equal(await again.store.within(b.userId, () => count(again.stateOf(b), 'operations')), 3);
  // Idempotence : la même clé de demande rend le même résultat, sans seconde écriture.
  const requestKey = key('op');
  const input = { requestKey, direction: 'charge', label: 'Unique', amount: 5, date: '2026-11-02', status: 'realized', costCenterRef: 'std:divers' };
  const first = await inUser(again, a, () => again.modules.budget.createOperation(a, input));
  const replay = await inUser(again, a, () => again.modules.budget.createOperation(a, input));
  assert.equal(replay.replayed, true);
  assert.equal(replay.operation?.id ?? replay.operationId, first.operation?.id ?? first.operationId);
  await rejects(inUser(again, b, () => again.modules.budget.createOperation(b, { ...input, label: 'Autre' })), 'IDEMPOTENCY_CONFLICT');
  await again.close();
});

test('sgbd · deux serveurs sur la même base : écritures concurrentes sur la même partition, toutes gardées', { skip }, async () => {
  await freshBase();
  const one = await open();
  await one.modules.administration.setParameter('bpm.verrouCycleSuivant', { value: false, expectedRevision: 0, note: 'Tests' });
  const { ctx } = await camille(one);
  const two = await open();
  await Promise.all([
    ...Array.from({ length: 10 }, (_, i) => op(one, ctx, { direction: 'charge', amount: 1 + i, date: '2026-11-01' })),
    ...Array.from({ length: 10 }, (_, i) => op(two, ctx, { direction: 'charge', amount: 100 + i, date: '2026-11-01' })),
  ]);
  assert.ok(one.store.stats.retries + two.store.stats.retries > 0, 'des écritures concurrentes ont été relues et rejouées');
  const total = await one.store.within(ctx.userId, () => count(one.stateOf(ctx), 'operations'));
  assert.equal(total, 20);
  await one.close();
  await two.close();
});

test('sgbd · comptes : e-mail unique sur tout le site, connexion', { skip }, async () => {
  await freshBase();
  const socle = await open();
  const reg = await socle.modules.users.register({ requestKey: key('i'), email: 'a@example.org', password: 'mot de passe solide', label: 'A', userType: 'individuel' });
  assert.equal((await socle.modules.users.authenticate('A@example.org', 'mot de passe solide')).userId, reg.userId);
  await rejects(socle.modules.users.register({ requestKey: key('i'), email: 'a@example.org', password: 'mot de passe solide', label: 'B', userType: 'individuel' }), 'UNIQUENESS_VIOLATION');
  await socle.close();
});

test('sgbd · lecture d’une partition en un seul instantané : une écriture intercalée n’est ni vue à moitié ni écrasée', { skip }, async () => {
  await freshBase();
  const one = await open();
  await one.modules.administration.setParameter('bpm.verrouCycleSuivant', { value: false, expectedRevision: 0, note: 'Tests' });
  const { ctx } = await camille(one);
  const two = await open();
  await op(two, ctx, { direction: 'charge', amount: 1, date: '2026-11-01' });
  // Pendant que « one » relit la partition (révision déjà lue, objets pas encore), « two » écrit.
  let intercalated = 0;
  let seen = null;
  const engine = one.store.engine;
  const read = engine.readPartition.bind(engine);
  engine.readPartition = async (key) => {
    const part = await read(key);
    if (key === ctx.userId && intercalated === 1 && !seen) seen = part;
    return part;
  };
  engine.afterRevisionRead = async (key) => {
    if (key !== ctx.userId || intercalated) return;
    intercalated = 1;
    await op(two, ctx, { direction: 'charge', amount: 2, date: '2026-11-01' });
  };
  await op(one, ctx, { direction: 'charge', amount: 3, date: '2026-11-01' });
  engine.afterRevisionRead = null;
  assert.equal(intercalated, 1, 'une écriture a bien été intercalée pendant la lecture');
  assert.ok(seen, 'la lecture intercalée a été observée');
  // L'instantané est cohérent : sa révision est celle de ses objets (l'écriture intercalée n'y est pas).
  assert.equal(Object.keys(seen.collections.operations).length, 1);
  const total = await two.store.within(ctx.userId, () => count(two.stateOf(ctx), 'operations'));
  assert.equal(total, 3, 'aucune écriture n’a été écrasée');
  await one.close();
  await two.close();
});

test('sgbd · un service appelé hors requête entre de lui-même dans la partition de son user (scripts, mesure de charge)', { skip }, async () => {
  await freshBase();
  const socle = await open();
  await socle.modules.administration.setParameter('bpm.verrouCycleSuivant', { value: false, expectedRevision: 0, note: 'Tests' });
  const { ctx } = await camille(socle);
  // Sans `within` : avant, PARTITION_NOT_LOADED (vue complète inexistante avec un moteur asynchrone).
  const created = await operation(socle, ctx, { direction: 'charge', amount: 12, date: '2026-11-01' });
  assert.ok(created);
  // Une lecture synchrone, elle, se fait dans la partition (comme le serveur le fait pour chaque requête).
  const register = await socle.store.within(ctx.userId, () => socle.modules.bpm.reads.register(ctx, { period: '2026-11' }));
  assert.equal(register.lines.length, 1);
  assert.equal((await socle.modules.users.listUsers()).length, 1);
  await socle.close();
});

test('sgbd · limitation des essais de connexion commune à tous les serveurs (table SY_throttle)', { skip }, async () => {
  await freshBase();
  const { createThrottle } = await import('../src/socle/auth.mjs');
  const one = await open();
  const two = await open();
  const a = createThrottle({ max: 3, windowMs: 60000, store: one.store.engine.throttleStore() });
  const b = createThrottle({ max: 3, windowMs: 60000, store: two.store.engine.throttleStore() });
  await a.failed(['login:x@example.org', 'ip:1']);
  await b.failed(['login:x@example.org', 'ip:2']);
  await a.failed(['login:x@example.org', 'ip:1']);
  await assert.rejects(b.check(['login:x@example.org']), { code: 'AUTH_THROTTLED' });
  await b.succeeded(['login:x@example.org']);
  await a.check(['login:x@example.org']);
  await one.close();
  await two.close();
});
