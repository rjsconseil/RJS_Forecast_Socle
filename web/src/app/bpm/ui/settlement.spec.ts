import { TestBed } from '@angular/core/testing';
import { ApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { RegisterLine } from '../../core/bpm-models';
import { Settlement } from './settlement';

describe('règlement partagé (ligne rapide et fiche détaillée)', () => {
  const line = { id: 'op_1', operationId: 'op_1', kind: 'operation', direction: 'charge', label: 'Courses', plannedCents: 5000, plannedDate: '2026-11-10', budgetId: 'b1', revision: 3 } as RegisterLine;
  const alert = { level: 'center', ref: 'std:divers', id: null, label: 'Divers', engagedCents: 6000, capCents: 5000, overCents: 1000 };

  it('avertit du plafond avant paiement, attend la confirmation, puis rend les alertes de l’écriture', async () => {
    const bpm = {
      previewCaps: vi.fn().mockResolvedValue({ alerts: [alert], period: { label: 'novembre' } }),
      realizeOperation: vi.fn().mockResolvedValue({ operation: { id: 'op_1' }, capAlerts: [alert] }),
    };
    TestBed.configureTestingModule({ providers: [{ provide: BpmApi, useValue: bpm }] });
    const s = TestBed.runInInjectionContext(() => new Settlement(() => line.id));
    s.realDate.set('2026-11-10');
    expect(await s.settle(line)).toBeNull();
    expect(bpm.realizeOperation).not.toHaveBeenCalled();
    expect(s.message()).toContain('Attention avant paiement (novembre)');
    const r = await s.settle(line);
    expect(r?.capAlerts).toEqual([alert]);
    expect(bpm.realizeOperation).toHaveBeenCalledExactlyOnceWith('op_1', { expectedRevision: 3, realizedDate: '2026-11-10', fund: false });
    expect(s.message()).toContain('plafond dépassé');
  });

  it('signale un refus que le budget de vie peut lever, pour la seule saisie refusée', async () => {
    const refusal = new ApiError(409, { code: 'OVERRUN_AUTHORIZATION_REQUIRED', message: 'Dépassement à autoriser.', action: null, details: {} });
    const bpm = { previewCaps: vi.fn().mockResolvedValue({ alerts: [] }), realizeOperation: vi.fn().mockRejectedValue(refusal) };
    TestBed.configureTestingModule({ providers: [{ provide: BpmApi, useValue: bpm }] });
    const s = TestBed.runInInjectionContext(() => new Settlement(() => line.id));
    await s.settle(line);
    expect(s.fundable()).toBe(true);
    s.realAmount.set('12');
    expect(s.fundable()).toBe(false);
  });
});
