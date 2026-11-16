/**
 * `POST /api/v1/media` — the signed-in operator's upload door.
 *
 * Same intake module as `/api/agent/media`; different authentication. Raw bytes in, a media row out.
 */
import { resolveContext } from "@/auth/context";
import { intake } from "@/db/intake";
import { fail, ok, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import type { WorkerEnv } from "@/lib/env";
import { assertCan } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  try {
    assertCan(resolved.ctx, "post.create");

    const result = await intake(env).upload(resolved.ctx, {
      bytes: await request.arrayBuffer(),
      filename: request.headers.get("x-postvyn-filename") ?? "upload",
      postable: request.headers.get("x-postvyn-postable") !== "false",
    });

    if (!result.ok) {
      const status = result.code === "too_large" ? 413 : result.code === "unsupported_type" ? 415 : 422;
      return fail(status as 413 | 415 | 422, result.code, result.message);
    }

    return ok({
      mediaId: result.media.id,
      mime: result.media.mime,
      bytes: result.media.bytes,
      width: result.media.width,
      height: result.media.height,
      deduplicated: result.deduplicated,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
