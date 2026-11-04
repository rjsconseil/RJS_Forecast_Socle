/**
 * La vision patrimoniale d'un projet Budget/Patrimoine : où mener son
 * patrimoine au cours de sa vie. On gère le budget de la période ; son solde
 * nourrit le patrimoine ; la vision projette ce patrimoine année après année
 * avec un rendement visé, l'inflation annuelle et les objectifs de vie qu'il
 * doit financer (études des enfants, retraite, achat…). Tout est calculé à la
 * lecture : rien de ce qui suit n'est stocké.
 */
import type { BpmCadence, BpmProject, BpmWorkspace } from './bpm.model';

export type BpmGoalKind = 'etudes' | 'retraite' | 'achat' | 'securite' | 'transmission' | 'autre';
export const BPM_GOAL_KINDS: readonly BpmGoalKind[] = [
  'etudes',
  'retraite',
  'achat',
  'securite',
  'transmission',
  'autre',
];

/** Un objectif de vie : un montant en euros d'aujourd'hui, à une date. */
export interface BpmGoal {
  id: string;
  label: string;
  kind: BpmGoalKind;
  targetCents: number;
  targetDate: string;
  note: string;
  /** L'allocation du patrimoine qui porte l'objectif (par exemple l'assurance vie de l'héritage). */
  allocationId?: string | null;
}
/** Les choix du gestionnaire : rendement visé, épargne visée par période, objectifs. */
export interface BpmVision {
  returnPct: number | null;
  savingsTargetCents: number | null;
  goals: BpmGoal[];
  surplusGoal?: { targetCents: number; periods: number; startDate: string } | null;
}
/** Un point de l'indice d'inflation : saisi par le profil ou livré en référence. */
export interface BpmInflationPoint {
  year: number;
  ratePct: number;
  source: 'profil' | 'reference';
}

/**
 * Deux natures d'objectifs : ceux que le patrimoine paie l'année venue (études,
 * achat…) et ceux qu'il doit conserver à partir de leur date (héritage, retraite,
 * réserve de précaution) : l'argent reste placé, il n'est plus disponible.
 */
export const KEPT_GOALS: ReadonlySet<BpmGoalKind> = new Set(['retraite', 'securite', 'transmission']);

export const emptyVision = (): BpmVision => ({ returnPct: null, savingsTargetCents: null, goals: [] });

export function periodsPerYear(cadence: BpmCadence): number {
  return cadence === 'weekly' ? 52 : cadence === 'monthly' ? 12 : 1;
}

/** Le taux d'une année : l'indice connu de cette année, sinon l'hypothèse retenue. */
export function inflationRate(series: readonly BpmInflationPoint[], defaultPct: number) {
  const byYear = new Map(series.map((point) => [point.year, point.ratePct]));
  return (year: number) => byYear.get(year) ?? defaultPct;
}

/** L'apport retenu par période : l'épargne visée, sinon la moyenne des périodes clôturées. */
export function contributionPerPeriod(
  vision: BpmVision,
  history: readonly { netCents: number }[],
): { cents: number; source: 'objectif' | 'historique' | 'aucun' } {
  if (vision.savingsTargetCents !== null) return { cents: vision.savingsTargetCents, source: 'objectif' };
  if (history.length)
    return {
      cents: Math.round(history.reduce((sum, entry) => sum + entry.netCents, 0) / history.length),
      source: 'historique',
    };
  return { cents: 0, source: 'aucun' };
}

/** Live recurring profile drives future periods; past closures remain the fallback. */
export function contributionOf(project: BpmProject): { cents: number; source: 'objectif' | 'historique' | 'aucun' | 'recurrent' } {
  const vision = project.vision ?? emptyVision();
  if (vision.savingsTargetCents !== null) return { cents: vision.savingsTargetCents, source: 'objectif' };
  const profile = project.snapshot?.profile;
  if (profile && (profile.incomes.length || profile.expenses.length)) return { cents: profile.naturalSavingCents, source: 'recurrent' };
  return contributionPerPeriod(vision, project.snapshot?.history ?? []);
}

/**
 * L'apport retenu par la projection face à ce que les clôtures ont réellement
 * versé : la moyenne des périodes clôturées. Null tant que la projection repose
 * déjà sur cette moyenne, ou qu'il y a moins de deux clôtures pour en juger.
 */
export function contributionReality(project: BpmProject): {
  retainedCents: number;
  averageCents: number;
  closures: number;
  gapPct: number | null;
} | null {
  const retained = contributionOf(project);
  const history = project.snapshot?.history ?? [];
  if (retained.source === 'historique' || retained.source === 'aucun' || history.length < 2) return null;
  const averageCents = Math.round(history.reduce((sum, entry) => sum + entry.netCents, 0) / history.length);
  return {
    retainedCents: retained.cents,
    averageCents,
    closures: history.length,
    gapPct: retained.cents === 0 ? null : Math.round(((averageCents - retained.cents) / Math.abs(retained.cents)) * 100),
  };
}

export interface VisionInput {
  today: string;
  startCents: number;
  contributionPerPeriodCents: number;
  periodsPerYear: number;
  returnPct: number;
  inflation: (year: number) => number;
  horizonYears: number;
  goals: readonly BpmGoal[];
}
export type GoalStatus = 'finance' | 'partiel' | 'non-finance' | 'au-dela';
export interface GoalReading {
  goal: BpmGoal;
  year: number;
  targetNominalCents: number;
  coveredCents: number;
  coverage: number;
  status: GoalStatus;
}
export interface VisionYear {
  year: number;
  nominalCents: number;
  realCents: number;
  priceIndex: number;
}

/**
 * Projection annuelle. Chaque année : le patrimoine rapporte son rendement,
 * reçoit les apports du budget, puis paie les objectifs qui échoient (au plus
 * ce qu'il possède). La valeur réelle se lit en euros d'aujourd'hui.
 */
export function visionProjection(input: VisionInput) {
  const startYear = Number(input.today.slice(0, 4));
  const rate = input.returnPct / 100;
  const yearly = input.contributionPerPeriodCents * input.periodsPerYear;
  const yearOf = (goal: BpmGoal) => Math.max(Number(goal.targetDate.slice(0, 4)), startYear);
  const pending = [...input.goals].sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  const goals: GoalReading[] = [];
  let nominal = input.startCents;
  let priceIndex = 1;
  // Ce que les objectifs à conserver immobilisent : plus disponible pour les suivants.
  let reserved = 0;
  const pay = (year: number) => {
    for (const goal of pending.filter((entry) => yearOf(entry) === year)) {
      const need = goal.targetCents * priceIndex;
      const covered = Math.min(Math.max(nominal - reserved, 0), need);
      if (KEPT_GOALS.has(goal.kind)) reserved += covered;
      else nominal -= covered;
      const coverage = need ? covered / need : 1;
      goals.push({
        goal,
        year,
        targetNominalCents: Math.round(need),
        coveredCents: Math.round(covered),
        coverage,
        // Financé au centime près : un écart d'arrondi de moins d'un centime ne compte pas.
        status: need - covered < 1 ? 'finance' : coverage > 0 ? 'partiel' : 'non-finance',
      });
    }
  };
  pay(startYear);
  const years: VisionYear[] = [
    { year: startYear, nominalCents: Math.round(nominal), realCents: Math.round(nominal), priceIndex: 1 },
  ];
  for (let step = 1; step <= input.horizonYears; step++) {
    const year = startYear + step;
    priceIndex *= 1 + input.inflation(year) / 100;
    nominal = nominal * (1 + rate) + yearly;
    pay(year);
    years.push({
      year,
      nominalCents: Math.round(nominal),
      realCents: Math.round(nominal / priceIndex),
      priceIndex,
    });
  }
  const lastYear = startYear + input.horizonYears;
  for (const goal of pending.filter((entry) => yearOf(entry) > lastYear))
    goals.push({
      goal,
      year: yearOf(goal),
      targetNominalCents: 0,
      coveredCents: 0,
      coverage: 0,
      status: 'au-dela',
    });
  // Un capital à conserver n'est plus financé si des déficits ultérieurs l'ont consommé.
  let retainedAvailable = Math.max(nominal, 0);
  for (const reading of goals.filter(entry => KEPT_GOALS.has(entry.goal.kind) && entry.status !== 'au-dela')) {
    reading.coveredCents = Math.min(reading.coveredCents, Math.round(retainedAvailable));
    retainedAvailable -= reading.coveredCents;
    reading.coverage = reading.targetNominalCents ? reading.coveredCents / reading.targetNominalCents : 1;
    reading.status = reading.targetNominalCents - reading.coveredCents < 1 ? 'finance' : reading.coveredCents > 0 ? 'partiel' : 'non-finance';
  }
  const currentInflation = input.inflation(startYear) / 100;
  return {
    years,
    goals,
    final: years.at(-1)!,
    /** Pouvoir d'achat perdu en un an par un patrimoine qui ne rapporte rien. */
    erosionCents: Math.round(Math.max(input.startCents, 0) * (currentInflation / (1 + currentInflation))),
    /** Rendement réel : ce qui reste du rendement visé une fois l'inflation passée. */
    realReturnPct: ((1 + rate) / (1 + currentInflation) - 1) * 100,
  };
}

/** Deux courbes (valeur nominale et en euros d'aujourd'hui) et les repères des objectifs. */
export function visionChart(
  years: readonly VisionYear[],
  goals: readonly GoalReading[],
  width = 640,
  height = 200,
) {
  if (years.length < 2) return null;
  const values = years.flatMap((entry) => [entry.nominalCents, entry.realCents]);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 100;
  const x = (index: number) => (index / (years.length - 1)) * width;
  const y = (value: number) => 8 + ((max - value) / span) * (height - 16);
  const path = (pick: (entry: VisionYear) => number) =>
    years.map((entry, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(pick(entry)).toFixed(1)}`).join(' ');
  const nominal = path((entry) => entry.nominalCents);
  const first = years[0]!.year;
  return {
    width,
    height,
    nominal,
    area: `${nominal} L${width} ${y(0).toFixed(1)} L0 ${y(0).toFixed(1)} Z`,
    real: path((entry) => entry.realCents),
    zero: y(0),
    markers: goals
      .filter((reading) => reading.status !== 'au-dela')
      .map((reading) => ({ id: reading.goal.id, x: x(reading.year - first), status: reading.status })),
  };
}

/**
 * L'épargne par période qui finance tous les objectifs de l'horizon, au centime
 * près (recherche par dichotomie sur la projection). Négative : le patrimoine
 * suffit et peut même financer des dépenses. `null` sans objectif dans l'horizon.
 */
export function requiredContribution(input: VisionInput): number | null {
  const lastYear = Number(input.today.slice(0, 4)) + input.horizonYears;
  if (!input.goals.some((goal) => Number(goal.targetDate.slice(0, 4)) <= lastYear)) return null;
  const funded = (cents: number) =>
    visionProjection({ ...input, contributionPerPeriodCents: cents })
      .goals.filter((entry) => entry.status !== 'au-dela')
      .every((entry) => entry.status === 'finance');
  const total = input.goals.reduce((sum, goal) => sum + goal.targetCents, 0);
  let high = Math.max(total, 100);
  for (let guard = 0; !funded(high) && guard < 40; guard++) high *= 2;
  if (!funded(high)) return null;
  let low = -high;
  if (funded(low)) return low;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (funded(middle)) high = middle;
    else low = middle;
  }
  return high;
}

/** Les directives de la période, déduites des objectifs : épargner, ne pas dépasser, répartir. */
export interface BudgetDirectives {
  requiredCents: number | null;
  provisionCents: number;
  plannedCents: number;
  onTrack: boolean | null;
  incomeCents: number;
  spendingCapCents: number | null;
  spentCents: number;
  remainingCents: number | null;
  perWeekCents: number | null;
}
export function budgetDirectives(input: {
  requiredCents: number | null;
  plannedCents: number;
  incomeCents: number;
  spentCents: number;
  /** Les sorties encore prévues d'ici la clôture : elles ne sont plus libres. */
  plannedExpenseCents?: number;
  /** Ce qu'il faut mettre de côté cette période pour les événements à venir. */
  provisionCents?: number;
  daysLeft: number;
}): BudgetDirectives {
  const cap =
    input.requiredCents === null
      ? null
      : input.incomeCents - Math.max(input.requiredCents, 0) - (input.provisionCents ?? 0);
  const remaining = cap === null ? null : cap - input.spentCents - (input.plannedExpenseCents ?? 0);
  const weeks = Math.max(input.daysLeft / 7, 1);
  return {
    requiredCents: input.requiredCents,
    provisionCents: input.provisionCents ?? 0,
    plannedCents: input.plannedCents,
    onTrack: input.requiredCents === null ? null : input.plannedCents >= input.requiredCents,
    incomeCents: input.incomeCents,
    spendingCapCents: cap,
    spentCents: input.spentCents,
    remainingCents: remaining,
    perWeekCents: remaining === null ? null : Math.round(Math.max(remaining, 0) / weeks),
  };
}

/** Les entrées attendues par période : la moyenne des clôtures, sinon le réel de la période. */
export function expectedIncome(history: readonly { incomeCents: number }[], currentIncomeCents: number): number {
  if (!history.length) return currentIncomeCents;
  return Math.round(history.reduce((sum, entry) => sum + entry.incomeCents, 0) / history.length);
}

/** Les hypothèses retenues : réglages livrés ou choisis dans Configuration. */
export interface VisionSettings {
  inflationDefault: number;
  returnDefault: number;
  horizonYears: number;
}

/** La projection d'un projet, avec un effort supplémentaire éventuel par période. */
export function visionInputOf(
  project: BpmProject,
  workspace: BpmWorkspace,
  settings: VisionSettings,
  extraCents = 0,
): VisionInput {
  const vision = project.vision ?? emptyVision();
  return {
    today: workspace.today,
    startCents: project.snapshot?.standing.totalCents ?? 0,
    contributionPerPeriodCents: contributionOf(project).cents + extraCents,
    periodsPerYear: periodsPerYear(project.link?.periodicity ?? 'monthly'),
    returnPct: vision.returnPct ?? settings.returnDefault,
    inflation: inflationRate(workspace.inflation?.effective ?? [], settings.inflationDefault),
    horizonYears: settings.horizonYears,
    goals: vision.goals,
  };
}

/**
 * Les directives de la période en cours : ce qu'il faut épargner pour les
 * objectifs, et donc ce qu'il reste à dépenser d'ici la clôture.
 */
export function projectDirectives(project: BpmProject, workspace: BpmWorkspace, settings: VisionSettings): BudgetDirectives {
  const input = visionInputOf(project, workspace, settings);
  const snapshot = project.snapshot;
  return budgetDirectives({
    requiredCents: Math.max(requiredContribution(input) ?? 0, budgetSurplusProgress(project)?.requiredPerPeriodCents ?? 0, project.vision?.savingsTargetCents ?? 0),
    plannedCents: input.contributionPerPeriodCents,
    incomeCents: snapshot ? snapshot.incomeCents + snapshot.plannedIncomeCents : 0,
    spentCents: snapshot?.expenseCents ?? 0,
    plannedExpenseCents: snapshot?.plannedExpenseCents ?? 0,
    provisionCents: snapshot ? eventProvisions(snapshot.upcoming ?? [], snapshot.period.end, project.link?.periodicity ?? 'monthly').totalPerPeriodCents : 0,
    daysLeft: snapshot?.period.daysLeft ?? 0,
  });
}

/** Le nombre de périodes entières entre deux dates selon la périodicité du cycle. */
export function periodsBetween(from: string, to: string, cadence: BpmCadence): number {
  if (to <= from) return 0;
  if (cadence === 'weekly')
    return Math.floor((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / (7 * 86_400_000));
  const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
  return cadence === 'monthly' ? months : Math.floor(months / 12);
}

/**
 * Provisionner les événements à venir (Noël, vacances…) : chaque dépense prévue
 * est répartie sur les périodes qui la précèdent, période en cours comprise. Les
 * entrées attendues (dons…) sont listées à part, sans être anticipées.
 */
export function eventProvisions<T extends { title: string; kind: 'income' | 'expense'; occurrenceDate: string; amountCents: number }>(
  upcoming: readonly T[],
  periodEnd: string,
  cadence: BpmCadence,
) {
  const items = upcoming
    .filter((entry) => entry.kind === 'expense')
    .map((entry) => {
      const periodsLeft = periodsBetween(periodEnd, entry.occurrenceDate, cadence) + 1;
      return { ...entry, periodsLeft, perPeriodCents: Math.ceil(entry.amountCents / periodsLeft) };
    });
  return {
    items,
    incomes: upcoming.filter((entry) => entry.kind === 'income'),
    totalPerPeriodCents: items.reduce((sum, entry) => sum + entry.perPeriodCents, 0),
  };
}

/**
 * Plafonds conseillés par poste : les dépenses réglées et prévues de chaque poste
 * dans la période ; si leur total dépasse le plafond des directives, chaque poste
 * reçoit une part réduite dans la même proportion.
 */
export function centerAllowances(
  centers: readonly { id: string; name: string; limitCents: number | null; spentCents: number }[],
  pending: readonly { kind: 'income' | 'expense'; centerId: string | null; amountCents: number }[],
  capCents: number | null,
) {
  const rows = centers
    .map((center) => {
      const plannedCents = pending
        .filter((entry) => entry.kind === 'expense' && (entry.centerId ?? '') === center.id)
        .reduce((sum, entry) => sum + entry.amountCents, 0);
      return { ...center, plannedCents, expectedCents: center.spentCents + plannedCents };
    })
    .filter((row) => row.expectedCents > 0);
  const totalExpectedCents = rows.reduce((sum, row) => sum + row.expectedCents, 0);
  const overCents = capCents === null ? 0 : Math.max(totalExpectedCents - capCents, 0);
  const ratio = overCents > 0 && totalExpectedCents > 0 ? Math.max(capCents ?? 0, 0) / totalExpectedCents : 1;
  return {
    rows: rows
      .map((row) => ({ ...row, allowanceCents: ratio < 1 ? Math.floor(row.expectedCents * ratio) : null }))
      .sort((a, b) => b.expectedCents - a.expectedCents),
    totalExpectedCents,
    overCents,
  };
}


/** L'objectif cumulé commence à une période précise ; seules ses clôtures comptent. */
export function budgetSurplusProgress(project: BpmProject) {
  const goal = project.vision?.surplusGoal;
  if (!goal) return null;
  const cadence = project.link?.periodicity ?? 'monthly';
  const end = advancePeriods(goal.startDate, cadence, goal.periods);
  const history = (project.snapshot?.history ?? []).filter(x => x.start >= goal.startDate && x.start < end);
  const achievedCents = history.reduce((sum, x) => sum + x.netCents, 0);
  const elapsed = Math.min(goal.periods, periodsBetween(goal.startDate, project.snapshot?.period.start ?? goal.startDate, cadence));
  const remainingPeriods = Math.max(goal.periods - elapsed, 0);
  const remainingCents = Math.max(goal.targetCents - achievedCents, 0);
  const minimum = Math.max(project.vision?.savingsTargetCents ?? 0, 0);
  return { end, achievedCents, remainingCents, remainingPeriods,
    requiredPerPeriodCents: remainingPeriods ? Math.max(minimum, Math.ceil(remainingCents / remainingPeriods)) : minimum,
    finalPeriodCents: remainingPeriods ? Math.max(minimum, remainingCents - minimum * (remainingPeriods - 1)) : 0,
    reached: achievedCents >= goal.targetCents };
}
export function advancePeriods(start: string, cadence: BpmCadence, count: number): string {
  const date = new Date(start + 'T12:00:00Z');
  if (cadence === 'weekly') date.setUTCDate(date.getUTCDate() + count * 7);
  else { date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + count * (cadence === 'yearly' ? 12 : 1)); }
  return date.toISOString().slice(0, 10);
}
