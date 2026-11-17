/**
 * `POST /api/v1/posts/:id/publish` — the upload button.
 *
 * One click does what the operator means by "upload": approve every variant for *now* and push them. The
 * click **is** the human gate — that is why this route is owner-only and cookie-only, and why it takes no
 * "skip approval" flag: the approval is created here, from this session, and the hash is computed from the
 * content that is about to ship.
 *
 * Nothing is published while a platform adapter is missing: each variant comes back `not_connected` with
 * the reason, rather than a cheerful success that put nothing anywhere.
 */
import { z } from "zod";

import { resolveContext } from "@/auth/context";
import { approvals } from "@/db/approvals";
import { publishNow } from "@/db/tick";
import { notConnectedPublisher } from "@/publishers/port";
import { fail, ok, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import { repository } from "@/db/repository";
import type { WorkerEnv } from "@/lib/env";
import type { SpecIssue } from "@/lib/specs/validate";
import { assertCan } from "@/lib/roles";

export const dynamic = "force-dynamic";

const schema = z.object({
  /** Approve any variant that is not currently approved, at this instant. Default: yes. */
  approveMissing: z.boolean().optional(),
});

export async function POST(request: Request, params: { params: Promise<{ id: string }> }) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  const body = schema.safeParse((await request.json().catch(() => null)) ?? {});
  if (!body.success) return fail(422, "invalid_publish", body.error.flatten());
  const approveMissing = body.data.approveMissing ?? true;

  if (env.PUBLISHING_ENABLED !== "true") {
    return fail(409, "publishing_disabled", {
      reason: "PUBLISHING_ENABLED is off, so nothing may be sent to a platform",
    });
  }

  try {
    assertCan(resolved.ctx, "variant.publish");

    const { id } = await params.params;
    const detail = await repository(env).getPostDetail(resolved.ctx, id);
    if (!detail) return fail(404, "not_found");
    if (detail.variants.length === 0) return fail(422, "no_variants");

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

    const report = await publishNow(env, id, notConnectedPublisher(), now);
    if (!report) return fail(404, "not_found");

    return ok(report);
  } catch (error) {
    return toErrorResponse(error);
  }
}
