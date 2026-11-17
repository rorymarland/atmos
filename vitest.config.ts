import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'scripts/**/*.test.ts',
      'apps/alerts/src/**/*.test.ts',
    ],
    passWithNoTests: true,
  },
});
