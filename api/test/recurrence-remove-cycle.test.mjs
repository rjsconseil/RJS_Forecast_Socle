// Supprimer une ligne du budget récurrent et la retirer du cycle en cours (`removeIn`) : ses règlements du cycle
// sont annulés et ses échéances non réglées du cycle écartées ; l'accueil ne la compte plus. Sans demande, ce qui est
// réglé reste (règle d'avant).
import test from 'node:test';
import assert from 'node:assert/strict';
import { at, key, makeSocle, makeUser } from './helpers.mjs';

const novembre = { from: '2026-11-01', to: '2026-11-30' };
async function setup({ firstDate = '2026-11-01', cadence = 'monthly', amount = 980 } = {}) {
  const { socle } = await makeSocle();
  const { ctx } = await makeUser(socle, { label: 'Retrait', openingStock: 10000, anchorDay: 1, cycleStartDate: '2026-11-01' });
  const budget = socle.modules.budget;
  const { recurrence } = await budget.createRecurrence(ctx, { requestKey: key('rec'), label: 'AAH', direction: 'income', amount, cadence, firstDate, costCenterRef: 'std:salaires' });
  const rev = () => socle.state.recurrences[recurrence.id].revision;
  const flows = () => socle.modules.bpm.life.lifeManagement(ctx, {}).cycle.flows;
  return { socle, ctx, budget, rec: recurrence, rev, flows };
}

test('ligne réglée supprimée et retirée du cycle : l’accueil ne la compte plus', async () => {
  const t = await setup();
  await at('2026-11-28', async () => {
    await t.budget.settleOccurrence(t.ctx, t.rec.id, { requestKey: key('s'), occurrenceDate: '2026-11-01', realizedDate: '2026-11-28' });
    assert.equal(t.flows().receivedCents, 98000);
    const r = await t.budget.updateRecurrence(t.ctx, t.rec.id, { expectedRevision: t.rev(), endDate: '2026-11-27', removeIn: novembre });
    assert.equal(r.scope.settledRemoved.length, 1);
    const f = t.flows();
    assert.equal(f.receivedCents, 0);
    assert.equal(f.toReceiveCents, 0);
  });
});

test('sans retrait demandé, le règlement du cycle reste (règle d’avant)', async () => {
  const t = await setup();
  await at('2026-11-28', async () => {
    await t.budget.settleOccurrence(t.ctx, t.rec.id, { requestKey: key('s'), occurrenceDate: '2026-11-01', realizedDate: '2026-11-28' });
    await t.budget.updateRecurrence(t.ctx, t.rec.id, { expectedRevision: t.rev(), endDate: '2026-11-27' });
    assert.equal(t.flows().receivedCents, 98000);
  });
});

test('échéances non réglées du cycle avant la suppression : écartées avec le retrait', async () => {
  const t = await setup({ cadence: 'weekly', amount: 5, firstDate: '2026-11-02' });
  await at('2026-11-28', async () => {
    assert.equal(t.flows().toReceiveCents, 2500);
    await t.budget.updateRecurrence(t.ctx, t.rec.id, { expectedRevision: t.rev(), endDate: '2026-11-27', removeIn: novembre });
    assert.equal(t.flows().toReceiveCents, 0);
    assert.equal(t.flows().receivedCents, 0);
  });
});

test('ligne sans échéance passée mais déjà réglée : la suppression complète passe avec le retrait', async () => {
  const t = await setup({ firstDate: '2026-11-28', amount: 5 });
  await at('2026-11-28', async () => {
    await t.budget.settleOccurrence(t.ctx, t.rec.id, { requestKey: key('s'), occurrenceDate: '2026-11-28' });
    await assert.rejects(t.budget.cancelRecurrence(t.ctx, t.rec.id, { expectedRevision: t.rev() }), (e) => e.code === 'FORBIDDEN_BY_RULE');
    await t.budget.cancelRecurrence(t.ctx, t.rec.id, { expectedRevision: t.rev(), removeIn: novembre });
    assert.equal(t.flows().receivedCents, 0);
    assert.ok(t.socle.state.recurrences[t.rec.id].cancelledAt);
  });
});

test('un règlement d’avance d’une échéance après la fin est retiré sans refus', async () => {
  const t = await setup();
  await at('2026-11-28', async () => {
    await t.budget.settleOccurrence(t.ctx, t.rec.id, { requestKey: key('s'), occurrenceDate: '2026-12-01', realizedDate: '2026-11-28' });
    await t.budget.updateRecurrence(t.ctx, t.rec.id, { expectedRevision: t.rev(), endDate: '2026-11-27', removeIn: novembre });
    assert.equal(t.flows().receivedCents, 0);
  });
});
