/**
 * `POST /api/v1/posts` — create a post.
 *
 * The brand comes from the body but is resolved **through the tenant-scoped repository**: a brand id
 * from another workspace reads as `404 not_found`, never as a `403` that confirms it exists.
 */
import { z } from "zod";

import { resolveContext } from "@/auth/context";
import { composer } from "@/db/composer";
import { repository } from "@/db/repository";
import { created, fail, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import type { WorkerEnv } from "@/lib/env";
import { assertCan } from "@/lib/roles";

export const dynamic = "force-dynamic";

const createPostSchema = z.object({
  brandId: z.string().min(1),
  title: z.string().trim().min(3).max(160),
  format: z.string().trim().min(1).max(40),
  pillar: z.string().trim().max(40).nullish(),
});

export async function POST(request: Request) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  const parsed = createPostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(422, "invalid_post", parsed.error.flatten());

  try {
    assertCan(resolved.ctx, "post.create");

    const brand = await repository(env).getBrandById(resolved.ctx, parsed.data.brandId);
    if (!brand) return fail(404, "not_found");

    const id = await composer(env).createPost(resolved.ctx, parsed.data.brandId, {
      title: parsed.data.title,
      format: parsed.data.format,
      pillar: parsed.data.pillar ?? null,
    });

    return created({ id });
  } catch (error) {
    return toErrorResponse(error);
  }
}
