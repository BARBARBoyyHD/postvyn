/**
 * The Instagram adapter: three shapes, public URLs, and a container that outlives the request.
 *
 * The shape cases run against recorded replies and no database — a container flow is the adapter's
 * business. The last three need rows, because they are about where media URLs come from and about the
 * job that parks and is picked up again on a later tick (US-032).
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { approvals } from "@/db/approvals";
import { credentialStore } from "@/db/credentials";
import { jobs } from "@/db/jobs";
import { publishVariant, runTick } from "@/db/tick";
import type { PublishInput } from "@/publishers/port";
import { instagramPublisher } from "@/publishers/instagram";
import { INSTAGRAM_SHAPES } from "@/publishers/instagram-shapes";
import type { WorkspaceContext } from "@/lib/context";
import type { WorkerEnv } from "@/lib/env";
import { fixtureTransport } from "./support/fixture-transport";
import { reachableTransport } from "./support/reachable-transport";

import carouselPublished from "./fixtures/instagram/carousel-published.json";
import containerRejected from "./fixtures/instagram/container-rejected.json";
import reelParked from "./fixtures/instagram/reel-parked-then-published.json";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const BASE = "https://media.postvyn.test";
const testEnv: WorkerEnv = { DB: env.DB, TOKEN_ENCRYPTION_KEY: KEY, R2_PUBLIC_BASE: BASE };

const IG_USER = "17841400000000000";

function input(overrides: Partial<PublishInput> = {}): PublishInput {
  return {
    variantId: "var-ig",
    platform: "instagram",
    channelId: "chn-ig",
    accountRef: IG_USER,
    caption: "A caption",
    hashtags: ["#one"],
    media: [
      { id: "med-1", key: "media/ws/a.jpg", url: `${BASE}/media/ws/a.jpg`, kind: "image" },
      { id: "med-2", key: "media/ws/b.jpg", url: `${BASE}/media/ws/b.jpg`, kind: "image" },
    ],
    credentials: { accessToken: "ig-token" },
    ...overrides,
  };
}

describe("Instagram shapes", () => {
  it("refuses a variant with no media before making a single call", async () => {
    const recorded = fixtureTransport({ replies: [] });
    const result = await instagramPublisher({ transport: recorded.transport }).publish(
      input({ media: [] }),
    );

    expect(result).toMatchObject({ status: "failed", platformError: { code: "media_required" } });
    expect(recorded.calls).toEqual([]);
  });

  it("a carousel is one container per item and then a parent", async () => {
    const recorded = fixtureTransport(carouselPublished);
    const publisher = instagramPublisher({ transport: recorded.transport });

    const created = await publisher.publish(input());
    expect(created).toMatchObject({
      status: "awaiting_platform",
      resume: { containerId: "container-parent-1" },
    });

    const verified = await publisher.verify(created, input());
    expect(verified).toMatchObject({
      status: "published",
      platformPostId: "17900000000000002",
      permalink: "https://www.instagram.com/p/CzAbCdEfGhI/",
    });

    // Item containers first, each marked as a carousel item, then the parent that names them in order.
    expect(recorded.calls.slice(0, 2).map((call) => call.body)).toEqual([
      expect.stringContaining("is_carousel_item=true"),
      expect.stringContaining("is_carousel_item=true"),
    ]);
    expect(recorded.calls[2].body).toContain("media_type=CAROUSEL");
    expect(recorded.calls[2].body).toContain("children=container-carousel-1%2Ccontainer-carousel-2");
  });

  it("a reel goes through the same container flow with its own media type", async () => {
    const recorded = fixtureTransport(reelParked);
    const publisher = instagramPublisher({ transport: recorded.transport });
    const reel = input({
      media: [{ id: "med-v", key: "media/ws/reel.mp4", url: `${BASE}/media/ws/reel.mp4`, kind: "video" }],
    });

    const created = await publisher.publish(reel);
    expect(created.status).toBe("awaiting_platform");
    expect(recorded.calls[0].body).toContain("media_type=REELS");
    expect(recorded.calls[0].body).toContain("video_url=");

    // Not ready yet: the answer is another park, not a failure and not a second container.
    const stillWaiting = await publisher.verify(created, reel);
    expect(stillWaiting).toMatchObject({
      status: "awaiting_platform",
      resume: { containerId: "container-reel-1" },
    });

    const published = await publisher.verify(stillWaiting, reel);
    expect(published).toMatchObject({
      status: "published",
      permalink: "https://www.instagram.com/reel/CzAbCdEfGhI/",
    });
  });

  it("the preview names the shape and stops at the first send", async () => {
    const recorded = fixtureTransport({ replies: [] });
    const preview = await instagramPublisher({ transport: recorded.transport }).preview(input());

    expect(recorded.calls).toEqual([]);
    expect(preview.calls).toHaveLength(1);
    expect(preview.notes.join(" ")).toContain("CAROUSEL");
    expect(INSTAGRAM_SHAPES.CAROUSEL.mediaMin).toBe(2);
  });

  it("a container Meta gave up on is a failure with Meta's message", async () => {
    const recorded = fixtureTransport(containerRejected);
    const publisher = instagramPublisher({ transport: recorded.transport });
    const created = await publisher.publish(
      input({ media: [{ id: "med-1", key: "media/ws/a.jpg", url: `${BASE}/media/ws/a.jpg`, kind: "image" }] }),
    );

    const failed = await publisher.verify(created, input());
    expect(failed).toMatchObject({
      status: "failed",
      platformError: {
        code: "ERROR",
        message: "Media upload has failed with error code 2207026",
      },
    });
  });
});

// ── rows, and the tick that resumes a park ─────────────────────────────────────────────────────

const WS = "ws-ig-publishing";
const USER = "user-ig";
const BRAND = "brand-ig";
const POST = "post-ig";
const VARIANT = "var-ig-db";
const MEDIA_IMAGE = "med-ig-image";
const MEDIA_VIDEO = "med-ig-video";

const ctx: WorkspaceContext = { workspaceId: WS, userId: USER, role: "owner" };

async function seed(mediaIds: string[] = [MEDIA_VIDEO]) {
  const now = Date.now();

  await env.DB.batch([
    env.DB.prepare("delete from jobs"),
    env.DB.prepare("delete from publish_results"),
    env.DB.prepare("delete from approvals"),
    env.DB.prepare("delete from variants"),
    env.DB.prepare("delete from posts"),
    env.DB.prepare("delete from media where workspace_id = ?").bind(WS),
    env.DB.prepare("delete from channel_credentials"),
    env.DB.prepare("delete from channels"),
    env.DB.prepare(
      "insert or ignore into workspaces (id, name, plan, timezone, publishing_enabled, created_at, updated_at) values (?, 'IG publishing', 'free', 'UTC', 1, ?, ?)",
    ).bind(WS, now, now),
    env.DB.prepare(
      "insert or ignore into brands (id, workspace_id, slug, name, created_at, updated_at) values (?, ?, 'ig-publishing', 'IG', ?, ?)",
    ).bind(BRAND, WS, now, now),
  ]);

  const connected = await credentialStore(testEnv).connect(ctx, {
    brandId: BRAND,
    platform: "instagram",
    accountRef: IG_USER,
    label: "ig main",
    credentials: { accessToken: "ig-token" },
  });
  if (!connected.ok) throw new Error("seed: connect failed");

  await env.DB.batch([
    env.DB.prepare(
      "insert into media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) values (?, ?, 'h-image', ?, 'image/jpeg', 1024, 1080, 1350, 1, ?)",
    ).bind(MEDIA_IMAGE, WS, `media/${WS}/poster.jpg`, now),
    env.DB.prepare(
      "insert into media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) values (?, ?, 'h-video', ?, 'video/mp4', 4_000_000, 1080, 1920, 1, ?)",
    ).bind(MEDIA_VIDEO, WS, `media/${WS}/reel.mp4`, now),
    env.DB.prepare(
      "insert into posts (id, workspace_id, brand_id, title, format, status, created_at, updated_at) values (?, ?, ?, 'IG post', 'video', 'review', ?, ?)",
    ).bind(POST, WS, BRAND, now, now),
    env.DB.prepare(
      "insert into variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, revision, created_at, updated_at) values (?, ?, ?, 'A caption', '[\"#one\"]', ?, 'ok', 0, ?, ?)",
    ).bind(VARIANT, POST, connected.channelId, JSON.stringify(mediaIds), now, now),
  ]);

  const approved = await approvals(testEnv).approve(ctx, VARIANT, { slotAt: now - 1_000 });
  if (!approved.ok) throw new Error(`seed: approve failed (${approved.error})`);
}

describe("an Instagram publish parks, and a later tick finishes it", () => {
  beforeEach(async () => {
    await seed();
  });

  it("polls on the next tick and stores the permalink the platform returned", async () => {
    const recorded = fixtureTransport(reelParked);
    const publisher = instagramPublisher({ transport: recorded.transport });
    const probe = reachableTransport();
    const first = Date.now();

    const parked = await runTick(testEnv, { publisher, transport: probe.transport, now: first });
    expect(parked.outcomes[0]?.verdict).toBe("awaiting_platform");

    const parkedJob = await jobs(testEnv).get(parked.outcomes[0].jobId);
    expect(parkedJob?.state).toBe("awaiting_platform");
    expect(JSON.parse(parkedJob?.payload ?? "{}")).toMatchObject({ containerId: "container-reel-1" });

    // A tick after the platform's window: the job comes back as queued and is claimed again.
    const second = await runTick(testEnv, { publisher, transport: probe.transport, now: first + 61_000 });
    expect(second.claimed).toBe(1);
    expect(second.outcomes[0]?.verdict).toBe("awaiting_platform");

    const third = await runTick(testEnv, { publisher, transport: probe.transport, now: first + 122_000 });
    expect(third.outcomes[0]?.verdict).toBe("published");

    const job = await jobs(testEnv).get(third.outcomes[0].jobId);
    expect(job?.state).toBe("done");

    const result = await env.DB.prepare(
      "select platform_post_id, url, state from publish_results where variant_id = ?",
    )
      .bind(VARIANT)
      .first<{ platform_post_id: string; url: string; state: string }>();
    expect(result).toEqual({
      platform_post_id: "17900000000000001",
      url: "https://www.instagram.com/reel/CzAbCdEfGhI/",
      state: "succeeded",
    });
  });

  it("creates one container, not one per tick", async () => {
    const recorded = fixtureTransport(reelParked);
    const publisher = instagramPublisher({ transport: recorded.transport });
    const probe = reachableTransport();
    const first = Date.now();

    await runTick(testEnv, { publisher, transport: probe.transport, now: first });
    await runTick(testEnv, { publisher, transport: probe.transport, now: first + 61_000 });
    await runTick(testEnv, { publisher, transport: probe.transport, now: first + 122_000 });

    const containerCalls = recorded.calls.filter((call) => call.url.endsWith("/media"));
    expect(containerCalls).toHaveLength(1);
  });
});

describe("media has to resolve to a public URL", () => {
  beforeEach(async () => {
    await seed([MEDIA_IMAGE]);
  });

  it("refuses when R2_PUBLIC_BASE is empty, naming the variable, before the adapter runs", async () => {
    const noBase: WorkerEnv = { DB: env.DB, TOKEN_ENCRYPTION_KEY: KEY };
    const recorded = fixtureTransport({ replies: [] });

    const outcome = await publishVariant(noBase, VARIANT, {
      publisher: instagramPublisher({ transport: recorded.transport }),
    });

    expect(outcome.verdict).toBe("spec_blocked");
    expect(outcome.detail).toContain("R2_PUBLIC_BASE");
    expect(recorded.calls).toEqual([]);

    const post = await env.DB.prepare("select status from posts where id = ?")
      .bind(POST)
      .first<{ status: string }>();
    expect(post?.status).toBe("review");
  });

  it("refuses a media row that still points at a vault path, naming the row", async () => {
    await env.DB.prepare("update media set key = ? where id = ?")
      .bind(`brands/uwi/social/instagram/assets/poster.jpg`, MEDIA_IMAGE)
      .run();

    const recorded = fixtureTransport({ replies: [] });
    const outcome = await publishVariant(testEnv, VARIANT, {
      publisher: instagramPublisher({ transport: recorded.transport }),
    });

    expect(outcome.verdict).toBe("spec_blocked");
    expect(outcome.detail).toContain(MEDIA_IMAGE);
    expect(recorded.calls).toEqual([]);
  });

  it("refuses a URL the platform could not fetch, naming the key, before the adapter runs", async () => {
    const recorded = fixtureTransport({ replies: [] });
    const probe = reachableTransport(404);

    const outcome = await publishVariant(testEnv, VARIANT, {
      publisher: instagramPublisher({ transport: recorded.transport }),
      transport: probe.transport,
    });

    expect(outcome.verdict).toBe("spec_blocked");
    expect(outcome.detail).toContain(`media/${WS}/poster.jpg`);
    expect(outcome.detail).toContain("404");
    // One HEAD, nothing downloaded, and the platform was never called.
    expect(probe.calls).toEqual([{ method: "HEAD", url: `${BASE}/media/${WS}/poster.jpg` }]);
    expect(recorded.calls).toEqual([]);
  });

  it("checks the URL with a HEAD before publishing, and says nothing when it answers", async () => {
    const recorded = fixtureTransport(reelParked);
    const probe = reachableTransport();

    const outcome = await publishVariant(testEnv, VARIANT, {
      publisher: instagramPublisher({ transport: recorded.transport }),
      transport: probe.transport,
    });

    // The probe runs first and passes, so the publish is not blocked by media — whatever the adapter
    // then answers is the adapter's business (covered above).
    expect(outcome.verdict).not.toBe("spec_blocked");
    expect(probe.calls).toEqual([{ method: "HEAD", url: `${BASE}/media/${WS}/poster.jpg` }]);
  });
});
