import donnees from '../application/donnees.json';
import type { LigneApplication } from '../../../platform/grand-noyau';
import { dossiersParProjet } from './dossiers';
import { PRINCE2_LIVRABLES, PRINCE2_PROCESSUS, PRINCE2_THEMES } from './prince2';

const ligne = (x: Partial<LigneApplication>): LigneApplication => ({ id: 'x', kind: 'k', userId: 'u', application: 'projets', revision: 1, createdAt: '', updatedAt: '', ...x });

describe('Mes projets · dossiers PRINCE2', () => {
  it('résume le dossier de chaque projet : processus courant et produits approuvés', () => {
    const r = dossiersParProjet(
      [ligne({ id: 'd1', projectId: 'prj_1', processusCourant: 'IP' })],
      [ligne({ projectId: 'prj_1', statut: 'approuve' }), ligne({ projectId: 'prj_1', statut: 'a-faire' }), ligne({ projectId: 'prj_2', statut: 'approuve' })],
    );
    expect(r.get('prj_1')).toEqual({ dossierId: 'd1', processus: 'IP', livrables: 2, approuves: 1, avancement: 50 });
    expect(r.has('prj_2')).toBe(false);
  });

  it('le catalogue de la base (donnees.json) reprend le référentiel de l’application', () => {
    const lignes = donnees.catalogue.lignes;
    expect(lignes.refThemes.map((t) => t.code)).toEqual(PRINCE2_THEMES.map((t) => t.id));
    expect(lignes.refProcessus.map((p) => p.code).sort()).toEqual(PRINCE2_PROCESSUS.map((p) => p.id).sort());
    expect(lignes.refLivrables.map((l) => l.code).sort()).toEqual(Object.keys(PRINCE2_LIVRABLES).sort());
    const cibles = new Set(Object.keys(donnees.collections));
    for (const r of lignes.refReglesInstanciation) expect(cibles.has(r.cible)).toBe(true);
  });
});
