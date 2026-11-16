/**
 * `GET /api/agent/posts/:id` — what happened to the draft.
 *
 * The agent's loop is: push, wait for a human, publish. This is the "wait for a human" half: status and
 * per-variant verdict, scoped to the token's workspace so a token cannot read another tenant's card.
 */
import { fail, ok, toErrorResponse } from "@/lib/api";
import { requireAgent } from "@/lib/agent-guard";
import { repository } from "@/db/repository";
import { getBindings } from "@/lib/bindings";
import type { WorkerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(request: Request, params: { params: Promise<{ id: string }> }) {
  const env = (await getBindings()) as WorkerEnv | null;
  const gate = await requireAgent(request, env);
  if (!gate.ok) return gate.response;

  try {
    const { id } = await params.params;
    const detail = await repository(gate.env).getPostDetail(gate.ctx, id);
    if (!detail) return fail(404, "not_found");

    return ok({
      id: detail.post.id,
      status: detail.post.status,
      title: detail.post.title,
      scheduleAt: detail.post.scheduleAt,
      variants: detail.variants.map((variant) => ({
        id: variant.id,
        platform: variant.platform,
        specState: variant.specState,
        specVersion: variant.specVersion,
        captionLength: (variant.caption ?? "").length,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
