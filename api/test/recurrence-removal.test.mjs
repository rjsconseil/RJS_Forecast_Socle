// Supprimer une ligne du budget récurrent depuis la page (suite de commandes de act-budget-type.ts) : la ligne ne doit
// plus compter dans le cycle en cours. Cas réel du 28/11 : une entrée de 5 € (non réglée) et une de 980 € (réglée)
// restaient sur l'accueil après leur suppression, car la fin posée la veille gardait l'échéance du 1er du cycle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { key, makeSocle, makeUser } from './helpers.mjs';

async function setup({ settle }) {
  const { socle } = await makeSocle();
  const { ctx } = await makeUser(socle, { label: 'Suppression', openingStock: 10000, anchorDay: 1, cycleStartDate: '2026-11-01' });
  const budget = socle.modules.budget;
  const { recurrence } = await budget.createRecurrence(ctx, { requestKey: key('rec'), label: 'Salaire', direction: 'income', amount: settle ? 980 : 5, cadence: 'monthly', firstDate: '2026-11-01', costCenterRef: 'std:salaires' });
  if (settle) await budget.settleOccurrence(ctx, recurrence.id, { requestKey: key('s'), occurrenceDate: '2026-11-01', realizedDate: '2026-11-03' });
  const life = () => socle.modules.bpm.life.lifeManagement(ctx, {}).cycle.flows;
  const line = () => socle.modules.bpm.reads.budgetType(ctx).lines.find((l) => l.id === recurrence.id);
  const rev = () => socle.state.recurrences[recurrence.id].revision;
  return { socle, ctx, budget, id: recurrence.id, life, line, rev };
}

test('une ligne sans règlement est retirée entièrement : plus rien à recevoir dans le cycle', async () => {
  const t = await setup({ settle: false });
  assert.equal(t.life().incomeLines.length, 1);
  await t.budget.cancelRecurrence(t.ctx, t.id, { expectedRevision: t.rev(), reason: 'Supprimée depuis le budget récurrent' });
  assert.equal(t.life().incomeLines.length, 0);
  assert.equal(t.life().toReceiveCents, 0);
  assert.equal(t.line(), undefined);
});

test('une ligne réglée ce cycle : son règlement est annulé, puis elle est retirée entièrement', async () => {
  const t = await setup({ settle: true });
  assert.equal(t.life().receivedCents, 98000);
  const [s] = t.line().settledInCycle;
  assert.equal(typeof s.revision, 'number');
  await t.budget.cancelRealization(t.ctx, s.operationId, { expectedRevision: s.revision });
  // La définition n'a pas changé de version : la page enchaîne avec la révision qu'elle a lue.
  await t.budget.cancelRecurrence(t.ctx, t.id, { expectedRevision: t.line().revision });
  assert.equal(t.life().receivedCents, 0);
  assert.equal(t.life().incomeLines.length, 0);
  assert.equal(t.line(), undefined);
});

test('règlement gardé : la suppression est refusée, la fin se pose sur le dernier règlement', async () => {
  const t = await setup({ settle: true });
  await assert.rejects(t.budget.cancelRecurrence(t.ctx, t.id, { expectedRevision: t.rev() }), (e) => e.code === 'FORBIDDEN_BY_RULE' && e.details.settled === 1);
  await t.budget.updateRecurrence(t.ctx, t.id, { expectedRevision: t.rev(), endDate: '2026-11-01' });
  assert.equal(t.life().receivedCents, 98000);
  assert.equal(t.life().incomeLines.length, 1);
  assert.equal(t.line(), undefined);
});
