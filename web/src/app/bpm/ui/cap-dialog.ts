import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { toApiError } from '../../core/api.service';
import { cents, CentsPipe, percentText } from '../../core/format';
import { BpmApi } from '../data/bpm-api.service';
import { CenterCapRow } from '../data/bpm-caps.models';
import { capEuroText, capInput, CapLevel, capLevel, CapLevelThresholds } from './caps';
import { BpmModal } from './modal';

/** Poste proposé dans la fenêtre : son nom et ce qu'il engage sur le cycle lu. */
export type CapDialogCenter = Pick<CenterCapRow, 'ref' | 'label' | 'paidCents' | 'toPayCents' | 'engagedCents' | 'capCents'>;

/** Pas du curseur (centimes) selon l'étendue de l'échelle : 5 €, 10 €, 50 € ou 100 €. */
export function capSliderStep(maxCents: number): number {
  if (maxCents <= 50000) return 500;
  if (maxCents <= 200000) return 1000;
  if (maxCents <= 1000000) return 5000;
  return 10000;
}
const ceilTo = (v: number, step: number) => Math.ceil(v / step) * step;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
/** Échelle du curseur : une fois et demie le plus grand du plafond et de l'engagé (au moins 100 €), arrondie. */
function scaleOf(capCents: number | null, engagedCents: number): number {
  const raw = Math.max(capCents ?? 0, engagedCents, 10000) * 1.5;
  return ceilTo(raw, capSliderStep(raw) * 10);
}

/**
 * Fenêtre du plafond d'un poste de dépense, ouverte depuis le chiffre ou le bouton du poste. Une jauge-curseur montre le
 * consommé du cycle (repère du haut) et le plafond (repère du bas, porté par le curseur) : sous le plafond, l'espace restant
 * et la place pour agrandir sont à droite du consommé ; au plafond, les deux repères se superposent ; au-delà, le plafond est
 * à gauche du consommé et le dépassement entre les deux. Le curseur part toujours du plafond, pour l'agrandir ou le
 * diminuer ; à chaque mouvement le dépassement, ou ce qu'il reste à dépenser, est recalculé. Le montant reste modifiable
 * au clavier.
 * Un seul poste est écrit (les autres plafonds restent) ; vider le montant ou « Retirer le plafond » le supprime.
 * Un plafond ne bloque jamais une dépense.
 */
@Component({
  selector: 'bpm-cap-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BpmModal, CentsPipe],
  template: `
    <bpm-modal [open]="true" [headed]="true" [title]="title()" [busy]="busy()" (closed)="closed.emit()">
      <form class="cd-form" (submit)="$event.preventDefault(); save()" novalidate>
        @if (choose()) {
          <label class="cd-field">Poste de dépense
            <select [value]="ref()" (change)="pick($any($event.target).value)">
              @for (c of centers(); track c.ref) { <option [value]="c.ref" [selected]="c.ref === ref()">{{ c.label }}{{ c.capCents === null ? '' : ' · plafond ' + money(c.capCents) }}</option> }
            </select>
          </label>
        }
        @if (center(); as c) {
          <dl class="cd-figures" [attr.aria-label]="'Dépenses du poste · ' + periodLabel()">
            <div><dt>Payé</dt><dd>{{ c.paidCents | cents }}</dd></div>
            <div><dt>À payer</dt><dd>{{ c.toPayCents | cents }}</dd></div>
            <div><dt>Consommé · {{ periodLabel() }}</dt><dd>{{ c.engagedCents | cents }}</dd></div>
          </dl>

          <div class="cd-gauge" [attr.data-state]="gaugeState()" [attr.data-level]="level()">
            <div class="cd-marks cd-marks-used" aria-hidden="true">
              <span class="cd-mark" [style.left]="at(usedPos())" [attr.data-align]="align(usedPos())" [attr.data-p]="usedPos()">Consommé {{ c.engagedCents | cents }}</span>
              <span class="cd-pin" [style.left]="at(usedPos())"></span>
            </div>
            <input class="cd-range" type="range" name="capSlider" [min]="step()" [max]="capMax()" [step]="step()" [value]="capSlider()"
              [style.--cd-track]="capTrack()" (input)="slideCap(+$any($event.target).value)" (change)="release(+$any($event.target).value)"
              aria-label="Plafond du poste" [attr.aria-valuetext]="sliderText()" />
            <div class="cd-marks cd-marks-cap" aria-hidden="true">
              <span class="cd-pin" [style.left]="at(capPos())"></span>
              <span class="cd-mark" [style.left]="at(capPos())" [attr.data-align]="align(capPos())" [attr.data-p]="capPos()">{{ capCents() === null ? 'Glissez pour fixer le plafond' : 'Plafond ' + money(capCents()!) }}</span>
            </div>
          </div>
        }

        <label class="cd-field">Plafond par cycle (€)
          <input name="capAmount" inputmode="decimal" autocomplete="off" placeholder="Sans plafond" [value]="amount()" (input)="type($any($event.target).value)" />
        </label>

        @if (delta(); as d) {
          <div class="cd-result" role="status" aria-live="polite" [attr.data-level]="level()">
            <div><span>Plafond</span><strong>{{ capCents()! | cents }}</strong></div>
            <div class="cd-level"><span>Consommé</span><strong>{{ usedText() }}</strong></div>
            <div class="cd-level"><span>{{ d.over ? 'Dépassement' : 'Reste à dépenser' }}</span><strong>{{ d.cents | cents }}</strong></div>
          </div>
        } @else {
          <p class="cd-impact" role="status" [attr.data-tone]="capCents() === null && amountValid() ? 'muted' : 'neutral'">
            {{ amountValid() ? 'Sans plafond : aucune alerte sur ce poste.' : 'Saisissez un montant positif, par exemple 250 ou 120,50.' }}
          </p>
        }
        <p class="cd-help">Le plafond vaut pour chaque cycle. Il vous alerte quand les dépenses du poste le dépassent, sans jamais bloquer une dépense.</p>
        @if (error()) { <p class="cd-error" role="alert">{{ error() }}</p> }
        <div class="cd-actions">
          @if (center()?.capCents !== null && center()?.capCents !== undefined) {
            <button type="button" class="btn btn-secondary cd-remove" [disabled]="busy()" (click)="save(null)">Retirer le plafond</button>
          }
          <span class="cd-spacer"></span>
          <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="closed.emit()">Annuler</button>
          <button type="submit" class="btn btn-primary" [disabled]="busy() || !ref()">{{ busy() ? 'Enregistrement…' : 'Enregistrer le plafond' }}</button>
        </div>
      </form>
    </bpm-modal>
  `,
  styles: `
    :host {
      --cd-ink: var(--ink, #1f2230);
      --cd-muted: var(--bpm-muted, var(--muted, #66667a));
      --cd-soft: var(--bpm-soft, #f6f6f9);
      --cd-line: var(--bpm-line, var(--line, #e3e5ec));
      --cd-accent: var(--astra-iris, var(--app-accent, #0d7a5f));
      --cd-red: var(--status-danger, #dc2626);
    }
    .cd-form { display: grid; gap: 14px; padding: 18px 24px 22px; min-width: min(500px, 100%); }
    .cd-field { display: grid; gap: 6px; font-size: 13px; font-weight: 600; }
    .cd-field :is(input, select) { width: 100%; min-height: 40px; font: inherit; font-weight: 500; }
    .cd-field input { font-size: 16px; font-variant-numeric: tabular-nums; }
    .cd-figures { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 0; }
    .cd-figures div { padding: 10px 12px; border-radius: 8px; background: var(--cd-soft); }
    .cd-figures dt { color: var(--cd-muted); font-size: 11px; }
    .cd-figures dd { margin: 3px 0 0; font-weight: 650; font-variant-numeric: tabular-nums; }

    /* Jauge-curseur : le consommé (repère du haut) et le plafond (repère du bas, porté par le curseur). Les repères
       suivent exactement le centre du curseur : 11 px (demi-curseur) + la course de la piste. */
    .cd-gauge { display: grid; gap: 2px; padding: 10px 14px 8px; border: 1px solid var(--cd-line); border-radius: 10px; }
    .cd-marks { position: relative; height: 24px; }
    .cd-mark { position: absolute; transform: translateX(-50%); white-space: nowrap; font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; }
    .cd-mark[data-align='start'] { transform: translateX(-6px); }
    .cd-mark[data-align='end'] { transform: translateX(calc(-100% + 6px)); }
    .cd-pin { position: absolute; width: 2px; height: 7px; border-radius: 1px; transform: translateX(-1px); }
    /* Niveau consommé (part du plafond) : vert, bleu, jaune, orange, rouge — jetons --cap-* de styles/_bpm-semantics.scss. */
    [data-level] { --cd-level: var(--cd-muted); --cd-level-ink: var(--cd-muted); --cd-level-soft: var(--cd-soft); }
    [data-level='low'] { --cd-level: var(--cap-low, #087657); --cd-level-ink: var(--cap-low-ink, #087657); --cd-level-soft: var(--cap-low-surface, #eaf7f1); }
    [data-level='mid'] { --cd-level: var(--cap-mid, #2463a4); --cd-level-ink: var(--cap-mid-ink, #2463a4); --cd-level-soft: var(--cap-mid-surface, #edf4fc); }
    [data-level='high'] { --cd-level: var(--cap-high, #d9a600); --cd-level-ink: var(--cap-high-ink, #846600); --cd-level-soft: var(--cap-high-surface, #fff8db); }
    [data-level='near'] { --cd-level: var(--cap-near, #ea6a12); --cd-level-ink: var(--cap-near-ink, #b14a08); --cd-level-soft: var(--cap-near-surface, #fff1e6); }
    [data-level='over'] { --cd-level: var(--cap-over, #b63248); --cd-level-ink: var(--cap-over-ink, #b63248); --cd-level-soft: var(--cap-over-surface, #fff0f2); }
    .cd-marks-used .cd-mark { top: 0; color: var(--cd-level-ink); }
    .cd-marks-used .cd-pin { bottom: 0; background: var(--cd-level); }
    .cd-marks-cap .cd-mark { bottom: 0; color: var(--cd-ink); }
    .cd-marks-cap .cd-pin { top: 0; background: var(--cd-ink); }
    .cd-gauge[data-state='over'] .cd-marks-cap .cd-mark { color: var(--cd-red); }
    .cd-gauge[data-state='none'] .cd-marks-cap .cd-mark { color: var(--cd-muted); font-weight: 600; }
    /* Sélecteurs renforcés : la piste du site (styles/_interactions.scss) ne doit pas recouvrir celle du plafond. */
    :host input.cd-range[type='range'] { display: block; width: 100%; height: 26px; min-height: 0; margin: 0; padding: 0; border: 0; background: transparent; box-shadow: none; cursor: pointer; -webkit-appearance: none; appearance: none; }
    :host input.cd-range[type='range']::-webkit-slider-runnable-track { height: 10px; border-radius: 999px; background: var(--cd-track, var(--cd-line)); box-shadow: inset 0 1px 2px rgba(16, 24, 40, .12); }
    :host input.cd-range[type='range']::-moz-range-track { height: 10px; border-radius: 999px; background: var(--cd-track, var(--cd-line)); }
    :host input.cd-range[type='range']::-moz-range-progress { background: transparent; }
    :host input.cd-range[type='range']::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 22px; height: 22px; margin-top: -6px; border: 2px solid var(--cd-accent); border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(16, 24, 40, .28); }
    :host input.cd-range[type='range']::-moz-range-thumb { width: 18px; height: 18px; border: 2px solid var(--cd-accent); border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(16, 24, 40, .28); }
    :host input.cd-range[type='range']:focus-visible { outline: none; }
    :host input.cd-range[type='range']:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 4px color-mix(in srgb, var(--cd-accent) 30%, transparent); }
    :host input.cd-range[type='range']:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 4px color-mix(in srgb, var(--cd-accent) 30%, transparent); }

    .cd-result { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .cd-result div { display: grid; gap: 2px; padding: 10px 12px; border-radius: 8px; background: var(--cd-soft); }
    .cd-result span { color: var(--cd-muted); font-size: 11.5px; font-weight: 600; }
    .cd-result strong { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .cd-result .cd-level { background: var(--cd-level-soft); }
    .cd-result .cd-level :is(span, strong) { color: var(--cd-level-ink); }
    .cd-impact { margin: 0; padding: 10px 12px; border-radius: 8px; font-size: 13px; font-weight: 600; line-height: 1.5; color: var(--status-info, #2463a4); background: var(--status-info-surface, #eff6ff); }
    .cd-impact[data-tone='muted'] { color: var(--cd-muted); background: var(--cd-soft); }
    .cd-help { margin: 0; color: var(--cd-muted); font-size: 12.5px; line-height: 1.5; }
    .cd-error { margin: 0; color: var(--cd-red); font-size: 13px; font-weight: 600; }
    .cd-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-top: 4px; }
    .cd-spacer { flex: 1 1 auto; }
    .cd-remove { color: var(--cd-red); }
    @media (max-width: 520px) { .cd-figures, .cd-result { grid-template-columns: minmax(0, 1fr); } .cd-form { min-width: 0; } }
  `,
})
export class BpmCapDialog {
  private readonly bpm = inject(BpmApi);
  /** Postes proposés (au moins celui à régler). */
  readonly centers = input.required<CapDialogCenter[]>();
  /** Poste ouvert ; sans lui, le premier poste proposé. */
  readonly initialRef = input<string | null>(null);
  /** Choix du poste dans la fenêtre (ouverte depuis la barre d'outils plutôt que depuis un poste). */
  readonly choose = input(false);
  /** Révision du budget du projet de vie qui porte les plafonds. */
  readonly revision = input.required<number>();
  /** Seuils des niveaux de consommation (Budget, seule source) : la couleur suit le plafond en cours de réglage. */
  readonly levels = input.required<CapLevelThresholds>();
  readonly periodLabel = input('ce cycle');
  readonly closed = output<void>();
  readonly saved = output<string>();

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly ref = linkedSignal(() => this.initialRef() ?? this.centers()[0]?.ref ?? '');
  protected readonly center = computed(() => this.centers().find((c) => c.ref === this.ref()) ?? null);
  /** Montant saisi (euros) : la seule valeur enregistrée. Le curseur l'écrit, le clavier aussi. */
  protected readonly amount = linkedSignal(() => capEuroText(this.center()?.capCents ?? null));
  protected readonly money = cents;

  private readonly engaged = computed(() => this.center()?.engagedCents ?? 0);
  protected readonly amountValid = computed(() => capInput(this.amount()) !== undefined);
  protected readonly capCents = computed(() => {
    const v = capInput(this.amount());
    return typeof v === 'number' ? Math.round(v * 100) : null;
  });
  /** Écart avec l'engagé du cycle : dépassement (engagé − plafond > 0) ou reste à dépenser. */
  protected readonly delta = computed(() => {
    const cap = this.capCents();
    if (cap === null) return null;
    const gap = this.engaged() - cap;
    return { over: gap > 0, cents: Math.abs(gap) };
  });

  // ---------- jauge-curseur ----------

  /** Échelle : fixée à l'ouverture avec de la place à droite pour agrandir ; élargie au bout de la course ou à la saisie. */
  protected readonly capMax = linkedSignal(() => scaleOf(this.center()?.capCents ?? null, this.engaged()));
  protected readonly step = computed(() => capSliderStep(this.capMax()));
  /** Sans plafond saisi, le curseur se place sur le consommé arrondi : un point de départ, rien n'est écrit. */
  private readonly capForSlider = computed(() => {
    const cap = this.capCents();
    if (cap !== null) return cap;
    return this.engaged() ? ceilTo(this.engaged(), this.step()) : ceilTo(this.capMax() / 3, this.step());
  });
  protected readonly capSlider = computed(() => clamp(this.capForSlider(), this.step(), this.capMax()));

  /** Place d'un montant sur la course du curseur (0 à 1), du plus petit plafond (un pas) au bout de l'échelle. */
  private place(valueCents: number) {
    const min = this.step();
    const max = this.capMax();
    return max > min ? Math.round(clamp((valueCents - min) / (max - min), 0, 1) * 1000) / 1000 : 0;
  }
  protected readonly usedPos = computed(() => this.place(this.engaged()));
  protected readonly capPos = computed(() => this.place(this.capSlider()));
  /** Abscisse exacte du centre du curseur : un demi-curseur (11 px) plus la part de la course. */
  protected at(p: number) {
    return `calc(11px + (100% - 22px) * ${p})`;
  }
  /** Un repère près d'un bord garde son texte dans la jauge. */
  protected align(p: number) {
    return p < 0.12 ? 'start' : p > 0.88 ? 'end' : 'center';
  }
  /** Niveau consommé avec le plafond saisi : il colore la jauge, le repère « Consommé » et le résultat. */
  protected readonly level = computed<CapLevel>(() => {
    const cap = this.capCents();
    return cap === null ? 'none' : capLevel({ capCents: cap, engagedCents: this.engaged() }, this.levels());
  });
  protected readonly usedText = computed(() => {
    const cap = this.capCents();
    return cap ? percentText((this.engaged() / cap) * 100, 0) : '—';
  });
  /** Sans plafond, sous le plafond (reste), au plafond (repères superposés), au-delà (dépassement). */
  protected readonly gaugeState = computed(() => {
    const d = this.delta();
    return !d ? 'none' : d.over ? 'over' : d.cents === 0 ? 'full' : 'under';
  });
  /**
   * Piste : le consommé dans la couleur de son niveau, puis le reste jusqu'au plafond dans la même couleur, pâle.
   * Au-delà du plafond (rouge) : le consommé jusqu'au plafond en rouge pâle, le dépassement en rouge plein.
   */
  protected readonly capTrack = computed(() => {
    const used = this.engaged() > this.step() ? this.at(this.usedPos()) : '0px';
    if (this.capCents() === null) return `linear-gradient(90deg, var(--cd-level) 0 ${used}, var(--cd-line) ${used} 100%)`;
    const cap = this.at(this.capPos());
    return this.delta()?.over
      ? `linear-gradient(90deg, color-mix(in srgb, var(--cd-level) 55%, transparent) 0 ${cap}, var(--cd-level) ${cap} ${used}, var(--cd-line) ${used} 100%)`
      : `linear-gradient(90deg, var(--cd-level) 0 ${used}, color-mix(in srgb, var(--cd-level) 28%, transparent) ${used} ${cap}, var(--cd-line) ${cap} 100%)`;
  });
  protected readonly sliderText = computed(() => {
    const cap = this.capCents();
    const d = this.delta();
    if (cap === null || !d) return 'Sans plafond';
    return `Plafond ${cents(cap)}, consommé ${cents(this.engaged())}, ${d.over ? 'dépassement ' : 'reste '}${cents(d.cents)}`;
  });

  /** Le curseur du plafond écrit le montant ; le dépassement se recalcule aussitôt. */
  protected slideCap(capCents: number) {
    this.error.set(null);
    this.amount.set(capEuroText(capCents));
  }
  /** Curseur lâché au bout de l'échelle : elle s'allonge pour laisser de la place à l'agrandissement. */
  protected release(capCents: number) {
    if (capCents >= this.capMax()) this.capMax.set(scaleOf(capCents, this.engaged()));
  }
  /** Saisie au clavier : l'échelle s'élargit si le montant dépasse le curseur. */
  protected type(raw: string) {
    this.error.set(null);
    this.amount.set(raw);
    const cap = this.capCents();
    if (cap !== null && cap > this.capMax()) this.capMax.set(scaleOf(cap, this.engaged()));
  }

  protected readonly title = computed(() => {
    const c = this.center();
    if (this.choose() && !c) return 'Fixer un plafond';
    return c?.capCents === null || c?.capCents === undefined ? `Fixer un plafond · ${c?.label ?? ''}` : `Plafond du poste · ${c.label}`;
  });

  protected pick(ref: string) {
    this.ref.set(ref);
    this.error.set(null);
  }

  /** Enregistre le plafond saisi (ou `null` pour le retirer) sur le seul poste choisi. */
  async save(value: string | null = this.amount()) {
    const c = this.center();
    if (!c || this.busy()) return;
    const cap = value === null ? null : capInput(value);
    if (cap === undefined) return this.error.set('Montant positif attendu, ou vide pour aucun plafond.');
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.bpm.setCaps({ expectedRevision: this.revision(), caps: { [c.ref]: cap }, merge: true });
      this.saved.emit(cap === null ? `Plafond du poste « ${c.label} » retiré.` : `Plafond du poste « ${c.label} » : ${cents(Math.round(cap * 100))} par cycle.`);
    } catch (e) {
      const err = toApiError(e);
      this.error.set(err.isConflict ? 'Les plafonds ont changé entre-temps : fermez la fenêtre et rouvrez-la.' : err.message);
    } finally {
      this.busy.set(false);
    }
  }
}
