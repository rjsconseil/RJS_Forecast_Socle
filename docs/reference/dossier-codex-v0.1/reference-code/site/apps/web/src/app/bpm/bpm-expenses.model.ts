import type { BpmBudgetCost } from './bpm.model';
import type { BpmStatement } from './bpm-money.model';
export interface ExpenseRow {
  budgetProjectId: string;
  operationId: string;
  occurrenceDate: string;
  actualDate: string | null;
  date: string;
  amountCents: number;
  plannedCents: number | null;
  title: string;
  centerId: string | null;
  status: 'recorded' | 'pending' | 'unrealized';
  closed: boolean;
  note: string;
}
export interface ExpenseOperation {
  incomeType?: string;
  budgetProjectId: string;
  budgetTitle: string;
  coreProject: { id: string; title: string } | null;
  id: string;
  title: string;
  description: string;
  kind: string;
  cadence: string;
  firstDate: string;
  endDate: string;
  amountCents: number;
  decision: string;
  priority: string;
  resource: string;
  supplier: string;
  coreTaskId: string | null;
  createdAt: string;
  updatedAt: string;
  center: {
    id: string;
    name: string;
    description: string;
    group: string;
    limitCents: number | null;
  } | null;
  beneficiary: { id: string; name: string; relationship: string; note: string } | null;
  task: { id: string; title: string } | null;
  provider: {
    id: string;
    name: string;
    type: string;
    contact: string;
    note: string;
    strengths: string;
    weaknesses: string;
    appreciation: string;
    audience: string;
    interventions: {
      id: string;
      date: string;
      title: string;
      context: string;
      appreciation: string;
      note: string;
    }[];
  } | null;
  quotes: { id: string; supplier: string; amountCents: number; note: string }[];
  selectedQuoteId: string | null;
  settlements: { occurrenceDate: string; actualDate: string; amountCents: number }[];
}
export interface BpmExpenseRegister extends BpmStatement {
  budgetProjectId: string;
  budgetTitle: string;
  coreProject: { id: string; title: string } | null;
  budgets: BpmBudgetCost[];
  rows: ExpenseRow[];
  operations: ExpenseOperation[];
}
