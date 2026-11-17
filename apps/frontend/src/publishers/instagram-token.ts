/**
 * The Instagram long-lived token exchange.
 *
 * Separate from the publishing flow because it changes on different evidence: the platform's token
 * lifetime (60 days, refreshable after 24 hours), not its container mechanics. `src/db/token-refresh.ts`
 * runs it from the cron tick — a refresh that stops happening is a channel that dies quietly.
 */
import { jsonObject, parseMetaError } from "./meta";
import type { PlatformError } from "./port";
import type { Transport } from "./transport";

/** The refresh endpoint. Not under `v1.0` — it is its own host path. */
const REFRESH = "https://graph.instagram.com/refresh_access_token";

/**
 * How often a long-lived token is refreshed: tokens last 60 days, so 25 keeps a month's cadence with
 * slack for a failed tick (platform-connections: "Tokens refresh themselves").
 */
export const INSTAGRAM_REFRESH_AFTER_MS = 25 * 24 * 60 * 60 * 1000;

/**
 * Swap a long-lived token for a fresh one.
 *
 * This endpoint takes the token as a query parameter — Meta offers no header form — and nothing in this
 * codebase logs a URL. A refusal is a value: the caller turns it into `reauth_required`, which is how
 * the board learns the account needs a human.
 */
export async function refreshLongLivedToken(input: {
  accessToken: string;
  transport: Transport;
}): Promise<{ ok: true; accessToken: string } | { ok: false; platformError: PlatformError }> {
  const answer = await input.transport.send({
    method: "GET",
    url: `${REFRESH}?grant_type=ig_refresh_token&access_token=${encodeURIComponent(input.accessToken)}`,
  });

  if (answer.kind === "dry_run") {
    return { ok: false, platformError: { code: "dry_run", message: "a dry run does not refresh tokens" } };
  }
  if (answer.status >= 400) {
    return { ok: false, platformError: parseMetaError(answer.status, answer.body) };
  }

  const body = jsonObject(answer.body);
  const token = body && typeof body.access_token === "string" ? body.access_token : null;
  if (!token) {
    return {
      ok: false,
      platformError: { code: "no_token", message: "the refresh answered without an access_token" },
    };
  }
  return { ok: true, accessToken: token };
}
