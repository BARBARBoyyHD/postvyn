/**
 * The parts Instagram and Threads share, because Meta shares them.
 *
 * Both APIs answer with the same error envelope — `{"error": {"message", "code", "type"}}` — both
 * expose container readiness as a status word, and both distinguish "your content is wrong" from
 * "your token is wrong" the same way. That is one body of knowledge with one reason to change, so it
 * lives in one file; the flows around it stay separate, because the two platforms' container
 * mechanics and field names are genuinely different.
 */
import { DRY_RUN, type PlatformError, type PublishInput, type PublishResult } from "./port";
import type { TransportReply } from "./transport";

export { DRY_RUN };

/**
 * Meta's token-failure codes: 190 expired/invalid access token, 102 invalid session, 463/467 the
 * sub-codes for an expired login. They mean "re-authorise", not "retry" (platform-connections
 * spec: "An expired token flips the channel").
 *
 * Identified by code, not by `type: "OAuthException"`: Meta reuses that type for rate limits, and a
 * rate limit must stay a retryable failure (its own code, 613, says so).
 */
const TOKEN_ERROR_CODES = new Set(["190", "102", "463", "467"]);

/** The bearer token, or null when the channel was stored without one. */
export function accessToken(input: PublishInput): string | null {
  const token = input.credentials.accessToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/**
 * The platform's words, kept verbatim (spec: publishers §3).
 *
 * When the body is not Meta's envelope the raw text is kept instead: an operator reading "HTTP_502"
 * plus the first 200 characters of a proxy error can act; a paraphrased "publish failed" cannot.
 */
export function parseMetaError(status: number, body: string): PlatformError {
  const parsed = safeJson(body);
  const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : null;

  if (error) {
    const code =
      typeof error.code === "number" || typeof error.code === "string"
        ? String(error.code)
        : `HTTP_${status}`;
    const message = typeof error.message === "string" ? error.message : `HTTP ${status}`;
    return { code, message };
  }

  return { code: `HTTP_${status}`, message: body.slice(0, 200) || `HTTP ${status}` };
}

/** A rejection is about the credential or about the content, and the caller must tell them apart. */
export function metaFailure(status: number, body: string): PublishResult {
  const platformError = parseMetaError(status, body);

  if (TOKEN_ERROR_CODES.has(platformError.code)) {
    return { status: "reauth_required", platformError };
  }
  return { status: "failed", platformError };
}

/** A JSON object answer, or null. Adapters parse platform answers as `unknown` first, never as a cast. */
export function jsonObject(body: string): Record<string, unknown> | null {
  const parsed = safeJson(body);
  return isRecord(parsed) ? parsed : null;
}

/** The id out of a create/publish answer, or null when the platform answered without one. */
export function platformId(body: string): string | null {
  const parsed = jsonObject(body);
  return parsed && typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : null;
}

/** The status word out of a container poll: `status_code` on Instagram, `status` on Threads. */
export type ContainerReadiness =
  | { ready: true; status: string }
  | { ready: false; status: string; result: PublishResult };

/**
 * What a poll answer means, for either platform.
 *
 * `FINISHED` is ready to publish; everything else is either "wait" (a park, not a failure) or a
 * container Meta has abandoned. The two platform-specific bits — which field carries the word and how
 * long to wait — are arguments, so the vocabulary itself is written down once.
 */
export function containerReadiness(
  answer: TransportReply,
  options: { containerId: string; pollAfterMs: number; statusField: "status" | "status_code" },
): ContainerReadiness {
  if (answer.kind === "dry_run") {
    return { ready: false, status: "", result: DRY_RUN };
  }
  if (answer.status >= 400) {
    return { ready: false, status: "", result: metaFailure(answer.status, answer.body) };
  }

  const parsed = safeJson(answer.body);
  const status =
    isRecord(parsed) && typeof parsed[options.statusField] === "string"
      ? String(parsed[options.statusField])
      : "";

  if (status === "FINISHED" || status === "PUBLISHED") return { ready: true, status };

  if (status === "ERROR" || status === "EXPIRED") {
    // The container status endpoint carries no code of its own, so the platform's status word becomes
    // the code. Inventing `500` here would suggest the platform answered something it did not.
    const detail =
      isRecord(parsed) && typeof parsed.error_message === "string"
        ? parsed.error_message
        : isRecord(parsed) && typeof parsed.status === "string"
          ? parsed.status
          : "";
    return {
      ready: false,
      status,
      result: {
        status: "failed",
        platformError: { code: status, message: detail || `the container ended as ${status}` },
      },
    };
  }

  return {
    ready: false,
    status,
    result: {
      status: "awaiting_platform",
      detail: `container ${status || "unreadable"}`,
      resume: { afterMs: options.pollAfterMs, containerId: options.containerId },
    },
  };
}

/** The read-back: the platform's own id and URL, or `uncertain` when they do not agree. */
export function readBackAnswer(
  answer: TransportReply,
  platformPostId: string,
): PublishResult {
  if (answer.kind === "dry_run") return DRY_RUN;

  if (answer.status >= 400) {
    return {
      status: "uncertain",
      detail: "the platform accepted it but the read-back failed — check the account before retrying",
      platformError: parseMetaError(answer.status, answer.body),
    };
  }

  const parsed = safeJson(answer.body);
  const id = isRecord(parsed) && typeof parsed.id === "string" ? parsed.id : null;
  if (id !== platformPostId) {
    return {
      status: "uncertain",
      detail: "the read-back returned a different post than the one that was created",
    };
  }

  const permalink = isRecord(parsed) && typeof parsed.permalink === "string" ? parsed.permalink : null;
  return { status: "published", platformPostId: id, permalink, raw: parsed };
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
