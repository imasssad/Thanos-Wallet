// Minimal flat-config ESLint for the monorepo.
//
// Scope: catch the classes of bug that CI typecheck doesn't — unused
// imports, missing dependency arrays, accidental `console.log` in
// shipped code, broken Promise chains. We intentionally do not enforce
// style (prettier is the right tool there) and we don't pull in the
// full @typescript-eslint stack — tsc's strict mode already covers
// most of what those rules add.
//
// Run locally:    pnpm lint
// Add new rules:  push them through one or two PRs at a time; turning
//                 on a strict rule across the whole repo at once
//                 generates noise and gets disabled.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import nextPlugin from '@next/eslint-plugin-next';

export default [
  // Don't lint generated / vendored output.
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.output/**',
      '**/.wxt/**',
      '**/dist-electron/**',
      '**/build/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'apps/mobile/android/**',
      'apps/mobile/ios/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      // services/api/dist + sdk-core dist already excluded by **/dist/**
    ],
  },

  js.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2024,
      },
    },
    rules: {
      // Catch genuine bugs.
      'no-unused-vars':              ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-empty':                    ['warn', { allowEmptyCatch: true }],
      'no-useless-catch':            'warn',
      'no-fallthrough':              'warn',
      'no-async-promise-executor':   'error',
      'no-misleading-character-class': 'error',
      'no-self-assign':              'error',
      'no-unsafe-finally':           'error',
      'no-unsafe-optional-chaining': 'error',
      'use-isnan':                   'error',
      // No-op rules turn-offs — we use TS-handled equivalents.
      'no-undef':                    'off',  // TypeScript handles this.
      'no-redeclare':                'off',  // TS namespace/interface merging is legal.
      'no-inner-declarations':       'off',
      'no-prototype-builtins':       'off',
      'no-constant-condition':       ['warn', { checkLoops: false }],
      // Style/Best practices.
      'no-console':                  ['warn', { allow: ['warn', 'error', 'info'] }],
      'prefer-const':                'warn',
      'no-var':                      'error',
      'eqeqeq':                      ['warn', 'smart'],
      'no-implicit-coercion':        ['warn', { boolean: false }],
    },
  },

  // .ts / .tsx files — TS itself takes care of unused-vars + no-undef.
  // We use typescript-eslint's parser so eslint can actually parse TS
  // syntax. Plugin packs are registered (but no rules activated) so
  // the codebase's existing `// eslint-disable-next-line @typescript-eslint/...`
  // / react-hooks / jsx-a11y / @next/next directives don't generate
  // "Definition for rule X was not found" errors.
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 2024, sourceType: 'module' },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks':        reactHooks,
      'jsx-a11y':           jsxA11y,
      '@next/next':         nextPlugin,
    },
    rules: {
      // tsc --noEmit already flags these; lint shouldn't double-report.
      'no-unused-vars':              'off',
      'no-redeclare':                'off',
      'no-undef':                    'off',
    },
  },
];
