import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../core/api.service';
import { SILENT_WRITE } from '../core/data-changes';
import { CalendarData, CalendarDisplayChoice, CalendarEvent, CalendarFormat, CalendarSummary } from './calendar.models';

/** Les préférences sont déjà appliquées à l'écran : leur enregistrement ne relit pas cet onglet. */
const silent = () => new HttpContext().set(SILENT_WRITE, true);

/**
 * Service Calendrier du site : lit un calendrier nommé (paramètre `calendrier.<id>`) ou une configuration
 * fournie à l'appel, replanifie un repère par la commande que sa configuration désigne (méthode, route,
 * champ), et enregistre les préférences de la personne (sources branchées, affichage, formats) sur le
 * serveur, pour qu'elles la suivent d'un appareil à l'autre. Le même code sert tous les modules.
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

  /** `offer` : calendriers dont la page hôte propose les sources au branchement. */
  read(id: string, from: string, to: string, offer: readonly string[] = []) {
    const params: Record<string, string> = { from, to };
    if (offer.length) params['offre'] = offer.join(',');
    return this.run(firstValueFrom(this.http.get<CalendarData>(`/api/calendar/${encodeURIComponent(id)}`, { params })));
  }

  preview(configuration: unknown, from: string, to: string) {
    return this.run(firstValueFrom(this.http.post<CalendarData>('/api/calendar/preview', { configuration, from, to })));
  }

  /** Enregistre l'affichage et/ou les sources branchées de la personne (nul : revenir au défaut). */
  savePreferences(id: string, change: { display?: CalendarDisplayChoice | null; plugged?: readonly string[] | null }) {
    return this.run(firstValueFrom(this.http.put(`/api/calendar/${encodeURIComponent(id)}/preferences`, change, { context: silent() })));
  }

  /** Enregistre les formats créés par la personne (tous ses calendriers). */
  saveFormats(formats: CalendarFormat[]) {
    const body = { formats: formats.map(({ id, label, layout, fields, perCell }) => ({ id, label, layout, fields, perCell })) };
    return this.run(firstValueFrom(this.http.put('/api/calendar/formats', body, { context: silent() })));
  }

  /** Replanifie l'objet source d'un repère à `date`, avec la version lue (refus et conflits du module propriétaire). */
  reschedule(event: CalendarEvent, date: string) {
    const r = event.reschedule;
    if (!r) return Promise.reject(new Error('Ce repère ne se déplace pas.'));
    const body = { [r.field]: date, expectedRevision: event.revision };
    return this.run(firstValueFrom(this.http.request(r.method, r.url, { body })));
  }
}
