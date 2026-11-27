import type { InscriptionApplication } from '../astra/cadre';
import { INSCRIPTION as PROJETS } from './projets/application/inscription';

/**
 * Registre des applications autonomes inscrites dans BPM-Astra : une ligne par application (de section ou hybride).
 * Ce fichier appartient aux applications, pas au socle : ajouter une application, c'est ajouter sa ligne ici.
 * Il n'importe que des inscriptions (vérifié par api/test/application-isolation.test.mjs).
 */
export const APPLICATIONS_INSCRITES: InscriptionApplication[] = [PROJETS];
