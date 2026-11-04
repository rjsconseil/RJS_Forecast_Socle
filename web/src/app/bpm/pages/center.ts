import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BpmApi } from '../../core/bpm-api.service';
import { EntryInput, RegisterLine } from '../../core/bpm-models';
import { cents, CentsPipe, percentText, ShortDatePipe } from '../../core/format';
import { MetricTile, MetricTilesComponent } from '../../shared/metric-tiles.component';
import { BpmCapChart, BpmLineDetail, bpmLoader, BpmOperationEditor, BpmPageContext, BpmPageFrame, BpmState, CapRow } from '../ui';

/** Page d'où l'on vient (`?from=`) : surtitre du bandeau et lien de retour. */
const ORIGINS: Record<string, { label: string; link: string; back: string }> = {
  'tableau-de-bord': { label: 'Tableau de bord', link: '/tableau-de-bord', back: 'Retour au tableau de bord' },
  piloter: { label: 'Graphiques et chiffres', link: '/piloter', back: 'Retour aux graphiques et chiffres' },
  depenses: { label: 'Dépenses de la période', link: '/depenses', back: 'Retour aux dépenses de la période' },
};

/**
 * Détail d'un centre de coûts (ou d'une source d'entrées), sur la page dédiée source
 * `bpm-money-detail` : payé, restant prévu, plafond facultatif, marge ou dépassement, part des
 * entrées ou des dépenses, opérations et échéances de la période. La précision du centre ou de la
 * note passe par l'éditeur partagé (portée annoncée pour une récurrence).
 */
@Component({
  selector: 'bpm-page-center',
  imports: [RouterLink, BpmPageFrame, BpmState, BpmCapChart, BpmLineDetail, BpmOperationEditor, MetricTilesComponent, CentsPipe, ShortDatePipe],
  providers: [BpmPageContext],
  styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-money.scss', '../ref-styles/bpm-money-detail.page.scss', './bpm-money-page.scss'],
  template: `
    <bpm-page
      [kicker]="origin().label"
      [title]="title()"
      pageClass="bpm-money bpm-money-detail"
      [lead]="lead()"
      [context]="read.data()?.context"
      [periodKey]="ctx.period()"
      [periodNav]="true"
      (periodChange)="ctx.setQuery({ period: $event })"
    >
      <a actions class="app-hero-action" [routerLink]="origin().link" [queryParams]="ctx.carry()">← {{ origin().back }}</a>
      <button actions type="button" class="app-hero-action is-secondary" (click)="openCreate()" [disabled]="!read.data()">＋ {{ isIncome() ? 'Ajouter une entrée' : 'Ajouter une charge' }}</button>
      <a actions class="bpm-link" routerLink="/depenses" [queryParams]="registerQuery()">{{ isIncome() ? 'Entrées de la période' : 'Dépenses de la période' }} →</a>

      <div class="bpm-money bpm-money-body bpm-money-detail" data-tone="budget">
        <bpm-state [loading]="read.loading() && !read.data()" [error]="read.error()" (retry)="read.reload()" />

        @if (read.data(); as d) {
          <section data-bpm-frame="metrics" aria-label="Chiffres de la ligne">
            <rjs-metric-tiles variant="instrument" label="Chiffres de la ligne" [tiles]="tiles()" />
          </section>

          @if (message()) {
            <p class="bmd-message" role="status">{{ message() }} <button type="button" class="bmd-precise-open" (click)="message.set(null)">Fermer</button></p>
          }
          <p class="bmd-note-banner">
            <span class="chip">{{ d.center.directionLabel }}</span>
            <span class="chip">{{ d.center.standard ? 'Poste standard' : 'Poste personnel' }}</span>
            {{ d.basis.label }}
          </p>

          @if (!isIncome()) {
            <section class="bm-statement" aria-labelledby="bmd-cap-title" data-ui-pattern="panel" data-bpm-frame="chart">
              <h2 id="bmd-cap-title">Plafond et marge</h2>
              <bpm-cap-chart [rows]="capRows()" />
              <p class="bpm-help">Les montants payés restent ceux de la période ; un plafond n'est jamais converti en dépense.</p>
            </section>
          }

          <section class="bm-statement" aria-labelledby="bmd-entries-title" data-ui-pattern="panel">
            <h2 id="bmd-entries-title">Chaque montant de la période <span class="bmd-count">({{ settled().length }})</span></h2>
            @if (!settled().length) {
              <p class="bm-empty">
                Aucun montant réel sur cette période.
                @if (!d.lines.length) {
                  <button type="button" class="bmd-precise-open" (click)="openCreate()">{{ isIncome() ? 'Ajouter une entrée' : 'Ajouter une charge' }}</button>
                }
              </p>
            } @else {
              <ul class="bmd-entries">
                @for (l of settled(); track l.id) {
                  <li class="bmd-entry" [class.is-editing]="isSelected(l)">
                    <div class="bmd-entry-main">
                      <time [attr.datetime]="l.realizedDate ?? l.plannedDate">{{ (l.realizedDate ?? l.plannedDate) | shortDate }}</time>
                      <span class="bmd-entry-title">
                        <strong>{{ l.label }}</strong>
                        <small>{{ l.budgetRole === 'life' ? 'Budget du projet de vie' : l.budgetName }} · prévue le {{ l.plannedDate | shortDate }}@if (l.cadence !== 'once') { · {{ l.cadenceLabel }} } · prévu {{ l.plannedCents | cents }}</small>
                      </span>
                      <span class="bmd-entry-amount">{{ l.realizedCents === null ? '—' : (l.realizedCents | cents) }}</span>
                      <a class="bmd-precise-open" [routerLink]="[]" [queryParams]="lineQuery(l)" queryParamsHandling="merge" [attr.aria-label]="'Voir le détail : ' + l.label">Voir le détail</a>
                    </div>
                    @if (l.note) {
                      <p class="bmd-entry-note"><span>Note ·</span> {{ l.note }}</p>
                    }
                  </li>
                }
              </ul>
            }
          </section>

          @if (open().length) {
            <section class="bm-statement" aria-labelledby="bmd-pending-title" data-ui-pattern="panel">
              <h2 id="bmd-pending-title">{{ isIncome() ? 'Encore attendu' : 'Encore prévu' }} d’ici la fin de la période <span class="bmd-count">({{ open().length }})</span></h2>
              <p class="bpm-help">
                {{ d.totals.lineCount }} ligne(s) · prévu {{ d.totals.plannedCents | cents }}
                @if (d.totals.unrealizedCents) { · non réalisé {{ d.totals.unrealizedCents | cents }} }
                — échéances du Budget du projet de vie sélectionnées par date prévue.
              </p>
              <ul class="bmd-rest-lines">
                @for (l of open(); track l.id) {
                  <li [attr.data-due]="l.status === 'late' || l.status === 'due' || null" [class.is-selected]="isSelected(l)">
                    <span>
                      {{ l.plannedDate | shortDate }} · {{ l.label }}
                      <small>@if (l.cadence !== 'once') { · {{ l.cadenceLabel }} }@if (l.taskTitle) { · {{ l.taskTitle }} }</small>
                      @if (l.status === 'late' || l.status === 'due') {
                        <em class="bmd-late">{{ l.status === 'late' ? 'en retard' : 'aujourd’hui' }}</em>
                      } @else if (l.status === 'unrealized') {
                        <em class="bmd-late">{{ l.statusLabel }}</em>
                      }
                    </span>
                    <span class="bmd-pending-end">
                      {{ l.plannedCents | cents }}
                      <a class="bmd-precise-open" [routerLink]="[]" [queryParams]="lineQuery(l)" queryParamsHandling="merge" [attr.aria-label]="'Voir le détail : ' + l.label">Voir le détail</a>
                    </span>
                  </li>
                }
              </ul>
            </section>
          }

          <details class="bpm-disclosure bm-statement" aria-labelledby="bmd-precise-title" data-ui-pattern="panel">
            <summary><h2 id="bmd-precise-title">Préciser le poste ou la note d'une opération</h2></summary>
            <div class="bpm-disclosure-body">
              <p class="bpm-help">Ouvrez une ligne puis « Modifier » : l'éditeur partagé permet de changer le poste ou la note. Pour une opération récurrente, la modification porte sur la définition ; l'éditeur annonce sa portée (occurrences encore attendues) et les règlements déjà enregistrés gardent leurs dates et montants. Les opérations d'une période close restent protégées.</p>
              <p class="bpm-help">Les opérations sans poste se retrouvent dans les dépenses de la période avec le filtre <a routerLink="/depenses" [queryParams]="noneQuery()">Poste à préciser</a>.</p>
            </div>
          </details>
        }
      </div>
    </bpm-page>

    @if (editorOpen() && read.data(); as d) {
      <bpm-operation-editor [budgets]="d.context.budgets" [line]="editing()" [defaults]="defaults()" (closed)="closeEditor()" (saved)="onSaved($event)" />
    } @else if (selectedId()) {
      <bpm-line-detail [lineId]="selectedId()!" [period]="ctx.period()" (closed)="closeDetail()" (edit)="openEdit($event)" />
    }
  `,
  styles: `
    :host { display: block; }
    .bmd-note-banner { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ecart-8); }
    .bm-empty .bmd-precise-open { margin-inline-start: var(--ecart-12); }
  `,
})
export class BpmCenterPage {
  private bpm = inject(BpmApi);
  protected ctx = inject(BpmPageContext);

  /** Référence du centre (`std:<clé>` ou ID de centre personnel), décodée par le routeur. */
  protected ref = computed(() => this.ctx.params().get('poste') ?? '');
  protected read = bpmLoader(
    () => ({ ref: this.ref(), period: this.ctx.period() }),
    (k) => this.bpm.center(k.ref, k.period),
  );

  protected isIncome = computed(() => this.read.data()?.center.direction === 'income');
  /** Titre source « Le poste {name} » ; une source d'entrées garde son nom de source. */
  protected title = computed(() => {
    const c = this.read.data()?.center;
    if (!c) return 'Détail du poste';
    return c.direction === 'income' ? `La source ${c.label}` : `Le poste ${c.label}`;
  });
  private lines = computed(() => [...(this.read.data()?.lines ?? [])].sort((a, b) => a.plannedDate.localeCompare(b.plannedDate)));
  protected settled = computed(() => this.lines().filter((l) => l.settled));
  protected open = computed(() => this.lines().filter((l) => !l.settled));
  /** Phrase du bandeau (source `lead-poste`) : le réglé et le nombre de montants réels. */
  protected lead = computed(() => {
    const c = this.read.data()?.center;
    if (!c) return 'Lecture du relevé…';
    return `${cents(c.paidCents)} ${this.isIncome() ? 'reçus' : 'payés'} sur la période en ${this.settled().length} montant(s).`;
  });
  protected origin = computed(() => ORIGINS[this.ctx.q('from')()] ?? ORIGINS['tableau-de-bord']);
  protected shareTitle = computed(() => (this.read.data()?.basis.kind === 'received' ? 'Part des entrées' : 'Part des dépenses'));
  protected capRows = computed<CapRow[]>(() => {
    const c = this.read.data()?.center;
    return c ? [{ key: c.ref, label: c.label, paidCents: c.paidCents, remainingCents: c.remainingCents, capCents: c.capCents }] : [];
  });

  /** Tuiles source : payé, encore prévu, montants, part, plafond du poste (marge en note). Inconnu n'est jamais zéro. */
  protected tiles = computed<MetricTile[]>(() => {
    const d = this.read.data();
    if (!d) return [];
    const c = d.center;
    const income = this.isIncome();
    const tiles: MetricTile[] = [
      { id: 'total', label: income ? 'Reçu' : 'Payé', value: cents(c.paidCents), tone: income ? 'success' : null, emphasis: true, note: 'Selon la date réelle de règlement dans la période.' },
      { id: 'planned', label: income ? 'Encore attendu' : 'Encore prévu', value: cents(c.remainingCents), note: 'Échéances de la période non réglées.' },
      { id: 'count', label: 'Montants', value: String(this.settled().length), note: `${d.lines.length} ligne(s) prévue(s) dans la période.` },
    ];
    const basisText = income ? 'Part des entrées reçues' : d.basis.kind === 'received' ? 'Sur 100 € reçus dans la période' : 'Sur 100 € dépensés dans la période';
    tiles.push({
      id: 'share',
      label: income ? 'Part des entrées' : this.shareTitle(),
      value: c.sharePct === null ? 'Non calculable' : percentText(c.sharePct),
      note:
        c.sharePct === null
          ? 'Base nulle : aucune part n’est calculée.'
          : `${basisText} (base ${cents(d.basis.baseCents)}). Les entrées servent de base lorsqu'elles sont positives et couvrent les dépenses ; sinon les dépenses.`,
    });
    if (!income) {
      const margin = c.marginCents;
      tiles.push({
        id: 'limit',
        label: 'Plafond du poste',
        value: c.capCents === null ? 'Aucun plafond' : cents(c.capCents),
        tone: margin !== null && margin < 0 ? 'danger' : null,
        note:
          c.capCents === null
            ? 'Facultatif : à définir dans Ce qu’il faut faire › Budget type.'
            : margin === null
              ? 'Marge non calculable.'
              : margin < 0
                ? `Dépassé de ${cents(-margin)} avec le prévu (plafond − payé − encore prévu).`
                : `Reste ${cents(margin)} avec le prévu (plafond − payé − encore prévu).`,
      });
    }
    return tiles;
  });

  protected registerQuery = computed(() => ({ ...this.ctx.carry(), center: this.read.data()?.center.ref ?? this.ref(), ...(this.isIncome() ? { direction: 'income' } : {}) }));
  protected noneQuery = computed(() => ({ ...this.ctx.carry(), center: '__none__', direction: 'all' }));

  // ---------- détail d'une ligne (même convention d'URL que le registre) ----------

  protected selectedId = computed(() => this.ctx.q('occurrence')() || this.ctx.q('operation')() || null);
  protected isSelected = (l: RegisterLine) => {
    const id = this.selectedId();
    return !!id && (l.id === id || l.occurrenceKey === id || l.operationId === id);
  };
  protected lineQuery(l: RegisterLine) {
    return { operation: l.operationId ?? (l.occurrenceKey ? null : l.id), occurrence: l.occurrenceKey ?? null };
  }
  protected closeDetail() {
    this.ctx.setQuery({ operation: null, occurrence: null }, { replace: true });
  }

  // ---------- éditeur partagé ----------

  protected editorOpen = signal(false);
  protected editing = signal<RegisterLine | null>(null);
  protected message = signal<string | null>(null);
  protected defaults = computed<Partial<EntryInput>>(() => {
    const c = this.read.data()?.center;
    return c ? { costCenterRef: c.ref, direction: c.direction } : {};
  });
  protected openCreate() {
    this.editing.set(null);
    this.editorOpen.set(true);
  }
  protected openEdit(l: RegisterLine) {
    this.editing.set(l);
    this.editorOpen.set(true);
  }
  protected closeEditor() {
    this.editorOpen.set(false);
    this.editing.set(null);
  }
  protected onSaved(msg: string) {
    this.message.set(msg);
    this.closeEditor();
  }
}
