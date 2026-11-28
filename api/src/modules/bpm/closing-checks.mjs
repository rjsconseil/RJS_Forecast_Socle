import { frDate, plural, fmt } from './format.mjs';
// Contrôles de cohérence d'un cycle (page « Clôture du cycle ») : avant de figer le cycle, la clôture vérifie que
// tout ce qui a été fait se tient. Trois niveaux, du plus important au moins crucial :
// - bloquant (`blocking`) : la clôture est refusée tant qu'il n'est pas bon (points traités,
//   données intègres, résultat qui se recalcule à l'identique) ;
// - à voir (`warning`) : la clôture reste possible, le contrôle est gardé dans la clôture (mouvements sans poste) ;
// - pour information (`info`) : règlements différents du prévu, règlements faits après le dernier jour.
// États : ok, warn (à voir), fail (bloquant), later (pas encore vérifiable).
//
// Chaque contrôle porte sa résolution : ce qui ne va pas, pourquoi c'est important, les étapes pour le résoudre
// (avec l'endroit du site où agir), sa progression et, pour chaque élément concerné, où le corriger. La page relit
// les contrôles à chaque écriture : l'utilisateur revient et voit si son action a clos l'incohérence ou s'il reste
// au moins une étape. Un nouveau contrôle = une entrée de la liste rendue ; la page la présente sans autre code.
const signed = (c) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${fmt(Math.abs(c))}`;
const RANK = { fail: 0, warn: 1, later: 2, ok: 3 };
/** Montant signé selon le sens : une charge en négatif, une entrée en positif. */
const flowOf = (direction, c) => (c === null || c === undefined ? null : direction === 'income' ? c : -c);
const LEVEL = { blocking: 0, warning: 1, info: 2 };
const ITEMS = 12;

/**
 * @param s état du parcours : phase, period, points, counts, netCents, closing (aperçu), b (lecture)
 * @param t outils : budget (module), reads (decorate), inspector (contrôles du socle)
 */
export function closingChecks(s, t) {
  const { phase, period, points, counts } = s;
  const { state, userId, comp } = s.b;
  const closingNow = phase === 'to_close';
  const checks = [];
  const add = (c) => checks.push({ items: [], target: null, ...c });
  /** Où corriger une ligne : sa fiche de projet, sinon la page des échéances (point) ou des mouvements. */
  const lineTarget = (id, coreProjectId, page = 'mouvements') => ({ kind: 'line', id, coreProjectId: coreProjectId ?? null, page });

  // 1. Points du cycle : chacun clos, ou reporté par décision.
  const open = points.filter((p) => p.state === 'open');
  const pointsTotal = counts.total;
  const pointsDone = counts.closed + counts.deferred;
  add({
    key: 'points', level: 'blocking', label: 'Points du cycle traités',
    state: open.length ? (closingNow ? 'fail' : 'warn') : 'ok',
    value: `${pointsDone} / ${pointsTotal}`,
    text: open.length
      ? `${plural(open.length, 'point ouvert', 'points ouverts')} : ${closingNow ? 'à valider, ou à revoir dans un cycle à venir, avant la clôture' : 'à clore au plus tôt, là où ils vivent'}.`
      : 'Chaque point du cycle est clos ou reporté par décision.',
    resolution: {
      problem: open.length ? `${plural(open.length, 'point reste ouvert', 'points restent ouverts')}${closingNow ? ' : la clôture attend qu’ils soient validés ou reportés' : ''}.` : null,
      why: 'Chaque évènement du cycle doit être réglé, écarté ou reporté pour que le bilan et le résultat soient justes.',
      steps: closingNow
        ? [
            { text: 'Dans « À valider », validez chaque point ouvert : réglé à sa date prévue, ou avec une autre date, un autre montant.', target: { kind: 'section', id: 'closing-path-title' } },
            { text: 'Un point qui ne sera pas validé dans ce cycle : « Ne pas valider ici » et choisissez le cycle où le revoir.', target: { kind: 'section', id: 'closing-path-title' } },
            { text: 'Quand il n’en reste aucun, ce contrôle passe au vert.' },
          ]
        : [
            { text: 'Réglez ou recevez chaque échéance passée là où elle vit (page Échéances, fiche du projet).', target: { kind: 'page', path: 'echeances' } },
            { text: 'Écartez celles qui n’auront pas lieu ; les décisions de financement se prennent dans les règlements des projets.', target: { kind: 'decisions' } },
            { text: 'Revenez ici : chaque point se clôt à l’instant et le compte se met à jour.' },
          ],
      progress: { done: pointsDone, total: pointsTotal },
    },
    items: open.slice(0, ITEMS).map((p) => ({
      id: p.id, label: p.label, detail: [p.statusLabel, p.detail].filter(Boolean).join(' · '), amountCents: flowOf(p.direction, p.plannedCents),
      target: p.kind === 'decision' ? { kind: 'decisions' } : lineTarget(p.lineId, p.project?.coreProjectId, 'echeances'),
    })),
    more: Math.max(0, open.length - ITEMS),
    target: 'closing-path-title',
  });

  // 2. Données intègres : aucun contrôle du socle en échec sur un objet de ce user.
  let broken = [];
  const objectOf = (id) => {
    for (const col of ['operations', 'recurrences', 'budgets', 'projectOverruns', 'taskBudgetRequests', 'lifeGoals', 'patrimoines', 'cycleLinks', 'closures', 'capitalizations', 'bpmCompositions', 'coreProjects', 'tasks']) {
      const o = state[col]?.[id];
      if (o) return o.userId === userId ? o : null;
    }
    return null;
  };
  try {
    broken = t.inspector.checks(state)
      .filter((c) => c.result === 'failed')
      .flatMap((c) => (c.anomalies?.length ? c.anomalies.map((a) => ({ id: a.id, message: a.message ?? c.description })) : (c.ids ?? []).map((id) => ({ id, message: c.description }))))
      .filter((a) => objectOf(a.id));
  } catch {
    broken = [];
  }
  const repairTarget = (o) => {
    if (o.kind === 'operation') return lineTarget(o.id, o.budgetId === comp.budgetId ? null : state.budgets[o.budgetId]?.coreProjectId);
    if (o.kind === 'recurrence') return { kind: 'page', path: 'budget-type' };
    if (o.kind === 'budget' || o.kind === 'coreProject') return { kind: 'project', coreProjectId: o.coreProjectId ?? o.id };
    return null;
  };
  add({
    key: 'integrity', level: 'blocking', label: 'Données intègres',
    state: broken.length ? 'fail' : 'ok',
    value: broken.length ? plural(broken.length, 'anomalie') : 'Aucune anomalie',
    text: broken.length ? 'Des références ou des valeurs ne se tiennent plus : à corriger avant de figer le cycle.' : 'Références et valeurs des objets du cycle cohérentes (contrôles du socle).',
    resolution: {
      problem: broken.length ? `${plural(broken.length, 'anomalie', 'anomalies')} dans les données du cycle.` : null,
      why: 'Une référence cassée (poste, catégorie, projet ou tâche disparus) fausse les sommes et le bilan qui sera figé.',
      steps: [
        { text: 'Ouvrez chaque élément concerné et corrigez la référence signalée (poste, catégorie, projet, tâche).' },
        { text: 'Si l’élément ne s’ouvre pas sur le site, notez son identifiant : il se corrige par l’administration.' },
        { text: 'Revenez ici : le contrôle se relit à l’instant.' },
      ],
      progress: null,
    },
    items: broken.slice(0, ITEMS).map((a) => {
      const o = objectOf(a.id);
      return { id: a.id, label: a.message, detail: o?.label ?? o?.name ?? a.id, amountCents: null, target: o ? repairTarget(o) : null };
    }),
    more: Math.max(0, broken.length - ITEMS),
  });

  // 3. Résultat : il se recalcule à l'identique (aperçu de la clôture = solde réalisé du cycle).
  const preview = s.closing?.preview ?? null;
  const same = !preview || preview.resultCents === s.netCents;
  add({
    key: 'result', level: 'blocking', label: 'Résultat recalculé à l’identique',
    state: !closingNow ? (s.netCents === null ? 'later' : 'ok') : same ? 'ok' : 'fail',
    value: s.netCents === null ? '—' : signed(s.netCents),
    text: same ? 'Entrées reçues moins sorties payées : le résultat versé au patrimoine sera celui-ci.' : `Écart entre le solde réalisé (${signed(s.netCents)}) et le résultat à capitaliser (${signed(preview.resultCents)}) : relisez les règlements.`,
    resolution: {
      problem: same ? null : `Écart de ${signed((preview?.resultCents ?? 0) - (s.netCents ?? 0))} entre le solde réalisé et le résultat à capitaliser.`,
      why: 'Le résultat versé au patrimoine doit être celui qui se lit dans le cycle, au centime près.',
      steps: [
        { text: 'Relisez les règlements du cycle (montants, dates réelles) dans Mouvements.', target: { kind: 'page', path: 'mouvements' } },
        { text: 'Corrigez la saisie en cause : le résultat se recalcule aussitôt.' },
        { text: 'Revenez ici : si l’écart persiste, il vient des données, à signaler.' },
      ],
      progress: null,
    },
    target: 'closing-bilan-title',
  });

  // 4. Mouvements rattachés à un poste (à voir).
  const window = { from: period.start, to: period.end };
  const lines = [
    ...t.budget.budgetLines(state, [comp.budgetId], { ...window, by: 'realized' }),
    ...t.budget.budgetLines(state, [comp.budgetId], { ...window, by: 'planned' }).filter((l) => !l.settled),
  ].map((l) => t.reads.decorate(s.b, l));
  const unknown = lines.filter((l) => !l.centerKnown);
  add({
    key: 'centers', level: 'warning', label: 'Mouvements rattachés à un poste',
    state: unknown.length ? 'warn' : 'ok',
    value: unknown.length ? `${unknown.length} sans poste` : 'Tous rattachés',
    text: unknown.length ? 'Sans poste, un mouvement échappe aux plafonds et au bilan par nature : précisez-le.' : 'Chaque mouvement du cycle compte dans son poste, ses plafonds et sa nature.',
    resolution: {
      problem: unknown.length ? `${plural(unknown.length, 'mouvement n’a', 'mouvements n’ont')} pas de poste (ou un poste retiré).` : null,
      why: 'Sans poste, un mouvement échappe aux plafonds et au bilan par nature du cycle.',
      steps: [
        { text: 'Ouvrez chaque mouvement concerné, puis « Modifier » : choisissez son poste.' },
        { text: 'Revenez ici : le contrôle compte ceux qui restent.' },
      ],
      progress: { done: lines.length - unknown.length, total: lines.length },
    },
    items: unknown.slice(0, ITEMS).map((l) => ({ id: l.id, label: l.label, detail: l.costCenterLabel ?? 'Poste à préciser', amountCents: flowOf(l.direction, l.realizedCents ?? l.plannedCents), target: lineTarget(l.id, null) })),
    more: Math.max(0, unknown.length - ITEMS),
  });

  // Les dépassements de plafond ne sont pas des contrôles : ce sont des faits marquants du cycle (bilan, page de
  // clôture « Faits marquants »), jamais une incohérence à corriger ni un frein à la clôture (28 nov. 2026).

  // 5. Règlements différents du prévu, et règlements faits après le dernier jour (pour information).
  const settled = points.filter((p) => p.kind === 'line' && p.state === 'closed' && p.outcome === 'settled');
  const differ = settled.filter((p) => p.realizedCents !== null && p.realizedCents !== undefined && p.realizedCents !== p.plannedCents);
  const gap = differ.reduce((g, p) => g + (p.direction === 'income' ? p.realizedCents - p.plannedCents : p.plannedCents - p.realizedCents), 0);
  add({
    key: 'variances', level: 'info', label: 'Règlements conformes au prévu',
    state: differ.length ? 'warn' : 'ok',
    value: differ.length ? `${plural(differ.length, 'écart')} · ${signed(gap)}` : 'Aucun écart',
    text: differ.length ? 'Montants réglés différents des montants prévus (effet sur le résultat).' : 'Chaque échéance réglée l’a été au montant prévu.',
    resolution: {
      problem: differ.length ? `${plural(differ.length, 'règlement diffère', 'règlements diffèrent')} du montant prévu (${signed(gap)} sur le résultat).` : null,
      why: 'Un écart peut être réel (un prix qui change) ou une erreur de saisie : à vérifier une fois.',
      steps: [
        { text: 'Vérifiez chaque montant réglé ; une erreur se corrige dans le détail de la ligne.' },
        { text: 'Si l’écart est réel et revient chaque mois, ajustez le budget récurrent.', target: { kind: 'page', path: 'budget-type' } },
      ],
      progress: null,
    },
    items: differ.slice(0, ITEMS).map((p) => ({ id: p.id, label: p.label, detail: `prévu ${fmt(p.plannedCents)}, réglé ${fmt(p.realizedCents)}`, amountCents: p.direction === 'income' ? p.realizedCents - p.plannedCents : p.plannedCents - p.realizedCents, target: lineTarget(p.lineId, p.project?.coreProjectId) })),
    more: Math.max(0, differ.length - ITEMS),
  });
  const late = settled.filter((p) => p.realizedDate && p.realizedDate > period.end);
  add({
    key: 'late', level: 'info', label: 'Règlements dans le cycle',
    state: late.length ? 'warn' : 'ok',
    value: late.length ? `${late.length} après le ${frDate(period.end)}` : 'Tous dans le cycle',
    text: late.length ? 'Réglés après le dernier jour : ils comptent dans le cycle de leur date réelle.' : 'Les échéances du cycle ont été réglées pendant le cycle.',
    resolution: {
      problem: late.length ? `${plural(late.length, 'échéance réglée', 'échéances réglées')} après le ${frDate(period.end)}.` : null,
      why: 'Elles comptent dans le cycle de leur date réelle, pas dans celui-ci.',
      steps: [
        { text: 'Rien à corriger si la date réelle est juste.' },
        { text: 'Si elle est fausse, corrigez-la dans le détail de la ligne.' },
      ],
      progress: null,
    },
    items: late.slice(0, ITEMS).map((p) => ({ id: p.id, label: p.label, detail: `réglée le ${frDate(p.realizedDate)}`, amountCents: flowOf(p.direction, p.realizedCents), target: lineTarget(p.lineId, p.project?.coreProjectId) })),
    more: Math.max(0, late.length - ITEMS),
  });

  checks.sort((a, z) => LEVEL[a.level] - LEVEL[z.level] || RANK[a.state] - RANK[z.state]);
  const count = (st) => checks.filter((c) => c.state === st).length;
  return {
    items: checks,
    ok: count('ok'),
    warn: count('warn'),
    fail: count('fail'),
    later: count('later'),
    total: checks.length,
    /** Clôture permise : aucun contrôle bloquant en échec. */
    blocking: checks.filter((c) => c.level === 'blocking' && c.state === 'fail').map((c) => c.label),
  };
}
