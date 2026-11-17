/**
 * The YouTube adapter, exercised against recorded platform replies.
 *
 * Everything that makes YouTube different is asserted here against a fixture rather than a memory of
 * the API: the upload is resumable and parks instead of restarting, a video is not published until
 * `videos.list` says it is processed, quota is disclosed before the first byte and quoted when it runs
 * out, and a refresh token that died arrives as `reauth_required`.
 *
 * The DB-backed cases go through the tick, because "the channel flips" and "the job dead-letters" are
 * the queue's behaviour, not the adapter's. No test here can reach a host: the transport is recorded.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { approvals } from "@/db/approvals";
import { credentialStore } from "@/db/credentials";
import { jobs } from "@/db/jobs";
import { publishVariant, runTick } from "@/db/tick";
import type { PublishInput } from "@/publishers/port";
import {
  YOUTUBE_QUOTA_RESET_AT,
  YOUTUBE_UPLOAD_CHUNK_BYTES,
  YOUTUBE_UPLOAD_SLOTS_PER_DAY_DEFAULT,
  youtubePublisher,
} from "@/publishers/youtube";
import type { WorkspaceContext } from "@/lib/context";
import type { WorkerEnv } from "@/lib/env";
import { fixtureTransport } from "./support/fixture-transport";
import { reachableTransport } from "./support/reachable-transport";

import expiredToken from "./fixtures/youtube/expired-token.json";
import interruptedThenResumed from "./fixtures/youtube/interrupted-then-resumed.json";
import processingThenProcessed from "./fixtures/youtube/processing-then-processed.json";
import quotaExceeded from "./fixtures/youtube/quota-exceeded.json";
import readBackMismatch from "./fixtures/youtube/read-back-mismatch.json";
import shortPublished from "./fixtures/youtube/short-published.json";
import uploadRejected from "./fixtures/youtube/upload-rejected.json";
import vodPublished from "./fixtures/youtube/vod-published.json";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const BASE = "https://media.postvyn.test";
const testEnv: WorkerEnv = { DB: env.DB, TOKEN_ENCRYPTION_KEY: KEY, R2_PUBLIC_BASE: BASE };

const WS = "ws-youtube-adapter";
const USER = "user-youtube";
const BRAND = "brand-youtube";
const POST = "post-youtube";
const VARIANT = "var-youtube";
const ACCOUNT_REF = "UCtestchannel0000000000";

const ctx: WorkspaceContext = { workspaceId: WS, userId: USER, role: "owner" };

const CREDENTIALS = {
  clientId: "client-id.apps.googleusercontent.com",
  clientSecret: "client-secret",
  refreshToken: "1//refresh-token",
};

/** A wide file is long-form, a tall one is Short-shaped; both are one video, as YouTube requires. */
function input(media: { width: number; height: number } = { width: 1920, height: 1080 }): PublishInput {
  return {
    variantId: VARIANT,
    platform: "youtube",
    channelId: "chn-youtube",
    accountRef: ACCOUNT_REF,
    title: "A horizontal demo clip",
    caption: "A caption for the video",
    hashtags: ["#one"],
    media: [
      {
        id: "med-youtube",
        key: "media/ws/clip.mp4",
        url: `${BASE}/media/ws/clip.mp4`,
        kind: "video",
        width: media.width,
        height: media.height,
      },
    ],
    credentials: CREDENTIALS,
  };
}

async function seed() {
  const now = Date.now();

  await env.DB.batch([
    env.DB.prepare("delete from jobs"),
    env.DB.prepare("delete from publish_results"),
    env.DB.prepare("delete from media"),
    env.DB.prepare("delete from approvals"),
    env.DB.prepare("delete from variants"),
    env.DB.prepare("delete from posts"),
    env.DB.prepare("delete from channel_credentials"),
    env.DB.prepare("delete from channels"),
    env.DB.prepare(
      "insert or ignore into workspaces (id, name, plan, timezone, publishing_enabled, created_at, updated_at) values (?, 'YouTube adapter', 'free', 'UTC', 1, ?, ?)",
    ).bind(WS, now, now),
    env.DB.prepare(
      "insert or ignore into brands (id, workspace_id, slug, name, created_at, updated_at) values (?, ?, 'youtube-adapter', 'YouTube', ?, ?)",
    ).bind(BRAND, WS, now, now),
  ]);

  const connected = await credentialStore(testEnv).connect(ctx, {
    brandId: BRAND,
    platform: "youtube",
    accountRef: ACCOUNT_REF,
    label: "the channel",
    credentials: CREDENTIALS,
  });
  if (!connected.ok) throw new Error("seed: connect failed");

  await env.DB.batch([
    env.DB.prepare(
      "insert into posts (id, workspace_id, brand_id, title, format, status, created_at, updated_at) values (?, ?, ?, 'A horizontal demo clip', 'video', 'review', ?, ?)",
    ).bind(POST, WS, BRAND, now, now),
    env.DB.prepare(
      "insert into variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, revision, created_at, updated_at) values (?, ?, ?, 'A caption for the video', '[\"#one\"]', '[\"med-youtube\"]', 'ok', 0, ?, ?)",
    ).bind(VARIANT, POST, connected.channelId, now, now),
    env.DB.prepare(
      "insert into media (id, workspace_id, hash, key, mime, bytes, width, height, postable, created_at) values ('med-youtube', ?, 'hash-youtube', 'media/ws/clip.mp4', 'video/mp4', 20971520, 1920, 1080, 1, ?)",
    ).bind(WS, now),
  ]);

  const approved = await approvals(testEnv).approve(ctx, VARIANT, { slotAt: now - 1_000 });
  if (!approved.ok) throw new Error(`seed: approve failed (${approved.error})`);
}

describe("YouTube publishes", () => {
  it("uploads in chunks, then publishes only what videos.list confirms", async () => {
    const recorded = fixtureTransport(vodPublished);
    const publisher = youtubePublisher({ transport: recorded.transport });

    const result = await publisher.publish(input());

    expect(result).toMatchObject({
      status: "published",
      platformPostId: "dQw4w9WgXcZ",
      permalink: "https://www.youtube.com/watch?v=dQw4w9WgXcZ",
    });

    // Mint, size the file, open the session, push one chunk, read back — in that order.
    expect(recorded.calls.map((call) => call.method)).toEqual(["POST", "HEAD", "POST", "GET", "PUT", "GET"]);

    const initiate = recorded.calls[2];
    expect(initiate.url).toContain("uploadType=resumable");
    expect(initiate.body).toContain('"title":"A horizontal demo clip"');
    expect(initiate.body).toContain('"privacyStatus":"public"');
    // The title travels as metadata, never as a query parameter.
    expect(initiate.url).not.toContain("A horizontal");

    // The bytes are ranged from the media URL, and the session URL only ever comes from `location`.
    const chunk = recorded.calls[4];
    expect(chunk.url).toBe(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=test-session-vod",
    );
    expect(chunk.headers?.["content-range"]).toBe("bytes 0-1048575/1048576");

    expect(recorded.calls[5].url).toContain("/videos?part=id,snippet,status&id=dQw4w9WgXcZ");
  });

  it("appends #Shorts for a vertical file, and says so before the upload", async () => {
    const recorded = fixtureTransport(shortPublished);
    const preview = await youtubePublisher({ transport: recorded.transport }).preview(
      input({ width: 1080, height: 1920 }),
    );
    expect(preview.notes.join(" ")).toContain("categorize this as a Short");

    const sent = await fixtureTransport(shortPublished);
    await youtubePublisher({ transport: sent.transport }).publish(input({ width: 1080, height: 1920 }));

    const initiate = sent.calls[2];
    expect(initiate.body).toContain("#Shorts");
    expect(initiate.body).toContain("A caption for the video");
  });

  it("says a wide file is long-form, and leaves the description alone", async () => {
    const recorded = fixtureTransport(vodPublished);
    const preview = await youtubePublisher({ transport: recorded.transport }).preview(input());
    expect(preview.notes.join(" ")).toContain("long-form");

    const sent = await fixtureTransport(vodPublished);
    await youtubePublisher({ transport: sent.transport }).publish(input());
    expect(sent.calls[2].body).not.toContain("#Shorts");
  });

  it("shows the quota cost before the first byte, and sends nothing", async () => {
    const recorded = fixtureTransport({ replies: [] });
    const preview = await youtubePublisher({ transport: recorded.transport }).preview(input());

    // A preview runs on its own recorder and stops at the first send — the token mint — so a real send
    // would show up as a call on the injected transport instead.
    expect(recorded.calls).toEqual([]);
    expect(preview.calls.map((call) => call.method)).toEqual(["POST"]);
    expect(preview.estimatedCostUsd).toBeNull();

    const note = preview.notes[0];
    expect(note).toContain(String(YOUTUBE_UPLOAD_SLOTS_PER_DAY_DEFAULT));
    expect(note).toContain(YOUTUBE_QUOTA_RESET_AT);
  });

  it("records the quota estimate beside the platform's answer", async () => {
    await seed();
    const recorded = fixtureTransport(vodPublished);

    const outcome = await publishVariant(testEnv, VARIANT, {
      publisher: youtubePublisher({ transport: recorded.transport }),
      transport: reachableTransport().transport,
    });

    expect(outcome).toMatchObject({
      verdict: "published",
      quota: { uploadSlots: 1, dailyUploadSlots: YOUTUBE_UPLOAD_SLOTS_PER_DAY_DEFAULT, readUnits: 1 },
    });

    const row = await env.DB.prepare("select raw from publish_results where variant_id = ?")
      .bind(VARIANT)
      .first<{ raw: string }>();
    const raw = JSON.parse(row?.raw ?? "{}") as { quota?: { dailyUploadSlots?: number } };
    expect(raw.quota?.dailyUploadSlots).toBe(YOUTUBE_UPLOAD_SLOTS_PER_DAY_DEFAULT);
  });
});

describe("YouTube answers that are not a post", () => {
  it("a dead refresh token is a re-authorisation need, quoted verbatim", async () => {
    const recorded = fixtureTransport(expiredToken);
    const result = await youtubePublisher({ transport: recorded.transport }).publish(input());

    expect(result.status).toBe("reauth_required");
    if (result.status !== "reauth_required") return;
    expect(result.platformError).toEqual({
      code: "invalid_grant",
      message: "Token has been expired or revoked.",
    });
    // One call: a grant that died is not retried, and no upload was opened.
    expect(recorded.calls).toHaveLength(1);
  });

  it("flips the channel to reauth_required when Google refuses the grant", async () => {
    await seed();
    const recorded = fixtureTransport(expiredToken);

    const outcome = await publishVariant(testEnv, VARIANT, {
      publisher: youtubePublisher({ transport: recorded.transport }),
      transport: reachableTransport().transport,
    });

    expect(outcome).toMatchObject({ verdict: "reauth_required", platformError: { code: "invalid_grant" } });

    const channel = await env.DB.prepare("select status from channels where account_ref = ?")
      .bind(ACCOUNT_REF)
      .first<{ status: string }>();
    expect(channel?.status).toBe("reauth_required");

    const audit = await env.DB.prepare(
      "select action, detail from activity_log where action = 'channel.reauth_required'",
    ).first<{ action: string; detail: string }>();
    expect(JSON.parse(audit?.detail ?? "{}")).toMatchObject({ platformError: { code: "invalid_grant" } });
  });

  it("quotes an exhausted quota and stops the job instead of retrying it", async () => {
    await seed();
    const recorded = fixtureTransport(quotaExceeded);

    const report = await runTick(testEnv, {
      publisher: youtubePublisher({ transport: recorded.transport }),
      transport: reachableTransport().transport,
      now: Date.now(),
    });

    expect(report.outcomes[0]).toMatchObject({
      verdict: "failed",
      detail: "The request cannot be completed because you have exceeded your quota.",
    });

    const job = await jobs(testEnv).get(report.outcomes[0].jobId);
    expect(job?.state).toBe("dead");
    expect(job?.lastError).toContain("quota_blocked");
    expect(job?.lastError).toContain("exceeded your quota");

    const audit = await env.DB.prepare(
      "select detail from activity_log where action = 'publish.quota_blocked'",
    ).first<{ detail: string }>();
    expect(JSON.parse(audit?.detail ?? "{}")).toMatchObject({
      platformError: { code: "quotaExceeded" },
    });
  });

  it("a rejected upload is terminal and quotes YouTube's reason", async () => {
    const recorded = fixtureTransport(uploadRejected);
    const result = await youtubePublisher({ transport: recorded.transport }).publish(input());

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.platformError).toEqual({ code: "rejected", message: "copyright" });
    // One read-back, no second: a rejection is the answer, and a re-initiate would burn a slot.
    const readBacks = recorded.calls.filter((call) => call.url.includes("/videos?part="));
    expect(readBacks).toHaveLength(1);
  });

  it("a read-back that disagrees is uncertain, never published", async () => {
    const recorded = fixtureTransport(readBackMismatch);
    const result = await youtubePublisher({ transport: recorded.transport }).publish(input());

    expect(result.status).toBe("uncertain");
    if (result.status !== "uncertain") return;
    expect(result.detail).toContain("disagrees");
    expect(result.detail).toContain("unlisted");
  });
});

describe("a long upload survives the Worker", () => {
  it("parks on a failed chunk and resumes from the offset under the same session", async () => {
    const recorded = fixtureTransport(interruptedThenResumed);
    const publisher = youtubePublisher({ transport: recorded.transport });

    const parked = await publisher.publish(input());

    expect(parked.status).toBe("awaiting_platform");
    if (parked.status !== "awaiting_platform") return;
    // The park carries the session and the byte it stopped at: one upload, not one per tick.
    expect(parked.resume.containerId).toBe(
      `upload:${YOUTUBE_UPLOAD_CHUNK_BYTES}:https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=test-session-interrupted`,
    );

    const resumed = await publisher.verify(parked, input());
    expect(resumed).toMatchObject({
      status: "published",
      permalink: "https://www.youtube.com/watch?v=ResumedId0001",
    });

    // One initiate across both invocations; the second leg asked the session how far it had got and
    // continued from there, never from byte zero.
    const initiates = recorded.calls.filter((call) => call.method === "POST" && call.url.includes("uploadType"));
    expect(initiates).toHaveLength(1);

    const statusQuery = recorded.calls.filter(
      (call) => call.headers?.["content-range"] === "bytes */20971520",
    );
    expect(statusQuery).toHaveLength(1);

    const resumedChunk = recorded.calls.filter(
      (call) => call.headers?.["content-range"] === "bytes 16777216-20971519/20971520",
    );
    expect(resumedChunk).toHaveLength(1);
  });

  it("parks while YouTube processes, and a later read-back publishes it", async () => {
    const recorded = fixtureTransport(processingThenProcessed);
    const publisher = youtubePublisher({ transport: recorded.transport });

    const parked = await publisher.publish(input());
    expect(parked.status).toBe("awaiting_platform");
    if (parked.status !== "awaiting_platform") return;
    expect(parked.resume.containerId).toBe("video:1:ProcessingId1");

    const verified = await publisher.verify(parked, input());
    expect(verified).toMatchObject({ status: "published", platformPostId: "ProcessingId1" });
  });
});
