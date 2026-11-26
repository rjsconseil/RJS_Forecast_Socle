import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PAGE_TOOLBAR_SLOT, PageToolbar, PageToolbarParts } from './page-toolbar.component';

/**
 * Contrat des emplacements déclarés : la barre de commandes d'un écran remet au cadre de l'application (Astra)
 * son action principale, ses autres actions et ses filtres par emplacement, sans que le cadre cherche des classes
 * dans l'écran. Le cadre range ce qu'il reçoit ; à la sortie de l'écran, la barre le libère.
 */
@Component({
  imports: [PageToolbar],
  template: `
    <rjs-page-toolbar label="Outils de la page">
      <button toolbarPrimary>Saisir une dépense</button>
      <a toolbarActions href="/projets">Projets</a>
      <label toolbarFilters>Rechercher<input type="search" /></label>
    </rjs-page-toolbar>
  `,
})
class ToolbarHost {}

describe('barre de commandes : emplacements déclarés', () => {
  it('remet au cadre l’action principale, les autres actions et les filtres, puis les libère', async () => {
    const claims: PageToolbarParts[] = [];
    let released = 0;
    TestBed.configureTestingModule({
      providers: [{ provide: PAGE_TOOLBAR_SLOT, useValue: { claim: (parts: PageToolbarParts) => (claims.push(parts), () => released++) } }],
    });
    const fixture = TestBed.createComponent(ToolbarHost);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(claims.length).toBe(1);
    const [parts] = claims;
    expect(parts.primary.textContent).toContain('Saisir une dépense');
    expect(parts.actions.querySelector('a[href="/projets"]')).not.toBeNull();
    expect(parts.filters.querySelector('input[type="search"]')).not.toBeNull();
    expect(parts.host.contains(parts.primary)).toBe(true);
    fixture.destroy();
    expect(released).toBe(1);
  });

  it('sans cadre, la barre reste dans l’écran et rien n’est réclamé', async () => {
    const fixture = TestBed.createComponent(ToolbarHost);
    fixture.detectChanges();
    await fixture.whenStable();
    const dom = fixture.nativeElement as HTMLElement;
    expect(dom.querySelector('.page-toolbar-primary')?.textContent).toContain('Saisir une dépense');
  });
});
