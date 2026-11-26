import { afterEveryRender, ChangeDetectionStrategy, Component, computed, ElementRef, inject } from '@angular/core';
import { contentSectionsOf } from '../../navigation/content-section-catalog';
import { Router, RouterLink } from '@angular/router';
import { injectCurrentUrl } from '../../plan/plan-context';
import { bpmCompanion, BpmCompanionLink, companionQuery } from './compass-model';

@Component({
  selector: 'bpm-compass',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './compass.scss',
  template: `
    @if (guide(); as g) {
      <aside class="compass" aria-label="Repères et liens utiles de BPM">
        <details>
          <summary><span class="phase">{{ g.phase }}</span><span>{{ g.scope }}</span><span class="explain">Repères <span aria-hidden="true">＋</span></span></summary>
          <div class="explanation"><p>{{ g.purpose }}</p><ol>
            <li><strong>Préparer</strong><span>Enveloppe, part, plafond ou objectif : aucun mouvement financier.</span></li>
            <li><strong>Annoncer</strong><span>Une opération datée entre dans les prévisions, sans débit validé.</span></li>
            <li><strong>Valider</strong><span>Montant, paiement et imputation : un seul cycle ou le patrimoine.</span></li>
            <li><strong>Construire</strong><span>Le résultat du cycle rejoint le patrimoine à sa clôture, une seule fois.</span></li>
          </ol></div>
        </details>
        <nav aria-label="Poursuivre dans BPM">@for (l of g.links; track l.path) { <a [routerLink]="l.path" [queryParams]="query(l)" [fragment]="l.fragment">{{ l.label }} <span aria-hidden="true">↗</span></a> }</nav>
      </aside>
    }
  `,
})
export class BpmCompass {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly router = inject(Router);
  private readonly url = injectCurrentUrl();
  protected readonly guide = computed(() => bpmCompanion(this.url()));
  protected query(link: BpmCompanionLink) { return companionQuery(link, this.router.parseUrl(this.url()).queryParams); }
  constructor() {
    afterEveryRender(() => {
      const main = this.element.nativeElement.closest('main');
      if (!main || !this.guide()) return;
      const ids = new Set(contentSectionsOf(this.url().split(/[?#]/)[0]).map(s => s.id));
      const headings = [...main.querySelectorAll<HTMLElement>('h2')].filter(h => !h.closest('bpm-modal, [role="dialog"], rjs-page-banner'));
      if (!headings.some(h => ids.has(h.id))) return;
      for (const h of headings) {
        if (!ids.has(h.id) && !h.hasAttribute('data-nav-skip')) { h.setAttribute('data-nav-skip', ''); h.setAttribute('data-bpm-grouped', ''); }
        else if (ids.has(h.id) && h.hasAttribute('data-bpm-grouped')) { h.removeAttribute('data-nav-skip'); h.removeAttribute('data-bpm-grouped'); }
      }
    });
  }
}
