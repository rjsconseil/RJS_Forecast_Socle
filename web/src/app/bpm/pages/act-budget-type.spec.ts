import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BpmApi } from '../data/bpm-api.service';
import { ApiError } from '../../core/api.service';
import { Recurrence } from '../data/bpm-models';
import { BpmActBudgetType } from './act-budget-type';
import { localToday, shiftDate } from '../../calendar/calendar-dates';

const line = (id: string, label: string, firstDate: string, endDate: string | null = null): Recurrence => ({
  id, budgetId: 'bud_vie', budgetName: 'Projet de vie', direction: 'charge', directionLabel: 'Charge', label,
  amountCents: 80000, amount: 800, cadence: 'monthly', cadenceLabel: 'Mensuelle', firstDate, endDate, note: null, taskId: null,
  costCenterRef: 'std:logement', costCenterLabel: 'Logement', settlementIds: [], revision: 4, monthlyAverageCents: 80000,
});
const context = {
  user: { id: 'usr_test', label: 'Test', userType: 'individual' }, scope: 'principal', scopeLabel: 'Budget du projet de vie',
  budgets: [{ id: 'bud_vie', role: 'life' }],
  period: { key: '2026-11', start: '2026-11-01', end: '2026-11-30', label: 'Novembre 2026', status: 'current', endExclusive: '2026-12-01' },
  calculationDate: '2026-11-22', revision: 1, unit: 'centimes (EUR)',
};

// Chaque ligne du budget récurrent se supprime par le bouton à sa droite, tout de suite et cycle en cours compris :
// elle ne compte plus sur l'accueil. Sans règlement, elle est retirée entièrement ; ce qui a été réglé ce cycle est
// annulé aussi (case cochée par défaut) ; un règlement gardé termine la ligne au lieu de la retirer.
describe('budget récurrent · suppression d’une ligne', () => {
  let lines: Recurrence[];
  let bpm: { budgetType: ReturnType<typeof vi.fn>; costCenters: ReturnType<typeof vi.fn>; updateRecurrence: ReturnType<typeof vi.fn>; cancelRecurrence: ReturnType<typeof vi.fn>; cancelRealization: ReturnType<typeof vi.fn> };
  /** Règlements restants par ligne : le serveur refuse alors de retirer la ligne entièrement. */
  let settledLeft: Record<string, number>;

  async function create() {
    const fixture = TestBed.createComponent(BpmActBudgetType);
    // Deux tours : l'écriture relance la lecture, puis la lecture redessine les lignes.
    const settle = async () => { for (let i = 0; i < 2; i++) { fixture.detectChanges(); await fixture.whenStable(); } fixture.detectChanges(); };
    await settle();
    const dom = fixture.nativeElement as HTMLElement;
    const row = (label: string) => [...dom.querySelectorAll<HTMLElement>('.bm-row:not(.bm-row-head)')].find(r => r.querySelector<HTMLInputElement>('input')?.value === label)!;
    const button = (scope: HTMLElement, text: string) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!;
    /** Le budget est figé à l'arrivée : « Modifier » ouvre l'édition. */
    const edit = async () => { button(dom, 'Modifier').click(); await settle(); };
    /** Bouton de suppression, puis confirmation ; plusieurs écritures peuvent s'enchaîner. */
    const remove = async (label: string, before?: () => void) => {
      row(label).querySelector<HTMLButtonElement>('.bm-del')!.click();
      await settle();
      before?.();
      await settle();
      button(row(label), 'Confirmer la suppression').click();
      for (let i = 0; i < 3; i++) await settle();
    };
    return { dom, row, button, settle, edit, remove, fixture };
  }

  beforeEach(() => {
    sessionStorage.clear();
    settledLeft = {};
    lines = [line('rec_loyer', 'Loyer', '2026-01-05'), line('rec_salle', 'Salle de sport', '2027-01-10')];
    bpm = {
      budgetType: vi.fn(async () => ({ context, label: 'Moyennes', lines, averageIncomeCents: 0, averageChargeCents: 160000, averageNetCents: -160000 })),
      costCenters: vi.fn().mockResolvedValue([]),
      updateRecurrence: vi.fn(async (id: string, body: { endDate: string | null }) => {
        lines = lines.map(l => l.id === id ? { ...l, endDate: body.endDate, revision: l.revision + 1 } : l);
        return { recurrence: lines.find(l => l.id === id)!, scope: { appliesTo: '', settledUntouched: 0 } };
      }),
      cancelRecurrence: vi.fn(async (id: string) => {
        if (settledLeft[id]) throw new ApiError(422, { code: 'FORBIDDEN_BY_RULE', action: null, message: 'Des échéances sont déjà réglées', details: { recurrenceId: id, settled: settledLeft[id] } });
        const gone = lines.find(l => l.id === id)!;
        lines = lines.filter(l => l.id !== id);
        return { recurrence: gone };
      }),
      cancelRealization: vi.fn(async (id: string) => {
        lines = lines.map(l => ({ ...l, settledInCycle: (l.settledInCycle ?? []).filter(s => s.operationId !== id) }));
        for (const l of lines) if (l.id === 'rec_sal') settledLeft[l.id] = Math.max(0, (settledLeft[l.id] ?? 0) - 1);
        return { operation: {} };
      }),
    };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: BpmApi, useValue: bpm }] });
  });

  it('une ligne commencée, sans règlement, est retirée entièrement : elle ne compte plus dans le cycle', async () => {
    const { dom, row, edit, remove, button, settle } = await create();
    await edit();
    expect(dom.querySelectorAll('.bm-row:not(.bm-row-head) .bm-row-del .bm-del')).toHaveLength(2);
    expect(row('Loyer').lastElementChild!.previousElementSibling!.classList.contains('bm-row-del')).toBe(true);

    row('Loyer').querySelector<HTMLButtonElement>('.bm-del')!.click();
    await settle();
    expect(row('Loyer').querySelector('.bm-confirm')!.textContent).toContain('cycle en cours');
    expect(bpm.cancelRecurrence).not.toHaveBeenCalled();
    button(row('Loyer'), 'Garder la ligne').click();
    await settle();

    await remove('Loyer');
    expect(bpm.cancelRecurrence).toHaveBeenCalledWith('rec_loyer', 4, 'Supprimée depuis le budget récurrent');
    expect(bpm.updateRecurrence).not.toHaveBeenCalled();
    expect(row('Loyer')).toBeUndefined();
    expect(dom.querySelector('.bm-saved')!.textContent).toContain('ne compte plus dans le cycle en cours');
  });

  it('un règlement d’un cycle précédent : la ligne se termine la veille du cycle en cours', async () => {
    settledLeft['rec_loyer'] = 1;
    const { row, button, settle, edit, remove } = await create();
    await edit();
    await remove('Loyer');
    expect(bpm.updateRecurrence).toHaveBeenCalledWith('rec_loyer', { expectedRevision: 4, endDate: shiftDate(context.period.start, -1) });
    expect(row('Loyer').textContent).toContain('Retirée · dernière échéance');

    button(row('Loyer'), 'Annuler la suppression').click();
    await settle();
    expect(bpm.updateRecurrence).toHaveBeenLastCalledWith('rec_loyer', { expectedRevision: 5, endDate: null });
    expect(row('Loyer').querySelector('.bm-del')).not.toBeNull();
  });

  it('une échéance gardée réglée plus tard : la dernière échéance se pose sur elle', async () => {
    settledLeft['rec_loyer'] = 1;
    const { row, edit, remove } = await create();
    await edit();
    const inner = bpm.updateRecurrence.getMockImplementation()!;
    bpm.updateRecurrence.mockImplementationOnce(async () => { throw new ApiError(422, { code: 'VALIDATION', action: null, message: 'réglée', details: { lastSettled: '2099-01-05' } }); });
    bpm.updateRecurrence.mockImplementationOnce(inner);
    await remove('Loyer');
    expect(bpm.updateRecurrence).toHaveBeenLastCalledWith('rec_loyer', { expectedRevision: 4, endDate: '2099-01-05' });
    expect(row('Loyer').textContent).toContain('Retirée · dernière échéance');
  });

  it('une ligne qui n’a encore eu aucune échéance est retirée entièrement', async () => {
    const { row, dom, edit, remove } = await create();
    await edit();
    await remove('Salle de sport');
    expect(bpm.cancelRecurrence).toHaveBeenCalledWith('rec_salle', 4, 'Supprimée depuis le budget récurrent');
    expect(bpm.updateRecurrence).not.toHaveBeenCalled();
    expect(row('Salle de sport')).toBeUndefined();
    expect(dom.querySelectorAll('.bm-row:not(.bm-row-head)')).toHaveLength(1);
  });

  describe('avec une échéance réglée dans le cycle', () => {
    beforeEach(() => {
      settledLeft = { rec_sal: 1 };
      lines = [{ ...line('rec_sal', 'Salaire', '2026-11-01'), direction: 'income', amountCents: 98000, amount: 980,
        settledInCycle: [{ operationId: 'op_nov', label: 'Salaire', occurrenceDate: '2026-11-01', realizedDate: '2026-11-03', realizedCents: 98000, revision: 2 }] }];
    });

    it('par défaut, le règlement du cycle est annulé aussi, puis la ligne est retirée entièrement', async () => {
      const { row, edit, remove } = await create();
      await edit();
      await remove('Salaire', () => {
        const box = row('Salaire').querySelector<HTMLInputElement>('.bt-settled input')!;
        expect(box.checked).toBe(true);
        expect(row('Salaire').querySelector('.bt-settled')!.textContent).toContain('déjà été reçu ce cycle (980');
      });
      expect(bpm.cancelRealization).toHaveBeenCalledWith('op_nov', 2);
      expect(bpm.cancelRecurrence).toHaveBeenCalledWith('rec_sal', 4, 'Supprimée depuis le budget récurrent');
      expect(bpm.updateRecurrence).not.toHaveBeenCalled();
      expect(row('Salaire')).toBeUndefined();
    });

    it('case décochée : le reçu reste, la ligne se termine sur sa première échéance', async () => {
      const { row, edit, remove, settle } = await create();
      await edit();
      await remove('Salaire', () => {
        const box = row('Salaire').querySelector<HTMLInputElement>('.bt-settled input')!;
        box.checked = false;
        box.dispatchEvent(new Event('change'));
      });
      await settle();
      expect(bpm.cancelRealization).not.toHaveBeenCalled();
      expect(bpm.updateRecurrence).toHaveBeenCalledWith('rec_sal', { expectedRevision: 4, endDate: '2026-11-01' });
    });
  });
});

describe('budget récurrent · lecture figée, « Modifier », enregistrement par ligne ou de tout', () => {
  let lines: Recurrence[];
  let bpm: Record<string, ReturnType<typeof vi.fn>>;

  async function create() {
    const fixture = TestBed.createComponent(BpmActBudgetType);
    const settle = async () => { for (let i = 0; i < 2; i++) { fixture.detectChanges(); await fixture.whenStable(); } fixture.detectChanges(); };
    await settle();
    const dom = fixture.nativeElement as HTMLElement;
    const button = (scope: HTMLElement, text: string) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!;
    const row = (label: string) => [...dom.querySelectorAll<HTMLElement>('.bm-row:not(.bm-row-head)')].find(r => r.querySelector<HTMLInputElement>('input')?.value === label)!;
    const type = async (input: HTMLInputElement, value: string) => { input.value = value; input.dispatchEvent(new Event('input')); await settle(); };
    return { dom, button, row, type, settle };
  }

  beforeEach(() => {
    sessionStorage.clear();
    lines = [line('rec_loyer', 'Loyer', '2026-01-05'), line('rec_net', 'Internet', '2026-01-08')];
    bpm = {
      budgetType: vi.fn(async () => ({ context, label: 'Moyennes', lines, averageIncomeCents: 0, averageChargeCents: 160000, averageNetCents: -160000 })),
      costCenters: vi.fn().mockResolvedValue([{ ref: 'std:divers', label: 'Divers', direction: 'charge' }]),
      updateRecurrence: vi.fn(async (id: string, body: { label?: string; amount?: number }) => {
        lines = lines.map(l => l.id === id ? { ...l, ...(body.label ? { label: body.label } : {}), ...(body.amount ? { amountCents: Math.round(body.amount * 100) } : {}), revision: l.revision + 1 } : l);
        return { recurrence: lines.find(l => l.id === id)!, scope: { appliesTo: '', settledUntouched: 0 } };
      }),
      cancelRecurrence: vi.fn(),
      createEntry: vi.fn(async () => ({})),
    };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: BpmApi, useValue: bpm }] });
  });

  it('à l’arrivée, le budget est figé : un tableau en lecture, sans champ ni bouton de suppression', async () => {
    const { dom, button } = await create();
    expect(dom.querySelectorAll('.bt-table tbody tr')).toHaveLength(2);
    expect(dom.querySelector('.bt-table')!.textContent).toContain('Loyer');
    expect(dom.querySelectorAll('input, select, .bm-del')).toHaveLength(0);
    expect(button(dom, 'Modifier')).toBeTruthy();
  });

  it('« Modifier » ouvre l’édition ; « Enregistrer » sur une ligne n’enregistre que celle-là', async () => {
    const { dom, button, row, type, settle } = await create();
    button(dom, 'Modifier').click();
    await settle();
    expect(dom.querySelector('.bt-table')).toBeNull();
    expect(dom.querySelector('.bt-mode-chip')!.textContent).toContain('Mode modification');

    await type(row('Loyer').querySelector<HTMLInputElement>('input.num')!, '850');
    await type(row('Internet').querySelector<HTMLInputElement>('input.num')!, '35');
    button(row('Loyer'), 'Enregistrer').click();
    await settle();
    expect(bpm['updateRecurrence']).toHaveBeenCalledTimes(1);
    expect(bpm['updateRecurrence']).toHaveBeenCalledWith('rec_loyer', { expectedRevision: 4, amount: 850 });
    expect(dom.querySelector('.bm-saved')!.textContent).toContain('« Loyer » enregistrée');
    // L'autre ligne garde son brouillon, toujours en édition.
    expect(row('Internet').classList.contains('is-dirty')).toBe(true);
    expect(dom.querySelector('.bt-mode-chip')).not.toBeNull();
  });

  it('« Enregistrer tout » enregistre les lignes modifiées et les nouvelles, puis le budget redevient figé', async () => {
    const { dom, button, row, type, settle } = await create();
    button(dom, 'Modifier').click();
    await settle();
    await type(row('Internet').querySelector<HTMLInputElement>('input:not(.num)')!, 'Box internet');
    button(dom, '＋ Dépense récurrente').click();
    await settle();
    const fresh = dom.querySelector<HTMLElement>('.bm-row.is-new')!;
    await type(fresh.querySelector<HTMLInputElement>('input[placeholder="Nouvelle ligne"]')!, 'Assurance');
    await type(fresh.querySelector<HTMLInputElement>('input.num')!, '42');

    button(dom, 'Enregistrer tout').click();
    // Plusieurs écritures s'enchaînent (mise à jour, création, relecture) : on laisse tout se poser.
    for (let i = 0; i < 4; i++) await settle();
    expect(bpm['updateRecurrence']).toHaveBeenCalledWith('rec_net', { expectedRevision: 4, label: 'Box internet' });
    expect(bpm['createEntry']).toHaveBeenCalledWith(expect.objectContaining({ label: 'Assurance', amount: 42, direction: 'charge', costCenterRef: 'std:divers' }));
    expect(dom.querySelector('.bm-saved')!.textContent).toContain('1 ligne(s) mise(s) à jour · 1 ligne(s) ajoutée(s)');
    expect(dom.querySelector('.bt-table')).not.toBeNull();
    expect(dom.querySelectorAll('input')).toHaveLength(0);
  });

  it('« Annuler les modifications » abandonne les brouillons et refige le budget sans rien écrire', async () => {
    const { dom, button, row, type, settle } = await create();
    button(dom, 'Modifier').click();
    await settle();
    await type(row('Loyer').querySelector<HTMLInputElement>('input.num')!, '999');
    button(dom, 'Annuler les modifications').click();
    await settle();
    expect(bpm['updateRecurrence']).not.toHaveBeenCalled();
    expect(dom.querySelector('.bt-table')!.textContent).toContain('800,00');
  });
});

// Une ligne dont l'échéance du cycle est déjà réglée : la page propose de corriger aussi le montant réglé (non par défaut).
describe('budget récurrent · échéance déjà réglée dans le cycle', () => {
  let lines: Recurrence[];
  let bpm: Record<string, ReturnType<typeof vi.fn>>;

  async function create() {
    const fixture = TestBed.createComponent(BpmActBudgetType);
    const settle = async () => { for (let i = 0; i < 2; i++) { fixture.detectChanges(); await fixture.whenStable(); } fixture.detectChanges(); };
    await settle();
    const dom = fixture.nativeElement as HTMLElement;
    const button = (scope: HTMLElement, text: string) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!;
    const row = (label: string) => [...dom.querySelectorAll<HTMLElement>('.bm-row:not(.bm-row-head)')].find(r => r.querySelector<HTMLInputElement>('input')?.value === label)!;
    const type = async (input: HTMLInputElement, value: string) => { input.value = value; input.dispatchEvent(new Event('input')); await settle(); };
    button(dom, 'Modifier').click();
    await settle();
    return { dom, button, row, type, settle };
  }

  beforeEach(() => {
    sessionStorage.clear();
    lines = [{ ...line('rec_sal', 'Salaire', '2026-11-01'), direction: 'income', amountCents: 350000, amount: 3500,
      settledInCycle: [{ operationId: 'op_nov', label: 'Salaire', occurrenceDate: '2026-11-01', realizedDate: '2026-11-03', realizedCents: 350000, revision: 1 }] }];
    bpm = {
      budgetType: vi.fn(async () => ({ context, label: 'Moyennes', lines, averageIncomeCents: 350000, averageChargeCents: 0, averageNetCents: 350000 })),
      costCenters: vi.fn().mockResolvedValue([]),
      updateRecurrence: vi.fn(async (id: string) => ({ recurrence: { ...lines.find(l => l.id === id)!, revision: 5 }, scope: { appliesTo: '', settledUntouched: 0 } })),
      cancelRecurrence: vi.fn(),
      createEntry: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: BpmApi, useValue: bpm }] });
  });

  it('la question n’apparaît qu’au changement du montant ; sans réponse, seules les prochaines échéances changent', async () => {
    const { row, type, button, settle } = await create();
    expect(row('Salaire').querySelector('.bt-settled')).toBeNull();
    await type(row('Salaire').querySelectorAll<HTMLInputElement>('input')[1], '980');
    expect(row('Salaire').querySelector('.bt-settled')!.textContent).toContain('est déjà reçue');
    button(row('Salaire'), 'Enregistrer').click();
    await settle();
    expect(bpm['updateRecurrence']).toHaveBeenCalledWith('rec_sal', { expectedRevision: 4, amount: 980 });
  });

  it('case cochée : la modification corrige aussi le règlement du cycle', async () => {
    const { dom, row, type, button, settle } = await create();
    await type(row('Salaire').querySelectorAll<HTMLInputElement>('input')[1], '980');
    const box = row('Salaire').querySelector<HTMLInputElement>('.bt-settled input[type=checkbox]')!;
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await settle();
    button(row('Salaire'), 'Enregistrer').click();
    await settle();
    expect(bpm['updateRecurrence']).toHaveBeenCalledWith('rec_sal', { expectedRevision: 4, amount: 980, alsoSettled: { from: '2026-11-01', to: '2026-11-30' } });
    expect(dom.querySelector('.bm-saved')!.textContent).toContain('avec le montant reçu ce cycle');
  });
});
