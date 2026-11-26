/** Repères BPM : des liens de travail entre les pages, complémentaires au plan de navigation. */
export interface BpmCompanionLink { label: string; path: string; period?: boolean; query?: Record<string, string>; fragment?: string }
export interface BpmCompanion { phase: string; scope: string; purpose: string; links: BpmCompanionLink[] }
const link = (label: string, path: string, period = false, fragment?: string): BpmCompanionLink => ({ label, path, period, fragment });
const register = link('Retrouver les flux', '/tableau-de-bord/entrees', true);
const cycle = link('Suivre le cycle', '/projet-de-vie/cloture', true);
const wealth = link('Suivre le patrimoine', '/vision', false, 'wealth-project-flows');
const projects = link('Ouvrir les projets', '/projet-de-vie/projets');
const due = link('Régler les échéances', '/projet-de-vie/echeances', true);
const funding = link('Préparer les enveloppes', '/projet-de-vie/financement');
const forecast = link('Anticiper les prochains cycles', '/meteo/previsions', false, 'bpm-outlook');
const companion = (phase: string, scope: string, purpose: string, ...links: BpmCompanionLink[]): BpmCompanion => ({ phase, scope, purpose, links });

export const BPM_COMPANIONS: Record<string, BpmCompanion> = {
  '/meteo': companion('Observer', 'Les 3 sections de votre projet de vie', 'Repérez les alertes, puis rejoignez directement leur outil de résolution.', cycle, projects, wealth),
  '/meteo/projet-de-vie': companion('Observer', '01 · Budget et cycles', 'Les dépenses du quotidien et les flux de projets partagent le même cycle.', due, cycle),
  '/meteo/gestion-de-projet': companion('Observer', '02 · Projets et tâches', 'Un projet se prépare par son enveloppe ; ses tâches portent les achats et les gains.', funding, link('Débloquer les tâches', '/app/taches', false)),
  '/meteo/patrimoine': companion('Observer', '03 · Stock et avenir', 'Le patrimoine cumule les résultats clos et les mouvements qui lui sont directement imputés.', wealth, forecast),
  '/meteo/previsions': companion('Anticiper', 'Échéances connues · hypothèses explicites', 'Les prévisions utilisent les mouvements annoncés. Enveloppes et parts ne sont pas des dépenses.', due, link('Replanifier au calendrier', '/calendrier-budget')),
  '/meteo/tendances': companion('Comprendre', 'Historique des cycles', 'Comparez les résultats des cycles puis ajustez le budget qui revient.', link('Ouvrir les bilans', '/projet-de-vie/bilans'), link('Ajuster le budget type', '/projet-de-vie/budget-type')),
  '/meteo/lecture': companion('Comprendre', 'Une règle pour toutes les sections', 'Chaque alerte renvoie aux chiffres et à l’action qui permettent de la traiter.', link('Revenir à la météo', '/meteo'), forecast),
  '/tableau-de-bord': companion('Comprendre', 'Réalisé et prévu du cycle consulté', 'Le réalisé comprend uniquement les flux validés ; les projets restent identifiables dans leur cycle d’imputation.', cycle, forecast),
  '/tableau-de-bord/entrees': companion('Vérifier', 'Flux du cycle consulté', 'Retrouvez chaque origine. Une trace d’annonce ou de paiement ne vaut pas une seconde charge.', cycle, wealth),
  '/tableau-de-bord/rapprochement': companion('Vérifier', 'Dates bancaires et dates budgétaires', 'Rapprochez le paiement avec la banque et l’imputation avec le cycle, puis clôturez.', register, cycle),
  '/projet-de-vie': companion('Conduire', '01 · Le budget de votre projet de vie', 'Sécurisez les dépenses indispensables, arbitrez le quotidien et anticipez les achats des projets.', forecast, register),
  '/projet-de-vie/cycle': companion('Suivre', 'Budget du cycle consulté', 'Les entrées et dépenses validées déterminent le solde réalisé. Les échéances ouvertes alimentent la prévision.', due, cycle),
  '/projet-de-vie/charges-indispensables': companion('Régler', 'Dépenses prioritaires', 'Les retards et les prochaines échéances indiquent les paiements à traiter en premier.', due, link('Ajuster les récurrences', '/projet-de-vie/budget-type')),
  '/projet-de-vie/charges-courantes': companion('Ajuster', 'Budget du quotidien', 'Le disponible tient compte des provisions et de l’épargne visée pour le cycle.', link('Consulter les plafonds', '/plafonds', true), forecast),
  '/projet-de-vie/projets-finances': companion('Suivre', 'Enveloppes par projet', 'Les montants réglés depuis l’attribution et les flux du cycle éclairent deux périodes différentes.', funding, projects),
  '/projet-de-vie/patrimoine': companion('Construire', 'Stock et effet du cycle', 'Les clôtures et les mouvements imputés au patrimoine font évoluer le stock.', link('Consulter les bilans', '/projet-de-vie/bilans', true), wealth),
  '/projet-de-vie/echeances': companion('Valider', 'Paiements et encaissements attendus', 'Vérifiez le montant, la date réelle et la destination avant de valider chaque flux.', register, forecast),
  '/projet-de-vie/budget-type': companion('Préparer', 'Récurrences · aucun paiement automatique', 'Préparez les revenus et charges réguliers ; chaque échéance reste à valider.', due, link('Fixer les plafonds', '/plafonds')),
  '/projet-de-vie/cloture': companion('Clôturer', 'Cycle consulté · résultat versé une seule fois', 'Contrôlez les imputations des projets et rapprochez les paiements avant de transférer le résultat au patrimoine.', link('Rapprocher avec la banque', '/tableau-de-bord/rapprochement', true), wealth),
  '/projet-de-vie/bilans': companion('Comprendre', 'Cycles clos et traces conservées', 'Chaque bilan distingue le résultat du cycle, les projets et les prélèvements directs sur le patrimoine.', cycle, wealth),
  '/app/reglages/cycle': companion('Préparer', 'Bornes du cycle budgétaire', 'L’ancrage détermine à quel cycle appartient une date, indépendamment du mois civil.', cycle, register),
  '/calendrier-budget': companion('Planifier', 'Dates annoncées et règlements', 'Déplacer une échéance change sa prévision ; seule la validation décide de son imputation.', due, forecast),
  '/calendrier-budget/agenda': companion('Planifier', 'Événements du projet de vie', 'Ouvrez l’événement pour retrouver son opération, sa tâche ou son cycle.', due, register),
  '/plafonds': companion('Cadrer', 'Postes du budget de vie', 'Les plafonds guident vos arbitrages. Les prélèvements directs sur le patrimoine restent séparés.', register, link('Préparer les récurrences', '/projet-de-vie/budget-type')),
  '/app/reglages/postes': companion('Organiser', 'Postes de dépenses et sources de revenus', 'Les mêmes postes servent aux dépenses du quotidien et aux achats des tâches.', link('Fixer leurs plafonds', '/plafonds'), register),
  '/projet-de-vie/projets': companion('Réaliser', '02 · Tous les projets de la vie', 'Attribuez une enveloppe, répartissez-la sur les tâches, puis validez leurs dépenses et leurs gains.', cycle, wealth),
  '/projet-de-vie/financement': companion('Préparer', 'Enveloppes et parts · sans débit', 'Une attribution réserve des moyens. La destination financière se choisit sur chaque flux de tâche.', link('Répartir sur les tâches', '/app/taches'), forecast),
  '/app/taches': companion('Avancer', 'Tâches de tous les projets', 'Rattachez la tâche, accordez sa part, puis saisissez son temps et ses achats.', projects, funding),
  '/app/taches/rattacher': companion('Organiser', 'Tâches disponibles', 'Rattacher une tâche prépare le travail ; attribuez ensuite sa part avant de régler ses achats.', projects, link('Ouvrir les tâches', '/app/taches')),
  '/app/gestion-projet/planning': companion('Planifier', 'Travail et échéances des projets', 'Reliez la date d’une tâche à ses achats pour anticiper le cycle ou le stock qui les portera.', link('Ouvrir les tâches', '/app/taches'), forecast),
  '/app/gestion-projet/planning/agenda': companion('Planifier', 'Événements des projets', 'Replanifiez le travail et vérifiez les échéances financières correspondantes.', projects, forecast),
  '/vision': companion('Construire', '03 · Stock cumulé, sans remise à zéro', 'Les résultats clos alimentent le stock ; les achats et gains imputés au patrimoine le font évoluer directement.', cycle, forecast),
  '/vision/projection': companion('Anticiper', 'Scénario à long terme', 'La projection est une hypothèse. Comparez-la aux échéances déjà annoncées pour les prochains cycles.', forecast, wealth),
  '/vision/reperes': companion('Cadrer', 'Objectifs d’épargne · aucun mouvement', 'Un objectif fixe un cap ; il ne réserve ni ne prélève d’argent.', cycle, wealth),
  '/app/reglages/patrimoine': companion('Préparer', 'Stock de départ et date d’ouverture', 'Le stock initial est le point de départ. Les cycles clos et les flux validés construisent la suite.', wealth, link('Ouvrir les bilans', '/projet-de-vie/bilans')),
  '/app/gestion-projet/nouveau': companion('Préparer', 'Projet de la vie', 'L’enveloppe prépare les moyens. Créez ensuite les tâches qui porteront les achats.', projects, funding),
  '/app/taches/nouvelle': companion('Préparer', 'Tâche de projet', 'Une tâche peut attendre son rattachement ; ses achats nécessitent une part de budget.', link('Rattacher les tâches', '/app/taches/rattacher'), projects),
};

export function bpmCompanion(path: string): BpmCompanion | null {
  const clean = path.split(/[?#]/)[0].replace(/\/$/, '');
  if (BPM_COMPANIONS[clean]) return BPM_COMPANIONS[clean];
  if (/^\/app\/gestion-projet\/[^/]+(?:\/(budget|taches))?$/.test(clean)) {
    return companion('Réaliser', 'Projet → tâches → flux validés', 'L’enveloppe et les parts ne débitent rien. Chaque achat de tâche est imputé au cycle choisi ou au patrimoine.', cycle, wealth);
  }
  if (clean.startsWith('/argent/postes/')) return companion('Vérifier', 'Détail d’un poste', 'Retrouvez les dépenses et leur origine avant d’ajuster le cadre.', register, link('Ajuster le plafond', '/plafonds/reglages', true));
  return null;
}

/** Les commandes ouvertes et filtres de l'écran ne voyagent pas vers une autre page. */
export function companionQuery(link: BpmCompanionLink, query: Record<string, string>): Record<string, string> {
  return { ...(link.period && /^\d{4}-\d{2}$/.test(query['period'] ?? '') ? { period: query['period'] } : {}), ...link.query };
}
