import { Component, computed, input } from '@angular/core';
import { BpmProjectsOverview } from '../../core/bpm-projects.models';
import { COLUMNS, TaskStatus } from '../../core/models';
import { CentsPipe } from '../../core/format';

/** Même synthèse pour le tableau et la gestion, sur tous les projets du périmètre. */
@Component({
  selector: 'bpm-project-overview-summary',
  imports: [CentsPipe],
  styleUrl: './projects.page.scss',
  template: `
    <section
      class="life-summary"
      aria-label="Synthèse des projets et de leurs budgets"
      [attr.aria-busy]="!data()"
    >
      <div class="life-project-stats" aria-label="Avancement de tous les projets">
        <div class="life-stat life-stat-total">
          <span>Projets non terminés</span><strong>{{ data() ? remaining() : '—' }}</strong>
        </div>
        @for (col of columns; track col.id) {
          @if (col.id !== 'done') {
            <div class="life-stat">
              <span
                ><i class="status-dot" [attr.data-status]="col.id" aria-hidden="true"></i
                >{{ col.label }}</span
              ><strong>{{ data() ? (counts()[col.id] ?? 0) : '—' }}</strong>
            </div>
          }
        }
        <div class="life-progress">
          <span>Progression globale</span><strong>{{ data() ? progress() + ' %' : '—' }}</strong>
          <div
            class="progress-track"
            role="progressbar"
            aria-label="Projets terminés"
            [attr.aria-valuenow]="data() ? progress() : null"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <span [style.width.%]="progress()"></span>
          </div>
        </div>
      </div>
      <dl
        class="life-financial-stats"
        aria-label="Budgets de tous les projets de la vie, toutes périodes"
      >
        <div class="life-financial-stat life-allocated">
          <dt>Enveloppe budgétaire allouée</dt>
          <dd>{{ data() ? (data()!.life.allocatedCents | cents) : '—' }}</dd>
          <span>Attribuée aux projets</span>
        </div>
        <div class="life-financial-stat life-paid">
          <dt>Consommé réel</dt>
          <dd>{{ data() ? (data()!.life.paidCents | cents) : '—' }}</dd>
          <span>Règlements validés</span>
        </div>
        <div
          class="life-financial-stat life-remaining"
          [class.is-negative]="(data()?.life?.remainingCents ?? 0) < 0"
        >
          <dt>Reste à consommer</dt>
          <dd>{{ data() ? (data()!.life.remainingCents | cents) : '—' }}</dd>
          <span>Dépassements autorisés inclus</span>
        </div>
        <div
          class="life-financial-stat life-available"
          [class.is-negative]="(data()?.life?.availableCents ?? 0) < 0"
        >
          <dt>Disponible aux tâches</dt>
          <dd>{{ data() ? (data()!.life.availableCents | cents) : '—' }}</dd>
          <span>Reste à ventiler</span>
        </div>
      </dl>
    </section>
  `,
})
export class BpmProjectOverviewSummaryComponent {
  readonly data = input<BpmProjectsOverview | null>(null);
  readonly includeLifeProject = input(false);
  protected readonly columns = COLUMNS;
  private cards = computed(() => {
    const d = this.data();
    return d ? (this.includeLifeProject() ? [d.lifeProject, ...d.projects] : d.projects) : [];
  });
  protected counts = computed(() => {
    const counts: Partial<Record<TaskStatus, number>> = {};
    for (const p of this.cards()) counts[p.view.column] = (counts[p.view.column] ?? 0) + 1;
    return counts;
  });
  protected remaining = computed(() => this.cards().filter((p) => p.view.column !== 'done').length);
  protected progress = computed(() => {
    const all = this.cards();
    return all.length
      ? Math.round((100 * all.filter((p) => p.view.column === 'done').length) / all.length)
      : 0;
  });
}
