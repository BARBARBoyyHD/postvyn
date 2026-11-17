/**
 * `POST /api/agent/posts/:id/publish` — for "Hermes, upload it".
 *
 * The token path deliberately does **not** approve. It publishes content a human already approved, and
 * answers `409 approval_required` otherwise. A token that could approve its own output would make the gate
 * decorative, and that gate is the product's whole promise.
 *
 * So the two-step loop is: Hermes creates the draft, Uwi approves it (one click), Hermes publishes it. If
 * that single click is unwanted, it is a product decision — a token flag — not something to slip into an
 * endpoint.
 */
import { resolveContext } from "@/auth/context";
import { approvals } from "@/db/approvals";
import { publishNow } from "@/db/tick";
import { fail, ok, toErrorResponse } from "@/lib/api";
import { requireAgent } from "@/lib/agent-guard";
import { repository, type Repository } from "@/db/repository";
import { getBindings } from "@/lib/bindings";
import type { WorkerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request, params: { params: Promise<{ id: string }> }) {
  const env = (await getBindings()) as WorkerEnv | null;

  // A session may call this too (the UI uses the v1 route, but a script with a cookie is not unusual).
  const agent = await requireAgent(request, env);
  const gate = agent.ok ? agent : null;
  if (!gate) {
    if (!env?.DB) return fail(503, "no_database_binding");
    const resolved = await resolveContext(request, env);
    if (!resolved) return fail(401, "unauthenticated");
    return publish(env, repository(env), resolved.ctx, params, true);
  }

  return publish(gate.env, repository(gate.env), gate.ctx, params, false);
}

async function publish(
  env: WorkerEnv,
  repo: Repository,
  ctx: { workspaceId: string; userId: string | null; role: "owner" | "editor" | "viewer" },
  params: { params: Promise<{ id: string }> },
  mayApprove: boolean,
): Promise<Response> {
  try {
    const { id } = await params.params;
    const detail = await repo.getPostDetail(ctx, id);
    if (!detail) return fail(404, "not_found");

    if (env.PUBLISHING_ENABLED !== "true") {
      return fail(409, "publishing_disabled", { reason: "PUBLISHING_ENABLED is off" });
    }

    const store = approvals(env);
    const unapproved: string[] = [];
    for (const variant of detail.variants) {
      const current = await store.verify(variant.id);
      if (current.ok) continue;
      if (!mayApprove) {
        unapproved.push(variant.platform);
        continue;
      }
      await store.approve(ctx, variant.id, { slotAt: Date.now(), note: "publish now (session)" });
    }

    if (unapproved.length > 0) {
      return fail(409, "approval_required", {
        platforms: unapproved,
        hint: "a token may publish only what a human has approved",
      });
    }

    const report = await publishNow(env, id);
    if (!report) return fail(404, "not_found");
    return ok(report);
  } catch (error) {
    return toErrorResponse(error);
  }
}
