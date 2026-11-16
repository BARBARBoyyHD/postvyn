/**
 * Who is asking, resolved once per request.
 *
 * Every page in the app group needs the same three things — bindings, session, workspace context — and
 * without this they each pay for them separately. That is not just cost: two resolutions running
 * concurrently both found "this user has no workspace" and both tried to create one, which is how a
 * unique name constraint became a 500 on first sign-in instead of a page.
 *
 * `cache()` is per-request in React's server runtime, so this is a memoisation, not a process-wide
 * singleton — the right lifetime for something that must never leak between two users.
 */
import { cache } from "react";
import { cookies, headers } from "next/headers";

import { resolveContextFromHeaders, type ResolvedRequest } from "./context";
import { getBindings } from "@/lib/bindings";
import type { WorkerEnv } from "@/lib/env";

const BRAND_COOKIE = "postvyn.brand";

export interface CurrentRequest {
  env: WorkerEnv | null;
  resolved: ResolvedRequest | null;
}

export const currentRequest = cache(async (): Promise<CurrentRequest> => {
  const env = await getBindings();
  if (!env) return { env: null, resolved: null };

  const activeBrandId = (await cookies()).get(BRAND_COOKIE)?.value ?? null;
  const resolved = await resolveContextFromHeaders(await headers(), env, { activeBrandId });

  return { env, resolved };
});
