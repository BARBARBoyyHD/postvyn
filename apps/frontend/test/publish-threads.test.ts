/**
 * The Threads adapter, exercised against recorded platform replies.
 *
 * Five promises, each asserted against a fixture rather than a memory of the API: an expired token is
 * a re-authorisation need and not a retry; a rejected container is quoted in Meta's words; a rate limit
 * keeps its own code; a published post's URL comes from the read-back; and the 250-post ceiling is
 * shown before anybody hits it.
 *
 * The last two cases go through the tick, because "the channel flips" and "the job backs off" are the
 * queue's behaviour, not the adapter's.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { approvals } from "@/db/approvals";
import { credentialStore } from "@/db/credentials";
import { jobs } from "@/db/jobs";
import { publishVariant, runTick } from "@/db/tick";
import type { PublishInput } from "@/publishers/port";
import { threadsPublisher, THREADS_POSTS_PER_24H } from "@/publishers/threads";
import type { WorkspaceContext } from "@/lib/context";
import type { WorkerEnv } from "@/lib/env";
import { fixtureTransport } from "./support/fixture-transport";

import expiredToken from "./fixtures/threads/expired-token.json";
import rateLimit from "./fixtures/threads/rate-limit.json";
import readBackMismatch from "./fixtures/threads/read-back-mismatch.json";
import rejectedContainer from "./fixtures/threads/rejected-container.json";
import textPublished from "./fixtures/threads/text-published.json";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const testEnv: WorkerEnv = { DB: env.DB, TOKEN_ENCRYPTION_KEY: KEY };

const WS = "ws-threads-adapter";
const USER = "user-threads";
const BRAND = "brand-threads";
const POST = "post-threads";
const VARIANT = "var-threads";
const ACCOUNT_REF = "25998871713190174";

const ctx: WorkspaceContext = { workspaceId: WS, userId: USER, role: "owner" };

function input(overrides: Partial<PublishInput> = {}): PublishInput {
  return {
    variantId: VARIANT,
    platform: "threads",
    channelId: "chn-threads",
    accountRef: ACCOUNT_REF,
    title: "",
    caption: "A caption",
    hashtags: ["#one"],
    media: [],
    credentials: { accessToken: "th-token" },
    ...overrides,
  };
}

async function seed() {
  const now = Date.now();

  await env.DB.batch([
    env.DB.prepare("delete from jobs"),
    env.DB.prepare("delete from publish_results"),
    env.DB.prepare("delete from approvals"),
    env.DB.prepare("delete from variants"),
    env.DB.prepare("delete from posts"),
    env.DB.prepare("delete from channel_credentials"),
    env.DB.prepare("delete from channels"),
    env.DB.prepare(
      "insert or ignore into workspaces (id, name, plan, timezone, publishing_enabled, created_at, updated_at) values (?, 'Threads adapter', 'free', 'UTC', 1, ?, ?)",
    ).bind(WS, now, now),
    env.DB.prepare(
      "insert or ignore into brands (id, workspace_id, slug, name, created_at, updated_at) values (?, ?, 'threads-adapter', 'Threads', ?, ?)",
    ).bind(BRAND, WS, now, now),
  ]);

  const connected = await credentialStore(testEnv).connect(ctx, {
    brandId: BRAND,
    platform: "threads",
    accountRef: ACCOUNT_REF,
    label: "threads main",
    credentials: { accessToken: "th-token" },
  });
  if (!connected.ok) throw new Error("seed: connect failed");

  await env.DB.batch([
    env.DB.prepare(
      "insert into posts (id, workspace_id, brand_id, title, format, status, created_at, updated_at) values (?, ?, ?, 'Threads post', 'text', 'review', ?, ?)",
    ).bind(POST, WS, BRAND, now, now),
    env.DB.prepare(
      "insert into variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, revision, created_at, updated_at) values (?, ?, ?, 'A caption', '[\"#one\"]', '[]', 'ok', 0, ?, ?)",
    ).bind(VARIANT, POST, connected.channelId, now, now),
  ]);

  const approved = await approvals(testEnv).approve(ctx, VARIANT, { slotAt: now - 1_000 });
  if (!approved.ok) throw new Error(`seed: approve failed (${approved.error})`);
}

describe("Threads answers that are not a post", () => {
  it("an expired token is a re-authorisation need, quoted verbatim", async () => {
    const recorded = fixtureTransport(expiredToken);
    const result = await threadsPublisher({ transport: recorded.transport }).publish(input());

    expect(result.status).toBe("reauth_required");
    if (result.status !== "reauth_required") return;
    expect(result.platformError).toEqual({
      code: "190",
      message: "Error validating access token: Session has expired on Monday, 16-Nov-26 08:00:00 PST.",
    });
  });

  it("a rejected container fails, and says what Meta said", async () => {
    const recorded = fixtureTransport(rejectedContainer);
    const result = await threadsPublisher({ transport: recorded.transport }).publish(input());

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.platformError).toEqual({
      code: "ERROR",
      message: "The media could not be processed: video duration is below the 3 second minimum.",
    });
  });

  it("a rate limit keeps the platform's own code", async () => {
    const recorded = fixtureTransport(rateLimit);
    const result = await threadsPublisher({ transport: recorded.transport }).publish(input());

    expect(result).toMatchObject({
      status: "failed",
      platformError: { code: "613", message: "Calls to this api have exceeded the rate limit." },
    });
  });
});

describe("Threads publishes", () => {
  it("creates, polls, publishes, then takes the permalink from the read-back", async () => {
    const recorded = fixtureTransport(textPublished);
    const publisher = threadsPublisher({ transport: recorded.transport });

    const sent = await publisher.publish(input());
    expect(sent).toMatchObject({ status: "published", platformPostId: "17841400000000001", permalink: null });

    const verified = await publisher.verify(sent, input());
    expect(verified).toMatchObject({
      status: "published",
      permalink: "https://www.threads.net/@uwi/post/CzAbCdEfGhI",
    });

    expect(recorded.calls.map((call) => call.method)).toEqual(["POST", "GET", "POST", "GET"]);
    // The token travels in a header, so a preview or a log of the URL never carries it.
    expect(recorded.calls[0].url).not.toContain("th-token");
    expect(recorded.calls[0].body).toContain("media_type=TEXT");
  });

  it("a read-back that disagrees is uncertain, never published", async () => {
    const recorded = fixtureTransport(readBackMismatch);
    const publisher = threadsPublisher({ transport: recorded.transport });

    const sent = await publisher.publish(input());
    const verified = await publisher.verify(sent, input());

    expect(verified).toMatchObject({ status: "uncertain" });
    if (verified.status !== "uncertain") return;
    expect(verified.detail).toContain("different post");
  });

  it("shows the 250-post ceiling and lists one call, with no socket opened", async () => {
    // The fixture transport answers nothing here: a preview runs on its own recorder, so a real send
    // would show up as a call on the injected transport.
    const recorded = fixtureTransport({ replies: [] });
    const preview = await threadsPublisher({ transport: recorded.transport }).preview(input());

    expect(recorded.calls).toEqual([]);
    expect(preview.calls).toHaveLength(1);
    expect(preview.notes.join(" ")).toContain(String(THREADS_POSTS_PER_24H));
  });
});

describe("the queue reacts to a Threads refusal", () => {
  beforeEach(seed);

  it("flips the channel to reauth_required and parks the job instead of retrying the token", async () => {
    const recorded = fixtureTransport(expiredToken);
    const outcome = await publishVariant(testEnv, VARIANT, {
      publisher: threadsPublisher({ transport: recorded.transport }),
    });

    expect(outcome.verdict).toBe("reauth_required");
    expect(outcome.platformError?.code).toBe("190");

    const channel = await env.DB.prepare(
      "select status from channels where account_ref = ?",
    )
      .bind(ACCOUNT_REF)
      .first<{ status: string }>();
    expect(channel?.status).toBe("reauth_required");

    const audit = await env.DB.prepare(
      "select action, detail from activity_log where action = 'channel.reauth_required'",
    ).first<{ action: string; detail: string }>();
    expect(JSON.parse(audit?.detail ?? "{}")).toMatchObject({ platformError: { code: "190" } });
  });

  it("a rate limit leaves the job queued with backoff, and the attempt is counted", async () => {
    const recorded = fixtureTransport(rateLimit);
    const report = await runTick(testEnv, {
      publisher: threadsPublisher({ transport: recorded.transport }),
      now: Date.now(),
    });

    expect(report.outcomes[0]).toMatchObject({ verdict: "failed" });

    const job = await jobs(testEnv).get(report.outcomes[0].jobId);
    expect(job?.state).toBe("queued");
    expect(job?.attempts).toBe(1);
    expect(job?.lastError).toContain("613");
    expect(job?.runAfter).toBeGreaterThan(Date.now());
  });
});
