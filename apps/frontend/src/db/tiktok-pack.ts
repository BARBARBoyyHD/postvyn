/**
 * TikTok, as a pack and a manual record — the two halves that replace an upload.
 *
 * Nothing here talks to TikTok, and that is the product decision, not an omission (non-negotiable 5,
 * ADR-008). The flow is:
 *
 *  1. a scheduled TikTok variant parks; the operator asks for the pack and posts it by hand;
 *  2. they come back with the post's URL and this module records it.
 *
 * The recorded URL is the "read-back" for a manual platform: for Instagram or Threads the adapter
 * fetches the post and stores what the platform says, and here the operator is the only source there
 * is. That is stated rather than implied, because it is a weaker guarantee than an API read-back and
 * the row should not pretend otherwise.
 *
 * The insert goes through the same partial unique index every publish uses (`one_publish_per_variant`),
 * so a double click, a retried request or a bug cannot record two successes for one variant.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { createDb } from "./client";
import * as s from "./schema";
import { approvals } from "./approvals";
import { loadPublishTarget } from "./tick";
import { objectKey, publicMediaUrl } from "@/lib/media/address";
import { buildTiktokPack, type TiktokAsset, type TiktokPack } from "@/publishers/tiktok";
import type { WorkspaceContext } from "@/lib/context";
import type { WorkerEnv } from "@/lib/env";

export type PackRead =
  | { ok: true; variantId: string; pack: TiktokPack }
  | { ok: false; reason: "not_found" | "not_tiktok" };

export type ManualCompletion =
  | { ok: true; url: string }
  | {
      ok: false;
      reason: "not_found" | "not_tiktok" | "archived" | "reapproval_required" | "already_published";
    };

export function tiktokStore(env: WorkerEnv) {
  const db = createDb(env.DB);

  /** Anything a human needs to post by hand, or the reason this variant is not a TikTok target. */
  async function read(ctx: WorkspaceContext, variantId: string): Promise<PackRead> {
    const target = await loadPublishTarget(env, variantId);
    if (!target.ok || target.post.workspaceId !== ctx.workspaceId) {
      return { ok: false, reason: "not_found" };
    }
    if (target.channel.platform !== "tiktok") return { ok: false, reason: "not_tiktok" };

    const assets = await assetsFor(ctx, parseList(target.variant.mediaIds));
    return {
      ok: true,
      variantId,
      pack: buildTiktokPack({
        caption: target.variant.caption,
        hashtags: parseList(target.variant.hashtags),
        assets,
      }),
    };
  }

  /** Media rows in the variant's order, each with what is stored and a public address if one exists. */
  async function assetsFor(ctx: WorkspaceContext, mediaIds: readonly string[]): Promise<TiktokAsset[]> {
    if (mediaIds.length === 0) return [];

    const rows = await db
      .select()
      .from(s.media)
      .where(and(eq(s.media.workspaceId, ctx.workspaceId), inArray(s.media.id, [...mediaIds])));

    const byId = new Map(rows.map((row) => [row.id, row]));

    return mediaIds.flatMap((id) => {
      const row = byId.get(id);
      // A deleted row is left out rather than invented: the pack is a list of files to find.
      if (!row) return [];
      // Same construction as `src/db/media.ts`, minus the refusal: a pack is readable without a URL.
      return [
        {
          mediaId: id,
          kind: row.mime.startsWith("video/") ? "video" : "image",
          path: row.key,
          url: publicMediaUrl(env.R2_PUBLIC_BASE, objectKey(row)),
        },
      ];
    });
  }

  /**
   * Record what the operator did, and only then let the post be `published`.
   *
   * The approval is verified here for the same reason the tick verifies it: content edited after
   * approval is not the content that was approved, and a URL claiming otherwise would be a wrong row
   * in the record that outlives the mistake.
   */
  async function complete(
    ctx: WorkspaceContext,
    variantId: string,
    url: string,
  ): Promise<ManualCompletion> {
    const target = await loadPublishTarget(env, variantId);
    if (!target.ok || target.post.workspaceId !== ctx.workspaceId) {
      return { ok: false, reason: "not_found" };
    }
    const { post, channel } = target;
    if (channel.platform !== "tiktok") return { ok: false, reason: "not_tiktok" };
    // Status is forward-only (non-negotiable 1): archived is behind `published`, so it is not a state
    // a manual record can leave.
    if (post.status === "archived") return { ok: false, reason: "archived" };

    const approval = await approvals(env).verify(variantId);
    if (!approval.ok) return { ok: false, reason: "reapproval_required" };

    const now = Date.now();
    const [recorded] = await db
      .insert(s.publishResults)
      .values({
        id: `pub_${crypto.randomUUID().slice(0, 10)}`,
        variantId,
        platform: "tiktok",
        // The operator gave a URL, not the platform's post id, and a made-up id would be a lie.
        platformPostId: null,
        url,
        raw: JSON.stringify({ manual: true, recordedBy: ctx.userId }),
        state: "succeeded",
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: s.publishResults.id });

    // The partial unique index refused it: one success per variant, whatever this request believed.
    if (!recorded) return { ok: false, reason: "already_published" };

    await db.update(s.posts).set({ status: "published", updatedAt: now }).where(eq(s.posts.id, post.id));

    // The parked job has nothing left to do, and leaving it queued would poll this platform hourly
    // forever for a post a human already shipped.
    await db
      .update(s.jobs)
      .set({ state: "done", leaseUntil: null, lastError: null, attemptFinishedAt: now, updatedAt: now })
      .where(
        and(
          sql`json_extract(${s.jobs.payload}, '$.variantId') = ${variantId}`,
          sql`${s.jobs.state} in ('queued', 'claimed', 'awaiting_platform')`,
        ),
      );

    await db.insert(s.activityLog).values({
      id: `act_${crypto.randomUUID().slice(0, 8)}`,
      workspaceId: ctx.workspaceId,
      postId: post.id,
      actorId: ctx.userId,
      action: "publish.manual_completed",
      detail: JSON.stringify({ variantId, platform: "tiktok", url }),
      createdAt: now,
    });

    return { ok: true, url };
  }

  return { read, complete };
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
