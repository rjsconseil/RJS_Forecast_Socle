import { fail } from '../../socle/errors.mjs';

// Navigation ne connaît aucun objet métier. Les destinations restent dans le registre du site.
export function validateNavigation(value) {
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const reject = () => fail('VALIDATION', 'Configuration de navigation invalide.');
  if (!object(value) || Object.keys(value).some(k => !['version', 'scopes'].includes(k)) || value.version !== 1 || !object(value.scopes)) reject();
  if (Object.keys(value.scopes).length > 500) reject();
  for (const [scope, settings] of Object.entries(value.scopes)) {
    if (!/^(site|module:[\w-]+|page:\/[^?#]*)$/.test(scope) || scope.length > 240 || !object(settings)) reject();
    if (Object.keys(settings).some(k => !['styles', 'labels'].includes(k))) reject();
    for (const [key, label] of Object.entries(settings.labels ?? {})) {
      if (!object(settings.labels) || key.length > 240 || typeof label !== 'string' || !label.trim() || label.length > 100) reject();
    }
    if (settings.labels !== undefined && !object(settings.labels)) reject();
    if (settings.styles !== undefined && !object(settings.styles)) reject();
    for (const [surface, levels] of Object.entries(settings.styles ?? {})) {
      if (!['primary', 'secondary', 'tertiary', 'portal'].includes(surface) || !object(levels)) reject();
      for (const [level, style] of Object.entries(levels)) {
        if (!['section', 'page', 'detail'].includes(level) || !object(style)) reject();
        for (const [key, v] of Object.entries(style)) {
          if (key === 'size' && Number.isInteger(v) && v >= 12 && v <= 28) continue;
          if (key === 'spacing' && Number.isInteger(v) && v >= 0 && v <= 20) continue;
          if (['color', 'background', 'activeColor', 'activeBackground'].includes(key) && typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) continue;
          reject();
        }
      }
    }
  }
}
export default {
  id: 'navigation', label: 'Navigation system', level: 0, dependsOn: [],
  parameters: [{ key: 'navigation.presentation', label: 'Présentation de la navigation', group: 'Navigation system', type: 'object',
    description: 'Libellés et styles par zone de navigation et niveau, hérités du site, du module puis de la page.',
    default: { version: 1, scopes: {} }, validate: validateNavigation }],
  setup(socle) {
    const key = 'navigation.presentation';
    return {
      read: () => socle.parameters.effective(socle.state, key),
      write: input => {
        if (!Number.isInteger(input?.expectedRevision) || input.expectedRevision < 0)
          fail('VALIDATION', 'La révision attendue est requise.');
        return socle.om.command('configureNavigation', null, input,
          tx => ({ parameter: socle.parameters.write(tx, key, input.value, { expectedRevision: input.expectedRevision }) }),
          { anonymous: true });
      },
    };
  },
  routes(socle) {
    return [
      ['GET', '/api/navigation/settings', () => socle.modules.navigation.read()],
      ['PUT', '/api/navigation/settings', ({ body }) => socle.modules.navigation.write(body)],
    ];
  },
};
