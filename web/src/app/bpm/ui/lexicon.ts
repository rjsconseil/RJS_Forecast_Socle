/**
 * Lexique des actions de BPM (docs/LORE-BPM.md) : un verbe, un sens. Tout libellé d'action
 * (bouton, lien d'action, action d'onglet) commence par un verbe de cette liste.
 */
export const BPM_VERBS = [
  'Ouvrir', 'Saisir', 'Régler', 'Créer', 'Modifier', 'Fixer', 'Attribuer', 'Répartir',
  'Accorder', 'Refuser', 'Avancer', 'Rattacher', 'Reporter', 'Clôturer', 'Rapprocher', 'Retirer',
] as const;

/** Verbes écartés : ils doublaient un verbe du lexique. La valeur dit lequel employer. */
export const BPM_RETIRED_VERBS: Record<string, string> = {
  Voir: 'Ouvrir', Consulter: 'Ouvrir', Examiner: 'Ouvrir', Gérer: 'Ouvrir', Piloter: 'Ouvrir',
  Traiter: 'Régler ou Ouvrir', Définir: 'Fixer', Ajuster: 'Fixer', Configurer: 'Fixer',
  Budgéter: 'Attribuer', Financer: 'Attribuer', Décider: 'Accorder ou Refuser', 'Faire avancer': 'Avancer',
  'Saisir une charge': 'Saisir une dépense',
};
