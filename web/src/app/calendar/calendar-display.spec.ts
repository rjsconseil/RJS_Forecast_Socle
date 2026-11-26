import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RecetteContext } from '../core/api.service';
import { CalendarComponent } from './calendar.component';
import { CalendarData, CalendarDisplayChoice, CalendarEvent, CalendarFormat } from './calendar.models';
import { localToday } from './calendar-dates';
import { displayDefaults, resolveDisplayPreferences } from './calendar-display-preferences';

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
  display: { view: 'month', perCell: 2, perPeek: 4, peekCloseDelayMs: 260, format: 'standard' },
  formats: [
    { id: 'standard', label: 'Standard', layout: 'ligne', fields: ['amount', 'total'], perCell: null, builtIn: true },
    { id: 'compact', label: 'Compact', layout: 'pastille', fields: [], perCell: 4, builtIn: true },
    { id: 'detaille', label: 'Détaillé', layout: 'deux-lignes', fields: ['amount', 'total', 'status', 'group', 'type'], perCell: 2, builtIn: true },
  ],
  library: [
    { id: 'noyau.tache-echeance', label: 'Échéance de tâche', nature: 'task', tone: 'rouge', origin: { calendar: 'noyau', label: 'Calendrier du noyau' } },
  ],
  plugged: null,
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

describe('personnalisation du calendrier (même comportement pour chaque calendrier)', () => {
  let fixture: ComponentFixture<CalendarComponent>;
  const profile = signal<string | null>('calendar-test-a');
  const selected: CalendarEvent[][] = [];
  const plugged: (string[] | null)[] = [];
  const choices: (CalendarDisplayChoice | null)[] = [];
  const formatsSaved: CalendarFormat[][] = [];
  const dom = () => fixture.nativeElement as HTMLElement;
  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  async function create(presentation: 'calendar' | 'agenda' | 'sources' = 'calendar', source: CalendarData = data) {
    fixture = TestBed.createComponent(CalendarComponent);
    fixture.componentRef.setInput('presentation', presentation);
    fixture.componentRef.setInput('data', source);
    fixture.componentInstance.displayedEventsChange.subscribe((events) => selected.push(events));
    fixture.componentInstance.sourcesChange.subscribe((ids) => plugged.push(ids));
    fixture.componentInstance.preferencesChange.subscribe((choice) => choices.push(choice));
    fixture.componentInstance.formatsChange.subscribe((list) => formatsSaved.push(list));
    await settle();
  }
  async function toggle(label: string) {
    [...dom().querySelectorAll<HTMLLabelElement>('.cal-choice')]
      .find((el) => el.textContent?.trim().startsWith(label))!
      .querySelector<HTMLInputElement>('input')!
      .click();
    await settle();
  }

  beforeEach(() => {
    profile.set('calendar-test-a');
    for (const list of [selected, plugged, choices, formatsSaved]) list.length = 0;
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: RecetteContext, useValue: { userId: profile } }],
    });
  });

  it('porte lui-même le volet « Sources et affichage » : la page n’a qu’à l’ouvrir', async () => {
    await create();
    const settings = dom().querySelector<HTMLDetailsElement>('details#sources-et-affichage')!;
    expect(settings.closest('section.calendar')).toBeTruthy();
    expect(settings.querySelector('#cal-personalization h3')?.textContent).toContain('Votre calendrier, vos repères');
    expect(settings.open).toBe(false);
    fixture.componentInstance.toggleSettings();
    await settle();
    expect(settings.open).toBe(true);
    expect(fixture.componentInstance.settingsOpen()).toBe(true);
    await create('calendar', { ...data, interaction: { access: 'expanded', controls: { sources: true, fields: true, indicators: true, density: true, completed: true }, includeDone: true } });
    expect(dom().querySelector<HTMLDetailsElement>('details#sources-et-affichage')!.open).toBe(true);
    await create('calendar', { ...data, interaction: { access: 'hidden', controls: { sources: true, fields: true, indicators: true, density: true, completed: true }, includeDone: true } });
    expect(dom().querySelector('details#sources-et-affichage')).toBeNull();
  });

  it('filtre les sources, émet les événements affichés et confie le choix à enregistrer', async () => {
    await create();
    await toggle('Dépense');
    expect(selected.at(-1)?.map((item) => item.title)).toEqual(['Salaire']);
    expect(dom().querySelector('.calendar-agenda-list')?.textContent).not.toContain('Courses');
    expect(data.events).toHaveLength(2);
    expect(choices.at(-1)?.sources).toEqual({ revenu: true, depense: false });
  });

  it('applique les choix enregistrés du profil, et ceux d’un autre appareil quand ils changent', async () => {
    await create('calendar', { ...data, preferences: { display: { sources: { depense: false } }, revision: 1 } });
    expect(selected.at(-1)?.map((item) => item.element)).toEqual(['revenu']);
    fixture.componentRef.setInput('data', { ...data, preferences: { display: { sources: { depense: true }, format: 'compact' }, revision: 2 } });
    await settle();
    expect(selected.at(-1)).toHaveLength(2);
    expect(dom().querySelector('.calendar')?.getAttribute('data-format-layout')).toBe('pastille');
  });

  it('change de format d’affichage : la pastille masque les montants sans toucher aux données', async () => {
    await create();
    expect(dom().querySelectorAll('.calendar-agenda .calendar-amount')).toHaveLength(2);
    expect(dom().querySelector('.calendar')?.getAttribute('data-format-layout')).toBe('ligne');
    await toggle('Compact');
    expect(dom().querySelectorAll('.calendar-agenda .calendar-amount')).toHaveLength(0);
    expect(dom().querySelector('.calendar')?.getAttribute('data-format-layout')).toBe('pastille');
    expect(selected.at(-1)?.[0].amountCents).toBe(10000);
    expect(choices.at(-1)?.format).toBe('compact');
    await toggle('Détaillé');
    const cell = dom().querySelector('.calendar-grid .calendar-event')!;
    expect([...cell.querySelectorAll('small')].map((x) => x.className.split(' ')[0])).toEqual(['calendar-amount', 'cal-event-status', 'cal-event-group', 'cal-event-type']);
  });

  it('crée un format personnel, dans l’ordre choisi, et l’appelle comme un format livré', async () => {
    await create();
    [...dom().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Créer un format'))!.click();
    await settle();
    const name = dom().querySelector<HTMLInputElement>('.cal-format-editor input[type="text"]')!;
    name.value = 'Statut d’abord';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    [...dom().querySelectorAll<HTMLElement>('.cal-format-field')].find((x) => x.textContent?.includes('Statut'))!.querySelector('input')!.click();
    await settle();
    [...dom().querySelectorAll<HTMLElement>('.cal-format-field.is-on')].find((x) => x.textContent?.includes('Statut'))!.querySelector<HTMLButtonElement>('.cal-format-move')!.click();
    await settle();
    dom().querySelector<HTMLFormElement>('.cal-format-editor')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const own = { id: 'perso-statut-d-abord', label: 'Statut d’abord', layout: 'ligne' as const, fields: ['amount' as const, 'status' as const, 'total' as const], perCell: null, builtIn: false, own: true };
    expect(formatsSaved.at(-1)).toEqual([own]);
    expect(choices.at(-1)?.format).toBe('perso-statut-d-abord');
    expect(dom().querySelector('.cal-format-row.is-active')?.textContent).toContain('Statut d’abord');
    const cell = dom().querySelector('.calendar-grid .calendar-event')!;
    expect([...cell.querySelectorAll('small')].map((x) => x.className.split(' ')[0])).toEqual(['calendar-amount', 'cal-event-status']);
    // Rendu par le serveur dans un autre calendrier, il s'appelle comme un format livré.
    await create('calendar', { ...data, calendar: { ...data.calendar, id: 'noyau' }, formats: [...data.formats!, own], preferences: { display: { format: own.id }, revision: 1 } });
    expect(dom().querySelector('.cal-format-row.is-active')?.textContent).toContain('Statut d’abord');
  });

  it('branche une source que la page propose et débranche une source', async () => {
    await create();
    expect(dom().querySelector('.cal-library')?.textContent).toContain('Calendrier du noyau');
    [...dom().querySelectorAll<HTMLButtonElement>('.cal-library-row button')][0].click();
    expect(plugged.at(-1)).toEqual(['revenu', 'depense', 'noyau.tache-echeance']);
    dom().querySelector<HTMLButtonElement>('[aria-label="Débrancher la source Dépense"]')!.click();
    expect(plugged.at(-1)).toEqual(['revenu']);
    await create('calendar', { ...data, library: [] });
    expect(dom().querySelector('.cal-library')).toBeNull();
  });

  it('met en évidence un événement sans déplacer la liste au survol ou au clavier', async () => {
    await create();
    const list = dom().querySelector<HTMLElement>('.calendar-agenda-list')!;
    const scroll = vi.fn();
    list.scrollTo = scroll;
    const card = dom().querySelector<HTMLButtonElement>('.calendar-grid .calendar-event')!;
    card.dispatchEvent(new Event('pointerenter'));
    await settle();
    expect(dom().querySelector('.calendar-agenda-item.is-linked')?.textContent).toContain('Salaire');
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
    [...dom().querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === 'Afficher toutes les sources')!.click();
    await settle();
    expect(selected.at(-1)).toHaveLength(2);
  });

  it('retrouve un repère depuis le bandeau et ignore une source masquée', async () => {
    await create();
    for (const entry of dom().querySelectorAll<HTMLElement>('.calendar-agenda-item')) entry.scrollIntoView = vi.fn();
    fixture.componentInstance.focusEvent(data.events[1]);
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dom().querySelector('.calendar-agenda-item.is-pinned')?.textContent).toContain('Courses');
    expect(dom().querySelectorAll('.calendar-agenda-item.is-pinned')).toHaveLength(1);
    expect(document.activeElement?.textContent).toContain('Courses');
    await toggle('Revenu');
    fixture.componentInstance.focusEvent(data.events[0]);
    await settle();
    expect(dom().querySelector('.calendar-agenda-item.is-pinned')?.textContent).toContain('Courses');
  });

  it('rend un autre calendrier exactement de la même façon : même volet, mêmes commandes', async () => {
    const other: CalendarData = { ...data, calendar: { id: 'noyau', label: 'Calendrier du noyau', description: null } };
    await create('calendar', other);
    expect(dom().querySelector('.calendar.is-canonical')).not.toBeNull();
    expect(dom().querySelectorAll('#cal-personalization')).toHaveLength(1);
    expect(dom().querySelector('details#sources-et-affichage')).not.toBeNull();
    expect(selected.at(-1)).toHaveLength(2);
  });

  it('consacre l’agenda aux événements et conserve l’ouverture et la replanification', async () => {
    await create('agenda');
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

  it('présente la page « Sources et affichage » avec le même panneau, sans grille', async () => {
    await create('sources');
    expect(dom().querySelector('.calendar-360-settings-page #cal-personalization')).toBeTruthy();
    expect(dom().querySelector('.calendar-elements')).toBeNull();
    expect(dom().querySelector('.calendar-month-wrap')).toBeNull();
    fixture.componentInstance.setIncludeDone(false);
    fixture.componentInstance.selectGroup('budget');
    await settle();
    expect(TestBed.inject(Router).url).toContain('calGroup=budget');
    expect(choices.at(-1)?.includeDone).toBe(false);
  });

  it('réinitialise sources, format, densité et indicateurs : retour aux valeurs du calendrier', async () => {
    await create('calendar', { ...data, plugged: ['revenu', 'depense'] });
    await toggle('Dépense');
    await toggle('Flux du jour');
    const select = dom().querySelector<HTMLSelectElement>('[aria-label="Événements par case"]')!;
    select.selectedIndex = 3;
    select.dispatchEvent(new Event('change'));
    await settle();
    [...dom().querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === 'Réinitialiser')!.click();
    await settle();
    expect(choices.at(-1)).toBeNull();
    expect(plugged.at(-1)).toBeNull();
    expect(selected.at(-1)).toHaveLength(2);
  });
});

describe('préférences enregistrées et contrat administré', () => {
  const interaction = {
    access: 'collapsed' as const,
    controls: { sources: true, fields: true, indicators: true, density: true, completed: true },
    includeDone: false,
  };
  it('résout le choix enregistré avec les valeurs du calendrier et ignore les valeurs abîmées', () => {
    expect(resolveDisplayPreferences(data)).toEqual(displayDefaults(data));
    const result = resolveDisplayPreferences({ ...data, preferences: { display: { sources: { revenu: false }, perCell: -1, indicators: ['flux', 'inconnue' as never], format: 'compact' }, revision: 3 } });
    expect(result.sources).toEqual({ revenu: false, depense: true });
    expect(result.perCell).toBeNull();
    expect(result.indicators).toEqual(['flux']);
    expect(result.format).toBe('compact');
  });
  it('impose les valeurs administrées lorsque les commandes sont verrouillées', () => {
    const locked = { ...data, interaction: { ...interaction, controls: { sources: false, fields: false, indicators: false, density: false, completed: false } }, preferences: { display: { sources: { revenu: false, depense: false }, format: 'compact', indicators: [], perCell: 6, includeDone: true }, revision: 1 } };
    expect(resolveDisplayPreferences(locked)).toEqual(displayDefaults(locked));
    const hidden = { ...locked, interaction: { ...interaction, access: 'hidden' as const } };
    expect(resolveDisplayPreferences(hidden)).toEqual(displayDefaults(hidden));
  });
});
