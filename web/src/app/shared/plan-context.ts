import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { PlanContext, planContext } from './site-plan';

/**
 * Le nom des objets ouverts (une fiche projet) : la page le publie dès sa lecture, le cadre
 * (fil d'Ariane, menu, bandeau, historique) l'affiche à la place d'un libellé générique.
 */
@Injectable({ providedIn: 'root' })
export class PageObjectLabels {
  private readonly labels = signal<Record<string, string>>({});

  /** `link` est l'adresse canonique de la fiche ; un libellé vide l'efface. */
  set(link: string, label: string | null | undefined): void {
    const value = label?.trim() || null;
    if ((this.labels()[link] ?? null) === value) return;
    this.labels.update((all) => {
      const next = { ...all };
      if (value) next[link] = value;
      else delete next[link];
      return next;
    });
  }

  /** Le nom de l'objet ouvert à cette adresse (ou à l'une de ses sous-pages), s'il est connu. */
  labelFor(url: string): string | null {
    const path = url.split(/[?#]/)[0].replace(/\/+$/, '');
    const all = this.labels();
    const link = Object.keys(all).find((entry) => path === entry || path.startsWith(entry + '/'));
    return link ? all[link] : null;
  }
}

/** L'adresse courante du routeur, mise à jour à chaque navigation aboutie. */
export function injectCurrentUrl(): Signal<string> {
  const router = inject(Router);
  return toSignal(
    router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => (event as NavigationEnd).urlAfterRedirects),
    ),
    { initialValue: router.url },
  );
}

/** Le contexte de plan de l'adresse courante, enrichi du nom de l'objet ouvert. */
export function injectPlanContext(): Signal<PlanContext> {
  const url = injectCurrentUrl();
  const labels = inject(PageObjectLabels);
  return computed(() => planContext(url(), labels.labelFor(url())));
}
