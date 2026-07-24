import { defineConfig } from 'vitest/config';

/**
 * Backend Vitest config — Node environment, co-located test files
 * next to source. Mirrors the frontend setup but without the `@/`
 * alias (backend doesn't use a path alias).
 *
 * Tests live alongside source files: any `*.test.ts` under
 * `backend/src/`, configured via the `include` glob below. Use
 * explicit imports (`import { describe, it, expect } from 'vitest'`)
 * per file — no globals.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
