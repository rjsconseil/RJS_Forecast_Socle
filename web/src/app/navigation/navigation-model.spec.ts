import { describe, it, expect } from 'vitest';
import { NavigationConfiguration, effectiveLabel, effectiveStyle } from './navigation-model';
describe('navigation inheritance', () => {
  const config: NavigationConfiguration = { version: 1, scopes: {
    site: { styles: { primary: { section: { size: 16, color: '#111111' } } }, labels: { '/vision': 'Cap' } },
    'module:bpm': { styles: { primary: { section: { size: 18 } } }, labels: { '/vision': 'Mon cap' } },
    'page:/vision': { styles: { primary: { section: { color: '#222222' } } } },
  } };
  it('inherits property by property and isolates navigation surfaces and levels', () => {
    expect(effectiveStyle(config, { module: 'bpm', page: '/vision' }, 'primary', 'section')).toEqual({ size: 18, color: '#222222' });
    expect(effectiveStyle(config, { module: 'budget', page: '/socle/budget' }, 'primary', 'section')).toEqual({ size: 16, color: '#111111' });
    expect(effectiveStyle(config, { module: 'bpm', page: '/vision' }, 'secondary', 'section')).toEqual({});
    expect(effectiveStyle(config, { module: 'bpm', page: '/vision' }, 'primary', 'detail')).toEqual({});
  });
  it('labels do not mutate destinations or leak across modules', () => {
    expect(effectiveLabel(config, { module: 'bpm', page: '/vision' }, '/vision', 'Objectifs')).toBe('Mon cap');
    expect(effectiveLabel(config, { module: 'budget', page: '/' }, '/vision', 'Objectifs')).toBe('Cap');
    expect(effectiveLabel(config, { page: '/' }, '/other', 'Autre')).toBe('Autre');
  });
});
