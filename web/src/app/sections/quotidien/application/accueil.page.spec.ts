import { TestBed } from '@angular/core/testing';
import { Api } from '../../../platform/grand-noyau';
import { QuotidienAccueilPage } from './accueil.page';

describe('quotidien · accueil de l’application autonome (squelette)', () => {
  it('montre la vision, l’entrée lue par le grand noyau et une sortie encore à définir', async () => {
    const api = {
      budgets: vi.fn().mockResolvedValue([{ id: 'bud_vie', role: 'life' }]),
      budget: vi.fn().mockResolvedValue({ operations: [{ id: 'a', label: 'Salaire', direction: 'income', amountCents: 200000, date: '2026-11-01', status: 'realized', realizedAmountCents: 200000, realizedDate: '2026-11-01', costCenterRef: 'std:salaires', costCenterLabel: 'Salaires' }] }),
      metricPeriods: vi.fn().mockResolvedValue({ periods: [{ key: '2026-11', label: 'Novembre 2026', start: '2026-11-01', end: '2026-11-30', status: 'current' }] }),
    };
    TestBed.configureTestingModule({ providers: [{ provide: Api, useValue: api }] });
    const fixture = TestBed.createComponent(QuotidienAccueilPage);
    for (let i = 0; i < 6; i++) { fixture.detectChanges(); await fixture.whenStable(); await new Promise((r) => setTimeout(r)); }
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Entrée');
    expect(text).toContain('Reçu');
    expect(text).toMatch(/2\s000,00/);
    expect(text).toContain('À définir selon les finalités');
  });
});
