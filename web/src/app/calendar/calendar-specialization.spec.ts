import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { CalendarPage } from './calendar.page';
import { CalendarService } from './calendar.service';
import { CalendarData } from './calendar.models';

let fixture: ComponentFixture<CalendarPage>;
async function setup(calendar: string, key?: string) {
  const data: CalendarData = {
    calendar: { id: calendar, label: 'Calendrier de test', description: null }, parameter: null,
    window: { from: '2026-11-01', to: '2026-11-30' }, today: '2026-11-07',
    display: { view: 'month', perCell: 2, perPeek: 4, peekCloseDelayMs: 260 },
    indicators: [], events: [],
    elements: [{ id: 'taches', label: 'Tâches', nature: 'task', tone: 'indigo', marker: 'due', visible: true, objectLabel: { one: 'tâche', many: 'tâches' }, hover: [], reschedulable: false }],
  };
  const routeData = {
    calendar, eyebrow: 'Calendrier', title: 'Voir les repères', emphasis: 'dans le temps', intro: 'La période et ses repères.', groupsTitle: 'Regroupements', groupKicker: 'Groupe',
    ...(key ? { workspace: { key, title: key === 'calendar-agenda' ? 'Agenda spécialisé' : 'Sources spécialisées', lead: 'Une étape dédiée.', parent: '/calendrier' } } : {}),
  };
  TestBed.configureTestingModule({ providers: [provideRouter([]),
    { provide: CalendarService, useValue: { read: vi.fn(async () => data) } },
    { provide: ActivatedRoute, useValue: {
      data: of(routeData), queryParams: of({ jour: '2026-11-07' }), queryParamMap: of(convertToParamMap({ jour: '2026-11-07' })), paramMap: of(convertToParamMap({})), fragment: of(null),
      snapshot: { data: routeData, queryParams: { jour: '2026-11-07' }, queryParamMap: convertToParamMap({ jour: '2026-11-07' }) },
    } },
  ] });
  fixture = TestBed.createComponent(CalendarPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('pages spécialisées du calendrier partagé', () => {
  it('présente l’agenda du noyau dans le bandeau central sans synthèse ni grille', async () => {
    const dom = await setup('noyau', 'calendar-agenda');
    expect(dom.querySelector('rjs-app-hero h1')?.textContent).toContain('Agenda spécialisé');
    expect(dom.querySelector('.calendar-agenda')).toBeTruthy();
    expect(dom.querySelector('.calendar-360-overview')).toBeNull();
    expect(dom.querySelector('.calendar-360-content')).toBeNull();
    expect(dom.querySelector('.calendar-month-wrap')).toBeNull();
    expect(dom.querySelector('.calendar-elements')).toBeNull();
  });

  it('place les préférences BPM dans le dépliant « Sources et affichage » de la page, une seule fois', async () => {
    const dom = await setup('budgetPatrimoine');
    const settings = dom.querySelector<HTMLDetailsElement>('details#sources-et-affichage')!;
    expect(settings.querySelector('summary')?.textContent).toContain('Sources et affichage');
    expect(settings.open).toBe(false);
    expect(settings.querySelector('#bpm-calendar-personalization h3')?.textContent).toContain('Votre calendrier, vos repères');
    expect(dom.querySelectorAll('#bpm-calendar-personalization')).toHaveLength(1);
    expect(dom.querySelector('.calendar-360-milestone')).toBeNull();
    expect(dom.textContent).not.toContain('Chronologie des événements');
    const button = [...dom.querySelectorAll<HTMLButtonElement>('bpm-page-banner button')].find((b) => b.textContent?.includes('Sources et affichage'))!;
    button.click();
    fixture.detectChanges();
    expect(settings.open).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('garde les synthèses et la grille de la page principale', async () => {
    const dom = await setup('noyau');
    expect(dom.querySelector('.calendar-360-overview')).toBeTruthy();
    expect(dom.querySelector('.calendar-360-content')).toBeTruthy();
    expect(dom.querySelector('.calendar-month-wrap')).toBeTruthy();
    expect(dom.querySelector('.calendar-agenda')).toBeTruthy();
  });
});
