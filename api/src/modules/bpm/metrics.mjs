// Métriques administrées de BPM et tableau de bord par défaut : formules lisibles, sans code.
export const RESULT_METRIC = 'bpm.resultatPeriode';

export const METRICS = [
  // Synthèse de la période : réalisé (date réelle de règlement) et restant (date prévue, non réglé)
  { key: 'bpm.revenus', label: 'Reçu', unit: 'EUR', group: 'Période', formula: 'budget.revenusRealises + projets.revenusRegles', description: 'Revenus du budget de vie reçus à leur date réelle et revenus des tâches imputés au cycle à leur date de validation.' },
  { key: 'bpm.charges', label: 'Dépensé', unit: 'EUR', group: 'Période', formula: 'budget.chargesRealisees + projets.chargesReglees', description: 'Dépenses du budget de vie payées à leur date réelle et dépenses des tâches imputées au cycle à leur date de validation. Les enveloppes et parts ne sont pas des charges.' },
  { key: 'bpm.revenusProjets', label: 'Revenus des tâches de projets', unit: 'EUR', group: 'Période', formula: 'projets.revenusRegles', description: 'Revenus validés des tâches imputés au cycle, à leur date de validation.' },
  { key: 'bpm.chargesProjets', label: 'Projets de la vie · réglé validé', unit: 'EUR', group: 'Période', formula: 'projets.chargesReglees', description: 'Charges des tâches validées et imputées au cycle de leur date de validation. Elles font partie du Dépensé.' },
  { key: RESULT_METRIC, label: 'Reste réel', unit: 'EUR', group: 'Période', formula: 'bpm.revenus - bpm.charges', description: 'Net réalisé = reçu − payé. Résultat signé capitalisé dans le Patrimoine à la clôture.' },
  { key: 'bpm.resteARecevoir', label: 'À recevoir', unit: 'EUR', group: 'Période', formula: 'budget.resteARecevoir', description: 'Revenus prévus dans la période et pas encore reçus.' },
  { key: 'bpm.resteAPayer', label: 'À payer', unit: 'EUR', group: 'Période', formula: 'budget.resteAPayer', description: 'Dépenses prévues dans la période et pas encore payées.' },
  { key: 'bpm.soldeAttendu', label: 'Solde prévu à la clôture', unit: 'EUR', group: 'Période', formula: 'bpm.resultatPeriode + bpm.resteARecevoir - bpm.resteAPayer', description: 'Net réalisé + revenus restant à recevoir − dépenses restant à payer (C04). Une échéance déjà réglée ne compte pas une seconde fois.' },
  { key: 'bpm.recuAvance', label: 'Reçu d’avance', unit: 'EUR', group: 'Période', formula: 'budget.revenusAnticipes', description: 'Entrées prévues dans la période mais reçues avant son début : elles sont dans le résultat de la période où elles ont été reçues, pas dans le Reçu de celle-ci.' },
  { key: 'bpm.payeAvance', label: 'Payé d’avance', unit: 'EUR', group: 'Période', formula: 'budget.chargesAnticipees', description: 'Charges prévues dans la période mais payées avant son début : elles sont dans le Dépensé de la période où elles ont été payées.' },
  { key: 'bpm.soldeAvecAvances', label: 'Solde prévu, avances comprises', unit: 'EUR', group: 'Période', formula: 'bpm.soldeAttendu + bpm.recuAvance - bpm.payeAvance', description: 'Solde prévu à la clôture si les entrées et charges réglées d’avance avaient été réglées à leur date prévue : il mesure l’équilibre propre du cycle.' },
  { key: 'bpm.tauxEpargne', label: "Taux d'épargne", unit: '%', decimals: 1, group: 'Période', formula: 'pourcentage(bpm.resultatPeriode, bpm.revenus)', description: 'Part des revenus reçus conservée sur la période.' },
  // Budget initial : référence distincte du solde attendu
  { key: 'bpm.revenusPrevus', label: 'Revenus prévus (initial)', unit: 'EUR', group: 'Budget initial', formula: 'budget.revenusPrevus', description: 'Montants prévus des revenus datés dans la période, réglés ou non.' },
  { key: 'bpm.chargesPrevues', label: 'Charges prévues (initial)', unit: 'EUR', group: 'Budget initial', formula: 'budget.chargesPrevues', description: 'Montants prévus des charges datées dans la période, réglées ou non.' },
  { key: 'bpm.resultatPrevu', label: 'Budget initial', unit: 'EUR', group: 'Budget initial', formula: 'bpm.revenusPrevus - bpm.chargesPrevues', description: 'Solde du budget prévisionnel initial (montants prévus). Référence, distincte du solde attendu.' },
  { key: 'bpm.ecartResultat', label: 'Écart au budget initial', unit: 'EUR', group: 'Budget initial', formula: 'bpm.soldeAttendu - bpm.resultatPrevu', description: 'Solde attendu moins budget initial.' },
  { key: 'bpm.consommationCharges', label: 'Charges consommées', unit: '%', decimals: 0, group: 'Budget initial', formula: 'pourcentage(budget.chargesRealisees, bpm.chargesPrevues)', description: 'Dépenses payées du budget de vie rapportées à ses charges prévues (les charges des projets, comptées à leur validation, n’ont pas de prévu dans le budget de vie).' },
  // Patrimoine
  { key: 'bpm.patrimoineConstitue', label: 'Stock enregistré', unit: 'EUR', group: 'Patrimoine', formula: 'patrimoine.stockOuverture + patrimoine.resultatsCapitalises - projets.prelevementsAvant', description: "Stock d'ouverture et résultats capitalisés, moins les dépenses des projets financés par le patrimoine, avant le début de la période (C09 [P]). La période lue n'y est pas encore incluse." },
  { key: 'bpm.patrimoineDisponible', label: 'Patrimoine disponible', unit: 'EUR', group: 'Patrimoine', formula: 'patrimoine.stockOuverture + patrimoine.resultatsCapitalises - projets.prelevementsCumules', description: 'Stock et résultats déjà capitalisés, après les dépenses et revenus de tâches validés sur le patrimoine. Le résultat du cycle ouvert n’est pas encore capitalisé.' },
  { key: 'bpm.patrimoineFinPeriode', label: 'Estimation après la période', unit: 'EUR', group: 'Patrimoine', formula: 'bpm.patrimoineConstitue + bpm.resultatPeriode - bpm.prelevementsProjets', description: "Stock enregistré + effet signé de la période (une seule fois) − dépenses de la période des projets financés par le patrimoine." },
  { key: 'bpm.prelevementsProjets', label: 'Prélevé par les projets', unit: 'EUR', group: 'Patrimoine', formula: 'projets.prelevementsPatrimoine', description: 'Dépenses de la période des projets de la vie financés par le patrimoine : prélevées sur le patrimoine, hors du cycle.' },
  { key: 'bpm.progressionObjectif', label: "Atteinte de l'objectif", unit: '%', decimals: 0, group: 'Patrimoine', formula: 'pourcentage(bpm.patrimoineConstitue, patrimoine.objectif)', description: 'Stock enregistré rapporté à l’objectif de stock (C10 [P]).' },
  { key: 'bpm.resteObjectif', label: "Reste pour l'objectif", unit: 'EUR', group: 'Patrimoine', formula: 'max(patrimoine.objectif - bpm.patrimoineConstitue, 0)', description: "Montant restant à constituer pour atteindre l'objectif de stock." },
];

export const DEFAULT_DASHBOARD = [
  { id: 'periode', title: 'Synthèse de la période', metrics: ['bpm.revenus', 'bpm.charges', RESULT_METRIC, 'bpm.soldeAttendu', 'bpm.resteARecevoir', 'bpm.resteAPayer'] },
  { id: 'initial', title: 'Budget initial', metrics: ['bpm.resultatPrevu', 'bpm.ecartResultat', 'bpm.revenusPrevus', 'bpm.chargesPrevues', 'bpm.consommationCharges', 'bpm.tauxEpargne'] },
  { id: 'patrimoine', title: 'Patrimoine', metrics: ['bpm.patrimoineConstitue', 'bpm.patrimoineFinPeriode', 'bpm.progressionObjectif', 'bpm.resteObjectif'] },
];
