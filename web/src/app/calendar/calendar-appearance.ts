// Calendrier : couche de présentation choisie par la personne. Le design règle l'apparence (jetons posés en
// variables), l'effet règle le mouvement (entrée, sortie, survol, passage d'une période à l'autre) et ses réglages.
// À créer dans un contexte d'injection (champ du composant) : le catalogue est injecté.
import { computed, signal } from '@angular/core';
import { CalendarDisplayPreferences } from './calendar-display-preferences';
import { CalendarData } from './calendar.models';
import {
  CalendarEffectParameter,
  EFFECT_PARAMETERS,
  designStyle,
  effectStyle,
  effectValues,
  injectCalendarPresentation,
} from './presentation/calendar-presentation';

/** Ce que la présentation lit du composant. */
export interface AppearanceHost {
  data(): CalendarData | null;
  preferences(): CalendarDisplayPreferences | null;
  /** La configuration permet-elle de changer l'apparence ? */
  allowed(): boolean;
  save(change: Partial<CalendarDisplayPreferences>): void;
}

export class CalendarAppearance {
  /** Designs et effets proposés : ceux du module, puis ceux que le site a fournis. */
  private readonly catalog = injectCalendarPresentation();
  readonly designs = this.catalog.designs;
  readonly effects = this.catalog.effects;
  /** Design en cours : celui choisi, sinon celui d'ouverture du calendrier, sinon le standard. */
  readonly design = computed(() =>
    this.designs.find((d) => d.id === this.host.preferences()?.design) ?? this.designs.find((d) => d.id === this.host.data()?.display.design) ?? this.designs[0]);
  /** Effet en cours, avec ses réglages (ceux de la personne, sinon ceux de l'effet). */
  readonly effect = computed(() =>
    this.effects.find((e) => e.id === this.host.preferences()?.effect) ?? this.effects.find((e) => e.id === this.host.data()?.display.effect) ?? this.effects[0]);
  readonly settings = computed(() => effectValues(this.effect(), this.host.preferences()?.effectParams));
  readonly parameters = computed(() =>
    (Object.keys(this.effect().defaults) as CalendarEffectParameter[]).map((key) => ({ key, ...EFFECT_PARAMETERS[key], value: this.settings()[key] })));
  /** Variables posées sur le calendrier : jetons du design, puis réglages de l'effet. */
  readonly style = computed(() => ({ ...designStyle(this.design()), ...effectStyle(this.effect(), this.settings()) }));
  readonly className = computed(() => [this.design().className, this.effect().className].filter(Boolean).join(' '));
  /** Classe de sortie (fondu) posée sur un élément retiré, le temps de sa disparition. */
  readonly fxLeave = computed(() => (this.effect().motion.leave !== 'none' && this.settings().leaveMs > 0 ? 'cal-fx-leaving' : ''));
  /** Fondu enchaîné : la période affichée s'efface avant que la suivante n'apparaisse. */
  readonly periodLeaving = signal(false);
  private periodTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly host: AppearanceHost) {}

  /** Durée du fondu entre deux périodes (0 : pas de fondu, y compris quand le mouvement réduit est demandé). */
  periodFadeMs() {
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    return this.effect().motion.period === 'crossfade' && !reduced ? this.settings().leaveMs : 0;
  }
  /** Applique `change` après le fondu de sortie de la période affichée (tout de suite s'il n'y en a pas). */
  fadePeriod(change: () => void) {
    const ms = this.periodFadeMs();
    this.dispose();
    if (!ms) { this.periodLeaving.set(false); change(); return; }
    this.periodLeaving.set(true);
    this.periodTimer = setTimeout(() => { this.periodTimer = null; change(); this.periodLeaving.set(false); }, ms);
  }
  dispose() {
    if (this.periodTimer) clearTimeout(this.periodTimer);
  }
  chooseDesign(id: string) {
    if (!this.host.allowed() || !this.designs.some((d) => d.id === id)) return;
    this.host.save({ design: id });
  }
  chooseEffect(id: string) {
    if (!this.host.allowed() || !this.effects.some((e) => e.id === id)) return;
    this.host.save({ effect: id, effectParams: {} });
  }
  setParam(key: CalendarEffectParameter, value: number) {
    if (!this.host.allowed() || !Number.isFinite(value)) return;
    this.host.save({ effectParams: { ...this.host.preferences()?.effectParams, [key]: value } });
  }
  resetParams() {
    if (this.host.allowed()) this.host.save({ effectParams: {} });
  }
}
