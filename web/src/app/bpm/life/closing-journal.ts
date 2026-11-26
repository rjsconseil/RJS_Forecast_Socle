import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CentsPipe } from '../../core/format';
import { ClosingAction, ClosingActions } from '../data/bpm-closing.models';
import { BpmAmount } from '../ui/amount';
import { BpmRouterLink } from '../ui/bpm-router-link';

/** « 22 nov. · 15 h 35 » (heure locale). */
export function whenOf(at: string) {
  const d = new Date(at);
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} · ${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Actions du cycle (page « Clôture du cycle ») : tout ce qui a été enregistré sur Astra et touche le cycle, par
 * catégorie, avec son contexte et le lien vers son objet. Consultatif : la page le range dans une ligne dépliable.
 */
@Component({
  selector: 'bpm-closing-journal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BpmRouterLink, BpmAmount, CentsPipe],
  template: `
    @let ac = actions();
    @if (!ac.source.complete && ac.source.journalFrom) {
      <p class="jn-note">Avant le {{ when(ac.source.journalFrom) }}, le journal du site n’est plus détaillé : les actions de ce début de cycle sont reconstituées depuis les données (création et dernière modification de chaque objet).</p>
    }
    <div class="jn-categories">
      @for (cat of ac.categories; track cat.key) {
        <details class="jn-category" [attr.data-part]="cat.part">
          <summary>
            <span class="jn-title"><strong>{{ cat.label }}</strong><small>{{ cat.text }}</small></span>
            <span class="jn-meta"><b>{{ cat.count }} action{{ cat.count > 1 ? 's' : '' }}</b>@if (cat.lastAt) { <small>dernière le {{ when(cat.lastAt) }}</small> }</span>
          </summary>
          @if (cat.items.length) {
            <ol class="jn-list">
              @for (a of cat.items; track a.command + a.objectId + a.at) {
                <li class="jn-action" [attr.data-effect]="a.effect">
                  <time [attr.datetime]="a.at">{{ when(a.at) }}</time>
                  <div class="jn-main">
                    <span><strong>{{ a.verb }}</strong> · {{ a.label }}@if (a.count > 1) {&ngsp;<span class="jn-count">× {{ a.count }}</span>}</span>
                    @if (a.detail) { <small>{{ a.detail }}</small> }
                  </div>
                  @if (a.amountCents !== null) { <span class="jn-amount" [bpmAmount]="a.amountCents" [bpmFlow]="a.direction ?? 'charge'">{{ a.amountCents | cents }}</span> }
                  @if (link(a); as l) { <a class="jn-open" [routerLink]="l.path" [queryParams]="l.query" [attr.aria-label]="'Ouvrir : ' + a.label">Ouvrir →</a> }
                </li>
              }
            </ol>
          } @else {
            <p class="jn-empty">Aucune action de cette catégorie ce cycle.</p>
          }
        </details>
      }
    </div>
  `,
  styles: `
    :host { --j-line: var(--bpm-line, #e0dfe8); --j-muted: var(--bpm-muted, #66667a); --j-soft: var(--bpm-soft, #f7f7fa); --j-surface: var(--bpm-surface, #fff); display: grid; gap: 8px; min-width: 0; }
    .jn-note { margin: 0; padding: 8px 12px; border-radius: 8px; background: var(--j-soft); color: var(--j-muted); font-size: 12px; line-height: 1.5; }
    .jn-categories { display: grid; gap: 8px; }
    .jn-category { --part: var(--j-muted); border: 1px solid var(--j-line); border-radius: 10px; background: var(--j-surface); box-shadow: inset 3px 0 0 var(--part); }
    .jn-category[data-part='quotidien'] { --part: #0d7a5f; }
    .jn-category[data-part='projets'] { --part: #2f5bd0; }
    .jn-category[data-part='patrimoine'] { --part: #8f5e00; }
    .jn-category > summary { display: flex; align-items: center; justify-content: space-between; gap: 10px 16px; padding: 10px 14px; cursor: pointer; list-style: none; }
    .jn-category > summary::-webkit-details-marker { display: none; }
    .jn-category > summary::before { content: ''; flex: none; width: 7px; height: 7px; border: solid var(--j-muted); border-width: 0 2px 2px 0; transform: rotate(-45deg); }
    .jn-category[open] > summary::before { transform: rotate(45deg); }
    .jn-title { flex: 1; display: grid; gap: 1px; min-width: 0; }
    .jn-title strong { font-size: 14px; }
    .jn-title small, .jn-meta small, .jn-main small { color: var(--j-muted); font-size: 12px; line-height: 1.45; }
    .jn-meta { display: grid; justify-items: end; gap: 1px; text-align: right; white-space: nowrap; }
    .jn-meta b { color: var(--part); font-size: 13px; }
    .jn-empty { margin: 0; padding: 0 14px 12px; color: var(--j-muted); font-size: 12.5px; }
    .jn-list { display: grid; margin: 0; padding: 0 14px 10px; list-style: none; }
    .jn-action { display: grid; grid-template-columns: 118px minmax(0, 1fr) auto auto; align-items: baseline; gap: 2px 12px; padding: 7px 0; border-top: 1px solid var(--j-line); }
    .jn-action time { color: var(--j-muted); font-size: 11.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .jn-main { display: grid; gap: 1px; min-width: 0; }
    .jn-main > span { font-size: 13px; overflow-wrap: anywhere; }
    .jn-count { padding: 1px 7px; border-radius: 999px; background: var(--j-soft); border: 1px solid var(--j-line); color: var(--j-muted); font-size: 11px; font-weight: 600; }
    .jn-amount { font-size: 13px; font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .jn-action[data-effect='none'] .jn-amount { text-decoration: line-through; opacity: .6; }
    .jn-open { color: var(--astra-iris, var(--app-accent, #0d7a5f)); font-size: 12.5px; font-weight: 650; text-decoration: none; white-space: nowrap; }
    .jn-open:hover { text-decoration: underline; }
    @container closing (max-width: 680px) { .jn-action { grid-template-columns: minmax(0, 1fr) auto; } .jn-action time { grid-column: 1 / -1; } }
  `,
})
export class BpmClosingJournal {
  readonly actions = input.required<ClosingActions>();
  protected readonly when = whenOf;

  /** Où retrouver l'objet d'une action. */
  protected link(a: ClosingAction): { path: string; query: Record<string, string | null> } | null {
    const t = a.target;
    if (!t) return null;
    switch (t.kind) {
      case 'line': return t.coreProjectId ? { path: `/app/gestion-projet/${t.coreProjectId}`, query: { ligne: t.id } } : { path: '/tableau-de-bord/entrees', query: { ligne: t.id } };
      case 'recurring': return t.coreProjectId ? { path: `/app/gestion-projet/${t.coreProjectId}`, query: {} } : { path: '/projet-de-vie/budget-type', query: {} };
      case 'project': return t.coreProjectId ? { path: `/app/gestion-projet/${t.coreProjectId}`, query: {} } : { path: '/projet-de-vie/projets', query: {} };
      case 'caps': return { path: '/plafonds', query: {} };
      case 'goals': return { path: '/bpm-astra/objectif', query: {} };
      case 'patrimoine': return { path: '/bpm-astra/patrimoine', query: {} };
      case 'cycle': return { path: '/app/reglages/cycle', query: {} };
      case 'bilan': return { path: '/projet-de-vie/bilans', query: { period: t.periodKey } };
    }
  }
}
