// Import des données du site de référence RJS_Forecast (`site/data/*.json`) dans le store du socle.
// Usage : API arrêtée (un seul écrivain), puis
//   node api/scripts/import-rjs-forecast.mjs [--source <dossier site/data>] [--data <store.json>]
// Le store est sauvegardé avant toute écriture. Les objets existants ne sont pas touchés ; chaque
// objet importé reçoit un ID de la politique du socle et garde son ID d'origine dans `importRef`.
// Phase 1 (une seule écriture) : users, projets et tâches du noyau, Budgets, Patrimoines, compositions,
// cycles, centres, opérations, récurrences et règlements, objectifs. Phase 2 : les périodes closes du
// lien principal sont re-clôturées par la commande réelle `closePeriod`, dans l'ordre, et le résultat
// recalculé est comparé au résultat enregistré par la référence.
// Ce qui n'a pas de contrat dans le socle est conservé tel quel dans `data/imports/rjs-forecast/`.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createSocle } from '../src/socle/index.mjs';
import { SOCLE_MODULES } from '../src/modules/index.mjs';
import { DEFAULT_VISION } from '../src/modules/bpm/reads.mjs';
import { GOAL_TYPES } from '../src/modules/bpm/projection.mjs';
import { isOccurrence } from '../src/modules/budget/recurrence.mjs';
import { STORE_SCHEMA } from '../src/socle/store.mjs';

const SOURCE = 'rjs-forecast';
const API_DIR = resolve(import.meta.dirname, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const SOURCE_DIR = resolve(arg('source', resolve(API_DIR, '../../RJS_Forecast/site/data')));
const DATA_FILE = resolve(arg('data', process.env.J1_DATA_FILE ?? join(API_DIR, 'data/store.json')));
const OUT_DIR = join(DATA_FILE, '..', 'imports', SOURCE);

const read = async (name) => JSON.parse(await readFile(join(SOURCE_DIR, name), 'utf8'));
const [U, W, BM, BPM, PM, L, ENT, CONF] = await Promise.all(
  ['utilisateurs.json', 'workspace.json', 'budget-management.json', 'budget-patrimoine-management.json', 'patrimoine-management.json', 'patrimoine-budget-ledger.json', 'entreprise-pilotage.json', 'configuration.json'].map(read),
);

/** Types de la référence → clés du paramètre `users.types` (lettres, sans tiret). */
const USER_TYPES = {
  famille: { key: 'famille', label: 'Famille' },
  celibataire: { key: 'celibataire', label: 'Célibataire' },
  'entreprise-personnelle': { key: 'entreprisePersonnelle', label: 'Entreprise personnelle' },
  association: { key: 'association', label: 'Association' },
  'personne-physique': { key: 'personnePhysique', label: 'Personne physique' },
};
/** Propriétaire « RJS » des projets du workspace sans entité : le user Roosevelt de la référence. */
const WORKSPACE_OWNER = { RJS: '6309FB40' };

const euros = (cents) => (cents === null || cents === undefined ? null : cents / 100);
const firstOfMonth = (ymd) => `${ymd.slice(0, 7)}-01`;
const nextMonth = (ymd) => {
  const [y, m] = ymd.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};
const joinText = (parts) => parts.filter(([, v]) => v && String(v).trim()).map(([k, v]) => (k ? `${k} : ${v}` : v)).join('\n') || '';

// ---------- propriété des projets du noyau ----------

const projectOwner = new Map();
const own = (projectId, userId) => projectId && userId && !projectOwner.has(projectId) && projectOwner.set(projectId, userId);
for (const p of W.projects) own(p.id, p.entityId);
for (const b of BM.budgetProjects) own(b.coreProjectId, b.entityId);
for (const p of BPM.projects) {
  own(p.coreProjectId, p.ownerUserId);
  own(p.patrimoineCoreProjectId, p.ownerUserId);
}
for (const p of PM.projects) own(p.coreProjectId, p.entityId);
for (const p of W.projects) own(p.id, WORKSPACE_OWNER[p.owner]);

const report = { source: SOURCE_DIR, dataFile: DATA_FILE, startedAt: new Date().toISOString(), counts: {}, notes: [], closures: [] };
const unmapped = {
  description: "Données de la référence sans contrat dans le socle : conservées telles quelles, rien n'est perdu.",
  ideas: BM.operations.filter((o) => o.decision !== 'approved'),
  budgetPeople: BM.people,
  budgetProviders: BM.providers,
  budgetProjectsPlanning: BM.budgetProjects.map(({ id, plannedBudgetCents, taskAllocations, financialScope, startDate, dueDate }) => ({ id, plannedBudgetCents, taskAllocations, financialScope, startDate, dueDate })),
  patrimoineProjects: PM.projects,
  patrimoineAllocations: PM.allocations,
  patrimoineAssets: PM.assets,
  patrimoinePeople: PM.people,
  patrimoineProviders: PM.providers,
  patrimoineOperations: PM.operations,
  otherClosures: [], // clôtures des liens secondaires (projets de la vie) : sans contrat de clôture propre
  entityTransfers: L.entityTransfers,
  bpmProfiles: BPM.projects.filter((p) => p.profile).map(({ id, profile }) => ({ id, profile })),
  enterprise: ENT,
  userPerimeters: U.perimeters,
  configuration: CONF,
  unownedProjects: W.projects.filter((p) => !projectOwner.has(p.id)),
  operationsNotes: [],
};
const note = (msg) => report.notes.push(msg);
const count = (k, n = 1) => (report.counts[k] = (report.counts[k] ?? 0) + n);

// ---------- sauvegarde puis ouverture du socle (refusée si l'API tient le verrou) ----------

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = join(DATA_FILE, '..', `store.before-${SOURCE}-${stamp}.json`);
await copyFile(DATA_FILE, backup);
report.backup = backup;

const socle = await createSocle({ dataFile: DATA_FILE, modules: SOCLE_MODULES });
try {
  const already = Object.values(socle.state.users).find((u) => u.importRef?.source === SOURCE);
  if (already) throw new Error(`Import déjà fait (user ${already.id} ← ${already.importRef.id}). Restaurer une sauvegarde avant de recommencer.`);

  const { users, core, budget, patrimoine } = socle.modules;
  const om = socle.om;
  const plans = []; // clôtures à rejouer en phase 2

  await socle.store.mutate((draft) => {
    const now = new Date().toISOString();
    const tx = { draft, command: `import ${SOURCE}`, now, created: [], updated: [], unchanged: false, userId: null, requestKey: null };
    const tag = (obj, id, extra) => {
      obj.importRef = { source: SOURCE, id, ...(extra ?? {}) };
      return obj;
    };

    // Types d'utilisateur de la référence ajoutés au paramètre administré.
    const types = socle.parameters.effective(draft, 'users.types');
    const missingTypes = Object.values(USER_TYPES).filter((t) => !types.value.some((v) => v.key === t.key));
    if (missingTypes.length) {
      socle.parameters.write(tx, 'users.types', [...types.value, ...missingTypes], { expectedRevision: types.revision, note: `Import ${SOURCE} : types des users de référence` });
      note(`Types d'utilisateur ajoutés : ${missingTypes.map((t) => t.label).join(', ')}.`);
    }

    for (const ru of U.users) {
      const user = tag(users.buildUser(tx, { label: ru.label, userType: USER_TYPES[ru.entityType]?.key }), ru.id, { active: ru.active, entityType: ru.entityType });
      tx.userId = user.id;
      count('users');

      // Projets et tâches du noyau.
      const projects = new Map();
      for (const p of W.projects.filter((x) => projectOwner.get(x.id) === ru.id)) {
        let dates = { startDate: p.startDate || null, dueDate: p.dueDate || null };
        if (dates.startDate && dates.dueDate && dates.startDate > dates.dueDate) {
          note(`Projet ${p.id} : début après l'échéance, début retiré.`);
          dates = { ...dates, startDate: null };
        }
        const description = joinText([[null, p.summary], ['Critères de réussite', p.successCriteria], ['Prochaine action', p.nextAction], ['Notes internes', p.internalNotes]]);
        projects.set(p.id, tag(core.buildProject(tx, { title: p.title, description, priority: p.priority, ...dates }), p.id));
        count('coreProjects');
      }
      const tasks = new Map();
      for (const t of W.tasks.filter((x) => projects.has(x.projectId))) {
        let dates = { startDate: t.plannedDate || null, dueDate: t.dueDate || null };
        if (dates.startDate && dates.dueDate && dates.startDate > dates.dueDate) {
          note(`Tâche ${t.id} : date prévue après l'échéance, date prévue retirée.`);
          dates = { ...dates, startDate: null };
        }
        const description = joinText([[null, t.description], ['Critère de fin', t.completionCriteria], ['Résultat', t.result]]);
        const task = core.buildTask(tx, { title: t.title, description, status: t.status, plannedHours: t.estimatedHours ?? null, spentHours: t.spentHours ?? 0, projectId: projects.get(t.projectId).id, ...dates });
        tasks.set(t.id, tag(task, t.id));
        count('tasks');
      }

      // Triplet BPM : racine = projet noyau du BPM principal, Budget « Projet de vie » = budget principal.
      const main = BPM.projects.find((p) => p.ownerUserId === ru.id && p.defaultForEntity);
      if (!main) {
        note(`User ${ru.id} : aucun Budget/Patrimoine principal dans la référence, triplet non créé.`);
        continue;
      }
      const root = projects.get(main.coreProjectId) ?? tag(core.buildProject(tx, { title: 'Projet de vie', description: 'Racine noyau commune au Budget « Projet de vie » et au Patrimoine.' }), main.coreProjectId);
      const usedRoots = new Set([root.id]);
      const life = tag(budget.buildLifeBudget(tx, { coreProjectId: root.id }), main.budgetProjectId);
      count('budgets');

      const refClosures = L.closures.filter((c) => c.linkId === main.linkId).sort((a, b) => a.start.localeCompare(b.start));
      const userOps = BM.operations.filter((o) => BM.budgetProjects.find((b) => b.id === o.budgetProjectId)?.entityId === ru.id);
      const firstDate = userOps.map((o) => o.firstDate).filter(Boolean).sort()[0] ?? null;
      const cycleStart = refClosures.length ? refClosures[0].start : firstDate ? firstOfMonth(firstDate) : null;

      // Stock d'ouverture : celui du grand livre avant la première clôture, sinon les actifs valorisés à l'ouverture.
      const ppm = PM.projects.find((p) => p.id === main.patrimoineProjectId);
      let openingStockCents = null;
      if (refClosures.length) openingStockCents = refClosures[0].patrimoineAfterCents - refClosures[0].patrimoineFlowAfterCents;
      else if (cycleStart) {
        const assets = PM.assets.filter((a) => a.projectId === main.patrimoineProjectId);
        const values = assets.map((a) => (a.valuations ?? []).filter((v) => v.date <= cycleStart).sort((x, y) => x.date.localeCompare(y.date)).at(-1)?.valueCents ?? null);
        if (assets.length && values.every((v) => v !== null)) openingStockCents = values.reduce((s, v) => s + v, 0) - assets.reduce((s, a) => s + (a.liabilityCents ?? 0), 0);
      }
      const pat = tag(
        patrimoine.buildPatrimoine(tx, {
          coreProjectId: root.id,
          principalBudgetId: life.id,
          openingStock: euros(openingStockCents),
          openingDate: openingStockCents === null ? null : cycleStart,
          objective: ppm?.lifecycle?.targetCents > 0 ? euros(ppm.lifecycle.targetCents) : null,
        }),
        main.patrimoineProjectId ?? main.id,
      );
      const vision = main.vision ? { ...DEFAULT_VISION, annualReturnPct: main.vision.returnPct ?? null, savingsTargetCents: main.vision.savingsTargetCents ?? null } : null;
      const comp = tag(om.create(tx, 'bpmComposition', { label: `BPM de ${user.label}`, budgetId: life.id, patrimoineId: pat.id, coreProjectId: root.id, vision }), main.id);
      tag(om.create(tx, 'cycleLink', { bpmCompositionId: comp.id, frequency: 'monthly', anchorDay: cycleStart ? 1 : null, startDate: cycleStart, state: cycleStart ? 'active' : 'to_configure' }), main.linkId);
      count('bpmCompositions');

      // Budgets standards (projets de la vie) : tous les autres budgets du user, enfants du « Projet de vie ».
      const budgets = new Map([[main.budgetProjectId, life]]);
      for (const bp of BM.budgetProjects.filter((b) => b.entityId === ru.id && b.id !== main.budgetProjectId)) {
        let rootProject = projects.get(bp.coreProjectId);
        if (!rootProject || usedRoots.has(rootProject.id)) {
          if (rootProject) note(`Budget ${bp.id} : son projet noyau ${bp.coreProjectId} sert déjà de racine, un projet « ${bp.title} » est créé.`);
          rootProject = tag(core.buildProject(tx, { title: bp.title, description: bp.description ?? '' }), `${bp.id}#racine`);
          count('coreProjects');
        }
        usedRoots.add(rootProject.id);
        budgets.set(bp.id, tag(budget.buildStandardBudget(tx, { coreProjectId: rootProject.id, parentBudgetId: life.id, name: bp.title }), bp.id));
        count('budgets');
      }

      // Centres de coût personnalisés (dédoublonnés par libellé et sens) et plafonds par Budget.
      const centers = new Map();
      const centerOf = new Map();
      for (const c of BM.centers.filter((x) => budgets.has(x.budgetProjectId))) {
        const direction = c.kind === 'income' ? 'income' : 'charge';
        const key = `${direction}|${c.name.trim().toLowerCase()}`;
        if (!centers.has(key)) {
          centers.set(key, tag(om.create(tx, 'costCenter', { label: c.name.trim().slice(0, 120), direction }), c.id));
          count('costCenters');
        }
        const cc = centers.get(key);
        centerOf.set(c.id, cc);
        if (direction === 'charge' && c.limitCents > 0) budgets.get(c.budgetProjectId).capsCents[cc.id] = c.limitCents;
      }

      // Opérations, récurrences et règlements (les idées non décidées restent hors du budget).
      for (const o of userOps.filter((x) => x.decision === 'approved')) {
        const target = budgets.get(o.budgetProjectId);
        const direction = o.kind === 'income' ? 'income' : 'charge';
        let taskId = null;
        if (o.coreTaskId) {
          const t = tasks.get(o.coreTaskId);
          if (t && target.role === 'standard' && t.projectId === target.coreProjectId) taskId = t.id;
          else count('taskLinksDropped');
        }
        const base = { budgetId: target.id, direction, label: o.title, amount: euros(o.amountCents), costCenterRef: centerOf.get(o.centerId).id, note: o.description || null, taskId };
        const settlements = [...(o.settlements ?? [])].sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));
        if (o.cadence === 'once') {
          const [s, ...extra] = settlements;
          const op = budget.buildOperation(tx, { ...base, date: o.firstDate, ...(s ? { status: 'realized', realizedAmount: euros(s.amountCents), realizedDate: s.actualDate } : {}) });
          tag(op, o.id);
          count('operations');
          for (const x of extra) {
            tag(budget.buildOperation(tx, { ...base, date: x.occurrenceDate, status: 'realized', realizedAmount: euros(x.amountCents), realizedDate: x.actualDate }), o.id, { settlement: x.occurrenceDate });
            count('operations');
            unmapped.operationsNotes.push(`${o.id} : règlement supplémentaire du ${x.occurrenceDate} importé comme opération distincte.`);
          }
          continue;
        }
        const rec = tag(budget.buildRecurrence(tx, { ...base, cadence: o.cadence, firstDate: o.firstDate, endDate: o.endDate || null }), o.id);
        count('recurrences');
        const settled = new Set();
        for (const s of settlements) {
          if (isOccurrence(rec, s.occurrenceDate) && !settled.has(s.occurrenceDate)) {
            settled.add(s.occurrenceDate);
            tag(
              om.create(tx, 'operation', {
                budgetId: rec.budgetId,
                direction: rec.direction,
                label: rec.label,
                amountCents: rec.amountCents,
                date: s.occurrenceDate,
                status: 'realized',
                realizedAmountCents: s.amountCents,
                realizedDate: s.actualDate,
                recurrenceId: rec.id,
                occurrenceDate: s.occurrenceDate,
                note: rec.note,
                taskId: rec.taskId,
                standardCostCenter: rec.standardCostCenter,
                costCenterId: rec.costCenterId,
              }),
              o.id,
              { settlement: s.occurrenceDate },
            );
            count('settlements');
          } else {
            tag(budget.buildOperation(tx, { ...base, date: s.occurrenceDate, status: 'realized', realizedAmount: euros(s.amountCents), realizedDate: s.actualDate }), o.id, { settlement: s.occurrenceDate });
            count('operations');
            unmapped.operationsNotes.push(`${o.id} : règlement du ${s.occurrenceDate} hors des occurrences de la définition, importé comme opération ponctuelle réglée.`);
          }
        }
      }

      // Objectifs de projection de tous les BPM du user.
      for (const p of BPM.projects.filter((x) => x.ownerUserId === ru.id)) {
        for (const g of p.vision?.goals ?? []) {
          if (!GOAL_TYPES[g.kind] || !(g.targetCents > 0) || !g.targetDate) {
            note(`Objectif ${g.id} non importé (type, montant ou date manquant).`);
            continue;
          }
          tag(om.create(tx, 'lifeGoal', { label: g.label, type: g.kind, date: g.targetDate, targetTodayCents: g.targetCents, removed: false }), g.id, { note: g.note || null });
          count('lifeGoals');
        }
      }

      // Clôtures : celles du lien principal sont rejouées ; celles des autres liens sont conservées hors contrat.
      for (const c of refClosures) {
        if (c.start.slice(8) !== '01' || c.end !== nextMonth(c.start)) note(`Clôture ${c.id} : période non mensuelle au 1er, non rejouée.`);
        else plans.push({ userId: user.id, ref: c });
      }
    }

    const replayed = new Set(plans.map((p) => p.ref.id));
    unmapped.otherClosures = L.closures.filter((c) => !replayed.has(c.id));
    draft.imports ??= [];
    draft.imports.push({ source: SOURCE, from: SOURCE_DIR, at: now, schema: STORE_SCHEMA, counts: report.counts, created: tx.created.length });
    draft.journal.push({ at: now, command: tx.command, userId: null, requestKey: null, created: tx.created.map((c) => c.id), updated: [...new Set(tx.updated.map((u) => u.id))], outcome: 'committed' });
    return { value: null };
  });

  // Phase 2 : clôtures rejouées par la commande réelle, dans l'ordre.
  for (const { userId, ref } of plans) {
    const periodKey = ref.start.slice(0, 7);
    try {
      const r = await socle.modules.bpm.closePeriod({ userId }, { requestKey: `import-${SOURCE}-${ref.id}`, periodKey });
      const resultCents = r.closure.resultCents;
      report.closures.push({ ref: ref.id, periodKey, closureId: r.closure.id, referenceNetCents: ref.netCents, resultCents, same: resultCents === ref.netCents });
      count('closures');
    } catch (err) {
      report.closures.push({ ref: ref.id, periodKey, error: `${err.code ?? 'ERROR'} : ${err.message}` });
      note(`Clôture ${ref.id} non rejouée : ${err.message}`);
    }
  }

  const failed = socle.inspector.checks(socle.state).filter((c) => c.result === 'failed');
  report.integrity = failed.length ? failed.map((c) => ({ id: c.id, label: c.label, observed: c.observed, ids: c.ids?.slice(0, 20) })) : 'Tous les contrôles d’intégrité passent.';
  report.finishedAt = new Date().toISOString();
  report.revision = socle.state.revision;

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, 'rapport.json'), JSON.stringify(report, null, 2));
  await writeFile(join(OUT_DIR, 'hors-contrat.json'), JSON.stringify(unmapped, null, 2));
  const diff = report.closures.filter((c) => c.same === false).length;
  console.log(JSON.stringify({ counts: report.counts, closures: `${report.counts.closures ?? 0} rejouée(s), ${diff} écart(s)`, integrity: failed.length ? `${failed.length} contrôle(s) en échec` : 'ok', notes: report.notes.length, backup, report: join(OUT_DIR, 'rapport.json') }, null, 2));
} finally {
  await socle.close();
}
