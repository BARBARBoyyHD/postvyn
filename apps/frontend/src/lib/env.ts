/**
 * The Worker's environment, named explicitly.
 *
 * Deliberately not the ambient `Env` from `wrangler types`: that global only exists after
 * `wrangler types` runs, so a fresh clone would fail typecheck until someone remembered. This
 * interface is the contract; `wrangler.jsonc` is what has to agree with it, and `wrangler types` is
 * still generated for the `cloudflare:workers` module types.
 *
 * Secrets are optional because `next dev` and the test runtime do not have them — code that needs one
 * must say what it does when it is absent rather than crashing at import time.
 */
export interface WorkerEnv {
  // bindings
  DB: D1Database;
  MEDIA?: R2Bucket;

  // auth
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;

  // channel credentials at rest (ADR-011) — reported by /health as present/absent only
  TOKEN_ENCRYPTION_KEY?: string;

  // email
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;

  // bot defence
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;

  // operations
  PUBLISHING_ENABLED?: string;
  CRON_SECRET?: string;
  R2_PUBLIC_BASE?: string;
}

/** The variables without which authentication cannot run at all. */
export function requireAuthEnv(env: WorkerEnv): { secret: string; baseURL: string } {
  if (!env.BETTER_AUTH_SECRET) {
    throw new Error(
      "BETTER_AUTH_SECRET is not set. Local: add it to .dev.vars. Production: `wrangler secret put BETTER_AUTH_SECRET`.",
    );
  }
  return {
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL ?? "http://localhost:3000",
  };
}
