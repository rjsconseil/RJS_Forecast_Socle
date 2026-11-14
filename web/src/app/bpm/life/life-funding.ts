import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LifeFunding, LifeFundingRow } from '../../core/bpm-projects.models';
import { cents, CentsPipe } from '../../core/format';
import { BpmBudgetStateComponent } from '../projects/project-parts';

/** Colonnes de période affichées d'emblée : les plus récentes du cycle. */
const RECENT = 6;

/** Garde la période consultée visible, même lorsqu’elle est ancienne. Aucun calcul budgétaire ici. */
export function fundingPeriodWindow(periods: LifeFunding['periods'], highlight: string | null, all = false) {
  if (all || periods.length <= RECENT) return periods;
  const index = periods.findIndex((p) => p.key === highlight);
  const recentStart = periods.length - RECENT;
  const start = index >= 0 && index < recentStart ? Math.min(recentStart, Math.max(0, index - 2)) : recentStart;
  return periods.slice(start, start + RECENT);
}

/** Marques d'une cellule projet × période : enveloppe attribuée, dépassements décidés dans la période. */
export interface FundingMarks {
  allocation: boolean;
  overruns: { label: string; amount: string; status: string }[];
}

export function fundingMarks(row: LifeFundingRow, key: string): FundingMarks {
  return {
    allocation: row.allocationPeriodKey === key,
    overruns: row.overruns
      .filter((o) => o.periodKey === key)
      .map((o) => ({ label: o.statusLabel, amount: cents(o.amountCents), status: o.status })),
  };
}

/**
 * Financement des projets de la vie par le budget de vie : enveloppe attribuée à chaque projet rattaché,
 * dépassements, et charges validées remontées au budget de vie, cycle budgétaire par cycle budgétaire.
 * Même lecture sur la fiche du projet de vie et sur « Gestion du projet de vie ».
 */
@Component({
  selector: 'bpm-life-funding',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, CentsPipe, BpmBudgetStateComponent],
  styleUrl: './life-funding.scss',
  template: `
    @let f = funding();
    @if (!f || !f.periods.length) {
      <p class="bpm-note">Cycle budgétaire à configurer : le financement se lit période par période.</p>
    } @else {
      <dl class="life-funding-totals" aria-label="Financement des projets de la vie">
        <div>
          <dt>Enveloppes attribuées</dt>
          <dd>{{ f.totals.allocatedCents | cents }}</dd>
          <span>Enveloppes actuelles · {{ funded() }} projet{{ funded() > 1 ? 's' : '' }} financé{{ funded() > 1 ? 's' : '' }} sur {{ f.rows.length }}</span>
        </div>
        <div>
          <dt>Cumul remonté au projet de vie</dt>
          <dd>{{ f.totals.paidCents | cents }}</dd>
          <span>Toutes périodes du cycle · depuis chaque attribution</span>
        </div>
        <div>
          <dt>Dépassements autorisés</dt>
          <dd>{{ overrunCents() | cents }}</dd>
          <span>{{ billedCents() | cents }} déjà facturés · {{ approvedCents() | cents }} à facturer en fin de cycle</span>
        </div>
      </dl>
      @if (hidden() > 0) {
        <p class="life-funding-scope">
          {{ shown().length }} périodes affichées · {{ shown()[0].label }} à {{ shown()[shown().length - 1].label }}.
          <button type="button" class="text-link" (click)="all.set(true)">Voir tout le cycle ({{ f.periods.length }})</button>
        </p>
      } @else if (all() && f.periods.length > recent) {
        <p class="life-funding-scope">
          Tout le cycle.
          <button type="button" class="text-link" (click)="all.set(false)">Revenir à {{ recent }} périodes autour de la consultation</button>
        </p>
      }
      <div class="bpm-table-wrap">
        <table class="bpm-table life-funding-table">
          <caption class="visually-hidden">Charges validées remontées au budget du projet de vie, par projet et par période du cycle</caption>
          <thead>
            <tr>
              <th scope="col">Projet de la vie</th>
              <th scope="col" class="num">Enveloppe</th>
              @for (p of shown(); track p.key) {
                <th scope="col" class="num" [class.is-read]="p.key === highlight()" [attr.data-status]="p.status">
                  {{ p.label }}
                </th>
              }
              <th scope="col" class="num">Total remonté</th>
              <th scope="col">État</th>
            </tr>
          </thead>
          <tbody>
            @for (r of f.rows; track r.budgetId) {
              <tr>
                <th scope="row">
                  <a class="text-link" [routerLink]="['/app/gestion-projet', r.coreProjectId]" [queryParams]="highlight() ? { lifePeriod: highlight() } : {}">{{ r.name }}</a>
                </th>
                <td class="num">
                  @if (r.regime) {
                    {{ r.allocationCents | cents }}
                    @if (r.initialAllocationCents !== null && r.initialAllocationCents !== r.allocationCents) {
                      <small>initiale {{ r.initialAllocationCents | cents }}</small>
                    }
                  } @else {
                    <span class="life-funding-none">Non attribuée</span>
                    <a class="text-link life-funding-assign" [routerLink]="['/app/gestion-projet', r.coreProjectId]" [queryParams]="highlight() ? { lifePeriod: highlight() } : {}" fragment="enveloppe">Attribuer</a>
                  }
                </td>
                @for (p of shown(); track p.key) {
                  @let m = marks(r, p.key);
                  <td class="num" [class.is-read]="p.key === highlight()" [class.is-empty]="!r.byPeriod[p.key]">
                    {{ r.byPeriod[p.key] ? (r.byPeriod[p.key] | cents) : '—' }}
                    @if (m.allocation) {
                      <small class="life-funding-mark" data-kind="allocation" title="Enveloppe attribuée dans cette période">◆ Enveloppe</small>
                    }
                    @for (o of m.overruns; track $index) {
                      <small class="life-funding-mark" data-kind="overrun" [attr.data-status]="o.status" [title]="'Dépassement · ' + o.label">+{{ o.amount }} dépass.</small>
                    }
                  </td>
                }
                <td class="num">
                  <strong>{{ r.paidCents | cents }}</strong>
                  @if (r.regime) {
                    <small [class.is-over]="(r.remainingCents ?? 0) < 0">reste {{ r.remainingCents | cents }}</small>
                  }
                </td>
                <td><bpm-budget-state [state]="r.state" /></td>
              </tr>
            } @empty {
              <tr>
                <td [attr.colspan]="shown().length + 4">Aucun projet de la vie rattaché. Créez ou choisissez un projet à financer dans « Projets et financement ».</td>
              </tr>
            }
          </tbody>
          @if (f.rows.length) {
            <tfoot>
              <tr>
                <th scope="row">Budget du projet de vie</th>
                <td class="num">{{ f.totals.allocatedCents | cents }}</td>
                @for (p of shown(); track p.key) {
                  <td class="num" [class.is-read]="p.key === highlight()">{{ f.totals.byPeriod[p.key] | cents }}</td>
                }
                <td class="num"><strong>{{ f.totals.paidCents | cents }}</strong></td>
                <td></td>
              </tr>
            </tfoot>
          }
        </table>
      </div>
      <p class="bpm-note">
        Chaque colonne suit la date réelle du règlement, même si sa date prévue est dans un autre cycle.
        Une enveloppe n’est pas une dépense : seuls les règlements datés à partir de son attribution remontent au Dépensé
        du projet de vie. Les totaux sont cumulés sur tout le cycle ; les dépassements accordés sont facturés en fin de cycle.
      </p>
    }
  `,
})
export class BpmLifeFundingComponent {
  readonly funding = input.required<LifeFunding | null>();
  /** Période lue (mise en évidence), par défaut la plus récente. */
  readonly highlight = input<string | null>(null);
  protected readonly recent = RECENT;
  protected all = signal(false);
  protected shown = computed(() => {
    const ps = this.funding()?.periods ?? [];
    return fundingPeriodWindow(ps, this.highlight(), this.all());
  });
  protected hidden = computed(() => (this.funding()?.periods.length ?? 0) - this.shown().length);
  protected funded = computed(() => this.funding()?.rows.filter((r) => r.regime).length ?? 0);
  protected overrunCents = computed(() => (this.funding()?.rows ?? []).reduce((s, r) => s + r.approvedOverrunCents + r.billedOverrunCents, 0));
  protected billedCents = computed(() => (this.funding()?.rows ?? []).reduce((s, r) => s + r.billedOverrunCents, 0));
  protected approvedCents = computed(() => (this.funding()?.rows ?? []).reduce((s, r) => s + r.approvedOverrunCents, 0));
  protected marks = fundingMarks;
}
