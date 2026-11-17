/**
 * `POST /api/agent/media` — an agent mints a signed upload URL for one asset.
 *
 * The token door to the same flow the browser uses (m6 1.1): mint, PUT the file to R2, record. The
 * file never travels through the Worker, which is what makes a 20 MB render an upload rather than a
 * timeout.
 */
import { uploadStore } from "@/db/media-upload";
import { requireAgent } from "@/lib/agent-guard";
import { fail, ok, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import { mintUploadSchema, uploadRefusalStatus } from "@/lib/media/upload";
import type { WorkerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const env = (await getBindings()) as WorkerEnv | null;
  const gate = await requireAgent(request, env);
  if (!gate.ok) return gate.response;

  const parsed = mintUploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(422, "invalid_upload", parsed.error.flatten());

  try {
    const result = await uploadStore(gate.env).mint(gate.ctx, parsed.data);
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
