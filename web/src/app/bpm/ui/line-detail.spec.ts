import { TestBed } from '@angular/core/testing';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BpmApi } from '../../core/bpm-api.service';
import { ApiError } from '../../core/api.service';
import { LineDetail } from '../../core/bpm-models';
import { BpmLineDetail } from './line-detail';

@Component({
  imports: [BpmLineDetail],
  template: `@if (opened()) {
    <bpm-line-detail lineId="op_test" (closed)="close()" />
  }`,
})
class RegisterHost {
  opened = signal(true);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  close() {
    this.opened.set(false);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { operation: null },
      queryParamsHandling: 'merge',
    });
  }
}
@Component({ template: 'Projet destination' })
class ProjectDestination {}

describe('règlement depuis une fiche d’échéance', () => {
  it('n’autorise pas un nouveau montant avec l’offre de financement de la saisie précédente', async () => {
    const detail = {
      line: {
        id: 'op_test',
        operationId: 'op_test',
        kind: 'operation',
        revision: 2,
        direction: 'charge',
        budgetId: 'bud_test',
        label: 'Achat',
        plannedDate: '2026-11-05',
        plannedCents: 10000,
        costCenterRef: 'std:loisirs',
        categoryId: null,
      },
    } as LineDetail;
    const refusal = (neededCents: number) =>
      new ApiError(409, {
        code: 'FORBIDDEN_BY_RULE',
        action: null,
        message: 'Part à accorder',
        details: {
          reason: 'task-share',
          budgetId: 'bud_test',
          taskId: 'tsk_test',
          neededCents,
          grantOverrunCents: neededCents - 5000,
        },
      });
    const bpm = {
      line: vi.fn().mockResolvedValue(detail),
      previewCaps: vi.fn().mockResolvedValue({ alerts: [] }),
      realizeOperation: vi
        .fn()
        .mockRejectedValueOnce(refusal(10000))
        .mockRejectedValueOnce(refusal(100000))
        .mockResolvedValue({}),
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: BpmApi, useValue: bpm }],
    });
    TestBed.overrideComponent(BpmLineDetail, { set: { template: '' } });
    const f = TestBed.createComponent(BpmLineDetail);
    f.componentRef.setInput('lineId', 'op_test');
    f.detectChanges();
    await f.whenStable();
    const page = f.componentInstance as any;
    page.realDate.set('2026-11-06');
    await page.settle(detail);
    expect(page.shareGap().neededCents).toBe(10000);
    page.realAmount.set('1000');
    expect(page.shareGap()).toBeNull();
    await page.settle(detail, { notice: 'Ancienne offre de financement' });
    expect(bpm.realizeOperation.mock.calls[1][1]).toMatchObject({
      realizedAmount: 1000,
      fund: false,
    });
    expect(page.shareGap().neededCents).toBe(100000);
    await page.settle(detail, { notice: 'Nouvelle offre confirmée' });
    expect(bpm.realizeOperation.mock.calls[2][1]).toMatchObject({
      realizedAmount: 1000,
      fund: true,
    });
  });
  it('le lien vers le projet quitte le registre sans être annulé par la fermeture de la fiche', async () => {
    const detail = {
      line: {
        label: 'Achat',
        direction: 'charge',
        plannedDate: '2026-12-20',
        plannedCents: 4000,
        statusLabel: 'Prévu',
      },
      project: {
        coreProjectId: 'prj_test',
        name: 'Projet destination',
        funded: true,
        allocationDate: '2026-11-01',
        inclusion: 'pending',
      },
      timing: { realizedPeriod: { key: '2026-11' } },
      actions: { canEdit: false, canSettle: false, canCancelSettlement: false },
      settlements: [],
      ids: {},
    } as unknown as LineDetail;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'depenses', component: RegisterHost },
          { path: 'app/gestion-projet/:id', component: ProjectDestination },
        ]),
        { provide: BpmApi, useValue: { line: vi.fn().mockResolvedValue(detail) } },
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/depenses?operation=op_test', RegisterHost);
    await harness.fixture.whenStable();
    harness.detectChanges();
    const link = harness.routeNativeElement!.querySelector(
      'a[href*="/app/gestion-projet/"]',
    ) as HTMLAnchorElement;
    expect(link).not.toBeNull();
    link.click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/app/gestion-projet/prj_test?period=2026-11');
    expect(harness.routeNativeElement!.textContent).toContain('Projet destination');
  });
  it('demande une confirmation explicite pour une date avant enveloppe et la renouvelle si la date change', async () => {
    const detail = {
      line: {
        id: 'op_test',
        operationId: 'op_test',
        kind: 'operation',
        revision: 2,
        direction: 'charge',
        budgetId: 'bud_test',
        label: 'Achat',
        plannedDate: '2026-11-05',
        plannedCents: 4000,
        costCenterRef: 'std:loisirs',
        categoryId: null,
      },
      project: {
        coreProjectId: 'prj_test',
        name: 'Projet',
        funded: true,
        allocationDate: '2026-11-01',
      },
    } as LineDetail;
    const bpm = {
      line: vi.fn().mockResolvedValue(detail),
      previewCaps: vi.fn().mockResolvedValue({ alerts: [] }),
      realizeOperation: vi.fn().mockResolvedValue({}),
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: BpmApi, useValue: bpm }],
    });
    TestBed.overrideComponent(BpmLineDetail, { set: { template: '' } });
    const f = TestBed.createComponent(BpmLineDetail);
    f.componentRef.setInput('lineId', 'op_test');
    f.detectChanges();
    await f.whenStable();
    const page = f.componentInstance as any;
    page.realDate.set('2026-10-31');
    await page.settle(detail);
    expect(bpm.realizeOperation).not.toHaveBeenCalled();
    expect(page.message()).toContain('hors enveloppe et hors budget de vie');
    page.realDate.set('2026-10-30');
    await page.settle(detail);
    expect(bpm.realizeOperation).not.toHaveBeenCalled();
    await page.settle(detail);
    expect(bpm.realizeOperation).toHaveBeenCalledExactlyOnceWith('op_test', {
      expectedRevision: 2,
      realizedDate: '2026-10-30',
      fund: false,
    });
    expect(page.settleConfirmation()).toBeNull();
  });
});

describe('corrections d’une échéance récurrente depuis sa fiche', () => {
  const occurrence = {
    line: { id: 'rec_test@2026-11-05', operationId: null, recurrenceId: 'rec_test', occurrenceDate: '2026-11-05', kind: 'occurrence', revision: null, direction: 'charge', budgetId: 'bud_life', label: 'Loyer', plannedDate: '2026-11-05', plannedCents: 89000, costCenterRef: 'std:logement', categoryId: null, settled: false },
    definition: { id: 'rec_test', revision: 3, label: 'Loyer' },
    settlements: [],
    skipped: [{ operationId: 'op_skip', occurrenceDate: '2026-10-05', plannedCents: 89000, reason: 'Loyer offert', revision: 2 }],
    ids: { lineId: 'rec_test@2026-11-05', operationId: null, recurrenceId: 'rec_test', budgetId: 'bud_life', taskId: null },
    actions: { canSettle: true, canCancelSettlement: false, canEdit: true, settlementPolicy: '', canSkipOccurrence: true, canDeleteDefinition: true },
  } as unknown as LineDetail;

  async function open(bpm: Record<string, unknown>) {
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: BpmApi, useValue: { line: vi.fn().mockResolvedValue(occurrence), ...bpm } }] });
    TestBed.overrideComponent(BpmLineDetail, { set: { template: '' } });
    const f = TestBed.createComponent(BpmLineDetail);
    f.componentRef.setInput('lineId', 'rec_test@2026-11-05');
    f.detectChanges();
    await f.whenStable();
    const closed = vi.fn();
    f.componentInstance.closed.subscribe(closed);
    return { page: f.componentInstance as any, closed };
  }

  it('écarte l’échéance à sa date puis referme la fiche', async () => {
    const skipOccurrence = vi.fn().mockResolvedValue({});
    const { page, closed } = await open({ skipOccurrence });
    await page.skipOccurrence(occurrence);
    expect(skipOccurrence).toHaveBeenCalledWith('rec_test', expect.objectContaining({ occurrenceDate: '2026-11-05', requestKey: expect.any(String) }));
    expect(closed).toHaveBeenCalled();
  });

  it('supprime la définition à sa révision et rétablit une échéance écartée', async () => {
    const cancelRecurrence = vi.fn().mockResolvedValue({});
    const restoreOccurrence = vi.fn().mockResolvedValue({});
    const { page, closed } = await open({ cancelRecurrence, restoreOccurrence });
    await page.restoreOccurrence(occurrence, occurrence.skipped![0]);
    expect(restoreOccurrence).toHaveBeenCalledWith('rec_test', { occurrenceDate: '2026-10-05', expectedRevision: 2 });
    expect(page.message()).toContain('rétablie');
    await page.deleteDefinition(occurrence);
    expect(cancelRecurrence).toHaveBeenCalledWith('rec_test', 3, expect.any(String));
    expect(closed).toHaveBeenCalled();
  });
});
