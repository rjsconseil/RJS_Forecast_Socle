import { fail } from '../../socle/errors.mjs';

// Navigation ne connaît aucun objet métier. Les destinations restent dans le registre du site.
export function validateNavigation(value) {
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const reject = () => fail('VALIDATION', 'Configuration de navigation invalide.');
  if (!object(value) || Object.keys(value).some(k => !['version', 'scopes', 'order', 'relations'].includes(k)) || value.version !== 1 || !object(value.scopes)) reject();
  if (Object.keys(value.scopes).length > 500) reject();
  // L'ordre ne nomme que des clés : pour chaque parent, ses enfants, chacun une seule fois.
  if (value.order !== undefined) {
    if (!object(value.order) || Object.keys(value.order).length > 500) reject();
    for (const [parent, keys] of Object.entries(value.order)) {
      if (!parent || parent.length > 240 || !Array.isArray(keys) || !keys.length || keys.length > 200 || new Set(keys).size !== keys.length) reject();
      if (keys.some(key => typeof key !== 'string' || !key || key.length > 240)) reject();
    }
  }
  if (value.relations !== undefined) {
    const key = v => typeof v === 'string' && v.length > 0 && v.length <= 240;
    const surfaces = ['primary', 'secondary', 'tertiary', 'portal', 'actions', 'contents'];
    if (!object(value.relations) || Object.keys(value.relations).length > 50) reject();
    for (const [zone, links] of Object.entries(value.relations)) {
      if (!/^zone:[\w-]+$/.test(zone) || !object(links) || Object.keys(links).length > 2000) reject();
      for (const [id, relation] of Object.entries(links)) {
        if (!key(id) || !object(relation) || Object.keys(relation).some(k => !['parent', 'home', 'surfaces'].includes(k))) reject();
        if (relation.parent !== undefined && (!key(relation.parent) || relation.parent === id)) reject();
        if (relation.home !== undefined && (!key(relation.home) || relation.home === id)) reject();
        if (relation.surfaces !== undefined && (!Array.isArray(relation.surfaces) ||
          relation.surfaces.some(surface => !surfaces.includes(surface)) ||
          new Set(relation.surfaces).size !== relation.surfaces.length)) reject();
        const seen = new Set([id]);
        let parent = relation.parent;
        while (parent) {
          if (seen.has(parent)) reject();
          seen.add(parent);
          parent = links[parent]?.parent;
        }
      }
    }
  }
  for (const [scope, settings] of Object.entries(value.scopes)) {
    if (!/^(site|module:[\w-]+|page:\/[^?#]*)$/.test(scope) || scope.length > 240 || !object(settings)) reject();
    if (Object.keys(settings).some(k => !['styles', 'labels', 'contentMenu'].includes(k))) reject();
    if (settings.contentMenu !== undefined) {
      if (!object(settings.contentMenu)) reject();
      for (const [key,v] of Object.entries(settings.contentMenu)) {
        if ((key === 'trigger' || key === 'homeTrigger') && ['hover','click'].includes(v)) continue;
        if ((key === 'band' || key === 'numbers') && ['on','off'].includes(v)) continue;
        if (key === 'width' && Number.isInteger(v) && v >= 220 && v <= 480) continue;
        if (key === 'closeDelay' && Number.isInteger(v) && v >= 0 && v <= 600) continue;
        reject();
      }
    }
    for (const [key, label] of Object.entries(settings.labels ?? {})) {
      if (!object(settings.labels) || key.length > 240 || typeof label !== 'string' || !label.trim() || label.length > 100) reject();
    }
    if (settings.labels !== undefined && !object(settings.labels)) reject();
    if (settings.styles !== undefined && !object(settings.styles)) reject();
    for (const [surface, levels] of Object.entries(settings.styles ?? {})) {
      if (!['primary', 'secondary', 'tertiary', 'portal', 'actions', 'contents'].includes(surface) || !object(levels)) reject();
      for (const [level, style] of Object.entries(levels)) {
        if (!['section', 'page', 'detail', 'content'].includes(level) || !object(style)) reject();
        for (const [key, v] of Object.entries(style)) {
          const ranges = { radius: [0,32], weight: [400,800], horizontalPadding: [0,40], minHeight: [28,72], borderWidth: [0,4], letterSpacing: [0,4] };
          if (ranges[key] && Number.isInteger(v) && v >= ranges[key][0] && v <= ranges[key][1]) continue;
          if (key === 'size' && Number.isInteger(v) && v >= 12 && v <= 28) continue;
          if (key === 'spacing' && Number.isInteger(v) && v >= 0 && v <= 20) continue;
          if (['color', 'background', 'activeColor', 'activeBackground', 'hoverColor', 'hoverBackground', 'borderColor'].includes(key) && typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) continue;
          reject();
        }
      }
    }
  }
}
export default {
  id: 'navigation', label: 'Navigation system', level: 2, role: 'metier', dependsOn: [],
  parameters: [{ key: 'navigation.presentation', label: 'Présentation de la navigation', group: 'Navigation system', type: 'object',
    description: 'Libellés et styles par zone de navigation et niveau, hérités du site, du module puis de la page.',
    default: { version: 1, scopes: {} }, validate: validateNavigation }],
  setup(socle) {
    const key = 'navigation.presentation';
    return {
      read: (ctx) => socle.parameters.effective(socle.stateOf(ctx), key),
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
      // Catalogue des sections du site (un fait, une section propriétaire ; flux entre sections). Sans donnée d'utilisateur.
      ['GET', '/api/navigation/sections', () => socle.registry.sections()],
      ['GET', '/api/navigation/settings', ({ ctx }) => socle.modules.navigation.read(ctx)],
      ['PUT', '/api/navigation/settings', ({ body }) => socle.modules.navigation.write(body)],
    ];
  },
};
