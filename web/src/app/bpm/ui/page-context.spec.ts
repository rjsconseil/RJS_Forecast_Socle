import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ApiError, RecetteContext } from '../../core/api.service';
import { bpmLoader, BpmRefresh, shiftPeriod } from './page-context';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

describe('shiftPeriod', () => {
  it('passe les années', () => {
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
    expect(shiftPeriod('2026-12', 1)).toBe('2027-01');
    expect(shiftPeriod('2078-01', 0)).toBe('2078-01');
  });
});

describe('bpmLoader', () => {
  const pending: Record<string, ReturnType<typeof deferred<string>>> = {};
  const key = signal('2026-10');

  @Component({ template: '' })
  class Host {
    loader = bpmLoader(
      () => key(),
      (k) => {
        pending[k] = deferred<string>();
        return pending[k].promise;
      },
    );
  }

  beforeEach(() => {
    for (const k of Object.keys(pending)) delete pending[k];
    key.set('2026-10');
    TestBed.configureTestingModule({ providers: [RecetteContext, BpmRefresh] });
  });

  async function settle() {
    await Promise.resolve();
    await Promise.resolve();
    TestBed.tick();
  }

  it('ignore une réponse devenue ancienne après changement de période', async () => {
    const fixture = TestBed.createComponent(Host);
    TestBed.tick();
    const loader = fixture.componentInstance.loader;
    expect(loader.loading()).toBe(true);
    key.set('2026-11');
    TestBed.tick();
    pending['2026-11'].resolve('novembre');
    await settle();
    pending['2026-10'].resolve('octobre'); // réponse périmée, arrivée après
    await settle();
    expect(loader.data()).toBe('novembre');
    expect(loader.loading()).toBe(false);
  });

  it('expose l’erreur et recharge à la demande', async () => {
    const fixture = TestBed.createComponent(Host);
    TestBed.tick();
    const loader = fixture.componentInstance.loader;
    pending['2026-10'].reject(new ApiError(0, { code: 'NETWORK', action: null, message: "L'API locale ne répond pas." }));
    await settle();
    expect(loader.error()?.body.code).toBe('NETWORK');
    loader.reload();
    TestBed.tick();
    expect(loader.loading()).toBe(true);
    pending['2026-10'].resolve('octobre');
    await settle();
    expect(loader.error()).toBeNull();
    expect(loader.data()).toBe('octobre');
  });

  it('recharge après une écriture signalée par BpmRefresh', async () => {
    const fixture = TestBed.createComponent(Host);
    TestBed.tick();
    pending['2026-10'].resolve('v1');
    await settle();
    TestBed.inject(BpmRefresh).bump();
    TestBed.tick();
    expect(fixture.componentInstance.loader.loading()).toBe(true);
    pending['2026-10'].resolve('v2');
    await settle();
    expect(fixture.componentInstance.loader.data()).toBe('v2');
  });

  it('efface les données d’un autre user avant la nouvelle réponse', async () => {
    const fixture = TestBed.createComponent(Host);
    TestBed.tick();
    pending['2026-10'].resolve('user1');
    await settle();
    TestBed.inject(RecetteContext).userId.set('usr_autre');
    TestBed.tick();
    expect(fixture.componentInstance.loader.data()).toBeNull();
  });
});
