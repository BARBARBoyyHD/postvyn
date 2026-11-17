/**
 * X, through the v2 posts API and the v1.1 chunked media upload.
 *
 * Two mechanics make X different from the Meta platforms, and both are visible from here:
 *
 *  - **Every request is signed** with the channel's four credentials (`x-oauth.ts`): there is no
 *    bearer token, so a call is the method, the URL and the headers, nothing else.
 *  - **Publishing costs money.** X has had no free tier since February 2026, so the price is a
 *    function of the post's shape (`docs/001-PRD.md` §8: "no free tier since Feb 2026 — $0.015/post,
 *    $0.20 with a link, prepaid credits"). It is shown in the preview, recorded with the result, and
 *    an account with no credits configured is refused before the first call
 *    (design.md decision 5: "better a clear refusal than a 402 in a cron log").
 *
 * The flow is INIT → APPEND × n → FINALIZE → tweet, and video processing that is not finished parks
 * the job exactly as an Instagram container does — the media id is the resume token, so a slow
 * transcode never uploads the same file twice.
 */
import {
  DRY_RUN,
  PAYMENT_REQUIRED_CODE,
  previewFlow,
  type PlatformError,
  type Preview,
  type Publisher,
  type PublishInput,
  type PublishMedia,
  type PublishResult,
} from "./port";
import type { Transport } from "./transport";
import { pollMedia, uploadMedia, type MediaStep } from "./x-media";
import { signedCall, xCredentials, type XCredentials } from "./x-oauth";
import { PLATFORM_RULES } from "@/lib/specs/platforms";

/** X's v2 root. Media upload has its own endpoint (`x-media.ts`). */
const X_API = "https://api.x.com/2";

/**
 * The price of one X post, from `docs/001-PRD.md` §8 (platform matrix) and
 * `docs/005-REQUIREMENTS.md` §4 ("Billing | Pay-per-use since Feb 2026"). Spec data: the numbers
 * belong here, named, with the document they came from — not inline in a note.
 */
export const X_COST_PER_POST_USD = 0.015;
export const X_COST_PER_POST_WITH_LINK_USD = 0.2;

/** X carries one video or up to four images per post, never a mix of the two. */
const X_MAX_IMAGES = PLATFORM_RULES.x.mediaMax ?? 0;

/**
 * Conservative on purpose: a bare domain in the text counts as a link too, so over-estimating costs
 * the operator a glance while under-estimating costs them money (`docs/003-ITA.md` §11, "X counts any
 * link as $0.20, including a bare domain in the text. Estimate conservatively.").
 */
const LINK_PATTERN = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/i;

/**
 * The refusal for an account with no credits configured. It names the switch, because "publishing
 * failed" would leave the operator looking at X's dashboard for a problem that is one variable away
 * (`docs/005-REQUIREMENTS.md` §10: "buy credits, set a spend cap").
 */
export const X_CREDITS_MISSING =
  "X publishing needs prepaid credits: X has no free tier (docs/001-PRD.md §8). Buy credits in the " +
  "X developer portal, then set X_CREDITS_CONFIGURED=true. Nothing was sent.";

const MEDIA_NOTE =
  "X takes the bytes rather than a URL, so the upload calls follow the media download: its size " +
  "decides total_bytes and how many chunks the file needs.";

/** Everything one publish needs: the content, the signed credentials, and where calls go. */
interface Session {
  input: PublishInput;
  credentials: XCredentials;
  transport: Transport;
}

export interface XOptions {
  transport: Transport;
  /** False until the operator has credits for the X developer account. Refuses, never guesses. */
  creditsConfigured: boolean;
}

export function xPublisher(options: XOptions): Publisher {
  const { transport, creditsConfigured } = options;

  return {
    platform: "x",

    estimateCostUsd(input: PublishInput): number {
      return xCostUsd(xText(input));
    },

    async preview(input: PublishInput): Promise<Preview> {
      const preview = await previewFlow(
        async (recording) => publishFlow(input, recording, creditsConfigured),
        previewNotes(input, creditsConfigured),
      );
      return { ...preview, estimatedCostUsd: xCostUsd(xText(input)) };
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      return publishFlow(input, transport, creditsConfigured);
    },

    async verify(result: PublishResult, input: PublishInput): Promise<PublishResult> {
      return verifyFlow(result, input, transport);
    },
  };
}

/** The text X receives: the caption, then the hashtags, which live in the caption on X. */
export function xText(input: PublishInput): string {
  return [input.caption.trim(), input.hashtags.join(" ")].filter(Boolean).join("\n\n");
}

/** The estimate for one post, from its shape. Exported so the number is testable without a wire. */
export function xCostUsd(text: string): number {
  return LINK_PATTERN.test(text) ? X_COST_PER_POST_WITH_LINK_USD : X_COST_PER_POST_USD;
}

async function publishFlow(
  input: PublishInput,
  transport: Transport,
  creditsConfigured: boolean,
): Promise<PublishResult> {
  const found = xCredentials(input.credentials);
  if (!found.ok) return signedOut(found.missing);
  if (!creditsConfigured) return { status: "not_connected", reason: X_CREDITS_MISSING };

  const shape = mediaShape(input.media);
  if (!shape.ok) {
    return { status: "failed", platformError: { code: "media_unsupported", message: shape.message } };
  }

  const session: Session = { input, credentials: found.credentials, transport };
  const mediaIds: string[] = [];

  for (const media of input.media) {
    const step = await uploadMedia(session, media);
    if (step.kind === "uploaded") {
      mediaIds.push(step.mediaId);
      continue;
    }
    if (step.kind === "processing") return parked(step);
    return stepResult(step);
  }

  return createPost(session, mediaIds);
}

async function verifyFlow(
  result: PublishResult,
  input: PublishInput,
  transport: Transport,
): Promise<PublishResult> {
  const found = xCredentials(input.credentials);
  if (!found.ok) return signedOut(found.missing);
  const session: Session = { input, credentials: found.credentials, transport };

  switch (result.status) {
    case "published":
      return readBack(session, result.platformPostId);

    case "awaiting_platform": {
      const mediaId = result.resume.containerId;
      if (!mediaId) return { status: "uncertain", detail: "no media id to resume" };

      const step = await pollMedia(session, mediaId);
      if (step.kind === "processing") return parked(step);
      if (step.kind !== "uploaded") return stepResult(step);

      const created = await createPost(session, [mediaId]);
      return created.status === "published" ? readBack(session, created.platformPostId) : created;
    }

    case "uncertain":
    case "failed":
    case "reauth_required":
    case "not_connected":
      return result;

    default: {
      const never: never = result;
      throw new Error(`unhandled publish result: ${String(never)}`);
    }
  }
}

/** One tweet, with the media ids the upload produced. Its URL comes from the read-back. */
async function createPost(session: Session, mediaIds: readonly string[]): Promise<PublishResult> {
  const payload: Record<string, unknown> = { text: xText(session.input) };
  if (mediaIds.length > 0) payload.media = { media_ids: mediaIds };

  const answer = await session.transport.send(
    await signedCall(session.credentials, {
      method: "POST",
      url: `${X_API}/tweets`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );

  if (answer.kind === "dry_run") return DRY_RUN;
  if (answer.status >= 400) return xFailure(answer.status, answer.body);

  const id = tweetId(answer.body);
  if (!id) return { status: "uncertain", detail: "the tweet call answered without an id" };

  return { status: "published", platformPostId: id, permalink: null };
}

/** The read-back: the platform's own id and handle, or `uncertain` when they do not agree. */
async function readBack(session: Session, platformPostId: string): Promise<PublishResult> {
  const answer = await session.transport.send(
    await signedCall(session.credentials, {
      method: "GET",
      url:
        `${X_API}/tweets/${encodeURIComponent(platformPostId)}` +
        `?tweet.fields=id&expansions=author_id&user.fields=username`,
    }),
  );

  if (answer.kind === "dry_run") return DRY_RUN;

  if (answer.status >= 400) {
    return {
      status: "uncertain",
      detail: "the platform accepted it but the read-back failed — check the account before retrying",
      platformError: parseXError(answer.status, answer.body),
    };
  }

  const parsed = jsonObject(answer.body);
  const data = parsed && isRecord(parsed.data) ? parsed.data : null;
  const id = data && typeof data.id === "string" ? data.id : null;
  if (id !== platformPostId) {
    return {
      status: "uncertain",
      detail: "the read-back returned a different post than the one that was created",
    };
  }

  return { status: "published", platformPostId: id, permalink: permalinkFor(parsed, id), raw: parsed };
}

/**
 * X's v2 read-back has no permalink field (docs.x.com — "Post lookup by Post ID"), so the canonical
 * `x.com/<username>/status/<id>` form is built from the platform's own username and id. No username
 * in the answer means null: a guessed URL is worse than no link.
 */
function permalinkFor(answer: Record<string, unknown> | null, id: string): string | null {
  const includes = answer && isRecord(answer.includes) ? answer.includes : null;
  const users = includes && Array.isArray(includes.users) ? includes.users : [];
  const author = users.find(isRecord);
  const username = author && typeof author.username === "string" ? author.username : null;
  return username ? `https://x.com/${username}/status/${id}` : null;
}

/**
 * What an X refusal means.
 *
 *  - **402** is money: the account is out of prepaid credits. The verdict is still `failed`, but its
 *    code is pinned to the status so the queue recognises it as a cost problem and stops
 *    (`PAYMENT_REQUIRED_CODE`) instead of spending three retries proving it.
 *  - **401** is the signature or the token, and neither is fixed by sending the same thing again:
 *    the channel needs a human (`spec: platform-connections, "An expired token flips the channel"`).
 */
export function xFailure(status: number, body: string): PublishResult {
  const platformError = parseXError(status, body);

  if (status === 402) {
    return { status: "failed", platformError: { ...platformError, code: PAYMENT_REQUIRED_CODE } };
  }
  if (status === 401) return { status: "reauth_required", platformError };
  return { status: "failed", platformError };
}

/**
 * The platform's own code and message, kept verbatim (spec: publishers §3).
 *
 * Two shapes, one meaning: v1.1 answers `{"errors":[{"code","message"}]}`, v2 answers a problem
 * document `{"title","detail","type","status"}`. When it is neither, the HTTP status and the first
 * 200 characters are kept — an operator can act on a proxy's words, not on a paraphrase.
 */
function parseXError(status: number, body: string): PlatformError {
  const parsed = jsonObject(body);

  const errors = parsed && Array.isArray(parsed.errors) ? parsed.errors : [];
  const first = errors.find(isRecord);
  if (first && typeof first.message === "string") {
    const code =
      typeof first.code === "number" || typeof first.code === "string"
        ? String(first.code)
        : `HTTP_${status}`;
    return { code, message: first.message };
  }

  if (parsed && typeof parsed.detail === "string") return { code: `HTTP_${status}`, message: parsed.detail };
  if (parsed && typeof parsed.title === "string") return { code: `HTTP_${status}`, message: parsed.title };

  return { code: `HTTP_${status}`, message: body.slice(0, 200) || `HTTP ${status}` };
}

/**
 * One video, or up to four images. The ceiling is the spec engine's (`PLATFORM_RULES.x.mediaMax`,
 * generated from `social/x/specs.md`), not a second copy of "4"; the one rule the spec engine cannot
 * express is that X rejects a post mixing the two — that lives here.
 */
function mediaShape(
  media: readonly PublishMedia[],
): { ok: true } | { ok: false; message: string } {
  const videos = media.filter((item) => item.kind === "video").length;
  if (videos > 1 || (videos === 1 && media.length > 1) || media.length > X_MAX_IMAGES) {
    return {
      ok: false,
      message:
        `X carries one video or up to ${X_MAX_IMAGES} images, never both in one post; ` +
        `this variant has ${media.length} media items`,
    };
  }
  return { ok: true };
}

/** Not connected, and the reason names the fields the channel is missing. */
function signedOut(missing: string[]): PublishResult {
  return {
    status: "not_connected",
    reason: `the x channel is missing ${missing.join(", ")} — reconnect it with all four OAuth 1.0a values`,
  };
}

/** Processing is not a failure: the job parks and polls this media id on a later tick. */
function parked(step: { mediaId: string; afterMs: number }): PublishResult {
  return {
    status: "awaiting_platform",
    detail: `X is still processing media ${step.mediaId}`,
    resume: { afterMs: step.afterMs, containerId: step.mediaId },
  };
}

function stepResult(
  step: Exclude<MediaStep, { kind: "uploaded" } | { kind: "processing" }>,
): PublishResult {
  switch (step.kind) {
    case "dry_run":
      return DRY_RUN;
    case "refused":
      return xFailure(step.status, step.body);
    case "failed":
      return { status: "failed", platformError: step.platformError };
    default: {
      const never: never = step;
      throw new Error(`unhandled media step: ${String(never)}`);
    }
  }
}

function previewNotes(input: PublishInput, creditsConfigured: boolean): string[] {
  const link = LINK_PATTERN.test(xText(input));
  const notes = [
    `X is a paid call: $${X_COST_PER_POST_USD.toFixed(3)} per post, ` +
      `$${X_COST_PER_POST_WITH_LINK_USD.toFixed(2)} when it carries a link (docs/001-PRD.md §8) — ` +
      `this variant is priced as ${link ? "a post with a link" : "a post without a link"}.`,
  ];
  if (!creditsConfigured) notes.push(X_CREDITS_MISSING);
  if (input.media.length > 0) notes.push(MEDIA_NOTE);
  return notes;
}

/** The id out of a create answer (`{"data":{"id":…}}`), or null when there is none. */
function tweetId(body: string): string | null {
  const parsed = jsonObject(body);
  const data = parsed && isRecord(parsed.data) ? parsed.data : null;
  return data && typeof data.id === "string" && data.id.length > 0 ? data.id : null;
}

function jsonObject(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
