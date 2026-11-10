import { afterNextRender, Component, computed, ElementRef, inject, Injector, OnInit, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, newRequestKey, RecetteContext, toApiError, UserDirectory } from '../core/api.service';
import { UserType } from '../core/models';
import { euros, parseAmount, shortDate } from '../core/format';
import { AppHeroComponent, HeroChip } from '../shared/app-hero.component';
import { injectPageWorkspace } from '../shared/page-workspace';

type Field = 'label' | 'userType' | 'openingStock' | 'openingDate' | 'objective' | 'anchorDay' | 'cycleStartDate';

/** Ce qui naît en une seule écriture avec le user : son projet de vie et tout ce qui le relie. */
export const LIFE_PROJECT_CHAIN: { title: string; detail: string }[] = [
  { title: 'Utilisateur', detail: 'Votre profil et son type' },
  { title: 'Projet noyau « Projet de vie »', detail: 'La racine de tous vos projets' },
  { title: 'Budget « Projet de vie »', detail: 'Revenus et charges, période par période' },
  { title: 'Patrimoine', detail: "Stock d'ouverture, résultats capitalisés, objectif" },
  { title: 'Composition BPM', detail: 'Relie budget, patrimoine et projet' },
  { title: 'Liaison de cycle', detail: 'Le cycle mensuel de vos périodes' },
];

function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Page Utilisateurs, sur le gabarit `utilisateurs.page` de la référence (rjsconseil/rjs-forecast) :
 * bandeau `rjs-app-hero` figé, note d'usage, section « Utilisateurs » (recherche, liste `us-row` avec ses
 * commandes `us-row-actions`, formulaire `us-form` ouvert par « Nouvel utilisateur » et partageant alors
 * `us-split`), puis la composition créée en une seule écriture. Le choix d'un utilisateur reprend
 * l'aiguillage `profile-choice` de la référence (« Choisir » / utilisateur actif).
 * Création d'un user et, dans la même écriture atomique, de toute sa composition BPM.
 * Habillage : partiel global `_utilisateurs.scss` (portée `.us-page`).
 */
@Component({
  selector: 'app-bpm-onboarding',
  imports: [ReactiveFormsModule, RouterLink, AppHeroComponent],
  styleUrl: './onboarding.scss',
  template: `
    <div class="page page-wide us-page">
      <rjs-app-hero
        data-sticky-hero
        tone="indigo"
        headingId="users-page-title"
        [title]="workspace()?.title ?? 'Utilisateurs'"
        [kicker]="startLife() ? 'Démarrer un projet · une seule fois' : 'Utilisateurs · administration'"
        [lead]="workspace()?.lead ?? 'Créez les utilisateurs : leur Budget « Projet de vie », leur Patrimoine et leur composition BPM naissent ensemble.'"
        [chips]="heroChips()"
        [result]="error() ? { message: error()!, tone: 'danger' } : null"
      >
        @if (workspace()) {
          <button heroPrimary type="button" class="app-hero-action" (click)="submit()" [disabled]="saving() || !types().length || !usersReady()">{{ saving() ? 'Création…' : startLife() ? 'Créer mon projet de vie' : 'Créer l’utilisateur et son espace' }}</button>
        }
        <ng-container heroActions>
        @if (!workspace()) {
        <button heroActions type="button" class="app-hero-action" (click)="focusForm()" [disabled]="!types().length || !usersReady()">
          <span aria-hidden="true">+</span> {{ firstProfile() ? 'Créer le premier utilisateur' : 'Nouvel utilisateur' }}
        </button>
        <a heroActions class="app-hero-action is-secondary" routerLink="/utilisateurs" fragment="us-profiles-title" queryParamsHandling="preserve" (click)="focusList()"
          >Retrouver un utilisateur</a
        >
        }
        </ng-container>
      </rjs-app-hero>

      <p class="us-note">
        <strong>Inconnu n'est pas 0.</strong>
        Tout ce qui n'est pas connu aujourd'hui peut rester vide : cela restera inconnu, jamais compté comme 0, et pourra être
        complété plus tard dans les réglages.
      </p>

      @if (loadError()) {
        <div class="us-alert" role="alert">
          <span>{{ loadError() }}</span>
          <button type="button" aria-label="Masquer le message" (click)="loadError.set(null)">×</button>
        </div>
      }

      @if (!usersReady()) {
        <p class="us-empty" role="status">Lecture des utilisateurs…</p>
      } @else {
      <section #profilesSection class="us-section" aria-labelledby="us-profiles-title">
        @if (!workspace()) {
        <div class="us-section-head">
          <div>
            <h2 id="us-profiles-title">Utilisateurs</h2>
            <p>Chaque utilisateur garde le même identifiant dans tout le site. Son type et sa composition BPM sont fixés à la création.</p>
          </div>
        </div>

        <div class="us-filters">
          <label for="us-profile-search"
            >Rechercher un utilisateur
            <input
              #profileSearch
              id="us-profile-search"
              type="search"
              placeholder="Nom, identifiant ou type"
              [value]="profileQuery()"
              (input)="setProfileFilters($any($event.target).value, typeFilter())"
            />
          </label>
          <label for="us-profile-type"
            >Type
            <select id="us-profile-type" [value]="typeFilter()" (change)="setProfileFilters(profileQuery(), $any($event.target).value)">
              <option value="all">Tous les utilisateurs</option>
              @for (t of types(); track t.key) {
                <option [value]="t.key" [selected]="typeFilter() === t.key">{{ t.label }}</option>
              }
            </select>
          </label>
          @if (profileQuery() || typeFilter() !== 'all') {
            <button class="btn btn-secondary filter-reset" type="button" (click)="setProfileFilters('', 'all')">
              Effacer les filtres
            </button>
          }
        </div>
        <p class="filter-summary" role="status">{{ filteredUsers().length }} utilisateur(s) affiché(s)</p>
        } @else {
          <h2 id="us-profiles-title">Le profil et son point de départ</h2>
        }

        <div class="us-split" [class.is-specialized]="!!workspace()">
          @if (!workspace()) {
          <div class="us-list">
            @for (row of filteredUsers(); track row.user.id) {
              <article class="us-row" [attr.aria-current]="row.current ? 'true' : null">
                <div class="us-row-main">
                  <strong>
                    {{ row.user.label }}
                    <span class="us-chip">{{ row.user.userTypeLabel }}</span>
                    @if (row.current) {
                      <span class="us-chip is-accent">Connecté ici</span>
                    }
                  </strong>
                  <small>#{{ row.user.id }}</small>
                  <span class="us-chips">
                    @if (row.user.bpmCompositionId) {
                      <span class="us-chip">Composition BPM</span>
                    } @else {
                      <span class="us-chip is-muted">Sans composition BPM</span>
                    }
                    @if (row.user.cycleState === 'active') {
                      <span class="us-chip">Cycle mensuel actif</span>
                    } @else if (row.user.cycleState === 'to_configure') {
                      <span class="us-chip is-muted">Cycle à configurer</span>
                    }
                    @if (row.user.entryCount !== undefined) {
                      <span class="us-chip">{{ row.user.entryCount }} opération(s)</span>
                    }
                  </span>
                </div>
                <div class="us-row-actions">
                  @if (row.current) {
                    <small class="us-hint">Utilisateur actif</small>
                  } @else {
                    <button type="button" class="btn btn-secondary" [disabled]="saving()" (click)="choose(row.user.id)">Choisir</button>
                  }
                </div>
              </article>
            } @empty {
              @if (users().length) {
                <p class="us-empty">Aucun utilisateur ne correspond aux filtres.</p>
              } @else {
                <div class="us-empty">
                  <strong>Aucun utilisateur pour l'instant.</strong>
                  <span>Créez le premier : son Budget « Projet de vie », son Patrimoine et sa composition BPM seront créés en même temps.</span>
                </div>
              }
            }
          </div>
          }

          @if (showForm()) {
            <form class="us-form" [formGroup]="form" (ngSubmit)="submit()" novalidate aria-labelledby="us-form-title" [attr.aria-busy]="saving()">
              <h3 id="us-form-title">{{ startLife() ? 'Votre profil et votre projet de vie' : firstProfile() ? 'Créons votre espace Budget & Patrimoine' : 'Nouvel utilisateur' }}</h3>

              <label>
                Libellé
                <span class="field-requirement">Obligatoire</span>
                <input
                  #profileLabel
                  formControlName="label"
                  maxlength="120"
                  autocomplete="nickname"
                  placeholder="Ex. : Camille"
                  [attr.aria-invalid]="!!err('label')"
                  [attr.aria-describedby]="err('label') ? 'e-label' : null"
                />
                @if (err('label')) {
                  <small class="field-hint" data-state="error" id="e-label">{{ err('label') }}</small>
                }
              </label>
              <label>
                Type d’utilisateur
                <select formControlName="userType" [attr.aria-invalid]="!!err('userType')" [attr.aria-describedby]="err('userType') ? 'e-type' : null">
                  @for (t of types(); track t.key) {
                    <option [value]="t.key">{{ t.label }}</option>
                  }
                </select>
                @if (err('userType')) {
                  <small class="field-hint" data-state="error" id="e-type">{{ err('userType') }}</small>
                }
              </label>

              <fieldset class="us-fieldset">
                <legend>Votre patrimoine de départ (facultatif)</legend>
                <label>
                  Stock d'ouverture (€)
                  <input formControlName="openingStock" inputmode="decimal" placeholder="Inconnu" [attr.aria-invalid]="!!err('openingStock')" aria-describedby="h-stock" />
                  <small class="field-hint" id="h-stock" [attr.data-state]="err('openingStock') ? 'error' : null">
                    @if (err('openingStock')) {
                      {{ err('openingStock') }}
                    } @else {
                      Peut être négatif (dettes). Vide = <strong>inconnu</strong>, ce n'est pas 0.
                    }
                  </small>
                </label>
                <label>
                  À la date du
                  <input type="date" formControlName="openingDate" [attr.aria-invalid]="!!err('openingDate')" aria-describedby="h-odate" />
                  <small class="field-hint" id="h-odate" [attr.data-state]="err('openingDate') ? 'error' : null">
                    @if (err('openingDate')) {
                      {{ err('openingDate') }}
                    } @else {
                      Utilisée si un stock est saisi ; aujourd'hui par défaut.
                    }
                  </small>
                </label>
                <label>
                  Objectif initial du patrimoine (€)
                  <input formControlName="objective" inputmode="decimal" placeholder="Aucun objectif" [attr.aria-invalid]="!!err('objective')" aria-describedby="h-obj" />
                  <small class="field-hint" id="h-obj" [attr.data-state]="err('objective') ? 'error' : null">
                    @if (err('objective')) {
                      {{ err('objective') }}
                    } @else {
                      Information seule : elle sert à mesurer votre progression.
                    }
                  </small>
                </label>
              </fieldset>

              <fieldset class="us-fieldset">
                <legend>Votre cycle mensuel (facultatif)</legend>
                <label>
                  Jour de début de période
                  <input
                    type="number"
                    min="1"
                    max="28"
                    step="1"
                    inputmode="numeric"
                    formControlName="anchorDay"
                    placeholder="À configurer plus tard"
                    [attr.aria-invalid]="!!err('anchorDay')"
                    aria-describedby="h-anchor"
                  />
                  <small class="field-hint" id="h-anchor" [attr.data-state]="err('anchorDay') ? 'error' : null">
                    @if (err('anchorDay')) {
                      {{ err('anchorDay') }}
                    } @else {
                      De 1 à 28, par ex. le jour où arrive votre salaire.
                    }
                  </small>
                </label>
                <label>
                  Premier cycle à partir du
                  <input type="date" formControlName="cycleStartDate" [attr.aria-invalid]="!!err('cycleStartDate')" aria-describedby="h-cstart" />
                  <small class="field-hint" id="h-cstart" [attr.data-state]="err('cycleStartDate') ? 'error' : null">
                    @if (err('cycleStartDate')) {
                      {{ err('cycleStartDate') }}
                    } @else {
                      Vide : à partir d'aujourd'hui.
                    }
                  </small>
                </label>
                @if (!anchorGiven()) {
                  <small class="us-hint">Sans jour de début, le cycle sera « à configurer plus tard » : les chiffres d'une période resteront inconnus jusque-là.</small>
                }
              </fieldset>

              <p class="us-hint">La création prépare son Budget « Projet de vie » et son Patrimoine relié, ensemble ou pas du tout : jamais d'espace à moitié construit.</p>

              @if (saving()) {
                <p class="form-feedback" data-state="busy" role="status">Création en cours…</p>
              } @else if (error()) {
                <p class="form-feedback" data-state="error" role="alert">{{ error() }}</p>
              } @else if (form.dirty) {
                <p class="form-feedback" data-state="draft" role="status">Saisie en cours · rien n'est créé avant la validation du formulaire.</p>
              } @else {
                <p class="form-feedback">Rien n'est créé avant la validation du formulaire.</p>
              }

              <div class="us-actions">
                <button class="btn btn-primary" type="submit" [disabled]="saving() || !types().length">
                  {{ saving() ? 'Création en cours…' : startLife() ? 'Créer mon projet de vie' : 'Créer et utiliser cet utilisateur' }}
                </button>
                <button class="btn btn-secondary" type="button" [disabled]="saving()" (click)="cancel()">Annuler</button>
              </div>
            </form>
          }
        </div>
      </section>
      }

      <section class="us-section" aria-labelledby="chain-title">
        <div class="us-section-head">
          <div>
            <h2 id="chain-title">Ce qui sera créé, en une seule écriture</h2>
            <p>Tout est créé ensemble, ou rien : jamais d'espace à moitié construit.</p>
          </div>
        </div>
        <ol class="us-tree us-chain">
          @for (step of chain; track step.title) {
            <li>
              <strong>{{ $index + 1 }}. {{ step.title }}</strong>
              <small>{{ step.detail }}</small>
            </li>
          }
        </ol>

        @if (showForm()) {
          <h3 class="us-subhead">Votre point de départ</h3>
          <dl class="us-stats" aria-live="polite">
            <div>
              <dt>Stock d'ouverture</dt>
              <dd [class.is-unknown]="recap().stock === null">{{ recap().stockText }}</dd>
            </div>
            <div>
              <dt>Objectif</dt>
              <dd>{{ recap().objectiveText }}</dd>
            </div>
            <div>
              <dt>Cycle</dt>
              <dd [class.is-unknown]="!anchorGiven()">{{ recap().cycleText }}</dd>
            </div>
          </dl>
        }
      </section>
    </div>
  `,
})
export class BpmOnboarding implements OnInit {
  private api = inject(Api);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private ctx = inject(RecetteContext);
  private directory = inject(UserDirectory);
  protected workspace = injectPageWorkspace();
  private profileLabel = viewChild<ElementRef<HTMLInputElement>>('profileLabel');
  private profileSearch = viewChild<ElementRef<HTMLInputElement>>('profileSearch');
  private profilesSection = viewChild<ElementRef<HTMLElement>>('profilesSection');
  private injector = inject(Injector);

  protected chain = LIFE_PROJECT_CHAIN;
  protected types = signal<UserType[]>([]);
  protected saving = signal(false);
  protected error = signal<string | null>(null);
  protected loadError = signal<string | null>(null);
  protected fieldErrors = signal<Partial<Record<Field, string>>>({});
  /** Clé stable : conservée pour toute nouvelle tentative, renouvelée après un succès. */
  private requestKey = newRequestKey();

  /** Les users lus par la coquille ; relus ici seulement quand la liste est encore vide. */
  protected users = this.directory.users;
  /** Comme `store.loading` dans la référence : « Lecture des utilisateurs… » tant que la liste n'est pas sûre. */
  protected usersReady = signal(this.directory.users().length > 0);
  protected firstProfile = computed(() => this.usersReady() && this.users().length === 0);
  /** Comme le brouillon de la référence : le formulaire s'ouvre sur demande, d'office pour le premier utilisateur. */
  protected formOpen = signal(false);
  /** Création du projet de vie depuis « Démarrer un projet » (visiteur) : même formulaire, même écriture unique. */
  protected startLife = computed(() => this.workspace()?.key === 'start-life');
  protected showForm = computed(() => !!this.workspace() || this.formOpen() || this.firstProfile());
  protected profileQuery = signal(this.route.snapshot.queryParamMap.get('profileQuery') ?? '');
  protected typeFilter = signal(this.route.snapshot.queryParamMap.get('userType') ?? 'all');
  protected filteredUsers = computed(() => {
    const query = this.profileQuery().trim().toLocaleLowerCase('fr');
    const type = this.typeFilter();
    const current = this.ctx.userId();
    return this.users()
      .filter(
        (user) =>
          (type === 'all' || user.userType === type) &&
          (!query || [user.label, user.id, user.userTypeLabel].some((text) => text.toLocaleLowerCase('fr').includes(query))),
      )
      .map((user) => ({ user, current: user.id === current }));
  });
  protected heroChips = computed<HeroChip[]>(() => [
    { label: 'Utilisateurs', value: this.usersReady() ? String(this.users().length) : '…' },
    { label: "Types d'utilisateur", value: String(this.types().length) },
    { label: 'Connecté ici', value: this.users().find((user) => user.id === this.ctx.userId())?.label ?? 'Aucun' },
  ]);

  protected form = new FormGroup({
    label: new FormControl('', { nonNullable: true }),
    userType: new FormControl('', { nonNullable: true }),
    openingStock: new FormControl('', { nonNullable: true }),
    openingDate: new FormControl('', { nonNullable: true }),
    objective: new FormControl('', { nonNullable: true }),
    anchorDay: new FormControl<string | number>('', { nonNullable: true }),
    cycleStartDate: new FormControl('', { nonNullable: true }),
  });

  private values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected anchorGiven = computed(() => String(this.values().anchorDay ?? '').trim() !== '');
  protected recap = computed(() => {
    const v = this.values();
    const stock = parseAmount(v.openingStock);
    const objective = parseAmount(v.objective);
    const day = String(v.anchorDay ?? '').trim();
    const stockText =
      stock === 'invalid' ? 'Montant à corriger' : stock === null ? 'Inconnu' : `${euros(stock)} au ${shortDate(v.openingDate || todayIso())}`;
    const objectiveText = objective === 'invalid' ? 'Montant à corriger' : objective === null ? 'Aucun' : euros(objective);
    const cycleText = day ? `Mensuel, à partir du ${day} de chaque mois` : 'À configurer plus tard';
    return { stock: stock === 'invalid' ? null : stock, stockText, objectiveText, cycleText };
  });

  async ngOnInit() {
    // Liste vide : la coquille la lit peut-être encore ; on la relit pour ne pas ouvrir à tort le premier formulaire.
    const usersRead = this.usersReady()
      ? Promise.resolve()
      : this.directory
          .refresh()
          .then(
            () => undefined,
            (err) => this.loadError.set(toApiError(err).message),
          )
          .finally(() => this.usersReady.set(true));
    try {
      const types = await this.api.userTypes();
      this.types.set(types);
      if (types.length && !this.form.controls.userType.value) this.form.controls.userType.setValue(types[0].key);
    } catch (err) {
      this.loadError.set(toApiError(err).message);
    }
    await usersRead;
  }

  protected err(field: Field): string | null {
    return this.fieldErrors()[field] ?? null;
  }

  protected setProfileFilters(query: string, type: string) {
    this.profileQuery.set(query);
    this.typeFilter.set(type);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { profileQuery: query || null, userType: type === 'all' ? null : type },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Commande du bandeau : amène au formulaire de création, curseur dans le premier champ. */
  protected focusForm() {
    this.formOpen.set(true);
    afterNextRender(
      () => {
        const input = this.profileLabel()?.nativeElement;
        input?.focus({ preventScroll: true });
        input?.scrollIntoView({ block: 'nearest' });
      },
      { injector: this.injector },
    );
  }

  /** « Annuler » referme le formulaire et oublie la saisie, comme le brouillon de la référence. */
  protected cancel() {
    this.formOpen.set(false);
    this.form.reset();
    if (this.types().length) this.form.controls.userType.setValue(this.types()[0].key);
    this.fieldErrors.set({});
    this.error.set(null);
    if (this.startLife()) void this.router.navigate(['/creer']);
    else if (this.workspace()?.key === 'users-new') void this.router.navigate(['/utilisateurs'], { queryParamsHandling: 'preserve' });
  }

  /** Aiguillage de la référence (`profile-choice`) : l'utilisateur choisi vaut pour tout le site. */
  protected async choose(id: string) {
    this.ctx.select(id);
    await this.router.navigate(['/app']);
  }

  /**
   * Commande « Retrouver un utilisateur » : le routeur n'active pas le défilement vers les ancres,
   * on amène donc la liste sous le bandeau figé, curseur dans la recherche quand elle existe.
   */
  protected focusList() {
    const search = this.profileSearch()?.nativeElement;
    const target = search ?? this.profilesSection()?.nativeElement;
    target?.scrollIntoView({ block: 'center' });
    search?.focus({ preventScroll: true });
  }

  async submit() {
    const v = this.form.getRawValue();
    const errors: Partial<Record<Field, string>> = {};
    const label = v.label.trim();
    if (!label) errors.label = 'Donnez un libellé à l’utilisateur.';
    if (!v.userType) errors.userType = "Choisissez un type d'utilisateur.";
    const stock = parseAmount(v.openingStock);
    if (stock === 'invalid') errors.openingStock = 'Montant invalide (ex. : 1 250,50 ou -300).';
    const objective = parseAmount(v.objective);
    if (objective === 'invalid') errors.objective = 'Montant invalide (ex. : 20 000).';
    else if (objective !== null && objective < 0) errors.objective = "L'objectif ne peut pas être négatif.";
    const dayRaw = String(v.anchorDay ?? '').trim();
    let anchorDay: number | null = null;
    if (dayRaw) {
      const n = Number(dayRaw);
      if (!Number.isInteger(n) || n < 1 || n > 28) errors.anchorDay = 'Un jour entre 1 et 28.';
      else anchorDay = n;
    }
    this.fieldErrors.set(errors);
    this.error.set(null);
    if (Object.keys(errors).length) {
      this.error.set('Quelques champs sont à corriger.');
      return;
    }

    const openingStock = stock as number | null;
    this.saving.set(true);
    try {
      // Le créateur n'est pas transmis : un futur user « parent » (audience `sponsor` du plan) passera ici
      // son identité pour devenir le maître du user créé. Aujourd'hui, seul un visiteur crée son propre user.
      const r = await this.api.createUser({
        requestKey: this.requestKey,
        label,
        userType: v.userType,
        openingStock,
        openingDate: openingStock === null ? null : v.openingDate || todayIso(),
        objective: objective as number | null,
        anchorDay,
        cycleStartDate: v.cycleStartDate || null,
      });
      this.requestKey = newRequestKey();
      await this.directory.refresh().catch(() => undefined);
      this.ctx.select(r.userId);
      // Le tableau de bord propose ensuite l'étape suivante ; la confirmation dit ce qui reste à faire.
      // Le cycle est actif dès que le jour d'ancrage est donné (début aujourd'hui par défaut, règle du middleware).
      const cycleReady = anchorDay !== null;
      // Depuis « Démarrer un projet », le projet de vie créé se poursuit dans sa gestion, seul lieu de modification.
      await this.router.navigate([this.startLife() ? '/projet-de-vie' : '/app'], {
        state: {
          bpmNotice: cycleReady
            ? `Utilisateur « ${label} » créé avec son projet de vie.`
            : `Utilisateur « ${label} » créé avec son projet de vie. Réglez son cycle et son budget dans la gestion du projet de vie.`,
        },
      });
    } catch (err) {
      const e = toApiError(err);
      const field = e.body.details?.field as Field | undefined;
      if (field && field in this.form.controls) this.fieldErrors.set({ [field]: e.message });
      this.error.set(e.message);
    } finally {
      this.saving.set(false);
    }
  }
}
