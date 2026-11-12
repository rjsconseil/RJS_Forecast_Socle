import { NavigationLabel, NavigationSurfaceDirective } from '../navigation/navigation-ui';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RecetteContext } from '../core/api.service';
import { RouterLink } from '@angular/router';
import { JourneyResume } from '../plan/journey-resume';
import { PLAN_OVERVIEW_TONE, PLAN_ZONES, PlanSection, PlanZone, planZone, portalBands, sectionEntry, zoneHomeLink, zoneSections } from '../plan/site-plan';

type PortalRow = ReturnType<typeof portalBands>[number];

/**
 * Le portail (gabarit `overview.page` de la référence) : les zones rangées en bandes — module phare,
 * les deux modules qu'il réunit, le socle commun, les modules techniques. La taille du bloc dit
 * l'importance de la zone ; chaque section ouvre son accueil ou sa page utile (`sectionEntry`).
 */
@Component({
  selector: 'app-home',
  imports: [NavigationLabel, NavigationSurfaceDirective, RouterLink, JourneyResume],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div navigationSurface="portal" class="page plan-page plan-portal">
      <header class="plan-heading" data-ui-pattern="heading">
        <div class="page-hero-title">
          <h1 class="plan-portal-title" id="portal-title">Vos zones de travail</h1>
          <p class="plan-kicker">RJS Forecast · votre espace local</p>
        </div>
        <p>Votre budget au quotidien, votre patrimoine dans la durée. Un même parcours pour comprendre, agir et préparer l’avenir.</p>
        <nav class="cockpit-navigation portal-jumps" aria-label="Aller directement à une partie de l’accueil">
          @for (row of rows; track row.band?.id ?? row.zones[0].id; let index = $index) {
            @if (row.band; as band) {
              <a data-navigation-level="detail" routerLink="/" [fragment]="'portal-' + band.id"><span aria-hidden="true">{{ bandIndex(index) }}</span>{{ band.label | navigationLabel:("anchor:portal:" + band.id) }}</a>
            }
          }
        </nav>
      </header>
      <!-- Le parcours unifié (tous modules) : revenir d'un clic à la dernière étape de la séance. -->
      @if (connected()) { <rjs-journey-resume /> }

      @for (group of groups; track $index) {
        <div [class.portal-ecosystem]="group.ecosystem" [class.portal-technical]="!group.ecosystem">
          @for (item of group.items; track item.row.band?.id ?? item.row.zones[0].id) {
            @let row = item.row;
            <section
              class="portal-band"
              [id]="'portal-' + (row.band?.id ?? row.zones[0].id)"
              [attr.data-band]="row.band?.id ?? null"
              [attr.aria-labelledby]="row.band ? 'band-' + row.band.id : 'zone-' + row.zones[0].id"
            >
              @if (row.band; as band) {
                <header class="portal-band-head">
                  <h2 class="cockpit-heading" [id]="'band-' + band.id">
                    <span class="cockpit-index" aria-hidden="true">{{ bandIndex(item.index) }}</span><span class="cockpit-title">{{ band.label }}</span>
                  </h2>
                  <p class="cockpit-lead">{{ band.description }}</p>
                </header>
              }
              <div class="plan-portal-grid">
                @for (zone of row.zones; track zone.id) {
                  <article class="plan-zone-card" data-ui-pattern="panel" [attr.data-size]="zone.size" [attr.data-band]="zone.band" [attr.data-tone]="overviewTone" [attr.aria-labelledby]="'zone-' + zone.id">
                    <header class="plan-zone-head">
                      <span class="plan-mark" aria-hidden="true">{{ zone.acronym }}</span>
                      <div>
                        <p class="plan-zone-eyebrow">{{ zone.eyebrow }}</p>
                        <h3 [id]="'zone-' + zone.id"><a data-navigation-level="section" class="plan-zone-title-link" [routerLink]="zoneHome(zone)">{{ zone.label | navigationLabel:("zone:" + zone.id) }}</a></h3>
                        <p class="plan-mission">{{ zone.mission }}</p>
                      </div>
                    </header>
                    @if (assembled(zone); as parts) {
                      <p class="portal-assembles">
                        <span class="portal-assembles-label">Réunit</span>
                        @for (part of parts; track part.id; let last = $last) {
                          <span class="portal-assembles-part"><span class="plan-entry-mark" aria-hidden="true">{{ part.acronym }}</span>{{ part.label }}</span>
                          @if (!last) {
                            <span class="portal-assembles-and">et</span>
                          }
                        }
                      </p>
                    }
                    <nav class="plan-entries" [attr.aria-label]="'Sections de ' + zone.label">
                      @for (section of visibleSections(zone); track section.id) {
                        @let entry = entryOf(zone, section);
                        <a data-navigation-level="page" class="plan-entry" [attr.data-tone]="section.tone ?? zone.tone" [routerLink]="entry.link" [queryParams]="entry.query"
                          ><span class="plan-entry-mark" aria-hidden="true">{{ section.acronym }}</span
                          ><span class="plan-entry-text"><strong>{{ section.label | navigationLabel:("section:" + zone.id + ":" + section.id) }}</strong><small>{{ section.intention }}</small></span></a
                        >
                      }
                    </nav>
                  </article>
                }
              </div>
            </section>
          }
        </div>
      }
    </div>
  `,
})
export class HomePage {
  protected readonly overviewTone = PLAN_OVERVIEW_TONE;
  /** Une rangée par bande déclarée, dans l'ordre du plan. */
  protected readonly rows: PortalRow[] = portalBands(PLAN_ZONES);
  /** Les bandes de l'écosystème (phare, modules réunis, socle) d'un côté, les modules techniques de l'autre. */
  protected readonly groups = this.rows.reduce<{ ecosystem: boolean; items: { row: PortalRow; index: number }[] }[]>((groups, row, index) => {
    const ecosystem = ['flagship', 'assembled', 'core'].includes(row.band?.id ?? '');
    if (!groups.length || groups[groups.length - 1].ecosystem !== ecosystem) groups.push({ ecosystem, items: [] });
    groups[groups.length - 1].items.push({ row, index });
    return groups;
  }, []);

  protected bandIndex(index: number) {
    return String(index + 1).padStart(2, '0');
  }
  protected assembled(zone: PlanZone) {
    const parts = (zone.assembles ?? []).map(planZone).filter((p): p is PlanZone => !!p);
    return parts.length ? parts : null;
  }
  private readonly ctx = inject(RecetteContext);
  protected readonly connected = this.ctx.connected;
  protected visibleSections(zone: PlanZone) {
    return zoneSections(zone, this.ctx.connected());
  }
  protected entryOf(zone: PlanZone, section: PlanSection) {
    return sectionEntry(zone, section);
  }
  protected zoneHome(zone: PlanZone) {
    return zoneHomeLink(zone);
  }
}
