// Bilans des cycles budgétaires (API `GET /api/bpm/bilans`, `GET /api/bpm/bilans/:periodKey`). Montants en centimes.
import { BpmContextInfo, RegisterLine } from './bpm-models';

export type BilanSource = 'enregistré' | 'recalculé' | 'provisoire';
export type BilanStatus = 'closed' | 'ended' | 'current';
export type HighlightTone = 'positive' | 'negative' | 'warning' | 'neutral';

export interface BilanPeriod { key: string; label: string; start: string; end: string }
export interface BilanHighlight { kind: string; tone: HighlightTone; title: string; text: string }

export interface BilanProject {
  budgetId: string;
  fundingSource?: 'cycle' | 'patrimoine';
  coreProjectId: string;
  name: string;
  paidCents: number;
  paymentCount: number;
  allocationCents: number | null;
  allocationDate: string | null;
  allocatedInPeriod: boolean;
  paidToDateCents: number;
}

export interface Bilan {
  version: number;
  period: BilanPeriod;
  status: BilanStatus;
  source: BilanSource;
  closureId: string | null;
  closedAt: string | null;
  recordedAt?: string;
  flows: {
    receivedCents: number | null;
    spentCents: number | null;
    resultCents: number | null;
    savingsRatePct: number | null;
    plannedResultCents: number | null;
    savingsTargetCents: number | null;
    receivedCount: number;
    paidCount: number;
  };
  natures: { key: 'indispensable' | 'courante' | 'projet'; label: string; paidCents: number; count: number; sharePct: number | null }[];
  projects: BilanProject[];
  centers: { ref: string; label: string; paidCents: number }[];
  /** Dépenses des projets par poste (absent des bilans enregistrés avant le 17 nov. 2026). */
  projectCenters?: { ref: string; label: string; paidCents: number; projects: string[] }[];
  /** Postes en dépassement : dépenses payées au-delà du plafond du cycle (figé à la clôture). */
  caps: { overCount: number; overCents?: number; over: { level: string; ref?: string; label: string; capCents: number; paidCents?: number; overCents: number }[] };
  deadlines: { unrealizedCount: number; unrealizedCents: number; openCount: number; openCents: number };
  biggest: { label: string; cents: number; date: string; project: string | null } | null;
  decisions: { sharesGranted: number; sharesGrantedCents: number; sharesRefused: number; overrunsApproved: number; overrunsApprovedCents: number; overrunsBilledCents: number };
  patrimoine: {
    stockBeforeCents: number | null;
    capitalizedCents: number | null;
    stockAfterCents: number | null;
    objectiveCents: number | null;
    progressBeforePct: number | null;
    progressAfterPct: number | null;
    projectsCents: number;
    /** Dépenses des projets hors cycle, prélevées sur le patrimoine pendant la période. */
    withdrawnCents?: number;
  };
  paymentTrace?: RegisterLine[];
  announcementTrace?: RegisterLine[];
  highlights: BilanHighlight[];
}

export interface BilanSummary {
  period: BilanPeriod;
  status: BilanStatus;
  source: BilanSource;
  closedAt: string | null;
  receivedCents: number | null;
  spentCents: number | null;
  resultCents: number | null;
  projectsCents: number;
  withdrawnCents: number;
  stockAfterCents: number | null;
  highlights: BilanHighlight[];
  highlightCount: number;
}

export interface BilanProjectLedger {
  budgetId: string;
  coreProjectId: string;
  name: string;
  fundingSource: 'cycle' | 'patrimoine';
  allocationCents: number | null;
  closedCents: number;
  provisionalCents: number;
  cycles: { periodKey: string; label: string; paidCents: number; status: BilanStatus }[];
}

export interface BpmBilans {
  context: BpmContextInfo;
  bilans: BilanSummary[];
  totals: { closedCount: number; capitalizedCents: number; projectsClosedCents: number; withdrawnCents: number };
  projects: BilanProjectLedger[];
}

export interface BpmBilanDetail { context: BpmContextInfo; bilan: Bilan }
