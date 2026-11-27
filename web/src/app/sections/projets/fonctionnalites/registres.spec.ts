import donnees from '../application/donnees.json';
import { erreurRegistre, registresDepuis, registreDuTheme as duTheme, saisieRegistre, valeurLisible, type ModeleCollections } from './registres';
import { PRINCE2_THEMES } from './prince2';
import type { LigneApplication } from '../../../platform/grand-noyau';

const REGISTRES = registresDepuis(donnees.collections as unknown as ModeleCollections);
const registreDuTheme = (t: string) => duTheme(REGISTRES, t);

describe('Mes projets · registres PRINCE2', () => {
  it('un registre par thème, chacun sur une collection d’instanciation du modèle', () => {
    expect(REGISTRES.map((r) => r.theme).sort()).toEqual(PRINCE2_THEMES.map((t) => t.id).sort());
    expect(registreDuTheme('risque')?.collection).toBe('risques');
    expect(registreDuTheme('inconnu')).toBeNull();
    const risque = registreDuTheme('risque')!;
    expect(risque.champs.find((c) => c.id === 'intitule')?.obligatoire).toBe(true);
    expect(risque.champs.find((c) => c.id === 'probabilite')?.valeurs).toEqual(['faible', 'moyenne', 'forte']);
  });

  it('convertit la saisie selon le modèle et signale les manques', () => {
    const plans = registreDuTheme('plans')!;
    const s = saisieRegistre(plans, { numero: '2', nom: ' Livraison 1 ', type: 'livraison', debutPrevu: '' });
    expect(s).toEqual({ numero: 2, nom: 'Livraison 1', type: 'livraison' });
    expect(erreurRegistre(registreDuTheme('risque')!, {})).toBe('Intitulé : obligatoire.');
    expect(erreurRegistre(plans, { numero: Number.NaN })).toBe('N° : un nombre entier.');
  });

  it('affiche les valeurs lisibles (choix, livrable, vide)', () => {
    const r = registreDuTheme('cas-affaire')!;
    const ligne = { refCode: 'casAffaire', statut: 'approuve', version: '' } as unknown as LigneApplication;
    const [refCode, , statut, version] = r.champs;
    expect(valeurLisible(refCode, ligne, () => 'Cas d’affaire')).toBe('Cas d’affaire');
    expect(valeurLisible(statut, ligne)).toBe('Approuvé');
    expect(valeurLisible(version, ligne)).toBe('—');
  });
});
