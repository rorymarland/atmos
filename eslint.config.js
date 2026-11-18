import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/', '**/dist/', '**/build/', '**/.svelte-kit/', 'data/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/web/static/**/*.js', 'apps/web/src/lib/check-page.js'],
    languageOptions: { globals: { ...globals.browser } },
    // The check page is deliberately untyped (see its header).
    rules: { '@typescript-eslint/ban-ts-comment': 'off' },
  },
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
