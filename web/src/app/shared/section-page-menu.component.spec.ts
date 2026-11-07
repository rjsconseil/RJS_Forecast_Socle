import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SectionPageMenu } from './section-page-menu.component';
import { locate } from './site-plan';

describe('navigation hiérarchique commune', () => {
  function setup(url: string) {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(SectionPageMenu);
    fixture.componentRef.setInput('section', locate(url).section!);
    fixture.componentRef.setInput('url', url);
    fixture.detectChanges();
    return fixture;
  }

  it('ouvre les enfants du parent actif et distingue le parent du détail consulté', () => {
    const fixture = setup('/tableau-de-bord/rapprochement?period=2026-10&q=loyer&entry=new');
    const dom = fixture.nativeElement as HTMLElement;
    expect(dom.querySelectorAll('.section-subpages')).toHaveLength(1);
    const active = dom.querySelector('.section-subpages [aria-current="page"]') as HTMLAnchorElement;
    expect(active.textContent).toContain('Rapprocher avec mon compte');
    expect(active.getAttribute('href')).toContain('period=2026-10');
    expect(active.getAttribute('href')).not.toContain('entry=');
    expect(dom.querySelector('.section-page-link.is-ancestor')?.getAttribute('aria-current')).toBeNull();
    expect(dom.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    const other = dom.querySelector('.section-page-link[href^="/vision"]') as HTMLAnchorElement;
    expect(other.getAttribute('href')).not.toContain('q=');
  });

  it('laisse développer les autres pages sans quitter la page courante', () => {
    const fixture = setup('/vision/projection');
    const dom = fixture.nativeElement as HTMLElement;
    const toggle = dom.querySelector('button[aria-label="Afficher les pages de Plafonds et catégories"]') as HTMLButtonElement;
    toggle.click(); fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const target = dom.querySelector('#' + toggle.getAttribute('aria-controls'))!;
    expect(target.textContent).toContain('Organiser les catégories');
    expect(dom.querySelector('[aria-current="page"]')?.textContent).toContain('Projection patrimoniale');
  });

  it('reste utilisable dans une section à une seule page et conserve le budget sélectionné', () => {
    const fixture = setup('/socle/budget/centres?budget=bud_a');
    const dom = fixture.nativeElement as HTMLElement;
    expect(dom.querySelector('.section-page-link')?.textContent).toContain('Budget (test)');
    expect(dom.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('/socle/budget/centres?budget=bud_a');
    expect(dom.querySelectorAll('.section-subpages a')).toHaveLength(2);
  });
});
