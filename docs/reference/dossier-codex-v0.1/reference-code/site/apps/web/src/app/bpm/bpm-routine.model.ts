import { BpmProject } from './bpm.model';
import { cycleOf } from './bpm-lens.model';

/**
 * La routine du jour de Budget/Patrimoine Management : le minimum quotidien pour
 * suivre son budget et garder un patrimoine à jour. Chaque étape se déduit des
 * données du projet ; seules deux confirmations de l'utilisateur (« rien à noter
 * aujourd'hui », « compte vérifié ») viennent de ce navigateur. Rien n'est écrit.
 */
export type RoutineStepId = 'pointer' | 'noter' | 'preciser' | 'verifier' | 'valoriser';
export type RoutinePage = 'dashboard' | 'pilot' | 'money' | 'vision' | 'patrimoine';
/** Le rythme d'un geste : chaque jour, chaque semaine, chaque mois. */
export type RoutineRhythm = 'jour' | 'semaine' | 'mois';
const RHYTHMS: Record<RoutineStepId, RoutineRhythm> = {
  pointer: 'jour',
  noter: 'jour',
  preciser: 'semaine',
  verifier: 'semaine',
  valoriser: 'mois',
};
export interface RoutineStep {
  id: RoutineStepId;
  rhythm: RoutineRhythm;
  /** `done` : fait ; `todo` : à faire ; `idle` : sans objet aujourd'hui (cycle à venir). */
  state: 'done' | 'todo' | 'idle';
  /** Le nombre d'éléments concernés (échéances, dépenses, actifs). */
  count: number;
  cents: number;
  /** La page où l'étape se fait, et son ancre. */
  page: RoutinePage;
  link: string;
  query: Record<string, string>;
  fragment?: string;
  /** Une date utile : dernière vérification, plus ancienne valeur d'actif. */
  since?: string | null;
}
export interface RoutineMemory {
  /** Le jour où l'utilisateur a confirmé n'avoir rien à noter. */
  noted?: string;
  /** Le jour de la dernière vérification avec le compte. */
  checked?: string;
}
export interface RoutineSettings {
  valuationDays: number;
  checkDays: number;
}

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY);

/** Les cinq étapes de la routine, dans l'ordre où elles se font. */
export function dailyRoutine(
  project: BpmProject,
  today: string,
  memory: RoutineMemory,
  settings: RoutineSettings,
): RoutineStep[] {
  const snapshot = project.snapshot;
  const started = snapshot?.period.started ?? false;
  const cycle = snapshot?.lenses?.[cycleOf(project)];
  const entries = cycle?.entries ?? [];
  const projet = { projet: project.id };

  const due = (snapshot?.pending ?? []).filter((item) => item.occurrenceDate <= today);
  const todays = entries.filter((entry) => entry.kind === 'expense' && entry.actualDate === today);
  const loose = entries.filter((entry) => entry.kind === 'expense' && !entry.centerId);
  const assets = (snapshot?.allocations ?? []).flatMap((allocation) => allocation.assets);
  const stale = assets.filter(
    (asset) => !asset.known || !asset.valuedAt || daysBetween(asset.valuedAt, today) > settings.valuationDays,
  );
  const oldest = assets
    .map((asset) => asset.valuedAt ?? null)
    .filter((date): date is string => !!date)
    .sort()[0];
  const checkedAge = memory.checked ? daysBetween(memory.checked, today) : null;

  const steps: Omit<RoutineStep, 'rhythm'>[] = [
    {
      id: 'pointer',
      state: !started ? 'idle' : due.length ? 'todo' : 'done',
      count: due.length,
      cents: due.reduce((sum, item) => sum + item.amountCents, 0),
      page: 'dashboard',
      link: '/budget-patrimoine-management/tableau-de-bord',
      query: projet,
      fragment: 'agir',
    },
    {
      id: 'noter',
      state: !started ? 'idle' : todays.length || memory.noted === today ? 'done' : 'todo',
      count: todays.length,
      cents: todays.reduce((sum, entry) => sum + entry.amountCents, 0),
      page: 'dashboard',
      link: '/budget-patrimoine-management/tableau-de-bord',
      query: projet,
      fragment: 'agir',
    },
    {
      id: 'preciser',
      state: !started ? 'idle' : loose.length ? 'todo' : 'done',
      count: loose.length,
      cents: loose.reduce((sum, entry) => sum + entry.amountCents, 0),
      page: 'money',
      link: '/budget-patrimoine-management/argent/a-preciser',
      query: projet,
    },
    {
      id: 'verifier',
      state: !started
        ? 'idle'
        : checkedAge !== null && checkedAge >= 0 && checkedAge < settings.checkDays
          ? 'done'
          : 'todo',
      count: 0,
      cents: 0,
      page: 'money',
      link: '/budget-patrimoine-management/argent/reste',
      query: projet,
      fragment: 'verifier',
      since: memory.checked ?? null,
    },
    {
      id: 'valoriser',
      state: stale.length || !assets.length ? 'todo' : 'done',
      count: stale.length,
      cents: 0,
      page: 'patrimoine',
      link: '/patrimoine-management/manager/assets',
      query: { project: project.patrimoineProjectId },
      since: oldest ?? null,
    },
  ];
  return steps.map((step) => ({ ...step, rhythm: RHYTHMS[step.id] }));
}

/** Les gestes regroupés par rythme, dans l'ordre jour, semaine, mois. */
export function routineGroups(steps: readonly RoutineStep[]): { rhythm: RoutineRhythm; steps: RoutineStep[] }[] {
  return (['jour', 'semaine', 'mois'] as const)
    .map((rhythm) => ({ rhythm, steps: steps.filter((step) => step.rhythm === rhythm) }))
    .filter((group) => group.steps.length);
}

/** L'avancement de la routine : étapes faites sur étapes qui comptent aujourd'hui. */
export function routineProgress(steps: readonly RoutineStep[]): { done: number; total: number; next: RoutineStep | null } {
  const counted = steps.filter((step) => step.state !== 'idle');
  return {
    done: counted.filter((step) => step.state === 'done').length,
    total: counted.length,
    next: counted.find((step) => step.state === 'todo') ?? null,
  };
}
