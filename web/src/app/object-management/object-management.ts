import { Component, computed, effect, ElementRef, HostListener, inject, OnInit, signal, untracked, viewChild } from '@angular/core';
import { JsonPipe } from '@angular/common';
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
  imports: [JsonPipe, RouterLink, AppHeroComponent],
  // Gabarits de la source : Configuration (cartes, pastilles de modules, héritage) et Journal d'activité (tableaux, filtres).
  styleUrls: ['../admin/configuration.page.scss', '../admin/audit-admin.page.scss', '../admin/admin-pages.scss'],
  template: `
    <section class="page cfg-page" data-ui-pattern="page" aria-labelledby="om-title">
      <rjs-app-hero
        data-sticky-hero
        tone="indigo"
        headingId="om-title"
        [title]="workspace()?.title ?? 'Object Management'"
        kicker="Noyau transverse · Object Management"
        [lead]="workspace()?.lead ?? 'Diagnostic en lecture seule des objets persistés des trois niveaux. Aucune lecture ne modifie ni ne répare.'"
        [chips]="heroChips()"
      >
        <label heroTools class="adm-hero-field"
          >Périmètre
          <select [value]="scope()" (change)="setScope($any($event.target).value)">
            <option value="all">Tous les users</option>
            @for (u of users(); track u.id) {
              <option [value]="u.id" [selected]="u.id === scope()">{{ u.label }} · {{ u.id.slice(0, 12) }}…</option>
            }
          </select>
        </label>
        <button heroActions type="button" class="app-hero-action" (click)="load()">Relire</button>
        <a heroActions class="app-hero-action is-secondary" routerLink="/admin">Administration →</a>
      </rjs-app-hero>

      @if (error()) {
        <p class="cfg-error" role="alert">{{ error() }}</p>
      }

      @if (dbg(); as d) {
        @if (!workspace()) {
        <div class="cfg-modules" role="tablist" aria-label="Vues d'Object Management">
          @for (t of tabs; track t[0]) {
            <button
              type="button"
              role="tab"
              class="cfg-module-chip"
              [id]="'om-tab-' + t[0]"
              [attr.aria-controls]="'om-panel-' + t[0]"
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

        <section class="adm-panel-stack" [attr.role]="workspace() ? 'region' : 'tabpanel'" [id]="'om-panel-' + activeTab()" [attr.aria-labelledby]="workspace() ? 'om-title' : 'om-tab-' + activeTab()">
          @switch (activeTab()) {
            @case ('inventory') {
              <section class="cfg-panel" data-ui-pattern="panel" aria-labelledby="om-inventory-title">
                <span class="cfg-number">Périmètre {{ d.scope }}</span>
                <h2 id="om-inventory-title">Inventaire des objets</h2>
                <div class="audit-filters">
                  <label for="om-search"
                    >Rechercher
                    <input id="om-search" type="search" placeholder="Rechercher un ID ou un libellé…" [value]="q()" (input)="q.set($any($event.target).value); loadInventory()" />
                  </label>
                  <label for="om-kind"
                    >Nature
                    <select id="om-kind" [value]="kind()" (change)="kind.set($any($event.target).value); loadInventory()">
                      <option value="">Toutes natures</option>
                      @for (k of kinds(); track k.kind) {
                        <option [value]="k.kind">N{{ k.level }} · {{ k.label }} ({{ k.prefix }})</option>
                      }
                    </select>
                  </label>
                  @if (q() || kind()) {
                    <button class="btn btn-secondary filter-reset" type="button" (click)="q.set(''); kind.set(''); loadInventory()">Effacer les filtres</button>
                  }
                </div>
                <p class="filter-summary cfg-hint" role="status">{{ inventory().length }} objet(s)</p>
                <div class="audit-table-wrap" role="region" tabindex="0" aria-label="Inventaire des objets">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Niveau</th>
                        <th scope="col">Nature</th>
                        <th scope="col">Libellé</th>
                        <th scope="col">ID</th>
                        <th scope="col">Module</th>
                        <th scope="col">User</th>
                        <th scope="col">Rév.</th>
                        <th scope="col">Commande source</th>
                        <th scope="col">Contrôle</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (o of inventory(); track o.id) {
                        <tr class="is-clickable" [class.is-selected]="inspectId() === o.id" (click)="openInspect(o.id)">
                          <td><span class="adm-level adm-level-{{ o.level }}" [title]="o.levelLabel">N{{ o.level }}</span></td>
                          <td><strong>{{ o.kindLabel }}</strong><small>{{ o.kind }}</small></td>
                          <td>{{ o.label ?? '—' }}</td>
                          <td><button type="button" class="adm-id" (click)="$event.stopPropagation(); openInspect(o.id)" [attr.aria-label]="'Inspecter ' + o.id"><code>{{ o.id }}</code></button></td>
                          <td>{{ o.module }}</td>
                          <td><strong>{{ userLabel(o.userId) }}</strong><small><code>{{ o.userId }}</code></small></td>
                          <td>{{ o.revision }}</td>
                          <td><code>{{ o.source ?? '—' }}</code></td>
                          <td><span class="result r-{{ o.control }}">{{ o.control }}</span></td>
                        </tr>
                      } @empty {
                        <tr><td colspan="9">Aucun objet.</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            }

            @case ('architecture') {
              <p class="cfg-hint">Modules par niveau (0 transverse, 1 noyau, 2 middleware, 3 application) et natures d'objets déclarées avec leurs références contrôlées.</p>
              @for (lvl of modulesByLevel(); track lvl.level) {
                <section class="cfg-panel" data-ui-pattern="panel" [attr.aria-labelledby]="'om-level-' + lvl.level">
                  <span class="cfg-number"><span class="adm-level adm-level-{{ lvl.level }}">N{{ lvl.level }}</span> · {{ lvl.modules.length }} module(s)</span>
                  <h2 [id]="'om-level-' + lvl.level">{{ lvl.label }}</h2>
                  <div class="audit-table-wrap" role="region" tabindex="0" [attr.aria-label]="'Modules — ' + lvl.label">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Module</th>
                          <th scope="col">Dépend de</th>
                          <th scope="col">Natures</th>
                          <th scope="col">Paramètres</th>
                          <th scope="col">Variables</th>
                          <th scope="col">Métriques</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (m of lvl.modules; track m.id) {
                          <tr>
                            <td><strong>{{ m.label }}</strong><small><code>{{ m.id }}</code></small></td>
                            <td>{{ m.dependsOn.join(', ') || '—' }}</td>
                            <td>{{ m.kinds.join(', ') || '—' }}</td>
                            <td>{{ m.parameters }}</td>
                            <td>{{ m.variables }}</td>
                            <td>{{ m.metrics }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </section>
              }
              <section class="cfg-panel" data-ui-pattern="panel" aria-labelledby="om-kinds-title">
                <span class="cfg-number">{{ kinds().length }} nature(s)</span>
                <h2 id="om-kinds-title">Natures d'objets</h2>
                <div class="audit-table-wrap" role="region" tabindex="0" aria-label="Natures d'objets">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Niveau</th>
                        <th scope="col">Nature</th>
                        <th scope="col">Préfixe</th>
                        <th scope="col">Module</th>
                        <th scope="col">Domaine</th>
                        <th scope="col">Références déclarées</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (k of kinds(); track k.kind) {
                        <tr>
                          <td><span class="adm-level adm-level-{{ k.level }}">N{{ k.level }}</span></td>
                          <td><strong>{{ k.label }}</strong><small><code>{{ k.kind }}</code></small></td>
                          <td><code>{{ k.prefix }}_</code></td>
                          <td>{{ k.module }}</td>
                          <td>{{ k.domain }}</td>
                          <td>
                            @for (r of refsOf(k); track r.field) {
                              <code class="block">{{ r.field }} → {{ r.kinds }}{{ r.required ? ' (obligatoire)' : '' }}</code>
                            } @empty {
                              <span class="cfg-hint">—</span>
                            }
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            }

            @case ('relations') {
              <section class="cfg-panel" data-ui-pattern="panel" aria-labelledby="om-relations-title">
                <span class="cfg-number">{{ d.relations.length }} relation(s)</span>
                <h2 id="om-relations-title">Relations</h2>
                <p>Relations enregistrées (références déclarées) et relations dérivées par les modules (signalées « dérivée »).</p>
                <div class="audit-table-wrap" role="region" tabindex="0" aria-label="Relations">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Source</th>
                        <th scope="col">Relation</th>
                        <th scope="col">Cible</th>
                        <th scope="col">User</th>
                        <th scope="col">Nature</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (r of d.relations; track $index) {
                        <tr>
                          <td><small>{{ r.sourceKind }}</small><button type="button" class="adm-id" (click)="openInspect(r.sourceId)"><code>{{ r.sourceId }}</code></button></td>
                          <td><code>{{ r.relation }}</code></td>
                          <td><small>{{ r.targetKind }}</small><button type="button" class="adm-id" (click)="openInspect(r.targetId)"><code>{{ r.targetId }}</code></button></td>
                          <td><code>{{ r.userId }}</code></td>
                          <td>@if (r.derived) {<span class="adm-derived">dérivée</span>} @else {enregistrée}</td>
                        </tr>
                      } @empty {
                        <tr><td colspan="5">Aucune relation.</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            }

            @case ('views') {
              <p class="cfg-hint">Vues contribuées par les modules, calculées depuis le même instantané.</p>
              @for (v of views(); track v.name; let vi = $index) {
                <section class="cfg-panel" data-ui-pattern="panel" [attr.aria-labelledby]="'om-view-' + vi">
                  <span class="cfg-number">{{ v.rows.length }} ligne(s)</span>
                  <h2 [id]="'om-view-' + vi">{{ v.name }}</h2>
                  @if (v.rows.length) {
                    <div class="audit-table-wrap" role="region" tabindex="0" [attr.aria-label]="'Vue ' + v.name">
                      <table>
                        <thead><tr>@for (c of v.columns; track c) {<th scope="col">{{ c }}</th>}</tr></thead>
                        <tbody>
                          @for (row of v.rows; track $index) {
                            <tr>
                              @for (c of v.columns; track c) {
                                <td class="adm-cell">
                                  @if (isId(row[c])) {
                                    <button type="button" class="adm-id" (click)="openInspect($any(row[c]))"><code>{{ row[c] }}</code></button>
                                  } @else {
                                    {{ cell(row[c]) }}
                                  }
                                </td>
                              }
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  } @else {
                    <p class="cfg-hint">Vue vide pour ce périmètre.</p>
                  }
                </section>
              }
            }

            @case ('parameters') {
              <section class="cfg-panel" data-ui-pattern="panel" aria-labelledby="om-parameters-title">
                <span class="cfg-number">{{ d.parameters.length }} paramètre(s)</span>
                <h2 id="om-parameters-title">Paramètres effectifs</h2>
                <p>Paramètres effectifs (y compris les formules <code>metric.*</code>). Modification : <a routerLink="/admin">Administration</a>.</p>
                <div class="audit-table-wrap" role="region" tabindex="0" aria-label="Paramètres effectifs">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Clé</th>
                        <th scope="col">Origine</th>
                        <th scope="col">Révision</th>
                        <th scope="col">Valeur</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (p of d.parameters; track p.key) {
                        <tr>
                          <td><code>{{ p.key }}</code><small>{{ p.label }}</small></td>
                          <td>{{ p.origin }}</td>
                          <td>{{ p.revision }}</td>
                          <td class="adm-cell"><code>{{ short(p.value) }}</code></td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            }

            @case ('checks') {
              <section class="cfg-panel" data-ui-pattern="panel" aria-labelledby="om-checks-title">
                <span class="cfg-number">{{ d.checks.length }} contrôle(s)</span>
                <h2 id="om-checks-title">Contrôles</h2>
                <p>Intégrité technique, écart de parcours métier et règle non implémentée sont distingués ; « not-run » n'est jamais compté comme réussi.</p>
                <div class="audit-stats">
                  <div><strong class="result r-passed">{{ checkSummary().passed }}</strong><span>réussis</span></div>
                  <div><strong class="result r-failed">{{ checkSummary().failed }}</strong><span>échoués</span></div>
                  <div><strong class="result r-warning">{{ checkSummary().warning }}</strong><span>écarts</span></div>
                  <div><strong class="result r-not-run">{{ checkSummary().notRun }}</strong><span>non exécutés</span></div>
                </div>
              </section>
              @for (g of checksByModule(); track g.module; let ci = $index) {
                <section class="cfg-panel" data-ui-pattern="panel" [attr.aria-labelledby]="'om-checks-' + ci">
                  <span class="cfg-number">{{ g.checks.length }} règle(s)</span>
                  <h2 [id]="'om-checks-' + ci">{{ g.module }}</h2>
                  <div class="audit-table-wrap" role="region" tabindex="0" [attr.aria-label]="'Contrôles — ' + g.module">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Règle</th>
                          <th scope="col">Catégorie</th>
                          <th scope="col">Contrôle</th>
                          <th scope="col">Attendu</th>
                          <th scope="col">Observé</th>
                          <th scope="col">Résultat</th>
                          <th scope="col">Objets</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (c of g.checks; track $index) {
                          <tr>
                            <td><code>{{ c.rule }}</code></td>
                            <td>{{ categoryLabel[c.category] ?? c.category }}</td>
                            <td>{{ c.description }}</td>
                            <td>{{ c.expected }}</td>
                            <td>{{ c.observed }}</td>
                            <td><span class="result r-{{ c.result }}">{{ c.result }}</span></td>
                            <td>
                              @for (id of c.ids; track $index) {
                                @if (isId(id)) {
                                  <button type="button" class="adm-id block" (click)="openInspect(id)"><code>{{ id }}</code></button>
                                } @else {
                                  <code class="block">{{ id }}</code>
                                }
                              } @empty {
                                <span class="cfg-hint">—</span>
                              }
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </section>
              }
            }

            @case ('receipts') {
              <section class="cfg-panel" data-ui-pattern="panel" aria-labelledby="om-receipts-title">
                <span class="cfg-number">{{ d.creationReceipts.length }} demande(s)</span>
                <h2 id="om-receipts-title">Reçus de création</h2>
                <div class="audit-table-wrap" role="region" tabindex="0" aria-label="Reçus de création">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Clé de demande</th>
                        <th scope="col">Commande</th>
                        <th scope="col">User</th>
                        <th scope="col">Terminée le</th>
                        <th scope="col">Objets créés</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (r of d.creationReceipts; track r.requestKey) {
                        <tr>
                          <td><code>{{ r.requestKey }}</code></td>
                          <td><code>{{ r.command }}</code></td>
                          <td><code>{{ r.userId }}</code></td>
                          <td class="nowrap"><time [attr.datetime]="r.completedAt">{{ r.completedAt }}</time></td>
                          <td>
                            @for (o of r.createdObjects; track o.id) {
                              <span class="block">{{ o.kind }} <button type="button" class="adm-id" (click)="openInspect(o.id)"><code>{{ o.id }}</code></button></span>
                            }
                          </td>
                        </tr>
                      } @empty {
                        <tr><td colspan="5">Aucune demande de création.</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            }

            @case ('journal') {
              <section class="cfg-panel" data-ui-pattern="panel" aria-labelledby="om-journal-title">
                <span class="cfg-number">{{ journalDesc().length }} écriture(s)</span>
                <h2 id="om-journal-title">Journal</h2>
                <div class="audit-table-wrap" role="region" tabindex="0" aria-label="Journal">
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
                      @for (e of journalDesc(); track $index) {
                        <tr>
                          <td class="nowrap"><time [attr.datetime]="e.at">{{ e.at }}</time></td>
                          <td><code>{{ e.command }}</code></td>
                          <td><code>{{ e.userId ?? '—' }}</code></td>
                          <td><code>{{ e.requestKey ?? '—' }}</code></td>
                          <td>@for (id of e.created; track id) { @if (isId(id)) {<button type="button" class="adm-id block" (click)="openInspect(id)"><code>{{ id }}</code></button>} @else {<code class="block">{{ id }}</code>} }</td>
                          <td>@for (id of e.updated; track id) { @if (isId(id)) {<button type="button" class="adm-id block" (click)="openInspect(id)"><code>{{ id }}</code></button>} @else {<code class="block">{{ id }}</code>} }</td>
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

            @case ('exports') {
              <section class="cfg-panel" data-ui-pattern="panel" aria-labelledby="om-exports-title">
                <span class="cfg-number">Instantané {{ d.snapshotId }}</span>
                <h2 id="om-exports-title">Exports</h2>
                <p>Exports générés depuis l'instantané courant du périmètre <code>{{ scope() }}</code> (chaque fichier porte <code>snapshotId</code>, version de schéma et périmètre).</p>
                <div class="cfg-actions">
                  <button class="btn btn-primary" type="button" (click)="downloadJson()">socle-debug.json</button>
                  @for (f of csvFiles(); track f) {
                    <a class="btn btn-secondary" [href]="csvHref(f)" download>{{ f }}</a>
                  }
                </div>
              </section>
            }
          }
        </section>
      } @else if (!error()) {
        <p class="cfg-notice" role="status">Chargement…</p>
      }
    </section>

    @if (inspectId()) {
      <aside class="adm-drawer" role="dialog" aria-modal="false" aria-labelledby="om-inspect-title">
        <div class="adm-drawer-head">
          <div>
            <span class="cfg-number">Inspection</span>
            <h2 id="om-inspect-title">{{ inspected()?.nature?.label ?? 'Objet' }}</h2>
            <code>{{ inspectId() }}</code>
          </div>
          <button #closeBtn class="btn btn-secondary" type="button" (click)="closeInspect()" aria-label="Fermer l'inspection (Échap)">Fermer</button>
        </div>
        <div class="adm-drawer-body">
          @if (inspectError()) {
            <p class="cfg-error" role="alert">{{ inspectError() }}</p>
          } @else if (inspected(); as i) {
            <div class="cfg-inheritance">
              <dl>
                <div><dt>Nature</dt><dd>{{ i.nature.label }} <small><code>{{ i.nature.kind }}</code></small></dd></div>
                <div><dt>Niveau</dt><dd><span class="adm-level adm-level-{{ i.nature.level }}">N{{ i.nature.level }}</span> {{ i.nature.levelLabel }}</dd></div>
                <div><dt>Module</dt><dd>{{ i.nature.module }}</dd></div>
                <div><dt>Domaine</dt><dd>{{ i.nature.domain }}</dd></div>
              </dl>
            </div>

            <h3>Objet</h3>
            <pre class="adm-value">{{ i.object | json }}</pre>

            <h3>Relations sortantes ({{ i.outgoing.length }})</h3>
            <ul class="adm-refs">
              @for (r of i.outgoing; track $index) {
                <li><code>{{ r.relation }}</code> → {{ r.targetKind }} <button type="button" class="adm-id" (click)="openInspect(r.targetId)"><code>{{ r.targetId }}</code></button>@if (r.derived) {<span class="adm-derived">dérivée</span>}</li>
              } @empty {
                <li class="cfg-hint">Aucune.</li>
              }
            </ul>

            <h3>Relations entrantes ({{ i.incoming.length }})</h3>
            <ul class="adm-refs">
              @for (r of i.incoming; track $index) {
                <li>{{ r.sourceKind }} <button type="button" class="adm-id" (click)="openInspect(r.sourceId)"><code>{{ r.sourceId }}</code></button> · <code>{{ r.relation }}</code>@if (r.derived) {<span class="adm-derived">dérivée</span>}</li>
              } @empty {
                <li class="cfg-hint">Aucune.</li>
              }
            </ul>

            <h3>Demande de création</h3>
            @if (i.creationRequest; as cr) {
              <p class="cfg-hint"><code>{{ cr.command }}</code> · clé <code>{{ cr.requestKey }}</code> · {{ cr.completedAt }}</p>
              <ul class="adm-refs">
                @for (o of cr.createdObjects; track o.id) {
                  <li>{{ o.kind }} <button type="button" class="adm-id" (click)="openInspect(o.id)"><code>{{ o.id }}</code></button></li>
                }
              </ul>
            } @else {
              <p class="cfg-hint">Aucune demande de création associée.</p>
            }

            <h3>Journal ({{ i.journal.length }})</h3>
            <ul class="adm-refs">
              @for (e of i.journal; track $index) {
                <li>{{ e.at }} · <code>{{ e.command }}</code> · {{ e.outcome }}{{ e.requestKey ? ' · ' + e.requestKey : '' }}</li>
              } @empty {
                <li class="cfg-hint">Aucune écriture.</li>
              }
            </ul>

            @for (x of i.extras; track x[0]) {
              <h3>{{ x[0] }}</h3>
              <pre class="adm-value">{{ x[1] | json }}</pre>
            }
          } @else {
            <p class="cfg-notice" role="status">Chargement…</p>
          }
        </div>
      </aside>
    }
  `,
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
