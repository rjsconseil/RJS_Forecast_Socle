import { TestBed } from '@angular/core/testing';
import { BpmDial } from './dial';

describe('potentiomètre BPM', () => {
  function setup() {
    const fixture = TestBed.createComponent(BpmDial);
    fixture.componentRef.setInput('label', 'Temps prévu');
    fixture.componentRef.setInput('value', 4);
    fixture.componentRef.setInput('max', 12);
    fixture.componentRef.setInput('step', .25);
    fixture.componentRef.setInput('unit', 'h');
    const values: number[] = [];
    fixture.componentInstance.valueChange.subscribe(value => { values.push(value); fixture.componentRef.setInput('value', value); });
    fixture.detectChanges();
    return { fixture, values, slider: fixture.nativeElement.querySelector('[role=slider]') as HTMLElement };
  }
  it('règle au clavier par pas et respecte les bornes', () => {
    const { fixture, values, slider } = setup();
    for (const key of ['ArrowUp', 'PageUp', 'End', 'ArrowUp', 'Home', 'ArrowDown']) {
      slider.dispatchEvent(new KeyboardEvent('keydown', { key })); fixture.detectChanges();
    }
    expect(values).toEqual([4.25, 6.75, 12, 12, 0, 0]);
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
  });
  it('arrondit la saisie, ignore une valeur vide et bloque les interactions désactivées', () => {
    const { fixture, values, slider } = setup();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = '5.12'; input.dispatchEvent(new Event('change')); fixture.detectChanges();
    input.value = ''; input.dispatchEvent(new Event('change'));
    expect(input.value).toBe('5');
    fixture.componentRef.setInput('disabled', true); fixture.detectChanges();
    slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(values).toEqual([5]);
    expect(slider.getAttribute('aria-disabled')).toBe('true');
  });
  it('prépare une valeur par glissement sans commande métier', () => {
    const { fixture, values, slider } = setup();
    slider.setPointerCapture = () => {};
    const event = (name: string, y: number) => {
      const e = new Event(name); Object.defineProperties(e, { button: { value: 0 }, pointerId: { value: 1 }, clientY: { value: y } }); slider.dispatchEvent(e);
    };
    event('pointerdown', 200); event('pointermove', 130); event('pointerup', 130); event('pointermove', 0); fixture.detectChanges();
    expect(values).toEqual([10]);
  });
});
