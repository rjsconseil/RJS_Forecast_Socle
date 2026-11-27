import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { ASTRA_PARTS } from '../astra/astra-parts';
import { SectionHome } from './section-home';
import { flowsFrom, flowsInto, SECTION_FLOWS, sectionOf, SITE_SECTIONS } from './sections';
import { kindOfId, sourceLink, sourceLinkOfId } from './source-link';

describe('catalogue des sections (lu dans api/src/socle/sections.json)', () => {
  it('donne les cinq sections du site dans l’ordre du menu, sans le système', () => {
    expect(SITE_SECTIONS.map((s) => s.key)).toEqual(['quotidien', 'projets', 'budget', 'patrimoine', 'cycles']);
    expect(SECTION_FLOWS).toHaveLength(9);
  });

  it('les parties d’Astra sont les sections : même ordre, même nom, même teinte', () => {
    expect(ASTRA_PARTS.map((p) => p.key)).toEqual(SITE_SECTIONS.map((s) => s.key));
    for (const p of ASTRA_PARTS) {
      expect(p.label).toBe(sectionOf(p.key).label);
      expect(p.tone).toBe(sectionOf(p.key).tone);
    }
  });

  it('chaque section reçoit des autres et leur donne : autonomes et interdépendantes', () => {
    for (const s of SITE_SECTIONS) {
      expect(flowsInto(s.key).length).toBeGreaterThan(0);
      expect(flowsFrom(s.key).length).toBeGreaterThan(0);
    }
    expect(flowsInto('projets').map((f) => f.from)).toEqual(['budget', 'patrimoine']);
    expect(flowsFrom('projets').map((f) => f.to)).toEqual(['quotidien', 'cycles']);
  });
});

describe('ouvrir un fait à sa source', () => {
  it('lit la nature dans l’ID et renvoie à la section qui la gère', () => {
    expect(kindOfId('prj_12')).toBe('coreProject');
    expect(kindOfId('xyz_1')).toBeNull();
    expect(sourceLinkOfId('prj_12')).toEqual({ link: '/bpm-astra/projets/prj_12' });
    expect(sourceLink('task', { id: 'tsk_1', projectId: 'prj_2' })).toEqual({ link: '/bpm-astra/projets/prj_2/taches' });
    expect(sourceLink('task', 'tsk_1')).toEqual({ link: '/bpm-astra/taches' });
    expect(sourceLink('lifeGoal', 'obj_1')?.link).toBe('/bpm-astra/objectif/echeances');
    expect(sourceLink('inconnue', 'x_1')).toBeNull();
  });
});

describe('accueil générique d’une section', () => {
  it('affiche la promesse, les indicateurs, l’état « section seule » et les flux', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const f = TestBed.createComponent(SectionHome);
    f.componentRef.setInput('key', 'projets');
    f.componentRef.setInput('indicators', [{ label: 'Projets en cours', value: '3' }]);
    f.componentRef.setInput('alone', { title: 'Aucune enveloppe', detail: 'Vos projets se gèrent sans financement.' });
    f.componentRef.setInput('linkOf', (k: string) => '/s/' + k);
    f.detectChanges();
    await f.whenStable();
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('h1')?.textContent).toContain('Mes projets');
    expect(el.textContent).toContain(sectionOf('projets').promise);
    expect(el.querySelector('.section-home-indicators b')?.textContent).toBe('3');
    expect(el.querySelector('.section-home-alone')?.textContent).toContain('Aucune enveloppe');
    const links = [...el.querySelectorAll('.section-home-flows a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/s/budget', '/s/patrimoine', '/s/quotidien', '/s/cycles']);
    f.componentRef.setInput('showFlows', false);
    f.detectChanges();
    expect(el.querySelector('.section-home-flows')).toBeNull();
  });
});
