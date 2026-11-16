import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Tests run inside real `workerd` with a real D1 — not against a mock.
 *
 * A mocked database would prove nothing about the thing under test: whether SQL, joins and indexes
 * actually keep one workspace's rows away from another's. The cost is slower startup; the benefit is
 * that the guarantee which replaced row-level security is verified in the runtime it ships on.
 *
 * Note the package name: `@cloudflare/vitest-pool-workers` was renamed to `@cloudflare/vitest-plugin`
 * in 2026, and it is a Vite plugin now rather than a pool config helper. Vitest is pinned to 4.x
 * because that is what the plugin supports.
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(dir, "db/migrations"));

  return {
    plugins: [
      cloudflareTest({
        // Minimal test config: DB binding + migrations dir, nothing else (see wrangler.test.jsonc).
        wrangler: { configPath: "./wrangler.test.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    resolve: {
      alias: { "@": path.join(dir, "src") },
    },
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
