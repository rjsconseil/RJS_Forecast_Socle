// Dépassement de plafond d'un poste par des dépenses payées : un fait du cycle. Il se lit sur les mouvements
// (`paidOverCents` du registre), il ne bloque jamais la clôture, il est gardé au bilan, et il ne change plus quand le
// plafond change après la clôture (plafonds figés dans la clôture, `closure.capsCents`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { at, key, makeSocle, makeUser } from './helpers.mjs';

async function setup() {
  const { socle } = await makeSocle({ closingLock: true });
  const { ctx } = await makeUser(socle, { label: 'Plafonds', openingStock: 1000, anchorDay: 1, cycleStartDate: '2026-11-01' });
  const budget = socle.modules.budget;
  const bpm = socle.modules.bpm;
  const lifeId = bpm.closingJourney(ctx).context.budgets.find((b) => b.role === 'life').id;
  const setCap = (amount) => budget.setCaps(ctx, lifeId, { expectedRevision: socle.state.budgets[lifeId].revision, caps: { 'std:divers': amount }, merge: true });
  await budget.createOperation(ctx, { requestKey: key('op'), status: 'realized', direction: 'income', label: 'Salaire', amount: 2000, date: '2026-11-01', costCenterRef: 'std:salaires' });
  await setCap(100);
  // Deux dépenses payées du poste « Divers » : 155 € pour un plafond de 100 €.
  for (const [label, amount] of [['Cinéma', 60], ['Concert', 95]]) {
    await budget.createOperation(ctx, { requestKey: key('op'), status: 'realized', direction: 'charge', label, amount, date: '2026-11-02', costCenterRef: 'std:divers' });
  }
  return { socle, ctx, budget, bpm, setCap };
}

test('mouvements : le poste porte son dépassement payé du cycle', async () => {
  const t = await setup();
  const reg = t.bpm.reads.register(t.ctx, { groupBy: 'center' });
  assert.equal(reg.caps.centers['std:divers'].paidOverCents, 5500);
  assert.equal(reg.caps.centers['std:divers'].paidCents, 15500);
  assert.equal(reg.caps.centers['std:divers'].capCents, 10000);
});

test('clôture : le dépassement est signalé, jamais bloquant, puis gardé au bilan et figé', async () => {
  const t = await setup();
  await at('2026-12-02', async () => {
    let j = t.bpm.closingJourney(t.ctx);
    const caps = j.checks.items.find((c) => c.key === 'caps');
    assert.equal(caps.level, 'warning');
    assert.equal(caps.state, 'warn');
    assert.equal(caps.value, '1 poste en dépassement');
    assert.match(caps.items[0].detail, /^en dépassement de 55,00/);
    assert.equal(caps.items[0].amountCents, -5500);
    assert.deepEqual(j.checks.blocking, []);
    assert.equal(j.canClose, true, 'un poste en dépassement ne bloque pas la clôture');

    const r = await t.bpm.finalizeClosing(t.ctx, { requestKey: key('fin'), periodKey: '2026-11', expectedResultCents: j.closing.preview.resultCents });
    assert.deepEqual(r.closure.capsCents, { 'std:divers': 10000 });
    assert.deepEqual(r.closure.bilan.caps.over.map((o) => [o.label, o.capCents, o.paidCents, o.overCents]), [['Divers', 10000, 15500, 5500]]);

    // Le plafond est relevé ensuite : novembre garde son dépassement, décembre suit le nouveau plafond.
    await t.setCap(500);
    const nov = t.bpm.reads.capsReview(t.ctx, { period: '2026-11' }).centers.find((c) => c.ref === 'std:divers');
    assert.equal(nov.capCents, 10000);
    assert.equal(nov.paidOverCents, 5500);
    const dec = t.bpm.reads.capsReview(t.ctx, { period: '2026-12' }).centers.find((c) => c.ref === 'std:divers');
    assert.equal(dec.capCents, 50000);
    j = t.bpm.closingJourney(t.ctx);
    assert.equal(j.period.key, '2026-12');
  });
});

test('bilan provisoire : tous les postes en dépassement, avec leur montant', async () => {
  const t = await setup();
  const b = t.bpm.bilans.build(t.ctx, { key: '2026-11', start: '2026-11-01', end: '2026-11-30', closureId: null });
  assert.equal(b.caps.overCount, 1);
  assert.equal(b.caps.overCents, 5500);
  assert.match(b.highlights.find((h) => h.kind === 'caps').text, /« Divers » en dépassement de 55,00/);
});
