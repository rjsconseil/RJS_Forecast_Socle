import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { BpmApi } from '../data/bpm-api.service';
import { BpmTaskCard, ProjectBudget } from '../data/bpm-projects.models';
import { BpmBudgetMeterComponent } from './project-parts';
import { BpmEnvelopeDialog, BpmTaskShareDialog } from './funding-dialogs';

const budget = (over: Partial<ProjectBudget> = {}) => ({
  budgetId: 'b1', name: 'Voyage', regime: true, fundingSource: 'cycle', fundingSourceLocked: false, revision: 3,
  allocationCents: 65000, ceilingCents: 65000, sharesCents: 0, availableCents: 65000, paidCents: 0, approvedOverrunCents: 0,
  engagedCents: 0, remainingCents: 65000, state: 'ok', abandoned: null, ...over,
}) as unknown as ProjectBudget;
const task = (shareCents: number | null) => ({ task: { id: 't1', title: 'Visa' }, budget: shareCents === null ? null : { shareCents } }) as unknown as BpmTaskCard;

function mount<T>(type: Type<T>, inputs: Record<string, unknown>, api: Partial<BpmApi> = {}) {
  TestBed.configureTestingModule({ providers: [{ provide: BpmApi, useValue: api }] });
  const f = TestBed.createComponent(type);
  for (const [k, v] of Object.entries(inputs)) f.componentRef.setInput(k, v);
  f.detectChanges();
  return f;
}

describe('financement depuis le chiffre', () => {
  it('un projet sans enveloppe affiche « À attribuer », cliquable', () => {
    const f = mount(BpmBudgetMeterComponent, { budget: budget({ regime: false, allocationCents: null, ceilingCents: null }), editable: true });
    const opened = vi.fn();
    f.componentInstance.envelope.subscribe(opened);
    const cta = f.nativeElement.querySelector('.bpm-budget-cta') as HTMLButtonElement;
    expect(cta.textContent).toContain('À attribuer');
    cta.click();
    expect(opened).toHaveBeenCalled();
  });

  it('le montant d’une enveloppe existante est un lien qui ouvre la modification', () => {
    const f = mount(BpmBudgetMeterComponent, { budget: budget(), editable: true });
    const opened = vi.fn();
    f.componentInstance.envelope.subscribe(opened);
    (f.nativeElement.querySelector('.bpm-budget-amount-link') as HTMLButtonElement).click();
    expect(opened).toHaveBeenCalled();
  });

  it('la fenêtre d’enveloppe enregistre le montant et la source choisie', async () => {
    const allocate = vi.fn(async () => ({}));
    const f = mount(BpmEnvelopeDialog, { budget: budget({ regime: false, allocationCents: null }) }, { allocate } as never);
    const c = f.componentInstance as unknown as { amount: { set(v: string): void }; source: { set(v: string): void }; save(): Promise<void> };
    c.amount.set('800');
    c.source.set('patrimoine');
    await c.save();
    expect(allocate).toHaveBeenCalledWith('b1', 800, 3, 'patrimoine');
  });

  it('une part au-delà de ce qui reste à répartir annonce le dépassement et l’autorise à l’enregistrement', async () => {
    const setTaskShare = vi.fn(async () => ({}));
    const f = mount(BpmTaskShareDialog, { budget: budget({ sharesCents: 50000, availableCents: 15000 }), task: task(null) }, { setTaskShare } as never);
    const c = f.componentInstance as unknown as { amount: { set(v: string): void }; overrunCents(): number; save(): Promise<void> };
    c.amount.set('200');
    f.detectChanges();
    expect(c.overrunCents()).toBe(5000);
    expect(f.nativeElement.querySelector('.fd-warning')?.textContent).toContain('50,00');
    await c.save();
    expect(setTaskShare).toHaveBeenCalledWith('b1', 't1', 200, 3, { authorizeOverrun: true });
  });

  it('une part dans l’enveloppe s’enregistre sans dépassement', async () => {
    const setTaskShare = vi.fn(async () => ({}));
    const f = mount(BpmTaskShareDialog, { budget: budget(), task: task(null) }, { setTaskShare } as never);
    const c = f.componentInstance as unknown as { amount: { set(v: string): void }; overrunCents(): number; save(): Promise<void> };
    c.amount.set('100');
    expect(c.overrunCents()).toBe(0);
    await c.save();
    expect(setTaskShare).toHaveBeenCalledWith('b1', 't1', 100, 3, {});
  });
});
