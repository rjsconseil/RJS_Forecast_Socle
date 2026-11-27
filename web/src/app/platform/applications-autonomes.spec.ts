import { espacesAutonomes, type InscriptionAvecEspace, routesAutonomes, sectionApplicationsAutonomes } from './applications-autonomes';

const ecran = () => Promise.resolve(class Ecran {});
const sansEspace: InscriptionAvecEspace = { cle: 'budget' };
const avecEspace: InscriptionAvecEspace = {
  cle: 'projets',
  espace: { chemin: '/mes-projets/', titre: 'Mes projets', description: 'Gestion de projet', resultat: 'L’état des projets', ecran },
};

describe('Applications autonomes (espaces hors de BPM-Astra)', () => {
  it('ne retient que les applications qui déclarent un espace, avec un chemin normalisé', () => {
    const espaces = espacesAutonomes([sansEspace, avecEspace]);
    expect(espaces.length).toBe(1);
    expect(espaces[0].cle).toBe('projets');
    expect(espaces[0].chemin).toBe('mes-projets');
    expect(espaces[0].symbole).toBe('◫');
  });

  it('donne à chaque espace son adresse et ses sous-adresses', () => {
    const routes = routesAutonomes(espacesAutonomes([avecEspace]));
    expect(routes.map((r) => r.path)).toEqual(['mes-projets', 'mes-projets/**']);
    expect(routes[0].title).toBe('Mes projets · Application autonome');
    expect(routes[0].loadComponent).toBe(ecran);
  });

  it('présente un lien par application dans la section du noyau, cachée sans application', () => {
    const section = sectionApplicationsAutonomes(espacesAutonomes([avecEspace]), '05');
    expect(section.label).toBe('Applications autonomes');
    expect(section.hidden).toBeUndefined();
    expect(section.pages.map((p) => [p.id, p.link])).toEqual([['autonome-projets', '/mes-projets']]);
    expect(sectionApplicationsAutonomes([], '05').hidden).toBe(true);
  });
});
