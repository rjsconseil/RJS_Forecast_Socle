import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, Type, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { RecetteContext } from '../core/api.service';
import { applicationOf } from '../platform/applications';
import { PLAN_OVERVIEW_TONE, PlanCard, planZone } from '../plan/site-plan';
import { JourneyResume } from '../plan/journey-resume';
import { PlanCardsComponent, zoneSectionCards } from './plan-cards';

/**
 * L'accueil d'une zone (`/zones/<zone>`, gabarit `zone-home.page` de la référence) : sa mission, ce qu'on
 * peut y faire, par où commencer, puis une carte par grande section. Chaque carte annonce ce que la section
 * produit, ses pages, et ouvre son accueil ou sa page utile. Aucune entrée ne lance de traitement.
 * Une application peut déclarer sa propre vue d'ensemble (`ApplicationDeclaration.overview`) : elle remplace l'accueil générique.
 */
@Component({
  selector: 'rjs-zone-home',
  imports: [RouterLink, PlanCardsComponent, NgComponentOutlet, JourneyResume],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (zone(); as zone) {
      @if (ownOverview()) {
        @if (overview(); as component) {
          <ng-container *ngComponentOutlet="component; inputs: { zone }" />
        }
      } @else {
        <div class="page plan-page plan-zone-home" [attr.data-tone]="overviewTone">
          <header class="plan-heading" data-ui-pattern="heading">
            <a class="plan-return" routerLink="/modules"> <span aria-hidden="true">←</span> Toutes les zones </a>
            <div class="page-hero-title">
              <h1 class="plan-title-with-mark">
                <span class="plan-mark" aria-hidden="true">{{ zone.acronym }}</span
                ><span class="plan-title-text">{{ zone.overview ? 'Vue d’ensemble · ' + zone.label : zone.label }}</span>
              </h1>
              <p class="plan-kicker">{{ zone.eyebrow }}</p>
            </div>
            <p>{{ zone.mission }}</p>
          </header>
          <rjs-journey-resume [zone]="zone.id" title="Reprendre dans cette zone" />

          @if (zone.overview; as overview) {
            <section class="plan-overview" aria-labelledby="overview-results">
              <h2 id="overview-results">Ce que vous pouvez faire ici</h2>
              <div class="plan-overview-grid">
                @for (outcome of overview.outcomes; track outcome) {
                  <div class="plan-result" data-ui-pattern="panel">
                    <p>{{ outcome }}</p>
                  </div>
                }
              </div>
              <div class="plan-overview-start" data-ui-pattern="panel">
                <h2>Par où commencer ?</h2>
                <p>{{ overview.start }}</p>
                @if (cards()[0]; as first) {
                  <a class="plan-action" [routerLink]="first.link" [queryParams]="first.query ?? null">{{ first.action }} →</a>
                }
              </div>
            </section>
          }
          <rjs-plan-cards [class.plan-square]="zone.id === 'noyau'" [cards]="cards()" />
          @if (zone.scope) {
            <details class="plan-scope" data-ui-pattern="disclosure">
              <summary>Comprendre le rôle de cette zone</summary>
              <p>{{ zone.scope }}</p>
            </details>
          }
        </div>
      }
    } @else {
      <div class="page plan-page">
        <section class="plan-empty" data-ui-pattern="empty">
          <h1>Destination introuvable</h1>
          <p>Cette zone n’existe pas dans le plan du site.</p>
          <a class="plan-action" routerLink="/modules">Retour à l’accueil →</a>
        </section>
      </div>
    }
  `,
})
export class ZoneHomePage {
  protected readonly overviewTone = PLAN_OVERVIEW_TONE;
  private readonly ctx = inject(RecetteContext);
  private readonly zoneId = toSignal(inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('zone'))));
  protected readonly zone = computed(() => planZone(this.zoneId()));
  /** L'application de la zone apporte-t-elle sa propre vue d'ensemble ? */
  protected readonly ownOverview = computed(() => !!applicationOf(this.zone()?.id)?.overview);
  protected readonly overview = signal<Type<unknown> | null>(null);
  private readonly loadOverview = effect(() => {
    const id = this.zone()?.id;
    this.overview.set(null);
    void applicationOf(id)?.overview?.().then((component) => { if (this.zone()?.id === id) this.overview.set(component); });
  });
  protected readonly cards = computed<PlanCard[]>(() => {
    const zone = this.zone();
    return zone ? zoneSectionCards(zone, this.ctx.connected()) : [];
  });
}
