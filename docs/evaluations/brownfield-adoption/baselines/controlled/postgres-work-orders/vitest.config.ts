import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 30_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
