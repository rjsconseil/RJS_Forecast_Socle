import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { amountSemantics, BpmAmount, BpmAmountFlow, BpmAmountTone } from './amount';

describe('présentation sémantique des montants BPM', () => {
  it('distingue le signe du bilan et le sens des flux, y compris un remboursement', () => {
    expect(amountSemantics(1200)).toEqual({ tone: 'success', direction: null, arrow: null });
    expect(amountSemantics(-1200)).toEqual({ tone: 'danger', direction: null, arrow: null });
    expect(amountSemantics(1200, 'income')).toEqual({ tone: 'success', direction: 'income', arrow: '↑' });
    expect(amountSemantics(1200, 'charge')).toEqual({ tone: 'danger', direction: 'expense', arrow: '↓' });
    expect(amountSemantics(-1200, 'expense')).toEqual({ tone: 'success', direction: 'income', arrow: '↑' });
    expect(amountSemantics(-1200, 'income')).toEqual({ tone: 'danger', direction: 'expense', arrow: '↓' });
  });

  it('garde le zéro et les données inconnues en information, les réservations et risques explicites à part', () => {
    for (const value of [0, null, undefined, NaN, Infinity]) {
      expect(amountSemantics(value, 'charge')).toEqual({ tone: 'info', direction: null, arrow: null });
    }
    expect(amountSemantics(1200, null, 'info').tone).toBe('info');
    expect(amountSemantics(1200, null, 'danger').tone).toBe('danger');
    expect(amountSemantics(1200, 'income', 'warning')).toEqual({ tone: 'warning', direction: 'income', arrow: '↑' });
  });

  it('actualise la présentation sans altérer le texte ni ajouter de mouvement à un stock', () => {
    @Component({ imports: [BpmAmount], template: '<strong [bpmAmount]="value()" [bpmFlow]="flow()" [bpmTone]="status()">120,00 €</strong>' })
    class Example {
      value = signal<number | null>(12000);
      flow = signal<BpmAmountFlow | null>('income');
      status = signal<BpmAmountTone | null>(null);
    }
    const fixture = TestBed.createComponent(Example);
    fixture.detectChanges();
    const amount = fixture.nativeElement.querySelector('strong') as HTMLElement;
    expect(amount.dataset['bpmValueTone']).toBe('success');
    expect(amount.dataset['bpmArrow']).toBe('↑');
    fixture.componentInstance.flow.set('charge'); fixture.detectChanges();
    expect(amount.dataset['bpmValueTone']).toBe('danger');
    expect(amount.dataset['bpmArrow']).toBe('↓');
    fixture.componentInstance.flow.set(null); fixture.detectChanges();
    expect(amount.hasAttribute('data-bpm-arrow')).toBe(false);
    expect(amount.textContent).toBe('120,00 €');
    fixture.componentInstance.value.set(null); fixture.detectChanges();
    expect(amount.dataset['bpmValueTone']).toBe('info');
  });
});
