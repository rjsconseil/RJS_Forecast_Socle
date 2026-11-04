import { TestBed } from '@angular/core/testing';
import { axisCents, BpmSeriesChart, BpmShareChart } from './charts';

describe('graphes BPM', () => {
  it('formate les axes en euros compacts', () => {
    expect(axisCents(120000)).toBe('1,2 k€');
    expect(axisCents(-50000)).toBe('-500 €');
  });

  it('répartition : n’affiche ni secteur négatif ni inconnu, et lit sur 100 €', () => {
    const f = TestBed.createComponent(BpmShareChart);
    f.componentRef.setInput('title', 'Où va l’argent');
    f.componentRef.setInput('base', 100000);
    f.componentRef.setInput('items', [
      { key: 'a', label: 'Logement', cents: 40000, color: 'red' },
      { key: 'b', label: 'Remboursement', cents: -5000, color: 'blue' },
      { key: 'c', label: 'Inconnu', cents: null, color: 'green' },
    ]);
    f.detectChanges();
    const text = (f.nativeElement as HTMLElement).textContent!;
    expect(text).toContain('40,00 €');
    expect(text).toContain('Non représentés');
    expect(text).toContain('Remboursement');
    expect((f.nativeElement as HTMLElement).querySelectorAll('.seg').length).toBe(1);
  });

  it('répartition : une base nulle ne produit aucune part', () => {
    const f = TestBed.createComponent(BpmShareChart);
    f.componentRef.setInput('title', 'Répartition');
    f.componentRef.setInput('base', 0);
    f.componentRef.setInput('items', [{ key: 'a', label: 'A', cents: 100, color: 'red' }]);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).toContain('Base nulle');
  });

  it('séries : une valeur inconnue reste « Inconnu » dans le tableau et interrompt la courbe', () => {
    const f = TestBed.createComponent(BpmSeriesChart);
    f.componentRef.setInput('title', 'Historique');
    f.componentRef.setInput('categories', ['sept.', 'oct.', 'nov.']);
    f.componentRef.setInput('series', [{ key: 'net', label: 'Net', color: 'black', kind: 'line', values: [1000, null, 3000] }]);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('tbody')!.textContent).toContain('Inconnu');
    const d = el.querySelector('path')!.getAttribute('d')!;
    expect(d.match(/M/g)!.length).toBe(2); // deux segments, aucun point à zéro
    expect(el.querySelectorAll('.hit[tabindex="0"]').length).toBe(3);
  });
});
