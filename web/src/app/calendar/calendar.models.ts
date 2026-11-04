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
}

export interface CalendarData {
  calendar: { id: string | null; label: string; description: string | null };
  parameter: { key: string; revision: number; origin: string } | null;
  window: { from: string; to: string };
  today: string;
  display: CalendarDisplay;
  indicators: { key: CalendarIndicatorKey; label: string }[];
  elements: CalendarElement[];
  events: CalendarEvent[];
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
