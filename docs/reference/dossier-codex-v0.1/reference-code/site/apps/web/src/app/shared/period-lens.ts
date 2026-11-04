import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/**
 * La vue de période du site : regarder la même gestion par semaine, par mois ou
 * par année. Une page qui sait s'adapter annonce sa périodicité naturelle (par
 * exemple le cycle de son projet) ; le choix de l'utilisateur l'emporte, se lit
 * dans l'adresse (`?vue=semaine|mois|annee`) et se retient dans ce navigateur.
 * Boîte à outils commune : aucun module n'est nommé ici.
 */
export type PeriodLens = 'weekly' | 'monthly' | 'yearly';
export const PERIOD_LENSES: readonly PeriodLens[] = ['weekly', 'monthly', 'yearly'];

const SLUGS: Record<PeriodLens, string> = { weekly: 'semaine', monthly: 'mois', yearly: 'annee' };
const STORAGE = 'rjs-period-lens';

/** Une vue lue dans l'adresse ou la mémoire du navigateur ; null si la valeur n'en est pas une. */
export function lensOf(value: string | null | undefined): PeriodLens | null {
  if (!value) return null;
  if ((PERIOD_LENSES as readonly string[]).includes(value)) return value as PeriodLens;
  return PERIOD_LENSES.find((lens) => SLUGS[lens] === value) ?? null;
}
/** Le nombre de périodes d'une vue dans une année. */
export function lensPerYear(lens: PeriodLens): number {
  return lens === 'weekly' ? 52 : lens === 'monthly' ? 12 : 1;
}
/** Un montant exprimé par période `from`, ramené à la période `to` (arrondi au centime). */
export function perLens(cents: number, from: PeriodLens, to: PeriodLens): number {
  return from === to ? cents : Math.round((cents * lensPerYear(from)) / lensPerYear(to));
}

/** La vue d'un calendrier (année, mois, semaine) qui correspond à une vue de période. */
export function calendarViewOf(lens: PeriodLens): 'week' | 'month' | 'year' {
  return lens === 'weekly' ? 'week' : lens === 'yearly' ? 'year' : 'month';
}
/** La vue de période qui correspond à la vue d'un calendrier. */
export function lensOfCalendarView(view: string): PeriodLens {
  return view === 'week' ? 'weekly' : view === 'year' ? 'yearly' : 'monthly';
}

const read = (): PeriodLens | null => {
  try {
    return lensOf(localStorage.getItem(STORAGE));
  } catch {
    return null;
  }
};
const write = (lens: PeriodLens | null) => {
  try {
    if (lens) localStorage.setItem(STORAGE, lens);
    else localStorage.removeItem(STORAGE);
  } catch {
    /* Navigation privée : la vue suit simplement la page. */
  }
};

@Injectable({ providedIn: 'root' })
export class PeriodLensService {
  private readonly router = inject(Router);
  /** Le choix explicite de l'utilisateur ; null suit la périodicité naturelle de la page. */
  private readonly chosen = signal<PeriodLens | null>(read());
  private readonly offer = signal<{ id: number; natural: PeriodLens } | null>(null);
  private offers = 0;
  /** La périodicité naturelle de la page affichée, null quand la page ne s'adapte pas. */
  readonly natural = computed(() => this.offer()?.natural ?? null);
  /** Vrai quand la page affichée sait s'adapter : la commande s'affiche alors en haut à droite. */
  readonly offered = computed(() => this.offer() !== null);
  /** La vue appliquée : le choix de l'utilisateur, sinon celle de la page. */
  readonly active = computed<PeriodLens>(() => this.chosen() ?? this.natural() ?? 'monthly');

  constructor() {
    this.sync(this.router.url);
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => this.sync(event.urlAfterRedirects));
  }

  /**
   * Annonce que la page sait s'adapter, avec sa périodicité naturelle. L'annonce
   * se retire seule quand la page est détruite.
   */
  adapt(natural: PeriodLens, destroyRef: DestroyRef): void {
    const id = ++this.offers;
    this.offer.set({ id, natural });
    destroyRef.onDestroy(() => {
      if (this.offer()?.id === id) this.offer.set(null);
    });
  }
  /** Met à jour la périodicité naturelle annoncée (changement de projet sur la même page). */
  follow(natural: PeriodLens): void {
    const current = this.offer();
    if (current && current.natural !== natural) this.offer.set({ ...current, natural });
  }
  /**
   * Choisit une vue ; choisir la périodicité naturelle revient à la suivre.
   * Sans navigation (`navigate` faux), renvoie le paramètre d'adresse à fusionner
   * dans la navigation de la page : une seule navigation, aucune course.
   */
  choose(lens: PeriodLens, navigate = true): Record<string, string | null> {
    const follow = lens === this.natural();
    this.chosen.set(follow ? null : lens);
    write(follow ? null : lens);
    const vue = follow ? null : SLUGS[lens];
    if (navigate) {
      const tree = this.router.parseUrl(this.router.url);
      const queryParams = { ...tree.queryParams };
      if (vue === null) delete queryParams['vue'];
      else queryParams['vue'] = vue;
      tree.queryParams = queryParams;
      void this.router.navigateByUrl(tree, { replaceUrl: true });
    }
    return { vue };
  }
  /** Le paramètre d'adresse de la vue appliquée, pour garder la vue dans un lien. */
  query(): Record<string, string> {
    const chosen = this.chosen();
    return chosen ? { vue: SLUGS[chosen] } : {};
  }
  private sync(url: string): void {
    const lens = lensOf(this.router.parseUrl(url).queryParamMap.get('vue'));
    if (lens) this.chosen.set(lens);
  }
}
