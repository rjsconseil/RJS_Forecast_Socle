import { inject } from '@angular/core';
import { BUILT_IN_DESIGNS, CALENDAR_DESIGNS, CalendarDesign, STANDARD_DESIGN } from './calendar-design';
import { BUILT_IN_EFFECTS, CALENDAR_EFFECTS, CalendarEffect, STANDARD_EFFECT } from './calendar-effects';

/**
 * Catalogue de présentation d'un calendrier : les designs et les effets du module, puis ceux que le site
 * a fournis (`provideCalendarDesigns`, `provideCalendarEffects`). Un identifiant repris par le site
 * remplace la définition du module ; « standard » reste toujours le premier choix et la valeur par défaut.
 */
export interface CalendarPresentationCatalog {
  designs: CalendarDesign[];
  effects: CalendarEffect[];
}

function merge<T extends { id: string }>(builtIn: readonly T[], provided: T[][] | null, standard: T): T[] {
  const byId = new Map(builtIn.map((x) => [x.id, x]));
  for (const x of (provided ?? []).flat()) if (x.id !== standard.id) byId.set(x.id, x);
  return [standard, ...[...byId.values()].filter((x) => x.id !== standard.id)];
}

export function injectCalendarPresentation(): CalendarPresentationCatalog {
  return {
    designs: merge(BUILT_IN_DESIGNS, inject(CALENDAR_DESIGNS, { optional: true }), STANDARD_DESIGN),
    effects: merge(BUILT_IN_EFFECTS, inject(CALENDAR_EFFECTS, { optional: true }), STANDARD_EFFECT),
  };
}

export * from './calendar-design';
export * from './calendar-effects';
