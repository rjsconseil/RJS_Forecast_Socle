import { CalendarData, CalendarIndicatorKey } from './calendar.models';

export const BPM_DAY_FIELDS = [
  { key: 'amount', label: 'Montant des événements' },
  { key: 'total', label: 'Total des flux du jour' },
  { key: 'type', label: 'Type de repère' },
  { key: 'status', label: 'Statut' },
  { key: 'group', label: 'Budget de rattachement' },
] as const;
export type BpmDayField = (typeof BPM_DAY_FIELDS)[number]['key'];

/** Préférences de présentation locales uniquement : aucune configuration métier n’est écrite. */
export interface BpmCalendarPreferences {
  sources: Record<string, boolean>;
  fields: Record<BpmDayField, boolean>;
  indicators: CalendarIndicatorKey[];
  perCell: number;
  includeDone: boolean;
}

export const preferencesKey = (userId: string) =>
  `rjs.bpm.calendar.display.v1:${encodeURIComponent(userId)}`;

export function displayDefaults(data: CalendarData): BpmCalendarPreferences {
  return {
    sources: Object.fromEntries(data.elements.map((element) => [element.id, element.visible])),
    fields: { amount: true, total: true, type: false, status: false, group: false },
    indicators: data.indicators.map((indicator) => indicator.key),
    perCell: data.display.perCell,
    includeDone: true,
  };
}

export function readDisplayPreferences(
  userId: string | null,
  data: CalendarData,
): BpmCalendarPreferences {
  const defaults = displayDefaults(data);
  if (!userId) return defaults;
  try {
    const raw = JSON.parse(localStorage.getItem(preferencesKey(userId)) ?? 'null');
    if (!raw || typeof raw !== 'object') return defaults;
    return {
      sources: Object.fromEntries(
        data.elements.map((element) => [
          element.id,
          typeof raw.sources?.[element.id] === 'boolean'
            ? raw.sources[element.id]
            : element.visible,
        ]),
      ),
      fields: Object.fromEntries(
        BPM_DAY_FIELDS.map((field) => [
          field.key,
          typeof raw.fields?.[field.key] === 'boolean'
            ? raw.fields[field.key]
            : defaults.fields[field.key],
        ]),
      ) as BpmCalendarPreferences['fields'],
      indicators: Array.isArray(raw.indicators)
        ? defaults.indicators.filter((key) => raw.indicators.includes(key))
        : defaults.indicators,
      perCell:
        Number.isInteger(raw.perCell) && raw.perCell >= 1 && raw.perCell <= 6
          ? raw.perCell
          : defaults.perCell,
      includeDone: typeof raw.includeDone === 'boolean' ? raw.includeDone : true,
    };
  } catch {
    return defaults;
  }
}

export function writeDisplayPreferences(
  userId: string | null,
  preferences: BpmCalendarPreferences,
): void {
  if (!userId) return;
  try {
    localStorage.setItem(preferencesKey(userId), JSON.stringify(preferences));
  } catch {
    /* Navigation privée : le choix reste valable pendant la visite. */
  }
}
