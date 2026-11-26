import { CalendarView } from './calendar-dates';

/**
 * Contrat du service Calendrier (API `/api/calendar`). Le site ne connaît aucune donnée métier : il présente
 * les éléments et repères que la configuration du calendrier (paramètre `calendrier.<id>`) a produits.
 */

export type CalendarMarker = 'start' | 'due' | 'point';
export type CalendarDirection = 'entree' | 'sortie';
export type CalendarIndicatorKey = 'elements' | 'dates' | 'suivi' | 'flux' | 'solde';

export interface CalendarElement {
  id: string;
  label: string;
  nature: string;
  /** Couleur paramétrée : bleu, indigo, violet, cyan, sarcelle, vert, ambre, orange, rouge, rose, ardoise. */
  tone: string;
  marker: CalendarMarker;
  /** Affiché à l'ouverture (la personne peut l'afficher ou le masquer ensuite). */
  visible: boolean;
  objectLabel: { one: string; many: string };
  /** Libellés des entrées montrées au survol, dans l'ordre paramétré. */
  hover: string[];
  reschedulable: boolean;
  /** Source branchée depuis un autre calendrier livré (sinon : source de cette configuration). */
  origin?: CalendarSourceOrigin | null;
}

export interface CalendarSourceOrigin {
  calendar: string;
  label: string;
}

/** Source proposée au branchement : de la configuration (`origin` nul) ou d'un autre calendrier livré. */
export interface CalendarSourceOffer {
  id: string;
  label: string;
  nature: string;
  tone: string;
  origin: CalendarSourceOrigin | null;
}

export type CalendarLayout = 'ligne' | 'deux-lignes' | 'pastille';
export type CalendarFormatField = 'amount' | 'total' | 'type' | 'status' | 'group';

/**
 * Format d'affichage d'un événement : disposition et champs montrés, dans l'ordre. Livré par le service
 * (`builtIn`), ajouté par la configuration, ou créé par la personne (`own`) ; tous s'appellent par leur id.
 */
export interface CalendarFormat {
  id: string;
  label: string;
  layout: CalendarLayout;
  fields: CalendarFormatField[];
  perCell: number | null;
  builtIn: boolean;
  own?: boolean;
}

export interface CalendarDetail {
  label: string;
  value: string;
}

export interface CalendarEvent {
  key: string;
  element: string;
  nature: string;
  objectId: string;
  revision: number | null;
  date: string;
  title: string;
  done: boolean;
  status: string | null;
  statusLabel: string | null;
  urgent: 'overdue' | 'soon' | null;
  groupId: string | null;
  groupLabel: string | null;
  amountCents: number | null;
  direction: CalendarDirection | null;
  link: string | null;
  /** Entrées de survol paramétrées, déjà mises en forme. */
  details: CalendarDetail[];
  reschedule: { method: 'PUT' | 'POST'; url: string; field: string } | null;
}

export interface CalendarDisplay {
  view: CalendarView;
  perCell: number;
  perPeek: number;
  peekCloseDelayMs: number;
  /** Format d'affichage d'ouverture (identifiant d'un des `formats`). */
  format?: string;
  /** Design et effet d'affichage d'ouverture (couche de présentation du site). */
  design?: string;
  effect?: string;
}

export interface CalendarInteraction {
  access: 'hidden' | 'collapsed' | 'expanded';
  /** Commandes laissées à la personne (`fields` : le format d'affichage). */
  controls: Record<'sources' | 'fields' | 'indicators' | 'density' | 'completed', boolean> & { /** Design et effets d'affichage (ouvert si absent). */ appearance?: boolean };
  includeDone: boolean;
}

/** Préférences d'affichage enregistrées pour la personne (côté serveur), telles qu'elle les a choisies. */
export interface CalendarDisplayChoice {
  sources?: Record<string, boolean>;
  format?: string;
  indicators?: CalendarIndicatorKey[];
  perCell?: number | null;
  includeDone?: boolean;
  /** Couche de présentation : design et effet d'affichage choisis, réglages de l'effet. */
  design?: string;
  effect?: string;
  effectParams?: Record<string, number>;
}

export interface CalendarData {
  interaction?: CalendarInteraction;
  calendar: { id: string | null; label: string; description: string | null };
  parameter: { key: string; revision: number; origin: string } | null;
  window: { from: string; to: string };
  today: string;
  display: CalendarDisplay;
  indicators: { key: CalendarIndicatorKey; label: string }[];
  elements: CalendarElement[];
  events: CalendarEvent[];
  /** Formats proposés : les formats livrés, puis ceux de la configuration. */
  formats?: CalendarFormat[];
  /** Sources proposées mais non branchées. */
  library?: CalendarSourceOffer[];
  /** Sources branchées par la personne (nul : celles de la configuration). */
  plugged?: string[] | null;
  /** Préférences enregistrées de la personne pour ce calendrier (nul : aucune). */
  preferences?: { display: CalendarDisplayChoice | null; revision: number | null };
}

/** Période affichée : jour de référence, vue, et fenêtre de jours dessinés. */
export interface CalendarPeriod {
  day: string;
  view: CalendarView;
  from: string;
  to: string;
}

export interface CalendarSummary {
  id: string;
  label: string;
  description: string | null;
  parameter: string;
  revision: number;
  origin: string;
}
