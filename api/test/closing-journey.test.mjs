// Parcours de clôture (page « Clôture du cycle ») : suivi des points pendant le cycle (ouverts, clos à l'instant),
// mode clôture à la fin du dernier jour (points figés, cycle suivant verrouillé), points non bloquants reportés vers
// le cycle choisi avec leur marque, impacts sur le cycle suivant, clôture à 100 % qui lance le cycle suivant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { at, key, makeSocle, makeUser } from './helpers.mjs';

const rejects = (promise, code) => assert.rejects(promise, (err) => {
  assert.equal(err.code, code, err.message);
  return true;
});

/** User au cycle mensuel commencé le 1er novembre 2026 (date de test : 3 novembre). */
async function setup(options) {
  const { socle } = await makeSocle(options);
  const { ctx } = await makeUser(socle, { label: 'Clôture', openingStock: 1000, anchorDay: 1, cycleStartDate: '2026-11-01' });
  const budget = socle.modules.budget;
  const rec = async (label, direction, amount, firstDate) => (await budget.createRecurrence(ctx, {
    requestKey: key('rec'), label, direction, amount, cadence: 'monthly', firstDate, costCenterRef: direction === 'income' ? 'std:salaires' : 'std:divers',
  })).recurrence;
  const salary = await rec('Salaire', 'income', 2000, '2026-11-01');
  const rent = await rec('Loyer', 'charge', 700, '2026-11-02');
  const groceries = await rec('Courses', 'charge', 300, '2026-11-20');
  const internet = await rec('Internet', 'charge', 30, '2026-11-28');
  const plumber = (await budget.createOperation(ctx, { requestKey: key('op'), status: 'planned', direction: 'charge', label: 'Plombier', amount: 120, date: '2026-11-25', costCenterRef: 'std:divers' })).operation;
  return { socle, ctx, budget, bpm: socle.modules.bpm, salary, rent, groceries, internet, plumber };
}
const settle = (t, r, occurrenceDate, realizedDate = occurrenceDate, realizedAmount) =>
  t.budget.settleOccurrence(t.ctx, r.id, { requestKey: key('settle'), occurrenceDate, realizedDate, ...(realizedAmount ? { realizedAmount } : {}) });
const decide = (t, input) => t.bpm.closingDecision(t.ctx, { periodKey: '2026-11', ...input });
const defer = (t, pointId, toPeriodKey) => decide(t, { defer: { pointId, toPeriodKey } });
const criterion = (j, k) => j.criteria.find((c) => c.key === k);
const point = (j, id) => j.points.find((p) => p.id === id);
const occ = (r, date) => `${r.id}@${date}`;

test('cycle en cours : les points se suivent, ouverts puis clos à l’instant, sans action de clôture', async () => {
  const t = await setup({ closingLock: true });
  let j = t.bpm.closingJourney(t.ctx);
  assert.equal(j.phase, 'running');
  assert.equal(j.period.key, '2026-11');
  assert.equal(j.opensOn, '2026-12-01');
  assert.equal(j.total, 5, '5 échéances prévues du cycle');
  assert.equal(j.percent, 0);
  assert.equal(point(j, t.plumber.id).openedOn, '2026-11-03', 'une prévision s’ouvre à sa saisie');
  assert.equal(point(j, occ(t.salary, '2026-11-01')).openedOn, '2026-11-03', 'définition saisie le 3 : son occurrence du 1er s’ouvre ce jour-là');
  assert.equal(criterion(j, 'income').state, 'todo', 'le salaire du 1er est déjà en retard');
  assert.equal(j.lock.active, false);
  assert.equal(j.closingMode.active, false);

  // Une dépense saisie déjà réglée n'ouvre aucun point.
  await t.budget.createOperation(t.ctx, { requestKey: key('op'), status: 'realized', direction: 'charge', label: 'Café', amount: 3, date: '2026-11-03', costCenterRef: 'std:divers' });
  assert.equal(t.bpm.closingJourney(t.ctx).total, 5);

  // Clos à l'instant, là où il vit : règlement d'une occurrence, écart d'une autre.
  await settle(t, t.salary, '2026-11-01');
  await t.budget.skipOccurrence(t.ctx, t.groceries.id, { requestKey: key('skip'), occurrenceDate: '2026-11-20', reason: 'Repas offerts' });
  j = t.bpm.closingJourney(t.ctx);
  const salary = point(j, occ(t.salary, '2026-11-01'));
  assert.equal(salary.state, 'closed');
  assert.equal(salary.outcomeLabel, 'Reçue le 1 nov. 2026');
  assert.ok(salary.closedAt, 'heure de clôture du point');
  const groceries = point(j, occ(t.groceries, '2026-11-20'));
  assert.equal(groceries.state, 'closed');
  assert.equal(groceries.outcome, 'skipped');
  assert.match(groceries.outcomeLabel, /^Écartée le .* · Repas offerts$/);
  assert.equal(j.total, 5, 'une échéance écartée reste un point, clos');
  assert.equal(j.percent, 40, '2 points sur 5');
  assert.deepEqual(j.counts, { total: 5, open: 3, closed: 2, deferred: 0, later: 0, inherited: 0 });

  // Le résumé des pages suit les mêmes points.
  const brief = t.bpm.closingBrief(t.ctx);
  assert.equal(brief.phase, 'running');
  assert.equal(brief.percent, 40);
  assert.equal(brief.points.find((p) => p.id === occ(t.salary, '2026-11-01')).state, 'closed');

  // Aucune action de clôture tant que le cycle court.
  await rejects(defer(t, t.plumber.id, '2026-12'), 'FORBIDDEN_BY_RULE');
  await rejects(t.bpm.finalizeClosing(t.ctx, { requestKey: key('fin'), periodKey: '2026-11' }), 'FORBIDDEN_BY_RULE');
});

test('actions du cycle (classées, avec leur contexte) et contrôles de cohérence', async () => {
  const t = await setup({ closingLock: true });
  const lifeId = t.bpm.closingJourney(t.ctx).context.budgets.find((b) => b.role === 'life').id;
  await settle(t, t.salary, '2026-11-01');
  await t.budget.skipOccurrence(t.ctx, t.groceries.id, { requestKey: key('skip'), occurrenceDate: '2026-11-20' });
  await t.budget.createOperation(t.ctx, { requestKey: key('op'), status: 'realized', direction: 'charge', label: 'Café', amount: 3, date: '2026-11-03', costCenterRef: 'std:divers' });
  // Prévue pour décembre : elle touchera décembre, pas novembre.
  await t.budget.createOperation(t.ctx, { requestKey: key('op'), status: 'planned', direction: 'charge', label: 'Cadeau', amount: 40, date: '2026-12-10', costCenterRef: 'std:divers' });
  for (const amount of [100, 110]) {
    await t.budget.setCaps(t.ctx, lifeId, { expectedRevision: t.socle.state.budgets[lifeId].revision, caps: { 'std:divers': amount }, merge: true });
  }

  const j = t.bpm.closingJourney(t.ctx);
  const cat = (k) => j.actions.categories.find((c) => c.key === k);
  const verbs = (k) => cat(k).items.map((i) => `${i.verb} · ${i.label}`);
  assert.deepEqual(verbs('daily').sort(), ['Dépense payée saisie · Café', 'Dépense prévue saisie · Plombier', 'Échéance reçue · Salaire', 'Échéance écartée · Courses'].sort());
  assert.ok(!j.actions.categories.flatMap((c) => c.items).some((i) => i.label === 'Cadeau'), 'une prévision de décembre ne touche pas novembre');
  assert.match(cat('daily').items.find((i) => i.label === 'Salaire').detail, /reçue le 1 nov\. 2026/);
  assert.deepEqual(verbs('recurring').sort(), ['Échéance récurrente définie · Courses', 'Échéance récurrente définie · Internet', 'Échéance récurrente définie · Loyer', 'Échéance récurrente définie · Salaire']);
  const caps = cat('caps').items.find((i) => i.verb === 'Plafonds des postes fixés');
  assert.equal(caps.count, 2, 'les réglages répétés du même jour se comptent');
  assert.equal(caps.detail, '1 poste plafonné · 110,00 € au total');

  // Contrôles : les points ouverts sont à voir pendant le cycle. Le plafond de « Divers » dépassé (120 + 3 > 110) n'est pas un
  // contrôle : c'est un fait marquant du cycle (bilan), jamais une incohérence.
  const check = (k) => j.checks.items.find((c) => c.key === k);
  assert.equal(check('points').state, 'warn');
  assert.equal(check('integrity').state, 'ok');
  assert.equal(check('result').state, 'ok');
  assert.equal(check('caps'), undefined);
  assert.deepEqual(j.checks.blocking, []);
  // Chaque contrôle dit comment se résoudre, où agir, et où il en est.
  assert.equal(check('points').resolution.steps.length, 3);
  assert.deepEqual(check('points').items.find((i) => i.label === 'Plombier').target, { kind: 'line', id: t.plumber.id, coreProjectId: null, page: 'echeances' });
  assert.equal(check('integrity').resolution.problem, null);

  // En clôture, un point encore ouvert devient bloquant.
  await at('2026-12-02', async () => {
    const c = t.bpm.closingJourney(t.ctx);
    assert.equal(c.checks.items.find((x) => x.key === 'points').state, 'fail');
    assert.deepEqual(c.checks.blocking, ['Points du cycle traités']);
    assert.equal(c.canClose, false);
  });
});

test('fin du dernier jour : mode clôture (points figés) et cycle suivant verrouillé', async () => {
  const t = await setup({ closingLock: true });
  await at('2026-12-02', async () => {
    const j = t.bpm.closingJourney(t.ctx);
    assert.equal(j.phase, 'to_close');
    assert.equal(j.lock.active, true);
    assert.equal(j.lock.from, '2026-12-01');
    assert.match(j.lock.message, /Novembre 2026 est terminé et attend sa clôture : Décembre 2026 démarrera à sa clôture/);
    assert.equal(j.closingMode.active, true);
    assert.match(j.closingMode.message, /^Novembre 2026 est en clôture : ses points sont figés/);
    assert.equal(point(j, 'account'), undefined, 'l’étape « Vérifier le compte » est retirée');

    // Cycle suivant : opération, règlement daté de décembre, définition récurrente touchée.
    await rejects(t.budget.createOperation(t.ctx, { requestKey: key('op'), status: 'realized', direction: 'charge', label: 'Café', amount: 3, date: '2026-12-02', costCenterRef: 'std:divers' }), 'CYCLE_AWAITING_CLOSURE');
    await rejects(settle(t, t.rent, '2026-11-02', '2026-12-01'), 'CYCLE_AWAITING_CLOSURE');
    await rejects(t.budget.createRecurrence(t.ctx, { requestKey: key('rec'), label: 'Sport', direction: 'charge', amount: 20, cadence: 'monthly', firstDate: '2026-12-05', costCenterRef: 'std:divers' }), 'CYCLE_AWAITING_CLOSURE');
    await rejects(t.budget.updateRecurrence(t.ctx, t.rent.id, { expectedRevision: t.rent.revision, amount: 750 }), 'CYCLE_AWAITING_CLOSURE');

    // Cycle en clôture : aucune nouvelle prévision n'y entre, aucune prévision n'y change de date.
    await rejects(t.budget.createOperation(t.ctx, { requestKey: key('op'), status: 'planned', direction: 'charge', label: 'Taxi', amount: 25, date: '2026-11-29', costCenterRef: 'std:divers' }), 'CYCLE_IN_CLOSING');
    await rejects(t.budget.createRecurrence(t.ctx, { requestKey: key('rec'), label: 'Cours', direction: 'charge', amount: 15, cadence: 'weekly', firstDate: '2026-11-10', endDate: '2026-11-30', costCenterRef: 'std:divers' }), 'CYCLE_IN_CLOSING');
    await rejects(t.budget.updateOperation(t.ctx, t.plumber.id, { expectedRevision: t.plumber.revision, date: '2026-11-27' }), 'CYCLE_IN_CLOSING');
    // Ce qui a eu lieu se saisit toujours (sans ouvrir de point), et les points se traitent.
    await t.budget.createOperation(t.ctx, { requestKey: key('op'), status: 'realized', direction: 'charge', label: 'Pharmacie', amount: 12, date: '2026-11-29', costCenterRef: 'std:divers' });
    await settle(t, t.rent, '2026-11-02');
    assert.equal(t.bpm.closingJourney(t.ctx).total, 5);
  });
});

test('clôture à 100 % : points reportés vers le cycle choisi, marques et impacts sur le cycle suivant', async () => {
  const t = await setup({ closingLock: true });
  await settle(t, t.salary, '2026-11-01');
  await at('2026-12-02', async () => {
    await settle(t, t.rent, '2026-11-02');
    await rejects(t.bpm.finalizeClosing(t.ctx, { requestKey: key('fin'), periodKey: '2026-11' }), 'CLOSING_INCOMPLETE');

    // Le plombier se revoit en décembre ; Internet, plus loin (février 2027).
    await defer(t, t.plumber.id, '2026-12');
    let j = await defer(t, occ(t.internet, '2026-11-28'), '2027-02');
    assert.equal(point(j, t.plumber.id).state, 'deferred');
    assert.deepEqual(point(j, occ(t.internet, '2026-11-28')).deferTo, { key: '2027-02', label: 'Février 2027', start: '2027-02-01' });
    assert.ok(j.percent < 100);
    assert.equal(criterion(j, 'account'), undefined, 'plus de critère « Compte vérifié »');

    await settle(t, t.groceries, '2026-11-20', '2026-11-20', 280);
    j = t.bpm.closingJourney(t.ctx);
    assert.equal(j.account, undefined);
    assert.equal(j.percent, 100);
    assert.equal(j.canClose, true);
    assert.equal(j.closing.preview.resultCents, 200000 - 70000 - 28000);

    // Impacts sur décembre : budget récurrent, report du plombier, solde prévu ; Internet attend février.
    const im = j.impacts;
    assert.equal(im.next.key, '2026-12');
    assert.equal(im.capitalization.resultCents, 102000);
    assert.equal(im.capitalization.provisional, false);
    assert.deepEqual(im.recurring, { count: 4, incomeCents: 200000, chargeCents: 103000 });
    assert.deepEqual(im.deferred.intoNext, { count: 1, incomeCents: 0, chargeCents: 12000 });
    assert.deepEqual(im.deferred.byCycle.map((c) => [c.key, c.count]), [['2026-12', 1], ['2027-02', 1]]);
    assert.equal(im.balanceCents, 200000 - 103000 - 12000);
    assert.equal(im.opensEntries, true);

    const r = await t.bpm.finalizeClosing(t.ctx, { requestKey: key('fin'), periodKey: '2026-11', expectedResultCents: j.closing.preview.resultCents });
    assert.equal(r.closure.periodKey, '2026-11');
    assert.equal(r.carriedCount, 2);
    assert.deepEqual(r.closure.journey.deferred.map((d) => [d.label, d.toPeriodKey]), [['Plombier', '2026-12'], ['Internet', '2027-02']]);
    assert.equal(r.closure.journey.account, undefined);
    // Historisation : les actions et les contrôles du cycle sont figés dans la clôture.
    assert.ok(r.closure.journey.actions.total >= 8);
    assert.ok(r.closure.journey.actions.items.some((i) => i.verb === 'Échéance réglée' && i.label === 'Loyer'));
    assert.deepEqual(r.closure.journey.checks.filter((c) => c.level === 'blocking').map((c) => c.state), ['ok', 'ok', 'ok']);

    const state = t.socle.state;
    // Ponctuel : même opération, au premier jour de son cycle cible, avec sa marque d'origine.
    assert.equal(state.operations[t.plumber.id].date, '2026-12-01');
    assert.deepEqual(state.operations[t.plumber.id].carriedFrom, { lineId: t.plumber.id, date: '2026-11-25', periodKey: '2026-11', toPeriodKey: '2026-12' });
    // Récurrent : l'occurrence de novembre est écartée (marque « reportée »), une prévision la remplace en février.
    const internetNov = Object.values(state.operations).find((o) => o.recurrenceId === t.internet.id && o.occurrenceDate === '2026-11-28');
    assert.equal(internetNov.status, 'cancelled');
    assert.deepEqual(internetNov.carriedTo, { periodKey: '2027-02', date: '2027-02-01' });
    assert.equal(internetNov.cancelReason, 'Reportée en Février 2027 (Novembre 2026)');
    const carriedInternet = Object.values(state.operations).find((o) => o.carriedFrom?.lineId === occ(t.internet, '2026-11-28'));
    assert.equal(carriedInternet.date, '2027-02-01');
    assert.equal(carriedInternet.status, 'planned');

    // Le cycle suivant est lancé : le verrou tombe, le report y est un point hérité de novembre.
    j = t.bpm.closingJourney(t.ctx);
    assert.equal(j.phase, 'running');
    assert.equal(j.period.key, '2026-12');
    assert.equal(j.lock.active, false);
    assert.deepEqual(point(j, t.plumber.id).inheritedFrom, { periodKey: '2026-11', label: 'Novembre 2026', date: '2026-11-25' });
    assert.equal(j.counts.inherited, 1);
    assert.equal(point(j, occ(t.rent, '2026-12-02')).openedOn, '2026-12-01', 'une occurrence entre au premier jour de son cycle');
    assert.equal(j.lastClosure.periodKey, '2026-11');
    assert.equal(j.lastClosure.deferredCount, 2);
    await t.budget.createOperation(t.ctx, { requestKey: key('op'), status: 'planned', direction: 'charge', label: 'Taxi', amount: 25, date: '2026-12-02', costCenterRef: 'std:divers' });
  });
});

test('report : seuls les points ouverts non bloquants, vers un cycle à venir ; le report se retire', async () => {
  const t = await setup({ closingLock: true });
  await settle(t, t.salary, '2026-11-01');
  await at('2026-12-02', async () => {
    await rejects(defer(t, occ(t.salary, '2026-11-01'), '2026-12'), 'ALREADY_SETTLED');
    await rejects(defer(t, 'inconnue', '2026-12'), 'NOT_FOUND');
    await rejects(defer(t, 'account', '2026-12'), 'NOT_FOUND');
    await rejects(defer(t, t.plumber.id, '2026-10'), 'VALIDATION');
    await rejects(defer(t, t.plumber.id, '2029-01'), 'VALIDATION');
    let j = await defer(t, t.plumber.id, '2027-06');
    assert.equal(point(j, t.plumber.id).deferTo.label, 'Juin 2027');
    j = await defer(t, t.plumber.id, null);
    assert.equal(point(j, t.plumber.id).state, 'open');
    // Ancienne forme : report au cycle suivant.
    j = await decide(t, { carry: { lineId: t.plumber.id } });
    assert.equal(point(j, t.plumber.id).deferTo.key, '2026-12');
    await rejects(decide(t, { periodKey: '2026-12' }), 'FORBIDDEN_BY_RULE');
  });
});

test('projets et décisions : flux à valider, décision prise à l’instant, décision reportée au cycle suivant', async () => {
  const { socle } = await makeSocle({ closingLock: true });
  const { ctx } = await makeUser(socle, { label: 'Projets', openingStock: 5000, anchorDay: 1, cycleStartDate: '2026-11-01' });
  const P = socle.modules.bpm.projects;
  const B = socle.modules.budget;
  const bpm = socle.modules.bpm;
  const p = await P.createProject(ctx, { requestKey: key(), title: 'Cuisine', amount: 2000 });
  const task = async (title) => (await P.createTask(ctx, { requestKey: key(), projectId: p.coreProjectId, title })).task;
  const [works, extra] = [await task('Travaux'), await task('Électroménager')];
  const { operation: tiles } = await B.createOperation(ctx, { requestKey: key(), budgetId: p.budgetId, taskId: works.id, direction: 'charge', label: 'Carreaux', amount: 200, date: '2026-11-20', costCenterRef: 'std:divers', status: 'planned' });
  const { request } = await P.requestTaskBudget(ctx, p.budgetId, extra.id, { requestKey: key(), amount: 900 });
  const { overrun } = await P.requestOverrun(ctx, p.budgetId, { requestKey: key(), reason: 'reglement', amount: 150 });

  let j = bpm.closingJourney(ctx);
  assert.equal(point(j, tiles.id).group, 'projects');
  assert.equal(point(j, tiles.id).project.name, 'Cuisine');
  assert.equal(point(j, `request:${request.id}`).state, 'open');
  assert.equal(point(j, `overrun:${overrun.id}`).statusLabel, 'Décision du budget de vie attendue');
  assert.equal(criterion(j, 'decisions').total, 2);

  // La demande est accordée dans le projet : le point se clôt à l'instant.
  await P.decideTaskBudget(ctx, request.id, { expectedRevision: socle.state.taskBudgetRequests[request.id].revision, expectedBudgetRevision: socle.state.budgets[p.budgetId].revision, decision: 'approve' });
  j = bpm.closingJourney(ctx);
  assert.equal(point(j, `request:${request.id}`).state, 'closed');
  assert.match(point(j, `request:${request.id}`).outcomeLabel, /^Accordée le 3 nov\. 2026$/);

  await at('2026-12-02', async () => {
    // Une décision se revoit au cycle suivant seulement ; un flux de projet, selon l'avancement du projet.
    await rejects(defer({ bpm, ctx }, `overrun:${overrun.id}`, '2027-01'), 'VALIDATION');
    await defer({ bpm, ctx }, `overrun:${overrun.id}`, '2026-12');
    await defer({ bpm, ctx }, tiles.id, '2027-03');
    j = bpm.closingJourney(ctx);
    assert.equal(j.percent, 100);
    assert.equal(j.impacts.decisions.count, 1);
    assert.deepEqual(j.impacts.deferred.byCycle.map((c) => [c.key, c.points[0].project]), [['2027-03', 'Cuisine']]);
    const r = await bpm.finalizeClosing(ctx, { requestKey: key('fin'), periodKey: '2026-11', expectedResultCents: j.closing.preview.resultCents });
    assert.deepEqual(r.closure.journey.deferred.map((d) => [d.kind, d.toPeriodKey]).sort(), [['decision', '2026-12'], ['line', '2027-03']]);
    assert.equal(socle.state.operations[tiles.id].date, '2027-03-01');

    // En décembre, la décision toujours en attente est un point hérité ; les carreaux attendent mars.
    j = bpm.closingJourney(ctx);
    assert.equal(j.period.key, '2026-12');
    assert.deepEqual(point(j, `overrun:${overrun.id}`).inheritedFrom, { periodKey: null, label: null, date: '2026-11-03' });
    assert.equal(point(j, tiles.id), undefined);
  });
});

test('verrou désactivé (paramètre) : ni mode clôture ni cycle suivant verrouillé', async () => {
  const t = await setup();
  await at('2026-12-02', async () => {
    const j = t.bpm.closingJourney(t.ctx);
    assert.equal(j.phase, 'to_close');
    assert.equal(j.lock.enabled, false);
    assert.equal(j.lock.active, false);
    assert.equal(j.closingMode.active, false);
    await t.budget.createOperation(t.ctx, { requestKey: key('op'), status: 'realized', direction: 'charge', label: 'Café', amount: 3, date: '2026-12-02', costCenterRef: 'std:divers' });
    await t.budget.createOperation(t.ctx, { requestKey: key('op'), status: 'planned', direction: 'charge', label: 'Taxi', amount: 25, date: '2026-11-29', costCenterRef: 'std:divers' });
  });
});

test('robustesse : cycles en retard clôturés dans l’ordre, aperçu périmé refusé, clôture rejouée sans double versement', async () => {
  const t = await setup({ closingLock: true });
  // Rien n'est décidé tant que le cycle court.
  await rejects(decide(t, {}), 'FORBIDDEN_BY_RULE');
  await rejects(t.bpm.finalizeClosing(t.ctx, { requestKey: key('fin'), periodKey: '2026-11' }), 'FORBIDDEN_BY_RULE');
  await settle(t, t.salary, '2026-11-01');
  await settle(t, t.rent, '2026-11-02');
  // Le 2 décembre, le plombier est reporté à décembre… puis la clôture attend janvier.
  await at('2026-12-02', () => defer(t, t.plumber.id, '2026-12'));
  await at('2027-01-03', async () => {
    // Les points de novembre se traitent pendant sa clôture.
    await settle(t, t.groceries, '2026-11-20');
    await settle(t, t.internet, '2026-11-28');
    // Deux cycles terminés : novembre d'abord, décembre attend.
    let j = t.bpm.closingJourney(t.ctx);
    assert.equal(j.period.key, '2026-11');
    assert.equal(j.backlog, 2);
    assert.match(j.lock.message, /les cycles terminés se clôturent dans l’ordre/);
    await rejects(t.bpm.closingDecision(t.ctx, { periodKey: '2026-12' }), 'FORBIDDEN_BY_RULE');
    // Décembre est terminé à son tour : le report qui le visait tombe, le point redevient ouvert.
    assert.equal(point(j, t.plumber.id).state, 'open');
    assert.equal(j.targets[0].key, '2027-01', 'seuls les cycles pas encore terminés reçoivent un report');
    await rejects(defer(t, t.plumber.id, '2026-12'), 'VALIDATION');
    await defer(t, t.plumber.id, '2027-01');
    j = t.bpm.closingJourney(t.ctx);
    assert.equal(j.canClose, true);
    const expected = j.closing.preview.resultCents;

    // Un aperçu périmé (montant différent de celui calculé) ne fige rien.
    await rejects(t.bpm.finalizeClosing(t.ctx, { requestKey: key('fin'), periodKey: '2026-11', expectedResultCents: expected + 1 }), 'CLOSING_PREVIEW_STALE');
    assert.equal(t.bpm.closingJourney(t.ctx).period.key, '2026-11');

    const requestKey = key('fin');
    const first = await t.bpm.finalizeClosing(t.ctx, { requestKey, periodKey: '2026-11', expectedResultCents: expected });
    const capitalizations = () => Object.values(t.socle.state.closures).filter((c) => c.periodKey === '2026-11').length;
    assert.equal(capitalizations(), 1);
    // Le même envoi rejoué (double clic, réseau) ne clôture ni ne verse une seconde fois.
    const again = await t.bpm.finalizeClosing(t.ctx, { requestKey, periodKey: '2026-11', expectedResultCents: expected });
    assert.equal(again.replayed, true);
    assert.equal(capitalizations(), 1);
    assert.equal(again.closure.id, first.closure.id);

    // Le report est inscrit au premier jour de janvier ; décembre passe en clôture à son tour, sans lui.
    assert.equal(t.socle.state.operations[t.plumber.id].date, '2027-01-01');
    j = t.bpm.closingJourney(t.ctx);
    assert.equal(j.phase, 'to_close');
    assert.equal(j.period.key, '2026-12');
    assert.equal(j.backlog, 1);
    assert.equal(point(j, t.plumber.id), undefined);
    // Novembre ne se rouvre pas.
    await rejects(t.bpm.finalizeClosing(t.ctx, { requestKey: key('fin'), periodKey: '2026-11' }), 'FORBIDDEN_BY_RULE');
  });
});
