import { Component, computed, input, output } from '@angular/core';
import { FigureEvaluation } from '../core/models';
import { figureValue } from '../core/format';

let nextId = 0;

/** Un chiffre est « signé » quand sa formule est une différence de premier niveau (résultat, écart…). */
export function isSignedFigure(f: FigureEvaluation): boolean {
  let depth = 0;
  const src = f.formula ?? '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '-' && depth === 0 && i > 0 && /\s/.test(src[i - 1] ?? '')) return true;
  }
  return false;
}

/** Valeur présentée ; un chiffre signé positif porte un « + » explicite. Inconnu n'est jamais 0. */
export function presentFigure(f: FigureEvaluation): string {
  const text = figureValue(f.value, f.unit, f.decimals);
  return f.value !== null && f.value > 0 && isSignedFigure(f) ? `+${text}` : text;
}

/**
 * Carte d'un chiffre du tableau de bord. Toute la carte ouvre l'explication du calcul
 * (bouton étiré : un seul arrêt de tabulation, activable au clavier).
 */
@Component({
  selector: 'app-figure-card',
  host: {
    class: 'figure-card',
    '[class.hero]': "variant() === 'hero'",
    '[class.is-unknown]': 'unknown()',
  },
  template: `
    @let f = figure();
    <div class="fc-top">
      <h3 class="fc-label" [id]="labelId">{{ f.label }}</h3>
      @if (!f.parameter.isDefault && f.parameter.origin === 'administration') {
        <span class="fc-admin" title="La formule de ce chiffre a été modifiée dans l'Administration">Formule adaptée</span>
      }
    </div>
    <p class="fc-value" [id]="valueId" [class.pos]="tone() === 'pos'" [class.neg]="tone() === 'neg'" [class.unknown]="unknown()">
      @if (unknown()) {
        <span class="fc-unknown-dot" aria-hidden="true"></span>
      }
      {{ display() }}
    </p>
    <p class="fc-context" [id]="contextId">
      @if (unknown()) {
        {{ f.unavailableReason || 'Donnée inconnue.' }}
      } @else {
        {{ f.description }}
      }
    </p>
    <button type="button" class="fc-explain" [attr.aria-describedby]="labelId + ' ' + valueId" (click)="explain.emit(f.key)">
      <svg class="fc-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
        <path d="M4 4h12M4 10h7M4 16h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" />
        <circle cx="15" cy="14" r="3" stroke="currentColor" stroke-width="1.6" fill="none" />
      </svg>
      <span>Comment est calculé ce chiffre ?</span>
    </button>
  `,
  styles: [
    `
      :host {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
        padding: 18px 20px 14px;
        background: var(--surface);
        color: var(--app-ink, var(--text));
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        border-radius: 14px;
        box-shadow: var(--shadow);
        font-variant-numeric: tabular-nums;
        transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease;
      }
      :host(:hover) { transform: translateY(-1px); border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); }
      :host(:focus-within) { border-color: var(--accent); }
      .fc-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
      .fc-label { margin: 0; font-size: 0.84rem; font-weight: 600; color: var(--muted); letter-spacing: .01em; }
      .fc-admin {
        font-size: 0.68rem; font-weight: 600; white-space: nowrap; padding: 1px 8px; border-radius: 999px;
        color: var(--s-hold); background: color-mix(in srgb, var(--s-hold) 12%, transparent);
      }
      .fc-value { margin: 2px 0 0; font-size: 1.65rem; line-height: 1.15; font-weight: 700; letter-spacing: -0.015em; overflow-wrap: anywhere; }
      .fc-value.pos { color: var(--pos); }
      .fc-value.neg { color: var(--neg); }
      .fc-value.unknown {
        align-self: flex-start; display: inline-flex; align-items: center; gap: 8px;
        font-size: 1.15rem; color: var(--unknown); background: var(--unknown-bg); padding: 3px 12px; border-radius: 999px;
      }
      .fc-unknown-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
      .fc-context { margin: 0; font-size: 0.84rem; line-height: 1.4; color: var(--muted); flex: 1; }
      :host(.is-unknown) .fc-context { color: var(--unknown); }
      .fc-explain {
        position: static;
        align-self: flex-start;
        display: inline-flex; align-items: flex-start; gap: 6px; text-align: left; line-height: 1.35;
        margin-top: 6px; padding: 4px 0;
        background: none; border: 0; font: inherit; font-size: 0.8rem; color: var(--muted); cursor: pointer;
      }
      .fc-explain::after { content: ''; position: absolute; inset: 0; border-radius: inherit; }
      .fc-explain:focus-visible { outline: none; }
      :host(:has(.fc-explain:focus-visible)) { outline: 3px solid var(--accent); outline-offset: 2px; }
      :host(:hover) .fc-explain, .fc-explain:focus-visible { color: var(--accent); }
      :host(:hover) .fc-explain span, .fc-explain:focus-visible span { text-decoration: underline; text-underline-offset: 3px; }
      .fc-icon { flex: none; }

      :host(.hero) {
        padding: 26px 28px 20px;
        background:
          radial-gradient(120% 140% at 100% 0%, rgba(255, 255, 255, .10), transparent 55%),
          var(--app-hero);
        color: var(--app-hero-text);
        border-color: transparent;
        border-radius: 18px;
        --hero-pos: #8fe6c2;
        --hero-neg: #ffb4ac;
      }
      :host(.hero:hover) { border-color: transparent; }
      :host(.hero) .fc-label { color: rgba(244, 247, 250, .78); font-size: 0.95rem; }
      :host(.hero) .fc-value { font-size: clamp(2.2rem, 7vw, 3.2rem); letter-spacing: -0.025em; }
      :host(.hero) .fc-value.pos { color: var(--hero-pos); }
      :host(.hero) .fc-value.neg { color: var(--hero-neg); }
      :host(.hero) .fc-value.unknown { font-size: 1.4rem; }
      :host(.hero) .fc-context { color: rgba(244, 247, 250, .78); font-size: 0.92rem; max-width: 60ch; }
      :host(.hero.is-unknown) .fc-context { color: #f3dc9b; }
      :host(.hero) .fc-explain { color: rgba(244, 247, 250, .85); }
      :host(.hero:hover) .fc-explain, :host(.hero) .fc-explain:focus-visible { color: #fff; }
      :host(.hero) .fc-admin { color: #e3d4ff; background: rgba(255, 255, 255, .12); }
      :host(.hero:has(.fc-explain:focus-visible)) { outline-color: var(--app-hero-text); }

      @media (prefers-reduced-motion: reduce) {
        :host { transition: none; }
        :host(:hover) { transform: none; }
      }
      @media (max-width: 480px) {
        :host { padding: 16px 16px 12px; }
        :host(.hero) { padding: 22px 18px 16px; }
      }
    `,
  ],
})
export class FigureCard {
  readonly figure = input.required<FigureEvaluation>();
  readonly variant = input<'hero' | 'default'>('default');
  readonly explain = output<string>();

  private readonly uid = `fc-${++nextId}`;
  protected readonly labelId = `${this.uid}-label`;
  protected readonly valueId = `${this.uid}-value`;
  protected readonly contextId = `${this.uid}-ctx`;

  protected unknown = computed(() => this.figure().value === null);
  protected display = computed(() => presentFigure(this.figure()));
  protected tone = computed<'pos' | 'neg' | null>(() => {
    const f = this.figure();
    if (f.value === null || f.value === 0) return null;
    if (f.value < 0) return 'neg';
    return isSignedFigure(f) ? 'pos' : null;
  });
}
