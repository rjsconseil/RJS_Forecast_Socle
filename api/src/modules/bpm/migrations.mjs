// Migrations des données BPM, de la plus ancienne à la plus récente. Aucun montant ni identifiant n'est changé.
import { cycleFields } from '../budget/api.mjs';
import { cycleOf } from './composition.mjs';

export const BPM_MIGRATIONS = [
    {
      from: ['j1-store/0.2', 'socle-store/0.3', 'socle-store/0.4'],
      id: 'bpm-vision',
      description: 'Hypothèses de projection ajoutées vides à chaque composition (rendement à renseigner) ; aucun objectif créé.',
      apply(draft, tx) {
        return Object.values(draft.bpmCompositions)
          .filter((c) => !('vision' in c))
          .map((c) => {
            c.vision = null;
            tx.updated.push({ kind: 'bpmComposition', id: c.id });
            return `${c.id} : hypothèses à renseigner`;
          });
      },
    },
    {
      from: ['j1-store/0.2', 'socle-store/0.3'],
      id: 'bpm-composition-et-cycle',
      description: 'Composition BPM reliée à sa racine noyau ; liaison de cycle « à configurer » créée si absente (aucune période inventée).',
      apply(draft, tx, socle) {
        const changes = [];
        for (const c of Object.values(draft.bpmCompositions)) {
          if (!c.coreProjectId) {
            c.coreProjectId = draft.budgets[c.budgetId]?.coreProjectId ?? null;
            c.label ??= `BPM de ${draft.users[c.userId]?.label ?? c.userId}`;
            tx.updated.push({ kind: 'bpmComposition', id: c.id });
            changes.push(`${c.id} : coreProjectId = ${c.coreProjectId}`);
          }
          if (!cycleOf(draft, c.id)) {
            const cycle = socle.om.create(tx, 'cycleLink', { bpmCompositionId: c.id, ...cycleFields({ anchorDay: null, startDate: null }) }, { userId: c.userId });
            changes.push(`${cycle.id} : liaison de cycle à configurer pour ${c.id}`);
          }
        }
        return changes;
      },
    },
    {
      from: ['j1-store/0.2', 'socle-store/0.3', 'socle-store/0.4', 'socle-store/0.5'],
      id: 'bpm-domaines-middleware',
      description: 'Transfert des objectifs aux middlewares et rattachement des objectifs patrimoniaux à leur racine noyau, sans changer les IDs ni les montants.',
      apply(draft, tx, socle) {
        const changes = [];
        for (const comp of Object.values(draft.bpmCompositions)) {
          tx.userId = comp.userId;
          socle.modules.budget.migrateObjectives(tx, comp.budgetId, comp.vision);
          socle.modules.patrimoine.migrateObjectives(tx, comp.patrimoineId, comp.vision);
          if ('vision' in comp) {
            delete comp.vision;
            socle.om.update(tx, comp, {});
          }
          changes.push(`${comp.id} : objectifs transférés aux middlewares ; racine ${comp.coreProjectId}`);
        }
        tx.userId = null;
        return changes;
      },
    },

  ];
