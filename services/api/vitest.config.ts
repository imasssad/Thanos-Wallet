import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Both real-Postgres suites load schema.sql in beforeAll. Running files
    // serially avoids concurrent CREATE EXTENSION catalog races.
    fileParallelism: false,
  },
});
