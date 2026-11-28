import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { Api, type LigneApplication } from '../../../platform/grand-noyau';
import { registreDuTheme, registresDepuis, type ModeleCollections } from '../fonctionnalites/registres';
import donnees from './donnees.json';
import { ProjetsRegistre } from './registre-projet';

const REGISTRES = registresDepuis(donnees.collections as unknown as ModeleCollections);
async function settle(f: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  for (let i = 0; i < 3; i++) {
    f.detectChanges();
    await f.whenStable();
    await new Promise((r) => setTimeout(r, 0));
  }
  f.detectChanges();
}

const ligne = (x: Record<string, unknown>) => ({ id: 'l1', kind: 'k', userId: 'u', application: 'projets', revision: 1, createdAt: '', updatedAt: '', projectId: 'prj_1', ...x }) as LigneApplication;

async function render(theme: string, items: LigneApplication[], projets = [{ id: 'prj_1', title: 'Lancement' }]) {
  const api = {
    aaList: vi.fn(async (_a: string, collection: string) => ({ collection, items })),
    aaCreate: vi.fn(async () => ({ replayed: false, item: {} })),
    aaUpdate: vi.fn(async () => ({ item: {} })),
    aaInstancier: vi.fn(async () => ({ declencheur: 'ouverture-etape', created: [] })),
  };
  TestBed.configureTestingModule({ providers: [{ provide: Api, useValue: api }] });
  const f = TestBed.createComponent(ProjetsRegistre);
  f.componentRef.setInput('registre', registreDuTheme(REGISTRES, theme)!);
  f.componentRef.setInput('projets', projets);
  await settle(f);
  await settle(f);
  return { f, api, el: f.nativeElement as HTMLElement };
}

describe('Mes projets · registre PRINCE2 d’un thème', () => {
  it('sans dossier ouvert, invite à l’ouvrir depuis l’accueil', async () => {
    const { el, api } = await render('risque', [], []);
    expect(el.querySelector('.mp-registre-empty')?.textContent).toContain('PRINCE2 project file');
    expect(api.aaList).not.toHaveBeenCalled();
  });

  it('liste le registre du projet, ajoute une ligne et change son état', async () => {
    const { f, api, el } = await render('risque', [ligne({ intitule: 'Retard fournisseur', probabilite: 'forte', statut: 'ouvert' })]);
    expect(api.aaList).toHaveBeenCalledWith('projets', 'risques', { projectId: 'prj_1' });
    expect(el.querySelector('tbody td')?.textContent?.trim()).toBe('Retard fournisseur');
    expect(el.querySelectorAll('tbody td')[1].textContent?.trim()).toBe('High');

    (el.querySelector('.mp-registre-tools .mp-btn.primary') as HTMLButtonElement).click();
    await settle(f);
    const form = el.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    await settle(f);
    expect(el.querySelector('.mp-alert.danger')?.textContent).toBe('Title is required.');
    (form.querySelector('[name=intitule]') as HTMLInputElement).value = 'Budget serré';
    form.dispatchEvent(new Event('submit'));
    await settle(f);
    expect(api.aaCreate).toHaveBeenCalledWith('projets', 'risques', { intitule: 'Budget serré', statut: 'ouvert', projectId: 'prj_1' });

    const etat = el.querySelector('select.mp-etat') as HTMLSelectElement;
    etat.value = 'clos';
    etat.dispatchEvent(new Event('change'));
    await settle(f);
    expect(api.aaUpdate).toHaveBeenCalledWith('projets', 'risques', 'l1', { statut: 'clos', expectedRevision: 1 });
  });

  it('ouvre une séquence : instanciation de ses produits, puis séquence en cours', async () => {
    const { f, api, el } = await render('plans', [ligne({ numero: 1, nom: 'Initialisation', statut: 'a-venir' })]);
    (el.querySelector('tbody .mp-btn.small') as HTMLButtonElement).click();
    await settle(f);
    expect(api.aaInstancier).toHaveBeenCalledWith('projets', { declencheur: 'ouverture-etape', projectId: 'prj_1', etapeId: 'l1' });
    expect(api.aaUpdate).toHaveBeenCalledWith('projets', 'etapes', 'l1', { statut: 'en-cours', expectedRevision: 1 });
  });
});
