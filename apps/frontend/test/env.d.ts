/// <reference types="@cloudflare/vitest-plugin/types" />

/**
 * Types for the test runtime.
 *
 * `@cloudflare/vitest-plugin` declares the `cloudflare:test` module (referenced above). What it
 * cannot know is the extra binding this project injects at config time, so that is added here.
 *
 * `DB` comes from `wrangler types` (worker-configuration.d.ts) via `wrangler.jsonc`; `TEST_MIGRATIONS`
 * is the array `readD1Migrations()` builds in `vitest.config.ts`.
 */
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: { name: string; queries: string[] }[];
  }
}
