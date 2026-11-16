/**
 * `GET /api/v1/queue` — the board, in the documented envelope.
 *
 * Query: `brandId` (required), `platform`, `pillar`, `limit`, `cursor`.
 *
 * The brand is validated against the context's workspace inside the repository, so a brand id from
 * another tenant returns an empty board rather than someone else's posts.
 */
import { resolveContext } from "@/auth/context";
import { repository } from "@/db/repository";
import { fail, ok, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import type { WorkerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  const url = new URL(request.url);
  const brandId = url.searchParams.get("brandId") ?? resolved.activeBrandId;
  if (!brandId) return fail(422, "brand_required", { detail: "no brand selected and none supplied" });

  try {
    const board = await repository(env).listBoard(resolved.ctx, {
      brandId,
      platform: url.searchParams.get("platform"),
      pillar: url.searchParams.get("pillar"),
      limit: Number(url.searchParams.get("limit") ?? 20),
      cursor: url.searchParams.get("cursor"),
    });
    return ok({ ...board, brandId });
  } catch (error) {
    return toErrorResponse(error);
  }
}
