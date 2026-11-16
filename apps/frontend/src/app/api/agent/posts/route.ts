/**
 * `POST /api/agent/posts` — one call: a post, its variants, its assets.
 *
 * This is what "make me a video and post it" reduces to from the agent's side: upload the file, then
 * send the caption and hashtags with the channel. The draft lands in `review` because a token cannot
 * approve its own work.
 */
import { created, fail, toErrorResponse } from "@/lib/api";
import { requireAgent } from "@/lib/agent-guard";
import { intake } from "@/db/intake";
import { getBindings } from "@/lib/bindings";
import { draftSchema } from "@/lib/draft-schema";
import type { WorkerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const env = (await getBindings()) as WorkerEnv | null;
  const gate = await requireAgent(request, env);
  if (!gate.ok) return gate.response;

  const parsed = draftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(422, "invalid_draft", parsed.error.flatten());

  try {
    const result = await intake(gate.env).createDraft(gate.ctx, gate.scope.brandId, {
      title: parsed.data.title,
      format: parsed.data.format,
      pillar: parsed.data.pillar ?? null,
      targets: parsed.data.targets,
    });

    // A blocked caption is still created, but the caller has to see it — a 201 that hides a block
    // teaches the agent that its captions are fine.
    const blocked = result.targets.filter((target) => target.specState === "blocked");
    if (blocked.length > 0) {
      return Response.json(
        { ok: true, result: { ...result, blocked: blocked.length }, log: ["draft created with blocked targets"] },
        { status: 201 },
      );
    }

    return created(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
