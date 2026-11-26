// P3 · Façade publique du middleware Budget : la seule porte d'import pour les modules qui en dépendent.
// Tout le reste du dossier est privé. Les commandes et lectures métier passent par `socle.modules.budget`.
export { CADENCES, CADENCE_LABEL, PER_YEAR, monthlyAverageCents, occurrenceDates, parseOccurrenceKey } from './recurrence.mjs';
export { addDays, today, periodContaining, cycleBounds, dayBefore, indexOfKey, periodByIndex, periodByKey, periodsPage } from '../cycle/api.mjs';
export { cycleFields, assertCycleChange, assertOpenDates, assertClosable } from '../cycle/api.mjs';
export { projectChecks, periodPaidCents } from './project-analysis.mjs';
export { CAP_LEVEL_PCT, capLevelOf, isNearCap } from './index.mjs';
// Financement des projets de la vie : chiffres purs et vues, lus par l'application pour ses pages.
export {
  abandonPlan, abandonPreview, fmt, frDate, fundingFigures, inRegime, isAbandoned, isValidatedCharge, isValidatedMove,
  projectMoveCents, openRequest, OVERRUN_STATUS, overrunsOf, overrunView, requestsOf, requestView, sharesOf,
  standardOfProject, linkedProjectBudgets, sum, taskFunding, isValidatedRefund, OVERRUN_REASONS,
  FUNDING_SOURCES, fundingSourceOf, countsInCycle, drawsOnPatrimoine, projectFundingSource, projectAccountingDate,
} from './funding.mjs';
