import { CalendarData, CalendarIndicatorKey } from './calendar.models';

/**
 * Préférences d'affichage de la personne : elles ne changent aucune donnée métier ni le paramètre administré.
 * Elles sont enregistrées sur le serveur (`data.preferences`) ; ce module les résout avec les valeurs du
 * calendrier et les commandes que l'administration laisse ouvertes.
 */
export interface CalendarDisplayPreferences {
  sources: Record<string, boolean>;
  /** Format d'affichage choisi (livré, de la configuration ou créé par la personne). */
  format: string;
  indicators: CalendarIndicatorKey[];
  /** Événements par case choisis par la personne ; nul : le format, puis la configuration, décident. */
  perCell: number | null;
  includeDone: boolean;
  /** Couche de présentation : design (apparence) et effet d'affichage (mouvement), séparés. */
  design: string;
  effect: string;
  /** Réglages de l'effet choisi (durées, distances) ; vide : ceux de l'effet. */
  effectParams: Record<string, number>;
}

export function displayDefaults(data: CalendarData): CalendarDisplayPreferences {
  return {
    sources: Object.fromEntries(data.elements.map((element) => [element.id, element.visible])),
    format: data.display.format ?? 'standard',
    indicators: data.indicators.map((indicator) => indicator.key),
    perCell: null,
    includeDone: data.interaction?.includeDone ?? true,
    design: data.display.design ?? 'standard',
    effect: data.display.effect ?? 'standard',
    effectParams: {},
  };
}

/** Préférences en vigueur : le choix enregistré là où l'administration le permet, sinon la valeur du calendrier. */
export function resolveDisplayPreferences(data: CalendarData): CalendarDisplayPreferences {
  const defaults = displayDefaults(data);
  const raw = data.preferences?.display;
  if (!raw || typeof raw !== 'object') return defaults;
  const allowed = (key: keyof NonNullable<CalendarData['interaction']>['controls']) =>
    data.interaction?.access !== 'hidden' && data.interaction?.controls[key] !== false;
  return {
    sources: Object.fromEntries(
      data.elements.map((element) => [
        element.id,
        allowed('sources') && typeof raw.sources?.[element.id] === 'boolean' ? raw.sources[element.id] : element.visible,
      ]),
    ),
    format: allowed('fields') && typeof raw.format === 'string' && raw.format ? raw.format : defaults.format,
    indicators: allowed('indicators') && Array.isArray(raw.indicators)
      ? defaults.indicators.filter((key) => raw.indicators!.includes(key))
      : defaults.indicators,
    perCell: allowed('density') && Number.isInteger(raw.perCell) && raw.perCell! >= 0 && raw.perCell! <= 8 ? raw.perCell! : null,
    includeDone: allowed('completed') && typeof raw.includeDone === 'boolean' ? raw.includeDone : defaults.includeDone,
    design: allowed('appearance') && typeof raw.design === 'string' && raw.design ? raw.design : defaults.design,
    effect: allowed('appearance') && typeof raw.effect === 'string' && raw.effect ? raw.effect : defaults.effect,
    effectParams: allowed('appearance') && raw.effectParams && typeof raw.effectParams === 'object'
      ? Object.fromEntries(Object.entries(raw.effectParams).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)))
      : {},
  };
}
