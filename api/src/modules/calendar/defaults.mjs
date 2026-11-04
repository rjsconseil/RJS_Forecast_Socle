// Configurations livrées du Calendrier : uniquement des données, lues par le moteur (`engine.mjs`).
// Chacune est la valeur par défaut d'un paramètre administrable `calendrier.<id>` : l'administration peut
// changer les éléments affichés, leurs couleurs, les entrées montrées au survol, les indicateurs et la vue
// d'ouverture sans toucher au code. Les natures et champs nommés sont ceux des objets du user.

const STATUTS_TACHE = { todo: 'À faire', blocked: 'À prioriser', doing: 'En cours', done: 'Terminée' };
const PRIORITES = { low: 'Basse', medium: 'Moyenne', high: 'Haute' };
const CADENCES = { weekly: 'Hebdomadaire', monthly: 'Mensuelle', yearly: 'Annuelle' };
const TYPES_OBJECTIF = { etudes: 'Études', retraite: 'Retraite', achat: 'Achat', securite: 'Sécurité', transmission: 'Transmission', autre: 'Autre' };

const TACHES_DU_PROJET = { nature: 'task', champ: 'projectId', termine: { status: ['done'] } };
const PROJET_DE_LA_TACHE = { champ: 'projectId', reference: { nature: 'coreProject', champ: 'title' }, vide: 'Sans projet' };
const CENTRE = {
  libelle: 'Centre de coût',
  champ: 'costCenterId',
  reference: { nature: 'costCenter', champ: 'label' },
  sinon: { champ: 'standardCostCenter', parametre: { cle: 'budget.centresStandards', id: 'key', champ: 'label' } },
};
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

// ---------- Budget/Patrimoine : revenus, dépenses, périodes et versements au patrimoine ----------

function ligne(id, libelle, sens, couleur, statuts) {
  const direction = sens === 'entree' ? 'income' : 'charge';
  return {
    id,
    libelle,
    nature: 'operation',
    objet: sens === 'entree' ? ['revenu', 'revenus'] : ['dépense', 'dépenses'],
    filtre: { direction: [direction] },
    // Réglée : à sa date de règlement ; attendue : à sa date prévue.
    date: ['realizedDate', 'date'],
    titre: '{label}',
    repere: 'ponctuel',
    couleur,
    affiche: true,
    urgence: true,
    termine: { status: ['realized'] },
    statut: { champ: 'status', valeurs: statuts },
    montant: { champ: ['realizedAmountCents', 'amountCents'], sens: { fixe: sens } },
    groupe: GROUPE_BUDGET,
    lien: '/tableau-de-bord?ligne={id}',
    // Seule une opération ponctuelle attendue se déplace ; la commande de l'API garde les périodes closes.
    replanifier: { methode: 'PUT', route: '/api/bpm/operations/{id}', champ: 'date', si: { status: ['planned'], recurrenceId: [null] } },
    survol: [
      { libelle: 'Montant', champ: ['realizedAmountCents', 'amountCents'], format: 'montantSigne' },
      { libelle: 'Statut', champ: 'status', valeurs: statuts },
      CENTRE,
      BUDGET,
    ],
  };
}

function recurrence(id, libelle, sens, couleur) {
  return {
    id,
    libelle,
    nature: 'recurrence',
    objet: sens === 'entree' ? ['revenu', 'revenus'] : ['dépense', 'dépenses'],
    filtre: { direction: [sens === 'entree' ? 'income' : 'charge'] },
    date: 'firstDate',
    // Les occurrences attendues se déroulent depuis la définition ; une occurrence réglée est une opération.
    repetition: { debut: 'firstDate', fin: 'endDate', cadence: 'cadence', remplacePar: { nature: 'operation', champ: 'recurrenceId', date: 'occurrenceDate' } },
    titre: '{label}',
    repere: 'ponctuel',
    couleur,
    affiche: true,
    urgence: true,
    statut: { texte: 'Attendu' },
    montant: { champ: 'amountCents', sens: { fixe: sens } },
    groupe: GROUPE_BUDGET,
    lien: '/tableau-de-bord?ligne={id}',
    survol: [
      { libelle: 'Montant', champ: 'amountCents', format: 'montantSigne' },
      { libelle: 'Cadence', champ: 'cadence', valeurs: CADENCES },
      CENTRE,
      BUDGET,
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
  lien: '/app/reglages',
  survol: [
    { libelle: 'Montant', champ: 'amountCents', format: 'montant' },
    { libelle: 'Patrimoine', champ: 'patrimoineId', reference: { nature: 'patrimoine', champ: 'label' } },
  ],
};

export const CALENDAR_BUDGET_PATRIMOINE = {
  libelle: 'Calendrier Budget/Patrimoine',
  description: 'Les revenus et les dépenses des Budgets du user, les fins de période du cycle et les résultats versés au patrimoine.',
  vue: 'mois',
  reperesParCase: 2,
  reperesAuSurvol: 4,
  delaiFermetureSurvol: 260,
  indicateurs: ['flux', 'solde', 'suivi'],
  elements: [
    ligne('revenu', 'Revenu', 'entree', 'vert', { planned: 'Attendu', realized: 'Reçu' }),
    recurrence('revenu-recurrent', 'Revenu récurrent attendu', 'entree', 'cyan'),
    ligne('depense', 'Dépense', 'sortie', 'rouge', { planned: 'À payer', realized: 'Payé' }),
    recurrence('depense-recurrente', 'Dépense récurrente attendue', 'sortie', 'orange'),
    {
      id: 'fin-periode',
      libelle: 'Fin de période',
      nature: 'cycleLink',
      objet: ['fin de période', 'fins de période'],
      filtre: { state: ['active'] },
      date: 'startDate',
      // Dernier jour de chaque période du cycle ; une période close est lue par son versement au patrimoine.
      repetition: { debut: 'startDate', cadence: 'frequency', ancrage: 'anchorDay', position: 'veilleSuivante', remplacePar: { nature: 'closure', champ: 'cycleLinkId', date: 'periodEnd' } },
      titre: 'Fin de période',
      repere: 'echeance',
      couleur: 'indigo',
      affiche: true,
      urgence: true,
      statut: { texte: 'Clôture à faire' },
      lien: '/piloter',
      survol: [
        { libelle: 'Jour de début des périodes', champ: 'anchorDay', format: 'nombre' },
        { libelle: 'À la clôture', texte: 'Le résultat de la période rejoint le patrimoine.' },
      ],
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
      lien: '/app/reglages',
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
      lien: '/vision',
      survol: [
        { libelle: 'Type', champ: 'type', valeurs: TYPES_OBJECTIF },
        { libelle: 'Montant visé (valeur du jour)', champ: 'targetTodayCents', format: 'montant' },
      ],
    },
  ],
};
