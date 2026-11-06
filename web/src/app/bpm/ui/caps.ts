import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CapAlert, CapBrief, CapMeasure, RegisterCaps } from '../../core/bpm-caps.models';
import { cents } from '../../core/format';

export type CapTone = 'none' | 'ok' | 'near' | 'over';

/** Seuil d'approche du plafond (part engagée), repli quand l'API ne fournit pas `near` (même règle que le middleware Budget). */
export const NEAR_CAP_PCT = 85;

/** État d'un niveau (centre ou catégorie) : sans plafond, dans le plafond, proche, ou dépassé (rouge). La règle « proche » vient du middleware. */
export function capTone(m: Pick<CapMeasure, 'capCents' | 'engagedCents' | 'over'> & { near?: boolean }): CapTone {
  if (m.capCents === null) return 'none';
  if (m.over) return 'over';
  if (m.near !== undefined) return m.near ? 'near' : 'ok';
  return m.capCents > 0 && (m.engagedCents / m.capCents) * 100 >= NEAR_CAP_PCT ? 'near' : 'ok';
}

export const CAP_TONE_LABEL: Record<CapTone, string> = {
  none: 'Sans plafond',
  ok: 'Dans le plafond',
  near: 'Proche du plafond',
  over: 'Plafond dépassé',
};

/** Une alerte en une phrase, en précisant le niveau : la dépense n'est jamais bloquée. */
export function capAlertText(a: CapAlert): string {
  const level = a.level === 'center' ? 'centre' : 'catégorie';
  return `${level} « ${a.label} » : ${cents(a.engagedCents)} engagés pour un plafond de ${cents(a.capCents)} (+${cents(a.overCents)})`;
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
  level: 'Poste' | 'Catégorie';
  label: string;
  overCents: number;
}

/** Plafonds dépassés de la période lue avec le registre : postes puis catégories, lus indépendamment. */
export function overCapsOf(caps: RegisterCaps | null | undefined, centerLabel: (ref: string) => string | undefined): OverCap[] {
  if (!caps) return [];
  const over = (m: CapBrief) => -(m.marginCents ?? 0);
  return [
    ...Object.entries(caps.centers)
      .filter(([, m]) => m.over)
      .map(([ref, m]) => ({ key: ref, level: 'Poste' as const, label: centerLabel(ref) ?? ref.replace(/^std:/, ''), overCents: over(m) })),
    ...Object.entries(caps.categories)
      .filter(([, m]) => m.over)
      .map(([id, m]) => ({ key: id, level: 'Catégorie' as const, label: m.label, overCents: over(m) })),
  ];
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
 * Jauge compacte d'un plafond (centre ou catégorie) : barre de consommation et marge ou dépassement,
 * en vert, orange à l'approche, rouge au-delà. Même lecture sur les dépenses, les postes et les plafonds.
 */
@Component({
  selector: 'bpm-cap-gauge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="cap-gauge" [attr.data-tone]="tone()" [attr.title]="label() ? label() + ' : ' + text() : null">
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
      --cg-surface: color-mix(in srgb, var(--line) 25%, var(--raised-surface));
      --cg-fill: var(--muted);
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
    .cap-gauge[data-tone='ok'] { --cg-ink: var(--status-success); --cg-surface: var(--status-success-surface); --cg-fill: var(--status-success); }
    .cap-gauge[data-tone='near'] { --cg-ink: var(--status-warning); --cg-surface: var(--status-warning-surface); --cg-fill: var(--status-warning); }
    .cap-gauge[data-tone='over'] { --cg-ink: var(--status-danger); --cg-surface: var(--status-danger-surface); --cg-fill: var(--status-danger); }
    .cap-gauge-label { font-weight: 500; color: var(--ink); }
    .cap-gauge-bar { position: relative; width: 56px; height: 6px; border-radius: 3px; background: color-mix(in srgb, var(--cg-fill) 18%, transparent); overflow: hidden; }
    .cap-gauge-bar > span { position: absolute; inset: 0 auto 0 0; border-radius: 3px; background: var(--cg-fill); }
  `,
})
export class BpmCapGauge {
  readonly measure = input.required<CapBrief>();
  /** Niveau lu (ex. « Plafond du poste », « Catégorie ») ; facultatif. */
  readonly label = input<string | null>(null);
  protected tone = computed(() => capTone(this.measure()));
  protected bar = computed(() => Math.min(100, Math.max(0, this.measure().usedPct ?? 0)));
  protected text = computed(() => capGaugeText(this.measure()));
}
