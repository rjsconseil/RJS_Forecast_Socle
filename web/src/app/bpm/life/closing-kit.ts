import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Code couleur d'alerte de la page « Clôture du cycle », le même partout :
 * vert (`ok`) : bon, validé ; puis, du moins au plus grave : bleu (`n1`, à savoir), jaune (`n2`, à surveiller),
 * orange (`n3`, à traiter), rouge (`n4`, urgent ou bloquant) ; `neutral` : sans objet.
 */
export type AlertTone = 'ok' | 'n1' | 'n2' | 'n3' | 'n4' | 'neutral';
export const ALERT_ORDER: AlertTone[] = ['neutral', 'ok', 'n1', 'n2', 'n3', 'n4'];
/** Le plus grave de plusieurs tons. */
export const worst = (...tones: AlertTone[]) => tones.reduce((w, t) => (ALERT_ORDER.indexOf(t) > ALERT_ORDER.indexOf(w) ? t : w), 'neutral' as AlertTone);

/** Encadré de chiffres clés : un libellé, une valeur mise en valeur, un « dont » coloré, des précisions, une jauge. */
export interface KeyBox {
  label: string;
  value: string;
  tone: AlertTone;
  part?: { value: string; label: string; tone: AlertTone } | null;
  lines?: string[];
  bar?: { pct: number; tone: AlertTone } | null;
}
/** Colonne d'un tableau sur deux lignes : libellé dessus, valeur dessous. */
export interface KeyColumn { label: string; value: string; tone: AlertTone; sub?: string | null }

const TONES = `
  :host {
    --al-ok: var(--status-success, #087657); --al-n1: #2463a4; --al-n2: #a67c00; --al-n3: #c25e0b; --al-n4: var(--status-danger, #b63248);
    --al-neutral: var(--bpm-muted, #66667a); --k-line: var(--bpm-line, #e0dfe8); --k-soft: var(--bpm-soft, #f7f7fa); --k-surface: var(--bpm-surface, #fff);
    display: block; min-width: 0;
  }
  [data-tone='ok'] { --tone: var(--al-ok); } [data-tone='n1'] { --tone: var(--al-n1); } [data-tone='n2'] { --tone: var(--al-n2); }
  [data-tone='n3'] { --tone: var(--al-n3); } [data-tone='n4'] { --tone: var(--al-n4); } [data-tone='neutral'] { --tone: var(--al-neutral); }
`;

/** Encadrés de chiffres clés, sur toute la largeur (un par colonne, ils passent à la ligne sur un écran étroit). */
@Component({
  selector: 'bpm-closing-boxes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="kb" [style.--kb-min]="min() + 'px'">
      @for (b of boxes(); track b.label) {
        <li class="kb-box" [attr.data-tone]="b.tone">
          <span class="kb-label">{{ b.label }}</span>
          <strong class="kb-value">{{ b.value }}</strong>
          @if (b.part; as p) { <span class="kb-part" [attr.data-tone]="p.tone">dont <b>{{ p.value }}</b> {{ p.label }}</span> }
          @if (b.bar; as g) { <span class="kb-bar" aria-hidden="true"><i [attr.data-tone]="g.tone" [style.width.%]="g.pct"></i></span> }
          @for (l of b.lines ?? []; track $index) { <small>{{ l }}</small> }
        </li>
      }
    </ul>
  `,
  styles: TONES + `
    .kb { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--kb-min, 180px), 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
    .kb-box {
      display: grid; align-content: start; gap: 2px; min-width: 0; padding: 10px 13px; border: 1px solid color-mix(in srgb, var(--tone) 28%, var(--k-line));
      border-radius: 10px; background: color-mix(in srgb, var(--tone) 6%, var(--k-surface)); box-shadow: inset 4px 0 0 var(--tone);
    }
    .kb-label { color: var(--al-neutral); font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    .kb-value { color: var(--tone); font-size: 24px; font-weight: 800; letter-spacing: -.02em; line-height: 1.15; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .kb-box[data-tone='neutral'] .kb-value { color: var(--ink, #222237); }
    .kb-part { font-size: 13px; color: var(--ink, #222237); }
    .kb-part b { color: var(--tone); font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .kb-bar { display: block; height: 6px; margin: 4px 0 2px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--k-line) 70%, var(--k-surface)); }
    .kb-bar i { display: block; height: 100%; border-radius: inherit; background: var(--tone); min-width: 2px; }
    small { color: var(--al-neutral); font-size: 12px; line-height: 1.4; }
  `,
})
export class BpmClosingBoxes {
  readonly boxes = input.required<KeyBox[]>();
  /** Largeur minimale d'un encadré. */
  readonly min = input(180);
}

/**
 * Tableau sur deux lignes : une colonne par élément, son libellé dessus, sa valeur dessous, colorée selon son niveau.
 * Toutes les colonnes tiennent sur une seule ligne, alignées et toujours visibles : un libellé ou un texte trop longs
 * finissent par « … » (texte complet au survol). Une valeur chiffrée (montant, « 9 / 19 ») n'est jamais coupée.
 * Chaque colonne prend d'abord la place de sa valeur, le reste est partagé.
 */
@Component({
  selector: 'bpm-closing-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dl class="kt-grid" [attr.aria-label]="caption()" [style.--kt-n]="columns().length">
      @for (c of columns(); track c.label) {
        <div class="kt-col" [attr.data-tone]="c.tone" [class.kt-figure]="figure(c.value)">
          <dt class="kt-head" [attr.title]="c.label">{{ c.label }}</dt>
          <dd class="kt-cell" [attr.title]="c.sub ? c.value + ' · ' + c.sub : c.value"><b>{{ c.value }}</b>@if (c.sub) { <small>{{ c.sub }}</small> }</dd>
        </div>
      }
    </dl>
  `,
  styles: TONES + `
    :host { container-type: inline-size; }
    .kt-grid {
      display: grid; grid-auto-flow: column; grid-auto-columns: auto; gap: 1px; margin: 0; padding: 1px;
      border: 1px solid var(--k-line); border-radius: 10px; overflow-x: auto; overflow-y: hidden;
    }
    .kt-col { display: grid; grid-template-rows: auto 1fr; min-width: 0; background: var(--k-surface); outline: 1px solid var(--k-line); }
    /* Une valeur chiffrée garde toute sa largeur. */
    .kt-col.kt-figure { min-width: max-content; }
    /* Tout tient sur une ligne, toutes les colonnes visibles : un texte trop long finit par « … ».
       La place va d'abord aux valeurs ; un libellé réclame au plus 6em (sans dépasser une part égale), une précision rien. */
    .kt-head, .kt-cell b, .kt-cell small { display: block; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .kt-head, .kt-cell small { contain: inline-size; }
    .kt-head { contain-intrinsic-inline-size: min(6em, calc(100cqi / var(--kt-n, 1) - 18px)); }
    .kt-head { padding: 7px 8px; background: var(--k-soft); color: var(--al-neutral); font-size: 11.5px; font-weight: 650; line-height: 1.3; border-bottom: 1px solid var(--k-line); }
    .kt-cell { display: grid; gap: 1px; min-width: 0; margin: 0; padding: 7px 8px; box-shadow: inset 0 3px 0 var(--tone); background: color-mix(in srgb, var(--tone) 6%, var(--k-surface)); }
    .kt-cell b { color: var(--tone); font-size: 14px; font-weight: 800; line-height: 1.35; font-variant-numeric: tabular-nums; }
    .kt-col[data-tone='neutral'] .kt-cell b { color: var(--al-neutral); font-weight: 650; }
    .kt-cell small { color: var(--al-neutral); font-size: 11.5px; line-height: 1.35; }
  `,
})
export class BpmClosingTable {
  readonly columns = input.required<KeyColumn[]>();
  readonly caption = input('');
  /** Montant, compte « 9 / 19 », pourcentage : fait seulement de chiffres, séparateurs et unité. */
  protected figure(value: string) {
    return /^[+\-−]?[\d\s.,/%€]+$/u.test(value);
  }
}
