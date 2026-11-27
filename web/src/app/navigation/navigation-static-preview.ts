import { defaultApplicationId } from '../platform/applications';
import { PAGE_TABS_STYLES } from '../plan/page-tabs.styles';
import { locate } from '../plan/site-plan';
import {
  NavigationConfiguration,
  NavigationSurface,
  effectiveContentMenu,
  effectiveLabel,
  effectiveStyle,
} from './navigation-model';
import {
  generateNavigation,
  GeneratedNavigationNode,
  navigationAncestors,
  navigationDestination,
} from './navigation-generator';
import { SITE_NAVIGATION } from '../plan/navigation-adapter';
import { NAVIGATION_PREVIEW_SCRIPT, NAVIGATION_PREVIEW_SCRIPT_HASH } from './navigation-preview-script';

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );

/** Le rendu consomme uniquement le graphe généré. Aucun composant ou service métier n’est démarré. */
export function staticNavigationPreview(
  config: NavigationConfiguration,
  path: string,
  appearance: { focus: boolean; density: string; visualStyle: string; touchTargets: boolean },
  stylesheets: string[] = [],
  fontStyles = '',
  /** Nonce de la page (CSP du site) : le cadre `srcdoc` hérite de sa CSP, qui n'accepte une balise `<style>` qu'avec lui. */
  nonce = '',
): string {
  const source = SITE_NAVIGATION.tree.find((node) => node.key === ('zone:' + defaultApplicationId()))!;
  const graph = generateNavigation(source, config);
  if (graph.errors.length) throw new Error(graph.errors.join('\n'));
  const screens: Record<string, string> = {};
  const destinations: Record<string, string> = {};

  for (const node of graph.nodes.values()) {
    destinations[node.key] = navigationDestination(graph, node.key).key;
  }
  for (const current of graph.nodes.values()) {
    const ancestors = navigationAncestors(graph, current.key);
    const section = ancestors.find((node) => node.kind === 'section');
    const page = [...ancestors]
      .reverse()
      .find((node) => node.kind === 'page' || node.kind === 'auxiliary');
    const subpage = [...ancestors].reverse().find((node) => node.kind === 'subpage') ?? current;
    const context = { module: defaultApplicationId(), page: subpage.link?.split(/[?#]/)[0] ?? page?.link ?? '' };
    const label = (node: GeneratedNavigationNode) =>
      escape(effectiveLabel(config, context, node.key, node.label));
    const link = (node: GeneratedNavigationNode, surface: NavigationSurface) => {
      const style = effectiveStyle(config, context, surface, node.level);
      const pixels = new Set([
        'size',
        'spacing',
        'radius',
        'horizontalPadding',
        'minHeight',
        'borderWidth',
        'letterSpacing',
      ]);
      const properties = Object.entries(style).filter(([, value]) => value !== undefined);
      const declarations = properties
        .map(
          ([key, value]) =>
            '--navigation-' + node.level + '-' + key + ':' + value + (pixels.has(key) ? 'px' : ''),
        )
        .join(';');
      const attributes = properties
        .map(([key]) => 'data-navigation-' + node.level + '-' + key)
        .join(' ');
      const active = ancestors.some((ancestor) => ancestor.key === node.key);
      const classes =
        surface === 'secondary'
          ? 'page-tab'
          : surface === 'contents' || surface === 'actions'
            ? 'page-tab-link'
            : surface === 'primary'
              ? node.kind === 'section'
                ? 'section-switch-entry'
                : node.kind === 'page'
                  ? 'section-page-link'
                  : 'section-subpage-link'
              : surface === 'portal'
                ? 'plan-entry'
                : 'topbar-current';
      const text =
        surface === 'primary' && node.kind === 'section'
          ? '<span class="section-mark" aria-hidden="true">' +
            label(node).slice(0, 1) +
            '</span><span class="section-switch-text"><strong>' +
            label(node) +
            '</strong></span>'
          : surface === 'primary' && node.kind === 'page'
            ? '<span class="nav-icon" aria-hidden="true">›</span><span class="section-page-text">' +
              label(node) +
              '</span>'
            : label(node);
      return (
        '<a href="#' +
        encodeURIComponent(node.key) +
        '" style="' +
        escape(declarations) +
        '" data-key="' +
        escape(node.key) +
        '" data-navigation-level="' +
        node.level +
        '" data-navigation-surface="' +
        surface +
        '" ' +
        attributes +
        ' class="navigation-system ' +
        classes +
        (active ? ' active is-current' : '') +
        '"' +
        (active ? ' aria-current="page"' : '') +
        '>' +
        text +
        '</a>'
      );
    };
    const list = (nodes: GeneratedNavigationNode[], surface: NavigationSurface) =>
      nodes
        .filter((node) => node.surfaces.includes(surface))
        .map((node) => link(node, surface))
        .join('');
    const menu = effectiveContentMenu(config, context);
    const tabs = (page?.children ?? [])
      .filter((node) => node.surfaces.includes('secondary'))
      .map((tab) => {
        const isHome = page?.home === tab.key;
        const children = tab.children.filter(
          (child) => child.surfaces.includes('actions') || child.surfaces.includes('contents'),
        );
        return (
          '<div class="tab page-tab-group">' +
          link(tab, 'secondary') +
          (children.length
            ? '<button class="more page-tab-more" aria-expanded="false" aria-label="Afficher le menu de ' +
              label(tab) +
              '">⌄</button>' +
              '<div class="submenu page-tab-menu" data-delay="' +
              menu.closeDelay +
              '" data-trigger="' +
              (isHome ? 'click' : menu.trigger) +
              '" style="width:' +
              menu.width +
              'px">' +
              children
                .map((child) => link(child, child.kind === 'action' ? 'actions' : 'contents'))
                .join('') +
              '</div>'
            : '') +
          '</div>'
        );
      })
      .join('');
    const primaryPages = (section?.children ?? [])
      .map((node) => {
        const children = node.children.filter((child) => child.surfaces.includes('primary'));
        return (
          '<div class="section-page-group"><div class="section-page-row">' +
          (node.surfaces.includes('primary') ? link(node, 'primary') : '') +
          '</div>' +
          (children.length
            ? '<ul class="section-subpages">' +
              children.map((child) => '<li>' + link(child, 'primary') + '</li>').join('') +
              '</ul>'
            : '') +
          '</div>'
        );
      })
      .join('');
    const contents = subpage.children.filter((node) => node.kind === 'content');
    const body = contents.length
      ? contents
          .map(
            (node) =>
              '<section class="card" id="' +
              escape(node.key) +
              '"><h2>' +
              label(node) +
              '</h2><p>Contenu de démonstration pour cette section.</p></section>',
          )
          .join('')
      : '<section class="card"><h2>' +
        (current.kind === 'action' ? 'Formulaire de démonstration' : 'Vue d’ensemble') +
        '</h2><p>Les informations métier sont illustratives dans cette simulation.</p>' +
        (current.kind === 'action'
          ? '<label>Valeur<input disabled placeholder="Saisie désactivée"></label><button disabled>Valider</button>'
          : '<div class="facts"><div><small>Prévu</small><strong>3 200 €</strong></div><div><small>Réalisé</small><strong>2 480 €</strong></div><div><small>Disponible</small><strong>720 €</strong></div></div>') +
        '</section>';
    const identity = locate(page?.link ?? path);
    const sectionIdentity = locate(section?.link ?? path).section;
    screens[current.key] =
      '<div class="app-shell simulation-shell ' +
      (appearance.visualStyle === 'editorial' ? 'editorial-style ' : '') +
      (appearance.focus ? 'is-focus' : '') +
      '" data-density="' +
      appearance.density +
      '" data-module="' +
      escape(identity.zone?.module ?? defaultApplicationId()) +
      '" data-space="' +
      escape(identity.page?.space ?? sectionIdentity?.space ?? 'bpm-parcours') +
      '" data-section-tone="' +
      escape(sectionIdentity?.tone ?? 'nav-iris') +
      '" data-page-tone="' +
      escape(identity.page?.tone ?? 'nav-blue') +
      '" ' +
      (appearance.touchTargets ? 'data-simulation-touch' : '') +
      '><aside class="sidebar"><strong class="brand">RJS Forecast</strong><div class="nav-label">BPM</div><nav class="section-switch" aria-label="Sections">' +
      list(graph.root.children, 'primary') +
      '</nav><hr><nav class="section-pages" aria-label="Pages">' +
      primaryPages +
      '</nav></aside><div class="main-shell"><main class="simulation-content"><nav class="topbar-context" aria-label="Fil d’Ariane">' +
      ancestors
        .filter((node) => node.surfaces.includes('tertiary'))
        .map((node) => link(node, 'tertiary'))
        .join('<span>›</span>') +
      '</nav><div class="simulation-hero"><small>' +
      (section ? label(section) : 'BPM') +
      '</small><h1>' +
      label(page ?? current) +
      '</h1><div class="rjs-page-tabs"><nav class="page-tabs" aria-label="Sous-pages">' +
      tabs +
      '</nav></div></div><h2 class="current-title">' +
      label(current) +
      '</h2><nav class="cards" aria-label="Accès directs">' +
      list(current.children.length ? current.children : (section?.children ?? []), 'portal') +
      '</nav>' +
      body +
      '</main></div></div>';
  }
  const initial = graph.nodes.has(path) ? path : graph.root.key;
  const data = JSON.stringify({ screens, destinations, initial: destinations[initial] }).replace(
    /</g,
    '\\u003c',
  );
  const origins = [...new Set(stylesheets.map((href) => new URL(href).origin))].join(' ');
  const stylesheetLinks = stylesheets
    .map((href) => '<link rel="stylesheet" href="' + escape(href) + '">')
    .join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${escape(origins)}; font-src data: ${escape(origins)}; img-src data: ${escape(origins)}; script-src '${NAVIGATION_PREVIEW_SCRIPT_HASH}'; connect-src 'none'; form-action 'none'">${stylesheetLinks}<style${nonce ? ' nonce="' + escape(nonce) + '"' : ''}>
${fontStyles}
${PAGE_TABS_STYLES.replaceAll(':host', '.rjs-page-tabs')}
body{margin:0}
.simulation-toolbar{display:flex;align-items:center;gap:20px;padding:12px 24px;border-bottom:1px solid var(--line);background:var(--raised-surface);color:var(--ink)}
.simulation-toolbar button{font:inherit;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--raised-surface);color:var(--ink);cursor:pointer}
.simulation-shell .simulation-content{padding:28px}
.simulation-hero,.simulation-content .card{padding:24px;border:1px solid var(--line);border-radius:14px;background:var(--raised-surface)}
.simulation-hero{margin-top:20px}
.simulation-hero h1{margin:12px 0 20px}
.simulation-content .card{margin-top:20px;min-height:240px;scroll-margin-top:20px}
.simulation-content .current-title{margin-top:24px}
.simulation-content .facts{display:flex;gap:32px;flex-wrap:wrap}
.simulation-content .facts strong{display:block;font-size:26px;margin-top:12px}
.simulation-shell .topbar-context{flex-wrap:wrap}
.simulation-shell .submenu{display:none;position:absolute;top:100%;left:0;inset-inline-end:auto;z-index:20}
.simulation-shell .tab.open>.submenu{display:grid}
.simulation-shell .page-tabs{overflow:visible}
.simulation-content .cards{display:flex;flex-wrap:wrap;gap:12px}
.simulation-content :disabled{opacity:.45;cursor:not-allowed}
.mobile{display:none}
@media(max-width:820px){
 .simulation-shell.app-shell{display:block}
 .simulation-shell .sidebar{display:none}
 .mobile{display:block}
 body.menu .simulation-shell .sidebar{display:flex;height:auto;position:relative}
 .simulation-shell .simulation-content{padding:16px}
 .simulation-shell .submenu{position:fixed;top:30%;left:8%;max-width:84vw}
 .simulation-shell .page-tabs{flex-wrap:wrap}
}
</style></head><body><header class="simulation-toolbar"><button class="mobile" id="menu">☰ Menu</button><button id="back">← Retour</button><span>Simulation statique · données de démonstration</span></header><div id="screen"></div><script type="application/json" id="preview-data">${data}</script><script>${NAVIGATION_PREVIEW_SCRIPT}</script></body></html>`;
}
