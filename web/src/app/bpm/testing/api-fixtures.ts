// Réponses de l'API pour les tests des écrans BPM, produites par la vraie API sur un profil de recette
// (`node api/scripts/web-fixtures.mjs`) : un écran testé ici lit exactement ce que le serveur lui enverrait.
// Un contrat qui change côté serveur change ce fichier, et les tests des écrans le voient.
import fixtures from './api-fixtures.json';

export type ApiFixtures = typeof fixtures;
/** Copie neuve des réponses (un test peut les modifier sans gêner les autres). */
export const apiFixtures = (): ApiFixtures => structuredClone(fixtures);
