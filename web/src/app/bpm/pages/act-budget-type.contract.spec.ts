import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BpmApi } from '../data/bpm-api.service';
import { apiFixtures } from '../testing/api-fixtures';
import { BpmActBudgetType } from './act-budget-type';

/**
 * Budget récurrent sur la réponse de la vraie API (profil de recette : loyer 900 € et salaire 2 600 € mensuels).
 * Complète act-budget-type.spec, qui teste les gestes (modifier, enregistrer, supprimer).
 */
describe('budget récurrent · contrat de l’API', () => {
  async function open() {
    const f = apiFixtures();
    const bpm = { budgetType: vi.fn(async () => f.budgetType), costCenters: vi.fn(async () => f.costCenters) };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: BpmApi, useValue: bpm }] });
    const fixture = TestBed.createComponent(BpmActBudgetType);
    for (let i = 0; i < 3; i++) { fixture.detectChanges(); await fixture.whenStable(); }
    fixture.detectChanges();
    return { dom: fixture.nativeElement as HTMLElement, f, bpm };
  }

  it('montre chaque définition récurrente en lecture figée, avec son rythme, son montant et sa moyenne mensuelle', async () => {
    const { dom, f } = await open();
    // Figé à l'arrivée : un tableau par sens, aucun champ à saisir tant que « Modifier » n'est pas pressé.
    expect(dom.querySelector('.bt-read')).not.toBeNull();
    expect(dom.querySelectorAll('.bt-read input, .bt-read select')).toHaveLength(0);
    expect([...dom.querySelectorAll('button')].some((b) => b.textContent!.trim() === 'Modifier')).toBe(true);
    const rows = [...dom.querySelectorAll<HTMLElement>('.bt-table tbody tr')].map((r) => r.textContent!.replace(/\s+/g, ' '));
    expect(rows).toHaveLength(f.budgetType.lines.length);
    for (const l of f.budgetType.lines) expect(rows.some((t) => t.includes(l.label) && t.includes('Mensuelle'))).toBe(true);
    expect(rows.find((t) => t.includes('Salaire'))).toMatch(/2\s?600,00\s?€/);
    expect(rows.find((t) => t.includes('Loyer'))).toMatch(/900,00\s?€/);
  });
});
