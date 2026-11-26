/*
 * RJS Forecast · BPM — Modèle de navigation (données seules).
 *
 *   Section (niveau 1)  → référence unique du parcours, affichée dans la barre des sections.
 *   Page (niveau 2)     → listée dans la navigation latérale gauche ; la première est l'accueil de la section.
 *   Sous-page (niveau 3)→ navigation horizontale du contenu ; la première est l'accueil de la page
 *                         (son libellé est celui que la page « pointe »), elle porte les ACTIONS.
 *   Section de sous-page (niveau 4) → ancres de contenu, listées verticalement sous chaque onglet.
 *
 * Aucune règle d'affichage ici : tout est dérivé par navigation-system.js.
 * `kind` d'une section de contenu = gabarit de démonstration (kpis, table, bars, cards, chart,
 * timeline, text, calendar, kanban, checklist, fields).
 * `form` d'une action = gabarit de formulaire (operation, project, task, goal, cap, category,
 * cycle, decision, wealth, closing, period, view, journey).
 */
window.BPM_MODEL = {
  zone: { id: 'bpm', acronym: 'BPM', label: 'Budget/Patrimoine Management', mission: 'Piloter les budgets de l’utilisateur et leur contribution à son patrimoine unique.' },
  sections: [
    /* ───────────── VE · refondue dans le modèle nominal ───────────── */
    {
      id: 'ensemble', acronym: 'VE', label: 'Vue d’ensemble', tone: 'navy',
      intention: 'Comprendre · situer · choisir',
      description: 'Le rôle de BPM, la chaîne de financement et les espaces de travail.',
      pages: [
        {
          id: 'bienvenue', label: 'Bienvenue', symbol: '◫', step: 'Comprendre',
          description: 'Ce que fait BPM et par où commencer.',
          subpages: [
            { id: 'commencer', label: 'Comprendre et commencer', lead: 'BPM réunit votre budget et votre patrimoine dans un seul projet de vie.',
              actions: [
                { id: 'reprendre', label: 'Reprendre mon parcours', form: 'journey' },
                { id: 'visite', label: 'Lancer la visite guidée', form: 'journey' },
              ],
              sections: [
                { id: 'role', label: 'Le rôle de BPM', kind: 'text' },
                { id: 'gestes', label: 'Les trois gestes clés', kind: 'cards' },
                { id: 'depart', label: 'Votre point de départ', kind: 'checklist' },
              ] },
            { id: 'projet-de-vie', label: 'Le projet de vie', lead: 'Un projet unique qui englobe tous les autres.',
              sections: [
                { id: 'unique', label: 'Un projet unique', kind: 'text' },
                { id: 'budget-patrimoine', label: 'Budget et patrimoine', kind: 'kpis' },
                { id: 'cycle', label: 'Le cycle budgétaire', kind: 'timeline' },
              ] },
            { id: 'vocabulaire', label: 'Vocabulaire', lead: 'Les mots du site, définis une seule fois.',
              sections: [
                { id: 'flux', label: 'Flux et opérations', kind: 'text' },
                { id: 'plafonds', label: 'Postes et plafonds', kind: 'text' },
                { id: 'enveloppes', label: 'Enveloppes et parts', kind: 'text' },
              ] },
          ],
        },
        {
          id: 'financement', label: 'Chaîne de financement', symbol: '⇢', step: 'Situer',
          description: 'Des revenus aux tâches : chaque montant conserve son origine.',
          subpages: [
            { id: 'chaine', label: 'Des revenus aux tâches', lead: 'Revenus → budget du projet de vie → projets de la vie → tâches.',
              actions: [
                { id: 'saisir-entree', label: 'Saisir une entrée', form: 'operation', direction: 'income' },
                { id: 'voir-registre', label: 'Ouvrir le registre de flux', goto: 'vision/tableau-de-bord/registre' },
              ],
              sections: [
                { id: 'revenus', label: 'Les revenus', kind: 'kpis' },
                { id: 'budget-vie', label: 'Le budget du projet de vie', kind: 'bars' },
                { id: 'projets', label: 'Les projets de la vie', kind: 'cards' },
                { id: 'taches', label: 'Les tâches', kind: 'table' },
              ] },
            { id: 'origine', label: 'Origine des montants', lead: 'Remonter de n’importe quel montant jusqu’à sa source.',
              sections: [
                { id: 'tracabilite', label: 'Traçabilité', kind: 'timeline' },
                { id: 'exemple', label: 'Exemple chiffré', kind: 'table' },
              ] },
            { id: 'patrimoine', label: 'Vers le patrimoine', lead: 'Ce que chaque clôture apporte à votre patrimoine.',
              sections: [
                { id: 'capitalisation', label: 'Capitalisation des clôtures', kind: 'chart' },
                { id: 'objectif', label: 'Objectif patrimonial', kind: 'kpis' },
              ] },
          ],
        },
        {
          id: 'espaces', label: 'Espaces de travail', symbol: '▤', step: 'Choisir',
          description: 'Les parcours et leur rôle dans le pilotage.',
          subpages: [
            { id: 'choisir', label: 'Choisir un espace', lead: 'Trois espaces, un même projet de vie.',
              actions: [
                { id: 'ouvrir-vision', label: 'Ouvrir Ma vision budgétaire', goto: 'vision' },
                { id: 'ouvrir-projets', label: 'Ouvrir Mes projets de la vie', goto: 'projets-vie' },
                { id: 'ouvrir-calendrier', label: 'Ouvrir le Calendrier', goto: 'calendrier' },
              ],
              sections: [
                { id: 'espaces', label: 'Les espaces', kind: 'cards' },
                { id: 'raccourcis', label: 'Raccourcis fréquents', kind: 'checklist' },
              ] },
            { id: 'parcours', label: 'Parcours conseillés', lead: 'Des enchaînements types selon votre moment du cycle.',
              sections: [
                { id: 'semaine', label: 'Première semaine', kind: 'timeline' },
                { id: 'fin-cycle', label: 'Fin de cycle', kind: 'timeline' },
                { id: 'nouveau-projet', label: 'Lancer un projet', kind: 'timeline' },
              ] },
          ],
        },
      ],
    },

    /* ───────────── 01 · visiteur ───────────── */
    {
      id: 'demarrer', acronym: '01', label: 'Démarrer un projet', tone: 'teal', audience: 'visitor',
      intention: 'Créer son projet de vie, une seule fois',
      description: 'Découvrir le projet de vie, puis le créer avec son profil, son budget et son patrimoine.',
      pages: [
        {
          id: 'creer', label: 'Démarrer un projet', symbol: '＋', step: 'Créer',
          description: 'Ce qu’est le projet de vie et pourquoi le créer.',
          subpages: [
            { id: 'projet-de-vie', label: 'Le projet de vie', lead: 'Créé une seule fois, avec son budget et son patrimoine.',
              actions: [{ id: 'creer', label: 'Créer mon projet de vie', form: 'onboarding' }],
              sections: [
                { id: 'pourquoi', label: 'Pourquoi le créer', kind: 'text' },
                { id: 'contenu', label: 'Ce qui est créé', kind: 'cards' },
              ] },
            { id: 'creation', label: 'Créer mon projet de vie', lead: 'Profil, patrimoine de départ et début du cycle.',
              sections: [
                { id: 'profil', label: 'Profil', kind: 'fields' },
                { id: 'patrimoine', label: 'Patrimoine de départ', kind: 'fields' },
                { id: 'cycle', label: 'Début du cycle', kind: 'fields' },
              ] },
          ],
        },
      ],
    },

    /* ───────────── 02 · Ma vision budgétaire ───────────── */
    {
      id: 'vision', acronym: '02', label: 'Ma vision budgétaire', tone: 'iris',
      intention: 'Comprendre · piloter · cadrer · préparer · régler',
      description: 'Comprendre la période, piloter le projet de vie, suivre les plafonds, préparer ses objectifs et régler son cycle.',
      pages: [
        {
          id: 'tableau-de-bord', label: 'Tableau de bord', symbol: '◎', step: 'Comprendre',
          description: 'Reçu, dépensé, reste et impact patrimonial de la période.',
          subpages: [
            { id: 'periode', label: 'Vue de la période', lead: 'Lire votre budget et son impact sur votre patrimoine, puis agir depuis chaque montant.',
              actions: [
                { id: 'entree', label: 'Saisir une entrée', form: 'operation', direction: 'income' },
                { id: 'depense', label: 'Saisir une dépense', form: 'operation', direction: 'charge' },
                { id: 'periode', label: 'Changer de période', form: 'period' },
              ],
              sections: [
                { id: 'indicateurs', label: 'Indicateurs de la période', kind: 'kpis' },
                { id: 'flux', label: 'Flux de la période', kind: 'table' },
                { id: 'postes', label: 'Dépenses par poste', kind: 'bars' },
                { id: 'impact', label: 'Impact patrimonial', kind: 'chart' },
              ] },
            { id: 'registre', label: 'Registre de flux', lead: 'Toutes les entrées et dépenses : réglé, à venir, à vérifier.',
              sections: [
                { id: 'synthese', label: 'Synthèse des flux', kind: 'kpis' },
                { id: 'echeances', label: 'État des échéances', kind: 'bars' },
                { id: 'registre', label: 'Registre détaillé', kind: 'table' },
              ] },
            { id: 'rapprochement', label: 'Rapprochement bancaire', lead: 'Comparer le même périmètre, aux mêmes dates, puis expliquer l’écart.',
              sections: [
                { id: 'comptes', label: 'Comptes et périmètre', kind: 'fields' },
                { id: 'variations', label: 'Comparer les variations', kind: 'kpis' },
                { id: 'ecarts', label: 'Expliquer les écarts', kind: 'checklist' },
              ] },
          ],
        },
        {
          id: 'projet-de-vie', label: 'Gestion du projet de vie', symbol: '◫', step: 'Piloter',
          description: 'Cycle, charges, projets financés, résultats et patrimoine.',
          subpages: [
            { id: 'pilotage', label: 'Pilotage du cycle', lead: 'Piloter d’un coup d’œil tout le budget du projet de vie.',
              actions: [
                { id: 'entree', label: 'Saisir une entrée', form: 'operation', direction: 'income' },
                { id: 'depense', label: 'Saisir une dépense', form: 'operation', direction: 'charge' },
                { id: 'cloturer', label: 'Préparer la clôture', form: 'closing' },
              ],
              sections: [
                { id: 'cycle', label: 'Cycle en cours', kind: 'kpis' },
                { id: 'indispensables', label: 'Charges indispensables', kind: 'bars' },
                { id: 'courantes', label: 'Charges courantes', kind: 'bars' },
                { id: 'projets', label: 'Projets financés', kind: 'cards' },
                { id: 'resultats', label: 'Résultats et patrimoine', kind: 'chart' },
              ] },
            { id: 'decisions', label: 'Projets et décisions', lead: 'Enveloppes, demandes et dépassements autorisés.',
              sections: [
                { id: 'enveloppes', label: 'Enveloppes des projets', kind: 'table' },
                { id: 'attente', label: 'Décisions attendues', kind: 'checklist' },
                { id: 'facturation', label: 'Facturation des dépassements', kind: 'table' },
              ] },
            { id: 'echeances', label: 'Échéances à traiter', lead: 'D’abord les retards, puis les sept prochains jours.',
              sections: [
                { id: 'retards', label: 'En retard', kind: 'table' },
                { id: 'semaine', label: 'Sept prochains jours', kind: 'timeline' },
                { id: 'reglement', label: 'Détail et règlement', kind: 'fields' },
              ] },
            { id: 'budget-type', label: 'Budget type', lead: 'Les revenus et charges qui reviennent chaque cycle.',
              sections: [
                { id: 'revenus', label: 'Revenus récurrents', kind: 'table' },
                { id: 'charges', label: 'Charges récurrentes', kind: 'table' },
                { id: 'equilibre', label: 'Équilibre du budget type', kind: 'kpis' },
              ] },
            { id: 'cloture', label: 'Suivi et clôture', lead: 'Contrôles, décisions et résultat à capitaliser.',
              sections: [
                { id: 'controles', label: 'Contrôles avant clôture', kind: 'checklist' },
                { id: 'resultat', label: 'Résultat à capitaliser', kind: 'kpis' },
                { id: 'historique', label: 'Clôtures précédentes', kind: 'timeline' },
              ] },
          ],
        },
        {
          id: 'plafonds', label: 'Plafonds et catégories', symbol: '⌈', step: 'Cadrer',
          description: 'Marges, dépassements, plafonds des postes et catégories.',
          subpages: [
            { id: 'suivi', label: 'Suivi des plafonds', lead: 'Voir ce qui dépasse, sans jamais bloquer une dépense.',
              actions: [
                { id: 'plafond', label: 'Définir un plafond', form: 'cap' },
                { id: 'categorie', label: 'Créer une catégorie', form: 'category' },
              ],
              sections: [
                { id: 'marges', label: 'Marges restantes', kind: 'kpis' },
                { id: 'depassements', label: 'Dépassements', kind: 'bars' },
                { id: 'postes', label: 'Lecture par poste', kind: 'table' },
              ] },
            { id: 'reglages', label: 'Définir les plafonds', lead: 'La limite de chaque poste ou catégorie, sans modifier vos opérations.',
              sections: [
                { id: 'postes', label: 'Plafonds des postes', kind: 'bars' },
                { id: 'categories', label: 'Plafonds des catégories', kind: 'table' },
              ] },
            { id: 'categories', label: 'Organiser les catégories', lead: 'Créer et ranger les catégories dans leurs postes.',
              sections: [
                { id: 'liste', label: 'Catégories', kind: 'cards' },
                { id: 'rattachements', label: 'Rattachements aux postes', kind: 'table' },
              ] },
          ],
        },
        {
          id: 'objectifs', label: 'Objectifs et avenir', symbol: '✦', step: 'Préparer',
          description: 'Objectifs datés et projection des prochaines périodes.',
          subpages: [
            { id: 'objectifs', label: 'Mes objectifs datés', lead: 'Préparer l’avenir à partir des seules données saisies.',
              actions: [{ id: 'objectif', label: 'Créer un objectif daté', form: 'goal' }],
              sections: [
                { id: 'en-cours', label: 'Objectifs en cours', kind: 'cards' },
                { id: 'couverture', label: 'Couverture des objectifs', kind: 'bars' },
              ] },
            { id: 'projection', label: 'Projection patrimoniale', lead: 'Ajuster les hypothèses et lire la couverture des objectifs.',
              sections: [
                { id: 'hypotheses', label: 'Hypothèses', kind: 'fields' },
                { id: 'trajectoire', label: 'Trajectoire patrimoniale', kind: 'chart' },
                { id: 'scenario', label: 'Objectifs dans ce scénario', kind: 'table' },
              ] },
            { id: 'reperes', label: 'Épargne et cap', lead: 'Les repères d’épargne et le patrimoine visé.',
              sections: [
                { id: 'epargne', label: 'Épargne visée', kind: 'kpis' },
                { id: 'cap', label: 'Cap patrimonial', kind: 'chart' },
              ] },
          ],
        },
        {
          id: 'reglages', label: 'Cycle et réglages', symbol: '↻', step: 'Régler',
          description: 'Cycle budgétaire, patrimoine, postes et calculs.',
          subpages: [
            { id: 'tous', label: 'Tous les réglages', lead: 'Un cycle et des réglages explicites.',
              actions: [
                { id: 'cycle', label: 'Régler le cycle', form: 'cycle' },
                { id: 'poste', label: 'Ajouter un poste', form: 'category' },
              ],
              sections: [
                { id: 'resume', label: 'Résumé des réglages', kind: 'fields' },
                { id: 'clotures', label: 'Périodes closes', kind: 'timeline' },
              ] },
            { id: 'cycle', label: 'Régler le cycle', lead: 'Ancrage, bornes et clôtures enregistrées.',
              sections: [
                { id: 'ancrage', label: 'Ancrage du cycle', kind: 'fields' },
                { id: 'historique', label: 'Historique des clôtures', kind: 'timeline' },
              ] },
            { id: 'patrimoine', label: 'Patrimoine de départ', lead: 'Stock initial et date de référence.',
              sections: [
                { id: 'stock', label: 'Stock d’ouverture', kind: 'kpis' },
                { id: 'date', label: 'Date de référence', kind: 'fields' },
              ] },
            { id: 'postes', label: 'Postes et revenus', lead: 'Les postes disponibles et vos postes personnels.',
              sections: [
                { id: 'depenses', label: 'Postes de dépense', kind: 'table' },
                { id: 'revenus', label: 'Sources de revenus', kind: 'table' },
              ] },
          ],
        },
      ],
    },

    /* ───────────── 03 · Mes projets de la vie ───────────── */
    {
      id: 'projets-vie', acronym: '03', label: 'Mes projets de la vie', tone: 'petrol',
      intention: 'Financer ses projets · faire avancer leurs tâches',
      description: 'Les projets de la vie de l’utilisateur, leur financement et leurs tâches.',
      pages: [
        {
          id: 'projets', label: 'Projets et financement', symbol: '◫', step: 'Financer',
          description: 'Créer, lire par statut, attribuer, décider et suivre.',
          subpages: [
            { id: 'parcours', label: 'Parcours des projets', lead: 'Tous vos projets de la vie en un seul lieu.',
              actions: [
                { id: 'projet', label: 'Créer un projet de la vie', form: 'project' },
                { id: 'tache', label: 'Créer une tâche', form: 'task' },
                { id: 'decider', label: 'Décider les demandes', form: 'decision' },
              ],
              sections: [
                { id: 'actifs', label: 'Projets actifs', kind: 'cards' },
                { id: 'demandes', label: 'Demandes en attente', kind: 'checklist' },
                { id: 'consommation', label: 'Consommation globale', kind: 'kpis' },
              ] },
            { id: 'statuts', label: 'Projets par statut', lead: 'Chaque projet selon son état, avec son budget.',
              sections: [
                { id: 'tableau', label: 'Tableau par statut', kind: 'kanban' },
                { id: 'budgets', label: 'Budgets attribués', kind: 'table' },
              ] },
            { id: 'enveloppes', label: 'Attribuer les enveloppes', lead: 'Choisir un projet puis doter ses tâches.',
              sections: [
                { id: 'a-doter', label: 'Projets à doter', kind: 'table' },
                { id: 'repartition', label: 'Répartition des parts', kind: 'bars' },
              ] },
            { id: 'decisions', label: 'Décider les financements', lead: 'Demandes de part et autorisations de dépassement.',
              sections: [
                { id: 'parts', label: 'Parts demandées', kind: 'checklist' },
                { id: 'autorisations', label: 'Autorisations de dépassement', kind: 'table' },
              ] },
            { id: 'suivi', label: 'Suivi des projets financés', lead: 'Enveloppes, consommations et points d’attention.',
              sections: [
                { id: 'consommation', label: 'Consommation des enveloppes', kind: 'bars' },
                { id: 'attention', label: 'Points d’attention', kind: 'checklist' },
                { id: 'etapes', label: 'Prochaine étape par projet', kind: 'timeline' },
              ] },
          ],
        },
        {
          id: 'taches', label: 'Tâches des projets', symbol: '☑', step: 'Avancer',
          description: 'Les tâches par statut avec leur part de budget.',
          subpages: [
            { id: 'tableau', label: 'Tableau des tâches', lead: 'Glisser une tâche change son état et celui de son projet.',
              actions: [
                { id: 'tache', label: 'Créer une tâche', form: 'task' },
                { id: 'rattacher', label: 'Rattacher une tâche', form: 'task' },
              ],
              sections: [
                { id: 'kanban', label: 'Tâches par statut', kind: 'kanban' },
                { id: 'parts', label: 'Parts de budget', kind: 'bars' },
              ] },
            { id: 'rattacher', label: 'Rattacher des tâches', lead: 'Une tâche disponible, le projet qu’elle doit servir.',
              sections: [
                { id: 'disponibles', label: 'Tâches disponibles', kind: 'table' },
                { id: 'cibles', label: 'Projets cibles', kind: 'cards' },
              ] },
            { id: 'echeancier', label: 'Échéancier', lead: 'Les tâches dans le temps.',
              sections: [
                { id: 'semaine', label: 'Cette semaine', kind: 'timeline' },
                { id: 'retard', label: 'En retard', kind: 'table' },
              ] },
          ],
        },
      ],
    },

    /* ───────────── 04 · Calendrier ───────────── */
    {
      id: 'calendrier', acronym: '04', label: 'Calendrier', tone: 'plum',
      intention: 'Le budget et le patrimoine dans le temps',
      description: 'Revenus, dépenses, fins de période et versements au patrimoine.',
      pages: [
        {
          id: 'calendrier-budget', label: 'Calendrier Budget/Patrimoine', symbol: '▦', step: 'Situer',
          description: 'Quand l’argent entre, sort et rejoint le patrimoine.',
          subpages: [
            { id: 'calendrier', label: 'Calendrier', lead: 'Semaine, mois ou année.',
              actions: [
                { id: 'vue', label: 'Changer de vue', form: 'view' },
                { id: 'entree', label: 'Saisir une entrée', form: 'operation', direction: 'income' },
                { id: 'depense', label: 'Saisir une dépense', form: 'operation', direction: 'charge' },
              ],
              sections: [
                { id: 'synthese', label: 'Synthèse du mois', kind: 'kpis' },
                { id: 'grille', label: 'Grille du mois', kind: 'calendar' },
                { id: 'sources', label: 'Sources et affichage', kind: 'checklist' },
              ] },
            { id: 'agenda', label: 'Agenda des événements', lead: 'Les repères datés et leur détail.',
              sections: [
                { id: 'evenements', label: 'Événements de la période', kind: 'timeline' },
                { id: 'a-venir', label: 'Échéances à venir', kind: 'table' },
              ] },
            { id: 'versements', label: 'Versements au patrimoine', lead: 'Fins de période et capitalisations.',
              sections: [
                { id: 'fins', label: 'Fins de période', kind: 'timeline' },
                { id: 'capitalisations', label: 'Capitalisations', kind: 'chart' },
              ] },
          ],
        },
      ],
    },
  ],
};
