import { BpmAmount } from '../ui/amount';
import { BpmFinancialOutlookPanel } from '../ui/financial-outlook';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { BpmRouterLink } from '../ui/bpm-router-link';
import { of } from 'rxjs';
import { RecetteContext } from '../../core/api.service';
import { BpmApi } from '../data/bpm-api.service';
import { ForecastItem, MeteoSection, SignalHealth } from '../data/bpm-meteo.models';
import { CentsPipe, ShortDatePipe, SignedCentsPipe } from '../../core/format';
import { injectPageWorkspace } from '../../plan/page-workspace';
import { planZone, sectionMark, zoneSections } from '../../plan/site-plan';
import { projectLink } from '../bpm.screens';
import { bpmLoader, BpmPageContext, BpmPageFrame, BpmState } from '../ui';

type MeteoView = 'wealth' | 'home' | 'life' | 'projects' | 'forecast' | 'trends' | 'reading';

const LEAD: Record<MeteoView, string> = {
  wealth: 'Le stock disponible, les mouvements des projets et le cap que vous préparez.',
  home: 'Le temps qu’il fait sur vos trois sections : Mon projet de vie, Gestion de projet et Patrimoine. Chaque nuage a sa cause et son geste.',
  life: 'Chaque volet du projet de vie, son état, son chiffre clé et le geste qui le remet au beau.',
  projects: 'Les signaux de la gestion de projet, puis la météo de chaque projet de la vie, du plus exposé au plus serein.',
  forecast: 'Ce qui arrive dans les 30 prochains jours : règlements attendus, tâches à rendre, fin du cycle, puis les objectifs datés de l’année.',
  trends: 'La météo de chaque cycle d’après son bilan, et le sens dans lequel vont vos résultats.',
  reading: 'Une seule règle fait la météo de toutes les pages : la voici, avec ce que lit chaque signal.',
};
const KIND_LABEL: Record<ForecastItem['kind'], string> = { entree: 'Entrée', depense: 'Dépense', tache: 'Tâche', cycle: 'Cycle', facturation: 'Décision', decision: 'Décision' };
/** Ce que lit chaque signal : la page « Lire la météo » le dit en clair. */
const SOURCES: { section: string; items: [string, string][] }[] = [
  { section: 'Patrimoine', items: [['Stock disponible', 'Stock initial, résultats capitalisés et mouvements directs déjà validés.'], ['Achats et gains annoncés', 'Flux de tâches encore à valider, séparés du stock disponible.'], ['Cap patrimonial', 'Objectif de stock, sans réservation d’argent.']] },
  { section: 'Mon projet de vie', items: [
    ['Cycle en cours', 'Reçu, dépensé et reste du cycle, comparés au budget initial.'],
    ['Charges indispensables et courantes', 'Règlements, retards et plafonds de chaque nature de charge.'],
    ['Projets financés', 'Enveloppes attribuées, dépenses validées, dépassements et demandes.'],
    ['Résultats des cycles', 'Cycles terminés à clôturer et résultats capitalisés.'],
    
    ['Échéances à régler', 'Règlements en retard, puis ceux attendus dans les sept jours.'],
  ] },
  { section: 'Gestion de projet', items: [
    ['Enveloppes des projets', 'Projet au-delà de son enveloppe (alerte), dépassement à décider (à surveiller), projet sans enveloppe (à renseigner).'],
    ['Décisions à prendre', 'Demandes de part et de dépassement qui attendent votre accord.'],
    ['Tâches en retard', 'Tâche non terminée dont l’échéance est passée (alerte) ou tombe dans les sept jours (à surveiller).'],
    ['Tâches bloquées', 'Une ou deux tâches bloquées (à surveiller), trois ou plus (alerte).'],
    ['Temps et parts des tâches', 'Tâche au-delà de sa part, en temps ou en achats (alerte) ; tâche avec une part mais sans temps prévu (à renseigner).'],
    ['Avancement', 'Tâches terminées et projets encore sans tâche.'],
  ] },
];

/**
 * Météo BPM : la page d'accueil de la section donne la météo des sections 01 et 02 ; les pages complémentaires
 * en donnent le détail, les prévisions, les tendances des cycles et la règle. Lecture seule : chaque signal mène
 * au geste qui le corrige, sur sa page.
 */
@Component({
  selector: 'bpm-meteo-page',
  providers: [BpmPageContext],
  imports: [BpmAmount, BpmFinancialOutlookPanel, BpmPageFrame, BpmState, BpmRouterLink, CentsPipe, SignedCentsPipe, ShortDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './meteo.page.scss',
  template: `
    <bpm-page [title]="title()" pageClass="bpm-meteo" [lead]="lead[view()]" [context]="report.data()?.context">
      @switch (view()) {
        @case ('wealth') { <a primary class="btn btn-primary" routerLink="/vision">Ouvrir le patrimoine</a> }
        @case ('home') { <a primary class="btn btn-primary" routerLink="/meteo/previsions">Ouvrir les prévisions</a> }
        @case ('life') { <a primary class="btn btn-primary" routerLink="/projet-de-vie">Ouvrir Mon projet de vie</a> }
        @case ('projects') { <a primary class="btn btn-primary" routerLink="/projet-de-vie/projets">Ouvrir les projets de la vie</a> }
        @case ('forecast') { <a primary class="btn btn-primary" routerLink="/projet-de-vie/echeances">Régler les échéances</a> }
        @case ('trends') { <a primary class="btn btn-primary" routerLink="/projet-de-vie/bilans">Ouvrir les bilans des cycles</a> }
      }
      @if (view() !== 'reading') { <a actions class="btn btn-secondary" routerLink="/meteo/lecture">Lire la météo</a> }

    @if (report.loading() && !report.data() || report.error()) {
      <bpm-state [loading]="report.loading() && !report.data()" [error]="report.error()" (retry)="report.reload()" />
    }
    @if (report.data(); as m) {
      @switch (view()) {
        <!-- ─────────────── Accueil : la météo des deux sections ─────────────── -->
        @case ('home') {
          <section class="mt-overall" [attr.data-weather]="m.overall.key" aria-labelledby="mt-overall-title">
            <span class="mt-symbol" aria-hidden="true">{{ m.overall.symbol }}</span>
            <div>
              <p class="mt-kick">Météo du {{ m.context.today | shortDate }}@if (m.context.period) { · {{ m.context.period.label }} }</p>
              <h2 id="mt-overall-title">{{ m.overall.label }} sur BPM</h2>
              <p class="mt-muted">{{ countsText(m.overall.counts) }}@if (m.overall.headline) { — en alerte : {{ m.overall.headline }}. }</p>
            </div>
          </section>

          <div class="mt-sections">
            @for (s of m.sections; track s.key) {
              <article class="mt-section" [attr.data-weather]="s.weather.key" [attr.data-bpm-tone]="s.key === 'projet-de-vie' ? 'nav-iris' : 'nav-petrol'" [attr.aria-labelledby]="'mt-sec-' + s.key">
                <header>
                  <span class="mt-number">{{ markOf(s) }}</span>
                  <div>
                    <h2 [id]="'mt-sec-' + s.key">{{ s.label }}</h2>
                    <p class="mt-weather"><span aria-hidden="true">{{ s.weather.symbol }}</span> {{ s.weather.label }}</p>
                  </div>
                </header>
                <p class="mt-counts">
                  @for (h of healthOrder; track h) { @if (s.weather.counts[h]) { <span class="mt-chip" [attr.data-health]="h">{{ s.weather.counts[h] }} {{ m.legend.health[h].toLowerCase() }}</span> } }
                </p>
                <ul class="mt-top">
                  @for (g of clouds(s); track g.key) {
                    <li [attr.data-health]="g.health"><strong>{{ g.label }}</strong><span>{{ g.text }}</span>
                      @if (g.link) { <a [routerLink]="g.link" [fragment]="g.fragment">{{ g.action }}</a> }
                    </li>
                  } @empty {
                    <li data-health="ok"><strong>Tout est en règle</strong><span>Aucun signal à surveiller dans cette section.</span></li>
                  }
                </ul>
                <footer>
                  <a class="btn btn-secondary small" [routerLink]="s.link">Ouvrir la météo détaillée</a>
                  <a class="mt-link" [routerLink]="s.home">Aller à la section</a>
                </footer>
              </article>
            }
          </div>

          <div class="mt-strip">
            <a class="mt-tile" routerLink="/meteo/previsions">
              <span class="mt-kick">Prévisions · 7 jours</span>
              @if (m.forecast.horizons[0]; as h) {
                <strong><span [bpmAmount]="h.incomingCents" bpmFlow="income">{{ h.incomingCents | cents }}</span> attendus · <span [bpmAmount]="h.outgoingCents" bpmFlow="charge">{{ h.outgoingCents | cents }}</span> à régler</strong>
                <span class="mt-muted">{{ h.tasks }} tâche(s) à rendre@if (m.forecast.lateCount) { · {{ m.forecast.lateCount }} en retard }@if (m.forecast.cycleDaysLeft !== null) { · fin du cycle dans {{ m.forecast.cycleDaysLeft }} j }</span>
              }
            </a>
            <a class="mt-tile" routerLink="/meteo/tendances">
              <span class="mt-kick">Tendance des cycles</span>
              @if (lastCycle(); as c) {
                <strong><span aria-hidden="true">{{ c.weather?.symbol }}</span> {{ c.period.label }} : <span [bpmAmount]="c.resultCents">{{ c.resultCents | signedCents }}</span></strong>
              }
              <span class="mt-muted">{{ directionText() }}</span>
            </a>
          </div>
        }

        <!-- ─────────────── Détail d'une section ─────────────── -->
        @case ('life') {
          @if (section('projet-de-vie'); as s) {
            <section class="mt-detail-head" [attr.data-weather]="s.weather.key" aria-labelledby="mt-life-title">
              <span class="mt-symbol" aria-hidden="true">{{ s.weather.symbol }}</span>
              <div><p class="mt-kick">{{ markOf(s) }} · {{ s.label }}</p><h2 id="mt-life-title">{{ s.weather.label }}</h2><p class="mt-muted">{{ countsText(s.weather.counts) }}</p></div>
            </section>
            <section class="mt-block" aria-labelledby="mt-life-signals"><h2 id="mt-life-signals">Les volets du projet de vie</h2>
              <ul class="mt-signals">
                @for (g of s.signals; track g.key) {
                  <li [attr.data-health]="g.health">
                    <span class="mt-chip" [attr.data-health]="g.health">{{ g.healthLabel }}</span>
                    <div><strong>{{ g.label }}</strong><span class="mt-figure">{{ g.figure }}</span><p>{{ g.text }}</p></div>
                    @if (g.link) { <a class="btn btn-secondary small" [routerLink]="g.link" [fragment]="g.fragment">{{ g.action }}</a> }
                  </li>
                }
              </ul>
            </section>
          }
        }
        @case ('projects') {
          @if (section('gestion-de-projet'); as s) {
            <section class="mt-detail-head" [attr.data-weather]="s.weather.key" aria-labelledby="mt-pm-title">
              <span class="mt-symbol" aria-hidden="true">{{ s.weather.symbol }}</span>
              <div><p class="mt-kick">{{ markOf(s) }} · {{ s.label }}</p><h2 id="mt-pm-title">{{ s.weather.label }}</h2><p class="mt-muted">{{ countsText(s.weather.counts) }}</p></div>
            </section>
            <section class="mt-block" aria-labelledby="mt-pm-signals"><h2 id="mt-pm-signals">Les signaux de la gestion de projet</h2>
              <ul class="mt-signals">
                @for (g of s.signals; track g.key) {
                  <li [attr.data-health]="g.health">
                    <span class="mt-chip" [attr.data-health]="g.health">{{ g.healthLabel }}</span>
                    <div><strong>{{ g.label }}</strong><span class="mt-figure">{{ g.figure }}</span><p>{{ g.text }}</p></div>
                    @if (g.link) { <a class="btn btn-secondary small" [routerLink]="g.link" [fragment]="g.fragment">{{ g.action }}</a> }
                  </li>
                }
              </ul>
            </section>
            <section class="mt-block" aria-labelledby="mt-pm-projects"><h2 id="mt-pm-projects">La météo de chaque projet de la vie</h2>
              @if (s.projects?.length) {
                <div class="mt-table-wrap" role="region" aria-label="Météo des projets" tabindex="0">
                  <table class="mt-table">
                    <thead><tr><th scope="col">Projet</th><th scope="col">Météo</th><th scope="col">Statut</th><th scope="col" class="num">Avancement</th><th scope="col" class="num">Reste de l’enveloppe</th><th scope="col">Pourquoi</th></tr></thead>
                    <tbody>
                      @for (p of s.projects; track p.projectId) {
                        <tr [attr.data-weather]="p.weather.key">
                          <th scope="row"><a [routerLink]="link(p.projectId)">{{ p.title }}</a>@if (p.fundingSource === 'patrimoine') { <small class="mt-muted"> · patrimoine</small> }</th>
                          <td><span class="mt-weather-tag" [attr.data-weather]="p.weather.key"><span aria-hidden="true">{{ p.weather.symbol }}</span> {{ p.weather.label }}</span></td>
                          <td>{{ p.statusLabel }}</td>
                          <td class="num">{{ p.completionPercent }} % · {{ p.taskCount }} tâche(s)</td>
                          <td class="num" [bpmAmount]="p.allocationCents === null ? null : p.remainingCents">{{ p.allocationCents === null ? 'À attribuer' : (p.remainingCents | cents) }}</td>
                          <td>@for (r of p.reasons; track r) { <span class="mt-reason">{{ r }}</span> } @empty { <span class="mt-muted">Rien à signaler</span> }</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              } @else {
                <p class="mt-muted">Aucun projet de la vie pour l’instant. <a routerLink="/projet-de-vie/projets" [queryParams]="{ editProject: 'new' }">Créer un projet de la vie</a></p>
              }
            </section>
          }
        }

        @case ('wealth') {
          @if (section('patrimoine'); as s) {
            <section class="mt-detail-head" [attr.data-weather]="s.weather.key" aria-labelledby="mt-wealth-title"><span class="mt-symbol" aria-hidden="true">{{ s.weather.symbol }}</span><div><p class="mt-kick">03 · Patrimoine</p><h2 id="mt-wealth-title">{{ s.weather.label }}</h2><p class="mt-muted">{{ countsText(s.weather.counts) }}</p></div></section>
            <section class="mt-block" aria-labelledby="mt-wealth-signals"><h2 id="mt-wealth-signals">Stock, mouvements et cap</h2><ul class="mt-signals">@for (g of s.signals; track g.key) { <li [attr.data-health]="g.health"><span class="mt-chip" [attr.data-health]="g.health">{{ g.healthLabel }}</span><div><strong>{{ g.label }}</strong><span class="mt-figure">{{ g.figure }}</span><p>{{ g.text }}</p></div><a class="btn btn-secondary small" [routerLink]="g.link" [fragment]="g.fragment">{{ g.action }}</a></li> }</ul></section>
          }
        }

        <!-- ─────────────── Prévisions ─────────────── -->
        @case ('forecast') {
          <bpm-financial-outlook />
          <div class="mt-strip">
            @for (h of m.forecast.horizons; track h.days) {
              <div class="mt-tile">
                <span class="mt-kick">D’ici {{ h.days }} jours</span>
                <strong><span [bpmAmount]="h.incomingCents" bpmFlow="income">{{ h.incomingCents | cents }}</span> attendus</strong>
                <span><span [bpmAmount]="h.outgoingCents" bpmFlow="charge">{{ h.outgoingCents | cents }}</span> à régler · {{ h.tasks }} tâche(s) à rendre</span>
              </div>
            }
            <div class="mt-tile" [attr.data-health]="m.forecast.lateCount ? 'alert' : 'ok'">
              <span class="mt-kick">Déjà en retard</span>
              <strong>{{ m.forecast.lateCount }} élément(s)</strong>
              <span>@if (m.forecast.cycleDaysLeft !== null) { Fin du cycle dans {{ m.forecast.cycleDaysLeft }} jour(s) }</span>
            </div>
          </div>
          <section class="mt-block" aria-labelledby="mt-fc-title"><h2 id="mt-fc-title">Ce qui arrive</h2>
            @for (g of forecastGroups(); track g.label) {
              <h3 class="mt-group">{{ g.label }}</h3>
              <ol class="mt-timeline">
                @for (x of g.items; track x.id ?? x.kind + x.date + x.label) {
                  <li [attr.data-kind]="x.kind" [class.is-late]="x.late">
                    <time [attr.datetime]="x.date">{{ x.date | shortDate }}</time>
                    <span class="mt-chip" data-health="neutral">{{ kindLabel[x.kind] }}</span>
                    <div><strong>{{ x.label }}</strong>@if (x.detail) { <small>{{ x.detail }}</small> }</div>
                    <span class="num" [bpmAmount]="x.amountCents" [bpmFlow]="x.kind === 'entree' || x.kind === 'depense' ? 'income' : undefined">{{ x.amountCents === null ? '' : (x.amountCents | signedCents) }}</span>
                    <a [routerLink]="x.link" [queryParams]="x.query">Ouvrir</a>
                  </li>
                }
              </ol>
            } @empty {
              <p class="mt-muted">Rien de prévu d’ici le {{ m.forecast.to | shortDate }} : ciel dégagé.</p>
            }
          </section>
          <section class="mt-block" aria-labelledby="mt-goals-title"><h2 id="mt-goals-title">Objectifs datés de l’année</h2>
            @if (m.forecast.goals.length) {
              <ul class="mt-goals">
                @for (g of m.forecast.goals; track g.label + g.date) {
                  <li><time [attr.datetime]="g.date">{{ g.date | shortDate }}</time><strong>{{ g.label }}</strong><span><span [bpmAmount]="g.futureCostCents" bpmTone="info">{{ g.futureCostCents | cents }}</span>@if (g.provisionPerPeriodCents) { · <span [bpmAmount]="g.provisionPerPeriodCents" bpmTone="info">{{ g.provisionPerPeriodCents | cents }}</span> à mettre de côté par cycle }</span></li>
                }
              </ul>
            } @else {
              <p class="mt-muted">Aucun objectif daté dans les douze prochains mois. <a routerLink="/vision" [queryParams]="{ goal: 'new' }">Créer un objectif daté</a></p>
            }
          </section>
        }

        <!-- ─────────────── Tendances ─────────────── -->
        @case ('trends') {
          <div class="mt-strip">
            @for (w of m.legend.weathers; track w.key) {
              <div class="mt-tile" [attr.data-weather]="w.key"><span class="mt-kick">{{ w.label }}</span><strong><span aria-hidden="true">{{ w.symbol }}</span> {{ m.trends.tally[w.key] }} cycle(s)</strong></div>
            }
          </div>
          <section class="mt-block" aria-labelledby="mt-tr-title"><h2 id="mt-tr-title">Le sens des résultats</h2>
            <p>{{ directionText() }}</p>
            <p class="mt-muted">Un cycle est ensoleillé quand son résultat est positif@if (m.trends.savingsTargetCents !== null) { et atteint l’épargne visée ({{ m.trends.savingsTargetCents | cents }}) } ; en éclaircies quand il est positif sous l’épargne visée ; nuageux à l’équilibre ; orageux en déficit.</p>
          </section>
          <section class="mt-block" aria-labelledby="mt-cycles-title"><h2 id="mt-cycles-title">La météo de chaque cycle</h2>
            <div class="mt-table-wrap" role="region" aria-label="Météo des cycles" tabindex="0">
              <table class="mt-table">
                <thead><tr><th scope="col">Cycle</th><th scope="col">Météo</th><th scope="col" class="num">Reçu</th><th scope="col" class="num">Dépensé</th><th scope="col" class="num">Résultat</th><th scope="col" class="num">Dont projets</th><th scope="col">Fait marquant</th></tr></thead>
                <tbody>
                  @for (r of m.trends.rows; track r.period.key) {
                    <tr [attr.data-weather]="r.weather?.key ?? 'calme'">
                      <th scope="row"><a routerLink="/projet-de-vie/bilans" [queryParams]="{ cycle: r.period.key }">{{ r.period.label }}</a> <small class="mt-muted">{{ statusText(r.status) }}</small></th>
                      <td>@if (r.weather; as w) { <span class="mt-weather-tag" [attr.data-weather]="w.key"><span aria-hidden="true">{{ w.symbol }}</span> {{ w.label }}</span> } @else { <span class="mt-muted">Sans mouvement</span> }</td>
                      <td class="num" [bpmAmount]="r.receivedCents" bpmFlow="income">{{ r.receivedCents | cents }}</td>
                      <td class="num" [bpmAmount]="r.spentCents" bpmFlow="charge">{{ r.spentCents | cents }}</td>
                      <td class="num" [bpmAmount]="r.resultCents">{{ r.resultCents | signedCents }}</td>
                      <td class="num" [bpmAmount]="r.projectsCents" bpmFlow="charge">{{ r.projectsCents | cents }}</td>
                      <td>{{ r.headline ?? '—' }}</td>
                    </tr>
                  } @empty {
                    <tr><td colspan="7" class="mt-muted">Aucun cycle encore : fixez l’ancrage du cycle pour commencer.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }

        <!-- ─────────────── Lire la météo ─────────────── -->
        @case ('reading') {
          <section class="mt-block" aria-labelledby="mt-rule-title"><h2 id="mt-rule-title">La règle de la météo</h2>
            <p class="mt-muted">La même règle s’applique à chaque section, à chaque projet et à BPM tout entier.</p>
            <ul class="mt-rule">
              @for (r of m.legend.rule; track r.weather) {
                <li [attr.data-weather]="r.weather"><span class="mt-symbol small" aria-hidden="true">{{ symbolOf(r.weather) }}</span><strong>{{ labelOf(r.weather) }}</strong><span>{{ r.when }}</span></li>
              }
            </ul>
          </section>
          <section class="mt-block" aria-labelledby="mt-health-title"><h2 id="mt-health-title">L’état d’un signal</h2>
            <ul class="mt-health">
              @for (h of healthOrder; track h) { <li><span class="mt-chip" [attr.data-health]="h">{{ m.legend.health[h] }}</span><span>{{ healthHint[h] }}</span></li> }
            </ul>
          </section>
          <section class="mt-block" aria-labelledby="mt-sources-title"><h2 id="mt-sources-title">Ce que lit chaque signal</h2>
            @for (g of sources; track g.section) {
              <h3 class="mt-group">{{ g.section }}</h3>
              <dl class="mt-sources">@for (it of g.items; track it[0]) { <div><dt>{{ it[0] }}</dt><dd>{{ it[1] }}</dd></div> }</dl>
            }
            <p class="mt-muted">Les prévisions lisent les règlements non réglés et les tâches datées des 30 prochains jours ; les tendances lisent le bilan de chaque cycle.</p>
          </section>
        }
      }
    }
    </bpm-page>
  `,
})
export class BpmMeteoPage {
  private readonly route = inject(ActivatedRoute);
  private readonly bpm = inject(BpmApi);
  private readonly recette = inject(RecetteContext);
  protected readonly workspace = injectPageWorkspace();
  private readonly data = toSignal(this.route.data ?? of(this.route.snapshot?.data ?? {}), { initialValue: this.route.snapshot?.data ?? {} });
  protected readonly view = computed<MeteoView>(() => (this.workspace()?.key === 'meteo-reading' ? 'reading' : ((this.data()['meteo'] as MeteoView | undefined) ?? 'home')));
  protected readonly title = computed(() => this.workspace()?.title ?? ({ wealth: 'Météo du patrimoine', home: 'Météo du jour', life: 'Météo du projet de vie', projects: 'Météo de la gestion de projet', forecast: 'Prévisions', trends: 'Tendances des cycles', reading: 'Lire la météo' } as const)[this.view()]);
  protected readonly lead = LEAD;
  protected readonly kindLabel = KIND_LABEL;
  protected readonly sources = SOURCES;
  protected readonly healthOrder: SignalHealth[] = ['alert', 'watch', 'unknown', 'ok'];
  protected readonly healthHint: Record<SignalHealth, string> = {
    alert: 'Quelque chose a déjà dérapé : agissez en premier ici.',
    watch: 'Rien n’est encore dépassé, mais une décision ou une échéance approche.',
    unknown: 'Une information manque pour juger : renseignez-la.',
    ok: 'Le signal est dans le cadre que vous avez fixé.',
  };
  protected readonly report = bpmLoader(() => 0, () => this.bpm.meteo());
  protected readonly link = projectLink;

  /** Le numéro de la section dans le menu (01, 02…), qui suit l'ordre réglé. */
  protected markOf(s: MeteoSection): string {
    const zone = planZone('bpm');
    if (!zone) return '';
    const id = s.key === 'projet-de-vie' ? 'vision' : s.key === 'patrimoine' ? 'patrimoine' : 'gestion';
    const visible = zoneSections(zone, this.recette.connected());
    const section = visible.find((x) => x.id === id);
    return section ? sectionMark(zone, section, visible) : '';
  }
  protected section(key: MeteoSection['key']) {
    return this.report.data()?.sections.find((s) => s.key === key) ?? null;
  }
  /** Les nuages d'une section : ses signaux hors « en règle », les plus graves d'abord, trois au plus. */
  protected clouds(s: MeteoSection) {
    return s.signals.filter((g) => g.health !== 'ok').sort((a, b) => this.healthOrder.indexOf(a.health) - this.healthOrder.indexOf(b.health)).slice(0, 3);
  }
  protected countsText(c: { ok: number; watch: number; alert: number; unknown: number }) {
    const parts = [c.alert && `${c.alert} en alerte`, c.watch && `${c.watch} à surveiller`, c.unknown && `${c.unknown} à renseigner`, `${c.ok} en règle`].filter(Boolean);
    return parts.join(' · ');
  }
  protected symbolOf(key: string) {
    return this.report.data()?.legend.weathers.find((w) => w.key === key)?.symbol ?? '';
  }
  protected labelOf(key: string) {
    return this.report.data()?.legend.weathers.find((w) => w.key === key)?.label ?? key;
  }
  protected statusText(status: string) {
    return status === 'closed' ? 'clos' : status === 'ended' ? 'à clôturer' : 'en cours';
  }
  protected readonly lastCycle = computed(() => this.report.data()?.trends.rows.find((r) => r.weather) ?? null);
  protected readonly directionText = computed(() => {
    const t = this.report.data()?.trends;
    if (!t) return '';
    if (!t.direction) return t.totals.closedCount ? 'Pas encore assez de cycles clos pour dégager une tendance (il en faut quatre).' : 'Aucun cycle clos pour l’instant : la tendance apparaîtra avec vos clôtures.';
    const avg = (c: number | null) => (c === null ? '—' : (c / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }));
    const sense = t.direction === 'hausse' ? 'Le temps s’améliore' : t.direction === 'baisse' ? 'Le temps se dégrade' : 'Le temps reste stable';
    return `${sense} : ${avg(t.recentAverageCents)} de résultat moyen sur les trois derniers cycles clos, contre ${avg(t.previousAverageCents)} sur les trois précédents.`;
  });
  /** Les prévisions rangées : en retard, cette semaine, d'ici 30 jours. */
  protected readonly forecastGroups = computed(() => {
    const f = this.report.data()?.forecast;
    if (!f) return [];
    const week = new Date(f.from + 'T00:00:00Z');
    week.setUTCDate(week.getUTCDate() + 7);
    const limit = week.toISOString().slice(0, 10);
    const groups = [
      { label: 'En retard', items: f.items.filter((x) => x.late) },
      { label: 'Cette semaine', items: f.items.filter((x) => !x.late && x.date <= limit) },
      { label: 'D’ici 30 jours', items: f.items.filter((x) => !x.late && x.date > limit) },
    ];
    return groups.filter((g) => g.items.length);
  });
}
