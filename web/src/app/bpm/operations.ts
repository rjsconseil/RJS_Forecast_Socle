import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api, ApiError, newRequestKey, toApiError } from '../core/api.service';
import { BpmDashboard, CostCenter, Direction, FigureEvaluation, Operation, Period } from '../core/models';
import { euros, FigureValuePipe, parseAmount, ShortDatePipe } from '../core/format';

type DirFilter = 'all' | Direction;
type StatusFilter = 'all' | 'planned' | 'realized';

/** Chiffres du bandeau : métriques administrées, jamais recalculées par le site. */
const SUMMARY_KEYS = ['bpm.revenus', 'bpm.revenusPrevus', 'bpm.charges', 'bpm.chargesPrevues'];
const INCOME_KEYS = new Set(['bpm.revenus', 'bpm.revenusPrevus']);

const PERIOD_STATUS: Record<string, string> = { closed: 'Close', ended: 'Terminée', current: 'En cours', future: 'À venir' };

const pad = (n: number) => String(n).padStart(2, '0');
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Date proposée à la saisie : aujourd'hui si la période affichée le contient, sinon son premier jour. */
function defaultDate(p: Period | null): string {
  const t = todayIso();
  if (!p) return t;
  return t >= p.start && t <= p.end ? t : p.start;
}
function dayHeading(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}
const amountInput = (n: number) => String(n).replace('.', ',');
/** Date qui place l'opération dans une période (réalisation si connue, sinon prévision). */
const effectiveDate = (o: Operation) => o.realizedDate ?? o.date;

@Component({
  selector: 'app-bpm-operations',
  imports: [RouterLink, FigureValuePipe, ShortDatePipe],
  template: `
    <header class="head">
      <div>
        <h1>Opérations</h1>
        <p class="sub">Revenus et charges de votre budget « Projet de vie », période par période.</p>
      </div>
      <button type="button" class="btn primary only-narrow" (click)="openComposer()" [attr.aria-expanded]="composerOpen()" aria-controls="composer">
        Nouvelle opération
      </button>
    </header>

    @if (loadError(); as e) {
      <div class="alert error" role="alert">
        {{ e.message }}
        <p>
          <a class="btn small" routerLink="/app/operations">Revenir à la période en cours</a>
          <button type="button" class="btn small" (click)="load(period())">Réessayer</button>
        </p>
      </div>
    }

    @if (dash(); as d) {
      @if (d.cycle?.state !== 'active' || !d.period) {
        <section class="sheet setup">
          <h2>Votre cycle n'est pas encore configuré</h2>
          <p class="muted">Sans jour d'ancrage, les opérations ne peuvent pas être rangées par période. Vous pouvez déjà en saisir : elles apparaîtront dès que le cycle sera actif.</p>
          <a class="btn primary" routerLink="/app/reglages">Configurer le cycle</a>
        </section>
      } @else {
        <nav class="period-bar" aria-label="Choix de la période">
          <button type="button" class="nav-btn" [disabled]="!olderPeriod()" (click)="goTo(olderPeriod()?.key)" aria-label="Période précédente">‹</button>
          <label class="period-select">
            <span class="sr-only">Période affichée</span>
            <select [value]="d.period.key" (change)="goTo($any($event.target).value)">
              @for (p of d.cycle!.periods; track p.key) {
                <option [value]="p.key" [selected]="p.key === d.period.key">{{ p.label }} · {{ periodStatus(p) }}</option>
              }
            </select>
          </label>
          <button type="button" class="nav-btn" [disabled]="!newerPeriod()" (click)="goTo(newerPeriod()?.key)" aria-label="Période suivante">›</button>
          <span class="period-range muted">{{ d.period.start | shortDate }} → {{ d.period.end | shortDate }}</span>
          <span class="pstatus ps-{{ d.period.status }}">{{ periodStatus(d.period) }}</span>
        </nav>

        @if (d.period.status === 'closed') {
          <p class="closed-note" role="note">
            Cette période est close : son résultat a été transféré au Patrimoine et ses opérations sont figées.
            @if (d.period.closureId) {
              <a [routerLink]="['/object-management']" [queryParams]="{ inspect: d.period.closureId }">Inspecter la clôture</a>
            }
          </p>
        }

        @if (summary().length) {
          <ul class="tiles" aria-label="Chiffres de la période">
            @for (f of summary(); track f.key) {
              <li class="tile">
                <span class="tile-label">{{ f.label }}</span>
                @if (f.value === null) {
                  <strong class="tile-value unknown-val">Inconnu</strong>
                  <span class="tile-reason">{{ f.unavailableReason ?? 'Donnée manquante' }}</span>
                } @else {
                  <strong class="tile-value num" [class.pos]="isIncome(f.key)" [class.neg]="!isIncome(f.key)">{{ f.value | figureValue: f.unit : f.decimals }}</strong>
                }
                <a class="tile-link" [routerLink]="['/admin/calculs', f.key]" [attr.aria-label]="'Voir la formule de ' + f.label" [title]="f.formula">Formule</a>
              </li>
            }
          </ul>
        }
      }

      <div class="layout">
        <section class="sheet list" aria-labelledby="list-title">
          <div class="list-head">
            <h2 id="list-title">{{ d.period ? 'Opérations de ' + d.period.label : 'Opérations' }}</h2>
            <span class="muted small">{{ filtered().length }} sur {{ d.operations.length }}</span>
          </div>
          <div class="filters-row">
            <div class="seg" role="group" aria-label="Filtrer par sens">
              <button type="button" [attr.aria-pressed]="dirFilter() === 'all'" (click)="dirFilter.set('all')">Tous</button>
              <button type="button" [attr.aria-pressed]="dirFilter() === 'income'" (click)="dirFilter.set('income')">Revenus</button>
              <button type="button" [attr.aria-pressed]="dirFilter() === 'charge'" (click)="dirFilter.set('charge')">Charges</button>
            </div>
            <div class="seg" role="group" aria-label="Filtrer par statut">
              <button type="button" [attr.aria-pressed]="statusFilter() === 'all'" (click)="statusFilter.set('all')">Toutes</button>
              <button type="button" [attr.aria-pressed]="statusFilter() === 'planned'" (click)="statusFilter.set('planned')">Prévues</button>
              <button type="button" [attr.aria-pressed]="statusFilter() === 'realized'" (click)="statusFilter.set('realized')">Réalisées</button>
            </div>
          </div>

          @if (notice(); as n) {
            <div class="toast" role="status">
              <span>{{ n.text }}</span>
              @if (n.periodKey) {
                <button type="button" class="linkish" (click)="goTo(n.periodKey)">Voir {{ n.periodLabel }}</button>
              }
              <button type="button" class="close" (click)="notice.set(null)" aria-label="Masquer le message">×</button>
            </div>
          }

          @if (loading() && !d.operations.length) {
            <p class="muted">Chargement…</p>
          } @else if (!d.operations.length) {
            <div class="empty-state">
              <p><strong>Aucune opération sur cette période.</strong></p>
              <p class="muted">Saisissez vos revenus et charges prévus : ils alimentent le résultat prévu de la période.</p>
            </div>
          } @else if (!filtered().length) {
            <p class="empty-state muted">Aucune opération ne correspond à ces filtres.</p>
          } @else {
            @for (g of groups(); track g.date) {
              <h3 class="day">{{ dayLabel(g.date) }}</h3>
              <ul class="ops">
                @for (o of g.ops; track o.id) {
                  <li class="op" [class.is-planned]="o.status === 'planned'">
                    <div class="op-row">
                      <span class="glyph" [class.g-in]="o.direction === 'income'" [class.g-out]="o.direction === 'charge'" aria-hidden="true">{{ o.direction === 'income' ? '+' : '−' }}</span>
                      <div class="op-text">
                        <p class="op-label">{{ o.label }}</p>
                        <p class="op-meta">
                          <span>{{ o.costCenterLabel ?? 'Centre retiré' }}</span>
                          <span class="chip" [class.c-planned]="o.status === 'planned'" [class.c-realized]="o.status === 'realized'">{{ o.status === 'planned' ? 'Prévue' : 'Réalisée' }}</span>
                          @if (o.status === 'realized' && o.realizedDate && o.realizedDate !== o.date) {
                            <span class="muted">prévue le {{ o.date | shortDate }}</span>
                          }
                          @if (o.status === 'realized' && o.realizedAmount !== null && o.realizedAmount !== o.amount) {
                            <span class="muted">montant prévu {{ eur(o.amount) }}</span>
                          }
                        </p>
                      </div>
                      <span class="op-amount num" [class.pos]="o.direction === 'income'" [class.neg]="o.direction === 'charge'">
                        <span class="sr-only">{{ o.direction === 'income' ? 'Revenu' : 'Charge' }} :</span>{{ signed(o) }}
                      </span>
                    </div>
                    <div class="op-actions">
                      @if (o.status === 'planned' && realizing() !== o.id) {
                        <button type="button" class="btn small" (click)="startRealize(o)" [attr.aria-controls]="'realize-' + o.id">Marquer réalisée</button>
                      }
                      <a class="inspect" [routerLink]="['/object-management']" [queryParams]="{ inspect: o.id }">Inspecter</a>
                    </div>
                    @if (realizing() === o.id) {
                      <form class="realize" [id]="'realize-' + o.id" novalidate (submit)="$event.preventDefault(); submitRealize(o)" (keydown.escape)="cancelRealize()" [attr.aria-label]="'Réaliser ' + o.label">
                        <label class="field">
                          <span>Montant réalisé (€)</span>
                          <input [id]="'realize-amount-' + o.id" inputmode="decimal" autocomplete="off" [value]="rAmount()" (input)="rAmount.set($any($event.target).value)" />
                        </label>
                        <label class="field">
                          <span>Date de réalisation</span>
                          <input type="date" [value]="rDate()" (input)="rDate.set($any($event.target).value)" />
                        </label>
                        <div class="realize-actions">
                          <button type="submit" class="btn primary small" [disabled]="rSaving()">{{ rSaving() ? 'Enregistrement…' : 'Confirmer' }}</button>
                          <button type="button" class="btn small" (click)="cancelRealize()">Annuler</button>
                        </div>
                        @if (rError(); as e) {
                          <div class="alert error inline" role="alert">
                            {{ explain(e) }}
                            @if (e.isConflict) {
                              <button type="button" class="btn small" (click)="cancelRealize(); load(period())">Recharger les opérations</button>
                            }
                          </div>
                        }
                      </form>
                    }
                  </li>
                }
              </ul>
            }
          }
        </section>

        <section id="composer" class="sheet composer" [class.open]="composerOpen()" aria-labelledby="composer-title" (keydown.escape)="composerOpen.set(false)">
          <div class="composer-head">
            <h2 id="composer-title">Nouvelle opération</h2>
            <button type="button" class="btn small only-narrow" (click)="composerOpen.set(false)">Fermer</button>
          </div>
          <form (submit)="$event.preventDefault(); submit()" novalidate>
            <fieldset class="seg-field">
              <legend>Sens</legend>
              <div class="seg big">
                <label [class.on]="fDirection() === 'income'">
                  <input type="radio" name="op-direction" value="income" [checked]="fDirection() === 'income'" (change)="setDirection('income')" /> Revenu
                </label>
                <label [class.on]="fDirection() === 'charge'">
                  <input type="radio" name="op-direction" value="charge" [checked]="fDirection() === 'charge'" (change)="setDirection('charge')" /> Charge
                </label>
              </div>
            </fieldset>

            <label class="field">
              <span>Libellé</span>
              <input id="op-label" maxlength="200" autocomplete="off" [placeholder]="fDirection() === 'income' ? 'Ex. Salaire de novembre' : 'Ex. Loyer'" [value]="fLabel()" (input)="fLabel.set($any($event.target).value)" />
            </label>

            <div class="two">
              <label class="field">
                <span>Montant (€)</span>
                <input inputmode="decimal" autocomplete="off" placeholder="0,00" [value]="fAmount()" (input)="fAmount.set($any($event.target).value)" />
              </label>
              <label class="field">
                <span>Date</span>
                <input type="date" [value]="fDate()" (input)="fDate.set($any($event.target).value)" />
              </label>
            </div>

            <label class="field">
              <span>Poste (centre de coûts)</span>
              <select [value]="fCenter()" (change)="fCenter.set($any($event.target).value)">
                @if (!centersForDirection().length) {
                  <option value="">Aucun centre disponible</option>
                }
                @if (standardCenters().length) {
                  <optgroup label="Centres standards">
                    @for (c of standardCenters(); track c.ref) {
                      <option [value]="c.ref" [selected]="c.ref === fCenter()">{{ c.label }}</option>
                    }
                  </optgroup>
                }
                @if (personalCenters().length) {
                  <optgroup label="Mes centres">
                    @for (c of personalCenters(); track c.ref) {
                      <option [value]="c.ref" [selected]="c.ref === fCenter()">{{ c.label }}</option>
                    }
                  </optgroup>
                }
              </select>
            </label>

            @if (!ccOpen()) {
              <button type="button" class="linkish add-cc" (click)="openCenterForm()" aria-controls="cc-form">+ Créer un poste personnel</button>
            } @else {
              <div id="cc-form" class="cc-form" role="group" aria-label="Nouveau poste personnel" (keydown.escape)="$event.stopPropagation(); ccOpen.set(false)">
                <label class="field">
                  <span>Nom du centre</span>
                  <input id="cc-label" maxlength="120" autocomplete="off" [value]="ccLabel()" (input)="ccLabel.set($any($event.target).value)" (keydown.enter)="$event.preventDefault(); addCenter()" />
                </label>
                <label class="field">
                  <span>Sens</span>
                  <select [value]="ccDirection()" (change)="ccDirection.set($any($event.target).value)">
                    <option value="income" [selected]="ccDirection() === 'income'">Revenus</option>
                    <option value="charge" [selected]="ccDirection() === 'charge'">Charges</option>
                  </select>
                </label>
                <div class="realize-actions">
                  <button type="button" class="btn small primary" [disabled]="ccSaving()" (click)="addCenter()">{{ ccSaving() ? 'Ajout…' : 'Ajouter le centre' }}</button>
                  <button type="button" class="btn small" (click)="ccOpen.set(false)">Annuler</button>
                </div>
                @if (ccError(); as e) {
                  <div class="alert error inline" role="alert">{{ e.message }}</div>
                }
              </div>
            }

            <fieldset class="seg-field">
              <legend>Statut</legend>
              <div class="seg">
                <label [class.on]="fStatus() === 'planned'">
                  <input type="radio" name="op-status" value="planned" [checked]="fStatus() === 'planned'" (change)="fStatus.set('planned')" /> Prévue
                </label>
                <label [class.on]="fStatus() === 'realized'">
                  <input type="radio" name="op-status" value="realized" [checked]="fStatus() === 'realized'" (change)="fStatus.set('realized')" /> Déjà réalisée
                </label>
              </div>
              <small class="hint">
                {{ fStatus() === 'planned' ? 'Une opération prévue compte dans le prévu ; marquez-la réalisée le moment venu.' : 'Réalisée au montant et à la date saisis.' }}
              </small>
            </fieldset>

            @if (formError(); as e) {
              <div class="alert error inline" role="alert">{{ explain(e) }}</div>
            }
            <button type="submit" class="btn primary wide" [disabled]="saving()">
              {{ saving() ? 'Enregistrement…' : fDirection() === 'income' ? 'Ajouter le revenu' : 'Ajouter la charge' }}
            </button>
          </form>
        </section>
      </div>
    } @else if (loading()) {
      <p class="muted">Chargement…</p>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 12px; margin-bottom: 18px; }
      .head h1 { font-size: 1.75rem; letter-spacing: -0.01em; margin: 0 0 4px; }
      .sub { color: var(--muted); margin: 0; max-width: 62ch; }
      .sheet { background: var(--surface); color: var(--text); border-radius: 14px; box-shadow: var(--shadow); padding: 18px 20px; min-width: 0; }
      .sheet h2 { font-size: 1.05rem; margin: 0; }
      .num { font-variant-numeric: tabular-nums; }
      .pos { color: var(--pos); }
      .neg { color: var(--neg); }
      .small { font-size: 0.85rem; }
      .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
      .btn { border-radius: 10px; }
      .btn.wide { width: 100%; min-height: 42px; font-weight: 600; }
      button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, .seg label:has(input:focus-visible) {
        outline: 2px solid var(--accent); outline-offset: 2px;
      }
      .setup { margin-bottom: 18px; }
      .setup p { margin: 6px 0 12px; }

      .period-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin-bottom: 12px; }
      .nav-btn { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 1.2rem; line-height: 1; cursor: pointer; }
      .nav-btn:disabled { opacity: 0.4; cursor: default; }
      .period-select select { font-weight: 600; border-radius: 10px; min-width: 0; max-width: 100%; }
      .period-range { font-size: 0.88rem; }
      .pstatus { font-size: 0.75rem; font-weight: 600; padding: 2px 10px; border-radius: 999px; background: var(--surface-2); color: var(--muted); }
      .ps-current { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
      .ps-closed { background: color-mix(in srgb, var(--pos) 14%, transparent); color: var(--pos); }
      .ps-ended { background: var(--unknown-bg); color: var(--unknown); }
      .closed-note { margin: 0 0 12px; padding: 10px 14px; border-radius: 12px; background: var(--surface-2); font-size: 0.9rem; }

      .tiles { list-style: none; padding: 0; margin: 0 0 18px; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
      .tile { position: relative; background: var(--surface); border-radius: 14px; box-shadow: var(--shadow); padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .tile-label { font-size: 0.8rem; color: var(--muted); padding-right: 56px; }
      .tile-value { font-size: 1.3rem; font-weight: 700; letter-spacing: -0.01em; overflow-wrap: anywhere; }
      .unknown-val { color: var(--unknown); background: var(--unknown-bg); border-radius: 8px; padding: 0 8px; align-self: flex-start; font-size: 1.05rem; }
      .tile-reason { font-size: 0.78rem; color: var(--unknown); }
      .tile-link { position: absolute; top: 10px; right: 12px; font-size: 0.75rem; }

      .layout { display: grid; gap: 18px; grid-template-columns: minmax(0, 1fr); align-items: start; }
      @media (min-width: 960px) {
        .layout { grid-template-columns: minmax(0, 1fr) 360px; }
        .composer { position: sticky; top: 16px; }
        .only-narrow { display: none !important; }
      }
      @media (max-width: 959.98px) {
        .composer { order: -1; }
        .composer:not(.open) { display: none; }
      }

      .list-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
      .filters-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
      .seg { display: inline-flex; flex-wrap: wrap; background: var(--surface-2); border-radius: 999px; padding: 3px; gap: 2px; max-width: 100%; }
      .seg button, .seg label { border: 0; background: transparent; font: inherit; font-size: 0.88rem; padding: 5px 12px; border-radius: 999px; color: var(--muted); cursor: pointer; min-height: 32px; display: inline-flex; align-items: center; }
      .seg button[aria-pressed='true'], .seg label.on { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); }
      .seg label input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; }
      .seg.big { display: flex; }
      .seg.big label { flex: 1; justify-content: center; padding: 7px 12px; }

      .toast { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 9px 12px; margin-bottom: 12px; border-radius: 10px; background: color-mix(in srgb, var(--pos) 12%, var(--surface)); font-size: 0.9rem; }
      .toast .close { margin-left: auto; border: 0; background: none; font-size: 1.2rem; line-height: 1; cursor: pointer; color: var(--muted); }
      .linkish { border: 0; background: none; padding: 0; font: inherit; color: var(--accent); cursor: pointer; text-decoration: underline; }
      .empty-state { text-align: center; padding: 28px 8px; }
      .empty-state p { margin: 4px 0; }

      .day { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 16px 0 6px; font-weight: 600; }
      .day:first-of-type { margin-top: 4px; }
      .ops { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--border); }
      .op { border-bottom: 1px solid var(--border); padding: 10px 0; }
      .op-row { display: flex; align-items: center; gap: 12px; }
      .glyph { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; }
      .g-in { background: color-mix(in srgb, var(--pos) 14%, transparent); color: var(--pos); }
      .g-out { background: color-mix(in srgb, var(--neg) 12%, transparent); color: var(--neg); }
      .op-text { flex: 1; min-width: 0; }
      .op-label { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
      .op-meta { margin: 2px 0 0; font-size: 0.82rem; color: var(--muted); display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; }
      .chip { font-size: 0.72rem; font-weight: 600; padding: 1px 8px; border-radius: 999px; }
      .c-planned { background: var(--surface-2); color: var(--muted); }
      .c-realized { background: color-mix(in srgb, var(--pos) 14%, transparent); color: var(--pos); }
      .op-amount { flex: none; font-weight: 700; white-space: nowrap; }
      .is-planned .op-amount { opacity: 0.72; }
      .op-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 6px 0 0 44px; }
      .op-actions:empty { display: none; }
      .inspect { font-size: 0.8rem; color: var(--muted); }

      .realize { margin: 10px 0 2px 44px; padding: 12px; border-radius: 12px; background: var(--surface-2); display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; align-items: end; }
      .realize-actions { display: flex; flex-wrap: wrap; gap: 6px; }
      .realize .alert, .cc-form .alert { grid-column: 1 / -1; }
      @media (max-width: 520px) {
        .op-actions, .realize { margin-left: 0; }
      }

      .composer-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 12px; }
      .composer form { display: flex; flex-direction: column; gap: 12px; }
      .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .field > span, .seg-field legend { font-weight: 600; font-size: 0.85rem; }
      .field input, .field select { width: 100%; border-radius: 10px; }
      .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; }
      .seg-field { border: 0; padding: 0; margin: 0; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
      .seg-field legend { padding: 0; margin-bottom: 4px; }
      .add-cc { align-self: flex-start; font-size: 0.85rem; margin-top: -4px; }
      .cc-form { display: grid; gap: 10px; padding: 12px; border-radius: 12px; background: var(--surface-2); }
      .alert.inline { margin: 0; }
    `,
  ],
})
export class BpmOperations {
  /** ?period=KEY (liaison des paramètres de route aux entrées). */
  readonly period = input<string>();
  private api = inject(Api);
  private router = inject(Router);

  protected dash = signal<BpmDashboard | null>(null);
  protected loading = signal(true);
  protected loadError = signal<ApiError | null>(null);
  protected summary = signal<FigureEvaluation[]>([]);
  protected centers = signal<CostCenter[]>([]);
  private loadSeq = 0;

  protected dirFilter = signal<DirFilter>('all');
  protected statusFilter = signal<StatusFilter>('all');
  protected notice = signal<{ text: string; periodKey?: string; periodLabel?: string } | null>(null);

  // Saisie d'une opération
  protected composerOpen = signal(false);
  protected fDirection = signal<Direction>('charge');
  protected fLabel = signal('');
  protected fAmount = signal('');
  protected fDate = signal('');
  protected fCenter = signal('');
  protected fStatus = signal<'planned' | 'realized'>('planned');
  protected saving = signal(false);
  protected formError = signal<ApiError | null>(null);
  private requestKey = newRequestKey();

  // Centre personnel
  protected ccOpen = signal(false);
  protected ccLabel = signal('');
  protected ccDirection = signal<Direction>('charge');
  protected ccSaving = signal(false);
  protected ccError = signal<ApiError | null>(null);
  private ccRequestKey = newRequestKey();

  // Réalisation
  protected realizing = signal<string | null>(null);
  protected rAmount = signal('');
  protected rDate = signal('');
  protected rSaving = signal(false);
  protected rError = signal<ApiError | null>(null);

  protected centersForDirection = computed(() => this.centers().filter((c) => c.direction === this.fDirection()));
  protected standardCenters = computed(() => this.centersForDirection().filter((c) => c.standard));
  protected personalCenters = computed(() => this.centersForDirection().filter((c) => !c.standard));

  protected filtered = computed(() => {
    const d = this.dash();
    if (!d) return [];
    const dir = this.dirFilter();
    const st = this.statusFilter();
    return d.operations
      .filter((o) => (dir === 'all' || o.direction === dir) && (st === 'all' || o.status === st))
      .slice()
      .sort((a, b) => effectiveDate(a).localeCompare(effectiveDate(b)) || a.createdAt.localeCompare(b.createdAt));
  });

  protected groups = computed(() => {
    const out: { date: string; ops: Operation[] }[] = [];
    for (const o of this.filtered()) {
      const date = effectiveDate(o);
      const last = out.at(-1);
      if (last?.date === date) last.ops.push(o);
      else out.push({ date, ops: [o] });
    }
    return out;
  });

  private periodIndex = computed(() => {
    const d = this.dash();
    return d?.cycle && d.period ? d.cycle.periods.findIndex((p) => p.key === d.period!.key) : -1;
  });
  /** Les périodes sont servies du plus récent au plus ancien. */
  protected olderPeriod = computed(() => {
    const i = this.periodIndex();
    return i >= 0 ? (this.dash()!.cycle!.periods[i + 1] ?? null) : null;
  });
  protected newerPeriod = computed(() => {
    const i = this.periodIndex();
    return i > 0 ? this.dash()!.cycle!.periods[i - 1] : null;
  });

  constructor() {
    effect(() => {
      const key = this.period();
      untracked(() => void this.load(key));
    });
    void this.loadCenters();
  }

  async load(key?: string) {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const d = await this.api.dashboard(key);
      if (seq !== this.loadSeq) return;
      this.dash.set(d);
      if (!this.fLabel() && !this.fAmount()) this.fDate.set(defaultDate(d.period));
      const summary = d.period
        ? await Promise.all(SUMMARY_KEYS.map((k) => d.figures[k] ?? this.api.figure(k, d.period!.key).catch(() => null)))
        : [];
      if (seq !== this.loadSeq) return;
      this.summary.set(summary.filter((f): f is FigureEvaluation => !!f));
    } catch (err) {
      if (seq !== this.loadSeq) return;
      this.dash.set(null);
      this.summary.set([]);
      this.loadError.set(toApiError(err));
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  private async loadCenters() {
    try {
      this.centers.set(await this.api.bpmCostCenters());
      this.ensureCenter();
    } catch (err) {
      this.formError.set(toApiError(err));
    }
  }

  /** Garde un centre compatible avec le sens choisi. */
  private ensureCenter() {
    const list = this.centersForDirection();
    if (!list.some((c) => c.ref === this.fCenter())) this.fCenter.set(list[0]?.ref ?? '');
  }

  goTo(key: string | undefined) {
    if (!key) return;
    this.realizing.set(null);
    void this.router.navigate([], { queryParams: { period: key }, queryParamsHandling: 'merge' });
  }

  protected periodStatus(p: Period) {
    return PERIOD_STATUS[p.status ?? ''] ?? '';
  }
  protected dayLabel(iso: string) {
    return dayHeading(iso);
  }
  protected isIncome(key: string) {
    return INCOME_KEYS.has(key);
  }
  protected eur(v: number | null) {
    return euros(v);
  }
  protected signed(o: Operation) {
    const v = o.status === 'realized' ? (o.realizedAmount ?? o.amount) : o.amount;
    return (o.direction === 'income' ? '+ ' : '− ') + euros(v);
  }

  protected explain(e: ApiError): string {
    switch (e.body.code) {
      case 'PERIOD_CLOSED':
        return `Cette période est close : aucune opération ne peut plus y être datée ni réalisée. ${e.message} Choisissez une date dans une période ouverte.`;
      case 'STALE_VERSION':
        return 'Cette opération a été modifiée entre-temps. Rechargez les opérations pour repartir de la version actuelle.';
      default:
        return e.message;
    }
  }

  private invalid(target: 'form' | 'realize' | 'cc', message: string, field: string) {
    const err = new ApiError(400, { code: 'VALIDATION', action: null, message, details: { field } });
    (target === 'form' ? this.formError : target === 'realize' ? this.rError : this.ccError).set(err);
  }

  // ---------- saisie ----------

  openComposer() {
    this.composerOpen.set(true);
    setTimeout(() => document.getElementById('op-label')?.focus());
  }

  setDirection(d: Direction) {
    this.fDirection.set(d);
    this.ensureCenter();
  }

  async submit() {
    const label = this.fLabel().trim();
    const amount = parseAmount(this.fAmount());
    if (!label) return this.invalid('form', 'Indiquez un libellé.', 'label');
    if (amount === null || amount === 'invalid' || amount <= 0) return this.invalid('form', 'Le montant doit être un nombre positif (ex. 1 250,50).', 'amount');
    if (!this.fDate()) return this.invalid('form', 'Indiquez une date.', 'date');
    if (!this.fCenter()) return this.invalid('form', 'Choisissez un poste.', 'costCenterRef');

    this.saving.set(true);
    this.formError.set(null);
    try {
      const r = await this.api.createBpmOperation({
        requestKey: this.requestKey,
        direction: this.fDirection(),
        label,
        amount,
        date: this.fDate(),
        status: this.fStatus(),
        costCenterRef: this.fCenter(),
      });
      this.requestKey = newRequestKey();
      this.fLabel.set('');
      this.fAmount.set('');
      const op = r.operation;
      const shown = this.dash()?.period;
      const d = effectiveDate(op);
      const outside = shown && (d < shown.start || d > shown.end);
      const target = outside ? this.dash()?.cycle?.periods.find((p) => d >= p.start && d <= p.end) : undefined;
      this.notice.set({
        text: `${op.direction === 'income' ? 'Revenu' : 'Charge'} « ${op.label} » enregistré${op.direction === 'income' ? '' : 'e'}${r.replayed ? ' (déjà reçu)' : ''}.${outside ? ' Datée hors de la période affichée.' : ''}`,
        periodKey: target?.key,
        periodLabel: target?.label,
      });
      if (window.matchMedia?.('(max-width: 959.98px)').matches) this.composerOpen.set(false);
      await this.load(this.period());
    } catch (err) {
      this.formError.set(toApiError(err));
    } finally {
      this.saving.set(false);
    }
  }

  // ---------- centre personnel ----------

  openCenterForm() {
    this.ccDirection.set(this.fDirection());
    this.ccError.set(null);
    this.ccOpen.set(true);
    setTimeout(() => document.getElementById('cc-label')?.focus());
  }

  async addCenter() {
    const label = this.ccLabel().trim();
    if (!label) return this.invalid('cc', 'Indiquez le nom du centre.', 'label');
    this.ccSaving.set(true);
    this.ccError.set(null);
    try {
      const r = await this.api.addCostCenter({ requestKey: this.ccRequestKey, label, direction: this.ccDirection() });
      this.ccRequestKey = newRequestKey();
      this.centers.set(r.costCenters);
      if (this.ccDirection() !== this.fDirection()) this.setDirection(this.ccDirection());
      this.fCenter.set(r.costCenterId);
      this.ccLabel.set('');
      this.ccOpen.set(false);
    } catch (err) {
      this.ccError.set(toApiError(err));
    } finally {
      this.ccSaving.set(false);
    }
  }

  // ---------- réalisation ----------

  startRealize(o: Operation) {
    this.rAmount.set(amountInput(o.amount));
    this.rDate.set(o.date);
    this.rError.set(null);
    this.realizing.set(o.id);
    setTimeout(() => document.getElementById('realize-amount-' + o.id)?.focus());
  }

  cancelRealize() {
    this.realizing.set(null);
    this.rError.set(null);
  }

  async submitRealize(o: Operation) {
    if (this.rSaving()) return;
    const amount = parseAmount(this.rAmount());
    if (amount === null || amount === 'invalid' || amount <= 0) return this.invalid('realize', 'Le montant réalisé doit être un nombre positif.', 'realizedAmount');
    if (!this.rDate()) return this.invalid('realize', 'Indiquez la date de réalisation.', 'realizedDate');
    this.rSaving.set(true);
    this.rError.set(null);
    try {
      const r = await this.api.realizeBpmOperation(o.id, { expectedRevision: o.revision, realizedAmount: amount, realizedDate: this.rDate() });
      this.realizing.set(null);
      this.notice.set({ text: `« ${r.operation.label} » est réalisée (${euros(r.operation.realizedAmount)}).` });
      await this.load(this.period());
    } catch (err) {
      this.rError.set(toApiError(err));
    } finally {
      this.rSaving.set(false);
    }
  }
}
