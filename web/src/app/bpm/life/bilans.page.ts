import { BpmAmount } from '../ui/amount';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BpmRouterLink } from '../ui/bpm-router-link';
import { BpmApi } from '../data/bpm-api.service';
import { Bilan, BilanSource, BilanStatus } from '../data/bpm-bilans.models';
import { cents, CentsPipe, ShortDatePipe, SignedCentsPipe } from '../../core/format';
import { injectPageWorkspace } from '../../plan/page-workspace';
import { bpmLoader, BpmPageContext, BpmPageFrame, BpmState } from '../ui';

const STATUS_LABEL: Record<BilanStatus, string> = { closed: 'Clos', ended: 'Terminé, à clôturer', current: 'En cours' };
const SOURCE_HINT: Record<BilanSource, string> = {
  enregistré: 'Bilan figé à la clôture.',
  recalculé: 'Clos avant les bilans : recalculé avec les données actuelles.',
  provisoire: 'Bilan provisoire, figé à la clôture.',
};
/** Faits marquants qui ne se lisent pas déjà dans les chiffres du bilan (résultat, épargne, plafonds… y sont). */
const NOTE_KINDS = new Set(['record', 'milestone']);

/** Les enveloppes attribuées pendant le cycle, en une seule ligne. */
function allocationNote(b: Bilan) {
  const given = b.projects.filter((p) => p.allocatedInPeriod);
  if (!given.length) return [];
  const total = given.reduce((sum, p) => sum + (p.allocationCents ?? 0), 0);
  const names = given.slice(0, 3).map((p) => p.name).join(', ') + (given.length > 3 ? ' et ' + (given.length - 3) + ' autre(s)' : '');
  return [{ kind: 'allocation', tone: 'neutral' as const, title: given.length > 1 ? `${given.length} enveloppes attribuées` : 'Enveloppe attribuée', text: `${cents(total)} réservés : ${names}.` }];
}

const pct = (part: number | null | undefined, whole: number | null | undefined) =>
  part === null || part === undefined || !whole ? null : Math.round((part / whole) * 100);

/**
 * Bilans des cycles budgétaires (docs/LORE-BPM.md). Lecture seule, en quatre temps :
 * 1. le résultat du cycle choisi et son effet sur le patrimoine ;
 * 2. ses dépenses, par nature et par poste ;
 * 3. ses projets de la vie et les décisions prises ;
 * 4. tous les cycles : cumul et coût des projets, cycle par cycle.
 * L'historique, à gauche, choisit le cycle lu.
 */
@Component({
  selector: 'bpm-bilans-page',
  providers: [BpmPageContext],
  imports: [BpmAmount, BpmPageFrame, BpmState, BpmRouterLink, CentsPipe, SignedCentsPipe, ShortDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './bilans.page.scss',
  template: `
    <bpm-page
      [title]="workspace()?.title ?? 'Bilans des cycles'"
      pageClass="bpm-bilans"
      lead="Chaque cycle laisse son bilan : son résultat, ses dépenses, ses projets et ce qu’il a versé au patrimoine."
      [context]="list.data()?.context"
    >
      @if (current(); as c) {
        <a primary class="btn btn-primary" [routerLink]="[]" queryParamsHandling="merge" [queryParams]="{ cycle: c.period.key }" [attr.aria-label]="'Lire le bilan en cours · ' + c.period.label">Lire le bilan en cours</a>
      }
      <a actions class="btn btn-secondary" routerLink="/projet-de-vie/cloture">Clôturer un cycle</a>

      <bpm-state [loading]="list.loading() && !list.data()" [error]="list.error()" (retry)="list.reload()" />
      @if (list.data(); as l) {
        <div class="bl-layout">
          <!-- L'historique : choisit le cycle lu, du plus récent au plus ancien. -->
          <nav class="bl-history" aria-labelledby="bl-history-title">
            <h2 id="bl-history-title">Historique des cycles</h2>
            <p class="bl-muted">{{ l.totals.closedCount }} cycle(s) clos · {{ l.totals.capitalizedCents | signedCents }} versés</p>
            <ol>
              @for (s of l.bilans; track s.period.key) {
                <li>
                  <a [routerLink]="[]" queryParamsHandling="merge" [queryParams]="{ cycle: s.period.key }" [attr.aria-current]="s.period.key === selectedKey() ? 'true' : null" [attr.data-status]="s.status">
                    <span class="bl-history-head"><strong>{{ s.period.label }}</strong><span class="bl-chip" [attr.data-status]="s.status">{{ statusLabel[s.status] }}</span></span>
                    <span class="bl-history-figures">
                      <span [attr.data-sign]="(s.resultCents ?? 0) < 0 ? 'negative' : 'positive'" [bpmAmount]="s.resultCents">{{ s.resultCents | signedCents }}</span>
                      @if (closures().get(s.period.key); as row) {
                        @if (row.meetsTarget !== null) { <small [attr.data-ok]="row.meetsTarget">{{ row.meetsTarget ? 'Objectif atteint' : 'Sous l’objectif' }}</small> }
                      }
                    </span>
                  </a>
                </li>
              } @empty {
                <li class="bl-muted">Aucun cycle encore : fixez l’ancrage du cycle pour commencer.</li>
              }
            </ol>
          </nav>

          <article class="bl-detail" aria-live="polite">
            <bpm-state [loading]="detail.loading() && !detail.data()" [error]="detail.error()" (retry)="detail.reload()" />
            @if (view(); as v) {
              @let b = v.bilan;

              <!-- 1. Résultat du cycle et effet sur le patrimoine. -->
              <section class="bl-block bl-result" aria-labelledby="bl-detail-title">
                <header class="bl-result-head">
                  <div>
                    <p class="bl-kick"><span class="bl-chip" [attr.data-status]="b.status">{{ statusLabel[b.status] }}</span> {{ b.period.start | shortDate }} → {{ b.period.end | shortDate }}</p>
                    <h2 id="bl-detail-title">Bilan · {{ b.period.label }}</h2>
                    <p class="bl-muted">{{ sourceHint[b.source] }}@if (b.closedAt) { Clos le {{ b.closedAt.slice(0, 10) | shortDate }}. }</p>
                  </div>
                  <a class="btn btn-secondary small" routerLink="/tableau-de-bord" [queryParams]="{ period: b.period.key }">Ouvrir la période</a>
                </header>

                <div class="bl-equation">
                  <div><span>Entrées reçues</span><strong [bpmAmount]="b.flows.receivedCents" bpmFlow="income">{{ b.flows.receivedCents | cents }}</strong><small>{{ b.flows.receivedCount }} entrée(s)</small></div>
                  <b aria-hidden="true">−</b>
                  <div><span>Dépenses réglées</span><strong [bpmAmount]="b.flows.spentCents" bpmFlow="expense">{{ b.flows.spentCents | cents }}</strong><small>{{ b.flows.paidCount }} règlement(s)</small></div>
                  <b aria-hidden="true">=</b>
                  <div class="is-result" [attr.data-sign]="(v.result ?? 0) < 0 ? 'negative' : 'positive'">
                    <span>{{ b.status === 'closed' ? 'Résultat versé au patrimoine' : 'Résultat à ce jour' }}</span>
                    <strong [bpmAmount]="v.result">{{ v.result | signedCents }}</strong>
                    <small>{{ b.flows.savingsRatePct ?? '—' }} % des entrées conservées</small>
                  </div>
                </div>

                <div class="bl-gauges">
                  <div class="bl-gauge" [attr.data-tone]="v.savingsPct === null ? 'neutral' : v.savingsPct >= 100 ? 'positive' : 'warning'">
                    <p><span>Épargne visée</span><strong>{{ v.savingsPct === null ? 'Sans objectif' : v.savingsPct + ' %' }}</strong></p>
                    <div class="bl-bar" aria-hidden="true"><i [style.width.%]="v.savingsBar"></i></div>
                    <small>@if (b.flows.savingsTargetCents) { {{ v.result | signedCents }} pour {{ b.flows.savingsTargetCents | cents }} visés } @else { Aucune épargne visée pour ce cycle }</small>
                  </div>
                  <div class="bl-gauge" data-tone="patrimoine">
                    <p><span>Patrimoine</span><strong>{{ b.patrimoine.stockBeforeCents | cents }} → {{ b.patrimoine.stockAfterCents | cents }}</strong></p>
                    <div class="bl-bar" aria-hidden="true"><i class="is-before" [style.width.%]="v.wealthBefore"></i><i [style.width.%]="v.wealthGain"></i></div>
                    <small>@if (b.patrimoine.objectiveCents) { {{ b.patrimoine.progressBeforePct ?? 0 }} % → {{ b.patrimoine.progressAfterPct ?? '—' }} % de l’objectif de {{ b.patrimoine.objectiveCents | cents }} } @else { Aucun objectif de patrimoine fixé }</small>
                  </div>
                </div>

                @if (v.notes.length) {
                  <ul class="bl-notes" aria-label="À retenir">
                    @for (h of v.notes; track h.kind + h.title) { <li [attr.data-tone]="h.tone"><strong>{{ h.title }}</strong> {{ h.text }}</li> }
                  </ul>
                }
              </section>

              <!-- 2. Où l'argent est parti. -->
              <section class="bl-block" aria-labelledby="bl-spending-title">
                <header class="bl-block-head">
                  <h3 id="bl-spending-title">Dépenses du cycle</h3>
                  @if (b.biggest; as g) { <p class="bl-muted">Plus grosse : {{ g.label }} · <strong [bpmAmount]="g.cents" bpmFlow="expense">{{ g.cents | cents }}</strong></p> }
                </header>
                <div class="bl-duo">
                  <div>
                    <h4>Par nature</h4>
                    <ul class="bl-rows">
                      @for (n of b.natures; track n.key) {
                        <li [class.is-projects]="n.key === 'projet'">
                          <span>{{ n.label }}</span><strong [bpmAmount]="n.paidCents" bpmFlow="expense">{{ n.paidCents | cents }}</strong>
                          <div class="bl-bar is-thin" aria-hidden="true"><i [style.width.%]="n.sharePct ?? 0"></i></div><small>{{ n.sharePct === null ? '—' : n.sharePct + ' %' }}</small>
                        </li>
                      }
                    </ul>
                  </div>
                  <div>
                    <h4>Par poste</h4>
                    <ul class="bl-rows">
                      @for (c of v.centers; track c.ref) {
                        <li [class.is-over]="c.over">
                          <span>{{ c.label }}</span><strong [bpmAmount]="c.paidCents" bpmFlow="expense">{{ c.paidCents | cents }}</strong>
                          @if (c.over; as o) { <small class="bl-over">Plafond {{ o.capCents | cents }} dépassé de {{ o.overCents | cents }}</small> }
                        </li>
                      } @empty { <li class="bl-muted">Aucune dépense réglée.</li> }
                    </ul>
                    @for (o of v.otherCaps; track o.label) { <p class="bl-over">{{ o.level }} « {{ o.label }} » : {{ o.overCents | cents }} au-delà de {{ o.capCents | cents }}.</p> }
                    @if (!b.caps.overCount) { <p class="bl-muted">Aucun plafond dépassé.</p> }
                  </div>
                </div>
              </section>

              <!-- 3. Projets de la vie et décisions. -->
              <section class="bl-block" aria-labelledby="bl-projects-title">
                <header class="bl-block-head">
                  <h3 id="bl-projects-title">Projets et décisions</h3>
                  <p class="bl-muted">Une dépense de projet compte au cycle qui la valide, ou au patrimoine s’il la finance.</p>
                </header>
                <dl class="bl-stats">
                  <div><dt>Payé par le cycle</dt><dd [bpmAmount]="b.patrimoine.projectsCents" bpmFlow="expense">{{ b.patrimoine.projectsCents | cents }}</dd></div>
                  <div><dt>Pris au patrimoine</dt><dd [bpmAmount]="(b.patrimoine.withdrawnCents ?? 0)" bpmFlow="expense">{{ (b.patrimoine.withdrawnCents ?? 0) | cents }}</dd></div>
                  <div><dt>Parts accordées</dt><dd>{{ b.decisions.sharesGranted }}<small>{{ b.decisions.sharesGrantedCents | cents }}@if (b.decisions.sharesRefused) { · {{ b.decisions.sharesRefused }} refusée(s) }</small></dd></div>
                  <div><dt>Dépassements accordés</dt><dd>{{ b.decisions.overrunsApproved }}<small>{{ b.decisions.overrunsApprovedCents | cents }}</small></dd></div>
                  <div><dt>{{ b.status === 'closed' ? 'Échéances non réglées' : 'Échéances ouvertes' }}</dt><dd>{{ b.status === 'closed' ? b.deadlines.unrealizedCount : b.deadlines.openCount }}</dd></div>
                </dl>
                @if (v.paidProjects.length) {
                  <div class="bl-table-wrap" role="region" aria-label="Projets du cycle" tabindex="0">
                    <table class="bl-table">
                      <thead><tr><th scope="col">Projet</th><th scope="col">Financé par</th><th scope="col" class="num">Réglé ce cycle</th><th scope="col" class="num">Enveloppe</th><th scope="col" class="num">Réglé au total</th></tr></thead>
                      <tbody>
                        @for (p of v.paidProjects; track p.budgetId + ':' + p.fundingSource) {
                          <tr>
                            <th scope="row"><a [routerLink]="['/app/gestion-projet', p.coreProjectId]">{{ p.name }}</a>@if (p.allocatedInPeriod) { <small>Enveloppe attribuée ce cycle</small> }</th>
                            <td>{{ p.fundingSource === 'patrimoine' ? 'Patrimoine' : 'Cycle' }}</td>
                            <td class="num" [bpmAmount]="p.paidCents" bpmFlow="expense">{{ p.paidCents | cents }}</td>
                            <td class="num">{{ p.allocationCents === null ? 'À attribuer' : (p.allocationCents | cents) }}</td>
                            <td class="num" [bpmAmount]="p.paidToDateCents" bpmFlow="expense">{{ p.paidToDateCents | cents }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                } @else {
                  <p class="bl-muted">Aucun projet n’a réglé de dépense pendant ce cycle.</p>
                }
                @if (v.traces.length) {
                  <details class="bl-traces">
                    <summary>Mouvements imputés à un autre cycle ({{ v.traces.length }}) · sans effet sur ce bilan</summary>
                    <ul>@for (t of v.traces; track t.id) { <li><span>{{ t.text }}</span><strong>{{ t.cents | cents }}</strong></li> }</ul>
                  </details>
                }
              </section>
            }
          </article>
        </div>

        <!-- 4. Tous les cycles : le cumul et ce que les projets ont coûté, cycle par cycle. -->
        <section class="bl-block bl-all" aria-labelledby="bl-ledger-title">
          <header class="bl-block-head">
            <h2 id="bl-ledger-title">Tous les cycles</h2>
            <p class="bl-muted">Ce que les cycles ont versé au patrimoine et ce que chaque projet leur a coûté.</p>
          </header>
          <dl class="bl-stats is-six">
            <div><dt>Cycles clos</dt><dd>{{ l.totals.closedCount }}</dd></div>
            <div><dt>Versé au patrimoine</dt><dd [bpmAmount]="l.totals.capitalizedCents">{{ l.totals.capitalizedCents | signedCents }}</dd></div>
            <div><dt>Moyenne par cycle</dt><dd [bpmAmount]="all().averageCents">{{ all().averageCents | signedCents }}</dd></div>
            <div><dt>Épargne visée atteinte</dt><dd>{{ all().met }} / {{ all().judged }}<small>cycle(s) avec objectif</small></dd></div>
            <div><dt>Coût des projets</dt><dd [bpmAmount]="l.totals.projectsClosedCents" bpmFlow="expense">{{ l.totals.projectsClosedCents | cents }}<small>sur les cycles clos</small></dd></div>
            <div><dt>Prélevé hors cycle</dt><dd [bpmAmount]="(l.totals.withdrawnCents ?? 0)" bpmFlow="expense">{{ (l.totals.withdrawnCents ?? 0) | cents }}<small>sur le patrimoine</small></dd></div>
          </dl>
          @if (all().spending.length) {
            <div class="bl-table-wrap">
              <table class="bl-table">
                <thead><tr><th scope="col">Projet</th><th scope="col">Financé par</th><th scope="col">Cycles qui l’ont payé</th><th scope="col" class="num">Cycles clos</th><th scope="col" class="num">Cycle en cours</th></tr></thead>
                <tbody>
                  @for (p of all().spending; track p.budgetId + ':' + p.fundingSource) {
                    <tr>
                      <th scope="row"><a [routerLink]="['/app/gestion-projet', p.coreProjectId]">{{ p.name }}</a></th>
                      <td>{{ p.fundingSource === 'patrimoine' ? 'Patrimoine' : 'Cycle' }}</td>
                      <td>@for (c of p.cycles; track c.periodKey) { <a class="bl-cycle-tag" [attr.data-status]="c.status" [routerLink]="[]" queryParamsHandling="merge" [queryParams]="{ cycle: c.periodKey }">{{ c.label }} · {{ c.paidCents | cents }}</a> }</td>
                      <td class="num" [bpmAmount]="p.closedCents" bpmFlow="expense">{{ p.closedCents | cents }}</td>
                      <td class="num" [bpmAmount]="p.provisionalCents" bpmFlow="expense">{{ p.provisionalCents | cents }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          @if (all().idle; as idle) {
            <p class="bl-muted">{{ all().spending.length ? 'Les ' + idle + ' autres projets' : 'Les ' + idle + ' projets de la vie' }} n’ont encore réglé aucune dépense.</p>
          }
        </section>
      }
    </bpm-page>
  `,
})
export class BpmBilansPage {
  protected readonly workspace = injectPageWorkspace();
  private readonly bpm = inject(BpmApi);
  protected readonly ctx = inject(BpmPageContext);
  protected readonly results = bpmLoader(this.ctx.period, period => this.bpm.lifeManagement(period));
  protected readonly closures = computed(() => new Map(this.results.data()?.results.rows.map(row => [row.periodKey, row])));
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly sourceHint = SOURCE_HINT;
  protected readonly list = bpmLoader(() => 0, () => this.bpm.bilans());
  /** Le cycle ouvert : celui de l'adresse, sinon le dernier clos, sinon le plus récent. */
  protected readonly selectedKey = computed(() => {
    const asked = this.ctx.query().get('cycle') || this.ctx.period();
    const all = this.list.data()?.bilans ?? [];
    if (asked && all.some((b) => b.period.key === asked)) return asked;
    return (all.find((b) => b.status === 'closed') ?? all[0])?.period.key ?? null;
  });
  protected readonly current = computed(() => this.list.data()?.bilans.find((b) => b.status === 'current') ?? null);
  protected readonly detail = bpmLoader(() => this.selectedKey(), (k) => (k ? this.bpm.bilan(k) : Promise.resolve(null)));

  /** Le bilan lu, mis en forme : résultat, jauges, postes avec leur plafond, faits à retenir, traces. */
  protected readonly view = computed(() => {
    const b: Bilan | undefined = this.detail.data()?.bilan;
    if (!b) return null;
    const result = b.patrimoine.capitalizedCents ?? b.flows.resultCents;
    const savingsPct = pct(result, b.flows.savingsTargetCents);
    const p = b.patrimoine;
    const scale = p.objectiveCents ?? Math.max(p.stockAfterCents ?? 0, p.stockBeforeCents ?? 0);
    const wealthBefore = Math.max(0, Math.min(100, pct(Math.min(p.stockBeforeCents ?? 0, p.stockAfterCents ?? 0), scale) ?? 0));
    const wealthGain = Math.max(0, Math.min(100 - wealthBefore, pct(Math.abs((p.stockAfterCents ?? 0) - (p.stockBeforeCents ?? 0)), scale) ?? 0));
    const overByLabel = new Map(b.caps.over.map((o) => [o.label, o]));
    const centers = b.centers.map((c) => ({ ...c, over: overByLabel.get(c.label) ?? null }));
    const shown = new Set(b.centers.map((c) => c.label));
    const traces = [
      ...(b.announcementTrace ?? []).map((t) => ({ id: 'a' + t.id, cents: t.realizedCents, text: `${t.label} · annoncé le ${t.plannedDate}, imputé le ${t.accountingDate}` })),
      ...(b.paymentTrace ?? []).map((t) => ({ id: 'p' + t.id, cents: t.realizedCents, text: `${t.label} · payé le ${t.realizedDate}, validé le ${t.accountingDate}` })),
    ];
    return {
      bilan: b,
      result,
      savingsPct,
      savingsBar: Math.max(0, Math.min(100, savingsPct ?? 0)),
      wealthBefore,
      wealthGain,
      centers,
      otherCaps: b.caps.over.filter((o) => !shown.has(o.label)),
      notes: [...b.highlights.filter((h) => NOTE_KINDS.has(h.kind)), ...allocationNote(b)],
      traces,
      paidProjects: b.projects.filter((p) => p.paidCents),
    };
  });

  /** Tous les cycles : moyenne, cycles à l'objectif, projets qui ont réellement coûté. */
  protected readonly all = computed(() => {
    const rows = this.results.data()?.results.rows ?? [];
    const judged = rows.filter((r) => r.meetsTarget !== null);
    const projects = this.list.data()?.projects ?? [];
    const spending = projects.filter((p) => p.closedCents || p.provisionalCents || p.cycles.length);
    return {
      averageCents: this.results.data()?.results.averageCents ?? null,
      met: judged.filter((r) => r.meetsTarget).length,
      judged: judged.length,
      spending,
      idle: projects.length - spending.length,
    };
  });
}
