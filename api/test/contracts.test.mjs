// Lot 2 : récurrences (définition / occurrence / règlement), lectures communes, projection et
// objectifs, assistant « Partir de zéro ». Exemples financiers du §15.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occurrenceDates } from '../src/modules/budget/recurrence.mjs';
import { project } from '../src/modules/patrimoine/projection.mjs';
import { camille, key, makeSocle, makeUser, operation, rejects } from './helpers.mjs';

const recurrence = (socle, ctx, input) => socle.modules.budget.createRecurrence(ctx, { requestKey: key('rec'), costCenterRef: input.direction === 'income' ? 'std:salaires' : 'std:logement', label: 'Récurrence', ...input });
const value = (socle, ctx, k, periodKey) => socle.modules.bpm.figure(ctx, k, { periodKey }).value;
const reads = (socle) => socle.modules.bpm.reads;

// ---------- récurrences ----------

test('occurrences : hebdomadaire, mensuelle (31 → fin de mois), annuelle (29 février), fin incluse', () => {
  assert.deepEqual(occurrenceDates({ cadence: 'weekly', firstDate: '2026-11-02' }, '2026-11-01', '2026-11-30'), ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
  assert.deepEqual(occurrenceDates({ cadence: 'monthly', firstDate: '2026-01-31' }, '2026-01-01', '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(occurrenceDates({ cadence: 'yearly', firstDate: '2028-02-29' }, '2028-01-01', '2030-12-31'), ['2028-02-29', '2029-02-28', '2030-02-28']);
  assert.deepEqual(occurrenceDates({ cadence: 'monthly', firstDate: '2026-01-15', endDate: '2026-03-15' }, '2026-01-01', '2026-12-31'), ['2026-01-15', '2026-02-15', '2026-03-15']);
  // Fenêtre lointaine : calcul direct, sans énumérer depuis la première date.
  assert.deepEqual(occurrenceDates({ cadence: 'weekly', firstDate: '2026-01-05' }, '2078-01-01', '2078-01-10'), ['2078-01-03', '2078-01-10']);
});

test('récurrence : occurrences attendues dans le prévu et le restant, règlement unique, réalisé à la date réelle', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const salaire = await recurrence(socle, ctx, { direction: 'income', label: 'Salaire', amount: 3000, cadence: 'monthly', firstDate: '2026-08-28' });
  const loyer = await recurrence(socle, ctx, { direction: 'charge', label: 'Loyer', amount: 900, cadence: 'monthly', firstDate: '2026-08-05' });
  assert.equal(value(socle, ctx, 'bpm.revenusPrevus'), 3000);
  assert.equal(value(socle, ctx, 'bpm.resteAPayer'), 900);
  assert.equal(value(socle, ctx, 'bpm.soldeAttendu'), 2100);

  const b = socle.modules.budget;
  const paid = await b.settleOccurrence(ctx, loyer.recurrence.id, { requestKey: key('s'), occurrenceDate: '2026-11-05', realizedAmount: 910, realizedDate: '2026-11-03' });
  assert.deepEqual([paid.operation.date, paid.operation.amount, paid.operation.realizedAmount, paid.operation.occurrenceDate], ['2026-11-05', 900, 910, '2026-11-05']);
  await rejects(b.settleOccurrence(ctx, loyer.recurrence.id, { requestKey: key('s'), occurrenceDate: '2026-11-05' }), 'ALREADY_SETTLED');
  await rejects(b.settleOccurrence(ctx, loyer.recurrence.id, { requestKey: key('s'), occurrenceDate: '2026-11-06' }), 'VALIDATION');
  await rejects(b.settleOccurrence(ctx, salaire.recurrence.id, { requestKey: key('s'), occurrenceDate: '2026-11-28', realizedDate: '2026-11-28' }), 'FUTURE_REALIZATION');
  assert.equal(value(socle, ctx, 'bpm.charges'), 910);
  assert.equal(value(socle, ctx, 'bpm.resteAPayer'), 0, 'une occurrence réglée ne reste pas dans le restant');
  assert.equal(value(socle, ctx, 'bpm.chargesPrevues'), 900, 'compte une seule fois dans le prévu');

  // Annulation du règlement : l'occurrence redevient attendue, même identité.
  await b.cancelRealization(ctx, paid.operation.id, { expectedRevision: 1 });
  assert.equal(value(socle, ctx, 'bpm.resteAPayer'), 900);
  const again = await b.settleOccurrence(ctx, loyer.recurrence.id, { requestKey: key('s'), occurrenceDate: '2026-11-05', realizedDate: '2026-11-02' });
  assert.equal(again.operation.id, paid.operation.id);
});

test('prévu par date prévue, réalisé par date réelle : prévue le 31 octobre, payée le 2 novembre', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const op = await operation(socle, ctx, { direction: 'charge', label: 'Facture', amount: 100, date: '2026-10-31', status: 'planned' });
  await socle.modules.budget.realizeOperation(ctx, op.operation.id, { expectedRevision: 1, realizedDate: '2026-11-02' });
  assert.equal(value(socle, ctx, 'bpm.chargesPrevues', '2026-10'), 100);
  assert.equal(value(socle, ctx, 'bpm.charges', '2026-10'), 0);
  assert.equal(value(socle, ctx, 'bpm.charges', '2026-11'), 100);
  const oct = reads(socle).register(ctx, { period: '2026-10' });
  assert.deepEqual(oct.lines.map((l) => [l.label, l.status]), [['Facture', 'settled']]);
});

test('clôture protégée : occurrence d’une période close réglée plus tard, à sa date réelle, historique inchangé', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const rec = await recurrence(socle, ctx, { direction: 'charge', label: 'Assurance', amount: 60, cadence: 'monthly', firstDate: '2026-08-20' });
  await socle.modules.bpm.closePeriod(ctx, { requestKey: key('c'), periodKey: '2026-08' });
  const aug = reads(socle).register(ctx, { period: '2026-08' });
  assert.deepEqual(aug.lines.map((l) => l.status), ['unrealized']);
  assert.equal(aug.totals.unrealizedCents, 6000);
  assert.equal(aug.totals.paidCents, 0);
  await rejects(socle.modules.budget.settleOccurrence(ctx, rec.recurrence.id, { requestKey: key('s'), occurrenceDate: '2026-08-20', realizedDate: '2026-08-25' }), 'PERIOD_CLOSED');
  await socle.modules.budget.settleOccurrence(ctx, rec.recurrence.id, { requestKey: key('s'), occurrenceDate: '2026-08-20', realizedDate: '2026-11-01' });
  assert.equal(value(socle, ctx, 'bpm.charges', '2026-08'), 0, 'chiffres clos enregistrés');
  assert.equal(value(socle, ctx, 'bpm.charges', '2026-11'), 60);
});

test('définition modifiée : portée sur les occurrences attendues, règlements intacts, première date figée', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const b = socle.modules.budget;
  const rec = await recurrence(socle, ctx, { direction: 'charge', label: 'Box', amount: 30, cadence: 'monthly', firstDate: '2026-10-01' });
  const s = await b.settleOccurrence(ctx, rec.recurrence.id, { requestKey: key('s'), occurrenceDate: '2026-10-01' });
  const u = await b.updateRecurrence(ctx, rec.recurrence.id, { expectedRevision: 1, amount: 35, note: 'Nouveau tarif' });
  assert.deepEqual(u.scope, { appliesTo: 'occurrences encore attendues', settledUntouched: 1 });
  assert.equal(socle.state.operations[s.operation.id].amountCents, 3000);
  assert.equal(value(socle, ctx, 'bpm.resteAPayer'), 35);
  await rejects(b.updateRecurrence(ctx, rec.recurrence.id, { expectedRevision: 2, firstDate: '2026-10-02' }), 'FORBIDDEN_BY_RULE');
});

test('une cadence saisie n’est jamais ignorée : l’éditeur partagé crée une définition récurrente', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const r = await socle.modules.budget.createEntry(ctx, { requestKey: key('e'), direction: 'charge', label: 'Cantine', amount: 20, cadence: 'weekly', firstDate: '2026-11-02', costCenterRef: 'std:alimentation' });
  assert.equal(r.recurrence.cadence, 'weekly');
  assert.equal(value(socle, ctx, 'bpm.chargesPrevues'), 100, '5 lundis en novembre 2026');
  await rejects(socle.modules.budget.createEntry(ctx, { requestKey: key('e'), direction: 'charge', label: 'X', amount: 1, cadence: 'daily', date: '2026-11-02', costCenterRef: 'std:divers' }), 'VALIDATION');
});

// ---------- lectures communes ----------

test('registre : filtres, regroupement, totaux suivant les filtres ; détail d’une échéance', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  await operation(socle, ctx, { direction: 'charge', label: 'Courses Lidl', amount: 80, date: '2026-11-01', costCenterRef: 'std:alimentation' });
  await operation(socle, ctx, { direction: 'charge', label: 'Restaurant', amount: 40, date: '2026-11-10', status: 'planned', costCenterRef: 'std:loisirs' });
  const rec = await recurrence(socle, ctx, { direction: 'charge', label: 'Loyer', amount: 900, cadence: 'monthly', firstDate: '2026-08-02' });
  const r = reads(socle).register(ctx, { direction: 'charge' });
  assert.deepEqual([r.totals.paidCents, r.totals.toPayCents, r.totals.lineCount], [8000, 94000, 3]);
  assert.deepEqual(r.lines.find((l) => l.label === 'Loyer').status, 'late');
  assert.deepEqual(r.groups.map((g) => g.label).sort(), ['Alimentation', 'Logement', 'Loisirs']);
  const f = reads(socle).register(ctx, { direction: 'charge', q: 'lidl' });
  assert.deepEqual([f.totals.lineCount, f.totals.unfilteredCount, f.totals.paidCents], [1, 3, 8000]);
  const byStatus = reads(socle).register(ctx, { status: 'pending' });
  assert.deepEqual(byStatus.lines.map((l) => l.label), ['Restaurant']);

  const lineId = `${rec.recurrence.id}@2026-11-02`;
  const d = reads(socle).lineDetail(ctx, lineId);
  assert.deepEqual([d.line.kind, d.definition.cadence, d.ids.recurrenceId, d.actions.canSettle], ['occurrence', 'monthly', rec.recurrence.id, true]);
  await rejects(async () => reads(socle).lineDetail(ctx, `${rec.recurrence.id}@2026-11-03`), 'NOT_FOUND');
});

test('centres : payé, restant, plafond et marge ; base des parts sur 100 € ; centre personnalisé propre au user', async () => {
  const { socle } = await makeSocle();
  const { ctx, bundle } = await camille(socle);
  const u2 = await makeUser(socle, { label: 'U2', anchorDay: 1, cycleStartDate: '2026-08-01' });
  await operation(socle, ctx, { direction: 'income', amount: 2000, date: '2026-11-01' });
  await operation(socle, ctx, { direction: 'charge', amount: 500, date: '2026-11-02', costCenterRef: 'std:alimentation' });
  await operation(socle, ctx, { direction: 'charge', amount: 100, date: '2026-11-20', status: 'planned', costCenterRef: 'std:alimentation' });
  await socle.modules.budget.setCaps(ctx, bundle.budgetId, { expectedRevision: 1, caps: { 'std:alimentation': 550 } });
  const c = reads(socle).centers(ctx);
  const alim = c.rows.find((r) => r.key === 'alimentation');
  assert.deepEqual([alim.paidCents, alim.remainingCents, alim.capCents, alim.marginCents, alim.sharePct], [50000, 10000, 55000, -5000, 25]);
  assert.deepEqual([c.basis.kind, c.basis.restCents, c.basis.restSharePct], ['received', 150000, 75]);

  const cc = await socle.modules.budget.addCustomCostCenter(ctx, { requestKey: key('cc'), label: 'Plombier', direction: 'charge' });
  assert.ok(socle.modules.budget.costCentersOf(socle.state, ctx.userId).some((x) => x.label === 'Plombier'));
  assert.ok(!socle.modules.budget.costCentersOf(socle.state, u2.ctx.userId).some((x) => x.label === 'Plombier'), 'absent du catalogue de U2');
  await rejects(operation(socle, u2.ctx, { direction: 'charge', amount: 1, date: '2026-11-01', costCenterRef: cc.costCenterId }), 'REFERENCE_NOT_FOUND');
});

test('§15 solde : reçu 3 000, payé 2 000, à recevoir 200, à payer 400 → net 1 000, attendu 800 ; rapprochement', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  await operation(socle, ctx, { direction: 'income', amount: 3000, date: '2026-11-01' });
  await operation(socle, ctx, { direction: 'charge', amount: 2000, date: '2026-11-02' });
  await operation(socle, ctx, { direction: 'income', amount: 200, date: '2026-11-25', status: 'planned' });
  await operation(socle, ctx, { direction: 'charge', amount: 400, date: '2026-11-26', status: 'planned' });
  const bal = reads(socle).balance(ctx, { initial: '1500', current: '2400' });
  assert.deepEqual([bal.netCents, bal.expectedCents, bal.receivedCents, bal.paidCents], [100000, 80000, 300000, 200000]);
  assert.deepEqual([bal.reconciliation.variationCents, bal.reconciliation.gapCents, bal.reconciliation.createsOperation], [90000, -10000, false]);
  assert.match(bal.reconciliation.suggestion, /dépense/);
  assert.equal(bal.closingDate, '2026-11-30');
});

test('§15 stock 10 000 comprenant une clôture de 800 : la lecture de la clôture ne donne pas 10 800', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await makeUser(socle, { openingStock: 9200, anchorDay: 1, cycleStartDate: '2026-08-01' });
  await operation(socle, ctx, { direction: 'income', amount: 800, date: '2026-08-10' });
  await socle.modules.bpm.closePeriod(ctx, { requestKey: key('c'), periodKey: '2026-08' });
  assert.equal(value(socle, ctx, 'bpm.patrimoineConstitue'), 10000);
  assert.equal(value(socle, ctx, 'bpm.patrimoineFinPeriode', '2026-08'), 10000);
  const h = reads(socle).history(ctx, { limit: 6 });
  const aug = h.rows.find((r) => r.periodKey === '2026-08');
  assert.deepEqual([aug.recorded, aug.netCents, aug.patrimoineCents, aug.capitalizedCents], [true, 80000, 1000000, 80000]);
  assert.deepEqual([h.rows.length, h.total, h.rows[0].periodKey], [4, 4, '2026-11']);
});

// ---------- projection et objectifs ----------

test('§15 projection : 10 000 + 100/mois, un an à 0 % → 11 200 ; à 5 %/2 % → nominal 11 700, réel 11 470,59', () => {
  const base = { startCents: 1000000, startYear: 2026, horizonYears: 1, contributionCents: 10000, perYear: 12 };
  const zero = project({ ...base, ratePct: 0, inflationPct: 0 });
  assert.deepEqual([zero.rows[1].nominalCents, zero.rows[1].realCents], [1120000, 1120000]);
  const five = project({ ...base, ratePct: 5, inflationPct: 2 });
  assert.deepEqual([five.rows[1].nominalCents, five.rows[1].realCents], [1170000, 1147059]);
  assert.equal(Math.round(five.realReturnPct * 1000) / 1000, 2.941);
});

test('§15 couverture : capital 1 000, objectif immédiat 2 000 → 1 000 couverts, 50 %, partiel ; réservation sans double emploi', () => {
  const r = project({ startCents: 100000, startYear: 2026, horizonYears: 5, ratePct: 0, inflationPct: 0, contributionCents: 0, perYear: 12, goals: [{ id: 'g1', label: 'Voiture', type: 'achat', date: '2026-12-01', targetTodayCents: 200000 }] });
  assert.deepEqual([r.goals[0].coveredCents, r.goals[0].coveragePct, r.goals[0].status], [100000, 50, 'partial']);
  assert.equal(r.rows[0].nominalCents, 0, 'achat : consomme le capital');

  const res = project({ startCents: 100000, startYear: 2026, horizonYears: 3, ratePct: 0, inflationPct: 0, contributionCents: 0, perYear: 12, goals: [
    { id: 'a', label: 'Sécurité', type: 'securite', date: '2027-01-01', targetTodayCents: 60000 },
    { id: 'b', label: 'Retraite', type: 'retraite', date: '2027-06-01', targetTodayCents: 60000 },
    { id: 'c', label: 'Lointain', type: 'autre', date: '2090-01-01', targetTodayCents: 1000 },
  ] });
  const byId = Object.fromEntries(res.goals.map((g) => [g.goalId, g]));
  assert.deepEqual([byId.a.coveredCents, byId.a.status, byId.b.coveredCents, byId.b.status, byId.c.status], [60000, 'funded', 40000, 'partial', 'outOfHorizon']);
  assert.equal(res.rows[1].nominalCents, 100000, 'réserver ne soustrait pas du stock nominal');

  // Déficit ultérieur : la réservation la plus récente est réévaluée.
  const def = project({ startCents: 100000, startYear: 2026, horizonYears: 2, ratePct: 0, inflationPct: 0, contributionCents: -5000, perYear: 12, goals: [{ id: 'r', label: 'Retraite', type: 'retraite', date: '2026-06-01', targetTodayCents: 100000 }] });
  assert.deepEqual([def.goals[0].coveredCents, def.goals[0].status, def.goals[0].revised], [0, 'unfunded', true]);
});

test('§15 stock inconnu : projection « à renseigner », jamais un faux zéro', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await makeUser(socle, { anchorDay: 1, cycleStartDate: '2026-08-01' });
  await socle.modules.bpm.updateVision(ctx, { expectedRevision: 1, annualReturnPct: 3 });
  const p = reads(socle).projection(ctx);
  assert.equal(p.status, 'unknown');
  assert.deepEqual(p.rows, []);
  const missing = reads(socle).projection({ userId: (await camille(socle)).ctx.userId });
  assert.equal(missing.status, 'missing-hypothesis');
});

test('projection BPM : stock enregistré, apport du budget type, simulation sans écriture et écart au scénario de base', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  await recurrence(socle, ctx, { direction: 'income', amount: 2000, cadence: 'monthly', firstDate: '2026-08-01' });
  await recurrence(socle, ctx, { direction: 'charge', amount: 1500, cadence: 'monthly', firstDate: '2026-08-02' });
  await socle.modules.bpm.updateVision(ctx, { expectedRevision: 1, annualReturnPct: 0, inflationPct: 0, horizonYears: 2 });
  await socle.modules.bpm.createGoal(ctx, { requestKey: key('g'), label: 'Études', type: 'etudes', date: '2027-09-01', targetToday: 5000 });
  const rev = socle.state.revision;
  const p = reads(socle).projection(ctx);
  assert.deepEqual([p.hypotheses.startCents, p.hypotheses.contributionCents, p.hypotheses.contributionSource], [1200000, 50000, 'Moyenne mensuelle du budget type']);
  assert.equal(p.rows[1].nominalCents, 1200000 + 600000 - 500000);
  assert.equal(p.goals[0].status, 'funded');
  const sim = reads(socle).projection(ctx, { extra: '100' });
  assert.deepEqual(sim.difference.map((d) => d.nominalCents), [0, 120000, 240000]);
  assert.equal(socle.state.revision, rev, 'aucune écriture par la projection ni la simulation');
  assert.equal(Object.keys(socle.state.budgets).length, 1, 'un objectif ne crée ni Budget ni tâche');
});

test('aperçu d’une saisie : avant/après du solde attendu et du stock estimé, sans mutation', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  await operation(socle, ctx, { direction: 'income', amount: 1000, date: '2026-11-01' });
  const rev = socle.state.revision;
  const p = reads(socle).previewEntry(ctx, { direction: 'charge', amount: 50, cadence: 'weekly', firstDate: '2026-11-02', costCenterRef: 'std:divers' });
  assert.deepEqual([p.before.expectedCents, p.after.expectedCents, p.before.stockEstimateCents, p.after.stockEstimateCents, p.mutation], [100000, 75000, 1300000, 1275000, false]);
  await rejects(async () => reads(socle).previewEntry(ctx, { direction: 'charge', amount: 50, date: '2026-02-30' }), 'VALIDATION');
  assert.equal(socle.state.revision, rev);
});

test('aperçu d’une saisie : même effet que l’écriture, y compris dans un projet sans enveloppe (ARCH-01)', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  await operation(socle, ctx, { direction: 'income', amount: 1000, date: '2026-11-01' });
  const unfunded = await socle.modules.bpm.projects.createProject(ctx, { requestKey: key(), title: 'Plus tard', amount: null });
  const entries = [
    { direction: 'charge', label: 'Courses', amount: 80, date: '2026-11-10', costCenterRef: 'std:divers' },
    { direction: 'charge', label: 'Loyer', amount: 50, cadence: 'weekly', firstDate: '2026-11-02', costCenterRef: 'std:divers' },
    { direction: 'charge', label: 'Matériaux', amount: 100, date: '2026-11-12', budgetId: unfunded.budgetId, costCenterRef: 'std:divers' },
  ];
  for (const entry of entries) {
    const rev = socle.state.revision;
    const p = reads(socle).previewEntry(ctx, entry);
    assert.equal(socle.state.revision, rev, 'aperçu sans écriture');
    await socle.modules.budget.createEntry(ctx, { requestKey: key(), ...entry });
    const f = reads(socle).summary(ctx).figures;
    assert.deepEqual([p.after.expectedCents, p.after.netCents], [f['bpm.soldeAttendu'].valueCents, f['bpm.resultatPeriode'].valueCents], entry.label);
  }
});

test('directives : « non calculable » avec raison, puis épargne et disponible avec hypothèses', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  await operation(socle, ctx, { direction: 'income', amount: 1000, date: '2026-11-01' });
  let d = reads(socle).directives(ctx);
  const item = (k) => d.items.find((i) => i.key === k);
  assert.deepEqual([item('savings').computable, item('available').computable], [false, false]);
  assert.match(item('savings').reason, /objectif/);
  await socle.modules.bpm.updateVision(ctx, { expectedRevision: 1, surplus: { target: 1200, periods: 12, startKey: '2026-11' } });
  d = reads(socle).directives(ctx);
  assert.deepEqual([item('savings').valueCents, item('available').valueCents], [10000, 90000]);
  assert.ok(item('weekly').valueCents > 0);
});

// ---------- Partir de zéro ----------

test('Partir de zéro (principal) : configuration en une commande rejouable, budget type mis à jour sans recréation', async () => {
  const { socle } = await makeSocle();
  const { ctx, bundle } = await makeUser(socle, { label: 'Nouveau' });
  const bpm = socle.modules.bpm;
  const requestKey = key('setup');
  const input = {
    requestKey,
    mode: 'principal',
    project: { name: 'Notre projet de vie', description: 'Vivre sereinement' },
    customCenters: [{ tempRef: 'velo', label: 'Vélo', direction: 'charge' }],
    entries: [
      { direction: 'income', label: 'Salaire', amount: 2500, cadence: 'monthly', firstDate: '2026-11-01', costCenterRef: 'std:salaires' },
      { direction: 'charge', label: 'Entretien vélo', amount: 30, cadence: 'monthly', firstDate: '2026-11-15', costCenterRef: 'new:velo' },
    ],
    caps: { 'new:velo': 50 },
    patrimoine: { openingStock: 5000, objective: 20000 },
    cycle: { anchorDay: 1, startDate: '2026-11-01' },
    vision: { annualReturnPct: 3 },
    goals: [{ label: 'Voyage', type: 'achat', date: '2028-07-01', targetToday: 3000 }],
  };
  const r = await bpm.setupProject(ctx, input);
  assert.equal(r.replayed, false);
  const replay = await bpm.setupProject(ctx, input);
  assert.equal(replay.replayed, true, 'double clic / réponse perdue : aucun doublon');
  const st = socle.state;
  assert.equal(Object.keys(st.budgets).length, 1, 'pas de deuxième projet de vie');
  assert.equal(Object.keys(st.patrimoines).length, 1);
  assert.equal(Object.keys(st.recurrences).length, 2);
  assert.equal(st.coreProjects[bundle.coreProjectId].title, 'Notre projet de vie');
  assert.equal(st.patrimoines[bundle.patrimoineId].openingStockCents, 500000);
  const velo = Object.values(st.costCenters)[0];
  assert.equal(st.budgets[bundle.budgetId].capsCents[velo.id], 5000);
  assert.equal(bpm.reads.budgetType(ctx).averageNetCents, 247000);

  const salaire = Object.values(st.recurrences).find((x) => x.label === 'Salaire');
  await bpm.setupProject(ctx, { requestKey: key('setup'), mode: 'principal', entries: [{ recurrenceId: salaire.id, amount: 2600 }] });
  assert.equal(Object.keys(socle.state.recurrences).length, 2, 'mise à jour sans recréation');
  assert.equal(socle.state.recurrences[salaire.id].amountCents, 260000);
});

test('Partir de zéro : une révision périmée du formulaire refuse toute la commande (ARCH-03)', async () => {
  const { socle } = await makeSocle();
  const { ctx, bundle } = await makeUser(socle, { label: 'Nouveau' });
  const { patrimoineId } = bundle;
  const seen = socle.state.patrimoines[patrimoineId].revision;
  await socle.modules.bpm.setupProject(ctx, { requestKey: key('setup'), mode: 'principal', patrimoine: { openingStock: 5000 }, expectedRevisions: { [patrimoineId]: seen } });
  const rev = socle.state.revision;
  await rejects(socle.modules.bpm.setupProject(ctx, { requestKey: key('setup'), mode: 'principal', patrimoine: { openingStock: 9000 }, expectedRevisions: { [patrimoineId]: seen } }), 'STALE_VERSION');
  assert.equal(socle.state.revision, rev, 'aucune écriture partielle');
});

test('Partir de zéro (branche) : Budget standard, racine propre, ≥ 1 tâche, aucun Patrimoine ; tout ou rien', async () => {
  const { socle } = await makeSocle();
  const { ctx, bundle } = await camille(socle);
  const bpm = socle.modules.bpm;
  await rejects(bpm.setupProject(ctx, { requestKey: key('b'), mode: 'branch', project: { name: 'Cuisine' }, tasks: [] }), 'VALIDATION');
  const before = Object.keys(socle.state.coreProjects).length;
  await rejects(bpm.setupProject(ctx, { requestKey: key('b'), mode: 'branch', project: { name: 'Cuisine' }, tasks: [{ title: 'Devis' }], entries: [{ direction: 'charge', label: 'Acompte', amount: 500, date: '2026-02-30', costCenterRef: 'std:logement' }] }), 'VALIDATION');
  assert.equal(Object.keys(socle.state.coreProjects).length, before, 'rien de publié');
  const r = await bpm.setupProject(ctx, { requestKey: key('b'), mode: 'branch', project: { name: 'Cuisine', description: 'Rénover' }, tasks: [{ title: 'Devis' }], entries: [{ direction: 'charge', label: 'Acompte', amount: 500, date: '2026-11-20', costCenterRef: 'std:logement' }] });
  const b = socle.state.budgets[r.budgetId];
  assert.deepEqual([b.role, b.parentBudgetId, Object.keys(socle.state.patrimoines).length], ['standard', bundle.budgetId, 1]);
  assert.equal(socle.state.tasks[r.taskIds[0]].projectId, r.coreProjectId);
  const imp = bpm.reads.impact(ctx);
  assert.deepEqual(imp.rows.map((x) => [x.role, x.toPayCents]), [['life', 0], ['standard', 50000]]);
  assert.equal(imp.consolidated.status, 'not-defined');
});

test('lectures sans effet : synthèse, registre, centres, historique, échéances, export ne modifient pas la révision', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  await recurrence(socle, ctx, { direction: 'charge', amount: 10, cadence: 'weekly', firstDate: '2026-10-01' });
  const rev = socle.state.revision;
  const r = reads(socle);
  r.summary(ctx);
  r.register(ctx, {});
  r.register(ctx, { from: '2026-01-01', to: '2026-12-31', groupBy: 'date' });
  r.centers(ctx);
  r.history(ctx, {});
  r.due(ctx);
  r.events(ctx);
  r.budgetType(ctx);
  socle.inspector.exportArchive(socle.state);
  assert.equal(socle.state.revision, rev);
});

test('compléments de contrat : erreurs d’assistant sur entries[i], profil (libellé, cycle figé), totaux signés, objectif, index d’historique', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const bpm = socle.modules.bpm;
  const err = await rejects(bpm.setupProject(ctx, { requestKey: key('b'), mode: 'branch', project: { name: 'Cuisine' }, tasks: [{ title: 'Devis' }], entries: [{ direction: 'charge', label: 'Ok', amount: 10, date: '2026-11-20', costCenterRef: 'std:logement' }, { direction: 'charge', label: 'Acompte', amount: 500, date: '2026-02-30', costCenterRef: 'std:logement' }] }), 'VALIDATION');
  assert.match(err.details.field, /^entries\[1\]\./);
  assert.equal(err.details.entryIndex, 1);

  const profile = bpm.setupProfile(ctx);
  assert.equal(typeof profile.user.userTypeLabel, 'string');
  assert.deepEqual(profile.cycleState, { closedPeriods: 0, frozen: false });

  await operation(socle, ctx, { direction: 'income', label: 'Prime', amount: 300, date: '2026-11-02' });
  await operation(socle, ctx, { direction: 'charge', label: 'Courses', amount: 120, date: '2026-11-03' });
  const reg = bpm.reads.register(ctx, {});
  assert.equal(reg.totals.byDirection.income.settledCents, 30000);
  assert.equal(reg.totals.byDirection.charge.settledCents, 12000);
  assert.equal(reg.totals.netSettledCents, 18000);

  const bal = bpm.reads.balance(ctx, {});
  assert.ok('objectiveCents' in bal.patrimoine);
  const hist = bpm.reads.history(ctx, {});
  assert.ok(hist.rows.every((r) => Number.isInteger(r.index)));
});
