import type { PageGuidance } from '../shared/page-guidance';

// Le lien « suivant » reste dans la partie (son parcours) ; les ponts du bandeau mènent aux deux autres parties.
function guide(lead: string, nextLabel: string, nextPath: string): PageGuidance {
  return { lead, nextLabel, nextPath: '/bpm-astra/' + nextPath };
}

export const astraGuidance: Record<string, PageGuidance> = {
  // Mon quotidien : enregistrer, situer, prévoir, limiter.
  '': guide('Le cycle en cours : ce qui est reçu, dépensé et encore à régler, projets compris.', 'Ouvrir les mouvements', 'mouvements'),
  mouvements: guide('Le salaire, les dépenses du quotidien et les règlements des projets, rangés sous les mêmes postes. Ouvrez une ligne pour la régler ou la corriger.', 'Situer les prochains règlements au calendrier', 'calendrier'),
  'mouvements/echeances': guide('D’abord les retards, puis les échéances à venir. Indiquez ce qui a été payé ou reçu : le solde prévu du cycle se met à jour.', 'Relire les mouvements du cycle', 'mouvements'),
  calendrier: guide('Choisissez une date pour voir ensemble les rentrées attendues, les paiements et les échéances des projets.', 'Revoir le budget qui revient chaque cycle', 'budget'),
  'calendrier/agenda': guide('Les événements dans l’ordre des dates. Ouvrez une échéance pour retrouver sa source et la régler.', 'Revenir au calendrier du cycle', 'calendrier'),
  budget: guide('Les revenus et les charges qui reviennent : ils forment le budget de référence de chaque cycle.', 'Fixer les limites de dépense', 'plafonds'),
  plafonds: guide('Tous vos postes de dépenses : ceux qui ont un plafond, ce qu’il leur reste ce cycle, et ceux qui n’en ont pas encore.', 'Relire les mouvements du cycle', 'mouvements'),
  'plafonds/postes': guide('Les postes de dépense et de revenu disponibles ; ajoutez un poste personnel si besoin.', 'Fixer les plafonds des postes', 'plafonds'),
  'plafonds/:poste': guide('Les opérations de ce poste et sa marge disponible : la limite correspond-elle à vos usages ?', 'Revoir les plafonds de tous les postes', 'plafonds'),
  // Mes projets : créer et suivre, financer, réaliser.
  projets: guide('Vos projets par état d’avancement. Ouvrez une fiche pour attribuer l’enveloppe, choisir qui la finance et suivre les tâches.', 'Suivre les règlements par cycle', 'financement/enveloppes'),
  'projets/:id': guide('L’état du projet, son échéance et ses moyens. Son budget dit ce qui reste disponible pour les tâches.', 'Ouvrir le budget de ce projet', 'projets/:id/budget'),
  'projets/:id/budget': guide('L’enveloppe attribuée, les parts réservées aux tâches et les dépenses déjà réglées.', 'Ouvrir les tâches de ce projet', 'projets/:id/taches'),
  'projets/:id/taches': guide('Les tâches du projet, du travail prévu au travail fait, avec leur part du budget.', 'Revenir à l’enveloppe du projet', 'projets/:id/budget'),
  'financement/enveloppes': { title: 'Règlements par cycle', ...guide('Projet par projet : le montant attribué, les sommes réglées à chaque cycle et le reste disponible.', 'Passer aux tâches à réaliser', 'taches') },
  taches: guide('Le travail par statut. Ouvrez une tâche pour vérifier son projet, ses moyens et son avancement.', 'Retrouver les tâches sans projet', 'taches/rattacher'),
  // Patrimoine : viser, constater. Cycles : clôturer, relire.
  objectif: guide('Votre cap d’épargne par cycle et ce qu’il construit, à partir de votre patrimoine d’aujourd’hui.', 'Organiser mes objectifs datés', 'objectif/echeances'),
  patrimoine: guide('Ce que vos cycles ont construit, constaté à date.', 'Régler mon objectif', 'objectif'),
  'objectif/echeances': guide('Une date et un montant pour chaque objectif de vie. La projection dit s’il sera couvert à temps.', 'Revenir à l’objectif et à la projection', 'objectif'),
  cloture: guide('Le suivi et l’historique de tout ce qui a été fait pour le cycle : ce qui reste à valider, ce qui se tient, ce qui a été enregistré. La synthèse dit où regarder ; à la fin du dernier jour, la clôture fige le cycle et lance le suivant.', 'Relire le bilan des cycles', 'bilans'),
  'cloture/reglages': guide('Le jour d’ancrage fixe les bornes de chaque cycle et donc le résultat calculé.', 'Revenir à la clôture du cycle', 'cloture'),
  bilans: { periodParam: 'cycle', ...guide('Choisissez un cycle : ses entrées, ses dépenses et le coût de ses projets. Un cycle clôturé garde le résultat versé au patrimoine.', 'Relire et clôturer le cycle en cours', 'cloture') },
  'patrimoine/reglages': guide('Le patrimoine de départ et sa date : le point d’où partent les clôtures.', 'Revenir au patrimoine', 'patrimoine'),
};
