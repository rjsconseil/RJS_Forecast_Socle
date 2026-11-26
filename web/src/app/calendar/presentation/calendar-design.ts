import { InjectionToken, Provider } from '@angular/core';

/**
 * Couche DESIGN du calendrier : l'apparence statique (surfaces, traits, rayons, typographie, ombres,
 * couleurs d'état). Elle ne décide d'aucun mouvement : les effets d'affichage sont une couche à part
 * (`calendar-effects.ts`).
 *
 * Un design est une donnée : un identifiant, un libellé et des valeurs de jetons. La peau du module
 * (`calendar-skin-design.scss`) lit ces jetons ; un site ajoute son design sans écrire de CSS, avec
 * `provideCalendarDesigns(defineCalendarDesign({ … }))`. Il peut aussi nommer une classe (`className`)
 * s'il livre des règles en plus, à placer sous `[data-cal-design='<id>']`.
 *
 * « Standard » ne pose aucun jeton : c'est l'apparence d'origine du calendrier, inchangée.
 */

/** Jetons de design lus par la peau du module, avec leur rôle. */
export const DESIGN_TOKENS = {
  font: 'Police du calendrier',
  numeric: 'Police des chiffres (montants, numéros de jour)',
  text: 'Texte principal',
  muted: 'Texte secondaire',
  surface: 'Fond des cartes (grille, agenda, aperçu, volet)',
  surfaceAlt: 'Fond des cases et des éléments de liste',
  surfaceHead: 'Fond des en-têtes (mois, jours de la semaine)',
  line: 'Contour des cartes',
  frame: 'Contour en dégradé des cartes (remplace le contour uni)',
  topline: 'Filet lumineux en haut des cartes',
  gridLine: 'Trait entre les cases',
  accent: 'Couleur d’accent du design (variante, jamais une couleur d’état)',
  accentSoft: 'Accent atténué (sélection, survol)',
  radius: 'Arrondi des cartes',
  radiusSmall: 'Arrondi des cases, pastilles et éléments',
  shadow: 'Ombre des cartes',
  shadowHover: 'Ombre au survol',
  backdrop: 'Filtre d’arrière-plan des cartes (verre)',
  weekend: 'Voile des fins de semaine',
  todayRing: 'Anneau du jour courant',
  eventTint: 'Part de la couleur de la source dans le fond d’un événement',
  eventRadius: 'Arrondi des événements',
  outsideOpacity: 'Opacité des jours hors du mois',
  stateNegative: 'Couleur d’état : dépassement, négatif (rouge)',
  statePositive: 'Couleur d’état : gain, positif (vert)',
  stateNeutral: 'Couleur d’état : situation standard (bleu)',
} as const;
export type CalendarDesignToken = keyof typeof DESIGN_TOKENS;

export interface CalendarDesign {
  id: string;
  label: string;
  description: string;
  /** Aperçu du sélecteur : trois couleurs représentatives. */
  swatch: [string, string, string];
  /** Valeurs des jetons ; un jeton absent garde la valeur d'origine du calendrier. */
  tokens: Partial<Record<CalendarDesignToken, string>>;
  /** Classe ajoutée au calendrier pour des règles propres au design (facultatif). */
  className?: string;
}

const ID = /^[a-z0-9-]+$/;

/** Contrôle et fige une définition de design (identifiant, libellé, jetons connus). */
export function defineCalendarDesign(design: CalendarDesign): CalendarDesign {
  if (!ID.test(design.id)) throw new Error(`Design de calendrier : identifiant invalide « ${design.id} ».`);
  if (!design.label?.trim()) throw new Error(`Design de calendrier « ${design.id} » : un libellé est attendu.`);
  for (const key of Object.keys(design.tokens)) {
    if (!(key in DESIGN_TOKENS)) throw new Error(`Design de calendrier « ${design.id} » : jeton inconnu « ${key} ».`);
  }
  return Object.freeze({ ...design, tokens: Object.freeze({ ...design.tokens }) });
}

/** Nom de la variable CSS d'un jeton : `surfaceAlt` → `--cal-d-surface-alt`. */
export const designVariable = (token: string) => `--cal-d-${token.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`;

/** Variables CSS d'un design, à poser sur le calendrier. */
export function designStyle(design: CalendarDesign): Record<string, string> {
  return Object.fromEntries(Object.entries(design.tokens).map(([k, v]) => [designVariable(k), v as string]));
}

/** Designs ajoutés par le site (en plus de ceux du module). */
export const CALENDAR_DESIGNS = new InjectionToken<CalendarDesign[][]>('CALENDAR_DESIGNS');

/** À placer dans les `providers` de l'application (ou d'une route) pour proposer ses designs. */
export function provideCalendarDesigns(...designs: CalendarDesign[]): Provider {
  return { provide: CALENDAR_DESIGNS, multi: true, useValue: designs.map(defineCalendarDesign) };
}

// ---------- Designs livrés par le module ----------

/** L'apparence d'origine, inchangée : aucun jeton n'est posé. */
export const STANDARD_DESIGN = defineCalendarDesign({
  id: 'standard',
  label: 'Standard',
  description: 'L’apparence d’origine du calendrier.',
  swatch: ['#ffffff', '#e2e7ef', '#4f46e5'],
  tokens: {},
});

/**
 * « Horizon » — proposition du module, et exemple de définition pour les sites : une application
 * soignée, d'allure avancée et sobre. Surfaces en verre clair, traits fins, en-têtes en bandeau
 * dégradé indigo vers cyan (variantes du bleu), chiffres à chasse fixe, anneau lumineux du jour.
 * Les couleurs d'état restent exactes : rouge = dépassement ou négatif, vert = gain ou positif,
 * bleu = situation standard ; le design n'emploie que leurs variantes (indigo, cyan, ardoise).
 */
export const HORIZON_DESIGN = defineCalendarDesign({
  id: 'horizon',
  label: 'Horizon',
  description: 'Application avancée et sobre : verre clair, traits fins, accents indigo et cyan.',
  swatch: ['#f6f8fd', '#4f46e5', '#0891b2'],
  tokens: {
    font: "'Inter', 'Segoe UI', system-ui, sans-serif",
    numeric: "'JetBrains Mono', 'SFMono-Regular', ui-monospace, monospace",
    text: '#0f1a2e',
    muted: '#5a6a85',
    surface: 'linear-gradient(180deg, #ffffff 0%, #f7f9fe 100%)',
    surfaceAlt: 'rgba(255,255,255,.74)',
    surfaceHead: 'linear-gradient(100deg, #eef0ff 0%, #e9f6fb 55%, #f4f7fc 100%)',
    line: 'rgba(79,70,229,.18)',
    frame: 'linear-gradient(135deg, rgba(79,70,229,.55) 0%, rgba(8,145,178,.40) 45%, rgba(79,70,229,.10) 100%)',
    topline: 'linear-gradient(90deg, #4f46e5 0%, #0891b2 60%, rgba(8,145,178,0) 100%)',
    gridLine: 'rgba(15,26,46,.07)',
    accent: '#4f46e5',
    accentSoft: 'rgba(79,70,229,.10)',
    radius: '18px',
    radiusSmall: '10px',
    shadow: '0 1px 0 rgba(255,255,255,.9) inset, 0 1px 2px rgba(15,26,46,.06), 0 18px 40px -22px rgba(49,46,129,.35)',
    shadowHover: '0 0 0 1px rgba(79,70,229,.28), 0 14px 30px -16px rgba(8,145,178,.45)',
    backdrop: 'blur(10px) saturate(1.15)',
    weekend: 'linear-gradient(180deg, rgba(79,70,229,.035), rgba(8,145,178,.035))',
    todayRing: 'inset 0 0 0 2px rgba(79,70,229,.55), 0 0 0 4px rgba(8,145,178,.12)',
    eventTint: '12%',
    eventRadius: '8px',
    outsideOpacity: '0.42',
    stateNegative: '#dc2626',
    statePositive: '#16a34a',
    stateNeutral: '#2563eb',
  },
});

export const BUILT_IN_DESIGNS: readonly CalendarDesign[] = [STANDARD_DESIGN, HORIZON_DESIGN];
