/**
 * One envelope, one error vocabulary.
 *
 * Status codes are the contract (ITA §4.3): `401` not signed in, `403` role too low, `404` not yours
 * or not there (deliberately the same answer), `409` conflict, `422` invalid input. A handler that
 * invents its own status code makes the client guess.
 */
import { ForbiddenError } from "@/lib/roles";

export type ApiEnvelope<T> =
  | { ok: true; result: T; log?: string[] }
  | { ok: false; error: string; detail?: unknown };

export function ok<T>(result: T, log?: string[]): Response {
  return Response.json({ ok: true, result, ...(log ? { log } : {}) }, { status: 200 });
}

export function created<T>(result: T): Response {
  return Response.json({ ok: true, result }, { status: 201 });
}

export function fail(
  status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 503,
  error: string,
  detail?: unknown,
): Response {
  return Response.json({ ok: false, error, ...(detail === undefined ? {} : { detail }) }, { status });
}

/**
 * Translate a thrown error into the envelope. Anything unrecognised becomes a `500` with a generic
 * message — an internal error message can contain a query, a path or a secret.
 */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof ForbiddenError) {
    return fail(403, "forbidden", { action: error.action, role: error.role });
  }
  if (error instanceof Error && error.name === "UnauthenticatedError") {
    return fail(401, "unauthenticated");
  }
  if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
    return fail(409, "conflict");
  }
  console.error("[api] unhandled", error);
  return fail(500, "internal_error");
}
