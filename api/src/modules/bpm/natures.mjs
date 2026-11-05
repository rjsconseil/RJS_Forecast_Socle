// Nature des charges du projet de vie [P] :
// - indispensables : ce qu'il faut payer pour vivre (logement, alimentation, transport, santé, enfants…) ;
// - courantes : le reste de la vie de tous les jours, hors projet de la vie précis ;
// - projets : charges des projets de la vie validées comme réglées (comptées dans le Dépensé à leur validation).
// La liste des centres « indispensables » est un paramètre administrable (`bpm.chargesIndispensables`) :
// toute autre charge du budget de vie est « courante ». Une entrée n'a pas de nature.
import { fail } from '../../socle/errors.mjs';

export const NATURES = ['indispensable', 'courante', 'projet'];
export const NATURE_LABEL = { indispensable: 'Charges indispensables', courante: 'Charges courantes', projet: 'Charges des projets de la vie' };
export const ESSENTIALS_PARAMETER = 'bpm.chargesIndispensables';
export const DEFAULT_ESSENTIALS = ['std:logement', 'std:alimentation', 'std:transport', 'std:sante', 'std:enfants'];

export const essentialRefsOf = (socle, state) => new Set(socle.parameters.value(state, ESSENTIALS_PARAMETER));

/** Référence du centre d'une ligne : centre personnalisé (ID) ou centre standard (`std:<clé>`). */
export const centerRefOf = (l) => l.costCenterRef ?? l.costCenterId ?? (l.standardCostCenter ? `std:${l.standardCostCenter}` : null);

export function natureOf(line, essentials) {
  if (line.direction !== 'charge') return null;
  if (line.special || line.projectCharge || line.budgetRole === 'standard') return 'projet';
  return essentials.has(centerRefOf(line)) ? 'indispensable' : 'courante';
}

/** Paramètre administrable : centres de charge (standards ou personnalisés) tenus pour indispensables. */
export const essentialsParameter = {
  key: ESSENTIALS_PARAMETER,
  label: 'Charges indispensables du projet de vie',
  group: 'Application BPM',
  type: 'list',
  description:
    '[P] Centres de coût dont les charges sont « indispensables » (vivre : se loger, se nourrir, se déplacer, se soigner…) : `std:<clé>` pour un centre standard, ou l’ID d’un centre personnalisé. Les autres charges du budget de vie sont « courantes » ; les charges des projets de la vie forment leur propre nature.',
  default: DEFAULT_ESSENTIALS,
  validate(value, state, socle) {
    const standards = socle.parameters.value(state, 'budget.centresStandards');
    if (new Set(value).size !== value.length) fail('VALIDATION', 'Chaque centre n’apparaît qu’une fois.');
    for (const ref of value) {
      if (typeof ref !== 'string') fail('VALIDATION', 'Chaque centre est une référence texte (std:<clé> ou ID).', { ref });
      const center = ref.startsWith('std:') ? standards.find((c) => `std:${c.key}` === ref) : state.costCenters?.[ref];
      if (!center) fail('VALIDATION', `Centre inconnu : ${ref}.`, { ref });
      if (center.direction !== 'charge') fail('VALIDATION', `Le centre ${ref} concerne les revenus : seule une charge peut être indispensable.`, { ref });
    }
  },
};
