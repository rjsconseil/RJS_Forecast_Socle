import { signal } from '@angular/core';
import { NavigationOrder } from '../navigation/navigation-model';

/**
 * L'ordre des liens réglé dans le module Navigation system. Le plan garde ses destinations ; seules
 * les listes qu'il projette (accueil, menu, onglets, accès rapides) lisent cet ordre. Vide : ordre du plan.
 */
export const planOrder = signal<NavigationOrder>({});

/** Les clés partagées par le plan, l'arbre des liens et les libellés. */
export const PORTAL_KEY = '/';
export const bandKey = (band: string) => 'anchor:portal:' + band;
export const zoneKey = (zone: string) => 'zone:' + zone;
export const sectionKey = (zone: string, section: string) => `section:${zone}:${section}`;
/** Le modèle de fiche d'une page : parent des vues de la fiche ouverte. */
export const objectKey = (page: string) => page + '/:id';
