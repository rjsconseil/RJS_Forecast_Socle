// Briques communes des cas : un budget de vie « type » se décrit en lignes, le moteur les rejoue cycle après cycle.
import { dayOf, cents } from "./engine.mjs";

/**
 * Lignes récurrentes du budget de vie. Chaque ligne : [nom, sens, montant, centre, jour du cycle, options].
 * Options : cadence, variation (centimes ajoutés selon le rang de l'occurrence), settle (règle de règlement).
 */
export function lifeLines(t, lines) {
  const c0 = t.cycles[0];
  for (const [name, direction, amount, center, day, o = {}] of lines) {
    const firstDate = o.firstDate ?? dayOf(c0, day);
    let rank = 0;
    t.recurrence(
      name,
      { direction, amount, center, cadence: o.cadence ?? "monthly", firstDate, endDate: o.endDate, category: o.category, label: o.label },
      {
        settle:
          o.settle ??
          (o.variation
            ? (date) => ({ realizedDate: date, realizedAmount: Math.max(1, amount + o.variation[rank++ % o.variation.length]) })
            : undefined),
      },
    );
  }
}

/** Dépenses ponctuelles réglées, par cycle : { 0: [[nom, montant, centre, jour, options]], ... } */
export function oneOffs(t, byCycle, direction = "charge") {
  for (const [i, list] of Object.entries(byCycle))
    for (const [name, amount, center, day, o = {}] of list)
      t.operation(name, { direction, amount, center, date: dayOf(t.cycles[i], day), ...o });
}

export async function category(t, name, def) {
  const r = await t.B.createCategory(t.ctx, { requestKey: t.key(), label: def.label ?? name, costCenterRef: def.center, cap: def.cap ?? undefined });
  t.categories[name] = r.category.id;
  return r.category;
}

export async function caps(t, caps) {
  const b = t.B.lifeBudgetOf(t.socle.state, t.userId);
  await t.B.setCaps(t.ctx, b.id, { expectedRevision: b.revision, caps });
}

export const euros = (c) => c / 100;
export { cents, dayOf };

// ————— Projets de la vie : enveloppe, parts, retours (commandes du middleware budget, via BPM) —————
const budgetOf = (t, project) => t.socle.state.budgets[t.projects[project].budgetId];

/** Attribue (ou modifie) l'enveloppe d'un projet à une date. */
export function allocate(t, project, amount, date, priority = 0.3) {
  t.at(date, `Enveloppe ${project} : ${amount} €`, async () => {
    const b = budgetOf(t, project);
    await t.P.allocate(t.ctx, b.id, { expectedRevision: b.revision, amount });
  }, priority);
}

/** Part d'une tâche dans l'enveloppe ({ authorizeOverrun } pour autoriser le manque dans la même écriture). */
export function share(t, project, task, amount, date, o = {}, priority = 0.4) {
  t.at(date, `Part ${project} › ${task} : ${amount} €`, async () => {
    const b = budgetOf(t, project);
    await t.P.setTaskShare(t.ctx, b.id, t.projects[project].tasks[task], { expectedRevision: b.revision, amount, ...o });
  }, priority);
}

/** Rend à l'enveloppe la part non consommée d'une tâche terminée. */
export function release(t, project, task, date, priority = 2) {
  t.at(date, `Rendre la part ${project} › ${task}`, async () => {
    const b = budgetOf(t, project);
    const r = await t.P.releaseTaskShare(t.ctx, b.id, t.projects[project].tasks[task], { expectedRevision: b.revision });
    t.released ??= {};
    t.released[`${project}/${task}`] = r.released?.releasedCents ?? null;
  }, priority);
}

/** Retour d'une tâche vers le budget de vie (déclenché quand la tâche est terminée). */
export function taskReturn(t, project, task, def, date, priority = 0.6) {
  t.at(date, `Retour ${project} › ${task}`, async () => {
    const b = budgetOf(t, project);
    await t.P.setTaskReturn(t.ctx, b.id, t.projects[project].tasks[task], { expectedRevision: b.revision, ...def });
  }, priority);
}

/** Entrée créée par le retour d'une tâche (opération ponctuelle ou définition récurrente), ou null. */
export function returnEntry(t, project, task) {
  const ret = budgetOf(t, project).taskReturns?.[t.projects[project].tasks[task]];
  return ret?.entryId ? { id: ret.entryId, kind: ret.entryKind, ret } : null;
}

/** Statut d'une tâche à une date (todo, inProgress, done…). */
export function status(t, project, task, value, date, priority = 1.5) {
  t.at(date, `${project} › ${task} : ${value}`, () => t.taskStatus(project, task, value), priority);
}

/** Temps d'une tâche à une date ({ plannedHours, spentHours }). */
export function time(t, project, task, value, date, priority = 1.4) {
  t.at(date, `${project} › ${task} : temps`, () => t.taskTime(project, task, value), priority);
}
