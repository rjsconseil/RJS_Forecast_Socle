import { computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { injectCurrentUrl, injectPlanContext } from './plan-context';
import { locate } from './site-plan';
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

/**
 * Le lien du bandeau vers le niveau supérieur (page principale ou fiche ouverte), nommé comme dans
 * le menu. Il suit le plan du site : stable après un accès direct ou un rechargement.
 */
export function injectWorkspaceReturn() {
  const plan = injectPlanContext();
  const url = injectCurrentUrl();
  const workspace = injectPageWorkspace();
  return computed(() => {
    // Hors du plan (adresse de démonstration), la vue spécialisée déclare encore sa page parente.
    const parent = workspace()?.parent;
    const up = plan().up ?? (parent ? { link: parent, label: locate(parent).page?.label ?? 'Page principale' } : null);
    if (!up) return null;
    return { link: up.link, query: workspaceContextQuery(url(), up.link), label: up.label, direct: true };
  });
}
