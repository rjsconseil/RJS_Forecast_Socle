import type { BpmExpenseRegister } from './bpm-expenses.model';
import type { FlowPilot } from './bpm-flow-pilot.model';
import { BpmFunding, BpmBudgetCost, BpmCadence, BpmPendingFlow, BpmStatementEntry } from './bpm.model';

/**
 * Le parcours de l'argent : où est allé chaque euro reçu sur une fenêtre. Une
 * première couche à plat (entrées, postes, à préciser, reste) et, pour chaque
 * ligne, le détail que l'on creuse sur sa page dédiée. Calculs purs, à partir du
 * relevé que l'API recompose depuis les règlements réels : rien n'est stocké ici.
 */
export interface BpmStatement {
  flowPilot?: FlowPilot;
  /** Stock connu à la clôture : actifs et versements datés avant end, clôtures jusqu’à end. */
  wealthAtEnd?: {
    date: string;
    totalCents: number | null;
    budgetFlowCents: number;
    assetsCents: number | null;
    entityTransferCents: number;
  };
  periodFlows?:Record<'income'|'expense',Pick<BpmExpenseRegister,'rows'|'operations'>>;
  incomeCenters?: {id:string;name:string}[];
  funding?:BpmFunding;
  budgetProjects?: BpmBudgetCost[];
  projectId: string;
  start: string;
  end: string;
  today: string;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  remainingIncomeCents: number;
  remainingExpenseCents: number;
  pending: BpmPendingFlow[];
  centers: {
    id: string;
    name: string;
    limitCents: number | null;
    spentCents: number;
    plannedCents: number;
  }[];
  incomes: { title: string; receivedCents: number; plannedCents: number }[];
  entries: BpmStatementEntry[];
  /** Fenêtre entièrement clôturée : ses montants ne bougent plus, seules les précisions restent. */
  closed: boolean;
  closure: { netCents: number; patrimoineAfterCents: number | null } | null;
}

/** Les natures que l'on peut creuser : un poste, les entrées, le « à préciser », le reste. */
export type MoneyNature = 'poste' | 'entrees' | 'a-preciser' | 'reste';
export const MONEY_NATURES: readonly MoneyNature[] = ['poste', 'entrees', 'a-preciser', 'reste'];

/** Une somme détaillée : les montants d'un même libellé additionnés. */
export interface MoneySubSum {
  title: string;
  cents: number;
  count: number;
}
/** Une ligne de la première couche, avec ses rappels et le lien vers sa page dédiée. */
export interface MoneyLine {
  nature: MoneyNature;
  /** Le poste pour une ligne `poste` ; vide sinon. */
  id: string;
  name: string;
  cents: number;
  /** Ce qui reste prévu d'ici la fin de la fenêtre (échéances non enregistrées). */
  plannedCents: number;
  /** Part de la base du relevé (entrées reçues, ou dépenses tant qu'elles les dépassent), de 0 à 100. */
  shareOfIncome: number | null;
  count: number;
  /** Rappels : montants accompagnés d'une note, et les deux plus grosses sommes détaillées. */
  notes: number;
  top: MoneySubSum[];
  limitCents: number | null;
}

const TOP = 2;

/** Additionne les montants par libellé, du plus gros au plus petit. */
export function subSums(entries: readonly { title: string; amountCents: number }[]): MoneySubSum[] {
  const sums = new Map<string, MoneySubSum>();
  for (const entry of entries) {
    const key = entry.title || '—';
    const current = sums.get(key) ?? { title: key, cents: 0, count: 0 };
    current.cents += entry.amountCents;
    current.count += 1;
    sums.set(key, current);
  }
  return [...sums.values()].sort((a, b) => b.cents - a.cents || a.title.localeCompare(b.title, 'fr'));
}

const share = (cents: number, base: number): number | null =>
  base > 0 ? Math.round((cents / base) * 1000) / 10 : null;

/**
 * La base des parts : les entrées reçues, tant qu'elles couvrent les dépenses.
 * Avant les salaires, on lit plutôt « sur 100 € dépensés » : une part de plus de
 * 100 % des entrées n'apprend rien.
 */
export function shareBasis(statement: Pick<BpmStatement, 'incomeCents' | 'expenseCents'>): 'income' | 'expense' {
  return statement.incomeCents > 0 && statement.incomeCents >= statement.expenseCents ? 'income' : 'expense';
}
/** Le solde attendu à la fin de la fenêtre si tout le prévu se réalise. */
export function expectedRest(statement: BpmStatement): number {
  return statement.netCents + statement.remainingIncomeCents - statement.remainingExpenseCents;
}
/**
 * L'état du reste : définitif (fenêtre close), provisoire couvert (négatif à ce
 * jour mais compensé par les entrées attendues), ou simplement à ce jour.
 */
export function restState(statement: BpmStatement): 'saved' | 'drawn' | 'pending' | 'short' {
  if (statement.closed) return statement.netCents < 0 ? 'drawn' : 'saved';
  if (statement.netCents >= 0) return 'saved';
  return expectedRest(statement) >= 0 ? 'pending' : 'short';
}

/** Les montants d'une ligne, tels que sa page dédiée les détaille. */
export function entriesOf(
  statement: BpmStatement,
  nature: MoneyNature,
  id = '',
): BpmStatementEntry[] {
  switch (nature) {
    case 'entrees':
      return statement.entries.filter((entry) => entry.kind === 'income');
    case 'a-preciser':
      return statement.entries.filter((entry) => entry.kind === 'expense' && !entry.centerId);
    case 'poste':
      return statement.entries.filter((entry) => entry.kind === 'expense' && entry.centerId === id);
    case 'reste':
      return statement.entries;
  }
}

/** Les échéances encore à venir d'une ligne dans la fenêtre. */
export function pendingOf(statement: BpmStatement, nature: MoneyNature, id = ''): BpmPendingFlow[] {
  switch (nature) {
    case 'entrees':
      return statement.pending.filter((entry) => entry.kind === 'income');
    case 'a-preciser':
      return statement.pending.filter((entry) => entry.kind === 'expense' && !entry.centerId);
    case 'poste':
      return statement.pending.filter((entry) => entry.kind === 'expense' && entry.centerId === id);
    case 'reste':
      return statement.pending;
  }
}

/**
 * La première couche du parcours : les entrées reçues, chaque poste qui a vu
 * passer de l'argent (ou en attend), le « à préciser », puis le reste. Chaque
 * ligne garde ses rappels ; sa page dédiée en donne le détail.
 */
export function moneyLines(statement: BpmStatement): {
  income: MoneyLine;
  outflows: MoneyLine[];
  rest: MoneyLine;
} {
  const income = shareBasis(statement) === 'income' ? statement.incomeCents : statement.expenseCents;
  const line = (nature: MoneyNature, id: string, name: string, entries: BpmStatementEntry[], planned: number, limitCents: number | null): MoneyLine => {
    const cents = entries.reduce((sum, entry) => sum + entry.amountCents, 0);
    return {
      nature,
      id,
      name,
      cents,
      plannedCents: planned,
      shareOfIncome: share(cents, income),
      count: entries.length,
      notes: entries.filter((entry) => entry.note.trim()).length,
      top: subSums(entries).slice(0, TOP),
      limitCents,
    };
  };
  const incomes = entriesOf(statement, 'entrees');
  const outflows = statement.centers
    .filter((center) => center.id && (center.spentCents > 0 || center.plannedCents > 0))
    .map((center) =>
      line('poste', center.id, center.name, entriesOf(statement, 'poste', center.id), center.plannedCents, center.limitCents),
    )
    .sort((a, b) => b.cents - a.cents || b.plannedCents - a.plannedCents);
  const loose = entriesOf(statement, 'a-preciser');
  const loosePlanned = pendingOf(statement, 'a-preciser').reduce((sum, entry) => sum + entry.amountCents, 0);
  if (loose.length || loosePlanned) outflows.push(line('a-preciser', '', '', loose, loosePlanned, null));
  return {
    income: {
      ...line('entrees', '', '', incomes, statement.remainingIncomeCents, null),
      shareOfIncome: null,
    },
    outflows,
    rest: {
      nature: 'reste',
      id: '',
      name: '',
      cents: statement.netCents,
      plannedCents: statement.remainingIncomeCents - statement.remainingExpenseCents,
      shareOfIncome: shareBasis(statement) === 'income' ? share(statement.netCents, income) : null,
      count: statement.entries.length,
      notes: statement.entries.filter((entry) => entry.note.trim()).length,
      top: [],
      limitCents: null,
    },
  };
}

/**
 * La barre du parcours : 100 % de ce qui a circulé (le plus grand des reçus et
 * des dépensés). Chaque poste prend sa part ; le reste positif va au patrimoine,
 * un reste négatif est pris sur le patrimoine.
 */
export interface MoneySegment {
  nature: MoneyNature | 'drawn';
  id: string;
  name: string;
  cents: number;
  pct: number;
}
export function moneySegments(statement: BpmStatement): MoneySegment[] {
  const { outflows } = moneyLines(statement);
  const base = Math.max(statement.incomeCents, statement.expenseCents);
  if (base <= 0) return [];
  const pct = (cents: number) => Math.round((cents / base) * 1000) / 10;
  const segments: MoneySegment[] = outflows
    .filter((entry) => entry.cents > 0)
    .map((entry) => ({ nature: entry.nature, id: entry.id, name: entry.name, cents: entry.cents, pct: pct(entry.cents) }));
  if (statement.netCents > 0)
    segments.push({ nature: 'reste', id: '', name: '', cents: statement.netCents, pct: pct(statement.netCents) });
  return segments;
}

/**
 * « Sur 100 € reçus » (ou « dépensés » tant que les dépenses dépassent les
 * entrées) : la part de chaque poste, et du reste quand il y en a un.
 */
export function perHundred(statement: BpmStatement): {
  basis: 'income' | 'expense';
  parts: { nature: MoneyNature; id: string; name: string; euros: number }[];
} {
  const basis = shareBasis(statement);
  const base = basis === 'income' ? statement.incomeCents : statement.expenseCents;
  if (base <= 0) return { basis, parts: [] };
  const { outflows, rest } = moneyLines(statement);
  const lines = basis === 'income' ? [...outflows, rest] : outflows;
  return {
    basis,
    parts: lines
      .filter((entry) => entry.cents !== 0)
      .map((entry) => ({
        nature: entry.nature,
        id: entry.id,
        name: entry.name,
        euros: Math.round((entry.cents / base) * 100),
      })),
  };
}

/** La cadence d'une fenêtre d'après sa durée : 7 jours, un mois ou une année. */
export function cadenceOfWindow(start: string, end: string): BpmCadence {
  const days = Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000);
  return days <= 7 ? 'weekly' : days <= 31 ? 'monthly' : 'yearly';
}

/** La fenêtre précédente ou suivante, de même cadence. */
export function shiftWindow(start: string, end: string, step: -1 | 1): { start: string; end: string } {
  const cadence = cadenceOfWindow(start, end);
  const move = (value: string, count: number) => {
    const date = new Date(`${value}T12:00:00Z`);
    if (cadence === 'weekly') date.setUTCDate(date.getUTCDate() + 7 * count);
    else if (cadence === 'monthly') date.setUTCMonth(date.getUTCMonth() + count, 1);
    else date.setUTCFullYear(date.getUTCFullYear() + count, 0, 1);
    return date.toISOString().slice(0, 10);
  };
  return step < 0 ? { start: move(start, -1), end: start } : { start: end, end: move(end, 1) };
}

/** Ce que l'on peut encore expliquer : l'écart entre le reste calculé et l'argent réellement restant. */
export function unexplainedGap(statement: BpmStatement, actualRemainingCents: number | null): number | null {
  return actualRemainingCents === null ? null : statement.netCents - actualRemainingCents;
}
