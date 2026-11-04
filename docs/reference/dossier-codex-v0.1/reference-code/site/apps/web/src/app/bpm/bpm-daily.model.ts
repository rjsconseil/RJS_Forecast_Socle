import { BpmProject } from './bpm.model';

/** Synthèse du cycle réel de clôture : indépendante de la loupe semaine/mois/année. */
export function dailyBudget(project: BpmProject, margin: number, cap: number | null = null) {
  const s = project.snapshot;
  if (!s) return null;
  const incomeLeft = s.plannedIncomeCents;
  const charges = s.plannedExpenseCents;
  const expected = s.netCents + incomeLeft - charges;
  const income = s.funding?.totalCents ?? s.incomeCents + incomeLeft;
  const elapsed = Math.round(
    Math.min(1, Math.max(0, s.period.elapsed / Math.max(1, s.period.length))) * 100,
  );
  const baseline = cap ?? income;
  const consumed = baseline > 0 ? Math.round((s.expenseCents / baseline) * 100) : null;
  const rhythm = !s.period.started
    ? 'future'
    : baseline <= 0 && s.expenseCents > 0 && cap !== null
      ? 'over'
      : consumed === null
        ? 'unknown'
        : consumed > 100
          ? 'over'
          : consumed > elapsed + margin
            ? 'fast'
            : 'steady';
  const risk = !s.period.started
    ? 'future'
    : expected < 0
      ? 'deficit'
      : s.netCents < 0
        ? 'waiting'
        : 'balanced';
  const pending = [...s.pending]
    .filter((flow) => flow.kind === 'expense')
    .sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));
  return {
    charges,
    incomeLeft,
    expected,
    elapsed,
    consumed,
    rhythm,
    risk,
    pending,
    net: s.netCents,
    spent: s.expenseCents,
    income,
    baseline,
    usesCap: cap !== null,
  };
}

export interface DailyPreferences {
  horizons: number[];
  charges: boolean;
  projections: boolean;
}
export function parseHorizons(value: string, max: number): number[] | null {
  const parts = value.split(/[;,\s]+/).filter(Boolean);
  if (!parts.length || parts.some((part) => !/^\d+$/.test(part))) return null;
  const years = [...new Set(parts.map(Number))].sort((a, b) => a - b);
  return years.every((year) => Number.isSafeInteger(year) && year >= 1 && year <= max)
    ? years
    : null;
}
