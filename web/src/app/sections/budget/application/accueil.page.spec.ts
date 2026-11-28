import { TestBed } from '@angular/core/testing';
import { Api } from '../../../platform/grand-noyau';
import { BudgetAccueilPage } from './accueil.page';

describe('budget · accueil de l’application autonome (squelette)', () => {
  it('montre la vision, l’entrée lue par le grand noyau et une sortie encore à définir', async () => {
    const api = {
      patrimoine: vi.fn().mockResolvedValue({ patrimoine: { openingStockCents: 1000000, openingDate: '2026-11-01', objectiveCents: null, coreProjectId: 'prj_vie' }, capitalizations: [] }),
    };
    TestBed.configureTestingModule({ providers: [{ provide: Api, useValue: api }] });
    const fixture = TestBed.createComponent(BudgetAccueilPage);
    for (let i = 0; i < 6; i++) { fixture.detectChanges(); await fixture.whenStable(); await new Promise((r) => setTimeout(r)); }
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Entrée');
    expect(text).toContain('Patrimoine constitué');
    expect(text).toMatch(/10\s000,00/);
    expect(text).toContain('À définir selon les finalités');
  });
});
