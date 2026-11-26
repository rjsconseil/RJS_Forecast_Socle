import { bankTotals } from './bank-reconciliation.component';
describe('rapprochement multi-comptes',()=>{
  it('additionne les comptes en centimes, y compris un découvert et des virements internes',()=>{
    expect(bankTotals([{id:1,name:'A',opening:'1000,10',closing:'700,10'},{id:2,name:'B',opening:'-50',closing:'250'}])).toEqual({opening:95010,closing:95010,variation:0});
  });
  it('ne transforme pas un solde absent ou invalide en zéro',()=>{
    for(const value of ['', 'invalide','1.001']) expect(bankTotals([{id:1,name:'A',opening:'0',closing:value}])).toBeNull();
    expect(bankTotals([])).toBeNull();
  });
  it('distingue un vrai solde nul',()=>expect(bankTotals([{id:1,name:'A',opening:'10',closing:'0'}])?.variation).toBe(-1000));
});

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BankReconciliationComponent } from './bank-reconciliation.component';
describe('outil de comparaison bancaire',()=>{
  it('recalcule le solde théorique et l’écart depuis les champs sans création d’opération',async()=>{
    TestBed.configureTestingModule({providers:[provideRouter([])]});
    const fixture=TestBed.createComponent(BankReconciliationComponent);
    fixture.componentRef.setInput('net',15000);
    fixture.componentRef.setInput('from','2026-11-01');
    fixture.componentRef.setInput('to','2026-11-14');
    fixture.detectChanges();await fixture.whenStable();
    const inputs=fixture.nativeElement.querySelectorAll('.bank-accounts input') as NodeListOf<HTMLInputElement>;
    for(const [i,value] of [[1,'1000'],[2,'1100']] as const){inputs[i].value=value;inputs[i].dispatchEvent(new Event('input'));}
    fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
    const text=fixture.nativeElement.textContent;
    expect(text).toContain('−50,00');
    expect(text).toContain('1 150,00');
    expect(text).toContain('Vérifiez le périmètre');
    expect(fixture.nativeElement.querySelector('a[href*="from=2026-11-01"]')).not.toBeNull();
  });
});
