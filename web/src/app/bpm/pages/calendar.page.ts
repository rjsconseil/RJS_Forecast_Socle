import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CalendarPage } from '../../calendar/calendar.page';
import { BpmCompass } from '../ui/compass';

/** Habillage BPM du calendrier transverse : le moteur et les autres applications restent inchangés. */
@Component({
  selector: 'bpm-calendar-page',
  imports: [CalendarPage, BpmCompass],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-calendar-page /><div class="page"><bpm-compass /></div>`,
})
export class BpmCalendarPage {}
export const loadBpmCalendar = () => Promise.resolve(BpmCalendarPage);
