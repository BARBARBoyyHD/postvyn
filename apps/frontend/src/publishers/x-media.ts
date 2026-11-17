/**
 * X's chunked media upload: the bytes go up in pieces before the post can name them.
 *
 * Meta fetches a URL; X does not. A post with media is therefore INIT (announce the size) → APPEND
 * (one piece per call) → FINALIZE (ask it to process) → STATUS (poll) → tweet. Video processing is not
 * instant, and a Worker cannot wait, so a FINALIZE that answers `pending` is what parks the job as
 * `awaiting_platform` — the media id rides in the job payload, exactly like a Meta container id, so
 * the resume polls instead of uploading the file a second time.
 *
 * This module reports what the platform said and stops there: whether a refusal is retryable, a
 * re-authorisation or a cost problem is the flow's decision (`x.ts`), not the upload's.
 */
import type { PlatformError, PublishMedia } from "./port";
import { signedCall, type XCredentials } from "./x-oauth";
import type { Transport } from "./transport";

/** X's media endpoint — `docs/003-ITA.md` §7 pins X to `api.x.com` for upload and post. */
export const X_UPLOAD_URL = "https://api.x.com/1.1/media/upload.json";

/**
 * At most 5 MB per APPEND segment (X's chunked-upload reference: "each segment may be up to 5 MB,
 * and a segment index is 0-based"). Bigger chunks are rejected, smaller ones waste round trips.
 *
 * shortcut: every chunk is sent inside the one invocation that started the upload, so a video long
 * enough to outlast a Worker request would need a byte cursor in the job payload; upgrade when a real
 * file parks mid-upload (X's own ceiling is 512 MB).
 */
export const X_UPLOAD_CHUNK_BYTES = 5 * 1024 * 1024;

/** Wait this long for processing when FINALIZE does not say; STATUS answers carry `check_after_secs`. */
export const X_MEDIA_POLL_MS = 5_000;

/**
 * `media_category` decides what the bytes are for. A tweet carries either one video or up to four
 * images, never both, so the two categories are the whole vocabulary here.
 */
const CATEGORY = { video: "tweet_video", image: "tweet_image" } as const;

/**
 * The content repo produces one 8.7 MB MP4 (`docs/005-REQUIREMENTS.md` §7) and nothing else, and
 * `PublishMedia` carries no MIME type — so the container is named here rather than guessed per file.
 */
const VIDEO_MIME = "video/mp4";

export interface UploadSession {
  transport: Transport;
  credentials: XCredentials;
}

export type MediaStep =
  | { kind: "uploaded"; mediaId: string }
  /** FINALIZE (or STATUS) says "not yet": the caller parks the job and polls the same id later. */
  | { kind: "processing"; mediaId: string; afterMs: number }
  | { kind: "dry_run" }
  /** The platform answered and refused. Its own body, for the flow to quote verbatim. */
  | { kind: "refused"; status: number; body: string }
  /**
   * No verdict from the platform: the bytes never arrived, it processed them to `failed`, or it
   * answered without a media id. Retrying is safe — a media id is not a post.
   */
  | { kind: "failed"; platformError: PlatformError };

/** Download the bytes, then INIT → APPEND × n → FINALIZE. */
export async function uploadMedia(
  session: UploadSession,
  media: PublishMedia,
): Promise<MediaStep> {
  const downloaded = await session.transport.download(media.url);
  if (downloaded.kind === "dry_run") return { kind: "dry_run" };

  if (downloaded.status >= 400 || downloaded.bytes.length === 0) {
    return {
      kind: "failed",
      platformError: {
        code: "media_unreachable",
        message:
          `media ${media.id} could not be downloaded (HTTP ${downloaded.status}, ` +
          `${downloaded.bytes.length} bytes) from ${media.url}`,
      },
    };
  }

  const bytes = downloaded.bytes;
  const init = await session.transport.send(
    await signedCall(session.credentials, {
      method: "POST",
      url: `${X_UPLOAD_URL}?${initParams(media.kind, bytes.length)}`,
    }),
  );
  if (init.kind === "dry_run") return { kind: "dry_run" };
  if (init.status >= 400) return { kind: "refused", status: init.status, body: init.body };

  const mediaId = mediaIdOf(init.body);
  if (!mediaId) {
    return {
      kind: "failed",
      platformError: { code: "media_id_missing", message: `INIT answered without an id: ${init.body.slice(0, 200)}` },
    };
  }

  for (let index = 0; index * X_UPLOAD_CHUNK_BYTES < bytes.length; index += 1) {
    // A view, not a copy: an 11 MB file in a Worker has no memory to spend on duplicated chunks.
    const chunk = bytes.subarray(index * X_UPLOAD_CHUNK_BYTES, (index + 1) * X_UPLOAD_CHUNK_BYTES);
    const appended = await session.transport.send(
      await signedCall(session.credentials, {
        method: "POST",
        url: `${X_UPLOAD_URL}?command=APPEND&media_id=${encodeURIComponent(mediaId)}&segment_index=${index}`,
        headers: { "content-type": "application/octet-stream" },
        bodyBytes: chunk,
      }),
    );
    if (appended.kind === "dry_run") return { kind: "dry_run" };
    if (appended.status >= 400) {
      return { kind: "refused", status: appended.status, body: appended.body };
    }
  }

  const finalized = await session.transport.send(
    await signedCall(session.credentials, {
      method: "POST",
      url: `${X_UPLOAD_URL}?command=FINALIZE&media_id=${encodeURIComponent(mediaId)}`,
    }),
  );
  if (finalized.kind === "dry_run") return { kind: "dry_run" };
  if (finalized.status >= 400) {
    return { kind: "refused", status: finalized.status, body: finalized.body };
  }

  return readProcessing(mediaId, finalized.body);
}

/** Ask again about a media id whose processing was still running last time. */
export async function pollMedia(session: UploadSession, mediaId: string): Promise<MediaStep> {
  const answer = await session.transport.send(
    await signedCall(session.credentials, {
      method: "GET",
      url: `${X_UPLOAD_URL}?command=STATUS&media_id=${encodeURIComponent(mediaId)}`,
    }),
  );
  if (answer.kind === "dry_run") return { kind: "dry_run" };
  if (answer.status >= 400) return { kind: "refused", status: answer.status, body: answer.body };
  return readProcessing(mediaId, answer.body);
}

/** INIT names the size up front, because APPEND cannot: each segment is just more bytes. */
function initParams(kind: PublishMedia["kind"], totalBytes: number): string {
  const params = new URLSearchParams({
    command: "INIT",
    total_bytes: String(totalBytes),
    media_category: CATEGORY[kind],
  });
  if (kind === "video") params.set("media_type", VIDEO_MIME);
  return params.toString();
}

/**
 * What a FINALIZE/STATUS answer means. `succeeded` and no `processing_info` are both "ready" — an
 * image never has processing to wait for; `failed` carries the platform's own code and message.
 */
function readProcessing(mediaId: string, body: string): MediaStep {
  const parsed = record(body);
  const info = parsed && isRecord(parsed.processing_info) ? parsed.processing_info : null;
  const state = info && typeof info.state === "string" ? info.state : "";

  if (state === "failed") {
    const error = info && isRecord(info.error) ? info.error : null;
    const code = error && typeof error.code === "number" ? String(error.code) : "processing_failed";
    const message =
      error && typeof error.message === "string" ? error.message : `media ${mediaId} failed processing`;
    return { kind: "failed", platformError: { code, message } };
  }

  if (state === "pending" || state === "in_progress") {
    const wait = info && typeof info.check_after_secs === "number" ? info.check_after_secs : null;
    return { kind: "processing", mediaId, afterMs: wait === null ? X_MEDIA_POLL_MS : wait * 1000 };
  }

  return { kind: "uploaded", mediaId };
}

function mediaIdOf(body: string): string | null {
  const parsed = record(body);
  if (!parsed) return null;
  if (typeof parsed.media_id_string === "string" && parsed.media_id_string) {
    return parsed.media_id_string;
  }
  return typeof parsed.media_id === "number" ? String(parsed.media_id) : null;
}

function record(body: string): Record<string, unknown> | null {
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
