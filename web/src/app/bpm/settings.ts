import { injectPageWorkspace } from '../plan/page-workspace';
import { BpmDrafts } from './ui/drafts';
import { BPM_CORE_LINKS } from './ui/bpm-page-path';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { BpmRouterLink } from './ui/bpm-router-link';
import { ApiError, newRequestKey, toApiError } from '../core/api.service';
import { BpmDashboard, Closure, CostCenter, Direction } from '../core/models';
import { BpmApi } from './data/bpm-api.service';
import { CentsPipe, euros, parseAmount, ShortDatePipe } from '../core/format';
import { BpmPageFocus, BpmPageFrame, bpmLoader } from './ui';
import { PageResult } from '../shared/page-toolbar.component';
import { BpmAmount } from './ui/amount';

const amountInput = (n: number | null) => (n === null ? '' : String(n).replace('.', ','));

/**
 * Réglages, sur la page « Cycle budgétaire » de la référence (`rjs-budget-cycle-page`, feuille globale `_budget-cycle.scss`) :
 * bandeau commun, cycle (en-tête de période, compte du jour d'ancrage, formulaire), point de départ du patrimoine
 * en valeur (total, repères, formulaire), clôtures réalisées en tableau, centres de coût et accès aux formules.
 */
@Component({
  selector: 'app-bpm-settings',
  imports: [BpmAmount, BpmRouterLink, ShortDatePipe, CentsPipe, BpmPageFrame],
  templateUrl: './settings.html',
  styles: `
    /* Compléments absents de _budget-cycle.scss (jetons source uniquement). */
    :host {
      display: block;
    }
    .bc-inline {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ecart-8) var(--ecart-12);
    }
    .bc-inline > span {
      flex: 1 1 16rem;
      min-width: 0;
    }
    .bc-alert p {
      margin: 0 0 var(--ecart-6);
    }
    .bc-alert p:last-child {
      margin-bottom: 0;
    }
    .bc-hero > p {
      margin: 0;
    }
    .bc-form {
      display: grid;
      gap: var(--ecart-12);
      min-width: 0;
    }
    .bc-controls input {
      width: var(--part-100);
      min-width: 0;
      min-height: var(--dim-48);
    }
    .bc-controls em {
      color: var(--muted);
      font-style: normal;
      font-weight: var(--fw-regular, 400);
    }
    .bc-ok {
      font-weight: var(--fw-semibold);
    }
    .bc-wealth .bc-wealth-form {
      grid-column: 1 / -1;
    }
    .bc-centers {
      display: grid;
      gap: var(--ecart-16);
      padding: var(--ecart-28);
    }
    .bc-formula {
      text-align: left;
      white-space: normal;
    }
    .bc-formula code {
      padding: var(--ecart-2) var(--ecart-8);
      border-radius: var(--rayon-6, 6px);
      background: var(--soft);
    }
    .bc-links-cell {
      text-align: left;
      white-space: normal;
    }
    .bc-links-cell a {
      display: block;
    }
    .bc-table th small {
      display: block;
      margin-top: var(--ecart-4);
      color: var(--muted);
      font-weight: var(--fw-regular, 400);
    }
    @media (max-width: 640px) {
      .bc-centers {
        padding: var(--ecart-16);
      }
    }
  `,
})
export class BpmSettings implements OnInit {
  protected workspace = injectPageWorkspace();
  protected showCycle = computed(() => !this.workspace() || this.workspace()?.key === 'settings-cycle');
  protected showPatrimoine = computed(() => !this.workspace() || this.workspace()?.key === 'settings-wealth');
  protected showCenters = computed(() => !this.workspace() || this.workspace()?.key === 'settings-centers');
  protected readonly coreLinks = inject(BPM_CORE_LINKS);
  private bpmApi = inject(BpmApi);
  /** Contexte du bandeau commun (user, périmètre, période, date de calcul), en lecture seule. */
  protected summary = bpmLoader(
    () => 0,
    () => this.bpmApi.summary(),
  );
  protected readonly euros = euros;

  protected dash = signal<BpmDashboard | null>(null);
  protected closures = signal<Closure[]>([]);
  protected centers = signal<CostCenter[]>([]);
  protected loading = signal(true);
  protected loadError = signal<string | null>(null);

  protected standardCenters = computed(() => this.centers().filter((c) => c.standard));
  protected personalCenters = computed(() => this.centers().filter((c) => !c.standard));

  // Cycle
  protected cAnchor = signal('');
  protected cStart = signal('');
  protected cycleSaving = signal(false);
  protected cycleSaved = signal(false);
  protected cycleError = signal<ApiError | null>(null);

  // Patrimoine
  protected pStock = signal('');
  protected pDate = signal('');
  protected pObjective = signal('');
  protected patSaving = signal(false);
  protected patSaved = signal(false);
  protected patError = signal<ApiError | null>(null);

  // Centres personnels
  protected ccLabel = signal('');
  protected ccDirection = signal<Direction>('charge');
  protected ccSaving = signal(false);
  protected ccError = signal<ApiError | null>(null);
  private ccRequestKey = newRequestKey();

  protected saving = computed(() => this.cycleSaving() || this.patSaving() || this.ccSaving());
  protected cycleDirty = computed(() => {
    const cycle = this.dash()?.cycle;
    return (
      !!cycle &&
      (this.cAnchor() !== (cycle.anchorDay == null ? '' : String(cycle.anchorDay)) ||
        this.cStart() !== (cycle.startDate ?? ''))
    );
  });
  protected patDirty = computed(() => {
    const p = this.dash()?.patrimoine;
    return (
      !!p &&
      (this.pStock() !== amountInput(p.openingStock) ||
        this.pDate() !== (p.openingDate ?? '') ||
        this.pObjective() !== amountInput(p.objective))
    );
  });
  protected activeCycleDirty = computed(() => this.showCycle() && this.cycleDirty());
  protected activePatDirty = computed(() => this.showPatrimoine() && this.patDirty());
  protected activeCenterLabel = computed(() => this.showCenters() ? this.ccLabel().trim() : '');
  private activeError = computed(() => (this.showCycle() ? this.cycleError() : null)
    ?? (this.showPatrimoine() ? this.patError() : null) ?? (this.showCenters() ? this.ccError() : null));
  private restoredCycle = false;
  private restoredPatrimoine = false;

  constructor() {
    inject(BpmDrafts).connect('settings-workspace', () => ({
      cycle: this.cycleDirty() ? { anchor: this.cAnchor(), start: this.cStart() } : null,
      patrimoine: this.patDirty() ? { stock: this.pStock(), date: this.pDate(), objective: this.pObjective() } : null,
      center: { label: this.ccLabel(), direction: this.ccDirection(), requestKey: this.ccRequestKey },
    }), draft => {
      if (draft.cycle) { this.cAnchor.set(draft.cycle.anchor); this.cStart.set(draft.cycle.start); this.restoredCycle = true; }
      if (draft.patrimoine) { this.pStock.set(draft.patrimoine.stock); this.pDate.set(draft.patrimoine.date); this.pObjective.set(draft.patrimoine.objective); this.restoredPatrimoine = true; }
      this.ccLabel.set(draft.center.label); this.ccDirection.set(draft.center.direction); this.ccRequestKey = draft.center.requestKey;
    }, inject(DestroyRef));
  }

  protected result = computed<PageResult | null>(() => {
    const error = this.activeError();
    if (error) return { message: error.message + ' Votre saisie est conservée.', tone: 'danger' };
    if (this.saving()) return { message: 'Enregistrement en cours…', tone: 'info' };
    if (this.activeCycleDirty() || this.activePatDirty() || this.activeCenterLabel()) return null;
    const saved = [
      this.showCycle() && this.cycleSaved() ? 'Cycle enregistré.' : '',
      this.showPatrimoine() && this.patSaved() ? 'Patrimoine enregistré.' : '',
    ].filter(Boolean);
    return saved.length ? { message: saved.join(' '), tone: 'success' } : null;
  });
  protected focus = computed<BpmPageFocus | null>(() => {
    const d = this.dash();
    if (!d) return null;
    const error = this.activeError();
    const count =
      Number(this.activeCycleDirty()) + Number(this.activePatDirty()) + Number(!!this.activeCenterLabel());
    if (error)
      return {
        title: 'Un réglage demande votre attention',
        detail: error.message + ' Votre saisie est conservée.',
        tone: 'warning',
      };
    if (count)
      return {
        title: `${count} réglage(s) à enregistrer`,
        detail: 'Les commandes ci-dessus enregistrent chaque partie séparément.',
        tone: 'warning',
      };
    if (this.workspace()?.key === 'settings-centers') return {
      title: `${this.personalCenters().length} poste(s) personnel(s)`,
      detail: 'Ajoutez un poste de charge ou une source de revenus, puis utilisez-le dans vos prochaines saisies.', tone: 'info',
    };
    if (this.showCycle() && d.cycle?.state !== 'active')
      return {
        title: 'Configurez votre cycle budgétaire',
        detail: 'Choisissez le jour d’ancrage et la date de début pour démarrer vos périodes.',
        tone: 'info',
      };
    if (this.showPatrimoine() && d.patrimoine.openingStock === null)
      return {
        title: 'Le stock d’ouverture reste à renseigner',
        detail: 'Indiquez votre point de départ pour obtenir les estimations du patrimoine.',
        tone: 'info',
      };
    return {
      title: 'Réglages enregistrés',
      detail: this.workspace()?.key === 'settings-wealth' ? 'Le stock d’ouverture et l’objectif servent de repères pour votre patrimoine.' : this.closures().length
        ? `${this.closures().length} période(s) close(s) : le début du cycle est figé.`
        : 'Vous pouvez ajuster le cycle, le patrimoine et vos postes personnels.',
      tone: 'success',
    };
  });

  protected resetCycle() {
    const d = this.dash();
    if (d) this.fillCycle(d);
    this.cycleError.set(null);
  }
  protected resetPatrimoine() {
    const d = this.dash();
    if (d) this.fillPatrimoine(d);
    this.patError.set(null);
  }

  async ngOnInit() {
    await this.load();
  }

  async load() {
    const keepCycle = this.cycleDirty() || this.restoredCycle;
    const keepPatrimoine = this.patDirty() || this.restoredPatrimoine;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [d, closures, centers] = await Promise.all([
        this.bpmApi.dashboard(),
        this.bpmApi.closures(),
        this.bpmApi.costCenters(),
      ]);
      this.dash.set(d);
      this.setClosures(closures);
      this.centers.set(centers);
      if (!keepCycle) this.fillCycle(d);
      if (!keepPatrimoine) this.fillPatrimoine(d);
      this.restoredCycle = false; this.restoredPatrimoine = false;
    } catch (err) {
      this.loadError.set(toApiError(err).message);
    } finally {
      this.loading.set(false);
    }
  }

  private setClosures(list: Closure[]) {
    this.closures.set(list.slice().sort((a, b) => b.periodStart.localeCompare(a.periodStart)));
  }

  private fillCycle(d: BpmDashboard) {
    this.cAnchor.set(d.cycle?.anchorDay != null ? String(d.cycle.anchorDay) : '');
    this.cStart.set(d.cycle?.startDate ?? '');
  }

  private fillPatrimoine(d: BpmDashboard) {
    this.pStock.set(amountInput(d.patrimoine.openingStock));
    this.pDate.set(d.patrimoine.openingDate ?? '');
    this.pObjective.set(amountInput(d.patrimoine.objective));
  }

  protected sign(v: number | null | undefined) {
    return v === null || v === undefined
      ? 'unknown'
      : v > 0
        ? 'positive'
        : v < 0
          ? 'negative'
          : null;
  }

  protected signedEuros(v: number) {
    return (v > 0 ? '+ ' : '') + euros(v);
  }

  protected cycleMessage(e: ApiError) {
    if (e.body.code === 'FORBIDDEN_BY_RULE') return `Modification refusée : ${e.message}`;
    if (e.isConflict)
      return 'Le cycle a été modifié entre-temps. Relisez la version actuelle avant de réessayer.';
    return e.message;
  }

  private invalid(target: 'cycle' | 'pat' | 'cc', message: string, field: string) {
    const err = new ApiError(400, {
      code: 'VALIDATION',
      action: null,
      message,
      details: { field },
    });
    (target === 'cycle' ? this.cycleError : target === 'pat' ? this.patError : this.ccError).set(
      err,
    );
  }

  // ---------- cycle ----------

  async saveCycle() {
    if (this.saving()) return;
    const d = this.dash();
    if (!d?.cycle) return;
    this.cycleSaved.set(false);
    const raw = this.cAnchor().trim();
    const anchorDay = Number(raw);
    if (!raw || !Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 28)
      return this.invalid('cycle', "Le jour d'ancrage est un entier de 1 à 28.", 'anchorDay');
    this.cycleSaving.set(true);
    this.cycleError.set(null);
    try {
      const next = await this.bpmApi.configureCycle({
        anchorDay,
        startDate: this.cStart() || null,
        expectedRevision: d.cycle.revision,
      });
      this.dash.set(next);
      this.fillCycle(next);
      this.cycleSaved.set(true);
    } catch (err) {
      this.cycleError.set(toApiError(err));
    } finally {
      this.cycleSaving.set(false);
    }
  }

  async reloadCycle() {
    try {
      const d = await this.bpmApi.dashboard();
      this.dash.set(d);
      this.fillCycle(d);
      this.cycleError.set(null);
    } catch (err) {
      this.cycleError.set(toApiError(err));
    }
  }

  // ---------- patrimoine ----------

  async savePatrimoine() {
    if (this.saving()) return;
    const d = this.dash();
    if (!d) return;
    this.patSaved.set(false);
    const stock = parseAmount(this.pStock());
    const objective = parseAmount(this.pObjective());
    if (stock === 'invalid')
      return this.invalid(
        'pat',
        "Stock d'ouverture : un montant en euros (ex. -1 250,50), ou vide s'il est inconnu.",
        'openingStock',
      );
    if (objective === 'invalid' || (objective !== null && objective < 0))
      return this.invalid('pat', 'Objectif : un montant positif en euros, ou vide.', 'objective');
    this.patSaving.set(true);
    this.patError.set(null);
    try {
      await this.bpmApi.updatePatrimoine({
        expectedRevision: d.patrimoine.revision,
        openingStock: stock,
        openingDate: this.pDate() || null,
        objective,
      });
      const fresh = await this.bpmApi.dashboard();
      this.dash.set(fresh);
      this.fillPatrimoine(fresh);
      this.patSaved.set(true);
    } catch (err) {
      this.patError.set(toApiError(err));
    } finally {
      this.patSaving.set(false);
    }
  }

  async reloadPatrimoine() {
    try {
      const d = await this.bpmApi.dashboard();
      this.dash.set(d);
      this.fillPatrimoine(d);
      this.patError.set(null);
    } catch (err) {
      this.patError.set(toApiError(err));
    }
  }

  /** Conserve la saisie et adopte seulement la nouvelle version comme base. */
  async rebasePatrimoine() {
    try {
      this.dash.set(await this.bpmApi.dashboard());
      this.patError.set(null);
    } catch (err) {
      this.patError.set(toApiError(err));
    }
  }

  // ---------- centres personnels ----------

  async addCenter() {
    if (this.saving()) return;
    const label = this.ccLabel().trim();
    if (!label) return this.invalid('cc', 'Indiquez le nom du centre.', 'label');
    this.ccSaving.set(true);
    this.ccError.set(null);
    try {
      const r = await this.bpmApi.addCostCenter({
        requestKey: this.ccRequestKey,
        label,
        direction: this.ccDirection(),
      });
      this.ccRequestKey = newRequestKey();
      this.centers.set(r.costCenters);
      this.ccLabel.set('');
    } catch (err) {
      this.ccError.set(toApiError(err));
    } finally {
      this.ccSaving.set(false);
    }
  }
}
