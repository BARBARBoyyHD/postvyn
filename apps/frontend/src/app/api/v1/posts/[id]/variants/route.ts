/**
 * `POST /api/v1/posts/:id/variants` — add one variant per channel.
 *
 * Adding a variant to a channel that already has one returns the existing id with `created: false`
 * instead of a conflict: the operator asked for the state they already have, and a 409 here would
 * teach them to ignore status codes.
 */
import { z } from "zod";

import { resolveContext } from "@/auth/context";
import { composer } from "@/db/composer";
import { repository } from "@/db/repository";
import { created, fail, ok, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import type { WorkerEnv } from "@/lib/env";
import { assertCan } from "@/lib/roles";

export const dynamic = "force-dynamic";

const schema = z.object({ channelId: z.string().min(1) });

export async function POST(request: Request, params: { params: Promise<{ id: string }> }) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(422, "invalid_variant", parsed.error.flatten());

  try {
    assertCan(resolved.ctx, "variant.create");
    const { id: postId } = await params.params;

    const post = await repository(env).getPostById(resolved.ctx, postId);
    if (!post) return fail(404, "not_found");

    const result = await composer(env).createVariant(resolved.ctx, postId, parsed.data.channelId);
    return result.created ? created({ id: result.id }) : ok({ id: result.id, created: false });
  } catch (error) {
    return toErrorResponse(error);
  }
}
