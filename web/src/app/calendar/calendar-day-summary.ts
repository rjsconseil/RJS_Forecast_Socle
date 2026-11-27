// Lecture d'une journée du calendrier (cases du mois, jours de l'année) et brouillon d'un format d'affichage :
// fonctions pures, testées, sorties de calendar.component.ts (faiblesse n° 7 du rapport « architecture et faiblesses »).
import { formatAmount } from './calendar-model';
import { CalendarEvent, CalendarFormat, CalendarFormatField, CalendarLayout } from './calendar.models';

/** Total signé des flux du jour (montants avec un sens), ou `null` s'il n'y en a pas. */
export function dayNetAmount(events: readonly CalendarEvent[]): { text: string; sign: 'negative' | 'positive' | 'zero' } | null {
  const flows = events.filter((e) => e.direction && e.amountCents !== null);
  if (!flows.length) return null;
  const net = flows.reduce((s, e) => s + (e.direction === 'entree' ? 1 : -1) * (e.amountCents ?? 0), 0);
  return { text: formatAmount(net, net < 0 ? 'sortie' : 'entree'), sign: net < 0 ? 'negative' : net > 0 ? 'positive' : 'zero' };
}

/** Une journée demande de l'attention : un repère en retard, ou cinq repères à faire au moins. */
export const dayNeedsAttention = (events: readonly CalendarEvent[]) =>
  events.some((e) => !e.done && e.urgent === 'overdue') || events.filter((e) => !e.done).length >= 5;

/** Une journée est plutôt faite : au moins un repère fait, et pas moins de faits que d'autres. */
export function dayMostlyDone(events: readonly CalendarEvent[]) {
  const done = events.filter((e) => e.done).length;
  return done > 0 && done >= events.length - done;
}

/** L'élément le plus présent d'une journée (sa couleur la représente dans la vue annuelle). */
export function dominantElement(events: readonly CalendarEvent[]): string | undefined {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.element, (counts.get(e.element) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Brouillon d'un format d'affichage en cours d'édition. */
export interface CalendarFormatDraft {
  id: string | null;
  label: string;
  layout: CalendarLayout;
  fields: CalendarFormatField[];
  perCell: number | null;
}

/** Nouveau format à partir de celui en cours, ou modification d'un format créé par la personne. */
export function formatDraftOf(format: CalendarFormat | null, current: CalendarFormat): CalendarFormatDraft {
  const base = format ?? current;
  return { id: format?.own ? format.id : null, label: format?.own ? format.label : 'Mon format', layout: base.layout, fields: [...base.fields], perCell: base.perCell };
}

/** Ajoute ou retire un champ du brouillon. */
export const toggleDraftField = (d: CalendarFormatDraft, field: CalendarFormatField): CalendarFormatDraft =>
  ({ ...d, fields: d.fields.includes(field) ? d.fields.filter((f) => f !== field) : [...d.fields, field] });

/** Change l'ordre d'un champ (−1 : plus tôt, +1 : plus tard) ; sans effet aux bords. */
export function moveDraftField(d: CalendarFormatDraft, field: CalendarFormatField, step: number): CalendarFormatDraft {
  const fields = [...d.fields];
  const at = fields.indexOf(field);
  const to = at + step;
  if (at < 0 || to < 0 || to >= fields.length) return d;
  [fields[at], fields[to]] = [fields[to], fields[at]];
  return { ...d, fields };
}

/** Les formats de la personne après enregistrement du brouillon (ajout, ou remplacement de celui qu'il modifie). */
export function saveDraftInto(own: readonly CalendarFormat[], draft: CalendarFormatDraft, id: string): CalendarFormat[] {
  const format: CalendarFormat = { id, label: draft.label.trim(), layout: draft.layout, fields: draft.fields, perCell: draft.perCell, builtIn: false, own: true };
  return draft.id ? own.map((f) => (f.id === id ? format : f)) : [...own, format];
}
