import { describe, expect, it } from 'vitest';
import { routes } from '../../app.routes';
import { BpmLifeManagement, LifeHealth } from '../../core/bpm-life.models';
import { followCount, lifeVolets, VoletLink } from './life-volets';

const info = (health: LifeHealth = 'ok', alert: string | null = null) => ({ health, healthLabel: { ok: 'En règle', watch: 'À surveiller', alert: 'À traiter', unknown: 'À renseigner' }[health], alert });

const nature = (key: 'indispensable' | 'courante', o: Record<string, unknown> = {}) => ({
  ...info(),
  key,
  label: key === 'indispensable' ? 'Charges indispensables' : 'Charges courantes',
  centers: key === 'indispensable' ? [{ ref: 'std:logement', label: 'Logement' }, { ref: 'std:sante', label: 'Santé' }] : [{ ref: 'std:loisirs', label: 'Loisirs' }],
  paidCents: 80000,
  toPayCents: 36000,
  plannedCents: 116000,
  consumedPct: 69,
  shareOfPaidPct: 70,
  lateCents: 0,
  lateCount: 0,
  dueTodayCount: 0,
  settledCount: 1,
  lineCount: 3,
  capCents: null,
  marginCents: null,
  overCount: 0,
  monthlyAverageCents: 110000,
  next: null,
  rows: [],
  lines: [],
  availableCents: key === 'courante' ? 25000 : undefined,
  availableReason: null,
  weeklyCents: key === 'courante' ? 6000 : undefined,
  ...o,
});

/** Lecture `life-management` minimale : un cycle actif, deux clôtures, un projet financé. */
function lecture(o: { surplus?: boolean; toClose?: number; noCycle?: boolean; savings?: number | null; closed?: boolean } = {}): BpmLifeManagement {
  const cycle = o.noCycle
    ? { ...info('unknown', 'Cycle budgétaire à configurer.'), key: 'cycle', label: 'Cycle en cours', reading: null, closedResultCents: null, status: 'to_configure', anchorDay: null, startDate: null, period: null, days: null, closedCount: 0, toCloseCount: 0, flows: null }
    : {
        ...info('watch', 'Le solde prévu passe sous le budget initial.'),
        key: 'cycle',
        label: o.closed ? 'Cycle clôturé' : 'Cycle en cours',
        reading: o.closed ? 'closed' : 'current',
        closedResultCents: o.closed ? -20000 : null,
        status: 'active',
        anchorDay: 1,
        startDate: '2026-08-01',
        period: { key: '2026-11', label: 'Novembre 2026', start: '2026-11-01', end: '2026-11-30', status: 'open' },
        days: { total: 30, elapsed: 3, left: 27, elapsedPct: 10 },
        closedCount: 2,
        toCloseCount: o.toClose ?? 1,
        flows: {
          receivedCents: 250000, toReceiveCents: 40000, paidCents: 115000, toPayCents: 41000, netCents: 135000, expectedCents: 134000,
          initialBudgetCents: 154000, gapToInitialCents: -20000, savingsRatePct: 54, consumptionPct: 74, projectsPaidCents: 20000,
          incomeCount: 2, receivedCount: 1, lateIncomeCents: 0, lateIncomeCount: 0, nextIncome: null, incomeLines: [],
        },
      };
  const closures = [
    { closureId: 'c1', periodKey: '2026-08', periodLabel: 'Août 2026', periodStart: '2026-08-01', periodEnd: '2026-08-31', resultCents: 170000, closedAt: '2026-09-01', targetCents: null, meetsTarget: null },
    { closureId: 'c2', periodKey: '2026-09', periodLabel: 'Septembre 2026', periodStart: '2026-09-01', periodEnd: '2026-09-30', resultCents: -20000, closedAt: '2026-10-01', targetCents: null, meetsTarget: null },
  ];
  const toClose = o.noCycle ? 0 : (o.toClose ?? 1);
  return {
    context: {} as BpmLifeManagement['context'],
    lifeProject: { coreProjectId: 'prj_vie', title: 'Projet de vie', description: null, budgetId: 'bud_vie', patrimoineId: 'pat_1', compositionId: 'cmp_1' },
    pilot: { volets: [], counts: { ok: 3, watch: 2, alert: 1, unknown: 0 } },
    cycle,
    natures: { indispensable: nature('indispensable', { ...info('alert', '1 échéance en retard.'), lateCount: 1, lateCents: 6000 }), courante: nature('courante') },
    projects: {
      ...info(), key: 'projets', label: 'Projets de la vie', projectCount: 2, fundedCount: 1, unfundedCount: 1, allocatedCents: 100000, paidCents: 20000, remainingCents: 80000,
      availableCents: 30000, approvedOverrunCents: 0, periodPaidCents: 20000, pendingRequests: [], taskRequestCount: 1, billable: [], billableCents: 0, nextBillingDate: null, deficitCount: 0, projects: [],
    },
    results: {
      ...info(toClose ? 'alert' : 'ok'), key: 'resultats', label: 'Résultats des cycles', rows: closures, count: 2, positiveCount: 1, negativeCount: 1, zeroCount: 0, metCount: 0,
      totalCents: 150000, averageCents: 75000, best: closures[0], worst: closures[1], last: closures[1], savingsTargetCents: o.savings ?? null,
      surplus: o.surplus
        ? { targetCents: 120000, periods: 12, startKey: '2026-08', endKey: '2027-07', perPeriodCents: 10000, cumulatedCents: 150000, closedPeriods: 2, progressPct: 125, targetToDateCents: 20000, gapCents: 130000, onTrack: true, remainingPeriods: 10, remainingCents: 0, requiredPerPeriodCents: null, reached: true }
        : null,
      current: o.noCycle ? null : { periodKey: '2026-11', expectedCents: 134000, targetCents: null, meetsTarget: null },
      toCloseCount: toClose,
      firstOpen: toClose ? { key: '2026-10', label: 'Octobre 2026', start: '2026-10-01', end: '2026-10-31', status: 'ended' } : null,
      closing: toClose ? { possible: true, reason: null, preview: null } : null,
      surplusUseNote: 'module à venir',
    },
    patrimoine: {
      ...info(), key: 'patrimoine', label: 'Patrimoine du projet de vie', patrimoineId: 'pat_1', stockCents: 1350000, stockReason: null, effectCents: 134000, afterCents: 1484000,
      expectedAfterCents: 1484000, objectiveCents: 5000000, progressPct: 27, remainingCents: 3650000, openingStockCents: 1200000, openingDate: '2026-08-01', capitalizedCents: 150000, capitalizationCount: 2, surplusUseNote: 'module à venir',
    },
    budgetType: { empty: false, averageIncomeCents: 250000, averageChargeCents: 150000, averageNetCents: 100000, byNature: { indispensable: 110000, courante: 40000 } },
    directives: { savingsCents: null, provisionsCents: null, availableCents: 25000, weeklyCents: 6000 },
    dueSoon: { from: '2026-10-01', to: '2026-11-10', lines: [], lateCount: 1 },
    essentials: { parameter: 'bpm.chargesIndispensables', refs: ['std:logement', 'std:sante'], labels: ['Logement', 'Santé'] },
  } as unknown as BpmLifeManagement;
}

/** Chemins déclarés (sans paramètre), pour vérifier que chaque lien d'un volet mène quelque part. */
function declared(link: string) {
  const path = link.replace(/^\//, '');
  return routes.some((r) => {
    if (r.path === undefined || r.redirectTo) return false;
    const re = new RegExp('^' + r.path.replace(/:[^/]+/g, '[^/]+') + '$');
    return re.test(path);
  });
}

describe('Gestion du projet de vie — volets', () => {
  it('compose les six volets dans l’ordre de pilotage', () => {
    const v = lifeVolets(lecture());
    expect(v.map((x) => x.key)).toEqual(['cycle', 'indispensable', 'courante', 'projets', 'resultats', 'patrimoine']);
    expect(v.map((x) => x.index)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const x of v) {
      expect(x.facts).toHaveLength(3);
      expect(x.actions).toHaveLength(4);
      expect(x.figures).toHaveLength(2);
    }
  });

  it('reprend l’état de santé de l’API et la couleur de jauge qui lui correspond', () => {
    const [cycle, essentials, , , results] = lifeVolets(lecture());
    expect([cycle.health, cycle.gauge.tone]).toEqual(['watch', 'orange']);
    expect([essentials.health, essentials.gauge.tone, essentials.alert]).toEqual(['alert', 'red', '1 échéance en retard.']);
    expect(results.health).toBe('alert');
  });

  it('ouvre les dépenses filtrées par nature depuis les volets des charges', () => {
    const [, essentials, current] = lifeVolets(lecture());
    expect(essentials.primary).toMatchObject({ link: '/depenses', queryParams: { nature: 'indispensable' } });
    expect(current.primary).toMatchObject({ link: '/depenses', queryParams: { nature: 'courante' } });
    expect(essentials.actions.find((a) => a.label === 'Échéances en retard')?.queryParams).toEqual({ nature: 'indispensable', status: 'late' });
  });

  it('propose la clôture de la première période terminée, sinon l’historique', () => {
    expect(lifeVolets(lecture()).find((x) => x.key === 'resultats')!.primary).toEqual({ label: 'Clôturer Octobre 2026', action: 'close' });
    expect(lifeVolets(lecture({ toClose: 0 })).find((x) => x.key === 'resultats')!.primary).toMatchObject({ link: '/tableau-de-bord', fragment: 'bm-history' });
  });

  it('mesure l’objectif d’excédent quand il existe, l’épargne visée ou les résultats sinon', () => {
    const gaugeOf = (d: BpmLifeManagement) => lifeVolets(d).find((x) => x.key === 'resultats')!.gauge;
    expect(gaugeOf(lecture({ surplus: true })).heading).toBe('Objectif d’excédent');
    expect(gaugeOf(lecture({ savings: 30000 })).heading).toBe('Épargne visée');
    expect(gaugeOf(lecture()).heading).toBe('Résultats des cycles');
  });

  it('reste lisible quand le cycle est à configurer', () => {
    const [cycle] = lifeVolets(lecture({ noCycle: true }));
    expect(cycle.title).toBe('Cycle à configurer');
    expect(lifeVolets(lecture())[0].title).toBe('Cycle en cours');
    expect(cycle.gauge.band).toMatchObject({ percent: null, tone: 'unknown' });
    expect(cycle.facts[0].value).toBe('—');
  });

  it('suit la période consultée : un cycle clôturé montre son résultat capitalisé', () => {
    const [cycle, , , , results] = lifeVolets(lecture({ closed: true }));
    expect(cycle.title).toBe('Cycle clôturé');
    expect(cycle.tag).toBe('Novembre 2026 · clôturé');
    expect(cycle.gauge.last.label).toBe('Résultat clôturé');
    expect(cycle.gauge.last.value).toMatch(/^−200,00\s€$/);
    expect(results.gauge.band?.label).toBe('Cycle lu · Novembre 2026');
  });

  it('compte les commandes « Suivi & clôture » en attente', () => {
    expect(followCount(lecture())).toBe(2); // 1 demande de tâche + 1 période à clôturer
    expect(followCount(lecture({ toClose: 0 }))).toBe(1);
  });

  it('ne pointe que vers des pages déclarées du site', () => {
    const links: VoletLink[] = lifeVolets(lecture()).flatMap((x) => [x.link, x.primary, ...x.actions]);
    for (const l of links.filter((x) => x.link)) expect(declared(l.link!), l.link).toBe(true);
  });

  it('nomme les entrées reçues d’avance : le solde du cycle s’explique', () => {
    const d = lecture();
    Object.assign(d.cycle.flows!, { receivedCents: 0, receivedCount: 1, incomeCount: 1, advanceReceivedCount: 1, advanceReceivedCents: 240000, advancePaidCents: 0, balancedCents: 91510 });
    const [cycle] = lifeVolets(d);
    expect(cycle.facts[1].note).toBe('Toutes reçues · dont 1 reçue d’avance');
    expect(cycle.gauge.caption).toMatch(/Reçu d’avance 2\s400,00\s€ · Avances comprises \+915,10\s€$/);
    expect(cycle.gauge.meter.percent).toBeNull();
    expect(cycle.gauge.meter.aria).toBe('Aucune entrée reçue');
  });

  it('explique Prévu ≠ Réglé + Reste : écart de réalisation et règlements d’un autre cycle', () => {
    const d = lecture();
    Object.assign(d.natures.indispensable, { realizationGapCents: 900, otherCyclePaidCents: 115000 });
    const essentials = lifeVolets(d).find((x) => x.key === 'indispensable')!;
    expect(essentials.gauge.caption).toMatch(/Écart réglé \/ prévu \+9,00\s€ · Dont 1\s150,00\s€ réglés pour un autre cycle$/);
  });

  it('sans projet de la vie : carte courte, sans jauge de zéros, qui propose d’en créer un', () => {
    const d = lecture();
    Object.assign(d.projects, { projectCount: 0, fundedCount: 0, unfundedCount: 0, allocatedCents: 0, paidCents: 0, remainingCents: 0, taskRequestCount: 0 });
    const projects = lifeVolets(d).find((x) => x.key === 'projets')!;
    expect([projects.hideGauge, projects.primary.link, projects.figures.length, projects.facts.length]).toEqual([true, '/creer', 0, 1]);
  });
  it('compte les catégories plafonnées dépassées dans le volet de leur nature', () => {
    const d = lecture();
    Object.assign(d.natures.courante, {
      overCount: 1,
      categories: [
        { id: 'k1', label: 'Cantine', ref: 'std:enfants', capCents: 10000, engagedCents: 11000, marginCents: -1000, over: true, near: false },
        { id: 'k2', label: 'Activités sportives', ref: 'std:enfants', capCents: 8000, engagedCents: 6000, marginCents: 2000, over: false, near: false },
      ],
    });
    const courante = lifeVolets(d).find((x) => x.key === 'courante')!;
    expect(courante.gauge.caption).toMatch(/^Aucun plafond par poste · 2 catégories plafonnées dont 1 dépassée \(Cantine −10,00\s€\)$/);
  });

  it('garde les deux postes dépassés quand une catégorie du même poste dépasse aussi', () => {
    const d = lecture();
    Object.assign(d.natures.indispensable, {
      capCents: 45000,
      marginCents: -4500,
      // Le total déduplique la catégorie déjà couverte par son poste.
      overCount: 2,
      rows: [{ ref: 'std:alimentation', over: true }, { ref: 'std:transport', over: true }],
      categories: [{ id: 'k1', label: 'Courses', ref: 'std:alimentation', capCents: 18000, engagedCents: 21500, marginCents: -3500, over: true, near: false }],
    });
    const essentials = lifeVolets(d).find((x) => x.key === 'indispensable')!;
    expect(essentials.gauge.caption).toContain('2 postes dépassés');
    expect(essentials.gauge.caption).toContain('1 catégorie plafonnée dont 1 dépassée');
  });

  it('cycle clôturé : nomme les entrées jamais reçues au lieu des retards', () => {
    const d = lecture({ closed: true });
    Object.assign(d.cycle.flows!, { unrealizedIncomeCount: 1, unrealizedIncomeCents: 14000, incomeGapCents: -100000 });
    const [cycle] = lifeVolets(d);
    expect(cycle.figures[1]).toEqual({ label: 'Jamais reçues', value: '1', pending: true });
    expect(cycle.gauge.caption).toMatch(/Écart reçu \/ prévu −1\s000,00\s€ · Jamais reçu 140,00\s€$/);
  });
  it('stock d’ouverture inconnu : l’objectif fixé n’est ni « à fixer » ni « atteint »', () => {
    const d = lecture();
    Object.assign(d.patrimoine, { ...{ health: 'unknown', healthLabel: 'À renseigner' }, stockCents: null, afterCents: null, openingStockCents: null, openingDate: null, progressPct: null, remainingCents: null, objectiveCents: 1500000 });
    const p = lifeVolets(d).find((x) => x.key === 'patrimoine')!;
    expect([p.facts[2].note, p.gauge.meter.aria, p.gauge.band?.percentLabel]).toEqual(['Avancement à mesurer : stock inconnu', 'Stock d’ouverture à renseigner', 'À mesurer']);
  });
  it('objectif de stock franchi : dit de combien, au lieu d’un reste à 0 €', () => {
    const d = lecture();
    Object.assign(d.patrimoine, { stockCents: 3416900, objectiveCents: 3380000, progressPct: 101, remainingCents: 0 });
    const p = lifeVolets(d).find((x) => x.key === 'patrimoine')!;
    expect(p.gauge.band?.label).toBe('Objectif atteint');
    expect(p.gauge.band?.value).toMatch(/^\+369,00\s€$/);
    expect(p.figures[0].label).toBe('Au-delà de l’objectif');
  });
});
