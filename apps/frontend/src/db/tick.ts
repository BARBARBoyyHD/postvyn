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
import { credentialStore } from "./credentials";
import { jobs, LEASE_MS } from "./jobs";
import { specGate } from "./spec-gate";
import type { PlatformError, Publisher, Preview, PublishInput, PublishResult } from "@/publishers/port";
import { systemContext } from "@/lib/context";
import type { WorkerEnv } from "@/lib/env";
import type { SpecIssue } from "@/lib/specs/validate";

export type Verdict = PublishResult["status"] | "reapproval_required" | "spec_blocked" | "none";

export interface VariantOutcome {
  variantId: string;
  platform: string;
  verdict: Verdict;
  detail?: string;
  url?: string | null;
  /** The platform's own code and message, when there was one — stored and shown verbatim. */
  platformError?: PlatformError;
  /** Only for `spec_blocked`: the platform rules the content fails, named individually. */
  violations?: SpecIssue[];
  /** Only for `awaiting_platform`: how long the caller should wait before looking again. */
  resumeAfterMs?: number;
}

/**
 * The three rows every publish question needs: the variant, its post (the tenant) and its channel.
 *
 * Separate from `publishVariant` because the dry run asks the same question and must answer it the
 * same way — a preview that resolved a different channel would describe a different publish.
 */
type TargetLookup =
  | { ok: true; variant: s.Variant; post: s.Post; channel: s.Channel }
  | { ok: false; reason: "variant_missing" | "orphan" };

async function loadTarget(env: WorkerEnv, variantId: string): Promise<TargetLookup> {
  const db = createDb(env.DB);

  const [variant] = await db.select().from(s.variants).where(eq(s.variants.id, variantId)).limit(1);
  if (!variant) return { ok: false, reason: "variant_missing" };

  const [post] = await db.select().from(s.posts).where(eq(s.posts.id, variant.postId)).limit(1);
  const [channel] = await db
    .select()
    .from(s.channels)
    .where(eq(s.channels.id, variant.channelId))
    .limit(1);
  if (!post || !channel) return { ok: false, reason: "orphan" };

  return { ok: true, variant, post, channel };
}

/** Decrypted credentials for the adapter, or the reason there are none worth sending. */
type ChannelAccess =
  | { ok: true; input: PublishInput }
  | {
      ok: false;
      verdict: "not_connected";
      /** `credentials` means the token is missing or unreadable — a re-auth the board must show. */
      cause: "credentials" | "channel_state";
      detail: string;
      channelId: string;
      platform: s.Channel["platform"];
    };

async function channelAccess(
  env: WorkerEnv,
  target: { variant: s.Variant; post: s.Post; channel: s.Channel },
): Promise<ChannelAccess> {
  const { variant, post, channel } = target;

  // Stored state first: `disabled` is the operator's decision, and `reauth_required` has already been
  // reported on the board. Neither should cost a decrypt.
  if (channel.status !== "active") {
    return {
      ok: false,
      verdict: "not_connected",
      cause: "channel_state",
      detail: `channel_${channel.status}`,
      channelId: channel.id,
      platform: channel.platform,
    };
  }

  const ctx = systemContext(post.workspaceId);
  const secrets = await credentialStore(env).read(ctx, channel.id);
  if (!secrets.ok) {
    // Missing or unreadable credentials are a re-authorisation need, not a crash (spec §1) — and an
    // imported channel defaults to `active` with no token, so this is the check that stops it. The
    // caller decides whether to record that state: a dry run must leave the board alone.
    return {
      ok: false,
      verdict: "not_connected",
      cause: "credentials",
      detail: `credentials_${secrets.reason}`,
      channelId: channel.id,
      platform: channel.platform,
    };
  }

  return {
    ok: true,
    input: {
      variantId: variant.id,
      platform: channel.platform,
      channelId: channel.id,
      accountRef: channel.accountRef,
      caption: variant.caption ?? "",
      hashtags: parseList(variant.hashtags),
      mediaIds: parseList(variant.mediaIds),
      credentials: secrets.credentials,
    },
  };
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

  const target = await loadTarget(env, variantId);
  if (!target.ok) return { variantId, platform: "unknown", verdict: "none", detail: target.reason };
  const { variant, post, channel } = target;

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

  // ── and the spec verdict is recomputed too: a stored `ok` can predate the rules ────────────────
  const gate = await specGate(env).check(variant);
  if (!gate.ok) {
    await db.update(s.posts).set({ status: "review", updatedAt: now }).where(eq(s.posts.id, post.id));
    await db.insert(s.activityLog).values({
      id: `act_${crypto.randomUUID().slice(0, 8)}`,
      workspaceId: post.workspaceId,
      postId: post.id,
      actorId: null,
      action: "publish.refused",
      detail: JSON.stringify({ variantId, reason: "spec_blocked", violations: gate.violations }),
      createdAt: now,
    });
    return {
      variantId,
      platform: channel.platform,
      verdict: "spec_blocked",
      detail: gate.violations[0]?.message ?? "blocked by the platform specs",
      violations: gate.violations,
    };
  }

  const access = await channelAccess(env, target);
  if (!access.ok) {
    if (access.cause === "credentials") {
      // Discovery with a consequence: a channel whose token cannot be read needs a human, and the board
      // has to say so (spec: platform-connections §"An expired token flips the channel").
      const ctx = systemContext(post.workspaceId);
      await credentialStore(env).markReauth(ctx, access.channelId);
      await db.insert(s.activityLog).values({
        id: `act_${crypto.randomUUID().slice(0, 8)}`,
        workspaceId: post.workspaceId,
        postId: post.id,
        actorId: null,
        action: "channel.reauth_required",
        detail: JSON.stringify({ channelId: access.channelId, reason: access.detail }),
        createdAt: now,
      });
    }
    return { variantId, platform: access.platform, verdict: access.verdict, detail: access.detail };
  }

  const sent = await publisher.publish(access.input);
  // A 200 is not success (non-negotiable 4): the post is read back from the platform before anything
  // is stored as published. A success whose read-back fails is `uncertain`, which needs a human — not
  // a retry, because a duplicate post cannot be undone from this side.
  const result = sent.status === "published" ? await publisher.verify(sent) : sent;

  switch (result.status) {
    case "published": {
      await db
        .insert(s.publishResults)
        .values({
          id: `pub_${crypto.randomUUID().slice(0, 10)}`,
          variantId,
          platform: channel.platform,
          platformPostId: result.platformPostId,
          url: result.permalink,
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
        detail: JSON.stringify({ variantId, platform: channel.platform, url: result.permalink }),
        createdAt: now,
      });

      return {
        variantId,
        platform: channel.platform,
        verdict: "published",
        url: result.permalink,
      };
    }

    case "uncertain": {
      await db
        .insert(s.publishResults)
        .values({
          id: `pub_${crypto.randomUUID().slice(0, 10)}`,
          variantId,
          platform: channel.platform,
          platformPostId: null,
          url: null,
          raw: JSON.stringify(result.platformError ?? { detail: result.detail }).slice(0, 2000),
          state: "uncertain",
          createdAt: now,
        })
        .onConflictDoNothing();

      return {
        variantId,
        platform: channel.platform,
        verdict: "uncertain",
        detail: result.detail,
        platformError: result.platformError,
      };
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
          // Stored exactly as the platform said it: the operator reads the platform's words, and a
          // later investigation can match them against the platform's own logs.
          raw: JSON.stringify(result.platformError).slice(0, 2000),
          state: "failed",
          createdAt: now,
        })
        .onConflictDoNothing();

      return {
        variantId,
        platform: channel.platform,
        verdict: "failed",
        detail: result.platformError.message,
        platformError: result.platformError,
      };
    }

    case "awaiting_platform":
      return {
        variantId,
        platform: channel.platform,
        verdict: "awaiting_platform",
        detail: result.detail,
        resumeAfterMs: result.resume.afterMs,
      };

    case "not_connected":
      return { variantId, platform: channel.platform, verdict: "not_connected", detail: result.reason };
  }
}

// ── the dry run ───────────────────────────────────────────────────────────────────────────────────

export type PreviewOutcome =
  | { ok: true; variantId: string; preview: Preview }
  | { ok: false; variantId: string; reason: "not_found" | "not_connected"; detail?: string };

/**
 * What a publish to this variant would send, without sending it.
 *
 * The publisher does the describing (`preview()` runs its own flow against a recording transport), so
 * this function's job is only to resolve the same rows a real publish would.
 */
export async function previewVariant(
  env: WorkerEnv,
  variantId: string,
  publisher: Publisher,
): Promise<PreviewOutcome> {
  const target = await loadTarget(env, variantId);
  if (!target.ok) return { ok: false, variantId, reason: "not_found", detail: target.reason };

  // An empty call list would read as "nothing would be sent to this platform", which is not the same
  // statement as "there is no adapter for it yet". Say the true one.
  if (publisher.platform === "none") {
    return {
      ok: false,
      variantId,
      reason: "not_connected",
      detail: "no platform adapter is configured yet (M5)",
    };
  }

  const access = await channelAccess(env, target);
  if (!access.ok) return { ok: false, variantId, reason: "not_connected", detail: access.detail };

  return { ok: true, variantId, preview: await publisher.preview(access.input) };
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
    blocked: outcomes.filter(
      (outcome) => outcome.verdict === "reapproval_required" || outcome.verdict === "spec_blocked",
    ).length,
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
        // burning attempts on a condition only a deploy or a reconnect can fix.
        await store.park(job.id, outcome.detail ?? "no adapter", 60 * 60 * 1000);
        break;
      case "uncertain":
        // A request that may have succeeded is never retried: a duplicate post cannot be undone from
        // this side. `ambiguous` records it as needing a human and skips backoff entirely.
        await store.fail(job.id, outcome.detail ?? "the platform may have accepted it", {
          ambiguous: true,
        });
        break;
      case "failed": {
        // The platform's own code and message: "publish failed" is not actionable at 07:00.
        const error = outcome.platformError;
        await store.fail(
          job.id,
          error ? `${error.code}: ${error.message}` : (outcome.detail ?? "publish failed"),
        );
        break;
      }
      case "reapproval_required":
        // Content changed under an approval: a human problem, so terminal rather than retried.
        await store.dead(job.id, outcome.detail ?? "reapproval_required");
        break;
      case "spec_blocked":
        // The platform would reject it. Retrying cannot fix text; the operator edits and re-approves.
        await store.dead(job.id, outcome.detail ?? "spec_blocked");
        break;
      case "none": {
        await store.fail(job.id, outcome.detail ?? "unknown outcome");
        break;
      }
      default: {
        const never: never = outcome.verdict;
        throw new Error(`unhandled publish verdict: ${String(never)}`);
      }
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
