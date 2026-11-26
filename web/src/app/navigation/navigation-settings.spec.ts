import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NavigationSettingsPage } from './navigation-settings.page';
import { NavigationSystem } from './navigation.service';
import { SITE_NAVIGATION } from '../plan/navigation-adapter';
import { NavigationConfiguration } from './navigation-model';
describe('atelier navigation BPM', () => {
  let page: NavigationSettingsPage;
  const original: NavigationConfiguration = {
    version: 1,
    scopes: {
      site: { labels: { '/': 'Accueil' } },
      'module:noyau': { styles: { primary: { page: { size: 18 } } } },
    },
    order: { 'zone:noyau': ['section:noyau:taches'] },
  };
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NavigationSettingsPage],
      providers: [
        {
          provide: NavigationSystem,
          useValue: {
            catalog: SITE_NAVIGATION,
            configuration: signal(structuredClone(original)),
            ready: signal(true),
            error: signal(''),
            save: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(NavigationSettingsPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  });
  it('ne propose que BPM et conserve les paramètres des autres zones', () => {
    expect(page.parts().map((p) => p.key)).toEqual(['zone:bpm-astra']);
    expect(page.scope()).toBe('module:bpm-astra');
    page.setStyle('section', 'size', 20);
    page.resetOrder();
    expect(page.draft().scopes['module:noyau']).toEqual(original.scopes['module:noyau']);
    expect(page.draft().order?.['zone:noyau']).toEqual(original.order?.['zone:noyau']);
  });
  it('permet annulation, héritage et validation avant sauvegarde', () => {
    page.setStyle('section', 'radius', 40);
    expect(page.validationErrors().length).toBe(1);
    page.undo();
    expect(page.validationErrors()).toEqual([]);
    expect(page.dirty()).toBe(false);
    page.setStyle('section', 'size', 20);
    page.setStyle('section', 'size', '');
    expect(page.style('section').size).toBeUndefined();
  });
  it('sépare les menus de contenu des onglets et présente les modifications', () => {
    page.chooseSurface('contents');
    page.preset('comfortable');
    expect(page.draft().scopes['module:bpm-astra'].styles?.contents?.content?.minHeight).toBe(44);
    expect(page.draft().scopes['module:bpm-astra'].styles?.secondary).toBeUndefined();
    expect(page.changeCount()).toBe(1);
    page.discard();
    expect(page.dirty()).toBe(false);
    expect(page.history()).toEqual([]);
  });
});
describe('protection du brouillon', () => {
  it('bloque la fermeture lorsqu’une modification reste à enregistrer', () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: NavigationSystem,
          useValue: {
            catalog: SITE_NAVIGATION,
            configuration: signal({ version: 1, scopes: {} }),
            ready: signal(true),
            error: signal(''),
          },
        },
      ],
    });
    const page = TestBed.runInInjectionContext(() => new NavigationSettingsPage());
    const clean = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    page.beforeUnload(clean);
    expect(clean.defaultPrevented).toBe(false);
    page.setLabel('/bpm-astra/mouvements', 'Budget');
    const dirty = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    page.beforeUnload(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    page.busy.set(true);
    page.setLabel('/bpm-astra/mouvements', 'Autre');
    expect(page.settings().labels?.['/bpm-astra/mouvements']).toBe('Budget');
  });
});
it('conserve les saisies de menu invalides pour les corriger avant enregistrement', () => {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: NavigationSystem,
        useValue: {
          catalog: SITE_NAVIGATION,
          configuration: signal({ version: 1, scopes: {} }),
          ready: signal(true),
          error: signal(''),
        },
      },
    ],
  });
  const page = TestBed.runInInjectionContext(() => new NavigationSettingsPage());
  page.setMenu('width', 500);
  expect(page.validationErrors().length).toBe(1);
  page.setMenu('width', 400);
  expect(page.validationErrors()).toEqual([]);
  page.chooseSurface('portal');
  expect(page.selectedLevel()).toBe('page');
});
it('sélectionne un élément puis réutilise son style sans modifier la source',()=>{
 TestBed.configureTestingModule({providers:[{provide:NavigationSystem,useValue:{catalog:SITE_NAVIGATION,configuration:signal({version:1,scopes:{}}),ready:signal(true),error:signal('')}}]});
 const page=TestBed.runInInjectionContext(()=>new NavigationSettingsPage());
 const root=SITE_NAVIGATION.tree.find(n=>n.key==='zone:bpm-astra')!;
 page.selectNode(root.children![0]);expect(page.selected().key).toBe(root.children![0].key);
 page.chooseSurface('primary');page.setStyle('section','size',18);page.copyStyle();
 page.chooseSurface('contents');page.pasteStyle();expect(page.style('content').size).toBe(18);
 page.resetSurface();expect(page.style('content').size).toBeUndefined();
 page.chooseSurface('primary');expect(page.style('section').size).toBe(18);
});
it('édite les relations dans le brouillon, régénère l’arbre et annule le déplacement', () => {
  TestBed.configureTestingModule({providers:[{provide:NavigationSystem,useValue:{
    catalog:SITE_NAVIGATION,configuration:signal({version:1,scopes:{}}),ready:signal(true),error:signal(''),
  }}]});
  const page=TestBed.runInInjectionContext(()=>new NavigationSettingsPage());
  const original=page.generated().nodes.get('/bpm-astra/mouvements')!.children.find(child=>child.kind==='subpage' && !child.key.endsWith('#main'))!;
  page.selectNode(original);
  page.setParent('/bpm-astra/plafonds');
  expect(page.selectedRelation().parent).toBe('/bpm-astra/plafonds');
  expect(page.generated().nodes.get('/bpm-astra/mouvements')!.children.some(child=>child.key===original.key)).toBe(false);
  expect(page.changes().some(change=>change.key==='relations')).toBe(true);
  expect(page.validationErrors()).toEqual([]);
  page.undo();
  expect(page.selectedRelation().parent).toBe('/bpm-astra/mouvements');
  expect(page.dirty()).toBe(false);
});
