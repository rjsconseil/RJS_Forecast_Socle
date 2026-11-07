import { effect, inject, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

/**
 * Une vue d'une page a une seule adresse : sa sous-page. Les anciens liens `?view=` (ou ancres)
 * y conduisent en gardant la lecture, pour que le menu, le fil d'Ariane et les onglets disent vrai.
 */
export function redirectLegacyView(view: () => string, main: string, targets: Record<string, string>, onSubpage: () => boolean) {
  const router = inject(Router);
  const route = inject(ActivatedRoute);
  effect(() => {
    const current = view();
    if (onSubpage() || current === main || !targets[current]) return;
    untracked(() => {
      const queryParams = { ...route.snapshot.queryParams };
      delete queryParams['view'];
      void router.navigate([targets[current]], { queryParams, fragment: route.snapshot.fragment ?? undefined, replaceUrl: true });
    });
  });
}
