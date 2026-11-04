// Contrats d'action J1 (§10) : Object Management orchestre identités, créations composées,
// références et provenance ; le noyau (core.mjs) calcule états et agrégats.
import { createHash } from 'node:crypto';
import { newId, kindOfId } from './ids.mjs';
import { DomainError, fail } from './errors.mjs';
import { JsonStore } from './store.mjs';
import { PRIORITIES, TASK_STATUSES, projectView } from './core.mjs';
import { enrichmentOf, projectPathways, taskQualification } from './pathways.mjs';

// ---------- validation des entrées ----------

function text(field, value, { required = false, max = 20000 } = {}) {
  if (value === undefined || value === null) {
    if (required) fail('VALIDATION', `Le champ ${field} est obligatoire.`, { field });
    return '';
  }
  if (typeof value !== 'string') fail('VALIDATION', `Le champ ${field} doit être un texte.`, { field });
  const v = required ? value.trim() : value;
  if (required && v === '') fail('VALIDATION', `Le champ ${field} ne peut pas être vide.`, { field });
  if (v.length > max) fail('VALIDATION', `Le champ ${field} dépasse ${max} caractères.`, { field });
  return v;
}

function date(field, value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    fail('VALIDATION', `Le champ ${field} doit être une date AAAA-MM-JJ.`, { field });
  }
  return value;
}

function dateOrder(start, due, startField, dueField) {
  if (start && due && due < start) {
    fail('VALIDATION', `${dueField} ne peut pas être antérieure à ${startField}.`, { field: dueField });
  }
}

function hours(field, value, { nullable }) {
  if (value === undefined || value === null || value === '') {
    if (nullable) return null;
    fail('VALIDATION', `Le champ ${field} est obligatoire.`, { field });
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000) {
    fail('VALIDATION', `Le champ ${field} doit être un nombre d'heures fini et non négatif.`, { field });
  }
  return Math.round(value * 100) / 100;
}

function oneOf(field, value, allowed, fallback) {
  if (value === undefined || value === null) return fallback;
  if (!allowed.includes(value)) fail('VALIDATION', `Valeur invalide pour ${field}.`, { field, allowed });
  return value;
}

function requestKeyOf(input) {
  const key = input?.requestKey;
  if (typeof key !== 'string' || key.length < 8 || key.length > 200) {
    fail('VALIDATION', 'Une clé de demande stable (requestKey) est requise pour toute création.', { field: 'requestKey' });
  }
  return key;
}

function expectedRevisionOf(input) {
  const r = input?.expectedRevision;
  if (!Number.isInteger(r) || r < 1) {
    fail('VALIDATION', 'La version attendue (expectedRevision) est requise.', { field: 'expectedRevision' });
  }
  return r;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const fingerprintOf = (payload) => createHash('sha256').update(canonical(payload)).digest('hex');

// ---------- service ----------

export async function createService({ dataFile, faultInjection = false }) {
  const store = await new JsonStore(dataFile).load();
  return new Service(store, { faultInjection });
}

const COLLECTION = {
  user: 'users',
  coreProject: 'coreProjects',
  task: 'tasks',
  budget: 'budgets',
  patrimoine: 'patrimoines',
  bpmComposition: 'bpmCompositions',
};

export class Service {
  constructor(store, { faultInjection }) {
    this.store = store;
    this.faultInjection = faultInjection;
  }

  get state() {
    return this.store.state;
  }

  async #act(action, fn) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof DomainError) err.action = action;
      throw err;
    }
  }

  #meta(kind, userId, command, requestKey) {
    const at = new Date().toISOString();
    return {
      id: newId(kind),
      kind,
      userId,
      revision: 1,
      createdAt: at,
      updatedAt: at,
      provenance: { command, requestKey: requestKey ?? null, at },
    };
  }

  #requireUser(state, ctx) {
    const userId = ctx?.userId;
    if (!userId) fail('CONTEXT_REQUIRED', 'Contexte de recette absent : choisir un user de test.');
    if (!state.users[userId]) fail('CONTEXT_REQUIRED', 'User de test inconnu dans ce contexte.', { userId });
    return userId;
  }

  /** Lecture d'un objet du périmètre : absent et autre user donnent la même réponse. */
  #owned(state, kind, id, userId) {
    const obj = state[COLLECTION[kind]][id];
    if (!obj || obj.userId !== userId) fail('NOT_FOUND', 'Objet introuvable dans ce périmètre.', { id, kind });
    return obj;
  }

  #checkRevision(obj, expected) {
    if (obj.revision !== expected) {
      fail('STALE_VERSION', 'Une version plus récente a été enregistrée entre-temps.', {
        id: obj.id,
        expectedRevision: expected,
        currentRevision: obj.revision,
        current: structuredClone(obj),
      });
    }
  }

  /** Référence de projet pour une tâche (J1-OM-06) : existante, de bonne nature et du même user. */
  #projectReference(state, projectId, userId) {
    if (projectId === null || projectId === undefined || projectId === '') return null;
    if (typeof projectId !== 'string') fail('VALIDATION', 'Référence de projet invalide.', { field: 'projectId' });
    const kind = kindOfId(projectId);
    const target = kind ? state[COLLECTION[kind]]?.[projectId] : undefined;
    if (!target) fail('REFERENCE_NOT_FOUND', 'Le projet référencé n’existe pas.', { projectId });
    if (kind !== 'coreProject') {
      fail('INCOMPATIBLE_REFERENCE', 'La référence ne désigne pas un projet noyau.', { projectId, kind });
    }
    if (target.userId !== userId) {
      fail('INCOMPATIBLE_REFERENCE', 'Rattachement refusé entre deux users différents.', { projectId });
    }
    return projectId;
  }

  #touch(obj) {
    obj.revision += 1;
    obj.updatedAt = new Date().toISOString();
  }

  #faultHook(input) {
    const fault = input?._fault;
    if (!fault) return undefined;
    if (!this.faultInjection) fail('VALIDATION', "L'injection d'interruption n'est pas activée.");
    return () => {
      throw new DomainError('INJECTED_INTERRUPTION', `Interruption injectée (${fault}) avant l'enregistrement.`, { fault });
    };
  }

  /** Création idempotente (J1-OM-03) : même clé et mêmes entrées = même résultat. */
  #create(command, ctx, input, build) {
    return this.store.mutate(
      (draft) => {
        const key = requestKeyOf(input);
        const userId = ctx?.anonymousCreation ? null : this.#requireUser(draft, ctx);
        const { requestKey, _fault, ...payload } = input;
        const fingerprint = fingerprintOf({ command, userId, payload });
        const existing = draft.creationRequests[key];
        if (existing) {
          if (existing.command === command && existing.fingerprint === fingerprint) {
            return { unchanged: true, value: { ...existing.result, replayed: true } };
          }
          fail('IDEMPOTENCY_CONFLICT', 'Cette clé de demande a déjà servi pour un autre contenu.', {
            requestKey: key,
            command: existing.command,
          });
        }
        const created = [];
        const result = build(draft, { userId, payload, key, created });
        draft.creationRequests[key] = {
          requestKey: key,
          command,
          userId: result.userId ?? userId,
          fingerprint,
          status: 'completed',
          createdObjects: created,
          result,
          completedAt: new Date().toISOString(),
        };
        return { value: { ...result, replayed: false } };
      },
      { beforeCommit: this.#faultHook(input) },
    );
  }

  #put(draft, obj, created) {
    draft[COLLECTION[obj.kind]][obj.id] = obj;
    created.push({ kind: obj.kind, id: obj.id });
    return obj;
  }

  #buildProject(draft, userId, payload, command, key) {
    const startDate = date('startDate', payload.startDate);
    const dueDate = date('dueDate', payload.dueDate);
    dateOrder(startDate, dueDate, 'la date de début', "L'échéance");
    return {
      ...this.#meta('coreProject', userId, command, key),
      title: text('title', payload.title, { required: true, max: 200 }),
      description: text('description', payload.description),
      priority: oneOf('priority', payload.priority, PRIORITIES, 'medium'),
      startDate,
      dueDate,
    };
  }

  #buildTask(draft, userId, payload, command, key, projectIdOverride) {
    const startDate = date('startDate', payload.startDate);
    const dueDate = date('dueDate', payload.dueDate);
    dateOrder(startDate, dueDate, 'la date prévue', "L'échéance");
    return {
      ...this.#meta('task', userId, command, key),
      title: text('title', payload.title, { required: true, max: 200 }),
      description: text('description', payload.description),
      projectId: projectIdOverride ?? this.#projectReference(draft, payload.projectId, userId),
      status: oneOf('status', payload.status, TASK_STATUSES, 'todo'),
      plannedHours: hours('plannedHours', payload.plannedHours, { nullable: true }),
      spentHours: payload.spentHours === undefined ? 0 : hours('spentHours', payload.spentHours, { nullable: false }),
      startDate,
      dueDate,
    };
  }

  // ---------- noyau : projets ----------

  createCoreProject(ctx, input) {
    return this.#act('createCoreProject', async () => {
      const r = await this.#create('createCoreProject', ctx, input, (draft, { userId, payload, key, created }) => {
        const p = this.#put(draft, this.#buildProject(draft, userId, payload, 'createCoreProject', key), created);
        return { projectId: p.id };
      });
      return { replayed: r.replayed, ...this.readProjectDetail(ctx, r.projectId) };
    });
  }

  updateCoreProject(ctx, id, input) {
    return this.#act('updateCoreProject', async () => {
      await this.store.mutate((draft) => {
        const userId = this.#requireUser(draft, ctx);
        const p = this.#owned(draft, 'coreProject', id, userId);
        this.#checkRevision(p, expectedRevisionOf(input));
        const next = this.#buildProject(draft, userId, { ...p, ...pick(input, PROJECT_FIELDS) }, 'x', null);
        Object.assign(p, pick(next, PROJECT_FIELDS));
        this.#touch(p);
        return { value: null };
      });
      return this.readProjectDetail(ctx, id);
    });
  }

  // ---------- noyau : tâches ----------

  createTask(ctx, input) {
    return this.#act('createTask', async () => {
      const r = await this.#create('createTask', ctx, input, (draft, { userId, payload, key, created }) => {
        const t = this.#put(draft, this.#buildTask(draft, userId, payload, 'createTask', key), created);
        return { taskId: t.id };
      });
      return { replayed: r.replayed, ...this.readTask(ctx, r.taskId) };
    });
  }

  updateTask(ctx, id, input) {
    return this.#act('updateTask', () =>
      this.#mutateTask(ctx, id, input, (draft, t, userId) => {
        const merged = { ...t, ...pick(input, TASK_FIELDS) };
        const startDate = date('startDate', merged.startDate);
        const dueDate = date('dueDate', merged.dueDate);
        dateOrder(startDate, dueDate, 'la date prévue', "L'échéance");
        Object.assign(t, {
          title: text('title', merged.title, { required: true, max: 200 }),
          description: text('description', merged.description),
          projectId: 'projectId' in input ? this.#projectReference(draft, input.projectId, userId) : t.projectId,
          status: oneOf('status', merged.status, TASK_STATUSES, t.status),
          plannedHours: hours('plannedHours', merged.plannedHours, { nullable: true }),
          spentHours: hours('spentHours', merged.spentHours, { nullable: false }),
          startDate,
          dueDate,
        });
      }),
    );
  }

  attachTask(ctx, id, input) {
    return this.#act('attachTask', () =>
      this.#mutateTask(ctx, id, input, (draft, t, userId) => {
        const target = this.#projectReference(draft, input?.projectId, userId);
        if (!target) fail('VALIDATION', 'Un projet cible est requis ; utiliser detachTask pour détacher.', { field: 'projectId' });
        if (t.projectId === target) return false;
        t.projectId = target;
      }),
    );
  }

  detachTask(ctx, id, input) {
    return this.#act('detachTask', () =>
      this.#mutateTask(ctx, id, input, (draft, t) => {
        if (t.projectId === null) return false;
        t.projectId = null;
      }),
    );
  }

  changeTaskStatus(ctx, id, input) {
    return this.#act('changeTaskStatus', () =>
      this.#mutateTask(ctx, id, input, (draft, t) => {
        const status = oneOf('status', input?.status, TASK_STATUSES, undefined);
        if (!status) fail('VALIDATION', 'Un état cible est requis.', { field: 'status' });
        if (t.status === status) return false;
        t.status = status;
      }),
    );
  }

  /** Saisie du cumul (valeurs absolues) : rejouer la même saisie n'ajoute rien. */
  setTaskTime(ctx, id, input) {
    return this.#act('setTaskTime', () =>
      this.#mutateTask(ctx, id, input, (draft, t) => {
        const next = {
          plannedHours: 'plannedHours' in input ? hours('plannedHours', input.plannedHours, { nullable: true }) : t.plannedHours,
          spentHours: 'spentHours' in input ? hours('spentHours', input.spentHours, { nullable: false }) : t.spentHours,
        };
        if (next.plannedHours === t.plannedHours && next.spentHours === t.spentHours) return false;
        Object.assign(t, next);
      }),
    );
  }

  /** Mutation d'une tâche avec contrôle de version ; `apply` renvoie false si rien ne change. */
  async #mutateTask(ctx, id, input, apply) {
    const before = { projectId: null };
    const written = await this.store.mutate((draft) => {
      const userId = this.#requireUser(draft, ctx);
      const t = this.#owned(draft, 'task', id, userId);
      this.#checkRevision(t, expectedRevisionOf(input));
      before.projectId = t.projectId;
      const changed = apply(draft, t, userId);
      if (changed === false) return { unchanged: true, value: false };
      this.#touch(t);
      return { value: true };
    });
    const task = this.readTask(ctx, id);
    const affected = [...new Set([before.projectId, task.task.projectId].filter(Boolean))];
    return { written, ...task, affectedProjects: affected.map((pid) => this.#projectSummary(this.state, pid)) };
  }

  // ---------- lectures / projections ----------

  #tasksOf(state, projectId) {
    return Object.values(state.tasks)
      .filter((t) => t.projectId === projectId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  #projectSummary(state, projectId) {
    const project = state.coreProjects[projectId];
    const enrichment = enrichmentOf(state, projectId);
    return {
      project: structuredClone(project),
      view: projectView(project, this.#tasksOf(state, projectId)),
      enrichment,
      pathways: projectPathways(enrichment),
    };
  }

  #taskView(state, t) {
    const project = t.projectId ? state.coreProjects[t.projectId] : null;
    const enrichment = enrichmentOf(state, t.projectId);
    return {
      task: structuredClone(t),
      projectTitle: project?.title ?? null,
      qualification: taskQualification(state, t),
      pathways: { canChangeProject: projectPathways(enrichment).tasksCanChangeProject },
    };
  }

  listUsers() {
    const state = this.state;
    return Object.values(state.users).map((u) => {
      const life = Object.values(state.budgets).find((b) => b.userId === u.id && b.role === 'life');
      return { ...structuredClone(u), principalBudgetId: life?.id ?? null };
    });
  }

  listProjects(ctx) {
    return this.#act('listProjects', async () => {
      const state = this.state;
      const userId = this.#requireUser(state, ctx);
      return Object.values(state.coreProjects)
        .filter((p) => p.userId === userId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((p) => this.#projectSummary(state, p.id));
    });
  }

  readProjectDetail(ctx, id) {
    const state = this.state;
    const userId = this.#requireUser(state, ctx);
    this.#owned(state, 'coreProject', id, userId);
    const summary = this.#projectSummary(state, id);
    const branches =
      summary.enrichment?.kind === 'life'
        ? Object.values(state.budgets)
            .filter((b) => b.role === 'standard' && b.parentBudgetId === summary.enrichment.budgetId)
            .map((b) => ({ budgetId: b.id, budgetName: b.name, coreProjectId: b.coreProjectId, projectTitle: state.coreProjects[b.coreProjectId]?.title ?? null }))
        : [];
    return {
      ...summary,
      tasks: this.#tasksOf(state, id).map((t) => this.#taskView(state, t)),
      branches,
      financial: { status: 'not-implemented', note: 'Provision et consommation monétaires : décisions A-FIN ouvertes.' },
    };
  }

  readTask(ctx, id) {
    const state = this.state;
    const userId = this.#requireUser(state, ctx);
    return this.#taskView(state, this.#owned(state, 'task', id, userId));
  }

  listTasks(ctx) {
    return this.#act('listTasks', async () => {
      const state = this.state;
      const userId = this.#requireUser(state, ctx);
      return Object.values(state.tasks)
        .filter((t) => t.userId === userId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((t) => this.#taskView(state, t));
    });
  }

  // ---------- compositions aux trois niveaux ----------

  /** Chaîne principale : user fictif, racine noyau commune, Budget principal, Patrimoine, BPM (J1-OM-04). */
  createInitialUserBundle(input) {
    return this.#act('createInitialUserBundle', () =>
      this.#create('createInitialUserBundle', { anonymousCreation: true }, input, (draft, { payload, key, created }) => {
        const command = 'createInitialUserBundle';
        let user;
        if (payload.userId) {
          user = draft.users[payload.userId];
          if (!user) fail('REFERENCE_NOT_FOUND', 'User inconnu.', { userId: payload.userId });
        } else {
          user = this.#put(draft, { ...this.#meta('user', null, command, key), label: text('label', payload.label, { required: true, max: 120 }), fictitious: true }, created);
          user.userId = user.id;
        }
        const uid = user.id;
        const owns = (col) => Object.values(draft[col]).filter((o) => o.userId === uid);
        if (owns('budgets').some((b) => b.role === 'life') || owns('patrimoines').length || owns('bpmCompositions').length) {
          fail('UNIQUENESS_VIOLATION', 'Ce user possède déjà sa chaîne principale (Budget principal, Patrimoine, BPM).', { userId: uid });
        }
        const root = this.#put(draft, {
          ...this.#meta('coreProject', uid, command, key),
          title: text('rootTitle', payload.rootTitle ?? 'Projet de vie', { required: true, max: 200 }),
          description: text('rootDescription', payload.rootDescription ?? 'Racine noyau commune au Budget principal et au Patrimoine.'),
          priority: 'medium',
          startDate: null,
          dueDate: null,
        }, created);
        const budget = this.#put(draft, {
          ...this.#meta('budget', uid, command, key),
          role: 'life',
          name: 'Projet de vie',
          coreProjectId: root.id,
          parentBudgetId: null,
          financial: { status: 'not-implemented' },
        }, created);
        const patrimoine = this.#put(draft, {
          ...this.#meta('patrimoine', uid, command, key),
          principalBudgetId: budget.id,
          coreProjectId: root.id,
          financial: { status: 'not-implemented', value: null },
        }, created);
        const bpm = this.#put(draft, {
          ...this.#meta('bpmComposition', uid, command, key),
          budgetId: budget.id,
          patrimoineId: patrimoine.id,
        }, created);
        return { userId: uid, coreProjectId: root.id, budgetId: budget.id, patrimoineId: patrimoine.id, bpmCompositionId: bpm.id };
      }),
    );
  }

  /** Projet de la vie : Budget standard, racine propre, lien père et au moins une tâche (J1-OM-07). */
  createLifeSubprojectBundle(ctx, input) {
    return this.#act('createLifeSubprojectBundle', () =>
      this.#create('createLifeSubprojectBundle', ctx, input, (draft, { userId, payload, key, created }) => {
        const command = 'createLifeSubprojectBundle';
        const parentId = payload.parentBudgetId;
        const parent = typeof parentId === 'string' ? draft.budgets[parentId] : undefined;
        if (!parent) fail('REFERENCE_NOT_FOUND', 'Budget principal père introuvable.', { parentBudgetId: parentId });
        if (parent.userId !== userId) fail('INCOMPATIBLE_REFERENCE', 'Le Budget père appartient à un autre user.', { parentBudgetId: parentId });
        if (parent.role !== 'life') fail('INCOMPATIBLE_REFERENCE', 'Le père doit être le Budget principal.', { parentBudgetId: parentId });
        const tasks = payload.tasks;
        if (!Array.isArray(tasks) || tasks.length === 0) {
          fail('VALIDATION', 'Un projet de la vie se crée avec au moins une tâche.', { field: 'tasks' });
        }
        const root = this.#put(draft, this.#buildProject(draft, userId, payload.project ?? {}, command, key), created);
        const budget = this.#put(draft, {
          ...this.#meta('budget', userId, command, key),
          role: 'standard',
          name: text('budgetName', payload.budgetName ?? root.title, { required: true, max: 200 }),
          coreProjectId: root.id,
          parentBudgetId: parent.id,
          financial: { status: 'not-implemented' },
        }, created);
        const taskIds = tasks.map((t, i) => {
          if (t?.projectId !== undefined) fail('VALIDATION', 'Les tâches initiales sont reliées à la racine de la branche.', { field: `tasks[${i}].projectId` });
          return this.#put(draft, this.#buildTask(draft, userId, t ?? {}, command, key, root.id), created).id;
        });
        return { budgetId: budget.id, coreProjectId: root.id, parentBudgetId: parent.id, taskIds };
      }),
    );
  }
}

const PROJECT_FIELDS = ['title', 'description', 'priority', 'startDate', 'dueDate'];
const TASK_FIELDS = ['title', 'description', 'status', 'plannedHours', 'spentHours', 'startDate', 'dueDate'];

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj && k in obj).map((k) => [k, obj[k]]));
}
