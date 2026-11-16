/**
 * `POST /api/agent/media` — an agent uploads one asset.
 *
 * Raw bytes in the body, so a render can `curl -T file.mp4` without building multipart: the file is the
 * request. The MIME is sniffed from the bytes; the filename is advisory and only used in error messages.
 */
import { fail, ok, toErrorResponse } from "@/lib/api";
import { requireAgent } from "@/lib/agent-guard";
import { intake } from "@/db/intake";
import { getBindings } from "@/lib/bindings";
import type { WorkerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const env = (await getBindings()) as WorkerEnv | null;
  const gate = await requireAgent(request, env);
  if (!gate.ok) return gate.response;

  try {
    const bytes = await request.arrayBuffer();
    const result = await intake(gate.env).upload(gate.ctx, {
      bytes,
      filename: request.headers.get("x-postvyn-filename") ?? "upload",
      postable: request.headers.get("x-postvyn-postable") !== "false",
    });

    if (!result.ok) {
      const status = result.code === "too_large" ? 413 : result.code === "unsupported_type" ? 415 : 422;
      return fail(status as 413 | 415 | 422, result.code, result.message);
    }

    return ok({
      mediaId: result.media.id,
      key: result.media.key,
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
