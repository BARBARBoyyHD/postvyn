/**
 * Agent tokens: mint and hash. No database here — the lookup lives in `src/db/agent-tokens.ts`, where
 * query building belongs (the boundary rule is ADR-014 and it applies to me too).
 *
 * A token is a **scope**, not a user. It resolves to `{workspaceId, brandId, role: "editor"}`, and the
 * role is the point: `variant.approve` requires `owner`, so no request shape a token can send reaches the
 * human gate. That is enforced by the role matrix, not by remembering to check.
 */
import type { Role, WorkspaceContext } from "@/lib/context";

const TOKEN_PREFIX = "pvt_";

export interface AgentScope {
  tokenId: string;
  label: string;
  workspaceId: string;
  brandId: string;
  /** Always `editor`: an agent may draft, never approve or publish. */
  role: Role;
}

/** 32 random bytes, base64url — 43 characters, no padding, copy-paste safe. */
export async function mintToken(): Promise<{ token: string; hash: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = `${TOKEN_PREFIX}${base64url(bytes)}`;
  return { token, hash: await hashToken(token) };
}

/** SHA-256 hex. No salt: the input is already 256 bits of entropy and is never stored. */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The context an agent acts in.
 *
 * `userId` is `agent:<tokenId>` rather than null: null means "the platform itself" (cron, importer), and
 * conflating the two would make an ingested draft look like a scheduled job.
 */
export function contextForScope(scope: AgentScope): WorkspaceContext {
  return {
    workspaceId: scope.workspaceId,
    userId: `agent:${scope.tokenId}`,
    role: scope.role,
  };
}

/** Shape check before hashing: cheap rejection for obviously-wrong headers. */
export function looksLikeToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX) && value.length >= 20;
}

/** The bearer value from an Authorization header, or null. */
export function bearerFrom(authorization: string | null): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return looksLikeToken(token) ? token : null;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
