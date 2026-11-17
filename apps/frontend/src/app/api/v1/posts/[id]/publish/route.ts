/**
 * `POST /api/v1/posts/:id/publish` — the upload button.
 *
 * One click does what the operator means by "upload": approve every variant for *now* and push them. The
 * click **is** the human gate — that is why this route is owner-only and cookie-only, and why it takes no
 * "skip approval" flag: the approval is created here, from this session, and the hash is computed from the
 * content that is about to ship.
 *
 * Two other ways in, both deliberate:
 *  - `dryRun: true` answers with the calls a real publish would make and sends nothing. It needs no
 *    approval and passes the kill switch, because reading is not publishing.
 *  - a real publish must name `{platform, account}`. A mismatch with the variant's channel is refused
 *    with `422`, never corrected silently.
 */
import { z } from "zod";

import { resolveContext } from "@/auth/context";
import { approvals } from "@/db/approvals";
import { repository } from "@/db/repository";
import { previewVariant, publishNow, type PreviewOutcome } from "@/db/tick";
import { fail, ok, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import type { WorkspaceContext } from "@/lib/context";
import type { WorkerEnv } from "@/lib/env";
import { confirmTargets, type ConfirmationTarget, type PublishConfirmation } from "@/lib/publish-confirm";
import type { SpecIssue } from "@/lib/specs/validate";
import { assertCan } from "@/lib/roles";

export const dynamic = "force-dynamic";

const confirmationSchema = z.object({
  platform: z.enum(["instagram", "threads", "youtube", "tiktok"]),
  account: z.string().min(1),
});

const schema = z.object({
  /** Approve any variant that is not currently approved, at this instant. Default: yes. */
  approveMissing: z.boolean().optional(),
  /** Every destination this publish is going to, in the caller's words — one per variant. */
  confirm: z.array(confirmationSchema).min(1).max(20).optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(request: Request, params: { params: Promise<{ id: string }> }) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  const body = schema.safeParse((await request.json().catch(() => null)) ?? {});
  if (!body.success) return fail(422, "invalid_publish", body.error.flatten());
  const approveMissing = body.data.approveMissing ?? true;

  try {
    assertCan(resolved.ctx, "variant.publish");

    const { id } = await params.params;
    const detail = await repository(env).getPostDetail(resolved.ctx, id);
    if (!detail) return fail(404, "not_found");
    if (detail.variants.length === 0) return fail(422, "no_variants");

    if (body.data.dryRun === true) {
      const previews: PreviewOutcome[] = [];
      for (const variant of detail.variants) {
        previews.push(await previewVariant(env, variant.id));
      }
      return ok({ postId: id, dryRun: true, previews });
    }

    if (!body.data.confirm) {
      return fail(422, "confirmation_required", {
        hint: "name {platform, account} for a real publish, or pass dryRun: true to see what would be sent",
      });
    }

    const refusal = await confirmationRefusal(env, resolved.ctx, detail, body.data.confirm);
    if (refusal) return refusal;

    if (env.PUBLISHING_ENABLED !== "true") {
      return fail(409, "publishing_disabled", {
        reason: "PUBLISHING_ENABLED is off, so nothing may be sent to a platform",
      });
    }

    const store = approvals(env);
    const now = Date.now();
    const approvalErrors: string[] = [];
    const blocked: { variantId: string; platform: string; violations: SpecIssue[] }[] = [];

    for (const variant of detail.variants) {
      const current = await store.verify(variant.id);
      if (current.ok) continue;
      if (!approveMissing) {
        approvalErrors.push(`${variant.platform}: not approved`);
        continue;
      }
      // The click approves the content that is stored right now — the same hash the publish path will
      // recompute a moment later.
      const granted = await store.approve(resolved.ctx, variant.id, { slotAt: now, note: "publish now" });
      if (granted.ok) continue;
      if (granted.error === "spec_blocked") {
        blocked.push({ variantId: variant.id, platform: variant.platform, violations: granted.violations });
        continue;
      }
      approvalErrors.push(`${variant.platform}: could not approve (${granted.error})`);
    }

    // A blocked variant is an edit waiting to happen, so the refusal names the rules it breaks — the
    // same shape the approve endpoint answers with.
    if (blocked.length > 0) return fail(422, "spec_blocked", { failures: blocked });

    if (approvalErrors.length > 0) {
      return fail(409, "approval_required", { failures: approvalErrors });
    }

    const report = await publishNow(env, id, { now });
    if (!report) return fail(404, "not_found");

    return ok(report);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Compare the named destinations with the variants' channels before anything is approved.
 *
 * Refusing here rather than inside the publisher means a wrong confirmation costs no approval, no job
 * and no attempt count — the operator fixes a field, not a post.
 */
async function confirmationRefusal(
  env: WorkerEnv,
  ctx: WorkspaceContext,
  detail: { variants: { id: string; channelId: string; platform: string }[] },
  confirmations: PublishConfirmation[],
): Promise<Response | null> {
  const channels = await repository(env).listChannels(ctx);
  const byChannelId = new Map(channels.map((channel) => [channel.id, channel]));

  const targets: ConfirmationTarget[] = [];
  for (const variant of detail.variants) {
    const channel = byChannelId.get(variant.channelId);
    // A variant whose channel is not in this workspace cannot be confirmed at all; the repository
    // would not have returned it, so this is a broken row rather than a mistake by the caller.
    if (!channel) {
      return fail(404, "not_found", { variantId: variant.id });
    }
    targets.push({
      variantId: variant.id,
      platform: channel.platform,
      accountRef: channel.accountRef,
      label: channel.label,
    });
  }

  const report = confirmTargets(confirmations, targets);
  return report.ok ? null : fail(422, "confirmation_mismatch", { failures: report.failures });
}
