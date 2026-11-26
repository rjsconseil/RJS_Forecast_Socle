import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BpmApi } from '../data/bpm-api.service';
import { Recurrence } from '../data/bpm-models';
import { BpmActBudgetType } from './act-budget-type';

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

// Chaque ligne du budget récurrent se supprime par le bouton à sa droite ; le changement vaut au prochain cycle.
describe('budget récurrent · suppression d’une ligne', () => {
  let lines: Recurrence[];
  let bpm: { budgetType: ReturnType<typeof vi.fn>; costCenters: ReturnType<typeof vi.fn>; updateRecurrence: ReturnType<typeof vi.fn>; cancelRecurrence: ReturnType<typeof vi.fn> };

  async function create() {
    const fixture = TestBed.createComponent(BpmActBudgetType);
    // Deux tours : l'écriture relance la lecture, puis la lecture redessine les lignes.
    const settle = async () => { for (let i = 0; i < 2; i++) { fixture.detectChanges(); await fixture.whenStable(); } fixture.detectChanges(); };
    await settle();
    const dom = fixture.nativeElement as HTMLElement;
    const row = (label: string) => [...dom.querySelectorAll<HTMLElement>('.bm-row:not(.bm-row-head)')].find(r => r.querySelector<HTMLInputElement>('input')?.value === label)!;
    const button = (scope: HTMLElement, text: string) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!;
    return { dom, row, button, settle };
  }

  beforeEach(() => {
    sessionStorage.clear();
    lines = [line('rec_loyer', 'Loyer', '2026-01-05'), line('rec_salle', 'Salle de sport', '2027-01-10')];
    bpm = {
      budgetType: vi.fn(async () => ({ context, label: 'Moyennes', lines, averageIncomeCents: 0, averageChargeCents: 160000, averageNetCents: -160000 })),
      costCenters: vi.fn().mockResolvedValue([]),
      updateRecurrence: vi.fn(async (id: string, body: { endDate: string | null }) => {
        lines = lines.map(l => l.id === id ? { ...l, endDate: body.endDate, revision: l.revision + 1 } : l);
        return { recurrence: lines.find(l => l.id === id)!, scope: { appliesTo: '', settledUntouched: 0 } };
      }),
      cancelRecurrence: vi.fn(async (id: string) => {
        const gone = lines.find(l => l.id === id)!;
        lines = lines.filter(l => l.id !== id);
        return { recurrence: gone };
      }),
    };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: BpmApi, useValue: bpm }] });
  });

  it('chaque ligne a son bouton de suppression à droite ; la ligne reste jusqu’à la fin du cycle en cours', async () => {
    const { dom, row, button, settle } = await create();
    expect(dom.querySelectorAll('.bm-row:not(.bm-row-head) .bm-row-del .bm-del')).toHaveLength(2);
    expect(row('Loyer').lastElementChild!.previousElementSibling!.classList.contains('bm-row-del')).toBe(true);

    row('Loyer').querySelector<HTMLButtonElement>('.bm-del')!.click();
    await settle();
    expect(row('Loyer').querySelector('.bm-confirm')!.textContent).toContain('pris en compte au prochain cycle budgétaire');
    expect(bpm.updateRecurrence).not.toHaveBeenCalled();

    button(row('Loyer'), 'Confirmer la suppression').click();
    await settle();
    expect(bpm.updateRecurrence).toHaveBeenCalledWith('rec_loyer', { expectedRevision: 4, endDate: '2026-11-30' });
    expect(dom.querySelector('.bm-saved')!.textContent).toContain('pris en compte au prochain cycle budgétaire');
    expect(row('Loyer').textContent).toContain('Retirée au prochain cycle');
    expect(row('Loyer').querySelector('.bm-del')).toBeNull();

    button(row('Loyer'), 'Annuler la suppression').click();
    await settle();
    expect(bpm.updateRecurrence).toHaveBeenLastCalledWith('rec_loyer', { expectedRevision: 5, endDate: null });
    expect(row('Loyer').querySelector('.bm-del')).not.toBeNull();
  });

  it('une ligne qui ne commence qu’après le cycle en cours est retirée tout de suite', async () => {
    const { row, button, settle, dom } = await create();
    row('Salle de sport').querySelector<HTMLButtonElement>('.bm-del')!.click();
    await settle();
    expect(row('Salle de sport').querySelector('.bm-confirm')!.textContent).toContain('dès maintenant');
    button(row('Salle de sport'), 'Confirmer la suppression').click();
    await settle();
    expect(bpm.cancelRecurrence).toHaveBeenCalledWith('rec_salle', 4, 'Supprimée depuis le budget récurrent');
    expect(bpm.updateRecurrence).not.toHaveBeenCalled();
    expect(row('Salle de sport')).toBeUndefined();
    expect(dom.querySelectorAll('.bm-row:not(.bm-row-head)')).toHaveLength(1);
  });
});
