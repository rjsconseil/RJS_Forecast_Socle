import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { AppHeroComponent } from './app-hero.component';
import { PageHeroDirective } from './page-hero.directive';

@Component({
  imports: [AppHeroComponent],
  template: `
    <rjs-app-hero
      title="Éditeur"
      kicker="Administration"
      headingId="editor-title"
      scope="Formule du solde · novembre"
      [focus]="{ title: 'Une formule à vérifier' }"
      [result]="{ message: 'Aperçu calculé', tone: 'success' }"
    >
      <button heroPrimary>Enregistrer</button>
      <button heroActions>Annuler</button>
      <label heroTools>Rechercher<input type="search" /></label>
      <nav heroPageTools><a href="#detail">Voir le détail</a></nav>
      <span heroMeta>Profil de test</span>
      <span heroFooter>Période novembre</span>
    </rjs-app-hero>
  `,
})
class HeroHost {}

describe('bandeau partagé de l’application', () => {
  it('projette les vraies commandes et le contexte dans la barre partagée sans ajouter un second bandeau fixe', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(HeroHost);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const dom = fixture.nativeElement as HTMLElement;
    expect(dom.querySelector('.bpm-toolbar-primary')?.textContent).toContain('Enregistrer');
    expect(dom.querySelector('.bpm-toolbar-actions')?.textContent).toContain('Annuler');
    expect(dom.querySelector('.bpm-toolbar-filters input[type="search"]')).not.toBeNull();
    expect(dom.querySelector('.bpm-toolbar-filters')?.textContent).toContain('Voir le détail');
    expect(dom.querySelector('.page-toolbar-scope')?.textContent).toContain('novembre');
    expect(dom.querySelector('.page-toolbar-result')?.textContent).toContain('Aperçu calculé');
    expect(dom.querySelectorAll('[data-sticky-hero]')).toHaveLength(1);
    const hero = fixture.debugElement.query(By.directive(AppHeroComponent));
    hero.injector.get(PageHeroDirective).compact.set(true);
    fixture.detectChanges();
    expect(hero.nativeElement.classList.contains('page-hero-compact')).toBe(true);
    expect(dom.querySelector('.app-hero-footer')?.textContent).toContain('Période novembre');
  });
});
