// Object Management en lecture seule : inventaire, inspection, contrôles d'intégrité et exports.
// Toutes les vues partent d'un même instantané ; aucune lecture ne modifie ni ne répare.
import { createHash } from 'node:crypto';
import { projectView, TASK_STATUS_LABEL } from './core.mjs';
import { BUSINESS_COMMANDS, enrichmentOf, taskQualification } from './pathways.mjs';

export const DEBUG_SCHEMA = 'j1-debug/0.2';

const NATURE = {
  user: { level: 'contexte', domain: 'Identité (user de test)' },
  coreProject: { level: 'N1 noyau', domain: 'Projets' },
  task: { level: 'N1 noyau', domain: 'Tâches' },
  budget: { level: 'N2 domaine', domain: 'Budget Management' },
  patrimoine: { level: 'N2 domaine', domain: 'Patrimoine Management' },
  bpmComposition: { level: 'N3 composition', domain: 'BPM' },
};

const COLLECTIONS = ['users', 'coreProjects', 'tasks', 'budgets', 'patrimoines', 'bpmCompositions'];

export function allObjects(state) {
  return COLLECTIONS.flatMap((c) => Object.values(state[c]));
}

function snapshotIdOf(state) {
  const digest = createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 12);
  return `snap-r${state.revision}-${digest}`;
}

function inScope(obj, scope) {
  return !scope || scope === 'all' || obj.userId === scope;
}

// ---------- relations ----------

export function relationsOf(state) {
  const rels = [];
  const add = (source, relation, targetId, derived = false) => {
    if (!targetId) return;
    const target = allObjects(state).find((o) => o.id === targetId);
    rels.push({
      sourceId: source.id,
      sourceKind: source.kind,
      relation,
      targetId,
      targetKind: target?.kind ?? 'absent',
      userId: source.userId,
      derived,
    });
  };
  for (const t of Object.values(state.tasks)) {
    add(t, 'projectId', t.projectId);
    const q = taskQualification(state, t);
    if (q.budgetIdDerived) add(t, 'budgetIdDerived (via racine)', q.budgetIdDerived, true);
  }
  for (const b of Object.values(state.budgets)) {
    add(b, 'coreProjectId', b.coreProjectId);
    add(b, 'parentBudgetId', b.parentBudgetId);
  }
  for (const p of Object.values(state.patrimoines)) {
    add(p, 'coreProjectId', p.coreProjectId);
    add(p, 'principalBudgetId', p.principalBudgetId);
  }
  for (const a of Object.values(state.bpmCompositions)) {
    add(a, 'budgetId', a.budgetId);
    add(a, 'patrimoineId', a.patrimoineId);
  }
  return rels;
}

// ---------- contrôles ----------

function check(rule, category, description, expected, observed, result, ids = []) {
  return { rule, category, description, expected, observed, result, execution: 'executed', ids };
}

export function runChecks(state) {
  const checks = [];
  const objects = allObjects(state);
  const byId = new Map();
  const dupes = [];
  for (const o of objects) {
    if (byId.has(o.id)) dupes.push(o.id);
    byId.set(o.id, o);
  }
  checks.push(check('J1-OM-01', 'integrity', 'IDs uniques sur tous les objets', '0 doublon', `${dupes.length} doublon(s) sur ${objects.length} objets`, dupes.length ? 'failed' : 'passed', dupes));

  // Références (J1-OM-06)
  const broken = [];
  const expectKind = { projectId: 'coreProject', coreProjectId: 'coreProject', parentBudgetId: 'budget', principalBudgetId: 'budget', budgetId: 'budget', patrimoineId: 'patrimoine' };
  for (const r of relationsOf(state).filter((x) => !x.derived)) {
    const target = byId.get(r.targetId);
    const source = byId.get(r.sourceId);
    if (!target) broken.push(`${r.sourceId}.${r.relation} → absent`);
    else if (target.kind !== expectKind[r.relation]) broken.push(`${r.sourceId}.${r.relation} → nature ${target.kind}`);
    else if (target.userId !== source.userId) broken.push(`${r.sourceId}.${r.relation} → autre user`);
  }
  checks.push(check('J1-OM-06', 'integrity', 'Chaque relation pointe vers un objet existant, compatible et du même user', '0 référence invalide', `${broken.length} référence(s) invalide(s)`, broken.length ? 'failed' : 'passed', broken));

  // Chaîne principale (J1-OM-04, J1-OM-05)
  for (const u of Object.values(state.users)) {
    const lives = Object.values(state.budgets).filter((b) => b.userId === u.id && b.role === 'life');
    const pats = Object.values(state.patrimoines).filter((p) => p.userId === u.id);
    const bpms = Object.values(state.bpmCompositions).filter((a) => a.userId === u.id);
    const unique = lives.length <= 1 && pats.length <= 1 && bpms.length <= 1;
    const complete = (lives.length === pats.length && pats.length === bpms.length);
    const life = lives[0];
    const pat = pats[0];
    const shared = !life || (pat && pat.coreProjectId === life.coreProjectId && pat.principalBudgetId === life.id && life.id !== pat.id);
    checks.push(check('J1-OM-04', 'integrity', `Triplet principal unique pour ${u.label}`, '≤ 1 Budget principal, ≤ 1 Patrimoine, ≤ 1 BPM ; racine noyau commune', `${lives.length} principal, ${pats.length} Patrimoine, ${bpms.length} BPM ; racine commune : ${life ? (shared ? 'oui' : 'non') : 'sans objet'}`, unique && shared ? 'passed' : 'failed', [u.id, life?.id, pat?.id].filter(Boolean)));
    checks.push(check('J1-OM-05', 'integrity', `Composition complète ou absente pour ${u.label}`, 'Budget principal, Patrimoine et BPM présents ensemble', complete ? 'ensemble cohérent' : 'ensemble partiel', complete ? 'passed' : 'failed', [u.id]));
  }

  // Branches (J1-OM-07)
  const roots = new Map();
  for (const b of Object.values(state.budgets)) {
    if (b.role !== 'standard') continue;
    const parent = state.budgets[b.parentBudgetId];
    const root = state.coreProjects[b.coreProjectId];
    const sharesRoot = Object.values(state.budgets).some((o) => o.id !== b.id && o.coreProjectId === b.coreProjectId) || Object.values(state.patrimoines).some((p) => p.coreProjectId === b.coreProjectId);
    const ok = parent?.role === 'life' && parent.userId === b.userId && root && !sharesRoot;
    roots.set(b.coreProjectId, (roots.get(b.coreProjectId) ?? 0) + 1);
    checks.push(check('J1-OM-07', 'integrity', `Branche ${b.name} : racine propre et père principal`, 'père = Budget principal du même user ; racine non partagée', `père ${parent ? parent.role : 'absent'} ; racine ${root ? (sharesRoot ? 'partagée' : 'propre') : 'absente'}`, ok ? 'passed' : 'failed', [b.id, b.coreProjectId, b.parentBudgetId]));
    const taskCount = Object.values(state.tasks).filter((t) => t.projectId === b.coreProjectId).length;
    if (taskCount === 0) {
      checks.push(check('A-PARC-01', 'pathway', `Branche ${b.name} sans tâche`, 'au moins une tâche dans le parcours métier', '0 tâche', 'warning', [b.id]));
    }
  }

  // Écarts de parcours : tâche directement sur la racine principale (pas une corruption).
  for (const t of Object.values(state.tasks)) {
    if (taskQualification(state, t).code === 'principalRootTask') {
      checks.push(check('P-IHM-01', 'pathway', 'Tâche reliée directement à la racine principale', 'création métier via une branche', `tâche ${t.title}`, 'warning', [t.id, t.projectId]));
    }
  }

  // Demandes de création (J1-OM-03) : les objets créés existent.
  const missing = [];
  for (const r of Object.values(state.creationRequests)) {
    for (const c of r.createdObjects) if (!byId.has(c.id)) missing.push(`${r.requestKey} → ${c.id}`);
  }
  checks.push(check('J1-OM-03', 'integrity', 'Chaque demande de création terminée retrouve ses objets', '0 objet manquant', `${Object.keys(state.creationRequests).length} demande(s), ${missing.length} objet(s) manquant(s)`, missing.length ? 'failed' : 'passed', missing));

  checks.push({ rule: 'A-FIN-01/02/03', category: 'not-implemented', description: 'Provision, consommation monétaire et flux financiers', expected: 'décisions ouvertes', observed: 'aucun calcul exécuté', result: 'not-run', execution: 'not-run', ids: [] });
  return checks;
}

// ---------- vues ----------

function mainChains(state, scope) {
  return Object.values(state.bpmCompositions)
    .filter((a) => inScope(a, scope))
    .map((a) => {
      const b = state.budgets[a.budgetId];
      const p = state.patrimoines[a.patrimoineId];
      return {
        userId: a.userId,
        userLabel: state.users[a.userId]?.label ?? null,
        bpmCompositionId: a.id,
        principalBudgetId: b?.id ?? null,
        principalBudgetName: b?.name ?? null,
        principalCoreProjectId: b?.coreProjectId ?? null,
        patrimoineId: p?.id ?? null,
        patrimoineCoreProjectId: p?.coreProjectId ?? null,
        coreProjectShared: !!b && !!p && b.coreProjectId === p.coreProjectId,
        directTaskIds: Object.values(state.tasks).filter((t) => b && t.projectId === b.coreProjectId).map((t) => t.id),
      };
    });
}

function branches(state, scope) {
  return Object.values(state.budgets)
    .filter((b) => b.role === 'standard' && inScope(b, scope))
    .map((b) => ({
      budgetId: b.id,
      budgetName: b.name,
      parentBudgetId: b.parentBudgetId,
      userId: b.userId,
      coreProjectId: b.coreProjectId,
      taskIds: Object.values(state.tasks).filter((t) => t.projectId === b.coreProjectId).map((t) => t.id),
      provenance: b.provenance,
    }));
}

function taskRows(state, scope) {
  return Object.values(state.tasks)
    .filter((t) => inScope(t, scope))
    .map((t) => {
      const q = taskQualification(state, t);
      return {
        taskId: t.id,
        title: t.title,
        userId: t.userId,
        projectId: t.projectId,
        projectTitle: t.projectId ? state.coreProjects[t.projectId]?.title ?? null : null,
        status: t.status,
        statusLabel: TASK_STATUS_LABEL[t.status],
        plannedHours: t.plannedHours,
        spentHours: t.spentHours,
        budgetIdDerived: q.budgetIdDerived,
        qualification: q.label,
        revision: t.revision,
      };
    });
}

function projectViews(state, scope) {
  return Object.values(state.coreProjects)
    .filter((p) => inScope(p, scope))
    .map((p) => {
      const tasks = Object.values(state.tasks).filter((t) => t.projectId === p.id);
      const v = projectView(p, tasks);
      const e = enrichmentOf(state, p.id);
      return {
        projectId: p.id,
        title: p.title,
        userId: p.userId,
        status: v.status,
        statusLabel: v.statusLabel,
        column: v.column,
        explanation: v.explanation,
        taskIds: v.taskIds,
        taskStatuses: Object.fromEntries(tasks.map((t) => [t.id, t.status])),
        completionPercent: v.completionPercent,
        plannedHoursKnown: v.time.plannedHoursKnown,
        estimatedTaskCount: v.time.estimatedTaskCount,
        missingEstimateCount: v.time.missingEstimateCount,
        spentHoursTotal: v.time.spentHoursTotal,
        enrichment: e?.kind ?? null,
        budgetIdDerived: e?.budgetId ?? null,
        source: 'calculé depuis les tâches',
      };
    });
}

function parameters() {
  return [
    { name: 'Priorité par défaut d’un projet', value: 'medium (Moyenne)', origin: 'contrat J1 (reconduit)', nature: 'stocké dans le code' },
    { name: 'État par défaut d’une tâche', value: 'todo (À faire)', origin: 'contrat J1 (reconduit)', nature: 'stocké dans le code' },
    { name: 'Temps consommé initial', value: '0 h', origin: 'P-TEMPS-01', nature: 'stocké dans le code' },
    { name: 'Unité et précision des temps', value: 'heures décimales, 0,01 h', origin: 'choix technique J1', nature: 'stocké dans le code' },
    { name: 'Provision monétaire des tâches', value: null, origin: 'A-FIN-01', nature: 'non implémenté' },
    { name: 'Consommation monétaire / dépassement', value: null, origin: 'A-FIN-02', nature: 'non implémenté' },
    { name: 'Valeur du Patrimoine', value: null, origin: 'Patrimoine Management (jalons suivants)', nature: 'non implémenté' },
  ];
}

export function inventory(state, { q, kind, scope } = {}) {
  const checks = runChecks(state);
  const failing = new Set(checks.filter((c) => c.result === 'failed').flatMap((c) => c.ids));
  const warning = new Set(checks.filter((c) => c.result === 'warning').flatMap((c) => c.ids));
  const needle = q?.toLowerCase();
  return allObjects(state)
    .filter((o) => inScope(o, scope))
    .filter((o) => !kind || o.kind === kind)
    .filter((o) => !needle || o.id.toLowerCase().includes(needle) || (o.title ?? o.name ?? o.label ?? '').toLowerCase().includes(needle))
    .map((o) => ({
      id: o.id,
      kind: o.kind,
      label: o.title ?? o.name ?? o.label ?? null,
      level: NATURE[o.kind].level,
      domain: NATURE[o.kind].domain,
      userId: o.userId,
      revision: o.revision,
      source: o.provenance?.command ?? null,
      control: failing.has(o.id) ? 'failed' : warning.has(o.id) ? 'warning' : 'passed',
    }));
}

export function inspectObject(state, id) {
  const obj = allObjects(state).find((o) => o.id === id);
  if (!obj) return null;
  const rels = relationsOf(state);
  const request = Object.values(state.creationRequests).find((r) => r.createdObjects.some((c) => c.id === id));
  return {
    object: obj,
    nature: NATURE[obj.kind],
    outgoing: rels.filter((r) => r.sourceId === id),
    incoming: rels.filter((r) => r.targetId === id),
    creationRequest: request ? { requestKey: request.requestKey, command: request.command, completedAt: request.completedAt, createdObjects: request.createdObjects } : null,
    projectView: obj.kind === 'coreProject' ? projectView(obj, Object.values(state.tasks).filter((t) => t.projectId === id)) : undefined,
    qualification: obj.kind === 'task' ? taskQualification(state, obj) : undefined,
  };
}

export function exportDebug(state, scope = 'all') {
  const pick = (col) => Object.values(state[col]).filter((o) => inScope(o, scope));
  return {
    schemaVersion: DEBUG_SCHEMA,
    mode: 'executed-from-persistence',
    snapshotId: snapshotIdOf(state),
    storeRevision: state.revision,
    storeUpdatedAt: state.updatedAt,
    generatedAt: new Date().toISOString(),
    scope,
    users: pick('users'),
    coreProjects: pick('coreProjects'),
    budgets: pick('budgets'),
    patrimoines: pick('patrimoines'),
    bpm: pick('bpmCompositions'),
    tasks: pick('tasks'),
    mainChains: mainChains(state, scope),
    branches: branches(state, scope),
    projectViews: projectViews(state, scope),
    taskRows: taskRows(state, scope),
    relations: relationsOf(state).filter((r) => inScope(r, scope)),
    parameters: parameters(),
    businessCommands: BUSINESS_COMMANDS,
    financialCalculation: { status: 'not-implemented', consumedAmount: null, provisionedAmount: null },
    creationReceipts: Object.values(state.creationRequests).filter((r) => inScope(r, scope)),
    checks: runChecks(state),
    review: { decision: 'pending' },
  };
}

// ---------- CSV ----------

function toCsv(rows, columns) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = Array.isArray(v) ? v.join('|') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

export function exportCsv(state, file, scope = 'all') {
  const dbg = exportDebug(state, scope);
  const stamp = { snapshotId: dbg.snapshotId, schemaVersion: dbg.schemaVersion, scope };
  const stampCols = ['snapshotId', 'schemaVersion', 'scope'];
  switch (file) {
    case 'objets.csv':
      return toCsv(inventory(state, { scope }).map((r) => ({ ...r, ...stamp })), ['id', 'kind', 'label', 'level', 'domain', 'userId', 'revision', 'source', 'control', ...stampCols]);
    case 'assemblages.csv': {
      const rows = [
        ...dbg.mainChains.map((c) => ({ assemblageId: c.bpmCompositionId, type: 'chaîne principale', userId: c.userId, budgetId: c.principalBudgetId, patrimoineId: c.patrimoineId, coreProjectId: c.principalCoreProjectId, parentBudgetId: '', taskIds: c.directTaskIds })),
        ...dbg.branches.map((b) => ({ assemblageId: b.budgetId, type: 'branche (projet de la vie)', userId: b.userId, budgetId: b.budgetId, patrimoineId: '', coreProjectId: b.coreProjectId, parentBudgetId: b.parentBudgetId, taskIds: b.taskIds })),
      ].map((r) => ({ ...r, ...stamp }));
      return toCsv(rows, ['assemblageId', 'type', 'userId', 'budgetId', 'patrimoineId', 'coreProjectId', 'parentBudgetId', 'taskIds', ...stampCols]);
    }
    case 'relations.csv':
      return toCsv(dbg.relations.map((r) => ({ ...r, ...stamp })), ['sourceId', 'sourceKind', 'relation', 'targetId', 'targetKind', 'userId', 'derived', ...stampCols]);
    case 'taches-projets.csv': {
      const views = new Map(dbg.projectViews.map((v) => [v.projectId, v]));
      const rows = dbg.taskRows.map((t) => ({
        ...t,
        projectStatus: t.projectId ? views.get(t.projectId)?.statusLabel : '',
        projectCompletionPercent: t.projectId ? views.get(t.projectId)?.completionPercent : '',
        ...stamp,
      }));
      return toCsv(rows, ['taskId', 'title', 'userId', 'projectId', 'projectTitle', 'status', 'statusLabel', 'plannedHours', 'spentHours', 'budgetIdDerived', 'qualification', 'projectStatus', 'projectCompletionPercent', 'revision', ...stampCols]);
    }
    default:
      return null;
  }
}

export const CSV_FILES = ['objets.csv', 'assemblages.csv', 'relations.csv', 'taches-projets.csv'];
