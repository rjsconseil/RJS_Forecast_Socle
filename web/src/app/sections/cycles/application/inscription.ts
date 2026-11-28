import type { InscriptionApplication } from '../../../astra/cadre';

/**
 * Inscription de l'application autonome Mes cycles (squelette). Pas encore de page dans BPM-Astra : l'application
 * vit dans son espace propre (/mes-cycles), avec un lien dans la zone « Applications autonomes ». Ajouter une page ou
 * un geste ici suffit : le menu, les onglets, la palette et les tests d'interface la reprennent.
 */
export const INSCRIPTION: InscriptionApplication = {
  cle: 'cycles',
  section: 'cycles',
  pages: [],
  espace: {
    chemin: 'mes-cycles',
    titre: 'Mes cycles',
    description: 'Analyser ses comportements financiers du quotidien pour améliorer son taux d’épargne à chaque cycle.',
    resultat: 'À définir selon les fonctions qui seront demandées.',
    symbole: '↻',
    ecran: () => import('./accueil.page').then(m => m.CyclesAccueilPage),
  },
};
