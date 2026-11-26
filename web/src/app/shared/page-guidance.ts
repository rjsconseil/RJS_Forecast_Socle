import { InjectionToken } from '@angular/core';

/** Lecture métier et passage à un autre écran, fournis par l'application qui présente la page. */
export interface PageGuidance {
  /** Titre de la page dans l'application qui la présente : le même mot que son entrée de menu. */
  title?: string;
  lead: string;
  periodParam?: string;
  nextLabel: string;
  nextPath: string;
}
export const PAGE_GUIDANCE = new InjectionToken<PageGuidance>('Page guidance');
