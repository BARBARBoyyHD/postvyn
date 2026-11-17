/**
 * `POST /api/internal/tick` — run the queue by hand.
 *
 * The cron handler and this route call the same function, so "it worked when I ran it" and "it worked at
 * 09:05" are the same code path. Guarded by `CRON_SECRET` as a bearer token, never by a session: a
 * session-authenticated cron is a cron somebody can trigger from a browser tab. The scheduled path
 * behind Cloudflare's trigger needs no secret — it cannot be reached from outside.
 */
import { runScheduled } from "@/db/scheduled";
import { fail, ok, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import type { WorkerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const secret = env.CRON_SECRET;
  const presented = request.headers.get("authorization");
  if (!secret || presented !== `Bearer ${secret}`) {
    // 404 rather than 401: an unauthenticated caller learns nothing about whether this route exists.
    return fail(404, "not_found");
  }

  try {
    const report = await runScheduled(env);
    return ok(report);
  } catch (error) {
    return toErrorResponse(error);
  }
}
