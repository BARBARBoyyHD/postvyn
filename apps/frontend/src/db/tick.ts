/**
 * Publishing: one variant, or every variant of a post.
 *
 * It lives in `src/db` because it writes — the ESLint boundary rule confines query building to this
 * directory (ADR-014), and a publish path that built its own queries from `src/lib` would be the second
 * door that rule exists to prevent.
 *
 * Two shapes, one core:
 *  - `publishNow` pushes every variant of one post immediately. This is the button, and it is how the
 *    product is actually used: make the video, look at it, hit upload.
 *  - `runTick` claims due jobs, for the scheduled path. Kept because approvals still carry a slot; it is
 *    simply not the path the operator uses today.
 *
 * Two rules that are easy to get wrong, and therefore live in `publishVariant` rather than in a route:
 *  - the approval is verified **at publish time**, not trusted from when it was granted;
 *  - an ambiguous result is recorded as uncertain and never retried, because a duplicate post cannot be
 *    undone from this side.
 */
import { eq } from "drizzle-orm";

import { createDb, type Bindings } from "./client";
import * as s from "./schema";
import { approvals } from "./approvals";
import { jobs, LEASE_MS } from "./jobs";
import type { Publisher, PublishOutcome } from "@/publishers/port";
import type { WorkerEnv } from "@/lib/env";

export type Verdict = PublishOutcome["state"] | "reapproval_required" | "none";

export interface VariantOutcome {
  variantId: string;
  platform: string;
  verdict: Verdict;
  detail?: string;
  url?: string | null;
  /** Only for `awaiting_platform`: how long the caller should wait before looking again. */
  resumeAfterMs?: number;
}

/**
 * The core: verify, publish, record.
 *
 * No queue plumbing here — the caller decides what a verdict means for a job, so the button and the tick
 * cannot drift apart.
 */
export async function publishVariant(
  env: WorkerEnv,
  variantId: string,
  publisher: Publisher,
  now = Date.now(),
): Promise<VariantOutcome> {
  const db = createDb(env.DB);

  const [variant] = await db.select().from(s.variants).where(eq(s.variants.id, variantId)).limit(1);
  if (!variant) return { variantId, platform: "unknown", verdict: "none", detail: "variant_missing" };

  const [post] = await db.select().from(s.posts).where(eq(s.posts.id, variant.postId)).limit(1);
  const [channel] = await db.select().from(s.channels).where(eq(s.channels.id, variant.channelId)).limit(1);
  if (!post || !channel) return { variantId, platform: "unknown", verdict: "none", detail: "orphan" };

  // ── the approval is re-checked against what is stored *now* ───────────────────────────────────
  const check = await approvals(env).verify(variantId);
  if (!check.ok) {
    await db.update(s.posts).set({ status: "review", updatedAt: now }).where(eq(s.posts.id, post.id));
    await db.insert(s.activityLog).values({
      id: `act_${crypto.randomUUID().slice(0, 8)}`,
      workspaceId: post.workspaceId,
      postId: post.id,
      actorId: null,
      action: "publish.refused",
      detail: JSON.stringify({ variantId, reason: check.reason }),
      createdAt: now,
    });
    return { variantId, platform: channel.platform, verdict: "reapproval_required", detail: check.reason };
  }

  const result = await publisher.publish({
    variantId,
    platform: channel.platform,
    caption: variant.caption ?? "",
    hashtags: parseList(variant.hashtags),
    mediaIds: parseList(variant.mediaIds),
    channelId: channel.id,
  });

  switch (result.state) {
    case "published": {
      await db
        .insert(s.publishResults)
        .values({
          id: `pub_${crypto.randomUUID().slice(0, 10)}`,
          variantId,
          platform: channel.platform,
          platformPostId: result.platformPostId,
          url: result.url,
          raw: result.raw === undefined ? null : JSON.stringify(result.raw).slice(0, 4000),
          state: "succeeded",
          createdAt: now,
        })
        // the partial unique index allows exactly one success per variant
        .onConflictDoNothing();

      await db.update(s.posts).set({ status: "published", updatedAt: now }).where(eq(s.posts.id, post.id));
      await db.insert(s.activityLog).values({
        id: `act_${crypto.randomUUID().slice(0, 8)}`,
        workspaceId: post.workspaceId,
        postId: post.id,
        actorId: null,
        action: "publish.succeeded",
        detail: JSON.stringify({ variantId, platform: channel.platform, url: result.url }),
        createdAt: now,
      });

      return { variantId, platform: channel.platform, verdict: "published", url: result.url };
    }

    case "failed": {
      await db
        .insert(s.publishResults)
        .values({
          id: `pub_${crypto.randomUUID().slice(0, 10)}`,
          variantId,
          platform: channel.platform,
          platformPostId: null,
          url: null,
          raw: JSON.stringify({ error: result.error }).slice(0, 2000),
          state: result.ambiguous ? "uncertain" : "failed",
          createdAt: now,
        })
        .onConflictDoNothing();

      return {
        variantId,
        platform: channel.platform,
        verdict: "failed",
        detail: result.ambiguous ? `uncertain: ${result.error}` : result.error,
      };
    }

    case "awaiting_platform":
      return {
        variantId,
        platform: channel.platform,
        verdict: "awaiting_platform",
        detail: result.reason,
        resumeAfterMs: result.resumeAfterMs,
      };

    case "not_connected":
      return { variantId, platform: channel.platform, verdict: "not_connected", detail: result.reason };
  }
}

// ── the button ────────────────────────────────────────────────────────────────────────────────────

export interface PublishNowReport {
  postId: string;
  outcomes: VariantOutcome[];
  published: number;
  blocked: number;
}

/**
 * Publish every variant of one post, now.
 *
 * Sequential, not parallel: two simultaneous writes race on `posts.status`, and every platform rate-limits
 * per account anyway. The order is the post's variant order.
 */
export async function publishNow(
  env: WorkerEnv,
  postId: string,
  publisher: Publisher,
  now = Date.now(),
): Promise<PublishNowReport | null> {
  const db = createDb(env.DB);

  const [post] = await db.select().from(s.posts).where(eq(s.posts.id, postId)).limit(1);
  if (!post) return null;

  const variants = await db.select().from(s.variants).where(eq(s.variants.postId, postId));
  const outcomes: VariantOutcome[] = [];
  for (const variant of variants) {
    outcomes.push(await publishVariant(env, variant.id, publisher, now));
  }

  return {
    postId,
    outcomes,
    published: outcomes.filter((outcome) => outcome.verdict === "published").length,
    blocked: outcomes.filter((outcome) => outcome.verdict === "reapproval_required").length,
  };
}

// ── the tick (kept for the scheduled path) ────────────────────────────────────────────────────────

export interface TickReport {
  reclaimed: string[];
  dead: string[];
  claimed: number;
  outcomes: { jobId: string; verdict: Verdict; detail?: string }[];
}

export interface TickOptions {
  publisher: Publisher;
  now?: number;
  maxJobs?: number;
  /** The global kill switch; workspace switches are checked inside the claim. */
  globalEnabled?: boolean;
}

export async function runTick(env: WorkerEnv, options: TickOptions): Promise<TickReport> {
  const now = options.now ?? Date.now();
  const maxJobs = options.maxJobs ?? 5;
  const report: TickReport = { reclaimed: [], dead: [], claimed: 0, outcomes: [] };

  const store = jobs(env);
  const reclaim = await store.reclaimExpired(now);
  report.reclaimed = reclaim.requeued;
  report.dead = reclaim.dead;

  for (let index = 0; index < maxJobs; index += 1) {
    const job = await store.claim(now, options.globalEnabled ?? true);
    if (!job) break;
    report.claimed += 1;

    const parsed = safeJson(job.payload) as { variantId?: string };
    if (!parsed.variantId) {
      await store.fail(job.id, "job payload has no variantId");
      report.outcomes.push({ jobId: job.id, verdict: "none", detail: "payload" });
      continue;
    }

    const outcome = await publishVariant(env, parsed.variantId, options.publisher, now);
    report.outcomes.push({ jobId: job.id, verdict: outcome.verdict, detail: outcome.detail });

    switch (outcome.verdict) {
      case "published":
        await store.complete(job.id);
        break;
      case "awaiting_platform":
        await store.park(job.id, outcome.detail ?? "platform not ready", outcome.resumeAfterMs ?? 300_000);
        break;
      case "not_connected":
        // Nothing is wrong with the job; there is nowhere to send it. Park for an hour rather than
        // burning attempts on a condition only a deploy can fix.
        await store.park(job.id, outcome.detail ?? "no adapter", 60 * 60 * 1000);
        break;
      case "failed":
        await store.fail(job.id, outcome.detail ?? "publish failed", {
          ambiguous: (outcome.detail ?? "").startsWith("uncertain"),
        });
        break;
      case "reapproval_required":
        // Content changed under an approval: a human problem, so terminal rather than retried.
        await store.dead(job.id, outcome.detail ?? "reapproval_required");
        break;
      default:
        await store.fail(job.id, outcome.detail ?? "unknown outcome");
    }
  }

  return report;
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Window used by the "due in 24h" view and by tests that reason about it. */
export function dueWindow(now = Date.now()): { from: number; to: number } {
  return { from: now, to: now + 24 * 60 * 60 * 1000 };
}

export const TICK_LEASE_MS = LEASE_MS;
export type { Bindings };
