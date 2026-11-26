import { TestBed } from '@angular/core/testing';
import { CalendarSettingsEditorComponent } from './calendar-settings-editor.component';

// L'administration règle tout le contrat du calendrier : sources branchées au départ, formats, format d'ouverture.
describe('éditeur administré du calendrier', () => {
  const config = {
    libelle: 'Calendrier de test',
    format: 'montants',
    formats: [{ id: 'montants', libelle: 'Montants', disposition: 'ligne', champs: ['amount'] }],
    elements: [{ id: 'revenu', libelle: 'Revenu' }, { id: 'tache', libelle: 'Tâche', branche: false }],
  };
  function mount() {
    const fixture = TestBed.createComponent(CalendarSettingsEditorComponent);
    const emitted: Record<string, unknown>[] = [];
    fixture.componentRef.setInput('value', JSON.stringify(config));
    fixture.componentInstance.valueChange.subscribe((v) => {
      emitted.push(JSON.parse(v));
      fixture.componentRef.setInput('value', v);
      fixture.detectChanges();
    });
    fixture.detectChanges();
    return { fixture, emitted, dom: fixture.nativeElement as HTMLElement };
  }

  it('règle « branchée au départ » par source et garde « affichée » cohérente', () => {
    const { dom, emitted } = mount();
    const branche = dom.querySelector<HTMLInputElement>('[aria-label="Tâche · Branchée au départ"]')!;
    expect(branche.checked).toBe(false);
    expect(dom.querySelector<HTMLInputElement>('[aria-label="Tâche · Affichée au départ"]')!.disabled).toBe(true);
    branche.click();
    expect((emitted.at(-1)!['elements'] as { branche?: boolean }[])[1].branche).toBe(true);
  });

  it('ajoute, règle et retire un format ; le format d’ouverture suit', () => {
    const { dom, emitted } = mount();
    const opening = dom.querySelector<HTMLSelectElement>('[aria-label="Format d’affichage à l’ouverture"]')!;
    expect([...opening.options].map((o) => o.value)).toEqual(['standard', 'compact', 'detaille', 'montants']);
    [...dom.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Ajouter un format'))!.click();
    expect((emitted.at(-1)!['formats'] as unknown[]).length).toBe(2);
    const fields = dom.querySelectorAll<HTMLElement>('.format')[0].querySelectorAll<HTMLInputElement>('.format-fields input');
    fields[3].click(); // « Statut » ajouté après « Montant »
    expect((emitted.at(-1)!['formats'] as { champs: string[] }[])[0].champs).toEqual(['amount', 'status']);
    dom.querySelector<HTMLButtonElement>('[aria-label="Retirer le format Montants"]')!.click();
    expect(emitted.at(-1)!['format']).toBeUndefined();
    expect((emitted.at(-1)!['formats'] as { id: string }[]).map((f) => f.id)).toEqual(['format-2']);
  });
});
