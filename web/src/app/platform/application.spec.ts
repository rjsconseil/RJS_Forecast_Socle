import { Component } from '@angular/core';
import { afterEach, describe, expect, it } from 'vitest';
import { contentSectionsOf, CONTENT_SECTION_CATALOG } from '../navigation/content-section-catalog';
import { applicationModules, applicationNavigation } from '../plan/application-navigation';
import { PAGE_WORKSPACES } from '../plan/page-workspaces';
import { contextActions } from '../plan/quick-nav';
import { locate, planContext, planZone, PLAN_ZONES } from '../plan/site-plan';
import { TAB_LINKS } from '../plan/tab-links';
import { ApplicationDeclaration, contentSections, openAction, overviewSection, subpage } from './application';
import { APPLICATIONS } from './applications';
import { auditApplication, checkApplication, installApplication } from './install-application';

@Component({ template: '' })
class Ecran {}
const ecran = () => Promise.resolve(Ecran);

/**
 * Une application d'essai sur un sujet sans rapport avec BPM : un carnet de santé. Tout ce que la
 * plateforme sait d'elle est dans cette déclaration ; aucun fichier central n'est modifié pour elle.
 */
const sante = (): ApplicationDeclaration => ({
  id: 'sante',
  band: { id: 'sante', label: 'Santé', description: 'Suivre sa santé dans la durée.' },
  zone: {
    id: 'sante', kind: 'zone', numbered: true, label: 'Carnet de santé', acronym: 'CS', eyebrow: 'Application Santé · niveau 3',
    mission: 'Suivre ses rendez-vous, ses traitements et ses dossiers médicaux.', band: 'sante', size: 'feature', tone: 'budget', module: 'sante',
    sections: [
      overviewSection('sante', 'Le carnet de santé : rendez-vous, traitements et dossiers.', 'sante', 'sante-accueil', { acronym: '01', label: 'Bienvenue' }),
      {
        id: 'suivi', acronym: '02', label: 'Mon suivi', intention: 'Prévoir · soigner', description: 'Les rendez-vous et les traitements en cours.',
        tone: 'nav-iris', home: 'direct', module: 'sante', space: 'sante-suivi',
        pages: [
          { id: 'rendez-vous', label: 'Rendez-vous', mainLabel: 'Prochains rendez-vous', link: '/sante/rendez-vous', symbol: '◎', description: 'Les rendez-vous à venir.', result: 'Savoir quand consulter.' },
          { id: 'traitements', label: 'Traitements', mainLabel: 'Traitements en cours', link: '/sante/traitements', symbol: '✚', description: 'Les traitements suivis.', result: 'Ne rien oublier.' },
        ],
      },
      {
        id: 'dossiers', acronym: '03', label: 'Mes dossiers', intention: 'Classer · retrouver', description: 'Les dossiers médicaux.',
        tone: 'nav-petrol', home: 'direct', module: 'sante', space: 'sante-dossiers',
        pages: [{ id: 'dossiers', label: 'Dossiers', mainLabel: 'Tous les dossiers', link: '/sante/dossiers', symbol: '◫', description: 'Les dossiers par spécialité.', result: 'Retrouver un document.' }],
      },
    ],
  },
  routes: [
    { path: 'sante/rendez-vous', loadComponent: ecran },
    { path: 'sante/traitements', loadComponent: ecran },
    { path: 'sante/dossiers', loadComponent: ecran },
    { path: 'sante/dossiers/:id', loadComponent: ecran },
    { path: 'sante/ordonnances/:id', loadComponent: ecran },
  ],
  workspaces: [
    subpage('sante/rendez-vous/historique', '/sante/rendez-vous', 'sante-historique', 'Historique des consultations', 'Relisez les consultations passées.', ecran),
    subpage('sante/traitements/rappels', '/sante/traitements', 'sante-rappels', 'Rappels de prise', 'Réglez les rappels de chaque traitement.', ecran),
    { ...subpage('sante/dossiers/:id/documents', '/sante/dossiers', 'sante-documents', 'Documents du dossier', 'Les pièces rangées dans ce dossier.', ecran), tabLabel: 'Documents' },
  ],
  actions: [
    { tab: '/zones/sante', label: 'Prendre un rendez-vous', query: { rdv: 'new' }, link: '/sante/rendez-vous' },
    { tab: '/sante/rendez-vous', label: 'Prendre un rendez-vous', query: { rdv: 'new' } },
    openAction('/sante/traitements', 'Régler les rappels', '/sante/traitements/rappels'),
    { tab: '/sante/dossiers', label: 'Créer un dossier', query: { dossier: 'new' } },
  ],
  contentSections: {
    '/sante/rendez-vous/historique': contentSections(['rdv-annee', 'Par année'], ['rdv-praticien', 'Par praticien']),
    '/sante/traitements/rappels': contentSections(['rappels-jour', 'Rappels du jour']),
  },
  details: [{ pattern: /^\/sante\/ordonnances\//, section: 'suivi', parent: '/sante/traitements', label: 'Ordonnance' }],
  objects: [{ kind: 'dossier', home: '/sante/dossiers', pattern: /^\/sante\/dossiers\/(dos_[^/?#]+)(?:\/|$)/, fallback: 'Dossier médical' }],
  quickActions: ({ connected }) => connected ? [{ id: 'sante:rdv', group: 'action', kind: 'action', label: 'Prendre un rendez-vous', hint: 'Carnet de santé', link: '/sante/rendez-vous', query: { rdv: 'new' }, mark: '＋' }] : [],
});

describe('déclaration d’application : une deuxième application sans toucher la plateforme', () => {
  let uninstall: (() => void) | null = null;
  afterEach(() => { uninstall?.(); uninstall = null; });

  it('chaque application inscrite respecte le contrat', () => {
    for (const application of APPLICATIONS) expect(checkApplication(application), application.id).toEqual([]);
    expect(applicationModules()).toEqual(APPLICATIONS.map((application) => application.id));
  });

  it('autorise un accueil intégré et une liste indépendante de l’adresse des fiches', () => {
    const application = sante();
    application.zone.home = '/sante/rendez-vous';
    const previous = application.zone.sections[0];
    application.zone.sections[0] = { ...previous, hidden: true, redirectTo: '/sante/rendez-vous', pages: [] };
    application.actions = application.actions!.filter(action => action.tab !== '/zones/sante');
    application.objects![0].base = '/sante/fiche';
    application.routes.find(route => route.path === 'sante/dossiers/:id')!.path = 'sante/fiche/:id';
    expect(checkApplication(application)).toEqual([]);
    application.zone.home = '/introuvable';
    expect(checkApplication(application).some(problem => problem.includes('accueil'))).toBe(true);
  });

  it('une application sur un autre sujet se branche par sa seule déclaration', () => {
    const before = JSON.stringify(applicationNavigation('bpm'));
    const application = sante();
    expect(checkApplication(application)).toEqual([]);
    uninstall = installApplication(application);

    // Le plan : zone, bande, sections numérotées dans l'ordre (niveau 1), pages (niveau 2).
    expect(planZone('sante')?.label).toBe('Carnet de santé');
    expect(applicationModules()).toContain('sante');
    const navigation = applicationNavigation('sante')!;
    expect(navigation.sections.map((section) => `${section.mark} ${section.label}`)).toEqual(['01 Vue d’ensemble', '02 Mon suivi', '03 Mes dossiers']);
    expect(navigation.sections[1].pages.map((page) => page.link)).toEqual(['/sante/rendez-vous', '/sante/traitements']);

    // Le cadre du haut : accueil de page avec ses actions, sous-pages, sections de contenu (niveaux 3 et 4).
    expect(locate('/sante/rendez-vous')).toMatchObject({ kind: 'page', zone: { id: 'sante' }, section: { id: 'suivi' } });
    expect(locate('/sante/rendez-vous/historique')).toMatchObject({ kind: 'subpage', page: { id: 'rendez-vous' } });
    const context = planContext('/sante/rendez-vous');
    expect(context.tabs.map((tab) => tab.label)).toEqual(['Prochains rendez-vous', 'Historique des consultations']);
    expect(context.tabs[0].links.map((link) => link.label)).toEqual(['Prendre un rendez-vous']);
    expect(planContext('/zones/sante').tabs[0].links.map((link) => link.label)).toEqual(['Prendre un rendez-vous']);
    expect(contentSectionsOf('/sante/rendez-vous/historique').map((section) => section.label)).toEqual(['Par année', 'Par praticien']);

    // Fiches et détails : mêmes mécanismes que la fiche projet de BPM.
    const fiche = locate('/sante/dossiers/dos_42');
    expect(fiche).toMatchObject({ kind: 'detail', page: { id: 'dossiers' }, object: { kind: 'dossier', id: 'dos_42', link: '/sante/dossiers/dos_42' } });
    expect(planContext('/sante/dossiers/dos_42').tabs.map((tab) => tab.label)).toEqual(['Vue d’ensemble', 'Documents']);
    expect(planContext('/sante/dossiers/dos_42').label).toBe('Dossier médical');
    expect(locate('/sante/ordonnances/ord_1')).toMatchObject({ kind: 'detail', detailLabel: 'Ordonnance', page: { id: 'traitements' } });

    // Actions rapides et règles du Navigation system (N2 à N9) : aucune erreur.
    expect(contextActions('/sante/traitements', true).map((action) => action.label)).toContain('Prendre un rendez-vous');
    expect(auditApplication('sante').filter((finding) => finding.level === 'error')).toEqual([]);

    // BPM n'a pas bougé.
    expect(JSON.stringify(applicationNavigation('bpm'))).toBe(before);
  });

  it('se retire sans laisser de trace', () => {
    const sizes = () => [APPLICATIONS.length, PLAN_ZONES.length, PAGE_WORKSPACES.length, TAB_LINKS.length, Object.keys(CONTENT_SECTION_CATALOG).length];
    const before = sizes();
    installApplication(sante())();
    expect(sizes()).toEqual(before);
    expect(planZone('sante')).toBeNull();
    expect(locate('/sante/rendez-vous').kind).toBe('none');
  });

  it('refuse une déclaration incomplète ou en collision, sans rien installer', () => {
    const collision = sante();
    collision.routes.push({ path: 'tableau-de-bord', loadComponent: ecran });
    expect(checkApplication(collision)).toContain('L’adresse /tableau-de-bord est déjà prise.');

    const incomplete = sante();
    incomplete.routes = incomplete.routes.filter((route) => route.path !== 'sante/traitements');
    incomplete.actions!.push({ tab: '/bpm-astra/plafonds', label: 'Hors de l’application', query: {} });
    const problems = checkApplication(incomplete);
    expect(problems).toContain('La page « Traitements » (/sante/traitements) n’a pas de route.');
    expect(problems.some((problem) => problem.includes('/bpm-astra/plafonds'))).toBe(true);
    expect(() => installApplication(incomplete)).toThrow(/refusée/);
    expect(planZone('sante')).toBeNull();

    const doublon = sante();
    doublon.id = doublon.zone.id = 'bpm-astra';
    expect(checkApplication(doublon)).toContain('Une zone « bpm-astra » existe déjà.');
  });
});
