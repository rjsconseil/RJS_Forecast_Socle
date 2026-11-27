import { vi } from 'vitest';
import { MonthPeek, PeekHost, safeTop, YearPeek } from './calendar-peeks';

// Aperçus du calendrier : état du jour survolé, focalisé, épinglé, déplié, côté d'ouverture et fermeture différée.
const host = (days = ['2026-11-10', '2026-11-11']) => {
  const h = {
    hasDay: (d: string) => days.includes(d),
    selectDay: vi.fn(),
    closeDelay: () => 50,
    view: () => 'month' as const,
    closeDetails: vi.fn(),
    pointer: { at: null as { x: number; y: number } | null },
  };
  return h as typeof h & PeekHost;
};
const cell = (day: string) => {
  const el = document.createElement('div');
  el.className = 'calendar-day';
  el.setAttribute('data-day', day);
  el.getBoundingClientRect = () => ({ left: 100, top: 100, width: 100, height: 80, right: 200, bottom: 180, x: 100, y: 100, toJSON: () => ({}) });
  document.body.appendChild(el);
  return el;
};
const pointer = (target: Element, x: number, y = 120, inner: Element = target) =>
  ({ currentTarget: target, target: inner, clientX: x, clientY: y, stopPropagation: () => undefined }) as unknown as PointerEvent;

describe('aperçus du calendrier', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    // jsdom n'a pas elementFromPoint : rien sous le pointeur.
    document.elementFromPoint = () => null;
  });
  afterEach(() => vi.useRealTimers());

  it('mois : le survol ouvre l’aperçu du côté du pointeur, puis le geste horizontal le retourne une fois', () => {
    const h = host(); const peek = new MonthPeek(h); const el = cell('2026-11-10');
    peek.enterMonthDay('2026-11-10', pointer(el, 120));
    expect(peek.visibleMonthDay()).toBe('2026-11-10');
    expect(peek.monthPeekSide).toBe(-1);
    expect(h.pointer.at).toEqual({ x: 120, y: 120 });
    peek.orientMonthPeek('2026-11-10', pointer(el, 125));
    expect(peek.monthPeekSide).toBe(-1); // moins de 10 px : rien ne change
    peek.orientMonthPeek('2026-11-10', pointer(el, 140));
    expect(peek.monthPeekSide).toBe(1);
    peek.orientMonthPeek('2026-11-10', pointer(el, 60));
    expect(peek.monthPeekSide).toBe(1); // côté verrouillé après le premier geste
  });

  it('mois : un geste vertical ou dans l’aperçu verrouille le côté ; un jour inconnu est ignoré', () => {
    const peek = new MonthPeek(host()); const el = cell('2026-11-10');
    peek.enterMonthDay('2026-11-99', pointer(el, 120));
    expect(peek.visibleMonthDay()).toBeNull();
    peek.enterMonthDay('2026-11-10', pointer(el, 180));
    peek.orientMonthPeek('2026-11-10', pointer(el, 180, 160));
    peek.orientMonthPeek('2026-11-10', pointer(el, 100));
    expect(peek.monthPeekSide).toBe(1);
    const inner = document.createElement('div'); inner.className = 'calendar-day-peek'; el.appendChild(inner);
    peek.resetGesture();
    peek.enterMonthDay('2026-11-10', pointer(el, 180));
    peek.orientMonthPeek('2026-11-10', pointer(el, 100, 120, inner));
    expect(peek.monthPeekSide).toBe(1);
  });

  it('mois : la sortie ferme après le délai, sauf si le pointeur est revenu sur le jour', () => {
    const h = host(); const peek = new MonthPeek(h); const el = cell('2026-11-10');
    peek.enterMonthDay('2026-11-10', pointer(el, 120));
    peek.leaveMonthDay('2026-11-10');
    vi.advanceTimersByTime(49);
    expect(peek.hoveredMonthDay()).toBe('2026-11-10');
    vi.advanceTimersByTime(1);
    expect(peek.hoveredMonthDay()).toBeNull();
    expect(h.closeDetails).toHaveBeenCalledTimes(1);
    // Retour sur le jour avant la fin du délai : l'aperçu reste.
    peek.enterMonthDay('2026-11-10', pointer(el, 120));
    peek.leaveMonthDay('2026-11-10');
    peek.enterMonthDay('2026-11-10', pointer(el, 120));
    vi.advanceTimersByTime(100);
    expect(peek.hoveredMonthDay()).toBe('2026-11-10');
    // Pointeur encore sur le jour à la fin du délai : l'aperçu reste aussi.
    document.elementFromPoint = () => el;
    peek.leaveMonthDay('2026-11-10');
    vi.advanceTimersByTime(50);
    expect(peek.hoveredMonthDay()).toBe('2026-11-10');
  });

  it('mois : épingler, déplier et désépingler un jour ; le focus et sa perte', () => {
    const peek = new MonthPeek(host()); const el = cell('2026-11-10');
    const click = (target: Element) => ({ currentTarget: el, target, stopPropagation: () => undefined }) as unknown as MouseEvent;
    peek.toggleMonthPeekPin('2026-11-10', click(el));
    expect(peek.pinnedMonthDay()).toBe('2026-11-10');
    const more = document.createElement('button'); more.className = 'calendar-more'; el.appendChild(more);
    peek.toggleMonthPeekPin('2026-11-10', click(more));
    expect(peek.pinnedMonthDay()).toBe('2026-11-10'); // le bouton « plus » ne désépingle pas
    peek.toggleDayExpansion('2026-11-10', { currentTarget: more, stopPropagation: () => undefined } as unknown as MouseEvent);
    expect(peek.expandedDay()).toBe('2026-11-10');
    expect(peek.pinnedMonthDay()).toBe('2026-11-10');
    peek.toggleMonthPeekPin('2026-11-10', click(el));
    expect(peek.pinnedMonthDay()).toBeNull();
    expect(peek.expandedDay()).toBeNull();
    // Survol pendant un épinglage : le jour survolé est noté, l'aperçu épinglé reste visible.
    peek.setGridDayPin('2026-11-10', el);
    cell('2026-11-11');
    peek.enterMonthDay('2026-11-11', pointer(el, 120));
    expect(peek.visibleMonthDay()).toBe('2026-11-10');
    peek.setGridDayPin('2026-11-10', null);
    peek.focusMonthDay('2026-11-11', { currentTarget: el } as unknown as FocusEvent);
    expect(peek.focusedMonthDay()).toBe('2026-11-11');
    const child = document.createElement('span'); el.appendChild(child);
    peek.clearMonthDayFocus({ currentTarget: el, relatedTarget: child } as unknown as FocusEvent);
    expect(peek.focusedMonthDay()).toBe('2026-11-11'); // le focus reste dans le jour
    peek.clearMonthDayFocus({ currentTarget: el, relatedTarget: null } as unknown as FocusEvent);
    expect(peek.focusedMonthDay()).toBeNull();
  });

  it('mois : sur petit écran, l’aperçu n’a pas de position calculée', () => {
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 });
    const peek = new MonthPeek(host());
    peek.positionMonthPeek(cell('2026-11-10'), 1);
    expect(peek.monthPeekPosition()).toEqual({ x: null, top: null, maxHeight: null, bridgeHeight: null });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  });

  it('année : un clic sélectionne et épingle le jour, un second clic le désépingle', () => {
    const h = host(); const peek = new YearPeek(h); const el = cell('2026-11-10');
    const click = { currentTarget: el } as unknown as MouseEvent;
    peek.toggleYearDay('2026-11-10', click);
    expect(h.selectDay).toHaveBeenCalledWith('2026-11-10');
    expect(peek.pinnedYearDay()).toBe('2026-11-10');
    expect(peek.visibleYearDay()).toBe('2026-11-10');
    peek.toggleYearDay('2026-11-10', click);
    expect(peek.pinnedYearDay()).toBeNull();
    peek.toggleYearDay('2026-01-01', click);
    expect(h.selectDay).toHaveBeenCalledTimes(2); // jour inconnu ignoré
  });

  it('année : survol, orientation, sortie différée et perte du focus', () => {
    const h = host(); const peek = new YearPeek(h); const el = cell('2026-11-10');
    peek.enterYearDay('2026-11-10', pointer(el, 180));
    expect(peek.visibleYearDay()).toBe('2026-11-10');
    peek.orientYearPeek('2026-11-10', pointer(el, 170));
    peek.orientYearPeek('2026-11-10', pointer(el, 200));
    peek.positionYearPeekOnFocus({ currentTarget: el } as unknown as FocusEvent);
    peek.leaveYearDay('2026-11-10');
    vi.advanceTimersByTime(50);
    expect(peek.hoveredYearDay()).toBeNull();
    expect(h.closeDetails).toHaveBeenCalled();
    peek.enterYearDay('2026-11-10', pointer(el, 120));
    peek.orientYearPeek('2026-11-10', pointer(el, 120, 140)); // geste vertical : côté verrouillé
    peek.focusedYearDay.set('2026-11-10');
    peek.clearYearDayFocus({ currentTarget: el, relatedTarget: null } as unknown as FocusEvent);
    expect(peek.focusedYearDay()).toBeNull();
    vi.advanceTimersByTime(50);
    expect(peek.visibleYearDay()).toBeNull();
    peek.scheduleYearPeekClose(null);
    vi.advanceTimersByTime(50);
  });

  it('safeTop : un bandeau figé qui recouvre la grille repousse l’aperçu sous lui', () => {
    const page = document.createElement('div'); page.className = 'page';
    const head = document.createElement('div'); head.className = 'page-head'; head.style.position = 'sticky';
    head.getBoundingClientRect = () => ({ bottom: 140 }) as DOMRect;
    const wrap = document.createElement('div'); wrap.className = 'calendar-month-wrap';
    wrap.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    const day = document.createElement('div');
    wrap.appendChild(day); page.append(head, wrap); document.body.appendChild(page);
    expect(safeTop(day)).toBe(148);
    head.style.position = 'static';
    expect(safeTop(day)).toBe(100);
  });
});
