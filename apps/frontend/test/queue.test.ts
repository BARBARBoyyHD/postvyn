/**
 * M4: the approval hash and the queue.
 *
 * Four properties are proven here and nowhere else — each one is a promise the product makes:
 *
 *  1. an approval is bound to the content, so editing after approving voids it;
 *  2. two ticks over one due job produce one attempt, not two;
 *  3. a lease that expires is reclaimable, and attempts keep counting;
 *  4. the kill switch stops work at claim time without discarding what is queued.
 *
 * The tick runs against a stub publisher, because M4's job is to make the queue correct before any
 * platform exists. The stub can be told to publish, to park, or to fail ambiguously.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runTick } from "@/db/tick";
import { jobs, LEASE_MS, MAX_ATTEMPTS } from "@/db/jobs";
import { approvals } from "@/db/approvals";
import { credentialStore } from "@/db/credentials";
import { hashParts, variantHash } from "@/lib/approval";
import type { Publisher, PublishInput, PublishResult } from "@/publishers/port";
import type { WorkerEnv } from "@/lib/env";

const testEnv: WorkerEnv = {
  DB: env.DB,
  TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
};

const WS = "ws-m4";
const BRAND = "brand-m4";
const CHANNEL = "chn-m4";
const POST = "post-m4";
const VARIANT = "var-m4";
const USER = "user-m4";

const ctx = { workspaceId: WS, userId: USER, role: "owner" as const };

function stub(outcome: PublishResult | ((input: PublishInput) => PublishResult)): Publisher {
  return {
    platform: "x",
    async preview() {
      return { calls: [], estimatedCostUsd: null };
    },
    async publish(input) {
      return typeof outcome === "function" ? outcome(input) : outcome;
    },
    async verify(result) {
      return result;
    },
  };
}

async function seed() {
  const now = Date.now();
  await env.DB.prepare(
    "insert or ignore into workspaces (id, name, plan, timezone, publishing_enabled, created_at, updated_at) values (?, 'M4', 'free', 'UTC', 1, ?, ?)",
  )
    .bind(WS, now, now)
    .run();
  await env.DB.prepare(
    "insert or ignore into brands (id, workspace_id, slug, name, created_at, updated_at) values (?, ?, 'm4', 'M4', ?, ?)",
  )
    .bind(BRAND, WS, now, now)
    .run();
  await env.DB.prepare(
    "insert or ignore into channels (id, brand_id, platform, account_ref, status, created_at, updated_at) values (?, ?, 'x', 'm4', 'active', ?, ?)",
  )
    .bind(CHANNEL, BRAND, now, now)
    .run();
  await env.DB.prepare(
    "insert or ignore into posts (id, workspace_id, brand_id, title, format, status, created_at, updated_at) values (?, ?, ?, 'M4 post', 'text', 'review', ?, ?)",
  )
    .bind(POST, WS, BRAND, now, now)
    .run();
  await env.DB.prepare(
    "insert or ignore into variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, revision, created_at, updated_at) values (?, ?, ?, 'the caption', '[\"#one\"]', '[]', 'ok', 0, ?, ?)",
  )
    .bind(VARIANT, POST, CHANNEL, now, now)
    .run();

  // The publish path refuses a channel it cannot authenticate as (M5), so the queue's happy path
  // needs real credentials — encrypted with a fixed test key, never a real one.
  await credentialStore(testEnv).connect(ctx, {
    brandId: BRAND,
    platform: "x",
    accountRef: "m4",
    credentials: { accessToken: "m4-test-token" },
  });
}

/** Clear only the tables this file writes; activity_log is append-only and must not be deleted. */
async function resetJobs() {
  await env.DB.prepare("delete from jobs").run();
  // publish_results is not append-only (only activity_log and variant_overrides are), and a row left by
  // an earlier case would make the next assertion read the previous test's publish.
  await env.DB.prepare("delete from publish_results").run();
  await env.DB.prepare("update approvals set revoked_at = ? where revoked_at is null").bind(Date.now()).run();
}

describe("the approval hash", () => {
  it("covers caption, hashtags and media order", async () => {
    const base = await hashParts("hello", ["#a", "#b"], ["m1", "m2"]);
    expect(await hashParts("hello!", ["#a", "#b"], ["m1", "m2"])).not.toBe(base);
    expect(await hashParts("hello", ["#b", "#a"], ["m1", "m2"])).not.toBe(base);
    expect(await hashParts("hello", ["#a", "#b"], ["m2", "m1"])).not.toBe(base);
    expect(await hashParts("hello", ["#a", "#b"], ["m1", "m2"])).toBe(base);
  });

  it("does not collide when the pieces shift across the separator", async () => {
    expect(await hashParts("a", ["#b"], [])).not.toBe(await hashParts("a#b", [], []));
  });

  it("is stable across a row round-trip", async () => {
    const fromParts = await hashParts("the caption", ["#one"], []);
    const fromRow = await variantHash({ caption: "the caption", hashtags: '["#one"]', mediaIds: "[]" });
    expect(fromRow).toBe(fromParts);
  });
});

describe("approval invalidates on edit", () => {
  beforeEach(async () => {
    await seed();
    await resetJobs();
    await env.DB.prepare("update variants set caption = 'the caption' where id = ?").bind(VARIANT).run();
  });

  it("verifies while unchanged and refuses after an edit", async () => {
    const store = approvals(testEnv);
    await store.approve(ctx, VARIANT, { slotAt: Date.now() + 60_000 });

    expect((await store.verify(VARIANT)).ok).toBe(true);

    await env.DB.prepare("update variants set caption = 'edited after approval' where id = ?")
      .bind(VARIANT)
      .run();

    const after = await store.verify(VARIANT);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.reason).toBe("reapproval_required");
  });

  it("moves the post to scheduled with the slot it was given", async () => {
    const slot = Date.now() + 3_600_000;
    await approvals(testEnv).approve(ctx, VARIANT, { slotAt: slot });

    const row = await env.DB.prepare("select status, schedule_at from posts where id = ?")
      .bind(POST)
      .first<{ status: string; schedule_at: number }>();
    expect(row?.status).toBe("scheduled");
    expect(row?.schedule_at).toBe(slot);
  });

  it("enqueues exactly one job, even when approved twice", async () => {
    const store = approvals(testEnv);
    await store.approve(ctx, VARIANT, { slotAt: Date.now() + 60_000 });
    await store.approve(ctx, VARIANT, { slotAt: Date.now() + 120_000 });

    const count = await env.DB.prepare("select count(*) as n from jobs where state in ('queued','claimed')")
      .first<{ n: number }>();
    expect(Number(count?.n)).toBe(1);
  });
});

describe("the queue", () => {
  beforeEach(async () => {
    await seed();
    await resetJobs();
    await env.DB.prepare("update variants set caption = 'the caption' where id = ?").bind(VARIANT).run();
  });

  it("two ticks, one job, one publish", async () => {
    await approvals(testEnv).approve(ctx, VARIANT, { slotAt: Date.now() - 1_000 });

    let calls = 0;
    const publisher = stub(() => {
      calls += 1;
      return { status: "published", platformPostId: "x_1", permalink: "https://x.test/1" };
    });

    // claimed serially, as two ticks would: the second finds nothing because the first took it
    const first = await runTick(testEnv, { publisher });
    const second = await runTick(testEnv, { publisher });

    expect(first.claimed).toBe(1);
    expect(second.claimed).toBe(0);
    expect(calls).toBe(1);
  });

  it("does not claim a job whose slot is in the future", async () => {
    await approvals(testEnv).approve(ctx, VARIANT, { slotAt: Date.now() + 3_600_000 });
    const report = await runTick(testEnv, { publisher: stub({ status: "published", platformPostId: "x", permalink: null }) });
    expect(report.claimed).toBe(0);
  });

  it("refuses at claim time when the caption changed after approval", async () => {
    await approvals(testEnv).approve(ctx, VARIANT, { slotAt: Date.now() - 1_000 });
    await env.DB.prepare("update variants set caption = 'sneaky edit' where id = ?").bind(VARIANT).run();

    let calls = 0;
    const report = await runTick(testEnv, {
      publisher: stub(() => {
        calls += 1;
        return { status: "published", platformPostId: "x", permalink: null };
      }),
    });

    expect(calls).toBe(0);
    expect(report.outcomes[0].verdict).toBe("reapproval_required");

    const post = await env.DB.prepare("select status from posts where id = ?").bind(POST).first<{ status: string }>();
    expect(post?.status).toBe("review");

    const job = await env.DB.prepare("select state from jobs").first<{ state: string }>();
    expect(job?.state).toBe("dead");
  });

  it("records a successful publish and closes the post", async () => {
    await approvals(testEnv).approve(ctx, VARIANT, { slotAt: Date.now() - 1_000 });
    await runTick(testEnv, {
      publisher: stub({ status: "published", platformPostId: "x_9", permalink: "https://x.test/9" }),
    });

    const post = await env.DB.prepare("select status from posts where id = ?").bind(POST).first<{ status: string }>();
    expect(post?.status).toBe("published");

    const result = await env.DB.prepare("select state, url from publish_results where variant_id = ?")
      .bind(VARIANT)
      .first<{ state: string; url: string }>();
    expect(result?.state).toBe("succeeded");
    expect(result?.url).toBe("https://x.test/9");
  });

  it("parks when the platform is still working", async () => {
    await approvals(testEnv).approve(ctx, VARIANT, { slotAt: Date.now() - 1_000 });
    await runTick(testEnv, {
      publisher: stub({ status: "awaiting_platform", detail: "container not ready", resume: { afterMs: 300_000 } }),
    });

    const job = await env.DB.prepare("select state, attempts, last_error from jobs").first<{
      state: string;
      attempts: number;
      last_error: string;
    }>();
    expect(job?.state).toBe("awaiting_platform");
    expect(job?.last_error).toBe("container not ready");
    // parked is not a failure: the attempt that parked it keeps its count and nothing retries yet
    expect(job?.attempts).toBe(1);
  });

  it("retries with backoff, then stops at the attempt limit", async () => {
    await approvals(testEnv).approve(ctx, VARIANT, { slotAt: Date.now() - 1_000 });
    const store = jobs(testEnv);

    const first = await runTick(testEnv, {
      publisher: stub({ status: "failed", platformError: { code: "x_500", message: "boom" } }),
    });
    expect(first.outcomes[0].verdict).toBe("failed");

    const afterFirst = await env.DB.prepare("select state, attempts, run_after from jobs").first<{
      state: string;
      attempts: number;
      run_after: number;
    }>();
    expect(afterFirst?.state).toBe("queued");
    expect(afterFirst?.attempts).toBe(1);
    expect(afterFirst!.run_after).toBeGreaterThan(Date.now());

    // bring it forward and fail again until the limit
    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await env.DB.prepare("update jobs set run_after = ? where state = 'queued'").bind(Date.now() - 1).run();
      await runTick(testEnv, { publisher: stub({ status: "failed", platformError: { code: "x_500", message: "boom" } }) });
    }

    const final = await env.DB.prepare("select state, attempts from jobs").first<{ state: string; attempts: number }>();
    expect(final?.state).toBe("dead");
    expect(final?.attempts).toBe(MAX_ATTEMPTS);
    void store;
  });

  it("treats an ambiguous failure as uncertain and never retries it", async () => {
    await approvals(testEnv).approve(ctx, VARIANT, { slotAt: Date.now() - 1_000 });
    await runTick(testEnv, {
      publisher: stub({ status: "uncertain", detail: "socket closed after send" }),
    });

    const job = await env.DB.prepare("select state, last_error from jobs").first<{
      state: string;
      last_error: string;
    }>();
    expect(job?.state).toBe("failed");
    expect(job?.last_error).toContain("uncertain");

    const result = await env.DB.prepare("select state from publish_results where variant_id = ?")
      .bind(VARIANT)
      .first<{ state: string }>();
    expect(result?.state).toBe("uncertain");
  });

  it("reclaims a job whose lease expired", async () => {
    await approvals(testEnv).approve(ctx, VARIANT, { slotAt: Date.now() - 1_000 });
    const store = jobs(testEnv);

    const claimed = await store.claim();
    expect(claimed).not.toBeNull();

    const reclaim = await store.reclaimExpired(Date.now() + LEASE_MS + 1);
    expect(reclaim.requeued).toContain(claimed!.id);
  });

  it("stops at claim time when the kill switch is off, and keeps the job", async () => {
    await approvals(testEnv).approve(ctx, VARIANT, { slotAt: Date.now() - 1_000 });

    const report = await runTick(testEnv, {
      publisher: stub({ status: "published", platformPostId: "x", permalink: null }),
      globalEnabled: false,
    });
    expect(report.claimed).toBe(0);

    const job = await env.DB.prepare("select state from jobs").first<{ state: string }>();
    expect(job?.state).toBe("queued");

    // and the workspace switch is checked inside the claim, not by the caller
    await env.DB.prepare("update workspaces set publishing_enabled = 0 where id = ?").bind(WS).run();
    const withWorkspaceOff = await runTick(testEnv, {
      publisher: stub({ status: "published", platformPostId: "x", permalink: null }),
    });
    expect(withWorkspaceOff.claimed).toBe(0);

    await env.DB.prepare("update workspaces set publishing_enabled = 1 where id = ?").bind(WS).run();
    const resumed = await runTick(testEnv, {
      publisher: stub({ status: "published", platformPostId: "x", permalink: null }),
    });
    expect(resumed.claimed).toBe(1);
  });

  it("parks rather than burns attempts when no adapter exists", async () => {
    await approvals(testEnv).approve(ctx, VARIANT, { slotAt: Date.now() - 1_000 });
    const { notConnectedPublisher } = await import("@/publishers/port");
    await runTick(testEnv, { publisher: notConnectedPublisher() });

    const job = await env.DB.prepare("select state, last_error from jobs").first<{
      state: string;
      last_error: string;
    }>();
    expect(job?.state).toBe("awaiting_platform");
    expect(job?.last_error).toContain("M5");
  });

  it("records when the attempt started and finished", async () => {
    await approvals(testEnv).approve(ctx, VARIANT, { slotAt: Date.now() - 1_000 });

    const startedAfter = Date.now();
    await runTick(testEnv, {
      publisher: stub({ status: "published", platformPostId: "x_7", permalink: null }),
    });

    const row = await env.DB.prepare("select attempt_started_at, attempt_finished_at from jobs").first<{
      attempt_started_at: number;
      attempt_finished_at: number;
    }>();
    expect(row?.attempt_started_at).toBeGreaterThanOrEqual(startedAfter);
    expect(row?.attempt_finished_at).toBeGreaterThanOrEqual(row!.attempt_started_at);
  });
});

/**
 * "Nothing noisy" made concrete, because the phrase proves nothing on its own: the tick claims nothing,
 * the report is empty, the row is byte-identical, the publisher is never called, and not one line is
 * logged. A tick every five minutes must cost nothing when there is nothing to do.
 */
describe("a tick with no due work", () => {
  beforeEach(async () => {
    await seed();
    await resetJobs();
    await env.DB.prepare("update variants set caption = 'the caption' where id = ?").bind(VARIANT).run();
  });

  it("is a no-op that says nothing", async () => {
    // Approved for tomorrow: queued, visible, and not due.
    await approvals(testEnv).approve(ctx, VARIANT, { slotAt: Date.now() + 3_600_000 });
    const before = await env.DB.prepare("select * from jobs where id = (select id from jobs limit 1)").first<
      Record<string, unknown>
    >();
    expect(before?.state).toBe("queued");

    let calls = 0;
    const publisher = stub(() => {
      calls += 1;
      return { status: "published", platformPostId: "x", permalink: null };
    });

    const noise = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")].map(
      (spy) => spy.mockImplementation(() => undefined),
    );
    // Prove the instrument before trusting it: a "nothing was logged" assertion over a broken spy passes.
    console.log("probe");
    expect(noise[0].mock.calls).toHaveLength(1);
    for (const spy of noise) spy.mockClear();

    const report = await runTick(testEnv, { publisher });

    expect(report).toEqual({ reclaimed: [], dead: [], claimed: 0, outcomes: [] });
    expect(calls).toBe(0);
    expect(noise.flatMap((spy) => spy.mock.calls)).toEqual([]);

    const after = await env.DB.prepare("select * from jobs where id = (select id from jobs limit 1)").first<
      Record<string, unknown>
    >();
    expect(after).toEqual(before);

    for (const spy of noise) spy.mockRestore();
  });
});
