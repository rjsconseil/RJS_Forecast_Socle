import type { PatrimoineRead, ProjectSummary } from '../../../platform/grand-noyau';
import { entreePatrimoine } from './entree';

const lecture = { patrimoine: { openingStockCents: 1000000, objectiveCents: 5000000, coreProjectId: 'prj_vie' }, capitalizations: [{ amountCents: 200000 }] } as unknown as PatrimoineRead;
const projet = (id: string, title: string, dueDate: string | null) => ({ project: { id, title, dueDate } }) as unknown as ProjectSummary;

describe('Mon patrimoine · entrée', () => {
  it('le patrimoine constitué, le reste à constituer et les projets de la vie à planifier (sans le projet racine)', () => {
    const e = entreePatrimoine(lecture, [projet('prj_vie', 'Projet de vie', null), projet('p2', 'Retraite', '2045-01-01'), projet('p1', 'Apport immobilier', '2028-06-30')]);
    expect([e.constitueCents, e.objectifCents, e.resteCents]).toEqual([1200000, 5000000, 3800000]);
    expect(e.projets.map((p) => p.titre)).toEqual(['Apport immobilier', 'Retraite']);
  });
});
