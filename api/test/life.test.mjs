// Gestion du projet de vie : lecture de pilotage du projet unique du user (cycle, charges indispensables et
// courantes, projets financés, résultats des cycles et objectif d'excédent, patrimoine), nature des charges
// dans le registre et paramètre administrable des centres « indispensables ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { camille, key, makeSocle, makeUser, operation, rejects, TODAY } from './helpers.mjs';
import { DEFAULT_ESSENTIALS } from '../src/modules/bpm/natures.mjs';

const life = (socle, ctx, periodKey) => socle.modules.bpm.life.lifeManagement(ctx, { periodKey });
const value = (socle, ctx, k, periodKey) => socle.modules.bpm.figure(ctx, k, { periodKey }).value;
const centsOf = (socle, ctx, k) => Math.round(value(socle, ctx, k) * 100);
const close = (socle, ctx, periodKey) => socle.modules.bpm.closePeriod(ctx, { requestKey: key('clo'), periodKey });

/** Projet de la vie financé par le budget de vie, avec une charge réglée validée (comptée dans le Dépensé). */
async function fundedProjectWithCharge(socle, ctx, { amount = 1000, spent = 200 } = {}) {
  const core = socle.modules.core;
  const P = socle.modules.bpm.projects;
  const p = await core.createCoreProject(ctx, { requestKey: key('prj'), title: 'Voyage au Japon' });
  const adopted = await P.adoptProject(ctx, { requestKey: key('adopt'), coreProjectId: p.project.id });
  await P.allocate(ctx, adopted.budgetId, { amount, expectedRevision: adopted.detail.budget.revision });
  await socle.modules.budget.createOperation(ctx, { requestKey: key('op'), budgetId: adopted.budgetId, direction: 'charge', label: 'Vols', costCenterRef: 'std:loisirs', status: 'realized', date: TODAY, amount: spent });
  return adopted.budgetId;
}

/** Camille : août +1 700 et septembre −200 clôturés, octobre terminé non clos, novembre en cours. */
async function scenario(socle) {
  const { ctx, bundle } = await camille(socle);
  await operation(socle, ctx, { direction: 'income', amount: 2000, date: '2026-08-10' });
  await operation(socle, ctx, { direction: 'charge', amount: 300, date: '2026-08-12', costCenterRef: 'std:logement' });
  await close(socle, ctx, '2026-08');
  await operation(socle, ctx, { direction: 'income', amount: 1000, date: '2026-09-05' });
  await operation(socle, ctx, { direction: 'charge', amount: 1200, date: '2026-09-10', costCenterRef: 'std:loisirs' });
  await close(socle, ctx, '2026-09');
  // Novembre : salaire reçu, loyer et loisirs payés, santé en retard, courses et divers à venir, une entrée attendue.
  await operation(socle, ctx, { direction: 'income', amount: 2500, date: '2026-11-01' });
  await operation(socle, ctx, { direction: 'charge', amount: 800, date: '2026-11-02', costCenterRef: 'std:logement', label: 'Loyer' });
  await operation(socle, ctx, { direction: 'charge', amount: 150, date: '2026-11-02', costCenterRef: 'std:loisirs', label: 'Cinéma' });
  await operation(socle, ctx, { direction: 'charge', amount: 60, date: '2026-11-01', costCenterRef: 'std:sante', label: 'Mutuelle', status: 'planned' });
  await operation(socle, ctx, { direction: 'charge', amount: 300, date: '2026-11-20', costCenterRef: 'std:alimentation', label: 'Courses', status: 'planned' });
  await operation(socle, ctx, { direction: 'charge', amount: 50, date: '2026-11-25', costCenterRef: 'std:divers', label: 'Cadeau', status: 'planned' });
  await operation(socle, ctx, { direction: 'income', amount: 400, date: '2026-11-28', status: 'planned', label: 'Prime' });
  const projectBudgetId = await fundedProjectWithCharge(socle, ctx);
  return { ctx, bundle, projectBudgetId };
}

test('projet de vie : six volets cohérents avec les chiffres de la période (Dépensé, À payer, solde prévu)', async () => {
  const { socle } = await makeSocle();
  const { ctx, bundle } = await scenario(socle);
  const m = life(socle, ctx);

  assert.equal(m.lifeProject.coreProjectId, bundle.coreProjectId);
  assert.deepEqual(m.pilot.volets.map((v) => v.key), ['cycle', 'indispensable', 'courante', 'projets', 'resultats', 'patrimoine']);
  assert.equal(Object.values(m.pilot.counts).reduce((a, n) => a + n, 0), 6);

  // Cycle : mêmes chiffres que les métriques administrées.
  const fl = m.cycle.flows;
  assert.deepEqual([m.cycle.status, m.cycle.period.key, m.cycle.days.total, m.cycle.days.elapsed], ['active', '2026-11', 30, 3]);
  assert.deepEqual([fl.receivedCents, fl.paidCents, fl.toPayCents, fl.toReceiveCents], [250000, 115000, 41000, 40000]);
  assert.equal(fl.paidCents, centsOf(socle, ctx, 'bpm.charges'));
  assert.equal(fl.expectedCents, centsOf(socle, ctx, 'bpm.soldeAttendu'));
  assert.equal(fl.projectsPaidCents, 20000);
  // La charge du projet (réglée, hors budget initial) fait passer le solde prévu sous le budget initial.
  assert.deepEqual([fl.gapToInitialCents, m.cycle.health], [-20000, 'watch']);

  // Natures : Σ dépensé indispensables + courantes + projets = Dépensé ; Σ à payer = À payer.
  const { indispensable: ind, courante: cou } = m.natures;
  assert.deepEqual([ind.paidCents, cou.paidCents], [80000, 15000]);
  assert.equal(ind.paidCents + cou.paidCents + fl.projectsPaidCents, fl.paidCents);
  assert.deepEqual([ind.toPayCents, cou.toPayCents], [36000, 5000]);
  assert.equal(ind.toPayCents + cou.toPayCents, centsOf(socle, ctx, 'bpm.resteAPayer'));
  assert.deepEqual([ind.lateCount, ind.lateCents, ind.health], [1, 6000, 'alert'], 'une charge indispensable en retard est à traiter');
  assert.equal(ind.next.label, 'Courses');
  assert.ok(ind.rows.some((r) => r.ref === 'std:logement' && r.paidCents === 80000));
  assert.ok(cou.rows.every((r) => !DEFAULT_ESSENTIALS.includes(r.ref)));
  assert.equal(cou.health, 'ok');
  assert.deepEqual(m.essentials.refs, DEFAULT_ESSENTIALS);

  // Projets financés : décisions, facturation, réglé validé de la période.
  assert.deepEqual([m.projects.projectCount, m.projects.fundedCount, m.projects.periodPaidCents, m.projects.health], [1, 1, 20000, 'ok']);

  // Résultats : deux cycles clôturés (+1 700, −200), octobre terminé à clôturer d'abord.
  const r = m.results;
  assert.deepEqual([r.count, r.positiveCount, r.negativeCount, r.totalCents, r.averageCents], [2, 1, 1, 150000, 75000]);
  assert.deepEqual([r.best.periodKey, r.worst.periodKey, r.last.periodKey], ['2026-08', '2026-09', '2026-09']);
  assert.deepEqual([r.toCloseCount, r.firstOpen.key, r.closing.possible, r.health], [1, '2026-10', true, 'alert']);
  assert.equal(r.closing.preview.resultCents, 0);

  // Patrimoine : stock d'ouverture 12 000 + résultats capitalisés 1 500 ; effet signé de la période.
  const p = m.patrimoine;
  assert.deepEqual([p.stockCents, p.capitalizedCents, p.capitalizationCount, p.objectiveCents], [1350000, 150000, 2, 5000000]);
  assert.equal(p.effectCents, fl.netCents);
  assert.equal(p.afterCents, p.stockCents + p.effectCents);
  assert.equal(p.expectedAfterCents, p.stockCents + fl.expectedCents);
  assert.match(p.surplusUseNote, /module à venir/);

  // Échéances : la mutuelle en retard, puis les échéances des 7 prochains jours.
  assert.deepEqual(m.dueSoon.lines.map((l) => [l.label, l.status, l.nature]), [['Mutuelle', 'late', 'indispensable']]);

  // Aucune écriture.
  const revision = socle.state.revision;
  life(socle, ctx);
  assert.equal(socle.state.revision, revision);
});

test('navigation de période : les mêmes volets pour la période choisie, les commandes du jour inchangées', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await scenario(socle);
  const now = life(socle, ctx);
  assert.deepEqual(now.context.periods, { firstKey: '2026-08', currentKey: '2026-11' });
  assert.deepEqual([now.cycle.reading, now.cycle.label], ['current', 'Cycle en cours']);

  // Septembre, clôturé à −200 : chiffres de la période, résultat clos, plus de disponible à dépenser.
  const sep = life(socle, ctx, '2026-09');
  assert.deepEqual([sep.context.period.key, sep.cycle.period.key, sep.cycle.reading, sep.cycle.label], ['2026-09', '2026-09', 'closed', 'Cycle clôturé']);
  assert.deepEqual([sep.cycle.flows.receivedCents, sep.cycle.flows.paidCents, sep.cycle.closedResultCents], [100000, 120000, -20000]);
  assert.equal(sep.cycle.flows.paidCents, Math.round(value(socle, ctx, 'bpm.charges', '2026-09') * 100));
  assert.deepEqual([sep.cycle.health, sep.cycle.days.left, sep.cycle.days.elapsedPct], ['watch', 0, 100]);
  assert.deepEqual([sep.natures.courante.paidCents, sep.natures.indispensable.paidCents, sep.natures.indispensable.lateCount], [120000, 0, 0]);
  assert.deepEqual([sep.natures.courante.availableCents, sep.natures.courante.weeklyCents], [null, null]);
  assert.match(sep.natures.courante.availableReason, /cycle en cours/);
  assert.equal(sep.patrimoine.effectCents, -20000);
  // Les commandes du jour ne dépendent pas de la période lue.
  assert.deepEqual([sep.results.toCloseCount, sep.dueSoon.lines.length, sep.results.count], [now.results.toCloseCount, now.dueSoon.lines.length, 2]);

  // Octobre, terminé mais non clos : à clôturer ; la mutuelle de novembre en retard n'y est pas comptée.
  const oct = life(socle, ctx, '2026-10');
  assert.deepEqual([oct.cycle.reading, oct.cycle.label, oct.cycle.health], ['ended', 'Cycle terminé', 'watch']);
  assert.equal(oct.natures.indispensable.lateCount, 0);
  assert.equal(now.natures.indispensable.lateCount, 1);

  // Hors du cycle : avant la première période ou après la période courante.
  await rejects(() => life(socle, ctx, '2026-07'), 'NOT_FOUND');
  await rejects(() => life(socle, ctx, '2026-12'), 'NOT_FOUND');
});

test('objectif d’excédent : cumul des clôtures, retard ou avance à date, effort restant par période', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await scenario(socle);
  await socle.modules.bpm.updateVision(ctx, { expectedRevision: 1, surplus: { target: 1200, periods: 12, startKey: '2026-08' } });
  const r = life(socle, ctx).results;
  assert.deepEqual([r.surplus.perPeriodCents, r.surplus.cumulatedCents, r.surplus.closedPeriods, r.surplus.endKey], [10000, 150000, 2, '2027-07']);
  assert.deepEqual([r.surplus.targetToDateCents, r.surplus.gapCents, r.surplus.onTrack, r.surplus.reached], [20000, 130000, true, true]);
  assert.deepEqual(r.rows.map((x) => [x.periodKey, x.meetsTarget]), [['2026-09', false], ['2026-08', true]]);
  assert.equal(r.metCount, 1);
  assert.equal(r.current.targetCents, 10000);

  // Une fois octobre clôturé, le volet ne demande plus de clôture.
  await close(socle, ctx, '2026-10');
  const after = life(socle, ctx).results;
  assert.deepEqual([after.toCloseCount, after.closing, after.count], [0, null, 3]);
  assert.notEqual(after.health, 'alert');
});

test('nature des charges : registre filtré et regroupé par nature, paramètre administrable des indispensables', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await scenario(socle);
  const reads = socle.modules.bpm.reads;

  const reg = reads.register(ctx, { groupBy: 'nature' });
  assert.deepEqual(reg.groups.map((g) => g.key), ['entrees', 'indispensable', 'courante', 'projet']);
  assert.ok(reg.lines.every((l) => (l.direction === 'income' ? l.nature === null : ['indispensable', 'courante', 'projet'].includes(l.nature))));
  const ind = reads.register(ctx, { nature: 'indispensable' });
  assert.deepEqual(ind.lines.map((l) => l.label).sort(), ['Courses', 'Loyer', 'Mutuelle']);
  assert.equal(ind.filters.nature, 'indispensable');
  const proj = reads.register(ctx, { nature: 'projet' });
  assert.ok(proj.lines.length >= 2 && proj.lines.every((l) => l.projectCharge || l.special), 'charges validées et charges spéciales des projets');
  assert.throws(() => reads.register(ctx, { nature: 'luxe' }), (e) => e.code === 'VALIDATION');

  // Les loisirs deviennent indispensables : la lecture suit le paramètre, sans autre changement.
  const admin = socle.modules.administration;
  await rejects(admin.setParameter('bpm.chargesIndispensables', { value: ['std:salaires'], expectedRevision: 0 }), 'VALIDATION');
  await rejects(admin.setParameter('bpm.chargesIndispensables', { value: ['std:inconnu'], expectedRevision: 0 }), 'VALIDATION');
  await admin.setParameter('bpm.chargesIndispensables', { value: [...DEFAULT_ESSENTIALS, 'std:loisirs'], expectedRevision: 0 });
  const m = life(socle, ctx);
  assert.deepEqual([m.natures.indispensable.paidCents, m.natures.courante.paidCents], [95000, 0]);
  assert.ok(m.essentials.labels.includes('Loisirs'));
  assert.equal(reads.register(ctx, { nature: 'courante' }).lines.map((l) => l.label).join(), 'Cadeau');
});

test('cycle à configurer : la page se lit sans période, chaque volet dit ce qui manque', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await makeUser(socle, { label: 'Nouveau' });
  const m = life(socle, ctx);
  assert.deepEqual([m.cycle.status, m.cycle.period, m.cycle.flows, m.cycle.health], ['to_configure', null, null, 'unknown']);
  assert.deepEqual([m.natures.indispensable.health, m.natures.courante.health], ['unknown', 'unknown']);
  assert.deepEqual([m.results.count, m.results.toCloseCount, m.results.closing, m.results.health], [0, 0, null, 'unknown']);
  assert.equal(m.patrimoine.health, 'unknown');
  assert.deepEqual(m.dueSoon.lines, []);
});

test('budget de vie : même interface que le budget d’un projet standard, variante non standard', async () => {
  const { socle } = await makeSocle();
  const { ctx, bundle, projectBudgetId } = await scenario(socle);
  const P = socle.modules.bpm.projects;
  const d = P.projectDetail(ctx, bundle.coreProjectId);
  const fig = d.budget;

  // Paramètre différenciant et mêmes champs que la variante standard.
  const standard = P.projectDetail(ctx, socle.state.budgets[projectBudgetId].coreProjectId).budget;
  assert.deepEqual([d.role, fig.kind, fig.nonStandard, standard.kind, standard.nonStandard, standard.life], ['life', 'life', true, 'standard', false, null]);
  assert.deepEqual(Object.keys(fig).filter((k) => k !== 'life').sort(), Object.keys(standard).filter((k) => k !== 'life').sort());

  // Ressources du cycle en cours = métriques administrées ; ventilation = enveloppes des projets fils.
  assert.equal(fig.allocationCents, centsOf(socle, ctx, 'bpm.revenusPrevus'));
  assert.equal(fig.availableCents, centsOf(socle, ctx, 'bpm.resultatPrevu'));
  assert.equal(fig.paidCents, centsOf(socle, ctx, 'bpm.charges'));
  assert.equal(fig.toPayCents, centsOf(socle, ctx, 'bpm.resteAPayer'));
  assert.equal(fig.life.projectsPaidCents, 20000);
  assert.equal(fig.unsharedChargesCents, fig.paidCents - 20000);
  assert.deepEqual(fig.shares, { [projectBudgetId]: 100000 });
  assert.equal(fig.sharesCents, 100000);
  assert.deepEqual([fig.life.unique, fig.life.patrimoineId, fig.life.period.key, fig.life.childCount, fig.life.fundedCount], [true, bundle.patrimoineId ?? fig.life.patrimoineId, '2026-11', 1, 1]);
  assert.equal(fig.life.children[0].budgetId, projectBudgetId);

  // Financement par cycle : enveloppe attribuée en novembre, 200 € remontés sur novembre.
  const row = fig.life.funding.rows[0];
  assert.deepEqual(fig.life.funding.periods.map((p) => p.key), ['2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual([row.allocationPeriodKey, row.allocationCents, row.byPeriod['2026-11'], row.byPeriod['2026-10']], ['2026-11', 100000, 20000, 0]);
  assert.equal(fig.life.funding.totals.byPeriod['2026-11'], 20000);

  // Contrôles et tableau des projets : mêmes chiffres.
  assert.ok(d.checks.some((c) => c.code === 'cycle' && c.level === 'warning'));
  assert.equal(P.overview(ctx).lifeProject.budget.kind, 'life');

  // Les commandes d'un projet standard refusent explicitement le budget de vie.
  const err = await rejects(P.allocate(ctx, fig.budgetId, { amount: 10, expectedRevision: fig.revision }), 'FORBIDDEN_BY_RULE');
  assert.match(err.message, /non standard/);
});
