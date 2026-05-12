import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // vault.ts + ledger.ts etc. live in lib/; tests are colocated as *.test.ts.
    // Restrict to lib/ for now so we don't accidentally try to run Next.js
    // route component code under Vitest's Node environment.
    include: ['lib/**/*.test.ts'],
    environment: 'node',
    // Argon2id derivations are slow; the per-test timeouts in vault.test.ts
    // pass `SLOW` (20s) explicitly. This is just a safety net.
    testTimeout: 20_000,
  },
});
