import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CentsPipe, ShortDatePipe, SignedCentsPipe } from '../core/format';
import { BpmApi } from '../bpm/data/bpm-api.service';
import { BpmPageContext, BpmQuickSettle, BpmState, bpmLoader } from '../bpm/ui';
import { BpmAmount } from '../bpm/ui/amount';
import { AstraActions } from './astra-actions';
import { PageToolbar, type PageFocus } from '../shared/page-toolbar.component';

@Component({
  selector: 'astra-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageToolbar, BpmState, BpmQuickSettle, BpmAmount, CentsPipe, SignedCentsPipe, ShortDatePipe],
  providers: [BpmPageContext],
  templateUrl: './astra-overview.html',
})
export class AstraHome {
  protected readonly ctx = inject(BpmPageContext);
  private readonly api = inject(BpmApi);
  private readonly router = inject(Router);
  /** Créer sans quitter l'accueil : la fenêtre est ouverte par le cadre de partie. */
  protected readonly actions = inject(AstraActions);
  protected readonly life = bpmLoader(this.ctx.period, period => this.api.lifeManagement(period));

  /** Les projets rattachés au budget du quotidien (payés par le cycle) ; ceux payés hors cycle sont lus dans Patrimoine. */
  protected readonly cycleProjects = computed(() => (this.life.data()?.projects.projects ?? []).filter(p => p.fundingSource !== 'patrimoine'));

  /** La priorité du cycle et son geste : module « Priorité » et « Agir » de la boîte à outils. */
  protected readonly priority = computed((): { focus: PageFocus | null; action: string; link: string; query: Record<string, string | undefined> } => {
    const d = this.life.data();
    const carry = this.ctx.carry();
    if (!d) return { focus: null, action: 'Ouvrir les mouvements', link: '/bpm-astra/mouvements', query: carry };
    if (!d.cycle.period) return { focus: { title: 'Cycle à configurer', detail: 'Fixez son début pour suivre entrées et dépenses sur la même période.', tone: 'warning' }, action: 'Configurer le cycle', link: '/bpm-astra/cloture/reglages', query: {} };
    if (d.cycle.reading === 'closed') return { focus: { title: 'Cycle clôturé', detail: 'Son résultat est versé au patrimoine.', tone: 'success' }, action: 'Lire le bilan', link: '/bpm-astra/bilans', query: { cycle: d.cycle.period.key } };
    const late = d.dueSoon.lateCount;
    if (late) return { focus: { title: late + (late === 1 ? ' règlement en retard' : ' règlements en retard'), detail: 'À vérifier parmi vos échéances.', tone: 'danger' }, action: 'Régler les retards', link: '/bpm-astra/mouvements/echeances', query: carry };
    // Rien en retard : le geste du quotidien est de noter ce qui vient d'être dépensé (fenêtre ouverte par le cadre).
    return { focus: { title: 'Rien en retard', detail: 'Vérifiez les prochaines dates avant d’engager une dépense.', tone: 'success' }, action: 'Saisir une dépense', link: '/bpm-astra/mouvements', query: { ...carry, entry: 'new', entryDirection: 'charge' } };
  });

  protected readonly dueView = linkedSignal({
    source: () => [this.ctx.userId(), this.ctx.period()],
    computation: () => ({ page: 0, lateOnly: false }),
  });

  protected readonly dues = computed(() => {
    const all = this.life.data()?.dueSoon.lines ?? [];
    const view = this.dueView();
    const lines = view.lateOnly ? all.filter(line => line.status === 'late') : all;
    // Toute la liste : elle remplit sa carte et défile ; plus de pages de quatre lignes.
    const size = Math.max(1, all.length);
    const last = Math.max(0, Math.ceil(lines.length / size) - 1);
    const page = Math.min(view.page, last);
    return { lines: lines.slice(page * size, (page + 1) * size), page, last, start: page * size + 1, end: Math.min((page + 1) * size, lines.length), total: lines.length };
  });

  protected showLateOnly(lateOnly: boolean): void {
    this.dueView.set({ page: 0, lateOnly });
  }

  protected movePage(offset: number): void {
    const { page, last } = this.dues();
    this.dueView.update(view => ({ ...view, page: Math.min(last, Math.max(0, page + offset)) }));
  }

  protected openLine(id: string): void {
    void this.router.navigate(['/bpm-astra/mouvements'], { queryParams: { ligne: id } });
  }
}
