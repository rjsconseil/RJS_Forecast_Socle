// Modifier une ligne du budget récurrent dont l'échéance du cycle est déjà réglée : sur demande (`alsoSettled`),
// le règlement qui compte dans la fenêtre reprend le libellé et le montant de la ligne ; sans demande, il ne bouge pas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { at, key, makeSocle, makeUser } from './helpers.mjs';

async function setup() {
  const { socle } = await makeSocle();
  const { ctx } = await makeUser(socle, { label: 'Correction', openingStock: 10000, anchorDay: 1, cycleStartDate: '2026-11-01' });
  const budget = socle.modules.budget;
  const { recurrence } = await budget.createRecurrence(ctx, { requestKey: key('rec'), label: 'Salaire', direction: 'income', amount: 3500, cadence: 'monthly', firstDate: '2026-11-01', costCenterRef: 'std:salaires' });
  await budget.settleOccurrence(ctx, recurrence.id, { requestKey: key('s'), occurrenceDate: '2026-11-01', realizedDate: '2026-11-03' });
  const rev = () => socle.state.recurrences[recurrence.id].revision;
  const flows = () => socle.modules.bpm.life.lifeManagement(ctx, {}).cycle.flows;
  const bt = () => socle.modules.bpm.reads.budgetType(ctx).lines.find((l) => l.id === recurrence.id);
  return { socle, ctx, budget, rec: recurrence, rev, flows, bt };
}
const novembre = { from: '2026-11-01', to: '2026-11-30' };

test('le budget type signale l’échéance déjà réglée du cycle', async () => {
  const t = await setup();
  assert.deepEqual(t.bt().settledInCycle.map((s) => [s.occurrenceDate, s.realizedCents]), [['2026-11-01', 350000]]);
});

test('sans demande, le règlement du cycle garde son montant', async () => {
  const t = await setup();
  const r = await t.budget.updateRecurrence(t.ctx, t.rec.id, { expectedRevision: t.rev(), amount: 980 });
  assert.equal(r.scope.settledUpdated, undefined);
  assert.equal(t.flows().receivedCents, 350000);
});

test('sur demande, le règlement du cycle reprend le libellé et le montant de la ligne', async () => {
  const t = await setup();
  const r = await t.budget.updateRecurrence(t.ctx, t.rec.id, { expectedRevision: t.rev(), amount: 980, label: 'AAH', alsoSettled: novembre });
  assert.equal(r.scope.settledUpdated.length, 1);
  const op = t.socle.state.operations[r.scope.settledUpdated[0]];
  assert.equal(op.label, 'AAH');
  assert.equal(op.amountCents, 98000);
  assert.equal(op.realizedAmountCents, 98000);
  assert.equal(op.realizedDate, '2026-11-03');
  assert.equal(t.flows().receivedCents, 98000);
  assert.equal(t.bt().settledInCycle[0].realizedCents, 98000);
});

test('un règlement hors de la fenêtre ne change pas', async () => {
  const t = await setup();
  const r = await t.budget.updateRecurrence(t.ctx, t.rec.id, { expectedRevision: t.rev(), amount: 980, alsoSettled: { from: '2026-12-01', to: '2026-12-31' } });
  assert.equal(r.scope.settledUpdated, undefined);
  assert.equal(t.flows().receivedCents, 350000);
});

test('une fenêtre invalide est refusée', async () => {
  const t = await setup();
  await assert.rejects(t.budget.updateRecurrence(t.ctx, t.rec.id, { expectedRevision: t.rev(), amount: 980, alsoSettled: { from: '2026-11-30', to: '2026-11-01' } }), (e) => e.code === 'VALIDATION');
  await assert.rejects(t.budget.updateRecurrence(t.ctx, t.rec.id, { expectedRevision: t.rev(), amount: 980, alsoSettled: { from: 'x' } }), (e) => e.code === 'VALIDATION');
});
