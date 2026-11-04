// Cas d'essai des projets de la vie dans BPM, rejoués sur quatre périodes d'un cycle mensuel par les commandes
// réelles du socle (noyau, Budget, BPM), dans l'ordre des dates : la date du jour du socle (`SOCLE_TODAY`) avance
// avec le scénario. Chaque étape est journalisée et chaque attendu est recalculé à part puis comparé à l'observé.
//
// Mois m0 à m3 : m0, m1 et m2 sont clos au premier jour du mois suivant ; m3 est la période en cours (le scénario
// s'arrête le 1er de m3). Projets :
//   P1 Cuisine équipée      5 000 € : dans son budget, terminé ; retour ponctuel (revente de l'ancienne cuisine).
//   P2 Voyage en Islande    3 000 € : règlement en dépassement (450 €) autorisé, facturé fin m2, parts revalidées.
//   P3 Salle de bain        4 000 € : part en dépassement refusée puis autorisée (500 €), facturée fin m2.
//   P4 Vélo électrique      1 200 € : dépassement autorisé le 1er de m3, en rouge jusqu'à la fin de m3.
//   P5 Location du garage     400 € : retour récurrent de 90 €/mois à la complétion d'une tâche.
//   P6 Permis moto          1 500 € : charges récurrentes, demande de dépassement refusée (rien n'est écrit).
//   P7 Cabane au jardin     (aucun montant attribué) : ses dépenses ne comptent pas dans le budget de vie.

const pad = (n) => String(n).padStart(2, '0');
const addMonths = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`;
};
const lastDay = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const euros = (c) => `${(c / 100).toFixed(2).replace('.', ',')} €`;

/**
 * @param socle socle ouvert (un seul écrivain)
 * @param opts  { start: 'AAAA-MM' (mois m0), label?: nom du user d'essai }
 * @returns     { userId, label, months, steps, checks, ok }
 */
export async function runProjectScenarios(socle, { start, label = 'TEST PROJETS · Famille Laurent' } = {}) {
  const previousToday = process.env.SOCLE_TODAY;
  const months = [0, 1, 2, 3].map((i) => addMonths(start, i));
  const d = (mi, day) => `${months[mi]}-${pad(Math.min(day, lastDay(months[mi])))}`;
  const endOf = (mi) => d(mi, 31);
  const { users, core, budget, bpm } = socle.modules;
  const P = bpm.projects;
  const steps = [];
  const checks = [];
  let n = 0;
  const key = (k) => `scenario-${label}-${k}-${++n}`;
  const step = (text) => steps.push({ date: process.env.SOCLE_TODAY, text });
  const check = (name, expected, observed) => checks.push({ name, expected, observed, ok: JSON.stringify(expected) === JSON.stringify(observed) });
  const go = (date) => {
    process.env.SOCLE_TODAY = date;
  };

  // Attendus recalculés à part : encaissements et décaissements par période (date réelle).
  const ledger = Object.fromEntries(months.map((m) => [m, { income: 0, lifeCharges: 0, projectCharges: 0 }]));
  const book = (date, kind, cents) => {
    ledger[date.slice(0, 7)][kind] += cents;
  };

  try {
    // ---------- m0 : création du foyer, budget de vie, projets du noyau financés ----------
    go(d(0, 1));
    const bundle = await users.createUser({ requestKey: key('user'), label, userType: 'famille', openingStock: 20000, objective: 60000, anchorDay: 1, cycleStartDate: d(0, 1) });
    const ctx = { userId: bundle.userId };
    step(`Foyer « ${label} » créé : budget de vie, patrimoine (20 000 €), cycle mensuel au 1er depuis le ${d(0, 1)}.`);
    const rec = (input) => budget.createRecurrence(ctx, { requestKey: key('rec'), cadence: 'monthly', ...input });
    const salaire = (await rec({ direction: 'income', label: 'Salaires', amount: 4200, firstDate: d(0, 1), costCenterRef: 'std:salaires' })).recurrence;
    const loyer = (await rec({ direction: 'charge', label: 'Loyer', amount: 1300, firstDate: d(0, 5), costCenterRef: 'std:logement' })).recurrence;
    const courses = (await rec({ direction: 'charge', label: 'Courses', amount: 600, firstDate: d(0, 10), costCenterRef: 'std:alimentation' })).recurrence;
    step('Budget de vie : salaires 4 200 €, loyer 1 300 €, courses 600 € par mois.');

    const settle = async (r, mi, day, amount, kind) => {
      go(d(mi, day));
      const occ = `${months[mi]}-${r.firstDate.slice(8)}`;
      await budget.settleOccurrence(ctx, r.id, { requestKey: key('settle'), occurrenceDate: occ, realizedAmount: amount, realizedDate: d(mi, day) });
      book(d(mi, day), kind, Math.round(amount * 100));
    };

    /** Projet créé dans le noyau avec ses tâches, puis budgété (et financé) par le budget de vie. */
    const project = async (title, tasks, amount) => {
      const p = await core.createCoreProject(ctx, { requestKey: key('prj'), title, description: `Cas d'essai : ${title}.` });
      const ids = {};
      for (const t of tasks) ids[t] = (await core.createTask(ctx, { requestKey: key('tsk'), title: t, projectId: p.project.id })).task.id;
      const a = await P.adoptProject(ctx, { requestKey: key('adopt'), coreProjectId: p.project.id });
      if (amount !== undefined) await P.allocate(ctx, a.budgetId, { amount, expectedRevision: a.detail.budget.revision });
      step(`${title} : créé dans le noyau (${tasks.length} tâche(s)), budgété${amount !== undefined ? `, ${euros(amount * 100)} attribués` : ' sans montant'}.`);
      return { budgetId: a.budgetId, projectId: p.project.id, tasks: ids, title };
    };
    const rev = (prj) => socle.state.budgets[prj.budgetId].revision;
    const share = (prj, task, amount) => P.setTaskShare(ctx, prj.budgetId, prj.tasks[task], { amount, expectedRevision: rev(prj) });
    const status = async (prj, task, s) => {
      const t = socle.state.tasks[prj.tasks[task]];
      const r = await core.changeTaskStatus(ctx, t.id, { status: s, expectedRevision: t.revision });
      for (const e of r.effects ?? []) step(`${prj.title} · ${task} : ${e.message}`);
      return r;
    };
    const charge = (prj, task, label, amount, date, extra = {}) =>
      budget.createOperation(ctx, { requestKey: key('op'), budgetId: prj.budgetId, direction: 'charge', label, amount, date, status: 'planned', costCenterRef: 'std:divers', taskId: task ? prj.tasks[task] : null, ...extra });
    /** Valide un règlement de projet ; un dépassement est demandé au budget de vie, qui décide. */
    const pay = async (prj, opId, amount, date, decision = 'approve') => {
      go(date);
      const o = () => socle.state.operations[opId];
      const attempt = () => budget.realizeOperation(ctx, opId, { expectedRevision: o().revision, realizedAmount: amount, realizedDate: date });
      try {
        await attempt();
      } catch (err) {
        if (err.code !== 'OVERRUN_AUTHORIZATION_REQUIRED') throw err;
        const req = await P.requestOverrun(ctx, prj.budgetId, { requestKey: key('ovr'), taskId: err.details.taskId, reason: 'reglement', amount: err.details.overrunCents / 100 });
        await P.decideOverrun(ctx, req.overrunId, { decision, expectedRevision: req.overrun.revision });
        step(`${prj.title} : « ${o().label} » (${euros(amount * 100)}) dépasse le budget de ${euros(err.details.overrunCents)} → demande au budget de vie, ${decision === 'approve' ? 'autorisée' : 'refusée'}.`);
        if (decision !== 'approve') return false;
        await attempt();
      }
      book(date, 'projectCharges', Math.round(amount * 100));
      step(`${prj.title} : règlement de « ${o().label} » validé (${euros(amount * 100)}).`);
      return true;
    };
    /** Part de tâche ; au-delà du budget, demande au budget de vie et décision. */
    const shareOrAsk = async (prj, task, amount, decision) => {
      try {
        await share(prj, task, amount);
        return true;
      } catch (err) {
        if (err.code !== 'OVERRUN_AUTHORIZATION_REQUIRED') throw err;
        const req = await P.requestOverrun(ctx, prj.budgetId, { requestKey: key('ovr'), taskId: prj.tasks[task], reason: 'ventilation', amount: err.details.overrunCents / 100 });
        await P.decideOverrun(ctx, req.overrunId, { decision, expectedRevision: req.overrun.revision });
        step(`${prj.title} : part de « ${task} » à ${euros(amount * 100)} → dépassement de ${euros(err.details.overrunCents)} ${decision === 'approve' ? 'autorisé' : 'refusé'} par le budget de vie.`);
        if (decision !== 'approve') return false;
        await share(prj, task, amount);
        return true;
      }
    };

    go(d(0, 2));
    const p1 = await project('Cuisine équipée', ['Devis cuisiniste', 'Meubles et électroménager', 'Pose'], 5000);
    await share(p1, 'Devis cuisiniste', 500);
    await share(p1, 'Meubles et électroménager', 3500);
    await share(p1, 'Pose', 1000);
    await P.setTaskReturn(ctx, p1.budgetId, p1.tasks['Meubles et électroménager'], { label: 'Revente de l’ancienne cuisine', amount: 150, cadence: 'once', expectedRevision: rev(p1) });
    const p1Devis = (await charge(p1, 'Devis cuisiniste', 'Acompte devis', 500, d(0, 12))).operation.id;
    const p1Meubles = (await charge(p1, 'Meubles et électroménager', 'Meubles et électroménager', 3500, d(1, 10))).operation.id;
    const p1Pose = (await charge(p1, 'Pose', 'Pose de la cuisine', 1000, d(2, 8))).operation.id;

    go(d(0, 3));
    const p5 = await project('Location du garage', ['Aménagement', 'Mise en location'], 400);
    await share(p5, 'Aménagement', 400);
    await P.setTaskReturn(ctx, p5.budgetId, p5.tasks['Mise en location'], { label: 'Loyer du garage', amount: 90, cadence: 'monthly', expectedRevision: rev(p5) });
    const p5Amenagement = (await charge(p5, 'Aménagement', 'Étagères et serrure', 400, d(0, 20))).operation.id;

    await settle(salaire, 0, 1, 4200, 'income');
    await settle(loyer, 0, 5, 1300, 'lifeCharges');
    await settle(courses, 0, 12, 600, 'lifeCharges');
    await pay(p1, p1Devis, 500, d(0, 12));
    go(d(0, 12));
    await status(p1, 'Devis cuisiniste', 'done');
    go(d(0, 15));
    await status(p1, 'Meubles et électroménager', 'doing');
    await pay(p5, p5Amenagement, 380, d(0, 20));
    await status(p5, 'Aménagement', 'done');

    // ---------- m1 : clôture de m0, nouveaux projets, voyage, retours ----------
    go(d(1, 1));
    const c0 = await bpm.closePeriod(ctx, { requestKey: key('close'), periodKey: months[0] });
    step(`Clôture de ${c0.closure.periodLabel} : résultat ${euros(c0.closure.resultCents)} capitalisé.`);
    await status(p5, 'Mise en location', 'done');
    const garage = Object.values(socle.state.recurrences).find((r) => r.userId === ctx.userId && r.label === 'Loyer du garage');
    await settle(salaire, 1, 1, 4200, 'income');
    await settle(garage, 1, 1, 90, 'income');

    go(d(1, 2));
    const p2 = await project('Voyage en Islande', ['Vols', 'Hébergements', 'Location de voiture'], 3000);
    await share(p2, 'Vols', 1200);
    await share(p2, 'Hébergements', 1200);
    await share(p2, 'Location de voiture', 600);
    const p2Vols = (await charge(p2, 'Vols', 'Billets Reykjavik', 1200, d(1, 6))).operation.id;
    const p2Heb = (await charge(p2, 'Hébergements', 'Hôtels et gîtes', 1200, d(1, 20))).operation.id;
    const p2Voiture = (await charge(p2, 'Location de voiture', '4x4 dix jours', 600, d(2, 4))).operation.id;
    const p6 = await project('Permis moto', ['Code', 'Leçons de conduite', 'Équipement moto'], 1500);
    await share(p6, 'Code', 300);
    await share(p6, 'Leçons de conduite', 1200);
    const p6Code = (await charge(p6, 'Code', 'Forfait code', 300, d(1, 10))).operation.id;
    const lecons = (await budget.createRecurrence(ctx, { requestKey: key('rec'), budgetId: p6.budgetId, direction: 'charge', label: 'Leçons (forfait mensuel)', amount: 300, cadence: 'monthly', firstDate: d(1, 15), endDate: `${addMonths(months[3], 1)}-15`, costCenterRef: 'std:transport', taskId: p6.tasks['Leçons de conduite'] })).recurrence;

    go(d(1, 3));
    const p3 = await project('Salle de bain', ['Plomberie', 'Carrelage', 'Mobilier'], 4000);
    await share(p3, 'Plomberie', 1500);
    await share(p3, 'Carrelage', 1500);
    await share(p3, 'Mobilier', 1000);
    const p3Plomberie = (await charge(p3, 'Plomberie', 'Plombier', 1500, d(1, 20))).operation.id;
    const p3Carrelage = (await charge(p3, 'Carrelage', 'Carreleur', 1500, d(2, 25))).operation.id;
    await charge(p3, 'Mobilier', 'Meuble vasque et miroir', 1000, d(3, 20));

    await settle(loyer, 1, 5, 1300, 'lifeCharges');
    await pay(p2, p2Vols, 1450, d(1, 6));
    go(d(1, 6));
    await status(p2, 'Vols', 'done');
    await pay(p1, p1Meubles, 3400, d(1, 10));
    go(d(1, 10));
    await status(p1, 'Meubles et électroménager', 'done');
    await pay(p6, p6Code, 300, d(1, 10));
    await status(p6, 'Code', 'done');
    await settle(courses, 1, 12, 600, 'lifeCharges');
    go(d(1, 15));
    await budget.settleOccurrence(ctx, lecons.id, { requestKey: key('settle'), occurrenceDate: d(1, 15), realizedDate: d(1, 15) });
    book(d(1, 15), 'projectCharges', 30000);
    await status(p6, 'Leçons de conduite', 'doing');
    await pay(p2, p2Heb, 1350, d(1, 20));
    go(d(1, 20));
    await status(p2, 'Hébergements', 'done');
    await pay(p3, p3Plomberie, 1500, d(1, 20));
    await status(p3, 'Plomberie', 'done');
    go(d(1, 25));
    const revente = Object.values(socle.state.operations).find((o) => o.userId === ctx.userId && o.label === 'Revente de l’ancienne cuisine');
    await budget.realizeOperation(ctx, revente.id, { expectedRevision: revente.revision, realizedAmount: 150, realizedDate: d(1, 25) });
    book(d(1, 25), 'income', 15000);
    step('Cuisine équipée : revente de l’ancienne cuisine encaissée (150,00 €).');

    // ---------- m2 : dépassements ----------
    go(d(2, 1));
    const c1 = await bpm.closePeriod(ctx, { requestKey: key('close'), periodKey: months[1] });
    step(`Clôture de ${c1.closure.periodLabel} : résultat ${euros(c1.closure.resultCents)} capitalisé.`);
    await settle(salaire, 2, 1, 4200, 'income');
    await settle(garage, 2, 1, 90, 'income');
    await status(p1, 'Pose', 'doing');
    go(d(2, 2));
    const p4 = await project('Vélo électrique', ['Achat du vélo', 'Équipements'], 1200);
    await share(p4, 'Achat du vélo', 1000);
    await share(p4, 'Équipements', 200);
    const p4Velo = (await charge(p4, 'Achat du vélo', 'Vélo cargo électrique', 1000, d(2, 20))).operation.id;
    const p7 = await project('Cabane au jardin', ['Plans', 'Construction']);
    const p7Plans = (await charge(p7, 'Plans', 'Plans de la cabane', 120, d(2, 10))).operation.id;
    await charge(p7, 'Construction', 'Bois et quincaillerie', 800, d(3, 15));

    await pay(p2, p2Voiture, 650, d(2, 4)); // 1 450 + 1 350 + 650 = 3 450 > 3 000 : dépassement de 450 € autorisé
    go(d(2, 4));
    await status(p2, 'Location de voiture', 'done');
    await settle(loyer, 2, 5, 1300, 'lifeCharges');
    await pay(p1, p1Pose, 1000, d(2, 8));
    go(d(2, 8));
    await status(p1, 'Pose', 'done');
    go(d(2, 10));
    await budget.realizeOperation(ctx, p7Plans, { expectedRevision: socle.state.operations[p7Plans].revision, realizedAmount: 120, realizedDate: d(2, 10) }); // non financé : hors budget de vie
    step('Cabane au jardin : plans réglés (120,00 €) — projet sans montant attribué, hors budget de vie.');
    await settle(courses, 2, 12, 600, 'lifeCharges');
    go(d(2, 15));
    await budget.settleOccurrence(ctx, lecons.id, { requestKey: key('settle'), occurrenceDate: d(2, 15), realizedDate: d(2, 15) });
    book(d(2, 15), 'projectCharges', 30000);
    const carrelageRefused = await shareOrAsk(p3, 'Carrelage', 2000, 'refuse');
    await status(p3, 'Carrelage', 'doing');
    go(d(2, 16));
    const motoRefused = await shareOrAsk(p6, 'Équipement moto', 400, 'refuse');
    go(d(2, 20));
    const carrelageApproved = await shareOrAsk(p3, 'Carrelage', 2000, 'approve');
    await status(p4, 'Achat du vélo', 'doing');
    await pay(p3, p3Carrelage, 2000, d(2, 25));

    // ---------- m3 (période en cours) : facturation de fin de cycle, clôture de m2, nouveau dépassement ----------
    go(d(3, 1));
    const billed = await P.billOverruns(ctx, {});
    for (const b of billed.projects) step(`Fin de cycle : dépassement de « ${b.name} » facturé au budget de vie (${euros(b.billedOverrunCents)}), budget attribué porté à ${euros(b.allocationCents)}.`);
    const p2Checks = billed.projects.find((b) => b.budgetId === p2.budgetId)?.checks ?? [];
    // Revalidation de fin de cycle : les parts du voyage rejoignent le budget attribué.
    await share(p2, 'Vols', 1450);
    await share(p2, 'Hébergements', 1350);
    await share(p2, 'Location de voiture', 650);
    step('Voyage en Islande : parts revalidées sur les montants réels (budget = somme des parts).');
    const c2 = await bpm.closePeriod(ctx, { requestKey: key('close'), periodKey: months[2] });
    step(`Clôture de ${c2.closure.periodLabel} : résultat ${euros(c2.closure.resultCents)} capitalisé.`);
    await settle(salaire, 3, 1, 4200, 'income');
    await settle(garage, 3, 1, 90, 'income');
    await pay(p4, p4Velo, 1150, d(3, 1));
    await status(p4, 'Achat du vélo', 'done');
    const p4Equip = (await charge(p4, 'Équipements', 'Casque, antivol, sacoches', 250, d(3, 1))).operation.id;
    await pay(p4, p4Equip, 250, d(3, 1)); // 1 150 + 250 = 1 400 > 1 200 : dépassement de 200 € autorisé, facturé fin m3
    await status(p4, 'Équipements', 'doing');

    // ---------- contrôles ----------
    const detail = (prj) => P.projectDetail(ctx, prj.projectId);
    const expectedResult = (m) => ledger[m].income - ledger[m].lifeCharges - ledger[m].projectCharges;
    for (const [c, m] of [[c0, months[0]], [c1, months[1]], [c2, months[2]]]) {
      check(`Clôture ${m} : résultat = reçu − dépenses du budget de vie − charges de projet validées`, expectedResult(m), c.closure.resultCents);
      check(`Clôture ${m} : charges de projet validées enregistrées`, ledger[m].projectCharges, Math.round((c.closure.figures['bpm.chargesProjets']?.value ?? 0) * 100));
    }
    const current = bpm.figure(ctx, 'bpm.chargesProjets', { periodKey: months[3] }).value;
    check(`Période en cours ${months[3]} : charges de projet validées`, ledger[months[3]].projectCharges, Math.round(current * 100));

    const f1 = detail(p1);
    check('P1 Cuisine : dans son budget, terminée', ['ok', 'done', 490000], [f1.budget.state, f1.project.view.status, f1.budget.paidCents]);
    const f2 = detail(p2);
    check('P2 Islande : dépassement facturé, budget porté à 3 450 €, déficit soldé', [345000, 45000, false], [f2.budget.allocationCents, f2.budget.billedOverrunCents, f2.budget.deficit]);
    check('P2 Islande : contrôle de fin de cycle avant revalidation (parts sous le budget)', 'warning', p2Checks.find((c) => c.code === 'shares')?.level);
    check('P2 Islande : contrôles après revalidation des parts', true, f2.checks.every((c) => c.level === 'ok'));
    const f3 = detail(p3);
    check('P3 Salle de bain : part refusée puis autorisée, facturée', [false, true, ['billed', 'refused'], 450000], [carrelageRefused, carrelageApproved, f3.overruns.map((o) => o.status).sort(), f3.budget.allocationCents]);
    const f4 = detail(p4);
    check('P4 Vélo : en dépassement (rouge) jusqu’à la fin de la période', [true, 'deficit', 20000, endOf(3)], [f4.budget.deficit, f4.budget.state, f4.budget.approvedOverrunCents, f4.budget.nextBillingDate]);
    const garageSettled = Object.values(socle.state.operations).filter((o) => o.recurrenceId === garage.id && o.status === 'realized').length;
    check('P5 Garage : retour récurrent de 90 € réglé chaque mois depuis sa mise en location', [bundle.budgetId, 3], [garage.budgetId, garageSettled]);
    const f6 = detail(p6);
    check('P6 Permis : dépassement refusé, rien n’est écrit', [false, 150000, 'ok', ['refused']], [motoRefused, f6.budget.sharesCents, f6.budget.state, f6.overruns.map((o) => o.status)]);
    const f7 = detail(p7);
    check('P7 Cabane : sans montant attribué, ses dépenses restent hors budget de vie', ['unallocated', false], [f7.budget.state, Object.values(ledger).some((l) => l.projectCharges === 12000)]);
    const all = socle.inspector.checks(socle.state);
    const prj = all.filter((c) => ['PRJ-01', 'PRJ-02'].includes(c.rule) && c.ids?.some((id) => [p1, p2, p3, p4, p5, p6].some((p) => p.budgetId === id)));
    check('Contrôles PRJ-01 / PRJ-02 du foyer : tous passés', true, prj.every((c) => c.result === 'passed'));
    check('Contrôles d’intégrité : aucun en échec', [], all.filter((c) => c.result === 'failed').map((c) => c.rule));

    return { userId: ctx.userId, label, months, steps, checks, ok: checks.every((c) => c.ok), ledger };
  } finally {
    if (previousToday === undefined) delete process.env.SOCLE_TODAY;
    else process.env.SOCLE_TODAY = previousToday;
  }
}
