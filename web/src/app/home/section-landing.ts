import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PlanCard, hasSectionHome, menuPages, planZone, sectionEntry, zoneHomeLink } from '../plan/site-plan';
import { PlanCardsComponent } from './plan-cards';

/**
 * L'accueil d'une section (`/zones/<zone>/<section>`, gabarit `section-landing.page` de la référence) :
 * la carte de ses pages. Chaque carte dit ce qu'on y fait et ce qu'on y obtient ; le bouton ouvre la page,
 * sans rien lancer. Une section sans accueil (une seule page, ou ouverte « directement ») mène à sa page utile.
 */
@Component({
  selector: 'rjs-section-landing',
  imports: [RouterLink, PlanCardsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (zone(); as zone) {
      @if (section(); as section) {
        <div class="page plan-page plan-section-home" [attr.data-tone]="section.tone ?? zone.tone">
          <header class="plan-heading" data-ui-pattern="heading">
            <a class="plan-return" [routerLink]="zoneHome(zone)"> <span aria-hidden="true">←</span> {{ zone.label }} </a>
            <div class="page-hero-title">
              <h1 class="plan-title-with-mark">
                <span class="plan-mark" aria-hidden="true">{{ section.acronym }}</span
                ><span class="plan-title-text">{{ section.label }}</span>
              </h1>
              <p class="plan-kicker">Accueil de section</p>
            </div>
            <p>{{ section.description }}</p>
          </header>

          <rjs-plan-cards [cards]="cards()" />
        </div>
      }
    }
    @if (!section()) {
      <div class="page plan-page">
        <section class="plan-empty" data-ui-pattern="empty">
          <h1>Destination introuvable</h1>
          <p>Cette section n’existe pas dans le plan du site.</p>
          <a class="plan-action" routerLink="/">Retour à l’accueil →</a>
        </section>
      </div>
    }
  `,
})
export class SectionLandingPage {
  protected readonly zoneHome = zoneHomeLink;
  private readonly router = inject(Router);
  private readonly params = toSignal(inject(ActivatedRoute).paramMap);
  protected readonly zone = computed(() => planZone(this.params()?.get('zone')));
  protected readonly section = computed(() => this.zone()?.sections.find((entry) => entry.id === this.params()?.get('section')) ?? null);
  /** Une section « directe » n'a pas d'accueil : son adresse mène à sa page représentative. */
  private readonly forward = effect(() => {
    const zone = this.zone();
    const section = this.section();
    if (!zone || !section || hasSectionHome(section)) return;
    const entry = sectionEntry(zone, section);
    void this.router.navigate([entry.link], { queryParams: entry.query, replaceUrl: true });
  });
  protected readonly cards = computed<PlanCard[]>(() => {
    const section = this.section();
    return section
      ? menuPages(section).map((page) => ({
          id: page.id,
          label: page.label,
          description: page.description,
          result: page.result,
          link: page.link,
          step: page.step,
          pageTone: page.tone,
          tone: section.tone,
        }))
      : [];
  });
}
