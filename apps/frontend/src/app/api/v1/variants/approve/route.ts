/**
 * `POST /api/v1/variants/approve` — approve a list of variants for one slot.
 *
 * Same gate as the single route: owner, cookie, no token path. The only difference is that one item
 * failing does not cancel the rest — an operator clearing a day's queue should not lose eleven approvals
 * to one stale card. Each item answers for itself, and every success writes its own `variant.approved`
 * audit row (see `approvals.approve`).
 *
 * The slot is shared because the action is "these ship together at 09:00", which is what a queue looks
 * like. Per-item slots would be a different product (a scheduler UI), not a bigger version of this one.
 */
import { z } from "zod";

import { resolveContext } from "@/auth/context";
import { approvals } from "@/db/approvals";
import { fail, ok, toErrorResponse } from "@/lib/api";
import { parseSlotAt, slotAtSchema } from "@/lib/approval-request";
import { getBindings } from "@/lib/bindings";
import type { WorkerEnv } from "@/lib/env";
import { assertCan } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** Each item costs a handful of statements; the cap keeps one request inside an invocation's budget. */
const MAX_BATCH = 50;

const schema = z.object({
  slotAt: slotAtSchema,
  note: z.string().max(400).nullish(),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        /** The content hash the operator saw for this card. Omitted: approve whatever is stored now. */
        hash: z.string().length(64).optional(),
      }),
    )
    .min(1)
    .max(MAX_BATCH),
});

export async function POST(request: Request) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(422, "invalid_approval", parsed.error.flatten());

  const slotAt = parseSlotAt(parsed.data.slotAt);
  if (slotAt === null) return fail(422, "slot_must_be_in_the_future");

  try {
    // Role is per caller, not per item: an editor cannot approve one of the twelve either.
    assertCan(resolved.ctx, "variant.approve");

    const report = await approvals(env).approveBatch(resolved.ctx, parsed.data.items, {
      slotAt,
      note: parsed.data.note ?? null,
    });
    return ok(report);
  } catch (error) {
    return toErrorResponse(error);
  }
}
