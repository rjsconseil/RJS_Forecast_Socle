import { BpmAmount } from '../ui/amount';
import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BpmRouterLink } from '../ui/bpm-router-link';
import { publishObjectLabel } from '../../plan/plan-context';
import { BpmApi } from '../data/bpm-api.service';
import { EntryInput, RegisterLine } from '../data/bpm-models';
import { cents, CentsPipe, percentText, ShortDatePipe } from '../../core/format';
import { MetricTile, MetricTilesComponent } from '../../shared/metric-tiles.component';
import { BpmCapChart, BpmCapGauge, BpmLineDetail, bpmLoader, BpmEntryFlow, BpmPageContext, BpmPageFrame, BpmPageFocus, nextOpenLine, BpmState, CapRow, BpmQuickSettle } from '../ui';
import { BpmCapDialog } from '../ui/cap-dialog';

/** Page d'où l'on vient (`?from=`) : le lien du bandeau remonte vers elle, nommée comme dans le menu. */
const ORIGINS: Record<string, { label: string; link: string }> = {
  'tableau-de-bord': { label: 'Tableau de bord', link: '/tableau-de-bord' },
  piloter: { label: 'Tableau de bord', link: '/tableau-de-bord' },
  depenses: { label: 'Registre de flux', link: '/depenses/registre' },
  entrees: { label: 'Registre de flux', link: '/tableau-de-bord/entrees' },
  'projet-de-vie': { label: 'Gestion du projet de vie', link: '/projet-de-vie' },
  plafonds: { label: 'Plafonds', link: '/plafonds' },
};

/**
 * Détail d'un centre de coûts (ou d'une source d'entrées), sur la page dédiée source
 * `bpm-money-detail` : payé, restant prévu, plafond facultatif, marge ou dépassement, part des
 * entrées ou des dépenses, opérations et échéances de la période. La précision du centre ou de la
 * note passe par l'éditeur partagé (portée annoncée pour une récurrence).
 */
@Component({
  selector: 'bpm-page-center',
  imports: [BpmAmount, BpmQuickSettle, BpmRouterLink, BpmPageFrame, BpmState, BpmCapChart, BpmCapGauge, BpmCapDialog, BpmLineDetail, BpmEntryFlow, MetricTilesComponent, CentsPipe, ShortDatePipe],
  providers: [BpmPageContext],
  styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-money.scss', '../ref-styles/bpm-money-detail.page.scss', './bpm-money-page.scss'],
  template: `
    <bpm-page
      [back]="{ label: origin().label, link: origin().link, query: ctx.carry(), direct: true }"
      [title]="title()"
      pageClass="bpm-money bpm-money-detail"
      [lead]="lead()" [focus]="pageFocus()" [result]="capNotice() ? { message: capNotice()!.text, tone: capNotice()!.error ? 'danger' : 'success' } : message() ? { message: message()!, tone: 'success' } : null" toolsLabel="Ouvrir le poste"
      [context]="read.data()?.context"
      [periodKey]="ctx.period()"
      [periodNav]="true"
      (periodChange)="ctx.setQuery({ period: $event })"
    >
      @if (nextLine(); as line) { <button primary type="button" class="app-hero-action" (click)="reviewNext()">Vérifier {{ isIncome() ? 'la réception' : 'le règlement' }} · {{ line.label }}</button> }
      <button actions type="button" class="btn btn-secondary" (click)="openCreate()" [disabled]="!read.data()">＋ {{ isIncome() ? 'Saisir une entrée dans ce poste' : 'Saisir une dépense dans ce poste' }}</button>
      @if (!isIncome() && read.data()?.cap; as m) {
        <button actions type="button" class="btn btn-secondary" (click)="capOpen.set(true)">{{ m.capCents === null ? 'Fixer un plafond' : 'Modifier le plafond' }}</button>
      }

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
          <p class="bpm-help">{{ d.selection }}</p>

          @if (!isIncome()) {
            <section class="bm-statement bmd-caps" aria-labelledby="bmd-cap-title" data-ui-pattern="panel" data-bpm-frame="chart">
              <header class="bmd-caps-head">
                <h2 id="bmd-cap-title">Plafond et marge</h2>
                @if (d.cap; as m) {
                  <bpm-cap-gauge [measure]="m" />
                }
              </header>
              <bpm-cap-chart [rows]="capRows()" />

              <p class="bpm-help">Engagé = payé + encore prévu sur la période. Au-delà du plafond, le poste passe en rouge sans jamais bloquer une dépense ; un plafond n'est jamais converti en dépense.</p>
              <p class="bpm-help"><a routerLink="/plafonds" [queryParams]="ctx.carry()">Les plafonds de tous les postes →</a></p>
            </section>
          }

          <section class="bm-statement" aria-labelledby="bmd-entries-title" data-ui-pattern="panel">
            <h2 id="bmd-entries-title">{{ isIncome() ? 'Reçus dans la période' : 'Paiements de la période' }} <span class="bmd-count">({{ settled().length }})</span></h2>
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
                        <small>{{ l.budgetRole === 'life' ? 'Budget du projet de vie' : l.budgetName }} · prévue le {{ l.plannedDate | shortDate }}@if (l.cadence !== 'once') { · {{ l.cadenceLabel }} } · prévu <span [bpmAmount]="l.plannedCents" [bpmFlow]="l.direction">{{ l.plannedCents | cents }}</span></small>
                      </span>
                      <span class="bmd-entry-amount" [bpmAmount]="l.realizedCents" [bpmFlow]="l.direction">{{ l.realizedCents === null ? '—' : (l.realizedCents | cents) }}</span>
                      <a class="bmd-precise-open" [routerLink]="[]" [queryParams]="lineQuery(l)" queryParamsHandling="merge" [attr.aria-label]="'Ouvrir le détail : ' + l.label">Ouvrir le détail</a>
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
                {{ open().length }} échéance(s) · restant prévu <span [bpmAmount]="d.center.remainingCents" [bpmFlow]="isIncome() ? 'income' : 'charge'">{{ d.center.remainingCents | cents }}</span>.
                Ces échéances suivent leur date prévue ; les règlements ci-dessus suivent leur date réelle.
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
                      <span [bpmAmount]="l.plannedCents" [bpmFlow]="l.direction">{{ l.plannedCents | cents }}</span>
                      <bpm-quick-settle [line]="l" (detail)="ctx.setQuery(lineQuery(l))" />
                      <a class="bmd-precise-open" [routerLink]="[]" [queryParams]="lineQuery(l)" queryParamsHandling="merge" [attr.aria-label]="'Ouvrir le détail : ' + l.label">Ouvrir le détail</a>
                    </span>
                  </li>
                }
              </ul>
            </section>
          }

          @if (unrealized().length) {
            <section class="bm-statement" aria-labelledby="bmd-unrealized-title" data-ui-pattern="panel">
              <h2 id="bmd-unrealized-title">Non réalisées à la clôture <span class="bmd-count">({{ unrealized().length }})</span></h2>
              <p class="bpm-help">Ces échéances ne sont pas incluses dans le restant prévu de la période clôturée. Ouvrez leur détail pour consulter les actions encore disponibles.</p>
              <ul class="bmd-rest-lines">
                @for (l of unrealized(); track l.id) {
                  <li><span>{{ l.plannedDate | shortDate }} · {{ l.label }}<small>{{ l.statusLabel }}</small></span><span class="bmd-pending-end"><span [bpmAmount]="l.plannedCents" [bpmFlow]="l.direction">{{ l.plannedCents | cents }}</span><a class="bmd-precise-open" [routerLink]="[]" [queryParams]="lineQuery(l)" queryParamsHandling="merge" [attr.aria-label]="'Ouvrir le détail : ' + l.label">Ouvrir le détail</a></span></li>
                }
              </ul>
            </section>
          }

          <details class="bpm-disclosure bm-statement" aria-labelledby="bmd-precise-title" data-ui-pattern="panel">
            <summary><h2 id="bmd-precise-title">Préciser le poste ou la note d'une opération</h2></summary>
            <div class="bpm-disclosure-body">
              <p class="bpm-help">Ouvrez une ligne puis « Modifier » : l'éditeur partagé permet de changer le poste ou la note. Pour une opération récurrente, la modification porte sur la définition ; l'éditeur annonce sa portée (occurrences encore attendues) et les règlements déjà enregistrés gardent leurs dates et montants. Les opérations d'une période close restent protégées.</p>
              <p class="bpm-help">Les opérations sans poste se retrouvent dans les dépenses de la période avec le filtre <a routerLink="/depenses/registre" [queryParams]="noneQuery()">Poste à préciser</a>.</p>
            </div>
          </details>
        }
      </div>
    </bpm-page>

    @if (read.data(); as d) { <bpm-entry-flow [budgets]="d.context.budgets" [defaults]="defaults()" (saved)="onSaved($event)" /> }
    @if (capOpen() && read.data()?.cap; as m) {
      <bpm-cap-dialog [centers]="[m]" [initialRef]="m.ref" [revision]="read.data()!.lifeBudget.revision" [levels]="read.data()!.levels" [periodLabel]="read.data()!.context.period?.label ?? 'ce cycle'" (closed)="capOpen.set(false)" (saved)="onCapSaved($event)" />
    }
    <!-- L'éditeur et le détail sont indépendants : le clic sur une ligne ouvre toujours son détail (audit A01). -->
    @if (selectedId()) {
      <bpm-line-detail [lineId]="selectedId()!" [period]="ctx.period()" (closed)="closeDetail()" (edit)="openEdit($event)" />
    }
  `,
  styles: `
    :host { display: block; }
    .bmd-note-banner { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ecart-8); }
    .bm-empty .bmd-precise-open { margin-inline-start: var(--ecart-12); }
    .bmd-caps { display: grid; gap: var(--ecart-12); }
    .bmd-caps-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--ecart-8); }
    .bmd-caps-head h2 { margin: 0; }
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

  /** Le cadre (fil d'Ariane, menu, historique) nomme le poste ouvert au lieu de « Détail d’un poste ». */
  private readonly router = inject(Router);
  private readonly framed = publishObjectLabel(
    () => (this.ref() ? this.router.createUrlTree(['/argent/postes', this.ref()]).toString() : null),
    () => { const c = this.read.data()?.center; return c ? (c.direction === 'income' ? `Source ${c.label}` : `Poste ${c.label}`) : null; },
  );

  protected isIncome = computed(() => this.read.data()?.center.direction === 'income');
  /** Titre source « Le poste {name} » ; une source d'entrées garde son nom de source. */
  protected title = computed(() => {
    const c = this.read.data()?.center;
    if (!c) return 'Détail du poste';
    return c.direction === 'income' ? `La source ${c.label}` : `Le poste ${c.label}`;
  });
  protected settled = computed(() => [...(this.read.data()?.settledLines ?? [])].sort((a, b) => (a.realizedDate ?? '').localeCompare(b.realizedDate ?? '') || a.label.localeCompare(b.label)));
  protected open = computed(() => this.read.data()?.pendingLines ?? []);
  protected unrealized = computed(() => this.read.data()?.unrealizedLines ?? []);
  /** Phrase du bandeau (source `lead-poste`) : le réglé et le nombre de montants réels. */
  protected lead = computed(() => {
    const c = this.read.data()?.center;
    if (!c) return 'Lecture du relevé…';
    return `${cents(c.paidCents)} ${this.isIncome() ? 'reçus' : 'payés'} sur la période en ${this.settled().length} montant(s).`;
  });
  protected nextLine = computed(() => nextOpenLine(this.open()));
  protected pageFocus = computed<BpmPageFocus | null>(() => {
    const d = this.read.data();
    if (!d) return null;
    if (d.cap?.over) return { title: `Plafond dépassé de ${cents(-(d.cap.marginCents ?? 0))}`, detail: 'Relisez les échéances de ce poste et ajustez le plafond si votre budget a changé.', tone: 'danger' };
    const line = this.nextLine();
    return { title: line ? `${this.open().length} échéance(s) à suivre sur ce poste` : 'Aucune échéance ouverte sur ce poste', detail: line ? `${line.label} · ${cents(line.plannedCents)} · ${line.statusLabel}.` : 'Ajoutez un flux dans ce poste ou ajustez son plafond.', tone: line?.status === 'late' ? 'danger' : line?.status === 'due' ? 'warning' : 'info' };
  });
  protected reviewNext() {
    const line = this.nextLine();
    if (line) void this.ctx.setQuery(this.lineQuery(line));
  }

  protected origin = computed(() => ORIGINS[this.ctx.q('from')()] ?? ORIGINS['tableau-de-bord']);
  protected shareTitle = computed(() => (this.read.data()?.basis.kind === 'received' ? 'Part des entrées' : 'Part des dépenses'));
  protected capRows = computed<CapRow[]>(() => {
    const c = this.read.data()?.center;
    return c ? [{ key: c.ref, label: c.label, paidCents: c.paidCents, remainingCents: c.remainingCents, capCents: c.capCents }] : [];
  });

  // ---------- plafond du poste (jamais bloquant), réglé dans sa fenêtre ----------

  protected capOpen = signal(false);
  protected capNotice = signal<{ text: string; error: boolean } | null>(null);
  protected onCapSaved(text: string) {
    this.capOpen.set(false);
    this.capNotice.set({ text, error: false });
    this.ctx.refresh.bump();
  }

  /** Tuiles source : payé, encore prévu, montants, part, plafond du poste (marge en note). Inconnu n'est jamais zéro. */
  protected tiles = computed<MetricTile[]>(() => {
    const d = this.read.data();
    if (!d) return [];
    const c = d.center;
    const income = this.isIncome();
    const tiles: MetricTile[] = [
      { id: 'total', label: income ? 'Reçu' : 'Payé', value: cents(c.paidCents), amountCents: c.paidCents, symbol: income ? 'income' : 'expense', tone: income ? 'success' : 'danger', emphasis: true, note: 'Selon la date réelle de règlement dans la période.' },
      { id: 'planned', label: income ? 'Encore attendu' : 'Encore prévu', value: cents(c.remainingCents), amountCents: c.remainingCents, symbol: income ? 'income' : 'expense', note: 'Échéances de la période non réglées.' },
      { id: 'count', label: income ? 'Réceptions' : 'Paiements', value: String(this.settled().length), note: 'Règlements dont la date réelle appartient à la période.' },
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
        amountCents: c.capCents,
        tone: margin !== null && margin < 0 ? 'danger' : null,
        note:
          c.capCents === null
            ? 'Facultatif : « Fixer un plafond » dans les actions du poste.'
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

  protected message = signal<string | null>(null);
  protected defaults = computed<Partial<EntryInput>>(() => {
    const c = this.read.data()?.center;
    return c ? { costCenterRef: c.ref, direction: c.direction } : {};
  });
  protected openCreate() {
    void this.ctx.setQuery({ entry: 'new' });
  }
  protected openEdit(l: RegisterLine) {
    void this.ctx.setQuery({ entry: l.id });
  }
  protected closeEditor() {
    void this.ctx.setQuery({ entry: null }, { replace: true });
  }
  protected onSaved(msg: string) {
    this.message.set(msg);
    this.closeEditor();
  }
}
