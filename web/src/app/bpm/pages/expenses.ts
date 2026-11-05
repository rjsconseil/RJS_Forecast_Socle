import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { CHARGE_NATURE_LABEL, ChargeNature, Direction, EntryInput, LineStatus, RegisterLine, RegisterQuery } from '../../core/bpm-models';
import { cents, CentsPipe, ShortDatePipe, shortDate } from '../../core/format';
import { BpmCapGauge, BpmLineDetail, bpmLoader, BpmOperationEditor, BpmPageContext, BpmPageFrame, BpmState, overCapsOf } from '../ui';

const STATUS_LABEL: Record<LineStatus, string> = { late: 'En retard', due: 'Du jour', pending: 'À venir', settled: 'Réglé', unrealized: 'Non réalisé' };
const GROUP_LABEL: Record<string, string> = { center: 'Par poste', category: 'Par catégorie', nature: 'Par nature', project: 'Par projet', date: 'Par date prévue' };
/** Filtres du panneau Affiner (la recherche et le sens restent à part). */
const REFINE_KEYS = ['status', 'nature', 'center', 'category', 'taskId', 'budgetId', 'scope', 'from', 'to'] as const;
/** Dépenses sans catégorie personnalisée (filtre et groupe). */
const NO_CATEGORY = '__none__';
const NATURES: ChargeNature[] = ['indispensable', 'courante', 'projet'];

/**
 * Dépenses de la période : registre sélectionné par date prévue, totaux qui suivent les filtres,
 * recherche visible, liste groupée et panneau Affiner. Tous les filtres et la ligne ouverte sont
 * dans l'URL (lien profond `?operation=…&occurrence=…`). Aucun filtre ni ouverture n'écrit.
 */
@Component({
  selector: 'bpm-page-expenses',
  imports: [RouterLink, BpmPageFrame, BpmState, BpmLineDetail, BpmOperationEditor, BpmCapGauge, CentsPipe, ShortDatePipe],
  providers: [BpmPageContext],
  styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-money.scss', '../ref-styles/bpm-expenses.page.scss', './bpm-money-page.scss'],
  template: `
    <bpm-page
      title="Dépenses de la période"
      pageClass="bpm-money expense-register-page"
      [lead]="lead()"
      [context]="reg.data()?.context"
      [periodKey]="ctx.period()"
      [periodNav]="!customWindow()"
      (periodChange)="ctx.setQuery({ period: $event })"
    >
      <a actions class="bpm-link" routerLink="/tableau-de-bord" [queryParams]="ctx.carry()">← Tableau de bord</a>
      <a actions class="bpm-link" routerLink="/projet-de-vie">Gestion du projet de vie →</a>
      <a actions class="bpm-link" routerLink="/plafonds" [queryParams]="ctx.carry()">Plafonds & catégories →</a>
      <button actions type="button" class="app-hero-action" (click)="openCreate()" [disabled]="!budgets().length">＋ {{ direction() === 'income' ? 'Ajouter une entrée' : direction() === 'all' ? 'Saisir un flux' : 'Ajouter une charge' }}</button>

      <div class="bpm-money bpm-money-body expense-register-page" data-tone="budget">
        @if (message()) {
          <div class="alert ok" role="status">{{ message() }} <button type="button" class="btn btn-secondary" (click)="message.set(null)">Fermer</button></div>
        }

        <!-- Recherche visible, regroupement, sens et panneau « Affiner la liste » (ne touche pas à la recherche) -->
        <section class="expense-filters" data-ui-pattern="panel" role="search" aria-label="Rechercher et affiner la liste">
          <label class="expense-search">
            {{ direction() === 'income' ? 'Afficher les entrées' : direction() === 'all' ? 'Afficher les échéances' : 'Afficher les dépenses' }}
            <select name="expense-grouping" (change)="setGroup($any($event.target).value)">
              @for (g of groupKeys; track g) { <option [value]="g" [selected]="groupBy() === g">{{ groupLabel[g] }}</option> }
            </select>
          </label>
          <label class="expense-search">
            {{ direction() === 'income' ? 'Rechercher une entrée' : direction() === 'all' ? 'Rechercher une échéance' : 'Rechercher une dépense' }}
            <input type="search" name="expense-search" [value]="search()" (input)="onSearch($any($event.target).value)" placeholder="Libellé, note ou poste…" aria-describedby="search-help" />
          </label>
          <div class="expense-direction">
            <span id="dir-l">Sens</span>
            <span class="segmented" role="group" aria-labelledby="dir-l">
              <button type="button" [attr.aria-pressed]="direction() === 'charge'" (click)="setDirection('charge')">Charges</button>
              <button type="button" [attr.aria-pressed]="direction() === 'income'" (click)="setDirection('income')">Entrées</button>
              <button type="button" [attr.aria-pressed]="direction() === 'all'" (click)="setDirection('all')">Tout</button>
            </span>
          </div>
          <details id="refine-panel" class="expense-advanced-filters" [open]="refineOpen()" (toggle)="refineOpen.set($any($event.target).open)">
            <summary>
              Affiner la liste
              @if (activeRefine().length) { <span>{{ activeRefine().length }} filtre(s) actif(s)</span> }
            </summary>
            <div class="expense-filter-fields">
              <label>
                Projet
                <select name="expense-budget" [value]="budgetSel()" (change)="setBudget($any($event.target).value)">
                  <option value="">Budget du projet de vie (principal)</option>
                  <option value="__all__">Tous les projets (chaque Budget une fois)</option>
                  @for (b of budgets(); track b.id) {
                    @if (b.role === 'standard') { <option [value]="b.id">{{ b.name }} (projet de la vie)</option> }
                  }
                </select>
              </label>
              <label>
                État
                <select name="expense-status" [value]="ctx.q('status')()" (change)="ctx.setQuery({ status: $any($event.target).value })">
                  <option value="">Tout afficher</option>
                  @for (s of statuses; track s) { <option [value]="s">{{ statusLabel[s] }}</option> }
                </select>
              </label>
              <label>
                Nature de charge
                <select name="expense-nature" [value]="ctx.q('nature')()" (change)="setNature($any($event.target).value)">
                  <option value="">Tout afficher</option>
                  @for (n of natures; track n) { <option [value]="n">{{ natureLabel[n] }}</option> }
                </select>
              </label>
              <label>
                Poste
                <select name="expense-center" [value]="ctx.q('center')()" (change)="ctx.setQuery({ center: $any($event.target).value })">
                  <option value="">Tout afficher</option>
                  <option value="__none__">Poste à préciser</option>
                  @for (c of centerOptions(); track c.ref) { <option [value]="c.ref">{{ c.label }}{{ c.standard ? '' : ' (personnel)' }}</option> }
                </select>
              </label>
              <label>
                Catégorie de dépense
                <select name="expense-category" [value]="ctx.q('category')()" (change)="setCategory($any($event.target).value)" [disabled]="direction() === 'income'">
                  <option value="">{{ direction() === 'income' ? 'Les catégories classent les charges' : 'Tout afficher' }}</option>
                  <option value="__none__">Sans catégorie</option>
                  @for (k of categoryOptions(); track k.id) { <option [value]="k.id">{{ k.label }} · {{ k.costCenterLabel }}{{ k.archived ? ' (retirée)' : '' }}</option> }
                </select>
              </label>
              <label>
                Tâche du projet
                <select name="expense-task" [value]="ctx.q('taskId')()" (change)="ctx.setQuery({ taskId: $any($event.target).value })" [disabled]="!taskOptions().length">
                  <option value="">{{ taskOptions().length ? 'Tout afficher' : 'Aucune tâche de projet budgétisé' }}</option>
                  @for (t of taskOptions(); track t.id) { <option [value]="t.id">{{ t.title }}</option> }
                </select>
              </label>
              <label>
                Du (date prévue)
                <input type="date" name="expense-from" [value]="ctx.q('from')()" (change)="setWindow('from', $any($event.target).value)" />
              </label>
              <label>
                Au (inclus)
                <input type="date" name="expense-to" [value]="ctx.q('to')()" (change)="setWindow('to', $any($event.target).value)" />
              </label>
            </div>
            @if (windowError()) { <p class="bpm-error" role="alert">{{ windowError() }}</p> }
            <p class="bpm-help">Une fenêtre de dates libre remplace la période pour la lecture ; elle ne change pas le cycle de clôture. Les deux dates sont nécessaires.</p>
            <button type="button" class="btn btn-secondary" (click)="clearRefine()">Réinitialiser les filtres</button>
          </details>
          <small id="search-help" class="expense-search-help">La recherche est conservée à l'ouverture d'une ligne et dans le lien.</small>
        </section>

        @if (activeRefine().length || customWindow()) {
          <p class="expense-active-filters" aria-label="Filtres actifs">
            @for (f of activeRefine(); track f.key) {
              <span class="chip">{{ f.label }} <button type="button" class="x" (click)="ctx.setQuery(clearOne(f.key))" [attr.aria-label]="'Retirer le filtre ' + f.label">✕</button></span>
            }
            <button type="button" class="btn btn-secondary" (click)="clearRefine()">Réinitialiser les filtres</button>
          </p>
        }

        <!-- La période en un regard : les totaux suivent les filtres -->
        @if (reg.data(); as r) {
          <section class="expense-overview" data-bpm-frame="metrics" aria-labelledby="expense-overview-title">
            <header>
              <div>
                <span class="expense-overview-kicker">La période en un regard</span>
                <h2 id="expense-overview-title">{{ direction() === 'income' ? 'Où en sont vos entrées ?' : direction() === 'all' ? 'Où en sont vos échéances ?' : 'Où en sont vos dépenses ?' }}</h2>
              </div>
              <span class="expense-overview-count">{{ r.totals.lineCount }} échéance(s) affichée(s) sur {{ r.totals.unfilteredCount }}</span>
            </header>
            <div class="expense-overview-grid">
              <article class="expense-overview-card" data-status="recorded">
                <div class="expense-overview-label">
                  <h3>{{ labels().paid }}</h3>
                  <span class="flow-direction is-compact" [attr.data-flow]="direction() === 'income' ? 'income' : direction() === 'charge' ? 'expense' : null" aria-hidden="true">{{ direction() === 'income' ? '↑' : '↓' }}</span>
                </div>
                <strong class="expense-overview-value">{{ r.totals.paidCents | cents }}</strong>
                <p>{{ notes().paid }}</p>
              </article>
              <article class="expense-overview-card" data-status="pending">
                <div class="expense-overview-label">
                  <h3>{{ labels().toPay }}</h3>
                  <span class="flow-direction is-compact" aria-hidden="true">◷</span>
                </div>
                <strong class="expense-overview-value">{{ r.totals.toPayCents | cents }}</strong>
                <p>{{ notes().toPay }}</p>
              </article>
              <article class="expense-overview-card" data-status="unrealized">
                <div class="expense-overview-label">
                  <h3>Non réalisé</h3>
                  <span class="flow-direction is-compact" aria-hidden="true">—</span>
                </div>
                <strong class="expense-overview-value">{{ r.totals.unrealizedCents | cents }}</strong>
                <p>{{ notes().unrealized }}</p>
              </article>
            </div>
            <p class="expense-overview-note">
              Montants selon les dates prévues et les filtres sélectionnés ({{ r.totals.lineCount }} ligne(s) sur {{ r.totals.unfilteredCount }}, du {{ r.window.from | shortDate }} au {{ r.window.to | shortDate }} inclus). Les échéances non réalisées ne sont pas comptées dans le {{ labels().paid.toLowerCase() }}.
              @if (direction() === 'all') {
                <span class="chip warn">Entrées et charges additionnées sans signe : choisissez un sens pour un total lisible.</span>
              }
            </p>
          </section>
        }

        <!-- Plafonds dépassés sur la période : signalés en rouge, jamais bloquants -->
        @if (overCaps().length) {
          <div class="expense-caps-alert" role="status">
            <strong>{{ overCaps().length }} plafond{{ overCaps().length > 1 ? 's' : '' }} dépassé{{ overCaps().length > 1 ? 's' : '' }} sur la période :</strong>
            @for (o of overCaps(); track o.key) {
              <span class="expense-caps-item">{{ o.level }} « {{ o.label }} » <strong>+{{ o.overCents | cents }}</strong></span>
            }
            <a routerLink="/plafonds" [queryParams]="ctx.carry()">Voir les plafonds →</a>
          </div>
        }

        <details class="bm-calculation">
          <summary>Date prévue ou date réelle ?</summary>
          <div class="record-details">
            <p>La liste sélectionne les échéances par leur <strong>date prévue</strong>. Le réalisé des synthèses (tableau de bord, solde) suit la <strong>date réelle</strong> de règlement : une charge prévue le 31 octobre et payée le 2 novembre figure ici en octobre et dans le réalisé de novembre.</p>
            @if (reg.data(); as r) { <p class="bpm-help">{{ r.selection }}</p> }
          </div>
        </details>

        <!-- Lien profond vers une ligne absente des filtres -->
        @if (missing()) {
          <div class="expense-note" role="status">
            <strong>L'échéance demandée ne figure pas dans cet intervalle ou dans ces filtres.</strong>
            @if (missingLine.data(); as d) {
              <p>« {{ d.line.label }} », prévue le {{ d.line.plannedDate | shortDate }} ({{ d.line.direction === 'income' ? 'entrée' : 'charge' }}, {{ d.line.statusLabel }}).
                @for (r of missingReasons(); track r) { <br />— {{ r }} }
              </p>
            } @else if (missingLine.error(); as e) {
              <p>{{ e.message }}</p>
            }
            <p>Le détail reste ouvert ; vous pouvez réinitialiser les filtres ou changer de période :</p>
            <div class="bpm-actions">
              <button type="button" class="btn btn-secondary" (click)="clearAll()">Réinitialiser filtres et recherche</button>
              @if (missingLine.data(); as d) {
                <button type="button" class="btn btn-secondary" (click)="showDate(d.line.plannedDate)">Lire la date prévue ({{ d.line.plannedDate | shortDate }})</button>
              }
            </div>
          </div>
        }

        <!-- Liste groupée -->
        <header class="expense-list-heading" id="expense-list">
          <div>
            <h2>{{ listTitle() }}</h2>
            <p>{{ groupBy() === 'date' ? 'Dans l’ordre des dates prévues.' : 'Du montant le plus élevé au plus faible.' }}</p>
          </div>
          @if (reg.data(); as r) { <strong>{{ r.totals.lineCount }} échéance(s) affichée(s) · prévu {{ r.totals.plannedCents | cents }}</strong> }
          <p class="expense-list-help">Les totaux suivent vos filtres et les dates prévues. Ouvrez une échéance pour voir son détail et, si permis, la pointer ou la modifier.</p>
        </header>
        <bpm-state [loading]="reg.loading() && !reg.data()" [error]="reg.error()" (retry)="reg.reload()" [empty]="!!reg.data() && !reg.data()!.lines.length" [emptyText]="emptyText()">
          @if (reg.data()?.totals?.unfilteredCount) {
            <button type="button" class="btn btn-secondary" (click)="clearAll()">Réinitialiser filtres et recherche</button>
          } @else {
            <button type="button" class="btn btn-primary" (click)="openCreate()" [disabled]="!budgets().length">{{ direction() === 'income' ? 'Ajouter une entrée' : 'Ajouter une charge' }}</button>
          }
        </bpm-state>
        @if (reg.data(); as r) {
          @for (g of r.groups; track g.key) {
            <section class="expense-group" [attr.data-flow]="groupFlow()" [attr.aria-labelledby]="'expenses-' + $index">
              <header class="expense-center-heading" data-ui-pattern="section-heading">
                <div>
                  <h2 [id]="'expenses-' + $index">
                    @if (groupBy() === 'center' && g.key && !isNoneGroup(g.key) && g.key !== 'projects') {
                      <a [routerLink]="['/argent/postes', g.key]" [queryParams]="centerQuery()" [attr.aria-label]="'Détail du poste ' + g.label">{{ g.label }}</a>
                    } @else {
                      {{ groupBy() === 'date' ? (g.label | shortDate) : g.label }}
                    }
                  </h2>
                  <p>{{ g.lineIds.length }} échéance(s)</p>
                  @if (groupCap(g.key); as m) {
                    <bpm-cap-gauge [measure]="m" [label]="groupBy() === 'category' ? 'Plafond de la catégorie' : 'Plafond du poste'" />
                  }
                </div>
                <div class="expense-center-total">
                  @if (g.specialCents && !g.plannedCents) {
                    <small>Charges spéciales · non comptées</small><strong>{{ g.specialCents | cents }}</strong>
                  } @else {
                    <small>Total des échéances</small><strong>{{ g.plannedCents | cents }}</strong>
                  }
                </div>
                <p class="expense-center-breakdown">
                  <span>{{ labels().paid }} <strong>{{ g.paidCents | cents }}</strong></span>
                  <span class="expense-pending-total">{{ labels().toPay }} <strong>{{ g.toPayCents | cents }}</strong></span>
                  @if (groupUnrealized(g.lineIds); as u) {
                    <span>Non réalisé <strong>{{ u | cents }}</strong></span>
                  }
                </p>
              </header>
              @for (id of g.lineIds; track id) {
                @if (byId().get(id); as l) {
                  <article class="expense-row" [attr.data-selected]="isSelected(l) || null" [attr.data-status]="rowStatus(l)" data-ui-pattern="panel">
                    <!-- Charge spéciale d'un projet de la vie : elle s'ouvre sur la fiche du projet, pas sur un détail d'échéance. -->
                    <a class="expense-charge-summary" [routerLink]="l.special && l.project ? ['/app/projets', l.project.coreProjectId] : []" [queryParams]="l.special ? null : lineQuery(l)" [queryParamsHandling]="l.special ? '' : 'merge'" [attr.aria-label]="(l.special ? 'Ouvrir le projet : ' : 'Ouvrir le détail : ') + l.label + ', ' + date(l.plannedDate)">
                      <span class="expense-date">
                        <small>Date prévue</small>{{ l.plannedDate | shortDate }}
                        @if (l.realizedDate && l.realizedDate !== l.plannedDate) { <small>{{ l.direction === 'income' ? 'Date de réception' : 'Date de paiement' }} · {{ l.realizedDate | shortDate }}</small> }
                      </span>
                      <span class="expense-main">
                        <strong>{{ l.label }}</strong>
                        <small>
                          @if (groupBy() === 'center') {
                            {{ l.budgetRole === 'life' ? 'Budget du projet de vie' : l.budgetName }}
                          } @else if (l.centerKnown) {
                            {{ l.costCenterLabel }}
                          } @else {
                            <span class="chip warn">Poste à préciser</span>
                          }
                          @if (l.cadence !== 'once') { · {{ l.cadenceLabel }} }
                          @if (l.categoryLabel && groupBy() !== 'category') { · <span class="expense-category-tag">{{ l.categoryLabel }}</span> }
                          @if (l.taskTitle) { · {{ l.taskTitle }} }
                          @if (l.projectCharge) { · Projet de la vie, règlement validé }
                        </small>
                      </span>
                      <span class="expense-amount" [attr.data-flow]="l.direction === 'income' ? 'income' : 'expense'">
                        <strong><span class="expense-flow-sign" aria-hidden="true">{{ l.direction === 'income' ? '↑' : '↓' }}</span> {{ amountOf(l) | cents }}</strong>
                        @if (l.settled && l.realizedCents !== null && l.realizedCents !== l.plannedCents) { <small>Montant prévu · {{ l.plannedCents | cents }}</small> }
                      </span>
                      <span class="expense-state">{{ l.statusLabel }}</span>
                    </a>
                  </article>
                }
              }
            </section>
          }
        }
      </div>
    </bpm-page>

    @if (editorOpen() && budgets().length) {
      <bpm-operation-editor [budgets]="budgets()" [line]="editing()" [defaults]="createDefaults()" (closed)="closeEditor()" (saved)="onSaved($event)" />
    } @else if (selectedId()) {
      <bpm-line-detail [lineId]="selectedId()!" [period]="ctx.period()" (closed)="closeDetail()" (edit)="openEdit($event)" />
    }
  `,
  styles: `
    :host { display: block; }
    .expense-direction { display: grid; gap: var(--ecart-8); align-content: start; }
    .expense-search-help { grid-column: 1 / -1; color: var(--muted); }
    .expense-active-filters { display: flex; flex-wrap: wrap; gap: var(--ecart-6); align-items: center; margin: 0; }
    .expense-active-filters .x { border: 0; background: none; padding: 0 0 0 4px; cursor: pointer; font: inherit; color: inherit; min-height: 0; }
    .expense-group h2 a { color: inherit; text-decoration: none; }
    .expense-group h2 a:hover { text-decoration: underline; }
    .expense-center-heading bpm-cap-gauge { margin-top: var(--ecart-6); }
    .expense-category-tag { display: inline-block; padding: 0 var(--ecart-6); border-radius: var(--radius-pill); background: color-mix(in srgb, var(--app-accent) 10%, var(--raised-surface)); color: var(--app-accent); font-weight: var(--fw-semibold); }
    .expense-caps-alert { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ecart-6) var(--ecart-12); padding: var(--ecart-10) var(--ecart-16); border: 1px solid color-mix(in srgb, var(--status-danger) 40%, var(--line)); border-radius: var(--radius-sm); background: var(--status-danger-surface); color: var(--status-danger); }
    .expense-caps-alert a { margin-left: auto; font-weight: var(--fw-semibold); }
    .expense-caps-item { color: var(--ink); }
  `,
})
export class BpmExpensesPage {
  private bpm = inject(BpmApi);
  private api = inject(Api);
  protected ctx = inject(BpmPageContext);

  protected readonly statuses: LineStatus[] = ['late', 'due', 'pending', 'settled', 'unrealized'];
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly groupKeys = ['center', 'category', 'nature', 'project', 'date'] as const;
  protected readonly natures = NATURES;
  protected readonly natureLabel = CHARGE_NATURE_LABEL;
  protected readonly groupLabel = GROUP_LABEL;
  protected date = shortDate;

  // ---------- paramètres d'URL ----------

  /** Sens : absent = charges (défaut), `income`, `all`. */
  protected direction = computed<'charge' | 'income' | 'all'>(() => {
    const d = this.ctx.query().get('direction');
    return d === 'income' || d === 'all' ? d : 'charge';
  });
  protected groupBy = computed<'center' | 'category' | 'nature' | 'project' | 'date'>(() => {
    const g = this.ctx.query().get('groupBy');
    return g === 'category' || g === 'nature' || g === 'project' || g === 'date' ? g : 'center';
  });
  /** Nature de charge filtrée (indispensable, courante, projet) — lien direct depuis « Gestion du projet de vie ». */
  protected nature = computed<ChargeNature | null>(() => {
    const n = this.ctx.query().get('nature') as ChargeNature | null;
    return n && NATURES.includes(n) ? n : null;
  });
  protected customWindow = computed(() => !!(this.ctx.q('from')() && this.ctx.q('to')()));
  protected windowError = computed(() => {
    const from = this.ctx.q('from')();
    const to = this.ctx.q('to')();
    if ((from && !to) || (!from && to)) return 'Fenêtre incomplète : renseignez les deux dates (la période reste lue en attendant).';
    if (from && to && to < from) return 'La fin de la fenêtre précède son début.';
    return null;
  });
  protected budgetSel = computed(() => (this.ctx.q('scope')() === 'consolidated' && !this.ctx.q('budgetId')() ? '__all__' : this.ctx.q('budgetId')()));
  protected selectedId = computed(() => this.ctx.q('occurrence')() || this.ctx.q('operation')() || null);

  private query = computed<RegisterQuery>(() => {
    const q = this.ctx.query();
    const get = (k: string) => q.get(k) || undefined;
    const dir = this.direction();
    const windowOk = this.customWindow() && !this.windowError();
    return {
      period: this.ctx.period(),
      q: get('q'),
      direction: dir === 'all' ? '' : dir,
      status: get('status') as LineStatus | undefined,
      nature: this.nature() ?? undefined,
      center: get('center'),
      category: get('category'),
      taskId: get('taskId'),
      budgetId: get('budgetId'),
      scope: q.get('scope') === 'consolidated' ? 'consolidated' : undefined,
      groupBy: this.groupBy(),
      ...(windowOk ? { from: get('from'), to: get('to') } : {}),
    };
  });

  // ---------- lectures ----------

  protected reg = bpmLoader(() => this.query(), (q) => this.bpm.register(q));
  private centersRead = bpmLoader(() => 0, () => this.bpm.costCenters());
  /** Catégories (retirées comprises : elles portent encore des dépenses) ; filtrées sur le poste choisi. */
  private categoriesRead = bpmLoader(() => 0, () => this.bpm.categories(true).catch(() => []));
  private tasksRead = bpmLoader(() => 0, () => this.api.tasks().catch(() => []));

  protected budgets = computed(() => this.reg.data()?.context.budgets ?? []);
  protected byId = computed(() => new Map((this.reg.data()?.lines ?? []).map((l) => [l.id, l] as const)));
  protected centerOptions = computed(() => {
    const dir = this.direction();
    return (this.centersRead.data() ?? []).filter((c) => dir === 'all' || c.direction === dir);
  });
  protected categoryOptions = computed(() => {
    const center = this.ctx.q('center')();
    return (this.categoriesRead.data() ?? []).filter((k) => !center || center === '__none__' || k.costCenterRef === center);
  });
  /** Plafond d'un groupe (poste ou catégorie) quand le registre lit une période du budget de vie. */
  protected groupCap(key: string) {
    const caps = this.reg.data()?.caps;
    if (!caps || this.direction() === 'income') return null;
    const m = this.groupBy() === 'center' ? caps.centers[key] : this.groupBy() === 'category' ? caps.categories[key] : null;
    return m && m.capCents !== null ? m : null;
  }
  /** Plafonds dépassés de la période, centres puis catégories (lus indépendamment). */
  protected overCaps = computed(() =>
    this.direction() === 'income' ? [] : overCapsOf(this.reg.data()?.caps, (ref) => (this.centersRead.data() ?? []).find((c) => c.ref === ref)?.label),
  );
  protected taskOptions = computed(() => {
    const projects = new Set(this.budgets().filter((b) => b.role === 'standard').map((b) => b.coreProjectId));
    return (this.tasksRead.data() ?? []).filter((t) => t.task.projectId && projects.has(t.task.projectId)).map((t) => ({ id: t.task.id, title: t.task.title }));
  });

  protected labels = computed(() => {
    const d = this.direction();
    return d === 'income' ? { paid: 'Reçu', toPay: 'À recevoir' } : d === 'all' ? { paid: 'Réglé', toPay: 'À régler' } : { paid: 'Payé', toPay: 'À payer' };
  });

  /** Phrase du bandeau (source : « Vos charges, payées et à venir. »), selon le sens lu. */
  protected lead = computed(() => {
    const d = this.direction();
    return d === 'income' ? 'Vos entrées, reçues et à venir.' : d === 'all' ? 'Vos entrées et charges, réglées et à venir.' : 'Vos charges, payées et à venir.';
  });
  protected notes = computed(() => {
    const d = this.direction();
    if (d === 'income') return { paid: 'Montants reçus des entrées prévues sur cette période.', toPay: 'Entrées prévues, pas encore reçues.', unrealized: 'Entrées restées sans réception à la clôture.' };
    if (d === 'all') return { paid: 'Règlements des échéances prévues sur cette période.', toPay: 'Échéances prévues, sans règlement enregistré.', unrealized: 'Échéances restées sans règlement à la clôture.' };
    return { paid: 'Règlements des charges prévues sur cette période.', toPay: 'Charges prévues, sans paiement enregistré.', unrealized: 'Charges restées sans paiement à la clôture.' };
  });
  protected listTitle = computed(() => {
    const g = this.groupBy();
    if (g === 'project') return 'Par projet';
    if (g === 'nature') return 'Par nature : indispensables, courantes et projets';
    if (g === 'date') return 'Par date prévue';
    if (g === 'category') return 'Dépenses par catégorie';
    const d = this.direction();
    return d === 'income' ? 'Entrées par poste' : d === 'all' ? 'Échéances par poste' : 'Dépenses par poste';
  });
  /** Montant d'une échéance : réel une fois réglée, sinon prévu. */
  protected amountOf(l: RegisterLine) {
    return l.settled && l.realizedCents !== null ? l.realizedCents : l.plannedCents;
  }
  /** Prévu des échéances non réalisées d'un groupe (0 = rien à afficher). */
  protected groupUnrealized(ids: string[]) {
    const map = this.byId();
    return ids.reduce((sum, id) => {
      const l = map.get(id);
      return l && l.status === 'unrealized' ? sum + l.plannedCents : sum;
    }, 0);
  }

  /** Filtres actifs du panneau Affiner, avec un libellé lisible. */
  protected activeRefine = computed(() => {
    const q = this.ctx.query();
    const out: { key: string; label: string }[] = [];
    const status = q.get('status') as LineStatus | null;
    if (status) out.push({ key: 'status', label: `État : ${STATUS_LABEL[status] ?? status}` });
    const nature = this.nature();
    if (nature) out.push({ key: 'nature', label: `Nature : ${CHARGE_NATURE_LABEL[nature]}` });
    const center = q.get('center');
    if (center) out.push({ key: 'center', label: center === '__none__' ? 'Poste à préciser' : `Poste : ${(this.centersRead.data() ?? []).find((c) => c.ref === center)?.label ?? center}` });
    const category = q.get('category');
    if (category) out.push({ key: 'category', label: category === NO_CATEGORY ? 'Sans catégorie' : `Catégorie : ${(this.categoriesRead.data() ?? []).find((k) => k.id === category)?.label ?? category}` });
    const task = q.get('taskId');
    if (task) out.push({ key: 'taskId', label: `Tâche : ${this.taskOptions().find((t) => t.id === task)?.title ?? task}` });
    const budgetId = q.get('budgetId');
    if (budgetId) out.push({ key: 'budgetId', label: `Budget : ${this.budgets().find((b) => b.id === budgetId)?.name ?? budgetId}` });
    else if (q.get('scope') === 'consolidated') out.push({ key: 'scope', label: 'Tous les projets' });
    if (q.get('from') || q.get('to')) out.push({ key: 'from', label: `Fenêtre ${shortDate(q.get('from'))} → ${shortDate(q.get('to'))}` });
    return out;
  });
  protected refineOpen = signal(REFINE_KEYS.some((k) => !!this.ctx.query().get(k)));

  protected emptyText = computed(() => {
    const r = this.reg.data();
    if (r && r.totals.unfilteredCount > 0) return `Aucune ligne ne correspond aux filtres (${r.totals.unfilteredCount} ligne(s) dans la fenêtre).`;
    return this.direction() === 'income' ? 'Aucune entrée prévue dans cette fenêtre. Les zéros affichés sont connus.' : 'Aucune charge prévue dans cette fenêtre. Les zéros affichés sont connus.';
  });

  // ---------- lien profond vers une ligne ----------

  protected isSelected = (l: RegisterLine) => {
    const id = this.selectedId();
    return !!id && (l.id === id || l.occurrenceKey === id || l.operationId === id);
  };
  protected missing = computed(() => {
    const id = this.selectedId();
    const r = this.reg.data();
    if (!id || !r || this.reg.loading()) return false;
    return !r.lines.some((l) => this.isSelected(l));
  });
  protected missingLine = bpmLoader(
    () => (this.missing() ? { id: this.selectedId()!, period: this.ctx.period() } : null),
    (k) => (k ? this.bpm.line(k.id, k.period) : Promise.resolve(null)),
  );
  /** Raisons factuelles de l'absence, déduites des filtres actifs et de la ligne lue. */
  protected missingReasons = computed(() => {
    const d = this.missingLine.data();
    const r = this.reg.data();
    if (!d || !r) return [];
    const l = d.line;
    const q = this.query();
    const out: string[] = [];
    if (l.plannedDate < r.window.from || l.plannedDate > r.window.to) out.push(`sa date prévue est hors de la fenêtre lue (${shortDate(r.window.from)} – ${shortDate(r.window.to)}) ;`);
    if (q.direction && l.direction !== q.direction) out.push(`le sens affiché est « ${q.direction === 'income' ? 'Entrées' : 'Charges'} » ;`);
    if (q.status && l.status !== q.status) out.push(`le filtre d'état est « ${STATUS_LABEL[q.status as LineStatus]} » ;`);
    if (q.nature && l.nature !== q.nature) out.push(l.nature ? `sa nature est « ${CHARGE_NATURE_LABEL[l.nature]} », le filtre lit « ${CHARGE_NATURE_LABEL[q.nature]} » ;` : 'le filtre de nature ne retient que des charges ;');
    if (q.center && (q.center === '__none__' ? l.centerKnown : l.costCenterRef !== q.center)) out.push('le filtre de centre l’exclut ;');
    if (q.category && (q.category === NO_CATEGORY ? !!l.categoryId : l.categoryId !== q.category)) out.push('le filtre de catégorie l’exclut ;');
    if (q.taskId && l.taskId !== q.taskId) out.push('le filtre de tâche l’exclut ;');
    if (q.budgetId ? l.budgetId !== q.budgetId : q.scope !== 'consolidated' && l.budgetRole !== 'life') out.push('elle appartient à un autre Budget que celui lu ;');
    if (q.q) out.push(`la recherche « ${q.q} » est active ;`);
    return out;
  });

  protected lineQuery(l: RegisterLine) {
    return { operation: l.operationId ?? (l.occurrenceKey ? null : l.id), occurrence: l.occurrenceKey ?? null };
  }
  protected centerQuery() {
    return { ...this.ctx.carry(), from: 'depenses' };
  }
  protected isNoneGroup(key: string) {
    const l = this.reg.data()?.lines.find((x) => x.costCenterRef === key);
    return !!l && !l.centerKnown;
  }

  // ---------- recherche (debounce, remplace l'entrée d'historique) ----------

  protected search = linkedSignal(() => this.ctx.q('q')());
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  protected onSearch(value: string) {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.ctx.setQuery({ q: value.trim() ? value : null }, { replace: true }), 300);
  }

  // ---------- filtres ----------

  protected setDirection(d: 'charge' | 'income' | 'all') {
    // Le centre filtré dépend du sens : il est retiré s'il n'existe pas dans le nouveau sens.
    const center = this.ctx.q('center')();
    const keep = !center || center === '__none__' || d === 'all' || (this.centersRead.data() ?? []).some((c) => c.ref === center && c.direction === d);
    // Les catégories ne classent que des charges.
    this.ctx.setQuery({ direction: d === 'charge' ? null : d, ...(keep ? {} : { center: null }), ...(d === 'income' ? { category: null } : {}) });
  }
  /** Une catégorie ne classe que des charges : la choisir ramène le sens sur « Charges ». */
  protected setCategory(id: string) {
    this.ctx.setQuery(id ? { category: id, direction: this.direction() === 'all' ? 'all' : null } : { category: null });
  }
  /** Une nature ne classe que des charges : la choisir ramène le sens sur « Charges ». */
  protected setNature(n: string) {
    this.ctx.setQuery(n ? { nature: n, direction: null } : { nature: null });
  }
  protected setGroup(g: string) {
    this.ctx.setQuery({ groupBy: g === 'center' ? null : g });
  }
  /** Teinte du groupe : entrées en vert, charges en rouge, vue « Tout » neutre. */
  protected groupFlow = computed(() => (this.direction() === 'income' ? 'income' : this.direction() === 'charge' ? 'expense' : null));
  /** État source de la ligne : réglée = « recorded », ouverte = « pending », sinon non réalisée. */
  protected rowStatus(l: RegisterLine) {
    return l.status === 'settled' ? 'recorded' : l.status === 'unrealized' || l.status === 'project' ? 'unrealized' : 'pending';
  }
  protected setBudget(v: string) {
    if (v === '__all__') this.ctx.setQuery({ budgetId: null, scope: 'consolidated' });
    else this.ctx.setQuery({ budgetId: v || null, scope: null });
  }
  protected setWindow(k: 'from' | 'to', v: string) {
    this.ctx.setQuery({ [k]: v || null });
  }
  protected clearOne(key: string) {
    return key === 'from' ? { from: null, to: null } : { [key]: null };
  }
  protected clearRefine() {
    this.ctx.setQuery(Object.fromEntries(REFINE_KEYS.map((k) => [k, null])));
  }
  protected clearAll() {
    clearTimeout(this.searchTimer);
    this.ctx.setQuery({ ...Object.fromEntries(REFINE_KEYS.map((k) => [k, null])), q: null, direction: 'all' });
  }
  /** Lecture libre centrée sur la date prévue de la ligne demandée (sans changer le cycle). */
  protected showDate(d: string) {
    this.ctx.setQuery({ ...Object.fromEntries(REFINE_KEYS.map((k) => [k, null])), q: null, direction: 'all', from: d, to: d });
  }

  // ---------- détail et éditeur ----------

  protected editorOpen = signal(false);
  protected editing = signal<RegisterLine | null>(null);
  protected message = signal<string | null>(null);

  protected createDefaults = computed<Partial<EntryInput>>(() => {
    const center = this.ctx.q('center')();
    const budgetId = this.ctx.q('budgetId')();
    const dir: Direction = this.direction() === 'income' ? 'income' : 'charge';
    // Une catégorie filtrée préremplit la saisie (et son poste) : la nouvelle dépense se range directement dedans.
    const k = (this.categoriesRead.data() ?? []).find((x) => x.id === this.ctx.q('category')() && !x.archived);
    return {
      direction: dir,
      ...(center && center !== '__none__' ? { costCenterRef: center } : {}),
      ...(k && dir === 'charge' ? { categoryId: k.id, costCenterRef: k.costCenterRef } : {}),
      ...(budgetId ? { budgetId } : {}),
    };
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
  protected closeDetail() {
    this.ctx.setQuery({ operation: null, occurrence: null }, { replace: true });
  }

  protected readonly fmt = cents;
}
