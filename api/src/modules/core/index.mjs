// Noyau transverse (niveau 1) : projets et tâches, états dérivés, complétude et temps.
// Le noyau ignore les niveaux supérieurs : ils l'enrichissent par extensions
// (`coreProjectContext` pour l'enrichissement et les parcours, `taskContext` pour la qualification).
import { fail } from '../../socle/errors.mjs';
import { date, dateOrder, expectedRevisionOf, hours, oneOf, pick, text } from '../../socle/validation.mjs';
import { PRIORITIES, TASK_STATUSES, TASK_STATUS_LABEL, projectView } from './rules.mjs';

const PROJECT_FIELDS = ['title', 'description', 'priority', 'startDate', 'dueDate'];
const TASK_FIELDS = ['title', 'description', 'status', 'plannedHours', 'spentHours', 'startDate', 'dueDate'];

const GENERIC_PATHWAYS = { canAddTask: true, isTaskDestination: true, tasksCanChangeProject: true, note: null };

function projectFields(input) {
  const startDate = date('startDate', input.startDate);
  const dueDate = date('dueDate', input.dueDate);
  dateOrder(startDate, dueDate, 'la date de début', "L'échéance");
  return {
    title: text('title', input.title, { required: true, max: 200 }),
    description: text('description', input.description),
    priority: oneOf('priority', input.priority, PRIORITIES, 'medium'),
    startDate,
    dueDate,
  };
}

function taskFields(input) {
  const startDate = date('startDate', input.startDate);
  const dueDate = date('dueDate', input.dueDate);
  dateOrder(startDate, dueDate, 'la date prévue', "L'échéance");
  return {
    title: text('title', input.title, { required: true, max: 200 }),
    description: text('description', input.description),
    status: oneOf('status', input.status, TASK_STATUSES, 'todo'),
    plannedHours: hours('plannedHours', input.plannedHours, { nullable: true }),
    spentHours: input.spentHours === undefined ? 0 : hours('spentHours', input.spentHours, { nullable: false }),
    startDate,
    dueDate,
  };
}

export default {
  id: 'core',
  label: 'Noyau transverse',
  level: 1,
  dependsOn: ['users'],
  kinds: {
    coreProject: { collection: 'coreProjects', prefix: 'prj', label: 'Projet noyau' },
    task: { collection: 'tasks', prefix: 'tsk', label: 'Tâche', references: { projectId: { kind: 'coreProject' } } },
  },

  setup(socle) {
    const { om, registry } = socle;

    // ---------- builders (utilisés par les compositions des niveaux supérieurs) ----------

    const buildProject = (tx, input = {}) => om.create(tx, 'coreProject', projectFields(input));
    const buildTask = (tx, input = {}) => om.create(tx, 'task', { ...taskFields(input), projectId: input.projectId ?? null });

    // ---------- contexte fourni par les niveaux supérieurs ----------

    /** Enrichissement et parcours d'un projet : fusion des extensions, parcours génériques par défaut. */
    function contextOf(state, projectId) {
      const acc = { enrichment: null, pathways: { ...GENERIC_PATHWAYS } };
      if (!projectId) return acc;
      for (const ext of registry.extensions('coreProjectContext')) {
        const r = ext(state, projectId, socle, acc) ?? {};
        if (r.enrichment) acc.enrichment = { ...acc.enrichment, ...r.enrichment };
        if (r.pathways) acc.pathways = { ...acc.pathways, ...r.pathways };
      }
      return acc;
    }

    function qualificationOf(state, task) {
      for (const ext of registry.extensions('taskContext')) {
        const q = ext(state, task, socle)?.qualification;
        if (q) return q;
      }
      return task.projectId
        ? { code: 'genericProjectTask', label: 'Tâche de projet générique', budgetIdDerived: null }
        : { code: 'standalone', label: 'Tâche autonome', budgetIdDerived: null };
    }

    // ---------- projections ----------

    const tasksOf = (state, projectId) => om.list(state, 'task', (t) => t.projectId === projectId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    function projectSummary(state, projectId) {
      const project = om.get(state, 'coreProject', projectId);
      const { enrichment, pathways } = contextOf(state, projectId);
      return { project: structuredClone(project), view: projectView(project, tasksOf(state, projectId)), enrichment, pathways };
    }

    function taskView(state, t) {
      const project = t.projectId ? om.get(state, 'coreProject', t.projectId) : null;
      return {
        task: structuredClone(t),
        projectTitle: project?.title ?? null,
        qualification: qualificationOf(state, t),
        pathways: { canChangeProject: contextOf(state, t.projectId).pathways.tasksCanChangeProject },
      };
    }

    function readProjectDetail(ctx, id) {
      const state = socle.state;
      const userId = om.requireUser(state, ctx);
      om.owned(state, 'coreProject', id, userId);
      const summary = projectSummary(state, id);
      return {
        ...summary,
        tasks: tasksOf(state, id).map((t) => taskView(state, t)),
        branches: summary.enrichment?.branches ?? [],
        financial: summary.enrichment?.financial ?? { status: 'not-implemented', note: 'Aucun module de niveau supérieur ne porte de donnée financière sur ce projet.' },
      };
    }

    function readTask(ctx, id) {
      const state = socle.state;
      return taskView(state, om.owned(state, 'task', id, om.requireUser(state, ctx)));
    }

    // ---------- commandes ----------

    /**
     * Mutation d'une tâche avec contrôle de version ; `apply` renvoie false si rien ne change.
     * Les niveaux supérieurs interviennent par extensions, dans la même écriture atomique, sans que le
     * noyau les connaisse : `taskMoveGuard` peut refuser un changement de projet (la tâche porte des
     * données d'un module), `onTaskStatusChange` réagit à un changement d'état et décrit ses effets.
     */
    async function mutateTask(action, ctx, id, input, apply) {
      let before = null;
      const r = await om.command(action, ctx, input, (tx) => {
        const t = om.owned(tx.draft, 'task', id, tx.userId);
        om.checkRevision(t, expectedRevisionOf(input));
        before = t.projectId;
        const previousStatus = t.status;
        const patch = apply(tx, t);
        if (patch === false) {
          tx.unchanged = true;
          return {};
        }
        if ('projectId' in patch && (patch.projectId ?? null) !== (t.projectId ?? null)) {
          for (const guard of registry.extensions('taskMoveGuard')) guard(tx.draft, { task: t, fromProjectId: t.projectId ?? null, toProjectId: patch.projectId ?? null }, socle);
        }
        om.update(tx, t, patch);
        const effects = [];
        if (t.status !== previousStatus) {
          for (const react of registry.extensions('onTaskStatusChange')) effects.push(...(react(tx, { task: t, previousStatus }, socle) ?? []));
        }
        return { taskId: t.id, effects };
      });
      const view = readTask(ctx, id);
      const affected = [...new Set([before, view.task.projectId].filter(Boolean))];
      return { written: r.written, ...view, affectedProjects: affected.map((pid) => projectSummary(socle.state, pid)), effects: r.effects ?? [] };
    }

    return {
      patchProject(tx, id, input) {
        const p = om.owned(tx.draft, 'coreProject', id, tx.userId);
        const before = { title: p.title };
        const updated = om.update(tx, p, projectFields({ ...p, ...pick(input, PROJECT_FIELDS) }));
        // Les niveaux supérieurs suivent le projet (le Budget dont il est la racine porte son nom).
        for (const react of registry.extensions('onCoreProjectChange')) react(tx, { project: p, before }, socle);
        return updated;
      },
      buildProject,
      buildTask,
      contextOf,
      projectSummary,
      tasksOf,
      readProjectDetail,
      readTask,

      async createCoreProject(ctx, input) {
        const r = await om.command('createCoreProject', ctx, input, (tx) => ({ projectId: buildProject(tx, input).id }), { creation: true });
        return { replayed: r.replayed, ...readProjectDetail(ctx, r.projectId) };
      },

      async updateCoreProject(ctx, id, input) {
        await om.command('updateCoreProject', ctx, input, (tx) => {
          const p = om.owned(tx.draft, 'coreProject', id, tx.userId);
          om.checkRevision(p, expectedRevisionOf(input));
          this.patchProject(tx, id, input);
          return { projectId: id };
        });
        return readProjectDetail(ctx, id);
      },

      async createTask(ctx, input) {
        // Les parcours guident le site ; ils n'interdisent jamais le stockage (contrat J1 §8).
        const r = await om.command('createTask', ctx, input, (tx) => ({ taskId: buildTask(tx, input).id }), { creation: true });
        return { replayed: r.replayed, ...readTask(ctx, r.taskId) };
      },

      updateTask(ctx, id, input) {
        return mutateTask('updateTask', ctx, id, input, (tx, t) => {
          const merged = { ...t, ...pick(input, TASK_FIELDS) };
          const fields = taskFields({ ...merged, status: merged.status ?? t.status });
          if ('projectId' in input) fields.projectId = input.projectId || null;
          return fields;
        });
      },

      attachTask(ctx, id, input) {
        return mutateTask('attachTask', ctx, id, input, (tx, t) => {
          if (!input?.projectId) fail('VALIDATION', 'Un projet cible est requis ; utiliser detachTask pour détacher.', { field: 'projectId' });
          if (t.projectId === input.projectId) return false;
          return { projectId: input.projectId };
        });
      },

      detachTask(ctx, id, input) {
        return mutateTask('detachTask', ctx, id, input, (tx, t) => (t.projectId === null ? false : { projectId: null }));
      },

      changeTaskStatus(ctx, id, input) {
        return mutateTask('changeTaskStatus', ctx, id, input, (tx, t) => {
          const status = oneOf('status', input?.status, TASK_STATUSES);
          return t.status === status ? false : { status };
        });
      },

      /** Saisie du cumul (valeurs absolues) : rejouer la même saisie n'ajoute rien. */
      setTaskTime(ctx, id, input) {
        return mutateTask('setTaskTime', ctx, id, input, (tx, t) => {
          const next = {
            plannedHours: 'plannedHours' in input ? hours('plannedHours', input.plannedHours, { nullable: true }) : t.plannedHours,
            spentHours: 'spentHours' in input ? hours('spentHours', input.spentHours, { nullable: false }) : t.spentHours,
          };
          return next.plannedHours === t.plannedHours && next.spentHours === t.spentHours ? false : next;
        });
      },

      listProjects(ctx) {
        const state = socle.state;
        const userId = om.requireUser(state, ctx);
        return om
          .list(state, 'coreProject', (p) => p.userId === userId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map((p) => projectSummary(state, p.id));
      },

      listTasks(ctx) {
        const state = socle.state;
        const userId = om.requireUser(state, ctx);
        return om
          .list(state, 'task', (t) => t.userId === userId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map((t) => taskView(state, t));
      },

      qualificationOf,
    };
  },

  debug: {
    views(state, scope, socle) {
      const core = socle.modules.core;
      const inScope = (o) => scope === 'all' || o.userId === scope;
      return {
        tachesProjets: Object.values(state.tasks)
          .filter(inScope)
          .map((t) => {
            const q = core.qualificationOf(state, t);
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
            };
          }),
        projets: Object.values(state.coreProjects)
          .filter(inScope)
          .map((p) => {
            const s = core.projectSummary(state, p.id);
            return { projectId: p.id, title: p.title, userId: p.userId, status: s.view.status, statusLabel: s.view.statusLabel, completionPercent: s.view.completionPercent, taskCount: s.view.time.taskCount, enrichment: s.enrichment?.kind ?? null };
          }),
      };
    },
    csv: {
      'taches-projets.csv': {
        view: 'tachesProjets',
        columns: ['taskId', 'title', 'userId', 'projectId', 'projectTitle', 'status', 'statusLabel', 'plannedHours', 'spentHours', 'budgetIdDerived', 'qualification'],
      },
    },
    inspect(state, obj, socle) {
      if (obj.kind === 'coreProject') return { coreProject: socle.modules.core.projectSummary(state, obj.id) };
      if (obj.kind === 'task') return { qualification: socle.modules.core.qualificationOf(state, obj) };
      return {};
    },
  },

  routes(socle) {
    const s = socle.modules.core;
    return [
      ['GET', '/api/projects', ({ ctx }) => s.listProjects(ctx)],
      ['POST', '/api/projects', ({ ctx, body }) => s.createCoreProject(ctx, body)],
      ['GET', '/api/projects/:id', ({ ctx, params }) => s.readProjectDetail(ctx, params.id)],
      ['PUT', '/api/projects/:id', ({ ctx, params, body }) => s.updateCoreProject(ctx, params.id, body)],
      ['GET', '/api/tasks', ({ ctx }) => s.listTasks(ctx)],
      ['POST', '/api/tasks', ({ ctx, body }) => s.createTask(ctx, body)],
      ['GET', '/api/tasks/:id', ({ ctx, params }) => s.readTask(ctx, params.id)],
      ['PUT', '/api/tasks/:id', ({ ctx, params, body }) => s.updateTask(ctx, params.id, body)],
      ['POST', '/api/tasks/:id/status', ({ ctx, params, body }) => s.changeTaskStatus(ctx, params.id, body)],
      ['POST', '/api/tasks/:id/attach', ({ ctx, params, body }) => s.attachTask(ctx, params.id, body)],
      ['POST', '/api/tasks/:id/detach', ({ ctx, params, body }) => s.detachTask(ctx, params.id, body)],
      ['POST', '/api/tasks/:id/time', ({ ctx, params, body }) => s.setTaskTime(ctx, params.id, body)],
    ];
  },
};
