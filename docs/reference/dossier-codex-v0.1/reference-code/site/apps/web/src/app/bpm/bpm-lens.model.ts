import { pageText, registerPageTexts } from '../shared/page-text';
import { perLens } from '../shared/period-lens';
import {
  BpmCadence,
  BpmLensBucket,
  BpmLensView,
  BpmPeriodProfile,
  BpmProject,
  BpmWorkspace,
  wealthCurve,
} from './bpm.model';
import {
  BudgetDirectives,
  VisionSettings,
  budgetDirectives,
  eventProvisions,
  periodsPerYear,
  projectDirectives,
} from './bpm-vision.model';

const P = 'content.pages.bpm.bpm-lens.model.';
/** Les mots des vues par semaine, mois et année ; ils se personnalisent dans Configuration → Contenus. */
export const BPM_LENS_TEXTS: Record<string, string> = {
  'per-weekly': 'par semaine',
  'per-monthly': 'par mois',
  'per-yearly': 'par an',
  'this-weekly': 'cette semaine',
  'this-monthly': 'ce mois-ci',
  'this-yearly': 'cette année',
  'of-weekly': 'de la semaine',
  'of-monthly': 'du mois',
  'of-yearly': 'de l’année',
  'type-weekly': 'Une semaine type',
  'type-monthly': 'Un mois type',
  'type-yearly': 'Une année type',
  'name-weekly': 'Semaine',
  'name-monthly': 'Mois',
  'name-yearly': 'Année',
  'week-of': 'semaine du',
  'year-of': 'année',
};
registerPageTexts(
  Object.fromEntries(Object.entries(BPM_LENS_TEXTS).map(([key, value]) => [P + key, value])),
);

/** Un mot de la vue : « par semaine », « ce mois-ci », « de l’année », « Une année type »… */
export function lensWord(kind: 'per' | 'this' | 'of' | 'type' | 'name', lens: BpmCadence): string {
  return pageText(`${P}${kind}-${lens}`);
}
/** Les mots d'un intitulé de période (« semaine du 19 octobre », « année 2026 »). */
export function lensWords(): { week: string; year: string } {
  return { week: pageText(`${P}week-of`), year: pageText(`${P}year-of`) };
}

/** La périodicité du cycle de clôture d'un projet. */
export function cycleOf(project: BpmProject): BpmCadence {
  return project.link?.periodicity ?? 'monthly';
}
/** La fenêtre de la vue demandée, null si l'API ne la fournit pas encore. */
export function lensViewOf(project: BpmProject, lens: BpmCadence): BpmLensView | null {
  return project.snapshot?.lenses?.[lens] ?? null;
}
/** Un montant par période du cycle, ramené à la vue. */
export function toLens(cents: number, project: BpmProject, lens: BpmCadence): number {
  return perLens(cents, cycleOf(project), lens);
}
/** Un montant saisi par période de la vue, ramené au cycle avant l'enregistrement. */
export function fromLens(
  cents: number,
  project: BpmProject,
  lens: BpmCadence,
  previousCents?: number | null,
): number {
  // Une simple relecture ne doit pas modifier le cycle d'un centime par aller-retour d'arrondi.
  if (previousCents != null && toLens(previousCents, project, lens) === cents) return previousCents;
  return perLens(cents, lens, cycleOf(project));
}

/** Les directives d'une vue, avec la fenêtre qu'elles décrivent. */
export interface LensDirectives extends BudgetDirectives {
  lens: BpmCadence;
  view: BpmLensView | null;
  /**
   * Vue plus courte que le cycle : le reste libre du cycle et la part de ses jours
   * restants attribuée à la vue (null quand rien n'est réparti, dépassement compris).
   */
  cycleRemainingCents?: number | null;
  share?: number | null;
}

/**
 * Les directives vues par semaine, par mois ou par année. Pour la vue du cycle,
 * ce sont exactement les directives du cycle. Une vue plus courte que le cycle
 * reçoit une tranche du reste du cycle au prorata de ses jours restants (les
 * salaires d'une seule semaine ne rendent pas les autres semaines « en dépassement »).
 * Un dépassement du cycle, lui, ne se répartit pas : regarder une semaine ne le
 * réduit pas, il s'affiche en entier.
 * Une vue plus longue additionne le réalisé et le prévu de sa fenêtre face à
 * l'épargne et aux provisions du cycle ramenées à la vue.
 */
export function lensDirectives(
  project: BpmProject,
  workspace: BpmWorkspace,
  settings: VisionSettings,
  lens: BpmCadence,
): LensDirectives {
  const base = projectDirectives(project, workspace, settings);
  const cycle = cycleOf(project);
  const view = lensViewOf(project, lens);
  const snapshot = project.snapshot;
  if (!view || !snapshot || lens === cycle) return { ...base, lens: view ? lens : cycle, view };
  const convert = (cents: number) => perLens(cents, cycle, lens);
  const requiredCents = base.requiredCents === null ? null : convert(base.requiredCents);
  if (periodsPerYear(lens) > periodsPerYear(cycle)) {
    const share =
      snapshot.period.daysLeft > 0
        ? Math.min(view.daysLeft, snapshot.period.daysLeft) / snapshot.period.daysLeft
        : 0;
    const over = base.remainingCents !== null && base.remainingCents < 0;
    const remaining =
      base.remainingCents === null
        ? null
        : over
          ? base.remainingCents
          : Math.round(base.remainingCents * share);
    return {
      ...base,
      cycleRemainingCents: base.remainingCents,
      share: base.remainingCents === null || over ? null : share,
      requiredCents,
      plannedCents: convert(base.plannedCents),
      provisionCents: convert(base.provisionCents),
      incomeCents: view.incomeCents + view.remainingIncomeCents,
      spentCents: view.expenseCents,
      // Le plafond de la fenêtre : ce qui reste libre, plus ce qui y est déjà réglé et déjà prévu.
      spendingCapCents:
        remaining === null ? null : remaining + view.expenseCents + view.remainingExpenseCents,
      remainingCents: remaining,
      perWeekCents:
        remaining === null
          ? null
          : Math.round(Math.max(remaining, 0) / Math.max(view.daysLeft / 7, 1)),
      lens,
      view,
    };
  }
  // Les événements de la fenêtre sont déjà dans son prévu : on ne provisionne que ceux d'après.
  const later = (snapshot.upcoming ?? []).filter((event) => event.occurrenceDate >= view.end);
  const longer = budgetDirectives({
    requiredCents,
    plannedCents: convert(base.plannedCents),
    incomeCents: view.incomeCents + view.remainingIncomeCents,
    spentCents: view.expenseCents,
    plannedExpenseCents: view.remainingExpenseCents,
    provisionCents: eventProvisions(later, view.end, lens).totalPerPeriodCents,
    daysLeft: view.daysLeft,
  });
  return { ...longer, onTrack: base.onTrack, lens, view };
}

/** Le profil type ramené à la vue : une semaine, un mois ou une année ordinaires. */
export function lensProfile(
  profile: BpmPeriodProfile,
  project: BpmProject,
  lens: BpmCadence,
): BpmPeriodProfile {
  const convert = (cents: number) => toLens(cents, project, lens);
  return {
    incomes: profile.incomes.map((entry) => ({
      ...entry,
      perPeriodCents: convert(entry.perPeriodCents),
    })),
    expenses: profile.expenses.map((group) => ({
      ...group,
      totalCents: convert(group.totalCents),
      items: group.items.map((item) => ({ ...item, perPeriodCents: convert(item.perPeriodCents) })),
    })),
    incomeCents: convert(profile.incomeCents),
    expenseCents: convert(profile.expenseCents),
    naturalSavingCents: convert(profile.naturalSavingCents),
  };
}

/**
 * Ce qu'il faut mettre de côté pour un événement, dans la vue. Null quand la vue
 * est plus longue que le cycle et que l'événement tombe dans sa fenêtre : il est
 * déjà compté dans le prévu. Après la fenêtre, la provision ne dépasse jamais
 * le montant de l'événement.
 */
export function provisionInLens(
  event: { occurrenceDate: string; amountCents: number; perPeriodCents: number },
  project: BpmProject,
  lens: BpmCadence,
): number | null {
  const view = lensViewOf(project, lens);
  const longer = !!view && periodsPerYear(lens) < periodsPerYear(cycleOf(project));
  if (longer && event.occurrenceDate < view!.end) return null;
  const cents = toLens(event.perPeriodCents, project, lens);
  return longer ? Math.min(cents, event.amountCents) : cents;
}

/** Le dernier jour d'une fenêtre dont la fin est exclusive (« jusqu'au 31 décembre »). */
export function lastDayOf(end: string): string {
  const date = new Date(`${end}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** L'anneau d'une fenêtre : la part de ses jours déjà écoulés. */
export function lensRing(view: { elapsed: number; length: number }, radius = 52) {
  const circumference = 2 * Math.PI * radius;
  const ratio = view.length ? view.elapsed / view.length : 0;
  return {
    radius,
    circumference,
    dash: `${(circumference * ratio).toFixed(1)} ${circumference.toFixed(1)}`,
  };
}

/** La courbe du patrimoine d'une vue : sa valeur après chaque fenêtre passée, puis aujourd'hui. */
export function lensCurve(view: BpmLensView, todayCents: number | null, width = 320, height = 96) {
  const values = [
    ...view.buckets
      .filter((bucket) => bucket.state === 'past')
      .map((bucket) => bucket.patrimoineAfterCents),
    todayCents,
  ].filter((value): value is number => value !== null);
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || Math.max(Math.abs(max), 100);
  const step = width / (values.length - 1);
  const points = values.map((value, index) => ({
    x: index * step,
    y: 8 + ((max - value) / span) * (height - 16),
    value,
  }));
  const line = points
    .map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');
  return {
    width,
    height,
    line,
    area: `${line} L${width} ${height} L0 ${height} Z`,
    points,
    rising: values.at(-1)! >= values[0]!,
  };
}

/** Une vue encore sans fenêtre passée conserve les clôtures réelles du cycle.
 * Courbe, montants et dates choisissent toujours la même granularité. */
export function patrimoineTrend(project: BpmProject, view: BpmLensView | null) {
  const snapshot = project.snapshot;
  const curve = snapshot && view ? lensCurve(view, snapshot.standing.totalCents) : null;
  if (curve && view)
    return {
      curve,
      cadence: view.cadence,
      bars: view.buckets
        .filter((bucket) => bucket.state !== 'future')
        .slice(-6)
        .map((bucket) => ({ start: bucket.start, end: bucket.end, netCents: bucket.realizedNetCents })),
    };
  return {
    curve: snapshot ? wealthCurve(snapshot) : null,
    cadence: project.link?.periodicity,
    bars: (snapshot?.history ?? [])
      .slice(-6)
      .map((entry) => ({ start: entry.start, end: entry.end, netCents: entry.netCents })),
  };
}

/** Une colonne du graphique « réel face au prévu » : hauteurs relatives et sens des deux soldes. */
export interface LensBar {
  bucket: BpmLensBucket;
  realizedPct: number;
  plannedPct: number;
  realizedSign: 'positive' | 'negative' | 'zero';
  plannedSign: 'positive' | 'negative' | 'zero';
  /** Écart du réel au prévu, seulement pour les fenêtres passées ou en cours. */
  gapCents: number | null;
}
/** Le réel face au prévu, fenêtre par fenêtre : la base du graphique de pilotage. */
export function lensBars(view: BpmLensView): LensBar[] {
  const max = Math.max(
    1,
    ...view.buckets.flatMap((bucket) => [
      Math.abs(bucket.realizedNetCents),
      Math.abs(bucket.plannedNetCents),
    ]),
  );
  const sign = (cents: number) =>
    (cents > 0 ? 'positive' : cents < 0 ? 'negative' : 'zero') as LensBar['realizedSign'];
  return view.buckets.map((bucket) => ({
    bucket,
    realizedPct: Math.round((Math.abs(bucket.realizedNetCents) / max) * 100),
    plannedPct: Math.round((Math.abs(bucket.plannedNetCents) / max) * 100),
    realizedSign: sign(bucket.realizedNetCents),
    plannedSign: sign(bucket.plannedNetCents),
    gapCents: bucket.state === 'future' ? null : bucket.realizedNetCents - bucket.plannedNetCents,
  }));
}
