import type { Params } from '@angular/router';
import type { LifeVoletKey } from '../data/bpm-life.models';
import { OBJECTIVE_FRAGMENTS } from '../objectives/objectives-model';

type LifeTopic = {
  key: LifeVoletKey | 'echeances' | 'financement';
  path: string;
  label: string;
  lead: string;
};

export const LIFE_TOPIC_GROUPS: { label: string; topics: LifeTopic[] }[] = [
  { label: 'Budget du cycle', topics: [
    { key: 'cycle', path: 'cycle', label: 'Cycle en cours', lead: 'Comparez les entrées reçues, les dépenses réglées et le solde attendu à la clôture.' },
    { key: 'echeances', path: 'echeances', label: 'Prochains règlements', lead: 'Retrouvez les retards et les échéances des sept prochains jours, par date de règlement.' },
    { key: 'indispensable', path: 'charges-indispensables', label: 'Charges indispensables', lead: 'Vérifiez les dépenses prioritaires, les dates de paiement et les plafonds de chaque poste.' },
    { key: 'courante', path: 'charges-courantes', label: 'Charges courantes', lead: 'Suivez vos dépenses du quotidien et la marge disponible pour le reste du cycle.' },
  ] },
  { label: 'Projets', topics: [
    { key: 'financement', path: 'financement', label: 'Financement des projets', lead: 'Attribuez les enveloppes et décidez des moyens demandés par les tâches.' },
    { key: 'projets', path: 'projets-finances', label: 'Projets financés', lead: 'Retrouvez, projet par projet, le budget attribué, les montants réglés et le reste disponible.' },
  ] },
  { label: 'Résultats et patrimoine', topics: [
    { key: 'resultats', path: 'bilans', label: 'Résultats des cycles', lead: 'Comparez les résultats des cycles à vos objectifs et retrouvez le détail de chaque bilan.' },
    { key: 'patrimoine', path: 'patrimoine', label: 'Patrimoine accumulé', lead: 'Retrouvez le stock enregistré, les résultats capitalisés et la distance à votre objectif.' },
  ] },
];

export const LIFE_TOPICS = LIFE_TOPIC_GROUPS.flatMap(group => group.topics);

/** Rétablit la destination des anciens favoris de pilotage, y compris les saisies déjà ouvertes. */
export function lifePilotageDestination(query: Params, fragment: string | null) {
  const { expanded, filter, ...queryParams } = query;
  const topicKey = fragment?.startsWith('life-volet-') ? fragment.slice('life-volet-'.length) : String(expanded ?? '').split(',')[0];
  const topic = LIFE_TOPICS.find(item => item.key === topicKey);
  const destinations: Record<string, [string, string?]> = {
    'life-cycle-title': ['cloture', 'life-cycle-title'],
    'life-actions-title': ['echeances', 'life-due-title'],
    'life-due': ['echeances', 'life-due-title'],
    'life-due-title': ['echeances', 'life-due-title'],
    'life-decisions': ['financement', 'project-decisions-title'],
    'life-decisions-title': ['financement', 'project-decisions-title'],
    'life-funding': ['financement', 'funding-path-title'],
    'life-funding-title': ['financement', 'funding-path-title'],
    'lpl-title': ['financement', 'funding-path-title'],
    'life-budget-type': ['budget-type'],
    'life-closing-title': ['cloture', 'life-closing-title'],
    'life-outlook-title': ['', 'life-outlook-title'],
  };
  if (queryParams['entry'] || queryParams['ligne']) {
    const path = topic && ['cycle', 'indispensable', 'courante', 'projets', 'patrimoine'].includes(topic.key) ? topic.path : 'cycle';
    return { path: '/projet-de-vie/' + path, queryParams, fragment: undefined };
  }
  if (fragment && OBJECTIVE_FRAGMENTS.includes(fragment)) return { path: '/vision', queryParams, fragment };
  const [path, anchor] = destinations[fragment ?? ''] ?? [topic?.path ?? '', undefined];
  return { path: path ? '/projet-de-vie/' + path : '/projet-de-vie', queryParams, fragment: anchor };
}
