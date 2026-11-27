import { ASTRA_APPLICATION } from "../astra/astra.application";
/**
 * Les applications du site. Ajouter une application = écrire sa déclaration (`platform/application.ts`)
 * et l'inscrire ici : c'est la seule ligne à toucher hors du dossier de l'application.
 */
import type { Type } from '@angular/core';
import { ApplicationDeclaration } from './application';
import { APPLICATIONS_INSCRITES } from '../sections/inscriptions';
import { espacesAutonomes } from './applications-autonomes';

// BPM-Astra est l'application BPM du site : elle présente les écrans métier de `bpm/` (catalogue `bpm.screens.ts`).
export const APPLICATIONS: ApplicationDeclaration[] = [ASTRA_APPLICATION];

export const applicationOf = (id: string | null | undefined): ApplicationDeclaration | null => APPLICATIONS.find((application) => application.id === id) ?? null;
/** L'écran de création d'utilisateur fourni par une application ; sans lui, la page Utilisateurs mène à l'accueil. */
export const loadUserCreation = (): Promise<Type<unknown>> =>
  APPLICATIONS.find((application) => application.userCreation)?.userCreation?.() ?? import('../home/home').then((m) => m.HomePage);
/** L'application ouverte par défaut dans les ateliers (Navigation system). */
export const defaultApplicationId = (): string => APPLICATIONS[0]?.id ?? '';
/** L'accueil de l'application par défaut : la racine du site l'ouvre (sinon le portail des modules). */
export const defaultApplicationHome = (): string => APPLICATIONS[0]?.zone.home ?? '/modules';
/** Les applications autonomes qui ont leur propre espace hors de BPM-Astra (lien dans la zone Noyau transverse). */
export const ESPACES_AUTONOMES = espacesAutonomes(APPLICATIONS_INSCRITES);
