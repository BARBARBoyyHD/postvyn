/**
 * Token lookup — the other bootstrap query, beside `identity.ts`.
 *
 * It lives here, not in `src/lib`, because it reads the database: the ESLint boundary rule confines query
 * building to `src/db` (ADR-014), and it was right to complain. Like the membership lookup, this one has
 * no tenant to scope by — the token *is* the scope, which is exactly why it lives with the other
 * bootstrap read rather than in a general repository.
 */
import { and, eq, isNull } from "drizzle-orm";

import { createDb, type Bindings } from "./client";
import * as s from "./schema";

export interface TokenRow {
  id: string;
  label: string;
  workspaceId: string;
  brandId: string;
}

export function agentTokenStore(env: Bindings) {
  const db = createDb(env.DB);

  return {
    /** Unrevoked token by hash. A revoked token and a wrong one are the same answer: nothing. */
    async findByHash(hash: string): Promise<TokenRow | null> {
      const [row] = await db
        .select({
          id: s.agentTokens.id,
          label: s.agentTokens.label,
          workspaceId: s.agentTokens.workspaceId,
          brandId: s.agentTokens.brandId,
        })
        .from(s.agentTokens)
        .where(and(eq(s.agentTokens.tokenHash, hash), isNull(s.agentTokens.revokedAt)))
        .limit(1);
      return row ?? null;
    },

    /** Best-effort: a failed touch must not fail the request it is recording. */
    async touch(id: string): Promise<void> {
      try {
        await db.update(s.agentTokens).set({ lastUsedAt: Date.now() }).where(eq(s.agentTokens.id, id));
      } catch {
        /* the token worked; the timestamp is a convenience */
      }
    },
  };
}
