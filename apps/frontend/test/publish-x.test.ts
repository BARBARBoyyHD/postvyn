/**
 * The X adapter: signing, the price, and the two refusals that are not failures.
 *
 * The signature is checked against the two published reference vectors rather than against itself —
 * OAuth 1.0a encoding is the part everyone gets subtly wrong, and a test that recomputes the expected
 * value proves nothing. Everything else is a recorded fixture: a text post, a video that has to be
 * chunked and parked, a refusal mid-upload, an account out of credits, a dead token.
 *
 * The queue tests go through `runTick` because "the job stops instead of retrying" is the queue's
 * behaviour, not the adapter's.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { approvals } from "@/db/approvals";
import { credentialStore } from "@/db/credentials";
import { jobs } from "@/db/jobs";
import { publishVariant, runTick } from "@/db/tick";
import { PAYMENT_REQUIRED_CODE, type PublishInput, type PublishMedia } from "@/publishers/port";
import {
  X_COST_PER_POST_USD,
  X_COST_PER_POST_WITH_LINK_USD,
  X_CREDITS_MISSING,
  xCostUsd,
  xPublisher,
} from "@/publishers/x";
import { X_UPLOAD_CHUNK_BYTES } from "@/publishers/x-media";
import { oauth1Header, type XCredentials } from "@/publishers/x-oauth";
import type { WorkspaceContext } from "@/lib/context";
import type { WorkerEnv } from "@/lib/env";
import { fixtureTransport, type RecordedReply } from "./support/fixture-transport";

import expiredToken from "./fixtures/x/expired-token.json";
import mediaAppendFails from "./fixtures/x/media-append-fails.json";
import outOfCredits from "./fixtures/x/out-of-credits.json";
import textPublished from "./fixtures/x/text-published.json";
import videoProcessing from "./fixtures/x/video-processing.json";

/** The four values X's documentation signs with — the same ones its worked example uses. */
const CREDENTIALS: XCredentials = {
  apiKey: "xvz1evFS4wEEPTGEFPHBog",
  apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
  accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
  accessSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
};

const WS = "ws-x-adapter";
const USER = "user-x";
const BRAND = "brand-x";
const POST = "post-x";
const VARIANT = "var-x";
const ACCOUNT_REF = "2244994945";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const testEnv: WorkerEnv = { DB: env.DB, TOKEN_ENCRYPTION_KEY: KEY };
const ctx: WorkspaceContext = { workspaceId: WS, userId: USER, role: "owner" };

function input(overrides: Partial<PublishInput> = {}): PublishInput {
  return {
    variantId: VARIANT,
    platform: "x",
    channelId: "chn-x",
    accountRef: ACCOUNT_REF,
    caption: "A caption",
    hashtags: ["#one"],
    media: [],
    credentials: { ...CREDENTIALS },
    ...overrides,
  };
}

function video(): PublishMedia {
  return { id: "med-video", key: "media/ws/video.mp4", url: "https://media.test/video.mp4", kind: "video" };
}

function fromFixture(fixture: RecordedReply, creditsConfigured = true) {
  const recorded = fixtureTransport(fixture);
  return {
    recorded,
    publisher: xPublisher({ transport: recorded.transport, creditsConfigured }),
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
      "insert or ignore into workspaces (id, name, plan, timezone, publishing_enabled, created_at, updated_at) values (?, 'X adapter', 'free', 'UTC', 1, ?, ?)",
    ).bind(WS, now, now),
    env.DB.prepare(
      "insert or ignore into brands (id, workspace_id, slug, name, created_at, updated_at) values (?, ?, 'x-adapter', 'X', ?, ?)",
    ).bind(BRAND, WS, now, now),
  ]);

  const connected = await credentialStore(testEnv).connect(ctx, {
    brandId: BRAND,
    platform: "x",
    accountRef: ACCOUNT_REF,
    label: "x main",
    credentials: { ...CREDENTIALS },
  });
  if (!connected.ok) throw new Error("seed: connect failed");

  await env.DB.batch([
    env.DB.prepare(
      "insert into posts (id, workspace_id, brand_id, title, format, status, created_at, updated_at) values (?, ?, ?, 'X post', 'text', 'review', ?, ?)",
    ).bind(POST, WS, BRAND, now, now),
    env.DB.prepare(
      "insert into variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, revision, created_at, updated_at) values (?, ?, ?, 'A caption', '[\"#one\"]', '[]', 'ok', 0, ?, ?)",
    ).bind(VARIANT, POST, connected.channelId, now, now),
  ]);

  const approved = await approvals(testEnv).approve(ctx, VARIANT, { slotAt: now - 1_000 });
  if (!approved.ok) throw new Error(`seed: approve failed (${approved.error})`);
}

describe("OAuth 1.0a signing", () => {
  it("reproduces the oauth.net reference header character for character", async () => {
    const header = await oauth1Header({
      method: "GET",
      url: "http://photos.example.net/photos?file=vacation.jpg&size=original",
      credentials: {
        apiKey: "dpf43f3p2l4k3l03",
        apiSecret: "kd94hf93k423kf44",
        accessToken: "nnch734d00sl2jdk",
        accessSecret: "pfkkdhi9sl3r4s00",
      },
      nonce: "kllo9940pd9333jh",
      timestamp: 1191242096,
    });

    expect(header).toBe(
      'OAuth oauth_consumer_key="dpf43f3p2l4k3l03", oauth_nonce="kllo9940pd9333jh", ' +
        'oauth_signature="tR3%2BTy81lMeYAr%2FFid0kMTYa%2FWM%3D", oauth_signature_method="HMAC-SHA1", ' +
        'oauth_timestamp="1191242096", oauth_token="nnch734d00sl2jdk", oauth_version="1.0"',
    );
  });

  it("reproduces X's worked example, with a query parameter and a body parameter signed", async () => {
    const header = await oauth1Header({
      method: "POST",
      url: "https://api.twitter.com/1.1/statuses/update.json?include_entities=true",
      credentials: CREDENTIALS,
      bodyParams: [["status", "Hello Ladies + Gentlemen, a signed OAuth request!"]],
      nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
      timestamp: 1318622958,
    });

    expect(header).toContain('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"');
  });

  it("takes a fresh nonce per request, or X sees a replay", async () => {
    const first = await oauth1Header({ method: "GET", url: "https://api.x.com/2/tweets", credentials: CREDENTIALS });
    const second = await oauth1Header({ method: "GET", url: "https://api.x.com/2/tweets", credentials: CREDENTIALS });

    expect(first).not.toBe(second);
    expect(first).toMatch(/oauth_nonce="[0-9a-f]{32}"/);
  });
});

describe("the price of an X post", () => {
  it("is the plain price for a post with no link", () => {
    expect(xCostUsd("A caption #one")).toBe(X_COST_PER_POST_USD);
  });

  it("is the link price for a URL and for a bare domain, which X counts the same way", () => {
    expect(xCostUsd("read https://example.com/a")).toBe(X_COST_PER_POST_WITH_LINK_USD);
    // docs/003-ITA.md §11: "X counts any link as $0.20, including a bare domain in the text."
    expect(xCostUsd("tickets at ticketsmith.dev this week")).toBe(X_COST_PER_POST_WITH_LINK_USD);
  });

  it("is shown in the preview, with the call that would be made", async () => {
    const { publisher, recorded } = fromFixture({ replies: [] });
    const preview = await publisher.preview(input());

    expect(recorded.calls).toEqual([]);
    expect(preview.estimatedCostUsd).toBe(X_COST_PER_POST_USD);
    expect(preview.calls[0]).toMatchObject({ method: "POST", url: "https://api.x.com/2/tweets" });
    expect(preview.notes.join(" ")).toContain("0.015");
  });

  it("prices a post with a link higher, in the number and in the note", async () => {
    const { publisher } = fromFixture({ replies: [] });
    const preview = await publisher.preview(input({ caption: "read https://example.com/x" }));

    expect(preview.estimatedCostUsd).toBe(X_COST_PER_POST_WITH_LINK_USD);
    expect(publisher.estimateCostUsd?.(input({ caption: "read https://example.com/x" }))).toBe(
      X_COST_PER_POST_WITH_LINK_USD,
    );
    expect(preview.notes.join(" ")).toContain("with a link");
  });

  it("stops a media preview at the download, and says why the upload calls are not listed", async () => {
    const { publisher } = fromFixture({ replies: [] });
    const preview = await publisher.preview(input({ media: [video()] }));

    expect(preview.calls).toEqual([{ method: "GET", url: "https://media.test/video.mp4" }]);
    expect(preview.notes.join(" ")).toContain("total_bytes");
  });
});

describe("X publishes", () => {
  it("creates one tweet, then takes the permalink from the platform's own handle", async () => {
    const { publisher, recorded } = fromFixture(textPublished);

    const sent = await publisher.publish(input());
    expect(sent).toMatchObject({ status: "published", platformPostId: "1840000000000000010" });

    const verified = await publisher.verify(sent, input());
    expect(verified).toMatchObject({
      status: "published",
      permalink: "https://x.com/uwi_dev/status/1840000000000000010",
    });

    expect(recorded.calls.map((call) => call.method)).toEqual(["POST", "GET"]);
    // The access token travels in the header because OAuth 1.0a says so; the secret never does.
    expect(recorded.calls[0].headers?.authorization).toMatch(/^OAuth /);
    expect(recorded.calls[0].headers?.authorization).not.toContain(CREDENTIALS.apiSecret);
    expect(JSON.parse(recorded.calls[0].body ?? "{}")).toMatchObject({ text: "A caption\n\n#one" });
  });

  it("uploads a video in 5 MB segments, parks while X processes it, then posts once", async () => {
    const { publisher, recorded } = fromFixture(videoProcessing);

    const sent = await publisher.publish(input({ media: [video()] }));
    expect(sent).toMatchObject({ status: "awaiting_platform" });
    if (sent.status !== "awaiting_platform") return;
    expect(sent.resume).toEqual({ afterMs: 2000, containerId: "1740000000000000001" });

    const calls = recorded.calls;
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://media.test/video.mp4" });
    expect(calls[1].url).toContain("command=INIT");
    expect(calls[1].url).toContain("total_bytes=11534336");
    expect(calls.slice(2, 5).map((call) => call.url)).toEqual([
      expect.stringContaining("segment_index=0"),
      expect.stringContaining("segment_index=1"),
      expect.stringContaining("segment_index=2"),
    ]);
    expect(calls[2].bodyBytes?.length).toBe(X_UPLOAD_CHUNK_BYTES);
    expect(calls[4].bodyBytes?.length).toBe(11534336 - 2 * X_UPLOAD_CHUNK_BYTES);
    expect(calls[5].url).toContain("command=FINALIZE");

    const verified = await publisher.verify(sent, input({ media: [video()] }));
    expect(verified).toMatchObject({ status: "published", platformPostId: "1840000000000000011" });

    const tweets = recorded.calls.filter((call) => call.url.endsWith("/2/tweets"));
    expect(tweets).toHaveLength(1);
    expect(JSON.parse(tweets[0].body ?? "{}")).toMatchObject({
      media: { media_ids: ["1740000000000000001"] },
    });
  });

  it("stops at a refusal mid-upload, quoting X's own words", async () => {
    const { publisher, recorded } = fromFixture(mediaAppendFails);

    const result = await publisher.publish(input({ media: [video()], caption: "video post", hashtags: [] }));

    expect(result).toMatchObject({
      status: "failed",
      platformError: { code: "44", message: "media parameter is missing." },
    });
    // No tweet was attempted: an image-less post is not what the operator asked for.
    expect(recorded.calls.some((call) => call.url.endsWith("/2/tweets"))).toBe(false);
  });

  it("refuses before the first call when credits are not configured, and names the switch", async () => {
    const { publisher, recorded } = fromFixture(textPublished, false);

    const result = await publisher.publish(input());

    expect(result).toMatchObject({ status: "not_connected", reason: X_CREDITS_MISSING });
    expect(X_CREDITS_MISSING).toContain("X_CREDITS_CONFIGURED");
    expect(recorded.calls).toEqual([]);
  });

  it("a refused credential asks for a human instead of retrying the signature", async () => {
    const { publisher } = fromFixture(expiredToken);

    const result = await publisher.publish(input());

    expect(result).toMatchObject({
      status: "reauth_required",
      platformError: { code: "89", message: "Invalid or expired token." },
    });
  });
});

describe("the queue reacts to an X refusal", () => {
  beforeEach(seed);

  it("records 402 as a cost problem and stops the job instead of retrying it", async () => {
    const { publisher } = fromFixture(outOfCredits);
    const report = await runTick(testEnv, { publisher, now: Date.now() });

    expect(report.outcomes[0]).toMatchObject({ verdict: "failed" });

    const job = await jobs(testEnv).get(report.outcomes[0].jobId);
    expect(job?.state).toBe("dead");
    expect(job?.attempts).toBe(1);
    expect(job?.lastError).toContain("cost_blocked");
    expect(job?.lastError).toContain(PAYMENT_REQUIRED_CODE);

    const row = await env.DB.prepare(
      "select state, raw, estimated_cost_usd from publish_results where variant_id = ?",
    )
      .bind(VARIANT)
      .first<{ state: string; raw: string; estimated_cost_usd: number }>();
    expect(row?.state).toBe("failed");
    expect(JSON.parse(row?.raw ?? "{}")).toMatchObject({ code: PAYMENT_REQUIRED_CODE });
    expect(Number(row?.estimated_cost_usd)).toBe(X_COST_PER_POST_USD);

    const audit = await env.DB.prepare(
      "select action, detail from activity_log where action = 'publish.cost_blocked'",
    ).first<{ action: string; detail: string }>();
    expect(JSON.parse(audit?.detail ?? "{}")).toMatchObject({
      platform: "x",
      estimatedCostUsd: X_COST_PER_POST_USD,
    });

    // No retry: a later tick has nothing to claim, because the job is terminal.
    const later = await runTick(testEnv, { publisher, now: Date.now() + 60 * 60 * 1000 });
    expect(later.claimed).toBe(0);
  });

  it("stores the estimate the operator saw with the successful result", async () => {
    const { publisher } = fromFixture(textPublished);
    const outcome = await publishVariant(testEnv, VARIANT, { publisher });

    expect(outcome.verdict).toBe("published");
    expect(outcome.estimatedCostUsd).toBe(X_COST_PER_POST_USD);

    const row = await env.DB.prepare(
      "select state, estimated_cost_usd from publish_results where variant_id = ?",
    )
      .bind(VARIANT)
      .first<{ state: string; estimated_cost_usd: number }>();
    expect(row?.state).toBe("succeeded");
    expect(Number(row?.estimated_cost_usd)).toBe(X_COST_PER_POST_USD);
  });
});
