import { BpmCreationDetails, BpmProfile } from './bpm.model';
import { goalDate } from './bpm-profile.model';
/** Un brouillon indépendant des valeurs livrées ; aucune écriture métier. */
export function startDetails(profile: BpmProfile, today: string): BpmCreationDetails {
  return {
    providers: (profile.providerTypes ?? []).map((p) => ({
      key: p.key,
      name: p.name,
      type: p.name,
      note: p.help,
    })),
    beneficiary: profile.scenario?.beneficiary ?? profile.label,
    centers: profile.centers.map((c) => ({ ...c, note: c.help })),
    flows: [
      ...profile.incomes.map((row) => ({ ...row, kind: 'income' as const, center: '' })),
      ...profile.expenses.map((row) => ({
        ...row,
        kind: 'expense' as const,
        center: profile.centers.find((c) => c.name === row.center)!.key,
      })),
    ].map((row) => ({ ...row, date: today, endDate: '', settled: false, provider: '', note: '' })),
    allocations: profile.allocations.map((a) => ({ ...a, note: a.help })),
    assets: (profile.scenario?.assets ?? []).map((a) => ({ ...a, date: today, note: '' })),
    goals: profile.goals.map((g) => ({
      ...g,
      targetCents: g.targetCents ?? 0,
      targetDate: goalDate(today, g.yearsAhead),
      note: '',
    })),
  };
}
export function startErrors(data: BpmCreationDetails, today: string, section = 'all'): boolean {
  const amount = (n: number | null, optional = false) =>
    (optional && n === null) || (Number.isSafeInteger(n) && Number(n) >= 0);
  const date = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  const budget = section === 'all' || section === 'budget';
  const patrimoine = section === 'all' || section === 'patrimoine';
  const vision = section === 'all' || section === 'vision';
  const cs = new Set(data.centers.map((c) => c.key)),
    allocationKeys = new Set(data.allocations.map((a) => a.key));
  return (
    (budget && (!data.beneficiary.trim() || !data.centers.length || !data.allocations.length)) ||
    (budget && (data.providers ?? []).some((p) => !p.name.trim() || !p.type.trim())) ||
    (budget &&
      data.flows.some(
        (f) => !!f.provider && !(data.providers ?? []).some((p) => p.key === f.provider),
      )) ||
    (budget && data.centers.some((c) => !c.name.trim() || !amount(c.limitCents, true))) ||
    (patrimoine && data.allocations.some((a) => !a.name.trim() || !amount(a.targetCents, true))) ||
    (budget &&
      data.flows.some(
        (f) =>
          !f.title.trim() ||
          !amount(f.amountCents) ||
          f.amountCents <= 0 ||
          !date(f.date) ||
          (!!f.endDate && (!date(f.endDate) || f.endDate < f.date)) ||
          (f.kind === 'expense' && !cs.has(f.center)) || (f.kind === 'income' && f.cadence === 'once' && !f.incomeType?.trim()),
      )) ||
    (patrimoine &&
      data.assets.some(
        (a) =>
          !a.name.trim() ||
          !allocationKeys.has(a.allocation) ||
          !amount(a.valueCents, true) ||
          !amount(a.liabilityCents) ||
          !date(a.date) ||
          a.date > today,
      )) ||
    (vision &&
      data.goals.some(
        (g) =>
          !g.label.trim() ||
          !allocationKeys.has(g.allocation) ||
          !amount(g.targetCents) ||
          g.targetCents <= 0 ||
          !date(g.targetDate),
      ))
  );
}
