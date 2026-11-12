export type NavigationSurface = 'primary' | 'secondary' | 'tertiary' | 'portal';
export type NavigationLevel = 'section' | 'page' | 'detail';
export interface NavigationStyle { size?: number; spacing?: number; color?: string; background?: string; activeColor?: string; activeBackground?: string }
export interface NavigationSettings {
  labels?: Record<string, string>;
  styles?: Partial<Record<NavigationSurface, Partial<Record<NavigationLevel, NavigationStyle>>>>;
}
export interface NavigationConfiguration { version: 1; scopes: Record<string, NavigationSettings> }
export interface NavigationContext { module?: string; page: string }
export interface NavigationEntry { key: string; label: string; link: string; module: string; level: NavigationLevel }
export function scopeChain(context: NavigationContext): string[] {
  return ['site', ...(context.module ? ['module:' + context.module] : []), 'page:' + context.page];
}
export function effectiveStyle(config: NavigationConfiguration, context: NavigationContext, surface: NavigationSurface, level: NavigationLevel): NavigationStyle {
  return Object.assign({}, ...scopeChain(context).map(key => config.scopes[key]?.styles?.[surface]?.[level] ?? {}));
}
export function effectiveLabel(config: NavigationConfiguration, context: NavigationContext, key: string, fallback: string): string {
  return scopeChain(context).reduce((label, scope) => config.scopes[scope]?.labels?.[key] ?? label, fallback);
}
