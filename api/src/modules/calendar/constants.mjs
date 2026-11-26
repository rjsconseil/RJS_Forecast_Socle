// Calendrier : constantes de la configuration et petits contrôles de forme, partagés par la validation et le moteur.

export const TONES = ['bleu', 'indigo', 'violet', 'cyan', 'sarcelle', 'vert', 'ambre', 'orange', 'rouge', 'rose', 'ardoise'];
export const MARKERS = { debut: 'start', echeance: 'due', ponctuel: 'point' };
export const VIEWS = { semaine: 'week', mois: 'month', annee: 'year' };
export const FORMATS = ['texte', 'date', 'heures', 'montant', 'montantSigne', 'nombre', 'pourcentage'];
export const CADENCES = ['daily', 'weekly', 'monthly', 'yearly'];
export const INDICATORS = {
  elements: { label: 'Éléments', description: 'Objets distincts du jour, par nature (projets, tâches, opérations…).' },
  dates: { label: 'Dates', description: 'Débuts et dates prévues face aux échéances du jour.' },
  suivi: { label: 'Suivi', description: 'Repères à suivre face aux repères terminés.' },
  flux: { label: 'Flux', description: 'Montant des entrées et des sorties du jour.' },
  solde: { label: 'Solde', description: 'Entrées moins sorties du jour.' },
};
export const MAX_WINDOW_DAYS = 400;

/**
 * Formats d'affichage d'un événement : une disposition et les champs montrés, dans l'ordre. Trois formats sont
 * livrés ; une configuration peut en ajouter (`formats`) et chaque personne peut créer les siens côté site.
 * Un format créé s'appelle par son identifiant exactement comme un format livré.
 */
export const LAYOUTS = ['ligne', 'deux-lignes', 'pastille'];
export const FORMAT_FIELDS = ['amount', 'total', 'type', 'status', 'group'];
export const BUILT_IN_FORMATS = [
  { id: 'standard', label: 'Standard', layout: 'ligne', fields: ['amount', 'total'], perCell: null, builtIn: true },
  { id: 'compact', label: 'Compact', layout: 'pastille', fields: [], perCell: 4, builtIn: true },
  { id: 'detaille', label: 'Détaillé', layout: 'deux-lignes', fields: ['amount', 'total', 'status', 'group', 'type'], perCell: 2, builtIn: true },
];
export const FORMAT_ID = /^[a-z0-9-]+$/;
/** Limite de sources branchées en plus de celles de la configuration (garde-fou de lecture). */
export const MAX_PLUGGED = 40;
export const MAX_OWN_FORMATS = 20;
export const OWN_FORMAT_ID = /^perso-[a-z0-9-]{1,40}$/;

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const isText = (v) => typeof v === 'string' && v.trim().length > 0;
export const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
