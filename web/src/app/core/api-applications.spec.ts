import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Api } from './api.service';

describe('Api · données des applications autonomes (/api/aa)', () => {
  it('lit, crée, modifie et instancie par les routes génériques', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const api = TestBed.inject(Api);
    const http = TestBed.inject(HttpTestingController);

    const list = api.aaList('projets', 'livrables', { projectId: 'prj_1' });
    http.expectOne('/api/aa/projets/livrables?projectId=prj_1').flush({ collection: 'livrables', items: [] });
    expect((await list).items).toEqual([]);

    const create = api.aaCreate('projets', 'dossiers', { projectId: 'prj_1' });
    const req = http.expectOne('/api/aa/projets/dossiers');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.projectId).toBe('prj_1');
    expect(req.request.body.requestKey).toMatch(/^web-/);
    req.flush({ replayed: false, item: { id: 'aampdos_1' } });
    expect((await create).item.id).toBe('aampdos_1');

    const update = api.aaUpdate('projets', 'dossiers', 'aampdos_1', { processusCourant: 'IP', expectedRevision: 1 });
    const put = http.expectOne('/api/aa/projets/dossiers/aampdos_1');
    expect(put.request.method).toBe('PUT');
    put.flush({ item: { id: 'aampdos_1', revision: 2 } });
    expect((await update).item.revision).toBe(2);

    const inst = api.aaInstancier('projets', { declencheur: 'creation-dossier', projectId: 'prj_1' });
    http.expectOne('/api/aa/projets/instanciation').flush({ declencheur: 'creation-dossier', created: [] });
    expect((await inst).created).toEqual([]);
    http.verify();
  });
});
