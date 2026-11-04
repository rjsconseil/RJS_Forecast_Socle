import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at, camille, key, makeSocle, makeUser, rejects, TODAY } from './helpers.mjs';

const projects = (socle) => socle.modules.bpm.projects;
const detail = (socle, ctx, p) => projects(socle).projectDetail(ctx, p.coreProjectId);
async function task(socle, ctx, p, title = 'Travaux') {
  return projects(socle).createTask(ctx, { requestKey: key(), title, projectId: p?.coreProjectId, plannedHours: 12 });
}
async function request(socle, ctx, p, t, amount) {
  return (await projects(socle).requestTaskBudget(ctx, p.budgetId, t.task.id, { requestKey: key(), amount, note: 'Montant nécessaire' }))
    .request;
}
function decide(socle, ctx, p, r, decision = 'approve') {
  return projects(socle).decideTaskBudget(ctx, r.id, {
    decision,
    expectedRevision: r.revision,
    expectedBudgetRevision: detail(socle, ctx, p).budget.revision,
  });
}
async function project(socle, ctx, amount = 100) {
  return projects(socle).createProject(ctx, { requestKey: key(), title: 'Rénovation', description: 'Un projet de la vie', amount });
}
async function operation(socle, ctx, p, t, amount, extra = {}) {
  return socle.modules.budget.createOperation(ctx, {
    requestKey: key(),
    budgetId: p.budgetId,
    taskId: t?.task.id,
    direction: 'charge',
    label: 'Matériaux',
    amount,
    date: TODAY,
    costCenterRef: 'std:loisirs',
    status: 'realized',
    ...extra,
  });
}

test('BPM : création atomique et idempotente du couple projet/budget, sans créer un second projet de vie', async () => {
  const { socle, reload } = await makeSocle();
  const { ctx, bundle } = await camille(socle);
  const input = { requestKey: key(), title: 'Préparer un voyage', amount: null };
  const before = socle.state.revision;
  const [p, repeated] = await Promise.all([projects(socle).createProject(ctx, input), projects(socle).createProject(ctx, input)]);
  assert.equal(p.coreProjectId, repeated.coreProjectId);
  assert.equal(repeated.replayed, true);
  assert.equal(socle.state.revision, before + 1);
  assert.equal(p.detail.budget.regime, false);
  assert.equal(p.detail.tasks.length, 0, 'le projet peut être préparé avant ses tâches');
  assert.equal(socle.state.budgets[p.budgetId].parentBudgetId, bundle.budgetId);
  assert.equal(Object.values(socle.state.budgets).filter((b) => b.role === 'life').length, 1);
  const revision = socle.state.revision;
  await rejects(projects(socle).createProject(ctx, { requestKey: key(), title: 'Invalide', amount: -1 }), 'VALIDATION');
  assert.equal(socle.state.revision, revision, 'pas de projet orphelin lors d’un échec');
  assert.equal(
    Object.values(socle.state.coreProjects).some((p) => p.title === 'Invalide'),
    false,
  );
  const loaded = await reload();
  assert.equal(detail(loaded, ctx, p).budget.budgetId, p.budgetId);
});

test('BPM : préparer une tâche, la rattacher plus tard et financer ensuite le projet', async () => {
  const { socle } = await makeSocle();
  const { ctx, bundle } = await camille(socle);
  const t = await task(socle, ctx, null);
  const p = await project(socle, ctx, null);
  assert.equal(t.task.projectId, null);
  await rejects(
    projects(socle).createTask(ctx, { requestKey: key(), title: 'Sur le tronc', projectId: bundle.coreProjectId }),
    'INCOMPATIBLE_REFERENCE',
  );
  const attached = await socle.modules.core.attachTask(ctx, t.task.id, { expectedRevision: t.task.revision, projectId: p.coreProjectId });
  assert.equal(attached.task.id, t.task.id);
  assert.equal(attached.task.plannedHours, 12);
  const r = await request(socle, ctx, p, attached, 60);
  await rejects(decide(socle, ctx, p, r), 'FORBIDDEN_BY_RULE');
  const d = await projects(socle).allocate(ctx, p.budgetId, { amount: 100, expectedRevision: detail(socle, ctx, p).budget.revision });
  const approved = await decide(socle, ctx, p, r);
  assert.equal(approved.request.status, 'approved');
  assert.deepEqual([approved.detail.budget.sharesCents, approved.detail.budget.availableCents], [6000, 4000]);
  assert.equal(socle.modules.bpm.figure(ctx, 'bpm.charges').value, 0);
  assert.equal(d.budget.paidCents, 0);
});

test('demandes des tâches : idempotence, conflit de version, refus, annulation et garde de rattachement', async () => {
  const { socle, reload } = await makeSocle();
  const { ctx } = await camille(socle);
  const p = await project(socle, ctx);
  const t = await task(socle, ctx, p);
  const input = { requestKey: key(), amount: 75 };
  const r = await projects(socle).requestTaskBudget(ctx, p.budgetId, t.task.id, input);
  assert.equal((await projects(socle).requestTaskBudget(ctx, p.budgetId, t.task.id, input)).request.id, r.request.id);
  await rejects(request(socle, ctx, p, t, 90), 'UNIQUENESS_VIOLATION');
  await rejects(socle.modules.core.detachTask(ctx, t.task.id, { expectedRevision: t.task.revision }), 'FORBIDDEN_BY_RULE');
  await rejects(
    projects(socle).decideTaskBudget(ctx, r.request.id, {
      decision: 'approve',
      expectedRevision: 999,
      expectedBudgetRevision: p.detail.budget.revision,
    }),
    'STALE_VERSION',
  );
  assert.equal((await decide(socle, ctx, p, r.request, 'refuse')).request.status, 'refused');
  assert.equal(detail(socle, ctx, p).budget.sharesCents, 0);
  const next = await request(socle, ctx, p, t, 80);
  assert.equal((await decide(socle, ctx, p, next, 'cancel')).request.status, 'cancelled');
  const detached = await socle.modules.core.detachTask(ctx, t.task.id, { expectedRevision: t.task.revision });
  assert.equal(detached.task.projectId, null);
  const loaded = await reload();
  assert.deepEqual(new Set(detail(loaded, ctx, p).requests.map((r) => r.status)), new Set(['refused', 'cancelled']));
});

test('budget épuisé : seul le manque est soumis au parent ; son accord accorde la part et survit au redémarrage', async () => {
  const { socle, reload } = await makeSocle();
  const { ctx } = await camille(socle);
  const p = await project(socle, ctx);
  const t = await task(socle, ctx, p);
  const r = await request(socle, ctx, p, t, 150);
  const waiting = await decide(socle, ctx, p, r);
  assert.equal(waiting.request.status, 'awaiting-life');
  assert.equal(waiting.detail.budget.sharesCents, 0);
  const overrun = waiting.detail.budget.pendingOverrun;
  assert.equal(overrun.amountCents, 5000);
  assert.equal(overrun.taskBudgetRequestId, r.id);
  const loaded = await reload();
  await projects(loaded).decideOverrun(ctx, overrun.id, { decision: 'approve', expectedRevision: overrun.revision });
  const d = detail(loaded, ctx, p);
  assert.deepEqual(
    [d.requests[0].status, d.budget.sharesCents, d.budget.ceilingCents, d.budget.state],
    ['approved', 15000, 15000, 'deficit'],
  );
  assert.equal(loaded.modules.bpm.figure(ctx, 'bpm.charges').value, 0, 'autoriser un dépassement ne dépense rien');
  await operation(loaded, ctx, p, t, 140);
  assert.equal(loaded.modules.bpm.figure(ctx, 'bpm.charges').value, 140);
  assert.deepEqual([detail(loaded, ctx, p).budget.remainingCents, detail(loaded, ctx, p).budget.periodPaidCents], [1000, 14000]);
  await at('2026-11-30', async () => {
    await projects(loaded).billOverruns(ctx, {});
    assert.equal(detail(loaded, ctx, p).budget.allocationCents, 15000);
    assert.equal(detail(loaded, ctx, p).budget.approvedOverrunCents, 0);
    assert.equal(loaded.modules.bpm.figure(ctx, 'bpm.charges').value, 140, 'la facturation ne compte pas deux fois le règlement');
    assert.equal(detail(loaded, ctx, p).checks.find((c) => c.code === 'paid-ceiling').level, 'ok');
    assert.equal(detail(loaded, ctx, p).checks.find((c) => c.code === 'period-reconciliation').level, 'ok');
  });
});

test('dépassement refusé ou annulé : aucune part accordée, aucune autorisation laissée ouverte', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const p = await project(socle, ctx);
  const t = await task(socle, ctx, p);
  const r = await request(socle, ctx, p, t, 120);
  const waiting = await decide(socle, ctx, p, r);
  const o = waiting.detail.budget.pendingOverrun;
  await projects(socle).decideOverrun(ctx, o.id, { decision: 'refuse', expectedRevision: o.revision });
  assert.equal(detail(socle, ctx, p).requests[0].status, 'refused');
  assert.equal(detail(socle, ctx, p).budget.sharesCents, 0);
  const next = await request(socle, ctx, p, t, 130);
  const second = await decide(socle, ctx, p, next);
  await decide(socle, ctx, p, second.request, 'cancel');
  assert.equal(detail(socle, ctx, p).budget.pendingOverrun, null);
  assert.equal(socle.state.projectOverruns[second.request.overrunId].status, 'refused');
});

test('demandes concurrentes : jamais de surventilation silencieuse', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const p = await project(socle, ctx);
  const a = await task(socle, ctx, p, 'A');
  const b = await task(socle, ctx, p, 'B');
  const ra = await request(socle, ctx, p, a, 80);
  const rb = await request(socle, ctx, p, b, 80);
  const staleBudgetRevision = detail(socle, ctx, p).budget.revision;
  await decide(socle, ctx, p, ra);
  await rejects(
    projects(socle).decideTaskBudget(ctx, rb.id, {
      decision: 'approve',
      expectedRevision: rb.revision,
      expectedBudgetRevision: staleBudgetRevision,
    }),
    'STALE_VERSION',
  );
  const second = await decide(socle, ctx, p, rb);
  assert.equal(second.request.status, 'awaiting-life');
  assert.equal(second.detail.budget.pendingOverrun.amountCents, 6000);
  assert.equal(second.detail.budget.sharesCents, 8000);
});

test('validation tardive du parent : une ventilation modifiée laisse la demande à réexaminer', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const p = await project(socle, ctx);
  const a = await task(socle, ctx, p, 'A');
  const b = await task(socle, ctx, p, 'B');
  const ra = await request(socle, ctx, p, a, 150);
  const waiting = await decide(socle, ctx, p, ra);
  const rb = await request(socle, ctx, p, b, 50);
  await decide(socle, ctx, p, rb);
  const o = waiting.detail.budget.pendingOverrun;
  await projects(socle).decideOverrun(ctx, o.id, { decision: 'approve', expectedRevision: o.revision });
  const d = detail(socle, ctx, p);
  assert.equal(d.requests.find((r) => r.id === ra.id).status, 'pending');
  assert.equal(d.budget.sharesCents, 5000);
  assert.equal(d.budget.ceilingCents, 15000);
});

test('règlements : part obligatoire dans les nouveaux projets et refus des baisses sous le consommé', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const p = await project(socle, ctx);
  const t = await task(socle, ctx, p);
  await rejects(operation(socle, ctx, p, t, 20), 'FORBIDDEN_BY_RULE');
  await rejects(operation(socle, ctx, p, null, 20), 'FORBIDDEN_BY_RULE');
  await decide(socle, ctx, p, await request(socle, ctx, p, t, 60));
  const paid = await operation(socle, ctx, p, t, 40);
  const unfunded = await task(socle, ctx, p, 'Autre tâche sans part');
  await rejects(
    socle.modules.budget.updateOperation(ctx, paid.operation.id, { expectedRevision: paid.operation.revision, taskId: unfunded.task.id }),
    'FORBIDDEN_BY_RULE',
  );
  assert.equal(socle.state.operations[paid.operation.id].taskId, t.task.id);
  await rejects(operation(socle, ctx, p, t, 30), 'FORBIDDEN_BY_RULE');
  await rejects(
    projects(socle).setTaskShare(ctx, p.budgetId, t.task.id, { amount: 30, expectedRevision: detail(socle, ctx, p).budget.revision }),
    'FORBIDDEN_BY_RULE',
  );
  await rejects(
    projects(socle).allocate(ctx, p.budgetId, { amount: 30, expectedRevision: detail(socle, ctx, p).budget.revision }),
    'FORBIDDEN_BY_RULE',
  );
  assert.equal(detail(socle, ctx, p).budget.paidCents, 4000);
});

test('occurrence annulée : la nouvelle réalisation contrôle la tâche conservée par l’opération', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const p = await project(socle, ctx, 200);
  const a = await task(socle, ctx, p, 'Tâche initiale');
  const b = await task(socle, ctx, p, 'Nouvelle tâche de la récurrence');
  await decide(socle, ctx, p, await request(socle, ctx, p, a, 50));
  await decide(socle, ctx, p, await request(socle, ctx, p, b, 100));
  const budget = socle.modules.budget;
  const { recurrence } = await budget.createRecurrence(ctx, {
    requestKey: key(), budgetId: p.budgetId, taskId: a.task.id,
    direction: 'charge', label: 'Matériaux récurrents', amount: 40,
    cadence: 'monthly', firstDate: TODAY, costCenterRef: 'std:loisirs',
  });
  const paid = await budget.settleOccurrence(ctx, recurrence.id, { requestKey: key(), occurrenceDate: TODAY });
  const cancelled = await budget.cancelRealization(ctx, paid.operation.id, { expectedRevision: paid.operation.revision });
  await budget.updateRecurrence(ctx, recurrence.id, { expectedRevision: recurrence.revision, taskId: b.task.id });

  // L’opération matérialisée conserve sa tâche ; la part de B ne doit pas financer un règlement imputé à A.
  await rejects(budget.settleOccurrence(ctx, recurrence.id, {
    requestKey: key(), occurrenceDate: TODAY, realizedAmount: 80,
  }), 'FORBIDDEN_BY_RULE');
  assert.equal(socle.state.operations[paid.operation.id].revision, cancelled.operation.revision);
  assert.equal(detail(socle, ctx, p).budget.paidCents, 0);
  const settled = await budget.settleOccurrence(ctx, recurrence.id, {
    requestKey: key(), occurrenceDate: TODAY, realizedAmount: 40,
  });
  assert.equal(settled.operation.id, paid.operation.id);
  assert.equal(settled.operation.taskId, a.task.id);
  const figures = detail(socle, ctx, p).budget;
  assert.equal(figures.byTask[a.task.id].paidCents, 4000);
  assert.equal(figures.byTask[b.task.id]?.paidCents ?? 0, 0);
});

test('occurrence annulée : le sens de l’opération contrôle le financement de la nouvelle réalisation', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const p = await project(socle, ctx, 200);
  const t = await task(socle, ctx, p);
  const budget = socle.modules.budget;
  const { recurrence } = await budget.createRecurrence(ctx, {
    requestKey: key(), budgetId: p.budgetId, taskId: t.task.id,
    direction: 'income', label: 'Retour récurrent', amount: 40,
    cadence: 'monthly', firstDate: TODAY, costCenterRef: 'std:autresRevenus',
  });
  const paid = await budget.settleOccurrence(ctx, recurrence.id, { requestKey: key(), occurrenceDate: TODAY });
  const cancelled = await budget.cancelRealization(ctx, paid.operation.id, { expectedRevision: paid.operation.revision });
  await budget.updateOperation(ctx, paid.operation.id, {
    expectedRevision: cancelled.operation.revision, direction: 'charge', costCenterRef: 'std:loisirs',
  });
  await rejects(budget.settleOccurrence(ctx, recurrence.id, {
    requestKey: key(), occurrenceDate: TODAY,
  }), 'FORBIDDEN_BY_RULE');
  assert.equal(detail(socle, ctx, p).budget.paidCents, 0);
  await decide(socle, ctx, p, await request(socle, ctx, p, t, 50));
  const settled = await budget.settleOccurrence(ctx, recurrence.id, { requestKey: key(), occurrenceDate: TODAY });
  assert.equal(settled.operation.direction, 'charge');
  assert.equal(detail(socle, ctx, p).budget.byTask[t.task.id].paidCents, 4000);
});

test('consommation au temps : même pourcentage de la part, règlements réels distincts et temps inconnu conservé', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const p = await project(socle, ctx, 1000);
  const t = await task(socle, ctx, p);
  await decide(socle, ctx, p, await request(socle, ctx, p, t, 500));
  const updated = await socle.modules.core.updateTask(ctx, t.task.id, { expectedRevision: t.task.revision, plannedHours: 10, spentHours: 6 });
  const projection = detail(socle, ctx, p).tasks[0].budget;
  assert.deepEqual([projection.timeConsumptionPercent, projection.timeConsumedCents, projection.timeRemainingCents], [60, 30000, 20000]);
  assert.equal(projection.paidCents, 0);
  assert.equal(socle.modules.bpm.figure(ctx, 'bpm.charges').value, 0, 'la saisie de temps ne crée pas de dépense');
  const over = await socle.modules.core.updateTask(ctx, t.task.id, { expectedRevision: updated.task.revision, spentHours: 12 });
  assert.equal(detail(socle, ctx, p).tasks[0].budget.timeRemainingCents, -10000, 'le dépassement de temps reste visible');
  await socle.modules.core.updateTask(ctx, t.task.id, { expectedRevision: over.task.revision, plannedHours: null });
  assert.equal(detail(socle, ctx, p).tasks[0].budget.timeConsumedCents, null, 'pas de faux zéro sans estimation');
});

test('isolation : aucun projet, tâche ou demande d’un autre utilisateur ne peut être utilisé', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const { ctx: other } = await makeUser(socle);
  const p = await project(socle, ctx);
  const t = await task(socle, ctx, p);
  const r = await request(socle, ctx, p, t, 60);
  await rejects(projects(socle).createTask(other, { requestKey: key(), title: 'Intrusion', projectId: p.coreProjectId }), 'NOT_FOUND');
  await rejects(projects(socle).requestTaskBudget(other, p.budgetId, t.task.id, { requestKey: key(), amount: 80 }), 'NOT_FOUND');
  await rejects(projects(socle).decideTaskBudget(other, r.id, { decision: 'approve', expectedRevision: r.revision }), 'NOT_FOUND');
  assert.equal(JSON.stringify(projects(socle).overview(other)).includes(r.id), false);
  const checks = socle.inspector.checks(socle.state).filter((c) => c.result === 'failed');
  assert.deepEqual(checks, []);
});
