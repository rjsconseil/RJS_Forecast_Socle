import { describe, it, expect } from 'vitest';
import { SITE_NAVIGATION } from '../plan/navigation-adapter';
import {
  generateNavigation,
  navigationDestination,
  navigationAncestors,
} from './navigation-generator';
import { NavigationConfiguration } from './navigation-model';
import { staticNavigationPreview } from './navigation-static-preview';
import { NAVIGATION_PREVIEW_SCRIPT, NAVIGATION_PREVIEW_SCRIPT_HASH } from './navigation-preview-script';

const source = SITE_NAVIGATION.tree.find((node) => node.key === 'zone:bpm-astra')!;
const defaults: NavigationConfiguration = { version: 1, scopes: {} };
describe('génération de la navigation BPM', () => {
  it('reconstruit le catalogue existant et résout les accueils successifs', () => {
    const graph = generateNavigation(source, defaults);
    expect(graph.errors).toEqual([]);
    expect(navigationDestination(graph, '/bpm-astra/mouvements').key).toBe('/bpm-astra/mouvements#main');
    expect(graph.nodes.get('/bpm-astra/mouvements')!.children[0].key).toBe('/bpm-astra/mouvements#main');
  });
  it('suit l’ordre réglé pour l’accueil d’une partie, et un choix explicite l’emporte en simulation', () => {
    const configuration: NavigationConfiguration = { ...defaults, order: { 'section:bpm-astra:astra-0': ['/bpm-astra/mouvements', '/bpm-astra/plafonds', '/bpm-astra'] } };
    expect(navigationDestination(generateNavigation(source, configuration), 'section:bpm-astra:astra-0').key).toBe('/bpm-astra/mouvements#main');
    configuration.relations = { 'zone:bpm-astra': { 'section:bpm-astra:astra-0': { home: '/bpm-astra/calendrier' } } };
    expect(navigationDestination(generateNavigation(source, configuration), 'section:bpm-astra:astra-0').key).toBe('/bpm-astra/calendrier#main');
  });
  it('déplace une sous-page avec ses sections puis régénère les parents et les menus', () => {
    const initial = generateNavigation(source, defaults);
    const subpage = initial.nodes
      .get('/bpm-astra/mouvements')!
      .children.find(
        (node) =>
          node.kind === 'subpage' && !node.key.endsWith('#main') && node.children.some((child) => child.kind === 'content'),
      )!;
    expect(subpage).toBeDefined();
    const config: NavigationConfiguration = {
      ...defaults,
      relations: {
        'zone:bpm-astra': {
          [subpage.key]: { parent: '/bpm-astra/plafonds', surfaces: ['secondary'] },
          '/bpm-astra/plafonds': { home: subpage.key },
        },
      },
    };
    const graph = generateNavigation(source, config);
    expect(graph.errors).toEqual([]);
    expect(
      graph.nodes.get('/bpm-astra/mouvements')!.children.some((child) => child.key === subpage.key),
    ).toBe(false);
    expect(navigationDestination(graph, '/bpm-astra/plafonds').key).toBe(subpage.key);
    expect(navigationAncestors(graph, subpage.children[0].key).map((node) => node.key)).toContain(
      '/bpm-astra/plafonds',
    );
    const html = staticNavigationPreview(config, '/bpm-astra/plafonds', {
      focus: false,
      density: 'comfortable',
      visualStyle: 'classic',
      touchTargets: false,
    });
    expect(html).toContain('data-key=');
    expect(html).not.toContain('src="/');
    expect(source.children).toEqual(
      SITE_NAVIGATION.tree.find((node) => node.key === 'zone:bpm-astra')!.children,
    );
  });
  it('signale les relations inconnues, les niveaux incompatibles et les accueils hors parent', () => {
    const config: NavigationConfiguration = {
      ...defaults,
      relations: {
        'zone:bpm-astra': {
          '/bpm-astra/mouvements': { parent: '/bpm-astra/plafonds', home: '/bpm-astra/plafonds' },
          '/inconnu': { parent: 'zone:bpm-astra' },
        },
      },
    };
    expect(generateNavigation(source, config).errors).toHaveLength(3);
    expect(() =>
      staticNavigationPreview(config, '/', {
        focus: false,
        density: 'compact',
        visualStyle: 'classic',
        touchTargets: false,
      }),
    ).toThrow();
  });
});

describe('document statique régénéré', () => {
  it('navigue avec le nouveau parent et conserve les menus et ancres', async () => {
    const initial = generateNavigation(source, defaults);
    const moved = initial.nodes
      .get('/bpm-astra/mouvements')!
      .children.find((node) => node.children.some((child) => child.kind === 'content'))!;
    const config: NavigationConfiguration = {
      version: 1,
      scopes: {},
      relations: {
        'zone:bpm-astra': {
          [moved.key]: { parent: '/bpm-astra/plafonds' },
          '/bpm-astra/plafonds': { home: moved.key },
        },
      },
    };
    const html = staticNavigationPreview(config, '/bpm-astra/plafonds', {
      focus: false,
      density: 'comfortable',
      visualStyle: 'classic',
      touchTargets: false,
    });
    const document = new DOMParser().parseFromString(html, 'text/html');
    HTMLElement.prototype.scrollIntoView = () => {};
    const script = document.querySelector('script:not([type])')!.textContent!;
    new Function('document', 'window', script)(document, { scrollTo() {} });

    expect(document.querySelector('h1')?.textContent).toBe(initial.nodes.get('/bpm-astra/plafonds')!.label);
    expect(document.querySelector('.current-title')?.textContent).toBe(moved.label);
    const anchor = moved.children.find((child) => child.kind === 'content')!;
    const button = [...document.querySelectorAll<HTMLAnchorElement>('a[data-key]')].find(
      (button) => button.dataset['key'] === anchor.key,
    )!;
    expect(button).toBeDefined();
    button.click();
    expect(document.getElementById(anchor.key)).not.toBeNull();
    expect(document.querySelector('.current-title')?.textContent).toBe(anchor.label);
    expect(document.querySelectorAll('iframe,script[src],link[href]')).toHaveLength(0);
  });
});

it('charge les feuilles réelles et expose les classes et variables de navigation communes', () => {
  const html = staticNavigationPreview({
    version:1,scopes:{'module:bpm-astra':{styles:{secondary:{detail:{size:18,hoverColor:'#123456'}}}}},
  }, '/bpm-astra/mouvements', {
    focus:false,density:'compact',visualStyle:'editorial',touchTargets:true,
  }, ['http://localhost:4300/styles-ABC.css','http://localhost:4300/styles-rest-DEF.css']);
  const document = new DOMParser().parseFromString(html,'text/html');
  expect([...document.querySelectorAll('link[rel="stylesheet"]')].map(link=>link.getAttribute('href'))).toEqual([
    'http://localhost:4300/styles-ABC.css','http://localhost:4300/styles-rest-DEF.css',
  ]);
  new Function('document','window',document.querySelector('script:not([type])')!.textContent!)(document,{scrollTo(){}});
  const shell=document.querySelector('.app-shell')!;
  expect(shell.classList.contains('editorial-style')).toBe(true);
  expect(shell.getAttribute('data-density')).toBe('compact');
  expect(document.querySelector('.sidebar .section-switch-entry')).not.toBeNull();
  expect(document.querySelector('.section-subpages a[data-navigation-level="detail"]')).not.toBeNull();
  const tab=document.querySelector<HTMLElement>('.page-tab[data-navigation-size], .page-tab[data-navigation-detail-size]')!;
  expect(tab.style.getPropertyValue('--navigation-detail-size')).toBe('18px');
  expect(tab.hasAttribute('data-navigation-detail-hoverColor')).toBe(true);
  expect(document.querySelectorAll('iframe,script[src]')).toHaveLength(0);
});

describe('script de l’aperçu sous la CSP du site', () => {
  it('a l’empreinte déclarée dans navigation-preview-csp.json, et le document n’autorise que lui', async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(NAVIGATION_PREVIEW_SCRIPT));
    const hash = 'sha256-' + btoa(String.fromCharCode(...new Uint8Array(digest)));
    // En cas d'échec : recopier cette valeur dans navigation-preview-csp.json (lu par scripts/site-server.mjs).
    expect(NAVIGATION_PREVIEW_SCRIPT_HASH).toBe(hash);
    const html = staticNavigationPreview(defaults, '/bpm-astra/plafonds', {
      focus: false, density: 'comfortable', visualStyle: 'classic', touchTargets: false,
    });
    const document = new DOMParser().parseFromString(html, 'text/html');
    const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content')!;
    expect(csp).toContain(`script-src '${hash}'`);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect([...document.querySelectorAll('script:not([type])')].map((s) => s.textContent)).toEqual([NAVIGATION_PREVIEW_SCRIPT]);
  });
});
