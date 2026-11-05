import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BpmBudgetRef } from '../../core/bpm-models';
import { BpmOperationEditor } from './operation-editor';
import { BpmRefresh } from './page-context';

const budgets: BpmBudgetRef[] = [{ id: 'bud_life', name: 'Budget du projet de vie', role: 'life', coreProjectId: 'prj_1', capsCents: {}, revision: 1 }];
const centers = [
  { ref: 'std:logement', label: 'Logement', direction: 'charge', directionLabel: 'Charge', standard: true },
  { ref: 'std:loisirs', label: 'Loisirs', direction: 'charge', directionLabel: 'Charge', standard: true },
];
const categories = [
  { id: 'cat_assur', label: 'Assurance habitation', costCenterRef: 'std:logement', costCenterLabel: 'Logement', capCents: 3000, archived: false, revision: 1 },
  { id: 'cat_cine', label: 'Cinéma', costCenterRef: 'std:loisirs', costCenterLabel: 'Loisirs', capCents: null, archived: false, revision: 1 },
];

describe('éditeur d’opération partagé', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });

  async function open() {
    const f = TestBed.createComponent(BpmOperationEditor);
    f.componentRef.setInput('budgets', budgets);
    f.detectChanges();
    http.expectOne('/api/bpm/cost-centers').flush(centers);
    http.expectOne('/api/tasks').flush([]);
    // Catégories retirées comprises : une dépense déjà rangée dans une catégorie retirée la garde.
    http.expectOne((r) => r.url === '/api/bpm/categories' && r.params.get('archived') === 'true').flush(categories);
    await new Promise((r) => setTimeout(r));
    await f.whenStable();
    return f;
  }

  it('rejoue la même clé de commande après une erreur, sans perdre le brouillon', async () => {
    const f = await open();
    const ed = f.componentInstance as unknown as { label: { set(v: string): void }; amount: { set(v: string): void }; date: { set(v: string): void }; save(): Promise<void> };
    ed.label.set('Loyer');
    ed.amount.set('800');
    ed.date.set('2026-11-05');
    const first = ed.save();
    const req1 = http.expectOne((r) => r.method === 'POST' && r.url === '/api/bpm/operations');
    expect(req1.request.body).toMatchObject({ label: 'Loyer', amount: 800, costCenterRef: 'std:logement', cadence: 'once', budgetId: 'bud_life' });
    req1.flush({ error: { code: 'NETWORK', message: 'Réponse perdue' } }, { status: 504, statusText: 'Gateway Timeout' });
    await first;
    const key = req1.request.body.requestKey;
    expect(key).toBeTruthy();

    const refresh = TestBed.inject(BpmRefresh);
    const before = refresh.version();
    const second = ed.save();
    const req2 = http.expectOne((r) => r.method === 'POST' && r.url === '/api/bpm/operations');
    expect(req2.request.body.requestKey).toBe(key);
    expect(req2.request.body.label).toBe('Loyer');
    req2.flush({ replayed: true, operation: { label: 'Loyer' } });
    await second;
    expect(refresh.version()).toBe(before + 1);
    http.match(() => true); // aperçus éventuels
  });

  it('refuse un montant invalide sans appel d’écriture', async () => {
    const f = await open();
    const ed = f.componentInstance as unknown as { label: { set(v: string): void }; amount: { set(v: string): void }; save(): Promise<void> };
    ed.label.set('Loyer');
    ed.amount.set('-3');
    await ed.save();
    f.detectChanges();
    http.expectNone((r) => r.method === 'POST' && r.url === '/api/bpm/operations');
    expect((f.nativeElement as HTMLElement).textContent).toContain('Montant positif attendu');
  });

  it('range la dépense dans une catégorie du centre choisi, jamais dans celle d’un autre centre', async () => {
    const f = await open();
    type Ed = { label: { set(v: string): void }; amount: { set(v: string): void }; date: { set(v: string): void }; center: { set(v: string): void }; categoryId: { set(v: string): void }; save(): Promise<void> };
    const ed = f.componentInstance as unknown as Ed;
    f.detectChanges();
    const options = [...(f.nativeElement as HTMLElement).querySelectorAll('select[name="categoryId"] option')].map((o) => o.textContent!.trim());
    expect(options[0]).toBe('Sans catégorie');
    expect(options.some((o) => o.startsWith('Assurance habitation'))).toBe(true);
    expect(options.some((o) => o.startsWith('Cinéma'))).toBe(false);
    ed.label.set('Assurance');
    ed.amount.set('25');
    ed.date.set('2026-11-05');
    ed.categoryId.set('cat_assur');
    let saved = '';
    f.componentInstance.saved.subscribe((m: string) => (saved = m));
    const first = ed.save();
    const req = http.expectOne((r) => r.method === 'POST' && r.url === '/api/bpm/operations');
    expect(req.request.body).toMatchObject({ costCenterRef: 'std:logement', categoryId: 'cat_assur' });
    // Plafond dépassé : signalé dans le message, la dépense est enregistrée.
    req.flush({ replayed: false, operation: { label: 'Assurance' }, capAlerts: [{ level: 'category', ref: 'std:logement', id: 'cat_assur', label: 'Assurance habitation', capCents: 3000, engagedCents: 3500, overCents: 500 }] });
    await first;
    expect(saved).toContain('Attention, plafond dépassé');
    expect(saved).toContain('catégorie « Assurance habitation »');
    http.match(() => true);
  });

  it('écarte une catégorie devenue incohérente quand le centre change', async () => {
    const f = await open();
    const ed = f.componentInstance as unknown as { label: { set(v: string): void }; amount: { set(v: string): void }; date: { set(v: string): void }; center: { set(v: string): void }; categoryId: { set(v: string): void }; save(): Promise<void> };
    ed.label.set('Séance');
    ed.amount.set('12');
    ed.date.set('2026-11-05');
    ed.categoryId.set('cat_assur');
    ed.center.set('std:loisirs');
    const done = ed.save();
    const req = http.expectOne((r) => r.method === 'POST' && r.url === '/api/bpm/operations');
    expect(req.request.body).toMatchObject({ costCenterRef: 'std:loisirs', categoryId: null });
    req.flush({ replayed: false, operation: { label: 'Séance' } });
    await done;
    http.match(() => true);
  });

  it('exige une tâche pour les dépenses d’un projet utilisant les demandes de montant', async () => {
    const f = await open();
    f.componentRef.setInput('taskFundingRequired', true);
    f.detectChanges();
    await f.componentInstance.save();
    f.detectChanges();
    http.expectNone((r) => r.method === 'POST' && r.url === '/api/bpm/operations');
    expect((f.nativeElement as HTMLElement).textContent).toContain('Choisissez la tâche qui porte cette dépense');
    expect((f.nativeElement as HTMLElement).textContent).toContain('Choisir une tâche');
  });
});
