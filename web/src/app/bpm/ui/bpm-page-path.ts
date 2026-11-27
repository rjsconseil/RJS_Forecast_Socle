import { InjectionToken } from '@angular/core';

/** Adresse d'un écran métier dans l'application qui le présente. */
export const BPM_PAGE_PATH = new InjectionToken<(path: string) => string>('BPM page path', {
  providedIn: 'root',
  factory: () => path => path,
});

/** Liens techniques vers le noyau transverse (fiches et tableaux du noyau). Une application qui présente les écrans
 * métier à l'utilisateur final peut les masquer : ils font sortir de son parcours. */
export const BPM_CORE_LINKS = new InjectionToken<boolean>('BPM core links', { providedIn: 'root', factory: () => true });
