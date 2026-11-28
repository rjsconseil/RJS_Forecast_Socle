import type { InscriptionApplication } from '../../../astra/cadre';

/**
 * Inscription de l'application autonome Mon budget (squelette). Pas encore de page dans BPM-Astra : l'application
 * vit dans son espace propre (/mon-budget), avec un lien dans la zone « Applications autonomes ». Ajouter une page ou
 * un geste ici suffit : le menu, les onglets, la palette et les tests d'interface la reprennent.
 */
export const INSCRIPTION: InscriptionApplication = {
  cle: 'budget',
  section: 'budget',
  pages: [],
  espace: {
    chemin: 'mon-budget',
    titre: 'Mon budget',
    description: 'Le patrimoine disponible, géré pour le faire fructifier : bourse ou projets à but de rendement.',
    resultat: 'À définir selon les fonctions qui seront demandées.',
    symbole: '◈',
    ecran: () => import('./accueil.page').then(m => m.BudgetAccueilPage),
  },
};
