import { applyPageTexts } from '../shared/page-text';
import { Injectable, effect, inject } from '@angular/core';
import {
  ConfigurationResponse,
  ConfigurationStore,
  DesignRule,
  DesignToken,
} from './configuration.store';
import { applySiteSettings } from '../shared/site-settings';

export function validDesignValue(token: DesignToken, value: string): boolean {
  if (typeof value !== 'string') return false;
  if (token.type === 'color') return /^#[0-9a-fA-F]{6}$/.test(value);
  if (token.type === 'choice') return !!token.options?.some((option) => option.value === value);
  if (token.type === 'number')
    return (
      /^\d+(?:\.\d{1,4})?$/.test(value) &&
      Number(value) >= token.min! &&
      Number(value) <= token.max!
    );
  if (token.allowNone && value === 'none') return true;
  // Pixels entiers ; les unités relatives (rem, em, vw…) admettent quatre décimales.
  const unit = token.unit ?? 'px';
  const digits = unit === 'px' ? '\\d{1,4}' : '\\d{1,4}(?:\\.\\d{1,4})?';
  const match = new RegExp(`^(${digits})${unit}$`).exec(value);
  return !!match && Number(match[1]) >= token.min! && Number(match[1]) <= token.max!;
}

/** Le catalogue partagé nomme les seules cibles et propriétés autorisées. */
export function buildDesignCss(
  rules: DesignRule[],
  { patterns, modules }: ConfigurationResponse['catalog'],
  root = '.app-shell',
): string {
  const order = { site: 0, module: 1, space: 2 };
  return rules
    .filter((rule) => rule.scope === 'site' || rule.scope === 'module' || rule.scope === 'space')
    .sort(
      (a, b) =>
        order[a.scope] - order[b.scope] ||
        patterns.findIndex((item) => item.id === a.pattern) -
          patterns.findIndex((item) => item.id === b.pattern),
    )
    .map((rule) => {
      const pattern = patterns.find((item) => item.id === rule.pattern);
      if (!pattern) return '';
      const module = modules.find((item) => item.id === rule.module);
      if (rule.scope !== 'site' && !module) return '';
      if (rule.scope === 'space' && !module?.spaces.includes(rule.space ?? '')) return '';
      const base = `${root}[data-module][data-space]${
        rule.scope === 'site' ? '' : `[data-module="${module!.id}"]`
      }${rule.scope === 'space' ? `[data-space="${rule.space}"]` : ''}`;
      const declarations = Object.entries(rule.values).flatMap(([name, value]) => {
        const token = pattern.tokens.find((item) => item.name === name);
        if (!token || !validDesignValue(token, value)) return [];
        const cssValue =
          token.type === 'choice'
            ? token.options!.find((item) => item.value === value)!.css
            : value;
        return [{ name, css: `${name}: ${cssValue};` }];
      });
      return declarations.length
        ? pattern.targets
            .map(({ selector, bindings }) => {
              const properties = declarations.flatMap(({ name }) =>
                bindings?.[name]
                  ? [bindings[name]].flat().map((property) => `${property}: var(${name});`)
                  : [],
              );
              return `${base}${selector} { ${declarations
                .map(({ css }) => css)
                .concat(properties)
                .join(' ')} }`;
            })
            .join('\n')
        : '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Résolution CSS native : seules les propriétés du catalogue validé sont
 * écrites. La cascade site → module → espace reste inspectable dans DevTools.
 * Pas de CSS libre, de feuille par page ni de copie de styles métier.
 */
@Injectable({ providedIn: 'root' })
export class DesignRuntimeService {
  private readonly store = inject(ConfigurationStore);
  private readonly styleId = 'rjs-configuration-design';

  constructor() {
    // Les valeurs livrées sont dans la feuille générée `styles/_contrat.scss` ;
    // seules les règles de portée enregistrées s'ajoutent ici.
    effect(() => this.render(this.store.workspace()?.design.rules ?? []));
    // Les écarts de réglages enregistrés rejoignent la boîte à outils commune ;
    // noyau et modules les lisent par leur clé, sans connaître Configuration.
    effect(() => applyPageTexts(this.store.workspace()?.content));
    // Returning from the C2M editor refreshes effective content without reloading user forms.
    window.addEventListener('focus', () => { if (!this.store.saving() && !location.pathname.startsWith('/configuration')) void this.store.reload(); });
    effect(() => applySiteSettings(this.store.workspace()?.settings));
  }

  load(): Promise<boolean> {
    return this.store.load();
  }

  private render(rules: DesignRule[]): void {
    this.style(this.styleId).textContent = buildDesignCss(rules, this.store.catalog());
  }

  private style(id: string): HTMLStyleElement {
    let style = document.getElementById(id) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = id;
      document.head.append(style);
    }
    return style;
  }
}
