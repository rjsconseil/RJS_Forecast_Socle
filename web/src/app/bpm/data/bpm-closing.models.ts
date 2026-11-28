// Parcours de clôture d'un cycle (API `GET /api/bpm/closing`, `GET /api/bpm/closing/brief`,
// `POST /api/bpm/closing/decisions`, `POST /api/bpm/closing/finalize`). Montants en centimes ; le serveur calcule la
// phase, les points à suivre, la complétude, le mode clôture et les impacts sur le cycle suivant.
import { Closure } from '../../core/models';
import { BpmContextInfo } from './bpm-models';
import { LifeClosingPreview } from './bpm-life.models';

/** running : le cycle court (suivi des points) ; to_close : son dernier jour est passé, le cycle est en clôture. */
export type ClosingPhase = 'to_configure' | 'running' | 'to_close';
export type ClosingGroup = 'income' | 'charges' | 'projects' | 'decisions';
/** @deprecated nom historique du groupe d'un critère */
export type ClosingCriterionKey = ClosingGroup;
/** done : traité ; todo : à traiter maintenant ; later : pas encore faisable ; none : sans objet ce cycle. */
export type ClosingCriterionState = 'done' | 'todo' | 'later' | 'none';
/** open : à traiter ; closed : traité (réglé, écarté, décidé, vérifié) ; deferred : non validé ici, revu dans un cycle à venir ; later : pas encore ouvert. */
export type ClosingPointState = 'open' | 'closed' | 'deferred' | 'later';

export interface ClosingPeriod { key: string; label: string; start: string; end: string; status?: string }
export interface ClosingTarget { key: string; label: string; start: string }

/** Point à suivre du cycle : un évènement qui demande une revue, ouvert puis clos là où il vit sur le site. */
export interface ClosingPoint {
  id: string;
  /** Ligne à ouvrir dans le détail (opération ou occurrence) ; null pour une décision ou le compte. */
  lineId: string | null;
  kind: 'line' | 'decision';
  group: ClosingGroup;
  /** Point bloquant : il se traite avant la clôture, il ne se reporte pas. */
  blocking: boolean;
  lineKind?: 'operation' | 'occurrence';
  operationId?: string | null;
  recurrenceId?: string | null;
  occurrenceDate?: string | null;
  revision?: number | null;
  decisionKind?: 'overrun' | 'request';
  decisionId?: string;
  label: string;
  detail: string | null;
  direction?: 'income' | 'charge';
  plannedDate?: string;
  plannedCents?: number;
  realizedDate?: string | null;
  realizedCents?: number | null;
  costCenterLabel?: string | null;
  cadenceLabel?: string | null;
  project?: { budgetId: string; coreProjectId: string; name: string } | null;
  status: string;
  statusLabel: string;
  state: ClosingPointState;
  stale?: boolean;
  /** Jour où le point est entré dans le cycle (saisie, ou premier jour du cycle). */
  openedOn: string | null;
  /** Heure et jour où le point s'est clos. */
  closedAt: string | null;
  closedOn: string | null;
  outcome: string | null;
  outcomeLabel: string | null;
  /** Point hérité : reporté d'un cycle clôturé, ou décision en attente depuis un cycle précédent. */
  inheritedFrom: { periodKey: string | null; label: string | null; date: string | null } | null;
  /** Décision de clôture : non validé ici, revu dans ce cycle. */
  deferTo: ClosingTarget | null;
}

export interface ClosingCriterion {
  key: ClosingGroup;
  label: string;
  done: number;
  total: number;
  state: ClosingCriterionState;
  remaining: string | null;
}

export interface ClosingFlows { count: number; incomeCents: number; chargeCents: number }

/** Ce que le cycle qui se clôture laisse au suivant (et au-delà pour les points reportés plus loin). */
export interface ClosingImpacts {
  next: ClosingPeriod;
  capitalization: { resultCents: number | null; stockBefore: number | null; stockAfter: number | null; date: string; provisional: boolean };
  recurring: ClosingFlows;
  planned: ClosingFlows;
  projects: ClosingFlows;
  deferred: ClosingFlows & {
    intoNext: ClosingFlows;
    byCycle: (ClosingFlows & ClosingTarget & { points: { id: string; label: string; group: ClosingGroup; direction: 'income' | 'charge'; plannedCents: number; project: string | null }[] })[];
  };
  decisions: { count: number; points: { id: string; label: string; project: string | null; plannedCents: number; state: ClosingPointState }[] };
  balanceCents: number;
  /** La clôture rouvre les entrées du cycle suivant (verrou levé). */
  opensEntries: boolean;
}

export interface ClosingCounts { total: number; open: number; closed: number; deferred: number; later: number; inherited: number }

/** Où retrouver l'objet d'une action sur le site. */
export type ClosingActionTarget =
  | { kind: 'line'; id: string; coreProjectId: string | null }
  | { kind: 'recurring'; id: string; coreProjectId: string | null }
  | { kind: 'project'; coreProjectId: string | null }
  | { kind: 'bilan'; periodKey: string }
  | { kind: 'caps' | 'goals' | 'patrimoine' | 'cycle' };

/** Une action enregistrée sur Astra qui touche le cycle (les répétitions du même jour sur le même objet se comptent). */
export interface ClosingAction {
  category: string;
  command: string;
  verb: string;
  label: string;
  detail: string | null;
  at: string;
  firstAt: string;
  count: number;
  source: 'journal' | 'objects';
  objectId: string | null;
  amountCents: number | null;
  direction: 'income' | 'charge' | null;
  /** realized : argent réglé ; planned : prévu ; decision : décision de financement ; setting : réglage ; closure ; none : écarté ou annulé. */
  effect: 'realized' | 'planned' | 'decision' | 'setting' | 'closure' | 'none';
  target: ClosingActionTarget | null;
}
export interface ClosingActionCategory {
  key: string;
  label: string;
  /** Partie d'Astra concernée (couleur). */
  part: 'quotidien' | 'projets' | 'patrimoine' | null;
  text: string;
  count: number;
  entries: number;
  realizedCents: number;
  lastAt: string | null;
  items: ClosingAction[];
}
/** Actions du cycle : ce qui a été fait, classé par catégorie ; la clôture les fige. */
export interface ClosingActions {
  total: number;
  entries: number;
  lastAt: string | null;
  firstAt: string | null;
  /** Le journal ne couvre pas tout le cycle avant `journalFrom` : le début est reconstitué depuis les données. */
  source: { journalFrom: string | null; complete: boolean };
  categories: ClosingActionCategory[];
}

export type ClosingCheckState = 'ok' | 'warn' | 'fail' | 'later';
/** Où agir pour résoudre une incohérence : une ligne, une page du site, une section de cette page… */
export type ClosingCheckTarget =
  | { kind: 'line'; id: string; coreProjectId: string | null; page?: 'echeances' | 'mouvements' }
  | { kind: 'section'; id: string }
  | { kind: 'page'; path: string }
  | { kind: 'center'; ref: string }
  | { kind: 'project'; coreProjectId: string | null }
  | { kind: 'decisions' };
/** Contrôle de cohérence : bloquant (la clôture attend), à voir (gardé dans la clôture), pour information. */
export interface ClosingCheck {
  key: string;
  level: 'blocking' | 'warning' | 'info';
  label: string;
  state: ClosingCheckState;
  value: string;
  text: string;
  /** Comment résoudre : ce qui ne va pas, pourquoi c'est important, les étapes, la progression. */
  resolution?: {
    problem: string | null;
    why: string;
    steps: { text: string; target?: ClosingCheckTarget | null }[];
    progress: { done: number; total: number } | null;
  };
  items: { id: string; label: string; detail: string | null; amountCents: number | null; target?: ClosingCheckTarget | null }[];
  /** Éléments concernés au-delà de la liste. */
  more?: number;
  target: string | null;
}
export interface ClosingChecks {
  items: ClosingCheck[];
  ok: number;
  warn: number;
  fail: number;
  later: number;
  total: number;
  /** Contrôles bloquants en échec : la clôture est refusée tant qu'il y en a. */
  blocking: string[];
}

export interface ClosingJourney {
  context?: BpmContextInfo;
  phase: ClosingPhase;
  period: ClosingPeriod | null;
  next: ClosingPeriod | null;
  opensOn?: string;
  days?: { total: number; elapsed: number; left: number };
  backlog?: number;
  lock: { enabled: boolean; active: boolean; from: string | null; message: string | null };
  /** Mode clôture : les points du cycle terminé sont figés, seuls les points ouverts se traitent. */
  closingMode: { active: boolean; message: string | null };
  percent: number;
  done: number;
  total: number;
  counts: ClosingCounts | null;
  criteria: ClosingCriterion[];
  points: ClosingPoint[];
  /** Cycles où un point non bloquant peut se revoir. */
  targets: ClosingTarget[];
  netCents?: number | null;
  closing: { possible: boolean; reason: string | null; preview: LifeClosingPreview | null } | null;
  canClose: boolean;
  remaining?: string[];
  impacts: ClosingImpacts | null;
  /** Ce qui a été fait pendant le cycle, et ce qui se tient : la clôture les fige. */
  actions?: ClosingActions | null;
  checks?: ClosingChecks | null;
  lastClosure?: { periodKey: string; periodLabel: string; resultCents: number; closedAt: string; deferredCount: number } | null;
}

/** Résumé pour le cadre des pages : mode clôture et états des points (un point clos se signale à l'instant). */
export interface ClosingBrief {
  phase: ClosingPhase;
  period: ClosingPeriod | null;
  next: ClosingTarget | null;
  opensOn?: string;
  percent: number;
  counts: ClosingCounts | null;
  closingMode: { active: boolean; message: string | null };
  points: { id: string; label: string; group: ClosingGroup; state: ClosingPointState }[];
}

export interface ClosingDecision {
  periodKey: string;
  /** Point non bloquant non validé dans ce cycle, revu dans `toPeriodKey` (null retire le report). */
  defer?: { pointId: string; toPeriodKey: string | null };
  /** Ancienne forme : report au cycle suivant. */
  carry?: { lineId: string; value?: boolean };
}

export interface ClosingFinalized { replayed: boolean; closure: Closure; carriedCount: number; deferredCount: number; journey: ClosingJourney }
