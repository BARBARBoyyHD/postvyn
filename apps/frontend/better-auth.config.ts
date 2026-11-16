/**
 * CLI-only configuration, used by `@better-auth/cli generate` to emit the auth tables.
 *
 * This is NOT the runtime instance. The runtime one is built per request in `src/auth/server.ts`
 * from the Worker's `env` — a module-level instance captures a binding that can be dead.
 *
 * The CLI needs an adapter instance to infer the dialect; it never queries it. The stub below is
 * typed as the D1 binding and handed to drizzle, which is enough for the generator to decide
 * "sqlite" and produce the right DDL. Nothing here runs in production.
 */
import { drizzle } from "drizzle-orm/d1";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

const stub = {
  prepare: () => {
    throw new Error("better-auth.config.ts is for schema generation only — it must never execute");
  },
} as unknown as D1Database;

export const auth = betterAuth({
  database: drizzleAdapter(drizzle(stub), { provider: "sqlite" }),
  emailAndPassword: { enabled: true, requireEmailVerification: true },
});
