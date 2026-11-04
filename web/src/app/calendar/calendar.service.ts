import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../core/api.service';
import { CalendarData, CalendarEvent, CalendarSummary } from './calendar.models';

/**
 * Service Calendrier du site : lit un calendrier nommé (paramètre `calendrier.<id>`) ou une configuration
 * fournie à l'appel, et replanifie un repère par la commande que sa configuration désigne (méthode, route,
 * champ). Le même code sert tous les modules ; seules les données du user et les paramètres changent.
 */
@Injectable({ providedIn: 'root' })
export class CalendarService {
  private http = inject(HttpClient);

  private async run<T>(request: Promise<T>): Promise<T> {
    try {
      return await request;
    } catch (err) {
      throw toApiError(err);
    }
  }

  list() {
    return this.run(firstValueFrom(this.http.get<CalendarSummary[]>('/api/calendar')));
  }

  read(id: string, from: string, to: string) {
    return this.run(firstValueFrom(this.http.get<CalendarData>(`/api/calendar/${encodeURIComponent(id)}`, { params: { from, to } })));
  }

  preview(configuration: unknown, from: string, to: string) {
    return this.run(firstValueFrom(this.http.post<CalendarData>('/api/calendar/preview', { configuration, from, to })));
  }

  /** Replanifie l'objet source d'un repère à `date`, avec la version lue (refus et conflits du module propriétaire). */
  reschedule(event: CalendarEvent, date: string) {
    const r = event.reschedule;
    if (!r) return Promise.reject(new Error('Ce repère ne se déplace pas.'));
    const body = { [r.field]: date, expectedRevision: event.revision };
    return this.run(firstValueFrom(this.http.request(r.method, r.url, { body })));
  }
}
