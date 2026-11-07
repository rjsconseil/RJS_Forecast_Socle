import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap } from '@angular/router';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmEntryFlow } from './entry-flow';
import { BpmPageContext } from './page-context';

const detail = (id: string, budgetId: string) => ({ line: { id, budgetId, label: id } });

describe('reprise d’une opération depuis son adresse', () => {
  const query = signal(convertToParamMap({ entry: 'op-A' }));
  async function settle() { await Promise.resolve(); await Promise.resolve(); TestBed.tick(); }
  beforeEach(() => { query.set(convertToParamMap({ entry: 'op-A' })); });
  function setup(line: (id: string) => Promise<unknown>) {
    TestBed.configureTestingModule({ providers: [
      { provide: BpmApi, useValue: { line } },
      { provide: BpmPageContext, useValue: { query, period: () => undefined, setQuery: vi.fn().mockResolvedValue(true) } },
    ] });
    TestBed.overrideComponent(BpmEntryFlow, { set: { template: '' } });
    const fixture = TestBed.createComponent(BpmEntryFlow);
    fixture.componentRef.setInput('budgets', [{ id: 'budget-A' }]);
    TestBed.tick();
    return fixture.componentInstance as any;
  }
  it('ne propose pas de modifier une opération appartenant à un autre projet', async () => {
    const flow = setup(async id => detail(id, 'budget-B'));
    await settle();
    expect(flow.line.data().line.id).toBe('op-A');
    expect(flow.selectedLine()).toBeNull();
  });
  it('ne présente pas la ligne précédente pendant le chargement d’une autre', async () => {
    let resolve!: (value: unknown) => void;
    const flow = setup(id => id === 'op-A' ? Promise.resolve(detail(id, 'budget-A')) : new Promise(r => resolve = r));
    await settle();
    expect(flow.selectedLine().id).toBe('op-A');
    query.set(convertToParamMap({ entry: 'op-B' }));
    TestBed.tick();
    expect(flow.selectedLine()).toBeNull();
    resolve(detail('op-B', 'budget-A')); await settle();
    expect(flow.selectedLine().id).toBe('op-B');
    query.set(convertToParamMap({ entry: 'new' }));
    expect(flow.selectedLine()).toBeNull();
  });
});
