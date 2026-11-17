/**
 * `POST /api/v1/variants/:id/tiktok-complete` — the operator says they posted it, and where.
 *
 * Owner only, like every publish: recording that a post shipped is the human gate, and a token that
 * could do it would make the gate decorative. The URL is required because "done" with no address is
 * not a record — it is a feeling.
 *
 * This is the only way a TikTok variant becomes `published`, and it is a manual act by definition:
 * no adapter is called, and the operator's attestation is the read-back (see `src/db/tiktok-pack.ts`).
 */
import { z } from "zod";

import { resolveContext } from "@/auth/context";
import { tiktokStore } from "@/db/tiktok-pack";
import { fail, ok, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import type { WorkerEnv } from "@/lib/env";
import { assertCan } from "@/lib/roles";

export const dynamic = "force-dynamic";

const schema = z.object({
  /** The post's permalink, as TikTok shows it. http(s) only: this is rendered as a link later. */
  url: z.url({ protocol: /^https?$/ }),
});

export async function POST(request: Request, params: { params: Promise<{ id: string }> }) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(422, "invalid_completion", parsed.error.flatten());

  try {
    assertCan(resolved.ctx, "variant.publish");
    const { id } = await params.params;
    const result = await tiktokStore(env).complete(resolved.ctx, id, parsed.data.url);
    if (result.ok) return ok({ variantId: id, url: result.url, status: "published" });

    switch (result.reason) {
      case "not_found":
        return fail(404, "not_found");
      case "not_tiktok":
        return fail(422, "not_tiktok", { variantId: id });
      case "archived":
        return fail(409, "archived");
      case "reapproval_required":
        return fail(409, "reapproval_required");
      case "already_published":
        return fail(409, "already_published");
      default: {
        const never: never = result.reason;
        throw new Error(`unhandled manual completion: ${String(never)}`);
      }
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
