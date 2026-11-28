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
  role: 'Role', personne: 'Person', contact: 'Contact', numero: 'No.', nom: 'Name', type: 'Type', statut: 'Status',
  debutPrevu: 'Planned start', finPrevue: 'Planned end', intitule: 'Title', probabilite: 'Probability', impact: 'Impact',
  proprietaire: 'Owner', reponse: 'Response', gravite: 'Severity', priorite: 'Priority', decision: 'Decision',
  methode: 'Method', responsable: 'Responsible', prevuLe: 'Planned on', faitLe: 'Done on', resultat: 'Result',
  date: 'Date', contenu: 'Content', processus: 'Process', version: 'Version', approuvePar: 'Approved by',
  approuveLe: 'Approved on', refCode: 'Product',
};
/** Libellés des valeurs de choix (le code reste stocké). */
export const VALEURS: Record<string, string> = {
  'a-faire': 'To do', brouillon: 'Draft', approuve: 'Approved', 'a-venir': 'Upcoming', 'en-cours': 'In progress', close: 'Closed',
  initiation: 'Initiation', livraison: 'Delivery', cloture: 'Closure', faible: 'Low', moyenne: 'Medium', moyen: 'Medium',
  forte: 'High', fort: 'High', ouvert: 'Open', clos: 'Closed', decide: 'Decided', 'demande-changement': 'Request for change',
  'hors-specification': 'Off-specification', probleme: 'Problem or concern', basse: 'Low', normale: 'Normal', haute: 'High',
  conforme: 'Pass', 'non-conforme': 'Fail', note: 'Note', lecon: 'Lesson', 'rapport-situation': 'Highlight Report',
  'rapport-point-controle': 'Checkpoint Report', 'rapport-fin-sequence': 'End Stage Report',
  'rapport-exception': 'Exception Report', 'rapport-fin-projet': 'End Project Report',
  executif: 'Executive', 'utilisateur-principal': 'Senior User', 'fournisseur-principal': 'Senior Supplier', 'assurance-projet': 'Project Assurance',
  'autorite-changement': 'Change Authority', 'chef-projet': 'Project Manager', 'support-projet': 'Project Support', 'chef-equipe': 'Team Manager',
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
    { theme: 'cas-affaire', collection: 'livrables', titre: 'Management products', aide: 'Created when the project file and each stage are opened: move them forward until they are approved.', champs: champs('livrables', ['refCode', 'processus', 'statut', 'version', 'approuvePar', 'approuveLe']), etat: 'statut', sansSaisie: true },
    { theme: 'organisation', collection: 'roles', titre: 'Project roles', aide: 'Who holds each role. A role can be shared by several people, and one person can hold several roles.', champs: champs('roles', ['role', 'personne', 'contact']), etat: null },
    { theme: 'qualite', collection: 'qualite', titre: 'Quality Register', aide: 'Planned quality activities and their results.', champs: champs('qualite', ['methode', 'responsable', 'prevuLe', 'faitLe', 'resultat']), etat: 'resultat' },
    { theme: 'plans', collection: 'etapes', titre: 'Management stages', aide: 'Opening a stage creates its Stage Plan, Highlight Report and End Stage Report.', champs: champs('etapes', ['numero', 'nom', 'type', 'statut', 'debutPrevu', 'finPrevue']), etat: 'statut', ouvreSequence: true },
    { theme: 'risque', collection: 'risques', titre: 'Risk Register', aide: 'Each risk with its probability, impact, response and owner.', champs: champs('risques', ['intitule', 'probabilite', 'impact', 'reponse', 'proprietaire', 'statut']), etat: 'statut' },
    { theme: 'changement', collection: 'problemes', titre: 'Issue Register', aide: 'Requests for change, off-specifications and problems, with their severity and the decision taken.', champs: champs('problemes', ['intitule', 'type', 'gravite', 'priorite', 'decision', 'statut']), etat: 'statut' },
    { theme: 'progression', collection: 'journalProjet', titre: 'Project log', aide: 'Dated notes, lessons and reports.', champs: champs('journalProjet', ['date', 'type', 'contenu']), etat: null },
  ];
}

export const registreDuTheme = (registres: readonly Registre[], theme: string | null | undefined): Registre | null => registres.find((r) => r.theme === theme) ?? null;

/** Valeur lisible d'un champ d'une ligne. */
export function valeurLisible(champ: ChampRegistre, ligne: LigneApplication, nomLivrable: (code: string) => string = (c) => c): string {
  const v = ligne[champ.id];
  if (v === null || v === undefined || v === '') return '—';
  if (champ.id === 'refCode') return nomLivrable(String(v));
  if (champ.type === 'choix' || champ.id === 'role') return VALEURS[String(v)] ?? String(v);
  if (champ.type === 'booleen') return v ? 'Yes' : 'No';
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
  // Une ligne nouvelle part du premier état du registre (ouvert, à faire, à venir…).
  const etat = registre.champs.find((c) => c.id === registre.etat);
  if (etat && out[etat.id] === undefined && etat.valeurs.length) out[etat.id] = etat.valeurs[0];
  return out;
}

/** Message d'erreur de saisie, ou null. */
export function erreurRegistre(registre: Registre, saisie: Record<string, unknown>): string | null {
  const manquant = registre.champs.find((c) => c.obligatoire && (saisie[c.id] === undefined || saisie[c.id] === ''));
  if (manquant) return `${manquant.label} is required.`;
  const entier = registre.champs.find((c) => c.type === 'entier' && saisie[c.id] !== undefined && !Number.isInteger(saisie[c.id]));
  return entier ? `${entier.label} must be a whole number.` : null;
}
