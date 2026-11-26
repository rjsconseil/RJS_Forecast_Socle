import { InjectionToken, Provider } from '@angular/core';

/**
 * Couche EFFETS D'AFFICHAGE du calendrier : le mouvement (apparition, disparition, cascade, survol,
 * aperçu d'un jour, passage d'une période à l'autre). Elle ne touche à aucune couleur ni forme : le
 * design est une couche à part (`calendar-design.ts`).
 *
 * Un effet est une donnée : il choisit, pour chaque moment, une primitive de mouvement que le module
 * sait jouer (`calendar-skin-effects.scss` et les sorties du composant), et déclare ses réglages
 * (durées, distances) que la personne ajuste dans le volet. Un site ajoute ses effets avec
 * `provideCalendarEffects(defineCalendarEffect({ … }))`, sans écrire de CSS.
 *
 * « Standard » ne choisit aucune primitive : ce sont les fondus courts d'origine du calendrier.
 * Toute primitive s'efface quand la personne demande moins d'animations (prefers-reduced-motion).
 */

export const ENTER_PRIMITIVES = { none: 'Aucune', fade: 'Fondu', 'fade-up': 'Fondu et montée', 'fade-scale': 'Fondu et zoom' } as const;
export const LEAVE_PRIMITIVES = { none: 'Aucune', fade: 'Fondu', 'fade-down': 'Fondu et descente' } as const;
export const HOVER_PRIMITIVES = { none: 'Aucun', lift: 'Soulèvement', glow: 'Halo' } as const;
export const PERIOD_PRIMITIVES = { none: 'Immédiat', crossfade: 'Fondu enchaîné' } as const;

export interface CalendarMotion {
  /** Apparition des jours, des événements, des éléments de liste et de l'aperçu. */
  enter: keyof typeof ENTER_PRIMITIVES;
  /** Disparition d'un événement masqué, d'un élément de liste, de l'aperçu. */
  leave: keyof typeof LEAVE_PRIMITIVES;
  /** Les éléments apparaissent l'un après l'autre (décalage réglable). */
  stagger: boolean;
  /** Réponse au survol d'un événement ou d'un élément de liste. */
  hover: keyof typeof HOVER_PRIMITIVES;
  /** Passage d'une période à l'autre (mois, semaine, année). */
  period: keyof typeof PERIOD_PRIMITIVES;
}

/** Réglages qu'un effet peut exposer ; chacun alimente une variable lue par les primitives. */
export const EFFECT_PARAMETERS = {
  enterMs: { label: 'Durée du fondu d’entrée', unit: 'ms', min: 0, max: 1500, step: 10 },
  leaveMs: { label: 'Durée du fondu de sortie', unit: 'ms', min: 0, max: 1200, step: 10 },
  staggerMs: { label: 'Décalage entre deux éléments', unit: 'ms', min: 0, max: 80, step: 2 },
  distancePx: { label: 'Amplitude du mouvement', unit: 'px', min: 0, max: 24, step: 1 },
  peekMs: { label: 'Fondu de l’aperçu d’un jour', unit: 'ms', min: 0, max: 800, step: 10 },
  hoverMs: { label: 'Réponse au survol', unit: 'ms', min: 0, max: 600, step: 10 },
} as const;
export type CalendarEffectParameter = keyof typeof EFFECT_PARAMETERS;
export type CalendarEffectValues = Partial<Record<CalendarEffectParameter, number>>;

export interface CalendarEffect {
  id: string;
  label: string;
  description: string;
  motion: CalendarMotion;
  /** Réglages proposés dans le volet, avec leur valeur par défaut. */
  defaults: CalendarEffectValues;
  /** Classe ajoutée au calendrier pour des règles propres à l'effet (facultatif). */
  className?: string;
}

const ID = /^[a-z0-9-]+$/;

/** Contrôle et fige une définition d'effet (primitives connues, réglages dans leurs bornes). */
export function defineCalendarEffect(effect: CalendarEffect): CalendarEffect {
  if (!ID.test(effect.id)) throw new Error(`Effet de calendrier : identifiant invalide « ${effect.id} ».`);
  if (!effect.label?.trim()) throw new Error(`Effet de calendrier « ${effect.id} » : un libellé est attendu.`);
  const m = effect.motion;
  if (!(m.enter in ENTER_PRIMITIVES) || !(m.leave in LEAVE_PRIMITIVES) || !(m.hover in HOVER_PRIMITIVES) || !(m.period in PERIOD_PRIMITIVES)) {
    throw new Error(`Effet de calendrier « ${effect.id} » : primitive de mouvement inconnue.`);
  }
  for (const [key, value] of Object.entries(effect.defaults)) {
    const p = EFFECT_PARAMETERS[key as CalendarEffectParameter];
    if (!p) throw new Error(`Effet de calendrier « ${effect.id} » : réglage inconnu « ${key} ».`);
    if (typeof value !== 'number' || value < p.min || value > p.max) throw new Error(`Effet de calendrier « ${effect.id} » : « ${key} » hors de ${p.min}–${p.max}.`);
  }
  return Object.freeze({ ...effect, motion: Object.freeze({ ...m }), defaults: Object.freeze({ ...effect.defaults }) });
}

/** Valeurs en vigueur : celles de la personne, ramenées dans les bornes, sinon celles de l'effet. */
export function effectValues(effect: CalendarEffect, chosen: CalendarEffectValues | null | undefined): Required<CalendarEffectValues> {
  const out = {} as Required<CalendarEffectValues>;
  for (const [key, p] of Object.entries(EFFECT_PARAMETERS) as [CalendarEffectParameter, (typeof EFFECT_PARAMETERS)[CalendarEffectParameter]][]) {
    const own = chosen?.[key];
    const value = typeof own === 'number' && Number.isFinite(own) && key in effect.defaults ? own : effect.defaults[key] ?? 0;
    out[key] = Math.min(p.max, Math.max(p.min, Math.round(value / p.step) * p.step));
  }
  return out;
}

/** Variables CSS et attributs d'un effet, à poser sur le calendrier (rien pour un effet sans primitive). */
export function effectStyle(effect: CalendarEffect, values: Required<CalendarEffectValues>): Record<string, string> {
  const vars: Record<string, string> = {};
  if (effect.motion.enter !== 'none' || effect.motion.leave !== 'none' || effect.motion.hover !== 'none' || effect.motion.period !== 'none') {
    vars['--cal-fx-enter'] = `${values.enterMs}ms`;
    vars['--cal-fx-leave'] = `${values.leaveMs}ms`;
    vars['--cal-fx-stagger'] = `${effect.motion.stagger ? values.staggerMs : 0}ms`;
    vars['--cal-fx-distance'] = `${values.distancePx}px`;
    vars['--cal-fx-peek'] = `${values.peekMs}ms`;
    vars['--cal-fx-hover'] = `${values.hoverMs}ms`;
  }
  return vars;
}

/** Effets ajoutés par le site (en plus de ceux du module). */
export const CALENDAR_EFFECTS = new InjectionToken<CalendarEffect[][]>('CALENDAR_EFFECTS');

/** À placer dans les `providers` de l'application (ou d'une route) pour proposer ses effets. */
export function provideCalendarEffects(...effects: CalendarEffect[]): Provider {
  return { provide: CALENDAR_EFFECTS, multi: true, useValue: effects.map(defineCalendarEffect) };
}

// ---------- Effets livrés par le module ----------

/** Les fondus courts d'origine du calendrier, inchangés : aucune primitive n'est posée. */
export const STANDARD_EFFECT = defineCalendarEffect({
  id: 'standard',
  label: 'Standard',
  description: 'Les fondus courts d’origine du calendrier.',
  motion: { enter: 'none', leave: 'none', stagger: false, hover: 'none', period: 'none' },
  defaults: {},
});

/**
 * « Fondu fluide » — proposition du module, et exemple de définition pour les sites : fondu d'entrée
 * avec une légère montée, en cascade ; fondu de sortie quand un événement est masqué ; fondu enchaîné
 * d'une période à l'autre ; aperçu d'un jour qui apparaît en fondu et zoom ; halo au survol.
 * Toutes les durées se règlent dans le volet.
 */
export const FONDU_EFFECT = defineCalendarEffect({
  id: 'fondu-fluide',
  label: 'Fondu fluide',
  description: 'Fondus d’entrée et de sortie réglables, cascade, fondu enchaîné entre périodes, halo au survol.',
  motion: { enter: 'fade-up', leave: 'fade', stagger: true, hover: 'glow', period: 'crossfade' },
  defaults: { enterMs: 320, leaveMs: 200, staggerMs: 14, distancePx: 6, peekMs: 220, hoverMs: 180 },
});

/** Aucune animation : utile à la lecture continue, et pour qui préfère un écran immobile. */
export const IMMOBILE_EFFECT = defineCalendarEffect({
  id: 'immobile',
  label: 'Sans animation',
  description: 'Tout s’affiche immédiatement, sans fondu ni mouvement.',
  motion: { enter: 'none', leave: 'none', stagger: false, hover: 'none', period: 'none' },
  defaults: {},
  className: 'cal-fx-still',
});

export const BUILT_IN_EFFECTS: readonly CalendarEffect[] = [STANDARD_EFFECT, FONDU_EFFECT, IMMOBILE_EFFECT];
