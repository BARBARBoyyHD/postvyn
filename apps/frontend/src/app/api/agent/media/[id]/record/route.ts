/**
 * `POST /api/agent/media/:id/record` — the agent's upload finished; record what landed.
 *
 * The same recording the browser door uses, with a token instead of a session: the row's size, type and
 * dimensions are read from the stored object, never from the request (m6 1.2).
 */
import { uploadStore } from "@/db/media-upload";
import { requireAgent } from "@/lib/agent-guard";
import { fail, ok, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import { recordUploadSchema, uploadIdSchema, uploadRefusalStatus } from "@/lib/media/upload";
import type { WorkerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request, params: { params: Promise<{ id: string }> }) {
  const env = (await getBindings()) as WorkerEnv | null;
  const gate = await requireAgent(request, env);
  if (!gate.ok) return gate.response;

  const { id } = await params.params;
  const uploadId = uploadIdSchema.safeParse(id);
  if (!uploadId.success) return fail(422, "invalid_upload", uploadId.error.flatten());

  const parsed = recordUploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(422, "invalid_upload", parsed.error.flatten());

  try {
    const result = await uploadStore(gate.env).record(gate.ctx, uploadId.data, parsed.data);
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
