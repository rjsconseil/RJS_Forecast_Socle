// Plafonds de dépenses (GET /api/bpm/spending-caps) : deux niveaux indépendants, jamais bloquants.
// - centre de coût : plafond par période posé sur le budget de vie ;
// - catégorie personnalisée : rangée dans un centre de charges, regroupe des dépenses précises, plafond facultatif.
// Montants en centimes ; engagé = réglé dans la période + reste à payer de la période.
import { BpmContextInfo, RegisterLine } from './bpm-models';

/** Catégorie de dépense (module Budget, niveau 2). */
export interface ChargeCategory {
  id: string;
  label: string;
  costCenterRef: string;
  costCenterLabel: string;
  capCents: number | null;
  archived: boolean;
  revision: number;
}

/** Mesure d'un niveau (centre ou catégorie) sur la période. */
export interface CapMeasure {
  paidCents: number;
  toPayCents: number;
  engagedCents: number;
  capCents: number | null;
  marginCents: number | null;
  usedPct: number | null;
  over: boolean;
  lineCount: number;
}

export interface CenterCapRow extends CapMeasure {
  ref: string;
  label: string;
  standard: boolean;
}

export interface CategoryCapRow extends CapMeasure {
  id: string;
  label: string;
  costCenterRef: string;
  costCenterLabel: string;
  archived: boolean;
  revision: number;
}

/** Plafond dépassé, au niveau du centre ou de la catégorie (lus indépendamment). */
export interface CapAlert {
  level: 'center' | 'category';
  ref: string;
  id: string | null;
  label: string;
  capCents: number;
  engagedCents: number;
  overCents: number;
}

/** Résumé d'un plafond joint au registre : plafond, engagé, marge, consommation, dépassement. */
export type CapBrief = Pick<CapMeasure, 'capCents' | 'engagedCents' | 'marginCents' | 'usedPct' | 'over'>;

export interface RegisterCaps {
  centers: Record<string, CapBrief>;
  categories: Record<string, CapBrief & { label: string; costCenterRef: string; archived: boolean }>;
  overCount: number;
}

export interface SpendingCaps {
  context: BpmContextInfo;
  lifeBudget: { budgetId: string; revision: number; capsCents: Record<string, number> };
  centers: CenterCapRow[];
  categories: CategoryCapRow[];
  overCount: number;
  alerts: CapAlert[];
}

/**
 * Revue des plafonds (GET /api/bpm/caps-review) : chaque poste et chaque catégorie de la période avec les
 * charges qui, ensemble, forment son engagé (les plus lourdes d'abord), leur récurrence et leur antériorité.
 */
export interface ReviewCharge extends RegisterLine {
  /** Part de la charge dans l'engagé de la période (réel si réglée dans la période, sinon prévu). */
  engagedCents: number;
  engagedDate: string;
  engagedAs: 'paid' | 'toPay';
  /** Origine : première échéance de la récurrence, ou date de la charge ponctuelle. */
  origin: string;
  sinceMonths: number;
  newThisPeriod: boolean;
  /** Rang de l'échéance dans sa récurrence (1 = première) ; null pour une charge ponctuelle. */
  rank: number | null;
  perYearCents: number | null;
  monthlyCents: number | null;
}

export interface ReviewCenter extends CenterCapRow {
  chargeIds: string[];
}

export interface ReviewCategory extends CategoryCapRow {
  chargeIds: string[];
}

export interface CapsReview {
  context: BpmContextInfo;
  lifeBudget: { budgetId: string; revision: number; capsCents: Record<string, number> };
  centers: ReviewCenter[];
  categories: ReviewCategory[];
  charges: Record<string, ReviewCharge>;
  totals: {
    cappedCount: number;
    overCount: number;
    /** Dépassement à compenser sur les autres postes (poste plafonné, sinon ses catégories). */
    toCompensateCents: number;
    /** Marge restante sous les plafonds de postes respectés. */
    headroomCents: number;
    /** Solde prévu à la clôture de la période (si tout le prévu se réalise). */
    expectedCents: number | null;
    initialCents: number | null;
  };
}
