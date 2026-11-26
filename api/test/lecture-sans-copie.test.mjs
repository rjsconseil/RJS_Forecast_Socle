// Chantier 4 · Lecture sans copie : le brouillon d'une transaction ne copie que les objets lus, et seuls les objets
// copiés, écrits ou supprimés sont comparés à la vue publiée. Les contrats vus des modules ne changent pas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { camille, makeSocle, operation } from './helpers.mjs';

async function withOperations(n = 5) {
  const { socle } = await makeSocle();
  const { ctx, bundle } = await camille(socle);
  for (let i = 0; i < n; i += 1) await operation(socle, ctx, { direction: 'charge', amount: 10 + i, date: '2026-11-02', label: `Op ${i}` });
  return { socle, ctx, bundle };
}

test('brouillon : la collection se lit comme un objet ordinaire (in, Object.keys/values/entries, spread, JSON)', async () => {
  const { socle, ctx } = await withOperations(4);
  const om = socle.scopeOf('budget').om;
  const published = socle.state.operations;
  const ids = Object.keys(published);
  await om.command('lecture', ctx, {}, (tx) => {
    const ops = tx.draft.operations;
    assert.deepEqual(Object.keys(ops), ids);
    assert.equal(Object.values(ops).length, ids.length);
    assert.deepEqual(Object.entries(ops).map(([id]) => id), ids);
    assert.ok(ids[0] in ops);
    assert.ok(Object.hasOwn(ops, ids[0]));
    assert.equal('op_absent' in ops, false);
    assert.equal(ops.op_absent, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(ops)), JSON.parse(JSON.stringify(published)));
    assert.deepEqual(Object.keys({ ...ops }), ids);
    const seen = [];
    for (const id in ops) seen.push(id);
    assert.deepEqual(seen, ids);
    tx.unchanged = true;
    return {};
  });
  await socle.close();
});

test('brouillon : un objet lu est une copie modifiable, la même à chaque lecture ; la vue publiée reste gelée', async () => {
  const { socle, ctx } = await withOperations(2);
  const om = socle.scopeOf('budget').om;
  const [id] = Object.keys(socle.state.operations);
  const before = socle.state.operations[id];
  await om.command('lecture', ctx, {}, (tx) => {
    const a = tx.draft.operations[id];
    assert.equal(Object.isFrozen(a), false);
    assert.equal(a, tx.draft.operations[id]);
    assert.notEqual(a, before);
    a.label = 'Modifié dans le brouillon';
    assert.equal(before.label === 'Modifié dans le brouillon', false);
    tx.unchanged = true;
    return {};
  });
  assert.equal(socle.state.operations[id], before);
  assert.ok(Object.isFrozen(socle.state.operations[id]));
  await socle.close();
});

test('écriture : seul l’objet modifié change de référence ; les autres objets publiés sont repris tels quels', async () => {
  const { socle, ctx } = await withOperations(5);
  const om = socle.scopeOf('budget').om;
  const before = socle.state.operations;
  const [target, ...others] = Object.keys(before);
  const revision = before[target].revision;
  await om.command('test', ctx, {}, (tx) => {
    for (const o of Object.values(tx.draft.operations)) void o.label; // lecture de tout : copies sans changement
    om.update(tx, tx.draft.operations[target], { note: 'note' });
    return {};
  });
  const after = socle.state.operations;
  assert.notEqual(after[target], before[target]);
  assert.equal(after[target].revision, revision + 1);
  for (const id of others) assert.equal(after[id], before[id], `${id} reste la même référence`);
  assert.ok(Object.isFrozen(after[target]));
  await socle.close();
});

test('lecture seule : une commande qui lit sans rien changer n’écrit rien', async () => {
  const { socle, ctx } = await withOperations(3);
  const om = socle.scopeOf('budget').om;
  const commits = socle.store.stats.commits;
  const revision = socle.store.revisionOf(ctx.userId);
  await socle.store.mutate((draft) => {
    for (const o of Object.values(draft.operations)) void o.amountCents;
    om.list(draft, 'operation', () => true);
    return { value: null };
  }, { partition: ctx.userId });
  assert.equal(socle.store.stats.commits, commits);
  assert.equal(socle.store.revisionOf(ctx.userId), revision);
  await socle.close();
});

test('om.list et om.by sur un brouillon : filtre sur les originaux, copies pour les seuls objets retenus', async () => {
  const { socle, ctx } = await withOperations(6);
  const om = socle.scopeOf('budget').om;
  const published = socle.state.operations;
  const wanted = Object.values(published).find((o) => o.label === 'Op 3');
  await om.command('test', ctx, {}, (tx) => {
    const found = om.list(tx.draft, 'operation', (o) => o.label === 'Op 3');
    assert.equal(found.length, 1);
    assert.equal(found[0].id, wanted.id);
    assert.equal(Object.isFrozen(found[0]), false);
    assert.equal(found[0], tx.draft.operations[wanted.id], 'la copie retenue est celle du brouillon');
    const byUser = om.by(tx.draft, 'operation', 'userId', ctx.userId);
    assert.equal(byUser.length, Object.keys(published).length);
    om.update(tx, found[0], { note: 'retenue' });
    return {};
  });
  assert.equal(socle.state.operations[wanted.id].note, 'retenue');
  await socle.close();
});

test('brouillon : création, remplacement puis suppression d’un objet nouveau dans la même transaction', async () => {
  const { socle, ctx } = await withOperations(1);
  const om = socle.scopeOf('budget').om;
  const count = Object.keys(socle.state.operations).length;
  await assert.rejects(om.command('test', ctx, {}, (tx) => {
    tx.draft.operations.op_temp = { id: 'op_temp', userId: ctx.userId };
    assert.ok('op_temp' in tx.draft.operations);
    assert.ok(Object.keys(tx.draft.operations).includes('op_temp'));
    return {};
  }), (err) => err.code === 'UNTRACKED_WRITE');
  await om.command('test', ctx, {}, (tx) => {
    tx.draft.operations.op_temp = { id: 'op_temp', userId: ctx.userId };
    delete tx.draft.operations.op_temp;
    assert.equal('op_temp' in tx.draft.operations, false);
    tx.unchanged = true;
    return {};
  });
  assert.equal(Object.keys(socle.state.operations).length, count);
  await socle.close();
});

test('aperçu (simulate) : relu par les métriques sans toucher la vue publiée', async () => {
  const { socle, ctx } = await withOperations(2);
  const om = socle.scopeOf('budget').om;
  const published = socle.state.operations;
  const { draft } = om.simulate('aperçu', ctx, {}, (tx) => {
    const { id, kind, userId, revision, createdAt, updatedAt, provenance, lastChange, ...fields } = Object.values(published)[0];
    return om.create(tx, 'operation', { ...fields, label: 'Simulée' });
  });
  assert.equal(Object.keys(draft.operations).length, Object.keys(published).length + 1);
  assert.ok(Object.isFrozen(draft.operations), 'collection relisible (index mémorisables)');
  for (const id of Object.keys(published)) assert.equal(draft.operations[id], published[id], 'objets non lus repris sans copie');
  assert.equal(socle.state.operations, published);
  await socle.close();
});
