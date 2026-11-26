import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BpmApi } from '../data/bpm-api.service';
import { CenterCapRow, SpendingCaps } from '../data/bpm-caps.models';
import { BpmCapsPage } from './caps';
import { capLevel } from '../ui/caps';

/** Seuils rendus par Budget (`levels` des lectures). */
const LEVELS = { mid: 50, high: 75, near: 90 };

/** Un poste de dépenses mesuré sur le cycle, comme le rend le serveur (engagé = payé + à payer). */
function center(ref: string, label: string, capCents: number | null, paidCents: number, toPayCents = 0): CenterCapRow {
  const engagedCents = paidCents + toPayCents;
  return {
    ref, label, standard: true, paidCents, toPayCents, engagedCents, capCents,
    marginCents: capCents === null ? null : capCents - engagedCents,
    usedPct: capCents ? Math.round((engagedCents / capCents) * 1000) / 10 : null,
    over: capCents !== null && engagedCents > capCents,
    near: capCents !== null && engagedCents <= capCents && engagedCents >= capCents * 0.9,
    level: capLevel({ capCents, engagedCents }, LEVELS),
    lineCount: engagedCents ? 2 : 0,
  };
}

const reading = (centers: CenterCapRow[]): SpendingCaps => ({
  context: {
    user: { id: 'usr_test', label: 'Camille', userType: 'individual' },
    scope: 'principal',
    scopeLabel: 'Budget du projet de vie',
    budgets: [],
    period: { key: '2026-11', start: '2026-11-01', end: '2026-11-30', label: 'Novembre 2026', status: 'current', endExclusive: '2026-12-01' } as never,
    calculationDate: '2026-11-22',
    revision: 1,
    unit: 'centimes (EUR)',
  },
  lifeBudget: { budgetId: 'bud_vie', revision: 7, capsCents: { 'std:alimentation': 50000, 'std:logement': 120000, 'std:loisirs': 15000 } },
  centers,
  overCount: centers.filter((c) => c.over).length,
  alerts: [],
  levels: LEVELS,
});

// Plafonds : la liste de tous les postes de dépenses, avec ou sans plafond, et la fenêtre qui fixe un plafond.
describe('page Plafonds', () => {
  let harness: RouterTestingHarness;
  let api: { spendingCaps: ReturnType<typeof vi.fn>; setCaps: ReturnType<typeof vi.fn> };
  const dom = () => harness.routeNativeElement!;
  const rows = () => [...dom().querySelectorAll<HTMLElement>('.caps-row')];
  const rowOf = (label: string) => rows().find((r) => r.querySelector('.caps-name a')?.textContent?.trim() === label)!;
  const dialog = () => dom().querySelector<HTMLElement>('bpm-cap-dialog');
  async function settle() {
    for (let i = 0; i < 2; i++) { harness.detectChanges(); await harness.fixture.whenStable(); }
    harness.detectChanges();
  }
  function type(value: string) {
    const input = dialog()!.querySelector<HTMLInputElement>('input[name="capAmount"]')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    harness.detectChanges();
  }
  /** Déplace le curseur (valeur en centimes) comme le ferait la souris ou le clavier. */
  function slide(name: 'capSlider' | 'overSlider', cents: number) {
    const range = dialog()!.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    range.value = String(cents);
    range.dispatchEvent(new Event('input'));
    harness.detectChanges();
  }
  const amount = () => dialog()!.querySelector<HTMLInputElement>('input[name="capAmount"]')!.value;
  /** Chiffres recalculés de la fenêtre, « libellé montant » séparés par « | ». */
  const result = () => [...dialog()!.querySelectorAll('.cd-result > div')].map((d) => [...d.children].map((x) => x.textContent!.trim()).join(' ')).join(' | ').replace(/\s+/g, ' ');
  const button = (scope: ParentNode, text: string) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!;

  beforeEach(async () => {
    api = {
      spendingCaps: vi.fn().mockResolvedValue(reading([
        center('std:logement', 'Logement', 120000, 90000),
        center('std:alimentation', 'Alimentation', 50000, 21950, 57000),
        center('std:loisirs', 'Loisirs', 15000, 13000),
        center('std:transport', 'Transport', null, 9000, 8000),
        center('std:sante', 'Santé', null, 4500),
        center('std:divers', 'Divers', null, 0),
      ])),
      setCaps: vi.fn().mockResolvedValue({}),
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'plafonds', component: BpmCapsPage }]), { provide: BpmApi, useValue: api }],
    });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/plafonds', BpmCapsPage);
    await settle();
  });

  it('liste tous les postes : avec plafond (dépassements d’abord), puis sans plafond (les plus dépensés d’abord)', () => {
    const groups = [...dom().querySelectorAll<HTMLElement>('.caps-group')];
    expect(groups.map((g) => g.querySelector('.caps-group-title')!.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['Avec plafond 3', 'Sans plafond 3']);
    const names = (g: HTMLElement) => [...g.querySelectorAll('.caps-name a')].map((a) => a.textContent!.trim());
    expect(names(groups[0])).toEqual(['Alimentation', 'Loisirs', 'Logement']);
    expect(names(groups[1])).toEqual(['Transport', 'Santé', 'Divers']);

    // Dépassé : rouge et montant du dépassement ; dans la limite : ce qu'il reste ; sans plafond : le geste pour en fixer un.
    // Couleur selon la part du plafond consommée : 158 % rouge, 87 % jaune, 75 % jaune, sans plafond neutre.
    expect(rowOf('Alimentation').dataset['level']).toBe('over');
    expect(rowOf('Alimentation').querySelector('.caps-chip')!.textContent).toContain('Dépassé de 289,50');
    expect(rowOf('Loisirs').dataset['level']).toBe('high');
    expect(rowOf('Logement').dataset['level']).toBe('high');
    expect(rowOf('Transport').dataset['level']).toBe('none');
    expect([...dom().querySelectorAll<HTMLElement>('.caps-legend li')].map((li) => li.dataset['level'])).toEqual(['low', 'mid', 'high', 'near', 'over', 'none']);
    expect(rowOf('Logement').querySelector('.caps-chip')!.textContent).toContain('Reste 300,00');
    expect(rowOf('Transport').querySelector('.caps-chip')!.textContent).toContain('Sans plafond');
    expect(rowOf('Transport').querySelector('.caps-set')!.textContent).toContain('Fixer un plafond');
    expect(rowOf('Logement').querySelector('.caps-set')).toBeNull();
    expect(rowOf('Divers').querySelector('.caps-name small')!.textContent).toContain('Aucune dépense');

    // Chiffres clés : postes plafonnés, dépassements, total des plafonds.
    const tiles = dom().querySelector('rjs-metric-tiles')!.textContent!.replace(/\s+/g, ' ');
    expect(tiles).toContain('3 sur 6');
    expect(tiles).toContain('Alimentation');
    expect(tiles).toContain('1 850,00');
    // Les catégories sont abandonnées : la page n'en parle plus.
    expect(dom().textContent).not.toMatch(/catégorie/i);
  });

  it('fixe le plafond d’un poste qui n’en a pas : la fenêtre annonce l’effet puis n’écrit que ce poste', async () => {
    rowOf('Transport').querySelector<HTMLButtonElement>('.caps-set')!.click();
    await settle();
    expect(dialog()).not.toBeNull();
    expect(dialog()!.querySelector('select')).toBeNull();
    expect(dialog()!.textContent).toContain('170,00');
    expect(dialog()!.querySelector('.cd-impact')!.textContent).toContain('Sans plafond');
    type('85,50');
    expect(result()).toContain('Dépassement 84,50');
    type('250');
    expect(result()).toContain('Reste à dépenser 80,00');
    expect(button(dialog()!, 'Retirer le plafond')).toBeUndefined();
    button(dialog()!, 'Enregistrer le plafond').click();
    await settle();
    expect(api.setCaps).toHaveBeenCalledExactlyOnceWith({ expectedRevision: 7, caps: { 'std:transport': 250 }, merge: true });
    expect(dialog()).toBeNull();
    expect(api.spendingCaps).toHaveBeenCalledTimes(2);
    expect(dom().textContent).toContain('Plafond du poste « Transport » : 250,00');
  });

  it('modifie ou retire un plafond ; un montant invalide n’écrit rien', async () => {
    button(rowOf('Alimentation'), 'Modifier').click();
    await settle();
    expect(amount()).toBe('500');
    type('-3');
    button(dialog()!, 'Enregistrer le plafond').click();
    await settle();
    expect(api.setCaps).not.toHaveBeenCalled();
    expect(dialog()!.querySelector('.cd-error')!.textContent).toContain('Montant positif attendu');
    button(dialog()!, 'Retirer le plafond').click();
    await settle();
    expect(api.setCaps).toHaveBeenCalledExactlyOnceWith({ expectedRevision: 7, caps: { 'std:alimentation': null }, merge: true });
  });

  /** Place (0 à 1) d'un repère de la jauge : « used » (consommé, au-dessus) ou « cap » (plafond, au-dessous). */
  const mark = (which: 'used' | 'cap') => dialog()!.querySelector<HTMLElement>(`.cd-marks-${which} .cd-mark`)!;
  const at = (which: 'used' | 'cap') => Number(mark(which).dataset['p']);
  const gauge = () => dialog()!.querySelector<HTMLElement>('.cd-gauge')!.dataset['state'];

  it('un seul curseur, sans choix plafond / dépassement : il part du plafond, le dépassement se recalcule à chaque fois', async () => {
    button(rowOf('Loisirs'), 'Modifier').click();
    await settle();
    expect(dialog()!.querySelectorAll('[role="radio"]')).toHaveLength(0);
    expect(dialog()!.querySelectorAll('input[type="range"]')).toHaveLength(1);
    // Sous le plafond : le consommé à gauche, l'espace restant puis la place pour agrandir à droite.
    expect(mark('used').textContent).toContain('Consommé 130,00');
    expect(mark('cap').textContent).toContain('Plafond 150,00');
    expect(at('used')).toBeLessThan(at('cap'));
    expect(at('cap')).toBeLessThan(1);
    expect(gauge()).toBe('under');
    // La couleur suit la part consommée avec le plafond réglé : 87 % jaune, 108 % rouge, 65 % bleu, 43 % vert, 93 % orange.
    const level = () => dialog()!.querySelector<HTMLElement>('.cd-gauge')!.dataset['level'];
    expect(level()).toBe('high');
    slide('capSlider', 12000);
    expect(amount()).toBe('120');
    expect(result()).toContain('Dépassement 10,00');
    expect(level()).toBe('over');
    expect(at('cap')).toBeLessThan(at('used'));
    type('300');
    expect(level()).toBe('low');
    slide('capSlider', 14000);
    expect(level()).toBe('near');
    slide('capSlider', 20000);
    expect(amount()).toBe('200');
    expect(level()).toBe('mid');
    expect(result()).toContain('Consommé 65 %');
    expect(result()).toContain('Reste à dépenser 70,00');
    button(dialog()!, 'Enregistrer le plafond').click();
    await settle();
    expect(api.setCaps).toHaveBeenCalledExactlyOnceWith({ expectedRevision: 7, caps: { 'std:loisirs': 200 }, merge: true });
  });

  it('au-delà du plafond, le repère du plafond est à gauche du consommé ; le curseur l’agrandit ou le diminue', async () => {
    button(rowOf('Alimentation'), 'Modifier').click();
    await settle();
    expect(gauge()).toBe('over');
    expect(at('cap')).toBeLessThan(at('used'));
    expect(dialog()!.querySelector<HTMLInputElement>('input[name="capSlider"]')!.value).toBe('50000');
    expect(result()).toContain('Dépassement 289,50');
    // Agrandir le plafond au-delà du consommé : plus de dépassement, il reste 10,50 €.
    slide('capSlider', 80000);
    expect(amount()).toBe('800');
    expect(result()).toContain('Reste à dépenser 10,50');
    expect(at('used')).toBeLessThan(at('cap'));
    // Le rediminuer : le dépassement revient, recalculé.
    slide('capSlider', 78000);
    expect(result()).toContain('Dépassement 9,50');
    button(dialog()!, 'Enregistrer le plafond').click();
    await settle();
    expect(api.setCaps).toHaveBeenCalledExactlyOnceWith({ expectedRevision: 7, caps: { 'std:alimentation': 780 }, merge: true });
  });

  it('au niveau du plafond, consommé et plafond sont indiqués au même endroit', async () => {
    button(rowOf('Logement'), 'Modifier').click();
    await settle();
    type('900');
    expect(gauge()).toBe('full');
    expect(at('cap')).toBe(at('used'));
    expect(mark('cap').style.left).toBe(mark('used').style.left);
    expect(result()).toContain('Reste à dépenser 0,00');
  });

  it('sans plafond, le curseur part du consommé arrondi et ne fixe rien tant qu’on ne le bouge pas', async () => {
    rowOf('Divers').querySelector<HTMLButtonElement>('.caps-set')!.click();
    await settle();
    expect(amount()).toBe('');
    expect(gauge()).toBe('none');
    expect(mark('cap').textContent).toContain('Glissez pour fixer le plafond');
    slide('capSlider', 5000);
    expect(amount()).toBe('50');
    expect(mark('cap').textContent).toContain('Plafond 50,00');
    expect(result()).toContain('Reste à dépenser 50,00');
  });

  it('la commande principale ouvre la fenêtre avec le choix du poste, les postes sans plafond d’abord', async () => {
    const primary = button(dom(), 'Fixer un plafond');
    expect(primary).toBeDefined();
    primary.click();
    await settle();
    const options = [...dialog()!.querySelectorAll('select option')].map((o) => o.textContent!.trim());
    expect(options.slice(0, 3)).toEqual(['Transport', 'Santé', 'Divers']);
    expect(options[3]).toContain('Alimentation · plafond');
    expect(dialog()!.querySelector<HTMLSelectElement>('select')!.value).toBe('std:transport');
  });

});
