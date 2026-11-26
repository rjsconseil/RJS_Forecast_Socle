import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { Api } from '../../core/api.service';
import { BpmApi } from '../data/bpm-api.service';
import { BpmProjectDetail } from '../data/bpm-projects.models';
import { apiFixtures } from '../testing/api-fixtures';
import { BpmProjectPage } from './project.page';

/**
 * Fiche d'un projet de la vie sur la réponse de la vraie API (profil de recette : « Cuisine », 1 200 € attribués,
 * une tâche « Plan de travail » et un règlement de 450 €). Complète project-cockpit.spec, qui teste les gestes.
 */
describe('fiche du projet · contrat de l’API', () => {
  async function open() {
    const f = apiFixtures();
    const detail = f.projectDetail as unknown as BpmProjectDetail;
    const id = detail.project.project.id;
    const bpm = {
      projectDetail: vi.fn(async () => structuredClone(detail)),
      projectFlows: vi.fn(async () => null),
      financialOutlook: vi.fn(async () => null),
      bilans: vi.fn(async () => f.bilans),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Api, useValue: {} },
        { provide: BpmApi, useValue: bpm },
        {
          provide: ActivatedRoute,
          useValue: {
            data: of({}), fragment: of(null), queryParams: of({}),
            paramMap: new BehaviorSubject(convertToParamMap({ id })), queryParamMap: new BehaviorSubject(convertToParamMap({})),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(BpmProjectPage);
    await (fixture.componentInstance as unknown as { load(): Promise<void> }).load();
    for (let i = 0; i < 3; i++) { fixture.detectChanges(); await fixture.whenStable(); }
    return { root: fixture.nativeElement as HTMLElement, detail, bpm, id };
  }

  it('lit la fiche par l’identifiant du projet noyau et en affiche le titre, l’enveloppe et chaque tâche', async () => {
    const { root, detail, bpm, id } = await open();
    expect(bpm.projectDetail).toHaveBeenCalledWith(id);
    const text = root.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain(detail.project.project.title);
    for (const t of detail.tasks) expect(text).toContain(t.task.title);
    // L'enveloppe attribuée par le budget de vie (1 200,00 €) et le règlement de la tâche (450,00 €).
    expect(detail.budget!.allocationCents).toBe(120000);
    expect(text).toMatch(/1\s?200,00\s?€/);
    expect(text).toMatch(/450,00\s?€/);
  });
});
