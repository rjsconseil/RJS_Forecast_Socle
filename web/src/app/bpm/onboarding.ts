import { afterNextRender, Component, computed, ElementRef, inject, Injector, OnInit, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthSession } from '../core/auth-session';
import { Api, newRequestKey, RecetteContext, toApiError, UserDirectory } from '../core/api.service';
import { UserType } from '../core/models';
import { euros, parseAmount, shortDate } from '../core/format';
import { AppHeroComponent, HeroChip } from '../shared/app-hero.component';
import { injectPageWorkspace } from '../plan/page-workspace';

type Field = 'email' | 'password' | 'label' | 'userType' | 'openingStock' | 'openingDate' | 'objective' | 'anchorDay' | 'cycleStartDate';

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
  templateUrl: './onboarding.html',
})
export class BpmOnboarding implements OnInit {
  private api = inject(Api);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private ctx = inject(RecetteContext);
  private directory = inject(UserDirectory);
  private auth = inject(AuthSession);
  /**
   * Connexion exigée (site en ligne) : un profil n'existe qu'avec son compte. Le formulaire demande alors l'adresse et le
   * mot de passe du nouvel utilisateur et passe par l'inscription (`/api/auth/register`), qui crée le profil, sa
   * composition et ses identifiants en une seule écriture, puis connecte ce nouvel utilisateur.
   */
  protected accountNeeded = this.auth.required;
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
    email: new FormControl('', { nonNullable: true }),
    password: new FormControl('', { nonNullable: true }),
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
    const email = v.email.trim();
    if (this.accountNeeded()) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Une adresse e-mail valide, pour se connecter.';
      if (v.password.length < 10) errors.password = 'Au moins 10 caractères.';
    }
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
      const profile = {
        requestKey: this.requestKey,
        label,
        userType: v.userType,
        openingStock,
        openingDate: openingStock === null ? null : v.openingDate || todayIso(),
        objective: objective as number | null,
        anchorDay,
        cycleStartDate: v.cycleStartDate || null,
      };
      if (this.accountNeeded()) {
        // L'inscription connecte le nouvel utilisateur : la session (et donc le profil actif) devient la sienne.
        await this.auth.register({ ...profile, email, password: v.password });
      } else {
        const r = await this.api.createUser(profile);
        this.ctx.select(r.userId);
      }
      this.requestKey = newRequestKey();
      this.form.controls.password.setValue('');
      await this.directory.refresh().catch(() => undefined);
      // Le tableau de bord propose ensuite l'étape suivante ; la confirmation dit ce qui reste à faire.
      // Le cycle est actif dès que le jour d'ancrage est donné (début aujourd'hui par défaut, règle du middleware).
      const cycleReady = anchorDay !== null;
      // Depuis « Démarrer un projet », le projet de vie créé se poursuit dans sa gestion, seul lieu de modification.
      await this.router.navigate([this.startLife() ? '/projet-de-vie' : '/app'], {
        state: {
          journeyNotice: cycleReady
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
