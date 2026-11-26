import { BpmBudgetRef, BpmContextInfo, RegisterLine } from './bpm-models';

export interface ProjectFlowTotals {
  paidCents: number; receivedCents: number; netCents: number; count: number;
  pendingPaidCents: number; pendingReceivedCents: number; pendingCount: number;
}
export interface BpmProjectFlows {
  context: BpmContextInfo;
  source: 'cycle' | 'patrimoine' | 'all';
  from: string | null; to: string; pendingUntil: string;
  totals: ProjectFlowTotals;
  bySource: Record<'cycle' | 'patrimoine', ProjectFlowTotals>;
  projects: (BpmBudgetRef & ProjectFlowTotals)[];
  lines: RegisterLine[]; pending: RegisterLine[]; paymentTrace: RegisterLine[]; announcementTrace: RegisterLine[];
}
interface OutlookPeriod { key: string; label: string; start: string; end: string }
export interface OutlookCycle {
  period: OutlookPeriod;
  actualCents: number | null;
  lifeIncomeCents: number; lifeChargeCents: number;
  projectIncomeCents: number; projectChargeCents: number;
  wealthIncomeCents: number; wealthChargeCents: number;
  expectedCents: number | null; stockBeforeCents: number | null; stockAfterCents: number | null;
  projects: { projectId: string; name: string; cycleCents: number; patrimoineCents: number }[];
}
export interface BpmFinancialOutlook {
  context: BpmContextInfo;
  stockCents: number | null; waitingCents: number | null;
  waiting: { period: OutlookPeriod; resultCents: number | null }[];
  cycles: OutlookCycle[]; pending: RegisterLine[]; reason: string | null;
}
