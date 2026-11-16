/**
 * `POST /api/v1/variants/:id/duplicate` — copy a variant to another channel.
 *
 * A copy, not a link: per-platform variants exist so they can diverge, and a shared row would make one
 * platform's edit change another's caption.
 */
import { z } from "zod";

import { resolveContext } from "@/auth/context";
import { composer } from "@/db/composer";
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
  if (!parsed.success) return fail(422, "invalid_duplicate", parsed.error.flatten());

  try {
    assertCan(resolved.ctx, "variant.create");
    const { id } = await params.params;
    const result = await composer(env).duplicateVariant(resolved.ctx, id, parsed.data.channelId);
    if (!result) return fail(404, "not_found");
    return result.created ? created({ id: result.id }) : ok({ id: result.id, created: false });
  } catch (error) {
    return toErrorResponse(error);
  }
}
