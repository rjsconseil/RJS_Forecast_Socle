import { ChangeDetectionStrategy, Component, inject, InjectionToken } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { CalendarComponent } from './calendar.component';

/** Le calendrier qui porte l'encadré : il se fournit lui-même, l'encadré lit son état et appelle ses gestes publics. */
export const CALENDAR = new InjectionToken<CalendarComponent>('Calendrier');

/**
 * Encadré « Votre calendrier, vos repères » : sources (branchées ou non), format d'affichage, lecture et
 * indicateurs. Sorti de calendar.component.html (rapport v4, point 3), sans changer le rendu : hôte sans boîte, et
 * des feuilles du calendrier les seules règles qui peuvent viser ce gabarit (calendar-personalization.host.scss,
 * tiré par scripts/styles-extract.mjs). Le calendrier le rend dans son volet « Sources et affichage » ou sa page de réglages.
 */
@Component({
  selector: 'rjs-calendar-personalization',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './calendar-personalization.html',
  host: { style: 'display: contents' },
  styleUrl: './calendar-personalization.host.scss',
})
export class CalendarPersonalization {
  protected readonly cal = inject(CALENDAR);
}
