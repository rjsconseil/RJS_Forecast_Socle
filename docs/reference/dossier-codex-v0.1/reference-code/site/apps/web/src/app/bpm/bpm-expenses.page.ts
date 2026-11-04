import { PeriodNavigationComponent } from '../shared/period-navigation.component';
import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  afterEveryRender,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { formatMoney } from '../shared/amount';
import { AppHeroComponent } from '../shared/app-hero.component';
import { MetricTile } from '../shared/metric-tiles.component';
import { pageText, registerPageTexts } from '../shared/page-text';
import { BpmGateComponent } from './bpm-gate.component';
import { BpmContextComponent } from './bpm-context.component';
import { BpmProjectSwitchComponent } from './bpm-project-switch.component';
import { BpmMoneyContext } from './bpm-money-context';
import { ExpenseOperation, ExpenseRow } from './bpm-expenses.model';
import { lastDayOf } from './bpm-lens.model';
const P = 'content.pages.bpm.bpm-expenses.page.';
export const BPM_EXPENSES_TEXTS: Record<string, string> = {
  budget: 'Projet',
  allBudgets: 'Tous les projets',
  groups: 'Dépenses par poste',
  groupTotal: 'Montant global du poste',
  groupSum: 'Total des échéances',
  grouping: 'Afficher les dépenses',
  centersView: 'Par poste',
  projectsView: 'Par projet',
  daysView: 'Par date prévue',
  professionalTitle: 'Dépenses des entreprises & associations',
  professionalKicker: 'Mon entreprise · Dépenses',
  professionalBack: 'Retour aux projets de l’entreprise',
  chooseBusiness: 'Entreprise consultée',
  noProfessional:
    'Choisissez une entreprise rattachée dans Mon entreprise pour consulter ses dépenses.',
  enterprise: 'Dépenses professionnelles · Mon entreprise',
  title: 'Dépenses de la période',
  kicker: 'Ma vision budgétaire',
  chooseProject: 'Choisir un projet',
  noProject: 'Choisissez un projet de vie pour retrouver les dépenses de sa période.',
  lead: 'Vos charges, payées et à venir.',
  back: 'Tableau de bord',
  previous: 'Période précédente',
  next: 'Période suivante',
  current: 'Revenir à la période en cours',
  currentCompact: 'Revenir',
  period: 'Période consultée',
  loading: 'Lecture des dépenses…',
  retry: 'Réessayer',
  empty: 'Aucune dépense ni échéance ne correspond à cette période et à ces filtres.',
  recorded: 'Payé',
  pending: 'À payer',
  unrealized: 'Non réalisé',
  recordedHelp: 'Règlements des charges prévues sur cette période.',
  pendingHelp: 'Charges prévues, sans paiement enregistré.',
  unrealizedHelp: 'Charges restées sans paiement à la clôture.',
  overviewKicker: 'La période en un regard',
  overviewTitle: 'Où en sont vos dépenses ?',
  overviewHelp:
    'Montants selon les dates prévues et les filtres sélectionnés. Les charges non réalisées ne sont pas comptées dans le payé.',
  totals: 'Totaux des dépenses affichées',
  rows: 'échéance(s)',
  search: 'Rechercher une dépense',
  searchHelp: 'Nom, poste, prestataire…',
  status: 'État',
  all: 'Tout afficher',
  center: 'Poste',
  task: 'Tâche du projet',
  noTask: 'Sans tâche',
  noCenter: 'Poste historique non renseigné',
  clear: 'Réinitialiser les filtres',
  missing:
    'La dépense demandée ne figure pas dans cet intervalle ou dans ces filtres. Vous pouvez réinitialiser les filtres ou changer de période.',
  notes: 'Notes de la dépense',
  amount: 'Montant de l’échéance',
  planned: 'Montant prévu',
  gap: 'Écart réel / prévu',
  occurrence: 'Date prévue',
  actual: 'Date de paiement',
  closed: 'Période clôturée · montant conservé',
  late: 'Date arrivée · en attente d’enregistrement',
  source: 'Récurrence et conditions',
  cadence: 'Récurrence',
  once: 'Ponctuelle · une seule fois',
  weekly: 'Chaque semaine',
  monthly: 'Chaque mois',
  yearly: 'Chaque année',
  first: 'Première échéance',
  end: 'Dernière date prévue',
  noEnd: 'Aucune date de fin fixée',
  owner: 'Origine de la dépense',
  beneficiary: 'Bénéficiaire',
  absent: 'Non renseigné',
  provider: 'Prestataire',
  contact: 'Contact',
  supplier: 'Fournisseur indiqué',
  quotes: 'Devis de l’opération',
  selected: 'Devis retenu',
  noQuotes: 'Aucun devis enregistré.',
  history: 'Historique des paiements',
  historyHelp:
    'Tous les paiements de cette dépense, y compris ceux des autres périodes. Le relevé et ses totaux suivent les dates prévues.',
  outside: 'Hors de la période consultée',
  noHistory: 'Aucun règlement enregistré pour cette opération.',
  created: 'Fiche créée le',
  updated: 'Dernière modification',
  id: 'Identifiant de l’opération',
  native: 'Modifier la dépense dans Budget',
  priority: 'Priorité',
  decision: 'Décision',
  kind: 'Nature',
  resource: 'Ressource',
  expense: 'Dépense',
  investment: 'Investissement',
  approved: 'Approuvée',
  idea: 'Hypothèse',
  rejected: 'Non retenue',
  low: 'Basse',
  medium: 'Normale',
  high: 'Haute',
  daily: 'Vie courante',
  license: 'Licence',
  'manual-labor': 'Main-d’œuvre',
  'intellectual-labor': 'Prestation intellectuelle',
  equipment: 'Équipement',
  service: 'Service',
  other: 'Autre',
  centerLimit: 'Plafond du poste par cycle budgétaire',
  centerDescription: 'Description du poste',
  providerType: 'Type de prestataire',
  strengths: 'Points forts',
  weaknesses: 'Points de vigilance',
  appreciation: 'Appréciation',
  interventions: 'Interventions liées à cette dépense',
  filters: 'Affiner la liste',
  filtersActive: 'filtre(s) actif(s)',
  listHelp:
    'Les totaux suivent vos filtres et les dates prévues. Ouvrez une dépense pour voir son détail.',
  sortAmount: 'Du montant le plus élevé au plus faible.',
  sortDate: 'Dans l’ordre des dates prévues.',
  displayed: 'échéance(s) affichée(s)',
  paymentDetail: 'Cette échéance',
  reference: 'Références de la fiche',
  providerDetails: 'Prestataire et fournisseur',
};
registerPageTexts(
  Object.fromEntries(Object.entries(BPM_EXPENSES_TEXTS).map(([key, value]) => [P + key, value])),
);
const date = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
@Component({
  selector: 'rjs-bpm-expenses-page',
  imports: [
    PeriodNavigationComponent,
    FormsModule,
    RouterLink,
    AppHeroComponent,
    BpmGateComponent,
    BpmContextComponent,
    BpmProjectSwitchComponent,
  ],
  providers: [BpmMoneyContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./bpm-pages.scss', './bpm-money.scss', './bpm-expenses.page.scss'],
  templateUrl: './bpm-expenses.page.html',
})
export class BpmExpensesPage {
  protected readonly ctx = inject(BpmMoneyContext);
  private readonly router = inject(Router);
  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap, { requireSync: true });
  private readonly doc = inject(DOCUMENT);
  protected readonly money = formatMoney;
  protected readonly data = this.ctx.expenseRegister;
  protected readonly query = computed(() => this.params().get('q') ?? '');
  protected readonly status = computed(() => this.params().get('etat') ?? '');
  protected readonly center = computed(() => this.params().get('poste') ?? '');
  protected readonly grouping = computed(() => this.params().get('par') ?? 'poste');
  protected readonly budget = computed(() => this.params().get('budget') ?? '');
  protected readonly task = computed(() => this.params().get('tache') ?? '');
  protected readonly activeFilters = computed(
    () =>
      [this.query().trim(), this.status(), this.center(), this.budget(), this.task()].filter(
        Boolean,
      ).length,
  );
  protected readonly operations = computed(
    () => new Map((this.data()?.operations ?? []).map((op) => [op.id, op])),
  );
  protected readonly centers = computed(() => this.data()?.centers ?? []);
  protected readonly tasks = computed(() => [
    ...new Map(
      (this.data()?.operations ?? []).filter((op) => op.task).map((op) => [op.task!.id, op.task!]),
    ).values(),
  ]);
  protected readonly rows = computed(() => {
    const search = this.query().trim().toLocaleLowerCase('fr');
    return (this.data()?.rows ?? []).filter((row) => {
      const op = this.operations().get(row.operationId);
      return (
        (!this.budget() || row.budgetProjectId === this.budget()) &&
        (!this.status() || row.status === this.status()) &&
        (!this.center() || row.centerId === this.center()) &&
        (!this.task() || (this.task() === '__none' ? !op?.task : op?.task?.id === this.task())) &&
        (!search ||
          [
            row.title,
            row.note,
            row.operationId,
            op?.center?.name,
            op?.task?.title,
            op?.beneficiary?.name,
            op?.provider?.name,
            op?.supplier,
            formatMoney(row.amountCents),
          ]
            .join(' ')
            .toLocaleLowerCase('fr')
            .includes(search))
      );
    });
  });
  protected readonly groups = computed(() => {
    const groups = new Map<
      string,
      {
        id: string;
        name: string;
        budget: string;
        rows: ExpenseRow[];
        total: number;
        recorded: number;
        pending: number;
        unrealized: number;
      }
    >();
    for (const row of this.rows()) {
      const op = this.operations().get(row.operationId);
      const mode = this.grouping();
      const id =
        mode === 'projet'
          ? row.budgetProjectId
          : mode === 'jour'
            ? row.occurrenceDate
            : row.centerId || 'sans-poste-' + row.budgetProjectId;
      const name =
        mode === 'projet'
          ? (op?.budgetTitle ?? '')
          : mode === 'jour'
            ? this.date(row.occurrenceDate)
            : op?.center?.name || this.t('noCenter');
      const group = groups.get(id) ?? {
        id,
        name,
        budget: mode === 'poste' ? (op?.budgetTitle ?? '') : '',
        rows: [],
        total: 0,
        recorded: 0,
        pending: 0,
        unrealized: 0,
      };
      group.rows.push(row);
      group.total += row.amountCents;
      group[row.status] += row.amountCents;
      groups.set(id, group);
    }
    return [...groups.values()].sort(
      (a, b) =>
        (this.grouping() === 'jour' ? a.id.localeCompare(b.id) : b.total - a.total) ||
        a.name.localeCompare(b.name, 'fr') ||
        a.id.localeCompare(b.id),
    );
  });
  protected readonly tiles = computed<MetricTile[]>(() =>
    ['recorded', 'pending', 'unrealized'].map((status) => ({
      id: status,
      label: this.t(status),
      value: formatMoney(
        this.rows()
          .filter((row) => row.status === status)
          .reduce((sum, row) => sum + row.amountCents, 0),
      ),
      note: this.t(status + 'Help'),
      tone: status === 'recorded' ? 'danger' : status === 'pending' ? 'warning' : 'neutral',
    })),
  );
  protected readonly requestedMissing = computed(
    () =>
      !!this.params().get('operation') &&
      !!this.data() &&
      !this.rows().some((row) => this.selected(row)),
  );
  protected t(key: string) {
    return pageText(P + key);
  }
  protected date(value: string) {
    return date.format(new Date(value.slice(0, 10) + 'T12:00:00Z'));
  }
  protected end(value: string) {
    return this.date(lastDayOf(value));
  }
  protected amount(group: { rows: ExpenseRow[] }) {
    return group.rows.reduce((sum, row) => sum + row.amountCents, 0);
  }
  protected key(row: ExpenseRow) {
    return (
      'depense-' +
      encodeURIComponent(
        [row.operationId, row.occurrenceDate, row.actualDate ?? row.status].join('-'),
      )
    );
  }
  protected selected(row: ExpenseRow) {
    return (
      row.operationId === this.params().get('operation') &&
      (!this.params().get('occurrence') || row.occurrenceDate === this.params().get('occurrence'))
    );
  }
  protected inPeriod(value: string) {
    const d = this.data();
    return !!d && value >= d.start && value < d.end;
  }
  protected filter(key: string, value: string) {
    void this.router.navigate([], {
      queryParams: {
        ...this.ctx.query(),
        q: this.query() || null,
        etat: this.status() || null,
        par: this.grouping(),
        poste: this.center() || null,
        tache: this.task() || null,
        budget: this.budget() || null,
        [key]: value || null,
      },
      replaceUrl: true,
    });
  }
  protected shifted(step: -1 | 1) {
    return { ...this.ctx.shifted(step), par: this.grouping(), budget: this.budget() || null };
  }
  protected currentPeriod() {
    return { ...this.ctx.current(), par: this.grouping(), budget: this.budget() || null };
  }
  protected reset() {
    void this.router.navigate([], { queryParams: this.ctx.query() });
  }
  protected retry() {
    const p = this.ctx.project(),
      w = this.ctx.window();
    if (p && w) void this.ctx.reload(p.id, w.start, w.end);
  }
  private followed = '';
  constructor() {
    afterEveryRender(() => {
      const row = this.rows().find((row) => this.selected(row));
      const key = row ? this.key(row) : '';
      if (!key || key === this.followed) return;
      const element = this.doc.getElementById(key);
      if (element) {
        this.followed = key;
        element.scrollIntoView({ block: 'center' });
        element.querySelector('summary')?.focus({ preventScroll: true });
      }
    });
  }
}
