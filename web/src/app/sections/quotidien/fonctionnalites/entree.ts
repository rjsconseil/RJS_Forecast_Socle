import type { Operation } from '../../../platform/grand-noyau';

/**
 * Entrée de l'application autonome Mon quotidien : le budget personnel du quotidien, c'est-à-dire les mouvements du
 * budget de vie (entrées et dépenses, prévues et réglées), lus par le grand noyau. L'emploi du temps (agenda du
 * quotidien) entrera ici quand le grand noyau exposera ses lectures du calendrier (fondation repérée, docs/sections/quotidien.md §5).
 * La sortie de l'application reste à définir selon les fonctions qui seront demandées.
 */
export interface MouvementQuotidien {
  id: string;
  date: string;
  libelle: string;
  sens: 'entree' | 'depense';
  montantCents: number;
  regle: boolean;
  poste: string;
}

export interface EntreeQuotidien {
  mouvements: MouvementQuotidien[];
  recuCents: number;
  payeCents: number;
  aRecevoirCents: number;
  aPayerCents: number;
  /** Emploi du temps : à brancher (lecture du calendrier par le grand noyau). */
  agenda: null;
}

/** Les mouvements du budget de vie entre deux dates incluses (AAAA-MM-JJ), triés par date. */
export function entreeQuotidien(operations: Operation[], du: string, au: string): EntreeQuotidien {
  const mouvements = operations
    .map((o): MouvementQuotidien => ({
      id: o.id,
      date: o.status === 'realized' ? o.realizedDate ?? o.date : o.date,
      libelle: o.label,
      sens: o.direction === 'income' ? 'entree' : 'depense',
      montantCents: o.status === 'realized' ? o.realizedAmountCents ?? o.amountCents : o.amountCents,
      regle: o.status === 'realized',
      poste: o.costCenterLabel ?? o.costCenterRef,
    }))
    .filter((m) => m.date >= du && m.date <= au)
    .sort((a, b) => a.date.localeCompare(b.date) || a.libelle.localeCompare(b.libelle));
  const somme = (sens: MouvementQuotidien['sens'], regle: boolean) =>
    mouvements.filter((m) => m.sens === sens && m.regle === regle).reduce((t, m) => t + m.montantCents, 0);
  return { mouvements, recuCents: somme('entree', true), payeCents: somme('depense', true), aRecevoirCents: somme('entree', false), aPayerCents: somme('depense', false), agenda: null };
}
