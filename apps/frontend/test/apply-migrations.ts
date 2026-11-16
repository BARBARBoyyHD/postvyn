/**
 * Applies the real migrations to the test database before any test runs.
 *
 * The migrations are read from `db/migrations` at config time (see `vitest.config.ts`), so the tests
 * are always exercising the schema that ships — not a hand-written fixture schema that drifts.
 */
import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
