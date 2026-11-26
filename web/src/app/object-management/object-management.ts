import { Component, computed, effect, ElementRef, HostListener, inject, OnInit, signal, untracked, viewChild } from '@angular/core';
import { NgTemplateOutlet, JsonPipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { AppHeroComponent, HeroChip } from '../shared/app-hero.component';
import { Api, OmCheck, OmDebug, OmInventoryRow, OmKind, OmRelation, toApiError, UserDirectory } from '../core/api.service';
import { injectPageWorkspace } from '../plan/page-workspace';

type Tab = 'inventory' | 'architecture' | 'relations' | 'views' | 'parameters' | 'checks' | 'receipts' | 'journal' | 'exports';

/** Identifiant d'objet persisté (préfixe_uuid). */
const OBJECT_ID = /^[a-z]{2,4}_[0-9a-f]{8}-[0-9a-f-]+$/;

interface Inspection {
  object: Record<string, unknown> & { id: string };
  nature: { kind: string; label: string; module: string; domain: string; level: number; levelLabel: string };
  outgoing: OmRelation[];
  incoming: OmRelation[];
  creationRequest: { requestKey: string; command: string; completedAt: string; createdObjects: { kind: string; id: string }[] } | null;
  journal: { at: string; command: string; userId: string | null; requestKey: string | null; created: string[]; updated: string[]; outcome: string }[];
  extras: [string, unknown][];
}

const INSPECTION_KEYS = new Set(['object', 'nature', 'outgoing', 'incoming', 'creationRequest', 'journal']);

@Component({
  selector: 'app-object-management',
  imports: [JsonPipe, NgTemplateOutlet, RouterLink, AppHeroComponent],
  // Gabarits de la source : Configuration (cartes, pastilles de modules, héritage) et Journal d'activité (tableaux, filtres).
  styleUrls: ['../admin/configuration.page.scss', '../admin/audit-admin.page.scss', '../admin/admin-pages.scss'],
  templateUrl: './object-management.html',
})
export class ObjectManagement implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private directory = inject(UserDirectory);
  protected workspace = injectPageWorkspace();
  private closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');

  protected users = this.directory.users;
  protected tabs: [Tab, string][] = [
    ['inventory', 'Inventaire'],
    ['architecture', 'Architecture'],
    ['relations', 'Relations'],
    ['views', 'Vues des modules'],
    ['parameters', 'Paramètres'],
    ['checks', 'Contrôles'],
    ['receipts', 'Reçus de création'],
    ['journal', 'Journal'],
    ['exports', 'Exports'],
  ];
  protected categoryLabel: Record<string, string> = {
    integrity: 'intégrité',
    pathway: 'parcours métier',
    'not-implemented': 'non implémenté',
  };

  protected tab = signal<Tab>('inventory');
  /** Les longues listes s'affichent par tranches ; chaque liste garde sa propre limite. */
  protected readonly pageSize = 100;
  private readonly limits = signal<Record<string, number>>({});
  protected shown = (key: string) => this.limits()[key] ?? this.pageSize;
  protected page<T>(list: readonly T[], key: string): readonly T[] {
    const limit = this.shown(key);
    return list.length > limit ? list.slice(0, limit) : list;
  }
  protected showMore(key: string, upTo?: number) {
    this.limits.update((limits) => ({ ...limits, [key]: upTo ?? this.shown(key) + this.pageSize }));
  }
  protected activeTab = computed<Tab>(() => {
    const key = this.workspace()?.key;
    return key === 'objects-relations' ? 'relations' : key === 'objects-checks' ? 'checks' : key === 'objects-journal' ? 'journal' : this.tab();
  });
  protected scope = signal(this.route.snapshot.queryParamMap.get('scope') ?? 'all');
  protected q = signal(this.route.snapshot.queryParamMap.get('q') ?? '');
  protected kind = signal(this.route.snapshot.queryParamMap.get('kind') ?? '');
  protected dbg = signal<OmDebug | null>(null);
  protected kinds = signal<OmKind[]>([]);
  protected csvFiles = signal<string[]>([]);
  protected inventory = signal<OmInventoryRow[]>([]);
  protected error = signal<string | null>(null);

  /** Objet inspecté : porté par le paramètre d'URL `inspect` (lien profond, retour arrière). */
  protected inspectId = toSignal(this.route.queryParamMap.pipe(map((p) => p.get('inspect'))), { initialValue: null });
  protected inspected = signal<Inspection | null>(null);
  protected inspectError = signal<string | null>(null);

  protected checkSummary = computed(() => {
    const checks = this.dbg()?.checks ?? [];
    const n = (r: string) => checks.filter((c) => c.result === r).length;
    return { passed: n('passed'), failed: n('failed'), warning: n('warning'), notRun: n('not-run') };
  });

  /** Pastilles du bandeau : identité de l'instantané lu et bilan des contrôles. */
  protected heroChips = computed<HeroChip[]>(() => {
    const d = this.dbg();
    if (!d) return [];
    const c = this.checkSummary();
    return [
      { label: 'Instantané', value: d.snapshotId },
      { label: 'Stockage', value: `révision ${d.storeRevision}` },
      { label: 'Schéma', value: d.schemaVersion },
      { label: 'Périmètre', value: d.scope },
      { label: 'Généré', value: d.generatedAt },
      { label: 'Contrôles', value: `${c.passed} réussis · ${c.failed} échoués · ${c.warning} écarts · ${c.notRun} non exécutés` },
    ];
  });

  protected tabCount(t: Tab): string {
    const d = this.dbg();
    switch (t) {
      case 'inventory':
        return `${this.inventory().length} objet(s)`;
      case 'architecture':
        return `${d?.modules.length ?? 0} module(s) · ${this.kinds().length} nature(s)`;
      case 'relations':
        return `${d?.relations.length ?? 0} relation(s)`;
      case 'views':
        return `${this.views().length} vue(s)`;
      case 'parameters':
        return `${d?.parameters.length ?? 0} paramètre(s)`;
      case 'checks':
        return `${d?.checks.length ?? 0} contrôle(s)`;
      case 'receipts':
        return `${d?.creationReceipts.length ?? 0} demande(s)`;
      case 'journal':
        return `${d?.journal.length ?? 0} écriture(s)`;
      default:
        return `${this.csvFiles().length + 1} fichier(s)`;
    }
  }

  protected modulesByLevel = computed(() => {
    const mods = this.dbg()?.modules ?? [];
    return [0, 1, 2, 3]
      .map((level) => {
        const list = mods.filter((m) => m.level === level);
        return { level, label: list[0]?.levelLabel ?? `Niveau ${level}`, modules: list };
      })
      .filter((l) => l.modules.length);
  });

  protected views = computed(() =>
    Object.entries(this.dbg()?.views ?? {}).map(([name, rows]) => {
      const columns: string[] = [];
      for (const r of rows) for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k);
      return { name, rows, columns };
    }),
  );

  protected checksByModule = computed(() => {
    const groups = new Map<string, OmCheck[]>();
    for (const c of this.dbg()?.checks ?? []) groups.set(c.module, [...(groups.get(c.module) ?? []), c]);
    return [...groups].map(([module, checks]) => ({ module, checks }));
  });

  protected journalDesc = computed(() => [...(this.dbg()?.journal ?? [])].reverse());

  constructor() {
    effect(() => {
      const id = this.inspectId();
      untracked(() => (id ? this.loadInspection(id) : this.inspected.set(null)));
    });
  }

  ngOnInit() {
    this.load();
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.inspectId()) this.closeInspect();
  }

  setScope(s: string) {
    this.scope.set(s);
    this.load();
  }

  async load() {
    this.error.set(null);
    try {
      const [dbg, kinds, csv] = await Promise.all([this.api.omDebug(this.scope()), this.api.omKinds(), this.api.omCsvFiles()]);
      this.dbg.set(dbg);
      this.kinds.set(kinds);
      this.csvFiles.set(csv);
      await this.loadInventory();
      if (this.inspectId()) await this.loadInspection(this.inspectId()!);
    } catch (err) {
      this.error.set(toApiError(err).message);
    }
  }

  async loadInventory() {
    try {
      const query = this.route.snapshot.queryParamMap;
      if ((query.get('scope') ?? 'all') !== this.scope() || (query.get('q') ?? '') !== this.q() || (query.get('kind') ?? '') !== this.kind()) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { scope: this.scope() === 'all' ? null : this.scope(), q: this.q() || null, kind: this.kind() || null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
      this.inventory.set(await this.api.omObjects({ q: this.q(), kind: this.kind(), scope: this.scope() }));
    } catch (err) {
      this.error.set(toApiError(err).message);
    }
  }

  openInspect(id: string) {
    this.router.navigate([], { relativeTo: this.route, queryParams: { inspect: id }, queryParamsHandling: 'merge' });
  }

  closeInspect() {
    this.router.navigate([], { relativeTo: this.route, queryParams: { inspect: null }, queryParamsHandling: 'merge' });
  }

  private async loadInspection(id: string) {
    this.inspectError.set(null);
    this.inspected.set(null);
    try {
      const raw = await this.api.omObject(id);
      if (this.inspectId() !== id) return;
      const extras = Object.entries(raw).filter(([k]) => !INSPECTION_KEYS.has(k));
      this.inspected.set({ ...(raw as unknown as Omit<Inspection, 'extras'>), extras });
      setTimeout(() => this.closeBtn()?.nativeElement.focus());
    } catch (err) {
      this.inspectError.set(toApiError(err).message);
    }
  }

  protected refsOf(k: OmKind) {
    return Object.entries(k.references ?? {}).map(([field, r]) => ({ field, kinds: ([] as string[]).concat(r.kind).join(' | '), required: !!r.required }));
  }

  protected userLabel(id: string) {
    return this.directory.users().find((u) => u.id === id)?.label ?? '';
  }

  protected isId(v: unknown): boolean {
    return typeof v === 'string' && OBJECT_ID.test(v);
  }

  protected cell(v: unknown): string {
    if (v === null || v === undefined) return v === null ? 'null' : '';
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  protected short(v: unknown): string {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 140 ? s.slice(0, 140) + '…' : s;
  }

  protected csvHref(file: string) {
    return this.api.omCsvHref(file, this.scope());
  }

  /** Télécharge l'export de débogage du périmètre courant (relu à l'instant du clic). */
  async downloadJson() {
    try {
      const dbg = await this.api.omDebug(this.scope());
      const blob = new Blob([JSON.stringify(dbg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `socle-debug-${dbg.snapshotId}-${dbg.scope}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      this.error.set(toApiError(err).message);
    }
  }
}
