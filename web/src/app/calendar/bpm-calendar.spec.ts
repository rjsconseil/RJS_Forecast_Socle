import { ApplicationRef, EmbeddedViewRef, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RecetteContext } from '../core/api.service';
import { CalendarComponent } from './calendar.component';
import { CalendarData, CalendarEvent } from './calendar.models';
import { localToday } from './calendar-dates';
import {
  displayDefaults,
  preferencesKey,
  readDisplayPreferences,
  writeDisplayPreferences,
} from './bpm-calendar-preferences';

const event = (element: string, direction: CalendarEvent['direction']): CalendarEvent => ({
  key: element,
  element,
  direction,
  nature: 'operation',
  objectId: element,
  revision: 1,
  date: localToday(),
  title: element === 'revenu' ? 'Salaire' : 'Courses',
  done: false,
  status: 'planned',
  statusLabel: 'Prévu',
  urgent: null,
  groupId: 'budget',
  groupLabel: 'Budget du projet de vie',
  amountCents: 10000,
  link: null,
  details: [],
  reschedule: null,
});
const data: CalendarData = {
  calendar: { id: 'budgetPatrimoine', label: 'Calendrier BPM', description: null },
  parameter: null,
  window: { from: localToday(), to: localToday() },
  today: localToday(),
  display: { view: 'month', perCell: 2, perPeek: 4, peekCloseDelayMs: 260 },
  indicators: [
    { key: 'flux', label: 'Flux du jour' },
    { key: 'solde', label: 'Solde' },
  ],
  elements: [
    {
      id: 'revenu',
      label: 'Revenu',
      nature: 'operation',
      tone: 'vert',
      marker: 'point',
      visible: true,
      objectLabel: { one: 'revenu', many: 'revenus' },
      hover: [],
      reschedulable: false,
    },
    {
      id: 'depense',
      label: 'Dépense',
      nature: 'operation',
      tone: 'rouge',
      marker: 'point',
      visible: true,
      objectLabel: { one: 'dépense', many: 'dépenses' },
      hover: [],
      reschedulable: false,
    },
  ],
  events: [event('revenu', 'entree'), event('depense', 'sortie')],
};

describe('personnalisation du calendrier BPM', () => {
  let fixture: ComponentFixture<CalendarComponent>;
  const profile = signal<string | null>('calendar-test-a');
  const selected: CalendarEvent[][] = [];
  /** L'encadré de personnalisation, affiché comme le fait la page (dans son dépliant), à côté du calendrier. */
  let panel: EmbeddedViewRef<unknown> | null = null;
  const dom = () => fixture.nativeElement as HTMLElement;
  async function settle() {
    fixture.detectChanges();
    panel?.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    panel?.detectChanges();
  }
  async function create(bpm = true, presentation: 'calendar' | 'agenda' | 'sources' = 'calendar') {
    fixture = TestBed.createComponent(CalendarComponent);
    fixture.componentRef.setInput('bpm', bpm);
    fixture.componentRef.setInput('presentation', presentation);
    fixture.componentRef.setInput('data', data);
    fixture.componentInstance.displayedEventsChange.subscribe((events) => selected.push(events));
    await settle();
    if (bpm && presentation === 'calendar') {
      panel?.destroy();
      panel = fixture.componentInstance.personalization().createEmbeddedView(null);
      TestBed.inject(ApplicationRef).attachView(panel);
      dom().append(...panel.rootNodes);
      await settle();
    }
  }
  async function toggle(label: string) {
    [...dom().querySelectorAll<HTMLLabelElement>('.bpm-calendar-choice')]
      .find((el) => el.textContent?.trim().startsWith(label))!
      .querySelector<HTMLInputElement>('input')!
      .click();
    await settle();
  }

  afterEach(() => {
    panel?.destroy();
    panel = null;
  });

  beforeEach(() => {
    profile.set('calendar-test-a');
    selected.length = 0;
    localStorage.removeItem(preferencesKey('calendar-test-a'));
    localStorage.removeItem(preferencesKey('calendar-test-b'));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: RecetteContext, useValue: { userId: profile } }],
    });
  });

  it('filtre les sources et émet les événements affichés sans modifier les données source', async () => {
    await create();
    await toggle('Dépense');
    expect(selected.at(-1)?.map((item) => item.title)).toEqual(['Salaire']);
    expect(dom().querySelector('.calendar-agenda-list')?.textContent).not.toContain('Courses');
    expect(data.events).toHaveLength(2);
    expect(readDisplayPreferences('calendar-test-a', data).sources['depense']).toBe(false);
    expect(readDisplayPreferences('calendar-test-b', data).sources['depense']).toBe(true);
  });

  it('retrouve les choix du profil puis isole ceux d’un autre profil', async () => {
    const saved = displayDefaults(data);
    saved.sources['depense'] = false;
    writeDisplayPreferences('calendar-test-a', saved);
    await create();
    expect(selected.at(-1)?.map((item) => item.element)).toEqual(['revenu']);
    profile.set('calendar-test-b');
    await settle();
    expect(selected.at(-1)).toHaveLength(2);
    profile.set('calendar-test-a');
    await settle();
    expect(selected.at(-1)?.map((item) => item.element)).toEqual(['revenu']);
  });

  it('masque les montants de la liste et les conserve dans les données', async () => {
    await create();
    expect(dom().querySelectorAll('.calendar-agenda .calendar-amount')).toHaveLength(2);
    await toggle('Montant des événements');
    expect(dom().querySelectorAll('.calendar-agenda .calendar-amount')).toHaveLength(0);
    expect(selected.at(-1)?.[0].amountCents).toBe(10000);
    expect(readDisplayPreferences('calendar-test-a', data).fields.amount).toBe(false);
  });

  it('met en évidence un événement sans déplacer la liste BPM au survol ou au clavier', async () => {
    await create();
    const list = dom().querySelector<HTMLElement>('.calendar-agenda-list')!;
    const scroll = vi.fn();
    list.scrollTo = scroll;
    const card = dom().querySelector<HTMLButtonElement>('.calendar-grid .calendar-event')!;
    card.dispatchEvent(new Event('pointerenter'));
    await settle();
    expect(dom().querySelector('.calendar-agenda-item.is-linked')?.textContent).toContain(
      'Salaire',
    );
    card.focus();
    await settle();
    expect(scroll).not.toHaveBeenCalled();
  });

  it('explique une sélection vide et permet de tout réafficher', async () => {
    await create();
    await toggle('Revenu');
    await toggle('Dépense');
    expect(selected.at(-1)).toEqual([]);
    expect(dom().textContent).toContain('Aucune source sélectionnée');
    [...dom().querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'Afficher toutes les sources')!
      .click();
    await settle();
    expect(selected.at(-1)).toHaveLength(2);
  });

  it('retrouve un repère depuis le bandeau et ignore une source masquée', async () => {
    await create();
    const entries = [...dom().querySelectorAll<HTMLElement>('.calendar-agenda-item')];
    for (const entry of entries) entry.scrollIntoView = vi.fn();
    fixture.componentInstance.focusEvent(data.events[1]);
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dom().querySelector('.calendar-agenda-item.is-pinned')?.textContent).toContain(
      'Courses',
    );
    expect(dom().querySelectorAll('.calendar-agenda-item.is-pinned')).toHaveLength(1);
    expect(document.activeElement?.textContent).toContain('Courses');
    await toggle('Revenu');
    fixture.componentInstance.focusEvent(data.events[0]);
    await settle();
    expect(dom().querySelector('.calendar-agenda-item.is-pinned')?.textContent).toContain(
      'Courses',
    );
  });

  it('n’active ni panneau ni préférences BPM dans les autres calendriers', async () => {
    await create(false);
    expect(dom().querySelector('.bpm-calendar-customize')).toBeNull();
    expect(dom().querySelector('.calendar-elements')).not.toBeNull();
    expect(dom().querySelector('.is-bpm-calendar')).toBeNull();
    expect(selected).toEqual([]);
  });

  it('consacre l’agenda aux événements et conserve l’ouverture et la replanification', async () => {
    await create(true, 'agenda');
    const actionable = { ...data.events[0], link: '/projects/p1', reschedule: { method: 'PUT' as const, url: '/api/tasks/t1', field: 'dueDate' } };
    fixture.componentRef.setInput('data', { ...data, events: [actionable] });
    const opened: CalendarEvent[] = [];
    const moved: { event: CalendarEvent; date: string }[] = [];
    fixture.componentInstance.open.subscribe((item) => opened.push(item));
    fixture.componentInstance.reschedule.subscribe((item) => moved.push(item));
    await settle();
    expect(dom().querySelector('.calendar-month-wrap')).toBeNull();
    expect(dom().querySelector('.calendar-grid-shortcut')).toBeNull();
    expect(dom().querySelector('.calendar-agenda-item')?.textContent).toContain('Salaire');
    [...dom().querySelectorAll<HTMLButtonElement>('.calendar-agenda-actions button')].find((button) => button.textContent?.trim() === 'Ouvrir')!.click();
    expect(opened).toEqual([actionable]);
    [...dom().querySelectorAll<HTMLButtonElement>('.calendar-agenda-actions button')].find((button) => button.textContent?.trim() === 'Replanifier')!.click();
    await settle();
    const input = dom().querySelector<HTMLInputElement>('.calendar-plan input')!;
    input.value = '2027-01-12';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    dom().querySelector<HTMLFormElement>('.calendar-plan')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(moved).toEqual([{ event: actionable, date: '2027-01-12' }]);
    fixture.componentRef.setInput('error', 'Cette période est close. Choisissez une autre date.');
    await settle();
    expect(dom().querySelector<HTMLInputElement>('.calendar-plan input')?.value).toBe('2027-01-12');
    expect(dom().querySelector('[role="alert"]')?.textContent).toContain('Cette période est close');
  });

  it('garde l’encadré hors de la grille et retrouve les choix du profil dans l’agenda', async () => {
    await create(true, 'calendar');
    expect(fixture.nativeElement.querySelector('.calendar #bpm-calendar-personalization')).toBeNull();
    expect(dom().querySelectorAll('#bpm-calendar-personalization')).toHaveLength(1);
    await toggle('Dépense');
    expect(readDisplayPreferences('calendar-test-a', data).sources['depense']).toBe(false);
    panel?.destroy();
    panel = null;
    fixture.destroy();
    await create(true, 'agenda');
    expect(dom().querySelector('.calendar-agenda-list')?.textContent).not.toContain('Courses');
  });

  it('reprend les sources génériques et les filtres de l’URL dans l’agenda', async () => {
    await create(false, 'sources');
    const expense = [...dom().querySelectorAll<HTMLLabelElement>('.calendar-element-toggle')].find((label) => label.textContent?.includes('Dépense'))!;
    expense.querySelector<HTMLInputElement>('input')!.click();
    fixture.componentInstance.setIncludeDone(false);
    fixture.componentInstance.selectGroup('budget');
    await settle();
    const url = TestBed.inject(Router).url;
    expect(url).toContain('calHidden=depense');
    expect(url).toContain('calDone=0');
    expect(url).toContain('calGroup=budget');
    fixture.destroy();
    await create(false, 'agenda');
    expect(dom().querySelector('.calendar-agenda-list')?.textContent).toContain('Salaire');
    expect(dom().querySelector('.calendar-agenda-list')?.textContent).not.toContain('Courses');
    expect(fixture.componentInstance.toolbarState().includeDone).toBe(false);
    expect(fixture.componentInstance.toolbarState().group).toBe('budget');
  });

  it('réinitialise les sources, la densité et les indicateurs du service', async () => {
    await create();
    await toggle('Dépense');
    await toggle('Flux du jour');
    const select = dom().querySelector<HTMLSelectElement>('[aria-label="Événements par case"]')!;
    select.selectedIndex = 3;
    select.dispatchEvent(new Event('change'));
    await settle();
    [...dom().querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'Réinitialiser')!
      .click();
    await settle();
    expect(readDisplayPreferences('calendar-test-a', data)).toEqual(displayDefaults(data));
    expect(selected.at(-1)).toHaveLength(2);
  });

  it('ignore les préférences corrompues et conserve les nouvelles sources du service', () => {
    localStorage.setItem(preferencesKey('calendar-test-a'), '{invalid');
    expect(readDisplayPreferences('calendar-test-a', data)).toEqual(displayDefaults(data));
    localStorage.setItem(
      preferencesKey('calendar-test-a'),
      JSON.stringify({
        sources: { revenu: false },
        perCell: -1,
        indicators: ['flux', 'inconnue'],
        fields: { amount: false },
      }),
    );
    const result = readDisplayPreferences('calendar-test-a', data);
    expect(result.sources).toEqual({ revenu: false, depense: true });
    expect(result.perCell).toBe(2);
    expect(result.indicators).toEqual(['flux']);
    expect(result.fields.amount).toBe(false);
  });
});
