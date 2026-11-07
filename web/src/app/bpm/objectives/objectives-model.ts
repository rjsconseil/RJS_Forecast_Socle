import { BpmProjection, CoverageStatus, LifeGoal } from '../../core/bpm-models';

export type ObjectivesView = 'suivi' | 'reperes' | 'projection';
export const OBJECTIVE_FRAGMENTS = ['life-objectives', 'life-dated-goals', 'objectifs-budgetaires', 'cap-patrimonial', 'life-projection', 'hypotheses'];
export function objectivesView(view: string | null, fragment: string | null): ObjectivesView {
  if (['objectifs-budgetaires', 'cap-patrimonial', 'epargne'].includes(fragment ?? '')) return 'reperes';
  if (['life-projection', 'hypotheses', 'bv-chart-title', 'bv-alloc-title'].includes(fragment ?? '')) return 'projection';
  if (['life-objectives', 'life-dated-goals', 'bv-goals-title', 'objectifs'].includes(fragment ?? '')) return 'suivi';
  return view === 'reperes' || view === 'projection' ? view : 'suivi';
}

const LABELS: Record<CoverageStatus, string> = {
  funded: 'Couvert dans le scénario', partial: 'Partiellement couvert', unfunded: 'À financer',
  outOfHorizon: 'Hors horizon', unknown: 'À calculer',
};
/** Le scénario est une estimation, jamais la preuve d'un financement ou d'une réalisation. */
export function objectiveRows(goals: LifeGoal[], projection: BpmProjection | null, today: string) {
  const coverage = new Map((projection?.goals ?? []).map(g => [g.goalId, g]));
  return goals.filter(g => !g.removed).map(goal => {
    const cov = coverage.get(goal.id) ?? null;
    const status = cov?.status ?? 'unknown';
    const nominal = cov?.nominalTargetCents ?? null;
    const covered = cov?.coveredCents ?? null;
    return {
      goal, cov, status, statusLabel: LABELS[status],
      overdue: !!today && goal.date < today,
      gapCents: nominal === null || covered === null ? null : Math.max(0, nominal - covered),
      meter: cov?.coveragePct == null ? null : Math.max(0, Math.min(100, cov.coveragePct)),
    };
  });
}

export function normalizedSearch(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim();
}
