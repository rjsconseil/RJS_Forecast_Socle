// Suppression immédiate d'une ligne du budget récurrent (page « Budget récurrent ») : la définition s'arrête
// hier ; ce qui a déjà été réglé reste, les échéances encore attendues disparaissent aussitôt du cycle en cours.
import test from 'node:test';
import assert from 'node:assert/strict';
import { at, key, makeSocle, makeUser } from './helpers.mjs';

async function setup() {
  const { socle } = await makeSocle();
  const { ctx } = await makeUser(socle, { label: 'Fin immédiate', openingStock: 1000, anchorDay: 1, cycleStartDate: '2026-11-01' });
  const budget = socle.modules.budget;
  const { recurrence } = await budget.createRecurrence(ctx, { requestKey: key('rec'), label: 'Cours de piano', direction: 'charge', amount: 60, cadence: 'weekly', firstDate: '2026-11-02', costCenterRef: 'std:divers' });
  return { socle, ctx, budget, bpm: socle.modules.bpm, rec: recurrence };
}
const lineIds = (t) => t.bpm.closingJourney(t.ctx).points.filter((p) => p.recurrenceId === t.rec.id).map((p) => [p.occurrenceDate, p.state]).sort((a, b) => a[0].localeCompare(b[0]));

test('fin immédiate : les échéances réglées restent, les suivantes du cycle disparaissent', async () => {
  const t = await setup();
  await at('2026-11-20', async () => {
    await t.budget.settleOccurrence(t.ctx, t.rec.id, { requestKey: key('s'), occurrenceDate: '2026-11-02' });
    await t.budget.settleOccurrence(t.ctx, t.rec.id, { requestKey: key('s'), occurrenceDate: '2026-11-09' });
    const before = t.socle.state.recurrences[t.rec.id];
    await t.budget.updateRecurrence(t.ctx, t.rec.id, { expectedRevision: before.revision, endDate: '2026-11-19' });
    // Novembre ne garde que les deux échéances réglées ; celle du 16 (non réglée) aussi, puisqu'elle précède la fin.
    assert.deepEqual(lineIds(t), [['2026-11-02', 'closed'], ['2026-11-09', 'closed'], ['2026-11-16', 'open']]);
    // Plus aucune échéance après la fin, ni en novembre ni ensuite.
    assert.equal(t.socle.state.recurrences[t.rec.id].endDate, '2026-11-19');
  });
});

test('une fin ne peut pas précéder une échéance déjà réglée (réglée en avance)', async () => {
  const t = await setup();
  await at('2026-11-20', async () => {
    await t.budget.settleOccurrence(t.ctx, t.rec.id, { requestKey: key('s'), occurrenceDate: '2026-11-23', realizedDate: '2026-11-20' });
    const rev = t.socle.state.recurrences[t.rec.id].revision;
    await assert.rejects(t.budget.updateRecurrence(t.ctx, t.rec.id, { expectedRevision: rev, endDate: '2026-11-19' }), (err) => {
      assert.equal(err.code, 'VALIDATION');
      assert.equal(err.details.lastSettled, '2026-11-23');
      return true;
    });
    // À la date de la dernière échéance réglée, la fin est acceptée.
    await t.budget.updateRecurrence(t.ctx, t.rec.id, { expectedRevision: rev, endDate: '2026-11-23' });
    assert.equal(t.socle.state.recurrences[t.rec.id].endDate, '2026-11-23');
  });
});

