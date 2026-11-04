// Projets de la vie dans BPM : projets et tâches du noyau (seule source), budget attribué par le budget de vie,
// ventilation sur les tâches, dépassements autorisés par le budget de vie et facturés en fin de cycle, retours de
// revenus à la complétion d'une tâche, charges de projet comptées dans le budget de vie à leur validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at, camille, key, makeSocle, makeUser, rejects, throwsCode, TODAY } from './helpers.mjs';

const P = (socle) => socle.modules.bpm.projects;
const value = (socle, ctx, k, periodKey) => socle.modules.bpm.figure(ctx, k, { periodKey }).value;

/** Projet créé dans le noyau (avec ses tâches), puis budgété par le budget de vie, avec un montant éventuel. */
async function fundedProject(socle, ctx, { title = 'Voyage au Japon', tasks = ['Vols', 'Hôtels', 'JR Pass'], amount } = {}) {
  const core = socle.modules.core;
  const p = await core.createCoreProject(ctx, { requestKey: key('prj'), title });
  const taskIds = [];
  for (const t of tasks) taskIds.push((await core.createTask(ctx, { requestKey: key('tsk'), title: t, projectId: p.project.id })).task.id);
  const adopted = await P(socle).adoptProject(ctx, { requestKey: key('adopt'), coreProjectId: p.project.id });
  let detail = adopted.detail;
  if (amount !== undefined) detail = await P(socle).allocate(ctx, adopted.budgetId, { amount, expectedRevision: detail.budget.revision });
  return { projectId: p.project.id, budgetId: adopted.budgetId, taskIds, detail };
}

const share = async (socle, ctx, budgetId, taskId, amount) => {
  const rev = P(socle).projectDetail(ctx, socle.state.budgets[budgetId].coreProjectId).budget.revision;
  return P(socle).setTaskShare(ctx, budgetId, taskId, { amount, expectedRevision: rev });
};

const charge = (socle, ctx, budgetId, input) =>
  socle.modules.budget.createOperation(ctx, { requestKey: key('op'), budgetId, direction: 'charge', label: 'Dépense', costCenterRef: 'std:loisirs', status: 'planned', date: TODAY, ...input });

async function approve(socle, ctx, budgetId, input) {
  const r = await P(socle).requestOverrun(ctx, budgetId, { requestKey: key('ovr'), ...input });
  return P(socle).decideOverrun(ctx, r.overrunId, { decision: 'approve', expectedRevision: r.overrun.revision });
}

test('projets BPM : le projet de vie et les projets standards du user seulement ; la création reste dans le noyau', async () => {
  const { socle } = await makeSocle();
  const { ctx, bundle } = await camille(socle);
  const { ctx: other } = await makeUser(socle, { label: 'Autre', anchorDay: 1, cycleStartDate: '2026-08-01' });
  const japon = await fundedProject(socle, ctx);
  const generic = await socle.modules.core.createCoreProject(ctx, { requestKey: key('g'), title: 'Bricolage' });
  const foreign = await fundedProject(socle, other, { title: 'Projet d’un autre' });

  const o = P(socle).overview(ctx);
  assert.equal(o.lifeProject.project.id, bundle.coreProjectId);
  assert.deepEqual(o.projects.map((p) => p.project.title), ['Voyage au Japon']);
  assert.equal(o.projects[0].budget.state, 'unallocated');
  assert.deepEqual(o.candidates.map((c) => c.title), ['Bricolage'], 'un projet du noyau non budgété peut être financé');
  assert.ok(!JSON.stringify(o).includes(foreign.projectId), 'aucun projet d’un autre user');
  throwsCode(() => P(socle).projectDetail(ctx, foreign.projectId), 'NOT_FOUND');
  throwsCode(() => P(socle).projectDetail(ctx, generic.project.id), 'NOT_FOUND');
  await rejects(P(socle).allocate(other, japon.budgetId, { amount: 100, expectedRevision: 1 }), 'NOT_FOUND');

  // Le projet de vie n'est pas un projet standard ; un projet ne se budgète qu'une fois.
  await rejects(P(socle).adoptProject(ctx, { requestKey: key('a'), coreProjectId: bundle.coreProjectId }), 'FORBIDDEN_BY_RULE');
  await rejects(P(socle).adoptProject(ctx, { requestKey: key('a'), coreProjectId: japon.projectId }), 'UNIQUENESS_VIOLATION');
  const adopted = await P(socle).adoptProject(ctx, { requestKey: key('a'), coreProjectId: generic.project.id });
  assert.equal(adopted.detail.role, 'standard');
  assert.deepEqual(P(socle).overview(ctx).projects.map((p) => p.project.title), ['Voyage au Japon', 'Bricolage']);
  assert.deepEqual(P(socle).tasksOverview(ctx).tasks.map((t) => t.task.title), ['Vols', 'Hôtels', 'JR Pass']);
});

test('budget attribué : charge non récurrente spéciale du budget de vie, non comptée à sa date ; ventilation qui décrémente le budget', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const p = await fundedProject(socle, ctx, { amount: 3700 });
  assert.deepEqual([p.detail.budget.allocationCents, p.detail.budget.allocationDate, p.detail.budget.availableCents, p.detail.budget.state], [370000, TODAY, 370000, 'ok']);

  // Charge spéciale : présentée dans le registre du budget de vie, hors totaux et hors chiffres de la période.
  const reg = socle.modules.bpm.reads.register(ctx, {});
  const alloc = reg.lines.find((l) => l.kind === 'projectAllocation');
  assert.deepEqual([alloc.plannedCents, alloc.plannedDate, alloc.status, alloc.special], [370000, TODAY, 'project', true]);
  assert.deepEqual([reg.totals.plannedCents, reg.totals.toPayCents, reg.totals.specialCents], [0, 0, 370000]);
  assert.deepEqual([value(socle, ctx, 'bpm.charges'), value(socle, ctx, 'bpm.chargesPrevues'), value(socle, ctx, 'bpm.resteAPayer')], [0, 0, 0]);

  const [vols, hotels, pass] = p.taskIds;
  await share(socle, ctx, p.budgetId, vols, 1800);
  const d = await share(socle, ctx, p.budgetId, hotels, 1200);
  assert.deepEqual([d.budget.sharesCents, d.budget.availableCents], [300000, 70000]);
  assert.equal(d.tasks.find((t) => t.task.id === hotels).budget.shareCents, 120000);

  // Plus de budget : la part demandée dépasse de 200 € ; le budget de vie décide.
  const err = await rejects(share(socle, ctx, p.budgetId, pass, 900), 'OVERRUN_AUTHORIZATION_REQUIRED');
  assert.deepEqual([err.details.reason, err.details.overrunCents, err.details.taskId], ['ventilation', 20000, pass]);
  const req = await P(socle).requestOverrun(ctx, p.budgetId, { requestKey: key('o'), taskId: pass, reason: 'ventilation', amount: 200 });
  assert.equal(req.overrun.status, 'pending');
  assert.equal(P(socle).overview(ctx).life.pendingRequests.length, 1);
  await rejects(P(socle).requestOverrun(ctx, p.budgetId, { requestKey: key('o'), taskId: pass, reason: 'ventilation', amount: 200 }), 'UNIQUENESS_VIOLATION');
  const refused = await P(socle).decideOverrun(ctx, req.overrunId, { decision: 'refuse', expectedRevision: req.overrun.revision });
  assert.equal(refused.overrun.status, 'refused');
  await rejects(share(socle, ctx, p.budgetId, pass, 900), 'OVERRUN_AUTHORIZATION_REQUIRED');

  const ok = await approve(socle, ctx, p.budgetId, { taskId: pass, reason: 'ventilation', amount: 200 });
  assert.deepEqual([ok.overrun.status, ok.overrun.billingDate, ok.detail.budget.deficit, ok.detail.budget.state], ['approved', '2026-11-30', true, 'deficit']);
  const after = await share(socle, ctx, p.budgetId, pass, 900);
  assert.deepEqual([after.budget.sharesCents, after.budget.ceilingCents, after.budget.availableCents], [390000, 390000, 0]);
  // Le budget attribué ne descend pas sous la ventilation.
  await rejects(P(socle).allocate(ctx, p.budgetId, { amount: 3000, expectedRevision: after.budget.revision }), 'FORBIDDEN_BY_RULE');
});

test('règlement : une charge de projet compte dans le dépensé du budget de vie à sa validation ; un dépassement exige l’accord du budget de vie', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const p = await fundedProject(socle, ctx, { tasks: ['Vols'], amount: 1000 });
  const [vols] = p.taskIds;
  await share(socle, ctx, p.budgetId, vols, 1000);

  const planned = await charge(socle, ctx, p.budgetId, { label: 'Billets', amount: 600, taskId: vols, date: '2026-11-10' });
  // Charge prévue d'un projet : ni dans le dépensé, ni dans le prévu ou le restant du budget de vie.
  assert.deepEqual([value(socle, ctx, 'bpm.charges'), value(socle, ctx, 'bpm.chargesPrevues'), value(socle, ctx, 'bpm.resteAPayer')], [0, 0, 0]);
  assert.equal(P(socle).projectDetail(ctx, p.projectId).budget.engagedCents, 60000);

  await socle.modules.budget.realizeOperation(ctx, planned.operation.id, { expectedRevision: 1, realizedDate: TODAY });
  assert.deepEqual([value(socle, ctx, 'bpm.charges'), value(socle, ctx, 'bpm.chargesProjets')], [600, 600]);
  const fig = socle.modules.bpm.figure(ctx, 'bpm.chargesProjets');
  assert.deepEqual(fig.inputs[0].sources.map((s) => s.id), [planned.operation.id]);
  const reg = socle.modules.bpm.reads.register(ctx, {});
  assert.deepEqual(reg.lines.filter((l) => l.projectCharge).map((l) => [l.label, l.status]), [['Billets', 'settled']]);
  assert.equal(reg.totals.paidCents, 60000);

  // 600 + 500 > 1 000 : le règlement attend l'autorisation du budget de vie, rien n'est écrit.
  const err = await rejects(charge(socle, ctx, p.budgetId, { label: 'Bagages', amount: 500, taskId: vols, status: 'realized' }), 'OVERRUN_AUTHORIZATION_REQUIRED');
  assert.deepEqual([err.details.reason, err.details.overrunCents, err.details.paidCents, err.details.ceilingCents], ['reglement', 10000, 60000, 100000]);
  assert.equal(Object.values(socle.state.operations).filter((o) => o.label === 'Bagages').length, 0);
  await approve(socle, ctx, p.budgetId, { taskId: vols, reason: 'reglement', amount: 100 });
  await charge(socle, ctx, p.budgetId, { label: 'Bagages', amount: 500, taskId: vols, status: 'realized' });
  const d = P(socle).projectDetail(ctx, p.projectId);
  assert.deepEqual([d.budget.paidCents, d.budget.remainingCents, d.budget.deficit], [110000, 0, true]);
  assert.equal(d.tasks[0].budget.over, true, 'la tâche dépasse sa part');
  assert.equal(value(socle, ctx, 'bpm.charges'), 1100);
});

test('fin de cycle : le dépassement autorisé est facturé au budget de vie, le budget attribué l’intègre et les contrôles sont rendus', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const p = await fundedProject(socle, ctx, { tasks: ['Vols'], amount: 1000 });
  const [vols] = p.taskIds;
  await share(socle, ctx, p.budgetId, vols, 1000);
  await approve(socle, ctx, p.budgetId, { taskId: vols, reason: 'ventilation', amount: 250 });
  await share(socle, ctx, p.budgetId, vols, 1250);

  // Avant la fin du cycle : rien à facturer. La charge de dépassement figure à la fin de la période.
  const early = await rejects(P(socle).billOverruns(ctx, {}), 'FORBIDDEN_BY_RULE');
  assert.equal(early.details.nextBillingDate, '2026-11-30');
  const line = socle.modules.bpm.reads.register(ctx, {}).lines.find((l) => l.kind === 'projectOverrun');
  assert.deepEqual([line.plannedDate, line.plannedCents, line.special], ['2026-11-30', 25000, true]);

  await at('2026-12-01', async () => {
    assert.ok(socle.inspector.checks(socle.state).some((c) => c.rule === 'PRJ-02'), 'à facturer : signalé');
    const r = await P(socle).billOverruns(ctx, {});
    assert.equal(r.projects.length, 1);
    assert.deepEqual([r.projects[0].allocationCents, r.projects[0].billedOverrunCents], [125000, 25000]);
    assert.ok(r.projects[0].checks.some((c) => c.code === 'shares' && c.level === 'ok'), 'budget = somme des parts');
    assert.ok(r.projects[0].checks.some((c) => c.code === 'engaged' && c.level === 'info'), 'part non encore planifiée en charges');
    const d = P(socle).projectDetail(ctx, p.projectId);
    assert.deepEqual([d.budget.deficit, d.budget.state, d.budget.ceilingCents, d.overruns[0].status], [false, 'ok', 125000, 'billed']);
    // Le budget attribué de la ligne spéciale reste le montant initial ; le dépassement facturé est sa propre ligne.
    const nov = socle.modules.bpm.reads.register(ctx, { period: '2026-11' });
    assert.deepEqual(nov.lines.filter((l) => l.special).map((l) => [l.kind, l.plannedCents, l.statusLabel]), [
      ['projectAllocation', 100000, 'Charge de projet · comptée à la validation de ses dépenses'],
      ['projectOverrun', 25000, 'Dépassement facturé en fin de cycle'],
    ]);
  });
});

test('retours : une tâche terminée retourne un revenu ponctuel ou récurrent au budget de vie, une seule fois', async () => {
  const { socle } = await makeSocle();
  const { ctx, bundle } = await camille(socle);
  const p = await fundedProject(socle, ctx, { title: 'Location du garage', tasks: ['Aménager', 'Louer', 'Ranger'] });
  const [amenager, louer, ranger] = p.taskIds;
  const rev = () => P(socle).projectDetail(ctx, p.projectId).budget.revision;
  await P(socle).setTaskReturn(ctx, p.budgetId, amenager, { label: 'Vente des étagères', amount: 250, cadence: 'once', expectedRevision: rev() });
  await P(socle).setTaskReturn(ctx, p.budgetId, louer, { label: 'Loyer du garage', amount: 80, cadence: 'monthly', expectedRevision: rev() });
  const core = socle.modules.core;
  const done = await core.changeTaskStatus(ctx, amenager, { status: 'done', expectedRevision: 1 });
  assert.equal(done.effects[0].kind, 'projectReturn');
  const vente = Object.values(socle.state.operations).filter((o) => o.label === 'Vente des étagères');
  assert.deepEqual(vente.map((o) => [o.budgetId, o.direction, o.amountCents, o.date, o.status]), [[bundle.budgetId, 'income', 25000, TODAY, 'planned']]);
  assert.equal(value(socle, ctx, 'bpm.resteARecevoir'), 250);

  // Rouvrir puis terminer de nouveau ne crée pas un second retour.
  await core.changeTaskStatus(ctx, amenager, { status: 'doing', expectedRevision: 2 });
  const again = await core.changeTaskStatus(ctx, amenager, { status: 'done', expectedRevision: 3 });
  assert.deepEqual(again.effects, []);
  assert.equal(Object.values(socle.state.operations).filter((o) => o.label === 'Vente des étagères').length, 1);

  await core.changeTaskStatus(ctx, louer, { status: 'done', expectedRevision: 1 });
  const loyer = Object.values(socle.state.recurrences).filter((r) => r.label === 'Loyer du garage');
  assert.deepEqual(loyer.map((r) => [r.budgetId, r.cadence, r.firstDate, r.amountCents]), [[bundle.budgetId, 'monthly', TODAY, 8000]]);

  // Retour configuré sur une tâche déjà terminée : dû tout de suite.
  await core.changeTaskStatus(ctx, ranger, { status: 'done', expectedRevision: 1 });
  const r = await P(socle).setTaskReturn(ctx, p.budgetId, ranger, { label: 'Revente', amount: 40, expectedRevision: rev() });
  assert.equal(r.effects.length, 1);
  assert.equal(r.tasks.find((t) => t.task.id === ranger).budget.return.entryKind, 'operation');
});

test('rattachement et états : depuis le noyau comme depuis BPM ; une tâche qui porte des données budgétaires reste dans son projet', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const core = socle.modules.core;
  const p = await fundedProject(socle, ctx, { tasks: ['Vols'], amount: 500 });
  const q = await fundedProject(socle, ctx, { title: 'Cuisine', tasks: ['Devis'] });
  const loose = await core.createTask(ctx, { requestKey: key('t'), title: 'Passeports' });
  assert.ok(P(socle).tasksOverview(ctx).attachable.some((t) => t.task.id === loose.task.id));

  const attached = await core.attachTask(ctx, loose.task.id, { projectId: p.projectId, expectedRevision: 1 });
  assert.equal(attached.qualification.code, 'budgetedProjectTask');
  assert.ok(P(socle).tasksOverview(ctx).tasks.some((t) => t.task.id === loose.task.id));
  // Changement d'état : l'état du projet suit (calculé depuis ses tâches).
  const moved = await core.changeTaskStatus(ctx, loose.task.id, { status: 'doing', expectedRevision: 2 });
  assert.equal(moved.affectedProjects[0].view.status, 'active');

  await share(socle, ctx, p.budgetId, loose.task.id, 100);
  const err = await rejects(core.attachTask(ctx, loose.task.id, { projectId: q.projectId, expectedRevision: 3 }), 'FORBIDDEN_BY_RULE');
  assert.deepEqual(err.details.links, ['une part de budget']);
  await rejects(core.detachTask(ctx, loose.task.id, { expectedRevision: 3 }), 'FORBIDDEN_BY_RULE');
  await share(socle, ctx, p.budgetId, loose.task.id, null);
  const detached = await core.detachTask(ctx, loose.task.id, { expectedRevision: 3 });
  assert.equal(detached.task.projectId, null);

  // Une dépense reliée à la tâche la retient aussi dans son projet.
  const [vols] = p.taskIds;
  await charge(socle, ctx, p.budgetId, { label: 'Billets', amount: 100, taskId: vols });
  const held = await rejects(core.attachTask(ctx, vols, { projectId: q.projectId, expectedRevision: 1 }), 'FORBIDDEN_BY_RULE');
  assert.deepEqual(held.details.links, ['une dépense ou entrée']);
});
