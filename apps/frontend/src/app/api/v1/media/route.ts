/**
 * `POST /api/v1/media` — mint a signed upload URL for one asset.
 *
 * No bytes here (m6 1.1): the URL covers one key and one content type, expires in minutes, and the
 * browser PUTs the file straight to R2. The row is written by `POST /api/v1/media/:id/record`, so an
 * object that never records is invisible rather than half-registered.
 */
import { resolveContext } from "@/auth/context";
import { uploadStore } from "@/db/media-upload";
import { fail, ok, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import { mintUploadSchema, uploadRefusalStatus } from "@/lib/media/upload";
import type { WorkerEnv } from "@/lib/env";
import { assertCan } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  const parsed = mintUploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(422, "invalid_upload", parsed.error.flatten());

  try {
    assertCan(resolved.ctx, "post.create");

    const result = await uploadStore(env).mint(resolved.ctx, parsed.data);
    if (!result.ok) return fail(uploadRefusalStatus(result.code), result.code, result.message);

    return ok({
      uploadId: result.uploadId,
      key: result.key,
      url: result.url,
      mime: result.mime,
      maxBytes: result.maxBytes,
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
