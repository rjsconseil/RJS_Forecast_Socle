// Configurations livrées du Calendrier : uniquement des données, lues par le moteur (`engine.mjs`).
// Chacune est la valeur par défaut d'un paramètre administrable `calendrier.<id>` : l'administration peut
// changer les éléments affichés, leurs couleurs, les entrées montrées au survol, les indicateurs et la vue
// d'ouverture sans toucher au code. Les natures et champs nommés sont ceux des objets du user.

const STATUTS_TACHE = { todo: 'À faire', blocked: 'À prioriser', doing: 'En cours', done: 'Terminée' };
const PRIORITES = { low: 'Basse', medium: 'Moyenne', high: 'Haute' };
const TYPES_OBJECTIF = { etudes: 'Études', retraite: 'Retraite', achat: 'Achat', securite: 'Sécurité', transmission: 'Transmission', autre: 'Autre' };

const TACHES_DU_PROJET = { nature: 'task', champ: 'projectId', termine: { status: ['done'] } };
const PROJET_DE_LA_TACHE = { champ: 'projectId', reference: { nature: 'coreProject', champ: 'title' }, vide: 'Sans projet' };
const BUDGET = { libelle: 'Budget', champ: 'budgetId', reference: { nature: 'budget', champ: 'name' } };
const GROUPE_BUDGET = { champ: 'budgetId', reference: { nature: 'budget', champ: 'name' } };

// ---------- Noyau transverse : projets et tâches ----------

function projet(id, libelle, champ, repere, couleur, autreDate) {
  return {
    id,
    libelle,
    nature: 'coreProject',
    objet: ['projet', 'projets'],
    date: champ,
    titre: '{title}',
    repere,
    couleur,
    affiche: true,
    urgence: repere === 'echeance',
    // Un projet est terminé quand toutes ses tâches le sont (avec au moins une tâche).
    termine: { relies: { nature: 'task', champ: 'projectId', tous: { status: ['done'] } } },
    statut: { relies: TACHES_DU_PROJET, vide: 'Aucune tâche' },
    groupe: { champ: 'id', texte: '{title}' },
    lien: '/projects/{id}',
    replanifier: { methode: 'PUT', route: '/api/projects/{id}', champ },
    survol: [
      autreDate,
      { libelle: 'Tâches', relies: TACHES_DU_PROJET, vide: 'Aucune tâche' },
      { libelle: 'Priorité', champ: 'priority', valeurs: PRIORITES },
    ],
  };
}

function tache(id, libelle, champ, repere, couleur, temps) {
  return {
    id,
    libelle,
    nature: 'task',
    objet: ['tâche', 'tâches'],
    date: champ,
    titre: '{title}',
    repere,
    couleur,
    affiche: true,
    urgence: repere === 'echeance',
    termine: { status: ['done'] },
    statut: { champ: 'status', valeurs: STATUTS_TACHE },
    groupe: PROJET_DE_LA_TACHE,
    lien: '/tasks/{id}/edit',
    replanifier: { methode: 'PUT', route: '/api/tasks/{id}', champ },
    survol: [{ libelle: 'Statut', champ: 'status', valeurs: STATUTS_TACHE }, { libelle: 'Projet', ...PROJET_DE_LA_TACHE }, temps],
  };
}

export const CALENDAR_NOYAU = {
  libelle: 'Calendrier du noyau',
  description: 'Les projets et les tâches du noyau dans le temps : débuts, dates prévues et échéances.',
  vue: 'mois',
  reperesParCase: 2,
  reperesAuSurvol: 4,
  delaiFermetureSurvol: 260,
  indicateurs: ['elements', 'dates', 'suivi'],
  elements: [
    projet('projet-debut', 'Début de projet', 'startDate', 'debut', 'sarcelle', { libelle: 'Échéance', champ: 'dueDate', format: 'date', vide: 'Sans échéance' }),
    projet('projet-echeance', 'Échéance de projet', 'dueDate', 'echeance', 'ambre', { libelle: 'Début prévu', champ: 'startDate', format: 'date', vide: 'Non défini' }),
    tache('tache-prevue', 'Date prévue de tâche', 'startDate', 'debut', 'bleu', { libelle: 'Temps prévu', champ: 'plannedHours', format: 'heures', vide: 'Non estimé' }),
    tache('tache-echeance', 'Échéance de tâche', 'dueDate', 'echeance', 'rouge', { libelle: 'Temps consommé', champ: 'spentHours', format: 'heures' }),
  ],
};

// ---------- Budget/Patrimoine (application BPM-Astra) ----------
// Les règlements, tâches et rendez-vous viennent des natures fournies par BPM (`bpm/calendar-sources.mjs`) :
// le calendrier montre exactement ce que BPM tient pour prévu, réglé, en retard ou non réalisé. Les liens
// ouvrent les pages de BPM-Astra, l'application qui sert ce calendrier.

const STATUTS_ENTREE = { settled: 'Reçu', due: 'Attendu ce jour', late: 'En retard', pending: 'Attendu', unrealized: 'Non réalisé' };
const STATUTS_SORTIE = { settled: 'Payé', due: 'À payer ce jour', late: 'En retard', pending: 'À payer', unrealized: 'Non réalisé' };
const STATUTS_LIGNE = { settled: 'Réglé', due: 'Du jour', late: 'En retard', pending: 'À venir', unrealized: 'Non réalisé' };
const FINANCEMENT = { cycle: 'Cycle', patrimoine: 'Patrimoine' };
const MONTANT_LIGNE = ['realizedCents', 'plannedCents'];
// Seule une opération ponctuelle prévue se déplace ; la commande de l'API garde les périodes closes.
const REPLANIFIER_LIGNE = { methode: 'PUT', route: '/api/bpm/operations/{id}', champ: 'date', si: { kind: ['operation'], settled: [false], recurrenceId: [null], status: { sauf: ['unrealized'] } } };

function reglement(id, libelle, sens, couleur, { occurrence }) {
  const statuts = sens === 'entree' ? STATUTS_ENTREE : STATUTS_SORTIE;
  return {
    id,
    libelle,
    nature: 'bpmReglement',
    objet: sens === 'entree' ? ['revenu', 'revenus'] : ['dépense', 'dépenses'],
    filtre: { direction: [sens === 'entree' ? 'income' : 'charge'], kind: [occurrence ? 'occurrence' : 'operation'], projectCharge: { sauf: [true] }, special: { sauf: [true] } },
    // Réglée : à sa date de règlement ; attendue : à sa date prévue.
    date: ['realizedDate', 'plannedDate'],
    titre: '{label}',
    repere: 'ponctuel',
    couleur,
    affiche: true,
    urgence: true,
    termine: { settled: [true] },
    statut: { champ: 'status', valeurs: statuts },
    montant: { champ: MONTANT_LIGNE, sens: { fixe: sens } },
    groupe: GROUPE_BUDGET,
    lien: occurrence ? '/bpm-astra/mouvements/echeances?ligne={id}' : '/bpm-astra/mouvements?ligne={id}',
    ...(occurrence ? {} : { replanifier: REPLANIFIER_LIGNE }),
    survol: [
      { libelle: 'Montant', champ: MONTANT_LIGNE, format: 'montantSigne' },
      { libelle: 'Statut', champ: 'status', valeurs: statuts },
      { libelle: 'Centre de coût', champ: 'costCenterLabel', vide: 'Non classé' },
      BUDGET,
    ],
  };
}

const REGLEMENT_PROJET = {
  id: 'reglement-projet',
  libelle: 'Règlement de projet',
  nature: 'bpmReglement',
  objet: ['règlement de projet', 'règlements de projets'],
  filtre: { projectCharge: [true], special: { sauf: [true] } },
  date: ['realizedDate', 'plannedDate'],
  titre: '{label}',
  repere: 'ponctuel',
  couleur: 'rose',
  affiche: true,
  urgence: true,
  termine: { settled: [true] },
  statut: { champ: 'status', valeurs: STATUTS_LIGNE },
  montant: { champ: MONTANT_LIGNE, sens: { champ: 'direction', valeurs: { income: 'entree', charge: 'sortie' } } },
  groupe: { champ: 'coreProjectId', texte: '{projectTitle}' },
  lien: '/bpm-astra/projets/{coreProjectId}/budget?ligne={id}',
  replanifier: REPLANIFIER_LIGNE,
  survol: [
    { libelle: 'Montant', champ: MONTANT_LIGNE, format: 'montantSigne' },
    { libelle: 'Statut', champ: 'status', valeurs: STATUTS_LIGNE },
    { libelle: 'Projet', champ: 'projectTitle', vide: 'Projet' },
    { libelle: 'Tâche', champ: 'taskTitle', vide: 'Sans tâche' },
    { libelle: 'Financement', champ: 'fundingSource', valeurs: FINANCEMENT, vide: 'Cycle' },
  ],
};

function tacheDeProjet(id, libelle, champ, repere, couleur, branche) {
  return {
    id,
    libelle,
    nature: 'bpmTache',
    objet: ['tâche', 'tâches'],
    date: champ,
    titre: '{title}',
    repere,
    couleur,
    affiche: true,
    ...(branche ? {} : { branche: false }),
    urgence: repere === 'echeance',
    termine: { status: ['done'] },
    statut: { champ: 'status', valeurs: STATUTS_TACHE },
    groupe: { champ: 'projectId', texte: '{projectTitle}' },
    lien: '/bpm-astra/projets/{projectId}?task={id}',
    replanifier: { methode: 'PUT', route: '/api/tasks/{id}', champ },
    survol: [
      { libelle: 'Projet', champ: 'projectTitle', vide: 'Sans projet' },
      { libelle: 'Statut', champ: 'status', valeurs: STATUTS_TACHE },
      { libelle: champ === 'dueDate' ? 'Début prévu' : 'Échéance', champ: champ === 'dueDate' ? 'startDate' : 'dueDate', format: 'date', vide: 'Non défini' },
    ],
  };
}

const VERSEMENT = {
  id: 'versement-patrimoine',
  libelle: 'Versement au patrimoine',
  nature: 'capitalization',
  objet: ['versement', 'versements'],
  date: 'date',
  titre: '{label}',
  repere: 'ponctuel',
  couleur: 'violet',
  affiche: true,
  termine: {},
  statut: { texte: 'Capitalisé' },
  montant: { champ: 'amountCents' },
  groupe: { champ: 'patrimoineId', reference: { nature: 'patrimoine', champ: 'label' } },
  lien: '/bpm-astra/patrimoine',
  survol: [
    { libelle: 'Montant', champ: 'amountCents', format: 'montant' },
    { libelle: 'Patrimoine', champ: 'patrimoineId', reference: { nature: 'patrimoine', champ: 'label' } },
  ],
};

export const CALENDAR_BUDGET_PATRIMOINE = {
  interaction: {
    access: 'collapsed',
    controls: { sources: true, fields: true, indicators: true, density: true, completed: true },
    includeDone: true,
  },
  libelle: 'Calendrier Budget/Patrimoine',
  description: 'Les revenus et les dépenses du projet de vie, les règlements et les échéances des projets, les fins de période du cycle et les résultats versés au patrimoine.',
  vue: 'mois',
  reperesParCase: 2,
  reperesAuSurvol: 4,
  delaiFermetureSurvol: 260,
  indicateurs: ['flux', 'solde', 'suivi'],
  format: 'standard',
  formats: [
    { id: 'montants', libelle: 'Montants et statut', disposition: 'ligne', champs: ['amount', 'status', 'total'], reperesParCase: 3 },
  ],
  elements: [
    reglement('revenu', 'Revenu', 'entree', 'vert', { occurrence: false }),
    reglement('revenu-recurrent', 'Revenu récurrent attendu', 'entree', 'cyan', { occurrence: true }),
    reglement('depense', 'Dépense', 'sortie', 'rouge', { occurrence: false }),
    reglement('depense-recurrente', 'Dépense récurrente attendue', 'sortie', 'orange', { occurrence: true }),
    REGLEMENT_PROJET,
    tacheDeProjet('tache-echeance', 'Échéance de tâche', 'dueDate', 'echeance', 'ambre', true),
    tacheDeProjet('tache-prevue', 'Date prévue de tâche', 'startDate', 'debut', 'bleu', false),
    {
      id: 'fin-periode',
      libelle: 'Fin de période',
      nature: 'cycleLink',
      objet: ['fin de période', 'fins de période'],
      filtre: { state: ['active'] },
      date: 'startDate',
      // Dernier jour de chaque période du cycle ; une période close est lue par son versement au patrimoine.
      repetition: { debut: 'startDate', cadence: 'frequency', ancrage: 'anchorDay', position: 'veilleSuivante', remplacePar: { nature: 'closure', champ: 'cycleLinkId', date: 'periodEnd' } },
      titre: 'Période à clôturer',
      repere: 'echeance',
      couleur: 'indigo',
      affiche: true,
      urgence: true,
      statut: { texte: 'Clôture à faire' },
      lien: '/bpm-astra/cloture',
      survol: [
        { libelle: 'Jour de début des périodes', champ: 'anchorDay', format: 'nombre' },
        { libelle: 'À la clôture', texte: 'Le résultat de la période rejoint le patrimoine.' },
      ],
    },
    {
      id: 'decision-enveloppes',
      libelle: 'Décision d’enveloppe',
      nature: 'bpmRendezVous',
      objet: ['décision', 'décisions'],
      date: 'date',
      titre: '{label}',
      repere: 'echeance',
      couleur: 'ardoise',
      affiche: true,
      urgence: true,
      statut: { texte: 'À décider' },
      lien: '/bpm-astra/projets',
      survol: [{ libelle: 'Décision', texte: 'Décision de moyens, sans charge sur le cycle ni prélèvement sur le patrimoine.' }],
    },
    VERSEMENT,
  ],
};

// ---------- Patrimoine : ouverture, versements et objectifs ----------

export const CALENDAR_PATRIMOINE = {
  libelle: 'Calendrier du patrimoine',
  description: 'L’ouverture du patrimoine, les résultats de période qui l’alimentent et les objectifs de vie datés.',
  vue: 'annee',
  reperesParCase: 2,
  reperesAuSurvol: 4,
  delaiFermetureSurvol: 260,
  indicateurs: ['elements', 'flux'],
  elements: [
    {
      id: 'ouverture',
      libelle: 'Ouverture du patrimoine',
      nature: 'patrimoine',
      objet: ['patrimoine', 'patrimoines'],
      date: 'openingDate',
      titre: '{label} · ouverture',
      repere: 'debut',
      couleur: 'sarcelle',
      affiche: true,
      termine: {},
      statut: { texte: 'Ouvert' },
      montant: { champ: 'openingStockCents' },
      lien: '/bpm-astra/patrimoine',
      survol: [
        { libelle: 'Stock d’ouverture', champ: 'openingStockCents', format: 'montant', vide: 'Non renseigné' },
        { libelle: 'Objectif de stock', champ: 'objectiveCents', format: 'montant', vide: 'Non défini' },
      ],
    },
    { ...VERSEMENT, montant: { champ: 'amountCents', sens: { fixe: 'entree' } }, survol: [{ libelle: 'Montant', champ: 'amountCents', format: 'montantSigne' }, VERSEMENT.survol[1]] },
    {
      id: 'objectif',
      libelle: 'Objectif de vie',
      nature: 'lifeGoal',
      objet: ['objectif', 'objectifs'],
      filtre: { removed: [false] },
      date: 'date',
      titre: '{label}',
      repere: 'echeance',
      couleur: 'ambre',
      affiche: true,
      statut: { champ: 'type', valeurs: TYPES_OBJECTIF },
      lien: '/bpm-astra/objectif/echeances',
      survol: [
        { libelle: 'Type', champ: 'type', valeurs: TYPES_OBJECTIF },
        { libelle: 'Montant visé (valeur du jour)', champ: 'targetTodayCents', format: 'montant' },
      ],
    },
  ],
};
