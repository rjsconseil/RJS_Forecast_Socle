import { Component, computed, effect, ElementRef, inject, input, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, ApiError, newRequestKey, RecetteContext, toApiError } from '../core/api.service';
import { BpmDashboard, ClosingPreview, FigureEvaluation, Operation, Period } from '../core/models';
import { euros, shortDate, ShortDatePipe } from '../core/format';
import { provenance, tokenizeFormula } from '../shared/calc-trace';
import { FigureCard, presentFigure } from './figure-card';
import { FigureExplain } from './figure-explain';

const PERIOD_CHIP: Record<string, { label: string; tone: string }> = {
  current: { label: 'En cours', tone: 'current' },
  ended: { label: 'Terminée', tone: 'ended' },
  closed: { label: 'Close', tone: 'closed' },
  future: { label: 'À venir', tone: 'future' },
};

interface SectionView {
  key: string;
  title: string;
  figures: FigureEvaluation[];
}

/** Tableau de bord de l'application BPM (niveau 3) : chaque chiffre est une métrique administrable. */
@Component({
  selector: 'app-bpm-dashboard',
  imports: [RouterLink, ShortDatePipe, FigureCard, FigureExplain],
  template: `
    @if (noUser() || noComposition()) {
      <section class="welcome-cta">
        <div class="wc-mark" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="48" height="48"><circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" stroke-width="2" opacity=".35" /><path d="M14 30l7-8 6 5 8-11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </div>
        <h1>Votre budget et votre patrimoine, au même endroit</h1>
        <p>
          @if (noUser()) {
            Aucun profil n'est sélectionné. Créez votre espace en une minute : budget « Projet de vie », patrimoine et cycle mensuel sont préparés en une seule fois.
          } @else {
            Ce profil n'a pas encore d'espace Budget &amp; Patrimoine. Créez-en un pour commencer à suivre vos périodes.
          }
        </p>
        <a class="btn primary big-btn" routerLink="/app/bienvenue">Créer mon espace</a>
      </section>
    } @else if (error() && !d()) {
      <div class="alert error" role="alert">
        {{ error()!.message }}
        <p>
          <button type="button" class="btn small" (click)="reload()">Réessayer</button>
          @if (period()) {
            <a class="btn small" routerLink="/app">Revenir à la période en cours</a>
          }
        </p>
      </div>
    } @else if (d(); as d) {
      <div class="dash" [class.is-loading]="loading()" [attr.aria-busy]="loading()">
        <!-- En-tête -->
        <header class="d-head">
          <div>
            <p class="d-eyebrow">{{ greeting() }}</p>
            <h1>{{ d.user.label }}</h1>
            <p class="d-sub">
              <span class="d-type">{{ d.user.userTypeLabel }}</span>
              @if (d.period; as p) {
                <span class="d-dot" aria-hidden="true">·</span>
                <span>{{ p.label }}</span>
                <span class="muted">du {{ p.start | shortDate }} au {{ p.end | shortDate }}</span>
              } @else {
                <span class="d-dot" aria-hidden="true">·</span>
                <span class="muted">Cycle à configurer</span>
              }
            </p>
          </div>
        </header>

        <!-- Sélecteur de période -->
        @if (periods().length) {
          <nav class="periods" aria-label="Choisir la période">
            <ul>
              @for (p of periods(); track p.key) {
                <li>
                  <button
                    type="button"
                    class="period"
                    [class.selected]="p.key === d.period?.key"
                    [attr.aria-pressed]="p.key === d.period?.key"
                    (click)="selectPeriod(p)"
                  >
                    <span class="p-label">{{ p.label }}</span>
                    <span class="p-chip p-{{ chip(p).tone }}">{{ chip(p).label }}</span>
                  </button>
                </li>
              }
            </ul>
          </nav>
        }

        @if (d.cycle?.state === 'to_configure') {
          <aside class="notice" role="note">
            <div class="notice-icon" aria-hidden="true">!</div>
            <div>
              <h2>Votre cycle mensuel reste à configurer</h2>
              <p>
                Les chiffres qui dépendent d'une période (revenus, charges, résultat…) sont <strong>inconnus</strong> tant que le jour
                d'ancrage du cycle n'est pas choisi. Ils ne valent pas 0 : ils ne peuvent simplement pas encore être calculés.
              </p>
              <a class="btn primary" routerLink="/app/reglages">Configurer mon cycle</a>
            </div>
          </aside>
        }

        @if (error()) {
          <div class="alert error" role="alert">{{ error()!.message }}</div>
        }

        <!-- Chiffre principal -->
        @if (hero(); as h) {
          <app-figure-card class="hero-card" [figure]="h" variant="hero" (explain)="openExplain($event)" />
        }

        <!-- Sections administrées -->
        @for (s of sections(); track s.key) {
          <section class="d-section" [attr.aria-labelledby]="'sec-' + $index">
            <h2 class="sec-title" [id]="'sec-' + $index">{{ s.title }}</h2>
            <div class="grid">
              @for (f of s.figures; track f.key) {
                <app-figure-card [figure]="f" (explain)="openExplain($event)" />
              }
            </div>
          </section>
        }

        <!-- Clôture -->
        <section class="d-panel closing" aria-labelledby="closing-title">
          <div class="panel-head">
            <h2 id="closing-title">Clôture de la période</h2>
            @if (d.period; as p) {
              <span class="p-chip p-{{ chip(p).tone }}">{{ chip(p).label }}</span>
            }
          </div>

          @if (d.closure; as c) {
            <div class="closure">
              <p class="closure-lead">
                <span class="check" aria-hidden="true">✓</span>
                <span>{{ c.periodLabel }} a été close le <strong>{{ closedOn(c.createdAt) }}</strong>.</span>
              </p>
              <dl class="closure-facts">
                <div>
                  <dt>Résultat transféré au Patrimoine</dt>
                  <dd class="amount" [class.pos]="c.result > 0" [class.neg]="c.result < 0">{{ signed(c.result) }}</dd>
                </div>
              </dl>
              <div class="closure-calc">
                <p class="cc-caption">Calcul enregistré à la clôture (valeurs figées)</p>
                <code class="cc-formula">
                  @for (t of closureTokens(); track $index) {
                    <span class="tk-{{ t.kind }}">{{ t.text }}</span>
                  }
                </code>
                <p class="cc-expl">{{ c.calculation.explanation }}</p>
                <p class="cc-prov">
                  <span>{{ prov(c) }}</span>
                  <a [routerLink]="['/admin/calculs', c.calculation.metric]">Voir la formule actuelle</a>
                </p>
              </div>
              @if (d.comparison.length) {
                <div class="closure-calc">
                  <p class="cc-caption">Recalcul avec les formules actuelles — comparaison seulement, les chiffres affichés restent ceux enregistrés</p>
                  <ul class="cmp">
                    @for (c of d.comparison; track c.key) {
                      <li>{{ c.label }} : enregistré {{ euro(c.recorded) }} · recalculé {{ euro(c.recomputed) }}</li>
                    }
                  </ul>
                </div>
              }
              <p class="closure-links">
                <a [routerLink]="['/object-management']" [queryParams]="{ inspect: c.id }">Inspecter la clôture</a>
                <a [routerLink]="['/object-management']" [queryParams]="{ inspect: c.capitalizationId }">Inspecter la capitalisation</a>
              </p>
            </div>
          } @else if (d.closing.possible && d.period) {
            @let p = d.period;
            @if (!confirming()) {
              <p class="muted">
                {{ p.label }} est terminée. La clôturer transfère son résultat au Patrimoine, une seule fois, avec la formule en vigueur.
              </p>
              <button type="button" class="btn primary" (click)="askClose()">Clôturer la période</button>
            } @else {
              <div class="confirm" role="group" aria-labelledby="confirm-title">
                <h3 id="confirm-title">Clôturer {{ p.label }} ?</h3>
                @if (preview(); as pv) {
                  <p>
                    Montant qui sera capitalisé :
                    <strong [class.pos]="pv.result > 0" [class.neg]="pv.result < 0">{{ signed(pv.result) }}</strong>
                    (au {{ closedOn(pv.capitalizationDate) }}). Les opérations de cette période ne pourront plus être modifiées. Cette action est définitive.
                  </p>
                  <p class="cc-expl">{{ pv.explanation }}</p>
                  @if (pv.stockBefore !== null) {
                    <p class="muted">Stock enregistré : {{ euro(pv.stockBefore) }} → {{ euro(pv.stockAfter) }}</p>
                  }
                }
                @if (closeError(); as e) {
                  <div class="alert error" role="alert">{{ e }}</div>
                }
                <div class="actions">
                  <button #confirmBtn type="button" class="btn primary" [disabled]="closingNow() || !preview()" (click)="confirmClose(p.key)">
                    {{ closingNow() ? 'Clôture en cours…' : 'Confirmer la clôture' }}
                  </button>
                  <button type="button" class="btn" [disabled]="closingNow()" (click)="cancelClose()">Annuler</button>
                </div>
              </div>
            }
          } @else {
            <p class="muted">{{ d.closing.reason ?? 'Clôture indisponible pour cette période.' }}</p>
          }
          @if (closedMessage()) {
            <p class="success" role="status">{{ closedMessage() }}</p>
          }
        </section>

        <div class="lower">
          <!-- Opérations -->
          <section class="d-panel" aria-labelledby="ops-title">
            <div class="panel-head">
              <h2 id="ops-title">Opérations de la période</h2>
              <a class="more" routerLink="/app/operations">Toutes les opérations</a>
            </div>
            @if (!d.period) {
              <p class="muted">Aucune période tant que le cycle n'est pas configuré.</p>
            } @else if (operations().length === 0) {
              <p class="muted">Aucune opération sur {{ d.period.label }}.</p>
              <a class="btn small" routerLink="/app/operations">Saisir une opération</a>
            } @else {
              <ul class="ops">
                @for (op of shownOperations(); track op.id) {
                  <li class="op">
                    <span class="op-date">{{ opDate(op) | shortDate }}</span>
                    <span class="op-main">
                      <span class="op-label">{{ op.label }}</span>
                      <span class="op-cc">{{ op.costCenterLabel ?? op.directionLabel }}</span>
                    </span>
                    <span class="op-right">
                      <span class="op-amount" [class.pos]="op.direction === 'income'" [class.neg]="op.direction === 'charge'">{{ opAmount(op) }}</span>
                      <span class="op-status" [class.planned]="op.status === 'planned'">{{ op.status === 'realized' ? 'Réalisée' : 'Prévue' }}</span>
                    </span>
                  </li>
                }
              </ul>
              @if (operations().length > shownOperations().length) {
                <p class="muted small">{{ operations().length - shownOperations().length }} autre(s) opération(s) sur la période.</p>
              }
            }
          </section>

          <!-- Projets de la vie -->
          <section class="d-panel" aria-labelledby="lp-title">
            <div class="panel-head">
              <h2 id="lp-title">Projets de la vie</h2>
              <a class="more" routerLink="/app/projets">Tous les projets</a>
            </div>
            @if (d.lifeProjects.length === 0) {
              <p class="muted">Aucun projet de la vie pour l'instant : un voyage, un équipement, une formation…</p>
              <a class="btn small" routerLink="/app/projets">Choisir un projet à financer</a>
            } @else {
              <ul class="lps">
                @for (lp of d.lifeProjects; track lp.budgetId) {
                  <li>
                    <a class="lp" [routerLink]="['/projects', lp.coreProjectId]">
                      <span class="lp-top">
                        <span class="lp-name">{{ lp.name }}</span>
                        <span class="status-chip s-{{ lp.view.status }}">{{ lp.view.statusLabel }}</span>
                      </span>
                      <span class="lp-bar" role="progressbar" [attr.aria-valuenow]="lp.view.completionPercent" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="'Complétude de ' + lp.name">
                        <span [style.width.%]="lp.view.completionPercent"></span>
                      </span>
                      <span class="lp-meta">
                        @if (lp.view.time.taskCount === 0) {
                          Aucune tâche
                        } @else {
                          {{ lp.view.completionPercent }} % · {{ lp.view.doneCount }}/{{ lp.view.time.taskCount }} tâche(s) terminée(s)
                        }
                      </span>
                    </a>
                  </li>
                }
              </ul>
            }
          </section>
        </div>

        <p class="foot-note">
          Chaque chiffre est calculé par une formule administrable — cliquez sur un chiffre pour voir son calcul.
        </p>
      </div>

      <app-figure-explain [figureKey]="explainKey()" [periodKey]="d.period?.key" (closed)="explainKey.set(null)" />
    } @else {
      <div class="dash skeleton" aria-busy="true" aria-label="Chargement du tableau de bord">
        <span class="sk sk-title"></span>
        <span class="sk sk-hero"></span>
        <div class="grid"><span class="sk sk-card"></span><span class="sk sk-card"></span><span class="sk sk-card"></span></div>
      </div>
    }
  `,
  styles: [
    `
      :host { display: block; font-variant-numeric: tabular-nums; }
      .dash { display: flex; flex-direction: column; gap: 22px; transition: opacity .15s; }
      .dash.is-loading { opacity: .6; }
      .pos { color: var(--pos); }
      .neg { color: var(--neg); }
      a:focus-visible, button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }

      /* En-tête */
      .d-head { padding-top: 6px; }
      .d-eyebrow { margin: 0; color: var(--muted); font-size: 0.95rem; }
      h1 { margin: 2px 0 6px; font-size: clamp(1.6rem, 4.5vw, 2.1rem); letter-spacing: -0.02em; line-height: 1.15; }
      .d-sub { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; font-size: 0.95rem; }
      .d-type { font-size: 0.78rem; font-weight: 600; padding: 2px 10px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border); }
      .d-dot { color: var(--muted); }

      /* Périodes */
      .periods { margin: -6px 0 0; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin; -webkit-overflow-scrolling: touch; padding: 4px 2px 6px; }
      .periods ul { list-style: none; margin: 0; padding: 0; display: flex; gap: 8px; width: max-content; }
      .period {
        display: inline-flex; align-items: center; gap: 8px; white-space: nowrap;
        min-height: 40px; padding: 6px 12px 6px 14px; border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--border) 80%, transparent); background: var(--surface);
        color: inherit; font: inherit; font-size: 0.9rem; cursor: pointer;
      }
      .period:hover { border-color: var(--accent); }
      .period.selected { background: var(--app-hero); color: var(--app-hero-text); border-color: var(--app-hero); font-weight: 600; }
      .p-chip { font-size: 0.7rem; font-weight: 600; padding: 1px 8px; border-radius: 999px; white-space: nowrap; }
      .p-current { color: var(--s-doing); background: color-mix(in srgb, var(--s-doing) 14%, transparent); }
      .p-ended { color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, transparent); }
      .p-closed { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
      .p-future { color: var(--muted); background: var(--surface-2); }
      .period.selected .p-chip { background: rgba(255, 255, 255, .16); color: var(--app-hero-text); }

      /* Avis cycle */
      .notice {
        display: flex; gap: 14px; align-items: flex-start;
        padding: 18px 20px; border-radius: 16px;
        background: var(--unknown-bg); color: var(--app-ink, var(--text));
        border: 1px solid color-mix(in srgb, var(--unknown) 40%, transparent);
      }
      .notice h2 { margin: 0 0 6px; font-size: 1.05rem; }
      .notice p { margin: 0 0 12px; max-width: 70ch; }
      .notice-icon { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; background: var(--unknown); color: var(--unknown-bg); }

      /* Sections */
      .hero-card { margin-top: 2px; }
      .d-section { display: flex; flex-direction: column; gap: 12px; }
      .sec-title { margin: 6px 0 0; font-size: 0.8rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-weight: 700; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); gap: 14px; }

      /* Panneaux */
      .d-panel {
        background: var(--surface); border-radius: 16px; padding: 20px 22px; box-shadow: var(--shadow);
        border: 1px solid color-mix(in srgb, var(--border) 60%, transparent); min-width: 0;
      }
      .panel-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 6px 12px; margin-bottom: 12px; }
      .panel-head h2 { margin: 0; font-size: 1.08rem; letter-spacing: -0.005em; }
      .more { font-size: 0.88rem; font-weight: 600; text-underline-offset: 3px; }
      .lower { display: grid; grid-template-columns: minmax(0, 1fr); gap: 22px; }
      @media (min-width: 980px) { .lower { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: start; } }

      /* Clôture */
      .closure-lead { margin: 0 0 14px; display: flex; gap: 10px; align-items: baseline; }
      .check { width: 22px; height: 22px; flex: none; display: inline-grid; place-items: center; border-radius: 50%; background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok); font-weight: 800; font-size: 0.8rem; }
      .closure-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px 24px; margin: 0 0 14px; }
      .closure-facts dt { font-size: 0.78rem; color: var(--muted); }
      .closure-facts dd { margin: 2px 0 0; }
      .amount { font-size: 1.35rem; font-weight: 700; letter-spacing: -0.01em; }
      .closure-calc { background: var(--app-bg); border-radius: 12px; padding: 12px 14px; }
      .cc-caption { margin: 0 0 6px; font-size: 0.72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
      .cc-formula { display: block; font: 0.88rem/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; white-space: pre-wrap; }
      .tk-ref { display: inline-block; max-width: 100%; overflow-wrap: anywhere; background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); border-radius: 4px; padding: 0 3px; font-weight: 600; }
      .tk-fn { color: var(--s-hold); font-weight: 600; }
      .tk-op { color: var(--muted); }
      .cc-expl { margin: 4px 0; font: 0.88rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
      .cc-prov { margin: 6px 0 0; display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 0.8rem; color: var(--muted); }
      .cc-prov a, .closure-links a { font-weight: 600; text-underline-offset: 3px; }
      .closure-links { margin: 12px 0 0; display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 0.88rem; }
      .confirm { border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent); background: color-mix(in srgb, var(--warn) 7%, var(--surface)); border-radius: 12px; padding: 14px 16px; }
      .confirm h3 { margin: 0 0 6px; font-size: 1rem; }
      .confirm p { margin: 0 0 12px; max-width: 70ch; }
      .success { margin: 12px 0 0; color: var(--ok); font-weight: 600; }

      /* Opérations */
      .ops { list-style: none; margin: 0; padding: 0; }
      .op { display: grid; grid-template-columns: 92px minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }
      .op:last-child { border-bottom: 0; }
      .op-date { font-size: 0.82rem; color: var(--muted); white-space: nowrap; }
      .op-main { min-width: 0; display: flex; flex-direction: column; }
      .op-label { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .op-cc { font-size: 0.8rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .op-right { display: flex; flex-direction: column; align-items: flex-end; }
      .op-amount { font-weight: 700; white-space: nowrap; }
      .op-status { font-size: 0.72rem; font-weight: 600; color: var(--ok); }
      .op-status.planned { color: var(--muted); }
      @media (max-width: 520px) {
        .op { grid-template-columns: minmax(0, 1fr) auto; }
        .op-date { grid-column: 1 / -1; }
      }

      /* Projets de la vie */
      .lps { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
      .lp {
        display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 12px;
        background: var(--app-bg); color: inherit; text-decoration: none; border: 1px solid transparent;
      }
      .lp:hover { border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
      .lp-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
      .lp-name { font-weight: 600; overflow-wrap: anywhere; }
      .lp-bar { display: block; height: 6px; border-radius: 999px; background: color-mix(in srgb, var(--border) 70%, transparent); overflow: hidden; }
      .lp-bar span { display: block; height: 100%; background: var(--pos); border-radius: inherit; }
      .lp-meta { font-size: 0.8rem; color: var(--muted); }

      .foot-note { margin: 4px 0 0; text-align: center; color: var(--muted); font-size: 0.85rem; }

      /* Appel à l'action */
      .welcome-cta { max-width: 560px; margin: 40px auto; text-align: center; padding: 36px 24px; background: var(--surface); border-radius: 20px; box-shadow: var(--shadow); }
      .welcome-cta h1 { font-size: clamp(1.4rem, 4vw, 1.8rem); }
      .welcome-cta p { color: var(--muted); margin: 8px 0 22px; }
      .wc-mark { color: var(--pos); margin-bottom: 8px; }
      .big-btn { min-height: 44px; padding: 8px 22px; border-radius: 999px; font-weight: 600; }

      /* Squelette */
      .skeleton { gap: 16px; }
      .sk { display: block; background: color-mix(in srgb, var(--border) 50%, transparent); border-radius: 14px; animation: sk 1.2s ease-in-out infinite; }
      .sk-title { width: 40%; height: 34px; }
      .sk-hero { height: 150px; border-radius: 18px; }
      .sk-card { height: 120px; }
      @keyframes sk { 50% { opacity: .5; } }
      @media (prefers-reduced-motion: reduce) { .sk { animation: none; } .dash { transition: none; } }
      @media (max-width: 480px) { .d-panel { padding: 16px; } .notice { padding: 16px; } }
    `,
  ],
})
export class BpmDashboardPage {
  /** Paramètre de requête `?period=AAAA-MM` (liaison des entrées du routeur). */
  readonly period = input<string>();

  private api = inject(Api);
  private ctx = inject(RecetteContext);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  protected d = signal<BpmDashboard | null>(null);
  protected loading = signal(false);
  protected error = signal<ApiError | null>(null);
  protected noComposition = signal(false);
  protected noUser = computed(() => !this.ctx.userId());
  protected explainKey = signal<string | null>(null);

  protected confirming = signal(false);
  protected closingNow = signal(false);
  protected closeError = signal<string | null>(null);
  protected closedMessage = signal<string | null>(null);
  /** Aperçu figé au moment de la demande : c'est ce montant que la commande vérifie (C02). */
  protected preview = signal<ClosingPreview | null>(null);
  private closeKey = newRequestKey();
  private ticket = 0;
  private confirmBtn = viewChild<ElementRef<HTMLButtonElement>>('confirmBtn');

  protected periods = computed<Period[]>(() => this.d()?.cycle?.periods ?? []);
  protected heroKey = computed(() => this.d()?.sections[0]?.metrics[0] ?? null);
  protected hero = computed(() => {
    const key = this.heroKey();
    return key ? (this.d()?.figures[key] ?? null) : null;
  });
  protected sections = computed<SectionView[]>(() => {
    const d = this.d();
    if (!d) return [];
    const hero = this.heroKey();
    return d.sections
      .map((s, i) => ({
        key: s.id ?? `${i}-${s.title}`,
        title: s.title,
        figures: s.metrics.filter((k, j) => !(i === 0 && j === 0 && k === hero)).map((k) => d.figures[k]).filter((f): f is FigureEvaluation => !!f),
      }))
      .filter((s) => s.figures.length > 0);
  });
  protected operations = computed(() =>
    [...(this.d()?.operations ?? [])].sort((a, b) => this.opDate(b).localeCompare(this.opDate(a)) || b.createdAt.localeCompare(a.createdAt)),
  );
  protected shownOperations = computed(() => this.operations().slice(0, 8));
  protected closureTokens = computed(() => {
    const c = this.d()?.closure;
    if (!c) return [];
    const labels = new Map(c.calculation.inputs.map((i) => [i.name, i.label] as [string, string]));
    return tokenizeFormula(c.calculation.formula, labels);
  });
  protected greeting = computed(() => {
    const h = new Date().getHours();
    return h < 5 || h >= 18 ? 'Bonsoir' : 'Bonjour';
  });

  constructor() {
    effect(() => {
      const period = this.period();
      const user = this.ctx.userId();
      untracked(() => this.load(user, period));
    });
    // L'étape de confirmation remplace le bouton : le focus la suit.
    effect(() => {
      const btn = this.confirmBtn();
      if (btn) queueMicrotask(() => btn.nativeElement.focus());
    });
  }

  protected reload() {
    this.load(this.ctx.userId(), this.period());
  }

  private async load(userId: string | null, periodKey: string | undefined) {
    const ticket = ++this.ticket;
    this.error.set(null);
    this.noComposition.set(false);
    if (!userId) {
      this.d.set(null);
      return;
    }
    if (this.d()?.user.id !== userId) this.d.set(null);
    this.loading.set(true);
    try {
      const d = await this.api.dashboard(periodKey);
      if (ticket !== this.ticket) return;
      if (this.d()?.period?.key !== d.period?.key) this.resetClosing();
      this.d.set(d);
    } catch (err) {
      if (ticket !== this.ticket) return;
      const e = toApiError(err);
      const periodProblem = e.body.details?.['periodKey'] !== undefined;
      if ((e.status === 404 && !periodProblem) || e.body.code === 'CONTEXT_REQUIRED') {
        this.d.set(null);
        this.noComposition.set(true);
      } else {
        this.error.set(e);
      }
    } finally {
      if (ticket === this.ticket) this.loading.set(false);
    }
  }

  protected selectPeriod(p: Period) {
    if (p.key === this.d()?.period?.key) return;
    this.explainKey.set(null);
    this.router.navigate([], { relativeTo: this.route, queryParams: { period: p.key }, queryParamsHandling: 'merge' });
  }

  protected openExplain(key: string) {
    this.explainKey.set(key);
  }

  protected chip(p: Period) {
    return PERIOD_CHIP[p.status ?? ''] ?? { label: p.status ?? '—', tone: 'future' };
  }

  // ---------- clôture ----------

  private resetClosing() {
    this.confirming.set(false);
    this.closeError.set(null);
    this.closedMessage.set(null);
  }

  protected askClose() {
    this.closeError.set(null);
    this.closedMessage.set(null);
    this.preview.set(this.d()?.closing.preview ?? null);
    this.confirming.set(true);
  }

  protected cancelClose() {
    this.confirming.set(false);
    this.closeError.set(null);
  }

  protected async confirmClose(periodKey: string) {
    const pv = this.preview();
    if (!pv) return;
    this.closingNow.set(true);
    this.closeError.set(null);
    try {
      const r = await this.api.closePeriod({ requestKey: this.closeKey, periodKey, expectedResultCents: pv.resultCents });
      this.closeKey = newRequestKey();
      this.confirming.set(false);
      await this.load(this.ctx.userId(), this.period());
      this.closedMessage.set(`${r.closure.periodLabel} est close : ${this.signed(r.closure.result)} transférés au Patrimoine.`);
    } catch (err) {
      const e = toApiError(err);
      if (e.body.code === 'CLOSING_PREVIEW_STALE' && e.body.details?.['preview']) {
        // Données changées depuis l'aperçu : nouveau montant à relire, puis nouvelle confirmation.
        const fresh = e.body.details['preview'] as ClosingPreview;
        this.preview.set(fresh);
        this.closeKey = newRequestKey();
        this.closeError.set(`Les données ont changé depuis l’aperçu : le montant à capitaliser est maintenant ${this.signed(fresh.result)}. Relisez-le avant de confirmer.`);
      } else {
        this.closeError.set(e.message);
      }
    } finally {
      this.closingNow.set(false);
    }
  }

  protected prov(c: NonNullable<BpmDashboard['closure']>) {
    return provenance(c.calculation.parameter);
  }

  protected closedOn(iso: string) {
    return shortDate(iso?.slice(0, 10));
  }

  // ---------- présentation ----------

  protected euro(v: number | null) {
    return euros(v);
  }

  protected signed(v: number | null) {
    if (v === null) return 'Inconnu';
    if (v === 0) return euros(0);
    return `${v > 0 ? '+' : '−'}${euros(Math.abs(v))}`;
  }

  protected opDate(op: Operation) {
    return op.status === 'realized' ? (op.realizedDate ?? op.date) : op.date;
  }

  protected opAmount(op: Operation) {
    const v = op.status === 'realized' ? (op.realizedAmount ?? op.amount) : op.amount;
    return `${op.direction === 'income' ? '+' : '−'}${euros(Math.abs(v))}`;
  }
}
