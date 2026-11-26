import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HttpContext, HttpRequest, HttpResponse } from '@angular/common/http';
import { firstValueFrom, of } from 'rxjs';
import { RecetteContext } from '../core/api.service';
import { CLIENT_ID, DataChanges, SILENT_WRITE, dataChangesInterceptor, isApiWrite } from '../core/data-changes';
import { CalendarSpaceComponent } from './calendar-space.component';
import { CalendarService } from './calendar.service';
import { CalendarData } from './calendar.models';
import { localToday } from './calendar-dates';

const data: CalendarData = {
  calendar: { id: 'budgetPatrimoine', label: 'Calendrier', description: null },
  parameter: null,
  window: { from: localToday(), to: localToday() },
  today: localToday(),
  display: { view: 'month', perCell: 2, perPeek: 4, peekCloseDelayMs: 260, format: 'standard' },
  indicators: [{ key: 'flux', label: 'Flux' }],
  elements: [],
  events: [],
};

// Le calendrier ne connaît ni la page ni l'application qui écrit : il suit les écritures annoncées.
describe('espace calendrier · relecture, offre de la page et préférences enregistrées', () => {
  const reads: (readonly string[])[] = [];
  const saved: unknown[] = [];
  const profile = signal<string | null>('space-test');

  beforeEach(() => {
    reads.length = 0;
    saved.length = 0;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: RecetteContext, useValue: { userId: profile } },
        {
          provide: CalendarService,
          useValue: {
            read: (_id: string, _f: string, _t: string, offer: readonly string[]) => { reads.push(offer); return Promise.resolve(data); },
            preview: () => Promise.resolve(data),
            savePreferences: (id: string, change: unknown) => { saved.push({ id, change }); return Promise.resolve({}); },
            saveFormats: (formats: unknown) => { saved.push({ formats }); return Promise.resolve({}); },
          },
        },
      ],
    });
  });

  async function mount(offer: string[] = []) {
    const fixture = TestBed.createComponent(CalendarSpaceComponent);
    fixture.componentRef.setInput('calendar', 'budgetPatrimoine');
    fixture.componentRef.setInput('offer', offer);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }
  type Space = { plug(ids: string[] | null): Promise<void>; keepPreferences(d: unknown): void; keepFormats(f: unknown[]): void };

  it('lit les sources que la page propose', async () => {
    await mount(['noyau', 'patrimoine']);
    expect(reads.at(-1)).toEqual(['noyau', 'patrimoine']);
  });

  it('se relit après une écriture de cet onglet ou annoncée par le serveur, pas après la sienne propre ni un aperçu', async () => {
    const fixture = await mount();
    const changes = TestBed.inject(DataChanges);
    const count = () => reads.length;
    let before = count();
    changes.bump('/api/bpm/operations');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(count()).toBe(before + 1);
    before = count();
    changes.receive({ revision: 10, userId: 'space-test', clientId: 'autre-appareil', module: 'bpm' });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(count()).toBe(before + 1);
    before = count();
    changes.receive({ revision: 11, userId: 'space-test', clientId: CLIENT_ID, module: 'calendar' });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(count()).toBe(before);
    changes.reconnected(11);
    changes.reconnected(14);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(count()).toBe(before + 1);
    expect(isApiWrite('POST', '/api/bpm/operations/preview')).toBe(false);
    expect(isApiWrite('GET', '/api/calendar/noyau')).toBe(false);
    expect(isApiWrite('PUT', '/api/tasks/t1')).toBe(true);
  });

  it('enregistre sur le serveur les sources branchées (puis se relit), l’affichage et les formats', async () => {
    const fixture = await mount();
    const space = fixture.componentInstance as unknown as Space;
    const before = reads.length;
    await space.plug(['revenu', 'noyau.tache-echeance']);
    expect(saved).toContainEqual({ id: 'budgetPatrimoine', change: { plugged: ['revenu', 'noyau.tache-echeance'] } });
    expect(reads.length).toBe(before + 1);
    space.keepPreferences({ format: 'compact' });
    space.keepPreferences({ format: 'detaille' });
    await new Promise((r) => setTimeout(r, 350));
    expect(saved.filter((x) => (x as { change?: { display?: unknown } }).change?.display)).toEqual([{ id: 'budgetPatrimoine', change: { display: { format: 'detaille' } } }]);
    space.keepFormats([{ id: 'perso-x' }]);
    expect(saved.at(-1)).toEqual({ formats: [{ id: 'perso-x' }] });
  });

  it('l’intercepteur marque l’onglet et n’avance la version qu’après une écriture réussie et non silencieuse', async () => {
    const changes = TestBed.inject(DataChanges);
    const start = changes.version();
    const seen: string[] = [];
    const next = (req: HttpRequest<unknown>) => { seen.push(req.headers.get('x-client-id') ?? ''); return of(new HttpResponse({ status: 200 })); };
    await TestBed.runInInjectionContext(() => firstValueFrom(dataChangesInterceptor(new HttpRequest('PUT', '/api/tasks/t1', {}), next)));
    expect(changes.version()).toBe(start + 1);
    await TestBed.runInInjectionContext(() => firstValueFrom(dataChangesInterceptor(new HttpRequest('POST', '/api/calendar/preview', {}), next)));
    await TestBed.runInInjectionContext(() => firstValueFrom(dataChangesInterceptor(new HttpRequest('PUT', '/api/calendar/x/preferences', {}, { context: new HttpContext().set(SILENT_WRITE, true) }), next)));
    expect(changes.version()).toBe(start + 1);
    expect(seen).toEqual([CLIENT_ID, CLIENT_ID, CLIENT_ID]);
  });
});
