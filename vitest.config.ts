import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
import { existsSync } from 'fs';

// Load .env.test before any worker forks start so the test DATABASE_URL
// is in place when db/index.ts initialises the Neon connection.
if (existsSync('.env.test')) {
  config({ path: '.env.test', override: true });
}

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30000,
  },
});
