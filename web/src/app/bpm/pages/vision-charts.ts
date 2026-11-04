import { Component, input, output } from '@angular/core';
import { CoverageStatus, GoalCoverage, GoalType, LifeGoal } from '../../core/bpm-models';
import { ShortDatePipe, cents, percentText } from '../../core/format';

export const COVERAGE_LABEL: Record<CoverageStatus, string> = { funded: 'Finançable', partial: 'Partiel', unfunded: 'Non financé', outOfHorizon: 'Hors horizon', unknown: 'Non calculable' };
export const COVERAGE_TONE: Record<CoverageStatus, string> = { funded: 'pos', partial: 'warn', unfunded: 'neg', outOfHorizon: '', unknown: 'estimate' };
/** Statut source (`data-status` de `.bv-goal`) correspondant au statut de couverture. */
export const COVERAGE_STATE: Record<CoverageStatus, string> = { funded: 'finance', partial: 'partiel', unfunded: 'non-finance', outOfHorizon: 'au-dela', unknown: 'inconnu' };
export const GOAL_SYMBOL: Record<GoalType, string> = { etudes: '🎓', retraite: '🌅', achat: '🏡', securite: '🛟', transmission: '🤝', autre: '✦' };

/** Un objectif de vie et sa couverture calculée (absente tant que la projection n'est pas disponible). */
export interface GoalRow {
  goal: LifeGoal;
  typeLabel: string;
  cov: GoalCoverage | null;
  status: CoverageStatus;
}

/**
 * Objectifs de vie et leur couverture, sur la liste source `.bv-goals` : montant couvert face à la
 * cible nominale, pourcentage et statut écrits (lisibles sans couleur). Un objectif hors horizon ou
 * non calculable n'a pas de jauge : son statut l'explique.
 */
@Component({
  selector: 'bpm-goal-coverage',
  imports: [ShortDatePipe],
  styleUrls: ['../ref-styles/bpm-vision.page.scss'],
  template: `
    <ul class="bv-goals" aria-label="Couverture des objectifs">
      @for (r of rows(); track r.goal.id) {
        <li class="bv-goal" tabindex="0" [attr.data-status]="state(r.status)" [attr.aria-label]="describe(r)">
          <span class="bv-goal-icon" aria-hidden="true">{{ symbol(r.goal.type) }}</span>
          <div class="bv-goal-body">
            <small>{{ r.typeLabel }} · {{ r.goal.date | shortDate }}</small>
            <strong>{{ r.goal.label }}</strong>
            <span>
              {{ c(r.goal.targetTodayCents) }} en euros d’aujourd’hui
              @if (r.cov?.nominalTargetCents !== null && r.cov?.nominalTargetCents !== undefined) {
                · À la date visée : {{ c(r.cov!.nominalTargetCents) }}
              }
            </span>
            @if (r.cov && r.cov.nominalTargetCents !== null && r.cov.coveredCents !== null) {
              <span class="bv-meter" aria-hidden="true"><span [style.width.%]="clamp(r.cov.coveragePct)"></span></span>
              <span>Couvert : {{ c(r.cov.coveredCents) }} / {{ c(r.cov.nominalTargetCents) }} · {{ p(r.cov.coveragePct) }}</span>
            }
          </div>
          <div class="bv-goal-result">
            <span class="bv-status">
              {{ label(r.status) }}
              @if (r.status === 'partial' && r.cov) { · {{ p(r.cov.coveragePct) }} couvert }
              @if (r.cov?.revised) { · réévalué }
            </span>
            @if (editable()) {
              <button type="button" class="btn btn-secondary" (click)="edit.emit(r.goal)" [attr.aria-label]="'Modifier l’objectif ' + r.goal.label">Modifier</button>
            }
          </div>
        </li>
      }
    </ul>
  `,
})
export class BpmGoalCoverage {
  readonly rows = input.required<GoalRow[]>();
  readonly editable = input(false);
  readonly edit = output<LifeGoal>();
  protected c = cents;
  protected p = percentText;
  protected label = (s: CoverageStatus) => COVERAGE_LABEL[s] ?? s;
  protected state = (s: CoverageStatus) => COVERAGE_STATE[s] ?? null;
  protected symbol = (t: GoalType) => GOAL_SYMBOL[t] ?? '✦';
  protected clamp = (v: number | null) => Math.max(0, Math.min(100, v ?? 0));
  protected describe(r: GoalRow) {
    const g = r.cov;
    const amounts = g && g.nominalTargetCents !== null && g.coveredCents !== null ? `couvert ${cents(g.coveredCents)} sur ${cents(g.nominalTargetCents)}, ${percentText(g.coveragePct)}` : 'couverture non calculée';
    return `${r.goal.label} (${r.goal.date}) : ${amounts}, statut ${this.label(r.status)}`;
  }
}
