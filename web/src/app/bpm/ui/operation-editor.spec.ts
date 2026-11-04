import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BpmBudgetRef } from '../../core/bpm-models';
import { BpmOperationEditor } from './operation-editor';
import { BpmRefresh } from './page-context';

const budgets: BpmBudgetRef[] = [{ id: 'bud_life', name: 'Budget du projet de vie', role: 'life', coreProjectId: 'prj_1', capsCents: {}, revision: 1 }];
const centers = [{ ref: 'std:logement', label: 'Logement', direction: 'charge', directionLabel: 'Charge', standard: true }];

describe('éditeur d’opération partagé', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  async function open() {
    const f = TestBed.createComponent(BpmOperationEditor);
    f.componentRef.setInput('budgets', budgets);
    f.detectChanges();
    http.expectOne('/api/bpm/cost-centers').flush(centers);
    http.expectOne('/api/tasks').flush([]);
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
});
