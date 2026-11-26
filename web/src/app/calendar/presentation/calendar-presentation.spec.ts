import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { RecetteContext } from '../../core/api.service';
import { CalendarComponent } from '../calendar.component';
import { CalendarData, CalendarDisplayChoice } from '../calendar.models';
import { localToday } from '../calendar-dates';
import {
  FONDU_EFFECT,
  HORIZON_DESIGN,
  STANDARD_DESIGN,
  defineCalendarDesign,
  defineCalendarEffect,
  designStyle,
  effectStyle,
  effectValues,
  injectCalendarPresentation,
  provideCalendarDesigns,
  provideCalendarEffects,
} from './calendar-presentation';

// Couche de présentation : design (apparence) et effets d'affichage (mouvement), séparés et extensibles par le site.
describe('présentation du calendrier · définitions', () => {
  it('le standard ne pose rien : l’apparence et les fondus d’origine restent intacts', () => {
    expect(designStyle(STANDARD_DESIGN)).toEqual({});
    expect(effectStyle(defineCalendarEffect({ id: 'x', label: 'X', description: '', motion: { enter: 'none', leave: 'none', stagger: false, hover: 'none', period: 'none' }, defaults: {} }), effectValues(FONDU_EFFECT, {}))).toEqual({});
  });

  it('un design est une donnée : ses jetons deviennent des variables, un jeton inconnu est refusé', () => {
    expect(designStyle(HORIZON_DESIGN)['--cal-d-surface-alt']).toBe('rgba(255,255,255,.74)');
    expect(HORIZON_DESIGN.tokens.stateNegative).toBe('#dc2626');
    expect(HORIZON_DESIGN.tokens.statePositive).toBe('#16a34a');
    expect(HORIZON_DESIGN.tokens.stateNeutral).toBe('#2563eb');
    expect(() => defineCalendarDesign({ id: 'Mauvais', label: 'X', description: '', swatch: ['#fff', '#fff', '#fff'], tokens: {} })).toThrow(/identifiant/);
    expect(() => defineCalendarDesign({ id: 'x', label: 'X', description: '', swatch: ['#fff', '#fff', '#fff'], tokens: { couleur: 'red' } as never })).toThrow(/jeton inconnu/);
  });

  it('un effet nomme ses primitives et ses réglages ; les valeurs de la personne restent dans les bornes', () => {
    const values = effectValues(FONDU_EFFECT, { enterMs: 99999, leaveMs: 333, staggerMs: -5, peekMs: 'x' as never });
    expect(values).toMatchObject({ enterMs: 1500, leaveMs: 330, staggerMs: 0, peekMs: 220, distancePx: 6 });
    expect(effectStyle(FONDU_EFFECT, values)).toMatchObject({ '--cal-fx-enter': '1500ms', '--cal-fx-leave': '330ms', '--cal-fx-distance': '6px' });
    expect(() => defineCalendarEffect({ ...FONDU_EFFECT, id: 'y', motion: { ...FONDU_EFFECT.motion, enter: 'rebond' as never } })).toThrow(/primitive/);
    expect(() => defineCalendarEffect({ ...FONDU_EFFECT, id: 'y', defaults: { enterMs: 5000 } })).toThrow(/hors/);
  });

  it('le site ajoute ses designs et ses effets après ceux du module ; « standard » reste le premier', () => {
    TestBed.configureTestingModule({
      providers: [
        provideCalendarDesigns({ id: 'charte-site', label: 'Charte du site', description: '', swatch: ['#000', '#111', '#222'], tokens: { accent: '#0f766e' } }),
        provideCalendarEffects({ id: 'doux', label: 'Doux', description: '', motion: { enter: 'fade', leave: 'fade', stagger: false, hover: 'none', period: 'crossfade' }, defaults: { enterMs: 500, leaveMs: 400 } }),
      ],
    });
    const catalog = TestBed.runInInjectionContext(() => injectCalendarPresentation());
    expect(catalog.designs.map((d) => d.id)).toEqual(['standard', 'horizon', 'charte-site']);
    expect(catalog.effects.map((e) => e.id)).toEqual(['standard', 'fondu-fluide', 'immobile', 'doux']);
  });
});

const data: CalendarData = {
  calendar: { id: 'noyau', label: 'Calendrier', description: null },
  parameter: null,
  window: { from: localToday(), to: localToday() },
  today: localToday(),
  display: { view: 'month', perCell: 2, perPeek: 4, peekCloseDelayMs: 260, format: 'standard' },
  indicators: [{ key: 'flux', label: 'Flux' }],
  elements: [{ id: 'revenu', label: 'Revenu', nature: 'operation', tone: 'vert', marker: 'point', visible: true, objectLabel: { one: 'revenu', many: 'revenus' }, hover: [], reschedulable: false }],
  events: [{ key: 'revenu:a', element: 'revenu', nature: 'operation', objectId: 'a', revision: 1, date: localToday(), title: 'Salaire', done: false, status: null, statusLabel: null, urgent: null, groupId: null, groupLabel: null, amountCents: 1000, direction: 'entree', link: null, details: [], reschedule: null }],
};

describe('présentation du calendrier · choix dans le volet', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: RecetteContext, useValue: { userId: signal('presentation-test') } }] }));

  async function create(source: CalendarData = data) {
    const fixture = TestBed.createComponent(CalendarComponent);
    const choices: (CalendarDisplayChoice | null)[] = [];
    fixture.componentRef.setInput('data', source);
    fixture.componentInstance.preferencesChange.subscribe((c) => choices.push(c));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const section = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('section.calendar')!;
    const click = async (label: string) => {
      [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLLabelElement>('.cal-look-option')].find((o) => o.textContent?.trim().startsWith(label))!.querySelector('input')!.click();
      fixture.detectChanges();
      await fixture.whenStable();
    };
    return { fixture, choices, section, click };
  }

  it('s’ouvre en standard, puis passe au design et à l’effet proposés, choisis séparément', async () => {
    const { section, click, choices, fixture } = await create();
    expect([section().dataset['calDesign'], section().dataset['calEffect'], section().getAttribute('style')]).toEqual(['standard', 'standard', null]);
    await click('Horizon');
    expect(section().dataset['calDesign']).toBe('horizon');
    expect(section().dataset['calEffect']).toBe('standard');
    expect(section().style.getPropertyValue('--cal-d-accent')).toBe('#4f46e5');
    expect(choices.at(-1)).toMatchObject({ design: 'horizon', effect: 'standard' });
    await click('Fondu fluide');
    expect([section().dataset['fxEnter'], section().dataset['fxLeave'], section().dataset['fxPeriod']]).toEqual(['fade-up', 'fade', 'crossfade']);
    expect(section().style.getPropertyValue('--cal-fx-enter')).toBe('320ms');
    const sliders = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>('.cal-look-param input[type="range"]');
    expect(sliders).toHaveLength(6);
    sliders[0].value = '600';
    sliders[0].dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(section().style.getPropertyValue('--cal-fx-enter')).toBe('600ms');
    expect(choices.at(-1)?.effectParams).toEqual({ enterMs: 600 });
  });

  it('respecte le design et l’effet d’ouverture du calendrier, puis le choix enregistré', async () => {
    const opening = await create({ ...data, display: { ...data.display, design: 'horizon', effect: 'fondu-fluide' } });
    expect([opening.section().dataset['calDesign'], opening.section().dataset['calEffect']]).toEqual(['horizon', 'fondu-fluide']);
    const saved = await create({ ...data, preferences: { display: { design: 'standard', effect: 'immobile' }, revision: 1 } });
    expect(saved.section().classList.contains('cal-fx-still')).toBe(true);
  });

  it('fondu enchaîné : la période s’efface le temps réglé avant que la suivante n’arrive', async () => {
    vi.useFakeTimers();
    try {
      const { fixture, click, section } = await create({ ...data, preferences: { display: { effect: 'fondu-fluide', effectParams: { leaveMs: 300 } }, revision: 1 } });
      void click;
      const periods: string[] = [];
      fixture.componentInstance.periodChange.subscribe((p) => periods.push(p.from));
      fixture.componentInstance.movePeriod(1);
      fixture.detectChanges();
      expect(section().classList.contains('is-period-leaving')).toBe(true);
      expect(periods).toEqual([]);
      vi.advanceTimersByTime(300);
      fixture.detectChanges();
      expect(section().classList.contains('is-period-leaving')).toBe(false);
      expect(periods).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
