import { InjectionToken } from '@angular/core';

/** Adresse d'un écran métier dans l'application qui le présente. */
export const BPM_PAGE_PATH = new InjectionToken<(path: string) => string>('BPM page path', {
  providedIn: 'root',
  factory: () => path => path,
});

/** Liens techniques vers le noyau transverse (fiches et tableaux du noyau). Une application qui présente les écrans
 * métier à l'utilisateur final peut les masquer : ils font sortir de son parcours. */
export const BPM_CORE_LINKS = new InjectionToken<boolean>('BPM core links', { providedIn: 'root', factory: () => true });

/** Fiche d'un projet : blocs de pilotage détaillés (cockpit « Du suivi à l'action », volets repliés de ventilation,
 * contrôles et dépenses sans tâche, note de lecture). Une application plus directe peut les retirer : les tâches,
 * l'enveloppe et ses chiffres restent sur la fiche. */
export const BPM_PROJECT_DETAIL_PANELS = new InjectionToken<boolean>('BPM project detail panels', { providedIn: 'root', factory: () => true });
