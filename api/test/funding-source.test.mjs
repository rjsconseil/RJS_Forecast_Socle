// Source de financement d'un projet de la vie : le cycle budgétaire (par défaut) ou le patrimoine (hors cycle).
// docs/COMPTABILITE-PROJET-DE-VIE.md : une dépense validée est comptée une seule fois, au cycle ou au patrimoine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at, camille, key, makeSocle, operation, rejects } from './helpers.mjs';

const P = (s) => s.modules.bpm.projects;
const B = (s) => s.modules.budget;
const value = (s, ctx, k, periodKey) => s.modules.bpm.figure(ctx, k, periodKey ? { periodKey } : {}).value;

async function fixture(fundingSource) {
  const { socle: s } = await makeSocle();
  const { ctx } = await camille(s);
  await at('2026-09-02', () => operation(s, ctx, { direction: 'income', label: 'Salaire', amount: 2000, date: '2026-09-02' }));
  await at('2026-09-10', () => operation(s, ctx, { direction: 'charge', label: 'Courses', amount: 300, date: '2026-09-10', costCenterRef: 'std:alimentation' }));
  const p = await at('2026-09-05', () => P(s).createProject(ctx, { requestKey: key(), title: 'Maison', amount: 5000, fundingSource }));
  const t = await P(s).createTask(ctx, { requestKey: key(), title: 'Toiture', projectId: p.coreProjectId });
  await at('2026-09-20', () => B(s).createOperation(ctx, { requestKey: key(), budgetId: p.budgetId, taskId: t.task.id, direction: 'charge', label: 'Toiture', amount: 450, date: '2026-09-20', status: 'realized', costCenterRef: 'std:logement', fund: true }));
  return { s, ctx, p };
}

test('projet du cycle : la dépense entre dans le dépensé du cycle et réduit son résultat', async () => {
  const { s, ctx } = await fixture('cycle');
  assert.deepEqual([value(s, ctx, 'bpm.charges', '2026-09'), value(s, ctx, 'bpm.chargesProjets', '2026-09'), value(s, ctx, 'bpm.prelevementsProjets', '2026-09')], [750, 450, 0]);
  assert.equal(value(s, ctx, 'bpm.resultatPeriode', '2026-09'), 1250);
});

test('projet du patrimoine : hors cycle, la dépense est prélevée sur le patrimoine à sa date réelle', async () => {
  const { s, ctx, p } = await fixture('patrimoine');
  assert.equal(P(s).projectDetail(ctx, p.coreProjectId).budget.fundingSource, 'patrimoine');
  // Le cycle ne la voit pas : ni dépensé, ni résultat, ni registre, ni plafonds.
  assert.deepEqual([value(s, ctx, 'bpm.charges', '2026-09'), value(s, ctx, 'bpm.chargesProjets', '2026-09'), value(s, ctx, 'bpm.resultatPeriode', '2026-09')], [300, 0, 1700]);
  const register = s.modules.bpm.reads.register(ctx, { period: '2026-09', dateBasis: 'realized', groupBy: 'none' });
  assert.equal(register.lines.some((l) => l.label === 'Toiture'), false);
  // Le patrimoine, lui, la voit : prélevée pendant septembre, déduite du stock dès octobre.
  assert.equal(value(s, ctx, 'bpm.prelevementsProjets', '2026-09'), 450);
  const before = value(s, ctx, 'bpm.patrimoineConstitue', '2026-09');
  assert.equal(value(s, ctx, 'bpm.patrimoineFinPeriode', '2026-09'), before + 1700 - 450);
  for (const periodKey of ['2026-08', '2026-09']) await s.modules.bpm.closePeriod(ctx, { requestKey: key(), periodKey });
  assert.equal(value(s, ctx, 'bpm.patrimoineConstitue', '2026-10'), before + 1700 - 450);
  // Le bilan de septembre : résultat versé intact, prélèvement à part.
  const bilan = Object.values(s.state.closures).find((c) => c.periodKey === '2026-09').bilan;
  assert.deepEqual([bilan.patrimoine.capitalizedCents, bilan.patrimoine.projectsCents, bilan.patrimoine.withdrawnCents], [170000, 0, 45000]);
  assert.equal(bilan.patrimoine.stockAfterCents, bilan.patrimoine.stockBeforeCents + 170000 - 45000);
  assert.ok(bilan.highlights.some((h) => h.kind === 'withdrawal'));
  assert.deepEqual(bilan.projects.map((x) => [x.name, x.fundingSource, x.paidCents]), [['Maison', 'patrimoine', 45000]]);
});

test('source de financement : modifiable tant qu’aucune dépense n’est comptabilisée, figée ensuite', async () => {
  const { s, ctx, p } = await fixture('cycle');
  const revision = () => P(s).projectDetail(ctx, p.coreProjectId).budget.revision;
  await rejects(P(s).allocate(ctx, p.budgetId, { amount: 5000, fundingSource: 'patrimoine', expectedRevision: revision() }), 'FORBIDDEN_BY_RULE');
  const other = await P(s).createProject(ctx, { requestKey: key(), title: 'Voyage', amount: 800 });
  const rev = P(s).projectDetail(ctx, other.coreProjectId).budget.revision;
  await P(s).allocate(ctx, other.budgetId, { amount: 800, fundingSource: 'patrimoine', expectedRevision: rev });
  assert.equal(P(s).projectDetail(ctx, other.coreProjectId).budget.fundingSource, 'patrimoine');
});
