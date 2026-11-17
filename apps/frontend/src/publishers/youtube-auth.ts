/**
 * YouTube's OAuth2, from a refresh token the operator obtained outside the app.
 *
 * There is no in-app Google redirect or consent flow (design decision 1): the operator creates a Google
 * Cloud project, publishes the consent screen to **In production**, runs the consent flow in the OAuth
 * Playground or in the client's own redirect, and pastes `clientId`, `clientSecret` and `refreshToken`
 * into the connect form. Those live encrypted in `channel_credentials`, per channel — never in env, the
 * same enter-in-the-app path Meta already takes (ADR-011).
 *
 * Source for the expiry rules — Google Identity, "Using OAuth 2.0 to Access Google APIs",
 * developers.google.com/identity/protocols/oauth2, last updated 2026-10-29, read 2026-11-17:
 *
 *  - Consent screen **External + Testing** → the refresh token dies after 7 days. **In production** →
 *    durable (an unverified production app still yields durable tokens; its "unverified app" warning is
 *    expected and harmless for a one-operator tool).
 *  - Refresh tokens also die on revocation, ~6 months unused, a password change, or past 100 tokens per
 *    account per client. Every one of those arrives as `invalid_grant` → `reauth_required`, never a crash.
 *
 * Scopes, from YouTube Data API v3 `videos.insert` (developers.google.com/youtube/v3/docs/videos/insert)
 * and `videos.list` (…/videos/list), both read 2026-11-17: `youtube.upload` authorises the upload, and
 * the read-back that gates `published` needs `youtube.readonly` (the narrower of the two read scopes).
 * The *operator's* consent flow must grant both — the app cannot widen a token it did not issue, so the
 * connect guidance names them.
 */
import type { PlatformError } from "./port";
import type { Transport } from "./transport";

/** Google's OAuth2 token endpoint. Not under the API root — it is its own host. */
export const YOUTUBE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** The Data API root: `videos.list`, `channels.list`. */
export const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";

/** The resumable-upload endpoint for `videos.insert`. */
export const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";

/** What the operator's consent flow has to grant for this app to upload and read back. */
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
] as const;

/**
 * How often the monthly exercise pass mints a token: 30 days, so it defeats Google's ~6-month unused
 * invalidation and reports a dead token within a month instead of at the next publish
 * (design decision 2: a named constant, not an env var).
 */
export const YOUTUBE_REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export interface YoutubeCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** The four-name bag flattened into the three values a grant needs, or the fields that are missing. */
export function youtubeCredentials(
  bag: Readonly<Record<string, string>>,
): { ok: true; credentials: YoutubeCredentials } | { ok: false; missing: string[] } {
  const clientId = bag.clientId ?? "";
  const clientSecret = bag.clientSecret ?? "";
  const refreshToken = bag.refreshToken ?? "";

  const missing = [
    clientId ? null : "clientId",
    clientSecret ? null : "clientSecret",
    refreshToken ? null : "refreshToken",
  ].filter((field): field is string => field !== null);

  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, credentials: { clientId, clientSecret, refreshToken } };
}

export type TokenMint =
  | { ok: true; accessToken: string }
  /** A refusal: `reauth` when the grant is dead, otherwise whatever Google said. */
  | { ok: false; platformError: PlatformError; reauth: boolean };

/**
 * Mint a ~1-hour access token from the stored refresh token.
 *
 * Called on every publish and once a month per channel. `invalid_grant` is the whole vocabulary of "this
 * needs a human": revoked, expired in Testing mode, password changed, or unused for six months.
 */
export async function mintAccessToken(input: {
  credentials: YoutubeCredentials;
  transport: Transport;
}): Promise<TokenMint> {
  const answer = await input.transport.send({
    method: "POST",
    url: YOUTUBE_TOKEN_URL,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.credentials.clientId,
      client_secret: input.credentials.clientSecret,
      refresh_token: input.credentials.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (answer.kind === "dry_run") {
    return { ok: false, platformError: { code: "dry_run", message: "a dry run mints nothing" }, reauth: false };
  }

  if (answer.status >= 400) {
    const platformError = parseGoogleError(answer.status, answer.body);
    return { ok: false, platformError, reauth: platformError.code === "invalid_grant" };
  }

  const body = jsonObject(answer.body);
  const accessToken = body && typeof body.access_token === "string" ? body.access_token : null;
  if (!accessToken) {
    return {
      ok: false,
      platformError: { code: "no_token", message: "the token endpoint answered without an access_token" },
      reauth: false,
    };
  }

  return { ok: true, accessToken };
}

/**
 * The channel's own id, from the account the token belongs to.
 *
 * The connect flow calls this *before* a channel becomes `active`: a typed account reference could
 * produce a channel that looks connected and never publishes (platform-connections: "The account
 * reference comes from the platform, not from typing").
 */
export async function resolveAccount(input: {
  accessToken: string;
  transport: Transport;
}): Promise<{ ok: true; accountRef: string } | { ok: false; platformError: PlatformError }> {
  const answer = await input.transport.send({
    method: "GET",
    url: `${YOUTUBE_API}/channels?part=id&mine=true`,
    headers: { authorization: `Bearer ${input.accessToken}` },
  });

  if (answer.kind === "dry_run") {
    return { ok: false, platformError: { code: "dry_run", message: "a dry run resolves nothing" } };
  }
  if (answer.status >= 400) {
    return { ok: false, platformError: parseGoogleError(answer.status, answer.body) };
  }

  const body = jsonObject(answer.body);
  const items = body && Array.isArray(body.items) ? body.items : [];
  const first = items.find(isRecord);
  const id = first && typeof first.id === "string" ? first.id : null;
  if (!id) {
    return {
      ok: false,
      platformError: {
        code: "no_channel",
        message: "this Google account has no YouTube channel to publish to",
      },
    };
  }

  return { ok: true, accountRef: id };
}

/**
 * What connect needs: the credentials proven, and the account id the platform itself reports.
 *
 * One function rather than two calls at the route, because the pair is the *contract* — a mint that is
 * not followed by a resolve proves nothing about whether this account can publish
 * (platform-connections: "Connecting proves the credentials before the channel is active"). A refusal
 * carries Google's own code, so "invalid_grant" and "this account has no channel" read differently.
 */
export async function proveYoutubeConnect(input: {
  credentials: YoutubeCredentials;
  transport: Transport;
}): Promise<{ ok: true; accountRef: string } | { ok: false; platformError: PlatformError }> {
  const minted = await mintAccessToken(input);
  if (!minted.ok) return { ok: false, platformError: minted.platformError };
  return resolveAccount({ accessToken: minted.accessToken, transport: input.transport });
}

/**
 * Google's own code and message, kept verbatim (spec: publishers, "A platform refusal is quoted").
 *
 * Two envelopes: API calls answer `{"error":{"code","message","errors":[{"reason"}],"status"}}`, and the
 * token endpoint answers `{"error":"invalid_grant","error_description":"…"}`. Google's per-error
 * `reason` is its real code — `quotaExceeded`, `uploadLimitExceeded`, `youtubeSignupRequired` — so it is
 * preferred over the HTTP status, which is 403 for several unrelated problems. When the body is neither
 * envelope, the status and the first 200 characters are kept: a paraphrase is not actionable.
 */
export function parseGoogleError(status: number, body: string): PlatformError {
  const parsed = jsonObject(body);

  if (parsed) {
    const error = parsed.error;
    if (isRecord(error)) {
      const reasons = Array.isArray(error.errors) ? error.errors : [];
      const first = reasons.find(isRecord);
      const reason = first && typeof first.reason === "string" ? first.reason : null;
      const code =
        reason ??
        (typeof error.code === "number" || typeof error.code === "string"
          ? String(error.code)
          : `HTTP_${status}`);
      const message = typeof error.message === "string" ? error.message : `HTTP ${status}`;
      return { code, message };
    }
    if (typeof error === "string") {
      const description =
        typeof parsed.error_description === "string" ? parsed.error_description : error;
      return { code: error, message: description };
    }
  }

  return { code: `HTTP_${status}`, message: body.slice(0, 200) || `HTTP ${status}` };
}

export function jsonObject(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
