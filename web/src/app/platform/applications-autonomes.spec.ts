import { BANDE_APPLICATIONS_AUTONOMES, ZONE_APPLICATIONS_AUTONOMES, espacesAutonomes, type InscriptionAvecEspace, routesAutonomes, zoneApplicationsAutonomes } from './applications-autonomes';
import { locate, PLAN_BANDS, PLAN_ZONES, sectionEntry } from '../plan/site-plan';

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

  it('donne à chaque espace son adresse', () => {
    const routes = routesAutonomes(espacesAutonomes([avecEspace]));
    expect(routes.map((r) => r.path)).toEqual(['mes-projets']);
    expect(routes[0].title).toBe('Mes projets · Application autonome');
    expect(routes[0].loadComponent).toBe(ecran);
  });

  it('donne aux applications leur propre zone, une section par application, absente sans application', () => {
    const zone = zoneApplicationsAutonomes(espacesAutonomes([avecEspace]))!;
    expect(zone.label).toBe('Applications autonomes');
    expect(zone.band).toBe(BANDE_APPLICATIONS_AUTONOMES.id);
    expect(zone.sections.map((s) => [s.id, s.acronym, s.label])).toEqual([['projets', '01', 'Mes projets']]);
    expect(sectionEntry(zone, zone.sections[0]).link).toBe('/mes-projets');
    expect(zoneApplicationsAutonomes([])).toBeNull();
  });

  it('le plan du site range la zone dans sa bande de l’accueil des modules, entre le socle et les modules techniques', () => {
    const ids = PLAN_BANDS.map((b) => b.id);
    expect(ids.indexOf('autonomes')).toBe(ids.indexOf('technical') - 1);
    const zone = PLAN_ZONES.find((z) => z.id === 'applications-autonomes')!;
    expect(zone.sections.some((s) => s.pages.some((p) => p.link === '/mes-projets'))).toBe(true);
    // La section du noyau a laissé sa place à la zone.
    expect(PLAN_ZONES.find((z) => z.id === 'noyau')!.sections.some((s) => s.id === 'applications')).toBe(false);
  });

  it('une application autonome se situe dans sa zone : le site n’y affiche pas la barre de parcours', () => {
    expect(locate('/mes-projets').zone?.id).toBe(ZONE_APPLICATIONS_AUTONOMES);
    expect(locate('/mes-projets?theme=risque').zone?.id).toBe(ZONE_APPLICATIONS_AUTONOMES);
  });
});
