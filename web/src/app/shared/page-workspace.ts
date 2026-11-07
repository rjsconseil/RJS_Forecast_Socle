import { computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';

/** Une vue spécialisée décrit son intention ; les modules conservent leurs lectures et commandes. */
export interface PageWorkspace {
  key: string;
  parent: string;
  title: string;
  lead: string;
}

export function injectPageWorkspace() {
  const route = inject(ActivatedRoute);
  const data = toSignal(route.data ?? of(route.snapshot?.data ?? {}), { initialValue: route.snapshot?.data ?? {} });
  return computed(() => (data()['workspace'] as PageWorkspace | undefined) ?? null);
}

/** Seul le contexte de lecture accompagne un changement de vue, jamais une commande ouverte. */
export function workspaceContextQuery(url: string, parent = ''): Record<string, string> {
  const query = new URLSearchParams(url.split('?')[1]?.split('#')[0] ?? '');
  const keys = new Set(['period', 'lifePeriod']);
  if (parent) for (const key of [
    'q', 'query', 'attention', 'project', 'filter', 'status', 'type', 'sort', 'mode', 'show',
    'scope', 'kind', 'inspect', 'budget', 'budgetId', 'profileQuery', 'userType',
    'jour', 'vue', 'group', 'calGroup', 'calDone', 'calHidden', 'from', 'to', 'start', 'end', 'target',
  ]) keys.add(key);
  return Object.fromEntries([...query.entries()].filter(([key]) => keys.has(key)));
}

/** Le retour hiérarchique reste stable même après un accès direct ou un rechargement. */
export function injectWorkspaceReturn() {
  const workspace = injectPageWorkspace();
  const route = inject(ActivatedRoute);
  const router = inject(Router);
  const params = toSignal(route.paramMap ?? of(route.snapshot?.paramMap), { initialValue: route.snapshot?.paramMap });
  const query = toSignal(route.queryParams ?? of(route.snapshot?.queryParams ?? {}), { initialValue: route.snapshot?.queryParams ?? {} });
  return computed(() => {
    const current = workspace();
    query();
    if (!current) return null;
    const id = params()?.get('id');
    const parent = current.key.startsWith('project-') && ['project-budget', 'project-tasks'].includes(current.key) && id
      ? `/app/gestion-projet/${encodeURIComponent(id)}` : current.parent;
    return { link: parent, query: workspaceContextQuery(router.url, current.parent), label: 'Retour à la page principale', direct: true };
  });
}
