import type { InscriptionApplication } from '../astra/cadre';
import { INSCRIPTION as QUOTIDIEN } from './quotidien/application/inscription';
import { INSCRIPTION as PROJETS } from './projets/application/inscription';
import { INSCRIPTION as BUDGET } from './budget/application/inscription';
import { INSCRIPTION as PATRIMOINE } from './patrimoine/application/inscription';
import { INSCRIPTION as CYCLES } from './cycles/application/inscription';

/**
 * Registre des applications autonomes inscrites dans BPM-Astra : une ligne par application (de section ou hybride).
 * Ce fichier appartient aux applications, pas au socle : ajouter une application, c'est ajouter sa ligne ici.
 * Il n'importe que des inscriptions (vérifié par api/test/application-isolation.test.mjs).
 */
export const APPLICATIONS_INSCRITES: InscriptionApplication[] = [QUOTIDIEN, PROJETS, BUDGET, PATRIMOINE, CYCLES];
