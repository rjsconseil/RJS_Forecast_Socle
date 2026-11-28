import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { SignedCentsPipe } from '../../core/format';
import { ClosingCheck, ClosingCheckTarget } from '../data/bpm-closing.models';
import { BpmRouterLink } from '../ui/bpm-router-link';
import { AlertTone } from './closing-kit';

/** Une étape ou un élément d'un contrôle, à régler en fenêtre : le contrôle, la cible, l'élément s'il y en a un. */
export interface ClosingFix { check: ClosingCheck; target: ClosingCheckTarget; itemId?: string }

/** Ce qu'était chaque contrôle au dernier passage sur la page (pour dire ce que l'action a changé). */
export interface ChecksBaseline { at: string; checks: Record<string, { state: string; count: number; done: number | null }> }

/** Ton d'alerte d'un contrôle : vert s'il est bon, puis du bleu au rouge selon son niveau et son état. */
export function checkTone(c: Pick<ClosingCheck, 'level' | 'state'>): AlertTone {
  if (c.state === 'ok') return 'ok';
  if (c.state === 'later') return 'n1';
  if (c.state === 'fail') return 'n4';
  return c.level === 'blocking' ? 'n3' : c.level === 'warning' ? 'n2' : 'n1';
}

/**
 * Résolution des incohérences (section « Cohérence du cycle », dépliée) : pour chaque contrôle qui ne va pas, ce qui
 * ne va pas, pourquoi c'est important, les étapes pour le résoudre (avec l'endroit du site où agir), sa progression,
 * les éléments à corriger, et ce qui a changé depuis le dernier passage. Les contrôles bons se lisent à part.
 */
@Component({
  selector: 'bpm-closing-resolution',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BpmRouterLink, SignedCentsPipe],
  template: `
    @if (problems().length) {
      <ol class="rs-list">
        @for (c of problems(); track c.key) {
          <li class="rs-card" [attr.data-tone]="tone(c)" [id]="'closing-check-' + c.key">
            <header class="rs-head">
              <span class="rs-icon" aria-hidden="true"></span>
              <div class="rs-title"><strong>{{ c.label }}</strong><small>{{ levelLabel[c.level] }} · {{ stateLabel[c.state] }}</small></div>
              <b class="rs-value">{{ c.value }}</b>
            </header>
            @if (c.resolution?.problem) { <p class="rs-problem">{{ c.resolution!.problem }}</p> }
            @if (c.resolution?.why) { <p class="rs-why"><b>Pourquoi c’est important</b>{{ c.resolution!.why }}</p> }
            @if (c.resolution?.progress; as pr) {
              @if (pr.total) {
                <div class="rs-progress">
                  <span class="rs-bar" aria-hidden="true"><i [style.width.%]="(pr.done * 100) / pr.total"></i></span>
                  <small>{{ pr.done }} / {{ pr.total }} · {{ pr.total - pr.done ? 'encore ' + (pr.total - pr.done) : 'terminé' }}</small>
                </div>
              }
            }
            @if (deltaOf(c); as d) { <p class="rs-delta">{{ d }}</p> }
            @if (c.resolution?.steps?.length) {
              <div class="rs-how">
                <span class="rs-sub">Pour résoudre</span>
                <ol class="rs-steps">
                  @for (st of c.resolution!.steps; track $index) {
                    <li>
                      <span class="rs-n" aria-hidden="true">{{ $index + 1 }}</span>
                      <span class="rs-text">{{ st.text }}</span>
                      <span class="rs-acts">
                        @if (fixOf(c, st.target); as f) { <button type="button" class="rs-fix" (click)="fix.emit(f)">Régler le problème</button> }
                        @if (st.target?.kind === 'section') {
                          <button type="button" class="rs-go" (click)="go.emit(sectionOf(st.target))">Voir sur cette page →</button>
                        } @else if (link(st.target); as l) {
                          <a class="rs-go" [routerLink]="l.path" [queryParams]="l.query">Y aller →</a>
                        }
                      </span>
                    </li>
                  }
                </ol>
              </div>
            }
            @if (c.items.length) {
              <details class="rs-items" [open]="c.level === 'blocking'">
                <summary>{{ plural(c.items.length + (c.more ?? 0), 'élément à corriger', 'éléments à corriger') }}</summary>
                <ul>
                  @for (it of c.items; track it.id) {
                    <li>
                      <span>{{ it.label }}@if (it.detail) { <small> · {{ it.detail }}</small> }</span>
                      @if (it.amountCents !== null) { <b>{{ it.amountCents | signedCents }}</b> }
                      <span class="rs-acts">
                        @if (fixOf(c, it.target, it.id); as f) { <button type="button" class="rs-fix" (click)="fix.emit(f)">Régler le problème</button> }
                        @if (link(it.target); as l) { <a [routerLink]="l.path" [queryParams]="l.query">Corriger →</a> }
                      </span>
                    </li>
                  }
                </ul>
                @if (c.more) { <p class="rs-more">et {{ plural(c.more, 'autre', 'autres') }}, à voir dans la page indiquée.</p> }
              </details>
            }
          </li>
        }
      </ol>
    } @else {
      <p class="rs-all-ok">Tout se tient : aucune incohérence à résoudre.</p>
    }
    @if (fine().length) {
      <details class="rs-ok">
        <summary>{{ plural(fine().length, 'contrôle bon', 'contrôles bons') }}</summary>
        <ul>
          @for (c of fine(); track c.key) {
            <li><strong>{{ c.label }}</strong><b>{{ c.value }}</b><small>{{ c.text }}</small>@if (resolvedSince(c); as r) { <span class="rs-fixed">{{ r }}</span> }</li>
          }
        </ul>
      </details>
    }
  `,
  styles: `
    :host {
      --al-ok: var(--status-success, #087657); --al-n1: #2463a4; --al-n2: #a67c00; --al-n3: #c25e0b; --al-n4: var(--status-danger, #b63248);
      --r-line: var(--bpm-line, #e0dfe8); --r-muted: var(--bpm-muted, #66667a); --r-soft: var(--bpm-soft, #f7f7fa); --r-surface: var(--bpm-surface, #fff);
      --r-accent: var(--astra-iris, var(--app-accent, #0d7a5f));
      display: grid; gap: 10px; min-width: 0;
    }
    [data-tone='ok'] { --tone: var(--al-ok); } [data-tone='n1'] { --tone: var(--al-n1); } [data-tone='n2'] { --tone: var(--al-n2); }
    [data-tone='n3'] { --tone: var(--al-n3); } [data-tone='n4'] { --tone: var(--al-n4); }
    .rs-list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
    .rs-card {
      display: grid; gap: 8px; padding: 12px 14px; border: 1px solid color-mix(in srgb, var(--tone) 35%, var(--r-line)); border-radius: 10px;
      background: color-mix(in srgb, var(--tone) 4%, var(--r-surface)); box-shadow: inset 4px 0 0 var(--tone); scroll-margin-top: 140px;
    }
    .rs-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; }
    .rs-icon { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--tone); color: #fff; font-size: 13px; font-weight: 800; }
    .rs-icon::before { content: '!'; }
    .rs-card[data-tone='n4'] .rs-icon::before { content: '×'; }
    .rs-card[data-tone='n1'] .rs-icon::before { content: 'i'; }
    .rs-title { display: grid; min-width: 0; }
    .rs-title strong { font-size: 14px; }
    .rs-title small { color: var(--r-muted); font-size: 11.5px; }
    .rs-value { color: var(--tone); font-size: 14px; font-weight: 800; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .rs-problem { margin: 0; font-size: 13.5px; font-weight: 650; }
    .rs-why { margin: 0; color: var(--r-muted); font-size: 12.5px; line-height: 1.5; }
    .rs-why b { display: block; color: var(--ink, #222237); font-size: 11px; letter-spacing: .05em; text-transform: uppercase; }
    .rs-progress { display: flex; align-items: center; gap: 10px; }
    .rs-bar { flex: 1; height: 7px; overflow: hidden; border-radius: 999px; background: var(--r-soft); }
    .rs-bar i { display: block; height: 100%; border-radius: inherit; background: var(--al-ok); }
    .rs-progress small { color: var(--r-muted); font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .rs-delta { margin: 0; padding: 6px 10px; border-radius: 8px; background: color-mix(in srgb, var(--al-ok) 10%, var(--r-surface)); color: var(--al-ok); font-size: 12.5px; font-weight: 650; }
    .rs-how { display: grid; gap: 6px; }
    .rs-sub { color: var(--r-muted); font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
    .rs-steps { display: grid; gap: 5px; margin: 0; padding: 0; list-style: none; }
    .rs-steps li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: baseline; gap: 8px; font-size: 13px; line-height: 1.45; }
    .rs-n { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; background: var(--r-surface); border: 1px solid var(--r-line); color: var(--tone); font-size: 11.5px; font-weight: 800; }
    .rs-go, .rs-items a { padding: 0; border: 0; background: none; color: var(--r-accent); font: inherit; font-size: 12.5px; font-weight: 700; text-decoration: none; white-space: nowrap; cursor: pointer; }
    .rs-go:hover, .rs-items a:hover { text-decoration: underline; }
    .rs-acts { display: inline-flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 4px 10px; }
    .rs-fix {
      padding: 2px 10px; border: 0; border-radius: 999px; background: color-mix(in srgb, var(--r-accent) 11%, transparent);
      color: var(--r-accent); font: inherit; font-size: 12px; font-weight: 700; white-space: nowrap; cursor: pointer;
    }
    .rs-fix:hover { background: color-mix(in srgb, var(--r-accent) 19%, transparent); }
    .rs-items summary, .rs-ok summary { cursor: pointer; color: var(--r-accent); font-size: 12.5px; font-weight: 700; }
    .rs-items ul, .rs-ok ul { display: grid; gap: 4px; margin: 6px 0 0; padding: 0; list-style: none; }
    .rs-items li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: baseline; gap: 10px; padding: 5px 10px; border-radius: 6px; background: var(--r-surface); font-size: 12.5px; }
    .rs-items small, .rs-ok small, .rs-more { color: var(--r-muted); font-size: 11.5px; }
    .rs-items b { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .rs-more { margin: 6px 0 0; }
    .rs-all-ok { margin: 0; padding: 10px 14px; border-radius: 10px; background: color-mix(in srgb, var(--al-ok) 8%, var(--r-surface)); color: var(--al-ok); font-weight: 700; }
    .rs-ok li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 10px; padding: 6px 10px; border-radius: 6px; background: color-mix(in srgb, var(--al-ok) 5%, var(--r-surface)); box-shadow: inset 3px 0 0 var(--al-ok); font-size: 12.5px; }
    .rs-ok b { color: var(--al-ok); white-space: nowrap; }
    .rs-ok small { grid-column: 1 / -1; }
    .rs-fixed { grid-column: 1 / -1; justify-self: start; padding: 1px 8px; border-radius: 999px; background: var(--al-ok); color: #fff; font-size: 11px; font-weight: 700; }
    @container closing (max-width: 680px) { .rs-steps li { grid-template-columns: auto minmax(0, 1fr); } .rs-steps .rs-acts { grid-column: 2; justify-self: start; } .rs-items li { grid-template-columns: minmax(0, 1fr) auto; } }
  `,
})
export class BpmClosingResolution {
  readonly checks = input.required<ClosingCheck[]>();
  readonly periodKey = input<string | null>(null);
  /** État des contrôles au dernier passage sur la page. */
  readonly baseline = input<ChecksBaseline | null>(null);
  /** Aller à une section de la page (étape « voir sur cette page »). */
  readonly go = output<string>();
  /** La page sait-elle ouvrir en fenêtre, sur elle-même, le formulaire qui règle cette étape ou cet élément ? */
  readonly canFix = input<(fix: ClosingFix) => boolean>(() => false);
  /** « Régler le problème » : la page ouvre la fenêtre, sans qu'on la quitte. */
  readonly fix = output<ClosingFix>();

  protected fixOf(check: ClosingCheck, target: ClosingCheckTarget | null | undefined, itemId?: string): ClosingFix | null {
    if (!target) return null;
    const f: ClosingFix = { check, target, itemId };
    return this.canFix()(f) ? f : null;
  }

  protected readonly problems = computed(() => this.checks().filter((c) => c.state !== 'ok'));
  protected readonly fine = computed(() => this.checks().filter((c) => c.state === 'ok'));
  protected readonly levelLabel: Record<string, string> = { blocking: 'Bloquant pour la clôture', warning: 'À voir, gardé dans la clôture', info: 'Pour information' };
  protected readonly stateLabel: Record<string, string> = { ok: 'bon', warn: 'à voir', fail: 'bloque la clôture', later: 'après le dernier jour' };
  protected readonly tone = checkTone;

  protected plural(n: number, one: string, many = `${one}s`) { return `${n} ${n > 1 ? many : one}`; }
  private since() {
    const at = this.baseline()?.at;
    if (!at) return null;
    const d = new Date(at);
    return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
  }
  /** Ce que l'action a changé depuis le dernier passage : éléments résolus, progression, éléments nouveaux. */
  protected deltaOf(c: ClosingCheck): string | null {
    const was = this.baseline()?.checks[c.key];
    const time = this.since();
    if (!was || !time) return null;
    const count = c.items.length + (c.more ?? 0);
    const done = c.resolution?.progress?.done ?? null;
    if (count < was.count) return `${this.plural(was.count - count, 'élément résolu', 'éléments résolus')} depuis votre passage de ${time} : il en reste ${count}.`;
    const total = c.resolution?.progress?.total ?? null;
    if (done !== null && was.done !== null && done > was.done) return `Avancée depuis votre passage de ${time} : ${done - was.done} de plus${total !== null && total > done ? `, encore ${total - done} avant que ce contrôle soit bon` : ''}.`;
    if (count > was.count) return `${this.plural(count - was.count, 'élément nouveau', 'éléments nouveaux')} depuis votre passage de ${time}.`;
    return null;
  }
  protected resolvedSince(c: ClosingCheck): string | null {
    const was = this.baseline()?.checks[c.key];
    const time = this.since();
    return was && time && was.state !== 'ok' ? `Résolu depuis votre passage de ${time}` : null;
  }
  protected sectionOf(t: ClosingCheckTarget | null | undefined) { return t?.kind === 'section' ? t.id : ''; }
  /** Où agir sur le site pour une étape ou un élément. */
  protected link(t: ClosingCheckTarget | null | undefined): { path: string; query: Record<string, string | null> } | null {
    if (!t) return null;
    switch (t.kind) {
      case 'line':
        if (t.coreProjectId) return { path: `/app/gestion-projet/${t.coreProjectId}`, query: { ligne: t.id } };
        return t.page === 'echeances' ? { path: '/projet-de-vie/echeances', query: { ligne: t.id } } : { path: '/tableau-de-bord/entrees', query: { ligne: t.id } };
      case 'decisions': return { path: '/projet-de-vie/projets-finances', query: {} };
      case 'center': return { path: `/argent/postes/${t.ref.replace(/^std:/, '')}`, query: { period: this.periodKey() } };
      case 'project': return t.coreProjectId ? { path: `/app/gestion-projet/${t.coreProjectId}`, query: {} } : null;
      case 'page': return { path: PAGES[t.path] ?? '/projet-de-vie/echeances', query: {} };
      default: return null;
    }
  }
}

const PAGES: Record<string, string> = {
  echeances: '/projet-de-vie/echeances',
  mouvements: '/tableau-de-bord/entrees',
  plafonds: '/plafonds',
  'budget-type': '/projet-de-vie/budget-type',
};
