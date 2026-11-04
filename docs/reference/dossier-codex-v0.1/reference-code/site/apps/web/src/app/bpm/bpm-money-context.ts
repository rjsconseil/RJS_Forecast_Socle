import type { BpmExpenseRegister } from './bpm-expenses.model';
import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { PeriodLensService, calendarViewOf } from '../shared/period-lens';
import { periodBounds, shiftDate, validDate } from '../shared/calendar';
import { UserSession } from '../utilisateurs/utilisateurs.contract';
import { BpmWorkspace, BpmProject } from './bpm.model';
import { cycleOf, lensViewOf } from './bpm-lens.model';
import { BpmStatement, shiftWindow } from './bpm-money.model';
import { BpmStore } from './bpm.store';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Le contexte commun du tableau de bord et de ses pages dédiées : le projet
 * choisi, la fenêtre regardée (`?du=&au=`, ancien `?lecture=`, sinon la vue choisie)
 * et son relevé, relu après chaque précision. Fourni par chaque page.
 */
@Injectable()
export class BpmMoneyContext {
  readonly store = inject(BpmStore);
  private readonly route = inject(ActivatedRoute);
  readonly professionalMode = this.route.snapshot.data['professional'] === true;
  private readonly professionalState = signal<BpmWorkspace | null>(null);
  readonly professionalLoading = signal(false);
  readonly billingAllowed = computed(
    () => this.professionalState()?.professionalBillingAllowed === true,
  );
  readonly businesses = computed(() => this.professionalState()?.professionalEntities ?? []);
  private readonly router = inject(Router);
  private readonly expensesMode = this.route.snapshot.data['expenses'] === true;
  private readonly session = inject(UserSession);
  private readonly params = toSignal(this.route.queryParamMap);
  private readonly periodLens = inject(PeriodLensService);

  readonly projects = computed(() => {
    const me = this.session.profile()?.id ?? '';
    return [
      ...(this.professionalMode
        ? (this.professionalState()?.projects ?? []).filter((p) => p.defaultForEntity)
        : this.store.displayedProjects()),
    ].sort(
      (a, b) =>
        Number(b.ownerUserId === me) - Number(a.ownerUserId === me) ||
        Number(b.defaultForEntity === true) - Number(a.defaultForEntity === true) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  });
  readonly project = computed<BpmProject | null>(() => {
    const wanted = this.params()?.get('projet') ?? '';
    return this.projects().find((entry) => entry.id === wanted) ?? this.projects()[0] ?? null;
  });
  readonly lens = computed(() => this.periodLens.active());
  /** La fenêtre explicitement demandée (une clôture, une colonne de frise), sinon celle de la vue. */
  readonly window = computed<{ start: string; end: string; explicit: boolean } | null>(() => {
    const from = this.params()?.get('du') ?? '';
    const to = this.params()?.get('au') ?? '';
    if (DATE.test(from) && DATE.test(to) && to > from)
      return { start: from, end: to, explicit: true };
    // Les anciens liens du tableau de bord restent des lectures à la date demandée.
    // Le calendrier commun fournit une borne inclusive ; le registre attend une fin exclusive.
    const reading = this.params()?.get('lecture') ?? '';
    if (validDate(reading)) {
      const bounds = periodBounds(reading, calendarViewOf(this.lens()));
      return { start: bounds.start, end: shiftDate(bounds.end, 1), explicit: true };
    }
    const p = this.project();
    if (!p?.snapshot) return null;
    if (this.expensesMode)
      return { start: p.snapshot.period.start, end: p.snapshot.period.end, explicit: false };
    const view = lensViewOf(p, this.lens());
    return view
      ? { start: view.start, end: view.end, explicit: false }
      : { start: p.snapshot.period.start, end: p.snapshot.period.end, explicit: false };
  });
  readonly statement = signal<BpmStatement | null>(null);
  readonly loading = signal(false);
  readonly expenseRegister = signal<BpmExpenseRegister | null>(null);
  readonly manages = computed(() => {
    const p = this.project();
    return !!p && (p.ownerUserId === '' || p.ownerUserId === (this.session.profile()?.id ?? ''));
  });

  constructor() {
    const destroy = inject(DestroyRef);
    if (!this.expensesMode) this.periodLens.adapt('monthly', destroy);
    effect(() => {
      const p = this.project();
      if (p) this.periodLens.follow(cycleOf(p));
    });
    // Une adresse reçue conserve ses bornes explicites. Après sa première lecture,
    // changer de vue recale la fenêtre naviguée autour de sa date de départ.
    let displayedLens: { projectId: string; lens: ReturnType<PeriodLensService['active']> } | null =
      null;
    effect(() => {
      if (this.expensesMode) return;
      const p = this.project();
      const statement = this.statement();
      const lens = this.lens();
      if (!p || !statement || statement.projectId !== p.id) return;
      const previous = displayedLens;
      displayedLens = { projectId: p.id, lens };
      if (!previous || previous.projectId !== p.id || previous.lens === lens) return;
      untracked(() => {
        const params = this.params();
        const from = params?.get('du') ?? '';
        const to = params?.get('au') ?? '';
        if (!validDate(from) || !validDate(to) || to <= from) return;
        const bounds = periodBounds(from, calendarViewOf(lens));
        const end = shiftDate(bounds.end, 1);
        if (bounds.start === from && end === to && !params?.get('lecture')) return;
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: {
            du: bounds.start,
            au: end,
            lecture: null,
            vue: this.periodLens.query()['vue'] ?? null,
          },
          queryParamsHandling: 'merge',
          preserveFragment: true,
          replaceUrl: true,
        });
      });
    });
    // Relire le relevé quand le projet, la fenêtre ou l'espace (après une précision) changent.
    effect(() => {
      const p = this.project();
      const w = this.window();
      void this.store.workspace()?.revision;
      if (!p || !w) return;
      const workspace = this.professionalMode ? this.professionalState() : this.store.workspace();
      const key = `${p.id}:${w.start}:${w.end}`;
      if (key === this.readKey && workspace === this.readWorkspace) return;
      this.readKey = key;
      this.readWorkspace = workspace;
      untracked(() => void this.reload(p.id, w.start, w.end));
    });
    if (this.professionalMode) {
      let ticket = 0;
      effect(() => {
        const entreprise = this.params()?.get('entreprise') ?? '';
        const user = this.session.profile()?.id;
        void user;
        const current = ++ticket;
        untracked(() => {
          this.professionalLoading.set(true);
          this.professionalState.set(null);
          void this.store.professionalWorkspace(entreprise).then((w) => {
            if (current === ticket) {
              this.professionalState.set(w);
              this.professionalLoading.set(false);
            }
          });
        });
      });
    } else void this.store.load();
  }

  private readKey = '';
  private readWorkspace: unknown = null;
  private ticket = 0;
  async reload(projectId: string, start: string, end: string): Promise<void> {
    const ticket = ++this.ticket;
    this.loading.set(true);
    this.statement.set(null);
    this.expenseRegister.set(null);
    const next = this.expensesMode
      ? await this.store.expenses(projectId, start, end, this.professionalMode)
      : await this.store.statement(projectId, start, end);
    // Une réponse plus ancienne ne remplace jamais la plus récente.
    if (ticket !== this.ticket) return;
    this.statement.set(next);
    if (this.expensesMode) this.expenseRegister.set(next as BpmExpenseRegister | null);
    this.loading.set(false);
  }

  /** Les paramètres d'adresse à garder d'une page du parcours à l'autre. */
  query(extra: Record<string, string | null> = {}): Record<string, string | null> {
    const p = this.project();
    const w = this.window();
    return {
      projet: p?.id ?? null,
      ...(this.professionalMode
        ? { entreprise: this.params()?.get('entreprise') ?? this.businesses()[0]?.id ?? null }
        : {}),
      vue: this.params()?.get('vue') ?? null,
      du: w?.explicit ? w.start : null,
      au: w?.explicit ? w.end : null,
      ...extra,
    };
  }
  /** La même page sur la fenêtre précédente ou suivante. */
  shifted(step: -1 | 1): Record<string, string | null> {
    const w = this.window();
    if (!w) return this.query();
    const next = shiftWindow(w.start, w.end, step);
    return this.query({ du: next.start, au: next.end });
  }
  /** Revenir à la fenêtre de la vue (sans `du` ni `au`). */
  current(): Record<string, string | null> {
    const period = this.project()?.snapshot?.period;
    return this.expensesMode && period
      ? this.query({ du: period.start, au: period.end })
      : this.query({ du: null, au: null });
  }
  chooseBusiness(id: string) {
    void this.router.navigate([], { queryParams: { entreprise: id }, replaceUrl: true });
  }
  /** Le nom d'un poste du projet, d'après le relevé. */
  centerName(id: string | null): string {
    return (
      [...(this.statement()?.centers ?? []), ...(this.statement()?.incomeCenters ?? [])].find(
        (center) => center.id === id,
      )?.name ?? ''
    );
  }
}
