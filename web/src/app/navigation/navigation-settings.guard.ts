import { CanDeactivateFn } from '@angular/router';
/** Quitter l'atelier ne doit jamais effacer silencieusement une modification. */
export const navigationSettingsGuard: CanDeactivateFn<{ dirty(): boolean; busy(): boolean }> = (
  component,
) =>
  !component.busy() &&
  (!component.dirty() ||
    window.confirm('Quitter Navigation system et abandonner les modifications non enregistrées ?'));
