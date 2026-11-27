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
  // L'application autonome Mes projets (PRINCE2) dans son propre espace, hors de BPM-Astra : /mes-projets, avec un lien
  // dans la section « Applications autonomes » de la zone Noyau transverse. Son modèle de données : donnees.json.
  espace: {
    chemin: 'mes-projets',
    titre: 'Mes projets',
    description: 'Gestion de projet selon PRINCE2 : l’état des projets et de leurs tâches, puis les 7 thèmes de la méthode.',
    resultat: 'Un dossier PRINCE2 par projet, ses rôles, ses séquences et ses produits de management.',
    symbole: '◫',
    ecran: () => import('./gestion-projet.page').then(m => m.ProjetsGestionProjetPage),
  },
  essais: ['api/scripts/seed-projets.mjs'],
};
