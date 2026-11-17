/**
 * Instagram, through the Graph API.
 *
 * One state machine, three shapes (`instagram-shapes.ts`). `publish()` creates the container and stops:
 * Meta's processing takes seconds to minutes, and a Worker cannot wait for it, so the container id rides
 * on the job and the next tick polls it (design decision 3 / m4 decision 4). `verify()` is where the
 * container becomes a post and the post is read back.
 *
 * Meta downloads the media itself, so every item arrives here as a public URL resolved by
 * `src/db/media.ts`. An adapter holding an id and no URL would have to guess, and a guessed URL fails at
 * Meta's end with a message nobody here can explain.
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
import { shapeFor, shapeNotes, shapeProblem, INSTAGRAM_SHAPES, type InstagramShapeName } from "./instagram-shapes";
import {
  previewFlow,
  type Publisher,
  type PublishInput,
  type PublishMedia,
  type PublishResult,
  type Preview,
} from "./port";
import type { Transport, TransportReply } from "./transport";

/** Graph root for Instagram content publishing (docs/003-ITA.md §6). */
const GRAPH = "https://graph.instagram.com/v1.0";

/** How long a park lasts before the next poll. The five-minute cron tick is the real cadence. */
export const INSTAGRAM_CONTAINER_POLL_MS = 60_000;

const NOT_CONNECTED: PublishResult = {
  status: "not_connected",
  reason: "the instagram channel has no accessToken",
};

/** Everything one publish needs, in one argument: the content, its token, and where calls go. */
interface Session {
  input: PublishInput;
  token: string;
  transport: Transport;
}

export function instagramPublisher(options: { transport: Transport }): Publisher {
  const { transport } = options;

  return {
    platform: "instagram",

    async preview(input: PublishInput): Promise<Preview> {
      return previewFlow(
        async (recording) => publishFlow(input, recording),
        shapeNotes(shapeFor(input.media)),
      );
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

  const shape = shapeFor(input.media);
  if (!shape) {
    return {
      status: "failed",
      platformError: {
        code: "media_required",
        message: "Instagram needs at least one image or video, and the variant has none",
      },
    };
  }

  const problem = shapeProblem(shape, input.media);
  if (problem) return { status: "failed", platformError: problem };

  return createContainer({ input, token, transport }, shape);
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

/**
 * Build the container — one call for an image or a reel, one per item plus a parent for a carousel.
 *
 * The answer is `awaiting_platform` either way: a fresh container is almost never finished, and
 * pretending it might be would mean a poll inside a request that cannot afford the wait.
 */
async function createContainer(session: Session, shape: InstagramShapeName): Promise<PublishResult> {
  const { input, token, transport } = session;
  const caption = textFor(input);
  const mediaUrl = `${GRAPH}/${account(input)}/media`;
  const headers = formHeaders(token);

  if (shape !== "CAROUSEL") {
    const mediaType = INSTAGRAM_SHAPES[shape].mediaType;
    const answer = await transport.send({
      method: "POST",
      url: mediaUrl,
      headers,
      body: new URLSearchParams({
        ...(mediaType ? { media_type: mediaType } : {}),
        ...mediaParam(input.media[0]),
        caption,
      }).toString(),
    });
    return containerAnswer(answer);
  }

  const children: string[] = [];
  for (const item of input.media) {
    const child = await transport.send({
      method: "POST",
      url: mediaUrl,
      headers,
      body: new URLSearchParams({ is_carousel_item: "true", ...mediaParam(item) }).toString(),
    });
    if (child.kind === "dry_run") return DRY_RUN;
    if (child.status >= 400) return metaFailure(child.status, child.body);
    const childId = platformId(child.body);
    if (!childId) return { status: "uncertain", detail: "a carousel item answered without an id" };
    children.push(childId);
  }

  const parent = await transport.send({
    method: "POST",
    url: mediaUrl,
    headers,
    body: new URLSearchParams({
      media_type: "CAROUSEL",
      children: children.join(","),
      caption,
    }).toString(),
  });
  return containerAnswer(parent);
}

function containerAnswer(answer: TransportReply): PublishResult {
  if (answer.kind === "dry_run") return DRY_RUN;
  if (answer.status >= 400) return metaFailure(answer.status, answer.body);

  const containerId = platformId(answer.body);
  if (!containerId) return { status: "uncertain", detail: "the container call answered without an id" };

  return {
    status: "awaiting_platform",
    detail: "container created; Meta has not finished processing it",
    resume: { afterMs: INSTAGRAM_CONTAINER_POLL_MS, containerId },
  };
}

async function pollContainer(session: Session, containerId: string): Promise<ContainerReadiness> {
  const answer = await session.transport.send({
    method: "GET",
    url: `${GRAPH}/${containerId}?fields=status_code,status`,
    headers: { authorization: `Bearer ${session.token}` },
  });
  return containerReadiness(answer, {
    containerId,
    pollAfterMs: INSTAGRAM_CONTAINER_POLL_MS,
    statusField: "status_code",
  });
}

/** `media_publish` — the finished container becomes a post. Its URL comes from the read-back. */
async function publishContainer(session: Session, containerId: string): Promise<PublishResult> {
  const published = await session.transport.send({
    method: "POST",
    url: `${GRAPH}/${account(session.input)}/media_publish?creation_id=${encodeURIComponent(containerId)}`,
    headers: { authorization: `Bearer ${session.token}` },
  });

  if (published.kind === "dry_run") return DRY_RUN;
  if (published.status >= 400) return metaFailure(published.status, published.body);

  const postId = platformId(published.body);
  if (!postId) return { status: "uncertain", detail: "media_publish answered without an id" };

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

/** Meta's form parameters — the token travels in a header, so a preview never shows it. */
function formHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" };
}

function mediaParam(item: PublishMedia): Record<string, string> {
  return { [item.kind === "video" ? "video_url" : "image_url"]: item.url };
}

function account(input: PublishInput): string {
  return encodeURIComponent(input.accountRef);
}

/**
 * Hashtags ship in the caption: the Instagram spec prefers them in the first comment, but posting a
 * comment is not wired, and dropping them silently would be worse than placing them differently.
 */
function textFor(input: PublishInput): string {
  return [input.caption.trim(), input.hashtags.join(" ")].filter(Boolean).join("\n\n");
}
