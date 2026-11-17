/**
 * Turnstile verification.
 *
 * The guard covers signup (an endpoint that creates accounts and hashes passwords) and the reset
 * endpoints, which send email to an address the caller chose. Without a bot check the reset pair is
 * a free mail-bombing primitive pointed at third parties from a verified domain — and the fastest
 * way to lose that domain's sending reputation permanently.
 *
 * Fails closed: a missing secret is a configuration error, not a reason to skip the check.
 */
import type { WorkerEnv } from "@/lib/env";

const TEST_SITE_KEY = "1x00000000000000000000AA";
const TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Cloudflare's always-pass keys, published and safe to commit. */
export const turnstileTestKeys = { siteKey: TEST_SITE_KEY, secretKey: TEST_SECRET_KEY };

export interface TurnstileResult {
  ok: boolean;
  reason?: string;
}

export async function verifyTurnstile(
  env: WorkerEnv,
  token: string | null | undefined,
  remoteIp?: string | null,
): Promise<TurnstileResult> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return { ok: false, reason: "turnstile_not_configured" };
  }

  // The nastiest failure mode is a test key reaching production: the check silently always passes.
  if (process.env.NODE_ENV === "production" && secret === TEST_SECRET_KEY) {
    return { ok: false, reason: "turnstile_test_key_in_production" };
  }

  if (!token) return { ok: false, reason: "missing_token" };

  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (remoteIp) body.append("remoteip", remoteIp);

  try {
    const response = await fetch(VERIFY_URL, { method: "POST", body });
    const result = (await response.json()) as { success: boolean; "error-codes"?: string[] };
    return result.success
      ? { ok: true }
      : { ok: false, reason: (result["error-codes"] ?? []).join(",") || "rejected" };
  } catch {
    // A network failure must not become an open door.
    return { ok: false, reason: "verify_unreachable" };
  }
}
