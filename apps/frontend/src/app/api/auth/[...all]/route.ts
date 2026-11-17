/**
 * Better Auth's own endpoints, with the two guards this product adds in front of them.
 *
 * The path is unversioned on purpose: Better Auth's client expects `/api/auth/*` verbatim. It is the
 * single exception to the versioned-surface rule, and it is written down rather than quietly
 * inconsistent (ITA §4.3).
 *
 * What happens here before the library sees the request:
 *
 * - **Turnstile** on sign-up and on the two endpoints that send mail to a caller-chosen address.
 *   Sign-up no longer sends anything (verification is off while mail is deferred), but it stays
 *   guarded: it creates an account and hashes a password, and it regains a mail send the day
 *   verification comes back.
 * - **Failed sign-ins are audited**, because a credential-stuffing run that leaves no trace is a run
 *   nobody can respond to. Recorded only when the address belongs to a known user: `activity_log`
 *   requires a workspace, and inventing one for an unknown address would be worse than the gap.
 */
import { createAuth } from "@/auth/server";
import { identityStore } from "@/db/identity";
import { repository } from "@/db/repository";
import { getBindings } from "@/lib/bindings";
import type { WorkerEnv } from "@/lib/env";
import { verifyTurnstile } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

const MAIL_ENDPOINTS = new Set(["/sign-up/email", "/forget-password", "/request-password-reset"]);

function pathOf(request: Request): string {
  const url = new URL(request.url);
  return url.pathname.replace(/^\/api\/auth/, "");
}

/** Removes the bot-check field and returns a request the library will accept. */
async function withoutTurnstileField(request: Request): Promise<{
  request: Request;
  token: string | null;
}> {
  const body = (await request.clone().json().catch(() => ({}))) as Record<string, unknown>;
  const token =
    typeof body.turnstileToken === "string"
      ? body.turnstileToken
      : typeof body["cf-turnstile-response"] === "string"
        ? (body["cf-turnstile-response"] as string)
        : null;

  const rest = { ...body };
  delete rest.turnstileToken;
  delete rest["cf-turnstile-response"];

  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(rest),
  };
  return { request: new Request(request.url, init), token };
}

async function auditFailure(env: WorkerEnv, email: unknown, reason: string) {
  if (typeof email !== "string") return;
  try {
    const store = identityStore(env);
    const userId = await store.findUserIdByEmail(email);
    if (!userId) return; // no workspace to attribute it to — see the header note
    const membership = await store.findPrimaryMembership(userId);
    if (!membership) return;
    await repository(env).recordActivity(
      { workspaceId: membership.workspaceId, userId, role: membership.role },
      { action: "auth.sign_in_failed", detail: { reason } },
    );
  } catch (error) {
    console.error("[audit] could not record failed sign-in", error);
  }
}

async function handle(request: Request): Promise<Response> {
  const env = (await getBindings()) as WorkerEnv | null;

  if (!env?.DB) {
    return Response.json(
      {
        ok: false,
        error: "no_database_binding",
        detail: "Auth is unavailable outside the Worker runtime.",
      },
      { status: 503 },
    );
  }

  const path = pathOf(request);
  let forward = request;

  if (request.method === "POST" && MAIL_ENDPOINTS.has(path)) {
    const { request: stripped, token } = await withoutTurnstileField(request);
    const ip = request.headers.get("cf-connecting-ip");
    const check = await verifyTurnstile(env, token, ip);
    if (!check.ok) {
      return Response.json({ ok: false, error: "turnstile_failed", detail: check.reason }, { status: 403 });
    }
    forward = stripped;
  }

  try {
    const response = await createAuth(env).handler(forward);

    if (request.method === "POST" && path === "/sign-in/email" && response.status >= 400) {
      const body = (await request.clone().json().catch(() => ({}))) as { email?: unknown };
      await auditFailure(env, body.email, `status_${response.status}`);
    }

    return response;
  } catch (error) {
    // Never echo the underlying message: it can contain a secret or an internals path.
    console.error("[auth] handler failed", error);
    return Response.json({ ok: false, error: "auth_failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
