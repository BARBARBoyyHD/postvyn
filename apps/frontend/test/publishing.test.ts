/**
 * The publisher port, exercised through a test double.
 *
 * Four promises, each asserted once: a dry run lists the calls and touches nothing; a real publish
 * names its destination or is refused; a platform error is stored in the platform's own words; and a
 * success is not `published` until it has been read back.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { approvals } from "@/db/approvals";
import { credentialStore } from "@/db/credentials";
import { jobs } from "@/db/jobs";
import { previewVariant, publishVariant, runTick } from "@/db/tick";
import type { PublishInput } from "@/publishers/port";
import { notConnectedPublisher } from "@/publishers/port";
import type { WorkspaceContext } from "@/lib/context";
import type { WorkerEnv } from "@/lib/env";
import { confirmTargets } from "@/lib/publish-confirm";
import { fakePublisher, recordingFetch } from "./support/fake-publisher";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

const testEnv: WorkerEnv = { DB: env.DB, TOKEN_ENCRYPTION_KEY: KEY };

const WS = "ws-m5-publishing";
const USER = "user-m5";
const BRAND = "brand-m5";
const POST = "post-m5";
const VARIANT = "var-m5";
const ACCOUNT_REF = "th-1";

const ctx: WorkspaceContext = { workspaceId: WS, userId: USER, role: "owner" };

let channelId = "";

async function seed() {
  const now = Date.now();

  // `activity_log` is append-only by trigger and cascades from `workspaces`, so the workspace and
  // brand are seeded once with fixed ids and never deleted (the house pattern in tenancy.test.ts).
  await env.DB.batch([
    env.DB.prepare("delete from jobs"),
    env.DB.prepare("delete from publish_results"),
    env.DB.prepare("delete from approvals"),
    env.DB.prepare("delete from variants"),
    env.DB.prepare("delete from posts"),
    env.DB.prepare("delete from channel_credentials"),
    env.DB.prepare("delete from channels"),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      "insert or ignore into workspaces (id, name, plan, timezone, publishing_enabled, created_at, updated_at) values (?, 'M5 publishing', 'free', 'UTC', 1, ?, ?)",
    ).bind(WS, now, now),
    env.DB.prepare(
      "insert or ignore into brands (id, workspace_id, slug, name, created_at, updated_at) values (?, ?, 'm5-publishing', 'M5', ?, ?)",
    ).bind(BRAND, WS, now, now),
  ]);

  const connected = await credentialStore(testEnv).connect(ctx, {
    brandId: BRAND,
    platform: "threads",
    accountRef: ACCOUNT_REF,
    label: "main threads",
    credentials: { accessToken: "test-token" },
  });
  if (!connected.ok) throw new Error("seed: connect failed");
  channelId = connected.channelId;

  await env.DB.batch([
    env.DB.prepare(
      "insert into posts (id, workspace_id, brand_id, title, format, status, created_at, updated_at) values (?, ?, ?, 'M5 post', 'text', 'review', ?, ?)",
    ).bind(POST, WS, BRAND, now, now),
    env.DB.prepare(
      "insert into variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, revision, created_at, updated_at) values (?, ?, ?, 'the caption', '[\"#one\"]', '[]', 'ok', 0, ?, ?)",
    ).bind(VARIANT, POST, channelId, now, now),
  ]);

  const approved = await approvals(testEnv).approve(ctx, VARIANT, { slotAt: now - 1_000 });
  if (!approved.ok) throw new Error(`seed: approve failed (${approved.error})`);
}

function input(): PublishInput {
  return {
    variantId: VARIANT,
    platform: "threads",
    channelId,
    accountRef: ACCOUNT_REF,
    caption: "the caption",
    hashtags: ["#one"],
    mediaIds: [],
    credentials: { accessToken: "test-token" },
  };
}

const SUCCESS_ANSWERS = [
  { status: 200, body: { id: "th_1" } },
  { status: 200, body: { id: "th_1", permalink: "https://threads.test/p/th_1" } },
];

describe("a dry run describes the publish and touches nothing", () => {
  beforeEach(seed);

  it("lists the first call and never opens a socket", async () => {
    const recorded = recordingFetch(SUCCESS_ANSWERS);
    const publisher = fakePublisher({ platform: "threads", fetchImpl: recorded.fetchImpl });

    const preview = await publisher.preview(input());

    expect(recorded.calls).toEqual([]);
    expect(preview.calls).toHaveLength(1);
    expect(preview.calls[0]).toMatchObject({
      method: "POST",
      url: "https://fake.threads.test/v1/posts",
    });
    // The real call's shape, not a summary of it: the same headers the adapter would send.
    expect(preview.calls[0].headers?.authorization).toBe("Bearer test-token");
    expect(preview.estimatedCostUsd).toBeNull();
  });

  it("the listed call is the call a real publish makes — one implementation, not two", async () => {
    const dry = recordingFetch(SUCCESS_ANSWERS);
    const preview = await fakePublisher({ platform: "threads", fetchImpl: dry.fetchImpl }).preview(
      input(),
    );

    const live = recordingFetch(SUCCESS_ANSWERS);
    await fakePublisher({ platform: "threads", fetchImpl: live.fetchImpl }).publish(input());

    expect({ method: live.calls[0].method, url: live.calls[0].url, body: live.calls[0].body }).toEqual({
      method: preview.calls[0].method,
      url: preview.calls[0].url,
      body: preview.calls[0].body,
    });
  });

  it("says there is no adapter rather than listing zero calls", async () => {
    const outcome = await previewVariant(testEnv, VARIANT, notConnectedPublisher());

    expect(outcome).toMatchObject({ ok: false, variantId: VARIANT, reason: "not_connected" });
    if (outcome.ok) return;
    expect(outcome.detail).toContain("M5");
  });

  it("a dry run of the variant answers through the same rows a publish would", async () => {    const recorded = recordingFetch(SUCCESS_ANSWERS);
    const outcome = await previewVariant(
      testEnv,
      VARIANT,
      fakePublisher({ platform: "threads", fetchImpl: recorded.fetchImpl }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.preview.calls).toHaveLength(1);

    // …and nothing was created: the post is still not published and there is no result row.
    const post = await env.DB.prepare("select status from posts where id = ?")
      .bind(POST)
      .first<{ status: string }>();
    expect(post?.status).toBe("scheduled");

    const results = await env.DB.prepare("select count(*) as n from publish_results").first<{
      n: number;
    }>();
    expect(Number(results?.n)).toBe(0);
  });
});

describe("a real publish has to name where it is going", () => {
  it("accepts the account id, case and whitespace included", () => {
    expect(
      confirmTargets(
        [{ platform: "threads", account: "  TH-1 " }],
        [{ variantId: VARIANT, platform: "threads", accountRef: ACCOUNT_REF, label: "main threads" }],
      ),
    ).toEqual({ ok: true });
  });

  it("accepts the label the operator sees", () => {
    expect(
      confirmTargets(
        [{ platform: "threads", account: "main threads" }],
        [{ variantId: VARIANT, platform: "threads", accountRef: ACCOUNT_REF, label: "main threads" }],
      ),
    ).toEqual({ ok: true });
  });

  it("refuses a confirmation for another platform", () => {
    const report = confirmTargets(
      [{ platform: "x", account: ACCOUNT_REF }],
      [{ variantId: VARIANT, platform: "threads", accountRef: ACCOUNT_REF, label: null }],
    );
    expect(report.ok).toBe(false);
    if (report.ok) return;
    expect(report.failures[0]).toMatchObject({ variantId: VARIANT, reason: "platform_mismatch" });
  });

  it("refuses the right platform with the wrong account", () => {
    const report = confirmTargets(
      [{ platform: "threads", account: "someone-else" }],
      [{ variantId: VARIANT, platform: "threads", accountRef: ACCOUNT_REF, label: null }],
    );
    expect(report.ok).toBe(false);
    if (report.ok) return;
    expect(report.failures[0]).toMatchObject({ reason: "account_mismatch" });
  });

  it("refuses a confirmation that names a destination no variant targets", () => {
    const report = confirmTargets(
      [
        { platform: "threads", account: ACCOUNT_REF },
        { platform: "x", account: "x-2" },
      ],
      [{ variantId: VARIANT, platform: "threads", accountRef: ACCOUNT_REF, label: null }],
    );
    expect(report.ok).toBe(false);
    if (report.ok) return;
    expect(report.failures).toEqual([{ variantId: null, reason: "unknown_target", expected: "x:x-2" }]);
  });
});

describe("a platform error is stored in the platform's words", () => {
  beforeEach(seed);

  it("records the code and the message verbatim, and fails without retrying the content", async () => {
    const recorded = recordingFetch([
      {
        status: 422,
        body: { code: "2207042", message: "We couldn't find the requested media." },
      },
    ]);

    const outcome = await publishVariant(
      testEnv,
      VARIANT,
      fakePublisher({ platform: "threads", fetchImpl: recorded.fetchImpl }),
    );

    expect(outcome.verdict).toBe("failed");
    expect(outcome.platformError).toEqual({
      code: "2207042",
      message: "We couldn't find the requested media.",
    });

    const row = await env.DB.prepare("select state, raw from publish_results where variant_id = ?")
      .bind(VARIANT)
      .first<{ state: string; raw: string }>();
    expect(row?.state).toBe("failed");
    expect(JSON.parse(row!.raw)).toEqual({
      code: "2207042",
      message: "We couldn't find the requested media.",
    });

    const post = await env.DB.prepare("select status from posts where id = ?")
      .bind(POST)
      .first<{ status: string }>();
    expect(post?.status).not.toBe("published");
  });
});

describe("published means read back", () => {
  beforeEach(seed);

  it("stores the platform's permalink only after the read-back agrees", async () => {
    const recorded = recordingFetch(SUCCESS_ANSWERS);
    const outcome = await publishVariant(
      testEnv,
      VARIANT,
      fakePublisher({ platform: "threads", fetchImpl: recorded.fetchImpl }),
    );

    expect(outcome.verdict).toBe("published");
    expect(outcome.url).toBe("https://threads.test/p/th_1");

    expect(recorded.calls.map((call) => call.method)).toEqual(["POST", "GET"]);
  });

  it("an unverified success is uncertain, never published, and the job is not retried", async () => {
    const recorded = recordingFetch(SUCCESS_ANSWERS);
    const publisher = fakePublisher({
      platform: "threads",
      fetchImpl: recorded.fetchImpl,
      verifyAnswer: { status: "uncertain", detail: "read-back returned 404" },
    });

    await jobs(testEnv).enqueue({
      kind: "publish_variant",
      variantId: VARIANT,
      runAfter: Date.now() - 1_000,
    });

    const report = await runTick(testEnv, { publisher });
    expect(report.outcomes[0]?.verdict).toBe("uncertain");

    const post = await env.DB.prepare("select status from posts where id = ?")
      .bind(POST)
      .first<{ status: string }>();
    expect(post?.status).not.toBe("published");

    const row = await env.DB.prepare("select state, raw from publish_results where variant_id = ?")
      .bind(VARIANT)
      .first<{ state: string; raw: string }>();
    expect(row?.state).toBe("uncertain");
    expect(JSON.parse(row!.raw)).toEqual({ detail: "read-back returned 404" });

    const job = await env.DB.prepare("select state, attempts, last_error from jobs").first<{
      state: string;
      attempts: number;
      last_error: string;
    }>();
    expect(job?.state).toBe("failed");
    expect(job?.attempts).toBe(1);
    expect(job?.last_error).toContain("uncertain");
  });
});

describe("a channel that cannot receive the post is not called", () => {
  beforeEach(seed);

  it("refuses before the adapter runs when the credentials are gone, and flips the channel", async () => {
    await env.DB.prepare("delete from channel_credentials where channel_id = ?").bind(channelId).run();

    let calls = 0;
    const recorded = recordingFetch(SUCCESS_ANSWERS);
    const publisher = fakePublisher({ platform: "threads", fetchImpl: recorded.fetchImpl });
    const outcome = await publishVariant(testEnv, VARIANT, {
      ...publisher,
      publish: async (payload) => {
        calls += 1;
        return publisher.publish(payload);
      },
    });

    expect(calls).toBe(0);
    expect(outcome.verdict).toBe("not_connected");
    expect(outcome.detail).toBe("credentials_missing");

    const channel = await env.DB.prepare("select status from channels where id = ?")
      .bind(channelId)
      .first<{ status: string }>();
    expect(channel?.status).toBe("reauth_required");
  });
});
