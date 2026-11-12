import { describe, it, expect } from 'vitest';
import { SITE_NAVIGATION } from './navigation-adapter';
import { PLAN_ZONES } from './site-plan';
describe('adaptateur de navigation du socle', () => {
  it('enregistre tous les modules, les pages et les modèles de fiches sans modifier les destinations', () => {
    expect(SITE_NAVIGATION.modules.map(m => m.id)).toEqual(PLAN_ZONES.map(z => z.id));
    expect(new Set(SITE_NAVIGATION.entries.map(e => e.key)).size).toBe(SITE_NAVIGATION.entries.length);
    for (const zone of PLAN_ZONES) for (const section of zone.sections) for (const page of section.pages)
      expect(SITE_NAVIGATION.entries.find(e => e.key === page.link)?.link).toBe(page.link);
    expect(SITE_NAVIGATION.context('/app/gestion-projet/prj_1/budget?period=2026-11')).toEqual({ module: 'bpm', page: '/app/gestion-projet/:id/budget' });
    expect(SITE_NAVIGATION.context('/projects/prj_1/edit')).toEqual({ module: 'noyau', page: '/projects/:id/edit' });
    expect(SITE_NAVIGATION.context('/navigation')).toEqual({ module: 'navigation', page: '/navigation' });
  });
});
