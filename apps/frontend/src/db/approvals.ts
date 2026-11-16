/**
 * Approval: record it, and check it again when it matters.
 *
 * Two times, two questions. At approve time: "does this content satisfy the platform at all". At claim
 * time: "is this still the content somebody approved". The second is the one that protects the operator,
 * and it is the reason the hash exists.
 */
import { and, desc, eq, isNull } from "drizzle-orm";

import { createDb, type Bindings } from "@/db/client";
import * as s from "@/db/schema";
import { jobs } from "@/db/jobs";
import { variantHash } from "@/lib/approval";
import type { WorkspaceContext } from "@/lib/context";

export function approvals(env: Bindings) {
  const db = createDb(env.DB);

  async function loadScoped(ctx: WorkspaceContext, variantId: string) {
    const [variant] = await db.select().from(s.variants).where(eq(s.variants.id, variantId)).limit(1);
    if (!variant) return null;

    const [post] = await db.select().from(s.posts).where(eq(s.posts.id, variant.postId)).limit(1);
    if (!post || post.workspaceId !== ctx.workspaceId) return null;

    return { variant, post };
  }

  return {
    /**
     * Approve for a slot. The slot is the schedule; the job's earliest run time comes from it, never from
     * the moment of approving — otherwise "approve for tomorrow 09:00" publishes at lunchtime today.
     */
    async approve(
      ctx: WorkspaceContext,
      variantId: string,
      input: { slotAt: number; note?: string | null },
    ) {
      const found = await loadScoped(ctx, variantId);
      if (!found) return null;

      const hash = await variantHash(found.variant);
      const now = Date.now();

      // A previous approval stops counting the moment a new one arrives: revoked, not deleted, so the
      // history still shows what was approved when.
      await db
        .update(s.approvals)
        .set({ revokedAt: now })
        .where(and(eq(s.approvals.variantId, variantId), isNull(s.approvals.revokedAt)));

      const approvalId = `apr_${crypto.randomUUID().slice(0, 10)}`;
      await db.insert(s.approvals).values({
        id: approvalId,
        variantId,
        variantHash: hash,
        userId: ctx.userId ?? "system",
        note: input.note ?? null,
        approvedAt: now,
      });

      await db
        .update(s.posts)
        .set({ status: "scheduled", scheduleAt: input.slotAt, updatedAt: now })
        .where(eq(s.posts.id, found.post.id));

      const job = await jobs(env).enqueue({
        kind: "publish_variant",
        variantId,
        runAfter: input.slotAt,
        payload: { approvalId },
      });

      await db.insert(s.activityLog).values({
        id: `act_${crypto.randomUUID().slice(0, 8)}`,
        workspaceId: ctx.workspaceId,
        postId: found.post.id,
        actorId: ctx.userId,
        action: "variant.approved",
        detail: JSON.stringify({ variantId, slotAt: input.slotAt, hash: hash.slice(0, 12), jobId: job.id }),
        createdAt: now,
      });

      return { approvalId, hash, jobId: job.id, slotAt: input.slotAt };
    },

    /** The approval that currently counts, if any. */
    async current(variantId: string) {
      const [row] = await db
        .select()
        .from(s.approvals)
        .where(and(eq(s.approvals.variantId, variantId), isNull(s.approvals.revokedAt)))
        .orderBy(desc(s.approvals.approvedAt))
        .limit(1);
      return row ?? null;
    },

    /**
     * Recompute and compare. Returns the reason rather than a boolean, because "why did it not publish"
     * is the question actually asked.
     */
    async verify(variantId: string): Promise<{ ok: true; hash: string } | { ok: false; reason: string; hash: string }> {
      const [variant] = await db.select().from(s.variants).where(eq(s.variants.id, variantId)).limit(1);
      if (!variant) return { ok: false, reason: "variant_missing", hash: "" };

      const hash = await variantHash(variant);
      const approval = await this.current(variantId);
      if (!approval) return { ok: false, reason: "reapproval_required", hash };
      if (approval.variantHash !== hash) return { ok: false, reason: "reapproval_required", hash };

      return { ok: true, hash };
    },

    async revoke(ctx: WorkspaceContext, variantId: string) {
      const found = await loadScoped(ctx, variantId);
      if (!found) return null;

      const now = Date.now();
      await db
        .update(s.approvals)
        .set({ revokedAt: now })
        .where(and(eq(s.approvals.variantId, variantId), isNull(s.approvals.revokedAt)));

      await db
        .update(s.posts)
        .set({ status: "review", updatedAt: now })
        .where(eq(s.posts.id, found.post.id));

      await db.insert(s.activityLog).values({
        id: `act_${crypto.randomUUID().slice(0, 8)}`,
        workspaceId: ctx.workspaceId,
        postId: found.post.id,
        actorId: ctx.userId,
        action: "variant.approval_revoked",
        detail: JSON.stringify({ variantId }),
        createdAt: now,
      });

      return { variantId };
    },
  };
}
