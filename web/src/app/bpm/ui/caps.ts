import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CapAlert, CapBrief, CapLevel, CapLevelThresholds, CapMeasure, RegisterCaps } from '../data/bpm-caps.models';
import { cents } from '../../core/format';

export type { CapLevel, CapLevelThresholds };

/**
 * Niveau de consommation d'un plafond (consommé = payé + à payer, rapporté au plafond), qui donne la couleur de ses
 * jauges partout : vert, bleu, jaune, orange (100 % compris), rouge au-delà de 100 %. Les seuils viennent du middleware
 * Budget (`levels` des lectures, seule source) : le site n'en écrit aucun. Une mesure lue porte déjà son niveau ;
 * ce calcul sert au plafond en cours de réglage. Couleurs : jetons `--cap-<niveau>` (`styles/_bpm-semantics.scss`).
 */
export function capLevel(m: Pick<CapMeasure, 'capCents' | 'engagedCents'>, levels: CapLevelThresholds): CapLevel {
  if (m.capCents === null || m.capCents <= 0) return 'none';
  if (m.engagedCents > m.capCents) return 'over';
  const used = (m.engagedCents / m.capCents) * 100;
  return used >= levels.near ? 'near' : used >= levels.high ? 'high' : used >= levels.mid ? 'mid' : 'low';
}

/** Légende des cinq niveaux, dans l'ordre, avec les seuils lus. */
export function capLevelLegend(levels: CapLevelThresholds): { level: Exclude<CapLevel, 'none'>; label: string }[] {
  return [
    { level: 'low', label: `Moins de ${levels.mid} %` },
    { level: 'mid', label: `${levels.mid} à ${levels.high} %` },
    { level: 'high', label: `${levels.high} à ${levels.near} %` },
    { level: 'near', label: `${levels.near} à 100 %` },
    { level: 'over', label: 'Au-delà de 100 %' },
  ];
}

/** Une alerte en une phrase : la dépense n'est jamais bloquée. */
export function capAlertText(a: CapAlert): string {
  return `poste « ${a.label} » : ${cents(a.engagedCents)} engagés pour un plafond de ${cents(a.capCents)} (+${cents(a.overCents)})`;
}

/** Message après enregistrement : l'action réussie, suivie des plafonds dépassés s'il y en a. */
export function withCapAlerts(message: string, alerts: CapAlert[] | undefined | null): string {
  if (!alerts?.length) return message;
  return `${message} Attention, plafond dépassé — ${alerts.map(capAlertText).join(' ; ')}. La dépense est bien enregistrée.`;
}

/** Montant saisi en euros (« 120,50 ») vers euros numériques ; vide = sans plafond ; invalide = undefined. */
export function capInput(raw: string): number | null | undefined {
  const t = raw.replace(/\s/g, '').replace('€', '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined;
}

/** Plafond dépassé, prêt à afficher (bandeaux du tableau de bord et des dépenses). */
export interface OverCap {
  key: string;
  level: 'Poste';
  label: string;
  overCents: number;
}

/** Postes dépassés de la période lue avec le registre. */
export function overCapsOf(caps: RegisterCaps | null | undefined, centerLabel: (ref: string) => string | undefined): OverCap[] {
  if (!caps) return [];
  const over = (m: CapBrief) => -(m.marginCents ?? 0);
  return Object.entries(caps.centers)
    .filter(([, m]) => m.over)
    .map(([ref, m]) => ({ key: ref, level: 'Poste' as const, label: centerLabel(ref) ?? ref.replace(/^std:/, ''), overCents: over(m) }));
}

/** Plafond en centimes vers la saisie en euros (« 120,5 ») ; vide = sans plafond. */
export function capEuroText(capCents: number | null | undefined): string {
  return capCents === null || capCents === undefined ? '' : String(capCents / 100).replace('.', ',');
}

/** Lecture d'un plafond en une ligne : marge restante, ou dépassement (jamais bloquant). */
export function capGaugeText(m: CapBrief): string {
  if (m.capCents === null) return 'Sans plafond';
  const margin = m.marginCents ?? m.capCents - m.engagedCents;
  return m.over ? `Dépassé de ${cents(-margin)} · plafond ${cents(m.capCents)}` : `Reste ${cents(margin)} sur ${cents(m.capCents)}`;
}

/**
 * Jauge compacte du plafond d'un poste : barre de consommation et marge ou dépassement, colorée selon le niveau de
 * consommation (vert, bleu, jaune, orange, rouge). Même lecture sur les dépenses, les postes et les plafonds.
 */
@Component({
  selector: 'bpm-cap-gauge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="cap-gauge" [attr.data-tone]="tone()" [attr.data-level]="tone()" [attr.title]="label() ? label() + ' : ' + text() : null">
      @if (label(); as l) {
        <span class="cap-gauge-label">{{ l }}</span>
      }
      @if (measure().capCents !== null) {
        <span class="cap-gauge-bar" aria-hidden="true"><span [style.width.%]="bar()"></span></span>
      }
      <span class="cap-gauge-text">{{ text() }}</span>
    </span>
  `,
  styles: `
    :host { display: inline-flex; min-width: 0; }
    .cap-gauge {
      --cg-ink: var(--muted);
      --cg-surface: var(--soft, transparent);
      --cg-fill: var(--line);
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      padding: 2px 10px;
      border: 1px solid color-mix(in srgb, var(--cg-ink) 30%, transparent);
      border-radius: var(--radius-pill, 999px);
      background: var(--cg-surface);
      color: var(--cg-ink);
      font-size: 0.8rem;
      font-weight: 600;
      line-height: 1.5;
    }
    .cap-gauge[data-tone='low'] { --cg-ink: var(--cap-low-ink, #087657); --cg-surface: var(--cap-low-surface, #eaf7f1); --cg-fill: var(--cap-low, #087657); }
    .cap-gauge[data-tone='mid'] { --cg-ink: var(--cap-mid-ink, #2463a4); --cg-surface: var(--cap-mid-surface, #edf4fc); --cg-fill: var(--cap-mid, #2463a4); }
    .cap-gauge[data-tone='high'] { --cg-ink: var(--cap-high-ink, #846600); --cg-surface: var(--cap-high-surface, #fff8db); --cg-fill: var(--cap-high, #d9a600); }
    .cap-gauge[data-tone='near'] { --cg-ink: var(--cap-near-ink, #b14a08); --cg-surface: var(--cap-near-surface, #fff1e6); --cg-fill: var(--cap-near, #ea6a12); }
    .cap-gauge[data-tone='over'] { --cg-ink: var(--cap-over-ink, #b63248); --cg-surface: var(--cap-over-surface, #fff0f2); --cg-fill: var(--cap-over, #b63248); }
    .cap-gauge-label { font-weight: 500; color: var(--ink); }
    .cap-gauge-bar { position: relative; width: 56px; height: 6px; border-radius: 3px; background: color-mix(in srgb, var(--cg-fill) 18%, transparent); overflow: hidden; }
    .cap-gauge-bar > span { position: absolute; inset: 0 auto 0 0; border-radius: 3px; background: var(--cg-fill); }
  `,
})
export class BpmCapGauge {
  readonly measure = input.required<CapBrief>();
  /** Libellé lu (ex. « Plafond du poste ») ; facultatif. */
  readonly label = input<string | null>(null);
  protected tone = computed(() => this.measure().level);
  protected bar = computed(() => Math.min(100, Math.max(0, this.measure().usedPct ?? 0)));
  protected text = computed(() => capGaugeText(this.measure()));
}
