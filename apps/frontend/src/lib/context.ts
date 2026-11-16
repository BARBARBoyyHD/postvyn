/**
 * The tenancy contract.
 *
 * Every repository function takes a `WorkspaceContext` as its first argument. There is no overload
 * without it, and no way to build one from request input: contexts are produced by `ctxFromSession`
 * and by test fixtures, nowhere else.
 *
 * Why this exists at all: D1 has no row-level security (ADR-014), so the `WHERE workspace_id = ?`
 * that a database would have enforced for us is injected here instead. A missing filter is therefore
 * a code-review failure rather than an impossibility — which is why the isolation test exists.
 */

export type Role = "owner" | "editor" | "viewer";

export interface WorkspaceContext {
  /** The tenant boundary. Every query is scoped by it. */
  readonly workspaceId: string;
  /** Who is acting. `null` only for system work: the cron claim, the importer. */
  readonly userId: string | null;
  /** What they may do. System work is `owner` because it is the server itself. */
  readonly role: Role;
}

/** Work performed by the platform on its own behalf — cron claim, import, token refresh. */
export const systemContext = (workspaceId: string): WorkspaceContext => ({
  workspaceId,
  userId: null,
  role: "owner",
});

/**
 * Build a context from a resolved session.
 *
 * Deliberately takes the workspace the session is *currently in*, not a value from the request body:
 * a caller that supplies a different workspace id must not be able to widen its own scope.
 */
export function ctxFromSession(session: {
  user: { id: string };
  workspaceId: string;
  role: Role;
}): WorkspaceContext {
  return {
    workspaceId: session.workspaceId,
    userId: session.user.id,
    role: session.role,
  };
}

/** Readers may read. Editors and owners may write. */
export const canWrite = (ctx: WorkspaceContext): boolean => ctx.role !== "viewer";
