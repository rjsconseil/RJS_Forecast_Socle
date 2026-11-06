import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { BpmApi } from '../../core/bpm-api.service';
import { EntryInput, RegisterLine } from '../../core/bpm-models';
import { cents, CentsPipe, PercentPipe, ShortDatePipe } from '../../core/format';
import { MetricTile, MetricTilesComponent } from '../../shared/metric-tiles.component';
import { BpmLineDetail, BpmOperationEditor, BpmPageContext, BpmPageFrame, BpmShareChart, BpmState, bpmLoader, ShareItem } from '../ui';
import { BpmSetupNeeded, setupProblem, shade } from './dashboard-parts';

/**
 * Détail des entrées (/argent/entrees), sur la page dédiée source `bpm-money-detail` : total reçu,
 * encore attendu, ventilation par source, opérations reçues et échéances attendues. Une ligne ouvre
 * le détail partagé (pointage « Reçu » quand il est permis, modification par l'éditeur BPM).
 */
@Component({
  selector: 'bpm-page-incomes',
  providers: [BpmPageContext],
  imports: [RouterLink, BpmPageFrame, BpmState, BpmShareChart, BpmLineDetail, BpmOperationEditor, BpmSetupNeeded, MetricTilesComponent, CentsPipe, ShortDatePipe, PercentPipe],
  styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-money.scss', '../ref-styles/bpm-money-detail.page.scss', './bpm-money-page.scss'],
  template: `
    <bpm-page
      kicker="Tableau de bord"
      title="Détail des entrées"
      pageClass="bpm-money bpm-money-detail"
      [lead]="lead()"
      [context]="d()?.context"
      [periodKey]="period()"
      [periodNav]="true"
      (periodChange)="ctx.setQuery({ period: $event })"
    >
      <a actions class="app-hero-action" routerLink="/tableau-de-bord" [queryParams]="carry()">← Retour au tableau de bord</a>
      <button actions type="button" class="app-hero-action is-secondary" (click)="openCreate()" [disabled]="!budgets().length">＋ Ajouter une entrée</button>
      <a actions class="bpm-link" routerLink="/depenses" [queryParams]="registerQuery()">Entrées de la période →</a>

      <div class="bpm-money bpm-money-body bpm-money-detail" data-tone="budget">
        @if (problem(); as p) {
          <bpm-setup-needed [kind]="p" [message]="loader.error()?.message ?? ''" />
        } @else if (!d()) {
          <bpm-state [loading]="loader.loading()" [error]="loader.error()" [lines]="4" (retry)="loader.reload()" />
        } @else {
          @let v = d()!;
          <section data-bpm-frame="metrics" aria-label="Chiffres de la ligne">
            <rjs-metric-tiles variant="instrument" label="Chiffres de la ligne" [tiles]="tiles()" />
          </section>

          @if (notice()) {
            <p class="bmd-message" role="status">{{ notice() }}</p>
          }
          @if (loader.error(); as e) {
            <p class="bmd-message" data-state="danger" role="alert">{{ e.message }} Les chiffres affichés sont ceux de la dernière lecture réussie.</p>
          }
          <p class="bmd-note-banner">Reçu à date de règlement ; attendu à date prévue. Les lignes sont sélectionnées par leur date prévue dans la période ; un règlement peut tomber dans une autre période.</p>
          @if (!v.lines.length && v.receivedCents === 0) {
            <p class="bm-empty">
              Aucune entrée sur cette période : 0 € reçu est une valeur connue.
              <button type="button" class="bmd-precise-open" (click)="openCreate()">Ajouter une entrée</button>
            </p>
          }

          <section class="bm-statement" aria-labelledby="bmd-share-title" data-ui-pattern="panel" data-bpm-frame="chart">
            <h2 id="bmd-share-title">Sur 100 € reçus</h2>
            <bpm-share-chart
              title="Ventilation par source"
              [items]="shareItems()"
              [base]="v.receivedCents"
              baseLabel="Reçu sur la période"
              [formats]="['bar', 'donut', 'pie']"
              zeroText="Rien de reçu à date de règlement : aucune part n'est calculée."
              (pick)="openSource($event)"
            />
          </section>

          @if (v.sources.length) {
            <details class="bpm-disclosure bm-statement" aria-labelledby="bmd-sources-title" data-ui-pattern="panel">
              <summary><h2 id="bmd-sources-title">Les sources</h2></summary>
              <div class="bpm-disclosure-body">
                <ul class="bmd-rest-lines">
                  @for (s of v.sources; track s.ref) {
                    <li>
                      <a [routerLink]="['/argent/postes', s.ref]" [queryParams]="carry()">{{ s.label }}</a>
                      <span>
                        {{ s.receivedCents | cents }} reçus
                        @if (s.expectedCents) { · {{ s.expectedCents | cents }} attendus }
                        @if (s.sharePct !== null) { · {{ s.sharePct | pct }} du reçu }
                      </span>
                    </li>
                  }
                </ul>
              </div>
            </details>
          }

          <section class="bm-statement" aria-labelledby="bmd-entries-title" data-ui-pattern="panel">
            <h2 id="bmd-entries-title">Chaque montant de la période <span class="bmd-count">({{ received().length }})</span></h2>
            @if (!received().length) {
              <p class="bm-empty">Aucun montant réel sur cette période.</p>
            } @else {
              <ul class="bmd-entries">
                @for (l of received(); track l.id) {
                  <li class="bmd-entry" [class.is-editing]="lineParam() === l.id">
                    <div class="bmd-entry-main">
                      <time [attr.datetime]="l.realizedDate ?? l.plannedDate">{{ (l.realizedDate ?? l.plannedDate) | shortDate }}</time>
                      <span class="bmd-entry-title">
                        <strong>{{ l.label }}</strong>
                        <small>{{ l.costCenterLabel ?? 'Poste à préciser' }} · prévue le {{ l.plannedDate | shortDate }}@if (l.cadence !== 'once') { · {{ l.cadenceLabel }} } · prévu {{ l.plannedCents | cents }}</small>
                      </span>
                      <span class="bmd-entry-amount">{{ l.realizedCents === null ? '—' : (l.realizedCents | cents) }}</span>
                      <button type="button" class="bmd-precise-open" (click)="openLine(l.id)" [attr.aria-label]="l.label + ', ' + l.statusLabel + ' — voir le détail'">Voir le détail</button>
                    </div>
                    @if (l.note) {
                      <p class="bmd-entry-note"><span>Note ·</span> {{ l.note }}</p>
                    }
                  </li>
                }
              </ul>
            }
          </section>

          @if (pending().length) {
            <section class="bm-statement" aria-labelledby="bmd-pending-title" data-ui-pattern="panel">
              <h2 id="bmd-pending-title">Encore attendu d’ici la fin de la période <span class="bmd-count">({{ pending().length }})</span></h2>
              <p class="bpm-help">Échéances d'entrée non encore reçues. Ouvrez une ligne pour son détail et, si permis, la marquer reçue.</p>
              <ul class="bmd-rest-lines">
                @for (l of pending(); track l.id) {
                  <li [attr.data-due]="l.status === 'late' || l.status === 'due' || null" [class.is-selected]="lineParam() === l.id">
                    <span>
                      {{ l.plannedDate | shortDate }} · {{ l.label }}
                      <small> · {{ l.costCenterLabel ?? 'Poste à préciser' }}@if (l.cadence !== 'once') { · {{ l.cadenceLabel }} }</small>
                      @if (l.status === 'late' || l.status === 'due') {
                        <em class="bmd-late">{{ l.status === 'late' ? 'en retard' : 'aujourd’hui' }}</em>
                      }
                    </span>
                    <span class="bmd-pending-end">
                      {{ l.plannedCents | cents }}
                      <button type="button" class="bmd-precise-open" (click)="openLine(l.id)" [attr.aria-label]="l.label + ', ' + l.statusLabel + ' — voir le détail'">Voir le détail</button>
                    </span>
                  </li>
                }
              </ul>
            </section>
          }

          @if (unrealized().length) {
            <section class="bm-statement" aria-labelledby="bmd-unrealized-title" data-ui-pattern="panel">
              <h2 id="bmd-unrealized-title">Non réalisées (période close) <span class="bmd-count">({{ unrealized().length }})</span></h2>
              <ul class="bmd-rest-lines">
                @for (l of unrealized(); track l.id) {
                  <li [class.is-selected]="lineParam() === l.id">
                    <span>
                      {{ l.plannedDate | shortDate }} · {{ l.label }}
                      <small> · {{ l.costCenterLabel ?? 'Poste à préciser' }}</small>
                      <em class="bmd-late">{{ l.statusLabel }}</em>
                    </span>
                    <span class="bmd-pending-end">
                      {{ l.plannedCents | cents }}
                      <button type="button" class="bmd-precise-open" (click)="openLine(l.id)" [attr.aria-label]="l.label + ', ' + l.statusLabel + ' — voir le détail'">Voir le détail</button>
                    </span>
                  </li>
                }
              </ul>
            </section>
          }
        }
      </div>
    </bpm-page>

    @if (lineParam()) {
      <bpm-line-detail [lineId]="lineParam()" [period]="period()" (closed)="closeLine()" (edit)="startEdit($event)" />
    }
    @if (editorOpen() && budgets().length) {
      <bpm-operation-editor [budgets]="budgets()" [line]="editLine()" [defaults]="defaults" (closed)="closeEditor()" (saved)="onSaved($event)" />
    }
  `,
  styles: `
    :host { display: block; }
    .bm-empty .bmd-precise-open { margin-inline-start: var(--ecart-12); }
  `,
})
export class BpmIncomesPage {
  protected ctx = inject(BpmPageContext);
  private bpm = inject(BpmApi);
  private router = inject(Router);

  protected period = this.ctx.period;
  protected lineParam = this.ctx.q('ligne');
  protected carry = computed(() => this.ctx.carry() as Record<string, string>);
  protected registerQuery = computed(() => ({ ...this.carry(), direction: 'income' }));

  protected loader = bpmLoader(() => this.period(), (p) => this.bpm.incomes(p));
  protected d = computed(() => this.loader.data());
  protected problem = computed(() => setupProblem(this.loader.error()));
  protected budgets = computed(() => this.d()?.context.budgets ?? []);

  private lines = computed(() => [...(this.d()?.lines ?? [])].sort((a, b) => a.plannedDate.localeCompare(b.plannedDate)));
  protected received = computed(() => this.lines().filter((l) => l.settled));
  protected pending = computed(() => this.lines().filter((l) => !l.settled && l.status !== 'unrealized'));
  protected unrealized = computed(() => this.lines().filter((l) => l.status === 'unrealized'));

  /** Phrase du bandeau (source `lead-entrees`) : le reçu et le nombre de montants réels. */
  protected lead = computed(() => {
    const v = this.d();
    if (!v) return 'Lecture du relevé…';
    return `${cents(v.receivedCents)} reçus sur la période en ${this.received().length} montant(s).`;
  });

  /** Tuiles source : reçu mis en avant, encore attendu, nombre de montants. */
  protected tiles = computed<MetricTile[]>(() => {
    const v = this.d();
    if (!v) return [];
    return [
      { id: 'total', label: 'Reçu', value: cents(v.receivedCents), tone: 'success', emphasis: true, note: `Entrées réglées dans la période ; ${cents(v.receivedCents + v.expectedCents)} si toutes les échéances sont reçues.` },
      { id: 'planned', label: 'Encore attendu', value: cents(v.expectedCents), note: 'Échéances d’entrée non encore reçues.' },
      { id: 'count', label: 'Montants', value: String(this.received().length), note: `${v.lines.length} ligne(s) prévue(s) dans la période.` },
    ];
  });

  protected shareItems = computed<ShareItem[]>(() =>
    [...(this.d()?.sources ?? [])]
      .filter((s) => s.receivedCents > 0)
      .sort((a, b) => b.receivedCents - a.receivedCents)
      .map((s, i) => ({ key: s.ref, label: s.label, cents: s.receivedCents, color: shade('--s-income', i) })),
  );

  protected openSource(ref: string) {
    this.router.navigate(['/argent/postes', ref], { queryParams: this.carry() });
  }
  protected openLine(id: string) {
    this.ctx.setQuery({ ligne: id });
  }
  protected closeLine() {
    this.ctx.setQuery({ ligne: null });
  }

  // ---------- éditeur partagé (entrée par défaut) ----------

  protected readonly defaults: Partial<EntryInput> = { direction: 'income' };
  protected editorOpen = signal(false);
  protected editLine = signal<RegisterLine | null>(null);
  protected notice = signal<string | null>(null);

  protected openCreate() {
    this.editLine.set(null);
    this.editorOpen.set(true);
  }
  protected startEdit(line: RegisterLine) {
    this.closeLine();
    this.editLine.set(line);
    this.editorOpen.set(true);
  }
  protected closeEditor() {
    this.editorOpen.set(false);
    this.editLine.set(null);
  }
  protected onSaved(message: string) {
    this.closeEditor();
    this.notice.set(message);
  }
}
