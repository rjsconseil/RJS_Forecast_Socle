import type { InscriptionApplication } from '../../../astra/cadre';

/**
 * Inscription de l'application autonome Mon patrimoine (squelette). Pas encore de page dans BPM-Astra : l'application
 * vit dans son espace propre (/mon-patrimoine), avec un lien dans la zone « Applications autonomes ». Ajouter une page ou
 * un geste ici suffit : le menu, les onglets, la palette et les tests d'interface la reprennent.
 */
export const INSCRIPTION: InscriptionApplication = {
  cle: 'patrimoine',
  section: 'patrimoine',
  pages: [],
  espace: {
    chemin: 'mon-patrimoine',
    titre: 'Mon patrimoine',
    description: 'Planifier son patrimoine sur des projets de vie à portée patrimoniale : apport immobilier, retraite…',
    resultat: 'À définir selon les fonctions qui seront demandées.',
    symbole: '◆',
    ecran: () => import('./accueil.page').then(m => m.PatrimoineAccueilPage),
  },
};
