// Cas d'essai des projets de la vie, rejoués sur sept périodes d'un cycle mensuel au 1er : six mois clos (m0 à m5)
// et le mois en cours (m6), rempli sur tout le mois. Le scénario est écrit une fois, comme une suite d'événements
// datés, et rejoué par un « pilote » :
//   - `serviceDriver(socle)` : commandes du socle dans le processus (jeu d'essai `npm run seed:projets`, tests node) ;
//   - `httpDriver(base)`      : les mêmes commandes par l'API HTTP, horloge de recette comprise (bout en bout) ;
//   - le pilote navigateur du test de bout en bout (`e2e/`) remplace les gestes des projets par l'interface.
// La date du jour avance avec les événements ; ceux qui suivent `until` ne sont pas joués : leurs dépenses et
// échéances restent prévues (aucun règlement n'est inventé dans le futur). Chaque attendu est recalculé à part.
//
// Projets (montants en euros) :
//   P1 Cuisine équipée      5 000   m0-m2  dans son budget ; retour ponctuel (revente de l'ancienne cuisine)
//   P2 Voyage en Islande    3 000   m1-m2  règlement en dépassement (450) autorisé, facturé au 1er de m3, parts revalidées
//   P3 Salle de bain        4 000   m1-m3  part en dépassement refusée puis autorisée (500), facturée au 1er de m3
//   P4 Vélo électrique      1 200   m2-m3  règlement en dépassement (200) autorisé, facturé au 1er de m4
//   P5 Location du garage     400   m0-m6  retour récurrent de 90 €/mois dès la mise en location
//   P6 Permis moto          1 500   m1-m4  leçons récurrentes ; part en dépassement refusée
//   P7 Cabane au jardin     aucun   m2-m6  dépenses hors budget de vie
//   P8 Rentrée scolaire       900   m4-m6  dans son budget ; cantine récurrente
//   P9 Week-end à Lyon        700   m5-m6  dépassement (50) autorisé en m6 : en rouge jusqu'à la fin du cycle
//   P10 Noël en famille     1 200   m6     part en dépassement autorisée (60), règlement en dépassement refusé (90)

const pad = (n) => String(n).padStart(2, '0');
export const addMonths = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`;
};
const lastDay = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const euros = (c) => `${(c / 100).toFixed(2).replace('.', ',')} €`;
const cents = (e) => Math.round(e * 100);

// ---------- pilotes ----------

/** Pilote dans le processus : services du socle, date du jour par `SOCLE_TODAY`. */
export function serviceDriver(socle) {
  const { users, core, budget, bpm } = socle.modules;
  const P = bpm.projects;
  let ctx = null;
  let n = 0;
  const key = (k) => `scenario-${k}-${Date.now()}-${++n}`;
  const overrunFlow = async (budgetId, err, reason, decision) => {
    const req = await P.requestOverrun(ctx, budgetId, { requestKey: key('ovr'), taskId: err.details.taskId, reason, amount: err.details.overrunCents / 100 });
    await P.decideOverrun(ctx, req.overrunId, { decision, expectedRevision: req.overrun.revision });
  };
  return {
    name: 'services',
    go: async (date) => {
      process.env.SOCLE_TODAY = date;
    },
    async createUser(input) {
      const b = await users.createUser({ requestKey: key('user'), ...input });
      ctx = { userId: b.userId };
      return { userId: b.userId, budgetId: b.budgetId };
    },
    async createRecurrence(input) {
      return (await budget.createRecurrence(ctx, { requestKey: key('rec'), cadence: 'monthly', ...input })).recurrence.id;
    },
    async settle(recId, occurrenceDate, amount, date) {
      await budget.settleOccurrence(ctx, recId, { requestKey: key('settle'), occurrenceDate, realizedAmount: amount, realizedDate: date });
    },
    async createOperation(input) {
      return (await budget.createOperation(ctx, { requestKey: key('op'), status: 'planned', ...input })).operation.id;
    },
    async realize(opId, amount, date) {
      const o = socle.state.operations[opId];
      await budget.realizeOperation(ctx, opId, { expectedRevision: o.revision, realizedAmount: amount, realizedDate: date });
    },
    async close(periodKey) {
      return (await bpm.closePeriod(ctx, { requestKey: key('close'), periodKey })).closure;
    },
    async createProject(title, tasks) {
      const p = await core.createCoreProject(ctx, { requestKey: key('prj'), title, description: `Cas d'essai : ${title}.` });
      const ids = {};
      for (const t of tasks) ids[t] = (await core.createTask(ctx, { requestKey: key('tsk'), title: t, projectId: p.project.id })).task.id;
      return { projectId: p.project.id, tasks: ids };
    },
    async adopt(prj) {
      return (await P.adoptProject(ctx, { requestKey: key('adopt'), coreProjectId: prj.projectId })).budgetId;
    },
    async allocate(prj, amount) {
      await P.allocate(ctx, prj.budgetId, { amount, expectedRevision: socle.state.budgets[prj.budgetId].revision });
    },
    async share(prj, task, amount, decision = 'approve') {
      const set = () => P.setTaskShare(ctx, prj.budgetId, prj.tasks[task], { amount, expectedRevision: socle.state.budgets[prj.budgetId].revision });
      try {
        await set();
        return { saved: true, overrunCents: 0 };
      } catch (err) {
        if (err.code !== 'OVERRUN_AUTHORIZATION_REQUIRED') throw err;
        await overrunFlow(prj.budgetId, err, 'ventilation', decision);
        if (decision === 'approve') await set();
        return { saved: decision === 'approve', overrunCents: err.details.overrunCents };
      }
    },
    async setReturn(prj, task, input) {
      await P.setTaskReturn(ctx, prj.budgetId, prj.tasks[task], { ...input, expectedRevision: socle.state.budgets[prj.budgetId].revision });
    },
    async pay(prj, opId, amount, date, decision = 'approve') {
      const attempt = () => this.realize(opId, amount, date);
      try {
        await attempt();
        return { saved: true, overrunCents: 0 };
      } catch (err) {
        if (err.code !== 'OVERRUN_AUTHORIZATION_REQUIRED') throw err;
        await overrunFlow(prj.budgetId, err, 'reglement', decision);
        if (decision === 'approve') await attempt();
        return { saved: decision === 'approve', overrunCents: err.details.overrunCents };
      }
    },
    async status(prj, task, status) {
      const t = socle.state.tasks[prj.tasks[task]];
      const r = await core.changeTaskStatus(ctx, t.id, { status, expectedRevision: t.revision });
      return (r.effects ?? []).map((e) => e.message);
    },
    async bill() {
      return (await P.billOverruns(ctx, {})).projects;
    },
    // ---------- lectures ----------
    closures: () => bpm.closures(ctx),
    figure: (k, periodKey) => bpm.figure(ctx, k, { periodKey }).value,
    projectDetail: (prj) => P.projectDetail(ctx, prj.projectId),
    operations: () => Object.values(socle.state.operations).filter((o) => o.userId === ctx.userId),
    recurrences: () => budget.recurrences(ctx),
    checks: () => socle.inspector.checks(socle.state),
  };
}

/** Pilote HTTP : mêmes commandes par l'API (horloge de recette `PUT /api/_recette/today`). */
export function httpDriver(base) {
  let userId = null;
  let n = 0;
  const key = (k) => `e2e-${k}-${Date.now()}-${++n}`;
  async function call(method, path, body) {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) {
      const e = new Error(`${method} ${path} → ${res.status} ${json.error?.message}`);
      Object.assign(e, { code: json.error?.code, details: json.error?.details ?? {} });
      throw e;
    }
    return json;
  }
  const detail = (prj) => call('GET', `/api/bpm/projects/${prj.projectId}`);
  const overrunFlow = async (budgetId, err, reason, decision) => {
    const req = await call('POST', `/api/bpm/project-budgets/${budgetId}/overruns`, { requestKey: key('ovr'), taskId: err.details.taskId, reason, amount: err.details.overrunCents / 100 });
    await call('POST', `/api/bpm/overruns/${req.overrunId}/decision`, { decision, expectedRevision: req.overrun.revision });
  };
  const d = {
    name: 'http',
    call,
    key,
    get userId() {
      return userId;
    },
    go: (date) => call('PUT', '/api/_recette/today', { date }),
    async createUser(input) {
      const b = await call('POST', '/api/users', { requestKey: key('user'), ...input });
      userId = b.userId;
      return { userId: b.userId, budgetId: b.budgetId };
    },
    async createRecurrence(input) {
      return (await call('POST', '/api/bpm/operations', { requestKey: key('rec'), cadence: 'monthly', ...input })).recurrence.id;
    },
    async settle(recId, occurrenceDate, amount, date) {
      await call('POST', `/api/bpm/recurrences/${recId}/settle`, { requestKey: key('settle'), occurrenceDate, realizedAmount: amount, realizedDate: date });
    },
    async createOperation(input) {
      return (await call('POST', '/api/bpm/operations', { requestKey: key('op'), cadence: 'once', status: 'planned', ...input })).operation.id;
    },
    async realize(opId, amount, date) {
      const line = await call('GET', `/api/bpm/lines/${opId}`);
      await call('POST', `/api/bpm/operations/${opId}/realize`, { expectedRevision: line.line.revision, realizedAmount: amount, realizedDate: date });
    },
    async close(periodKey) {
      return (await call('POST', '/api/bpm/closures', { requestKey: key('close'), periodKey })).closure;
    },
    async createProject(title, tasks) {
      const p = await call('POST', '/api/projects', { requestKey: key('prj'), title, description: `Cas d'essai : ${title}.` });
      const ids = {};
      for (const t of tasks) ids[t] = (await call('POST', '/api/tasks', { requestKey: key('tsk'), title: t, projectId: p.project.id })).task.id;
      return { projectId: p.project.id, tasks: ids };
    },
    async adopt(prj) {
      return (await call('POST', '/api/bpm/projects/adopt', { requestKey: key('adopt'), coreProjectId: prj.projectId })).budgetId;
    },
    async allocate(prj, amount) {
      await call('PUT', `/api/bpm/project-budgets/${prj.budgetId}/allocation`, { amount, expectedRevision: (await detail(prj)).budget.revision });
    },
    async share(prj, task, amount, decision = 'approve') {
      const set = async () => call('PUT', `/api/bpm/project-budgets/${prj.budgetId}/shares/${prj.tasks[task]}`, { amount, expectedRevision: (await detail(prj)).budget.revision });
      try {
        await set();
        return { saved: true, overrunCents: 0 };
      } catch (err) {
        if (err.code !== 'OVERRUN_AUTHORIZATION_REQUIRED') throw err;
        await overrunFlow(prj.budgetId, err, 'ventilation', decision);
        if (decision === 'approve') await set();
        return { saved: decision === 'approve', overrunCents: err.details.overrunCents };
      }
    },
    async setReturn(prj, task, input) {
      await call('PUT', `/api/bpm/project-budgets/${prj.budgetId}/returns/${prj.tasks[task]}`, { ...input, expectedRevision: (await detail(prj)).budget.revision });
    },
    async pay(prj, opId, amount, date, decision = 'approve') {
      try {
        await d.realize(opId, amount, date);
        return { saved: true, overrunCents: 0 };
      } catch (err) {
        if (err.code !== 'OVERRUN_AUTHORIZATION_REQUIRED') throw err;
        await overrunFlow(prj.budgetId, err, 'reglement', decision);
        if (decision === 'approve') await d.realize(opId, amount, date);
        return { saved: decision === 'approve', overrunCents: err.details.overrunCents };
      }
    },
    async status(prj, task, status) {
      const t = await call('GET', `/api/tasks/${prj.tasks[task]}`);
      const r = await call('POST', `/api/tasks/${t.task.id}/status`, { status, expectedRevision: t.task.revision });
      return (r.effects ?? []).map((e) => e.message);
    },
    async bill() {
      return (await call('POST', '/api/bpm/overruns/bill', {})).projects;
    },
    closures: () => call('GET', '/api/bpm/closures'),
    figure: async (k, periodKey) => (await call('GET', `/api/bpm/figures/${k}${periodKey ? `?period=${periodKey}` : ''}`)).value,
    projectDetail: detail,
    async operations() {
      const budgets = await call('GET', '/api/budget/budgets');
      const all = [];
      for (const b of budgets) all.push(...(await call('GET', `/api/budget/budgets/${b.id}`)).operations);
      return all;
    },
    recurrences: () => call('GET', '/api/bpm/recurrences'),
    checks: () => call('GET', '/api/om/checks'),
  };
  return d;
}

// ---------- scénario ----------

/**
 * @param driver pilote (services, HTTP ou navigateur)
 * @param opts   { start: 'AAAA-MM' (m0), until?: 'AAAA-MM-JJ' (dernier jour joué, défaut : fin de m6), label?, log? }
 */
export async function runScenario(driver, { start, until, label = 'TEST PROJETS · Famille Laurent', log = () => {} } = {}) {
  const months = Array.from({ length: 7 }, (_, i) => addMonths(start, i));
  const d = (mi, day) => `${months[mi]}-${pad(Math.min(day, lastDay(months[mi])))}`;
  const stop = until ?? d(6, 31);
  const steps = [];
  const events = [];
  const expectations = [];
  const at = (date, text, run) => events.push({ date, text, run, order: events.length });
  const expect = (after, name, expected, observed) => expectations.push({ after, name, expected, observed });
  const ledger = Object.fromEntries(months.map((m) => [m, { income: 0, lifeCharges: 0, projectCharges: 0 }]));
  const book = (date, kind, amount) => {
    ledger[date.slice(0, 7)][kind] += cents(amount);
  };
  const S = {}; // identifiants obtenus en cours de route
  const note = (text) => steps.push({ date: S.today, text });

  // ---------- budget de vie : la vie courante, chaque mois ----------
  at(d(0, 1), 'Foyer créé', async () => {
    const u = await driver.createUser({ label, userType: 'famille', openingStock: 20000, objective: 60000, anchorDay: 1, cycleStartDate: d(0, 1) });
    Object.assign(S, u);
    S.salaire = await driver.createRecurrence({ direction: 'income', label: 'Salaires', amount: 4200, firstDate: d(0, 1), costCenterRef: 'std:salaires' });
    S.loyer = await driver.createRecurrence({ direction: 'charge', label: 'Loyer', amount: 1300, firstDate: d(0, 5), costCenterRef: 'std:logement' });
    S.courses = await driver.createRecurrence({ direction: 'charge', label: 'Courses', amount: 600, firstDate: d(0, 12), costCenterRef: 'std:alimentation' });
    S.energie = await driver.createRecurrence({ direction: 'charge', label: 'Électricité et eau', amount: 95, firstDate: d(0, 15), costCenterRef: 'std:logement' });
    note(`Foyer « ${label} » : patrimoine 20 000 €, cycle mensuel au 1er ; salaires 4 200 €, loyer 1 300 €, courses ~600 €, énergie 95 €, loisirs par mois.`);
  });
  for (let i = 0; i < 7; i++) {
    if (i > 0) {
      at(d(i, 1), `Clôture de ${months[i - 1]}`, async () => {
        const c = await driver.close(months[i - 1]);
        S[`closure${i - 1}`] = c;
        note(`Clôture de ${c.periodLabel} : résultat ${euros(c.resultCents)} capitalisé.`);
      });
    }
    at(d(i, 1), 'Salaires', async () => {
      await driver.settle(S.salaire, d(i, 1), 4200, d(i, 1));
      book(d(i, 1), 'income', 4200);
    });
    at(d(i, 2), 'Loisirs prévus', async () => {
      S[`loisirs${i}`] = await driver.createOperation({ direction: 'charge', label: `Sorties et loisirs ${months[i]}`, amount: 150, date: d(i, 22), costCenterRef: 'std:loisirs' });
    });
    at(d(i, 5), 'Loyer', async () => {
      await driver.settle(S.loyer, d(i, 5), 1300, d(i, 5));
      book(d(i, 5), 'lifeCharges', 1300);
    });
    at(d(i, 12), 'Courses', async () => {
      await driver.settle(S.courses, d(i, 12), 560 + 15 * i, d(i, 12));
      book(d(i, 12), 'lifeCharges', 560 + 15 * i);
    });
    at(d(i, 15), 'Énergie', async () => {
      await driver.settle(S.energie, d(i, 15), 95, d(i, 15));
      book(d(i, 15), 'lifeCharges', 95);
    });
    at(d(i, 22), 'Loisirs réglés', async () => {
      await driver.realize(S[`loisirs${i}`], 140 + 5 * i, d(i, 22));
      book(d(i, 22), 'lifeCharges', 140 + 5 * i);
    });
  }
  at(d(3, 2), 'Assurance habitation prévue', async () => {
    S.assurance = await driver.createOperation({ direction: 'charge', label: 'Assurance habitation (annuelle)', amount: 420, date: d(3, 18), costCenterRef: 'std:logement' });
  });
  at(d(3, 18), 'Assurance habitation réglée', async () => {
    await driver.realize(S.assurance, 420, d(3, 18));
    book(d(3, 18), 'lifeCharges', 420);
  });
  at(d(5, 25), 'Anniversaire prévu', async () => {
    S.anniversaire = await driver.createOperation({ direction: 'charge', label: 'Cadeau d’anniversaire', amount: 80, date: d(6, 28), costCenterRef: 'std:divers' });
  });
  at(d(6, 28), 'Anniversaire réglé', async () => {
    await driver.realize(S.anniversaire, 80, d(6, 28));
    book(d(6, 28), 'lifeCharges', 80);
  });

  // ---------- projets ----------
  const projects = {};
  const project = (key, mi, day, title, tasks, amount, shares = {}) => {
    const prj = { key, title, tasks: {} };
    projects[key] = prj;
    at(d(mi, day), `${title} : création et financement`, async () => {
      Object.assign(prj, await driver.createProject(title, tasks));
      prj.budgetId = await driver.adopt(prj);
      if (amount !== undefined) await driver.allocate(prj, amount);
      for (const [t, a] of Object.entries(shares)) await driver.share(prj, t, a);
      note(`${title} : créé dans le noyau (${tasks.length} tâches), financé${amount !== undefined ? ` : ${euros(cents(amount))} attribués${Object.keys(shares).length ? ', ventilés sur ses tâches' : ''}` : ' sans montant'}.`);
    });
    return prj;
  };
  const charge = (prj, mi, day, task, opLabel, amount, date) =>
    at(d(mi, day), `${prj.title} : dépense prévue « ${opLabel} »`, async () => {
      prj[opLabel] = await driver.createOperation({ budgetId: prj.budgetId, direction: 'charge', label: opLabel, amount, date, costCenterRef: 'std:divers', taskId: task ? prj.tasks[task] : null });
    });
  const pay = (prj, mi, day, opLabel, amount, { decision = 'approve', counted = true } = {}) =>
    at(d(mi, day), `${prj.title} : règlement de « ${opLabel} »`, async () => {
      const r = await driver.pay(prj, prj[opLabel], amount, d(mi, day), decision);
      if (r.overrunCents) note(`${prj.title} : « ${opLabel} » (${euros(cents(amount))}) dépasse le budget de ${euros(r.overrunCents)} → demande au budget de vie, ${decision === 'approve' ? 'autorisée' : 'refusée'}.`);
      if (r.saved) {
        if (counted) book(d(mi, day), 'projectCharges', amount);
        note(`${prj.title} : règlement de « ${opLabel} » validé (${euros(cents(amount))})${counted ? '' : ', hors budget de vie'}.`);
      } else {
        prj.refusedPayment = opLabel;
        note(`${prj.title} : règlement de « ${opLabel} » non enregistré.`);
      }
    });
  const status = (prj, mi, day, task, s) =>
    at(d(mi, day), `${prj.title} · ${task} → ${s}`, async () => {
      for (const m of await driver.status(prj, task, s)) note(`${prj.title} · ${task} : ${m}`);
    });
  const share = (prj, mi, day, task, amount, decision) =>
    at(d(mi, day), `${prj.title} : part de « ${task} »`, async () => {
      const r = await driver.share(prj, task, amount, decision);
      prj.shareResults = [...(prj.shareResults ?? []), r.saved];
      note(`${prj.title} : part de « ${task} » à ${euros(cents(amount))}${r.overrunCents ? ` → dépassement de ${euros(r.overrunCents)} ${decision === 'approve' ? 'autorisé' : 'refusé'} par le budget de vie` : ''}.`);
    });
  const bill = (mi) =>
    at(d(mi, 1), 'Facturation de fin de cycle', async () => {
      for (const b of await driver.bill()) note(`Fin de cycle : dépassement de « ${b.name} » facturé au budget de vie (${euros(b.billedOverrunCents)}), budget attribué porté à ${euros(b.allocationCents)}.`);
    });

  // P1 Cuisine équipée
  const p1 = project('P1', 0, 2, 'Cuisine équipée', ['Devis cuisiniste', 'Meubles et électroménager', 'Pose'], 5000, { 'Devis cuisiniste': 500, 'Meubles et électroménager': 3500, Pose: 1000 });
  at(d(0, 2), 'P1 retour', () => driver.setReturn(p1, 'Meubles et électroménager', { label: 'Revente de l’ancienne cuisine', amount: 150, cadence: 'once' }));
  charge(p1, 0, 2, 'Devis cuisiniste', 'Acompte devis', 500, d(0, 12));
  charge(p1, 0, 2, 'Meubles et électroménager', 'Meubles et électroménager', 3500, d(1, 10));
  charge(p1, 0, 2, 'Pose', 'Pose de la cuisine', 1000, d(2, 8));
  pay(p1, 0, 12, 'Acompte devis', 500);
  status(p1, 0, 12, 'Devis cuisiniste', 'done');
  status(p1, 0, 15, 'Meubles et électroménager', 'doing');
  pay(p1, 1, 10, 'Meubles et électroménager', 3400);
  status(p1, 1, 10, 'Meubles et électroménager', 'done');
  at(d(1, 25), 'Revente encaissée', async () => {
    const op = (await driver.operations()).find((o) => o.label === 'Revente de l’ancienne cuisine');
    await driver.realize(op.id, 150, d(1, 25));
    book(d(1, 25), 'income', 150);
    note('Cuisine équipée : revente de l’ancienne cuisine encaissée (150,00 €).');
  });
  status(p1, 2, 1, 'Pose', 'doing');
  pay(p1, 2, 8, 'Pose de la cuisine', 1000);
  status(p1, 2, 8, 'Pose', 'done');

  // P5 Location du garage
  const p5 = project('P5', 0, 3, 'Location du garage', ['Aménagement', 'Mise en location'], 400, { Aménagement: 400 });
  at(d(0, 3), 'P5 retour', () => driver.setReturn(p5, 'Mise en location', { label: 'Loyer du garage', amount: 90, cadence: 'monthly' }));
  charge(p5, 0, 3, 'Aménagement', 'Étagères et serrure', 400, d(0, 20));
  pay(p5, 0, 20, 'Étagères et serrure', 380);
  status(p5, 0, 20, 'Aménagement', 'done');
  status(p5, 1, 1, 'Mise en location', 'done');
  for (let i = 1; i < 7; i++) {
    at(d(i, 1), 'Loyer du garage encaissé', async () => {
      S.garage ??= (await driver.recurrences()).find((r) => r.label === 'Loyer du garage').id;
      await driver.settle(S.garage, d(i, 1), 90, d(i, 1));
      book(d(i, 1), 'income', 90);
      S.garageSettled = (S.garageSettled ?? 0) + 1;
    });
  }

  // P2 Voyage en Islande
  const p2 = project('P2', 1, 2, 'Voyage en Islande', ['Vols', 'Hébergements', 'Location de voiture'], 3000, { Vols: 1200, Hébergements: 1200, 'Location de voiture': 600 });
  charge(p2, 1, 2, 'Vols', 'Billets Reykjavik', 1200, d(1, 6));
  charge(p2, 1, 2, 'Hébergements', 'Hôtels et gîtes', 1200, d(1, 20));
  charge(p2, 1, 2, 'Location de voiture', '4x4 dix jours', 600, d(2, 4));
  pay(p2, 1, 6, 'Billets Reykjavik', 1450);
  status(p2, 1, 6, 'Vols', 'done');
  pay(p2, 1, 20, 'Hôtels et gîtes', 1350);
  status(p2, 1, 20, 'Hébergements', 'done');
  pay(p2, 2, 4, '4x4 dix jours', 650); // 3 450 > 3 000 : dépassement de 450 autorisé
  status(p2, 2, 4, 'Location de voiture', 'done');

  // P6 Permis moto
  const p6 = project('P6', 1, 2, 'Permis moto', ['Code', 'Leçons de conduite', 'Équipement moto'], 1500, { Code: 300, 'Leçons de conduite': 1200 });
  charge(p6, 1, 2, 'Code', 'Forfait code', 300, d(1, 10));
  at(d(1, 2), 'P6 leçons récurrentes', async () => {
    p6.lecons = await driver.createRecurrence({ budgetId: p6.budgetId, direction: 'charge', label: 'Leçons (forfait mensuel)', amount: 300, firstDate: d(1, 15), endDate: d(4, 15), costCenterRef: 'std:transport', taskId: p6.tasks['Leçons de conduite'] });
  });
  pay(p6, 1, 10, 'Forfait code', 300);
  status(p6, 1, 10, 'Code', 'done');
  status(p6, 1, 15, 'Leçons de conduite', 'doing');
  for (let i = 1; i <= 4; i++) {
    at(d(i, 15), 'P6 leçon réglée', async () => {
      await driver.settle(p6.lecons, d(i, 15), 300, d(i, 15));
      book(d(i, 15), 'projectCharges', 300);
    });
  }
  share(p6, 2, 16, 'Équipement moto', 400, 'refuse');
  status(p6, 4, 15, 'Leçons de conduite', 'done');

  // P3 Salle de bain
  const p3 = project('P3', 1, 3, 'Salle de bain', ['Plomberie', 'Carrelage', 'Mobilier'], 4000, { Plomberie: 1500, Carrelage: 1500, Mobilier: 1000 });
  charge(p3, 1, 3, 'Plomberie', 'Plombier', 1500, d(1, 20));
  charge(p3, 1, 3, 'Carrelage', 'Carreleur', 1500, d(2, 25));
  charge(p3, 1, 3, 'Mobilier', 'Meuble vasque et miroir', 1000, d(3, 20));
  pay(p3, 1, 20, 'Plombier', 1500);
  status(p3, 1, 20, 'Plomberie', 'done');
  share(p3, 2, 15, 'Carrelage', 2000, 'refuse');
  status(p3, 2, 15, 'Carrelage', 'doing');
  share(p3, 2, 20, 'Carrelage', 2000, 'approve');
  pay(p3, 2, 25, 'Carreleur', 2000);
  status(p3, 2, 25, 'Carrelage', 'done');
  pay(p3, 3, 20, 'Meuble vasque et miroir', 1000);
  status(p3, 3, 20, 'Mobilier', 'done');

  // P4 Vélo électrique
  const p4 = project('P4', 2, 2, 'Vélo électrique', ['Achat du vélo', 'Équipements'], 1200, { 'Achat du vélo': 1000, Équipements: 200 });
  charge(p4, 2, 2, 'Achat du vélo', 'Vélo cargo électrique', 1000, d(2, 20));
  status(p4, 2, 20, 'Achat du vélo', 'doing');

  // P7 Cabane au jardin (aucun montant attribué)
  const p7 = project('P7', 2, 2, 'Cabane au jardin', ['Plans', 'Construction']);
  charge(p7, 2, 2, 'Plans', 'Plans de la cabane', 120, d(2, 10));
  charge(p7, 2, 2, 'Construction', 'Bois et quincaillerie', 800, d(6, 15));
  pay(p7, 2, 10, 'Plans de la cabane', 120, { counted: false });

  // m3 : facturation des dépassements de m2, revalidation des parts du voyage, dépassement du vélo
  bill(3);
  at(d(3, 1), 'P2 revalidation', async () => {
    for (const [t, a] of [['Vols', 1450], ['Hébergements', 1350], ['Location de voiture', 650]]) await driver.share(p2, t, a);
    note('Voyage en Islande : parts revalidées sur les montants réels (budget = somme des parts).');
  });
  pay(p4, 3, 1, 'Vélo cargo électrique', 1150);
  status(p4, 3, 1, 'Achat du vélo', 'done');
  charge(p4, 3, 1, 'Équipements', 'Casque, antivol, sacoches', 250, d(3, 1));
  pay(p4, 3, 1, 'Casque, antivol, sacoches', 250); // 1 400 > 1 200 : dépassement de 200 autorisé
  status(p4, 3, 3, 'Équipements', 'done');
  bill(4);

  // P8 Rentrée scolaire
  const p8 = project('P8', 3, 25, 'Rentrée scolaire', ['Fournitures', 'Vêtements', 'Cantine'], 900, { Fournitures: 300, Vêtements: 400, Cantine: 200 });
  charge(p8, 3, 25, 'Fournitures', 'Cahiers, cartable, trousse', 300, d(4, 2));
  charge(p8, 3, 25, 'Vêtements', 'Vêtements de rentrée', 400, d(4, 6));
  at(d(3, 25), 'P8 cantine récurrente', async () => {
    p8.cantine = await driver.createRecurrence({ budgetId: p8.budgetId, direction: 'charge', label: 'Cantine', amount: 50, firstDate: d(4, 5), endDate: d(6, 5), costCenterRef: 'std:enfants', taskId: p8.tasks.Cantine });
  });
  pay(p8, 4, 2, 'Cahiers, cartable, trousse', 285);
  status(p8, 4, 2, 'Fournitures', 'done');
  status(p8, 4, 5, 'Cantine', 'doing');
  for (let i = 4; i <= 6; i++) {
    at(d(i, 5), 'P8 cantine réglée', async () => {
      await driver.settle(p8.cantine, d(i, 5), 50, d(i, 5));
      book(d(i, 5), 'projectCharges', 50);
    });
  }
  pay(p8, 4, 6, 'Vêtements de rentrée', 410);
  status(p8, 4, 6, 'Vêtements', 'done');

  // P9 Week-end à Lyon
  const p9 = project('P9', 5, 2, 'Week-end à Lyon', ['Train', 'Hôtel', 'Restaurants'], 700, { Train: 220, Hôtel: 380, Restaurants: 100 });
  charge(p9, 5, 2, 'Train', 'Billets de train', 220, d(5, 10));
  charge(p9, 5, 2, 'Hôtel', 'Hôtel deux nuits', 380, d(6, 8));
  charge(p9, 5, 2, 'Restaurants', 'Restaurants', 100, d(6, 14));
  pay(p9, 5, 10, 'Billets de train', 220);
  status(p9, 5, 10, 'Train', 'done');
  status(p9, 6, 7, 'Hôtel', 'doing');
  pay(p9, 6, 8, 'Hôtel deux nuits', 380);
  status(p9, 6, 8, 'Hôtel', 'done');
  pay(p9, 6, 14, 'Restaurants', 150); // 750 > 700 : dépassement de 50 autorisé, facturé à la fin de m6
  status(p9, 6, 14, 'Restaurants', 'done');

  // P10 Noël en famille
  const p10 = project('P10', 6, 3, 'Noël en famille', ['Cadeaux', 'Repas de Noël', 'Décoration'], 1200, { Cadeaux: 700, 'Repas de Noël': 400, Décoration: 100 });
  charge(p10, 6, 3, 'Cadeaux', 'Cadeaux des enfants', 700, d(6, 10));
  charge(p10, 6, 3, 'Décoration', 'Sapin et guirlandes', 100, d(6, 12));
  charge(p10, 6, 3, 'Repas de Noël', 'Courses du réveillon', 400, d(6, 24));
  status(p10, 6, 4, 'Cadeaux', 'doing');
  pay(p10, 6, 10, 'Cadeaux des enfants', 650);
  status(p10, 6, 10, 'Cadeaux', 'done');
  pay(p10, 6, 12, 'Sapin et guirlandes', 160);
  share(p10, 6, 13, 'Décoration', 160, 'approve'); // parts 1 260 > 1 200 : dépassement de 60 autorisé
  status(p10, 6, 13, 'Décoration', 'done');
  status(p10, 6, 20, 'Repas de Noël', 'doing');
  pay(p10, 6, 24, 'Courses du réveillon', 450);
  charge(p10, 6, 25, 'Repas de Noël', 'Bûche et chocolats', 90, d(6, 26));
  pay(p10, 6, 26, 'Bûche et chocolats', 90, { decision: 'refuse' }); // 1 350 > 1 260 : refusé, rien n'est écrit

  // ---------- jeu ----------
  events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  const previous = process.env.SOCLE_TODAY;
  let played = 0;
  try {
    for (const e of events) {
      if (e.date > stop) break;
      if (S.today !== e.date) {
        S.today = e.date;
        await driver.go(e.date);
      }
      log(`${e.date} ${e.text}`);
      try {
        await e.run();
      } catch (err) {
        throw new Error(`${e.date} « ${e.text} » : ${err.message}`, { cause: err });
      }
      played += 1;
    }

    // ---------- attendus ----------
    const closures = await driver.closures();
    const closureOf = (m) => closures.find((c) => c.periodKey === m);
    for (let i = 0; i < 6; i++) {
      const m = months[i];
      const l = ledger[m];
      expect(d(i + 1, 1), `Clôture ${m} : résultat = reçu − dépenses du budget de vie − charges de projet validées`, l.income - l.lifeCharges - l.projectCharges, () => closureOf(m)?.resultCents);
      expect(d(i + 1, 1), `Clôture ${m} : charges de projet validées enregistrées`, l.projectCharges, () => cents(closureOf(m)?.figures?.['bpm.chargesProjets']?.value ?? 0));
    }
    const cur = stop.slice(0, 7);
    if (ledger[cur]) {
      const l = ledger[cur];
      expect(d(0, 1), `Période en cours ${cur} : reçu`, l.income, async () => cents(await driver.figure('bpm.revenus', cur)));
      expect(d(0, 1), `Période en cours ${cur} : dépensé (budget de vie + projets validés)`, l.lifeCharges + l.projectCharges, async () => cents(await driver.figure('bpm.charges', cur)));
      expect(d(0, 1), `Période en cours ${cur} : charges de projet validées`, l.projectCharges, async () => cents(await driver.figure('bpm.chargesProjets', cur)));
    }
    const det = (p) => driver.projectDetail(p);
    expect(d(2, 8), 'P1 Cuisine : dans son budget, terminée', ['ok', 'done', 490000], async () => {
      const x = await det(p1);
      return [x.budget.state, x.project.view.status, x.budget.paidCents];
    });
    expect(d(3, 1), 'P2 Islande : dépassement facturé (450 €), budget 3 450 €, parts revalidées, contrôles au vert', [345000, 45000, false, true], async () => {
      const x = await det(p2);
      return [x.budget.allocationCents, x.budget.billedOverrunCents, x.budget.deficit, x.checks.every((c) => c.level === 'ok')];
    });
    expect(d(3, 20), 'P3 Salle de bain : part refusée puis autorisée, facturée, terminée', [[false, true], ['billed', 'refused'], 450000, 'done'], async () => {
      const x = await det(p3);
      return [p3.shareResults, x.overruns.map((o) => o.status).sort(), x.budget.allocationCents, x.project.view.status];
    });
    expect(d(4, 1), 'P4 Vélo : dépassement de 200 € facturé, budget 1 400 €, plus en rouge', [140000, 20000, false], async () => {
      const x = await det(p4);
      return [x.budget.allocationCents, x.budget.billedOverrunCents, x.budget.deficit];
    });
    expect(d(1, 1), 'P5 Garage : retour récurrent réglé chaque mois depuis la mise en location', true, async () => (await driver.recurrences()).some((r) => r.label === 'Loyer du garage' && r.budgetId === S.budgetId && r.settlementIds.length === S.garageSettled));
    expect(d(4, 15), 'P6 Permis : part refusée (rien n’est écrit), leçons réglées dans son budget', [[false], 150000, 'ok', 150000], async () => {
      const x = await det(p6);
      return [p6.shareResults, x.budget.sharesCents, x.budget.state, x.budget.paidCents];
    });
    expect(d(2, 10), 'P7 Cabane : sans montant attribué, hors budget de vie', 'unallocated', async () => (await det(p7)).budget.state);
    expect(d(6, 5), 'P8 Rentrée : dans son budget (845 € réglés sur 900 €)', ['ok', 84500], async () => {
      const x = await det(p8);
      return [x.budget.state, x.budget.paidCents];
    });
    expect(d(6, 14), 'P9 Lyon : dépassement de 50 € autorisé, en rouge jusqu’à la fin du cycle', [true, 'deficit', 5000, d(6, 31)], async () => {
      const x = await det(p9);
      return [x.budget.deficit, x.budget.state, x.budget.approvedOverrunCents, x.budget.nextBillingDate];
    });
    expect(d(6, 26), 'P10 Noël : part en dépassement autorisée (60 €), règlement en dépassement refusé (rien n’est écrit)', [true, 6000, 126000, 'Bûche et chocolats', 'planned'], async () => {
      const x = await det(p10);
      const buche = x.charges.find((c) => c.label === 'Bûche et chocolats');
      return [x.budget.deficit, x.budget.approvedOverrunCents, x.budget.paidCents, p10.refusedPayment, buche?.settled ? 'realized' : 'planned'];
    });
    expect(d(0, 1), 'Contrôles d’intégrité : aucun en échec', [], async () => (await driver.checks()).filter((c) => c.result === 'failed').map((c) => c.rule));

    const checks = [];
    for (const x of expectations) {
      if (x.after > stop) continue;
      const observed = await x.observed();
      checks.push({ name: x.name, expected: x.expected, observed, ok: JSON.stringify(x.expected) === JSON.stringify(observed) });
    }
    return { userId: S.userId, budgetId: S.budgetId, label, months, until: stop, played, total: events.length, steps, checks, ok: checks.every((c) => c.ok), ledger, projects };
  } finally {
    if (driver.name === 'services') {
      if (previous === undefined) delete process.env.SOCLE_TODAY;
      else process.env.SOCLE_TODAY = previous;
    }
  }
}

/** Compatibilité : scénario dans le processus sur un socle ouvert. */
export const runProjectScenarios = (socle, opts) => runScenario(serviceDriver(socle), opts);
