import type { InscriptionApplication } from '../../../astra/cadre';

/**
 * Inscription de l'application autonome Mon quotidien (squelette). Pas encore de page dans BPM-Astra : l'application
 * vit dans son espace propre (/mon-quotidien), avec un lien dans la zone « Applications autonomes ». Ajouter une page ou
 * un geste ici suffit : le menu, les onglets, la palette et les tests d'interface la reprennent.
 */
export const INSCRIPTION: InscriptionApplication = {
  cle: 'quotidien',
  section: 'quotidien',
  pages: [],
  espace: {
    chemin: 'mon-quotidien',
    titre: 'Mon quotidien',
    description: 'Une application complète de gestion de l’emploi du temps et du budget personnel.',
    resultat: 'À définir selon les fonctions qui seront demandées.',
    symbole: '◷',
    ecran: () => import('./accueil.page').then(m => m.QuotidienAccueilPage),
  },
};
