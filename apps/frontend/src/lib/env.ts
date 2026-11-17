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
import { z } from "zod";

import { KEY_BYTES, base64ToBytes } from "@/lib/crypto";

export interface WorkerEnv {
  // bindings
  DB: D1Database;
  MEDIA?: R2Bucket;

  // auth
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;

  // channel credentials at rest (ADR-011) — reported by /health as present/absent only
  TOKEN_ENCRYPTION_KEY?: string;
  /** Which key `TOKEN_ENCRYPTION_KEY` is, stamped on new rows. Bumped by a rotation pass. */
  TOKEN_ENCRYPTION_KEY_VERSION?: string;

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
  /**
   * Uploads (M6): the Worker signs a PUT to R2's S3 endpoint, so bytes go from the browser straight to
   * the bucket. Absent means uploads are refused with a configuration message, not half-work.
   */
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
}

/** The variables without which authentication cannot run at all. */
export function requireAuthEnv(env: WorkerEnv): { secret: string; baseURL: string } {
  if (!env.BETTER_AUTH_SECRET) {
    throw new Error(
      "BETTER_AUTH_SECRET is not set. Local: add it to apps/frontend/.env. Production: `wrangler secret put BETTER_AUTH_SECRET`.",
    );
  }
  return {
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL ?? "http://localhost:3000",
  };
}

/**
 * The credential key, validated on first use.
 *
 * Two failures are worth separating and neither may be silent: a key that is absent (nobody can read
 * any token) and a key of the wrong length (AES-256 needs exactly 32 bytes; a 16-byte key would
 * quietly downgrade the cipher). Both name the variable, because the person who has to fix this is
 * reading a log at an inconvenient hour.
 */
const tokenEncryptionKeySchema = z.object({
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine((value) => base64ToBytes(value)?.length === KEY_BYTES, {
      message: `TOKEN_ENCRYPTION_KEY must be ${KEY_BYTES} bytes, base64-decoded (ADR-011)`,
    }),
  TOKEN_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).default(1),
});

export function requireTokenEncryptionKey(env: WorkerEnv): { base64: string; version: number } {
  const parsed = tokenEncryptionKeySchema.safeParse({
    TOKEN_ENCRYPTION_KEY: env.TOKEN_ENCRYPTION_KEY,
    TOKEN_ENCRYPTION_KEY_VERSION: env.TOKEN_ENCRYPTION_KEY_VERSION ?? "1",
  });
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Platform credentials cannot be read: ${detail}`);
  }
  return {
    base64: parsed.data.TOKEN_ENCRYPTION_KEY,
    version: parsed.data.TOKEN_ENCRYPTION_KEY_VERSION,
  };
}
