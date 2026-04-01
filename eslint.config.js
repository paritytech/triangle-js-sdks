import js from '@eslint/js';
import nx from '@nx/eslint-plugin';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { importX } from 'eslint-plugin-import-x';
import { defineConfig, globalIgnores } from 'eslint/config';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default defineConfig([
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],

  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,

  globalIgnores(['**/dist', '**/*.d.ts']),

  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, eslintPluginPrettierRecommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],

      'import-x/no-named-as-default': 'error',
      'import-x/no-unresolved': 'off',
      'import-x/consistent-type-specifier-style': ['error', 'prefer-top-level'],
      'import-x/order': [
        'error',
        {
          named: { enabled: true, types: 'types-first' },
          alphabetize: { order: 'asc', orderImportKind: 'asc' },
          groups: ['builtin', 'external', 'parent', ['sibling', 'index']],
          'newlines-between': 'always',
          distinctGroup: false,
          pathGroups: [
            {
              group: 'builtin',
              pattern: '@novasamatech/*',
              position: 'after',
            },
          ],
        },
      ],
    },
  },
]);
