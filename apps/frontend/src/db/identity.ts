/**
 * The one place tenancy is looked up *before* a context exists.
 *
 * `repository.ts` demands a `WorkspaceContext`, which is the whole point — but you cannot build a
 * context without first asking "which workspace does this user belong to". That bootstrap question
 * has no tenant to scope by, so it lives here, takes a user id explicitly, and returns exactly one
 * row. Everything after it goes back through the scoped repository.
 *
 * Provisioning lives here too, because it runs in the same window: an account exists, its workspace
 * does not yet.
 */
import { eq, sql } from "drizzle-orm";
import * as authSchema from "./auth-schema";
import { createDb, type Bindings } from "./client";
import * as s from "./schema";

export interface PrimaryMembership {
  workspaceId: string;
  role: "owner" | "editor" | "viewer";
}

export function identityStore(env: Bindings) {
  const db = createDb(env.DB);

  return {
    /** The user's workspace. Multi-workspace is modelled but not offered yet (M1 non-goal). */
    async findPrimaryMembership(userId: string): Promise<PrimaryMembership | null> {
      const [row] = await db
        .select({ workspaceId: s.memberships.workspaceId, role: s.memberships.role })
        .from(s.memberships)
        .where(eq(s.memberships.userId, userId))
        .limit(1);
      return row ?? null;
    },

    /** Used by the failed-sign-in audit, which needs a user id from an address. */
    async findUserIdByEmail(email: string): Promise<string | null> {
      const [row] = await db
        .select({ id: authSchema.user.id })
        .from(authSchema.user)
        .where(eq(authSchema.user.email, email.toLowerCase()))
        .limit(1);
      return row?.id ?? null;
    },

    /**
     * Create the workspace and its owner membership together.
     *
     * One `batch()`, because D1 has no interactive transaction: two separate writes leave a window
     * where the account exists with no workspace, and every later request then fails in a way that
     * looks like a broken login.
     */
    async provisionWorkspace(input: { userId: string; name: string; timezone?: string }) {
      const now = Date.now();
      const workspaceId = crypto.randomUUID();

      await db.batch([
        db.insert(s.workspaces).values({
          id: workspaceId,
          name: input.name,
          plan: "free",
          timezone: input.timezone ?? "UTC",
          publishingEnabled: false,
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(s.memberships).values({
          id: crypto.randomUUID(),
          userId: input.userId,
          workspaceId,
          role: "owner",
          createdAt: now,
        }),
      ]);

      return { workspaceId, role: "owner" as const };
    },

    /**
     * A workspace with no members yet — the seeded default on a fresh database.
     *
     * A solo tool seeds its tenant rather than asking the first user to invent one, so the first
     * account to arrive takes ownership of the unclaimed workspace. Multi-workspace remains modelled
     * and unoffered (M1 non-goal); this is the one place a workspace is chosen by something other than
     * a membership.
     */
    async findAdoptableWorkspaceId(): Promise<string | null> {
      const [row] = await db
        .select({ id: s.workspaces.id })
        .from(s.workspaces)
        .where(
          sql`not exists (select 1 from ${s.memberships} m where m.workspace_id = ${s.workspaces.id})`,
        )
        .orderBy(s.workspaces.createdAt)
        .limit(1);
      return row?.id ?? null;
    },

    /** Membership write on its own, so adoption and provisioning share one failure path. */
    async claimWorkspace(userId: string, workspaceId: string, role: "owner" = "owner") {
      await db.insert(s.memberships).values({
        id: crypto.randomUUID(),
        userId,
        workspaceId,
        role,
        createdAt: Date.now(),
      });
      return { workspaceId, role };
    },

    /** Provision only if the user has nothing yet — the idempotent wrapper used on every session. */
    async ensureWorkspace(userId: string, fallbackName: string): Promise<PrimaryMembership> {
      const existing = await this.findPrimaryMembership(userId);
      if (existing) return existing;

      // 1. adopt the seeded, unclaimed workspace when there is one
      const adoptable = await this.findAdoptableWorkspaceId();
      if (adoptable) {
        try {
          return await this.claimWorkspace(userId, adoptable);
        } catch {
          // two requests arrived together: the other one won, this one reads the result
          const won = await this.findPrimaryMembership(userId);
          if (won) return won;
        }
      }

      // 2. otherwise provision one — and survive the same race
      try {
        const created = await this.provisionWorkspace({ userId, name: fallbackName });
        return { workspaceId: created.workspaceId, role: created.role };
      } catch (error) {
        const settled = await this.findPrimaryMembership(userId);
        if (settled) return settled;

        // Last resort: the name collided with an existing workspace that somebody else owns.
        const retry = await this.findAdoptableWorkspaceId();
        if (retry) {
          try {
            return await this.claimWorkspace(userId, retry);
          } catch {
            /* fall through to the original error, which is the useful one */
          }
        }
        throw error;
      }
    },
  };
}
