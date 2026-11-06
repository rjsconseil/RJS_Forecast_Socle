// Groupes N01 à N05 : projet de vie seul, sans projet de la vie.
import { lifeLines, oneOffs, category, caps, dayOf } from "./kit.mjs";
import { addDays, cents } from "./engine.mjs";

// ————— N01 · Célibataire salarié —————
const n01Lines = (o = {}) => [
  ["Salaire", "income", 2400, "std:salaires", 1, o.salary ?? {}],
  ["Loyer", "charge", 750, "std:logement", 5],
  ["Électricité", "charge", 60, "std:logement", 10],
  ["Box et mobile", "charge", 45, "std:divers", 12],
  ["Pass transport", "charge", 86.4, "std:transport", 2],
  ["Mutuelle", "charge", 40, "std:sante", 15],
  ["Courses", "charge", 85, "std:alimentation", 2, { cadence: "weekly", variation: [-6, 0, 9, -3] }],
];
const n01OneOffs = {
  0: [["Restaurant entre amis", 48, "std:loisirs", 9], ["Cinéma", 22, "std:loisirs", 20]],
  1: [["Concert", 65, "std:loisirs", 14]],
  2: [["Week-end à la mer", 180, "std:loisirs", 17]],
  3: [["Pharmacie", 18.5, "std:sante", 3], ["Cadeau d'anniversaire", 60, "std:loisirs", 20, { realizedDate: null }]],
};
const n01 = (id, title, particularity, extra = {}) => ({
  id,
  group: "N01",
  title,
  particularity,
  userType: "individuel",
  anchorDay: extra.anchorDay ?? 1,
  openingStock: 3000,
  objective: 10000,
  setup: (t) => lifeLines(t, n01Lines(extra)),
  play: (t) => {
    oneOffs(t, n01OneOffs);
    extra.play?.(t);
  },
  verify: extra.verify,
});

export const N01 = [
  n01("N01-V1", "Célibataire salarié · salaire versé en avance", "L'employeur verse le salaire le 28 du mois précédent à partir du 2e cycle.", {
    salary: {
      settle: (date) => (date.endsWith("-01") && date > "2026-08-01" ? { realizedDate: addDays(date, -4) } : { realizedDate: date }),
    },
    verify: (t) => {
      const opId = t.recs["Salaire"].ops.get("2026-11-01");
      const line = t.bpm.reads.lineDetail(t.ctx, opId);
      t.check("Salaire de novembre reçu en octobre", [line.timing.plannedPeriod.key, line.timing.realizedPeriod.key], ["2026-11", "2026-10"]);
      t.check("Novembre : rien reçu, rien à recevoir", [t.figure("bpm.revenus", "2026-11"), t.figure("bpm.resteARecevoir", "2026-11")], [0, 0]);
      t.check("Novembre : salaire reçu d'avance nommé", t.figure("bpm.recuAvance", "2026-11"), 2400);
      t.check("Novembre : solde avances comprises", Math.round(t.figure("bpm.soldeAvecAvances", "2026-11") * 100), Math.round(t.figure("bpm.soldeAttendu", "2026-11") * 100) + 240000);
      const life = t.bpm.life.lifeManagement(t.ctx, {});
      t.check("Novembre : le volet explique le solde négatif par l'avance", [life.cycle.health, /reçus d’avance/.test(life.cycle.alert ?? "")], ["watch", true]);
    },
  }),
  n01("N01-V2", "Célibataire salarié · réparation imprévue", "Une réparation de 1 450 € au 2e cycle rend le résultat négatif.", {
    play: (t) => oneOffs(t, { 1: [["Réparation du scooter", 1450, "std:transport", 18]] }),
    verify: (t) => {
      const [p1, p2] = t.cycles;
      t.check("Résultat du 2e cycle négatif", t.expected(p2.key).resultCents < 0, true);
      t.check("Taux d'épargne négatif affiché", t.figure("bpm.tauxEpargne", p2.key) < 0, true);
      t.check("Le patrimoine baisse après le 2e cycle", t.stockAfter(1) < t.stockAfter(0), true);
    },
  }),
  n01("N01-V3", "Célibataire salarié · cycle ancré au 25", "Le cycle démarre le 25, jour de paie.", {
    anchorDay: 25,
    verify: (t) => {
      t.check("Cycles du 25 au 24", t.cycles.map((c) => [c.key, c.start, c.end]), [
        ["2026-07", "2026-07-25", "2026-08-24"],
        ["2026-08", "2026-08-25", "2026-09-24"],
        ["2026-09", "2026-09-25", "2026-10-24"],
        ["2026-10", "2026-10-25", "2026-11-24"],
      ]);
      t.check("Cycle en cours du site", t.bpm.dashboard(t.ctx).period.key, "2026-10");
    },
  }),
];

// ————— N02 · Couple sans enfant —————
const n02Lines = (o = {}) => [
  ["Salaire d'Alex", "income", 2600, "std:salaires", 1],
  ["Salaire de Sam", "income", 2100, "std:salaires", 3, o.sam ?? {}],
  ["Loyer", "charge", 1150, "std:logement", 5, o.rent ?? {}],
  ["Énergie", "charge", 95, "std:logement", 8],
  ["Internet", "charge", 40, "std:divers", 12],
  ["Assurance auto", "charge", 70, "std:transport", 10],
  ["Courses", "charge", 140, "std:alimentation", 4, { cadence: "weekly", variation: [-12, 5, 18, -4] }],
  ["Salle de sport", "charge", 60, "std:loisirs", 15],
];
const n02OneOffs = {
  0: [["Carburant d'août", 65, "std:transport", 9], ["Restaurant", 72, "std:loisirs", 21]],
  1: [["Carburant de septembre", 70, "std:transport", 10], ["Cadeau de mariage", 150, "std:loisirs", 19]],
  2: [["Carburant d'octobre", 58, "std:transport", 8], ["Week-end en amoureux", 240, "std:loisirs", 24]],
  3: [["Carburant de novembre", 62, "std:transport", 2], ["Révision de la voiture", 180, "std:transport", 20, { realizedDate: null }]],
};
const n02 = (id, title, particularity, extra = {}) => ({
  id,
  group: "N02",
  title,
  particularity,
  userType: "famille",
  openingStock: 8000,
  objective: 25000,
  setup: async (t) => {
    lifeLines(t, n02Lines(extra));
    await extra.setup?.(t);
  },
  play: (t) => {
    oneOffs(t, n02OneOffs);
    extra.play?.(t);
  },
  verify: extra.verify,
});

export const N02 = [
  n02("N02-V1", "Couple sans enfant · baisse de salaire au 3e cycle", "Le salaire de Sam passe de 2 100 € à 1 600 € à partir d'octobre (temps partiel).", {
    sam: { settle: (date) => ({ realizedDate: date, realizedAmount: date >= "2026-10-01" ? 1600 : 2100 }) },
    play: (t) =>
      t.at("2026-10-01", "Passer le salaire de Sam à 1 600 €", async () => {
        const rec = t.socle.state.recurrences[t.recs["Salaire de Sam"].id];
        const r = await t.B.updateRecurrence(t.ctx, rec.id, { expectedRevision: rec.revision, amount: 1600 });
        t.check("La modification ne touche que les échéances attendues", r.scope.settledUntouched, 2);
      }),
    verify: (t) => {
      const ops = [...t.recs["Salaire de Sam"].ops.values()].map((id) => t.socle.state.operations[id]);
      t.check("Règlements d'août et septembre conservés à 2 100 €", ops.filter((o) => o.occurrenceDate < "2026-10-01").map((o) => o.realizedAmountCents), [210000, 210000]);
      t.check("Revenus prévus de novembre au nouveau montant", t.figure("bpm.revenusPrevus", "2026-11"), 4200);
      const bt = t.bpm.reads.budgetType(t.ctx);
      const sam = bt.lines.find((l) => l.label === "Salaire de Sam");
      t.check("Budget type au nouveau montant", sam?.amountCents, 160000);
    },
  }),
  n02("N02-V2", "Couple sans enfant · loyer de septembre payé en octobre", "Le loyer de septembre est réglé le 3 octobre, après la clôture de septembre.", {
    rent: { settle: (date) => ({ realizedDate: date === "2026-09-05" ? "2026-10-03" : date }) },
    verify: (t) => {
      const op = t.socle.state.operations[t.recs["Loyer"].ops.get("2026-09-05")];
      const line = t.bpm.reads.lineDetail(t.ctx, op.id);
      t.check("Loyer de septembre : prévu en septembre, réglé en octobre", [line.timing.plannedPeriod.key, line.timing.realizedPeriod.key], ["2026-09", "2026-10"]);
      const oct = t.bpm.life.lifeManagement(t.ctx, { periodKey: "2026-10" });
      t.check("Octobre explique le second loyer réglé pour un autre cycle", oct.natures.indispensable.otherCyclePaidCents, 115000);
      const sep = t.socle.state.closures[Object.values(t.socle.state.closures).find((c) => c.periodKey === "2026-09" && c.budgetId === t.B.lifeBudgetOf(t.socle.state, t.userId).id).id];
      const toPay = sep.figures.find?.((f) => f.key === "bpm.resteAPayer") ?? sep.figures["bpm.resteAPayer"];
      t.check("La clôture de septembre a figé le loyer encore à payer", Math.round((toPay?.value ?? NaN) * 100), 115000);
    },
  }),
  n02("N02-V3", "Couple sans enfant · plafonds dépassés en septembre", "Plafonds : alimentation 800 €, loisirs 150 € ; un concert fait dépasser les loisirs en septembre.", {
    setup: (t) => caps(t, { "std:alimentation": 800, "std:loisirs": 150 }),
    play: (t) => oneOffs(t, { 1: [["Concert", 95, "std:loisirs", 12]] }),
    verify: (t) => {
      const over = (key, ref) => t.bpm.reads.capsReview(t.ctx, { period: key }).centers.find((c) => c.ref === ref)?.over;
      t.check("Loisirs dépassés en septembre (concert) et octobre (week-end)", t.cycles.map((c) => over(c.key, "std:loisirs")), [false, true, true, false]);
      t.check("Alimentation sous son plafond", t.cycles.map((c) => over(c.key, "std:alimentation")), [false, false, false, false]);
      const sep = t.bpm.life.lifeManagement(t.ctx, { periodKey: "2026-09" });
      t.check("Volet des charges courantes de septembre à traiter", sep.natures.courante.health, "alert");
    },
  }),
];

// ————— N03 · Famille avec deux enfants —————
const n03Lines = (o = {}) => [
  ["Salaire de Claire", "income", 2900, "std:salaires", 1],
  ["Salaire de Malik", "income", 1800, "std:salaires", 2],
  ["Allocations familiales", "income", 140, "std:allocations", 5, o.caf ?? {}],
  ["Loyer", "charge", 1300, "std:logement", 5],
  ["Énergie", "charge", 130, "std:logement", 9],
  ["Cantine", "charge", 110, "std:enfants", 10, { category: o.categories ? "Cantine" : undefined }],
  ["Activités des enfants", "charge", 60, "std:enfants", 12, { category: o.categories ? "Activités sportives" : undefined }],
  ["Courses", "charge", 190, "std:alimentation", 3, { cadence: "weekly", variation: [-15, 10, 22, -8] }],
  ["Transports", "charge", 120, "std:transport", 2],
];
const n03OneOffs = (o = {}) => ({
  0: [["Pharmacie", 32, "std:sante", 7], ["Sortie au zoo", 85, "std:loisirs", 16]],
  1: [["Fournitures de rentrée", 180, "std:enfants", 2, { category: o.categories ? "Fournitures scolaires" : undefined }], ["Médecin", 25, "std:sante", 14]],
  2: [["Vêtements des enfants", 140, "std:enfants", 11], ["Anniversaire", 90, "std:loisirs", 22]],
  3: [["Pharmacie de novembre", 21, "std:sante", 4], ["Sortie scolaire", 25, "std:enfants", 18, { realizedDate: null }]],
});
const n03 = (id, title, particularity, extra = {}) => ({
  id,
  group: "N03",
  title,
  particularity,
  userType: "famille",
  openingStock: 5000,
  objective: 20000,
  setup: async (t) => {
    await extra.setup?.(t);
    lifeLines(t, n03Lines(extra));
    for (const l of extra.lines ?? []) lifeLines(t, [l]);
  },
  play: (t) => {
    oneOffs(t, n03OneOffs(extra));
    extra.play?.(t);
  },
  verify: extra.verify,
});

export const N03 = [
  n03("N03-V1", "Famille · catégories plafonnées pour les enfants", "Trois catégories du poste « Enfants » ont un plafond : cantine 100 €, fournitures 150 €, activités 80 €.", {
    categories: true,
    setup: async (t) => {
      await category(t, "Cantine", { center: "std:enfants", cap: 100 });
      await category(t, "Fournitures scolaires", { center: "std:enfants", cap: 150 });
      await category(t, "Activités sportives", { center: "std:enfants", cap: 80 });
    },
    verify: (t) => {
      const over = (key) => Object.fromEntries(t.bpm.reads.capsReview(t.ctx, { period: key }).categories.map((k) => [k.label, k.over]).sort((a, z) => a[0].localeCompare(z[0])));
      t.check("Septembre : cantine et fournitures dépassées, activités dans le plafond", over("2026-09"), { "Activités sportives": false, Cantine: true, "Fournitures scolaires": true });
      t.check("Août : seule la cantine dépasse", over("2026-08"), { "Activités sportives": false, Cantine: true, "Fournitures scolaires": false });
      const life = t.bpm.life.lifeManagement(t.ctx, { periodKey: "2026-09" });
      t.check("Le poste Enfants sans plafond n'est pas dépassé lui-même", life.natures.courante.rows?.find?.((r) => r.ref === "std:enfants")?.over ?? false, false);
    },
  }),
  n03("N03-V2", "Famille · allocations de septembre jamais versées", "La CAF ne verse pas les allocations de septembre ; la période est close sans elles.", {
    caf: { settle: (date) => (date === "2026-09-05" ? null : { realizedDate: date }) },
    verify: (t) => {
      const due = t.bpm.reads.due(t.ctx);
      const left = due.lines.filter((l) => l.status === "unrealized" && l.direction === "income");
      t.check("L'allocation de septembre reste visible parmi les non réglées des cycles clos", left.map((l) => [l.label, l.plannedDate, l.plannedCents]), [["Allocations familiales", "2026-09-05", 14000]]);
      t.check("Elle ne gonfle pas le solde net des échéances à traiter", [due.unrealizedCount, due.unrealizedNetCents, due.lines.filter((l) => l.status !== "unrealized").every((l) => l.plannedDate >= "2026-11-01")], [1, 14000, true]);
    },
  }),
  n03("N03-V3", "Famille · assurance habitation annuelle", "Une assurance habitation de 420 € tombe une fois par an, le 15 septembre.", {
    lines: [["Assurance habitation", "charge", 420, "std:logement", 0, { cadence: "yearly", firstDate: "2026-09-15" }]],
    verify: (t) => {
      const paid = (key) => t.bpm.reads.centerDetail(t.ctx, "std:logement", { period: key }).settledLines?.filter((l) => l.label === "Assurance habitation").length ?? null;
      t.check("Assurance réglée en septembre seulement", t.cycles.map((c) => paid(c.key)), [0, 1, 0, 0]);
      const bt = t.bpm.reads.budgetType(t.ctx).lines.find((l) => l.label === "Assurance habitation");
      t.check("Budget type : cadence annuelle conservée", [bt?.cadence, bt?.amountCents], ["yearly", 42000]);
    },
  }),
];

// ————— N04 · Indépendant aux revenus irréguliers —————
const n04Lines = [
  ["Loyer", "charge", 680, "std:logement", 5],
  ["Internet", "charge", 40, "std:logement", 8],
  ["Cotisations sociales", "charge", 380, "std:divers", 15],
  ["Assurance professionnelle", "charge", 35, "std:divers", 3],
  ["Courses", "charge", 70, "std:alimentation", 2, { cadence: "weekly", variation: [0, 6, -4, 11] }],
  ["Transports", "charge", 50, "std:transport", 4],
];
const n04Invoices = (o = {}) => ({
  0: [["Facture Atelier Nord", 2200, "std:salaires", 10], ["Facture Studio Bleu", 900, "std:salaires", 20]],
  1: o.noSeptember ? [] : [["Facture Atelier Nord · septembre", 2500, "std:salaires", 12, o.partial ? { realizedAmount: 1500 } : {}], ["Facture Agence Cap", 600, "std:salaires", 25]],
  2: [["Facture Atelier Nord · octobre", 1800, "std:salaires", 9]],
  3: [["Facture Atelier Nord · novembre", 2100, "std:salaires", 5], ["Facture Maison Lune", 1200, "std:salaires", 25, { realizedDate: null }]],
});
const n04 = (id, title, particularity, extra = {}) => ({
  id,
  group: "N04",
  title,
  particularity,
  userType: "individuel",
  openingStock: extra.openingStock === undefined ? 4000 : extra.openingStock,
  objective: 15000,
  setup: async (t) => lifeLines(t, n04Lines),
  play: (t) => {
    oneOffs(t, n04Invoices(extra), "income");
    oneOffs(t, { 1: [["Ordinateur de remplacement", 240, "std:divers", 18]] });
  },
  verify: extra.verify,
});

export const N04 = [
  n04("N04-V1", "Indépendant · aucun encaissement en septembre", "Aucune facture n'est encaissée sur le cycle de septembre : les charges courent quand même.", {
    noSeptember: true,
    verify: (t) => {
      const sep = t.bpm.life.lifeManagement(t.ctx, { periodKey: "2026-09" });
      t.check("Septembre clôturé négatif : le cycle le signale", [sep.cycle.health, sep.cycle.closedResultCents < 0], ["watch", true]);
      t.check("Septembre : aucune entrée prévue, la jauge ne parle pas de « conservé »", [sep.cycle.flows.incomeCount, sep.cycle.flows.receivedCents], [0, 0]);
      const res = t.bpm.life.lifeManagement(t.ctx, { periodKey: "2026-11" }).results;
      t.check("Résultats : un cycle négatif sur trois", [res.count, res.negativeCount], [3, 1]);
    },
  }),
  n04("N04-V2", "Indépendant · facture encaissée en partie", "La facture de septembre (2 500 €) n'est payée qu'à hauteur de 1 500 € ; le solde est perdu.", {
    partial: true,
    verify: (t) => {
      const sep = t.bpm.life.lifeManagement(t.ctx, { periodKey: "2026-09" });
      t.check("Septembre : reçu 2 100 € pour 3 100 € prévus", [sep.cycle.flows.receivedCents, sep.cycle.flows.toReceiveCents], [210000, 0]);
      t.check("Septembre : l'écart reçu / prévu est nommé", sep.cycle.flows.incomeGapCents ?? null, -100000);
    },
  }),
  n04("N04-V3", "Indépendant · stock d'ouverture inconnu", "Le patrimoine de départ n'est pas renseigné : les clôtures restent possibles, le patrimoine reste à renseigner.", {
    openingStock: null,
    verify: (t) => {
      const p = t.bpm.life.lifeManagement(t.ctx, { periodKey: "2026-11" }).patrimoine;
      t.check("Patrimoine à renseigner, jamais affiché comme 0 €", [p.health, p.stockCents], ["unknown", null]);
      t.check("Les résultats clôturés restent comptés", p.capitalizedCents, t.cycles.slice(0, 3).reduce((s, c) => s + t.expected(c.key).resultCents, 0));
    },
  }),
];

// ————— N05 · Retraité propriétaire —————
const n05Lines = [
  ["Pension de retraite", "income", 1850, "std:autresRevenus", 9],
  ["Retraite complémentaire", "income", 620, "std:autresRevenus", 1],
  ["Charges de copropriété", "charge", 210, "std:logement", 1],
  ["Énergie", "charge", 95, "std:logement", 6],
  ["Mutuelle", "charge", 135, "std:sante", 4],
  ["Téléphone", "charge", 30, "std:divers", 12],
  ["Courses", "charge", 75, "std:alimentation", 3, { cadence: "weekly", variation: [0, -5, 9, 3] }],
  ["Transports", "charge", 40, "std:transport", 7],
  ["Club de randonnée", "charge", 25, "std:loisirs", 15],
];
const n05OneOffs = {
  0: [["Lunettes", 180, "std:sante", 11]],
  1: [["Cadeau des petits-enfants", 120, "std:loisirs", 20]],
  2: [["Voyage en car", 340, "std:loisirs", 14]],
  3: [["Coiffeur", 32, "std:divers", 3]],
};
const n05 = (id, title, particularity, extra = {}) => ({
  id,
  group: "N05",
  title,
  particularity,
  userType: "individuel",
  openingStock: 30000,
  objective: extra.objective ?? 50000,
  setup: async (t) => {
    lifeLines(t, n05Lines);
    for (const l of extra.lines ?? []) lifeLines(t, [l]);
  },
  play: (t) => {
    oneOffs(t, n05OneOffs);
    extra.play?.(t);
  },
  verify: extra.verify,
});

export const N05 = [
  n05("N05-V1", "Retraité · objectif de stock atteint au troisième cycle", "L'objectif de patrimoine (33 800 €) est franchi à la clôture d'octobre.", {
    objective: 33800,
    verify: (t) => {
      t.check("L'oracle franchit l'objectif à la troisième clôture", [t.stockAfter(1) < 3380000, t.stockAfter(2) >= 3380000], [true, true]);
      const sep = t.bpm.life.lifeManagement(t.ctx, { periodKey: "2026-09" }).patrimoine;
      const nov = t.bpm.life.lifeManagement(t.ctx, { periodKey: "2026-11" }).patrimoine;
      t.check("Septembre : objectif pas encore atteint", sep.progressPct < 100, true);
      t.check("Novembre : objectif atteint, plus rien à constituer", [nov.progressPct >= 100, nov.remainingCents], [true, 0]);
      t.check("Novembre : le volet patrimoine est en règle", nov.health, "ok");
    },
  }),
  n05("N05-V2", "Retraité · saisie en double annulée", "Le cadeau de septembre est saisi deux fois ; le doublon est annulé deux jours plus tard. En novembre, annuler l'original (période close) est refusé.", {
    play: (t) => {
      t.operation("Cadeau des petits-enfants (doublon)", { label: "Cadeau des petits-enfants", amount: 120, center: "std:loisirs", date: dayOf(t.cycles[1], 20) });
      t.at("2026-09-22", "Annuler le doublon", async () => {
        const op = t.ops["Cadeau des petits-enfants (doublon)"];
        const r = await t.B.cancelOperation(t.ctx, op.id, { expectedRevision: op.revision, reason: "Doublon" });
        t.ops["Cadeau des petits-enfants (doublon)"] = r.operation;
        t.unbook("life", "charge", cents(120), "2026-09-20");
      });
      t.at("2026-11-06", "Tenter d'annuler la saisie de septembre", async () => {
        const op = t.ops["Cadeau des petits-enfants"];
        await t.refusal("Annuler une saisie d'une période close est refusé", () => t.B.cancelOperation(t.ctx, op.id, { expectedRevision: op.revision }), "PERIOD_CLOSED");
      }, 9);
    },
    verify: (t) => {
      const detail = t.bpm.reads.centerDetail(t.ctx, "std:loisirs", { period: "2026-09" });
      t.check("Septembre : un seul cadeau compté", detail.settledLines.filter((l) => l.label === "Cadeau des petits-enfants").length, 1);
      t.check("Le doublon reste dans la base, annulé", t.socle.state.operations[t.ops["Cadeau des petits-enfants (doublon)"].id].status, "cancelled");
    },
  }),
  n05("N05-V3", "Retraité · marché chaque samedi", "Un marché hebdomadaire de 28 € tous les samedis, en plus des courses : 4 ou 5 occurrences selon le cycle.", {
    lines: [["Marché du samedi", "charge", 28, "std:alimentation", 0, { cadence: "weekly", firstDate: "2026-08-01", variation: [0, 4, -3, 6, 2] }]],
    verify: (t) => {
      const lines = (key) => t.bpm.reads.centerDetail(t.ctx, "std:alimentation", { period: key }).lines.filter((l) => l.label === "Marché du samedi");
      t.check("Samedis par cycle : 5, 4, 5, 4", t.cycles.map((c) => lines(c.key).length), [5, 4, 5, 4]);
      t.check("Novembre : aucun marché encore passé, quatre à venir", lines("2026-11").filter((l) => l.settled).length, 0);
      const bt = t.bpm.reads.budgetType(t.ctx).lines.find((l) => l.label === "Marché du samedi");
      t.check("Budget type : moyenne mensuelle d'une cadence hebdomadaire", bt?.monthlyAverageCents, Math.round((2800 * 52) / 12));
    },
  }),
];

export const GROUPS = { N01, N02, N03, N04, N05 };
