import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Every suite runs against its own in-memory SQLite database.
    env: {
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      JWT_SECRET: 'test-secret-do-not-use-in-production',
      JWT_EXPIRES_IN: '1h',
      LOG_FORMAT: 'off',
    },
    pool: 'forks',
    reporters: ['default'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
