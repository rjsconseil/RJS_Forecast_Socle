import type { InscriptionApplication } from '../../../astra/cadre';

/**
 * Inscription de l'application autonome Mes projets dans BPM-Astra : ses pages (après les pages du socle, l'entrée de
 * la section reste « Projets de la vie »), ses gestes et son jeu d'essai. Ajouter une page ici suffit : le menu, les
 * onglets, la palette et les tests d'interface la reprennent.
 */
export const INSCRIPTION: InscriptionApplication = {
  cle: 'projets',
  section: 'projets',
  pages: [
    { slug: 'pilotage', label: 'Pilotage', ecran: () => import('./pilotage.page').then(m => m.ProjetsPilotagePage), mobile: true },
  ],
  actions: [
    { page: 'pilotage', label: 'Créer un projet de la vie', query: { editProject: 'new' }, vers: 'projets' },
    { page: 'pilotage', label: 'Créer une tâche', query: { editTask: 'new' }, vers: 'taches' },
  ],
  essais: ['api/scripts/seed-projets.mjs'],
};
