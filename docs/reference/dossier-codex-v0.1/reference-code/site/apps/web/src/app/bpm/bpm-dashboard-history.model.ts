/** Catalogue partagé par les deux représentations : la couleur suit la donnée. */
export const HISTORY_MEASURES = [
  'net',
  'income',
  'expense',
  'wealth',
  'contribution',
  'cumulative',
  'expectedNet',
  'expectedIncome',
  'expectedExpense',
  'pendingIncome',
  'pendingExpense',
  'lifeIncome',
  'lifeExpense',
  'lifeNet',
  'projectIncome',
  'projectExpense',
  'projectNet',
] as const;
export type HistoryMeasure = (typeof HISTORY_MEASURES)[number];
export const HISTORY_COLORS: Record<HistoryMeasure, string> = {
  net: 'var(--history-net)',
  wealth: 'var(--history-wealth)',
  income: 'var(--history-income)',
  expense: 'var(--history-expense)',
  contribution: 'var(--history-contribution)',
  cumulative: 'var(--history-cumulative)',
  expectedNet: 'var(--history-expectedNet)',
  expectedIncome: 'var(--history-expectedIncome)',
  expectedExpense: 'var(--history-expectedExpense)',
  pendingIncome: 'var(--history-pendingIncome)',
  pendingExpense: 'var(--history-pendingExpense)',
  lifeIncome: 'var(--history-lifeIncome)',
  lifeExpense: 'var(--history-lifeExpense)',
  lifeNet: 'var(--history-lifeNet)',
  projectIncome: 'var(--history-projectIncome)',
  projectExpense: 'var(--history-projectExpense)',
  projectNet: 'var(--history-projectNet)',
};
export const HISTORY_GROUPS: { id: string; measures: readonly HistoryMeasure[] }[] = [
  { id: 'actual', measures: ['net', 'income', 'expense'] },
  { id: 'wealth', measures: ['wealth', 'contribution', 'cumulative'] },
  {
    id: 'forecast',
    measures: [
      'expectedNet',
      'expectedIncome',
      'expectedExpense',
      'pendingIncome',
      'pendingExpense',
    ],
  },
  {
    id: 'projects',
    measures: [
      'lifeIncome',
      'lifeExpense',
      'lifeNet',
      'projectIncome',
      'projectExpense',
      'projectNet',
    ],
  },
];
export interface HistoryComposition {
  id: string;
  curves: HistoryMeasure[];
  bars: HistoryMeasure[];
}
export const HISTORY_COMPOSITIONS: readonly HistoryComposition[] = [
  { id: 'balance', curves: ['net'], bars: ['income', 'expense'] },
  { id: 'flows', curves: ['income', 'expense'], bars: ['net'] },
  { id: 'closing', curves: ['net', 'expectedNet'], bars: ['expectedIncome', 'expectedExpense'] },
  { id: 'wealth', curves: ['wealth'], bars: ['contribution'] },
  { id: 'growth', curves: ['wealth', 'cumulative'], bars: ['net'] },
  { id: 'contributions', curves: ['cumulative'], bars: ['contribution', 'net'] },
  { id: 'income', curves: ['income', 'expectedIncome'], bars: ['pendingIncome'] },
  { id: 'expenses', curves: ['expense', 'expectedExpense'], bars: ['pendingExpense'] },
  { id: 'pending', curves: ['expectedNet'], bars: ['pendingIncome', 'pendingExpense'] },
  { id: 'life-projects', curves: ['net'], bars: ['lifeExpense', 'projectExpense'] },
  { id: 'projects', curves: ['projectNet'], bars: ['projectIncome', 'projectExpense'] },
  { id: 'life', curves: ['lifeNet'], bars: ['lifeIncome', 'lifeExpense'] },
  { id: 'sources', curves: ['income'], bars: ['lifeIncome', 'projectIncome'] },
  { id: 'stock-flows', curves: ['wealth'], bars: ['income', 'expense'] },
  { id: 'net-contribution', curves: ['net'], bars: ['contribution'] },
  {
    id: 'forecast-wealth',
    curves: ['wealth', 'cumulative'],
    bars: ['contribution', 'expectedNet'],
  },
];
export function orderedMeasures(values: readonly HistoryMeasure[]): HistoryMeasure[] {
  return HISTORY_MEASURES.filter((value) => values.includes(value));
}
export function compositionOf(curves: HistoryMeasure[], bars: HistoryMeasure[]) {
  const equal = (a: HistoryMeasure[], b: HistoryMeasure[]) =>
    a.length === b.length && a.every((value) => b.includes(value));
  const direct = HISTORY_COMPOSITIONS.find((p) => equal(p.curves, curves) && equal(p.bars, bars));
  if (direct) return { composition: direct, inverted: false };
  const reverse = HISTORY_COMPOSITIONS.find((p) => equal(p.curves, bars) && equal(p.bars, curves));
  return reverse ? { composition: reverse, inverted: true } : null;
}

export type HistoryFormat = 'combined' | 'lines' | 'bars' | 'area' | 'pie' | 'donut';
export type HistoryPartition =
  'movements' | 'income-origin' | 'expense-origin' | 'income-progress' | 'expense-progress';
/** Répartitions sans double compte : aucun stock ni résultat ne s’ajoute à ses propres flux. */
export const HISTORY_PARTITIONS: Record<HistoryPartition, readonly HistoryMeasure[]> = {
  movements: ['income', 'expense'],
  'income-origin': ['lifeIncome', 'projectIncome'],
  'expense-origin': ['lifeExpense', 'projectExpense'],
  'income-progress': ['income', 'pendingIncome'],
  'expense-progress': ['expense', 'pendingExpense'],
};
/** Géométrie SVG ; les montants et leur signe restent portés par les légendes. */
export function historySlicePath(start: number, end: number): string {
  const point = (turn: number) => {
    const angle = turn * 2 * Math.PI - Math.PI / 2;
    return [100 + 88 * Math.cos(angle), 100 + 88 * Math.sin(angle)].join(',');
  };
  if (end - start >= 1 - Number.EPSILON)
    return 'M100,12 A88,88 0 1,1 100,188 A88,88 0 1,1 100,12 Z';
  return `M100,100 L${point(start)} A88,88 0 ${end - start > 0.5 ? 1 : 0},1 ${point(end)} Z`;
}
