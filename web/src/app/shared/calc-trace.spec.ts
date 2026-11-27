import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FigureEvaluation } from '../core/models';
import { CalcTrace, metricKeyOf, provenance, tokenizeFormula } from './calc-trace';

describe('chemin de calcul', () => {
  it('découpe une formule en références, fonctions, nombres et opérateurs', () => {
    const tokens = tokenizeFormula('max(revenus.cycle - 12,5)', new Map([['revenus.cycle', 'Revenus du cycle']]));
    expect(tokens.filter((t) => t.kind !== 'space').map((t) => [t.kind, t.text])).toEqual([
      ['fn', 'max'], ['op', '('], ['ref', 'revenus.cycle'], ['op', '-'], ['num', '12,5'], ['op', ')'],
    ]);
    expect(tokens.find((t) => t.kind === 'ref')?.title).toBe('Revenus du cycle');
    expect(tokenizeFormula(null as unknown as string)).toEqual([]);
  });

  it('dit d’où vient la formule', () => {
    expect(provenance(null)).toBe('Formule par défaut du code');
    expect(provenance({ key: 'metric.x', revision: 3, origin: 'code', isDefault: true })).toBe('Formule par défaut du code · révision 3');
    expect(provenance({ key: 'metric.x', revision: 4, origin: 'administration', isDefault: false })).toBe('Formule administrée · révision 4');
    expect(provenance({ key: 'metric.x', revision: null, origin: 'administration', isDefault: false, updatedAt: '2026-11-02T10:00:00Z' }))
      .toMatch(/^Formule administrée · modifiée le /);
  });

  it('retrouve la clé de la métrique depuis son paramètre', () => {
    expect(metricKeyOf('metric.solde', 'autre')).toBe('solde');
    expect(metricKeyOf('autre.solde', 'repli')).toBe('repli');
    expect(metricKeyOf(undefined, 'repli')).toBe('repli');
  });

  function figure(over: Partial<FigureEvaluation> = {}): FigureEvaluation {
    return {
      key: 'solde', label: 'Solde', unit: 'EUR', decimals: 2, description: null, module: 'budget', value: 1250, status: 'ok',
      unavailableReason: null, formula: 'revenus - depenses', explanation: '2000 - 750',
      parameter: { key: 'metric.solde', revision: 2, origin: 'administration', isDefault: false },
      period: { key: '2026-11', start: '2026-11-01', end: '2026-11-30', label: 'Novembre 2026', status: 'current' },
      inputs: [
        { name: 'revenus', type: 'variable', label: 'Revenus', value: 2000, status: 'ok', sources: [{ id: 'op_123456789', kind: 'operation', label: 'Salaire', amount: 2000, date: '2026-11-01', status: 'realized' }] },
        {
          name: 'depenses', type: 'metric', label: 'Dépenses', value: 750, status: 'ok', sources: [], formula: 'loyer', explanation: '750',
          parameter: { key: 'metric.depenses', revision: null, origin: 'code', isDefault: true },
          inputs: [{ name: 'loyer', type: 'variable', label: 'Loyer', value: null, status: 'unavailable', note: 'Pas encore réglé', sources: [] }],
        },
      ],
      ...over,
    };
  }

  async function render(f: FigureEvaluation) {
    TestBed.configureTestingModule({ imports: [CalcTrace], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(CalcTrace);
    fixture.componentRef.setInput('figure', f);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('présente la formule, la période, l’arbre des entrées et les objets sources', async () => {
    const root = await render(figure());
    expect(root.querySelector('.ct-explanation')?.textContent).toContain('2000 - 750');
    expect(root.querySelector('.ct-prov-chip')?.classList).toContain('admin');
    expect(root.querySelector('.ct-meta')?.textContent).toContain('Novembre 2026');
    expect(root.querySelector('.ct-meta')?.textContent).toContain('en cours');
    expect(root.querySelector('.tk-ref')?.getAttribute('title')).toBe('Revenus');
    const nodes = root.querySelectorAll('li.ct-node');
    expect(nodes.length).toBe(3);
    expect(root.querySelector('.src-kind')?.textContent).toContain('Opération');
    expect(root.querySelector('td:nth-child(4)')?.textContent).toContain('Réalisée');
    expect(root.querySelector('.ct-sub summary')?.textContent).toContain('Calcul de « Dépenses »');
    expect(root.querySelector('.ct-sub .ct-prov')?.textContent).toContain('Formule par défaut du code');
    expect(root.querySelector('.ct-note')?.textContent).toContain('Pas encore réglé');
    expect(root.querySelector('li.ct-node.is-unknown')).not.toBeNull();
    expect(root.textContent).toContain('Aucun objet source.');
  });

  it('dit pourquoi un chiffre est inconnu, et quand une formule est constante', async () => {
    const root = await render(figure({ value: null, status: 'unavailable', unavailableReason: 'Cycle à configurer', inputs: [], period: null,
      parameter: { key: 'metric.solde', revision: null, origin: 'code', isDefault: true } }));
    expect(root.querySelector('.ct-reason')?.textContent).toContain('Cycle à configurer');
    expect(root.querySelector('.ct-value')?.classList).toContain('unknown');
    expect(root.textContent).toContain('Sans période');
    expect(root.textContent).toContain('aucune donnée (valeur constante)');
    expect(root.querySelector('.ct-prov-chip')?.classList).not.toContain('admin');
  });
});
