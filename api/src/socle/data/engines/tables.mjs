import { SECTION_LIST } from '../../sections.mjs';

// P5 · Données gérées — rangement des collections en tables, commun aux moteurs SQL (SQLite, PostgreSQL).
// Les tables sont rangées à l'image des cinq sections du site, par préfixe :
//   MQ_ Mon quotidien · MP_ Mes projets · MB_ Mon budget · PT_ Patrimoine · CL_ Cycles · SY_ système (socle).

/**
 * Sections du site et collections qu'elles portent, par préfixe ; une collection hors de ces sections va dans le système (SY_).
 * Dérivé du catalogue unique des sections (`socle/sections.json`).
 */
export const SECTIONS = Object.fromEntries(SECTION_LIST.map((s) => [s.prefix, { label: s.label, key: s.key, collections: [...s.collections] }]));
const SECTION_OF = new Map(Object.entries(SECTIONS).flatMap(([prefix, s]) => s.collections.map((c) => [c, prefix])));
const snake = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
/** Table d'une collection : préfixe de sa section, puis son nom (« taskBudgetRequests » → « MP_task_budget_requests »). */
export const tableOf = (collection) => `${SECTION_OF.get(collection) ?? 'SY'}_${snake(collection)}`;
/** Nom SQL entre guillemets. */
export const q = (name) => `"${String(name).replace(/"/g, '""')}"`;

/** Clé de la partition système : paramètres, valeurs simples du socle, objets sans user. */
export const SYSTEM_PARTITION = '';
/** Partition d'un objet ou d'une entrée de journal : son user, sinon la partition système. */
export const partitionOf = (value) => (typeof value?.userId === 'string' && value.userId ? value.userId : SYSTEM_PARTITION);
/** Entrées de journal gardées en mémoire par partition (l'historique complet reste en base). */
export const JOURNAL_WINDOW = 2000;
