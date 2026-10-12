import { defineConfig } from 'vitest/config';

export default defineConfig({
  // `node:sqlite` is still experimental in Node 22, so it is absent from the
  // builtin module list Vite consults and would otherwise be resolved as a
  // bare package. Keep it external so Node loads it natively.
  ssr: { external: ['node:sqlite'] },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
