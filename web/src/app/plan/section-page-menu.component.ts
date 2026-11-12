import { NavigationLabel } from '../navigation/navigation-ui';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { locate, menuPages, pageChildren, PlanPage, PlanSection } from './site-plan';
import { workspaceContextQuery } from './page-workspace';

/** La même arborescence progressive pour chaque section, sur bureau et mobile. */
@Component({
  selector: 'rjs-section-page-menu',
  imports: [NavigationLabel, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .section-subpages li.is-object > a { font-weight: 650; }
    .section-subpages li.is-nested > a { padding-left: 1.6em; font-size: 0.94em; }
    .section-subpages li.is-nested > a::before { content: '↳ '; opacity: 0.6; }
  `,
  template: `
    @for (group of groups(); track group.page.id) {
      <div class="section-page-group">
        <div class="section-page-row">
          <a data-navigation-level="page" class="section-page-link" [attr.data-page-tone]="group.page.tone"
            [routerLink]="group.page.link" [queryParams]="query(group.page)"
            [class.active]="exact(group.page.link)" [class.is-ancestor]="isParent(group.page) && !exact(group.page.link)"
            [attr.aria-current]="exact(group.page.link) ? 'page' : null">
            <span class="nav-icon" aria-hidden="true">{{ group.page.symbol }}</span><span>{{ group.page.label | navigationLabel:group.page.link }}</span>
          </a>
          @if (group.children.length) {
            <button class="section-page-toggle" type="button" [attr.aria-expanded]="opened(group.page)"
              [attr.aria-controls]="'subpages-' + section().id + '-' + group.page.id"
              [attr.aria-label]="(opened(group.page) ? 'Masquer les pages de ' : 'Afficher les pages de ') + group.page.label"
              (click)="toggle(group.page)"><span aria-hidden="true">{{ opened(group.page) ? '⌄' : '›' }}</span></button>
          }
        </div>
        @if (group.children.length && opened(group.page)) {
          <ul class="section-subpages" [id]="'subpages-' + section().id + '-' + group.page.id">
            @for (child of group.children; track child.link) {
              <li [class.is-object]="child.id === 'object'" [class.is-nested]="(child.depth ?? 1) > 1"><a data-navigation-level="detail" [routerLink]="child.link" [queryParams]="query(group.page)" [attr.title]="child.description || null"
                [class.active]="exact(child.link)" [attr.aria-current]="exact(child.link) ? 'page' : null">{{ child.label | navigationLabel:child.link }}</a></li>
            }
          </ul>
        }
      </div>
    }
  `,
})
export class SectionPageMenu {
  readonly section = input.required<PlanSection>();
  readonly url = input.required<string>();
  /** Le nom de la fiche ouverte, publié par sa page. */
  readonly objectLabel = input<string | null>(null);
  private readonly expanded = signal<Record<string, boolean>>({});
  private readonly location = computed(() => locate(this.url()));
  protected readonly groups = computed(() => menuPages(this.section()).map(page => ({ page, children: pageChildren(page, this.url(), this.objectLabel()) })));
  protected exact(link: string) { return (this.url().split(/[?#]/)[0].replace(/\/+$/, '') || '/') === link; }
  protected isParent(page: PlanPage) { return this.location().page?.link === page.link; }
  protected opened(page: PlanPage) { return this.expanded()[page.link] ?? this.isParent(page); }
  protected toggle(page: PlanPage) { this.expanded.update(value => ({ ...value, [page.link]: !this.opened(page) })); }
  protected query(page: PlanPage) { return workspaceContextQuery(this.url(), this.isParent(page) ? page.link : ''); }
}
