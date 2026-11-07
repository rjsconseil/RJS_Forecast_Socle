import { check } from '../../socle/object-management/inspect.mjs';
import { today } from '../../socle/clock.mjs';
// Contrôles financiers des projets. Le contexte de période est fourni par l'appelant ;
// ce middleware ne dépend d'aucune composition ni d'aucun service BPM.
import {
  fmt,
  frDate,
  fundingFigures,
  inRegime,
  isValidatedMove,
  projectMoveCents,
  sum,
  taskFunding,
} from './funding.mjs';
export const periodPaidCents = (state, budget, period) =>
  period
    ? sum(
        Object.values(state.operations).filter(
          (o) =>
            isValidatedMove(o, budget) &&
            o.realizedDate >= period.start &&
            o.realizedDate <= period.end,
        ),
        (o) => projectMoveCents(o, budget),
      )
    : null;

export function projectChecks(
  state,
  b,
  fig = fundingFigures(state, b),
  period = null,
) {
  if (!fig.regime) return [];
  const out = [];
  const gap = fig.ceilingCents - fig.sharesCents;
  out.push({
    code: 'paid-ceiling',
    level: fig.paidCents <= fig.ceilingCents ? 'ok' : 'warning',
    taskId: null,
    message: `Réglé sur l’enveloppe depuis son attribution : ${fmt(fig.paidCents)} sur ${fmt(fig.ceilingCents)} (enveloppe et dépassements autorisés)${fig.paidBeforeAllocationCents ? ` ; ${fmt(fig.paidBeforeAllocationCents)} réglés avant, hors enveloppe` : ''}.`,
  });
  if (period) {
    const charges = Object.values(state.operations).filter(
      (o) =>
        isValidatedMove(o, b) &&
        o.realizedDate >= period.start &&
        o.realizedDate <= period.end,
    );
    const unlinked = charges.filter(
      (o) => !o.taskId || state.tasks[o.taskId]?.projectId !== b.coreProjectId,
    );
    out.push({
      code: 'period-reconciliation',
      level: unlinked.length ? 'warning' : 'ok',
      taskId: null,
      message: `Cycle du ${frDate(period.start)} au ${frDate(period.end)} : ${fmt(sum(charges, (o) => projectMoveCents(o, b)))} remontés au budget du projet de vie (remboursements déduits) ; ${unlinked.length ? `${fmt(sum(unlinked, (o) => Math.abs(projectMoveCents(o, b))))} sans tâche du projet, à rapprocher` : 'toutes les charges sont reliées aux tâches du projet'}.`,
    });
  }
  // Projet terminé : l'enveloppe non dépensée n'a plus de tâche à financer ; l'ajuster la rend au budget de vie.
  // Montant conseillé = plus petite enveloppe que allocate() accepte (réglé, parts, dépassements facturés).
  const allDone = (() => {
    const ts = Object.values(state.tasks).filter(
      (t) => t.projectId === b.coreProjectId,
    );
    return ts.length > 0 && ts.every((t) => t.status === 'done');
  })();
  const keepCents = Math.max(
    fig.paidCents - fig.approvedOverrunCents,
    fig.sharesCents - fig.approvedOverrunCents,
    fig.billedOverrunCents ?? 0,
    0,
  );
  const giveBackCents = Number.isInteger(b.allocationCents)
    ? b.allocationCents - keepCents
    : 0;
  out.push(
    gap > 0 && allDone && fig.toPayCents === 0 && giveBackCents > 0
      ? {
          code: 'shares',
          level: 'info',
          taskId: null,
          message: `Projet terminé : ${fmt(giveBackCents)} de l’enveloppe n’ont pas servi. Ramenez l’enveloppe à ${fmt(keepCents)} pour rendre ce reste au budget de vie.`,
          // Geste proposé par la règle (mêmes limites que allocate) : la présentation n'a qu'à l'exécuter.
          action: {
            kind: 'allocate',
            amountCents: keepCents,
            label: `Rendre ${fmt(giveBackCents)} au budget de vie`,
          },
        }
      : gap === 0
        ? {
            code: 'shares',
            level: 'ok',
            taskId: null,
            message: `L’enveloppe du projet (${fmt(fig.ceilingCents)}) est entièrement répartie entre les parts de ses tâches.`,
          }
        : {
            code: 'shares',
            level: 'warning',
            taskId: null,
            message:
              gap > 0
                ? `${fmt(gap)} de l’enveloppe ne sont encore répartis sur aucune tâche (parts : ${fmt(fig.sharesCents)} sur ${fmt(fig.ceilingCents)}).`
                : `Les parts des tâches (${fmt(fig.sharesCents)}) dépassent l’enveloppe (${fmt(fig.ceilingCents)}) de ${fmt(-gap)}.`,
          },
  );
  for (const [taskId, share] of Object.entries(fig.shares)) {
    const title = state.tasks[taskId]?.title ?? taskId;
    const s = fig.byTask[taskId] ?? { engagedCents: 0, unbounded: false };
    if ((s.paidCents ?? 0) > share)
      out.push({
        code: 'task-paid',
        level: 'warning',
        taskId,
        message: `« ${title} » : réglé ${fmt(s.paidCents)}, au-delà de sa part de ${fmt(share)}.`,
      });
    if (s.unbounded)
      out.push({
        code: 'recurrence',
        level: 'warning',
        taskId,
        message: `« ${title} » : une charge récurrente n'a pas de date de fin ; son engagé est compté sur 12 mois.`,
      });
    if (state.tasks[taskId]?.status === 'done') {
      // Tâche terminée : ce qui reste prévu est à régler ou retirer ; la part non utilisée peut revenir à l'enveloppe.
      const f = taskFunding(state, fig, taskId);
      if (f.openCents > 0)
        out.push({
          code: 'done-open',
          level: 'warning',
          taskId,
          message: `« ${title} » est terminée mais garde ${fmt(f.openCents)} de charges prévues non réglées : réglez-les ou retirez-les.`,
        });
      else if (f.unusedCents)
        out.push({
          code: 'done-unused',
          level: 'info',
          taskId,
          message: `« ${title} » est terminée : ${fmt(f.unusedCents)} de sa part n’ont pas servi ; « Rendre à l’enveloppe » ramène sa part à ${fmt(f.paidCents)}.`,
        });
      else
        out.push({
          code: 'done',
          level: 'ok',
          taskId,
          message: `« ${title} » est terminée : sa part (${fmt(share)}) est entièrement réglée.`,
        });
      continue;
    }
    if (s.engagedCents > share)
      out.push({
        code: 'engaged',
        level: 'warning',
        taskId,
        message: `« ${title} » : charges planifiées (${fmt(s.engagedCents)}) au-delà de sa part (${fmt(share)}).`,
      });
    else if (s.engagedCents < share)
      out.push({
        code: 'engaged',
        level: 'info',
        taskId,
        message: `« ${title} » : ${fmt(share - s.engagedCents)} de sa part ne sont pas encore planifiés en charges.`,
      });
    else
      out.push({
        code: 'engaged',
        level: 'ok',
        taskId,
        message: `« ${title} » : charges planifiées égales à sa part (${fmt(share)}).`,
      });
  }
  for (const [taskId, s] of Object.entries(fig.byTask)) {
    if (!(taskId in fig.shares))
      out.push({
        code: 'unshared',
        level: 'warning',
        taskId,
        message: `« ${state.tasks[taskId]?.title ?? taskId} » porte ${fmt(s.engagedCents)} de charges sans part de l’enveloppe : demandez sa part.`,
      });
  }
  if (fig.unsharedChargesCents)
    out.push({
      code: 'no-task',
      level: 'info',
      taskId: null,
      message: `${fmt(fig.unsharedChargesCents)} de charges du projet ne sont reliées à aucune tâche.`,
    });
  return out;
}

export const projectVariables = [
  {
    name: 'projets.chargesReglees',
    label: 'Charges des projets validées',
    unit: 'EUR',
    description:
      'Charges des projets de la vie validées comme réglées pour leurs besoins (opérations réglées des Budgets standards auxquels le budget de vie attribue un montant, depuis la date d’attribution), datées dans la période par leur date réelle. Une charge de projet non validée n’est pas comptée.',
    resolve(ctx) {
      if (!ctx.budgetId)
        return {
          value: null,
          sources: [],
          note: 'Aucun Budget dans le contexte',
        };
      if (!ctx.period)
        return {
          value: null,
          sources: [],
          note: 'Aucune période : cycle à configurer',
        };
      const { start, end } = ctx.period;
      const standards = Object.values(ctx.state.budgets).filter(
        (b) => b.parentBudgetId === ctx.budgetId && inRegime(b),
      );
      const lines = [];
      for (const b of standards) {
        for (const o of Object.values(ctx.state.operations)) {
          if (
            isValidatedMove(o, b) &&
            o.realizedDate >= start &&
            o.realizedDate <= end
          )
            lines.push({ o, b });
        }
      }
      lines.sort((x, y) => x.o.realizedDate.localeCompare(y.o.realizedDate));
      return {
        value: sum(lines, (l) => projectMoveCents(l.o, l.b)) / 100,
        sources: lines.map(({ o, b }) => ({
          id: o.id,
          kind: 'operation',
          label: `${o.label} · ${b.name}${o.direction === 'income' ? ' (remboursement)' : ''}`,
          amount: projectMoveCents(o, b) / 100,
          date: o.realizedDate,
          status: 'realized',
        })),
        note: lines.length
          ? null
          : 'Aucune charge de projet validée dans la période',
      };
    },
  },
];

export function fundingChecks(state, periodOf = () => null) {
  const out = [];
  // Projets de la vie financés par le budget de vie (C05, règles du 4 novembre 2026 [P]).
  const now = today();
  for (const b of Object.values(state.budgets).filter(inRegime)) {
    const fig = fundingFigures(state, b, now);
    out.push(
      check(
        'PRJ-01',
        'integrity',
        'budget',
        `Projet ${b.name} : parts des tâches dans le budget autorisé`,
        'somme des parts ≤ budget attribué + dépassements autorisés',
        `${fig.sharesCents / 100} € sur ${fig.ceilingCents / 100} €`,
        fig.sharesCents <= fig.ceilingCents ? 'passed' : 'failed',
        [b.id],
      ),
    );
    const late = Object.values(state.projectOverruns ?? {}).filter(
      (x) =>
        x.budgetId === b.id &&
        x.status === 'approved' &&
        x.billingDate &&
        x.billingDate < now,
    );
    if (late.length)
      out.push(
        check(
          'PRJ-02',
          'pathway',
          'budget',
          `Projet ${b.name} : dépassement autorisé à facturer au budget de vie`,
          'facturé à la fin du cycle',
          `${late.length} dépassement(s) dont la fin de cycle est passée`,
          'warning',
          [b.id, ...late.map((x) => x.id)],
        ),
      );
    if (
      projectChecks(state, b, fig, periodOf(b.userId, now)).some(
        (c) => c.level === 'warning',
      )
    )
      out.push(
        check(
          'PRJ-03',
          'pathway',
          'budget',
          `Projet ${b.name} : contrôles de fin de cycle`,
          'budget = somme des parts ; charges des tâches planifiées et à jour',
          'au moins un point à revoir',
          'warning',
          [b.id],
        ),
      );
  }
  return out;
}
