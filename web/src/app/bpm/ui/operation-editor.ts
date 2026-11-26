import { BpmAmount } from './amount';
import { BpmDrafts, DraftHandle } from './drafts';
import { BpmFormActions } from './form-actions';
import { Component, computed, DestroyRef, effect, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BpmRouterLink } from './bpm-router-link';
import { Api, ApiError, toApiError } from '../../core/api.service';
import { BpmApi } from '../data/bpm-api.service';
import { BpmBudgetRef, Cadence, Direction, EntryInput, EntryPreview, RegisterLine } from '../data/bpm-models';
import { CapPreview } from '../data/bpm-caps.models';
import { CentsPipe, parseAmount, signedCents } from '../../core/format';
import { BpmModal } from './modal';
import { capAlertText, withCapAlerts } from './caps';
import { BpmRefresh, newRequestKey } from './page-context';
import { BpmPostingImpact } from './posting-impact';

let editorId = 0;

type CenterOption = { ref: string; label: string; direction: Direction; standard: boolean };

/**
 * Éditeur d'opération partagé par toutes les pages BPM : Budget cible, entrée/charge, libellé,
 * montant, poste, date, cadence, fin facultative, note et tâche éventuelle d'une branche.
 * Création : opération ponctuelle ou définition récurrente, avec aperçu sans mutation.
 * Modification : conserve l'identité de l'opération (ou de la définition récurrente, avec sa portée).
 * Le brouillon est conservé en cas d'erreur ou de conflit.
 * Présentation de la référence : fenêtre `rjs-modal` et vocabulaire de `bpm-flow-editor`
 * (`.fe-form`, étapes `.fe-section-title`, bascule `.bp-toggle`, `.bp-recurrence-switch`, aperçu `.fe-impact`).
 */
@Component({
  selector: 'bpm-operation-editor',
  imports: [BpmAmount, BpmPostingImpact, BpmFormActions, FormsModule, BpmRouterLink, CentsPipe, BpmModal],
  styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-vision.page.scss', '../ref-styles/bpm-flow-editor.component.scss', './operation-editor.scss'],
  templateUrl: './operation-editor.html',
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
  protected realized = signal(false);
  protected realizedDate = signal('');
  protected realizedAmount = signal('');
  protected accountingDate = signal('');
  protected fundingSource = signal<'cycle' | 'patrimoine'>('cycle');
  protected projectBudget = computed(() => this.budgets().find(b => b.id === this.budgetId())?.role === 'standard');

  protected centers = signal<CenterOption[]>([]);
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
  protected previewLoading = signal(false);
  protected preview = signal<EntryPreview | null>(null);
  protected previewError = signal<string | null>(null);
  private requestKey = newRequestKey('entry');
  private centerKey = newRequestKey('center');
  private revision: number | null = null;
  private recurrenceRevision: number | null = null;
  private original: { cadence: Cadence; firstDate: string } | null = null;

  protected editing = computed(() => !!this.line());
  protected isRecurrence = computed(() => !!this.line()?.recurrenceId);
  protected heading = computed(() => (this.editing() ? (this.isRecurrence() ? 'Modifier l’opération récurrente' : 'Modifier l’opération') : this.direction() === 'income' ? 'Saisir une entrée' : 'Saisir une dépense'));
  protected centerOptions = computed(() => this.centers().filter((c) => c.direction === this.direction()));
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
    effect((onCleanup) => {
      if (this.editing()) return;
      const input = this.input();
      this.preview.set(null);
      this.previewError.set(null);
      this.previewLoading.set(false);
      if (!input.label || !input.amount || !(input.date || input.firstDate) || input.costCenterRef === '__new__') return;
      this.previewLoading.set(true);
      let active = true;
      const timer = setTimeout(() => {
        this.bpm.previewEntry(input).then(
          p => { if (active) this.preview.set(p); },
          e => { if (active) this.previewError.set(toApiError(e).message); },
        ).finally(() => { if (active) this.previewLoading.set(false); });
      }, 350);
      onCleanup(() => { active = false; clearTimeout(timer); });
    });
  }

  protected setRealized(value: boolean) {
    this.realized.set(value);
    if (value && !this.realizedDate()) this.realizedDate.set(this.date());
  }

  async ngOnInit() {
    const d = this.defaults();
    const l = this.line();
    const life = this.budgets().find((b) => b.role === 'life');
    this.budgetId.set(l?.budgetId ?? d.budgetId ?? life?.id ?? this.budgets()[0]?.id ?? '');
    this.fundingSource.set(l?.fundingSource ?? d.fundingSource ?? this.budgets().find(b => b.id === this.budgetId())?.fundingSource ?? 'cycle');
    this.direction.set(l?.direction ?? d.direction ?? 'charge');
    this.label.set(l?.label ?? d.label ?? '');
    this.amount.set(l ? String(l.plannedCents / 100).replace('.', ',') : d.amount ? String(d.amount) : '');
    this.cadence.set(l?.cadence ?? d.cadence ?? 'once');
    this.date.set(l ? (l.recurrenceId ? (l.firstDate ?? l.plannedDate) : l.plannedDate) : (d.date ?? new Date().toISOString().slice(0, 10)));
    this.endDate.set(l?.endDate ?? '');
    this.note.set(l?.note ?? d.note ?? '');
    this.taskId.set(l?.taskId ?? d.taskId ?? '');
    // Saisie d'un mouvement déjà réglé (un mouvement manquant relevé au rapprochement) : « Déjà payée » cochée d'emblée.
    if (!l && d.status === 'realized') this.setRealized(true);
    this.revision = l?.revision ?? null;
    try {
      const [centers, tasks] = await Promise.all([this.bpm.costCenters(), this.api.tasks().catch(() => [])]);
      this.centers.set(centers);
      this.tasks.set(tasks.map((t) => ({ id: t.task.id, title: t.task.title, projectId: t.task.projectId })));
      const wanted = l?.costCenterRef ?? d.costCenterRef;
      this.center.set(wanted && centers.some((c) => c.ref === wanted) ? wanted : (this.centerOptions()[0]?.ref ?? '__new__'));
      if (l?.recurrenceId) {
        const detail = await this.bpm.line(l.id);
        this.recurrenceRevision = detail.definition?.revision ?? null;
        if (detail.definition) {
          this.fundingSource.set(detail.definition.plannedFundingSource ?? this.selectedBudget()?.fundingSource ?? 'cycle');
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
    this.draft = this.drafts.fields(`entry:${l?.id ?? 'new'}:${l?.revision ?? 0}:${d.budgetId ?? life?.id ?? ''}:${d.taskId ?? ''}:${d.direction ?? 'charge'}:${d.costCenterRef ?? ''}`, this, ['budgetId', 'direction', 'label', 'amount', 'center', 'newCenter', 'cadence', 'date', 'endDate', 'note', 'taskId', 'realized', 'realizedDate', 'realizedAmount', 'accountingDate', 'fundingSource', 'requestKey', 'centerKey'], this.destroy);
  }

  /** Bascule ponctuel / récurrent de la référence : une récurrence part sur un rythme mensuel. */
  protected toggleCadence() {
    if (this.editing()) return;
    this.cadence.set(this.cadence() === 'once' ? 'monthly' : 'once');
  }

  protected setDirection(d: Direction) {
    this.direction.set(d);
    if (!this.centerOptions().some((c) => c.ref === this.center())) this.center.set(this.centerOptions()[0]?.ref ?? '__new__');
  }

  protected selectBudget(id: string) {
    this.budgetId.set(id);
    this.taskId.set('');
    this.fundingSource.set(this.budgets().find(b => b.id === id)?.fundingSource ?? 'cycle');
    this.accountingDate.set('');
  }
  protected readonly selectedBudget = computed(() => this.budgets().find(b => b.id === this.budgetId()));
  protected readonly selectedTask = computed(() => this.branchTasks().find(t => t.id === this.taskId()));
  protected readonly impactAmount = computed(() => {
    const amount = parseAmount(this.realized() && this.realizedAmount() ? this.realizedAmount() : this.amount());
    return typeof amount === 'number' && Number.isFinite(amount) ? Math.round(amount * 100) : null;
  });

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
      ...(this.projectBudget() ? { fundingSource: this.fundingSource() } : {}),
      ...(once && this.realized() ? {
        status: 'realized' as const,
        realizedDate: this.realizedDate() || this.date(),
        ...(this.projectBudget() ? { accountingDate: this.accountingDate() || this.realizedDate() || this.date() } : {}),
        ...(typeof realizedAmount === 'number' ? { realizedAmount } : {}),
      } : { status: 'planned' as const }),
      note: this.note().trim() || null,
      taskId: this.branchTasks().length ? this.taskId() || null : undefined,
    };
  });

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
    if ((this.projectBudget() || this.taskFundingRequired()) && !this.branchTasks().some(t => t.id === this.taskId())) {
      const movement = this.direction() === 'income' ? 'cette entrée' : 'cette dépense';
      this.error.set(new ApiError(400, { code: 'VALIDATION', action: null, message: `Choisissez la tâche qui porte ${movement}. Créez une tâche dans le projet si nécessaire.`, details: { field: 'taskId' } }));
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
        const body = { expectedRevision: this.recurrenceRevision ?? 0, label: this.label().trim(), amount, costCenterRef: centerRef, note: this.note().trim() || null, endDate: this.endDate() || null, ...(this.cadence() !== this.original?.cadence ? { cadence: this.cadence() } : {}), ...(this.date() !== this.original?.firstDate ? { firstDate: this.date() } : {}), ...(this.branchTasks().length ? { taskId: this.taskId() || null } : {}) };
        const r = await this.bpm.updateRecurrence(l.recurrenceId, { ...body, ...(this.projectBudget() ? { fundingSource: this.fundingSource() } : {}) });
        message = withCapAlerts(`Définition modifiée : ${r.scope.appliesTo}` + (r.scope.settledUntouched ? ` ${r.scope.settledUntouched} règlement(s) déjà effectué(s) inchangé(s).` : ''), r.capAlerts);
      } else {
        const body = { expectedRevision: this.revision ?? 0, label: this.label().trim(), amount, date: this.date(), costCenterRef: centerRef, note: this.note().trim() || null, ...(this.branchTasks().length ? { taskId: this.taskId() || null } : {}) };
        const r = await this.bpm.updateOperation(l.operationId ?? l.id, { ...body, ...(this.projectBudget() && !l.settled ? { fundingSource: this.fundingSource() } : {}) });
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

