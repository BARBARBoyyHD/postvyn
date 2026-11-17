/**
 * `POST /api/v1/intake` — the human door, second half: the draft.
 *
 * Assets arrive through `POST /api/v1/media` (mint a URL) and `POST /api/v1/media/:id/record` since M6,
 * so this route only turns a caption plus media ids into a post. Same modules as the agent door,
 * different authentication: keeping them separate rather than one route with two auth modes means a
 * mistake in cookie handling cannot open the token path, and vice versa.
 */
import { resolveContext } from "@/auth/context";
import { intake } from "@/db/intake";
import { fail, created, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import { draftSchema } from "@/lib/draft-schema";
import type { WorkerEnv } from "@/lib/env";
import { assertCan } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  const parsed = draftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(422, "invalid_draft", parsed.error.flatten());

  try {
    assertCan(resolved.ctx, "post.create");
    if (!resolved.activeBrandId) return fail(422, "no_active_brand");

    const result = await intake(env).createDraft(resolved.ctx, resolved.activeBrandId, {
      title: parsed.data.title,
      format: parsed.data.format,
      pillar: parsed.data.pillar ?? null,
      targets: parsed.data.targets,
    });

    return created(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
