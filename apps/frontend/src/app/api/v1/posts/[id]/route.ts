/**
 * `GET /api/v1/posts/:id` — one post, with what would ship.
 *
 * A post in another workspace is `404`, never `403`: the difference between "not yours" and "not
 * there" is itself information about other tenants.
 */
import { z } from "zod";

import { resolveContext } from "@/auth/context";
import { composer } from "@/db/composer";
import { repository } from "@/db/repository";
import { fail, ok, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import type { WorkerEnv } from "@/lib/env";
import { assertCan } from "@/lib/roles";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  format: z.string().trim().min(1).max(40).optional(),
  pillar: z.string().trim().max(40).nullish(),
});

export async function GET(request: Request, params: { params: Promise<{ id: string }> }) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  try {
    const { id } = await params.params;
    const detail = await repository(env).getPostDetail(resolved.ctx, id);
    if (!detail) return fail(404, "not_found");
    return ok(detail);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Title, format and pillar only. Content lives on the variant, where the platform rules apply. */
export async function PATCH(request: Request, params: { params: Promise<{ id: string }> }) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(422, "invalid_post", parsed.error.flatten());

  try {
    assertCan(resolved.ctx, "post.update");
    const { id } = await params.params;
    const updated = await composer(env).updatePost(resolved.ctx, id, {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.format !== undefined ? { format: parsed.data.format } : {}),
      ...(parsed.data.pillar !== undefined ? { pillar: parsed.data.pillar ?? null } : {}),
    });
    if (!updated) return fail(404, "not_found");
    return ok({ id: updated });
  } catch (error) {
    return toErrorResponse(error);
  }
}
