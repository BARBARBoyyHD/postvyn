/**
 * `GET /api/v1/variants/:id/tiktok-pack` — everything needed to post this variant by hand.
 *
 * A TikTok target never reaches a platform API (non-negotiable 5), so the pack is the product: caption,
 * hashtags, the assets in publish order, a checklist, and the one line that says why this is manual.
 * The reason travels with the pack because the operator reads the pack, not the ADR.
 */
import { resolveContext } from "@/auth/context";
import { tiktokStore } from "@/db/tiktok-pack";
import { fail, ok, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import type { WorkerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(request: Request, params: { params: Promise<{ id: string }> }) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  try {
    const { id } = await params.params;
    const result = await tiktokStore(env).read(resolved.ctx, id);
    if (result.ok) return ok(result);
    // Not a TikTok target is a wrong request, not a missing row: the variant exists and publishes
    // somewhere else.
    if (result.reason === "not_tiktok") return fail(422, "not_tiktok", { variantId: id });
    return fail(404, "not_found");
  } catch (error) {
    return toErrorResponse(error);
  }
}
