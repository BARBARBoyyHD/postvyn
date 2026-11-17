/**
 * YouTube, through Data API v3: a resumable upload in chunks, then a read-back before `published`.
 *
 * Three things make YouTube different from the Meta platforms, and all three are visible from here:
 *
 *  - **The upload is long and resumable.** Initiate (`uploadType=resumable`) answers a session URL, the
 *    bytes go up in ranged `PUT`s streamed from the media's public R2 URL, and the final one answers the
 *    video id. A Worker cannot hold a video, so nothing is buffered: each chunk is fetched by offset.
 *  - **Interruption parks, never restarts.** A failed or truncated `PUT` parks the job carrying the
 *    session URL and the byte offset, and the next tick asks the session how much it has and continues
 *    from there — one upload, not one per tick (m5 4.3's container pattern, design decision 3).
 *  - **Quota is the scarce resource, not money.** One comment block below carries the numbers and their
 *    source; the preview states them before the first byte moves, and the estimate is stored with the
 *    result (non-negotiable 6, design decision 5). Shown, not enforced.
 *
 * The metadata mapping is a product decision, not an adapter convenience (design decision 6): the post's
 * title is `snippet.title`, the caption plus hashtags is `snippet.description`, and the hashtags are the
 * tags. Variants carry no title field, and v1 does not add one for a single platform.
 *
 * A 200 is not success here either: `videos.list` must report the id as `processed` with the privacy and
 * title we sent before the variant becomes `published` (non-negotiable 4).
 */
import {
  isShortShaped,
  YOUTUBE_DESCRIPTION_MAX_BYTES,
  YOUTUBE_MEDIA_MAX,
  YOUTUBE_SHORTS_TAG,
  utf8Bytes,
  youtubeDescription,
  youtubeTags,
} from "@/lib/specs/youtube-rules";
import {
  DRY_RUN,
  previewFlow,
  type Preview,
  type Publisher,
  type PublishInput,
  type QuotaEstimate,
  type PublishResult,
} from "./port";
import type { Transport, TransportReply } from "./transport";
import {
  isRecord,
  jsonObject,
  mintAccessToken,
  parseGoogleError,
  YOUTUBE_API,
  YOUTUBE_UPLOAD_URL,
  youtubeCredentials,
  type YoutubeCredentials,
} from "./youtube-auth";

// Source: YouTube Data API v3 Quota Calculator, developers.google.com/youtube/v3/determine_quota_cost,
// read 2026-11-17: default allocation = 100 videos.insert calls/day (its own "Video Uploads" bucket,
// 1 unit each) + 10,000 units/day for all other endpoints combined (videos.list = 1 unit);
// daily reset midnight Pacific Time. The older model most guides still quote — 1,600 units per
// insert from a 10,000/16,000-unit shared pool ≈ 6–10 uploads/day — predates Google's quota
// revision (~June 2026) and must not be used for display. If the project's Google Cloud Console →
// Quota page disagrees, THE CONSOLE WINS: update these constants and this read date. Same stance as
// Meta's content_publishing_limit endpoint.
export const YOUTUBE_UPLOAD_SLOTS_PER_DAY_DEFAULT = 100;
export const YOUTUBE_UPLOAD_SLOT_UNITS = 1;
export const YOUTUBE_GENERAL_UNITS_PER_DAY_DEFAULT = 10_000;
export const YOUTUBE_READ_BACK_UNITS = 1;
export const YOUTUBE_QUOTA_RESET_AT = "midnight Pacific Time";

/**
 * How many bytes one `PUT` carries: 8 MiB.
 *
 * Source: YouTube Data API v3, "Resumable uploads", developers.google.com/youtube/v3/guides/
 * using_resumable_upload_protocol, read 2026-11-17: each chunk must be a multiple of 256 KB, and the
 * guide's own examples use 8 MB. Bigger chunks mean fewer round trips and fewer parks; the file's last
 * chunk is whatever is left.
 */
export const YOUTUBE_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

/** How long a park lasts before the next look. The five-minute cron tick is the real cadence. */
export const YOUTUBE_PARK_MS = 60_000;

/**
 * How many read-backs one upload may park for: ten polls, which is most of an hour at the cron cadence.
 * Outliving it is `uncertain`, never `published` — a video that never finishes processing is a human's
 * question, and the poll costs one unit of the shared bucket each time (design decision 5).
 */
export const YOUTUBE_READ_BACK_POLLS = 10;

/**
 * The visibility every publish asks for. Not configurable in v1: the board publishes, and a private
 * upload would be a post nobody sees. The read-back compares it, so a platform-side change to
 * `unlisted` is `uncertain` rather than silently accepted.
 */
const PRIVACY = "public";

/** The content type R2 serves the file as; YouTube uses it to pick the upload's decoder. */
const VIDEO_MIME = "video/mp4";

const NOT_CONNECTED = (missing: readonly string[]): PublishResult => ({
  status: "not_connected",
  reason: `the youtube channel is missing ${missing.join(", ")} — reconnect it with clientId, clientSecret and refreshToken`,
});

/** Everything one publish needs, in one argument: the content, the minted token, and where calls go. */
interface Session {
  input: PublishInput;
  credentials: YoutubeCredentials;
  token: string;
  transport: Transport;
}

export function youtubePublisher(options: { transport: Transport }): Publisher {
  const { transport } = options;

  return {
    platform: "youtube",

    estimateQuota(): QuotaEstimate {
      return quotaEstimate();
    },

    async preview(input: PublishInput): Promise<Preview> {
      return previewFlow(async (recording) => publishFlow(input, recording), previewNotes(input));
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      return publishFlow(input, transport);
    },

    async verify(result: PublishResult, input: PublishInput): Promise<PublishResult> {
      return verifyFlow(result, input, transport);
    },
  };
}

/** What one upload spends, in the platform's units — the number the preview shows and the queue stores. */
export function quotaEstimate(): QuotaEstimate {
  return {
    uploadSlots: YOUTUBE_UPLOAD_SLOT_UNITS,
    dailyUploadSlots: YOUTUBE_UPLOAD_SLOTS_PER_DAY_DEFAULT,
    readUnits: YOUTUBE_READ_BACK_UNITS,
    dailyReadUnits: YOUTUBE_GENERAL_UNITS_PER_DAY_DEFAULT,
    resetsAt: YOUTUBE_QUOTA_RESET_AT,
  };
}

/**
 * What the operator is told before the first byte moves: the quota this publish spends, and how YouTube
 * will categorise the file. Both are disclosure, not validation — YouTube accepts a wide or a long file,
 * it just puts it somewhere else than the operator may have aimed at.
 */
export function previewNotes(input: PublishInput): string[] {
  const quota = quotaEstimate();
  const notes = [
    `YouTube Data API quota: this upload spends ${quota.uploadSlots} of ${quota.dailyUploadSlots} ` +
      `upload slots for the day, plus ${quota.readUnits} of ${quota.dailyReadUnits} read units for the ` +
      `read-back; the window resets at ${quota.resetsAt}. Shown, not enforced.`,
  ];

  const media = input.media[0];
  const short = media ? isShortShaped(media.width, media.height) : false;
  notes.push(
    short
      ? `Square or vertical file: YouTube will categorize this as a Short, and #Shorts is appended to ` +
          `the description if absent. Three minutes is the other half of the test, and this app does ` +
          `not measure video duration — YouTube decides.`
      : `Wide or unmeasured file: YouTube will treat this as a long-form video, not a Short.`,
  );

  return notes;
}

async function publishFlow(input: PublishInput, transport: Transport): Promise<PublishResult> {
  const found = youtubeCredentials(input.credentials);
  if (!found.ok) return NOT_CONNECTED(found.missing);

  const media = input.media[0];
  if (!media) {
    return {
      status: "failed",
      platformError: { code: "media_required", message: "YouTube uploads one video, and the variant has none" },
    };
  }
  if (input.media.length > YOUTUBE_MEDIA_MAX || media.kind !== "video") {
    return {
      status: "failed",
      platformError: {
        code: "media_unsupported",
        message: `YouTube v1 uploads exactly one video; this variant has ${input.media.length} media item(s)`,
      },
    };
  }

  const minted = await mintAccessToken({ credentials: found.credentials, transport });
  if (!minted.ok) {
    return minted.reauth
      ? { status: "reauth_required", platformError: minted.platformError }
      : { status: "failed", platformError: minted.platformError };
  }

  return startUpload({ input, credentials: found.credentials, token: minted.accessToken, transport });
}

async function verifyFlow(
  result: PublishResult,
  input: PublishInput,
  transport: Transport,
): Promise<PublishResult> {
  // Anything but a park is already answered. A `published` result was gated on `videos.list` in the
  // same invocation, and re-confirming it would spend a unit of a scarce budget — worse, a token that
  // died since would turn a success into a failure for a call that proved nothing.
  if (result.status !== "awaiting_platform") return result;

  const target = resumeTarget(result.resume.containerId);
  if (!target) {
    return { status: "uncertain", detail: "the parked job carries nothing this adapter can resume" };
  }

  const found = youtubeCredentials(input.credentials);
  if (!found.ok) return NOT_CONNECTED(found.missing);

  // A resume needs a fresh token as much as an upload does: the minted one lives about an hour and
  // nothing keeps it between invocations.
  const minted = await mintAccessToken({ credentials: found.credentials, transport });
  if (!minted.ok) {
    return minted.reauth
      ? { status: "reauth_required", platformError: minted.platformError }
      : { status: "failed", platformError: minted.platformError };
  }
  const session: Session = { input, credentials: found.credentials, token: minted.accessToken, transport };

  return target.kind === "upload"
    ? resumeUpload(session, target.sessionUrl, target.offset)
    : readBack(session, target.videoId, target.polls);
}

/** Ask for the media's size, then open a resumable session and start pushing bytes. */
async function startUpload(session: Session): Promise<PublishResult> {
  const size = await mediaSize(session);
  if (size.kind === "dry_run") return DRY_RUN;
  if (size.kind === "unreachable") return unreachable(session.input.media[0].url);

  const initiated = await initiateSession(session, size.bytes);
  if (initiated.kind === "dry_run") return DRY_RUN;
  if (initiated.kind !== "session") return initiated.result;

  return uploadChunks(session, initiated.sessionUrl, 0, size.bytes);
}

/**
 * Continue a session that already exists.
 *
 * Before sending a byte: ask the session how much it has. That single call is also the design's ambiguity
 * rule — if the final `PUT`'s response was lost, this says "complete" and the read-back takes over
 * instead of a blind re-upload (a double post is worse than `uncertain`).
 */
async function resumeUpload(
  session: Session,
  sessionUrl: string,
  parkedOffset: number,
): Promise<PublishResult> {
  const size = await mediaSize(session);
  if (size.kind === "dry_run") return DRY_RUN;
  if (size.kind === "unreachable") return unreachable(session.input.media[0].url);

  const status = await sessionStatus(session, sessionUrl, size.bytes);
  if (status.kind === "dry_run") return DRY_RUN;
  if (status.kind === "complete") return readBack(session, status.videoId, 0);
  if (status.kind === "failed") return status.result;

  // What the platform reports beats what the payload remembers: the bytes may have landed after the
  // response that failed to reach us.
  return uploadChunks(session, sessionUrl, Math.max(status.offset, parkedOffset), size.bytes);
}

/** `PUT` the file in chunks from the public URL; the final answer names the video. */
async function uploadChunks(
  session: Session,
  sessionUrl: string,
  from: number,
  total: number,
): Promise<PublishResult> {
  let offset = from;

  while (offset < total) {
    const length = Math.min(YOUTUBE_UPLOAD_CHUNK_BYTES, total - offset);
    const chunk = await session.transport.download(session.input.media[0].url, { offset, length });
    if (chunk.kind === "dry_run") return DRY_RUN;
    if (chunk.status >= 400 || chunk.bytes.length === 0) return unreachable(session.input.media[0].url);

    const answer = await session.transport.send({
      method: "PUT",
      url: sessionUrl,
      headers: {
        "content-length": String(chunk.bytes.length),
        "content-range": `bytes ${offset}-${offset + chunk.bytes.length - 1}/${total}`,
        "content-type": VIDEO_MIME,
      },
      bodyBytes: chunk.bytes,
    });
    if (answer.kind === "dry_run") return DRY_RUN;

    const verdict = chunkVerdict(answer, offset, chunk.bytes.length);
    if (verdict.kind === "continue") {
      offset = verdict.offset;
      continue;
    }
    if (verdict.kind === "complete") return readBack(session, verdict.videoId, 0);
    if (verdict.kind === "parked") {
      return {
        status: "awaiting_platform",
        detail: `the upload stopped at byte ${offset}: ${verdict.detail}`,
        resume: { afterMs: YOUTUBE_PARK_MS, containerId: uploadToken(sessionUrl, offset) },
      };
    }
    return verdict.result;
  }

  return {
    status: "uncertain",
    detail: "the upload session ended without naming a video — check the channel before retrying",
  };
}

type ChunkVerdict =
  /** 308: more bytes wanted, from this offset. */
  | { kind: "continue"; offset: number }
  | { kind: "complete"; videoId: string }
  | { kind: "parked"; detail: string }
  /** The platform refused, or answered something no state machine covers. */
  | { kind: "result"; result: PublishResult };

/**
 * What one chunked `PUT` means.
 *
 * 308 is YouTube's "not finished": its `range` header says how many bytes it has. 200/201 is the finished
 * upload and carries the video resource. 5xx and a lost body are parks — the session is still alive and
 * resuming is cheaper than a second upload slot. A 4xx is the platform's answer to this content, and
 * re-sending it changes nothing.
 */
function chunkVerdict(answer: TransportReply, offset: number, sent: number): ChunkVerdict {
  if (answer.kind === "dry_run") return { kind: "result", result: DRY_RUN };

  if (answer.status === 308) {
    return { kind: "continue", offset: receivedOffset(answer) ?? offset + sent };
  }

  if (answer.status === 200 || answer.status === 201) {
    const id = videoIdFrom(answer.body);
    if (!id) return { kind: "result", result: { status: "uncertain", detail: "the upload answered without a video id" } };
    return { kind: "complete", videoId: id };
  }

  if (answer.status >= 400 && answer.status < 500) {
    return {
      kind: "result",
      result: { status: "failed", platformError: parseGoogleError(answer.status, answer.body) },
    };
  }

  return { kind: "parked", detail: `HTTP ${answer.status}` };
}

type SessionStatus =
  | { kind: "continue"; offset: number }
  | { kind: "complete"; videoId: string }
  | { kind: "dry_run" }
  | { kind: "failed"; result: PublishResult };

/** Ask the session how much of the file it has: `Content-Range: bytes * /total`, no body. */
async function sessionStatus(session: Session, sessionUrl: string, total: number): Promise<SessionStatus> {
  const answer = await session.transport.send({
    method: "PUT",
    url: sessionUrl,
    headers: { "content-range": `bytes */${total}` },
  });

  if (answer.kind === "dry_run") return { kind: "dry_run" };

  if (answer.status === 308) {
    return { kind: "continue", offset: receivedOffset(answer) ?? 0 };
  }

  if (answer.status === 200 || answer.status === 201) {
    const id = videoIdFrom(answer.body);
    return id
      ? { kind: "complete", videoId: id }
      : { kind: "failed", result: { status: "uncertain", detail: "the session completed without a video id" } };
  }

  return {
    kind: "failed",
    result: { status: "failed", platformError: parseGoogleError(answer.status, answer.body) },
  };
}

/**
 * The gate: `videos.list` must report the video processed, public and titled as sent.
 *
 * Every branch that is not exactly that is either a park (still processing, within budget), a terminal
 * failure (YouTube rejected it, quoted verbatim), or `uncertain` (it disagrees with what we sent, or it
 * is not there at all). None of them is `published`.
 */
async function readBack(session: Session, videoId: string, polls: number): Promise<PublishResult> {
  const answer = await session.transport.send({
    method: "GET",
    url: `${YOUTUBE_API}/videos?part=id,snippet,status&id=${encodeURIComponent(videoId)}`,
    headers: { authorization: `Bearer ${session.token}` },
  });

  if (answer.kind === "dry_run") return DRY_RUN;

  if (answer.status >= 400) {
    return {
      status: "uncertain",
      detail: "the platform accepted it but the read-back failed — check the channel before retrying",
      platformError: parseGoogleError(answer.status, answer.body),
    };
  }

  const item = firstVideo(answer.body, videoId);
  if (!item) {
    return {
      status: "uncertain",
      detail: `YouTube does not list video ${videoId} — check the channel before retrying`,
    };
  }

  const status = isRecord(item.status) ? item.status : {};
  const uploadStatus = typeof status.uploadStatus === "string" ? status.uploadStatus : "";

  if (uploadStatus === "rejected" || uploadStatus === "failed") {
    const reason = [status.rejectionReason, status.failureReason].find(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    return {
      status: "failed",
      platformError: {
        code: uploadStatus,
        message: reason ?? `YouTube reports the upload as ${uploadStatus}`,
      },
    };
  }

  if (uploadStatus !== "processed") {
    return polls + 1 > YOUTUBE_READ_BACK_POLLS
      ? {
          status: "uncertain",
          detail:
            `video ${videoId} is still ${uploadStatus || "unreported"} after ${YOUTUBE_READ_BACK_POLLS} ` +
            `read-backs — check the channel`,
        }
      : {
          status: "awaiting_platform",
          detail: `YouTube is still processing video ${videoId} (${uploadStatus || "unreported"})`,
          resume: { afterMs: YOUTUBE_PARK_MS, containerId: videoToken(videoId, polls + 1) },
        };
  }

  const snippet = isRecord(item.snippet) ? item.snippet : {};
  const privacyStatus = typeof status.privacyStatus === "string" ? status.privacyStatus : "";
  const title = typeof snippet.title === "string" ? snippet.title : "";
  const wanted = session.input.title.trim();

  if (privacyStatus !== PRIVACY || title !== wanted) {
    return {
      status: "uncertain",
      detail:
        `the read-back disagrees with what was sent (privacy ${privacyStatus || "unknown"}, ` +
        `title "${title}") — check the channel before reposting`,
    };
  }

  return {
    status: "published",
    platformPostId: videoId,
    permalink: watchUrl(videoId),
    raw: item,
  };
}

/** Open the session: metadata now, bytes after. The session URL only ever comes from `location`. */
async function initiateSession(
  session: Session,
  total: number,
): Promise<{ kind: "session"; sessionUrl: string } | { kind: "dry_run" } | { kind: "failed"; result: PublishResult }> {
  const answer = await session.transport.send({
    method: "POST",
    url: `${YOUTUBE_UPLOAD_URL}?uploadType=resumable&part=snippet,status`,
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-length": String(total),
      "x-upload-content-type": VIDEO_MIME,
    },
    body: JSON.stringify(metadata(session.input)),
  });

  if (answer.kind === "dry_run") return { kind: "dry_run" };
  if (answer.status >= 400) {
    return {
      kind: "failed",
      result: { status: "failed", platformError: parseGoogleError(answer.status, answer.body) },
    };
  }

  const sessionUrl = answer.headers?.location;
  if (!sessionUrl) {
    return {
      kind: "failed",
      result: {
        status: "failed",
        platformError: {
          code: "no_upload_session",
          message: "the upload call answered without a session location",
        },
      },
    };
  }

  return { kind: "session", sessionUrl };
}

/**
 * `snippet` + `status`, in YouTube's own field names.
 *
 * The description is the caption plus the hashtags (they spend its budget, which the spec engine
 * counted). `#Shorts` is appended for a square or vertical file when it still fits — the convention,
 * and no reason to spend a rejection on nine bytes.
 */
export function metadata(input: PublishInput): Record<string, unknown> {
  const media = input.media[0];
  const description = youtubeDescription(input.caption, input.hashtags);
  const tags = youtubeTags(input.hashtags);
  const short = media ? isShortShaped(media.width, media.height) : false;
  const withTag =
    short && utf8Bytes(`${description}\n\n${YOUTUBE_SHORTS_TAG}`) <= YOUTUBE_DESCRIPTION_MAX_BYTES
      ? `${description}\n\n${YOUTUBE_SHORTS_TAG}`
      : description;

  return {
    snippet: {
      title: input.title.trim(),
      description: withTag,
      ...(tags.length > 0 ? { tags } : {}),
      // Required by `videos.insert` (same reference, read 2026-11-17); 22 is "People & Blogs", the
      // catch-all the API's own examples use. Not a product setting in v1.
      categoryId: "22",
    },
    status: {
      privacyStatus: PRIVACY,
      // Required by the API for new uploads: the audience declaration, not a product setting.
      selfDeclaredMadeForKids: false,
    },
  };
}

/** The file's size, from the URL the platform will fetch. R2 answers `content-length` on a HEAD. */
type MediaSize = { kind: "dry_run" } | { kind: "bytes"; bytes: number } | { kind: "unreachable" };

async function mediaSize(session: Session): Promise<MediaSize> {
  const answer = await session.transport.send({ method: "HEAD", url: session.input.media[0].url });
  if (answer.kind === "dry_run") return { kind: "dry_run" };

  const raw = answer.headers?.["content-length"];
  const size = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(size) && size > 0 ? { kind: "bytes", bytes: size } : { kind: "unreachable" };
}

function unreachable(url: string): PublishResult {
  return {
    status: "failed",
    platformError: {
      code: "media_unreachable",
      message: `the media URL ${url} could not be ranged, so no byte reached YouTube`,
    },
  };
}

/**
 * The resume token that rides on a parked job.
 *
 * `containerId` is one string, so it carries what the next tick needs to know: a live upload session and
 * where it stopped, or a video id and how many read-backs it has already cost.
 */
function uploadToken(sessionUrl: string, offset: number): string {
  return `upload:${offset}:${sessionUrl}`;
}

function videoToken(videoId: string, polls: number): string {
  return `video:${polls}:${videoId}`;
}

export type ResumeTarget =
  | { kind: "upload"; sessionUrl: string; offset: number }
  | { kind: "video"; videoId: string; polls: number };

/** Read a park token back, or null when it is not one this adapter wrote. */
function resumeTarget(token: string | undefined): ResumeTarget | null {
  if (!token) return null;
  const [kind, count, ...rest] = token.split(":");
  const value = rest.join(":");
  const number = Number.parseInt(count ?? "", 10);

  if (kind === "upload" && value && Number.isFinite(number) && number >= 0) {
    return { kind: "upload", sessionUrl: value, offset: number };
  }
  if (kind === "video" && value && Number.isFinite(number) && number > 0) {
    return { kind: "video", videoId: value, polls: number };
  }
  return null;
}

/** The video's canonical URL, built from the id the read-back returned and nothing else. */
function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function videoIdFrom(body: string): string | null {
  const parsed = jsonObject(body);
  return parsed && typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : null;
}

/** The single item `videos.list` returns for an id, or null when it lists nothing. */
function firstVideo(body: string, videoId: string): Record<string, unknown> | null {
  const parsed = jsonObject(body);
  const items = parsed && Array.isArray(parsed.items) ? parsed.items : [];
  const item = items.find(isRecord);
  return item && item.id === videoId ? item : null;
}

/** `range: bytes=0-899999` → 900000, the offset the next chunk starts at. */
function receivedOffset(answer: Exclude<TransportReply, { kind: "dry_run" }>): number | null {
  const header = answer.headers?.range;
  if (!header) return null;
  const match = /bytes=\d+-(\d+)/.exec(header);
  return match ? Number.parseInt(match[1], 10) + 1 : null;
}
