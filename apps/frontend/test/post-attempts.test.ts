/**
 * Post detail shows attempts and the publish read-back.
 *
 * Two things the UI now needs from the detail endpoint: the latest attempt's timing (migration 0018)
 * and `uncertain` publish results, which is the only state that asks a human to check the account.
 * Both reach the endpoint through the post's own variants, so the scoping is tested here too.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { repository } from "@/db/repository";
import type { WorkspaceContext } from "@/lib/context";

const WS_A = "ws-detail-a";
const WS_B = "ws-detail-b";
const POST_A = "post-detail-a";
const POST_B = "post-detail-b";
const VARIANT_A = "var-detail-a";
const VARIANT_B = "var-detail-b";
const JOB_A = "job-detail-a";
const JOB_B = "job-detail-b";

const ctxA: WorkspaceContext = { workspaceId: WS_A, userId: "user-a", role: "owner" };
const ctxB: WorkspaceContext = { workspaceId: WS_B, userId: "user-b", role: "owner" };
const repo = repository(env as unknown as { DB: typeof env.DB });

async function seed() {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("delete from jobs"),
    env.DB.prepare("delete from publish_results"),
    env.DB.prepare("delete from variants"),
    env.DB.prepare("delete from posts"),
    env.DB.prepare("delete from channels"),
    env.DB.prepare("delete from brands"),
    env.DB.prepare("delete from workspaces"),
  ]);

  await env.DB.batch([
    env.DB.prepare("insert into workspaces (id, name) values (?, 'Detail A')").bind(WS_A),
    env.DB.prepare("insert into workspaces (id, name) values (?, 'Detail B')").bind(WS_B),
    env.DB.prepare("insert into brands (id, workspace_id, slug, name) values ('b-a', ?, 'a', 'A')").bind(WS_A),
    env.DB.prepare("insert into brands (id, workspace_id, slug, name) values ('b-b', ?, 'b', 'B')").bind(WS_B),
    env.DB.prepare(
      "insert into channels (id, brand_id, platform, account_ref) values ('c-a', 'b-a', 'x', 'a')",
    ),
    env.DB.prepare(
      "insert into channels (id, brand_id, platform, account_ref) values ('c-b', 'b-b', 'x', 'b')",
    ),
    env.DB.prepare(
      "insert into posts (id, workspace_id, brand_id, title, format, status) values (?, ?, 'b-a', 'Detail A', 'text', 'scheduled')",
    ).bind(POST_A, WS_A),
    env.DB.prepare(
      "insert into posts (id, workspace_id, brand_id, title, format, status) values (?, ?, 'b-b', 'Detail B', 'text', 'scheduled')",
    ).bind(POST_B, WS_B),
    env.DB.prepare(
      "insert into variants (id, post_id, channel_id, caption, hashtags, media_ids) values (?, ?, 'c-a', 'a', '[]', '[]')",
    ).bind(VARIANT_A, POST_A),
    env.DB.prepare(
      "insert into variants (id, post_id, channel_id, caption, hashtags, media_ids) values (?, ?, 'c-b', 'b', '[]', '[]')",
    ).bind(VARIANT_B, POST_B),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      "insert into jobs (id, kind, payload, state, attempts, run_after, attempt_started_at, attempt_finished_at, created_at, updated_at) values (?, 'publish_variant', ?, 'failed', 2, ?, ?, ?, ?, ?)",
    ).bind(
      JOB_A,
      JSON.stringify({ variantId: VARIANT_A }),
      now - 1_000,
      now - 1_400,
      now - 1_000,
      now,
      now,
    ),
    env.DB.prepare(
      "insert into jobs (id, kind, payload, state, attempts, run_after, created_at, updated_at) values (?, 'publish_variant', ?, 'queued', 0, ?, ?, ?)",
    ).bind(JOB_B, JSON.stringify({ variantId: VARIANT_B }), now + 60_000, now, now),
    env.DB.prepare(
      "insert into publish_results (id, variant_id, platform, raw, state, created_at) values ('pub-a', ?, 'x', '{}', 'uncertain', ?)",
    ).bind(VARIANT_A, now),
    env.DB.prepare(
      "insert into publish_results (id, variant_id, platform, raw, state, created_at) values ('pub-b', ?, 'x', '{}', 'uncertain', ?)",
    ).bind(VARIANT_B, now),
  ]);
}

describe("post detail: attempts and publish results", () => {
  beforeEach(seed);

  it("returns this post's attempts with their timing", async () => {
    const detail = await repo.getPostDetail(ctxA, POST_A);
    expect(detail).not.toBeNull();
    expect(detail!.attempts.map((job) => job.id)).toEqual([JOB_A]);
    expect(detail!.attempts[0]).toMatchObject({
      variantId: VARIANT_A,
      attempts: 2,
      attemptStartedAt: expect.any(Number) as number,
      attemptFinishedAt: expect.any(Number) as number,
    });
  });

  it("surfaces an uncertain publish result", async () => {
    const detail = await repo.getPostDetail(ctxA, POST_A);
    expect(detail!.publishResults.map((result) => result.state)).toEqual(["uncertain"]);
    expect(detail!.publishResults[0]?.platform).toBe("x");
  });

  it("never pulls another workspace's attempts into this post", async () => {
    const detail = await repo.getPostDetail(ctxB, POST_B);
    expect(detail!.attempts.map((job) => job.id)).toEqual([JOB_B]);
    await expect(repo.getPostDetail(ctxA, POST_B)).resolves.toBeNull();
  });
});
