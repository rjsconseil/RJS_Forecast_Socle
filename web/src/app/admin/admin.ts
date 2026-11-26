import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CalendarSettingsEditorComponent } from '../calendar/calendar-settings-editor.component';
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
  imports: [RouterLink, JsonPipe, AppHeroComponent, CalendarSettingsEditorComponent],
  // Gabarits de la source : Configuration (cartes, réglages, pastilles de modules) et Journal d'activité (tableaux).
  styleUrls: ['./configuration.page.scss', './audit-admin.page.scss', './admin-pages.scss'],
  templateUrl: './admin.html',
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
    return (key === 'admin-parameters' || key === 'admin-calendars') ? 'parameters' : key === 'admin-journal' ? 'journal' : key === 'admin-errors' ? 'errors' : this.tab();
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
    if (this.workspace()?.key === 'admin-calendars') return [
      { label: 'Instances', value: String(this.parameters().filter(p => p.module === 'calendar').length) },
      { label: 'Composant', value: 'Calendrier partagé' },
    ];
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
    const parameters = this.workspace()?.key === 'admin-calendars'
      ? this.parameters().filter(p => p.module === 'calendar').sort((a,b) => Number(b.key === 'calendrier.budgetPatrimoine') - Number(a.key === 'calendrier.budgetPatrimoine'))
      : this.parameters();
    for (const p of parameters) {
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
