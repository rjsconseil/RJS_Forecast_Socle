import type { FlowPilot, FlowEditorProject } from './bpm-flow-pilot.model';
import type { BpmExpenseRegister } from './bpm-expenses.model';
import type { PatrimoineLifecycle } from '../shared/patrimoine-lifecycle.contract';
export type { PatrimoineLifecycle } from '../shared/patrimoine-lifecycle.contract';
/**
 * Budget/Patrimoine Management : un parcours volontairement limité. On n'y
 * entre que par la création d'un projet du noyau relié à un PBM et à un PPM ;
 * chaque étape accomplie libère les fonctions suivantes de Budget et de
 * Patrimoine, ouvertes sur ce seul projet. Le module ne recode aucune fonction
 * métier : il oriente vers celles des deux modules, filtrées.
 */

import type { BpmInflationPoint, BpmVision } from './bpm-vision.model';

export type BpmCadence = 'weekly' | 'monthly' | 'yearly';
export type BpmStepId = 'projet' | 'budget' | 'patrimoine' | 'cycle';

export interface BpmStepState {
  id: BpmStepId;
  done: boolean;
  unlocked: boolean;
}
export interface BpmProject {
  flowEditor?: FlowEditorProject[];
  /** Portée calculée d’une lecture professionnelle, non persistée dans le BPM. */
  expenseScope?: 'professional';
  entityType?: string | null;
  managementScope?: 'personal' | 'professional';
  id: string;
  title: string;
  coreProjectId: string;
  patrimoineCoreProjectId?: string | null;
  defaultForEntity?: boolean;
  budgetProjectIds?: string[];
  budgetProjectId: string;
  patrimoineProjectId: string;
  linkId: string;
  ownerUserId: string;
  ownerLabel: string | null;
  createdAt: string;
  coreTitle: string | null;
  budgetTitle: string | null;
  patrimoineTitle: string | null;
  link: { periodicity: BpmCadence; startDate: string; enabled: string } | null;
  journey: BpmStepState[];
  snapshot: BpmSnapshot | null;
  vision: BpmVision;
  /** Le profil de paramétrage choisi à la création, s'il y en a un. */
  profile?: string | null;
}
/** L'instantané calculé par le service pour le tableau de bord. */
export interface BpmProjectCharge {
  operationId: string;
  title: string;
  amountCents: number;
  firstDate: string;
  endDate: string;
  cadence: string;
  decision: string;
  note: string;
  taskId: string | null;
  taskTitle: string;
  centerName: string;
  nextDate?: string;
  detailOccurrence?: string;
  detailDate?: string;
}
export interface BpmPeriodCharge extends BpmProjectCharge {
  occurrenceDate: string;
  actualDate: string | null;
  actualCents: number | null;
  status: 'recorded' | 'pending' | 'unrealized';
}
export interface BpmBudgetCost {
  charges: BpmProjectCharge[];
  periodCharges: BpmPeriodCharge[];
  forecastExpenseCents: number;
  id: string;
  title: string;
  coreProjectId: string;
  coreTitle: string;
  standard: boolean;
  description: string;
  summary: string;
  startDate: string;
  dueDate: string;
  plannedBudgetCents: number | null;
  expenseCents: number;
  pendingExpenseCents: number;
  withoutTaskCents: number;
  tasks: {
    id: string;
    title: string;
    description: string;
    status: string;
    startDate: string;
    dueDate: string;
    allocatedCents: number | null;
    expenseCents: number;
    pendingExpenseCents: number;
  }[];
  expenses: {
    operationId: string;
    title: string;
    occurrenceDate: string;
    date: string;
    amountCents: number;
    status: 'recorded' | 'pending';
    taskId: string | null;
    centerName: string;
  }[];
}
export interface BpmFunding {
  totalCents: number;
  recurringCents: number;
  oneTimeCents: number;
  sources: {
    operationId: string;
    title: string;
    incomeType: string;
    cadence: string;
    date: string;
    amountCents: number;
  }[];
}
export interface BpmSnapshot {
  incomeRegister?: Pick<BpmExpenseRegister, 'rows' | 'operations'>;
  funding?: BpmFunding;
  budgetProjects?: BpmBudgetCost[];
  flowPilot?: FlowPilot;
  patrimoineRevision?: number;
  patrimoineLifecycle?: PatrimoineLifecycle | null;
  period: {
    start: string;
    end: string;
    length: number;
    elapsed: number;
    daysLeft: number;
    started: boolean;
  };
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  standing: { assetsCents: number | null; budgetFlowCents: number; totalCents: number | null };
  history: {
    start: string;
    end: string;
    incomeCents: number;
    expenseCents: number;
    netCents: number;
    patrimoineAfterCents: number | null;
  }[];
  counts: {
    operations: number;
    incomes: number;
    expenses: number;
    centers: number;
    providers: number;
    assets: number;
    valuedAssets: number;
  };
  /** Les occurrences prévues de la période qui restent à recevoir. */
  pending: BpmPendingFlow[];
  plannedIncomeCents: number;
  plannedExpenseCents: number;
  /** Les sorties réglées de la période, poste par poste. */
  centers: { id: string; name: string; limitCents: number | null; spentCents: number }[];
  /** D'où vient l'argent : entrées reçues et attendues de la période, par libellé. */
  incomes: { title: string; receivedCents: number; plannedCents: number }[];
  /** Les événements ponctuels ou annuels des douze mois suivants, à provisionner. */
  upcoming: BpmPendingFlow[];
  /** Les allocations du patrimoine, leurs actifs et ce qui y est déjà constitué. */
  allocations: BpmAllocationValue[];
  /** Le profil type d'une période : flux récurrents ramenés à une période du cycle. */
  profile: BpmPeriodProfile;
  /** La même gestion vue par semaine, par mois et par année (absent d'une ancienne API). */
  lenses?: Record<BpmCadence, BpmLensView>;
}
/** Une fenêtre de la frise d'une vue : son réalisé et son prévu au montant planifié. */
export interface BpmLensBucket {
  start: string;
  end: string;
  state: 'past' | 'current' | 'future';
  realizedIncomeCents: number;
  realizedExpenseCents: number;
  realizedNetCents: number;
  plannedIncomeCents: number;
  plannedExpenseCents: number;
  plannedNetCents: number;
  patrimoineAfterCents: number | null;
}
/** Une vue par semaine, mois ou année : la fenêtre en cours, son réalisé, son prévu et sa frise. */
export interface BpmLensView {
  incomeRegister?: Pick<BpmExpenseRegister, 'rows' | 'operations'>;
  funding?: BpmFunding;
  budgetProjects?: BpmBudgetCost[];
  flowPilot?: FlowPilot;
  cadence: BpmCadence;
  start: string;
  end: string;
  length: number;
  elapsed: number;
  daysLeft: number;
  started: boolean;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  /** Le prévu de la fenêtre au montant planifié, échéances enregistrées comprises. */
  plannedIncomeCents: number;
  plannedExpenseCents: number;
  /** Ce qui reste à recevoir dans la fenêtre. */
  remainingIncomeCents: number;
  remainingExpenseCents: number;
  pending: BpmPendingFlow[];
  centers: {
    id: string;
    name: string;
    limitCents: number | null;
    spentCents: number;
    plannedCents: number;
  }[];
  incomes: { title: string; receivedCents: number; plannedCents: number }[];
  /** Le relevé de la fenêtre : chaque montant réellement reçu ou payé (absent d'une ancienne API). */
  entries?: BpmStatementEntry[];
  buckets: BpmLensBucket[];
}
/** Un montant réellement reçu ou payé, avec son opération, son poste et sa note. */
export interface BpmStatementEntry {
  incomeType?: string;
  operationId: string;
  occurrenceDate: string;
  actualDate: string;
  amountCents: number;
  kind: 'income' | 'expense';
  title: string;
  /** Le poste de dépense ; null pour une entrée ; les anciens relevés sans poste restent lisibles. */
  centerId: string | null;
  note: string;
  cadence: 'once' | 'weekly' | 'monthly' | 'yearly' | string;
}
export interface BpmPeriodProfile {
  incomes: { title: string; cadence: string; perPeriodCents: number }[];
  expenses: {
    centerId: string;
    name: string;
    totalCents: number;
    items: { title: string; cadence: string; perPeriodCents: number }[];
  }[];
  incomeCents: number;
  expenseCents: number;
  naturalSavingCents: number;
}
export interface BpmAllocationValue {
  id: string;
  name: string;
  targetCents: number | null;
  valueCents: number;
  assets: {
    id: string;
    name: string;
    known: boolean;
    valueCents: number;
    valuedAt?: string | null;
  }[];
}
export interface BpmPendingFlow {
  operationId: string;
  title: string;
  kind: 'income' | 'expense';
  centerId: string | null;
  occurrenceDate: string;
  amountCents: number;
}
/** Un flux saisi depuis BPM : il devient une opération du budget du projet. */
export interface BpmFlow {
  budgetProjectId?: string;
  coreTaskId?: string;
  incomeType?: string;
  kind: 'income' | 'expense';
  title: string;
  amountCents: number;
  date: string;
  cadence: 'once' | 'weekly' | 'monthly' | 'yearly';
  endDate?: string;
  centerId?: string | null;
  /** Nom d'un poste à reprendre ou créer, pour un débutant qui ne connaît pas encore ses postes. */
  centerName?: string;
  settled: boolean;
  note?: string;
  /** Ancien client : ne dispense plus du poste obligatoire. */
  toSpecify?: boolean;
  /** Le plafond proposé par le profil pour un poste créé par son nom. */
  centerLimitCents?: number;
}
export interface BpmWorkspace {
  proposals?: Record<'income' | 'expense', { standard: string[]; custom: string[] }>;
  professionalBillingAllowed?: boolean;
  professionalEntities?: { id: string; label: string }[];
  freeTasks?: { id: string; label: string }[];
  entities?: {
    id: string;
    label: string;
    entityType?: string | null;
    patrimoineProjectId: string | null;
  }[];
  version: 1;
  revision: number;
  today: string;
  projects: BpmProject[];
  inflation: {
    own: { year: number; ratePct: number }[];
    reference: { year: number; ratePct: number; source: string }[];
    effective: BpmInflationPoint[];
  };
  candidates: BpmCandidate[];
  /** Les profils de paramétrage livrés (absents d'une ancienne API). */
  profiles?: BpmProfile[];
}
/**
 * Un profil de paramétrage (famille, célibataire, association) : des valeurs de
 * départ cohérentes entre elles, que l'assistant et le budget type proposent.
 */
export interface BpmCreationDetails {
  providers?: { key: string; name: string; type: string; note: string }[];
  beneficiary: string;
  centers: { key: string; name: string; limitCents: number | null; note: string }[];
  flows: {
    incomeType?: string;
    kind: 'income' | 'expense';
    provider?: string;
    title: string;
    amountCents: number;
    cadence: BpmCadence | 'once';
    center: string;
    date: string;
    endDate: string;
    settled: boolean;
    note: string;
  }[];
  allocations: { key: string; name: string; targetCents: number | null; note: string }[];
  assets: {
    name: string;
    allocation: string;
    valueCents: number | null;
    liabilityCents: number;
    date: string;
    note: string;
  }[];
  goals: {
    kind: string;
    label: string;
    targetCents: number;
    targetDate: string;
    allocation: string;
    note: string;
  }[];
}
export interface BpmProfile {
  scenario?: {
    title: string;
    summary: string;
    beneficiary: string;
    assets: {
      name: string;
      allocation: string;
      valueCents: number | null;
      liabilityCents: number;
    }[];
  };
  id: string;
  label: string;
  description: string;
  periodicity: BpmCadence;
  incomes: {
    key: string;
    title: string;
    amountCents: number;
    cadence: BpmCadence;
    center?: string;
  }[];
  expenses: {
    key: string;
    title: string;
    amountCents: number;
    cadence: BpmCadence;
    center: string;
  }[];
  centers: { key: string; name: string; limitCents: number | null; help: string }[];
  providerTypes?: { key: string; name: string; center: string; help: string }[];
  allocations: { key: string; name: string; targetCents: number | null; help: string }[];
  goals: {
    kind: string;
    label: string;
    targetCents: number | null;
    allocation: string;
    yearsAhead: number;
  }[];
}
/** Les champs qu'une liaison de l'atelier peut changer. */
export type AssemblyLinkField =
  'centerId' | 'personId' | 'providerId' | 'coreTaskId' | 'assetId' | 'allocationId';
/** Une liaison de l'atelier : une fiche d'un projet libre et les liens qu'elle reçoit. */
export interface AssemblyLinkChange {
  domain: 'budget' | 'patrimoine';
  target: 'project' | 'operation' | 'asset';
  id: string;
  centerId?: string | null;
  personId?: string | null;
  providerId?: string | null;
  coreTaskId?: string | null;
  assetId?: string | null;
  allocationId?: string | null;
}
export interface BpmAssemblyInventory {
  family: string;
  items: {
    id: string;
    label: string;
    references: string[];
    links?: Partial<Record<AssemblyLinkField, string | null>>;
    kind?: 'income' | 'expense';
    decision?: string;
    incomeType?: string;
    cadence?: BpmCadence | 'once';
    firstDate?: string;
    endDate?: string;
    amountCents?: number | null;
    settled?: number;
    valued?: boolean;
  }[];
}
/** Un PBM ou un PPM libre : son poste ou son allocation de référence et l'inventaire de ses fiches. */
export interface BpmAssemblySource {
  assembledId?: string | null;
  entityId?: string | null;
  id: string;
  title: string;
  referenceId?: string | null;
  inventory?: BpmAssemblyInventory[];
}
/** Un projet du noyau dont le budget et le patrimoine existants peuvent être assemblés. */
export interface BpmCandidate {
  coreProjectId: string;
  coreTitle: string;
  tasks?: { id: string; label: string }[];
  pairs?: { budgetProjectId: string; patrimoineProjectId: string; problems: string[] }[];
  budgets: BpmAssemblySource[];
  patrimoines: BpmAssemblySource[];
  links: {
    id: string;
    budgetProjectId: string;
    patrimoineProjectId: string;
    periodicity: BpmCadence;
    startDate: string;
    enabled?: boolean;
  }[];
}
/** Assembler l'existant : rien n'est créé dans le noyau, Budget ni Patrimoine. */
export interface BpmAssembly {
  entityId?: string;
  entityType?: string;
  mode: 'assemble';
  title: string;
  coreProjectId: string;
  budgetProjectId: string;
  patrimoineProjectId: string;
  periodicity: BpmCadence;
  startDate: string;
  /** Le profil de paramétrage choisi, retenu sur le projet pour son budget type. */
  profile?: string;
  vision?: BpmVision;
}
export interface BpmCreation {
  details?: BpmCreationDetails;
  title: string;
  summary: string;
  budgetTitle: string;
  centerName: string;
  patrimoineTitle: string;
  allocationName: string;
  periodicity: BpmCadence;
  startDate: string;
  /** Le profil de paramétrage choisi, retenu sur le projet pour son budget type. */
  profile?: string;
  vision?: BpmVision;
}

/** Une fonction d'un module frère, ouverte sur le projet et libérée par une étape. */
export interface BpmTool {
  id: string;
  module: 'budget' | 'patrimoine' | 'noyau';
  link: string;
  query: Record<string, string>;
}

/** Les fonctions que chaque étape libère, dans l'ordre du parcours. */
export function bpmTools(project: BpmProject, step: BpmStepId): BpmTool[] {
  const budget = { core: project.coreProjectId, budget: project.budgetProjectId };
  const patrimoine = { project: project.patrimoineProjectId };
  switch (step) {
    case 'projet':
      return [
        {
          id: 'projet-noyau',
          module: 'noyau',
          link: `/projects/${project.coreProjectId}`,
          query: {},
        },
        ...(project.patrimoineCoreProjectId
          ? [
              {
                id: 'noyau-patrimoine',
                module: 'noyau' as const,
                link: `/projects/${project.patrimoineCoreProjectId}`,
                query: {},
              },
            ]
          : []),
      ];
    case 'budget':
      return [
        {
          id: 'operations',
          module: 'budget',
          link: '/budget-management/manager/operations',
          query: budget,
        },
        {
          id: 'centres',
          module: 'budget',
          link: '/budget-management/manager/centres',
          query: budget,
        },
        {
          id: 'prestataires',
          module: 'budget',
          link: '/budget-management/manager/prestataires',
          query: budget,
        },
        {
          id: 'enveloppe',
          module: 'budget',
          link: `/budget-management/projets/${project.budgetProjectId}`,
          query: budget,
        },
      ];
    case 'patrimoine':
      return [
        {
          id: 'actifs',
          module: 'patrimoine',
          link: '/patrimoine-management/manager/assets',
          query: patrimoine,
        },
        {
          id: 'allocations',
          module: 'patrimoine',
          link: '/patrimoine-management/manager/allocations',
          query: patrimoine,
        },
        {
          id: 'mouvements',
          module: 'patrimoine',
          link: '/patrimoine-management/manager/operations',
          query: patrimoine,
        },
        {
          id: 'prestataires-patrimoine',
          module: 'patrimoine',
          link: '/patrimoine-management/manager/providers',
          query: patrimoine,
        },
      ];
    case 'cycle':
      return [
        {
          id: 'cycle',
          module: 'budget',
          link: '/budget-patrimoine-management/cycle',
          query: { liaison: project.linkId },
        },
        {
          id: 'projection',
          module: 'patrimoine',
          link: '/patrimoine-management/projection',
          query: patrimoine,
        },
        {
          id: 'calendrier',
          module: 'budget',
          link: '/budget-management/calendrier-360',
          query: { budget: project.budgetProjectId },
        },
      ];
  }
}

/** L'étape à accomplir maintenant : la première libérée et non faite. */
export function currentStep(project: BpmProject): BpmStepState | null {
  return project.journey.find((step) => step.unlocked && !step.done) ?? null;
}

export function progress(project: BpmProject): number {
  return project.journey.filter((step) => step.done).length;
}

const at = (value: string) => new Date(`${value}T12:00:00Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);

/** Même découpage civil que le service : lundi, premier du mois, premier janvier. */
export function periodStart(value: string, cadence: BpmCadence): string {
  const d = at(value);
  if (cadence === 'weekly') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  else if (cadence === 'monthly') d.setUTCDate(1);
  else d.setUTCMonth(0, 1);
  return iso(d);
}
export function nextPeriod(start: string, cadence: BpmCadence): string {
  const d = at(start);
  if (cadence === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else if (cadence === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1, 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1, 0, 1);
  return iso(d);
}

/** Les deux départs possibles d'un cycle : la période en cours ou la suivante. */
export function startChoices(today: string, cadence: BpmCadence): [string, string] {
  const current = periodStart(today, cadence);
  return [current, nextPeriod(current, cadence)];
}

/** Ce qui manque pour avancer dans l'assistant, étape par étape. */
export function missingFor(stage: number, draft: BpmCreation): string[] {
  const filled = (value: string) => value.trim().length > 0;
  const missing: string[] = [];
  if (stage >= 0 && !filled(draft.title)) missing.push('title');
  if (stage >= 1 && !filled(draft.budgetTitle)) missing.push('budgetTitle');
  if (stage >= 1 && !filled(draft.centerName)) missing.push('centerName');
  if (stage >= 2 && !filled(draft.patrimoineTitle)) missing.push('patrimoineTitle');
  if (stage >= 2 && !filled(draft.allocationName)) missing.push('allocationName');
  if (stage >= 3 && !draft.startDate) missing.push('startDate');
  return missing;
}

/** La courbe du patrimoine total : une valeur par clôture, puis la valeur d'aujourd'hui. */
const periodMonth = new Intl.DateTimeFormat('fr-FR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const periodDay = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const markMonth = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
const markDay = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const atNoon = (value: string) => new Date(`${value}T12:00:00Z`);

/**
 * Le nom lisible d'une période selon son cycle : « octobre 2026 »,
 * « semaine du 19 octobre » ou « année 2026 ». Les mots viennent du contrat éditorial.
 */
export function periodLabel(
  start: string,
  cadence: BpmCadence | undefined,
  words: { week: string; year: string },
): string {
  if (cadence === 'weekly') return `${words.week} ${periodDay.format(atNoon(start))}`;
  if (cadence === 'yearly') return `${words.year} ${start.slice(0, 4)}`;
  return periodMonth.format(atNoon(start));
}

/** Le repère court d'une période dans une frise : « oct. », « 19 oct. » ou « 2026 ». */
export function periodMark(start: string, cadence: BpmCadence | undefined): string {
  if (cadence === 'weekly') return markDay.format(atNoon(start));
  if (cadence === 'yearly') return start.slice(0, 4);
  return markMonth.format(atNoon(start));
}

export function wealthCurve(snapshot: BpmSnapshot, width = 320, height = 96) {
  const values = [
    ...snapshot.history.map((entry) => entry.patrimoineAfterCents),
    snapshot.standing.totalCents,
  ].filter((value): value is number => value !== null);
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || Math.max(Math.abs(max), 100);
  const step = width / (values.length - 1);
  const points = values.map((value, index) => ({
    x: index * step,
    y: 8 + ((max - value) / span) * (height - 16),
    value,
  }));
  const line = points
    .map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');
  return {
    width,
    height,
    line,
    area: `${line} L${width} ${height} L0 ${height} Z`,
    points,
    rising: values.at(-1)! >= values[0]!,
  };
}

/** L'anneau de la période : longueur de trait parcourue sur la circonférence. */
export function periodRing(snapshot: BpmSnapshot, radius = 52) {
  const circumference = 2 * Math.PI * radius;
  const ratio = snapshot.period.length ? snapshot.period.elapsed / snapshot.period.length : 0;
  return {
    radius,
    circumference,
    dash: `${(circumference * ratio).toFixed(1)} ${circumference.toFixed(1)}`,
  };
}
