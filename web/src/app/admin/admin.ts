import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api, ApiError, toApiError, UserDirectory } from '../core/api.service';
import { EffectiveParameter, JournalEntry, ModuleDescription, RecentError } from '../core/models';
import { AppHeroComponent, HeroChip } from '../shared/app-hero.component';
import { injectPageWorkspace } from '../plan/page-workspace';

type Tab = 'modules' | 'parameters' | 'metrics' | 'journal' | 'errors';

/** Identifiant d'objet persisté (préfixe_uuid) : inspectable dans Object Management. */
const OBJECT_ID = /^[a-z]{2,4}_[0-9a-f]{8}-/;

@Component({
  selector: 'app-admin',
  imports: [RouterLink, JsonPipe, AppHeroComponent],
  // Gabarits de la source : Configuration (cartes, réglages, pastilles de modules) et Journal d'activité (tableaux).
  styleUrls: ['./configuration.page.scss', './audit-admin.page.scss', './admin-pages.scss'],
  template: `
    <section class="page cfg-page" data-ui-pattern="page" aria-labelledby="adm-title">
      <rjs-app-hero
        data-sticky-hero
        tone="indigo"
        headingId="adm-title"
        [title]="workspace()?.title ?? 'Administration'"
        kicker="Administration du site · Paramètres"
        [lead]="workspace()?.lead ?? 'Modules du socle, paramètres effectifs (défaut du code ou valeur administrée), formules des chiffres, journal et erreurs. Les invariants (unicité, références, intégrité) ne sont jamais des paramètres : ils ne s’administrent pas.'"
        [chips]="heroChips()"
        [result]="editError() || resetError() ? { message: (editError() ?? resetError()!.error).message, tone: 'danger' } : savedNote() ? { message: savedNote()!, tone: 'success' } : null"
      >
        @if (workspace()?.key === 'admin-parameters' && editingParameter(); as p) {
          <button heroPrimary type="button" class="app-hero-action" (click)="save(p)" [disabled]="saving()">{{ saving() ? 'Enregistrement…' : 'Enregistrer le paramètre' }}</button>
        }
        <button heroActions type="button" class="app-hero-action" (click)="load()">Relire</button>
        <a heroActions class="app-hero-action is-secondary" routerLink="/admin/calculs">Calculs des chiffres →</a>
        <a heroActions class="app-hero-action is-secondary" routerLink="/object-management">Object Management →</a>
      </rjs-app-hero>

      @if (!workspace()) {
      <div class="cfg-modules" role="tablist" aria-label="Sections de l'administration">
        @for (t of tabs; track t[0]) {
          <button
            type="button"
            role="tab"
            class="cfg-module-chip"
            [id]="'tab-' + t[0]"
            [attr.aria-controls]="'adm-panel-' + t[0]"
            [attr.aria-selected]="tab() === t[0]"
            [class.current]="tab() === t[0]"
            (click)="tab.set(t[0])"
          >
            <strong>{{ t[1] }}</strong>
            <small>{{ tabCount(t[0]) }}</small>
          </button>
        }
      </div>
      }

      @if (error()) {
        <p class="cfg-error" role="alert">{{ error() }}</p>
      }

      <section class="adm-panel-stack" [attr.role]="workspace() ? 'region' : 'tabpanel'" [id]="'adm-panel-' + activeTab()" [attr.aria-labelledby]="workspace() ? 'adm-title' : 'tab-' + activeTab()">
        @switch (activeTab()) {
          @case ('modules') {
            <p class="cfg-hint">Architecture à trois niveaux : un module ne dépend que de modules de niveau inférieur ou égal ; les niveaux supérieurs enrichissent les inférieurs par extensions.</p>
            @for (lvl of modulesByLevel(); track lvl.level) {
              <section class="cfg-panel" data-ui-pattern="panel" [attr.aria-labelledby]="'adm-level-' + lvl.level">
                <span class="cfg-number">Niveau {{ lvl.level }} · {{ lvl.modules.length }} module(s)</span>
                <h2 [id]="'adm-level-' + lvl.level">{{ lvl.label }}</h2>
                <div class="audit-table-wrap" role="region" tabindex="0" [attr.aria-label]="'Modules — ' + lvl.label">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Module</th>
                        <th scope="col">Dépend de</th>
                        <th scope="col">Natures d'objets</th>
                        <th scope="col">Paramètres</th>
                        <th scope="col">Variables</th>
                        <th scope="col">Métriques</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (m of lvl.modules; track m.id) {
                        <tr>
                          <td><strong>{{ m.label }}</strong><small><code>{{ m.id }}</code></small></td>
                          <td>@for (d of m.dependsOn; track d) {<code class="block">{{ d }}</code>} @empty {<span class="cfg-hint">—</span>}</td>
                          <td>@for (k of m.kinds; track k) {<code class="block">{{ k }}</code>} @empty {<span class="cfg-hint">—</span>}</td>
                          <td>{{ m.parameters }}</td>
                          <td>{{ m.variables }}</td>
                          <td>{{ m.metrics }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            } @empty {
              @if (!error()) {
                <p class="cfg-notice" role="status">Chargement…</p>
              }
            }
          }

          @case ('parameters') {
            <p class="cfg-hint">
              Paramètres hors formules (les formules se règlent dans l'onglet Calculs). Une valeur jamais administrée est en révision 0 et vaut le défaut du code.
            </p>
            @for (g of parameterGroups(); track g.group; let gi = $index) {
              <section class="cfg-panel cfg-settings-section" data-ui-pattern="panel" [attr.aria-labelledby]="'adm-group-' + gi">
                <div class="cfg-panel-head">
                  <div>
                    <span class="cfg-number">{{ g.parameters.length }} paramètre(s)</span>
                    <h2 [id]="'adm-group-' + gi">{{ g.group }}</h2>
                  </div>
                </div>
                <div class="cfg-settings-grid">
                  @for (p of g.parameters; track p.key) {
                    <article class="cfg-setting" [class.changed]="editKey() === p.key" [attr.data-setting]="p.key">
                      <div class="cfg-setting-head">
                        <h3 class="adm-setting-title">{{ p.label }}</h3>
                        <span class="cfg-setting-state">{{ editKey() === p.key ? 'Modification en cours' : p.origin === 'administration' ? 'Réglé' : 'Valeur livrée' }}</span>
                      </div>
                      @if (p.description) {
                        <p class="cfg-setting-help">{{ p.description }}</p>
                      }
                      <pre class="adm-value">{{ display(p.value) }}</pre>
                      <p class="cfg-setting-meta">
                        <code>{{ p.key }}</code> · {{ p.origin }} · révision {{ p.revision }} · {{ p.type }}{{ p.unit ? ' · ' + p.unit : '' }} · module {{ p.module }}
                      </p>

                      @if (editKey() === p.key) {
                        <form class="adm-edit" (submit)="$event.preventDefault(); save(p)">
                          @switch (p.type) {
                            @case ('boolean') {
                              <label class="cfg-setting-check">
                                <input type="checkbox" [checked]="draftBool()" (change)="draftBool.set($any($event.target).checked)" />
                                <span>Valeur : {{ draftBool() ? 'vrai' : 'faux' }}</span>
                              </label>
                            }
                            @case ('list') {
                              <label>
                                <span>Valeur (JSON, liste)</span>
                                <textarea [value]="draft()" (input)="draft.set($any($event.target).value)" spellcheck="false" rows="10"></textarea>
                              </label>
                            }
                            @case ('object') {
                              <label>
                                <span>Valeur (JSON, objet)</span>
                                <textarea [value]="draft()" (input)="draft.set($any($event.target).value)" spellcheck="false" rows="18"></textarea>
                              </label>
                            }
                            @case ('text') {
                              <label>
                                <span>Valeur (texte)</span>
                                <input [value]="draft()" (input)="draft.set($any($event.target).value)" />
                              </label>
                            }
                            @default {
                              <label>
                                <span>Valeur ({{ p.type === 'integer' ? 'entier' : 'nombre' }})</span>
                                <input [value]="draft()" (input)="draft.set($any($event.target).value)" inputmode="decimal" />
                              </label>
                            }
                          }
                          <label>
                            <span>Note de modification (facultative)</span>
                            <input [value]="note()" (input)="note.set($any($event.target).value)" maxlength="300" />
                          </label>
                          @if (editError(); as e) {
                            <div class="cfg-error" role="alert">
                              <strong>{{ e.body.code }}</strong> — {{ e.message }}
                              @if (e.isConflict) {
                                <p>Le paramètre a été modifié entre-temps. Votre saisie est conservée ; relisez la version actuelle puis enregistrez de nouveau.</p>
                                <button type="button" class="btn btn-secondary" (click)="reloadParameters()">Relire la version actuelle</button>
                              }
                            </div>
                          }
                          <div class="cfg-actions">
                            <button class="btn btn-primary" type="submit" [disabled]="saving()">{{ saving() ? 'Enregistrement…' : 'Enregistrer' }}</button>
                            <button class="btn btn-secondary" type="button" (click)="cancelEdit()">Annuler</button>
                          </div>
                        </form>
                      } @else {
                        <div class="cfg-actions">
                          <button class="btn btn-secondary" type="button" (click)="startEdit(p)">Modifier</button>
                          @if (p.origin === 'administration') {
                            <button class="text-link" type="button" [disabled]="saving()" (click)="reset(p)">Revenir à la valeur livrée</button>
                          }
                        </div>
                        @if (resetError()?.key === p.key) {
                          <div class="cfg-error" role="alert">
                            <strong>{{ resetError()!.error.body.code }}</strong> — {{ resetError()!.error.message }}
                            @if (resetError()!.error.isConflict) {
                              <button type="button" class="btn btn-secondary" (click)="reloadParameters()">Relire la version actuelle</button>
                            }
                          </div>
                        }
                      }

                      @if (p.history.length) {
                        <details class="adm-history">
                          <summary>Historique ({{ p.history.length }})</summary>
                          <ol reversed>
                            @for (h of p.history.slice().reverse(); track h.revision) {
                              <li>
                                <strong>révision {{ h.revision }}</strong> · {{ h.at }}{{ h.note ? ' · ' + h.note : '' }}<br />
                                <code>{{ h.previous | json }}</code> → <code>{{ h.value | json }}</code>
                              </li>
                            }
                          </ol>
                        </details>
                      }
                    </article>
                  }
                </div>
              </section>
            } @empty {
              <p class="cfg-notice" role="status">Aucun paramètre (ou chargement en cours).</p>
            }
          }

          @case ('metrics') {
            <article class="cfg-panel" data-ui-pattern="panel" aria-labelledby="adm-metrics-title">
              <span class="cfg-number">Formules administrables</span>
              <h2 id="adm-metrics-title">Calculs des chiffres présentés</h2>
              <p>Chaque chiffre de l'application est une métrique dont la formule est un paramètre <code>metric.&lt;clé&gt;</code>.</p>
              <p>Consulter le catalogue, les références disponibles, éditer une formule avec aperçu sur les données du user actif.</p>
              <a class="btn btn-primary" routerLink="/admin/calculs">Ouvrir les calculs</a>
            </article>
          }

          @case ('journal') {
            <section class="cfg-panel" data-ui-pattern="panel" aria-labelledby="adm-journal-title">
              <span class="cfg-number">{{ journal().length }} écriture(s)</span>
              <h2 id="adm-journal-title">Journal des écritures</h2>
              <p>200 dernières écritures, de la plus récente à la plus ancienne. Chaque objet créé ou modifié est inspectable dans Object Management.</p>
              <div class="audit-table-wrap" role="region" tabindex="0" aria-label="Journal des écritures">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Horodatage</th>
                      <th scope="col">Commande</th>
                      <th scope="col">User</th>
                      <th scope="col">Clé de demande</th>
                      <th scope="col">Créés</th>
                      <th scope="col">Modifiés</th>
                      <th scope="col">Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (e of journal(); track $index) {
                      <tr>
                        <td class="nowrap"><time [attr.datetime]="e.at">{{ e.at }}</time></td>
                        <td><code>{{ e.command }}</code></td>
                        <td><strong>{{ userLabel(e.userId) }}</strong><small><code>{{ e.userId ?? '—' }}</code></small></td>
                        <td><code>{{ e.requestKey ?? '—' }}</code></td>
                        <td>@for (id of e.created; track id) { @if (isObjectId(id)) {<a class="block" [routerLink]="['/object-management']" [queryParams]="{ inspect: id }"><code>{{ id }}</code></a>} @else {<code class="block">{{ id }}</code>} } @empty {<span class="cfg-hint">—</span>}</td>
                        <td>@for (id of e.updated; track id) { @if (isObjectId(id)) {<a class="block" [routerLink]="['/object-management']" [queryParams]="{ inspect: id }"><code>{{ id }}</code></a>} @else {<code class="block">{{ id }}</code>} } @empty {<span class="cfg-hint">—</span>}</td>
                        <td>{{ e.outcome }}</td>
                      </tr>
                    } @empty {
                      <tr><td colspan="7">Aucune écriture.</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>
          }

          @case ('errors') {
            <section class="cfg-panel" data-ui-pattern="panel" aria-labelledby="adm-errors-title">
              <span class="cfg-number">{{ errors().length }} erreur(s)</span>
              <h2 id="adm-errors-title">Erreurs récentes</h2>
              <p>Échecs récents des commandes (non persistés, conservés en mémoire par l'API depuis son démarrage).</p>
              <div class="audit-table-wrap" role="region" tabindex="0" aria-label="Erreurs récentes">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Horodatage</th>
                      <th scope="col">Commande</th>
                      <th scope="col">User</th>
                      <th scope="col">Code</th>
                      <th scope="col">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (e of errors(); track $index) {
                      <tr>
                        <td class="nowrap"><time [attr.datetime]="e.at">{{ e.at }}</time></td>
                        <td><code>{{ e.command }}</code></td>
                        <td><strong>{{ userLabel(e.userId) }}</strong><small><code>{{ e.userId ?? '—' }}</code></small></td>
                        <td><span class="result r-failed">{{ e.code }}</span></td>
                        <td>{{ e.message }}</td>
                      </tr>
                    } @empty {
                      <tr><td colspan="5">Aucune erreur récente.</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>
          }
        }
      </section>
    </section>
  `,
})
export class AdminPage implements OnInit {
  private api = inject(Api);
  private directory = inject(UserDirectory);
  protected workspace = injectPageWorkspace();

  protected tabs: [Tab, string][] = [
    ['modules', 'Modules'],
    ['parameters', 'Paramètres'],
    ['metrics', 'Calculs'],
    ['journal', 'Journal'],
    ['errors', 'Erreurs récentes'],
  ];
  protected tab = signal<Tab>('modules');
  protected activeTab = computed<Tab>(() => {
    const key = this.workspace()?.key;
    return key === 'admin-parameters' ? 'parameters' : key === 'admin-journal' ? 'journal' : key === 'admin-errors' ? 'errors' : this.tab();
  });
  protected error = signal<string | null>(null);

  protected modules = signal<ModuleDescription[]>([]);
  protected parameters = signal<EffectiveParameter[]>([]);
  protected editingParameter = computed(() => this.parameters().find((p) => p.key === this.editKey()) ?? null);
  protected journal = signal<JournalEntry[]>([]);
  protected errors = signal<RecentError[]>([]);

  // édition d'un paramètre (un seul à la fois)
  protected editKey = signal<string | null>(null);
  protected draft = signal('');
  protected draftBool = signal(false);
  protected note = signal('');
  protected saving = signal(false);
  protected editError = signal<ApiError | null>(null);
  protected resetError = signal<{ key: string; error: ApiError } | null>(null);
  protected savedNote = signal<string | null>(null);

  protected modulesByLevel = computed(() => {
    const mods = this.modules();
    return ([0, 1, 2, 3] as const)
      .map((level) => {
        const list = mods.filter((m) => m.level === level);
        return { level, label: list[0]?.levelLabel ?? `Niveau ${level}`, modules: list };
      })
      .filter((l) => l.modules.length);
  });

  /** Pastilles du bandeau : volumes lus, rien de calculé hors de l'API. */
  protected heroChips = computed<HeroChip[]>(() => {
    if (!this.modules().length && !this.parameters().length) return [];
    return [
      { label: 'Modules', value: String(this.modules().length) },
      { label: 'Paramètres', value: String(this.parameters().length) },
      { label: 'Administrés', value: String(this.parameters().filter((p) => p.origin === 'administration').length) },
      { label: 'Journal', value: `${this.journal().length} écriture(s)` },
      { label: 'Erreurs récentes', value: String(this.errors().length) },
    ];
  });

  protected tabCount(t: Tab): string {
    switch (t) {
      case 'modules':
        return `${this.modules().length} module(s)`;
      case 'parameters':
        return `${this.parameters().length} paramètre(s)`;
      case 'metrics':
        return 'Formules metric.*';
      case 'journal':
        return `${this.journal().length} écriture(s)`;
      default:
        return `${this.errors().length} erreur(s)`;
    }
  }

  protected parameterGroups = computed(() => {
    const groups = new Map<string, EffectiveParameter[]>();
    for (const p of this.parameters()) {
      const list = groups.get(p.group) ?? [];
      list.push(p);
      groups.set(p.group, list);
    }
    return [...groups].map(([group, parameters]) => ({ group, parameters }));
  });

  ngOnInit() {
    this.load();
  }

  async load() {
    this.error.set(null);
    try {
      const [modules, parameters, journal, errors] = await Promise.all([
        this.api.adminModules(),
        this.api.adminParameters(),
        this.api.journal(200),
        this.api.recentErrors(),
      ]);
      this.modules.set(modules);
      this.parameters.set(parameters);
      this.journal.set(journal);
      this.errors.set(errors);
    } catch (err) {
      this.error.set(toApiError(err).message);
    }
  }

  async reloadParameters() {
    try {
      this.parameters.set(await this.api.adminParameters());
      this.editError.set(null);
      this.resetError.set(null);
    } catch (err) {
      this.error.set(toApiError(err).message);
    }
  }

  protected display(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }

  protected isObjectId(id: string) {
    return OBJECT_ID.test(id);
  }

  protected userLabel(id: string | null) {
    if (!id) return 'Anonyme';
    return this.directory.users().find((u) => u.id === id)?.label ?? '';
  }

  startEdit(p: EffectiveParameter) {
    this.savedNote.set(null);
    this.editKey.set(p.key);
    this.editError.set(null);
    this.resetError.set(null);
    this.note.set('');
    if (p.type === 'boolean') this.draftBool.set(p.value === true);
    else this.draft.set(p.type === 'list' || p.type === 'object' ? JSON.stringify(p.value, null, 2) : String(p.value ?? ''));
  }

  cancelEdit() {
    this.editKey.set(null);
    this.editError.set(null);
  }

  private invalid(message: string) {
    this.editError.set(new ApiError(400, { code: 'VALIDATION', action: null, message }));
  }

  /** Convertit la saisie selon le type déclaré ; contrôle local avant envoi (l'API revalide). */
  private parsed(p: EffectiveParameter): { ok: true; value: unknown } | { ok: false } {
    const raw = this.draft();
    switch (p.type) {
      case 'boolean':
        return { ok: true, value: this.draftBool() };
      case 'list': {
        let value: unknown;
        try {
          value = JSON.parse(raw);
        } catch (e) {
          this.invalid(`JSON invalide : ${(e as Error).message}`);
          return { ok: false };
        }
        if (!Array.isArray(value)) {
          this.invalid('Une liste JSON est attendue (commençant par « [ »).');
          return { ok: false };
        }
        return { ok: true, value };
      }
      case 'object': {
        let value: unknown;
        try {
          value = JSON.parse(raw);
        } catch (e) {
          this.invalid(`JSON invalide : ${(e as Error).message}`);
          return { ok: false };
        }
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          this.invalid('Un objet JSON est attendu (commençant par « { »).');
          return { ok: false };
        }
        return { ok: true, value };
      }
      case 'number':
      case 'integer': {
        const s = raw.trim().replace(',', '.');
        const n = Number(s);
        if (s === '' || !Number.isFinite(n)) {
          this.invalid('Un nombre est attendu.');
          return { ok: false };
        }
        if (p.type === 'integer' && !Number.isInteger(n)) {
          this.invalid('Un entier est attendu.');
          return { ok: false };
        }
        return { ok: true, value: n };
      }
      default:
        if (!raw.trim()) {
          this.invalid('Un texte non vide est attendu.');
          return { ok: false };
        }
        return { ok: true, value: raw };
    }
  }

  async save(p: EffectiveParameter) {
    this.savedNote.set(null);
    this.editError.set(null);
    const r = this.parsed(p);
    if (!r.ok) return;
    this.saving.set(true);
    try {
      const res = await this.api.setParameter(p.key, { value: r.value, expectedRevision: p.revision, note: this.note().trim() || undefined });
      this.replace(res.parameter);
      this.savedNote.set(`${p.label} enregistré, révision ${res.parameter.revision}.`);
      this.editKey.set(null);
      this.journal.set(await this.api.journal(200));
    } catch (err) {
      this.editError.set(toApiError(err));
    } finally {
      this.saving.set(false);
    }
  }

  async reset(p: EffectiveParameter) {
    this.savedNote.set(null);
    this.resetError.set(null);
    this.saving.set(true);
    try {
      const res = await this.api.resetParameter(p.key, p.revision);
      this.replace(res.parameter);
      this.savedNote.set(`${p.label} rétabli à sa valeur livrée.`);
      this.journal.set(await this.api.journal(200));
    } catch (err) {
      this.resetError.set({ key: p.key, error: toApiError(err) });
    } finally {
      this.saving.set(false);
    }
  }

  private replace(fresh: EffectiveParameter) {
    this.parameters.update((list) => list.map((x) => (x.key === fresh.key ? fresh : x)));
  }
}
