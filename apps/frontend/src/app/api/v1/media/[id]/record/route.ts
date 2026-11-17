/**
 * `POST /api/v1/media/:id/record` — the upload finished; write what actually landed.
 *
 * `:id` is the upload id a mint returned, not a media id: the row does not exist yet, and its identity
 * is the hash of the stripped bytes, which only the server can compute. Nothing the client sends here
 * is trusted — the object is re-read from R2 and the size, type and dimensions are decided from it
 * (m6 1.2, 1.5).
 */
import { resolveContext } from "@/auth/context";
import { uploadStore } from "@/db/media-upload";
import { fail, ok, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import { recordUploadSchema, uploadIdSchema, uploadRefusalStatus } from "@/lib/media/upload";
import type { WorkerEnv } from "@/lib/env";
import { assertCan } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function POST(request: Request, params: { params: Promise<{ id: string }> }) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  const { id } = await params.params;
  const uploadId = uploadIdSchema.safeParse(id);
  if (!uploadId.success) return fail(422, "invalid_upload", uploadId.error.flatten());

  const parsed = recordUploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(422, "invalid_upload", parsed.error.flatten());

  try {
    assertCan(resolved.ctx, "post.create");

    const result = await uploadStore(env).record(resolved.ctx, uploadId.data, parsed.data);
    if (!result.ok) return fail(uploadRefusalStatus(result.code), result.code, result.message);

    return ok({
      mediaId: result.media.id,
      key: result.media.key,
      url: result.url,
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
