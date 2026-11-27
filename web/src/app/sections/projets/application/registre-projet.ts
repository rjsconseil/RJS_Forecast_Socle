import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Api, toApiError, type LigneApplication } from '../../../platform/grand-noyau';
import { APPLICATION } from '../fonctionnalites/dossiers';
import { erreurRegistre, saisieRegistre, valeurLisible, VALEURS, type ChampRegistre, type Registre } from '../fonctionnalites/registres';
import { PRINCE2_LIVRABLES } from '../fonctionnalites/prince2';

/**
 * Le registre PRINCE2 d'un thème pour un projet qui a son dossier : la liste, l'état modifiable sur place, la saisie
 * d'une ligne et, pour les séquences, leur ouverture (instanciation). Données de l'application (tables AA_MP_…).
 */
@Component({
  selector: 'projets-registre',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './registre-projet.html',
  styleUrl: './registre-projet.scss',
})
export class ProjetsRegistre {
  private readonly api = inject(Api);
  readonly registre = input.required<Registre>();
  readonly projets = input.required<{ id: string; title: string }[]>();

  protected readonly projetId = signal('');
  protected readonly lignes = signal<LigneApplication[]>([]);
  protected readonly chargement = signal(false);
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly saisie = signal(false);
  protected readonly valeurs = VALEURS;
  protected readonly champsSaisis = computed(() => this.registre().champs.filter((c) => c.id !== 'refCode'));
  protected readonly etat = computed(() => this.registre().champs.find((c) => c.id === this.registre().etat) ?? null);

  constructor() {
    // Le premier projet qui a son dossier est choisi d'office ; la liste se recharge à chaque changement.
    effect(() => {
      const list = this.projets();
      if (!list.some((p) => p.id === this.projetId())) this.projetId.set(list[0]?.id ?? '');
    });
    effect(() => { void this.charger(this.registre().collection, this.projetId()); });
  }

  private async charger(collection: string, projectId: string) {
    if (!projectId) { this.lignes.set([]); return; }
    this.chargement.set(true);
    try {
      this.lignes.set((await this.api.aaList(APPLICATION, collection, { projectId })).items);
    } catch (err) {
      this.failure.set(toApiError(err).message);
    } finally {
      this.chargement.set(false);
    }
  }

  protected afficher(c: ChampRegistre, l: LigneApplication) {
    return valeurLisible(c, l, (code) => (PRINCE2_LIVRABLES as Record<string, { nom: string }>)[code]?.nom ?? code);
  }

  private async run(action: () => Promise<unknown>, done: string) {
    if (this.busy()) return false;
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      await action();
      this.notice.set(done);
      await this.charger(this.registre().collection, this.projetId());
      return true;
    } catch (err) {
      this.failure.set(toApiError(err).message);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async ajouter(form: HTMLFormElement) {
    const f = new FormData(form);
    const brut = Object.fromEntries(this.champsSaisis().map((c) => [c.id, String(f.get(c.id) ?? '')]));
    const saisie = saisieRegistre(this.registre(), brut);
    const error = erreurRegistre(this.registre(), saisie);
    if (error) { this.failure.set(error); return; }
    const ok = await this.run(() => this.api.aaCreate(APPLICATION, this.registre().collection, { ...saisie, projectId: this.projetId() }), 'Ligne ajoutée au registre.');
    if (ok) { form.reset(); this.saisie.set(false); }
  }

  protected changerEtat(l: LigneApplication, valeur: string) {
    const champ = this.registre().etat;
    if (!champ || l[champ] === valeur) return Promise.resolve(false);
    return this.run(() => this.api.aaUpdate(APPLICATION, this.registre().collection, l.id, { [champ]: valeur, expectedRevision: l.revision }), `État mis à jour : ${VALEURS[valeur] ?? valeur}.`);
  }

  protected ouvrirSequence(l: LigneApplication) {
    return this.run(async () => {
      await this.api.aaInstancier(APPLICATION, { declencheur: 'ouverture-etape', projectId: this.projetId(), etapeId: l.id });
      if (l['statut'] !== 'en-cours') await this.api.aaUpdate(APPLICATION, 'etapes', l.id, { statut: 'en-cours', expectedRevision: l.revision });
    }, `Séquence « ${String(l['nom'] ?? '')} » ouverte : son plan et ses rapports sont prévus.`);
  }
}
