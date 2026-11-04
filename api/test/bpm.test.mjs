// Application BPM (niveau 3) : composition initiale, cycle et périodes, chiffres par période,
// clôtures et capitalisation, garde des périodes closes, tableau de bord administrable, centres de coût.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at, camille, key, makeSocle, makeUser, operation, rejects } from './helpers.mjs';

const close = (socle, ctx, periodKey, requestKey = key('clo')) => socle.modules.bpm.closePeriod(ctx, { requestKey, periodKey });
const figure = (socle, ctx, k, periodKey) => socle.modules.bpm.figure(ctx, k, { periodKey });

// ---------- composition initiale ----------

test('createUser : user, projet noyau, Budget « Projet de vie », Patrimoine, composition BPM et cycle en une écriture', async () => {
  const { socle } = await makeSocle();
  const rev0 = socle.state.revision;
  const { bundle } = await camille(socle);
  assert.equal(socle.state.revision, rev0 + 1, 'une seule écriture');
  const st = socle.state;
  const ids = [bundle.userId, bundle.coreProjectId, bundle.budgetId, bundle.patrimoineId, bundle.bpmCompositionId, bundle.cycleLinkId];
  const entry = st.journal.at(-1);
  assert.equal(entry.command, 'createUser');
  assert.equal(entry.userId, bundle.userId);
  assert.deepEqual(entry.created, ids);
  assert.deepEqual(st.creationRequests[entry.requestKey].createdObjects.map((c) => c.id), ids);
  for (const id of ids) assert.equal(socle.om.find(st, id).userId, bundle.userId);

  const comp = st.bpmCompositions[bundle.bpmCompositionId];
  assert.deepEqual([comp.budgetId, comp.patrimoineId, comp.coreProjectId], [bundle.budgetId, bundle.patrimoineId, bundle.coreProjectId]);
  assert.equal(st.budgets[bundle.budgetId].coreProjectId, bundle.coreProjectId);
  assert.equal(st.patrimoines[bundle.patrimoineId].coreProjectId, bundle.coreProjectId, 'racine noyau partagée');
  assert.equal(st.patrimoines[bundle.patrimoineId].principalBudgetId, bundle.budgetId);
  assert.equal(st.patrimoines[bundle.patrimoineId].openingStockCents, 1200000);
  assert.equal(st.patrimoines[bundle.patrimoineId].objectiveCents, 5000000);
  const cycle = st.cycleLinks[bundle.cycleLinkId];
  assert.deepEqual([cycle.state, cycle.anchorDay, cycle.startDate, cycle.frequency], ['active', 1, '2026-08-01', 'monthly']);
  const u = socle.modules.users.listUsers()[0];
  assert.deepEqual([u.userTypeLabel, u.bpmCompositionId, u.principalBudgetId, u.cycleState], ['Individuel', bundle.bpmCompositionId, bundle.budgetId, 'active']);
});

test('stock d’ouverture inconnu : chiffres du Patrimoine inconnus avec leur raison, jamais 0', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await makeUser(socle, { label: 'Durand', userType: 'famille', objective: 80000, anchorDay: 1, cycleStartDate: '2026-10-01' });
  const d = socle.modules.bpm.dashboard(ctx);
  assert.equal(d.patrimoine.openingStock, null);
  assert.equal(d.patrimoine.objective, 80000);
  for (const k of ['bpm.patrimoineConstitue', 'bpm.patrimoineFinPeriode', 'bpm.progressionObjectif', 'bpm.resteObjectif']) {
    assert.equal(d.figures[k].value, null, k);
    assert.equal(d.figures[k].status, 'unavailable', k);
    assert.match(d.figures[k].unavailableReason, /Stock d'ouverture non renseigné/, k);
  }
  const stock = d.figures['bpm.patrimoineConstitue'].inputs.find((i) => i.name === 'patrimoine.stockOuverture');
  assert.equal(stock.value, null);
  assert.equal(stock.sources[0].id, d.composition.patrimoineId);
  // Renseigner le stock rend le chiffre connu.
  await socle.modules.patrimoine.updatePatrimoine(ctx, d.composition.patrimoineId, { expectedRevision: d.patrimoine.revision, openingStock: -200 });
  assert.equal(socle.modules.bpm.dashboard(ctx).figures['bpm.patrimoineConstitue'].value, -200);
});

test('cycle à configurer : chiffres de période inconnus, puis configuration du cycle', async () => {
  const { socle } = await makeSocle();
  const { ctx, bundle } = await makeUser(socle, { label: 'Durand', userType: 'famille', openingStock: 500 });
  const d = socle.modules.bpm.dashboard(ctx);
  assert.equal(d.cycle.state, 'to_configure');
  assert.deepEqual(d.cycle.periods, []);
  assert.equal(d.period, null);
  assert.deepEqual(d.operations, []);
  assert.deepEqual(d.closing, { possible: false, reason: 'Cycle à configurer', preview: null });
  for (const k of ['bpm.revenus', 'bpm.charges', 'bpm.resultatPeriode', 'bpm.revenusPrevus', 'bpm.resultatPrevu']) {
    assert.equal(d.figures[k].value, null, k);
    assert.match(d.figures[k].unavailableReason, /cycle à configurer/i, k);
  }
  assert.equal(d.figures['bpm.patrimoineConstitue'].value, 500, 'le Patrimoine connu reste calculé');
  await rejects(close(socle, ctx, '2026-10'), 'FORBIDDEN_BY_RULE');

  await rejects(socle.modules.bpm.configureCycle(ctx, { anchorDay: 5, expectedRevision: 9 }), 'STALE_VERSION');
  await rejects(socle.modules.bpm.configureCycle(ctx, { anchorDay: 29, expectedRevision: 1 }), 'VALIDATION');
  const after = await socle.modules.bpm.configureCycle(ctx, { anchorDay: 5, startDate: '2026-09-10', expectedRevision: 1 });
  assert.equal(after.cycle.state, 'active');
  assert.equal(socle.state.cycleLinks[bundle.cycleLinkId].revision, 2);
  assert.deepEqual(after.cycle.periods.map((p) => p.key), ['2026-10', '2026-09']);
  assert.deepEqual([after.period.key, after.period.start, after.period.end, after.period.status], ['2026-10', '2026-10-05', '2026-11-04', 'current']);
  assert.equal(after.figures['bpm.revenus'].value, 0);
});

// ---------- chiffres par période ----------

test('opérations réalisées et prévues par période : bornes incluses, jour d’ancrage 5', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await makeUser(socle, { openingStock: 1000, anchorDay: 5, cycleStartDate: '2026-09-05' });
  const op = (x) => operation(socle, ctx, x);
  const debut = await op({ direction: 'income', label: 'Début de période', amount: 1000, date: '2026-10-05' });
  // Dernier jour de la période, réalisé ce jour-là (une réalisation future est refusée, C03).
  const fin = await at('2026-11-04', () => op({ direction: 'charge', label: 'Fin de période', amount: 200, date: '2026-11-04' }));
  const veille = await op({ direction: 'charge', label: 'Veille', amount: 50, date: '2026-10-04' });
  await op({ direction: 'income', label: 'Prime prévue', amount: 500, date: '2026-10-20', status: 'planned' });
  await op({ direction: 'charge', label: 'Facture prévue', amount: 300, date: '2026-10-25', status: 'planned' });
  // Prévue en 2026-09, réalisée en 2026-10 avec un autre montant.
  const decalee = await op({ direction: 'charge', label: 'Décalée', amount: 100, date: '2026-10-04', status: 'planned' });
  const realized = await socle.modules.budget.realizeOperation(ctx, decalee.operation.id, { expectedRevision: 1, realizedAmount: 120, realizedDate: '2026-10-06' });
  assert.deepEqual([realized.operation.status, realized.operation.realizedAmount, realized.operation.amount], ['realized', 120, 100]);

  const d = socle.modules.bpm.dashboard(ctx);
  assert.equal(d.period.key, '2026-10');
  const f = (k) => d.figures[k].value;
  assert.equal(f('bpm.revenus'), 1000);
  assert.equal(f('bpm.charges'), 320);
  assert.equal(f('bpm.resultatPeriode'), 680);
  assert.equal(f('bpm.revenusPrevus'), 1500);
  assert.equal(f('bpm.chargesPrevues'), 500);
  assert.equal(f('bpm.resultatPrevu'), 1000);
  // C04 : solde attendu = net réalisé + reste à recevoir − reste à payer ; l'écart se mesure au budget initial.
  assert.equal(f('bpm.resteARecevoir'), 500);
  assert.equal(f('bpm.resteAPayer'), 300);
  assert.equal(f('bpm.soldeAttendu'), 880);
  assert.equal(f('bpm.ecartResultat'), -120);
  assert.equal(f('bpm.tauxEpargne'), 68);
  assert.equal(f('bpm.consommationCharges'), 64);
  assert.equal(f('bpm.patrimoineConstitue'), 1000);
  assert.equal(f('bpm.patrimoineFinPeriode'), 1680);
  assert.deepEqual(d.figures['bpm.charges'].inputs[0].sources.map((s) => s.id).sort(), [fin.operation.id, decalee.operation.id].sort());
  assert.deepEqual(d.figures['bpm.revenus'].inputs[0].sources.map((s) => s.id), [debut.operation.id]);
  assert.ok(d.operations.every((o) => (o.realizedDate ?? o.date) >= '2026-10-05' && (o.realizedDate ?? o.date) <= '2026-11-04'));

  const sept = (k) => figure(socle, ctx, k, '2026-09');
  assert.equal(sept('bpm.revenus').value, 0);
  assert.equal(sept('bpm.charges').value, 50);
  assert.deepEqual(sept('bpm.charges').inputs[0].sources.map((s) => s.id), [veille.operation.id]);
  assert.equal(sept('bpm.chargesPrevues').value, 150);
  assert.equal(sept('bpm.tauxEpargne').value, null, 'aucun revenu : taux inconnu, pas 0');
  assert.equal(sept('bpm.resultatPeriode').period.end, '2026-10-04');
  await rejects(async () => figure(socle, ctx, 'bpm.revenus', '2026-12'), 'NOT_FOUND');
  assert.equal(socle.modules.bpm.dashboard(ctx, { periodKey: '2026-09' }).period.status, 'ended');
});

// ---------- clôtures ----------

test('clôture : périodes terminées, dans l’ordre, résultat nul ou négatif, capitalisation et formule enregistrées', async () => {
  const { socle } = await makeSocle();
  const bpm = socle.modules.bpm;
  const { ctx, bundle } = await camille(socle);
  const sal = await operation(socle, ctx, { direction: 'income', label: 'Salaire', amount: 3000, date: '2026-08-01' });
  const loyer = await operation(socle, ctx, { direction: 'charge', label: 'Loyer', amount: 1250, date: '2026-08-31', costCenterRef: 'std:logement' });
  await operation(socle, ctx, { direction: 'charge', label: 'Prévue non réalisée', amount: 99, date: '2026-08-15', status: 'planned' });
  await operation(socle, ctx, { direction: 'charge', label: 'Réparation', amount: 500, date: '2026-10-12' });

  assert.equal(bpm.dashboard(ctx).closing.possible, false);
  const august = bpm.dashboard(ctx, { periodKey: '2026-08' }).closing;
  assert.deepEqual([august.possible, august.reason, august.preview.periodKey], [true, null, '2026-08']);
  assert.equal(bpm.dashboard(ctx, { periodKey: '2026-09' }).closing.possible, false);
  await rejects(close(socle, ctx, '2026-11'), 'FORBIDDEN_BY_RULE');
  await rejects(close(socle, ctx, '2026-12'), 'NOT_FOUND');
  await rejects(close(socle, ctx, '2026-09'), 'FORBIDDEN_BY_RULE');
  assert.equal(Object.keys(socle.state.closures).length, 0);

  const requestKey = key('clo');
  const aug = await close(socle, ctx, '2026-08', requestKey);
  assert.equal(aug.replayed, false);
  const c = aug.closure;
  assert.equal(c.result, 1750);
  assert.deepEqual([c.periodKey, c.periodStart, c.periodEnd], ['2026-08', '2026-08-01', '2026-08-31']);
  assert.equal(c.calculation.metric, 'bpm.resultatPeriode');
  assert.equal(c.calculation.formula, 'bpm.revenus - bpm.charges');
  assert.equal(c.calculation.parameter.revision, 0);
  assert.deepEqual(c.sourceOperationIds.sort(), [sal.operation.id, loyer.operation.id].sort());
  const cap = socle.state.capitalizations[c.capitalizationId];
  assert.equal(cap.amountCents, 175000);
  assert.equal(cap.date, '2026-08-31');
  assert.equal(cap.patrimoineId, bundle.patrimoineId);
  assert.deepEqual(cap.source, { kind: 'closure', id: c.id });

  const replay = await close(socle, ctx, '2026-08', requestKey);
  assert.equal(replay.replayed, true);
  assert.equal(replay.closure.id, c.id);
  await rejects(close(socle, ctx, '2026-08'), 'UNIQUENESS_VIOLATION');
  assert.equal(Object.keys(socle.state.closures).length, 1);
  assert.equal(Object.keys(socle.state.capitalizations).length, 1);

  const sep = await close(socle, ctx, '2026-09');
  assert.equal(sep.closure.result, 0, 'un résultat nul clôt aussi la période');
  assert.equal(socle.state.capitalizations[sep.closure.capitalizationId].amountCents, 0);

  // Formule administrée avant la clôture d'octobre : la clôture en garde la trace.
  await socle.modules.administration.setParameter('metric.bpm.resultatPeriode', { value: 'bpm.revenus - bpm.charges + 0', expectedRevision: 0 });
  const oct = await close(socle, ctx, '2026-10');
  assert.equal(oct.closure.result, -500);
  assert.equal(oct.closure.calculation.formula, 'bpm.revenus - bpm.charges + 0');
  assert.equal(oct.closure.calculation.parameter.revision, 1);
  assert.equal(oct.closure.calculation.parameter.origin, 'administration');

  const d = bpm.dashboard(ctx);
  assert.equal(d.figures['bpm.patrimoineConstitue'].value, 12000 + 1750 + 0 - 500);
  assert.equal(d.figures['bpm.patrimoineConstitue'].inputs.find((i) => i.name === 'patrimoine.resultatsCapitalises').sources.length, 3);
  assert.deepEqual(bpm.closures(ctx).map((x) => x.periodKey), ['2026-10', '2026-09', '2026-08']);
  assert.deepEqual(d.cycle.periods.map((p) => [p.key, p.status]), [['2026-11', 'current'], ['2026-10', 'closed'], ['2026-09', 'closed'], ['2026-08', 'closed']]);
  // Le patrimoine constitué d'une période passée ne compte que les capitalisations antérieures.
  assert.equal(figure(socle, ctx, 'bpm.patrimoineConstitue', '2026-09').value, 12000 + 1750);
  const checks = socle.inspector.checks(socle.state);
  assert.equal(checks.filter((x) => x.rule === 'CLO-01').length, 3);
  assert.ok(checks.every((x) => x.result !== 'failed'));
});

test('clôture : résultat négatif, le stock du Patrimoine peut devenir négatif', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle, { openingStock: 100 });
  await operation(socle, ctx, { direction: 'charge', label: 'Dépense', amount: 400, date: '2026-08-10' });
  const r = await close(socle, ctx, '2026-08');
  assert.equal(r.closure.result, -400);
  assert.equal(socle.state.capitalizations[r.closure.capitalizationId].amountCents, -40000);
  assert.equal(figure(socle, ctx, 'bpm.patrimoineConstitue', '2026-09').value, -300);
});

test('période close : opération refusée en création, modification et réalisation ; Budget enfant autorisé', async () => {
  const { socle } = await makeSocle();
  const budget = socle.modules.budget;
  const { ctx } = await camille(socle);
  const planned = await operation(socle, ctx, { direction: 'charge', label: 'À réaliser', amount: 40, date: '2026-10-12', status: 'planned' });
  const open = await operation(socle, ctx, { direction: 'charge', label: 'Octobre', amount: 30, date: '2026-10-10' });
  const inAug = await operation(socle, ctx, { direction: 'charge', label: 'Août', amount: 20, date: '2026-08-10' });
  await close(socle, ctx, '2026-08');
  const before = socle.state.revision;

  const err = await rejects(operation(socle, ctx, { direction: 'charge', label: 'Tardive', amount: 10, date: '2026-08-15' }), 'PERIOD_CLOSED');
  assert.equal(err.details.periodKey, '2026-08');
  await rejects(operation(socle, ctx, { direction: 'charge', label: 'Réalisée en août', amount: 10, date: '2026-10-15', realizedDate: '2026-08-31' }), 'PERIOD_CLOSED');
  await rejects(budget.updateOperation(ctx, open.operation.id, { expectedRevision: 1, date: '2026-08-10' }), 'PERIOD_CLOSED');
  await rejects(budget.updateOperation(ctx, inAug.operation.id, { expectedRevision: 1, label: 'Renommée' }), 'PERIOD_CLOSED');
  await rejects(budget.realizeOperation(ctx, planned.operation.id, { expectedRevision: 1, realizedDate: '2026-08-20' }), 'PERIOD_CLOSED');
  assert.equal(socle.state.revision, before, 'aucune écriture');

  // Hors période close : autorisé.
  const moved = await budget.updateOperation(ctx, open.operation.id, { expectedRevision: 1, date: '2026-09-10' });
  assert.equal(moved.operation.date, '2026-09-10');
  await budget.realizeOperation(ctx, planned.operation.id, { expectedRevision: 1 });

  // Budget standard (projet de la vie) : la garde ne porte que sur le Budget « Projet de vie ».
  const life = await socle.modules.bpm.createLifeProject(ctx, { requestKey: key(), name: 'Voyage', tasks: [{ title: 'Billets' }] });
  const child = await budget.createOperation(ctx, { requestKey: key(), budgetId: life.budgetId, direction: 'charge', label: 'Acompte', amount: 300, date: '2026-08-15', status: 'realized', costCenterRef: 'std:loisirs' });
  assert.equal(child.operation.budgetId, life.budgetId);
  assert.equal(figure(socle, ctx, 'bpm.charges', '2026-08').value, 20, 'le Budget enfant n’entre pas dans le résultat du « Projet de vie »');
});

test('cycle figé après une clôture', async () => {
  const { socle } = await makeSocle();
  const { ctx, bundle } = await camille(socle);
  await close(socle, ctx, '2026-08');
  const rev = socle.state.cycleLinks[bundle.cycleLinkId].revision;
  await rejects(socle.modules.bpm.configureCycle(ctx, { anchorDay: 5, expectedRevision: rev }), 'FORBIDDEN_BY_RULE');
  await rejects(socle.modules.bpm.configureCycle(ctx, { anchorDay: 1, startDate: '2026-07-01', expectedRevision: rev }), 'FORBIDDEN_BY_RULE');
  const same = await socle.modules.bpm.configureCycle(ctx, { anchorDay: 1, expectedRevision: rev });
  assert.equal(same.cycle.anchorDay, 1);
});

// ---------- tableau de bord administrable ----------

test('tableau de bord : sections et chiffres suivent le paramètre bpm.tableauDeBord', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const d0 = socle.modules.bpm.dashboard(ctx);
  assert.deepEqual(d0.sections.map((s) => s.id), ['periode', 'initial', 'patrimoine']);
  assert.deepEqual(Object.keys(d0.figures).sort(), [...new Set(d0.sections.flatMap((s) => s.metrics))].sort());
  for (const f of Object.values(d0.figures)) {
    for (const field of ['key', 'label', 'unit', 'decimals', 'value', 'status', 'formula', 'parameter', 'explanation', 'inputs', 'period']) assert.ok(field in f, `${f.key}.${field}`);
  }
  const sections = [{ id: 'essentiel', title: 'Essentiel', metrics: ['bpm.patrimoineConstitue', 'bpm.resultatPeriode'] }];
  await socle.modules.administration.setParameter('bpm.tableauDeBord', { value: sections, expectedRevision: 0 });
  const d1 = socle.modules.bpm.dashboard(ctx);
  assert.deepEqual(d1.sections, sections);
  assert.deepEqual(Object.keys(d1.figures), ['bpm.patrimoineConstitue', 'bpm.resultatPeriode']);
  assert.equal(d1.figures['bpm.patrimoineConstitue'].value, 12000);
  assert.deepEqual([d1.user.label, d1.user.userType], ['Camille', 'individuel']);
});

// ---------- centres de coût ----------

test('centres de coût : standards selon le type d’utilisateur, personnalisés, sens contrôlé', async () => {
  const { socle } = await makeSocle();
  const budget = socle.modules.budget;
  const { ctx: ind } = await camille(socle);
  const { ctx: fam } = await makeUser(socle, { label: 'Durand', userType: 'famille' });
  const refs = (ctx) => budget.costCenters(ctx).map((c) => c.ref);
  assert.ok(refs(fam).includes('std:enfants') && refs(fam).includes('std:allocations'));
  assert.ok(!refs(ind).includes('std:enfants') && !refs(ind).includes('std:allocations'));
  assert.ok(refs(ind).includes('std:salaires') && refs(ind).includes('std:logement'));

  await rejects(operation(socle, ind, { direction: 'charge', amount: 10, date: '2026-11-02', costCenterRef: 'std:enfants' }), 'REFERENCE_NOT_FOUND');
  await rejects(operation(socle, ind, { direction: 'income', amount: 10, date: '2026-11-02', costCenterRef: 'std:logement' }), 'INCOMPATIBLE_REFERENCE');
  await rejects(operation(socle, ind, { direction: 'charge', amount: 10, date: '2026-11-02', costCenterRef: 'std:salaires' }), 'INCOMPATIBLE_REFERENCE');
  await operation(socle, fam, { direction: 'income', label: 'Allocations', amount: 150, date: '2026-11-02', costCenterRef: 'std:allocations' });

  const cc = await budget.addCustomCostCenter(fam, { requestKey: key(), label: 'Cantine', direction: 'charge' });
  assert.ok(cc.costCenters.some((c) => c.ref === cc.costCenterId && !c.standard));
  const op = await operation(socle, fam, { direction: 'charge', label: 'Cantine', amount: 60, date: '2026-11-03', status: 'planned', costCenterRef: cc.costCenterId });
  assert.equal(op.operation.costCenterLabel, 'Cantine');
  assert.equal(op.operation.costCenterRef, cc.costCenterId);
  await rejects(operation(socle, fam, { direction: 'income', amount: 10, date: '2026-11-02', costCenterRef: cc.costCenterId }), 'INCOMPATIBLE_REFERENCE');
  await rejects(operation(socle, ind, { direction: 'charge', amount: 10, date: '2026-11-02', costCenterRef: cc.costCenterId }), 'REFERENCE_NOT_FOUND');
  await rejects(operation(socle, ind, { direction: 'charge', amount: 0, date: '2026-11-02' }), 'VALIDATION');
  await rejects(operation(socle, ind, { direction: 'charge', amount: 1.234, date: '2026-11-02' }), 'VALIDATION');
});
