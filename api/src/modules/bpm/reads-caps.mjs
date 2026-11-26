// Lectures des plafonds de BPM : un plafond par poste de dépense, revue des dépassements, alertes d'une saisie et
// aperçu avant écriture. Mêmes lignes que le registre (budgetLines, dépenses validées des tâches) ; aucune lecture n'écrit.
// BPM ne lit pas les catégories de dépense du middleware Budget (abandonnées le 22 nov. 2026, à reprendre quand cette
// classification sera mûre) : leurs données restent conservées, mais aucun plafond ni aucune alerte ne les compte.
import { fail } from '../../socle/errors.mjs';
import { date, money, oneOf } from '../../socle/validation.mjs';
import { CADENCES, CAP_LEVEL_PCT, PER_YEAR, monthlyAverageCents, occurrenceDates, periodContaining, projectFundingSource, today } from '../budget/api.mjs';
import { cents } from './format.mjs';


/** @param tools les lectures communes de reads.mjs dont les plafonds ont besoin. */
export function createCapsReads(socle, h, { budget, base, contextOf, statusOf, decorate, validatedProjectLines }) {
  const { om } = socle;
  const capBrief = (r) => ({ capCents: r.capCents, engagedCents: r.engagedCents, marginCents: r.marginCents, usedPct: r.usedPct, over: r.over, near: r.near, level: r.level });
  const capsBrief = (report) => ({
    centers: Object.fromEntries(report.centers.map((c) => [c.ref, capBrief(c)])),
    overCount: report.overCount,
    levels: CAP_LEVEL_PCT,
  });

  // Une échéance non réglée d'une période close reste dans l'historique, mais n'est
  // plus un engagement à payer. Même sélection que les postes et les flux de période.
  const capPlannedLines = (b, lines) => lines.filter((l) => statusOf(b.state, b.cycle, l) !== 'unrealized');

  /** Plafonds de la période lue, poste par poste : même périmètre que les centres (budget de vie + charges de projet validées). */
  function capsRead(b, { withLines = false } = {}) {
    const { start, end } = b.period;
    const realized = [...budget().budgetLines(b.state, [b.comp.budgetId], { from: start, to: end, by: 'realized' }), ...validatedProjectLines(b, { from: start, to: end, by: 'realized' })];
    const planned = capPlannedLines(b, budget().budgetLines(b.state, [b.comp.budgetId], { from: start, to: end, by: 'planned' }));
    const life = b.state.budgets[b.comp.budgetId];
    return budget().capReport({
      centers: budget().costCentersOf(b.state, b.userId),
      caps: life.capsCents ?? {},
      realized,
      planned,
      withLines,
    });
  }

  /** Mois entiers écoulés entre deux dates (AAAA-MM-JJ), jamais négatif. */
  const monthsBetween = (from, to) => {
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    return Math.max(0, (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0));
  };

  /**
   * Revue des plafonds de la période : chaque poste avec son plafond, et les charges qui,
   * ensemble, forment son engagé (même calcul que les alertes). Chaque charge porte sa récurrence et son
   * antériorité, pour décider de ce qu'on peut retirer — la décision reste à l'utilisateur.
   */
  function capsReview(ctx, q = {}) {
    const b = base(ctx, { periodKey: q.period });
    if (!b.period) fail('FORBIDDEN_BY_RULE', 'Cycle à configurer : aucune période à lire.', { field: 'period' });
    const report = capsRead(b, { withLines: true });
    const life = b.state.budgets[b.comp.budgetId];
    const { start, end } = b.period;
    const now = today();
    const projectIds = new Set(validatedProjectLines(b, { from: start, to: end, by: 'realized' }).map((l) => l.id));
    const charges = new Map();
    const chargeOf = (c) => {
      const l = c.line;
      if (!charges.has(l.id)) {
        const v = decorate(b, l);
        const rec = l.recurrenceId ? b.state.recurrences[l.recurrenceId] : null;
        const origin = rec?.firstDate ?? l.plannedDate;
        const project = projectIds.has(l.id) ? b.budgets.find((x) => x.id === l.budgetId) ?? null : null;
        charges.set(l.id, {
          ...v,
          projectCharge: !!project,
          project: project ? { budgetId: project.id, coreProjectId: project.coreProjectId, name: project.name } : null,
          engagedCents: c.engagedCents,
          engagedDate: c.engagedDate,
          engagedAs: c.engagedAs,
          origin,
          sinceMonths: monthsBetween(origin, now < origin ? origin : now),
          newThisPeriod: origin >= start && origin <= end,
          rank: rec ? occurrenceDates(rec, rec.firstDate, l.occurrenceDate ?? l.plannedDate).length : null,
          perYearCents: rec ? rec.amountCents * PER_YEAR[rec.cadence] : null,
          monthlyCents: rec ? monthlyAverageCents(rec.amountCents, rec.cadence) : null,
        });
      }
      return l.id;
    };
    const row = ({ lines, ...r }) => ({ ...r, chargeIds: lines.sort((x, y) => y.engagedCents - x.engagedCents).map(chargeOf) });
    const centers = report.centers.map(row);
    // À compenser sur les autres postes : la somme des dépassements des postes plafonnés.
    const toCompensateCents = centers.reduce((t, c) => t + (c.over ? -c.marginCents : 0), 0);
    const capped = centers.filter((r) => r.capCents !== null);
    const { figures } = h.figuresFor(b.state, b.userId, ['bpm.soldeAttendu', 'bpm.resultatPrevu'], { periodKey: b.period.key });
    return {
      context: contextOf(b),
      lifeBudget: { budgetId: life.id, revision: life.revision, capsCents: life.capsCents ?? {} },
      centers,
      charges: Object.fromEntries(charges),
      totals: {
        cappedCount: capped.length,
        overCount: report.overCount,
        toCompensateCents,
        // Marge restante sous les plafonds respectés.
        headroomCents: centers.filter((c) => c.capCents !== null && !c.over).reduce((t, c) => t + c.marginCents, 0),
        expectedCents: cents(figures['bpm.soldeAttendu'].value),
        initialCents: cents(figures['bpm.resultatPrevu'].value),
        // Lecture d'une période terminée ou close : un bilan, plus un budget à piloter (messages au passé, aucun nouvel achat).
        reading: b.period.status ?? 'current',
        closedResultCents: b.period.closureId ? (b.state.closures[b.period.closureId]?.resultCents ?? null) : null,
      },
    };
  }

  /** Lecture des plafonds de la période : tous les postes de dépense, avec ou sans plafond (jamais bloquants). */
  function spendingCaps(ctx, q = {}) {
    const b = base(ctx, { periodKey: q.period });
    const life = b.state.budgets[b.comp.budgetId];
    const { centers, overCount, alerts } = b.period ? capsRead(b) : { centers: [], overCount: 0, alerts: [] };
    return {
      context: contextOf(b),
      lifeBudget: { budgetId: life.id, revision: life.revision, capsCents: life.capsCents ?? {} },
      centers,
      overCount,
      alerts,
      // Seuils des niveaux de consommation (Budget, seule source) : la fenêtre du plafond colore avec eux.
      levels: CAP_LEVEL_PCT,
    };
  }

  /**
   * Alertes de plafond touchées par une dépense, dans la période de sa date (lecture après écriture).
   * Les périodes futures sont calculées directement ; aucune limite de pagination historique.
   */
  function capAlertsFor(ctx, { date: d, costCenterRef, direction }) {
    if (direction !== 'charge' || !d) return [];
    const b = base(ctx);
    if (!b.cs) return [];
    const period = periodContaining(d, b.cycle.anchorDay);
    if (period.index < b.cs.first.index) return [];
    const report = capsRead({ ...b, period });
    return report.alerts.filter((a) => a.ref === costCenterRef);
  }

  /** Simulation en mémoire : mêmes lignes Budget et mêmes plafonds, aucune écriture ni ID créé. */
  function previewCaps(ctx, input = {}) {
    const b = base(ctx);
    if (!b.cs) fail('FORBIDDEN_BY_RULE', 'Configurez le cycle avant de consulter les plafonds.');
    const direction = oneOf('direction', input.direction, ['income', 'charge']);
    const cadence = oneOf('cadence', input.cadence, ['once', ...CADENCES], 'once');
    const recurring = cadence !== 'once';
    const kind = recurring ? 'recurrence' : 'operation';
    const original = input.replaceId ? om.owned(b.state, kind, input.replaceId, b.userId) : null;
    const recurrence = input.settle && input.recurrenceId ? om.owned(b.state, 'recurrence', input.recurrenceId, b.userId) : null;
    const budgetId = original?.budgetId ?? recurrence?.budgetId ?? input.budgetId ?? b.comp.budgetId;
    om.owned(b.state, 'budget', budgetId, b.userId);
    const ref = input.costCenterRef ?? 'std:divers';
    const amountCents = money('amount', input.amount, { positive: true });
    const d = date(recurring ? 'firstDate' : 'date', recurring ? input.firstDate : input.date, { required: true });
    const item = {
      ...recurrence, ...original, id: original?.id ?? '__preview__', userId: b.userId, budgetId,
      direction, label: input.label || 'Aperçu', amountCents,
      costCenterId: ref.startsWith('std:') ? null : ref,
      standardCostCenter: ref.startsWith('std:') ? ref.slice(4) : null,
      taskId: input.taskId ?? original?.taskId ?? recurrence?.taskId ?? null,
      fundingSource: input.fundingSource ?? original?.fundingSource ?? recurrence?.fundingSource,
      accountingDate: input.accountingDate ?? original?.accountingDate,
    };
    if (recurring) Object.assign(item, { cadence, firstDate: d, endDate: date('endDate', input.endDate) });
    else Object.assign(item, {
      date: d, status: original?.status ?? input.status ?? 'planned',
      realizedDate: original?.realizedDate ?? (input.status === 'realized' ? date('realizedDate', input.realizedDate ?? d, { required: true }) : null),
      realizedAmountCents: original?.realizedAmountCents ?? (input.status === 'realized' ? money('realizedAmount', input.realizedAmount ?? input.amount, { positive: true }) : null),
    });
    if (input.settle) {
      item.status = 'realized';
      item.realizedDate = date('realizedDate', input.realizedDate ?? d, { required: true });
      item.realizedAmountCents = money('realizedAmount', input.realizedAmount ?? input.amount, { positive: true });
      if (recurrence) Object.assign(item, { recurrenceId: recurrence.id, occurrenceDate: date('occurrenceDate', input.occurrenceDate, { required: true }) });
    }
    // Une définition récurrente passée est évaluée sur la période actuelle ; une saisie future sur sa première période.
    const effectiveDate = recurring ? (d > b.cs.current.start ? d : b.cs.current.start) : item.accountingDate ?? item.realizedDate ?? d;
    const period = periodContaining(effectiveDate, b.cycle.anchorDay);
    const table = recurring ? 'recurrences' : 'operations';
    const state = { ...b.state, [table]: { ...b.state[table], [item.id]: item } };
    const before = capsRead({ ...b, period });
    const relevant = (r) => ({ center: r.centers.find((c) => c.ref === ref) ?? null });
    if (budgetId !== b.comp.budgetId && projectFundingSource(item, b.state.budgets[budgetId]) === 'patrimoine') return { mutation: false, period, before: relevant(before), after: relevant(before), alerts: [], note: 'Ce flux sera imputé au patrimoine après validation, hors plafonds du cycle.' };
    let after = capsRead({ ...b, state, period });
    // Pour un projet, anticiper la charge avant sa validation dans le budget de vie.
    if (budgetId !== b.comp.budgetId) {
      const window = { from: period.start, to: period.end };
      const candidate = l => recurring ? l.recurrenceId === item.id : l.operationId === item.id;
      const keep = l => !candidate(l);
      const realized = [...budget().budgetLines(b.state, [b.comp.budgetId], { ...window, by: 'realized' }), ...validatedProjectLines(b, { ...window, by: 'realized' }).filter(keep), ...budget().budgetLines(state, [budgetId], { ...window, by: 'realized' }).filter(candidate)];
      const planned = capPlannedLines({ ...b, state }, [...budget().budgetLines(b.state, [b.comp.budgetId], { ...window, by: 'planned' }), ...budget().budgetLines(state, [budgetId], { ...window, by: 'planned' }).filter(candidate)]);
      after = budget().capReport({ centers: budget().costCentersOf(state, b.userId), caps: state.budgets[b.comp.budgetId].capsCents ?? {}, realized, planned });
    }
    return { mutation: false, period, before: relevant(before), after: relevant(after),
      alerts: direction === 'charge' ? after.alerts.filter((a) => a.ref === ref) : [],
      note: budgetId !== b.comp.budgetId ? 'Impact estimé après validation de la charge du projet.' : null };
  }

  /** Flux d'une période : réalisé à sa date réelle, échéances non réglées à leur date prévue.
   * Le registre garde sa sélection par date prévue ; ces listes expliquent les chiffres des postes et revenus.
   */
  return { capsBrief, capsRead, capsReview, spendingCaps, capAlertsFor, previewCaps };
}
