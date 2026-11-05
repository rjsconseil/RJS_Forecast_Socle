import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { CapsReview, ReviewCategory, ReviewCharge } from '../../core/bpm-caps.models';
import { EntryInput, RegisterLine } from '../../core/bpm-models';
import { cents, CentsPipe, percentText, ShortDatePipe, SignedCentsPipe } from '../../core/format';
import { PeriodNavigationComponent } from '../../shared/period-navigation.component';
import { BpmLifeGaugeComponent } from '../life/life-gauge';
import { BpmLineDetail, BpmOperationEditor, capEuroText, capInput } from '../ui';
import { newRequestKey, shiftPeriod } from '../ui/page-context';
import { anteriorityText, CapCard, healthOf, recurrenceText, REVIEW_MODES, ReviewMode, reviewCards, reviewSummary, statusText } from './caps-review';

/**
 * Plafonds & catégories : savoir à tout moment ce qu'il reste sous chaque plafond avant d'acheter, et, une fois
 * dans le rouge, revoir les charges qui, ensemble, font dépasser un poste ou une catégorie — leur récurrence,
 * leur antériorité — et ce qu'il faut compenser ailleurs pour ne pas finir la période en déficit.
 * Les plafonds ne bloquent jamais rien ; retirer ou réduire une charge reste la décision de l'utilisateur.
 * Mise en page de « Gestion du projet de vie » : bandeau, synthèse chiffrée, cartes pleine largeur dépliables.
 */
@Component({
  selector: 'app-bpm-caps-page',
  styleUrls: ['../projects/projects.page.scss', '../life/life-management.page.scss', './caps.scss'],
  imports: [FormsModule, RouterLink, CentsPipe, SignedCentsPipe, ShortDatePipe, PeriodNavigationComponent, BpmLifeGaugeComponent, BpmLineDetail, BpmOperationEditor],
  template: `
    <div class="page page-wide bpm-projects bpm-project-page bpm-management bpm-life-management bpm-caps-page">
      <header class="life-projects-banner" data-ui-pattern="heading" data-sticky-hero>
        <div class="life-banner-copy">
          <p class="eyebrow">Budget/Patrimoine · Ma vision budgétaire</p>
          <h1 class="display">Plafonds & catégories</h1>
          <p class="page-intro">
            Sachez à tout moment ce qu’il vous reste sous chaque plafond avant d’acheter. Une fois dans le rouge, revoyez
            les charges qui font dépasser et ce qu’il faut compenser ailleurs pour ne pas finir la période en déficit.
          </p>
        </div>
        <div class="life-header-actions">
          <a class="btn btn-secondary" [routerLink]="[]" fragment="reglages" queryParamsHandling="preserve">Régler les plafonds</a>
          @if (d()?.context?.period; as p) {
            <rjs-period-navigation
              class="life-period-nav"
              tone="accent"
              [start]="p.start"
              [end]="p.endExclusive"
              label="Période consultée"
              previousLabel="Période précédente"
              nextLabel="Période suivante"
              currentLabel="Revenir à la période en cours"
              compactCurrentLabel="Revenir"
              [status]="atCurrent() ? 'Période actuelle' : 'Période consultée'"
              [compactStatus]="atCurrent() ? 'Actuelle' : 'Consultée'"
              [previousQuery]="periodQuery(-1)"
              [nextQuery]="periodQuery(1)"
              [currentQuery]="{ period: null }"
              [previousDisabled]="atFirst()"
              [nextDisabled]="atCurrent()"
              [busy]="loading()"
            />
          }
        </div>
        <div class="life-banner-tools" aria-label="Commandes de la revue des plafonds">
          <label>
            Regrouper
            <select [value]="mode()" (change)="mode.set($any($event.target).value)">
              @for (m of modes; track m.key) {
                <option [value]="m.key">{{ m.label }}</option>
              }
            </select>
          </label>
          <label>
            Afficher
            <select [value]="show()" (change)="show.set($any($event.target).value)">
              <option value="all">Tous les plafonds</option>
              <option value="over">Dépassements seulement</option>
            </select>
          </label>
          <button class="btn btn-primary life-create" type="button" [disabled]="!budgets().length" (click)="openEntry()">
            <span aria-hidden="true">+</span> Saisir une charge
          </button>
        </div>
      </header>

      <section class="life-summary" aria-label="Synthèse des plafonds" [attr.aria-busy]="!d()">
        <div class="life-project-stats" aria-label="État des plafonds">
          <div class="life-stat life-stat-total">
            <span>Plafonds dépassés</span><strong>{{ d() ? d()!.totals.overCount : '—' }}</strong>
          </div>
          <div class="life-stat">
            <span><i class="status-dot life-health-dot" data-health="alert" aria-hidden="true"></i>Postes · catégories</span
            ><strong>{{ s() ? s()!.overCenters + ' · ' + s()!.overCategories : '—' }}</strong>
          </div>
          <div class="life-stat">
            <span><i class="status-dot life-health-dot" data-health="watch" aria-hidden="true"></i>Proches du plafond</span><strong>{{ s() ? s()!.near : '—' }}</strong>
          </div>
          <div class="life-stat">
            <span><i class="status-dot life-health-dot" data-health="ok" aria-hidden="true"></i>Dans le plafond</span><strong>{{ s() ? s()!.within : '—' }}</strong>
          </div>
          <div class="life-progress">
            <span>Plafonds des postes engagés</span><strong>{{ pct(s()?.usedPct ?? null) }}</strong>
            <div class="progress-track" role="progressbar" aria-label="Part engagée des plafonds de postes" [attr.aria-valuenow]="s()?.usedPct ?? null" aria-valuemin="0" aria-valuemax="100">
              <span [style.width.%]="bar(s()?.usedPct ?? 0)" [class.is-over]="(s()?.usedPct ?? 0) > 100"></span>
            </div>
          </div>
        </div>
        <dl class="life-financial-stats" aria-label="Plafonds et solde de la période">
          <div class="life-financial-stat life-allocated">
            <dt>Plafonds des postes</dt>
            <dd>{{ s() ? (s()!.capCents | cents) : '—' }}</dd>
            <span>Engagé {{ s() ? (s()!.engagedCents | cents) : '—' }}</span>
          </div>
          <div class="life-financial-stat life-paid">
            <dt>Marge sous les plafonds</dt>
            <dd>{{ d() ? (d()!.totals.headroomCents | cents) : '—' }}</dd>
            <span>Postes encore dans leur plafond</span>
          </div>
          <div class="life-financial-stat life-remaining" [class.is-negative]="(d()?.totals?.toCompensateCents ?? 0) > 0">
            <dt>À compenser</dt>
            <dd>{{ d() ? (d()!.totals.toCompensateCents | cents) : '—' }}</dd>
            <span>Au-delà des plafonds, à reprendre ailleurs</span>
          </div>
          <div class="life-financial-stat life-available" [class.is-negative]="(d()?.totals?.expectedCents ?? 0) < 0">
            <dt>Solde prévu à la clôture</dt>
            <dd>{{ expected() }}</dd>
            <span>{{ verdict() }}</span>
          </div>
        </dl>
      </section>

      @if (notice(); as n) {
        <p class="bpm-feedback" [class.is-error]="n.error" [attr.role]="n.error ? 'alert' : 'status'">{{ n.text }}</p>
      }
      @if (error()) {
        <div class="empty-state" role="alert">
          <h2>Plafonds indisponibles</h2>
          <p>{{ error() }}</p>
          <button class="btn btn-secondary" type="button" (click)="load()">Réessayer</button>
        </div>
      } @else if (!d()) {
        <p role="status">Chargement des plafonds…</p>
      }

      @if (d(); as d) {
        <section class="bpm-section caps-review" aria-labelledby="caps-review-title">
          <header>
            <h2 id="caps-review-title">Revue des plafonds · {{ d.context.period?.label }}</h2>
            <span class="bpm-note">{{ reviewNote() }}</span>
          </header>
          <nav class="caps-modes" aria-label="Regrouper les plafonds">
            @for (m of modes; track m.key) {
              <button type="button" class="caps-mode" [class.is-selected]="mode() === m.key" [attr.aria-pressed]="mode() === m.key" (click)="mode.set(m.key)">{{ m.label }}</button>
            }
          </nav>

          @if (!cards().length) {
            <div class="empty-state caps-empty">
              @if (show() === 'over' && allCards().length) {
                <h3>Aucun dépassement sur la période</h3>
                <p>Tous vos plafonds sont respectés : chaque carte montre ce qu’il reste avant d’acheter.</p>
                <button class="btn btn-secondary" type="button" (click)="show.set('all')">Voir tous les plafonds</button>
              } @else {
                <h3>Aucun plafond {{ mode() === 'category' ? 'de catégorie' : 'de poste' }}</h3>
                <p>Fixez un montant maximal ci-dessous : la page suivra ce qu’il vous reste et signalera tout dépassement, sans jamais bloquer une dépense.</p>
                <a class="btn btn-primary" [routerLink]="[]" fragment="reglages" queryParamsHandling="preserve">Régler les plafonds</a>
              }
            </div>
          }

          <div class="bpm-management-grid">
            @for (c of cards(); track c.key) {
              <article class="bpm-management-card life-volet caps-card" [class.is-expanded]="isOpen(c)" [attr.data-health]="c.health" [attr.aria-label]="c.level + ' ' + c.title">
                <div class="bpm-panel pm-project-overview">
                  <div class="bpm-project-row-summary">
                    <div class="bpm-project-links">
                      <span class="pm-life-health" [attr.data-health]="c.health">{{ c.healthLabel }}</span
                      ><span class="pm-life-tag">{{ c.level }}</span>
                    </div>
                    <h3>{{ c.title }}</h3>
                    <p class="pm-project-description"><span>{{ c.description }}</span></p>
                    <dl class="pm-project-facts">
                      @for (f of c.facts; track f.label) {
                        <div>
                          <dt>{{ f.label }}</dt>
                          <dd>{{ f.value }}</dd>
                          <small>{{ f.note ?? '' }}</small>
                        </div>
                      }
                    </dl>
                  </div>
                  <div class="bpm-project-row-budget">
                    <bpm-life-gauge [gauge]="c.gauge" />
                  </div>
                  @if (c.alert) {
                    <p class="pm-project-alert" [attr.data-health]="c.health">{{ c.alert }}</p>
                  }
                  <button type="button" class="pm-project-disclosure" [attr.aria-expanded]="isOpen(c)" [attr.aria-controls]="'caps-card-' + c.key" (click)="toggle(c)">
                    <span
                      ><strong>{{ isOpen(c) ? 'Masquer les charges' : 'Revoir les charges' }}</strong
                      ><span>{{ c.chargeCount ? c.chargeCount + ' charge' + (c.chargeCount > 1 ? 's' : '') + ' forment l’engagé, les plus lourdes d’abord' : 'Aucune charge sur la période' }}</span></span
                    >
                    <span class="pm-disclosure-sign" aria-hidden="true">{{ isOpen(c) ? '−' : '+' }}</span>
                  </button>
                </div>
                <aside class="pm-project-command-panel" [attr.aria-label]="'Commandes · ' + c.title">
                  <div class="bpm-actions bpm-project-row-actions">
                    <button class="btn btn-primary" type="button" [disabled]="!budgets().length" (click)="openEntry(c)">Saisir une charge ici</button>
                    <a class="btn btn-secondary" [routerLink]="[]" [fragment]="c.level === 'Poste' ? 'reglages' : 'reglages-categories'" queryParamsHandling="preserve">Changer le plafond</a>
                  </div>
                  <dl class="pm-command-figures">
                    <div [class.has-pending]="c.health === 'alert'">
                      <dt>{{ c.health === 'alert' ? 'Dépassement' : 'Reste avant le plafond' }}</dt>
                      <dd>{{ c.health === 'alert' ? '+' + money(c.overCents) : c.gauge.last.value }}</dd>
                    </div>
                    <div>
                      <dt>Engagé</dt>
                      <dd>{{ c.gauge.middle.value }} · {{ c.gauge.meter.label }}</dd>
                    </div>
                  </dl>
                </aside>
                @if (isOpen(c)) {
                  <div class="pm-project-tasks life-volet-detail caps-detail" [id]="'caps-card-' + c.key">
                    @for (g of c.groups; track g.key) {
                      @if (g.label) {
                        <p class="caps-group-head" [attr.data-health]="g.health">
                          <strong>{{ g.label }}</strong>
                          @if (g.note) {
                            <span>{{ g.note }}</span>
                          }
                        </p>
                      }
                      @if (g.charges.length) {
                        <div class="caps-table-wrap">
                          <table class="bpm-table caps-charges">
                            <thead>
                              <tr>
                                <th scope="col">Charge</th>
                                <th scope="col">Engagée</th>
                                <th scope="col">Récurrence</th>
                                <th scope="col">Antériorité</th>
                                <th scope="col" class="num">Montant</th>
                                <th scope="col"><span class="visually-hidden">Ouvrir</span></th>
                              </tr>
                            </thead>
                            <tbody>
                              @for (x of g.charges; track x.id) {
                                <tr [class.is-heavy]="g.overCents > 0 && x.engagedCents >= g.overCents">
                                  <th scope="row">
                                    <span class="caps-charge-label">{{ x.label }}</span>
                                    <span class="caps-tags">
                                      @if (mode() !== 'both' && x.categoryLabel && c.level === 'Poste') {
                                        <span class="caps-tag">{{ x.categoryLabel }}</span>
                                      }
                                      @if (x.projectCharge && x.project) {
                                        <span class="caps-tag is-project">Projet · {{ x.project.name }}</span>
                                      }
                                      @if (x.newThisPeriod) {
                                        <span class="caps-tag is-new">Nouvelle</span>
                                      }
                                    </span>
                                    @if (g.overCents > 0 && x.engagedCents >= g.overCents) {
                                      <small class="caps-hint">À elle seule, elle couvre le dépassement de {{ g.overCents | cents }}.</small>
                                    }
                                  </th>
                                  <td>
                                    {{ x.engagedDate | shortDate }}
                                    <small class="caps-status" [attr.data-status]="x.engagedAs === 'paid' ? 'paid' : x.status">{{ status(x) }}</small>
                                  </td>
                                  <td>
                                    <span class="caps-cadence" [class.is-recurring]="x.rank !== null">{{ rec(x).label }}</span>
                                    @if (rec(x).note) {
                                      <small>{{ rec(x).note }}</small>
                                    }
                                  </td>
                                  <td>
                                    {{ age(x).label }}
                                    @if (age(x).note) {
                                      <small>{{ age(x).note }}</small>
                                    }
                                  </td>
                                  <td class="num">
                                    <strong>{{ x.engagedCents | cents }}</strong>
                                    <small>{{ share(x, g.charges) }} de l’engagé</small>
                                  </td>
                                  <td><button type="button" class="text-link" (click)="openLine(x)">Ouvrir</button></td>
                                </tr>
                              }
                            </tbody>
                          </table>
                        </div>
                      } @else {
                        <p class="caps-group-empty">Aucune charge sur la période.</p>
                      }
                    }
                    <p class="caps-detail-note">
                      Retirer ou réduire une charge reste votre décision : ouvrez-la pour la modifier, la décaler ou la supprimer. Les plafonds ne bloquent jamais une dépense.
                    </p>
                  </div>
                }
              </article>
            }
          </div>
        </section>

        <!-- Réglages : plafond par poste, catégories personnalisées et leur plafond. -->
        <section class="bpm-section caps-settings" id="reglages" aria-labelledby="caps-settings-title">
          <header>
            <h2 id="caps-settings-title">Régler les plafonds</h2>
            <span class="bpm-note">Un montant maximal par période. Vide : pas de plafond. Rien n’est jamais bloqué.</span>
          </header>
          <div class="caps-settings-grid">
            <form class="bpm-panel caps-panel" (ngSubmit)="saveCenters()" aria-labelledby="caps-centers-title">
              <div class="caps-panel-head">
                <p class="pm-detail-eyebrow">Niveau 1</p>
                <h3 id="caps-centers-title">Plafond par poste</h3>
                <p>Le total des dépenses du poste sur la période, toutes catégories comprises.</p>
              </div>
              <ul class="caps-center-list">
                @for (c of d.centers; track c.ref) {
                  <li class="caps-center-row" [attr.data-health]="healthOf(c)">
                    <label [for]="'cap-' + c.ref">
                      <strong>{{ c.label }}</strong>
                      <small>Engagé {{ c.engagedCents | cents }}{{ c.capCents !== null ? ' · ' + pct(c.usedPct) : '' }}</small>
                    </label>
                    <span class="caps-input">
                      <input
                        [id]="'cap-' + c.ref"
                        inputmode="decimal"
                        [name]="'cap-' + c.ref"
                        placeholder="Aucun"
                        [attr.aria-label]="'Plafond du poste ' + c.label + ', vide pour aucun plafond'"
                        [ngModel]="centerDraft()[c.ref] ?? ''"
                        (ngModelChange)="setCenterDraft(c.ref, $event)"
                      /><span aria-hidden="true">€</span>
                    </span>
                  </li>
                }
              </ul>
              <div class="bpm-actions">
                <button type="submit" class="btn btn-primary" [disabled]="busy() || !centersDirty()">Enregistrer les plafonds</button>
                @if (centersDirty()) {
                  <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="centerEdits.set(null)">Annuler</button>
                }
              </div>
            </form>

            <div class="bpm-panel caps-panel" id="reglages-categories" aria-labelledby="caps-cats-title">
              <div class="caps-panel-head">
                <p class="pm-detail-eyebrow">Niveau 2</p>
                <h3 id="caps-cats-title">Catégories et leur plafond</h3>
                <p>Une catégorie range des dépenses précises d’un poste, ponctuelles ou récurrentes ; son plafond est suivi à part de celui du poste.</p>
              </div>
              <form class="caps-create" (ngSubmit)="createCategory()">
                <label>Nouvelle catégorie<input name="newLabel" maxlength="120" placeholder="Ex. Cinéma, Courses bio" [(ngModel)]="newLabel" /></label>
                <label
                  >Poste
                  <select name="newCenter" [(ngModel)]="newCenter">
                    <option value="">Choisir…</option>
                    @for (c of d.centers; track c.ref) {
                      <option [value]="c.ref">{{ c.label }}</option>
                    }
                  </select>
                </label>
                <label>Plafond<span class="caps-input"><input name="newCap" inputmode="decimal" placeholder="Aucun" [(ngModel)]="newCap" /><span aria-hidden="true">€</span></span></label>
                <button type="submit" class="btn btn-primary" [disabled]="busy()">Créer</button>
              </form>
              @for (grp of categoryGroups(); track grp.ref) {
                <div class="caps-cat-group">
                  <p class="caps-cat-center">{{ grp.label }}</p>
                  <ul class="caps-cat-list">
                    @for (k of grp.items; track k.id) {
                      <li class="caps-cat-row" [attr.data-health]="healthOf(k)" [class.is-archived]="k.archived">
                        @if (editing() === k.id) {
                          <form class="caps-cat-edit" (ngSubmit)="saveCategory(k)">
                            <input name="editLabel" maxlength="120" aria-label="Nom de la catégorie" [(ngModel)]="editLabel" />
                            <span class="caps-input"><input name="editCap" inputmode="decimal" placeholder="Aucun" aria-label="Plafond" [(ngModel)]="editCap" /><span aria-hidden="true">€</span></span>
                            <button type="submit" class="btn btn-primary" [disabled]="busy()">Enregistrer</button>
                            <button type="button" class="btn btn-secondary" (click)="editing.set(null)">Annuler</button>
                          </form>
                        } @else {
                          <span class="caps-cat-name">
                            <strong>{{ k.label }}</strong>
                            <small>{{ k.archived ? 'Retirée des choix · ' : '' }}{{ k.capCents === null ? 'Sans plafond' : 'Plafond ' + money(k.capCents) }} · engagé {{ k.engagedCents | cents }}</small>
                          </span>
                          <span class="caps-cat-actions">
                            <button type="button" class="text-link" [disabled]="busy()" (click)="startEdit(k)">Modifier</button>
                            <button type="button" class="text-link" [disabled]="busy()" (click)="archive(k, !k.archived)">{{ k.archived ? 'Rétablir' : 'Retirer' }}</button>
                          </span>
                        }
                      </li>
                    }
                  </ul>
                </div>
              } @empty {
                <p class="caps-group-empty">Aucune catégorie : créez-en une pour suivre une dépense précise (abonnements, sorties, courses bio…).</p>
              }
            </div>
          </div>
        </section>
      }
    </div>

    @if (entryOpen() && budgets().length) {
      <bpm-operation-editor [budgets]="budgets()" [line]="editingLine()" [defaults]="entryDefaults()" (closed)="closeEntry()" (saved)="saved($event)" />
    } @else if (lineId()) {
      <bpm-line-detail [lineId]="lineId()!" (closed)="closeLine()" (edit)="editLine($event)" />
    }
  `,
})
export class BpmCapsPage {
  private bpm = inject(BpmApi);
  private route = inject(ActivatedRoute);
  private sequence = 0;
  private query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  protected period = computed(() => this.query().get('period') || undefined);

  protected d = signal<CapsReview | null>(null);
  protected loading = signal(false);
  protected error = signal('');
  protected busy = signal(false);
  protected notice = signal<{ text: string; error: boolean } | null>(null);

  protected readonly modes = REVIEW_MODES;
  protected mode = signal<ReviewMode>('center');
  protected show = signal<'all' | 'over'>('all');
  /** Cartes ouvertes ou fermées par l'utilisateur ; sinon un plafond dépassé s'ouvre d'emblée. */
  private choice = signal(new Map<string, boolean>());

  protected s = computed(() => (this.d() ? reviewSummary(this.d()!) : null));
  protected allCards = computed<CapCard[]>(() => (this.d() ? reviewCards(this.d()!, this.mode()) : []));
  protected cards = computed(() => (this.show() === 'over' ? this.allCards().filter((c) => c.health === 'alert') : this.allCards()));
  protected budgets = computed(() => this.d()?.context.budgets ?? []);

  protected healthOf = healthOf;
  protected rec = recurrenceText;
  protected age = anteriorityText;
  protected status = statusText;
  protected money = cents;
  protected pct = (v: number | null) => (v === null ? '—' : percentText(v, 0));
  protected bar = (v: number | null) => Math.min(100, Math.max(0, v ?? 0));
  protected share = (x: ReviewCharge, all: ReviewCharge[]) => {
    const total = all.reduce((t, c) => t + c.engagedCents, 0);
    return total ? percentText((x.engagedCents / total) * 100, 0) : '—';
  };

  protected expected = computed(() => {
    const v = this.d()?.totals.expectedCents;
    return v === null || v === undefined ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + cents(Math.abs(v));
  });
  protected reviewNote = computed(() => {
    const n = this.d()?.totals.overCount ?? 0;
    return n ? `${n} dépassement${n > 1 ? 's' : ''} : les charges qui le forment sont dépliées, les plus lourdes d’abord.` : 'Aucun dépassement : chaque carte montre ce qu’il reste avant d’acheter.';
  });
  protected verdict = computed(() => {
    const t = this.d()?.totals;
    if (!t || t.expectedCents === null) return 'Si tout le prévu se réalise';
    if (t.expectedCents < 0) return t.toCompensateCents ? 'Déficit prévu : réduisez d’autres postes' : 'Déficit prévu sur la période';
    return t.toCompensateCents ? 'Le reste du budget absorbe le dépassement' : 'Si tout le prévu se réalise';
  });

  protected isOpen = (c: CapCard) => this.choice().get(c.key) ?? c.health === 'alert';
  protected toggle(c: CapCard) {
    this.choice.set(new Map(this.choice()).set(c.key, !this.isOpen(c)));
  }

  // ---------- période ----------

  private shownKey = computed(() => this.d()?.context.period?.key ?? null);
  protected atFirst = computed(() => !!this.shownKey() && this.shownKey() === this.d()?.context.periods?.firstKey);
  protected atCurrent = computed(() => !!this.shownKey() && this.shownKey() === this.d()?.context.periods?.currentKey);
  protected periodQuery(delta: number): Params {
    const key = this.shownKey();
    const target = key ? shiftPeriod(key, delta) : null;
    return { period: target && target !== this.d()?.context.periods?.currentKey ? target : null };
  }
  private reader = effect(() => {
    this.period();
    untracked(() => this.load());
  });

  async load() {
    const sequence = ++this.sequence;
    this.loading.set(true);
    try {
      const data = await this.bpm.capsReview(this.period());
      if (sequence !== this.sequence) return;
      this.d.set(data);
      this.error.set('');
    } catch (e) {
      if (sequence === this.sequence) this.error.set(toApiError(e).message);
    } finally {
      if (sequence === this.sequence) this.loading.set(false);
    }
  }

  // ---------- saisie et détail d'une charge ----------

  protected lineId = signal<string | null>(null);
  protected entryOpen = signal(false);
  protected editingLine = signal<RegisterLine | null>(null);
  protected entryDefaults = signal<Partial<EntryInput>>({ direction: 'charge' });

  protected openEntry(c?: CapCard) {
    this.editingLine.set(null);
    this.entryDefaults.set({ direction: 'charge', ...(c ? { costCenterRef: c.centerRef, ...(c.categoryId ? { categoryId: c.categoryId } : {}) } : {}) });
    this.entryOpen.set(true);
  }
  protected closeEntry() {
    this.entryOpen.set(false);
    this.editingLine.set(null);
  }
  protected saved(text: string) {
    this.closeEntry();
    this.notice.set({ text, error: false });
    this.load();
  }
  protected openLine(x: ReviewCharge) {
    this.lineId.set(x.id);
  }
  protected closeLine() {
    this.lineId.set(null);
    this.load();
  }
  protected editLine(line: RegisterLine) {
    this.lineId.set(null);
    this.editingLine.set(line);
    this.entryOpen.set(true);
  }

  // ---------- plafonds des postes ----------

  protected centerEdits = signal<Record<string, string> | null>(null);
  private savedCenters = computed(() => Object.fromEntries((this.d()?.centers ?? []).map((c) => [c.ref, capEuroText(c.capCents)])));
  protected centerDraft = computed<Record<string, string>>(() => this.centerEdits() ?? this.savedCenters());
  protected centersDirty = computed(() => {
    const e = this.centerEdits();
    const saved = this.savedCenters();
    return !!e && Object.keys(e).some((k) => (e[k] ?? '') !== (saved[k] ?? ''));
  });
  protected setCenterDraft(ref: string, value: string) {
    this.centerEdits.set({ ...this.centerDraft(), [ref]: value });
  }

  async saveCenters() {
    const v = this.d();
    if (!v || this.busy()) return;
    const caps: Record<string, number | null> = {};
    for (const c of v.centers) {
      const amount = capInput(this.centerDraft()[c.ref] ?? '');
      if (amount === undefined) return this.notice.set({ text: `Plafond du poste « ${c.label} » : montant positif attendu (ex. 250 ou 120,50), ou vide pour aucun plafond.`, error: true });
      caps[c.ref] = amount;
    }
    await this.run(async () => {
      await this.bpm.setCaps({ expectedRevision: v.lifeBudget.revision, caps });
      this.centerEdits.set(null);
      return 'Plafonds des postes enregistrés.';
    });
  }

  // ---------- catégories ----------

  protected categoryGroups = computed(() => {
    const v = this.d();
    if (!v) return [];
    return v.centers
      .map((c) => ({ ref: c.ref, label: c.label, items: v.categories.filter((k) => k.costCenterRef === c.ref).sort((a, b) => Number(a.archived) - Number(b.archived) || a.label.localeCompare(b.label, 'fr')) }))
      .filter((g) => g.items.length);
  });

  protected newLabel = signal('');
  protected newCenter = signal('');
  protected newCap = signal('');
  private createKey = newRequestKey('category');

  async createCategory() {
    const cap = capInput(this.newCap());
    if (!this.newLabel().trim() || !this.newCenter()) return this.notice.set({ text: 'Nommez la catégorie et choisissez son poste.', error: true });
    if (cap === undefined) return this.notice.set({ text: 'Plafond : montant positif attendu, ou vide pour aucun plafond.', error: true });
    await this.run(async () => {
      const r = await this.bpm.createCategory({ requestKey: this.createKey, label: this.newLabel().trim(), costCenterRef: this.newCenter(), cap });
      this.createKey = newRequestKey('category');
      this.newLabel.set('');
      this.newCap.set('');
      return `Catégorie « ${r.category.label} » créée dans ${r.category.costCenterLabel}.`;
    });
  }

  protected editing = signal<string | null>(null);
  protected editLabel = signal('');
  protected editCap = signal('');
  protected startEdit(k: ReviewCategory) {
    this.editing.set(k.id);
    this.editLabel.set(k.label);
    this.editCap.set(capEuroText(k.capCents));
  }
  async saveCategory(k: ReviewCategory) {
    const cap = capInput(this.editCap());
    if (!this.editLabel().trim()) return this.notice.set({ text: 'Le nom de la catégorie est obligatoire.', error: true });
    if (cap === undefined) return this.notice.set({ text: 'Plafond : montant positif attendu, ou vide pour aucun plafond.', error: true });
    await this.run(async () => {
      await this.bpm.updateCategory(k.id, { expectedRevision: k.revision, label: this.editLabel().trim(), cap });
      this.editing.set(null);
      return `Catégorie « ${this.editLabel().trim()} » enregistrée.`;
    });
  }
  async archive(k: ReviewCategory, archived: boolean) {
    await this.run(async () => {
      await this.bpm.updateCategory(k.id, { expectedRevision: k.revision, archived });
      return archived ? `Catégorie « ${k.label} » retirée des choix ; ses dépenses gardent leur rangement.` : `Catégorie « ${k.label} » rétablie.`;
    });
  }

  private async run(fn: () => Promise<string>) {
    this.busy.set(true);
    this.notice.set(null);
    try {
      const text = await fn();
      this.notice.set({ text, error: false });
      await this.load();
    } catch (e) {
      this.notice.set({ text: toApiError(e).message, error: true });
    } finally {
      this.busy.set(false);
    }
  }
}
