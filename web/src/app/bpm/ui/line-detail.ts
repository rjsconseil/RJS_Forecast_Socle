import { Component, computed, inject, input, output, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ApiError, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { LineDetail, RegisterLine } from '../../core/bpm-models';
import { cents, parseAmount, shortDate, signedCents } from '../../core/format';
import { ModalComponent } from '../../shared/modal.component';
import { capAlertText, withCapAlerts } from './caps';
import { FUNDING_ACTIONS, FUNDING_RESULTS, ProjectFunding } from './project-funding';
import { bpmLoader, BpmRefresh, newRequestKey } from './page-context';
import { BpmState } from './state';

/**
 * Détail d'une échéance ou d'une opération (panneau partagé) : identité, prévu/réel, différence,
 * statut, définition récurrente, historique des règlements et actions de pointage autorisées.
 * La modification ouvre l'éditeur BPM partagé (sortie `edit`).
 * Présentation de la référence : fenêtre `rjs-modal` et fiche `.bpm-guide` (`bpm-settlement`, `bpm-workspace-nav`).
 */
interface ShareGap {
  reason: 'task-share';
  budgetId: string;
  budgetRevision: number;
  taskId: string;
  taskTitle: string;
  shareCents: number | null;
  neededCents: number;
  availableCents: number | null;
  /** Dépassement qu'accorder la part demande (calculé par le middleware Budget). */
  grantOverrunCents: number;
  pendingOverrun: PendingOverrun | null;
  /** La demande en attente, une fois autorisée, couvre la part nécessaire (calculé par le middleware Budget). */
  pendingCovers: boolean;
}

interface PendingOverrun {
  id: string;
  revision: number;
  amountCents: number;
  taskId: string | null;
  taskTitle: string | null;
  requestCents: number | null;
}

@Component({
  selector: 'bpm-line-detail',
  imports: [FormsModule, BpmState, ModalComponent, RouterLink],
  styleUrls: ['../ref-styles/bpm-context.scss', '../ref-styles/bpm-pages.scss', './line-detail.scss'],
  template: `
    <rjs-modal [open]="true" [headed]="true" [title]="d()?.line?.label ?? 'Détail de l’échéance'" [busy]="busy()" (closed)="closed.emit()">
      <div class="bpm-guide">
        <bpm-state [loading]="loader.loading() && !d()" [error]="loader.error()" (retry)="loader.reload()" />
        @if (message()) {
          <p class="bld-saved" [class.is-warning]="settleConfirmation()" [attr.role]="settleConfirmation() ? 'alert' : 'status'">{{ message() }}</p>
        }
        @if (actionError(); as e) {
          <p class="bpm-error" role="alert">{{ e.message }} <small>Votre saisie est conservée.</small></p>
          @if (shareGap(); as g) {
            @if (g.pendingOverrun; as po) {
              <div class="bld-overrun">
                @if (g.pendingCovers) {
                  <p>
                    Une demande de {{ money(po.requestCents ?? 0) }} pour « {{ po.taskTitle }} » attend votre décision
                    (dépassement de l’enveloppe de {{ money(po.amountCents) }}). L’autoriser accorde cette part et couvre ce règlement.
                  </p>
                  <div class="bpm-actions">
                    <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="approvePendingAndSettle(po)">
                      {{ act.approveRequest + act.andSettle }}
                    </button>
                    <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="actionError.set(null)">Garder la dépense prévue</button>
                  </div>
                } @else {
                  <p>
                    Une demande de dépassement de {{ money(po.amountCents) }}{{ po.taskTitle ? ' pour « ' + po.taskTitle + ' »' : '' }}
                    attend déjà votre décision : décidez-la d’abord, puis revenez régler cette dépense.
                  </p>
                  <div class="bpm-actions">
                    <a class="btn btn-primary" routerLink="/projet-de-vie" fragment="life-decisions" (click)="followLink()">Voir les décisions attendues</a>
                    <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="actionError.set(null)">Garder la dépense prévue</button>
                  </div>
                }
              </div>
            } @else {
            <div class="bld-overrun">
              @if (decisionNotice(); as n) {
                <p class="bld-notice">{{ n }}</p>
              }
              <p>
                Vous pilotez aussi le projet : accordez {{ money(g.neededCents) }} à « {{ g.taskTitle }} »
                @if (g.grantOverrunCents) {
                  — l’enveloppe n’a que {{ money(g.availableCents ?? 0) }} à répartir : {{ money(g.grantOverrunCents) }} seront autorisés en dépassement
                }
                et le règlement est enregistré dans la même écriture.
              </p>
              <div class="bpm-actions">
                <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="grantShareAndSettle(g)">
                  {{ act.grantShare(g.neededCents, g.taskTitle) + act.andSettle }}
                </button>
                <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="actionError.set(null)">Garder la dépense prévue</button>
              </div>
            </div>
            }
          }
          @if (overrun(); as o) {
            <div class="bld-overrun">
              <p>
                Vous décidez pour le projet de vie : autorisez ce dépassement de {{ money(o.overrunCents) }} et le règlement
                est enregistré aussitôt. Le dépassement sera facturé au budget de vie à la fin du cycle.
              </p>
              <div class="bpm-actions">
                <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="authorizeAndSettle()">
                  {{ act.authorize(o.overrunCents) + act.andSettle }}
                </button>
                <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="actionError.set(null)">Garder la dépense prévue</button>
              </div>
            </div>
          }
        }
        @if (d(); as v) {
          <header>
            <small>{{ v.line.direction === 'income' ? 'Entrée' : 'Charge' }} · {{ v.line.cadenceLabel }}</small>
            <p class="bld-tags">
              <span class="chip" [class]="v.line.status">{{ v.line.statusLabel }}</span>
              @if (!v.line.centerKnown) {
                <span class="chip warn">Centre à préciser</span>
              }
            </p>
          </header>
          <section>
            <h3>Prévu et réel</h3>
            <dl>
              <div><dt>Budget / projet</dt><dd>{{ v.line.budgetRole === 'life' ? 'Budget du projet de vie' : v.line.budgetName }}</dd></div>
              <div><dt>Centre</dt><dd>{{ v.line.costCenterLabel ?? 'À préciser' }}</dd></div>
              @if (v.line.direction === 'charge') {
                <div><dt>Catégorie</dt><dd>{{ v.line.categoryLabel ?? 'Sans catégorie' }}</dd></div>
              }
              <div><dt>Tâche</dt><dd>{{ v.line.taskTitle ?? '—' }}</dd></div>
              <div><dt>Date prévue</dt><dd>{{ date(v.line.plannedDate) }}</dd></div>
              @if (v.timing?.plannedPeriod; as p) { <div><dt>Cycle prévu</dt><dd>{{ p.label }}</dd></div> }
              <div><dt>Montant prévu</dt><dd class="num">{{ c(v.line.plannedCents) }}</dd></div>
              <div><dt>Date réelle</dt><dd>{{ v.line.realizedDate ? date(v.line.realizedDate) : '—' }}</dd></div>
              @if (v.timing?.realizedPeriod; as p) { <div><dt>Cycle du règlement</dt><dd>{{ p.label }}</dd></div> }
              <div><dt>Montant réel</dt><dd class="num">{{ v.line.realizedCents === null ? '—' : c(v.line.realizedCents) }}</dd></div>
              <div><dt>Différence (réel − prévu)</dt><dd class="num">{{ v.line.differenceCents === null ? '—' : s(v.line.differenceCents) }}</dd></div>
            </dl>
          </section>
          @if (v.definition; as def) {
            <section>
              <h3>Définition récurrente</h3>
              <dl>
                <div><dt>Répétition</dt><dd>{{ def.cadenceLabel }}</dd></div>
                <div><dt>Première échéance</dt><dd>{{ date(def.firstDate) }}</dd></div>
                <div><dt>Dernière échéance</dt><dd>{{ def.endDate ? date(def.endDate) : 'Sans fin' }}</dd></div>
                <div><dt>Montant par échéance</dt><dd class="num">{{ c(def.amountCents) }}</dd></div>
              </dl>
            </section>
          }
          @if (v.line.note) {
            <p><strong>Note :</strong> {{ v.line.note }}</p>
          }

          @if (v.project; as p) {
            <section class="bld-project">
              <p>{{ v.line.direction === 'income' ? 'Entrée' : 'Dépense' }} du projet <a [routerLink]="['/app/gestion-projet', p.coreProjectId]" [queryParams]="{ period: v.timing?.realizedPeriod?.key ?? period() }" (click)="followLink()">{{ p.name }}</a>
              @if (p.taskTitle) { · tâche « {{ p.taskTitle }} » }
              · {{ p.funded ? 'enveloppe attribuée le ' + date(p.allocationDate!) : 'sans enveloppe attribuée' }}</p>
              <p class="bpm-help">{{ inclusionText(v) }}</p>
              @if (!p.funded && p.taskFundingRequired && v.line.direction === 'charge') {
                <a class="btn btn-primary" [routerLink]="['/app/gestion-projet', p.coreProjectId]" fragment="enveloppe" (click)="followLink()">Attribuer une enveloppe au projet</a>
              }
              @if (p.inclusion === 'included') {
                <a class="btn btn-secondary" routerLink="/projet-de-vie" [queryParams]="{ period: v.timing?.realizedPeriod?.key ?? period() }" fragment="life-funding-title" (click)="followLink()">Voir la prise en charge du projet de vie</a>
              }
            </section>
          }
          @if (v.actions.canSettle) {
            <section>
              <h3>{{ v.line.direction === 'income' ? 'Marquer reçu' : 'Marquer payé' }}</h3>
              <div class="bld-fields">
                <label>Date réelle<input type="date" [(ngModel)]="realDate" name="realDate" /></label>
                <label>Montant réel (€)<input inputmode="decimal" [(ngModel)]="realAmount" name="realAmount" /></label>
              </div>
              @for (w of settleWarnings(v); track w) {
                <p class="bpm-feedback is-warning" role="status">{{ w }}</p>
              }
              <p class="bpm-help">{{ v.actions.settlementPolicy }}</p>
              <div class="bpm-actions">
                <button type="button" class="btn btn-primary" (click)="settle(v)" [disabled]="busy()">{{ settleConfirmation() ? 'Confirmer le règlement malgré l’alerte' : v.line.direction === 'income' ? 'Reçu' : 'Payé' }}</button>
              </div>
            </section>
          }
          @if (v.actions.canCancelSettlement && v.line.operationId) {
            <div class="bpm-actions">
              <button type="button" class="btn btn-danger" (click)="cancel(v)" [disabled]="busy()">Annuler le règlement</button>
            </div>
          } @else if (v.line.settled) {
            <p class="bpm-help">Règlement compris dans une période close : il n'est plus annulable.</p>
          }
          @if (v.actions.canCancelEntry && v.line.operationId) {
            <div class="bpm-actions">
              @if (confirmCancelEntry()) {
                <p class="bpm-feedback is-warning" role="status">La saisie sortira de tous les calculs (doublon, erreur). Elle reste dans l’historique de la base.</p>
                <button type="button" class="btn btn-danger" (click)="cancelEntry(v)" [disabled]="busy()">Confirmer l’annulation de la saisie</button>
                <button type="button" class="btn btn-secondary" (click)="confirmCancelEntry.set(false)" [disabled]="busy()">Garder la saisie</button>
              } @else {
                <button type="button" class="btn btn-secondary" (click)="confirmCancelEntry.set(true)" [disabled]="busy()">Annuler cette saisie (doublon, erreur)</button>
              }
            </div>
          }

          <section>
            <h3>Historique des règlements</h3>
            @if (v.settlements.length) {
              <div class="table-scroll">
                <table class="data-table">
                  <thead>
                    <tr><th>Échéance</th><th>Réglé le</th><th class="num">Prévu</th><th class="num">Réel</th><th></th></tr>
                  </thead>
                  <tbody>
                    @for (r of v.settlements; track r.operationId) {
                      <tr>
                        <td>{{ r.occurrenceDate ? date(r.occurrenceDate) : '—' }}</td>
                        <td>{{ date(r.realizedDate) }}</td>
                        <td class="num">{{ c(r.plannedCents) }}</td>
                        <td class="num">{{ c(r.realizedCents) }}</td>
                        <td>@if (r.outsidePeriod) {<span class="chip">hors période</span>}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="bpm-help">Aucun règlement enregistré.</p>
            }
          </section>
          <details class="bld-ids">
            <summary>Détails techniques</summary>
            <dl>
              <div><dt>Ligne</dt><dd>{{ v.ids.lineId }}</dd></div>
              <div><dt>Opération</dt><dd>{{ v.ids.operationId ?? '—' }}</dd></div>
              <div><dt>Définition récurrente</dt><dd>{{ v.ids.recurrenceId ?? '—' }}</dd></div>
              <div><dt>Budget</dt><dd>{{ v.ids.budgetId }}</dd></div>
              <div><dt>Tâche</dt><dd>{{ v.ids.taskId ?? '—' }}</dd></div>
            </dl>
          </details>
        }
        <div class="bpm-actions">
          @if (d(); as v) {
            @if (v.actions.canEdit) {
              <button type="button" class="btn btn-primary" (click)="edit.emit(v.line)">Modifier</button>
            } @else {
              <p class="bpm-help">{{ v.actions.editReason ?? 'Opération d’une période close : modification financière protégée.' }}</p>
            }
          }
          <button type="button" class="btn btn-secondary" (click)="closed.emit()">Fermer</button>
        </div>
      </div>
    </rjs-modal>
  `,
})
export class BpmLineDetail {
  private bpm = inject(BpmApi);
  private router = inject(Router);
  private followingLink = false;
  constructor() {
    // La fermeture du registre retire sa sélection dans l'URL. Elle doit attendre
    // la destination du lien, sinon elle annule la navigation vers le projet.
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (this.followingLink && event instanceof NavigationEnd) this.closed.emit();
    });
  }
  protected followLink() { this.followingLink = true; }
  private refresh = inject(BpmRefresh);
  readonly lineId = input.required<string>();
  readonly period = input<string | undefined>(undefined);
  readonly closed = output<void>();
  readonly edit = output<RegisterLine>();

  protected loader = bpmLoader(
    () => ({ id: this.lineId(), period: this.period() }),
    (k) => this.bpm.line(k.id, k.period),
  );
  protected d = computed(() => this.loader.data());
  protected busy = signal(false);
  protected message = signal<string | null>(null);
  protected actionError = signal<ApiError | null>(null);
  private refusedFor = signal<string | null>(null);
  private settlementSignature() {
    return JSON.stringify({ lineId: this.lineId(), date: this.realDate(), amount: this.realAmount() });
  }
  protected realDate = signal(new Date().toISOString().slice(0, 10));

  /** Avertissements avant règlement : cas acceptés mais rarement voulus (hors enveloppe, année probablement erronée). */
  protected settleWarnings(v: LineDetail): string[] {
    const d = this.realDate();
    const out: string[] = [];
    if (!d || v.line.direction !== 'charge') return out;
    const p = v.project;
    if (p && !p.funded && !p.taskFundingRequired) out.push(`« ${p.name} » n’a pas encore d’enveloppe : ce règlement restera dans l’historique du projet, hors budget de vie.`);
    else if (p?.allocationDate && d < p.allocationDate)
      out.push(`Date antérieure à l’attribution de l’enveloppe (${this.date(p.allocationDate)}) : ce règlement restera dans l’historique du projet, hors enveloppe et hors budget de vie.`);
    const gap = (Date.parse(v.line.plannedDate) - Date.parse(d)) / 86400000;
    if (gap > 90) out.push(`La date réelle précède de plus de trois mois la date prévue (${this.date(v.line.plannedDate)}) : vérifiez le jour, le mois et l’année.`);
    return out;
  }
  protected realAmount = signal('');
  protected settleConfirmation = signal<string | null>(null);
  private settleKey = newRequestKey('settle');

  protected c = cents;
  protected s = signedCents;
  protected date = shortDate;
  protected inclusionText(v: LineDetail): string {
    switch (v.project?.inclusion) {
      case 'included': return 'Ce règlement est compris dans le Dépensé du projet de vie à sa date réelle, une seule fois.';
      case 'before-allocation': return 'Ce règlement précède l’attribution : il reste dans l’historique du projet, hors enveloppe et hors Dépensé du projet de vie.';
      case 'unfunded': return v.project?.taskFundingRequired ? 'Attribuez une enveloppe à ce projet avant de régler ses dépenses. Vous pouvez préparer les échéances et les demandes des tâches dès maintenant.' : 'Ce projet n’a pas d’enveloppe. Ses règlements restent dans son historique ; attribuer une enveloppe ne reprend pas les paiements antérieurs.';
      case 'income': return 'Cette entrée appartient au budget du projet. Elle ne devient pas automatiquement une entrée du projet de vie ; les retours au projet de vie se pilotent depuis la tâche.';
      case 'pending': return 'Cette dépense est prévue dans le projet. Elle remontera au Dépensé du projet de vie lors de son règlement, selon sa date réelle et l’attribution de l’enveloppe.';
      default: return '';
    }
  }

  /** Règle l'échéance. `fund` : la part et le dépassement nécessaires sont accordés par le middleware dans la même écriture. */
  async settle(v: LineDetail, fund?: { notice: string }) {
    if (this.busy()) return;
    const signatureAtStart = this.settlementSignature();
    // Une autorisation proposée pour un montant ne vaut jamais pour une autre saisie.
    const fundCurrent = !!fund && this.refusedFor() === signatureAtStart;
    const amount = this.realAmount() ? parseAmount(this.realAmount()) : undefined;
    if (amount === 'invalid' || (typeof amount === 'number' && amount <= 0)) {
      this.actionError.set(new ApiError(400, { code: 'VALIDATION', action: null, message: 'Montant réel positif attendu.' }));
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    try {
      const body = { realizedDate: this.realDate(), ...(typeof amount === 'number' ? { realizedAmount: amount } : {}) };
      if (v.line.direction === 'charge') {
        const input = {
          budgetId: v.line.budgetId, direction: v.line.direction, label: v.line.label,
          amount: v.line.plannedCents / 100, date: v.line.plannedDate,
          costCenterRef: v.line.costCenterRef ?? undefined, categoryId: v.line.categoryId,
          settle: true, ...body,
          ...(v.line.kind === 'occurrence' && v.line.recurrenceId && v.line.occurrenceDate
            ? { recurrenceId: v.line.recurrenceId, occurrenceDate: v.line.occurrenceDate }
            : { replaceId: v.line.operationId ?? v.line.id }),
        };
        const warnings = this.settleWarnings(v);
        let signature: string | null = warnings.length ? JSON.stringify({ input, warnings }) : null;
        if (warnings.length) this.message.set(warnings.join(' ') + ' Confirmez ce règlement si ces dates sont voulues.');
        try {
          const preview = await this.bpm.previewCaps(input);
          if (preview.alerts.length) {
            signature = JSON.stringify({ input, warnings, alerts: preview.alerts });
            this.message.set(`${warnings.join(' ')} Attention avant paiement (${preview.period.label}) : ${preview.alerts.map(capAlertText).join(' ; ')}. Le paiement reste autorisé.`);
          }
        } catch {
          signature = JSON.stringify({ input, unavailable: true });
          this.message.set('Vérification des plafonds indisponible. Vous pouvez confirmer le paiement sans cette vérification.');
        }
        if (signature && signature !== this.settleConfirmation()) {
          this.settleConfirmation.set(signature);
          return;
        }
      }
      if (signatureAtStart !== this.settlementSignature()) {
        this.message.set('La saisie a changé pendant la vérification. Vérifiez la date et le montant, puis relancez le règlement.');
        return;
      }
      const r =
        v.line.kind === 'occurrence' && v.line.recurrenceId && v.line.occurrenceDate
          ? await this.bpm.settleOccurrence(v.line.recurrenceId, { requestKey: this.settleKey, occurrenceDate: v.line.occurrenceDate, ...body, fund: fundCurrent })
          : await this.bpm.realizeOperation(v.line.operationId ?? v.line.id, { expectedRevision: v.line.revision ?? 0, ...body, fund: fundCurrent });
      // Un plafond dépassé est signalé, jamais bloquant : le règlement est enregistré.
      const done = v.line.direction === 'income' ? 'Entrée marquée reçue.' : 'Charge marquée payée.';
      this.message.set(withCapAlerts(fundCurrent ? `${fund!.notice} ${done}` : done, r.capAlerts));
      this.settleConfirmation.set(null);
      this.settleKey = newRequestKey('settle');
      this.refresh.bump();
    } catch (e) {
      this.actionError.set(toApiError(e));
      this.refusedFor.set(signatureAtStart);
    } finally {
      this.busy.set(false);
    }
  }

  /** Refus « dépassement à autoriser » : le budget de vie peut l'accorder ici et enchaîner le règlement. */
  protected overrun = computed(() => {
    if (this.refusedFor() !== this.settlementSignature()) return null;
    const e = this.actionError();
    if (e?.body.code !== 'OVERRUN_AUTHORIZATION_REQUIRED') return null;
    const x = e.body.details as unknown as { budgetId: string; taskId: string | null; overrunCents: number };
    return x?.budgetId && x.overrunCents > 0 ? x : null;
  });
  protected money = cents;
  protected decisionNotice = signal<string | null>(null);
  protected readonly funding = inject(ProjectFunding);
  protected readonly act = FUNDING_ACTIONS;

  /** Refus « part de tâche insuffisante » (projet en mode strict) : la part peut être portée au montant nécessaire ici. */
  protected shareGap = computed(() => {
    if (this.refusedFor() !== this.settlementSignature()) return null;
    const e = this.actionError();
    const x = e?.body.details as unknown as ShareGap | undefined;
    return x?.reason === 'task-share' && x.budgetId && x.taskId ? x : null;
  });

  /** Enchaîne un geste de financement (fonctions de `ProjectFunding`, communes aux pages projet) puis le règlement. */
  private async fundThenSettle(step: () => Promise<string | null>) {
    const v = this.d();
    if (!v) return;
    this.busy.set(true);
    try {
      this.decisionNotice.set(await step());
    } catch (e) {
      this.actionError.set(toApiError(e));
      this.busy.set(false);
      return;
    }
    this.busy.set(false);
    // L'alerte de plafond déjà confirmée reste confirmée : le règlement s'enchaîne sans seconde confirmation.
    await this.settle(v);
  }

  /** La demande en attente couvre ce règlement ; si les parts ont changé depuis, l'avertissement s'affiche et « Accorder … » prend le relais. */
  approvePendingAndSettle(po: PendingOverrun) {
    return this.fundThenSettle(async () => (await this.funding.decide(po, 'approve')).notice ?? null);
  }

  /** Une écriture : la part de la tâche est portée au nécessaire (dépassement compris) et l'échéance réglée. */
  grantShareAndSettle(g: ShareGap) {
    const v = this.d();
    return v && this.settle(v, { notice: FUNDING_RESULTS.granted(g.taskTitle, g.neededCents, g.grantOverrunCents) });
  }

  /** Une écriture : le dépassement est autorisé et l'échéance réglée. */
  authorizeAndSettle() {
    const v = this.d();
    return v && this.settle(v, { notice: FUNDING_RESULTS.approved });
  }

  protected confirmCancelEntry = signal(false);

  async cancelEntry(v: LineDetail) {
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await this.bpm.cancelOperation(v.line.operationId!, v.line.revision ?? 0, 'Annulée depuis le détail de l’échéance');
      this.refresh.bump();
      this.closed.emit();
    } catch (e) {
      this.actionError.set(toApiError(e));
    } finally {
      this.busy.set(false);
      this.confirmCancelEntry.set(false);
    }
  }

  async cancel(v: LineDetail) {
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await this.bpm.cancelRealization(v.line.operationId!, v.line.revision ?? 0);
      this.message.set('Règlement annulé : l’échéance redevient attendue.');
      this.refresh.bump();
    } catch (e) {
      this.actionError.set(toApiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
