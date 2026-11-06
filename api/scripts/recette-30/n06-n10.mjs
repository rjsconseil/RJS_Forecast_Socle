// Recette « 30 cas » · groupes N06 à N10 : projet de vie avec projets de la vie.
// Chaque cas joue un budget de vie complet sur trois cycles clos, plus le cycle en cours, et ses projets.
import { lifeLines, oneOffs, allocate, share, release, taskReturn, returnEntry, status, time, dayOf } from "./kit.mjs";
import { cents } from "./engine.mjs";

const budgetOf = (t, project) => t.socle.state.budgets[t.projects[project].budgetId];
const fundingOf = (t, project) => t.P.projectDetail(t.ctx, t.projects[project].coreProjectId).budget;
const taskBudgetOf = (t, project, task) => t.P.projectDetail(t.ctx, t.projects[project].coreProjectId).tasks.find((x) => (x.task?.id ?? x.id) === t.projects[project].tasks[task])?.budget ?? null;
const coreOf = (t, project) => t.C.readProjectDetail(t.ctx, t.projects[project].coreProjectId);

// ————— N06 · Salarié avec un projet « Vacances » —————
const n06Lines = [
  ["Salaire", "income", 2300, "std:salaires", 1],
  ["Loyer", "charge", 720, "std:logement", 5],
  ["Énergie", "charge", 70, "std:logement", 8],
  ["Mutuelle", "charge", 45, "std:sante", 6],
  ["Courses", "charge", 80, "std:alimentation", 2, { cadence: "weekly", variation: [0, 7, -6, 3] }],
  ["Transports", "charge", 60, "std:transport", 3],
];
const VAC = "Vacances";
const n06 = (id, title, particularity, extra = {}) => ({
  id,
  group: "N06",
  title,
  particularity,
  userType: "individuel",
  openingStock: 6000,
  objective: 15000,
  setup: async (t) => lifeLines(t, n06Lines),
  play: (t) => {
    oneOffs(t, { 0: [["Cadeau d'anniversaire", 60, "std:loisirs", 12]], 2: [["Cinéma", 24, "std:loisirs", 17]], 3: [["Pharmacie", 18, "std:sante", 2]] });
    t.project(VAC, {
      date: "2026-08-03",
      title: "Vacances en Bretagne",
      amount: 1500,
      tasks: [
        { key: "train", title: "Train aller-retour", plannedHours: 2 },
        { key: "gite", title: "Location du gîte", plannedHours: 1 },
        { key: "activites", title: "Activités sur place", plannedHours: 3 },
      ],
    });
    allocate(t, VAC, 1500, "2026-08-05");
    share(t, VAC, "train", 300, "2026-08-05");
    share(t, VAC, "gite", 900, "2026-08-05");
    share(t, VAC, "activites", 300, "2026-08-05");
    t.operation("Billets de train", { project: VAC, task: "train", amount: 280, center: "std:transport", date: "2026-08-20" });
    status(t, VAC, "train", "done", "2026-08-21");
    time(t, VAC, "train", { spentHours: 1.5 }, "2026-08-21");
    t.operation("Gîte · acompte", { project: VAC, task: "gite", amount: 450, center: "std:logement", date: "2026-09-02" });
    extra.play?.(t);
  },
  verify: extra.verify,
});

export const N06 = [
  n06("N06-V1", "Salarié + vacances · projet terminé en septembre, parts rendues", "Toutes les tâches sont terminées au cycle de septembre ; les parts non consommées reviennent à l'enveloppe, le projet de vie reste actif.", {
    play: (t) => {
      t.operation("Gîte · solde", { project: VAC, task: "gite", amount: 450, center: "std:logement", date: "2026-09-25" });
      status(t, VAC, "gite", "done", "2026-09-26");
      t.operation("Kayak de mer", { project: VAC, task: "activites", amount: 120, center: "std:loisirs", date: "2026-09-27" });
      status(t, VAC, "activites", "done", "2026-09-28");
      time(t, VAC, "activites", { spentHours: 4 }, "2026-09-28");
      release(t, VAC, "train", "2026-09-29");
      release(t, VAC, "activites", "2026-09-29");
      t.at("2026-10-02", "Lire les contrôles du projet terminé", () => {
        t.doneAdvice = t.P.projectDetail(t.ctx, t.projects[VAC].coreProjectId).checks.find((c) => c.code === "shares");
      });
      allocate(t, VAC, 1300, "2026-10-02", 2);
    },
    verify: (t) => {
      const core = coreOf(t, VAC);
      t.check("Projet terminé (état dérivé des tâches)", [core.view.status, core.view.completionPercent], ["done", 100]);
      t.check("Parts rendues : 20 € du train, 180 € des activités", [t.released?.[`${VAC}/train`], t.released?.[`${VAC}/activites`]], [2000, 18000]);
      const f = fundingOf(t, VAC);
      t.check("Projet terminé : le reste de l'enveloppe est à rendre, pas à répartir", [t.doneAdvice?.level, /Ramenez l’enveloppe à 1\s300,00\s€/.test(t.doneAdvice?.message ?? "")], ["info", true]);
      t.check("Enveloppe ramenée à 1 300 € : tout est réglé, rien ne reste", [budgetOf(t, VAC).allocationCents, f.paidCents, f.availableCents], [130000, 130000, 0]);
      t.check("Plus aucun contrôle à revoir sur le projet", t.P.projectDetail(t.ctx, t.projects[VAC].coreProjectId).checks.filter((c) => c.level === "warning").map((c) => c.code), []);
      const life = t.bpm.life.lifeManagement(t.ctx, { periodKey: "2026-11" });
      t.check("Volet projets : rien à décider, en règle", [life.projects.health, life.projects.pendingRequests.length], ["ok", 0]);
    },
  }),
  n06("N06-V2", "Salarié + vacances · dépassement autorisé puis facturé", "Le solde du gîte coûte 650 € au lieu de 450 € : un dépassement de 200 € est demandé, autorisé par le projet de vie, puis facturé en fin de cycle.", {
    play: (t) => {
      t.at("2026-09-24", "Demander un dépassement de 200 € pour le gîte", async () => {
        const b = budgetOf(t, VAC);
        const r = await t.P.requestOverrun(t.ctx, b.id, { requestKey: t.key(), reason: "ventilation", amount: 200, taskId: t.projects[VAC].tasks.gite, note: "Solde du gîte plus cher que prévu" });
        t.overrunId = r.overrun.id;
      });
      t.at("2026-09-24", "Le projet de vie autorise le dépassement", async () => {
        const x = t.socle.state.projectOverruns[t.overrunId];
        await t.P.decideOverrun(t.ctx, x.id, { expectedRevision: x.revision, decision: "approve" });
      }, 1.2);
      share(t, VAC, "gite", 1100, "2026-09-24", {}, 1.3);
      t.operation("Gîte · solde", { project: VAC, task: "gite", amount: 650, center: "std:logement", date: "2026-09-25" });
      t.at("2026-10-01", "Facturer les dépassements autorisés", () => t.P.billOverruns(t.ctx, { requestKey: t.key() }), 0.5);
      status(t, VAC, "gite", "done", "2026-09-26");
      t.operation("Kayak de mer", { project: VAC, task: "activites", amount: 120, center: "std:loisirs", date: "2026-10-05" });
      status(t, VAC, "activites", "doing", "2026-10-05");
    },
    verify: (t) => {
      const x = t.socle.state.projectOverruns[t.overrunId];
      t.check("Dépassement facturé", x?.status, "billed");
      t.check("Enveloppe portée à 1 700 €", budgetOf(t, VAC).allocationCents, 170000);
      const life = t.bpm.life.lifeManagement(t.ctx, { periodKey: "2026-11" });
      t.check("Plus rien à facturer ni à décider", [life.projects.billable.length, life.projects.pendingRequests.length, life.projects.deficitCount], [0, 0, 0]);
      t.check("Projet à finir (une tâche terminée, une en cours)", coreOf(t, VAC).view.status, "toFinish");
    },
  }),
  n06("N06-V3", "Salarié + vacances · excursion remboursée", "La sortie en bateau (90 €) est annulée par le prestataire et remboursée sur le projet dix jours plus tard.", {
    play: (t) => {
      t.operation("Gîte · solde", { project: VAC, task: "gite", amount: 450, center: "std:logement", date: "2026-09-25" });
      status(t, VAC, "gite", "done", "2026-09-26");
      t.operation("Sortie en bateau", { project: VAC, task: "activites", amount: 90, center: "std:loisirs", date: "2026-10-04" });
      status(t, VAC, "activites", "doing", "2026-10-04");
      t.at("2026-10-14", "Remboursement de la sortie en bateau", async () => {
        const b = budgetOf(t, VAC);
        const r = await t.B.createOperation(t.ctx, {
          requestKey: t.key(), budgetId: b.id, taskId: t.projects[VAC].tasks.activites, direction: "income", label: "Remboursement · sortie en bateau",
          amount: 90, date: "2026-10-14", status: "realized", realizedDate: "2026-10-14", costCenterRef: "std:autresRevenus",
        });
        t.refundId = r.operation.id;
        t.unbook("project", "charge", cents(90), "2026-10-14");
      });
    },
    verify: (t) => {
      const f = fundingOf(t, VAC);
      t.check("Projet : réglé net 1 180 € (remboursement déduit)", f.paidCents, 118000);
      t.check("Activités : réglé net 0 €", taskBudgetOf(t, VAC, "activites")?.paidCents ?? null, 0);
      const oct = t.bpm.life.lifeManagement(t.ctx, { periodKey: "2026-10" });
      t.check("Octobre : les projets ne coûtent plus rien au budget de vie", oct.cycle.flows.projectsPaidCents, 0);
    },
  }),
];

// ————— N07 à N10 : même budget de vie que N06, un projet générique, une particularité par cas —————
const PRJ = "Projet";
/** Cas dérivé de N06 : budget de vie N06 (+ lignes propres), un projet à deux tâches financé le 5 août. */
const derived = (group, id, title, particularity, o = {}) => ({
  id,
  group,
  title,
  particularity,
  userType: o.userType ?? "individuel",
  openingStock: 6000,
  objective: 15000,
  setup: async (t) => {
    lifeLines(t, n06Lines);
    for (const l of o.lines ?? []) lifeLines(t, [l]);
  },
  play: (t) => {
    t.project(PRJ, {
      date: "2026-08-03",
      title: o.project ?? "Projet de la vie",
      // Sans montant à la création : l'enveloppe est attribuée à sa date (createProject avec montant l'attribuerait aussitôt).
      amount: null,
      tasks: o.tasks ?? [
        { key: "a", title: o.taskA ?? "Première étape", plannedHours: 4 },
        { key: "b", title: o.taskB ?? "Seconde étape", plannedHours: 6 },
      ],
    });
    if (o.allocate !== false) {
      allocate(t, PRJ, o.amount ?? 1200, o.allocationDate ?? "2026-08-05");
      if (o.shares !== false) for (const [k, v] of Object.entries(o.shares ?? { a: (o.amount ?? 1200) / 2, b: (o.amount ?? 1200) / 2 })) share(t, PRJ, k, v, o.allocationDate ?? "2026-08-05");
    }
    o.play?.(t);
  },
  verify: o.verify,
});
const pay = (t, name, task, amount, date, extra = {}) => t.operation(name, { project: PRJ, task, amount, center: extra.center ?? "std:divers", date, ...extra });

export const N07 = [
  derived("N07", "N07-V1", "Couple + cuisine · part refusée puis réduite", "La demande de part de 900 € pour les meubles est refusée ; une demande réduite à 700 € est accordée.", {
    userType: "famille", project: "Rénovation de la cuisine", amount: 1400, taskA: "Meubles", taskB: "Plan de travail", shares: { b: 500 },
    lines: [["Salaire de Léa", "income", 1900, "std:salaires", 1]],
    play: (t) => {
      const req = (amount, date, decision) => {
        t.at(date, `Demander ${amount} € pour les meubles`, async () => {
          const b = budgetOf(t, PRJ);
          const r = await t.P.requestTaskBudget(t.ctx, b.id, t.projects[PRJ].tasks.a, { requestKey: t.key(), amount });
          (t.requests ??= []).push(r.request.id);
        });
        t.at(date, `Décider la demande de ${amount} €`, async () => {
          const id = t.requests.at(-1);
          const x = t.socle.state.taskBudgetRequests[id];
          await t.P.decideTaskBudget(t.ctx, id, { expectedRevision: x.revision, expectedBudgetRevision: budgetOf(t, PRJ).revision, decision });
        }, 1.2);
      };
      req(900, "2026-08-10", "refuse");
      req(700, "2026-08-12", "approve");
      pay(t, "Meubles de cuisine", "a", 680, "2026-09-08", { center: "std:logement" });
      pay(t, "Plan de travail", "b", 470, "2026-10-06", { center: "std:logement" });
    },
    verify: (t) => {
      const st = t.requests.map((id) => t.socle.state.taskBudgetRequests[id].status);
      t.check("Demandes : refusée puis accordée", st, ["refused", "approved"]);
      t.check("Part des meubles : 700 €", taskBudgetOf(t, PRJ, "a")?.shareCents, 70000);
      t.check("Enveloppe : 200 € encore à répartir", fundingOf(t, PRJ).availableCents, 20000);
    },
  }),
  derived("N07", "N07-V2", "Couple + voiture · enveloppe attribuée en septembre seulement", "Le contrôle technique est payé en août avant toute enveloppe : il reste hors du budget de vie ; l'enveloppe arrive le 2 septembre.", {
    userType: "famille", project: "Entretien de la voiture", amount: 900, taskA: "Contrôle technique", taskB: "Pneus", allocationDate: "2026-09-02",
    lines: [["Salaire de Léa", "income", 1900, "std:salaires", 1]],
    play: (t) => {
      pay(t, "Contrôle technique", "a", 85, "2026-08-18", { center: "std:transport", excluded: true, fund: false });
      pay(t, "Pneus neufs", "b", 420, "2026-09-15", { center: "std:transport" });
    },
    verify: (t) => {
      const f = fundingOf(t, PRJ);
      t.check("Réglé avant l'enveloppe : hors budget, mais visible", [f.paidCents, f.paidBeforeAllocationCents], [42000, 8500]);
      const aug = t.bpm.life.lifeManagement(t.ctx, { periodKey: "2026-08" });
      t.check("Août : le projet ne coûte rien au budget de vie", aug.cycle.flows.projectsPaidCents, 0);
    },
  }),
  derived("N07", "N07-V3", "Couple + deux projets · l'un sans enveloppe", "Un second projet « Voyage » est créé sans enveloppe : le volet projets le signale jusqu'à la fin.", {
    userType: "famille", project: "Rénovation de la cuisine", amount: 1000,
    lines: [["Salaire de Léa", "income", 1900, "std:salaires", 1]],
    play: (t) => {
      t.project("Voyage", { date: "2026-09-04", title: "Voyage à Lisbonne", amount: null, tasks: [{ key: "a", title: "Billets d'avion", plannedHours: 1 }] });
      pay(t, "Peinture", "a", 160, "2026-08-22", { center: "std:logement" });
    },
    verify: (t) => {
      const p = t.bpm.life.lifeManagement(t.ctx, { periodKey: "2026-11" }).projects;
      t.check("Volet projets : 2 projets, 1 sans enveloppe, à surveiller", [p.projectCount, p.unfundedCount, p.health], [2, 1, "watch"]);
    },
  }),
];

export const N08 = [
  derived("N08", "N08-V1", "Famille + panneaux solaires · retour mensuel", "La pose terminée le 10 septembre déclenche un retour mensuel de 45 € (revente d'électricité) vers le budget de vie.", {
    userType: "famille", project: "Panneaux solaires", amount: 3000, taskA: "Pose des panneaux", taskB: "Raccordement",
    play: (t) => {
      pay(t, "Panneaux et pose", "a", 1450, "2026-09-08", { center: "std:logement" });
      pay(t, "Raccordement", "b", 1300, "2026-09-09", { center: "std:logement" });
      taskReturn(t, PRJ, "a", { amount: 45, cadence: "monthly", label: "Revente d'électricité" }, "2026-09-01");
      status(t, PRJ, "b", "done", "2026-09-10");
      status(t, PRJ, "a", "done", "2026-09-10");
      for (const d of ["2026-09-10", "2026-10-10"])
        t.at(d, `Recevoir la revente du ${d}`, async () => {
          const e = returnEntry(t, PRJ, "a");
          await t.B.settleOccurrence(t.ctx, e.id, { requestKey: t.key(), occurrenceDate: d, realizedDate: d, realizedAmount: 45 });
          t.book("life", "income", 4500, d);
        }, 3);
      t.planned.push({ direction: "income", amountCents: 4500, date: "2026-11-10", settledBy: () => undefined });
    },
    verify: (t) => {
      const e = returnEntry(t, PRJ, "a");
      t.check("Retour créé en définition mensuelle", [e?.kind, t.socle.state.recurrences[e?.id]?.firstDate], ["recurrence", "2026-09-10"]);
      t.check("Projet terminé, projet de vie actif", coreOf(t, PRJ).view.status, "done");
    },
  }),
  derived("N08", "N08-V2", "Famille + panneaux solaires · prime ponctuelle reçue", "La prime à l'installation (350 €) est un retour ponctuel : prévu à la fin de la pose, reçu trois jours plus tard.", {
    userType: "famille", project: "Panneaux solaires", amount: 3000, taskA: "Pose des panneaux", taskB: "Raccordement",
    play: (t) => {
      pay(t, "Panneaux et pose", "a", 1450, "2026-09-08", { center: "std:logement" });
      taskReturn(t, PRJ, "a", { amount: 350, cadence: "once", label: "Prime à l'installation" }, "2026-09-01");
      status(t, PRJ, "a", "done", "2026-09-10");
      t.at("2026-09-13", "Recevoir la prime", async () => {
        const e = returnEntry(t, PRJ, "a");
        const op = t.socle.state.operations[e.id];
        await t.B.realizeOperation(t.ctx, e.id, { expectedRevision: op.revision, realizedDate: "2026-09-13", realizedAmount: 350 });
        t.book("life", "income", 35000, "2026-09-13");
      }, 3);
    },
    verify: (t) => {
      const e = returnEntry(t, PRJ, "a");
      t.check("Prime prévue le 10, reçue le 13 septembre", [t.socle.state.operations[e.id].date, t.socle.state.operations[e.id].realizedDate], ["2026-09-10", "2026-09-13"]);
    },
  }),
  derived("N08", "N08-V3", "Famille + panneaux solaires · tâche rouverte", "La pose est rouverte pour une reprise puis terminée à nouveau : le retour n'est pas créé une seconde fois.", {
    userType: "famille", project: "Panneaux solaires", amount: 3000, taskA: "Pose des panneaux", taskB: "Raccordement",
    play: (t) => {
      pay(t, "Panneaux et pose", "a", 1450, "2026-09-08", { center: "std:logement" });
      taskReturn(t, PRJ, "a", { amount: 350, cadence: "once", label: "Prime à l'installation" }, "2026-09-01");
      status(t, PRJ, "a", "done", "2026-09-10");
      status(t, PRJ, "a", "doing", "2026-09-20");
      status(t, PRJ, "a", "done", "2026-09-25");
      t.at("2026-09-26", "Recevoir la prime", async () => {
        const e = returnEntry(t, PRJ, "a");
        const op = t.socle.state.operations[e.id];
        await t.B.realizeOperation(t.ctx, e.id, { expectedRevision: op.revision, realizedDate: "2026-09-26" });
        t.book("life", "income", 35000, "2026-09-26");
      }, 3);
      t.at("2026-10-02", "Reconfigurer le retour", () =>
        t.refusal("Modifier un retour déjà enregistré est refusé", () => {
          const b = budgetOf(t, PRJ);
          return t.P.setTaskReturn(t.ctx, b.id, t.projects[PRJ].tasks.a, { expectedRevision: b.revision, amount: 500 });
        }, "FORBIDDEN_BY_RULE"));
    },
    verify: (t) => {
      const n = Object.values(t.socle.state.operations).filter((o) => o.userId === t.userId && o.label === "Prime à l'installation").length;
      t.check("Une seule prime dans le budget de vie", n, 1);
    },
  }),
];

export const N09 = [
  derived("N09", "N09-V1", "Étudiant + permis · temps dépassé", "Le code et la conduite prennent 34 h pour 24 h prévues : les agrégats de temps du projet le montrent.", {
    project: "Permis de conduire", amount: 1200, tasks: [{ key: "a", title: "Code de la route", plannedHours: 10 }, { key: "b", title: "Heures de conduite", plannedHours: 14 }],
    play: (t) => {
      pay(t, "Forfait code", "a", 300, "2026-08-10", { center: "std:transport" });
      pay(t, "Leçons de conduite", "b", 600, "2026-09-10", { center: "std:transport" });
      time(t, PRJ, "a", { spentHours: 13 }, "2026-08-30");
      time(t, PRJ, "b", { spentHours: 21 }, "2026-10-20");
      status(t, PRJ, "a", "done", "2026-08-30");
      status(t, PRJ, "b", "doing", "2026-09-10");
    },
    verify: (t) => {
      const v = coreOf(t, PRJ).view.time;
      t.check("Temps : 34 h passées pour 24 h prévues, 142 %", [v.spentHoursTotal, v.plannedHoursKnown, v.plannedIsPartial, Math.round(v.spentToPlannedPercent)], [34, 24, false, 142]);
    },
  }),
  derived("N09", "N09-V2", "Étudiant + permis · leçons mensuelles", "Les leçons sont une charge récurrente du projet (150 € par mois d'août à octobre).", {
    project: "Permis de conduire", amount: 1200,
    play: (t) => t.recurrence("Leçons mensuelles", { direction: "charge", amount: 150, center: "std:transport", cadence: "monthly", firstDate: "2026-08-15", endDate: "2026-10-15" }, { project: PRJ, task: "b", createAt: "2026-08-06" }),
    verify: (t) => t.check("Trois leçons réglées sur la tâche", taskBudgetOf(t, PRJ, "b")?.paidCents, 45000),
  }),
  derived("N09", "N09-V3", "Étudiant + permis · estimations manquantes", "Une tâche n'a pas d'estimation de temps : le temps prévu reste partiel, jamais compté à zéro.", {
    project: "Permis de conduire", amount: 1200, tasks: [{ key: "a", title: "Code de la route", plannedHours: 10 }, { key: "b", title: "Heures de conduite" }],
    play: (t) => {
      time(t, PRJ, "a", { spentHours: 8 }, "2026-09-01");
      time(t, PRJ, "b", { spentHours: 5 }, "2026-10-01");
      pay(t, "Forfait code", "a", 300, "2026-08-10", { center: "std:transport" });
    },
    verify: (t) => {
      const v = coreOf(t, PRJ).view.time;
      t.check("Temps prévu partiel : 10 h connues, 1 estimation manquante, pas de % trompeur", [v.plannedHoursKnown, v.spentHoursTotal, v.plannedIsPartial, v.missingEstimateCount, v.spentToPlannedPercent], [10, 13, true, 1, null]);
    },
  }),
];

export const N10 = [
  derived("N10", "N10-V1", "Ménage + gros travaux · paiements concentrés", "Toutes les factures des travaux (2 300 €) tombent en septembre : le cycle clôture négatif.", {
    project: "Travaux de la salle de bain", amount: 2400,
    play: (t) => {
      pay(t, "Plomberie", "a", 1200, "2026-09-12", { center: "std:logement" });
      pay(t, "Carrelage", "b", 1100, "2026-09-20", { center: "std:logement" });
    },
    verify: (t) => {
      const sep = t.bpm.life.lifeManagement(t.ctx, { periodKey: "2026-09" }).cycle;
      t.check("Septembre clôturé négatif, signalé", [sep.closedResultCents < 0, sep.health], [true, "watch"]);
    },
  }),
  derived("N10", "N10-V2", "Ménage + projet · une branche terminée, l'autre bloquée", "La première étape est terminée, la seconde passe « à prioriser » : le projet est « à reprendre ».", {
    project: "Jardin", amount: 800,
    play: (t) => {
      pay(t, "Plantes", "a", 220, "2026-08-25", { center: "std:divers" });
      status(t, PRJ, "a", "done", "2026-08-26");
      status(t, PRJ, "b", "blocked", "2026-09-05");
    },
    verify: (t) => t.check("Projet à reprendre (J1)", coreOf(t, PRJ).view.status, "toResume"),
  }),
  derived("N10", "N10-V3", "Ménage + projet · paiement antidaté dans une période close", "En novembre, une facture d'août est saisie à sa date : la période close la refuse.", {
    project: "Jardin", amount: 800,
    play: (t) => {
      pay(t, "Plantes", "a", 220, "2026-08-25", { center: "std:divers" });
      t.at("2026-11-05", "Saisir une facture d'août", () =>
        t.refusal("Facture datée dans une période close refusée", () => t.B.createOperation(t.ctx, { requestKey: t.key(), direction: "charge", label: "Facture oubliée", amount: 60, date: "2026-08-20", status: "realized", realizedDate: "2026-08-20", costCenterRef: "std:divers" }), "PERIOD_CLOSED"));
    },
  }),
];

export const GROUPS = { N06, N07, N08, N09, N10 };
