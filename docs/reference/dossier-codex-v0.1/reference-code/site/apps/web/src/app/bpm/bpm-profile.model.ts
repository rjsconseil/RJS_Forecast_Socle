import { siteSetting } from '../shared/site-settings';
import { BpmProfile, BpmProject, BpmWorkspace } from './bpm.model';

/**
 * Les profils de paramétrage côté interface : retrouver le profil d'un projet
 * (sinon celui proposé par Configuration) et en tirer des valeurs de départ.
 * Rien n'est enregistré : l'assistant et le budget type les proposent à relire.
 */

/** Le profil proposé par défaut, réglé dans Configuration (famille livrée). */
export function defaultProfileId(): string {
  return siteSetting<string>('bpm.creation.profil');
}

/** Le profil d'un projet, sinon le profil proposé par défaut ; null si l'API n'en livre aucun. */
export function profileOf(
  workspace: Pick<BpmWorkspace, 'profiles'> | null | undefined,
  project?: Pick<BpmProject, 'profile'> | null,
): BpmProfile | null {
  const profiles = workspace?.profiles ?? [];
  return (
    profiles.find((profile) => profile.id === project?.profile) ??
    profiles.find((profile) => profile.id === defaultProfileId()) ??
    profiles[0] ??
    null
  );
}

/** L'échéance d'un objectif du profil : la même date, autant d'années plus tard. */
export function goalDate(today: string, yearsAhead: number): string {
  const year = Number(today.slice(0, 4)) + yearsAhead;
  return `${year}${today.slice(4, 7)}-01`;
}

/** L'épargne naturelle d'un profil, ramenée à un mois. */
export function profileMonthlySaving(profile: BpmProfile): number {
  const perMonth = { weekly: 52 / 12, monthly: 1, yearly: 1 / 12 } as const;
  const sum = (list: { amountCents: number; cadence: keyof typeof perMonth }[]) =>
    list.reduce((total, entry) => total + entry.amountCents * perMonth[entry.cadence], 0);
  return Math.round(sum(profile.incomes) - sum(profile.expenses));
}
