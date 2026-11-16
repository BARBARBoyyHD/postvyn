/**
 * `PATCH /api/v1/variants/:id` — write a variant's content and its verdict together.
 *
 * The response carries the fresh verdict, because the editor's counter and the editor's validation are
 * the same question asked twice. A client that has to re-fetch to learn whether its own write was
 * acceptable will drift.
 */
import { z } from "zod";

import { resolveContext } from "@/auth/context";
import { composer } from "@/db/composer";
import { fail, ok, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import type { WorkerEnv } from "@/lib/env";
import { assertCan } from "@/lib/roles";

export const dynamic = "force-dynamic";

const schema = z.object({
  caption: z.string().max(20_000).optional(),
  hashtags: z.array(z.string().trim().min(1).max(80)).max(60).optional(),
  mediaIds: z.array(z.string().min(1)).max(60).optional(),
  /** The revision the client believes it is writing over; a stale one is refused, not applied. */
  revision: z.number().int().min(0).optional(),
  /** Accept one warning. Blocks are not overridable — they are edits waiting to happen. */
  acceptWarning: z
    .object({
      field: z.string().min(1).max(40),
      key: z.string().min(1).max(200),
      reason: z.string().trim().min(4).max(400),
    })
    .optional(),
});

export async function PATCH(request: Request, params: { params: Promise<{ id: string }> }) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(422, "invalid_variant", parsed.error.flatten());

  try {
    assertCan(resolved.ctx, "post.update");
    const { id } = await params.params;
    const store = composer(env);

    // An override alone must not require the whole variant to be re-sent.
    if (parsed.data.acceptWarning && parsed.data.caption === undefined) {
      await store.acceptWarning(resolved.ctx, id, parsed.data.acceptWarning);
      return ok({ id, overrides: [parsed.data.acceptWarning] });
    }

    const result = await store.updateVariant(
      resolved.ctx,
      id,
      {
        caption: parsed.data.caption ?? "",
        hashtags: parsed.data.hashtags ?? [],
        mediaIds: parsed.data.mediaIds ?? [],
      },
      { revision: parsed.data.revision },
    );
    if (!result) return fail(404, "not_found");
    if ("stale" in result) {
      // The client has newer text than the row: it must re-read rather than overwrite.
      return fail(409, "stale_write", { storedRevision: result.storedRevision });
    }

    if (parsed.data.acceptWarning) {
      await store.acceptWarning(resolved.ctx, id, parsed.data.acceptWarning);
    }

    return ok(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
