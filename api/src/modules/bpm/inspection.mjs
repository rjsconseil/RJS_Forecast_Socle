// BPM — contrôles d'intégrité de l'application (préparation, liens de composition, clôtures) et vues de diagnostic
// d'Object Management. Lus par l'inspecteur sur l'état qu'on lui donne (une partition ou la vue complète).
import { check } from '../../socle/object-management/inspect.mjs';
import { compositionOf, cycleOf } from './composition.mjs';
import { preparationOf } from './cycle-state.mjs';

export const bpmInspection = {
  checks(state) {
    const out = [];
    for (const u of Object.values(state.users)) {
      const prep = preparationOf(state, u.id);
      const missing = prep.missing.map((m) => ({ id: u.id, kind: 'user', field: m.code, targetId: null, problem: 'missing-required', message: `${m.label} manquant` }));
      const dups = prep.duplicates.map((d) => ({ id: u.id, kind: 'user', field: d.code, targetId: d.ids.join('|'), problem: 'duplicate', message: `${d.ids.length} × ${d.label} (attendu : exactement un)` }));
      const observed =
        prep.status === 'ready'
          ? 'exactement un de chaque, reliés'
          : [prep.missing.length ? `à préparer — manque : ${prep.missing.map((m) => m.label).join(', ')}` : null, ...dups.map((d) => d.message), prep.linked ? null : 'éléments non reliés entre eux'].filter(Boolean).join(' ; ');
      out.push({
        ...check('BPM-01', 'integrity', 'bpm', `Espace BPM de ${u.label} : exactement un de chaque élément`, 'exactement 1 Budget « Projet de vie », 1 Patrimoine, 1 composition, 1 liaison de cycle, reliés à la même racine', observed, prep.status === 'ready' ? 'passed' : 'failed', [u.id, ...prep.ids]),
        anomalies: [...missing, ...dups],
        preparation: prep.status,
      });
    }
    for (const b of Object.values(state.budgets).filter((x) => x.role === 'standard')) {
      const comp = compositionOf(state, b.userId);
      const parent = state.budgets[b.parentBudgetId];
      const linked = comp && parent?.id === comp.budgetId && parent.userId === b.userId && b.coreProjectId !== comp.coreProjectId;
      out.push(check('BPM-02', 'integrity', 'bpm', `Projet ${b.name} dans la composition du projet de vie`, 'racine propre, budget père de la composition, même user', linked ? 'relié' : 'liaison incohérente', linked ? 'passed' : 'failed', [b.id, b.coreProjectId, comp?.id].filter(Boolean)));

      const n = Object.values(state.tasks).filter((t) => t.projectId === b.coreProjectId).length;
      if (!n) out.push(check('A-PARC-01', 'pathway', 'bpm', `Projet de la vie ${b.name} sans tâche`, 'au moins une tâche dans le parcours métier', '0 tâche', 'warning', [b.id]));
    }
    const lifeRoots = new Set(Object.values(state.budgets).filter((b) => b.role === 'life').map((b) => b.coreProjectId));
    for (const t of Object.values(state.tasks)) {
      if (lifeRoots.has(t.projectId)) out.push(check('P-IHM-01', 'pathway', 'bpm', 'Tâche reliée directement à la racine principale', 'création métier via un projet de la vie', `tâche ${t.title}`, 'warning', [t.id, t.projectId]));
    }
    const keys = new Set();
    for (const c of Object.values(state.closures)) {
      const cap = state.capitalizations[c.capitalizationId];
      const unique = !keys.has(`${c.cycleLinkId}/${c.periodKey}`);
      keys.add(`${c.cycleLinkId}/${c.periodKey}`);
      const ok = unique && cap && cap.amountCents === c.resultCents && cap.source?.id === c.id;
      out.push(check('CLO-01', 'integrity', 'bpm', `Clôture ${c.periodLabel} : unique, résultat transféré une seule fois`, 'une capitalisation du même montant, une clôture par période', ok ? 'cohérent' : 'incohérent', ok ? 'passed' : 'failed', [c.id, c.capitalizationId].filter(Boolean)));
    }
    // Reste ouvert : les projets de la vie sans montant attribué ne sont pas consolidés dans le budget de vie.
    out.push({ rule: 'C05', category: 'not-implemented', description: 'Consolidation des projets de la vie sans budget attribué par le budget de vie', expected: 'décision ouverte', observed: 'flux non consolidés (chaque Budget présenté séparément)', result: 'not-run', execution: 'not-run', ids: [] });
    return out;
  },

  debug: {
    views(state, scope) {
      const inScope = (o) => scope === 'all' || o.userId === scope;
      return {
        assemblages: Object.values(state.bpmCompositions)
          .filter(inScope)
          .map((a) => {
            const b = state.budgets[a.budgetId];
            const p = state.patrimoines[a.patrimoineId];
            const cycle = cycleOf(state, a.id);
            return {
              userId: a.userId,
              userLabel: state.users[a.userId]?.label ?? null,
              bpmCompositionId: a.id,
              principalBudgetId: b?.id ?? null,
              principalCoreProjectId: b?.coreProjectId ?? null,
              patrimoineId: p?.id ?? null,
              patrimoineCoreProjectId: p?.coreProjectId ?? null,
              coreProjectShared: !!b && !!p && b.coreProjectId === p.coreProjectId,
              cycleLinkId: cycle?.id ?? null,
              cycleState: cycle?.state ?? null,
              lifeProjectBudgetIds: Object.values(state.budgets).filter((x) => x.parentBudgetId === b?.id).map((x) => x.id),
            };
          }),
        clotures: Object.values(state.closures)
          .filter(inScope)
          .map((c) => ({ closureId: c.id, userId: c.userId, periodKey: c.periodKey, periodStart: c.periodStart, periodEnd: c.periodEnd, result: c.resultCents / 100, formula: c.calculation.formula, parameterRevision: c.calculation.parameter?.revision ?? null, capitalizationId: c.capitalizationId, sourceOperationIds: c.sourceOperationIds })),
      };
    },
    csv: {
      'assemblages.csv': { view: 'assemblages', columns: ['userId', 'userLabel', 'bpmCompositionId', 'principalBudgetId', 'principalCoreProjectId', 'patrimoineId', 'patrimoineCoreProjectId', 'coreProjectShared', 'cycleLinkId', 'cycleState', 'lifeProjectBudgetIds'] },
      'clotures.csv': { view: 'clotures', columns: ['closureId', 'userId', 'periodKey', 'periodStart', 'periodEnd', 'result', 'formula', 'parameterRevision', 'capitalizationId', 'sourceOperationIds'] },
    },
    derivedRelations(state, socle) {
      const rels = [];
      for (const t of Object.values(state.tasks)) {
        const q = socle.modules.core.qualificationOf(state, t);
        if (q.budgetIdDerived) rels.push({ sourceId: t.id, sourceKind: 'task', relation: 'budgetIdDerived (via racine)', targetId: q.budgetIdDerived, userId: t.userId });
      }
      for (const c of Object.values(state.capitalizations)) {
        if (c.source?.id) rels.push({ sourceId: c.id, sourceKind: 'capitalization', relation: `source (${c.source.kind})`, targetId: c.source.id, userId: c.userId });
      }
      for (const c of Object.values(state.closures)) {
        for (const id of c.sourceOperationIds) rels.push({ sourceId: c.id, sourceKind: 'closure', relation: 'opération source du résultat', targetId: id, userId: c.userId });
      }
      return rels;
    },
  },
};
