/**
 * The token door's doorman.
 *
 * One place decides what an agent token may do, and the answer is: draft and upload. Not approve, not
 * publish, not delete — those are `owner` actions and a token is `editor`, enforced by the role matrix
 * rather than by each handler remembering to check.
 */
import { fail } from "@/lib/api";
import { bearerFrom, contextForScope, hashToken, type AgentScope } from "@/lib/agent-token";
import { agentTokenStore } from "@/db/agent-tokens";
import type { WorkspaceContext } from "@/lib/context";
import type { WorkerEnv } from "@/lib/env";

export type AgentGate =
  | { ok: true; scope: AgentScope; ctx: WorkspaceContext; env: WorkerEnv }
  | { ok: false; response: Response };

export async function requireAgent(request: Request, env: WorkerEnv | null): Promise<AgentGate> {
  if (!env?.DB) return { ok: false, response: fail(503, "no_database_binding") };

  const token = bearerFrom(request.headers.get("authorization"));
  if (!token) {
    // 401 with no detail: a bad token and a revoked one are the same answer.
    return { ok: false, response: fail(401, "unauthenticated") };
  }

  const store = agentTokenStore(env);
  const row = await store.findByHash(await hashToken(token));
  if (!row) return { ok: false, response: fail(401, "unauthenticated") };

  await store.touch(row.id);

  const scope: AgentScope = {
    tokenId: row.id,
    label: row.label,
    workspaceId: row.workspaceId,
    brandId: row.brandId,
    role: "editor",
  };

  return { ok: true, scope, ctx: contextForScope(scope), env };
}
