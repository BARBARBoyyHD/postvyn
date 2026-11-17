/**
 * Threads, through Meta's Threads API.
 *
 * The flow is the one the PRD names (FR-08): create a container, poll its `status`, `threads_publish`
 * it, then read the post back. Text and image containers are usually finished immediately, so a post
 * that is ready publishes inside the request; a video is not, and then the job parks as
 * `awaiting_platform` instead of a Worker trying to sleep (design decision 3).
 *
 * Video goes through the same container flow as an image — Meta's only differences are which URL
 * parameter carries it and that processing takes longer.
 */
import {
  accessToken,
  containerReadiness,
  DRY_RUN,
  metaFailure,
  platformId,
  readBackAnswer,
  type ContainerReadiness,
} from "./meta";
import {
  previewFlow,
  type Publisher,
  type PublishInput,
  type PublishResult,
  type Preview,
} from "./port";
import type { Transport } from "./transport";

/** Meta's Threads API root. */
const GRAPH = "https://graph.threads.net/v1.0";

/**
 * Threads allows 250 posts per 24 hours per account — `docs/001-PRD.md` FR-08, Threads row:
 * "container → poll `status` → `threads_publish` | 250 posts / 24 h". It is surfaced in the preview
 * and not enforced here: `docs/003-ITA.md` §6 says the cap is read from the API, and only the platform
 * knows the real count (it answers error 613 when the account is over).
 */
export const THREADS_POSTS_PER_24H = 250;

/** How long a park lasts before the next poll. The cron tick is the real cadence; this is for a manual one. */
export const THREADS_CONTAINER_POLL_MS = 60_000;

/** At most one image or video: Threads' carousel is not wired (§3 asks for text and image). */
const MAX_MEDIA = 1;

const PREVIEW_NOTES = [
  `Threads allows ${THREADS_POSTS_PER_24H} posts per 24 h per account (docs/001-PRD.md FR-08); ` +
    `the platform rejects the next one, and this preview does not count them.`,
];

/** Everything one publish needs, in one argument: the content, its token, and where calls go. */
interface Session {
  input: PublishInput;
  token: string;
  transport: Transport;
}

export function threadsPublisher(options: { transport: Transport }): Publisher {
  const { transport } = options;

  return {
    platform: "threads",

    async preview(input: PublishInput): Promise<Preview> {
      return previewFlow(async (recording) => publishFlow(input, recording), PREVIEW_NOTES);
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      return publishFlow(input, transport);
    },

    async verify(result: PublishResult, input: PublishInput): Promise<PublishResult> {
      return verifyFlow(result, input, transport);
    },
  };
}

async function publishFlow(input: PublishInput, transport: Transport): Promise<PublishResult> {
  const token = accessToken(input);
  if (!token) return NOT_CONNECTED;

  if (input.media.length > MAX_MEDIA) {
    return {
      status: "failed",
      platformError: {
        code: "media_unsupported",
        message: `this adapter posts one image or video to Threads, and the variant has ${input.media.length}`,
      },
    };
  }

  const session: Session = { input, token, transport };
  const created = await transport.send({
    method: "POST",
    url: `${GRAPH}/${encodeURIComponent(input.accountRef)}/threads`,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
    body: containerParams(input).toString(),
  });

  if (created.kind === "dry_run") return DRY_RUN;
  if (created.status >= 400) return metaFailure(created.status, created.body);

  const containerId = platformId(created.body);
  if (!containerId) return { status: "uncertain", detail: "the container call answered without an id" };

  const readiness = await pollContainer(session, containerId);
  return readiness.ready ? publishContainer(session, containerId) : readiness.result;
}

async function verifyFlow(
  result: PublishResult,
  input: PublishInput,
  transport: Transport,
): Promise<PublishResult> {
  const token = accessToken(input);
  if (!token) return NOT_CONNECTED;
  const session: Session = { input, token, transport };

  switch (result.status) {
    case "published":
      return readBack(session, result.platformPostId);

    case "awaiting_platform": {
      const containerId = result.resume.containerId;
      if (!containerId) return { status: "uncertain", detail: "no container id to resume" };

      const readiness = await pollContainer(session, containerId);
      if (!readiness.ready) return readiness.result;

      const published = await publishContainer(session, containerId);
      if (published.status !== "published") return published;
      return readBack(session, published.platformPostId);
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

async function pollContainer(session: Session, containerId: string): Promise<ContainerReadiness> {
  const answer = await session.transport.send({
    method: "GET",
    url: `${GRAPH}/${containerId}?fields=status,status_code`,
    headers: { authorization: `Bearer ${session.token}` },
  });
  return containerReadiness(answer, {
    containerId,
    pollAfterMs: THREADS_CONTAINER_POLL_MS,
    statusField: "status",
  });
}

/** `threads_publish` — the container becomes a post. Its URL comes from the read-back, never from here. */
async function publishContainer(session: Session, containerId: string): Promise<PublishResult> {
  const published = await session.transport.send({
    method: "POST",
    url: `${GRAPH}/${encodeURIComponent(session.input.accountRef)}/threads_publish?creation_id=${encodeURIComponent(containerId)}`,
    headers: { authorization: `Bearer ${session.token}` },
  });

  if (published.kind === "dry_run") return DRY_RUN;
  if (published.status >= 400) return metaFailure(published.status, published.body);

  const postId = platformId(published.body);
  if (!postId) return { status: "uncertain", detail: "threads_publish answered without an id" };

  return { status: "published", platformPostId: postId, permalink: null };
}

async function readBack(session: Session, platformPostId: string): Promise<PublishResult> {
  const answer = await session.transport.send({
    method: "GET",
    url: `${GRAPH}/${platformPostId}?fields=id,permalink`,
    headers: { authorization: `Bearer ${session.token}` },
  });
  return readBackAnswer(answer, platformPostId);
}

const NOT_CONNECTED: PublishResult = {
  status: "not_connected",
  reason: "the threads channel has no accessToken",
};

/** Text, hashtags and one media URL, in the form Meta's `threads` endpoint expects. */
function containerParams(input: PublishInput): URLSearchParams {
  const media = input.media[0];
  const params = new URLSearchParams({ text: textFor(input) });

  if (!media) {
    params.set("media_type", "TEXT");
    return params;
  }

  params.set("media_type", media.kind === "video" ? "VIDEO" : "IMAGE");
  params.set(media.kind === "video" ? "video_url" : "image_url", media.url);
  return params;
}

/** Threads hashtags live inside the caption, so they spend its budget — the spec engine knows the ceiling. */
function textFor(input: PublishInput): string {
  return [input.caption.trim(), input.hashtags.join(" ")].filter(Boolean).join("\n\n");
}
