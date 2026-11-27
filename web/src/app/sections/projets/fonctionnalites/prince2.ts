/**
 * Fonctionnalités Mes projets · référentiel PRINCE2 (premier jet).
 * Les 7 thèmes, les 7 processus, les livrables (produits de management) et la séquence des choses à faire.
 * Données pures, sans écran ni appel au grand noyau : une brique réutilisable telle quelle par l'application
 * autonome Mes projets comme par une application hybride.
 * Les noms suivent PRINCE2 (6e édition, 2017) ; le nom anglais officiel accompagne chaque nom français pour la recherche.
 */

export type ProcessusId = 'SU' | 'DP' | 'IP' | 'CS' | 'MP' | 'SB' | 'CP';
export type ThemeId = 'cas-affaire' | 'organisation' | 'qualite' | 'plans' | 'risque' | 'changement' | 'progression';

export interface Livrable { id: string; nom: string; anglais: string }

/** Les produits de management de PRINCE2 (noms seulement). */
export const PRINCE2_LIVRABLES = {
  approcheBenefices: { id: 'approcheBenefices', nom: 'Approche de gestion des bénéfices', anglais: 'Benefits Management Approach' },
  casAffaire: { id: 'casAffaire', nom: 'Cas d’affaire', anglais: 'Business Case' },
  approcheChangements: { id: 'approcheChangements', nom: 'Approche de maîtrise des changements', anglais: 'Change Control Approach' },
  rapportPointControle: { id: 'rapportPointControle', nom: 'Rapport de point de contrôle', anglais: 'Checkpoint Report' },
  approcheCommunication: { id: 'approcheCommunication', nom: 'Approche de gestion de la communication', anglais: 'Communication Management Approach' },
  ficheConfiguration: { id: 'ficheConfiguration', nom: 'Fiche d’élément de configuration', anglais: 'Configuration Item Record' },
  journalQuotidien: { id: 'journalQuotidien', nom: 'Journal quotidien', anglais: 'Daily Log' },
  rapportFinProjet: { id: 'rapportFinProjet', nom: 'Rapport de fin de projet', anglais: 'End Project Report' },
  rapportFinSequence: { id: 'rapportFinSequence', nom: 'Rapport de fin de séquence', anglais: 'End Stage Report' },
  rapportException: { id: 'rapportException', nom: 'Rapport d’exception', anglais: 'Exception Report' },
  rapportSituation: { id: 'rapportSituation', nom: 'Rapport de situation', anglais: 'Highlight Report' },
  registreIncidences: { id: 'registreIncidences', nom: 'Registre des incidences', anglais: 'Issue Register' },
  rapportIncidence: { id: 'rapportIncidence', nom: 'Rapport d’incidence', anglais: 'Issue Report' },
  journalLecons: { id: 'journalLecons', nom: 'Journal des leçons', anglais: 'Lessons Log' },
  rapportLecons: { id: 'rapportLecons', nom: 'Rapport des leçons', anglais: 'Lessons Report' },
  planProjet: { id: 'planProjet', nom: 'Plan de projet', anglais: 'Project Plan' },
  planSequence: { id: 'planSequence', nom: 'Plan de séquence', anglais: 'Stage Plan' },
  planEquipe: { id: 'planEquipe', nom: 'Plan d’équipe', anglais: 'Team Plan' },
  planException: { id: 'planException', nom: 'Plan d’exception', anglais: 'Exception Plan' },
  descriptionProduit: { id: 'descriptionProduit', nom: 'Description de produit', anglais: 'Product Description' },
  etatProduits: { id: 'etatProduits', nom: 'État des produits', anglais: 'Product Status Account' },
  exposeProjet: { id: 'exposeProjet', nom: 'Exposé du projet', anglais: 'Project Brief' },
  documentationInitialisation: { id: 'documentationInitialisation', nom: 'Documentation d’initialisation du projet', anglais: 'Project Initiation Documentation' },
  descriptionProduitProjet: { id: 'descriptionProduitProjet', nom: 'Description du produit du projet', anglais: 'Project Product Description' },
  approcheQualite: { id: 'approcheQualite', nom: 'Approche de gestion de la qualité', anglais: 'Quality Management Approach' },
  registreQualite: { id: 'registreQualite', nom: 'Registre qualité', anglais: 'Quality Register' },
  approcheRisques: { id: 'approcheRisques', nom: 'Approche de gestion des risques', anglais: 'Risk Management Approach' },
  registreRisques: { id: 'registreRisques', nom: 'Registre des risques', anglais: 'Risk Register' },
  lotTravaux: { id: 'lotTravaux', nom: 'Lot de travaux', anglais: 'Work Package' },
} satisfies Record<string, Livrable>;
export type LivrableId = keyof typeof PRINCE2_LIVRABLES;

export interface Processus {
  id: ProcessusId;
  nom: string;
  anglais: string;
  /** Moment du projet où le processus intervient. */
  moment: string;
  /** Le processus en une phrase (sans entrer dans le détail de ses activités). */
  resume: string;
  livrables: LivrableId[];
}

/** Les 7 processus, dans l'ordre de la séquence. Diriger le projet couvre tout le projet, du lancement à la clôture. */
export const PRINCE2_PROCESSUS: Processus[] = [
  { id: 'SU', nom: 'Élaborer le projet', anglais: 'Starting up a Project', moment: 'Avant le projet',
    resume: 'Vérifier que le projet vaut la peine d’être initialisé : le mandat, l’équipe, l’approche et le plan de l’initialisation.',
    livrables: ['exposeProjet', 'descriptionProduitProjet', 'casAffaire', 'journalQuotidien', 'journalLecons', 'planSequence'] },
  { id: 'DP', nom: 'Diriger le projet', anglais: 'Directing a Project', moment: 'Tout le projet',
    resume: 'Le comité de pilotage autorise l’initialisation, le projet, chaque séquence et la clôture, et donne ses orientations.',
    livrables: ['exposeProjet', 'documentationInitialisation', 'planSequence', 'planException', 'rapportSituation', 'rapportException', 'rapportFinSequence', 'rapportFinProjet'] },
  { id: 'IP', nom: 'Initialiser le projet', anglais: 'Initiating a Project', moment: 'Séquence d’initialisation',
    resume: 'Poser les fondations : les approches de gestion, les contrôles, le plan de projet et le cas d’affaire détaillé.',
    livrables: ['approcheRisques', 'approcheChangements', 'approcheQualite', 'approcheCommunication', 'registreRisques', 'registreIncidences', 'registreQualite', 'ficheConfiguration', 'planProjet', 'casAffaire', 'approcheBenefices', 'documentationInitialisation'] },
  { id: 'CS', nom: 'Contrôler une séquence', anglais: 'Controlling a Stage', moment: 'Chaque séquence de livraison',
    resume: 'Confier le travail, en suivre l’avancement, traiter les incidences et les risques, rendre compte au comité.',
    livrables: ['lotTravaux', 'rapportSituation', 'rapportIncidence', 'registreIncidences', 'registreRisques', 'rapportException', 'etatProduits'] },
  { id: 'MP', nom: 'Gérer la livraison des produits', anglais: 'Managing Product Delivery', moment: 'Chaque séquence de livraison',
    resume: 'L’équipe accepte un lot de travaux, réalise les produits, en vérifie la qualité et les livre.',
    livrables: ['planEquipe', 'rapportPointControle', 'registreQualite', 'ficheConfiguration'] },
  { id: 'SB', nom: 'Gérer une limite de séquence', anglais: 'Managing a Stage Boundary', moment: 'Fin de chaque séquence',
    resume: 'Faire le bilan de la séquence, préparer la suivante (ou un plan d’exception) et mettre à jour le plan et le cas d’affaire.',
    livrables: ['rapportFinSequence', 'planSequence', 'planException', 'planProjet', 'casAffaire', 'rapportLecons'] },
  { id: 'CP', nom: 'Clôturer le projet', anglais: 'Closing a Project', moment: 'Dernière séquence',
    resume: 'Faire accepter le produit du projet, évaluer le projet, recommander les actions de suivi et libérer l’équipe.',
    livrables: ['rapportFinProjet', 'rapportLecons', 'approcheBenefices', 'ficheConfiguration', 'etatProduits'] },
];

/** Ordre de la séquence : élaborer, initialiser, contrôler et livrer (à chaque séquence), passer la limite, clôturer. */
export const SEQUENCE: ProcessusId[] = ['SU', 'DP', 'IP', 'CS', 'MP', 'SB', 'CP'];

export interface UsageDuTheme {
  processus: ProcessusId;
  /** Ce que l'on fait pour ce thème dans ce processus (une ligne). */
  action: string;
  livrables: LivrableId[];
}

export interface Theme {
  id: ThemeId;
  numero: number;
  nom: string;
  anglais: string;
  /** La question à laquelle le thème répond. */
  question: string;
  but: string;
  livrables: LivrableId[];
  usages: UsageDuTheme[];
}

/** Les 7 thèmes : ce qu'il faut traiter tout au long du projet. */
export const PRINCE2_THEMES: Theme[] = [
  { id: 'cas-affaire', numero: 1, nom: 'Cas d’affaire', anglais: 'Business Case', question: 'Pourquoi ?',
    but: 'Établir des mécanismes pour juger si le projet est (et reste) souhaitable, viable et réalisable, afin de soutenir la prise de décision sur la poursuite de l’investissement.',
    livrables: ['casAffaire', 'approcheBenefices'],
    usages: [
      { processus: 'SU', action: 'Esquisser le cas d’affaire à partir du mandat.', livrables: ['casAffaire', 'exposeProjet'] },
      { processus: 'DP', action: 'Vérifier que le projet reste justifié à chaque décision.', livrables: ['casAffaire'] },
      { processus: 'IP', action: 'Détailler le cas d’affaire et définir la gestion des bénéfices.', livrables: ['casAffaire', 'approcheBenefices'] },
      { processus: 'SB', action: 'Mettre à jour le cas d’affaire et les bénéfices à chaque fin de séquence.', livrables: ['casAffaire', 'approcheBenefices'] },
      { processus: 'CP', action: 'Confirmer les bénéfices obtenus et planifier la revue des bénéfices à venir.', livrables: ['approcheBenefices', 'rapportFinProjet'] },
    ] },
  { id: 'organisation', numero: 2, nom: 'Organisation', anglais: 'Organization', question: 'Qui ?',
    but: 'Définir et établir la structure de responsabilités et de redevabilité du projet : qui décide, qui pilote, qui réalise, et comment chacun communique.',
    livrables: ['approcheCommunication', 'exposeProjet', 'documentationInitialisation'],
    usages: [
      { processus: 'SU', action: 'Nommer l’exécutif et le chef de projet, concevoir l’équipe de gestion de projet.', livrables: ['exposeProjet'] },
      { processus: 'DP', action: 'Le comité de pilotage assume ses responsabilités de décision.', livrables: [] },
      { processus: 'IP', action: 'Définir l’approche de gestion de la communication.', livrables: ['approcheCommunication', 'documentationInitialisation'] },
      { processus: 'SB', action: 'Revoir l’équipe de gestion de projet pour la séquence suivante.', livrables: ['documentationInitialisation'] },
      { processus: 'CP', action: 'Libérer les ressources et dissoudre l’équipe du projet.', livrables: [] },
    ] },
  { id: 'qualite', numero: 3, nom: 'Qualité', anglais: 'Quality', question: 'Quoi ?',
    but: 'Définir et mettre en œuvre les moyens qui permettront au projet de créer et de vérifier des produits adaptés à leur usage.',
    livrables: ['descriptionProduitProjet', 'descriptionProduit', 'approcheQualite', 'registreQualite'],
    usages: [
      { processus: 'SU', action: 'Saisir les attentes qualité du client et la description du produit du projet.', livrables: ['descriptionProduitProjet'] },
      { processus: 'IP', action: 'Définir l’approche de gestion de la qualité et ouvrir le registre qualité.', livrables: ['approcheQualite', 'registreQualite'] },
      { processus: 'MP', action: 'Réaliser les contrôles qualité des produits et les consigner.', livrables: ['descriptionProduit', 'registreQualite'] },
      { processus: 'SB', action: 'Vérifier que les produits de la séquence sont approuvés.', livrables: ['registreQualite'] },
      { processus: 'CP', action: 'Obtenir l’acceptation du produit du projet.', livrables: ['descriptionProduitProjet'] },
    ] },
  { id: 'plans', numero: 4, nom: 'Plans', anglais: 'Plans', question: 'Comment ? Combien ? Quand ?',
    but: 'Faciliter la communication et le contrôle en définissant les moyens de livrer les produits : où, comment, par qui, quand et pour combien.',
    livrables: ['planProjet', 'planSequence', 'planEquipe', 'planException', 'descriptionProduit'],
    usages: [
      { processus: 'SU', action: 'Planifier la séquence d’initialisation.', livrables: ['planSequence'] },
      { processus: 'IP', action: 'Établir le plan de projet et ses descriptions de produits.', livrables: ['planProjet', 'descriptionProduit'] },
      { processus: 'MP', action: 'L’équipe établit son plan pour le lot de travaux (facultatif).', livrables: ['planEquipe'] },
      { processus: 'SB', action: 'Planifier la séquence suivante, ou produire un plan d’exception.', livrables: ['planSequence', 'planException', 'planProjet'] },
    ] },
  { id: 'risque', numero: 5, nom: 'Risque', anglais: 'Risk', question: 'Et si… ?',
    but: 'Identifier, évaluer et maîtriser l’incertitude, menaces comme opportunités, pour améliorer les chances de réussite du projet.',
    livrables: ['approcheRisques', 'registreRisques'],
    usages: [
      { processus: 'SU', action: 'Noter les premiers risques dans le journal quotidien.', livrables: ['journalQuotidien'] },
      { processus: 'IP', action: 'Définir l’approche de gestion des risques et ouvrir le registre des risques.', livrables: ['approcheRisques', 'registreRisques'] },
      { processus: 'CS', action: 'Surveiller les risques, en identifier de nouveaux, mettre en œuvre les réponses.', livrables: ['registreRisques'] },
      { processus: 'SB', action: 'Réévaluer les risques du projet avant la séquence suivante.', livrables: ['registreRisques'] },
      { processus: 'DP', action: 'Le comité arbitre les risques qui dépassent les tolérances.', livrables: ['rapportException'] },
    ] },
  { id: 'changement', numero: 6, nom: 'Changement', anglais: 'Change', question: 'Quel impact ?',
    but: 'Identifier, évaluer et maîtriser tout changement potentiel ou approuvé de la base de référence (les produits approuvés).',
    livrables: ['approcheChangements', 'ficheConfiguration', 'etatProduits', 'journalQuotidien', 'registreIncidences', 'rapportIncidence'],
    usages: [
      { processus: 'SU', action: 'Consigner les premières incidences dans le journal quotidien.', livrables: ['journalQuotidien'] },
      { processus: 'IP', action: 'Définir l’approche de maîtrise des changements et la gestion de configuration.', livrables: ['approcheChangements', 'registreIncidences', 'ficheConfiguration'] },
      { processus: 'CS', action: 'Saisir, examiner et traiter les incidences et les demandes de changement.', livrables: ['rapportIncidence', 'registreIncidences', 'etatProduits'] },
      { processus: 'MP', action: 'Tenir à jour les fiches de configuration des produits livrés.', livrables: ['ficheConfiguration'] },
      { processus: 'DP', action: 'Le comité décide des demandes de changement hors délégation.', livrables: ['rapportIncidence'] },
    ] },
  { id: 'progression', numero: 7, nom: 'Progression', anglais: 'Progress', question: 'Où en sommes-nous ? Où allons-nous ? Devons-nous continuer ?',
    but: 'Établir les mécanismes pour suivre et comparer le réalisé au prévu, prévoir les objectifs du projet et sa viabilité, et maîtriser les écarts inacceptables.',
    livrables: ['journalQuotidien', 'journalLecons', 'lotTravaux', 'rapportPointControle', 'rapportSituation', 'rapportFinSequence', 'rapportFinProjet', 'rapportException', 'rapportLecons'],
    usages: [
      { processus: 'DP', action: 'Fixer les tolérances et décider à chaque point de contrôle du comité.', livrables: ['rapportSituation', 'rapportException'] },
      { processus: 'CS', action: 'Autoriser les lots de travaux, suivre l’avancement, rendre compte au comité.', livrables: ['lotTravaux', 'rapportSituation', 'rapportException'] },
      { processus: 'MP', action: 'L’équipe rend compte de son avancement au chef de projet.', livrables: ['rapportPointControle'] },
      { processus: 'SB', action: 'Faire le bilan de la séquence et en tirer les leçons.', livrables: ['rapportFinSequence', 'rapportLecons'] },
      { processus: 'CP', action: 'Évaluer le projet et transmettre les leçons apprises.', livrables: ['rapportFinProjet', 'rapportLecons'] },
    ] },
];

const ordre = (p: ProcessusId) => SEQUENCE.indexOf(p);

export const themePrince2 = (id: string | null | undefined): Theme | null => PRINCE2_THEMES.find((t) => t.id === id) ?? null;
export const processusPrince2 = (id: ProcessusId): Processus => PRINCE2_PROCESSUS.find((p) => p.id === id)!;
export const livrable = (id: LivrableId): Livrable => PRINCE2_LIVRABLES[id];

/** Les processus associés à un thème, dans l'ordre de la séquence, avec ce que le thème y demande. */
export function processusDuTheme(id: ThemeId) {
  const theme = themePrince2(id);
  if (!theme) return [];
  return [...theme.usages].sort((a, b) => ordre(a.processus) - ordre(b.processus))
    .map((u, i) => ({ etape: i + 1, processus: processusPrince2(u.processus), action: u.action, livrables: u.livrables.map(livrable) }));
}

/** Les livrables d'un thème : les siens, puis ceux que ses processus produisent ou mettent à jour pour lui, sans doublon. */
export function livrablesDuTheme(id: ThemeId): Livrable[] {
  const theme = themePrince2(id);
  if (!theme) return [];
  return [...new Set<LivrableId>([...theme.livrables, ...theme.usages.flatMap((u) => u.livrables)])].map(livrable);
}

export const livrablesDuProcessus = (id: ProcessusId): Livrable[] => processusPrince2(id).livrables.map(livrable);

/** Les thèmes qui s'appliquent dans un processus (pour une future page des processus). */
export const themesDuProcessus = (id: ProcessusId): Theme[] => PRINCE2_THEMES.filter((t) => t.usages.some((u) => u.processus === id));

/**
 * Repère PRINCE2 indicatif d'un projet, déduit de son état dans le grand noyau (aucune donnée nouvelle) :
 * pas encore de tâche, élaborer ; prévu avec des tâches, initialiser ; en cours, contrôler une séquence ;
 * en pause ou à reprendre, gérer une limite de séquence ; à finir, clôturer ; terminé, clos.
 */
export function reperePrince2(projet: { status: string; taskCount: number }): { processus: ProcessusId | null; label: string } {
  if (projet.status === 'done') return { processus: null, label: 'Projet clos' };
  if (projet.status === 'toFinish') return { processus: 'CP', label: processusPrince2('CP').nom };
  if (['paused', 'onHold', 'toResume'].includes(projet.status)) return { processus: 'SB', label: processusPrince2('SB').nom };
  if (projet.status === 'active') return { processus: 'CS', label: processusPrince2('CS').nom };
  return projet.taskCount ? { processus: 'IP', label: processusPrince2('IP').nom } : { processus: 'SU', label: processusPrince2('SU').nom };
}
