// Plafonds de dépenses (GET /api/bpm/spending-caps) : un plafond facultatif par poste de dépenses (centre de coût),
// posé sur le budget de vie, jamais bloquant. Montants en centimes ; engagé = réglé dans la période + reste à payer.
// Les catégories de dépense ne sont plus utilisées par BPM (22 nov. 2026).
import { BpmContextInfo, RegisterLine } from './bpm-models';

/**
 * Niveau de consommation d'un plafond, rendu par le middleware Budget (seule source des seuils) : none (sans plafond),
 * low, mid, high, near (« proche du plafond », 100 % compris) ou over (dépassé). Il donne la couleur des jauges.
 */
export type CapLevel = 'none' | 'low' | 'mid' | 'high' | 'near' | 'over';
/** Seuils des niveaux, en % du plafond consommé (Budget) ; au-delà de 100 %, le plafond est dépassé. */
export interface CapLevelThresholds {
  mid: number;
  high: number;
  near: number;
}

/** Mesure d'un poste sur la période. */
export interface CapMeasure {
  paidCents: number;
  toPayCents: number;
  engagedCents: number;
  capCents: number | null;
  marginCents: number | null;
  usedPct: number | null;
  over: boolean;
  /** Dépassement constaté : charges payées au-delà du plafond du cycle (0 sans plafond ni dépassement). */
  paidOverCents?: number;
  /** Proche du plafond : règle du middleware Budget, seule source du seuil (audit ARCH-10). */
  near: boolean;
  level: CapLevel;
  lineCount: number;
}

export interface CenterCapRow extends CapMeasure {
  ref: string;
  label: string;
  standard: boolean;
}

/** Plafond de poste dépassé. */
export interface CapAlert {
  level: 'center';
  ref: string;
  id: string | null;
  label: string;
  capCents: number;
  engagedCents: number;
  overCents: number;
}

/** Résumé d'un plafond joint au registre : plafond, engagé, marge, consommation, dépassement. */
export type CapBrief = Pick<CapMeasure, 'capCents' | 'engagedCents' | 'marginCents' | 'usedPct' | 'over' | 'near' | 'level'> & { paidCents?: number; paidOverCents?: number };

export interface RegisterCaps {
  centers: Record<string, CapBrief>;
  overCount: number;
  levels: CapLevelThresholds;
}

export interface SpendingCaps {
  context: BpmContextInfo;
  lifeBudget: { budgetId: string; revision: number; capsCents: Record<string, number> };
  centers: CenterCapRow[];
  overCount: number;
  alerts: CapAlert[];
  levels: CapLevelThresholds;
}

/**
 * Revue des plafonds (GET /api/bpm/caps-review) : chaque poste de la période avec les
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

export interface CapsReview {
  context: BpmContextInfo;
  lifeBudget: { budgetId: string; revision: number; capsCents: Record<string, number> };
  centers: ReviewCenter[];
  charges: Record<string, ReviewCharge>;
  totals: {
    cappedCount: number;
    overCount: number;
    /** Dépassement à compenser sur les autres postes (somme des dépassements des postes plafonnés). */
    toCompensateCents: number;
    /** Marge restante sous les plafonds de postes respectés. */
    headroomCents: number;
    /** Solde prévu à la clôture de la période (si tout le prévu se réalise). */
    expectedCents: number | null;
    initialCents: number | null;
    /** État de la période lue : une période terminée ou close se lit comme un bilan. */
    reading?: 'closed' | 'ended' | 'current' | 'future';
    /** Résultat capitalisé à la clôture (période close). */
    closedResultCents?: number | null;
  };
}

/** Aperçu sans écriture, sur la période de la dépense. */
export interface CapPreview {
  mutation: false;
  period: { key: string; label: string };
  before: { center: CenterCapRow | null };
  after: { center: CenterCapRow | null };
  alerts: CapAlert[];
  note: string | null;
}
