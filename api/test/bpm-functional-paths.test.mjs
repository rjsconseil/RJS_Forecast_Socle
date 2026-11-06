// Recette métier : dates prévues/réelles, financement, retours et lectures croisées.
// Chaque cas utilise un stockage temporaire ; aucun fichier de données du site n'est touché.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  at,
  camille,
  key,
  makeSocle,
  operation,
  rejects,
  TODAY,
} from "./helpers.mjs";

const P = (s) => s.modules.bpm.projects;
const B = (s) => s.modules.budget;
const D = (s, ctx, p) => P(s).projectDetail(ctx, p.coreProjectId);
const share = (s, ctx, p, t, amount) =>
  P(s).setTaskShare(ctx, p.budgetId, t.task.id, {
    amount,
    expectedRevision: D(s, ctx, p).budget.revision,
  });
async function fixture({ amount = 100, allocationDay = TODAY } = {}) {
  const { socle: s } = await makeSocle();
  const { ctx, bundle } = await camille(s);
  const p = await at(allocationDay, () =>
    P(s).createProject(ctx, {
      requestKey: key(),
      title: "Projet recette",
      amount,
    }),
  );
  const t = await P(s).createTask(ctx, {
    requestKey: key(),
    title: "Tâche recette",
    projectId: p.coreProjectId,
  });
  return { s, ctx, bundle, p, t };
}
const charge = (s, ctx, p, t, input = {}) =>
  B(s).createOperation(ctx, {
    requestKey: key(),
    budgetId: p.budgetId,
    taskId: t.task.id,
    direction: "charge",
    label: "Charge recette",
    amount: 40,
    date: TODAY,
    status: "planned",
    costCenterRef: "std:loisirs",
    ...input,
  });

test("projet sans enveloppe : préparer les demandes et les dépenses reste possible, régler attend l’attribution", async () => {
  const { s, ctx, p, t } = await fixture({ amount: null });
  const op = await charge(s, ctx, p, t);
  const request = await P(s).requestTaskBudget(ctx, p.budgetId, t.task.id, {
    requestKey: key(),
    amount: 40,
  });
  assert.equal(request.request.status, "pending");
  const detail = s.modules.bpm.reads.lineDetail(ctx, op.operation.id);
  assert.deepEqual(
    [
      detail.project.taskFundingRequired,
      detail.actions.canSettle,
      detail.project.inclusion,
    ],
    [true, false, "unfunded"],
  );
  const err = await rejects(
    B(s).realizeOperation(ctx, op.operation.id, {
      expectedRevision: op.operation.revision,
      realizedDate: TODAY,
      fund: true,
    }),
    "FORBIDDEN_BY_RULE",
  );
  assert.match(err.message, /Attribuez d’abord une enveloppe/);
  await P(s).allocate(ctx, p.budgetId, {
    amount: 100,
    expectedRevision: D(s, ctx, p).budget.revision,
  });
  assert.equal(
    s.modules.bpm.reads.lineDetail(ctx, op.operation.id).actions.canSettle,
    true,
  );
});

test("date réelle antérieure à l’enveloppe : historique autorisé, sans part ni remontée au budget de vie", async () => {
  const { s, ctx, p, t } = await fixture();
  const planned = await charge(s, ctx, p, t);
  const paid = await B(s).realizeOperation(ctx, planned.operation.id, {
    expectedRevision: planned.operation.revision,
    realizedDate: "2026-10-31",
    fund: true,
  });
  assert.equal(paid.operation.realizedDate, "2026-10-31");
  const d = D(s, ctx, p);
  assert.deepEqual(
    [
      d.budget.paidCents,
      d.budget.paidBeforeAllocationCents,
      d.budget.sharesCents,
    ],
    [0, 4000, 0],
  );
  assert.equal(d.tasks[0].budget.paidBeforeCents, 4000);
  assert.deepEqual(
    [d.charges[0].validated, d.charges[0].beforeAllocation],
    [false, true],
  );
  assert.equal(
    s.modules.bpm.figure(ctx, "bpm.charges", { periodKey: "2026-10" }).value,
    0,
  );
  assert.equal(s.modules.bpm.figure(ctx, "bpm.charges").value, 0);
});

test("attribution après des dépenses : conserve l’historique hors enveloppe, puis remonte les nouveaux règlements", async () => {
  const { s, ctx } = await fixture();
  const core = await s.modules.core.createCoreProject(ctx, {
    requestKey: key(),
    title: "Projet historique",
  });
  const p = await P(s).adoptProject(ctx, {
    requestKey: key(),
    coreProjectId: core.project.id,
  });
  const t = await P(s).createTask(ctx, {
    requestKey: key(),
    title: "Historique",
    projectId: p.coreProjectId,
  });
  await charge(s, ctx, p, t, {
    status: "realized",
    date: "2026-10-20",
    amount: 70,
  });
  await P(s).allocate(ctx, p.budgetId, {
    amount: 100,
    expectedRevision: D(s, ctx, p).budget.revision,
  });
  await charge(s, ctx, p, t, { status: "realized", amount: 30 });
  const d = D(s, ctx, p);
  assert.deepEqual(
    [
      d.budget.paidBeforeAllocationCents,
      d.budget.paidCents,
      d.budget.remainingCents,
    ],
    [7000, 3000, 7000],
  );
  assert.equal(s.modules.bpm.figure(ctx, "bpm.charges").value, 30);
});

test("dépense prévue trois cycles plus tard et réglée maintenant : seule la date réelle consomme le cycle", async () => {
  const { s, ctx, p, t } = await fixture();
  const planned = await charge(s, ctx, p, t, {
    date: "2027-02-03",
    amount: 45,
  });
  await rejects(
    B(s).realizeOperation(ctx, planned.operation.id, {
      expectedRevision: planned.operation.revision,
      fund: true,
    }),
    "FUTURE_REALIZATION",
  );
  await B(s).realizeOperation(ctx, planned.operation.id, {
    expectedRevision: planned.operation.revision,
    realizedDate: TODAY,
    realizedAmount: 42,
    fund: true,
  });
  assert.deepEqual(
    [D(s, ctx, p).budget.paidCents, D(s, ctx, p).budget.toPayCents],
    [4200, 0],
  );
  assert.equal(s.modules.bpm.figure(ctx, "bpm.charges").value, 42);
  const reads = s.modules.bpm.reads;
  const center = reads.centerDetail(ctx, "std:loisirs");
  assert.deepEqual(
    [center.center.paidCents, center.totals.paidCents],
    [4200, 4200],
  );
  assert.deepEqual(
    center.settledLines.map((l) => [l.id, l.plannedDate, l.realizedDate]),
    [[planned.operation.id, "2027-02-03", TODAY]],
  );
  assert.equal(center.pendingLines.length, 0);
});

test("règlement dans un cycle antérieur ouvert : détail du poste et gestion du projet de vie suivent la période consultée", async () => {
  const { s, ctx, p, t } = await fixture({ allocationDay: "2026-10-01" });
  await share(s, ctx, p, t, 80);
  const planned = await charge(s, ctx, p, t, { date: TODAY, amount: 60 });
  await B(s).realizeOperation(ctx, planned.operation.id, {
    expectedRevision: planned.operation.revision,
    realizedDate: "2026-10-28",
  });
  const reads = s.modules.bpm.reads;
  const oct = reads.centerDetail(ctx, "std:loisirs", { period: "2026-10" });
  const nov = reads.centerDetail(ctx, "std:loisirs");
  assert.deepEqual(
    [oct.center.paidCents, oct.totals.paidCents, oct.settledLines.length],
    [6000, 6000, 1],
  );
  assert.deepEqual(
    [nov.center.paidCents, nov.totals.paidCents, nov.lines.length],
    [0, 0, 0],
  );
  const lifeOct = s.modules.bpm.life.lifeManagement(ctx, {
    periodKey: "2026-10",
  }).projects;
  const lifeNov = s.modules.bpm.life.lifeManagement(ctx).projects;
  assert.deepEqual(
    [lifeOct.periodPaidCents, lifeOct.projects[0].periodPaidCents],
    [6000, 6000],
  );
  assert.deepEqual(
    [lifeNov.periodPaidCents, lifeNov.projects[0].periodPaidCents],
    [0, 0],
  );
});

test("revenu prévu et revenu reçu dans deux cycles différents : listes et chiffres utilisent les mêmes dates", async () => {
  const { s, ctx } = await fixture();
  const advanced = await operation(s, ctx, {
    direction: "income",
    date: "2026-12-01",
    realizedDate: TODAY,
    amount: 150,
  });
  await operation(s, ctx, {
    direction: "income",
    date: TODAY,
    realizedDate: "2026-10-31",
    amount: 80,
  });
  const pending = await operation(s, ctx, {
    direction: "income",
    date: "2026-11-20",
    amount: 50,
    status: "planned",
  });
  const read = s.modules.bpm.reads.incomes(ctx);
  assert.deepEqual([read.receivedCents, read.expectedCents], [15000, 5000]);
  assert.deepEqual(
    read.settledLines.map((l) => l.id),
    [advanced.operation.id],
  );
  assert.deepEqual(
    read.pendingLines.map((l) => l.id),
    [pending.operation.id],
  );
  assert.equal(read.lines.length, 2);
});

test("le détail du Dépensé retrouve tous les règlements à leur date réelle, sans compter les enveloppes", async () => {
  const { s, ctx, p, t } = await fixture({ allocationDay: "2026-10-01" });
  const advanced = await charge(s, ctx, p, t, {
    date: "2027-02-03",
    amount: 45,
  });
  await B(s).realizeOperation(ctx, advanced.operation.id, {
    expectedRevision: advanced.operation.revision,
    realizedDate: TODAY,
    realizedAmount: 42,
    fund: true,
  });
  const previous = await charge(s, ctx, p, t, { date: TODAY, amount: 20 });
  await B(s).realizeOperation(ctx, previous.operation.id, {
    expectedRevision: previous.operation.revision,
    realizedDate: "2026-10-28",
    fund: true,
  });
  await charge(s, ctx, p, t, { date: "2026-11-20", amount: 15 });
  const reads = s.modules.bpm.reads;
  const real = reads.register(ctx, {
    period: "2026-11",
    direction: "charge",
    dateBasis: "realized",
    groupBy: "date",
  });
  assert.deepEqual(
    real.lines.map((l) => l.id),
    [advanced.operation.id],
  );
  assert.deepEqual(
    [real.totals.paidCents, real.totals.toPayCents, real.totals.specialCents],
    [4200, 0, 0],
  );
  assert.equal(real.groups[0].key, TODAY);
  assert.equal(
    real.totals.paidCents / 100,
    s.modules.bpm.figure(ctx, "bpm.charges").value,
  );
  const planned = reads.register(ctx, {
    period: "2026-11",
    direction: "charge",
  });
  assert.equal(
    planned.lines.some((l) => l.id === previous.operation.id),
    true,
  );
  assert.equal(
    planned.lines.some((l) => l.id === advanced.operation.id),
    false,
  );
  const project = reads.register(ctx, {
    budgetId: p.budgetId,
    period: "2026-11",
    dateBasis: "realized",
  });
  assert.equal(project.totals.paidCents, 4200);
  const october = reads.register(ctx, {
    period: "2026-10",
    dateBasis: "realized",
    groupBy: "date",
  });
  assert.equal(
    october.lines.some((l) => l.id === previous.operation.id),
    true,
  );
  assert.equal(
    october.groups.find((g) => g.lineIds.includes(previous.operation.id)).key,
    "2026-10-28",
  );
});

test("retour déclenché : le retirer ne doit pas effacer sa trace et permettre un second revenu à la réouverture", async () => {
  const { s, ctx, p, t } = await fixture();
  await P(s).setTaskReturn(ctx, p.budgetId, t.task.id, {
    amount: 25,
    label: "Retour recette",
    cadence: "once",
    expectedRevision: D(s, ctx, p).budget.revision,
  });
  await s.modules.core.changeTaskStatus(ctx, t.task.id, {
    status: "done",
    expectedRevision: s.state.tasks[t.task.id].revision,
  });
  const entryId = D(s, ctx, p).budget.returns[t.task.id].entryId;
  const err = await rejects(
    P(s).setTaskReturn(ctx, p.budgetId, t.task.id, {
      amount: null,
      expectedRevision: D(s, ctx, p).budget.revision,
    }),
    "FORBIDDEN_BY_RULE",
  );
  assert.equal(err.details.entryId, entryId);
  assert.match(err.message, /déjà enregistré/);
  assert.equal(D(s, ctx, p).budget.returns[t.task.id].entryId, entryId);
  for (const status of ["todo", "done"])
    await s.modules.core.changeTaskStatus(ctx, t.task.id, {
      status,
      expectedRevision: s.state.tasks[t.task.id].revision,
    });
  assert.equal(
    Object.values(s.state.operations).filter(
      (o) => o.label === "Retour recette",
    ).length,
    1,
  );
});

test("baisse de part et d’enveloppe sous le réglé refusée sans modifier les chiffres ; annuler libère le consommé", async () => {
  const { s, ctx, p, t } = await fixture();
  await share(s, ctx, p, t, 80);
  const paid = await charge(s, ctx, p, t, { status: "realized", amount: 60 });
  await rejects(share(s, ctx, p, t, 59.99), "FORBIDDEN_BY_RULE");
  await rejects(
    P(s).allocate(ctx, p.budgetId, {
      amount: 59.99,
      expectedRevision: D(s, ctx, p).budget.revision,
    }),
    "FORBIDDEN_BY_RULE",
  );
  assert.deepEqual(
    [D(s, ctx, p).budget.allocationCents, D(s, ctx, p).budget.paidCents],
    [10000, 6000],
  );
  await B(s).cancelRealization(ctx, paid.operation.id, {
    expectedRevision: paid.operation.revision,
  });
  assert.equal(s.modules.bpm.figure(ctx, "bpm.charges").value, 0);
  assert.deepEqual(
    [
      D(s, ctx, p).budget.paidCents,
      D(s, ctx, p).budget.sharesCents,
      D(s, ctx, p).budget.toPayCents,
    ],
    [0, 8000, 6000],
  );
});

test("dépassement au centime : financement atomique puis clôture sans double charge", async () => {
  const { s, ctx, p, t } = await fixture({ allocationDay: "2026-10-01" });
  await at("2026-10-20", () =>
    charge(s, ctx, p, t, {
      amount: 100.01,
      status: "realized",
      date: "2026-10-20",
      fund: true,
    }),
  );
  const d = D(s, ctx, p);
  assert.deepEqual(
    [d.budget.ceilingCents, d.budget.paidCents, d.budget.approvedOverrunCents],
    [10001, 10001, 1],
  );
  await P(s).billOverruns(ctx, { budgetId: p.budgetId });
  assert.equal(D(s, ctx, p).budget.allocationCents, 10001);
  for (const periodKey of ["2026-08", "2026-09", "2026-10"])
    await s.modules.bpm.closePeriod(ctx, { requestKey: key(), periodKey });
  assert.equal(
    s.modules.bpm.figure(ctx, "bpm.charges", { periodKey: "2026-10" }).value,
    100.01,
  );
  assert.equal(s.modules.bpm.figure(ctx, "bpm.charges").value, 0);
});

test("échéance récurrente close réglée tardivement : le projet et le parent portent uniquement la date réelle", async () => {
  const { s, ctx, p, t } = await fixture({
    allocationDay: "2026-09-01",
    amount: 200,
  });
  await share(s, ctx, p, t, 120);
  const { recurrence } = await B(s).createRecurrence(ctx, {
    requestKey: key(),
    budgetId: p.budgetId,
    taskId: t.task.id,
    direction: "charge",
    label: "Abonnement projet",
    amount: 30,
    cadence: "monthly",
    firstDate: "2026-09-03",
    endDate: "2026-11-03",
    costCenterRef: "std:loisirs",
  });
  for (const periodKey of ["2026-08", "2026-09", "2026-10"])
    await s.modules.bpm.closePeriod(ctx, { requestKey: key(), periodKey });
  await B(s).settleOccurrence(ctx, recurrence.id, {
    requestKey: key(),
    occurrenceDate: "2026-09-03",
    realizedDate: TODAY,
  });
  assert.equal(
    s.modules.bpm.figure(ctx, "bpm.charges", { periodKey: "2026-09" }).value,
    0,
  );
  assert.equal(s.modules.bpm.figure(ctx, "bpm.charges").value, 30);
  assert.equal(
    s.modules.bpm.reads.centerDetail(ctx, "std:loisirs").settledLines.length,
    1,
  );
  const real = s.modules.bpm.reads.register(ctx, {
    dateBasis: "realized",
    direction: "charge",
    groupBy: "date",
  });
  assert.deepEqual(
    real.lines.map((l) => [l.recurrenceId, l.plannedDate, l.realizedDate]),
    [[recurrence.id, "2026-09-03", TODAY]],
  );
  assert.equal(real.groups[0].key, TODAY);
  const err = await rejects(
    B(s).settleOccurrence(ctx, recurrence.id, {
      requestKey: key(),
      occurrenceDate: "2026-10-03",
      realizedDate: "2026-10-20",
    }),
    "PERIOD_CLOSED",
  );
  assert.match(err.message, /close/);
});

test("action modifier : règlement clos à date réelle, même si sa date prévue reste dans un cycle ouvert", async () => {
  const { s, ctx, p, t } = await fixture({ allocationDay: "2026-10-01" });
  await share(s, ctx, p, t, 80);
  const paid = await charge(s, ctx, p, t, {
    date: TODAY,
    realizedDate: "2026-10-20",
    status: "realized",
  });
  for (const periodKey of ["2026-08", "2026-09", "2026-10"])
    await s.modules.bpm.closePeriod(ctx, { requestKey: key(), periodKey });
  const d = s.modules.bpm.reads.lineDetail(ctx, paid.operation.id);
  assert.deepEqual(
    [d.actions.canEdit, d.actions.canCancelSettlement],
    [false, false],
  );
  assert.match(d.actions.editReason, /close/);
  await rejects(
    B(s).updateOperation(ctx, paid.operation.id, {
      expectedRevision: paid.operation.revision,
      label: "Modification",
    }),
    "PERIOD_CLOSED",
  );
});
