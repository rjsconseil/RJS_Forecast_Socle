import { bpmStatement } from './bpm-lens.mjs';
/** Lecture exhaustive des flux d’une fenêtre (dépenses par défaut, entrées sur demande) : aucun règlement ni calcul de clôture nouveau. */
export function expenseRegister({
  budget,
  core,
  project,
  statement,
  closures,
  budgets = budget.budgetProjects.filter((b) => b.id === project.budgetProjectId),
  summaries = [],
  kind = 'expense',
}) {
  const ids = new Set(budgets.map((b) => b.id));
  const own = budget.operations.filter((op) => ids.has(op.budgetProjectId) && (kind === 'income' ? op.kind === 'income' : op.kind !== 'income'));
  const closed = (date, id) =>
    closures.some((c) => c.budgetProjectId === id && date >= c.start && date < c.end);
  const statements = budgets.map((b) => ({
    budgetId: b.id,
    data:
      b.id === project.budgetProjectId
        ? statement
        : bpmStatement({
            budget,
            budgetProjectId: b.id,
            start: statement.start,
            end: statement.end,
            today: statement.today,
            closures: closures.filter((c) => c.budgetProjectId === b.id),
          }),
  }));
  // La fenêtre de cette page porte sur le jour planifié. Les dates et montants réels restent intacts.
  const rows = own
    .flatMap((op) => {
      const actual = (op.settlements ?? []).filter(
        (r) => r.occurrenceDate >= statement.start && r.occurrenceDate < statement.end,
      );
      const pending =
        statements
          .find((s) => s.budgetId === op.budgetProjectId)
          ?.data.pending.filter((r) => r.operationId === op.id) ?? [];
      return [
        ...actual.map((r) => ({
          operationId: op.id,
          budgetProjectId: op.budgetProjectId,
          occurrenceDate: r.occurrenceDate,
          actualDate: r.actualDate,
          date: r.occurrenceDate,
          title: op.title,
          centerId: op.centerId ?? null,
          note: op.description ?? '',
          amountCents: r.amountCents,
          plannedCents: op.amountCents,
          status: 'recorded',
          closed: closed(r.actualDate, op.budgetProjectId),
        })),
        ...pending.map((r) => ({
          ...r,
          budgetProjectId: op.budgetProjectId,
          actualDate: null,
          date: r.occurrenceDate,
          note: op.description ?? '',
          plannedCents: r.amountCents,
          status: closed(r.occurrenceDate, op.budgetProjectId) ? 'unrealized' : 'pending',
          closed: closed(r.occurrenceDate, op.budgetProjectId),
        })),
      ];
    })
    .sort(
      (a, b) =>
        a.occurrenceDate.localeCompare(b.occurrenceDate) ||
        a.title.localeCompare(b.title, 'fr') ||
        a.operationId.localeCompare(b.operationId),
    );
  const used = new Set(rows.map((row) => row.operationId));
  const projectCore = core.projects.find((p) => p.id === project.coreProjectId);
  return {
    ...statement,
    budgetProjectId: project.budgetProjectId,
    budgetTitle: budget.budgetProjects.find((p) => p.id === project.budgetProjectId)?.title ?? '',
    coreProject: projectCore ? { id: projectCore.id, title: projectCore.title } : null,
    rows,
    budgets: summaries,
    centers: statements.flatMap(({ budgetId, data }) =>
      data.centers.map((c) => ({
        ...c,
        name:
          budgets.length > 1
            ? `${c.name} · ${budgets.find((b) => b.id === budgetId)?.title ?? ''}`
            : c.name,
      })),
    ),
    operations: own
      .filter((op) => used.has(op.id))
      .map((op) => ({
        ...op,
        budgetTitle: budgets.find((b) => b.id === op.budgetProjectId)?.title ?? '',
        coreProject: (() => {
          const p = core.projects.find(
            (p) => p.id === budgets.find((b) => b.id === op.budgetProjectId)?.coreProjectId,
          );
          return p ? { id: p.id, title: p.title } : null;
        })(),
        center:
          budget.centers.find(
            (c) => c.id === op.centerId && c.budgetProjectId === op.budgetProjectId,
          ) ?? null,
        beneficiary:
          budget.people.find(
            (p) => p.id === op.personId && p.budgetProjectId === op.budgetProjectId,
          ) ?? null,
        provider: (() => {
          const p = budget.providers.find(
            (p) => p.id === op.providerId && p.budgetProjectId === op.budgetProjectId,
          );
          return p
            ? {
                ...p,
                interventions: (p.interventions ?? []).filter((item) => item.operationId === op.id),
              }
            : null;
        })(),
        task: (() => {
          const t = core.tasks.find(
            (t) =>
              t.id === op.coreTaskId &&
              t.projectId === budgets.find((b) => b.id === op.budgetProjectId)?.coreProjectId,
          );
          return t ? { id: t.id, title: t.title } : null;
        })(),
      })),
  };
}
