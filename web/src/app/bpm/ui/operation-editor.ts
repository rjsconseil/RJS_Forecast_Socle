import { BpmDrafts, DraftHandle } from './drafts';
import { BpmFormActions } from './form-actions';
import { Component, computed, DestroyRef, effect, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, ApiError, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmBudgetRef, Cadence, Direction, EntryInput, EntryPreview, RegisterLine } from '../../core/bpm-models';
import { CapPreview, ChargeCategory } from '../../core/bpm-caps.models';
import { CentsPipe, parseAmount, signedCents } from '../../core/format';
import { ModalComponent } from '../../shared/modal.component';
import { capAlertText, withCapAlerts } from './caps';
import { BpmRefresh, newRequestKey } from './page-context';

let editorId = 0;

type CenterOption = { ref: string; label: string; direction: Direction; standard: boolean };

/**
 * Éditeur d'opération partagé par toutes les pages BPM : Budget cible, entrée/charge, libellé,
 * montant, centre, catégorie facultative (charges), date, cadence, fin facultative, note et tâche éventuelle d'une branche.
 * Création : opération ponctuelle ou définition récurrente, avec aperçu sans mutation.
 * Modification : conserve l'identité de l'opération (ou de la définition récurrente, avec sa portée).
 * Le brouillon est conservé en cas d'erreur ou de conflit.
 * Présentation de la référence : fenêtre `rjs-modal` et vocabulaire de `bpm-flow-editor`
 * (`.fe-form`, étapes `.fe-section-title`, bascule `.bp-toggle`, `.bp-recurrence-switch`, aperçu `.fe-impact`).
 */
@Component({
  selector: 'bpm-operation-editor',
  imports: [BpmFormActions, FormsModule, RouterLink, CentsPipe, ModalComponent],
  styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-vision.page.scss', '../ref-styles/bpm-flow-editor.component.scss', './operation-editor.scss'],
  template: `
    <rjs-modal [open]="true" [headed]="true" [title]="heading()" [busy]="busy()" (closed)="close()">
      <form class="fe-form" data-bpm-frame="form" (ngSubmit)="save()" (input)="draft?.save()" (change)="draft?.save()" novalidate>
        @if (draft?.restored) { <p class="bpm-help" role="status">Votre brouillon a été repris.</p> }
        <p class="bpm-help">Une date, un montant, un poste. Voyez l’effet avant d’enregistrer.</p>
        @if (error(); as e) {
          <div [class]="e.isConflict ? 'bpm-missing' : 'bpm-error'" role="alert">
            <p>{{ e.message }}</p>
            @if (e.isConflict) {
              <p><small>Votre saisie est conservée. Fermez puis rouvrez l'éditeur pour repartir de la version enregistrée.</small></p>
            } @else {
              <p><small>Rien n'a été enregistré ; votre saisie est conservée.</small></p>
            }
          </div>
          @if (fundingIssue(); as f) {
            <section class="fe-impact" aria-label="Financer et enregistrer le règlement">
              <h3>Financer cette dépense ici</h3>
              <p>Cette action accorde la part nécessaire à la tâche, autorise le dépassement indiqué et enregistre le paiement. Vérifiez le montant avant de confirmer.</p>
              @if (f.overrunCents > 0) { <p class="bpm-error">Dépassement à autoriser : {{ f.overrunCents | cents }}.</p> }
              <div class="bpm-actions">
                <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="save(true)">Accorder le nécessaire et enregistrer le paiement</button>
                <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="realized.set(false); error.set(null)">Garder comme dépense prévue</button>
              </div>
            </section>
          }
        }
        @if (scopeNote()) {
          <p class="bpm-missing" role="status">{{ scopeNote() }}</p>
        }

        <h3 class="fe-section-title"><span>01</span>Choisir le projet</h3>
        <div class="fe-selectors">
          <label
            >Projet concerné
            <select name="budgetId" [(ngModel)]="budgetId" [disabled]="editing()">
              @for (b of budgets(); track b.id) {
                <option [value]="b.id">{{ b.role === 'life' ? 'Budget du projet de vie' : b.name + ' (projet de la vie)' }}</option>
              }
            </select></label
          >
        </div>

        <h3 class="fe-section-title"><span>02</span>Renseigner l’opération</h3>
        <div class="fe-controls">
          <div class="bp-toggle" role="radiogroup" aria-label="Sens de l’opération">
            <label [class.is-selected]="direction() === 'income'"
              ><input type="radio" name="direction" value="income" [checked]="direction() === 'income'" [disabled]="editing()" (change)="setDirection('income')" />↑ Entrée</label
            ><label [class.is-selected]="direction() === 'charge'"
              ><input type="radio" name="direction" value="charge" [checked]="direction() === 'charge'" [disabled]="editing()" (change)="setDirection('charge')" />↓ Charge</label
            >
          </div>
          <div class="bp-flow-mode">
            <span [class.is-selected]="cadence() === 'once'">Ponctuel</span
            ><button
              type="button"
              role="switch"
              class="bp-recurrence-switch"
              aria-label="Répéter cette opération automatiquement"
              [attr.aria-checked]="cadence() !== 'once'"
              [disabled]="editing()"
              (click)="toggleCadence()"
            ></button
            ><span [class.is-selected]="cadence() !== 'once'">Récurrent</span>
          </div>
        </div>
        @if (editing() && !isRecurrence()) {
          <p class="fe-explanation">Une opération ponctuelle garde sa nature ; pour un rythme régulier, créez une nouvelle opération récurrente.</p>
        } @else if (isRecurrence()) {
          <p class="fe-explanation">Les règlements déjà enregistrés sont conservés. Un nouveau montant récurrent concerne seulement les échéances non réalisées.</p>
        }
        <div class="fe-fields">
          <label
            >Libellé
            <input
              name="label"
              [(ngModel)]="label"
              maxlength="200"
              required
              [placeholder]="direction() === 'income' ? 'Ex. salaire, remboursement, prime' : 'Ex. loyer, courses, assurance'"
              [attr.aria-invalid]="fieldErr('label') ? 'true' : null"
            />
            @if (fieldErr('label')) {
              <small class="fe-field-error">{{ fieldErr('label') }}</small>
            }
          </label>
          <label
            >{{ cadence() === 'once' ? 'Date prévue' : 'Première échéance' }}
            <input name="date" type="date" [(ngModel)]="date" [attr.aria-invalid]="fieldErr('date') || fieldErr('firstDate') ? 'true' : null" />
            @if (fieldErr('date') || fieldErr('firstDate')) {
              <small class="fe-field-error">{{ fieldErr('date') || fieldErr('firstDate') }}</small>
            }
          </label>
          <label
            >{{ cadence() === 'once' ? 'Montant prévu (€)' : 'Montant par échéance (€)' }}
            <input name="amount" inputmode="decimal" [(ngModel)]="amount" [attr.aria-invalid]="fieldErr('amount') ? 'true' : null" />
            @if (fieldErr('amount')) {
              <small class="fe-field-error">{{ fieldErr('amount') }}</small>
            }
          </label>
          @if (cadence() !== 'once') {
            <label
              >Répétition
              <select name="cadence" [(ngModel)]="cadence">
                <option value="weekly">Chaque semaine</option>
                <option value="monthly">Chaque mois</option>
                <option value="yearly">Chaque année</option>
              </select></label
            >
            <label
              >Dernière échéance (facultatif)
              <input name="endDate" type="date" [(ngModel)]="endDate" [min]="date()" />
              @if (fieldErr('endDate')) {
                <small class="fe-field-error">{{ fieldErr('endDate') }}</small>
              }
            </label>
          }
          <label
            >Poste (centre de coûts)
            <select name="center" [(ngModel)]="center" [attr.aria-invalid]="fieldErr('costCenterRef') ? 'true' : null">
              @for (c of centerOptions(); track c.ref) {
                <option [value]="c.ref">{{ c.label }}{{ c.standard ? '' : ' (personnel)' }}</option>
              }
              <option value="__new__">＋ Nouveau poste personnel…</option>
            </select>
            @if (fieldErr('costCenterRef')) {
              <small class="fe-field-error">{{ fieldErr('costCenterRef') }}</small>
            }
          </label>
          @if (direction() === 'charge' && center() !== '__new__') {
            <div class="fe-category-field">
              <label>Catégorie (facultatif)
                <select name="categoryId" [(ngModel)]="categoryId" [attr.aria-invalid]="fieldErr('categoryId') ? 'true' : null">
                  <option value="">Sans catégorie</option>
                  @for (k of categoryOptions(); track k.id) {
                    <option [value]="k.id">{{ k.label }}{{ k.archived ? ' (retirée)' : k.capCents === null ? '' : ' · plafond ' + (k.capCents | cents) }}</option>
                  }
                </select>
              </label>
              @if (fieldErr('categoryId')) { <small class="fe-field-error">{{ fieldErr('categoryId') }}</small> }
              <small>{{ categoryOptions().length ? 'Son plafond est suivi indépendamment et ne bloque jamais la dépense.' : 'Aucune catégorie dans ce poste.' }}</small>
              <a class="btn btn-secondary" routerLink="/plafonds" [queryParams]="{view: 'categories'}">Gérer les catégories</a>
            </div>
          }
          @if (center() === '__new__') {
            <label
              >Nom du nouveau centre
              <input name="newCenter" [(ngModel)]="newCenter" maxlength="80" />
              <small>Ajouté à votre liste personnelle uniquement, pas au catalogue global.</small>
            </label>
          }
          @if (branchTasks().length || taskFundingRequired()) {
            <label
              >{{ taskFundingRequired() && direction() === 'charge' ? 'Tâche du projet' : 'Tâche du projet (facultatif)' }}
              <select name="taskId" [(ngModel)]="taskId">
                <option value="">{{ taskFundingRequired() && direction() === 'charge' ? 'Choisir une tâche' : 'Sans tâche' }}</option>
                @for (t of branchTasks(); track t.id) {
                  <option [value]="t.id">{{ t.title }}</option>
                }
              </select>
              <small>{{ taskFundingRequired() && direction() === 'charge' ? 'Le règlement doit respecter le montant accordé à cette tâche dans Gestion de projet.' : 'Rattachement informatif : aucune allocation financière ne découle du temps de la tâche.' }}</small>
            </label>
          }
          <label class="fe-wide"
            >Note (facultatif)
            <textarea name="note" rows="2" [(ngModel)]="note" maxlength="500"></textarea>
          </label>
          @if (!editing() && cadence() === 'once') {
            <label class="bp-check fe-wide"
              ><input type="checkbox" name="realized" [(ngModel)]="realized" /> Déjà {{ direction() === 'income' ? 'reçue' : 'payée' }}</label
            >
            @if (realized()) {
              <label
                >Date réelle
                <input name="realizedDate" type="date" [(ngModel)]="realizedDate" [attr.aria-invalid]="fieldErr('realizedDate') ? 'true' : null" />
                @if (fieldErr('realizedDate')) {
                  <small class="fe-field-error">{{ fieldErr('realizedDate') }}</small>
                }
              </label>
              <label
                >Montant réel (€, si différent)
                <input name="realizedAmount" inputmode="decimal" [(ngModel)]="realizedAmount" />
              </label>
              <p class="fe-schedule-note fe-wide">Une date réelle future est refusée : saisissez alors l'opération comme prévision.</p>
            }
          }
        </div>
        <p class="fe-schedule-note">
          {{ cadence() === 'once' ? 'Une seule opération à la date choisie.' : 'Le montant se répète à chaque échéance, à partir de la première date.' }}
        </p>

        @if (!editing()) {
          <section class="fe-impact" aria-live="polite" [attr.aria-labelledby]="impactId">
            <h3 [id]="impactId" class="fe-section-title"><span>03</span>Vérifier l’impact</h3>
            <p class="fe-impact-rule">Comparez le solde et le patrimoine avant / après cette opération.</p>
            @if (preview(); as p) {
              <div class="fe-impact-grid">
                <article>
                  <h4>Solde prévu à la clôture</h4>
                  <span>Avant · {{ sc(p.before.expectedCents) }}</span><strong>{{ sc(p.after.expectedCents) }}</strong><small>Après la saisie</small>
                </article>
                <article>
                  <h4>Reste réel</h4>
                  <span>Avant · {{ sc(p.before.netCents) }}</span><strong>{{ sc(p.after.netCents) }}</strong><small>Après la saisie</small>
                </article>
                <article>
                  <h4>Stock estimé après période</h4>
                  <span>Avant · {{ stock(p.before.stockEstimateCents) }}</span><strong>{{ stock(p.after.stockEstimateCents) }}</strong><small>Après la saisie</small>
                </article>
              </div>
              @if (p.note) {
                <p class="fe-impact-rule">{{ p.note }}</p>
              }
              <p class="fe-impact-rule">Aperçu calculé sans aucune écriture.</p>
            } @else if (previewError()) {
              <p class="bpm-missing">Aperçu indisponible : {{ previewError() }}</p>
            } @else {
              <p class="fe-impact-rule">Renseignez libellé, montant et date pour voir l'effet sur la période.</p>
            }
          </section>
        }
        @if (capPreview(); as cp) {
          @if (direction() === 'charge') {
            <section class="fe-impact" aria-live="polite" aria-label="Impact sur les plafonds">
              <h3 class="fe-section-title">Plafonds · {{ cp.period.label }}</h3>
              @for (row of [cp.after.center, cp.after.category]; track $index) {
                @if (row && row.capCents !== null) {
                  <p [class.bpm-error]="row.over">
                    <strong>{{ $index === 0 ? 'Centre' : 'Catégorie' }} · {{ row.label }}</strong> :
                    {{ row.engagedCents | cents }} engagés sur {{ row.capCents | cents }}.
                    {{ row.over ? 'Dépassement' : 'Disponible après cette saisie' }} : {{ abs(row.marginCents ?? 0) | cents }}.
                  </p>
                }
              }
              @if (cp.alerts.length) {
                <p class="bpm-error" role="alert">{{ capWarning(cp) }} La dépense reste autorisée. Vous pouvez modifier le montant ou enregistrer malgré le dépassement.</p>
              }
              @if (cp.note) { <p>{{ cp.note }}</p> }
            </section>
          }
        }
        @if (capPreviewError()) {
          <p class="bpm-error" role="alert">{{ capPreviewError() }} Vous pouvez réessayer ou enregistrer sans cette vérification.</p>
        }
        <bpm-form-actions [busy]="busy()"
          [label]="capConfirmation() ? (capPreviewError() ? 'Enregistrer sans vérification' : 'Enregistrer malgré le dépassement') : editing() ? 'Enregistrer les modifications' : 'Enregistrer'"
          (cancel)="close()" />
      </form>
    </rjs-modal>
  `,
})
export class BpmOperationEditor implements OnInit {
  private drafts = inject(BpmDrafts);
  private destroy = inject(DestroyRef);
  protected draft?: DraftHandle;
  private bpm = inject(BpmApi);
  private api = inject(Api);
  private refresh = inject(BpmRefresh);

  /** Budgets du contexte (principal et branches). */
  readonly budgets = input.required<BpmBudgetRef[]>();
  /** Ligne à modifier ; absente = création. */
  readonly line = input<RegisterLine | null>(null);
  readonly defaults = input<Partial<EntryInput>>({});
  readonly taskFundingRequired = input(false);
  readonly closed = output<void>();
  readonly saved = output<string>();

  protected budgetId = signal('');
  protected direction = signal<Direction>('charge');
  protected label = signal('');
  protected amount = signal('');
  protected center = signal('');
  protected newCenter = signal('');
  protected cadence = signal<Cadence>('once');
  protected date = signal('');
  protected endDate = signal('');
  protected note = signal('');
  protected taskId = signal('');
  protected categoryId = signal('');
  protected realized = signal(false);
  protected realizedDate = signal('');
  protected realizedAmount = signal('');

  protected centers = signal<CenterOption[]>([]);
  protected categories = signal<ChargeCategory[]>([]);
  private tasks = signal<{ id: string; title: string; projectId: string | null }[]>([]);
  protected busy = signal(false);
  protected error = signal<ApiError | null>(null);
  private fundingRefusalSignature = signal<string | null>(null);
  protected scopeNote = signal<string | null>(null);
  protected capPreview = signal<CapPreview | null>(null);
  protected capPreviewError = signal<string | null>(null);
  protected capConfirmation = signal<string | null>(null);
  protected abs = Math.abs;
  protected capWarning = (p: CapPreview) => p.alerts.map(capAlertText).join(' ');
  private capInput() {
    const l = this.line();
    return { ...this.input(), ...(l ? { replaceId: l.recurrenceId ?? l.operationId ?? l.id } : {}) };
  }
  protected preview = signal<EntryPreview | null>(null);
  protected previewError = signal<string | null>(null);
  private requestKey = newRequestKey('entry');
  private centerKey = newRequestKey('center');
  private revision: number | null = null;
  private recurrenceRevision: number | null = null;
  private original: { cadence: Cadence; firstDate: string } | null = null;

  protected editing = computed(() => !!this.line());
  protected isRecurrence = computed(() => !!this.line()?.recurrenceId);
  protected heading = computed(() => (this.editing() ? (this.isRecurrence() ? 'Modifier l’opération récurrente' : 'Modifier l’opération') : 'Ajouter une entrée ou une charge'));
  protected centerOptions = computed(() => this.centers().filter((c) => c.direction === this.direction()));
  /** Catégories actives du centre choisi ; la catégorie actuelle d'une ligne reste proposée même retirée. */
  protected categoryOptions = computed(() => this.categories().filter((k) => k.costCenterRef === this.center() && (!k.archived || k.id === this.line()?.categoryId)));
  protected branchTasks = computed(() => {
    const b = this.budgets().find((x) => x.id === this.budgetId());
    return b && b.role === 'standard' ? this.tasks().filter((t) => t.projectId === b.coreProjectId) : [];
  });
  protected sc = (v: number | null) => (v === null ? 'Inconnu' : signedCents(v));
  protected stock = (v: number | null) => (v === null ? 'À renseigner' : signedCents(v));
  protected readonly impactId = `fe-impact-title-${++editorId}`;

  constructor() {
    effect((onCleanup) => {
      const input = this.capInput();
      this.capConfirmation.set(null);
      this.capPreview.set(null);
      this.capPreviewError.set(null);
      if (input.direction !== 'charge' || !input.amount || !(input.date || input.firstDate) || input.costCenterRef === '__new__') return;
      let active = true;
      const timer = setTimeout(() => {
        this.bpm.previewCaps(input).then(
          p => { if (active) this.capPreview.set(p); },
          () => { if (active) this.capPreviewError.set('Vérification des plafonds indisponible.'); },
        );
      }, 350);
      onCleanup(() => { active = false; clearTimeout(timer); });
    });
    // Aperçu sans mutation, relancé après une courte pause de saisie ; seule la dernière réponse compte.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let token = 0;
    effect(() => {
      if (this.editing()) return;
      const input = this.input();
      clearTimeout(timer);
      if (!input.label || !input.amount || !(input.date || input.firstDate) || input.costCenterRef === '__new__') {
        this.preview.set(null);
        return;
      }
      const mine = ++token;
      timer = setTimeout(() => {
        this.bpm.previewEntry(input).then(
          (p) => mine === token && (this.preview.set(p), this.previewError.set(null)),
          (e) => mine === token && (this.preview.set(null), this.previewError.set(toApiError(e).message)),
        );
      }, 350);
    });
  }

  async ngOnInit() {
    const d = this.defaults();
    const l = this.line();
    const life = this.budgets().find((b) => b.role === 'life');
    this.budgetId.set(l?.budgetId ?? d.budgetId ?? life?.id ?? this.budgets()[0]?.id ?? '');
    this.direction.set(l?.direction ?? d.direction ?? 'charge');
    this.label.set(l?.label ?? d.label ?? '');
    this.amount.set(l ? String(l.plannedCents / 100).replace('.', ',') : d.amount ? String(d.amount) : '');
    this.cadence.set(l?.cadence ?? d.cadence ?? 'once');
    this.date.set(l ? (l.recurrenceId ? (l.firstDate ?? l.plannedDate) : l.plannedDate) : (d.date ?? new Date().toISOString().slice(0, 10)));
    this.endDate.set(l?.endDate ?? '');
    this.note.set(l?.note ?? d.note ?? '');
    this.taskId.set(l?.taskId ?? d.taskId ?? '');
    this.categoryId.set(l?.categoryId ?? d.categoryId ?? '');
    this.revision = l?.revision ?? null;
    try {
      const [centers, tasks, categories] = await Promise.all([this.bpm.costCenters(), this.api.tasks().catch(() => []), this.bpm.categories(true).catch(() => [] as ChargeCategory[])]);
      this.centers.set(centers);
      this.categories.set(categories);
      this.tasks.set(tasks.map((t) => ({ id: t.task.id, title: t.task.title, projectId: t.task.projectId })));
      const wanted = l?.costCenterRef ?? d.costCenterRef;
      this.center.set(wanted && centers.some((c) => c.ref === wanted) ? wanted : (this.centerOptions()[0]?.ref ?? '__new__'));
      if (l?.recurrenceId) {
        const detail = await this.bpm.line(l.id);
        this.recurrenceRevision = detail.definition?.revision ?? null;
        if (detail.definition) {
          this.amount.set(String(detail.definition.amountCents / 100).replace('.', ','));
          this.date.set(detail.definition.firstDate);
          this.endDate.set(detail.definition.endDate ?? '');
          this.label.set(detail.definition.label);
          this.note.set(detail.definition.note ?? '');
          this.cadence.set(detail.definition.cadence);
          this.original = { cadence: detail.definition.cadence, firstDate: detail.definition.firstDate };
        }
      }
    } catch (e) {
      this.error.set(toApiError(e));
    }
    this.draft = this.drafts.fields(`entry:${l?.id ?? 'new'}:${l?.revision ?? 0}:${d.budgetId ?? life?.id ?? ''}:${d.taskId ?? ''}:${d.direction ?? 'charge'}:${d.costCenterRef ?? ''}:${d.categoryId ?? ''}`, this, ['budgetId', 'direction', 'label', 'amount', 'center', 'newCenter', 'cadence', 'date', 'endDate', 'note', 'taskId', 'categoryId', 'realized', 'realizedDate', 'realizedAmount', 'requestKey', 'centerKey'], this.destroy);
  }

  /** Bascule ponctuel / récurrent de la référence : une récurrence part sur un rythme mensuel. */
  protected toggleCadence() {
    if (this.editing()) return;
    this.cadence.set(this.cadence() === 'once' ? 'monthly' : 'once');
  }

  protected setDirection(d: Direction) {
    this.direction.set(d);
    if (!this.centerOptions().some((c) => c.ref === this.center())) this.center.set(this.centerOptions()[0]?.ref ?? '__new__');
    if (d !== 'charge') this.categoryId.set('');
  }

  protected fieldErr(name: string) {
    const e = this.error();
    return e && e.body.details?.['field'] === name ? e.message : null;
  }

  private input = computed<EntryInput>(() => {
    const amount = parseAmount(this.amount());
    const once = this.cadence() === 'once';
    const realizedAmount = parseAmount(this.realizedAmount());
    return {
      budgetId: this.budgetId() || undefined,
      direction: this.direction(),
      label: this.label().trim(),
      amount: typeof amount === 'number' ? amount : (NaN as number),
      costCenterRef: this.center(),
      cadence: this.cadence(),
      ...(once ? { date: this.date() } : { firstDate: this.date(), endDate: this.endDate() || null }),
      ...(once && this.realized() ? { status: 'realized' as const, realizedDate: this.realizedDate() || this.date(), ...(typeof realizedAmount === 'number' ? { realizedAmount } : {}) } : { status: 'planned' as const }),
      note: this.note().trim() || null,
      taskId: this.branchTasks().length ? this.taskId() || null : undefined,
      categoryId: this.categoryValue(),
    };
  });

  /** Catégorie envoyée : seulement pour une charge et si elle appartient au centre choisi. */
  private categoryValue() {
    const id = this.categoryId();
    return this.direction() === 'charge' && id && this.categoryOptions().some((k) => k.id === id) ? id : null;
  }

  protected close() {
    this.draft?.clear();
    this.closed.emit();
  }

  /** La confirmation de financement ne vaut que pour la saisie refusée par le serveur. */
  private draftSignature() {
    return JSON.stringify({
      input: this.input(),
      amount: this.amount(),
      realizedAmount: this.realizedAmount(),
      ...(this.center() === '__new__' ? { newCenter: this.newCenter() } : {}),
    });
  }

  protected fundingIssue = computed(() => {
    const e = this.error();
    if (this.editing() || !this.realized() || this.cadence() !== 'once' || this.fundingRefusalSignature() !== this.draftSignature()) return null;
    const details = e?.body.details as { reason?: string; grantOverrunCents?: number; overrunCents?: number } | undefined;
    return details?.reason === 'task-share' || e?.body.code === 'OVERRUN_AUTHORIZATION_REQUIRED'
      ? { overrunCents: details?.grantOverrunCents ?? details?.overrunCents ?? 0 }
      : null;
  });

  async save(fund = false) {
    if (this.busy()) return;
    const authorizedSignature = fund ? this.fundingRefusalSignature() : null;
    if (fund && !this.fundingIssue()) {
      this.fundingRefusalSignature.set(null);
      this.error.set(new ApiError(400, { code: 'VALIDATION', action: null, message: 'La saisie a changé. Enregistrez à nouveau pour vérifier le financement nécessaire avant de le confirmer.' }));
      return;
    }
    if (this.taskFundingRequired() && this.direction() === 'charge' && !this.taskId()) {
      this.error.set(new ApiError(400, { code: 'VALIDATION', action: null, message: 'Choisissez la tâche qui porte cette dépense. Créez une tâche dans le projet si nécessaire.', details: { field: 'taskId' } }));
      return;
    }
    const amount = parseAmount(this.amount());
    if (typeof amount !== 'number' || amount <= 0) {
      this.error.set(new ApiError(400, { code: 'VALIDATION', action: null, message: 'Montant positif attendu (ex. 120,50).', details: { field: 'amount' } }));
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.fundingRefusalSignature.set(null);
    let sentSignature: string | null = null;
    try {
      let centerRef = this.center();
      if (centerRef === '__new__') {
        if (!this.newCenter().trim()) throw new ApiError(400, { code: 'VALIDATION', action: null, message: 'Nom du nouveau centre requis.', details: { field: 'costCenterRef' } });
        const r = await this.bpm.addCostCenter({ requestKey: this.centerKey, label: this.newCenter().trim(), direction: this.direction() });
        centerRef = r.costCenterId;
        this.centers.set(await this.bpm.costCenters());
        this.center.set(centerRef);
      }
      const submittedInput = { ...this.input(), costCenterRef: centerRef };
      const submittedSignature = this.draftSignature();
      const l = this.line();
      if (fund && authorizedSignature !== submittedSignature) {
        throw new ApiError(400, { code: 'VALIDATION', action: null, message: 'La saisie a changé. Enregistrez à nouveau pour vérifier le financement nécessaire avant de le confirmer.' });
      }
      // Relecture juste avant l’écriture : ne jamais enregistrer silencieusement un dépassement.
      if (submittedInput.direction === 'charge') {
        const input = { ...submittedInput, ...(l ? { replaceId: l.recurrenceId ?? l.operationId ?? l.id } : {}) };
        let signature: string | null = null;
        try {
          const cp = await this.bpm.previewCaps(input);
          this.capPreview.set(cp);
          this.capPreviewError.set(null);
          if (cp.alerts.length) signature = JSON.stringify({ input, alerts: cp.alerts });
        } catch {
          this.capPreviewError.set('Vérification des plafonds indisponible.');
          signature = JSON.stringify({ input, unavailable: true });
        }
        if (this.draftSignature() !== submittedSignature) {
          this.capPreview.set(null);
          this.capPreviewError.set(null);
          this.capConfirmation.set(null);
          throw new ApiError(400, { code: 'VALIDATION', action: null, message: 'La saisie a changé pendant la vérification. Vérifiez les montants puis enregistrez à nouveau.' });
        }
        if (signature && this.capConfirmation() !== signature) {
          this.capConfirmation.set(signature);
          return;
        }
      }
      let message: string;
      if (!l) {
        sentSignature = submittedSignature;
        const r = await this.bpm.createEntry({ ...submittedInput, requestKey: this.requestKey, ...(fund ? { fund: true } : {}) });
        message = withCapAlerts(r.recurrence ? `Opération récurrente « ${r.recurrence.label} » enregistrée (${r.recurrence.cadenceLabel}).` : `Opération « ${r.operation?.label} » enregistrée.`, r.capAlerts);
      } else if (l.recurrenceId) {
        const body = { expectedRevision: this.recurrenceRevision ?? 0, label: this.label().trim(), amount, costCenterRef: centerRef, note: this.note().trim() || null, endDate: this.endDate() || null, categoryId: this.categoryValue(), ...(this.cadence() !== this.original?.cadence ? { cadence: this.cadence() } : {}), ...(this.date() !== this.original?.firstDate ? { firstDate: this.date() } : {}), ...(this.branchTasks().length ? { taskId: this.taskId() || null } : {}) };
        const r = await this.bpm.updateRecurrence(l.recurrenceId, body);
        message = withCapAlerts(`Définition modifiée : ${r.scope.appliesTo}` + (r.scope.settledUntouched ? ` ${r.scope.settledUntouched} règlement(s) déjà effectué(s) inchangé(s).` : ''), r.capAlerts);
      } else {
        const body = { expectedRevision: this.revision ?? 0, label: this.label().trim(), amount, date: this.date(), costCenterRef: centerRef, note: this.note().trim() || null, categoryId: this.categoryValue(), ...(this.branchTasks().length ? { taskId: this.taskId() || null } : {}) };
        const r = await this.bpm.updateOperation(l.operationId ?? l.id, body);
        message = withCapAlerts('Opération modifiée.', r.capAlerts);
      }
      this.refresh.bump();
      this.draft?.clear();
      this.saved.emit(message);
    } catch (e) {
      this.fundingRefusalSignature.set(sentSignature);
      this.error.set(toApiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}

