import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BpmBudgetRef } from '../../core/bpm-models';
import { BpmOperationEditor } from './operation-editor';
import { BpmRefresh } from './page-context';

const capPreview = { mutation: false, period: { key: '2026-11', label: 'Novembre 2026' }, before: { center: null, category: null }, after: { center: null, category: null }, alerts: [], note: null };

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

  async function verifyCaps(result: object = capPreview) {
    http.expectOne('/api/bpm/caps/preview').flush(result);
    await new Promise(r => setTimeout(r, 0));
  }

  async function openProjectExpense() {
    const f = await open();
    f.componentRef.setInput('budgets', [{ ...budgets[0], id: 'bud_project', coreProjectId: 'prj_project', role: 'standard' }, ...budgets]);
    const ed = f.componentInstance as any;
    ed.budgetId.set('bud_project');
    ed.tasks.set([
      { id: 'tsk_project', projectId: 'prj_project', title: 'Acheter' },
      { id: 'tsk_other', projectId: 'prj_project', title: 'Livrer' },
    ]);
    ed.taskId.set('tsk_project'); ed.label.set('Achat UI'); ed.amount.set('90');
    ed.date.set('2026-11-06'); ed.realized.set(true); ed.realizedDate.set('2026-11-06');
    f.detectChanges();
    return { f, ed };
  }

  function refuseFunding() {
    http.expectOne('/api/bpm/operations').flush({ error: { code: 'FORBIDDEN_BY_RULE', message: 'Part à accorder', details: { reason: 'task-share', budgetId: 'bud_project', taskId: 'tsk_project', neededCents: 9000, grantOverrunCents: 1000 } } }, { status: 409, statusText: 'Conflict' });
  }

  it('rejoue la même clé de commande après une erreur, sans perdre le brouillon', async () => {
    const f = await open();
    const ed = f.componentInstance as unknown as { label: { set(v: string): void }; amount: { set(v: string): void }; date: { set(v: string): void }; save(): Promise<void> };
    ed.label.set('Loyer');
    ed.amount.set('800');
    ed.date.set('2026-11-05');
    const first = ed.save();
    await verifyCaps();
    const req1 = http.expectOne((r) => r.method === 'POST' && r.url === '/api/bpm/operations');
    expect(req1.request.body).toMatchObject({ label: 'Loyer', amount: 800, costCenterRef: 'std:logement', cadence: 'once', budgetId: 'bud_life' });
    req1.flush({ error: { code: 'NETWORK', message: 'Réponse perdue' } }, { status: 504, statusText: 'Gateway Timeout' });
    await first;
    const key = req1.request.body.requestKey;
    expect(key).toBeTruthy();

    const refresh = TestBed.inject(BpmRefresh);
    const before = refresh.version();
    const second = ed.save();
    await verifyCaps();
    const req2 = http.expectOne((r) => r.method === 'POST' && r.url === '/api/bpm/operations');
    expect(req2.request.body.requestKey).toBe(key);
    expect(req2.request.body.label).toBe('Loyer');
    req2.flush({ replayed: true, operation: { label: 'Loyer' } });
    await second;
    expect(refresh.version()).toBe(before + 1);
    http.match(() => true); // aperçus éventuels
  });

  it('propose de financer et payer ensemble après un refus de part, avec la même clé de commande', async () => {
    const f = await open();
    f.componentRef.setInput('budgets', [{ ...budgets[0], id: 'bud_project', coreProjectId: 'prj_project', role: 'standard' }]);
    const ed = f.componentInstance as any;
    ed.budgetId.set('bud_project');
    ed.tasks.set([{ id: 'tsk_project', projectId: 'prj_project', title: 'Acheter' }]);
    ed.taskId.set('tsk_project'); ed.label.set('Achat UI'); ed.amount.set('90');
    ed.date.set('2026-11-06'); ed.realized.set(true); ed.realizedDate.set('2026-11-06');
    f.detectChanges();
    const first = ed.save();
    await verifyCaps();
    const req1 = http.expectOne('/api/bpm/operations');
    expect(req1.request.body.fund).toBeUndefined();
    req1.flush({ error: { code: 'FORBIDDEN_BY_RULE', message: 'Part à accorder', details: { reason: 'task-share', budgetId: 'bud_project', taskId: 'tsk_project', neededCents: 9000, grantOverrunCents: 1000 } } }, { status: 409, statusText: 'Conflict' });
    await first; f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Financer cette dépense ici');
    expect(f.nativeElement.textContent).toContain('Dépassement à autoriser');
    const second = ed.save(true);
    await verifyCaps();
    const req2 = http.expectOne('/api/bpm/operations');
    expect(req2.request.body).toMatchObject({ fund: true, requestKey: req1.request.body.requestKey, amount: 90, taskId: 'tsk_project', status: 'realized' });
    req2.flush({ operation: { label: 'Achat UI' } });
    await second;
    http.match(() => true); f.destroy();
  });

  it.each([
    ['amount', '900'],
    ['realizedAmount', '900'],
    ['date', '2026-12-06'],
    ['realizedDate', '2026-12-06'],
    ['budgetId', 'bud_life'],
    ['taskId', 'tsk_other'],
    ['center', 'std:loisirs'],
    ['categoryId', 'cat_assur'],
  ])('invalide le financement proposé si le champ %s change', async (field, value) => {
    const { f, ed } = await openProjectExpense();
    const first = ed.save();
    await verifyCaps();
    refuseFunding();
    await first;
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Financer cette dépense ici');

    ed[field].set(value);
    f.detectChanges();
    expect(f.nativeElement.textContent).not.toContain('Financer cette dépense ici');
    await ed.save(true);
    http.expectNone('/api/bpm/operations');
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Enregistrez à nouveau pour vérifier le financement nécessaire');
    http.match(() => true); f.destroy();
  });

  it('n’autorise pas un autre montant si la saisie change pendant l’aperçu de confirmation', async () => {
    const { f, ed } = await openProjectExpense();
    const first = ed.save();
    await verifyCaps();
    refuseFunding();
    await first;

    const confirming = ed.save(true);
    const preview = http.expectOne('/api/bpm/caps/preview');
    expect(preview.request.body.amount).toBe(90);
    ed.amount.set('900');
    preview.flush(capPreview);
    await confirming;
    http.expectNone('/api/bpm/operations');
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('La saisie a changé pendant la vérification');
    expect(f.nativeElement.textContent).not.toContain('Financer cette dépense ici');

    const retry = ed.save();
    await verifyCaps();
    const request = http.expectOne('/api/bpm/operations');
    expect(request.request.body).toMatchObject({ amount: 900, taskId: 'tsk_project' });
    expect(request.request.body.fund).toBeUndefined();
    request.flush({ error: { code: 'OVERRUN_AUTHORIZATION_REQUIRED', message: 'Nouveau dépassement à confirmer', details: { overrunCents: 82000 } } }, { status: 409, statusText: 'Conflict' });
    await retry;
    f.detectChanges();
    expect(ed.fundingIssue()).toEqual({ overrunCents: 82000 });
    http.match(() => true); f.destroy();
  });

  it('n’associe pas un refus tardif à une saisie modifiée pendant l’enregistrement', async () => {
    const { f, ed } = await openProjectExpense();
    const first = ed.save();
    await verifyCaps();
    ed.amount.set('900');
    refuseFunding();
    await first;
    f.detectChanges();
    expect(f.nativeElement.textContent).not.toContain('Financer cette dépense ici');
    await ed.save(true);
    http.expectNone('/api/bpm/operations');
    http.match(() => true); f.destroy();
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
    await verifyCaps();
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
    await verifyCaps();
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
  it('avertit avant écriture et permet de confirmer un dépassement sans le bloquer', async () => {
    const f = await open();
    const ed = f.componentInstance as any;
    ed.label.set('Achat'); ed.amount.set('50'); ed.date.set('2026-11-05');
    f.detectChanges(); // synchronise le brouillon avant la demande de confirmation
    const alert = { level: 'center', ref: 'std:logement', id: null, label: 'Logement', capCents: 3000, engagedCents: 5000, overCents: 2000 };
    const first = ed.save();
    await verifyCaps({ ...capPreview, alerts: [alert] });
    await first;
    http.expectNone('/api/bpm/operations');
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Enregistrer malgré le dépassement');
    expect(f.nativeElement.textContent).toContain('La dépense reste autorisée');
    const second = ed.save();
    await verifyCaps({ ...capPreview, alerts: [alert] });
    http.expectOne('/api/bpm/operations').flush({ operation: { label: 'Achat' }, capAlerts: [alert] });
    await second;
    f.destroy();
  });

  it('redemande confirmation si le montant change après une alerte', async () => {
    const f = await open();
    const ed = f.componentInstance as any;
    ed.label.set('Achat'); ed.amount.set('50'); ed.date.set('2026-11-05');
    f.detectChanges();
    const alerts = [{ level: 'center', ref: 'std:logement', id: null, label: 'Logement', capCents: 3000, engagedCents: 5000, overCents: 2000 }];
    let saving = ed.save();
    await verifyCaps({ ...capPreview, alerts }); await saving;
    ed.amount.set('60');
    f.detectChanges();
    saving = ed.save();
    await verifyCaps({ ...capPreview, alerts }); await saving;
    http.expectNone('/api/bpm/operations');
    expect(ed.capConfirmation()).toBeTruthy();
    f.destroy();
  });

  it('la panne de vérification reste explicite et ne bloque pas définitivement la dépense', async () => {
    const f = await open();
    const ed = f.componentInstance as any;
    ed.label.set('Achat'); ed.amount.set('50'); ed.date.set('2026-11-05');
    f.detectChanges();
    const first = ed.save();
    http.expectOne('/api/bpm/caps/preview').flush({}, { status: 503, statusText: 'Unavailable' });
    await first;
    http.expectNone('/api/bpm/operations');
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Enregistrer sans vérification');
    const second = ed.save();
    http.expectOne('/api/bpm/caps/preview').flush({}, { status: 503, statusText: 'Unavailable' });
    await new Promise(r => setTimeout(r, 0));
    http.expectOne('/api/bpm/operations').flush({ operation: { label: 'Achat' } });
    await second;
    f.destroy();
  });

  it('écarte un aperçu en vol quand la saisie devient incomplète', async () => {
    const f = await open();
    const ed = f.componentInstance as any;
    ed.label.set('Courses'); ed.amount.set('75'); ed.date.set('2026-11-08');
    f.detectChanges();
    await new Promise(resolve => setTimeout(resolve, 400));
    const request = http.expectOne('/api/bpm/operations/preview');
    ed.label.set(''); f.detectChanges();
    request.flush({ before: { netCents: 10000 }, after: { netCents: 2500 } });
    await new Promise(resolve => setTimeout(resolve));
    expect(ed.preview()).toBeNull();
    expect(ed.previewLoading()).toBe(false);
    http.match(() => true); f.destroy();
  });

});
