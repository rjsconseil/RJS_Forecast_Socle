import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, newRequestKey, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmBudgetRef } from '../../core/bpm-models';
import { BpmProjectDetail, BpmTaskCard, OverrunRefusal, ProjectChargeLine, ProjectOverrun, ReturnCadence } from '../../core/bpm-projects.models';
import { COLUMNS, TASK_STATUS_LABEL, TaskStatus } from '../../core/models';
import { CentsPipe, parseAmount, ShortDatePipe } from '../../core/format';
import { BpmOperationEditor } from '../ui/operation-editor';
import { BpmBudgetMeterComponent, BpmBudgetStateComponent, BpmOverrunRequestComponent } from './project-parts';

const today = () => new Date().toISOString().slice(0, 10);
const RETURN_CADENCES: { id: ReturnCadence; label: string }[] = [
  { id: 'once', label: 'Ponctuel' },
  { id: 'weekly', label: 'Hebdomadaire' },
  { id: 'monthly', label: 'Mensuel' },
  { id: 'yearly', label: 'Annuel' },
];

/** Action refusée faute de budget, en attente de la décision du budget de vie. */
interface OverrunFlow {
  refusal: OverrunRefusal;
  message: string;
  label: string;
  retry: () => Promise<unknown>;
  request: ProjectOverrun | null;
}

/**
 * Fiche BPM d'un projet de la vie. Projet standard : budget attribué par le budget de vie (charge non récurrente
 * spéciale du budget de vie), ventilation sur les tâches, dépenses du projet et validation de leur règlement,
 * dépassements autorisés par le budget de vie, retours de revenus à la complétion des tâches, contrôles de fin de
 * cycle. Projet de vie : les projets qu'il finance et les décisions qui lui reviennent. Le projet et ses tâches
 * restent ceux du noyau (création, édition) ; leur état et leur rattachement passent par les commandes du noyau.
 */
@Component({
  selector: 'app-bpm-project',
  imports: [RouterLink, CentsPipe, ShortDatePipe, BpmBudgetMeterComponent, BpmBudgetStateComponent, BpmOverrunRequestComponent, BpmOperationEditor],
  template: `
    <div class="page page-wide bpm-projects bpm-project-page">
      <a class="text-link" routerLink="/app/projets">← Projets de la vie</a>

      @if (error() && !data()) {
        <div class="empty-state" role="alert">
          <h2>Projet indisponible</h2>
          <p>{{ error() }}</p>
          <button class="btn btn-secondary" type="button" (click)="load()">Réessayer</button>
        </div>
      } @else if (!data()) {
        <div class="empty-state" role="status"><h2>Chargement du projet…</h2></div>
      } @else {
        @let d = data()!;
        <header class="bpm-project-head">
          <p class="eyebrow"><span class="eyebrow-line"></span>{{ d.role === 'life' ? 'Projet de vie · racine du budget de vie' : 'Projet standard du budget de vie' }}</p>
          <h1>{{ d.project.project.title }}</h1>
          @if (d.project.project.description) {
            <p class="page-intro">{{ d.project.project.description }}</p>
          }
          <div class="bpm-project-links">
            <span class="status-value" [attr.data-status]="d.project.view.status" [attr.title]="d.project.view.explanation"
              ><span class="status-dot" [attr.data-status]="d.project.view.status"></span>{{ d.project.view.statusLabel }}</span
            >
            @if (d.budget) {
              <bpm-budget-state [state]="d.budget.state" />
            }
            <a class="text-link" [routerLink]="['/projects', d.project.project.id]">Ouvrir dans le noyau ↗</a>
            @if (d.role === 'standard') {
              <a class="text-link" routerLink="/tasks/new" [queryParams]="{ projectId: d.project.project.id }">Créer une tâche dans le noyau ↗</a>
            }
            <a class="text-link" routerLink="/app/taches" [queryParams]="{ project: d.project.project.id }">Tableau des tâches ↗</a>
          </div>
          <p class="bpm-note">{{ d.project.view.explanation }}</p>
        </header>

        @if (notice(); as n) {
          <p class="bpm-feedback" [class.is-error]="n.error" [attr.role]="n.error ? 'alert' : 'status'">{{ n.text }}</p>
        }

        @if (flow(); as f) {
          <section class="bpm-overrun" aria-live="polite" aria-label="Autorisation du budget de vie">
            <p><strong>Budget du projet dépassé</strong> · {{ f.label }}</p>
            <p>{{ f.message }}</p>
            @if (!f.request) {
              <div class="bpm-actions">
                <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="requestAuthorization()">
                  Demander l’autorisation au budget de vie ({{ f.refusal.overrunCents | cents }})
                </button>
                <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="flow.set(null)">Annuler</button>
              </div>
            }
          </section>
          @if (f.request) {
            <bpm-overrun-request [overrun]="f.request" [busy]="busy()" (decide)="decideFlow($event)" />
          }
        }

        @if (d.role === 'standard' && d.budget; as b) {
          <!-- ---------- budget attribué ---------- -->
          <section class="bpm-section" aria-labelledby="budget-title">
            <header>
              <h2 id="budget-title">Budget attribué par le budget de vie</h2>
              <p>
                @if (b.regime) {
                  Attribué depuis le {{ b.allocationDate | shortDate }} : enregistré dans le budget de vie comme une charge non
                  récurrente, comptée seulement à la validation des dépenses réglées du projet.
                } @else {
                  Aucun montant attribué : le budget de vie ne finance pas encore ce projet.
                }
              </p>
            </header>
            <div class="bpm-panel">
              @if (b.regime) {
                <dl class="bpm-kpis">
                  <div><dt>Budget attribué</dt><dd>{{ b.allocationCents | cents }}</dd>@if (b.billedOverrunCents) {<small>dont {{ b.billedOverrunCents | cents }} de dépassements facturés</small>}</div>
                  <div [class.is-danger]="b.approvedOverrunCents > 0">
                    <dt>Dépassement autorisé</dt><dd>{{ b.approvedOverrunCents | cents }}</dd>
                    @if (b.nextBillingDate) {<small>facturé au budget de vie le {{ b.nextBillingDate | shortDate }}</small>}
                  </div>
                  <div><dt>Ventilé aux tâches</dt><dd>{{ b.sharesCents | cents }}</dd><small>à ventiler {{ b.availableCents | cents }}</small></div>
                  <div><dt>Engagé</dt><dd>{{ b.engagedCents | cents }}</dd><small>charges planifiées et réglées</small></div>
                  <div><dt>Réglé validé</dt><dd>{{ b.paidCents | cents }}</dd><small>compté dans le budget de vie</small></div>
                  <div [class.is-danger]="(b.remainingCents ?? 0) < 0"><dt>Reste</dt><dd>{{ b.remainingCents | cents }}</dd></div>
                </dl>
                <bpm-budget-meter [budget]="b" [figures]="false" />
              }
              <form class="bpm-inline-form" (submit)="$event.preventDefault(); allocate(b.budgetId, b.revision)">
                <label>
                  {{ b.regime ? 'Modifier le montant attribué (€)' : 'Montant attribué par le budget de vie (€)' }}
                  <input class="bpm-amount-input" inputmode="decimal" autocomplete="off" [value]="allocation()" (input)="allocation.set($any($event.target).value)" />
                </label>
                <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ b.regime ? 'Enregistrer' : 'Attribuer' }}</button>
              </form>
              @if (b.paidBeforeAllocationCents) {
                <p class="bpm-note">{{ b.paidBeforeAllocationCents | cents }} réglés avant l’attribution restent dans l’historique du projet, hors budget du budget de vie.</p>
              }
            </div>
            @if (b.pendingOverrun; as o) {
              @if (!flow()?.request) {
                <bpm-overrun-request [overrun]="o" [busy]="busy()" (decide)="decide(o, $event)" />
              }
            }
          </section>

          <!-- ---------- ventilation sur les tâches ---------- -->
          <section class="bpm-section" aria-labelledby="shares-title">
            <header>
              <h2 id="shares-title">Ventilation sur les tâches</h2>
              <p>Chaque part réduit le budget à ventiler ; au-delà, le budget de vie doit autoriser le dépassement.</p>
            </header>
            @if (!d.tasks.length) {
              <p class="bpm-note">Aucune tâche : créez-en une dans le noyau, ou rattachez une tâche existante ci-dessous.</p>
            } @else {
              <div class="bpm-table-wrap">
                <table class="bpm-table">
                  <thead>
                    <tr>
                      <th scope="col">Tâche</th>
                      <th scope="col">État</th>
                      <th scope="col" class="num">Part de budget</th>
                      <th scope="col" class="num">Engagé</th>
                      <th scope="col" class="num">Réglé validé</th>
                      <th scope="col" class="num">Reste</th>
                      <th scope="col">Retour au budget de vie</th>
                      <th scope="col"><span class="visually-hidden">Rattachement</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (t of d.tasks; track t.task.id) {
                      @let tb = t.budget;
                      <tr [attr.data-over]="tb?.over || null">
                        <th scope="row">{{ t.task.title }}</th>
                        <td>
                          <select [attr.aria-label]="'État de ' + t.task.title" [disabled]="busy()" (change)="changeStatus(t, $any($event.target).value, $any($event.target))">
                            @for (c of columns; track c.id) {
                              <option [value]="c.id" [selected]="c.id === t.task.status">{{ c.label }}</option>
                            }
                          </select>
                        </td>
                        <td class="num">
                          @if (b.regime) {
                            <form class="bpm-cell-form" (submit)="$event.preventDefault(); saveShare(b.budgetId, t, $any($event.target).elements.share.value, b.revision)">
                              <input name="share" inputmode="decimal" autocomplete="off" [attr.aria-label]="'Part de ' + t.task.title + ' en euros'" [value]="tb?.shareCents === null || tb?.shareCents === undefined ? '' : (tb!.shareCents / 100).toString().replace('.', ',')" />
                              <button type="submit" class="btn btn-secondary" [disabled]="busy()">OK</button>
                            </form>
                          } @else {
                            —
                          }
                        </td>
                        <td class="num">{{ tb?.engagedCents ?? 0 | cents }}@if (tb?.unbounded) {<small title="Récurrence sans fin : 12 mois comptés"> *</small>}</td>
                        <td class="num" [class.is-over]="tb?.over">{{ tb?.paidCents ?? 0 | cents }}</td>
                        <td class="num" [class.is-over]="(tb?.remainingCents ?? 0) < 0">{{ tb?.remainingCents ?? null | cents }}</td>
                        <td>
                          @if (tb?.return; as r) {
                            <span>{{ r.amountCents | cents }} · {{ cadenceLabel(r.cadence) }} · {{ r.entryId ? 'enregistré le ' + (r.triggeredAt ?? '') : 'à la complétion' }}</span>
                            @if (!r.entryId) {
                              <button type="button" class="text-link" [disabled]="busy()" (click)="removeReturn(b.budgetId, t, b.revision)">Retirer</button>
                            }
                          } @else if (returnEditor() === t.task.id) {
                            <form class="bpm-inline-form" (submit)="$event.preventDefault(); saveReturn(b.budgetId, t, $any($event.target).elements, b.revision)">
                              <label>Libellé<input name="label" maxlength="200" [value]="'Retour · ' + t.task.title" /></label>
                              <label>Montant (€)<input name="amount" class="bpm-amount-input" inputmode="decimal" autocomplete="off" /></label>
                              <label
                                >Cadence
                                <select name="cadence">
                                  @for (c of cadences; track c.id) {
                                    <option [value]="c.id">{{ c.label }}</option>
                                  }
                                </select>
                              </label>
                              <button type="submit" class="btn btn-primary" [disabled]="busy()">Enregistrer</button>
                              <button type="button" class="btn btn-secondary" (click)="returnEditor.set(null)">Annuler</button>
                            </form>
                          } @else {
                            <button type="button" class="text-link" (click)="returnEditor.set(t.task.id)">Prévoir un retour</button>
                          }
                        </td>
                        <td><button type="button" class="text-link" [disabled]="busy()" (click)="detach(t)">Détacher</button></td>
                      </tr>
                    }
                  </tbody>
                  @if (b.regime) {
                    <tfoot>
                      <tr>
                        <th scope="row">Total</th>
                        <td></td>
                        <td class="num"><strong>{{ b.sharesCents | cents }}</strong></td>
                        <td class="num">{{ b.engagedCents | cents }}</td>
                        <td class="num">{{ b.paidCents | cents }}</td>
                        <td class="num">{{ b.remainingCents | cents }}</td>
                        <td colspan="2"></td>
                      </tr>
                    </tfoot>
                  }
                </table>
              </div>
            }
            @if (d.attachable.length) {
              <form class="bpm-inline-form" (submit)="$event.preventDefault(); attach($any($event.target).elements.task.value)">
                <label>
                  Rattacher une tâche du noyau
                  <select name="task">
                    @for (t of d.attachable; track t.task.id) {
                      <option [value]="t.task.id">{{ t.task.title }} · {{ t.projectTitle ?? 'sans projet' }}</option>
                    }
                  </select>
                </label>
                <button type="submit" class="btn btn-secondary" [disabled]="busy()">Rattacher</button>
              </form>
            }
          </section>

          <!-- ---------- dépenses du projet ---------- -->
          <section class="bpm-section" aria-labelledby="charges-title">
            <header>
              <h2 id="charges-title">Dépenses du projet</h2>
              <p>Une dépense ne compte dans le budget de vie qu’une fois son règlement validé.</p>
              <button type="button" class="btn btn-primary" (click)="editorOpen.set(true)">Ajouter une dépense</button>
            </header>
            @if (!d.charges.length) {
              <p class="bpm-note">Aucune dépense prévue ou réglée sur les douze derniers et prochains mois.</p>
            } @else {
              <div class="bpm-table-wrap">
                <table class="bpm-table">
                  <thead>
                    <tr>
                      <th scope="col">Date prévue</th>
                      <th scope="col">Dépense</th>
                      <th scope="col" class="num">Prévu</th>
                      <th scope="col" class="num">Réglé</th>
                      <th scope="col">État</th>
                      <th scope="col"><span class="visually-hidden">Action</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (c of d.charges; track c.id) {
                      <tr>
                        <td>{{ c.plannedDate | shortDate }}</td>
                        <td>
                          {{ c.label }}
                          <small class="bpm-note">@if (c.taskTitle) {{{ c.taskTitle }} · }{{ c.cadenceLabel }}</small>
                        </td>
                        <td class="num">{{ c.plannedCents | cents }}</td>
                        <td class="num">
                          @if (c.settled) {
                            {{ c.realizedCents | cents }} <small class="bpm-note">le {{ c.realizedDate | shortDate }}</small>
                          } @else {
                            —
                          }
                        </td>
                        <td>
                          <span class="bpm-charge-state" [attr.data-state]="c.validated ? 'validated' : 'planned'">{{ chargeState(c) }}</span>
                        </td>
                        <td>
                          @if (!c.settled) {
                            @if (settling() === c.id) {
                              <form class="bpm-inline-form" (submit)="$event.preventDefault(); settle(c, $any($event.target).elements)">
                                <label>Date réelle<input name="date" type="date" [max]="today" [value]="defaultDate(c)" /></label>
                                <label>Montant (€)<input name="amount" class="bpm-amount-input" inputmode="decimal" [value]="(c.plannedCents / 100).toString().replace('.', ',')" /></label>
                                <button type="submit" class="btn btn-primary" [disabled]="busy()">Valider</button>
                                <button type="button" class="btn btn-secondary" (click)="settling.set(null)">Annuler</button>
                              </form>
                            } @else {
                              <button type="button" class="btn btn-secondary" (click)="settling.set(c.id)">Valider le règlement</button>
                            }
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>

          <!-- ---------- dépassements et fin de cycle ---------- -->
          <section class="bpm-section" aria-labelledby="cycle-title">
            <header>
              <h2 id="cycle-title">Dépassements et fin de cycle</h2>
              <p>À la fin du cycle, les dépassements autorisés sont facturés au budget de vie, puis le budget du projet est revalidé.</p>
            </header>
            @if (d.overruns.length) {
              <div class="bpm-table-wrap">
                <table class="bpm-table">
                  <thead>
                    <tr>
                      <th scope="col">Demandé le</th>
                      <th scope="col">Objet</th>
                      <th scope="col" class="num">Montant</th>
                      <th scope="col">Décision</th>
                      <th scope="col">Facturation</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (o of d.overruns; track o.id) {
                      <tr>
                        <td>{{ o.requestedAt | shortDate }}</td>
                        <td>{{ o.reasonLabel }}@if (o.taskTitle) { · {{ o.taskTitle }} }</td>
                        <td class="num">{{ o.amountCents | cents }}</td>
                        <td>{{ o.statusLabel }}</td>
                        <td>{{ o.billedAt ? 'Facturé le ' : o.billingDate ? 'Fin de cycle, le ' : '' }}{{ (o.billedAt ?? o.billingDate) | shortDate }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              @if (billable()) {
                <div class="bpm-actions">
                  <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="bill(b.budgetId)">Facturer au budget de vie (fin de cycle)</button>
                </div>
              }
            } @else {
              <p class="bpm-note">Aucun dépassement demandé pour ce projet.</p>
            }
            @if (d.checks.length) {
              <ul class="bpm-checks" aria-label="Contrôles de fin de cycle">
                @for (c of d.checks; track $index) {
                  <li [attr.data-level]="c.level">{{ c.message }}</li>
                }
              </ul>
            }
          </section>
        }

        @if (d.role === 'life' && d.life; as l) {
          <section class="bpm-section" aria-labelledby="life-title">
            <header>
              <h2 id="life-title">Projets financés par le budget de vie</h2>
              <p>Le budget de vie attribue un montant à chaque projet standard et décide de leurs dépassements.</p>
            </header>
            @for (o of l.pendingRequests; track o.id) {
              <bpm-overrun-request [overrun]="o" [busy]="busy()" (decide)="decide(o, $event)" />
            }
            @if (l.billable.length) {
              <div class="bpm-overrun">
                <p><strong>Fin de cycle :</strong> {{ l.billableCents | cents }} de dépassement(s) autorisé(s) à facturer au budget de vie.</p>
                <div class="bpm-actions">
                  <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="bill()">Facturer au budget de vie</button>
                </div>
              </div>
            }
            <div class="bpm-table-wrap">
              <table class="bpm-table">
                <thead>
                  <tr>
                    <th scope="col">Projet</th>
                    <th scope="col" class="num">Attribué</th>
                    <th scope="col" class="num">Ventilé</th>
                    <th scope="col" class="num">Réglé validé</th>
                    <th scope="col" class="num">Reste</th>
                    <th scope="col">État</th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of l.projects; track p.projectId) {
                    <tr>
                      <th scope="row"><a class="text-link" [routerLink]="['/app/projets', p.projectId]">{{ p.title }}</a></th>
                      @if (p.budget.regime) {
                        <td class="num">{{ p.budget.allocationCents | cents }}</td>
                        <td class="num">{{ p.budget.sharesCents | cents }}</td>
                        <td class="num">{{ p.budget.paidCents | cents }}</td>
                        <td class="num">{{ p.budget.remainingCents | cents }}</td>
                      } @else {
                        <td class="num">Non attribué</td>
                        <td class="num">—</td>
                        <td class="num" title="Ses dépenses ne sont pas comptées dans le budget de vie tant qu’aucun montant ne lui est attribué">—</td>
                        <td class="num">—</td>
                      }
                      <td><bpm-budget-state [state]="p.budget.state" /></td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6">Aucun projet standard : budgétez un projet du noyau depuis Projets de la vie.</td></tr>
                  }
                </tbody>
              </table>
            </div>
            @if (d.tasks.length) {
              <p class="bpm-note">
                {{ d.tasks.length }} tâche(s) reliée(s) directement à la racine du projet de vie, hors parcours : rattachez-les à un
                projet standard depuis le tableau des tâches.
              </p>
            }
          </section>
        }
      }
    </div>

    @if (editorOpen() && budgetRef(); as ref) {
      <bpm-operation-editor [budgets]="[ref]" [defaults]="{ budgetId: ref.id, direction: 'charge' }" (closed)="editorOpen.set(false)" (saved)="onSaved($event)" />
    }
  `,
})
export class BpmProjectPage {
  private api = inject(Api);
  private bpm = inject(BpmApi);
  private route = inject(ActivatedRoute);
  protected columns = COLUMNS;
  protected cadences = RETURN_CADENCES;
  protected readonly today = today();
  protected data = signal<BpmProjectDetail | null>(null);
  protected error = signal<string | null>(null);
  protected busy = signal(false);
  protected notice = signal<{ text: string; error: boolean } | null>(null);
  protected flow = signal<OverrunFlow | null>(null);
  protected allocation = signal('');
  protected returnEditor = signal<string | null>(null);
  protected settling = signal<string | null>(null);
  protected editorOpen = signal(false);
  private projectId = '';

  protected budgetRef = computed<BpmBudgetRef | null>(() => {
    const b = this.data()?.budget;
    return b ? { id: b.budgetId, name: b.name, role: 'standard', coreProjectId: b.coreProjectId, capsCents: {}, revision: b.revision } : null;
  });
  protected billable = computed(() => (this.data()?.overruns ?? []).some((o) => o.status === 'approved' && (!o.billingDate || o.billingDate <= today())));

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((p) => {
      this.projectId = p.get('id') ?? '';
      this.data.set(null);
      this.flow.set(null);
      this.notice.set(null);
      this.load();
    });
  }

  async load() {
    try {
      const d = await this.bpm.projectDetail(this.projectId);
      this.data.set(d);
      this.allocation.set(d.budget?.allocationCents === null || d.budget?.allocationCents === undefined ? '' : (d.budget.allocationCents / 100).toString().replace('.', ','));
      this.error.set(null);
    } catch (err) {
      this.error.set(toApiError(err).message);
    }
  }

  protected cadenceLabel(c: ReturnCadence) {
    return RETURN_CADENCES.find((x) => x.id === c)?.label.toLowerCase() ?? c;
  }

  protected chargeState(c: ProjectChargeLine) {
    if (c.validated) return 'Réglée · validée';
    if (c.beforeAllocation) return 'Réglée avant l’attribution';
    if (c.settled) return 'Réglée';
    return c.kind === 'occurrence' ? 'Échéance attendue' : 'À valider';
  }

  protected defaultDate(c: ProjectChargeLine) {
    return c.plannedDate <= today() ? c.plannedDate : today();
  }

  /**
   * Écriture avec relecture. Un refus « autorisation de dépassement requise » ouvre la demande au budget de vie ;
   * une fois le dépassement autorisé, la même écriture est rejouée.
   */
  private async run(action: () => Promise<unknown>, success: string, label = '') {
    this.busy.set(true);
    this.notice.set(null);
    try {
      await action();
      this.flow.set(null);
      await this.load();
      this.notice.set({ text: success, error: false });
      return true;
    } catch (err) {
      const e = toApiError(err);
      if (e.body.code === 'OVERRUN_AUTHORIZATION_REQUIRED') {
        this.flow.set({ refusal: e.body.details as unknown as OverrunRefusal, message: e.message, label, retry: action, request: null });
        return false;
      }
      await this.load();
      this.notice.set({ text: e.isConflict ? 'Conflit : la donnée a changé ailleurs. La fiche a été relue ; recommencez si besoin.' : e.message, error: true });
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async requestAuthorization() {
    const f = this.flow();
    if (!f) return;
    this.busy.set(true);
    try {
      const r = await this.bpm.requestOverrun(f.refusal.budgetId, {
        requestKey: newRequestKey(),
        taskId: f.refusal.taskId,
        reason: f.refusal.reason,
        amount: f.refusal.overrunCents / 100,
      });
      this.flow.set({ ...f, request: r.overrun });
    } catch (err) {
      this.notice.set({ text: toApiError(err).message, error: true });
    } finally {
      this.busy.set(false);
    }
  }

  /** Décision du budget de vie sur la demande ouverte par une écriture refusée ; autoriser rejoue l'écriture. */
  protected async decideFlow(decision: 'approve' | 'refuse') {
    const f = this.flow();
    if (!f?.request) return;
    this.busy.set(true);
    try {
      await this.bpm.decideOverrun(f.request.id, decision, f.request.revision);
    } catch (err) {
      this.busy.set(false);
      this.notice.set({ text: toApiError(err).message, error: true });
      return;
    }
    this.busy.set(false);
    if (decision === 'refuse') {
      this.flow.set(null);
      await this.load();
      this.notice.set({ text: 'Dépassement refusé par le budget de vie : rien n’a été enregistré.', error: false });
      return;
    }
    await this.run(f.retry, `Dépassement autorisé par le budget de vie : ${f.label || 'l’écriture'} est enregistrée ; le projet passe en dépassement jusqu’à la facturation de fin de cycle.`, f.label);
  }

  protected decide(o: ProjectOverrun, decision: 'approve' | 'refuse') {
    return this.run(() => this.bpm.decideOverrun(o.id, decision, o.revision), decision === 'approve' ? 'Dépassement autorisé par le budget de vie.' : 'Demande refusée par le budget de vie.');
  }

  protected allocate(budgetId: string, revision: number) {
    const amount = parseAmount(this.allocation());
    if (amount === null || amount === 'invalid' || amount < 0) {
      this.notice.set({ text: 'Indiquez un montant en euros (deux décimales au plus).', error: true });
      return;
    }
    return this.run(() => this.bpm.allocate(budgetId, amount, revision), 'Montant attribué par le budget de vie enregistré.');
  }

  protected saveShare(budgetId: string, t: BpmTaskCard, raw: string, revision: number) {
    const amount = parseAmount(raw);
    if (amount === 'invalid' || (amount !== null && amount < 0)) {
      this.notice.set({ text: 'Indiquez une part en euros (deux décimales au plus), ou laissez vide pour la retirer.', error: true });
      return;
    }
    return this.run(
      () => this.bpm.setTaskShare(budgetId, t.task.id, amount, revision),
      amount === null ? `Part de « ${t.task.title} » retirée.` : `Part de « ${t.task.title} » enregistrée.`,
      `la part de « ${t.task.title} »`,
    );
  }

  protected async saveReturn(budgetId: string, t: BpmTaskCard, f: HTMLFormControlsCollection, revision: number) {
    const get = (n: string) => (f.namedItem(n) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
    const amount = parseAmount(get('amount'));
    if (amount === null || amount === 'invalid' || amount <= 0) {
      this.notice.set({ text: 'Indiquez le montant du retour en euros.', error: true });
      return;
    }
    const ok = await this.run(
      () => this.bpm.setTaskReturn(budgetId, t.task.id, { label: get('label'), amount, cadence: get('cadence') as ReturnCadence, expectedRevision: revision }),
      t.task.status === 'done' ? `Retour enregistré dans le budget de vie : « ${t.task.title} » est déjà terminée.` : `Retour prévu : il sera enregistré dans le budget de vie quand « ${t.task.title} » sera terminée.`,
    );
    if (ok) this.returnEditor.set(null);
  }

  protected removeReturn(budgetId: string, t: BpmTaskCard, revision: number) {
    return this.run(() => this.bpm.setTaskReturn(budgetId, t.task.id, { amount: null, expectedRevision: revision }), `Retour de « ${t.task.title} » retiré.`);
  }

  protected async changeStatus(t: BpmTaskCard, status: TaskStatus, select: HTMLSelectElement) {
    if (status === t.task.status) return;
    this.busy.set(true);
    try {
      const r = await this.api.changeTaskStatus(t.task.id, status, t.task.revision);
      const project = r.affectedProjects?.[0];
      await this.load();
      this.notice.set({
        text: [`« ${r.task.title} » enregistrée en ${TASK_STATUS_LABEL[r.task.status]}.`, project ? `Projet : ${project.view.statusLabel}.` : '', ...(r.effects ?? []).map((x) => x.message)].filter(Boolean).join(' '),
        error: false,
      });
    } catch (err) {
      select.value = t.task.status;
      const e = toApiError(err);
      await this.load();
      this.notice.set({ text: e.isConflict ? 'Conflit : la tâche a changé ailleurs. La fiche a été relue.' : e.message, error: true });
    } finally {
      this.busy.set(false);
    }
  }

  protected attach(taskId: string) {
    const t = this.data()?.attachable.find((x) => x.task.id === taskId);
    if (!t) return;
    return this.run(() => this.api.attachTask(t.task.id, this.projectId, t.task.revision), `« ${t.task.title} » rattachée au projet (commande du noyau).`);
  }

  protected detach(t: BpmTaskCard) {
    return this.run(() => this.api.detachTask(t.task.id, t.task.revision), `« ${t.task.title} » détachée : elle reste dans le noyau, sans projet.`);
  }

  protected settle(c: ProjectChargeLine, f: HTMLFormControlsCollection) {
    const get = (n: string) => (f.namedItem(n) as HTMLInputElement | null)?.value ?? '';
    const amount = parseAmount(get('amount'));
    const realizedDate = get('date');
    if (amount === null || amount === 'invalid' || amount <= 0 || !realizedDate) {
      this.notice.set({ text: 'Indiquez la date et le montant réellement réglés.', error: true });
      return;
    }
    const requestKey = newRequestKey();
    const action = () =>
      c.kind === 'occurrence' && c.recurrenceId && c.occurrenceDate
        ? this.bpm.settleOccurrence(c.recurrenceId, { requestKey, occurrenceDate: c.occurrenceDate, realizedAmount: amount, realizedDate })
        : this.bpm.realizeOperation(c.operationId!, { expectedRevision: c.revision ?? 0, realizedAmount: amount, realizedDate });
    return this.run(
      async () => {
        await action();
        this.settling.set(null);
      },
      `Règlement de « ${c.label} » validé : il compte maintenant dans les dépenses du budget de vie.`,
      `le règlement de « ${c.label} »`,
    );
  }

  protected bill(budgetId?: string) {
    return this.run(() => this.bpm.billOverruns(budgetId), 'Dépassements facturés au budget de vie : le budget attribué les intègre. Relisez les contrôles de fin de cycle.');
  }

  protected async onSaved(message: string) {
    this.editorOpen.set(false);
    await this.load();
    this.notice.set({ text: message, error: false });
  }
}
