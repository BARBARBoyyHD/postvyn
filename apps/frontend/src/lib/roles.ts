/**
 * Who may do what — defined once.
 *
 * Comparing roles inline at each endpoint is how a codebase ends up with three opinions about who may
 * publish. Every mutating route names an action; the minimum role comes from this table; an action
 * that is not in the table fails closed rather than defaulting to allow.
 */
import type { Role, WorkspaceContext } from "@/lib/context";

export type Action =
  | "brand.create"
  | "brand.update"
  | "brand.delete"
  | "post.create"
  | "post.update"
  | "post.delete"
  | "variant.create"
  | "variant.approve"
  | "variant.publish"
  | "channel.connect"
  | "channel.disconnect"
  | "media.upload"
  | "workspace.settings.update"
  | "workspace.member.manage";

const RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

/**
 * Minimum role per action. Note what is *not* `editor`: approval and publishing are the human gate —
 * the two things this product exists to make deliberate (US-008).
 */
const MATRIX: Record<Action, Role> = {
  "brand.create": "editor",
  "brand.update": "editor",
  "brand.delete": "owner",

  "post.create": "editor",
  "post.update": "editor",
  "post.delete": "owner",

  "variant.create": "editor",
  "variant.approve": "owner",
  "variant.publish": "owner",

  "channel.connect": "owner",
  "channel.disconnect": "owner",

  "media.upload": "editor",

  "workspace.settings.update": "owner",
  "workspace.member.manage": "owner",
};

export function minimumRole(action: Action): Role | null {
  return MATRIX[action] ?? null;
}

export function can(ctx: WorkspaceContext, action: Action): boolean {
  const required = minimumRole(action);
  // Unknown action ⇒ deny. A typo in an action name must not become an unguarded endpoint.
  if (!required) return false;
  return RANK[ctx.role] >= RANK[required];
}

export class ForbiddenError extends Error {
  constructor(
    readonly action: Action,
    readonly role: Role,
  ) {
    super(`Role "${role}" may not perform "${action}"`);
    this.name = "ForbiddenError";
  }
}

/** Throws when the context may not perform the action. Route handlers translate this to `403`. */
export function assertCan(ctx: WorkspaceContext, action: Action): void {
  if (!can(ctx, action)) throw new ForbiddenError(action, ctx.role);
}

/** Exposed for the test that enumerates every action and asserts the matrix covers it. */
export const ACTION_MATRIX: Readonly<Record<Action, Role>> = MATRIX;
