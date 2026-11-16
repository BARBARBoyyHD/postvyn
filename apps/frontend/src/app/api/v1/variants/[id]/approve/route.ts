/**
 * `POST /api/v1/variants/:id/approve` — the human gate, for one variant.
 *
 * Owner only, cookie only. There is deliberately no token path to this route: an agent that could approve
 * its own draft would make the gate decorative.
 *
 * The slot is required: an approval without a time is a decision nobody can schedule, and defaulting to
 * "now" would publish on approve, which is the one behaviour the product promises never to do.
 */
import { z } from "zod";

import { resolveContext } from "@/auth/context";
import { approvals } from "@/db/approvals";
import { fail, ok, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import type { WorkerEnv } from "@/lib/env";
import { assertCan } from "@/lib/roles";

export const dynamic = "force-dynamic";

const schema = z.object({
  /** Unix milliseconds. A string date is accepted too, because a curl call is a real client. */
  slotAt: z.union([z.number().int().positive(), z.string().min(8)]),
  note: z.string().max(400).nullish(),
});

export async function POST(request: Request, params: { params: Promise<{ id: string }> }) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(422, "invalid_approval", parsed.error.flatten());

  const slotAt =
    typeof parsed.data.slotAt === "number" ? parsed.data.slotAt : Date.parse(parsed.data.slotAt);
  if (!Number.isFinite(slotAt) || slotAt <= Date.now()) {
    return fail(422, "slot_must_be_in_the_future");
  }

  try {
    assertCan(resolved.ctx, "variant.approve");
    const { id } = await params.params;

    const result = await approvals(env).approve(resolved.ctx, id, {
      slotAt,
      note: parsed.data.note ?? null,
    });
    if (!result) return fail(404, "not_found");

    return ok(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Revoke: the post goes back to `review` and the queued job stops counting. */
export async function DELETE(request: Request, params: { params: Promise<{ id: string }> }) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  try {
    assertCan(resolved.ctx, "variant.approve");
    const { id } = await params.params;
    const result = await approvals(env).revoke(resolved.ctx, id);
    if (!result) return fail(404, "not_found");
    return ok(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
