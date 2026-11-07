import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, ApiError, newRequestKey, RecetteContext, toApiError } from '../core/api.service';
import { BudgetObject, CostCenter, Direction, Operation } from '../core/models';
import { EurosPipe, parseAmount } from '../core/format';
import { AppHeroComponent, HeroChip } from '../shared/app-hero.component';
import { injectPageWorkspace } from '../shared/page-workspace';

interface OperationForm {
  budgetId: string;
  direction: Direction;
  label: string;
  amount: string;
  date: string;
  status: 'planned' | 'realized';
  costCenterRef: string;
}

/** Interface de test du niveau 2 (Budget Management) : lecture brute et commandes du middleware. */
@Component({
  selector: 'app-budget-test',
  imports: [JsonPipe, RouterLink, EurosPipe, AppHeroComponent],
  styleUrl: './budget-test.scss',
  template: `
    <div class="page page-wide budget-page">
      <!-- En-tête de la référence (rjs-app-hero, ambiance Budget) : la coquille le fige sous la barre du haut. -->
      <rjs-app-hero
        tone="indigo"
        headingId="budget-test-title"
        kicker="Budget Management · Interface de test (niveau 2)"
        [title]="workspace()?.title ?? 'Budget — middleware'"
        [lead]="workspace()?.lead ?? 'Lecture brute des Budgets, opérations et centres de coût du user actif. Les commandes appellent directement le middleware (hors parcours applicatif BPM).'"
        [chips]="chips()"
        [result]="createError() || realizeError() ? { message: (createError() ?? realizeError())!.message, tone: 'danger' } : created() ? { message: 'Opération créée. Le Budget sélectionné a été relu.', tone: 'success' } : null"
        toolsLabel="Commandes du middleware"
      >
        <button heroActions type="button" class="app-hero-action" (click)="load()" [disabled]="!ctx.userId()">Relire</button>
        <ng-container heroActions>
        @if (!workspace()) {
          <a heroActions class="app-hero-action is-secondary" routerLink="/socle/budget/operations" [queryParams]="{ budget: selectedId() }">Gérer les opérations</a>
          <a heroActions class="app-hero-action is-secondary" routerLink="/socle/budget/centres">Centres de coût</a>
        }
        </ng-container>
        @if (workspace()?.key === 'budget-operations') {
          <button heroPrimary type="button" class="app-hero-action" (click)="create()" [disabled]="busy() || !budgets().length">{{ busy() ? 'Envoi…' : 'Créer l’opération saisie' }}</button>
        }
        @if (workspace()?.key === 'budget-operations') {
          <label heroTools class="adm-hero-field">Budget
            <select [value]="selectedId() ?? ''" (change)="select($any($event.target).value); patch({ budgetId: $any($event.target).value })">
              @for (b of budgets(); track b.id) { <option [value]="b.id" [selected]="selectedId() === b.id">{{ b.name }} · {{ b.role }}</option> }
            </select>
          </label>
        }
      </rjs-app-hero>

      @if (!ctx.userId()) {
        <section class="plan-empty" role="status">
          <p>Choisir un user de test dans l'en-tête : les lectures du middleware sont propres à un user.</p>
        </section>
      } @else {
        <section class="budget-workspace" aria-labelledby="budget-test-title">
          @if (loadError(); as e) {
            <div class="bw-feedback" data-tone="danger" role="alert"><strong>{{ e.body.code }}</strong> — {{ e.message }}<pre>{{ e.body.details | json }}</pre></div>
          }

          @if (!workspace()) {
          <div class="bw-manager-toolbar">
            <p>Choisissez un Budget, relisez ses valeurs enregistrées, puis testez les commandes du middleware.</p>
            <div class="bw-actions">
              <a class="btn btn-secondary" routerLink="/socle/budget/centres">Centres de coût</a>
              <a class="btn btn-primary" routerLink="/socle/budget/operations" [queryParams]="{ budget: selectedId() }">＋ Gérer les opérations</a>
            </div>
          </div>

          <section class="bw-manager-columns" id="budget-manage" aria-label="Éléments et valeurs enregistrées">
            <section class="bw-section bw-manager-list-panel" aria-labelledby="budget-test-list-title">
              <div class="bw-section-head">
                <div>
                  <h2 id="budget-test-list-title">Budgets enregistrés <span>(objets du middleware)</span></h2>
                  <p>Sélectionnez un Budget pour relire ses valeurs et ses opérations.</p>
                </div>
                <strong class="bw-manager-count">{{ budgets().length }}</strong>
              </div>
              @if (budgets().length) {
                <div class="bw-manager-list-scroll" tabindex="0" aria-label="Liste des Budgets">
                  @for (group of budgetGroups(); track group.id) {
                    <section class="bw-manager-core-group" [attr.aria-label]="'Projet du noyau : ' + group.title">
                      <h3>Projet du noyau <strong>{{ group.title }}</strong><span>{{ group.budgets.length }} budget(s)</span></h3>
                      <ul class="bw-manager-list">
                        @for (b of group.budgets; track b.id) {
                          <li>
                            <button
                              type="button"
                              (click)="select(b.id)"
                              [class.is-selected]="selectedId() === b.id"
                              [attr.aria-pressed]="selectedId() === b.id"
                            >
                              <span>
                                <strong>{{ b.name }}</strong>
                                <small>{{ b.operationCount }} opération(s) · {{ b.realizedCount }} réalisée(s) · rév. {{ b.revision }}</small>
                                <span class="bw-badge" [attr.data-tone]="b.role === 'life' ? 'success' : 'neutral'">{{ b.role }}</span>
                              </span>
                              <span aria-hidden="true">→</span>
                            </button>
                          </li>
                        }
                      </ul>
                    </section>
                  }
                </div>
              } @else {
                <div class="bw-empty bw-manager-empty">
                  <strong>Aucun Budget pour le moment.</strong>
                  <p>Le middleware ne renvoie aucun Budget pour ce user.</p>
                </div>
              }
            </section>

            <section class="bw-section bw-manager-detail-panel" aria-labelledby="budget-test-detail-title">
              @if (selected(); as s) {
                <header class="bw-manager-detail-head">
                  <h2 id="budget-test-detail-title">Élément enregistré : <span>(budget {{ s.budget.role }})</span></h2>
                  <h3>{{ s.budget.name }}</h3>
                  <small>Référence : {{ s.budget.id }}</small>
                  <p class="bw-manager-link-path">
                    <a [routerLink]="['/object-management']" [queryParams]="{ inspect: s.budget.coreProjectId }">{{ s.budget.projectTitle ?? 'Projet du noyau' }}</a>
                    <span aria-hidden="true">→</span>
                    <a [routerLink]="['/object-management']" [queryParams]="{ inspect: s.budget.id }">{{ s.budget.name }}</a>
                  </p>
                </header>
                <div class="bw-manager-detail-scroll" tabindex="0" [attr.aria-label]="'Valeurs du Budget ' + s.budget.name">
                  <section class="bw-manager-characteristics">
                    <h3>Caractéristiques enregistrées</h3>
                    <dl class="bw-manager-fields">
                      <div><dt>ID</dt><dd><code>{{ s.budget.id }}</code></dd></div>
                      <div><dt>Rôle</dt><dd>{{ s.budget.role }}</dd></div>
                      <div><dt>Projet noyau</dt><dd>{{ s.budget.projectTitle ?? '—' }}<br /><code>{{ s.budget.coreProjectId }}</code></dd></div>
                      <div><dt>Budget père</dt><dd>{{ s.budget.parentBudgetName ?? '—' }}<br /><code>{{ s.budget.parentBudgetId ?? 'null' }}</code></dd></div>
                      <div><dt>Opérations</dt><dd>{{ s.budget.operationCount }}</dd></div>
                      <div><dt>Réalisées</dt><dd>{{ s.budget.realizedCount }}</dd></div>
                      <div><dt>Révision</dt><dd>{{ s.budget.revision }}</dd></div>
                    </dl>
                  </section>
                  <details class="budget-test-json app-disclosure">
                    <summary>JSON brut du Budget</summary>
                    <pre>{{ s.budget | json }}</pre>
                  </details>
                </div>
                <a class="btn btn-secondary bw-manager-open" [routerLink]="['/object-management']" [queryParams]="{ inspect: s.budget.id }">
                  Inspecter l’objet
                  <span aria-hidden="true">↗</span>
                </a>
              } @else {
                <div class="bw-empty bw-manager-detail-empty">
                  <h2 id="budget-test-detail-title">Élément enregistré : (budget)</h2>
                  <strong>Choisissez un élément</strong>
                  <p>Ses valeurs brutes et ses opérations apparaîtront ici.</p>
                </div>
              }
            </section>
          </section>
          }

          @if (workspace()?.key !== 'budget-centers') {
          @if (selected(); as s) {
            <section class="bw-section" aria-labelledby="budget-test-operations-title">
              <div class="bw-section-head">
                <div>
                  <h2 id="budget-test-operations-title">Opérations du Budget <span>« {{ s.budget.name }} »</span></h2>
                  <p>Valeurs brutes du middleware ; une opération prévue peut être réalisée ici.</p>
                </div>
                <strong class="bw-manager-count">{{ s.operations.length }}</strong>
              </div>
              @if (realizeError(); as e) {
                <div class="bw-feedback" data-tone="danger" role="alert">
                  <strong>{{ e.body.code }}</strong> — {{ e.message }}<pre>{{ e.body.details | json }}</pre>
                  @if (e.isConflict) {
                    <button type="button" class="btn btn-secondary" (click)="select(s.budget.id)">Relire les opérations</button>
                  }
                </div>
              }
              @for (o of s.operations; track o.id) {
                <article class="budget-list-card" [class.is-selected]="realizingId() === o.id">
                  <div>
                    <span class="budget-tag" [attr.data-kind]="o.direction === 'income' ? 'income' : null">{{ o.direction }} · {{ o.directionLabel }}</span>
                    <h4>
                      <a [routerLink]="['/object-management']" [queryParams]="{ inspect: o.id }">{{ o.label }}</a>
                    </h4>
                    <p>
                      Centre <code>{{ o.costCenterRef }}</code>{{ o.costCenterLabel ? ' · ' + o.costCenterLabel : '' }}
                      · Provenance <code>{{ o.provenance.command }}</code>
                      @if (o.provenance.requestKey) {
                        · <code>{{ o.provenance.requestKey }}</code>
                      }
                    </p>
                    <small>
                      <code>{{ o.id }}</code> · rév. {{ o.revision }} · {{ o.date }} · prévu <code>{{ o.amountCents }}</code> centimes ·
                      réalisé <code>{{ o.realizedAmountCents ?? 'null' }}</code> centimes · date réalisée {{ o.realizedDate ?? '—' }}
                    </small>
                    @if (o.status === 'planned' && realizingId() === o.id) {
                      <form class="budget-form-inline budget-test-realize" (submit)="$event.preventDefault(); realize(o)" [attr.aria-busy]="busy()">
                        <label>Montant réalisé (€)<input [value]="realizedAmount()" (input)="realizedAmount.set($any($event.target).value)" inputmode="decimal" [placeholder]="'' + o.amount" /></label>
                        <label>Date réalisée<input type="date" [value]="realizedDate()" (input)="realizedDate.set($any($event.target).value)" /></label>
                        <button class="btn btn-primary" type="submit" [disabled]="busy()">Réaliser</button>
                        <button class="btn btn-secondary" type="button" (click)="realizingId.set(null)">Annuler</button>
                      </form>
                    }
                  </div>
                  <div class="budget-list-card-side">
                    <strong>{{ o.amount | euros }}</strong>
                    <span class="bw-badge" [attr.data-tone]="o.status === 'realized' ? 'success' : 'neutral'">{{ o.status }}</span>
                    <span>{{ o.realizedAmount === null ? 'Non réalisé' : 'Réalisé ' + (o.realizedAmount | euros) }}</span>
                    @if (o.status === 'planned' && realizingId() !== o.id) {
                      <button class="text-link" type="button" [attr.aria-label]="'Réaliser l’opération ' + o.label + ' (' + o.id + ')'" (click)="startRealize(o)">Réaliser…</button>
                    }
                  </div>
                </article>
              } @empty {
                <p class="budget-empty-copy">Aucune opération sur ce Budget.</p>
              }
            </section>
          }
          }

          <div class="bw-foundations" [class.is-specialized]="!!workspace()">
            @if (workspace()?.key !== 'budget-centers') {
            <section class="bw-section" id="budget-test-create" #createSection aria-labelledby="budget-test-create-title">
              <div class="bw-section-head">
                <div>
                  <h2 id="budget-test-create-title">Créer une opération <span>(test brut)</span></h2>
                  <p>La commande est envoyée telle quelle au middleware ; l'API reste juge des règles.</p>
                </div>
              </div>
              <form class="bw-manager-config" (submit)="$event.preventDefault(); create()" [attr.aria-busy]="busy()">
                <div class="bw-manager-config-grid">
                  <label class="bw-manager-config-wide">
                    <span>Budget (budgetId)</span>
                    <select [value]="form().budgetId" (change)="patch({ budgetId: $any($event.target).value })">
                      @for (b of budgets(); track b.id) {
                        <option [value]="b.id" [selected]="form().budgetId === b.id">{{ b.name }} · {{ b.role }} · {{ b.id }}</option>
                      }
                    </select>
                  </label>
                  <label>
                    <span>Sens (direction)</span>
                    <select [value]="form().direction" (change)="patch({ direction: $any($event.target).value, costCenterRef: '' })">
                      <option value="charge">charge</option>
                      <option value="income">income</option>
                    </select>
                  </label>
                  <label>
                    <span>Statut</span>
                    <select [value]="form().status" (change)="patch({ status: $any($event.target).value })">
                      <option value="planned">planned</option>
                      <option value="realized">realized</option>
                    </select>
                  </label>
                  <label class="bw-manager-config-wide">
                    <span>Libellé</span>
                    <input [value]="form().label" (input)="patch({ label: $any($event.target).value })" maxlength="200" />
                  </label>
                  <label>
                    <span>Montant (€)</span>
                    <input [value]="form().amount" (input)="patch({ amount: $any($event.target).value })" inputmode="decimal" />
                  </label>
                  <label>
                    <span>Date</span>
                    <input type="date" [value]="form().date" (input)="patch({ date: $any($event.target).value })" />
                  </label>
                  <label class="bw-manager-config-wide">
                    <span>Centre de coût (costCenterRef)</span>
                    <select [value]="form().costCenterRef" (change)="patch({ costCenterRef: $any($event.target).value })">
                      <option value="">— choisir —</option>
                      @for (c of centersForDirection(); track c.ref) {
                        <option [value]="c.ref">{{ c.label }} · {{ c.ref }}</option>
                      }
                    </select>
                  </label>
                </div>
                <small class="field-hint">Clé de demande : <code>{{ requestKey }}</code> (conservée pour toute nouvelle tentative, renouvelée après succès).</small>
                @if (createError(); as e) {
                  <div class="bw-feedback" data-tone="danger" role="alert"><strong>{{ e.body.code }}</strong> — {{ e.message }}<pre>{{ e.body.details | json }}</pre></div>
                }
                @if (created(); as c) {
                  <pre class="budget-test-created" role="status">{{ c | json }}</pre>
                }
                <div class="bw-manager-config-actions">
                  <button class="btn btn-primary" type="submit" [disabled]="busy() || !budgets().length">{{ busy() ? 'Envoi…' : 'Créer l’opération' }}</button>
                </div>
              </form>
            </section>
            }

            @if (workspace()?.key !== 'budget-operations') {
            <section class="bw-section" #centersSection aria-labelledby="budget-test-centers-title">
              <div class="bw-section-head">
                <div>
                  <h2 id="budget-test-centers-title">Centres de coût</h2>
                  <p>Centres standards et centres propres au user, par sens.</p>
                </div>
                <strong class="bw-manager-count">{{ costCenters().length }}</strong>
              </div>
              @for (c of costCenters(); track c.ref) {
                <article class="budget-list-card">
                  <div>
                    <span class="budget-tag" [attr.data-kind]="c.direction === 'income' ? 'income' : null">{{ c.direction }} · {{ c.directionLabel }}</span>
                    <h4>{{ c.label }}</h4>
                    <small>Réf. <code>{{ c.ref }}</code></small>
                  </div>
                  <div class="budget-list-card-side">
                    <strong>{{ c.standard ? 'Standard' : 'Propre au user' }}</strong>
                    @if (c.id) {
                      <a class="text-link" [routerLink]="['/object-management']" [queryParams]="{ inspect: c.id }"><code>{{ c.id }}</code></a>
                    } @else {
                      <span>Clé <code>{{ c.key ?? '—' }}</code></span>
                    }
                  </div>
                </article>
              } @empty {
                <p class="budget-empty-copy">Aucun centre de coût.</p>
              }
            </section>
            }
          </div>
        </section>
      }
    </div>
  `,
})
export class BudgetTest {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  protected ctx = inject(RecetteContext);
  protected workspace = injectPageWorkspace();

  protected budgets = signal<BudgetObject[]>([]);
  protected costCenters = signal<CostCenter[]>([]);
  protected selectedId = signal<string | null>(null);
  protected selected = signal<{ budget: BudgetObject; operations: Operation[] } | null>(null);
  protected loadError = signal<ApiError | null>(null);

  protected form = signal<OperationForm>({ budgetId: '', direction: 'charge', label: '', amount: '', date: new Date().toISOString().slice(0, 10), status: 'planned', costCenterRef: '' });
  protected requestKey = newRequestKey();
  protected busy = signal(false);
  protected createError = signal<ApiError | null>(null);
  protected created = signal<unknown>(null);

  protected realizingId = signal<string | null>(null);
  protected realizedAmount = signal('');
  protected realizedDate = signal('');
  protected realizeError = signal<ApiError | null>(null);

  /** Pastilles du bandeau : volumes lus, sans calcul métier. */
  protected chips = computed<HeroChip[]>(() => {
    if (!this.ctx.userId()) return [];
    const s = this.selected();
    return [
      { label: 'Budgets', value: String(this.budgets().length) },
      { label: 'Centres de coût', value: String(this.costCenters().length) },
      ...(s ? [{ label: 'Budget lu', value: s.budget.name }] : []),
    ];
  });

  /** Budgets regroupés par projet du noyau, comme la liste Manager de la référence (aucun calcul métier). */
  protected budgetGroups = computed(() => {
    const groups = new Map<string, { id: string; title: string; budgets: BudgetObject[] }>();
    for (const b of this.budgets()) {
      const group = groups.get(b.coreProjectId) ?? { id: b.coreProjectId, title: b.projectTitle ?? 'Projet noyau sans titre', budgets: [] };
      group.budgets.push(b);
      groups.set(b.coreProjectId, group);
    }
    return [...groups.values()];
  });

  protected centersForDirection = computed(() => this.costCenters().filter((c) => c.direction === this.form().direction));

  constructor() {
    effect(() => {
      const userId = this.ctx.userId();
      untracked(() => {
        this.selected.set(null);
        this.selectedId.set(null);
        if (userId) this.load();
      });
    });
  }

  patch(p: Partial<OperationForm>) {
    this.form.update((f) => ({ ...f, ...p }));
  }

  async load() {
    this.loadError.set(null);
    try {
      const [budgets, centers] = await Promise.all([this.api.budgets(), this.api.budgetCostCenters()]);
      this.budgets.set(budgets);
      this.costCenters.set(centers);
      if (!budgets.some((b) => b.id === this.form().budgetId)) this.patch({ budgetId: budgets[0]?.id ?? '' });
      const sel = this.selectedId() ?? this.route.snapshot.queryParamMap.get('budget');
      if (sel && budgets.some((b) => b.id === sel)) await this.select(sel);
      else if (budgets[0]) await this.select(budgets[0].id);
    } catch (err) {
      this.loadError.set(toApiError(err));
    }
  }

  async select(id: string) {
    this.selectedId.set(id);
    if (this.route.snapshot.queryParamMap.get('budget') !== id) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: { budget: id }, queryParamsHandling: 'merge', replaceUrl: true });
    }
    if (this.workspace()?.key === 'budget-operations') this.patch({ budgetId: id });
    this.realizeError.set(null);
    try {
      this.selected.set(await this.api.budget(id));
    } catch (err) {
      this.loadError.set(toApiError(err));
    }
  }

  private local(message: string, field: string) {
    this.createError.set(new ApiError(400, { code: 'VALIDATION', action: 'local', message, details: { field } }));
  }

  async create() {
    const f = this.form();
    this.createError.set(null);
    this.created.set(null);
    const amount = parseAmount(f.amount);
    // Contrôle minimal côté test : l'API reste juge (les erreurs sont affichées brutes).
    if (amount === 'invalid' || amount === null) return this.local('Montant en euros attendu (ex. 12,50).', 'amount');
    this.busy.set(true);
    try {
      const r = await this.api.createBudgetOperation({
        requestKey: this.requestKey,
        budgetId: f.budgetId,
        direction: f.direction,
        label: f.label,
        amount,
        date: f.date,
        status: f.status,
        costCenterRef: f.costCenterRef,
      });
      this.created.set(r);
      this.requestKey = newRequestKey();
      await this.load();
      if (r.operation?.budgetId) await this.select(r.operation.budgetId);
    } catch (err) {
      this.createError.set(toApiError(err));
    } finally {
      this.busy.set(false);
    }
  }

  startRealize(o: Operation) {
    this.realizingId.set(o.id);
    this.realizedAmount.set('');
    this.realizedDate.set('');
    this.realizeError.set(null);
  }

  async realize(o: Operation) {
    this.realizeError.set(null);
    const body: { expectedRevision: number; realizedAmount?: number; realizedDate?: string } = { expectedRevision: o.revision };
    const amount = parseAmount(this.realizedAmount());
    if (amount === 'invalid') {
      this.realizeError.set(new ApiError(400, { code: 'VALIDATION', action: 'local', message: 'Montant réalisé invalide.', details: { field: 'realizedAmount' } }));
      return;
    }
    if (amount !== null) body.realizedAmount = amount;
    if (this.realizedDate()) body.realizedDate = this.realizedDate();
    this.busy.set(true);
    try {
      await this.api.realizeBudgetOperation(o.id, body);
      this.realizingId.set(null);
      await this.load();
    } catch (err) {
      this.realizeError.set(toApiError(err));
    } finally {
      this.busy.set(false);
    }
  }
}
