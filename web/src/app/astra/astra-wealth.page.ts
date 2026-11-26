import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CentsPipe, ShortDatePipe, SignedCentsPipe } from '../core/format';
import { BpmApi } from '../bpm/data/bpm-api.service';
import { BpmPageContext, BpmState, bpmLoader } from '../bpm/ui';
import { BpmAmount } from '../bpm/ui/amount';
import { PageToolbar } from '../shared/page-toolbar.component';

/**
 * Patrimoine : la situation à date et ce qui la compose (départ, versements des cycles clôturés,
 * projets payés hors cycle). Le cap et la projection sont sur Objectif et projection.
 */
@Component({
  selector: 'astra-wealth',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageToolbar, BpmState, BpmAmount, CentsPipe, SignedCentsPipe, ShortDatePipe],
  providers: [BpmPageContext],
  templateUrl: './astra-wealth.page.html',
})
export class AstraWealthPage {
  protected readonly ctx = inject(BpmPageContext);
  private readonly api = inject(BpmApi);
  protected readonly life = bpmLoader(this.ctx.period, period => this.api.lifeManagement(period));

  /** Part du départ et des versements dans le stock, pour la barre de composition. */
  protected readonly composition = computed(() => {
    const p = this.life.data()?.patrimoine;
    if (!p || p.stockCents === null || p.stockCents <= 0) return null;
    const opening = Math.max(0, p.openingStockCents ?? 0);
    const total = Math.max(p.stockCents, opening + Math.max(0, p.capitalizedCents));
    return { opening: opening / total * 100, capitalized: Math.max(0, p.capitalizedCents) / total * 100 };
  });

  protected readonly closures = computed(() => [...(this.life.data()?.results.rows ?? [])].reverse());
  protected readonly maxResult = computed(() => Math.max(1, ...this.closures().map(r => Math.abs(r.resultCents))));
  protected readonly offCycle = computed(() => (this.life.data()?.projects.projects ?? []).filter(p => p.fundingSource === 'patrimoine'));
}
