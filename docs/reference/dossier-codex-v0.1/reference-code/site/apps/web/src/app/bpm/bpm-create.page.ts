import { BPM_JOURNEYS } from './bpm-journey-catalog';
import { BpmJourneyGuideComponent } from './bpm-journey-guide.component';
import { BpmProfileCatalogComponent } from './bpm-profile-catalog.component';
import { BpmExistingGuideComponent } from './bpm-existing-guide.component';
import { BpmEntityPickerComponent } from './bpm-entity-picker.component';
import { BpmStartDetailsComponent } from './bpm-start-details.component';
import { startDetails, startErrors } from './bpm-start.model';
import { goalKindLabel } from './bpm-goal-labels';
import { LowerCasePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  afterNextRender,
  Injector,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { formatMoney, parseAmount, parseSignedAmount } from '../shared/amount';
import { AppHeroComponent } from '../shared/app-hero.component';
import { pageText, registerPageTexts } from '../shared/page-text';
import { SITE_SETTINGS, siteSetting } from '../shared/site-settings';
import {
  ENTITY_CATEGORIES,
  ENTITY_CATEGORY_LABELS,
  EntityCategory,
  UserSession,
  entityCategory,
} from '../utilisateurs/utilisateurs.contract';
import {
  BpmAssembly,
  BpmAssemblySource,
  BpmCadence,
  BpmCandidate,
  BpmCreation,
  BpmCreationDetails,
  BpmProfile,
  missingFor,
  startChoices,
} from './bpm.model';
import { BPM_GOAL_KINDS, BpmGoalKind, BpmVision } from './bpm-vision.model';
import { BpmStore } from './bpm.store';
import { BpmContextComponent } from './bpm-context.component';
import { defaultProfileId, goalDate, profileMonthlySaving } from './bpm-profile.model';
import { BpmTourComponent } from './bpm-tour.component';

const P = 'content.pages.bpm.bpm-create.page.';
/** Textes livrés de l'assistant ; ils se personnalisent dans Configuration → Contenus. */
export const BPM_CREATE_TEXTS: Record<string, string> = {
  milestone: 'Jalon',
  currentStepTool: 'Étape en cours',
  sourcesTool: 'Éléments disponibles',
  projectsTool: 'Mes projets',
  assemblyTool: 'Choisir un budget existant',
  assemblySafe: 'Le rattachement à BPM se confirme dans l’atelier',
  atelierOpen: 'Ouvrir l’atelier',
  assemblySteps: 'Choisir le budget · Vérifier · Confirmer',
  assemblyContext: 'Vous assemblez pour',
  assemblyWealth: 'Patrimoine de destination',
  assemblyWealthMissing: 'Patrimoine à vérifier dans l’atelier',
  assemblyStart: 'Ajouter un projet à votre suivi',
  assemblyStartHelp: 'Choisissez un budget ou préparez un nouveau projet ci-dessous.',
  assemblyFreeCount: '{n} budget(s) disponible(s) pour un nouvel assemblage',
  assemblyNoFree: 'Aucun budget libre pour un nouvel assemblage.',
  assemblyNoFreeHelp: 'Préparez un nouveau projet ci-dessous.',
  assemblyLife: 'Votre projet de vie',
  assemblyMain: 'Votre budget principal',
  assemblyLifeHelp:
    'Votre budget du quotidien et votre patrimoine sont préparés avec votre utilisateur.',
  assemblyMainHelp:
    'Votre premier budget et votre patrimoine sont préparés avec votre utilisateur.',
  assemblyMainOpen: 'Ouvrir mon budget principal',
  assemblyProjects: 'Vos projets de la vie',
  assemblyOtherProjects: 'Vos autres projets',
  assemblyProjectsHelp:
    'Voyage, travaux, études… Assemblez leur budget pour les suivre avec votre projet de vie.',
  assemblyOtherProjectsHelp:
    'Assemblez le budget de chaque projet pour le suivre avec le patrimoine de cet utilisateur.',
  assemblyMissingGuide: 'Il me manque un budget : créer les éléments nécessaires',
  assemblyReferences: 'Voir des exemples de postes et de prestataires',
  assemblyOtherUser: 'Travailler pour un autre utilisateur',
  assemblyBack: 'Revenir au choix du parcours',
  stepCount: 'Étape {current} sur {total}',
  detail: 'Détailler et adapter les propositions',
  detailHelp:
    'Ouvrez une ligne pour changer son montant, sa date ou son rattachement. Les propositions sont des exemples à relire.',
  detailInvalid:
    'Complétez les libellés, montants, dates et rattachements. Une valeur inconnue peut rester vide ; un règlement ne peut pas être futur.',
  beneficiary: 'Bénéficiaire du budget',
  records: 'Lignes à créer',
  previewIncome: 'Entrées prévues par mois',
  previewExpense: 'Dépenses prévues par mois',
  previewWealth: 'Patrimoine net renseigné',
  unknown: 'Valeur à compléter',
  datesHelp:
    'Les dates partent d’aujourd’hui ou du début du cycle. Ajustez chaque échéance dans les détails.',
  forecastOnly:
    'Entrées et charges sont prévues puis prises en compte à leur date. Les actifs décrivent le patrimoine déjà détenu.',
  nativeHelp:
    'Créez ou complétez ces éléments dans les modules, dans un nouvel onglet. Au retour, les choix se mettent à jour ; votre brouillon reste ouvert.',
  refresh: 'Actualiser les éléments disponibles',
  sourceInventory: 'Éléments qui seront réunis',
  centers: 'Postes et plafonds',
  people: 'Bénéficiaires / personnes',
  providers: 'Prestataires',
  operations: 'Opérations',
  allocations: 'Allocations',
  assets: 'Actifs',
  tasks: 'Tâches du noyau',
  optionalEmpty: 'Aucun pour le moment — facultatif pour l’assemblage',
  dependencies: 'Dépend de',
  once: 'Ponctuelle',
  actualCount: 'règlement(s) / mouvement réel',
  valuationKnown: 'Valeur renseignée',
  valuationUnknown: 'Valeur à renseigner',
  'problem-missing-center':
    'Il manque le centre de référence du budget. Choisissez-le dans Budget.',
  'problem-missing-allocation': 'Il manque l’allocation de référence du patrimoine.',
  'problem-different-core': 'Le patrimoine possède son noyau dédié, distinct du noyau budgétaire.',
  'problem-already-assembled': 'Un des projets appartient déjà à un assemblage BPM.',
  'problem-budget-linked-elsewhere':
    'Ce budget alimente déjà un autre patrimoine. Revoyez sa liaison dans Cycle & patrimoine.',
  dependencyOrder:
    'Ordre conseillé : projet du noyau → budget et premier poste → bénéficiaires et prestataires → opérations. Côté patrimoine : allocation → actif → mouvement.',
  customGuide: '1 · Créer librement dans les modules sources',
  assemblyTools: '2 · Assembler les éléments disponibles',
  customIntro:
    'Suivez ces repères dans l’ordre qui vous convient. Créez autant de postes, personnes, opérations et actifs que nécessaire.',
  guideCore: 'Poser le cadre dans le Noyau',
  guideCoreHelp: 'Commencez par un projet du noyau. Ses tâches sont facultatives.',
  guideBudget: 'Construire votre budget sur mesure',
  guideBudgetHelp:
    'Créez le budget et son premier poste sur ce projet, puis ajoutez postes, bénéficiaires, prestataires et opérations.',
  guideWealth: 'Décrire votre patrimoine sur mesure',
  guideWealthHelp:
    'Le patrimoine de l’utilisateur existe déjà : complétez allocations, actifs, valeurs, dettes et mouvements, dans l’ordre de votre choix.',
  guideRules: 'Ordre et contraintes de l’assemblage',
  guideRulesText:
    'Un assemblage relie un projet du noyau, un budget et le patrimoine de l’utilisateur. Le budget exige un premier poste, le patrimoine une première allocation. Un budget déjà assemblé reste dans son ensemble ; aucune fiche ne change de projet.',
  guideFreedom:
    'Tâches, personnes, prestataires, opérations et actifs s’ajoutent avant ou après l’assemblage. Relisez toujours une combinaison avant de confirmer.',
  availablePairs: 'Combinaisons disponibles',
  usePair: 'Préparer cet assemblage',
  noPairs:
    'Aucune combinaison complète pour l’instant. Créez les projets manquants avec le guide ; les propositions apparaîtront au retour.',
  nativeTasks: 'Noyau · tâches',
  nativeBudgetManager: 'Budget · détails, devis et règlements',
  nativeWealthManager: 'Patrimoine · détails et valorisations',
  assemblyProgress: 'Assemblage en préparation',
  sourcePending: 'À créer ou choisir',
  sourceSelected: 'Retenu pour l’assemblage',
  sourceUpdated: 'Éléments actualisés. Vérifiez les propositions retenues puis continuez.',
  assemblyReady: 'Les trois projets sont réunis. Vous pouvez préparer leur cycle.',
  prepareCycle: 'Préparer le cycle de cet assemblage',
  nativePatrimoinePeople: 'Patrimoine · personnes',
  nativePatrimoineProviders: 'Patrimoine · prestataires',
  nativeBudgetProviders: 'Budget · prestataires',
  nativeCore: 'Noyau · projets et tâches',
  nativeBudget: 'Budget · projet budgétaire',
  nativeCenters: 'Budget · postes et plafonds',
  nativePeople: 'Budget · bénéficiaires',
  nativeFlows: 'Budget · opérations et règlements',
  nativePatrimoine: 'Patrimoine · projet patrimonial',
  nativeAllocations: 'Patrimoine · allocations',
  nativeAssets: 'Patrimoine · actifs et valorisations',
  nativeOperations: 'Patrimoine · mouvements',
  nativeCycle: 'Réglez ici le cycle et les objectifs, une fois les deux projets choisis.',
  kicker: 'Démarrer un projet',
  title: 'Démarrer votre projet',
  intro: 'Reliez budget et patrimoine.',
  chipTime: 'À votre rythme',
  chipSteps: '{n} étapes guidées',
  chipSafe: 'Rien n’est enregistré avant votre confirmation',
  owner: 'Utilisateur',
  ownerHelp:
    'Vous serez la seule personne à gérer ce projet. Les éléments proposés dans l’atelier sont ceux de l’utilisateur connecté.',
  local: 'Espace local sans utilisateur déclaré',
  needProfile: 'Choisissez d’abord votre utilisateur : le projet lui appartiendra.',
  chooseProfile: 'Choisir mon utilisateur',
  fieldEntity: 'l’utilisateur qui représente cette situation',
  assembleCategory: 'Pour quelle situation assemblez-vous ?',
  loading: 'Lecture de vos projets…',
  railTitle: 'Votre avancement',
  railDone: 'Fait',
  railNow: 'En cours',
  railNext: 'À venir',
  railOptional: 'Facultatif',
  railLeft: 'Il reste',
  railLeftSteps: 'étape(s)',
  railReady: 'Tout est prêt : vérifiez puis confirmez.',
  why: 'Pourquoi cette étape',
  'step-depart': 'Votre point de départ',
  'step-depart-help':
    'Créez un nouveau budget ou reliez vos éléments existants au patrimoine de leur propriétaire.',
  'step-depart-why':
    'Choisissez une création guidée avec des valeurs standard, ou la création détaillée dans les modules sources suivie de l’assemblage.',
  pathNew: 'Partir de zéro',
  pathNewText:
    'Un assistant en huit étapes crée votre projet et son budget ici même. Vous relisez tout avant de confirmer.',
  pathAssemble: 'Assembler l’existant',
  pathAssembleText: 'Choisissez un budget déjà créé et reliez-le à votre suivi Budget/Patrimoine.',
  pathAssembleCount: 'budget(s) disponible(s) pour un nouvel assemblage',
  pathAssembleNone: 'Aucun budget libre pour le moment. Le parcours vous aide à en préparer un.',
  'step-situation': 'Votre situation',
  'step-situation-help':
    'Choisissez la situation la plus proche : budget type, postes, allocations et objectifs sont proposés. Tout reste modifiable.',
  'step-situation-why':
    'Vous ajustez des montants réalistes au lieu de partir d’une page blanche. Rien n’est enregistré avant votre relecture.',
  profileSaving: 'Épargne naturelle d’un mois type',
  profileIncomes: 'Entrées types',
  profileCenters: 'Postes',
  profileGoals: 'Objectifs proposés',
  profileApplied: 'Valeurs de départ reprises de la situation : ajustez-les librement.',
  profileNone: 'Aucune situation livrée : vous partirez de zéro.',
  'step-projet': 'Le projet',
  'step-projet-help':
    'Le projet du noyau donne le cadre : un nom parlant et, si vous le souhaitez, son objectif.',
  'step-projet-why':
    'Le projet du noyau est le point de repère commun : Budget et Patrimoine s’y rattachent, et vous le retrouverez dans tout le site.',
  'step-budget': 'Le budget',
  'step-budget-help':
    'Le budget reçoit vos entrées et sorties. Relisez le bénéficiaire, les postes, les plafonds et les flux proposés dans les détails.',
  'step-budget-why':
    'Un poste regroupe un type de dépenses. Ses montants et échéances alimentent vos prévisions.',
  'step-patrimoine': 'Le patrimoine',
  'step-patrimoine-help':
    'Relisez les allocations et les actifs déjà détenus, avec leurs valeurs et dettes. Le cycle ajoutera ensuite le solde réel de chaque période.',
  'step-patrimoine-why':
    'Une allocation dit à quoi sert l’argent mis de côté : épargne de précaution, études, retraite… Votre vision s’appuiera dessus.',
  'step-noyau': 'Le projet du noyau',
  'step-noyau-help':
    'Créez votre projet dans le Noyau si nécessaire, puis retenez-le ici. Il sera le parent commun du budget et du patrimoine.',
  'step-noyau-why':
    'Un projet du noyau suffit pour commencer. La suite vous mène vers Budget et Patrimoine.',
  'step-budget-existant': 'Votre budget existant',
  'step-budget-existant-help':
    'Choisissez le projet budgétaire dont le solde nourrira votre patrimoine.',
  'step-budget-existant-why':
    'Ses opérations, centres et prestataires restent tels quels : rien n’est déplacé ni recopié.',
  'step-patrimoine-existant': 'Votre patrimoine existant',
  'step-patrimoine-existant-help':
    'Choisissez le projet patrimonial qui recevra le solde de chaque période.',
  'step-patrimoine-existant-why':
    'Ses actifs, allocations et valeurs restent les vôtres ; le cycle y ajoutera les apports du budget.',
  'step-cycle': 'Le cycle',
  'step-cycle-help':
    'À chaque fin de période, le solde réel du budget rejoint le patrimoine et le budget repart de zéro.',
  'step-cycle-why':
    'Le mois convient à la plupart des foyers ; la semaine resserre le suivi ; l’année convient aux projets. Seul le réellement payé est clôturé.',
  linkExisting: 'Ces deux projets sont déjà reliés : le cycle existant est repris tel quel.',
  'step-vision': 'Votre vision',
  'step-vision-help':
    'Facultatif : dites à quoi servira votre patrimoine et le rendement que vous visez. Vous pourrez tout préciser plus tard dans « Ma vision ».',
  'step-vision-why':
    'Un objectif daté (études des enfants, retraite…) et un rendement visé permettent de voir si votre patrimoine y arrivera, inflation comprise.',
  fieldReturn: 'Rendement visé (% par an)',
  fieldSavings: 'Épargne visée par période (€), facultative',
  fieldGoalKind: 'Un premier objectif, facultatif',
  fieldGoalLabel: 'Nom de l’objectif',
  fieldGoalAmount: 'Montant visé (euros d’aujourd’hui)',
  fieldGoalDate: 'Date visée',
  noGoal: 'Pas maintenant',
  'step-verifier': 'Vérifier et confirmer',
  'step-verifier-help':
    'Relisez : tout sera enregistré ensemble, ou rien si un élément est refusé.',
  'step-verifier-why':
    'Après la confirmation, votre tableau de bord s’ouvre sur la période en cours.',
  fieldTitle: 'Nom du projet',
  fieldTitlePlaceholder: 'Ex. Le foyer',
  fieldSummary: 'Objectif, facultatif',
  fieldSummaryPlaceholder: 'Ex. Équilibrer le budget du foyer et faire grandir l’épargne.',
  fieldBudgetTitle: 'Nom du projet budgétaire',
  fieldCenter: 'Premier poste de dépense',
  fieldCenterPlaceholder: 'Ex. Vie courante',
  fieldPatrimoineTitle: 'Nom du projet patrimonial',
  fieldAllocation: 'Première allocation du patrimoine',
  fieldAllocationPlaceholder: 'Ex. Épargne de précaution',
  fieldPeriodicity: 'Périodicité du cycle',
  weekly: 'Chaque semaine',
  weeklyText: 'Un suivi serré, idéal pour reprendre la main sur les dépenses.',
  monthly: 'Chaque mois',
  monthlyText: 'Le rythme des salaires et des factures : le choix le plus courant.',
  yearly: 'Chaque année',
  yearlyText: 'Pour un budget de projet ou des revenus irréguliers.',
  fieldStart: 'Premier jour de gestion',
  startCurrent: 'La période en cours, à partir du',
  startNext: 'La période suivante, à partir du',
  startPast: 'Ou reprendre depuis une période passée',
  startPastHelp:
    'Utile si votre budget a déjà des règlements : les périodes écoulées sont clôturées aussitôt et leur solde rejoint le patrimoine.',
  fieldCore: 'Projet du noyau',
  fieldBpmTitle: 'Nom du projet Budget/Patrimoine',
  fieldBudget: 'Projet budgétaire',
  fieldPatrimoine: 'Projet patrimonial',
  previous: '← Étape précédente',
  next: 'Étape suivante →',
  missing: 'Pour continuer, complétez :',
  recapCore: 'Projet du noyau',
  recapBudget: 'Projet budgétaire',
  recapCenter: 'Premier poste',
  recapPerson: 'Bénéficiaire unique',
  recapPatrimoine: 'Projet patrimonial',
  recapAllocation: 'Allocation',
  recapCycle: 'Cycle',
  recapVision: 'Vision',
  recapNoVision: 'À préciser plus tard',
  recapNote:
    'Le projet, les lignes relues et la liaison du cycle sont créés ensemble. Si l’un est refusé, rien n’est enregistré.',
  recapAssembleNote:
    'Rien n’est créé dans Budget ni dans Patrimoine : vos projets existants sont assemblés et reliés par le cycle.',
  create: 'Créer le projet et ouvrir mon tableau de bord',
  assemble: 'Assembler et ouvrir mon tableau de bord',
  creating: 'Enregistrement en cours…',
  goalInvalid: 'Pour l’objectif, indiquez un montant positif et une date.',
};
registerPageTexts(
  Object.fromEntries(Object.entries(BPM_CREATE_TEXTS).map(([key, value]) => [P + key, value])),
);

type Path = 'new' | 'assemble';
/** Le profil de paramétrage et la situation de l'utilisateur se correspondent. */
const CATEGORY_OF: Record<string, EntityCategory> = {
  famille: 'famille',
  celibataire: 'celibataire',
  association: 'association',
  entreprise: 'entreprise-personnelle',
};
const PROFILE_OF: Record<EntityCategory, string> = {
  famille: 'famille',
  celibataire: 'celibataire',
  association: 'association',
  'entreprise-personnelle': 'entreprise',
};
const STEPS: Record<Path, string[]> = {
  new: ['depart', 'situation', 'projet', 'budget', 'patrimoine', 'cycle', 'vision', 'verifier'],
  assemble: [
    'depart',
    'noyau',
    'budget-existant',
    'patrimoine-existant',
    'cycle',
    'vision',
    'verifier',
  ],
};
const dayFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const KIND_SYMBOLS: Record<BpmGoalKind, string> = {
  etudes: '🎓',
  retraite: '🌅',
  achat: '🏡',
  securite: '🛟',
  transmission: '🤝',
  autre: '✦',
};

/**
 * Démarrer : le cœur de Budget/Patrimoine Management. Un assistant guidé en
 * huit étapes (situation comprise), avec une ligne d'avancement verticale, pour créer un projet ou
 * assembler un budget et un patrimoine existants. Rien n'est écrit avant la
 * confirmation ; l'API enregistre tout ensemble ou rien.
 */
@Component({
  selector: 'rjs-bpm-create-page',
  imports: [
    BpmJourneyGuideComponent,
    BpmContextComponent,
    BpmEntityPickerComponent,
    BpmStartDetailsComponent,
    AppHeroComponent,
    BpmTourComponent,
    FormsModule,
    LowerCasePipe,
    RouterLink,
    BpmExistingGuideComponent,
    BpmProfileCatalogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./bpm-pages.scss', './bpm-create.page.scss'],
  template: `
    <div class="page bpm-start bpm-reading" data-tone="budget">
      <rjs-app-hero
        toolsLabel="Actions"
        tone="aurora"
        headingId="bs-title"
        [kicker]="t('kicker')"
        [title]="path() === 'assemble' ? t('pathAssemble') : t('title')"
        [lead]="t('intro')"
        [chips]="[
          {
            label: '◎',
            value:
              path() === 'assemble'
                ? t('assemblySteps')
                : t('chipSteps').replace('{n}', String(steps().length)),
          },
          { label: '✓', value: t(path() === 'assemble' ? 'assemblySafe' : 'chipSafe') },
        ]"
        ><rjs-bpm-context heroMetaWide [scopeOnly]="true" [embedded]="true" [compact]="true" />
        @if (!needsProfile() && path() !== 'assemble') {
          <rjs-bpm-tour heroGuide [inline]="true" page="create" [steps]="['stage', 'rail']" />
        }
        <a heroActions class="bpm-link" routerLink="/budget-patrimoine-management/parcours"
          >{{ t('projectsTool') }} →</a
        >
        @if (!needsProfile() && path() === 'assemble') {
          <a
            heroActions
            class="btn btn-primary"
            routerLink="/budget-patrimoine-management/creer/assembler"
            >{{ t('assemblyTool') }} →</a
          >
        }
        @if (!needsProfile() && store.workspace()) {
          <nav heroPageTools aria-label="Dans cette page">
            <a
              [routerLink]="[]"
              queryParamsHandling="preserve"
              [fragment]="path() === 'assemble' ? 'bs-existing-elements' : 'bs-stage'"
              >{{ t(path() === 'assemble' ? 'sourcesTool' : 'currentStepTool') }}</a
            >
          </nav>
        }
      </rjs-app-hero>

      @if (needsProfile()) {
        <section class="bpm-blocked" role="alert">
          <p>{{ t('needProfile') }}</p>
          <a
            class="btn btn-primary"
            routerLink="/acces"
            [queryParams]="{ suite: '/budget-patrimoine-management/creer' }"
            >{{ t('chooseProfile') }}</a
          >
        </section>
      } @else if (!store.workspace()) {
        @if (store.error()) {
          <p class="bpm-error" role="alert">{{ store.error() }}</p>
          <button
            type="button"
            class="btn btn-secondary"
            (click)="refreshExisting()"
            [disabled]="store.loading()"
          >
            {{ t('refresh') }}
          </button>
        } @else {
          <p class="bpm-help" role="status">{{ t('loading') }}</p>
        }
      } @else {
        @if (path() === 'assemble') {
          <section id="bs-existing-elements" class="bs-assembly-start" data-ui-pattern="panel">
            <header data-ui-pattern="section-heading">
              <h2>{{ t('assemblyStart') }}</h2>
              <p>{{ t('assemblyStartHelp') }}</p>
            </header>
            <dl class="bs-recap">
              <div>
                <dt>{{ t('assemblyContext') }}</dt>
                <dd>{{ ownerLabel() }}</dd>
              </div>
              <div>
                <dt>{{ t('assemblyWealth') }}</dt>
                <dd>{{ existingWealth() || t('assemblyWealthMissing') }}</dd>
              </div>
            </dl>
            <div class="bs-assembly-kinds">
              <section>
                <h3>{{ t(personalEntity() ? 'assemblyLife' : 'assemblyMain') }}</h3>
                <p>{{ t(personalEntity() ? 'assemblyLifeHelp' : 'assemblyMainHelp') }}</p>
                @if (standardProject(); as project) {
                  <a
                    [routerLink]="
                      personalEntity()
                        ? '/budget-patrimoine-management/tableau-de-bord'
                        : '/budget-patrimoine-management/parcours'
                    "
                    [queryParams]="{ projet: project.id }"
                    >{{ t('assemblyMainOpen') }}</a
                  >
                }
              </section>
              <section>
                <h3>{{ t(personalEntity() ? 'assemblyProjects' : 'assemblyOtherProjects') }}</h3>
                <p>
                  {{ t(personalEntity() ? 'assemblyProjectsHelp' : 'assemblyOtherProjectsHelp') }}
                </p>
                <p class="bs-assembly-count" role="status">
                  {{
                    pairCount()
                      ? t('assemblyFreeCount').replace('{n}', String(pairCount()))
                      : t('assemblyNoFree')
                  }}
                </p>
                <a
                  class="btn btn-primary"
                  routerLink="/budget-patrimoine-management/creer/assembler"
                  >{{ t(pairCount() ? 'assemblyTool' : 'atelierOpen') }} →</a
                >
              </section>
            </div>
            @if (!pairCount()) {
              <p class="bpm-help">{{ t('assemblyNoFreeHelp') }}</p>
            }
            <div class="bs-actions">
              <button
                type="button"
                class="btn btn-secondary"
                (click)="refreshExisting()"
                [disabled]="store.loading()"
              >
                {{ t('refresh') }}
              </button>
              <a class="bpm-link" routerLink="/budget-patrimoine-management/creer">{{
                t('assemblyBack')
              }}</a>
            </div>
            @if (store.error()) {
              <p class="bpm-error" role="alert">{{ store.error() }}</p>
            }
          </section>
          <rjs-bpm-existing-guide [owner]="ownerLabel()" [entityType]="currentEntityType()" />
          <details class="bpm-disclosure bs-assembly-help">
            <summary>{{ t('assemblyOtherUser') }}</summary>
            <fieldset class="bs-options bs-categories">
              <legend>{{ t('assembleCategory') }}</legend>
              @for (category of categories; track category) {
                <label class="bs-option" [class.is-selected]="assembleCategory() === category">
                  <input
                    type="radio"
                    name="assembleCategory"
                    [checked]="assembleCategory() === category"
                    (change)="assembleCategory.set(category)"
                  />
                  <strong>{{ categoryLabels[category] }}</strong>
                </label>
              }
            </fieldset>
            <rjs-bpm-entity-picker
              [category]="assembleCategory()"
              mode="module"
              resume="/budget-patrimoine-management/creer?chemin=assembler"
            />
          </details>
          <details class="bpm-disclosure bs-assembly-help">
            <summary>{{ t('assemblyReferences') }}</summary>
            <rjs-bpm-profile-catalog
              [profiles]="profiles()"
              [profileId]="catalogProfile()"
              [sourceLinks]="true"
            />
          </details>
          <rjs-bpm-journey-guide journey="assembly" active="choose" />
        } @else {
          <div class="bs-layout">
            <form
              id="bs-stage"
              tabindex="-1"
              class="bs-stage"
              data-bpm-frame="form"
              data-tour="stage"
              (ngSubmit)="advance()"
              data-ui-pattern="detail"
            >
              <header class="bs-stage-head">
                <p class="bs-stage-count">
                  {{ t('milestone') }} {{ milestoneIndex() + 1 }} · {{ milestoneTitle() }}
                </p>
                <p class="bs-step-position">
                  {{
                    t('stepCount')
                      .replace('{current}', String(index() + 1))
                      .replace('{total}', String(steps().length))
                  }}
                </p>
                <h2>{{ t('step-' + step()) }}</h2>
                <p class="bs-stage-help">{{ t('step-' + step() + '-help') }}</p>
              </header>

              @switch (step()) {
                @case ('depart') {
                  <div class="bs-paths" role="radiogroup" [attr.aria-label]="t('step-depart')">
                    <label class="bs-path" [class.is-selected]="path() === 'new'">
                      <input
                        type="radio"
                        name="path"
                        value="new"
                        [checked]="path() === 'new'"
                        (change)="choosePath('new')"
                      />
                      <span class="bs-path-icon" aria-hidden="true">✦</span>
                      <strong>{{ t('pathNew') }}</strong>
                      <span>{{ t('pathNewText') }}</span>
                    </label>
                    <label class="bs-path" [class.is-selected]="path() === 'assemble'">
                      <input
                        type="radio"
                        name="path"
                        value="assemble"
                        [checked]="path() === 'assemble'"
                        (change)="choosePath('assemble')"
                      />
                      <span class="bs-path-icon" aria-hidden="true">⇄</span>
                      <strong>{{ t('pathAssemble') }}</strong>
                      <span>{{ t('pathAssembleText') }}</span>
                      <small>{{
                        pairCount()
                          ? pairCount() + ' ' + t('pathAssembleCount')
                          : t('pathAssembleNone')
                      }}</small>
                    </label>
                  </div>
                }
                @case ('situation') {
                  @if (profiles().length) {
                    <div
                      class="bs-paths bs-profiles"
                      role="radiogroup"
                      [attr.aria-label]="t('step-situation')"
                    >
                      @for (profile of profiles(); track profile.id) {
                        <label
                          class="bs-path bs-profile"
                          [class.is-selected]="profileId() === profile.id"
                        >
                          <input
                            type="radio"
                            name="profile"
                            [value]="profile.id"
                            [checked]="profileId() === profile.id"
                            (change)="chooseProfile(profile.id)"
                          />
                          <span class="bs-path-icon" aria-hidden="true">{{
                            profileSymbol(profile.id)
                          }}</span>
                          <strong>{{ profile.label }}</strong>
                          <span>{{ profile.description }}</span>
                          <small
                            >{{ t('profileSaving') }} : {{ money(saving(profile)) }} ·
                            {{ profile.centers.length }}
                            {{ t('profileCenters').toLocaleLowerCase('fr') }} ·
                            {{ profile.goals.length }}
                            {{ t('profileGoals').toLocaleLowerCase('fr') }}</small
                          >
                        </label>
                      }
                    </div>
                    @if (chosenProfile(); as profile) {
                      <dl class="bs-profile-detail">
                        <dt>{{ t('profileIncomes') }}</dt>
                        <dd>{{ list(profile.incomes) }}</dd>
                        <dt>{{ t('profileCenters') }}</dt>
                        <dd>{{ centersList(profile) }}</dd>
                        <dt>{{ t('profileGoals') }}</dt>
                        <dd>{{ goalsList(profile) }}</dd>
                      </dl>
                      <rjs-bpm-profile-catalog [profiles]="profiles()" [profileId]="profile.id" />
                    }
                  } @else {
                    <p class="bs-stage-help">{{ t('profileNone') }}</p>
                  }
                  <rjs-bpm-entity-picker
                    [category]="profileCategory()"
                    mode="basic"
                    [resume]="resumeUrl()"
                  />
                }
                @case ('projet') {
                  <label class="bs-field"
                    ><span>{{ t('fieldTitle') }}</span>
                    <input
                      name="title"
                      [(ngModel)]="draft.title"
                      (ngModelChange)="sync()"
                      [placeholder]="t('fieldTitlePlaceholder')"
                      maxlength="120"
                      required
                      autocomplete="off"
                    />
                  </label>
                  <label class="bs-field"
                    ><span>{{ t('fieldSummary') }}</span>
                    <textarea
                      name="summary"
                      [(ngModel)]="draft.summary"
                      (ngModelChange)="sync()"
                      [placeholder]="t('fieldSummaryPlaceholder')"
                      rows="3"
                      maxlength="2000"
                    ></textarea>
                  </label>
                }
                @case ('budget') {
                  <label class="bs-field"
                    ><span>{{ t('fieldBudgetTitle') }}</span>
                    <input
                      name="budgetTitle"
                      [(ngModel)]="draft.budgetTitle"
                      (ngModelChange)="sync()"
                      maxlength="120"
                      required
                    />
                  </label>
                  <label class="bs-field"
                    ><span>{{ t('fieldCenter') }}</span>
                    <input
                      name="centerName"
                      [(ngModel)]="draft.centerName"
                      (ngModelChange)="sync()"
                      [placeholder]="t('fieldCenterPlaceholder')"
                      maxlength="120"
                      required
                    />
                  </label>
                  <p class="bs-fixed">
                    <strong>{{ t('recapPerson') }}</strong> ·
                    {{ detailsDraft()?.beneficiary || ownerLabel() }}
                  </p>
                }
                @case ('patrimoine') {
                  @if (existingWealth()) {
                    <p class="bs-note">
                      Le patrimoine de {{ ownerLabel() }} est déjà établi : {{ existingWealth() }}.
                      Ce nouveau budget l’utilisera ; aucun actif ni allocation de démonstration ne
                      sera ajouté.
                    </p>
                  } @else {
                    <label class="bs-field"
                      ><span>{{ t('fieldPatrimoineTitle') }}</span>
                      <input
                        name="patrimoineTitle"
                        [(ngModel)]="draft.patrimoineTitle"
                        (ngModelChange)="sync()"
                        maxlength="120"
                        required
                      />
                    </label>
                    <label class="bs-field"
                      ><span>{{ t('fieldAllocation') }}</span>
                      <input
                        name="allocationName"
                        [(ngModel)]="draft.allocationName"
                        (ngModelChange)="sync()"
                        [placeholder]="t('fieldAllocationPlaceholder')"
                        maxlength="120"
                        required
                      />
                    </label>
                  }
                }
                @case ('noyau') {
                  <fieldset class="bs-options">
                    <legend>{{ t('fieldCore') }}</legend>
                    @for (candidate of candidates(); track candidate.coreProjectId) {
                      <label
                        class="bs-option"
                        [class.is-selected]="assembly.coreProjectId === candidate.coreProjectId"
                      >
                        <input
                          type="radio"
                          name="core"
                          [checked]="assembly.coreProjectId === candidate.coreProjectId"
                          (change)="chooseCore(candidate)"
                        />
                        <strong>{{ candidate.coreTitle }}</strong>
                        <span
                          >{{ candidate.budgets.length }} {{ t('fieldBudget') | lowercase }} ·
                          {{ candidate.patrimoines.length }}
                          {{ t('fieldPatrimoine') | lowercase }}</span
                        >
                      </label>
                    }
                  </fieldset>
                  <label class="bs-field"
                    ><span>{{ t('fieldBpmTitle') }}</span>
                    <input
                      name="assemblyTitle"
                      [(ngModel)]="assembly.title"
                      (ngModelChange)="bump()"
                      maxlength="120"
                      required
                    />
                  </label>
                }
                @case ('budget-existant') {
                  <fieldset class="bs-options">
                    <legend>{{ t('fieldBudget') }}</legend>
                    @for (entry of chosen()?.budgets ?? []; track entry.id) {
                      <label
                        class="bs-option"
                        [class.is-selected]="assembly.budgetProjectId === entry.id"
                      >
                        <input
                          type="radio"
                          name="budget"
                          [checked]="assembly.budgetProjectId === entry.id"
                          (change)="assembly.budgetProjectId = entry.id; bump()"
                        />
                        <strong>{{ entry.title }}</strong>
                      </label>
                    }
                  </fieldset>
                }
                @case ('patrimoine-existant') {
                  <fieldset class="bs-options">
                    <legend>{{ t('fieldPatrimoine') }}</legend>
                    @for (entry of chosen()?.patrimoines ?? []; track entry.id) {
                      <label
                        class="bs-option"
                        [class.is-selected]="assembly.patrimoineProjectId === entry.id"
                      >
                        <input
                          type="radio"
                          name="patrimoine"
                          [checked]="assembly.patrimoineProjectId === entry.id"
                          (change)="assembly.patrimoineProjectId = entry.id; bump()"
                        />
                        <strong>{{ entry.title }}</strong>
                      </label>
                    }
                  </fieldset>
                }
                @case ('cycle') {
                  @if (existingLink(); as link) {
                    <p class="bs-note">
                      {{ t('linkExisting') }} {{ t(link.periodicity) }} · {{ date(link.startDate) }}
                    </p>
                  } @else {
                    <fieldset class="bs-cadences">
                      <legend>{{ t('fieldPeriodicity') }}</legend>
                      @for (cadence of cadences; track cadence) {
                        <label
                          class="bs-cadence"
                          [class.is-selected]="draft.periodicity === cadence"
                        >
                          <input
                            type="radio"
                            name="periodicity"
                            [value]="cadence"
                            [checked]="draft.periodicity === cadence"
                            (change)="choosePeriodicity(cadence)"
                          />
                          <strong>{{ t(cadence) }}</strong>
                          <span>{{ t(cadence + 'Text') }}</span>
                        </label>
                      }
                    </fieldset>
                    <fieldset class="bs-options">
                      <legend>{{ t('fieldStart') }}</legend>
                      @for (start of starts(); track start; let first = $first) {
                        <label class="bs-option" [class.is-selected]="draft.startDate === start">
                          <input
                            type="radio"
                            name="startDate"
                            [value]="start"
                            [checked]="draft.startDate === start"
                            (change)="chooseStart(start)"
                          />
                          <strong
                            >{{ t(first ? 'startCurrent' : 'startNext') }} {{ date(start) }}</strong
                          >
                        </label>
                      }
                    </fieldset>
                    <label class="bs-field"
                      ><span>{{ t('startPast') }}</span>
                      <select
                        name="pastStart"
                        [ngModel]="pastStarts().includes(draft.startDate) ? draft.startDate : ''"
                        (ngModelChange)="$event && chooseStart($event)"
                      >
                        <option value="">—</option>
                        @for (start of pastStarts(); track start) {
                          <option [value]="start">{{ date(start) }}</option>
                        }
                      </select>
                    </label>
                    <p class="bs-note">{{ t('startPastHelp') }}</p>
                  }
                }
                @case ('vision') {
                  <div class="bs-vision">
                    <label class="bs-field"
                      ><span>{{ t('fieldReturn') }}</span>
                      <select name="returnPct" [(ngModel)]="vision.returnPct">
                        @for (choice of returnChoices; track choice) {
                          <option [value]="choice">{{ choice }} %</option>
                        }
                      </select>
                    </label>
                    <label class="bs-field"
                      ><span>{{ t('fieldSavings') }}</span>
                      <input name="savings" inputmode="decimal" [(ngModel)]="vision.savings" />
                    </label>
                  </div>
                  @if (path() !== 'new' || !detailsDraft()) {
                    <fieldset class="bs-kinds">
                      <legend>{{ t('fieldGoalKind') }}</legend>
                      <label class="bs-kind" [class.is-selected]="!vision.kind">
                        <input
                          type="radio"
                          name="kind"
                          [checked]="!vision.kind"
                          (change)="vision.kind = ''"
                        />
                        <span aria-hidden="true">—</span>{{ t('noGoal') }}
                      </label>
                      @for (kind of kinds; track kind) {
                        <label class="bs-kind" [class.is-selected]="vision.kind === kind">
                          <input
                            type="radio"
                            name="kind"
                            [checked]="vision.kind === kind"
                            (change)="chooseKind(kind)"
                          />
                          <span aria-hidden="true">{{ symbols[kind] }}</span
                          >{{ kindLabel(kind) }}
                        </label>
                      }
                    </fieldset>
                    @if (vision.kind) {
                      <div class="bs-vision">
                        <label class="bs-field"
                          ><span>{{ t('fieldGoalLabel') }}</span
                          ><input name="goalLabel" [(ngModel)]="vision.label" maxlength="80"
                        /></label>
                        <label class="bs-field"
                          ><span>{{ t('fieldGoalAmount') }}</span
                          ><input name="goalAmount" inputmode="decimal" [(ngModel)]="vision.amount"
                        /></label>
                        <label class="bs-field"
                          ><span>{{ t('fieldGoalDate') }}</span
                          ><input name="goalDate" type="date" [(ngModel)]="vision.date"
                        /></label>
                      </div>
                    }
                  }
                }
                @case ('verifier') {
                  <dl class="bs-recap">
                    @if (path() === 'new') {
                      <div>
                        <dt>{{ t('recapCore') }}</dt>
                        <dd>{{ draft.title }}</dd>
                      </div>
                      <div>
                        <dt>{{ t('recapBudget') }}</dt>
                        <dd>{{ draft.budgetTitle }}</dd>
                      </div>
                      <div>
                        <dt>{{ t('recapCenter') }}</dt>
                        <dd>{{ draft.centerName }}</dd>
                      </div>
                      <div>
                        <dt>{{ t('recapPerson') }}</dt>
                        <dd>{{ detailsDraft()?.beneficiary || ownerLabel() }}</dd>
                      </div>
                      <div>
                        <dt>{{ t('recapPatrimoine') }}</dt>
                        <dd>{{ existingWealth() || draft.patrimoineTitle }}</dd>
                      </div>
                      <div>
                        <dt>{{ t('recapAllocation') }}</dt>
                        <dd>{{ draft.allocationName }}</dd>
                      </div>
                    } @else {
                      <div>
                        <dt>{{ t('fieldBpmTitle') }}</dt>
                        <dd>{{ assembly.title }}</dd>
                      </div>
                      <div>
                        <dt>{{ t('recapCore') }}</dt>
                        <dd>{{ chosen()?.coreTitle }}</dd>
                      </div>
                      <div>
                        <dt>{{ t('recapBudget') }}</dt>
                        <dd>{{ titleOf(chosen()?.budgets, assembly.budgetProjectId) }}</dd>
                      </div>
                      <div>
                        <dt>{{ t('recapPatrimoine') }}</dt>
                        <dd>{{ titleOf(chosen()?.patrimoines, assembly.patrimoineProjectId) }}</dd>
                      </div>
                    }
                    <div class="bs-recap-wide">
                      <dt>{{ t('recapCycle') }}</dt>
                      <dd>{{ cycleLabel() }}</dd>
                    </div>
                    <div class="bs-recap-wide">
                      <dt>{{ t('recapVision') }}</dt>
                      <dd>{{ visionLabel() }}</dd>
                    </div>
                  </dl>
                  <p class="bs-note">
                    {{ path() === 'new' ? t('recapNote') : t('recapAssembleNote') }}
                  </p>
                }
              }

              @if (path() === 'new') {
                @if (detailsDraft(); as details) {
                  <p class="bs-note">
                    {{ t('records') }} : {{ details.centers.length }} {{ detailText('centers') }} ·
                    {{ details.providers?.length ?? 0 }} {{ detailText('providers') }} ·
                    {{ details.flows.length }} {{ detailText('flows') }} ·
                    {{
                      existingWealth()
                        ? 'Patrimoine existant conservé'
                        : details.assets.length + ' ' + detailText('assets')
                    }}
                    · {{ details.goals.length }} {{ detailText('goals') }}
                  </p>
                  @if (step() === 'cycle') {
                    <p class="bs-note">{{ t('datesHelp') }}</p>
                  }
                  @if (step() === 'verifier' || step() === 'situation') {
                    <dl class="bs-recap">
                      <div>
                        <dt>{{ t('previewIncome') }}</dt>
                        <dd>{{ money(detailMonthly('income')) }}</dd>
                      </div>
                      <div>
                        <dt>{{ t('previewExpense') }}</dt>
                        <dd>{{ money(detailMonthly('expense')) }}</dd>
                      </div>
                      <div>
                        <dt>{{ existingWealth() ? 'Patrimoine utilisé' : t('previewWealth') }}</dt>
                        <dd>
                          {{
                            existingWealth() ||
                              (detailWealth() === null ? t('unknown') : money(detailWealth()!))
                          }}
                        </dd>
                      </div>
                    </dl>
                  }
                  @if (step() === 'verifier') {
                    <p class="bs-note">{{ t('forecastOnly') }}</p>
                  }
                  <details class="bpm-disclosure">
                    <summary>{{ t('detail') }}</summary>
                    <p>{{ t('detailHelp') }}</p>
                    @if (!(existingWealth() && step() === 'patrimoine')) {
                      <rjs-bpm-start-details
                        [data]="details"
                        [section]="detailSection()"
                        [today]="today()"
                        (changed)="detailsChanged()"
                      />
                    }
                  </details>
                }
              }

              <details class="bs-why">
                <summary>{{ t('why') }}</summary>
                <p>{{ t('step-' + step() + '-why') }}</p>
              </details>

              @if (missing().length) {
                <p class="bpm-missing" role="status">
                  {{ t('missing') }} {{ missing().join(', ') }}
                </p>
              }
              @if (goalError()) {
                <p class="bpm-error" role="alert">{{ goalError() }}</p>
              }
              @if (store.error()) {
                <p class="bpm-error" role="alert">{{ store.error() }}</p>
              }
              <div class="bs-actions">
                @if (index() > 0) {
                  <button type="button" class="btn btn-secondary" (click)="back()">
                    {{ t('previous') }}
                  </button>
                }
                @if (step() !== 'verifier') {
                  <button type="submit" class="btn btn-primary" [disabled]="missing().length > 0">
                    {{ t('next') }}
                  </button>
                } @else {
                  <button
                    type="button"
                    class="btn btn-primary bs-confirm"
                    (click)="confirm()"
                    [disabled]="store.saving()"
                  >
                    {{
                      store.saving()
                        ? t('creating')
                        : path() === 'new'
                          ? t('create')
                          : t('assemble')
                    }}
                  </button>
                }
              </div>
            </form>

            <aside class="bs-rail" data-tour="rail" [attr.aria-label]="t('railTitle')">
              <rjs-bpm-journey-guide
                journey="start"
                layout="rail"
                [currentStep]="step()"
                [availableSteps]="steps().slice(0, index() + 1)"
                (stepAction)="reviewStep($event)"
              />
              <p class="bs-rail-left">
                @if (left() > 0) {
                  {{ t('railLeft') }} <strong>{{ left() }}</strong> {{ t('railLeftSteps') }}
                } @else {
                  {{ t('railReady') }}
                }
              </p>
              <span class="bs-rail-bar" aria-hidden="true"
                ><span [style.width.%]="percent()"></span
              ></span>
            </aside>
          </div>
        }
      }
    </div>
  `,
})
export class BpmCreatePage {
  protected readonly store = inject(BpmStore);
  private resumeStep = '';
  protected readonly categories = ENTITY_CATEGORIES;
  protected readonly categoryLabels = ENTITY_CATEGORY_LABELS;
  /** Assembler l'existant : la situation dont on choisit l'utilisateur, celle du connecté au départ. */
  protected readonly assembleCategory = signal<EntityCategory>('famille');
  /** La situation que représente le profil de paramétrage choisi. */
  protected catalogProfile(): string {
    const type = this.currentEntityType();
    return ['entreprise-personnelle', 'auto-entrepreneur', 'sasu', 'eurl'].includes(type ?? '')
      ? 'entreprise'
      : type === 'personne-physique'
        ? 'celibataire'
        : type || 'famille';
  }
  protected profileCategory(): EntityCategory {
    return CATEGORY_OF[this.profileId()] ?? 'famille';
  }
  /** L'utilisateur connecté représente-t-il la situation choisie ? Le projet lui appartiendra. */
  protected entityMatches(): boolean {
    const profile = this.session.profile();
    return (
      !this.session.known() ||
      this.session.openMode() ||
      (!!profile && entityCategory(profile) === this.profileCategory())
    );
  }
  protected resumeUrl(): string {
    return `/budget-patrimoine-management/creer?chemin=nouveau&profil=${encodeURIComponent(this.profileId())}&etape=situation`;
  }
  protected currentEntityType(): string {
    return this.session.profile()?.entityType ?? 'famille';
  }
  protected personalEntity(): boolean {
    return ['famille', 'celibataire'].includes(entityCategory(this.session.profile()));
  }
  protected readonly standardProject = computed(
    () =>
      this.store
        .workspace()
        ?.projects?.find(
          (project) =>
            project.defaultForEntity && project.ownerUserId === this.session.profile()?.id,
        ) ?? null,
  );
  protected existingWealth(): string | null {
    const workspace = this.store.workspace();
    const id = workspace?.entities?.find(
      (e) => e.id === this.session.profile()?.id,
    )?.patrimoineProjectId;
    return (
      workspace?.candidates.flatMap((c) => c.patrimoines).find((p) => p.id === id)?.title ??
      this.standardProject()?.patrimoineTitle ??
      null
    );
  }
  private readonly session = inject(UserSession);
  protected readonly cadences: BpmCadence[] = ['weekly', 'monthly', 'yearly'];
  protected readonly kinds = BPM_GOAL_KINDS;
  protected readonly String = String;
  protected readonly symbols = KIND_SYMBOLS;
  /** Les rendements proposés sont les choix déclarés du réglage livré. */
  protected readonly returnChoices =
    (
      SITE_SETTINGS.find((entry) => entry.key === 'bpm.vision.rendementDefaut') as
        { options?: { value: string }[] } | undefined
    )?.options?.map((option) => option.value) ?? [];
  protected readonly path = signal<Path>('new');
  protected readonly index = signal(0);
  private readonly version = signal(0);
  protected readonly goalError = signal('');
  protected draft: BpmCreation = {
    title: '',
    summary: '',
    budgetTitle: '',
    centerName: '',
    patrimoineTitle: '',
    allocationName: '',
    periodicity: siteSetting<BpmCadence>('bpm.creation.periodicite'),
    startDate: '',
  };
  protected assembly = {
    coreProjectId: '',
    budgetProjectId: '',
    patrimoineProjectId: '',
    title: '',
  };
  protected vision = {
    returnPct: siteSetting<string>('bpm.vision.rendementDefaut'),
    savings: '',
    kind: '' as BpmGoalKind | '',
    label: '',
    amount: '',
    date: '',
  };
  protected readonly detailsDraft = signal<BpmCreationDetails | null>(null);
  private readonly detailDrafts = new Map<string, BpmCreationDetails>();
  private scenarioTitle = '';
  private scenarioSummary = '';
  protected today(): string {
    return this.store.workspace()?.today ?? localToday();
  }
  protected detailText(key: string): string {
    return pageText('content.pages.bpm.bpm-start-details.component.' + key);
  }
  protected detailSection(): string {
    return ['budget', 'patrimoine', 'vision'].includes(this.step())
      ? this.step()
      : this.step() === 'cycle'
        ? 'budget'
        : 'all';
  }
  protected detailMonthly(kind: 'income' | 'expense'): number {
    return Math.round(
      (this.detailsDraft()?.flows ?? [])
        .filter((f) => f.kind === kind && f.cadence !== 'once')
        .reduce(
          (sum, f) =>
            sum +
            f.amountCents *
              (f.cadence === 'weekly' ? 52 / 12 : f.cadence === 'yearly' ? 1 / 12 : 1),
          0,
        ),
    );
  }
  protected detailWealth(): number | null {
    const assets = this.detailsDraft()?.assets ?? [];
    return assets.some((a) => a.valueCents === null)
      ? null
      : assets.reduce((sum, a) => sum + a.valueCents! - a.liabilityCents, 0);
  }
  protected chooseStart(start: string): void {
    const previous = this.draft.startDate > this.today() ? this.draft.startDate : this.today();
    this.draft.startDate = start;
    const next = start > this.today() ? start : this.today();
    for (const flow of this.detailsDraft()?.flows ?? [])
      if (!flow.settled && flow.date === previous) flow.date = next;
    this.bump();
  }
  protected detailsChanged(): void {
    const details = this.detailsDraft();
    if (details) {
      this.draft.centerName = details.centers[0]?.name ?? '';
      this.draft.allocationName = details.allocations[0]?.name ?? '';
    }
    this.bump();
  }
  protected nativeLinks(
    step = this.step(),
  ): { path: string; label: string; query: Record<string, string> }[] {
    const core = { path: '/projects', label: 'nativeCore', query: {} };
    const tasks = { path: '/delivery', label: 'nativeTasks', query: {} };
    const budget = [
      ['projets', 'nativeBudget'],
      ['centres', 'nativeCenters'],
      ['personnes', 'nativePeople'],
      ['operations', 'nativeFlows'],
      ['prestataires', 'nativeBudgetProviders'],
    ].map(([family, label]) => ({
      path: '/budget-management/creer/' + family,
      label: label!,
      query: { coreProject: this.assembly.coreProjectId, budget: this.assembly.budgetProjectId },
    }));
    const patrimoine = [
      ['projects', 'nativePatrimoine'],
      ['allocations', 'nativeAllocations'],
      ['assets', 'nativeAssets'],
      ['operations', 'nativeOperations'],
      ['people', 'nativePatrimoinePeople'],
      ['providers', 'nativePatrimoineProviders'],
    ].map(([family, label]) => ({
      path: '/patrimoine-management/creer/' + family,
      label: label!,
      query: {
        project: family === 'projects' ? '' : this.assembly.patrimoineProjectId,
        coreProject: '',
      },
    }));
    budget.push({
      path: '/budget-management/manager/operations',
      label: 'nativeBudgetManager',
      query: { coreProject: this.assembly.coreProjectId, budget: this.assembly.budgetProjectId },
    });
    patrimoine.push({
      path: '/patrimoine-management/manager/assets',
      label: 'nativeWealthManager',
      query: {
        project: this.assembly.patrimoineProjectId,
        coreProject: '',
      },
    });
    return step === 'noyau'
      ? [core, tasks]
      : step === 'budget-existant'
        ? budget
        : step === 'patrimoine-existant'
          ? patrimoine
          : [core, tasks, ...budget, ...patrimoine];
  }
  protected readonly customGroups = [
    { step: 'noyau', title: 'guideCore', help: 'guideCoreHelp' },
    { step: 'budget-existant', title: 'guideBudget', help: 'guideBudgetHelp' },
    { step: 'patrimoine-existant', title: 'guideWealth', help: 'guideWealthHelp' },
  ];
  protected assemblyPairs(): {
    core: BpmCandidate;
    budget: BpmAssemblySource;
    wealth: BpmAssemblySource;
    problems: string[];
  }[] {
    return this.candidates().flatMap((core) =>
      core.budgets.flatMap((budget) =>
        core.patrimoines.map((wealth) => ({
          core,
          budget,
          wealth,
          problems:
            core.pairs?.find(
              (p) => p.budgetProjectId === budget.id && p.patrimoineProjectId === wealth.id,
            )?.problems ?? [],
        })),
      ),
    );
  }
  protected choosePair(pair: {
    core: BpmCandidate;
    budget: { id: string };
    wealth: { id: string };
    problems?: string[];
  }): void {
    if (pair.problems?.length) return;
    this.chooseCore(pair.core);
    this.assembly.budgetProjectId = pair.budget.id;
    this.assembly.patrimoineProjectId = pair.wealth.id;
    this.openAssemblyStep('cycle');
  }
  protected selectedProblems(): string[] {
    return (
      this.chosen()?.pairs?.find(
        (p) =>
          p.budgetProjectId === this.assembly.budgetProjectId &&
          p.patrimoineProjectId === this.assembly.patrimoineProjectId,
      )?.problems ?? []
    );
  }
  protected selectedInventories(): { domain: string; project: BpmAssemblySource }[] {
    const budget = this.chosen()?.budgets.find((p) => p.id === this.assembly.budgetProjectId),
      wealth = this.chosen()?.patrimoines.find((p) => p.id === this.assembly.patrimoineProjectId);
    return [
      ...(budget ? [{ domain: 'budget', project: budget }] : []),
      ...(wealth ? [{ domain: 'patrimoine', project: wealth }] : []),
    ];
  }
  protected inventoryRoute(domain: string, family: string): string {
    const budget: Record<string, string> = {
      centers: 'centres',
      people: 'personnes',
      providers: 'prestataires',
      operations: 'operations',
    };
    return domain === 'budget'
      ? '/budget-management/manager/' + budget[family]
      : '/patrimoine-management/manager/' + family;
  }
  protected inventoryQuery(domain: string, id: string): Record<string, string> {
    return domain === 'budget'
      ? { budget: this.assembly.budgetProjectId, item: id }
      : { project: this.assembly.patrimoineProjectId };
  }
  protected referenceLabels(ids: string[]): string {
    const entries = this.selectedInventories().flatMap((s) =>
      (s.project.inventory ?? []).flatMap((g) => g.items),
    );
    return ids
      .map(
        (id) =>
          entries.find((i) => i.id === id)?.label ??
          this.chosen()?.tasks?.find((t) => t.id === id)?.label ??
          id,
      )
      .join(' · ');
  }
  protected readonly sourceStatus = signal('');
  protected readonly sourceSelected = (source: { title: string }) => !!source.title;
  protected assemblySources(): { step: string; label: string; title: string }[] {
    return [
      { step: 'noyau', label: 'fieldCore', title: this.chosen()?.coreTitle ?? '' },
      {
        step: 'budget-existant',
        label: 'fieldBudget',
        title: this.titleOf(this.chosen()?.budgets, this.assembly.budgetProjectId),
      },
      {
        step: 'patrimoine-existant',
        label: 'fieldPatrimoine',
        title: this.titleOf(this.chosen()?.patrimoines, this.assembly.patrimoineProjectId),
      },
    ];
  }
  protected openAssemblyStep(step: string): void {
    const index = this.steps().indexOf(step);
    if (index >= 0) this.index.set(index);
    this.bump();
  }
  @HostListener('window:focus')
  protected refreshOnReturn(): void {
    if (this.path() === 'assemble' && !this.store.loading() && !this.store.saving())
      void this.refreshExisting();
  }
  private refreshing = false;
  protected async refreshExisting(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    const previous = this.candidates();
    const previousChosen = this.chosen();
    try {
      await this.store.load();
      if (this.store.error()) return;
      let candidate = this.chosen();
      if (!candidate) {
        const added = this.candidates().filter(
          (c) => !previous.some((p) => p.coreProjectId === c.coreProjectId),
        );
        const proposed =
          added.length === 1
            ? added[0]
            : this.candidates().length === 1
              ? this.candidates()[0]
              : null;
        if (proposed) {
          this.chooseCore(proposed);
          candidate = proposed;
        } else {
          this.assembly.coreProjectId = '';
          this.assembly.budgetProjectId = '';
          this.assembly.patrimoineProjectId = '';
        }
      }
      if (candidate) {
        const addedBudgets = candidate.budgets.filter(
          (b) => !previousChosen?.budgets.some((p) => p.id === b.id),
        );
        const addedPatrimoines = candidate.patrimoines.filter(
          (b) => !previousChosen?.patrimoines.some((p) => p.id === b.id),
        );
        if (!candidate.budgets.some((b) => b.id === this.assembly.budgetProjectId))
          this.assembly.budgetProjectId =
            addedBudgets.length === 1
              ? addedBudgets[0]!.id
              : candidate.budgets.length === 1
                ? candidate.budgets[0]!.id
                : '';
        if (!candidate.patrimoines.some((p) => p.id === this.assembly.patrimoineProjectId))
          this.assembly.patrimoineProjectId =
            addedPatrimoines.length === 1
              ? addedPatrimoines[0]!.id
              : candidate.patrimoines.length === 1
                ? candidate.patrimoines[0]!.id
                : '';
      }
      this.sourceStatus.set(this.t('sourceUpdated'));
      this.bump();
    } finally {
      this.refreshing = false;
    }
  }
  private savedVisions: Partial<Record<Path, typeof this.vision>> = {};
  protected choosePath(path: Path): void {
    if (path === this.path()) return;
    this.savedVisions[this.path()] = { ...this.vision };
    this.vision = this.savedVisions[path] ?? {
      returnPct: siteSetting<string>('bpm.vision.rendementDefaut'),
      savings: '',
      kind: '',
      label: '',
      amount: '',
      date: '',
    };
    this.path.set(path);
    this.index.set(0);
    this.goalError.set('');
    this.bump();
  }
  private named = { budget: false, patrimoine: false };

  protected readonly milestoneIndex = computed(() =>
    Math.max(
      0,
      BPM_JOURNEYS.start.milestones.findIndex((m) => m.steps.some((s) => s.action === this.step())),
    ),
  );
  protected milestoneTitle(): string {
    const milestone = BPM_JOURNEYS.start.milestones[this.milestoneIndex()];
    return milestone ? pageText('content.pages.bpm.bpm-journey-catalog.' + milestone.title) : '';
  }
  protected reviewStep(step: string): void {
    const target = this.steps().indexOf(step);
    if (target < 0 || target > this.index()) return;
    this.sync();
    this.index.set(target);
    this.goalError.set('');
    this.revealStage();
  }
  private readonly stageInjector = inject(Injector);
  private revealStage(): void {
    afterNextRender(
      () => {
        const stage = document.getElementById('bs-stage');
        stage?.focus({ preventScroll: true });
        stage?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
      },
      { injector: this.stageInjector },
    );
  }
  protected readonly steps = computed(() => STEPS[this.path()]);
  protected readonly step = computed(() => this.steps()[this.index()]!);
  protected readonly candidates = computed(() => {
    const workspace = this.store.workspace();
    const entityId = this.session.profile()?.id;
    const wealth = workspace?.entities?.find((e) => e.id === entityId)?.patrimoineProjectId;
    return (workspace?.candidates ?? []).map((c) => ({
      ...c,
      budgets: c.budgets.filter((b) => !b.entityId || b.entityId === entityId),
      patrimoines: c.patrimoines.filter((p) =>
        wealth ? p.id === wealth : !p.entityId || p.entityId === entityId,
      ),
    }));
  });
  /** Count each free budget once, regardless of the number of available patrimonies. */
  protected readonly pairCount = computed(
    () =>
      new Set(
        this.candidates().flatMap((entry) =>
          entry.budgets.filter((budget) => !budget.assembledId).map((budget) => budget.id),
        ),
      ).size,
  );
  protected readonly needsProfile = computed(
    () => this.session.known() && !this.session.openMode() && !this.session.profile(),
  );
  protected readonly ownerLabel = computed(() => this.session.profile()?.label ?? this.t('local'));
  protected readonly starts = computed(() => {
    this.version();
    return startChoices(this.store.workspace()?.today ?? localToday(), this.draft.periodicity);
  });
  /** Les périodes passées qu'un cycle peut reprendre : douze semaines ou mois, ou cinq années. */
  protected readonly pastStarts = computed(() => {
    this.version();
    const cadence = this.draft.periodicity;
    const current = this.starts()[0];
    const out: string[] = [];
    let cursor = current;
    for (let index = 0; index < (cadence === 'yearly' ? 4 : 12); index++) {
      cursor = previousStart(cursor, cadence);
      out.push(cursor);
    }
    return out;
  });
  protected readonly chosen = computed(() => {
    this.version();
    return (
      this.candidates().find((entry) => entry.coreProjectId === this.assembly.coreProjectId) ?? null
    );
  });
  protected readonly existingLink = computed(() => {
    this.version();
    if (this.path() !== 'assemble') return null;
    return (
      this.chosen()?.links.find(
        (link) =>
          link.budgetProjectId === this.assembly.budgetProjectId &&
          link.patrimoineProjectId === this.assembly.patrimoineProjectId,
      ) ?? null
    );
  });
  protected readonly missing = computed(() => {
    this.version();
    const labels: Record<string, string> = {
      title: 'fieldTitle',
      budgetTitle: 'fieldBudgetTitle',
      centerName: 'fieldCenter',
      patrimoineTitle: 'fieldPatrimoineTitle',
      allocationName: 'fieldAllocation',
      startDate: 'fieldStart',
    };
    const step = this.step();
    const order = ['projet', 'budget', 'patrimoine', 'cycle'];
    if (this.path() === 'new' && order.includes(step))
      return missingFor(order.indexOf(step), this.draft).map((key) => this.t(labels[key]!));
    const out: string[] = [];
    if (step === 'situation' && this.path() === 'new' && !this.entityMatches())
      out.push(this.t('fieldEntity'));
    if (step === 'noyau') {
      if (!this.assembly.coreProjectId) out.push(this.t('fieldCore'));
      if (!this.assembly.title.trim()) out.push(this.t('fieldBpmTitle'));
    }
    if (step === 'budget-existant' && !this.assembly.budgetProjectId)
      out.push(this.t('fieldBudget'));
    if (step === 'patrimoine-existant' && !this.assembly.patrimoineProjectId)
      out.push(this.t('fieldPatrimoine'));
    if (
      step === 'cycle' &&
      this.path() === 'assemble' &&
      !this.existingLink() &&
      !this.draft.startDate
    )
      out.push(this.t('fieldStart'));
    return out;
  });
  protected readonly left = computed(() => this.steps().length - 1 - this.index());
  protected readonly percent = computed(() =>
    Math.round((this.index() / (this.steps().length - 1)) * 100),
  );

  constructor() {
    inject(ActivatedRoute)
      .queryParamMap.pipe(takeUntilDestroyed())
      .subscribe((params) => {
        this.choosePath(params.get('chemin') === 'assembler' ? 'assemble' : 'new');
        // Retour d'un changement d'utilisateur : le profil et l'étape choisis sont repris.
        const profile = params.get('profil');
        if (profile) this.profileId.set(profile);
        this.resumeStep = params.get('etape') ?? '';
      });
    void this.store.load().then(() => {
      if (this.session.profile()) this.assembleCategory.set(entityCategory(this.session.profile()));
      // Sans profil demandé, la situation de l'utilisateur connecté est proposée.
      if (!this.resumeStep) {
        const own = PROFILE_OF[entityCategory(this.session.profile())];
        if (this.session.profile() && own && this.profiles().some((p) => p.id === own))
          this.profileId.set(own);
      }
      this.draft.startDate = this.starts()[0];
      this.applyProfile();
      this.sync();
      const index = this.steps().indexOf(this.resumeStep);
      if (index > 0) this.index.set(index);
    });
  }
  protected t(key: string): string {
    return pageText(P + key);
  }
  protected bump(): void {
    this.version.update((value) => value + 1);
  }
  /** Les noms du PBM et du PPM suivent celui du projet tant qu'ils n'ont pas été changés. */
  protected sync(): void {
    const step = this.step();
    if (step === 'budget') this.named.budget = this.draft.budgetTitle !== this.draft.title;
    if (step === 'patrimoine')
      this.named.patrimoine = this.draft.patrimoineTitle !== this.draft.title;
    if (step === 'projet') {
      if (!this.named.budget) this.draft.budgetTitle = this.draft.title;
      if (!this.named.patrimoine) this.draft.patrimoineTitle = this.draft.title;
    }
    const details = this.detailsDraft();
    if (details) {
      if (step === 'budget' && details.centers[0]) details.centers[0].name = this.draft.centerName;
      if (step === 'patrimoine' && details.allocations[0])
        details.allocations[0].name = this.draft.allocationName;
    }
    this.bump();
  }
  protected chooseCore(candidate: BpmCandidate): void {
    this.assembly = {
      coreProjectId: candidate.coreProjectId,
      title:
        !this.assembly.title || this.assembly.title === this.chosen()?.coreTitle
          ? candidate.coreTitle
          : this.assembly.title,
      budgetProjectId: candidate.budgets.length === 1 ? candidate.budgets[0]!.id : '',
      patrimoineProjectId: candidate.patrimoines.length === 1 ? candidate.patrimoines[0]!.id : '',
    };
    this.bump();
  }
  protected choosePeriodicity(cadence: BpmCadence): void {
    this.draft.periodicity = cadence;
    this.bump();
    this.chooseStart(this.starts()[0]);
  }
  /** Les profils de paramétrage livrés par l'API. */
  protected readonly profiles = computed(() => this.store.workspace()?.profiles ?? []);
  protected readonly profileId = signal(defaultProfileId());
  protected readonly chosenProfile = computed(
    () => this.profiles().find((profile) => profile.id === this.profileId()) ?? null,
  );
  /** Les valeurs déjà reprises d'un profil : elles peuvent suivre un autre profil, une saisie non. */
  private fromProfile = { centerName: '', allocationName: '', goal: '' };
  protected chooseProfile(id: string): void {
    this.profileId.set(id);
    this.applyProfile();
  }
  /** Préremplit le premier poste, la première allocation, la périodicité et un premier objectif. */
  private applyProfile(): void {
    const profile = this.chosenProfile();
    if (!profile) return;
    this.draft.profile = profile.id;
    if (!this.draft.title || this.draft.title === this.scenarioTitle) {
      this.draft.title = profile.scenario?.title ?? profile.label;
      if (!this.named.budget) this.draft.budgetTitle = this.draft.title;
      if (!this.named.patrimoine) this.draft.patrimoineTitle = this.draft.title;
      this.scenarioTitle = this.draft.title;
    }
    if (!this.draft.summary || this.draft.summary === this.scenarioSummary) {
      this.draft.summary = profile.scenario?.summary ?? profile.description;
      this.scenarioSummary = this.draft.summary;
    }
    if (!this.detailDrafts.has(profile.id)) {
      const details = startDetails(profile, this.today());
      details.beneficiary = this.ownerLabel();
      details.centers.sort(
        (a, b) => Number(b.name === 'Vie courante') - Number(a.name === 'Vie courante'),
      );
      this.detailDrafts.set(profile.id, details);
    }
    this.detailsDraft.set(this.detailDrafts.get(profile.id)!);
    const center =
      profile.centers.find((entry) => entry.name === 'Vie courante') ?? profile.centers[0];
    if (
      center &&
      (!this.draft.centerName || this.draft.centerName === this.fromProfile.centerName)
    ) {
      this.draft.centerName = center.name;
      this.fromProfile.centerName = center.name;
    }
    const allocation = profile.allocations[0];
    if (
      allocation &&
      (!this.draft.allocationName || this.draft.allocationName === this.fromProfile.allocationName)
    ) {
      this.draft.allocationName = allocation.name;
      this.fromProfile.allocationName = allocation.name;
    }
    const details = this.detailsDraft()!;
    if (details.centers[0]) details.centers[0].name = this.draft.centerName;
    if (details.allocations[0]) details.allocations[0].name = this.draft.allocationName;
    if (this.draft.periodicity !== profile.periodicity) this.choosePeriodicity(profile.periodicity);
    const goal = profile.goals[0];
    if (goal && (!this.vision.kind || this.vision.label === this.fromProfile.goal)) {
      this.vision.kind = goal.kind as BpmGoalKind;
      this.vision.label = goal.label;
      this.vision.amount = goal.targetCents ? String(goal.targetCents / 100) : '';
      this.vision.date = goalDate(this.store.workspace()?.today ?? localToday(), goal.yearsAhead);
      this.fromProfile.goal = goal.label;
    }
    this.bump();
  }
  protected profileSymbol(id: string): string {
    return id === 'famille' ? '⌂' : id === 'association' ? '◎' : id === 'entreprise' ? '▣' : '◇';
  }
  protected saving(profile: BpmProfile): number {
    return profileMonthlySaving(profile);
  }
  protected money(cents: number): string {
    return formatMoney(cents);
  }
  protected list(entries: readonly { title: string }[]): string {
    return entries.map((entry) => entry.title).join(' · ');
  }
  protected centersList(profile: BpmProfile): string {
    return profile.centers
      .map((center) =>
        center.limitCents ? `${center.name} (${formatMoney(center.limitCents)})` : center.name,
      )
      .join(' · ');
  }
  protected goalsList(profile: BpmProfile): string {
    return profile.goals
      .map((goal) => `${goal.label}${goal.targetCents ? ' ' + formatMoney(goal.targetCents) : ''}`)
      .join(' · ');
  }
  protected chooseKind(kind: BpmGoalKind): void {
    this.vision.kind = kind;
    if (!this.vision.label) this.vision.label = this.kindLabel(kind);
  }
  protected kindLabel(kind: BpmGoalKind): string {
    return goalKindLabel(kind);
  }
  protected advance(): void {
    if (this.missing().length || this.index() >= this.steps().length - 1) return;
    // Quitter « Votre situation » reprend les valeurs de départ du profil retenu, sans écraser une saisie.
    if (this.step() === 'situation') this.applyProfile();
    if (
      this.path() === 'new' &&
      this.detailsDraft() &&
      ['budget', 'patrimoine', 'vision'].includes(this.step()) &&
      startErrors(this.detailsDraft()!, this.today(), this.step())
    ) {
      this.goalError.set(this.t('detailInvalid'));
      return;
    }
    this.goalError.set('');
    if (this.step() === 'vision' && !this.visionOf()) return;
    this.index.set(this.index() + 1);
    this.bump();
    this.revealStage();
  }
  protected back(): void {
    this.index.set(Math.max(0, this.index() - 1));
    this.bump();
    this.revealStage();
  }
  /** La vision saisie, ou `null` si l'objectif est incomplet (le motif est affiché). */
  private visionOf(): BpmVision | null {
    this.goalError.set('');
    const returnPct = Number(this.vision.returnPct);
    const savings = this.vision.savings.trim() ? parseSignedAmount(this.vision.savings) : null;
    const goals = [];
    if (this.vision.kind && !(this.path() === 'new' && this.detailsDraft())) {
      const cents = parseAmount(this.vision.amount);
      if (!cents || cents <= 0 || !this.vision.date) {
        this.goalError.set(this.t('goalInvalid'));
        return null;
      }
      goals.push({
        id: `G${Date.now().toString(36).toUpperCase()}`,
        label: this.vision.label.trim() || this.kindLabel(this.vision.kind),
        kind: this.vision.kind,
        targetCents: cents,
        targetDate: this.vision.date,
        note: '',
      });
    }
    return {
      returnPct: Number.isFinite(returnPct) ? returnPct : null,
      savingsTargetCents: savings,
      goals,
    };
  }
  protected summaryOf(step: string): string {
    switch (step) {
      case 'depart':
        return this.path() === 'new' ? this.t('pathNew') : this.t('pathAssemble');
      case 'projet':
        return this.draft.title;
      case 'budget':
        return this.draft.budgetTitle;
      case 'patrimoine':
        return this.draft.patrimoineTitle;
      case 'noyau':
        return this.chosen()?.coreTitle ?? '';
      case 'budget-existant':
        return this.titleOf(this.chosen()?.budgets, this.assembly.budgetProjectId);
      case 'patrimoine-existant':
        return this.titleOf(this.chosen()?.patrimoines, this.assembly.patrimoineProjectId);
      case 'cycle':
        return this.cycleLabel();
      case 'vision':
        return this.visionLabel();
      default:
        return '';
    }
  }
  protected titleOf(list: { id: string; title: string }[] | undefined, id: string): string {
    return list?.find((entry) => entry.id === id)?.title ?? '';
  }
  protected cycleLabel(): string {
    const link = this.existingLink();
    return link
      ? `${this.t(link.periodicity)} · ${this.date(link.startDate)}`
      : `${this.t(this.draft.periodicity)} · ${this.date(this.draft.startDate)}`;
  }
  protected visionLabel(): string {
    if (this.path() === 'new' && this.detailsDraft())
      return `${this.vision.returnPct} % · ${this.detailsDraft()!
        .goals.map((g) => g.label)
        .join(' · ')}`;
    const parts = [`${this.vision.returnPct} %`];
    if (this.vision.kind) parts.push(this.vision.label || this.kindLabel(this.vision.kind));
    return this.vision.kind || this.vision.savings ? parts.join(' · ') : this.t('recapNoVision');
  }
  protected async confirm(): Promise<void> {
    const vision = this.visionOf();
    if (!vision) return;
    if (this.path() === 'assemble' && this.selectedProblems().length) {
      this.goalError.set(
        this.selectedProblems()
          .map((p) => this.t('problem-' + p))
          .join(' '),
      );
      return;
    }
    if (
      this.path() === 'new' &&
      this.detailsDraft() &&
      startErrors(this.detailsDraft()!, this.today())
    ) {
      this.goalError.set(this.t('detailInvalid'));
      return;
    }
    if (this.path() === 'assemble') {
      location.assign(
        '/budget-patrimoine-management/creer/assembler?noyau=' +
          encodeURIComponent(this.assembly.coreProjectId),
      );
      return;
    }
    const link = this.existingLink();
    const input: BpmCreation | BpmAssembly =
      this.path() === 'new'
        ? { ...this.draft, vision, details: this.detailsDraft() ?? undefined }
        : {
            mode: 'assemble',
            title: this.assembly.title.trim(),
            coreProjectId: this.assembly.coreProjectId,
            budgetProjectId: this.assembly.budgetProjectId,
            patrimoineProjectId: this.assembly.patrimoineProjectId,
            periodicity: link?.periodicity ?? this.draft.periodicity,
            startDate: link?.startDate ?? this.draft.startDate,
            vision,
          };
    const id = await this.store.create(input);
    // Le noyau, Budget et Patrimoine ont pu changer ensemble : le site se recharge pour
    // que chaque module reparte de ses données, comme après un choix de profil.
    if (id)
      location.assign(
        `/budget-patrimoine-management/tableau-de-bord?projet=${encodeURIComponent(id)}`,
      );
  }
  protected date(value: string): string {
    return value ? dayFormatter.format(new Date(`${value}T12:00:00Z`)) : '';
  }
}

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function previousStart(start: string, cadence: BpmCadence): string {
  const date = new Date(`${start}T12:00:00Z`);
  if (cadence === 'weekly') date.setUTCDate(date.getUTCDate() - 7);
  else if (cadence === 'monthly') date.setUTCMonth(date.getUTCMonth() - 1, 1);
  else date.setUTCFullYear(date.getUTCFullYear() - 1, 0, 1);
  return date.toISOString().slice(0, 10);
}
