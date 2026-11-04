import { BpmProject, nextPeriod, periodStart } from './bpm.model';
/** Un chiffre ou une échéance ouvre toujours la même lecture, avec son vrai intervalle. */
export function expensePeriodQuery(
  project: BpmProject,
  input: {
    start?: string;
    end?: string;
    date?: string;
    operation?: string;
    occurrence?: string;
    poste?: string;
  } = {},
) {
  let start = input.start ?? project.snapshot?.period.start;
  let end = input.end ?? project.snapshot?.period.end;
  if (input.date && (!start || !end || input.date < start || input.date >= end)) {
    start = periodStart(input.date, project.link?.periodicity ?? 'monthly');
    end = nextPeriod(start, project.link?.periodicity ?? 'monthly');
  }
  return {
    projet: project.id,
    ...(start && end ? { du: start, au: end } : {}),
    ...(input.operation ? { operation: input.operation } : {}),
    ...(input.occurrence ? { occurrence: input.occurrence } : {}),
    ...(input.poste ? { poste: input.poste } : {}),
  };
}
