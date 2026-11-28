import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BpmApi } from '../data/bpm-api.service';
import { ClosingJourney } from '../data/bpm-closing.models';
import { apiFixtures } from '../testing/api-fixtures';
import { STEP_LABEL } from './closing-boxes';
import { BpmClosingPage } from './closing.page';

/**
 * Écran Clôture sur la réponse de la vraie API (profil de recette au 20 novembre : octobre en clôture, son loyer, son
 * salaire et la vérification du compte encore ouverts). Ce que la page affiche se déduit de ce que le serveur envoie.
 */
describe('écran Clôture, sur la réponse de l’API', () => {
  let harness: RouterTestingHarness;
  const dom = () => harness.routeNativeElement!;
  const texts = (selector: string, root: ParentNode = dom()) => [...root.querySelectorAll(selector)].map((e) => e.textContent!.replace(/\s+/g, ' ').trim());
  async function settle() {
    for (let i = 0; i < 3; i++) { harness.detectChanges(); await harness.fixture.whenStable(); }
    harness.detectChanges();
  }
  async function open() {
    const j = apiFixtures().closing as unknown as ClosingJourney;
    const bpm = { closingJourney: vi.fn().mockResolvedValue(j), bilan: vi.fn().mockResolvedValue({ bilan: null }), costCenters: vi.fn().mockResolvedValue([]) };
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'cloture', component: BpmClosingPage }]), { provide: BpmApi, useValue: bpm }] });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/cloture', BpmClosingPage);
    await settle();
    return { j, bpm };
  }
  beforeEach(() => sessionStorage.clear());

  it('la réponse de recette est celle d’un cycle en clôture, pas encore clôturable', async () => {
    const { j, bpm } = await open();
    expect([j.phase, j.canClose]).toEqual(['to_close', false]);
    expect(bpm.bilan).toHaveBeenCalledWith(j.period!.key);
    expect(texts('.closing-section-head h2')[0]).toBe('Finaliser les points ouverts');
    expect(texts('.closing-section-head h2')).toContain(`Résultat de ${j.period!.label} et cycle suivant`);
    expect(dom().querySelector<HTMLButtonElement>('.closing-open-close')!.disabled).toBe(true);
  });

  it('« À valider » compte les points ouverts du serveur, et une colonne par étape', async () => {
    const { j } = await open();
    const path = dom().querySelector('.closing-path')!;
    const openPoints = j.points.filter((p) => p.state === 'open');
    expect(texts('.kb-label', path)).toEqual(['Points à valider', 'Points clos', 'Points bloquants']);
    expect(texts('.kb-value', path).slice(0, 2)).toEqual([String(openPoints.length), String(j.counts!.closed)]);
    expect(texts('.kb-box:last-child small', path)).not.toContain('Vérification du compte : à faire');
    expect(texts('.kt-head', path)).toEqual(j.criteria.map((c) => STEP_LABEL[c.key]));
    expect(texts('.kt-cell b', path)).toEqual(j.criteria.map((c) => (c.state === 'none' ? '—' : `${c.done} / ${c.total}`)));
    // En clôture, chaque étape encore à faire est au rouge.
    const tones = [...path.querySelectorAll('.kt-col')].map((c) => c.getAttribute('data-tone'));
    expect(tones).toEqual(j.criteria.map((c) => (c.state === 'none' ? 'neutral' : c.state === 'done' ? 'ok' : 'n4')));
  });

  it('la cohérence reprend les contrôles du serveur ; sans bilan, le résultat est celui du parcours', async () => {
    const { j } = await open();
    const checks = dom().querySelector('.closing-checks')!;
    expect(texts('.kb-value', checks)[0]).toBe(`${j.checks!.ok} / ${j.checks!.total}`);
    expect(texts('.kt-head', checks)).toEqual(j.checks!.items.map((x) => x.label));
    const result = dom().querySelector('.closing-result')!;
    expect(texts('.kb-label', result)).toContain('Résultat à ce jour');
    expect(j.netCents).toBeLessThan(0);
  });
});
