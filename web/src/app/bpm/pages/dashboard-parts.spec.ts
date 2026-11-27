import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ApiError } from '../../core/api.service';
import { BpmDashboardCap, BpmDashboardWealth, BpmSetupNeeded, setupProblem, shade } from './dashboard-parts';

const apiError = (code: string, details?: Record<string, unknown>) => ({ message: code, body: { code, message: code, details } }) as unknown as ApiError;

async function render<T>(type: Type<T>, inputs: Record<string, unknown>) {
  TestBed.configureTestingModule({ imports: [type], providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(type);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('éléments du tableau de bord', () => {
  it('reconnaît un contexte à préparer (profil absent ou ensemble principal non prêt)', () => {
    expect(setupProblem(null)).toBeNull();
    expect(setupProblem(apiError('CONTEXT_REQUIRED'))).toBe('user');
    expect(setupProblem(apiError('FORBIDDEN_BY_RULE', { preparation: true }))).toBe('composition');
    expect(setupProblem(apiError('FORBIDDEN_BY_RULE'))).toBeNull();
    expect(setupProblem(apiError('VALIDATION'))).toBeNull();
  });

  it('nuance une même couleur par catégorie, en boucle', () => {
    expect(shade('--s-charge', 0)).toBe('var(--s-charge)');
    expect(shade('--s-charge', 1)).toBe('color-mix(in srgb, var(--s-charge) 78%, var(--c-text-3))');
    expect(shade('--s-charge', 6)).toBe('var(--s-charge)');
  });

  it('invite à se connecter, ou à finir la préparation', async () => {
    let root = await render(BpmSetupNeeded, { kind: 'user' });
    expect(root.querySelector('h2')?.textContent).toContain('pas connecté');
    TestBed.resetTestingModule();
    root = await render(BpmSetupNeeded, { kind: 'composition', message: 'Cycle à fixer.' });
    expect(root.querySelector('h2')?.textContent).toContain('à préparer');
    expect(root.textContent).toContain('Cycle à fixer.');
  });

  it('compare le stock et l’estimation au cap, sans dessiner l’inconnu', async () => {
    let root = await render(BpmDashboardCap, { stock: 50000, estimate: null, target: 100000 });
    expect(root.querySelectorAll('.bar').length).toBe(1);
    const gaps = [...root.querySelectorAll('.gaps dd')].map((d) => d.textContent?.trim());
    expect(gaps[1]).toMatch(/^Manque 500,00/);
    expect(gaps[2]).toBe('Non calculable : valeur inconnue');
    expect(root.querySelector('.plot')?.getAttribute('aria-label')).toContain('estimation après période inconnue');
    TestBed.resetTestingModule();
    root = await render(BpmDashboardCap, { stock: 100000, estimate: 120000, target: 100000 });
    const texts = [...root.querySelectorAll('.gaps dd')].map((d) => d.textContent?.trim());
    expect(texts[1]).toBe('Cap atteint exactement');
    expect(texts[2]).toMatch(/^Dépassement de 200,00/);
    TestBed.resetTestingModule();
    root = await render(BpmDashboardCap, { stock: 1, target: null });
    expect(root.textContent).toContain('Objectif de stock non renseigné');
  });

  it('présente le patrimoine : stock à renseigner, estimation datée, progression vers l’objectif', async () => {
    let root = await render(BpmDashboardWealth, { stock: null, effect: -2500, after: null, objective: 100000, endDate: '2026-11-30' });
    expect(root.querySelector('.wealth-heading span')?.textContent).toBe('Estimation au 30 novembre 2026');
    expect(root.querySelector('.wealth-unavailable')?.textContent).toContain('Le stock initial du Patrimoine n’est pas connu.');
    expect(root.querySelector('.wealth-contribution-value')?.classList).toContain('is-negative');
    expect(root.querySelector('.wealth-total strong')?.textContent?.trim()).toBe('À renseigner');
    expect(root.textContent).toContain('progression non calculable');
    TestBed.resetTestingModule();
    root = await render(BpmDashboardWealth, { stock: 150000, effect: 0, after: 150000, objective: 100000, closed: true, formula: 'stock + effet' });
    expect(root.querySelector('.wealth-heading span')?.textContent).toBe('Chiffres enregistrés à la clôture');
    expect(root.querySelector('.wealth-cap-position')?.textContent).toContain('150 % de l’objectif');
    expect(root.querySelector('.wealth-cap-gap')?.textContent).toContain('Au-delà de l’objectif');
    expect(root.textContent).toContain('stock + effet');
    TestBed.resetTestingModule();
    root = await render(BpmDashboardWealth, { stock: 100000, objective: 100000 });
    expect(root.querySelector('.wealth-cap-gap')?.textContent?.trim()).toBe('Objectif atteint');
    expect(root.querySelector('.wealth-heading span')?.textContent).toBe('Estimation après période');
  });
});
