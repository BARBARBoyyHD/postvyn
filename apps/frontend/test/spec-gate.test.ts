/**
 * The spec gate: `blocked` never acquires an approval and never reaches a platform.
 *
 * The bug this closes was live: a variant whose stored verdict said `blocked` could be approved and
 * then published, because neither path read the verdict. Both now recompute it from the row
 * (`src/db/spec-gate.ts`) rather than trusting `variants.spec_state`, which can be older than the
 * content or the rules.
 *
 * Warnings are the operator's call and stay passable — that is the difference between a gate and a wall.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { approvals } from "@/db/approvals";
import { credentialStore } from "@/db/credentials";
import { jobs } from "@/db/jobs";
import { runTick } from "@/db/tick";
import { hashParts } from "@/lib/approval";
import type { Publisher } from "@/publishers/port";
import type { WorkerEnv } from "@/lib/env";

const testEnv: WorkerEnv = {
  DB: env.DB,
  TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
};

const WS = "ws-gate";
const USER = "user-gate";
const ctx = { workspaceId: WS, userId: USER, role: "owner" as const };

const BLOCKED_AT_APPROVE = "var-gate-approve";
const BLOCKED_AT_PUBLISH = "var-gate-publish";
const WARNED = "var-gate-warn";

/** Threads accepts 500 characters, hashtags included; 600 is a hard error under any reading of the rules. */
const BLOCKED_CAPTION = "x".repeat(600);

async function seedVariant(variantId: string, caption: string, hashtags: string) {
  const now = Date.now();
  const brandId = `brand-${variantId}`;
  const channelId = `chn-${variantId}`;
  const postId = `post-${variantId}`;

  await env.DB.batch([
    env.DB.prepare("insert or ignore into brands (id, workspace_id, slug, name) values (?, ?, ?, ?)").bind(
      brandId,
      WS,
      variantId,
      variantId,
    ),
    env.DB.prepare(
      "insert or ignore into channels (id, brand_id, platform, account_ref, status) values (?, ?, 'threads', ?, 'active')",
    ).bind(channelId, brandId, variantId),
    env.DB.prepare(
      "insert or ignore into posts (id, workspace_id, brand_id, title, format, status, created_at, updated_at) values (?, ?, ?, 'Gate', 'text', 'review', ?, ?)",
    ).bind(postId, WS, brandId, now, now),
    env.DB.prepare(
      "insert or ignore into variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, created_at, updated_at) values (?, ?, ?, ?, ?, '[]', 'ok', ?, ?)",
    ).bind(variantId, postId, channelId, caption, hashtags, now, now),
  ]);

  // A publish now refuses a channel without readable credentials (M5), so the gate's fixtures connect.
  const connected = await credentialStore(testEnv).connect(ctx, {
    brandId,
    platform: "threads",
    accountRef: variantId,
    credentials: { accessToken: "gate-token" },
  });
  if (!connected.ok) throw new Error(`seed: connect failed (${connected.reason})`);
}

async function seed() {
  const now = Date.now();
  await env.DB.prepare(
    "insert or ignore into workspaces (id, name, plan, timezone, publishing_enabled, created_at, updated_at) values (?, 'Gate', 'free', 'UTC', 1, ?, ?)",
  )
    .bind(WS, now, now)
    .run();

  await seedVariant(BLOCKED_AT_APPROVE, BLOCKED_CAPTION, '["#one"]');
  await seedVariant(BLOCKED_AT_PUBLISH, BLOCKED_CAPTION, '["#one"]');
  // Within the caption ceiling but with no hashtags: a warning, not a block.
  await seedVariant(WARNED, "short caption", "[]");

  await env.DB.batch([
    env.DB.prepare("delete from jobs"),
    env.DB.prepare("delete from approvals"),
    env.DB.prepare("delete from publish_results"),
  ]);
}

/** Records every call, so "the publisher never ran" is asserted rather than assumed. */
function countingPublisher(): { publisher: Publisher; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    publisher: {
      platform: "threads",
      async preview() {
        return { calls: [], estimatedCostUsd: null, notes: [] };
      },
      async publish() {
        calls += 1;
        return { status: "published", platformPostId: "x_1", permalink: "https://x.test/1" };
      },
      async verify(result) {
        return result;
      },
    },
  };
}

describe("the spec gate blocks", () => {
  beforeEach(seed);

  it("refuses an approval and names the rules the content breaks", async () => {
    const result = await approvals(testEnv).approve(ctx, BLOCKED_AT_APPROVE, {
      slotAt: Date.now() + 3_600_000,
    });

    expect(result.ok).toBe(false);
    if (result.ok || result.error !== "spec_blocked") {
      throw new Error(`expected spec_blocked, got ${JSON.stringify(result)}`);
    }
    expect(result.violations[0]?.field).toBe("caption");
    expect(result.violations[0]?.level).toBe("blocked");
    expect(result.violations[0]?.message).toContain("500");

    // nothing was granted, scheduled or queued on the way to the refusal
    const approvalRows = await env.DB.prepare("select count(*) as n from approvals").first<{ n: number }>();
    expect(Number(approvalRows?.n)).toBe(0);

    const jobRows = await env.DB.prepare("select count(*) as n from jobs").first<{ n: number }>();
    expect(Number(jobRows?.n)).toBe(0);

    const post = await env.DB.prepare("select status from posts where id = ?")
      .bind(`post-${BLOCKED_AT_APPROVE}`)
      .first<{ status: string }>();
    expect(post?.status).toBe("review");
  });

  it("refuses at claim time even when the content hash still matches", async () => {
    // The approval was granted while the content was acceptable; the rules (or the row) moved under
    // it. The hash cannot see that — only a recomputed verdict can.
    await env.DB.prepare(
      "insert into approvals (id, variant_id, variant_hash, user_id, approved_at) values ('apr_gate_publish', ?, ?, ?, ?)",
    )
      .bind(BLOCKED_AT_PUBLISH, await hashParts(BLOCKED_CAPTION, ["#one"], []), USER, Date.now())
      .run();

    await jobs(testEnv).enqueue({
      kind: "publish_variant",
      variantId: BLOCKED_AT_PUBLISH,
      runAfter: Date.now() - 1_000,
      payload: { approvalId: "apr_gate_publish" },
    });

    const counted = countingPublisher();
    const report = await runTick(testEnv, { publisher: counted.publisher });

    expect(counted.calls()).toBe(0);
    expect(report.outcomes[0]?.verdict).toBe("spec_blocked");

    const job = await env.DB.prepare("select state, last_error from jobs").first<{
      state: string;
      last_error: string;
    }>();
    expect(job?.state).toBe("dead");
    expect(job?.last_error).toContain("500");

    const post = await env.DB.prepare("select status from posts where id = ?")
      .bind(`post-${BLOCKED_AT_PUBLISH}`)
      .first<{ status: string }>();
    expect(post?.status).toBe("review");

    const refused = await env.DB.prepare(
      "select count(*) as n from activity_log where action = 'publish.refused' and json_extract(detail, '$.reason') = 'spec_blocked'",
    ).first<{ n: number }>();
    expect(Number(refused?.n)).toBe(1);
  });
});

describe("a warning is not a block", () => {
  beforeEach(seed);

  it("approves and publishes a warned variant once the operator accepted it", async () => {
    await env.DB.prepare(
      "insert into variant_overrides (id, variant_id, workspace_id, issue_field, issue_key, reason, actor_id, created_at) values ('ovr_gate_warn', ?, ?, 'hashtags', 'no hashtags', 'brand ships without tags', ?, ?)",
    )
      .bind(WARNED, WS, USER, Date.now())
      .run();

    const approved = await approvals(testEnv).approve(ctx, WARNED, { slotAt: Date.now() - 1_000 });
    expect(approved.ok).toBe(true);

    const counted = countingPublisher();
    const report = await runTick(testEnv, { publisher: counted.publisher });

    expect(counted.calls()).toBe(1);
    expect(report.outcomes[0]?.verdict).toBe("published");
  });
});
