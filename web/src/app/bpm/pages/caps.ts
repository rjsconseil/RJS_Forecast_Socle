import { Component, computed, inject, signal } from '@angular/core';
import { cents, CentsPipe, percentText } from '../../core/format';
import { MetricTile, MetricTilesComponent } from '../../shared/metric-tiles.component';
import { BpmApi } from '../data/bpm-api.service';
import { CenterCapRow } from '../data/bpm-caps.models';
import { bpmLoader, BpmPageContext, BpmPageFocus, BpmPageFrame, BpmPageResult, BpmState, capLevelLegend } from '../ui';
import { BpmRouterLink } from '../ui/bpm-router-link';
import { BpmCapDialog } from '../ui/cap-dialog';

/** Postes plafonnés : les dépassements d'abord (les plus lourds), puis les plus consommés. */
const byPressure = (a: CenterCapRow, b: CenterCapRow) =>
  Number(b.over) - Number(a.over) || (a.marginCents ?? 0) - (b.marginCents ?? 0) || (b.usedPct ?? 0) - (a.usedPct ?? 0) || a.label.localeCompare(b.label, 'fr');
/** Postes sans plafond : ceux où l'on dépense le plus d'abord — c'est là qu'un plafond sert. */
const bySpending = (a: CenterCapRow, b: CenterCapRow) => b.engagedCents - a.engagedCents || a.label.localeCompare(b.label, 'fr');

/**
 * Plafonds : la liste de tous les postes de dépenses, avec ou sans plafond. Un poste plafonné montre ce qu'il a engagé
 * sur le cycle (payé + à payer) et ce qu'il reste, ou son dépassement ; un poste sans plafond propose d'en fixer un.
 * Le plafond se règle dans une fenêtre ouverte depuis le poste ; il ne bloque jamais une dépense.
 */
@Component({
  selector: 'app-bpm-caps-page',
  providers: [BpmPageContext],
  imports: [BpmPageFrame, BpmState, BpmRouterLink, MetricTilesComponent, BpmCapDialog, CentsPipe],
  styleUrls: ['./caps.scss'],
  templateUrl: './caps.html',
})
export class BpmCapsPage {
  private readonly bpm = inject(BpmApi);
  protected readonly ctx = inject(BpmPageContext);

  protected readonly read = bpmLoader(() => this.ctx.period(), (period) => this.bpm.spendingCaps(period));
  protected readonly d = computed(() => this.read.data());
  protected readonly centers = computed(() => this.d()?.centers ?? []);
  protected readonly capped = computed(() => this.centers().filter((c) => c.capCents !== null).sort(byPressure));
  protected readonly uncapped = computed(() => this.centers().filter((c) => c.capCents === null).sort(bySpending));
  protected readonly over = computed(() => this.capped().filter((c) => c.over));
  /** Proches de leur plafond : la zone orange, selon le niveau rendu par Budget. */
  protected readonly near = computed(() => this.capped().filter((c) => c.level === 'near'));
  protected readonly periodLabel = computed(() => this.d()?.context.period?.label ?? 'ce cycle');

  /** Deux groupes : avec plafond, puis sans plafond (chacun annonce son vide). */
  protected readonly groups = computed(() => [
    { key: 'capped', title: 'Avec plafond', rows: this.capped(), empty: 'Aucun plafond fixé pour l’instant : choisissez un poste ci-dessous.' },
    { key: 'free', title: 'Sans plafond', rows: this.uncapped(), empty: 'Tous vos postes de dépenses ont un plafond.' },
  ]);

  protected readonly tiles = computed<MetricTile[]>(() => {
    const capped = this.capped();
    const total = this.centers().length;
    const over = this.over();
    const capCents = capped.reduce((t, c) => t + (c.capCents ?? 0), 0);
    const engagedCents = capped.reduce((t, c) => t + c.engagedCents, 0);
    return [
      { id: 'capped', label: 'Postes avec plafond', value: `${capped.length} sur ${total}`, note: total - capped.length ? `${total - capped.length} poste(s) sans plafond` : 'Tous vos postes sont plafonnés' },
      {
        id: 'over', label: 'Plafonds dépassés', value: over.length ? String(over.length) : 'Aucun', tone: over.length ? 'danger' : capped.length ? 'success' : null,
        note: over.length ? over.map((c) => c.label).join(', ') : capped.length ? 'Tous les postes plafonnés restent dans leur limite' : 'Aucun plafond à surveiller',
      },
      {
        id: 'total', label: 'Total des plafonds', value: capped.length ? cents(capCents) : '—', amountCents: capped.length ? capCents : null,
        note: capped.length ? `${cents(engagedCents)} consommés sur ces postes` : 'Fixez un premier plafond',
      },
    ];
  });

  protected readonly focus = computed<BpmPageFocus | null>(() => {
    if (!this.d() || !this.centers().length) return null;
    const over = this.over();
    if (over.length) {
      const list = over.map((c) => `${c.label} (+${cents(-(c.marginCents ?? 0))})`).join(', ');
      return { title: `${over.length} plafond(s) dépassé(s)`, detail: `${list}. Ouvrez le poste pour revoir ses dépenses, ou ajustez son plafond.`, tone: 'danger' };
    }
    if (!this.capped().length) return { title: 'Aucun plafond fixé', detail: 'Commencez par les postes où vous dépensez le plus : ils sont en tête des postes sans plafond.', tone: 'info' };
    const near = this.near();
    if (near.length) return { title: `${near.length} poste(s) proche(s) de leur plafond`, detail: `${near.map((c) => `${c.label} (reste ${cents(c.marginCents ?? 0)})`).join(', ')}.`, tone: 'info' };
    return { title: 'Tous les postes plafonnés sont dans leur limite', detail: this.uncapped().length ? `${this.uncapped().length} poste(s) n’ont pas encore de plafond.` : 'Chaque poste de dépenses a son plafond.', tone: 'success' };
  });

  protected readonly notice = signal<string | null>(null);
  protected readonly result = computed<BpmPageResult | null>(() => (this.notice() ? { message: this.notice()!, tone: 'success' } : null));

  // ---------- fenêtre du plafond ----------

  /** Poste ouvert dans la fenêtre ; `choose` : ouverte depuis la barre, le poste se choisit dans la fenêtre. */
  protected readonly dialog = signal<{ ref: string | null; choose: boolean } | null>(null);
  /** Ordre du choix : les postes sans plafond d'abord, ceux où l'on dépense le plus en tête. */
  protected readonly chooserCenters = computed(() => [...this.uncapped(), ...this.capped()]);
  protected readonly primaryLabel = computed(() => (this.uncapped().length ? 'Fixer un plafond' : 'Modifier un plafond'));

  protected open(ref: string) {
    this.notice.set(null);
    this.dialog.set({ ref, choose: false });
  }
  protected openChooser() {
    this.notice.set(null);
    this.dialog.set({ ref: this.chooserCenters()[0]?.ref ?? null, choose: true });
  }
  protected saved(message: string) {
    this.dialog.set(null);
    this.notice.set(message);
    this.ctx.refresh.bump();
  }

  // ---------- lecture d'un poste ----------

  /** Légende des niveaux de consommation, avec les seuils lus (Budget) : ils colorent jauge, filet et pastille. */
  protected readonly legend = computed(() => (this.d() ? capLevelLegend(this.d()!.levels) : []));
  protected stateText(c: CenterCapRow): string {
    switch (c.level) {
      case 'over': return `Dépassé de ${cents(-(c.marginCents ?? 0))}`;
      case 'none': return 'Sans plafond';
      default: return `Reste ${cents(c.marginCents ?? 0)}`;
    }
  }
  /** Remplissage de la jauge : la part du plafond engagée (pleine au-delà). */
  protected fill(c: CenterCapRow) {
    return Math.min(100, Math.max(0, c.usedPct ?? 0));
  }
  protected usedText(c: CenterCapRow) {
    return c.usedPct === null ? '' : percentText(c.usedPct, 0) + ' du plafond';
  }
  protected spendText(c: CenterCapRow) {
    if (!c.engagedCents) return 'Aucune dépense sur le cycle';
    return c.toPayCents ? `Payé ${cents(c.paidCents)} · à payer ${cents(c.toPayCents)}` : `Payé ${cents(c.paidCents)}`;
  }
  /** Adresse du détail d'un poste (`std:` retiré pour les postes standards). */
  protected detailLink(ref: string) {
    return '/argent/postes/' + ref.replace(/^std:/, '');
  }
  protected readonly detailQuery = computed(() => ({ ...this.ctx.carry(), from: 'plafonds' }));
}
