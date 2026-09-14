import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.ts'],
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: [
        'src/engine/**/*.ts',
        'src/input/**/*.ts',
        'src/editor/**/*.ts',
        'src/metrics/**/*.ts',
        'src/scenes/**/*.ts',
      ],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { perFile: true, branches: 85, functions: 85, lines: 85, statements: 85 },
    },
  },
});
