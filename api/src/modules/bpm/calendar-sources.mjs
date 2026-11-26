// Sources du calendrier fournies par BPM (extension `calendarSources` du module Calendrier).
// BPM ne dessine aucun calendrier : il donne ses objets datés sous forme de natures lisibles par le moteur
// (règlements du projet de vie, tâches des projets, rendez-vous de décision). La configuration du calendrier
// dit ensuite quoi en montrer et comment, comme pour une nature stockée. La Météo lit ces mêmes événements
// dans le calendrier : il n'y a qu'un seul endroit où les dates du projet de vie deviennent des événements.

/** Un user sans espace BPM préparé n'a aucun objet BPM à montrer : la source est vide, pas en erreur. */
const QUIET = new Set(['FORBIDDEN_BY_RULE', 'NOT_FOUND']);
function quietly(read) {
  try {
    return read();
  } catch (err) {
    if (QUIET.has(err?.code)) return [];
    throw err;
  }
}

export function createCalendarSources({ reads, projects }) {
  /**
   * Règlements du projet de vie : lignes du registre (prévues et réglées) et règlements des projets en
   * attente, une fois chacun. Statut, financement, projet et tâche viennent des lectures BPM.
   */
  function reglements(ctx, { from, to }) {
    return quietly(() => {
      const byId = new Map();
      const add = (line) => {
        if (byId.has(line.id)) return;
        byId.set(line.id, {
          ...line,
          special: !!line.special,
          projectCharge: !!line.projectCharge,
          coreProjectId: line.project?.coreProjectId ?? null,
          projectTitle: line.project?.name ?? line.budgetName ?? null,
        });
      };
      for (const basis of ['planned', 'realized']) for (const line of reads.register(ctx, { from, to, dateBasis: basis, groupBy: 'none' }).lines) add(line);
      for (const line of reads.projectFlows(ctx, { source: 'all', until: to }).pending) add(line);
      return [...byId.values()];
    });
  }

  /** Tâches des projets de la vie (hors projet de vie lui-même), avec le titre de leur projet. */
  function taches(ctx) {
    return quietly(() => projects.tasksOverview(ctx).tasks
      .filter((t) => t.projectRole !== 'life')
      .map((t) => {
        const { id, userId, projectId, title, status, priority, description, startDate, dueDate, plannedHours, spentHours, revision } = t.task;
        return { id, userId, projectId, title, status, priority, description, startDate, dueDate, plannedHours, spentHours, revision, projectTitle: t.projectTitle ?? null, projectRole: t.projectRole };
      }));
  }

  /** Rendez-vous de décision : la prochaine intégration des dépassements accordés à l'enveloppe. */
  function rendezVous(ctx) {
    return quietly(() => {
      const ov = projects.overview(ctx);
      const date = ov.life?.nextBillingDate ?? null;
      return date ? [{ id: `enveloppes@${date}`, userId: ctx.userId, date, label: 'Autorisations à intégrer à l’enveloppe', revision: null }] : [];
    });
  }

  return { reglements, taches, rendezVous };
}

const T = (type, ...names) => Object.fromEntries(names.map((n) => [n, type]));

/** Champs fournis par chaque nature : le calendrier refuse une configuration qui en nommerait un autre. */
export const PROVIDED_FIELDS = {
  bpmReglement: {
    ...T('identifiant', 'id', 'operationId', 'recurrenceId', 'budgetId', 'userId', 'coreProjectId', 'taskId', 'costCenterId', 'occurrenceKey'),
    ...T('texte', 'label', 'kind', 'direction', 'fundingSource', 'status', 'statusLabel', 'projectTitle', 'taskTitle', 'costCenterLabel', 'budgetName', 'nature', 'note', 'standardCostCenter', 'cadenceLabel', 'projectPosting'),
    ...T('date', 'plannedDate', 'realizedDate', 'accountingDate', 'occurrenceDate'),
    ...T('montant', 'plannedCents', 'realizedCents'),
    ...T('booleen', 'settled', 'special', 'projectCharge', 'centerKnown'),
    ...T('nombre', 'revision'),
    ...T('objet', 'project'),
  },
  bpmTache: {
    ...T('identifiant', 'id', 'userId', 'projectId'),
    ...T('texte', 'title', 'status', 'priority', 'description', 'projectTitle', 'projectRole'),
    ...T('date', 'startDate', 'dueDate'),
    ...T('nombre', 'plannedHours', 'spentHours', 'revision'),
  },
  bpmRendezVous: { ...T('identifiant', 'id', 'userId'), ...T('texte', 'label'), ...T('date', 'date'), ...T('nombre', 'revision') },
};

/** Contrat de l'extension : natures fournies au calendrier, lues dans la portée de BPM, avec leurs champs. */
export function calendarSources(socle) {
  const sources = () => socle.modules.bpm.calendarSources;
  return {
    bpmReglement: { label: 'Règlement du projet de vie', module: 'bpm', fields: PROVIDED_FIELDS.bpmReglement, read: (ctx, win) => sources().reglements(ctx, win) },
    bpmTache: { label: 'Tâche d’un projet de la vie', module: 'bpm', fields: PROVIDED_FIELDS.bpmTache, read: (ctx, win) => sources().taches(ctx, win) },
    bpmRendezVous: { label: 'Rendez-vous de décision', module: 'bpm', fields: PROVIDED_FIELDS.bpmRendezVous, read: (ctx, win) => sources().rendezVous(ctx, win) },
  };
}
