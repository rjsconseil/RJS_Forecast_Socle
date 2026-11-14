import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BpmPageFrame } from './page-frame';
import { BpmContextInfo } from '../../core/bpm-models';
import { By } from '@angular/platform-browser';
import { PageHeroDirective } from '../../shared/page-hero.directive';

@Component({
  imports: [BpmPageFrame],
  template: ` <bpm-page
    title="Test du cadre"
    lead="Présentation"
    [context]="context"
    [periodNav]="true"
    [focus]="{ title: 'Échéance à vérifier', detail: 'Loyer', tone: 'warning' }"
    [result]="{ message: 'Enregistrement vérifié', tone: 'success' }"
  >
    <button primary>Action prioritaire</button>
    <button actions (click)="count.set(count() + 1)">Pointer {{ count() }}</button>
    <label tools>Recherche<input value="Cuisine" /></label>
    <section>Contenu du parcours</section>
  </bpm-page>`,
})
class Host {
  count = signal(0);
  context = {
    user: { label: 'Profil A' },
    scope: 'principal',
    calculationDate: '2026-11-07',
    period: {
      key: '2026-10',
      start: '2026-10-01',
      endExclusive: '2026-11-01',
      label: 'Octobre 2026',
    },
    periods: { firstKey: '2026-08', currentKey: '2026-11' },
    budgets: [],
  } as unknown as BpmContextInfo;
}

describe('bandeau commun et coordination', () => {
  it('présente l’intention spécialisée et retourne au projet parent sans reprendre une commande ouverte', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([
      { path: 'app/gestion-projet/:id/budget', component: Host, data: { workspace: {
        key: 'project-budget', parent: '/app/gestion-projet', title: 'Budget du projet', lead: 'Attribuez les moyens.'
      } } },
    ])] });
    const h = await RouterTestingHarness.create('/app/gestion-projet/prj_42/budget?period=2026-10&q=travaux&entry=new&editTask=tsk_42');
    const banner = h.routeNativeElement!.querySelector('bpm-page-banner')!;
    // Une fiche garde son nom en titre ; la sous-page est l'onglet courant.
    expect(banner.querySelector('h1')?.textContent).toBe('Test du cadre');
    expect(banner.querySelector('.page-intro')?.textContent).toBe('Attribuez les moyens.');
    expect(banner.querySelector('.eyebrow')?.textContent).toBe('Mes projets de la vie · Projets et financement');
    const back = banner.querySelector('.bpm-banner-back') as HTMLAnchorElement;
    expect(back.getAttribute('href')).toBe('/app/gestion-projet/prj_42?period=2026-10&q=travaux');
    expect(back.textContent).toContain('Fiche du projet');
    const tabs = [...banner.querySelectorAll('.page-tab')] as HTMLAnchorElement[];
    expect(tabs.map(t => t.textContent?.trim())).toEqual(['Vue d’ensemble', 'Budget et décisions', 'Tâches']);
    expect(banner.querySelector('.page-tab[aria-current="page"]')?.textContent).toContain('Budget et décisions');
    expect(tabs[2].getAttribute('href')).toBe('/app/gestion-projet/prj_42/taches?period=2026-10&q=travaux');
  });
  it('projette actions et outils une seule fois et garde les saisies lors du repli', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'cadre', component: Host }])],
    });
    const h = await RouterTestingHarness.create('/cadre');
    const element = h.routeNativeElement!;
    const banner = element.querySelector('bpm-page-banner')!;
    expect(banner.querySelector('h1')?.textContent).toBe('Test du cadre');
    expect(banner.querySelector('.bpm-toolbar-focus')?.textContent).toContain(
      'Échéance à vérifier',
    );
    expect(banner.querySelector('[toolbarPrimary]')?.textContent).toContain('Action prioritaire');
    expect(banner.querySelector('.page-toolbar-result')?.textContent).toContain(
      'Enregistrement vérifié',
    );
    const action = banner.querySelector('[toolbarActions] button') as HTMLButtonElement;
    action.click();
    h.detectChanges();
    expect(action.textContent).toContain('Pointer 1');
    const field = banner.querySelector('input')!;
    field.value = 'Voyage';
    const toggle = banner.querySelector('.bpm-toolbar-toggle') as HTMLButtonElement;
    toggle.click();
    h.detectChanges();
    toggle.click();
    h.detectChanges();
    expect(banner.querySelectorAll('input').length).toBe(1);
    expect(banner.querySelector('input')!.value).toBe('Voyage');
    expect(element.querySelector('section')?.textContent).not.toContain('Contenu du parcours');
    expect(element.textContent).toContain('Contenu du parcours');
  });
  it('replie les outils par défaut et au défilement, sauf si une saisie y a le focus', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'cadre', component: Host }])],
    });
    const h = await RouterTestingHarness.create('/cadre');
    const tools = h.routeNativeElement!.querySelector('.bpm-toolbar-filters')!;
    expect(tools.hasAttribute('hidden')).toBe(true);
    (h.routeNativeElement!.querySelector('.bpm-toolbar-toggle') as HTMLButtonElement).click();
    h.detectChanges();
    const field = h.routeNativeElement!.querySelector('input')!;
    field.focus();
    const banner = h.routeDebugElement!.query(By.css('bpm-page-banner'));
    banner.injector.get(PageHeroDirective).compact.set(true);
    h.detectChanges();
    expect(tools.hasAttribute('hidden')).toBe(false);
    expect(field.value).toBe('Cuisine');
    field.blur();
    banner.injector.get(PageHeroDirective).compact.set(false);
    h.detectChanges();
    banner.injector.get(PageHeroDirective).compact.set(true);
    h.detectChanges();
    expect(tools.hasAttribute('hidden')).toBe(true);
  });
  it('change la période en conservant les filtres et retire le détail devenu hors contexte', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'cadre', component: Host }])],
    });
    const h = await RouterTestingHarness.create(
      '/cadre?q=Cuisine&status=late&entry=new&operation=op_1&ligne=op_2&initial=1000&current=800',
    );
    const previous = h.routeNativeElement!.querySelector(
      '.period-nav-previous',
    ) as HTMLAnchorElement;
    const query = new URL(previous.href).searchParams;
    expect(query.get('q')).toBe('Cuisine');
    expect(query.get('status')).toBe('late');
    expect(query.get('period')).toBe('2026-09');
    expect(query.has('entry')).toBe(false);
    expect(query.has('operation')).toBe(false);
    expect(query.has('ligne')).toBe(false);
    expect(query.has('initial')).toBe(false);
    expect(query.has('current')).toBe(false);
    expect(TestBed.inject(Router).url).toContain('entry=new');
  });
});
