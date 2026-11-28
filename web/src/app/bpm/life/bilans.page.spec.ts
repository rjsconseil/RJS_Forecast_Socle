import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BpmApi } from '../data/bpm-api.service';
import { apiFixtures } from '../testing/api-fixtures';
import { BpmBilansPage } from './bilans.page';

/** Écran Bilans des cycles, sur les réponses de la vraie API (profil de recette : août et septembre clos). */
describe('écran Bilans', () => {
  let harness: RouterTestingHarness;
  let bpm: Record<string, ReturnType<typeof vi.fn>>;
  const dom = () => harness.routeNativeElement!;
  const texts = (selector: string) => [...dom().querySelectorAll(selector)].map((e) => e.textContent!.replace(/\s+/g, ' ').trim());
  async function settle() {
    for (let i = 0; i < 3; i++) { harness.detectChanges(); await harness.fixture.whenStable(); }
    harness.detectChanges();
  }
  async function open(url = '/bilans', f = apiFixtures()) {
    bpm = {
      lifeManagement: vi.fn().mockResolvedValue(f.lifeManagement),
      bilans: vi.fn().mockResolvedValue(f.bilans),
      bilan: vi.fn().mockResolvedValue(f.bilan),
    };
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'bilans', component: BpmBilansPage }]), { provide: BpmApi, useValue: bpm }] });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, BpmBilansPage);
    await settle();
    return f;
  }

  it('l’historique liste chaque cycle avec son état et son résultat ; le dernier clos s’ouvre par défaut', async () => {
    const f = await open();
    const history = texts('.bl-history li');
    expect(history.length).toBe(f.bilans.bilans.length);
    for (const b of f.bilans.bilans) expect(history.some((t) => t.includes(b.period.label))).toBe(true);
    const lastClosed = f.bilans.bilans.find((b) => b.status === 'closed')!;
    expect(bpm['bilan']).toHaveBeenCalledWith(lastClosed.period.key);
    expect(dom().querySelector('.bl-history a[aria-current="true"]')!.textContent).toContain(lastClosed.period.label);
  });

  it('le bilan ouvert montre l’équation du cycle : entrées reçues − dépenses réglées = résultat', async () => {
    const f = await open();
    const b = f.bilan.bilan;
    expect(dom().querySelector('#bl-detail-title')!.textContent).toContain(b.period.label);
    const equation = texts('.bl-equation > div');
    expect(equation).toHaveLength(3);
    expect(equation[0]).toContain(`${b.flows.receivedCount} entrée(s)`);
    expect(equation[1]).toContain(`${b.flows.paidCount} règlement(s)`);
    expect(b.flows.receivedCents - b.flows.spentCents).toBe(b.flows.resultCents);
    expect(equation[2]).toContain(b.status === 'closed' ? 'Résultat versé au patrimoine' : 'Résultat à ce jour');
  });

  it('le bilan liste les postes en dépassement de leur plafond sur la période, avec le montant', async () => {
    const f = apiFixtures();
    const b = f.bilan.bilan;
    const center = b.centers[0];
    const other = { level: 'Poste', ref: 'std:autre', label: 'Poste sans dépense ici', capCents: 5000, paidCents: 8000, overCents: 3000 };
    f.bilan = { ...f.bilan, bilan: { ...b, caps: { overCount: 2, overCents: 8500, over: [{ level: 'Poste', ref: center.ref, label: center.label, capCents: 10000, paidCents: 15500, overCents: 5500 }, other] } as never } };
    await open('/bilans', f);
    expect(texts('.bl-rows .is-over .bl-over')[0]).toMatch(/^En dépassement de 55,00\s€ · plafond 100,00\s€$/);
    expect(texts('p.bl-over')).toEqual([expect.stringMatching(/^Poste « Poste sans dépense ici » en dépassement de 30,00\s€ · plafond 50,00\s€\.$/)]);
  });

  it('un cycle demandé par l’adresse est celui qui s’ouvre', async () => {
    const f = apiFixtures();
    const asked = f.bilans.bilans.find((b) => b.status === 'closed' && b.period.key !== f.bilan.bilan.period.key) ?? f.bilans.bilans[0];
    await open(`/bilans?cycle=${asked.period.key}`);
    expect(bpm['bilan']).toHaveBeenCalledWith(asked.period.key);
  });
});
