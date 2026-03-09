import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ['./tests/setup/test-env.ts'],
    clearMocks: true,
    restoreMocks: true,
    projects: [
      {
        test: {
          name: 'unit',
          globals: true,
          setupFiles: ['./tests/setup/test-env.ts'],
          include: [
            'tests/unit/**/*.spec.ts',
            'tests/frontend/**/*.spec.ts',
          ],
        },
      },
      {
        test: {
          name: 'integration',
          globals: true,
          setupFiles: ['./tests/setup/test-env.ts'],
          include: ['tests/integration/**/*.spec.ts'],
        },
      },
      {
        test: {
          name: 'contract',
          globals: true,
          setupFiles: ['./tests/setup/test-env.ts'],
          include: ['tests/contract/**/*.spec.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './tests/results/vitest-coverage',
    },
  },
});
