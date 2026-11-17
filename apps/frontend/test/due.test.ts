/**
 * The due window is scoped and honest.
 *
 * A job row carries no workspace id: its payload names a variant, and the variant's post decides the
 * tenant. That indirection is exactly where a cross-tenant leak would live, so this file proves a
 * second workspace's job never appears, and that "due" means queued or parked inside the window —
 * not done, claimed, or three days out.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { repository } from "@/db/repository";
import { dueWindow } from "@/db/tick";
import type { WorkspaceContext } from "@/lib/context";

const WS_A = "ws-due-a";
const WS_B = "ws-due-b";
const BRAND_A = "brand-due-a";
const BRAND_B = "brand-due-b";
const CHANNEL_A = "chn-due-a";
const CHANNEL_B = "chn-due-b";
const POST_A = "post-due-a";
const POST_B = "post-due-b";
const VARIANT_A = "var-due-a";
const VARIANT_B = "var-due-b";

const DUE_A = "job-due-a";
const LATE_A = "job-late-a";
const DONE_A = "job-done-a";
const CLAIMED_A = "job-claimed-a";
const DUE_B = "job-due-b";

const ctxA: WorkspaceContext = { workspaceId: WS_A, userId: "user-a", role: "owner" };
const ctxB: WorkspaceContext = { workspaceId: WS_B, userId: "user-b", role: "owner" };
const repo = repository(env as unknown as { DB: typeof env.DB });

async function seed() {
  const now = Date.now();
  const hour = 3_600_000;

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
    env.DB.prepare(
      "insert into workspaces (id, name, timezone, publishing_enabled, created_at, updated_at) values (?, 'Due A', 'Asia/Jakarta', 1, ?, ?)",
    ).bind(WS_A, now, now),
    env.DB.prepare(
      "insert into workspaces (id, name, timezone, publishing_enabled, created_at, updated_at) values (?, 'Due B', 'UTC', 0, ?, ?)",
    ).bind(WS_B, now, now),

    env.DB.prepare("insert into brands (id, workspace_id, slug, name) values (?, ?, 'due-a', 'Due A')").bind(
      BRAND_A,
      WS_A,
    ),
    env.DB.prepare("insert into brands (id, workspace_id, slug, name) values (?, ?, 'due-b', 'Due B')").bind(
      BRAND_B,
      WS_B,
    ),

    env.DB.prepare("insert into channels (id, brand_id, platform, account_ref) values (?, ?, 'x', 'due-a')").bind(
      CHANNEL_A,
      BRAND_A,
    ),
    env.DB.prepare("insert into channels (id, brand_id, platform, account_ref) values (?, ?, 'x', 'due-b')").bind(
      CHANNEL_B,
      BRAND_B,
    ),

    env.DB.prepare(
      "insert into posts (id, workspace_id, brand_id, title, format, status) values (?, ?, ?, 'Due in A', 'text', 'scheduled')",
    ).bind(POST_A, WS_A, BRAND_A),
    env.DB.prepare(
      "insert into posts (id, workspace_id, brand_id, title, format, status) values (?, ?, ?, 'Due in B', 'text', 'scheduled')",
    ).bind(POST_B, WS_B, BRAND_B),

    env.DB.prepare(
      "insert into variants (id, post_id, channel_id, caption, hashtags, media_ids) values (?, ?, ?, 'a', '[]', '[]')",
    ).bind(VARIANT_A, POST_A, CHANNEL_A),
    env.DB.prepare(
      "insert into variants (id, post_id, channel_id, caption, hashtags, media_ids) values (?, ?, ?, 'b', '[]', '[]')",
    ).bind(VARIANT_B, POST_B, CHANNEL_B),
  ]);

  const job = (id: string, variantId: string, state: string, runAfter: number) =>
    env.DB.prepare(
      "insert into jobs (id, kind, payload, state, attempts, run_after, created_at, updated_at) values (?, 'publish_variant', ?, ?, 1, ?, ?, ?)",
    ).bind(id, JSON.stringify({ variantId }), state, runAfter, now, now);

  await env.DB.batch([
    job(DUE_A, VARIANT_A, "queued", now + hour),
    job(LATE_A, VARIANT_A, "queued", now + 30 * hour),
    job(DONE_A, VARIANT_A, "done", now + hour),
    job(CLAIMED_A, VARIANT_A, "claimed", now + hour),
    job(DUE_B, VARIANT_B, "queued", now + hour),
  ]);
}

describe("due in the next 24 hours", () => {
  beforeEach(seed);

  it("returns only this workspace's queued work inside the window", async () => {
    const jobs = await repo.listDueJobs(ctxA, dueWindow());
    expect(jobs.map((job) => job.id)).toEqual([DUE_A]);
    expect(jobs[0]).toMatchObject({
      postTitle: "Due in A",
      platform: "x",
      state: "queued",
    });
  });

  it("returns B its own job, not A's", async () => {
    const jobs = await repo.listDueJobs(ctxB, dueWindow());
    expect(jobs.map((job) => job.id)).toEqual([DUE_B]);
  });

  it("reads the workspace's timezone and switch", async () => {
    await expect(repo.getWorkspaceSettings(ctxA)).resolves.toEqual({
      timezone: "Asia/Jakarta",
      publishingEnabled: true,
    });
    await expect(repo.getWorkspaceSettings(ctxB)).resolves.toEqual({
      timezone: "UTC",
      publishingEnabled: false,
    });
  });
});
