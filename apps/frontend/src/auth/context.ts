/**
 * Request → `WorkspaceContext`.
 *
 * The single place that decides who the caller is and which tenant they are acting in. Two rules:
 *
 * 1. **The workspace comes from the session's membership, never from the request.** A workspace id in
 *    a body or query string is ignored — that is the difference between multi-tenant and
 *    multi-tenant-with-a-hole.
 * 2. **No session, no context, no query.** Callers get `null` and refuse with `401` before any
 *    repository call, so an unauthenticated request cannot cost a database read.
 */
import { createAuth } from "@/auth/server";
import { identityStore } from "@/db/identity";
import { repository } from "@/db/repository";
import type { WorkerEnv } from "@/lib/env";
import type { Role, WorkspaceContext } from "@/lib/context";

export interface ResolvedRequest {
  ctx: WorkspaceContext;
  userId: string;
  email: string;
  activeBrandId: string | null;
  /** Present when the caller needed the brand list for a switcher; absent otherwise. */
  brands?: { id: string; slug: string; name: string; colors: string | null }[];
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "UnauthenticatedError";
  }
}

export async function resolveContext(
  request: Request,
  env: WorkerEnv,
  options: { activeBrandId?: string | null } = {},
): Promise<ResolvedRequest | null> {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return null;

  // Provision on the first authenticated session *after* verification, not at signup: a typo'd
  // address then never becomes a phantom tenant (design decision).
  const membership = await identityStore(env).ensureWorkspace(
    session.user.id,
    session.user.name?.trim() || session.user.email.split("@")[0] || "Workspace",
  );

  const ctx: WorkspaceContext = {
    workspaceId: membership.workspaceId,
    userId: session.user.id,
    role: membership.role as Role,
  };

  const brands = await repository(env).listBrands(ctx);
  const requested = options.activeBrandId ?? null;
  const activeBrandId = brands.some((brand) => brand.id === requested)
    ? requested
    : (brands[0]?.id ?? null);

  return { ctx, userId: session.user.id, email: session.user.email, activeBrandId };
}

/** Route-handler convenience: throws instead of returning null. */
export async function requireContext(request: Request, env: WorkerEnv): Promise<ResolvedRequest> {
  const resolved = await resolveContext(request, env);
  if (!resolved) throw new UnauthenticatedError();
  return resolved;
}

/**
 * The same resolution, from `Headers` rather than a `Request`.
 *
 * Server components have `headers()` and `cookies()`, not the request object — and duplicating the
 * membership lookup in a second place is how two different ideas of "the current workspace" appear.
 */
export async function resolveContextFromHeaders(
  headers: Headers,
  env: WorkerEnv,
  options: { activeBrandId?: string | null } = {},
): Promise<ResolvedRequest | null> {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;

  const membership = await identityStore(env).ensureWorkspace(
    session.user.id,
    session.user.name?.trim() || session.user.email.split("@")[0] || "Workspace",
  );

  const ctx: WorkspaceContext = {
    workspaceId: membership.workspaceId,
    userId: session.user.id,
    role: membership.role as Role,
  };

  const brands = await repository(env).listBrands(ctx);
  const requested = options.activeBrandId ?? null;
  const activeBrandId = brands.some((brand) => brand.id === requested)
    ? requested
    : (brands[0]?.id ?? null);

  return { ctx, userId: session.user.id, email: session.user.email, activeBrandId, brands };
}
