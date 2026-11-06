// Recette additive : uniquement des commandes du socle et des middlewares, jamais de mutation brute.
// L'horloge de recette permet de créer un historique réel. Elle est toujours rétablie avant de rendre la main.
import { randomUUID } from "node:crypto";
import { occurrenceDates } from "../src/modules/budget/recurrence.mjs";

export async function runBpmFunctionalScenarios(
  socle,
  { until = "2026-11-06", prefix = "RECETTE BPM" } = {},
) {
  const oldClock = process.env.SOCLE_TODAY;
  const report = {
    date: until,
    prefix,
    profiles: [],
    checks: [],
    events: [],
    ok: false,
  };
  const key = () => `recette-bpm-${randomUUID()}`;
  const P = socle.modules.bpm.projects,
    B = socle.modules.budget,
    C = socle.modules.core;
  const at = async (date, action) => {
    const saved = process.env.SOCLE_TODAY;
    process.env.SOCLE_TODAY = date;
    try {
      return await action();
    } finally {
      if (saved === undefined) delete process.env.SOCLE_TODAY;
      else process.env.SOCLE_TODAY = saved;
    }
  };
  const check = (name, observed, expected) =>
    report.checks.push({
      name,
      ok: JSON.stringify(observed) === JSON.stringify(expected),
      expected,
      observed,
    });
  const scenario = async (name, action) => {
    try {
      await action();
      report.events.push({ name, status: "played" });
    } catch (e) {
      report.checks.push({
        name,
        ok: false,
        expected: "Parcours réalisable",
        observed: { code: e.code, message: e.message },
      });
    }
  };
  const refusal = async (name, action, code) => {
    try {
      await action();
      check(name, "Autorisé", code);
    } catch (e) {
      check(name, e.code, code);
      report.events.push({
        name,
        status: "refused-as-expected",
        code: e.code,
        message: e.message,
      });
    }
  };
  const detail = (p) => P.projectDetail(p.ctx, p.coreProjectId);
  const user = async (suffix, anchorDay = 1, cycleStartDate = "2026-08-01") => {
    const label = `${prefix} · ${suffix} · ${until}`;
    const existing = Object.values(socle.state.users).find(
      (u) => u.label === label,
    );
    if (existing) {
      report.profiles.push({
        id: existing.id,
        label,
        existing: true,
        projects: [],
      });
      report.events.push({ name: label, status: "existing-preserved" });
      return null;
    }
    const u = await at("2026-08-01", () =>
      socle.modules.users.createUser({
        requestKey: key(),
        label,
        userType: "individuel",
        anchorDay,
        cycleStartDate,
        openingStock: 5000,
        openingDate: "2026-08-01",
        objective: 20000,
      }),
    );
    const ctx = { userId: u.userId };
    const profile = { id: u.userId, label, projects: [] };
    report.profiles.push(profile);
    if (anchorDay) {
      for (const month of ["08", "09", "10", "11"])
        await at(until, () =>
          B.createOperation(ctx, {
            requestKey: key(),
            direction: "income",
            label: `Salaire recette · ${month}/2026`,
            amount: 3000,
            date: `2026-${month}-01`,
            status: "realized",
            costCenterRef: "std:salaires",
          }),
        );
      await B.createRecurrence(ctx, {
        requestKey: key(),
        direction: "charge",
        label: "Loyer de référence · recette",
        amount: 650,
        cadence: "monthly",
        firstDate: "2026-08-01",
        costCenterRef: "std:logement",
      });
    }
    return { ctx, profile, bundle: u };
  };
  const project = async (
    u,
    title,
    amount = 500,
    allocationDate = "2026-09-01",
  ) => {
    const p = await at(allocationDate, () =>
      P.createProject(u.ctx, {
        requestKey: key(),
        title,
        description: `Recette fonctionnelle persistante : ${title}. Consulter les dates prévues et réelles ainsi que la prise en charge par le projet de vie.`,
        amount,
      }),
    );
    const tasks = [];
    for (const [i, label] of [
      "Préparer et demander",
      "Réaliser et régler",
      "Contrôler et terminer",
    ].entries()) {
      const t = await at(allocationDate, () =>
        P.createTask(u.ctx, {
          requestKey: key(),
          projectId: p.coreProjectId,
          title: `${i + 1}. ${label}`,
          description: title,
          plannedHours: (i + 1) * 3,
          spentHours: i,
          dueDate: i === 2 ? "2026-12-15" : null,
        }),
      );
      tasks.push(t.task.id);
    }
    const x = { ...p, ctx: u.ctx, tasks, title };
    u.profile.projects.push({
      id: p.coreProjectId,
      budgetId: p.budgetId,
      title,
      tasks,
    });
    // Deux prévisions par projet : tâches présentes mais non consommées, sans allocation automatique.
    for (const [i, date] of ["2026-11-20", "2026-12-15"].entries())
      await B.createOperation(u.ctx, {
        requestKey: key(),
        budgetId: p.budgetId,
        taskId: tasks[i + 1],
        direction: "charge",
        label: `${title} · prévision ${i + 1}`,
        amount: 15 + i * 10,
        date,
        status: "planned",
        costCenterRef: "std:loisirs",
      });
    return x;
  };
  const share = (p, amount, index = 0, extra = {}) =>
    P.setTaskShare(p.ctx, p.budgetId, p.tasks[index], {
      amount,
      expectedRevision: detail(p).budget.revision,
      ...extra,
    });
  const charge = (p, label, amount, date = until, extra = {}) =>
    B.createOperation(p.ctx, {
      requestKey: key(),
      budgetId: p.budgetId,
      taskId: p.tasks[0],
      direction: "charge",
      label,
      amount,
      date,
      status: "planned",
      costCenterRef: "std:loisirs",
      ...extra,
    });
  const paid = (
    p,
    label,
    amount,
    date = until,
    realizedDate = until,
    extra = {},
  ) =>
    charge(p, label, amount, date, {
      status: "realized",
      realizedDate,
      fund: true,
      ...extra,
    });
  const request = (p, amount, index = 0) =>
    P.requestTaskBudget(p.ctx, p.budgetId, p.tasks[index], {
      requestKey: key(),
      amount,
      note: `Demande de recette pour ${p.title}`,
    });
  const decide = (p, r, decision = "approve") =>
    P.decideTaskBudget(p.ctx, r.request.id, {
      decision,
      expectedRevision: r.request.revision,
      expectedBudgetRevision: detail(p).budget.revision,
    });
  try {
    process.env.SOCLE_TODAY = until;
    const dates = await user("01 Dates et cycles");
    if (dates) {
      await scenario(
        "D01 Parcours nominal, prix réellement payé différent du prévu",
        async () => {
          const p = await project(
            dates,
            "D01 · Achat nominal et écart de prix",
          );
          const op = await charge(p, "Achat prévu 100 €, payé 95 €", 100);
          await B.realizeOperation(p.ctx, op.operation.id, {
            expectedRevision: op.operation.revision,
            realizedDate: until,
            realizedAmount: 95,
            fund: true,
          });
          check(
            "D01 Réglé réel, prévu conservé",
            [
              detail(p).budget.paidCents,
              detail(p).charges.find((l) => l.operationId === op.operation.id)
                ?.plannedCents,
            ],
            [9500, 10000],
          );
        },
      );
      await scenario(
        "D02 Prévu dans trois cycles, réglé dès maintenant",
        async () => {
          const p = await project(dates, "D02 · Février payé en novembre");
          const op = await paid(
            p,
            "Matériel de février reçu en avance",
            123.45,
            "2027-02-03",
            until,
            { realizedAmount: 119.9 },
          );
          const line = socle.modules.bpm.reads.lineDetail(
            p.ctx,
            op.operation.id,
          );
          check(
            "D02 Cycles distincts explicités",
            [
              line.timing.plannedPeriod.key,
              line.timing.realizedPeriod.key,
              line.project.inclusion,
            ],
            ["2027-02", "2026-11", "included"],
          );
          check(
            "D02 Le poste explique le paiement anticipé",
            socle.modules.bpm.reads
              .centerDetail(p.ctx, "std:loisirs")
              .settledLines.some((l) => l.id === op.operation.id),
            true,
          );
        },
      );
      await scenario(
        "D03 Prévu maintenant, règlement antérieur ouvert",
        async () => {
          const p = await project(dates, "D03 · Novembre payé en octobre");
          await paid(
            p,
            "Achat prévu novembre, déjà payé octobre",
            80,
            "2026-11-20",
            "2026-10-28",
          );
          check(
            "D03 Cumul et cycle courant distincts",
            [detail(p).budget.paidCents, detail(p).budget.periodPaidCents],
            [8000, 0],
          );
          const oct = socle.modules.bpm.life.lifeManagement(p.ctx, {
            periodKey: "2026-10",
          });
          check(
            "D03 Projet dans la période historique du parent",
            oct.projects.projects.find(
              (l) => l.coreProjectId === p.coreProjectId,
            )?.periodPaidCents,
            8000,
          );
        },
      );
      await scenario("D04 Prévu autrefois, payé tardivement", async () => {
        const p = await project(dates, "D04 · Septembre réglé en novembre");
        await paid(
          p,
          "Facture de septembre réglée en retard",
          60,
          "2026-09-20",
        );
        check("D04 Paiement courant", detail(p).budget.periodPaidCents, 6000);
      });
      await scenario(
        "D05 Dépenses avant enveloppe puis attribution",
        async () => {
          const p = await project(
            dates,
            "D05 · Historique avant attribution",
            null,
          );
          // Avant l'attribution, un projet sans régime strict adopté peut conserver ses règlements.
          const core = await C.createCoreProject(p.ctx, {
            requestKey: key(),
            title: "D05 bis · Projet noyau historique adopté",
          });
          const adopted = await P.adoptProject(p.ctx, {
            requestKey: key(),
            coreProjectId: core.project.id,
          });
          const t = await P.createTask(p.ctx, {
            requestKey: key(),
            projectId: adopted.coreProjectId,
            title: "Dépenses avant puis après attribution",
          });
          const old = {
            ...adopted,
            ctx: p.ctx,
            tasks: [t.task.id],
            title: "D05 bis",
          };
          dates.profile.projects.push({
            id: adopted.coreProjectId,
            budgetId: adopted.budgetId,
            title: "D05 bis · Projet noyau historique adopté",
            tasks: old.tasks,
          });
          await paid(
            old,
            "Dépense historique hors enveloppe",
            70,
            "2026-10-20",
            "2026-10-20",
          );
          await at("2026-11-01", () =>
            P.allocate(old.ctx, old.budgetId, {
              amount: 200,
              expectedRevision: detail(old).budget.revision,
            }),
          );
          await paid(
            old,
            "Nouvelle dépense prise en charge",
            30,
            "2026-11-03",
            "2026-11-03",
          );
          check(
            "D05 Historique conservé, aucun financement rétroactif",
            [
              detail(old).budget.paidBeforeAllocationCents,
              detail(old).budget.paidCents,
            ],
            [7000, 3000],
          );
        },
      );
      await scenario("D06 Règlement antidaté avant enveloppe", async () => {
        const p = await project(
          dates,
          "D06 · Paiement antérieur à l’enveloppe",
          200,
          "2026-11-01",
        );
        const op = await paid(
          p,
          "Prévu maintenant, payé avant attribution",
          40,
          until,
          "2026-10-31",
        );
        check(
          "D06 Hors enveloppe, pas de part créée",
          [
            detail(p).budget.paidCents,
            detail(p).budget.paidBeforeAllocationCents,
            detail(p).budget.sharesCents,
          ],
          [0, 4000, 0],
        );
        check(
          "D06 Fiche explique exclusion",
          socle.modules.bpm.reads.lineDetail(p.ctx, op.operation.id).project
            .inclusion,
          "before-allocation",
        );
      });
      await scenario("D07 Replanifier une prévision sans payer", async () => {
        const p = await project(
          dates,
          "D07 · Prévision avancée au cycle courant",
        );
        const op = await charge(
          p,
          "Livraison de janvier avancée",
          49,
          "2027-01-15",
        );
        await B.updateOperation(p.ctx, op.operation.id, {
          expectedRevision: op.operation.revision,
          date: until,
        });
        check("D07 Replanifier ne dépense rien", detail(p).budget.paidCents, 0);
        await refusal(
          "D07 Une réalisation future indique son refus",
          () =>
            B.realizeOperation(p.ctx, op.operation.id, {
              expectedRevision:
                socle.state.operations[op.operation.id].revision,
              realizedDate: "2027-01-15",
              fund: true,
            }),
          "FUTURE_REALIZATION",
        );
      });
      await scenario("D08 Revenus à dates croisées", async () => {
        const p = await project(
          dates,
          "D08 · Revenu du projet et retour distinct",
        );
        await paid(p, "Acompte recette projet", 20);
        const income = await charge(
          p,
          "Revenu du projet non transféré au parent",
          35,
          until,
          {
            direction: "income",
            status: "realized",
            realizedDate: until,
            costCenterRef: "std:autresRevenus",
          },
        );
        check(
          "D08 Entrée du projet distinguée du parent",
          socle.modules.bpm.reads.lineDetail(p.ctx, income.operation.id).project
            .inclusion,
          "income",
        );
        await B.createOperation(p.ctx, {
          requestKey: key(),
          direction: "income",
          label: "Prime de décembre reçue en novembre",
          amount: 140,
          date: "2026-12-15",
          realizedDate: until,
          status: "realized",
          costCenterRef: "std:autresRevenus",
        });
        check(
          "D08 Revenus par date réelle",
          socle.modules.bpm.reads
            .incomes(p.ctx)
            .settledLines.some((l) => l.label.includes("Prime de décembre")),
          true,
        );
      });
    }

    const funding = await user("02 Enveloppes et décisions");
    if (funding) {
      await scenario("F01 Demande préparée avant enveloppe", async () => {
        const p = await project(
          funding,
          "F01 · Préparer avant financement",
          null,
        );
        const r = await request(p, 90);
        check(
          "F01 Demande conservée sans enveloppe",
          r.request.status,
          "pending",
        );
        await refusal(
          "F01 Validation avant enveloppe expliquée",
          () => decide(p, r),
          "FORBIDDEN_BY_RULE",
        );
      });
      await scenario(
        "F02 Demande dépassant enveloppe en attente du projet de vie",
        async () => {
          const p = await project(
            funding,
            "F02 · Accord du projet de vie attendu",
            100,
          );
          await decide(p, await request(p, 150));
          check(
            "F02 Le parent reçoit seulement le manque",
            [
              detail(p).requests[0].status,
              detail(p).budget.pendingOverrun.amountCents,
            ],
            ["awaiting-life", 5000],
          );
        },
      );
      await scenario(
        "F03 Dépassement refusé puis nouvelle demande",
        async () => {
          const p = await project(
            funding,
            "F03 · Refus et demande révisée",
            100,
          );
          await decide(p, await request(p, 130));
          const o = detail(p).budget.pendingOverrun;
          await P.decideOverrun(p.ctx, o.id, {
            decision: "refuse",
            expectedRevision: o.revision,
          });
          check(
            "F03 Refus sans part fantôme",
            [detail(p).requests[0].status, detail(p).budget.sharesCents],
            ["refused", 0],
          );
          await request(p, 80);
        },
      );
      await scenario("F04 Dépassement autorisé et règlement", async () => {
        const p = await project(
          funding,
          "F04 · Autoriser et régler sans double charge",
          100,
        );
        await decide(p, await request(p, 150));
        const o = detail(p).budget.pendingOverrun;
        await P.decideOverrun(p.ctx, o.id, {
          decision: "approve",
          expectedRevision: o.revision,
        });
        await paid(p, "Achat autorisé par le parent", 140);
        check(
          "F04 Autorisation sans double charge",
          [
            detail(p).budget.paidCents,
            detail(p).budget.sharesCents,
            detail(p).budget.approvedOverrunCents,
          ],
          [14000, 15000, 5000],
        );
      });
      await scenario(
        "F05 Dépassement exactement un centime, déjà facturé",
        async () => {
          const p = await project(
            funding,
            "F05 · Limite au centime et facturation",
            100,
          );
          await at("2026-10-20", () =>
            paid(p, "Dépense de 100,01 €", 100.01, "2026-10-20", "2026-10-20"),
          );
          await P.billOverruns(p.ctx, { budgetId: p.budgetId });
          check(
            "F05 Un centime facturé une seule fois",
            [
              detail(p).budget.allocationCents,
              detail(p).budget.billedOverrunCents,
              detail(p).budget.paidCents,
            ],
            [10001, 1, 10001],
          );
          await refusal(
            "F05 Rien à facturer une seconde fois",
            () => P.billOverruns(p.ctx, { budgetId: p.budgetId }),
            "FORBIDDEN_BY_RULE",
          );
          check(
            "F05 Rejouer la facturation ne double rien",
            detail(p).budget.allocationCents,
            10001,
          );
        },
      );
      await scenario(
        "F06 Baisse de part, baisse enveloppe et annulation",
        async () => {
          const p = await project(
            funding,
            "F06 · Réductions protégées et paiement annulé",
            200,
          );
          await share(p, 100);
          const op = await paid(p, "Paiement ensuite annulé", 60);
          await refusal(
            "F06 Part sous réglé refusée",
            () => share(p, 59.99),
            "FORBIDDEN_BY_RULE",
          );
          await refusal(
            "F06 Enveloppe sous parts refusée",
            () =>
              P.allocate(p.ctx, p.budgetId, {
                amount: 59.99,
                expectedRevision: detail(p).budget.revision,
              }),
            "FORBIDDEN_BY_RULE",
          );
          await B.cancelRealization(p.ctx, op.operation.id, {
            expectedRevision: op.operation.revision,
          });
          check(
            "F06 Annuler rend le paiement prévu",
            [detail(p).budget.paidCents, detail(p).budget.sharesCents],
            [0, 10000],
          );
        },
      );
      await scenario(
        "F07 Retour ponctuel, réouverture et reste à libérer",
        async () => {
          const p = await project(
            funding,
            "F07 · Terminer, rendre et rouvrir",
            200,
          );
          await share(p, 100);
          await paid(p, "Achat terminé", 60);
          await P.setTaskReturn(p.ctx, p.budgetId, p.tasks[0], {
            expectedRevision: detail(p).budget.revision,
            amount: 25,
            label: "Revente unique · F07",
            cadence: "once",
          });
          const status = (value) =>
            C.changeTaskStatus(p.ctx, p.tasks[0], {
              expectedRevision: socle.state.tasks[p.tasks[0]].revision,
              status: value,
            });
          await status("done");
          const ret = detail(p).budget.returns[p.tasks[0]];
          check(
            "F07 Retour créé prévu, sans faux encaissement",
            socle.state.operations[ret.entryId].status,
            "planned",
          );
          await refusal(
            "F07 Trace du retour déjà créé protégée",
            () =>
              P.setTaskReturn(p.ctx, p.budgetId, p.tasks[0], {
                expectedRevision: detail(p).budget.revision,
                amount: null,
              }),
            "FORBIDDEN_BY_RULE",
          );
          await status("todo");
          await status("done");
          check(
            "F07 Aucun doublon lors de la réouverture",
            Object.values(socle.state.operations).filter(
              (o) =>
                o.userId === p.ctx.userId && o.label === "Revente unique · F07",
            ).length,
            1,
          );
          await P.releaseTaskShare(p.ctx, p.budgetId, p.tasks[0], {
            expectedRevision: detail(p).budget.revision,
          });
          check(
            "F07 Part inutilisée rendue",
            detail(p).tasks.find((t) => t.task.id === p.tasks[0]).budget
              .shareCents,
            6000,
          );
        },
      );
      await scenario(
        "F08 Rattacher tâche libre et protéger liens financiers",
        async () => {
          const p = await project(
            funding,
            "F08 · Rattachement et liens financiers",
            100,
          );
          const free = await P.createTask(p.ctx, {
            requestKey: key(),
            title: "Tâche libre rattachable",
          });
          await C.attachTask(p.ctx, free.task.id, {
            expectedRevision: free.task.revision,
            projectId: p.coreProjectId,
          });
          check(
            "F08 Rattachement direct à bonne destination",
            socle.state.tasks[free.task.id].projectId,
            p.coreProjectId,
          );
          await share(p, 10);
          await refusal(
            "F08 Tâche financée non détachable silencieusement",
            () =>
              C.detachTask(p.ctx, p.tasks[0], {
                expectedRevision: socle.state.tasks[p.tasks[0]].revision,
              }),
            "FORBIDDEN_BY_RULE",
          );
        },
      );
      await scenario("F09 Plafonds indépendants et catégorie", async () => {
        const budget = B.lifeBudgetOf(socle.state, funding.ctx.userId);
        await B.setCaps(funding.ctx, budget.id, {
          expectedRevision: budget.revision,
          caps: { "std:alimentation": 40, "std:loisirs": 300 },
        });
        const cat = await B.createCategory(funding.ctx, {
          requestKey: key(),
          label: "Courses de recette",
          costCenterRef: "std:alimentation",
          cap: 30,
        });
        await B.createOperation(funding.ctx, {
          requestKey: key(),
          direction: "charge",
          label: "Courses : plafond dépassé mais achat autorisé",
          amount: 45,
          date: until,
          status: "realized",
          costCenterRef: "std:alimentation",
          categoryId: cat.category.id,
        });
        const review = socle.modules.bpm.reads.capsReview(funding.ctx);
        check(
          "F09 Centre et catégorie tous deux dépassés",
          [
            review.centers.find((r) => r.ref === "std:alimentation").over,
            review.categories.find((r) => r.id === cat.category.id).over,
          ],
          [true, true],
        );
      });
    }

    const cycles = await user("03 Ancrage au 15 et clôtures", 15, "2026-08-15");
    if (cycles) {
      await scenario(
        "C01 Paiements aux deux côtés du jour d’ancrage",
        async () => {
          const p = await project(
            cycles,
            "C01 · Frontière du 14 et du 15",
            500,
            "2026-08-15",
          );
          await paid(p, "Réglé le 14 octobre", 14, "2026-10-20", "2026-10-14");
          await paid(p, "Réglé le 15 octobre", 15, "2026-10-20", "2026-10-15");
          const a = socle.modules.bpm.life.lifeManagement(p.ctx, {
            periodKey: "2026-09",
          });
          const b = socle.modules.bpm.life.lifeManagement(p.ctx, {
            periodKey: "2026-10",
          });
          check(
            "C01 Le 14 et le 15 ne partagent pas le même cycle",
            [a.projects.periodPaidCents, b.projects.periodPaidCents],
            [1400, 1500],
          );
        },
      );
      await scenario(
        "C02 Mensuel au 31, occurrence courte et règlement tardif",
        async () => {
          const p = await project(
            cycles,
            "C02 · Mensuel au 31, fin de mois courte",
            500,
            "2026-08-15",
          );
          const r = await B.createRecurrence(p.ctx, {
            requestKey: key(),
            budgetId: p.budgetId,
            taskId: p.tasks[0],
            direction: "charge",
            label: "Abonnement projet du 31",
            amount: 30,
            cadence: "monthly",
            firstDate: "2026-08-31",
            endDate: "2026-12-31",
            costCenterRef: "std:loisirs",
          });
          check(
            "C02 Septembre se termine au 30",
            occurrenceDates(r.recurrence, "2026-09-01", "2026-09-30"),
            ["2026-09-30"],
          );
          await B.settleOccurrence(p.ctx, r.recurrence.id, {
            requestKey: key(),
            occurrenceDate: "2026-09-30",
            realizedDate: until,
            fund: true,
          });
          check(
            "C02 Paiement tardif dans cycle octobre au 15",
            detail(p).budget.periodPaidCents,
            3000,
          );
          await refusal(
            "C02 Occurrence déjà réglée non doublée",
            () =>
              B.settleOccurrence(p.ctx, r.recurrence.id, {
                requestKey: key(),
                occurrenceDate: "2026-09-30",
                realizedDate: until,
                fund: true,
              }),
            "ALREADY_SETTLED",
          );
        },
      );
      await scenario("C03 Retour récurrent puis tâche réouverte", async () => {
        const p = await project(
          cycles,
          "C03 · Retour récurrent sans doublon",
          150,
          "2026-08-15",
        );
        await paid(p, "Investissement de la tâche", 70);
        await P.setTaskReturn(p.ctx, p.budgetId, p.tasks[0], {
          expectedRevision: detail(p).budget.revision,
          amount: 20,
          label: "Économie mensuelle · C03",
          cadence: "monthly",
        });
        for (const status of ["done", "doing", "done"])
          await C.changeTaskStatus(p.ctx, p.tasks[0], {
            expectedRevision: socle.state.tasks[p.tasks[0]].revision,
            status,
          });
        check(
          "C03 Une seule définition de retour",
          Object.values(socle.state.recurrences).filter(
            (r) =>
              r.userId === p.ctx.userId &&
              r.label === "Économie mensuelle · C03",
          ).length,
          1,
        );
      });
      await scenario(
        "C04 Clôture protégée puis règlement d’une ancienne échéance",
        async () => {
          const p = await project(
            cycles,
            "C04 · Clôture conservée et règlement tardif",
            400,
            "2026-08-15",
          );
          const r = await B.createRecurrence(p.ctx, {
            requestKey: key(),
            budgetId: p.budgetId,
            taskId: p.tasks[0],
            direction: "charge",
            label: "Facture de septembre réglable après clôture",
            amount: 25,
            cadence: "monthly",
            firstDate: "2026-08-20",
            endDate: "2026-12-20",
            costCenterRef: "std:loisirs",
          });
          for (const periodKey of ["2026-08", "2026-09"])
            await socle.modules.bpm.closePeriod(p.ctx, {
              requestKey: key(),
              periodKey,
            });
          const before = socle.modules.bpm.figure(p.ctx, "bpm.charges", {
            periodKey: "2026-09",
          }).value;
          await B.settleOccurrence(p.ctx, r.recurrence.id, {
            requestKey: key(),
            occurrenceDate: "2026-09-20",
            realizedDate: until,
            fund: true,
          });
          check(
            "C04 Chiffre de clôture inchangé",
            socle.modules.bpm.figure(p.ctx, "bpm.charges", {
              periodKey: "2026-09",
            }).value,
            before,
          );
          await refusal(
            "C04 Antidater dans période close refusé clairement",
            () =>
              B.settleOccurrence(p.ctx, r.recurrence.id, {
                requestKey: key(),
                occurrenceDate: "2026-08-20",
                realizedDate: "2026-09-01",
                fund: true,
              }),
            "PERIOD_CLOSED",
          );
        },
      );
    }
    const empty = await user("04 Démarrage sans cycle", null, null);
    if (empty) {
      const p = await project(
        empty,
        "S01 · Préparer un projet sans cycle",
        null,
      );
      await request(p, 100);
      check(
        "S01 Budget inconnu distinct de zéro",
        detail(p).budget.allocationCents,
        null,
      );
    }
    report.ok =
      report.checks.length > 0 &&
      report.profiles.every((u) => !u.existing) &&
      report.checks.every((c) => c.ok);
    return report;
  } finally {
    if (oldClock === undefined) delete process.env.SOCLE_TODAY;
    else process.env.SOCLE_TODAY = oldClock;
  }
}
