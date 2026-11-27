// Contrôle du mode de chaque PR (scripts/mode-pr.mjs) : le rangement des fichiers et le verdict.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, verdict } from '../../scripts/mode-pr.mjs';

test('mode des PR : chaque fichier est rangé dans le grand noyau, une application autonome, ou sans mode', () => {
  const mode = (p) => classify(p).mode;
  assert.equal(mode('web/src/app/sections/projets/application/pilotage.page.ts'), 'application');
  assert.equal(mode('web/src/app/sections/projets/fonctionnalites/portfolio.ts'), 'application');
  assert.equal(mode('web/src/app/sections/inscriptions.ts'), 'application');
  assert.equal(mode('web/src/app/hybrides/projets-budget/inscription.ts'), 'application');
  assert.equal(mode('docs/sections/projets.md'), 'application');
  assert.equal(classify('docs/sections/projets.md').app, 'projets');
  for (const socle of ['docs/sections/README.md', 'docs/sections/_gabarit.md', 'web/src/app/platform/grand-noyau.ts', 'web/src/app/astra/cadre.ts',
    'web/src/app/astra/astra-parts.ts', 'api/src/modules/core/index.mjs', 'api/test/contrat/routes-api.json', 'e2e/astra.e2e.mjs', '.github/workflows/ci.yml', 'package.json']) {
    assert.equal(mode(socle), 'socle', socle);
  }
  assert.equal(mode('CHANGELOG.md'), null);
});

test('mode des PR : une PR qui mêle le grand noyau et une application est refusée, sauf transition déclarée', () => {
  const app = ['web/src/app/sections/projets/application/pilotage.page.ts', 'docs/sections/projets.md', 'CHANGELOG.md'];
  const socle = ['api/src/modules/core/index.mjs', 'CHANGELOG.md'];
  assert.deepEqual([verdict(app).mode, verdict(app).ok, verdict(app).apps], ['application', true, ['projets']]);
  assert.deepEqual([verdict(socle).mode, verdict(socle).ok], ['socle', true]);
  assert.deepEqual([verdict(['CHANGELOG.md']).mode, verdict(['CHANGELOG.md']).ok], ['aucun', true]);
  const mixed = verdict([...app, ...socle]);
  assert.deepEqual([mixed.mixed, mixed.ok], [true, false]);
  assert.deepEqual([verdict([...app, ...socle], { transition: true }).ok, verdict([...app, ...socle], { transition: true }).mode], [true, 'socle']);
});
