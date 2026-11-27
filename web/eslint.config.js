// Lint du site : règles recommandées de TypeScript et d'Angular (code et gabarits). Lancé en CI par `npm run lint`.
// `== null` reste permis : il teste « null ou undefined » à dessein, dans le code comme dans les gabarits.
// @ts-check
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

const unused = ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }];

module.exports = tseslint.config(
  {
    files: ['src/**/*.ts'],
    extends: [...tseslint.configs.recommended, ...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: { '@typescript-eslint/no-unused-vars': unused },
  },
  {
    // Les tests construisent des doublures partielles des services : `any` y reste admis.
    files: ['src/**/*.spec.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['src/**/*.html'],
    extends: [...angular.configs.templateRecommended],
    rules: { '@angular-eslint/template/eqeqeq': ['error', { allowNullOrUndefined: true }] },
  },
);
