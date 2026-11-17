/**
 * `GET /api/v1/jobs/due` — what the next 24 hours will attempt to publish.
 *
 * Workspace-scoped and read-only. The window comes from `dueWindow` so the board, any agent and this
 * route cannot disagree about what "next 24 hours" means; the timezone is returned alongside the jobs
 * because UTC is storage, not something an operator reads.
 */
import { resolveContext } from "@/auth/context";
import { repository } from "@/db/repository";
import { dueWindow } from "@/db/tick";
import { fail, ok, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import type { WorkerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  try {
    const window = dueWindow();
    const repo = repository(env);
    const jobs = await repo.listDueJobs(resolved.ctx, window);
    const settings = await repo.getWorkspaceSettings(resolved.ctx);
    return ok({ ...window, timezone: settings?.timezone ?? "UTC", jobs });
  } catch (error) {
    return toErrorResponse(error);
  }
}
