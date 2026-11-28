import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Api } from '../../core/api.service';
import { BpmApi } from '../data/bpm-api.service';
import { apiFixtures } from '../testing/api-fixtures';
import { BpmExpensesPage } from './expenses';

/** Écran Mouvements (registre de flux), sur les réponses de la vraie API (profil de recette, novembre 2026). */
describe('écran Mouvements', () => {
  let harness: RouterTestingHarness;
  let bpm: Record<string, ReturnType<typeof vi.fn>>;
  const dom = () => harness.routeNativeElement!;
  const texts = (selector: string) => [...dom().querySelectorAll(selector)].map((e) => e.textContent!.replace(/\s+/g, ' ').trim());
  async function settle() {
    for (let i = 0; i < 3; i++) { harness.detectChanges(); await harness.fixture.whenStable(); }
    harness.detectChanges();
  }
  async function open(url = '/mouvements?period=2026-11') {
    const f = apiFixtures();
    bpm = {
      register: vi.fn().mockResolvedValue(f.register),
      costCenters: vi.fn().mockResolvedValue(f.costCenters),
      line: vi.fn().mockResolvedValue(f.line),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'mouvements', component: BpmExpensesPage }]),
        { provide: BpmApi, useValue: bpm },
        { provide: Api, useValue: { tasks: vi.fn().mockResolvedValue(f.tasks) } },
      ],
    });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, BpmExpensesPage);
    await settle();
    return f;
  }

  it('lit le registre de la période demandée et range les lignes par poste, avec leurs montants', async () => {
    const f = await open();
    expect(bpm['register']).toHaveBeenCalledWith(expect.objectContaining({ period: '2026-11', groupBy: 'center' }));
    const groups = texts('.expense-group summary');
    expect(groups.length).toBe(f.register.groups.length);
    for (const g of f.register.groups) expect(groups.some((t) => t.includes(g.label))).toBe(true);
    // Chaque ligne du registre a sa rangée, avec son libellé.
    expect(dom().querySelectorAll('.expense-row').length).toBe(f.register.lines.length);
    for (const l of f.register.lines) expect(texts('.expense-row').some((t) => t.includes(l.label))).toBe(true);
  });

  it('un poste en dépassement de son plafond (dépenses payées) porte une note rouge à côté de son libellé', async () => {
    const f = apiFixtures();
    const g = f.register.groups.find((x) => x.key.startsWith('std:') && x.key !== 'std:salaires')!;
    const caps = { ...f.register.caps!, centers: { ...f.register.caps!.centers, [g.key]: { capCents: 10000, engagedCents: 15500, paidCents: 15500, paidOverCents: 5500, marginCents: -5500, usedPct: 155, over: true, near: false, level: 'over' as const } } };
    await open();
    bpm['register'].mockResolvedValue({ ...f.register, caps });
    // Relecture avec le plafond dépassé : la note suit le libellé du poste, les autres postes n'en ont pas.
    await harness.navigateByUrl('/mouvements?period=2026-11&q=', BpmExpensesPage);
    await settle();
    const notes = [...dom().querySelectorAll('.expense-center-name h2 .expense-cap-over')];
    expect(notes.length).toBe(1);
    expect(notes[0].textContent!.replace(/\s+/g, ' ').trim()).toMatch(/^en dépassement de 55,00\s€$/);
    expect(notes[0].closest('h2')!.textContent).toContain(g.label);
  });

  it('les filtres passent par l’adresse et relisent le registre : sens, recherche, regroupement', async () => {
    await open();
    const buttonOf = (label: string) => [...dom().querySelectorAll<HTMLButtonElement>('.segmented button')].find((b) => b.textContent!.trim() === label)!;
    buttonOf('Entrées').click();
    await settle();
    expect(bpm['register']).toHaveBeenLastCalledWith(expect.objectContaining({ direction: 'income' }));
    const search = dom().querySelector<HTMLInputElement>('input[name="expense-search"]')!;
    search.value = 'Loyer';
    search.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 400));
    await settle();
    expect(bpm['register']).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Loyer' }));
  });

  it('une ligne ouverte par l’adresse affiche sa fiche, lue par la même route que le serveur', async () => {
    const f = await apiFixtures();
    const id = f.line.line.id;
    const key = id.includes('@') ? 'occurrence' : 'operation';
    await open(`/mouvements?period=2026-11&${key}=${encodeURIComponent(id)}`);
    expect(bpm['line']).toHaveBeenCalledWith(id, '2026-11');
    expect(dom().querySelector('bpm-line-detail')).not.toBeNull();
    expect(dom().textContent).toContain(f.line.line.label);
  });

  it('un lien « Saisir une entrée d’argent » ouvre la saisie en entrée, même sur une page filtrée en dépenses', async () => {
    await open('/mouvements?period=2026-11&direction=charge&entry=new&entryDirection=income');
    const income = dom().querySelector<HTMLInputElement>('bpm-operation-editor input[name=direction][value=income]');
    expect(income?.checked).toBe(true);
  });
});
