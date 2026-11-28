/**
 * Fonctionnalités Mes projets · référentiel PRINCE2 (premier jet).
 * Les 7 thèmes, les 7 processus, les livrables (produits de management) et la séquence des choses à faire.
 * Données pures, sans écran ni appel au grand noyau : une brique réutilisable telle quelle par l'application
 * autonome Mes projets comme par une application hybride.
 * Les libellés sont en anglais, langue d'origine de PRINCE2 (6e édition, 2017) : `nom` et `anglais` portent le nom officiel.
 */

export type ProcessusId = 'SU' | 'DP' | 'IP' | 'CS' | 'MP' | 'SB' | 'CP';
export type ThemeId = 'cas-affaire' | 'organisation' | 'qualite' | 'plans' | 'risque' | 'changement' | 'progression';

export interface Livrable { id: string; nom: string; anglais: string }

/** Les produits de management de PRINCE2 (noms seulement). */
export const PRINCE2_LIVRABLES = {
  approcheBenefices: { id: 'approcheBenefices', nom: 'Benefits Management Approach', anglais: 'Benefits Management Approach' },
  casAffaire: { id: 'casAffaire', nom: 'Business Case', anglais: 'Business Case' },
  approcheChangements: { id: 'approcheChangements', nom: 'Change Control Approach', anglais: 'Change Control Approach' },
  rapportPointControle: { id: 'rapportPointControle', nom: 'Checkpoint Report', anglais: 'Checkpoint Report' },
  approcheCommunication: { id: 'approcheCommunication', nom: 'Communication Management Approach', anglais: 'Communication Management Approach' },
  ficheConfiguration: { id: 'ficheConfiguration', nom: 'Configuration Item Record', anglais: 'Configuration Item Record' },
  journalQuotidien: { id: 'journalQuotidien', nom: 'Daily Log', anglais: 'Daily Log' },
  rapportFinProjet: { id: 'rapportFinProjet', nom: 'End Project Report', anglais: 'End Project Report' },
  rapportFinSequence: { id: 'rapportFinSequence', nom: 'End Stage Report', anglais: 'End Stage Report' },
  rapportException: { id: 'rapportException', nom: 'Exception Report', anglais: 'Exception Report' },
  rapportSituation: { id: 'rapportSituation', nom: 'Highlight Report', anglais: 'Highlight Report' },
  registreIncidences: { id: 'registreIncidences', nom: 'Issue Register', anglais: 'Issue Register' },
  rapportIncidence: { id: 'rapportIncidence', nom: 'Issue Report', anglais: 'Issue Report' },
  journalLecons: { id: 'journalLecons', nom: 'Lessons Log', anglais: 'Lessons Log' },
  rapportLecons: { id: 'rapportLecons', nom: 'Lessons Report', anglais: 'Lessons Report' },
  planProjet: { id: 'planProjet', nom: 'Project Plan', anglais: 'Project Plan' },
  planSequence: { id: 'planSequence', nom: 'Stage Plan', anglais: 'Stage Plan' },
  planEquipe: { id: 'planEquipe', nom: 'Team Plan', anglais: 'Team Plan' },
  planException: { id: 'planException', nom: 'Exception Plan', anglais: 'Exception Plan' },
  descriptionProduit: { id: 'descriptionProduit', nom: 'Product Description', anglais: 'Product Description' },
  etatProduits: { id: 'etatProduits', nom: 'Product Status Account', anglais: 'Product Status Account' },
  exposeProjet: { id: 'exposeProjet', nom: 'Project Brief', anglais: 'Project Brief' },
  documentationInitialisation: { id: 'documentationInitialisation', nom: 'Project Initiation Documentation', anglais: 'Project Initiation Documentation' },
  descriptionProduitProjet: { id: 'descriptionProduitProjet', nom: 'Project Product Description', anglais: 'Project Product Description' },
  approcheQualite: { id: 'approcheQualite', nom: 'Quality Management Approach', anglais: 'Quality Management Approach' },
  registreQualite: { id: 'registreQualite', nom: 'Quality Register', anglais: 'Quality Register' },
  approcheRisques: { id: 'approcheRisques', nom: 'Risk Management Approach', anglais: 'Risk Management Approach' },
  registreRisques: { id: 'registreRisques', nom: 'Risk Register', anglais: 'Risk Register' },
  lotTravaux: { id: 'lotTravaux', nom: 'Work Package', anglais: 'Work Package' },
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
  { id: 'SU', nom: 'Starting up a Project', anglais: 'Starting up a Project', moment: 'Pre-project',
    resume: 'Check that the project is worth initiating: the mandate, the team, the approach and the plan for initiation.',
    livrables: ['exposeProjet', 'descriptionProduitProjet', 'casAffaire', 'journalQuotidien', 'journalLecons', 'planSequence'] },
  { id: 'DP', nom: 'Directing a Project', anglais: 'Directing a Project', moment: 'Whole project',
    resume: 'The Project Board authorizes initiation, the project, each stage and closure, and gives direction.',
    livrables: ['exposeProjet', 'documentationInitialisation', 'planSequence', 'planException', 'rapportSituation', 'rapportException', 'rapportFinSequence', 'rapportFinProjet'] },
  { id: 'IP', nom: 'Initiating a Project', anglais: 'Initiating a Project', moment: 'Initiation stage',
    resume: 'Lay the foundations: the management approaches, the controls, the Project Plan and the detailed Business Case.',
    livrables: ['approcheRisques', 'approcheChangements', 'approcheQualite', 'approcheCommunication', 'registreRisques', 'registreIncidences', 'registreQualite', 'ficheConfiguration', 'planProjet', 'casAffaire', 'approcheBenefices', 'documentationInitialisation'] },
  { id: 'CS', nom: 'Controlling a Stage', anglais: 'Controlling a Stage', moment: 'Each delivery stage',
    resume: 'Assign the work, monitor progress, handle issues and risks, report to the Project Board.',
    livrables: ['lotTravaux', 'rapportSituation', 'rapportIncidence', 'registreIncidences', 'registreRisques', 'rapportException', 'etatProduits'] },
  { id: 'MP', nom: 'Managing Product Delivery', anglais: 'Managing Product Delivery', moment: 'Each delivery stage',
    resume: 'The team accepts a Work Package, builds the products, checks their quality and delivers them.',
    livrables: ['planEquipe', 'rapportPointControle', 'registreQualite', 'ficheConfiguration'] },
  { id: 'SB', nom: 'Managing a Stage Boundary', anglais: 'Managing a Stage Boundary', moment: 'End of each stage',
    resume: 'Review the stage, plan the next one (or an Exception Plan) and update the Project Plan and Business Case.',
    livrables: ['rapportFinSequence', 'planSequence', 'planException', 'planProjet', 'casAffaire', 'rapportLecons'] },
  { id: 'CP', nom: 'Closing a Project', anglais: 'Closing a Project', moment: 'Final stage',
    resume: 'Get the project product accepted, evaluate the project, recommend follow-on actions and release the team.',
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
  { id: 'cas-affaire', numero: 1, nom: 'Business Case', anglais: 'Business Case', question: 'Why?',
    but: 'Establish mechanisms to judge whether the project is (and remains) desirable, viable and achievable, as a means to support decision-making in its (continued) investment.',
    livrables: ['casAffaire', 'approcheBenefices'],
    usages: [
      { processus: 'SU', action: 'Outline the Business Case from the project mandate.', livrables: ['casAffaire', 'exposeProjet'] },
      { processus: 'DP', action: 'Check that the project remains justified at every decision.', livrables: ['casAffaire'] },
      { processus: 'IP', action: 'Refine the Business Case and define how benefits will be managed.', livrables: ['casAffaire', 'approcheBenefices'] },
      { processus: 'SB', action: 'Update the Business Case and the benefits at the end of each stage.', livrables: ['casAffaire', 'approcheBenefices'] },
      { processus: 'CP', action: 'Confirm the benefits achieved and plan the post-project benefits review.', livrables: ['approcheBenefices', 'rapportFinProjet'] },
    ] },
  { id: 'organisation', numero: 2, nom: 'Organization', anglais: 'Organization', question: 'Who?',
    but: 'Define and establish the project’s structure of accountability and responsibilities: who directs, who manages, who delivers, and how everyone communicates.',
    livrables: ['approcheCommunication', 'exposeProjet', 'documentationInitialisation'],
    usages: [
      { processus: 'SU', action: 'Appoint the Executive and the Project Manager, design the project management team.', livrables: ['exposeProjet'] },
      { processus: 'DP', action: 'The Project Board carries out its decision-making responsibilities.', livrables: [] },
      { processus: 'IP', action: 'Define the Communication Management Approach.', livrables: ['approcheCommunication', 'documentationInitialisation'] },
      { processus: 'SB', action: 'Review the project management team for the next stage.', livrables: ['documentationInitialisation'] },
      { processus: 'CP', action: 'Release the resources and disband the project team.', livrables: [] },
    ] },
  { id: 'qualite', numero: 3, nom: 'Quality', anglais: 'Quality', question: 'What?',
    but: 'Define and implement the means by which the project will create and verify products that are fit for purpose.',
    livrables: ['descriptionProduitProjet', 'descriptionProduit', 'approcheQualite', 'registreQualite'],
    usages: [
      { processus: 'SU', action: 'Capture the customer’s quality expectations and the Project Product Description.', livrables: ['descriptionProduitProjet'] },
      { processus: 'IP', action: 'Define the Quality Management Approach and open the Quality Register.', livrables: ['approcheQualite', 'registreQualite'] },
      { processus: 'MP', action: 'Carry out the quality checks on the products and record them.', livrables: ['descriptionProduit', 'registreQualite'] },
      { processus: 'SB', action: 'Check that the stage’s products are approved.', livrables: ['registreQualite'] },
      { processus: 'CP', action: 'Obtain acceptance of the project product.', livrables: ['descriptionProduitProjet'] },
    ] },
  { id: 'plans', numero: 4, nom: 'Plans', anglais: 'Plans', question: 'How? How much? When?',
    but: 'Facilitate communication and control by defining the means of delivering the products: where, how, by whom, when and for how much.',
    livrables: ['planProjet', 'planSequence', 'planEquipe', 'planException', 'descriptionProduit'],
    usages: [
      { processus: 'SU', action: 'Plan the initiation stage.', livrables: ['planSequence'] },
      { processus: 'IP', action: 'Create the Project Plan and its Product Descriptions.', livrables: ['planProjet', 'descriptionProduit'] },
      { processus: 'MP', action: 'The team creates its plan for the Work Package (optional).', livrables: ['planEquipe'] },
      { processus: 'SB', action: 'Plan the next stage, or produce an Exception Plan.', livrables: ['planSequence', 'planException', 'planProjet'] },
    ] },
  { id: 'risque', numero: 5, nom: 'Risk', anglais: 'Risk', question: 'What if?',
    but: 'Identify, assess and control uncertainty, threats and opportunities alike, to improve the project’s ability to succeed.',
    livrables: ['approcheRisques', 'registreRisques'],
    usages: [
      { processus: 'SU', action: 'Record the first risks in the Daily Log.', livrables: ['journalQuotidien'] },
      { processus: 'IP', action: 'Define the Risk Management Approach and open the Risk Register.', livrables: ['approcheRisques', 'registreRisques'] },
      { processus: 'CS', action: 'Monitor risks, identify new ones, implement the responses.', livrables: ['registreRisques'] },
      { processus: 'SB', action: 'Reassess the project risks before the next stage.', livrables: ['registreRisques'] },
      { processus: 'DP', action: 'The Project Board decides on risks that exceed tolerances.', livrables: ['rapportException'] },
    ] },
  { id: 'changement', numero: 6, nom: 'Change', anglais: 'Change', question: 'What’s the impact?',
    but: 'Identify, assess and control any potential and approved changes to the project baselines (the approved products).',
    livrables: ['approcheChangements', 'ficheConfiguration', 'etatProduits', 'journalQuotidien', 'registreIncidences', 'rapportIncidence'],
    usages: [
      { processus: 'SU', action: 'Record the first issues in the Daily Log.', livrables: ['journalQuotidien'] },
      { processus: 'IP', action: 'Define the Change Control Approach and configuration management.', livrables: ['approcheChangements', 'registreIncidences', 'ficheConfiguration'] },
      { processus: 'CS', action: 'Capture, examine and handle issues and requests for change.', livrables: ['rapportIncidence', 'registreIncidences', 'etatProduits'] },
      { processus: 'MP', action: 'Keep the Configuration Item Records of delivered products up to date.', livrables: ['ficheConfiguration'] },
      { processus: 'DP', action: 'The Project Board decides on requests for change beyond delegated authority.', livrables: ['rapportIncidence'] },
    ] },
  { id: 'progression', numero: 7, nom: 'Progress', anglais: 'Progress', question: 'Where are we now? Where are we going? Should we carry on?',
    but: 'Establish mechanisms to monitor and compare actual achievements against those planned, forecast the project’s objectives and viability, and control any unacceptable deviations.',
    livrables: ['journalQuotidien', 'journalLecons', 'lotTravaux', 'rapportPointControle', 'rapportSituation', 'rapportFinSequence', 'rapportFinProjet', 'rapportException', 'rapportLecons'],
    usages: [
      { processus: 'DP', action: 'Set tolerances and decide at each Project Board control point.', livrables: ['rapportSituation', 'rapportException'] },
      { processus: 'CS', action: 'Authorize Work Packages, monitor progress, report to the Project Board.', livrables: ['lotTravaux', 'rapportSituation', 'rapportException'] },
      { processus: 'MP', action: 'The team reports its progress to the Project Manager.', livrables: ['rapportPointControle'] },
      { processus: 'SB', action: 'Review the stage and capture its lessons.', livrables: ['rapportFinSequence', 'rapportLecons'] },
      { processus: 'CP', action: 'Evaluate the project and pass on the lessons learned.', livrables: ['rapportFinProjet', 'rapportLecons'] },
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
  if (projet.status === 'done') return { processus: null, label: 'Project closed' };
  if (projet.status === 'toFinish') return { processus: 'CP', label: processusPrince2('CP').nom };
  if (['paused', 'onHold', 'toResume'].includes(projet.status)) return { processus: 'SB', label: processusPrince2('SB').nom };
  if (projet.status === 'active') return { processus: 'CS', label: processusPrince2('CS').nom };
  return projet.taskCount ? { processus: 'IP', label: processusPrince2('IP').nom } : { processus: 'SU', label: processusPrince2('SU').nom };
}
