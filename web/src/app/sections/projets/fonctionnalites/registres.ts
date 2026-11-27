import type { LigneApplication } from '../../../platform/grand-noyau';
import type { ThemeId } from './prince2';

/**
 * Fonctionnalités Mes projets · registres PRINCE2 d'un projet en cours (tables AA_MP_…).
 * Un registre par thème : quelle collection il tient, quelles colonnes il montre, quels champs se saisissent.
 * Les types et les choix viennent du modèle de données de l'application (ses collections, passées en paramètre).
 */
export type TypeChamp = 'texte' | 'nombre' | 'entier' | 'date' | 'booleen' | 'choix' | 'liste' | 'json';
export interface ChampRegistre { id: string; label: string; type: TypeChamp; valeurs: string[]; obligatoire: boolean }
export interface Registre {
  theme: ThemeId;
  collection: string;
  titre: string;
  aide: string;
  champs: ChampRegistre[];
  /** Le champ « état » modifiable directement dans la liste. */
  etat: string | null;
  /** Une séquence s'ouvre (instanciation « ouverture-etape »). */
  ouvreSequence?: boolean;
  /** Le registre se remplit par l'instanciation, sans saisie libre. */
  sansSaisie?: boolean;
}

/** Les collections du modèle de données (forme de donnees.json). */
export type ModeleCollections = Record<string, { champs?: Record<string, { type: string; valeurs?: string[]; obligatoire?: boolean }> }>;

const LIBELLES: Record<string, string> = {
  role: 'Rôle', personne: 'Personne', contact: 'Contact', numero: 'N°', nom: 'Nom', type: 'Type', statut: 'Statut',
  debutPrevu: 'Début prévu', finPrevue: 'Fin prévue', intitule: 'Intitulé', probabilite: 'Probabilité', impact: 'Impact',
  proprietaire: 'Propriétaire', reponse: 'Réponse', gravite: 'Gravité', priorite: 'Priorité', decision: 'Décision',
  methode: 'Méthode', responsable: 'Responsable', prevuLe: 'Prévu le', faitLe: 'Fait le', resultat: 'Résultat',
  date: 'Date', contenu: 'Contenu', processus: 'Processus', version: 'Version', approuvePar: 'Approuvé par',
  approuveLe: 'Approuvé le', refCode: 'Livrable',
};
/** Libellés des valeurs de choix (le code reste stocké). */
export const VALEURS: Record<string, string> = {
  'a-faire': 'À faire', brouillon: 'Brouillon', approuve: 'Approuvé', 'a-venir': 'À venir', 'en-cours': 'En cours', close: 'Close',
  initiation: 'Initialisation', livraison: 'Livraison', cloture: 'Clôture', faible: 'Faible', moyenne: 'Moyenne', moyen: 'Moyen',
  forte: 'Forte', fort: 'Fort', ouvert: 'Ouvert', clos: 'Clos', decide: 'Décidé', 'demande-changement': 'Demande de changement',
  'hors-specification': 'Hors spécification', probleme: 'Problème ou préoccupation', basse: 'Basse', normale: 'Normale', haute: 'Haute',
  conforme: 'Conforme', 'non-conforme': 'Non conforme', note: 'Note', lecon: 'Leçon', 'rapport-situation': 'Rapport de situation',
  'rapport-point-controle': 'Rapport de point de contrôle', 'rapport-fin-sequence': 'Rapport de fin de séquence',
  'rapport-exception': "Rapport d'exception", 'rapport-fin-projet': 'Rapport de fin de projet',
};

/** Les registres de l'application, un par thème, d'après son modèle de données. */
export function registresDepuis(modele: ModeleCollections): Registre[] {
  const champs = (collection: string, ids: string[]): ChampRegistre[] => {
    const defs = modele[collection]?.champs ?? {};
    return ids.map((id) => {
      const d = defs[id] ?? { type: 'texte' };
      return { id, label: LIBELLES[id] ?? id, type: d.type as TypeChamp, valeurs: d.valeurs ?? [], obligatoire: Boolean(d.obligatoire) };
    });
  };
  return [
    { theme: 'cas-affaire', collection: 'livrables', titre: 'Produits de management du projet', aide: 'Créés à l’ouverture du dossier et de chaque séquence : faites-les avancer jusqu’à leur approbation.', champs: champs('livrables', ['refCode', 'processus', 'statut', 'version', 'approuvePar', 'approuveLe']), etat: 'statut', sansSaisie: true },
    { theme: 'organisation', collection: 'roles', titre: 'Rôles du projet', aide: 'Qui tient chaque rôle. Un rôle peut avoir plusieurs personnes, une personne plusieurs rôles.', champs: champs('roles', ['role', 'personne', 'contact']), etat: null },
    { theme: 'qualite', collection: 'qualite', titre: 'Registre qualité', aide: 'Les contrôles qualité prévus et leur résultat.', champs: champs('qualite', ['methode', 'responsable', 'prevuLe', 'faitLe', 'resultat']), etat: 'resultat' },
    { theme: 'plans', collection: 'etapes', titre: 'Séquences de management', aide: 'Ouvrir une séquence crée son plan, son rapport de situation et son rapport de fin de séquence.', champs: champs('etapes', ['numero', 'nom', 'type', 'statut', 'debutPrevu', 'finPrevue']), etat: 'statut', ouvreSequence: true },
    { theme: 'risque', collection: 'risques', titre: 'Registre des risques', aide: 'Chaque risque : sa probabilité, son impact, sa réponse et son propriétaire.', champs: champs('risques', ['intitule', 'probabilite', 'impact', 'reponse', 'proprietaire', 'statut']), etat: 'statut' },
    { theme: 'changement', collection: 'problemes', titre: 'Registre des incidences', aide: 'Demandes de changement, hors spécifications, problèmes : leur gravité et la décision prise.', champs: champs('problemes', ['intitule', 'type', 'gravite', 'priorite', 'decision', 'statut']), etat: 'statut' },
    { theme: 'progression', collection: 'journalProjet', titre: 'Journal du projet', aide: 'Notes, leçons et rapports, datés.', champs: champs('journalProjet', ['date', 'type', 'contenu']), etat: null },
  ];
}

export const registreDuTheme = (registres: readonly Registre[], theme: string | null | undefined): Registre | null => registres.find((r) => r.theme === theme) ?? null;

/** Valeur lisible d'un champ d'une ligne. */
export function valeurLisible(champ: ChampRegistre, ligne: LigneApplication, nomLivrable: (code: string) => string = (c) => c): string {
  const v = ligne[champ.id];
  if (v === null || v === undefined || v === '') return '—';
  if (champ.id === 'refCode') return nomLivrable(String(v));
  if (champ.type === 'choix') return VALEURS[String(v)] ?? String(v);
  if (champ.type === 'booleen') return v ? 'Oui' : 'Non';
  return String(v);
}

/** Saisie d'un formulaire → champs à écrire (les nombres et les vides convertis selon le modèle). */
export function saisieRegistre(registre: Registre, brut: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of registre.champs) {
    if (c.id === 'refCode') continue;
    const v = (brut[c.id] ?? '').trim();
    if (!v) continue;
    out[c.id] = c.type === 'entier' ? Number.parseInt(v, 10) : c.type === 'nombre' ? Number(v) : v;
  }
  return out;
}

/** Message d'erreur de saisie, ou null. */
export function erreurRegistre(registre: Registre, saisie: Record<string, unknown>): string | null {
  const manquant = registre.champs.find((c) => c.obligatoire && (saisie[c.id] === undefined || saisie[c.id] === ''));
  if (manquant) return `${manquant.label} : obligatoire.`;
  const entier = registre.champs.find((c) => c.type === 'entier' && saisie[c.id] !== undefined && !Number.isInteger(saisie[c.id]));
  return entier ? `${entier.label} : un nombre entier.` : null;
}
